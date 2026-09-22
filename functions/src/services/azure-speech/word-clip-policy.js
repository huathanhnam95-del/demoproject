'use strict';

/**
 * Word Clip Policy
 * Resolves safe, ending-preserving playback intervals for individual words.
 * Eliminates stacked heuristic trims and score-dependent shortening.
 * Supports ENTRANCE_EXACT_CLIP_POLICY rollout flag: 'legacy' | 'shadow' | 'active'.
 */

function resolveWordClipTiming(rawWord, nextWord, audioIdentity = null, options = {}) {
  if (!rawWord || typeof rawWord !== 'object') {
    return null;
  }

  const policy = String(options.clipPolicy || process.env.ENTRANCE_EXACT_CLIP_POLICY || 'active').toLowerCase();

  const startMs = rawWord.startMs ?? rawWord.rawStartMs ?? null;
  const endMs = rawWord.endMs ?? rawWord.rawEndMs ?? null;

  if (startMs === null || endMs === null || endMs <= startMs) {
    return {
      occurrenceId: rawWord.occurrenceId || `w-${rawWord.word}`,
      word: rawWord.word,
      wordSpan: null,
      clipSpan: null,
      contextSpan: null,
      isolationStatus: rawWord.errorType === 'Omission' ? 'unavailable' : 'unavailable',
      timingSource: 'azure_provider_estimate',
      policy,
      reasonCodes: [rawWord.errorType === 'Omission' ? 'WORD_OMITTED' : 'TIMING_INVALID']
    };
  }

  const sampleRate = audioIdentity?.sampleRateHz || 16000;
  const sampleCount = audioIdentity?.sampleCount || Number.MAX_SAFE_INTEGER;

  const startSample = Math.max(0, Math.round(startMs * sampleRate / 1000));
  const endSample = Math.min(sampleCount, Math.round(endMs * sampleRate / 1000));
  const wordSpan = { startSample, endSample };

  // Check next word gap to determine if acoustic boundary is ambiguous
  const nextStartMs = nextWord?.startMs ?? nextWord?.rawStartMs ?? null;
  let isolationStatus = 'accepted';
  const reasonCodes = [];
  let contextSpan = null;

  if (nextStartMs !== null && nextStartMs >= startMs) {
    const gapMs = nextStartMs - endMs;
    // When words abut or overlap tightly (gap < 10ms or negative), boundary is coarticulated
    if (gapMs < 10) {
      isolationStatus = 'uncertain';
      reasonCodes.push('ABUTTING_OR_OVERLAPPING_NEXT_WORD');
      const nextEndMs = nextWord?.endMs ?? nextWord?.rawEndMs ?? (nextStartMs + 500);
      const nextEndSample = Math.min(sampleCount, Math.round(nextEndMs * sampleRate / 1000));
      contextSpan = { startSample, endSample: nextEndSample };
    }
  }

  // Legacy trimmed boundary calculation (35ms trimmed compensation)
  const legacyTrimSamples = Math.round(35 * sampleRate / 1000);
  const legacyEndSample = Math.max(startSample, endSample - legacyTrimSamples);
  const legacyClipSpan = { startSample, endSample: legacyEndSample };

  let finalClipSpan = wordSpan;
  let boundaryConvention = 'ending_preserving_v1';

  if (policy === 'legacy') {
    finalClipSpan = legacyClipSpan;
    boundaryConvention = 'legacy_trimmed';
  }

  const result = {
    occurrenceId: rawWord.occurrenceId || `w-${rawWord.word}`,
    word: rawWord.word,
    wordSpan,
    clipSpan: finalClipSpan,
    contextSpan,
    timingSource: 'bel_refined',
    isolationStatus,
    boundaryConvention,
    policy,
    reasonCodes
  };

  if (policy === 'shadow') {
    result.legacyClipSpan = legacyClipSpan;
  }

  return result;
}

module.exports = {
  resolveWordClipTiming
};
