/**
 * PraatAPI - Client for Parselmouth/Praat backend analysis
 * Replaces client-side pitchfinder with server-side Praat analysis
 */
export class PraatAPI {
    constructor(backendUrl = null) {
        this.backendUrl = backendUrl || this.detectBackendUrl();
        console.log('PraatAPI using backend:', this.backendUrl);
    }

    detectBackendUrl() {
        // Local development
        if (window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1') {
            return 'http://localhost:8080';
        }

        // Production - UPDATE THIS WITH YOUR CLOUD RUN URL
        return 'https://parselmouth-backend-1071929245506.us-central1.run.app';
    }

    async analyze(audioBlob, expectedSyllables = null) {
        // Convert to WAV if needed
        const wavBlob = await this.ensureWav(audioBlob);

        // Prepare form data
        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');
        if (expectedSyllables) {
            formData.append('expected_syllables', expectedSyllables.toString());
        }

        // Send to backend
        const response = await fetch(`${this.backendUrl}/analyze`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Analysis failed' }));
            throw new Error(error.error || 'Analysis failed');
        }

        return response.json();
    }

    /**
     * Analyze audio from URL (for native reference)
     * Used by WordReferenceService for MW audio analysis
     */
    async analyzeFromUrl(audioUrl, expectedSyllables = null) {
        const response = await fetch(`${this.backendUrl}/analyze-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audioUrl: audioUrl,
                expectedSyllables: expectedSyllables
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Analysis failed' }));
            throw new Error(error.error || 'Analysis failed');
        }

        return response.json();
    }

    async ensureWav(blob) {
        // Already WAV
        if (blob.type === 'audio/wav' || blob.type === 'audio/wave') {
            return blob;
        }

        // Convert to WAV using AudioContext
        const arrayBuffer = await blob.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        return this.audioBufferToWav(audioBuffer);
    }

    audioBufferToWav(buffer) {
        const numChannels = 1;
        const sampleRate = buffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        // Get mono channel
        const inputData = buffer.getChannelData(0);
        const dataLength = inputData.length;
        const wavBuffer = new ArrayBuffer(44 + dataLength * 2);
        const view = new DataView(wavBuffer);

        // Write WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataLength * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * bitDepth / 8, true);
        view.setUint16(32, numChannels * bitDepth / 8, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, dataLength * 2, true);

        // Write audio data
        let offset = 44;
        for (let i = 0; i < dataLength; i++) {
            const sample = Math.max(-1, Math.min(1, inputData[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([wavBuffer], { type: 'audio/wav' });
    }

    async checkHealth() {
        try {
            const response = await fetch(`${this.backendUrl}/health`, {
                method: 'GET',
                mode: 'cors'
            });
            return response.ok;
        } catch (error) {
            console.error('Health check failed:', error);
            return false;
        }
    }
}
