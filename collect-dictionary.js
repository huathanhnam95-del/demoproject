/**
 * Dictionary Collector Utility
 * Automatically fetches dictionary data for common words and populates local_dictionary.json
 * via the local hardened proxy (server.js).
 * 
 * Usage: node collect-dictionary.js [--limit=100] [--start=0] [--delay=200] [--refresh]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Use the local proxy which handles caching, validation, and persistence
const PROXY_BASE_URL = 'https://localhost:8443/api/tracau?word=';
const COMMON_WORDS_URL = 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt';
const LOCAL_DICT_PATH = path.join(__dirname, 'local_dictionary.json');
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days TTL

// Read local dict to skip existing words
let localDict = {};
if (fs.existsSync(LOCAL_DICT_PATH)) {
    try {
        localDict = JSON.parse(fs.readFileSync(LOCAL_DICT_PATH, 'utf8'));
        console.log(`[Collector] Loaded ${Object.keys(localDict).length} existing words.`);
    } catch (e) {
        console.warn('Failed to load existing dictionary for skipping:', e.message);
    }
}

/**
 * Robust fetch with retries, backoff, and network error handling
 */
async function fetchJson(url, opts = {}) {
    const {
        timeoutMs = 8000,
        rejectUnauthorized = false, // Allow self-signed certs for localhost
        retries = 3,
    } = opts;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const data = await new Promise((resolve, reject) => {
                const req = https.get(url, {
                    rejectUnauthorized,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/json'
                    }
                }, (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            try { return resolve(JSON.parse(body)); }
                            catch (e) {
                                // Return truncated body for diagnostics
                                const snippet = body.substring(0, 100).replace(/\s+/g, ' ');
                                reject(new Error(`Failed to parse JSON: "${snippet}..."`));
                            }
                        }

                        // Retryable statuses
                        if ([429, 500, 502, 503, 504].includes(res.statusCode)) {
                            const err = new Error(`HTTP ${res.statusCode}`);
                            err.retryable = true;
                            return reject(err);
                        }
                        return reject(new Error(`HTTP ${res.statusCode}`));
                    });
                });

                req.setTimeout(timeoutMs, () => {
                    req.destroy(new Error('Timeout'));
                });
                req.on('error', reject);
            });

            return data;
        } catch (e) {
            const isTimeout = /Timeout/.test(e.message);
            const isNetReset = /ECONNRESET|EPIPE|ENOTFOUND|ETIMEDOUT/i.test(e.message);
            const isRetryable = e.retryable || isTimeout || isNetReset;

            if (attempt < retries && isRetryable) {
                const backoff = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s...
                console.log(`   -> Retry ${attempt + 1}/${retries} after ${backoff}ms (${e.message})`);
                await new Promise(r => setTimeout(r, backoff));
                continue;
            }
            throw e;
        }
    }
}

async function fetchText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
                resolve(data);
            });
        }).on('error', reject);
    });
}

function getArg(name, defaultVal) {
    // Flag-only support (boolean)
    if (defaultVal === false) {
        return process.argv.includes(`--${name}`);
    }

    // Support --arg val
    const idx = process.argv.indexOf(`--${name}`);
    if (idx !== -1 && process.argv[idx + 1]) return parseInt(process.argv[idx + 1], 10) || defaultVal;

    // Support --arg=val
    const eq = process.argv.find(a => a.startsWith(`--${name}=`));
    if (eq) return parseInt(eq.split('=')[1], 10) || defaultVal;

    return defaultVal;
}

async function collect() {
    console.log('Fetching common words list...');
    const wordsText = await fetchText(COMMON_WORDS_URL);
    const words = wordsText.split('\n').map(w => w.trim()).filter(w => w.length > 0);

    const limit = getArg('limit', 50);
    const startIdx = getArg('start', 0);
    const delayMs = getArg('delay', 200);
    const forceRefresh = getArg('refresh', false);

    // Slice based on start and limit
    const wordsToCollect = words.slice(startIdx, startIdx + limit);

    console.log(`Starting collection for ${wordsToCollect.length} words (Start: ${startIdx}, Limit: ${limit})...`);
    console.log(`Delay: ${delayMs}ms, Force Refresh: ${forceRefresh}`);

    let stats = {
        cached: 0,
        fetched: 0,
        skipped: 0,
        noData: 0,
        failed: 0
    };

    for (let i = 0; i < wordsToCollect.length; i++) {
        // Normalize: lowercase, standard apostrophes
        const word = wordsToCollect[i].toLowerCase().replace(/’/g, "'");

        // Check freshness Logic
        const entry = localDict[word];
        const isFresh = entry && entry.timestamp && (Date.now() - entry.timestamp) < MAX_AGE_MS;

        // Skip if present and fresh (unless forcing refresh)
        if (entry && isFresh && !forceRefresh) {
            stats.skipped++;
            continue;
        }

        // Skip non-cacheable words to save API calls
        if (!/^[a-z][a-z'-]{1,29}$/.test(word)) {
            console.log(`[${i + 1}/${wordsToCollect.length}] Skipping "${word}" (invalid format)`);
            continue;
        }

        const currentNum = startIdx + i + 1;
        const totalNum = startIdx + wordsToCollect.length;
        process.stdout.write(`[${currentNum}/${totalNum}] "${word}"... `);

        try {
            const data = await fetchJson(`${PROXY_BASE_URL}${encodeURIComponent(word)}`);

            // Strict Success Check: Must have items in arrays
            const hasTratu = Array.isArray(data.tratu) && data.tratu.length > 0;
            const hasSentences = Array.isArray(data.sentences) && data.sentences.length > 0;

            if (data && (hasTratu || hasSentences)) {
                if (data.fromCache) {
                    console.log('Success (Cached)');
                    stats.cached++;
                } else {
                    console.log('Success (Fetched Live)');
                    stats.fetched++;
                }
                localDict[word] = { timestamp: Date.now() }; // Mark as known/refreshed
            } else {
                console.log('No data');
                stats.noData++;
            }
        } catch (e) {
            console.log(`Failed: ${e.message}`);
            stats.failed++;
        }

        // Delay to be polite / avoid aggressive rate limits
        if (delayMs > 0) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }

    console.log(`\nCollection complete!`);
    console.log(`- Skipped (Fresh): ${stats.skipped}`);
    console.log(`- Served from Cache: ${stats.cached}`);
    console.log(`- Fetched Live:    ${stats.fetched}`);
    console.log(`- No Data Found:   ${stats.noData}`);
    console.log(`- Failed:          ${stats.failed}`);
}

collect().catch(err => {
    console.error('Fatal error during collection:', err);
    process.exit(1);
});
