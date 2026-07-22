import assert from 'node:assert/strict';
import { analyzeRecordedAttempt } from '../../public/pronunciation-analyzer/analysis-pipeline.js';

const blob = new Blob(['fake-audio'], { type: 'audio/webm' });

async function testNoAudioReturnsUnrateable() {
    const result = await analyzeRecordedAttempt({
        audioBlob: null,
        preferPraat: true
    });

    assert.equal(result.engine, 'praat');
    assert.equal(result.usedPraatFallback, false);
    assert.equal(result.quality.rateable, false);
    assert.equal(result.quality.reason, 'no_speech');
    assert.equal(result.syllables.length, 0);
}

async function testPraatSuccessShortCircuitsLocalAnalysis() {
    let praatCalls = 0;
    let decodeCalls = 0;
    let pitchCalls = 0;
    let detectCalls = 0;

    const result = await analyzeRecordedAttempt({
        audioBlob: blob,
        expectedSyllables: 2,
        preferPraat: true,
        praatAnalyze: async (attemptBlob, expectedSyllables) => {
            praatCalls += 1;
            assert.equal(attemptBlob, blob);
            assert.equal(expectedSyllables, undefined, 'learner Praat calls must not receive the lexical count');
            return {
                syllables: [{ startTime: 0, endTime: 0.4 }],
                noiseCount: 1,
                quality: {
                    rateable: true,
                    reason: null,
                    metrics: {
                        peakEnergy: 0.2,
                        activeSpeechDurationMs: 400,
                        voicedFrameRatio: 1,
                        activeFrameCount: 12
                    }
                }
            };
        },
        decodeBlob: async () => {
            decodeCalls += 1;
            return { shouldNotBeUsed: true };
        },
        pitchAnalyze: () => {
            pitchCalls += 1;
            return {};
        },
        detectSyllables: () => {
            detectCalls += 1;
            return {};
        }
    });

    assert.equal(result.engine, 'praat');
    assert.equal(result.usedPraatFallback, false);
    assert.equal(praatCalls, 1);
    assert.equal(decodeCalls, 0);
    assert.equal(pitchCalls, 0);
    assert.equal(detectCalls, 0);
    assert.equal(result.syllables.length, 1);
    assert.equal(result.quality.rateable, true);
}

async function testPraatFailureFallsBackToLocalAnalysis() {
    let decodeCalls = 0;
    let pitchCalls = 0;
    let detectCalls = 0;

    const result = await analyzeRecordedAttempt({
        audioBlob: blob,
        expectedSyllables: 3,
        preferPraat: true,
        praatAnalyze: async () => {
            throw new Error('backend down');
        },
        decodeBlob: async (attemptBlob) => {
            decodeCalls += 1;
            assert.equal(attemptBlob, blob);
            return { id: 'decoded-buffer' };
        },
        pitchAnalyze: (audioBuffer) => {
            pitchCalls += 1;
            assert.equal(audioBuffer.id, 'decoded-buffer');
            return {
                times: [0, 0.1, 0.2],
                pitches: [120, 125, 130],
                energies: [0.22, 0.25, 0.24]
            };
        },
        detectSyllables: (analysisData, expectedSyllables) => {
            detectCalls += 1;
            assert.equal(expectedSyllables, undefined, 'local detection must be independent of the lexical count');
            assert.equal(analysisData.pitches.length, 3);
            return {
                syllables: [
                    { startTime: 0, endTime: 0.1 },
                    { startTime: 0.1, endTime: 0.2 },
                    { startTime: 0.2, endTime: 0.3 }
                ],
                noiseCount: 0,
                quality: {
                    rateable: true,
                    reason: null,
                    metrics: {
                        peakEnergy: 0.25,
                        activeSpeechDurationMs: 300,
                        voicedFrameRatio: 1,
                        activeFrameCount: 3
                    }
                }
            };
        }
    });

    assert.equal(result.engine, 'local');
    assert.equal(result.usedPraatFallback, true);
    assert.equal(result.praatError, 'backend down');
    assert.equal(decodeCalls, 1);
    assert.equal(pitchCalls, 1);
    assert.equal(detectCalls, 1);
    assert.equal(result.syllables.length, 3);
    assert.equal(result.analysisData.pitches.length, 3);
    assert.equal(result.quality.rateable, true);
}

