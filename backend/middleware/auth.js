'use strict';

const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { ApiError, asyncHandler } = require('./error');
const User = require('../models/User.model');

const BEARER = /^Bearer\s+(.+)$/i;

/** Create a signed JWT for a user (id + role + status only - no PII in tokens). */
function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, status: user.status },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

function readToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(BEARER);
  if (match) return match[1];
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
}

/**
 * Require a valid token. Attaches `req.user` (fresh from DB so role/status
 * changes take effect immediately, e.g. admin suspends a user mid-session).
 */
const protect = asyncHandler(async (req, res, next) => {
  const token = readToken(req);
  if (!token) throw ApiError.unauthorized('Please log in to continue');

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch (err) {
    throw err.name === 'TokenExpiredError'
      ? ApiError.unauthorized('Session expired, please log in again')
      : ApiError.unauthorized('Invalid session token');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  if (user.status === 'suspended') throw ApiError.forbidden('This account has been suspended');
  if (user.status === 'rejected') throw ApiError.forbidden('This application was rejected');

  req.user = user;
  req.tokenPayload = payload;
  next();
});

/**
 * Best-effort identity for public endpoints: returns the signed-in user when
 * a valid token is attached, or null otherwise - never throws. Used by the
 * public course detail so paid materials can check the viewer's enrollment.
 */
async function optionalUser(req) {
  const token = readToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(payload.sub);
    if (user && user.status !== 'suspended' && user.status !== 'rejected') return user;
  } catch (err) {
    /* invalid/expired token simply means "guest" */
  }
  return null;
}

/** Role gate: requireRole('admin') or requireRole('student','ambassador').
 *  Uses the model's hasRole() so one account can hold several roles
 *  (e.g. a student who was also approved as an ambassador). */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.some((role) => (typeof req.user.hasRole === 'function' ? req.user.hasRole(role) : req.user.role === role))) {
      return next(ApiError.forbidden('You do not have permission to do that'));
    }
    return next();
  };
}

/** Convenience: user must be authenticated AND approved (status active). */
function requireActive(req, res, next) {
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.status !== 'active') {
    return next(ApiError.forbidden('Your account is awaiting admin approval'));
  }
  return next();
}

module.exports = { signToken, protect, requireRole, requireActive, optionalUser };
