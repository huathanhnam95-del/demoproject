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
                desc: 'Plays the audio at 0.75x speed. Essential for catching fast pronunciation or complex linking sounds.',
                tags: ['listening'],
                allowedModes: ['type', 'speak', 'extended', 'watch', 'notes'],
                baseCost: 2,
                tier: 'minor',
                calibMult: 0.85
            },
            echo_loop: {
                id: 'echo_loop',
                title: 'Echo Loop',
                desc: 'Infinitely loops the last 3-5 seconds of audio. Perfect for drilling difficult phrases or mimicking intonation patterns.',
                tags: ['listening'],
                allowedModes: ['type', 'speak', 'watch', 'notes'],
                baseCost: 2,
                tier: 'medium',
                calibMult: 0.65
            },
            chunking: {
                id: 'chunking',
                title: 'Chunking',
                desc: 'Breaks long sentences into manageable phrases with manual next/prev controls. Critical for mastering complex sentence structures.',
                tags: ['listening'],
                allowedModes: ['type', 'notes'],
                baseCost: 4,
                tier: 'medium',
                calibMult: 0.65
            },
            transcript_glimpse: {
                id: 'transcript_glimpse',
                title: 'Transcript Glimpse',
                desc: 'Briefly flashes the text transcript for 2 seconds. Use it to verify a specific word you cannot quite hear.',
                tags: ['listening'],
                allowedModes: ['type', 'speak', 'watch'],
                baseCost: 8,
                tier: 'major',
                calibMult: 0.4
            },

            hint_wc: {
                id: 'hint_wc',
                title: 'Hint: Word Count',
                desc: 'Displays the exact word count or gap length. Helps you determine if you are missing a particle or a full word.',
                tags: ['writing'],
                allowedModes: ['type', 'extended', 'notes'],
                baseCost: 1,
                tier: 'minor',
                calibMult: 0.85
            },
            hint_fl: {
                id: 'hint_fl',
                title: 'Hint: First Letters',
                desc: 'Reveals the first letter of every missing word. A strong nudge to jog your memory without giving away the full answer.',
                tags: ['writing'],
                allowedModes: ['type', 'extended', 'notes'],
                baseCost: 4,
                tier: 'medium',
                calibMult: 0.65
            },
            hint_reveal: {
                id: 'hint_reveal',
                title: 'Hint: Reveal Word',
                desc: 'Instantly fills in the current missing word. Use sparingly as it has a high coin cost and significantly reduces your calibration score.',
                tags: ['writing'],
                allowedModes: ['type', 'extended', 'notes'],
                baseCost: 16,
                tier: 'reveal',
                calibMult: 0.25
            },
            punct_ghost: {
                id: 'punct_ghost',
                title: 'Punctuation Ghost',
                desc: 'Shows ghosted placeholders for punctuation marks. Vital for learning correct sentence structuring and comma usage.',
                tags: ['writing'],
                allowedModes: ['type', 'notes'],
                baseCost: 2,
                tier: 'minor',
                calibMult: 0.85
            },
            typo_shield: {
                id: 'typo_shield',
                title: 'Typo Shield',
                desc: 'Protects your streak from one minor typo or spelling error. Active for the current question only.',
                tags: ['writing'],
                allowedModes: ['type', 'notes'],
                baseCost: 5,
                tier: 'medium',
                calibMult: 0.65
            },

            dict_peek: {
                id: 'dict_peek',
                title: 'Dictionary Peek',
                desc: 'Instantly view the definition and example sentence for any selected word without leaving the question.',
                tags: ['reading'],
                allowedModes: ['extended', 'watch'],
                baseCost: 1,
                tier: 'minor',
                calibMult: 0.85
            },
            time_freeze: {
                id: 'time_freeze',
                title: 'Time Freeze',
                desc: 'Pauses the countdown timer for 10 seconds. Gives you a moment to think during timed rapid-fire challenges.',
                tags: ['reading', 'listening'],
                allowedModes: ['type', 'speak', 'extended', 'watch', 'notes'],
                baseCost: 4,
                tier: 'medium',
                calibMult: 0.65
            },
            evidence_highlight: {
                id: 'evidence_highlight',
                title: 'Evidence Highlight',
                desc: 'After answering, highlights exactly where the answer was found in the source text. Great for learning to scan passages.',
                tags: ['reading'],
                allowedModes: ['extended', 'watch'],
                baseCost: 2,
                tier: 'post',
                calibMult: 1.0
            },
            summary_scroll: {
                id: 'summary_scroll',
                title: 'Summary Scroll',
                desc: 'Generates a concise summary of the text and saves key vocabulary to your review list after the question.',
                tags: ['reading'],
                allowedModes: ['extended', 'watch'],
                baseCost: 4,
                tier: 'post',
                calibMult: 1.0
            },

            pron_rune: {
                id: 'pron_rune',
                title: 'Pronunciation Rune',
                desc: 'Display IPA guides and stress markers for the target phrase before you speak.',
                tags: ['speaking'],
                allowedModes: ['speak'],
                baseCost: 2,
                tier: 'minor',
                calibMult: 0.85
            },
            shadow_mode: {
                id: 'shadow_mode',
                title: 'Shadow Mode',
                desc: 'Plays the audio at a rhythmic pace you can follow ("shadowing"), allowing you to match native intonation and speed.',
                tags: ['speaking'],
                allowedModes: ['speak'],
                baseCost: 5,
                tier: 'medium',
                calibMult: 0.65
            },
            second_take: {
                id: 'second_take',
                title: 'Second Take',
                desc: 'Allows you to re-record your answer if you stumble. The system will automatically grade the best of your two attempts.',
                tags: ['speaking'],
                allowedModes: ['speak'],
                baseCost: 10,
                tier: 'major',
                calibMult: 0.4
            },

            streak_shield: {
                id: 'streak_shield',
                title: 'Streak Shield',
                desc: 'A one-time consumable that protects your daily streak if you miss a day of practice. Equips automatically.',
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
                desc: 'Reduces the coin cost by 10% for: Slow Audio, Echo Loop, Chunking, and Transcript Glimpse.',
                tree: 'listening',
                level: 2,
                cost: 400
            },
            audio_engineer: {
                id: 'audio_engineer',
                title: 'Audio Engineer',
                desc: 'Provides an extra 15% discount on Slow Audio and Echo Loop. Stacks with Frugal Listener.',
                tree: 'listening',
                level: 4,
                cost: 900
            },
            frugal_listener_2: {
                id: 'frugal_listener_2',
                title: 'Frugal Listener II',
                desc: 'Upgrades your discount to 20% for all Listening skills (Replaces Rank I).',
                tree: 'listening',
                level: 6,
                cost: 1600
            },
            transcript_permit: {
                id: 'transcript_permit',
                title: 'Transcript Permit',
                desc: 'Reduces the cost of Transcript Glimpse by 20% and prevents the cost from doubling as quickly when used multiple times.',
                tree: 'listening',
                level: 8,
                cost: 2400
            },
            clean_streak_saver: {
                id: 'clean_streak_saver',
                title: 'Clean Streak Saver',
                desc: 'If you get 5 correct answers in a row without help, your next Minor/Medium active skill is 50% off.',
                tree: 'listening',
                level: 10,
                cost: 3300
            },
            frugal_listener_3: {
                id: 'frugal_listener_3',
                title: 'Frugal Listener III',
                desc: 'Upgrades your discount to 30% for all Listening skills (Replaces Rank II).',
                tree: 'listening',
                level: 12,
                cost: 4500
            },

            frugal_writer_1: {
                id: 'frugal_writer_1',
                title: 'Frugal Writer I',
                desc: 'Reduces the coin cost by 10% for: Word Count, First Letters, Reveal Word, Punctuation Ghost, and Typo Shield.',
                tree: 'writing',
                level: 2,
                cost: 400
            },
            hint_kit: {
                id: 'hint_kit',
                title: 'Hint Kit',
                desc: 'Extra 20% discount on Word Count and First Letters hints (Does not apply to Reveal Word).',
                tree: 'writing',
                level: 4,
                cost: 900
            },
            frugal_writer_2: {
                id: 'frugal_writer_2',
                title: 'Frugal Writer II',
                desc: 'Upgrades your discount to 20% for all Writing skills (Replaces Rank I).',
                tree: 'writing',
                level: 6,
                cost: 1600
            },
            coupon_book: {
                id: 'coupon_book',
                title: 'Coupon Book',
                desc: 'The very first active skill you use each day is 50% off.',
                tree: 'writing',
                level: 8,
                cost: 2400
            },
            combo_coupon: {
                id: 'combo_coupon',
                title: 'Combo Coupon',
                desc: 'After 5 correct attempts with no actives, your next active skill uses is 30% off (Reset after use).',
                tree: 'writing',
                level: 10,
                cost: 3300
            },
            frugal_writer_3: {
                id: 'frugal_writer_3',
                title: 'Frugal Writer III',
                desc: 'Upgrades your discount to 30% for all Writing skills (Replaces Rank II).',
                tree: 'writing',
                level: 12,
                cost: 4500
            },

            frugal_reader_1: {
                id: 'frugal_reader_1',
                title: 'Frugal Reader I',
                desc: 'Reduces the coin cost by 10% for: Dictionary Peek, Evidence Highlight, and Summary Scroll.',
                tree: 'reading',
                level: 2,
                cost: 400
            },
            mode_license_watch: {
                id: 'mode_license_watch',
                title: 'Watch License',
                desc: 'Reduces all active skill costs by 15% specifically when using Watch Mode.',
                tree: 'reading',
                level: 4,
                cost: 900
            },
            frugal_reader_2: {
                id: 'frugal_reader_2',
                title: 'Frugal Reader II',
                desc: 'Upgrades your discount to 20% for all Reading skills (Replaces Rank I).',
                tree: 'reading',
                level: 6,
                cost: 1600
            },
            no_reveal_rebate: {
                id: 'no_reveal_rebate',
                title: 'No-Reveal Rebate',
                desc: 'If you answer with >90% accuracy and used NO major helps, you get a 25% refund on any minor skills used.',
                tree: 'reading',
                level: 8,
                cost: 2400
            },
            mode_license_extended: {
                id: 'mode_license_extended',
                title: 'Extended License',
                desc: 'Reduces all active skill costs by 15% specifically when using Extended Mode.',
                tree: 'reading',
                level: 10,
                cost: 3300
            },
            frugal_reader_3: {
                id: 'frugal_reader_3',
                title: 'Frugal Reader III',
                desc: 'Upgrades your discount to 30% for all Reading skills (Replaces Rank II).',
                tree: 'reading',
                level: 12,
                cost: 4500
            },

            frugal_speaker_1: {
                id: 'frugal_speaker_1',
                title: 'Frugal Speaker I',
                desc: 'Reduces the coin cost by 10% for: Pronunciation Rune, Shadow Mode, and Second Take.',
                tree: 'speaking',
                level: 2,
                cost: 400
            },
            breath_control: {
                id: 'breath_control',
                title: 'Breath Control',
                desc: 'Extra 15% discount on Pronunciation Rune and Shadow Mode.',
                tree: 'speaking',
                level: 4,
                cost: 900
            },
            frugal_speaker_2: {
                id: 'frugal_speaker_2',
                title: 'Frugal Speaker II',
                desc: 'Upgrades your discount to 20% for all Speaking skills (Replaces Rank I).',
                tree: 'speaking',
                level: 6,
                cost: 1600
            },
            second_take_insurance: {
                id: 'second_take_insurance',
                title: 'Second Take Insurance',
                desc: 'Reduces the cost of Second Take by 20%.',
                tree: 'speaking',
                level: 8,
                cost: 2400
            },
            mode_license_speak: {
                id: 'mode_license_speak',
                title: 'Speak License',
                desc: 'Reduces all active skill costs by 15% specifically when using Speak Mode.',
                tree: 'speaking',
                level: 10,
                cost: 3300
            },
            frugal_speaker_3: {
                id: 'frugal_speaker_3',
                title: 'Frugal Speaker III',
                desc: 'Upgrades your discount to 30% for all Speaking skills (Replaces Rank II).',
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
