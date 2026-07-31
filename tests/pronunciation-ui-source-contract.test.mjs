import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(root, 'public', 'script.js'), 'utf8');
const runeStart = script.indexOf('// Pronunciation Rune:');
const shadowStart = script.indexOf('// Shadow Mode Toggle Logic', runeStart);
const runeBlock = script.slice(runeStart, shadowStart);

test('Pronunciation Rune uses the shared American IPA service', () => {
  assert.ok(runeStart >= 0, 'Pronunciation Rune block should exist');
  assert.doesNotMatch(runeBlock, /api\.dictionaryapi\.dev/u);
  assert.match(runeBlock, /Phonetics\.getIPAWithSource/u);
});

test('segmental screening loads the shared pronunciation service', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'pronunciation-test', 'index.html'), 'utf8');
  const bank = fs.readFileSync(path.join(root, 'public', 'pronunciation-test', 'test-bank.js'), 'utf8');

  assert.match(html, /\/phonetics\.js/u);
  assert.match(bank, /phonetics\.getIPA/iu);
});

test('Read Aloud derives linking and weak-form IPA from the shared service', () => {
  const mode = fs.readFileSync(path.join(root, 'public', 'read-aloud-mode.js'), 'utf8');

  assert.doesNotMatch(mode, /const commonIpa\s*=\s*\{/u);
  assert.doesNotMatch(mode, /const dict\s*=\s*\{/u);
  assert.match(mode, /getPronunciations/u);
  assert.match(mode, /primeSharedPronunciations/u);
});
