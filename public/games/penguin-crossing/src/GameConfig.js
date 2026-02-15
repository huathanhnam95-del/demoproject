/**
 * GameConfig.js — Central configuration for Penguin Crossing.
 *
 * Visual Overhaul: Classic Arctic 2.5D
 */

export const GameState = Object.freeze({
    IDLE: 'IDLE',
    PLAYING: 'PLAYING',
    GAME_OVER: 'GAME_OVER',
});

export const IcebergState = Object.freeze({
    ACTIVE: 'active',
    CURRENT: 'current',
    COMPLETED: 'completed',
    SINKING: 'sinking',
});

/* ---------- Animation Clips Metadata ---------- */
export const PENGUIN_CLIPS = {
    idle: { key: 'penguinIdle', frameW: 512, frameH: 512, frames: 12, fps: 10, loop: true },
    jump: { key: 'penguinJump', frameW: 512, frameH: 512, frames: 14, fps: 18, loop: false },
    fail: { key: 'penguinFail', frameW: 512, frameH: 512, frames: 12, fps: 14, loop: false },
};

/* ---------- Word Pools ---------- */
export const WORD_POOLS = {
    beginner: [
        'apple', 'banana', 'cherry', 'date', 'fig',
        'grape', 'kiwi', 'lemon', 'mango', 'orange',
        'peach', 'plum', 'rice', 'salt', 'tea',
        'water', 'juice', 'bread', 'nest', 'vine',
        'cake', 'duck', 'frog', 'hill', 'jump',
        'kite', 'lamp', 'moon', 'note', 'open',
    ],
    intermediate: [
        'antelope', 'buffalo', 'cheetah', 'dolphin', 'elephant',
        'falcon', 'giraffe', 'hamster', 'iguana', 'jackal',
        'kangaroo', 'leopard', 'mongoose', 'narwhal', 'ostrich',
        'panther', 'quokka', 'raccoon', 'serpent', 'toucan',
    ],
    advanced: [
        'albatross', 'barracuda', 'chameleon', 'dragonfly',
        'electricity', 'flamingo', 'gymnasium', 'hemisphere',
        'infrastructure', 'juxtapose', 'kaleidoscope', 'labyrinth',
        'misconception', 'nomenclature', 'observatory', 'philosophy',
    ],
};

/* ---------- Path Layout (Zoomed In) ---------- */
export const PATH_ICEBERG_COUNT = 6;
export const PATH_STEP_X = 220;
export const PATH_STEP_Y = 60;
export const PATH_START_X = 600;
export const PATH_START_Y = 400;

/* ---------- River / Banks / 2.5D ---------- */
export const RIVER_VELOCITY_BASE = 30;
export const DEFAULT_WPM = 30;
export const RIVER_BANK_TOP_Y = 180;
export const RIVER_BANK_BOTTOM_Y = 540;

// Depth & Perspective Constants
export const WATER_TOP_Y = RIVER_BANK_TOP_Y;
export const WATER_BOTTOM_Y = RIVER_BANK_BOTTOM_Y;
export const SCALE_FAR = 0.72;
export const SCALE_NEAR = 1.12;
export const CAMERA_DRIFT_X = 18;
export const CAMERA_DRIFT_Y = 8;

/* ---------- Iceberg (Base Size) ---------- */
export const ICEBERG_WIDTH = 200;
export const ICEBERG_HEIGHT = 80;
export const ICEBERG_SINK_SPEED = 0.6;

/* ---------- Danger Zone (Left Side) ---------- */
export const DANGER_ZONE_X = 110;
export const DANGER_WARN_X = 180;

/* ---------- Penguin (Base Size) ---------- */
export const PENGUIN_RADIUS = 32;
export const JUMP_DURATION = 0.75; // Slightly longer for 14 frames
export const JUMP_ARC_HEIGHT = 160;

/* ---------- Canvas ---------- */
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;

/* ---------- HUD ---------- */
export const HUD_FONT = '700 24px "Press Start 2P", cursive';
export const HUD_LARGE_FONT = '700 72px "Press Start 2P", cursive';
export const WORD_FONT = '900 42px "Press Start 2P", cursive';

/* ---------- Colors ---------- */
export const COLORS = {
    water: '#0b4f6c',
    iceberg: 'rgba(225, 245, 255, 0.95)',
    icebergBorder: 'rgba(190, 230, 250, 0.7)',
    icebergDone: 'rgba(120, 210, 255, 0.4)',
    charTyped: '#F2C45A', // Classic Gold
    charRemaining: '#C9A24A', // Dull Gold
    charError: '#ef4444',
    penguinBody: '#1e1e2e',
    hudText: 'rgba(255,255,255,0.95)',
    overlayDark: 'rgba(0,0,0,0.65)',
    danger: '#ef4444',
    currentGlow: 'rgba(41, 182, 246, 0.5)',
    bankSnow: '#F0F8FF',
};
