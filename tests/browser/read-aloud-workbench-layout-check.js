/**
 * Read Aloud workbench layout check.
 *
 * The redesign exists because the page carried three competing column widths —
 * the controller filled the container, the step rail capped itself at 1100px,
 * and the mode zones hard-coded 900px. This asserts they now measure from one
 * shared grid, that the coach rail sits beside the passage instead of 400px
 * below it, and that nothing overflows horizontally at any breakpoint.
 *
 * Runs against a static server over public/ in guest mode — no emulator needed.
 */
const { chromium } = require('playwright');
const express = require('express');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'artifacts', 'read-aloud-workbench');

const BREAKPOINTS = [
  { name: '1440', width: 1440, height: 940, expectRail: true },
  { name: '1280', width: 1280, height: 900, expectRail: true },
  { name: '1080', width: 1080, height: 900, expectRail: true },
  { name: '940', width: 940, height: 900, expectRail: false },
  { name: '390', width: 390, height: 844, expectRail: false }
];

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
    for (const bp of BREAKPOINTS) {
      const page = await browser.newPage({ viewport: { width: bp.width, height: bp.height } });
      await page.addInitScript(() => {
        window.localStorage.setItem('userStatus', 'guest');
        window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        window.localStorage.setItem('read-aloudModeFirstUse', 'true');
      });
      await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
      const guestButton = page.locator('#guest-mode-btn');
      if (await guestButton.isVisible().catch(() => false)) await guestButton.click();
      await page.waitForTimeout(800);
      await page.evaluate(() => window.switchToMode('read-aloud'));
      await page.waitForFunction(() => {
        const panel = document.getElementById('mode-read-aloud');
        return !!panel
          && getComputedStyle(panel).display !== 'none'
          && !!panel.querySelector('.spc-controller')
          && !document.body.classList.contains('loading-active');
      }, null, { timeout: 20000 });
      await page.waitForTimeout(600);

      // The guide chips and the coach rail are Advanced-view surfaces, and the
      // rail only mounts once a connected-speech guide is on. Put the page in
      // the state the redesign is actually about before measuring it.
      await page.evaluate(() => {
        try { window.SpeakingPracticeController?.setPreferredView('advanced'); } catch (_) {}
      });
      await page.waitForTimeout(400);
      await page.evaluate(() => document.getElementById('ra-toggle-linking-btn')?.click());
      await page.waitForTimeout(900);

      const probe = await page.evaluate(() => {
        // Compare the padded content edge, not the border box: the controller
        // rows and the workbench both carry .spc-shell-grid's inline padding,
        // so their border boxes start 24px before their content does.
        const left = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return null;
          const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
          return Math.round(r.left + pad);
        };
        const panel = document.getElementById('mode-read-aloud');
        const stage = document.querySelector('.ra-stage');
        const rail = document.querySelector('.ra-rail');
        const coachParagraph = document.getElementById('ra-connected-speech-paragraph');
        return {
          focusClass: document.body.classList.contains('spc-focus'),
          stepsInPrimaryRow: !!document.querySelector('.spc-row--primary .spc-steps'),
          footerExists: !!document.querySelector('.spc-footer .spc-slot-attempt'),
          leftPrimary: left('.spc-row--primary'),
          leftGuidebar: left('.ra-guidebar'),
          leftStage: left('.ra-stage'),
          railVisible: !!rail && getComputedStyle(rail).display !== 'none',
          railSideBySide: !!(stage && rail) && getComputedStyle(rail).display !== 'none'
            && rail.getBoundingClientRect().left >= stage.getBoundingClientRect().right - 2,
          panelOverflow: panel ? panel.scrollWidth - panel.clientWidth : 0,
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          duplicateParagraphText: coachParagraph ? coachParagraph.textContent.trim().length : 0,
          guideChips: document.querySelectorAll('#ra-prompt-guides-group button').length
        };
      });

      const tag = `@${bp.name}`;
      if (bp.name === '1440') {
        record(`focus width on by default ${tag}`, probe.focusClass === true);
        record(`steps collapsed into primary row ${tag}`, probe.stepsInPrimaryRow === true);
        record(`action footer exists ${tag}`, probe.footerExists === true);
        record(`coach no longer renders a second passage ${tag}`,
          probe.duplicateParagraphText === 0, `chars=${probe.duplicateParagraphText}`);
        record(`all four guide chips present ${tag}`,
          probe.guideChips === 4, `count=${probe.guideChips}`);
      }

      if (bp.name === '1440') {
        // Hovering a coach card must light the word it describes, up in the
        // passage — the whole point of putting the rail beside the stage.
        const sync = await page.evaluate(async () => {
          const card = document.querySelector('#ra-connected-speech-list .sc-guide-item');
          if (!card) return { ok: false, reason: 'no card' };
          card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 60));
          const stage = document.getElementById('ra-prompt-stage');
          const lit = stage ? stage.querySelectorAll('.sc-token--hovered') : [];
          const litOn = lit.length;
          card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
          await new Promise((r) => setTimeout(r, 60));
          const litOff = stage ? stage.querySelectorAll('.sc-token--hovered').length : 0;
          return { ok: true, hasTargets: litOn > 0, litOn, litOff };
        });
        record(`hovering a coach card lights its word in the passage ${tag}`,
          sync.ok && sync.litOn > 0 && sync.litOff === 0, JSON.stringify(sync));

        // The Hide toggle must survive a re-render; it used to be overwritten
        // every time the panel redrew.
        const hide = await page.evaluate(async () => {
          document.getElementById('ra-speech-coach-toggle')?.click();
          await new Promise((r) => setTimeout(r, 120));
          document.getElementById('ra-toggle-reduced-words-btn')?.click();
          await new Promise((r) => setTimeout(r, 700));
          const list = document.getElementById('ra-connected-speech-list');
          const hidden = !list || getComputedStyle(list).display === 'none';
          document.getElementById('ra-speech-coach-toggle')?.click();
          await new Promise((r) => setTimeout(r, 200));
          const shownAgain = !!list && getComputedStyle(list).display !== 'none';
          return { hidden, shownAgain };
        });
        record(`coach Hide survives a re-render ${tag}`,
          hide.hidden === true && hide.shownAgain === true, JSON.stringify(hide));
      }

      const edges = [probe.leftPrimary, probe.leftGuidebar, probe.leftStage].filter((v) => v !== null);
      const aligned = edges.length === 3 && Math.max(...edges) - Math.min(...edges) <= 1;
      record(`controller, guidebar and stage share a left edge ${tag}`, aligned,
        `primary=${probe.leftPrimary} guidebar=${probe.leftGuidebar} stage=${probe.leftStage}`);

      record(`coach rail mounts with a guide on ${tag}`, probe.railVisible === true);
      record(`rail ${bp.expectRail ? 'beside' : 'below'} the stage ${tag}`,
        probe.railSideBySide === bp.expectRail, `sideBySide=${probe.railSideBySide}`);

      record(`no horizontal overflow ${tag}`,
        probe.panelOverflow <= 1 && probe.docOverflow <= 1,
        `panel=${probe.panelOverflow} doc=${probe.docOverflow}`);

      // The auth chooser can re-present itself after a mode switch; it is not
      // part of what this check is looking at.
      await page.evaluate(() => {
        document.querySelectorAll('#entry-modal, .entry-modal, .auth-overlay, #auth-overlay, .guest-toast, #ai-chat-widget, .ai-chat-launcher').forEach((el) => {
          el.style.display = 'none';
        });
        document.body.classList.remove('modal-open', 'entry-modal-open', 'blur-active');
      });
      await page.screenshot({ path: path.join(OUT_DIR, `read-aloud-${bp.name}.png`), fullPage: false });
      await page.close();
    }
  } catch (error) {
    console.error('FAIL  harness error —', error?.message || error);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\nAll layout checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
