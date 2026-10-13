'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = path.join(__dirname, '..', '..', 'frontend', 'admin-dashboard.html');
const html = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (extra ? '  -> ' + extra : '')); }
};

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;

// --- structural checks -------------------------------------------------
const sections = ['overview', 'requests', 'students', 'users', 'courses', 'blogs', 'gallery', 'settings'];
ok('has sidebar', !!doc.getElementById('sidebar'));
ok('has sidebar collapse btn', !!doc.getElementById('sb-collapse'));
ok('has mobile toggle', !!doc.getElementById('sb-toggle'));
ok('has backdrop', !!doc.getElementById('sb-backdrop'));
ok('no public navbar', !doc.querySelector('nav.bg-white.shadow-md'), 'top navbar removed');
ok('section title element', !!doc.getElementById('sec-title'));

sections.forEach(s => {
  ok('section #sec-' + s, !!doc.getElementById('sec-' + s));
  ok('nav link data-sec=' + s, !!doc.querySelector('.side-link[data-sec="' + s + '"]'));
});

const navLinks = doc.querySelectorAll('.sb-nav .side-link');
ok('sidebar has 8 nav links', navLinks.length === 8, 'found ' + navLinks.length);

// counts
['nav-req-count', 'nav-stu-count', 'nav-course-count', 'nav-blog-count'].forEach(id =>
  ok('badge ' + id, !!doc.getElementById(id)));

// stat cards
['stat-users','stat-students','stat-ambassadors','stat-pending','stat-courses','stat-blogs','stat-enrollments','stat-media']
  .forEach(id => ok('stat ' + id, !!doc.getElementById(id)));

// panels with mount points
const mounts = ['activity-list','pending-list','approved-list','student-body','user-body','course-grid','blog-list','gallery-albums'];
mounts.forEach(id => ok('mount #' + id, !!doc.getElementById(id)));

// modal + toast
ok('modal', !!doc.getElementById('modal'));
ok('toast', !!doc.getElementById('toast'));

// api client loaded before inline script
ok('api.js referenced', html.includes('./js/api.js'));
ok('PP guard present', html.includes("PP.requireRole('admin')"));
ok('admin login redirect', html.includes("admin-login.html"));

// no legacy localStorage demo data
ok('no demo data arrays', !html.includes('demoRequests') && !html.includes('demoStudents') && !html.includes('demoUsers'));
ok('no old pp_amb_requests list', !html.includes("localStorage.getItem(REQ_LIST_KEY)"));
ok('no old showTab function', !html.includes('function showTab('));

// --- run the inline script with a fake PP ------------------------------
const script = doc.querySelectorAll('script')[doc.querySelectorAll('script').length - 1];
const scriptText = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const calls = [];
const fakePP = {
  getToken: () => 'tok',
  getUser: () => null,
  requireRole: () => Promise.resolve({ id: '1', name: 'Admin', email: 'a@b.c', role: 'admin', status: 'active' }),
  get: (p) => { calls.push('GET ' + p); return Promise.resolve(mockData(p)); },
  post: (p) => { calls.push('POST ' + p); return Promise.resolve({ ok: true }); },
  patch: (p) => { calls.push('PATCH ' + p); return Promise.resolve({ ok: true }); },
  del: (p) => { calls.push('DELETE ' + p); return Promise.resolve({ ok: true }); },
  logout: () => {},
  esc: (v) => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
  formatDate: (v) => (v ? '01 Oct 2026' : ''),
  toast: (m) => { lastToast = m; },
  showError: (e, f) => (e && e.message) || f,
};
let lastToast = '';

