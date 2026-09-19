'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createHarness } = require('./helpers/pte-shell-harness');
const { readBrowserTestCredentials } = require('./helpers/browser-test-credentials');
const out = process.env.PTE_SHELL_EVIDENCE;
if (!out) throw new Error('Set PTE_SHELL_EVIDENCE to an external evidence directory');
fs.mkdirSync(out, { recursive: true });

async function verifyAuthenticatedHistory(harness) {
  const page = await harness.browser.newPage();
  const credentials = readBrowserTestCredentials('C:/Cursor AI/.local/browser-test-credentials.md');
  const config = fs.readFileSync(path.resolve(__dirname, '../../public/js/firebase-init.js'), 'utf8');
  const apiKey = config.match(/apiKey:\s*"([^"]+)"/)[1];
  const login = await page.request.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    data: { email: credentials.email, password: credentials.password, returnSecureToken: true }
  });
  assert.equal(login.status(), 200, 'credentials-file account can authenticate');
  const session = await login.json();
  const readStatuses = [];
  let fixtures = false;
  // Real authentication and real archive reads; never forward a mutating archive request.
  await page.route('**/api/practice-attempts**', async route => {
    assert.equal(route.request().method(), 'GET', 'authenticated archive verification is read-only');
    const url = new URL(route.request().url());
    if (fixtures) {
      const rows = [
        { attemptId: 'fixture-one', practiceMode: 'speak', promptId: 'one', score: 75, submittedAt: { _seconds: 1789800000 }, responseSnapshot: { text: 'Sanitized test answer.' } },
        { attemptId: 'fixture-two', practiceMode: 'speak', promptSnapshot: { id: 'two' }, score: 80, createdAt: '2026-09-18T00:00:00Z' }
      ];
      return route.fulfill({ json: url.pathname.endsWith('/fixture-one') ? { attempt: rows[0] } : { attempts: rows } });
    }
    const response = await route.fetch({ url: `https://listening-tasks-3ae34.web.app${url.pathname}${url.search}` });
    readStatuses.push(response.status());
    await route.fulfill({ response });
  });
  await page.goto(`${harness.baseURL}/offline.html`);
  await page.setContent('<main id="history"></main>');
  await page.evaluate(token => { window.auth = { currentUser: { getIdToken: async () => token } }; window.PracticeScopeManager = { getScope: () => 'pte' }; }, session.idToken);
  await page.addScriptTag({ url: `${harness.baseURL}/js/pte-attempt-archive.js` });
  await page.addScriptTag({ url: `${harness.baseURL}/js/pte-attempt-history-section.js` });
  const result = await page.evaluate(async () => {
    const attempts = await PTEAttemptArchive.fetchUserAttemptsCached();
    const modes = ['read-aloud', 'speak', 'describe-image', 'notes', 'asq', 'sgd', 'rts'];
    const selected = attempts?.find(row => modes.includes(row.practiceMode) && PTEAttemptArchive.getAttemptPromptId(row) != null);
    if (!selected) return { total: attempts?.length || 0, unavailable: true };
    const prompt = PTEAttemptArchive.getAttemptPromptId(selected);
    PteAttemptHistory.mount(document.getElementById('history'), { practiceMode: selected.practiceMode, modeLabel: selected.modeLabel || selected.practiceMode, getPromptId: () => prompt });
    return { total: attempts.length, expected: attempts.filter(row => row.practiceMode === selected.practiceMode && String(PTEAttemptArchive.getAttemptPromptId(row)) === String(prompt)).length };
  });
  assert.ok(readStatuses.length && readStatuses.every(status => status === 200), `archive GET status: ${readStatuses.join(',')}`);
  if (result.unavailable) {
    console.log(`LIMITATION real authenticated archive returned ${result.total} records with no eligible speaking attempt; verify populated rows using sanitized fixtures under the same authentication`);
    fixtures = true;
    await page.evaluate(() => {
      PTEAttemptArchive.invalidateHistoryCache();
      PteAttemptHistory.mount(document.getElementById('history'), { practiceMode: 'speak', modeLabel: 'Repeat Sentence', getPromptId: () => 'one' });
    });
    result.expected = 1;
  }
  await page.waitForFunction(count => document.querySelectorAll('.pte-attempts__row').length === count, result.expected);
  await page.getByRole('button', { name: 'Open feedback', exact: true }).first().click();
  await page.waitForSelector('.pte-attempt-review-container');
  await page.waitForFunction(() => !document.querySelector('.pte-attempt-review-loading'));
  assert.equal(await page.locator('.pte-attempt-review-error').count(), 0, 'existing review modal loads real attempt');
  console.log(`PASS authenticated history: ${result.expected} current-question rows; existing feedback modal loaded (${fixtures ? 'sanitized fixture' : 'real record'}; GET only)`);
  await page.close();
}

