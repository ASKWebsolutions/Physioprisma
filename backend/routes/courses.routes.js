'use strict';

const express = require('express');

const Course = require('../models/Course.model');
const { asyncHandler, ApiError } = require('../middleware/error');

const router = express.Router();

/** Course as the public site sees it - published only, no drafts, no owner ids. */
function publicCourse(c) {
  return {
    id: c._id.toString(),
    title: c.title,
    slug: c.slug,
    description: c.description,
    about: c.about || '',
    image: c.image && c.image.url ? c.image.url : '',
    icon: c.icon,
    accent: c.accent,
    details: c.details || [],
    lessons: (c.lessons || []).map((l, i) => ({
      index: i,
      id: l._id ? l._id.toString() : String(i),
      title: l.title,
      duration: l.duration || '',
    })),
    lessonCount: (c.lessons || []).length,
    price: c.price,
    level: c.level,
    instructor: c.instructor,
    published: c.published,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Full lesson content - only sent for a single course detail request. */
function withLessonVideos(course) {
  const out = publicCourse(course);
  out.lessons = (course.lessons || []).map((l, i) => ({
    index: i,
    id: l._id ? l._id.toString() : String(i),
    title: l.title,
    duration: l.duration || '',
    videoUrl: l.videoUrl || '',
  }));
  return out;
}

/* ==================================================================== */
/* GET /api/courses - published course catalogue                         */
/* ==================================================================== */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 500);
    const courses = await Course.find({ published: true }).sort({ order: 1, createdAt: -1 }).limit(limit);
    res.json({ ok: true, count: courses.length, courses: courses.map(publicCourse) });
  })
);

/* ==================================================================== */
/* GET /api/courses/:slug (or :id) - one published course with lessons   */
/* ==================================================================== */
router.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const key = req.params.slug;
    const course = await Course.findOne({
      published: true,
      $or: [{ slug: key.toLowerCase() }, { _id: /^[0-9a-fA-F]{24}$/.test(key) ? key : '000000000000000000000000' }],
    });
    if (!course) throw ApiError.notFound('Course not found');
    res.json({ ok: true, course: withLessonVideos(course) });
  })
);

module.exports = router;
