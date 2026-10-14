/**
 * Physioprisma - shared frontend API client.
 *
 * Usage:
 *   const user = await PP.requireRole('admin');        // redirects if not logged in
 *   const data = await PP.get('/courses');             // GET  /api/courses
 *   await PP.post('/auth/login', { identity, password });
 *   PP.toast('Saved!');                                // needs a #toast element
 *
 * Works as plain script (no modules) so it can be dropped into any page.
 */
/* eslint-env browser */
(function attachPP(global) {
  'use strict';

  var TOKEN_KEY = 'pp_token';
  var USER_KEY = 'pp_user';

  /**
   * Where the API lives.
   *  - Site served by the Express backend  -> same origin (production path)
   *  - Page opened via file:// or Live Server (VS Code, port 5500) -> the
   *    backend on localhost:5500 doesn't exist, so point at localhost:5000.
   *  - Manual override:  <script>window.PP_API_BASE='http://localhost:5000/api'</script>
   *    (must be set before this file loads).
   */
  function resolveApiBase() {
    if (typeof global.PP_API_BASE === 'string' && global.PP_API_BASE) {
      return global.PP_API_BASE.replace(/\/+$/, '');
    }
    var loc = global.location;
    if (loc.protocol === 'file:') return 'http://localhost:5000/api';
    var port = loc.port || '';
    // VS Code Live Server default port (and common alternatives)
    if (port === '5500' || port === '5501' || port === '8080') {
      return 'http://localhost:5000/api';
    }
    return '/api';
  }

  var API_BASE = resolveApiBase();
  var CROSS_ORIGIN = API_BASE.indexOf('http') === 0;

  var LOGIN_PAGES = {
    admin: 'admin-login.html',
    student: 'student-portal.html',
    ambassador: 'ambassador-portal.html',
  };

  /* ----------------------------- session ----------------------------- */

  function getToken() {
    try {
      return global.localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function getUser() {
    try {
      return JSON.parse(global.localStorage.getItem(USER_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function setSession(token, user) {
    try {
      global.localStorage.setItem(TOKEN_KEY, token);
      global.localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {
      /* storage disabled - session stays in memory for this page load */
    }
  }

  function clearSession() {
    try {
      global.localStorage.removeItem(TOKEN_KEY);
      global.localStorage.removeItem(USER_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function loginPageFor(role) {
    return LOGIN_PAGES[role] || LOGIN_PAGES.student;
  }

  /* ------------------------------ request ---------------------------- */

  function ApiError(message, status, code, details) {
    var err = new Error(message);
    err.name = 'ApiError';
    err.status = status || 0;
    err.code = code;
    err.details = details;
    return err;
  }

  function request(path, options) {
    options = options || {};
    var method = options.method || 'GET';
    var body = options.body;
    var auth = options.auth !== false;
    var headers = Object.assign({}, options.headers || {});

    if (!(body instanceof FormData) && body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth) {
      var token = getToken();
      if (token) headers.Authorization = 'Bearer ' + token;
    }

    var init = { method: method, headers: headers };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined && body !== null) init.body = JSON.stringify(body);

    return global
      .fetch(API_BASE + path, init)
      .then(function onNetwork(res) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            if (res.ok) return data === null ? { ok: true } : data;

            if (res.status === 401) clearSession();
            throw ApiError(
              (data && data.error) || 'Request failed (' + res.status + ')',
              res.status,
              data && data.code,
              data && data.details
            );
          });
      })
      .catch(function onFetchError(err) {
        if (err && err.name === 'ApiError') throw err;
        throw ApiError('Could not reach the server. Please try again.', 0);
      });
  }

  function get(path, options) {
    return request(path, Object.assign({ method: 'GET' }, options || {}));
  }
  function post(path, body, options) {
    return request(path, Object.assign({ method: 'POST', body: body }, options || {}));
  }
  function patch(path, body, options) {
    return request(path, Object.assign({ method: 'PATCH', body: body }, options || {}));
  }
  function put(path, body, options) {
    return request(path, Object.assign({ method: 'PUT', body: body }, options || {}));
  }
  function del(path, options) {
    return request(path, Object.assign({ method: 'DELETE' }, options || {}));
  }

  /**
   * Download a file from the API (with the auth header) and save it locally.
   * Used for generated files such as course certificates - no JSON parsing.
   */
  function downloadFile(path, filename) {
    var headers = {};
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    return global
      .fetch(API_BASE + path, { headers: headers })
      .then(function (res) {
        if (!res.ok) {
          if (res.status === 401) clearSession();
          throw ApiError('Download failed (' + res.status + ')', res.status);
        }
        return res.blob();
      })
      .then(function (blob) {
        var url = global.URL.createObjectURL(blob);
        var link = global.document.createElement('a');
        link.href = url;
        link.download = filename || 'download';
        global.document.body.appendChild(link);
        link.click();
        global.document.body.removeChild(link);
        global.setTimeout(function () {
          global.URL.revokeObjectURL(url);
        }, 5000);
      })
      .catch(function (err) {
        if (err && err.name === 'ApiError') throw err;
        throw ApiError('Could not reach the server. Please try again.', 0);
      });
  }

  /**
   * Guard for dashboard pages: returns the current user or redirects to the
   * right login page. Call as:  const user = await PP.requireRole('admin');
   */
  function requireRole(role, options) {
    options = options || {};
    if (!getToken()) {
      global.location.replace(options.login || loginPageFor(role));
      return Promise.resolve(null);
    }
    return get('/auth/me')
      .then(function (data) {
        var user = data && data.user;
        if (!user) throw ApiError('Session invalid', 401);
        if (role && user.role !== role) {
          if (!options.allowOther) {
            clearSession();
            global.location.replace(loginPageFor(user.role));
            return null;
          }
        }
        setSession(getToken(), user);
        return user;
      })
      .catch(function (err) {
        if (!options.silentRedirect) {
          clearSession();
          global.location.replace(err && err.status === 403 ? loginPageFor(role) : loginPageFor(role));
        }
        return null;
      });
  }

  /** Full logout: tells the server, clears storage, sends user to their portal. */
  function logout(role) {
    var go = function () {
      clearSession();
      global.location.href = loginPageFor(role);
    };
    return post('/auth/logout', null, { auth: true }).then(go, go);
  }

  /* ------------------------------ uploads ---------------------------- */

  /**
   * Push a file straight to Cloudinary with a signature from the API.
   * The file never touches our server, which matters on hosts that cap
   * request bodies (Vercel: 4.5 MB) - videos up to 100 MB still work.
   */
  function directToCloudinary(sig, file) {
    var fd = new FormData();
    fd.append('file', file);
    fd.append('api_key', sig.apiKey);
    fd.append('timestamp', String(sig.timestamp));
    fd.append('signature', sig.signature);
    fd.append('public_id', sig.publicId);
    return fetch(sig.uploadUrl, { method: 'POST', body: fd }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return null;
        })
        .then(function (data) {
          if (!res.ok || !data || !data.secure_url) {
            throw new Error((data && data.error && data.error.message) || 'Direct upload failed');
          }
          return { url: data.secure_url, publicId: data.public_id, bytes: data.bytes, format: data.format };
        });
    });
  }

  /**
   * Upload a file to one of the admin endpoints.
   *
   * Tries a signed direct upload to Cloudinary first; if that is not possible
   * (no Cloudinary keys, signature refused, offline) it falls back to sending
   * the file as multipart/form-data exactly like before.
   *
   *   PP.upload('/admin/courses/123/image', 'image', file, { folder: 'physioprisma/courses' })
   *
   * @param {string} path   API path (POST)
   * @param {string} field  multipart field name used by the fallback
   * @param {File}   file
   * @param {{folder?:string, resourceType?:string, extra?:Object}} options
   * @returns {Promise<Object>} the endpoint's JSON response
   */
  function upload(path, field, file, options) {
    options = options || {};
    var extra = options.extra || {};
    var resourceType =
      options.resourceType || (file && /^video\//i.test(file.type || '') ? 'video' : 'image');
    var folder = options.folder || 'physioprisma';

    var direct = post('/admin/uploads/sign', { folder: folder, resourceType: resourceType })
      .then(function (sig) {
        return directToCloudinary(sig, file);
      })
      .catch(function () {
        return null; // fall back to the multipart endpoint
      });

    return direct.then(function (asset) {
      if (asset) {
        var payload = {};
        Object.keys(extra).forEach(function (k) {
          payload[k] = extra[k];
        });
        payload.url = asset.url;
        payload.publicId = asset.publicId;
        return post(path, payload);
      }
      var fd = new FormData();
      fd.append(field, file);
      Object.keys(extra).forEach(function (k) {
        fd.append(k, extra[k]);
      });
      return post(path, fd);
    });
  }

  /* ------------------------------ helpers ---------------------------- */

  /** Escape untrusted text before inserting into innerHTML. */
  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** "2026-10-08T12:00:00Z" -> "08 Oct 2026" (matches the existing UI format). */
  function formatDate(value) {
    if (!value) return '';
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** Show the page's #toast element if it exists (no-op otherwise). */
  function toast(message, type) {
    var el = global.document.getElementById('toast');
    if (!el) {
      console.log('[toast]', message);
      return;
    }
    el.textContent = message;
    el.style.background = type === 'error' ? '#fef2f2' : '';
    el.style.color = type === 'error' ? '#b91c1c' : '';
    el.style.border = type === 'error' ? '1px solid #fecaca' : '';
    el.classList.add('show');
    clearTimeout(global.__ppToastTimer);
    global.__ppToastTimer = setTimeout(function () {
      el.classList.remove('show');
      el.style.background = '';
      el.style.color = '';
      el.style.border = '';
    }, 2600);
  }

  /** Shared error reporter for buttons/forms. */
  function showError(err, fallback) {
    var msg = (err && err.message) || fallback || 'Something went wrong';
    toast(msg, 'error');
    console.error(err);
    return msg;
  }

  /** Confirm dialog wrapper - returns a promise. */
  function confirmAction(message) {
    return global.Promise.resolve(global.confirm(message));
  }

  global.PP = {
    request: request,
    get: get,
    post: post,
    patch: patch,
    put: put,
    del: del,
    upload: upload,
    downloadFile: downloadFile,
    getToken: getToken,
    getUser: getUser,
    setSession: setSession,
    clearSession: clearSession,
    requireRole: requireRole,
    logout: logout,
    loginPageFor: loginPageFor,
    esc: esc,
    formatDate: formatDate,
    toast: toast,
    showError: showError,
    confirmAction: confirmAction,
    ApiError: ApiError,
  };
})(window);
