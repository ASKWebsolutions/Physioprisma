'use strict';

/**
 * Central environment loader.
 * - Loads backend/.env (regardless of the current working directory)
 * - Validates required variables once, at startup
 * - Fails fast with an actionable message instead of crashing mid-request
 */

const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

function read(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function required(name, hint) {
  const value = read(name);
  if (!value) {
    throw new Error(`Missing required environment variable "${name}". ${hint || ''}`.trim());
  }
  return value;
}

const mongoUri = required(
  'MONGODB_URI',
  'Copy backend/.env.example to backend/.env and add your MongoDB Atlas connection string.'
);

// JWT secret: must be strong in production; in development we generate an
// ephemeral one so the server still boots (sessions reset on restart).
let jwtSecret = read('JWT_SECRET');
if (jwtSecret.length < 32) {
  if (isProd) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters in production. Generate one with: openssl rand -hex 64'
    );
  }
  jwtSecret = crypto.randomBytes(48).toString('hex');
  console.warn('[env] JWT_SECRET missing or too short - using an ephemeral dev secret (sessions reset on restart).');
}

const env = {
  NODE_ENV,
  isProd,
  port: Number.parseInt(read('PORT', '5000'), 10) || 5000,
  corsOrigins: read('CORS_ORIGIN')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  mongoUri,
  jwtSecret,
  jwtExpiresIn: read('JWT_EXPIRES_IN', '7d'),
  admin: {
    name: read('ADMIN_NAME', 'Physioprisma Admin'),
    email: read('ADMIN_EMAIL', '').toLowerCase(),
    password: read('ADMIN_PASSWORD', ''),
  },
  cloudinary: {
    cloudName: read('CLOUDINARY_CLOUD_NAME'),
    apiKey: read('CLOUDINARY_API_KEY'),
    apiSecret: read('CLOUDINARY_API_SECRET'),
    // Cloudinary Free plan rejects videos above 100 MB (Plus allows 2 GB).
    maxVideoMB: Number.parseInt(read('MAX_VIDEO_MB', '100'), 10) || 100,
  },
  rewardPerEnrollment: Number.parseInt(read('REWARD_PER_ENROLLMENT', '500'), 10) || 500,
  // Absolute path to the static site that this server publishes
  frontendDir: path.join(__dirname, '..', '..', 'frontend'),
};

env.cloudinary.configured = Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

module.exports = { env };
