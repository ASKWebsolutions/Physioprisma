'use strict';

const express = require('express');

const User = require('../../models/User.model');
const Enrollment = require('../../models/Enrollment.model');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { validate } = require('../../utils/validate');

const router = express.Router();

const publicUser = (u) => ({
  id: u._id.toString(),
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
