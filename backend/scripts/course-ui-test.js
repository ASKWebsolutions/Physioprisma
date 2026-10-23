'use strict';
/**
 * Course page UI test - the left module track, the lesson reader and the
 * quiz runner on frontend/course.html.
 *
 * Sets up a real course (2 modules, 2 lessons, 1 quiz) through the admin API,
 * then boots course.html in jsdom twice: once as a guest (everything locked)
 * and once as the enrolled student (reading + quiz flows).
 *
 *   node scripts/course-ui-test.js [baseUrl]
 */
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const BASE = process.argv[2] || 'http://localhost:5000';

const env = {};
fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});

let pass = 0, fail = 0;
const report = (n, ok, x) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  -> ' + x : ''}`); };
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const apiSrc = fs
  .readFileSync(path.join(FRONTEND, 'js', 'api.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script');

function pageHtml(name) {
  let html = fs.readFileSync(path.join(FRONTEND, name), 'utf8');
  html = html.replace('<script src="./js/api.js"></script>', () => '<script>' + apiSrc + '</script>');
  // enroll.js / navbar.js stay external - jsdom does not load them here.
  return html;
}

/** Boot course.html with window.fetch stubbed by URL fragment. */
function boot(html, url, answers, beforeParse) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));

  const calls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = (target, init) => {
        const u = String(target);
        calls.push({ url: u, body: init && init.body ? String(init.body) : '' });
        for (const key of Object.keys(answers)) {
          if (u.indexOf(key) > -1) {
            const a = typeof answers[key] === 'function' ? answers[key](u, init) : answers[key];
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(a) });
          }
        }
        return Promise.reject(new Error('unexpected fetch: ' + u));
      };
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      if (beforeParse) beforeParse(window);
    },
  });
  dom.errors = errors;
  dom.calls = calls;
  return dom;
}

async function api(method, p, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json */ }
  return { status: res.status, data };
}

const stamp = Date.now();
let adminToken = null;
let courseId = null;
let courseSlug = null;
let lessonIds = [];
let quizId = null;
let studentId = null;
let studentToken = null;

async function cleanup() {
  if (courseId && adminToken) await api('DELETE', `/api/admin/courses/${courseId}`, { token: adminToken });
  if (studentId && adminToken) {
    await api('PATCH', `/api/admin/students/${studentId}`, { body: { status: 'rejected' }, token: adminToken });
  }
}

