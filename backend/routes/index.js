'use strict';

const express = require('express');

const router = express.Router();

/**
 * API route registry - modules are mounted here as they land.
 *
 *   /api/auth    public + session endpoints (register, apply, login, me)
 *   /api/admin   protected admin panel API (stats, requests, users, content)
 *   /api/gallery public published gallery categories
 *   /api/courses public published course catalogue (+ detail with lessons)
 *   /api/blogs   public published posts (+ detail with full content)
 *   Phase 4+:    /api/enrollments, /api/ambassador
 */
router.use('/auth', require('./auth.routes'));
router.use('/admin', require('./admin'));
router.use('/gallery', require('./gallery.routes'));
router.use('/courses', require('./courses.routes'));
router.use('/blogs', require('./blogs.routes'));

module.exports = router;
