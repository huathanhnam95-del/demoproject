/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

async function waitForEntries(page) {
  await page.waitForFunction(() => {
    const select = document.getElementById('question-select-notes');
    if (!select || !select.options || select.options.length < 2) return false;
    const first = String(select.options[0].textContent || '').trim().toLowerCase();
    return first !== 'loading...' && !first.startsWith('error');
  }, { timeout: 120000 });
}

async function patchNotesEntries(page, entries) {
  await page.evaluate((nextEntries) => {
    const fb = window.firebase;
    if (!fb || typeof fb.firestore !== 'function') {
      throw new Error('Firebase Firestore SDK is unavailable');
    }

    const originalFirestore = fb.firestore.bind(fb);
    fb.firestore = function patchedFirestore(...args) {
      const db = originalFirestore(...args);
      if (!db || typeof db.collection !== 'function') return db;

      const originalCollection = db.collection.bind(db);
      db.collection = function patchedCollection(name, ...rest) {
        if (name === 'takeNotesEntries') {
          return {
            get: async () => ({
              empty: false,
              docs: nextEntries.map((entry) => ({
                id: String(entry.id),
                data: () => ({ ...entry })
              }))
            })
          };
        }
        return originalCollection(name, ...rest);
      };
      return db;
    };
  }, entries);
}

async function openNotes(page, route, entries) {
  await page.goto('http://127.0.0.1:' + page.__port + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
  await patchNotesEntries(page, entries);
  await page.evaluate((nextRoute) => {
    window.history.replaceState(
      { mode: 'notes', questionId: nextRoute.split('/').pop(), source: 'test' },
      '',
      nextRoute
    );
  }, route);
  await page.evaluate(() => window.switchToMode('notes'));
  await waitForEntries(page);
  await page.waitForFunction(() => document.querySelector('#mode-notes .spc-controller'), { timeout: 30000 });
}

(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.addInitScript(() => {
    window.localStorage.setItem('userStatus', 'guest');
    window.localStorage.setItem('hasSeenScopeTutorial', 'true');
    window.localStorage.setItem('notesModeFirstUse', 'true');
  });
  const page = await context.newPage();
  page.__port = port;

  try {
    const entries = [
      { id: '1', transcript: 'first lecture', level: 1, videoUrl: '' },
      { id: '2', transcript: 'second lecture', level: 1, videoUrl: '' },
      { id: '3', transcript: 'third lecture', level: 1, videoUrl: '' }
    ];

    await openNotes(page, '/pte-practice/speaking/notes/2', entries);

    const initial = await page.evaluate(() => ({
      url: window.location.pathname,
      questionId: document.getElementById('current-question-id-notes')?.textContent?.trim() || '',
      pill: document.querySelector('#spc-picker-notes')?.textContent?.trim() || ''
    }));
    assert.strictEqual(initial.url, '/pte-practice/speaking/notes/2');
    assert.strictEqual(initial.questionId, '2');
    assert.match(initial.pill, /^#2/);

    await page.evaluate(() => document.querySelector('.spc-picker-next')?.click());
    await page.waitForFunction(() => document.getElementById('current-question-id-notes')?.textContent?.trim() === '3');
    const afterNext = await page.evaluate(() => ({
      url: window.location.pathname,
      questionId: document.getElementById('current-question-id-notes')?.textContent?.trim() || '',
      pill: document.querySelector('#spc-picker-notes')?.textContent?.trim() || ''
    }));
    assert.strictEqual(afterNext.url, '/pte-practice/speaking/notes/3');
    assert.strictEqual(afterNext.questionId, '3');
    assert.match(afterNext.pill, /^#3/);

    await page.evaluate(() => document.querySelector('.spc-picker-prev')?.click());
    await page.waitForFunction(() => document.getElementById('current-question-id-notes')?.textContent?.trim() === '2');
    await page.evaluate(() => document.getElementById('play-notes-btn')?.click());
    await page.waitForFunction(() => /\/2\.mp3(?:\?|$)/.test(document.getElementById('notes-audio')?.src || ''), { timeout: 30000 });

    const playback = await page.evaluate(() => ({
      url: window.location.pathname,
      questionId: document.getElementById('current-question-id-notes')?.textContent?.trim() || '',
      audioSrc: document.getElementById('notes-audio')?.src || '',
      audioReadyState: document.getElementById('notes-audio')?.readyState || 0
    }));
    assert.strictEqual(playback.url, '/pte-practice/speaking/notes/2');
    assert.strictEqual(playback.questionId, '2');
    assert.match(playback.audioSrc, /\/database\/Take%20Notes\/RL\/audio\/2\.mp3(?:\?|$)/);
    assert.ok(playback.audioReadyState >= 1);

    console.log('notes navigation and audio browser check passed');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
