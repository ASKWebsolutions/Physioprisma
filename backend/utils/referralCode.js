'use strict';

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I - easy to read aloud

/** Human friendly random code, e.g. "PPK7M2QX" (8 chars). */
function randomCode(prefix = 'PP', length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return prefix + out;
}

/**
 * Generate a referral code unique against `Model` (retry on the off chance of a collision).
 * @param {import('mongoose').Model} Model
 * @param {string} field
 */
async function uniqueReferralCode(Model, field = 'referralCode', { prefix = 'PP', length = 6, attempts = 8 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const code = randomCode(prefix, length);
    const clash = await Model.exists({ [field]: code });
    if (!clash) return code;
  }
  // Fallback: longer, effectively collision-proof
  return randomCode(prefix, length) + randomCode('', 4);
}

module.exports = { randomCode, uniqueReferralCode };
