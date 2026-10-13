'use strict';
/**
 * Navbar "Projects" dropdown test.
 *
 * The panel must (a) be reachable - the gap between trigger and panel is
 * bridged, (b) toggle from the inline onclick without fighting the hover
 * rule, and (c) dismiss on outside click / Escape / mouseleave.
 *
 *   node scripts/navbar-test.js [baseUrl]
 */
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const BASE = process.argv[2] || 'http://localhost:5000';

let pass = 0, fail = 0;
const report = (n, ok, x) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  -> ' + x : ''}`); };

const apiSrc = fs
  .readFileSync(path.join(FRONTEND, 'js', 'api.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script>');
const navSrc = fs
  .readFileSync(path.join(FRONTEND, 'js', 'navbar.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script>');

function inline(html, tag, src) {
  return html.replace(tag, () => '<script>' + src + '</script>');
}

function boot(html, url, answers) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));
  virtualConsole.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = (target) => {
        const u = String(target);
        for (const key of Object.keys(answers || {})) {
          if (u.indexOf(key) > -1) {
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answers[key]) });
          }
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
    },
  });
  dom.errors = errors;
  return dom;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

function exercise(label, dom) {
  const doc = dom.window.document;
  const wrap = doc.querySelector('#desktop-projects-btn').closest('.dropdown');
  const menu = doc.getElementById('desktop-projects-dropdown');

  report(`${label}: page provides toggleDesktopProjects`, typeof dom.window.toggleDesktopProjects === 'function');
  report(`${label}: navbar.js overrode the toggle`, dom.window.toggleDesktopProjects.toString().indexOf('is-open') > -1,
    dom.window.toggleDesktopProjects.toString().slice(0, 60).replace(/\s+/g, ' '));

  const injected = Array.from(doc.head.querySelectorAll('style'))
    .map((s) => s.textContent).join('\n');
  report(`${label}: gap bridge injected`, injected.indexOf('.dropdown-menu::before') > -1);
  report(`${label}: is-open opens the panel`, injected.indexOf('.dropdown.is-open .dropdown-menu') > -1);
  report(`${label}: focus-within opens the panel`, injected.indexOf('.dropdown:focus-within .dropdown-menu') > -1);

  // inline onclick path
  doc.getElementById('desktop-projects-btn').click();
  report(`${label}: click opens the panel`, wrap.classList.contains('is-open'));
  doc.getElementById('desktop-projects-btn').click();
  report(`${label}: second click closes it`, !wrap.classList.contains('is-open'));

  // outside click
  doc.getElementById('desktop-projects-btn').click();
  doc.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  report(`${label}: outside click closes it`, !wrap.classList.contains('is-open'));

  // Escape
  doc.getElementById('desktop-projects-btn').click();
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  report(`${label}: Escape closes it`, !wrap.classList.contains('is-open'));

  // leaving the wrapper
  doc.getElementById('desktop-projects-btn').click();
  wrap.dispatchEvent(new dom.window.MouseEvent('mouseleave', { bubbles: false }));
  report(`${label}: mouseleave closes it`, !wrap.classList.contains('is-open'));

  // clicking inside must not close it
  doc.getElementById('desktop-projects-btn').click();
  menu.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  report(`${label}: click inside stays open`, wrap.classList.contains('is-open'));

  report(`${label}: no script errors`, dom.errors.length === 0, JSON.stringify(dom.errors.slice(0, 2)));
}

async function main() {
  /* ------------------------------------------------ coverage of all pages */
  const pages = fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html'));
  const withNav = pages.filter((f) => fs.readFileSync(path.join(FRONTEND, f), 'utf8').includes('desktop-projects-btn'));
  const wired = withNav.filter((f) => {
    const s = fs.readFileSync(path.join(FRONTEND, f), 'utf8');
    const bodyIdx = s.lastIndexOf('</body>');
    const tagIdx = s.indexOf('js/navbar.js');
    return tagIdx !== -1 && tagIdx < bodyIdx;
  });
  report('every desktop nav page loads js/navbar.js', wired.length === withNav.length,
    `${wired.length}/${withNav.length} missing: ` + withNav.filter((f) => !wired.includes(f)).join(', '));

  const navJs = fs.readFileSync(path.join(FRONTEND, 'js', 'navbar.js'), 'utf8');
  report('navbar.js bridges the 0.75rem gap', navJs.includes('top: -0.75rem'));
  report('navbar.js closes on outside click', navJs.includes('wrap.contains(e.target)'));
  report('navbar.js closes on Escape', navJs.includes("'Escape'"));

  /* ------------------------------------------------- hover-driven variant */
  {
    let html = fs.readFileSync(path.join(FRONTEND, 'home.html'), 'utf8');
    html = inline(html, '<script src="./js/api.js"></script>', apiSrc);
    html = inline(html, '<script src="./js/navbar.js"></script>', navSrc);
    const dom = boot(html, BASE + '/home.html', { '/api/courses': { courses: [] }, '/api/blogs': { blogs: [] } });
    await settle(300);
    exercise('home (hover variant)', dom);
    dom.window.close();
  }

  /* ----------------------------------------------- click-driven variant */
  {
    let html = fs.readFileSync(path.join(FRONTEND, 'about.html'), 'utf8');
    html = inline(html, '<script src="./js/navbar.js"></script>', navSrc);
    const dom = boot(html, BASE + '/about.html', {});
    await settle(200);
    exercise('about (click variant)', dom);
    dom.window.close();
  }

  console.log(`\n==== NAVBAR RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CRASHED:', e);
  process.exit(1);
});
