'use strict';

/**
 * Cloudinary integration check - run with the server already up:
 *   node scripts/cloudinary-check.js [baseUrl]
 *
 * Verifies the credentials, that uploads really land on Cloudinary, that two
 * uploads never share a public_id (so replacing an asset can't destroy the new
 * one) and that every site asset migrated to the CDN is still alive.
 * Everything it uploads is destroyed again, so no test data is left behind.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5000';

let pass = 0, fail = 0;
const report = (n, ok, x) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  -> ' + x : ''}`); };

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// Loaded from the backend the same way the app loads it.
const backend = path.join(__dirname, '..');
const { cloudinary, uploadBuffer, destroyAsset } = require(path.join(backend, 'config', 'cloudinary'));
const { env } = require(path.join(backend, 'config', 'env'));

const uploaded = [];

async function call(method, apiPath, { body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (!form && body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + apiPath, {
    method,
    headers,
    body: form ? form : body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json */ }
  return { status: res.status, data };
}

async function main() {
  /* ---------------------------------------------------------------- 1. creds */
  if (!env.cloudinary.configured) {
    report('credentials present in backend/.env', false, 'CLOUDINARY_* still empty');
    return finish();
  }
  report('credentials present in backend/.env', true, 'cloud=' + env.cloudinary.cloudName);
  report('video limit matches free plan', env.cloudinary.maxVideoMB <= 100, env.cloudinary.maxVideoMB + ' MB');

  let pong = null;
  try { pong = await cloudinary.api.ping(); } catch (e) { pong = { error: e.message }; }
  report('Cloudinary credentials accepted (ping)', pong && pong.status === 'ok', JSON.stringify(pong));

  /* --------------------------------------------------------- 2. real upload */
  const folder = 'physioprisma/_selftest';
  let first;
  try {
    first = await uploadBuffer(PNG, { folder, resourceType: 'image', filename: 'probe' });
    uploaded.push(first);
  } catch (e) {
    report('upload reaches Cloudinary', false, e.message);
    return finish();
  }
  report('upload reaches Cloudinary', !!first && first.local === false, first && first.url);
  report('URL is on res.cloudinary.com', /^https:\/\/res\.cloudinary\.com\//.test(first.url), first.url);
  report('publicId returned', !!(first.publicId && first.publicId.indexOf('/') > -1), first.publicId);
  report('local flag is false', first.local === false);

  // the asset must actually be delivered
  try {
    const r = await fetch(first.url);
    const buf = Buffer.from(await r.arrayBuffer());
    report('uploaded image is delivered', r.status === 200 && buf.length === PNG.length, `status=${r.status} bytes=${buf.length}`);
  } catch (e) {
    report('uploaded image is delivered', false, e.message);
  }

  /* --------------------------------------- 3. same slot twice -> unique ids */
  // Mirrors replacing a course image / blog cover: same filename, twice.
  let second;
  try {
    second = await uploadBuffer(PNG, { folder, resourceType: 'image', filename: 'probe' });
    uploaded.push(second);
  } catch (e) {
    report('second upload of the same slot works', false, e.message);
    return finish();
  }
  report('second upload of the same slot works', true);
  report('publicIds never collide', first.publicId !== second.publicId, `${first.publicId} vs ${second.publicId}`);

  /* ---------------------------------------------------------- 4. destroy */
  const [victim] = uploaded;
  for (const [i, asset] of uploaded.entries()) {
    const res = await destroyAsset(asset.publicId, 'image');
    report(`asset ${i + 1} destroyed`, res.result === 'ok' || res.result === 'not found', res.result);
  }

  // Authoritative check: the Admin API must no longer know the public_id.
  let stillThere = false;
  try {
    await cloudinary.api.resource(victim.publicId, { resource_type: 'image' });
    stillThere = true;
  } catch (e) { /* 404 = gone, as expected */ }
  report('asset gone from Cloudinary library', !stillThere, victim.publicId);

  // Delivery: invalidate purges the CDN but propagation takes a few seconds.
  let status = 0;
  const started = Date.now();
  for (let attempt = 0; attempt < 20 && status !== 404; attempt += 1) {
    const r = await fetch(victim.url);
    status = r.status;
    if (status !== 404) await new Promise((r2) => setTimeout(r2, 1500));
  }
  report('destroyed asset no longer served', status === 404,
    `status=${status} after ${Math.round((Date.now() - started) / 1000)}s`);

  /* ------------------------------------------- 5. local assets still work */
  {
    const login = await call('POST', '/api/auth/login', {
      body: { identity: 'admin@physioprisma.com', password: process.env.ADMIN_PASSWORD || 'ChangeMe#12345', role: 'admin' },
    });
    const token = login.data && login.data.token;
    report('admin login', !!token, 'status=' + login.status);
    if (!token) return finish();

    const g = await call('GET', '/api/admin/gallery', { token });
    report('admin storage mode = cloudinary', g.data && g.data.storage === 'cloudinary', g.data && g.data.storage);

    const albums = (g.data && g.data.albums) || [];
    const items = albums.flatMap((a) => [...(a.photos || []), ...(a.videos || [])]);
    const legacy = items.filter((i) => i.local || String(i.url).indexOf('/uploads/') === 0 || String(i.url).startsWith('./img/'));
    report('no local media left in gallery', legacy.length === 0, `${legacy.length} local item(s)`);

    const remote = items.filter((i) => String(i.url).startsWith('https://res.cloudinary.com/'));
    report('gallery media served from cloudinary', items.length > 0 && remote.length === items.length,
      `${remote.length}/${items.length} on cloudinary`);

    // the migration never deletes the originals - they must still be on disk
    const manifestFile = path.join(__dirname, 'media-migration-manifest.json');
    if (fs.existsSync(manifestFile)) {
      const { map } = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const frontend = path.join(__dirname, '..', '..', 'frontend');
      const present = map.filter((e) => fs.existsSync(path.join(frontend, e.from)) || fs.existsSync(path.join(__dirname, '..', e.from)));
      report('originals kept on disk', present.length === map.length, `${present.length}/${map.length} files`);
    } else {
      report('originals kept on disk', false, 'manifest missing - run migrate-media');
    }
  }

  finish();
}

function finish() {
  if (uploaded.length) {
    Promise.all(uploaded.map((a) => destroyAsset(a.publicId, 'image'))).finally(() => {
      console.log(`\n==== CLOUDINARY RESULT: ${pass} passed, ${fail} failed ====`);
      process.exit(fail === 0 ? 0 : 1);
    });
    return;
  }
  console.log(`\n==== CLOUDINARY RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CRASHED:', e);
  process.exit(1);
});
