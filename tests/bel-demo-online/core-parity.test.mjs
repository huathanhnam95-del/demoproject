import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { pairs, checkOrCopy } = require('../../scripts/bel-demo/build-online-core.cjs');

test('online generated core is byte-identical to canonical server core', () => {
    assert.equal(checkOrCopy({ check: true }).mismatches.length, 0);
    for (const [, canonical, output] of pairs) {
        assert.deepEqual(fs.readFileSync(path.join(root, canonical)), fs.readFileSync(path.join(root, output)));
    }
});
