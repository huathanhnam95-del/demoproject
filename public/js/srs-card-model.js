import { ALGORITHM, CARD_STATE } from './srs-constants.js';

const DEFAULT_EASE_FACTOR = 2.5;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isValidDateString(value) {
    return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function addDays(date, days) {
    const clone = new Date(date);
    if (Number.isNaN(clone.getTime())) return new Date();
    clone.setDate(clone.getDate() + days);
    return clone;
}

function addMinutes(date, minutes) {
    const clone = new Date(date);
    if (Number.isNaN(clone.getTime())) return new Date();
    return new Date(clone.getTime() + minutes * 60 * 1000);
}

function normalizeAlgorithm(algorithm) {
    if (algorithm === ALGORITHM.FSRS) return ALGORITHM.FSRS;
    if (algorithm === ALGORITHM.SM2) return ALGORITHM.SM2;
    return null;
}

function normalizeState(rawState, card, now) {
    const validStates = Object.values(CARD_STATE);
    if (validStates.includes(rawState)) {
        return rawState;
    }

    if (rawState === 'mastered' || card?.status === 'mastered') return CARD_STATE.MASTERED;
    if (rawState === 'reviewing' || card?.status === 'reviewing') return CARD_STATE.REVIEWING;
    if (rawState === 'relearning') return CARD_STATE.RELEARNING;
    if (rawState === 'learning' || card?.status === 'learning') {
        if (card?.interval >= 1) return CARD_STATE.REVIEWING;
        return CARD_STATE.LEARNING;
    }

    if (card?.interval >= 1) return CARD_STATE.REVIEWING;
    if (isValidDateString(card?.nextReviewDate)) {
        return new Date(card.nextReviewDate) > now ? CARD_STATE.REVIEWING : CARD_STATE.LEARNING;
    }

    return CARD_STATE.NEW;
}

function deriveUiStatus(card) {
    if (!card) return 'learning';
    if (card.state === CARD_STATE.MASTERED) return 'mastered';
    if (card.state === CARD_STATE.REVIEWING) return 'review';
    return 'learning';
}

function normalizeSrsCard(rawCard = {}, now = new Date()) {
    const card = { ...rawCard };

    card.algorithm = normalizeAlgorithm(card.algorithm) || (card.fsrs ? ALGORITHM.FSRS : ALGORITHM.SM2);
    card.interval = isFiniteNumber(card.interval) ? Math.max(0, Math.round(card.interval)) : 0;
    card.repetitions = isFiniteNumber(card.repetitions) ? Math.max(0, Math.round(card.repetitions)) : 0;
    card.stepIndex = isFiniteNumber(card.stepIndex) ? Math.max(0, Math.round(card.stepIndex)) : 0;
    card.easeFactor = isFiniteNumber(card.easeFactor) ? card.easeFactor : DEFAULT_EASE_FACTOR;

    const normalizedState = normalizeState(card.state, card, now);
    card.state = normalizedState;

    if (isValidDateString(card.lastReviewDate)) {
        card.lastReviewDate = new Date(card.lastReviewDate).toISOString();
    } else if (card.lastReviewDate === null || card.lastReviewDate === undefined) {
        card.lastReviewDate = null;
    } else {
        card.lastReviewDate = null;
    }

    if (card.fsrs && typeof card.fsrs === 'object') {
        const fsrs = { ...card.fsrs };
        fsrs.difficulty = isFiniteNumber(fsrs.difficulty) ? fsrs.difficulty : 5;
        fsrs.stability = isFiniteNumber(fsrs.stability) ? fsrs.stability : 0;
        fsrs.retrievability = isFiniteNumber(fsrs.retrievability) ? fsrs.retrievability : 1;
        fsrs.lastReview = isValidDateString(fsrs.lastReview) ? new Date(fsrs.lastReview).toISOString() : null;
        fsrs.lapses = isFiniteNumber(fsrs.lapses) ? Math.max(0, Math.round(fsrs.lapses)) : 0;
        fsrs.reps = isFiniteNumber(fsrs.reps) ? Math.max(0, Math.round(fsrs.reps)) : card.repetitions;
        card.fsrs = fsrs;
    }

    if (isValidDateString(card.nextReviewDate)) {
        card.nextReviewDate = new Date(card.nextReviewDate).toISOString();
    } else {
        if (card.state === CARD_STATE.LEARNING || card.state === CARD_STATE.RELEARNING) {
            card.nextReviewDate = addMinutes(now, card.stepIndex > 0 ? 10 : 1).toISOString();
        } else if (card.state === CARD_STATE.REVIEWING || card.state === CARD_STATE.MASTERED) {
            const sourceDate = isValidDateString(card.lastReviewDate) ? new Date(card.lastReviewDate) : now;
            const days = card.interval > 0 ? card.interval : 1;
            card.nextReviewDate = addDays(sourceDate, days).toISOString();
        } else {
            card.nextReviewDate = now.toISOString();
        }
    }

    card.status = deriveUiStatus(card);
    return card;
}

function isMasteredCard(card) {
    return Boolean(card && (card.state === CARD_STATE.MASTERED || card.status === 'mastered'));
}

function isCardDue(card, now = new Date()) {
    if (!card) return false;
    const normalized = normalizeSrsCard(card, now);
    if (normalized.state === CARD_STATE.MASTERED) return false;
    return new Date(normalized.nextReviewDate) <= now;
}

function migrateCardForTargetAlgorithm(rawCard = {}, targetAlgorithm = ALGORITHM.SM2, now = new Date()) {
    const card = normalizeSrsCard(rawCard, now);
    const target = normalizeAlgorithm(targetAlgorithm);
    if (card.algorithm === target) {
        return card;
    }

    const daysUntilDue = isValidDateString(card.nextReviewDate)
        ? Math.max(0, Math.ceil((new Date(card.nextReviewDate) - now) / (24 * 60 * 60 * 1000)))
        : Math.max(0, card.interval || 0);

    if (target === ALGORITHM.FSRS) {
        const easeFactor = isFiniteNumber(card.easeFactor) ? card.easeFactor : DEFAULT_EASE_FACTOR;
        const difficulty = clamp(5 + ((DEFAULT_EASE_FACTOR - easeFactor) / 1.2) * 5, 1, 10);
        const stability = Math.max(0.1, card.interval || daysUntilDue || 0.1);

        return {
            ...card,
            algorithm: ALGORITHM.FSRS,
            fsrs: {
                difficulty,
                stability,
                retrievability: 1,
                lastReview: card.lastReviewDate,
                lapses: card.fsrs?.lapses || 0,
                reps: card.repetitions || card.fsrs?.reps || 0
            }
        };
    }

    const interval = Math.max(0, Math.round(card.interval || card.fsrs?.stability || daysUntilDue || 0));
    const difficulty = isFiniteNumber(card.fsrs?.difficulty) ? card.fsrs.difficulty : 5;
    const easeFactor = clamp(DEFAULT_EASE_FACTOR - (((difficulty - 5) / 5) * 1.2), 1.3, 2.5);

    return {
        ...card,
        algorithm: ALGORITHM.SM2,
        interval,
        easeFactor,
        repetitions: card.repetitions || card.fsrs?.reps || 0
    };
}

export {
    clamp,
    deriveUiStatus,
    isCardDue,
    isMasteredCard,
    migrateCardForTargetAlgorithm,
    normalizeSrsCard
};
