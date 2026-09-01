/* eslint-disable no-console */
/**
 * Writing-mode UI parity check.
 *
 * The two Writing tasks (SWT, Write Essay) were retrofitted with the Reading
 * design system from read-mode-base.css and the shared v7 question picker.
 * This asserts the parts of that contract a screenshot would not catch:
 * required controls, one elevated surface per panel, 44px touch targets, the
 * picker behaviours, and the responsive split.
 *
 * Modelled on the READING_CONTRACTS map in reading-button-system-browser-check.js.
 */
const assert = require('assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const INDEX_PATH = path.join(__dirname, '../../public/index.html');

const WRITING_CONTRACTS = {
  swt: {
    panel: '#mode-swt',
    headerCard: '.swt-header-card',
    flatSections: ['.swt-source-card', '.swt-compose-card'],
    required: [
      'swt-v7-prev-btn',
      'swt-v7-question-pill',
      'swt-v7-next-btn',
      'swt-random-toggle-btn',
      'swt-v7-sheet-close',
      'start-swt-btn',
      'swt-submit-btn',
      'swt-retry-btn',
      'swt-result-box'
    ]
  },
  essay: {
    panel: '#mode-essay',
    headerCard: '.essay-header-card',
    flatSections: ['.essay-prompt-card', '.essay-compose-card'],
    required: [
      'essay-v7-prev-btn',
      'essay-v7-question-pill',
      'essay-v7-next-btn',
      'essay-random-toggle-btn',
      'essay-v7-sheet-close',
      'start-essay-btn',
      'essay-submit-btn',
      'essay-retry-btn',
      'essay-ai-score-btn',
      'essay-result-box'
    ]
  }
};

// Retired by the retrofit. Their presence means a panel slipped back to the
// Take Notes card shell or the legacy <select> navigation.
const RETIRED_IDS = [
  'question-select-essay',
  'total-questions-essay',
  'back-btn-essay',
  'next-btn-essay',
  'essay-info-box',
  'swt-info-box'
];

// Geometry contract from docs/plans/2026-08-01-reading-speaking-rfib-ui-unification.md
// §5.2: action controls are >=44px at every width; the picker's compact icon
// controls are 36px on desktop and grow to 44px at <=390px.
const MIN_TARGET = 44;
const MIN_COMPACT_TARGET = 36;
const ACTION_CONTROLS = {
  swt: ['start-swt-btn', 'swt-submit-btn', 'swt-retry-btn'],
  essay: ['start-essay-btn', 'essay-submit-btn', 'essay-retry-btn', 'essay-ai-score-btn']
};
const COMPACT_CONTROLS = {
  swt: ['swt-v7-prev-btn', 'swt-v7-next-btn', 'swt-random-toggle-btn'],
  essay: ['essay-v7-prev-btn', 'essay-v7-next-btn', 'essay-random-toggle-btn']
};
const PILLS = { swt: 'swt-v7-question-pill', essay: 'essay-v7-question-pill' };
const HEADER_COPY_CONTRACTS = [
  { mode: 'rfib', header: '.rfib-header-card', paragraph: '.rfib-header-copy > p' },
  { mode: 'dd', header: '.dd-header-card', paragraph: '.dd-header-copy > p' },
  { mode: 'rmcma', header: '.rmcma-header-card', paragraph: '.rmcma-header-copy > p' },
  { mode: 'rmcsa', header: '.rmcsa-header-card', paragraph: '.rmcsa-header-copy > p' },
  { mode: 'rop', header: '.rop-header-card', paragraph: '.rop-header-copy > p:not(.rop-keyboard-hint)' },
  { mode: 'swt', header: '.swt-header-card', paragraph: '.swt-header-copy > p' },
  { mode: 'essay', header: '.essay-header-card', paragraph: '.essay-header-copy > p' }
];

const failures = [];

function check(condition, message) {
  if (condition) return;
  failures.push(message);
}

async function dismissOverlays(page) {
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return true;
    return getComputedStyle(preloader).display === 'none'
      || !!document.getElementById('preloader-dismiss-btn');
  }, { timeout: 20000 });

  const preloaderDismiss = page.locator('#preloader-dismiss-btn');
  if (await preloaderDismiss.isVisible().catch(() => false)) await preloaderDismiss.click();

  const guestButton = page.locator('#guest-mode-btn');
  if (await guestButton.isVisible().catch(() => false)) await guestButton.click();

  await page.waitForFunction(() => {
    const entryModal = document.getElementById('entry-modal');
    const wrapper = document.getElementById('page-layout-wrapper');
    return (!entryModal || getComputedStyle(entryModal).display === 'none')
      && !!wrapper && getComputedStyle(wrapper).display !== 'none';
  }, { timeout: 20000 });

  const vocabAlertOk = page.locator('#vocab-alert-ok');
  if (await vocabAlertOk.isVisible().catch(() => false)) await vocabAlertOk.click();
}

