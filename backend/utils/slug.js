'use strict';

/** URL-safe slug: "Dry Needling - Level 1" -> "dry-needling-level-1" */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

module.exports = { slugify };
