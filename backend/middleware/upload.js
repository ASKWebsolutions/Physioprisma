'use strict';

const multer = require('multer');
const { ApiError } = require('./error');
const { env } = require('../config/env');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB (Cloudinary Free allows 10 MB)
const MAX_VIDEO_BYTES = env.cloudinary.maxVideoMB * 1024 * 1024; // MAX_VIDEO_MB, default 100 (Free plan cap)
const MAX_DOC_BYTES = 25 * 1024 * 1024; // course resource files (pdf / docx / pptx / zip ...)

const IMAGE_RE = /^image\/(jpe?g|png|webp|gif|avif)$/i;
const VIDEO_RE = /^video\/(mp4|webm|quicktime|x-m4v)$/i;
// Course files: documents, spreadsheets, slides, plain text and archives.
const DOC_RE =
  /^(application\/(pdf|zip|x-zip-compressed|rtf|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))|text\/(plain|csv))$/i;

/** In-memory storage: files are streamed straight to Cloudinary, never touched on disk. */
const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (IMAGE_RE.test(file.mimetype) || VIDEO_RE.test(file.mimetype)) return cb(null, true);
  return cb(ApiError.badRequest(`Unsupported file type "${file.mimetype}". Use an image (jpg, png, webp) or video (mp4, webm).`));
}

function docFileFilter(req, file, cb) {
  if (DOC_RE.test(file.mimetype)) return cb(null, true);
  return cb(
    ApiError.badRequest(
      `Unsupported file type "${file.mimetype}". Use a PDF, Word, Excel, PowerPoint, text or ZIP file.`
    )
  );
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

/** Same in-memory storage for course resource files (documents only). */
const docUpload = multer({
  storage,
  fileFilter: docFileFilter,
  limits: {
    fileSize: MAX_DOC_BYTES,
    files: 5,
    fields: 30,
  },
});

/** Reject oversized images early (multer's single limit covers videos). */
function assertImageSize(file) {
  if (file && file.size > MAX_IMAGE_BYTES) {
    throw ApiError.badRequest(`Image "${file.originalname}" is larger than 8 MB`);
  }
}

/** Reject oversized course files early (multipart path only). */
function assertDocSize(file) {
  if (file && file.size > MAX_DOC_BYTES) {
    throw ApiError.badRequest(`File "${file.originalname}" is larger than 25 MB`);
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

module.exports = {
  upload,
  docUpload,
  assertImageSize,
  assertDocSize,
  directAsset,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_DOC_BYTES,
};
