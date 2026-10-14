'use strict';

const express = require('express');
const crypto = require('crypto');

const { env } = require('../../config/env');
const { cloudinary } = require('../../config/cloudinary');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { validate } = require('../../utils/validate');

const router = express.Router();

/* ==================================================================== */
/* POST /api/admin/uploads/sign - signed direct upload to Cloudinary    */
/*                                                                       */
/* Vercel rejects request bodies over 4.5 MB, so big videos cannot be    */
/* proxied through this API. Instead the browser fetches a short-lived    */
/* signature here and posts the file straight to Cloudinary.             */
/* ==================================================================== */
router.post(
  '/sign',
  validate({
    folder: { type: 'string', max: 200, required: false },
    resourceType: { type: 'enum', values: ['image', 'video', 'auto'], required: false },
    prefix: { type: 'string', max: 80, required: false },
  }),
  asyncHandler(async (req, res) => {
    if (!env.cloudinary.configured) {
      throw ApiError.badRequest('Cloudinary is not configured on this server');
    }

    const resourceType = req.body.resourceType || 'image';
    const folder = String(req.body.folder || 'physioprisma')
      .replace(/[^a-zA-Z0-9/_-]/g, '-')
      .replace(/^\/+|\/+$/g, '')
      .slice(0, 180) || 'physioprisma';

    const prefix = String(req.body.prefix || 'asset')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/^\.+/, '')
      .slice(0, 60) || 'asset';
    const publicId = `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

    const timestamp = Math.round(Date.now() / 1000);
    // Only public_id + timestamp are signed, and both are sent back verbatim
    // by the browser (the folder is already part of the public_id).
    const fullPublicId = `${folder}/${publicId}`;
    const params = { public_id: fullPublicId, timestamp };
    const signature = cloudinary.utils.api_sign_request(params, env.cloudinary.apiSecret);

    res.json({
      ok: true,
      cloudName: env.cloudinary.cloudName,
      apiKey: env.cloudinary.apiKey,
      uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/${resourceType}/upload`,
      timestamp,
      signature,
      folder,
      publicId: fullPublicId,
      maxVideoMB: env.cloudinary.maxVideoMB,
    });
  })
);

module.exports = router;
