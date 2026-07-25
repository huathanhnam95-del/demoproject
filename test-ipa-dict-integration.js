/**
 * Verification test for ipa-dict dataset integration in phonetics pipeline
 */

const fs = require('fs');
const path = require('path');

// Mock browser globals for phonetics.js loading
global.fetch = async function(url) {
    const filePath = path.join(__dirname, 'public', url);
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
        ok: true,
        json: async () => JSON.parse(content)
    };
};
global.window = {};

// Load modules
const { arpabetToIPA } = require('./public/arpabet-ipa-map.js');
global.arpabetToIPA = arpabetToIPA;
require('./public/phonetics.js');

const Phonetics = global.window.Phonetics;

async function runVerification() {
    console.log('--- Testing Phonetics Integration ---');

    // Enable debug logging
    Phonetics.enableDebug();

    const testWords = ['forest', 'either', 'a', 'water', 'butter', 'hello', 'xyznonexistentword'];

    for (const word of testWords) {
        const ipa = await Phonetics.getIPA(word);
        const sourceData = await Phonetics.getIPAWithSource(word);
        console.log(`Word: "${word}"`);
        console.log(`  -> Primary IPA : ${ipa}`);
        console.log(`  -> Source      : ${sourceData.source}`);
        console.log(`  -> Alternatives: ${JSON.stringify(sourceData.alternatives)}`);
        console.log(`  -> Approximate : ${sourceData.isApproximate}`);
        console.log('---');
    }

    console.log('✅ Verification complete!');
}

runVerification().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
