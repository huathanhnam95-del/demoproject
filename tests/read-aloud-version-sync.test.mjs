import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Read Aloud mode cache token matches package version', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const match = html.match(/<script\s+src="\/read-aloud-mode\.js\?v=([^"]+)"><\/script>/);

  assert.ok(match, 'Expected public/index.html to load read-aloud-mode.js with a cache-busting token');
  assert.strictEqual(match[1], packageJson.version);
});
