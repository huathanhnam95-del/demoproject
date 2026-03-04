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
        desc: 'Play audio at 0.75x or 0.5x speed to help parse difficult phonemes.',
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
        desc: 'Infinitely loop the last 3-5 seconds of audio to isolate trouble spots.',
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
        desc: 'Break complex sentences into discrete semantic chunks and play them separately.',
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
        desc: 'Briefly flash the transcript for 2 seconds to verify a specific word.',
        tags: ['listening'],
        allowedModes: ['type', 'speak', 'watch'],
        costPolicy: 'per_use',
        baseCost: 8,
        stacking: { enabled: true, exponent: 1.5 },
        tier: 'major',
        calibMult: 0.4
    },
    word_ghost: {
        id: 'word_ghost',
        type: 'active',
        title: 'Word Ghost',
        desc: 'See placeholder blanks for every missing word to reveal sentence structure.',
        tags: ['writing'],
        allowedModes: ['type', 'extended', 'notes'],
        costPolicy: 'per_use',
        baseCost: 15,
        tier: 'minor',
        calibMult: 0.85
    },
    first_letter_peek: {
        id: 'first_letter_peek',
        type: 'active',
        title: 'First-Letter Peek',
        desc: 'Flash the first letter of missing words for a brief hint (0.8s).',
        tags: ['writing'],
        allowedModes: ['type', 'extended', 'notes'],
        costPolicy: 'per_use',
        baseCost: 25,
        tier: 'medium',
        calibMult: 0.65
    },
    hint_reveal: {
        id: 'hint_reveal',
        type: 'active',
        title: 'Hint: Reveal Word',
        desc: 'Instantly reveal a missing word. Heavily penalizes calibration score.',
        tags: ['writing'],
        allowedModes: ['type', 'extended', 'notes'],
        costPolicy: 'per_token',
        baseCost: 16,
        stacking: { enabled: true, exponent: 1.5 },
        tier: 'reveal',
        calibMult: 0.25
    },
    typo_shield: {
        id: 'typo_shield',
        type: 'active',
        title: 'Typo Shield',
        desc: 'Automatically forgive exactly 1 typo (1 missing + 1 extra word) per task.',
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
        desc: 'Tap any word to view its definition, translations, and examples.',
        tags: ['reading'],
        allowedModes: ['extended', 'watch'],
        costPolicy: 'per_use',
        baseCost: 1,
        tier: 'minor',
        calibMult: 0.85
    },

    evidence_highlight: {
        id: 'evidence_highlight',
        type: 'active',
        title: 'Evidence Highlight',
        desc: 'Highlights where the answer was found in the source text (after answering).',
        tags: ['reading'],
        allowedModes: ['extended', 'watch'],
        costPolicy: 'per_use',
        baseCost: 2,
        tier: 'post',
        comingSoon: true,
        calibMult: 1.0
    },
    summary_scroll: {
        id: 'summary_scroll',
        type: 'active',
        title: 'Summary Scroll',
        desc: 'View an AI-generated summary and vocabulary extraction of the passage (after answering).',
        tags: ['reading'],
        allowedModes: ['extended', 'watch'],
        costPolicy: 'per_passage',
        baseCost: 4,
        tier: 'post',
        comingSoon: true,
        calibMult: 1.0
    },
    pron_rune: {
        id: 'pron_rune',
        type: 'active',
        title: 'Pronunciation Rune',
        desc: 'View IPA phonetic guides and stress markers for key words before you speak.',
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
        desc: 'Shadow along with the audio playback playing at 0.6x speed.',
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
        desc: 'Re-record after a failed speaking check. The system grades your best attempt.',
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
        desc: 'Consumable that protects your daily streak if a day is missed.',
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

    word_ghost: { tree: 'writing', level: 1, cost: 100 },
    first_letter_peek: { tree: 'writing', level: 2, cost: 180 },
    hint_reveal: { tree: 'writing', level: 4, cost: 600 },
    typo_shield: { tree: 'writing', level: 5, cost: 420 },

    dict_peek: { tree: 'reading', level: 1, cost: 90 },
    evidence_highlight: { tree: 'reading', level: 2, cost: 160 },
    summary_scroll: { tree: 'reading', level: 4, cost: 380 },

    pron_rune: { tree: 'speaking', level: 1, cost: 100 },
    shadow_mode: { tree: 'speaking', level: 3, cost: 260 },
    second_take: { tree: 'speaking', level: 6, cost: 650 },

    streak_shield: { tree: 'listening', level: 6, cost: 900 }
};

