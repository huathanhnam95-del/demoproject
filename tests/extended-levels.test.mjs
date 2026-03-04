/**
 * Test suite for Fill mode (extended) difficulty levels.
 * Run with: node tests/extended-levels.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extendedIndexPath = path.resolve(__dirname, '../public/database/extended/index.json');

console.log('Starting extended level validation...');

const payload = JSON.parse(fs.readFileSync(extendedIndexPath, 'utf8'));
assert.ok(Array.isArray(payload.items), 'Expected extended index to contain an items array');

const counts = { 1: 0, 2: 0, 3: 0 };

for (const item of payload.items) {
  const { id, level } = item;
  assert.ok(Number.isInteger(level), `Item ${id} has a non-integer level: ${level}`);
  assert.ok(level >= 1 && level <= 3, `Item ${id} has an invalid level: ${level}`);
  counts[level] += 1;
}

assert.equal(
  payload.totalItems,
  payload.items.length,
  `totalItems mismatch: ${payload.totalItems} vs ${payload.items.length}`
);

assert.ok(counts[1] > 0, 'Expected at least one Level 1 item');
assert.ok(counts[2] > 0, 'Expected at least one Level 2 item');
assert.ok(counts[3] > 0, 'Expected at least one Level 3 item');

console.log(`Level counts: L1=${counts[1]}, L2=${counts[2]}, L3=${counts[3]}`);
console.log('Extended level validation passed');
