import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('ts-fsrs version matches between package.json and browser import map', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const match = html.match(/"ts-fsrs"\s*:\s*"https:\/\/esm\.sh\/ts-fsrs@([^"]+)"/);

    assert.ok(match, 'Expected ts-fsrs import map entry in public/index.html');
    assert.strictEqual(packageJson.dependencies['ts-fsrs'], match[1]);
});
