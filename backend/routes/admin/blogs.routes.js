'use strict';

const express = require('express');

const Blog = require('../../models/Blog.model');
const { asyncHandler, ApiError } = require('../../middleware/error');
const { validate } = require('../../utils/validate');
const { upload, assertImageSize } = require('../../middleware/upload');
const { uploadBuffer, destroyAsset } = require('../../config/cloudinary');

const router = express.Router();

/** List/detail shape used by the admin blog manager. */
const publicBlog = (b) => ({
  ...b.toDetail(),
  id: b._id.toString(),
  updated: b.updatedAt,
});

/** Existing cover asset id (legacy posts store a plain local path instead). */
function coverPublicId(blog) {
  if (!blog.coverImage) return '';
  return typeof blog.coverImage === 'string' ? '' : blog.coverImage.publicId || '';
}

/* ==================================================================== */
/* GET /api/admin/blogs - everything, published or not                   */
/* ==================================================================== */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.published === 'true') filter.published = true;
    else if (req.query.published === 'false') filter.published = false;
    if (req.query.q) filter.title = { $regex: String(req.query.q), $options: 'i' };

    const blogs = await Blog.find(filter).sort({ createdAt: -1 });
    res.json({ ok: true, blogs: blogs.map(publicBlog) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const blog = await Blog.findById(req.params.id);
    if (!blog) throw ApiError.notFound('Blog not found');
    res.json({ ok: true, blog: publicBlog(blog) });
  })
);

/* ==================================================================== */
/* POST /api/admin/blogs                                                 */
/* ==================================================================== */
router.post(
  '/',
  validate({
    title: { type: 'string', min: 3, max: 200 },
    content: { type: 'string', min: 20, max: 500000 },
    category: { type: 'string', max: 60, required: false },
    author: { type: 'string', max: 120, required: false },
    authorRole: { type: 'string', max: 160, required: false },
    authorImage: { type: 'string', max: 500, required: false },
    dateText: { type: 'string', max: 60, required: false },
    excerpt: { type: 'string', max: 500, required: false },
    coverImage: { type: 'string', max: 600, required: false },
    published: { type: 'boolean', required: false },
  }),
  asyncHandler(async (req, res) => {
    const blog = new Blog({
      title: req.body.title,
      content: req.body.content,
      category: req.body.category || '',
      author: req.body.author || undefined,
      authorRole: req.body.authorRole || undefined,
      authorImage: req.body.authorImage || undefined,
      dateText: req.body.dateText || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      excerpt: req.body.excerpt || '',
      coverImage: req.body.coverImage || '',
      published: req.body.published !== false,
      createdBy: req.user._id,
    });

    try {
      await blog.save();
    } catch (err) {
      if (err.code === 11000) throw ApiError.conflict('A blog with this title/slug already exists');
      throw err;
    }

    res.status(201).json({ ok: true, blog: publicBlog(blog) });
  })
);

/* ==================================================================== */
/* PATCH /api/admin/blogs/:id                                            */
/* ==================================================================== */
router.patch(
  '/:id',
  validate({
    title: { type: 'string', min: 3, max: 200, required: false },
    content: { type: 'string', min: 20, max: 500000, required: false },
    category: { type: 'string', max: 60, required: false },
    author: { type: 'string', max: 120, required: false },
    authorRole: { type: 'string', max: 160, required: false },
    authorImage: { type: 'string', max: 500, required: false },
    dateText: { type: 'string', max: 60, required: false },
    excerpt: { type: 'string', max: 500, required: false },
    coverImage: { type: 'string', max: 600, required: false },
    published: { type: 'boolean', required: false },
  }),
  asyncHandler(async (req, res) => {
    const blog = await Blog.findById(req.params.id);
    if (!blog) throw ApiError.notFound('Blog not found');

    const allowed = ['title', 'content', 'category', 'author', 'authorRole', 'authorImage', 'dateText', 'excerpt', 'coverImage', 'published'];
    for (const f of allowed) {
      if (req.body[f] !== undefined) blog[f] = req.body[f];
    }

    try {
      await blog.save();
    } catch (err) {
      if (err.code === 11000) throw ApiError.conflict('A blog with this title/slug already exists');
      throw err;
    }

    res.json({ ok: true, blog: publicBlog(blog) });
  })
);

/* ==================================================================== */
/* POST /api/admin/blogs/:id/cover - multipart cover image               */
/* ==================================================================== */
router.post(
  '/:id/cover',
  upload.single('cover'),
  asyncHandler(async (req, res) => {
    const blog = await Blog.findById(req.params.id);
    if (!blog) throw ApiError.notFound('Blog not found');
    if (!req.file) throw ApiError.badRequest('No image file received (field name must be "cover")');
    assertImageSize(req.file);

    const uploaded = await uploadBuffer(req.file.buffer, {
      folder: 'physioprisma/blogs',
      resourceType: 'image',
      filename: `blog-${blog._id}`,
    });

    const prevId = coverPublicId(blog);
    const prevUrl = blog.coverImage ? blog.coverImage.url || '' : '';
    if (prevId || prevUrl) await destroyAsset(prevId, 'image', prevUrl);

    blog.coverImage = { url: uploaded.url, publicId: uploaded.publicId };
    await blog.save();

    res.json({ ok: true, coverImage: blog.coverImage, blog: publicBlog(blog) });
  })
);

/* ==================================================================== */
/* DELETE /api/admin/blogs/:id                                           */
/* ==================================================================== */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const blog = await Blog.findById(req.params.id);
    if (!blog) throw ApiError.notFound('Blog not found');

    const prevId = coverPublicId(blog);
    const prevUrl = blog.coverImage ? blog.coverImage.url || '' : '';
    if (prevId || prevUrl) destroyAsset(prevId, 'image', prevUrl).catch(() => {});

    await blog.deleteOne();
    res.json({ ok: true, message: 'Blog deleted' });
  })
);

module.exports = router;
