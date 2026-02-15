import { Iceberg } from './EntityManager.js';
import {
    WORD_POOLS,
    RIVER_VELOCITY_BASE,
    DEFAULT_WPM,
    ICEBERG_WIDTH,
    ICEBERG_HEIGHT,
    PATH_ICEBERG_COUNT,
    PATH_STEP_X,
    PATH_STEP_Y,
    PATH_START_X,
    PATH_START_Y,
    RIVER_BANK_TOP_Y,
    RIVER_BANK_BOTTOM_Y,
} from './GameConfig.js';

/**
 * PathManager — Zoomed-In Horizontal Flow.
 */
export class PathManager {
    constructor(entityManager, gameWidth, gameHeight) {
        this.entityManager = entityManager;
        this.gameWidth = gameWidth;
        this.gameHeight = gameHeight;
        this.wpmGoal = DEFAULT_WPM;
        this.difficulty = 'beginner';
        this.wordPool = [];
        this.nextPathIndex = 0;
        this.nextPathIndex = 0;
        this._zigzagDir = 1;
        this.patternQueue = []; // Queue of pre-calculated iceberg configs
    }

    setDifficulty(level) { this.difficulty = level; }
    setWPM(wpm) { this.wpmGoal = Math.max(10, wpm); }

    get riverVelocity() {
        return RIVER_VELOCITY_BASE * (this.wpmGoal / DEFAULT_WPM);
    }

    reset() {
        this.nextPathIndex = 0;
        this._zigzagDir = 1;
        this.patternQueue = [];
        this._buildWordPool();
    }

    /* ---- Path Logic ---- */

    _getValidY(y) {
        // Constrain Y to River Channel
        const topLimit = RIVER_BANK_TOP_Y + 10;
        const bottomLimit = RIVER_BANK_BOTTOM_Y - ICEBERG_HEIGHT - 10;

        // Simple clamp? Or bounce?
        if (y < topLimit) return topLimit;
        if (y > bottomLimit) return bottomLimit;
        return y;
    }

    _isOutOfBounds(y) {
        const topLimit = RIVER_BANK_TOP_Y + 10;
        const bottomLimit = RIVER_BANK_BOTTOM_Y - ICEBERG_HEIGHT - 10;
        return (y < topLimit || y > bottomLimit);
    }

    buildInitialPath() {
        const icebergs = [];
        let x = PATH_START_X;
        let y = PATH_START_Y;

        for (let i = 0; i < PATH_ICEBERG_COUNT; i++) {
            const word = this._pickWord();

            // Add organic offset
            const offsetX = (Math.random() - 0.5) * 30;
            const offsetY = (Math.random() - 0.5) * 20;

            const ib = new Iceberg(x + offsetX, y + offsetY, word, this.nextPathIndex++);
            ib.velocity = this.riverVelocity;
            this.entityManager.addIceberg(ib);
            icebergs.push(ib);

            x += PATH_STEP_X;
            y += PATH_STEP_Y * this._zigzagDir;

            // Bounce off banks
            if (this._isOutOfBounds(y)) {
                this._zigzagDir *= -1;
                y += PATH_STEP_Y * this._zigzagDir * 2; // Hard correction
                y = this._getValidY(y);
            }
        }
        return icebergs;
    }

    spawnNext(lastVisibleIceberg) {
        // 1. Refill queue if empty
        if (this.patternQueue.length === 0) {
            this._generatePattern(lastVisibleIceberg);
        }

        // 2. Dequeue next configuration
        const nextConfig = this.patternQueue.shift();

        // 3. Create Iceberg
        const ib = new Iceberg(nextConfig.x, nextConfig.y, nextConfig.word, this.nextPathIndex++);
        ib.velocity = this.riverVelocity;
        this.entityManager.addIceberg(ib);
        return ib;
    }

    _generatePattern(lastIb) {
        const rand = Math.random();
        let patternType = 'normal';

        if (rand < 0.2) patternType = 'burst'; // 20%
        else if (rand < 0.35) patternType = 'gap';   // 15%

        // Base starting point
        let currX = lastIb.x;
        let currY = lastIb.y;

        if (patternType === 'burst') {
            // Burst: 3 tight icebergs, short words
            for (let i = 0; i < 3; i++) {
                currX += PATH_STEP_X * 0.7; // Closer
                currY += (Math.random() - 0.5) * 50; // Jittery Y, ignore zigzag
                currY = this._getValidY(currY);

                this.patternQueue.push({
                    x: currX,
                    y: currY,
                    word: this._pickWord(true) // force short? (Need to update pickWord)
                });
            }
        } else if (patternType === 'gap') {
            // Gap: 1 Far iceberg, long word
            this._zigzagDir *= -1;
            currX += PATH_STEP_X * 1.5;
            currY += PATH_STEP_Y * this._zigzagDir * 1.5;
            currY = this._getValidY(currY);

            this.patternQueue.push({
                x: currX,
                y: currY,
                word: this._pickWord(false, true) // force long
            });
        } else {
            // Normal ZigZag
            this._zigzagDir *= -1;
            currX += PATH_STEP_X;
            currY += PATH_STEP_Y * this._zigzagDir;

            if (this._isOutOfBounds(currY)) {
                this._zigzagDir *= -1;
                currY = lastIb.y + PATH_STEP_Y * this._zigzagDir; // Recover
            }
            currY = this._getValidY(currY);

            // Add organic offset
            const offsetX = (Math.random() - 0.5) * 30;
            const offsetY = (Math.random() - 0.5) * 15;

            this.patternQueue.push({
                x: currX + offsetX,
                y: currY + offsetY,
                word: this._pickWord()
            });
        }
    }

    /* ---- Word Pool ---- */

    _buildWordPool() {
        const pool = [...(WORD_POOLS[this.difficulty] || WORD_POOLS.beginner)];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        this.wordPool = pool;
        this._wordIdx = 0;
    }

    _pickWord(forceShort = false, forceLong = false) {
        if (this._wordIdx >= this.wordPool.length) {
            this._buildWordPool();
        }

        let word = this.wordPool[this._wordIdx++];

        // Simple retry logic for length constraints (not perfect, but keeps flow)
        if (forceShort && word.length > 5) {
            // Try to find a short one nearby in pool
            // (For prototype simplicity, we just truncate or re-roll locally)
            return word; // functionality placeholder
        }
        return word;
    }
}
