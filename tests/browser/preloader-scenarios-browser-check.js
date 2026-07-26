const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4173;
const PUBLIC_DIR = path.join(__dirname, '../../public');

// Simple static HTTP server serving public/ directory with SPA fallback to index.html
function startServer() {
    const server = http.createServer((req, res) => {
        let filePath = path.join(PUBLIC_DIR, req.url.split('?')[0]);
        if (filePath.endsWith('/') || filePath === PUBLIC_DIR) {
            filePath = path.join(PUBLIC_DIR, 'index.html');
        }

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            // SPA rewrite to index.html if file doesn't exist
            filePath = path.join(PUBLIC_DIR, 'index.html');
        }

        const ext = path.extname(filePath);
        const contentTypeMap = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.woff2': 'font/woff2'
        };

        const contentType = contentTypeMap[ext] || 'application/octet-stream';
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end(`Error: ${err.code}`);
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            }
        });
    });

    return new Promise((resolve) => {
        server.listen(PORT, '127.0.0.1', () => {
            console.log(`Test server running at http://127.0.0.1:${PORT}`);
            resolve(server);
        });
    });
}

(async () => {
    const server = await startServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];

    page.on('pageerror', (err) => errors.push(`PageError: ${err.message}`));
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`ConsoleError: ${msg.text()}`);
    });

    try {
        console.log('\n========================================');
        console.log('TEST 1: Cold start on Homepage (No sessionStorage)');
        console.log('========================================');

        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        
        // Immediately after DOMContentLoaded, preloader should be visible
        const preloader1 = page.locator('#app-preloader');
        const isVisible1 = await preloader1.isVisible();
        const display1 = await preloader1.evaluate(el => getComputedStyle(el).display);
        console.log(`[TEST 1] Initial visibility: ${isVisible1}, display: ${display1}`);

        if (display1 !== 'flex' && display1 !== 'block') {
            throw new Error(`[TEST 1 FAILED] Preloader should be visible on cold start homepage. Got display=${display1}`);
        }

        // Wait for preloader finish signal / timeout
        await page.evaluate(() => { if (window.finishBelPreloader) window.finishBelPreloader(); });
        await page.waitForTimeout(7000); // Allow minimum 6.5s duration to pass

        const display1After = await preloader1.evaluate(el => el.style.display);
        const hasLoadedFlag1 = await page.evaluate(() => sessionStorage.getItem('bel_app_loaded'));
        console.log(`[TEST 1] Display after finish: '${display1After}', bel_app_loaded flag: '${hasLoadedFlag1}'`);

        if (hasLoadedFlag1 !== '1') {
            throw new Error(`[TEST 1 FAILED] sessionStorage.bel_app_loaded should be '1' after preloader finishes.`);
        }


        console.log('\n========================================');
        console.log('TEST 2: Return to Homepage with sessionStorage bel_app_loaded=1');
        console.log('========================================');

        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        const display2 = await preloader1.evaluate(el => getComputedStyle(el).display);
        console.log(`[TEST 2] Homepage revisit initial display: ${display2}`);

        if (display2 !== 'flex' && display2 !== 'block') {
            throw new Error(`[TEST 2 FAILED] Preloader should show when returning to homepage. Got display=${display2}`);
        }


        console.log('\n========================================');
        console.log('TEST 3: Sub-route navigation when sessionStorage bel_app_loaded=1');
        console.log('========================================');

        // Navigate to sub-route (e.g. practice route) with bel_app_loaded='1'
        await page.goto(`http://127.0.0.1:${PORT}/practice/speaking/read-aloud/1287`, { waitUntil: 'domcontentloaded' });
        
        const display3 = await preloader1.evaluate(el => el.style.display);
        const hasLoadingActiveClass3 = await page.evaluate(() => document.body.classList.contains('loading-active'));
        console.log(`[TEST 3] Sub-route revisit display: '${display3}', loading-active class: ${hasLoadingActiveClass3}`);

        if (display3 !== 'none') {
            throw new Error(`[TEST 3 FAILED] Preloader should be IMMEDIATELY hidden (display: none) on sub-route revisit. Got '${display3}'`);
        }
        if (hasLoadingActiveClass3) {
            throw new Error(`[TEST 3 FAILED] body should not have 'loading-active' class on sub-route revisit.`);
        }


        console.log('\n========================================');
        console.log('TEST 4: Direct sub-route cold start (No sessionStorage)');
        console.log('========================================');

        // Create a new context/page without sessionStorage
        const newContext = await browser.newContext();
        const newPage = await newContext.newPage();
        await newPage.goto(`http://127.0.0.1:${PORT}/practice/speaking/read-aloud/1287`, { waitUntil: 'domcontentloaded' });

        const preloader4 = newPage.locator('#app-preloader');
        const display4 = await preloader4.evaluate(el => getComputedStyle(el).display);
        console.log(`[TEST 4] Direct sub-route cold start display: ${display4}`);

        if (display4 !== 'flex' && display4 !== 'block') {
            throw new Error(`[TEST 4 FAILED] Preloader should show on direct sub-route cold start. Got display=${display4}`);
        }
        await newContext.close();


        console.log('\n========================================');
        console.log('TEST 5: Session reset (clearing sessionStorage)');
        console.log('========================================');

        await page.evaluate(() => sessionStorage.clear());
        await page.goto(`http://127.0.0.1:${PORT}/practice/speaking/read-aloud/1287`, { waitUntil: 'domcontentloaded' });

        const display5 = await preloader1.evaluate(el => getComputedStyle(el).display);
        console.log(`[TEST 5] Display after clearing sessionStorage: ${display5}`);

        if (display5 !== 'flex' && display5 !== 'block') {
            throw new Error(`[TEST 5 FAILED] Preloader should show after clearing sessionStorage. Got display=${display5}`);
        }


        console.log('\n========================================');
        console.log('ALL PRELOADER SCENARIOS PASSED SUCCESSFULLY!');
        console.log('========================================');

    } catch (err) {
        console.error(`\nTEST SUITE ERROR: ${err.message}`);
        process.exitCode = 1;
    } finally {
        await browser.close();
        server.close();
    }
})();
