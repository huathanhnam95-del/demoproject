const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

(async function runStudentCoursesUiTests() {
    const isHeaded = process.argv.includes('--headed');
    const saveScreenshots = process.argv.includes('--screenshots');
    const screenshotDir = path.resolve(__dirname, '../browser/screenshots');

    console.log(`Running Student Courses UI tests (headed: ${isHeaded}, screenshots: ${saveScreenshots})...`);
    const browser = await chromium.launch({ headless: !isHeaded, slowMo: isHeaded ? 300 : 0 });
    const context = await browser.newContext({ viewport: { width: 1024, height: 800 } });
    const page = await context.newPage();

    async function capture(name) {
        if (!saveScreenshots) return;
        await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: true });
    }

    const scriptAvailability = path.resolve(__dirname, '../../public/js/crm/schedule-availability.js');
    const scriptStudentCourses = path.resolve(__dirname, '../../public/js/crm/student-courses.js');
    const cssPath = path.resolve(__dirname, '../../public/crm-admin.css');

    await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <link rel="stylesheet" href="file://${cssPath.replace(/\\/g, '/')}">
        </head>
        <body style="padding: 24px; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <div id="student-courses" style="max-width: 720px; background: #fff; padding: 24px; border-radius: 8px; border: 1px solid #e2e8f0;"></div>
        </body>
        </html>
    `);

    // Mock CrmCourses and ClassroomAPI
    await page.evaluate(() => {
        window.CrmCourses = {
            async fetchCourses() {
                return [
                    {
                        courseId: 'course-1on1',
                        name: 'PTE Academic 1-on-1 Intensive',
                        code: 'PTE-1ON1',
                        courseType: '1on1',
                        durationDays: 30,
                        deliveryTemplate: {
                            totalInstructionMinutes: 1440, // 24 hours
                            defaultSessionMinutes: 120,
                            durationStepMinutes: 30,
                            timezone: 'Asia/Ho_Chi_Minh'
                        }
                    },
                    {
                        courseId: 'course-pronun',
                        name: 'Pronunciation Mastery Coaching',
                        code: 'PRONUN-COACH',
                        courseType: 'pronun',
                        durationDays: 14,
                        deliveryTemplate: {
                            totalInstructionMinutes: 480, // 8 hours
                            defaultSessionMinutes: 60,
                            durationStepMinutes: 30,
                            timezone: 'Asia/Ho_Chi_Minh'
                        }
                    }
                ];
            }
        };

        window.ClassroomAPI = {
            async fetchTeachers() {
                return [
                    { uid: 'teacher-dan', displayName: 'Dan Teacher', email: 'dan@example.com' },
                    { uid: 'teacher-sarah', displayName: 'Sarah Teacher', email: 'sarah@example.com' }
                ];
            }
        };
    });

    await page.addScriptTag({ path: scriptAvailability });
    await page.addScriptTag({ path: scriptStudentCourses });

    // Test 1: Empty state in Screen A
    await page.evaluate(() => {
        window.CrmStudentCourses.fetchStudentEnrollments = async () => [];
        return window.CrmStudentCourses.refresh('student-101', { id: 'student-101', name: 'Tran Nam' });
    });

    const emptyStateText = await page.textContent('#student-courses');
    assert(emptyStateText.includes('No courses enrolled yet for this student.'));
    assert(await page.$('#btn-show-add-course') !== null);
    await capture('crm-student-courses-screen-a-empty');
    console.log('✓ Test 1 passed: Screen A empty state');


    // Test 2: Click "+ Enrol in a Course" transitions to Screen B
    await page.click('#btn-show-add-course');
    const screenBTitle = await page.textContent('.crm-course-enroll-header h3');
    assert.strictEqual(screenBTitle.trim(), 'Enrol in Course');

    // Verify course type filter works
    const courseOptions = await page.$$eval('#enroll-course-select option', (opts) => opts.map((o) => o.textContent));
    assert(courseOptions.some((txt) => txt.includes('PTE Academic 1-on-1 Intensive')));
    console.log('✓ Test 2 passed: Transition to Screen B & course selector population');

    // Test 3: Select course -> auto-calculates End Date & updates availability matrix defaults
    await page.selectOption('#enroll-course-select', 'course-1on1');
    const autoEndDate = await page.$eval('#enroll-end-date', (el) => el.value);
    const startDate = await page.$eval('#enroll-start-date', (el) => el.value);
    assert(autoEndDate.length > 0, 'End date should be auto-filled');

    // Test auto-updating end date when start date is changed
    await page.fill('#enroll-start-date', '2026-10-01');
    await page.dispatchEvent('#enroll-start-date', 'change');
    const updatedEndDate = await page.$eval('#enroll-end-date', (el) => el.value);
    assert.strictEqual(updatedEndDate, '2026-10-31', 'Start date + 30 days should equal 2026-10-31');

    // Test manual override and undo link
    await page.fill('#enroll-end-date', '2026-11-15');
    await page.dispatchEvent('#enroll-end-date', 'input');
    const overrideBadgeText = await page.textContent('#enroll-end-date-helper');
    assert(overrideBadgeText.includes('Manually set'), 'Should show Manually set badge');

    await page.click('#btn-undo-end-date');
    const undoneEndDate = await page.$eval('#enroll-end-date', (el) => el.value);
    assert.strictEqual(undoneEndDate, '2026-10-31', 'Undo should revert back to auto-calculated date');
    const resetHelperText = await page.textContent('#enroll-end-date-helper');
    assert(resetHelperText.includes('(auto-calculated)'));
    await capture('crm-student-courses-screen-b-matrix');
    console.log('✓ Test 3 passed: Duration calculation, manual override badge, and undo restore');

    // Test 4: Back button returns to Screen A
    await page.click('#btn-back-to-courses');
    const backToScreenAText = await page.textContent('#student-courses');
    assert(backToScreenAText.includes('No courses enrolled yet for this student.'));
    console.log('✓ Test 4 passed: Back button returns to Screen A');

    // Test 5: Render Screen A with active enrollments
    await page.evaluate(() => {
        window.CrmStudentCourses.fetchStudentEnrollments = async () => [
            {
                id: 'enr-1',
                enrollmentId: 'enr-1',
                studentId: 'student-101',
                courseId: 'course-1on1',
                classId: 'class-synthetic-1',
                status: 'active',
                course: {
                    name: 'PTE Academic 1-on-1 Intensive',
                    code: 'PTE-1ON1',
                    courseType: '1on1'
                },
                classroom: {
                    classroomId: 'class-synthetic-1',
                    primaryTeacherUid: 'teacher-dan'
                },
                scheduleSummary: {
                    contractedMinutesTotal: 1440,
                    contractedMinutesDelivered: 480,
                    contractedMinutesRemaining: 960
                },
                sessions: [
                    {
                        scheduledLocalDate: '2026-09-07',
                        scheduledLocalTime: '14:00',
                        status: 'scheduled'
                    }
                ]
            }
        ];
        return window.CrmStudentCourses.refresh('student-101', { id: 'student-101', name: 'Tran Nam' });
    });

    const cardTitle = await page.textContent('.crm-student-course-name');
    assert.strictEqual(cardTitle.trim(), 'PTE Academic 1-on-1 Intensive');

    const progressMeta = await page.textContent('.crm-student-course-progress-meta');
    assert(progressMeta.includes('8 / 24 hrs delivered (33%)'), `Progress meta was: ${progressMeta}`);
    assert(progressMeta.includes('16 hrs remaining'), `Remaining hours was: ${progressMeta}`);

    const progressBarWidth = await page.$eval('.crm-funnel-bar', (el) => el.style.width);
    assert.strictEqual(progressBarWidth, '33%');

    // Accessibility check: progress bar in Screen A
    const progressRole = await page.$eval('.crm-funnel-track', (el) => el.getAttribute('role'));
    const progressValueNow = await page.$eval('.crm-funnel-track', (el) => el.getAttribute('aria-valuenow'));
    const progressValueMax = await page.$eval('.crm-funnel-track', (el) => el.getAttribute('aria-valuemax'));
    const progressAriaLabel = await page.$eval('.crm-funnel-track', (el) => el.getAttribute('aria-label'));
    assert.strictEqual(progressRole, 'progressbar', 'Screen A progress bar must have role="progressbar"');
    assert.strictEqual(progressValueNow, '480', 'Screen A progress bar must have correct aria-valuenow');
    assert.strictEqual(progressValueMax, '1440', 'Screen A progress bar must have correct aria-valuemax');
    assert(progressAriaLabel.includes('Course progress: 8 of 24 hours'), `progressAriaLabel was: ${progressAriaLabel}`);

    const nextLessonText = await page.textContent('.crm-student-course-details-row');
    assert(nextLessonText.includes('Sep 7 at 14:00'));
    assert(nextLessonText.includes('teacher-dan'));

    const btnAttendance = await page.$('.btn-view-attendance');
    assert(btnAttendance !== null, 'View Lessons & Attendance button must be present');
    await capture('crm-student-courses-screen-a-enrolled');
    console.log('✓ Test 5 passed: Screen A enrollment card with live progress bar (role="progressbar") and next lesson');

    // Test 6: Click "View Lessons & Attendance →" switches to Screen C
    await page.evaluate(() => {
        window.CrmStudentCourses.submitAttendance = async (sessionId, status) => {
            return { success: true, sessionId, status };
        };
        window.CrmStudentCourses.submitPushForward = async (sessionId, opts) => {
            if (opts?.previewOnly) {
                return {
                    preview: true,
                    previewSummary: '1 → Mon 14 Sep · 2 → Mon 21 Sep',
                    prevEndDate: '2026-09-14',
                    newEndDate: '2026-09-21',
                    prevEndDateFormatted: 'Mon 14 Sep 2026',
                    newEndDateFormatted: 'Mon 21 Sep 2026'
                };
            }
            return { success: true, sessionId };
        };
    });

    await page.click('.btn-view-attendance');
    const screenCTitle = await page.textContent('.crm-attendance-header h3');
    assert(screenCTitle.includes('PTE Academic 1-on-1 Intensive — Lessons & Attendance'));

    // Assert NO stacked modal overlays were opened!
    const modalOverlays = await page.$$('.crm-modal-overlay');
    assert.strictEqual(modalOverlays.length, 0, 'No stacked modal overlay must be present');

    const sessionRows = await page.$$('.crm-session-row');
    assert.strictEqual(sessionRows.length, 1);
    const sessionBadge = await page.textContent('.crm-session-status-badge');
    assert(sessionBadge.includes('Scheduled'));

    // Accessibility check: initial aria-expanded on trigger button
    const initialAriaExpanded = await page.$eval('.btn-expand-attendance', (el) => el.getAttribute('aria-expanded'));
    assert.strictEqual(initialAriaExpanded, 'false', 'Trigger button must have aria-expanded="false" initially');
    await capture('crm-student-courses-screen-c-table');
    console.log('✓ Test 6 passed: Screen C rendering & No stacked modals (aria-expanded="false")');

    // Test 7: Inline row expansion & push-forward preview cascade
    await page.click('.btn-expand-attendance');
    const inlinePanel = await page.$('.crm-session-inline-panel');
    assert(inlinePanel !== null, 'Inline expansion panel must appear');

    const expandedAria = await page.$eval('.btn-expand-attendance', (el) => el.getAttribute('aria-expanded'));
    assert.strictEqual(expandedAria, 'true', 'Trigger button must have aria-expanded="true" when open');

    // Select Push Forward radio
    await page.click('input[value="push-forward"]');
    await page.waitForSelector('.crm-cascade-preview-box', { state: 'visible' });
    const shiftPreviewText = await page.textContent('.crm-cascade-preview-shift');
    assert(shiftPreviewText.includes('1 → Mon 14 Sep'), `Expected shift preview, got: ${shiftPreviewText}`);
    const datePreviewText = await page.textContent('.crm-cascade-preview-date');
    assert(datePreviewText.includes('Mon 21 Sep 2026'));
    await capture('crm-student-courses-screen-c-cascade-preview');
    console.log('✓ Test 7 passed: Inline attendance expansion & Push-Forward live cascade preview (aria-expanded="true")');

    // Test 8: Inline Attendance Confirm & return to Screen A
    // Switch to Attended and confirm
    await page.click('input[value="attended"]');
    // Mock the refreshed enrollments for fetchStudentEnrollments
    await page.evaluate(() => {
        window.CrmStudentCourses.fetchStudentEnrollments = async () => [
            {
                id: 'enr-1',
                enrollmentId: 'enr-1',
                studentId: 'student-101',
                courseId: 'course-1on1',
                classId: 'class-synthetic-1',
                status: 'active',
                course: {
                    name: 'PTE Academic 1-on-1 Intensive',
                    code: 'PTE-1ON1',
                    courseType: '1on1'
                },
                scheduleSummary: {
                    contractedMinutesTotal: 1440,
                    contractedMinutesDelivered: 600,
                    contractedMinutesRemaining: 840
                },
                sessions: [
                    {
                        sessionId: 'sess-1',
                        contractUnitIndex: 1,
                        scheduledLocalDate: '2026-09-07',
                        scheduledLocalTime: '14:00',
                        durationMinutes: 120,
                        status: 'completed',
                        sessionOutcome: 'completed',
                        contractCountState: 'counts',
                        attendanceState: 'finalized'
                    }
                ]
            }
        ];
    });

    await page.click('.btn-inline-confirm');
    await page.waitForSelector('.crm-session-status-badge.status-attended');
    const updatedBadge = await page.textContent('.crm-session-status-badge.status-attended');
    assert(updatedBadge.includes('Attended'));

    // Accessibility check: status change announcement
    const announcedText = await page.textContent('#attendance-announce');
    assert(announcedText.includes('marked as attended'), `Expected attendance announcement, got: ${announcedText}`);

    // Click back to Screen A
    await page.click('#btn-back-to-screen-a');
    const backInScreenA = await page.$('.crm-student-courses-header');
    assert(backInScreenA !== null, 'Should return back to Screen A');
    console.log('✓ Test 8 passed: Attendance confirmed, status updated, announced via live region, and back to Screen A');

    // Test 9: Reopen Screen C, Edit finalized session, and verify "Reset to Scheduled"
    let lastAttendanceCall = null;
    await page.evaluate(() => {
        window.CrmStudentCourses.submitAttendance = async (sessionId, status) => {
            window.__lastAttendanceStatus = status;
            return { success: true, sessionId, status };
        };
    });

    await page.click('.btn-view-attendance');
    const editBtn = await page.$('.btn-expand-attendance');
    assert(editBtn !== null, 'Edit button must exist on completed session');
    const editBtnText = await editBtn.textContent();
    assert.strictEqual(editBtnText.trim(), 'Edit ▾');

    await editBtn.click();
    const resetRadio = await page.$('input[value="reset"]');
    assert(resetRadio !== null, 'Reset to Scheduled radio option must appear when editing finalized session');

    await resetRadio.click();
    await page.click('.btn-inline-confirm');

    const lastStatus = await page.evaluate(() => window.__lastAttendanceStatus);
    assert.strictEqual(lastStatus, 'reset', 'Should submit reset status to API');

    // Test destroy method
    await page.evaluate(() => {
        window.CrmStudentCourses.destroy();
    });
    console.log('✓ Test 9 passed: Edit finalized session offers "Reset to Scheduled", submits reset, and destroy cleans up');

    await browser.close();
    console.log('\nAll Student Courses UI tests passed successfully!');
})();
