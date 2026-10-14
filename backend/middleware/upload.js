'use strict';

const multer = require('multer');
const { ApiError } = require('./error');
const { env } = require('../config/env');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB (Cloudinary Free allows 10 MB)
const MAX_VIDEO_BYTES = env.cloudinary.maxVideoMB * 1024 * 1024; // MAX_VIDEO_MB, default 100 (Free plan cap)

const IMAGE_RE = /^image\/(jpe?g|png|webp|gif|avif)$/i;
const VIDEO_RE = /^video\/(mp4|webm|quicktime|x-m4v)$/i;

/** In-memory storage: files are streamed straight to Cloudinary, never touched on disk. */
const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (IMAGE_RE.test(file.mimetype) || VIDEO_RE.test(file.mimetype)) return cb(null, true);
  return cb(ApiError.badRequest(`Unsupported file type "${file.mimetype}". Use an image (jpg, png, webp) or video (mp4, webm).`));
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_VIDEO_BYTES, // refined per-field below
    files: 20,
    fields: 30,
  },
});

/** Reject oversized images early (multer's single limit covers videos). */
function assertImageSize(file) {
  if (file && file.size > MAX_IMAGE_BYTES) {
    throw ApiError.badRequest(`Image "${file.originalname}" is larger than 8 MB`);
  }
}

/**
 * An asset the browser already uploaded straight to Cloudinary (used on
 * Vercel, where request bodies over 4.5 MB are rejected - see
 * routes/admin/uploads.routes.js and PP.upload in frontend/js/api.js).
 *
 * Accepts the same endpoints as the multipart upload: send JSON
 * { url, publicId } instead of a file. Returns null when no direct asset
 * was sent so the caller can fall back to the uploaded file.
 */
function directAsset(req) {
  const body = req.body || {};
  const url = body.url ? String(body.url).trim() : '';
  const publicId = body.publicId ? String(body.publicId).trim() : '';
  // A direct upload always sends both. A bare {url} without a publicId is the
  // older "use an existing asset" mode (e.g. ./img/prism/01.jpg) and is left
  // to the caller.
  if (!url || !publicId) return null;
  if (!/^https:\/\//i.test(url)) {
    throw ApiError.badRequest('Direct upload URL must start with https://');
  }
  if (publicId.length > 300) throw ApiError.badRequest('publicId is too long');
  return { url, publicId };
}

module.exports = { upload, assertImageSize, directAsset, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES };
