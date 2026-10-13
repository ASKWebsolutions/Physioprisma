'use strict';

const express = require('express');

const ContactMessage = require('../models/ContactMessage.model');
const { asyncHandler } = require('../middleware/error');
const { validate } = require('../utils/validate');

const router = express.Router();

/**
 * POST /api/contact - public "Send Us a Message" form on contact.html.
 *
 * No auth (any visitor can write in), but strictly validated and capped so the
 * endpoint cannot be used to flood the database.
 */
router.post(
  '/',
  validate({
    name: { type: 'string', min: 2, max: 120 },
    phone: { type: 'phone' },
    email: { type: 'email', max: 160, required: false },
    concern: { type: 'string', max: 80, required: false },
    message: { type: 'string', min: 5, max: 2000 },
  }),
  asyncHandler(async (req, res) => {
    const doc = await ContactMessage.create({
      name: req.body.name,
      phone: req.body.phone,
      email: req.body.email || '',
      concern: req.body.concern || '',
      message: req.body.message,
      source: 'contact-form',
    });

    res.status(201).json({
      ok: true,
      id: doc._id.toString(),
      message: "Thanks! Your message has been received - we'll get back to you shortly.",
    });
  })
);

module.exports = router;
