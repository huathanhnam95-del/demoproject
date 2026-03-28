export const ALGORITHM = Object.freeze({
    SM2: 'SM2',
    FSRS: 'FSRS'
});

export const CARD_STATE = Object.freeze({
    NEW: 'new',
    LEARNING: 'learning',
    REVIEWING: 'reviewing',
    RELEARNING: 'relearning',
    MASTERED: 'mastered'
});

export const RATING = Object.freeze({
    AGAIN: 1,
    HARD: 2,
    GOOD: 3,
    EASY: 4
});

export const SRS_STORAGE_KEYS = Object.freeze({
    ALGORITHM: 'srs_algorithm_preference',
    LEGACY_ALGORITHM: 'srs_preferred_algorithm',
    ONBOARDING_COMPLETE: 'srs_onboarding_complete',
    TUTORIAL_SEEN: 'srs_tutorial_seen',
    PENDING: 'srs_pending_data',
    GUEST_SRS: 'bel_guest_srs_v1'
});
