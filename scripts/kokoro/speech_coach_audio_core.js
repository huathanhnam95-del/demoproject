/* eslint-disable no-console */
const crypto = require('crypto');

const HARD_BOUNDARY = /[.,!?;:\n]/;

function normalizeIpa(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '').trim();
}

function resolveWeakTargetIpa({ targetWord, nextPhonemeWord, fallbackIpa }) {
  if (String(targetWord || '').trim().toLowerCase() !== 'the') return fallbackIpa || null;
  const nextSound = String(nextPhonemeWord || '').replace(/^[\s\u02c8\u02cc.]+/, '').charAt(0);
  return /^[i\u026ae\u025b\u00e6\u0251\u0252\u0254o\u028au\u028c\u0259\u025c\u025a\u025da]$/.test(nextSound)
    ? '/\u00f0i/'
    : '/\u00f0\u0259/';
}

function getWordMatches(text) {
  const source = String(text || '');
  return Array.from(source.matchAll(/[A-Za-z0-9']+/g)).map((match, wordIndex) => ({
    wordIndex,
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
    clause: 0
  }));
}

function getWeakContext(text, targetWordIndex, windowSize = 3) {
  const source = String(text || '');
  const words = getWordMatches(source);
  const target = words.find((word) => word.wordIndex === Number(targetWordIndex));
  if (!target) return null;

  let clause = 0;
  words.forEach((word, index) => {
    if (index === 0) return;
    const between = source.slice(words[index - 1].end, word.start);
    if (HARD_BOUNDARY.test(between)) clause += 1;
    word.clause = clause;
  });

  const clauseWords = words.filter((word) => word.clause === target.clause);
  const targetClauseIndex = clauseWords.findIndex((word) => word.wordIndex === target.wordIndex);
  const size = Math.max(1, Number(windowSize) || 3);
  let start = Math.max(0, targetClauseIndex - Math.floor(size / 2));
  let end = Math.min(clauseWords.length, start + size);
  if (end - start < size) start = Math.max(0, end - size);
  const selected = clauseWords.slice(start, end);
  return {
    text: selected.map((word) => word.text).join(' '),
    targetOffset: selected.findIndex((word) => word.wordIndex === target.wordIndex),
    wordCount: selected.length
  };
}

function buildEventContext(referenceText, event, weakWindowSize = 3) {
  if (String(event?.family || '') === 'weak_form_reduction') {
    const context = getWeakContext(referenceText, event.startWordIndex, weakWindowSize);
    if (!context) return null;
    return {
      text: context.text,
      targetOffset: context.targetOffset,
      targetWordIndex: Number(event.startWordIndex)
    };
  }
  return {
    text: String(event?.phrase || '').trim(),
    targetOffset: 0,
    targetWordIndex: Number(event?.startWordIndex)
  };
}

function removeLeadingBoundaryDuplicate(left, right) {
  const finalChar = left.slice(-1);
  return finalChar && right.startsWith(finalChar) ? right.slice(finalChar.length) : right;
}

function transformPhonemeWords({ family, phonemeWords, targetIndex = 0, targetIpa = null }) {
  const words = Array.isArray(phonemeWords) ? phonemeWords.map((word) => String(word || '')) : [];
  const index = Number(targetIndex);
  if (!Number.isInteger(index) || index < 0 || index >= words.length) return words;

  if (family === 'weak_form_reduction') {
    words[index] = normalizeIpa(targetIpa);
    return words;
  }

  if (family === 'n_bilabial_assimilation') {
    words[index] = words[index].replace(/n$/, 'm');
    return words;
  }

  if (family === 'same_consonant_merge' && index + 1 < words.length) {
    words[index + 1] = removeLeadingBoundaryDuplicate(words[index], words[index + 1]);
    return words;
  }

  if (family === 'yod_coalescence' && index + 1 < words.length) {
    const left = words[index];
    const right = words[index + 1];
    const final = left.slice(-1);
    const coalesced = {
      d: 'd\u0292',
      t: 't\u0283',
      s: '\u0283',
      z: '\u0292'
    }[final];
    if (coalesced && /^j/.test(right)) {
      words[index] = `${left.slice(0, -1)}${coalesced}`;
      words[index + 1] = right.slice(1);
    }
  }
  return words;
}

function validatePhonemeTransformation({ family, baselineWords, transformedWords, targetIndex = 0, targetIpa = null }) {
  const baseline = Array.isArray(baselineWords) ? baselineWords.map(String) : [];
  const transformed = Array.isArray(transformedWords) ? transformedWords.map(String) : [];
  if (!baseline.length || baseline.length !== transformed.length) return { ok: false, reason: 'phoneme_word_count_mismatch' };
  if (family === 'weak_form_reduction' && !normalizeIpa(targetIpa)) return { ok: false, reason: 'target_ipa_missing' };
  const requiresChangedTarget = new Set(['n_bilabial_assimilation', 'same_consonant_merge', 'yod_coalescence']);
  if (requiresChangedTarget.has(String(family || ''))
    && baseline.every((word, index) => word === transformed[index])) {
    return { ok: false, reason: 'target_unchanged' };
  }
  const expected = transformPhonemeWords({ family, phonemeWords: baseline, targetIndex, targetIpa });
  if (expected.some((word, index) => word !== transformed[index])) return { ok: false, reason: 'unexpected_phoneme_change' };
  return { ok: true };
}

