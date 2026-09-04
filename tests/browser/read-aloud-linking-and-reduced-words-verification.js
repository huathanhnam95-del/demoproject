/* eslint-disable no-console */
/**
 * End-to-end browser verification for Read Aloud linking guides and reduced words styling:
 * 1. Verifies question prompt displays linking guide arcs and reduced words highlights in RESULTS state.
 * 2. Verifies recognized transcript displays curved SVG arcs between linked words matching detection status colors.
 * 3. Verifies recognized transcript does not use flat bottom underlines on linking words.
 * 4. Verifies reduced words display background highlights and indicators in both prompt and recognized transcript.
 */
const assert = require('assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

const screenshotDir = path.resolve(__dirname, '../../test-results/read-aloud-linking-repairs');
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

    // Find a prompt with both linking boundaries and reduced words
    const testData = await page.evaluate(async () => {
      const ra = window.ReadAloudMode;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const text = ra.currentPromptPlainText;
        if (text) {
          const analysis = await window.ReadAloudLinking.analyzePrompt(text, {
            accentProfile: 'en-US',
            connectedSpeechLevel: 'sound_changes',
            enabledRuleSet: 'connected-speech-v3'
          });
          const linkingBoundaries = (analysis.boundaries || []).filter((b) => (
            !b.blocked && (b.confidence === 'high' || b.confidence === 'medium')
              && String(b.layer || 'linking') !== 'assimilation'
          ));
          const weakTokens = (analysis.tokenAnnotations || []).filter((t) => t.layer === 'weak_forms');

          if (linkingBoundaries.length >= 1 && weakTokens.length >= 1) {
            return {
              text,
              linkingBoundaries: linkingBoundaries.slice(0, 3),
              weakTokens: weakTokens.slice(0, 3)
            };
          }
        }
        await ra.loadNextPrompt();
        await new Promise((r) => setTimeout(r, 700));
      }
      return null;
    });

    check('Found a prompt with linkable boundaries and reduced words', !!testData);
    if (!testData) throw new Error('No suitable prompt found');

    // Simulate switching to RESULTS state and rendering connected speech results with both linking and reduced words
    await page.evaluate(async (data) => {
      const ra = window.ReadAloudMode;
      ra.state = 'RESULTS';
      ra.hasAssessmentResult = true;
      ra.showAssessmentDisplay();

      // Enable both linking and reduced_words modes
      ra.applyConnectedSpeechModes(['linking', 'reduced_words'], { persist: true, announce: false });

      const events = [
        ...data.linkingBoundaries.map((b, i) => ({
          eventId: `link-${i}`,
          phrase: `${b.leftDisplay} ${b.rightDisplay}`,
          category: 'linking',
          family: 'linking',
          status: i === 0 ? 'detected' : (i === 1 ? 'not_detected' : 'uncertain'),
          feedbackText: `Link ${b.leftDisplay} into ${b.rightDisplay}.`
        })),
        ...data.weakTokens.map((t, i) => ({
          eventId: `weak-${i}`,
          phrase: t.word,
          category: 'reduced_words',
          family: 'reduced_words',
          status: i === 0 ? 'detected' : 'not_detected',
          feedbackText: `Reduced form for "${t.word}".`
        }))
      ];

      const words = data.text.split(/\s+/).filter(Boolean).map((word, index) => ({
        word,
        accuracyScore: 92,
        errorType: 'None',
        startMs: index * 200,
        endMs: index * 200 + 150
      }));

      ra.lastAssessmentPayload = {
        accuracyScore: 88,
        fluencyScore: 85,
        completenessScore: 90,
        pronScore: 88,
        recognizedText: data.text,
        words,
        connectedSpeech: {
          status: 'ok',
          events
        }
      };

      ra.renderPromptForCurrentView();

      await ra.renderConnectedSpeechResults(ra.lastAssessmentPayload.connectedSpeech, {
        transcriptText: data.text,
        words,
        sessionViewMode: 'advanced',
        sessionConnectedSpeechModes: ['linking', 'reduced_words'],
        metrics: {
          fluencyScore: 85,
          completenessScore: 90,
          pronScore: 88
        }
      });
    }, testData);

    await page.waitForTimeout(1000);

    // 1. Verify question prompt in RESULTS state has linking SVG overlay and reduced words highlights
    const promptVerification = await page.evaluate(() => {
      const overlay = document.getElementById('ra-linking-overlay');
      const paths = overlay ? overlay.querySelectorAll('path') : [];
      const weakSpans = document.querySelectorAll('#ra-prompt-stage .ra-connected-speech-token--weak');
      return {
        overlayDisplayed: overlay && getComputedStyle(overlay).display !== 'none',
        linkingPathsCount: paths.length,
        weakTokensCount: weakSpans.length
      };
    });

    check('Prompt SVG linking overlay is visible in RESULTS state', promptVerification.overlayDisplayed);
    check('Prompt SVG overlay contains curved linking paths in RESULTS state', promptVerification.linkingPathsCount > 0);
    check('Prompt displays reduced words highlights in RESULTS state', promptVerification.weakTokensCount > 0);

    // 2. Verify recognized transcript has SVG linking overlay with curved paths
    const recognizedVerification = await page.evaluate(() => {
      const transcript = document.getElementById('ra-merged-recognized-transcript');
      const overlay = transcript?.querySelector('.ra-recognized-linking-overlay');
      const paths = overlay ? Array.from(overlay.querySelectorAll('path')) : [];
      const pathData = paths.map((p) => ({
        d: p.getAttribute('d'),
        stroke: p.getAttribute('stroke'),
        status: p.dataset.linkingStatus
      }));

      const reducedTokens = transcript ? Array.from(transcript.querySelectorAll('.ra-word-token--reduced')) : [];
      const reducedData = reducedTokens.map((t) => ({
        text: t.textContent.trim(),
        classes: t.className,
        hasBgClass: /sc-token-bg--(success|error|uncertain)/.test(t.className),
        borderBottomColor: getComputedStyle(t).borderBottomColor
      }));

      const linkingTokens = transcript ? Array.from(transcript.querySelectorAll('.ra-word-token[class*="coach-"]')) : [];
      const linkingTokensWithoutUnderline = linkingTokens.filter((t) => {
        // If it is NOT also a reduced token, it should not have colored underline
        if (t.classList.contains('ra-word-token--reduced')) return true;
        const color = getComputedStyle(t).borderBottomColor;
        return color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
      });

      return {
        hasOverlay: !!overlay,
        overlayDisplayed: overlay && getComputedStyle(overlay).display !== 'none',
        pathsCount: paths.length,
        pathData,
        reducedCount: reducedTokens.length,
        reducedData,
        linkingTokensCount: linkingTokens.length,
        linkingWithoutUnderlineCount: linkingTokensWithoutUnderline.length
      };
    });

    check('Recognized transcript contains .ra-recognized-linking-overlay', recognizedVerification.hasOverlay);
    check('Recognized linking overlay is displayed', recognizedVerification.overlayDisplayed);
    check('Recognized linking overlay has curved connector paths', recognizedVerification.pathsCount > 0);
    check('Recognized curved paths contain quadratic bezier curve commands',
      recognizedVerification.pathData.every((p) => p.d && p.d.includes('M') && p.d.includes('Q')));
    check('Recognized curved paths have status-colored strokes',
      recognizedVerification.pathData.some((p) => p.stroke === '#10b981')
      || recognizedVerification.pathData.some((p) => p.stroke === '#ef4444')
      || recognizedVerification.pathData.some((p) => p.stroke === '#f59e0b'));

    check('Recognized transcript highlights reduced words with .ra-word-token--reduced', recognizedVerification.reducedCount > 0);
    check('Reduced word tokens receive .sc-token-bg--* class',
      recognizedVerification.reducedData.every((r) => r.hasBgClass));
    check('Linking word tokens do not show flat bottom underlines',
      recognizedVerification.linkingTokensCount > 0 && recognizedVerification.linkingWithoutUnderlineCount === recognizedVerification.linkingTokensCount);

    // Take screenshot of results
    await page.screenshot({
      path: path.join(screenshotDir, 'read-aloud-linking-and-reduced-results.png'),
      fullPage: true
    });

    const fatalErrors = pageErrors.filter((e) => !e.toLowerCase().includes('export'));
    if (fatalErrors.length > 0) {
      console.error('Fatal page errors encountered:', fatalErrors);
    }
    check('No fatal page errors occurred during test', fatalErrors.length === 0);

    assert.strictEqual(failures.length, 0, `\nFailures:\n${failures.join('\n')}`);
    console.log('\nAll Read Aloud linking and reduced words verification checks PASSED!');
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('Read Aloud linking and reduced words verification check: FAIL');
  console.error(err);
  process.exit(1);
});
