/**
 * SurvivalGame.js
 * Main controller for the survival typing game.
 */

import EntityManager from './EntityManager.js';
import TypingSystem from './TypingSystem.js';
import WeaponSystem from './WeaponSystem.js';
import UpgradeManager from './UpgradeManager.js';
import Renderer from './Renderer.js';
import AudioManager from './AudioManager.js';
import RhythmController from './RhythmController.js';
import { GameStates, GameConfig } from './GameConfig.js';

const ENEMY_TUTORIALS = { 
    drone: { 
        title: 'DRONE', 
        image: 'assets/survival-tutorial/enemy-drone.svg', 
        bodyHtml: ` 
            <strong>Basic enemy.</strong> Drones move steadily toward you. 
            <div class="survival-enemy-tutorial-bullets"> 
                <div>\u2022 Type its word to deal damage.</div> 
                <div>\u2022 Clear nearby drones first to stay safe.</div> 
            </div> 
        ` 
    }, 
    armor: {
        title: 'ARMOR',
        image: 'assets/survival-tutorial/enemy-armor.svg',
        bodyHtml: `
            <strong>Soaks damage.</strong> Armored enemies have a green ring and absorb hits before losing health.
            <div class="survival-enemy-tutorial-bullets">
                <div>\u2022 You may need to type the same word multiple times.</div>
                <div>\u2022 Strip armor first, then finish the enemy.</div>
            </div>
        `
    },
    stealth: {
        title: 'STEALTH',
        image: 'assets/survival-tutorial/enemy-stealth.svg',
        bodyHtml: `
            <strong>Hidden word.</strong> Stealth enemies only show a couple letters at first.
            <div class="survival-enemy-tutorial-bullets">
                <div>\u2022 Type the first <strong>2 letters</strong> to reveal the full word.</div>
                <div>\u2022 If you get stuck, switch targets and come back.</div>
            </div>
        `
    },
    buffer: {
        title: 'BUFFER',
        image: 'assets/survival-tutorial/enemy-buffer.svg',
        bodyHtml: `
            <strong>Buff aura.</strong> Buffers empower nearby enemies (faster + more damage).
            <div class="survival-enemy-tutorial-bullets">
                <div>\u2022 Watch for the <strong>green aura</strong> and buffed rings.</div>
                <div>\u2022 Kill the buffer to weaken the swarm.</div>
            </div>
        `
    },
    rusher: { 
        title: 'RUSHER', 
        image: 'assets/survival-tutorial/enemy-rusher.svg', 
        bodyHtml: ` 
            <strong>Fast and fragile.</strong> Rushers close the distance quickly. 
            <div class="survival-enemy-tutorial-bullets">
                <div>\u2022 Prioritize them before they reach you.</div>
                <div>\u2022 Shorter words, lower health.</div>
            </div>
        `
    },
    turret: { 
        title: 'TURRET', 
        image: 'assets/survival-tutorial/enemy-turret.svg', 
        bodyHtml: ` 
            <strong>Ranged threat.</strong> Turrets stop at a distance and fire shots. 
            <div class="survival-enemy-tutorial-bullets">
                <div>\u2022 Shots have their own words \u2192 type them to destroy.</div>
                <div>\u2022 Don\u2019t ignore them: they can hit while you\u2019re locked typing.</div>
            </div>
        `
    },
    tank: { 
        title: 'TANK', 
        image: 'assets/survival-tutorial/enemy-tank.svg', 
        bodyHtml: ` 
            <strong>Slow but dangerous.</strong> Tanks have high health and hit harder. 
            <div class="survival-enemy-tutorial-bullets">
                <div>\u2022 Longer words, more health.</div>
                <div>\u2022 Keep accuracy: chip them down safely.</div>
            </div>
        `
    },
    splitter: { 
        title: 'SPLITTER', 
        image: 'assets/survival-tutorial/enemy-splitter.svg', 
        bodyHtml: ` 
            <strong>Splits on death.</strong> Splitters break into smaller drones when destroyed. 
            <div class="survival-enemy-tutorial-bullets"> 
                <div>\u2022 Finish them early to avoid getting swarmed.</div> 
                <div>\u2022 The mini-drones have short words \u2192 clear them fast.</div> 
            </div> 
        ` 
    },
    mini_drone: {
        title: 'MINI DRONE',
        image: 'assets/survival-tutorial/enemy-mini-drone.svg',
        bodyHtml: `
            <strong>Swarm unit.</strong> Mini-drones spawn when splitters die.
            <div class="survival-enemy-tutorial-bullets">
                <div>\u2022 Short words, low health \u2192 clear them fast.</div>
                <div>\u2022 They add up quickly if you ignore them.</div>
            </div>
        `
    },
    shot: {
        title: 'SHOT',
        image: 'assets/survival-tutorial/enemy-shot.svg',
        bodyHtml: `
            <strong>Turret projectile.</strong> Shots have their own words and fly straight at you.
            <div class="survival-enemy-tutorial-bullets">
                <div>\u2022 Type the shot\u2019s word to destroy it.</div>
                <div>\u2022 Don\u2019t tunnel: a single hit still hurts.</div>
            </div>
        `
    },
    shielded: {
        title: 'SHIELD',
        image: 'assets/survival-tutorial/enemy-shielded.svg',
        bodyHtml: `
            <strong>Blue shield = untargetable.</strong> Shielded enemies are only vulnerable when the shield opens.
            <div class="survival-enemy-tutorial-bullets">
                <div>\u2022 If the blue ring is closed, you can\u2019t type or damage them.</div>
                <div>\u2022 Shielded enemies can protect nearby enemies with blue links.</div>
                <div>\u2022 Wait for the opening, then burst them down.</div>
            </div>
        `
    }
}; 

