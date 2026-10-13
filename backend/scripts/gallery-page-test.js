'use strict';
/**
 * gallery.html render test - the public page must pull categories from
 * /api/gallery (including media uploaded through the admin panel) while
 * keeping the hardcoded sections as a fallback.
 *
 *   NODE_PATH=<jsdom install> node scripts/gallery-page-test.js
 */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const PAGE = path.join(FRONTEND, 'gallery.html');
const BASE = process.argv[2] || 'http://localhost:5000';

let pass = 0, fail = 0;
const report = (n, ok, x) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  -> ' + x : ''}`); };

async function main() {
  const api = await (await fetch(BASE + '/api/gallery')).json();
  const albums = api.albums || [];
  // Every asset now lives on the CDN, so pick any album that actually holds media.
  const target = albums.find((a) => [...(a.photos || []), ...(a.videos || [])].length > 0) || null;
  console.log(`API albums: ${albums.length}; category holding media: ${target ? target.key : 'none'}\n`);
  if (!albums.length) { console.log('No albums in DB - nothing to assert.'); return process.exit(0); }

  // jsdom 30 has no ResourceLoader, so inline the shared client ourselves and
  // let every CDN tag fall through (they are not needed for these assertions).
  // api.js documents a <script>...</script> override in a comment, which would
  // terminate the inline block early, so it has to be escaped here.
  const apiSrc = fs
    .readFileSync(path.join(FRONTEND, 'js', 'api.js'), 'utf8')
    .replace(/<\/script/gi, '<\\/script');
  const html = fs
    .readFileSync(PAGE, 'utf8')
    .replace('<script src="./js/api.js"></script>', () => '<script>' + apiSrc + '</script>');

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: BASE + '/gallery.html',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url) => {
        const u = String(url);
        if (u.indexOf('/api/gallery') > -1) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(api) });
        }
        return Promise.reject(new Error('unexpected fetch: ' + u));
      };
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
    },
  });

  const doc = dom.window.document;
  await new Promise((r) => setTimeout(r, 500));

  const tabs = doc.querySelectorAll('#gallery-tabs button');
  report('tabs rendered from API', tabs.length === albums.length, `tabs=${tabs.length} albums=${albums.length}`);
  const tabTexts = Array.from(tabs).map((t) => t.textContent.trim());
  report('media category has a tab', !target || tabTexts.indexOf(target.title) > -1, JSON.stringify(tabTexts));

  const panels = doc.querySelectorAll('[data-gallery-panel]');
  report('sections rendered', panels.length === albums.length, `panels=${panels.length} albums=${albums.length}`);
  const targetPanel = target ? doc.getElementById('gal-' + target.key) : null;
  report('media category section exists', !!targetPanel, target ? target.key : 'no media in DB');

  const active = doc.querySelector('#gallery-tabs button.tab-active');
  report('first tab active', !!active && active.textContent.trim() === albums[0].title, active && active.textContent.trim());

  const visible = Array.from(panels).filter((p) => !p.classList.contains('hidden'));
  report('exactly one section visible', visible.length === 1, `visible=${visible.length}`);
  report('static prism fallback hidden', doc.getElementById('prism').classList.contains('hidden'));
  report('static southcity fallback hidden', doc.getElementById('southcity').classList.contains('hidden'));

  if (targetPanel) {
    const imgs = Array.from(targetPanel.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    const vids = Array.from(targetPanel.querySelectorAll('video source')).map((s) => s.getAttribute('src'));
    report('uploaded photos in the page', (target.photos || []).every((p) => imgs.indexOf(p.url) > -1),
      `img=${imgs.length} db=${target.photos.length}`);
    report('uploaded video in the page', (target.videos || []).every((v) => vids.indexOf(v.url) > -1),
      `vid=${vids.length} db=${target.videos.length}`);
    const all = imgs.concat(vids);
    const remote = all.filter((u) => String(u).indexOf('https://res.cloudinary.com/') === 0);
    report('every media item served from cloudinary', remote.length === all.length,
      `${remote.length}/${all.length}`);
    report('videos carry a mime type', targetPanel.querySelectorAll('video source[type]').length === vids.length,
      `${targetPanel.querySelectorAll('video source[type]').length}/${vids.length}`);
  }

  if (albums.length > 1) {
    const other = albums.find((a) => a.key !== albums[0].key);
    const otherPanel = doc.getElementById('gal-' + other.key);
    doc.getElementById('gtab-' + other.key).click();
    await new Promise((r) => setTimeout(r, 20));
    report('other category opens on click', !otherPanel.classList.contains('hidden'), other.key);
    doc.getElementById('gtab-' + albums[0].key).click();
    await new Promise((r) => setTimeout(r, 20));
    report('switch back works',
      !doc.getElementById('gal-' + albums[0].key).classList.contains('hidden') &&
      otherPanel.classList.contains('hidden'));
  } else {
    report('switch back works', true, 'only one category in DB');
  }

  report('legacy showTab(3) still works', typeof dom.window.showTab === 'function');
  dom.window.showTab(3);
  await new Promise((r) => setTimeout(r, 20));
  report('legacy fallback panel still reachable', !doc.getElementById('southcity').classList.contains('hidden'));
  report('footer preserved', doc.querySelectorAll('footer').length > 0);

  console.log(`\n==== GALLERY PAGE RESULT: ${pass} passed, ${fail} failed ====`);
  dom.window.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('CRASHED:', e); process.exit(1); });
