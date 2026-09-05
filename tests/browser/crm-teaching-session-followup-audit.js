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

if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function shot(name) {
    return path.join(SCREENSHOT_DIR, `${name}.png`);
}

async function signInOnPage(page, credentials) {
    return page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__?.auth;
        if (!auth) throw new Error('Firebase auth not available.');
        const { signInWithEmailAndPassword } = await import(
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
        );
        const result = await signInWithEmailAndPassword(auth, email, password);
        return { uid: result?.user?.uid || '' };
    }, credentials);
}

async function waitForCrmReady(page) {
    await page.waitForFunction(
        () => {
            const gate = document.getElementById('crm-loading');
            return gate && getComputedStyle(gate).display === 'none';
        },
        null,
        { timeout: 60000 }
    );
}

(async () => {
    const credentials = readBrowserTestCredentials();
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    try {
        // Sign in
        console.log('Signing in...');
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        await signInOnPage(page, credentials);

        // Navigate to student
        console.log('Navigating to student...');
        await page.goto(`${ORIGIN}/crm-admin.html#students/${STUDENT_ID}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await waitForCrmReady(page);
        await page.waitForSelector(`[data-panel="students"]`, { state: 'visible', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Click Teaching Sessions tab
        await page.evaluate(() => {
            const tabs = document.querySelectorAll('.crm-student-tab, [data-student-tab]');
            for (const t of tabs) {
                if (t.textContent.includes('Teaching')) { t.click(); return; }
            }
        });
        await page.waitForTimeout(3000);

        // Check all session statuses
        const sessions = await page.evaluate(() => {
            const cards = document.querySelectorAll('.crm-teaching-session-card, [data-session-id]');
            return Array.from(cards).map((c, i) => ({
                index: i,
                text: c.textContent.trim().slice(0, 200),
                hasViewBtn: Boolean(c.querySelector('button')),
                status: c.querySelector('.crm-session-status')?.textContent?.trim() || 'unknown'
            }));
        });
        console.log('Sessions found:', JSON.stringify(sessions, null, 2));
        await page.screenshot({ path: shot('20-sessions-list'), fullPage: false });

        // Check if second session (the new upload) is done
        const newSessionReady = sessions.length >= 2 && !sessions[1].text.includes('Processing') && !sessions[1].text.includes('Analyzing');
        console.log(`New session ready: ${newSessionReady}`);

        // If new session is ready, view it; otherwise view the first one
        const targetIdx = newSessionReady ? 1 : 0;
        console.log(`Opening session index ${targetIdx}...`);

        // Click the View button on the target session
        await page.evaluate((idx) => {
            const cards = document.querySelectorAll('.crm-teaching-session-card, [data-session-id]');
            if (cards[idx]) {
                const btn = cards[idx].querySelector('button');
                if (btn) btn.click();
                else cards[idx].click();
            }
        }, targetIdx);
        await page.waitForTimeout(4000);
        await page.screenshot({ path: shot('21-viewer-briefing'), fullPage: false });

        // Extract briefing text for language audit
        const briefing = await page.evaluate(() => {
            const recap = document.querySelector('.crm-recap-box, .crm-session-recap');
            const rules = document.querySelectorAll('.crm-knowledge-rule');
            const fixes = document.querySelectorAll('.crm-knowledge-teacher-fix, .crm-teacher-fix');
            const problems = document.querySelectorAll('.crm-problem-summary, .crm-problem-accordion-header');
            return {
                recapText: recap?.textContent?.trim()?.slice(0, 600) || '',
                rules: Array.from(rules).map(r => r.textContent?.trim()?.slice(0, 400)),
                fixes: Array.from(fixes).map(f => f.textContent?.trim()?.slice(0, 400)),
                problems: Array.from(problems).map(p => p.textContent?.trim()?.slice(0, 200)),
                viewerTitle: document.querySelector('.crm-session-viewer-container h2, .crm-modal-fullscreen h2')?.textContent?.trim() || ''
            };
        });
        console.log('\n=== BRIEFING LANGUAGE AUDIT ===');
        console.log('Title:', briefing.viewerTitle);
        console.log('Recap:', briefing.recapText);
        console.log('Rules:', JSON.stringify(briefing.rules, null, 2));
        console.log('Fixes:', JSON.stringify(briefing.fixes, null, 2));
        console.log('Problems:', JSON.stringify(briefing.problems, null, 2));

        // Language quality metrics
        const allSentences = [briefing.recapText, ...briefing.rules, ...briefing.fixes].join(' ');
        const sentences = allSentences.split(/[.。!?]\s+/).filter(s => s.length > 5);
        const avgWords = sentences.map(s => s.split(/\s+/).length);
        const avgSentenceLength = avgWords.length > 0 ? Math.round(avgWords.reduce((a, b) => a + b, 0) / avgWords.length) : 0;
        const longSentences = avgWords.filter(w => w > 25).length;
        console.log(`\nLanguage metrics: ${sentences.length} sentences, avg ${avgSentenceLength} words/sentence, ${longSentences} sentences over 25 words`);

        // Now click Mindmap tab
        console.log('\nSwitching to Mindmap tab...');
        const mindmapClicked = await page.evaluate(() => {
            const tabs = document.querySelectorAll('.crm-session-tab-btn, [data-session-view], button');
            for (const t of tabs) {
                const txt = t.textContent.trim();
                if (txt === 'Mindmap' || txt.includes('Mindmap')) {
                    t.click();
                    return true;
                }
            }
            return false;
        });
        if (mindmapClicked) {
            await page.waitForTimeout(3000);
            await page.screenshot({ path: shot('22-mindmap'), fullPage: false });
            console.log('Mindmap screenshot taken.');

            // Audit mindmap structure
            const mindmapInfo = await page.evaluate(() => {
                const svgs = document.querySelectorAll('svg');
                const mermaidSvg = Array.from(svgs).find(s => s.closest('.crm-diagram-stage') || s.id?.includes('mermaid'));
                return {
                    svgFound: Boolean(mermaidSvg),
                    nodeCount: mermaidSvg ? mermaidSvg.querySelectorAll('.node, .mindmap-node, [class*="node"]').length : 0,
                    textNodes: mermaidSvg ? Array.from(mermaidSvg.querySelectorAll('text, foreignObject')).slice(0, 15).map(t => t.textContent?.trim()?.slice(0, 60)) : []
                };
            });
            console.log('Mindmap info:', JSON.stringify(mindmapInfo, null, 2));
        } else {
            console.log('Mindmap tab not found.');
        }

        // Now click Flowchart tab
        console.log('\nSwitching to Flowchart tab...');
        const flowchartClicked = await page.evaluate(() => {
            const tabs = document.querySelectorAll('.crm-session-tab-btn, [data-session-view], button');
            for (const t of tabs) {
                const txt = t.textContent.trim();
                if (txt === 'Flowchart' || txt.includes('Flowchart')) {
                    t.click();
                    return true;
                }
            }
            return false;
        });
        if (flowchartClicked) {
            await page.waitForTimeout(3000);
            await page.screenshot({ path: shot('23-flowchart'), fullPage: false });
            console.log('Flowchart screenshot taken.');

            const flowchartInfo = await page.evaluate(() => {
                const svgs = document.querySelectorAll('svg');
                const mermaidSvg = Array.from(svgs).find(s => s.closest('.crm-diagram-stage') || s.id?.includes('mermaid'));
                return {
                    svgFound: Boolean(mermaidSvg),
                    nodeCount: mermaidSvg ? mermaidSvg.querySelectorAll('.node, .flowchart-node, [class*="node"]').length : 0,
                    edgeCount: mermaidSvg ? mermaidSvg.querySelectorAll('.edge, .flowchart-link, [class*="edge"]').length : 0,
                    textNodes: mermaidSvg ? Array.from(mermaidSvg.querySelectorAll('text, foreignObject span')).slice(0, 15).map(t => t.textContent?.trim()?.slice(0, 60)) : []
                };
            });
            console.log('Flowchart info:', JSON.stringify(flowchartInfo, null, 2));
        } else {
            console.log('Flowchart tab not found.');
        }

        // Check if the new session is still processing — if so, wait up to 5 more minutes
        if (!newSessionReady && sessions.length >= 2) {
            console.log('\n=== WAITING FOR NEW SESSION ANALYSIS ===');
            // Close viewer first
            await page.evaluate(() => {
                const closeBtn = document.querySelector('.crm-session-viewer-overlay .crm-modal-close, button:has-text("Close"), button:has-text("Đóng")');
                if (closeBtn) closeBtn.click();
            });
            await page.waitForTimeout(1000);

            const maxWait = 300000;
            const start = Date.now();
            let done = false;
            while (!done && (Date.now() - start) < maxWait) {
                await page.waitForTimeout(15000);
                // Reload sessions
                await page.evaluate(() => {
                    const tabs = document.querySelectorAll('.crm-student-tab, [data-student-tab]');
                    for (const t of tabs) {
                        if (t.textContent.includes('Teaching')) { t.click(); return; }
                    }
                });
                await page.waitForTimeout(3000);
                const newStatus = await page.evaluate(() => {
                    const cards = document.querySelectorAll('.crm-teaching-session-card, [data-session-id]');
                    if (cards.length < 2) return 'no-second-card';
                    return cards[1].textContent.includes('Processing') || cards[1].textContent.includes('Analyzing') ? 'processing' : 'ready';
                });
                const elapsed = Math.round((Date.now() - start) / 1000);
                console.log(`[${elapsed}s] New session status: ${newStatus}`);
                if (newStatus === 'ready') done = true;
            }

            if (done) {
                console.log('New session analysis complete! Opening...');
                await page.evaluate(() => {
                    const cards = document.querySelectorAll('.crm-teaching-session-card, [data-session-id]');
                    if (cards[1]) {
                        const btn = cards[1].querySelector('button');
                        if (btn) btn.click();
                    }
                });
                await page.waitForTimeout(4000);
                await page.screenshot({ path: shot('30-new-session-briefing'), fullPage: false });

                const newBriefing = await page.evaluate(() => {
                    const recap = document.querySelector('.crm-recap-box, .crm-session-recap');
                    const rules = document.querySelectorAll('.crm-knowledge-rule');
                    return {
                        recapText: recap?.textContent?.trim()?.slice(0, 600) || '',
                        rules: Array.from(rules).map(r => r.textContent?.trim()?.slice(0, 400)),
                        ruleCount: rules.length
                    };
                });
                console.log('\n=== NEW SESSION BRIEFING ===');
                console.log('Recap:', newBriefing.recapText);
                console.log('Rules:', JSON.stringify(newBriefing.rules, null, 2));

                // Mindmap of new session
                const mm = await page.evaluate(() => {
                    const tabs = document.querySelectorAll('.crm-session-tab-btn, [data-session-view], button');
                    for (const t of tabs) {
                        if (t.textContent.trim() === 'Mindmap') { t.click(); return true; }
                    }
                    return false;
                });
                if (mm) {
                    await page.waitForTimeout(3000);
                    await page.screenshot({ path: shot('31-new-session-mindmap'), fullPage: false });
                }

                const fc = await page.evaluate(() => {
                    const tabs = document.querySelectorAll('.crm-session-tab-btn, [data-session-view], button');
                    for (const t of tabs) {
                        if (t.textContent.trim() === 'Flowchart') { t.click(); return true; }
                    }
                    return false;
                });
                if (fc) {
                    await page.waitForTimeout(3000);
                    await page.screenshot({ path: shot('32-new-session-flowchart'), fullPage: false });
                }
            } else {
                console.log('New session still processing after 5 minutes. Taking screenshot of current state.');
                await page.screenshot({ path: shot('30-still-processing'), fullPage: false });
            }
        }

        console.log('\n=== FOLLOW-UP AUDIT COMPLETE ===');
        console.log('Screenshots:', fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png')).sort().join(', '));
    } catch (error) {
        await page.screenshot({ path: shot('followup-error'), fullPage: false }).catch(() => {});
        console.error(redactAuthIdentity(error.stack || error.message, credentials));
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();
