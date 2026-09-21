const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let stressEngine;
const cmudictPath = path.resolve(__dirname, '../public/cmudict.json');
let cmudict = {};
if (fs.existsSync(cmudictPath)) {
  cmudict = JSON.parse(fs.readFileSync(cmudictPath, 'utf8'));
}

test.before(async () => {
  await import(pathToFileURL(path.join(__dirname, '../public/js/read-aloud-stress-rhythm.js')).href);
  stressEngine = globalThis.ReadAloudStressRhythm;
});

test('ReadAloudStressRhythm: reproduces 5 reference image sentences with exact syllable stress', () => {
  const sentence1 = "It's super quick and easy to make.";
  const out1 = stressEngine.formatPromptHtml(sentence1, cmudict);
  assert.equal(
    out1,
    'It\'s <span class="ra-stress-peak">su</span>per <span class="ra-stress-peak">quick</span> and <span class="ra-stress-peak">ea</span>sy to <span class="ra-stress-peak">make</span>.'
  );

  const sentence2 = "Combine two tablespoons of coconut oil, one tablespoon of baking soda, and fifteen to twenty drops of essential oil.";
  const out2 = stressEngine.formatPromptHtml(sentence2, cmudict);
  assert.equal(
    out2,
    'Com<span class="ra-stress-peak">bine</span> <span class="ra-stress-peak">two</span> <span class="ra-stress-peak">ta</span>blespoons of <span class="ra-stress-peak">co</span>conut <span class="ra-stress-peak">oil</span>, <span class="ra-stress-peak">one</span> <span class="ra-stress-peak">ta</span>blespoon of <span class="ra-stress-peak">ba</span>king <span class="ra-stress-peak">so</span>da, and fif<span class="ra-stress-peak">teen</span> to <span class="ra-stress-peak">twen</span>ty <span class="ra-stress-peak">drops</span> of es<span class="ra-stress-peak">sen</span>tial <span class="ra-stress-peak">oil</span>.'
  );

  const sentence3 = "I like to use peppermint, but you can use cinnamon or spearmint.";
  const out3 = stressEngine.formatPromptHtml(sentence3, cmudict);
  assert.equal(
    out3,
    '<span class="ra-stress-peak">I</span> <span class="ra-stress-peak">like</span> to use <span class="ra-stress-peak">pep</span>permint, but <span class="ra-stress-peak">you</span> can <span class="ra-stress-peak">use</span> <span class="ra-stress-peak">cin</span>namon or <span class="ra-stress-peak">spear</span>mint.'
  );

  const sentence4 = "I like to use a compostable toothbrush and a spoon.";
  const out4 = stressEngine.formatPromptHtml(sentence4, cmudict);
  assert.equal(
    out4,
    '<span class="ra-stress-peak">I</span> <span class="ra-stress-peak">like</span> to use a com<span class="ra-stress-peak">pos</span>table <span class="ra-stress-peak">tooth</span>brush and a <span class="ra-stress-peak">spoon</span>.'
  );

  const sentence5 = "If it's too hard, put it under some warm water for a few minutes.";
  const out5 = stressEngine.formatPromptHtml(sentence5, cmudict);
  assert.equal(
    out5,
    'If it\'s <span class="ra-stress-peak">too</span> <span class="ra-stress-peak">hard</span>, put it <span class="ra-stress-peak">un</span>der some <span class="ra-stress-peak">warm</span> <span class="ra-stress-peak">wa</span>ter for a <span class="ra-stress-peak">few</span> <span class="ra-stress-peak">min</span>utes.'
  );
});

test('ReadAloudStressRhythm: correctly separates content vs function words', () => {
  // Function words remain unstressed
  assert.equal(stressEngine.formatWordHtml('the'), 'the');
  assert.equal(stressEngine.formatWordHtml('and'), 'and');
  assert.equal(stressEngine.formatWordHtml('of'), 'of');
  assert.equal(stressEngine.formatWordHtml('to'), 'to');

  // Stressed monosyllabic content words
  assert.equal(stressEngine.formatWordHtml('quick'), '<span class="ra-stress-peak">quick</span>');
  assert.equal(stressEngine.formatWordHtml('spoon'), '<span class="ra-stress-peak">spoon</span>');
  assert.equal(stressEngine.formatWordHtml('hard'), '<span class="ra-stress-peak">hard</span>');
  assert.equal(stressEngine.formatWordHtml('warm'), '<span class="ra-stress-peak">warm</span>');
});

test('ReadAloudStressRhythm: correctly isolates primary stressed syllable', () => {
  // Initial stress
  assert.equal(stressEngine.formatWordHtml('super'), '<span class="ra-stress-peak">su</span>per');
  assert.equal(stressEngine.formatWordHtml('water'), '<span class="ra-stress-peak">wa</span>ter');
  assert.equal(stressEngine.formatWordHtml('twenty'), '<span class="ra-stress-peak">twen</span>ty');

  // Non-initial stress (preserves case)
  assert.equal(stressEngine.formatWordHtml('Combine'), 'Com<span class="ra-stress-peak">bine</span>');
  assert.equal(stressEngine.formatWordHtml('combine'), 'com<span class="ra-stress-peak">bine</span>');
  assert.equal(stressEngine.formatWordHtml('essential'), 'es<span class="ra-stress-peak">sen</span>tial');
  assert.equal(stressEngine.formatWordHtml('fifteen'), 'fif<span class="ra-stress-peak">teen</span>');
});
