/**
 * AudioManager.js
 * Manages background music playlist (with analysis) and synthesized SFX.
 *
 * MP3 playlist:
 * Place .mp3 files in public/audio/ and add them to BGM_PLAYLIST.
 */

import AudioAnalysis from './AudioAnalysis.js';

// Playlist config
const BGM_PLAYLIST = [
    'audio/survival_bgm_01.mp3',
    'audio/Wildfire.mp3',
    'audio/TheFatRat - Unity.mp3',
    'audio/NF - The Search.mp3',
    'audio/Muse - Undisclosed Desires.mp3',
    'audio/Muse - Time Is Running Out (video).mp3',
    'audio/Hozier - Too Sweet (Official Video).mp3',
    'audio/Hayd - Head In The Clouds (Official Video).mp3',
    'audio/James Blunt - 1973 (Official Music Video).mp3',
    'audio/Bon Jovi  Its My Life (Synthwave Rock Cover).mp3',
    'audio/Alvaro Soler - El Mismo Sol.mp3',
    'audio/Artemas - i like the way you kiss me (official music video).mp3',
    'audio/Pascal Letoublon - Friendships (Lost My Love) (Lyric Video) ft. Leony.mp3',
    'audio/SawanoHiroyuki[nZk]_XAI DARK ARIA LV2 Music Video.mp3',
    'audio/LiSAReawakeR (feat. Felix of Stray Kids)MUSiC CLiP.mp3',
    "audio/Tom's Diner (Cover) - AnnenMayKantereit x Giant Rooks.mp3",
    'audio/Clair Obscur_ Expedition 33  Lumi%C3%A8re [Official Music Video].mp3'
];

function dedupePlaylist(list) {
    const deduped = [];
    const seen = new Set();
    (Array.isArray(list) ? list : [])
        .map(src => String(src || '').trim())
        .filter(Boolean)
        .forEach(src => {
            const key = src.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            deduped.push(src);
        });
    return deduped;
}

