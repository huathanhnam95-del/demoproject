const ALLOWED_POS = new Set(['noun', 'verb', 'adjective', 'adverb', 'n', 'v', 'adj', 'adv']);
const SKIP_WORDS = new Set(['be', 'a', 'an', 'the', 'is', 'are', 'was', 'were']);

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function clonePlainObject(value) {
  if (!value || typeof value !== 'object') return {};
  return JSON.parse(JSON.stringify(value));
}

export function normalizeWritingChallengeWordKey(wordObj) {
  const entryType = normalizeText(wordObj?.entryType || 'word') || 'word';
  const base = normalizeText(wordObj?.lemma || wordObj?.originalWord || wordObj?.word);
  if (!base) return '';
  if (base.startsWith('word:') || base.startsWith('phrase:')) {
    return base;
  }
  return `${entryType}:${base}`;
}

export function createQueuedWritingChallengeItem(wordObj, triggerReason = '') {
  const snapshot = clonePlainObject(wordObj);
  const wordKey = normalizeWritingChallengeWordKey(snapshot);
  if (!wordKey) return null;

  return Object.freeze({
    challengeId: `wc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    wordKey,
    wordObj: snapshot,
    queuedAt: new Date().toISOString(),
    triggerReason: triggerReason || ''
  });
}

export function getWritingChallengeValidationTarget(context) {
  const target = context?.usedCollocation
    || context?.validationTarget
    || context?.wordObj?.lemma
    || context?.wordObj?.originalWord
    || context?.wordObj?.word
    || '';

  return String(target || '').trim();
}

export function createActiveWritingChallengeContext(item, contextId) {
  const challengeId = String(item?.challengeId || `wc_${Date.now()}`);
  const wordObj = clonePlainObject(item?.wordObj || item || {});
  const wordKey = item?.wordKey || normalizeWritingChallengeWordKey(wordObj);

  return {
    challengeId,
    contextId: String(contextId || `writing_${Date.now()}`),
    status: 'loading',
    wordKey,
    wordObj,
    promptText: '',
    promptType: null,
    usedCollocation: null,
    starter: null,
    showStarter: false,
    validationTarget: getWritingChallengeValidationTarget({ wordObj })
  };
}

export function buildAssessWritingContext(context) {
  if (!context) return null;

  return {
    challengeId: context.challengeId || '',
    contextId: context.contextId || '',
    word: context.wordObj?.originalWord || context.wordObj?.lemma || '',
    lemma: context.wordObj?.lemma || context.wordObj?.originalWord || '',
    partOfSpeech: context.wordObj?.partOfSpeech || context.wordObj?.pos || '',
    entryType: context.wordObj?.entryType || 'word',
    promptText: context.promptText || '',
    usedCollocation: context.usedCollocation || null,
    validationTarget: getWritingChallengeValidationTarget(context)
  };
}

export function getPendingWritingChallengeCount(queue) {
  return Array.isArray(queue) ? queue.length : 0;
}

export function getNextPendingWritingChallenge(queue) {
  return getPendingWritingChallengeCount(queue) > 0 ? queue[0] : null;
}

export function shouldConsumePendingWritingChallenge(reason) {
  return reason === 'skip' || reason === 'auto-complete' || reason === 'complete';
}

export function consumePendingWritingChallenges(queue, reason) {
  const list = Array.isArray(queue) ? [...queue] : [];
  if (!shouldConsumePendingWritingChallenge(reason)) {
    return list;
  }
  list.shift();
  return list;
}

export function getWritingChallengeSummaryState(queue) {
  const count = getPendingWritingChallengeCount(queue);
  if (count === 0) {
    return {
      count: 0,
      text: '',
      showButton: false,
      showStatus: false
    };
  }

  return {
    count,
    text: count === 1 ? '1 Writing Challenge ready' : `${count} Writing Challenges ready`,
    showButton: true,
    showStatus: true
  };
}

export function normalizeWritingChallengeOptions(options) {
  if (!Array.isArray(options)) return [];

  const seen = new Set();
  return options.reduce((list, option) => {
    const text = String(option?.text || '').trim().replace(/\s+/g, ' ');
    if (!text) return list;

    const key = normalizeText(text);
    if (seen.has(key)) return list;
    seen.add(key);

    list.push({
      ...option,
      text
    });
    return list;
  }, []);
}

export function getWritingChallengeDecision({ currentWord, wasCorrect, becameMastered = false }) {
  const entryType = String(currentWord?.entryType || 'word').toLowerCase();
  const lemma = normalizeText(currentWord?.lemma || currentWord?.originalWord);
  const pos = normalizeText(currentWord?.partOfSpeech || currentWord?.pos);
  const isAllowedPos = Array.from(ALLOWED_POS).some((allowed) => pos === allowed);

  const decision = {
    shouldTrigger: false,
    reason: '',
    entryType,
    wasCorrect: wasCorrect === true,
    becameMastered: becameMastered === true
  };

  if (!decision.wasCorrect || !currentWord) {
    return decision;
  }

  if (entryType === 'phrase') {
    decision.shouldTrigger = true;
    decision.reason = 'phrase-success';
    return decision;
  }

  if (SKIP_WORDS.has(lemma) || !isAllowedPos || !decision.becameMastered) {
    return decision;
  }

  decision.shouldTrigger = true;
  decision.reason = 'mastered-word';
  return decision;
}
