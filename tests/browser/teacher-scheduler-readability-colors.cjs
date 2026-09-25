const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { startHarnessServer, createFirebaseStubScript } = require('./crm-scheduler-browser-check');
const { resolveColor } = require('../../functions/src/crm/scheduler-color-service');

(async () => {
    const fixture = await startHarnessServer();
    const { server, origin, state, colorDb } = fixture;
    state.classrooms[0].name = 'Trần Văn Hạnh - PTE Academic 1-1 24h';
    const target = state.sessions.find((s) => s.sessionId === 'session-1');
    target.durationMinutes = 120;
    const untouched = structuredClone(state.sessions);
    const dates = state.sessions.map((s) => s.scheduledLocalDate).sort();
    const output = process.env.SCHEDULER_COLOR_EVIDENCE || path.join(os.tmpdir(), 'scheduler-readability-colors');
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const contexts = [];
    const errors = [];
    async function viewer() {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
        contexts.push(context);
        await context.route('https://www.gstatic.com/firebasejs/**', (route) => route.fulfill({ contentType: 'application/javascript', body: createFirebaseStubScript() }));
        await context.route('http://localhost:11434/**', (route) => route.fulfill({ contentType: 'application/json', body: '{"version":"test"}' }));
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${origin}/crm-admin.html#courses/teacher-schedule`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.teacherSchedulerController?.getState().loaded);
        await page.locator('#teacher-scheduler-range-control').evaluate((el) => { el.open = true; });
        await page.locator('#teacher-scheduler-from-date').fill(dates[0]);
        await page.locator('#teacher-scheduler-to-date').fill(dates.at(-1));
        await page.click('#btn-ts-view-grid');
        await page.click('#btn-teacher-scheduler-refresh');
        await page.waitForSelector('[data-session-id="session-1"].teacher-scheduler-session-pill');
        await page.locator('#teacher-scheduler-range-control').evaluate((el) => { el.open = false; });
        return page;
    }
    const pill = (id) => `.teacher-scheduler-session-pill[data-session-id="${id}"]`;
    const background = (page, id) => page.locator(pill(id)).evaluate((el) => getComputedStyle(el).backgroundColor);
    const bubble = '#teacher-scheduler-session-bubble';
    async function open(page, id = 'session-1') {
        await page.locator(pill(id)).click();
        await page.locator('#teacher-scheduler-color-button').click();
    }
    async function choose(page, color, scope = 'session') {
        await page.locator(`[data-color="${color}"]`).first().click();
        await page.locator(`input[name="ts-color-scope"][value="${scope}"]`).check();
        await page.locator('[data-action="apply"]').click();
        await page.waitForSelector('#teacher-scheduler-color-panel', { state: 'hidden' });
    }
    try {
        const page = await viewer();
        await page.evaluate(() => document.fonts.ready);
        const typography = await page.locator(pill('session-1')).evaluate((el) => {
            const style = (selector) => {
                const node = el.querySelector(selector), css = getComputedStyle(node);
                return { text: node.textContent, family: css.fontFamily, size: css.fontSize, weight: css.fontWeight, lineHeight: css.lineHeight };
            };
            return { title: style('.pill-title'), time: style('.pill-time'), course: style('.pill-course'), teacher: style('.pill-teacher'), label: el.getAttribute('aria-label') };
        });
        assert.equal(typography.title.size, '14px');
        assert.equal(typography.title.weight, '500');
        assert.equal(typography.time.size, '12px');
        assert.equal(typography.title.text, 'Trần Văn Hạnh');
        assert.equal(typography.course.text, 'PTE Academic 1-1 24h');
        assert.ok(typography.label.includes('Trần Văn Hạnh - PTE Academic 1-1 24h'));
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
        const { root } = await cdp.send('DOM.getDocument');
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `${pill('session-1')} .pill-title` });
        const fonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        assert.ok(fonts.fonts.some((font) => font.familyName === 'Roboto'), 'Actual Roboto web font must load');
        assert.equal(await page.locator('#teacher-scheduler-admin-filter-group').isVisible(), false);
        await page.screenshot({ path: path.join(output, 'calendar.png'), fullPage: true });
        const default1 = await background(page, 'session-1'), default2 = await background(page, 'session-2');
        await page.locator(pill('session-1')).click();
        await page.locator('#teacher-scheduler-session-note').fill('Unsaved note must survive colour changes');
        assert.equal(await page.locator('#teacher-scheduler-session-bubble-title').evaluate((el) => getComputedStyle(el).fontSize), '22px');
        await page.locator('#teacher-scheduler-color-button').click();
        await choose(page, '#D50000');
        assert.equal(await background(page, 'session-1'), 'rgb(213, 0, 0)');
        assert.equal(await background(page, 'session-2'), default2);
        assert.equal(await page.locator('#teacher-scheduler-session-note').inputValue(), 'Unsaved note must survive colour changes');
        await page.click('#btn-teacher-scheduler-close-bubble');
        await open(page, 'session-2');
        await choose(page, '#0B8043', 'following');
        assert.equal(await background(page, 'session-1'), 'rgb(213, 0, 0)');
        assert.equal(await background(page, 'session-2'), 'rgb(11, 128, 67)');
        const plan = colorDb.docs.get('crmSchedulerColors/class_class-1');
        assert.equal(resolveColor(plan, { ...target, sessionId: 'new-later', scheduledStartAtUtc: '2099-01-01T02:00:00Z' }), '#0B8043');
        await page.click('#teacher-scheduler-color-button');
        await choose(page, '#039BE5', 'all');
        assert.equal(await background(page, 'session-1'), 'rgb(3, 155, 229)');
        assert.equal(await background(page, 'session-2'), 'rgb(3, 155, 229)');
        await page.click('#btn-teacher-scheduler-close-bubble');
        await open(page);
        await page.click('[data-action="default"]');
        await page.click('[data-action="apply"]');
        await page.waitForSelector('#teacher-scheduler-color-panel', { state: 'hidden' });
        assert.equal(await background(page, 'session-1'), default1);
        assert.equal(await background(page, 'session-2'), 'rgb(3, 155, 229)');

        await page.click('#teacher-scheduler-color-button');
        await page.locator('.ts-color-custom summary').click();
        await page.selectOption('[data-field="preset"]', '#D50000');
        await page.fill('[data-field="label"]', 'Nghỉ học');
        await page.route('**/api/teacher/scheduler/color-tags', async (route) => {
            await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Simulated save failure"}' });
        }, { times: 1 });
        await page.click('[data-action="tag"]');
        await page.waitForFunction(() => document.querySelector('.ts-color-error')?.textContent.includes('Simulated'));
        assert.equal(await page.inputValue('[data-field="label"]'), 'Nghỉ học');
        await page.click('[data-action="tag"]');
        await page.waitForSelector('.ts-color-tags button[data-color="#D50000"]');
        const second = await viewer();
        await open(second);
        assert.equal(await second.locator('.ts-color-tags button[data-color="#D50000"]').textContent(), 'Nghỉ học');
        await choose(second, '#E4C441', 'all');
        // First viewer still has the old plan: the server rejects an unreviewed overwrite.
        await page.locator('.ts-color-tags button[data-color="#D50000"]').click();
        await page.click('[data-action="apply"]');
        await page.waitForFunction(() => document.querySelector('.ts-color-error')?.textContent.includes('someone else'));
        assert.equal(await page.locator('#teacher-scheduler-session-note').inputValue(), 'Unsaved note must survive colour changes');
        await page.click('[data-action="refresh"]');
        await page.waitForSelector('.ts-color-swatches');
        await page.screenshot({ path: path.join(output, 'colour-picker.png'), fullPage: true });
        await page.locator('.ts-color-tags button[data-color="#D50000"]').click();
        await page.screenshot({ path: path.join(output, 'scope-prompt.png'), fullPage: true });
        await page.keyboard.press('Escape');
        assert.equal(await page.locator(bubble).isVisible(), true, 'Escape closes the picker first');

        // Delayed success must not replace another session's active editor or its note.
        let release;
        const hold = new Promise((resolve) => { release = resolve; });
        await page.route('**/api/teacher/sessions/session-1/color', async (route) => { await hold; await route.continue(); });
        await page.click('#teacher-scheduler-color-button');
        await page.locator('.ts-color-tags button[data-color="#D50000"]').click();
        await page.click('[data-action="apply"]');
        await page.click('#btn-teacher-scheduler-close-bubble');
        await page.locator(pill('session-2')).click();
        await page.fill('#teacher-scheduler-session-note', 'Different session draft');
        release();
        await page.waitForFunction(() => window.teacherSchedulerController.getState().colorPlans['class-1'].revision === 6);
        assert.equal(await page.locator('#teacher-scheduler-session-note').inputValue(), 'Different session draft');
        assert.equal(await page.locator('#teacher-scheduler-color-panel').isVisible(), false);
        await page.unroute('**/api/teacher/sessions/session-1/color');

        // An old workspace read must not roll back the colour just saved by this viewer.
        let releaseRead, readCaptured;
        const oldRead = new Promise((resolve) => { releaseRead = resolve; });
        const capturedRead = new Promise((resolve) => { readCaptured = resolve; });
        await page.route('**/api/teacher/scheduler/workspace?*', async (route) => {
            const response = await route.fetch();
            readCaptured();
            await oldRead;
            await route.fulfill({ response });
        }, { times: 1 });
        const refresh = page.evaluate(() => window.teacherSchedulerController.refresh());
        await capturedRead;
        await page.click('#teacher-scheduler-color-button');
        await choose(page, '#8E24AA');
        releaseRead();
        await refresh;
        assert.equal(await background(page, 'session-2'), 'rgb(142, 36, 170)');

        // A committed save whose response is delayed must not replace a newer server revision.
        let releaseSave, saveCaptured;
        const oldSave = new Promise((resolve) => { releaseSave = resolve; });
        const capturedSave = new Promise((resolve) => { saveCaptured = resolve; });
        await page.route('**/api/teacher/sessions/session-2/color', async (route) => {
            const response = await route.fetch();
            saveCaptured();
            await oldSave;
            await route.fulfill({ response });
        }, { times: 1 });
        await page.click('#teacher-scheduler-color-button');
        await page.locator('[data-color="#D50000"]').first().click();
        await page.click('[data-action="apply"]');
        await capturedSave;
        const newer = await second.request.post(`${origin}/api/teacher/sessions/session-2/color`, { data: { color: '#009688', scope: 'all', expectedRevision: 8 } });
        assert.equal(newer.status(), 200);
        await page.evaluate(() => window.teacherSchedulerController.refresh());
        releaseSave();
        await page.waitForSelector('#teacher-scheduler-color-panel', { state: 'hidden' });
        assert.equal(await background(page, 'session-2'), 'rgb(0, 150, 136)');
        assert.equal(await page.evaluate(() => window.teacherSchedulerController.getState().colorPlans['class-1'].revision), 9);

        await page.setViewportSize({ width: 360, height: 800 });
        await page.click('#btn-ts-sidebar-toggle');
        await page.locator(pill('session-2')).scrollIntoViewIfNeeded();
        await open(page, 'session-2');
        await page.locator('.ts-color-tags button[data-color="#D50000"]').click();
        assert.equal(await page.locator(bubble).isVisible(), true);
        const fit = await page.locator(bubble).evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth, rect: el.getBoundingClientRect().toJSON() }));
        assert.ok(fit.width > 250);
        assert.ok(fit.scroll <= fit.width + 1, 'Detail and scope content fits narrow viewport');
        assert.ok(fit.rect.width <= 360);
        await page.screenshot({ path: path.join(output, 'narrow-details.png'), fullPage: true });
        assert.deepEqual(state.sessions, untouched, 'Colour changes must not write schedule or attendance records');
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(output, 'typography.json'), JSON.stringify({ typography, fonts, fit }, null, 2));
        console.log(`Chrome readability and shared colour flows passed. Evidence: ${output}`);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
