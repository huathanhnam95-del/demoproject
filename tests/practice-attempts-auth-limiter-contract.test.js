const assert = require('assert');
const fs = require('fs');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting practice attempts auth+limiter contract test...');

const apiAppPath = path.join(process.cwd(), 'functions', 'src', 'apiApp.js');
assert.ok(fs.existsSync(apiAppPath), 'functions/src/apiApp.js should exist');
const src = fs.readFileSync(apiAppPath, 'utf8');

assert.ok(
  src.includes("app.use('/api/practice-attempts', authMiddleware, practiceAttemptsLimiterByUid, practiceAttemptsRouter);"),
  'practice-attempts mount should apply auth before uid-based rate limiter'
);

console.log('Practice attempts auth+limiter contract test passed.');
