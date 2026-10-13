'use strict';

/**
 * Tiny dependency-free request validator.
 *
 *   app.post('/x', validate({ email: { type: 'email', required: true },
 *                             name:  { type: 'string', min: 2, max: 120 } }), handler)
 *
 * On success it trims/coerces values onto `req.body`.
 * On failure it responds 400 with `{ ok:false, error, details }`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{6,19}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const RULES = {
  string: (v) => typeof v === 'string',
  email: (v) => typeof v === 'string' && EMAIL_RE.test(v) && v.length <= 254,
  phone: (v) => typeof v === 'string' && PHONE_RE.test(v),
  password: (v) => typeof v === 'string' && v.length >= 6 && v.length <= 128,
  slug: (v) => typeof v === 'string' && SLUG_RE.test(v) && v.length <= 160,
  url: (v) => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v) && v.length <= 2000,
  boolean: (v) => typeof v === 'boolean',
  number: (v) => Number.isFinite(v),
  enum: (v, rule) => rule.values.includes(v),
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

const MESSAGES = {
  required: (field) => `${label(field)} is required`,
  email: (field) => `${label(field)} must be a valid email address`,
  phone: (field) => `${label(field)} must be a valid phone number`,
  password: () => 'Password must be at least 6 characters',
  slug: (field) => `${label(field)} must be a lowercase slug (a-z, 0-9, dashes)`,
  url: (field) => `${label(field)} must be a valid http(s) URL`,
  enum: (field, rule) => `${label(field)} must be one of: ${rule.values.join(', ')}`,
  type: (field, rule) => `${label(field)} has an invalid format`,
  min: (field, rule) => `${label(field)} must be at least ${rule.min} characters`,
  max: (field, rule) => `${label(field)} must be at most ${rule.max} characters`,
  minItems: (field, rule) => `${label(field)} needs at least ${rule.minItems} item(s)`,
  intRange: (field, rule) => `${label(field)} must be between ${rule.min} and ${rule.max}`,
};

function label(field) {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_]/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function validateField(field, rule, rawValue, errors) {
  const required = rule.required !== false; // required by default
  let value = rawValue;

  if (value === undefined || value === null || value === '') {
    if (required) errors.push(MESSAGES.required(field));
    return { skip: true };
  }

  if (typeof value === 'string') value = value.trim();

  // Coerce common numeric inputs coming from query strings / forms
  if (rule.type === 'number' && typeof value === 'string' && value !== '') {
    const num = Number(value);
    if (Number.isFinite(num)) value = num;
  }

  const checker = RULES[rule.type];
  if (checker && !checker(value, rule)) {
    const messageKey = MESSAGES[rule.type] ? rule.type : 'type';
    errors.push(typeof MESSAGES[messageKey] === 'function' ? MESSAGES[messageKey](field, rule) : MESSAGES.type(field, rule));
    return { skip: true };
  }

  if (rule.type === 'string' || rule.type === 'email' || rule.type === 'slug' || rule.type === 'url') {
    if (rule.min && value.length < rule.min) errors.push(MESSAGES.min(field, rule));
    if (rule.max && value.length > rule.max) errors.push(MESSAGES.max(field, rule));
  }
  if (rule.type === 'number') {
    if (rule.min !== undefined && value < rule.min) errors.push(MESSAGES.intRange(field, rule));
    if (rule.max !== undefined && value > rule.max) errors.push(MESSAGES.intRange(field, rule));
    if (rule.integer && !Number.isInteger(value)) errors.push(MESSAGES.intRange(field, rule));
  }
  if (rule.type === 'array') {
    if (rule.minItems && value.length < rule.minItems) errors.push(MESSAGES.minItems(field, rule));
    if (rule.items && rule.items.type) {
      value.forEach((item, i) => {
        const sub = [];
        validateField(`${field}[${i}]`, { type: rule.items.type, required: true, ...rule.items }, item, sub);
        errors.push(...sub);
      });
    }
  }

  return { value };
}

function validate(rules) {
  return (req, res, next) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const errors = [];

    for (const [field, rule] of Object.entries(rules)) {
      const result = validateField(field, rule, body[field], errors);
      if (!result.skip) body[field] = result.value;
    }

    if (errors.length) {
      return res.status(400).json({ ok: false, error: errors[0], details: errors });
    }

    req.body = body;
    return next();
  };
}

module.exports = { validate, EMAIL_RE, PHONE_RE, SLUG_RE };
