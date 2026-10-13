'use strict';

const mongoose = require('mongoose');

/**
 * Messages submitted through the "Send Us a Message" form on contact.html.
 * Kept deliberately flat so the admin panel can render every field verbatim.
 */
const contactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    email: { type: String, default: '', trim: true, maxlength: 160 },
    concern: { type: String, default: '', trim: true, maxlength: 80 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },

    status: { type: String, enum: ['new', 'replied'], default: 'new', index: true },
    source: { type: String, default: 'contact-form', maxlength: 40 },
  },
  { timestamps: true }
);

/** Shape used by the admin Messages panel. */
contactMessageSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    phone: this.phone,
    email: this.email,
    concern: this.concern,
    message: this.message,
    status: this.status,
    source: this.source,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('ContactMessage', contactMessageSchema);
