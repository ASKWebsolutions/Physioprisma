'use strict';

const express = require('express');

const ContactMessage = require('../../models/ContactMessage.model');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { validate } = require('../../utils/validate');

const router = express.Router();

const STATUSES = ['new', 'replied'];

/* ==================================================================== */
/* GET /api/admin/contacts - every message, newest first                 */
/* ==================================================================== */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.status && STATUSES.includes(String(req.query.status))) filter.status = req.query.status;
    if (req.query.q) {
      const rx = { $regex: String(req.query.q), $options: 'i' };
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { concern: rx }, { message: rx }];
    }

    const [messages, total, unread] = await Promise.all([
      ContactMessage.find(filter).sort({ createdAt: -1 }).limit(500),
      ContactMessage.countDocuments(),
      ContactMessage.countDocuments({ status: 'new' }),
    ]);

    res.json({ ok: true, messages: messages.map((m) => m.toPublic()), total, unread });
  })
);

/* ==================================================================== */
/* PATCH /api/admin/contacts/:id - mark new / replied                    */
/* ==================================================================== */
router.patch(
  '/:id',
  validate({ status: { type: 'enum', values: STATUSES } }),
  asyncHandler(async (req, res) => {
    const doc = await ContactMessage.findById(req.params.id);
    if (!doc) throw ApiError.notFound('Message not found');

    doc.status = req.body.status;
    await doc.save();

    res.json({ ok: true, contact: doc.toPublic() });
  })
);

/* ==================================================================== */
/* DELETE /api/admin/contacts/:id                                        */
/* ==================================================================== */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await ContactMessage.findById(req.params.id);
    if (!doc) throw ApiError.notFound('Message not found');

    await doc.deleteOne();
    res.json({ ok: true, message: 'Message deleted' });
  })
);

module.exports = router;
