const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { CRM_BOOKS } = require(path.join(ROOT, 'functions/src/crm/collections'));

if (!getApps().length) {
    initializeApp();
}

const db = getFirestore();

async function listProductionBooks() {
    console.log('--- Inspecting Production Books in Firestore (crmBooks) ---');
    const snap = await db.collection(CRM_BOOKS).get();
    if (snap.empty) {
        console.log('No books found in crmBooks collection.');
        return [];
    }
    const books = [];
    snap.docs.forEach((doc) => {
        const data = doc.data();
        books.push({
            id: doc.id,
            title: data.title,
            status: data.status,
            pageCount: data.pageCount || data.totalPages,
            activeTextRevisionId: data.activeTextRevisionId || null,
            sourcePath: data.source?.storagePath || data.storagePath || data.sourcePath || null,
            sourceSha256: data.source?.sha256 || null
        });
        console.log(`Book ID: ${doc.id} | Title: "${data.title}" | Status: ${data.status} | Active Revision: ${data.activeTextRevisionId || 'legacy'} | Source: ${data.source?.storagePath || data.storagePath || data.sourcePath}`);
    });
    return books;
}

listProductionBooks().catch((err) => {
    console.error('Failed to list production books:', err);
    process.exit(1);
});
