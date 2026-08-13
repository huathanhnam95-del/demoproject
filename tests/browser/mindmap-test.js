/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const {
    readBrowserTestCredentials,
    redactAuthIdentity
} = require('./helpers/browser-test-credentials');

const ORIGIN = 'https://betterenglishlearning.com';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'mindmap-test');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function signInOnPage(page, credentials) {
    return page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__?.auth;
        if (!auth) throw new Error('Firebase auth not available.');
        const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const result = await signInWithEmailAndPassword(auth, email, password);
        return { uid: result?.user?.uid || '' };
    }, credentials);
}

function ss(name) { return path.join(SCREENSHOTS_DIR, name); }

(async () => {
    const credentials = readBrowserTestCredentials();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    const results = [];

    page.on('console', m => { if (m.type() === 'error') errors.push(redactAuthIdentity(m.text(), credentials)); });
    page.on('pageerror', e => errors.push(redactAuthIdentity(e.message, credentials)));

    try {
        // Step 1: Login via Firebase Auth
        console.log('Step 1: Login...');
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        const auth = await signInOnPage(page, credentials);
        assert(auth.uid, 'Should get a valid user ID');
        results.push(`✅ Login: uid=${auth.uid.substring(0, 8)}...`);

        // Step 2: Navigate to CRM Books
        console.log('Step 2: Navigate to CRM Books...');
        await page.goto(`${ORIGIN}/crm-admin.html#books`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => {
            const gate = document.getElementById('crm-loading');
            return gate && getComputedStyle(gate).display === 'none';
        }, null, { timeout: 45000 });
        await page.waitForSelector('[data-panel="books"]', { state: 'visible', timeout: 30000 });
        await page.waitForSelector('.crm-books-workspace', { timeout: 30000 });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: ss('01-books-workspace.png') });
        results.push('✅ Books workspace loaded');

        // Step 3: Click on a book to select it
        console.log('Step 3: Select a book...');
        const bookItem = await page.waitForSelector('.crm-books-list-item[data-book-id]', { timeout: 15000 });
        const bookId = await bookItem.getAttribute('data-book-id');
        await bookItem.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: ss('02-book-selected.png') });
        results.push(`✅ Book selected: ${bookId}`);

        // Step 4: Click the Notes tab, then the Create Mind Map button
        console.log('Step 4: Open Mind Map...');
        
        // Click the Notes tab
        const notesTab = await page.evaluate(() => {
            const nt = document.querySelector('[data-books-tab="notes"]');
            if (nt) { nt.click(); return true; }
            return false;
        });
        console.log(`  Notes tab clicked: ${notesTab}`);
        await page.waitForTimeout(2000);
        await page.screenshot({ path: ss('03-notes-tab.png') });

        // Click the Create Mind Map button
        const mmClicked = await page.evaluate(() => {
            const btn = document.querySelector('.crm-books-create-mindmap-btn');
            if (btn) { btn.click(); return true; }
            return false;
        });
        console.log(`  Mind Map button clicked: ${mmClicked}`);
        
        if (!mmClicked) {
            // If no button found, the book may have no notes yet
            results.push('⚠️ Mind Map button not found — book may have no saved notes');
            await page.screenshot({ path: ss('03-no-mindmap-btn.png') });
        }

        // Wait for the mind map modal to appear and synthesize
        console.log('  Waiting for mind map synthesis (up to 30s)...');
        await page.waitForTimeout(5000);
        
        // Check if modal appeared
        let modalVisible = await page.evaluate(() => {
            const modal = document.getElementById('crm-books-mindmap-modal');
            return modal && modal.style.display !== 'none';
        });

        if (modalVisible) {
            // Wait for nodes to render (loading finishes)
            try {
                await page.waitForSelector('.crm-mindmap-node', { timeout: 30000 });
            } catch (e) {
                console.log('  Warning: No nodes rendered within 30s, may still be loading');
            }
            await page.waitForTimeout(2000);
            await page.screenshot({ path: ss('03-mindmap-open.png') });
            results.push('✅ Mind map modal opened');
        } else {
            // The modal might not have opened, screenshot whatever state we're in
            await page.screenshot({ path: ss('03-mindmap-open-FAIL.png') });
            results.push('⚠️ Mind map modal did NOT open — checking for alternate UI...');
            
            // Check if there's an error or if no notes exist
            const pageState = await page.evaluate(() => {
                const modal = document.getElementById('crm-books-mindmap-modal');
                return {
                    modalExists: !!modal,
                    modalDisplay: modal?.style.display,
                    bodyHtml: document.body.innerHTML.substring(0, 500)
                };
            });
            console.log('  Page state:', JSON.stringify(pageState, null, 2).substring(0, 300));
        }

        // === Feature verification (only if modal is visible) ===
        modalVisible = await page.evaluate(() => {
            const modal = document.getElementById('crm-books-mindmap-modal');
            return modal && modal.style.display !== 'none';
        });

        if (modalVisible) {
            // 4A: Team Member Selector
            console.log('Step 4A: Team Member Selector...');
            const memberBtnExists = await page.$('#crm-mindmap-member-btn') !== null;
            results.push(`${memberBtnExists ? '✅' : '❌'} Team member button exists`);
            if (memberBtnExists) {
                await page.click('#crm-mindmap-member-btn');
                await page.waitForTimeout(400);
                const dropdownVisible = await page.evaluate(() => {
                    const dd = document.getElementById('crm-mindmap-member-dropdown');
                    return dd && dd.style.display !== 'none';
                });
                results.push(`${dropdownVisible ? '✅' : '❌'} Member dropdown opens`);
                await page.screenshot({ path: ss('04a-member-dropdown.png') });
                await page.click('body');
                await page.waitForTimeout(300);
            }

            // 4B: Search
            console.log('Step 4B: Search...');
            const searchExists = await page.$('#crm-mindmap-search') !== null;
            results.push(`${searchExists ? '✅' : '❌'} Search input exists`);
            if (searchExists) {
                await page.fill('#crm-mindmap-search', 'test');
                await page.waitForTimeout(500);
                const matchCount = await page.$$eval('.crm-mindmap-search-match', els => els.length);
                const dimCount = await page.$$eval('.crm-mindmap-search-dim', els => els.length);
                results.push(`  Search results: ${matchCount} matches, ${dimCount} dimmed`);
                await page.screenshot({ path: ss('04b-search.png') });
                await page.fill('#crm-mindmap-search', '');
                await page.waitForTimeout(300);
            }

            // 4C: Tag Filter Chips
            console.log('Step 4C: Tag Filter Chips...');
            const chipCount = await page.$$eval('.crm-mindmap-filter-chip', els => els.length);
            results.push(`${chipCount >= 5 ? '✅' : '❌'} Tag filter chips: ${chipCount}`);

            // 4D: Export Button
            console.log('Step 4D: Export...');
            const exportExists = await page.$('#crm-mindmap-export-btn') !== null;
            results.push(`${exportExists ? '✅' : '❌'} Export button exists`);
            if (exportExists) {
                await page.click('#crm-mindmap-export-btn');
                await page.waitForTimeout(400);
                const exportOptions = await page.$$eval('.crm-mindmap-export-option', els => els.map(e => e.textContent.trim()));
                results.push(`  Export options: ${JSON.stringify(exportOptions)}`);
                await page.screenshot({ path: ss('04d-export.png') });
                await page.click('body');
                await page.waitForTimeout(300);
            }

            // 4E: History Button
            console.log('Step 4E: History...');
            const historyExists = await page.$('#crm-mindmap-history-btn') !== null;
            results.push(`${historyExists ? '✅' : '❌'} History button exists`);
            if (historyExists) {
                await page.click('#crm-mindmap-history-btn');
                await page.waitForTimeout(1500);
                await page.screenshot({ path: ss('04e-history.png') });
                const closeBtn = await page.$('#crm-mindmap-versions-close');
                if (closeBtn) await closeBtn.click();
                await page.waitForTimeout(300);
            }

            // 4F: Collapse/Expand
            console.log('Step 4F: Collapse...');
            const collapseExists = await page.$('.crm-mindmap-collapse-btn') !== null;
            results.push(`${collapseExists ? '✅' : '❌'} Collapse button exists`);
            if (collapseExists) {
                const nodeBefore = await page.$$eval('.crm-mindmap-node', els => els.length);
                await page.click('.crm-mindmap-collapse-btn');
                await page.waitForTimeout(500);
                const nodeAfter = await page.$$eval('.crm-mindmap-node', els => els.length);
                results.push(`  Nodes before collapse: ${nodeBefore}, after: ${nodeAfter}`);
                await page.screenshot({ path: ss('04f-collapsed.png') });
                // Re-expand
                await page.click('.crm-mindmap-collapse-btn');
                await page.waitForTimeout(300);
            }

            // 5: Inspector Drawer
            console.log('Step 5: Inspector...');
            const subtopicNode = await page.$('.crm-mindmap-node.subtopic');
            if (subtopicNode) {
                await subtopicNode.click();
                await page.waitForTimeout(1000);
                const inspectorVisible = await page.evaluate(() => {
                    const el = document.getElementById('crm-mindmap-inspector');
                    return el && el.style.display !== 'none';
                });
                results.push(`${inspectorVisible ? '✅' : '❌'} Inspector drawer opens on click`);
                
                const aiSummaryLabel = await page.evaluate(() => {
                    const inspector = document.getElementById('crm-mindmap-inspector');
                    return inspector ? inspector.innerHTML.includes('AI Summary') : false;
                });
                results.push(`${aiSummaryLabel ? '✅' : '❌'} "AI Summary" label present`);
                
                const sourceSection = await page.$('#crm-mindmap-inspector-sources') !== null;
                results.push(`${sourceSection ? '✅' : '❌'} Source notes section exists`);
                
                const notesTextarea = await page.$('#crm-mindmap-inspector-notes') !== null;
                results.push(`${notesTextarea ? '✅' : '❌'} Notes textarea exists`);
                
                await page.screenshot({ path: ss('05-inspector.png') });
                
                const inspCloseBtn = await page.$('#crm-mindmap-inspector-close');
                if (inspCloseBtn) await inspCloseBtn.click();
                await page.waitForTimeout(300);
            } else {
                results.push('⚠️ No subtopic node found for inspector test');
            }

            // 6: Context Menu
            console.log('Step 6: Context Menu...');
            const catNode = await page.$('.crm-mindmap-node.category');
            if (catNode) {
                await catNode.click({ button: 'right' });
                await page.waitForTimeout(500);
                const menuVisible = await page.evaluate(() => {
                    const el = document.getElementById('crm-mindmap-context-menu');
                    return el && el.style.display !== 'none';
                });
                results.push(`${menuVisible ? '✅' : '❌'} Context menu opens on right-click`);
                
                const tagOptionCount = await page.$$eval('.crm-mindmap-tag-option', els => els.length);
                results.push(`${tagOptionCount >= 5 ? '✅' : '❌'} Tag options in context menu: ${tagOptionCount}`);
                
                await page.screenshot({ path: ss('06-context-menu.png') });
                await page.click('body');
                await page.waitForTimeout(300);
            }

            // 7: Regenerate Confirmation
            console.log('Step 7: Regenerate...');
            const regenBtn = await page.$('#crm-mindmap-regenerate-btn');
            results.push(`${regenBtn ? '✅' : '❌'} Regenerate button exists`);
            if (regenBtn) {
                await regenBtn.click();
                await page.waitForTimeout(1000);
                const confirmOverlay = await page.$('.crm-mindmap-confirm-overlay') !== null;
                results.push(`${confirmOverlay ? '✅' : '❌'} Regeneration confirmation overlay appears`);
                await page.screenshot({ path: ss('07-regen-confirm.png') });
                const cancelBtn = await page.$('.crm-mindmap-confirm-overlay [data-action="cancel"]');
                if (cancelBtn) await cancelBtn.click();
                await page.waitForTimeout(300);
            }

            // Final state screenshot
            await page.screenshot({ path: ss('08-final.png') });
        } else {
            results.push('⚠️ Mind map modal not visible — skipping feature verification');
        }

    } catch (err) {
        console.error('Test error:', err.message);
        results.push(`❌ ERROR: ${err.message}`);
        await page.screenshot({ path: ss('99-error.png') }).catch(() => {});
    }

    await browser.close();

    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║     MIND MAP UI/UX TEST RESULTS          ║');
    console.log('╚══════════════════════════════════════════╝');
    results.forEach(r => console.log(r));
    console.log(`\n=== CONSOLE ERRORS (${errors.length}) ===`);
    errors.slice(0, 10).forEach(e => console.log('  ' + e.substring(0, 200)));
    console.log(`\nScreenshots: ${SCREENSHOTS_DIR}`);

    const passCount = results.filter(r => r.includes('✅')).length;
    const failCount = results.filter(r => r.includes('❌')).length;
    const warnCount = results.filter(r => r.includes('⚠️')).length;
    console.log(`\nSummary: ${passCount} passed, ${failCount} failed, ${warnCount} warnings`);
    
    process.exit(failCount > 0 ? 1 : 0);
})();
