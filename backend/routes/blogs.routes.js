'use strict';

const express = require('express');

const Blog = require('../models/Blog.model');
const { asyncHandler, ApiError } = require('../middleware/error');

const router = express.Router();

/* ==================================================================== */
/* GET /api/blogs - published posts (cards, no body)                     */
/* ==================================================================== */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 500);
    const filter = { published: true };
    if (req.query.category) filter.category = String(req.query.category);
    if (req.query.q) filter.title = { $regex: String(req.query.q).slice(0, 120), $options: 'i' };

    const blogs = await Blog.find(filter).sort({ order: 1, createdAt: -1 }).limit(limit);
    res.json({ ok: true, count: blogs.length, blogs: blogs.map((b) => b.toList()) });
  })
);

/* ==================================================================== */
/* GET /api/blogs/:slug (or :id) - one published post with full content  */
/* ==================================================================== */
router.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const key = req.params.slug;
    const blog = await Blog.findOne({
      published: true,
      $or: [{ slug: key.toLowerCase() }, { _id: /^[0-9a-fA-F]{24}$/.test(key) ? key : '000000000000000000000000' }],
    });
    if (!blog) throw ApiError.notFound('Post not found');
    res.json({ ok: true, blog: blog.toDetail() });
  })
);

module.exports = router;
