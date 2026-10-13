'use strict';

const express = require('express');

const User = require('../../models/User.model');
const Enrollment = require('../../models/Enrollment.model');
const Course = require('../../models/Course.model');
const Blog = require('../../models/Blog.model');
const GalleryAlbum = require('../../models/GalleryAlbum.model');
const { asyncHandler } = require('../../middleware/error');

const router = express.Router();

/* GET /api/admin/stats                                                   */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [totalUsers, students, ambassadors, pendingRequests, courses, publishedBlogs, enrollments, mediaCount] =
      await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: 'student' }),
        User.countDocuments({ role: 'ambassador' }),
        User.countDocuments({ role: 'ambassador', status: 'pending' }),
        Course.countDocuments(),
        Blog.countDocuments({ published: true }),
        Enrollment.countDocuments(),
        GalleryAlbum.aggregate([{ $project: { n: { $add: [{ $size: '$photos' }, { $size: '$videos' }] } } }, { $group: { _id: null, total: { $sum: '$n' } } }]),
      ]);

    res.json({
      ok: true,
      stats: {
        totalUsers,
        students,
        ambassadors,
        pendingRequests,
        courses,
        publishedBlogs,
        enrollments,
        galleryItems: mediaCount && mediaCount[0] ? mediaCount[0].total : 0,
      },
    });
  })
);

module.exports = router;
