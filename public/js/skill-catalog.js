/**
 * Client mirror of RPG skill catalog.
 * Server remains authoritative for balance checks and coin deductions.
 */
(function initSkillCatalog(global) {
    const SKILL_CATALOG = {
        active: {
            slow_audio: {
                id: 'slow_audio',
                title: 'Slow Audio',
                desc: 'Playback <1.0x speed (charged when used).',
                tags: ['listening'],
                allowedModes: ['type', 'speak', 'extended', 'watch', 'notes'],
                baseCost: 2,
                tier: 'minor',
                calibMult: 0.85
            },
            echo_loop: {
                id: 'echo_loop',
                title: 'Echo Loop',
                desc: 'Loop the last 3 to 5 seconds (charged per press).',
                tags: ['listening'],
                allowedModes: ['type', 'speak', 'watch', 'notes'],
                baseCost: 2,
                tier: 'medium',
                calibMult: 0.65
            },
            chunking: {
                id: 'chunking',
                title: 'Chunking',
                desc: 'Split audio into chunks with next/prev controls (charged when enabled).',
                tags: ['listening'],
                allowedModes: ['type', 'notes'],
                baseCost: 4,
                tier: 'medium',
                calibMult: 0.65
            },
            transcript_glimpse: {
                id: 'transcript_glimpse',
                title: 'Transcript Glimpse',
                desc: 'Reveal one short transcript line briefly (stacking cost per reveal).',
                tags: ['listening'],
                allowedModes: ['type', 'speak', 'watch'],
                baseCost: 8,
                tier: 'major',
                calibMult: 0.4
            },

            hint_wc: {
                id: 'hint_wc',
                title: 'Hint: Word Count',
                desc: 'Show the word or gap count (a lightweight nudge).',
                tags: ['writing'],
                allowedModes: ['type', 'extended', 'notes'],
                baseCost: 1,
                tier: 'minor',
                calibMult: 0.85
            },
            hint_fl: {
                id: 'hint_fl',
                title: 'Hint: First Letters',
                desc: 'Reveal the first letters for each word or gap.',
                tags: ['writing'],
                allowedModes: ['type', 'extended', 'notes'],
                baseCost: 4,
                tier: 'medium',
                calibMult: 0.65
            },
            hint_reveal: {
                id: 'hint_reveal',
                title: 'Hint: Reveal Word',
                desc: 'Reveal one missing word or gap answer (stacking cost, heavy assist).',
                tags: ['writing'],
                allowedModes: ['type', 'extended', 'notes'],
                baseCost: 16,
                tier: 'reveal',
                calibMult: 0.25
            },
            punct_ghost: {
                id: 'punct_ghost',
                title: 'Punctuation Ghost',
                desc: 'Show punctuation and structure placeholders (commas/periods/quotes).',
                tags: ['writing'],
                allowedModes: ['type', 'notes'],
                baseCost: 2,
                tier: 'minor',
                calibMult: 0.85
            },
            typo_shield: {
                id: 'typo_shield',
                title: 'Typo Shield',
                desc: 'Allow +1 typo forgiveness for this attempt (charged when enabled).',
                tags: ['writing'],
                allowedModes: ['type', 'notes'],
                baseCost: 5,
                tier: 'medium',
                calibMult: 0.65
            },

            dict_peek: {
                id: 'dict_peek',
                title: 'Dictionary Peek',
                desc: 'Peek a definition and example sentence (charged per lookup).',
                tags: ['reading'],
                allowedModes: ['extended', 'watch'],
                baseCost: 1,
                tier: 'minor',
                calibMult: 0.85
            },
            time_freeze: {
                id: 'time_freeze',
                title: 'Time Freeze',
                desc: 'Pause the timer briefly on timed questions (charged per use).',
                tags: ['reading', 'listening'],
                allowedModes: ['type', 'speak', 'extended', 'watch', 'notes'],
                baseCost: 4,
                tier: 'medium',
                calibMult: 0.65
            },
            evidence_highlight: {
                id: 'evidence_highlight',
                title: 'Evidence Highlight',
                desc: 'Post-answer: highlight the proof sentence(s) in the passage.',
                tags: ['reading'],
                allowedModes: ['extended', 'watch'],
                baseCost: 2,
                tier: 'post',
                calibMult: 1.0
            },
            summary_scroll: {
                id: 'summary_scroll',
                title: 'Summary Scroll',
                desc: 'Post-answer: show a summary and saved keywords to review.',
                tags: ['reading'],
                allowedModes: ['extended', 'watch'],
                baseCost: 4,
                tier: 'post',
                calibMult: 1.0
            },

            pron_rune: {
                id: 'pron_rune',
                title: 'Pronunciation Rune',
                desc: 'Show IPA/stress plus one pronunciation tip before recording.',
                tags: ['speaking'],
                allowedModes: ['speak'],
                baseCost: 2,
                tier: 'minor',
                calibMult: 0.85
            },
            shadow_mode: {
                id: 'shadow_mode',
                title: 'Shadow Mode',
                desc: 'Speak-along timing guidance (shadowing) and compare pacing.',
                tags: ['speaking'],
                allowedModes: ['speak'],
                baseCost: 5,
                tier: 'medium',
                calibMult: 0.65
            },
            second_take: {
                id: 'second_take',
                title: 'Second Take',
                desc: 'Re-record once and keep the best take (charged when used).',
                tags: ['speaking'],
                allowedModes: ['speak'],
                baseCost: 10,
                tier: 'major',
                calibMult: 0.4
            },

            streak_shield: {
                id: 'streak_shield',
                title: 'Streak Shield',
                desc: 'Prevent a streak break (meta skill; not answer help).',
                tags: [],
                allowedModes: ['type', 'speak', 'extended', 'watch', 'notes'],
                baseCost: 40,
                flatCost: true,
                tier: 'meta',
                calibMult: 1.0
            }
        },
        passive: {
            frugal_listener_1: {
                id: 'frugal_listener_1',
                title: 'Frugal Listener I',
                desc: '-10% coin cost on: slow_audio, echo_loop, chunking, transcript_glimpse.',
                tree: 'listening',
                level: 2,
                cost: 400
            },
            audio_engineer: {
                id: 'audio_engineer',
                title: 'Audio Engineer',
                desc: 'Extra -15% on: slow_audio, echo_loop (stacks; still capped).',
                tree: 'listening',
                level: 4,
                cost: 900
            },
            frugal_listener_2: {
                id: 'frugal_listener_2',
                title: 'Frugal Listener II',
                desc: 'Upgrade to -20% (replaces rank I).',
                tree: 'listening',
                level: 6,
                cost: 1600
            },
            transcript_permit: {
                id: 'transcript_permit',
                title: 'Transcript Permit',
                desc: '-20% on transcript_glimpse and reduce stacking exponent (1.5 -> 1.3).',
                tree: 'listening',
                level: 8,
                cost: 2400
            },
            clean_streak_saver: {
                id: 'clean_streak_saver',
                title: 'Clean Streak Saver',
                desc: 'After 5 correct attempts with no actives, next Minor/Medium active is 50% off (once).',
                tree: 'listening',
                level: 10,
                cost: 3300
            },
            frugal_listener_3: {
                id: 'frugal_listener_3',
                title: 'Frugal Listener III',
                desc: 'Upgrade to -30% (replaces rank II).',
                tree: 'listening',
                level: 12,
                cost: 4500
            },

            frugal_writer_1: {
                id: 'frugal_writer_1',
                title: 'Frugal Writer I',
                desc: '-10% on: hint_wc, hint_fl, hint_reveal, punct_ghost, typo_shield.',
                tree: 'writing',
                level: 2,
                cost: 400
            },
            hint_kit: {
                id: 'hint_kit',
                title: 'Hint Kit',
                desc: 'Extra -20% on hint_wc + hint_fl only (never on hint_reveal).',
                tree: 'writing',
                level: 4,
                cost: 900
            },
            frugal_writer_2: {
                id: 'frugal_writer_2',
                title: 'Frugal Writer II',
                desc: 'Upgrade to -20% (replaces rank I).',
                tree: 'writing',
                level: 6,
                cost: 1600
            },
            coupon_book: {
                id: 'coupon_book',
                title: 'Coupon Book',
                desc: 'First active used each day is 50% off.',
                tree: 'writing',
                level: 8,
                cost: 2400
            },
            combo_coupon: {
                id: 'combo_coupon',
                title: 'Combo Coupon',
                desc: 'After 5 correct attempts with no actives, next active is 30% off (once; then resets).',
                tree: 'writing',
                level: 10,
                cost: 3300
            },
            frugal_writer_3: {
                id: 'frugal_writer_3',
                title: 'Frugal Writer III',
                desc: 'Upgrade to -30% (replaces rank II).',
                tree: 'writing',
                level: 12,
                cost: 4500
            },

            frugal_reader_1: {
                id: 'frugal_reader_1',
                title: 'Frugal Reader I',
                desc: '-10% on: dict_peek, evidence_highlight, summary_scroll.',
                tree: 'reading',
                level: 2,
                cost: 400
            },
            mode_license_watch: {
                id: 'mode_license_watch',
                title: 'Watch License',
                desc: '-15% on all active costs used in watch mode.',
                tree: 'reading',
                level: 4,
                cost: 900
            },
            frugal_reader_2: {
                id: 'frugal_reader_2',
                title: 'Frugal Reader II',
                desc: 'Upgrade to -20% (replaces rank I).',
                tree: 'reading',
                level: 6,
                cost: 1600
            },
            no_reveal_rebate: {
                id: 'no_reveal_rebate',
                title: 'No-Reveal Rebate',
                desc: 'If accuracy >= 90% and no Major/Reveal/SecondTake was used, refund 25% of active spend for that attempt.',
                tree: 'reading',
                level: 8,
                cost: 2400
            },
            mode_license_extended: {
                id: 'mode_license_extended',
                title: 'Extended License',
                desc: '-15% on all active costs used in extended mode.',
                tree: 'reading',
                level: 10,
                cost: 3300
            },
            frugal_reader_3: {
                id: 'frugal_reader_3',
                title: 'Frugal Reader III',
                desc: 'Upgrade to -30% (replaces rank II).',
                tree: 'reading',
                level: 12,
                cost: 4500
            },

            frugal_speaker_1: {
                id: 'frugal_speaker_1',
                title: 'Frugal Speaker I',
                desc: '-10% on: pron_rune, shadow_mode, second_take.',
                tree: 'speaking',
                level: 2,
                cost: 400
            },
            breath_control: {
                id: 'breath_control',
                title: 'Breath Control',
                desc: 'Extra -15% on pron_rune + shadow_mode.',
                tree: 'speaking',
                level: 4,
                cost: 900
            },
            frugal_speaker_2: {
                id: 'frugal_speaker_2',
                title: 'Frugal Speaker II',
                desc: 'Upgrade to -20% (replaces rank I).',
                tree: 'speaking',
                level: 6,
                cost: 1600
            },
            second_take_insurance: {
                id: 'second_take_insurance',
                title: 'Second Take Insurance',
                desc: '-20% on second_take (still capped).',
                tree: 'speaking',
                level: 8,
                cost: 2400
            },
            mode_license_speak: {
                id: 'mode_license_speak',
                title: 'Speak License',
                desc: '-15% on all active costs used in speak mode.',
                tree: 'speaking',
                level: 10,
                cost: 3300
            },
            frugal_speaker_3: {
                id: 'frugal_speaker_3',
                title: 'Frugal Speaker III',
                desc: 'Upgrade to -30% (replaces rank II).',
                tree: 'speaking',
                level: 12,
                cost: 4500
            }
        }
    };

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

    Object.keys(SKILL_CATALOG.active).forEach((skillId) => {
        const unlockMeta = ACTIVE_UNLOCKS[skillId];
        if (unlockMeta) {
            SKILL_CATALOG.active[skillId] = {
                ...SKILL_CATALOG.active[skillId],
                unlock: unlockMeta
            };
        }
    });

    const all = { ...SKILL_CATALOG.active, ...SKILL_CATALOG.passive };

    global.SkillCatalog = {
        DATA: SKILL_CATALOG,
        ACTIVE_UNLOCKS: ACTIVE_UNLOCKS,
        getSkill(skillId) {
            return all[skillId] || null;
        },
        isActive(skillId) {
            return !!SKILL_CATALOG.active[skillId];
        },
        isPassive(skillId) {
            return !!SKILL_CATALOG.passive[skillId];
        },
        getUnlockRequirement(skillId) {
            if (SKILL_CATALOG.passive[skillId]) {
                const passive = SKILL_CATALOG.passive[skillId];
                return {
                    tree: passive.tree || null,
                    level: passive.level || null
                };
            }
            if (SKILL_CATALOG.active[skillId]) {
                const unlock = ACTIVE_UNLOCKS[skillId] || {};
                return {
                    tree: unlock.tree || null,
                    level: unlock.level || null
                };
            }
            return null;
        },
        getPurchaseCost(skillId) {
            if (SKILL_CATALOG.passive[skillId]) return SKILL_CATALOG.passive[skillId].cost || null;
            if (ACTIVE_UNLOCKS[skillId]) return ACTIVE_UNLOCKS[skillId].cost || null;
            return null;
        }
    };
})(window);
