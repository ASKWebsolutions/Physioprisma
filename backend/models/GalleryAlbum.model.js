'use strict';

const mongoose = require('mongoose');

/**
 * One media item inside an album. Legacy albums stored plain URL strings -
 * those are normalised to this shape on read (see toPublic below), so old
 * and new items render identically.
 */
const mediaItemSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    // Cloudinary id for uploaded media; empty for local files like ./img/prism/1.jpeg
    publicId: { type: String, default: '' },
    caption: { type: String, default: '', maxlength: 240 },
    // true when the asset is served from our own /img folder (never uploaded)
    local: { type: Boolean, default: false },
    // optional player height hint for videos (unchanged default for the UI)
    height: { type: String, default: '' },
  },
  { _id: false }
);

/**
 * One document per gallery album (tab). Media are stored as URLs so that
 * legacy local files (./img/prism/1.jpeg) and new Cloudinary uploads coexist
 * exactly as they do on the current static page.
 */
const galleryAlbumSchema = new mongoose.Schema(
  {
    // Stable key used by the page (matches the existing section ids)
    key: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },

    // Tab label + section heading (e.g. "Dry Needling Workshop 1")
    title: { type: String, required: true, trim: true, maxlength: 140 },
    badge: { type: String, default: 'Workshop Highlights', trim: true, maxlength: 60 },
    description: { type: String, default: '', trim: true, maxlength: 400 },
    location: { type: String, default: '', trim: true, maxlength: 200 },

    photos: { type: [mediaItemSchema], default: [] }, // ordered images
    videos: { type: [mediaItemSchema], default: [] }, // ordered videos

    order: { type: Number, default: 0, index: true },
    published: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

/** Coerce a legacy plain-string entry into the item shape. */
function toItem(raw) {
  if (!raw) return { url: '', publicId: '', caption: '', local: true, height: '' };
  if (typeof raw === 'string') return { url: raw, publicId: '', caption: '', local: true, height: '' };
  return {
    url: raw.url || '',
    publicId: raw.publicId || '',
    caption: raw.caption || '',
    local: !!raw.local,
    height: raw.height || '',
  };
}

galleryAlbumSchema.methods.toPublic = function toPublic() {
  return {
    key: this.key,
    title: this.title,
    badge: this.badge,
    description: this.description,
    location: this.location,
    photos: this.photos.map(toItem),
    videos: this.videos.map(toItem),
    order: this.order,
    published: this.published,
  };
};

module.exports = mongoose.model('GalleryAlbum', galleryAlbumSchema);
