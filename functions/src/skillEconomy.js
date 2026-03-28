/**
 * Shared RPG skill economy helpers.
 * This module is used by purchaseSkill/useActiveSkill/submitAttempt.
 */

const { FieldValue } = require('firebase-admin/firestore');
const {
    CORE_SKILLS,
    ACTIVE_SKILLS,
    PASSIVE_SKILLS,
    CORE_PROGRESS_UNLOCKS,
    PROGRESSION_BRANCH_ORDER,
    isActiveSkill,
    isPassiveSkill,
    isRetiredSkill,
    MAX_DIFFICULTY_MULT,
    MIN_DIFFICULTY_MULT,
    MAX_TOTAL_DISCOUNT
} = require('./skillCatalog');

const FRUGAL_RANKS = {
    listening: [
        { id: 'frugal_listener_1', pct: 0.10, rank: 1 },
        { id: 'frugal_listener_2', pct: 0.20, rank: 2 },
        { id: 'frugal_listener_3', pct: 0.30, rank: 3 }
    ],
    writing: [
        { id: 'frugal_writer_1', pct: 0.10, rank: 1 },
        { id: 'frugal_writer_2', pct: 0.20, rank: 2 },
        { id: 'frugal_writer_3', pct: 0.30, rank: 3 }
    ],
    reading: [
        { id: 'frugal_reader_1', pct: 0.10, rank: 1 },
        { id: 'frugal_reader_2', pct: 0.20, rank: 2 },
        { id: 'frugal_reader_3', pct: 0.30, rank: 3 }
    ],
    speaking: [
        { id: 'frugal_speaker_1', pct: 0.10, rank: 1 },
        { id: 'frugal_speaker_2', pct: 0.20, rank: 2 },
        { id: 'frugal_speaker_3', pct: 0.30, rank: 3 }
    ]
};

const MODE_LICENSES = {
    watch: 'mode_license_watch',
    extended: 'mode_license_extended',
    rfib: 'mode_license_extended',
    speak: 'mode_license_speak'
};

const STARTER_FALLBACK_ACTIVE_SKILLS = new Set([
    'slow_audio',
    'echo_loop',
    'word_ghost',
    'first_letter_peek',
    'hint_reveal'
]);

const LEGACY_UNLOCKS = {
    slow_audio: ['slowAudioUnlocked'],
    echo_loop: ['slowAudioUnlocked', 'replayTrainerUnlocked'],
    chunking: ['chunkingModeUnlocked'],
    transcript_glimpse: [],
    hint_wc: ['hintLadderUnlocked'],
    hint_fl: ['hintLadderUnlocked'],
    hint_reveal: ['hintLadderUnlocked'],
    punct_ghost: ['hintLadderUnlocked'],
    typo_shield: ['hintLadderUnlocked'],
    dict_peek: ['vocabularyBookUnlocked'],
    time_freeze: [],
    evidence_highlight: [],
    summary_scroll: [],
    pron_rune: ['phonemeCoachUnlocked', 'pronunciationAnalyzerUnlocked'],
    shadow_mode: ['shadowingModeUnlocked'],
    second_take: ['prosodyCoachUnlocked'],
    streak_shield: []
};

function clampDifficultyMultiplier(mult) {
    const raw = Number(mult);
    if (!Number.isFinite(raw)) return MIN_DIFFICULTY_MULT;
    return Math.max(MIN_DIFFICULTY_MULT, Math.min(MAX_DIFFICULTY_MULT, raw));
}

function clamp01(value) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(1, raw));
}

function getTodayStringUTC() {
    return new Date().toISOString().slice(0, 10);
}

function calculateProgressionLevel(skillXp) {
    const points = Math.max(0, Number(skillXp) || 0);
    return Math.max(0, Math.floor(Math.sqrt(points / 25)));
}

function calculateCoreLevel(skillXp) {
    return calculateProgressionLevel(skillXp);
}

function getProgressionUnlockDefinitions() {
    return PROGRESSION_BRANCH_ORDER.flatMap((branch) => CORE_PROGRESS_UNLOCKS[branch] || []);
}

