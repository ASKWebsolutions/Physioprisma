'use strict';

const express = require('express');

const User = require('../models/User.model');
const Enrollment = require('../models/Enrollment.model');
const { env } = require('../config/env');
const { asyncHandler } = require('../middleware/error');
const { protect, requireRole, requireActive } = require('../middleware/auth');

const router = express.Router();

/* Everything under /api/ambassador is for the signed-in, approved ambassador only. */
router.use(protect, requireRole('ambassador'), requireActive);

/* ------------------------------------------------------------------ */
/* GET /api/ambassador/dashboard - this ambassador's own referral data */
/* ------------------------------------------------------------------ */
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const code = req.user.referralCode || '';

    // Students who signed up with this ambassador's code (?ref=CODE)
    const referred = code
      ? await User.find({ referredBy: code }).sort({ createdAt: -1 }).limit(500)
      : [];

    // Every enrollment made by those students (drives Rewards PKR)
    const enrollments = referred.length
      ? await Enrollment.find({ user: { $in: referred.map((u) => u._id) } })
          .populate('course', 'title')
          .sort({ createdAt: -1 })
      : [];

    // Newest enrollment per referred student (for the course column)
    const latestByUser = new Map();
    for (const e of enrollments) {
      const key = String(e.user);
      if (!latestByUser.has(key)) latestByUser.set(key, e);
    }

    const referrals = referred.map((u) => {
      const e = latestByUser.get(String(u._id));
      return {
        id: u._id.toString(),
        name: u.name,
        course: e && e.course ? e.course.title : '',
        date: u.joinedAt,
        status: e ? 'Enrolled' : 'Pending',
      };
    });

    const enrolledCount = referrals.filter((r) => r.status === 'Enrolled').length;
    const rewardPerEnrollment = env.rewardPerEnrollment;
    // Rewards are earned per enrollment, not per referred student.
    const earned = enrollments.length * rewardPerEnrollment;

    res.json({
      ok: true,
      user: {
        id: req.user._id.toString(),
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        city: req.user.city,
        status: req.user.status,
        joinedAt: req.user.joinedAt,
      },
      referralCode: code,
      rewardPerEnrollment,
      stats: {
        total: referrals.length,
        enrolled: enrolledCount,
        pending: referrals.length - enrolledCount,
        enrollments: enrollments.length,
        earned,
      },
      referrals,
    });
  })
);

module.exports = router;
