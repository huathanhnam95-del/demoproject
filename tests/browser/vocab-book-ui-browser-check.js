/* eslint-disable no-console */
/**
 * Vocabulary Book / Vocabulary Practice UI checks.
 *
 * Covers the rework: card rows instead of an 8-column table, the pronunciation
 * fix, search/sort/filter, the Practice dashboard, dialog accessibility, mobile
 * layout, and the panel/modal desync fix.
 *
 * Run: node tests/browser/vocab-book-ui-browser-check.js
 */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');

  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function dismissBlockingOverlays(page) {
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return true;
    return getComputedStyle(preloader).display === 'none'
      || Boolean(document.getElementById('preloader-dismiss-btn'));
  }, { timeout: 25000 });

  const dismiss = page.locator('#preloader-dismiss-btn');
  if (await dismiss.count()) {
    try { await dismiss.click({ timeout: 3000 }); } catch (_) { /* ignore */ }
  }

  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    return !preloader || getComputedStyle(preloader).display === 'none';
  }, { timeout: 25000 });

  const guest = page.locator('#guest-mode-btn');
  if (await guest.isVisible().catch(() => false)) await guest.click();
}

/**
 * Seed a guest vocabulary book.
 *
 * Must run AFTER the app's own auth flow settles: index.html calls
 * VocabularyBook.setUser() when auth resolves, which reloads the cache and would
 * wipe anything seeded earlier.
 */
async function seedVocab(page) {
  await page.waitForFunction(() => Boolean(window.VocabularyBook), { timeout: 25000 });
  await page.waitForTimeout(3000);

  return page.evaluate(async () => {
    localStorage.setItem('srs_onboarding_complete', 'true');
    localStorage.setItem('srs_tutorial_seen', 'true');
    localStorage.setItem('bel_guest_vocab_v1', JSON.stringify({
      bookmarkedWords: [
        { word: 'artists', lemma: 'artist', mode: 'type', questionId: '1', partOfSpeech: 'noun', addedAt: '2026-01-31T00:00:00Z' },
        { word: 'made', lemma: 'make', mode: 'type', questionId: '107', partOfSpeech: 'verb', addedAt: '2026-01-07T00:00:00Z' },
        { word: 'textbook', lemma: 'textbook', mode: 'type', questionId: '2', addedAt: '2025-12-31T00:00:00Z' },
        { word: 'received', lemma: 'receive', mode: 'type', questionId: '2', addedAt: '2025-12-31T00:00:00Z' }
      ],
      frequentlyMissed: [
        { originalWord: 'and', lemma: 'and', missCount: 18, mode: 'type', questionId: '1', addedAt: '2026-01-24T00:00:00Z' },
        { originalWord: 'politics', lemma: 'politics', missCount: 24, partOfSpeech: 'noun', mode: 'type', questionId: '1', addedAt: '2026-01-24T00:00:00Z' }
      ],
      usedToMiss: [], masteredWords: [], wordStats: {}
    }));

    window.VocabularyBook.setUser('guest', null);
    return document.querySelectorAll('#vocab-bookmarked-list .vb-row').length;
  });
}

const openModal = (page, tab = 'bookmarks') => page.evaluate(
  (t) => window.VocabularyBook.showListModal(t), tab
);

