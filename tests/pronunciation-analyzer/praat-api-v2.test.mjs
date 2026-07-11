import assert from 'node:assert/strict';

globalThis.window = {
    location: { hostname: 'localhost', protocol: 'http:' }
};

const { PraatAPI } = await import('../../public/pronunciation-analyzer/praat-api.js');
const api = new PraatAPI('https://backend.example');
api.ensureWav = async (blob) => blob;

let requestUrl = null;
let requestOptions = null;
globalThis.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return {
        ok: true,
        json: async () => ({
            analysisVersion: 'pronunciation-analysis-v2',
            quality: { rateable: true, confidence: 0.9, reasons: [] },
            observed: { syllableCount: 2, primaryStress: 0, syllables: [{}, {}] },
            pitch: { times: [], values: [] },
            intensity: { times: [], values: [] }
        })
    };
};

const result = await api.analyze(new Blob(['audio'], { type: 'audio/wav' }), 99);
assert.equal(requestUrl, 'https://backend.example/analyze/v2');
assert.equal(requestOptions.method, 'POST');
assert.equal(requestOptions.body.has('expected_syllables'), false);
assert.equal(result.observed.syllableCount, 2);

console.log('praat-api-v2 tests passed');
