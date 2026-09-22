'use strict';

const own = (obj, key) => obj != null &&
  Object.prototype.hasOwnProperty.call(obj, key);

function finiteNumberOrNull(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function readAssessmentField(node, key) {
  if (!node || typeof node !== 'object') return undefined;
  const nested = node.PronunciationAssessment;
  if (nested && typeof nested === 'object' && own(nested, key)) return nested[key];
  return own(node, key) ? node[key] : undefined;
}

function readScore(node, key = 'AccuracyScore') {
  const value = finiteNumberOrNull(readAssessmentField(node, key));
  return value !== null && value >= 0 && value <= 100 ? value : null;
}

function normalizePhoneme(node) {
  const rawCandidates = readAssessmentField(node, 'NBestPhonemes');
  const candidates = Array.isArray(rawCandidates) ? rawCandidates : [];
  return {
    expectedIpaRaw: typeof node?.Phoneme === 'string' ? node.Phoneme : '',
    accuracyScore: readScore(node),
    candidates: candidates.map(candidate => ({
      ipaRaw: typeof candidate?.Phoneme === 'string' ? candidate.Phoneme : '',
      score: finiteNumberOrNull(candidate?.Score)
    })).filter(candidate => candidate.ipaRaw !== '')
  };
}

function ticksToCanonicalSpan(node, audio, originSample = 0) {
  const offset = finiteNumberOrNull(node?.Offset);
  const duration = finiteNumberOrNull(node?.Duration);
  if (offset === null || duration === null || offset < 0 || duration <= 0) return null;
  if (!audio) return null;
  if (!Number.isInteger(audio.sampleRateHz) || audio.sampleRateHz <= 0 ||
      !Number.isInteger(audio.sampleCount) || audio.sampleCount <= 0 ||
      !Number.isInteger(originSample) || originSample < 0) {
    return null;
  }
  const startSample = originSample + Math.round(offset * audio.sampleRateHz / 1e7);
  const endSample = originSample + Math.round((offset + duration) * audio.sampleRateHz / 1e7);
  if (!Number.isSafeInteger(startSample) || !Number.isSafeInteger(endSample) ||
      startSample < 0 || endSample <= startSample || endSample > audio.sampleCount) return null;
  return { startSample, endSample };
}

function normalizeWord(rawWord, index, audio) {
  const wordText = String(rawWord?.Word || '').trim();
  const errorType = String(readAssessmentField(rawWord, 'ErrorType') || 'None');
  const isOmission = errorType === 'Omission';

  const rawSpan = (isOmission || !audio) ? null : ticksToCanonicalSpan(rawWord, audio);
  const offsetTicks = finiteNumberOrNull(rawWord?.Offset);
  const durationTicks = finiteNumberOrNull(rawWord?.Duration);

  const rawSyllables = Array.isArray(rawWord?.Syllables) ? rawWord.Syllables : [];
  const syllables = rawSyllables.map((syl, sIdx) => {
    const sylGrapheme = String(syl?.Syllable || '').trim();
    const sylScore = readScore(syl);
    const sylSpan = (isOmission || !audio) ? null : ticksToCanonicalSpan(syl, audio);
    const rawPhones = Array.isArray(syl?.Phonemes) ? syl.Phonemes : [];
    const phones = rawPhones.map(normalizePhoneme);

    return {
      syllableIndex: sIdx,
      syllable: sylGrapheme,
      accuracyScore: sylScore,
      span: sylSpan,
      phonemes: phones
    };
  });

  const rawPhones = Array.isArray(rawWord?.Phonemes) ? rawWord.Phonemes : [];
  const phonemes = rawPhones.map(normalizePhoneme);

  return {
    occurrenceId: `w-${index}`,
    word: wordText,
    errorType,
    accuracyScore: readScore(rawWord),
    rawOffsetTicks: offsetTicks,
    rawDurationTicks: durationTicks,
    rawStartMs: offsetTicks !== null ? Math.round(offsetTicks / 10000) : null,
    rawEndMs: (offsetTicks !== null && durationTicks !== null) ? Math.round((offsetTicks + durationTicks) / 10000) : null,
    rawProviderSpan: rawSpan,
    clipSpan: rawSpan,
    syllables,
    phonemes
  };
}

function normalizeFinalResult({ rawResult, audio, mode, assessmentId, reference }) {
  const nBest = rawResult?.NBest?.[0] || rawResult;
  const rawWords = Array.isArray(nBest?.Words) ? nBest.Words : [];

  const words = rawWords
    .filter(w => typeof w?.Word === 'string' && w.Word.trim().length > 0)
    .map((w, idx) => normalizeWord(w, idx, audio));

  const pronunciationAccuracy = readScore(nBest, 'AccuracyScore');
  const fluency = readScore(nBest, 'FluencyScore');
  const prosody = readScore(nBest, 'ProsodyScore');
  const completeness = readScore(nBest, 'CompletenessScore');

  return {
    schemaVersion: 'practice-pronunciation-v2',
    assessmentId: assessmentId || `asmt-${Date.now()}`,
    mode: mode || 'read_aloud',
    status: words.length > 0 ? 'ready' : 'unavailable',
    audio: audio || null,
    reference: reference || null,
    scores: {
      pronunciationAccuracy,
      fluency,
      prosody,
      completeness
    },
    words,
    coverage: {
      scoredWordCount: words.filter(w => w.accuracyScore !== null).length,
      uncertainWordCount: words.filter(w => w.accuracyScore === null).length
    }
  };
}

module.exports = {
  finiteNumberOrNull,
  readAssessmentField,
  readScore,
  normalizePhoneme,
  ticksToCanonicalSpan,
  normalizeWord,
  normalizeFinalResult
};
