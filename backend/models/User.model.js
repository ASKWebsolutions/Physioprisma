'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { nextRollNo } = require('../utils/rollNo');

const ROLES = ['student', 'ambassador', 'admin'];
const STATUSES = ['pending', 'active', 'suspended', 'rejected'];

const userSchema = new mongoose.Schema(
  {
    // Permanent account id, e.g. PP-0007 - shown in the admin panel and used
    // to open a person's track record.
    rollNo: { type: String, trim: true, uppercase: true, unique: true, sparse: true, index: true },

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

    // Primary role (shown in the panel). One account can ALSO be an approved
    // ambassador on top of being a student - see ambassadorStatus below.
    role: { type: String, enum: ROLES, default: 'student', index: true },
    status: { type: String, enum: STATUSES, default: 'pending', index: true },

    // Ambassador capability, tracked separately from `role` so a student can
    // become an ambassador WITHOUT losing their student account:
    //   none      - never applied (or admin removed the capability)
    //   pending   - application waiting for admin approval
    //   active    - approved: may use the ambassador portal + referral code
    //   rejected  - application was rejected (the student account stays intact)
    // Standalone ambassador accounts (role === 'ambassador') mirror their
    // account status here so every query has one source of truth.
    ambassadorStatus: { type: String, enum: ['none', 'pending', 'active', 'rejected'], default: 'none', index: true },

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

/** Assign a roll number the first time an account is saved. */
userSchema.pre('save', async function assignRollNo(next) {
  if (this.rollNo) return next();
  this.rollNo = await nextRollNo(this.constructor);
  return next();
});

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
    rollNo: this.rollNo || '',
    name: this.name,
    email: this.email,
    phone: this.phone,
    city: this.city,
    role: this.role,
    status: this.status,
    ambassadorStatus: this.ambassadorStatus || 'none',
    referralCode: this.referralCode || null,
    joinedAt: this.joinedAt,
  };
};

/** True only for fully approved, usable accounts. */
userSchema.methods.isActive = function isActive() {
  return this.status === 'active';
};

/**
 * Capability check used by every role gate. One account can hold more than
 * one role: an approved ambassador who registered as a student keeps both.
 *   - 'student'   -> students AND ambassadors may study
 *   - 'ambassador'-> role ambassadors PLUS students approved as ambassadors
 *   - 'admin'     -> admins only
 */
userSchema.methods.hasRole = function hasRole(role) {
  if (role === 'admin') return this.role === 'admin';
  if (role === 'ambassador') return this.role === 'ambassador' || this.ambassadorStatus === 'active';
  if (role === 'student') return this.role === 'student' || this.role === 'ambassador';
  return this.role === role;
};

/** True when this account may use the ambassador portal. */
userSchema.methods.isAmbassador = function isAmbassador() {
  return this.role === 'ambassador' || this.ambassadorStatus === 'active';
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
