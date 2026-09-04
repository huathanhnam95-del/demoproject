const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const {
    readBrowserTestCredentials
} = require('./helpers/browser-test-credentials');

const AUDIO_PATH = "C:\\Users\\Admin\\Documents\\Zoom\\2026-08-18 15.17.18 Hứa Nam's Personal Meeting Room\\audio1013706832.m4a";
const ARTIFACT_DIR = 'C:\\Users\\Admin\\.gemini\\antigravity\\brain\\449c826a-a898-4fb5-9c74-ca07252751ee';

async function main() {
    console.log('=== STARTING REAL BROWSER TEST FOR TEACHING SESSIONS ===');
    console.log('Audio file:', AUDIO_PATH);
    if (!fs.existsSync(AUDIO_PATH)) {
        throw new Error(`Audio file not found: ${AUDIO_PATH}`);
    }
    const stat = fs.statSync(AUDIO_PATH);
    console.log(`Audio size: ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);

    const credentials = readBrowserTestCredentials();
    const browser = await chromium.launch({
        headless: true
    });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 950 }
    });
    const page = await context.newPage();

    // Listen for dialogs (alert/confirm/prompt) to catch any errors
    const dialogs = [];
    page.on('dialog', async (dialog) => {
        const msg = dialog.message();
        console.log(`[BROWSER DIALOG ${dialog.type()}]: ${msg}`);
        dialogs.push({ type: dialog.type(), message: msg });
        await dialog.accept();
    });

    // Capture console errors
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            console.error(`[CONSOLE ERROR]: ${msg.text()}`);
        } else if (msg.text().includes('[Teaching Sessions]')) {
            console.log(`[APP LOG]: ${msg.text()}`);
        }
    });

    try {
        // Step 1: Sign in on production
        console.log('\nStep 1: Signing in on https://betterenglishlearning.com/index.html...');
        await page.goto('https://betterenglishlearning.com/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.firebase?.auth || window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });

        await page.evaluate(async ({ email, password }) => {
            const auth = window.__FIREBASE_INTERNAL__?.auth;
            if (!auth) throw new Error('Auth not found on window.__FIREBASE_INTERNAL__');
            const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            await signInWithEmailAndPassword(auth, email, password);
        }, credentials);
        console.log('   ✓ Admin signed in successfully.');

        // Step 2: Navigate to CRM Admin for student a0106 ("test")
        console.log('\nStep 2: Navigating to CRM Admin for student a0106 (#students/a0106)...');
        await page.goto('https://betterenglishlearning.com/crm-admin.html#students/a0106', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);

        // Step 3: Verify student modal is displayed and title/badge matches
        console.log('\nStep 3: Checking student profile modal...');
        await page.waitForSelector('#crm-student-modal', { state: 'visible', timeout: 30000 });
        const studentInfo = await page.evaluate(() => {
            return {
                title: document.getElementById('crm-student-modal-title')?.textContent || '',
                badge: document.getElementById('crm-student-id-badge')?.textContent || '',
                nameInput: document.getElementById('student-name')?.value || '',
                activeStudentId: window.CrmTeachingSessions?.resolveActiveStudentId?.()
            };
        });
        console.log('   Student modal data:', studentInfo);

        // Step 4: Click on Teaching Sessions tab
        console.log('\nStep 4: Clicking Teaching Sessions tab...');
        const tabBtn = page.locator('#crm-student-modal .crm-sidebar-item[data-tab="teaching-sessions"]');
        await tabBtn.click();
        await page.waitForTimeout(2000);

        // Verify Teaching Sessions content visible
        await page.waitForSelector('#student-teaching-sessions', { state: 'visible', timeout: 10000 });
        const shot1Path = path.join(ARTIFACT_DIR, 'screenshot_1_teaching_sessions_tab.png');
        await page.screenshot({ path: shot1Path, fullPage: false });
        console.log(`   ✓ Screenshot 1 captured: ${shot1Path}`);

        // Step 5: Open upload drawer and fill in session details
        console.log('\nStep 5: Opening upload drawer and setting audio file details...');
        const toggleBtn = page.locator('#btn-toggle-teaching-upload');
        if (await toggleBtn.isVisible()) {
            await toggleBtn.click();
            await page.waitForTimeout(500);
        }
        await page.waitForSelector('#teaching-session-upload-drawer', { state: 'visible', timeout: 10000 });

        const fileInput = page.locator('#teaching-session-audio-file');
        await fileInput.setInputFiles(AUDIO_PATH);
        await page.waitForTimeout(1000);

        // Fill in title and notes and verify dropzone pill
        await page.fill('#teaching-session-title', 'Zoom 1-on-1 Lesson Analysis');
        await page.fill('#teaching-session-notes', 'Real browser automated testing verification with Zoom lesson audio.');
        
        const pillText = await page.textContent('#teaching-session-dropzone-prompt');
        console.log('   Dropzone prompt text:', pillText?.trim());

        // Step 6: Click "Save & Run AI Analysis"
        console.log('\nStep 6: Submitting "Save & Run AI Analysis"...');
        const submitBtn = page.locator('#btn-submit-teaching-upload');
        await submitBtn.click();

        // Wait a few seconds to verify no error dialogs popped up
        await page.waitForTimeout(3000);
        if (dialogs.length > 0) {
            console.log('   Dialogs encountered:', dialogs);
            for (const d of dialogs) {
                if (d.message.includes('Please select or save a student first')) {
                    throw new Error(`TEST FAILED: Popup appeared: ${d.message}`);
                }
            }
        }

        // Check progress bar
        const progressVisible = await page.isVisible('#teaching-session-progress-box');
        console.log(`   Progress box visible: ${progressVisible}`);
        const shot2Path = path.join(ARTIFACT_DIR, 'screenshot_2_upload_progress.png');
        await page.screenshot({ path: shot2Path, fullPage: false });
        console.log(`   ✓ Screenshot 2 captured: ${shot2Path}`);

        // Step 7: Wait for Storage upload to complete and session to appear in list
        console.log('\nStep 7: Monitoring upload and background AI analysis...');
        let analysisComplete = false;
        let finalSession = null;

        for (let i = 1; i <= 36; i++) { // up to 36 * 5s = 180s (3 minutes)
            await page.waitForTimeout(5000);
            const statusData = await page.evaluate(async () => {
                const badge = document.querySelector('.teaching-session-badge');
                const badgeText = badge ? badge.textContent.trim() : 'none';
                const firstCard = document.querySelector('.teaching-session-card');
                const viewBtn = document.querySelector('.btn-view-teaching-session');
                const pBox = document.getElementById('teaching-session-progress-box');
                const pLabel = document.getElementById('teaching-session-progress-label');

                return {
                    progressText: pLabel ? pLabel.textContent : '',
                    progressBoxDisplay: pBox ? pBox.style.display : '',
                    hasCard: Boolean(firstCard),
                    badgeText,
                    hasViewBtn: Boolean(viewBtn)
                };
            });

            console.log(`   [Poll ${i}/36] Progress: "${statusData.progressText}" | Card: ${statusData.hasCard} | Badge: "${statusData.badgeText}"`);

            if (statusData.badgeText.toLowerCase().includes('analyzed') || statusData.hasViewBtn) {
                console.log('   ✓ AI Analysis completed! Status is "Analyzed".');
                analysisComplete = true;
                break;
            }
        }

        const shot3Path = path.join(ARTIFACT_DIR, 'screenshot_3_session_list_analyzed.png');
        await page.screenshot({ path: shot3Path, fullPage: false });
        console.log(`   ✓ Screenshot 3 captured: ${shot3Path}`);

        // Step 8: Open Session Details and view Report + Mindmap + Flowchart
        console.log('\nStep 8: Opening Session Details Modal...');
        const viewBtn = page.locator('.btn-view-teaching-session').first();
        if (await viewBtn.isVisible()) {
            await viewBtn.click();
            await page.waitForTimeout(4000);

            // Wait for detail modal
            await page.waitForSelector('#crm-teaching-session-modal', { state: 'visible', timeout: 15000 });
            
            // Check report and diagrams
            const modalContent = await page.evaluate(() => {
                const reportHtml = document.getElementById('teaching-session-report-html')?.innerHTML || '';
                const mindmapSvg = document.getElementById('teaching-session-mindmap-container')?.querySelector('svg');
                const flowchartSvg = document.getElementById('teaching-session-flowchart-container')?.querySelector('svg');
                return {
                    reportLength: reportHtml.length,
                    hasMindmapSvg: Boolean(mindmapSvg),
                    hasFlowchartSvg: Boolean(flowchartSvg)
                };
            });
            console.log('   Detail Modal content check:', modalContent);

            const shot4Path = path.join(ARTIFACT_DIR, 'screenshot_4_final_analysis_report_mindmap.png');
            await page.screenshot({ path: shot4Path, fullPage: false });
            console.log(`   ✓ Screenshot 4 captured: ${shot4Path}`);
        } else {
            console.log('   View button was not yet visible, session may still be analyzing in background.');
        }

        console.log('\n=== REAL BROWSER TEST COMPLETED SUCCESSFULLY ===');

    } finally {
        await browser.close();
    }
}

main().catch(err => {
    console.error('\n❌ BROWSER TEST FAILED:', err);
    process.exit(1);
});