function buildControlledPhonemes({ family, phonemeWords }) {
  const words = Array.isArray(phonemeWords) ? phonemeWords : [];
  const boundaryFamily = new Set([
    'catenation',
    'same_consonant_merge',
    'n_bilabial_assimilation',
    'yod_coalescence'
  ]);
  return words.join(boundaryFamily.has(String(family || '')) ? '' : ' ').trim();
}

function buildAssetId({
  version,
  voice,
  speed,
  family,
  spokenText,
  targetOffset,
  phonemes
}) {
  const material = [version, voice, speed, family, spokenText, targetOffset, phonemes]
    .map((value) => String(value ?? ''))
    .join('\u001f');
  return crypto.createHash('sha256').update(material, 'utf8').digest('hex');
}

function parseWavHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('invalid WAV container');
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= buffer.length) {
      fmt = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14)
      };
    }
    if (id === 'data') data = { offset: body, size };
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV is missing fmt or data chunk');
  if (fmt.audioFormat !== 1 || fmt.channels !== 1 || fmt.sampleRate !== 24000 || fmt.bitsPerSample !== 16) {
    throw new Error(`unexpected WAV format: ${JSON.stringify(fmt)}`);
  }
  const availableBytes = Math.max(0, buffer.length - data.offset);
  const shortfall = data.size - availableBytes;
  if (shortfall > 2) throw new Error(`WAV data chunk exceeds buffer by ${shortfall} bytes`);
  const sampleCount = Math.floor(Math.min(data.size, availableBytes) / 2);
  let sumSquares = 0;
  let clippedSamples = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = buffer.readInt16LE(data.offset + i * 2) / 32768;
    sumSquares += sample * sample;
    if (Math.abs(sample) >= 0.999) clippedSamples += 1;
  }
  const rms = sampleCount ? Math.sqrt(sumSquares / sampleCount) : 0;
  if (!Number.isFinite(rms) || rms < 0.001) throw new Error('audio is silent');
  if (clippedSamples > sampleCount * 0.01) throw new Error('audio has sustained clipping');
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, durationMs: Math.round(sampleCount / fmt.sampleRate * 1000), rms, clippedSamples };
}

function normalizeWavBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('invalid WAV container');
  }
  const normalized = Buffer.from(buffer);
  let offset = 12;
  let dataBody = null;
  while (offset + 8 <= normalized.length) {
    const id = normalized.toString('ascii', offset, offset + 4);
    const size = normalized.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'data') {
      dataBody = body;
      break;
    }
    if (size === 0xffffffff) break;
    offset = body + size + (size % 2);
  }
  if (dataBody === null || dataBody > normalized.length) throw new Error('WAV is missing data chunk');
  normalized.writeUInt32LE(Math.min(normalized.length - 8, 0xffffffff), 4);
  normalized.writeUInt32LE(Math.min(normalized.length - dataBody, 0xffffffff), dataBody - 4);
  return normalized;
}

function validateManifestEntry({ event, asset, fileExists }) {
  if (!event || event.status === 'failed') return { ok: false, reason: 'event_failed' };
  if (event.status !== 'ready') return { ok: false, reason: 'event_not_ready' };
  if (!event.assetId) return { ok: false, reason: 'asset_id_missing' };
  if (!asset) return { ok: false, reason: 'asset_missing' };
  if (asset.status !== 'ready') return { ok: false, reason: 'asset_not_ready' };
  if (String(asset.assetId) !== String(event.assetId)) return { ok: false, reason: 'asset_id_mismatch' };
  if (!asset.file || !event.file) return { ok: false, reason: 'file_url_missing' };
  if (!/^[a-f0-9]{64}$/i.test(String(event.mp3Sha256 || ''))) return { ok: false, reason: 'event_hash_missing' };
  if (!/^[a-f0-9]{64}$/i.test(String(asset.mp3Sha256 || ''))) return { ok: false, reason: 'asset_hash_missing' };
  if (String(event.mp3Sha256) !== String(asset.mp3Sha256)) return { ok: false, reason: 'hash_mismatch' };
  if (!fileExists) return { ok: false, reason: 'file_missing' };
  if (!Number.isFinite(Number(asset.durationMs)) || Number(asset.durationMs) <= 0) return { ok: false, reason: 'duration_missing' };
  return { ok: true };
}

module.exports = {
  HARD_BOUNDARY,
  normalizeIpa,
  resolveWeakTargetIpa,
  getWordMatches,
  getWeakContext,
  buildEventContext,
  transformPhonemeWords,
  validatePhonemeTransformation,
  buildControlledPhonemes,
  buildAssetId,
  parseWavHeader,
  normalizeWavBuffer,
  validateManifestEntry
};