export default class SurvivalGame {
    constructor() {
        this.canvas = document.getElementById('survival-canvas');
        if (!this.canvas) {
            console.error('SurvivalGame: Canvas element "survival-canvas" not found.');
            return;
        }
        this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true }) || this.canvas.getContext('2d');
        if (!this.ctx) {
            console.error('SurvivalGame: Could not get 2d context for canvas.');
            return;
        }
        this.dpr = 1;
        this.width = 0;
        this.height = 0;
        this.rafId = null;
        this.cameraShake = 0;
        this.screenFlash = 0;
        this.screenFlashKind = null;
        this._lastHpRounded = null;

        // Game State
        this.state = GameStates.MENU;
        this.lastTime = 0;
        this.score = 0;
        this.wave = 1;
        this.difficulty = 1;
        this.spawnTimer = GameConfig.WAVES.INITIAL_SPAWN_TIMER;
        this.runTime = 0;
        this.waveTimer = GameConfig.WAVES.WAVE_DURATION;
        this.omenLevel = this.loadOmenLevel();
        this.omenConfig = GameConfig.OMEN.LEVELS[this.omenLevel] || GameConfig.OMEN.LEVELS[0];
        this.wordList = [];
        this.wordListPromise = null;
        this.wordBuckets = null;
        this.wickedWords = [];
        this.freezeTimer = 0;
        this.doubleDamageTimer = 0;
        this.speedBoostTimer = 0;
        this.damageMult = 1;
        this.runMode = this.resolveRunMode();
        this.trialState = this.createTrialState();
        this.gameOutcome = null;

        // Speed Multipliers
        this.playerSpeedMult = 1; // From consumables/buffs (affects weapons/projectiles)
        this.rhythmSpeedMult = 1; // From music intensity (affects enemies)
        this.enemySpeedMult = 1;  // Combined enemy speed multiplier

        this.itemWeightBonus = {};
        this.itemLifetimeMult = 1;
        this.pickupToast = null;
        this.commandWords = new Set(
            (GameConfig.DIFFICULTY_CAP?.COMMAND_WORDS || ['BACK', 'NEXT'])
                .map(word => String(word || '').toUpperCase())
                .filter(Boolean)
        );
        this.commandWordList = Array.from(this.commandWords);
        this.commandMaxLen = this.commandWordList.reduce((max, cmd) => Math.max(max, cmd.length), 0);
        this.commandInput = '';
        this.commandInputTimer = 0;
        this.commandInputWindow = 1.25;
        this.commandCaptureActive = false;

        // Used to keep secondary weapons from "stealing" the player's current target for a short window
        // after a word is completed (prevents overkill and makes secondaries feel distinct).
        this.recentAimTarget = null;
        this.recentAimTargetTimer = 0;

        // One-time enemy introduction popups (per user, persisted).
        this.enemyTutorialSeen = this.loadEnemyTutorialSeen();
        this.enemyTutorialQueue = [];
        this.enemyTutorialActiveType = '';

        // Systems
        this.audioManager = new AudioManager();
        this.rhythmController = new RhythmController(this);
        this.entityManager = new EntityManager(this);
        this.weaponSystem = new WeaponSystem(this);
        this.upgradeManager = new UpgradeManager(this);
        this.typingSystem = new TypingSystem(this.entityManager);
        this.renderer = new Renderer(this.canvas, this.ctx, this);

        this.loop = this.loop.bind(this);
        window.addEventListener('resize', () => this.resize());
        this.cacheUi();
        this.bindTrackControls();
        this.bindAudioControls();
        this.loadDifficultySettings();
        this.bindDifficultyControls();
        this.bindEnemyTutorialControls();
        this.resize();
        this.loadOxfordWordList();
    }

    cacheUi() {
        const overlay = document.getElementById('survival-game-overlay');
        const hpBar = document.getElementById('survival-hp-bar');

        this.ui = {
            overlay: overlay,
            hpFill: hpBar ? hpBar.querySelector('.hp-fill') : null,
            scoreVal: document.getElementById('survival-score-val'),
            waveVal: document.getElementById('survival-wave-val'),
            xpFill: document.getElementById('survival-xp-fill'),
            levelDisplay: document.getElementById('survival-level-display'),
            gameOverModal: document.getElementById('survival-gameover-modal'),
            gameOverTitle: document.querySelector('#survival-gameover-modal .gameover-title'),
            finalScore: document.getElementById('final-score'),
            finalWave: document.getElementById('final-wave'),
            trackLabel: document.getElementById('survival-track-label'),
            trackPrevBtn: document.getElementById('survival-track-prev'),
            trackNextBtn: document.getElementById('survival-track-next'),
            audioToggleBtn: document.getElementById('survival-audio-toggle'),
            audioPanel: document.getElementById('survival-audio-panel'),
            bgmVolumeSlider: document.getElementById('survival-bgm-volume'),
            sfxVolumeSlider: document.getElementById('survival-sfx-volume'),
            bgmVolumeValue: document.getElementById('survival-bgm-value'),
            sfxVolumeValue: document.getElementById('survival-sfx-value'),
            strictToggleBtn: document.getElementById('survival-strict-toggle'),
            enemyTutorialModal: document.getElementById('survival-enemy-tutorial-modal'),
            enemyTutorialTitle: document.getElementById('survival-enemy-tutorial-title'),
            enemyTutorialText: document.getElementById('survival-enemy-tutorial-text'),
            enemyTutorialImage: document.getElementById('survival-enemy-tutorial-image'),
            enemyTutorialContinueBtn: document.getElementById('survival-enemy-tutorial-continue')
        };

        if (!overlay) console.warn('SurvivalGame: overlay missing');
    }

    bindTrackControls() {
        if (this.ui?.trackPrevBtn && !this.ui.trackPrevBtn.dataset.boundClick) {
            this.ui.trackPrevBtn.dataset.boundClick = '1';
            this.ui.trackPrevBtn.addEventListener('click', () => this.stepPlaylist(-1));
        }
        if (this.ui?.trackNextBtn && !this.ui.trackNextBtn.dataset.boundClick) {
            this.ui.trackNextBtn.dataset.boundClick = '1';
            this.ui.trackNextBtn.addEventListener('click', () => this.stepPlaylist(1));
        }
        if (this.audioManager && typeof this.audioManager.setTrackChangeListener === 'function') {
            this.audioManager.setTrackChangeListener(track => this.updateTrackUi(track));
        } else {
            this.updateTrackUi();
        }
    }

    bindAudioControls() {
        if (this.ui?.audioToggleBtn && !this.ui.audioToggleBtn.dataset.boundClick) {
            this.ui.audioToggleBtn.dataset.boundClick = '1';
            this.ui.audioToggleBtn.addEventListener('click', () => {
                const isOpen = !this.ui?.audioPanel || this.ui.audioPanel.hidden === false;
                this.setAudioPanelOpen(!isOpen);
            });
        }

        if (this.ui?.bgmVolumeSlider && !this.ui.bgmVolumeSlider.dataset.boundInput) {
            this.ui.bgmVolumeSlider.dataset.boundInput = '1';
            this.ui.bgmVolumeSlider.addEventListener('input', () => {
                const percent = Number.parseInt(this.ui.bgmVolumeSlider.value, 10);
                if (!Number.isFinite(percent)) return;
                this.audioManager.setBgmVolume(percent / 100);
                this.syncAudioControls();
            });
        }

        if (this.ui?.sfxVolumeSlider && !this.ui.sfxVolumeSlider.dataset.boundInput) {
            this.ui.sfxVolumeSlider.dataset.boundInput = '1';
            this.ui.sfxVolumeSlider.addEventListener('input', () => {
                const percent = Number.parseInt(this.ui.sfxVolumeSlider.value, 10);
                if (!Number.isFinite(percent)) return;
                this.audioManager.setSfxVolume(percent / 100);
                this.syncAudioControls();
            });
        }

        this.syncAudioControls();
        this.setAudioPanelOpen(false);
    }

    setAudioPanelOpen(isOpen) {
        if (!this.ui?.audioPanel || !this.ui?.audioToggleBtn) return;
        const open = !!isOpen;
        this.ui.audioPanel.hidden = !open;
        this.ui.audioToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    syncAudioControls() {
        const bgmVolume = Math.round((this.audioManager?.getBgmVolume?.() || 0) * 100);
        const sfxVolume = Math.round((this.audioManager?.getSfxVolume?.() || 0) * 100);

        if (this.ui?.bgmVolumeSlider) this.ui.bgmVolumeSlider.value = `${bgmVolume}`;
        if (this.ui?.sfxVolumeSlider) this.ui.sfxVolumeSlider.value = `${sfxVolume}`;
        if (this.ui?.bgmVolumeValue) this.ui.bgmVolumeValue.textContent = `${bgmVolume}%`;
        if (this.ui?.sfxVolumeValue) this.ui.sfxVolumeValue.textContent = `${sfxVolume}%`;
    }

    getStrictModeEnabled() {
        const strict = GameConfig.DIFFICULTY?.STRICT_MODE;
        if (typeof strict === 'boolean') return strict;
        return !!GameConfig.DIFFICULTY_CAP?.STRICT_MODE;
    }

    setStrictModeEnabled(enabled, { persist = true, showToast = true } = {}) {
        const value = !!enabled;
        if (GameConfig.DIFFICULTY) GameConfig.DIFFICULTY.STRICT_MODE = value;
        if (GameConfig.DIFFICULTY_CAP) GameConfig.DIFFICULTY_CAP.STRICT_MODE = value;

        if (persist) {
            const key = GameConfig.DIFFICULTY?.STORAGE_KEY || 'survival_strict_mode';
            try {
                localStorage.setItem(key, value ? '1' : '0');
            } catch (_) {
                // Ignore storage write failures.
            }
        }

        this.syncDifficultyControls();
        if (this.typingSystem && typeof this.typingSystem.clearLock === 'function') {
            this.typingSystem.clearLock();
        }
        if (showToast) {
            this.setPickupToast(`Strict Mode ${value ? 'ON' : 'OFF'}`, value ? '#b24c4c' : '#6a6460');
        }
        return value;
    }

    loadDifficultySettings() {
        const key = GameConfig.DIFFICULTY?.STORAGE_KEY || 'survival_strict_mode';
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return;
            const normalized = String(raw).trim().toLowerCase();
            const enabled = normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
            this.setStrictModeEnabled(enabled, { persist: false, showToast: false });
        } catch (_) {
            // Ignore storage read failures.
        }
    }

    syncDifficultyControls() {
        const btn = this.ui?.strictToggleBtn;
        if (!btn) return;
        const enabled = this.getStrictModeEnabled();
        btn.textContent = enabled ? 'ON' : 'OFF';
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        btn.classList.toggle('is-active', enabled);
    }

    bindDifficultyControls() {
        const btn = this.ui?.strictToggleBtn;
        if (!btn || btn.dataset.boundClick) return;
        btn.dataset.boundClick = '1';
        btn.addEventListener('click', () => {
            const current = this.getStrictModeEnabled();
            this.setStrictModeEnabled(!current, { persist: true, showToast: true });
        });
        this.syncDifficultyControls();
    }

    getWordRushState() {
        const cfg = GameConfig.WORD_RUSH || {};
        if (cfg.ENABLED === false) return { mult: 1, wpm: 0 };

        const wpm = (this.typingSystem && typeof this.typingSystem.getRecentWpm === 'function')
            ? this.typingSystem.getRecentWpm()
            : 0;

        const start = Number(cfg.START_WPM);
        const full = Number(cfg.FULL_WPM);
        const maxMult = Number(cfg.MAX_MULT);

        const startWpm = Number.isFinite(start) ? Math.max(0, start) : 60;
        const fullWpm = Number.isFinite(full) ? Math.max(startWpm + 1, full) : 120;
        const capMult = Number.isFinite(maxMult) ? Math.max(1, maxMult) : 1.35;

        if (!Number.isFinite(wpm) || wpm <= startWpm) return { mult: 1, wpm: Number.isFinite(wpm) ? wpm : 0 };

        const t = Math.min(1, (wpm - startWpm) / (fullWpm - startWpm));
        const mult = 1 + t * (capMult - 1);
        return { mult: Math.max(1, mult), wpm };
    }

    getWordRushMultiplier() {
        return this.getWordRushState().mult;
    }

    getWordRushHudText() {
        const cfg = GameConfig.WORD_RUSH || {};
        if (cfg.ENABLED === false) return '';
        const { mult, wpm } = this.getWordRushState();
        const minMult = Number(cfg.HUD_MIN_MULT);
        const threshold = Number.isFinite(minMult) ? Math.max(1, minMult) : 1.05;
        if (mult < threshold) return '';
        return `WORD RUSH x${mult.toFixed(2)} (${Math.round(wpm)} WPM)`;
    }

    getEnemyTutorialStorageKey() {
        return 'survival_enemy_tutorial_seen';
    }

    loadEnemyTutorialSeen() {
        const key = this.getEnemyTutorialStorageKey();
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return new Set();
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return new Set();
            return new Set(
                parsed
                    .map(entry => String(entry || '').trim().toLowerCase())
                    .filter(Boolean)
            );
        } catch (_) {
            return new Set();
        }
    }

    saveEnemyTutorialSeen() {
        const key = this.getEnemyTutorialStorageKey();
        const seen = this.enemyTutorialSeen instanceof Set ? this.enemyTutorialSeen : new Set();
        try {
            localStorage.setItem(key, JSON.stringify(Array.from(seen)));
        } catch (_) {
            // Ignore storage write failures.
        }
    }

    hasSeenEnemyTutorial(type) {
        const token = String(type || '').trim().toLowerCase();
        if (!token) return true;
        if (!(this.enemyTutorialSeen instanceof Set)) this.enemyTutorialSeen = new Set();
        return this.enemyTutorialSeen.has(token);
    }

    markEnemyTutorialSeen(type) {
        const token = String(type || '').trim().toLowerCase();
        if (!token) return false;
        if (!(this.enemyTutorialSeen instanceof Set)) this.enemyTutorialSeen = new Set();
        if (this.enemyTutorialSeen.has(token)) return false;
        this.enemyTutorialSeen.add(token);
        this.saveEnemyTutorialSeen();
        return true;
    }

    getEnemyTutorialSpec(type) {
        const token = String(type || '').trim().toLowerCase();
        if (!token) return null;
        return ENEMY_TUTORIALS[token] || null;
    }

    bindEnemyTutorialControls() {
        const btn = this.ui?.enemyTutorialContinueBtn;
        if (!btn || btn.dataset.boundClick) return;
        btn.dataset.boundClick = '1';
        btn.addEventListener('click', () => this.closeEnemyTutorial());
    }

    onEnemySpawned(enemy) { 
        if (!enemy || enemy.isDead) return false; 
        if (enemy.isBoss) return false; 
        if (enemy.isItem) return false; 
        let queued = false;

        queued = this.queueEnemyTutorial(enemy.type) || queued;

        if (enemy.isShielded) queued = this.queueEnemyTutorial('shielded') || queued;
        if (enemy.isStealth) queued = this.queueEnemyTutorial('stealth') || queued;
        if (enemy.isBuffer) queued = this.queueEnemyTutorial('buffer') || queued;
        if (enemy.armor && enemy.armor > 0) queued = this.queueEnemyTutorial('armor') || queued;

        return queued;
    } 

    queueEnemyTutorial(type) {
        const token = String(type || '').trim().toLowerCase();
        const spec = this.getEnemyTutorialSpec(token);
        if (!spec) return false;
        if (this.hasSeenEnemyTutorial(token)) return false;
        if (this.enemyTutorialActiveType === token) return false;

        const queue = Array.isArray(this.enemyTutorialQueue) ? this.enemyTutorialQueue : [];
        this.enemyTutorialQueue = queue;
        if (queue.includes(token)) return false;
        queue.push(token);
        return true;
    }

    canShowEnemyTutorialNow() {
        if (this.state !== GameStates.PLAYING) return false;
        if (this.enemyTutorialActiveType) return false;
        if (this.isTypingIntoWordTarget()) return false;
        const modal = this.ui?.enemyTutorialModal;
        if (modal && modal.style.display === 'block') return false;
        return true;
    }

    maybeShowQueuedEnemyTutorial() {
        if (!this.canShowEnemyTutorialNow()) return false;
        const queue = Array.isArray(this.enemyTutorialQueue) ? this.enemyTutorialQueue : [];
        if (queue.length === 0) return false;
        const nextType = queue.shift();
        if (!nextType) return false;
        return this.showEnemyTutorial(nextType);
    }

    showEnemyTutorial(type) {
        const token = String(type || '').trim().toLowerCase();
        const spec = this.getEnemyTutorialSpec(token);
        if (!spec) return false;

        const modal = this.ui?.enemyTutorialModal;
        if (!modal) return false;

        this.enemyTutorialActiveType = token;
        this.markEnemyTutorialSeen(token);

        if (this.ui?.enemyTutorialTitle) {
            this.ui.enemyTutorialTitle.textContent = spec.title || 'NEW ENEMY';
        }
        if (this.ui?.enemyTutorialText) {
            this.ui.enemyTutorialText.innerHTML = spec.bodyHtml || '';
        }
        if (this.ui?.enemyTutorialImage) {
            this.ui.enemyTutorialImage.src = spec.image || '';
            this.ui.enemyTutorialImage.alt = spec.title ? `${spec.title} enemy` : 'Enemy';
        }

        modal.style.display = 'block';
        this.pause(GameStates.LEVEL_UP);
        return true;
    }

    closeEnemyTutorial() {
        const modal = this.ui?.enemyTutorialModal;
        if (modal) modal.style.display = 'none';
        this.enemyTutorialActiveType = '';
        this.resume();
        return true;
    }

    resolveRunMode() {
        const cfg = GameConfig.TRIALS || {};
        if (cfg.ENABLED === false) return 'endless';

        const valid = new Set(['endless', 'trial']);
        let mode = '';

        if (typeof window !== 'undefined') {
            if (typeof window.SURVIVAL_RUN_MODE === 'string') {
                mode = window.SURVIVAL_RUN_MODE.trim().toLowerCase();
            } else if (window.SURVIVAL_TRIAL_MODE === true || window.SURVIVAL_TRIAL === true) {
                mode = 'trial';
            }
        }

        if (!valid.has(mode)) {
            const storageKey = cfg.MODE_STORAGE_KEY || 'survival_run_mode';
            try {
                const stored = String(localStorage.getItem(storageKey) || '').trim().toLowerCase();
                if (valid.has(stored)) mode = stored;
            } catch (_) {
                // Ignore storage read failures.
            }
        }

        if (!valid.has(mode)) {
            mode = String(cfg.DEFAULT_MODE || 'endless').trim().toLowerCase();
        }
        if (!valid.has(mode)) mode = 'endless';
        return mode;
    }

    setRunMode(mode, persist = true) {
        const normalized = String(mode || '').trim().toLowerCase();
        if (normalized !== 'trial' && normalized !== 'endless') return false;
        this.runMode = normalized;
        if (persist) {
            const storageKey = GameConfig.TRIALS?.MODE_STORAGE_KEY || 'survival_run_mode';
            try {
                localStorage.setItem(storageKey, normalized);
            } catch (_) {
                // Ignore storage write failures.
            }
        }
        return true;
    }

    createTrialState() {
        return {
            enabled: false,
            targetSeconds: 0,
            schedule: [],
            nextBossIndex: 0,
            activeBossEnemyId: null,
            activeBossId: '',
            activeBossName: '',
            completedBossIds: []
        };
    }

    resetTrialState() {
        const state = this.createTrialState();
        const cfg = GameConfig.TRIALS || {};
        const isTrial = this.runMode === 'trial' && cfg.ENABLED !== false;
        if (!isTrial) {
            this.trialState = state;
            return;
        }

        const rawSchedule = Array.isArray(cfg.SCHEDULE) ? cfg.SCHEDULE : [];
        const schedule = rawSchedule
            .map((entry, idx) => {
                const safe = entry && typeof entry === 'object' ? entry : {};
                const bossId = String(safe.bossId || safe.id || '').trim().toLowerCase();
                const timeSeconds = Number.parseFloat(safe.timeSeconds ?? safe.time);
                if (!bossId || !Number.isFinite(timeSeconds)) return null;
                return {
                    idx,
                    bossId,
                    timeSeconds: Math.max(0, timeSeconds),
                    override: safe
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.timeSeconds - b.timeSeconds);

        state.enabled = true;
        state.targetSeconds = Math.max(60, Number(cfg.TARGET_SECONDS) || (30 * 60));
        state.schedule = schedule;
        this.trialState = state;
    }

    formatClockShort(totalSeconds) {
        const safe = Math.max(0, totalSeconds || 0);
        const minutes = Math.floor(safe / 60);
        const seconds = Math.floor(safe % 60);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    getHudStatusSuffix() {
        if (!this.trialState?.enabled) return '';
        const activeBoss = this.getActiveBossEnemy();
        if (activeBoss) {
            const bossName = String(this.trialState.activeBossName || activeBoss.bossName || 'Boss').toUpperCase();
            return `BOSS ${bossName}`;
        }
        const remaining = Math.max(0, (this.trialState.targetSeconds || 0) - this.runTime);
        return `TRIAL ${this.formatClockShort(remaining)}`;
    }

    getBossWord(spec = {}) {
        const pool = Array.isArray(spec.wordPool) ? spec.wordPool : [];
        const candidates = pool
            .map(word => String(word || '').toLowerCase().replace(/[^a-z]/g, ''))
            .filter(word => word.length >= 3 && !this.isReservedCommandWord(word));
        if (candidates.length > 0) {
            const picked = candidates[Math.floor(Math.random() * candidates.length)];
            return this.decorateWordForStrict(picked);
        }

        const fallback = String(spec.name || spec.id || '')
            .toLowerCase()
            .replace(/[^a-z]/g, '');
        if (fallback.length >= 3 && !this.isReservedCommandWord(fallback)) {
            return this.decorateWordForStrict(fallback);
        }

        return this.getWordForDifficulty();
    }

    getActiveBossEnemy() {
        const bossId = this.trialState?.activeBossEnemyId;
        if (!bossId) return null;
        const enemies = this.entityManager?.enemies || [];
        for (const enemy of enemies) {
            if (!enemy || enemy.isDead) continue;
            if (enemy.id === bossId) return enemy;
        }
        return null;
    }

    resolveTrialBossSpec(event) {
        if (!event) return null;
        const cfg = GameConfig.TRIALS || {};
        const bosses = cfg.BOSSES || {};
        const base = bosses[event.bossId];
        if (!base) return null;

        const override = event.override && typeof event.override === 'object'
            ? event.override
            : {};
        const merged = {
            ...base,
            ...override,
            id: event.bossId
        };
        delete merged.time;
        delete merged.timeSeconds;
        delete merged.bossId;
        return merged;
    }

    triggerTrialBoss(event) {
        const spec = this.resolveTrialBossSpec(event);
        if (!spec || !this.entityManager || typeof this.entityManager.spawnBossEnemy !== 'function') return false;

        const bossEnemy = this.entityManager.spawnBossEnemy(spec);
        if (!bossEnemy) return false;

        this.trialState.activeBossEnemyId = bossEnemy.id;
        this.trialState.activeBossId = String(spec.id || bossEnemy.bossId || event.bossId || 'boss');
        this.trialState.activeBossName = String(spec.name || bossEnemy.bossName || this.trialState.activeBossId || 'Boss');
        this.setPickupToast(`${this.trialState.activeBossName} detected`, spec.color || '#6a6460');
        this.screenFlash = Math.min(1, (this.screenFlash || 0) + 0.3);
        this.screenFlashKind = 'damage';
        if (this.typingSystem && typeof this.typingSystem.clearLock === 'function') {
            this.typingSystem.clearLock();
        }
        return true;
    }

    onTrialBossDefeated() {
        if (!this.trialState?.enabled) return;
        const bossId = this.trialState.activeBossId;
        const bossName = this.trialState.activeBossName || bossId || 'Boss';
        if (bossId && !this.trialState.completedBossIds.includes(bossId)) {
            this.trialState.completedBossIds.push(bossId);
        }
        this.trialState.activeBossEnemyId = null;
        this.trialState.activeBossId = '';
        this.trialState.activeBossName = '';
        this.setPickupToast(`${bossName} neutralized`, '#6a6460');
    }

    completeTrialRun() {
        if (!this.trialState?.enabled) return;
        if (this.gameOutcome === 'survived') return;
        this.gameOutcome = 'survived';
        this.state = GameStates.GAME_OVER;
        this.setPickupToast('Trial Cleared', '#2f2f2f');
    }

    updateTrialState() {
        if (this.state !== GameStates.PLAYING) return;
        if (!this.trialState?.enabled) return;

        const activeBoss = this.getActiveBossEnemy();
        if (this.trialState.activeBossEnemyId && !activeBoss) {
            this.onTrialBossDefeated();
        }

        if (!this.trialState.activeBossEnemyId) {
            while (this.trialState.nextBossIndex < this.trialState.schedule.length) {
                const event = this.trialState.schedule[this.trialState.nextBossIndex];
                if (!event) {
                    this.trialState.nextBossIndex++;
                    continue;
                }
                if (this.runTime < event.timeSeconds) break;
                this.trialState.nextBossIndex++;
                const started = this.triggerTrialBoss(event);
                if (started) break;
            }
        }

        if (!this.trialState.activeBossEnemyId && this.runTime >= this.trialState.targetSeconds) {
            this.completeTrialRun();
        }
    }

    canSpawnAmbientEnemies() {
        if (!this.trialState?.enabled) return true;
        if (!this.trialState.activeBossEnemyId) return true;
        const cfg = GameConfig.TRIALS?.BOSS_PHASE || {};
        return cfg.DISABLE_AMBIENT_SPAWNS !== true;
    }

    shouldAllowBeatSpawns() {
        if (!this.trialState?.enabled) return true;
        if (!this.trialState.activeBossEnemyId) return true;
        const cfg = GameConfig.TRIALS?.BOSS_PHASE || {};
        return cfg.DISABLE_BEAT_SPAWNS !== true;
    }

    updateTrackUi(trackInfo = null) {
        if (!this.ui?.trackLabel) return;
        const info = trackInfo || {
            label: this.audioManager?.getCurrentTrackName?.() || 'No Track',
            index: this.audioManager?.currentTrackIndex ?? 0,
            total: this.audioManager?.playlist?.length ?? 0
        };
        const total = Number.isFinite(info.total) ? info.total : 0;
        const index = Number.isFinite(info.index) ? info.index + 1 : 0;
        if (total > 0) {
            // Keep (index/total) visible even when the track label is long (CSS ellipsis).
            this.ui.trackLabel.textContent = `(${index}/${total}) ${info.label}`;
        } else {
            this.ui.trackLabel.textContent = 'No Track';
        }
    }

    stepPlaylist(direction) {
        if (!this.audioManager) return false;
        const prevIndex = Number.isFinite(this.audioManager.currentTrackIndex) ? this.audioManager.currentTrackIndex : 0;
        const prevSrc = this.audioManager.playlist?.[prevIndex] || '';
        let changed = false;
        if (direction < 0 && typeof this.audioManager.playPreviousTrack === 'function') {
            changed = this.audioManager.playPreviousTrack({ autoplay: true });
        } else if (direction >= 0 && typeof this.audioManager.playNextTrack === 'function') {
            changed = this.audioManager.playNextTrack({ autoplay: true, reshuffleOnWrap: true });
        }
        const nextIndex = Number.isFinite(this.audioManager.currentTrackIndex) ? this.audioManager.currentTrackIndex : 0;
        const nextSrc = this.audioManager.playlist?.[nextIndex] || '';
        const advanced = changed && (prevIndex !== nextIndex || prevSrc !== nextSrc);
        if (!advanced) {
            const total = this.audioManager?.playlist?.length ?? 0;
            if (total <= 1) {
                this.setPickupToast('Playlist has 1 track', '#6a6460');
            } else {
                this.setPickupToast('Track change failed', '#6a6460');
            }
            return false;
        }

        if (this.rhythmController) {
            this.rhythmController.init(this.audioManager.analysis || null);
        }
        this.updateTrackUi();
        const name = this.audioManager?.getCurrentTrackName?.() || 'Track';
        const index = (this.audioManager?.currentTrackIndex ?? 0) + 1;
        const total = this.audioManager?.playlist?.length ?? 0;
        const label = total > 0 ? `(${index}/${total}) ${name}` : name;
        this.setPickupToast(direction < 0 ? `BACK ${label}` : `NEXT ${label}`, '#6a6460');
        return true;
    }

    ensureOverlayVisible() {
        if (!this.ui?.overlay) return;
        const overlay = this.ui.overlay;
        if (!document.body.contains(overlay)) {
            document.body.appendChild(overlay);
        }
        overlay.style.setProperty('display', 'flex', 'important');
        overlay.style.setProperty('visibility', 'visible', 'important');
        overlay.style.setProperty('z-index', '999999', 'important');

        if (this.canvas) {
            this.canvas.style.setProperty('display', 'block', 'important');
            this.canvas.style.setProperty('visibility', 'visible', 'important');
            this.canvas.style.setProperty('opacity', '1', 'important');
        }
    }

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.floor(this.width * this.dpr);
        this.canvas.height = Math.floor(this.height * this.dpr);
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        if (this.renderer && typeof this.renderer.resize === 'function') {
            this.renderer.resize(this.width, this.height, this.dpr);
        }
    }

    start() {
        document.body.classList.add('survival-active');
        this.ensureOverlayVisible();
        this.resize();
        this.runMode = this.resolveRunMode();
        this.resetTrialState();
        this.gameOutcome = null;
        this.state = GameStates.PLAYING;
        this.entityManager.reset();
        this.typingSystem.reset();
        this.weaponSystem.reset();
        this.upgradeManager.reset();
        this.score = 0;
        this.wave = 1;
        this.difficulty = 1;
        this.runTime = 0;
        this.waveTimer = GameConfig.WAVES.WAVE_DURATION;
        this.cameraShake = 0;
        this.screenFlash = 0;
        this.screenFlashKind = null;
        this.freezeTimer = 0;
        this.doubleDamageTimer = 0;
        this.speedBoostTimer = 0;
        this.damageMult = 1;

        this.playerSpeedMult = 1;
        this.rhythmSpeedMult = 1;
        this.enemySpeedMult = 1;
        this.recomputeBuffMultipliers();

        this.itemWeightBonus = {};
        this.itemLifetimeMult = 1;
        this.entityManager.player.shieldCharges = 0;
        this._lastHpRounded = null;
        this.pickupToast = null;
        this.resetCommandInput();
        this.recentAimTarget = null;
        this.recentAimTargetTimer = 0;
        this.enemyTutorialQueue = [];
        this.enemyTutorialActiveType = '';
        if (this.ui?.enemyTutorialModal) this.ui.enemyTutorialModal.style.display = 'none';
        this.omenLevel = this.loadOmenLevel();
        this.omenConfig = GameConfig.OMEN.LEVELS[this.omenLevel] || GameConfig.OMEN.LEVELS[0];
        const interval = this.getSpawnInterval();
        this.spawnTimer = Math.max(GameConfig.WAVES.FIRST_SPAWN_DELAY || interval, interval);
        this.loadOxfordWordList();
        this.buildWordBuckets();
        if (this.ui?.gameOverModal) this.ui.gameOverModal.style.display = 'none';
        if (this.ui?.gameOverTitle) this.ui.gameOverTitle.textContent = 'TERMINATED';
        if (this.trialState?.enabled) this.setPickupToast('Trial Mode: Survive 30:00', '#6a6460');
        this.lastTime = performance.now();
        this.ensureLoop();

        try {
            this.audioManager.playBGM();
            this.rhythmController.init(this.audioManager.analysis || null);
            this.updateTrackUi();
            this.syncAudioControls();
        } catch (err) {
            console.warn('SurvivalGame: Audio BGM failed to start (non-critical).', err);
        }
    }

    loop(timestamp) {
        if (this.state !== GameStates.PLAYING) {
            this.rafId = null;
            return;
        }

        const deltaTime = Math.min((timestamp - this.lastTime) / 1000, 0.05);
        this.lastTime = timestamp;

        this.update(deltaTime);
        this.draw();

        this.rafId = requestAnimationFrame(this.loop);
    }

    update(deltaTime) {
        // Rebind analysis when the track/source graph changes.
        const currentAnalysis = this.audioManager.analysis || null;
        if (this.rhythmController.analysis !== currentAnalysis) {
            this.rhythmController.init(currentAnalysis);
        }

        // Update Audio & Rhythm systems
        this.audioManager.update(deltaTime);
        this.rhythmController.update(deltaTime);

        if (this.commandInputTimer > 0) {
            this.commandInputTimer -= deltaTime;
            if (this.commandInputTimer <= 0) {
                // If the player started a command but didn't finish it, treat the buffer as normal typing.
                if (this.commandCaptureActive) {
                    this.flushCommandBufferToTyping();
                } else {
                    this.resetCommandInput();
                }
            }
        }

        if (this.recentAimTargetTimer > 0) {
            this.recentAimTargetTimer = Math.max(0, this.recentAimTargetTimer - deltaTime);
            if (this.recentAimTargetTimer === 0 || (this.recentAimTarget && this.recentAimTarget.isDead)) {
                this.recentAimTargetTimer = 0;
                this.recentAimTarget = null;
            }
        }

        this.runTime += deltaTime;
        const simDelta = this.freezeTimer > 0 ? 0 : deltaTime;
        this.waveTimer -= simDelta;
        while (this.waveTimer <= 0) {
            this.nextWave();
            this.waveTimer += GameConfig.WAVES.WAVE_DURATION;
        }

        this.difficulty = 1
            + (this.wave - 1) * GameConfig.WAVES.DIFFICULTY_SCALING
            + (this.runTime / 60) * GameConfig.WAVES.TIME_SCALING;

        this.enemySpeedMult = this.rhythmSpeedMult;
        this.entityManager.update(deltaTime);
        this.weaponSystem.update(deltaTime);
        this.typingSystem.update(deltaTime);
        this.updateTrialState();
        if (this.state === GameStates.GAME_OVER) {
            this.handleGameOver();
            this.audioManager.stopBGM();
            return;
        }

        // Smooth camera shake decay (Renderer reads this value).
        this.cameraShake = Math.max(0, this.cameraShake - deltaTime * 2.8);
        this.screenFlash = Math.max(0, this.screenFlash - deltaTime * 4.5);

        if (this.freezeTimer > 0) {
            this.freezeTimer = Math.max(0, this.freezeTimer - deltaTime);
        }
        if (this.doubleDamageTimer > 0) {
            this.doubleDamageTimer = Math.max(0, this.doubleDamageTimer - deltaTime);
        }
        if (this.speedBoostTimer > 0) {
            this.speedBoostTimer = Math.max(0, this.speedBoostTimer - deltaTime);
        }
        this.recomputeBuffMultipliers();

        if (this.pickupToast) {
            this.pickupToast.time = Math.max(0, this.pickupToast.time - deltaTime);
            if (this.pickupToast.time <= 0) {
                this.pickupToast = null;
            }
        }

        // Spawning logic (Hybrid: Beat + Timer)
        // 1. Timer acts as a "safety net" ensuring spawns happen even if music is quiet/broken
        // 2. RhythmController handles extra spawns on beats (it calls spawnEnemy directly)
        this.spawnTimer -= simDelta;
        if (this.spawnTimer <= 0) {
            this.spawnEnemy(false, 'ambient');
            this.spawnTimer = this.getSpawnInterval();
        }

        this.maybeShowQueuedEnemyTutorial();

        const hpPercent = (this.entityManager.player.health / this.entityManager.player.maxHealth) * 100;
        const hpRounded = Math.round(Math.max(0, Math.min(100, hpPercent)));
        if (this.ui?.hpFill && this._lastHpRounded !== hpRounded) {
            this.ui.hpFill.style.width = `${hpRounded}%`;
            this._lastHpRounded = hpRounded;
        }

        if (this.state === GameStates.GAME_OVER) {
            this.handleGameOver();
            this.audioManager.stopBGM();
        }
    }

    nextWave() {
        this.wave++;
    }

    handleGameOver() {
        if (this.ui?.gameOverModal) this.ui.gameOverModal.style.display = 'block';
        if (this.ui?.gameOverTitle) {
            this.ui.gameOverTitle.textContent = this.gameOutcome === 'survived' ? 'SURVIVED' : 'TERMINATED';
        }

        if (this.ui?.finalScore) this.ui.finalScore.textContent = Math.floor(this.score);
        if (this.ui?.finalWave) this.ui.finalWave.textContent = this.wave;

        const highScore = localStorage.getItem('survival_high_score') || 0;
        if (this.score > highScore) {
            localStorage.setItem('survival_high_score', Math.floor(this.score));
            if (this.ui?.finalScore) this.ui.finalScore.textContent += " (NEW RECORD!)";
        }
    }

    getShieldOverloadRadius() {
        const cfg = GameConfig.ITEMS?.EFFECTS?.SHIELD_OVERLOAD || {};
        const ratio = Number.isFinite(cfg.RADIUS_RATIO) ? cfg.RADIUS_RATIO : 0.48;
        const minR = Number.isFinite(cfg.RADIUS_MIN) ? cfg.RADIUS_MIN : 260;
        const maxR = Number.isFinite(cfg.RADIUS_MAX) ? cfg.RADIUS_MAX : 520;
        const w = Math.max(1, this.width || 0);
        const h = Math.max(1, this.height || 0);
        const scaled = Math.min(w, h) * ratio;
        return Math.max(minR, Math.min(maxR, scaled));
    }

    recomputeBuffMultipliers() {
        const effects = GameConfig.ITEMS?.EFFECTS || {};

        const hasDouble = (this.doubleDamageTimer || 0) > 0;
        const hasBoost = (this.speedBoostTimer || 0) > 0;

        const doubleSpeed = hasDouble
            ? (effects.DOUBLE_DAMAGE?.PLAYER_SPEED_MULT || 1.2)
            : 1;
        const boostSpeed = hasBoost
            ? (effects.SPEED_BOOST?.PLAYER_SPEED_MULT || 1.5)
            : 1;

        const boostDamage = hasBoost
            ? (effects.SPEED_BOOST?.DAMAGE_MULT || 1.25)
            : 1;

        this.damageMult = (hasDouble ? 2 : 1) * boostDamage;
        this.playerSpeedMult = doubleSpeed * boostSpeed;

        if (!Number.isFinite(this.damageMult) || this.damageMult <= 0) this.damageMult = 1;
        if (!Number.isFinite(this.playerSpeedMult) || this.playerSpeedMult <= 0) this.playerSpeedMult = 1;
    }

    applyItemPickup(item) {
        if (!item || !item.type) return;
        const player = this.entityManager.player;
        switch (item.type) {
            case 'shield':
                player.shieldCharges = (player.shieldCharges || 0) + 1;
                this.setPickupToast('Shield Charge +1', '#6b7b8c');
                break;
            case 'freeze':
                this.freezeTimer = Math.max(this.freezeTimer, 3.5);
                this.setPickupToast('Freeze Time', '#5d7ea6');
                break;
            case 'double_damage':
                this.doubleDamageTimer = Math.max(
                    this.doubleDamageTimer,
                    GameConfig.ITEMS?.EFFECTS?.DOUBLE_DAMAGE?.DURATION || 6
                );
                this.recomputeBuffMultipliers();
                this.setPickupToast('Double Damage', '#b24c4c');
                break;
            case 'reroll':
                if (this.upgradeManager) {
                    this.upgradeManager.rerolls = (this.upgradeManager.rerolls || 0) + 1;
                }
                this.setPickupToast('Reroll Gained', '#7d6c8d');
                break;
            case 'health':
                if (player) {
                    player.health = Math.min(player.maxHealth, player.health + player.maxHealth * 0.2);
                }
                this.setPickupToast('Health Restored', '#7a8d5a');
                break;
            case 'loot':
                if (this.upgradeManager) {
                    const opened = this.upgradeManager.openLootMenu();
                    if (!opened) {
                        this.upgradeManager.addXp(25);
                        this.setPickupToast('Bonus XP', '#9c7b5c');
                    }
                } else {
                    this.setPickupToast('Bonus XP', '#9c7b5c');
                }
                break;
            case 'shield_overload':
                this.setPickupToast('SHIELD OVERLOAD!', '#e0a800');
                this.screenFlash = 1.0;
                this.screenFlashKind = 'block'; // White/Blue flash
                {
                    const radius = this.getShieldOverloadRadius();
                    if (this.entityManager && typeof this.entityManager.spawnShockwave === 'function') {
                        this.entityManager.spawnShockwave(player.x, player.y, radius, '#e0a800');
                    }

                    if (this.entityManager && this.entityManager.enemies) {
                        const targets = [...this.entityManager.enemies];
                        let killCount = 0;
                        const r2 = radius * radius;
                        for (const e of targets) {
                            if (!e || e.isDead) continue;
                            if (e.isBoss) continue;
                            const dx = e.x - player.x;
                            const dy = e.y - player.y;
                            if ((dx * dx) + (dy * dy) > r2) continue;
                            this.entityManager.applyEnemyDamage(e, 9999, {
                                spawnFx: true,
                                sourceColor: '#e0a800',
                                playHit: false,
                                playKillSound: false,
                                suppressOnDeathEffects: true,
                                skipItemDrop: true,
                                fxKind: 'spark'
                            });
                            killCount++;
                        }
                        if (killCount > 0) this.audioManager.playExplosion();
                    }
                }
                break;
            case 'speed_boost':
                this.speedBoostTimer = Math.max(
                    this.speedBoostTimer,
                    GameConfig.ITEMS?.EFFECTS?.SPEED_BOOST?.DURATION || 8
                );
                this.recomputeBuffMultipliers();
                this.setPickupToast('SPEED BOOST', '#00d084');
                break;
            default:
                break;
        }
    }

    setPickupToast(text, color = '#2f2f2f') {
        this.pickupToast = {
            text,
            color,
            time: 1.6
        };
    }

    resetCommandInput() {
        this.commandInput = '';
        this.commandInputTimer = 0;
        this.commandCaptureActive = false;
    }

    flushCommandBufferToTyping() {
        if (!this.commandCaptureActive) return false;
        const buf = String(this.commandInput || '');
        this.resetCommandInput();
        if (!buf) return false;
        if (!this.typingSystem || typeof this.typingSystem.processKey !== 'function') return false;
        for (const ch of buf) {
            this.typingSystem.processKey(ch);
        }
        return true;
    }

    normalizeWordToken(word) {
        return String(word || '').replace(/[^a-z]/gi, '').toUpperCase();
    }

    isReservedCommandWord(word) {
        const token = this.normalizeWordToken(word);
        if (!token) return false;
        return this.commandWords.has(token);
    }

    isTypingIntoWordTarget() {
        const typingSystem = this.typingSystem;
        if (!typingSystem) return false;

        const target = typingSystem.lockTarget;
        if (!target || target.isDead) return false;
        const typedIndex = Number.isFinite(target.typedIndex) ? target.typedIndex : 0;
        return typedIndex > 0;
    }

    hasTypingCandidates(prefix) {
        const typingSystem = this.typingSystem;
        if (!typingSystem || typeof typingSystem.findCandidates !== 'function') return false;
        const token = String(prefix || '').trim().toLowerCase();
        if (!token) return false;
        try {
            const matches = typingSystem.findCandidates(token);
            return Array.isArray(matches) && matches.length > 0;
        } catch (_) {
            return false;
        }
    }

    handlePlaylistCommandKey(key) {
        if (!key || typeof key !== 'string') return false;
        if (!this.commandWordList || this.commandWordList.length === 0) return false;

        // Don't allow commands to fire while the player is "locked in" typing a word.
        // Commands should be intentional and must not steal input mid-word.
        if (!this.commandCaptureActive && this.isTypingIntoWordTarget()) {
            return false;
        }

        if ((this.typingSystem?.mistakePenalty || 0) > 0) {
            if (this.commandCaptureActive) {
                this.resetCommandInput();
                return true; // consume so we don't accidentally type buffered command chars into enemies
            }
            return false;
        }

        if (key === 'Backspace') {
            if (!this.commandCaptureActive) return false;
            if (this.commandInput.length > 0) {
                this.commandInput = this.commandInput.slice(0, -1);
            }
            if (this.commandInput.length === 0) {
                this.resetCommandInput();
            } else {
                this.commandInputTimer = this.commandInputWindow;
            }
            return true;
        }

        if (key.length !== 1 || !/^[a-z]$/i.test(key)) {
            if (this.commandCaptureActive) {
                // Non-letter breaks capture: flush what we buffered so far into typing.
                return this.flushCommandBufferToTyping();
            }
            return false;
        }

        const upper = key.toUpperCase();

        // Start capture if the first letter matches any command prefix.
        if (!this.commandCaptureActive) {
            const startsAny = this.commandWordList.some(cmd => cmd.startsWith(upper));
            if (!startsAny) return false;
            this.commandCaptureActive = true;
            this.commandInput = upper;
            this.commandInputTimer = this.commandInputWindow;
            return true; // consume until we resolve command vs normal typing
        }

        // Capture active: extend buffer and see if it still matches any command prefix.
        if (this.commandInputTimer <= 0) {
            // Shouldn't usually happen (timer is decremented in update), but be safe.
            return this.flushCommandBufferToTyping();
        }

        this.commandInput += upper;
        if (this.commandMaxLen > 0 && this.commandInput.length > this.commandMaxLen) {
            // Anything longer than the longest command cannot resolve; treat as normal typing.
            return this.flushCommandBufferToTyping();
        }
        this.commandInputTimer = this.commandInputWindow;

        const buffer = this.commandInput;
        const possible = this.commandWordList.filter(cmd => cmd.startsWith(buffer));
        if (possible.length === 0) {
            // Not a command: treat it as normal typing.
            return this.flushCommandBufferToTyping();
        }

        // Completed a command word: only execute it if it doesn't conflict with any live word.
        if (this.commandWords.has(buffer)) {
            if (this.hasTypingCandidates(buffer)) {
                // Conflict (e.g., "backtrack"): let typing win.
                return this.flushCommandBufferToTyping();
            }
            const changed = this.executePlaylistCommand(buffer);
            this.resetCommandInput();
            if (changed && this.typingSystem && typeof this.typingSystem.clearLock === 'function') {
                this.typingSystem.clearLock();
                this.typingSystem.mistakePenalty = 0;
            }
            return true;
        }

        // Still a prefix of a command: keep consuming input until we resolve.
        return true;
    }

    executePlaylistCommand(commandWord) {
        if (!commandWord) return false;
        const upper = String(commandWord).toUpperCase();
        if (upper === 'BACK') return this.stepPlaylist(-1);
        if (upper === 'NEXT') return this.stepPlaylist(1);
        return false;
    }

    getEstimatedSpawnWordLength() {
        const minutes = this.runTime / 60;
        const omenBonus = this.omenConfig?.wordLenBonus || 0;
        let minLen = Math.min(
            GameConfig.WORDS.MIN_CAP,
            Math.floor(GameConfig.WORDS.MIN_START + (this.wave * GameConfig.WORDS.PER_WAVE) + (minutes * GameConfig.WORDS.PER_MINUTE) + omenBonus)
        );
        let maxLen = Math.min(
            GameConfig.WORDS.MAX_CAP,
            Math.floor(GameConfig.WORDS.MAX_START + (this.wave * GameConfig.WORDS.PER_WAVE) + (minutes * GameConfig.WORDS.PER_MINUTE) + omenBonus)
        );
        if (minLen > maxLen) minLen = maxLen;
        return Math.max(2, (minLen + maxLen) * 0.5);
    }

    getTypingCapacityPerSecond() {
        const capCfg = GameConfig.DIFFICULTY_CAP || {};
        const maxWpm = Math.max(10, capCfg.MAX_HUMAN_WPM || 120);
        const charsPerWord = Math.max(1, capCfg.CHARS_PER_WORD || 5);
        const safety = Math.max(0.4, Math.min(1, capCfg.SAFETY_FACTOR || 0.82));
        return ((maxWpm * charsPerWord) / 60) * safety;
    }

    getEnemyTtcSeconds(enemy) {
        if (!enemy || enemy.isDead) return Infinity;
        const player = this.entityManager?.player;
        if (!player) return Infinity;

        const dx = (player.x || 0) - (enemy.x || 0);
        const dy = (player.y || 0) - (enemy.y || 0);
        const distance = Math.max(1, Math.hypot(dx, dy));

        if (enemy.isProjectileEnemy) {
            const shotSpeed = Math.hypot(enemy.vx || 0, enemy.vy || 0) * (this.enemySpeedMult || 1);
            if (!Number.isFinite(shotSpeed) || shotSpeed <= 0.01) return Infinity;
            return distance / shotSpeed;
        }

        const slowMult = (enemy.slowTimer && enemy.slowTimer > 0) ? (enemy.slowMult || 1) : 1;
        const speed = (enemy.baseSpeed || 0)
            * (enemy.speedMult || 1)
            * (this.enemySpeedMult || 1)
            * slowMult;
        if (!Number.isFinite(speed) || speed <= 0.01) return Infinity;

        if (enemy.type === 'turret') {
            const stopDistance = Number.isFinite(enemy.stopDistance) ? enemy.stopDistance : GameConfig.ENEMIES.TURRET.STOP_DISTANCE;
            if (distance <= stopDistance) {
                return Math.max(2, enemy.turretCooldown || GameConfig.ENEMIES.TURRET.SHOT_COOLDOWN || 2.2);
            }
            return (distance - stopDistance) / speed;
        }
        return distance / speed;
    }

    estimateSpawnTtcSeconds() {
        const capCfg = GameConfig.DIFFICULTY_CAP || {};
        const minTtc = Math.max(0.8, capCfg.MIN_TTC_SECONDS || 2.4);
        const targetTtc = Math.max(minTtc, capCfg.TARGET_TTC_SECONDS || 5.2);
        const approxDistance = Math.max(120, (Math.max(this.width || 0, this.height || 0) * 0.45));
        const baseSpeed = (GameConfig.ENEMIES.BASE_SPEED + (this.difficulty * 5))
            * (GameConfig.BALANCE?.ENEMY_SPEED_MULT || 1)
            * (this.omenConfig?.speedMult || 1)
            * (this.enemySpeedMult || 1);
        if (!Number.isFinite(baseSpeed) || baseSpeed <= 0.01) return targetTtc;
        const ttc = approxDistance / baseSpeed;
        return Math.max(minTtc, Math.min(targetTtc, ttc));
    }

    getSpawnLoadState(extraWordLength = 0) {
        const capCfg = GameConfig.DIFFICULTY_CAP || {};
        const minTtc = Math.max(0.8, capCfg.MIN_TTC_SECONDS || 2.4);
        const targetTtc = Math.max(minTtc, capCfg.TARGET_TTC_SECONDS || 5.2);
        const minCap = Math.max(1, Math.floor(capCfg.MIN_ACTIVE_ENEMIES || 5));
        const capHardLimit = Math.max(minCap, Math.floor(capCfg.MAX_ACTIVE_ENEMIES || 26));
        const maxByConfig = Math.max(
            minCap,
            Math.floor(GameConfig.ENEMIES.MAX_ACTIVE * (this.omenConfig?.maxEnemiesMult || 1))
        );
        const typingCapacity = this.getTypingCapacityPerSecond();
        const enemies = (this.entityManager?.enemies || []).filter(enemy => enemy && !enemy.isDead);
        const activeCount = enemies.length;

        let totalWordLen = 0;
        let totalWordCount = 0;
        let demand = 0;
        const ttcSamples = [];

        for (const enemy of enemies) {
            const fullWordLen = Math.max(2, String(enemy.word || '').length || 2);
            const typedIndex = Math.max(0, Math.min(fullWordLen, enemy.typedIndex || 0));
            const remainingChars = Math.max(1, fullWordLen - typedIndex);
            totalWordLen += fullWordLen;
            totalWordCount++;

            const ttc = this.getEnemyTtcSeconds(enemy);
            if (!Number.isFinite(ttc)) continue;
            ttcSamples.push(ttc);
            const window = Math.max(0.45, Math.min(targetTtc, Math.max(minTtc, ttc)));
            demand += remainingChars / window;
        }

        const projectedWordLength = Number.isFinite(extraWordLength) && extraWordLength > 0
            ? extraWordLength
            : this.getEstimatedSpawnWordLength();
        const projectedTtc = this.estimateSpawnTtcSeconds();
        demand += Math.max(1, projectedWordLength) / projectedTtc;

        const avgWordLen = totalWordCount > 0
            ? (totalWordLen / totalWordCount)
            : this.getEstimatedSpawnWordLength();

        const urgentWindow = (() => {
            if (ttcSamples.length === 0) return targetTtc;
            const sorted = ttcSamples.sort((a, b) => a - b);
            const takeCount = Math.min(6, sorted.length);
            const slice = sorted.slice(0, takeCount);
            const avg = slice.reduce((sum, value) => sum + value, 0) / takeCount;
            return Math.max(minTtc, Math.min(targetTtc, avg));
        })();

        const wpmCap = Math.floor((typingCapacity * urgentWindow) / Math.max(1, avgWordLen));
        const dynamicCap = Math.max(minCap, Math.min(capHardLimit, wpmCap));
        const maxAllowed = Math.max(minCap, Math.min(maxByConfig, dynamicCap));

        const projectedLoadRatio = typingCapacity > 0 ? (demand / typingCapacity) : Infinity;
        const underCountCap = activeCount < maxAllowed;
        const underTypingCap = projectedLoadRatio <= 1;

        return {
            activeCount,
            maxAllowed,
            typingCapacity,
            projectedLoadRatio,
            underCountCap,
            underTypingCap
        };
    }

    canSpawnEnemy(extraWordLength = 0, source = 'ambient') {
        if (source === 'ambient' && !this.canSpawnAmbientEnemies()) return false;
        const load = this.getSpawnLoadState(extraWordLength);
        return load.underCountCap && load.underTypingCap;
    }

    spawnEnemy(force = false, source = 'ambient') {
        if (!force && !this.canSpawnEnemy(0, source)) return null;
        const word = this.getWordForDifficulty();
        if (!word) return null;

        let type = 'drone';
        const rand = Math.random();

        const introCfg = GameConfig.ENEMIES?.INTRO || {};
        const rusherWave = Number.isFinite(introCfg.RUSHER_WAVE) ? introCfg.RUSHER_WAVE : 3;
        const turretWave = Number.isFinite(introCfg.TURRET_WAVE) ? introCfg.TURRET_WAVE : 5;
        const tankWave = Number.isFinite(introCfg.TANK_WAVE) ? introCfg.TANK_WAVE : 7;

        const splitterCfg = GameConfig.SPLITTER || {};
        const splitterUnlock = Number.isFinite(splitterCfg.UNLOCK_WAVE) ? splitterCfg.UNLOCK_WAVE : 9;
        const splitterStart = Number.isFinite(splitterCfg.CHANCE_START) ? splitterCfg.CHANCE_START : 0.06;
        const splitterMax = Number.isFinite(splitterCfg.CHANCE_MAX) ? splitterCfg.CHANCE_MAX : 0.12;
        const splitterRamp = 0.004;
        const splitterChance = this.wave >= splitterUnlock
            ? Math.max(0, Math.min(splitterMax, splitterStart + (this.wave - splitterUnlock) * splitterRamp))
            : 0;

        if (splitterChance > 0 && rand < splitterChance) {
            type = 'splitter';
        } else {
            const r = splitterChance > 0 ? (rand - splitterChance) / (1 - splitterChance) : rand;
            if (this.wave >= tankWave) {
                if (r < 0.12) type = 'tank';
                else if (r < 0.30) type = 'turret';
                else if (r < 0.55) type = 'rusher';
            } else if (this.wave >= turretWave) {
                if (r < 0.15) type = 'turret';
                else if (r < 0.40) type = 'rusher';
            } else if (this.wave >= rusherWave) {
                if (r < 0.25) type = 'rusher';
            }
        }

        const traits = this.rollTraits();
        return this.entityManager.spawnEnemy(word, type, traits);
    }

    draw() {
        try {
            this.renderer.draw(this.entityManager);
        } catch (error) {
            console.error('SurvivalGame: renderer draw failed.', error);
        }
    }

    handleInput(key) { 
        // Enemy tutorial popups should be modal: ignore typing/shortcuts while they are visible.
        if (this.enemyTutorialActiveType) return;

        if (this.state === GameStates.PLAYING) { 
            // Keyboard shortcuts for track control (kept out of the typing system). 
            if (key === '[') { 
                this.stepPlaylist(-1); 
                return; 
            } 
            if (key === ']') {
                this.stepPlaylist(1);
                return;
            }

            const consumed = this.handlePlaylistCommandKey(key);
            if (!consumed) {
                this.typingSystem.processKey(key);
            }
            return;
        }
        if (this.state === GameStates.LEVEL_UP) {
            if (this.upgradeManager && typeof this.upgradeManager.handleTypingKey === 'function') {
                this.upgradeManager.handleTypingKey(key);
            }
        }
    }

    ensureLoop() {
        if (this.rafId === null) {
            this.rafId = requestAnimationFrame(this.loop);
        }
    }

    pause(state = GameStates.LEVEL_UP) {
        this.state = state;
        this.resetCommandInput();
    }

    resume() {
        this.state = GameStates.PLAYING;
        this.resetCommandInput();
        this.lastTime = performance.now();
        this.ensureLoop();
    }

    stop() {
        this.state = GameStates.MENU;
        this.resetCommandInput();
        this.setAudioPanelOpen(false);
        this.enemyTutorialQueue = [];
        this.enemyTutorialActiveType = '';
        if (this.ui?.enemyTutorialModal) this.ui.enemyTutorialModal.style.display = 'none';
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.audioManager.stopBGM();
        document.body.classList.remove('survival-active');
    }

    loadOmenLevel() {
        const raw = localStorage.getItem(GameConfig.OMEN.STORAGE_KEY);
        const parsed = Number.parseInt(raw, 10);
        if (Number.isNaN(parsed)) return 0;
        return Math.max(0, Math.min(2, parsed));
    }

    buildWordBuckets() {
        const source = this.getWordSource();
        if (!source || source.length === 0) return;
        if (this.wordBuckets) return;

        this.wordBuckets = new Map();
        this.wickedWords = [];
        const rareLetters = /[qxzjkv]/i;

        source.forEach(word => {
            const w = String(word).trim();
            if (!w) return;
            if (this.isReservedCommandWord(w)) return;
            const len = w.length;
            if (!this.wordBuckets.has(len)) this.wordBuckets.set(len, []);
            this.wordBuckets.get(len).push(w);
            if (rareLetters.test(w)) this.wickedWords.push(w);
        });
    }

    getWordForDifficulty(excludeWord = '') {
        const source = this.getWordSource();
        if (!source || source.length === 0) return 'target';

        this.buildWordBuckets();

        const minutes = this.runTime / 60;
        const omenBonus = this.omenConfig.wordLenBonus;
        let minLen = Math.min(
            GameConfig.WORDS.MIN_CAP,
            Math.floor(GameConfig.WORDS.MIN_START + (this.wave * GameConfig.WORDS.PER_WAVE) + (minutes * GameConfig.WORDS.PER_MINUTE) + omenBonus)
        );
        let maxLen = Math.min(
            GameConfig.WORDS.MAX_CAP,
            Math.floor(GameConfig.WORDS.MAX_START + (this.wave * GameConfig.WORDS.PER_WAVE) + (minutes * GameConfig.WORDS.PER_MINUTE) + omenBonus)
        );
        if (minLen > maxLen) minLen = maxLen;

        let picked = null;

        const wickedChance = Math.min(0.5, GameConfig.WORDS.WICKED_CHANCE_START + (this.wave * GameConfig.WORDS.WICKED_CHANCE_PER_WAVE));
        if (this.wickedWords.length > 0 && Math.random() < wickedChance) {
            picked = this.pickDifferentWord(this.wickedWords, excludeWord);
        }

        if (!picked && this.wordBuckets) {
            const candidates = [];
            for (let len = minLen; len <= maxLen; len++) {
                const bucket = this.wordBuckets.get(len);
                if (bucket && bucket.length > 0) candidates.push(bucket);
            }
            if (candidates.length > 0) {
                const bucket = candidates[Math.floor(Math.random() * candidates.length)];
                picked = this.pickDifferentWord(bucket, excludeWord);
            }
        }

        if (!picked) {
            picked = this.pickDifferentWord(source, excludeWord);
        }

        return this.decorateWordForStrict(picked);
    }

    pickStrictSpaceWord(excludeWord = '') {
        const source = this.getWordSource();
        if (!source || source.length === 0) return '';
        this.buildWordBuckets();

        const buckets = [];
        for (let len = 2; len <= 4; len++) {
            const bucket = this.wordBuckets ? this.wordBuckets.get(len) : null;
            if (bucket && bucket.length > 0) buckets.push(bucket);
        }
        if (buckets.length > 0) {
            const bucket = buckets[Math.floor(Math.random() * buckets.length)];
            return this.pickDifferentWord(bucket, excludeWord);
        }
        return this.pickDifferentWord(source, excludeWord);
    }

    decorateWordForStrict(word, opts = {}) {
        const strict = GameConfig.DIFFICULTY?.STRICT_MODE ?? GameConfig.DIFFICULTY_CAP?.STRICT_MODE;
        const raw = String(word || '');
        if (!strict) return raw;
        if (!raw || raw.length < 2) return raw;

        const allowSpaces = opts.allowSpaces !== false;
        const allowCaps = opts.allowCaps !== false;
        const allowPunct = opts.allowPunct !== false;

        let decorated = raw;

        if (allowSpaces && decorated.length >= 3 && decorated.length <= 6 && Math.random() < 0.18) {
            const extra = this.pickStrictSpaceWord(decorated);
            if (extra && extra !== decorated) {
                const phrase = `${decorated} ${extra}`;
                if (phrase.length <= 12) decorated = phrase;
            }
        }

        // Randomly capitalize first letter
        if (allowCaps && Math.random() < 0.5) {
            decorated = decorated.charAt(0).toUpperCase() + decorated.slice(1);
        }

        // Randomly add punctuation at the end
        if (allowPunct && Math.random() < 0.3) {
            const punct = ['.', '!', '?'];
            decorated += punct[Math.floor(Math.random() * punct.length)];
        }

        return decorated;
    }

    pickDifferentWord(list, excludeWord) {
        if (!list || list.length === 0) return 'target';
        const filtered = list.filter(word => !this.isReservedCommandWord(word));
        const source = filtered.length > 0 ? filtered : list;
        if (!excludeWord || source.length < 2) {
            return source[Math.floor(Math.random() * source.length)];
        }
        let candidate = excludeWord;
        let safety = 0;
        while ((candidate === excludeWord || this.isReservedCommandWord(candidate)) && safety < 20) {
            candidate = source[Math.floor(Math.random() * source.length)];
            safety++;
        }
        if (this.isReservedCommandWord(candidate)) return 'target';
        return candidate;
    }

    getWordSource() {
        if (this.wordList && this.wordList.length > 0) {
            return this.wordList.filter(word => !this.isReservedCommandWord(word));
        }
        if (window.localDictionary && Array.isArray(window.localDictionary.words)) {
            return window.localDictionary.words.filter(word => !this.isReservedCommandWord(word));
        }
        return [];
    }

    getSpawnInterval() {
        const base = GameConfig.WAVES.INITIAL_SPAWN_TIMER
            - (this.wave - 1) * GameConfig.WAVES.TIMER_SCALING
            - (this.runTime / 60) * GameConfig.WAVES.TIME_SCALING;
        const interval = Math.max(GameConfig.WAVES.MIN_SPAWN_TIMER, base);
        const balanceMult = GameConfig.BALANCE?.ENEMY_SPAWN_INTERVAL_MULT || 1;
        let mult = this.omenConfig.spawnIntervalMult * balanceMult;
        if (this.trialState?.enabled && this.trialState.activeBossEnemyId) {
            const bossMult = GameConfig.TRIALS?.BOSS_PHASE?.AMBIENT_SPAWN_INTERVAL_MULT;
            if (Number.isFinite(bossMult) && bossMult > 0) mult *= bossMult;
        }
        return interval * mult;
    }

    getShortWord(minLen, maxLen, excludeWord = '') {
        const source = this.getWordSource();
        if (!source || source.length === 0) return this.getWordForDifficulty(excludeWord);
        this.buildWordBuckets();

        const candidates = [];
        if (this.wordBuckets) {
            for (let len = minLen; len <= maxLen; len++) {
                const bucket = this.wordBuckets.get(len);
                if (bucket && bucket.length > 0) candidates.push(bucket);
            }
        }
        if (candidates.length > 0) {
            const bucket = candidates[Math.floor(Math.random() * candidates.length)];
            return this.decorateWordForStrict(this.pickDifferentWord(bucket, excludeWord), { allowSpaces: false });
        }
        return this.decorateWordForStrict(this.pickDifferentWord(source, excludeWord), { allowSpaces: false });
    }

    getItemWord(excludeWord = '') {
        return this.getShortWord(GameConfig.ITEMS.WORD_MIN, GameConfig.ITEMS.WORD_MAX, excludeWord);
    }

    getProjectileWord(excludeWord = '') {
        return this.getShortWord(GameConfig.ITEMS.WORD_MIN, GameConfig.ITEMS.WORD_MAX, excludeWord);
    }

    rollTraits() {
        const traits = {};
        const multiplier = this.omenConfig.traitChanceMult;
        const { ARMOR, STEALTH, SHIELD, BUFFER } = GameConfig.ENEMIES.TRAITS;

        const traitPool = [];
        if (this.wave >= ARMOR.UNLOCK_WAVE && Math.random() < ARMOR.BASE_CHANCE * multiplier) traitPool.push('armor');
        if (this.wave >= STEALTH.UNLOCK_WAVE && Math.random() < STEALTH.BASE_CHANCE * multiplier) traitPool.push('stealth');
        if (this.wave >= SHIELD.UNLOCK_WAVE && Math.random() < SHIELD.BASE_CHANCE * multiplier) traitPool.push('shield');
        if (this.wave >= BUFFER.UNLOCK_WAVE && Math.random() < BUFFER.BASE_CHANCE * multiplier) traitPool.push('buffer');

        if (traitPool.length === 0) return traits;

        const picked = traitPool[Math.floor(Math.random() * traitPool.length)];
        traits[picked] = true;
        return traits;
    }

    async loadOxfordWordList() {
        if (this.wordListPromise) return this.wordListPromise;
        this.wordListPromise = (async () => {
            try {
                const res = await fetch('The_Oxford_5000.csv', { cache: 'no-cache' });
                if (!res.ok) throw new Error(`Oxford list HTTP ${res.status}`);
                const text = await res.text();
                const words = this.parseOxfordCsv(text);
                if (words.length > 0) {
                    this.wordList = words;
                    this.wordBuckets = null;
                    this.buildWordBuckets();
                }
            } catch (err) {
                console.warn('Oxford word list load failed, using fallback.', err);
            }
        })();
        return this.wordListPromise;
    }

    parseOxfordCsv(csvText) {
        const lines = csvText.split(/\r?\n/);
        const words = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;
            const cols = this.parseCsvLine(line);
            if (!cols || cols.length === 0) continue;
            const rawWord = cols[0] || '';
            const cleaned = this.cleanOxfordWord(rawWord);
            cleaned.forEach(word => {
                if (word.length >= 2) words.push(word);
            });
        }
        return Array.from(new Set(words));
    }

    parseCsvLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current);
        return result;
    }

    cleanOxfordWord(rawWord) {
        const stripped = String(rawWord)
            .replace(/\([^)]*\)/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        if (!stripped) return [];

        const parts = stripped.split(/[,/]/).map(part => part.trim()).filter(Boolean);
        const cleaned = [];
        for (const part of parts) {
            const normalized = part.replace(/[^a-z]/g, '');
            if (normalized && normalized.length >= 2 && !this.isReservedCommandWord(normalized)) {
                cleaned.push(normalized);
            }
        }
        return cleaned;
    }
}