async function synthetic(page) {
  await page.evaluate(async () => {
    await window.switchToMode('speak');
    window.SpeakingPracticeController.unmount('speak');
    document.getElementById('mode-speak').style.display = 'none';
    const panel = document.createElement('section'); panel.id = 'pte-test-panel';
    panel.innerHTML = '<div id="pte-test-body"><p class="pte-instr">Look at the text below. In 34 seconds, read it aloud.</p><div class="pte-center" id="pte-test-rec"></div><p class="pte-passage">One of the great contributing factors to mental illness is the idea that we should, at all costs and at all times, be well.</p></div><button id="pte-test-start"><span>Original label</span></button><button id="pte-test-stop">Stop</button><div id="pte-test-audio"></div>';
    // The app navigation above is the harness smoke. Isolate the synthetic adapter
    // for visual evidence so unrelated mode content cannot contaminate its screenshots.
    [...document.body.children].forEach(node => { if (!node.matches('script, style, .site-header')) node.classList.add('pte-fixture-background'); });
    const fixtureStyle = document.createElement('style');
    fixtureStyle.textContent = '.pte-fixture-background,.guest-toast{display:none!important} #pte-test-panel{max-width:1280px;margin:100px auto 40px}@media(max-width:600px){#pte-test-panel{margin-top:180px}}';
    document.head.append(fixtureStyle); document.body.append(panel);
    window.__originalButton = document.getElementById('pte-test-start');
    window.__originalChild = window.__originalButton.firstChild;
    window.__phase = 'prep'; window.__calls = []; window.__prompt = 'one'; window.__filter = 'all';
    window.__config = {
      modeId: 'speak', panelId: panel.id, testOnly: true, shell: 'v3', enabledScopes: ['pte', 'english'],
      picker: { getItems: () => [{ id: 'one', label: 'First question' }, { id: 'two', label: 'Second question' }], getCurrentId: () => window.__prompt, select: id => { window.__prompt = id; } },
      v3: {
        title: 'Repeat Sentence', cardBodySelector: '#pte-test-body', getPhase: () => window.__phase,
        filters: [{ label: 'Status', get: () => window.__filter, set: value => { window.__filter = value; }, options: [{ value: 'all', label: 'All' }, { value: 'new', label: 'New' }] }],
        dock: { helpers: [{ id: 'pte-test-helper', label: 'Replay', count: () => 2, phases: ['prep', 'complete'] }], actions: [{ sourceId: 'pte-test-start', phases: ['prep'], variant: 'primary', label: 'Start recording' }, { sourceId: 'pte-test-stop', phases: ['recording'], variant: 'stop', label: 'Finish recording' }] },
        next: { goNext: () => window.__calls.push('next'), onConfirmFromRecording: async () => { window.__calls.push('save-start'); await new Promise(resolve => setTimeout(resolve, 50)); window.__calls.push('save-end'); } },
        attempts: { practiceMode: 'speak', modeLabel: 'Repeat Sentence', getPromptId: () => window.__prompt, formatScores: attempt => attempt.score == null ? [] : [`Overall ${attempt.score}%`] }
      }
    };
    window.SpeakingPracticeController.register(window.__config);
    window.__mount = () => window.SpeakingPracticeController.activate('speak', { scope: 'pte' });
    window.__setPhase = phase => { window.__phase = phase; window.SpeakingPracticeController.setPhase('speak', phase); };
    window.__mount();
    window.__rec = window.PteRecorderWidget.create(document.getElementById('pte-test-rec'), { totalSeconds: 34 });
    window.__rec.showCountdown(34);
  });
}

