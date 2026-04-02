const { chromium } = require('playwright');
const assert = require('assert');

(async () => {
    console.log('Starting live test for Teacher Scheduler...');
    const browser = await chromium.launch({ headless: true, ignoreHTTPSErrors: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

    let stepsCompleted = 0;

    try {
        console.log('Navigating to index.html to authenticate safely...');
        await page.goto('https://localhost:8443/index.html');

        console.log('Waiting for auth module to initialize...');
        await page.waitForFunction(() => window.firebaseAuthFunctions && window.firebaseAuthFunctions.signIn, { timeout: 15000 });

        console.log('Executing live Firebase login for huathanhnam95@gmail.com...');
        const authResult = await page.evaluate(async () => {
            return await window.firebaseAuthFunctions.signIn('huathanhnam95@gmail.com', 'Alphaein@1new');
        });

        if (!authResult || !authResult.success) {
            throw new Error(`Login failed: ${authResult?.error || 'Unknown error'}`);
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

            console.log('Testing workspace API directly to diagnose 500 error...');
            const workspaceRes = await fetch('/api/teacher/scheduler/workspace?from=2026-03-30&to=2026-04-05', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const workspaceJson = await workspaceRes.json();
            console.log('Workspace API Result:', workspaceJson);
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

        const fromDateValue = await page.locator('#inputTeacherSchedulerFromDate').inputValue();
        const toDateValue = await page.locator('#inputTeacherSchedulerToDate').inputValue();
        assert(fromDateValue && toDateValue, 'From/To dates should be populated by default.');

        const teacherUidVisible = await page.locator('input[placeholder*="Teacher UID"]').isVisible();
        assert(!teacherUidVisible, 'Teacher UID input should be hidden/auto-scoped.');

        await page.locator('#btnTeacherSchedulerRefresh').click();
        await page.waitForTimeout(500); // stable grid
        const classCards = await page.locator('.teacher-scheduler-class-card').count();
        assert(classCards > 0, 'Class rail should render at least 1 classroom.');
        stepsCompleted++;

        // Phase 4.2 Quick Add
        console.log('Step 4.2: Quick Add Popover...');
        const slot = page.locator('.teacher-scheduler-slot').first();
        await slot.click();
        await page.waitForSelector('#teacherSchedulerQuickAdd[aria-hidden="false"]');
        assert(await page.locator('#teacherSchedulerQuickAdd').isVisible(), 'Quick Add popover should be visible.');

        await page.locator('#btnTeacherSchedulerQuickAdd').click();
        await page.waitForTimeout(1000); // wait for session to be placed and loaded
        const pillCountAfterQuickAdd = await page.locator('.teacher-scheduler-session-pill').count();
        assert(pillCountAfterQuickAdd > 0, 'Session pill should appear after quick add.');
        stepsCompleted++;

        // trigger conflict error screenshot
        await slot.click();
        await page.waitForSelector('#teacherSchedulerQuickAdd[aria-hidden="false"]');
        await page.locator('#btnTeacherSchedulerQuickAdd').click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'teacher_scheduler_conflict_error.png' });
        console.log(' - Screenshot taken: teacher_scheduler_conflict_error.png');
        await page.locator('#btnTeacherSchedulerQuickCancel').click();
        await page.waitForSelector('#teacherSchedulerQuickAdd[aria-hidden="true"]');

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
        await page.locator('.teacher-scheduler-day-chip').nth(1).click(); // Click Monday
        await page.locator('.teacher-scheduler-day-chip').nth(3).click(); // Click Wed
        await page.locator('#btnTeacherSchedulerPlaceWeek').click();
        await page.waitForTimeout(1500);
        stepsCompleted++;

        // Phase 4.5 Activate recurrences
        console.log('Step 4.5: Activate Recurrences...');
        await page.locator('#btnTeacherSchedulerActivateRecurrences').click();
        await page.waitForSelector('#teacherSchedulerActivationSummary', { timeout: 10000 });
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'teacher_scheduler_activation_summary.png' });
        console.log(' - Screenshot taken: teacher_scheduler_activation_summary.png');
        stepsCompleted++;

        // Phase 4.6 & 4.7 Session Drag Drop
        console.log('Step 4.6 & 4.7: Drag drop/reschedule...');
        const sourcePill = page.locator('.teacher-scheduler-session-pill').first();
        const targetSlot = page.locator('.teacher-scheduler-slot').nth(25);
        await sourcePill.dragTo(targetSlot);
        await page.waitForTimeout(1500); // save
        stepsCompleted++;

        console.log('All automated browser interaction steps successfully completed!');
    } catch (e) {
        console.error('Test script failed at step', stepsCompleted, ':', e);
        console.log('Current URL:', page.url());
        console.log('HTML Dump Start----------\n');
        console.log(await page.content());
        console.log('\nHTML Dump End----------');
        await page.screenshot({ path: 'teacher_scheduler_failure.png', fullPage: true });
        console.log(' - Failure screenshot saved to teacher_scheduler_failure.png');
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();