async function main() {
  /* ---------------------------------------------------------- fixtures */
  {
    const { status, data } = await api('POST', '/api/auth/login', {
      body: { identity: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    adminToken = data && data.token;
    report('admin login', status === 200 && !!adminToken, `status=${status}`);
  }
  {
    const { status, data } = await api('POST', '/api/admin/courses', {
      body: { title: `E2E Course UI ${stamp}`, description: 'course ui test fixture with a long description', price: 500, creditHours: 0 },
      token: adminToken,
    });
    courseId = data && data.course && data.course.id;
    courseSlug = data && data.course && data.course.slug;
    await api('PATCH', `/api/admin/courses/${courseId}`, { body: { published: true }, token: adminToken });
    report('fixture course created', status === 201 && !!courseId, `status=${status}`);
  }
  {
    await api('POST', `/api/admin/courses/${courseId}/modules`, { body: { title: 'Module 1' }, token: adminToken });
    await api('POST', `/api/admin/courses/${courseId}/modules`, { body: { title: 'Module 2' }, token: adminToken });
    const full = await api('GET', `/api/admin/courses/${courseId}/full`, { token: adminToken });
    const mods = full.data.course.modules;
    for (const m of mods) {
      const l = await api('POST', `/api/admin/courses/${courseId}/modules/${m._id}/lessons`, {
        body: { title: `Lesson of ${m.title}`, minutes: 1, content: `Reading text for ${m.title}. Cupping increases blood flow.` },
        token: adminToken,
      });
      lessonIds.push(l.data.module.lessons[0]._id);
    }
    report('fixture modules + lessons created', mods.length === 2 && lessonIds.length === 2, `modules=${mods.length}`);
  }
  {
    const { status, data } = await api('POST', `/api/admin/quizzes/course/${courseId}`, {
      body: {
        title: 'Fixture quiz', passPercent: 50, moduleId: null,
        questions: [
          { question: 'Q one?', options: ['Yes', 'No'], correct: 0 },
          { question: 'Q two?', options: ['A', 'B'], correct: 1 },
        ],
      },
      token: adminToken,
    });
    quizId = data && data.quiz && data.quiz.id;
    report('fixture quiz created', status === 201 && !!quizId, `status=${status}`);
  }
  {
    const { data } = await api('POST', '/api/admin/students', {
      body: { name: 'E2E UI Student', email: `e2eui${stamp}@test.com`, phone: '0300-1111111', password: `e2eSecret${stamp % 100000}` },
      token: adminToken,
    });
    studentId = data && data.student && data.student.id;
    await api('POST', `/api/admin/students/${studentId}/courses`, { body: { courseId }, token: adminToken });
    const login = await api('POST', '/api/auth/login', {
      body: { identity: `e2eui${stamp}@test.com`, password: `e2eSecret${stamp % 100000}` },
    });
    studentToken = login.data && login.data.token;
    report('fixture student enrolled', !!studentId && !!studentToken, `status=${login.status}`);
  }

  const guestDetail = (await api('GET', `/api/courses/${courseSlug}`)).data;
  const memberDetail = (await api('GET', `/api/courses/${courseSlug}`, { token: studentToken })).data;

  /* ------------------------------------------------- A) guest view (locked) */
  {
    const dom = boot(
      pageHtml('course.html'),
      `${BASE}/course.html?id=${courseSlug}`,
      { [`/api/courses/${courseSlug}`]: guestDetail }
    );
    await settle(500);
    const doc = dom.window.document;

    const trackMods = doc.querySelectorAll('[data-track-module]');
    const summary = doc.getElementById('track-summary').textContent;
    report('guest: track lists both modules', trackMods.length === 2, `${trackMods.length} module(s)`);

    doc.querySelector('[data-track-module]').click();
    await settle(50);
    const lessonBtns = doc.querySelectorAll('[data-track-lesson]');
    report('guest: module expands to its lesson',
      lessonBtns.length === 1 && /enroll to start/.test(summary),
      `${lessonBtns.length} lesson(s), summary="${summary}"`);

    lessonBtns[0].click();
    await settle(50);
    const reader = doc.getElementById('lesson-reader');
    const lockBox = doc.getElementById('reader-lock');
    report('guest: locked lesson shows the purchase note',
      !reader.classList.contains('hidden') && !lockBox.classList.contains('hidden') &&
      /locked/i.test(lockBox.textContent) && doc.getElementById('reader-content').classList.contains('hidden'),
      lockBox.textContent.slice(0, 70));

    report('guest: quiz list asks the guest to enroll',
      /unlock with enrollment/i.test(doc.getElementById('quiz-list').textContent),
      doc.getElementById('quiz-list').textContent.slice(0, 60));
    report('guest: no script errors', dom.errors.length === 0, JSON.stringify(dom.errors.slice(0, 2)));
    dom.window.close();
  }

  /* --------------------------------------------- B) enrolled student (live) */
  {
    const readingResp = {
      ok: true, progress: 0, status: 'active', readingSeconds: 0, requiredSeconds: 120,
      creditHours: 0, completedAt: null, completedLessons: [], quizzesTotal: 1, quizzesPassed: 0,
      lesson: { lessonId: String(lessonIds[0]), seconds: 20, required: 60, done: false },
      certificateReady: false,
    };
    const enrollmentResp = {
      ok: true, enrolled: true,
      enrollment: {
        id: 'enr1', courseId, slug: courseSlug, title: 'fixture', progress: 0, status: 'active',
        readingSeconds: 0, requiredSeconds: 120, creditHours: 0, completedAt: null,
        completedLessons: [], lessonSeconds: {}, quizzesTotal: 1, quizzesPassed: 0,
      },
    };
    const quizListResp = {
      ok: true,
      quizzes: [{
        id: quizId, module: null, title: 'Fixture quiz', passPercent: 50, questionCount: 2, best: null,
        questions: [
          { id: 'q1', question: 'Q one?', options: ['Yes', 'No'] },
          { id: 'q2', question: 'Q two?', options: ['A', 'B'] },
        ],
      }],
    };
    const submitResp = {
      ok: true,
      result: { score: 100, correct: 2, total: 2, passed: true, passPercent: 50 },
      best: { score: 100, passed: true, attempts: 1 },
      enrollment: {
        progress: 20, status: 'active', quizzesTotal: 1, quizzesPassed: 1,
        completedLessons: [], certificateReady: false,
      },
    };

    const dom = boot(
      pageHtml('course.html'),
      `${BASE}/course.html?id=${courseSlug}`,
      {
        [`/api/courses/${courseSlug}`]: memberDetail,
        [`/api/student/enrollment/${courseSlug}`]: enrollmentResp,
        [`/api/student/courses/${courseSlug}/quizzes`]: quizListResp,
        '/api/student/reading': readingResp,
        [`/api/student/quizzes/${quizId}/submit`]: submitResp,
      },
      (window) => {
        window.localStorage.setItem('pp_token', 'test-token');
        window.localStorage.setItem('pp_user', JSON.stringify({ id: 'u1', name: 'UI Tester', role: 'student', status: 'active' }));
      }
    );
    await settle(500);
    const doc = dom.window.document;
    const win = dom.window;

    report('student: summary counts the lessons',
      /0 of 2 lessons completed/.test(doc.getElementById('track-summary').textContent),
      doc.getElementById('track-summary').textContent);

    doc.querySelector('[data-track-module]').click();
    await settle(50);
    const lessonBtn = doc.querySelector('[data-track-lesson]');
    lessonBtn.click();
    await settle(50);

    const reader = doc.getElementById('lesson-reader');
    const content = doc.getElementById('reader-content').textContent;
    report('student: reader shows the lesson text',
      !reader.classList.contains('hidden') && doc.getElementById('reader-lock').classList.contains('hidden') &&
      /Cupping increases blood flow/.test(content),
      content.slice(0, 60));

    await settle(600); // reading heartbeat fires on load/open
    report('student: reader clock shows the lesson time in words',
      /^20 seconds studied . 40 seconds left$/.test(doc.getElementById('reader-clock').textContent),
      doc.getElementById('reader-clock').textContent);

    const newList = doc.getElementById('quiz-list');
    const hasNewBadge = Array.from(newList.querySelectorAll('span'))
      .some((s) => s.textContent.trim() === 'new');
    report('student: quiz list shows the quiz as new',
      /Fixture quiz/.test(newList.textContent) && hasNewBadge,
      newList.textContent.replace(/\s+/g, ' ').slice(0, 80));

    doc.querySelector('[data-open-quiz]').click();
    await settle(50);
    const runner = doc.getElementById('quiz-runner');
    const radios = runner.querySelectorAll('input[type=radio]');
    report('student: quiz runner renders every option, no answers leaked',
      !runner.classList.contains('hidden') && runner.querySelectorAll('label').length === 4 && radios.length === 4 &&
      Array.from(radios).every((r) => !r.checked),
      `${runner.querySelectorAll('label').length} option(s)`);

    doc.getElementById('quiz-submit').click();
    await settle(150);
    const submits = dom.calls.filter((c) => c.url.indexOf(`/api/student/quizzes/${quizId}/submit`) > -1);
    report('student: submitting without answers is blocked client-side',
      submits.length === 0 && /Submit answers/.test(runner.textContent),
      `${submits.length} submit call(s)`);

    // Answer both questions correctly and submit for real.
    runner.querySelector('input[name="qq-0"][value="0"]').checked = true;
    runner.querySelector('input[name="qq-1"][value="1"]').checked = true;
    doc.getElementById('quiz-submit').click();
    await settle(200);

    report('student: quiz result shows the score',
      /Score 100%/.test(runner.textContent) && /Passed!/.test(runner.textContent),
      runner.textContent.replace(/\s+/g, ' ').match(/Score[^.]*\.?/g));
    report('student: quiz list keeps the best score badge',
      /100% passed/.test(doc.getElementById('quiz-list').textContent),
      doc.getElementById('quiz-list').textContent.replace(/\s+/g, ' ').slice(0, 80));
    report('student: progress note shows lessons + quizzes',
      /lessons 0\/2/.test(doc.getElementById('my-progress-note').textContent) &&
      /quizzes 1\/1/.test(doc.getElementById('my-progress-note').textContent),
      doc.getElementById('my-progress-note').textContent);

    doc.getElementById('reader-close').click();
    await settle(30);
    report('student: reader closes', doc.getElementById('lesson-reader').classList.contains('hidden'));

    doc.getElementById('quiz-close').click();
    await settle(30);
    report('student: quiz runner closes', doc.getElementById('quiz-runner').classList.contains('hidden'));

    report('student: no script errors', dom.errors.length === 0, JSON.stringify(dom.errors.slice(0, 3)));
    dom.window.close();
  }

  await cleanup();

  console.log(`\n==== COURSE UI RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error('COURSE UI crashed:', err);
  await cleanup();
  process.exit(1);
});
