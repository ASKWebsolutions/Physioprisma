'use strict';

const express = require('express');

const User = require('../../models/User.model');
const Enrollment = require('../../models/Enrollment.model');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { validate } = require('../../utils/validate');
const { uniqueReferralCode } = require('../../utils/referralCode');

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

/* GET /api/admin/users?q=&role=                                             */
router.get(
  '/',
  validate({ q: { type: 'string', required: false, max: 100 }, role: { type: 'string', required: false, max: 20 } }),
  asyncHandler(async (req, res) => {
    const q = (req.query.q || '').trim();
    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (q) {
      filter.$or = [{ name: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }];
    }
    const users = await User.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json({ ok: true, users: users.map(publicUser) });
  })
);

/* PATCH /api/admin/users/:id { status?, role? }                              */
router.patch(
  '/:id',
  validate({
    status: { type: 'enum', values: ['active', 'suspended', 'pending', 'rejected'], required: false },
    role: { type: 'enum', values: ['student', 'ambassador', 'admin'], required: false },
  }),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw ApiError.notFound('User not found');

    // Never let an admin lock themselves out of their own account
    if (String(user._id) === String(req.user._id) && (req.body.role || req.body.status !== 'active')) {
      throw ApiError.badRequest('You cannot change your own account here');
    }

    if (req.body.status) user.status = req.body.status;
    if (req.body.role) user.role = req.body.role;

    if (user.role === 'ambassador' && user.status === 'active' && !user.referralCode) {
      user.referralCode = await uniqueReferralCode(User, 'referralCode');
    }

    await user.save();
    res.json({ ok: true, user: publicUser(user) });
  })
);

/* DELETE /api/admin/users/:id                                               */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (String(req.params.id) === String(req.user._id)) {
      throw ApiError.badRequest('You cannot delete your own account');
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) throw ApiError.notFound('User not found');
    await Enrollment.deleteMany({ user: user._id });
    res.json({ ok: true, message: `${user.name} was removed` });
  })
);

module.exports = router;
