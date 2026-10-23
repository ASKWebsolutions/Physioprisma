'use strict';

const mongoose = require('mongoose');

const STATUSES = ['active', 'completed'];

// Courses are text + images only. Reading this many seconds marks the course
// complete (and unlocks the certificate) when a course has no credit hours.
const REQUIRED_READING_SECONDS = 120; // ~2 minutes

/**
 * Seconds a student must log before the course counts as 100% complete.
 * Admin-set credit hours win (1 credit hour = 3600 seconds); courses without
 * credit hours keep the legacy 2-minute reading requirement.
 */
function requiredSecondsFor(course) {
  const creditHours = course && Number(course.creditHours);
  if (Number.isFinite(creditHours) && creditHours > 0) return Math.round(creditHours * 3600);
  return REQUIRED_READING_SECONDS;
}

/**
 * Study requirement for a course. Module courses use the sum of their
 * lessons' minutes (each lesson completes on its own clock); everything
 * else falls back to credit hours / the 2-minute reading rule.
 */
function requiredStudySeconds(course) {
  if (course && typeof course.lessonSecondsTotal === 'function') {
    const fromLessons = course.lessonSecondsTotal();
    if (fromLessons > 0) return fromLessons;
  }
  return requiredSecondsFor(course);
}

const enrollmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },

    progress: { type: Number, default: 0, min: 0, max: 100 },
    // Reading-time tracking (courses have no videos): seconds actually read.
    readingSeconds: { type: Number, default: 0, min: 0 },
    lastReadingAt: { type: Date, default: null },
    completedLectures: { type: [Number], default: [] },

    // ---- Module lessons (text reading, per-lesson time) ----
    // lessonId -> seconds spent reading that specific lesson.
    lessonSeconds: { type: Object, default: {} },
    // Lesson ids the student has finished (lessonSeconds >= minutes x 60).
    completedLessons: { type: [String], default: [] },

    // ---- Quizzes: quizId -> best { score, passed } ----
    quizBest: { type: Object, default: {} },

    status: { type: String, enum: STATUSES, default: 'active', index: true },

    // Which ambassador referred this enrollment (drives ambassador earnings)
    referredBy: { type: String, trim: true, uppercase: true, default: null, index: true },

    completedAt: { type: Date, default: null },
    lastAccessedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// A user can only enroll in a course once
enrollmentSchema.index({ user: 1, course: 1 }, { unique: true });

/**
 * Progress from study time: requiredSeconds of reading = 100%.
 * Hitting 100% marks the course completed and unlocks the certificate.
 *
 * @param {number} [secondsRequired] - course-specific requirement (credit
 *   hours x 3600); falls back to the legacy 2-minute reading rule.
 */
enrollmentSchema.methods.recomputeReadingProgress = function recomputeReadingProgress(secondsRequired) {
  const required =
    Number(secondsRequired) > 0 ? Math.round(Number(secondsRequired)) : REQUIRED_READING_SECONDS;
  const seconds = Math.max(0, Math.min(this.readingSeconds || 0, required));
  this.readingSeconds = seconds;
  this.progress = Math.round((seconds / required) * 100);

  if (this.progress >= 100) {
    if (!this.completedAt) this.completedAt = new Date();
    this.status = 'completed';
  } else {
    this.completedAt = null;
    this.status = 'active';
  }
  return this.progress;
};

/** Recompute progress from completed lecture indexes. */
enrollmentSchema.methods.recomputeProgress = function recomputeProgress(totalLessons) {
  const total = Number(totalLessons) || 0;
  if (total <= 0) {
    this.progress = 0;
    return this.progress;
  }
  const unique = [...new Set(this.completedLectures.filter((i) => Number.isInteger(i) && i >= 0))].sort(
    (a, b) => a - b
  );
  this.completedLectures = unique;
  this.progress = Math.min(100, Math.round((unique.length / total) * 100));
  if (this.progress === 100) {
    if (!this.completedAt) this.completedAt = new Date();
    this.status = 'completed';
  } else {
    this.completedAt = null;
    this.status = 'active';
  }
  return this.progress;
};

/**
 * Credit reading time to a specific lesson (or the whole course when no
 * lessonId). A lesson flips to done once its own clock (minutes x 60) is
 * filled, which is what the left-hand track ticks off.
 *
 * @param {object} course - populated course document
 * @param {string} [lessonId] - lesson _id being read right now
 * @param {number} elapsed - seconds to add
 */
