const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const service = require('../functions/src/services/pronunciation-assessment-service');
const {
  normalizeToOxfordAmericanIPA,
  normalizeIPAsInText,
  findCoachingRule,
  generateSyllableCoaching,
  extractWordsAndSyllablesFromAzure,
  buildPronunciationAssessmentHeader
} = service;

test('PronunciationAssessmentService: builds canonical forced-alignment header with Comprehensive dimension', () => {
  const headerBase64 = buildPronunciationAssessmentHeader('The library is open.');
  const config = JSON.parse(Buffer.from(headerBase64, 'base64').toString('utf8'));

  assert.strictEqual(config.Dimension, 'Comprehensive');
  assert.strictEqual(config.Granularity, 'Phoneme');
  assert.strictEqual(config.GradingSystem, 'HundredMark');
  assert.strictEqual(config.PhonemeAlphabet, 'IPA');
  assert.strictEqual(config.EnableMiscue, true);
  assert.strictEqual(config.NBestPhonemeCount, 5);
  assert.strictEqual(config.ReferenceText, 'The library is open');
});

test('PronunciationAssessmentService: standardizes Oxford American IPA', () => {
  // Turned-r
  assert.strictEqual(normalizeToOxfordAmericanIPA('ɹed'), 'red');
  // Flap /ɾ/ -> /t/
  assert.strictEqual(normalizeToOxfordAmericanIPA('wɑːtəɾ'), 'wɑːtət');
  // /ɛ/ -> /e/
  assert.strictEqual(normalizeToOxfordAmericanIPA('bɛd'), 'bed');
  // /ɝ/ -> /ɜːr/ (NURSE vowel)
  assert.strictEqual(normalizeToOxfordAmericanIPA('bɝd'), 'bɜːrd');
  assert.strictEqual(normalizeToOxfordAmericanIPA('ɝ'), 'ɜːr');
  // /ɚ/ -> /ər/ (schwa+r)
  assert.strictEqual(normalizeToOxfordAmericanIPA('bɚd'), 'bərd');
  assert.strictEqual(normalizeToOxfordAmericanIPA('ɚ'), 'ər');
  // Strips tie-bars
  assert.strictEqual(normalizeToOxfordAmericanIPA('t\u0361ʃ'), 'tʃ');
});

test('PronunciationAssessmentService: articulatory coaching covers Vietnamese L1 error patterns', () => {
  // /f/ -> /t/ (unreleased coda substitution)
  const fToT = findCoachingRule('f', 't');
  assert.ok(fToT.obs.includes('stopped the air'));
  assert.ok(fToT.tip.includes('upper teeth'));

  // /θ/ soft th
  const th = findCoachingRule('θ', '');
  assert.ok(th.tip.includes('between your front teeth'));

  // /r/ American r
  const rCoaching = findCoachingRule('r', '');
  assert.ok(rCoaching.tip.includes('Curl the tip of your tongue'));
});

test('PronunciationAssessmentService: extracts words and multi-syllabic breakdowns with Oxford IPA and coaching', () => {
  const azureWords = [
    {
      Word: 'after',
      Offset: 10000000,
      Duration: 6000000,
      AccuracyScore: 68,
      ErrorType: 'None',
      Syllables: [
        { Syllable: 'æf', Grapheme: 'af', Offset: 10000000, Duration: 3000000, AccuracyScore: 50 },
        { Syllable: 'tər', Grapheme: 'ter', Offset: 13000000, Duration: 3000000, AccuracyScore: 86 }
      ],
      Phonemes: [
        { Phoneme: 'æ', Offset: 10000000, Duration: 1500000, AccuracyScore: 85 },
        { Phoneme: 'f', Offset: 11500000, Duration: 1500000, AccuracyScore: 35, NBestPhonemes: [{ Phoneme: 't' }] },
        { Phoneme: 't', Offset: 13000000, Duration: 1500000, AccuracyScore: 88 },
        { Phoneme: 'ər', Offset: 14500000, Duration: 1500000, AccuracyScore: 80 }
      ]
    }
  ];

  const extracted = extractWordsAndSyllablesFromAzure(azureWords);
  assert.strictEqual(extracted.length, 1);
  const word = extracted[0];
  assert.strictEqual(word.word, 'after');
  assert.strictEqual(word.accuracyScore, 68);
  assert.strictEqual(word.startMs, 1000);
  assert.strictEqual(word.endMs, 1600);
  assert.strictEqual(word.syllables.length, 2);

  const syl1 = word.syllables[0];
  assert.strictEqual(syl1.text, 'af');
  assert.strictEqual(syl1.accuracyScore, 50);
  assert.strictEqual(syl1.heardIpa, 'æt');
  assert.ok(syl1.diagnosis.includes('Sounded like /æt/'));
  assert.ok(syl1.tip.includes('Rest your upper teeth'));
});

test('PronunciationTooltip: safe monotonic envelope calculation does not throw on ultra-short durations', () => {
  // Load PronunciationTooltip module into a simulated window environment
  const mockContexts = [];
  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 10.0;
      this.destination = {};
      mockContexts.push(this);
    }
    createBufferSource() {
      return {
        buffer: null,
        connect() {},
        disconnect() {},
        start() {},
        stop() {}
      };
    }
    createGain() {
      const schedule = [];
      return {
        connect() {},
        gain: {
          setValueAtTime(val, time) {
            schedule.push({ type: 'set', val, time });
          },
          exponentialRampToValueAtTime(val, time) {
            schedule.push({ type: 'ramp', val, time });
          }
        },
        _getSchedule: () => schedule
      };
    }
  }

  const globalScope = {
    AudioContext: MockAudioContext,
    document: {
      createElement: () => ({
        style: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        addEventListener() {},
        appendChild() {}
      }),
      getElementById: () => null,
      body: { appendChild() {} }
    },
    window: {}
  };
  globalScope.window = globalScope;

  // Evaluate tooltip code
  const fs = require('fs');
  const tooltipSrc = fs.readFileSync(path.join(__dirname, '../public/js/pronunciation-tooltip.js'), 'utf8');
  const fn = new Function('global', 'window', 'document', 'AudioContext', tooltipSrc);
  fn(globalScope, globalScope, globalScope.document, MockAudioContext);

  const PronunciationTooltip = globalScope.PronunciationTooltip;
  assert.ok(PronunciationTooltip, 'PronunciationTooltip should be exported');
  assert.strictEqual(typeof PronunciationTooltip.getAudioContext, 'function');

  // Verify singleton AudioContext
  const ctx1 = PronunciationTooltip.getAudioContext();
  const ctx2 = PronunciationTooltip.getAudioContext();
  assert.strictEqual(ctx1, ctx2, 'getAudioContext should return reusable singleton');

  // Verify ultra-short duration (8ms) does not throw timing exceptions
  class MockBuffer {
    constructor() {
      this.duration = 1.0;
    }
  }
  const buffer = new MockBuffer();

  // Test durations: 8ms, 25ms, 150ms
  [8, 25, 150].forEach((durMs) => {
    assert.doesNotThrow(() => {
      PronunciationTooltip.playAudioSegment(buffer, 100, 100 + durMs);
    }, `Should safely play segment of duration ${durMs}ms`);
  });
});
