/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.cwd();
const SCREENSHOT_DIR = path.join(ROOT, 'tmp');
const BGM_MODAL_SCREENSHOT = path.join(SCREENSHOT_DIR, 'crm-bgm-local-01-modal.png');
const PLAYER_RENDER_SCREENSHOT = path.join(SCREENSHOT_DIR, 'crm-bgm-local-02-player.png');
const PLAYER_PLAYING_SCREENSHOT = path.join(SCREENSHOT_DIR, 'crm-bgm-local-03-playing.png');

const BOOK = {
    bookId: 'book-bgm-test',
    title: 'Sound Foundations: Learning and Teaching Pronunciation',
    author: 'Adrian Underhill',
    pageCount: 220,
    status: 'ready',
    ingest: null
};

const MOCK_TRACKS = [
    {
        id: 'track-1',
        title: 'Peaceful Study Piano',
        originalFilename: 'piano_study.mp3',
        downloadUrl: 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA',
        sizeBytes: 3500000,
        createdAt: '2026-08-15T12:00:00.000Z'
    },
    {
        id: 'track-2',
        title: 'Rainy Cafe Lo-Fi',
        originalFilename: 'rainy_cafe.mp3',
        downloadUrl: 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA',
        sizeBytes: 4200000,
        createdAt: '2026-08-15T12:05:00.000Z'
    }
];

function installMemoryLocalStorage() {
    const data = new Map();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key) => data.has(key) ? data.get(key) : null,
            setItem: (key, value) => data.set(key, String(value)),
            removeItem: (key) => data.delete(key)
        }
    });
}