async function testPraatBoundaryRepairPullsLateBoundaryBackToVoicingBreak() {
    const times = Array.from({ length: 72 }, (_, index) => Number((index * 0.01).toFixed(2)));
    const pitchValues = times.map((time) => {
        if (time >= 0.05 && time <= 0.19) return 150;
        if (time >= 0.24 && time <= 0.34) return 128;
        if (time >= 0.43 && time <= 0.69) return 102;
        return null;
    });
    const intensityValues = times.map((time) => {
        if (time >= 0.05 && time <= 0.19) return 72;
        if (time >= 0.20 && time <= 0.23) return 38;
        if (time >= 0.24 && time <= 0.34) return 58;
        if (time >= 0.35 && time <= 0.42) return 41;
        if (time >= 0.43 && time <= 0.69) return 55;
        return 18;
    });

    const result = await analyzeRecordedAttempt({
        audioBlob: blob,
        expectedSyllables: 3,
        preferPraat: true,
        praatAnalyze: async () => ({
            pitch: {
                times,
                values: pitchValues
            },
            intensity: {
                times,
                values: intensityValues
            },
            syllables: [
                { startTime: 0.04, endTime: 0.29, duration: 0.25, avgPitch: 148, maxPitch: 157, intensity: 72 },
                { startTime: 0.29, endTime: 0.43, duration: 0.14, avgPitch: 126, maxPitch: 136, intensity: 58 },
                { startTime: 0.43, endTime: 0.71, duration: 0.28, avgPitch: 101, maxPitch: 111, intensity: 55 }
            ],
            quality: {
                rateable: true,
                reason: null,
                metrics: {
                    peakEnergy: 0.2,
                    activeSpeechDurationMs: 670,
                    voicedFrameRatio: 0.7,
                    activeFrameCount: 67
                }
            }
        }),
        decodeBlob: async () => {
            throw new Error('local decode should not run on praat success');
        },
        pitchAnalyze: () => {
            throw new Error('local pitch analysis should not run on praat success');
        },
        detectSyllables: () => {
            throw new Error('local syllable detection should not run on praat success');
        }
    });

    assert.equal(result.engine, 'praat');
    assert.equal(result.usedPraatFallback, false);
    assert.ok(result.analysis, 'praat analysis should be preserved');
    assert.ok(result.analysis.syllables[0].endTime <= 0.23, 'first syllable boundary should move earlier to the voicing break');
    assert.equal(result.analysis.syllables[1].startTime, result.analysis.syllables[0].endTime, 'adjacent syllables should stay contiguous after repair');
    assert.ok(result.analysis.syllables[0].duration < 0.25, 'repair should shorten the over-extended first syllable');
}

async function testPraatTrailingConsonantTailMergesIntoPreviousSyllable() {
    const times = Array.from({ length: 65 }, (_, index) => Number((index * 0.01).toFixed(2)));
    const pitchValues = times.map((time) => {
        if (time >= 0.03 && time <= 0.14) return 150;
        if (time >= 0.16 && time <= 0.43) return 132;
        return null;
    });
    const intensityValues = times.map((time) => {
        if (time >= 0.03 && time <= 0.14) return 70;
        if (time >= 0.16 && time <= 0.43) return 62;
        if (time >= 0.46 && time <= 0.57) return 48;
        return 18;
    });

    const result = await analyzeRecordedAttempt({
        audioBlob: blob,
        expectedSyllables: 2,
        preferPraat: true,
        praatAnalyze: async () => ({
            pitch: {
                times,
                values: pitchValues
            },
            intensity: {
                times,
                values: intensityValues
            },
            syllables: [
                { startTime: 0.03, endTime: 0.16, duration: 0.13, avgPitch: 146, maxPitch: 156, intensity: 70, vowelDuration: 0.10 },
                { startTime: 0.16, endTime: 0.46, duration: 0.30, avgPitch: 128, maxPitch: 136, intensity: 62, vowelDuration: 0.23 },
                { startTime: 0.46, endTime: 0.58, duration: 0.12, avgPitch: 0, maxPitch: 0, intensity: 48, vowelDuration: 0 }
            ],
            quality: {
                rateable: true,
                reason: null,
                metrics: {
                    peakEnergy: 0.2,
                    activeSpeechDurationMs: 550,
                    voicedFrameRatio: 0.65,
                    activeFrameCount: 55
                }
            }
        }),
        decodeBlob: async () => {
            throw new Error('local decode should not run on praat success');
        },
        pitchAnalyze: () => {
            throw new Error('local pitch analysis should not run on praat success');
        },
        detectSyllables: () => {
            throw new Error('local syllable detection should not run on praat success');
        }
    });

    assert.equal(result.engine, 'praat');
    assert.equal(result.usedPraatFallback, false);
    assert.equal(result.syllables.length, 2, 'expected the unvoiced trailing tail to merge into the prior syllable');
    assert.equal(result.syllables[1].startTime, 0.16);
    assert.equal(result.syllables[1].endTime, 0.58);
    assert.equal(result.syllables[1].duration, 0.42);
}

