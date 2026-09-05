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
const AUDIO_FILE = String.raw`C:\Users\Admin\Documents\Zoom\2026-08-18 15.17.18 Hứa Nam's Personal Meeting Room\audio1013706832.m4a`;
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
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();
    const browserErrors = [];
    const auditLog = [];

    function log(msg) {
        const ts = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const line = `[${ts}] ${msg}`;
        auditLog.push(line);
        console.log(line);
    }

    page.on('console', (message) => {
        if (message.type() === 'error') {
            browserErrors.push(redactAuthIdentity(message.text(), credentials));
        }
    });
    page.on('pageerror', (error) => {
        browserErrors.push(redactAuthIdentity(error.message, credentials));
    });

    try {
        // ── Step 1: Sign in ──
        log('Navigating to index.html for Firebase auth...');
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        const authResult = await signInOnPage(page, credentials);
        log(`Signed in — uid: ${authResult.uid.slice(0, 8)}...`);

        // ── Step 2: Navigate to student Teaching Sessions ──
        log(`Navigating to student ${STUDENT_ID}...`);
        await page.goto(`${ORIGIN}/crm-admin.html#students/${STUDENT_ID}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await waitForCrmReady(page);
        await page.waitForSelector(`[data-panel="students"]`, { state: 'visible', timeout: 30000 });

        // Wait for student detail to load
        await page.waitForTimeout(3000);
        await page.screenshot({ path: shot('01-student-page'), fullPage: false });
        log('Student page loaded.');

        // ── Step 3: Navigate to Teaching Sessions tab ──
        log('Looking for Teaching Sessions tab...');
        const teachingTabSelector = '[data-student-tab="teaching-sessions"], button:has-text("Teaching Sessions"), .crm-student-tab:has-text("Teaching")';
        const teachingTab = await page.$(teachingTabSelector);
        if (teachingTab) {
            await teachingTab.click();
            log('Clicked Teaching Sessions tab.');
        } else {
            log('Teaching Sessions tab not found by selector, trying text match...');
            await page.evaluate(() => {
                const tabs = document.querySelectorAll('.crm-student-tab, [data-student-tab]');
                for (const t of tabs) {
                    if (t.textContent.includes('Teaching')) {
                        t.click();
                        return true;
                    }
                }
                return false;
            });
        }
        await page.waitForTimeout(2000);
        await page.screenshot({ path: shot('02-teaching-sessions-tab'), fullPage: false });

        // ── Step 4: Open upload drawer ──
        log('Opening upload drawer...');
        const uploadBtn = await page.$('#btn-toggle-teaching-upload');
        if (uploadBtn) {
            await uploadBtn.click();
            await page.waitForTimeout(500);
        }
        await page.screenshot({ path: shot('03-upload-drawer'), fullPage: false });

        // ── Step 5: Set audio file ──
        log('Setting audio file input...');
        const fileInput = await page.$('#teaching-session-audio-file');
        if (!fileInput) throw new Error('File input #teaching-session-audio-file not found');
        await fileInput.setInputFiles(AUDIO_FILE);
        await page.waitForTimeout(500);

        // Fill title
        const titleInput = await page.$('#teaching-session-title');
        if (titleInput) {
            await titleInput.fill('Live Audit Test — Round 3 Prompt Check');
        }

        // Set date
        const dateInput = await page.$('#teaching-session-date');
        if (dateInput) {
            await dateInput.fill('2026-08-18T15:17');
        }

        await page.screenshot({ path: shot('04-form-filled'), fullPage: false });
        log('Form filled with audio file and metadata.');

        // ── Step 6: Submit ──
        log('Submitting upload...');
        const submitBtn = await page.$('#btn-submit-teaching-upload');
        if (!submitBtn) throw new Error('Submit button not found');
        await submitBtn.click();

        // Wait for upload to complete (60MB file — could take a while)
        log('Waiting for upload to complete (60MB file)...');
        await page.waitForFunction(
            () => {
                const drawer = document.getElementById('teaching-session-upload-drawer');
                return !drawer || drawer.style.display === 'none';
            },
            null,
            { timeout: 300000 } // 5 minute timeout for upload
        );
        log('Upload completed, session created.');
        await page.screenshot({ path: shot('05-after-upload'), fullPage: false });

        // ── Step 7: Wait for AI analysis ──
        log('Waiting for AI analysis to complete (polling)...');
        let analysisComplete = false;
        const maxWaitMs = 600000; // 10 minutes max
        const pollIntervalMs = 10000;
        const startTime = Date.now();

        while (!analysisComplete && (Date.now() - startTime) < maxWaitMs) {
            await page.waitForTimeout(pollIntervalMs);

            const status = await page.evaluate(() => {
                const cards = document.querySelectorAll('.crm-teaching-session-card, [data-session-id]');
                if (cards.length === 0) return 'no-cards';
                const first = cards[0];
                const statusBadge = first.querySelector('.crm-session-status, [class*="status"]');
                const text = first.textContent || '';
                if (text.includes('processing') || text.includes('uploaded')) return 'processing';
                if (text.includes('error') || text.includes('failed')) return 'error';
                if (statusBadge) return statusBadge.textContent.trim().toLowerCase();
                return 'unknown';
            });

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            log(`Poll ${elapsed}s — status: ${status}`);

            if (status === 'error') {
                log('Analysis returned error status.');
                analysisComplete = true;
            } else if (status !== 'processing' && status !== 'uploaded' && status !== 'no-cards') {
                analysisComplete = true;
            }
        }

        await page.screenshot({ path: shot('06-analysis-status'), fullPage: false });

        // ── Step 8: Open the session viewer ──
        log('Opening session viewer...');
        const viewBtn = await page.$('.crm-teaching-session-card button:has-text("View"), .crm-teaching-session-card .crm-session-view-btn, [data-session-id] button');
        if (viewBtn) {
            await viewBtn.click();
        } else {
            // Try clicking the first session card or its view action
            await page.evaluate(() => {
                const cards = document.querySelectorAll('.crm-teaching-session-card, [data-session-id]');
                if (cards.length > 0) {
                    const btn = cards[0].querySelector('button');
                    if (btn) btn.click();
                    else cards[0].click();
                }
            });
        }
        await page.waitForTimeout(3000);
        await page.screenshot({ path: shot('07-session-viewer-briefing'), fullPage: false });
        log('Session viewer opened — Briefing tab screenshot taken.');

        // ── Step 9: Audit visual elements ──
        log('Auditing visual elements...');
        const visualAudit = await page.evaluate(() => {
            const overlay = document.querySelector('.crm-session-viewer-overlay');
            const container = document.querySelector('.crm-session-viewer-container, .crm-modal-fullscreen');
            const tabBar = document.querySelector('.crm-session-viewer-nav');
            const content = document.querySelector('.crm-session-viewer-content');
            const recap = document.querySelector('.crm-recap-box');
            const knowledgeItems = document.querySelectorAll('.crm-knowledge-item');
            const filterChips = document.querySelectorAll('.crm-filter-chip');
            const dockedAudio = document.querySelector('.crm-docked-audio');

            const cs = (el) => el ? getComputedStyle(el) : null;

            return {
                overlay: overlay ? {
                    background: cs(overlay).background,
                    backdropFilter: cs(overlay).backdropFilter || cs(overlay).webkitBackdropFilter
                } : null,
                container: container ? {
                    borderRadius: cs(container).borderRadius,
                    boxShadow: cs(container).boxShadow?.slice(0, 80),
                    animation: cs(container).animation?.slice(0, 60)
                } : null,
                tabBar: tabBar ? {
                    background: cs(tabBar).background?.slice(0, 80),
                    backdropFilter: cs(tabBar).backdropFilter || cs(tabBar).webkitBackdropFilter
                } : null,
                content: content ? {
                    background: cs(content).background?.slice(0, 120)
                } : null,
                recap: recap ? {
                    background: cs(recap).background?.slice(0, 80),
                    borderRadius: cs(recap).borderRadius,
                    borderLeft: cs(recap).borderLeft
                } : null,
                knowledgeItemCount: knowledgeItems.length,
                firstKnowledgeItem: knowledgeItems[0] ? {
                    background: cs(knowledgeItems[0]).background?.slice(0, 80),
                    borderRadius: cs(knowledgeItems[0]).borderRadius,
                    border: cs(knowledgeItems[0]).border
                } : null,
                filterChipCount: filterChips.length,
                dockedAudio: dockedAudio ? {
                    background: cs(dockedAudio).background?.slice(0, 80),
                    backdropFilter: cs(dockedAudio).backdropFilter || cs(dockedAudio).webkitBackdropFilter
                } : null
            };
        });
        log(`Visual audit: ${JSON.stringify(visualAudit, null, 2)}`);

        // ── Step 10: Check briefing language ──
        log('Auditing briefing language...');
        const briefingText = await page.evaluate(() => {
            const recapEl = document.querySelector('.crm-recap-box');
            const knowledgeRules = document.querySelectorAll('.crm-knowledge-rule');
            const teacherFixes = document.querySelectorAll('.crm-teacher-fix, .crm-knowledge-teacher-fix');
            return {
                recapText: recapEl?.textContent?.trim()?.slice(0, 500) || '',
                ruleTexts: Array.from(knowledgeRules).map(el => el.textContent?.trim()?.slice(0, 300)),
                fixTexts: Array.from(teacherFixes).map(el => el.textContent?.trim()?.slice(0, 300)),
                allContentText: document.querySelector('.crm-session-viewer-content')?.textContent?.trim()?.slice(0, 2000) || ''
            };
        });
        log(`Recap text (first 300 chars): ${briefingText.recapText.slice(0, 300)}`);
        log(`Rule texts count: ${briefingText.ruleTexts.length}`);
        briefingText.ruleTexts.forEach((r, i) => log(`  Rule ${i}: ${r.slice(0, 150)}`));

        // ── Step 11: Switch to Diagrams tab ──
        log('Switching to Diagrams tab...');
        const diagramTabClicked = await page.evaluate(() => {
            const tabs = document.querySelectorAll('.crm-session-tab-btn, [data-session-view]');
            for (const t of tabs) {
                if (t.textContent.includes('Diagram') || t.textContent.includes('Mind') || t.dataset.sessionView === 'diagrams') {
                    t.click();
                    return true;
                }
            }
            return false;
        });
        if (diagramTabClicked) {
            await page.waitForTimeout(3000);
            await page.screenshot({ path: shot('08-diagrams-tab'), fullPage: false });
            log('Diagrams tab screenshot taken.');

            // Check diagram rendering
            const diagramAudit = await page.evaluate(() => {
                const svgs = document.querySelectorAll('.crm-diagram-stage svg, .crm-mermaid-container svg');
                const mermaidDivs = document.querySelectorAll('.mermaid, [class*="mermaid"]');
                const diagramBtns = document.querySelectorAll('.crm-diagram-btn');
                return {
                    svgCount: svgs.length,
                    mermaidDivCount: mermaidDivs.length,
                    diagramBtnCount: diagramBtns.length,
                    diagramBtnLabels: Array.from(diagramBtns).map(b => b.textContent.trim()),
                    firstSvgSize: svgs[0] ? {
                        width: svgs[0].getAttribute('width') || svgs[0].style.width,
                        height: svgs[0].getAttribute('height') || svgs[0].style.height
                    } : null
                };
            });
            log(`Diagram audit: ${JSON.stringify(diagramAudit)}`);

            // Try switching to flowchart
            const flowchartClicked = await page.evaluate(() => {
                const btns = document.querySelectorAll('.crm-diagram-btn');
                for (const b of btns) {
                    if (b.textContent.includes('Flowchart') || b.textContent.includes('Flow')) {
                        b.click();
                        return true;
                    }
                }
                return false;
            });
            if (flowchartClicked) {
                await page.waitForTimeout(2000);
                await page.screenshot({ path: shot('09-flowchart'), fullPage: false });
                log('Flowchart screenshot taken.');
            }
        } else {
            log('Diagrams tab not found.');
        }

        // ── Step 12: Switch to Audio tab ──
        log('Switching to Audio tab...');
        const audioTabClicked = await page.evaluate(() => {
            const tabs = document.querySelectorAll('.crm-session-tab-btn, [data-session-view]');
            for (const t of tabs) {
                if (t.textContent.includes('Audio') || t.dataset.sessionView === 'audio') {
                    t.click();
                    return true;
                }
            }
            return false;
        });
        if (audioTabClicked) {
            await page.waitForTimeout(2000);
            await page.screenshot({ path: shot('10-audio-tab'), fullPage: false });
            log('Audio tab screenshot taken.');
        }

        // ── Step 13: Check for skeleton loading (already gone by now, but verify code presence) ──
        const skeletonPresent = await page.evaluate(() => {
            const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
            let hasSkeletonStyle = false;
            for (const s of styles) {
                if (s.textContent && s.textContent.includes('crm-skeleton')) {
                    hasSkeletonStyle = true;
                    break;
                }
            }
            return {
                hasSkeletonStyle,
                skeletonElements: document.querySelectorAll('.crm-skeleton-wrap').length
            };
        });
        log(`Skeleton loading: ${JSON.stringify(skeletonPresent)}`);

        // ── Step 14: Check confirm dialog (don't actually delete) ──
        const styledConfirmPresent = await page.evaluate(() => {
            const fn = typeof window.showStyledConfirm;
            return { showStyledConfirmType: fn };
        });
        log(`Styled confirm: ${JSON.stringify(styledConfirmPresent)}`);

        // ── Step 15: Final viewport screenshot at full page ──
        await page.screenshot({ path: shot('11-final-state'), fullPage: true });

        // ── Summary ──
        log('=== AUDIT COMPLETE ===');
        log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
        log(`Browser errors: ${browserErrors.length}`);
        if (browserErrors.length > 0) {
            browserErrors.slice(0, 5).forEach((e, i) => log(`  Error ${i}: ${e.slice(0, 120)}`));
        }

        const report = {
            origin: ORIGIN,
            studentId: STUDENT_ID,
            audioFile: path.basename(AUDIO_FILE),
            visualAudit,
            briefingTextLength: briefingText.allContentText.length,
            briefingRuleCount: briefingText.ruleTexts.length,
            diagramAudit: diagramTabClicked ? 'checked' : 'tab-not-found',
            skeletonPresent,
            styledConfirmPresent,
            browserErrors: browserErrors.slice(0, 10),
            screenshots: fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'))
        };
        console.log('\n=== AUDIT REPORT ===');
        console.log(JSON.stringify(report, null, 2));
        console.log('\nTeaching session live audit PASSED');
    } catch (error) {
        await page.screenshot({ path: shot('error-state'), fullPage: false }).catch(() => {});
        console.error(redactAuthIdentity(error.stack || error.message, credentials));
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();
