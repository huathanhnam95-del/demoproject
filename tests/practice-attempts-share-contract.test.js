const assert = require('assert');
const fs = require('fs');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting practice attempts share contract test...');

const filePath = path.join(process.cwd(), 'functions', 'src', 'routes', 'practice-attempts.js');
assert.ok(fs.existsSync(filePath), 'functions/src/routes/practice-attempts.js should exist');

const src = fs.readFileSync(filePath, 'utf8');

// Guard: only submitted attempts can be shared.
assert.ok(
  src.includes('ATTEMPT_NOT_SUBMITTED'),
  'share endpoint should reject sharing attempts that are not submitted'
);

// Lifecycle: revoke endpoint exists.
assert.ok(
  src.includes("router.delete('/:attemptId/share'"),
  'share revoke endpoint should exist'
);

// Lifecycle: rotate flag exists.
assert.ok(
  src.includes('const rotate = req.body?.rotate === true'),
  'share endpoint should support rotate=true'
);

console.log('Practice attempts share contract test passed.');

