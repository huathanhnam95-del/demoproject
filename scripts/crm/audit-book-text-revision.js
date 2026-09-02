const crypto = require('crypto');

function computeSha256(content) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'utf8');
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function analyzePageMetrics(pageText) {
    const text = String(pageText || '');
    const charCount = text.length;
    if (charCount === 0) {
        return { charCount: 0, whitespaceRatio: 1, longestRun: 0, isBlank: true };
    }

    const spaces = (text.match(/\s/g) || []).length;
    const whitespaceRatio = spaces / charCount;

    // Find longest alphabetic run without whitespace
    const alphaRuns = text.match(/[A-Za-zÀ-ɏ]{2,}/g) || [];
    let longestRun = 0;
    for (const run of alphaRuns) {
        if (run.length > longestRun) longestRun = run.length;
    }

    return {
        charCount,
        whitespaceRatio: Number(whitespaceRatio.toFixed(4)),
        longestRun,
        isBlank: false
    };
}

function buildVerificationManifest({ bookId, textRevisionId, pages = [], sourceSha256 = '' } = {}) {
    if (!bookId || !textRevisionId) {
        throw new Error('bookId and textRevisionId are required to build a verification manifest');
    }

    const pageEntries = pages.map((pageText, index) => {
        const pageNumber = index + 1;
        const text = String(pageText || '');
        const textSha256 = computeSha256(text);
        const metrics = analyzePageMetrics(text);

        return {
            pageNumber,
            textSha256,
            status: 'accepted',
            metrics
        };
    });

    const canonicalEntries = JSON.stringify(pageEntries);
    const manifestHash = computeSha256(canonicalEntries);

    return {
        schemaVersion: 1,
        bookId,
        textRevisionId,
        sourceSha256,
        pageCount: pages.length,
        manifestHash,
        pages: pageEntries,
        createdAt: new Date().toISOString()
    };
}

function verifyManifestIntegrity(manifest) {
    if (!manifest || typeof manifest !== 'object') return false;
    if (!Array.isArray(manifest.pages) || manifest.pages.length !== manifest.pageCount) return false;

    const canonicalEntries = JSON.stringify(manifest.pages);
    const expectedHash = computeSha256(canonicalEntries);
    return manifest.manifestHash === expectedHash;
}

module.exports = {
    computeSha256,
    analyzePageMetrics,
    buildVerificationManifest,
    verifyManifestIntegrity
};

if (require.main === module) {
    /* eslint-disable no-console */
    const fs = require('fs');
    const path = require('path');
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node scripts/crm/audit-book-text-revision.js <manifest.json | pages.json>');
        process.exit(0);
    }
    const filePath = path.resolve(process.cwd(), args[0]);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data.manifestHash && Array.isArray(data.pages)) {
        const ok = verifyManifestIntegrity(data);
        console.log(`Manifest integrity: ${ok ? 'VALID' : 'INVALID (Tampered or Mismatched)'}`);
        console.log(`Book: ${data.bookId}, Revision: ${data.textRevisionId}, Pages: ${data.pageCount}, Hash: ${data.manifestHash}`);
        process.exit(ok ? 0 : 1);
    } else if (Array.isArray(data.pages) || Array.isArray(data)) {
        const pages = Array.isArray(data.pages) ? data.pages : data;
        const manifest = buildVerificationManifest({
            bookId: 'cli-audit',
            textRevisionId: 'rev-cli',
            pages
        });
        console.log(`Generated manifest hash: ${manifest.manifestHash}`);
        console.log(`Total Pages: ${manifest.pageCount}`);
    }
}
