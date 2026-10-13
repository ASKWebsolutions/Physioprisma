'use strict';

const express = require('express');

const GalleryAlbum = require('../../models/GalleryAlbum.model');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { validate } = require('../../utils/validate');
const { upload, assertImageSize } = require('../../middleware/upload');
const { uploadBuffer, destroyAsset } = require('../../config/cloudinary');
const { slugify } = require('../../utils/slug');

const router = express.Router();

/** Media item -> clean public shape. */
function itemView(item) {
  return {
    url: item.url,
    publicId: item.publicId || '',
    caption: item.caption || '',
    local: !!item.local,
    height: item.height || '',
  };
}

function albumView(album) {
  return {
    key: album.key,
    title: album.title,
    badge: album.badge,
    description: album.description,
    location: album.location,
    photos: album.photos.map(itemView),
    videos: album.videos.map(itemView),
    order: album.order,
    published: album.published,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  };
}

/* ==================================================================== */
/* GET /api/admin/gallery - every album (unpublished included)           */
/* ==================================================================== */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const albums = await GalleryAlbum.find().sort({ order: 1, createdAt: 1 });
    res.json({ ok: true, albums: albums.map(albumView), storage: storageMode() });
  })
);

router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const album = await GalleryAlbum.findOne({ key: req.params.key });
    if (!album) throw ApiError.notFound('Album not found');
    res.json({ ok: true, album: albumView(album), storage: storageMode() });
  })
);

function storageMode() {
  const { env } = require('../../config/env');
  return env.cloudinary.configured ? 'cloudinary' : 'local';
}

/* ==================================================================== */
/* POST /api/admin/gallery - create a new category / album               */
/* ==================================================================== */
router.post(
  '/',
  validate({
    key: { type: 'slug', required: false, max: 60 },
    title: { type: 'string', min: 2, max: 140 },
    badge: { type: 'string', max: 60, required: false },
    description: { type: 'string', max: 400, required: false },
    location: { type: 'string', max: 200, required: false },
    published: { type: 'boolean', required: false },
  }),
  asyncHandler(async (req, res) => {
    const title = req.body.title;
    const key = req.body.key || slugify(title);

    if (!key) throw ApiError.badRequest('Could not build a category key from that title');
    if (await GalleryAlbum.exists({ key })) {
      throw ApiError.conflict(`A category with the key "${key}" already exists`);
    }

    const highest = await GalleryAlbum.findOne().sort({ order: -1 });

    const album = new GalleryAlbum({
      key,
      title,
      badge: req.body.badge || 'Workshop Highlights',
      description: req.body.description || '',
      location: req.body.location || '',
      published: req.body.published !== false,
      order: highest ? highest.order + 1 : 0,
      photos: [],
      videos: [],
    });

    try {
      await album.save();
    } catch (err) {
      if (err.code === 11000) throw ApiError.conflict(`A category with the key "${key}" already exists`);
      throw err;
    }

    res.status(201).json({ ok: true, album: albumView(album), storage: storageMode() });
  })
);

/* ==================================================================== */
/* PATCH /api/admin/gallery/:key - album metadata + publish toggle        */
/* ==================================================================== */
router.patch(
  '/:key',
  validate({
    title: { type: 'string', min: 2, max: 140, required: false },
    badge: { type: 'string', max: 60, required: false },
    description: { type: 'string', max: 400, required: false },
    location: { type: 'string', max: 200, required: false },
    published: { type: 'boolean', required: false },
    order: { type: 'number', required: false },
  }),
  asyncHandler(async (req, res) => {
    const album = await GalleryAlbum.findOne({ key: req.params.key });
    if (!album) throw ApiError.notFound('Category not found');

    for (const f of ['title', 'badge', 'description', 'location', 'published', 'order']) {
      if (req.body[f] !== undefined) album[f] = req.body[f];
    }
    await album.save();
    res.json({ ok: true, album: albumView(album) });
  })
);