function deriveCoreProgressionUnlocks(userData = {}) {
    const skillPoints = userData.skillPoints || {};
    const unlocks = [];
    const grantedIds = new Set();

    getProgressionUnlockDefinitions()
        .slice()
        .sort((a, b) => {
            if (a.branch !== b.branch) return PROGRESSION_BRANCH_ORDER.indexOf(a.branch) - PROGRESSION_BRANCH_ORDER.indexOf(b.branch);
            if (a.xpThreshold !== b.xpThreshold) return a.xpThreshold - b.xpThreshold;
            return a.roadmapOrder - b.roadmapOrder;
        })
        .forEach((unlock) => {
            if (!unlock || !unlock.id || isRetiredSkill(unlock.id)) return;
            if (grantedIds.has(unlock.id)) return;

            const branchXp = Number(skillPoints[unlock.branch]) || 0;
            if (branchXp < (Number(unlock.xpThreshold) || 0)) return;

            if (hasUnlockedSkill(userData, unlock.id, { useStarterFallbackForActive: false })) {
                grantedIds.add(unlock.id);
                return;
            }

            unlocks.push({
                id: unlock.id,
                branch: unlock.branch,
                title: unlock.title,
                level: unlock.level,
                xpThreshold: unlock.xpThreshold,
                roadmapOrder: unlock.roadmapOrder,
                kind: unlock.kind
            });
            grantedIds.add(unlock.id);
        });

    return unlocks;
}

function applyProgressionUnlockWrites(transaction, userRef, newUnlocks = []) {
    const now = FieldValue.serverTimestamp();
    const userUpdate = {
        progressionVersion: 1,
        progressionSyncedAt: now,
        skillsUpdatedAt: now
    };

    newUnlocks.forEach((unlock) => {
        if (!unlock || !unlock.id) return;
        userUpdate[`unlockedSkills.${unlock.id}`] = true;
        if (unlock.kind === 'passive') {
            userUpdate[`skillPassives.${unlock.id}`] = {
                acquiredAt: now,
                source: 'progression'
            };
        }
    });

    transaction.update(userRef, userUpdate);
    return userUpdate;
}

function getOwnedPassiveSet(userData = {}) {
    const passiveSet = new Set();
    const unlockedSkills = userData.unlockedSkills || {};
    const skillPassives = userData.skillPassives || {};

    Object.keys(unlockedSkills).forEach((skillId) => {
        if (unlockedSkills[skillId] === true && isPassiveSkill(skillId)) {
            passiveSet.add(skillId);
        }
    });
    Object.keys(skillPassives).forEach((skillId) => {
        if (isPassiveSkill(skillId) && skillPassives[skillId]) {
            passiveSet.add(skillId);
        }
    });

    return passiveSet;
}

function hasUnlockedSkill(userData = {}, skillId, options = {}) {
    const { useStarterFallbackForActive = false } = options;

    const unlockedSkills = userData.unlockedSkills || {};
    if (unlockedSkills[skillId] === true) {
        return true;
    }

    const skillPassives = userData.skillPassives || {};
    if (isPassiveSkill(skillId) && skillPassives[skillId]) {
        return true;
    }

    const legacyFields = LEGACY_UNLOCKS[skillId] || [];
    if (legacyFields.some((field) => userData[field] === true)) {
        return true;
    }

    if (isActiveSkill(skillId) && useStarterFallbackForActive) {
        const hasInventoryMap = userData.unlockedSkills && Object.keys(userData.unlockedSkills).length > 0;
        if (!hasInventoryMap && STARTER_FALLBACK_ACTIVE_SKILLS.has(skillId)) {
            return true;
        }
    }

    return false;
}

function normalizeEconomyState(economyState = {}) {
    const today = getTodayStringUTC();
    const rawDaily = economyState.daily || {};
    const daily = {
        date: rawDaily.date === today ? today : today,
        couponBookUsed: rawDaily.date === today ? !!rawDaily.couponBookUsed : false
    };

    return {
        daily,
        noAssistStreak: {
            count: Math.max(0, Number(economyState?.noAssistStreak?.count) || 0),
            updatedAt: economyState?.noAssistStreak?.updatedAt || null
        },
        discountTokens: {
            minorMedium50: Math.max(0, Number(economyState?.discountTokens?.minorMedium50) || 0),
            nextActive30: Math.max(0, Number(economyState?.discountTokens?.nextActive30) || 0)
        }
    };
}

