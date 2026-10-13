'use strict';

const express = require('express');

const User = require('../models/User.model');
const Course = require('../models/Course.model');
const Enrollment = require('../models/Enrollment.model');
const { REQUIRED_READING_SECONDS } = require('../models/Enrollment.model');
const { asyncHandler, ApiError } = require('../middleware/error');
const { protect, requireRole, requireActive } = require('../middleware/auth');
const { validate } = require('../utils/validate');
const { buildCertificatePdf } = require('../utils/certificatePdf');

const router = express.Router();

/* Everything under /api/student is for the signed-in, approved student only. */
router.use(protect, requireRole('student'), requireActive);

/** Look a published course up by slug or by 24-char id. */
function findCourse(key) {
  const clean = String(key || '').trim();
  if (!clean) return null;
  return Course.findOne({
    published: true,
    $or: [
      { slug: clean.toLowerCase() },
      { _id: /^[0-9a-fA-F]{24}$/.test(clean) ? clean : '000000000000000000000000' },
    ],
  });
}

/** Stable, human-readable certificate code for an enrollment. */
function certificateId(enrollment) {
  const when = enrollment.completedAt || enrollment.updatedAt || new Date();
  const year = new Date(when).getFullYear();
  return `PP-${year}-${enrollment._id.toString().slice(-6).toUpperCase()}`;
}

/** "1 June 2026" - matches the certificate wording. */
function longDate(value) {
  const d = value ? new Date(value) : new Date();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Load this student's certificate, or fail with the right status code. */
async function loadCertificate(req) {
  const course = await findCourse(req.params.courseId);
  if (!course) throw ApiError.notFound('Course not found');

  const enrollment = await Enrollment.findOne({ user: req.user._id, course: course._id });
  if (!enrollment) throw ApiError.forbidden('Enroll in this course first');
  if (enrollment.status !== 'completed' && enrollment.progress < 100) {
    throw ApiError.forbidden('Complete 100% of this course to earn your certificate');
  }

  const completedAt = enrollment.completedAt || enrollment.updatedAt;
  return {
    id: certificateId(enrollment),
    studentName: req.user.name,
    studentEmail: req.user.email,
    courseTitle: course.title,
    instructor: course.instructor || 'Physioprisma Academy',
    lessons: (course.lessons || []).length,
    completedAt,
    completedText: longDate(completedAt),
    issuedAt: new Date(),
  };
}

/* ------------------------------------------------------------------ */
/* GET /api/student/dashboard - the logged-in student's own portal data */
/* ------------------------------------------------------------------ */
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const enrollments = await Enrollment.find({ user: req.user._id })
      .populate('course')
      .sort({ lastAccessedAt: -1, createdAt: -1 });

    // Enrollments whose course was deleted are skipped (nothing to show).
    const courses = enrollments
      .filter((e) => e.course)
      .map((e) => e.toDashboard(e.course));

    const completed = courses.filter((c) => c.status === 'Completed').length;
    const inProgress = courses.filter((c) => c.status === 'In Progress').length;

    res.json({
      ok: true,
      user: {
        id: req.user._id.toString(),
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        role: req.user.role,
        status: req.user.status,
        joinedAt: req.user.joinedAt,
      },
      stats: {
        enrolled: courses.length,
        inProgress,
        completed,
        certificates: completed,
      },
      courses,
    });
  })
);

/* ------------------------------------------------------------------ */
/* POST /api/student/enroll - self-enroll (password-verified)           */
/* Body: { courseId: <course id or slug>, password }                    */
/* ------------------------------------------------------------------ */
router.post(
  '/enroll',
  validate({
    courseId: { type: 'string', min: 1, max: 200 },
    password: { type: 'password' },
  }),
  asyncHandler(async (req, res) => {
    // Small verification: the student re-enters their own password.
    const user = await User.findById(req.user._id).select('+password');
    if (!(await user.comparePassword(req.body.password))) {
      throw ApiError.unauthorized('Incorrect password. Please try again.');
    }

    const course = await findCourse(req.body.courseId);
    if (!course) throw ApiError.notFound('Course not found');

    const existing = await Enrollment.findOne({ user: user._id, course: course._id });
    if (existing) {
      return res.json({
        ok: true,
        alreadyEnrolled: true,
        message: 'You are already enrolled in this course.',
        enrollment: existing.toDashboard(course),
      });
    }

    const enrollment = await Enrollment.create({
      user: user._id,
      course: course._id,
      // Keep the ambassador referral on the enrollment (drives Rewards PKR).
      referredBy: user.referredBy || null,
    });
    res.status(201).json({
      ok: true,
      message: `Enrolled in ${course.title}!`,
      enrollment: enrollment.toDashboard(course),
    });
  })
);

