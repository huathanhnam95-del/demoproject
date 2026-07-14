import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';

// Minimal browser globals needed by config.js and PraatAPI
globalThis.window = {
    location: { hostname: 'localhost', protocol: 'http:' }
};

// We need to control fetch globally
const originalFetch = globalThis.fetch;

const { PraatAPI } = await import('../../public/pronunciation-analyzer/praat-api.js');

describe('PraatAPI v3 integration', () => {
    let api;

    beforeEach(() => {
        api = new PraatAPI('https://backend.example');
        // Bypass WAV conversion in tests
        api.ensureWav = async (blob) => blob;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
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
            { referenceIpa: '/kɑr/', expectedSyllables: 1 }
        );

        assert.equal(capturedUrl, 'https://backend.example/analyze/v3');
        assert.equal(capturedBody.get('reference_ipa'), '/kɑr/');
        assert.equal(capturedBody.get('expected_syllables'), '1');
        assert.equal(result.syllable_count, 1);
    });

    it('analyze() delegates to v3 when mode is active', async () => {
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
});
