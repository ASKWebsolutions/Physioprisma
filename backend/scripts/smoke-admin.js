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
const sections = ['overview', 'requests', 'students', 'users', 'messages', 'courses', 'blogs', 'gallery', 'settings'];
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
ok('sidebar has 9 nav links', navLinks.length === 9, 'found ' + navLinks.length);

// counts
['nav-req-count', 'nav-stu-count', 'nav-course-count', 'nav-blog-count', 'nav-msg-count'].forEach(id =>
  ok('badge ' + id, !!doc.getElementById(id)));

// stat cards
['stat-users','stat-students','stat-ambassadors','stat-pending','stat-courses','stat-blogs','stat-enrollments','stat-media']
  .forEach(id => ok('stat ' + id, !!doc.getElementById(id)));

// panels with mount points
const mounts = ['activity-list','pending-list','approved-list','student-body','user-body','message-list','course-grid','blog-list','gallery-albums'];
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
const posts = [];
const fakePP = {
  getToken: () => 'tok',
  getUser: () => null,
  requireRole: () => Promise.resolve({ id: '1', name: 'Admin', email: 'a@b.c', role: 'admin', status: 'active' }),
  get: (p) => { calls.push('GET ' + p); return Promise.resolve(mockData(p)); },
  post: (p, body) => {
    calls.push('POST ' + p);
    posts.push({ path: p, body: body });
    if (p === '/admin/students') {
      return Promise.resolve({
        ok: true,
        message: 'Student created',
        student: { id: 's9', name: body.name, email: body.email, phone: body.phone, status: 'active' },
        credentials: { name: body.name, email: body.email, phone: body.phone, password: body.password },
      });
    }
    return Promise.resolve({ ok: true });
  },
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
  if (p.startsWith('/admin/stats')) return { ok: true, stats: { totalUsers: 4, students: 2, ambassadors: 1, pendingRequests: 1, courses: 2, publishedBlogs: 3, enrollments: 5, messages: 2, newMessages: 1 } };
  if (p.startsWith('/admin/activity')) return { ok: true, items: [{ icon: 'fa-user-graduate', text: '<strong>Ali</strong> registered as a student', time: '2026-10-01' }] };
  if (p.startsWith('/admin/requests?status=pending')) return { ok: true, requests: [{ id: 'r1', name: 'Hina Aslam', email: 'h@x.com', phone: '0333', city: 'Lahore', status: 'pending', joined: '2026-10-01' }] };
  if (p.startsWith('/admin/requests?status=approved')) return { ok: true, requests: [{ id: 'r2', name: 'Faisal', email: 'f@x.com', status: 'active', referralCode: 'PPABC123' }] };
  if (p.startsWith('/admin/students/track/')) {
    const roll = decodeURIComponent(p.split('/').pop());
    return {
      ok: true,
      student: { id: 's1', rollNo: roll, name: 'Ali Raza', email: 'ali@t.com', phone: '03001112222', city: 'Lahore', role: 'student', status: 'active', joined: '2026-10-01', lastLoginAt: '2026-10-02' },
      enrollments: [{ id: 'e1', title: 'Dry Needling', slug: 'dry-needling', image: '', progress: 68, status: 'active', readingSeconds: 80, referredBy: null, enrolledAt: '2026-10-01', lastAccessedAt: '2026-10-03', completedAt: null }],
      messages: [{ id: 'm9', name: 'Ali Raza', phone: '03001112222', email: 'ali@t.com', concern: 'Sports Injury', message: 'Need help with my shoulder', status: 'new', source: 'contact-form', createdAt: '2026-10-02' }],
      timeline: [
        { icon: 'fa-user-plus', label: 'Account created', at: '2026-10-01' },
        { icon: 'fa-book-open', label: 'Enrolled in Dry Needling', at: '2026-10-01' },
        { icon: 'fa-envelope', label: 'Sent a contact message about Sports Injury', at: '2026-10-02' },
      ],
      summary: { courses: 1, completed: 0, inProgress: 1, averageProgress: 68, messages: 1, lastLoginAt: '2026-10-02', lastActivityAt: '2026-10-02' },
    };
  }
  if (p.startsWith('/admin/students')) return { ok: true, students: [{ id: 's1', rollNo: 'PP-0007', name: 'Ali Raza', email: 'ali@t.com', course: 'Dry Needling', progress: 68, status: 'active', joined: '2026-10-01' }] };
  if (p.startsWith('/admin/users')) return { ok: true, users: [{ id: 'u1', name: 'Admin', email: 'a@b.c', role: 'admin', status: 'active', joined: '2026-01-01' }] };
  if (p.startsWith('/admin/contacts')) return { ok: true, messages: [
    { id: 'm1', name: 'Ayesha Khan', phone: '03001234567', email: 'ay@x.com', concern: 'Sports Injury', message: 'I have knee pain after cricket.', status: 'new', source: 'contact-form', createdAt: '2026-10-01' },
    { id: 'm2', name: 'Bilal Ahmed', phone: '03111111111', email: '', concern: 'Back / Neck Pain', message: 'Please call me back.', status: 'replied', source: 'contact-form', createdAt: '2026-09-28' },
  ], total: 2, unread: 1 };
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
  ok('student table has a roll no column',
    !!doc.querySelector('#sec-students thead') && /Roll No/.test(doc.querySelector('#sec-students thead').textContent));
  ok('roll number rendered', doc.getElementById('student-body').innerHTML.includes('PP-0007'));

  // roll number opens the student's track record
  const trackBtn = doc.querySelector('#student-body [data-track]');
  ok('track button rendered', !!trackBtn);
  if (trackBtn) {
    trackBtn.click();
    await new Promise(r => setTimeout(r, 150));
    ok('track modal opens', doc.getElementById('modal').classList.contains('show'));
    ok('track api called', calls.includes('GET /admin/students/track/PP-0007'), JSON.stringify(calls.filter(c => c.indexOf('/students/track') > -1)));
    ok('track title shows the roll no', doc.getElementById('modal-title').textContent.indexOf('PP-0007') > -1,
      doc.getElementById('modal-title').textContent);
    const trackBody = doc.getElementById('modal-body').innerHTML;
    ok('track shows the student', trackBody.includes('Ali Raza'));
    ok('track shows the course', trackBody.includes('Dry Needling'));
    ok('track shows the progress', trackBody.includes('68%'));
    ok('track shows the contact message', trackBody.includes('Need help with my shoulder'));
    ok('track shows the activity timeline', trackBody.includes('Account created') && trackBody.includes('Enrolled in Dry Needling'));
    ok('track shows summary chips', trackBody.includes('In Progress'));
    window.closeModal();
  }

  // top bar Track button: type a roll number and jump to the record
  ok('top bar has a Track button', !!doc.querySelector('#sec-students .panel-head .btn-outline'));
  window.openTrackLookup();
  await new Promise(r => setTimeout(r, 60));
  ok('track lookup modal opens', doc.getElementById('modal').classList.contains('show'));
  ok('track lookup has a roll no field', !!doc.getElementById('track-roll'));
  doc.getElementById('track-roll').value = 'pp-0007';
  window.startTrackLookup();
  await new Promise(r => setTimeout(r, 150));
  ok('lookup opens the record', doc.getElementById('modal-body').innerHTML.includes('Ali Raza'));
  ok('lookup normalises the roll no', doc.getElementById('modal-title').textContent === 'Track Record - PP-0007',
    doc.getElementById('modal-title').textContent);
  window.closeModal();

  // admin creates a student straight from the Students section
  ok('new student button present', !!doc.querySelector('#sec-students .btn-grad'));
  window.openStudentModal();
  await new Promise(r => setTimeout(r, 60));
  ok('student modal opens', doc.getElementById('modal').classList.contains('show'));
  ['s-name', 's-email', 's-phone', 's-city', 's-password'].forEach(id =>
    ok('student field ' + id, !!doc.getElementById(id)));
  doc.getElementById('s-gen').click();
  ok('generate fills a password', doc.getElementById('s-password').value.length >= 6);
  doc.getElementById('s-name').value = 'Hira Noor';
  doc.getElementById('s-email').value = 'hira@example.com';
  doc.getElementById('s-phone').value = '03451234567';
  doc.getElementById('s-city').value = 'Karachi';
  doc.getElementById('s-password').value = 'secret123';
  window.saveStudent();
  await new Promise(r => setTimeout(r, 200));
  const created = posts.find(x => x.path === '/admin/students');
  ok('create student API called', !!created);
  if (created) {
    ok('create payload name', created.body.name === 'Hira Noor');
    ok('create payload email', created.body.email === 'hira@example.com');
    ok('create payload phone', created.body.phone === '03451234567');
    ok('create payload password', created.body.password === 'secret123');
    ok('create payload city', created.body.city === 'Karachi');
  }
  ok('credentials screen shows password', doc.getElementById('modal-body').innerHTML.includes('secret123'));
  ok('credentials screen shows email', doc.getElementById('modal-body').innerHTML.includes('hira@example.com'));
  ok('credentials screen shows the login page', doc.getElementById('modal-body').innerHTML.includes('student-portal.html'));
  window.closeModal();
  ok('student modal closes', !doc.getElementById('modal').classList.contains('show'));

  window.showSection('users');
  await new Promise(r => setTimeout(r, 120));
  ok('users rendered', doc.getElementById('user-body').innerHTML.includes('Admin'));

  window.showSection('messages');
  await new Promise(r => setTimeout(r, 120));
  ok('messages loaded', calls.includes('GET /admin/contacts'));
  ok('message rendered', doc.getElementById('message-list').innerHTML.includes('Ayesha Khan'));
  ok('message shows the full text', doc.getElementById('message-list').innerHTML.includes('I have knee pain after cricket.'));
  ok('message shows phone + concern', doc.getElementById('message-list').innerHTML.includes('03001234567') &&
    doc.getElementById('message-list').innerHTML.includes('Sports Injury'));
  ok('replied message rendered', doc.getElementById('message-list').innerHTML.includes('Bilal Ahmed'));
  ok('unread badge', doc.getElementById('message-unread').textContent === '1 New',
    doc.getElementById('message-unread').textContent);
  ok('total badge', doc.getElementById('message-count').textContent === '2 Messages',
    doc.getElementById('message-count').textContent);
  ok('nav message badge', doc.getElementById('nav-msg-count').textContent === '1');
  ok('message search filters', (function () {
    const box = doc.getElementById('message-search');
    box.value = 'Bilal';
    window.renderMessages();
    const html = doc.getElementById('message-list').innerHTML;
    const okFiltered = html.includes('Bilal Ahmed') && !html.includes('Ayesha Khan');
    box.value = '';
    window.renderMessages();
    return okFiltered;
  })());

  const msgDel = doc.querySelector('[data-msg-del]');
  ok('message delete button exists', !!msgDel);
  if (msgDel) {
    msgDel.click();
    await new Promise(r => setTimeout(r, 60));
    ok('message delete asks for confirmation', doc.getElementById('confirm').classList.contains('show'));
    ok('message delete waits for confirmation',
      !calls.some(c => c.indexOf('DELETE /admin/contacts') === 0));
    doc.getElementById('confirm-yes').click();
    await new Promise(r => setTimeout(r, 200));
    ok('message delete calls API', calls.some(c => c === 'DELETE /admin/contacts/m1'),
      JSON.stringify(calls.filter(c => c.indexOf('DELETE') === 0)));
  }

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
