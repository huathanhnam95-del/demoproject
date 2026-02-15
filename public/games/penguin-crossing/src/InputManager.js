import { IcebergState, GameState } from './GameConfig.js';

/**
 * InputManager — keyboard handler for Penguin Crossing.
 *
 * The target is always the penguin's CURRENT iceberg (the one it's ON).
 * Player types the word displayed on it. On completion, the game engine
 * handles the jump to the next iceberg.
 */
export class InputManager {
    /**
     * @param {object} callbacks - { onWordComplete, onRestart, onExit, getState }
     */
    constructor(callbacks = {}) {
        this.callbacks = callbacks;

        /** The iceberg the penguin is currently on — set externally. */
        this.targetIceberg = null;
        this.errorLock = false;

        // Stats
        this.totalChars = 0;
        this.correctChars = 0;

        this._boundKey = this._handleKey.bind(this);
    }

    /* ---- lifecycle ---- */

    bind() { window.addEventListener('keydown', this._boundKey); }
    unbind() { window.removeEventListener('keydown', this._boundKey); }

    reset() {
        this.targetIceberg = null;
        this.errorLock = false;
        this.totalChars = 0;
        this.correctChars = 0;
    }

    /* ---- stats ---- */

    get accuracy() {
        if (this.totalChars === 0) return 100;
        return Math.round((this.correctChars / this.totalChars) * 100);
    }

    /* ---- key handler ---- */

    _handleKey(e) {
        // Restart / exit always available
        if (e.key === 'Enter') {
            if (this.callbacks.onRestart) this.callbacks.onRestart();
            return;
        }
        if (e.key === 'Escape') {
            if (this.callbacks.onExit) this.callbacks.onExit();
            return;
        }

        // Only process while PLAYING
        const state = this.callbacks.getState ? this.callbacks.getState() : null;
        if (state !== GameState.PLAYING) return;

        if (e.repeat) return;
        const char = e.key;
        if (char.length !== 1) return;

        e.preventDefault();

        if (this.errorLock) return;

        // Must have a target with remaining text
        if (!this.targetIceberg || this.targetIceberg.remainingText.length === 0) return;

        this.totalChars++;

        const expected = this.targetIceberg.remainingText.charAt(0);

        if (char === expected) {
            this.correctChars++;
            this.targetIceberg.processedText += char;
            this.targetIceberg.remainingText = this.targetIceberg.remainingText.substring(1);

            if (this.targetIceberg.remainingText.length === 0) {
                // Word complete!
                this.targetIceberg.complete();
                const completed = this.targetIceberg;
                this.targetIceberg = null;
                if (this.callbacks.onWordComplete) {
                    this.callbacks.onWordComplete(completed);
                }
            }
        } else {
            // Error — flash and lock briefly
            this.targetIceberg.errorFlash = 0.3;
            this.errorLock = true;
            setTimeout(() => { this.errorLock = false; }, 300);
        }
    }
}
