/**
 * Read Aloud Speech Coach — results state.
 *
 * The results view cannot be reached in a static harness (it needs a recording
 * and an Azure assessment), so this drives renderConnectedSpeechResults directly
 * with a synthetic connectedSpeech payload shaped like the service's output.
 * It checks that the scored findings render into the rail beside the passage and
 * that the styling now comes from classes rather than inline hexes.
 */
const { chromium } = require('playwright');
const express = require('express');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'artifacts', 'read-aloud-workbench');

function ok(label, pass, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const app = express();
  app.use(express.static(path.join(__dirname, '../../public')));
  app.use((req, res) => res.sendFile(path.join(__dirname, '../../public/index.html')));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ headless: true });
  let failures = 0;
  const record = (label, pass, detail) => { if (!ok(label, pass, detail)) failures += 1; };

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
    await page.addInitScript(() => {
      window.localStorage.setItem('userStatus', 'guest');
      window.localStorage.setItem('hasSeenScopeTutorial', 'true');
    });
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    const guest = page.locator('#guest-mode-btn');
    if (await guest.isVisible().catch(() => false)) await guest.click();
    await page.waitForTimeout(700);
    await page.evaluate(() => window.switchToMode('read-aloud'));
    await page.waitForTimeout(1400);
    await page.evaluate(() => window.SpeakingPracticeController?.setPreferredView('advanced'));
    await page.waitForTimeout(400);

    const rendered = await page.evaluate(async () => {
      const mode = window.ReadAloudMode;
      if (!mode) return { error: 'no ReadAloudMode' };
      const text = String(mode.currentPromptPlainText || '').trim();
      const words = text.split(/\s+/);
      const at = (w) => Math.max(0, words.findIndex((x) => x.toLowerCase().replace(/[^a-z']/g, '') === w));

      const mk = (id, family, phrase, left, right, status, targetIpa) => ({
        eventId: id,
        family,
        phrase,
        leftWord: left,
        rightWord: right,
        startWordIndex: at(left),
        endWordIndex: at(right),
        contextWordIndex: at(left),
        status,
        confidence: 0.7,
        startMs: 1200,
        endMs: 1800,
        targetIpa,
        acceptedFormRoles: ['strong', 'weak'],
        feedbackText: 'Synthetic feedback for layout verification.',
        detectorConfig: { leftDisplay: left, rightDisplay: right, weakFormWord: left },
        evidence: { targetWord: left, targetFormRole: 'weak', targetIpa, reason: 'synthetic' }
      });

      const events = [
        mk('e1', 'weak_form_reduction', words[0] || 'the', (words[0] || 'the'), (words[1] || 'x'), 'not_detected', '/ðə/'),
        mk('e2', 'catenation', `${words[1]} ${words[2]}`, words[1] || 'a', words[2] || 'b', 'detected', '/‿/'),
        mk('e3', 'consonant_to_vowel', `${words[3]} ${words[4]}`, words[3] || 'c', words[4] || 'd', 'not_detected', '/‿/')
      ];

      await mode.renderConnectedSpeechResults(
        { status: 'complete', version: 'cs-v1', events, summary: { detectedCount: 1, notDetectedCount: 2, uncertainCount: 0 } },
        { transcriptText: text, words: [], metrics: {}, sessionViewMode: 'advanced' }
      );
      mode.showAssessmentDisplay();
      const acc = document.getElementById('ra-accuracy-value');
      if (acc) acc.textContent = '92';

      await new Promise((r) => setTimeout(r, 500));

      const list = document.getElementById('ra-connected-speech-list');
      const rail = document.querySelector('.ra-rail');
      const stage = document.querySelector('.ra-stage');
      const inlineStyled = list ? list.querySelectorAll('[style*="#"]').length : -1;
      return {
        meta: document.getElementById('ra-connected-speech-meta')?.textContent?.trim(),
        cards: list ? list.querySelectorAll('.sc-accordion-card, .sc-single-card').length : 0,
        railBesideStage: !!(rail && stage)
          && rail.getBoundingClientRect().left >= stage.getBoundingClientRect().right - 2,
        accuracyVisible: !document.getElementById('ra-accuracy-readout')?.hasAttribute('hidden'),
        accuracyInGuidebar: !!document.querySelector('.ra-guidebar #ra-accuracy-readout'),
        listIsColumn: list ? getComputedStyle(list).flexDirection : null,
        inlineHexCount: inlineStyled,
        listColumnCount: list ? getComputedStyle(list).gridTemplateColumns : null
      };
    });

    if (rendered.error) {
      record('results render', false, rendered.error);
    } else {
      record('coach switches to Feedback', rendered.meta === 'Feedback', `meta=${rendered.meta}`);
      record('scored findings render as cards', rendered.cards > 0, `cards=${rendered.cards}`);
      record('findings sit in the rail beside the passage', rendered.railBesideStage === true);
      record('accuracy shows as a guidebar stat', rendered.accuracyVisible && rendered.accuracyInGuidebar,
        JSON.stringify({ v: rendered.accuracyVisible, g: rendered.accuracyInGuidebar }));
      record('findings are one ordered column, not a 2-col grid',
        rendered.listIsColumn === 'column', `flexDirection=${rendered.listIsColumn}`);
      record('no hardcoded hex colours left in the rendered findings',
        rendered.inlineHexCount === 0, `inlineHexNodes=${rendered.inlineHexCount}`);
    }

    await page.evaluate(() => {
      document.querySelectorAll('#entry-modal, .entry-modal, .auth-overlay, .guest-toast').forEach((el) => {
        el.style.display = 'none';
      });
      document.querySelectorAll('[data-sc-accordion-toggle]').forEach((t, i) => { if (i < 2) t.click(); });
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'read-aloud-results-1440.png') });
    await page.close();
  } catch (error) {
    console.error('FAIL  harness error —', error?.message || error);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\nAll results-state checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
