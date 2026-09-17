'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { chromium, expect } = require('playwright/test');
const { createStudio } = require('../../tools/avatar_preparation/server.cjs');

async function main() {
  const evidence = process.env.AVATAR_EVIDENCE_DIR || path.join(os.homedir(), '.codex', 'avatar-preparation-task', 'verification', `browser-${Date.now()}`);
  await fs.mkdir(evidence, { recursive: true });
  const videoPath = path.join(evidence, 'asymmetric-camera.y4m'); const audioPath = path.join(evidence, 'tone-microphone.wav');
  const w = 320, h = 240; const frame = Buffer.alloc(w * h * 3 / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) frame[y * w + x] = x < w / 2 ? 76 : 29;
  for (let y = 0; y < h / 2; y++) for (let x = 0; x < w / 2; x++) { frame[w * h + y * w / 2 + x] = x < w / 4 ? 84 : 255; frame[w * h * 5 / 4 + y * w / 2 + x] = x < w / 4 ? 255 : 107; }
  await fs.writeFile(videoPath, Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F25:1 Ip A1:1 C420jpeg\n`), ...Array.from({ length: 75 }, () => [Buffer.from('FRAME\n'), frame]).flat()]));
  const samples = 48000 * 5; const wav = Buffer.alloc(44 + samples * 2); wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40); for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(6000 * Math.sin(i * 2 * Math.PI * 440 / 48000)), 44 + i * 2); await fs.writeFile(audioPath, wav);
  const dataDir = await fs.mkdtemp(path.join(evidence, 'chrome-data-')); let app = await createStudio({ dataDir, port: 0 }); let fresh;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${videoPath}`, `--use-file-for-fake-audio-capture=${audioPath}`, '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, permissions: ['camera', 'microphone'] }); const page = await context.newPage();
  const errors = []; const requests = []; const milestones = [];
  const observe = page => { page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { requests.push({ method: request.method(), url: request.url() }); }); };
  observe(page);
  try {
    await page.goto(app.origin); await page.waitForLoadState('networkidle');
    await page.locator('#project-name').fill('Bản chuẩn · Local avatar'); await page.locator('#subject').fill('Người hướng dẫn'); await page.locator('#create-project button').click(); await expect(page.locator('#workspace')).toBeVisible();
    await page.locator('#scene').selectOption('front-neutral');
    await page.locator('#enable-devices').click(); await expect(page.locator('#device-status')).toContainText('Devices on'); await page.waitForFunction(() => document.getElementById('preview').videoWidth > 0);
    await page.locator('#record').click(); await expect(page.locator('#save-take')).toBeEnabled({ timeout: 15000 });
    const orientation = await page.locator('#photo-preview').evaluate(img => { const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); return { width: canvas.width, left: [...ctx.getImageData(canvas.width / 4, canvas.height / 2, 1, 1).data], right: [...ctx.getImageData(canvas.width * .75, canvas.height / 2, 1, 1).data] }; });
    assert.ok(orientation.left[0] > orientation.left[2] + 80, 'Saved photo must retain red on original left'); assert.ok(orientation.right[2] > orientation.right[0] + 80, 'Saved photo must retain blue on original right');
    page.once('dialog', dialog => dialog.dismiss()); await page.locator('#retake').click(); await expect(page.locator('#save-take')).toBeEnabled();
    await page.route('**/api/drafts/*/commit', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Injected save failure; retry is safe.' }) }));
    await page.locator('#save-take').click(); await expect(page.locator('#status')).toContainText('Injected save failure'); await expect(page.locator('#save-take')).toBeEnabled(); await page.unroute('**/api/drafts/*/commit');
    await page.locator('#save-take').click(); await expect(page.locator('#take-count')).toHaveText('1 saved take'); milestones.push('Unmirrored camera photo; retake cancellation; failed-save preview preservation and retry');
    await page.locator('[data-group="core"]').click(); await page.locator('#language').selectOption('en'); await page.locator('#enable-devices').click(); await expect(page.locator('#device-status')).toContainText('Devices on');
    await page.locator('#record').click(); await expect(page.locator('#record')).toContainText('Stop recording', { timeout: 10000 }); await page.waitForTimeout(1800); await page.locator('#record').click(); await expect(page.locator('#save-take')).toBeEnabled({ timeout: 15000 });
    const playback = await page.locator('#preview').evaluate(async video => { await video.play(); await new Promise(resolve => setTimeout(resolve, 500)); const result = { time: video.currentTime, width: video.videoWidth, height: video.videoHeight, readyState: video.readyState }; video.pause(); return result; }); assert.ok(playback.time > .1 && playback.width > 0 && playback.readyState >= 2);
    await page.locator('#save-take').click(); await expect(page.locator('#take-count')).toHaveText('2 saved takes'); milestones.push('Real MediaRecorder video bytes decode and play in Chrome');
    await page.screenshot({ path: path.join(evidence, 'studio-video.png'), fullPage: true });
    await page.locator('[data-group="voice"]').click(); await page.locator('#scene').selectOption('neutral-voice'); await page.locator('#language').selectOption('vi');
    const draftText = 'Tôi đang luyện tiếng Việt.\n\nGiữ nguyên: ắ, ề, ự — và khoảng trắng.';
    await page.locator('#script-draft').fill(draftText); await page.locator('#save-script').click(); await expect(page.locator('#status')).toContainText('Script draft saved');
    await page.locator('#enable-devices').click(); await expect(page.locator('#device-status')).toContainText('Devices on'); await page.locator('#record').click(); await expect(page.locator('#record')).toContainText('Stop recording', { timeout: 10000 }); await page.waitForTimeout(1800); await page.locator('#record').click(); await expect(page.locator('#save-take')).toBeEnabled({ timeout: 15000 });
    const audioPlayed = await page.locator('#audio-preview').evaluate(async audio => { await audio.play(); await new Promise(resolve => setTimeout(resolve, 400)); const time = audio.currentTime; audio.pause(); return time; }); assert.ok(audioPlayed > .1);
    await page.locator('#save-take').click(); await expect(page.locator('#take-count')).toHaveText('3 saved takes'); await expect(page.locator('#save-status')).toHaveText('Project saved locally', { timeout: 15000 });
    await page.locator('.take-row button').first().click(); await expect(page.locator('#expected-transcript')).toHaveValue(draftText); const actualText = 'Lời nói thực tế.\nKhông giống bản nháp.'; await page.locator('#actual-transcript').fill(actualText); await page.locator('#transcript-reviewed').check(); await page.locator('#save-transcript').click(); await expect(page.locator('#status')).toContainText('Actual transcript review saved');
    const p = (await app.store.list())[0]; const project = await app.store.get(p.id); assert.equal(project.scriptDrafts['neutral-voice:vi'], draftText); assert.equal(project.takes.at(-1).actualTranscript, actualText); assert.ok(project.assets.some(a => a.role === 'derivative' && a.processing.stats.sampleRate === 16000));
    milestones.push('Playable original microphone audio and separate real DSP WAV; Unicode draft and reviewed transcript remain independent');
    const port = Number(new URL(app.origin).port); await app.close(); app = await createStudio({ dataDir, port }); await page.reload(); await page.waitForLoadState('networkidle'); await page.locator('#projects').selectOption(p.id); await expect(page.locator('#take-count')).toHaveText('3 saved takes');
    await page.locator('#export-project').click(); await expect(page.locator('#export-result')).toBeVisible(); const exported = await page.locator('#export-path').textContent(); const manifest = JSON.parse(await fs.readFile(path.join(exported, 'manifest.json'), 'utf8'));
    for (const asset of manifest.assets) { const bytes = await fs.readFile(path.join(exported, asset.path)); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256); }
    fresh = await createStudio({ dataDir: await fs.mkdtemp(path.join(evidence, 'fresh-import-')), port: 0 }); const freshContext = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const restored = await freshContext.newPage(); observe(restored); await restored.goto(fresh.origin); await restored.waitForLoadState('networkidle');
    await restored.locator('#package-files').setInputFiles(exported); await expect(restored.locator('#take-count')).toHaveText('3 saved takes', { timeout: 15000 });
    const recovered = await fresh.store.get((await fresh.store.list())[0].id); assert.deepEqual(recovered.assets, manifest.assets); assert.deepEqual(recovered.takes, manifest.takes); assert.deepEqual(recovered.scriptDrafts, manifest.scriptDrafts);
    milestones.push('Server/browser reload and fresh-profile, fresh-directory portable import with all media hashes and Unicode preserved');
    await restored.locator('#scene').selectOption('front-neutral'); const photoAsset = manifest.assets.find(a => a.mime === 'image/png');
    await restored.locator('#media-file').setInputFiles(path.join(exported, photoAsset.path)); await expect(restored.locator('#save-take')).toBeEnabled(); await restored.locator('#save-take').click(); await expect(restored.locator('#take-count')).toHaveText('4 saved takes');
    const afterSupplementaryImport = await fresh.store.get(recovered.id); assert.equal(afterSupplementaryImport.assets.at(-1).sha256, photoAsset.sha256); milestones.push('Supplementary media import preserves original photo bytes');
    await restored.locator('.take-row button').first().click(); restored.once('dialog', d => d.accept()); await restored.locator('#archive-take').click(); await expect(restored.locator('#take-count')).toHaveText('3 saved takes');
    await restored.locator('#show-archived').check(); await expect(restored.locator('#take-count')).toHaveText('4 saved takes'); await restored.locator('.take-row button').first().click(); await expect(restored.locator('#select-take')).toBeDisabled(); await restored.locator('#archive-take').click(); await expect(restored.locator('#status')).toContainText('Take restored');
    assert.equal((await fresh.store.get(recovered.id)).assets.at(-1).sha256, photoAsset.sha256); milestones.push('Archive and restore retain accessible original media');
    await restored.locator('[data-group="expression"]').click(); await restored.locator('#scene').selectOption('empathetic'); await restored.locator('#language').selectOption('en'); const cue1 = await restored.locator('#cue-text').textContent(); await restored.locator('#cue-next').click(); assert.notEqual(await restored.locator('#cue-text').textContent(), cue1); await restored.locator('#cue-size').click(); await expect(restored.locator('#cue-text')).toHaveClass('large');
    await restored.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test denial', 'NotAllowedError'); }; }); await restored.locator('#enable-devices').click(); await expect(restored.locator('#status')).toContainText('permission was denied'); await expect(restored.locator('#device-status')).toHaveText('Devices off');
    await restored.setViewportSize({ width: 720, height: 1000 }); await restored.screenshot({ path: path.join(evidence, 'studio-narrow.png'), fullPage: true }); assert.equal(await restored.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    await restored.setViewportSize({ width: 1500, height: 1100 }); await restored.evaluate(() => window.scrollTo(0, 0)); await restored.screenshot({ path: path.join(evidence, 'studio-guided.png'), fullPage: true });
    milestones.push('Guided cues, text size, denied-permission recovery and narrow-layout overflow check');
    const allowedOrigins = new Set([app.origin, fresh.origin]);
    assert.deepEqual(errors, []); assert.ok(requests.every(r => { const url = new URL(r.url); return url.protocol === 'blob:' ? allowedOrigins.has(new URL(url.pathname).origin) : url.protocol === 'http:' && allowedOrigins.has(url.origin); }), 'Every HTTP request or blob preview must belong to one of the tested studio origins');
    const report = { browser: browser.version(), physicalHardwareTested: false, captureSource: 'Generated asymmetric Y4M and 440 Hz WAV fixtures', orientation, playback, audioPlayed, milestones, networkRequests: requests, pageErrors: errors, exports: exported, dataDir };
    await fs.writeFile(path.join(evidence, 'chrome-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: true, milestones, browser: report.browser, physicalHardwareTested: false, evidence }, null, 2));
  } catch (error) { await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(evidence, 'failure.json'), JSON.stringify({ error: error.stack, pageErrors: errors, requests }, null, 2)); throw error; }
  finally { await browser.close(); await app.close(); if (fresh) await fresh.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
