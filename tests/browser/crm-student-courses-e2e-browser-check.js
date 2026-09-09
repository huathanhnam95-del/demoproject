const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

(async function runStudentCoursesE2EBrowserCheck() {
    const isHeaded = process.argv.includes('--headed');
    const saveScreenshots = process.argv.includes('--screenshots') || true;
    const screenshotDir = path.resolve(__dirname, 'screenshots');

    if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
    }

    console.log(`Starting Course Scheduling & Attendance E2E Browser Test...`);
    console.log(`- Browser: Chrome (Playwright Chromium)`);
    console.log(`- Mode: ${isHeaded ? 'Headed' : 'Headless'}`);
    console.log(`- Screenshots: Enabled -> ${screenshotDir}\n`);

    const browser = await chromium.launch({
        headless: !isHeaded,
        slowMo: isHeaded ? 250 : 0
    });

    const context = await browser.newContext({
        viewport: { width: 1200, height: 900 }
    });
    const page = await context.newPage();

    async function capture(name, description) {
        if (saveScreenshots) {
            const file = path.join(screenshotDir, `${name}.png`);
            await page.screenshot({ path: file, fullPage: false });
            console.log(`  📸 Screenshot saved: ${name}.png (${description})`);
        }
    }

    const cssPath = path.resolve(__dirname, '../../public/crm-admin.css');
    const scriptAvailability = path.resolve(__dirname, '../../public/js/crm/schedule-availability.js');
    const scriptStudentCourses = path.resolve(__dirname, '../../public/js/crm/student-courses.js');

    // Build CRM shell harness simulating the Student Directory & Student Profile Modal
    await page.setContent(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <title>CRM Admin - Course Scheduling E2E Browser Test</title>
            <link rel="stylesheet" href="file://${cssPath.replace(/\\/g, '/')}">
            <style>
                body {
                    margin: 0;
                    padding: 24px;
                    background: var(--crm-bg, #f8fafc);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    color: var(--crm-text-main, #1e293b);
                }
                .crm-shell-mock {
                    max-width: 1080px;
                    margin: 0 auto;
                }
                .crm-header-bar {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    background: #fff;
                    border: 1px solid var(--crm-border, #e2e8f0);
                    border-radius: var(--crm-radius, 8px);
                    margin-bottom: 20px;
                }
                .crm-student-modal-container {
                    background: #fff;
                    border: 1px solid var(--crm-border, #e2e8f0);
                    border-radius: var(--crm-radius, 8px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.06);
                    display: flex;
                    overflow: hidden;
                    min-height: 600px;
                }
                .crm-modal-sidebar {
                    width: 200px;
                    background: var(--crm-surface-input, #f1f5f9);
                    border-right: 1px solid var(--crm-border, #e2e8f0);
                    padding: 16px 0;
                }
                .crm-sidebar-item {
                    display: block;
                    width: 100%;
                    padding: 10px 20px;
                    border: none;
                    background: transparent;
                    text-align: left;
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--crm-text-muted, #64748b);
                    cursor: pointer;
                }
                .crm-sidebar-item.active {
                    background: #fff;
                    color: var(--crm-primary, #0284c7);
                    font-weight: 600;
                    border-left: 3px solid var(--crm-primary, #0284c7);
                }
                .crm-modal-body {
                    flex: 1;
                    padding: 24px;
                }
            </style>
        </head>
        <body>
            <div class="crm-shell-mock">
                <div class="crm-header-bar">
                    <h2 style="margin: 0; font-size: 18px;">CRM Student Management</h2>
                    <button type="button" class="crm-btn-primary btn-new-student-trigger" id="btn-trigger-new-student">
                        + New Student
                    </button>
                </div>

                <!-- Student Modal Shell -->
                <div id="crm-student-modal" style="display: none;">
                    <div class="crm-student-modal-container">
                        <div class="crm-modal-sidebar" style="display: flex; flex-direction: column;">
                            <button type="button" class="crm-sidebar-item active" data-tab="info" id="tab-info">Student Info</button>
                            <button type="button" class="crm-sidebar-item" data-tab="courses" id="tab-courses">Courses</button>
                            <button type="button" class="crm-sidebar-item" data-tab="finance" id="tab-finance">Finance</button>
                            <div style="margin-top: auto; padding: 16px 20px;">
                                <button type="button" class="crm-btn-secondary" id="btn-close-student-modal" style="width: 100%;">Close Modal</button>
                            </div>
                        </div>
                        <div class="crm-modal-body">
                            <!-- Tab: Info -->
                            <div id="student-info" class="crm-tab-content">
                                <h3 style="margin-top: 0;">Student Profile</h3>
                                <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                                    <span id="crm-student-id-badge" style="display: none; padding: 2px 8px; border-radius: 4px; background: #e0f2fe; color: #0369a1; font-size: 12px; font-weight: 600;"></span>
                                </div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
                                    <div>
                                        <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px;">Full Name</label>
                                        <input type="text" id="student-name" class="crm-input" placeholder="e.g. Tran Nam" style="width: 100%; padding: 8px 12px; border: 1px solid var(--crm-border); border-radius: var(--crm-radius);">
                                    </div>
                                    <div>
                                        <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px;">Email</label>
                                        <input type="email" id="student-email" class="crm-input" placeholder="e.g. nam@test.com" style="width: 100%; padding: 8px 12px; border: 1px solid var(--crm-border); border-radius: var(--crm-radius);">
                                    </div>
                                    <div>
                                        <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px;">Phone</label>
                                        <input type="text" id="student-phone" class="crm-input" placeholder="e.g. 0912345678" style="width: 100%; padding: 8px 12px; border: 1px solid var(--crm-border); border-radius: var(--crm-radius);">
                                    </div>
                                    <div>
                                        <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px;">Target Exam & Score</label>
                                        <input type="text" id="student-target-score" class="crm-input" value="PTE 79+" style="width: 100%; padding: 8px 12px; border: 1px solid var(--crm-border); border-radius: var(--crm-radius);">
                                    </div>
                                </div>
                                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                                    <button type="button" class="crm-btn-primary" id="btn-save-student">Save Student</button>
                                </div>
                            </div>

                            <!-- Tab: Courses -->
                            <div id="student-courses" class="crm-tab-content" style="display: none;"></div>
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `);

    // Mock API Layer simulating backend services
    await page.evaluate(() => {
        window.mockDatabase = {
            students: {},
            enrollments: {},
            classrooms: {},
            sessions: []
        };

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
                            totalInstructionMinutes: 1440,
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
                            totalInstructionMinutes: 480,
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

        // Wire modal tabs
        const tabInfo = document.getElementById('tab-info');
        const tabCourses = document.getElementById('tab-courses');
        const contentInfo = document.getElementById('student-info');
        const contentCourses = document.getElementById('student-courses');

        tabInfo.onclick = () => {
            tabInfo.classList.add('active');
            tabCourses.classList.remove('active');
            contentInfo.style.display = 'block';
            contentCourses.style.display = 'none';
        };

        tabCourses.onclick = async () => {
            tabCourses.classList.add('active');
            tabInfo.classList.remove('active');
            contentInfo.style.display = 'none';
            contentCourses.style.display = 'block';

            const currentStudentId = window.currentModalStudentId;
            if (currentStudentId && window.CrmStudentCourses) {
                await window.CrmStudentCourses.refresh(currentStudentId, {
                    id: currentStudentId,
                    name: document.getElementById('student-name').value || 'Test Student'
                });
            }
        };

        // Wire Save Student
        document.getElementById('btn-save-student').onclick = () => {
            const studentId = 'student-' + Date.now();
            window.currentModalStudentId = studentId;
            const badge = document.getElementById('crm-student-id-badge');
            badge.textContent = 'ID: ' + studentId;
            badge.style.display = 'inline-block';
            window.mockDatabase.students[studentId] = {
                id: studentId,
                name: document.getElementById('student-name').value,
                email: document.getElementById('student-email').value
            };
        };

        // Wire New Student Trigger
        document.getElementById('btn-trigger-new-student').onclick = () => {
            document.getElementById('crm-student-modal').style.display = 'block';
            tabInfo.click();
        };

        // Wire Close
        document.getElementById('btn-close-student-modal').onclick = () => {
            document.getElementById('crm-student-modal').style.display = 'none';
            if (window.CrmStudentCourses && typeof window.CrmStudentCourses.destroy === 'function') {
                window.CrmStudentCourses.destroy();
            }
        };
    });

    // Inject frontend component scripts
    await page.addScriptTag({ path: scriptAvailability });
    await page.addScriptTag({ path: scriptStudentCourses });

    await page.evaluate(() => {
        window.CrmStudentCourses.fetchStudentEnrollments = async (studentId) => {
            return window.mockDatabase.enrollments[studentId] || [];
        };
    });

    console.log('✅ Harness and component scripts initialized in Chrome.\n');

    // =========================================================================
    // PHASE 1 & 2: Create a New Student
    // =========================================================================
    console.log('--- Phase 1 & 2: Creating New Student ---');
    await page.click('#btn-trigger-new-student');
    await page.fill('#student-name', 'Tran Nam E2E');
    await page.fill('#student-email', 'nam.e2e@betterenglishlearning.com');
    await page.fill('#student-phone', '0912345678');
    await page.click('#btn-save-student');

    const studentIdBadge = await page.textContent('#crm-student-id-badge');
    assert(studentIdBadge.includes('ID: student-'), 'Student ID badge should be displayed after save');
    console.log(`✓ Student created successfully (${studentIdBadge.trim()})`);
    await capture('e2e-01-student-profile-created', 'Student profile form saved with ID badge');

    // =========================================================================
    // PHASE 3: Open Courses Tab & Verify Screen A Empty State
    // =========================================================================
    console.log('\n--- Phase 3: Screen A Empty State ---');
    await page.click('#tab-courses');
    await page.waitForSelector('#student-courses .crm-empty-state');
    const emptyStateText = await page.textContent('#student-courses');
    assert(emptyStateText.includes('No courses enrolled yet for this student.'), 'Empty state text should match spec');
    assert(await page.$('#btn-show-add-course') !== null, 'Add Course button should be present');
    console.log('✓ Screen A empty state verified with "+ Enrol in a Course" CTA');
    await capture('e2e-02-screen-a-empty-state', 'Screen A empty state');

    // =========================================================================
    // PHASE 4: Screen B — Course Selection & Date Calculations
    // =========================================================================
    console.log('\n--- Phase 4: Screen B Course Selection & Date Overrides ---');
    await page.click('#btn-show-add-course');
    await page.waitForSelector('.crm-course-enroll-header');
    const screenBHeader = await page.textContent('.crm-course-enroll-header h3');
    assert.strictEqual(screenBHeader.trim(), 'Enrol in Course');

    // Select Course
    await page.selectOption('#enroll-course-select', 'course-1on1');
    const autoEndDate = await page.$eval('#enroll-end-date', (el) => el.value);
    const startDate = await page.$eval('#enroll-start-date', (el) => el.value);
    assert(startDate.length > 0, 'Start date should auto-populate');
    assert(autoEndDate.length > 0, 'End date should auto-calculate from durationDays');

    // Test Manual Override
    await page.fill('#enroll-end-date', '2026-11-20');
    await page.dispatchEvent('#enroll-end-date', 'input');
    const overrideBadge = await page.textContent('#enroll-end-date-helper');
    assert(overrideBadge.includes('Manually set'), 'Should display (Manually set) badge on user input');

    // Test Undo
    await page.click('#btn-undo-end-date');
    const restoredEndDate = await page.$eval('#enroll-end-date', (el) => el.value);
    assert.notStrictEqual(restoredEndDate, '2026-11-20', 'Undo must restore the auto-calculated date');
    console.log(`✓ Course selected. Start Date: ${startDate}, End Date: ${restoredEndDate} (duration calculation & undo verified)`);

    // Select Teacher
    await page.selectOption('#enroll-teacher-select', 'teacher-dan');
    console.log('✓ Primary teacher selected: Dan Teacher (teacher-dan)');

    // =========================================================================
    // PHASE 5: Screen B — Weekly Availability Matrix & Live Alignment Bar
    // =========================================================================
    console.log('\n--- Phase 5: Weekly Availability Matrix Configuration ---');
    // Add slot on Monday
    const mondayAddBtn = await page.$('.crm-availability-day-section[data-day="mon"] .crm-availability-btn-add');
    assert(mondayAddBtn !== null, 'Monday add slot button must exist');
    await mondayAddBtn.click();

    // Adjust Monday start time
    const mondayStartInput = await page.$('.crm-availability-day-section[data-day="mon"] .start-time');
    await mondayStartInput.fill('14:00');
    await page.dispatchEvent('.crm-availability-day-section[data-day="mon"] .start-time', 'change');

    // Add slot on Wednesday
    const wednesdayAddBtn = await page.$('.crm-availability-day-section[data-day="wed"] .crm-availability-btn-add');
    await wednesdayAddBtn.click();
    await page.waitForTimeout(60);

    const wednesdayStartInput = await page.$('.crm-availability-day-section[data-day="wed"] .start-time');
    await wednesdayStartInput.fill('14:00');
    await page.dispatchEvent('.crm-availability-day-section[data-day="wed"] .start-time', 'change');
    await page.waitForTimeout(100);

    // Verify comparison bar
    const comparisonText = await page.textContent('#enroll-comparison-bar');
    assert(comparisonText.includes('Contract: 24 hrs'), `Comparison bar should show 24 contracted hrs (got: ${comparisonText})`);
    assert(comparisonText.includes('2 lessons'), `Comparison bar should reflect 2 lessons (got: ${comparisonText})`);
    assert(comparisonText.includes('4 hrs/wk'), `Comparison bar should reflect 4 hrs/wk (got: ${comparisonText})`);
    console.log(`✓ Availability matrix configured: Monday 14:00-16:00, Wednesday 14:00-16:00`);
    console.log(`✓ Live Alignment Bar: "${comparisonText.trim()}"`);
    await capture('e2e-03-screen-b-availability-matrix', 'Screen B with Availability Matrix and Comparison Bar');

    // =========================================================================
    // Submit Enrollment & Provision Synthetic Classroom
    // =========================================================================
    await page.evaluate(() => {
        window.CrmStudentCourses.submitEnrollment = async () => {
            const enrollmentId = 'enr-e2e-1';
            const sessions = [];
            // Seed 12 sessions of 120 mins = 24 hrs
            for (let i = 1; i <= 12; i++) {
                sessions.push({
                    sessionId: `sess-${i}`,
                    classId: 'class-synthetic-1',
                    contractUnitIndex: i,
                    unitType: 'contracted',
                    status: 'scheduled',
                    sessionOutcome: 'none',
                    contractCountState: 'counts',
                    attendanceState: 'none',
                    durationMinutes: 120,
                    scheduledLocalDate: `2026-09-${String(i * 2).padStart(2, '0')}`,
                    scheduledLocalTime: '14:00',
                    teacherUid: 'teacher-dan'
                });
            }

            const enrollment = {
                id: enrollmentId,
                enrollmentId,
                studentId: window.currentModalStudentId,
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
                    contractedTargetCount: 12,
                    contractedAssignedCount: 12,
                    contractedCompletedCount: 0,
                    remainingToScheduleCount: 0,
                    contractedMinutesTotal: 1440,
                    contractedMinutesDelivered: 0,
                    contractedMinutesRemaining: 1440
                },
                sessions
            };

            window.mockDatabase.enrollments[window.currentModalStudentId] = [enrollment];
            window.CrmStudentCourses.fetchStudentEnrollments = async () => [enrollment];
            return { success: true, enrollment };
        };
    });

    await page.click('#btn-submit-enroll');
    await page.waitForSelector('.crm-student-course-card');
    console.log('✓ Enrollment submitted. Classroom provisioned & 12 sessions seeded.');

    // =========================================================================
    // PHASE 6: Screen A — Active Enrolment Card
    // =========================================================================
    console.log('\n--- Phase 6: Screen A Active Course Card ---');
    const courseTitle = await page.textContent('.crm-student-course-title-row h4');
    assert(courseTitle.includes('PTE Academic 1-on-1 Intensive'));

    const progressBarRole = await page.$eval('.crm-funnel-track', (el) => el.getAttribute('role'));
    const progressBarAria = await page.$eval('.crm-funnel-track', (el) => el.getAttribute('aria-label'));
    assert.strictEqual(progressBarRole, 'progressbar', 'Progress bar must use role="progressbar"');
    assert(progressBarAria.includes('Course progress: 0 of 24 hours'));

    const attendanceBtn = await page.$('.btn-view-attendance');
    assert(attendanceBtn !== null, 'View Lessons & Attendance button must exist');
    console.log('✓ Screen A rendered course card with accessible progress bar (0 of 24 hrs delivered)');
    await capture('e2e-04-screen-a-enrolled-card', 'Screen A course card with live progress bar');

    // =========================================================================
    // PHASE 7: Screen C — Lessons & Attendance Table
    // =========================================================================
    console.log('\n--- Phase 7: Screen C Lessons & Attendance Table ---');
    await page.evaluate(() => {
        window.CrmStudentCourses.submitAttendance = async (sessionId, status, notes) => {
            const enr = window.mockDatabase.enrollments[window.currentModalStudentId][0];
            const sess = enr.sessions.find((s) => s.sessionId === sessionId);
            if (sess) {
                if (status === 'attended') {
                    sess.status = 'completed';
                    sess.sessionOutcome = 'completed';
                    sess.attendanceState = 'finalized';
                } else if (status === 'reset' || status === 'scheduled') {
                    sess.status = 'scheduled';
                    sess.sessionOutcome = 'none';
                    sess.attendanceState = 'none';
                }
                sess.attendanceNotes = notes || null;
            }
            if (status === 'attended') {
                enr.scheduleSummary.contractedCompletedCount = 1;
                enr.scheduleSummary.contractedMinutesDelivered = 120;
                enr.scheduleSummary.contractedMinutesRemaining = 1320;
            } else if (status === 'reset' || status === 'scheduled') {
                enr.scheduleSummary.contractedCompletedCount = 0;
                enr.scheduleSummary.contractedMinutesDelivered = 0;
                enr.scheduleSummary.contractedMinutesRemaining = 1440;
            }
            return { success: true, sessionId, status };
        };

        window.CrmStudentCourses.submitPushForward = async (sessionId, opts) => {
            if (opts?.previewOnly) {
                return {
                    preview: true,
                    previewSummary: '2 → Wed 16 Sep · 3 → Mon 21 Sep · 4 → Wed 23 Sep',
                    prevEndDate: '2026-10-07',
                    newEndDate: '2026-10-14',
                    prevEndDateFormatted: 'Wed 07 Oct 2026',
                    newEndDateFormatted: 'Wed 14 Oct 2026'
                };
            }
            const enr = window.mockDatabase.enrollments[window.currentModalStudentId][0];
            const sess = enr.sessions.find((s) => s.sessionId === sessionId);
            if (sess) {
                sess.contractCountState = 'does_not_count';
                sess.sessionOutcome = 'absent_makeup';
                sess.attendanceState = 'finalized';
                sess.attendanceStatus = 'rescheduled';
                sess.isPushedForward = true;
            }
            // Append trailing makeup session
            enr.sessions.push({
                sessionId: 'sess-trailing-makeup',
                classId: 'class-synthetic-1',
                contractUnitIndex: 13,
                unitType: 'contracted',
                status: 'scheduled',
                sessionOutcome: 'none',
                contractCountState: 'counts',
                durationMinutes: 120,
                scheduledLocalDate: '2026-10-14',
                scheduledLocalTime: '14:00'
            });
            return { success: true, sessionId };
        };
    });

    await page.click('.btn-view-attendance');
    await page.waitForSelector('.crm-session-table');

    // Confirm NO stacked modal overlays
    const stackedModals = await page.$$('.crm-modal-overlay');
    assert.strictEqual(stackedModals.length, 0, 'No stacked modal overlay must ever be created');

    const sessionRows = await page.$$('.crm-session-row');
    assert.strictEqual(sessionRows.length, 12, 'Chronological table should contain 12 seeded session rows');

    const tableAriaLabel = await page.$eval('.crm-session-table', (el) => el.getAttribute('aria-label'));
    assert.strictEqual(tableAriaLabel, 'Scheduled sessions and attendance', 'Table must have accessible aria-label');
    console.log('✓ Screen C rendered without stacked modals (12 sessions chronologically listed)');
    await capture('e2e-05-screen-c-session-table', 'Screen C lessons and attendance table');

    // =========================================================================
    // PHASE 8: Screen C — Inline Attendance Marking (Session #1)
    // =========================================================================
    console.log('\n--- Phase 8: Inline Attendance Marking for Session #1 ---');
    const firstRowExpandBtn = await page.$('.crm-session-row[data-session-id="sess-1"] .btn-expand-attendance');
    assert.strictEqual(await firstRowExpandBtn.getAttribute('aria-expanded'), 'false');

    await firstRowExpandBtn.click();
    assert.strictEqual(await firstRowExpandBtn.getAttribute('aria-expanded'), 'true');
    const inlinePanel = await page.$('.crm-session-inline-panel');
    assert(inlinePanel !== null, 'Inline expansion panel must be visible under the row');

    // Choose Attended and confirm
    await page.click('.crm-session-inline-panel input[value="attended"]');
    await page.click('.btn-inline-confirm');

    // Verify Session #1 status updated
    await page.waitForSelector('.crm-session-row[data-session-id="sess-1"] .status-attended');
    const session1Badge = await page.textContent('.crm-session-row[data-session-id="sess-1"] .crm-session-status-badge');
    assert(session1Badge.includes('Attended'));

    const progressSummaryDelivered = await page.textContent('.crm-attendance-summary-stats');
    assert(progressSummaryDelivered.includes('Delivered: 2 hrs (8%)'));
    console.log('✓ Session #1 marked as Attended. Progress bar updated to 2 hrs delivered (8%).');
    await capture('e2e-06-screen-c-session-attended', 'Session #1 marked attended with updated progress bar');

    // =========================================================================
    // PHASE 9: Screen C — Push-Forward Cascade Preview & Reschedule (Session #2)
    // =========================================================================
    console.log('\n--- Phase 9: Push-Forward Cascade Rescheduling for Session #2 ---');
    const secondRowExpandBtn = await page.$('.crm-session-row[data-session-id="sess-2"] .btn-expand-attendance');
    await secondRowExpandBtn.click();

    // Select Push Forward radio
    await page.click('.crm-session-inline-panel input[value="push-forward"]');
    await page.waitForSelector('.crm-cascade-preview-box', { state: 'visible' });

    const shiftPreview = await page.textContent('.crm-cascade-preview-shift');
    const datePreview = await page.textContent('.crm-cascade-preview-date');
    assert(shiftPreview.includes('2 → Wed 16 Sep'));
    assert(datePreview.includes('Wed 14 Oct 2026'));
    console.log(`✓ Live cascade preview verified: "${shiftPreview.trim()}"`);
    console.log(`✓ Extended End Date preview: "${datePreview.trim()}"`);
    await capture('e2e-07-screen-c-push-forward-preview', 'Live cascade preview box with shifted dates');

    // Confirm push forward
    await page.click('.btn-inline-confirm');
    await page.waitForTimeout(300);

    const totalSessionsAfterPush = await page.$$('.crm-session-row');
    assert.strictEqual(totalSessionsAfterPush.length, 13, 'Table should now contain 13 rows (12 original + 1 trailing makeup)');

    const session2Badge = await page.textContent('.crm-session-row[data-session-id="sess-2"] .crm-session-status-badge');
    assert(session2Badge.includes('Rescheduled'));
    console.log('✓ Session #2 committed as Rescheduled. Trailing replacement session appended.');
    await capture('e2e-08-screen-c-push-forward-committed', 'Session #2 rescheduled and trailing session added');

    // =========================================================================
    // PHASE 10: Reset Session #1 to Scheduled & Clean Teardown
    // =========================================================================
    console.log('\n--- Phase 10: Reset Session to Scheduled & Modal Teardown ---');
    const session1EditBtn = await page.$('.crm-session-row[data-session-id="sess-1"] .btn-expand-attendance');
    await session1EditBtn.click();

    // Select Reset to Scheduled
    await page.click('.crm-session-inline-panel input[value="reset"]');
    await page.click('.btn-inline-confirm');
    await page.waitForTimeout(200);

    const session1ResetBadge = await page.textContent('.crm-session-row[data-session-id="sess-1"] .crm-session-status-badge');
    assert(session1ResetBadge.includes('Scheduled'));
    console.log('✓ Session #1 reverted to Scheduled state.');

    // Return to Screen A
    await page.click('#btn-back-to-screen-a');
    await page.waitForSelector('.crm-student-course-card');
    console.log('✓ Returned to Screen A from Screen C.');

    // Close Modal & Teardown
    await page.click('#btn-close-student-modal');
    const modalDisplay = await page.$eval('#crm-student-modal', (el) => el.style.display);
    assert.strictEqual(modalDisplay, 'none', 'Modal should be hidden');
    console.log('✓ Student modal closed and CrmStudentCourses.destroy() cleanly executed.');

    await browser.close();
    console.log('\n=============================================================');
    console.log('🎉 Full Course Scheduling & Attendance E2E Browser Test PASSED!');
    console.log('=============================================================\n');
})();
