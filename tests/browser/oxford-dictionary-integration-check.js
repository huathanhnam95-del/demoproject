const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

async function startServer() {
    const app = express();
    app.use(express.static(path.join(__dirname, '..', '..', 'public')));

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return { server, origin: `http://127.0.0.1:${port}` };
}

(async () => {
    console.log('🧪 Starting Oxford IPA & Dictionary Integration Browser Check...');

    const { server, origin } = await startServer();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });

        // Wait for Phonetics and DictionaryService to initialize
        await page.waitForFunction(() => typeof window.Phonetics !== 'undefined' && typeof window.DictionaryService !== 'undefined');

        console.log('✅ Phonetics & DictionaryService modules loaded on client.');

        // 1. Verify Oxford American IPA notation logic directly on window
        const ipaResults = await page.evaluate(async () => {
            const words = ['water', 'computer', 'liter', 'car', 'button', 'listen', 'happy', 'the'];
            const outputs = {};
            for (const w of words) {
                outputs[w] = await window.Phonetics.getIPA(w);
            }
            return outputs;
        });

        console.log('📊 Evaluated Oxford IPA results:', ipaResults);

        assert.strictEqual(ipaResults.water, '/ˈwɔːtər/', 'water should carry Oxford length mark /ˈwɔːtər/');
        assert.strictEqual(ipaResults.computer, '/kəmˈpjuːtər/', 'computer should carry Oxford length mark /kəmˈpjuːtər/');
        assert.strictEqual(ipaResults.liter, '/ˈliːtər/', 'liter should carry Oxford length mark /ˈliːtər/');
        assert.strictEqual(ipaResults.car, '/kɑːr/', 'car should carry Oxford length mark /kɑːr/');
        assert.strictEqual(ipaResults.button, '/ˈbʌtn/', 'button should use Oxford syllabic n /ˈbʌtn/');
        assert.strictEqual(ipaResults.listen, '/ˈlɪsn/', 'listen should use Oxford syllabic n /ˈlɪsn/');
        assert.strictEqual(ipaResults.happy, '/ˈhæpi/', 'happy should keep Oxford weak /i/');
        assert.strictEqual(ipaResults.the, '/ðiː/', 'the citation form should be Oxford strong /ðiː/');

        console.log('✅ All core Oxford IPA notation assertions passed!');

        // 2. Verify DictionaryService getWordData
        const wordDataResult = await page.evaluate(async () => {
            return await window.DictionaryService.getWordData('receive');
        });

        console.log('📚 Evaluated DictionaryService result for "receive":', wordDataResult);
        assert.ok(wordDataResult.vietnameseTranslation, 'Should have Vietnamese translation for receive');
        assert.strictEqual(wordDataResult.vietnameseTranslation, 'nhận', 'Translation for receive should be "nhận"');

        console.log('✅ DictionaryService verification passed!');

        console.log('🎉 ALL OXFORD DICTIONARY INTEGRATION CHECKS PASSED SUCCESSFULLY!');
    } finally {
        await browser.close();
        server.close();
    }
})();