const PASSIVE_SKILLS = {
    length_filter: { id: 'length_filter', type: 'passive', title: 'Length Filter', desc: 'Unlock the ability to filter practice tasks by length (short/medium/long).', tree: 'listening', level: 1, cost: 80 },
    difficulty_filter: { id: 'difficulty_filter', type: 'passive', title: 'Difficulty Filter', desc: 'Unlock the ability to select specific difficulty tiers.', tree: 'listening', level: 1, cost: 120 },
    frugal_listener_1: { id: 'frugal_listener_1', type: 'passive', title: 'Frugal Listener I', desc: 'Reduces the cost of all active Listening skills by 10%.', tree: 'listening', level: 2, cost: 400 },
    audio_engineer: { id: 'audio_engineer', type: 'passive', title: 'Audio Engineer', desc: 'Increases the discount on Slow Audio and Echo Loop by an additional 15%.', tree: 'listening', level: 4, cost: 900 },
    frugal_listener_2: { id: 'frugal_listener_2', type: 'passive', title: 'Frugal Listener II', desc: 'Upgrades the Listening active skill discount to 20%.', tree: 'listening', level: 6, cost: 1600 },
    transcript_permit: { id: 'transcript_permit', type: 'passive', title: 'Transcript Permit', desc: 'Reduces Transcript Glimpse cost by 20% and slows cost escalation.', tree: 'listening', level: 8, cost: 2400 },
    clean_streak_saver: { id: 'clean_streak_saver', type: 'passive', title: 'Clean Streak Saver', desc: 'Answer 5 correctly unassisted to get 50% off your next minor/medium active.', tree: 'listening', level: 10, cost: 3300 },
    frugal_listener_3: { id: 'frugal_listener_3', type: 'passive', title: 'Frugal Listener III', desc: 'Upgrades the Listening active skill discount to 30%.', tree: 'listening', level: 12, cost: 4500 },

    frugal_writer_1: { id: 'frugal_writer_1', type: 'passive', title: 'Frugal Writer I', desc: 'Reduces the cost of all active Writing skills by 10%.', tree: 'writing', level: 2, cost: 400 },
    hint_kit: { id: 'hint_kit', type: 'passive', title: 'Hint Kit', desc: 'Increases the discount on Word Ghost and First-Letter Peek by an additional 20%.', tree: 'writing', level: 4, cost: 900 },
    frugal_writer_2: { id: 'frugal_writer_2', type: 'passive', title: 'Frugal Writer II', desc: 'Upgrades the Writing active skill discount to 20%.', tree: 'writing', level: 6, cost: 1600 },
    coupon_book: { id: 'coupon_book', type: 'passive', title: 'Coupon Book', desc: 'Your first active skill use each day is 50% off. Cross-tree perk.', tree: 'writing', level: 8, cost: 2400 },
    combo_coupon: { id: 'combo_coupon', type: 'passive', title: 'Combo Coupon', desc: 'Answer 5 correctly unassisted to get 30% off any active skill.', tree: 'writing', level: 10, cost: 3300 },
    frugal_writer_3: { id: 'frugal_writer_3', type: 'passive', title: 'Frugal Writer III', desc: 'Upgrades the Writing active skill discount to 30%.', tree: 'writing', level: 12, cost: 4500 },

    frugal_reader_1: { id: 'frugal_reader_1', type: 'passive', title: 'Frugal Reader I', desc: 'Reduces the cost of all active Reading skills by 10%.', tree: 'reading', level: 2, cost: 400 },
    mode_license_watch: { id: 'mode_license_watch', type: 'passive', title: 'Watch License', desc: 'Unlocks access to the Watch (Video) practice mode and gives -15% cost on Watch actives.', tree: 'reading', level: 4, cost: 900 },
    frugal_reader_2: { id: 'frugal_reader_2', type: 'passive', title: 'Frugal Reader II', desc: 'Upgrades the Reading active skill discount to 20%.', tree: 'reading', level: 6, cost: 1600 },
    no_reveal_rebate: { id: 'no_reveal_rebate', type: 'passive', title: 'No-Reveal Rebate', desc: 'Score >90% without major hints to get a 25% refund on minor skills.', tree: 'reading', level: 8, cost: 2400 },
    mode_license_extended: { id: 'mode_license_extended', type: 'passive', title: 'Extended License', desc: 'Unlocks access to the Extended Reading practice mode.', tree: 'reading', level: 10, cost: 3300 },
    frugal_reader_3: { id: 'frugal_reader_3', type: 'passive', title: 'Frugal Reader III', desc: 'Upgrades the Reading active skill discount to 30%.', tree: 'reading', level: 12, cost: 4500 },

    frugal_speaker_1: { id: 'frugal_speaker_1', type: 'passive', title: 'Frugal Speaker I', desc: 'Reduces the cost of all active Speaking skills by 10%.', tree: 'speaking', level: 2, cost: 400 },
    breath_control: { id: 'breath_control', type: 'passive', title: 'Breath Control', desc: 'Increases the discount on Pronunciation Rune and Shadow Mode by 15%.', tree: 'speaking', level: 4, cost: 900 },
    frugal_speaker_2: { id: 'frugal_speaker_2', type: 'passive', title: 'Frugal Speaker II', desc: 'Upgrades the Speaking active skill discount to 20%.', tree: 'speaking', level: 6, cost: 1600 },
    second_take_insurance: { id: 'second_take_insurance', type: 'passive', title: 'Take Insurance', desc: 'Reduces the cost of Second Take by 20%.', tree: 'speaking', level: 8, cost: 2400 },
    mode_license_speak: { id: 'mode_license_speak', type: 'passive', title: 'Speak License', desc: 'Unlocks access to the Speak practice mode and gives -15% cost on Speak actives.', tree: 'speaking', level: 10, cost: 3300 },
    frugal_speaker_3: { id: 'frugal_speaker_3', type: 'passive', title: 'Frugal Speaker III', desc: 'Upgrades the Speaking active skill discount to 30%.', tree: 'speaking', level: 12, cost: 4500 }
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
