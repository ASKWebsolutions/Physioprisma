'use strict';

const { env } = require('../config/env');

/** Structured API error with an HTTP status code. */
class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = undefined;
    Error.captureStackTrace(this, this.constructor);
  }

  /** Machine readable error code (e.g. PENDING, SUSPENDED) for the frontend. */
  withCode(code) {
    this.code = code;
    return this;
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message);
  }
  static forbidden(message = 'You do not have permission to do that') {
    return new ApiError(403, message);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }
  static conflict(message = 'Already exists') {
    return new ApiError(409, message);
  }
  static tooMany(message = 'Too many requests') {
    return new ApiError(429, message);
  }
  static internal(message = 'Something went wrong') {
    return new ApiError(500, message);
  }
}

/** Wrap async route handlers so rejections reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** 404 handler - JSON for the API, minimal HTML page for site routes. */
function notFound(req, res, next) {
  if (req.originalUrl.startsWith('/api')) {
    return next(ApiError.notFound(`Unknown API route: ${req.method} ${req.originalUrl}`));
  }
  res
    .status(404)
    .type('html')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found - Physioprisma</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#1f2937}.box{text-align:center;padding:32px}h1{font-size:64px;margin:0;background:linear-gradient(135deg,#6b21a8,#0ea5e9);-webkit-background-clip:text;background-clip:text;color:transparent}a{display:inline-block;margin-top:16px;padding:12px 28px;border-radius:999px;background:linear-gradient(135deg,#6b21a8,#0ea5e9);color:#fff;text-decoration:none;font-weight:600}</style></head><body><div class="box"><h1>404</h1><p>The page you are looking for does not exist.</p><a href="/home.html">Back to Home</a></div></body></html>`
    );
}

/** Convert known library errors to ApiError, then emit a consistent JSON envelope. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;

  if (err.name === 'ValidationError' && err.errors) {
    error = ApiError.badRequest(Object.values(err.errors).map((e) => e.message).join('; '));
  } else if (err.name === 'CastError') {
    error = ApiError.badRequest(`Invalid value for "${err.path}"`);
  } else if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    error = ApiError.conflict(`That ${field} is already in use`);
  } else if (err.name === 'JsonWebTokenError') {
    error = ApiError.unauthorized('Invalid session token');
  } else if (err.name === 'TokenExpiredError') {
    error = ApiError.unauthorized('Session expired, please log in again');
  } else if (err.name === 'MulterError') {
    error =
      err.code === 'LIMIT_FILE_SIZE'
        ? ApiError.badRequest(`File is too large (max ${env.cloudinary.maxVideoMB} MB for video, 8 MB for images)`)
        : ApiError.badRequest(`Upload error: ${err.message}`);
  } else if (err.type === 'entity.too.large') {
    error = ApiError.badRequest('Payload too large');
  }

  if (!(error instanceof ApiError)) {
    console.error('[error] Unhandled:', err);
    error = ApiError.internal(envSafeMessage(err));
  }

  res.status(error.statusCode).json({
    ok: false,
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.details ? { details: error.details } : {}),
    ...(process.env.NODE_ENV !== 'production' && error.statusCode === 500 && err.stack
      ? { stack: err.stack.split('\n').slice(0, 4) }
      : {}),
  });
}

function envSafeMessage(err) {
  return process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message || 'Something went wrong';
}

module.exports = { ApiError, asyncHandler, notFound, errorHandler };
