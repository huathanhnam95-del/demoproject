/**
 * AudioAnalysis.js
 * Real-time audio analysis using Web Audio API.
 * Calculates Spectral Flux for intensity and performs adaptive beat detection.
 */
export default class AudioAnalysis {
    constructor(audioContext, sourceNode) {
        this.ctx = audioContext;
        this.source = sourceNode;

        // FFT Setup
        this.fftSize = 1024;
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = this.fftSize;
        this.analyser.smoothingTimeConstant = 0.8;

        const binCount = this.analyser.frequencyBinCount; // fftSize / 2

        // Pre-allocate typed arrays to avoid GC pressure every frame
        this._byteData = new Uint8Array(binCount);
        this._prevSpectrum = new Uint8Array(binCount);

        // Connect source -> analyser (pass-through node; AudioManager connects analyser -> gain)
        this.source.connect(this.analyser);

        // Beat Detection State
        this._fluxHistory = new Float32Array(60); // ~1s of history at 60fps
        this._historyIndex = 0;
        this._historyFilled = false;
        this.sensitivity = 1.5;
        this.minFluxThreshold = 30;

        // Output values
        this.currentFlux = 0;
        this.averageFlux = 0;
        this.intensity = 0;
        this._beatDetected = false;
    }

    update(deltaTime) {
        // Read frequency data into pre-allocated buffer
        this.analyser.getByteFrequencyData(this._byteData);

        // Calculate Spectral Flux (half-wave rectified difference)
        let flux = 0;
        const data = this._byteData;
        const prev = this._prevSpectrum;
        for (let i = 0, len = data.length; i < len; i++) {
            const diff = data[i] - prev[i];
            if (diff > 0) flux += diff; // Only positive changes (onsets)
            prev[i] = data[i];
        }

        this.currentFlux = flux;

        // Ring buffer for adaptive threshold history
        this._fluxHistory[this._historyIndex] = flux;
        this._historyIndex = (this._historyIndex + 1) % this._fluxHistory.length;
        if (this._historyIndex === 0) this._historyFilled = true;

        // Calculate running average
        const count = this._historyFilled ? this._fluxHistory.length : this._historyIndex;
        let sum = 0;
        for (let i = 0; i < count; i++) sum += this._fluxHistory[i];
        this.averageFlux = count > 0 ? sum / count : 0;

        // Beat detection: flux must exceed adaptive threshold AND noise gate
        this._beatDetected = (flux > this.averageFlux * this.sensitivity)
            && (flux > this.minFluxThreshold);

        // Frame-rate independent intensity smoothing
        // Using exponential decay: intensity = lerp(intensity, target, 1 - e^(-lambda * dt))
        const targetIntensity = Math.min(1, flux / 2500);
        const lambda = 8; // Higher = faster response
        const dt = deltaTime || (1 / 60);
        const alpha = 1 - Math.exp(-lambda * dt);
        this.intensity += (targetIntensity - this.intensity) * alpha;
    }

    getIntensity() {
        return this.intensity;
    }

    isBeat() {
        return this._beatDetected;
    }
}
