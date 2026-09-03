const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

(async function runStudentCoursesUiTests() {
    console.log('Running Student Courses UI (Screens A & B) tests...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

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
    console.log('✓ Test 3 passed: Duration calculation & instant end-date update on start-date change');

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

    const nextLessonText = await page.textContent('.crm-student-course-details-row');
    assert(nextLessonText.includes('Sep 7 at 14:00'));
    assert(nextLessonText.includes('teacher-dan'));

    const btnAttendance = await page.$('.btn-view-attendance');
    assert(btnAttendance !== null, 'View Lessons & Attendance button must be present');
    console.log('✓ Test 5 passed: Screen A enrollment card with live progress bar and next lesson');

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
    console.log('✓ Test 6 passed: Screen C rendering & No stacked modals');

    // Test 7: Inline row expansion & push-forward preview cascade
    await page.click('.btn-expand-attendance');
    const inlinePanel = await page.$('.crm-session-inline-panel');
    assert(inlinePanel !== null, 'Inline expansion panel must appear');

    // Select Push Forward radio
    await page.click('input[value="push-forward"]');
    await page.waitForSelector('.crm-cascade-preview-box', { state: 'visible' });
    const shiftPreviewText = await page.textContent('.crm-cascade-preview-shift');
    assert(shiftPreviewText.includes('1 → Mon 14 Sep'), `Expected shift preview, got: ${shiftPreviewText}`);
    const datePreviewText = await page.textContent('.crm-cascade-preview-date');
    assert(datePreviewText.includes('Mon 21 Sep 2026'));
    console.log('✓ Test 7 passed: Inline attendance expansion & Push-Forward live cascade preview');

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

    // Click back to Screen A
    await page.click('#btn-back-to-screen-a');
    const backInScreenA = await page.$('.crm-student-courses-header');
    assert(backInScreenA !== null, 'Should return back to Screen A');
    console.log('✓ Test 8 passed: Attendance confirmed, status updated, and back to Screen A');

    await browser.close();
    console.log('\nAll Student Courses UI tests passed successfully!');
})();
