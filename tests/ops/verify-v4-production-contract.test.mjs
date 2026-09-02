/**
 * Contract tests for verify-v4-production.ps1
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SCRIPT_PATH = new URL('../../scripts/release/verify-v4-production.ps1', import.meta.url);
const scriptExists = fs.existsSync(SCRIPT_PATH);

test('verify-v4-production script exists and defines required parameters', () => {
  assert.equal(scriptExists, true, 'scripts/release/verify-v4-production.ps1 must exist');
  const code = fs.readFileSync(SCRIPT_PATH, 'utf8');

  // Parameter contracts
  assert.match(code, /param\s*\(/i, 'Script must declare parameters');
  assert.match(code, /\$ExpectedGitSha/i, 'Script must accept ExpectedGitSha parameter');
  assert.match(code, /\$ExpectedPraatRevision/i, 'Script must accept ExpectedPraatRevision parameter');
  assert.match(code, /\$ExpectedPhonemeRevision/i, 'Script must accept ExpectedPhonemeRevision parameter');
  assert.match(code, /\$OutputPath/i, 'Script must accept OutputPath parameter');
  assert.match(code, /\$FixturePath/i, 'Script must accept FixturePath parameter for deterministic testing');
});

test('verify-v4-production script enforces read-only invariants and checks all required surfaces', () => {
  assert.equal(scriptExists, true);
  const code = fs.readFileSync(SCRIPT_PATH, 'utf8');

  // Surface checks
  assert.match(code, /\/health/, 'Must probe /health on praat-api');
  assert.match(code, /\/readyz/, 'Must probe /readyz on phoneme-recognizer');
  assert.match(code, /\/warm\/v3/, 'Must probe /warm/v3 on praat-api');
  assert.match(code, /get-iam-policy/, 'Must check IAM policy is private for phoneme-recognizer');
  assert.match(code, /Access-Control-Allow-Origin|OPTIONS|CORS/i, 'Must check CORS headers');

  // Invariant: no mutating verbs allowed
  for (const forbidden of [
    'update-traffic',
    'deploy',
    'delete',
    'add-iam-policy-binding',
    'set-iam-policy',
    'firebase deploy'
  ]) {
    const lines = code.split('\n').filter((l) => !l.trimStart().startsWith('#') && l.includes(forbidden));
    assert.equal(lines.length, 0, `Script must remain strictly read-only; found forbidden mutation token: ${forbidden}`);
  }
});
