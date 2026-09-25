'use strict';

/**
 * BEL Staged Release & Rollout Flags (§15, §16 of BEL Final Implementation Plan v3)
 * Centralizes runtime feature flag parsing, server-side validation, and public capability exposition.
 */

const DEFAULT_ROLLOUT_FLAGS = Object.freeze({
  aiScoringQuotes: 'active', // 'off' | 'shadow' | 'active'
  speechV3Modes: Object.freeze([]),
  entranceSpeechV3: false,
  aiCreditRateCardVersion: '2026.09.v1',
  aiCreditMonthlyGrant: 5000,
  aiCreditDailyCapEnabled: false,
  entranceExactClipPolicy: 'active', // 'legacy' | 'shadow' | 'active'
  practicePronunciationV2Modes: Object.freeze(['read_aloud', 'repeat_sentence']),
  practiceTranscriptConditionedModes: Object.freeze([]),
  pronounceTimingV42: 'active', // 'off' | 'shadow' | 'active'
  pronounceStressV2: 'active', // 'off' | 'shadow' | 'active'
  rlSpokenAssessment: false
});

const VALID_THREE_STATE_FLAGS = new Set(['off', 'shadow', 'active']);
const VALID_CLIP_POLICIES = new Set(['legacy', 'shadow', 'active']);

