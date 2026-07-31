import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../public/crm-admin.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../../public/crm-admin.html', import.meta.url), 'utf8');

assert.match(html, /value="auto_unrateable"/);
assert.match(source, /Could not rate this recording reliably\./);
assert.match(source, /primary stress verified on syllable/);
assert.match(source, /Incorrect: heard/);
assert.match(source, /samplesAutoUnrateableByWord/);
assert.match(source, /analysis\?\.verification\?\.status/);
assert.match(source, /VERIFICATION_CONTRACT_UNAVAILABLE/);
assert.match(source, /api\.analyzeV3\(audioBlob/);
assert.doesNotMatch(source, /strongest detected/);
assert.doesNotMatch(source, /Legacy fields below are retained/);
assert.doesNotMatch(source, /appendAnalysisLine/);

console.log('CRM verification contract tests passed');
