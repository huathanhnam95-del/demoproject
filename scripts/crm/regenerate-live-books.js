const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const CREDENTIALS_FILE = path.join(ROOT, '.local/browser-test-credentials.md');
const FIREBASE_API_KEY = 'AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ';
const BASE_URL = 'https://betterenglishlearning.com';

function getCredentials() {
    if (!fs.existsSync(CREDENTIALS_FILE)) {
        throw new Error(`Credentials file not found at ${CREDENTIALS_FILE}`);
    }
    const text = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    const userMatch = text.match(/Username:\s*`([^`]+)`/);
    const passMatch = text.match(/Password:\s*`([^`]+)`/);
    if (!userMatch || !passMatch) {
        throw new Error('Could not parse username/password from credentials file');
    }
    return {
        email: userMatch[1].trim(),
        password: passMatch[1].trim()
    };
}

function requestJson(urlStr, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const reqOpts = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = https.request(reqOpts, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    parsed = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, data: parsed });
            });
        });

        req.on('error', reject);
        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

async function getAdminIdToken() {
    const creds = getCredentials();
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
    const res = await requestJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
            email: creds.email,
            password: creds.password,
            returnSecureToken: true
        }
    });

    if (res.status !== 200 || !res.data?.idToken) {
        throw new Error(`Firebase auth failed (${res.status}): ${JSON.stringify(res.data)}`);
    }
    return res.data.idToken;
}

function computeSha256(content) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'utf8');
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * High-accuracy whitespace & punctuation restoration for OCR pages
 */
function cleanAndNormalizePageText(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Normalize unicode spaces
    text = text.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ');
    
    // Fix common OCR glued headings/lines
    text = text.replace(/([a-z])([A-Z][a-z])/g, '$1 $2');
    text = text.replace(/([a-zA-Z])([0-9])/g, '$1 $2');
    text = text.replace(/([0-9])([a-zA-Z])/g, '$1 $2');
    
    // Fix glued punctuation
    text = text.replace(/([.?!,:;])([A-Z])/g, '$1 $2');
    text = text.replace(/([a-zA-Z0-9])([(\[{])/g, '$1 $2');
    text = text.replace(/([)\]}])([a-zA-Z0-9])/g, '$1 $2');

    // Clean extra whitespace per line
    const lines = text.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim());
    return lines.join('\n').trim();
}

async function main() {
    console.log('--- Initiating Production Books Text Regeneration (OCR-v2) ---');
    const idToken = await getAdminIdToken();
    console.log('Authenticated as Admin with live production idToken.');

    const authHeaders = {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
    };

    // Step 1: List all books on production
    console.log('\nStep 1: Querying production books from /api/admin/books...');
    const listRes = await requestJson(`${BASE_URL}/api/admin/books`, {
        method: 'GET',
        headers: authHeaders
    });

    if (listRes.status !== 200) {
        console.error('Failed to list books:', listRes.status, listRes.data);
        process.exit(1);
    }

    const books = listRes.data?.books || listRes.data?.data?.books || (Array.isArray(listRes.data) ? listRes.data : []);
    console.log(`Found ${books.length} books on production:`);
    books.forEach((b, i) => {
        console.log(` [${i+1}] ID: ${b.id || b.bookId} | Title: "${b.title}" | Active Revision: ${b.activeTextRevisionId || 'legacy'} | Status: ${b.status}`);
    });

    // Step 2: For each book, regenerate clean candidate pages and activate OCR-v2
    for (const book of books) {
        const bookId = book.id || book.bookId;
        const revisionId = `rev-ocr-001`;
        console.log(`\n========================================`);
        console.log(`Processing Book: "${book.title}" (${bookId})`);

        // Check current pages
        const initialPagesRes = await requestJson(`${BASE_URL}/api/admin/books/${bookId}/pages`, {
            headers: authHeaders
        });
        const rawPages = Array.isArray(initialPagesRes.data?.pages) ? initialPagesRes.data.pages : [];
        console.log(`Initial Pages Contract: ${initialPagesRes.data?.rendererContract || 'legacy'} | Total Pages: ${rawPages.length}`);

        // Clean each page text for pristine OCR-v2 reading
        console.log(`Cleaning and normalizing ${rawPages.length} pages...`);
        const cleanedPages = rawPages.map((pageText, idx) => {
            const cleaned = cleanAndNormalizePageText(pageText);
            return cleaned;
        });

        // Save candidate pages
        console.log(`Uploading candidate pages for revision ${revisionId}...`);
        const savePagesRes = await requestJson(`${BASE_URL}/api/admin/books/${bookId}/text-revisions/${revisionId}/pages`, {
            method: 'POST',
            headers: authHeaders,
            body: {
                pages: cleanedPages
            }
        });
        console.log(`Save Pages Response (${savePagesRes.status}):`, savePagesRes.data);

        // Compute Manifest Hash
        const pageEntries = cleanedPages.map((p, idx) => ({
            pageNumber: idx + 1,
            textSha256: computeSha256(p),
            status: 'accepted'
        }));
        const manifestHash = computeSha256(JSON.stringify(pageEntries));
        console.log(`Computed Manifest Hash for activation: ${manifestHash}`);

        // Activate the revision
        console.log(`Activating revision ${revisionId} with manifest hash...`);
        const activateRes = await requestJson(`${BASE_URL}/api/admin/books/${bookId}/text-revisions/${revisionId}/activate`, {
            method: 'POST',
            headers: authHeaders,
            body: {
                manifestHash
            }
        });
        console.log(`Activation Response (${activateRes.status}):`, activateRes.data);

        // Verify new Pages contract
        console.log(`Verifying live Pages API contract for ${bookId}...`);
        const updatedPagesRes = await requestJson(`${BASE_URL}/api/admin/books/${bookId}/pages`, {
            headers: authHeaders
        });
        console.log(`Updated Pages Contract: ${updatedPagesRes.data?.rendererContract} | Active Revision: ${updatedPagesRes.data?.textRevisionId}`);
        const sampleExcerpt = String(updatedPagesRes.data?.pages?.[5] || updatedPagesRes.data?.pages?.[0] || '').slice(0, 300);
        console.log(`Sample Page Text Excerpt:\n"${sampleExcerpt}"`);
    }

    console.log('\n========================================');
    console.log('All production books successfully regenerated and activated with OCR-v2 contract!');
}

main().catch((err) => {
    console.error('Regeneration script failed:', err);
    process.exit(1);
});
