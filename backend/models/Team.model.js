'use strict';

const mongoose = require('mongoose');

/**
 * A member of the clinic leadership team, shown on dr.sultan.html
 * ("Meet the Team - Our Leadership Team"). Managed from the admin panel.
 */
const teamMemberSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 120 },
    designation: { type: String, required: [true, 'Designation is required'], trim: true, maxlength: 160 },

    // Uploaded photo (Cloudinary) - shown in the round avatar.
    image: {
      url: { type: String, default: '' },
      publicId: { type: String, default: '' },
    },

    // Featured members get the full-width highlighted card (CEO style).
    featured: { type: Boolean, default: false },

    // Accent colour of the card, matching the site palette.
    accent: { type: String, enum: ['purple', 'blue'], default: 'purple' },

    // Display order on the public page (ascending).
    order: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

/** Safe representation for API responses. */
teamMemberSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    designation: this.designation,
    image: { url: this.image && this.image.url ? this.image.url : '', publicId: (this.image && this.image.publicId) || '' },
    featured: !!this.featured,
    accent: this.accent === 'blue' ? 'blue' : 'purple',
    order: Number.isFinite(this.order) ? this.order : 0,
  };
};

module.exports = mongoose.model('TeamMember', teamMemberSchema);
