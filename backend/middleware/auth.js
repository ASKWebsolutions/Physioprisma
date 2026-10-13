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

/** Role gate: requireRole('admin') or requireRole('student','ambassador'). */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
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

module.exports = { signToken, protect, requireRole, requireActive };
