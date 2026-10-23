'use strict';

const express = require('express');

const Course = require('../../models/Course.model');
const Enrollment = require('../../models/Enrollment.model');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { validate } = require('../../utils/validate');
const { upload, docUpload, assertImageSize, assertDocSize, directAsset } = require('../../middleware/upload');
const { uploadBuffer, destroyAsset } = require('../../config/cloudinary');
const { fileWithDownload } = require('../../utils/fileUrls');

const router = express.Router();

const MAX_FILES_PER_COURSE = 30;
// Mirrors the multipart filter in middleware/upload.js so both paths accept
// exactly the same documents.
const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'zip'];

/** "lecture-notes.pdf" -> "pdf" (lowercase, no dot). */
function extOf(name) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

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
    const out = course.toObject();
    out.files = (out.files || []).map(fileWithDownload);
    res.json({ ok: true, course: out });
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
    creditHours: { type: 'number', min: 0, max: 1000, required: false },
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
      creditHours: Number.isFinite(req.body.creditHours) ? req.body.creditHours : 0,
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
    creditHours: { type: 'number', min: 0, max: 1000, required: false },
    published: { type: 'boolean', required: false },
    order: { type: 'number', required: false },
  }),
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) throw ApiError.notFound('Course not found');

    const allowed = ['title', 'description', 'about', 'instructor', 'level', 'accent', 'icon', 'details', 'price', 'creditHours', 'published', 'order'];
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

    // Either a file, or an asset the browser already pushed to Cloudinary.
    const direct = directAsset(req);
    if (!direct && !req.file) throw ApiError.badRequest('No image file received (field name must be "image")');
    if (req.file) assertImageSize(req.file);

    const uploaded = direct || (await uploadBuffer(req.file.buffer, {
      folder: 'physioprisma/courses',
      resourceType: 'image',
      filename: `course-${course._id}`,
    }));

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
/* POST /api/admin/courses/:id/files - course resource file              */
/*                                                                       */
/* Accepts a multipart file (field "file") OR an asset the browser       */
/* already pushed straight to Cloudinary ({ url, publicId, name, ... }). */
/* ==================================================================== */
router.post(
  '/:id/files',
  docUpload.single('file'),
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) throw ApiError.notFound('Course not found');
    if (course.files.length >= MAX_FILES_PER_COURSE) {
      throw ApiError.badRequest(`A course can hold at most ${MAX_FILES_PER_COURSE} files`);
    }

    const direct = directAsset(req);
    if (!direct && !req.file) {
      throw ApiError.badRequest('No file received (field name must be "file")');
    }
    if (req.file) assertDocSize(req.file);

    const body = req.body || {};
    const name = String((req.file ? req.file.originalname : body.name) || '')
      .trim()
      .slice(0, 200);
    if (!name) throw ApiError.badRequest('The file needs a name');
    const ext = extOf(name);
    if (!DOC_EXTS.includes(ext)) {
      throw ApiError.badRequest(
        `Unsupported file ".${ext || '?'}". Allowed: ${DOC_EXTS.map((e) => '.' + e).join(', ')}`
      );
    }
    const mime = String((req.file ? req.file.mimetype : body.mime) || '').trim().slice(0, 120);
    const size = Number((req.file ? req.file.size : body.size) || 0);

    const uploaded =
      direct ||
      (await uploadBuffer(req.file.buffer, {
        folder: 'physioprisma/courses/files',
        resourceType: 'raw',
        filename: name,
      }));

    const entry = course.files.create({
      name,
      ext: extOf(name),
      mime,
      size: Number.isFinite(size) && size > 0 ? size : uploaded.bytes || 0,
      url: uploaded.url,
      publicId: uploaded.publicId || '',
    });
    course.files.push(entry);
    await course.save();

    res.status(201).json({ ok: true, file: fileWithDownload(entry), files: course.files.map(fileWithDownload) });
  })
);

/* ==================================================================== */
/* DELETE /api/admin/courses/:id/files/:fileId - remove one resource     */
/* ==================================================================== */
router.delete(
  '/:id/files/:fileId',
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) throw ApiError.notFound('Course not found');

    const file = course.files.id(req.params.fileId);
    if (!file) throw ApiError.notFound('File not found');

    const asset = { url: file.url || '', publicId: file.publicId || '' };
    course.files.pull(req.params.fileId);
    await course.save();

    destroyAsset(asset.publicId, 'raw', asset.url).catch(() => {});

    res.json({ ok: true, message: 'File deleted', files: course.files.map(fileWithDownload) });
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
      ...course.files
        .map((f) => ({ id: f.publicId || '', url: f.url || '', type: 'raw' }))
        .filter((a) => a.id || a.url),
    ];
    Promise.all(assets.map((a) => destroyAsset(a.id, a.type, a.url))).catch(() => {});

    await Enrollment.deleteMany({ course: course._id });
    await course.deleteOne();
    // Quizzes hang off the course - remove them too.
    const Quiz = require('../../models/Quiz.model');
    await Quiz.deleteMany({ course: course._id }).catch(() => {});

    res.json({ ok: true, message: `Course deleted${enrollmentCount ? ` (${enrollmentCount} enrollments removed)` : ''}` });
  })
);

