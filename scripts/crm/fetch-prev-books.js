const fs = require('fs');
const path = require('path');
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

    fs.mkdirSync('tmp/production_rerun', { recursive: true });

    const books = [
        { id: 'if1GtQHgGoU7uolTPVXC', name: 'adult_learner' },
        { id: 'ZT25mJFlnHUYCOY2rmIG', name: 'teaching_pronunciation' }
    ];

    for (const b of books) {
        console.log('Fetching data for ' + b.name + ' (' + b.id + ')...');
        const info = await page.evaluate(async (bookId) => {
            const user = window.firebase?.auth?.().currentUser || window.__FIREBASE_INTERNAL__?.auth?.currentUser;
            const token = await user.getIdToken();
            const pRes = await fetch('/api/admin/books/' + bookId + '/pages', {
                headers: { Authorization: 'Bearer ' + token }
            });
            const sRes = await fetch('/api/admin/books/' + bookId + '/source', {
                headers: { Authorization: 'Bearer ' + token }
            });
            return {
                pagesData: await pRes.json(),
                sourceData: await sRes.json()
            };
        }, b.id);

        fs.writeFileSync('tmp/production_rerun/' + b.name + '_pages.json', JSON.stringify(info.pagesData, null, 2), 'utf8');
        console.log('Saved pages for ' + b.name + ': totalPages=' + info.pagesData?.totalPages + ', contract=' + info.pagesData?.rendererContract);

        if (info.sourceData?.downloadUrl) {
            console.log('Downloading source PDF for ' + b.name + '...');
            const pdfRes = await fetch(info.sourceData.downloadUrl);
            const arrayBuf = await pdfRes.arrayBuffer();
            fs.writeFileSync('tmp/production_rerun/' + b.name + '.pdf', Buffer.from(arrayBuf));
            console.log('Saved ' + b.name + '.pdf (' + (arrayBuf.byteLength / (1024 * 1024)).toFixed(2) + ' MB)');
        }
    }

    await browser.close();
    console.log('All source files and live production pages fetched successfully!');
})();
