import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';

// Minimal browser globals needed by config.js and PraatAPI
globalThis.window = {
    location: { hostname: 'localhost', protocol: 'http:' }
};

// We need to control fetch globally
const originalFetch = globalThis.fetch;

const { config } = await import('../../public/pronunciation-analyzer/config.js');
const { PraatAPI } = await import('../../public/pronunciation-analyzer/praat-api.js');

describe('PraatAPI v3 integration', () => {
    let api;

    beforeEach(() => {
        config.features.usePronunciationV3LearnerAnalysis = false;
        api = new PraatAPI('https://backend.example');
        // Bypass WAV conversion in tests
        api.ensureWav = async (blob) => blob;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        config.features.usePronunciationV3LearnerAnalysis = false;
        api._v3SupportPromise = null;
    });

    it('checkV3Support() returns mode from health endpoint', async () => {
        globalThis.fetch = async (url, options) => {
            assert.equal(url, 'https://backend.example/health');
            assert.equal(options.method, 'GET');
            return {
                ok: true,
                json: async () => ({ status: 'ok', pronunciationV3Mode: 'active' })
            };
        };

        const mode = await api.checkV3Support();
        assert.equal(mode, 'active');
    });

    it('analyzeV3() sends correct request format', async () => {
        let capturedUrl = null;
        let capturedBody = null;

        globalThis.fetch = async (url, options) => {
            capturedUrl = url;
            capturedBody = options.body;
            return {
                ok: true,
                json: async () => ({
                    observed_syllables: [{ startTime: 0, endTime: 0.3 }],
                    syllable_count: 1,
                    is_rateable: true
                })
            };
        };

        const result = await api.analyzeV3(
            new Blob(['audio'], { type: 'audio/wav' }),
            {
                referenceIpa: '/kɑr/',
                referenceSyllables: ['kɑr'],
                expectedSyllables: 1
            }
        );

        assert.equal(capturedUrl, 'https://backend.example/analyze/v3');
        assert.equal(capturedBody.get('reference_ipa'), '/kɑr/');
        assert.equal(capturedBody.get('reference_syllables'), JSON.stringify(['kɑr']));
        assert.equal(capturedBody.get('expected_syllables'), '1');
        assert.equal(result.syllable_count, 1);
    });

    it('analyzeComparison() posts one WAV and returns both envelopes', async () => {
        let capturedUrl = null;
        let capturedBody = null;
        globalThis.fetch = async (url, options) => {
            capturedUrl = url;
            capturedBody = options.body;
            return {
                ok: true,
                json: async () => ({
                    mode: 'comparison',
                    v2: { status: 'available', analysis: { observed: { syllableCount: 2 } } },
                    v3: { status: 'available', analysis: { syllable_count: 3 } }
                })
            };
        };

        const result = await api.analyzeComparison(
            new Blob(['audio'], { type: 'audio/wav' }),
            {
                referenceIpa: '/\u02c8\u00e6k.t\u0283u.\u0259l/',
                referenceSyllables: ['\u00e6k', 't\u0283u', '\u0259l'],
                expectedSyllables: 3,
                targetWord: 'actual',
                variantId: 'cmudict:actual'
            }
        );

        assert.equal(capturedUrl, 'https://backend.example/analyze/compare');
        assert.equal(capturedBody.get('reference_ipa'), '/\u02c8\u00e6k.t\u0283u.\u0259l/');
        assert.equal(
            capturedBody.get('reference_syllables'),
            JSON.stringify(['\u00e6k', 't\u0283u', '\u0259l'])
        );
        assert.equal(capturedBody.get('expected_syllables'), '3');
        assert.equal(capturedBody.get('target_word'), 'actual');
        assert.equal(capturedBody.get('variant_id'), 'cmudict:actual');
        assert.equal(result.mode, 'comparison');
        assert.equal(result.v2.status, 'available');
        assert.equal(result.v3.status, 'available');
    });

    it('analyzeComparison() preserves a successful partial response', async () => {
        config.features.usePronunciationV3LearnerAnalysis = true;
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({
                mode: 'comparison',
                status: 'partial_failure',
                v2: { status: 'available' },
                v3: { status: 'unavailable', reason: 'MODEL_INFERENCE_FAILED' }
            })
        });

        const result = await api.analyzeComparison(
            new Blob(['audio'], { type: 'audio/wav' }),
            { expectedSyllables: 1, targetWord: 'word' }
        );

        assert.equal(result.status, 'partial_failure');
        assert.equal(result.v2.status, 'available');
        assert.equal(result.v3.reason, 'MODEL_INFERENCE_FAILED');
    });

    it('analyzeComparison() throws the backend error for total failure', async () => {
        globalThis.fetch = async () => ({
            ok: false,
            json: async () => ({ error: 'Both pronunciation engines unavailable' })
        });

        await assert.rejects(
            api.analyzeComparison(new Blob(['audio'], { type: 'audio/wav' }), { expectedSyllables: 1 }),
            /Both pronunciation engines unavailable/
        );
    });

    it('analyze() delegates to v3 when mode is active', async () => {
        config.features.usePronunciationV3LearnerAnalysis = true;
        let fetchCalls = [];

        globalThis.fetch = async (url, options) => {
            fetchCalls.push(url);
            if (url.includes('/health')) {
                return {
                    ok: true,
                    json: async () => ({ pronunciationV3Mode: 'active' })
                };
            }
            // v3 endpoint
            return {
                ok: true,
                json: async () => ({
                    observed_syllables: [{ startTime: 0, endTime: 0.5 }],
                    syllable_count: 1,
                    is_rateable: true
                })
            };
        };

        const result = await api.analyze(new Blob(['audio'], { type: 'audio/wav' }), 1);

        assert.ok(fetchCalls.some(u => u.includes('/analyze/v3')), 'should call /analyze/v3');
        assert.ok(!fetchCalls.some(u => u.includes('/analyze/v2')), 'should NOT call /analyze/v2');
        assert.equal(result.syllable_count, 1);
    });

    it('learner mode fails closed instead of falling back to a green v2 result', async () => {
        config.features.usePronunciationV3LearnerAnalysis = true;
        const fetchCalls = [];
        globalThis.fetch = async (url) => {
            fetchCalls.push(url);
            if (url.includes('/health')) {
                return { ok: true, json: async () => ({ pronunciationV3Mode: 'off' }) };
            }
            throw new Error('unexpected v2 call');
        };

        const result = await api.analyze(new Blob(['audio'], { type: 'audio/wav' }), 3);
        assert.ok(!fetchCalls.some((url) => url.includes('/analyze/v2')));
        assert.equal(result.verification.status, 'unrateable');
        assert.equal(result.verification.count.reasons[0], 'V3_NOT_ACTIVE');
    });

    it('analyze() delegates to v3 when mode is shadow and sends comparison metadata', async () => {
        config.features.usePronunciationV3LearnerAnalysis = true;
        const fetchCalls = [];
        let postedBody = null;
        globalThis.fetch = async (url, options) => {
            fetchCalls.push(url);
            if (url.includes('/health')) {
                return { ok: true, json: async () => ({ pronunciationV3Mode: 'shadow' }) };
            }
            postedBody = options.body;
            return {
                ok: true,
                json: async () => ({
                    mode: 'shadow',
                    observed_syllables: [{ startTime: 0, endTime: 0.5, duration: 0.5 }],
                    syllable_count: 1,
                    is_rateable: true
                })
            };
        };

        const result = await api.analyze(
            new Blob(['audio'], { type: 'audio/wav' }),
            1,
            { referenceIpa: '/bɪzi/', targetWord: 'busy' }
        );

        assert.ok(fetchCalls.some(u => u.includes('/analyze/v3')));
        assert.equal(postedBody.get('reference_ipa'), '/bɪzi/');
        assert.equal(postedBody.get('target_word'), 'busy');
        assert.equal(result.mode, 'shadow');
    });

    it('analyze() stays on v2 when production v3 learner analysis is disabled', async () => {
        const fetchCalls = [];

        globalThis.fetch = async (url) => {
            fetchCalls.push(url);
            if (url.includes('/health')) {
                return {
                    ok: true,
                    json: async () => ({ pronunciationV3Mode: 'active' })
                };
            }
            return {
                ok: true,
                json: async () => ({
                    analysisVersion: 'pronunciation-analysis-v2',
                    observed: { syllableCount: 2, syllables: [{}, {}] },
                    quality: { rateable: true }
                })
            };
        };

        const result = await api.analyze(
            new Blob(['audio'], { type: 'audio/wav' }),
            2
        );

        assert.ok(fetchCalls.some((url) => url.includes('/analyze/v2')));
        assert.ok(!fetchCalls.some((url) => url.includes('/analyze/v3')));
        assert.ok(!fetchCalls.some((url) => url.includes('/health')));
        assert.equal(result.observed.syllableCount, 2);
    });

    it('analyze() uses v2 when mode is off', async () => {
        let fetchCalls = [];

        globalThis.fetch = async (url, options) => {
            fetchCalls.push(url);
            if (url.includes('/health')) {
                return {
                    ok: true,
                    json: async () => ({ pronunciationV3Mode: 'off' })
                };
            }
            // v2 endpoint
            return {
                ok: true,
                json: async () => ({
                    analysisVersion: 'pronunciation-analysis-v2',
                    observed: { syllableCount: 2, syllables: [{}, {}] },
                    quality: { rateable: true },
                    pitch: { times: [], values: [] },
                    intensity: { times: [], values: [] }
                })
            };
        };

        const result = await api.analyze(new Blob(['audio'], { type: 'audio/wav' }), 2);

        assert.ok(fetchCalls.some(u => u.includes('/analyze/v2')), 'should call /analyze/v2');
        assert.ok(!fetchCalls.some(u => u.includes('/analyze/v3')), 'should NOT call /analyze/v3');
        assert.equal(result.observed.syllableCount, 2);
    });

    it('v3 support check result is cached', async () => {
        let healthCallCount = 0;

        globalThis.fetch = async (url) => {
            if (url.includes('/health')) {
                healthCallCount++;
                return {
                    ok: true,
                    json: async () => ({ pronunciationV3Mode: 'shadow' })
                };
            }
            return { ok: true, json: async () => ({}) };
        };

        const mode1 = await api.checkV3Support();
        const mode2 = await api.checkV3Support();
        const mode3 = await api.checkV3Support();

        assert.equal(mode1, 'shadow');
        assert.equal(mode2, 'shadow');
        assert.equal(mode3, 'shadow');
        assert.equal(healthCallCount, 1, 'health endpoint should only be called once');
    });

    it('ensureVerification() correctly adapts rateable V2 response with verification envelope', () => {
        const v2Response = {
            analysisVersion: 'pronunciation-analysis-v2',
            quality: { rateable: true, confidence: 0.95, reasons: [] },
            observed: { syllableCount: 3, primaryStress: 0 }
        };

        const adapted = PraatAPI.ensureVerification(v2Response, 'V2_FALLBACK_UNRATEABLE', 3);
        assert.equal(adapted.verification.status, 'verified');
        assert.equal(adapted.verification.count.observed, 3);
        assert.equal(adapted.verification.count.expected, 3);
        assert.equal(adapted.verification.count.status, 'verified');
    });

    it('ensureVerification() marks count mismatch as incorrect in V2 response', () => {
        const v2Response = {
            analysisVersion: 'pronunciation-analysis-v2',
            quality: { rateable: true, confidence: 0.95, reasons: [] },
            observed: { syllableCount: 4, primaryStress: 1 }
        };

        const adapted = PraatAPI.ensureVerification(v2Response, 'V2_FALLBACK_UNRATEABLE', 3);
        assert.equal(adapted.verification.status, 'incorrect');
        assert.equal(adapted.verification.count.observed, 4);
        assert.equal(adapted.verification.count.expected, 3);
        assert.equal(adapted.verification.count.status, 'incorrect');
    });

    it('ensureVerification() respects unrateable V2 quality', () => {
        const v2Response = {
            analysisVersion: 'pronunciation-analysis-v2',
            quality: { rateable: false, confidence: 0.2, reasons: ['LOW_ENERGY'] },
            observed: { syllableCount: 0, primaryStress: null }
        };

        const adapted = PraatAPI.ensureVerification(v2Response, 'V2_FALLBACK_UNRATEABLE', 4);
        assert.equal(adapted.verification.status, 'unrateable');
        assert.equal(adapted.verification.count.observed, 0);
        assert.equal(adapted.verification.count.status, 'unrateable');
    });
});