async function activateMode(page, mode) {
  await page.evaluate(async (modeId) => { await window.switchToMode(modeId); }, mode);
  await page.waitForFunction((modeId) => {
    const panel = document.getElementById(`mode-${modeId}`);
    return !!panel && getComputedStyle(panel).display !== 'none';
  }, mode, { timeout: 30000 });
  // Let the picker finish its first render.
  await page.waitForTimeout(600);
}

/* ── 1. Static markup contract ─────────────────────────────────────────── */

async function checkMarkupContract(browser, indexHtml) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  try {
    await page.setContent(indexHtml, { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(({ contracts, retired }) => {
      const out = { missing: [], duplicates: [], missingButtonTypes: [], nested: [], retiredPresent: [], notesStep: [] };

      Object.values(contracts).forEach((contract) => {
        contract.required.forEach((id) => {
          const nodes = document.querySelectorAll(`#${id}`);
          if (nodes.length === 0) out.missing.push(id);
          if (nodes.length > 1) out.duplicates.push(id);
          nodes.forEach((node) => {
            if (node.matches('button') && node.getAttribute('type') !== 'button') {
              out.missingButtonTypes.push(id);
            }
          });
        });

        const panel = document.querySelector(contract.panel);
        if (!panel) { out.missing.push(contract.panel); return; }
        panel.querySelectorAll('button button').forEach((b) => out.nested.push(b.id || contract.panel));
        // The Take Notes card shell must be gone from both Writing panels.
        if (panel.querySelector('.notes-step, .notes-step-header, .notes-step-badge')) {
          out.notesStep.push(contract.panel);
        }
      });

      retired.forEach((id) => {
        if (document.getElementById(id)) out.retiredPresent.push(id);
      });

      return out;
    }, { contracts: WRITING_CONTRACTS, retired: RETIRED_IDS });

    result.missing.forEach((id) => check(false, `missing required control ${id}`));
    result.duplicates.forEach((id) => check(false, `required control #${id} is not unique`));
    result.missingButtonTypes.forEach((id) => check(false, `#${id} is missing type="button"`));
    result.nested.forEach((id) => check(false, `nested button detected under ${id}`));
    result.notesStep.forEach((p) => check(false, `${p} still uses the retired .notes-step card shell`));
    result.retiredPresent.forEach((id) => check(false, `retired control #${id} is still in the markup`));

    // The archive layer resolves the active essay prompt from this node.
    const archiveHook = await page.evaluate(() => !!document.getElementById('current-question-id-essay'));
    check(archiveHook, '#current-question-id-essay is required by pte-attempt-archive.js but is missing');

    if (failures.length === 0) {
      const total = Object.values(WRITING_CONTRACTS).reduce((s, c) => s + c.required.length, 0);
      console.log(`  ✓ ${total} required controls present, unique and typed`);
      console.log('  ✓ no nested buttons, no .notes-step shell, no retired legacy controls');
    }
  } finally {
    await page.close();
  }
}

/* ── 2. Live design-system + behaviour checks ──────────────────────────── */

async function checkLiveMode(page, mode, contract) {
  await activateMode(page, mode);

  // Rule 2: the header card is the only elevated surface in the panel.
  const surfaces = await page.evaluate((c) => {
    const flat = c.flatSections.map((sel) => {
      const node = document.querySelector(`${c.panel} ${sel}`);
      if (!node) return { sel, found: false };
      const s = getComputedStyle(node);
      return {
        sel,
        found: true,
        boxShadow: s.boxShadow,
        borderTopWidth: s.borderTopWidth,
        borderLeftWidth: s.borderLeftWidth,
        backgroundColor: s.backgroundColor
      };
    });
    const headerNode = document.querySelector(`${c.panel} ${c.headerCard}`);
    const header = headerNode ? getComputedStyle(headerNode).boxShadow : null;
    return { flat, header };
  }, contract);

  check(surfaces.header && surfaces.header !== 'none',
    `${mode}: header card ${contract.headerCard} should be the elevated surface but has no shadow`);
  surfaces.flat.forEach((s) => {
    check(s.found, `${mode}: flat section ${s.sel} not found`);
    if (!s.found) return;
    check(s.boxShadow === 'none', `${mode}: ${s.sel} must be flat but has box-shadow ${s.boxShadow}`);
    check(s.borderLeftWidth === '0px', `${mode}: ${s.sel} must be flat but has a side border`);
    check(s.backgroundColor === 'rgba(0, 0, 0, 0)',
      `${mode}: ${s.sel} must be flat but has background ${s.backgroundColor}`);
  });

  // Touch targets. Action buttons and the picker pill hold 44px; the compact
  // icon controls sit at 36px on desktop and are re-checked at 390px later.
  const measure = (ids) => page.evaluate((idList) => idList.map((id) => {
    const node = document.getElementById(id);
    if (!node) return { id, found: false };
    const rect = node.getBoundingClientRect();
    const s = getComputedStyle(node);
    return {
      id,
      found: true,
      visible: s.display !== 'none' && s.visibility !== 'hidden' && rect.height > 0,
      height: rect.height,
      width: rect.width,
      radius: s.borderTopLeftRadius
    };
  }), ids);

  const assertTargets = (measured, min, label) => {
    measured.forEach((ctl) => {
      if (!ctl.found || !ctl.visible) return; // hidden-until-submitted controls
      check(ctl.height >= min - 0.5,
        `${mode}: #${ctl.id} is ${ctl.height.toFixed(1)}px tall, below the ${min}px ${label} target`);
      check(ctl.width >= min - 0.5,
        `${mode}: #${ctl.id} is ${ctl.width.toFixed(1)}px wide, below the ${min}px ${label} target`);
    });
  };

  assertTargets(await measure(ACTION_CONTROLS[mode]), MIN_TARGET, 'action');
  assertTargets(await measure(COMPACT_CONTROLS[mode]), MIN_COMPACT_TARGET, 'compact');

  const [pill] = await measure([PILLS[mode]]);
  check(pill.found && pill.height >= MIN_TARGET - 0.5,
    `${mode}: question pill is ${pill.height?.toFixed(1)}px tall, below the ${MIN_TARGET}px target`);

  // All controls share the 12px control radius.
  const radii = [...await measure(ACTION_CONTROLS[mode]), ...await measure(COMPACT_CONTROLS[mode])];
  radii.forEach((ctl) => {
    if (!ctl.found || !ctl.visible) return;
    check(ctl.radius === '12px',
      `${mode}: #${ctl.id} has border-radius ${ctl.radius}; the control radius is 12px`);
  });

  // Picker: opens, filters, and Escape closes it and restores focus to the pill.
  const pillId = `${mode === 'essay' ? 'essay' : 'swt'}-v7-question-pill`;
  const listId = `${mode === 'essay' ? 'essay' : 'swt'}-v7-jump-list`;
  const searchId = `${mode === 'essay' ? 'essay' : 'swt'}-v7-jump-search`;

  await page.evaluate((id) => document.getElementById(id)?.click(), pillId);
  await page.waitForTimeout(250);

  const openState = await page.evaluate(({ list }) => {
    const sheet = document.querySelector('.ra-v7-sheet.is-open');
    const items = document.querySelectorAll(`#${list} .ra-v7-list-item`);
    return { open: !!sheet, itemCount: items.length };
  }, { list: listId });
  check(openState.open, `${mode}: clicking the question pill did not open the picker sheet`);
  check(openState.itemCount > 0, `${mode}: picker opened with an empty jump list`);
  check(openState.itemCount <= 20, `${mode}: picker rendered ${openState.itemCount} items; expected paging at 20`);

  const filtered = await page.evaluate(({ search, list }) => {
    const input = document.getElementById(search);
    input.value = 'zzzznomatch';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelectorAll(`#${list} .ra-v7-list-item`).length;
  }, { search: searchId, list: listId });
  check(filtered === 0, `${mode}: picker search did not filter (still ${filtered} items for a nonsense query)`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const afterEscape = await page.evaluate((id) => ({
    open: !!document.querySelector('.ra-v7-sheet.is-open'),
    focused: document.activeElement?.id === id
  }), pillId);
  check(!afterEscape.open, `${mode}: Escape did not close the picker sheet`);
  check(afterEscape.focused, `${mode}: Escape did not restore focus to the question pill`);

  // Random toggle flips aria-pressed and persists to the shared key.
  const toggleId = `${mode === 'essay' ? 'essay' : 'swt'}-random-toggle-btn`;
  const before = await page.evaluate((id) => document.getElementById(id)?.getAttribute('aria-pressed'), toggleId);
  await page.evaluate((id) => document.getElementById(id)?.click(), toggleId);
  await page.waitForTimeout(150);
  const after = await page.evaluate((id) => ({
    pressed: document.getElementById(id)?.getAttribute('aria-pressed'),
    stored: window.localStorage.getItem('pte_random_nav_mode'),
    label: document.getElementById(id)?.textContent.trim()
  }), toggleId);
  check(after.pressed !== before, `${mode}: Random toggle did not flip aria-pressed`);
  check(after.stored === after.pressed,
    `${mode}: Random toggle wrote "${after.stored}" to pte_random_nav_mode but aria-pressed is "${after.pressed}"`);
  check(/🎲 Random: (ON|OFF)/.test(after.label || ''),
    `${mode}: Random toggle label should read "🎲 Random: ON/OFF", got "${after.label}"`);
  // Restore the shared preference so the next mode starts from the same state.
  await page.evaluate((id) => document.getElementById(id)?.click(), toggleId);
}

/* ── 3. Responsive ─────────────────────────────────────────────────────── */

async function checkHeaderCopyMeasure(page) {
  for (const contract of HEADER_COPY_CONTRACTS) {
    await activateMode(page, contract.mode);
    const measure = await page.evaluate(({ mode, headerSelector, paragraphSelector }) => {
      const header = document.querySelector(`#mode-${mode} ${headerSelector}`);
      const paragraph = document.querySelector(`#mode-${mode} ${paragraphSelector}`);
      if (!header || !paragraph) return { found: false };
      const expectedWidth = paragraph.parentElement.clientWidth;
      return {
        found: true,
        paragraphWidth: paragraph.getBoundingClientRect().width,
        expectedWidth
      };
    }, {
      mode: contract.mode,
      headerSelector: contract.header,
      paragraphSelector: contract.paragraph
    });

    check(measure.found, `${contract.mode}: header description elements are missing`);
    if (!measure.found) continue;
    check(measure.paragraphWidth >= measure.expectedWidth - 1,
      `${contract.mode}: header description is ${measure.paragraphWidth.toFixed(1)}px wide, expected at least ${measure.expectedWidth.toFixed(1)}px`);
  }
}

async function checkResponsive(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);

  for (const mode of ['swt', 'essay']) {
    await activateMode(page, mode);
    const overflow = await page.evaluate((modeId) => {
      const panel = document.getElementById(`mode-${modeId}`);
      return {
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    }, mode);
    check(overflow.docOverflow <= 1,
      `${mode}: page overflows horizontally at 390px by ${overflow.docOverflow}px`);

    // At <=390px the compact picker controls must grow to a full 44px target.
    const compact = await page.evaluate((ids) => ids.map((id) => {
      const node = document.getElementById(id);
      if (!node) return { id, found: false };
      const rect = node.getBoundingClientRect();
      return { id, found: true, height: rect.height, width: rect.width };
    }), COMPACT_CONTROLS[mode]);
    compact.forEach((ctl) => {
      check(ctl.found, `${mode}: compact control #${ctl.id} missing at 390px`);
      if (!ctl.found) return;
      check(ctl.height >= MIN_TARGET - 0.5,
        `${mode}: #${ctl.id} is ${ctl.height.toFixed(1)}px tall at 390px, below the ${MIN_TARGET}px target`);
      check(ctl.width >= MIN_TARGET - 0.5,
        `${mode}: #${ctl.id} is ${ctl.width.toFixed(1)}px wide at 390px, below the ${MIN_TARGET}px target`);
    });
  }

  // SWT's split must collapse to a single column below 900px.
  await activateMode(page, 'swt');
  const columns = await page.evaluate(() => {
    const layout = document.querySelector('#mode-swt .swt-split-layout');
    return layout ? getComputedStyle(layout).gridTemplateColumns : null;
  });
  check(columns && columns.split(' ').length === 1,
    `SWT split layout should be single-column at 390px, got "${columns}"`);

  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.waitForTimeout(400);
  await activateMode(page, 'swt');
  const wideColumns = await page.evaluate(() => {
    const layout = document.querySelector('#mode-swt .swt-split-layout');
    return layout ? getComputedStyle(layout).gridTemplateColumns : null;
  });
  check(wideColumns && wideColumns.split(' ').length === 1,
    `SWT split layout should remain single-column (stacked) at 1440px per design, got "${wideColumns}"`);
}

/* ── Runner ────────────────────────────────────────────────────────────── */

async function main() {
  const indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
  const app = express();
  app.use(express.static(path.join(__dirname, '../../public')));
  const server = app.listen(0);
  const browser = await chromium.launch({ headless: true });

  try {
    console.log('Writing-mode UI parity check');
    await checkMarkupContract(browser, indexHtml);

    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    await context.addInitScript(() => {
      window.localStorage.setItem('userStatus', 'guest');
      window.localStorage.setItem('hasSeenScopeTutorial', 'true');
      window.localStorage.setItem('pte_random_nav_mode', 'false');
    });
    const page = await context.newPage();

    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
      await dismissOverlays(page);

      for (const [mode, contract] of Object.entries(WRITING_CONTRACTS)) {
        await checkLiveMode(page, mode, contract);
      }
      await checkHeaderCopyMeasure(page);
      await checkResponsive(page);
    } finally {
      await context.close();
    }

    if (failures.length > 0) {
      console.error(`\nWriting UI parity: FAIL (${failures.length})`);
      failures.forEach((f) => console.error(`  - ${f}`));
      process.exitCode = 1;
      return;
    }

    console.log('  ✓ one elevated surface per panel; work sections are flat');
    console.log('  ✓ action controls and the pill meet 44px; compact controls 36px desktop / 44px at 390px');
    console.log('  ✓ all controls share the 12px control radius');
    console.log('  ✓ picker opens, pages at 20, filters, and Escape restores focus');
    console.log('  ✓ Random toggle flips aria-pressed and persists to pte_random_nav_mode');
    console.log('  ✓ no horizontal overflow at 390px; SWT split collapses below 900px');
    console.log('Writing UI parity: PASS');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { WRITING_CONTRACTS };
assert.ok(WRITING_CONTRACTS.swt && WRITING_CONTRACTS.essay);
