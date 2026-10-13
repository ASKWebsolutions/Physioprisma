'use strict';

const express = require('express');

const GalleryAlbum = require('../models/GalleryAlbum.model');
const { asyncHandler, ApiError } = require('../middleware/error');

const router = express.Router();

/** Album as the public site may see it - no ids, no draft albums. */
function publicAlbum(album) {
  const item = (i) => ({ url: i.url, caption: i.caption || '', local: !!i.local, height: i.height || '' });
  return {
    key: album.key,
    title: album.title,
    badge: album.badge || '',
    description: album.description || '',
    location: album.location || '',
    order: album.order,
    photos: (album.photos || []).map(item),
    videos: (album.videos || []).map(item),
    updatedAt: album.updatedAt,
  };
}

/* ==================================================================== */
/* GET /api/gallery - every published category, in display order         */
/* ==================================================================== */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const albums = await GalleryAlbum.find({ published: true }).sort({ order: 1, createdAt: 1 });
    res.json({ ok: true, albums: albums.map(publicAlbum) });
  })
);

/* ==================================================================== */
/* GET /api/gallery/:key - a single published category                   */
/* ==================================================================== */
router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const album = await GalleryAlbum.findOne({ key: req.params.key, published: true });
    if (!album) throw ApiError.notFound('Category not found');
    res.json({ ok: true, album: publicAlbum(album) });
  })
);

module.exports = router;