function mockData(p) {
  if (p.startsWith('/admin/stats')) return { ok: true, stats: { totalUsers: 4, students: 2, ambassadors: 1, pendingRequests: 1, courses: 2, publishedBlogs: 3, enrollments: 5 } };
  if (p.startsWith('/admin/activity')) return { ok: true, items: [{ icon: 'fa-user-graduate', text: '<strong>Ali</strong> registered as a student', time: '2026-10-01' }] };
  if (p.startsWith('/admin/requests?status=pending')) return { ok: true, requests: [{ id: 'r1', name: 'Hina Aslam', email: 'h@x.com', phone: '0333', city: 'Lahore', status: 'pending', joined: '2026-10-01' }] };
  if (p.startsWith('/admin/requests?status=approved')) return { ok: true, requests: [{ id: 'r2', name: 'Faisal', email: 'f@x.com', status: 'active', referralCode: 'PPABC123' }] };
  if (p.startsWith('/admin/students')) return { ok: true, students: [{ id: 's1', name: 'Ali Raza', email: 'ali@t.com', course: 'Dry Needling', progress: 68, status: 'active', joined: '2026-10-01' }] };
  if (p.startsWith('/admin/users')) return { ok: true, users: [{ id: 'u1', name: 'Admin', email: 'a@b.c', role: 'admin', status: 'active', joined: '2026-01-01' }] };
  if (p.startsWith('/admin/courses/')) return { ok: true, course: { id: 'c1', title: 'T', lessons: [{ _id: 'l1', title: 'L1', duration: '5 min' }] } };
  if (p.startsWith('/admin/courses')) return { ok: true, courses: [{ id: 'c1', title: 'Dry Needling', description: 'Learn', lessons: 3, level: 'Basic', instructor: 'Dr Tuba', image: '', icon: 'fa-solid fa-syringe', accent: 'purple', published: true, details: ['d1'] }] };
  if (p.startsWith('/admin/blogs')) return { ok: true, blogs: [{ id: 'b1', title: 'Post One', category: 'Tips', author: 'Team', dateText: 'Oct 01, 2026', excerpt: 'ex', content: '<p>hello</p>', image: '', published: true, createdAt: '2026-10-01' }] };
  if (p.startsWith('/admin/gallery')) return { ok: true, albums: [{ key: 'prism', title: 'Prism', badge: 'Highlights', location: 'Lahore', description: 'd', published: true, photos: [{ url: './img/prism/01.jpg', publicId: '', caption: '', local: true }], videos: [] }] };
  if (p.startsWith('/auth/me')) return { ok: true, user: { id: '1', name: 'Admin', email: 'a@b.c', role: 'admin', status: 'active' } };
  return { ok: true };
}

window.PP = fakePP;
window.confirm = () => true;
window.scrollTo = () => {};
// emulate a desktop viewport (jsdom defaults to 1024, which is the mobile breakpoint)
Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });

// evaluate the inline script
try {
  window.eval(scriptText);
} catch (e) {
  ok('script executes', false, e.message);
}

