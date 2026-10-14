'use strict';

/**
 * API smoke test - run with the server already up:
 *   node scripts/smoke.js [baseUrl]
 *
 * Covers the Phase 1 auth surface: validation, registration, approval gate,
 * admin login, token verification and role protection.
 */

const BASE = process.argv[2] || 'http://localhost:5000';
const stamp = Date.now();
let pass = 0;
let fail = 0;

function report(name, ok, extra) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  -> ${extra}` : ''}`);
}

async function call(method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* non-json */
  }
  return { status: res.status, data };
}

async function main() {
  // 1. Health
  {
    const { status, data } = await call('GET', '/api/health');
    report('health endpoint', status === 200 && data && data.ok === true, `status=${status}`);
    report('database connected', data && data.db === 'connected', `db=${data && data.db}`);
  }

  // 2. Validation - missing fields rejected
  {
    const { status, data } = await call('POST', '/api/auth/register', { body: {} });
    report('register rejects empty payload', status === 400 && data && data.ok === false, `status=${status}`);
  }

  // 3. Register a student (pending)
  const studentEmail = `student${stamp}@test.com`;
  {
    const { status, data } = await call('POST', '/api/auth/register', {
      body: { name: 'Test Student', email: studentEmail, phone: '0300-1234567', password: 'secret12' },
    });
    report('student registration', status === 201 && data && data.requiresApproval === true, `status=${status}`);
  }

  // 4. Duplicate email -> 409
  {
    const { status } = await call('POST', '/api/auth/register', {
      body: { name: 'Again', email: studentEmail, phone: '0300-1234567', password: 'secret12' },
    });
    report('duplicate email rejected', status === 409, `status=${status}`);
  }

  // 5. Pending student cannot log in
  {
    const { status, data } = await call('POST', '/api/auth/login', {
      body: { identity: studentEmail, password: 'secret12' },
    });
    report('pending login blocked', status === 403 && data && data.code === 'PENDING', `status=${status} code=${data && data.code}`);
  }

  // 6. Wrong password -> 401
  {
    const { status } = await call('POST', '/api/auth/login', {
      body: { identity: 'admin@physioprisma.com', password: 'wrong-password' },
    });
    report('wrong password rejected', status === 401, `status=${status}`);
  }

  // 7. Admin login
  let adminToken = '';
  {
    const { status, data } = await call('POST', '/api/auth/login', {
      body: { identity: 'admin@physioprisma.com', password: process.env.ADMIN_PASSWORD || 'ChangeMe#12345', role: 'admin' },
    });
    adminToken = (data && data.token) || '';
    report('admin login', status === 200 && adminToken.length > 0, `status=${status}`);
    report('admin payload has role', data && data.user && data.user.role === 'admin', `role=${data && data.user && data.user.role}`);
    report('password hash never returned', !JSON.stringify(data).includes('$2a') && !(data.user && 'password' in data.user));
  }

  // 8. Student credentials must NOT open the admin endpoint (role gate)
  {
    // log in as the still-pending student is impossible, so use the admin token
    // against a student-only expectation instead
    const { status, data } = await call('POST', '/api/auth/login', {
      body: { identity: 'admin@physioprisma.com', password: process.env.ADMIN_PASSWORD || 'ChangeMe#12345', role: 'student' },
    });
    report('role expectation enforced', status === 403, `status=${status}`);
  }

  // 9. /auth/me with token
  {
    const { status, data } = await call('GET', '/api/auth/me', { token: adminToken });
    report('me returns session', status === 200 && data && data.user && data.user.email === 'admin@physioprisma.com', `status=${status}`);
  }

  // 10. /auth/me without token -> 401
  {
    const { status } = await call('GET', '/api/auth/me');
    report('me requires token', status === 401, `status=${status}`);
  }

  // 11. Garbage token -> 401
  {
    const { status } = await call('GET', '/api/auth/me', { token: 'not.a.real.token' });
    report('invalid token rejected', status === 401, `status=${status}`);
  }

  // 12. Unknown API route -> 404 JSON
  {
    const { status, data } = await call('GET', '/api/definitely-not-a-route');
    report('unknown api route 404', status === 404 && data && data.ok === false, `status=${status}`);
  }

  // 13. Static site is served by the same server
  {
    const res = await fetch(`${BASE}/home.html`);
    const html = await res.text();
    report('frontend served', res.status === 200 && html.includes('Physioprisma'), `status=${res.status}`);
  }

  // 14. 404 page for unknown site route is HTML
  {
    const res = await fetch(`${BASE}/no-such-page.html`);
    const html = await res.text();
    report('site 404 is html', res.status === 404 && html.includes('404'), `status=${res.status}`);
  }

  // 15. Admin creates a student who can log in straight away
  {
    const email = `created${stamp}@test.com`;
    const phone = '03009876543';
    const password = 'created123';

    const created = await call('POST', '/api/admin/students', {
      token: adminToken,
      body: { name: 'Created Student', email, phone, password, city: 'Lahore' },
    });
    const creds = (created.data && created.data.credentials) || null;
    report('admin creates student', created.status === 201 && created.data && created.data.ok === true, `status=${created.status}`);
    report('credentials handed back', !!creds && creds.email === email && creds.password === password, JSON.stringify(creds));
    report('created student is active', !!(created.data && created.data.student && created.data.student.status === 'active'),
      created.data && created.data.student && created.data.student.status);

    if (creds) {
      const byEmail = await call('POST', '/api/auth/login', { body: { identity: creds.email, password, role: 'student' } });
      report('created student logs in with email', byEmail.status === 200 && !!(byEmail.data && byEmail.data.token), `status=${byEmail.status}`);

      const byPhone = await call('POST', '/api/auth/login', { body: { identity: creds.phone, password, role: 'student' } });
      report('created student logs in with phone', byPhone.status === 200 && !!(byPhone.data && byPhone.data.token), `status=${byPhone.status}`);
    }

    const dup = await call('POST', '/api/admin/students', {
      token: adminToken,
      body: { name: 'Again', email, phone: '03001112222', password },
    });
    report('duplicate student email rejected', dup.status === 409, `status=${dup.status}`);
  }

  // 16. Creating a student is admin-only
  {
    const { status } = await call('POST', '/api/admin/students', {
      body: { name: 'No Token', email: `notoken${stamp}@test.com`, phone: '03001112223', password: 'created123' },
    });
    report('create student requires admin token', status === 401, `status=${status}`);
  }

  // 17. Cleanup - remove this run's test student AND any leftovers from older
  // runs so the admin panel never shows fake accounts in Students / Users.
  {
    const { data } = await call('GET', '/api/admin/users', { token: adminToken });
    const testUsers = ((data && data.users) || []).filter((u) => /@test\.com$/i.test(u.email || ''));
    let removed = 0;
    for (const u of testUsers) {
      const { status } = await call('DELETE', `/api/admin/users/${u.id}`, { token: adminToken });
      if (status === 200 || status === 404) removed += 1;
    }
    report('test accounts cleaned up', removed === testUsers.length, `removed=${removed} of ${testUsers.length}`);
  }

  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE CRASHED:', err.message);
  process.exit(1);
});