function parseList(raw, fallback = []) {
  if (raw === undefined || raw === null) {
    return fallback;
  }
  if (Array.isArray(raw)) {
    return raw.map(s => String(s).trim().toLowerCase()).filter(Boolean);
  }
  const str = String(raw).trim();
  if (!str) return [];
  return str.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function parseThreeState(val, fallback) {
  if (!val) return fallback;
  const clean = String(val).trim().toLowerCase();
  return VALID_THREE_STATE_FLAGS.has(clean) ? clean : fallback;
}

function parseClipPolicy(val, fallback) {
  if (!val) return fallback;
  const clean = String(val).trim().toLowerCase();
  return VALID_CLIP_POLICIES.has(clean) ? clean : fallback;
}

function parseBoolean(val, fallback = false) {
  if (val === undefined || val === null) return fallback;
  return String(val).trim().toLowerCase() === 'true';
}

function parseInteger(val, fallback = 1000) {
  if (val === undefined || val === null) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Resolves rollout flags from environment dictionary.
 * @param {Object} env process.env or configuration dictionary
 * @returns {Object} Immutable rollout flags object
 */
function parseRolloutFlags(env = {}) {
  const aiScoringQuotes = parseThreeState(env.AI_SCORING_QUOTES, DEFAULT_ROLLOUT_FLAGS.aiScoringQuotes);
  const aiCreditRateCardVersion = String(env.AI_CREDIT_RATE_CARD_VERSION || DEFAULT_ROLLOUT_FLAGS.aiCreditRateCardVersion).trim();
  const rawGrant = env.AI_CREDIT_INITIAL_GRANT ?? env.AI_CREDIT_MONTHLY_GRANT;
  const aiCreditMonthlyGrant = parseInteger(rawGrant, DEFAULT_ROLLOUT_FLAGS.aiCreditMonthlyGrant);
  const aiCreditDailyCapEnabled = parseBoolean(env.AI_CREDIT_DAILY_CAP_ENABLED, DEFAULT_ROLLOUT_FLAGS.aiCreditDailyCapEnabled);
  const entranceExactClipPolicy = parseClipPolicy(env.ENTRANCE_EXACT_CLIP_POLICY, DEFAULT_ROLLOUT_FLAGS.entranceExactClipPolicy);

  const practicePronunciationV2Modes = Object.freeze(
    parseList(env.PRACTICE_PRONUNCIATION_V2_MODES, DEFAULT_ROLLOUT_FLAGS.practicePronunciationV2Modes)
  );

  const practiceTranscriptConditionedModes = Object.freeze(
    parseList(env.PRACTICE_TRANSCRIPT_CONDITIONED_MODES, DEFAULT_ROLLOUT_FLAGS.practiceTranscriptConditionedModes)
  );

  const pronounceTimingV42 = parseThreeState(env.PRONOUNCE_TIMING_V42, DEFAULT_ROLLOUT_FLAGS.pronounceTimingV42);
  const pronounceStressV2 = parseThreeState(env.PRONOUNCE_STRESS_V2, DEFAULT_ROLLOUT_FLAGS.pronounceStressV2);
  const rlSpokenAssessment = parseBoolean(env.RL_SPOKEN_ASSESSMENT, DEFAULT_ROLLOUT_FLAGS.rlSpokenAssessment);
  const { normalizePracticeMode } = require('../practice-attempts/attempt-constraints');
  const speechV3Modes = Object.freeze([...new Set(parseList(env.BEL_SPEECH_V3_MODES, DEFAULT_ROLLOUT_FLAGS.speechV3Modes)
    .map(normalizePracticeMode).filter(Boolean))]);
  const entranceSpeechV3 = parseBoolean(env.BEL_ENTRANCE_SPEECH_V3, DEFAULT_ROLLOUT_FLAGS.entranceSpeechV3);

  return Object.freeze({
    aiScoringQuotes,
    speechV3Modes,
    entranceSpeechV3,
    aiCreditRateCardVersion,
    aiCreditMonthlyGrant,
    aiCreditDailyCapEnabled,
    entranceExactClipPolicy,
    practicePronunciationV2Modes,
    practiceTranscriptConditionedModes,
    pronounceTimingV42,
    pronounceStressV2,
    rlSpokenAssessment
  });
}

function isAiScoringQuotesEnabled(flags) {
  return (flags?.aiScoringQuotes || DEFAULT_ROLLOUT_FLAGS.aiScoringQuotes) !== 'off';
}

function isAiScoringQuotesActive(flags) {
  return (flags?.aiScoringQuotes || DEFAULT_ROLLOUT_FLAGS.aiScoringQuotes) === 'active';
}

function isAiScoringQuotesShadow(flags) {
  return (flags?.aiScoringQuotes || DEFAULT_ROLLOUT_FLAGS.aiScoringQuotes) === 'shadow';
}

function isModeEnabledForPronunciationV2(mode, flags) {
  const modes = flags?.practicePronunciationV2Modes || DEFAULT_ROLLOUT_FLAGS.practicePronunciationV2Modes;
  return modes.includes(String(mode || '').toLowerCase());
}

function isModeEnabledForTranscriptConditioning(mode, flags) {
  const modes = flags?.practiceTranscriptConditionedModes || DEFAULT_ROLLOUT_FLAGS.practiceTranscriptConditionedModes;
  const cleanMode = String(mode || '').toLowerCase();
  // Support aliases
  if (cleanMode === 'respond_to_situation') {
    return modes.includes('respond_to_situation') || modes.includes('respond_to_a_situation');
  }
  if (cleanMode === 'respond_to_a_situation') {
    return modes.includes('respond_to_situation') || modes.includes('respond_to_a_situation');
  }
  return modes.includes(cleanMode);
}

function isRlSpokenAssessmentEnabled(flags) {
  return (flags?.rlSpokenAssessment ?? DEFAULT_ROLLOUT_FLAGS.rlSpokenAssessment) === true;
}

function isSpeechV3Enabled(mode, flags) {
  const { normalizePracticeMode } = require('../practice-attempts/attempt-constraints');
  const canonical = normalizePracticeMode(mode);
  return Boolean(canonical && flags?.speechV3Modes?.includes(canonical));
}

/**
 * Returns public-safe client capabilities payload for /api/config.
 */
function getPublicFeatureFlags(flags) {
  return Object.freeze({
    aiScoringQuotes: flags.aiScoringQuotes,
    speechV3Modes: Array.from(flags.speechV3Modes),
    entranceSpeechV3: flags.entranceSpeechV3,
    aiCreditRateCardVersion: flags.aiCreditRateCardVersion,
    entranceExactClipPolicy: flags.entranceExactClipPolicy,
    practicePronunciationV2Modes: Array.from(flags.practicePronunciationV2Modes),
    practiceTranscriptConditionedModes: Array.from(flags.practiceTranscriptConditionedModes),
    pronounceTimingV42: flags.pronounceTimingV42,
    pronounceStressV2: flags.pronounceStressV2,
    rlSpokenAssessment: flags.rlSpokenAssessment
  });
}

module.exports = {
  DEFAULT_ROLLOUT_FLAGS,
  parseRolloutFlags,
  isAiScoringQuotesEnabled,
  isAiScoringQuotesActive,
  isAiScoringQuotesShadow,
  isSpeechV3Enabled,
  isModeEnabledForPronunciationV2,
  isModeEnabledForTranscriptConditioning,
  isRlSpokenAssessmentEnabled,
  getPublicFeatureFlags
};