function getBestFrugalDiscount(passives, skillTags = []) {
    let best = 0;
    let bestId = null;

    skillTags.forEach((tree) => {
        const rankList = FRUGAL_RANKS[tree] || [];
        rankList.forEach((rank) => {
            if (passives.has(rank.id) && rank.pct > best) {
                best = rank.pct;
                bestId = rank.id;
            }
        });
    });

    return { pct: best, source: bestId };
}

function shouldChargeForPolicy(costPolicy, priorChargedUses) {
    const singleChargePolicies = new Set(['per_attempt', 'per_prompt', 'per_passage']);
    if (!singleChargePolicies.has(costPolicy)) return true;
    return priorChargedUses === 0;
}

function buildDiscountPlan({
    userData,
    skillId,
    mode,
    skillTier,
    skillTags,
    economyState
}) {
    const passives = getOwnedPassiveSet(userData);
    const breakdown = [];
    let discountPct = 0;
    let stackingExponentOverride = null;
    const tokenConsumptions = {
        couponBook: false,
        minorMedium50: false,
        nextActive30: false
    };

    // Frugal family (best matching tree tag)
    const frugal = getBestFrugalDiscount(passives, skillTags || []);
    if (frugal.pct > 0) {
        discountPct += frugal.pct;
        breakdown.push({ id: frugal.source, pct: frugal.pct, type: 'frugal' });
    }

    // Mode license
    const modeLicenseId = MODE_LICENSES[mode];
    if (modeLicenseId && passives.has(modeLicenseId)) {
        discountPct += 0.15;
        breakdown.push({ id: modeLicenseId, pct: 0.15, type: 'mode_license' });
    }

    // Skill-specific passives
    if ((skillId === 'slow_audio' || skillId === 'echo_loop') && passives.has('audio_engineer')) {
        discountPct += 0.15;
        breakdown.push({ id: 'audio_engineer', pct: 0.15, type: 'skill_specific' });
    }
    if ((skillId === 'word_ghost' || skillId === 'first_letter_peek' || skillId === 'hint_reveal') && passives.has('hint_kit')) {
        discountPct += 0.20;
        breakdown.push({ id: 'hint_kit', pct: 0.20, type: 'skill_specific' });
    }
    if (skillId === 'transcript_glimpse' && passives.has('transcript_permit')) {
        discountPct += 0.20;
        stackingExponentOverride = 1.3;
        breakdown.push({ id: 'transcript_permit', pct: 0.20, type: 'skill_specific' });
    }
    if ((skillId === 'pron_rune' || skillId === 'shadow_mode') && passives.has('breath_control')) {
        discountPct += 0.15;
        breakdown.push({ id: 'breath_control', pct: 0.15, type: 'skill_specific' });
    }
    if (skillId === 'second_take' && passives.has('second_take_insurance')) {
        discountPct += 0.20;
        breakdown.push({ id: 'second_take_insurance', pct: 0.20, type: 'skill_specific' });
    }

    // Stateful passives (token/daily)
    if (passives.has('coupon_book') && !economyState.daily.couponBookUsed) {
        const room = Math.max(0, MAX_TOTAL_DISCOUNT - discountPct);
        const applied = Math.min(0.50, room);
        if (applied > 0) {
            discountPct += applied;
            tokenConsumptions.couponBook = true;
            breakdown.push({ id: 'coupon_book', pct: applied, type: 'daily_token' });
        }
    }

    if (
        passives.has('clean_streak_saver') &&
        economyState.discountTokens.minorMedium50 > 0 &&
        (skillTier === 'minor' || skillTier === 'medium')
    ) {
        const room = Math.max(0, MAX_TOTAL_DISCOUNT - discountPct);
        const applied = Math.min(0.50, room);
        if (applied > 0) {
            discountPct += applied;
            tokenConsumptions.minorMedium50 = true;
            breakdown.push({ id: 'clean_streak_saver_token', pct: applied, type: 'streak_token' });
        }
    }

    if (passives.has('combo_coupon') && economyState.discountTokens.nextActive30 > 0) {
        const room = Math.max(0, MAX_TOTAL_DISCOUNT - discountPct);
        const applied = Math.min(0.30, room);
        if (applied > 0) {
            discountPct += applied;
            tokenConsumptions.nextActive30 = true;
            breakdown.push({ id: 'combo_coupon_token', pct: applied, type: 'streak_token' });
        }
    }

    discountPct = Math.min(MAX_TOTAL_DISCOUNT, clamp01(discountPct));

    return {
        discountPct,
        breakdown,
        stackingExponentOverride,
        tokenConsumptions
    };
}

