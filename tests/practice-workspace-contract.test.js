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
  assert.deepEqual([...adapters.keys()], ['asq', 'rts', 'describe-image', 'notes', 'sgd', 'speak', 'type', 'read-aloud']);

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

test('controller exposes idempotent layout sync and teardown hooks', () => {
  assert.match(controllerSource, /function resolveLayoutHost\(/);
  assert.match(controllerSource, /function syncLayout\(/);
  assert.match(controllerSource, /function restoreLayout\(/);
  assert.match(controllerSource, /syncLayout\(state\)/);
  assert.match(controllerSource, /restoreLayout\(state\)/);
  assert.match(controllerSource, /targetParent !== currentParent/);
});
