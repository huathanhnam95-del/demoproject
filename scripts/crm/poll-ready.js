const { chromium } = require('playwright');
const { readBrowserTestCredentials } = require('../../tests/browser/helpers/browser-test-credentials');

(async () => {
    const credentials = readBrowserTestCredentials();
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    await page.goto('https://betterenglishlearning.com/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth));
    await page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__.auth;
        const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        return signInWithEmailAndPassword(auth, email, password);
    }, credentials);

    await page.goto('https://betterenglishlearning.com/crm-admin.html#books', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.crm-books-workspace');

    for (let i = 0; i < 30; i++) {
        const data = await page.evaluate(async () => {
            const user = window.firebase?.auth?.().currentUser || window.__FIREBASE_INTERNAL__?.auth?.currentUser;
            const token = await user.getIdToken();
            const res = await fetch('/api/admin/books', {
                headers: { Authorization: 'Bearer ' + token }
            });
            return res.json();
        });
        const harmer = (data?.books || []).find(b => b.bookId === 'FQavK9NnlrytB00F3WHy');
        console.log(`[Check ${i + 1}] Status: ${harmer?.status} | Stage: ${harmer?.ingest?.stage} | Percent: ${harmer?.ingest?.percent}%`);
        if (harmer?.status === 'ready') {
            console.log('HARMER BOOK IS READY ON PRODUCTION!');
            break;
        }
        await page.waitForTimeout(5000);
    }
    await browser.close();
})();
