'use strict';
/**
 * Admin "Add Course to a student" UI test - the manual course grant on the
 * Track Record modal of frontend/admin-dashboard.html (plus the per-course
 * Remove button).
 *
 * Runs entirely against mocked API responses so it is fast and leaves the
 * database untouched.
 *
 *   node scripts/admin-grant-ui-test.js [baseUrl]
 */
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const BASE = process.argv[2] || 'http://localhost:5000';

let pass = 0, fail = 0;
const report = (n, ok, x) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  -> ' + x : ''}`); };
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const apiSrc = fs
  .readFileSync(path.join(FRONTEND, 'js', 'api.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script');

function pageHtml(name) {
  const html = fs.readFileSync(path.join(FRONTEND, name), 'utf8');
  return html.replace('<script src="./js/api.js"></script>', () => '<script>' + apiSrc + '</script>');
}

const TRACK = {
  ok: true,
  student: {
    id: 'st1', rollNo: 'PP-0001', name: 'Test Student', email: 't@test.com',
    phone: '0300-1111111', city: 'Lahore', role: 'student', status: 'active',
    joined: '2026-01-01T00:00:00.000Z', lastLoginAt: null,
  },
  enrollments: [{
    id: 'e1', title: 'Intro Course', slug: 'intro-course', image: '',
    progress: 40, status: 'in_progress', readingSeconds: 0, referredBy: null,
    enrolledAt: '2026-02-01T00:00:00.000Z', lastAccessedAt: null, completedAt: null,
  }],
  messages: [],
  timeline: [{ icon: 'fa-user-plus', label: 'Account created', at: '2026-01-01T00:00:00.000Z' }],
  summary: { courses: 1, completed: 0, inProgress: 1, averageProgress: 40, messages: 0 },
};

const COURSE_LIST = {
  ok: true,
  courses: [
    { id: 'c-intro', title: 'Intro Course', slug: 'intro-course', price: 500, published: true },
    { id: 'c-free', title: 'Free Course', slug: 'free-course', price: 0, published: true },
    { id: 'c-draft', title: 'Draft Course', slug: 'draft-course', price: 100, published: false },
  ],
};

const OWNED = { ok: true, courses: [{ id: 'c-intro', slug: 'intro-course', title: 'Intro Course', progress: 40, status: 'in_progress' }] };

const STUDENT_LIST = {
  ok: true,
  students: [
    { id: 'st-free', name: 'Free Student', email: 'free@t.com', rollNo: 'PP-0002', status: 'active', joined: '2026-01-02T00:00:00.000Z' },
    { id: 'st-had', name: 'Had Student', email: 'had@t.com', rollNo: 'PP-0003', status: 'active', joined: '2026-01-03T00:00:00.000Z' },
  ],
};

const STATS = {
  ok: true,
  stats: {
    totalUsers: 3, students: 1, ambassadors: 0, pendingRequests: 0, courses: 2,
    publishedBlogs: 0, enrollments: 1, galleryItems: 0, newMessages: 0,
  },
};

/** Mocked fetch that also records every mutating call. */
function makeFetch() {
  const calls = [];
  const fn = (target, init) => {
    const u = String(target);
    const method = ((init && init.method) || 'GET').toUpperCase();
    const body = init && init.body ? String(init.body) : '';
    calls.push({ url: u, method, body });

    const ok = (payload) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });

    if (u.indexOf('/auth/me') > -1) return ok({ ok: true, user: { id: 'a1', name: 'Admin', role: 'admin', status: 'active' } });
    if (u.indexOf('/admin/stats') > -1) return ok(STATS);
    if (u.indexOf('/admin/activity') > -1) return ok({ ok: true, items: [] });
    if (u.indexOf('/admin/students/track/') > -1) return ok(TRACK);
    if (u.indexOf('/admin/courses') > -1) return ok(COURSE_LIST);
    if (method === 'POST' && u.indexOf('/admin/students/st1/courses') > -1) {
      return ok({ ok: true, message: 'Free Course added to Test Student.' });
    }
    if (method === 'DELETE' && u.indexOf('/admin/students/st1/courses/') > -1) {
      return ok({ ok: true, message: 'Course removed.' });
    }
    if (u.indexOf('/admin/students/st1/courses') > -1) return ok(OWNED);
    if (u.indexOf('/admin/students/st-free/courses') > -1) return ok({ ok: true, courses: [] });
    if (u.indexOf('/admin/students/st-had/courses') > -1) {
      return ok({ ok: true, courses: [{ id: 'c-free', slug: 'free-course', title: 'Free Course' }] });
    }
    if (u.indexOf('/admin/students') > -1) return ok(STUDENT_LIST);
    return ok({ ok: true });
  };
  fn.calls = calls;
  return fn;
}