const run = async () => {
  // allow the requireRole promise + section loads to settle
  await new Promise(r => setTimeout(r, 200));

  ok('started on overview', doc.getElementById('sec-overview').classList.contains('active'));
  ok('API stats called', calls.includes('GET /admin/stats'), JSON.stringify(calls));
  ok('API activity called', calls.includes('GET /admin/activity'));

  // section switching
  window.showSection('courses');
  await new Promise(r => setTimeout(r, 120));
  ok('courses section active', doc.getElementById('sec-courses').classList.contains('active'));
  ok('courses nav active', doc.querySelector('.side-link[data-sec="courses"]').classList.contains('active'));
  ok('title updated', doc.getElementById('sec-title').textContent === 'Courses');
  ok('courses API called', calls.includes('GET /admin/courses'));
  ok('course card rendered', doc.getElementById('course-grid').innerHTML.includes('Dry Needling'));

  window.showSection('blogs');
  await new Promise(r => setTimeout(r, 120));
  ok('blogs loaded', calls.includes('GET /admin/blogs'));
  ok('blog row rendered', doc.getElementById('blog-list').innerHTML.includes('Post One'));

  window.showSection('gallery');
  await new Promise(r => setTimeout(r, 120));
  ok('gallery loaded', calls.includes('GET /admin/gallery'));
  ok('album rendered', doc.getElementById('gallery-albums').innerHTML.includes('Prism'));

  window.showSection('requests');
  await new Promise(r => setTimeout(r, 150));
  ok('requests loaded', calls.includes('GET /admin/requests?status=pending'));
  ok('pending card rendered', doc.getElementById('pending-list').innerHTML.includes('Hina Aslam'));
  ok('approved card rendered', doc.getElementById('approved-list').innerHTML.includes('Faisal'));

  window.showSection('students');
  await new Promise(r => setTimeout(r, 120));
  ok('students rendered', doc.getElementById('student-body').innerHTML.includes('Ali Raza'));

  window.showSection('users');
  await new Promise(r => setTimeout(r, 120));
  ok('users rendered', doc.getElementById('user-body').innerHTML.includes('Admin'));

  window.showSection('settings');
  await new Promise(r => setTimeout(r, 120));
  ok('profile filled', doc.getElementById('profile-name').textContent === 'Admin');

  // stats applied to DOM
  ok('stat users filled', doc.getElementById('stat-users').textContent === '4');
  ok('nav request badge', doc.getElementById('nav-req-count').textContent === '1');

  // approve flow
  window.decideRequest('r1', 'active');
  await new Promise(r => setTimeout(r, 150));
  ok('approve PATCH called', calls.some(c => c === 'PATCH /admin/requests/r1'), JSON.stringify(calls.filter(c => c.startsWith('PATCH'))));

  // course modal
  window.showSection('courses');
  window.openCourseModal();
  await new Promise(r => setTimeout(r, 60));
  ok('course modal opens', doc.getElementById('modal').classList.contains('show'));
  ok('modal has title field', !!doc.getElementById('c-title'));
  window.closeModal();
  ok('modal closes', !doc.getElementById('modal').classList.contains('show'));

  // blog modal
  window.openBlogModal('b1');
  await new Promise(r => setTimeout(r, 60));
  ok('blog modal prefills title', doc.getElementById('b-title').value === 'Post One');
  ok('blog modal has content', !!doc.getElementById('b-content'));
  window.closeModal();

  // confirm dialog (the replacement for window.confirm / window.alert)
  ok('confirm dialog markup',
    !!doc.getElementById('confirm') && !!doc.getElementById('confirm-body') && !!doc.getElementById('confirm-foot'));
  ok('no native confirm/alert in the admin page', !/\bconfirm\s*\(|\balert\s*\(/.test(html));

  const cancelP = window.confirmDialog({ title: 'Delete this item?', message: 'Sure?', confirmLabel: 'Delete' });
  await new Promise(r => setTimeout(r, 60));
  ok('confirm dialog opens', doc.getElementById('confirm').classList.contains('show'));
  ok('confirm dialog title', doc.getElementById('confirm-title').textContent === 'Delete this item?');
  ok('confirm dialog shows message', doc.getElementById('confirm-body').innerHTML.includes('Sure?'));
  ok('confirm dialog has confirm button',
    (doc.getElementById('confirm-foot').innerHTML || '').includes('Delete'));
  doc.getElementById('confirm-no').click();
  ok('cancel resolves false', (await cancelP) === false);
  ok('confirm dialog closes on cancel', !doc.getElementById('confirm').classList.contains('show'));

  const okP = window.confirmDialog({ title: 'Delete?', message: 'm', confirmLabel: 'Delete' });
  await new Promise(r => setTimeout(r, 60));
  doc.getElementById('confirm-yes').click();
  ok('accept resolves true', (await okP) === true);
  ok('confirm dialog closes on accept', !doc.getElementById('confirm').classList.contains('show'));

  // tile delete must stack its confirm on top of the open album modal
  window.showSection('gallery');
  await new Promise(r => setTimeout(r, 80));
  window.openAlbum('prism');
  await new Promise(r => setTimeout(r, 60));
  ok('album modal opens', doc.getElementById('modal').classList.contains('show'));
  const tile = doc.querySelector('[data-del-tile]');
  ok('tile delete button exists', !!tile);
  if (tile) {
    tile.click();
    await new Promise(r => setTimeout(r, 60));
    ok('tile confirm stacks over album modal',
      doc.getElementById('confirm').classList.contains('show') &&
      doc.getElementById('modal').classList.contains('show'));
    ok('tile delete waits for confirmation',
      !calls.some(c => c.indexOf('DELETE /admin/gallery/prism/items') === 0));
    doc.getElementById('confirm-no').click();
    await new Promise(r => setTimeout(r, 40));
    ok('cancelling keeps album modal open', doc.getElementById('modal').classList.contains('show'));
    window.closeModal();
    await new Promise(r => setTimeout(r, 40));
    ok('album modal closes', !doc.getElementById('modal').classList.contains('show'));
  }

  // gallery category delete goes through the modal, never window.confirm
  const delCat = doc.querySelector('[data-album-del]');
  ok('gallery delete button exists', !!delCat);
  if (delCat) {
    delCat.click();
    await new Promise(r => setTimeout(r, 60));
    ok('gallery delete opens confirm modal', doc.getElementById('confirm').classList.contains('show'));
    ok('no API call before confirmation',
      !calls.some(c => c.indexOf('DELETE /admin/gallery/') === 0));
    doc.getElementById('confirm-yes').click();
    await new Promise(r => setTimeout(r, 150));
    ok('gallery delete calls API after confirmation',
      calls.some(c => c === 'DELETE /admin/gallery/prism'),
      JSON.stringify(calls.filter(c => c.indexOf('DELETE') === 0)));
  }

  // sidebar collapse
  window.toggleSidebar();
  const collapsed = doc.getElementById('sidebar').classList.contains('collapsed');
  ok('sidebar collapses', collapsed);
  window.toggleSidebar();
  ok('sidebar expands', !doc.getElementById('sidebar').classList.contains('collapsed'));

  console.log('\n==== RESULT: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
};

run();
