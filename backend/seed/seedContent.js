'use strict';

/**
 * Seeds the content that is currently hard-coded in the static pages into
 * MongoDB so the admin panel can manage it:
 *
 *   frontend/courses.html  -> 6 course cards
 *   frontend/blog.html     -> blog cards (slug, image, excerpt, author)
 *   frontend/blog-post.html-> full post HTML (const posts = {...})
 *   frontend/gallery.html  -> prism + southcity albums (photos & videos)
 *
 * Everything is copied verbatim (typos included) and the run is idempotent -
 * re-running updates existing documents instead of duplicating them.
 *
 *   node backend/seed/seedContent.js
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { env } = require('../config/env');
const { connectDB } = require('../config/db');
const { slugify } = require('../utils/slug');

const Course = require('../models/Course.model');
const Blog = require('../models/Blog.model');
const GalleryAlbum = require('../models/GalleryAlbum.model');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');

function read(file) {
  return fs.readFileSync(path.join(FRONTEND, file), 'utf8');
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same as stripTags but keeps paragraph breaks (used for the long "about" copy). */
function stripBlocks(html) {
  return String(html || '')
    .replace(/<\/p>\s*<p>/g, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/* ==================================================================== */
/* Courses                                                               */
/* ==================================================================== */

function parseCourses() {
  const html = read('courses.html');
  const gridStart = html.indexOf('COURSES GRID');
  let grid = html.slice(gridStart >= 0 ? gridStart : 0);

  // Stop before the CTA / footer, otherwise their <li> items leak into the
  // details of the last card.
  const cta = grid.indexOf('<!-- Call to Action');
  if (cta > 0) grid = grid.slice(0, cta);
  const footer = grid.indexOf('FOOTER');
  if (footer > 0) grid = grid.slice(0, footer);

  // Split on each card - the marker is unique enough and cards never nest
  const parts = grid.split(/<div class="course-card/).slice(1);

  return parts.map((chunk, i) => {
    const accent = /border-\[var\(--blue\)\]/.test(chunk.slice(0, 400)) ? 'blue' : 'purple';

    const title = stripTags((chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
    const description = stripTags((chunk.match(/<p class="text-gray-600 text-center mb-6">([\s\S]*?)<\/p>/) || [])[1]);
    const about = stripBlocks((chunk.match(/<template class="course-about">([\s\S]*?)<\/template>/) || [])[1]);

    const details = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = liRe.exec(chunk))) details.push(stripTags(m[1]));

    // Icon: FontAwesome class, or an <img> when the card uses artwork
    const iconMatch = chunk.match(/<i class="(fa-[a-z\- ]+)"><\/i>/);
    const imgMatch = chunk.match(/<img src="([^"]+)"/);
    const icon = iconMatch ? iconMatch[1].trim() : '';
    const image = imgMatch ? imgMatch[1] : '';
    // Short badge printed on the card artwork ("2 Days", "Advanced", ...)
    const badge = stripTags((chunk.match(/<span class="absolute[^"]*">([\s\S]*?)<\/span>/) || [])[1]);

    if (!title) return null;

    return {
      title,
      description,
      about,
      details,
      accent,
      icon: icon || (image ? 'fa-solid fa-book-open' : 'fa-solid fa-book-open'),
      image,
      level: badge,
      order: i,
      instructor: 'Physioprisma Academy',
      published: true,
    };
  }).filter(Boolean);
}

/* ==================================================================== */
/* Blog - cards from blog.html + full content from blog-post.html        */
/* ==================================================================== */

function parseBlogCards() {
  const html = read('blog.html');
  const gridStart = html.indexOf('BLOG POSTS GRID');
  let grid = html.slice(gridStart >= 0 ? gridStart : 0);

  const cta = grid.indexOf('<!-- Call to Action');
  if (cta > 0) grid = grid.slice(0, cta);
  const footer = grid.indexOf('FOOTER');
  if (footer > 0) grid = grid.slice(0, footer);

  const parts = grid.split(/<div class="blog-card/).slice(1);

  return parts.map((chunk) => {
    const slugMatch = chunk.match(/blog-post\.html\?id=([a-z0-9\-]+)/);
    if (!slugMatch) return null;

    const image = (chunk.match(/<img src="([^"]+)"/) || [])[1] || '';
    const title = stripTags((chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
    const excerpt = stripTags((chunk.match(/<p class="text-gray-600 line-clamp-3 mb-6">([\s\S]*?)<\/p>/) || [])[1]);
    const authorLine = stripTags((chunk.match(/<span class="text-gray-500 text-sm">([\s\S]*?)<\/span>/) || [])[1] || '');
    const author = authorLine.replace(/^by\s+/i, '');

    if (!title) return null;
    return { slug: slugMatch[1], title, image, excerpt, author };
  }).filter(Boolean);
}

/**
 * Extract `const posts = { ... }` from blog-post.html and evaluate it.
 * The literal only contains strings and template literals from our own file.
 */
function parsePostsObject() {
  const html = read('blog-post.html');
  const start = html.indexOf('const posts = {');
  if (start < 0) return {};

  const open = html.indexOf('{', start);
  let depth = 0;
  let end = -1;

  // Brace matching that ignores braces inside quotes / template literals
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    const prev = html[i - 1];
    if (ch === '\\') { i++; continue; }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      for (let j = i + 1; j < html.length; j++) {
        if (html[j] === '\\') { j++; continue; }
        if (html[j] === quote) { i = j; break; }
      }
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }

  if (end < 0) return {};

  const literal = html.slice(open, end);
  try {
    return new Function('return (' + literal + ');')();
  } catch (err) {
    console.warn('[seed:blogs] could not evaluate posts object:', err.message);
    return {};
  }
}

function parseBlogs() {
  const cards = parseBlogCards();
  const posts = parsePostsObject();

  const slugs = [];
  cards.forEach((c) => { if (!slugs.includes(c.slug)) slugs.push(c.slug); });
  Object.keys(posts).forEach((s) => { if (!slugs.includes(s)) slugs.push(s); });

  return slugs.map((slug, i) => {
    const card = cards.find((c) => c.slug === slug) || {};
    const post = posts[slug] || {};

    const title = card.title || post.title || slug;
    const content = post.content || '';
    if (!content) return null;

    return {
      slug,
      title,
      image: card.image || post.image || '',
      excerpt: card.excerpt || post.excerpt || '',
      author: card.author || post.author || 'Physioprisma Clinical Team',
      authorRole: post.authorRole || '',
      authorImage: post.authorImage || './img/logo pic (2).jpg',
      dateText: post.date || '',
      category: post.category || '',
      content,
      published: true,
      order: i,
    };
  }).filter(Boolean);
}

/* ==================================================================== */
/* Gallery - prism + southcity albums from gallery.html                  */
/* ==================================================================== */

/** Normalise a gallery media URL found in gallery.html into a stored asset. */
function toMedia(url) {
  const cloud = /res\.cloudinary\.com\/.+\/upload\//.test(url);
  return {
    url,
    publicId: cloud
      ? url.split('?')[0].replace(/^.*\/upload\//, '').replace(/^v\d+\//, '').replace(/\.[a-z0-9]+$/i, '')
      : '',
    caption: '',
    local: !cloud,
    height: '',
  };
}

function parseGallery() {
  const html = read('gallery.html');
  const albums = [];

  ['prism', 'southcity'].forEach((key) => {
    const open = html.indexOf('<section id="' + key + '"');
    if (open < 0) return;

    const close = html.indexOf('</section>', open);
    const chunk = html.slice(open, close > 0 ? close : undefined);

    const title = stripTags((chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1]);
    const badge = stripTags((chunk.match(/<span[^>]*uppercase">([\s\S]*?)<\/span>/) || [])[1]);
    const description = stripTags((chunk.match(/<p class="text-gray-500[^"]*">([\s\S]*?)<\/p>/) || [])[1]);
    const locMatch = chunk.match(/Location:<\/span>\s*([^<]+)/);
    const location = locMatch ? stripTags(locMatch[1]) : '';

    // gallery.html may reference the legacy ./img/<key>/ path or the migrated
    // Cloudinary asset - both must parse, otherwise a re-seed wipes the album.
    const localPat = '\\./img/' + key + '/[^"]+';
    const cloudPat = 'https://res\\.cloudinary\\.com/[^"]*/' + key + '/[^"]+';

    const photos = [];
    const phRe = new RegExp('<img src="(' + localPat + '|' + cloudPat + ')"', 'g');
    let m;
    while ((m = phRe.exec(chunk))) photos.push(toMedia(m[1]));

    const videos = [];
    const vdRe = new RegExp('<source src="(' + localPat + '|' + cloudPat + ')"', 'g');
    while ((m = vdRe.exec(chunk))) videos.push(toMedia(m[1]));

    albums.push({
      key,
      title: title || key,
      badge: badge || 'Workshop Highlights',
      description,
      location,
      photos,
      videos,
      published: true,
    });
  });

  // Keep the tab order used on the page (Workshop 1 first)
  return albums.sort((a, b) => (a.key === 'prism' ? -1 : b.key === 'prism' ? 1 : 0))
    .map((a, i) => Object.assign(a, { order: i }));
}

/* ==================================================================== */
/* Run                                                                   */
/* ==================================================================== */

async function upsertCourses(items) {
  let created = 0, updated = 0;
  for (const c of items) {
    const slug = slugify(c.title);
    const existed = !!(await Course.exists({ slug }));
    const res = await Course.findOneAndUpdate(
      { slug },
      {
        $set: {
          title: c.title, slug, description: c.description, details: c.details,
          accent: c.accent, icon: c.icon, instructor: c.instructor,
          published: c.published, order: c.order,
          // only set these when the card actually carries them (never wipe admin edits)
          ...(c.level ? { level: c.level } : {}),
          ...(c.about ? { about: c.about } : {}),
          ...(c.image ? { 'image.url': c.image, 'image.publicId': '' } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (existed) updated++; else created++;
  }
  return { created, updated };
}

async function upsertBlogs(items) {
  let created = 0, updated = 0;
  for (const b of items) {
    const existed = !!(await Blog.exists({ slug: b.slug }));
    const res = await Blog.findOneAndUpdate(
      { slug: b.slug },
      {
        $set: {
          title: b.title, content: b.content, excerpt: b.excerpt,
          author: b.author, authorRole: b.authorRole, authorImage: b.authorImage,
          dateText: b.dateText, category: b.category, published: b.published, order: b.order,
          ...(b.image ? { 'coverImage.url': b.image, 'coverImage.publicId': '' } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (existed) updated++; else created++;
  }
  return { created, updated };
}

async function upsertGallery(albums) {
  let created = 0, updated = 0;
  for (const a of albums) {
    const existed = !!(await GalleryAlbum.exists({ key: a.key }));
    const res = await GalleryAlbum.findOneAndUpdate(
      { key: a.key },
      {
        $set: {
          title: a.title, badge: a.badge, description: a.description,
          location: a.location, published: a.published, order: a.order,
          // Never overwrite an album's media with an empty parse - losing the
          // markup in gallery.html must not silently empty the gallery.
          ...(a.photos.length ? { photos: a.photos } : {}),
          ...(a.videos.length ? { videos: a.videos } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (existed) updated++; else created++;
  }
  return { created, updated };
}

async function main() {
  const courses = parseCourses();
  const blogs = parseBlogs();
  const gallery = parseGallery();

  if (!courses.length && !blogs.length && !gallery.length) {
    console.log('[seed] nothing parsed - check the frontend folder layout');
    process.exit(1);
  }

  console.log(`[seed] parsed ${courses.length} courses, ${blogs.length} blogs, ${gallery.length} albums`);

  await connectDB();

  const c = await upsertCourses(courses);
  const b = await upsertBlogs(blogs);
  const g = await upsertGallery(gallery);

  console.log(`[seed:courses]  ${c.created} created, ${c.updated} updated`);
  console.log(`[seed:blogs]    ${b.created} created, ${b.updated} updated`);
  console.log(`[seed:gallery]  ${g.created} created, ${g.updated} updated`);

  const [tc, tb, tg] = await Promise.all([Course.countDocuments(), Blog.countDocuments(), GalleryAlbum.countDocuments()]);
  console.log(`[seed] totals -> courses=${tc} blogs=${tb} albums=${tg}`);

  await mongoose.connection.close();
  console.log('[seed] done');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  });
}

module.exports = { parseCourses, parseBlogs, parseGallery, main };
