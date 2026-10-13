'use strict';

const express = require('express');
const { protect, requireRole } = require('../../middleware/auth');

const router = express.Router();

/* Everything under /api/admin requires a valid JWT + admin role.        */
router.use(protect, requireRole('admin'));

router.use('/stats', require('./stats.routes'));
router.use('/activity', require('./activity.routes'));
router.use('/requests', require('./requests.routes'));
router.use('/students', require('./students.routes'));
router.use('/users', require('./users.routes'));
router.use('/courses', require('./courses.routes'));
router.use('/blogs', require('./blogs.routes'));
router.use('/gallery', require('./gallery.routes'));

module.exports = router;
