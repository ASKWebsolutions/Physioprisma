'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const User = require('../models/User.model');
const { validate } = require('../utils/validate');
const { asyncHandler, ApiError } = require('../middleware/error');
const { signToken, protect } = require('../middleware/auth');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* Rate limiting - brute force protection on credential endpoints      */
/* ------------------------------------------------------------------ */
// Shared by login + password change. 60 attempts / 15 min per IP is still a
// hard stop for brute forcing, but leaves room for a family of devices (and
// for the smoke suite, which logs in several times per run).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many attempts. Please wait 15 minutes and try again.' },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many signups from this network. Please try again later.' },
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Status gate: only active accounts receive a token. */
function issueSession(user) {
  if (user.status === 'pending') {
    const isAmbassador = user.role === 'ambassador';
    throw new ApiError(
      403,
      isAmbassador
        ? 'Your ambassador application is waiting for admin approval.'
        : 'Your account is waiting for admin approval.'
    ).withCode('PENDING');
  }
  if (user.status === 'suspended') throw new ApiError(403, 'This account has been suspended.').withCode('SUSPENDED');
  if (user.status === 'rejected') {
    throw new ApiError(403, 'This application was rejected. Please contact support.').withCode('REJECTED');
  }

  user.lastLoginAt = new Date();
  return { token: signToken(user), user: user.toPublic() };
}

/** Optional referral capture: silently ignored when unknown. */
async function resolveReferrer(code) {
  const cleaned = String(code || '').trim().toUpperCase();
  if (!cleaned || cleaned.length > 20) return null;
  const referrer = await User.findOne({ referralCode: cleaned, role: 'ambassador' }).select('_id');
  return referrer ? cleaned : null;
}

/* ------------------------------------------------------------------ */
/* POST /api/auth/register - student self-registration                 */
/* ------------------------------------------------------------------ */
router.post(
  '/register',
  signupLimiter,
  validate({
    name: { type: 'string', min: 2, max: 120 },
    email: { type: 'email', max: 254 },
    phone: { type: 'phone', max: 30 },
    password: { type: 'password' },
    ref: { type: 'string', required: false, max: 20 },
  }),
  asyncHandler(async (req, res) => {
    const { name, email, phone, password, ref } = req.body;

    const existing = await User.findOne({ email: email.toLowerCase() }).select('_id status');
    if (existing) throw ApiError.conflict('An account with this email already exists');

    const user = new User({
      name,
      email,
      phone,
      password,
      role: 'student',
      status: 'pending',
      referredBy: await resolveReferrer(ref),
    });
    await user.save();

    res.status(201).json({
      ok: true,
      message: 'Account created! It will be active after admin approval.',
      requiresApproval: true,
    });
  })
);

/* ------------------------------------------------------------------ */
/* POST /api/auth/apply - ambassador application                       */
/* ------------------------------------------------------------------ */
router.post(
  '/apply',
  signupLimiter,
  validate({
    name: { type: 'string', min: 2, max: 120 },
    email: { type: 'email', max: 254 },
    phone: { type: 'phone', max: 30 },
    city: { type: 'string', min: 2, max: 80 },
    password: { type: 'password' },
  }),
  asyncHandler(async (req, res) => {
    const { name, email, phone, city, password } = req.body;

    const existing = await User.findOne({ email: email.toLowerCase() }).select('_id status');
    if (existing) throw ApiError.conflict('An account with this email already exists');

    const user = new User({
      name,
      email,
      phone,
      city,
      password,
      role: 'ambassador',
      status: 'pending',
    });
    await user.save();

    res.status(201).json({
      ok: true,
      message: 'Application submitted - it will be active after admin approval!',
      requiresApproval: true,
    });
  })
);

/* ------------------------------------------------------------------ */
/* POST /api/auth/login - shared by students, ambassadors and admin    */
/* ------------------------------------------------------------------ */
router.post(
  '/login',
  authLimiter,
  validate({
    identity: { type: 'string', min: 3, max: 254 }, // email or phone
    password: { type: 'password' },
    role: { type: 'string', required: false, max: 20 }, // optional expectation
  }),
  asyncHandler(async (req, res) => {
    const { identity, password, role } = req.body;
    const identityLower = identity.toLowerCase();

    const isEmail = identity.includes('@');
    const query = isEmail ? { email: identityLower } : { phone: identity };

    const user = await User.findOne(query).select('+password');
    // Constant-ish response: never reveal which field was wrong
    if (!user || !(await user.comparePassword(password))) {
      throw ApiError.unauthorized('Invalid credentials');
    }

    if (role && user.role !== role) {
      throw ApiError.forbidden(`These credentials do not belong to a ${role} account`);
    }

    const session = issueSession(user);
    res.json({ ok: true, ...session });
  })
);

/* ------------------------------------------------------------------ */
/* GET /api/auth/me - current session                                  */
/* ------------------------------------------------------------------ */
router.get(
  '/me',
  protect,
  asyncHandler(async (req, res) => {
    res.json({ ok: true, user: req.user.toPublic() });
  })
);

/* ------------------------------------------------------------------ */
/* POST /api/auth/logout - stateless; client drops the token           */
/* ------------------------------------------------------------------ */
router.post('/logout', (req, res) => {
  res.json({ ok: true, message: 'Logged out' });
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/password - change own password                       */
/* ------------------------------------------------------------------ */
router.post(
  '/password',
  protect,
  validate({
    currentPassword: { type: 'password' },
    newPassword: { type: 'password' },
  }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    if (!(await user.comparePassword(currentPassword))) {
      throw ApiError.unauthorized('Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw ApiError.badRequest('New password must be different from the current one');
    }

    user.password = newPassword;
    await user.save();
    res.json({ ok: true, message: 'Password updated' });
  })
);

module.exports = router;
