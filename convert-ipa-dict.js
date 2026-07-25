/**
 * Convert ipa-dict en_US.txt to JSON for use in the phonetics pipeline.
 * 
 * Downloads the dataset from GitHub, parses tab-separated word/IPA pairs,
 * normalizes narrow IPA symbols to simplified American IPA, and writes
 * a JSON file to public/ipa-dict.json.
 * 
 * Usage: node convert-ipa-dict.js
 * 
 * Symbol normalization:
 *   ɹ → r  (turned r → regular r)
 *   ɫ → l  (dark L → regular l)
 *   ɾ → t  (flap T → regular t)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SOURCE_URL = 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt';
const OUTPUT_PATH = path.join(__dirname, 'public', 'ipa-dict.json');

// Narrow → simplified American IPA normalization map
const NORMALIZE_MAP = {
    '\u0279': 'r',  // ɹ → r (alveolar approximant → regular r)
    '\u026B': 'l',  // ɫ → l (dark L → regular l)
    '\u027E': 't',  // ɾ → t (flap T → regular t)
};

function normalizeIPA(ipa) {
    let result = ipa;
    for (const [from, to] of Object.entries(NORMALIZE_MAP)) {
        result = result.split(from).join(to);
    }
    return result;
}

function fetchText(url) {
    return new Promise((resolve, reject) => {
        const request = (targetUrl) => {
            https.get(targetUrl, (res) => {
                // Follow redirects
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return request(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }

                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve(buffer.toString('utf-8'));
                });
                res.on('error', reject);
            }).on('error', reject);
        };
        request(url);
    });
}

async function main() {
    console.log('Downloading en_US.txt from ipa-dict...');
    const raw = await fetchText(SOURCE_URL);
    
    const lines = raw.split('\n').filter(l => l.includes('\t'));
    console.log(`Parsed ${lines.length} raw entries.`);

    const dict = {};
    let normalizedCount = 0;
    let multiCount = 0;

    for (const line of lines) {
        const tabIdx = line.indexOf('\t');
        if (tabIdx === -1) continue;

        const word = line.substring(0, tabIdx).trim().toLowerCase();
        const ipaRaw = line.substring(tabIdx + 1).trim();

        if (!word || !ipaRaw) continue;

        // Split multiple pronunciations: "/ˈeɪ/, /ə/" → ["/ˈeɪ/", "/ə/"]
        const variants = ipaRaw
            .split(/,\s*/)
            .map(v => v.trim())
            .filter(v => v.length > 0);

        // Normalize each variant
        const normalized = variants.map(v => {
            const n = normalizeIPA(v);
            if (n !== v) normalizedCount++;
            return n;
        });

        if (normalized.length > 1) multiCount++;

        dict[word] = normalized;
    }

    const entryCount = Object.keys(dict).length;
    console.log(`\nConversion complete:`);
    console.log(`  Total entries: ${entryCount}`);
    console.log(`  Multi-pronunciation words: ${multiCount}`);
    console.log(`  Symbols normalized: ${normalizedCount}`);

    // Verify no raw narrow symbols remain
    const jsonStr = JSON.stringify(dict);
    const remaining = {
        'ɹ': (jsonStr.match(/\u0279/g) || []).length,
        'ɫ': (jsonStr.match(/\u026B/g) || []).length,
        'ɾ': (jsonStr.match(/\u027E/g) || []).length,
    };
    console.log(`\nRemaining narrow symbols (should all be 0):`);
    for (const [sym, count] of Object.entries(remaining)) {
        console.log(`  ${sym}: ${count}`);
    }

    // Spot-check a few words
    const spotChecks = ['forest', 'a', 'either', 'hello', 'the', 'water', 'butter'];
    console.log(`\nSpot checks:`);
    for (const w of spotChecks) {
        console.log(`  ${w}: ${dict[w] ? dict[w].join(', ') : '(not found)'}`);
    }

    // Write output
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dict), 'utf-8');
    const sizeKB = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(0);
    console.log(`\nWritten to ${OUTPUT_PATH} (${sizeKB} KB)`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
