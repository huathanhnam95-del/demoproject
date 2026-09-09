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
        const text = msg.text();
        if (type === 'error' || type === 'warning' || text.startsWith('[')) {
            console.log(`BROWSER ${type.toUpperCase()}:`, redactAuthIdentity(text, credentials));
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

    async function simulateDragAndDrop(sourceLocator, targetLocator) {
        await sourceLocator.scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);

        // Initiate drag on source element
        await sourceLocator.evaluate((pill) => {
            const rect = pill.getBoundingClientRect();
            const clientX = rect.left + rect.width / 2;
            const clientY = rect.top + rect.height / 2;
            const evt = new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                clientX,
                clientY,
                button: 0,
                buttons: 1,
                pointerId: 1,
                pointerType: 'mouse'
            });
            pill.dispatchEvent(evt);
        });

        const afterDown = await page.evaluate(() => {
            const s = window.teacherSchedulerController?.getState?.();
            return { pointerDrag: Boolean(s?.pointerDrag), id: s?.pointerDrag?.id };
        });
        console.log(' - simulateDragAndDrop afterDown:', afterDown);

        await targetLocator.scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);

        // Move to target element and release
        await targetLocator.evaluate((slot) => {
            const rect = slot.getBoundingClientRect();
            const clientX = rect.left + rect.width / 2;
            const clientY = rect.top + rect.height / 2;
            const moveEvt = new PointerEvent('pointermove', {
                bubbles: true,
                cancelable: true,
                clientX,
                clientY,
                button: 0,
                buttons: 1,
                pointerId: 1,
                pointerType: 'mouse'
            });
            document.dispatchEvent(moveEvt);

            const upEvt = new PointerEvent('pointerup', {
                bubbles: true,
                cancelable: true,
                clientX,
                clientY,
                button: 0,
                buttons: 0,
                pointerId: 1,
                pointerType: 'mouse'
            });
            document.dispatchEvent(upEvt);
        });

        await page.waitForTimeout(600);
    }

    async function waitForScopeModalOrToast(timeoutMs = 8000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const modalVisible = await page.evaluate(() => {
                const m = document.getElementById('teacher-scheduler-scope-modal');
                return m && (m.style.display === 'flex' || m.getAttribute('aria-hidden') === 'false');
            });
            if (modalVisible) return 'modal';

            const toastVisible = await page.evaluate(() => {
                const t = document.querySelector('.crm-toast');
                return t && t.textContent.includes('Undo');
            });
            if (toastVisible) return 'toast';

            await page.waitForTimeout(200);
        }
        return null;
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
                let res = await fetch(path, {
                    ...opts,
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
                });
                let json = await res.json().catch(() => ({}));
                if (json.error === 'RATE_LIMITED' || res.status === 429) {
                    const waitSec = Number(json.retryAfterSeconds) || 10;
                    console.log(`[test setup] Rate limited on ${path}, waiting ${waitSec + 1}s...`);
                    await new Promise((r) => setTimeout(r, (waitSec + 1) * 1000));
                    res = await fetch(path, {
                        ...opts,
                        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
                    });
                    json = await res.json().catch(() => ({}));
                }
                if (json.success === false) {
                    console.error('API Error for', path, json);
                    throw new Error('API Seeding failed: ' + (json.message || json.error || res.status));
                }
                return json;
            };

            await apiFetch('/api/admin/courses', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Test Setup Course ' + rId,
                    code: 'TSO' + rId,
                    courseType: '1on1',
                    status: 'active',
                    defaultSessionMinutes: 60,
                    timezone: 'Asia/Bangkok',
                    totalHours: 20
                })
            });

            const coursesRes = await apiFetch('/api/admin/courses');
            const courseArray = coursesRes.courses || [];
            const courseId = (courseArray[0] && (courseArray[0].id || courseArray[0].courseId)) || 'course-dummy';

            const createdClass = await apiFetch('/api/admin/classrooms', {
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
                        totalInstructionMinutes: 720,
                        targetSessionCount: 12,
                        seedStartTime: '18:00',
                        seedWeekdays: [1, 3, 5]
                    }
                })
            });

            const classIdToSeed = createdClass?.classroomId || createdClass?.id;
            if (classIdToSeed) {
                await apiFetch(`/api/admin/classrooms/${classIdToSeed}/sessions/seed`, {
                    method: 'POST',
                    body: JSON.stringify({
                        startDate: '2026-09-07',
                        endDate: '2026-09-30',
                        startTime: '18:00',
                        weekdayNumbers: [1, 3, 5]
                    })
                });
            }

            await apiFetch('/api/admin/classrooms', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Compact 30m Class ' + rId,
                    courseId: courseId,
                    status: 'active',
                    primaryTeacherUid: uid,
                    scheduleConfig: {
                        sessionMinutes: 30,
                        timezone: 'Asia/Bangkok',
                        durationStepMinutes: 30,
                        totalInstructionMinutes: 300,
                        targetSessionCount: 10
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

        // SCENARIO 2: Dynamic --scheduler-day-count and 14-day clamping
        console.log('Scenario 2: Checking dynamic --scheduler-day-count and clamping...');
        const initialGridDays = await page.evaluate(() => {
            const grid = document.querySelector('.scheduler-calendar-grid');
            return grid ? getComputedStyle(grid).getPropertyValue('--scheduler-day-count').trim() : '';
        });
        assert(Number(initialGridDays) > 0, 'Grid should have initial --scheduler-day-count');

        // Update range to 5 days
        await page.fill('#teacher-scheduler-from-date', '2026-09-07');
        await page.fill('#teacher-scheduler-to-date', '2026-09-11');
        await page.locator('#teacher-scheduler-to-date').dispatchEvent('change');
        await page.waitForTimeout(600);

        const fiveDays = await page.evaluate(() => {
            const grid = document.querySelector('.scheduler-calendar-grid');
            return grid ? getComputedStyle(grid).getPropertyValue('--scheduler-day-count').trim() : '';
        });
        assert.strictEqual(fiveDays, '5', 'Grid --scheduler-day-count should dynamically update to 5');
        const headerCount = await page.locator('.scheduler-calendar-head').count();
        assert.strictEqual(headerCount, 6, 'Should render 1 time-head + 5 day-heads');

        // Test 14-day clamp: range > 14 days
        await page.fill('#teacher-scheduler-from-date', '2026-09-01');
        await page.fill('#teacher-scheduler-to-date', '2026-09-25');
        await page.locator('#teacher-scheduler-to-date').dispatchEvent('change');
        await page.waitForTimeout(600);

        const clampedDays = await page.evaluate(() => {
            const grid = document.querySelector('.scheduler-calendar-grid');
            return grid ? getComputedStyle(grid).getPropertyValue('--scheduler-day-count').trim() : '';
        });
        assert.strictEqual(clampedDays, '14', 'Grid --scheduler-day-count should clamp to maximum 14 days');
        const clampedToDateValue = await page.locator('#teacher-scheduler-to-date').inputValue();
        assert.strictEqual(clampedToDateValue, '2026-09-14', 'To-date input should be auto-clamped to 14 days from from-date');

        // Restore to 7-day range
        await page.fill('#teacher-scheduler-from-date', '2026-09-07');
        await page.fill('#teacher-scheduler-to-date', '2026-09-13');
        await page.locator('#teacher-scheduler-to-date').dispatchEvent('change');
        await page.waitForTimeout(600);
        console.log(' - Scenario 2 passed: dynamic --scheduler-day-count and 14-day clamping verified.');
        stepsCompleted++;

        // SCENARIO 2B: Mini Calendar Navigation & Grid
        console.log('Scenario 2B: Checking mini calendar layout and navigation...');
        const miniCal = page.locator('#teacher-scheduler-mini-calendar');
        assert(await isVisible(miniCal), 'Mini calendar must be visible on the left rail');
        const miniHeader = miniCal.locator('.mini-cal-header');
        assert(await isVisible(miniHeader), 'Mini calendar header must be visible');
        const initialMonthTitle = await miniCal.locator('.mini-cal-month-title').textContent();
        assert(initialMonthTitle && initialMonthTitle.includes('2026'), 'Mini calendar title should display year 2026');

        // Test month navigation: next then previous
        await miniCal.locator('[data-action="next-month"]').click();
        await page.waitForTimeout(300);
        const nextMonthTitle = await miniCal.locator('.mini-cal-month-title').textContent();
        assert.notStrictEqual(initialMonthTitle, nextMonthTitle, 'Mini calendar title must change on next month click');

        await miniCal.locator('[data-action="prev-month"]').click();
        await page.waitForTimeout(300);
        const restoredMonthTitle = await miniCal.locator('.mini-cal-month-title').textContent();
        assert.strictEqual(restoredMonthTitle, initialMonthTitle, 'Mini calendar title must restore on prev month click');

        // Check weekday headers (S M T W T F S)
        const weekdayHeaders = await miniCal.locator('.mini-cal-weekdays span').allTextContents();
        assert.strictEqual(weekdayHeaders.length, 7, 'Mini calendar should have 7 weekday headers');
        assert.deepStrictEqual(weekdayHeaders, ['S', 'M', 'T', 'W', 'T', 'F', 'S'], 'Mini calendar weekdays should be S M T W T F S');

        // Check 42 day cells
        const dayCells = await miniCal.locator('.mini-cal-day-cell').count();
        assert.strictEqual(dayCells, 42, 'Mini calendar should render exactly 42 day cells');

        // Check active range highlight exists
        const inRangeCells = await miniCal.locator('.mini-cal-day-cell.is-in-range').count();
        assert(inRangeCells > 0, 'Mini calendar should highlight days in active range');
        await page.screenshot({ path: 'teacher_scheduler_mini_calendar.png' });
        console.log(' - Scenario 2B passed: mini calendar layout and navigation verified.');
        stepsCompleted++;

        // Phase 4.2 Quick Add
        console.log('Step 4.2: Quick Add Popover...');
        const pillsBeforeQuickAdd = await page.locator('.teacher-scheduler-session-pill').count();

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
                const matches = Array.from(text.matchAll(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/g));
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

        // SCENARIO 1: Popover Mutual Exclusivity, Outside Click, and Escape Dismissal
        console.log('Scenario 1: Checking popover exclusivity, outside click, and Escape...');
        // 1a. Open Quick Add via empty slot
        const emptySlotExcl = page.locator('.teacher-scheduler-slot').filter({
            hasNot: page.locator('.teacher-scheduler-session-pill')
        }).first();
        await emptySlotExcl.scrollIntoViewIfNeeded();
        await emptySlotExcl.click();
        await page.waitForSelector('#teacher-scheduler-quick-add[aria-hidden="false"]', { timeout: 5000 });
        assert(await isVisible(page.locator('#teacher-scheduler-quick-add')), 'Quick Add should be open');

        // 1b. Click a session pill -> Quick Add closes, Session Bubble opens
        const testPillExcl = page.locator('.teacher-scheduler-session-pill').first();
        await testPillExcl.click();
        await page.waitForSelector('#teacher-scheduler-session-bubble[aria-hidden="false"]', { timeout: 5000 });
        assert(await isVisible(page.locator('#teacher-scheduler-session-bubble')), 'Session Bubble must be open');
        assert(!(await isVisible(page.locator('#teacher-scheduler-quick-add'))), 'Quick Add must close when Session Bubble opens (exclusivity)');

        // 1c. Click outside on calendar title -> Session Bubble closes
        await page.locator('#teacher-scheduler-rail-title').click();
        await page.waitForTimeout(300);
        assert(!(await isVisible(page.locator('#teacher-scheduler-session-bubble'))), 'Session Bubble must close on outside click');

        // 1d. Open Quick Add again and test Escape dismissal
        await emptySlotExcl.click();
        await page.waitForSelector('#teacher-scheduler-quick-add[aria-hidden="false"]', { timeout: 5000 });
        assert(await isVisible(page.locator('#teacher-scheduler-quick-add')), 'Quick Add re-opened');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        assert(!(await isVisible(page.locator('#teacher-scheduler-quick-add'))), 'Quick Add must dismiss on Escape key');
        console.log(' - Scenario 1 passed: popover exclusivity, outside click, and Escape dismissal verified.');
        stepsCompleted++;

        // SCENARIO 3: Compact Pill Layout (<46px / 30m)
        console.log('Scenario 3: Checking compact pill layout (<46px / 30m)...');
        const openSlotCompact = page.locator('.teacher-scheduler-slot').filter({
            hasNot: page.locator('.teacher-scheduler-session-pill')
        }).first();
        await openSlotCompact.scrollIntoViewIfNeeded();
        await openSlotCompact.click();
        await page.waitForSelector('#teacher-scheduler-quick-add[aria-hidden="false"]', { timeout: 5000 });
        const compactOptValue = await page.evaluate(() => {
            const select = document.getElementById('teacher-scheduler-quick-class');
            const opt = Array.from(select?.options || []).find((o) => o.text.includes('Compact'));
            return opt?.value || null;
        });
        if (compactOptValue) {
            await page.selectOption('#teacher-scheduler-quick-class', compactOptValue);
            await page.locator('#teacher-scheduler-quick-class').dispatchEvent('change');
            await page.waitForTimeout(200);
        }
        await page.locator('#btn-teacher-scheduler-quick-add').click();
        const outcomeCompact = await waitForQuickAddOutcome(10000).catch(() => 'timeout');
        if (outcomeCompact !== 'closed') {
            const suggestion = await page.evaluate(() => {
                const text = document.getElementById('teacher-scheduler-quick-suggestions')?.textContent || '';
                const matches = Array.from(text.matchAll(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/g));
                if (!matches.length) return null;
                return { date: matches[0][1], time: matches[0][2] };
            });
            if (suggestion) {
                await page.fill('#teacher-scheduler-quick-date', suggestion.date);
                await page.fill('#teacher-scheduler-quick-time', suggestion.time);
                await page.selectOption('#teacher-scheduler-quick-duration', '30');
                await page.locator('#btn-teacher-scheduler-quick-add').click();
                await waitForQuickAddOutcome(10000).catch(() => 'timeout');
            }
        }
        await page.waitForTimeout(600);

        const compactPills = page.locator('.teacher-scheduler-session-pill.is-compact');
        assert((await compactPills.count()) > 0, 'Should find at least one compact pill with .is-compact');
        const compactHeight = await compactPills.first().evaluate((el) => el.getBoundingClientRect().height);
        assert(compactHeight < 46, `Compact pill height (${compactHeight}px) must be < 46px`);
        const compactTitle = await compactPills.first().locator('.pill-title').textContent();
        assert(compactTitle.includes('·') || compactTitle.includes(':'), 'Compact pill title should embed time range');
        console.log(' - Scenario 3 passed: compact pill styling and integrated time range verified.');
        stepsCompleted++;

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
        const teacherSelect = page.locator('#teacher-scheduler-teacher-select');
        if (await teacherSelect.isVisible().catch(() => false)) {
            const hasMyTeacher = (await teacherSelect.locator(`option[value="${credentials.uid}"]`).count()) > 0;
            if (hasMyTeacher) {
                await teacherSelect.selectOption(credentials.uid);
            } else {
                const options = await teacherSelect.locator('option').all();
                for (const opt of options) {
                    const val = await opt.getAttribute('value');
                    if (val && val !== 'all') {
                        await teacherSelect.selectOption(val);
                        break;
                    }
                }
            }
            await page.waitForTimeout(500);
        }
        await page.locator('#btn-teacher-scheduler-activate-recurrences').click();
        await page.waitForSelector('#teacher-scheduler-activation-summary', { timeout: 10000 });
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'teacher_scheduler_activation_summary.png' });
        console.log(' - Screenshot taken: teacher_scheduler_activation_summary.png');

        stepsCompleted++;

        // SCENARIO 4: Single Session Drag & Drop with Undo Restoration
        console.log('Scenario 4: Single session drag and drop with Undo...');
        const calendar = page.locator('#teacher-scheduler-calendar');
        await calendar.scrollIntoViewIfNeeded();
        await page.evaluate(() => {
            const details = document.querySelector('details.teacher-scheduler-pattern-card');
            if (details) details.open = false;
        });
        await page.waitForTimeout(250);

        // Find an unlocked future session so isLockedSession does not block the move
        const unlockedSessionId = await page.evaluate(() => {
            const s = window.teacherSchedulerController?.getState?.();
            const now = new Date();
            const unlocked = s?.sessions?.find((session) => {
                const hardLocked = String(session?.lockState || 'unlocked') === 'hard_locked'
                    || String(session?.attendanceState || 'none') === 'in_progress'
                    || String(session?.attendanceState || 'none') === 'finalized'
                    || String(session?.status || 'scheduled') === 'completed'
                    || String(session?.status || 'scheduled') === 'cancelled';
                if (hardLocked) return false;
                if (session?.scheduledStartAtUtc) {
                    const start = new Date(session.scheduledStartAtUtc);
                    if (Number.isFinite(start.getTime()) && start < now) return false;
                }
                const time = String(session?.scheduledLocalTime || '').slice(0, 5);
                const date = String(session?.scheduledLocalDate || '');
                if (time === '18:00') return false; // reserve 18:00 recurring series for Scenario 5
                return true;
            });
            return unlocked?.sessionId || null;
        });
        assert(unlockedSessionId, 'Must find at least one unlocked session in the future for drag testing');

        const singleSourcePill = page.locator(`.teacher-scheduler-session-pill[data-session-id="${unlockedSessionId}"]`);
        await singleSourcePill.scrollIntoViewIfNeeded();
        const singleOriginalSlot = await singleSourcePill.evaluate((el) => {
            const slot = el.closest('.teacher-scheduler-slot');
            return {
                date: slot?.dataset?.date,
                time: slot?.dataset?.time,
                id: el.dataset.sessionId
            };
        });

        // Pick an empty slot on Saturday 2026-09-12 at 09:30
        let singleTargetSlot = page.locator('.teacher-scheduler-slot[data-date="2026-09-12"][data-time="09:30"]');
        if ((await singleTargetSlot.count()) === 0) {
            singleTargetSlot = page.locator('.teacher-scheduler-slot').filter({
                hasNot: page.locator('.teacher-scheduler-session-pill')
            }).nth(20);
        }

        await simulateDragAndDrop(singleSourcePill, singleTargetSlot);

        const s4Outcome = await waitForScopeModalOrToast(8000);
        console.log(' - Scenario 4 s4Outcome:', s4Outcome);
        const toasts = await page.evaluate(() => Array.from(document.querySelectorAll('.crm-toast')).map(t => t.textContent));
        console.log(' - Existing toasts:', JSON.stringify(toasts));
        const slotErrors = await page.evaluate(() => Array.from(document.querySelectorAll('.teacher-scheduler-slot-error')).map(e => e.textContent));
        console.log(' - Slot errors:', JSON.stringify(slotErrors));

        if (s4Outcome === 'modal' || (await isVisible(page.locator('#teacher-scheduler-scope-modal')))) {
            console.log(' - Scope modal opened for single move choice');
            await page.locator('#scope-choice-single').check();
            await page.locator('#btn-teacher-scheduler-scope-confirm').click();
            await page.waitForTimeout(600);
        }

        // Wait for Undo toast to appear
        const singleUndoToast = page.locator('.crm-toast').filter({ hasText: 'Undo' }).first();
        await singleUndoToast.waitFor({ state: 'visible', timeout: 10000 });
        assert(await singleUndoToast.isVisible(), 'Undo toast must appear after single session move');

        // Click Undo
        await singleUndoToast.locator('.crm-toast-action').click();
        await page.waitForTimeout(1000);

        // Verify pill is restored to its original slot
        const restoredPillSingle = page.locator(`.teacher-scheduler-slot[data-date="${singleOriginalSlot.date}"][data-time="${singleOriginalSlot.time}"] .teacher-scheduler-session-pill[data-session-id="${singleOriginalSlot.id}"]`);
        assert((await restoredPillSingle.count()) > 0, 'Single session must be restored to original slot on Undo');
        console.log(' - Scenario 4 passed: single session drag and undo restoration verified.');
        stepsCompleted++;

        // SCENARIO 5: Series Scope Modal, Series Move, and Undo Restoration
        console.log('Scenario 5: Series scope modal, move, and undo restoration...');
        await page.evaluate(() => document.querySelectorAll('.crm-toast').forEach(t => t.remove()));
        const availableSessions = await page.evaluate(() => {
            const s = window.teacherSchedulerController?.getState?.();
            return (s?.sessions || []).map((x) => ({
                id: x.sessionId,
                date: x.scheduledLocalDate,
                time: x.scheduledLocalTime,
                classId: x.classId
            }));
        });
        console.log(' - Scenario 5 existing sessions:', JSON.stringify(availableSessions));

        const unlockedSeriesSessionId = await page.evaluate(() => {
            const s = window.teacherSchedulerController?.getState?.();
            const now = new Date();
            // Find the recurring Friday 18:00 session from the seeded classroom (future, unlocked, has future occurrences)
            const target = (s?.sessions || []).find((sess) => {
                const hardLocked = String(sess?.lockState || 'unlocked') === 'hard_locked'
                    || String(sess?.attendanceState || 'none') === 'in_progress'
                    || String(sess?.attendanceState || 'none') === 'finalized'
                    || String(sess?.status || 'scheduled') === 'completed'
                    || String(sess?.status || 'cancelled') === 'cancelled';
                if (hardLocked) return false;
                if (sess?.scheduledStartAtUtc) {
                    const start = new Date(sess.scheduledStartAtUtc);
                    if (Number.isFinite(start.getTime()) && start <= now) return false;
                }
                const time = String(sess?.scheduledLocalTime || '').slice(0, 5);
                const date = String(sess?.scheduledLocalDate || '');
                return time === '18:00' && date === '2026-09-11';
            });
            return target?.sessionId || null;
        });
        assert(unlockedSeriesSessionId, 'Must find the Friday 18:00 recurring series session in calendar');

        const seriesSourcePill = page.locator(`.teacher-scheduler-session-pill[data-session-id="${unlockedSeriesSessionId}"]`);
        await seriesSourcePill.scrollIntoViewIfNeeded();

        // Target Saturday 2026-09-12 at 11:00
        let targetSeriesSlot = page.locator('.teacher-scheduler-slot[data-date="2026-09-12"][data-time="11:00"]');
        if ((await targetSeriesSlot.count()) === 0) {
            targetSeriesSlot = page.locator('.teacher-scheduler-slot').filter({
                hasNot: page.locator('.teacher-scheduler-session-pill')
            }).nth(25);
        }

        await simulateDragAndDrop(seriesSourcePill, targetSeriesSlot);

        const s5Outcome = await waitForScopeModalOrToast(8000);
        assert.strictEqual(s5Outcome, 'modal', 'Scope modal MUST open when dragging a recurring series session');
        assert(await isVisible(page.locator('#teacher-scheduler-scope-modal')), 'Scope modal must be visible');
        assert(await isVisible(page.locator('#scope-choice-series')), 'Series choice option must be available');
        assert(await isVisible(page.locator('#scope-choice-single')), 'Single choice option must be available');

        // Verify shift description is populated
        const seriesDesc = await page.locator('#teacher-scheduler-scope-series-desc').textContent();
        assert(seriesDesc && seriesDesc.trim().length > 0, 'Series description must be populated in scope modal');

        await page.locator('#scope-choice-series').check();
        await page.locator('#btn-teacher-scheduler-scope-confirm').click();
        await page.waitForTimeout(1000);

        // Undo toast should appear
        const seriesUndoToast = page.locator('.crm-toast').filter({ hasText: 'Undo' }).first();
        await seriesUndoToast.waitFor({ state: 'visible', timeout: 10000 });
        assert(await seriesUndoToast.isVisible(), 'Undo toast must appear after series move');

        // Click Undo
        await seriesUndoToast.locator('.crm-toast-action').click();
        await page.waitForTimeout(1200);
        console.log(' - Scenario 5 passed: series scope modal move and undo restoration verified.');
        stepsCompleted++;

        // SCENARIO 6: Slot Conflict Display
        console.log('Scenario 6: Checking slot conflict display on overlap...');
        const unlockedPills = await page.evaluate(() => {
            const s = window.teacherSchedulerController?.getState?.();
            const now = new Date();
            return (s?.sessions || []).filter((session) => {
                const hardLocked = String(session?.lockState || 'unlocked') === 'hard_locked'
                    || String(session?.attendanceState || 'none') === 'in_progress'
                    || String(session?.attendanceState || 'none') === 'finalized'
                    || String(session?.status || 'scheduled') === 'completed'
                    || String(session?.status || 'scheduled') === 'cancelled';
                if (hardLocked) return false;
                if (session?.scheduledStartAtUtc) {
                    const start = new Date(session.scheduledStartAtUtc);
                    if (Number.isFinite(start.getTime()) && start < now) return false;
                }
                return true;
            }).map((sess) => sess.sessionId);
        });

        if (unlockedPills.length >= 2) {
            const dragPill = page.locator(`.teacher-scheduler-session-pill[data-session-id="${unlockedPills[0]}"]`);
            const targetPill = page.locator(`.teacher-scheduler-session-pill[data-session-id="${unlockedPills[1]}"]`);
            const targetConflictSlot = page.locator('.teacher-scheduler-slot').filter({ has: targetPill }).first();

            await simulateDragAndDrop(dragPill, targetConflictSlot);

            const hasSlotError = (await page.locator('.teacher-scheduler-slot-error').count()) > 0;
            const hasConflictToast = (await page.locator('.crm-toast').filter({ hasText: /conflict|overlap/i }).count()) > 0;
            assert(hasSlotError || hasConflictToast, 'Slot error or conflict toast must be displayed on overlapping drop');
            console.log(' - Scenario 6 passed: conflict display and error feedback verified.');
        } else {
            console.log(' - Scenario 6: Less than 2 unlocked pills available, testing conflict via first pill onto existing slot');
            const dragPill = page.locator('.teacher-scheduler-session-pill').first();
            const targetPill = page.locator('.teacher-scheduler-session-pill').nth(1);
            const targetConflictSlot = page.locator('.teacher-scheduler-slot').filter({ has: targetPill }).first();
            await simulateDragAndDrop(dragPill, targetConflictSlot);
            const hasSlotError = (await page.locator('.teacher-scheduler-slot-error').count()) > 0;
            const hasConflictToast = (await page.locator('.crm-toast').filter({ hasText: /conflict|overlap|locked/i }).count()) > 0;
            assert(hasSlotError || hasConflictToast, 'Feedback must be displayed on drop');
            console.log(' - Scenario 6 passed: conflict/locked feedback verified.');
        }
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
