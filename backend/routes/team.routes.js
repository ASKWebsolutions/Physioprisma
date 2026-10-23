'use strict';

const express = require('express');

const TeamMember = require('../models/Team.model');
const { asyncHandler } = require('../middleware/error');

const router = express.Router();

/* ==================================================================== */
/* GET /api/team - public leadership team (dr.sultan.html)              */
/* ==================================================================== */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const members = await TeamMember.find().sort({ order: 1, createdAt: 1 }).limit(60);
    res.json({ ok: true, count: members.length, team: members.map((m) => m.toPublic()) });
  })
);

module.exports = router;
