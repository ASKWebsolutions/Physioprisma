'use strict';

const express = require('express');

const User = require('../../models/User.model');
const Enrollment = require('../../models/Enrollment.model');
const Blog = require('../../models/Blog.model');
const { asyncHandler } = require('../../middleware/error');

const router = express.Router();

/* GET /api/admin/activity - recent events for the overview feed          */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [recentUsers, recentEnrollments, recentBlogs] = await Promise.all([
      User.find().sort({ createdAt: -1 }).limit(5).select('name role status createdAt'),
      Enrollment.find().sort({ createdAt: -1 }).limit(5).populate('course', 'title'),
      Blog.find().sort({ createdAt: -1 }).limit(5).select('title slug createdAt'),
    ]);

    const items = [
      ...recentUsers.map((u) => ({
        icon: u.role === 'ambassador' ? 'fa-handshake' : u.role === 'admin' ? 'fa-shield-halved' : 'fa-user-graduate',
        text:
          u.role === 'ambassador'
            ? `<strong>${u.name}</strong> applied as an ambassador`
            : `<strong>${u.name}</strong> registered as a ${u.role}`,
        time: u.createdAt,
      })),
      ...recentEnrollments.map((e) => ({
        icon: 'fa-graduation-cap',
        text: `New enrollment in <strong>${e.course ? e.course.title : 'a course'}</strong>`,
        time: e.createdAt,
      })),
      ...recentBlogs.map((b) => ({
        icon: 'fa-newspaper',
        text: `Blog <strong>${b.title}</strong> was updated`,
        time: b.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 8);

    res.json({ ok: true, items });
  })
);

module.exports = router;
