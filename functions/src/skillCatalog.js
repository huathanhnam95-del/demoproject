/**
 * Canonical RPG skill catalog (server authoritative).
 * This module defines active and passive skills, unlock requirements,
 * costs, calibration multipliers, and discount behavior metadata.
 */

const MAX_DIFFICULTY_MULT = 2.5;
const MIN_DIFFICULTY_MULT = 1.0;
const MAX_TOTAL_DISCOUNT = 0.5;
const DEFAULT_STACK_EXPONENT = 1.5;

const CORE_SKILLS = ['listening', 'writing', 'reading', 'speaking'];
const SUPPORTED_MODES = ['type', 'speak', 'extended', 'watch', 'notes', 'writingChallenge', 'srs'];

const ACTIVE_SKILLS = {
    slow_audio: {
        id: 'slow_audio',
        type: 'active',
        title: 'Slow Audio',
        tags: ['listening'],
        allowedModes: ['type', 'speak', 'extended', 'watch', 'notes'],
        costPolicy: 'per_attempt',
        baseCost: 2,
        tier: 'minor',
        calibMult: 0.85
    },
    echo_loop: {
        id: 'echo_loop',
        type: 'active',
        title: 'Echo Loop',
        tags: ['listening'],
        allowedModes: ['type', 'speak', 'watch', 'notes'],
        costPolicy: 'per_enable',
        baseCost: 2,
        tier: 'medium',
        calibMult: 0.65
    },
    chunking: {
        id: 'chunking',
        type: 'active',
        title: 'Chunking',
        tags: ['listening'],
        allowedModes: ['type', 'notes'],
        costPolicy: 'per_attempt',
        baseCost: 4,
        tier: 'medium',
        calibMult: 0.65
    },
    transcript_glimpse: {
        id: 'transcript_glimpse',
        type: 'active',
        title: 'Transcript Glimpse',
        tags: ['listening'],
        allowedModes: ['type', 'speak', 'watch'],
        costPolicy: 'per_use',
        baseCost: 8,
        stacking: { enabled: true, exponent: 1.5 },
        tier: 'major',
        calibMult: 0.4
    },
    hint_wc: {
        id: 'hint_wc',
        type: 'active',
        title: 'Hint: Word Count',
        tags: ['writing'],
        allowedModes: ['type', 'extended', 'notes'],
        costPolicy: 'per_use',
        baseCost: 1,
        tier: 'minor',
        calibMult: 0.85
    },
    hint_fl: {
        id: 'hint_fl',
        type: 'active',
        title: 'Hint: First Letters',
        tags: ['writing'],
        allowedModes: ['type', 'extended', 'notes'],
        costPolicy: 'per_use',
        baseCost: 4,
        tier: 'medium',
        calibMult: 0.65
    },
    hint_reveal: {
        id: 'hint_reveal',
        type: 'active',
        title: 'Hint: Reveal Word',
        tags: ['writing'],
        allowedModes: ['type', 'extended', 'notes'],
        costPolicy: 'per_token',
        baseCost: 16,
        stacking: { enabled: true, exponent: 1.5 },
        tier: 'reveal',
        calibMult: 0.25
    },
    punct_ghost: {
        id: 'punct_ghost',
        type: 'active',
        title: 'Punctuation Ghost',
        tags: ['writing'],
        allowedModes: ['type', 'notes'],
        costPolicy: 'per_attempt',
        baseCost: 2,
        tier: 'minor',
        calibMult: 0.85
    },
    typo_shield: {
        id: 'typo_shield',
        type: 'active',
        title: 'Typo Shield',
        tags: ['writing'],
        allowedModes: ['type', 'notes'],
        costPolicy: 'per_attempt',
        baseCost: 5,
        tier: 'medium',
        calibMult: 0.65
    },
    dict_peek: {
        id: 'dict_peek',
        type: 'active',
        title: 'Dictionary Peek',
        tags: ['reading'],
        allowedModes: ['extended', 'watch'],
        costPolicy: 'per_use',
        baseCost: 1,
        tier: 'minor',
        calibMult: 0.85
    },
    time_freeze: {
        id: 'time_freeze',
        type: 'active',
        title: 'Time Freeze',
        tags: ['reading', 'listening'],
        allowedModes: ['type', 'speak', 'extended', 'watch', 'notes'],
        costPolicy: 'per_use',
        baseCost: 4,
        tier: 'medium',
        calibMult: 0.65
    },
    evidence_highlight: {
        id: 'evidence_highlight',
        type: 'active',
        title: 'Evidence Highlight',
        tags: ['reading'],
        allowedModes: ['extended', 'watch'],
        costPolicy: 'per_use',
        baseCost: 2,
        tier: 'post',
        calibMult: 1.0
    },
    summary_scroll: {
        id: 'summary_scroll',
        type: 'active',
        title: 'Summary Scroll',
        tags: ['reading'],
        allowedModes: ['extended', 'watch'],
        costPolicy: 'per_passage',
        baseCost: 4,
        tier: 'post',
        calibMult: 1.0
    },
    pron_rune: {
        id: 'pron_rune',
        type: 'active',
        title: 'Pronunciation Rune',
        tags: ['speaking'],
        allowedModes: ['speak'],
        costPolicy: 'per_prompt',
        baseCost: 2,
        tier: 'minor',
        calibMult: 0.85
    },
    shadow_mode: {
        id: 'shadow_mode',
        type: 'active',
        title: 'Shadow Mode',
        tags: ['speaking'],
        allowedModes: ['speak'],
        costPolicy: 'per_attempt',
        baseCost: 5,
        tier: 'medium',
        calibMult: 0.65
    },
    second_take: {
        id: 'second_take',
        type: 'active',
        title: 'Second Take',
        tags: ['speaking'],
        allowedModes: ['speak'],
        costPolicy: 'per_attempt',
        baseCost: 10,
        tier: 'major',
        calibMult: 0.4
    },
    streak_shield: {
        id: 'streak_shield',
        type: 'active',
        title: 'Streak Shield',
        tags: [],
        allowedModes: ['type', 'speak', 'extended', 'watch', 'notes'],
        costPolicy: 'per_use',
        baseCost: 40,
        flatCost: true,
        tier: 'meta',
        calibMult: 1.0
    }
};

