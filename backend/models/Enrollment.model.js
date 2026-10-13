'use strict';

const mongoose = require('mongoose');

const STATUSES = ['active', 'completed'];

// Courses are text + images only. Reading this many seconds marks the course
// complete (and unlocks the certificate).
const REQUIRED_READING_SECONDS = 120; // ~2 minutes

const enrollmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },

    progress: { type: Number, default: 0, min: 0, max: 100 },
    // Reading-time tracking (courses have no videos): seconds actually read.
    readingSeconds: { type: Number, default: 0, min: 0 },
    lastReadingAt: { type: Date, default: null },
    completedLectures: { type: [Number], default: [] },
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
 * Progress from reading time: REQUIRED_READING_SECONDS of reading = 100%.
 * Hitting 100% marks the course completed and unlocks the certificate.
 */
enrollmentSchema.methods.recomputeReadingProgress = function recomputeReadingProgress() {
  const seconds = Math.max(0, Math.min(this.readingSeconds || 0, REQUIRED_READING_SECONDS));
  this.readingSeconds = seconds;
  this.progress = Math.round((seconds / REQUIRED_READING_SECONDS) * 100);

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

/** Shape consumed by student-dashboard.html. */
enrollmentSchema.methods.toDashboard = function toDashboard(course) {
  const lessons = course && course.lessons ? course.lessons.length : 0;
  return {
    id: this._id.toString(),
    courseId: course ? course._id.toString() : null,
    title: course ? course.title : 'Course',
    slug: course ? course.slug : '',
    mentor: course ? course.instructor || 'Physioprisma Academy' : '',
    image: course && course.image ? course.image.url || '' : '',
    progress: this.progress,
    readingSeconds: this.readingSeconds || 0,
    requiredSeconds: REQUIRED_READING_SECONDS,
    lessons,
    done: this.completedLectures.length,
    status: this.status === 'completed' ? 'Completed' : 'In Progress',
    enrolledAt: this.createdAt,
    completedAt: this.completedAt,
  };
};

module.exports = mongoose.model('Enrollment', enrollmentSchema);
module.exports.STATUSES = STATUSES;
module.exports.REQUIRED_READING_SECONDS = REQUIRED_READING_SECONDS;
