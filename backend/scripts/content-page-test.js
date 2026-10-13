'use strict';
/**
 * Content page render test - courses.html, blog.html, blog-post.html and
 * home.html must render from the public API (with the hardcoded markup kept
 * only as a fallback).
 *
 *   node scripts/content-page-test.js [baseUrl]
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
  .replace(/<\/script/gi, '<\\/script');

function pageHtml(name, apiTagName) {
  const file = path.join(FRONTEND, name);
  let html = fs.readFileSync(file, 'utf8');
  if (apiTagName) html = html.replace(apiTagName, () => '<script>' + apiSrc + '</script>');
  return html;
}

/** Boot a page with window.fetch stubbed to answers keyed by URL fragment. */
function boot(html, url, answers, beforeParse) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = (target) => {
        const u = String(target);
        for (const key of Object.keys(answers)) {
          if (u.indexOf(key) > -1) {
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answers[key]) });
          }
        }
        return Promise.reject(new Error('unexpected fetch: ' + u));
      };
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      if (beforeParse) beforeParse(window);
    },
  });
  dom.errors = errors;
  return dom;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [coursesData, blogsData, blogDetail] = await Promise.all([
    (await fetch(BASE + '/api/courses')).json(),
    (await fetch(BASE + '/api/blogs')).json(),
    (await fetch(BASE + '/api/blogs/proprioception')).json(),
  ]);

  const courses = coursesData.courses || [];
  const blogs = blogsData.blogs || [];
  console.log(`API: ${courses.length} courses, ${blogs.length} blogs\n`);
  if (!courses.length || !blogs.length) {
    console.log('No content in DB - run `npm run seed:content` first.');
    process.exit(1);
  }

  const detailData = await (await fetch(BASE + '/api/courses/' + courses[0].slug)).json();
  const detail = detailData.course || {};
  const noLessons = !detail.lessonCount;


  /* ---------------------------------------------------------------- courses */
  {
    const dom = boot(
      pageHtml('courses.html', '<script src="./js/api.js"></script>'),
      BASE + '/courses.html',
      { '/api/courses': coursesData }
    );
    await settle(400);
    const doc = dom.window.document;
    const cards = doc.querySelectorAll('#courses-api .course-card');
    report('courses.html renders API cards', cards.length === courses.length, `${cards.length}/${courses.length}`);
    report('courses.html hides static fallback', doc.getElementById('courses-static').classList.contains('hidden'));
    report('courses.html API grid visible', !doc.getElementById('courses-api').classList.contains('hidden'));
    const first = doc.querySelector('#courses-api .course-card a[href^="course.html?id="]');
    report('course card links to the player', !!first, first ? first.getAttribute('href') : 'no link');
    report('course card shows a title', !!(doc.querySelector('#courses-api h3') || {}).textContent,
      (doc.querySelector('#courses-api h3') || {}).textContent);
    report('course card shows a cover image', !!(doc.querySelector('#courses-api img')),
      (doc.querySelector('#courses-api img') || {}).getAttribute ? doc.querySelector('#courses-api img').getAttribute('src').slice(0, 60) : 'none');
    report('course card has an Enroll button', !!doc.querySelector('#courses-api button[data-enroll]'));
    report('no script errors', dom.errors.length === 0, JSON.stringify(dom.errors.slice(0, 2)));
    dom.window.close();

  }

  /* ---------------------------------------------------------- course detail */
  {
    const dom = boot(
      pageHtml('course.html', '<script src="./js/api.js"></script>'),
      BASE + '/course.html?id=' + detail.slug,
      { ['/api/courses/' + detail.slug]: detailData }
    );
    await settle(400);
    const doc = dom.window.document;
    report('course.html title from API', doc.getElementById('course-title').textContent === detail.title,
      doc.getElementById('course-title').textContent.slice(0, 50));
    report('course.html hero blurb rendered', doc.getElementById('course-desc').textContent.length > 40,
      doc.getElementById('course-desc').textContent.length + ' chars');
    report('course.html renders the long "about" copy', doc.querySelectorAll('#course-about p').length >= 2,
      doc.querySelectorAll('#course-about p').length + ' paragraph(s)');
    report('course.html renders the highlights list', doc.querySelectorAll('#course-points li').length === detail.details.length,
      doc.querySelectorAll('#course-points li').length + ' of ' + detail.details.length);
    report('course.html hero meta has no "0 lessons" pill', doc.getElementById('course-meta').textContent.indexOf('0 lesson') === -1,
      JSON.stringify(doc.getElementById('course-meta').textContent.slice(0, 90)));
    if (noLessons) {
      const cover = doc.getElementById('course-cover');
      report('course.html shows the course cover (no black player box)', !cover.classList.contains('hidden') && !!cover.getAttribute('src'),
        cover.getAttribute('src') || 'no src');
      report('course.html has no video player (reading course)', !doc.getElementById('player'));
      report('course.html shows the reading progress panel', !!doc.getElementById('my-progress'));
      report('course.html shows the enroll button', !!doc.getElementById('aside-enroll'));
    }
    report('course.html not-found panel stays hidden', doc.getElementById('course-missing').classList.contains('hidden'));
    report('no script errors', dom.errors.length === 0, JSON.stringify(dom.errors.slice(0, 2)));
    dom.window.close();
  }


  /* ------------------------------------------------------------------- blog */
  {
    const dom = boot(
      pageHtml('blog.html', '<script src="./js/api.js"></script>'),
      BASE + '/blog.html',
      { '/api/blogs': blogsData }
    );
    await settle(400);
    const doc = dom.window.document;
    const cards = doc.querySelectorAll('#blogs-api .blog-card');
    report('blog.html renders API cards', cards.length > 0, `${cards.length} card(s)`);
    report('blog.html hides static fallback', doc.getElementById('blogs-static').classList.contains('hidden'));
    const link = doc.querySelector('#blogs-api .blog-card');
    report('blog card links to blog-post', !!link && link.getAttribute('onclick').indexOf('blog-post.html?id=') > -1,
      link ? link.getAttribute('onclick') : 'none');
    if (blogs.length > 9) {
      const btn = doc.getElementById('load-more-btn');
      report('load-more wired to API paging', btn && typeof btn.onclick === 'function');
      btn.click();
      await settle(50);
      const more = doc.querySelectorAll('#blogs-api .blog-card').length;
      report('load-more reveals more cards', more > cards.length, `${cards.length} -> ${more}`);
    }
    report('no script errors', dom.errors.length === 0, JSON.stringify(dom.errors.slice(0, 2)));
    dom.window.close();

  }

  /* ------------------------------------------------------------- blog post */
  {
    const slug = 'proprioception';
    const dom = boot(
      pageHtml('blog-post.html', '<script src="./js/api.js"></script>'),
      BASE + '/blog-post.html?id=' + slug,
      { ['/api/blogs/' + slug]: blogDetail }
    );
    await settle(400);
    const doc = dom.window.document;
    const expected = blogDetail.blog;
    report('blog-post title from API', doc.getElementById('post-title').textContent === expected.title,
      doc.getElementById('post-title').textContent.slice(0, 60));
    report('blog-post content from API', doc.getElementById('post-content').innerHTML.length > 500,
      doc.getElementById('post-content').innerHTML.length + ' chars');
    report('blog-post document.title updated', doc.title.indexOf(expected.title) > -1, doc.title);
    if (expected.dateText) {
      report('blog-post date rendered', doc.getElementById('post-date').textContent === expected.dateText,
        doc.getElementById('post-date').textContent);
    }
    report('no script errors', dom.errors.length === 0, JSON.stringify(dom.errors.slice(0, 2)));
    dom.window.close();

  }

  /* ------------------------------------------------------- unknown fallback */
  {
    const dom = boot(
      pageHtml('blog-post.html', '<script src="./js/api.js"></script>'),
      BASE + '/blog-post.html?id=does-not-exist',
      { '/api/blogs/': { ok: false, error: 'Post not found' } }
    );
    // the stub answers 200 with an error envelope, so the page must fall
    // back to the inline article list and end up redirecting to blog.html
    await settle(300);
    const doc = dom.window.document;
    const navigated = dom.errors.some((e) => /navigation/i.test(e));
    const stillLoading = doc.getElementById('post-title').textContent.indexOf('Loading') > -1;
    report('unknown post does not render a fake article', stillLoading,
      doc.getElementById('post-title').textContent.slice(0, 50));
    report('unknown post redirects to blog.html', navigated,
      navigated ? 'jsdom reported the navigation' : 'errors: ' + JSON.stringify(dom.errors.slice(0, 3)));
    const realErrors = dom.errors.filter((e) => !/navigation/i.test(e));
    report('no script errors', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 2)));
    dom.window.close();

  }

  /* ------------------------------------------------------------------ home */
  {
    const dom = boot(
      pageHtml('home.html', '<script src="./js/api.js"></script>'),
      BASE + '/home.html',
      { '/api/courses': coursesData, '/api/blogs': blogsData }
    );
    await settle(500);
    const doc = dom.window.document;
    const hc = doc.querySelectorAll('#home-courses-api > div').length;
    const hb = doc.querySelectorAll('#home-blogs-api > div').length;
    report('home shows 3 courses from API', hc === 3, `${hc} card(s)`);
    report('home shows 3 blogs from API', hb === 3, `${hb} card(s)`);
    report('home hides static course fallback', doc.getElementById('home-courses-static').classList.contains('hidden'));
    report('home hides static blog fallback', doc.getElementById('home-blogs-static').classList.contains('hidden'));
    const moreBtn = doc.querySelector('#home-blogs-api span');
    report('home blog card has a Read More affordance', !!moreBtn && moreBtn.textContent.indexOf('Read More') > -1);
    report('no script errors', dom.errors.length === 0, JSON.stringify(dom.errors.slice(0, 2)));
    dom.window.close();

  }

  console.log(`\n==== CONTENT PAGE RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CRASHED:', e);
  process.exit(1);
});
