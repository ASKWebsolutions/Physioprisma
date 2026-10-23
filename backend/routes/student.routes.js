'use strict';

const express = require('express');

const User = require('../models/User.model');
const Course = require('../models/Course.model');
const Enrollment = require('../models/Enrollment.model');
const Quiz = require('../models/Quiz.model');
const { requiredSecondsFor, requiredStudySeconds } = require('../models/Enrollment.model');
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

/**
 * How many of the course's published quizzes this enrollment has passed.
 * Feeds the 80/20 combined progress rule.
 */
async function quizSummary(courseId, enrollment) {
  const total = await Quiz.countDocuments({ course: courseId, published: true });
  const best = (enrollment && enrollment.quizBest) || {};
  const passed = Object.values(best).filter((b) => b && b.passed).length;
  return { total, passed: Math.min(passed, total) };
}

/** Recompute + persist the combined progress for this enrollment. */
async function refreshProgress(enrollment, course) {
  const { total, passed } = await quizSummary(course._id, enrollment);
  enrollment.recomputeCombinedProgress(course, total, passed);
  enrollment.lastAccessedAt = new Date();
  await enrollment.save();
  return { total, passed };
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
        rollNo: req.user.rollNo || '',
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

    // Paid courses are purchased on WhatsApp - only the admin adds them to an
    // account after the payment comes through.
    if (course.price > 0) {
      throw ApiError.forbidden(
        `This is a paid course (Rs ${course.price}). Purchase it first - after payment the admin will add it to your account.`
      );
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

    // Keep the stored progress in sync with the latest curriculum/quizzes.
    await refreshProgress(enrollment, course);
    const { total, passed } = await quizSummary(course._id, enrollment);

    const lessonSeconds = enrollment.lessonSeconds || {};
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
        requiredSeconds: requiredStudySeconds(course),
        creditHours: course.creditHours || 0,
        completedAt: enrollment.completedAt,
        // Per-lesson state for the left-hand track.
        completedLessons: enrollment.completedLessons || [],
        lessonSeconds,
        // Quiz tallies for the 80/20 rule.
        quizzesTotal: total,
        quizzesPassed: passed,
      },
    });
  })
);

/* ------------------------------------------------------------------ */
/* POST /api/student/reading - study heartbeat                          */
/* Body: { courseId, lessonId? }                                        */
/*                                                                      */
/* The student's page pings this while reading. The server credits only */
/* the real time since the previous ping (capped), so a certificate     */
/* cannot be unlocked faster than the reading requirement.              */
/*                                                                      */
/* With lessonId the seconds go to that specific lesson's clock and the  */
/* lesson ticks to done on the left-hand track once minutes x 60 is met.*/
/* Without it, the legacy whole-course reading clock runs instead.      */
/* ------------------------------------------------------------------ */
router.post(
  '/reading',
  validate({
    courseId: { type: 'string', min: 1, max: 200 },
    lessonId: { type: 'string', min: 1, max: 64, required: false },
  }),
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
    enrollment.addStudySeconds(course, req.body.lessonId || null, elapsed);
    const { total, passed } = await quizSummary(course._id, enrollment);
    enrollment.recomputeCombinedProgress(course, total, passed);
    enrollment.lastAccessedAt = new Date(now);
    await enrollment.save();

    // Per-lesson progress so the reader can show "4:12 / 10:00".
    let lessonState = null;
    if (req.body.lessonId) {
      const lid = String(req.body.lessonId);
      let lesson = null;
      (course.modules || []).forEach((m) => (m.lessons || []).forEach((l) => {
        if (l._id.toString() === lid) lesson = l;
      }));
      if (lesson) {
        const need = (Number(lesson.minutes) || 10) * 60;
        lessonState = {
          lessonId: lid,
          seconds: Math.min(Number((enrollment.lessonSeconds || {})[lid]) || 0, need),
          required: need,
          done: (enrollment.completedLessons || []).includes(lid),
        };
      }
    }

    res.json({
      ok: true,
      progress: enrollment.progress,
      status: enrollment.status,
      readingSeconds: enrollment.readingSeconds || 0,
      requiredSeconds: requiredStudySeconds(course),
      creditHours: course.creditHours || 0,
      completedAt: enrollment.completedAt,
      completedLessons: enrollment.completedLessons || [],
      quizzesTotal: total,
      quizzesPassed: passed,
      lesson: lessonState,
      certificateReady: enrollment.status === 'completed',
    });
  })
);