export default class AudioManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3;
        this.masterGain.connect(this.ctx.destination);
        this._bgmStorageKey = 'survival_bgm_volume';
        this._sfxStorageKey = 'survival_sfx_volume';
        this.bgmVolume = this._readVolume(this._bgmStorageKey, 0.6);
        this.sfxVolume = this._readVolume(this._sfxStorageKey, 0.8);

        // BGM gain (separate from SFX so music can fade independently)
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.value = this.bgmVolume;
        this.bgmGain.connect(this.masterGain);

        // SFX gain (independent slider from BGM)
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.sfxVolume;
        this.sfxGain.connect(this.masterGain);

        // Playlist state
        const configured = Array.isArray(window.SURVIVAL_BGM_PLAYLIST)
            ? window.SURVIVAL_BGM_PLAYLIST
            : [];
        this._configuredPlaylist = dedupePlaylist(configured);
        this._replacePlaylist = window.SURVIVAL_BGM_REPLACE === true;
        this._allowSingleTrack = window.SURVIVAL_BGM_ALLOW_SINGLE === true;
        let deduped = this._rebuildPlaylistFromConfig();

        this.playlist = deduped;
        this.currentTrackIndex = 0;
        this.bgm = null;
        this.bgmSourceNode = null;
        this.analysis = null;
        this._bgmConnected = false;
        this._fadeInterval = null;
        this._onEndedBound = () => this.playNextTrack({ autoplay: true, reshuffleOnWrap: true });
        this.onTrackChange = null;

        if (this.playlist.length > 1) {
            this._shufflePlaylist();
        }
        this._loadCurrentTrack();
    }

    _rebuildPlaylistFromConfig() {
        const source = this._replacePlaylist
            ? this._configuredPlaylist
            : [...this._configuredPlaylist, ...BGM_PLAYLIST];
        let deduped = dedupePlaylist(source);
        if (!this._allowSingleTrack && deduped.length <= 1) {
            deduped = dedupePlaylist([...this._configuredPlaylist, ...BGM_PLAYLIST]);
        }
        return deduped;
    }

    _ensurePlaylistCapacity() {
        if (this._allowSingleTrack) return;
        const len = this.playlist?.length || 0;
        if (len > 1) return;
        this.playlist = this._rebuildPlaylistFromConfig();
        const safeLen = this.playlist?.length || 0;
        if (safeLen <= 0) {
            this.currentTrackIndex = 0;
            return;
        }
        this.currentTrackIndex = ((this.currentTrackIndex % safeLen) + safeLen) % safeLen;
    }

    _readVolume(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            const parsed = Number.parseFloat(raw);
            if (!Number.isFinite(parsed)) return fallback;
            return Math.max(0, Math.min(1, parsed));
        } catch (_) {
            return fallback;
        }
    }

    _persistVolume(key, value) {
        try {
            localStorage.setItem(key, String(value));
        } catch (_) {
            // ignore storage failures
        }
    }

    // Playlist management
    _loadCurrentTrack() {
        if (!Array.isArray(this.playlist) || this.playlist.length === 0) {
            this.bgm = null;
            this._notifyTrackChange();
            return;
        }

        const len = this.playlist.length;
        this.currentTrackIndex = ((this.currentTrackIndex % len) + len) % len;
        const src = this.playlist[this.currentTrackIndex];
        this.bgm = new Audio(this._normalizeTrackSrc(src));
        this.bgm.loop = (len === 1);
        this.bgm.crossOrigin = 'anonymous';
        this._bgmConnected = false;

        // Auto-advance when playlist has multiple tracks
        if (len > 1) {
            this.bgm.addEventListener('ended', this._onEndedBound);
            this.bgm.addEventListener('error', () => {
                this.playNextTrack({ autoplay: true, reshuffleOnWrap: false });
            }, { once: true });
        }
        this._notifyTrackChange();
    }

    _normalizeTrackSrc(src) {
        const raw = String(src || '').trim();
        if (!raw) return '';
        try {
            return encodeURI(decodeURI(raw)).replace(/'/g, '%27');
        } catch (_) {
            return encodeURI(raw).replace(/'/g, '%27');
        }
    }

    _shufflePlaylist() {
        for (let i = this.playlist.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
        }
    }

    _teardownCurrentTrack() {
        if (this.bgm) {
            this.bgm.removeEventListener('ended', this._onEndedBound);
            this.bgm.pause();
            this.bgm.removeAttribute('src');
        }

        // MediaElementSourceNode cannot be reused across elements.
        this._disconnectBGMGraph();
    }

    _switchTrackByIndex(nextIndex, opts = {}) {
        const { autoplay } = opts;
        if (!Array.isArray(this.playlist) || this.playlist.length === 0) return false;

        const shouldAutoplay = autoplay === undefined
            ? !!(this.bgm && !this.bgm.paused)
            : !!autoplay;

        this._teardownCurrentTrack();
        this.currentTrackIndex = nextIndex;
        this._loadCurrentTrack();
        this._connectBGMGraph();

        if (shouldAutoplay && this.bgm) {
            this.bgm.play().catch(() => { /* autoplay policy */ });
        }
        return true;
    }

    _notifyTrackChange() {
        if (typeof this.onTrackChange !== 'function') return;
        const src = this.playlist?.[this.currentTrackIndex] || '';
        this.onTrackChange({
            index: this.currentTrackIndex,
            total: this.playlist?.length || 0,
            src,
            label: this.getCurrentTrackName()
        });
    }

    setTrackChangeListener(listener) {
        this.onTrackChange = typeof listener === 'function' ? listener : null;
        this._notifyTrackChange();
    }

    setBgmVolume(value) {
        const next = Math.max(0, Math.min(1, Number.isFinite(value) ? value : this.bgmVolume));
        this.bgmVolume = next;
        this._persistVolume(this._bgmStorageKey, next);
        if (this.bgmGain) {
            this.bgmGain.gain.value = next;
        }
    }

    setSfxVolume(value) {
        const next = Math.max(0, Math.min(1, Number.isFinite(value) ? value : this.sfxVolume));
        this.sfxVolume = next;
        this._persistVolume(this._sfxStorageKey, next);
        if (this.sfxGain) {
            this.sfxGain.gain.value = next;
        }
    }

    getBgmVolume() {
        return this.bgmVolume;
    }

    getSfxVolume() {
        return this.sfxVolume;
    }

    getCurrentTrackName() {
        const src = this.playlist?.[this.currentTrackIndex] || '';
        if (!src) return 'No Track';
        const filename = src.split('/').pop() || src;
        try {
            return decodeURIComponent(filename).replace(/\.[^/.]+$/, '');
        } catch (_) {
            return filename.replace(/\.[^/.]+$/, '');
        }
    }

    playNextTrack(opts = {}) {
        this._ensurePlaylistCapacity();
        const { autoplay, reshuffleOnWrap = true } = opts;
        const len = this.playlist?.length || 0;
        if (len === 0) return false;
        // If there's only one track, NEXT/BACK shouldn't claim to advance.
        if (len === 1) return false;

        let nextIndex = this.currentTrackIndex + 1;
        if (nextIndex >= len) {
            if (reshuffleOnWrap) this._shufflePlaylist();
            nextIndex = 0;
        }
        return this._switchTrackByIndex(nextIndex, { autoplay });
    }

    playPreviousTrack(opts = {}) {
        this._ensurePlaylistCapacity();
        const { autoplay } = opts;
        const len = this.playlist?.length || 0;
        if (len === 0) return false;
        if (len === 1) return false;

        let nextIndex = this.currentTrackIndex - 1;
        if (nextIndex < 0) nextIndex = len - 1;
        return this._switchTrackByIndex(nextIndex, { autoplay });
    }

    // WebAudio graph
    _connectBGMGraph() {
        if (this._bgmConnected || !this.bgm) return;

        try {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => { });
            }
            this.bgmSourceNode = this.ctx.createMediaElementSource(this.bgm);
            this.analysis = new AudioAnalysis(this.ctx, this.bgmSourceNode);
            // Source -> analyser(pass-through) -> bgmGain -> masterGain
            this.analysis.analyser.connect(this.bgmGain);
            this._bgmConnected = true;
        } catch (error) {
            // Fallback: play without analysis if graph setup fails.
            console.warn('AudioManager: Web Audio graph failed, playing without analysis.', error);
        }
    }

    _disconnectBGMGraph() {
        try {
            if (this.analysis?.analyser) this.analysis.analyser.disconnect();
            if (this.bgmSourceNode) this.bgmSourceNode.disconnect();
        } catch (_) {
            // Already disconnected.
        }
        this.bgmSourceNode = null;
        this.analysis = null;
        this._bgmConnected = false;
    }

    // Public API
    update(deltaTime) {
        if (this.analysis) {
            this.analysis.update(deltaTime);
        }
    }

    playBGM() {
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
        }
        this.bgmGain.gain.value = this.bgmVolume;

        this._connectBGMGraph();

        if (this.bgm) {
            this.bgm.currentTime = 0;
            this.bgm.play().catch(() => { /* autoplay policy */ });
        }
    }

    stopBGM() {
        // Fade out via WebAudio gain (not HTML audio volume).
        if (this._fadeInterval) clearInterval(this._fadeInterval);
        const gain = this.bgmGain.gain;
        this._fadeInterval = setInterval(() => {
            if (gain.value > 0.02) {
                gain.value = Math.max(0, gain.value - 0.04);
            } else {
                gain.value = 0;
                if (this.bgm) this.bgm.pause();
                clearInterval(this._fadeInterval);
                this._fadeInterval = null;
            }
        }, 50);
    }

    // SFX
    playTone(freq, type, duration, vol = 1) {
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.sfxGain);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playShoot() {
        this.playTone(600, 'square', 0.1, 0.2);

        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }

    playHit() {
        this.playTone(200, 'square', 0.05, 0.2);
    }

    playExplosion() {
        this.playTone(100, 'sawtooth', 0.3, 0.4);
        this.playTone(50, 'square', 0.4, 0.4);
    }

    playLevelUp() {
        const now = this.ctx.currentTime;
        [440, 554, 659, 880].forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.3, now + i * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
            osc.connect(gain);
            gain.connect(this.sfxGain);
            osc.start(now + i * 0.1);
            osc.stop(now + i * 0.1 + 0.3);
        });
    }

    playGameOver() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + 1.0);
        gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.0);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start();
        osc.stop(this.ctx.currentTime + 1.0);
    }
}
