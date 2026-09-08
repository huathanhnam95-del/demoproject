'use strict';
// Root runner owns emulator and Chrome execution. No synthetic timing claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const h = require('../../crm/projects/phase9-test-helpers');
const { serveShell, login, selectProject } = require('./phase9-gemini-relay-browser-check');
const { createPerformanceFixture } = require('../../crm/projects/phase10-performance-fixture');
const ROOT = path.resolve(__dirname, '../../..'), OUT = path.join(ROOT, 'test-results/crm-projects/phase10-performance-browser');
const report = { cases: [], console: [], errors: [], network: [], screenshots: [], startedAt: new Date().toISOString(), nativeVoice: { status: 'UNMEASURED', threshold: 'p95 <= 2 seconds', reason: 'No paid/native provider run; synthetic relay timings cannot satisfy this gate' }, methodology: { frames: 'Wheel rAF intervals consume pending trusted input only on actual scrollTop change, without time censoring; drag intervals consume pending moved trusted dragover after trusted dragstart; explicit mode boundaries reset pending input; idle frames excluded', interactions: 'Trusted selection/detail/input event to following double-rAF paint opportunity; not field INP or Web Vitals INP', thresholds: { activeFrameP95Ms: 20, interactionPaintP75Ms: 200 }, tracing: 'Separate pass after timing assertions' } };
const percentile = (values, fraction) => { assert.ok(values.length); return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]; };
async function until(check, label, timeout = 60000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error(`Timeout: ${label}`); }
function instrumentation() {
    const evidence = window.performanceFixture = { collecting: false, frames: [], interactions: [], eventTiming: [], frameMode: null, dragEvents: [], activity: { wheel: 0, dragstart: 0, dragover: 0 }, maximumMountedRows: 0, boundViolations: [], latest: null };
    let previous = 0, pendingWheel = 0, pendingDrag = 0, previousScroll = 0, dragging = false, dragPoint = null, observedRows = null;
    const rows = () => { const scroll = document.getElementById('projects-board-scroll'), mounted = document.querySelectorAll('#projects-board-rows > [data-row-id]').length; if (!scroll) return; const bound = Math.ceil(scroll.clientHeight / 46) + 16 + 3 + 2; evidence.maximumMountedRows = Math.max(evidence.maximumMountedRows, mounted); if (mounted > bound) evidence.boundViolations.push({ mounted, bound }); evidence.latest = { mounted, bound, viewport: scroll.clientHeight, logical: Number(document.getElementById('projects-board-table')?.getAttribute('aria-rowcount')) }; };
    const observer = new MutationObserver(rows);
    evidence.observeRows = () => { rows(); return evidence.latest; };
    evidence.setFrameMode = mode => { evidence.frameMode = mode; pendingWheel = 0; pendingDrag = 0; previousScroll = document.getElementById('projects-board-scroll')?.scrollTop || 0; };
    function frame(timestamp) {
        const scrollTop = document.getElementById('projects-board-scroll')?.scrollTop || 0;
        const mode = evidence.frameMode;
        const activeWheel = mode === 'wheel' && scrollTop !== previousScroll && pendingWheel > 0;
        const activeDrag = mode === 'dragover' && dragging && pendingDrag > 0;
        if (evidence.collecting && previous && (activeWheel || activeDrag)) { evidence.frames.push({ duration: timestamp - previous, mode, scrollTop, previousScroll, pendingInputCount: activeWheel ? pendingWheel : pendingDrag }); if (activeWheel) pendingWheel = 0; if (activeDrag) pendingDrag = 0; }
        rows(); const currentRows = document.getElementById('projects-board-rows'); if (currentRows !== observedRows) { observer.disconnect(); observedRows = currentRows; if (observedRows) observer.observe(observedRows, { childList: true }); }
        previousScroll = scrollTop; previous = timestamp; requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    document.addEventListener('wheel', event => { if (event.isTrusted && event.target.closest('#projects-board-table-wrap') && evidence.collecting && evidence.frameMode === 'wheel') { pendingWheel++; evidence.activity.wheel++; } }, { capture: true, passive: true });
    for (const type of ['dragstart', 'dragover', 'dragend']) document.addEventListener(type, event => {
        if (!event.isTrusted || !evidence.collecting) return;
        const inside = !!event.target.closest('#projects-board-table-wrap');
        if (type === 'dragstart' && inside) { dragging = true; dragPoint = null; evidence.activity.dragstart++; }
        if (type === 'dragend') dragging = false;
        if (type === 'dragover' && inside && dragging) { evidence.activity.dragover++; const point = `${event.clientX}:${event.clientY}`; if (point !== dragPoint && evidence.frameMode === 'dragover') pendingDrag++; dragPoint = point; }
        if (type !== 'dragover' || evidence.dragEvents.length < 30) evidence.dragEvents.push({ type, inside, x: event.clientX, y: event.clientY, at: performance.now() });
    }, { capture: true, passive: true });
    for (const type of ['click', 'keydown', 'input']) document.addEventListener(type, event => {
        if (!event.isTrusted || !evidence.collecting) return; const target = event.target;
        const kind = target.matches('[data-action="select-task"]') && type === 'click' ? 'selection' : target.matches('[data-task-id]') && type === 'keydown' && event.key === 'Enter' ? 'detail' : target.matches('input[data-field-kind="title"]') && type === 'input' ? 'field input' : null;
        if (!kind) return; const started = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => evidence.interactions.push({ kind, duration: performance.now() - started })));
    }, true);
    try { new PerformanceObserver(list => evidence.eventTiming.push(...list.getEntries().map(entry => ({ name: entry.name, duration: entry.duration, interactionId: entry.interactionId })))).observe({ type: 'event', buffered: true, durationThreshold: 16 }); } catch (_) { /* Optional browser API. */ }
}
async function main() {
    fs.mkdirSync(OUT, { recursive: true }); let f, browser, context, page, releaseResponse;
    const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    const shot = async name => { const file = path.join(OUT, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); };
    const run = async (name, work) => { try { await work(); report.cases.push({ name, passed: true }); } catch (error) { report.cases.push({ name, passed: false, error: error.stack }); throw error; } finally { save(); } };
    try {
        f = await h.boot('performance-browser');
        await run('persisted 10000-task/30-column/depth21 fixture integrity before Chrome', async () => { report.fixture = await createPerformanceFixture(f); });
        serveShell(f);
        report.environment = { os: { platform: os.platform(), release: os.release(), arch: os.arch() }, cpu: os.cpus().map(cpu => ({ model: cpu.model, mhz: cpu.speed })), totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), viewport: { width: 1500, height: 1000 }, headless: true, throttling: 'none', sourceHashes: ['public/crm-admin.js', 'public/js/crm/projects/board.js', 'public/js/crm/projects/state.js'].map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex') })) };
        browser = await chromium.launch({ channel: 'chrome', headless: true }); report.environment.chrome = browser.version(); context = await browser.newContext({ viewport: report.environment.viewport, deviceScaleFactor: 1 }); page = await context.newPage(); await page.addInitScript(instrumentation);
        page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.console.push(message.text().replace(/Bearer\s+\S+/g, '[redacted]')); });
        page.on('response', response => { const url = new URL(response.url()); if (url.origin === f.baseUrl && url.pathname.startsWith('/api/projects')) report.network.push({ path: url.pathname, query: { parentTaskId: JSON.parse(url.searchParams.get('filters') || '{}').parentTaskId || null, cursor: url.searchParams.has('cursor') }, status: response.status(), method: response.request().method() }); });
        const loadStarted = Date.now(); await login(page, f.baseUrl, 'owner', f.c.projectId); report.initialLoadMs = Date.now() - loadStarted; report.environment.devicePixelRatio = await page.evaluate(() => devicePixelRatio);
        const scroll = page.locator('#projects-board-scroll'), row = id => page.locator(`[data-task-id="${id}"]`);
        const top = async () => { await scroll.evaluate(node => { node.scrollTop = 0; }); await row('work').waitFor(); };
        await run('real expand and branch pagination expose exactly500 task rows with collapsed9500 reserve', async () => {
            const begin = Date.now(); await row('work').locator('[data-action="toggle-task"]').click(); await until(async () => /480 loaded/.test(await page.locator('#projects-board-count').innerText()), '478 work children loaded');
            await row('work-000').locator('[data-action="toggle-task"]').click();
            for (let index = 0; index < 19; index++) { await scroll.evaluate((node, offset) => { node.scrollTop = offset; }, Math.max(0, (index - 3) * 46)); const expander = row(`chain-${String(index).padStart(2, '0')}`).locator('[data-action="toggle-task"]'); await expander.waitFor(); await expander.click(); }
            await until(async () => /500 loaded/.test(await page.locator('#projects-board-count').innerText()), '500 loaded tasks');
            const logical = Number(await page.locator('#projects-board-table').getAttribute('aria-rowcount')); assert.equal(logical, 502, '500 tasks plus two sections'); report.expandedLoadMs = Date.now() - begin; assert.equal(await page.locator('#projects-board-header > [role="columnheader"]').count(), 35, 'Five base and30custom columns mounted');
            assert.ok(report.network.filter(entry => entry.query.parentTaskId === 'work' && entry.status === 200).length >= 3, 'Actual 200/page requests'); assert.equal(await page.locator('[data-task-id^="reserve-"]').count(), 0); await top(); report.postExpansionDom = await page.evaluate(() => performanceFixture.observeRows()); assert.ok(report.postExpansionDom.mounted <= report.postExpansionDom.bound); await shot('expanded500');
        });
        await run('active trusted wheel and native drag frame intervals p95<=20ms with bounded DOM', async () => {
            await scroll.scrollIntoViewIfNeeded(); const bounds = await scroll.boundingBox();
            await page.evaluate(() => { performanceFixture.collecting = true; performanceFixture.setFrameMode('wheel'); });
            await page.mouse.move(bounds.x + 250, bounds.y + Math.min(180, bounds.height / 2));
            for (let index = 0; index < 1000; index++) {
                await page.mouse.wheel(0, index % 80 < 40 ? 100 : -100); await page.waitForTimeout(8);
                if (index >= 359 && index % 20 === 19 && await page.evaluate(() => performanceFixture.frames.filter(frame => frame.mode === 'wheel').length >= 240)) break;
            }
            assert.ok(await page.evaluate(() => performanceFixture.frames.filter(frame => frame.mode === 'wheel').length >= 200), 'At least200genuine scrolling intervals');
            await page.evaluate(() => { performanceFixture.setFrameMode(null); });
            await scroll.evaluate(node => { node.scrollTop = 23 * 46; }); await row('work-001').waitFor();
            const handle = row('work-001').locator('[data-action="drag-handle"]'); await handle.scrollIntoViewIfNeeded();
            const box = await handle.boundingBox(), target = await row('work-003').boundingBox(), dragBounds = await scroll.boundingBox();
            assert.ok(box && target && dragBounds); report.dragSetup = { source: box, target, viewport: dragBounds };
            await page.evaluate(() => { performanceFixture.setFrameMode('dragover'); });
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
            await page.mouse.move(target.x + 200, target.y + target.height / 2, { steps: 8 });
            await until(async () => await page.evaluate(() => performanceFixture.activity.dragstart > 0), 'trusted native dragstart before sampling', 5000);
            for (let index = 0; index < 90; index++) { await page.mouse.move(dragBounds.x + 200 + index % 5, dragBounds.y + 80 + index % 4 * 45, { steps: 8 }); await page.waitForTimeout(18); }
            await page.keyboard.press('Escape'); await page.mouse.move(10, 10); await page.mouse.up(); await page.evaluate(() => { performanceFixture.setFrameMode(null); });
            const evidence = await page.evaluate(() => performanceFixture); assert.ok(evidence.frames.length >= 200, `Only ${evidence.frames.length} active intervals`); assert.ok(evidence.activity.wheel >= 200); assert.ok(evidence.activity.dragover >= 20); assert.ok(evidence.frames.filter(frame => frame.mode === 'dragover').length >= 20);
            report.frames = { samples: evidence.frames, p95Ms: percentile(evidence.frames.map(frame => frame.duration), 0.95), activity: evidence.activity }; report.dom = { maximumMountedRows: evidence.maximumMountedRows, last: evidence.latest, boundViolations: evidence.boundViolations }; assert.equal(evidence.boundViolations.length, 0); assert.ok(evidence.maximumMountedRows < 100); assert.ok(report.frames.p95Ms <= 20, `Active frame p95 ${report.frames.p95Ms}ms`); report.frames.byMode = Object.fromEntries(['wheel','dragover'].map(mode => [mode, percentile(evidence.frames.filter(frame => frame.mode === mode).map(frame => frame.duration), 0.95)])); for (const [mode, p95] of Object.entries(report.frames.byMode)) assert.ok(p95 <= 20, `${mode} frame p95 ${p95}ms`);
        });
        await run('selection/detail/field event-to-paint opportunity p75<=200ms and optimistic response hold', async () => {
            await top(); const checkbox = row('work').locator('[data-action="select-task"]');
            report.interactionStateChanges = [];
            for (let index = 0; index < 12; index++) {
                const before = await checkbox.isChecked(); await checkbox.click(); assert.equal(await checkbox.isChecked(), !before);
                await page.waitForFunction(expected => window.projectsAssistantController.getState().context.selectedTaskIds.includes('work') === expected, !before);
                const target = index % 2 ? 'work' : 'work-000'; const oldTitle = await page.locator('#projects-board-detail-title').innerText(); assert.notEqual(oldTitle, target, 'Detail action must change the selected task');
                await row(target).focus(); await row(target).press('Enter'); await page.locator('#projects-board-detail').waitFor({ state: 'visible' });
                await page.waitForFunction(expected => document.getElementById('projects-board-detail-title').textContent === expected, target);
                report.interactionStateChanges.push({ selectionBefore: before, selectionAfter: !before, detailBefore: oldTitle, detailAfter: target });
            }
            let held, acknowledged = false; const gate = new Promise(resolve => { releaseResponse = resolve; });
            await page.route(`**/api/projects/${f.c.projectId}/tasks/work`, async route => { if (route.request().method() !== 'PATCH') return route.continue(); const response = await route.fetch(); held = { status: response.status(), payload: route.request().postDataJSON(), receivedAt: Date.now() }; await gate; acknowledged = true; await route.fulfill({ response }); });
            const input = row('work').locator('[data-field-kind="title"]'); await input.fill('Performance optimistic'); await input.pressSequentially(' typed feedback', { delay: 25 }); const expected = await input.inputValue(); await input.press('Tab');
            await until(() => !!held, 'real server mutation response held'); assert.equal(held.status, 200); assert.equal(acknowledged, false); assert.equal(await input.inputValue(), expected); assert.equal(await row('work').evaluate(node => node.classList.contains('is-pending')), true, 'Optimistic pending feedback must precede held acknowledgement'); assert.equal((await f.c.taskData('work')).title, expected);
            report.optimistic = { titleBeforeAcknowledgement: expected, serverPersistedWhileResponseHeld: true, pendingClassBeforeAcknowledgement: true, operationId: held.payload.operationId, holdMs: Date.now() - held.receivedAt }; releaseResponse(); await until(() => acknowledged, 'release acknowledgement'); await page.unroute(`**/api/projects/${f.c.projectId}/tasks/work`);
            await page.waitForFunction(() => !document.querySelector('[data-task-id="work"]')?.classList.contains('is-pending'));
            await checkbox.focus(); const focused = await checkbox.evaluate(node => document.activeElement === node); assert.equal(focused, true); const initialScroll = await scroll.evaluate(node => node.scrollTop); await page.evaluate(() => document.getElementById('btn-projects-board-refresh').click());
            // A full refresh reloads all21expanded branches; this is readiness,
            // separate from the unchanged active-frame and interaction thresholds.
            await page.waitForFunction(() => !document.getElementById('btn-projects-board-refresh').disabled, null, { timeout: 120000 }); assert.equal(await checkbox.evaluate(node => document.activeElement === node), true); assert.equal(await scroll.evaluate(node => node.scrollTop), initialScroll); report.postRefreshDom = await page.evaluate(() => performanceFixture.observeRows()); assert.ok(report.postRefreshDom.mounted <= report.postRefreshDom.bound); assert.equal(await page.evaluate(() => performanceFixture.boundViolations.length), 0, 'Continuous DOM bounds after refresh');
            const hit = await checkbox.evaluate(node => { const rect = node.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node; }); assert.equal(hit, true, 'Overlays must not intercept the focused checkbox');
            await page.evaluate(() => { performanceFixture.collecting = false; }); const evidence = await page.evaluate(() => performanceFixture); report.interactions = { samples: evidence.interactions, p75Ms: percentile(evidence.interactions.map(entry => entry.duration), 0.75), eventTiming: evidence.eventTiming };
            for (const kind of ['selection', 'detail', 'field input']) { const samples = evidence.interactions.filter(entry => entry.kind === kind); assert.ok(samples.length >= 10, `${kind} sample count`); assert.ok(percentile(samples.map(entry => entry.duration), 0.75) <= 200, `${kind} p75`); } assert.ok(report.interactions.p75Ms <= 200); await shot('optimistic-persisted');
        });
        await run('separate native Chrome trace and explicit unmeasured native voice gate', async () => {
            const session = await context.newCDPSession(page); await session.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream' }); const box = await scroll.boundingBox(); await page.mouse.move(box.x + 100, box.y + 100); for (let n = 0; n < 20; n++) await page.mouse.wheel(0, n % 2 ? -80 : 80);
            const complete = new Promise(resolve => session.once('Tracing.tracingComplete', resolve)); await session.send('Tracing.end'); const { stream } = await complete; const chunks = []; let result; do { result = await session.send('IO.read', { handle: stream }); chunks.push(result.base64Encoded ? Buffer.from(result.data, 'base64') : Buffer.from(result.data)); } while (!result.eof); await session.send('IO.close', { handle: stream }); fs.writeFileSync(path.join(OUT, 'chrome-trace.json'), Buffer.concat(chunks)); await session.detach(); assert.equal(report.nativeVoice.status, 'UNMEASURED'); report.trace = 'chrome-trace.json'; await page.reload(); await selectProject(page, f.c.projectId); await until(async () => await row('work').locator('[data-field-kind="title"]').inputValue().catch(() => '') === report.optimistic.titleBeforeAcknowledgement, 'persisted title after reload'); assert.deepEqual(report.errors, [], 'No browser runtime errors');
        });
    } catch (error) { report.failure = error.stack; process.exitCode = 1; if (page) { report.failureEvidence = await page.evaluate(() => window.performanceFixture).catch(() => null); await shot('failure').catch(() => {}); } }
    finally { releaseResponse?.(); await browser?.close(); await f?.close(); report.finishedAt = new Date().toISOString(); save(); }
}
if (require.main === module) main().catch(error => { fs.mkdirSync(OUT, { recursive: true }); report.failure = error.stack; fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2)); process.exitCode = 1; });
module.exports = { percentile };
