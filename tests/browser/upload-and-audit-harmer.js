const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readBrowserTestCredentials } = require('./helpers/browser-test-credentials');

const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = 'https://betterenglishlearning.com';
const PDF_PATH = 'C:/Books/Books/The practice of English Language Teaching 5th Edition by Harmer.pdf';

async function signInOnPage(page, credentials) {
    return page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__?.auth;
        if (!auth) throw new Error('Production Firebase auth is not available.');
        const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const result = await signInWithEmailAndPassword(auth, email, password);
        return { uid: result?.user?.uid || '' };
    }, credentials);
}

async function getAdminToken(page) {
    return page.evaluate(async () => {
        const user = window.firebase?.auth?.().currentUser || window.__FIREBASE_INTERNAL__?.auth?.currentUser;
        if (!user) throw new Error('User not logged in');
        return user.getIdToken();
    });
}

(async () => {
    assert(fs.existsSync(PDF_PATH), `PDF must exist at ${PDF_PATH}`);
    const credentials = readBrowserTestCredentials();

    console.log('1. Launching Chrome...');
    const browser = await chromium.launch({
        headless: true,
        channel: 'chrome'
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    try {
        console.log('2. Authenticating via Firebase Auth on /index.html...');
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        const authResult = await signInOnPage(page, credentials);
        console.log('Authenticated UID:', authResult.uid);

        console.log(`3. Navigating to ${ORIGIN}/crm-admin.html#books...`);
        await page.goto(`${ORIGIN}/crm-admin.html#books`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => {
            const gate = document.getElementById('crm-loading');
            return gate && getComputedStyle(gate).display === 'none';
        }, null, { timeout: 45000 });
        await page.waitForSelector('[data-panel="books"]', { state: 'visible', timeout: 30000 });
        await page.waitForSelector('.crm-books-workspace', { timeout: 30000 });
        await page.waitForTimeout(3000);

        const token = await getAdminToken(page);

        // Check if Harmer book already exists
        console.log('4. Checking if Harmer book already exists on production...');
        const booksListRes = await page.evaluate(async (tok) => {
            const res = await fetch('/api/admin/books', {
                headers: { Authorization: `Bearer ${tok}` }
            });
            return res.json();
        }, token);

        let existingBook = (booksListRes?.data?.books || []).find(b => 
            b.title?.toLowerCase().includes('harmer') || 
            b.title?.toLowerCase().includes('practice of english language teaching')
        );

        let bookId = existingBook?.bookId;

        if (!existingBook) {
            console.log('5. Book not found. Initiating upload via UI...');
            const addBtn = page.locator('.crm-books-add-btn');
            await addBtn.click();
            await page.waitForSelector('#crm-book-file', { state: 'visible', timeout: 10000 });

            console.log('Attaching 94 MB PDF file...');
            await page.setInputFiles('#crm-book-file', PDF_PATH);
            await page.waitForTimeout(1000);

            await page.fill('#crm-book-title', 'The Practice of English Language Teaching (5th Edition)');
            await page.fill('#crm-book-author', 'Jeremy Harmer');

            console.log('Clicking Upload button and monitoring progress...');
            await page.click('.crm-books-modal-submit');

            // Wait for modal to close (upload started)
            await page.waitForSelector('.crm-books-add-modal', { state: 'detached', timeout: 30000 }).catch(() => {});

            // Poll until book appears and reaches status ready or ingest progresses
            console.log('Waiting for upload and ingestion to complete...');
            for (let attempt = 0; attempt < 120; attempt++) {
                await page.waitForTimeout(5000);
                const checkRes = await page.evaluate(async (tok) => {
                    const res = await fetch('/api/admin/books', {
                        headers: { Authorization: `Bearer ${tok}` }
                    });
                    return res.json();
                }, token);

                const current = (checkRes?.data?.books || []).find(b => 
                    b.title?.toLowerCase().includes('harmer') || 
                    b.title?.toLowerCase().includes('practice of english language teaching')
                );

                if (current) {
                    bookId = current.bookId;
                    console.log(`[Attempt ${attempt + 1}] Book ID: ${bookId} | Status: ${current.status} | Ingest:`, current.ingest);
                    if (current.status === 'ready') {
                        console.log('Book is READY!');
                        existingBook = current;
                        break;
                    }
                    if (current.status === 'awaiting_upload' || current.status === 'error') {
                        // If queued or needs triggering, trigger ingest
                        console.log('Triggering /ingest endpoint...');
                        await page.evaluate(async ({ tok, bId }) => {
                            await fetch(`/api/admin/books/${bId}/ingest`, {
                                method: 'POST',
                                headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }
                            });
                        }, { tok: token, bId: bookId });
                    }
                }
            }
        } else {
            console.log(`Found existing book ID: ${bookId} with status: ${existingBook.status}`);
        }

        assert(bookId, 'A valid bookId must be available.');

        // Verify Pages endpoint
        console.log(`\n6. Fetching pages data for book ${bookId} from production API...`);
        const pagesRes = await page.evaluate(async ({ tok, bId }) => {
            const res = await fetch(`/api/admin/books/${bId}/pages`, {
                headers: { Authorization: `Bearer ${tok}` }
            });
            return res.json();
        }, { tok: token, bId: bookId });

        console.log('Pages API response:');
        console.log('Success:', pagesRes?.success);
        console.log('Total Pages:', pagesRes?.data?.totalPages);
        console.log('Renderer Contract:', pagesRes?.data?.rendererContract);
        assert(pagesRes?.data?.rendererContract === 'ocr-v2', 'Renderer contract MUST be ocr-v2');
        assert(pagesRes?.data?.totalPages === 459, 'Total pages must be 459');

        // Save pages to local tmp for comparison
        fs.mkdirSync(path.join(ROOT, 'tmp/harmer'), { recursive: true });
        fs.writeFileSync(path.join(ROOT, 'tmp/harmer/live-pages.json'), JSON.stringify(pagesRes.data, null, 2), 'utf8');

        // 7. Verify in Chrome DOM
        console.log('\n7. Verifying in Chrome live UI...');
        await page.goto(`${ORIGIN}/crm-admin.html#books/${bookId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        const pagesTab = page.locator('[data-books-tab="pages"]');
        await pagesTab.waitFor({ state: 'visible', timeout: 30000 });
        await pagesTab.click();
        await page.waitForTimeout(2000);

        async function jumpTo(num) {
            console.log(`Jumping to page ${num}...`);
            const input = page.locator('.crm-books-page-input');
            await input.waitFor({ state: 'visible', timeout: 10000 });
            await input.fill(String(num));
            await input.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
            await page.waitForTimeout(2000);
            await page.waitForFunction(t => {
                const el = document.querySelector('.crm-books-page-paper[data-page-number]');
                return el && el.getAttribute('data-page-number') === String(t);
            }, num, { timeout: 10000 });
        }

        // Check Page 1
        await jumpTo(1);
        const p1 = await page.locator('.crm-books-page-content').first().innerText();
        console.log('Page 1 content snippet:\n' + p1.slice(0, 150));
        assert(p1.includes('Jeremy Harmer'), 'Page 1 must contain Jeremy Harmer');
        assert(p1.includes('The Practice of'), 'Page 1 must contain title');
        await page.screenshot({ path: path.join(ROOT, 'artifacts/harmer_page_1.png') });
        console.log('Saved artifacts/harmer_page_1.png');

        // Check Page 10
        await jumpTo(10);
        const p10 = await page.locator('.crm-books-page-content').first().innerText();
        console.log('Page 10 content snippet:\n' + p10.slice(0, 150));
        assert(p10.includes('Video contents') || p10.includes('Pre-university'), 'Page 10 must contain video contents');
        await page.screenshot({ path: path.join(ROOT, 'artifacts/harmer_page_10.png') });
        console.log('Saved artifacts/harmer_page_10.png');

        // Check Page 20
        await jumpTo(20);
        const p20 = await page.locator('.crm-books-page-content').first().innerText();
        console.log('Page 20 content snippet:\n' + p20.slice(0, 150));
        assert(p20.includes('grammatical accuracy') || p20.includes('chapter 1'), 'Page 20 must contain chapter 1 discussion');
        await page.screenshot({ path: path.join(ROOT, 'artifacts/harmer_page_20.png') });
        console.log('Saved artifacts/harmer_page_20.png');

        // Check Page 100
        await jumpTo(100);
        const p100 = await page.locator('.crm-books-page-content').first().innerText();
        console.log('Page 100 content snippet:\n' + p100.slice(0, 150));
        assert(p100.includes('convergers versus divergers') || p100.includes('chapter 5'), 'Page 100 must contain learning styles');
        await page.screenshot({ path: path.join(ROOT, 'artifacts/harmer_page_100.png') });
        console.log('Saved artifacts/harmer_page_100.png');

        console.log('\n===============================================================');
        console.log('SUCCESS: HARMER 5TH EDITION UPLOADED & VERIFIED IN CHROME LIVE!');
        console.log('===============================================================\n');
    } catch (err) {
        console.error('Audit script error:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
