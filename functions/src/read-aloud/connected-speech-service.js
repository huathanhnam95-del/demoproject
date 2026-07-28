const fs = require('fs');
const path = require('path');

const grammarModule = require('./read-aloud-prompt-grammar.js');
const linkingModule = require('./read-aloud-linking.js');

const OVERRIDES_PATH = path.join(__dirname, 'connected-speech-overrides.json');
const VERSION = 'cs-v1';
const DEFAULT_RULESET = 'linking-v1';
const SILENT_INITIAL_WORDS = new Set(['hour', 'honest', 'honor', 'honour', 'heir', 'herb']);
const SILENT_FINAL_WORDS = new Set(['climb', 'debt', 'subtle', 'thumb', 'bomb', 'lamb', 'comb']);
const BILABIAL_INITS = new Set(['b', 'p', 'm']);
const YOD_COALESCENCE_PHRASES = new Set([
  'did you',
  'would you',
  'could you',
  "don't you",
  "can't you",
  'should you',
  'have you',
  'what you',
  'got you'
]);
const REDUCED_WORDS = new Map([
  ['a', ['canonical', 'reduced_a']],
  ['an', ['canonical', 'reduced_an']],
  ['the', ['canonical', 'reduced_the']],
  ['to', ['canonical', 'reduced_to']],
  ['and', ['canonical', 'reduced_and']],
  ['of', ['canonical', 'reduced_of']],
  ['for', ['canonical', 'reduced_for']],
  ['can', ['canonical', 'reduced_can']],
  ['have', ['canonical', 'reduced_have']],
  ['has', ['canonical', 'reduced_has']],
  ['was', ['canonical', 'reduced_was']],
  ['were', ['canonical', 'reduced_were']],
  ['from', ['canonical', 'reduced_from']]
]);
const REDUCED_WORD_IPA = new Map([
  ['a', '/ə/'], ['an', '/ən/'], ['the', '/ðə/'], ['to', '/tə/'],
  ['and', '/ən/'], ['of', '/əv/'], ['for', '/fər/'], ['can', '/kən/'],
  ['have', '/həv/'], ['has', '/həz/'], ['was', '/wəz/'], ['were', '/wər/'],
  ['from', '/frəm/']
]);
const PHONEME_ALIAS_MAP = new Map([
  ['m', 'm'],
  ['ə', 'schwa'],
  ['ɐ', 'near_open_central'],
  ['ʊ', 'near_close_back'],
  ['ɪ', 'near_close_front'],
  ['ʒ', 'ezh'],
  ['ʃ', 'esh'],
  ['dʒ', 'dzh'],
  ['ʤ', 'dzh'],
  ['tʃ', 'tsh'],
  ['ʧ', 'tsh']
]);

let overridesCache = null;

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function getOverrides() {
  if (!overridesCache) {
    overridesCache = readJsonFile(OVERRIDES_PATH);
  }
  return overridesCache;
}

function normalizeWord(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9' -]+/gi, '')
    .trim()
    .toLowerCase();
}