async function testLocalOnlyAnalysis() {
    let decodeCalls = 0;

    const result = await analyzeRecordedAttempt({
        audioBlob: blob,
        expectedSyllables: 2,
        preferPraat: false,
        decodeBlob: async () => {
            decodeCalls += 1;
            return { id: 'local-only' };
        },
        pitchAnalyze: () => ({
            times: [0, 0.1],
            pitches: [110, 120],
            energies: [0.15, 0.18]
        }),
        detectSyllables: () => ({
            syllables: [{ startTime: 0, endTime: 0.2 }],
            noiseCount: 0,
            quality: {
                rateable: true,
                reason: null,
                metrics: {
                    peakEnergy: 0.18,
                    activeSpeechDurationMs: 200,
                    voicedFrameRatio: 1,
                    activeFrameCount: 2
                }
            }
        })
    });

    assert.equal(result.engine, 'local');
    assert.equal(result.usedPraatFallback, false);
    assert.equal(decodeCalls, 1);
    assert.equal(result.quality.rateable, true);
}

async function testPraatV2ResponseUsesIndependentObservedSyllables() {
    const result = await analyzeRecordedAttempt({
        audioBlob: blob,
        expectedSyllables: 9,
        preferPraat: true,
        praatAnalyze: async () => ({
            analysisVersion: 'pronunciation-analysis-v2',
            quality: { rateable: true, confidence: 0.91, reasons: [] },
            observed: {
                syllableCount: 2,
                primaryStress: 1,
                syllables: [
                    { startTime: 0, endTime: 0.2, duration: 0.2 },
                    { startTime: 0.2, endTime: 0.5, duration: 0.3 }
                ]
            },
            pitch: { times: [], values: [] },
            intensity: { times: [], values: [] }
        })
    });
    assert.equal(result.engine, 'praat');
    assert.equal(result.syllables.length, 2);
    assert.equal(result.analysis.observed.primaryStress, 1);
}

async function testLearnerExtraSyllablesAreNotForcedToExpectedCount() {
    const result = await analyzeRecordedAttempt({
        audioBlob: blob,
        expectedSyllables: 2,
        preferPraat: false,
        decodeBlob: async () => ({ id: 'independent-count' }),
        pitchAnalyze: () => ({
            times: [0, 0.1, 0.2, 0.3],
            pitches: [110, 120, 125, 115],
            energies: [0.15, 0.18, 0.17, 0.16]
        }),
        detectSyllables: (analysisData, expectedSyllables) => {
            assert.equal(expectedSyllables, undefined);
            return {
                syllables: [
                    { startTime: 0, endTime: 0.1 },
                    { startTime: 0.1, endTime: 0.2 },
                    { startTime: 0.2, endTime: 0.3 },
                    { startTime: 0.3, endTime: 0.4 }
                ],
                quality: { rateable: true, reason: null, metrics: {} }
            };
        }
    });

    assert.equal(result.syllables.length, 4);
}

