'use strict';

/**
 * Desktop "Projects" dropdown (navbar).
 *
 * The panel used to sit 0.75rem below the trigger with nothing bridging that
 * gap. On the hover-driven pages the wrapper lost :hover the moment the
 * pointer crossed the gap, so the menu closed before an item could be
 * clicked. On the click-driven pages there was no outside-click or Escape
 * handling at all, so the panel stayed open forever.
 *
 * This script runs after the page markup, keeps hover working, bridges the
 * gap, and turns the trigger into a real toggle with sane dismissal.
 */
(function () {
  var btn = document.getElementById('desktop-projects-btn');
  var wrap = btn && btn.closest('.dropdown');
  if (!btn || !wrap) return;

  /* Bridge the gap + drive the panel/arrow from one open state. */
  var style = document.createElement('style');
  style.textContent = [
    '.dropdown-menu::before {',
    '  content: "";',
    '  position: absolute;',
    '  top: -0.75rem;',
    '  left: 0;',
    '  right: 0;',
    '  height: 0.75rem;',
    '}',
    '.dropdown:hover .dropdown-menu,',
    '.dropdown.is-open .dropdown-menu,',
    '.dropdown:focus-within .dropdown-menu { display: block; }',
    '.dropdown:hover .dropdown-trigger i,',
    '.dropdown.is-open .dropdown-trigger i,',
    '.dropdown:focus-within .dropdown-trigger i { transform: rotate(180deg); }',
  ].join('\n');
  document.head.appendChild(style);

  function close() {
    wrap.classList.remove('is-open');
  }

  /* The trigger ships with inline onclick="toggleDesktopProjects()" - override
     the page-level function so the click toggles the wrapper class instead of
     fighting the hover rule. */
  window.toggleDesktopProjects = function () {
    wrap.classList.toggle('is-open');
  };

  document.addEventListener('click', function (e) {
    if (!wrap.contains(e.target)) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  wrap.addEventListener('mouseleave', close);
})();
