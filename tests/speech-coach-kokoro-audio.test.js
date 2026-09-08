/* eslint-disable no-console */
const assert = require('assert');

let audioCore = null;
try {
  audioCore = require('../scripts/kokoro/speech_coach_audio_core.js');
} catch (_) {
  // The red phase deliberately reports the missing implementation as a test failure.
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

test('generator core exposes the contract helpers', () => {
  assert.ok(audioCore, 'speech coach audio core must exist');
  assert.strictEqual(typeof audioCore.getWeakContext, 'function');
  assert.strictEqual(typeof audioCore.transformPhonemeWords, 'function');
  assert.strictEqual(typeof audioCore.buildAssetId, 'function');
  assert.strictEqual(typeof audioCore.parseWavHeader, 'function');
  assert.strictEqual(typeof audioCore.normalizeWavBuffer, 'function');
  assert.strictEqual(typeof audioCore.validateManifestEntry, 'function');
  assert.strictEqual(typeof audioCore.resolveWeakTargetIpa, 'function');
  assert.strictEqual(typeof audioCore.validatePhonemeTransformation, 'function');
});

test('manifest validation distinguishes missing, failed, stale, and ready entries', () => {
  const hash = 'a'.repeat(64);
  const baseAsset = { assetId: 'a', status: 'ready', file: 'clips/aa/a.mp3', durationMs: 1000, mp3Sha256: hash };
  const baseEvent = { eventId: 'e', assetId: 'a', status: 'ready', file: '/database/RA/speech-coach-audio/v1/clips/aa/a.mp3', durationMs: 1000, mp3Sha256: hash };
  assert.strictEqual(audioCore.validateManifestEntry({ event: baseEvent, asset: baseAsset, fileExists: true }).ok, true);
  assert.strictEqual(audioCore.validateManifestEntry({ event: { ...baseEvent, status: 'failed' }, asset: null, fileExists: false }).reason, 'event_failed');
  assert.strictEqual(audioCore.validateManifestEntry({ event: baseEvent, asset: null, fileExists: false }).reason, 'asset_missing');
  assert.strictEqual(audioCore.validateManifestEntry({ event: baseEvent, asset: baseAsset, fileExists: false }).reason, 'file_missing');
  assert.strictEqual(audioCore.validateManifestEntry({ event: { ...baseEvent, assetId: 'other' }, asset: baseAsset, fileExists: true }).reason, 'asset_id_mismatch');
  assert.strictEqual(audioCore.validateManifestEntry({ event: { ...baseEvent, mp3Sha256: null }, asset: baseAsset, fileExists: true }).reason, 'event_hash_missing');
  assert.strictEqual(audioCore.validateManifestEntry({ event: baseEvent, asset: { ...baseAsset, mp3Sha256: null }, fileExists: true }).reason, 'asset_hash_missing');
  assert.strictEqual(audioCore.validateManifestEntry({ event: { ...baseEvent, mp3Sha256: 'b'.repeat(64) }, asset: baseAsset, fileExists: true }).reason, 'hash_mismatch');
});

test('WAV normalization repairs Kokoro streaming size placeholders before decoding', () => {
  const buffer = Buffer.alloc(52);
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(0xffffffff, 4);
  buffer.write('WAVEfmt ', 8, 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24);
  buffer.writeUInt32LE(48000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(0xffffffff, 40);
  buffer.writeInt16LE(1200, 44);
  buffer.writeInt16LE(-1200, 46);
  buffer.writeInt16LE(800, 48);
  buffer.writeInt16LE(-800, 50);
  const normalized = audioCore.normalizeWavBuffer(buffer);
  assert.strictEqual(normalized.readUInt32LE(4), buffer.length - 8);
  assert.strictEqual(normalized.readUInt32LE(40), buffer.length - 44);
  assert.ok(audioCore.parseWavHeader(normalized).rms > 0);
});

test('WAV validation accepts Kokoro two-byte short data declarations only', () => {
  const buffer = Buffer.alloc(48);
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8, 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24);
  buffer.writeUInt32LE(48000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(6, 40);
  buffer.writeInt16LE(1200, 44);
  buffer.writeInt16LE(-1200, 46);
  const result = audioCore.parseWavHeader(buffer);
  assert.strictEqual(result.sampleRate, 24000);
  assert.strictEqual(result.channels, 1);
  assert.ok(result.rms > 0);
});

test('weak context is punctuation-bounded and keeps the target offset', () => {
  const result = audioCore?.getWeakContext('The cold storage, structures are ready', 0);
  assert.deepStrictEqual(result, {
    text: 'The cold storage',
    targetOffset: 0,
    wordCount: 3
  });

  const vowelContext = audioCore?.getWeakContext('said that the real task', 2);
  assert.deepStrictEqual(vowelContext, {
    text: 'that the real',
    targetOffset: 1,
    wordCount: 3
  });
});

test('weak context does not cross a hard punctuation boundary', () => {
  const result = audioCore?.getWeakContext('ten percent of; respondents answered', 2);
  assert.deepStrictEqual(result, {
    text: 'ten percent of',
    targetOffset: 2,
    wordCount: 3
  });
});

test('phoneme transforms alter only the requested connected-speech span', () => {
  assert.deepStrictEqual(
    audioCore?.transformPhonemeWords({
      family: 'weak_form_reduction',
      phonemeWords: ['w?z', '??n???'],
      targetIndex: 0,
      targetIpa: '/w?z/'
    }),
    ['w?z', '??n???']
  );

  assert.deepStrictEqual(
    audioCore?.transformPhonemeWords({
      family: 'n_bilabial_assimilation',
      phonemeWords: ['?n', '?m???m?t?ks'],
      targetIndex: 0
    }),
    ['?m', '?m???m?t?ks']
  );

  assert.deepStrictEqual(
    audioCore?.transformPhonemeWords({
      family: 'same_consonant_merge',
      phonemeWords: ['??d', 'd??'],
      targetIndex: 0
    }),
    ['??d', '??']
  );
});

test('yod transformations cover every coalescence mapping', () => {
  const yodCases = [
    ['d', 'd\u0292'],
    ['t', 't\u0283'],
    ['s', '\u0283'],
    ['z', '\u0292']
  ];
  yodCases.forEach(([source, merged]) => {
    assert.deepStrictEqual(
      audioCore?.transformPhonemeWords({ family: 'yod_coalescence', phonemeWords: [`a${source}`, 'j\u0259'], targetIndex: 0 }),
      [`a${merged}`, '\u0259']
    );
  });
});

test('phoneme validation rejects changes outside the controlled span', () => {
  assert.deepStrictEqual(
    audioCore.validatePhonemeTransformation({
      family: 'weak_form_reduction',
      baselineWords: ['\u00f0\u0259', 'r\u026a\u0259l'],
      transformedWords: ['\u00f0i', 'r\u026a\u0259l'],
      targetIndex: 0,
      targetIpa: '/\u00f0i/'
    }),
    { ok: true }
  );
  assert.strictEqual(
    audioCore.validatePhonemeTransformation({
      family: 'weak_form_reduction',
      baselineWords: ['\u00f0\u0259', 'r\u026a\u0259l'],
      transformedWords: ['\u00f0i', 'wrong'],
      targetIndex: 0,
      targetIpa: '/\u00f0i/'
    }).reason,
    'unexpected_phoneme_change'
  );
  assert.strictEqual(
    audioCore.validatePhonemeTransformation({
      family: 'n_bilabial_assimilation',
      baselineWords: ['\u026an', 'm\u00e6\u03b8'],
      transformedWords: ['\u026an', 'm\u00e6\u03b8'],
      targetIndex: 0
    }).reason,
    'target_unchanged'
  );
});

test('the weak IPA follows the next phoneme rather than the next letter', () => {
  assert.strictEqual(audioCore.resolveWeakTargetIpa({ targetWord: 'the', nextPhonemeWord: '\u02c8\u0251n\u026ast', fallbackIpa: '/\u00f0\u0259/' }), '/\u00f0i/');
  assert.strictEqual(audioCore.resolveWeakTargetIpa({ targetWord: 'the', nextPhonemeWord: '\u02ccju\u02d0n\u026a\u02c8v\u025c\u02d0s\u0259ti', fallbackIpa: '/\u00f0i/' }), '/\u00f0\u0259/');
  assert.strictEqual(audioCore.resolveWeakTargetIpa({ targetWord: 'was', nextPhonemeWord: '\u02c8redi', fallbackIpa: '/w\u0259z/' }), '/w\u0259z/');
});

test('generator revision fingerprints the tracked generator sources', () => {
  const generator = require('../scripts/kokoro/generate_speech_coach_audio.js');
  assert.match(generator.getGeneratorRevision(), /^[a-f0-9]{64}$/);
});

test('regenerate-failed still reuses healthy ready assets', () => {
  const generator = require('../scripts/kokoro/generate_speech_coach_audio.js');
  assert.strictEqual(generator.shouldReuseAsset({ status: 'ready' }, true, { resume: true, regenerateFailed: true }), true);
  assert.strictEqual(generator.shouldReuseAsset({ status: 'failed' }, true, { resume: true, regenerateFailed: true }), false);
  assert.strictEqual(generator.shouldReuseAsset({ status: 'ready' }, false, { resume: true, regenerateFailed: false }), false);
});

test('asset ids include target position and phonemes to prevent collisions', () => {
  const common = {
    version: 'sc-kokoro-v1',
    voice: 'af_heart',
    speed: 1,
    family: 'weak_form_reduction',
    spokenText: 'the real task'
  };
  const left = audioCore?.buildAssetId({ ...common, targetOffset: 0, phonemes: '?? ?i?l t?sk' });
  const right = audioCore?.buildAssetId({ ...common, targetOffset: 1, phonemes: '?i ?i?l t?sk' });
  assert.match(left, /^[a-f0-9]{64}$/);
  assert.match(right, /^[a-f0-9]{64}$/);
  assert.notStrictEqual(left, right);
});

test('event contexts use weak windows and exact boundaries for other families', () => {
  const weak = audioCore?.buildEventContext('said that the real task', {
    family: 'weak_form_reduction',
    startWordIndex: 2,
    phrase: 'the'
  });
  assert.deepStrictEqual(weak, {
    text: 'that the real',
    targetOffset: 1,
    targetWordIndex: 2
  });

  const boundary = audioCore?.buildEventContext('in mathematics today', {
    family: 'n_bilabial_assimilation',
    startWordIndex: 0,
    endWordIndex: 1,
    phrase: 'in mathematics'
  });
  assert.deepStrictEqual(boundary, {
    text: 'in mathematics',
    targetOffset: 0,
    targetWordIndex: 0
  });
});

test('controlled phoneme strings join boundaries only for boundary events', () => {
  assert.strictEqual(
    audioCore?.buildControlledPhonemes({
      family: 'catenation',
      phonemeWords: ['s??', '?v']
    }),
    's???v'
  );
  assert.strictEqual(
    audioCore?.buildControlledPhonemes({
      family: 'weak_form_reduction',
      phonemeWords: ['??', '?i?l', 't?sk']
    }),
    '?? ?i?l t?sk'
  );
});

test('runtime tokenizer is exported identically from source and Functions copies', () => {
  const sourceService = require('../src/read-aloud/connected-speech-service.js');
  const functionsService = require('../functions/src/read-aloud/connected-speech-service.js');
  assert.strictEqual(typeof sourceService.getPromptTokens, 'function');
  assert.strictEqual(typeof functionsService.getPromptTokens, 'function');
  assert.deepStrictEqual(
    functionsService.getPromptTokens('Pick it, up now'),
    sourceService.getPromptTokens('Pick it, up now')
  );
});


test('question coverage preserves incremental outputs and rejects broken declarations', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { collectQuestionManifestIds } = require('../scripts/kokoro/generate_speech_coach_audio.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-coach-catalog-'));
  const write = (id, overrides = {}) => fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ version: 'sc-kokoro-v1', questionId: id, events: {}, ...overrides }));
  try {
    assert.deepStrictEqual(collectQuestionManifestIds(dir), []);
    write('731');
    assert.deepStrictEqual(collectQuestionManifestIds(dir), ['731']);
    write('8');
    assert.deepStrictEqual(collectQuestionManifestIds(dir, ['731']), ['8', '731']);
    write('1052');
    assert.deepStrictEqual(collectQuestionManifestIds(dir, ['8', '731']), ['8', '731', '1052']);
    assert.throws(() => collectQuestionManifestIds(dir, ['999']), /ENOENT/);
    for (const invalid of [null, {}, [731], ['../731'], ['731', '731']]) {
      assert.throws(() => collectQuestionManifestIds(dir, invalid), /Invalid questionManifestIds/);
    }
    for (const overrides of [{ version: 'old' }, { questionId: '9' }, { events: [] }, { events: null }]) {
      write('731', overrides);
      assert.throws(() => collectQuestionManifestIds(dir, ['731']), /Invalid question manifest/);
    }
    fs.writeFileSync(path.join(dir, '731.json'), '{');
    assert.throws(() => collectQuestionManifestIds(dir, ['731']), SyntaxError);
  } finally {
    const cleanupPath = path.resolve(dir);
    assert.strictEqual(path.dirname(cleanupPath), path.resolve(os.tmpdir()), 'cleanup must stay directly under the OS temporary root');
    assert.ok(path.basename(cleanupPath).startsWith('speech-coach-catalog-'), 'cleanup must target this fixture prefix');
    fs.rmSync(cleanupPath, { recursive: true, force: true });
  }
});
