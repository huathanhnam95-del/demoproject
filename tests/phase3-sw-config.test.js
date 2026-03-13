const assert = require('assert');
const fs = require('fs');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting Phase 3 service worker config test...');

const swPath = path.join(process.cwd(), 'public', 'sw.js');
const source = fs.readFileSync(swPath, 'utf8');

assert.ok(
  source.includes("'/dictionary-service.js'"),
  'service worker should precache the real dictionary service path'
);
assert.ok(
  !source.includes("'/js/dictionary-service.js'"),
  'service worker must not precache the wrong /js/dictionary-service.js path'
);
assert.ok(
  !source.includes("'/cmudict.json'"),
  'service worker should not force-download the 3.8 MB CMU dict during install'
);

console.log('Phase 3 service worker config test passed.');
