import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

import { HEADINGS, GROUPS, VOICES, normalize } from '../../public/prototypes/bel-working-as-equals-demo/content/source.mjs';
import { PLANKS, PHASES } from '../../public/prototypes/bel-working-as-equals-demo/activities/bridge.mjs';
import { QUESTIONS } from '../../public/prototypes/bel-working-as-equals-demo/activities/reversal.mjs';
import { CUBES } from '../../public/prototypes/bel-working-as-equals-demo/activities/cubes.mjs';
import { ETA_INITIAL, etaRemaining } from '../../public/prototypes/bel-working-as-equals-demo/presentation/final.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('../../public/prototypes/bel-working-as-equals-demo/presentation/source-manifest.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const deckEntry = manifest.inputs.find(f => f.url === '/native/deck.html');
const deckHtml = fs.readFileSync(deckEntry.path, 'utf8');
const oracle = JSON.parse(fs.readFileSync(new URL('../fixtures/bel-demo/content-oracle.json', import.meta.url), 'utf8'));

test('C01 / P02.1: canonical deck.html byte hash and total slide count', () => {
  const actualHash = crypto.createHash('sha256').update(deckHtml).digest('hex');
  assert.equal(actualHash, deckEntry.sha256, 'Canonical deck.html hash must match manifest declaration');
  assert.equal(oracle.slides.length, 21, 'Authoritative deck must contain exactly 21 slides');
});

test('C02 / P02.1: presentation group ranges and 21 slide labels match oracle', () => {
  assert.deepEqual(GROUPS, {
    A: [1, 3],
    C: [4, 9],
    E: [10, 16],
    G: [17, 18],
    I: [19, 20],
    J: [21, 21]
  });

  for (let n = 1; n <= 21; n++) {
    const screenLabel = String(n).padStart(2, '0');
    const slide = oracle.slides.find(s => s.screenLabel === screenLabel);
    assert.ok(slide, `Slide ${screenLabel} must exist in oracle`);
    assert.ok(deckHtml.includes(`data-screen-label="${screenLabel}"`), `deck.html must contain data-screen-label="${screenLabel}"`);
    if (slide.label) {
      assert.ok(deckHtml.includes(`data-label="${slide.label}"`), `deck.html must contain data-label="${slide.label}"`);
    }
  }
});

test('C03-C04 / P02.1: nine B route paragraphs across three headings match oracle', () => {
  assert.deepEqual(HEADINGS, ['The thought', 'Why it happened', 'The shift']);
  for (const route of ['B1', 'B2', 'B3']) {
    assert.equal(oracle.routes[route].length, 3, `${route} must have exactly 3 paragraphs`);
    assert.deepEqual(oracle.routes[route], oracle[route], `Backwards-compatible ${route} key must match routes[${route}]`);
  }

  // Verify against actual DOM sections in deck.html
  for (const [index, route] of ['B1', 'B2', 'B3'].entries()) {
    const screenLabel = String(index + 4).padStart(2, '0');
    const sectionMatch = deckHtml.match(new RegExp(`<section[^>]*data-screen-label="${screenLabel}"[\\s\\S]*?<\\/section>`));
    assert.ok(sectionMatch, `Section for ${route} (slide ${screenLabel}) must exist`);
    const paragraphs = [...sectionMatch[0].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].slice(0, 3).map(m => normalize(m[1]));
    assert.deepEqual(paragraphs, oracle.routes[route]);
  }
});

test('C05 / P02.1: five Gallery entries, portraits, quotes, and attribution match oracle', () => {
  assert.deepEqual(VOICES, ['Chet Faliszek', 'Josh Weier', 'Mike Morasky', 'Erik Wolpaw', 'Rich Geldreich']);
  assert.equal(oracle.gallery.length, 5);

  oracle.gallery.forEach((entry, idx) => {
    assert.equal(entry.name, VOICES[idx]);
    assert.equal(entry.slide, 10 + idx);
    assert.ok(entry.quote.length > 10, 'Quote must not be empty');
    assert.ok(entry.paragraphs.length >= 1, 'At least one explanatory paragraph required');
    assert.ok(/\.(jpe?g|png)$/i.test(entry.image), 'Image must point to portrait image file');

    // Confirm attribution in deck.html
    const screenLabel = String(10 + idx);
    const sectionMatch = deckHtml.match(new RegExp(`<section[^>]*data-screen-label="${screenLabel}"[\\s\\S]*?<\\/section>`));
    assert.ok(sectionMatch, `Gallery slide ${screenLabel} must exist in deck.html`);
    assert.ok(sectionMatch[0].includes(`alt="${entry.name}"`), `Image alt must match ${entry.name}`);
  });
});

