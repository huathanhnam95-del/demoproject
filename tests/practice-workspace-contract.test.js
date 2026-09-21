'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const controllerSource = fs.readFileSync(
  path.join(root, 'public', 'js', 'speaking-practice-controller.js'),
  'utf8'
);
const adaptersSource = fs.readFileSync(
  path.join(root, 'public', 'js', 'speaking-practice-adapters.js'),
  'utf8'
);

const sharedModes = [
  'notes',
  'speak',
  'type',
  'asq',
  'rts',
  'describe-image',
  'sgd',
  'read-aloud'
];

function loadRegisteredAdapters() {
  const registered = new Map();
  const context = {
    window: {
      SpeakingPracticeController: {
        register(config) {
          registered.set(config.modeId, config);
        }
      }
    },
    console: { warn() {}, error() {} }
  };
  vm.runInNewContext(adaptersSource, context, { filename: 'speaking-practice-adapters.js' });
  return registered;
}

test('all shared speaking adapters declare reversible task-local layout hosts', () => {
  const adapters = loadRegisteredAdapters();
  assert.deepEqual([...adapters.keys()], ['asq', 'rts', 'sgd', 'describe-image', 'notes', 'speak', 'type', 'read-aloud']);

  for (const modeId of sharedModes) {
    const layout = adapters.get(modeId)?.layout;
    assert.ok(layout, `${modeId} must declare a layout contract`);
    assert.equal(typeof layout.mediaHost, 'function', `${modeId} mediaHost must resolve from the active panel`);
    assert.equal(typeof layout.attemptHost, 'function', `${modeId} attemptHost must resolve from the active phase`);
    assert.equal(typeof layout.progressHost, 'function', `${modeId} progressHost must resolve from the active panel`);
  }
});

test('layout host markup covers every shared mode without moving adjacent modes', () => {
  for (const modeId of sharedModes) {
    const panelStart = html.indexOf(`id="mode-${modeId}"`);
    assert.ok(panelStart >= 0, `missing ${modeId} panel`);
    const nextPanel = html.indexOf('id="mode-', panelStart + 1);
    const panel = html.slice(panelStart, nextPanel === -1 ? undefined : nextPanel);
    assert.match(panel, /data-practice-workspace=/, `${modeId} must opt into the shared workspace explicitly`);
    assert.match(panel, /data-practice-action-host=/, `${modeId} must expose a local action host`);
  }

  for (const modeId of ['extended', 'watch', 'pronounce', 'collo-dictate', 'rfib', 'dd', 'rmcsa', 'rmcma', 'rop', 'essay', 'swt']) {
    const panelStart = html.indexOf(`id="mode-${modeId}"`);
    assert.ok(panelStart >= 0, `missing adjacent ${modeId} panel`);
    const nextPanel = html.indexOf('id="mode-', panelStart + 1);
    const panel = html.slice(panelStart, nextPanel === -1 ? undefined : nextPanel);
    assert.doesNotMatch(panel, /data-practice-workspace=/, `${modeId} must stay outside the shared workspace`);
  }
});

test('adapters use explicit phase-owned hosts and Notes keeps one canonical start path', () => {
  const expectedHosts = {
    asq: ['.asq-audio', '#asq-action-host'],
    rts: ['#rts-start-controls', '#rts-audio-action-host', '#rts-prep-action-host', '#rts-action-host', '#rts-results-action-host'],
    'describe-image': ['#di-start-controls', '#di-prepare-action-host', '#di-action-host', '#di-review-action-host', '#di-results-action-host'],
    notes: ['#notes-audio-host', '#notes-ready-action-host', '#notes-video-action-host', '#notes-audio-action-host', '#notes-results-action-host'],
    sgd: ['#sgd-start-controls', '#sgd-listen-action-host', '#sgd-action-host', '#sgd-results-action-host'],
    speak: ['.speak-audio', '#speak-action-host'],
    type: ['.wfd-audio', '#type-action-host'],
    'read-aloud': ['#ra-action-host']
  };

  for (const [modeId, selectors] of Object.entries(expectedHosts)) {
    for (const selector of selectors) {
      assert.ok(adaptersSource.includes(selector), `${modeId} must name explicit host ${selector}`);
      if (selector.startsWith('#') && !selector.includes('audio-host')) {
        assert.match(html, new RegExp(`id=["']${selector.slice(1)}["'][^>]*data-practice-(?:action|media)-host=`), `${selector} must be a declared host`);
      }
    }
  }

  assert.match(html, /id="notes-audio-host"[^>]*data-practice-media-host="notes"/);
  assert.match(adaptersSource, /sourceId: ['"]notes-start-btn['"]/);
  assert.doesNotMatch(adaptersSource, /sourceId: ['"]play-notes-btn['"]/);
  assert.match(html, /id="play-notes-btn"[^>]*hidden/);
});

test('controller exposes phase resync, slot-origin restoration, and containment guards', () => {
  assert.match(controllerSource, /function resolveLayoutHost\(/);
  assert.match(controllerSource, /function syncLayoutPlacement\(/);
  assert.match(controllerSource, /function restoreLayoutPlacement\(/);
  assert.match(controllerSource, /syncControlPlacement\(state\)/);
  assert.match(controllerSource, /restoreLayoutPlacement\(state\)/);
  assert.match(controllerSource, /nextSibling:\s*slot\.nextSibling/);
  assert.match(controllerSource, /!host\.contains\(slot\)/);
  assert.match(controllerSource, /\[0,\s*250,\s*750,\s*1500\]/);
});
