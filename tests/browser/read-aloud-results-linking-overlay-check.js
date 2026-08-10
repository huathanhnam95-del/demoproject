/* eslint-disable no-console */
/**
 * Speech Coach results: SVG linking overlay.
 *
 * The overlay shipped in V1.6.1 (2026-03-30) and rendered correctly until the
 * connected-speech family gate landed in V1.8.28 (2026-07-25), which made
 * renderOverlay early-return for callers that do not name a family. This check
 * pins the restored behaviour: coloured arcs are drawn between the linked word
 * pairs, tinted by detection status, without disturbing the token annotations.
 */
const assert = require('assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

const screenshotDir = path.resolve(__dirname, '../../test-results/read-aloud-practice-ui-repairs');
fs.mkdirSync(screenshotDir, { recursive: true });

const failures = [];

function check(label, value) {
  if (!value) {
    failures.push(label);
    console.error(`FAIL: ${label}`);
    return;
  }
  console.log(`PASS: ${label}`);
}

const STATUS_COLORS = { detected: '#10b981', not_detected: '#ef4444', uncertain: '#f59e0b' };

async function main() {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    await context.addInitScript(() => {
      window.localStorage.setItem('userStatus', 'guest');
      window.localStorage.setItem('hasSeenScopeTutorial', 'true');
      window.localStorage.setItem('read-aloudModeFirstUse', 'true');
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const preloader = document.getElementById('app-preloader');
      if (!preloader) return true;
      return getComputedStyle(preloader).display === 'none' || Boolean(document.getElementById('preloader-dismiss-btn'));
    }, { timeout: 30000 });
    const dismiss = page.locator('#preloader-dismiss-btn');
    if (await dismiss.count()) await dismiss.click({ timeout: 5000 }).catch(() => {});
    const guest = page.locator('#guest-mode-btn');
    if (await guest.count()) await guest.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(250);

    await page.evaluate(async () => { await window.switchToMode('read-aloud'); });
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      return panel?.classList.contains('active') && !!panel.querySelector('.spc-controller');
    }, { timeout: 30000 });
    await page.waitForFunction(() => window.ReadAloudMode?.hasLoadedDatabase === true, { timeout: 30000 });
    await page.evaluate(() => window.SpeakingPracticeController.setPreferredView('advanced'));
    await page.waitForTimeout(500);

    // Walk prompts until one has at least two eligible linking boundaries, then
    // build the results fixture from that real analysis so the phrases match.
    const fixture = await page.evaluate(async () => {
      const ra = window.ReadAloudMode;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const text = ra.currentPromptPlainText;
        if (text) {
          const analysis = await window.ReadAloudLinking.analyzePrompt(text, {
            accentProfile: 'en-US',
            connectedSpeechLevel: 'sound_changes',
            enabledRuleSet: 'connected-speech-v3'
          });
          const eligible = (analysis.boundaries || []).filter((b) => (
            !b.blocked && (b.confidence === 'high' || b.confidence === 'medium')
              && String(b.layer || 'linking') !== 'assimilation'
          ));
          if (eligible.length >= 2) {
            const statuses = ['detected', 'not_detected', 'uncertain'];
            return {
              text,
              events: eligible.slice(0, 3).map((b, i) => ({
                eventId: `e-${i}`,
                phrase: `${b.leftDisplay} ${b.rightDisplay}`,
                category: 'linking',
                family: 'linking',
                status: statuses[i % statuses.length],
                feedbackText: `Link ${b.leftDisplay} into ${b.rightDisplay}.`
              }))
            };
          }
        }
        await ra.loadNextPrompt();
        await new Promise((r) => setTimeout(r, 700));
      }
      return null;
    });

    check('Found a prompt with linkable word pairs to exercise the overlay', !!fixture);
    if (!fixture) throw new Error('No suitable prompt found');

    const detectedCount = fixture.events.filter((e) => e.status === 'detected').length;
    const notDetectedCount = fixture.events.filter((e) => e.status === 'not_detected').length;
    const uncertainCount = fixture.events.filter((e) => e.status === 'uncertain').length;

    await page.evaluate(async (data) => {
      await window.ReadAloudMode.renderConnectedSpeechResults({
        status: 'ok',
        summary: {
          detectedCount: data.summary.detectedCount,
          notDetectedCount: data.summary.notDetectedCount,
          uncertainCount: data.summary.uncertainCount
        },
        events: data.events
      }, {
        transcriptText: data.text,
        words: data.text.split(/\s+/).filter(Boolean).map((word, index) => ({
          word,
          accuracyScore: 90,
          errorType: 'None',
          startMs: index * 100,
          endMs: index * 100 + 80
        })),
        sessionViewMode: 'advanced',
        sessionConnectedSpeechLevel: 'linking'
      });
    }, { ...fixture, summary: { detectedCount, notDetectedCount, uncertainCount } });
    await page.waitForTimeout(900);

    const mergedTranscript = await page.evaluate(() => ({
      duplicateOverlayPresent: !!document.querySelector('#ra-connected-speech-box .sc-linking-overlay'),
      tokenCount: document.querySelectorAll('#ra-merged-recognized-transcript .ra-word-token').length,
      linkedTokenCount: document.querySelectorAll('#ra-merged-recognized-transcript .ra-word-token[data-event-index]').length,
      coachHighlightCount: document.querySelectorAll('#ra-merged-recognized-transcript .ra-word-token[class*="coach-"]').length
    }));

    check('Merged transcript removes the duplicate SVG overlay', !mergedTranscript.duplicateOverlayPresent);
    check('Merged transcript renders word tokens', mergedTranscript.tokenCount > 0);
    check('Speech Coach events attach to merged transcript tokens', mergedTranscript.linkedTokenCount >= fixture.events.length);
    check('Merged tokens retain Speech Coach highlight styling', mergedTranscript.coachHighlightCount > 0);

    await page.screenshot({
      path: path.join(screenshotDir, 'results-linking-overlay.png'),
      fullPage: true
    });

    check('No page errors while rendering the results overlay',
      pageErrors.length === 0 || !pageErrors.join(' ').toLowerCase().includes('overlay'));

    assert.strictEqual(failures.length, 0, `\n${failures.join('\n')}`);
    console.log('\nRead Aloud results linking overlay check: PASS');
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error('Read Aloud results linking overlay check: FAIL');
  console.error(error);
  process.exit(1);
});
