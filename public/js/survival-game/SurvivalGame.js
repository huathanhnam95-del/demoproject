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
import { GameStates, GameConfig } from './GameConfig.js';

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
        this.damageMult = 1;
        this.enemySpeedMult = 1;
        this.itemWeightBonus = {};
        this.itemLifetimeMult = 1;
        this.pickupToast = null;

        // Systems
        this.audioManager = new AudioManager();
        this.entityManager = new EntityManager(this);
        this.weaponSystem = new WeaponSystem(this);
        this.upgradeManager = new UpgradeManager(this);
        this.typingSystem = new TypingSystem(this.entityManager);
        this.renderer = new Renderer(this.canvas, this.ctx, this);

        this.loop = this.loop.bind(this);
        window.addEventListener('resize', () => this.resize());
        this.cacheUi();
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
            finalScore: document.getElementById('final-score'),
            finalWave: document.getElementById('final-wave')
        };

        if (!overlay) console.warn('SurvivalGame: overlay missing');
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
        this.damageMult = 1;
        this.enemySpeedMult = 1;
        this.itemWeightBonus = {};
        this.itemLifetimeMult = 1;
        this.entityManager.player.shieldCharges = 0;
        this._lastHpRounded = null;
        this.pickupToast = null;
        this.omenLevel = this.loadOmenLevel();
        this.omenConfig = GameConfig.OMEN.LEVELS[this.omenLevel] || GameConfig.OMEN.LEVELS[0];
        const interval = this.getSpawnInterval();
        this.spawnTimer = Math.max(GameConfig.WAVES.FIRST_SPAWN_DELAY || interval, interval);
        this.loadOxfordWordList();
        this.buildWordBuckets();
        if (this.ui?.gameOverModal) this.ui.gameOverModal.style.display = 'none';
        this.lastTime = performance.now();
        this.ensureLoop();

        try {
            this.audioManager.playBGM();
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

        this.entityManager.update(deltaTime);
        this.weaponSystem.update(deltaTime);
        this.typingSystem.update(deltaTime);

        // Smooth camera shake decay (Renderer reads this value).
        this.cameraShake = Math.max(0, this.cameraShake - deltaTime * 2.8);
        this.screenFlash = Math.max(0, this.screenFlash - deltaTime * 4.5);

        if (this.freezeTimer > 0) {
            this.freezeTimer = Math.max(0, this.freezeTimer - deltaTime);
        }
        if (this.doubleDamageTimer > 0) {
            this.doubleDamageTimer = Math.max(0, this.doubleDamageTimer - deltaTime);
            if (this.doubleDamageTimer === 0) {
                this.damageMult = 1;
                this.enemySpeedMult = 1;
            }
        }
        if (this.pickupToast) {
            this.pickupToast.time = Math.max(0, this.pickupToast.time - deltaTime);
            if (this.pickupToast.time <= 0) {
                this.pickupToast = null;
            }
        }

        // Spawning logic
        this.spawnTimer -= simDelta;
        if (this.spawnTimer <= 0) {
            const maxEnemies = Math.floor(GameConfig.ENEMIES.MAX_ACTIVE * this.omenConfig.maxEnemiesMult);
            if (this.entityManager.enemies.length < maxEnemies) {
                this.spawnEnemy();
            }
            this.spawnTimer = this.getSpawnInterval();
        }

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

        if (this.ui?.finalScore) this.ui.finalScore.textContent = Math.floor(this.score);
        if (this.ui?.finalWave) this.ui.finalWave.textContent = this.wave;

        const highScore = localStorage.getItem('survival_high_score') || 0;
        if (this.score > highScore) {
            localStorage.setItem('survival_high_score', Math.floor(this.score));
            if (this.ui?.finalScore) this.ui.finalScore.textContent += " (NEW RECORD!)";
        }
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
                this.doubleDamageTimer = Math.max(this.doubleDamageTimer, 6);
                this.damageMult = 2;
                this.enemySpeedMult = 1.2;
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

    spawnEnemy() {
        const word = this.getWordForDifficulty();

        let type = 'drone';
        const rand = Math.random();
        if (this.wave >= 6) {
            if (rand < 0.18) type = 'tank';
            else if (rand < 0.45) type = 'rusher';
            else if (rand < 0.62) type = 'turret';
        } else if (this.wave >= 3) {
            if (rand < 0.26) type = 'rusher';
            else if (rand < 0.36) type = 'turret';
        }

        const traits = this.rollTraits();
        this.entityManager.spawnEnemy(word, type, traits);
    }

    draw() {
        // Render
        try {
            this.renderer.draw(this.entityManager);
        } catch (e) {
            console.error("🔥 CRITICAL RENDER ERROR:", e);
        }

        // DEBUG: Heartbeat log every ~100 frames (approx 1.6s)
        if (!this._debugFrameCount) this._debugFrameCount = 0;
        this._debugFrameCount++;
        if (this._debugFrameCount % 100 === 0) {
            const player = this.entityManager.player;
            const playerHp = player ? (player.health ?? player.stats?.hp ?? 'N/A') : 'N/A';
            console.log(`[GameLoop] Size: ${this.width}x${this.height}, Entities: ${this.entityManager.getAllEntities().length}, PlayerHP: ${playerHp}`);
        }
    }

    handleInput(key) {
        if (this.state === GameStates.PLAYING) {
            this.typingSystem.processKey(key);
        }
    }

    ensureLoop() {
        if (this.rafId === null) {
            this.rafId = requestAnimationFrame(this.loop);
        }
    }

    pause(state = GameStates.LEVEL_UP) {
        this.state = state;
    }

    resume() {
        this.state = GameStates.PLAYING;
        this.lastTime = performance.now();
        this.ensureLoop();
    }

    stop() {
        this.state = GameStates.MENU;
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

        const wickedChance = Math.min(0.5, GameConfig.WORDS.WICKED_CHANCE_START + (this.wave * GameConfig.WORDS.WICKED_CHANCE_PER_WAVE));
        if (this.wickedWords.length > 0 && Math.random() < wickedChance) {
            return this.pickDifferentWord(this.wickedWords, excludeWord);
        }

        if (this.wordBuckets) {
            const candidates = [];
            for (let len = minLen; len <= maxLen; len++) {
                const bucket = this.wordBuckets.get(len);
                if (bucket && bucket.length > 0) candidates.push(bucket);
            }
            if (candidates.length > 0) {
                const bucket = candidates[Math.floor(Math.random() * candidates.length)];
                return this.pickDifferentWord(bucket, excludeWord);
            }
        }

        return this.pickDifferentWord(source, excludeWord);
    }

    pickDifferentWord(list, excludeWord) {
        if (!list || list.length === 0) return 'target';
        if (!excludeWord || list.length < 2) {
            return list[Math.floor(Math.random() * list.length)];
        }
        let candidate = excludeWord;
        let safety = 0;
        while (candidate === excludeWord && safety < 10) {
            candidate = list[Math.floor(Math.random() * list.length)];
            safety++;
        }
        return candidate;
    }

    getWordSource() {
        if (this.wordList && this.wordList.length > 0) return this.wordList;
        if (window.localDictionary && Array.isArray(window.localDictionary.words)) {
            return window.localDictionary.words;
        }
        return [];
    }

    getSpawnInterval() {
        const base = GameConfig.WAVES.INITIAL_SPAWN_TIMER
            - (this.wave - 1) * GameConfig.WAVES.TIMER_SCALING
            - (this.runTime / 60) * GameConfig.WAVES.TIME_SCALING;
        const interval = Math.max(GameConfig.WAVES.MIN_SPAWN_TIMER, base);
        return interval * this.omenConfig.spawnIntervalMult;
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
            return this.pickDifferentWord(bucket, excludeWord);
        }
        return this.pickDifferentWord(source, excludeWord);
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
            if (normalized && normalized.length >= 2) cleaned.push(normalized);
        }
        return cleaned;
    }
}
