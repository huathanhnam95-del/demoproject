/**
 * Read Aloud — Basic (simple) coach tier.
 *
 * Basic is the default view. It used to suppress the guide marks and the whole
 * Speech Coach, so a first-time learner never saw the feature. This asserts the
 * simple tier renders marks and a plain-language rail without the chips or IPA,
 * that every card offers audio, and that the promote button switches views.
 *
 * Runs against a static server over public/ in guest mode — no emulator needed.
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

async function enterReadAloud(page, baseUrl) {
  await page.addInitScript(() => {
    window.localStorage.setItem('userStatus', 'guest');
    window.localStorage.setItem('hasSeenScopeTutorial', 'true');
    // Deliberately do NOT set a view preference: Basic must be what a new
    // learner lands on.
    window.localStorage.removeItem('bel:speaking-controller:view:v1');
  });
  await page.goto(`${baseUrl}/index.html?raWorkspace=legacy`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
  const guest = page.locator('#guest-mode-btn');
  if (await guest.isVisible().catch(() => false)) await guest.click();
  await page.waitForTimeout(800);
  await page.evaluate(() => window.switchToMode('read-aloud'));
  await page.waitForFunction(() => {
    const panel = document.getElementById('mode-read-aloud');
    return !!panel && getComputedStyle(panel).display !== 'none'
      && !!panel.querySelector('.spc-controller');
  }, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelectorAll('#entry-modal, .entry-modal, .auth-overlay, .guest-toast')
      .forEach((el) => { el.style.display = 'none'; });
  });
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
    await enterReadAloud(page, baseUrl);

    const preview = await page.evaluate(() => {
      const rail = document.querySelector('.ra-rail');
      const chips = document.getElementById('ra-prompt-guides-group');
      const stage = document.getElementById('ra-prompt-stage');
      const cards = [...document.querySelectorAll('#ra-connected-speech-list .sc-guide-item')];
      return {
        view: document.querySelector('#mode-read-aloud .spc-controller')?.dataset.spcView,
        tier: rail?.dataset.coachTier,
        railVisible: !!rail && getComputedStyle(rail).display !== 'none',
        chipsHidden: !chips || getComputedStyle(chips).display === 'none'
          || chips.offsetParent === null,
        markCount: stage ? stage.querySelectorAll('.ra-connected-speech-token--weak, .ra-link-word[data-word-index]').length : 0,
        arcCount: stage ? stage.querySelectorAll('#ra-linking-overlay path').length : 0,
        cardCount: cards.length,
        visibleIpa: cards.filter((c) => {
          const ipa = c.querySelector('.sc-card-ipa');
          return ipa && getComputedStyle(ipa).display !== 'none';
        }).length,
        sayItLikeCount: cards.filter((c) => c.querySelector('.sc-card-say')).length,
        audioCount: cards.filter((c) => c.querySelector('.sc-audio-btn')).length,
        // No IPA symbols anywhere in the simple tier's card text, including inside
        // the explanation copy.
        cardsWithIpaText: cards.filter((c) => /\/[^\/]{1,8}\//.test(c.innerText || '')).length,
        legendShown: [...document.querySelectorAll('#ra-guide-legend .ra-legend-item')]
          .filter((el) => !el.hidden).map((el) => el.getAttribute('data-legend')),
        instruction: document.getElementById('ra-guide-instruction')?.textContent?.trim().slice(0, 80)
      };
    });

    record('lands in Basic view', preview.view === 'basic', `view=${preview.view}`);
    record('rail renders in the simple tier',
      preview.railVisible && preview.tier === 'simple', `tier=${preview.tier} visible=${preview.railVisible}`);
    record('guide chips stay out of Basic', preview.chipsHidden === true);
    record('passage carries guide marks in Basic',
      preview.markCount > 0 || preview.arcCount > 0,
      `marks=${preview.markCount} arcs=${preview.arcCount}`);
    record('coach renders cards in Basic', preview.cardCount > 0, `cards=${preview.cardCount}`);
    record('no IPA shown in the simple tier',
      preview.visibleIpa === 0, `visibleIpa=${preview.visibleIpa}`);
    record('every card leads with a plain-language hint',
      preview.cardCount > 0 && preview.sayItLikeCount === preview.cardCount,
      `say=${preview.sayItLikeCount}/${preview.cardCount}`);
    record('every card offers audio',
      preview.cardCount > 0 && preview.audioCount === preview.cardCount,
      `audio=${preview.audioCount}/${preview.cardCount}`);
    record('no IPA symbols in the simple tier card text',
      preview.cardsWithIpaText === 0, `cardsWithIpa=${preview.cardsWithIpaText}`);
    record('legend explains the marks that are on',
      preview.legendShown.length > 0, `shown=${preview.legendShown.join(',')}`);
    record('instruction leads with the action',
      /^Read /i.test(preview.instruction || ''), `"${preview.instruction}"`);

    await page.screenshot({ path: path.join(OUT_DIR, 'read-aloud-basic-1440.png') });

    // Promote to Advanced and confirm the tier deepens rather than toggling a panel.
    const promoted = await page.evaluate(async () => {
      window.ReadAloudMode.toggleAdvancedAnalysisView();
      // The view switch re-runs the async analysis + rAF render before the rail
      // restamps its tier, so wait for the attribute rather than a fixed delay.
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        if (document.querySelector('.ra-rail')?.dataset.coachTier === 'full') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 300));
      const rail = document.querySelector('.ra-rail');
      const chips = document.getElementById('ra-prompt-guides-group');
      const cards = [...document.querySelectorAll('#ra-connected-speech-list .sc-guide-item')];
      return {
        view: document.querySelector('#mode-read-aloud .spc-controller')?.dataset.spcView,
        tier: rail?.dataset.coachTier,
        chipsVisible: !!chips && chips.offsetParent !== null,
        visibleIpa: cards.filter((c) => {
          const ipa = c.querySelector('.sc-card-ipa');
          return ipa && getComputedStyle(ipa).display !== 'none';
        }).length
      };
    });

    record('promote button switches to Advanced',
      promoted.view === 'advanced' && promoted.tier === 'full',
      `view=${promoted.view} tier=${promoted.tier}`);
    record('Advanced reveals the chips', promoted.chipsVisible === true);
    record('Advanced restores IPA', promoted.visibleIpa > 0, `visibleIpa=${promoted.visibleIpa}`);

    await page.screenshot({ path: path.join(OUT_DIR, 'read-aloud-advanced-1440.png') });
    await page.close();

    // Mobile: the simple tier must survive the stacked layout.
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await enterReadAloud(mobile, baseUrl);
    const m = await mobile.evaluate(() => {
      const rail = document.querySelector('.ra-rail');
      return {
        tier: rail?.dataset.coachTier,
        railVisible: !!rail && getComputedStyle(rail).display !== 'none',
        cards: document.querySelectorAll('#ra-connected-speech-list .sc-guide-item').length,
        startHereRepeats: (document.querySelector('.ra-rail')?.textContent.match(/start here/gi) || []).length
      };
    });
    record('simple tier renders on mobile @390',
      m.tier === 'simple' && m.railVisible && m.cards > 0, JSON.stringify(m));
    record('"Start here" is not duplicated @390',
      m.startHereRepeats <= 1, `repeats=${m.startHereRepeats}`);
    await mobile.screenshot({ path: path.join(OUT_DIR, 'read-aloud-basic-390.png') });
    await mobile.close();
  } catch (error) {
    console.error('FAIL  harness error —', error?.message || error);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\nAll Basic-tier checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
