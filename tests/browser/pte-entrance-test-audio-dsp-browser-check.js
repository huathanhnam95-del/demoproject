'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/pte-shell-harness');

const evidence = process.env.PTE_SHELL_EVIDENCE;
if (!evidence) throw new Error('PTE_SHELL_EVIDENCE must point outside the repository');

function inspectWav(buffer, expectedSampleRateHz = 16000) {
  const bytes = Buffer.from(buffer || []);
  const isPcm = bytes.length >= 44
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WAVE'
    && bytes.toString('ascii', 12, 16) === 'fmt '
    && bytes.readUInt16LE(20) === 1
    && bytes.readUInt16LE(22) === 1
    && bytes.readUInt32LE(24) === expectedSampleRateHz
    && bytes.readUInt16LE(34) === 16
    && bytes.toString('ascii', 36, 40) === 'data';
  return {
    validPcmWav: isPcm,
    byteLength: bytes.length,
    channels: isPcm ? bytes.readUInt16LE(22) : null,
    sampleRateHz: isPcm ? bytes.readUInt32LE(24) : null,
    bitsPerSample: isPcm ? bytes.readUInt16LE(34) : null,
    dataBytes: isPcm ? bytes.readUInt32LE(40) : null
  };
}

async function run() {
  const harness = await createHarness();
  const report = {
    flow: 'learner-speaking-capture-submit',
    fixtureApiCalls: { session: 0, upload: 0, submit: 0, progress: 0, unexpected: 0 },
    uploadedAudio: null,
    playbackAudio: null,
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
      sessionStorage.setItem('guestMode', 'true');
      sessionStorage.setItem('welcomeModalSeen', 'true');

      function makePcmWav(sampleRate, frequencyHz, durationSeconds) {
        const sampleCount = Math.round(sampleRate * durationSeconds);
        const buffer = new ArrayBuffer(44 + sampleCount * 2);
        const view = new DataView(buffer);
        const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
        write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true);
        write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        write(36, 'data'); view.setUint32(40, sampleCount * 2, true);
        for (let index = 0; index < sampleCount; index += 1) {
          const sample = Math.round(Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate) * 5000);
          view.setInt16(44 + index * 2, sample, true);
        }
        return new Blob([buffer], { type: 'audio/wav' });
      }
      window.__entranceRawCaptureFixture = makePcmWav(48000, 440, 0.5);

      class FixtureRecorder extends EventTarget {
        constructor(stream) {
          super();
          this.stream = stream;
          this.mimeType = 'audio/wav';
          this.state = 'inactive';
        }
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          const data = new Event('dataavailable');
          Object.defineProperty(data, 'data', { value: window.__entranceRawCaptureFixture });
          this.dispatchEvent(data);
          this.dispatchEvent(new Event('stop'));
        }
        static isTypeSupported() { return false; }
      }
      Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FixtureRecorder });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }
      });
    });

    await page.route('**/api/entrance-tests/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/entrance-tests/session' && request.method() === 'GET') {
        report.fixtureApiCalls.session += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            testId: 'local-fixture-test',
            progress: null,
            session: {
              sections: [{
                id: 'speaking',
                titleVi: 'Speaking',
                instructionVi: 'Read the text aloud and submit your recording.',
                questions: [{
                  type: 'speaking',
                  sectionId: 'speaking',
                  questionId: 'fixture-speaking-question',
                  questionNumber: 1,
                  instructionVi: 'Record your answer.',
                  text: 'This is a local browser fixture for the speaking upload path.'
                }]
              }]
            }
          })
        });
        return;
      }

      if (url.pathname === '/api/entrance-tests/speaking/upload' && request.method() === 'POST') {
        report.fixtureApiCalls.upload += 1;
        const uploadBytes = request.postDataBuffer() || Buffer.alloc(0);
        report.uploadedAudio = {
          contentType: request.headers()['content-type'] || null,
          ...inspectWav(uploadBytes, 48000),
          bytesBase64: uploadBytes.toString('base64')
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, transcript: null, accuracyPercent: null })
        });
        return;
      }

      if (url.pathname === '/api/entrance-tests/submit' && request.method() === 'POST') {
        report.fixtureApiCalls.submit += 1;
        const body = JSON.parse(request.postData() || '{}');
        report.submittedResponseSections = Object.keys(body.responses || {}).sort();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
        return;
      }

      if (url.pathname === '/api/entrance-tests/progress') report.fixtureApiCalls.progress += 1;
      report.fixtureApiCalls.unexpected += 1;
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false }) });
    });

    await page.goto(`${harness.baseURL}/entrance-test.html?token=local-fixture-token`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#et-next', { timeout: 10000 });
    await page.evaluate(() => {
      if (!window.AudioDspPipeline || typeof window.AudioDspPipeline.enhance !== 'function') {
        throw new Error('AudioDspPipeline did not load on the Entrance Test page');
      }

      window.__entranceDspCalls = 0;
      window.AudioDspPipeline = {
        ...window.AudioDspPipeline,
        enhance: async () => {
          window.__entranceDspCalls += 1;
          throw new Error('Entrance Test upload must preserve the raw browser capture.');
        }
      };
    });

    await page.locator('#et-next').click();
    await page.locator('#et-start-section').click();
    await page.waitForSelector('#btn-start-rec', { timeout: 10000 });
    await page.locator('#btn-start-rec').click();
    await page.waitForSelector('#btn-stop-rec', { timeout: 5000 });
    await page.locator('#btn-stop-rec').evaluate(button => button.click());
    await page.waitForFunction(() => !!document.querySelector('#audio-preview')?.src);
    report.playbackAudio = await page.locator('#audio-preview').evaluate(async audio => {
      const actualPlayback = await (await fetch(audio.src)).blob();
      const toBase64 = async blob => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
        }
        return btoa(binary);
      };
      const header = new DataView(await actualPlayback.slice(0, 44).arrayBuffer());
      return {
        type: actualPlayback.type,
        src: audio.src,
        validPcmWav: header.getUint32(0, false) === 0x52494646 && header.getUint32(8, false) === 0x57415645
          && header.getUint16(20, true) === 1 && header.getUint16(22, true) === 1 && header.getUint16(34, true) === 16,
        channels: header.getUint16(22, true),
        sampleRateHz: header.getUint32(24, true),
        bitsPerSample: header.getUint16(34, true),
        bytesBase64: await toBase64(actualPlayback),
        originalBytesBase64: await toBase64(window.__entranceRawCaptureFixture)
      };
    });
    assert.equal(report.playbackAudio.type, 'audio/wav', 'preview keeps the raw capture MIME type');
    assert.equal(report.playbackAudio.validPcmWav, true, 'the synthetic capture is a playable PCM WAV');
    assert.equal(report.playbackAudio.sampleRateHz, 48000, 'preview retains the raw 48 kHz capture');
    assert.equal(report.playbackAudio.bytesBase64, report.playbackAudio.originalBytesBase64, 'preview bytes remain identical to the raw recording');
    assert.equal(await page.evaluate(() => window.__entranceDspCalls), 0, 'Entrance Test does not alter the captured audio');
    await page.locator('#btn-submit').click();
    await page.waitForFunction(() => document.querySelector('#et-card .et-title')?.textContent.includes('Cảm ơn bạn!'), null, { timeout: 10000 });

    assert.deepEqual(report.fixtureApiCalls, { session: 1, upload: 1, submit: 1, progress: 0, unexpected: 0 });
    assert.equal(report.uploadedAudio.contentType, 'audio/wav', 'upload declares the captured raw MIME type');
    assert.equal(report.uploadedAudio.validPcmWav, true, 'upload bytes remain the captured PCM RIFF/WAVE data');
    assert.equal(report.uploadedAudio.channels, 1, 'raw capture remains mono');
    assert.equal(report.uploadedAudio.sampleRateHz, 48000, 'raw capture remains 48 kHz');
    assert.equal(report.uploadedAudio.bitsPerSample, 16, 'raw capture remains 16-bit PCM');
    assert.equal(report.uploadedAudio.bytesBase64, report.playbackAudio.bytesBase64, 'upload and playback use the exact same original bytes');
    assert.deepEqual(report.submittedResponseSections, ['grammar', 'listen_write', 'vocab']);
    assert.deepEqual(pageErrors, [], 'no uncaught page errors');
    report.outcome = 'passed';
  } catch (error) {
    report.outcome = 'failed';
    report.error = error.message;
    throw error;
  } finally {
    if (report.playbackAudio?.bytesBase64) {
      const rawBytes = Buffer.from(report.playbackAudio.bytesBase64, 'base64');
      const rawPath = path.join(evidence, 'entrance-test-raw-playback-synthetic.wav');
      fs.writeFileSync(rawPath, rawBytes);
      report.playbackAudio.samplePath = rawPath;
      report.playbackAudio.sha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');
      delete report.playbackAudio.bytesBase64;
      delete report.playbackAudio.originalBytesBase64;
    }
    if (report.uploadedAudio?.bytesBase64) {
      const uploadedBytes = Buffer.from(report.uploadedAudio.bytesBase64, 'base64');
      const uploadedPath = path.join(evidence, 'entrance-test-original-upload-synthetic.wav');
      fs.writeFileSync(uploadedPath, uploadedBytes);
      report.uploadedAudio.samplePath = uploadedPath;
      report.uploadedAudio.sha256 = crypto.createHash('sha256').update(uploadedBytes).digest('hex');
      delete report.uploadedAudio.bytesBase64;
    }
    fs.writeFileSync(path.join(evidence, 'entrance-test-report.json'), JSON.stringify(report, null, 2));
    await harness.close();
  }
  console.log(JSON.stringify(report));
}

run().catch(error => {
  console.error('[PTE Entrance Test Audio DSP] FAILED:', error);
  process.exitCode = 1;
});
