const assert = require('assert');
const fs = require('fs');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting shared practice attempts privacy contract test...');

const filePath = path.join(process.cwd(), 'functions', 'src', 'routes', 'shared-practice-attempts.js');
assert.ok(fs.existsSync(filePath), 'functions/src/routes/shared-practice-attempts.js should exist');

const src = fs.readFileSync(filePath, 'utf8');

assert.ok(
  src.includes("res.set('Cache-Control', 'no-store')"),
  'shared endpoint should set Cache-Control: no-store'
);
assert.ok(
  src.includes("res.set('X-Robots-Tag', 'noindex')"),
  'shared endpoint should set X-Robots-Tag: noindex'
);
assert.ok(
  src.includes(".where('visibility', '==', 'shared')"),
  'shared endpoint should return only shared-visibility feedback'
);
assert.ok(
  src.includes('buildPublicAttemptPayload'),
  'shared endpoint should build a redacted public attempt payload'
);
assert.ok(
  !src.includes('ownerUid: attempt.ownerUid'),
  'shared endpoint should not expose ownerUid in the public payload'
);
assert.ok(
  src.includes('media: publicMedia'),
  'shared endpoint should return only public media URLs from the sanitized media manifest'
);

console.log('Shared practice attempts privacy contract test passed.');
