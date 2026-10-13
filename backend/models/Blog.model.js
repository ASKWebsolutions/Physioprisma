'use strict';

const mongoose = require('mongoose');
const { slugify } = require('../utils/slug');

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    excerpt: { type: String, default: '', trim: true, maxlength: 500 },

    coverImage: { url: { type: String, default: '' }, publicId: { type: String, default: '' } },

    author: { type: String, default: 'Physioprisma Clinical Team', trim: true, maxlength: 120 },
    authorRole: { type: String, default: 'Physiotherapist at Physioprisma', trim: true, maxlength: 160 },
    authorImage: { type: String, default: './img/logo pic (2).jpg' },
    // Display date exactly as it should appear on the page (preserves legacy text)
    dateText: { type: String, default: '', maxlength: 60 },

    // Full post HTML (same markup the page renders today)
    content: { type: String, required: true },

    category: { type: String, default: '', trim: true, maxlength: 60 },
    tags: { type: [String], default: [] },

    published: { type: Boolean, default: true, index: true },
    order: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

blogSchema.pre('validate', function ensureSlug(next) {
  if (!this.slug) this.slug = slugify(this.title);
  next();
});

blogSchema.statics.slugify = slugify;

/** Shape used by blog.html cards. */
blogSchema.methods.toList = function toList() {
  return {
    id: this._id.toString(),
    title: this.title,
    slug: this.slug,
    excerpt: this.excerpt,
    image: this.coverImage ? this.coverImage.url || '' : '',
    author: this.author,
    authorRole: this.authorRole,
    dateText: this.dateText,
    category: this.category,
    published: this.published,
    createdAt: this.createdAt,
  };
};

/** Shape used by blog-post.html. */
blogSchema.methods.toDetail = function toDetail() {
  return {
    ...this.toList(),
    authorImage: this.authorImage,
    content: this.content,
    tags: this.tags,
  };
};

module.exports = mongoose.model('Blog', blogSchema);
