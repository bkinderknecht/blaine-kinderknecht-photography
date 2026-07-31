#!/usr/bin/env node
// Run this once locally (on your own computer, not Sawyer's) to
// generate the value for Netlify's ADMIN_PASSWORD_HASH environment
// variable — see the deployment guide for exactly where to paste it.
// The actual password is never written to any file or committed
// anywhere; only this hash goes into Netlify.
//
// Usage:
//   node scripts/hash-password.js "the-password-you-want"
//
// Run it again any time to change the password later — just paste
// the new hash over the old ADMIN_PASSWORD_HASH value in Netlify.

const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.js "your-password"');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');

console.log('\nSet this as the ADMIN_PASSWORD_HASH environment variable in Netlify:\n');
console.log(`${salt}:${hash}`);
console.log('');
