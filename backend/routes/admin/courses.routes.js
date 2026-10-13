'use strict';

const express = require('express');

const Course = require('../../models/Course.model');
const Enrollment = require('../../models/Enrollment.model');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { validate } = require('../../utils/validate');
const { upload, assertImageSize } = require('../../middleware/upload');
const { uploadBuffer, destroyAsset } = require('../../config/cloudinary');

const router = express.Router();

/* ==================================================================== */
/* GET /api/admin/courses - full list (unpublished included)             */
/* ==================================================================== */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const courses = await Course.find().sort({ order: 1, createdAt: -1 });
    res.json({ ok: true, courses: courses.map((c) => c.toPublic()) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) throw ApiError.notFound('Course not found');
    res.json({ ok: true, course });
  })
);

/* ==================================================================== */
/* POST /api/admin/courses - create                                      */
/* ==================================================================== */
router.post(
  '/',
  validate({
    title: { type: 'string', min: 3, max: 160 },
    description: { type: 'string', max: 600, required: false },
    about: { type: 'string', max: 4000, required: false },
    instructor: { type: 'string', max: 120, required: false },
    level: { type: 'string', max: 40, required: false },
    accent: { type: 'enum', values: ['purple', 'blue'], required: false },
    icon: { type: 'string', max: 80, required: false },
    details: { type: 'array', required: false, items: { type: 'string', max: 200 } },
    price: { type: 'number', min: 0, required: false },
    published: { type: 'boolean', required: false },
    order: { type: 'number', required: false },
  }),
  asyncHandler(async (req, res) => {
    const course = new Course({
      title: req.body.title,
      description: req.body.description || '',
      about: req.body.about || '',
      instructor: req.body.instructor || 'Physioprisma Academy',
      level: req.body.level || '',
      accent: req.body.accent || 'purple',
      icon: req.body.icon || '',
      details: req.body.details || [],
      price: req.body.price || 0,
      published: req.body.published !== false,
      order: Number.isFinite(req.body.order) ? req.body.order : 0,
      createdBy: req.user._id,
    });

    try {
      await course.save();
    } catch (err) {
      if (err.code === 11000) throw ApiError.conflict('A course with this title/slug already exists');
      throw err;
    }

    res.status(201).json({ ok: true, course: course.toPublic() });
  })
);

/* ==================================================================== */
/* PATCH /api/admin/courses/:id - update metadata                        */
/* ==================================================================== */
router.patch(
  '/:id',
  validate({
    title: { type: 'string', min: 3, max: 160, required: false },
    description: { type: 'string', max: 600, required: false },
    about: { type: 'string', max: 4000, required: false },
    instructor: { type: 'string', max: 120, required: false },
    level: { type: 'string', max: 40, required: false },
    accent: { type: 'enum', values: ['purple', 'blue'], required: false },
    icon: { type: 'string', max: 80, required: false },
    details: { type: 'array', required: false, items: { type: 'string', max: 200 } },
    price: { type: 'number', min: 0, required: false },
    published: { type: 'boolean', required: false },
    order: { type: 'number', required: false },
  }),
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) throw ApiError.notFound('Course not found');

    const allowed = ['title', 'description', 'about', 'instructor', 'level', 'accent', 'icon', 'details', 'price', 'published', 'order'];
    for (const field of allowed) {
      if (req.body[field] !== undefined) course[field] = req.body[field];
    }
    // Keep slug stable unless the course was never saved with one
    if (req.body.title && !course.slug) course.slug = Course.slugify(course.title);

    await course.save();
    res.json({ ok: true, course: course.toPublic() });
  })
);

