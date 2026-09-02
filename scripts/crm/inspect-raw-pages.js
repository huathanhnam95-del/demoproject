const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '../..');
const CREDENTIALS_FILE = path.join(ROOT, '.local/browser-test-credentials.md');
const FIREBASE_API_KEY = 'AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ';
const BASE_URL = 'https://betterenglishlearning.com';

function getCredentials() {
    const text = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    return {
        email: text.match(/Username:\s*`([^`]+)`/)[1].trim(),
        password: text.match(/Password:\s*`([^`]+)`/)[1].trim()
    };
}

function requestJson(urlStr, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, data });
                }
            });
        });
        req.on('error', reject);
        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

async function main() {
    const creds = getCredentials();
    const authRes = await requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { email: creds.email, password: creds.password, returnSecureToken: true }
    });
    const idToken = authRes.data.idToken;
    const authHeaders = { Authorization: `Bearer ${idToken}` };

    const books = [
        { id: 'if1GtQHgGoU7uolTPVXC', name: 'Book 1 - Adult Learner' },
        { id: 'ZT25mJFlnHUYCOY2rmIG', name: 'Book 2 - Teaching Pronunciation' }
    ];

    for (const b of books) {
        console.log(`\n================== ${b.name} (${b.id}) ==================`);
        const bookInfoRes = await requestJson(`${BASE_URL}/api/admin/books/${b.id}`, { headers: authHeaders });
        console.log('Book data from API:', JSON.stringify(bookInfoRes.data, null, 2));

        const dlRes = await requestJson(`${BASE_URL}/api/admin/books/${b.id}/download-source`, { headers: authHeaders });
        console.log('Download source response:', JSON.stringify(dlRes.data, null, 2));
        const pagesRes = await requestJson(`${BASE_URL}/api/admin/books/${b.id}/pages`, { headers: authHeaders });
        const pData = pagesRes.data?.data || pagesRes.data;
        console.log('Contract:', pData?.rendererContract, '| Total pages:', pData?.pages?.length);
        console.log('Sample pages:');
        for (const pNum of [1, 6, 8, 10, 11, 20]) {
            if (pData?.pages?.[pNum - 1]) {
                console.log(`\n--- Page ${pNum} ---\n` + pData.pages[pNum - 1].slice(0, 300));
            }
        }
    }
}

main().catch(console.error);