/* ------------------------------------------------------------------ */
/* GET /api/student/enrollment/:courseId - this student's own progress  */
/* ------------------------------------------------------------------ */
router.get(
  '/enrollment/:courseId',
  asyncHandler(async (req, res) => {
    const course = await findCourse(req.params.courseId);
    if (!course) throw ApiError.notFound('Course not found');

    const enrollment = await Enrollment.findOne({ user: req.user._id, course: course._id });
    if (!enrollment) return res.json({ ok: true, enrolled: false, enrollment: null });

    res.json({
      ok: true,
      enrolled: true,
      enrollment: {
        id: enrollment._id.toString(),
        courseId: course._id.toString(),
        slug: course.slug,
        title: course.title,
        progress: enrollment.progress,
        status: enrollment.status,
        readingSeconds: enrollment.readingSeconds || 0,
        requiredSeconds: REQUIRED_READING_SECONDS,
        completedAt: enrollment.completedAt,
      },
    });
  })
);

/* ------------------------------------------------------------------ */
/* POST /api/student/reading - reading heartbeat                        */
/* Body: { courseId }                                                   */
/*                                                                      */
/* The student's page pings this while reading. The server credits only */
/* the real time since the previous ping (capped), so a certificate     */
/* cannot be unlocked faster than the reading requirement.              */
/* ------------------------------------------------------------------ */
router.post(
  '/reading',
  validate({ courseId: { type: 'string', min: 1, max: 200 } }),
  asyncHandler(async (req, res) => {
    const course = await findCourse(req.body.courseId);
    if (!course) throw ApiError.notFound('Course not found');

    const enrollment = await Enrollment.findOne({ user: req.user._id, course: course._id });
    if (!enrollment) throw ApiError.forbidden('Enroll in this course first');

    const now = Date.now();
    const elapsed = enrollment.lastReadingAt
      ? Math.min(Math.max((now - enrollment.lastReadingAt.getTime()) / 1000, 0), 30)
      : 0;

    enrollment.lastReadingAt = new Date(now);
    enrollment.readingSeconds = (enrollment.readingSeconds || 0) + elapsed;
    enrollment.recomputeReadingProgress();
    enrollment.lastAccessedAt = new Date(now);
    await enrollment.save();

    res.json({
      ok: true,
      progress: enrollment.progress,
      status: enrollment.status,
      readingSeconds: enrollment.readingSeconds,
      requiredSeconds: REQUIRED_READING_SECONDS,
      completedAt: enrollment.completedAt,
      certificateReady: enrollment.status === 'completed',
    });
  })
);

/* ------------------------------------------------------------------ */
/* GET /api/student/certificate/:courseId - only once the course is 100% */
/* ------------------------------------------------------------------ */
router.get(
  '/certificate/:courseId',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, certificate: await loadCertificate(req) });
  })
);

/* ------------------------------------------------------------------ */
/* GET /api/student/certificate/:courseId/pdf - the certificate as a    */
/* real, downloadable PDF file.                                         */
/* ------------------------------------------------------------------ */
router.get(
  '/certificate/:courseId/pdf',
  asyncHandler(async (req, res) => {
    const certificate = await loadCertificate(req);
    const pdf = buildCertificatePdf(certificate);
    const safeId = certificate.id.replace(/[^A-Za-z0-9._-]/g, '');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Physioprisma-Certificate-${safeId}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  })
);

module.exports = router;
