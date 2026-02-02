
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 8443;
const BASE_URL = `https://localhost:${PORT}`;

const axiosInstance = axios.create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
});

async function testAdvanced() {
    console.log('--- Advanced Hardening Verification ---');

    // 1. Deduplication Test
    console.log('\n[1] Testing Deduplication...');
    const dedupWord = 'resilience';
    const start = Date.now();
    // Fire 3 simultaneous requests
    const promises = [
        axiosInstance.get(`${BASE_URL}/api/tracau?word=${dedupWord}`),
        axiosInstance.get(`${BASE_URL}/api/tracau?word=${dedupWord}`),
        axiosInstance.get(`${BASE_URL}/api/tracau?word=${dedupWord}`)
    ];
    const results = await Promise.all(promises);
    const duration = Date.now() - start;

    console.log(`Requests completed in ${duration}ms`);
    const fromCaches = results.map(r => r.data.fromCache);
    console.log(`Response "fromCache" statuses: ${JSON.stringify(fromCaches)}`);
    // All should be false if it's the first time, but we want to check server logs for 1 request.
    // Actually, axios will wait for the first one if the server behaves correctly.

    // 2. Cacheability Guard Test
    console.log('\n[2] Testing Cacheability Guard...');
    const longSentence = 'this is a long sentence that should not be cached';
    await axiosInstance.get(`${BASE_URL}/api/tracau?word=${encodeURIComponent(longSentence)}`);

    // Wait for periodic save
    console.log('Waiting 3 seconds for atomic save...');
    await new Promise(r => setTimeout(r, 3000));

    const dictContent = JSON.parse(fs.readFileSync('local_dictionary.json', 'utf8'));
    if (dictContent[longSentence.toLowerCase()]) {
        console.log('❌ FAIL: Long sentence was cached!');
    } else {
        console.log('✅ PASS: Long sentence correctly ignored by guard.');
    }

    // 3. TTL Test (Implicitly checked by logic, harder to test without mocks)
    // We can look at the raw json to see if timestamps are added.
    console.log('\n[3] Verifying Timestamps...');
    const testEntry = dictContent['architecture'];
    if (testEntry && testEntry.timestamp) {
        console.log(`✅ PASS: Entry has timestamp: ${testEntry.timestamp}`);
    } else {
        console.log('❌ FAIL: Entry missing timestamp.');
    }

    console.log('\n--- Advanced Test Complete ---');
}

testAdvanced();
