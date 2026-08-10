(function initReadAloudSpeechCoach(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ReadAloudSpeechCoach = api;
}(typeof window !== 'undefined' ? window : globalThis, function createReadAloudSpeechCoach() {
  'use strict';

  const SCORED_MODES = Object.freeze(['linking', 'reduced_words', 'sound_changes']);
  const MODE_LABELS = Object.freeze({
    linking: 'Linking',
    reduced_words: 'Reduced words',
    sound_changes: 'Sound changes'
  });
  const MODE_ALIASES = Object.freeze({
    linking: 'linking',
    v1_linking: 'linking',
    catenation: 'linking',
    consonant_to_vowel: 'linking',
    same_consonant_merge: 'linking',
    y_glide: 'linking',
    w_glide: 'linking',
    generic_vowel_link: 'linking',
    reduced_words: 'reduced_words',
    v2_reduced_words: 'reduced_words',
    weak_form_reduction: 'reduced_words',
    reduced_word: 'reduced_words',
    weak_forms: 'reduced_words',
    sound_changes: 'sound_changes',
    v3_sound_changes: 'sound_changes',
    yod_coalescence: 'sound_changes',
    n_bilabial_assimilation: 'sound_changes',
    coalescent_dj: 'sound_changes',
    coalescent_tj: 'sound_changes',
    coalescent_sj: 'sound_changes',
    coalescent_zj: 'sound_changes'
  });

  function normalizeMode(value) {
    return MODE_ALIASES[String(value || '').trim().toLowerCase()] || null;
  }

  function resolveSelectedModes(options = {}) {
    const hasExplicitModes = options.sessionConnectedSpeechModes instanceof Set
      || Array.isArray(options.sessionConnectedSpeechModes);
    if (hasExplicitModes) {
      const source = options.sessionConnectedSpeechModes instanceof Set
        ? [...options.sessionConnectedSpeechModes]
        : (Array.isArray(options.sessionConnectedSpeechModes) ? options.sessionConnectedSpeechModes : []);
      return Object.freeze(SCORED_MODES.filter((mode) => source.some((value) => normalizeMode(value) === mode)));
    }

    if (Object.prototype.hasOwnProperty.call(options, 'sessionConnectedSpeechLevel')) {
      const legacyMode = normalizeMode(options.sessionConnectedSpeechLevel);
      return Object.freeze(legacyMode ? [legacyMode] : []);
    }

    return Object.freeze([...SCORED_MODES]);
  }

  function classifyEvent(event) {
    if (!event || typeof event !== 'object') return null;
    const candidates = [event.family, event.subtype, event.category, event.layer];
    for (const candidate of candidates) {
      const mode = normalizeMode(candidate);
      if (mode) return mode;
    }
    return null;
  }

  function normalizeStatus(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (normalized === 'detected') return 'detected';
    if (normalized === 'not_detected' || normalized === 'missed') return 'not_detected';
    if (normalized === 'uncertain') return 'uncertain';
    return 'unknown';
  }

  function formatModeList(modes) {
    const labels = modes.map((mode) => MODE_LABELS[mode]);
    if (labels.length <= 1) return labels[0] || '';
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
  }

  function getMissingModes(selectedModes) {
    const selected = new Set((selectedModes || []).map(normalizeMode).filter(Boolean));
    return SCORED_MODES.filter((mode) => !selected.has(mode));
  }

  function getGuidance(selectedModes) {
    const selectedSet = new Set((selectedModes || []).map(normalizeMode).filter(Boolean));
    const selected = SCORED_MODES.filter((mode) => selectedSet.has(mode));
    const missing = getMissingModes(selected);
    if (selected.length === 0) {
      return {
        kind: 'detailed',
        triggerLabel: 'How to get detailed feedback',
        message: 'For detailed Speech Coach feedback next time, select Linking, Reduced words, or Sound changes before you record.'
      };
    }
    if (missing.length === 0) return null;
    return {
      kind: 'fuller',
      triggerLabel: 'How to get fuller feedback',
      message: `For fuller feedback next time, also select ${formatModeList(missing)} before you record. Speech Coach reviews only the modes you enable.`
    };
  }

  function buildHeadline(detected, attention) {
    const patternNoun = detected === 1 ? 'pattern' : 'patterns';
    if (attention === 0) return `You nailed ${detected} ${patternNoun}!`;
    const attentionVerb = attention === 1 ? 'needs' : 'need';
    return `You nailed ${detected} ${patternNoun}! ${attention} ${attentionVerb} attention.`;
  }

  function buildResultModel(options = {}) {
    const selectedModes = resolveSelectedModes(options);
    const selected = new Set(selectedModes);
    const groups = {
      linking: { detected: [], attention: [] },
      reduced_words: { detected: [], attention: [] },
      sound_changes: { detected: [], attention: [] }
    };
    const events = [];

    for (const rawEvent of Array.isArray(options.events) ? options.events : []) {
      const coachMode = classifyEvent(rawEvent);
      if (!coachMode || !selected.has(coachMode)) continue;
      const normalizedStatus = normalizeStatus(rawEvent.status);
      const event = { ...rawEvent, coachMode, status: normalizedStatus, normalizedStatus };
      events.push(event);
      groups[coachMode][normalizedStatus === 'detected' ? 'detected' : 'attention'].push(event);
    }

    const detected = events.filter((event) => event.normalizedStatus === 'detected').length;
    const attention = events.length - detected;
    const sections = {
      reducedWords: [...groups.reduced_words.detected, ...groups.reduced_words.attention],
      linkingIssues: [...groups.linking.attention],
      linkingSuccesses: [...groups.linking.detected],
      soundChanges: [...groups.sound_changes.detected, ...groups.sound_changes.attention]
    };
    return {
      selectedModes,
      missingModes: getMissingModes(selectedModes),
      guidance: getGuidance(selectedModes),
      events,
      groups,
      sections,
      counts: { detected, attention },
      headline: buildHeadline(detected, attention)
    };
  }

  return Object.freeze({
    SCORED_MODES,
    MODE_LABELS,
    normalizeMode,
    resolveSelectedModes,
    classifyEvent,
    normalizeStatus,
    getMissingModes,
    getGuidance,
    buildHeadline,
    buildResultModel
  });
}));