async function main() {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await dismissBlockingOverlays(page);

    const panelRows = await seedVocab(page);
    assert.ok(panelRows >= 4, `side panel should render seeded rows, got ${panelRows}`);
    console.log(`✅ Side panel rendered ${panelRows} rows from the shared renderer.`);

    /* 0. Tutorial + audit DOM contracts ----------------------------------- */
    const contracts = await page.evaluate(() => {
      const bookmarked = document.getElementById('vocab-section-bookmarked');
      const missed = document.getElementById('vocab-section-missed');
      return {
        // Explicit ids replaced positional selectors in vocab-tutorial.js.
        bookmarkedHeading: bookmarked?.querySelector('h4')?.textContent.trim(),
        missedHeading: missed?.querySelector('h4')?.textContent.trim(),
        // The old '.vocab-section:first-child' matched nothing, because
        // .panel-header is the first child of #vocab-panel-content.
        oldFirstChildMatched: Boolean(document.querySelector('.vocab-section:first-child')),
        // Audit contract: scripts/audit/run-a2-auth-admin-audit.js
        auditSelectors: ['vocab-panel-toggle', 'vocab-panel-side', 'vocab-manual-add-btn',
          'manual-add-input', 'manual-add-submit', 'vocab-bookmarked-list']
          .filter((id) => !document.getElementById(id))
      };
    });
    console.log('contracts ->', JSON.stringify(contracts));
    assert.match(contracts.bookmarkedHeading || '', /Bookmarked Words/);
    assert.match(contracts.missedHeading || '', /Frequently Missed/);
    assert.strictEqual(contracts.oldFirstChildMatched, false,
      'sanity: the replaced positional selector never matched anything');
    assert.deepStrictEqual(contracts.auditSelectors, [],
      'every id the a2 audit depends on must still exist');
    console.log('✅ Tutorial section ids and audit selectors intact.');

    /* 1. Modal opens with the contract the existing suite asserts ---------- */
    await openModal(page);
    await page.waitForFunction(() => {
      const m = document.getElementById('vocab-list-modal');
      return m && m.classList.contains('active') && getComputedStyle(m).display !== 'none';
    }, { timeout: 10000 });
    console.log('✅ Modal opens with .active and display != none.');

    await page.waitForFunction(
      () => document.querySelectorAll('#vocab-list-bookmarks .vb-row').length > 0,
      { timeout: 15000 }
    );

    /* 2. No dev jargon, no dead columns ----------------------------------- */
    const modalText = await page.evaluate(() => document.getElementById('vocab-list-modal').innerText);
    assert.ok(!modalText.includes('Citation:'), 'the literal "Citation:" label must never render');
    console.log('✅ No "Citation:" jargon anywhere in the modal.');

    const noTable = await page.evaluate(
      () => document.querySelectorAll('#vocab-list-modal table.vocab-table').length
    );
    assert.strictEqual(noTable, 0, 'the 8-column table should be gone');
    console.log('✅ Legacy 8-column table is gone.');

    // Unknown part of speech must be omitted, not printed as "-".
    const dashCells = await page.evaluate(() => {
      const tags = [...document.querySelectorAll('#vocab-list-bookmarks .vb-tag')];
      return tags.filter((t) => t.textContent.trim() === '-').length;
    });
    assert.strictEqual(dashCells, 0, 'unknown POS must render nothing, not "-"');
    console.log('✅ Unknown part-of-speech renders nothing instead of "-".');

    /* 3. Pronunciation: one line, plus a chip for extra forms -------------- */
    await openModal(page, 'missed');
    await page.waitForFunction(
      () => document.querySelectorAll('#vocab-list-missed .vb-row').length > 0,
      { timeout: 15000 }
    );
    await page.waitForTimeout(3500); // allow phonetics hydration

    const pron = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#vocab-list-missed .vb-row')];
      return rows.map((r) => ({
        word: r.dataset.word,
        ipaCount: r.querySelectorAll('[data-role="pron"] .vocab-phonetic').length,
        visibleIpaCount: r.querySelectorAll('[data-role="pron"] > .vocab-phonetic').length,
        hasMoreChip: Boolean(r.querySelector('.vb-ipa-more')),
        variantsHidden: r.querySelector('.vb-ipa-variants')?.hidden ?? null
      }));
    });
    console.log('pronunciation ->', JSON.stringify(pron));

    const andRow = pron.find((r) => r.word === 'and');
    if (andRow && andRow.ipaCount > 1) {
      assert.strictEqual(andRow.visibleIpaCount, 1,
        '"and" must show exactly ONE inline IPA line, not a six-line stack');
      assert.ok(andRow.hasMoreChip, 'extra forms must collapse behind a "+N" chip');
      assert.strictEqual(andRow.variantsHidden, true, 'extra forms start collapsed');
      console.log('✅ Multi-form word renders one line + a collapsed "+N" chip.');
    } else {
      console.log('ℹ "and" resolved to a single form here; multi-form path not exercised.');
    }
    pron.forEach((r) => {
      assert.ok(r.visibleIpaCount <= 1, `${r.word} should show at most one inline IPA line`);
    });
    assert.ok(
      await page.evaluate(() => Boolean(document.querySelector('.vocab-phonetic'))),
      '.vocab-phonetic must still exist (oxford-ipa-visual-check.js selects it)'
    );
    console.log('✅ .vocab-phonetic contract preserved.');

    /* 4. Search ------------------------------------------------------------ */
    await openModal(page);
    await page.waitForFunction(
      () => document.querySelectorAll('#vocab-list-bookmarks .vb-row').length > 0,
      { timeout: 15000 }
    );
    const totalRows = await page.evaluate(
      () => document.querySelectorAll('#vocab-list-bookmarks .vb-row').length
    );

    await page.fill('#vocab-toolbar-bookmarks .vb-search-input', 'artist');
    await page.waitForTimeout(500);
    const searched = await page.evaluate(
      () => document.querySelectorAll('#vocab-list-bookmarks .vb-row').length
    );
    assert.ok(searched < totalRows && searched >= 1,
      `search should narrow ${totalRows} rows, got ${searched}`);
    console.log(`✅ Search narrowed ${totalRows} → ${searched} rows.`);

    await page.click('#vocab-toolbar-bookmarks .vb-search-clear');
    await page.waitForTimeout(500);
    const restored = await page.evaluate(
      () => document.querySelectorAll('#vocab-list-bookmarks .vb-row').length
    );
    assert.strictEqual(restored, totalRows, 'clearing search restores every row');
    console.log('✅ Clearing search restores the full list.');

    /* 5. Sort -------------------------------------------------------------- */
    const beforeSort = await page.evaluate(
      () => [...document.querySelectorAll('#vocab-list-bookmarks .vb-word')].map((e) => e.textContent)
    );
    await page.selectOption('#vocab-toolbar-bookmarks .vb-sort-select', 'alpha');
    await page.waitForTimeout(500);
    const afterSort = await page.evaluate(
      () => [...document.querySelectorAll('#vocab-list-bookmarks .vb-word')].map((e) => e.textContent)
    );
    const sortedCopy = [...afterSort].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    assert.deepStrictEqual(afterSort, sortedCopy, 'A–Z sort must actually sort');
    assert.notDeepStrictEqual(afterSort, beforeSort, 'sort must change the order');
    console.log(`✅ Sort works: ${beforeSort.join(',')} → ${afterSort.join(',')}`);

    /* 6 + 7. Practice dashboard ------------------------------------------- */
    await page.evaluate(() => {
      window.__modeCalls = [];
      const real = window.SRSReview.startReviewSession;
      window.SRSReview.startReviewSession = (arg) => {
        window.__modeCalls.push(arg);
        return Promise.resolve();
      };
      window.SRSReview.__realStart = real;
    });

    await openModal(page, 'practice');
    await page.waitForTimeout(800);

    const practice = await page.evaluate(() => {
      const host = document.getElementById('tab-content-practice');
      return {
        modeCards: host.querySelectorAll('.vb-mode-card').length,
        hasRing: Boolean(host.querySelector('.vb-ring')),
        stats: [...host.querySelectorAll('.vb-stat-label')].map((e) => e.textContent),
        totalWords: host.querySelector('.vb-stat:nth-child(3) .vb-stat-value')?.textContent,
        settingsCollapsed: host.querySelector('.vb-settings')?.open === false,
        toggleIds: [...host.querySelectorAll('.vb-toggle-item input')].map((i) => i.id),
        emojiHero: host.innerText.includes('🔄')
      };
    });
    console.log('practice ->', JSON.stringify(practice));
    assert.strictEqual(practice.modeCards, 4, 'four practice mode cards');
    assert.ok(practice.hasRing, 'mastery ring must render');
    assert.ok(practice.stats.includes('Day streak'), 'streak stat must render');
    assert.strictEqual(Number(practice.totalWords), 4, 'words-tracked should match the seeded book');
    assert.ok(practice.settingsCollapsed, 'tutorial settings must be collapsed by default');
    assert.deepStrictEqual(
      practice.toggleIds,
      ['tutorial-replay-listen', 'tutorial-replay-speak', 'tutorial-replay-cloze', 'tutorial-replay-writing'],
      'the four tutorial-replay ids are a contract with vocab-tutorial.js'
    );
    assert.ok(!practice.emojiHero, 'the 48px emoji hero should be gone');
    console.log('✅ Practice dashboard renders live state, 4 mode cards, collapsed settings.');

    // rebindReplayToggles must be idempotent: the Practice tab re-renders, and
    // stacking duplicate change listeners would double-write the preference.
    const rebind = await page.evaluate(() => {
      const el = document.getElementById('tutorial-replay-listen');
      let fires = 0;
      el.addEventListener('change', () => { fires += 1; });
      window.VocabTutorial.rebindReplayToggles();
      window.VocabTutorial.rebindReplayToggles();
      el.checked = true;
      el.dispatchEvent(new Event('change'));
      return { fires, stored: JSON.parse(localStorage.getItem('vocabTutorialReplay') || '{}') };
    });
    assert.strictEqual(rebind.fires, 1, 'repeated rebinds must not stack listeners');
    assert.strictEqual(rebind.stored.srsListenType, true, 'the bound handler must persist the preference');
    console.log('✅ rebindReplayToggles is idempotent and functional.');

    await page.click('#tab-content-practice .vb-mode-card[data-mode="cloze"]');
    await page.waitForTimeout(300);
    const modeCalls = await page.evaluate(() => window.__modeCalls);
    assert.deepStrictEqual(modeCalls, [{ mode: 'cloze' }],
      `mode card must call startReviewSession({mode:'cloze'}), got ${JSON.stringify(modeCalls)}`);
    console.log('✅ Mode card calls startReviewSession({ mode }) directly.');

    await page.evaluate(() => {
      window.SRSReview.startReviewSession = window.SRSReview.__realStart;
    });

    /* 8 + 9. Dialog accessibility ----------------------------------------- */
    const a11y = await page.evaluate(() => {
      const m = document.getElementById('vocab-list-modal');
      return {
        role: m.getAttribute('role'),
        ariaModal: m.getAttribute('aria-modal'),
        labelledBy: m.getAttribute('aria-labelledby'),
        tablist: document.querySelector('.vocab-tabs')?.getAttribute('role'),
        selectedTabs: [...document.querySelectorAll('.vocab-tab-btn')]
          .map((b) => b.getAttribute('aria-selected')),
        panelRoles: [...document.querySelectorAll('.vocab-tab-content')]
          .map((p) => p.getAttribute('role'))
      };
    });
    console.log('a11y ->', JSON.stringify(a11y));
    assert.strictEqual(a11y.role, 'dialog');
    assert.strictEqual(a11y.ariaModal, 'true');
    assert.ok(a11y.labelledBy, 'dialog must be labelled');
    assert.strictEqual(a11y.tablist, 'tablist');
    assert.ok(a11y.panelRoles.every((r) => r === 'tabpanel'), 'panels need role=tabpanel');
    assert.strictEqual(a11y.selectedTabs.filter((v) => v === 'true').length, 1,
      'exactly one tab is aria-selected');
    console.log('✅ Dialog and tabs expose correct ARIA.');

    // Focus trap: tabbing from the last focusable wraps back inside.
    const trapped = await page.evaluate(async () => {
      const modal = document.getElementById('vocab-list-modal');
      const focusable = [...modal.querySelectorAll('button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
      if (!focusable.length) return { ok: false, reason: 'no focusable elements' };
      focusable[focusable.length - 1].focus();
      const before = document.activeElement;
      modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
      return { ok: modal.contains(document.activeElement), before: before.tagName };
    });
    assert.ok(trapped.ok, 'focus must stay inside the open dialog');
    console.log('✅ Focus stays trapped inside the dialog.');

    // ESC closes and focus is restored to whatever opened the dialog.
    // Close first: this mirrors real usage, where the dialog is shut before being
    // reopened from a page control.
    await page.evaluate(() => window.VocabularyBook.hideListModal());
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.__opener = document.createElement('button');
      window.__opener.id = 'vb-test-opener';
      document.body.appendChild(window.__opener);
      window.__opener.focus();
      window.VocabularyBook.showListModal('bookmarks');
    });
    await page.waitForFunction(
      () => document.getElementById('vocab-list-modal').classList.contains('active'),
      { timeout: 5000 }
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !document.getElementById('vocab-list-modal').classList.contains('active'),
      { timeout: 5000 }
    );
    const focusBack = await page.evaluate(() => document.activeElement?.id);
    assert.strictEqual(focusBack, 'vb-test-opener', 'focus must return to the opener');
    console.log('✅ ESC closes the dialog and restores focus.');

    /* 11. Panel/modal desync fix ------------------------------------------ */
    await openModal(page);
    await page.waitForFunction(
      () => document.querySelectorAll('#vocab-list-bookmarks .vb-row').length > 0,
      { timeout: 15000 }
    );
    // Re-seed immediately before this assertion. Saves are debounced ~3s, so a
    // reload triggered mid-test could otherwise restore the seeded localStorage.
    await page.evaluate(() => window.VocabularyBook.setUser('guest', null));
    await page.waitForTimeout(400);

    // Do the click AND the measurement inside one page context. Splitting them
    // across two round-trips races against the re-render that removal triggers.
    const desync = await page.evaluate(async () => {
      const count = (sel) => document.querySelectorAll(sel).length;
      const before = {
        modal: count('#vocab-list-bookmarks .vb-row'),
        panel: count('#vocab-bookmarked-list .vb-row')
      };

      // The confirmed branch of removeViaModal() is what we are exercising.
      window.showCustomConfirm = () => Promise.resolve(true);
      const btn = document.querySelector('#vocab-list-bookmarks [data-action="remove-word"]');
      if (!btn) return { before, error: 'no remove button rendered' };
      const removedKey = btn.dataset.key;
      btn.click();

      // Poll in-page until the removal lands.
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline
             && count('#vocab-list-bookmarks .vb-row') === before.modal) {
        await new Promise((r) => setTimeout(r, 100));
      }

      return {
        before,
        removedKey,
        after: {
          modal: count('#vocab-list-bookmarks .vb-row'),
          panel: count('#vocab-bookmarked-list .vb-row')
        },
        remainingKeys: [...document.querySelectorAll('#vocab-list-bookmarks .vb-row')]
          .map((r) => r.dataset.key)
      };
    });
    console.log('desync ->', JSON.stringify(desync));
    assert.ok(!desync.error, desync.error);
    assert.strictEqual(desync.after.modal, desync.before.modal - 1, 'modal list must lose the row');
    assert.ok(!desync.remainingKeys.includes(desync.removedKey), 'the removed word must be gone');
    assert.strictEqual(desync.after.panel, desync.after.modal,
      'side panel must agree with the modal — disagreement was the desync bug');
    console.log('✅ Removing in the modal updates the side panel immediately.');

    /* 10. Mobile: no horizontal scroller ---------------------------------- */
    await page.setViewportSize({ width: 375, height: 812 });
    await openModal(page);
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => {
      const modal = document.getElementById('vocab-list-modal');
      const list = document.getElementById('vocab-list-bookmarks');
      return {
        bodyScrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
        listScrollWidth: list.scrollWidth,
        listClientWidth: list.clientWidth,
        modalScrollWidth: modal.scrollWidth,
        modalClientWidth: modal.clientWidth
      };
    });
    console.log('mobile ->', JSON.stringify(overflow));
    assert.ok(overflow.bodyScrollWidth <= overflow.innerWidth + 1,
      `page must not scroll sideways at 375px (${overflow.bodyScrollWidth} > ${overflow.innerWidth})`);
    assert.ok(overflow.listScrollWidth <= overflow.listClientWidth + 1,
      'the word list must not scroll sideways — the old table did');
    console.log('✅ No horizontal scrolling at 375px.');

    // The modal must not be buried under the fixed site header, and the
    // full-screen panel must not overflow the viewport vertically. Both were
    // broken before this rework: the title, tabs and close button were covered.
    const chrome = await page.evaluate(() => {
      const modal = document.getElementById('vocab-list-modal');
      const content = modal.querySelector('.vocab-list-content-modal');
      const header = modal.querySelector('.vocab-list-header');
      const site = document.querySelector('.site-header');
      const z = (el) => Number(getComputedStyle(el).zIndex) || 0;
      return {
        modalZ: z(modal),
        siteHeaderZ: site ? z(site) : 0,
        contentHeight: Math.round(content.getBoundingClientRect().height),
        viewportHeight: window.innerHeight,
        headerTop: Math.round(header.getBoundingClientRect().top),
        // Is the modal's own header actually the topmost thing at that point?
        topmostAtHeader: (() => {
          const r = header.getBoundingClientRect();
          const el = document.elementFromPoint(r.left + 8, r.top + r.height / 2);
          return el ? modal.contains(el) : false;
        })()
      };
    });
    console.log('mobile chrome ->', JSON.stringify(chrome));
    assert.ok(chrome.modalZ > chrome.siteHeaderZ,
      `full-screen modal must outrank the site header (${chrome.modalZ} vs ${chrome.siteHeaderZ})`);
    assert.ok(chrome.contentHeight <= chrome.viewportHeight,
      `panel must fit the viewport (${chrome.contentHeight} > ${chrome.viewportHeight})`);
    assert.ok(chrome.topmostAtHeader,
      'the modal header must be reachable, not covered by page chrome');
    console.log('✅ Modal header/tabs are visible and reachable at 375px.');

    /* 12. Regressions found during the post-implementation audit ---------- */
    const audit = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      const modal = document.getElementById('vocab-list-modal');

      // (a) A filtered-empty list must not claim the book is empty.
      window.VocabularyBook.showListModal('bookmarks');
      await wait(900);
      const input = document.querySelector('#vocab-toolbar-bookmarks .vb-search-input');
      input.value = 'zzzznotarealword';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(500);
      out.noMatchCopy = document.getElementById('vocab-list-bookmarks').innerText.trim();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(400);

      // (b) Closing then immediately reopening must not leave the modal
      //     .active but display:none (a stale hide timer used to win).
      window.VocabularyBook.hideListModal();
      window.VocabularyBook.showListModal('bookmarks');
      await wait(700);
      out.reopen = {
        active: modal.classList.contains('active'),
        display: getComputedStyle(modal).display
      };

      // (c) With the Practice tab open, a cache reload must refresh the tab the
      //     user is looking at (it used to re-render the hidden Missed list).
      window.VocabularyBook.showListModal('practice');
      await wait(900);
      const mount = document.getElementById('tab-content-practice');
      const firstChild = mount.firstElementChild;
      window.VocabularyBook.setUser('guest', null);
      await wait(1000);
      out.practiceRefreshed = mount.firstElementChild !== firstChild;
      out.practiceStillActive = document.querySelector('.vocab-tab-btn.active')?.dataset.tab;

      return out;
    });
    console.log('audit regressions ->', JSON.stringify(audit));

    assert.ok(audit.noMatchCopy.startsWith('No words match your filters'),
      `a filtered-empty list must not say the book is empty, got: ${audit.noMatchCopy}`);
    assert.ok(audit.reopen.active && audit.reopen.display !== 'none',
      `reopening must not leave the modal invisible (${JSON.stringify(audit.reopen)})`);
    assert.ok(audit.practiceRefreshed,
      'the Practice dashboard must re-render when the vocab cache changes');
    assert.strictEqual(audit.practiceStillActive, 'practice',
      'refreshing must not switch away from the Practice tab');
    console.log('✅ Audit regressions covered (empty-state copy, reopen race, practice refresh).');

    assert.deepStrictEqual(pageErrors, [], `no uncaught page errors: ${pageErrors.join(' | ')}`);
    console.log('\n🎉 All Vocab Book UI checks passed.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Vocab Book UI check failed:', err.message);
  console.error(err);
  process.exit(1);
});