/**
 * One-time unlock requirements/costs for active skills.
 * Per-use costs remain in ACTIVE_SKILLS.baseCost and are charged by useActiveSkill.
 */
const ACTIVE_UNLOCKS = {
    slow_audio: { tree: 'listening', level: 1, cost: 120 },
    echo_loop: { tree: 'listening', level: 2, cost: 200 },
    chunking: { tree: 'listening', level: 4, cost: 350 },
    transcript_glimpse: { tree: 'listening', level: 6, cost: 700 },

    hint_wc: { tree: 'writing', level: 1, cost: 100 },
    hint_fl: { tree: 'writing', level: 2, cost: 180 },
    punct_ghost: { tree: 'writing', level: 3, cost: 220 },
    hint_reveal: { tree: 'writing', level: 4, cost: 600 },
    typo_shield: { tree: 'writing', level: 5, cost: 420 },

    dict_peek: { tree: 'reading', level: 1, cost: 90 },
    evidence_highlight: { tree: 'reading', level: 2, cost: 160 },
    summary_scroll: { tree: 'reading', level: 4, cost: 380 },
    time_freeze: { tree: 'reading', level: 5, cost: 500 },

    pron_rune: { tree: 'speaking', level: 1, cost: 100 },
    shadow_mode: { tree: 'speaking', level: 3, cost: 260 },
    second_take: { tree: 'speaking', level: 6, cost: 650 },

    streak_shield: { tree: 'listening', level: 6, cost: 900 }
};

