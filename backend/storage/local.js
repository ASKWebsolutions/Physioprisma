'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/**
 * Local upload storage - used whenever Cloudinary credentials are missing so
 * the admin can keep posting images/videos right away. Files land in
 * backend/uploads and are served by Express at /uploads.
 *
 * When CLOUDINARY_* is configured the uploader switches to Cloudinary and
 * this module is bypassed (see config/cloudinary.js).
 */

// backend/storage/local.js -> backend/uploads
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

/* ---------------------------- extension sniffing ---------------------- */

function sniffExtension(buf) {
  if (!buf || buf.length < 12) return 'bin';

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  // WEBP / WAV (RIFF container)
  if (buf.toString('ascii', 0, 4) === 'RIFF') {
    const fourCC = buf.toString('ascii', 8, 12);
    if (fourCC === 'WEBP') return 'webp';
    if (fourCC === 'WAVE') return 'wav';
    return 'riff';
  }
  // MP4 / MOV / AVIF (ISO-BMFF: size(4) + 'ftyp' + brand)
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12).trim().toLowerCase();
    if (brand.startsWith('qt')) return 'mov';
    if (brand.includes('avif') || brand.includes('avis')) return 'avif';
    return 'mp4';
  }
  // Matroska / WebM
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  // PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf';

  return 'bin';
}

/* ---------------------------- path safety ----------------------------- */

function sanitizeSegment(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.trim().replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, ''))
    .filter(Boolean)
    .slice(0, 6)
    .join('/');
}

function sanitizeName(value) {
  const base = String(value || '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '');
  return base.slice(0, 80) || 'file';
}

/* ---------------------------- save ------------------------------------ */

/**
 * @param {Buffer} buffer
 * @param {{folder?:string, filename?:string, resourceType?:string}} options
 * @returns {Promise<{url:string, publicId:string, bytes:number, format:string, local:boolean}>}
 */
async function saveLocal(buffer, { folder = 'physioprisma', filename } = {}) {
  const ext = sniffExtension(buffer);
  const dir = path.join(UPLOADS_ROOT, sanitizeSegment(folder));

  // Guarantee the resolved file stays inside UPLOADS_ROOT (path traversal guard)
  const resolvedDir = path.resolve(dir);
  if (resolvedDir !== UPLOADS_ROOT && !resolvedDir.startsWith(UPLOADS_ROOT + path.sep)) {
    throw new Error('Refusing to write outside the uploads folder');
  }

  await fsp.mkdir(dir, { recursive: true });

  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  const name = `${sanitizeName(filename)}-${stamp}-${rand}.${ext}`;
  const filePath = path.join(resolvedDir, name);

  await fsp.writeFile(filePath, buffer);

  const relDir = path.relative(UPLOADS_ROOT, resolvedDir).split(path.sep).join('/');

  return {
    url: `/uploads/${relDir ? relDir + '/' : ''}${name}`,
    publicId: '',
    bytes: buffer.length,
    format: ext,
    local: true,
  };
}

/** Remove a previously written local file. Never throws. */
async function removeLocal(url) {
  try {
    if (!url || !url.startsWith('/uploads/')) return { result: 'skipped' };
    const rel = url.slice('/uploads/'.length);
    const target = path.resolve(path.join(UPLOADS_ROOT, rel));
    if (target !== UPLOADS_ROOT && !target.startsWith(UPLOADS_ROOT + path.sep)) {
      return { result: 'skipped' };
    }
    await fsp.unlink(target);
    return { result: 'ok' };
  } catch (err) {
    if (err.code === 'ENOENT') return { result: 'missing' };
    console.warn('[uploads] failed to delete', url, err.message);
    return { result: 'error' };
  }
}

/** Make sure the folder exists (called once at boot). */
function ensureRoot() {
  try {
    fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
  } catch (err) {
    console.warn('[uploads] could not create uploads folder:', err.message);
  }
}

module.exports = { saveLocal, removeLocal, ensureRoot, UPLOADS_ROOT, sniffExtension };
