import { EntityManager, Penguin } from './EntityManager.js';
import { PathManager } from './Spawner.js';
import { Renderer } from './RendererV2.js';
import { InputManager } from './InputManager.js';
import { ParticleSystem } from './ParticleSystem.js';
import {
    GameState,
    IcebergState,
    PENGUIN_RADIUS,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    DANGER_ZONE_X,
} from './GameConfig.js';

/**
 * GameEngine — Zoomed-In Horizontal Flow version.
 */
export class PenguinCrossingGame {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) throw new Error(`Canvas #${canvasId} not found`);

        // Force internal resolution
        this.canvas.width = CANVAS_WIDTH;
        this.canvas.height = CANVAS_HEIGHT;
        this.canvas.style.width = '800px';
        this.canvas.style.height = '600px';

        this.ctx = this.canvas.getContext('2d');
        this.width = CANVAS_WIDTH;
        this.height = CANVAS_HEIGHT;

        // Subsystems
        this.entityManager = new EntityManager();
        this.particleSystem = new ParticleSystem();
        this.pathManager = new PathManager(this.entityManager, this.width, this.height);
        this.renderer = new Renderer(this.ctx, this.width, this.height);
        this.inputManager = new InputManager({
            onWordComplete: (ib) => this._onWordComplete(ib),
            onRestart: () => this._restart(),
            onExit: () => { if (window.closePenguinGame) window.closePenguinGame(); },
            getState: () => this.state,
        });

        // State
        this.state = GameState.IDLE;
        this._rafId = null;
        this._lastTs = 0;
        this._assetsReady = false;

        // Score
        this.wordsCompleted = 0;
        this.wpm = 0;
        this._startTime = 0;

        // Path tracking
        this._pathIcebergs = [];

        this._loopBound = this._gameLoop.bind(this);
    }

    /* ---- public API ---- */

    start() {
        if (!this._assetsReady) {
            this.renderer.drawLoading();
            this.renderer.loadAssets()
                .then(() => { this._assetsReady = true; this._beginGame(); })
                .catch(() => { this._assetsReady = true; this._beginGame(); });
        } else {
            this._beginGame();
        }
    }

    stop() {
        this.state = GameState.IDLE;
        this.inputManager.unbind();
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /* ---- internals ---- */

    _beginGame() {
        this._init();
        this.state = GameState.PLAYING;
        this._lastTs = performance.now();
        this._startTime = performance.now();
        this.inputManager.bind();
        this._rafId = requestAnimationFrame(this._loopBound);
    }

    _init() {
        this.entityManager.reset();
        this.particleSystem.reset();
        this.inputManager.reset();
        this.pathManager.reset();
        this.pathManager.setDifficulty('beginner');

        // Build horizontal path
        this._pathIcebergs = this.pathManager.buildInitialPath();

        // Place penguin on the FIRST iceberg (Left-most)
        const startIceberg = this._pathIcebergs[0];
        if (!startIceberg) {
            console.error('Penguin Crossing: No icebergs generated!');
            return;
        }
        startIceberg.state = IcebergState.CURRENT;

        const penguin = new Penguin(
            startIceberg.x + startIceberg.width / 2,
            startIceberg.y - PENGUIN_RADIUS - 10,
        );
        penguin.currentIceberg = startIceberg;
        this.entityManager.penguin = penguin;

        console.log(`Game Init: Penguin at (${Math.round(penguin.x)}, ${Math.round(penguin.y)}) on Iceberg X: ${Math.round(startIceberg.x)}`);

        // Set input target
        this.inputManager.targetIceberg = startIceberg;

        this.wordsCompleted = 0;
        this.wpm = 0;
        this.score = 0;
        this.combo = 0;
        this.heat = 0; // 0 to 100
        this.multiplier = 1;
    }

    _restart() {
        if (this.state !== GameState.GAME_OVER) return;
        this.stop();
        this.start();
    }

    _gameLoop(timestamp) {
        if (this.state === GameState.IDLE) return;

        const dt = Math.min((timestamp - this._lastTs) / 1000, 0.1);
        this._lastTs = timestamp;

        this._update(dt);
        this._draw();

        this._rafId = requestAnimationFrame(this._loopBound);
    }

    _update(dt) {
        if (this.state !== GameState.PLAYING) return;

        this.entityManager.update(dt);
        this.entityManager.cleanup();
        this.particleSystem.update(dt);

        const penguin = this.entityManager.penguin;
        if (!penguin || !penguin.currentIceberg) return;

        // Game Over: Left Edge
        const rightEdge = penguin.currentIceberg.x + penguin.currentIceberg.width;
        const now = performance.now();
        const uptime = (now - this._startTime) / 1000;

        if (!penguin.isJumping && rightEdge < DANGER_ZONE_X && uptime > 2.0) {
            console.log(`GAME OVER DEBUG: rightEdge=${rightEdge}, DANGER=${DANGER_ZONE_X}, now=${now}, start=${this._startTime}, uptime=${uptime}`);
            this._gameOver();
            return;
        }

        this._updateWPM();

        // Heat Decay
        if (this.heat > 0) {
            this.heat -= dt * 2.5; // ~2.5% per second decay
            if (this.heat < 0) this.heat = 0;
        }

        // Update Multiplier based on Heat
        // 0-49: 1x, 50-79: 1.5x, 80-100: 2x
        if (this.heat >= 80) this.multiplier = 2.0;
        else if (this.heat >= 50) this.multiplier = 1.5;
        else this.multiplier = 1.0;

        // Juice: Fire particles if Heat is high
        if (this.heat > 50 && Math.random() < 0.1) {
            const p = this.entityManager.penguin;
            this.particleSystem.emit('sparkle', p.x + (Math.random() - 0.5) * 20, p.y - 20, { color: '#fbbf24', speed: 50, size: 2 });
        }
    }

    _draw() {
        this.renderer.clear();
        this.renderer.draw(
            this.entityManager,
            this.state,
            {
                wordsCompleted: this.wordsCompleted,
                wpm: this.wpm,
                accuracy: this.inputManager.accuracy,
                score: this.score,
                combo: this.combo,
                heat: this.heat,
                multiplier: this.multiplier
            },
            this.particleSystem
        );
    }

    _onWordComplete(completedIceberg) {
        this.wordsCompleted++;
        this.combo++;
        this.heat = Math.min(100, this.heat + 15);

        const baseScore = 100 + (completedIceberg.word.length * 10);
        const hitScore = Math.floor(baseScore * this.multiplier);
        this.score += hitScore;

        this._updateWPM();

        // Juice: Floating Text
        const p = this.entityManager.penguin;
        let color = '#fff';
        if (this.multiplier >= 2) color = '#fbbf24'; // Gold
        else if (this.multiplier >= 1.5) color = '#38bdf8'; // Blue

        this.particleSystem.emitFloatingText(p.x, p.y - 40, `+${hitScore}`, color);

        // Find next iceberg (Rightward)
        const idx = this._pathIcebergs.indexOf(completedIceberg);
        if (idx === -1 || idx >= this._pathIcebergs.length - 1) return;

        const nextIceberg = this._pathIcebergs[idx + 1];

        // Jump Right
        this.entityManager.penguin.jumpTo(nextIceberg);

        // Update states
        nextIceberg.state = IcebergState.CURRENT;
        this.inputManager.targetIceberg = nextIceberg;

        // Remove old iceberg from tracking
        this._pathIcebergs.splice(0, idx + 1);

        // Spawn new at Right
        const lastVisibleIceberg = this._pathIcebergs[this._pathIcebergs.length - 1];
        const newIceberg = this.pathManager.spawnNext(lastVisibleIceberg);
        this._pathIcebergs.push(newIceberg);

        // Juice: Snow Puff & Shake
        const penguin = this.entityManager.penguin;
        this.particleSystem.emitSnowPuff(penguin.x, penguin.y);
        this.renderer.addTrauma(0.1);
    }

    _gameOver() {
        this.state = GameState.GAME_OVER;
        this._updateWPM();
        this.inputManager.targetIceberg = null;
        this.renderer.addTrauma(0.5); // Big shake on death
    }

    _updateWPM() {
        const elapsed = (performance.now() - this._startTime) / 60000;
        this.wpm = elapsed > 0 ? Math.round(this.wordsCompleted / elapsed) : 0;
    }
}
