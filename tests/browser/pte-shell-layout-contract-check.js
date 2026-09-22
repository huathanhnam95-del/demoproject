'use strict';

const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/pte-shell-harness');

const SPEAKING_MODES = ['read-aloud', 'speak', 'describe-image', 'notes', 'asq', 'sgd', 'rts'];
const VIEWPORTS = [
  { width: 1440, height: 900, name: '1440px Desktop' },
  { width: 1280, height: 800, name: '1280px Small Desktop' },
  { width: 1024, height: 768, name: '1024px Tablet Landscape' },
  { width: 768, height: 1024, name: '768px Tablet Portrait' },
  { width: 390, height: 844, name: '390px Mobile' }
];

async function run() {
  console.log('--- Starting PTE Speaking Shell Layout Contract Verification Check ---');
  const harness = await createHarness();

  try {
    // 1. Verify Entry Transition Latency (A.4)
    console.log('\n[1/4] Verifying mode-entry transition latency (A.4)...');
    const entryPage = await harness.open({ width: 1440, height: 900, flag: 'v3' });

    // Measure click to card/skeleton appearance
    const timing = await entryPage.evaluate(async () => {
      const startTime = performance.now();
      window.switchToMode('read-aloud');

      let cardVisibleTime = null;
      let dashHiddenTime = null;

      const check = () => {
        const card = document.querySelector('.pte-card');
        const dash = document.querySelector('.dashboard-modern-container');
        const now = performance.now();

        if (!cardVisibleTime && card && card.offsetParent !== null) {
          cardVisibleTime = now - startTime;
        }
        if (!dashHiddenTime && dash && (dash.offsetParent === null || getComputedStyle(dash).display === 'none')) {
          dashHiddenTime = now - startTime;
        }
      };

      for (let i = 0; i < 50; i++) {
        check();
        if (cardVisibleTime && dashHiddenTime) break;
        await new Promise(r => setTimeout(r, 10));
      }

      return {
        cardVisibleMs: cardVisibleTime || 9999,
        dashHiddenMs: dashHiddenTime || 9999
      };
    });

    console.log(`  Card visible at: ${timing.cardVisibleMs.toFixed(1)}ms`);
    console.log(`  Dashboard hidden at: ${timing.dashHiddenMs.toFixed(1)}ms`);
    assert.ok(timing.cardVisibleMs <= 200, `Card must appear within 150-200ms (got ${timing.cardVisibleMs}ms)`);
    assert.ok(timing.dashHiddenMs <= 200, `Dashboard must hide within 150-200ms (got ${timing.dashHiddenMs}ms)`);
    console.log('  ✓ Mode-entry transition latency within contract');
    await entryPage.close();

    // 2. Verify P1, P8, P7 across all 7 modes at 1440px
    console.log('\n[2/4] Testing body padding (P1/P8) & dock button gradients (P7) across all 7 speaking modes...');
    const pageDesktop = await harness.open({ width: 1440, height: 900, flag: 'v3' });

    for (const mode of SPEAKING_MODES) {
      console.log(`  Testing mode: ${mode}...`);
      await pageDesktop.evaluate(async (m) => {
        window.__PTE_TEST_TIME_SCALE = 0.05;
        await window.switchToMode(m);
      }, mode);

      await pageDesktop.waitForFunction((m) => {
        const panel = document.getElementById('mode-' + m);
        const cardBody = panel?.querySelector('.pte-card__body');
        return panel && getComputedStyle(panel).display !== 'none' && cardBody;
      }, mode, { timeout: 20000 });

      // P1/P8: Identical body padding: 22px 34px 26px
      const padding = await pageDesktop.evaluate(() => {
        const body = document.querySelector('.pte-card__body');
        return body ? getComputedStyle(body).padding : '';
      });
      assert.equal(padding, '22px 34px 26px', `Mode ${mode} .pte-card__body padding must be 22px 34px 26px (got ${padding})`);

      // P7: No legacy gradients in dock
      const gradients = await pageDesktop.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('.pte-dock button'));
        return buttons
          .filter(b => {
            const bg = getComputedStyle(b).backgroundImage;
            return bg && bg !== 'none';
          })
          .map(b => b.textContent.trim());
      });
      assert.deepEqual(gradients, [], `Mode ${mode} dock buttons must not have background gradient (got: ${gradients.join(', ')})`);

      // Progress bar inset matches card body (34px)
      const progressPad = await pageDesktop.evaluate(() => {
        const prog = document.querySelector('.pte-progress');
        return prog ? getComputedStyle(prog).padding : '';
      });
      assert.equal(progressPad, '14px 34px 0px', `Mode ${mode} .pte-progress padding must match 14px 34px 0px (got ${progressPad})`);

      console.log(`    ✓ ${mode}: padding verified, no gradients, progress aligned`);
    }
    await pageDesktop.close();

    // 3. Responsive checks at all viewports (P2 gutters, P9/P10 overflow, horizontal scroll)
    console.log('\n[3/4] Responsive checks across viewports (1440, 1280, 1024, 768, 390)...');
    for (const vp of VIEWPORTS) {
      console.log(`\n  Checking viewport: ${vp.name}...`);
      const vpPage = await harness.open({ width: vp.width, height: vp.height, flag: 'v3' });

      for (const mode of ['read-aloud', 'describe-image', 'sgd', 'notes']) {
        await vpPage.evaluate(async (m) => {
          window.__PTE_TEST_TIME_SCALE = 0.05;
          await window.switchToMode(m);
        }, mode);

        await vpPage.waitForFunction((m) => {
          const panel = document.getElementById('mode-' + m);
          return panel && getComputedStyle(panel).display !== 'none' && panel.querySelector('.pte-card__body');
        }, mode, { timeout: 20000 });

        // Check horizontal scroll
        const scrollWidth = await vpPage.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(
          scrollWidth <= vp.width + 1,
          `Page must not have horizontal scroll at ${vp.width}px in ${mode} (scrollWidth=${scrollWidth}, clientWidth=${vp.width})`
        );

        // P2: Check content gutters (no text touches the card edge)
        const minGutter = await vpPage.evaluate(() => {
          const card = document.querySelector('.pte-card');
          if (!card) return 999;
          const cardRect = card.getBoundingClientRect();
          const children = Array.from(document.querySelectorAll('.pte-card__body *'));
          const margins = children
            .filter(el => el.children.length === 0 && (el.textContent || '').trim().length > 0)
            .map(el => {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return 999;
              return Math.min(r.left - cardRect.left, cardRect.right - r.right);
            })
            .filter(n => Number.isFinite(n) && n > -100);
          return margins.length ? Math.min(...margins) : 999;
        });
        assert.ok(minGutter >= 10, `At ${vp.width}px in ${mode}, min gutter must be >= 10px (got ${minGutter}px)`);

        // P9: Volume slider must not spill
        const volSpill = await vpPage.evaluate(() => {
          const volInput = document.querySelector('.pte-audio__vol input');
          const volContainer = document.querySelector('.pte-audio__vol');
          if (!volInput || !volContainer) return 0;
          const iRect = volInput.getBoundingClientRect();
          const cRect = volContainer.getBoundingClientRect();
          return Math.max(0, iRect.right - cRect.right, cRect.left - iRect.left);
        });
        assert.equal(volSpill, 0, `Volume slider must not spill container at ${vp.width}px in ${mode}`);

        // P11: Question pill truncation check at <= 1024px
        if (vp.width <= 1024) {
          const pillOk = await vpPage.evaluate(() => {
            const pill = document.querySelector('.spc-picker-pill');
            if (!pill) return true;
            return pill.scrollWidth <= pill.clientWidth + 2;
          });
          assert.ok(pillOk, `Picker pill must not hard-clip without ellipsis at ${vp.width}px in ${mode}`);
        }
      }
      await vpPage.close();
      console.log(`    ✓ Viewport ${vp.width}px passed all responsive assertions`);
    }

    // 4. Verify Error State contract (§3.3) and Coach Gate (D2) in Read Aloud
    console.log('\n[4/4] Verifying Coach toggle (D2) and Error State contract (§3.3)...');
    const testPage = await harness.open({ width: 1440, height: 900, flag: 'v3' });

    await testPage.evaluate(async () => {
      window.__PTE_TEST_TIME_SCALE = 0.05;
      await window.switchToMode('read-aloud');
    });

    await testPage.waitForFunction(() => {
      const mode = window.ReadAloudMode;
      return mode && mode.currentPromptReady;
    }, null, { timeout: 20000 });

    // D2: When Coach is closed, linking overlay must be hidden
    const overlayHiddenWhenClosed = await testPage.evaluate(() => {
      const mode = window.ReadAloudMode;
      mode.setCoachOpen(false);
      const overlay = document.getElementById('ra-linking-overlay');
      return !overlay || getComputedStyle(overlay).display === 'none';
    });
    assert.ok(overlayHiddenWhenClosed, 'When Coach is closed, #ra-linking-overlay must be hidden');
    console.log('  ✓ Coach closed: #ra-linking-overlay is hidden');

    // D2: When Coach is opened, linking overlay becomes visible if guides exist
    const coachOpenWorked = await testPage.evaluate(() => {
      const mode = window.ReadAloudMode;
      mode.setCoachOpen(true);
      return mode.pteCoachOpen === true;
    });
    assert.ok(coachOpenWorked, 'setCoachOpen(true) must set pteCoachOpen to true');
    console.log('  ✓ Coach opened: pteCoachOpen is true');

    // §3.3: Error state render test
    const errorStateRendered = await testPage.evaluate(() => {
      const mode = window.ReadAloudMode;
      mode.renderAssessmentFailure('Network timeout', 'Could not score this attempt.');
      const errBlock = document.querySelector('.pte-fb__error-state');
      if (!errBlock) return false;
      const title = errBlock.querySelector('.pte-fb__error-title')?.textContent;
      const retry = errBlock.querySelector('.pte-fb__error-retry')?.textContent;
      const keep = errBlock.querySelector('.pte-fb__error-keep')?.textContent;
      return title === "We couldn't score this attempt" && retry === 'Try again' && keep === 'Keep the recording';
    });
    assert.ok(errorStateRendered, '.pte-fb__error-state must render title and actions matching contract');
    console.log('  ✓ Error state renders with "We couldn\'t score this attempt", Try again, and Keep the recording');

    // Test "Keep the recording" action restores stage and populates Not scored fallback
    const keepWorked = await testPage.evaluate(() => {
      const keepBtn = document.querySelector('.pte-fb__error-keep');
      keepBtn?.click();
      const errBlock = document.querySelector('.pte-fb__error-state');
      const stage = document.querySelector('.ra-stage');
      const emptyStat = document.querySelector('.pte-stats__empty');
      return (!errBlock || errBlock.style.display === 'none') && stage && stage.style.display !== 'none' && emptyStat?.textContent.trim() === 'Not scored';
    });
    assert.ok(keepWorked, 'Clicking "Keep the recording" must hide error state, restore stage, and populate "Not scored"');
    console.log('  ✓ "Keep the recording" restores stage visibility and populates "Not scored" fallback');

    // Test tab pill height is compact (P5: <= 36px)
    const tabHeight = await testPage.evaluate(() => {
      const tab = document.querySelector('.pte-tabs button, .pte-tabs .pte-btn');
      return tab ? parseFloat(getComputedStyle(tab).height) : 0;
    });
    assert.ok(tabHeight > 0 && tabHeight <= 36, `Pill tab height must be <= 36px (got ${tabHeight}px)`);
    console.log(`  ✓ Pill tab height is compact (${tabHeight}px <= 36px)`);

    // Test unmount cleanup when error state is present
    const unmountCleanupWorked = await testPage.evaluate(() => {
      const mode = window.ReadAloudMode;
      mode.renderAssessmentFailure('Network timeout', 'Could not score this attempt.');
      mode.unmountPteShell();
      const errBlock = document.querySelector('.pte-fb__error-state');
      const stage = document.querySelector('.ra-stage');
      mode.mountPteShell();
      return !errBlock && stage && stage.style.display !== 'none';
    });
    assert.ok(unmountCleanupWorked, 'unmountPteShell must remove any active error state block and restore stage');
    console.log('  ✓ unmountPteShell cleanly removes error state');

    await testPage.close();

    console.log('\n======================================================');
    console.log('🎉 ALL PTE SPEAKING SHELL LAYOUT CONTRACT CHECKS PASSED!');
    console.log('======================================================\n');
  } finally {
    await harness.close();
  }
}

run().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ PTE Speaking Shell Layout Contract check failed:', err);
  process.exit(1);
});
