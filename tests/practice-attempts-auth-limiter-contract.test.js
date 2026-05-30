const assert = require('assert');
const fs = require('fs');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting practice attempts auth+limiter contract test...');

const apiAppPath = path.join(process.cwd(), 'functions', 'src', 'apiApp.js');
const localServerPath = path.join(process.cwd(), 'src', 'server', 'app.js');
assert.ok(fs.existsSync(apiAppPath), 'functions/src/apiApp.js should exist');
assert.ok(fs.existsSync(localServerPath), 'src/server/app.js should exist');
const src = fs.readFileSync(apiAppPath, 'utf8');
const localServerSrc = fs.readFileSync(localServerPath, 'utf8');

assert.ok(
  src.includes("app.use('/api/practice-attempts', authMiddleware, practiceAttemptsLimiterByUid, practiceAttemptsRouter);"),
  'practice-attempts mount should apply auth before uid-based rate limiter'
);
assert.ok(
  localServerSrc.includes('serverTimestamp: () => firebase.admin.firestore.FieldValue.serverTimestamp()'),
  'local server should provide timestamps from the same Admin SDK instance as its Firestore db'
);

console.log('Practice attempts auth+limiter contract test passed.');
