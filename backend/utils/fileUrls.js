'use strict';

/**
 * Cloudinary delivers raw assets with the extension-less public_id, so the
 * original file name is restored through the fl_attachment flag.
 *
 * The flag value cannot contain raw dots or spaces (Cloudinary parses the
 * dot as a transformation separator and rejects it), so the name is
 * sanitised to [A-Za-z0-9._-] and every dot is sent as %252E, which
 * Cloudinary decodes back to "." in the delivered filename.
 */
function attachmentUrl(url, name) {
  if (!url || !/^https?:\/\//i.test(url) || !url.includes('/upload/')) return url || '';
  if (url.includes('/fl_attachment')) return url;
  const safe = String(name || 'course-file')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-\./g, '.')
    .replace(/^[.-]+/, '')
    .slice(0, 80) || 'course-file';
  return url.replace('/upload/', '/upload/fl_attachment:' + encodeURIComponent(safe).replace(/\./g, '%252E') + '/');
}

/** Plain object for a course file subdoc, with a ready download link. */
function fileWithDownload(f) {
  const o = f && typeof f.toJSON === 'function' ? f.toJSON() : { ...(f || {}) };
  o.downloadUrl = attachmentUrl(o.url || '', o.name || '');
  return o;
}

module.exports = { attachmentUrl, fileWithDownload };
