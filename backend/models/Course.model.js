'use strict';

const mongoose = require('mongoose');
const { slugify } = require('../utils/slug');

const lessonSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    videoUrl: { type: String, required: true, trim: true },
    publicId: { type: String, default: '' }, // Cloudinary id (empty for legacy/local videos)
    duration: { type: String, default: '', maxlength: 20 },
  },
  { _id: true }
);

/** Downloadable course resource (PDF, slides, protocol sheets, ...). */
const courseFileSchema = new mongoose.Schema(
  {
    // Original filename, e.g. "dry-needling-protocols.pdf"
    name: { type: String, required: true, trim: true, maxlength: 200 },
    ext: { type: String, default: '', maxlength: 12 },
    mime: { type: String, default: '', maxlength: 120 },
    size: { type: Number, default: 0, min: 0 }, // bytes
    url: { type: String, required: true },
    publicId: { type: String, default: '' }, // empty for local /uploads fallback
  },
  { _id: true }
);

/**
 * A reading lesson inside a module. Students open the text, and the page
 * pings /student/reading with this lesson's id; once lessonSeconds reaches
 * minutes x 60 the lesson marks itself done. No videos here.
 */
const moduleLessonSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    // Plain-text/markdown-ish reading material shown on the course page.
    content: { type: String, default: '', maxlength: 20000 },
    // Estimated reading time in minutes (drives the per-lesson completion).
    minutes: { type: Number, default: 10, min: 1, max: 600 },
  },
  { _id: true }
);

/** A module groups lessons in the left-hand course track. */
const moduleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    order: { type: Number, default: 0 },
    lessons: { type: [moduleLessonSchema], default: [] },
  },
  { _id: true }
);

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    // Short blurb used on cards and in the course hero
    description: { type: String, default: '', trim: true, maxlength: 600 },
    // Long-form copy shown under "About this course" on course.html
    about: { type: String, default: '', trim: true, maxlength: 4000 },

    // Card artwork: Cloudinary asset OR a plain local/remote URL (legacy cards keep working)
    image: { url: { type: String, default: '' }, publicId: { type: String, default: '' } },
    // Icon used when there is no image (FontAwesome class, e.g. "fa-solid fa-syringe")
    icon: { type: String, default: '', maxlength: 80 },
    accent: { type: String, enum: ['purple', 'blue'], default: 'purple' },

    // Bullet points rendered on the card (Duration / Format / Who it's for / Certification)
    details: { type: [String], default: [] },

    lessons: { type: [lessonSchema], default: [] },
    // Structured curriculum: modules -> reading lessons (text only).
    modules: { type: [moduleSchema], default: [] },
    // E-learning resources students can view and download from the course page.
    files: { type: [courseFileSchema], default: [] },
    // 0 (or empty) = free course. Anything above 0 requires purchase (WhatsApp)
    // and the admin adds the course to the student after payment.
    price: { type: Number, default: 0, min: 0 },
    // Credit hours drive the certificate: 1 credit hour = 3600 seconds of
    // tracked study time. When 0, the legacy 2-minute reading rule applies.
    creditHours: { type: Number, default: 0, min: 0, max: 1000 },
    level: { type: String, default: '', maxlength: 40 },
    instructor: { type: String, default: 'Physioprisma Academy', trim: true, maxlength: 120 },

    published: { type: Boolean, default: true, index: true },
    order: { type: Number, default: 0, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/** Keep slug unique and stable; regenerate only when missing. */
courseSchema.pre('validate', function ensureSlug(next) {
  if (!this.slug) this.slug = slugify(this.title);
  next();
});

courseSchema.statics.slugify = slugify; // re-exported for seeds

/** Total reading lessons across all modules. */
courseSchema.methods.totalModuleLessons = function totalModuleLessons() {
  return (this.modules || []).reduce((sum, m) => sum + (m.lessons || []).length, 0);
};

/**
 * Seconds all module lessons add up to (minutes x 60). Used as the study
 * requirement when a course has modules but no admin-set credit hours.
 */
courseSchema.methods.lessonSecondsTotal = function lessonSecondsTotal() {
  return (this.modules || []).reduce(
    (sum, m) => sum + (m.lessons || []).reduce((s, l) => s + (Number(l.minutes) || 0) * 60, 0),
    0
  );
};

/** Public projection used by the courses page. */
courseSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    title: this.title,
    slug: this.slug,
    description: this.description,
    about: this.about,
    image: this.image && this.image.url ? this.image.url : '',
    icon: this.icon,
    accent: this.accent,
    details: this.details,
    lessons: this.lessons.length,
    files: this.files.length,
    moduleCount: (this.modules || []).length,
    lessonCount: this.totalModuleLessons(),
    price: this.price,
    isFree: !this.price,
    creditHours: this.creditHours || 0,
    level: this.level,
    instructor: this.instructor,
    published: this.published,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Course', courseSchema);
