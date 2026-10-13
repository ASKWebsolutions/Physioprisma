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
    price: { type: Number, default: 0, min: 0 },
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
    price: this.price,
    level: this.level,
    instructor: this.instructor,
    published: this.published,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Course', courseSchema);
