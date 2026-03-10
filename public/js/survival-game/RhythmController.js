/**
 * RhythmController.js
 * Bridges AudioAnalysis and game logic.
 * Maps audio intensity to enemy speed and injects beat-driven spawns.
 */
import { GameConfig } from './GameConfig.js';

export default class RhythmController {
    constructor(game) {
        this.game = game;
        this.analysis = null;

        // Smoothed speed output (frame-rate independent)
        this.smoothedSpeed = 1.0;

        // Beat debounce
        this.lastBeatTime = 0;
        this.beatDebounceMs = 120; // Minimum ms between beat events
    }

    init(audioAnalysis) {
        this.analysis = audioAnalysis || null;
        this.smoothedSpeed = 1.0;
        this.lastBeatTime = 0;
    }

    update(deltaTime) {
        if (!this.analysis) {
            // No active analysis source (autoplay blocked / track transition):
            // keep baseline game speed.
            this.smoothedSpeed = 1.0;
            this.game.rhythmSpeedMult = 1.0;
            return;
        }

        // Do not react to music while game is frozen.
        if (this.game.freezeTimer > 0) return;

        const intensity = this.analysis.getIntensity();
        const loadState = typeof this.game.getSpawnLoadState === 'function'
            ? this.game.getSpawnLoadState(0)
            : null;
        const loadRatio = loadState ? loadState.projectedLoadRatio : 0;
        const speedLoadScale = Math.max(0.65, 1 - Math.max(0, loadRatio - 0.75) * 0.45);

        // Map intensity (0-1) to speed multiplier (1.0x-1.4x).
        const targetSpeed = 1.0 + (intensity * 0.4 * speedLoadScale);

        // Frame-rate independent exponential smoothing.
        const lambda = 3.0; // Higher means snappier response
        const alpha = 1 - Math.exp(-lambda * deltaTime);
        this.smoothedSpeed += (targetSpeed - this.smoothedSpeed) * alpha;

        // Write to game's rhythm-specific multiplier.
        this.game.rhythmSpeedMult = this.smoothedSpeed;

        // Handle beat-triggered spawns.
        if (this.analysis.isBeat()) {
            const now = performance.now();
            if (now - this.lastBeatTime > this.beatDebounceMs) {
                this._onBeat(intensity);
                this.lastBeatTime = now;
            }
        }
    }

    _onBeat(intensity) {
        if (this.game && typeof this.game.shouldAllowBeatSpawns === 'function' && !this.game.shouldAllowBeatSpawns()) {
            return;
        }

        // Visual pulse on beat.
        const pulse = 0.04 + (intensity * 0.12);
        this.game.screenFlash = Math.min(1, (this.game.screenFlash || 0) + pulse);
        this.game.screenFlashKind = 'beat';

        // Spawn probability scales with intensity^2.
        // Quiet section: about 4%. Intense section: up to about 90%.
        const loadState = typeof this.game.getSpawnLoadState === 'function'
            ? this.game.getSpawnLoadState(0)
            : null;
        const loadRatio = loadState ? loadState.projectedLoadRatio : 0;
        const spawnLoadScale = Math.max(0.1, 1 - Math.max(0, loadRatio - 0.6));
        const beatSpawnChanceMult = GameConfig.BALANCE?.ENEMY_BEAT_SPAWN_CHANCE_MULT || 1;
        const chance = Math.min(0.9, (0.04 + Math.pow(intensity, 2) * 0.86) * spawnLoadScale * beatSpawnChanceMult);

        if (Math.random() < chance && this.game.canSpawnEnemy()) {
            const first = this.game.spawnEnemy();

            // Double spawn on very intense beats (>0.75 intensity, 25% chance).
            if (first && intensity > 0.75 && Math.random() < (0.25 * beatSpawnChanceMult) && this.game.canSpawnEnemy()) {
                this.game.spawnEnemy();
            }
        }
    }
}
