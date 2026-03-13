import { buildMissedReviewItems } from './reading-journey-quiz-results.js';

export const REVIEW_QUEUE_STORAGE_KEY = 'rj_assessment_review_v1';
export const REVIEW_QUEUE_VERSION = 1;
export const REVIEW_INTERVALS_DAYS = [1, 3, 7];
export const REVIEW_INTERVALS_MS = REVIEW_INTERVALS_DAYS.map((days) => days * 24 * 60 * 60 * 1000);

function normalizeScalar(value) {
  return String(value ?? '').trim();
}

function normalizeLevel(level) {
  const value = normalizeScalar(level).toUpperCase();
  return ['A2', 'B1', 'B2', 'C1'].includes(value) ? value : 'B1';
}

function getStorage(storage) {
  if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') {
    return storage;
  }
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

function normalizeReviewItem(item) {
  const safeItem = item && typeof item === 'object' ? item : {};
  const reviewId = normalizeScalar(safeItem.reviewId);
  const questionType = normalizeScalar(safeItem.questionType);
  const prompt = normalizeScalar(safeItem.prompt);
  const storyTitle = normalizeScalar(safeItem.storyTitle);

  if (!reviewId || !questionType || !prompt || !storyTitle) {
    return null;
  }

  const reviewState = safeItem.reviewState && typeof safeItem.reviewState === 'object' ? safeItem.reviewState : {};

  return {
    reviewId,
    questionType,
    prompt,
    level: normalizeLevel(safeItem.level),
    storyTitle,
    reviewState: {
      intervalDays: Number(reviewState.intervalDays) || REVIEW_INTERVALS_DAYS[0],
      nextReviewAt: Number(reviewState.nextReviewAt) || 0,
      failures: Number(reviewState.failures) || 0
    }
  };
}

export function loadReviewQueue(storage) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) {
    return { version: REVIEW_QUEUE_VERSION, items: [] };
  }

  try {
    const raw = targetStorage.getItem(REVIEW_QUEUE_STORAGE_KEY);
    if (!raw) return { version: REVIEW_QUEUE_VERSION, items: [] };
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items.map(normalizeReviewItem).filter(Boolean) : [];
    return {
      version: Number(parsed?.version) || REVIEW_QUEUE_VERSION,
      items
    };
  } catch (_) {
    return { version: REVIEW_QUEUE_VERSION, items: [] };
  }
}

export function saveReviewQueue(queue, storage) {
  const targetStorage = getStorage(storage);
  const normalized = {
    version: REVIEW_QUEUE_VERSION,
    items: Array.isArray(queue?.items) ? queue.items.map(normalizeReviewItem).filter(Boolean) : []
  };

  if (targetStorage) {
    targetStorage.setItem(REVIEW_QUEUE_STORAGE_KEY, JSON.stringify(normalized));
  }

  return normalized;
}

export function enqueueMissedItems(items, { storage, now = Date.now() } = {}) {
  const queue = loadReviewQueue(storage);
  const existingIds = new Set(queue.items.map((item) => item.reviewId));

  (Array.isArray(items) ? items : []).forEach((item) => {
    const normalized = normalizeReviewItem({
      ...item,
      reviewState: {
        intervalDays: REVIEW_INTERVALS_DAYS[0],
        nextReviewAt: now + REVIEW_INTERVALS_MS[0],
        failures: Number(item?.reviewState?.failures) || 1
      }
    });
    if (!normalized || existingIds.has(normalized.reviewId)) return;
    existingIds.add(normalized.reviewId);
    queue.items.push(normalized);
  });

  return saveReviewQueue(queue, storage);
}

export function queueQuizMisses(results, { quizId, level, storyTitle, storage, now = Date.now() } = {}) {
  const items = buildMissedReviewItems(results, { quizId, level, storyTitle });
  const queueBefore = loadReviewQueue(storage);
  const existingCount = queueBefore.items.length;
  const queue = enqueueMissedItems(items, { storage, now });
  return {
    enqueuedCount: Math.max(0, queue.items.length - existingCount),
    queue
  };
}

export function getDueReviewItems({ storage, now = Date.now() } = {}) {
  const queue = loadReviewQueue(storage);
  return queue.items.filter((item) => Number(item.reviewState?.nextReviewAt) <= now);
}
