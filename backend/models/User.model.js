'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['student', 'ambassador', 'admin'];
const STATUSES = ['pending', 'active', 'suspended', 'rejected'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 120 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      index: true,
    },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    city: { type: String, trim: true, maxlength: 80, default: '' },
    password: { type: String, required: [true, 'Password is required'], minlength: 6, select: false },

    role: { type: String, enum: ROLES, default: 'student', index: true },
    status: { type: String, enum: STATUSES, default: 'pending', index: true },

    // Ambassadors only - their shareable code
    referralCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    // Whoever referred this user at registration (?ref=CODE)
    referredBy: { type: String, trim: true, uppercase: true, default: null, index: true },

    lastLoginAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    joinedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

/** Hash the password whenever it changed (not on every save). */
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  const rounds = 10;
  this.password = await bcrypt.hash(this.password, rounds);
  return next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

/** Safe representation for API responses (no hash). */
userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    phone: this.phone,
    city: this.city,
    role: this.role,
    status: this.status,
    referralCode: this.referralCode || null,
    joinedAt: this.joinedAt,
  };
};

/** True only for fully approved, usable accounts. */
userSchema.methods.isActive = function isActive() {
  return this.status === 'active';
};

/** Display helpers used by dashboards (dd Mon yyyy, matching the existing UI). */
userSchema.virtual('joinedText').get(function joinedText() {
  return new Date(this.joinedAt || Date.now()).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
});

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
module.exports.STATUSES = STATUSES;
