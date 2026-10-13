/**
 * migrate-media.js - upload every site media file to Cloudinary and point the
 * HTML pages / database records at the new URLs.
 *
 * Rules:
 *   - Originals are NEVER deleted, so a missed reference still works locally.
 *   - Uploads are idempotent (deterministic public_id + overwrite:false), so the
 *     script can be re-run safely.
 *   - Only references whose upload actually succeeded are rewritten.
 *   - Writes an old -> new manifest for rollback.
 *
 * Usage:
 *   node scripts/migrate-media.js             # migrate everything
 *   node scripts/migrate-media.js --dry-run   # show the plan, upload nothing
 */
const path = require('path');
const fs = require('fs');
const { cloudinary } = require('../config/cloudinary');

const ROOT = path.join(__dirname, '..', '..');
const FRONTEND = path.join(ROOT, 'frontend');
const BACKEND = path.join(__dirname, '..');
const MANIFEST = path.join(__dirname, 'media-migration-manifest.json');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.avif', '.bmp']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.ogv', '.ogg']);

const DRY = process.argv.includes('--dry-run');
const CONCURRENCY = 4;

/* ------------------------------------------------------------------ discovery */

function walk(dir, base, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, base, out);
    else {
      const ext = path.extname(e.name).toLowerCase();
      if (IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext)) {
        out.push({
          abs,
          // key as it appears in the site: "img/prism/1.jpeg"
          rel: path.relative(base, abs).split(path.sep).join('/'),
        });
      }
    }
  }
  return out;
}

function discover() {
  const files = walk(path.join(FRONTEND, 'img'), FRONTEND, []);
  walk(path.join(FRONTEND, 'videos'), FRONTEND, files);
  // the 3+ files the admin panel stored locally before Cloudinary was enabled
  walk(path.join(BACKEND, 'uploads'), BACKEND, files);
  return files;
}

/* --------------------------------------------------------------- public ids */

