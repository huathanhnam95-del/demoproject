/* eslint-disable no-console */
/**
 * Chrome verification for the four Read Aloud practice UI repairs:
 *
 *   1. Random / in-order question navigation toggle (and its persistence)
 *   2. Live Read → (removed) Prep → Record → Results stepper
 *   3. Combinable guide modes (linking + reduced words at the same time)
 *   4. Labelled, organised Practice Target settings groups
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

async function bootstrap(page, baseUrl) {
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
  await page.waitForTimeout(400);
}

function readSteps(page) {
  return page.evaluate(() => {
    const steps = document.querySelector('#mode-read-aloud .spc-steps');
    return [...(steps?.querySelectorAll('[data-spc-step]') || [])].map((item) => ({
      label: item.querySelector('.spc-step__label')?.textContent || '',
      state: item.dataset.state
    }));
  });
}

async function setStateAndSync(page, state) {
  await page.evaluate((next) => {
    window.ReadAloudMode.state = next;
    window.ReadAloudMode.updateUIForState();
  }, state);
  await page.waitForTimeout(120);
}

async function main() {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addInitScript(() => {
      window.localStorage.setItem('userStatus', 'guest');
      window.localStorage.setItem('hasSeenScopeTutorial', 'true');
      window.localStorage.setItem('read-aloudModeFirstUse', 'true');
    });
    const page = await context.newPage();
    await bootstrap(page, baseUrl);

    /* ── Fix 2: stepper ───────────────────────────────────────────────── */
    const steps = await readSteps(page);
    check('Read Aloud stepper has exactly 3 steps', steps.length === 3);
    check('Read Aloud stepper no longer shows a "Read" step',
      !steps.some((step) => step.label.trim() === 'Read'));
    check('Read Aloud stepper reads Prep / Record / Results',
      steps.map((s) => s.label.trim()).join(',') === 'Prep,Record,Results');

    await setStateAndSync(page, 'PREP');
    const atPrep = await readSteps(page);
    check('Stepper marks Prep current during PREP',
      atPrep[0].state === 'current' && atPrep[1].state === 'upcoming' && atPrep[2].state === 'upcoming');

    await setStateAndSync(page, 'RECORDING');
    const atRecord = await readSteps(page);
    check('Stepper advances to Record while recording',
      atRecord[0].state === 'complete' && atRecord[1].state === 'current' && atRecord[2].state === 'upcoming');

    await setStateAndSync(page, 'RESULTS');
    const atResults = await readSteps(page);
    check('Stepper advances to Results after checking',
      atResults[0].state === 'complete' && atResults[1].state === 'complete' && atResults[2].state === 'current');
    await page.screenshot({ path: path.join(screenshotDir, 'stepper-results.png') });

    await setStateAndSync(page, 'PREP');

    /* ── Fix 1: navigation order ──────────────────────────────────────── */
    const orderToggle = await page.evaluate(() => {
      const button = document.querySelector('#mode-read-aloud .spc-order-toggle');
      if (!button) return null;
      return {
        count: document.querySelectorAll('#mode-read-aloud .spc-order-toggle').length,
        order: button.dataset.order,
        label: button.textContent.trim(),
        pressed: button.getAttribute('aria-pressed')
      };
    });
    check('A single Random ON/OFF toggle renders in the picker bar',
      orderToggle?.count === 1);
    check('Order toggle defaults to Random: ON',
      orderToggle?.order === 'random'
        && orderToggle?.pressed === 'true'
        && /Random: ON$/.test(orderToggle?.label || ''));

    await page.click('#mode-read-aloud .spc-order-toggle');
    await page.waitForTimeout(300);
    check('Turning Random off switches to in-order navigation', await page.evaluate(() => {
      const button = document.querySelector('#mode-read-aloud .spc-order-toggle');
      return button?.dataset.order === 'sequential'
        && button.getAttribute('aria-pressed') === 'false'
        && /Random: OFF$/.test(button.textContent.trim())
        && window.ReadAloudMode?.promptOrderMode === 'sequential';
    }));

    const currentId = () => page.evaluate(() => window.ReadAloudMode?.currentQuestionId);
    const poolOrder = await page.evaluate(() => (
      window.ReadAloudMode.getOrderedPromptPool().map((row) => String(row.ID))
    ));

    const walked = [];
    for (let i = 0; i < 3; i += 1) {
      await page.click('#mode-read-aloud .spc-picker-next');
      await page.waitForTimeout(450);
      walked.push(await currentId());
    }
    const startIndex = poolOrder.indexOf(walked[0]);
    const expectedWalk = [0, 1, 2].map((offset) => poolOrder[(startIndex + offset) % poolOrder.length]);
    check(`In order mode walks the pool sequentially (${walked.join(' → ')})`,
      startIndex !== -1 && walked.join(',') === expectedWalk.join(','));

    await page.click('#mode-read-aloud .spc-picker-prev');
    await page.waitForTimeout(450);
    check('Previous steps back one place in order mode', await currentId() === walked[1]);

    // Persistence across a reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await bootstrap(page, baseUrl);
    check('Order mode persists across reload', await page.evaluate(() => (
      window.ReadAloudMode?.promptOrderMode === 'sequential'
        && document.querySelector('#mode-read-aloud .spc-order-toggle')?.dataset.order === 'sequential'
    )));

    await page.click('#mode-read-aloud .spc-order-toggle');
    await page.waitForTimeout(200);
    const randomIds = [];
    for (let i = 0; i < 6; i += 1) {
      await page.click('#mode-read-aloud .spc-picker-next');
      await page.waitForTimeout(400);
      randomIds.push(await currentId());
    }
    const consecutive = randomIds.every((id, i) => (
      i === 0 || Number(id) === Number(randomIds[i - 1]) + 1
    ));
    check(`Random mode does not walk in order (${randomIds.join(',')})`, !consecutive);

    /* ── Fix 3: combinable guides ─────────────────────────────────────── */
    await page.evaluate(() => window.SpeakingPracticeController.setPreferredView('advanced'));
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      window.ReadAloudMode.applyConnectedSpeechModes(['linking', 'reduced_words']);
    });
    await page.waitForTimeout(1500);

    const guideState = await page.evaluate(() => ({
      modes: [...(window.ReadAloudMode.connectedSpeechModes || [])].sort(),
      dominant: window.ReadAloudMode.connectedSpeechLevel,
      linkingPressed: document.getElementById('ra-toggle-linking-btn')?.getAttribute('aria-pressed'),
      reducedPressed: document.getElementById('ra-toggle-reduced-words-btn')?.getAttribute('aria-pressed'),
      soundPressed: document.getElementById('ra-toggle-sound-changes-btn')?.getAttribute('aria-pressed'),
      instruction: document.getElementById('ra-guide-instruction')?.textContent
        || document.getElementById('ra-prompt-instruction-text')?.textContent
    }));

    check('Linking and Reduced words can be active together',
      guideState.modes.join(',') === 'linking,reduced_words');
    check('Both guide buttons report aria-pressed=true',
      guideState.linkingPressed === 'true' && guideState.reducedPressed === 'true');
    check('An unselected guide stays unpressed', guideState.soundPressed === 'false');
    check('connectedSpeechLevel still reports a single dominant level',
      guideState.dominant === 'reduced_words');
    check(`Instruction line names both guides (${String(guideState.instruction).slice(0, 80)})`,
      /Active guides:/.test(String(guideState.instruction)));

    // Both visual layers must be present on the same prompt. Walk prompts until
    // one carries both feature types, so the check is not fixture-dependent.
    let layered = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      layered = await page.evaluate(() => ({
        weakTokens: document.querySelectorAll('#ra-prompt-stage .ra-connected-speech-token--weak').length,
        linkArcs: document.querySelectorAll('#ra-linking-overlay path, #ra-linking-overlay svg').length,
        overlayShown: getComputedStyle(document.getElementById('ra-linking-overlay')).display !== 'none'
      }));
      if (layered.weakTokens > 0 && layered.linkArcs > 0) break;
      await page.click('#mode-read-aloud .spc-picker-next');
      await page.waitForTimeout(900);
    }
    check(`Reduced-word marks render while linking is on (${layered.weakTokens} tokens)`, layered.weakTokens > 0);
    check(`Linking arcs render while reduced words is on (${layered.linkArcs} nodes)`,
      layered.overlayShown && layered.linkArcs > 0);
    await page.screenshot({ path: path.join(screenshotDir, 'guides-linking-plus-reduced.png') });

    // The whole selection must survive a prompt change, not collapse to the
    // dominant mode (sessionConnectedSpeechLevel is derived from the same set).
    await page.evaluate(() => window.ReadAloudMode.applyConnectedSpeechModes(['linking', 'reduced_words']));
    await page.waitForTimeout(300);
    await page.click('#mode-read-aloud .spc-picker-next');
    await page.waitForTimeout(900);
    check('Guide selection survives loading the next prompt', await page.evaluate(() => (
      [...window.ReadAloudMode.connectedSpeechModes].sort().join(',') === 'linking,reduced_words'
        && [...window.ReadAloudMode.sessionConnectedSpeechModes].sort().join(',') === 'linking,reduced_words'
        && window.ReadAloudMode.sessionConnectedSpeechLevel === 'reduced_words'
    )));

    // renderOverlay has always required linking to be requested explicitly. The
    // results panel calls it with no options, and must keep rendering nothing —
    // an unspecified caller must not be treated as "show everything".
    check('renderOverlay with no options still renders nothing', await page.evaluate(() => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const stage = document.createElement('div');
      document.body.appendChild(stage);
      const result = window.ReadAloudLinking.renderOverlay(svg, stage, { boundaries: [] }, new Map());
      const hidden = svg.style.display === 'none';
      stage.remove();
      return result.renderedCount === 0 && hidden;
    }));

    // Turning one guide off must leave the other alone.
    await page.evaluate(() => window.ReadAloudMode.toggleConnectedSpeechLevel('linking'));
    await page.waitForTimeout(800);
    const afterToggleOff = await page.evaluate(() => ({
      modes: [...(window.ReadAloudMode.connectedSpeechModes || [])],
      overlayHidden: getComputedStyle(document.getElementById('ra-linking-overlay')).display === 'none'
    }));
    check('Toggling linking off keeps reduced words on',
      afterToggleOff.modes.join(',') === 'reduced_words');
    check('Linking overlay hides when linking alone is switched off', afterToggleOff.overlayHidden);

    /* ── Fix 4: settings groups ───────────────────────────────────────── */
    await page.click('#mode-read-aloud .spc-settings-btn');
    await page.waitForFunction(
      () => document.getElementById('ra-settings-sheet')?.classList.contains('is-active'),
      { timeout: 15000 }
    );
    await page.waitForTimeout(350);

    const settings = await page.evaluate(() => {
      const panel = document.querySelector('#ra-settings-sheet .spc-sheet-tab-panel[data-tab="practice-target"]');
      const groups = [...(panel?.querySelectorAll('.read-aloud-filters') || [])];
      return {
        groupCount: groups.length,
        labels: groups.map((g) => g.querySelector('.read-aloud-filter-label')?.textContent?.trim() || null),
        labelStyles: groups.map((g) => {
          const label = g.querySelector('.read-aloud-filter-label');
          if (!label) return null;
          const cs = getComputedStyle(label);
          return { display: cs.display, weight: cs.fontWeight };
        }),
        pillRowCount: groups.filter((g) => g.querySelector('.read-aloud-filter-buttons')).length,
        statusInsideGroup: !!panel?.querySelector('.read-aloud-filters #ra-filter-feature-status')
      };
    });

    check('Practice Target shows three filter groups', settings.groupCount === 3);
    check(`Every filter group is labelled (${settings.labels.join(' | ')})`,
      settings.labels.length === 3 && settings.labels.every((label) => !!label));
    check('Labels render as block-level headings',
      settings.labelStyles.every((style) => style && style.display === 'block' && Number(style.weight) >= 700));
    check('Every group wraps its pills in a buttons row', settings.pillRowCount === 3);
    check('Feature status sits inside its own group, not loose in the panel',
      settings.statusInsideGroup);
    await page.screenshot({ path: path.join(screenshotDir, 'settings-practice-target.png') });

    assert.strictEqual(failures.length, 0, `\n${failures.join('\n')}`);
    console.log('\nRead Aloud practice UI repairs check: PASS');
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error('Read Aloud practice UI repairs check: FAIL');
  console.error(error);
  process.exit(1);
});
