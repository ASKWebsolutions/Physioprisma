'use strict';

/**
 * Physioprisma backend entry point.
 *
 * Serves the JSON API under /api/* and the static website (frontend/) from the
 * same origin so the browser never has to deal with CORS in normal use.
 */

const path = require('path');

const { env } = require('./config/env'); // must be first: loads + validates .env
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { connectDB, disconnectDB } = require('./config/db');
const { seedAdmin } = require('./seed/seedAdmin');
const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/error');
const { ensureRoot, UPLOADS_ROOT } = require('./storage/local');

const app = express();

/* ------------------------------ Security ------------------------------ */
app.set('trust proxy', 1); // accurate client IPs behind Render/nginx
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: false, // the site uses inline scripts + Tailwind CDN
    crossOriginEmbedderPolicy: false,
  })
);

/* ------------------------------ Logging ------------------------------- */
if (env.isProd) {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

/* ------------------------------- CORS --------------------------------- */
// Same-origin by default (site + API served by this server).
// In development we also allow the usual static-server origins (VS Code Live
// Server etc.) so the frontend can be previewed while still reaching the API.
// For a hosted site on another domain, set CORS_ORIGIN in .env.
const devOrigins = env.isProd
  ? []
  : [
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://localhost:5501',
      'http://localhost:8080',
      'http://localhost:3000',
    ];
const allowedOrigins = [...new Set([...env.corsOrigins, ...devOrigins])];

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: true,
  })
);

/* --------------------------- Body parsing ----------------------------- */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* --------------------------- Rate limiting ---------------------------- */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests. Please slow down and try again shortly.' },
});
app.use('/api', apiLimiter);

/* ------------------------------- API ---------------------------------- */
app.get('/api/health', (req, res) => {
  const mongoose = require('mongoose');
  res.json({
    ok: true,
    name: 'physioprisma-api',
    env: env.NODE_ENV,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString(),
  });
});
app.use('/api', apiRoutes);

/* --------------------- Locally stored uploads ------------------------- */
// New images/videos land here until Cloudinary keys are configured.
// Frontend loads them from the same origin, e.g. /uploads/physioprisma/gallery/x.jpg
ensureRoot();
app.use(
  '/uploads',
  express.static(UPLOADS_ROOT, {
    index: false,
    etag: true,
    maxAge: env.isProd ? '7d' : 0,
    dotfiles: 'deny',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

/* --------------------------- Static website --------------------------- */
app.use(
  express.static(env.frontendDir, {
    index: false,
    etag: true,
    maxAge: env.isProd ? '7d' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);
app.get('/', (req, res) => res.redirect('/home.html'));

/* ----------------------------- Errors --------------------------------- */
app.use(notFound);
app.use(errorHandler);

/* ------------------------------ Boot ---------------------------------- */
async function start() {
  try {
    await connectDB();
    await seedAdmin();
  } catch (err) {
    console.error(`[boot] Failed to start: ${err.message}`);
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`[server] Physioprisma running at http://localhost:${env.port}`);
    console.log(`[server] Site:    http://localhost:${env.port}/home.html`);
    console.log(`[server] API:     http://localhost:${env.port}/api/health`);
    console.log(`[server] Admin:   http://localhost:${env.port}/admin-login.html`);
  });

  // Port already taken (usually a previous server/nodemon instance).
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[server] Port ${env.port} is already in use.`);
      console.error('[server] Another instance is probably still running. Stop it first:');
      console.error(`[server]   Windows:  netstat -ano | findstr :${env.port}`);
      console.error(`[server]             taskkill /PID <pid> /F`);
      console.error(`[server]   Or just use a different port:  set PORT=5001 && npm run dev`);
      process.exit(1);
    }
    console.error(`[server] Failed to start: ${err.message}`);
    process.exit(1);
  });

  const shutdown = (signal) => {
    console.log(`\n[server] ${signal} received, shutting down...`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    // Force exit if graceful shutdown stalls
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) start();

module.exports = { app, start };
