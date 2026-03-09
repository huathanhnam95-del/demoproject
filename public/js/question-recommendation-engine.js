const DEFAULT_RECENT_WINDOW_SIZE = 10;
const DIFFICULTY_WEIGHT = 0.65;
const OVERLAP_WEIGHT = 0.35;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were',
  'will', 'with', 'you', 'your', 'this', 'these', 'those', 'they', 'them', 'we',
  'our', 'i', 'me', 'my', 'but', 'if', 'then', 'than', 'so', 'do', 'does', 'did',
  'can', 'could', 'should', 'would', 'may', 'might', 'not'
]);

function toNumericId(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeLevel(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return 1;
  if (parsed < 1) return 1;
  if (parsed > 3) return 3;
  return parsed;
}

function normalizeToken(rawToken) {
  return String(rawToken || '')
    .toLowerCase()
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');
}

function tokenizeText(text) {
  if (!text) return [];
  return String(text)
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
}

function toTokenSets(tokens) {
  const allTokens = new Set(tokens);
  const contentTokens = new Set(tokens.filter((token) => !STOP_WORDS.has(token)));
  return {
    tokens: allTokens,
    contentTokens: contentTokens.size > 0 ? contentTokens : allTokens
  };
}

function getTextForMode(mode, item) {
  if (!item || typeof item !== 'object') return '';
  if (mode === 'type' || mode === 'speak') {
    return item.correctSentence || '';
  }
  if (mode === 'extended') {
    return item.transcript || item.correctSentence || '';
  }
  if (mode === 'notes') {
    return item.transcript || '';
  }
  return item.correctSentence || item.transcript || '';
}

function intersectionCount(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let count = 0;
  for (const token of smaller) {
    if (larger.has(token)) {
      count += 1;
    }
  }
  return count;
}

function calculateOverlapScore(currentEntry, candidateEntry) {
  if (!currentEntry || !candidateEntry) return 0;
  const currentSet = currentEntry.contentTokens;
  const candidateSet = candidateEntry.contentTokens;
  if (!currentSet || !candidateSet || currentSet.size === 0 || candidateSet.size === 0) {
    return 0;
  }

  const shared = intersectionCount(currentSet, candidateSet);
  if (shared <= 0) return 0;

  const denom = Math.max(1, Math.min(currentSet.size, candidateSet.size));
  return Math.min(1, shared / denom);
}

function calculateDifficultyScore(targetLevel, candidateLevel) {
  const gap = Math.abs(Number(targetLevel) - Number(candidateLevel));
  if (gap === 0) return 1;
  if (gap === 1) return 0.5;
  return 0;
}

function calculateRepeatPenalty(candidateId, recentQuestionIds, recentWindowSize) {
  const trimmedRecent = Array.isArray(recentQuestionIds)
    ? recentQuestionIds
      .map(toNumericId)
      .filter((id) => id !== null)
      .slice(-Math.max(1, recentWindowSize))
    : [];

  const index = trimmedRecent.lastIndexOf(candidateId);
  if (index === -1) return 0;

  const distanceFromLatest = trimmedRecent.length - index;
  const penalty = 0.85 - ((distanceFromLatest - 1) * 0.1);
  return Math.max(0.3, penalty);
}

function toReasonCode(difficultyScore, overlapScore) {
  if (difficultyScore > 0 && overlapScore > 0) return 'level_and_continuity';
  if (difficultyScore > 0) return 'difficulty_only';
  if (overlapScore > 0) return 'continuity_only';
  return 'fallback';
}

function compareRankedCandidates(a, b) {
  if (a.finalScore !== b.finalScore) return b.finalScore - a.finalScore;
  if (a.repeatPenalty !== b.repeatPenalty) return a.repeatPenalty - b.repeatPenalty;
  return a.id - b.id;
}

export function mapCefrToQuestionLevel(cefrLevel) {
  const parsed = Number.parseInt(String(cefrLevel), 10);
  if (!Number.isFinite(parsed) || parsed <= 2) return 1;
  if (parsed <= 4) return 2;
  return 3;
}

export function createQuestionRecommendationEngine(options = {}) {
  const configuredWindowSize = Number.parseInt(String(options.recentWindowSize), 10);
  const recentWindowSize = Number.isFinite(configuredWindowSize) && configuredWindowSize > 0
    ? configuredWindowSize
    : DEFAULT_RECENT_WINDOW_SIZE;

  function buildIndex(mode, items = []) {
    const byId = new Map();

    for (const item of items) {
      const id = toNumericId(item?.id);
      if (id === null) continue;

      const level = sanitizeLevel(item?.level);
      const rawText = getTextForMode(mode, item);
      const tokens = tokenizeText(rawText);
      const tokenSets = toTokenSets(tokens);

      byId.set(id, {
        id,
        level,
        tokens: tokenSets.tokens,
        contentTokens: tokenSets.contentTokens
      });
    }

    return {
      mode,
      byId
    };
  }

  function recommendNext(params = {}) {
    const {
      currentQuestionId,
      currentCefrLevel,
      visibleQuestionIds,
      recentQuestionIds,
      index
    } = params;

    if (!index || !index.byId || !(index.byId instanceof Map)) {
      return null;
    }

    const currentId = toNumericId(currentQuestionId);
    if (currentId === null) return null;

    const currentEntry = index.byId.get(currentId) || null;
    const targetQuestionLevel = mapCefrToQuestionLevel(currentCefrLevel);

    const visibleIds = Array.from(new Set(
      (Array.isArray(visibleQuestionIds) ? visibleQuestionIds : [])
        .map(toNumericId)
        .filter((id) => id !== null)
    ));

    if (visibleIds.length === 0) {
      return null;
    }

    const ranked = [];
    for (const candidateId of visibleIds) {
      if (!index.byId.has(candidateId)) continue;
      if (candidateId === currentId && visibleIds.length > 1) continue;

      const candidate = index.byId.get(candidateId);
      const difficultyScore = calculateDifficultyScore(targetQuestionLevel, candidate.level);
      const overlapScore = calculateOverlapScore(currentEntry, candidate);
      const repeatPenalty = calculateRepeatPenalty(candidateId, recentQuestionIds, recentWindowSize);
      const finalScore = (DIFFICULTY_WEIGHT * difficultyScore) + (OVERLAP_WEIGHT * overlapScore) - repeatPenalty;

      ranked.push({
        id: candidateId,
        difficultyScore,
        overlapScore,
        repeatPenalty,
        finalScore
      });
    }

    if (ranked.length === 0) {
      if (index.byId.has(currentId)) {
        return {
          nextQuestionId: currentId,
          reasonCode: 'fallback',
          score: 0
        };
      }
      return null;
    }

    ranked.sort(compareRankedCandidates);
    const best = ranked[0];
    const isSelfFallback = best.id === currentId;

    return {
      nextQuestionId: best.id,
      reasonCode: isSelfFallback ? 'fallback' : toReasonCode(best.difficultyScore, best.overlapScore),
      score: Number((isSelfFallback ? 0 : best.finalScore).toFixed(6))
    };
  }

  return {
    buildIndex,
    recommendNext,
    recentWindowSize
  };
}

if (typeof window !== 'undefined') {
  window.QuestionRecommendationEngine = {
    mapCefrToQuestionLevel,
    createQuestionRecommendationEngine
  };
}
