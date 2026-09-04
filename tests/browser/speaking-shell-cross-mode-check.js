/**
 * Shared speaking shell regression.
 *
 * The Read Aloud redesign changed the shell every speaking mode uses: the step
 * indicator moved into the controller's primary row, the media/attempt slots
 * moved into a sticky footer, and the controller lost its card treatment in
 * favour of one .spc-shell-grid column. This checks the other six modes still
 * mount their controls into those slots and stay on the grid.
 */
const { chromium } = require('playwright');
const express = require('express');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'artifacts', 'speaking-shell');

const MODES = ['speak', 'asq', 'describe-image', 'notes', 'rts', 'sgd'];
const WIDTHS = [1440, 390];

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
    for (const width of WIDTHS) {
      for (const mode of MODES) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.addInitScript(() => {
          window.localStorage.setItem('userStatus', 'guest');
          window.localStorage.setItem('hasSeenScopeTutorial', 'true');
          ['asq', 'describe-image', 'notes', 'rts', 'sgd', 'speak'].forEach((m) => {
            window.localStorage.setItem(`${m}ModeFirstUse`, 'true');
          });
        });
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
        const guest = page.locator('#guest-mode-btn');
        if (await guest.isVisible().catch(() => false)) await guest.click();
        await page.waitForTimeout(700);
        await page.evaluate((m) => window.switchToMode(m), mode);
        await page.waitForFunction((m) => {
          const panel = document.getElementById(`mode-${m}`);
          return !!panel && getComputedStyle(panel).display !== 'none'
            && !!panel.querySelector('.spc-controller');
        }, mode, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(800);

        const probe = await page.evaluate((m) => {
          const panel = document.getElementById(`mode-${m}`);
          if (!panel) return { missing: true };
          const controller = panel.querySelector('.spc-controller');
          const footer = panel.querySelector('.spc-footer');
          const steps = panel.querySelector('.spc-row--primary .spc-steps');
          const attempt = panel.querySelector('.spc-slot-attempt');
          const media = panel.querySelector('.spc-slot-media');
          const cs = controller ? getComputedStyle(controller) : null;
          return {
            missing: false,
            hasController: !!controller,
            hasFooter: !!footer,
            stepsInPrimary: !!steps,
            adoptedControls: (attempt ? attempt.children.length : 0) + (media ? media.children.length : 0),
            footerHidden: footer ? getComputedStyle(footer).display === 'none' : null,
            controllerFlat: cs ? (cs.borderRadius === '0px' && cs.boxShadow === 'none') : false,
            panelOverflow: panel.scrollWidth - panel.clientWidth,
            docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
          };
        }, mode);

        const tag = `${mode}@${width}`;
        if (probe.missing) {
          record(`panel exists ${tag}`, false);
        } else {
          record(`controller mounts ${tag}`, probe.hasController === true);
          record(`steps live in the primary row ${tag}`, probe.stepsInPrimary === true);
          // A mode with no adopted media/attempt controls should hide the
          // footer rather than render an empty bordered band.
          record(`footer matches adopted controls ${tag}`,
            probe.adoptedControls > 0 ? probe.footerHidden === false : probe.footerHidden !== false,
            `adopted=${probe.adoptedControls} footerHidden=${probe.footerHidden}`);
          record(`controller is flat, not a card ${tag}`, probe.controllerFlat === true);
          record(`no horizontal overflow ${tag}`,
            probe.panelOverflow <= 1 && probe.docOverflow <= 1,
            `panel=${probe.panelOverflow} doc=${probe.docOverflow}`);
        }

        await page.evaluate(() => {
          document.querySelectorAll('#entry-modal, .entry-modal, .auth-overlay, .guest-toast').forEach((el) => {
            el.style.display = 'none';
          });
        });
        await page.screenshot({ path: path.join(OUT_DIR, `${mode}-${width}.png`) });
        await page.close();
      }
    }
  } catch (error) {
    console.error('FAIL  harness error —', error?.message || error);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\nAll cross-mode checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
