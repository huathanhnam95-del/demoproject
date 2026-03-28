/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(process.cwd(), 'public/auth-ui.js'), 'utf8');

const initializeCalls = source.match(/initializeAuthUI\(\);/g) || [];
assert.ok(
  initializeCalls.length <= 1,
  `auth-ui.js should not auto-bootstrap initializeAuthUI more than once; found ${initializeCalls.length}.`
);

assert.match(
  source,
  /waitForInitialAuthResolution/,
  'checkFirstVisit should wait for auth resolution instead of relying on fixed delays.'
);

assert.doesNotMatch(
  source,
  /setTimeout\(checkFirstVisit,\s*1000\)/,
  'checkFirstVisit should not be driven by a fixed 1000ms bootstrap delay.'
);

console.log('auth ui bootstrap contract passed');
