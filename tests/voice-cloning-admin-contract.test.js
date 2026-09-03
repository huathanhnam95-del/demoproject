const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

test('CRM Admin HTML defines Voice Cloning navigation and panel elements', () => {
    const htmlPath = path.join(ROOT, 'public', 'crm-admin.html');
    assert.ok(fs.existsSync(htmlPath), 'crm-admin.html must exist');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Navigation
    assert.match(html, /data-main="voice-cloning"/, 'More dropdown must contain data-main="voice-cloning"');
    assert.match(html, /data-panel="voice-cloning"/, 'Must contain section data-panel="voice-cloning"');

    // Worker status & queue controls
    assert.match(html, /id="vc-worker-status-badge"/, 'Must have worker status badge');
    assert.match(html, /id="btn-vc-worker-refresh"/, 'Must have worker refresh button');
    assert.match(html, /id="btn-vc-queue-trigger"/, 'Must have queue trigger button');
    assert.match(html, /id="vc-queue-count-badge"/, 'Must have queue count badge');

    // Calibration wizard
    assert.match(html, /id="vc-calibration-prompt-text"/, 'Must have calibration prompt text');
    assert.match(html, /id="btn-vc-record-toggle"/, 'Must have record toggle button');
    assert.match(html, /id="btn-vc-generate-test"/, 'Must have generate test output button');
    assert.match(html, /id="vc-profile-name-input"/, 'Must have profile name input');
    assert.match(html, /id="btn-vc-save-profile"/, 'Must have save profile button');
    assert.match(html, /id="vc-saved-profiles-list"/, 'Must have saved profiles list container');
    assert.match(html, /id="vc-saved-count"/, 'Must have saved count element');
    assert.match(html, /id="btn-vc-refresh-profiles"/, 'Must have refresh profiles button');

    // High contrast styling classes
    assert.match(html, /class="crm-voice-prompt-box/, 'Must use crm-voice-prompt-box');
    assert.match(html, /class="crm-voice-prompt-text"/, 'Must use crm-voice-prompt-text');

    // TTS Studio
    assert.match(html, /id="vc-studio-voice-select"/, 'Must have voice selector dropdown');
    assert.match(html, /id="btn-vc-style-formal"/, 'Must have formal style button');
    assert.match(html, /id="btn-vc-style-connected"/, 'Must have connected style button');
    assert.match(html, /id="vc-studio-text-input"/, 'Must have text input textarea');
    assert.match(html, /id="btn-vc-studio-synthesize"/, 'Must have synthesize button');
    assert.match(html, /id="btn-vc-download-mp3"/, 'Must have download MP3 link');

    // Script tag
    assert.match(html, /src="js\/crm\/voice-cloning-workspace\.js/, 'Must load voice-cloning-workspace.js');
});

test('Cloud backend routes define Voice Cloning admin router', () => {
    const apiAppPath = path.join(ROOT, 'functions', 'src', 'apiApp.js');
    assert.ok(fs.existsSync(apiAppPath), 'apiApp.js must exist');
    const apiAppCode = fs.readFileSync(apiAppPath, 'utf8');

    assert.match(apiAppCode, /\/api\/admin\/voice-cloning/, 'apiApp.js must mount /api/admin/voice-cloning');

    const routerPath = path.join(ROOT, 'functions', 'src', 'voice-cloning', 'admin-routes.js');
    assert.ok(fs.existsSync(routerPath), 'admin-routes.js must exist');
    const routerModule = require(routerPath);
    assert.equal(typeof routerModule.createVoiceCloningAdminRouter, 'function', 'Must export createVoiceCloningAdminRouter');
    assert.equal(typeof routerModule.isVoiceWorkerReady, 'function', 'Must export isVoiceWorkerReady');

    const routerCode = fs.readFileSync(routerPath, 'utf8');
    assert.match(routerCode, /\/upload-reference/, 'Must define /upload-reference endpoint');
    assert.match(routerCode, /\/audio\/:audioId/, 'Must define /audio/:audioId endpoint');
    assert.match(routerCode, /delete\('\/profiles\/:profileId'/, 'Must define DELETE /profiles/:profileId endpoint');
});

test('Local Python worker script exists and has required components', () => {
    const workerPath = path.join(ROOT, 'scripts', 'voice_local_worker.py');
    assert.ok(fs.existsSync(workerPath), 'voice_local_worker.py must exist');
    const workerCode = fs.readFileSync(workerPath, 'utf8');

    assert.match(workerCode, /class VoiceLocalWorker/, 'Must define VoiceLocalWorker class');
    assert.match(workerCode, /voice_worker_status/, 'Must target voice_worker_status collection');
    assert.match(workerCode, /voice_cloning_queue/, 'Must target voice_cloning_queue collection');
    assert.match(workerCode, /ConnectedSpeechPreprocessor/, 'Must integrate ConnectedSpeechPreprocessor');
    assert.match(workerCode, /format="MP3"/, 'Must output MP3 format');
});
