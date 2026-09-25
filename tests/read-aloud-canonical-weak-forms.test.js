'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL_DIR = path.join(ROOT, 'public', 'database', 'RA', 'weak-forms', 'canonical');

// Load client linking module
require(path.join(ROOT, 'public/js/read-aloud-prompt-grammar.js'));
require(path.join(ROOT, 'public/js/read-aloud-spoken-forms.js'));
require(path.join(ROOT, 'public/js/read-aloud-connected-speech-rules.js'));
require(path.join(ROOT, 'public/js/read-aloud-linking.js'));
const ReadAloudLinking = globalThis.ReadAloudLinking;

// Load a minimal mock environment for ReadAloudMode helper inspection
global.window = {
  ReadAloudLinking,
  Phonetics: null,
  speechSynthesis: { cancel() {}, speak() {} }
};
global.document = {
  querySelectorAll() { return []; },
  getElementById() { return null; },
  createElement() { return { setAttribute() {}, classList: { add() {}, remove() {} } }; }
};
global.Audio = class MockAudio {
  constructor() {
    this.src = '';
    this.paused = true;
    this.currentTime = 0;
    this.listeners = {};
  }
  addEventListener(event, fn) {
    this.listeners[event] = fn;
  }
  removeEventListener() {}
  load() {}
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {}
};

