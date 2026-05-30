const MODE_ALIASES = {
    readaloud: 'read_aloud',
    read_aloud: 'read_aloud',
    'read-aloud': 'read_aloud',
    repeatsentence: 'repeat_sentence',
    repeat_sentence: 'repeat_sentence',
    'repeat-sentence': 'repeat_sentence',
    retelllecture: 'retell_lecture',
    retell_lecture: 'retell_lecture',
    'retell-lecture': 'retell_lecture',
    describeimage: 'describe_image',
    describe_image: 'describe_image',
    'describe-image': 'describe_image',
    answershortquestion: 'answer_short_question',
    answer_short_question: 'answer_short_question',
    'answer-short-question': 'answer_short_question',
    asq: 'answer_short_question',
    respondtosituation: 'respond_to_situation',
    respond_to_situation: 'respond_to_situation',
    'respond-to-situation': 'respond_to_situation',
    rts: 'respond_to_situation',
    summarizegroupdiscussion: 'summarize_group_discussion',
    summarize_group_discussion: 'summarize_group_discussion',
    'summarize-group-discussion': 'summarize_group_discussion',
    sgd: 'summarize_group_discussion'
};

const DEFAULT_MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const DEFAULT_SIGNED_READ_URL_MINUTES = 15;
const BOOKMARK_LIMIT = 5;
const NON_STUDENT_TTL_DAYS = 10;
const UNBOOKMARK_GRACE_HOURS = 24;
const FEEDBACK_MAX_DURATION_MS = 120 * 1000;

const MODE_CONSTRAINTS = {
    read_aloud: {
        hardMaxMs: 40 * 1000,
        uiMaxSeconds: 40
    },
    repeat_sentence: {
        hardMaxMs: 15 * 1000,
        uiMaxSeconds: 15
    },
    retell_lecture: {
        hardMaxMs: 45 * 1000,
        uiMaxSeconds: 40
    },
    describe_image: {
        hardMaxMs: 40 * 1000,
        uiMaxSeconds: 40
    },
    answer_short_question: {
        hardMaxMs: 10 * 1000,
        uiMaxSeconds: 10
    },
    respond_to_situation: {
        hardMaxMs: 40 * 1000,
        uiMaxSeconds: 40
    },
    summarize_group_discussion: {
        hardMaxMs: 120 * 1000,
        uiMaxSeconds: 120
    }
};

const DEFAULT_MODE_CONSTRAINTS = {
    hardMaxMs: 60 * 1000,
    uiMaxSeconds: 60
};

function cleanString(value, maxLen) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (Number.isFinite(maxLen) && maxLen > 0) return text.slice(0, maxLen);
    return text;
}

function normalizePracticeMode(input) {
    const raw = cleanString(input, 64);
    if (!raw) return null;
    const lowered = raw.toLowerCase();
    const compact = lowered.replace(/[\s-]+/g, '_');
    const aliased = MODE_ALIASES[compact] || MODE_ALIASES[lowered] || compact;
    if (!/^[a-z0-9_]+$/.test(aliased)) return null;
    return aliased;
}

function getModeConstraints(inputMode) {
    const practiceMode = normalizePracticeMode(inputMode);
    if (!practiceMode) {
        return null;
    }
    const selected = MODE_CONSTRAINTS[practiceMode] || DEFAULT_MODE_CONSTRAINTS;
    return {
        practiceMode,
        hardMaxMs: selected.hardMaxMs,
        hardMaxSeconds: Math.floor(selected.hardMaxMs / 1000),
        uiMaxSeconds: selected.uiMaxSeconds,
        maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
        signedReadUrlMinutes: DEFAULT_SIGNED_READ_URL_MINUTES
    };
}

module.exports = {
    BOOKMARK_LIMIT,
    DEFAULT_MAX_UPLOAD_BYTES,
    DEFAULT_MODE_CONSTRAINTS,
    DEFAULT_SIGNED_READ_URL_MINUTES,
    FEEDBACK_MAX_DURATION_MS,
    NON_STUDENT_TTL_DAYS,
    UNBOOKMARK_GRACE_HOURS,
    getModeConstraints,
    normalizePracticeMode
};

