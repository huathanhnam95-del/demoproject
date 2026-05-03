const { chromium } = require('playwright');
const assert = require('assert');
const {
    readBrowserTestCredentials,
    redactAuthIdentity
} = require('./helpers/browser-test-credentials');

(async () => {
    const credentials = readBrowserTestCredentials();

    console.log('Starting live test for Teacher Scheduler...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.on('console', (msg) => {
        const type = msg.type();
        if (type === 'error' || type === 'warning') {
            console.log(`BROWSER ${type.toUpperCase()}:`, redactAuthIdentity(msg.text(), credentials));
        }
    });

    let stepsCompleted = 0;

    async function isVisible(locator) {
        return locator.isVisible().catch(() => false);
    }

    async function waitForQuickAddOutcome(timeoutMs = 10000) {
        return await Promise.race([
            page.waitForFunction(() => {
                const popover = document.getElementById('teacher-scheduler-quick-add');
                if (!popover) return true;
                const ariaHidden = popover.getAttribute('aria-hidden');
                const display = getComputedStyle(popover).display;
                return ariaHidden === 'true' || display === 'none';
            }, { timeout: timeoutMs }).then(() => 'closed'),
            page.waitForFunction(() => {
                const el = document.getElementById('teacher-scheduler-quick-error');
                return el && getComputedStyle(el).display !== 'none' && el.textContent.trim().length > 0;
            }, { timeout: timeoutMs })
                .then(() => 'error')
        ]);
    }

    try {
        console.log('Navigating to index.html to authenticate safely...');
        await page.goto('https://localhost:8443/index.html', { waitUntil: 'domcontentloaded' });

        console.log('Waiting for auth module to initialize...');
        await page.waitForFunction(() => window.firebaseAuthFunctions && window.firebaseAuthFunctions.signIn, { timeout: 15000 });

        console.log('Executing live Firebase login with the local browser test admin account...');
        const authResult = await page.evaluate(async ({ email, password }) => {
            return await window.firebaseAuthFunctions.signIn(email, password);
        }, credentials);

        if (!authResult || !authResult.success) {
            throw new Error(redactAuthIdentity(`Login failed: ${authResult?.error || 'Unknown error'}`, credentials));
        }

        credentials.uid = await page.evaluate(() => window.firebaseAuthFunctions.getCurrentUser()?.uid || null);

        console.log('Resetting Firestore emulator to keep this check deterministic...');
        const resetRes = await fetch('http://localhost:8080/emulator/v1/projects/listening-tasks-3ae34/databases/(default)/documents', {
            method: 'DELETE'
        });
        if (!resetRes.ok) {
            throw new Error(`Firestore emulator reset failed (status ${resetRes.status}).`);
        }

        console.log('Seeding fake classroom for current admin user BEFORE navigating...');
        await page.evaluate(async () => {
            const user = window.firebaseAuthFunctions.getCurrentUser();
            const token = await user.getIdToken();
            const uid = user.uid;
            const rId = Math.floor(Math.random() * 1000000);

            const apiFetch = async (path, opts = {}) => {
                const res = await fetch(path, {
                    ...opts,
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
                });
                const json = await res.json();
                if (json.success === false) {
                    console.error('API Error for', path, json);
                    throw new Error('API Seeding failed');
                }
                return json;
            };

            await apiFetch('/api/admin/courses', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Test Setup Course ' + rId,
                    code: 'TSO' + rId,
                    status: 'active',
                    defaultSessionMinutes: 60,
                    timezone: 'Asia/Bangkok',
                    totalHours: 20
                })
            });

            const coursesRes = await apiFetch('/api/admin/courses');
            const courseArray = coursesRes.courses || [];
            const courseId = (courseArray[0] && (courseArray[0].id || courseArray[0].courseId)) || 'course-dummy';

            await apiFetch('/api/admin/classrooms', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Teacher Scheduling Test Class ' + rId,
                    courseId: courseId,
                    status: 'active',
                    primaryTeacherUid: uid,
                    scheduleConfig: {
                        sessionMinutes: 60,
                        timezone: 'Asia/Bangkok',
                        durationStepMinutes: 30,
                        totalInstructionMinutes: 120,
                        targetSessionCount: 2
                    }
                })
            });
        });

        console.log('Navigating to crm-admin.html#courses/teacher-schedule...');
        await page.goto('https://localhost:8443/crm-admin.html#courses/teacher-schedule');

        // wait for loading overlay to disappear
        await page.waitForFunction(() => {
            const el = document.querySelector('.crm-loading-overlay');
            return !el || el.style.display === 'none' || el.getAttribute('aria-hidden') === 'true';
        }, { timeout: 30000 });

        // Phase 4.1: Load And Scoping
        console.log('Step 4.1: Checking Workspace load and scoping...');
        await page.waitForSelector('.teacher-scheduler-class-card', { timeout: 15000 });

        await page.screenshot({ path: 'teacher_scheduler_workspace_loaded.png', fullPage: true });
        console.log(' - Screenshot taken: teacher_scheduler_workspace_loaded.png');

        const fromDateValue = await page.locator('#teacher-scheduler-from-date').inputValue();
        const toDateValue = await page.locator('#teacher-scheduler-to-date').inputValue();
        assert(fromDateValue && toDateValue, 'From/To dates should be populated by default.');

        const teacherUidVisible = await page.locator('#scheduler-teacher-filter').isVisible();
        assert(!teacherUidVisible, 'Teacher UID input should be hidden/auto-scoped.');

        await page.locator('#btn-teacher-scheduler-refresh').click();
        await page.waitForTimeout(500); // stable grid
        const classCards = await page.locator('.teacher-scheduler-class-card').count();
        assert(classCards > 0, 'Class rail should render at least 1 classroom.');
        stepsCompleted++;

        // Phase 4.2 Quick Add
        console.log('Step 4.2: Quick Add Popover...');
        const pillsBeforeQuickAdd = await page.locator('.teacher-scheduler-session-pill').count();

        // Prefer opening Quick Add via the session bubble "Duplicate" action:
        // Session pills are absolutely-positioned and can overlap slots, blocking clicks even on visually empty cells.
        if (pillsBeforeQuickAdd > 0) {
            const anyPill = page.locator('.teacher-scheduler-session-pill').first();
            await anyPill.click();
            await page.waitForSelector('#teacher-scheduler-session-bubble[aria-hidden="false"]', { timeout: 10000 });
            await page.locator('#btn-teacher-scheduler-duplicate-session').click();
            await page.waitForSelector('#teacher-scheduler-quick-add[aria-hidden="false"]', { timeout: 10000 });
        } else {
            const emptySlots = page.locator('.teacher-scheduler-slot').filter({
                hasNot: page.locator('.teacher-scheduler-session-pill')
            });
            const emptySlotCount = await emptySlots.count();
            assert(emptySlotCount > 0, 'Expected at least one scheduler slot for quick add.');

            let opened = false;
            for (let i = 0; i < Math.min(emptySlotCount, 25); i++) {
                const slot = emptySlots.nth(i);
                try {
                    await slot.scrollIntoViewIfNeeded();
                    await slot.click({ timeout: 2500 });
                    await page.waitForSelector('#teacher-scheduler-quick-add[aria-hidden="false"]', { timeout: 4000 });
                    opened = true;
                    break;
                } catch (_err) {
                    await page.keyboard.press('Escape').catch(() => { });
                }
            }
            assert(opened, 'Expected to open Quick Add popover from an empty slot.');
        }

        assert(await isVisible(page.locator('#teacher-scheduler-quick-add')), 'Quick Add popover should be visible.');

        // Attempt to add the session. If it fails (conflict / invalid occurrence), apply the first suggested open time and retry.
        await page.locator('#btn-teacher-scheduler-quick-add').click();
        const firstOutcome = await waitForQuickAddOutcome(12000).catch(() => 'timeout');
        if (firstOutcome === 'timeout') {
            throw new Error('Timed out waiting for Quick Add outcome (close or error).');
        }
        if (firstOutcome !== 'closed') {
            const suggestion = await page.evaluate(() => {
                const text = document.getElementById('teacher-scheduler-quick-suggestions')?.textContent || '';
                const matches = Array.from(text.matchAll(/(\\d{4}-\\d{2}-\\d{2})\\s+(\\d{2}:\\d{2})/g));
                if (!matches.length) return null;
                return { date: matches[0][1], time: matches[0][2] };
            });
            assert(suggestion && suggestion.date && suggestion.time,
                'Quick Add should provide at least one open-time suggestion after a conflict.');

            await page.fill('#teacher-scheduler-quick-date', suggestion.date);
            await page.fill('#teacher-scheduler-quick-time', suggestion.time);
            await page.locator('#btn-teacher-scheduler-quick-add').click();
            const secondOutcome = await waitForQuickAddOutcome(15000).catch(() => 'timeout');
            assert(secondOutcome === 'closed', 'Quick Add should succeed after applying a suggested open time.');
        }

        await page.waitForTimeout(750); // wait for session to be placed and loaded
        const pillCountAfterQuickAdd = await page.locator('.teacher-scheduler-session-pill').count();
        assert(pillCountAfterQuickAdd > pillsBeforeQuickAdd, 'Session pill should appear after quick add.');
        stepsCompleted++;

        // Trigger an error-state screenshot (best-effort): try duplicating an existing session into the same slot/time.
        console.log('Capturing duplicate/conflict attempt state (best-effort)...');
        const anyPill = page.locator('.teacher-scheduler-session-pill').first();
        await anyPill.click();
        await page.waitForSelector('#teacher-scheduler-session-bubble[aria-hidden="false"]', { timeout: 10000 });
        await page.locator('#btn-teacher-scheduler-duplicate-session').click();
        await page.waitForSelector('#teacher-scheduler-quick-add[aria-hidden="false"]', { timeout: 10000 });
        await page.locator('#btn-teacher-scheduler-quick-add').click();
        await waitForQuickAddOutcome(8000).catch(() => { });
        await page.screenshot({ path: 'teacher_scheduler_conflict_error.png', fullPage: true });
        console.log(' - Screenshot taken: teacher_scheduler_conflict_error.png');
        if (await isVisible(page.locator('#teacher-scheduler-quick-add'))) {
            await page.locator('#btn-teacher-scheduler-quick-cancel').click();
            await page.waitForFunction(() => {
                const popover = document.getElementById('teacher-scheduler-quick-add');
                if (!popover) return true;
                const ariaHidden = popover.getAttribute('aria-hidden');
                const display = getComputedStyle(popover).display;
                return ariaHidden === 'true' || display === 'none';
            }, { timeout: 10000 });
        }

        // Phase 4.3 Placement mode
        console.log('Step 4.3: Placement Mode (arms/paint)...');
        await page.locator('.teacher-scheduler-class-card').first().click();
        await page.waitForTimeout(200); // arm mode
        await page.locator('.teacher-scheduler-slot').nth(10).click();
        await page.locator('.teacher-scheduler-slot').nth(11).click();
        await page.waitForTimeout(1500); // APIs finish

        await page.keyboard.press('Escape');
        const pillCountAfterPlacement = await page.locator('.teacher-scheduler-session-pill').count();
        assert(pillCountAfterPlacement >= 3, 'Multiple pills should exist after placement mode.');
        stepsCompleted++;

        // Phase 4.4 Weekly pattern
        console.log('Step 4.4: Weekly Pattern...');
        const patternDetails = page.locator('details.teacher-scheduler-pattern-card');
        const patternOpen = await patternDetails.evaluate((el) => Boolean(el.open)).catch(() => false);
        if (!patternOpen) {
            await page.locator('details.teacher-scheduler-pattern-card > summary').click();
        }
        await page.waitForSelector('#teacher-scheduler-pattern-days .teacher-scheduler-day-chip', { timeout: 10000 });

        const dayChips = page.locator('#teacher-scheduler-pattern-days .teacher-scheduler-day-chip');
        await dayChips.nth(1).click(); // Click Monday
        await dayChips.nth(3).click(); // Click Wed
        await page.locator('#btn-teacher-scheduler-place-week').click();
        await page.waitForTimeout(1500);
        stepsCompleted++;

        // Phase 4.5 Activate recurrences
        console.log('Step 4.5: Activate Recurrences...');
        await page.locator('#btn-teacher-scheduler-activate-recurrences').click();
        await page.waitForSelector('#teacher-scheduler-activation-summary', { timeout: 10000 });
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'teacher_scheduler_activation_summary.png' });
        console.log(' - Screenshot taken: teacher_scheduler_activation_summary.png');
        stepsCompleted++;

        // Phase 4.6 & 4.7 Session Drag Drop
        console.log('Step 4.6 & 4.7: Drag drop/reschedule...');
        const calendar = page.locator('#teacher-scheduler-calendar');
        await calendar.scrollIntoViewIfNeeded();
        await page.evaluate(() => {
            const details = document.querySelector('details.teacher-scheduler-pattern-card');
            if (details) details.open = false;
        });
        await page.waitForTimeout(250);
        await calendar.scrollIntoViewIfNeeded();

        const sourcePill = page.locator('.teacher-scheduler-session-pill').first();
        await sourcePill.scrollIntoViewIfNeeded();
        const targetSlot = page.locator('.teacher-scheduler-slot').nth(60);
        await targetSlot.scrollIntoViewIfNeeded();
        await sourcePill.dragTo(targetSlot);
        await page.waitForTimeout(1500); // save
        stepsCompleted++;

        console.log('All automated browser interaction steps successfully completed!');
    } catch (e) {
        console.error('Test script failed at step', stepsCompleted, ':', redactAuthIdentity(e?.stack || e?.message || String(e), credentials));
        console.log('Current URL:', page.url());
        console.log('HTML Dump Start (truncated)----------\n');
        try {
            const html = await page.content();
            const truncated = html.length > 20000 ? `${html.slice(0, 20000)}\n...[truncated]...` : html;
            console.log(redactAuthIdentity(truncated, credentials));
        } catch (contentError) {
            console.log(`[html unavailable: ${contentError.message}]`);
        }
        console.log('\nHTML Dump End (truncated)----------');
        await page.screenshot({ path: 'teacher_scheduler_failure.png', fullPage: true });
        console.log(' - Failure screenshot saved to teacher_scheduler_failure.png');
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();
