'use strict';

const express = require('express');

const router = express.Router();

/**
 * API route registry - modules are mounted here as they land.
 *
 *   /api/auth    public + session endpoints (register, apply, login, me)
 *   /api/admin   protected admin panel API (stats, requests, users, content)
 *   /api/student protected student portal (own profile + enrolled courses)
 *   /api/gallery public published gallery categories
 *   /api/courses public published course catalogue (+ detail with lessons)
 *   /api/blogs   public published posts (+ detail with full content)
 *   /api/contact public "Send Us a Message" form submissions
 *   /api/ambassador protected ambassador portal (own referrals + rewards)
 */
router.use('/auth', require('./auth.routes'));
router.use('/admin', require('./admin'));
router.use('/student', require('./student.routes'));
router.use('/ambassador', require('./ambassador.routes'));
router.use('/gallery', require('./gallery.routes'));
router.use('/courses', require('./courses.routes'));
router.use('/blogs', require('./blogs.routes'));
router.use('/contact', require('./contact.routes'));
router.use('/track', require('./track.routes'));

module.exports = router;