async function main() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));

  const dom = new JSDOM(pageHtml('admin-dashboard.html'), {
    runScripts: 'dangerously',
    url: `${BASE}/admin-dashboard.html#students`,
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = makeFetch();
      window.__calls = window.fetch.calls;
      window.localStorage.setItem('pp_token', 'test-token');
      window.localStorage.setItem('pp_user', JSON.stringify({ id: 'a1', name: 'Admin', role: 'admin', status: 'active' }));
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
    },
  });
  const win = dom.window;
  const doc = win.document;
  const calls = win.fetch.calls || null;
  await settle(500);

  /* ---------------------------------------------------------- track modal */
  win.openTrackModal('PP-0001');
  await settle(400);

  const grantBtn = doc.querySelector('[data-grant-course]');
  report('track modal: Add Course button is present', !!grantBtn, grantBtn ? '' : 'button missing');

  const rows = doc.querySelectorAll('[data-revoke-course]');
  report('track modal: each enrolled course has a Remove button',
    rows.length === 1 && rows[0].dataset.revokeCourse === 'intro-course',
    `${rows.length} remove button(s)`);
  report('track modal: course row still shows progress',
    /40%/.test(doc.getElementById('modal-body').textContent));

  /* ----------------------------------------------------------- add course */
  grantBtn.click();
  await settle(400);

  const modalTitle = doc.getElementById('modal-title').textContent;
  const sel = doc.getElementById('grant-course');
  const save = doc.getElementById('grant-save');
  report('add modal: opens with the student name',
    modalTitle.indexOf('Add Course - Test Student') === 0, modalTitle);

  if (!sel) {
    report('add modal: course select rendered', false, 'select missing');
  } else {
    const opts = Array.from(sel.options);
    const intro = opts.find((o) => o.value === 'c-intro');
    const free = opts.find((o) => o.value === 'c-free');
    const draft = opts.find((o) => o.value === 'c-draft');
    report('add modal: lists published courses, hides drafts',
      opts.length === 3 && !draft, `${opts.length} option(s)`);
    report('add modal: already-added course is disabled',
      !!intro && intro.disabled && /already added/.test(intro.textContent),
      intro ? intro.textContent : 'intro option missing');
    report('add modal: grant button waits for a selection',
      !!save && save.disabled);

    sel.value = 'c-free';
    sel.dispatchEvent(new win.Event('change'));
    await settle(50);
    report('add modal: grant button enables after picking', save && !save.disabled);

    save.click();
    await settle(400);

    const granted = (win.__calls || []).filter((c) => c.method === 'POST');
    const bodyOk = granted.some((c) => c.url.indexOf('/admin/students/st1/courses') > -1 && c.body.indexOf('c-free') > -1);
    report('add modal: POSTs the grant for the picked course', bodyOk,
      granted.map((c) => c.method + ' ' + c.url).join(' | '));
    report('add modal: returns to the track record afterwards',
      doc.getElementById('modal-title').textContent.indexOf('Track Record - PP-0001') === 0 &&
      !!doc.querySelector('[data-revoke-course]'),
      doc.getElementById('modal-title').textContent);
  }

  /* --------------------------------------------------------- remove course */
  const removeBtn = doc.querySelector('[data-revoke-course="intro-course"]');
  removeBtn.click();
  await settle(80);
  const confirmBox = doc.getElementById('confirm');
  report('remove: confirmation dialog opens',
    confirmBox && confirmBox.classList.contains('show') && /Remove course access\?/.test(doc.getElementById('confirm-title').textContent),
    doc.getElementById('confirm-title').textContent);

  doc.getElementById('confirm-yes').click();
  await settle(400);

  const deleted = (win.__calls || []).filter((c) => c.method === 'DELETE');
  report('remove: DELETEs the course by slug',
    deleted.length === 1 && deleted[0].url.indexOf('/admin/students/st1/courses/intro-course') > -1,
    deleted.map((c) => c.url).join(' | '));
  report('remove: refreshes the track record',
    doc.getElementById('modal-title').textContent.indexOf('Track Record') === 0);

  /* --------------------------- C) Courses section -> Add to a student */
  win.showSection('courses');
  await settle(400);
  report('courses section: every card has an Add button',
    doc.querySelectorAll('[data-course-assign]').length === COURSE_LIST.courses.length,
    `${doc.querySelectorAll('[data-course-assign]').length} Add button(s)`);

  win.openAssignModal('c-free');
  await settle(300);
  const aTitle = doc.getElementById('modal-title').textContent;
  const aBody = doc.getElementById('modal-body').textContent;
  report('assign modal: opens with the course summary',
    aTitle === 'Add Course to a Student' && /Free Course/.test(aBody) && /Free/.test(aBody),
    aTitle);

  const aSel = doc.getElementById('assign-student');
  report('assign modal: student list loads',
    aSel && aSel.options.length === STUDENT_LIST.students.length + 1,
    aSel ? `${aSel.options.length} option(s)` : 'select missing');

  const aSearch = doc.getElementById('assign-search');
  aSearch.value = 'had';
  aSearch.dispatchEvent(new win.Event('input'));
  await settle(50);
  const filtered = Array.from(doc.getElementById('assign-student').options);
  report('assign modal: search filters the list',
    filtered.length === 2 && filtered[1].textContent.indexOf('Had Student') === 0,
    filtered.map((o) => o.textContent).join(' | '));

  const hadSel = doc.getElementById('assign-student');
  hadSel.value = 'st-had';
  hadSel.dispatchEvent(new win.Event('change'));
  await settle(200);
  report('assign modal: already-enrolled student blocks the grant',
    doc.getElementById('assign-save').disabled &&
    /already has this course/.test(doc.getElementById('assign-status').textContent),
    doc.getElementById('assign-status').textContent.slice(0, 70));

  aSearch.value = 'free';
  aSearch.dispatchEvent(new win.Event('input'));
  await settle(50);
  const freeSel = doc.getElementById('assign-student');
  freeSel.value = 'st-free';
  freeSel.dispatchEvent(new win.Event('change'));
  await settle(200);
  const aSave = doc.getElementById('assign-save');
  report('assign modal: grant enables for a student without access',
    !aSave.disabled && /Ready - Free Student/.test(doc.getElementById('assign-status').textContent),
    doc.getElementById('assign-status').textContent.slice(0, 70));

  aSave.click();
  await settle(300);
  const grantedFree = (win.__calls || []).filter((c) =>
    c.method === 'POST' && c.url.indexOf('/admin/students/st-free/courses') > -1 && c.body.indexOf('c-free') > -1);
  report('assign modal: grants the course to the chosen student',
    grantedFree.length === 1, `${grantedFree.length} call(s)`);
  report('assign modal: closes after granting',
    !doc.getElementById('modal').classList.contains('show'));

  // jsdom cannot scroll / navigate - those "Not implemented" notes are noise.
  const realErrors = errors.filter((e) => !/Not implemented/.test(e));
  report('no script errors', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)));

  console.log(`\n==== ADMIN GRANT UI RESULT: ${pass} passed, ${fail} failed ====`);
  win.close();
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('ADMIN GRANT UI crashed:', err);
  process.exit(1);
});
