'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const harnessPath = path.resolve(__dirname, 'pronounce-mode-browser-check.js');
const marker = 'module-loaded';
const child = spawnSync(
  process.execPath,
  [
    '-e',
    `(async () => { ` +
      `const moduleExports = require(${JSON.stringify(harnessPath)}); ` +
      `if (typeof moduleExports.startServer !== 'function' || typeof moduleExports.closeServer !== 'function') process.exit(2); ` +
      `const running = await moduleExports.startServer(); ` +
      `if (!running.server.listening) process.exit(3); ` +
      `await moduleExports.closeServer(running.server); ` +
      `if (running.server.listening) process.exit(4); ` +
      `process.stdout.write(${JSON.stringify(marker)}); ` +
      `})().catch(() => process.exit(5));`,
  ],
  { encoding: 'utf8', timeout: 5000 },
);

assert.strictEqual(child.error, undefined, child.error?.message || 'module import timed out');
assert.strictEqual(child.status, 0, child.stderr || `child exited with ${child.status}`);
assert.strictEqual(child.stdout, marker, 'requiring the harness must not execute the browser check');
assert.strictEqual(child.stderr, '', 'requiring the harness must not write test output');
process.stdout.write('pronounce-harness module contract passed\n');
