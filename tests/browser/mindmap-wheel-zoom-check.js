/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.cwd();

const BOOK = {
    bookId: 'book-wheel-test',
    title: 'Functional Load in Pronunciation',
    author: 'John M. Levis',
    pageCount: 150,
    status: 'ready',
    ingest: null
};

const SAMPLE_NOTES = [
    {
        id: 'note_1',
        text: 'Functional load measures the contrastive work done by two phonemes.',
        savedAt: Date.now() - 3600000
    }
];

const MOCK_MIND_MAP = {
    bookId: 'book-wheel-test',
    citationSchemaVersion: 1,
    centralTopic: 'Mind Map: Wheel Zoom Test',
    summary: 'Testing cursor-anchored zoom.',
    noteCount: 1,
    categories: [
        {
            id: 'cat_1',
            title: 'Category 1',
            color: '#4f46e5',
            summary: 'Category summary',
            subtopics: [
                {
                    id: 'sub_1_1',
                    title: 'Subtopic 1',
                    summary: 'Subtopic summary',
                    noteIds: ['note_1'],
                    citations: [{
                        noteId: 'note_1',
                        quote: 'Functional load measures the contrastive work done by two phonemes.'
                    }],
                    fullText: SAMPLE_NOTES[0].text
                }
            ]
        }
    ]
};

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

