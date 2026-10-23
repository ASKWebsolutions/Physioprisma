'use strict';

/**
 * Seeds the leadership team that is currently hardcoded on dr.sultan.html
 * into the TeamMember collection so the admin panel can manage it.
 *
 * Idempotent: members that already exist (matched by name) are skipped, so
 * admin edits are never overwritten. Run from the backend folder:
 *
 *   node scripts/seed-team.js
 */

const mongoose = require('mongoose');
const { env } = require('../config/env');
const TeamMember = require('../models/Team.model');

const MEMBERS = [
  {
    name: 'Dr. Sultan Zaidi',
    designation: 'Chief Executive Officer - Founder & Director',
    url: 'https://res.cloudinary.com/jzbx0aax/image/upload/v1791881844/physioprisma/site/img/sultan_img.png',
    featured: true,
    accent: 'purple',
  },
  {
    name: 'Dr. Tuba Sultan',
    designation: 'Administrator and Consultant Physiotherapist',
    url: 'https://res.cloudinary.com/jzbx0aax/image/upload/v1791881804/physioprisma/site/img/dr-tuba.jpg',
    accent: 'blue',
  },
  {
    name: 'Dr. Basit Hussain',
    designation: 'Operations Coordinator and Physiotherapist',
    url: 'https://res.cloudinary.com/jzbx0aax/image/upload/v1791881802/physioprisma/site/img/basit.jpg',
    accent: 'purple',
  },
  {
    name: 'Dr. Bisma',
    designation: 'Incharge and Physiotherapist',
    url: 'https://res.cloudinary.com/jzbx0aax/image/upload/v1791881807/physioprisma/site/img/image-2.png',
    accent: 'purple',
  },
  {
    name: 'Dr. Atif',
    designation: 'Compliance Coordinator and Physiotherapist',
    url: 'https://res.cloudinary.com/jzbx0aax/image/upload/v1791881803/physioprisma/site/img/dratif2.jpg',
    accent: 'blue',
  },
  {
    name: 'Dr. Sabahat Fatima',
    designation: 'Physiotherapist',
    url: 'https://res.cloudinary.com/jzbx0aax/image/upload/v1791881803/physioprisma/site/img/Dr_Sabahat_Fatima.png',
    accent: 'blue',
  },
  {
    name: 'Dr. Fatima Maqsood',
    designation: 'Physiotherapist',
    url: 'https://res.cloudinary.com/jzbx0aax/image/upload/v1791881806/physioprisma/site/img/fatima_maqsood.png',
    accent: 'blue',
  },
];

(async () => {
  await mongoose.connect(env.mongoUri);

  let added = 0;
  let skipped = 0;
  for (let i = 0; i < MEMBERS.length; i++) {
    const m = MEMBERS[i];
    const existing = await TeamMember.findOne({ name: m.name });
    if (existing) {
      skipped++;
      console.log(`  skip  ${m.name} (already in the team)`);
      continue;
    }
    // The photo already lives on Cloudinary under site/img - keep that asset
    // instead of re-uploading, so nothing is duplicated.
    const last = await TeamMember.findOne().sort({ order: -1 }).select('order');
    await TeamMember.create({
      name: m.name,
      designation: m.designation,
      image: { url: m.url, publicId: '' },
      featured: !!m.featured,
      accent: m.accent,
      order: (last && Number.isFinite(last.order) ? last.order : -1) + 1,
    });
    added++;
    console.log(`  add   ${m.name}`);
  }

  console.log(`\nTeam seeded: ${added} added, ${skipped} already present.`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
