import assert from 'node:assert/strict';
import { PitchAnalyzer } from '../../public/pronunciation-analyzer/pitch-analyzer.js';

const sampleRate = 44100;
const frequency = 220;
const samples = Float32Array.from({ length: 4096 }, (_value, index) => (
    Math.sin((2 * Math.PI * frequency * index) / sampleRate)
));

const analyzer = new PitchAnalyzer(sampleRate);
const analysis = analyzer.analyze({ getChannelData: () => samples });
const detectedPitch = analysis.pitches.find((pitch) => Number.isFinite(pitch));

assert.ok(Number.isFinite(detectedPitch), 'local pitch analysis should detect a voiced sine wave');
assert.ok(Math.abs(detectedPitch - frequency) < 5, `expected ${frequency}Hz, got ${detectedPitch}Hz`);
assert.equal(analysis.pitches.length, 4);
assert.equal(analysis.energies.length, analysis.pitches.length);
assert.equal(analysis.times.length, analysis.pitches.length);
process.stdout.write('pitch-analyzer tests passed\n');
