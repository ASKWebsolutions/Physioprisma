'use strict';

const express = require('express');

const User = require('../../models/User.model');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { validate } = require('../../utils/validate');
const { uniqueReferralCode } = require('../../utils/referralCode');

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

/* GET /api/admin/requests?status=pending|approved                          */
router.get(
  '/',
  validate({ status: { type: 'string', required: false, max: 20 } }),
  asyncHandler(async (req, res) => {
    const filter = { role: 'ambassador' };
    if (req.query.status === 'pending') filter.status = 'pending';
    else if (req.query.status === 'approved') filter.status = 'active';

    const users = await User.find(filter).sort({ createdAt: -1 });
    res.json({ ok: true, requests: users.map(publicUser) });
  })
);

/* PATCH /api/admin/requests/:id { status }                                  */
router.patch(
  '/:id',
  validate({ status: { type: 'enum', values: ['active', 'rejected', 'pending', 'suspended'] } }),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'ambassador') throw ApiError.notFound('Application not found');

    user.status = req.body.status;
    if (req.body.status === 'active') {
      user.approvedAt = new Date();
      // Ambassadors get their shareable code the moment they are approved
      if (!user.referralCode) {
        user.referralCode = await uniqueReferralCode(User, 'referralCode');
      }
    }
    await user.save();

    res.json({ ok: true, request: publicUser(user) });
  })
);

module.exports = router;
