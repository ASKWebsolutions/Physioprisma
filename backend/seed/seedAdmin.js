'use strict';

/**
 * Ensures a single admin account exists, using ADMIN_EMAIL / ADMIN_PASSWORD
 * from backend/.env. Idempotent - safe to run on every boot.
 */

const User = require('../models/User.model');
const { env } = require('../config/env');

async function seedAdmin({ log = true } = {}) {
  const { name, email, password } = env.admin;

  if (!email || !password) {
    console.warn('[seed:admin] ADMIN_EMAIL / ADMIN_PASSWORD not set in backend/.env - skipping admin seed.');
    return null;
  }

  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters. Update backend/.env and restart.');
  }
  if (!env.isProd && password === 'ChangeMe#12345') {
    console.warn('[seed:admin] You are using the placeholder ADMIN_PASSWORD. Change it in backend/.env.');
  }

  const existing = await User.findOne({ email }).select('+password role status');

  if (existing) {
    let dirty = false;

    // ADMIN_FORCE_RESET=true re-applies ADMIN_PASSWORD on every boot (disaster recovery).
    if (process.env.ADMIN_FORCE_RESET === 'true') {
      const matches = await existing.comparePassword(password);
      if (!matches) {
        existing.password = password;
        dirty = true;
        if (log) console.warn('[seed:admin] ADMIN_FORCE_RESET=true - admin password re-applied from .env.');
      }
    }

    if (existing.role !== 'admin') {
      existing.role = 'admin';
      dirty = true;
    }
    if (existing.status !== 'active') {
      existing.status = 'active';
      dirty = true;
    }
    if (dirty) {
      await existing.save();
      if (log) console.log(`[seed:admin] Normalised existing admin "${email}" (role/status restored).`);
    } else if (log) {
      console.log(`[seed:admin] Admin already present: ${email}`);
    }
    return existing;
  }

  const admin = new User({
    name: name || 'Physioprisma Admin',
    email,
    password, // hashed by the User pre-save hook
    role: 'admin',
    status: 'active',
    phone: '',
    approvedAt: new Date(),
  });
  await admin.save();
  if (log) console.log(`[seed:admin] Created admin account: ${email}`);
  return admin;
}

// Allow running directly: `npm run seed:admin`
if (require.main === module) {
  const { connectDB, disconnectDB } = require('../config/db');
  (async () => {
    try {
      await connectDB();
      await seedAdmin();
    } catch (err) {
      console.error(`[seed:admin] Failed: ${err.message}`);
      process.exitCode = 1;
    } finally {
      await disconnectDB();
    }
  })();
}

module.exports = { seedAdmin };
