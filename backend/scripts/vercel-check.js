'use strict';

/**
 * Post-deploy / serverless check.
 *
 *   node scripts/vercel-check.js https://your-site.vercel.app
 *   node scripts/vercel-check.js http://localhost:5001     (local serverless sim)
 *
 * Verifies that the deployed project behaves like local: every page loads,
 * the API answers, auth is enforced and nothing leaks behind the rewrites.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const BASE = (process.argv[2] || 'http://localhost:5001').replace(/\/+$/, '');

let pass = 0;
let fail = 0;
const report = (name, ok, extra) => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

async function probe(urlPath, options) {
  try {
    const res = await fetch(BASE + urlPath, options);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      /* html */
    }
    return { status: res.status, text, json, headers: res.headers };
  } catch (err) {
    return { status: 0, text: '', json: null, error: err.message };
  }
}

async function main() {
  console.log(`Checking ${BASE}\n`);

  /* API ---------------------------------------------------------------- */
  {
    const { status, json } = await probe('/api/health');
    report('health endpoint', status === 200 && json && json.ok === true, `status=${status}`);
    report('database connected', json && json.db === 'connected', json && json.db);
  }
  {
    const { status, json } = await probe('/api/courses');
    report('public courses endpoint', status === 200 && Array.isArray(json && json.courses), `status=${status} count=${json && json.courses && json.courses.length}`);
  }
  {
    const { status, json } = await probe('/api/blogs');
    report('public blogs endpoint', status === 200 && Array.isArray(json && json.blogs), `status=${status}`);
  }
  {
    const { status } = await probe('/api/admin/stats');
    report('admin routes require a token', status === 401, `status=${status}`);
  }
  {
    const { status } = await probe('/api/does-not-exist');
    report('unknown api route 404', status === 404, `status=${status}`);
  }
  {
    const { status, json } = await probe('/api/track/PP-0000');
    report('public track lookup answers', (status === 200 || status === 404) && json && json.ok !== undefined, `status=${status}`);
  }

  /* Pages -------------------------------------------------------------- */
  const pages = fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html'));
  let pageOk = 0;
  for (const page of pages) {
    const { status, text } = await probe('/' + page);
    const ok = status === 200 && text.includes('Physioprisma');
    if (ok) pageOk += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  page ${page.padEnd(28)} ${status}`);
  }
  report('every page loads', pageOk === pages.length, `${pageOk}/${pages.length}`);

  /* Static assets + root ------------------------------------------------ */
  {
    const { status } = await probe('/js/navbar.js');
    report('shared navbar script', status === 200, `status=${status}`);
  }
  {
    const { status } = await probe('/');
    report('root serves the homepage', status === 200, `status=${status}`);
  }

  console.log(`\n==== VERCEL CHECK: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('CHECK CRASHED:', err.message);
  process.exit(1);
});