enrollmentSchema.methods.addStudySeconds = function addStudySeconds(course, lessonId, elapsed) {
  const sec = Math.max(0, Number(elapsed) || 0);
  if (!this.lessonSeconds || typeof this.lessonSeconds !== 'object') this.lessonSeconds = {};
  if (!Array.isArray(this.completedLessons)) this.completedLessons = [];

  if (lessonId) {
    const lid = String(lessonId);
    // Only credit a lesson that actually belongs to this course.
    let lesson = null;
    (course.modules || []).forEach((m) => {
      (m.lessons || []).forEach((l) => {
        if (l._id.toString() === lid) lesson = l;
      });
    });
    if (lesson) {
      const need = (Number(lesson.minutes) || 10) * 60;
      const next = Math.min((Number(this.lessonSeconds[lid]) || 0) + sec, need);
      this.lessonSeconds[lid] = next;
      // lessonSeconds is a Mixed map - mongoose only persists it when told.
      this.markModified('lessonSeconds');
      if (next >= need && !this.completedLessons.includes(lid)) this.completedLessons.push(lid);
    }
  } else {
    // Legacy whole-course reading clock (credit hours / 2-minute rule).
    const required = requiredSecondsFor(course);
    this.readingSeconds = Math.min((this.readingSeconds || 0) + sec, required);
  }
};

/**
 * Progress = 80% study + 20% quiz (all quizzes passed = full quiz share).
 * Courses with no quizzes weigh study at 100%. Marks the enrollment
 * completed (certificate unlocked) at 100%.
 *
 * @param {object} course - populated course document
 * @param {number} totalQuizzes - published quizzes on the course
 * @param {number} passedQuizzes - quizzes the student has passed
 */
enrollmentSchema.methods.recomputeCombinedProgress = function recomputeCombinedProgress(
  course,
  totalQuizzes,
  passedQuizzes
) {
  const modules = (course && course.modules) || [];
  const lessonIndex = {};
  modules.forEach((m) => (m.lessons || []).forEach((l) => (lessonIndex[l._id.toString()] = l)));

  // Study share: per-lesson clocks when the course has lessons, else the
  // whole-course readingSeconds clock.
  let studyPercent;
  const lessonIds = Object.keys(lessonIndex);
  if (lessonIds.length) {
    if (!this.lessonSeconds || typeof this.lessonSeconds !== 'object') this.lessonSeconds = {};
    if (!Array.isArray(this.completedLessons)) this.completedLessons = [];
    let earned = 0;
    let required = 0;
    lessonIds.forEach((lid) => {
      const lesson = lessonIndex[lid];
      const need = (Number(lesson.minutes) || 10) * 60;
      const spent = Math.min(Number(this.lessonSeconds[lid]) || 0, need);
      earned += spent;
      required += need;
      if (spent >= need && !this.completedLessons.includes(lid)) this.completedLessons.push(lid);
    });
    // Drop completions for lessons the admin deleted.
    this.completedLessons = this.completedLessons.filter((id) => lessonIndex[id]);
    studyPercent = required > 0 ? Math.round((earned / required) * 100) : 0;
    studyPercent = Math.max(0, Math.min(100, studyPercent));
  } else {
    const required = requiredSecondsFor(course);
    studyPercent = required > 0 ? Math.round((Math.min(this.readingSeconds || 0, required) / required) * 100) : 0;
    studyPercent = Math.max(0, Math.min(100, studyPercent));
  }

  const total = Number(totalQuizzes) || 0;
  const quizPercent = total > 0 ? Math.round(((Number(passedQuizzes) || 0) / total) * 100) : 100;
  this.progress = total > 0
    ? Math.max(0, Math.min(100, Math.round(studyPercent * 0.8 + quizPercent * 0.2)))
    : studyPercent;

  if (this.progress >= 100) {
    if (!this.completedAt) this.completedAt = new Date();
    this.status = 'completed';
  } else {
    this.completedAt = null;
    this.status = 'active';
  }
  return this.progress;
};

/** Shape consumed by student-dashboard.html. */
enrollmentSchema.methods.toDashboard = function toDashboard(course) {
  const lessons = course && course.lessons ? course.lessons.length : 0;
  const totalModuleLessons = course && typeof course.totalModuleLessons === 'function'
    ? course.totalModuleLessons()
    : 0;
  return {
    id: this._id.toString(),
    courseId: course ? course._id.toString() : null,
    title: course ? course.title : 'Course',
    slug: course ? course.slug : '',
    mentor: course ? course.instructor || 'Physioprisma Academy' : '',
    image: course && course.image ? course.image.url || '' : '',
    progress: this.progress,
    readingSeconds: this.readingSeconds || 0,
    requiredSeconds: requiredStudySeconds(course),
    creditHours: course ? course.creditHours || 0 : 0,
    lessons,
    moduleLessons: totalModuleLessons,
    doneLessons: Array.isArray(this.completedLessons) ? this.completedLessons.length : 0,
    done: this.completedLectures.length,
    status: this.status === 'completed' ? 'Completed' : 'In Progress',
    enrolledAt: this.createdAt,
    completedAt: this.completedAt,
  };
};

module.exports = mongoose.model('Enrollment', enrollmentSchema);
module.exports.STATUSES = STATUSES;
module.exports.REQUIRED_READING_SECONDS = REQUIRED_READING_SECONDS;
module.exports.requiredSecondsFor = requiredSecondsFor;
module.exports.requiredStudySeconds = requiredStudySeconds;
