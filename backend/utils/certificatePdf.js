'use strict';

/**
 * Dependency-free PDF writer for completion certificates.
 *
 * Produces a single A4-landscape page using the built-in Helvetica fonts, so
 * the server can hand the browser a real .pdf file with no extra library.
 */

const PAGE_W = 842; // A4 landscape, points
const PAGE_H = 595;

const PURPLE = [0.42, 0.13, 0.66];
const BLUE = [0.06, 0.65, 0.91];
const DARK = [0.07, 0.09, 0.15];
const GRAY = [0.42, 0.45, 0.5];

/** Escape a value for a PDF literal string; non-Latin-1 characters are dropped. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/** Rough Helvetica advance width - accurate enough to centre short lines. */
function textWidth(value, size, bold) {
  let units = 0;
  for (const ch of String(value)) {
    let f = 0.52;
    if ('iljI.,:;|!\'[]()'.includes(ch)) f = 0.29;
    else if ('mwMW'.includes(ch)) f = 0.85;
    else if (ch === ' ') f = 0.28;
    else if (/[0-9]/.test(ch)) f = 0.556;
    else if (/[A-Z]/.test(ch)) f = 0.68;
    units += f;
  }
  return units * size * (bold ? 1.05 : 1);
}

function colour(c) {
  return `${c[0]} ${c[1]} ${c[2]}`;
}

function textAt(font, size, c, x, y, value) {
  return `BT ${colour(c)} rg /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(value)}) Tj ET\n`;
}

function textCentered(font, size, c, y, value) {
  const x = Math.max(60, (PAGE_W - textWidth(value, size, font === 'F2')) / 2);
  return textAt(font, size, c, x, y, value);
}

function strokeRect(x, y, w, h, c, lineWidth) {
  return `${lineWidth} w ${colour(c)} RG ${x} ${y} ${w} ${h} re S\n`;
}

/** Build the raw PDF bytes for one certificate. */
function buildCertificatePdf(cert) {
  const out = [];
  out.push(strokeRect(28, 28, PAGE_W - 56, PAGE_H - 56, PURPLE, 3));
  out.push(strokeRect(40, 40, PAGE_W - 80, PAGE_H - 80, BLUE, 1));

  out.push(textCentered('F2', 12, PURPLE, 505, 'PHYSIOPRISMA ACADEMY'));
  out.push(textCentered('F2', 30, DARK, 462, 'Certificate of Completion'));
  out.push(textCentered('F1', 12, GRAY, 424, 'This is to certify that'));
  out.push(textCentered('F2', 26, PURPLE, 380, cert.studentName));
  out.push(textCentered('F1', 12, GRAY, 348, 'has successfully completed the course'));
  out.push(textCentered('F2', 18, DARK, 312, cert.courseTitle));

  out.push(textCentered('F1', 11, GRAY, 250, 'Completed on ' + cert.completedText));
  out.push(textCentered('F1', 11, GRAY, 232, 'Certificate ID: ' + cert.id));
  out.push(textCentered('F1', 11, GRAY, 214, 'Instructor: ' + cert.instructor));

  const sigL = 90;
  const sigR = PAGE_W - 340;
  out.push(strokeRect(sigL, 138, 250, 1, GRAY, 0.8));
  out.push(strokeRect(sigR, 138, 250, 1, GRAY, 0.8));
  out.push(textAt('F2', 11, DARK, sigL, 120, 'Dr Tuba Sultan (PT)'));
  out.push(textAt('F1', 9, GRAY, sigL, 105, 'Co-founder, Physioprisma Academy'));
  out.push(textAt('F2', 11, DARK, sigR, 120, 'Dr. Sultan Zaidi (PT)'));
  out.push(textAt('F1', 9, GRAY, sigR, 105, 'Co-founder, Physioprisma Academy'));

  const stream = out.join('');

  const objects = [
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      id: 3,
      body:
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    },
    { id: 4, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
    { id: 5, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>' },
    { id: 6, body: `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream` },
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = {};
  for (const obj of objects) {
    offsets[obj.id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  const size = objects.length + 1;
  pdf += `xref\n0 ${size}\n`;
  pdf += '0000000000 65535 f \n';
  for (const obj of objects) {
    pdf += `${String(offsets[obj.id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

module.exports = { buildCertificatePdf };
