/**
 * Sync Note mode difficulty levels from RL.xlsx to Firestore takeNotesEntries
 * 
 * Reads the updated difficulty levels from the Excel file and batch-updates
 * the 'level' field in Firestore for each takeNotesEntries document.
 * 
 * Usage:
 *   node scripts/sync-notes-difficulty.js             # write to Firestore
 *   node scripts/sync-notes-difficulty.js --dry-run    # preview only
 */

const admin = require('firebase-admin');
const Excel = require('exceljs');
const path = require('path');
const fs = require('fs');

const EXCEL_PATH = path.join(__dirname, '..', 'public', 'database', 'Take Notes', 'RL', 'RL.xlsx');
const COLLECTION = 'takeNotesEntries';
const BATCH_SIZE = 500;

function getTranscriptText(cell) {
    if (!cell) return '';
    if (cell.richText) return cell.richText.map(t => t.text).join('');
    return String(cell).trim();
}

async function main() {
    const isDryRun = process.argv.includes('--dry-run');
    console.log(`📖 Reading Excel: ${EXCEL_PATH}`);
    if (isDryRun) console.log('  (DRY RUN — Firestore will NOT be modified)\n');

    if (!fs.existsSync(EXCEL_PATH)) {
        console.error(`❌ Excel file not found: ${EXCEL_PATH}`);
        process.exit(1);
    }

    // Read Excel
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(EXCEL_PATH);
    const worksheet = workbook.getWorksheet(1);

    const excelEntries = [];
    worksheet.eachRow((row, num) => {
        if (num === 1) return;
        const id = String(row.getCell(1).value || '').trim();
        const transcript = getTranscriptText(row.getCell(3).value);
        const level = parseInt(row.getCell(4).value, 10);
        const videoUrl = row.getCell(5).value ? String(row.getCell(5).value).trim() : '';

        if (id && level >= 1 && level <= 3) {
            excelEntries.push({ id, transcript, level, videoUrl });
        }
    });

    console.log(`  Found ${excelEntries.length} entries in Excel\n`);

    // Distribution
    const dist = { 1: 0, 2: 0, 3: 0 };
    excelEntries.forEach(e => dist[e.level]++);
    console.log(`  Distribution: L1=${dist[1]}  L2=${dist[2]}  L3=${dist[3]}\n`);

    if (isDryRun) {
        console.log('(Dry run complete — no Firestore changes made)');
        process.exit(0);
    }

    // Initialize Firebase Admin
    const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
    if (!fs.existsSync(serviceAccountPath)) {
        console.error(`❌ serviceAccountKey.json not found at: ${serviceAccountPath}`);
        console.log('  Please place your Firebase service account key file in the project root.');
        process.exit(1);
    }

    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    const db = admin.firestore();

    // Check if collection exists and has documents
    console.log(`🔍 Checking Firestore collection: ${COLLECTION}`);
    const snapshot = await db.collection(COLLECTION).limit(1).get();

    if (snapshot.empty) {
        console.log(`  Collection '${COLLECTION}' is empty — uploading all entries as new documents.\n`);

        // Full upload: create all documents
        let written = 0;
        for (let i = 0; i < excelEntries.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = excelEntries.slice(i, i + BATCH_SIZE);

            for (const entry of chunk) {
                const docRef = db.collection(COLLECTION).doc(entry.id);
                batch.set(docRef, {
                    id: entry.id,
                    transcript: entry.transcript,
                    level: entry.level,
                    videoUrl: entry.videoUrl,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            await batch.commit();
            written += chunk.length;
            console.log(`  ✓ Uploaded ${written}/${excelEntries.length} documents`);
        }

        console.log(`\n✅ Successfully uploaded ${written} documents to '${COLLECTION}'`);
    } else {
        console.log(`  Collection '${COLLECTION}' has existing data — updating levels only.\n`);

        // Build lookup from Excel
        const levelMap = new Map();
        excelEntries.forEach(e => levelMap.set(e.id, e.level));

        // Read all existing docs
        const allDocs = await db.collection(COLLECTION).get();
        let updated = 0;
        let skipped = 0;

        for (let i = 0; i < allDocs.docs.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = allDocs.docs.slice(i, i + BATCH_SIZE);
            let batchUpdates = 0;

            for (const doc of chunk) {
                const data = doc.data();
                const docId = String(data.id || doc.id).trim();
                const newLevel = levelMap.get(docId);

                if (newLevel !== undefined && newLevel !== data.level) {
                    batch.update(doc.ref, {
                        level: newLevel,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    batchUpdates++;
                } else {
                    skipped++;
                }
            }

            if (batchUpdates > 0) {
                await batch.commit();
                updated += batchUpdates;
                console.log(`  ✓ Updated ${updated} documents so far...`);
            }
        }

        console.log(`\n✅ Sync complete: ${updated} updated, ${skipped} unchanged`);
    }
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('❌ Error:', err.message);
        process.exit(1);
    });
