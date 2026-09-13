'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { launchPracticeChrome } = require('./helpers/launch-practice-chrome');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE_DIR = process.env.PRACTICE_UI_EVIDENCE_DIR || path.join(require('node:os').tmpdir(), 'practice-ui-evidence');
const SHARED_MODES = ['notes', 'speak', 'type', 'asq', 'rts', 'describe-image', 'sgd', 'read-aloud'];
const LISTENING_MODES = ['hcs', 'hiw', 'lmcma', 'lmcsa', 'smw', 'sst'];
const ADJACENT_MODES = ['extended', 'watch', 'pronounce', 'collo-dictate', 'rfib', 'dd', 'rmcsa', 'rmcma', 'rop', 'essay', 'swt'];
const WIDTHS = [1440, 1024, 768, 390, 320];

function startServer() {
  const app = express();
  app.use(express.static(path.join(ROOT, 'public')));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const server = await startServer();
  const browser = await launchPracticeChrome({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const results = [];

  try {
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.addInitScript(() => {
        localStorage.setItem('userStatus', 'guest');
        localStorage.setItem('hasSeenScopeTutorial', 'true');
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.SpeakingPracticeController, { timeout: 30000 });

      for (const mode of SHARED_MODES) {
        const probe = await page.evaluate((modeId) => {
          const previous = window.__practiceProbeMode;
          if (previous) window.SpeakingPracticeController.unmount(previous);
          document.querySelectorAll('.mode-panel').forEach((panel) => {
            panel.classList.remove('active');
            panel.style.display = 'none';
          });
          const panel = document.getElementById(`mode-${modeId}`);
          panel.classList.add('active');
          panel.style.display = 'block';
          window.SpeakingPracticeController.activate(modeId, { scope: 'pte' });
          window.__practiceProbeMode = modeId;
          const controller = panel.querySelector('.spc-controller');
          const attempt = panel.querySelector('.spc-slot-attempt');
          const media = panel.querySelector('.spc-slot-media');
          const actionHost = attempt?.parentElement?.closest('[data-practice-action-host]');
          const mediaHost = media?.parentElement?.closest('[data-practice-media-host]');
          return {
            mode: modeId,
            workspace: panel.dataset.practiceWorkspace || null,
            actionHost: actionHost?.dataset.practiceActionHost || null,
            mediaHost: mediaHost?.dataset.practiceMediaHost || null,
            adoptedCount: (attempt?.children.length || 0) + (media?.children.length || 0),
            attemptHostInPanel: !!actionHost && panel.contains(actionHost),
            mediaHostInPanel: !!mediaHost && panel.contains(mediaHost),
            controller: !!controller,
            panelOverflow: panel.scrollWidth - panel.clientWidth,
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            controllerBorderRadius: controller ? getComputedStyle(controller).borderRadius : null,
            controllerShadow: controller ? getComputedStyle(controller).boxShadow : null
          };
        }, mode);
        results.push({ width, ...probe });
        assert.equal(probe.workspace, mode, `${mode}@${width} must opt into its declared workspace`);
        assert.equal(probe.controller, true, `${mode}@${width} controller must mount`);
        assert.equal(probe.attemptHostInPanel, true, `${mode}@${width} attempt slot must stay in-panel`);
        assert.equal(probe.mediaHostInPanel, true, `${mode}@${width} media slot must stay in-panel`);
        assert.ok(probe.panelOverflow <= 1, `${mode}@${width} panel overflow ${probe.panelOverflow}`);
        assert.ok(probe.documentOverflow <= 1, `${mode}@${width} document overflow ${probe.documentOverflow}`);
        assert.equal(probe.controllerBorderRadius, '0px', `${mode}@${width} controller must remain flat`);
        assert.equal(probe.controllerShadow, 'none', `${mode}@${width} controller must remain flat`);
      }

      const listening = await page.evaluate((modeIds) => modeIds.map((modeId) => {
        const panel = document.getElementById(`mode-${modeId}`);
        panel.style.display = 'block';
        const player = panel.querySelector('.practice-audio-player');
        const parent = player?.parentElement;
        return {
          mode: modeId,
          playerWidth: player?.getBoundingClientRect().width || 0,
          parentWidth: parent?.getBoundingClientRect().width || 0,
          panelOverflow: panel.scrollWidth - panel.clientWidth
        };
      }), LISTENING_MODES);
      listening.forEach((item) => {
        assert.ok(item.playerWidth <= item.parentWidth + 1, `${item.mode}@${width} player exceeds task column`);
        assert.ok(item.panelOverflow <= 1, `${item.mode}@${width} panel overflow ${item.panelOverflow}`);
        results.push({ width, ...item });
      });

      const adjacent = await page.evaluate((modeIds) => modeIds.map((modeId) => {
        const panel = document.getElementById(`mode-${modeId}`);
        return { mode: modeId, sharedWorkspace: panel?.hasAttribute('data-practice-workspace') || false };
      }), ADJACENT_MODES);
      adjacent.forEach((item) => {
        assert.equal(item.sharedWorkspace, false, `${item.mode} must remain outside shared workspace`);
        results.push({ width, ...item });
      });

      await page.screenshot({ path: path.join(EVIDENCE_DIR, `practice-workspace-${width}.png`), fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'practice-workspace-layout.json'), JSON.stringify({
    chrome: 'channel:chrome',
    widths: WIDTHS,
    results
  }, null, 2));
  console.log(`Practice workspace Chrome checks passed (${results.length} probes). Evidence: ${EVIDENCE_DIR}`);
}

main().catch((error) => {
  console.error(`Practice workspace Chrome check failed: ${error.stack || error}`);
  process.exitCode = 1;
});
