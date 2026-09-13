'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const notesSource = fs.readFileSync(path.join(root, 'public', 'take-notes-mode.js'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'public', 'js', 'lazy-loader.js'), 'utf8');
const playerSource = fs.readFileSync(path.join(root, 'public', 'js', 'practice-audio-player.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

test('Notes declares bounded entry and audio recovery budgets', () => {
  assert.match(notesSource, /NOTES_ENTRY_DEADLINE_MS\s*=\s*12_000/);
  assert.match(notesSource, /NOTES_AUDIO_DEADLINE_MS\s*=\s*10_000/);
  assert.match(notesSource, /NOTES_FALLBACK_OFFER_DELAY_MS\s*=\s*1_500/);
  assert.match(notesSource, /AbortController/);
  assert.match(notesSource, /remaining(?:Budget|Ms)/);
  assert.match(notesSource, /generation|entryGeneration|audioToken/);
});

test('Notes prerequisites run concurrently and do not wait for YouTube', () => {
  const notesLoader = loaderSource.slice(
    loaderSource.indexOf('async function ensureNotesModeLoaded'),
    loaderSource.indexOf('async function ensureRfibModeLoaded')
  );
  assert.match(notesLoader, /Promise\.all/);
  assert.match(notesLoader, /ensureCompromiseLoaded\(\)/);
  assert.match(notesLoader, /ensureXlsxLoaded\(\)/);
  assert.doesNotMatch(notesLoader, /ensureYouTubePlayerLoaded\(\)/);
});

test('audio readiness and playback rejection remain observable to Notes', () => {
  assert.match(notesSource, /canplay/);
  assert.match(notesSource, /onPlaybackError/);
  assert.match(playerSource, /onPlaybackError/);
  assert.match(playerSource, /audio\.play\(\)\.catch\(/);
  assert.match(html, /id="notes-audio-status"[^>]+role="status"/);
  assert.match(html, /data-notes-status=/);
});

test('Retell actions are canonical and compatibility aliases are non-interactive', () => {
  assert.match(notesSource, /notes-start-btn/);
  assert.match(notesSource, /notes-submit-btn/);
  assert.match(notesSource, /notes-retry-btn/);
  assert.match(notesSource, /notes-in-card-submit-btn/);
  assert.match(notesSource, /notes-in-card-retry-btn/);
  assert.match(notesSource, /tabIndex\s*=\s*-1|tabindex="-1"/);
});