await testNoAudioReturnsUnrateable();
await testPraatSuccessShortCircuitsLocalAnalysis();
await testPraatFailureFallsBackToLocalAnalysis();
await testPraatBoundaryRepairPullsLateBoundaryBackToVoicingBreak();
await testPraatTrailingConsonantTailMergesIntoPreviousSyllable();
await testLocalOnlyAnalysis();
await testPraatV2ResponseUsesIndependentObservedSyllables();
await testLearnerExtraSyllablesAreNotForcedToExpectedCount();

// ═══════════════════════════════════════════════════════════════
// Task 7: v3 integration and pending timer tests
// ═══════════════════════════════════════════════════════════════

async function testPendingTimerFiresAfterTwoSeconds() {
    let pendingMessage = null;

    // Use a real timer: the praatAnalyze takes 2500ms to resolve
    const result = await analyzeRecordedAttempt({
        audioBlob: blob,
        preferPraat: true,
        praatAnalyze: async () => {
            await new Promise(resolve => setTimeout(resolve, 2500));
            return {
                syllables: [{ startTime: 0, endTime: 0.3 }],
                quality: { rateable: true, reason: null, metrics: {} }
            };
        },
        onPendingStatus: (msg) => {
            pendingMessage = msg;
        }
    });

    assert.equal(pendingMessage, 'Preparing speech analysis\u2026',
        'pending timer should fire after 2 seconds');
    assert.equal(result.engine, 'praat');
}

async function testPendingTimerClearedOnSuccess() {
    let pendingMessage = null;

    // praatAnalyze resolves instantly (< 2s), so timer should NOT fire
    const result = await analyzeRecordedAttempt({
        audioBlob: blob,
        preferPraat: true,
        praatAnalyze: async () => ({
            syllables: [{ startTime: 0, endTime: 0.4 }],
            quality: { rateable: true, reason: null, metrics: {} }
        }),
        onPendingStatus: (msg) => {
            pendingMessage = msg;
        }
    });

    // Wait a bit to ensure timer doesn't fire after success
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(pendingMessage, null,
        'pending timer should not fire when analysis completes quickly');
    assert.equal(result.engine, 'praat');
}

async function testPendingTimerClearedOnFailure() {
    let pendingMessage = null;

    const result = await analyzeRecordedAttempt({
        audioBlob: blob,
        preferPraat: true,
        praatAnalyze: async () => {
            throw new Error('backend exploded');
        },
        decodeBlob: async () => ({ id: 'buffer' }),
        pitchAnalyze: () => ({ times: [0], pitches: [100], energies: [0.1] }),
        detectSyllables: () => ({
            syllables: [{ startTime: 0, endTime: 0.2 }],
            quality: { rateable: true, reason: null, metrics: {} }
        }),
        onPendingStatus: (msg) => {
            pendingMessage = msg;
        }
    });

    // Wait a bit to ensure timer doesn't fire after failure
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(pendingMessage, null,
        'pending timer should be cleared on failure path');
    assert.equal(result.usedPraatFallback, true);
}

async function testV3ResponseShapeIsNormalized() {
    const result = await analyzeRecordedAttempt({
        audioBlob: blob,
        preferPraat: true,
        praatAnalyze: async () => ({
            // V3 response shape
            observed_syllables: [
                { startTime: 0, endTime: 0.25, duration: 0.25 },
                { startTime: 0.25, endTime: 0.5, duration: 0.25 }
            ],
            syllable_count: 2,
            is_rateable: true,
            quality_reason: null,
            pitch: { times: [0, 0.1], values: [150, 160] },
            intensity: { times: [0, 0.1], values: [70, 72] }
        })
    });

    assert.equal(result.engine, 'praat');
    assert.equal(result.syllables.length, 2, 'v3 observed_syllables should become syllables');
    assert.equal(result.quality.rateable, true, 'v3 is_rateable should map to quality.rateable');
    assert.equal(result.analysis.observed.syllableCount, 2, 'v3 syllable_count should be in observed');
    assert.equal(result.syllables[0].startTime, 0);
    assert.equal(result.syllables[0].endTime, 0.25);
}

await testPendingTimerFiresAfterTwoSeconds();
await testPendingTimerClearedOnSuccess();
await testPendingTimerClearedOnFailure();
await testV3ResponseShapeIsNormalized();

process.stdout.write('analysis-pipeline tests passed\n');