// Instantiate mock ReadAloudMode
class ReadAloudModeMock {
  static escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// Read actual methods from public/read-aloud-mode.js
const ramSource = fs.readFileSync(path.join(ROOT, 'public/read-aloud-mode.js'), 'utf8');

// Extract getGuideLeadLabel, resolveCanonicalWeakFormAudio, getCanonicalWeakFormCarrierPhrase,
// _buildSpokenModelFallbackControl, buildGuidePopoverListenControl, playSpeechCoachModelAudio, stopSpeechCoachModelAudio
function extractMethod(source, methodName) {
  const marker = `\n  ${methodName}(`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Method ${methodName} not found in read-aloud-mode.js`);
  const methodStart = start + 3; // skip \n and spaces
  let depth = 0;
  let bodyStart = -1;
  for (let i = methodStart; i < source.length; i++) {
    if (source[i] === '{') {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        const signature = source.slice(methodStart, bodyStart).trim();
        const body = source.slice(bodyStart, i + 1);
        return new Function('ReadAloudMode', `return function ${signature} ${body}`)(ReadAloudModeMock);
      }
    }
  }
  throw new Error(`Could not parse method ${methodName}`);
}

ReadAloudModeMock.prototype.getGuideLeadLabel = extractMethod(ramSource, 'getGuideLeadLabel');
ReadAloudModeMock.prototype.resolveCanonicalWeakFormAudio = extractMethod(ramSource, 'resolveCanonicalWeakFormAudio');
ReadAloudModeMock.prototype.getCanonicalWeakFormCarrierPhrase = extractMethod(ramSource, 'getCanonicalWeakFormCarrierPhrase');
ReadAloudModeMock.prototype._buildSpokenModelFallbackControl = extractMethod(ramSource, '_buildSpokenModelFallbackControl');
ReadAloudModeMock.prototype.getSpeechCoachGuideEvent = () => null;
ReadAloudModeMock.prototype.getSpeechCoachAudioEntry = () => null;
ReadAloudModeMock.prototype.buildGuidePopoverListenControl = extractMethod(ramSource, 'buildGuidePopoverListenControl');
ReadAloudModeMock.prototype.stopSpeechCoachModelAudio = extractMethod(ramSource, 'stopSpeechCoachModelAudio');
ReadAloudModeMock.prototype.stopSpeechCoachYoursAudio = () => {};
ReadAloudModeMock.prototype.stopReferenceAudioPlayback = () => {};
ReadAloudModeMock.prototype.playSpeechCoachModelAudio = extractMethod(ramSource, 'playSpeechCoachModelAudio');

const EXPECTED_CANONICAL_KEYS = [
  'to', 'the-consonant', 'the-vowel', 'a', 'an', 'of',
  'and', 'for', 'can', 'have', 'has', 'was', 'were', 'from'
];

test('Canonical audio bank: all 14 MP3 files exist and are non-empty', () => {
  for (const key of EXPECTED_CANONICAL_KEYS) {
    const mp3Path = path.join(CANONICAL_DIR, `${key}.mp3`);
    assert.ok(fs.existsSync(mp3Path), `Missing canonical weak form audio file: ${key}.mp3`);
    const stat = fs.statSync(mp3Path);
    assert.ok(stat.size >= 10000, `Audio file ${key}.mp3 is suspiciously small (${stat.size} bytes)`);

    const header = Buffer.alloc(10);
    const fd = fs.openSync(mp3Path, 'r');
    fs.readSync(fd, header, 0, 10, 0);
    fs.closeSync(fd);

    const isId3 = header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33;
    const isMpegSync = header[0] === 0xFF && (header[1] & 0xE0) === 0xE0;
    assert.ok(isId3 || isMpegSync, `File ${key}.mp3 does not have a valid ID3 tag or MPEG sync header`);
  }
});

test('Canonical audio bank: manifest.json is valid and covers all 14 items', () => {
  const manifestPath = path.join(CANONICAL_DIR, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json does not exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.voice, 'af_heart');
  assert.equal(manifest.format, 'mp3');
  assert.equal(manifest.sampleRate, 24000);

  for (const key of EXPECTED_CANONICAL_KEYS) {
    const item = manifest.items[key];
    assert.ok(item, `Manifest missing item ${key}`);
    assert.equal(item.key, key);
    assert.ok(item.phrase, `Item ${key} missing phrase`);
    assert.ok(item.targetIpa, `Item ${key} missing targetIpa`);
    assert.ok(item.file.endsWith(`${key}.mp3`), `Item ${key} file path mismatch: ${item.file}`);
    assert.ok(item.sizeBytes > 0, `Item ${key} sizeBytes must be > 0`);
  }
});

test('Dynamic copy: getCategoryLeadLabel returns category-appropriate labels', () => {
  assert.equal(ReadAloudLinking.getCategoryLeadLabel('linking'), 'Technique');
  assert.equal(ReadAloudLinking.getCategoryLeadLabel('v1_linking'), 'Technique');
  assert.equal(ReadAloudLinking.getCategoryLeadLabel('catenation'), 'Technique');
  assert.equal(ReadAloudLinking.getCategoryLeadLabel('reduced_words'), 'Weak form');
  assert.equal(ReadAloudLinking.getCategoryLeadLabel('v2_reduced_words'), 'Weak form');
  assert.equal(ReadAloudLinking.getCategoryLeadLabel('weak_forms'), 'Weak form');
  assert.equal(ReadAloudLinking.getCategoryLeadLabel('sound_changes'), 'Sounds like');
  assert.equal(ReadAloudLinking.getCategoryLeadLabel('v3_sound_changes'), 'Sounds like');
  assert.equal(ReadAloudLinking.getCategoryLeadLabel('n_bilabial_assimilation'), 'Sounds like');
  assert.equal(ReadAloudLinking.getCategoryLeadLabel(''), 'Technique');
});

test('Dynamic copy: SOUND_CHANGE_GUIDE_COPY entries have clean, non-stuttering sayItLike', () => {
  const subtypes = ['coalescent_dj', 'coalescent_tj', 'coalescent_sj', 'coalescent_zj', 'n_bilabial_assimilation', 'yod_coalescence'];
  for (const sub of subtypes) {
    const copy = ReadAloudLinking.getSoundChangeCopy(sub);
    assert.ok(copy && copy.sayItLike);
    assert.ok(!copy.sayItLike.startsWith('like '), `Subtype ${sub} sayItLike starts with stuttering 'like ': "${copy.sayItLike}"`);
  }
  assert.equal(ReadAloudLinking.getSoundChangeCopy('coalescent_dj').sayItLike, 'a j');
  assert.equal(ReadAloudLinking.getSoundChangeCopy('coalescent_tj').sayItLike, 'a ch');
  assert.equal(ReadAloudLinking.getSoundChangeCopy('coalescent_sj').sayItLike, 'a sh');
  assert.equal(ReadAloudLinking.getSoundChangeCopy('coalescent_zj').sayItLike, 'a zh (the s in "measure")');
  assert.equal(ReadAloudLinking.getSoundChangeCopy('n_bilabial_assimilation').sayItLike, 'an m');
  assert.equal(ReadAloudLinking.getSoundChangeCopy('yod_coalescence').sayItLike, 'blended, as a j');
});

test('ReadAloudMode: resolveCanonicalWeakFormAudio maps all 14 canonical items', () => {
  const ram = new ReadAloudModeMock();

  for (const key of EXPECTED_CANONICAL_KEYS) {
    const res = ram.resolveCanonicalWeakFormAudio({ subtype: key, category: 'reduced_words' });
    assert.ok(res, `Failed to resolve canonical audio for key: ${key}`);
    assert.equal(res.key, key);
    assert.equal(res.file, `/database/RA/weak-forms/canonical/${key}.mp3`);
    assert.ok(res.phrase);
    assert.ok(res.ipa);
  }
});

test('ReadAloudMode: resolveCanonicalWeakFormAudio handles punctuation and capitalization', () => {
  const ram = new ReadAloudModeMock();

  const toWithPunct = ram.resolveCanonicalWeakFormAudio({ label: 'To,' });
  assert.ok(toWithPunct);
  assert.equal(toWithPunct.key, 'to');
  assert.equal(toWithPunct.file, '/database/RA/weak-forms/canonical/to.mp3');

  const haveWithDot = ram.resolveCanonicalWeakFormAudio({ word: 'have.' });
  assert.ok(haveWithDot);
  assert.equal(haveWithDot.key, 'have');

  const canWithExcl = ram.resolveCanonicalWeakFormAudio({ label: 'CAN!' });
  assert.ok(canWithExcl);
  assert.equal(canWithExcl.key, 'can');
});

test('ReadAloudMode: resolveCanonicalWeakFormAudio differentiates "the" before vowels vs consonants', () => {
  const ram = new ReadAloudModeMock();

  const theCons = ram.resolveCanonicalWeakFormAudio({ label: 'the', targetIpa: '/ðə/' });
  assert.ok(theCons);
  assert.equal(theCons.key, 'the-consonant');
  assert.equal(theCons.file, '/database/RA/weak-forms/canonical/the-consonant.mp3');

  const theVowel = ram.resolveCanonicalWeakFormAudio({ label: 'the', targetIpa: '/ði/' });
  assert.ok(theVowel);
  assert.equal(theVowel.key, 'the-vowel');
  assert.equal(theVowel.file, '/database/RA/weak-forms/canonical/the-vowel.mp3');

  const theNextSoundVowel = ram.resolveCanonicalWeakFormAudio({ label: 'the', condition: { nextSound: 'vowel' } });
  assert.ok(theNextSoundVowel);
  assert.equal(theNextSoundVowel.key, 'the-vowel');
});

test('ReadAloudMode: getCanonicalWeakFormCarrierPhrase resolves carrier phrases with punctuation tolerance', () => {
  const ram = new ReadAloudModeMock();

  assert.equal(ram.getCanonicalWeakFormCarrierPhrase('to'), 'to go');
  assert.equal(ram.getCanonicalWeakFormCarrierPhrase('to,'), 'to go');
  assert.equal(ram.getCanonicalWeakFormCarrierPhrase('and'), 'bread and butter');
  assert.equal(ram.getCanonicalWeakFormCarrierPhrase('AND.'), 'bread and butter');
  assert.equal(ram.getCanonicalWeakFormCarrierPhrase('from'), 'away from home');
  assert.equal(ram.getCanonicalWeakFormCarrierPhrase({ word: 'can' }), 'you can go');
  assert.equal(ram.getCanonicalWeakFormCarrierPhrase('unknown-word'), null);
});

test('ReadAloudMode: _buildSpokenModelFallbackControl builds canonical button for reduced words', () => {
  const ram = new ReadAloudModeMock();
  const html = ram._buildSpokenModelFallbackControl({ category: 'reduced_words', word: 'to' });
  assert.ok(html.includes('sc-model-play-btn'));
  assert.ok(html.includes('data-model-src="/database/RA/weak-forms/canonical/to.mp3"'));
  assert.ok(html.includes('Listen'));
  assert.ok(html.includes('data-initial-label="Listen"'));
});

test('ReadAloudMode: buildGuidePopoverListenControl builds canonical button for reduced words', () => {
  const ram = new ReadAloudModeMock();
  const html = ram.buildGuidePopoverListenControl({ category: 'reduced_words', word: 'can' });
  assert.ok(html.includes('sc-model-play-btn'));
  assert.ok(html.includes('data-model-src="/database/RA/weak-forms/canonical/can.mp3"'));
  assert.ok(html.includes('Listen'));
  assert.ok(html.includes('data-initial-label="Listen"'));
});

test('ReadAloudMode: button label is preserved as Listen across play and stop lifecycle', async () => {
  const ram = new ReadAloudModeMock();

  // Create a mock button matching what buildGuidePopoverListenControl produces
  const labelSpan = { textContent: 'Listen', remove() {} };
  const iconSpan = { textContent: '▶', setAttribute() {}, getAttribute() { return 'true'; } };
  iconSpan['aria-hidden'] = 'true';

  const dataset = {
    modelSrc: '/database/RA/weak-forms/canonical/to.mp3',
    initialLabel: 'Listen',
    initialAriaLabel: 'Listen'
  };
  const attributes = {
    'aria-label': 'Listen'
  };

  const button = {
    dataset,
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); }
    },
    getAttribute(name) { return attributes[name] || null; },
    setAttribute(name, val) { attributes[name] = val; },
    querySelector(sel) {
      if (sel.includes(':not([aria-hidden])')) return labelSpan;
      if (sel === 'span') return iconSpan;
      return null;
    }
  };

  // Start playback
  ram.playSpeechCoachModelAudio(button);
  assert.equal(attributes['aria-label'], 'Loading model audio');

  // Allow promise to resolve
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(labelSpan.textContent, 'Stop');
  assert.equal(iconSpan.textContent, '▶'); // icon preserved!
  assert.equal(attributes['aria-label'], 'Stop model audio');

  // Stop playback
  ram.stopSpeechCoachModelAudio();

  assert.equal(labelSpan.textContent, 'Listen', 'Button label should be restored to Listen, NOT Model');
  assert.equal(attributes['aria-label'], 'Listen', 'Aria-label should be restored to initial aria-label');
  assert.equal(button.classList.contains('is-playing'), false);
});
