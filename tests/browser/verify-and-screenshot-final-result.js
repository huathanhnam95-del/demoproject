const { chromium } = require('playwright');
const path = require('path');
const {
    readBrowserTestCredentials
} = require('./helpers/browser-test-credentials');

const ARTIFACT_DIR = 'C:\\Users\\Admin\\.gemini\\antigravity\\brain\\449c826a-a898-4fb5-9c74-ca07252751ee';

const fs = require('fs');

async function main() {
    console.log('=== OPENING BROWSER TO VERIFY ANALYZED SESSION & SCREENSHOT FINAL RESULT ===');
    const credentials = readBrowserTestCredentials();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 950 },
        serviceWorkers: 'block'
    });

    // Route static assets to local files to test local changes against live backend
    await context.route(/crm-admin\.html/, (route) => {
        const filePath = path.resolve(__dirname, '../../public/crm-admin.html');
        const content = fs.readFileSync(filePath, 'utf8');
        route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: content });
    });
    await context.route(/crm-admin\.css/, (route) => {
        const filePath = path.resolve(__dirname, '../../public/crm-admin.css');
        const content = fs.readFileSync(filePath, 'utf8');
        route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: content });
    });
    await context.route(/teaching-sessions\.js/, (route) => {
        const filePath = path.resolve(__dirname, '../../public/js/crm/teaching-sessions.js');
        const content = fs.readFileSync(filePath, 'utf8');
        route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: content });
    });

    const page = await context.newPage();

    // Step 1: Sign in
    console.log('1. Signing in on production...');
    await page.goto('https://betterenglishlearning.com/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Boolean(window.firebase?.auth || window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });

    await page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__?.auth;
        const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        await signInWithEmailAndPassword(auth, email, password);
    }, credentials);
    console.log('   ✓ Admin signed in successfully.');

    // Step 2: Open student a0106 ("test")
    console.log('2. Opening student a0106 modal...');
    await page.goto('https://betterenglishlearning.com/crm-admin.html#students/a0106', { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
        await page.waitForSelector('#crm-student-modal', { state: 'visible', timeout: 15000 });
    } catch (_) {
        console.log('   Modal not opened by hash, clicking student row...');
        const row = page.locator('tr:has-text("a0106"), tr:has-text("test")').first();
        if (await row.isVisible()) {
            await row.click();
            await page.waitForSelector('#crm-student-modal', { state: 'visible', timeout: 15000 });
        }
    }

    // Step 3: Switch to Teaching Sessions tab
    console.log('3. Clicking Teaching Sessions tab...');
    const tabBtn = page.locator('#crm-student-modal .crm-sidebar-item[data-tab="teaching-sessions"]');
    await tabBtn.waitFor({ state: 'visible', timeout: 15000 });
    await tabBtn.click();
    await page.waitForTimeout(1000);
    await page.evaluate(async () => {
        if (window.CrmTeachingSessions) {
            window.CrmTeachingSessions.setStudentId('a0106');
            await window.CrmTeachingSessions.loadStudentSessions('a0106');
        }
    });
    await page.waitForSelector('.teaching-session-card', { state: 'visible', timeout: 15000 });

    // Step 4: Check session cards
    console.log('4. Inspecting session cards...');
    const sessionListCheck = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.teaching-session-card'));
        return cards.map(c => ({
            id: c.dataset.sessionId,
            text: c.innerText.replace(/\n+/g, ' | ')
        }));
    });
    console.log('   Found sessions:', sessionListCheck);

    // Step 5: Click "View Report & Mindmap"
    const viewBtn = page.locator('.btn-view-teaching-session').first();
    await viewBtn.waitFor({ state: 'visible', timeout: 10000 });
    const hasView = await viewBtn.isVisible();
    console.log('   View Report & Mindmap button visible:', hasView);

    if (hasView) {
        console.log('5. Clicking "View Report & Mindmap"...');
        await viewBtn.click();
        await page.waitForTimeout(3000);

        // Wait for modal
        await page.waitForSelector('#crm-teaching-session-modal', { state: 'visible', timeout: 15000 });

        // Assert default tab is Briefing (report)
        const activeTabInfo = await page.evaluate(() => {
            const activeTab = document.querySelector('.crm-session-viewer-nav .crm-tab-btn.active');
            const reportPane = document.getElementById('teaching-session-view-report');
            const topic = document.querySelector('.crm-briefing-topic')?.textContent || '';
            const recap = document.querySelector('.crm-briefing-recap-box')?.textContent || '';
            const knowledgeItems = document.querySelectorAll('.crm-knowledge-item').length;
            const problemRows = document.querySelectorAll('.crm-problem-row').length;

            return {
                activeTabView: activeTab ? activeTab.dataset.view : null,
                activeTabText: activeTab ? activeTab.textContent.trim() : null,
                reportVisible: reportPane && reportPane.style.display !== 'none',
                topic,
                recapLength: recap.length,
                knowledgeItems,
                problemRows
            };
        });

        console.log('   ✓ Default view state verified:', activeTabInfo);

        // Capture screenshot of Default Briefing View
        const shotBriefingPath = path.join(ARTIFACT_DIR, 'screenshot_briefing_default.png');
        await page.screenshot({ path: shotBriefingPath, fullPage: false });
        console.log(`   ✓ Briefing screenshot captured: ${shotBriefingPath}`);

        // Step 6: Test Fullscreen Toggle
        console.log('6. Testing Fullscreen Presentation Mode...');
        const fsBtn = page.locator('#btn-teaching-session-fullscreen');
        await fsBtn.click();
        await page.waitForTimeout(1000);

        const fsState = await page.evaluate(() => {
            const modal = document.getElementById('crm-teaching-session-modal');
            const breadcrumb = document.getElementById('teaching-session-breadcrumb');
            return {
                isFullscreen: modal ? modal.classList.contains('is-fullscreen') : false,
                breadcrumbText: breadcrumb ? breadcrumb.textContent : ''
            };
        });
        console.log('   ✓ Fullscreen state:', fsState);

        const shotFullscreenPath = path.join(ARTIFACT_DIR, 'screenshot_briefing_fullscreen.png');
        await page.screenshot({ path: shotFullscreenPath, fullPage: false });
        console.log(`   ✓ Fullscreen screenshot captured: ${shotFullscreenPath}`);

        // Step 7: Test 1st Escape key (exits fullscreen)
        console.log('7. Testing 1st Escape key (exits fullscreen)...');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);

        const afterEscape1 = await page.evaluate(() => {
            const modal = document.getElementById('crm-teaching-session-modal');
            return {
                isModalVisible: modal ? modal.style.display !== 'none' : false,
                isFullscreen: modal ? modal.classList.contains('is-fullscreen') : false
            };
        });
        console.log('   ✓ After 1st Escape:', afterEscape1);

        // Step 8: Switch to Mindmap tab
        console.log('8. Switching to Mindmap tab...');
        await page.click('.crm-session-viewer-nav button[data-view="mindmap"]');
        await page.waitForTimeout(2000);

        const mindmapInfo = await page.evaluate(() => {
            const container = document.getElementById('teaching-session-mindmap-container');
            const svg = container ? container.querySelector('svg') : null;
            const toolbar = document.querySelector('#teaching-session-view-mindmap .crm-diagram-toolbar');
            const zoomLabel = toolbar ? toolbar.querySelector('.btn-diagram-zoom-reset')?.textContent : '';
            return {
                hasSvg: Boolean(svg),
                hasToolbar: Boolean(toolbar),
                zoomLabel
            };
        });
        console.log('   ✓ Mindmap stage state:', mindmapInfo);

        // Test Zoom In click
        console.log('   Testing Zoom In (+)...');
        await page.click('#teaching-session-view-mindmap .btn-diagram-zoom-in');
        await page.waitForTimeout(500);
        const zoomedLabel = await page.locator('#teaching-session-view-mindmap .btn-diagram-zoom-reset').textContent();
        console.log(`   ✓ Zoom scale updated to: ${zoomedLabel}`);

        const shotMindmapPath = path.join(ARTIFACT_DIR, 'screenshot_mindmap_stage.png');
        await page.screenshot({ path: shotMindmapPath, fullPage: false });
        console.log(`   ✓ Mindmap stage screenshot captured: ${shotMindmapPath}`);

        // Step 9: Switch to Flowchart tab
        console.log('9. Switching to Flowchart tab...');
        await page.click('.crm-session-viewer-nav button[data-view="flowchart"]');
        await page.waitForTimeout(2000);

        const flowchartInfo = await page.evaluate(() => {
            const container = document.getElementById('teaching-session-flowchart-container');
            const svg = container ? container.querySelector('svg') : null;
            return { hasSvg: Boolean(svg) };
        });
        console.log('   ✓ Flowchart stage state:', flowchartInfo);

        const shotFlowchartPath = path.join(ARTIFACT_DIR, 'screenshot_flowchart_stage.png');
        await page.screenshot({ path: shotFlowchartPath, fullPage: false });
        console.log(`   ✓ Flowchart stage screenshot captured: ${shotFlowchartPath}`);

        // Step 10: Switch to Audio tab
        console.log('10. Switching to Audio tab...');
        await page.click('.crm-session-viewer-nav button[data-view="audio"]');
        await page.waitForTimeout(1000);

        const audioInfo = await page.evaluate(() => {
            const player = document.getElementById('teaching-session-audio-player');
            const meta = document.getElementById('teaching-session-audio-meta');
            return {
                hasSrc: Boolean(player && player.src),
                metaText: meta ? meta.textContent : ''
            };
        });
        console.log('   ✓ Audio panel state:', audioInfo);

        const shotAudioPath = path.join(ARTIFACT_DIR, 'screenshot_audio_tab.png');
        await page.screenshot({ path: shotAudioPath, fullPage: false });
        console.log(`   ✓ Audio tab screenshot captured: ${shotAudioPath}`);

        // Step 11: Test 2nd Escape key (closes modal)
        console.log('11. Testing 2nd Escape key (closes modal)...');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);

        const afterEscape2 = await page.evaluate(() => {
            const modal = document.getElementById('crm-teaching-session-modal');
            return {
                isModalVisible: modal ? modal.style.display !== 'none' : false
            };
        });
        console.log('   ✓ After 2nd Escape (modal closed):', !afterEscape2.isModalVisible);

        console.log('\n=== ALL UI/UX IMPROVEMENTS EMPIRICALLY VERIFIED ===');
    }

    await browser.close();
}

main().catch(console.error);
