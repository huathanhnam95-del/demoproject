const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
    resolveGeminiAudioMimeType,
    cleanHallucinatedLoops,
    getGeminiApiKeys,
    getHuggingFaceApiKey
} = require(path.resolve(__dirname, '..', 'functions', 'src', 'entrance-test', 'asr-service'));

test('resolveGeminiAudioMimeType maps various audio headers correctly', () => {
    assert.equal(resolveGeminiAudioMimeType('audio/webm; codecs=opus'), 'audio/webm');
    assert.equal(resolveGeminiAudioMimeType('audio/webm'), 'audio/webm');
    assert.equal(resolveGeminiAudioMimeType('audio/mp4'), 'audio/mp4');
    assert.equal(resolveGeminiAudioMimeType('audio/m4a'), 'audio/mp4');
    assert.equal(resolveGeminiAudioMimeType('audio/aac'), 'audio/mp4');
    assert.equal(resolveGeminiAudioMimeType('audio/wav'), 'audio/wav');
    assert.equal(resolveGeminiAudioMimeType('audio/x-wav'), 'audio/wav');
    assert.equal(resolveGeminiAudioMimeType('audio/ogg'), 'audio/ogg');
    assert.equal(resolveGeminiAudioMimeType('audio/mpeg'), 'audio/mp3');
    assert.equal(resolveGeminiAudioMimeType('application/octet-stream'), 'audio/webm');
    assert.equal(resolveGeminiAudioMimeType(''), 'audio/webm');
});

test('cleanHallucinatedLoops strips rapid word and phrase repetition loops', () => {
    // Single word rapid loop
    const wordLoop = 'Yeah Yeah Yeah Yeah Yeah Yeah';
    assert.equal(cleanHallucinatedLoops(wordLoop), 'Yeah');

    // Phrase loop without Vietnamese stripping
    const phraseLoop = 'Các bác sĩ, các bác sĩ, các bác sĩ, các bác sĩ, các bác sĩ';
    assert.equal(cleanHallucinatedLoops(phraseLoop, { stripVietnamese: false }), 'Các bác sĩ');

    // Default: Vietnamese hallucination purged in English entrance tests
    const mixedLoop = 'Các bác sĩ, các bác sĩ Then there is a lot of data from scientists.';
    assert.equal(cleanHallucinatedLoops(mixedLoop), 'Then there is a lot of data from scientists.');

    // Markdown quotes and fences
    const fenceWrap = '```text\nHello world\n```';
    assert.equal(cleanHallucinatedLoops(fenceWrap), 'Hello world');

    const quotedWrap = '"Hello world"';
    assert.equal(cleanHallucinatedLoops(quotedWrap), 'Hello world');

    // Legitimate natural text preserved
    const naturalText = 'The scientists make observations, make assumptions, and do experiments.';
    assert.equal(cleanHallucinatedLoops(naturalText), naturalText);
});

test('getGeminiApiKeys discovers primary and backup keys from environment', () => {
    const keys = getGeminiApiKeys();
    assert.ok(Array.isArray(keys), 'keys should be an array');
    assert.ok(keys.length >= 2, 'should have at least primary and backup keys');
    assert.ok(keys[0].startsWith('AQ.Ab8RN6J'), 'primary key matches');
    assert.ok(keys[1].startsWith('AQ.Ab8RN6I'), 'backup key matches');
});

test('getHuggingFaceApiKey discovers HF key from environment', () => {
    const key = getHuggingFaceApiKey();
    assert.ok(typeof key === 'string' && key.length > 0, 'HF key should be defined');
    assert.ok(key.startsWith('hf_'), 'HF key should start with hf_');
});


