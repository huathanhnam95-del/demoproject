/**
 * rescore-entrance-tests.js
 *
 * Re-scores specified entrance tests using the UPDATED answer key
 * and writes the new scoring back to Firestore.
 *
 * Usage:
 *   node scripts/rescore-entrance-tests.js <testId1> [testId2] ...
 */

const path = require('path');

// Bootstrap Firebase before importing test logic
const { db, admin } = require(path.resolve(__dirname, '..', 'src', 'utils', 'firebase'));
const { scoreSubmission } = require(path.resolve(__dirname, '..', 'src', 'entrance-test', 'test36plus'));

async function rescoreTest(testId) {
    const ref = db.collection('entranceTests').doc(testId);
    const snap = await ref.get();
    if (!snap.exists) {
        console.error(`[SKIP] testId=${testId} — document not found.`);
        return null;
    }

    const data = snap.data() || {};
    const responses = data.responses;
    if (!responses) {
        console.error(`[SKIP] testId=${testId} — no responses stored.`);
        return null;
    }

    // Compute old scoring summary (from stored data)
    const oldScoring = data.scoring || {};
    const oldOverall = oldScoring.overall || {};

    // Re-score with updated answer key
    const newScoring = scoreSubmission(responses);

    // Log comparison
    console.log(`\n=== testId: ${testId} ===`);
    console.log(`OLD score: ${oldOverall.scoredCorrect ?? '?'}/${oldOverall.scoredTotal ?? '?'}`);
    console.log(`NEW score: ${newScoring.overall.scoredCorrect}/${newScoring.overall.scoredTotal}`);

    // Section-by-section diff
    for (const sectionKey of ['vocab', 'grammar', 'listenWrite']) {
        const oldSection = oldScoring[sectionKey] || {};
        const newSection = newScoring[sectionKey] || {};
        const oldCorrect = oldSection.correctTotal ?? '?';
        const newCorrect = newSection.correctTotal ?? '?';
        const total = newSection.blanksTotal ?? oldSection.blanksTotal ?? '?';
        const changed = oldCorrect !== newCorrect;
        const marker = changed ? ' ← CHANGED' : '';
        console.log(`  ${sectionKey}: ${oldCorrect}/${total} → ${newCorrect}/${total}${marker}`);
    }

    // Write back to Firestore
    await ref.update({
        scoring: newScoring,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`  ✔ Updated in Firestore.`);

    return newScoring;
}

async function main() {
    if (!db) {
        console.error('Firebase not initialized. Make sure serviceAccountKey.json is present.');
        process.exit(1);
    }

    const testIds = process.argv.slice(2);
    if (testIds.length === 0) {
        console.error('Usage: node scripts/rescore-entrance-tests.js <testId1> [testId2] ...');
        process.exit(1);
    }

    console.log(`Re-scoring ${testIds.length} test(s) with updated answer key...\n`);

    for (const testId of testIds) {
        try {
            await rescoreTest(testId.trim());
        } catch (err) {
            console.error(`[ERROR] testId=${testId}:`, err.message || err);
        }
    }

    console.log('\nDone.');
    process.exit(0);
}

main();
