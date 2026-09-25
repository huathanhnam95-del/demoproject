'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, dismissOverlays } = require('./helpers/pte-shell-harness');

const evidence = process.env.PTE_SHELL_EVIDENCE;
if (!evidence) throw new Error('PTE_SHELL_EVIDENCE must point outside the repository');

function audioFixture() {
  const samples = 16000;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) buffer.writeInt16LE(index % 2 ? 750 : -750, 44 + (index * 2));
  return buffer;
}

async function run() {
  const harness = await createHarness();
  const report = {
    flow: 'sgd-recorder-generation-ownership',
    staleRecorderDidNotStopRetryStream: false,
    staleChunkExcludedFromRetry: false,
    olderRejectedConversionPreservedCurrentWav: false,
    scoringGate: null,
    outcome: 'pending'
  };
  let page;

  try {
    page = await harness.browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('userStatus', 'guest');
      localStorage.setItem('hasSeenScopeTutorial', 'true');
      localStorage.setItem('sgdModeFirstUse', 'true');
      sessionStorage.setItem('guestMode', 'true');
      sessionStorage.setItem('welcomeModalSeen', 'true');

      window.__sgdRecorders = [];
      window.__sgdStreams = [];
      class ControlledRecorder {
        constructor(stream, options = {}) {
          this.stream = stream;
          this.state = 'inactive';
          this.mimeType = options.mimeType || 'audio/webm';
          this.ondataavailable = null;
          this.onstop = null;
          window.__sgdRecorders.push(this);
        }
        start() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; }
        emitData(marker) {
          this.ondataavailable?.({ data: new Blob([marker], { type: this.mimeType }) });
        }
        emitStop() { this.onstop?.(); }
        static isTypeSupported(type) { return type === 'audio/webm;codecs=opus' || type === 'audio/webm'; }
      }
      Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: ControlledRecorder });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            const track = { stopped: false, stop() { this.stopped = true; } };
            const stream = { getTracks: () => [track], __fixtureTrack: track };
            window.__sgdStreams.push(stream);
            return stream;
          }
        }
      });
    });

    await page.route('**/media-release.json*', route => route.fulfill({ json: { defaultRolloutState: 'legacy', modes: {} } }));
    await page.route('**/*.{mp3,wav}*', route => route.fulfill({ contentType: 'audio/wav', body: audioFixture() }));
    await page.goto(`${harness.baseURL}/?pteShell=v3`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await page.evaluate(async () => { await window.switchToMode('sgd'); });
    await page.waitForFunction(() => window.SGDMode?.getPtePhase?.() === 'prep'
      && document.getElementById('sgd-pte-stage'), null, { timeout: 15000 });

    await page.evaluate(() => {
      const pipeline = window.AudioDspPipeline;
      if (!pipeline || typeof pipeline.isValidMono16kWav !== 'function') throw new Error('AudioDspPipeline did not load');
      window.__sgdPreparationInputs = [];
      window.__sgdFirstPreparationPending = new Promise((_resolve, reject) => {
        window.__rejectSgdFirstPreparation = () => reject(new Error('stale fixture format conversion rejection'));
      });
      const samples = 16000;
      const buffer = new ArrayBuffer(44 + samples * 2);
      const view = new DataView(buffer);
      const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
      write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true);
      write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      write(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, 8192, true);
      const outputBlob = new Blob([buffer], { type: 'audio/wav' });
      window.__sgdCurrentFixtureWav = outputBlob;
      window.__sgdPreparationCalls = 0;
      window.AudioDspPipeline = {
        ...pipeline,
        prepareForAssessment: async rawBlob => {
        const marker = await rawBlob.text();
        window.__sgdPreparationCalls += 1;
        window.__sgdPreparationInputs.push({
          hasStaleOldGeneration: marker.includes('STALE_OLD_GENERATION'),
          hasCurrentRetry: marker.includes('CURRENT_RETRY_GENERATION')
        });
        if (marker.includes('CURRENT_RETRY_GENERATION')) return window.__sgdFirstPreparationPending;
        return {
          rawBlob,
          outputBlob,
          wavBlob: outputBlob,
          outputMimeType: 'audio/wav',
          outputFormat: 'wav',
          fallback: false,
          processingStatus: 'format-only',
          sampleCount: samples,
          audioBuffer: { sampleRate: 16000, numberOfChannels: 1, length: samples },
          stats: { outputSampleRateHz: 16000, outputChannels: 1, sampleCount: samples, removedLeadingMs: 0 }
        };
        }
      };
    });

    await page.evaluate(async () => { await window.SGDMode.startV3Recording(); });
    assert.equal(await page.evaluate(() => window.__sgdRecorders.length), 1, 'first recorder starts');
    await page.evaluate(() => window.SGDMode.cancelRecording());
    await page.evaluate(async () => { await window.SGDMode.startV3Recording(); });
    assert.equal(await page.evaluate(() => window.__sgdRecorders.length), 2, 'retry recorder starts in a new generation');

    const staleRecorderState = await page.evaluate(() => {
      const oldRecorder = window.__sgdRecorders[0];
      oldRecorder.emitData('STALE_OLD_GENERATION');
      oldRecorder.emitStop();
      return {
        phase: window.SGDMode.getPtePhase(),
        currentRecorderState: window.__sgdRecorders[1].state,
        currentStreamStopped: window.__sgdStreams[1].__fixtureTrack.stopped
      };
    });
    assert.equal(staleRecorderState.phase, 'recording', 'late old stop leaves the retry in recording phase');
    assert.equal(staleRecorderState.currentRecorderState, 'recording', 'late old stop leaves the retry recorder active');
    assert.equal(staleRecorderState.currentStreamStopped, false, 'late old stop leaves the retry microphone stream active');
    report.staleRecorderDidNotStopRetryStream = true;

    await page.evaluate(() => {
      const retryRecorder = window.__sgdRecorders[1];
      retryRecorder.emitData('CURRENT_RETRY_GENERATION');
      window.SGDMode.stopV3Recording();
      retryRecorder.emitStop();
    });
    await page.waitForFunction(() => window.SGDMode?.getPtePhase?.() === 'complete'
      && window.__sgdPreparationInputs.length === 1, null, { timeout: 5000 });
    const retryInput = await page.evaluate(() => window.__sgdPreparationInputs[0]);
    assert.deepEqual(retryInput, { hasStaleOldGeneration: false, hasCurrentRetry: true }, 'retry format conversion owns only its own chunks');
    report.staleChunkExcludedFromRetry = true;

    await page.evaluate(async () => { await window.SGDMode.startV3Recording(); });
    assert.equal(await page.evaluate(() => window.__sgdRecorders.length), 3, 'new recording generation starts while prior DSP is pending');
    await page.evaluate(() => {
      const currentRecorder = window.__sgdRecorders[2];
      currentRecorder.emitData('CURRENT_VALID_GENERATION');
      window.SGDMode.stopV3Recording();
      currentRecorder.emitStop();
    });
    await page.waitForFunction(() => window.SGDMode?.getPtePhase?.() === 'complete'
      && window.__sgdPreparationCalls === 2, null, { timeout: 5000 });
    await page.evaluate(async () => {
      window.__rejectSgdFirstPreparation();
      await Promise.resolve();
      await Promise.resolve();
      window.__sgdArchiveArgs = null;
      window.PTEAttemptArchive = {
        ...(window.PTEAttemptArchive || {}),
        saveAttempt: async args => {
          window.__sgdArchiveArgs = args;
          return { saved: true };
        }
      };
      window.__sgdGateCalls = [];
      window.AiScoringGate = {
        blobToBase64: async blob => {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          window.__sgdScoringWavValid = bytes.length > 44
            && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
            && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE'
            && new DataView(bytes.buffer).getUint16(22, true) === 1
            && new DataView(bytes.buffer).getUint32(24, true) === 16000;
          window.__sgdScoringSample = new DataView(bytes.buffer).getInt16(44, true);
          return 'local-fixture-audio';
        },
        requestConsentAndConfirm: async payload => {
          window.__sgdGateCalls.push({ mode: payload.mode, inputMeta: payload.inputMeta });
          return { allowed: false, cancelled: true };
        }
      };
      await window.SGDMode.submitForFeedback();
    });
    await page.locator('#sgd-v3-ai-score-btn').click();
    await page.waitForFunction(() => document.getElementById('sgd-v3-ai-status')?.textContent.includes('cancelled'), null, { timeout: 5000 });
    report.scoringGate = await page.evaluate(() => ({
      calls: window.__sgdGateCalls.length,
      mode: window.__sgdGateCalls[0]?.mode || null,
      sampleCount: window.__sgdGateCalls[0]?.inputMeta?.sampleCount || null,
      sampleRateHz: window.__sgdGateCalls[0]?.inputMeta?.sampleRateHz || null,
      currentWavHeaderValid: window.__sgdScoringWavValid === true
    }));
    assert.deepEqual(report.scoringGate, {
      calls: 1,
      mode: 'summarize_group_discussion',
      sampleCount: 16000,
      sampleRateHz: 16000,
      currentWavHeaderValid: true
    }, 'local consent stub receives the current validated 16 kHz assessment WAV');
    const rawMediaProof = await page.evaluate(async () => {
      const audio = document.getElementById('sgd-v3-student-audio');
      const archived = window.__sgdArchiveArgs?.media?.[0]?.blob;
      if (!audio?.src || !archived) return null;
      const [playback, archive] = await Promise.all([
        (await fetch(audio.src)).text(), archived.text()
      ]);
      return {
        previewMarker: playback,
        archiveMarker: archive,
        processedFirstSample: window.__sgdScoringSample,
        previewUrl: audio.src.startsWith('blob:')
      };
    });
    report.rawPlaybackAndArchive = rawMediaProof;
    assert.deepEqual(rawMediaProof, {
      previewMarker: 'CURRENT_VALID_GENERATION',
      archiveMarker: 'CURRENT_VALID_GENERATION',
      processedFirstSample: 8192,
      previewUrl: true
    }, 'current SGD preview and archive keep raw captured bytes while scoring receives processed WAV');
    report.olderRejectedConversionPreservedCurrentWav = true;
    assert.deepEqual(pageErrors, [], 'no uncaught page errors');
    report.outcome = 'passed';
  } catch (error) {
    report.outcome = 'failed';
    report.error = error.message;
    if (page && !page.isClosed()) {
      report.diagnostics = await page.evaluate(() => ({
        phase: window.SGDMode?.getPtePhase?.() || null,
        recorderCount: window.__sgdRecorders?.length || 0,
        recorderStates: (window.__sgdRecorders || []).map(recorder => recorder.state),
        streamsStopped: (window.__sgdStreams || []).map(stream => stream.__fixtureTrack.stopped),
        formatPreparationCalls: window.__sgdPreparationCalls || 0,
        formatPreparationInputs: window.__sgdPreparationInputs || [],
        formatPreparationType: typeof window.AudioDspPipeline?.prepareForAssessment,
        hasAudioPipeline: !!window.AudioDspPipeline
      }));
    }
    throw error;
  } finally {
    fs.writeFileSync(path.join(evidence, 'sgd-generation-report.json'), JSON.stringify(report, null, 2));
    await harness.close();
  }
  console.log(JSON.stringify(report));
}

run().catch(error => {
  console.error('[PTE SGD audio generation guard] FAILED:', error);
  process.exitCode = 1;
});
