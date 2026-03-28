import assert from 'node:assert/strict';
import { STRESS_WEIGHTS, calculateStressScore, findStressedSyllable } from '../../public/pronunciation-analyzer/stress-utils.js';

function testCanonicalWeights() {
    assert.equal(STRESS_WEIGHTS.pitch, 0.5);
    assert.equal(STRESS_WEIGHTS.duration, 0.3);
    assert.equal(STRESS_WEIGHTS.intensity, 0.2);
}

function testWeightedScoreUsesCanonicalModel() {
    assert.equal(calculateStressScore(100, 100, 100), 100);
    assert.equal(calculateStressScore(80, 20, 0), 46);
}

function testFindStressedSyllableRespectsSharedHeuristic() {
    const syllables = [
        { maxPitch: 100, duration: 0.4, intensity: 40 },
        { maxPitch: 98, duration: 0.75, intensity: 42 }
    ];

    assert.equal(findStressedSyllable(syllables), 1);
    assert.equal(findStressedSyllable(syllables, { finalSyllableDurationPenalty: 0.2 }), 0);
}

testCanonicalWeights();
testWeightedScoreUsesCanonicalModel();
testFindStressedSyllableRespectsSharedHeuristic();

console.log('stress-utils tests passed');
