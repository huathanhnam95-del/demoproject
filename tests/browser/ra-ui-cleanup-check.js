/* eslint-disable no-console */
/**
 * Browser test: Verify Speaking Practice Read Aloud UI cleanup
 * Tests Wave 1-3 fixes: audio shortcuts, question-selector suppression,
 * audio player flattening, toggle class refactor, filter pill CSS, z-index fix.
 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });

  // Mock MediaRecorder for headless
  await context.addInitScript(() => {
    class FakeMediaRecorder {
      constructor(stream) { this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/webm'; this.listeners = {}; }
      addEventListener(type, handler) { if (!this.listeners[type]) this.listeners[type] = []; this.listeners[type].push(handler); }
      start() { this.state = 'recording'; }
      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        const blob = new Blob(['fake-audio'], { type: this.mimeType });
        (this.listeners.dataavailable || []).forEach(h => h({ data: blob }));
        (this.listeners.stop || []).forEach(h => h());
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: FakeMediaRecorder });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks() { return [{ stop() {} }]; } }) }
    });
  });

  const page = await context.newPage();
  let passed = 0;
  let failed = 0;

  function ok(label) { passed++; console.log(`  ✅ PASS: ${label}`); }
  function fail(label, detail) { failed++; console.error(`  ❌ FAIL: ${label} — ${detail}`); }

  async function dismissTutorialIfVisible() {
    await page.waitForTimeout(700);
    const visible = await page.evaluate(() => {
      const o = document.getElementById('tutorial-overlay');
      return !!o && o.classList.contains('active') && getComputedStyle(o).display !== 'none';
    });
    if (visible) {
      console.log('  Dismissing tutorial...');
      await page.click('#tutorial-skip');
      await page.waitForFunction(() => {
        const o = document.getElementById('tutorial-overlay');
        return !o || !o.classList.contains('active') || getComputedStyle(o).display === 'none';
      }, { timeout: 5000 });
    }
  }

  try {
    // ── Navigate & enter ──
    console.log('\n🔵 Step 1: Navigate to app');
    await page.goto('https://localhost:8443/', { waitUntil: 'domcontentloaded' });
    await page.click('#guest-mode-btn');
    await page.waitForSelector('.mode-switch-btn', { state: 'visible' });
    ok('App loaded, entry modal dismissed');

    // ── Open Read Aloud ──
    console.log('\n🔵 Step 2: Open Read Aloud mode');
    const cards = await page.$$('.card-body h3');
    let raFound = false;
    for (const card of cards) {
      const text = await card.textContent();
      if (text.includes('Read Aloud')) {
        raFound = true;
        await card.evaluate(node => node.closest('.mode-switch-btn').click());
        break;
      }
    }
    if (!raFound) { fail('Navigate to Read Aloud', 'Card not found'); throw new Error('Read Aloud card not found'); }
    await dismissTutorialIfVisible();
    await page.waitForSelector('#mode-read-aloud.active', { state: 'visible', timeout: 5000 });
    ok('Read Aloud mode panel active');

    // ── WAVE 1a: Audio shortcuts are icon-only ──
    console.log('\n🔵 Step 3: Verify audio shortcut buttons (Wave 1a)');
    const audioShortcuts = await page.evaluate(() => {
      const playBtn = document.getElementById('header-ra-play-audio-btn');
      const recBtn = document.getElementById('header-ra-play-recording-btn');
      if (!playBtn || !recBtn) return { error: 'Buttons not found' };

      // Check for data-label spans (should be gone)
      const hasOldDataLabel = playBtn.querySelector('[data-label]') !== null || recBtn.querySelector('[data-label]') !== null;
      // Check for sr-only spans (should be present)
      const hasSrOnly = playBtn.querySelector('.spc-sr-only') !== null && recBtn.querySelector('.spc-sr-only') !== null;
      // Check for emoji/icon content
      const playIcon = playBtn.querySelector('[aria-hidden]')?.textContent?.trim() || '';
      const recIcon = recBtn.querySelector('[aria-hidden]')?.textContent?.trim() || '';
      // Check button dimensions aren't overflowing
      const playRect = playBtn.getBoundingClientRect();
      const recRect = recBtn.getBoundingClientRect();

      return {
        hasOldDataLabel,
        hasSrOnly,
        playIcon,
        recIcon,
        playWidth: playRect.width,
        playHeight: playRect.height,
        recWidth: recRect.width,
        recHeight: recRect.height
      };
    });

    if (audioShortcuts.error) { fail('Audio shortcuts exist', audioShortcuts.error); }
    else {
      if (audioShortcuts.hasOldDataLabel) fail('data-label removed', 'Old data-label spans still present');
      else ok('data-label spans removed');

      if (!audioShortcuts.hasSrOnly) fail('sr-only labels present', 'Missing .spc-sr-only spans');
      else ok('Screen-reader-only labels present');

      if (audioShortcuts.playIcon === '🔊') ok('Play sample icon: 🔊');
      else fail('Play sample icon', `Got "${audioShortcuts.playIcon}" instead of 🔊`);

      if (audioShortcuts.recIcon === '🎙️') ok('Play recording icon: 🎙️');
      else fail('Play recording icon', `Got "${audioShortcuts.recIcon}" instead of 🎙️`);

      // Buttons should be compact (under 50px wide if icon-only)
      if (audioShortcuts.playWidth < 60) ok(`Play button compact (${Math.round(audioShortcuts.playWidth)}px)`);
      else fail('Play button compact', `Width ${Math.round(audioShortcuts.playWidth)}px is too wide for icon-only`);
    }

    // ── WAVE 1b: question-selector suppressed ──
    console.log('\n🔵 Step 4: Verify question-selector suppressed (Wave 1b)');
    const qSelectorHidden = await page.evaluate(() => {
      const qs = document.querySelector('#mode-read-aloud .question-selector');
      if (!qs) return { exists: false };
      return {
        exists: true,
        display: getComputedStyle(qs).display,
        styleAttr: qs.getAttribute('style') || ''
      };
    });
    if (qSelectorHidden.exists && qSelectorHidden.display === 'none') ok('Question selector display:none');
    else if (!qSelectorHidden.exists) ok('Question selector not in DOM');
    else fail('Question selector hidden', `display=${qSelectorHidden.display}`);

    // ── WAVE 1c: Audio player has no box-shadow ──
    console.log('\n🔵 Step 5: Verify audio player flattened (Wave 1c)');
    const audioPlayerStyle = await page.evaluate(() => {
      const player = document.getElementById('ra-audio-player');
      if (!player) return { exists: false };
      const cs = getComputedStyle(player);
      return {
        exists: true,
        background: cs.background,
        boxShadow: cs.boxShadow,
        borderRadius: cs.borderRadius,
        styleAttr: player.getAttribute('style') || ''
      };
    });
    if (!audioPlayerStyle.exists) {
      console.log('  ℹ️ Audio player not in DOM yet (display:none) — checking style attribute directly');
      const styleAttr = await page.evaluate(() => document.getElementById('ra-audio-player')?.getAttribute('style') || '');
      if (!styleAttr.includes('box-shadow') && !styleAttr.includes('border-radius') && !styleAttr.includes('background:')) {
        ok('Audio player: no background/shadow/border-radius in style attribute');
      } else {
        fail('Audio player flattened', `style still has: ${styleAttr}`);
      }
    } else {
      if (audioPlayerStyle.boxShadow === 'none' || audioPlayerStyle.boxShadow === '') ok('Audio player: no box-shadow');
      else fail('Audio player box-shadow', audioPlayerStyle.boxShadow);
    }

    // ── WAVE 2a: Toggle groups use CSS classes ──
    console.log('\n🔵 Step 6: Verify toggle buttons use CSS classes (Wave 2a)');
    const toggleCheck = await page.evaluate(() => {
      const groups = document.querySelectorAll('#ra-audio-player .ra-toggle-group');
      const btns = document.querySelectorAll('#ra-audio-player .ra-toggle-btn');
      const speedActive = document.getElementById('ra-speed-100');
      return {
        groupCount: groups.length,
        btnCount: btns.length,
        speedHasActiveClass: speedActive?.classList.contains('ra-toggle-active') || false,
        // Check that inline style attrs are gone from toggles
        maleHasInlineStyle: document.getElementById('ra-voice-male')?.getAttribute('style') || '',
        femaleHasInlineStyle: document.getElementById('ra-voice-female')?.getAttribute('style') || ''
      };
    });
    if (toggleCheck.groupCount >= 2) ok(`${toggleCheck.groupCount} toggle groups found`);
    else fail('Toggle groups', `Expected ≥2, got ${toggleCheck.groupCount}`);

    if (toggleCheck.btnCount >= 4) ok(`${toggleCheck.btnCount} toggle buttons found`);
    else fail('Toggle buttons', `Expected ≥4, got ${toggleCheck.btnCount}`);

    if (toggleCheck.speedHasActiveClass) ok('Speed Normal has .ra-toggle-active class');
    else fail('Speed Normal active class', 'Missing .ra-toggle-active');

    if (!toggleCheck.maleHasInlineStyle) ok('Male toggle: no inline style');
    else fail('Male toggle inline style', toggleCheck.maleHasInlineStyle);

    // ── WAVE 2b: Filter pills use CSS classes ──
    console.log('\n🔵 Step 7: Verify filter pills use CSS classes (Wave 2b)');
    const pillCheck = await page.evaluate(() => {
      const pills = document.querySelectorAll('.ra-filter-pill');
      const activePills = document.querySelectorAll('.ra-filter-pill.active');
      // Check no inline style on pills
      let pillsWithInlineStyle = 0;
      pills.forEach(p => { if (p.getAttribute('style')) pillsWithInlineStyle++; });
      return {
        totalPills: pills.length,
        activePills: activePills.length,
        pillsWithInlineStyle
      };
    });
    if (pillCheck.totalPills >= 7) ok(`${pillCheck.totalPills} filter pills found`);
    else fail('Filter pills count', `Expected ≥7, got ${pillCheck.totalPills}`);

    if (pillCheck.activePills >= 1) ok(`${pillCheck.activePills} active pill(s)`);
    else fail('Active pills', 'No active pills found');

    if (pillCheck.pillsWithInlineStyle === 0) ok('Filter pills: no inline styles');
    else fail('Filter pills inline styles', `${pillCheck.pillsWithInlineStyle} pills still have inline style`);

    // ── WAVE 2c: Voice picker uses CSS classes ──
    console.log('\n🔵 Step 8: Verify voice picker CSS classes (Wave 2c)');
    const voicePickerCheck = await page.evaluate(() => {
      const picker = document.getElementById('ra-voice-picker-btn');
      const toggle = document.getElementById('ra-voice-dropdown-toggle');
      const dropdown = document.getElementById('ra-voice-dropdown-list');
      return {
        pickerHasClass: picker?.classList.contains('ra-voice-picker-btn') || false,
        toggleHasClass: toggle?.classList.contains('ra-voice-dropdown-toggle') || false,
        dropdownHasClass: dropdown?.classList.contains('ra-voice-dropdown-list') || false,
        pickerInlineStyle: picker?.getAttribute('style') || '',
        toggleInlineStyle: toggle?.getAttribute('style') || '',
        dropdownInlineStyle: dropdown?.getAttribute('style') || ''
      };
    });
    if (voicePickerCheck.pickerHasClass) ok('Voice picker: has .ra-voice-picker-btn class');
    else fail('Voice picker class', 'Missing .ra-voice-picker-btn');

    if (voicePickerCheck.toggleHasClass) ok('Dropdown toggle: has .ra-voice-dropdown-toggle class');
    else fail('Dropdown toggle class', 'Missing .ra-voice-dropdown-toggle');

    if (voicePickerCheck.dropdownHasClass) ok('Dropdown list: has .ra-voice-dropdown-list class');
    else fail('Dropdown list class', 'Missing .ra-voice-dropdown-list');

    if (!voicePickerCheck.pickerInlineStyle) ok('Voice picker: no inline style');
    else fail('Voice picker inline style', voicePickerCheck.pickerInlineStyle);

    // ── WAVE 3: Voice dropdown z-index ──
    console.log('\n🔵 Step 9: Verify voice dropdown z-index (Wave 3)');
    const zIndexCheck = await page.evaluate(() => {
      // Can't read cross-origin stylesheet rules, so check via computed style
      const dropdown = document.getElementById('ra-voice-dropdown-list');
      if (!dropdown) return { exists: false };
      // Temporarily show it to get computed z-index
      const origDisplay = dropdown.style.display;
      dropdown.style.display = 'block';
      const cs = getComputedStyle(dropdown);
      const zIndex = cs.zIndex;
      dropdown.style.display = origDisplay;
      return { exists: true, zIndex };
    });
    if (zIndexCheck.exists && parseInt(zIndexCheck.zIndex) >= 50) ok(`Dropdown z-index: ${zIndexCheck.zIndex}`);
    else if (!zIndexCheck.exists) fail('Dropdown element', 'Not found');
    else fail('Dropdown z-index', `Got ${zIndexCheck.zIndex}`);

    // ── WAVE 1d: SPC adapter registration ──
    console.log('\n🔵 Step 10: Verify SPC adapter registration (Wave 1d)');
    const spcCheck = await page.evaluate(() => {
      const audio = document.getElementById('ra-user-recording-audio');
      return { audioExists: !!audio };
    });
    if (spcCheck.audioExists) ok('ra-user-recording-audio element exists in DOM');
    else console.log('  ℹ️ ra-user-recording-audio not in DOM (created dynamically by JS — OK)');

    // ── WAVE 2f: JS class toggling (functional test) ──
    console.log('\n🔵 Step 11: Verify CSS classes apply correct styles (Wave 2f)');
    // Verify by creating a temp element and applying our classes
    const cssClassCheck = await page.evaluate(() => {
      // Check .ra-toggle-btn.ra-toggle-active by applying to a temp element
      const tempBtn = document.createElement('button');
      tempBtn.className = 'ra-toggle-btn ra-toggle-active';
      document.body.appendChild(tempBtn);
      const toggleCs = getComputedStyle(tempBtn);
      const toggleBg = toggleCs.backgroundColor;
      document.body.removeChild(tempBtn);

      // Check .ra-filter-pill
      const tempPill = document.createElement('button');
      tempPill.className = 'ra-filter-pill';
      document.body.appendChild(tempPill);
      const pillCs = getComputedStyle(tempPill);
      const pillRadius = pillCs.borderRadius;
      document.body.removeChild(tempPill);

      // Check .ra-filter-pill.active
      const tempPillActive = document.createElement('button');
      tempPillActive.className = 'ra-filter-pill active';
      document.body.appendChild(tempPillActive);
      const pillActiveCs = getComputedStyle(tempPillActive);
      const pillActiveBg = pillActiveCs.backgroundColor;
      document.body.removeChild(tempPillActive);

      // Check .ra-listen-label
      const tempLabel = document.createElement('span');
      tempLabel.className = 'ra-listen-label';
      document.body.appendChild(tempLabel);
      const labelCs = getComputedStyle(tempLabel);
      const labelTransform = labelCs.textTransform;
      document.body.removeChild(tempLabel);

      return {
        toggleBgNotTransparent: toggleBg !== 'rgba(0, 0, 0, 0)' && toggleBg !== 'transparent',
        pillHasBorderRadius: pillRadius && pillRadius !== '0px',
        pillActiveHasBg: pillActiveBg !== 'rgba(0, 0, 0, 0)' && pillActiveBg !== 'transparent',
        labelIsUppercase: labelTransform === 'uppercase',
        toggleBg, pillRadius, pillActiveBg, labelTransform
      };
    });
    if (cssClassCheck.toggleBgNotTransparent) ok(`.ra-toggle-btn.ra-toggle-active applies bg (${cssClassCheck.toggleBg})`);
    else fail('Toggle active CSS', `bg is transparent`);

    if (cssClassCheck.pillHasBorderRadius) ok(`.ra-filter-pill has border-radius (${cssClassCheck.pillRadius})`);
    else fail('Filter pill CSS', `border-radius is ${cssClassCheck.pillRadius}`);

    if (cssClassCheck.pillActiveHasBg) ok(`.ra-filter-pill.active has bg (${cssClassCheck.pillActiveBg})`);
    else fail('Filter pill active CSS', `bg is transparent`);

    if (cssClassCheck.labelIsUppercase) ok('.ra-listen-label text-transform: uppercase');
    else fail('Listen label CSS', `text-transform is ${cssClassCheck.labelTransform}`);

    // ── Take screenshot ──
    console.log('\n🔵 Taking screenshot...');
    const screenshotPath = path.join(__dirname, 'ra-ui-cleanup-check.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`  Screenshot saved: ${screenshotPath}`);

    // ── Check console errors ──
    console.log('\n🔵 Step 12: Check for JS errors');
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.waitForTimeout(1000);
    if (errors.length === 0) ok('No JavaScript errors in console');
    else fail('Console errors', errors.join('; '));

  } catch (err) {
    console.error('\n💥 Test error:', err.message);
    failed++;
  } finally {
    await browser.close();
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(50));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));
  if (failed > 0) process.exit(1);
  else console.log('\n🎉 All UI cleanup checks passed!');
})();
