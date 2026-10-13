'use strict';

const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const { env } = require('./env');
const { saveLocal, removeLocal } = require('../storage/local');

if (env.cloudinary.configured) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
} else {
  console.warn(
    '[cloudinary] Credentials missing - uploads are stored locally in backend/uploads until CLOUDINARY_* is set in backend/.env'
  );
}

/**
 * Upload a Buffer. Uses Cloudinary when configured, otherwise falls back to
 * local storage so the admin can keep posting while keys are pending.
 * Both paths return the same shape, so callers never need to care.
 *
 * @param {Buffer} buffer
 * @param {{folder?:string, resourceType?:'image'|'video'|'auto', filename?:string}} options
 * @returns {Promise<{url:string, publicId:string, bytes:number, format:string, local?:boolean}>}
 */
function uploadBuffer(buffer, { folder = 'physioprisma', resourceType = 'image', filename } = {}) {
  if (!env.cloudinary.configured) {
    return saveLocal(buffer, { folder, filename, resourceType });
  }

  return new Promise((resolve, reject) => {
    // Every upload gets its own public_id. Callers replace an asset by
    // uploading a new one and then destroying the old publicId, so the two
    // must never collide - otherwise a fixed id would either be rejected
    // (overwrite: false) or the destroy below would remove the new asset.
    const base = String(filename || 'asset').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60) || 'asset';
    const publicId = `${base}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        public_id: publicId,
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          bytes: result.bytes,
          format: result.format,
          local: false,
        });
      }
    );
    stream.end(buffer);
  });
}

/**
 * Delete a previously uploaded asset. Cloudinary ids are destroyed remotely,
 * local files (empty publicId, /uploads/... url) are removed from disk.
 * Never throws.
 */
async function destroyAsset(publicId, resourceType = 'image', url = '') {
  // Local asset: publicId is empty and the url points at our own /uploads
  if (!publicId && url) return removeLocal(url);
  if (!env.cloudinary.configured || !publicId) return { result: 'skipped' };
  try {
    // invalidate purges the CDN copy, otherwise edge nodes keep serving the
    // deleted asset from cache for a while.
    const res = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
    return { result: res.result };
  } catch (error) {
    console.warn(`[cloudinary] Failed to delete ${publicId}: ${error.message}`);
    return { result: 'error' };
  }
}

/** Map an uploaded image/video to the shape stored in MongoDB. */
function toStoredAsset(upload, fallbackUrl = '') {
  if (!upload) return { url: fallbackUrl, publicId: '' };
  return { url: upload.url, publicId: upload.publicId };
}

module.exports = { cloudinary, uploadBuffer, destroyAsset, toStoredAsset };
