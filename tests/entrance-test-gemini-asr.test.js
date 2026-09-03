const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
    resolveGeminiAudioMimeType,
    cleanHallucinatedLoops
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

    // Phrase loop
    const phraseLoop = 'Các bác sĩ, các bác sĩ, các bác sĩ, các bác sĩ, các bác sĩ';
    assert.equal(cleanHallucinatedLoops(phraseLoop), 'Các bác sĩ');

    // Markdown quotes and fences
    const fenceWrap = '```text\nHello world\n```';
    assert.equal(cleanHallucinatedLoops(fenceWrap), 'Hello world');

    const quotedWrap = '"Hello world"';
    assert.equal(cleanHallucinatedLoops(quotedWrap), 'Hello world');

    // Legitimate natural text preserved
    const naturalText = 'The scientists make observations, make assumptions, and do experiments.';
    assert.equal(cleanHallucinatedLoops(naturalText), naturalText);
});