const PASSIVE_SKILLS = {
    frugal_listener_1: { id: 'frugal_listener_1', type: 'passive', tree: 'listening', level: 2, cost: 400 },
    audio_engineer: { id: 'audio_engineer', type: 'passive', tree: 'listening', level: 4, cost: 900 },
    frugal_listener_2: { id: 'frugal_listener_2', type: 'passive', tree: 'listening', level: 6, cost: 1600 },
    transcript_permit: { id: 'transcript_permit', type: 'passive', tree: 'listening', level: 8, cost: 2400 },
    clean_streak_saver: { id: 'clean_streak_saver', type: 'passive', tree: 'listening', level: 10, cost: 3300 },
    frugal_listener_3: { id: 'frugal_listener_3', type: 'passive', tree: 'listening', level: 12, cost: 4500 },

    frugal_writer_1: { id: 'frugal_writer_1', type: 'passive', tree: 'writing', level: 2, cost: 400 },
    hint_kit: { id: 'hint_kit', type: 'passive', tree: 'writing', level: 4, cost: 900 },
    frugal_writer_2: { id: 'frugal_writer_2', type: 'passive', tree: 'writing', level: 6, cost: 1600 },
    coupon_book: { id: 'coupon_book', type: 'passive', tree: 'writing', level: 8, cost: 2400 },
    combo_coupon: { id: 'combo_coupon', type: 'passive', tree: 'writing', level: 10, cost: 3300 },
    frugal_writer_3: { id: 'frugal_writer_3', type: 'passive', tree: 'writing', level: 12, cost: 4500 },

    frugal_reader_1: { id: 'frugal_reader_1', type: 'passive', tree: 'reading', level: 2, cost: 400 },
    mode_license_watch: { id: 'mode_license_watch', type: 'passive', tree: 'reading', level: 4, cost: 900 },
    frugal_reader_2: { id: 'frugal_reader_2', type: 'passive', tree: 'reading', level: 6, cost: 1600 },
    no_reveal_rebate: { id: 'no_reveal_rebate', type: 'passive', tree: 'reading', level: 8, cost: 2400 },
    mode_license_extended: { id: 'mode_license_extended', type: 'passive', tree: 'reading', level: 10, cost: 3300 },
    frugal_reader_3: { id: 'frugal_reader_3', type: 'passive', tree: 'reading', level: 12, cost: 4500 },

    frugal_speaker_1: { id: 'frugal_speaker_1', type: 'passive', tree: 'speaking', level: 2, cost: 400 },
    breath_control: { id: 'breath_control', type: 'passive', tree: 'speaking', level: 4, cost: 900 },
    frugal_speaker_2: { id: 'frugal_speaker_2', type: 'passive', tree: 'speaking', level: 6, cost: 1600 },
    second_take_insurance: { id: 'second_take_insurance', type: 'passive', tree: 'speaking', level: 8, cost: 2400 },
    mode_license_speak: { id: 'mode_license_speak', type: 'passive', tree: 'speaking', level: 10, cost: 3300 },
    frugal_speaker_3: { id: 'frugal_speaker_3', type: 'passive', tree: 'speaking', level: 12, cost: 4500 }
};

const ALL_SKILLS = {
    ...ACTIVE_SKILLS,
    ...PASSIVE_SKILLS
};

function getSkillById(skillId) {
    return ALL_SKILLS[skillId] || null;
}

function isActiveSkill(skillId) {
    return !!ACTIVE_SKILLS[skillId];
}

function isPassiveSkill(skillId) {
    return !!PASSIVE_SKILLS[skillId];
}

function isModeAllowedForSkill(skillId, mode) {
    const skill = getSkillById(skillId);
    if (!skill || !skill.allowedModes) return true;
    return skill.allowedModes.includes(mode);
}

function getTreeSkillLevelRequirement(skillId) {
    const skill = getSkillById(skillId);
    if (!skill) return null;

    if (isActiveSkill(skillId)) {
        const unlockMeta = ACTIVE_UNLOCKS[skillId] || {};
        return {
            tree: unlockMeta.tree || null,
            level: unlockMeta.level || null
        };
    }

    return {
        tree: skill.tree || null,
        level: skill.level || null
    };
}

function getSkillCost(skillId) {
    const skill = getSkillById(skillId);
    if (!skill) return null;

    if (isActiveSkill(skillId)) {
        const unlockMeta = ACTIVE_UNLOCKS[skillId] || {};
        return unlockMeta.cost || null;
    }

    return skill.cost || null;
}

function getActiveUseCostBase(skillId) {
    const skill = getSkillById(skillId);
    if (!skill || !isActiveSkill(skillId)) return null;
    return skill.baseCost || null;
}

module.exports = {
    MAX_DIFFICULTY_MULT,
    MIN_DIFFICULTY_MULT,
    MAX_TOTAL_DISCOUNT,
    DEFAULT_STACK_EXPONENT,
    CORE_SKILLS,
    SUPPORTED_MODES,
    ACTIVE_SKILLS,
    ACTIVE_UNLOCKS,
    PASSIVE_SKILLS,
    ALL_SKILLS,
    getSkillById,
    isActiveSkill,
    isPassiveSkill,
    isModeAllowedForSkill,
    getTreeSkillLevelRequirement,
    getSkillCost,
    getActiveUseCostBase
};
