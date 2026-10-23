'use strict';

const express = require('express');

const Course = require('../../models/Course.model');
const Quiz = require('../../models/Quiz.model');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { validate } = require('../../utils/validate');

const router = express.Router();

const quizPayload = {
  title: { type: 'string', min: 2, max: 160 },
  // null / omitted = whole-course (final) quiz
  moduleId: { type: 'string', max: 64, required: false },
  passPercent: { type: 'number', min: 0, max: 100, required: false },
  published: { type: 'boolean', required: false },
  // questions are validated manually below (the tiny validator only
  // handles primitive array items).
};

async function loadCourseOr404(id) {
  const course = await Course.findById(id);
  if (!course) throw ApiError.notFound('Course not found');
  return course;
}

/** Validate every question: text, 2-6 options, correct inside range. */
function assertQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length) {
    throw ApiError.badRequest('A quiz needs at least one question');
  }
  if (questions.length > 100) throw ApiError.badRequest('A quiz can hold at most 100 questions');
  questions.forEach((q, i) => {
    if (!q || typeof q.question !== 'string' || !q.question.trim()) {
      throw ApiError.badRequest(`Question ${i + 1} needs a question text`);
    }
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) {
      throw ApiError.badRequest(`Question ${i + 1} needs 2-6 options`);
    }
    if (q.options.some((o) => typeof o !== 'string' || !o.trim())) {
      throw ApiError.badRequest(`Question ${i + 1} has an empty option`);
    }
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) {
      throw ApiError.badRequest(`Question ${i + 1}: the correct answer must point at one of its options`);
    }
  });
}

/* ==================================================================== */
/* GET /api/admin/quizzes/course/:courseId - every quiz on a course     */
/* ==================================================================== */
router.get(
  '/course/:courseId',
  asyncHandler(async (req, res) => {
    await loadCourseOr404(req.params.courseId);
    const quizzes = await Quiz.find({ course: req.params.courseId }).sort({ createdAt: 1 });
    res.json({ ok: true, quizzes: quizzes.map((q) => q.toAdmin()) });
  })
);

/* ==================================================================== */
/* POST /api/admin/quizzes/course/:courseId - create a quiz              */
/* ==================================================================== */
router.post(
  '/course/:courseId',
  validate(quizPayload),
  asyncHandler(async (req, res) => {
    const course = await loadCourseOr404(req.params.courseId);
    const questions = req.body.questions || [];
    assertQuestions(questions);

    let module = null;
    if (req.body.moduleId) {
      const mod = course.modules.id(req.body.moduleId);
      if (!mod) throw ApiError.notFound('Module not found on this course');
      module = mod._id;
    }

    const quiz = await Quiz.create({
      course: course._id,
      module,
      title: req.body.title,
      passPercent: Number.isFinite(req.body.passPercent) ? req.body.passPercent : 70,
      published: req.body.published !== false,
      questions,
    });
    res.status(201).json({ ok: true, quiz: quiz.toAdmin() });
  })
);

/* ==================================================================== */
/* PATCH /api/admin/quizzes/:id - edit title/options/answers             */
/* ==================================================================== */
router.patch(
  '/:id',
  validate(quizPayload),
  asyncHandler(async (req, res) => {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) throw ApiError.notFound('Quiz not found');

    const questions = req.body.questions;
    if (questions !== undefined) {
      assertQuestions(questions);
      quiz.questions = questions;
    }
    quiz.title = req.body.title;
    if (Number.isFinite(req.body.passPercent)) quiz.passPercent = req.body.passPercent;
    if (typeof req.body.published === 'boolean') quiz.published = req.body.published;
    await quiz.save();
    res.json({ ok: true, quiz: quiz.toAdmin() });
  })
);

/* ==================================================================== */
/* DELETE /api/admin/quizzes/:id                                         */
/* ==================================================================== */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const quiz = await Quiz.findByIdAndDelete(req.params.id);
    if (!quiz) throw ApiError.notFound('Quiz not found');
    res.json({ ok: true, message: 'Quiz deleted' });
  })
);

module.exports = router;