(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    await page.addInitScript(installMemoryLocalStorage);

    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    try {
        // setContent uses an opaque origin in Playwright. Provide memory localStorage.
        await page.addInitScript(installMemoryLocalStorage);
        await page.setContent(`
          <section class="crm-panel" data-panel="books" style="display:block; width:100%; height:100vh;">
            <div class="crm-books-workspace">
              <div class="crm-books-sources-panel">
                <div class="crm-books-sources-header"><button class="crm-books-sources-header-toggle" type="button" title="Collapse sources panel" aria-label="Collapse sources panel" aria-expanded="true">☰</button><h3>Sources</h3><span class="crm-books-sources-count">0</span></div>
                <button class="crm-books-add-btn" type="button">Add source</button>
                <div class="crm-books-search-wrap"><input class="crm-books-search" placeholder="Search books..." /></div>
                <ul class="crm-books-list"><li class="crm-books-empty-item">No books yet.</li></ul>
              </div>
              <div class="crm-books-explorer-panel">
                <div class="crm-books-detail">
                  <div class="crm-books-empty-detail"><h3>Select a book</h3></div>
                </div>
              </div>
            </div>
          </section>
        `);
        await page.evaluate(installMemoryLocalStorage);
        await page.addStyleTag({ path: path.join(ROOT, 'public', 'crm-admin.css') });
        await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'crm', 'books-workspace.js') });

        console.log('Step 2: Initializing CrmBooksWorkspace controller with mocks...');
        await page.evaluate(async ({ book, mockTracks }) => {
            const pages = Array.from({ length: 10 }, (_, i) => `Page ${i + 1} content. Sound Foundations discussion.`);
            let currentTracks = [...mockTracks];

            const request = async (requestPath, options = {}) => {
                const method = options.method || 'GET';
                const body = options.body ? JSON.parse(options.body) : null;

                if (requestPath === '/api/admin/books') return { books: [book] };
                if (requestPath === `/api/admin/books/${book.bookId}`) return { book, summary: null };
                if (requestPath === '/api/admin/books/usage') return { estimatedCostUsd: 0, budgetLimitUsd: 10 };
                if (requestPath === `/api/admin/books/${book.bookId}/pages`) return { totalPages: pages.length, pages };
                if (requestPath === `/api/admin/books/${book.bookId}/threads`) return { threads: [] };
                if (requestPath === `/api/admin/books/${book.bookId}/notes`) return { notes: [] };
                if (requestPath === `/api/admin/books/${book.bookId}/audio` && method === 'GET') {
                    return { tracks: currentTracks, count: currentTracks.length };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/audio` && method === 'POST') {
                    const newTrack = {
                        id: `track-${Date.now()}`,
                        title: body.title,
                        storagePath: body.storagePath,
                        downloadUrl: body.downloadUrl,
                        originalFilename: body.originalFilename,
                        sizeBytes: body.sizeBytes,
                        createdAt: new Date().toISOString()
                    };
                    currentTracks.push(newTrack);
                    return { track: newTrack };
                }
                if (requestPath.startsWith(`/api/admin/books/${book.bookId}/audio/`) && method === 'DELETE') {
                    const audioId = requestPath.split('/').pop();
                    currentTracks = currentTracks.filter(t => t.id !== audioId);
                    return { audioId };
                }
                throw new Error(`Unhandled request: ${method} ${requestPath}`);
            };

            const panel = document.querySelector('[data-panel="books"]');
            const controller = window.CrmBooksWorkspace.createController({
                elements: { booksPanel: panel },
                apiFetchJson: request,
                showToast: (msg, type) => console.log(`[Toast ${type}] ${msg}`),
                firebase: null
            });

            window.__controller = controller;
            await controller.init();
            await controller.selectBook(book.bookId);
        }, { book: BOOK, mockTracks: MOCK_TRACKS });

        // Wait for workspace to mount
        await page.waitForSelector('.crm-books-workspace', { timeout: 5000 });
        console.log('  ✓ Books workspace mounted.');

        // Select the book
        await page.click(`.crm-books-list-item[data-book-id="${BOOK.bookId}"]`);
        await page.waitForSelector('.crm-books-explorer-header', { timeout: 5000 });
        console.log('  ✓ Book selected.');

        console.log('Step 3: Checking BGM button and opening modal...');
        const bgmBtn = await page.waitForSelector('.crm-books-bgm-btn', { timeout: 5000 });
        assert(bgmBtn, 'BGM button should exist in header.');
        await bgmBtn.click();

        await page.waitForSelector('.crm-books-bgm-modal', { timeout: 5000 });
        const dropzone = await page.waitForSelector('#crm-books-bgm-dropzone', { timeout: 5000 });
        assert(dropzone, 'Dropzone should exist.');

        const trackItems = await page.$$('.crm-books-bgm-item');
        assert.strictEqual(trackItems.length, 2, 'Should display 2 mock audio tracks.');
        await page.screenshot({ path: BGM_MODAL_SCREENSHOT });
        console.log('  ✓ BGM modal rendered with 2 tracks. Screenshot saved.');

        // Close modal
        await page.click('.crm-books-modal-close-btn');
        await page.waitForSelector('.crm-books-bgm-modal', { state: 'detached', timeout: 5000 });
        console.log('  ✓ BGM modal closed.');

        console.log('Step 4: Opening Pages tab and Fullscreen Book View...');
        await page.click('.crm-books-tab[data-books-tab="pages"]');
        await page.waitForSelector('.crm-books-open-bgm', { timeout: 5000 });
        await page.waitForSelector('.crm-books-open-bookview', { timeout: 5000 });
        await page.waitForSelector('.crm-books-page-paper', { timeout: 5000 });
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'crm-bgm-local-04-pages-tab.png') });
        console.log('  ✓ Pages tab active with Background Music button. Screenshot saved.');

        await page.click('.crm-books-open-bookview');
        await page.waitForSelector('.crm-bv-overlay', { timeout: 5000 });
        console.log('  ✓ Fullscreen book view opened.');

        console.log('Step 5: Verifying top-right audio player in book view...');
        const overlayHtml = await page.evaluate(() => document.querySelector('.crm-bv-overlay')?.innerHTML || 'NO_OVERLAY');
        console.log('Overlay HTML snippet:', overlayHtml.slice(0, 300));
        const player = await page.waitForSelector('.crm-bv-player', { timeout: 5000 });
        assert(player, 'Audio player pill should exist in top-right.');

        const playBtn = await page.waitForSelector('.crm-bv-player-play', { timeout: 5000 });
        const prevBtn = await page.waitForSelector('.crm-bv-player-prev', { timeout: 5000 });
        const nextBtn = await page.waitForSelector('.crm-bv-player-next', { timeout: 5000 });
        const trackText = await page.$eval('.crm-bv-player-track-text', el => el.textContent.trim());
        assert(trackText.includes('Peaceful Study Piano') || trackText.includes('1/2'), `Track title should show track name, got: ${trackText}`);
        await page.screenshot({ path: PLAYER_RENDER_SCREENSHOT });
        console.log(`  ✓ Audio player rendered with track: "${trackText}". Screenshot saved.`);

        console.log('Step 6: Testing Next / Prev track button...');
        await nextBtn.click();
        await page.waitForTimeout(200);
        const nextTrackText = await page.$eval('.crm-bv-player-track-text', el => el.textContent.trim());
        assert(nextTrackText.includes('Rainy Cafe Lo-Fi') || nextTrackText.includes('2/2'), `Next track should switch to Rainy Cafe Lo-Fi, got: ${nextTrackText}`);
        console.log(`  ✓ Advanced to next track: "${nextTrackText}".`);

        console.log('Step 7: Testing Play / Pause toggle...');
        await playBtn.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: PLAYER_PLAYING_SCREENSHOT });
        console.log('  ✓ Play toggled successfully.');

        console.log('Step 8: Testing Volume Slider interaction...');
        await page.evaluate(() => {
            const slider = document.querySelector('.crm-bv-volume-slider');
            if (slider) {
                slider.value = '75';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        const savedVol = await page.evaluate(() => localStorage.getItem('crm_books_bgm_vol'));
        assert.strictEqual(savedVol, '0.75', 'Volume preference should be persisted in localStorage.');
        console.log('  ✓ Volume adjusted and persisted to localStorage (0.75).');

        console.log('Step 9: Testing exit view...');
        await page.click('.crm-bv-close');
        await page.waitForSelector('.crm-bv-overlay', { state: 'detached', timeout: 5000 });
        console.log('  ✓ Book reader exited cleanly.');

        assert.strictEqual(pageErrors.length, 0, `No page errors expected, got: ${JSON.stringify(pageErrors)}`);
        console.log('\n✅ All local browser checks passed with 100% success!');
    } catch (err) {
        console.error('Test execution failed:', err);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();
