'use strict';

/**
 * Vercel serverless entry point.
 *
 * vercel.json routes everything under /api/* here; the static site is served
 * straight from the CDN. The function re-uses the exact same Express app as
 * local development (backend/server.js), so behaviour matches: the database
 * is connected on the first request and reused on warm instances.
 */

const { app } = require('../backend/server');

module.exports = app;
