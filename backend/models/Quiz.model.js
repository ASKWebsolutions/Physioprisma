'use strict';

const mongoose = require('mongoose');

/**
 * One quiz, either attached to a module (module quiz, runs after that
 * module's lessons) or to the whole course (module = null, final quiz).
 * The admin writes every question and option and picks the correct one.
 */
const questionSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 500 },
    // 2 to 6 answer options; the correct one is options[correct].
    options: {
      type: [String],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length >= 2 && v.length <= 6 && v.every((o) => String(o).trim()),
        message: 'A question needs 2-6 non-empty options',
      },
    },
    // Index into options[] of the right answer.
    correct: { type: Number, required: true, min: 0 },
  },
  { _id: true }
);

const quizSchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    // null/absent = whole-course (final) quiz; otherwise a module quiz.
    module: { type: mongoose.Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    passPercent: { type: Number, default: 70, min: 0, max: 100 },
    questions: { type: [questionSchema], default: [] },
    published: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// keep `correct` inside options range
quizSchema.pre('validate', function fixCorrect(next) {
  (this.questions || []).forEach((q) => {
    const max = (q.options || []).length - 1;
    if (q.correct > max) q.correct = max;
    if (q.correct < 0) q.correct = 0;
  });
  next();
});

/** Public shape for the admin panel (keeps the correct answers). */
quizSchema.methods.toAdmin = function toAdmin() {
  return {
    id: this._id.toString(),
    course: this.course ? this.course.toString() : '',
    module: this.module ? this.module.toString() : null,
    title: this.title,
    passPercent: this.passPercent,
    published: this.published,
    questions: (this.questions || []).map((q) => ({
      id: q._id.toString(),
      question: q.question,
      options: q.options,
      correct: q.correct,
    })),
  };
};

/**
 * Student-facing shape - never leaks the correct answers. `answered` and
 * `best` let the page show a previously submitted quiz state.
 */
quizSchema.methods.toStudent = function toStudent(best) {
  return {
    id: this._id.toString(),
    module: this.module ? this.module.toString() : null,
    title: this.title,
    passPercent: this.passPercent,
    questionCount: (this.questions || []).length,
    questions: (this.questions || []).map((q) => ({
      id: q._id.toString(),
      question: q.question,
      options: q.options,
    })),
    best: best || null, // { score, passed } or null
  };
};

module.exports = mongoose.model('Quiz', quizSchema);
