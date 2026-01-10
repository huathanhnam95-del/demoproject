import { YIN } from "https://esm.sh/pitchfinder";

export class PitchAnalyzer {
    constructor(sampleRate = 44100) {
        this.detectPitch = YIN({ sampleRate: sampleRate });
        this.sampleRate = sampleRate;
    }

    /**
     * Analyzes an audio buffer to extract pitch and energy over time.
     * @param {AudioBuffer} audioBuffer 
     * @returns {Object} { pitches: [], energies: [], times: [] }
     */
    analyze(audioBuffer) {
        const float32Array = audioBuffer.getChannelData(0); // Mono
        const bufferLength = float32Array.length;

        // Configuration for "frames"
        const windowSize = 2048; // ~46ms at 44.1kHz (Better for low-freq pitch detection)
        const hopSize = 512;     // ~11ms overlap

        const pitches = [];
        const energies = [];
        const times = [];

        for (let i = 0; i < bufferLength - windowSize; i += hopSize) {
            const chunk = float32Array.slice(i, i + windowSize);

            // Calculate pitch
            // pitchfinder returns null or a frequency
            let pitch = this.detectPitch(chunk);

            // Filter realistic human range (50Hz - 500Hz)
            if (pitch && (pitch < 50 || pitch > 500)) {
                pitch = null;
            }

            // Calculate energy (RMS)
            let sum = 0;
            for (let j = 0; j < chunk.length; j++) {
                sum += chunk[j] * chunk[j];
            }
            const rms = Math.sqrt(sum / chunk.length);

            pitches.push(pitch || null);
            energies.push(rms);
            times.push(i / this.sampleRate);
        }

        return { pitches, energies, times };
    }
}
