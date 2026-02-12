/**
 * AudioManager.js
 * Handles synthesized sound effects using Web Audio API.
 * Fits the retro/geometric aesthetic without needing assets.
 */

export default class AudioManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3; // Specific volume
        this.masterGain.connect(this.ctx.destination);

        // BGM Support
        this.bgm = new Audio('audio/survival_bgm_01.mp3');
        this.bgm.loop = true;
        this.bgm.volume = 0.4;
    }

    playBGM() {
        if (this.bgm) {
            this.bgm.currentTime = 0;
            this.bgm.play().catch(e => console.warn("BGM autoplay blocked:", e));
        }
    }

    stopBGM() {
        if (this.bgm) {
            // Simple fade out
            const fadeInterval = setInterval(() => {
                if (this.bgm.volume > 0.05) {
                    this.bgm.volume -= 0.05;
                } else {
                    this.bgm.pause();
                    this.bgm.volume = 0.4; // Reset for next time
                    clearInterval(fadeInterval);
                }
            }, 50);
        }
    }

    playTone(freq, type, duration, vol = 1) {
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playShoot() {
        // High pitch pew
        this.playTone(600, 'square', 0.1, 0.2);

        // Slide down effect
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }

    playHit() {
        // Short noise-like blip
        this.playTone(200, 'square', 0.05, 0.2);
    }

    playExplosion() {
        // Low rumble
        this.playTone(100, 'sawtooth', 0.3, 0.4);
        this.playTone(50, 'square', 0.4, 0.4);
    }

    playLevelUp() {
        // Victory arpeggio
        const now = this.ctx.currentTime;
        [440, 554, 659, 880].forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.3, now + i * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(now + i * 0.1);
            osc.stop(now + i * 0.1 + 0.3);
        });
    }

    playGameOver() {
        // Sad slide
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + 1.0);
        gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.0);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + 1.0);
    }
}
