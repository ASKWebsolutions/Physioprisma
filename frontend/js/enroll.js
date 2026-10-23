'use strict';

/**
 * Physioprisma - shared "Enroll in a course" flow.
 *
 * Any element with `data-enroll="<course slug or id>"` becomes an enroll
 * trigger. Clicking it opens a small confirmation modal that asks the signed-in
 * student to re-enter their password (the "small verification"), then calls
 * POST /api/student/enroll.
 *
 * Requires js/api.js to be loaded first.
 *
 * On success a `pp:enrolled` event is fired on document with detail
 * { id, slug, title } so pages can refresh their own view:
 *
 *   document.addEventListener('pp:enrolled', function (e) { refresh(); });
 */
(function (global) {
  'use strict';

  var STYLE = [
    '.pp-enroll-backdrop{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;padding:1rem;background:rgba(15,23,42,0.55);}',
    '.pp-enroll-backdrop.show{display:flex;}',
    '.pp-enroll-card{background:#fff;border-radius:1.5rem;box-shadow:0 30px 60px rgba(15,23,42,0.25);width:100%;max-width:26rem;overflow:hidden;}',
    '.pp-enroll-input{width:100%;padding:0.8rem 1rem;border:1px solid #e5e7eb;border-radius:0.9rem;font-size:0.95rem;}',
    '.pp-enroll-input:focus{outline:none;border-color:#6b21a8;box-shadow:0 0 0 4px rgba(107,33,168,0.1);}',
    '.pp-enroll-btn-primary{flex:1;background:linear-gradient(135deg,#6b21a8,#0ea5e9);color:#fff;border:none;border-radius:999px;font-weight:700;padding:0.7rem 1rem;cursor:pointer;font-size:0.9rem;}',
    '.pp-enroll-btn-ghost{flex:1;background:#fff;border:1px solid #e5e7eb;border-radius:999px;font-weight:700;padding:0.7rem 1rem;color:#374151;cursor:pointer;font-size:0.9rem;}',
    '.pp-enroll-btn-primary:disabled{opacity:0.6;cursor:not-allowed;}',
    '.pp-enroll-toast{position:fixed;left:50%;bottom:1.5rem;transform:translate(-50%,1rem);z-index:300;background:#065f46;color:#fff;padding:0.7rem 1.2rem;border-radius:999px;font-weight:700;font-size:0.88rem;box-shadow:0 12px 30px rgba(15,23,42,0.25);opacity:0;pointer-events:none;transition:opacity .25s ease,transform .25s ease;max-width:90vw;text-align:center;}',
    '.pp-enroll-toast.show{opacity:1;transform:translate(-50%,0);}',
    '.pp-enroll-toast.error{background:#b91c1c;}',
  ].join('\n');

  var modal = null;
  var current = null;

  function notify(message, isError) {
    var el = document.getElementById('pp-enroll-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pp-enroll-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = 'pp-enroll-toast show' + (isError ? ' error' : '');
    clearTimeout(el._ppTimer);
    el._ppTimer = setTimeout(function () {
      el.className = 'pp-enroll-toast';
    }, 3200);
  }

  function build() {
    if (modal) return modal;

    var style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    modal = document.createElement('div');
    modal.className = 'pp-enroll-backdrop';
    modal.innerHTML =
      '<div class="pp-enroll-card">' +
        '<div style="padding:1rem 1.25rem;border-bottom:1px solid #f1f3f9;display:flex;align-items:center;justify-content:space-between;">' +
          '<h3 style="font-weight:800;color:#111827;">Confirm Enrollment</h3>' +
          '<button type="button" data-pp-enroll-close style="background:none;border:none;font-size:1.5rem;line-height:1;color:#9ca3af;cursor:pointer;">&times;</button>' +
        '</div>' +
        '<form data-pp-enroll-form style="padding:1.25rem;">' +
          '<p style="font-size:0.9rem;color:#4b5563;margin-bottom:1rem;">You are about to enroll in <strong data-pp-enroll-title style="color:#6b21a8;"></strong>. To verify it is you, enter your account password.</p>' +
          '<label style="display:block;font-size:0.85rem;font-weight:700;color:#4b5563;margin-bottom:0.4rem;">Password</label>' +
          '<input type="password" name="password" required minlength="6" autocomplete="current-password" placeholder="Enter your password" class="pp-enroll-input">' +
          '<p data-pp-enroll-error style="display:none;margin-top:0.75rem;font-size:0.85rem;color:#b91c1c;font-weight:600;"></p>' +
          '<div style="display:flex;gap:0.75rem;margin-top:1.25rem;">' +
            '<button type="button" data-pp-enroll-close class="pp-enroll-btn-ghost">Cancel</button>' +
            '<button type="submit" data-pp-enroll-submit class="pp-enroll-btn-primary">Enroll</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-pp-enroll-close]')) close();
    });
    modal.querySelector('[data-pp-enroll-form]').addEventListener('submit', submit);

    return modal;
  }

  function close() {
    if (modal) modal.classList.remove('show');
    current = null;
  }

  function submit(e) {
    e.preventDefault();
    if (!current) return;

    var form = e.target;
    var btn = form.querySelector('[data-pp-enroll-submit]');
    var passwordInput = form.querySelector('input[name="password"]');
    var errorEl = modal.querySelector('[data-pp-enroll-error]');
    errorEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Enrolling...';

    global.PP.post('/student/enroll', { courseId: current.id, password: passwordInput.value })
      .then(function (res) {
        var done = current;
        close();
        notify((res && res.message) || 'Enrolled successfully.');
        var enrollment = (res && res.enrollment) || {};
        document.dispatchEvent(
          new CustomEvent('pp:enrolled', {
            detail: { id: done.id, slug: enrollment.slug, courseId: enrollment.courseId, title: done.title },
          })
        );
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Enroll';
        errorEl.textContent =
          err && err.status === 0
            ? 'Could not reach the server. Is the backend running?'
            : (err && err.message) || 'Could not enroll right now.';
        errorEl.style.display = 'block';
      });
  }

  function open(item) {
    if (!item || !item.id || !global.PP) return;

    if (!global.PP.getToken()) {
      global.location.href = 'student-portal.html';
      return;
    }
    var user = global.PP.getUser();
    // hasRole accepts students AND ambassadors - one account can be both.
    if (user && global.PP.hasRole && !global.PP.hasRole(user, 'student')) {
      notify('Only student accounts can enroll in courses.', true);
      return;
    }

    build();
    current = item;
    modal.querySelector('[data-pp-enroll-title]').textContent = item.title || 'this course';
    var form = modal.querySelector('[data-pp-enroll-form]');
    form.reset();
    var errorEl = modal.querySelector('[data-pp-enroll-error]');
    errorEl.style.display = 'none';
    var btn = form.querySelector('[data-pp-enroll-submit]');
    btn.disabled = false;
    btn.textContent = 'Enroll';
    modal.classList.add('show');
    setTimeout(function () {
      var input = modal.querySelector('input[name="password"]');
      if (input) input.focus();
    }, 40);
  }

  /* Auto-bind every [data-enroll] trigger on the page. */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-enroll]');
    if (!btn) return;
    e.preventDefault();
    var title = btn.dataset.enrollTitle;
    if (!title) {
      var card = btn.closest('.course-card, .course-row');
      var heading = card && card.querySelector('h3');
      title = heading ? heading.textContent.trim() : 'this course';
    }
    open({ id: btn.dataset.enroll, title: title });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  global.PPEnroll = { open: open, notify: notify };
})(window);
