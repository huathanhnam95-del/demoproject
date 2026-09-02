const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const {
    analyzePageMetrics,
    buildVerificationManifest,
    verifyManifestIntegrity
} = require(path.join(ROOT, 'scripts/crm/audit-book-text-revision.js'));

async function runAuditTests() {
    console.log('--- Testing Book Text Audit and Manifest Tooling ---');

    // Test 1: analyzePageMetrics accurately detects whitespace ratios and runs
    console.log('Test 1: analyzePageMetrics whitespace and run detection');
    const corruptPage = 'ANeglectedSpeciasinurbanenvironmentsandecosystemsworldwide.';
    const corruptMetrics = analyzePageMetrics(corruptPage);
    assert.strictEqual(corruptMetrics.whitespaceRatio, 0);
    assert.ok(corruptMetrics.longestRun >= 20, 'Longest run should exceed 20 characters on corrupted text');

    const cleanPage = 'A Neglected Species in urban environments and ecosystems worldwide.';
    const cleanMetrics = analyzePageMetrics(cleanPage);
    assert.ok(cleanMetrics.whitespaceRatio > 0.1, 'Clean page should have >10% whitespace ratio');
    assert.ok(cleanMetrics.longestRun <= 15, 'Clean page should not have abnormally long glued runs');

    // Test 2: buildVerificationManifest produces deterministic 64-char hex hash
    console.log('Test 2: buildVerificationManifest produces valid manifest');
    const samplePages = [
        'Page 1 title and overview.',
        'Page 2 detailed chapter content.',
        'Page 3 concluding remarks.'
    ];
    const manifest = buildVerificationManifest({
        bookId: 'book-sample-1',
        textRevisionId: 'rev-sample-01',
        sourceSha256: 'e'.repeat(64),
        pages: samplePages
    });

    assert.strictEqual(manifest.pageCount, 3);
    assert.strictEqual(manifest.pages.length, 3);
    assert.strictEqual(typeof manifest.manifestHash, 'string');
    assert.strictEqual(manifest.manifestHash.length, 64);
    assert.strictEqual(/^[a-f0-9]{64}$/.test(manifest.manifestHash), true);

    // Test 3: verifyManifestIntegrity passes for untampered manifest
    console.log('Test 3: verifyManifestIntegrity validates clean manifest');
    assert.strictEqual(verifyManifestIntegrity(manifest), true);

    // Test 4: verifyManifestIntegrity fails if page content or count is tampered
    console.log('Test 4: verifyManifestIntegrity rejects tampered manifest');
    const tamperedManifest = {
        ...manifest,
        pages: [
            ...manifest.pages.slice(0, 2),
            { ...manifest.pages[2], textSha256: 'f'.repeat(64) }
        ]
    };
    assert.strictEqual(verifyManifestIntegrity(tamperedManifest), false);

    console.log('All book text audit and manifest tests passed!');
}

runAuditTests().catch((err) => {
    console.error('Audit tests failed:', err);
    process.exitCode = 1;
});