/* ------------------------------------------------------------------ */
/* GET /api/student/courses/:courseId/quizzes - take-home quiz list     */
/* (never includes the correct answers; best score attached)            */
/* ------------------------------------------------------------------ */
router.get(
  '/courses/:courseId/quizzes',
  asyncHandler(async (req, res) => {
    const course = await findCourse(req.params.courseId);
    if (!course) throw ApiError.notFound('Course not found');

    const enrollment = await Enrollment.findOne({ user: req.user._id, course: course._id });
    if (!enrollment) throw ApiError.forbidden('Enroll in this course first');

    const quizzes = await Quiz.find({ course: course._id, published: true }).sort({ createdAt: 1 });
    const best = enrollment.quizBest || {};
    res.json({
      ok: true,
      quizzes: quizzes.map((q) => q.toStudent(best[q._id.toString()] || null)),
    });
  })
);

/* ------------------------------------------------------------------ */
/* POST /api/student/quizzes/:quizId/submit - grade an attempt          */
/* Body: { answers: [<optionIndex per question id order>] }             */
/* Unlimited tries: only the best score is kept.                        */
/* ------------------------------------------------------------------ */
router.post(
  '/quizzes/:quizId/submit',
  validate({ answers: { type: 'array', required: false } }),
  asyncHandler(async (req, res) => {
    const quiz = await Quiz.findById(req.params.quizId);
    if (!quiz || !quiz.published) throw ApiError.notFound('Quiz not found');

    const course = await findCourse(quiz.course.toString());
    if (!course) throw ApiError.notFound('Course not found');

    const enrollment = await Enrollment.findOne({ user: req.user._id, course: course._id });
    if (!enrollment) throw ApiError.forbidden('Enroll in this course first');

    const questions = quiz.questions || [];
    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
    if (answers.length !== questions.length) {
      throw ApiError.badRequest(`Please answer all ${questions.length} question(s)`);
    }

    let correct = 0;
    questions.forEach((q, i) => {
      const pick = Number(answers[i]);
      if (Number.isInteger(pick) && pick === q.correct) correct += 1;
    });
    const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;
    const passed = score >= quiz.passPercent;

    const qid = quiz._id.toString();
    const prev = (enrollment.quizBest && enrollment.quizBest[qid]) || null;
    if (!prev || score >= prev.score) {
      if (!enrollment.quizBest || typeof enrollment.quizBest !== 'object') enrollment.quizBest = {};
      enrollment.quizBest[qid] = { score, passed, attempts: (prev && prev.attempts ? prev.attempts : 0) + 1 };
    } else {
      enrollment.quizBest[qid] = { ...prev, attempts: (prev.attempts || 0) + 1 };
    }
    // quizBest is a Mixed map - without this the scores never reach the DB.
    enrollment.markModified('quizBest');

    const { total, passed: passedCount } = await quizSummary(course._id, enrollment);
    enrollment.recomputeCombinedProgress(course, total, passedCount);
    enrollment.lastAccessedAt = new Date();
    await enrollment.save();

    res.json({
      ok: true,
      result: { score, correct, total: questions.length, passed, passPercent: quiz.passPercent },
      best: enrollment.quizBest[qid],
      enrollment: {
        progress: enrollment.progress,
        status: enrollment.status,
        quizzesTotal: total,
        quizzesPassed: passedCount,
        completedLessons: enrollment.completedLessons || [],
        certificateReady: enrollment.status === 'completed',
      },
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