/* ==================================================================== */
/* POST /api/admin/courses/:id/image - card artwork                      */
/* ==================================================================== */
router.post(
  '/:id/image',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) throw ApiError.notFound('Course not found');
    if (!req.file) throw ApiError.badRequest('No image file received (field name must be "image")');
    assertImageSize(req.file);

    const uploaded = await uploadBuffer(req.file.buffer, {
      folder: 'physioprisma/courses',
      resourceType: 'image',
      filename: `course-${course._id}`,
    });

    // Replace the old asset (removeLocal ignores ./img/... legacy paths)
    if (course.image && (course.image.publicId || course.image.url)) {
      await destroyAsset(course.image.publicId || '', 'image', course.image.url || '');
    }

    course.image = { url: uploaded.url, publicId: uploaded.publicId };
    await course.save();

    res.json({ ok: true, image: course.image });
  })
);

/* ==================================================================== */
/* Lessons: add / update / delete                                        */
/* ==================================================================== */
router.post(
  '/:id/lessons',
  upload.single('video'),
  validate({ title: { type: 'string', min: 2, max: 160 }, duration: { type: 'string', max: 20, required: false } }),
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) throw ApiError.notFound('Course not found');
    if (!req.file) throw ApiError.badRequest('No video file received (field name must be "video")');

    const uploaded = await uploadBuffer(req.file.buffer, {
      folder: 'physioprisma/courses/lessons',
      resourceType: 'video',
      filename: `lesson-${course._id}-${Date.now()}`,
    });

    course.lessons.push({
      title: req.body.title,
      videoUrl: uploaded.url,
      publicId: uploaded.publicId,
      duration: req.body.duration || '',
    });
    await course.save();

    res.status(201).json({ ok: true, lesson: course.lessons[course.lessons.length - 1], lessons: course.lessons });
  })
);

router.patch(
  '/:id/lessons/:lessonId',
  validate({ title: { type: 'string', min: 2, max: 160, required: false }, duration: { type: 'string', max: 20, required: false } }),
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) throw ApiError.notFound('Course not found');
    const lesson = course.lessons.id(req.params.lessonId);
    if (!lesson) throw ApiError.notFound('Lesson not found');

    if (req.body.title) lesson.title = req.body.title;
    if (req.body.duration !== undefined) lesson.duration = req.body.duration;

    await course.save();
    res.json({ ok: true, lessons: course.lessons });
  })
);

router.delete(
  '/:id/lessons/:lessonId',
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) throw ApiError.notFound('Course not found');
    const lesson = course.lessons.id(req.params.lessonId);
    if (!lesson) throw ApiError.notFound('Lesson not found');

    const publicId = lesson.publicId || '';
    const videoUrl = lesson.videoUrl || '';
    lesson.deleteOne();
    await course.save();
    await destroyAsset(publicId, 'video', videoUrl);

    // Recompute progress for everyone enrolled in this course
    const enrollments = await Enrollment.find({ course: course._id });
    for (const e of enrollments) {
      e.recomputeProgress(course.lessons.length);
      await e.save();
    }

    res.json({ ok: true, lessons: course.lessons });
  })
);

/* ==================================================================== */
/* DELETE /api/admin/courses/:id                                         */
/* ==================================================================== */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) throw ApiError.notFound('Course not found');

    const enrollmentCount = await Enrollment.countDocuments({ course: course._id });

    // Remove stored assets in the background (cloud ids remotely, local files
    // off disk; legacy ./img/... paths are ignored by removeLocal)
    const assets = [
      ...(course.image && (course.image.publicId || course.image.url)
        ? [{ id: course.image.publicId || '', url: course.image.url || '', type: 'image' }]
        : []),
      ...course.lessons
        .map((l) => ({ id: l.publicId || '', url: l.videoUrl || '', type: 'video' }))
        .filter((a) => a.id || a.url),
    ];
    Promise.all(assets.map((a) => destroyAsset(a.id, a.type, a.url))).catch(() => {});

    await Enrollment.deleteMany({ course: course._id });
    await course.deleteOne();

    res.json({ ok: true, message: `Course deleted${enrollmentCount ? ` (${enrollmentCount} enrollments removed)` : ''}` });
  })
);

module.exports = router;
