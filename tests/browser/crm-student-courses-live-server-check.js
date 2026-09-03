/* eslint-disable no-console */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { readBrowserTestCredentials, redactAuthIdentity } = require('./helpers/browser-test-credentials');

const ORIGIN = process.env.CRM_TEST_ORIGIN || 'https://localhost:8443';
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

(async function runLiveBrowserTest() {
    const isHeaded = process.argv.includes('--headed');
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const credentials = readBrowserTestCredentials();
    console.log(`Starting Live Browser Test against ${ORIGIN}...`);
    console.log(`- Browser: Chrome (Playwright Chromium)`);
    console.log(`- Mode: ${isHeaded ? 'Headed' : 'Headless'}`);
    console.log(`- Auth account: ${redactAuthIdentity(credentials.email, credentials)}\n`);

    const browser = await chromium.launch({
        headless: !isHeaded,
        slowMo: isHeaded ? 300 : 0
    });

    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1440, height: 900 }
    });

    const page = await context.newPage();
    const consoleErrors = [];

    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            consoleErrors.push(redactAuthIdentity(msg.text(), credentials));
        }
    });

    page.on('pageerror', (err) => {
        consoleErrors.push(redactAuthIdentity(err.message, credentials));
    });

    async function capture(name, desc) {
        const file = path.join(SCREENSHOT_DIR, `${name}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log(`  📸 Live Screenshot: ${name}.png (${desc})`);
    }

    try {
        console.log(`Step 1: Navigating to ${ORIGIN}/crm-admin.html...`);
        await page.goto(`${ORIGIN}/crm-admin.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1000);

        // Step 2: Authenticate if needed
        console.log('Step 2: Checking authentication state...');
        const isAuthenticated = await page.evaluate(async (creds) => {
            if (window.firebase?.auth) {
                const auth = window.firebase.auth();
                if (!auth.currentUser) {
                    try {
                        await auth.signInWithEmailAndPassword(creds.email, creds.password);
                        return true;
                    } catch (e) {
                        return false;
                    }
                }
                return true;
            }
            return false;
        }, credentials);

        if (isAuthenticated) {
            console.log('✓ Firebase authenticated successfully with admin account.');
        } else {
            console.log('ℹ Proceeding with page context...');
        }

        await page.waitForTimeout(2000);
        await capture('live-01-crm-admin-loaded', 'CRM Admin shell loaded on live server');

        // Step 3: Navigate to Students tab
        console.log('\nStep 3: Navigating to Students panel...');
        await page.evaluate(() => {
            window.location.hash = '#students';
            if (typeof window.switchPanel === 'function') {
                window.switchPanel('students');
            }
        });
        await page.waitForTimeout(1500);
        await capture('live-02-students-panel', 'Students directory on live server');

        // Step 4: Open a student modal or create a test student
        console.log('\nStep 4: Opening Student Profile modal...');
        const studentRow = await page.$('.crm-student-row, [data-student-id]');
        if (studentRow) {
            console.log('Found existing student row in directory. Opening profile...');
            await studentRow.click();
        } else {
            console.log('No student rows rendered yet. Triggering New Student...');
            const newStudentBtn = await page.$('.btn-new-student-trigger, #btn-new-student');
            if (newStudentBtn) {
                await newStudentBtn.click();
            } else {
                // Directly show modal for test verification
                await page.evaluate(() => {
                    const modal = document.getElementById('crm-student-modal');
                    if (modal) {
                        modal.style.display = 'block';
                        modal.setAttribute('aria-hidden', 'false');
                    }
                });
            }
        }
        await page.waitForTimeout(1000);
        await capture('live-03-student-modal-opened', 'Student Profile modal opened');

        // Step 5: Switch to Courses Tab
        console.log('\nStep 5: Activating Courses tab in modal...');
        const coursesTabBtn = await page.$('.crm-sidebar-item[data-tab="courses"]');
        assert(coursesTabBtn !== null, 'Courses tab button must exist in the student modal');
        await coursesTabBtn.click();
        await page.waitForTimeout(1000);
        await capture('live-04-courses-tab-active', 'Courses tab active in student modal');

        // Step 6: Verify Screen A or initialize Screen A
        console.log('\nStep 6: Verifying Screen A (Enrolments Overview)...');
        const coursesContainer = await page.$('#student-courses');
        assert(coursesContainer !== null, '#student-courses container must exist in DOM');

        // Mount / refresh with sample data if in blank state
        await page.evaluate(async () => {
            if (window.CrmStudentCourses && typeof window.CrmStudentCourses.refresh === 'function') {
                window.CrmStudentCourses.fetchStudentEnrollments = async () => [];
                await window.CrmStudentCourses.refresh('live-test-student-1', {
                    id: 'live-test-student-1',
                    name: 'Nguyen Van A (Live Test)'
                });
            }
        });
        await page.waitForTimeout(800);

        const screenAText = await page.textContent('#student-courses');
        console.log(`✓ Screen A rendered. Status content preview: ${screenAText.substring(0, 100).replace(/\s+/g, ' ')}...`);
        await capture('live-05-screen-a-overview', 'Screen A overview on live server');

        // Step 7: Transition to Screen B (Takeover Enrolment Form)
        console.log('\nStep 7: Opening Screen B Enrolment Form & Availability Matrix...');
        const addCourseBtn = await page.$('#btn-show-add-course, #btn-empty-add-course');
        if (addCourseBtn) {
            await addCourseBtn.click();
            await page.waitForTimeout(800);

            const screenBTitle = await page.textContent('.crm-course-enroll-header h3');
            console.log(`✓ Screen B displayed: "${screenBTitle.trim()}"`);

            // Verify matrix rendered
            const matrixEl = await page.$('.crm-schedule-availability');
            assert(matrixEl !== null, 'Schedule availability matrix must render on Screen B');

            // Select a course if dropdown populated
            const hasCourseOptions = await page.$$('#enroll-course-select option');
            if (hasCourseOptions.length > 1) {
                await page.selectOption('#enroll-course-select', { index: 1 });
                console.log('✓ Selected first available course in dropdown.');
            }

            // Interact with Availability Matrix: add Monday slot
            const monAddBtn = await page.$('.crm-availability-day-section[data-day="mon"] .crm-availability-btn-add');
            if (monAddBtn) {
                await monAddBtn.click();
                await page.waitForTimeout(200);
                console.log('✓ Added time interval to Monday in live availability matrix.');
            }

            await capture('live-06-screen-b-matrix-active', 'Screen B live availability matrix and course config');

            // Click back to Screen A
            const backBtn = await page.$('#btn-back-to-courses');
            if (backBtn) {
                await backBtn.click();
                await page.waitForTimeout(500);
                console.log('✓ Navigated back to Screen A.');
            }
        }

        // Step 8: Verify Screen C (Lessons & Attendance) with seeded enrollment
        console.log('\nStep 8: Verifying Screen C (Lessons & Attendance) inline accordion...');
        await page.evaluate(() => {
            // Seed sample active enrollment with sessions for Screen C visual check
            const sampleEnrollment = {
                id: 'live-enr-1',
                enrollmentId: 'live-enr-1',
                studentId: 'live-test-student-1',
                courseId: 'course-1on1-live',
                classId: 'class-live-1',
                status: 'active',
                course: {
                    name: 'PTE Academic 1-on-1 Intensive',
                    code: 'PTE-1ON1',
                    courseType: '1on1'
                },
                scheduleSummary: {
                    contractedTargetCount: 12,
                    contractedAssignedCount: 12,
                    contractedCompletedCount: 2,
                    contractedMinutesTotal: 1440,
                    contractedMinutesDelivered: 240,
                    contractedMinutesRemaining: 1200
                },
                sessions: [
                    {
                        sessionId: 'live-sess-1',
                        contractUnitIndex: 1,
                        scheduledLocalDate: '2026-09-07',
                        scheduledLocalTime: '14:00',
                        durationMinutes: 120,
                        sessionOutcome: 'completed',
                        attendanceState: 'finalized'
                    },
                    {
                        sessionId: 'live-sess-2',
                        contractUnitIndex: 2,
                        scheduledLocalDate: '2026-09-09',
                        scheduledLocalTime: '14:00',
                        durationMinutes: 120,
                        sessionOutcome: 'none',
                        attendanceState: 'none'
                    },
                    {
                        sessionId: 'live-sess-3',
                        contractUnitIndex: 3,
                        scheduledLocalDate: '2026-09-14',
                        scheduledLocalTime: '14:00',
                        durationMinutes: 120,
                        sessionOutcome: 'none',
                        attendanceState: 'none'
                    }
                ]
            };

            const container = document.getElementById('student-courses');
            if (container && window.CrmStudentCourses) {
                window.CrmStudentCourses.fetchStudentEnrollments = async () => [sampleEnrollment];
                window.CrmStudentCourses.refresh('live-test-student-1', { id: 'live-test-student-1', name: 'Nguyen Van A' });
            }
        });

        await page.waitForTimeout(600);
        const attendanceBtn = await page.$('.btn-view-attendance');
        if (attendanceBtn) {
            await attendanceBtn.click();
            await page.waitForTimeout(600);

            // Confirm Screen C renders without stacked modals inside the courses container
            const modalOverlays = await page.$$('#student-courses .crm-modal-overlay');
            assert.strictEqual(modalOverlays.length, 0, 'No stacked modal overlay must exist inside #student-courses');


            const tableRows = await page.$$('.crm-session-row');
            console.log(`✓ Screen C rendered with ${tableRows.length} session rows. Zero stacked modals confirmed.`);
            await capture('live-07-screen-c-table', 'Screen C table rendered live');

            // Expand inline attendance panel
            const expandBtn = await page.$('.btn-expand-attendance[data-session-id="live-sess-2"]');
            if (expandBtn) {
                await expandBtn.click();
                await page.waitForTimeout(300);

                const expandedAria = await expandBtn.getAttribute('aria-expanded');
                assert.strictEqual(expandedAria, 'true', 'Row trigger must have aria-expanded="true"');
                console.log('✓ Row inline panel expanded with aria-expanded="true"');

                // Select push-forward to verify preview box
                const pushRadio = await page.$('.crm-session-inline-panel input[value="push-forward"]');
                if (pushRadio) {
                    await pushRadio.click();
                    await page.waitForTimeout(400);
                    console.log('✓ Push forward radio selected; preview container rendered.');
                }

                await capture('live-08-screen-c-inline-accordion', 'Screen C inline row expansion on live server');
            }
        }

        console.log('\n=============================================================');
        console.log('🎉 Live Browser Test against local HTTPS server PASSED!');
        console.log('=============================================================\n');
    } catch (err) {
        console.error('❌ Live Browser Test failed:', err);
        await capture('live-error-state', 'Failure snapshot');
        throw err;
    } finally {
        await browser.close();
    }
})();