async function main() {
    const browser = await chromium.launch({ headless: true });
    const pageErrors = [];

    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.on('pageerror', (error) => pageErrors.push(error.message));

        await page.addInitScript(installMemoryLocalStorage);
        await page.setContent(`
          <section class="crm-panel" data-panel="books" style="display:block; width:100%; height:100vh;">
            <div class="crm-books-workspace">
              <div class="crm-books-sources-panel">
                <ul class="crm-books-list"></ul>
              </div>
              <div class="crm-books-explorer-panel">
                <div class="crm-books-detail"></div>
              </div>
            </div>
          </section>

          <div id="crm-books-mindmap-modal" class="crm-books-mindmap-modal" style="display: none;">
            <div class="crm-mindmap-header">
              <div class="crm-mindmap-header-left">
                <h2 id="crm-mindmap-title" class="crm-mindmap-title">🧠 Mind Map</h2>
                <span id="crm-mindmap-subtitle" class="crm-mindmap-subtitle">Synthesis</span>
              </div>
              <div class="crm-mindmap-header-actions">
                <button id="crm-mindmap-zoom-in" class="crm-btn crm-btn-secondary crm-btn-sm">+</button>
                <button id="crm-mindmap-zoom-out" class="crm-btn crm-btn-secondary crm-btn-sm">-</button>
                <button id="crm-mindmap-zoom-reset" class="crm-btn crm-btn-secondary crm-btn-sm">Fit View</button>
                <button id="crm-mindmap-close-btn" class="crm-btn crm-btn-close">&times;</button>
              </div>
            </div>
            <div class="crm-mindmap-body">
              <div id="crm-mindmap-viewport" class="crm-mindmap-viewport">
                <svg id="crm-mindmap-svg" class="crm-mindmap-svg"></svg>
                <div id="crm-mindmap-canvas" class="crm-mindmap-canvas"></div>
              </div>
              <aside id="crm-mindmap-inspector" class="crm-mindmap-inspector" style="display: none;"></aside>
            </div>
          </div>
        `);

        await page.evaluate(installMemoryLocalStorage);
        await page.addStyleTag({ path: path.join(ROOT, 'public', 'crm-admin.css') });
        await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'crm', 'books-workspace.js') });

        await page.evaluate(async ({ book, notes, mockMap }) => {
            window.localStorage.setItem(`crm_books_notes_${book.bookId}`, JSON.stringify(notes));

            const request = async (requestPath, options = {}) => {
                const method = options.method || 'GET';
                if (requestPath === '/api/admin/books') return { books: [book] };
                if (requestPath === `/api/admin/books/${book.bookId}`) return { book, summary: null };
                if (requestPath === '/api/admin/books/usage') return { estimatedCostUsd: 0.5, budgetLimitUsd: 10.0, approved: false };
                if (requestPath === `/api/admin/books/${book.bookId}/notes`) return { notes };
                if (requestPath === `/api/admin/books/${book.bookId}/mind-map` && method === 'POST') return { mindMap: mockMap };
                return { ok: true };
            };

            const panel = document.querySelector('[data-panel="books"]');
            window.__crmBooksController = window.CrmBooksWorkspace.createController({
                elements: { booksPanel: panel },
                apiFetchJson: request,
                showToast: () => {}
            });
            await window.__crmBooksController.init();
            await window.__crmBooksController.selectBook(book.bookId);
        }, { book: BOOK, notes: SAMPLE_NOTES, mockMap: MOCK_MIND_MAP });

        await page.waitForSelector('.crm-books-list-item');
        await page.click('.crm-books-list-item');

        await page.waitForSelector('[data-books-tab="notes"]');
        await page.click('[data-books-tab="notes"]');

        await page.click('.crm-books-create-mindmap-btn');
        await page.waitForSelector('#crm-books-mindmap-modal[style*="display: flex"]');
        await page.waitForSelector('.crm-mindmap-node.central');

        // Test 1: Verify cursor-anchored zoom on mouse wheel
        const stateBefore = await page.evaluate(() => {
            const vp = document.querySelector('#crm-mindmap-viewport');
            const canvas = document.querySelector('#crm-mindmap-canvas');
            const rect = vp.getBoundingClientRect();
            const match = canvas.style.transform.match(/translate\(([^p]+)px,\s*([^p]+)px\)\s*scale\(([^)]+)\)/);
            const panX = parseFloat(match[1]);
            const panY = parseFloat(match[2]);
            const zoom = parseFloat(match[3]);

            const cursorScreenX = 600;
            const cursorScreenY = 400;
            const localX = cursorScreenX - rect.left;
            const localY = cursorScreenY - rect.top;

            const canvasX = (localX - panX) / zoom;
            const canvasY = (localY - panY) / zoom;

            return { rect, cursorScreenX, cursorScreenY, panX, panY, zoom, localX, localY, canvasX, canvasY };
        });

        // Move mouse to (600, 400) and dispatch wheel (zoom in)
        await page.mouse.move(600, 400);
        await page.mouse.wheel(0, -100);
        await page.waitForTimeout(100);

        const stateAfterZoomIn = await page.evaluate(({ beforeCanvasX, beforeCanvasY }) => {
            const vp = document.querySelector('#crm-mindmap-viewport');
            const canvas = document.querySelector('#crm-mindmap-canvas');
            const match = canvas.style.transform.match(/translate\(([^p]+)px,\s*([^p]+)px\)\s*scale\(([^)]+)\)/);
            const panX = parseFloat(match[1]);
            const panY = parseFloat(match[2]);
            const zoom = parseFloat(match[3]);

            const rect = vp.getBoundingClientRect();
            // What is the new screen coordinate of beforeCanvasX/Y?
            const currentScreenX = rect.left + panX + beforeCanvasX * zoom;
            const currentScreenY = rect.top + panY + beforeCanvasY * zoom;

            return { panX, panY, zoom, currentScreenX, currentScreenY };
        }, { beforeCanvasX: stateBefore.canvasX, beforeCanvasY: stateBefore.canvasY });

        assert.ok(stateAfterZoomIn.zoom > stateBefore.zoom, `Zoom should have increased: ${stateBefore.zoom} -> ${stateAfterZoomIn.zoom}`);
        assert.ok(Math.abs(stateAfterZoomIn.currentScreenX - 600) < 0.5, `Cursor anchor point X should stay at 600, got ${stateAfterZoomIn.currentScreenX}`);
        assert.ok(Math.abs(stateAfterZoomIn.currentScreenY - 400) < 0.5, `Cursor anchor point Y should stay at 400, got ${stateAfterZoomIn.currentScreenY}`);
        console.log(`✅ Wheel zoom in: scale=${stateAfterZoomIn.zoom.toFixed(3)}, anchor stayed at (${stateAfterZoomIn.currentScreenX.toFixed(1)}, ${stateAfterZoomIn.currentScreenY.toFixed(1)})`);

        // Now dispatch wheel (zoom out) at the same point
        await page.mouse.wheel(0, 100);
        await page.waitForTimeout(100);

        const stateAfterZoomOut = await page.evaluate(({ beforeCanvasX, beforeCanvasY }) => {
            const vp = document.querySelector('#crm-mindmap-viewport');
            const canvas = document.querySelector('#crm-mindmap-canvas');
            const match = canvas.style.transform.match(/translate\(([^p]+)px,\s*([^p]+)px\)\s*scale\(([^)]+)\)/);
            const panX = parseFloat(match[1]);
            const panY = parseFloat(match[2]);
            const zoom = parseFloat(match[3]);

            const rect = vp.getBoundingClientRect();
            const currentScreenX = rect.left + panX + beforeCanvasX * zoom;
            const currentScreenY = rect.top + panY + beforeCanvasY * zoom;

            return { panX, panY, zoom, currentScreenX, currentScreenY };
        }, { beforeCanvasX: stateBefore.canvasX, beforeCanvasY: stateBefore.canvasY });

        assert.ok(stateAfterZoomOut.zoom < stateAfterZoomIn.zoom, `Zoom should have decreased: ${stateAfterZoomIn.zoom} -> ${stateAfterZoomOut.zoom}`);
        assert.ok(Math.abs(stateAfterZoomOut.currentScreenX - 600) < 0.5, `Cursor anchor point X should stay at 600, got ${stateAfterZoomOut.currentScreenX}`);
        assert.ok(Math.abs(stateAfterZoomOut.currentScreenY - 400) < 0.5, `Cursor anchor point Y should stay at 400, got ${stateAfterZoomOut.currentScreenY}`);
        console.log(`✅ Wheel zoom out: scale=${stateAfterZoomOut.zoom.toFixed(3)}, anchor stayed at (${stateAfterZoomOut.currentScreenX.toFixed(1)}, ${stateAfterZoomOut.currentScreenY.toFixed(1)})`);

        // Test 2: Verify toolbar buttons zoom relative to viewport center
        await page.click('#crm-mindmap-zoom-in');
        await page.waitForTimeout(100);
        const toolbarZoomIn = await page.evaluate(() => {
            const canvas = document.querySelector('#crm-mindmap-canvas');
            const match = canvas.style.transform.match(/translate\(([^p]+)px,\s*([^p]+)px\)\s*scale\(([^)]+)\)/);
            return { panX: parseFloat(match[1]), panY: parseFloat(match[2]), zoom: parseFloat(match[3]) };
        });
        assert.ok(toolbarZoomIn.zoom > stateAfterZoomOut.zoom, 'Toolbar zoom in button should increase zoom');
        console.log(`✅ Toolbar zoom in: scale=${toolbarZoomIn.zoom.toFixed(3)}`);

        // Test 3: Verify two-finger pinch zoom keeps the midpoint anchored.
        const pinchBefore = await page.evaluate(() => {
            const vp = document.querySelector('#crm-mindmap-viewport');
            const canvas = document.querySelector('#crm-mindmap-canvas');
            const rect = vp.getBoundingClientRect();
            const match = canvas.style.transform.match(/translate\(([^p]+)px,\s*([^p]+)px\)\s*scale\(([^)]+)\)/);
            const panX = parseFloat(match[1]);
            const panY = parseFloat(match[2]);
            const zoom = parseFloat(match[3]);
            const midX = 600;
            const midY = 400;
            return {
                midX,
                midY,
                canvasX: (midX - rect.left - panX) / zoom,
                canvasY: (midY - rect.top - panY) / zoom
            };
        });
        await page.evaluate(() => {
            const vp = document.querySelector('#crm-mindmap-viewport');
            const touch = (identifier, clientX, clientY) => new Touch({ identifier, target: vp, clientX, clientY, pageX: clientX, pageY: clientY, screenX: clientX, screenY: clientY });
            vp.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch(1, 500, 400), touch(2, 700, 400)] }));
            vp.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(1, 450, 400), touch(2, 750, 400)] }));
            vp.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }));
        });
        const pinchAfter = await page.evaluate(({ before }) => {
            const vp = document.querySelector('#crm-mindmap-viewport');
            const canvas = document.querySelector('#crm-mindmap-canvas');
            const rect = vp.getBoundingClientRect();
            const match = canvas.style.transform.match(/translate\(([^p]+)px,\s*([^p]+)px\)\s*scale\(([^)]+)\)/);
            const panX = parseFloat(match[1]);
            const panY = parseFloat(match[2]);
            const zoom = parseFloat(match[3]);
            return { zoom, currentMidX: rect.left + panX + before.canvasX * zoom, currentMidY: rect.top + panY + before.canvasY * zoom };
        }, { before: pinchBefore });
        assert.ok(pinchAfter.zoom > toolbarZoomIn.zoom, `Pinch zoom should increase scale: ${toolbarZoomIn.zoom} -> ${pinchAfter.zoom}`);
        assert.ok(Math.abs(pinchAfter.currentMidX - pinchBefore.midX) < 0.5, `Pinch midpoint X should stay anchored at ${pinchBefore.midX}, got ${pinchAfter.currentMidX}`);
        assert.ok(Math.abs(pinchAfter.currentMidY - pinchBefore.midY) < 0.5, `Pinch midpoint Y should stay anchored at ${pinchBefore.midY}, got ${pinchAfter.currentMidY}`);
        console.log(`✅ Pinch zoom: scale=${pinchAfter.zoom.toFixed(3)}, midpoint stayed at (${pinchAfter.currentMidX.toFixed(1)}, ${pinchAfter.currentMidY.toFixed(1)})`);

        assert.deepStrictEqual(pageErrors, [], `Unexpected page errors: ${pageErrors.join('; ')}`);
        console.log('All mind map zoom verification checks passed successfully!');
    } finally {
        await browser.close();
    }
}

main().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
