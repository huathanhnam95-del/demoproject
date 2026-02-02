
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

async function test() {
    console.log('--- Dictionary Integration Test (Port 8443) ---');

    // 1. Verify a word already in cache (collected earlier)
    const testWord = 'the';
    try {
        console.log(`Testing cached word: "${testWord}"...`);
        const res = await axiosInstance.get(`${BASE_URL}/api/tracau?word=${testWord}`);
        if (res.data.fromCache) {
            console.log('✅ PASS: Served from local cache.');
        } else {
            console.log('❌ FAIL: Not served from cache, but should have been.');
        }
    } catch (e) {
        console.error(`❌ ERROR: Failed to fetch "${testWord}":`, e.message);
    }

    // 2. Verify a new word (should be fetched from API and then cached)
    const newWord = 'architecture';
    try {
        console.log(`\nTesting new word: "${newWord}"...`);

        // First call: Should be from API
        let res = await axiosInstance.get(`${BASE_URL}/api/tracau?word=${newWord}`);
        console.log(`First call for "${newWord}" status: ${res.status}`);

        // Wait for cache write
        await new Promise(r => setTimeout(r, 1000));

        // Second call: Should be from cache
        res = await axiosInstance.get(`${BASE_URL}/api/tracau?word=${newWord}`);
        if (res.data.fromCache) {
            console.log('✅ PASS: New word cached and served from local cache.');
        } else {
            console.log('❌ FAIL: New word NOT cached.');
        }
    } catch (e) {
        console.error(`❌ ERROR: Failed to fetch "${newWord}":`, e.message);
    }

    console.log('\n--- Test Complete ---');
}

test();
