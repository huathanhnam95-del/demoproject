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
            SHOT: { speedMult: 2.2, hpMult: 0.5, size: 9, color: '#8a5353', dmgMult: 1.4 }
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
        AUTO_CLEAR_SECONDS: 2.0
    },
    COMBO: {
        CRIT_PER_HIT: 0.0005,
        CRIT_MAX: 0.05
    },
    ITEMS: {
        DROP_CHANCE: 0.18,
        LIFETIME: 5.0,
        WORD_MIN: 3,
        WORD_MAX: 6,
        HEALTH_DROP_THRESHOLD: 0.5,
        TYPES: {
            LOOT: { key: 'loot', color: '#9c7b5c' },
            SHIELD: { key: 'shield', color: '#6b7b8c' },
            FREEZE: { key: 'freeze', color: '#5d7ea6' },
            DOUBLE_DAMAGE: { key: 'double_damage', color: '#b24c4c' },
            REROLL: { key: 'reroll', color: '#7d6c8d' },
            HEALTH: { key: 'health', color: '#7a8d5a' }
        },
        WEIGHTS: {
            loot: 2,
            shield: 2,
            freeze: 2,
            double_damage: 1,
            reroll: 1,
            health: 1
        }
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
