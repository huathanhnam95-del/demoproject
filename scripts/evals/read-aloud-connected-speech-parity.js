#!/usr/bin/env node
/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  buildConnectedSpeechAnalysis,
  buildConnectedSpeechEventSpecs
} = require(path.join(process.cwd(), 'src/read-aloud/connected-speech-service.js'));

function makeWavBuffer({ sampleRate = 16000, durationMs = 260, amplitude = 1000 } = {}) {
  const sampleCount = Math.max(1, Math.round(sampleRate * (durationMs / 1000)));
  const dataLength = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(amplitude, 44 + (index * 2));
  }
  return buffer;
}

function normalizeEvent(event) {
  return {
    eventId: String(event?.eventId || ''),
    family: String(event?.family || ''),
    phrase: String(event?.phrase || ''),
    leftWord: event?.leftWord ?? null,
    rightWord: event?.rightWord ?? null,
    startWordIndex: event?.startWordIndex ?? null,
    endWordIndex: event?.endWordIndex ?? null,
    status: String(event?.status || ''),
    confidence: Number(event?.confidence ?? 0),
    startMs: event?.startMs ?? null,
    endMs: event?.endMs ?? null,
    feedbackText: String(event?.feedbackText || ''),
    evidence: {}
  };
}

function normalizeResult(result) {
  const events = Array.isArray(result?.events) ? result.events.slice() : [];
  events.sort((a, b) => String(a?.eventId || '').localeCompare(String(b?.eventId || '')));
  return {
    status: String(result?.status || ''),
    version: String(result?.version || ''),
    summary: {
      detectedCount: Number(result?.summary?.detectedCount || 0),
      notDetectedCount: Number(result?.summary?.notDetectedCount || 0),
      uncertainCount: Number(result?.summary?.uncertainCount || 0)
    },
    events: events.map(normalizeEvent)
  };
}

function runPythonWorker(spec, audioBase64) {
  const pythonScript = String.raw`
import base64
import json
import sys

from connected_speech_worker import analyze_connected_speech

payload = json.loads(sys.stdin.read())
audio_bytes = base64.b64decode(payload["audioBase64"])
spec = payload["spec"]
sys.stdout.write(json.dumps(analyze_connected_speech(spec, audio_bytes)))
`;

  const result = spawnSync('python', ['-c', pythonScript], {
    cwd: path.join(process.cwd(), 'backend'),
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONUTF8: '1'
    },
    input: JSON.stringify({ spec, audioBase64 }),
    maxBuffer: 10 * 1024 * 1024
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Python worker parity invocation failed').trim());
  }

  return JSON.parse(result.stdout);
}

function compareParityCase(fixture) {
  const audioBuffer = makeWavBuffer();
  const spec = {
    questionId: fixture.questionId,
    referenceText: fixture.referenceText,
    azurePayload: fixture.azurePayload,
    audioQuality: fixture.audioQuality,
    events: buildConnectedSpeechEventSpecs(fixture.referenceText, fixture.questionId)
  };

  const localAnalysis = normalizeResult(buildConnectedSpeechAnalysis({
    questionId: fixture.questionId,
    referenceText: fixture.referenceText,
    azurePayload: fixture.azurePayload,
    audioQuality: fixture.audioQuality
  }));
  const workerAnalysis = normalizeResult(runPythonWorker(spec, audioBuffer.toString('base64')));

  const localFamilies = Array.from(new Set(localAnalysis.events.map((event) => event.family))).sort();
  const expectedFamilies = Array.isArray(fixture.expectedFamilies) ? fixture.expectedFamilies.slice().sort() : [];
  assert.deepStrictEqual(localFamilies, expectedFamilies, `${fixture.name}: JS family set changed unexpectedly`);
  assert.deepStrictEqual(Array.from(new Set(workerAnalysis.events.map((event) => event.family))).sort(), expectedFamilies, `${fixture.name}: Python family set changed unexpectedly`);
  assert.deepStrictEqual(workerAnalysis, localAnalysis, `${fixture.name}: JS and Python results diverged`);
}

function main() {
  const fixturePath = process.argv[2] || path.join(process.cwd(), 'tests', 'fixtures', 'read-aloud-connected-speech', 'parity-cases.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error('Parity fixture file is empty.');
  }

  for (const fixture of fixtures) {
    compareParityCase(fixture);
    console.log(`PASS ${fixture.name}`);
  }

  console.log(`Compared ${fixtures.length} parity case(s).`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}
