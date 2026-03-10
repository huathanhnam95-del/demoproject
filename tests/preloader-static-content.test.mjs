import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const wordmarkMatch = html.match(/id="preloader-wordmark"[^>]*>([^<]+)</);
const subtitleMatch = html.match(/id="preloader-text"[^>]*>([^<]+)</);

assert.ok(wordmarkMatch, 'Expected preloader wordmark element');
assert.ok(subtitleMatch, 'Expected preloader subtitle element');
assert.equal(wordmarkMatch[1].trim(), 'BEL', 'Preloader wordmark should only read BEL');
assert.equal(
  subtitleMatch[1].trim(),
  'Better English Learning',
  'Preloader subtitle should only read Better English Learning'
);

assert.ok(!html.includes('Loading Practice Data...'), 'Legacy loading copy should be removed from the preloader');
assert.ok(!html.includes('English in motion'), 'Legacy kicker copy should be removed from the preloader');

console.log('Preloader static content tests passed');
