// Scans the HTML pages + the DB for media references and reports which of them
// are still local (relative) vs already on Cloudinary.
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const FRONTEND = path.join(ROOT, 'frontend');

// Only look inside real HTML attributes so paths containing spaces or
// parentheses (e.g. "./img/logo pic (2).jpg") are captured whole.
const ATTR = /\b(?:src|href|poster|data-src)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const MEDIA = /(?:^|\/)(?:img|videos|uploads)\//i;

function attrRefs(text) {
  const found = [];
  for (const m of text.matchAll(ATTR)) {
    const v = (m[2] ?? m[3] ?? '').trim();
    if (v && MEDIA.test(v) && !v.includes('cloudinary')) found.push(v);
  }
  return found;
}

function scanHtml() {
  const out = new Map(); // relative path -> [file:line, ...]
  for (const f of fs.readdirSync(FRONTEND)) {
    if (!f.endsWith('.html')) continue;
    const lines = fs.readFileSync(path.join(FRONTEND, f), 'utf8').split('\n');
    lines.forEach((ln, i) => {
      for (const ref of attrRefs(ln)) {
        const key = ref.replace(/^\.\//, '');
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(`${f}:${i + 1}`);
      }
    });
  }
  return out;
}

function scanJs() {
  const out = new Map();
  const dir = path.join(FRONTEND, 'js');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    lines.forEach((ln, i) => {
      if (MEDIA.test(ln) && !ln.includes('cloudinary')) {
        const key = ln.trim().replace(/^\.\//, '');
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(`js/${f}:${i + 1}`);
      }
    });
  }
  return out;
}

async function scanDb() {
  const { connectDB } = require(path.join(ROOT, 'backend', 'config', 'db'));
  const GalleryAlbum = require(path.join(ROOT, 'backend', 'models', 'GalleryAlbum.model'));
  const Course = require(path.join(ROOT, 'backend', 'models', 'Course.model'));
  const Blog = require(path.join(ROOT, 'backend', 'models', 'Blog.model'));
  await connectDB();
  const out = new Map();
  for (const m of [GalleryAlbum, Course, Blog]) {
    for (const d of await m.find({}).lean()) {
      const walk = (v, trail) => {
        if (typeof v === 'string') {
          if (MEDIA.test(v) && !v.includes('cloudinary')) {
            const key = v.replace(/^\.\//, '');
            if (!out.has(key)) out.set(key, []);
            out.get(key).push(`${m.modelName}${trail}`);
          }
        } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${trail}[${i}]`));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${trail}.${k}`);
      };
      walk(d, '');
    }
  }
  return out;
}

(async () => {
  const html = scanHtml();
  const js = scanJs();
  const db = await scanDb();

  const keys = [...new Set([...html.keys(), ...js.keys(), ...db.keys()])];
  const missing = [];
  let found = 0;
  for (const k of keys) {
    if (fs.existsSync(path.join(FRONTEND, k))) found++;
    else missing.push(k);
  }

  console.log(`distinct local media refs : ${keys.length}`);
  console.log(`  referenced in HTML  : ${html.size}`);
  console.log(`  referenced in JS    : ${js.size}`);
  console.log(`  referenced in DB    : ${db.size}`);
  console.log(`  file exists on disk : ${found}`);
  console.log(`  file MISSING        : ${missing.length}`);
  if (missing.length) {
    console.log('\nmissing (referenced but not on disk):');
    missing.forEach((k) => {
      const where = [...(html.get(k) || []), ...(js.get(k) || []), ...(db.get(k) || [])].slice(0, 3).join(', ');
      console.log(`  - ${k}\n      <- ${where}`);
    });
  }

  await require('mongoose').disconnect();
})().catch((e) => {
  console.error('SCAN FAILED:', e.message);
  process.exit(1);
});