test('C06-C07 / P02.1: six F bridge planks and 3 phases match oracle', () => {
  assert.deepEqual(PHASES, ['Preparation', 'Action', 'Review & revision']);
  assert.equal(PLANKS.length, 6);
  assert.deepEqual(PLANKS, oracle.bridge.planks);

  // Validate plank properties
  const expectedColors = ['teal', 'violet', 'rose', 'red', 'blue', 'amber'];
  const expectedMarks = ['diamond', 'two bars', 'star', 'circle', 'cross', 'triangle'];
  PLANKS.forEach(([color, mark, text, x, y], idx) => {
    assert.equal(color, expectedColors[idx], `Plank ${idx} color mismatch`);
    assert.equal(mark, expectedMarks[idx], `Plank ${idx} mark mismatch`);
    assert.ok(text.length > 5, `Plank ${idx} text too short`);
    assert.equal(typeof x, 'number');
    assert.equal(typeof y, 'number');
  });
});

test('C11-C12 / P02.1: six I reversal questions, split halves, answers, and feedback match oracle', () => {
  assert.equal(QUESTIONS.length, 6);
  assert.deepEqual(QUESTIONS, oracle.reversal.questions);

  const expectedAnswers = ['Do', "Don't", 'Do', "Don't", 'Do', "Don't"];
  QUESTIONS.forEach(([half1, half2, answer, feedback], idx) => {
    assert.equal(answer, expectedAnswers[idx], `Question ${idx} answer mismatch`);
    assert.ok(half1.endsWith(','), `Question ${idx} opening half must end with comma`);
    assert.ok(half2.endsWith('.'), `Question ${idx} second half must end with period`);
    assert.ok(feedback.length > 10, `Question ${idx} feedback too short`);
  });
});

test('C15 / P02.1: six J cubes, pairs, and 3 closing objectives match oracle', () => {
  assert.equal(CUBES.length, 6);
  assert.deepEqual(CUBES, oracle.cubes.items);

  // Validate cube terms and pairs
  const pairCounts = [0, 0, 0];
  CUBES.forEach(([color, mark, text, pair, x, y], idx) => {
    assert.ok(pair >= 0 && pair <= 2, `Cube ${idx} invalid pair`);
    pairCounts[pair]++;
    assert.ok(text.length > 2, `Cube ${idx} text too short`);
    assert.equal(typeof x, 'number');
    assert.equal(typeof y, 'number');
  });
  assert.deepEqual(pairCounts, [2, 2, 2], 'Each pair must have exactly 2 matching cubes');

  // Validate 3 objectives from slide 21
  assert.equal(oracle.objectives.length, 3);
  oracle.objectives.forEach(obj => {
    assert.ok(obj.title.length > 5, 'Objective title too short');
    assert.ok(obj.detail.length > 10, 'Objective detail too short');
    assert.ok(deckHtml.includes(obj.detail), 'Objective detail must be in deck.html');
  });
});

test('C18 / P02.1: Determine / ETA initial constants and countdown function', () => {
  assert.equal(ETA_INITIAL, 6 * 30 * 24 * 3600 * 1000); // 180 days in ms
  assert.equal(oracle.final.etaInitialMs, ETA_INITIAL);

  // Test deterministic countdown behavior
  const origin = 1000000;
  assert.equal(etaRemaining(origin, origin + 1000), ETA_INITIAL, 'Before 2000ms delay, ETA remains initial');
  assert.equal(etaRemaining(origin, origin + 2000), ETA_INITIAL, 'At 2000ms delay, ETA remains initial');
  assert.equal(etaRemaining(origin, origin + 3000), ETA_INITIAL - 1000, 'At 3000ms, ETA decreases by 1000ms');
  assert.equal(etaRemaining(origin, origin + 7000), ETA_INITIAL - 5000, 'At 7000ms, ETA decreases by 5000ms');
});