/* ==================================================================== */
/* POST /api/admin/gallery/:key/items - add one photo or video           */
/* Two modes: multipart file (stored via the upload provider) or JSON     */
/* {url} pointing at an existing asset like ./img/prism/01.jpg.           */
/* ==================================================================== */
router.post(
  '/:key/items',
  upload.single('file'),
  validate({
    type: { type: 'enum', values: ['photo', 'video'] },
    caption: { type: 'string', max: 200, required: false },
  }),
  asyncHandler(async (req, res) => {
    const album = await GalleryAlbum.findOne({ key: req.params.key });
    if (!album) throw ApiError.notFound('Category not found');

    const type = req.body.type || 'photo';
    const bucket = type === 'video' ? 'videos' : 'photos';

    let item;
    if (req.file) {
      if (type === 'photo') assertImageSize(req.file);

      const uploaded = await uploadBuffer(req.file.buffer, {
        folder: `physioprisma/gallery/${album.key}`,
        resourceType: type === 'video' ? 'video' : 'image',
        filename: `${type}-${Date.now()}`,
      });

      item = {
        type,
        url: uploaded.url,
        publicId: uploaded.publicId || '',
        caption: req.body.caption || '',
        local: !!uploaded.local || !uploaded.publicId,
        height: '',
      };
    } else if (req.body.url) {
      // Keep an existing asset where it is (e.g. ./img/prism/03.jpg)
      const url = String(req.body.url);
      if (!/^(\.\/|\/|https?:\/\/)/i.test(url)) {
        throw ApiError.badRequest('Path must start with ./ , / or https://');
      }
      item = {
        type,
        url,
        publicId: '',
        caption: req.body.caption || '',
        local: true,
        height: '',
      };
    } else {
      throw ApiError.badRequest('Send a file (field "file") or an existing path in "url"');
    }

    album[bucket].push(item);
    await album.save();

    res.status(201).json({ ok: true, album: albumView(album), item: itemView(album[bucket].slice(-1)[0]) });
  })
);

/* ==================================================================== */
/* DELETE /api/admin/gallery/:key/items/:type/:index                     */
/* ==================================================================== */
router.delete(
  '/:key/items/:type/:index',
  asyncHandler(async (req, res) => {
    const album = await GalleryAlbum.findOne({ key: req.params.key });
    if (!album) throw ApiError.notFound('Category not found');

    const bucket = req.params.type === 'video' ? 'videos' : 'photos';
    const i = Number(req.params.index);
    const list = album[bucket];
    if (!Number.isInteger(i) || i < 0 || i >= list.length) throw ApiError.notFound('Item not found');

    const [removed] = list.splice(i, 1);
    await album.save();

    if (removed) {
      const resType = req.params.type === 'video' ? 'video' : 'image';
      await destroyAsset(removed.publicId || '', resType, removed.local ? removed.url : '');
    }

    res.json({ ok: true, album: albumView(album) });
  })
);

/* ==================================================================== */
/* POST /api/admin/gallery/:key/reorder                                  */
/* Body: { type: 'photo'|'video', order: [indexes...] }                  */
/* ==================================================================== */
router.post(
  '/:key/reorder',
  validate({
    type: { type: 'enum', values: ['photo', 'video'] },
    order: { type: 'array' },
  }),
  asyncHandler(async (req, res) => {
    const album = await GalleryAlbum.findOne({ key: req.params.key });
    if (!album) throw ApiError.notFound('Category not found');

    const bucket = req.body.type === 'video' ? 'videos' : 'photos';
    const list = album[bucket];
    const order = req.body.order;

    if (!Array.isArray(order) || order.length !== list.length) {
      throw ApiError.badRequest('order must contain every item index exactly once');
    }

    const seen = new Set(order);
    if (seen.size !== order.length || order.some((n) => !Number.isInteger(n) || n < 0 || n >= list.length)) {
      throw ApiError.badRequest('order contains duplicate or out-of-range indexes');
    }

    album[bucket] = order.map((n) => list[n]);
    await album.save();
    res.json({ ok: true, album: albumView(album) });
  })
);

/* ==================================================================== */
/* DELETE /api/admin/gallery/:key - whole category                       */
/* ==================================================================== */
router.delete(
  '/:key',
  asyncHandler(async (req, res) => {
    const album = await GalleryAlbum.findOne({ key: req.params.key });
    if (!album) throw ApiError.notFound('Category not found');

    // Remove stored media (local files off disk, cloud assets remotely)
    const removals = [
      ...album.photos.map((it) => ({ it, type: 'image' })),
      ...album.videos.map((it) => ({ it, type: 'video' })),
    ];
    await Promise.all(removals.map(({ it, type }) => destroyAsset(it.publicId || '', type, it.local ? it.url : '')));

    await album.deleteOne();
    res.json({ ok: true, message: `Category "${album.title}" deleted` });
  })
);

module.exports = router;