(async () => {
  const harness = await createHarness();
  try {
    for (const flag of ['v3', 'legacy', '']) {
      const page = await harness.browser.newPage();
      await page.goto(`${harness.baseURL}/offline.html?pteShell=${flag}`);
      await page.addScriptTag({ url: `${harness.baseURL}/js/pte-shell-config.js` });
      assert.deepEqual(await page.evaluate(() => [PteShellConfig.enabled, PteShellConfig.isModeEnabled('speak', 'english'), PteShellConfig.isModeEnabled('type', 'pte')]), [flag === 'v3', false, false]);
      await page.close();
    }
    for (const width of [1440, 390]) {
      const page = await harness.open({ width, height: width === 390 ? 844 : 900 });
      await page.waitForFunction(() => !!window.PTEAttemptArchive);
      await synthetic(page);
      console.log(`Mounted synthetic adapter at ${width}px`);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.waitForSelector('.pte-attempts__empty');
      assert.equal(await page.locator('.pte-modebar').count(), 1);
      for (let n = 0; n < 10; n++) {
        assert.equal(await page.evaluate(() => {
          SpeakingPracticeController.unmount('speak');
          return document.getElementById('pte-test-start') === __originalButton && __originalButton.firstChild === __originalChild && __originalButton.textContent === 'Original label'
            && !document.querySelector('.pte-modebar') && !document.body.classList.contains('pte-shell-v3');
        }), true, 'unmount restores original nodes and text');
        await page.evaluate(() => __mount());
        assert.equal(await page.locator('.pte-modebar').count(), 1);
        assert.equal(await page.locator('.pte-card').count(), 1);
      }
      await page.locator('#pte-next-speak').click();
      await page.getByRole('alertdialog').waitFor();
      assert.match(await page.getByRole('alertdialog').textContent(), /Cannot skip/);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'pte-next-speak');
      for (const key of ['Enter', 'Space']) {
        await page.locator('#pte-next-speak').click();
        await page.getByRole('alertdialog').waitFor();
        await page.keyboard.press(key);
        assert.equal(await page.getByRole('alertdialog').count(), 0, `${key} dismisses Cannot skip`);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'pte-next-speak');
        await page.evaluate(() => __setPhase('complete'));
        await page.locator('#pte-next-speak').click();
        await page.keyboard.press(key);
        assert.equal(await page.getByRole('alertdialog').count(), 0, `${key} activates Stay here`);
        assert.deepEqual(await page.evaluate(() => __calls), []);
        await page.locator('#pte-next-speak').click();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Next question');
        await page.keyboard.press(key);
        await page.waitForFunction(() => __calls.length === 1);
        assert.deepEqual(await page.evaluate(() => __calls), ['next'], `${key} confirms Next`);
        await page.evaluate(() => { __calls.length = 0; __setPhase('prep'); });
      }
      await page.evaluate(() => __setPhase('listen'));
      await page.locator('#pte-next-speak').click();
      await page.evaluate(() => __setPhase('prep'));
      await page.getByRole('button', { name: 'Next question', exact: true }).click();
      await page.getByRole('heading', { name: 'Cannot skip' }).waitFor();
      assert.deepEqual(await page.evaluate(() => __calls), []);
      await page.keyboard.press('Escape');
      await page.evaluate(() => { __setPhase('recording'); __rec.showRecording(34); __rec.setElapsed(12); });
      assert.equal(await page.locator('#pte-test-helper').isVisible(), false);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(out, `recording-${width}.png`), fullPage: false });
      await page.locator('#pte-next-speak').click();
      await page.getByRole('button', { name: 'Next question', exact: true }).click();
      await page.waitForFunction(() => __calls.length === 3);
      assert.deepEqual(await page.evaluate(() => __calls), ['save-start', 'save-end', 'next']);
      await page.evaluate(() => { __setPhase('complete'); __rec.showComplete(); });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(out, `complete-${width}.png`), fullPage: false });
      await page.evaluate(() => __setPhase('feedback'));
      await page.locator('#pte-next-speak').click();
      assert.equal(await page.getByRole('alertdialog').count(), 0);
      assert.equal(await page.locator('.pte-card--wide').count(), 1);
      assert.ok(await page.locator('.pte-card').evaluate(card => card.getBoundingClientRect().height <= 740), 'synthetic feedback card fits height budget');
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(out, `feedback-${width}.png`), fullPage: false });
      await page.evaluate(() => __setPhase('loading'));
      assert.equal(await page.locator('#pte-next-speak').isDisabled(), true);
      await page.evaluate(() => { __setPhase('prep'); __rec.showCountdown(34); });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(out, `prep-${width}.png`), fullPage: false });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      await page.getByRole('button', { name: 'New', exact: true }).click();
      assert.equal(await page.evaluate(() => __filter), 'new');
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button', { name: 'Filters', exact: true }).getAttribute('aria-expanded'), 'false');
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.keyboard.press('Tab');
      assert.match(await page.evaluate(() => document.activeElement.textContent), /How Repeat Sentence works/);
      await page.locator('.pte-passage').click();
      assert.equal(await page.locator('.pte-popover').count(), 0);
      await page.locator('#spc-picker-speak').click();
      await page.getByRole('searchbox', { name: 'Search questions' }).fill('Second');
      await page.waitForFunction(() => document.querySelectorAll('#spc-picker-sheet-speak .spc-sheet-item').length === 1);
      await page.keyboard.press('Escape');

      await page.evaluate(() => PteAttemptHistory.recordLocal({ practiceMode: 'speak', promptId: 'one', score: 72, audio: { durationMs: 12000 } }));
      await page.waitForSelector('.pte-attempts__row');
      assert.match(await page.locator('.pte-attempts__row').textContent(), /Overall 72%/);
      await page.evaluate(() => { __prompt = 'two'; SpeakingPracticeController.sync('speak'); });
      await page.waitForSelector('.pte-attempts__empty');
      await page.getByRole('button', { name: 'All Repeat Sentence', exact: true }).click();
      await page.waitForSelector('.pte-attempts__row');

      // A real 1-second PCM WAV exercises media playback without external media dependencies.
      await page.evaluate(async () => {
        const sampleRate = 8000, buffer = new ArrayBuffer(44 + sampleRate * 2), view = new DataView(buffer);
        const str = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
        str(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, sampleRate * 2, true);
        for (let i = 0; i < sampleRate; i++) view.setInt16(44 + i * 2, Math.sin(i / sampleRate * Math.PI * 880) * 1000, true);
        window.__audioURL = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
        window.__audio = new Audio(__audioURL); window.__box = PteAudioBox.create(document.getElementById('pte-test-audio'), { audio: __audio });
        window.__announcements = [];
        const live = document.querySelector('#pte-test-audio [role="status"]');
        if (!live) throw new Error('Audio box requires a visually hidden live status');
        window.__announcementObserver = new MutationObserver(() => __announcements.push(live.textContent));
        __announcementObserver.observe(live, { childList: true });
      });
      assert.equal(await page.locator('#pte-test-audio [role="status"]').textContent(), '', 'new audio box starts with a silent live region');
      await page.evaluate(async () => { await __box.countdown(2); });
      assert.deepEqual(await page.evaluate(() => __announcements), ['Beginning in 2 seconds'], 'first countdown announces its actual starting time once');
      await page.evaluate(() => { __box.reset(); });
      assert.equal(await page.locator('#pte-test-audio [role="status"]').textContent(), '', 'reset clears the announcement silently');
      await page.evaluate(async () => { __announcements.length = 0; await __box.countdown(2); });
      assert.deepEqual(await page.evaluate(() => __announcements), ['Beginning in 2 seconds'], 'countdown after reset announces its actual starting time once');
      await page.evaluate(async () => {
        __announcements.length = 0;
        await __box.play();
      });
      assert.equal(await page.locator('.pte-audio').getAttribute('data-state'), 'completed');
      assert.deepEqual(await page.evaluate(() => __announcements), ['Playing', 'Completed'], 'play and completion are announced once');
      assert.equal(await page.locator('#pte-test-audio [role="status"]').getAttribute('aria-live'), 'polite');
      assert.equal(await page.locator('#pte-test-audio [role="status"]').evaluate(node => node.classList.contains('pte-sr-only')), true);
      await page.evaluate(async () => { __announcements.length = 0; await __box.countdown(2); });
      assert.deepEqual(await page.evaluate(() => __announcements), ['Beginning in 2 seconds'], 'countdown ticks do not repeat announcements');
      await page.locator('.pte-audio input').evaluate(input => { input.value = '0.35'; input.dispatchEvent(new Event('input')); });
      assert.equal(await page.evaluate(() => __audio.volume), .35);
      await page.evaluate(() => {
        const native = __audio.play.bind(__audio); let first = true;
        __audio.play = () => { if (first) { first = false; return Promise.reject(new DOMException('gesture', 'NotAllowedError')); } return native(); };
        __box.reset(); window.__playing = __box.play();
      });
      await page.waitForSelector('.pte-audio[role="button"]');
      assert.equal(await page.locator('#pte-test-audio [role="status"]').textContent(), 'Click to start audio');
      await page.evaluate(() => { __announcements.length = 0; });
      await page.locator('.pte-audio').focus(); await page.keyboard.press('Enter');
      await page.evaluate(() => __playing);
      assert.equal(await page.locator('.pte-audio').getAttribute('role'), null);
      assert.deepEqual(await page.evaluate(() => __announcements), ['Playing', 'Completed'], 'autoplay recovery announces playing and completion once');
      assert.equal(await page.evaluate(async () => {
        const pending = __box.countdown(5).then(() => 'resolved', error => error.name);
        __box.destroy(); URL.revokeObjectURL(__audioURL); return pending;
      }), 'AbortError');
      await page.evaluate(() => { __rec.destroy(); SpeakingPracticeController.unmount('speak'); });
      await page.route('**/api/practice-attempts**', route => route.fulfill({ json: route.request().method() === 'POST' ? { attemptId: 'saved-fixture' } : { attempts: [] } }));
      const savedEvents = await page.evaluate(async () => {
        window.PracticeScopeManager = { getScope: () => 'pte' };
        const events = []; window.addEventListener('pte-attempt-archive:saved', event => events.push(event.detail));
        const guest = await PTEAttemptArchive.saveAttempt({ practiceMode: 'speak', promptSnapshot: { id: 'one' } });
        if (!guest.skipped || events.length) throw new Error('Guest skip emitted a successful-save event');
        window.auth = { currentUser: { getIdToken: async () => 'test-only-token' } };
        await PTEAttemptArchive.saveAttempt({ practiceMode: 'speak', promptSnapshot: { id: 'one' } });
        await PTEAttemptArchive.saveTextAttempt('notes', { id: 'two' }, 'A sanitized answer.');
        await PTEAttemptArchive.saveStateAttempt('asq', { currentQuestion: { id: 'three' } });
        return events.map(event => ({ attemptId: event.attemptId, practiceMode: event.practiceMode }));
      });
      assert.deepEqual(savedEvents, ['speak', 'notes', 'asq'].map(practiceMode => ({ attemptId: 'saved-fixture', practiceMode })), 'all save entrypoints emit once, only after success');
      assert.deepEqual(errors, [], 'no new uncaught errors');
      await page.close();
      console.log(`PASS shared components, restoration and interactions at ${width}px`);
    }
    if (process.env.PTE_AUTH_VERIFY === '1') await verifyAuthenticatedHistory(harness);
  } finally { await harness.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
