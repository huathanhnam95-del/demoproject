import { config } from './config.js';

/**
 * PraatAPI - Client for Parselmouth/Praat backend analysis
 * Replaces client-side pitchfinder with server-side Praat analysis
 */
export class PraatAPI {
    constructor(backendUrl = null) {
        this.backendUrl = backendUrl || config.backendUrl;
        /** @type {Promise<string|null>|null} Cached v3 support check */
        this._v3SupportPromise = null;
    }

    static ensureVerification(result, reason = 'V3_VERIFICATION_UNAVAILABLE') {
        if (result?.verification) return result;
        return {
            ...result,
            verification: {
                status: 'unrateable',
                count: { expected: null, observed: result?.syllable_count ?? null, status: 'unrateable', confidence: 0, reasons: [reason] },
                primary_stress: { applicable: false, expected: null, matches_expected: null, status: 'unrateable', confidence: 0, pitch_evidence: [], reasons: [reason] },
                model_revision: null
            },
            best_effort: result?.best_effort || {
                available: false,
                observed_count: result?.syllable_count ?? null,
                expected_stress_appears_strongest: null,
                advisory_only: true
            }
        };
    }

    // detectBackendUrl removed - using config.js source of truth

    /**
     * Check whether the backend supports v3 pronunciation analysis.
     * The result is cached for the lifetime of this PraatAPI instance.
     * @returns {Promise<string|null>} The v3 mode string ('active', 'shadow', 'off') or null on error.
     */
    async checkV3Support() {
        if (this._v3SupportPromise) return this._v3SupportPromise;
        this._v3SupportPromise = (async () => {
            try {
                const response = await fetch(`${this.backendUrl}/health`, {
                    method: 'GET',
                    mode: 'cors'
                });
                if (!response.ok) return null;
                const data = await response.json();
                return data.pronunciationV3Mode || null;
            } catch {
                return null;
            }
        })();
        return this._v3SupportPromise;
    }

    /**
     * Call the v3 analysis endpoint.
     * @param {Blob} audioBlob
     * @param {{ referenceIpa?: string, expectedSyllables?: number, targetWord?: string, variantId?: string }} options
     * @returns {Promise<object>} v3 analysis response
     */
    async analyzeV3(audioBlob, { referenceIpa, expectedSyllables, targetWord, variantId } = {}) {
        const wavBlob = await this.ensureWav(audioBlob);
        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');
        if (referenceIpa) {
            formData.append('reference_ipa', String(referenceIpa));
        }
        if (Number.isInteger(expectedSyllables) && expectedSyllables > 0) {
            formData.append('expected_syllables', String(expectedSyllables));
        }
        if (targetWord) {
            formData.append('target_word', String(targetWord));
        }
        if (variantId) {
            formData.append('variant_id', String(variantId));
        }

        const response = await fetch(`${this.backendUrl}/analyze/v3`, {
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
     * Run the admin-only comparison request.  This intentionally bypasses
     * `analyze()` and the learner V3 feature flag: the comparison response is
     * an explicit V2/V3 bake-off for the same recording.
     * @param {Blob} audioBlob
     * @param {{ referenceIpa?: string, expectedSyllables?: number, targetWord?: string, variantId?: string }} options
     * @returns {Promise<object>} comparison response containing v2 and v3 envelopes
     */
    async analyzeComparison(audioBlob, { referenceIpa, expectedSyllables, targetWord, variantId } = {}) {
        const wavBlob = await this.ensureWav(audioBlob);
        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');
        if (referenceIpa) {
            formData.append('reference_ipa', String(referenceIpa));
        }
        if (Number.isInteger(expectedSyllables) && expectedSyllables > 0) {
            formData.append('expected_syllables', String(expectedSyllables));
        }
        if (targetWord) {
            formData.append('target_word', String(targetWord));
        }
        if (variantId) {
            formData.append('variant_id', String(variantId));
        }

        const response = await fetch(`${this.backendUrl}/analyze/compare`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Comparison analysis failed' }));
            throw new Error(error.error || error.message || 'Comparison analysis failed');
        }

        return response.json();
    }

    async analyze(audioBlob, expectedSyllableCount = null, options = {}) {
        // Production learner feedback stays on target-aligned V2 unless a
        // future rollout explicitly opts into V3 analysis.
        if (config.features?.usePronunciationV3LearnerAnalysis === true) {
            try {
                const v3Mode = await this.checkV3Support();
                if (v3Mode === 'active' || v3Mode === 'shadow') {
                    const result = await this.analyzeV3(audioBlob, {
                        ...options,
                        expectedSyllables: expectedSyllableCount
                    });
                    return PraatAPI.ensureVerification(result);
                }
                return PraatAPI.ensureVerification({
                    analysisVersion: 'pronunciation-analysis-v3',
                    mode: v3Mode || 'unavailable',
                    is_rateable: false,
                    syllable_count: null,
                    observed_syllables: [],
                    best_effort: {
                        available: false,
                        observed_count: null,
                        expected_stress_appears_strongest: null,
                        advisory_only: true
                    }
                }, 'V3_NOT_ACTIVE');
            } catch {
                return PraatAPI.ensureVerification({
                    analysisVersion: 'pronunciation-analysis-v3',
                    mode: 'unavailable',
                    is_rateable: false,
                    syllable_count: null,
                    observed_syllables: [],
                    best_effort: {
                        available: false,
                        observed_count: null,
                        expected_stress_appears_strongest: null,
                        advisory_only: true
                    }
                }, 'V3_VERIFICATION_UNAVAILABLE');
            }
        }

        // V2 path (original)
        const wavBlob = await this.ensureWav(audioBlob);

        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');
        if (Number.isInteger(expectedSyllableCount) && expectedSyllableCount > 0) {
            formData.append('expected_syllables', String(expectedSyllableCount));
        }
        if (options.referenceIpa) {
            formData.append('reference_ipa', String(options.referenceIpa));
        }
        if (options.targetWord) {
            formData.append('target_word', String(options.targetWord));
        }
        const response = await fetch(`${this.backendUrl}/analyze/v2`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Analysis failed' }));
            throw new Error(error.error || 'Analysis failed');
        }

        return PraatAPI.ensureVerification(await response.json(), 'V2_FALLBACK_UNRATEABLE');
    }

    /**
     * Exploratory vowel-only analysis used for screen-level hinting.
     * This never contributes to score output.
     */
    async analyzeVowel(audioBlob, {
        itemId = '',
        targetPhoneme = '',
        category = 'vowel',
        endpoint = '/analyze-vowel'
    } = {}) {
        const wavBlob = await this.ensureWav(audioBlob);
        const normalizedEndpoint = String(endpoint || '/analyze-vowel').replace(/^\/+/, '');
        const baseUrl = String(this.backendUrl || '').replace(/\/+$/, '');

        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');
        formData.append('itemId', String(itemId));
        formData.append('targetPhoneme', String(targetPhoneme));
        formData.append('category', String(category));

        const response = await fetch(`${baseUrl}/${normalizedEndpoint}`, {
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
    async analyzeFromUrl(audioUrl, variantId, expectedSyllableCount) {
        const response = await fetch(`${this.backendUrl}/analyze-url/v2`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audioUrl,
                variantId,
                expectedSyllableCount
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
        if (config.features && typeof config.features.usePraatBackend !== 'undefined' && !config.features.usePraatBackend) {
            return false;
        }

        try {
            const response = await fetch(`${this.backendUrl}/health`, {
                method: 'GET',
                mode: 'cors'
            });
            return response.ok;
        } catch (error) {
            console.warn('Health check failed (backend optional):', error);
            return false;
        }
    }
}
