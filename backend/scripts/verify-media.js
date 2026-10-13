/**
 * verify-media.js - every migrated asset must still be served by the CDN.
 * Reads the manifest written by migrate-media.js and checks each URL.
 *
 *   node scripts/verify-media.js
 */
const path = require('path');
const fs = require('fs');

const MANIFEST = path.join(__dirname, 'media-migration-manifest.json');
const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const ATTR = /\b(?:src|href|poster|content|data-src)\s*=\s*("([^"]*)"|'([^']*)')/gi;

async function once(url) {
  let r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
  if (r.status === 405 || r.status === 501) {
    // some edge nodes dislike HEAD - fall back to a 1-byte ranged GET
    r = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(20000) });
  }
  return r.status >= 200 && r.status < 400 ? null : `HTTP ${r.status}`;
}

// CDN edge nodes occasionally drop a connection; retry before calling it broken.
async function head(url) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const err = await once(url);
      if (!err) return null;
      last = err;
      if (last.startsWith('HTTP 4')) return last; // a real 4xx won't get better
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return last;
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i]);
      }
    })
  );
  return out;
}

(async () => {
  if (!fs.existsSync(MANIFEST)) {
    console.log('no manifest found - run migrate-media.js first');
    process.exit(1);
  }
  const { map } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  console.log(`\n== verify-media (${map.length} migrated assets) ==`);

  // 1. manifest urls
  let bad = 0,
    ok = 0;
  const manifestResults = await pool(map, 8, (e) => head(e.to));
  manifestResults.forEach((err, i) => {
    if (err) {
      bad++;
      console.log(`  FAIL ${map[i].from}\n       ${map[i].to} -> ${err}`);
    } else ok++;
  });
  console.log(`manifest urls: ${ok} ok, ${bad} broken`);

  // 2. anything the HTML currently points at must be cloudinary and alive
  const htmlUrls = new Set();
  for (const f of fs.readdirSync(FRONTEND)) {
    if (!f.endsWith('.html')) continue;
    const text = fs.readFileSync(path.join(FRONTEND, f), 'utf8');
    for (const m of text.matchAll(ATTR)) {
      const raw = (m[2] !== undefined ? m[2] : m[3]) || '';
      if (raw.includes('res.cloudinary.com')) htmlUrls.add(raw);
    }
  }
  console.log(`distinct cloudinary urls referenced by HTML: ${htmlUrls.size}`);

  const htmlList = [...htmlUrls];
  const htmlResults = await pool(htmlList, 8, (u) => head(u));
  let htmlBad = 0;
  htmlResults.forEach((err, i) => {
    if (err) {
      htmlBad++;
      console.log(`  FAIL ${htmlList[i]} -> ${err}`);
    }
  });
  console.log(`html urls: ${htmlList.length - htmlBad} ok, ${htmlBad} broken`);

  const failed = bad + htmlBad;
  console.log(`\n==== MEDIA RESULT: ${map.length + htmlList.length - failed} passed, ${failed} failed ====`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('VERIFY FAILED:', e.message);
  process.exit(1);
});
