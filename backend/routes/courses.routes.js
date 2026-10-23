'use strict';

const express = require('express');

const Course = require('../models/Course.model');
const Enrollment = require('../models/Enrollment.model');
const { requiredSecondsFor, requiredStudySeconds } = require('../models/Enrollment.model');
const { optionalUser } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../middleware/error');
const { attachmentUrl } = require('../utils/fileUrls');

const router = express.Router();

/** File metadata as the catalogue sees it - never the raw URL. */
function fileMeta(f) {
  return {
    id: f._id ? f._id.toString() : '',
    name: f.name,
    ext: f.ext || '',
    size: f.size || 0,
  };
}

/** Full file entry (with its URL) - only sent when the viewer may open it. */
function fileEntry(f, downloadUrl) {
  return {
    ...fileMeta(f),
    mime: f.mime || '',
    url: f.url || '',
    downloadUrl,
  };
}

/** Module summary for catalogue cards - titles only, no lesson content. */
function moduleSummaries(modules) {
  return (modules || []).map((m) => ({
    id: m._id ? m._id.toString() : '',
    title: m.title,
    order: m.order || 0,
    lessonCount: (m.lessons || []).length,
    minutes: (m.lessons || []).reduce((s, l) => s + (Number(l.minutes) || 0), 0),
  }));
}

/** Full module tree for the course page (content gated separately). */
function moduleTree(modules, includeContent) {
  return (modules || []).map((m) => ({
    id: m._id ? m._id.toString() : '',
    title: m.title,
    order: m.order || 0,
    lessons: (m.lessons || []).map((l) => ({
      id: l._id ? l._id.toString() : '',
      title: l.title,
      minutes: Number(l.minutes) || 10,
      content: includeContent ? l.content || '' : undefined,
      locked: includeContent ? undefined : true,
    })),
  }));
}

/** Course as the public site sees it - published only, no drafts, no owner ids. */
function publicCourse(c) {
  const totalModuleLessons = (c.modules || []).reduce((s, m) => s + (m.lessons || []).length, 0);
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
    modules: moduleSummaries(c.modules),
    moduleCount: (c.modules || []).length,
    moduleLessonCount: totalModuleLessons,
    files: (c.files || []).map(fileMeta),
    fileCount: (c.files || []).length,
    price: c.price || 0,
    isFree: !c.price,
    creditHours: c.creditHours || 0,
    requiredSeconds: requiredStudySeconds(c),
    level: c.level,
    instructor: c.instructor,
    published: c.published,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/**
 * Full lesson + module + file content - only sent for a single course
 * detail request. Lesson content and file URLs are withheld from paid
 * courses unless the viewer is enrolled (or an admin), so the material
 * stays behind the purchase.
 */
async function withLessonVideos(course, user) {
  const out = publicCourse(course);
  out.lessons = (course.lessons || []).map((l, i) => ({
    index: i,
    id: l._id ? l._id.toString() : String(i),
    title: l.title,
    duration: l.duration || '',
    videoUrl: l.videoUrl || '',
  }));

  const enrolled = user ? (await Enrollment.exists({ user: user._id, course: course._id })) !== null : false;
  const canOpen = !course.price || enrolled || (user && user.role === 'admin');
  out.files = (course.files || []).map((f) =>
    canOpen ? fileEntry(f, attachmentUrl(f.url, f.name)) : { ...fileMeta(f), locked: true }
  );
  out.filesLocked = !canOpen;
  out.modules = moduleTree(course.modules, canOpen);
  out.modulesLocked = !canOpen;
  out.enrolled = enrolled;
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
    res.json({ ok: true, course: await withLessonVideos(course, await optionalUser(req)) });
  })
);

module.exports = router;
