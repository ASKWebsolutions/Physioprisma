'use strict';

const express = require('express');

const TeamMember = require('../../models/Team.model');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { upload, assertImageSize, directAsset } = require('../../middleware/upload');
const { uploadBuffer, destroyAsset } = require('../../config/cloudinary');

const router = express.Router();

const MAX_MEMBERS = 60;

/** Normalise member fields from JSON or multipart bodies. */
function memberFields(body) {
  const name = String(body.name || '').trim().slice(0, 120);
  const designation = String(body.designation || '').trim().slice(0, 160);
  return {
    name,
    designation,
    accent: body.accent === 'blue' ? 'blue' : 'purple',
    featured: body.featured === true || body.featured === 'true',
    order: Number.isFinite(Number(body.order)) ? Number(body.order) : undefined,
  };
}

/** Save the uploaded image (multipart file OR direct Cloudinary asset). */
async function saveImage(req, filenameBase) {
  const direct = directAsset(req);
  if (!direct && !req.file) return null;
  if (req.file) assertImageSize(req.file);
  const uploaded =
    direct ||
    (await uploadBuffer(req.file.buffer, {
      folder: 'physioprisma/team',
      resourceType: 'image',
      filename: filenameBase,
    }));
  return { url: uploaded.url, publicId: uploaded.publicId || '' };
}

/* ==================================================================== */
/* GET /api/admin/team - full list (same order as the public page)      */
/* ==================================================================== */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const members = await TeamMember.find().sort({ order: 1, createdAt: 1 }).limit(MAX_MEMBERS);
    res.json({ ok: true, team: members.map((m) => m.toPublic()) });
  })
);

/* ==================================================================== */
/* POST /api/admin/team - add a member (JSON or multipart with "image") */
/* ==================================================================== */
router.post(
  '/',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if ((await TeamMember.countDocuments()) >= MAX_MEMBERS) {
      throw ApiError.badRequest(`A team can hold at most ${MAX_MEMBERS} members`);
    }

    const fields = memberFields(req.body);
    if (!fields.name) throw ApiError.badRequest('The member needs a name');
    if (!fields.designation) throw ApiError.badRequest('The member needs a designation');

    const image = (await saveImage(req, fields.name)) || { url: '', publicId: '' };
    // New members land at the end unless an order was given.
    const order =
      fields.order !== undefined ? fields.order : (await TeamMember.countDocuments());

    const member = await TeamMember.create({ ...fields, order, image });
    res.status(201).json({ ok: true, member: member.toPublic() });
  })
);

/* ==================================================================== */
/* PATCH /api/admin/team/reorder - save a new display order             */
/* ==================================================================== */
router.patch(
  '/reorder',
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body && req.body.order) ? req.body.order : null;
    if (!ids || !ids.every((id) => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id))) {
      throw ApiError.badRequest('order must be an array of member ids');
    }
    await Promise.all(
      ids.map((id, index) => TeamMember.updateOne({ _id: id }, { $set: { order: index } }))
    );
    const members = await TeamMember.find().sort({ order: 1, createdAt: 1 }).limit(MAX_MEMBERS);
    res.json({ ok: true, team: members.map((m) => m.toPublic()) });
  })
);

/* ==================================================================== */
/* PATCH /api/admin/team/:id - edit metadata                             */
/* ==================================================================== */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const member = await TeamMember.findById(req.params.id);
    if (!member) throw ApiError.notFound('Team member not found');

    const fields = memberFields(req.body);
    if (req.body.name !== undefined) {
      if (!fields.name) throw ApiError.badRequest('The member needs a name');
      member.name = fields.name;
    }
    if (req.body.designation !== undefined) {
      if (!fields.designation) throw ApiError.badRequest('The member needs a designation');
      member.designation = fields.designation;
    }
    if (req.body.accent !== undefined) member.accent = fields.accent;
    if (req.body.featured !== undefined) member.featured = fields.featured;
    if (fields.order !== undefined) member.order = fields.order;

    await member.save();
    res.json({ ok: true, member: member.toPublic() });
  })
);

/* ==================================================================== */
/* POST /api/admin/team/:id/image - replace the photo                   */
/* ==================================================================== */
router.post(
  '/:id/image',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const member = await TeamMember.findById(req.params.id);
    if (!member) throw ApiError.notFound('Team member not found');

    const image = await saveImage(req, member.name);
    if (!image) throw ApiError.badRequest('No image file received (field name must be "image")');

    if (member.image && (member.image.publicId || member.image.url)) {
      await destroyAsset(member.image.publicId || '', 'image', member.image.url || '');
    }
    member.image = image;
    await member.save();

    res.json({ ok: true, member: member.toPublic() });
  })
);

/* ==================================================================== */
/* DELETE /api/admin/team/:id - remove a member                          */
/* ==================================================================== */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const member = await TeamMember.findById(req.params.id);
    if (!member) throw ApiError.notFound('Team member not found');

    const image = { url: (member.image && member.image.url) || '', publicId: (member.image && member.image.publicId) || '' };
    await member.deleteOne();
    // Remove the photo in the background - never block the response.
    destroyAsset(image.publicId, 'image', image.url).catch(() => {});

    res.json({ ok: true, message: `${member.name} was removed from the team` });
  })
);

module.exports = router;