function applyDiscountConsumptions(economyState, tokenConsumptions = {}) {
    const nextState = normalizeEconomyState(economyState);

    if (tokenConsumptions.couponBook) {
        nextState.daily.couponBookUsed = true;
    }
    if (tokenConsumptions.minorMedium50) {
        nextState.discountTokens.minorMedium50 = Math.max(0, nextState.discountTokens.minorMedium50 - 1);
    }
    if (tokenConsumptions.nextActive30) {
        nextState.discountTokens.nextActive30 = Math.max(0, nextState.discountTokens.nextActive30 - 1);
    }

    return nextState;
}

function computeAttemptCalibMult(skillsUsed = []) {
    const entries = Array.isArray(skillsUsed) ? skillsUsed : [];
    if (entries.length === 0) return 1.0;

    const mins = entries
        .map((entry) => Number(entry.calibMult))
        .filter((value) => Number.isFinite(value));

    if (mins.length === 0) return 1.0;
    const minVal = Math.min(...mins);
    return Math.max(0.25, Math.min(1.0, minVal));
}

function isUnassistedAttempt(assistData) {
    if (!assistData) return true;
    const skillsUsed = Array.isArray(assistData.skillsUsed) ? assistData.skillsUsed : [];
    return skillsUsed.length === 0;
}

function updateNoAssistStreakTokens(userData, assistData, accuracy) {
    const passives = getOwnedPassiveSet(userData);
    const nextEconomy = normalizeEconomyState(userData.economyState || {});

    const accuracyOk = Number(accuracy) >= 0.9;
    if (isUnassistedAttempt(assistData) && accuracyOk) {
        nextEconomy.noAssistStreak.count += 1;
    } else if (!isUnassistedAttempt(assistData)) {
        nextEconomy.noAssistStreak.count = 0;
    }

    while (nextEconomy.noAssistStreak.count >= 5) {
        if (passives.has('combo_coupon')) {
            nextEconomy.discountTokens.nextActive30 += 1;
        }
        if (passives.has('clean_streak_saver')) {
            nextEconomy.discountTokens.minorMedium50 += 1;
        }
        nextEconomy.noAssistStreak.count -= 5;
    }

    nextEconomy.noAssistStreak.updatedAt = Date.now();
    return nextEconomy;
}

function shouldApplyNoRevealRebate(userData, assistData, accuracy) {
    if (!assistData) return false;
    const passives = getOwnedPassiveSet(userData);
    if (!passives.has('no_reveal_rebate')) return false;
    if (Number(accuracy) < 0.9) return false;

    const totalCost = Number(assistData.totalCost) || 0;
    if (totalCost <= 0) return false;

    const used = Array.isArray(assistData.skillsUsed) ? assistData.skillsUsed : [];
    const hasDisallowedTier = used.some((entry) => {
        const tier = String(entry.tier || '').toLowerCase();
        return tier === 'major' || tier === 'reveal' || entry.skillId === 'second_take';
    });
    if (hasDisallowedTier) return false;

    if (assistData.refundIssued === true) return false;
    return true;
}

module.exports = {
    CORE_SKILLS,
    ACTIVE_SKILLS,
    PASSIVE_SKILLS,
    calculateProgressionLevel,
    isActiveSkill,
    isPassiveSkill,
    clampDifficultyMultiplier,
    calculateCoreLevel,
    getProgressionUnlockDefinitions,
    deriveCoreProgressionUnlocks,
    applyProgressionUnlockWrites,
    getOwnedPassiveSet,
    hasUnlockedSkill,
    normalizeEconomyState,
    shouldChargeForPolicy,
    buildDiscountPlan,
    applyDiscountConsumptions,
    computeAttemptCalibMult,
    updateNoAssistStreakTokens,
    shouldApplyNoRevealRebate
};