function getPromptTokens(referenceText) {
  const rawTokens = String(referenceText || '')
    .match(/[A-Za-z0-9']+|[\r\n]+|\/|[.,!?;:()-]/g) || [];

  let wordIndex = 0;
  return rawTokens.map((raw, index) => {
    if (/^[A-Za-z0-9']+$/.test(raw)) {
      const token = {
        id: `tok-${index}`,
        type: 'word',
        raw,
        display: raw,
        normalized: normalizeWord(raw),
        wordIndex
      };
      wordIndex += 1;
      return token;
    }
    if (/^[\r\n]+$/.test(raw)) {
      return {
        id: `tok-${index}`,
        type: 'linebreak',
        raw,
        display: raw,
        normalized: raw
      };
    }
    return {
      id: `tok-${index}`,
      type: 'punct',
      raw,
      display: raw,
      normalized: raw.toLowerCase()
    };
  });
}

function getInterveningTokens(tokens, leftIndex, rightIndex) {
  const leftTokenIndex = tokens.findIndex((token) => token.id === leftIndex);
  const rightTokenIndex = tokens.findIndex((token) => token.id === rightIndex);
  if (leftTokenIndex === -1 || rightTokenIndex === -1 || rightTokenIndex <= leftTokenIndex) {
    return [];
  }
  return tokens.slice(leftTokenIndex + 1, rightTokenIndex);
}

function getPromptPairs(tokens) {
  const pairs = [];
  const wordTokens = tokens.filter((token) => token.type === 'word');
  for (let index = 0; index < wordTokens.length - 1; index += 1) {
    const left = wordTokens[index];
    const right = wordTokens[index + 1];
    const between = getInterveningTokens(tokens, left.id, right.id);
    const hardBoundary = between.some((token) => token.type !== 'word');
    pairs.push({ left, right, between, hardBoundary });
  }
  return pairs;
}

function getPromptOverride(questionId) {
  const key = String(questionId || '').trim();
  const overrides = getOverrides();
  return key ? (overrides[key] || null) : null;
}

function normalizeBoundaryPair(pair) {
  if (!pair) return null;
  const leftWordIndex = Number(pair.leftWordIndex);
  const rightWordIndex = Number(pair.rightWordIndex);
  if (!Number.isInteger(leftWordIndex) || !Number.isInteger(rightWordIndex)) return null;
  return {
    leftWordIndex,
    rightWordIndex,
    phrase: normalizeWord(pair.phrase || ''),
    eventId: String(pair.eventId || '').trim() || null
  };
}

function getFamilyThresholdOverrides(promptOverride, family) {
  const thresholds = promptOverride?.familyThresholds;
  if (!thresholds || typeof thresholds !== 'object') return {};
  const familyThresholds = thresholds[family];
  return familyThresholds && typeof familyThresholds === 'object' ? familyThresholds : {};
}

function getEventFeedbackOverride(promptOverride, eventId) {
  const overrides = promptOverride?.feedbackTemplatesByEventId;
  if (!overrides || typeof overrides !== 'object') return {};
  const feedback = overrides[eventId];
  return feedback && typeof feedback === 'object' ? feedback : {};
}

function getEventThresholdOverride(promptOverride, eventId) {
  const overrides = promptOverride?.thresholdsByEventId;
  if (!overrides || typeof overrides !== 'object') return {};
  const threshold = overrides[eventId];
  return threshold && typeof threshold === 'object' ? threshold : {};
}

function mergeDetectorConfig({ promptOverride, family, eventId, detectorConfig }) {
  return {
    ...getFamilyThresholdOverrides(promptOverride, family),
    ...getEventThresholdOverride(promptOverride, eventId),
    ...(detectorConfig || {})
  };
}

function mergeFeedbackTemplates({ promptOverride, eventId, baseTemplates }) {
  return {
    ...(baseTemplates || {}),
    ...getEventFeedbackOverride(promptOverride, eventId)
  };
}

function getDefaultFeedbackTemplates(family, phrase) {
  const label = String(phrase || '').trim();
  if (family === 'catenation') {
    return {
      detected: `Good linking in "${label}".`,
      not_detected: `Keep "${label}" closer together so it sounds like one connected phrase.`,
      uncertain: `Say "${label}" once more a little more clearly so we can judge the linking.`
    };
  }
  if (family === 'same_consonant_merge') {
    return {
      detected: `Good consonant merge in "${label}".`,
      not_detected: `Let the repeated consonant in "${label}" run together instead of restarting it.`,
      uncertain: `Say "${label}" once more clearly so we can judge the merge.`
    };
  }
  if (family === 'n_bilabial_assimilation') {
    return {
      detected: `Good assimilation in "${label}".`,
      not_detected: `Let the /n/ in "${label}" move toward /m/ before the next bilabial sound.`,
      uncertain: `Say "${label}" once more clearly so we can judge the assimilation.`
    };
  }
  if (family === 'yod_coalescence') {
    return {
      detected: `Good smoothing in "${label}".`,
      not_detected: `Blend "${label}" into one smoother boundary instead of keeping the sounds separate.`,
      uncertain: `Say "${label}" once more clearly so we can judge that boundary.`
    };
  }
  if (family === 'weak_form_reduction') {
    return {
      detected: `Good weak form in "${label}".`,
      not_detected: `Make "${label}" lighter and shorter with a weak form.`,
      uncertain: `Say "${label}" once more clearly so we can judge the weak form.`
    };
  }
  return {
    detected: `Good connected speech in "${label}".`,
    not_detected: `Smooth "${label}" into one connected phrase.`,
    uncertain: `Say "${label}" once more clearly so we can judge it reliably.`
  };
}

function isBoundaryBlocked({ promptOverride, event, leftWordIndex, rightWordIndex, phrase }) {
  const blockedBoundaries = Array.isArray(promptOverride?.blockedBoundaries) ? promptOverride.blockedBoundaries : [];
  const normalizedPhrase = normalizeWord(phrase || event?.phrase || '');
  const boundaryKey = `${leftWordIndex}:${rightWordIndex}`;

  if (Array.isArray(promptOverride?.suppressBaselineEventIds) && promptOverride.suppressBaselineEventIds.includes(event?.eventId)) {
    return true;
  }

  for (const block of blockedBoundaries) {
    if (typeof block === 'string') {
      if (normalizeWord(block) === normalizedPhrase) return true;
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    if (String(block.eventId || '').trim() && String(block.eventId) === String(event?.eventId || '')) return true;
    if (Number.isInteger(Number(block.leftWordIndex)) && Number.isInteger(Number(block.rightWordIndex))) {
      if (Number(block.leftWordIndex) === leftWordIndex && Number(block.rightWordIndex) === rightWordIndex) {
        return true;
      }
    }
    if (normalizeWord(block.phrase || '') === normalizedPhrase) return true;
    if (String(block.boundaryKey || '').trim() === boundaryKey) return true;
  }

  return false;
}

function wordStartsWithVowelSound(word) {
  const normalized = normalizeWord(word);
  if (!normalized) return false;
  if (SILENT_INITIAL_WORDS.has(normalized)) return true;
  return /^[aeiou]/.test(normalized);
}

function wordEndsWithConsonantSound(word) {
  const normalized = normalizeWord(word);
  if (!normalized) return false;
  if (SILENT_FINAL_WORDS.has(normalized)) return true;
  return !/[aeiou]$/.test(normalized);
}

function classifyBoundaryHeuristic(left, right) {
  const leftWord = normalizeWord(left.normalized || left.display || left.raw);
  const rightWord = normalizeWord(right.normalized || right.display || right.raw);

  if (leftWord && rightWord && leftWord.slice(-1) === rightWord.slice(0, 1) && /[bcdfghjklmnpqrstvwxyz]/.test(leftWord.slice(-1))) {
    return {
      category: 'consonant_to_consonant',
      subtype: 'same_consonant_merge',
      confidence: 'medium',
      source: 'lexical'
    };
  }

  if (wordEndsWithConsonantSound(leftWord) && wordStartsWithVowelSound(rightWord)) {
    return {
      category: 'consonant_to_vowel',
      subtype: 'catenation',
      confidence: 'medium',
      source: 'lexical'
    };
  }

  return {
    category: 'none',
    subtype: null,
    confidence: 'low',
    source: 'lexical'
  };
}

function buildEventId(questionId, family, leftIndex, rightIndex) {
  const prefix = questionId ? `q-${String(questionId).trim()}` : 'prompt';
  return `${prefix}-${family}-${leftIndex}-${rightIndex}`;
}

function buildBaseEvent({
  questionId,
  family,
  left,
  right,
  phrase,
  allowedVariants,
  targetFormRole,
  targetIpa,
  acceptedFormRoles,
  detectorConfig,
  confidenceHint,
  feedbackTemplates
}) {
  return {
    eventId: buildEventId(questionId, family, left.wordIndex, right.wordIndex),
    family,
    phrase,
    leftWord: left.normalized,
    rightWord: right.normalized,
    startWordIndex: left.wordIndex,
    endWordIndex: right.wordIndex,
    allowedVariants,
    targetFormRole: targetFormRole || null,
    targetIpa: targetIpa || null,
    acceptedFormRoles: acceptedFormRoles || ['strong', 'weak'],
    detectorConfig: {
      confidenceThreshold: confidenceHint || 0.7,
      ...detectorConfig
    },
    feedbackTemplates: {
      ...getDefaultFeedbackTemplates(family, phrase),
      ...(feedbackTemplates || {})
    }
  };
}

function buildBoundaryEvent({ questionId, boundary, family, promptOverride }) {
  const phrase = `${boundary.leftDisplay || boundary.leftWord || ''} ${boundary.rightDisplay || boundary.rightWord || ''}`.trim();
  const eventId = buildEventId(questionId, family, boundary.leftWordIndex, boundary.rightWordIndex);
  const detectorConfig = mergeDetectorConfig({
    promptOverride,
    family,
    eventId,
    detectorConfig: {
      leftDisplay: boundary.leftDisplay,
      rightDisplay: boundary.rightDisplay,
      source: boundary.source || null,
      boundaryType: boundary.subtype || boundary.category || null
    }
  });
  const allowedVariants = family === 'same_consonant_merge'
    ? ['canonical', 'merged']
    : ['canonical', 'linked'];
  const event = buildBaseEvent({
    questionId,
    family,
    left: { normalized: boundary.leftWord, wordIndex: boundary.leftWordIndex },
    right: { normalized: boundary.rightWord, wordIndex: boundary.rightWordIndex },
    phrase,
    allowedVariants,
    detectorConfig,
    feedbackTemplates: getEventFeedbackOverride(promptOverride, eventId)
  });
  return applyPromptOverrideToEvent(event, promptOverride);
}

function applyPromptOverrideToEvent(event, promptOverride) {
  if (!event || typeof event !== 'object') return event;
  const detectorConfig = mergeDetectorConfig({
    promptOverride,
    family: event.family,
    eventId: event.eventId,
    detectorConfig: event.detectorConfig
  });
  const feedbackTemplates = mergeFeedbackTemplates({
    promptOverride,
    eventId: event.eventId,
    baseTemplates: event.feedbackTemplates
  });
  return {
    ...event,
    detectorConfig,
    feedbackTemplates
  };
}

// Check yod coalescence helper
function isYodCoalescencePhrase(leftWord, rightWord) {
  const phrase = `${normalizeWord(leftWord)} ${normalizeWord(rightWord)}`.trim();
  return YOD_COALESCENCE_PHRASES.has(phrase);
}

function isReducedWord(word) {
  return REDUCED_WORDS.has(normalizeWord(word));
}

function buildGenericEvents(referenceText, questionId) {
  const tokens = getPromptTokens(referenceText);
  const wordTokens = tokens.filter((token) => token.type === 'word');
  const promptOverride = getPromptOverride(questionId);
  const baseline = [];
  const extras = [];
  const blockedPairKeys = new Set();

  for (const pair of getPromptPairs(tokens)) {
    const boundaryKey = `${pair.left.wordIndex}:${pair.right.wordIndex}`;
    if (pair.hardBoundary || isBoundaryBlocked({
      promptOverride,
      leftWordIndex: pair.left.wordIndex,
      rightWordIndex: pair.right.wordIndex,
      phrase: `${pair.left.display} ${pair.right.display}`.trim()
    })) {
      blockedPairKeys.add(boundaryKey);
    }
  }

  for (const pair of getPromptPairs(tokens)) {
    if (blockedPairKeys.has(`${pair.left.wordIndex}:${pair.right.wordIndex}`)) {
      continue;
    }
    const left = pair.left;
    const right = pair.right;
    const boundary = classifyBoundaryHeuristic(left, right);
    const baseBoundary = {
      id: `b-${baseline.length}`,
      leftWordIndex: left.wordIndex,
      rightWordIndex: right.wordIndex,
      leftWord: left.normalized,
      rightWord: right.normalized,
      leftDisplay: left.display,
      rightDisplay: right.display,
      blocked: false,
      blockedReason: null,
      category: boundary.category,
      subtype: boundary.subtype,
      confidence: boundary.confidence,
      source: boundary.source
    };

    if (baseBoundary.category === 'consonant_to_vowel') {
      const event = buildBoundaryEvent({ questionId, boundary: baseBoundary, family: 'catenation', promptOverride });
      if (!isBoundaryBlocked({ promptOverride, event, leftWordIndex: event.startWordIndex, rightWordIndex: event.endWordIndex, phrase: event.phrase })) {
        baseline.push(event);
      }
    } else if (baseBoundary.subtype === 'same_consonant_merge') {
      const event = buildBoundaryEvent({ questionId, boundary: baseBoundary, family: 'same_consonant_merge', promptOverride });
      if (!isBoundaryBlocked({ promptOverride, event, leftWordIndex: event.startWordIndex, rightWordIndex: event.endWordIndex, phrase: event.phrase })) {
        baseline.push(event);
      }
    }
  }

  for (const pair of getPromptPairs(tokens)) {
    if (blockedPairKeys.has(`${pair.left.wordIndex}:${pair.right.wordIndex}`)) {
      continue;
    }
    const left = pair.left;
    const right = pair.right;
    const phrase = `${left.display} ${right.display}`.trim();

    if (isYodCoalescencePhrase(left.normalized, right.normalized)) {
      extras.push(applyPromptOverrideToEvent(buildBaseEvent({
        questionId,
        family: 'yod_coalescence',
        left,
        right,
        phrase,
        allowedVariants: ['canonical', 'coalesced'],
        detectorConfig: {
          phraseType: 'fixed_template'
        }
      }), promptOverride));
    }

    if (left.normalized.endsWith('n') && BILABIAL_INITS.has(String(right.normalized || '')[0] || '')) {
      extras.push(applyPromptOverrideToEvent(buildBaseEvent({
        questionId,
        family: 'n_bilabial_assimilation',
        left,
        right,
        phrase,
        allowedVariants: ['canonical', 'assimilated'],
        detectorConfig: {
          place: 'bilabial',
          sourceHint: 'lexical_context'
        }
      }), promptOverride));
    }

    if (isReducedWord(left.normalized)) {
      extras.push(applyPromptOverrideToEvent(buildBaseEvent({
        questionId,
        family: 'weak_form_reduction',
        left,
        right,
        phrase: left.display,
        allowedVariants: REDUCED_WORDS.get(left.normalized) || ['canonical', 'reduced'],
        targetFormRole: 'weak',
        targetIpa: REDUCED_WORD_IPA.get(left.normalized) || null,
        acceptedFormRoles: ['strong', 'weak'],
        detectorConfig: {
          weakFormWord: left.normalized
        }
      }), promptOverride));
    }
  }

  const overrides = promptOverride;
  let events = [...baseline, ...extras];

  if (Array.isArray(overrides?.suppressBaselineEventIds) && overrides.suppressBaselineEventIds.length > 0) {
    const blocked = new Set(overrides.suppressBaselineEventIds.map((value) => String(value)));
    events = events.filter((event) => !blocked.has(event.eventId));
  }

  if (Array.isArray(overrides?.extraEvents)) {
    const explicitEvents = overrides.extraEvents
      .map((event, index) => {
        const family = String(event.family || 'custom').trim() || 'custom';
        const startIndex = Number(event.startWordIndex);
        const endIndex = Number(event.endWordIndex);
        if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex < 0 || endIndex < startIndex || endIndex >= wordTokens.length) {
          return null;
        }
        const left = wordTokens[startIndex];
        const right = wordTokens[endIndex];
        const eventId = String(event.eventId || buildEventId(questionId, family, startIndex, endIndex)).trim();
        const phrase = String(event.phrase || `${left.display} ${right.display}`).trim();
        const built = buildBaseEvent({
          questionId,
          family,
          left,
          right,
          phrase,
          allowedVariants: Array.isArray(event.allowedVariants) ? event.allowedVariants.slice() : [],
          detectorConfig: mergeDetectorConfig({
            promptOverride: overrides,
            family,
            eventId,
            detectorConfig: { ...(event.detectorConfig || {}) }
          }),
          feedbackTemplates: {
            ...getDefaultFeedbackTemplates(family, phrase),
            ...(event.feedbackTemplates || {})
          }
        });
        return applyPromptOverrideToEvent({
          ...built,
          eventId
        }, overrides);
      })
      .filter(Boolean)
      .filter((event) => !isBoundaryBlocked({
        promptOverride: overrides,
        event,
        leftWordIndex: event.startWordIndex,
        rightWordIndex: event.endWordIndex,
        phrase: event.phrase
      }));

    events = events.concat(explicitEvents);
  }

  const unique = new Map();
  for (const event of events) {
    if (!event?.eventId) continue;
    if (unique.has(event.eventId)) {
      unique.delete(event.eventId);
    }
    unique.set(event.eventId, event);
  }

  return Array.from(unique.values());
}

function buildConnectedSpeechEventSpecs(referenceText, questionId) {
  return buildGenericEvents(referenceText, questionId);
}

function buildEventResult(event, overrides = {}) {
  return {
    eventId: event.eventId,
    family: event.family,
    phrase: event.phrase,
    leftWord: event.leftWord,
    rightWord: event.rightWord,
    startWordIndex: event.startWordIndex,
    endWordIndex: event.endWordIndex,
    targetFormRole: event.targetFormRole || null,
    targetIpa: event.targetIpa || null,
    acceptedFormRoles: event.acceptedFormRoles || ['strong', 'weak'],
    ...overrides
  };
}

function toMilliseconds(azureValue) {
  if (azureValue == null || azureValue === '') return null;
  const numeric = Number(azureValue);
  return Number.isFinite(numeric) ? Math.round(numeric / 10000) : null;
}

// Get Azure Word Score
function getAzureWordScore(wordNode, fieldName) {
  if (!wordNode || typeof wordNode !== 'object' || !fieldName) return null;
  const rawValue = wordNode?.PronunciationAssessment?.[fieldName] ?? wordNode?.[fieldName];
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : null;
}

function getAzureWordErrorType(wordNode) {
  if (!wordNode || typeof wordNode !== 'object') return 'None';
  return String(wordNode?.PronunciationAssessment?.ErrorType || wordNode?.ErrorType || 'None');
}

function selectMostLikelyPhoneme(candidates, fallback = '') {
  const ranked = Array.isArray(candidates)
    ? candidates
      .map((candidate, index) => ({
        phoneme: String(candidate?.Phoneme || candidate?.phoneme || '').trim(),
        score: Number(candidate?.Score ?? candidate?.score),
        index
      }))
      .filter((candidate) => candidate.phoneme)
      .sort((left, right) => {
        const leftScore = Number.isFinite(left.score) ? left.score : -Infinity;
        const rightScore = Number.isFinite(right.score) ? right.score : -Infinity;
        return rightScore - leftScore || left.index - right.index;
      })
    : [];
  return ranked[0]?.phoneme || String(fallback || '').trim();
}

function extractSpokenPhonemes(wordNode) {
  const wordLevelCandidates = wordNode?.PronunciationAssessment?.NBestPhonemes
    || wordNode?.NBestPhonemes;
  if (Array.isArray(wordLevelCandidates) && wordLevelCandidates.length > 0) {
    const candidate = selectMostLikelyPhoneme(wordLevelCandidates);
    return candidate ? [candidate] : [];
  }

  if (!Array.isArray(wordNode?.Phonemes)) return [];
  return wordNode.Phonemes
    .map((phonemeNode) => selectMostLikelyPhoneme(
      phonemeNode?.PronunciationAssessment?.NBestPhonemes || phonemeNode?.NBestPhonemes,
      phonemeNode?.Phoneme || phonemeNode?.phoneme
    ))
    .filter(Boolean);
}

function simplifyWordNode(wordNode, index, referenceWords) {
  if (!wordNode) return null;
  const word = normalizeWord(wordNode.Word || wordNode.Display || wordNode.Lexical || '');
  const phonemeCandidates = extractSpokenPhonemes(wordNode);
  const accuracyScore = getAzureWordScore(wordNode, 'AccuracyScore');
  return {
    index,
    word,
    display: String(wordNode.Word || wordNode.Display || wordNode.Lexical || '').trim(),
    offsetMs: toMilliseconds(wordNode.Offset),
    durationMs: toMilliseconds(wordNode.Duration),
    accuracyScore: Number.isFinite(accuracyScore) ? Math.round(accuracyScore) : 0,
    errorType: getAzureWordErrorType(wordNode),
    phonemes: phonemeCandidates,
    referenceWord: referenceWords[index] || null
  };
}

function extractAzureWords(azurePayload, referenceWords = []) {
  const nbest = Array.isArray(azurePayload?.NBest) ? azurePayload.NBest[0] : null;
  const words = Array.isArray(nbest?.Words) ? nbest.Words : [];
  return words.map((wordNode, index) => simplifyWordNode(wordNode, index, referenceWords)).filter(Boolean);
}

function normalizePhonemeCandidates(phonemes) {
  return Array.isArray(phonemes)
    ? ipaCleanedPhonemes(phonemes)
    : [];
}

function ipaCleanedPhonemes(phonemes) {
  return phonemes
    .map((phoneme) => {
      const raw = String(phoneme || '')
        .trim()
        .normalize('NFKC')
        .replace(/[\u02C8\u02CC\s]/g, '')
        .toLowerCase();
      if (!raw) return '';
      return PHONEME_ALIAS_MAP.get(raw) || raw;
    })
    .filter(Boolean);
}

function hasAnyPhonemeCandidate(wordNode, candidates) {
  if (!wordNode || !Array.isArray(wordNode.phonemes) || !wordNode.phonemes.length) return false;
  const normalized = new Set(normalizePhonemeCandidates(wordNode.phonemes));
  return normalizePhonemeCandidates(candidates).some((candidate) => normalized.has(candidate));
}

function classifyGapStatus(gapMs, thresholds = {}) {
  const detectedThreshold = Number.isFinite(Number(thresholds.detectedThresholdMs))
    ? Number(thresholds.detectedThresholdMs)
    : 140;
  const uncertainThreshold = Number.isFinite(Number(thresholds.uncertainThresholdMs))
    ? Number(thresholds.uncertainThresholdMs)
    : 220;

  if (gapMs == null || gapMs < 0) return 'uncertain';
  if (gapMs <= detectedThreshold) return 'detected';
  if (gapMs >= uncertainThreshold) return 'not_detected';
  return 'uncertain';
}

function getWordSpan(referenceWords, event) {
  const start = Number(event?.startWordIndex);
  const end = Number(event?.endWordIndex);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return null;
  }
  const left = referenceWords[start] || null;
  const right = referenceWords[end] || null;
  return { left, right };
}

function getGapMs(leftWord, rightWord) {
  if (!leftWord || !rightWord) return null;
  if (!Number.isFinite(leftWord.offsetMs) || !Number.isFinite(leftWord.durationMs) || !Number.isFinite(rightWord.offsetMs)) {
    return null;
  }
  const gap = rightWord.offsetMs - (leftWord.offsetMs + leftWord.durationMs);
  return gap < 0 ? null : gap;
}

function classifyEvent(event, referenceWords, azureWords, referenceText, audioQuality) {
  if (audioQuality && audioQuality.passed === false) {
    return {
      eventId: event.eventId,
      family: event.family,
      phrase: event.phrase,
      leftWord: event.leftWord,
      rightWord: event.rightWord,
      startWordIndex: event.startWordIndex,
      endWordIndex: event.endWordIndex,
      status: 'uncertain',
      confidence: 0.1,
      startMs: null,
      endMs: null,
      feedbackText: event.feedbackTemplates?.uncertain || `We could not judge "${event.phrase}" reliably.`,
      evidence: {
        reason: 'audio_not_rateable',
        audioQualityReason: audioQuality.reason || null
      }
    };
  }

  const span = getWordSpan(referenceWords, event);
  if (!span?.left || !span?.right) {
    return {
      eventId: event.eventId,
      family: event.family,
      phrase: event.phrase,
      leftWord: event.leftWord,
      rightWord: event.rightWord,
      startWordIndex: event.startWordIndex,
      endWordIndex: event.endWordIndex,
      status: 'uncertain',
      confidence: 0.2,
      startMs: null,
      endMs: null,
      feedbackText: event.feedbackTemplates?.uncertain || `We could not judge "${event.phrase}" reliably.`,
      evidence: { reason: 'missing_span' }
    };
  }

  const leftAzure = azureWords[Number(event.startWordIndex)] || null;
  const rightAzure = azureWords[Number(event.endWordIndex)] || null;
  const gapMs = getGapMs(leftAzure, rightAzure);
  const baseStatus = classifyGapStatus(gapMs, event.detectorConfig || {});

  if (!leftAzure || !rightAzure) {
    return {
      eventId: event.eventId,
      family: event.family,
      phrase: event.phrase,
      leftWord: event.leftWord,
      rightWord: event.rightWord,
      startWordIndex: event.startWordIndex,
      endWordIndex: event.endWordIndex,
      status: 'uncertain',
      confidence: 0.25,
      startMs: leftAzure?.offsetMs ?? null,
      endMs: rightAzure?.offsetMs ?? null,
      feedbackText: event.feedbackTemplates?.uncertain || `We could not judge "${event.phrase}" reliably.`,
      evidence: {
        reason: 'missing_azure_word_timing',
        gapMs
      }
    };
  }

  if (leftAzure.offsetMs == null || leftAzure.durationMs == null || rightAzure.offsetMs == null || rightAzure.durationMs == null) {
    return {
      eventId: event.eventId,
      family: event.family,
      phrase: event.phrase,
      leftWord: event.leftWord,
      rightWord: event.rightWord,
      startWordIndex: event.startWordIndex,
      endWordIndex: event.endWordIndex,
      status: 'uncertain',
      confidence: 0.5,
      startMs: leftAzure.offsetMs ?? null,
      endMs: rightAzure.offsetMs != null && rightAzure.durationMs != null ? rightAzure.offsetMs + rightAzure.durationMs : null,
      feedbackText: event.feedbackTemplates?.uncertain || `We could not judge "${event.phrase}" reliably.`,
      evidence: {
        reason: 'missing_timing_fields',
        gapMs
      }
    };
  }

  const leftText = normalizeWord(leftAzure.word || leftAzure.display);
  const rightText = normalizeWord(rightAzure.word || rightAzure.display);
  const phraseText = `${leftText} ${rightText}`.trim();
  const promptText = normalizeWord(referenceText);
  const wordAccuracyAverage = Math.round(((leftAzure.accuracyScore || 0) + (rightAzure.accuracyScore || 0)) / 2);
  const leftPhonemeHints = leftAzure.phonemes || [];
  const rightPhonemeHints = rightAzure.phonemes || [];
  const coalescedHint = hasAnyPhonemeCandidate(rightAzure, ['dʒ', 'ʤ', 'tʃ', 'ʧ', 'ʒ']);
  const bilabialHint = hasAnyPhonemeCandidate(leftAzure, ['m']);

  if (event.family === 'catenation') {
    const status = baseStatus;
    return {
      eventId: event.eventId,
      family: event.family,
      phrase: event.phrase,
      leftWord: event.leftWord,
      rightWord: event.rightWord,
      startWordIndex: event.startWordIndex,
      endWordIndex: event.endWordIndex,
      status,
      confidence: status === 'detected' ? 0.84 : status === 'not_detected' ? 0.3 : 0.55,
      startMs: leftAzure.offsetMs,
      endMs: rightAzure.offsetMs + rightAzure.durationMs,
      feedbackText: event.feedbackTemplates?.[status] || `Try smoothing "${event.phrase}" more.`,
      evidence: {
        variant: status === 'detected' ? 'linked' : 'canonical',
        gapMs,
        leftPhonemeHints,
        rightPhonemeHints,
        promptText
      }
    };
  }

  if (event.family === 'same_consonant_merge') {
    const status = baseStatus;
    return {
      eventId: event.eventId,
      family: event.family,
      phrase: event.phrase,
      leftWord: event.leftWord,
      rightWord: event.rightWord,
      startWordIndex: event.startWordIndex,
      endWordIndex: event.endWordIndex,
      status,
      confidence: status === 'detected' ? 0.8 : status === 'not_detected' ? 0.35 : 0.5,
      startMs: leftAzure.offsetMs,
      endMs: rightAzure.offsetMs + rightAzure.durationMs,
      feedbackText: event.feedbackTemplates?.[status] || `Try merging "${event.phrase}" more.`,
      evidence: {
        variant: status === 'detected' ? 'merged' : 'canonical',
        gapMs,
        leftPhonemeHints,
        rightPhonemeHints,
        promptText
      }
    };
  }

  if (event.family === 'n_bilabial_assimilation') {
    const status = gapMs != null && gapMs <= 125 && (leftAzure.accuracyScore <= 84 || bilabialHint)
      ? 'detected'
      : gapMs != null && gapMs >= 280 && !bilabialHint
        ? 'not_detected'
        : 'uncertain';
    return {
      eventId: event.eventId,
      family: event.family,
      phrase: event.phrase,
      leftWord: event.leftWord,
      rightWord: event.rightWord,
      startWordIndex: event.startWordIndex,
      endWordIndex: event.endWordIndex,
      status,
      confidence: status === 'detected' ? 0.74 : status === 'not_detected' ? 0.32 : 0.52,
      startMs: leftAzure.offsetMs,
      endMs: rightAzure.offsetMs + rightAzure.durationMs,
      feedbackText: event.feedbackTemplates?.[status] || `Try smoothing "${event.phrase}" more.`,
      evidence: {
        variant: status === 'detected' ? 'assimilated_n_to_m' : 'canonical',
        gapMs,
        leftPhonemeHints,
        rightPhonemeHints,
        leftAccuracy: leftAzure.accuracyScore,
        rightAccuracy: rightAzure.accuracyScore,
        promptText
      }
    };
  }

  if (event.family === 'yod_coalescence') {
    const status = gapMs != null && (gapMs <= 125 || coalescedHint)
      ? 'detected'
      : gapMs != null && gapMs >= 280 && !coalescedHint
        ? 'not_detected'
        : 'uncertain';
    return {
      eventId: event.eventId,
      family: event.family,
      phrase: event.phrase,
      leftWord: event.leftWord,
      rightWord: event.rightWord,
      startWordIndex: event.startWordIndex,
      endWordIndex: event.endWordIndex,
      status,
      confidence: status === 'detected' ? 0.72 : status === 'not_detected' ? 0.3 : 0.5,
      startMs: leftAzure.offsetMs,
      endMs: rightAzure.offsetMs + rightAzure.durationMs,
      feedbackText: event.feedbackTemplates?.[status] || `Try smoothing "${event.phrase}" more.`,
      evidence: {
        variant: status === 'detected' ? 'coalesced' : 'canonical',
        gapMs,
        leftPhonemeHints,
        rightPhonemeHints,
        promptText,
        phraseText
      }
    };
  }

  if (event.family === 'weak_form_reduction') {
    const targetWord = normalizeWord(event.detectorConfig?.weakFormWord || event.phrase);
    // Oxford American transcribes both strong and weak "were" as /wər/.
    // Its schwa is therefore not contrastive evidence of reduction; rely on
    // duration/prominence evidence for that word.
    const reducedHint = targetWord !== 'were'
      && hasAnyPhonemeCandidate(leftAzure, ['ə', 'ɐ', 'ʊ', 'ɪ']);
    const reducedDuration = Number(leftAzure.durationMs || 0);
    const nextDuration = Number(rightAzure.durationMs || 0);
    const relativeDuration = nextDuration > 0 ? reducedDuration / nextDuration : null;
    const status = ((relativeDuration != null && relativeDuration <= 0.75) || reducedHint)
      ? 'detected'
      : (leftAzure.accuracyScore >= 94 && relativeDuration != null && relativeDuration >= 1.15 && !reducedHint)
        ? 'not_detected'
        : 'uncertain';
    return buildEventResult(event, {
      status,
      confidence: status === 'detected' ? 0.7 : status === 'not_detected' ? 0.34 : 0.5,
      startMs: leftAzure.offsetMs,
      endMs: leftAzure.offsetMs + leftAzure.durationMs,
      feedbackText: event.feedbackTemplates?.[status] || `Try reducing "${event.phrase}" more.`,
      evidence: {
        variant: status === 'detected' ? 'weak_form' : 'canonical',
        gapMs,
        relativeDuration,
        leftPhonemeHints,
        rightPhonemeHints,
        targetWord,
        targetFormRole: event.targetFormRole || 'weak',
        targetIpa: event.targetIpa || null,
        acceptedFormRoles: event.acceptedFormRoles || ['strong', 'weak'],
        promptText
      }
    });
  }

  return buildEventResult(event, {
    status: 'uncertain',
    confidence: 0.45,
    startMs: leftAzure.offsetMs,
    endMs: rightAzure.offsetMs + rightAzure.durationMs,
    feedbackText: event.feedbackTemplates?.uncertain || `We could not judge "${event.phrase}" reliably.`,
    evidence: {
      gapMs,
      leftPhonemeHints,
      rightPhonemeHints,
      promptText
    }
  });
}

function summarizeEvents(events) {
  return events.reduce((summary, event) => {
    if (event.status === 'detected') summary.detectedCount += 1;
    else if (event.status === 'not_detected') summary.notDetectedCount += 1;
    else summary.uncertainCount += 1;
    return summary;
  }, { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 });
}

function buildEventFamilyCounts(events) {
  return events.reduce((counts, event) => {
    const family = String(event?.family || 'unknown').trim() || 'unknown';
    counts[family] = (counts[family] || 0) + 1;
    return counts;
  }, {});
}

function buildConnectedSpeechAnalysis({ questionId, referenceText, azurePayload, audioQuality }) {
  const events = buildConnectedSpeechEventSpecs(referenceText, questionId);
  if (!events.length) {
    return {
      status: 'not_applicable',
      version: VERSION,
      summary: summarizeEvents([]),
      events: [],
      familyCounts: {}
    };
  }

  if (audioQuality && audioQuality.passed === false) {
    return {
      status: 'not_rateable',
      version: VERSION,
      summary: summarizeEvents([]),
      events: [],
      familyCounts: {}
    };
  }

  const referenceWords = getPromptTokens(referenceText)
    .filter((token) => token.type === 'word')
    .map((token) => token.normalized);
  const azureWords = extractAzureWords(azurePayload, referenceWords);
  const scoredEvents = events.map((event) => classifyEvent(event, referenceWords, azureWords, referenceText, audioQuality));

  return {
    status: 'complete',
    version: VERSION,
    summary: summarizeEvents(scoredEvents),
    events: scoredEvents,
    familyCounts: buildEventFamilyCounts(scoredEvents)
  };
}

function hasConnectedSpeechEvents(referenceText, questionId) {
  return buildGenericEvents(referenceText, questionId).length > 0;
}

module.exports = {
  VERSION,
  buildConnectedSpeechAnalysis,
  buildConnectedSpeechEventSpecs,
  buildGenericEvents,
  hasConnectedSpeechEvents,
  normalizeWord,
  extractAzureWords,
  summarizeEvents,
  buildEventFamilyCounts,
  normalizePhonemeCandidates,
  hasAnyPhonemeCandidate
};
