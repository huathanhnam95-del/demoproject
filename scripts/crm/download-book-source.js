const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '../..');
const CREDENTIALS_FILE = path.join(ROOT, '.local/browser-test-credentials.md');
const FIREBASE_API_KEY = 'AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ';
const BASE_URL = 'https://betterenglishlearning.com';
const BOOK_ID = 'if1GtQHgGoU7uolTPVXC';

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

function downloadBinary(urlStr, destPath) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const file = fs.createWriteStream(destPath);
        https.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                return downloadBinary(res.headers.location, destPath).then(resolve).catch(reject);
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve(fs.statSync(destPath).size));
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => reject(err));
        });
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

    console.log('Fetching signed source URL for', BOOK_ID);
    const res = await requestJson(`${BASE_URL}/api/admin/books/${BOOK_ID}/source`, { headers: authHeaders });
    console.log('Source response:', res.status, res.data?.success);
    const dlUrl = res.data?.data?.downloadUrl || res.data?.downloadUrl;
    if (!dlUrl) {
        console.error('No downloadUrl returned!', res.data);
        process.exit(1);
    }

    const outDir = path.join(ROOT, 'artifacts/books');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const dest = path.join(outDir, 'adult-learner.pdf');
    console.log('Downloading PDF to', dest);
    const size = await downloadBinary(dlUrl, dest);
    console.log(`Successfully downloaded PDF (${size} bytes) to ${dest}!`);
}

main().catch(console.error);
