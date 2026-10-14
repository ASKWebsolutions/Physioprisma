'use strict';

const express = require('express');

const User = require('../../models/User.model');
const Enrollment = require('../../models/Enrollment.model');
const ContactMessage = require('../../models/ContactMessage.model');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { validate } = require('../../utils/validate');

const router = express.Router();

const publicUser = (u) => ({
  id: u._id.toString(),
  rollNo: u.rollNo || '',
  name: u.name,
  email: u.email,
  phone: u.phone,
  city: u.city,
  role: u.role,
  status: u.status,
  referralCode: u.referralCode || null,
  joined: u.joinedAt,
  lastLoginAt: u.lastLoginAt,
});

/* GET /api/admin/students?q=                                                */
router.get(
  '/',
  validate({ q: { type: 'string', required: false, max: 100 } }),
  asyncHandler(async (req, res) => {
    const q = (req.query.q || '').trim();
    const filter = { role: 'student' };
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { rollNo: { $regex: q, $options: 'i' } },
      ];
    }

    const students = await User.find(filter).sort({ createdAt: -1 }).limit(500);

    const enrollments = await Enrollment.find({ user: { $in: students.map((s) => s._id) } })
      .populate('course', 'title')
      .sort({ createdAt: -1 });

    const byUser = new Map();
    for (const e of enrollments) {
      const key = String(e.user);
      if (!byUser.has(key)) byUser.set(key, e);
    }

    res.json({
      ok: true,
      students: students.map((s) => {
        const e = byUser.get(String(s._id));
        return {
          ...publicUser(s),
          course: e && e.course ? e.course.title : '',
          progress: e ? e.progress : 0,
        };
      }),
    });
  })
);

/* POST /api/admin/students - admin creates a ready-to-login student          */
router.post(
  '/',
  validate({
    name: { type: 'string', min: 2, max: 120 },
    email: { type: 'email', max: 254 },
    phone: { type: 'phone', max: 30 },
    password: { type: 'password' },
    city: { type: 'string', required: false, max: 80 },
  }),
  asyncHandler(async (req, res) => {
    const { name, email, phone, password } = req.body;
    const city = (req.body.city || '').trim();

    const existing = await User.findOne({ email: email.toLowerCase() }).select('_id');
    if (existing) throw ApiError.conflict('An account with this email already exists');

    // Created straight as active so the student can sign in with these
    // credentials - no approval step needed.
    const user = new User({
      name,
      email,
      phone,
      city,
      password,
      role: 'student',
      status: 'active',
      approvedAt: new Date(),
      joinedAt: new Date(),
    });
    await user.save();

    res.status(201).json({
      ok: true,
      message: 'Student created',
      student: publicUser(user),
      // Shown once so the admin can hand the login details to the student.
      credentials: { name: user.name, email: user.email, phone: user.phone, password },
    });
  })
);

/* GET /api/admin/students/track/:rollNo - one person's full track record     */
router.get(
  '/track/:rollNo',
  asyncHandler(async (req, res) => {
    const rollNo = String(req.params.rollNo || '').trim().toUpperCase();
    const student = await User.findOne({ rollNo, role: 'student' });
    if (!student) throw ApiError.notFound('No student found with roll number ' + rollNo);

    const contactFilter = { $or: [{ email: student.email }] };
    if (student.phone) contactFilter.$or.push({ phone: student.phone });

    const [enrollments, messages] = await Promise.all([
      Enrollment.find({ user: student._id }).populate('course', 'title slug image').sort({ createdAt: -1 }),
      ContactMessage.find(contactFilter).sort({ createdAt: -1 }).limit(50),
    ]);

    const courses = enrollments.map((e) => ({
      id: e._id.toString(),
      title: e.course ? e.course.title : 'Course',
      slug: e.course ? e.course.slug : '',
      image: e.course && e.course.image ? e.course.image.url || '' : '',
      progress: e.progress || 0,
      status: e.status,
      readingSeconds: e.readingSeconds || 0,
      referredBy: e.referredBy || null,
      enrolledAt: e.createdAt,
      lastAccessedAt: e.lastAccessedAt,
      completedAt: e.completedAt,
    }));

    const completed = courses.filter((c) => c.status === 'completed').length;
    const timeline = [
      { icon: 'fa-user-plus', label: 'Account created', at: student.joinedAt },
      ...(student.approvedAt ? [{ icon: 'fa-circle-check', label: 'Account activated', at: student.approvedAt }] : []),
      ...(student.lastLoginAt ? [{ icon: 'fa-right-to-bracket', label: 'Last login', at: student.lastLoginAt }] : []),
      ...courses.map((c) => ({
        icon: 'fa-book-open',
        label: 'Enrolled in ' + c.title,
        at: c.enrolledAt,
      })),
      ...courses
        .filter((c) => c.completedAt)
        .map((c) => ({ icon: 'fa-award', label: 'Completed ' + c.title, at: c.completedAt })),
      ...messages.map((m) => ({
        icon: 'fa-envelope',
        label: 'Sent a contact message' + (m.concern ? ' about ' + m.concern : ''),
        at: m.createdAt,
      })),
    ]
      .filter((item) => item.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at));

    const lastActivity = timeline.length ? timeline[0].at : student.lastLoginAt || student.joinedAt;

    res.json({
      ok: true,
      student: publicUser(student),
      enrollments: courses,
      messages: messages.map((m) => m.toPublic()),
      timeline,
      summary: {
        courses: courses.length,
        completed,
        inProgress: courses.length - completed,
        averageProgress: courses.length
          ? Math.round(courses.reduce((sum, c) => sum + (c.progress || 0), 0) / courses.length)
          : 0,
        messages: messages.length,
        lastLoginAt: student.lastLoginAt,
        lastActivityAt: lastActivity,
      },
    });
  })
);

/* PATCH /api/admin/students/:id { status } - approve / reject / suspend     */
router.patch(
  '/:id',
  validate({ status: { type: 'enum', values: ['active', 'suspended', 'pending', 'rejected'] } }),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'student') throw ApiError.notFound('Student not found');

    user.status = req.body.status;
    // Approving a registration opens the login gate for this student.
    if (req.body.status === 'active' && !user.approvedAt) user.approvedAt = new Date();
    await user.save();

    res.json({ ok: true, student: publicUser(user) });
  })
);

module.exports = router;
