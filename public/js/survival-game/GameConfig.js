/**
 * GameConfig.js
 * Centralized configuration for survival mode stats and constants.
 */

export const GameConfig = {
    PLAYER: {
        START_HEALTH: 100,
        SIZE: 20,
        COLOR: '#4dabf7'
    },
    ENEMIES: {
        BASE_SPEED: 50,
        BASE_HEALTH: 10,
        BASE_DAMAGE: 10,
        HEALTH_PER_CHAR: 1.5,
        MAX_ACTIVE: 80,
        TYPES: {
            DRONE: { speedMult: 1, hpMult: 1, size: 15, color: '#b24c4c' },
            RUSHER: { speedMult: 1.6, hpMult: 0.5, size: 12, color: '#c66d6d' },
            TANK: { speedMult: 0.6, hpMult: 4, size: 25, color: '#5f5f5f', dmgMult: 2 },
            TURRET: { speedMult: 0.75, hpMult: 1.4, size: 16, color: '#8a5353', dmgMult: 1.2 },
            SHOT: { speedMult: 2.2, hpMult: 0.5, size: 9, color: '#8a5353', dmgMult: 1.4 },
            SPLITTER: { speedMult: 0.9, hpMult: 1.8, size: 22, color: '#9c27b0', dmgMult: 1.5 },
            MINI_DRONE: { speedMult: 1.4, hpMult: 0.4, size: 10, color: '#ba68c8', dmgMult: 0.8 }
        },
        TRAITS: {
            ARMOR: {
                UNLOCK_WAVE: 3,
                BASE_CHANCE: 0.08,
                ARMOR_BASE: 6,
                ARMOR_PER_WAVE: 1.2
            },
            STEALTH: {
                UNLOCK_WAVE: 4,
                BASE_CHANCE: 0.1,
                REVEAL_RATE: 2.0
            },
            SHIELD: {
                UNLOCK_WAVE: 6,
                BASE_CHANCE: 0.08,
                CYCLE_TIME: 2.2,
                OPEN_FRACTION: 0.35
            },
            BUFFER: {
                UNLOCK_WAVE: 7,
                BASE_CHANCE: 0.06,
                RADIUS: 140,
                SPEED_MULT: 1.25,
                DAMAGE_MULT: 1.15
            }
        },
        TURRET: {
            STOP_DISTANCE: 260,
            SHOT_COOLDOWN: 2.2,
            SHOT_SPEED: 360
        },
        SHIELD_LINK: {
            RADIUS: 140
        },
        INTRO: {
            // Gradual enemy type introduction (waves are 20s by default).
            RUSHER_WAVE: 3,
            TURRET_WAVE: 5,
            TANK_WAVE: 7
        }
    },
    WAVES: {
        FIRST_SPAWN_DELAY: 5.0,
        INITIAL_SPAWN_TIMER: 2.0,
        MIN_SPAWN_TIMER: 0.4,
        DIFFICULTY_SCALING: 0.8,
        TIMER_SCALING: 0.12,
        TIME_SCALING: 0.04,
        WAVE_DURATION: 20
    },
    WORDS: {
        MIN_START: 4,
        MAX_START: 6,
        MIN_CAP: 6,
        MAX_CAP: 12,
        PER_WAVE: 0.3,
        PER_MINUTE: 0.6,
        WICKED_CHANCE_START: 0.05,
        WICKED_CHANCE_PER_WAVE: 0.02
    },
    EXPERIENCE: {
        BASE_XP: 10,
        XP_SCALING: 1.5
    },
    TYPING: {
        LOCK_GRACE: 0.9,
        AUTO_CLEAR_SECONDS: 2.0,
        // After an enemy dies, keep it on-screen briefly so fast typers don't get
        // punished when another weapon finishes the target mid-word.
        DEATH_GRACE_SECONDS: 0.25
    },
    BALANCE: {
        ENEMY_SPEED_MULT: 0.8,
        ENEMY_SPAWN_INTERVAL_MULT: 1.25,
        ENEMY_OVERLAP_PADDING: 10,
        ENEMY_OVERLAP_PUSH: 70
    },
    DIFFICULTY: {
        // When enabled, typing becomes case-sensitive and words can include punctuation.
        // This is implemented by strict matching in TypingSystem plus word decoration in SurvivalGame.
        STRICT_MODE: false,
        STORAGE_KEY: 'survival_strict_mode'
    },
    DIFFICULTY_CAP: {
        MAX_HUMAN_WPM: 120,
        CHARS_PER_WORD: 5,
        SAFETY_FACTOR: 0.82,
        TARGET_TTC_SECONDS: 5.2,
        MIN_TTC_SECONDS: 2.4,
        MIN_ACTIVE_ENEMIES: 5,
        MAX_ACTIVE_ENEMIES: 26,
        COMMAND_WORDS: ['BACK', 'NEXT'],
        // Backwards-compat alias (prefer GameConfig.DIFFICULTY.STRICT_MODE).
        STRICT_MODE: false
    },
    TRIALS: {
        ENABLED: true,
        DEFAULT_MODE: 'endless',
        MODE_STORAGE_KEY: 'survival_run_mode',
        TARGET_SECONDS: 30 * 60,
        BOSS_PHASE: {
            AMBIENT_SPAWN_INTERVAL_MULT: 1.7,
            DISABLE_AMBIENT_SPAWNS: false,
            DISABLE_BEAT_SPAWNS: true
        },
        SCHEDULE: [
            { timeSeconds: 5 * 60, bossId: 'gemini' },
            { timeSeconds: 12 * 60, bossId: 'cerberus' },
            { timeSeconds: 20 * 60, bossId: 'cypher' },
            { timeSeconds: 27 * 60, bossId: 'jormungandr' }
        ],
        BOSSES: {
            gemini: {
                id: 'gemini',
                name: 'Gemini',
                type: 'tank',
                color: '#7b5555',
                size: 38,
                health: 520,
                speedMult: 0.78,
                damageMult: 1.65,
                ringCount: 4,
                wordPool: ['mirror', 'double', 'twinned', 'binary'],
                traits: { shield: true }
            },
            cerberus: {
                id: 'cerberus',
                name: 'Cerberus',
                type: 'rusher',
                color: '#8a5f4d',
                size: 31,
                health: 460,
                speedMult: 1.12,
                damageMult: 1.9,
                ringCount: 3,
                wordPool: ['feral', 'howl', 'pack', 'triple']
            },
            cypher: {
                id: 'cypher',
                name: 'Cypher',
                type: 'turret',
                color: '#5e6487',
                size: 34,
                health: 620,
                speedMult: 0.72,
                damageMult: 1.8,
                ringCount: 4,
                wordPool: ['cipher', 'encode', 'signal', 'scramble'],
                traits: { buffer: true }
            },
            jormungandr: {
                id: 'jormungandr',
                name: 'Jormungandr',
                type: 'tank',
                color: '#4c6b5f',
                size: 44,
                health: 880,
                speedMult: 0.6,
                damageMult: 2.25,
                ringCount: 5,
                wordPool: ['serpent', 'venom', 'coil', 'ouroboros'],
                traits: { armor: true, shield: true }
            }
        }
    },
    COMBO: {
        CRIT_PER_HIT: 0.0005,
        CRIT_MAX: 0.05
    },
    WORD_RUSH: {
        // Rewards fast typers with bonus XP/score scaling, based on recent WPM.
        ENABLED: true,
        WINDOW_SECONDS: 6,
        START_WPM: 60,
        FULL_WPM: 120,
        MAX_MULT: 1.35,
        HUD_MIN_MULT: 1.05
    },
    ITEMS: {
        DROP_CHANCE: 0.18,
        LIFETIME: 5.0,
        WORD_MIN: 3,
        WORD_MAX: 6,
        HEALTH_DROP_THRESHOLD: 0.5,
        EFFECTS: {
            SHIELD_OVERLOAD: {
                // Radius is scaled by viewport to feel "large" on any screen size.
                RADIUS_RATIO: 0.48,
                RADIUS_MIN: 260,
                RADIUS_MAX: 520
            },
            DOUBLE_DAMAGE: {
                DURATION: 6,
                PLAYER_SPEED_MULT: 1.2
            },
            SPEED_BOOST: {
                DURATION: 8,
                PLAYER_SPEED_MULT: 1.5,
                DAMAGE_MULT: 1.25
            }
        },
        TYPES: {
            LOOT: { key: 'loot', color: '#9c7b5c' },
            SHIELD: { key: 'shield', color: '#6b7b8c' },
            FREEZE: { key: 'freeze', color: '#5d7ea6' },
            DOUBLE_DAMAGE: { key: 'double_damage', color: '#b24c4c' },
            REROLL: { key: 'reroll', color: '#7d6c8d' },
            HEALTH: { key: 'health', color: '#7a8d5a' },
            SHIELD_OVERLOAD: { key: 'shield_overload', color: '#e0a800' },
            SPEED_BOOST: { key: 'speed_boost', color: '#00d084' }
        },
        WEIGHTS: {
            loot: 2,
            shield: 2,
            freeze: 2,
            double_damage: 1,
            reroll: 1,
            health: 1,
            shield_overload: 1,
            speed_boost: 1
        }
    },
    SPLITTER: {
        UNLOCK_WAVE: 9,
        CHANCE_START: 0.06,
        CHANCE_MAX: 0.12,
        MINI_COUNT_MIN: 2,
        MINI_COUNT_MAX: 3,
        MINI_WORD_MIN: 2,
        MINI_WORD_MAX: 4,
        MINI_SCATTER: 34
    },
    OMEN: {
        STORAGE_KEY: 'survival_omen_level',
        LEVELS: {
            0: {
                spawnIntervalMult: 1,
                speedMult: 1,
                wordLenBonus: 0,
                traitChanceMult: 1,
                maxEnemiesMult: 1
            },
            1: {
                spawnIntervalMult: 0.85,
                speedMult: 1.1,
                wordLenBonus: 1,
                traitChanceMult: 1.15,
                maxEnemiesMult: 1.2
            },
            2: {
                spawnIntervalMult: 0.7,
                speedMult: 1.22,
                wordLenBonus: 2,
                traitChanceMult: 1.35,
                maxEnemiesMult: 1.5
            }
        }
    }
};

export const GameStates = {
    MENU: 'MENU',
    PLAYING: 'PLAYING',
    LEVEL_UP: 'LEVEL_UP',
    GAME_OVER: 'GAME_OVER'
};
