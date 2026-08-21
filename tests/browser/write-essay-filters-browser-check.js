const { chromium } = require('playwright');
const express = require('express');
const http = require('http');
const path = require('path');
const assert = require('assert');

(async () => {
    console.log("=== STARTING DIRECT WRITE ESSAY FILTERS TEST ===");

    const app = express();
    const publicDir = path.join(__dirname, '..', '..', 'public');
    app.use(express.json());
    app.use(express.static(publicDir));
    app.use((_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(path.join(publicDir, 'index.html'));
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    console.log(`Test harness running at ${origin}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    page.on('console', msg => {
        if (msg.type() === 'error' || msg.text().includes('WriteEssay')) {
            console.log(`[Browser Console ${msg.type()}]: ${msg.text()}`);
        }
    });
    page.on('pageerror', err => console.log(`[Browser PageError]: ${err.message}`));

    try {
        await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);

        // Remove blocking overlays
        await page.evaluate(() => {
            document.querySelectorAll('.app-preloader, #app-preloader, #entry-modal, .entry-modal, .tutorial-overlay, .cookie-banner, .welcome-modal').forEach(el => el.remove());
        });

        // Show mode-essay directly and call WriteEssayMode.init()
        console.log("Activating Write Essay panel...");
        const result = await page.evaluate(async () => {
            document.querySelectorAll('.mode-panel').forEach(p => {
                p.style.display = 'none';
                p.classList.remove('active');
            });
            const essayPanel = document.getElementById('mode-essay');
            if (essayPanel) {
                essayPanel.style.display = 'block';
                essayPanel.classList.add('active');
            }

            if (window.WriteEssayMode) {
                window.WriteEssayMode.init();
                await window.WriteEssayMode.loadEntries();
                return {
                    initialized: true,
                    entriesCount: window.WriteEssayMode ? 'loaded' : 'missing'
                };
            }
            return { initialized: false };
        });

        console.log("Activation result:", result);
        await page.waitForTimeout(1000);

        // Clean any late-injected overlays
        await page.evaluate(() => {
            document.querySelectorAll('.app-preloader, #app-preloader, #entry-modal, .entry-modal, .tutorial-overlay, .cookie-banner').forEach(el => el.remove());
        });

        // 1. Check prompt preview badges
        const pillText = await page.locator('#essay-v7-question-pill').textContent();
        console.log("Pill text:", pillText);

        const topicBadge = await page.locator('#essay-prompt-meta-badges .essay-topic-badge').textContent();
        const typeBadge = await page.locator('#essay-prompt-meta-badges .essay-type-badge').textContent();
        console.log(`Canvas badges -> Topic: "${topicBadge}", Type: "${typeBadge}"`);
        assert.ok(topicBadge.length > 0, "Topic badge should not be empty");
        assert.ok(typeBadge.length > 0, "Type badge should not be empty");

        // 2. Open Prompt Picker
        console.log("Opening prompt picker sheet...");
        await page.evaluate(() => {
            document.getElementById('essay-v7-question-pill').click();
        });
        await page.waitForSelector('#essay-v7-sheet.is-open', { timeout: 5000 });

        // 3. Check filter selects
        const typeOptions = await page.locator('#essay-filter-type option').allTextContents();
        const topicOptions = await page.locator('#essay-filter-topic option').allTextContents();
        console.log(`Filter Type Options (${typeOptions.length}):`, typeOptions);
        console.log(`Filter Topic Options (${topicOptions.length}):`, topicOptions.slice(0, 8), '...');

        assert.ok(typeOptions.length >= 6, "Expected at least 6 task type options");
        assert.ok(topicOptions.length >= 20, "Expected at least 20 topic options");

        // 4. Test Topic Filter = 'Ethics'
        console.log("Selecting Topic = 'Ethics'...");
        await page.selectOption('#essay-filter-topic', 'Ethics');
        await page.waitForTimeout(300);

        const ethicsCounter = await page.locator('#essay-filter-counter').textContent();
        console.log("Ethics filter counter:", ethicsCounter);
        
        const firstItemBadges = await page.locator('#essay-v7-jump-list .essay-v7-item-badges').first().textContent();
        console.log("First item badges:", firstItemBadges);
        assert.ok(firstItemBadges.includes('Ethics'), "Filtered items should have Ethics topic or secondary badge");

        // 5. Select a prompt from filtered list
        console.log("Clicking first Ethics prompt...");
        await page.evaluate(() => {
            const item = document.querySelector('#essay-v7-jump-list .ra-v7-list-item');
            if (item) item.click();
        });
        await page.waitForTimeout(500);

        const canvasBadges = await page.locator('#essay-prompt-meta-badges').textContent();
        console.log("Canvas badges after selection:", canvasBadges);
        assert.ok(canvasBadges.includes('Ethics'), "Canvas should display Ethics badge");

        // 6. Reopen and test Clear button
        console.log("Re-opening and clearing filter...");
        await page.evaluate(() => {
            document.getElementById('essay-v7-question-pill').click();
        });
        await page.waitForSelector('#essay-v7-sheet.is-open', { timeout: 5000 });
        await page.locator('#essay-filter-reset').click();
        await page.waitForTimeout(300);

        const resetCounter = await page.locator('#essay-filter-counter').textContent();
        console.log("Counter after reset:", resetCounter);
        assert.ok(resetCounter.includes('452') || resetCounter.includes('453'), "Should reset to full prompt count");

        // 7. Test Task Type Filter
        console.log("Selecting Type = 'Do the advantages outweigh the disadvantages'...");
        await page.selectOption('#essay-filter-type', 'Do the advantages outweigh the disadvantages');
        await page.waitForTimeout(300);

        const advCounter = await page.locator('#essay-filter-counter').textContent();
        console.log("Advantages/Disadvantages counter:", advCounter);
        const firstItemType = await page.locator('#essay-v7-jump-list .essay-v7-item-type').first().textContent();
        console.log("First item type badge:", firstItemType);
        assert.ok(firstItemType.includes('Advantages'), "Filtered items should have Advantages badge");

        // 8. Test Search Query in combination with Type Filter
        console.log("Typing search query 'technology'...");
        await page.fill('#essay-v7-jump-search', 'technology');
        await page.waitForTimeout(300);

        const searchCounter = await page.locator('#essay-filter-counter').textContent();
        console.log("Search + Type counter:", searchCounter);

        // 9. Test 0-match resilience and recovery
        console.log("Testing 0-match search string...");
        await page.fill('#essay-v7-jump-search', 'xyznonexistentterm123');
        await page.waitForTimeout(300);

        const zeroCounter = await page.locator('#essay-filter-counter').textContent();
        console.log("Zero match counter:", zeroCounter);
        assert.ok(zeroCounter.includes('0 of 452') || zeroCounter.includes('0 of 453'), "Should show 0 matches");

        const emptyMsg = await page.locator('#essay-v7-jump-list').textContent();
        console.log("Empty list message:", emptyMsg);
        assert.ok(emptyMsg.includes('No matching prompts'), "Should show friendly empty state in list");

        // Close sheet and check that question pill is NOT permanently disabled
        console.log("Closing picker sheet in 0-match state...");
        await page.evaluate(() => document.getElementById('essay-v7-sheet-close').click());
        await page.waitForTimeout(300);

        const pillDisabled = await page.locator('#essay-v7-question-pill').getAttribute('disabled');
        console.log("Pill disabled attribute:", pillDisabled);
        assert.strictEqual(pillDisabled, null, "Question pill must NOT be disabled so user can recover");

        // Click pill to reopen and clear
        console.log("Re-opening picker and clicking Clear...");
        await page.evaluate(() => document.getElementById('essay-v7-question-pill').click());
        await page.waitForSelector('#essay-v7-sheet.is-open', { timeout: 5000 });
        await page.evaluate(() => document.getElementById('essay-filter-reset').click());
        await page.waitForTimeout(300);

        // Close picker to return to prompt canvas
        await page.evaluate(() => document.getElementById('essay-v7-sheet-close').click());
        await page.waitForTimeout(300);

        // 10. Test Start Writing and verify Compose Card meta badges
        console.log("Clicking 'Start Writing'...");
        await page.evaluate(() => document.getElementById('start-essay-btn').click());
        await page.waitForSelector('#essay-practice-area', { state: 'visible', timeout: 5000 });

        const writeBadges = await page.locator('#essay-write-meta-badges').textContent();
        console.log("Active writing compose meta badges:", writeBadges);
        assert.ok(writeBadges.includes('📚'), "Write compose card should display primary topic badge");
        assert.ok(writeBadges.includes('✍️'), "Write compose card should display essay task type badge");

        console.log("\n>>> ALL TESTS PASSED SUCCESSFULLY AND VERIFIED EMPIRICALLY! <<<");
    } catch (e) {
        console.error("Test error:", e);
        process.exitCode = 1;
    } finally {
        await browser.close();
        server.close();
    }
})();
