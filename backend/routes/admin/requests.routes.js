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
  ambassadorStatus: u.ambassadorStatus || 'none',
  referralCode: u.referralCode || null,
  joined: u.joinedAt,
  lastLoginAt: u.lastLoginAt,
});

/* GET /api/admin/requests?status=pending|approved                          */
/* Every ambassador application, whether it belongs to a standalone          */
/* ambassador account (role) or to a student who applied on the same        */
/* account (ambassadorStatus).                                              */
router.get(
  '/',
  validate({ status: { type: 'string', required: false, max: 20 } }),
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.status === 'pending') {
      filter.$or = [{ ambassadorStatus: 'pending' }, { role: 'ambassador', status: 'pending' }];
    } else if (req.query.status === 'approved') {
      filter.$or = [{ ambassadorStatus: 'active' }, { role: 'ambassador', status: 'active' }];
    } else {
      filter.$or = [{ role: 'ambassador' }, { ambassadorStatus: { $ne: 'none' } }];
    }

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
    const standalone = user && user.role === 'ambassador';
    // Standalone ambassador accounts, or students who also applied.
    if (!user || (!standalone && user.ambassadorStatus === 'none')) {
      throw ApiError.notFound('Application not found');
    }

    if (standalone) {
      // The whole account follows the decision (old behaviour).
      user.status = req.body.status;
      user.ambassadorStatus =
        req.body.status === 'active' ? 'active' : req.body.status === 'rejected' ? 'rejected' : 'pending';
    } else {
      // A "both" account: only the ambassador capability changes - the
      // student keeps their login, roll no, courses and certificates.
      if (req.body.status === 'suspended') {
        throw ApiError.badRequest('To suspend this account, use the Users tab');
      }
      user.ambassadorStatus = req.body.status; // active | rejected | pending
    }

    if (user.ambassadorStatus === 'active') {
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
