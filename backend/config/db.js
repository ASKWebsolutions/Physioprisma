'use strict';

const dns = require('dns');
const mongoose = require('mongoose');
const { env } = require('./env');

mongoose.set('strictQuery', true);

/**
 * Some machines advertise a loopback DNS resolver (127.0.0.1) that is not
 * actually running - every lookup then fails with ECONNREFUSED (very common
 * with VPNs / local stub resolvers). Detect that case and fall back to public
 * resolvers so SRV lookups for `mongodb+srv://` keep working.
 *
 * Set DNS_SERVERS in backend/.env to override (comma separated).
 */
function ensureResolvers() {
  const configured = process.env.DNS_SERVERS;
  if (configured && configured.trim()) {
    dns.setServers(configured.split(',').map((s) => s.trim()).filter(Boolean));
    console.log(`[dns] Using custom resolvers from DNS_SERVERS`);
    return;
  }

  const servers = dns.getServers() || [];
  const loopbackOnly = servers.length === 0 || servers.every((s) => s === '127.0.0.1' || s === '::1');
  if (loopbackOnly) {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4', '2606:4700:4700::1111']);
    console.warn(`[dns] System resolver is ${servers.join(',') || 'empty'} (not reachable) - using public resolvers instead.`);
  }
}

/**
 * Connect to MongoDB Atlas with clear, actionable logging.
 * The app refuses to serve traffic if the database is unreachable.
 */
async function connectDB() {
  ensureResolvers();

  mongoose.connection.on('error', (err) => {
    console.error(`[db] Connection error: ${err.message}`);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[db] Disconnected. Waiting for Mongoose to auto-reconnect...');
  });

  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: !env.isProd, // build indexes automatically outside production
  });

  console.log(`[db] Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.connection.close();
  console.log('[db] Connection closed.');
}

module.exports = { connectDB, disconnectDB };
