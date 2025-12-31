/**
 * CMU Dictionary Converter
 * 
 * Downloads the CMU Pronouncing Dictionary and converts it to JSON format.
 * Run with: node convert-cmudict.js
 * 
 * Output: cmudict.json (~2MB)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CMU_DICT_URL = 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict';
const OUTPUT_FILE = path.join(__dirname, 'cmudict.json');

console.log('CMU Dictionary Converter');
console.log('========================\n');

function download(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }

            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => resolve(data));
            response.on('error', reject);
        }).on('error', reject);
    });
}

function parseCMUDict(content) {
    const dict = {};
    const lines = content.split('\n');
    let count = 0;

    for (const line of lines) {
        // Skip comments and empty lines
        if (line.startsWith(';;;') || !line.trim()) {
            continue;
        }

        // Format: WORD  PH1 PH2 PH3...
        // or: WORD(1)  PH1 PH2 PH3... (alternate pronunciation)
        const parts = line.split(/\s+/);
        if (parts.length < 2) continue;

        let word = parts[0].toLowerCase();
        const phonemes = parts.slice(1).join(' ');

        // Handle alternate pronunciations like "read(2)"
        const altMatch = word.match(/^(.+)\((\d+)\)$/);
        if (altMatch) {
            // Skip alternates for simplicity - use first pronunciation only
            continue;
        }

        // Only store if not already present (first pronunciation wins)
        if (!dict[word]) {
            dict[word] = phonemes;
            count++;
        }
    }

    return { dict, count };
}

async function main() {
    try {
        console.log('1. Downloading CMU Dictionary...');
        const content = await download(CMU_DICT_URL);
        console.log(`   Downloaded ${(content.length / 1024 / 1024).toFixed(2)} MB\n`);

        console.log('2. Parsing dictionary...');
        const { dict, count } = parseCMUDict(content);
        console.log(`   Parsed ${count.toLocaleString()} words\n`);

        console.log('3. Writing JSON file...');
        const json = JSON.stringify(dict, null, 0); // Minified
        fs.writeFileSync(OUTPUT_FILE, json, 'utf8');
        const size = fs.statSync(OUTPUT_FILE).size;
        console.log(`   Wrote ${(size / 1024 / 1024).toFixed(2)} MB to ${OUTPUT_FILE}\n`);

        console.log('✅ Done! You can now use cmudict.json with the Phonetics module.');
        console.log('\nExample entries:');
        const samples = ['hello', 'world', 'pronunciation', 'dictionary'];
        for (const word of samples) {
            if (dict[word]) {
                console.log(`  ${word}: ${dict[word]}`);
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();