/* ==================================================================== */
/* MODULES + LESSONS (reading curriculum)                                */
/* ==================================================================== */

/** Shared loader: fails unless the course exists. */
async function loadCourseOr404(id) {
  const course = await Course.findById(id);
  if (!course) throw ApiError.notFound('Course not found');
  return course;
}

/** Find a module subdoc by id, or fail with the right message. */
function findModule(course, moduleId) {
  const mod = course.modules.id(moduleId);
  if (!mod) throw ApiError.notFound('Module not found');
  return mod;
}

const modulePayload = {
  title: { type: 'string', min: 2, max: 160 },
  order: { type: 'number', min: 0, required: false },
};

const lessonPayload = {
  title: { type: 'string', min: 2, max: 160 },
  content: { type: 'string', max: 20000, required: false },
  minutes: { type: 'number', min: 1, max: 600, required: false },
};

/* POST /api/admin/courses/:id/modules - add a module */
router.post(
  '/:id/modules',
  validate(modulePayload),
  asyncHandler(async (req, res) => {
    const course = await loadCourseOr404(req.params.id);
    course.modules.push({
      title: req.body.title,
      order: Number.isFinite(req.body.order) ? req.body.order : course.modules.length,
    });
    await course.save();
    res.status(201).json({ ok: true, modules: course.modules });
  })
);

/* PATCH /api/admin/courses/:id/modules/:moduleId - rename / reorder */
router.patch(
  '/:id/modules/:moduleId',
  validate(modulePayload),
  asyncHandler(async (req, res) => {
    const course = await loadCourseOr404(req.params.id);
    const mod = findModule(course, req.params.moduleId);
    mod.title = req.body.title;
    if (Number.isFinite(req.body.order)) mod.order = req.body.order;
    await course.save();
    res.json({ ok: true, modules: course.modules });
  })
);

/* DELETE /api/admin/courses/:id/modules/:moduleId */
router.delete(
  '/:id/modules/:moduleId',
  asyncHandler(async (req, res) => {
    const course = await loadCourseOr404(req.params.id);
    course.modules.pull(req.params.moduleId);
    await course.save();
    // Also drop quizzes that pointed at the removed module.
    const Quiz = require('../../models/Quiz.model');
    await Quiz.deleteMany({ course: course._id, module: req.params.moduleId }).catch(() => {});
    res.json({ ok: true, message: 'Module deleted', modules: course.modules });
  })
);

/* POST /api/admin/courses/:id/modules/:moduleId/lessons */
router.post(
  '/:id/modules/:moduleId/lessons',
  validate(lessonPayload),
  asyncHandler(async (req, res) => {
    const course = await loadCourseOr404(req.params.id);
    const mod = findModule(course, req.params.moduleId);
    if (mod.lessons.length >= 100) throw ApiError.badRequest('A module can hold at most 100 lessons');
    mod.lessons.push({
      title: req.body.title,
      content: req.body.content || '',
      minutes: Number.isFinite(req.body.minutes) ? req.body.minutes : 10,
    });
    await course.save();
    res.status(201).json({ ok: true, module: mod });
  })
);

/* PATCH /api/admin/courses/:id/modules/:moduleId/lessons/:lessonId */
router.patch(
  '/:id/modules/:moduleId/lessons/:lessonId',
  validate(lessonPayload),
  asyncHandler(async (req, res) => {
    const course = await loadCourseOr404(req.params.id);
    const mod = findModule(course, req.params.moduleId);
    const lesson = mod.lessons.id(req.params.lessonId);
    if (!lesson) throw ApiError.notFound('Lesson not found');
    lesson.title = req.body.title;
    if (req.body.content !== undefined) lesson.content = req.body.content || '';
    if (Number.isFinite(req.body.minutes)) lesson.minutes = req.body.minutes;
    await course.save();
    res.json({ ok: true, module: mod });
  })
);

/* DELETE /api/admin/courses/:id/modules/:moduleId/lessons/:lessonId */
router.delete(
  '/:id/modules/:moduleId/lessons/:lessonId',
  asyncHandler(async (req, res) => {
    const course = await loadCourseOr404(req.params.id);
    const mod = findModule(course, req.params.moduleId);
    if (!mod.lessons.id(req.params.lessonId)) throw ApiError.notFound('Lesson not found');
    mod.lessons.pull(req.params.lessonId);
    await course.save();
    res.json({ ok: true, message: 'Lesson deleted', module: mod });
  })
);

/* GET /api/admin/courses/:id - full document (with modules + files) */
router.get(
  '/:id/full',
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) throw ApiError.notFound('Course not found');
    const out = course.toObject();
    out.files = (out.files || []).map(fileWithDownload);
    const Quiz = require('../../models/Quiz.model');
    const quizzes = await Quiz.find({ course: course._id }).sort({ createdAt: 1 });
    res.json({ ok: true, course: out, quizzes: quizzes.map((q) => q.toAdmin()) });
  })
);

module.exports = router;
