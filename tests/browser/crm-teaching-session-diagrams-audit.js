/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const {
    readBrowserTestCredentials,
    redactAuthIdentity
} = require('./helpers/browser-test-credentials');

const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = 'https://betterenglishlearning.com';
const STUDENT_ID = 'a0106';
const SCREENSHOT_DIR = path.join(ROOT, 'tmp', 'teaching-session-audit');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
function shot(name) { return path.join(SCREENSHOT_DIR, `${name}.png`); }

async function signIn(page, creds) {
    return page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__?.auth;
        if (!auth) throw new Error('Firebase auth not available.');
        const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const r = await signInWithEmailAndPassword(auth, email, password);
        return { uid: r?.user?.uid || '' };
    }, creds);
}

(async () => {
    const creds = readBrowserTestCredentials();
    const browser = await chromium.launch({ headless: false });
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })).newPage();

    try {
        // Sign in
        console.log('Signing in...');
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        await signIn(page, creds);
        console.log('Signed in.');

        // Navigate to CRM student page
        await page.goto(`${ORIGIN}/crm-admin.html#students/${STUDENT_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => {
            const g = document.getElementById('crm-loading');
            return g && getComputedStyle(g).display === 'none';
        }, null, { timeout: 60000 });
        await page.waitForSelector('[data-panel="students"]', { state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2000);

        // Click student "test" row to open profile
        console.log('Opening student test profile...');
        const studentClicked = await page.evaluate(() => {
            const rows = document.querySelectorAll('tr[data-student-id], .crm-student-row');
            for (const r of rows) {
                if (r.dataset.studentId === 'a0106' || r.textContent.includes('test')) {
                    r.click();
                    return true;
                }
            }
            // Try clicking the student name link
            const links = document.querySelectorAll('a[href*="a0106"], td');
            for (const l of links) {
                if (l.textContent.trim() === 'test') {
                    l.click();
                    return true;
                }
            }
            return false;
        });
        console.log(`Student click result: ${studentClicked}`);
        await page.waitForTimeout(2000);

        // Click the Teaching Sessions tab in the student profile modal
        console.log('Clicking Teaching Sessions tab...');
        await page.evaluate(() => {
            // Look for any clickable element with "Teaching" text inside the modal
            const modal = document.querySelector('.crm-modal, .crm-student-detail, [class*="student-profile"]');
            const root = modal || document;
            const allClickables = root.querySelectorAll('a, button, div[role="tab"], li, span, .crm-student-tab, [data-student-tab]');
            for (const el of allClickables) {
                if (el.textContent.trim().includes('Teaching Sessions') || el.textContent.trim() === 'Teaching Sessions') {
                    console.log('Found Teaching Sessions element:', el.tagName, el.className);
                    el.click();
                    return true;
                }
            }
            return false;
        });
        await page.waitForTimeout(3000);
        await page.screenshot({ path: shot('40-teaching-tab'), fullPage: false });

        // Check sessions list
        const sessionInfo = await page.evaluate(() => {
            const container = document.getElementById('teaching-sessions-list-container') || document.querySelector('[id*="teaching-session"]');
            const allBtns = document.querySelectorAll('button');
            const viewBtns = Array.from(allBtns).filter(b =>
                b.textContent.includes('View Report') || b.textContent.includes('View') && b.closest('[class*="session"]')
            );
            const sessionCards = container ? container.querySelectorAll('div[style*="border"], div[class*="card"]') : [];
            return {
                containerFound: Boolean(container),
                containerHTML: container?.innerHTML?.slice(0, 500) || '',
                viewBtnCount: viewBtns.length,
                viewBtnTexts: viewBtns.map(b => b.textContent.trim().slice(0, 50)),
                cardCount: sessionCards.length
            };
        });
        console.log('Session info:', JSON.stringify(sessionInfo, null, 2));

        // Click first "View Report & Mindmap" button
        console.log('Clicking View Report button...');
        const viewClicked = await page.evaluate(() => {
            const allBtns = document.querySelectorAll('button');
            for (const b of allBtns) {
                if (b.textContent.includes('View Report')) {
                    b.click();
                    return b.textContent.trim();
                }
            }
            return null;
        });
        console.log(`View clicked: ${viewClicked}`);
        await page.waitForTimeout(4000);
        await page.screenshot({ path: shot('41-briefing-opened'), fullPage: false });

        // Now click Mindmap tab
        console.log('Clicking Mindmap tab...');
        const mmClicked = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, [role="tab"]');
            for (const b of btns) {
                if (b.textContent.trim() === 'Mindmap') {
                    b.click();
                    return true;
                }
            }
            return false;
        });
        console.log(`Mindmap clicked: ${mmClicked}`);
        await page.waitForTimeout(3000);
        await page.screenshot({ path: shot('42-mindmap'), fullPage: false });

        // Get mindmap details
        const mmDetails = await page.evaluate(() => {
            const stage = document.querySelector('.crm-diagram-stage, [class*="diagram"]');
            const svgs = stage ? stage.querySelectorAll('svg') : document.querySelectorAll('svg');
            const texts = [];
            for (const svg of svgs) {
                const tNodes = svg.querySelectorAll('text, foreignObject span, foreignObject div');
                for (const t of tNodes) {
                    const txt = t.textContent?.trim();
                    if (txt && txt.length > 1 && !txt.match(/^[0-9.]+$/)) texts.push(txt.slice(0, 80));
                }
            }
            return {
                stageFound: Boolean(stage),
                svgCount: svgs.length,
                uniqueTexts: [...new Set(texts)].slice(0, 20)
            };
        });
        console.log('Mindmap details:', JSON.stringify(mmDetails, null, 2));

        // Click Flowchart tab
        console.log('Clicking Flowchart tab...');
        const fcClicked = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, [role="tab"]');
            for (const b of btns) {
                if (b.textContent.trim() === 'Flowchart') {
                    b.click();
                    return true;
                }
            }
            return false;
        });
        console.log(`Flowchart clicked: ${fcClicked}`);
        await page.waitForTimeout(3000);
        await page.screenshot({ path: shot('43-flowchart'), fullPage: false });

        // Get flowchart details
        const fcDetails = await page.evaluate(() => {
            const stage = document.querySelector('.crm-diagram-stage, [class*="diagram"]');
            const svgs = stage ? stage.querySelectorAll('svg') : document.querySelectorAll('svg');
            const texts = [];
            for (const svg of svgs) {
                const tNodes = svg.querySelectorAll('text, foreignObject span, foreignObject div');
                for (const t of tNodes) {
                    const txt = t.textContent?.trim();
                    if (txt && txt.length > 1 && !txt.match(/^[0-9.]+$/)) texts.push(txt.slice(0, 80));
                }
            }
            return {
                stageFound: Boolean(stage),
                svgCount: svgs.length,
                uniqueTexts: [...new Set(texts)].slice(0, 25)
            };
        });
        console.log('Flowchart details:', JSON.stringify(fcDetails, null, 2));

        // Now check new session status
        console.log('\nChecking new session status...');
        // Close current viewer first
        await page.evaluate(() => {
            const closeBtns = document.querySelectorAll('button');
            for (const b of closeBtns) {
                if (b.textContent.trim() === 'Close' || b.textContent.trim() === 'Đóng') {
                    b.click();
                    return;
                }
            }
            // Try X button
            const xBtn = document.querySelector('.crm-modal-close, button[aria-label="Close"]');
            if (xBtn) xBtn.click();
        });
        await page.waitForTimeout(2000);

        const newSessionStatus = await page.evaluate(() => {
            const allText = document.body.textContent;
            const hasProcessing = allText.includes('Processing') || allText.includes('Analyzing');
            const hasRound3 = allText.includes('Round 3') || allText.includes('Live Audit');
            const viewBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('View Report'));
            return {
                hasProcessing,
                hasRound3,
                viewBtnCount: viewBtns.length
            };
        });
        console.log('New session status:', JSON.stringify(newSessionStatus));
        await page.screenshot({ path: shot('44-final-sessions-list'), fullPage: false });

        console.log('\n=== DIAGRAMS AUDIT COMPLETE ===');
    } catch (error) {
        await page.screenshot({ path: shot('diagrams-error'), fullPage: false }).catch(() => {});
        console.error(redactAuthIdentity(error.stack || error.message, creds));
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();
