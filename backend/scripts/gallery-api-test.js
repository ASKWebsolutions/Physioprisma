'use strict';

/**
 * Gallery admin API test - run with the server already up:
 *   node scripts/gallery-api-test.js [baseUrl]
 *
 * Covers category create/update/delete, media upload (file + existing path),
 * reorder, auth gating and confirms the seeded albums stay untouched.
 * Creates and removes its own category, so the database is left as found.
 */
const BASE = process.argv[2] || 'http://localhost:5000';
let pass = 0, fail = 0;
const report = (n, ok, x) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  -> ' + x : ''}`); };

const fs = require('fs');
const path = require('path');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// A real (small) MP4 from the site itself - Cloudinary validates video
// containers, so a synthetic byte blob would be rejected.
const VIDEO_FIXTURE = path.join(__dirname, '..', '..', 'frontend', 'img', 'prism', '14.mp4');

async function call(method, path, { body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (form) { /* let fetch set multipart boundary */ }
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers,
    body: form ? form : (body === undefined ? undefined : JSON.stringify(body)),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json */ }
  return { status: res.status, data, raw: res };
}

/** Local urls are site-relative, Cloudinary urls are absolute. */
function fetchUrl(u) {
  return fetch(/^https?:\/\//i.test(u) ? u : BASE + u);
}

/** Where a newly uploaded asset is expected to live. */
function expectedPrefix(storage) {
  return storage === 'cloudinary' ? 'https://res.cloudinary.com/' : '/uploads/';
}

/**
 * DELETE responses are immediate but CDN invalidation is not, so poll until the
 * asset really stops being served (gives up after ~25s).
 */
async function statusAfterDelete(url) {
  let status = 0;
  for (let i = 0; i < 17 && status !== 404; i += 1) {
    const r = await fetchUrl(url);
    status = r.status;
    if (status !== 404) await new Promise((res) => setTimeout(res, 1500));
  }
  return status;
}

async function main() {
  const login = await call('POST', '/api/auth/login', { body: { identity: 'admin@physioprisma.com', password: process.env.ADMIN_PASSWORD || 'ChangeMe#12345', role: 'admin' } });
  const token = login.data && login.data.token;
  report('admin login', !!token, 'status=' + login.status);
  if (!token) return finish();

  const H = token;

  // 0. no-auth check on the new endpoint
  {
    const r = await call('POST', '/api/admin/gallery', { body: { title: 'X Category' } });
    report('create requires auth', r.status === 401, 'status=' + r.status);
  }

  // 1. create category
  let key = '';
  let storage = 'local';
  {
    const r = await call('POST', '/api/admin/gallery', {
      token: H,
      body: { title: 'Lahore Physio Summit 2026', badge: 'Conference Highlights', location: 'Lahore, Pakistan', description: 'Annual gathering of physiotherapists.' },
    });
    key = r.data && r.data.album && r.data.album.key;
    storage = (r.data && r.data.storage) || 'local';
    report('create category', r.status === 201 && key === 'lahore-physio-summit-2026', `status=${r.status} key=${key}`);
    report('new category starts empty', r.data && r.data.album && r.data.album.photos.length === 0 && r.data.album.videos.length === 0);
    report('storage mode reported', r.data && (r.data.storage === 'local' || r.data.storage === 'cloudinary'), storage);
  }

  // 2. duplicate key rejected
  {
    const r = await call('POST', '/api/admin/gallery', { token: H, body: { title: 'Other title', key } });
    report('duplicate key rejected', r.status === 409, 'status=' + r.status);
  }

  // 3. validation: missing title
  {
    const r = await call('POST', '/api/admin/gallery', { token: H, body: { badge: 'x' } });
    report('missing title rejected', r.status === 400, 'status=' + r.status);
  }

  // 4. upload a photo
  let photoUrl = '';
  {
    const fd = new FormData();
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'blue-square.png');
    fd.append('type', 'photo');
    fd.append('caption', 'First upload');
    const r = await call('POST', `/api/admin/gallery/${key}/items`, { token: H, form: fd });
    photoUrl = r.data && r.data.item && r.data.item.url;
    report('photo uploaded', r.status === 201 && !!photoUrl, `status=${r.status} url=${photoUrl}`);
    report('photo landed in the active storage', !!photoUrl && photoUrl.startsWith(expectedPrefix(storage)),
      `storage=${storage}`);
    report('local flag matches storage', r.data && r.data.item && r.data.item.local === (storage !== 'cloudinary'),
      `local=${r.data && r.data.item && r.data.item.local}`);
  }

  // 5. uploaded file is actually served
  {
    const res = await fetchUrl(photoUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    report('uploaded file served', res.status === 200 && buf.length === PNG.length, `status=${res.status} bytes=${buf.length}`);
  }

  // 6. path traversal in url rejected
  {
    const r = await call('POST', `/api/admin/gallery/${key}/items`, { token: H, body: { type: 'photo', url: '../../etc/passwd' } });
    report('bad path rejected', r.status === 400, 'status=' + r.status);
  }

  // 7. add by existing local path
  {
    const r = await call('POST', `/api/admin/gallery/${key}/items`, { token: H, body: { type: 'photo', url: './img/prism/1.jpeg' } });
    report('add by existing path', r.status === 201 && r.data.item.url === './img/prism/1.jpeg', 'status=' + r.status);
  }

  // 8. upload a video
  {
    if (!fs.existsSync(VIDEO_FIXTURE)) {
      report('video uploaded', false, 'fixture missing: ' + VIDEO_FIXTURE);
    } else {
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(VIDEO_FIXTURE)], { type: 'video/mp4' }), 'sample.mp4');
      fd.append('type', 'video');
      const r = await call('POST', `/api/admin/gallery/${key}/items`, { token: H, form: fd });
      const url = r.data && r.data.item && r.data.item.url;
      report('video uploaded', r.status === 201 && !!url && url.startsWith(expectedPrefix(storage)),
        `status=${r.status} url=${url || (r.data && r.data.error) || 'none'}`);
    }
  }

  // 9. reorder photos
  {
    const before = await call('GET', `/api/admin/gallery/${key}`, { token: H });
    const n = before.data.album.photos.length;
    const order = Array.from({ length: n }, (_, i) => n - 1 - i);
    const r = await call('POST', `/api/admin/gallery/${key}/reorder`, { token: H, body: { type: 'photo', order } });
    const got = r.data && r.data.album.photos.map((p) => p.url);
    report('reorder photos', r.status === 200 && JSON.stringify(got) === JSON.stringify(order.map((i) => before.data.album.photos[i].url)), 'status=' + r.status);
  }

  // 10. bad reorder rejected
  {
    const r = await call('POST', `/api/admin/gallery/${key}/reorder`, { token: H, body: { type: 'photo', order: [0, 0] } });
    report('bad reorder rejected', r.status === 400, 'status=' + r.status);
  }

  // 11. edit category details
  {
    const r = await call('PATCH', `/api/admin/gallery/${key}`, { token: H, body: { title: 'Lahore Physio Summit 2026 (updated)', published: false } });
    report('update category', r.status === 200 && r.data.album.title.includes('updated') && r.data.album.published === false, 'status=' + r.status);
  }

  // 12. delete the uploaded photo (the asset must disappear from storage)
  {
    const r = await call('GET', `/api/admin/gallery/${key}`, { token: H });
    const idx = r.data.album.photos.findIndex((p) => p.url === photoUrl);
    report('uploaded photo present in list', idx >= 0, 'index=' + idx);
    if (idx >= 0) {
      const del = await call('DELETE', `/api/admin/gallery/${key}/items/photo/${idx}`, { token: H });
      report('delete photo', del.status === 200, 'status=' + del.status);
      report('stored asset removed', (await statusAfterDelete(photoUrl)) === 404, `storage=${storage}`);
    }
  }

  // 13. delete the whole category
  {
    const r = await call('DELETE', `/api/admin/gallery/${key}`, { token: H });
    report('delete category', r.status === 200, 'status=' + r.status);
    const gone = await call('GET', `/api/admin/gallery/${key}`, { token: H });
    report('category gone', gone.status === 404, 'status=' + gone.status);
  }

  // 14. seeded albums untouched
  {
    const r = await call('GET', '/api/admin/gallery', { token: H });
    const list = r.data.albums || [];
    const prism = list.find((a) => a.key === 'prism');
    const south = list.find((a) => a.key === 'southcity');
    report('seeded albums intact', list.length >= 2 && prism && south, 'count=' + list.length);
    report('prism media intact', prism && prism.photos.length === 11 && prism.videos.length === 13,
      prism && `${prism.photos.length} photos / ${prism.videos.length} videos`);
    report('southcity media intact', south && south.photos.length === 8 && south.videos.length === 5,
      south && `${south.photos.length} photos / ${south.videos.length} videos`);
  }

  finish();
}

function finish() {
  console.log(`\n==== GALLERY RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('CRASHED:', e); process.exit(1); });
