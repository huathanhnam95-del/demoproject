import assert from 'node:assert/strict';
import { SyllableDetector } from '../../public/pronunciation-analyzer/syllable-detector.js';

function buildData({ frameCount, energy, pitch, step = 0.01 }) {
    return {
        energies: Array.from({ length: frameCount }, () => energy),
        pitches: Array.from({ length: frameCount }, () => pitch),
        times: Array.from({ length: frameCount }, (_, index) => Number((index * step).toFixed(3)))
    };
}

function testSilenceIsNotRateable() {
    const detector = new SyllableDetector();
    const result = detector.detect(buildData({
        frameCount: 40,
        energy: 0,
        pitch: null
    }), 3);

    assert.equal(result.quality.rateable, false);
    assert.equal(result.quality.reason, 'no_speech');
    assert.equal(result.syllables.length, 0);
}

function testShortSpeechIsRejected() {
    const detector = new SyllableDetector();
    const result = detector.detect(buildData({
        frameCount: 10,
        energy: 0.03,
        pitch: 120
    }), 2);

    assert.equal(result.quality.rateable, false);
    assert.equal(result.quality.reason, 'too_short');
    assert.equal(result.syllables.length, 0);
}

function testGuidedSegmentationReturnsExpectedCount() {
    const detector = new SyllableDetector();
    const result = detector.detect(buildData({
        frameCount: 90,
        energy: 0.025,
        pitch: 130
    }), 3);

    assert.equal(result.quality.rateable, true);
    assert.equal(result.quality.reason, null);
    assert.equal(result.syllables.length, 3);
}

testSilenceIsNotRateable();
testShortSpeechIsRejected();
testGuidedSegmentationReturnsExpectedCount();

console.log('syllable-detector tests passed');
