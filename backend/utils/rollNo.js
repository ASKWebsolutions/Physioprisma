'use strict';

/**
 * Roll numbers ("PP-0001") - one permanent id per account so the admin panel
 * can look up a single person's track record.
 */

const PREFIX = 'PP-';
const WIDTH = 4;

function format(n) {
  return PREFIX + String(n).padStart(WIDTH, '0');
}

/** Next free roll number for `Model` (User), based on the highest existing one. */
async function nextRollNo(Model, attempts = 6) {
  for (let i = 0; i < attempts; i += 1) {
    const last = await Model.findOne({ rollNo: new RegExp('^' + PREFIX) })
      .sort({ rollNo: -1 })
      .select('rollNo');
    const current = last ? parseInt(String(last.rollNo).slice(PREFIX.length), 10) : 0;
    const candidate = format((Number.isFinite(current) ? current : 0) + 1);
    const clash = await Model.exists({ rollNo: candidate });
    if (!clash) return candidate;
  }
  // Practically unreachable - fall back to a time based id.
  return format(Number(String(Date.now()).slice(-6)));
}

/** Give every account that is still missing one a roll number (old records). */
async function backfillRollNumbers(Model) {
  const missing = await Model.find({ $or: [{ rollNo: { $in: [null, ''] } }, { rollNo: { $exists: false } }] })
    .sort({ createdAt: 1 })
    .select('_id');

  let updated = 0;
  for (const doc of missing) {
    doc.rollNo = await nextRollNo(Model);
    await doc.save();
    updated += 1;
  }
  return updated;
}

module.exports = { PREFIX, format, nextRollNo, backfillRollNumbers };