function publicIdFor(rel) {
  const noExt = rel.replace(/\.[^.]+$/, '');
  return (
    'physioprisma/site/' +
    noExt
      .replace(/[^A-Za-z0-9_./-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[_./]+|[_./]+$/g, '')
  );
}

const VIDEO_EXT_SET = VIDEO_EXT;
function resourceTypeOf(rel) {
  return VIDEO_EXT_SET.has(path.extname(rel).toLowerCase()) ? 'video' : 'image';
}

/* ------------------------------------------------------------------ upload */

function uploadOne(file, publicId) {
  const rt = resourceTypeOf(file.rel);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: rt,
        overwrite: false,
        unique_filename: false,
        use_filename: false,
        invalidate: true,
      },
      async (err, res) => {
        if (err) return reject(err);
        try {
          let url = res && res.secure_url;
          if (!url) {
            const info = await cloudinary.api.resource(publicId, { resource_type: rt });
            url = info.secure_url;
          }
          resolve({ url, existing: !!(res && res.existing), publicId, rt });
        } catch (e) {
          reject(e);
        }
      }
    );
    fs.createReadStream(file.abs).on('error', reject).pipe(stream);
  });
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (e) {
        results[i] = { ok: false, error: e };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/* ------------------------------------------------------------------- rewrite */

// Only touches real HTML attributes; the media check keeps us from touching
// anything that is not a local asset path.
const ATTR = /\b(?:src|href|poster|content|data-src)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const LOCAL = /(?:^|\/)(?:img|videos|uploads)\//i;

function normalize(v) {
  const k = (v || '').trim();
  return k.startsWith('./') ? k.slice(2) : k;
}

function rewriteHtml(file, map) {
  const before = fs.readFileSync(file, 'utf8');
  let changed = 0;
  const after = before.replace(ATTR, (match, _whole, dq, sq) => {
    const quote = sq !== undefined ? "'" : '"';
    const raw = (dq !== undefined ? dq : sq) || '';
    if (!LOCAL.test(raw) || raw.includes('cloudinary')) return match;
    const url = map.get(normalize(raw));
    if (!url) return match;
    changed++;
    const attr = match.slice(0, match.indexOf('='));
    return `${attr}=${quote}${url}${quote}`;
  });
  if (changed) fs.writeFileSync(file, after, 'utf8');
  return changed;
}

/* ---------------------------------------------------------------------- main */

(async () => {
  const files = discover();
  console.log(`\n== migrate-media ${DRY ? '(DRY RUN)' : ''} ==`);
  console.log(`media files found: ${files.length}`);

  // deterministic, collision-free public ids
  const used = new Map(); // publicId -> rel
  for (const f of files) {
    let pid = publicIdFor(f.rel);
    if (used.has(pid) && used.get(pid) !== f.rel) {
      let n = 2;
      while (used.has(`${pid}-${n}`)) n++;
      pid = `${pid}-${n}`;
    }
    used.set(pid, f.rel);
    f.publicId = pid;
    f.resourceType = resourceTypeOf(f.rel);
  }

  if (DRY) {
    files.slice(0, 15).forEach((f) =>
      console.log(`  ${f.rel}\n     -> [${f.resourceType}] ${f.publicId}`)
    );
    console.log(`  ... and ${Math.max(0, files.length - 15)} more`);
    return;
  }

  const t0 = Date.now();
  const results = await pool(files, CONCURRENCY, (f) => uploadOne(f, f.publicId));

  const map = new Map(); // local path (normalized) -> cloudinary url
  const manifest = [];
  let uploaded = 0,
    reused = 0,
    failed = 0;

  results.forEach((r, i) => {
    const f = files[i];
    if (!r.ok) {
      failed++;
      console.log(`  FAIL ${f.rel}: ${r.error.message || r.error}`);
      return;
    }
    const { url, existing } = r.value;
    existing ? reused++ : uploaded++;
    const key = normalize(f.rel);
    map.set(key, url);
    if (key.startsWith('uploads/')) map.set('/' + key, url);
    manifest.push({ from: key, to: url, publicId: f.publicId });
  });

  console.log(`uploaded: ${uploaded}   already present: ${reused}   failed: ${failed}`);
  console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (!manifest.length) {
    console.log('nothing to rewrite');
    return;
  }

  // ---- rewrite HTML
  const htmlFiles = fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html'));
  let htmlHits = 0,
    htmlTouched = 0;
  for (const f of htmlFiles) {
    const n = rewriteHtml(path.join(FRONTEND, f), map);
    if (n) {
      htmlHits += n;
      htmlTouched++;
      console.log(`  html  ${f}: ${n} reference(s)`);
    }
  }

  // ---- rewrite DB
  const { connectDB } = require('../config/db');
  const GalleryAlbum = require('../models/GalleryAlbum.model');
  const Course = require('../models/Course.model');
  const Blog = require('../models/Blog.model');
  await connectDB();

  let dbHits = 0,
    dbDocs = 0;
  for (const Model of [GalleryAlbum, Course, Blog]) {
    const raw = await Model.collection.find({}).toArray();
    for (const d of raw) {
      let hits = 0;
      const copy = JSON.parse(JSON.stringify(d));
      const walkVal = (v) => {
        if (typeof v === 'string') {
          const hit = map.get(normalize(v));
          if (hit) {
            hits++;
            return hit;
          }
          return v;
        }
        if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) v[i] = walkVal(v[i]);
          return v;
        }
        if (v && typeof v === 'object') {
          for (const k of Object.keys(v)) v[k] = walkVal(v[k]);
          return v;
        }
        return v;
      };
      walkVal(copy);
      if (!hits) continue;
      // NOTE: the _id on `copy` is a JSON string, so always match on the raw
      // ObjectId from `d` - otherwise updateOne silently matches 0 documents.
      delete copy._id;
      delete copy.__v;
      const r = await Model.collection.updateOne({ _id: d._id }, { $set: copy });
      if (!r.matchedCount) {
        console.log(`  db    ${Model.modelName} ${String(d._id).slice(-6)}: NO MATCH (not updated)`);
        continue;
      }
      dbDocs++;
      dbHits += hits;
      console.log(
        `  db    ${Model.modelName} ${String(d._id).slice(-6)}: ${hits} reference(s) (modified ${r.modifiedCount})`
      );
    }
  }
  // ---- reconcile storage flags
  // Rewriting the url is only half the job: media items also carry a `local`
  // flag (drives the admin storage badge) and a `publicId` (drives deletion).
  // Both have to agree with where the file actually lives now.
  const byUrl = new Map(manifest.map((e) => [e.to, e.publicId]));
  const isRepoPath = (url) => /^\.{0,2}\/?(?:img|videos|uploads)\//.test(url);
  const reconcile = (node) => {
    if (Array.isArray(node)) return node.forEach(reconcile);
    if (!node || typeof node !== 'object') return;
    if (typeof node.url === 'string') {
      const pid = byUrl.get(node.url);
      const wantLocal = pid ? false : isRepoPath(node.url);
      if (pid && node.publicId !== pid) node.publicId = pid;
      if (typeof node.local === 'boolean' && node.local !== wantLocal) node.local = wantLocal;
    }
    Object.values(node).forEach(reconcile);
  };

  let flagDocs = 0;
  for (const Model of [GalleryAlbum, Course, Blog]) {
    const raw = await Model.collection.find({}).toArray();
    for (const d of raw) {
      const copy = JSON.parse(JSON.stringify(d));
      const before = JSON.stringify(copy);
      reconcile(copy);
      if (JSON.stringify(copy) === before) continue;
      delete copy._id;
      delete copy.__v;
      const r = await Model.collection.updateOne({ _id: d._id }, { $set: copy });
      if (!r.matchedCount) {
        console.log(`  flags ${Model.modelName} ${String(d._id).slice(-6)}: NO MATCH (not updated)`);
        continue;
      }
      flagDocs++;
      console.log(`  flags ${Model.modelName} ${String(d._id).slice(-6)}: storage flags reconciled`);
    }
  }

  await require('mongoose').disconnect();

  console.log(`db: ${dbHits} reference(s) in ${dbDocs} document(s), ${flagDocs} document(s) with corrected storage flags`);

  fs.writeFileSync(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), count: manifest.length, map: manifest }, null, 2));
  console.log(`manifest: ${path.relative(ROOT, MANIFEST)} (${manifest.length} entries)`);

  // ---- verify nothing local is left behind
  const leftover = [];
  for (const f of htmlFiles) {
    const text = fs.readFileSync(path.join(FRONTEND, f), 'utf8');
    for (const m of text.matchAll(ATTR)) {
      const raw = (m[2] !== undefined ? m[2] : m[3]) || '';
      if (LOCAL.test(raw) && !raw.includes('cloudinary')) leftover.push(`${f}: ${raw}`);
    }
  }
  if (leftover.length) {
    console.log(`\nWARNING: ${leftover.length} local reference(s) NOT rewritten (upload failed or file missing):`);
    leftover.slice(0, 20).forEach((l) => console.log(`  - ${l}`));
  } else {
    console.log('\nHTML: 0 local media references left');
  }

  console.log(`\noriginals kept on disk - nothing deleted.`);
})().catch((e) => {
  console.error('MIGRATION FAILED:', e.message);
  process.exit(1);
});
