/**
 * Points Rules Sync Script
 *
 * Syncs point rules from a CSV/Excel file to Firebase Firestore.
 *
 * Update Logic:
 *   - Title exists in file and Firebase -> Update existing rule
 *   - Title exists in file but not Firebase -> Add new rule
 *   - Title exists in Firebase but not file -> Mark active = false
 *
 * Usage:
 *   node sync-points-rules.js points-rules.csv
 *
 * Setup:
 *   1. Download service account key from Firebase Console
 *   2. Save as "serviceAccountKey.json" in project root
 *   3. Install firebase-admin: npm install firebase-admin
 *
 * CSV Format:
 *   Title,Description,Points
 *   Perfect Type,Get 100% accuracy in Type mode,10
 */

const fs = require('fs');
const path = require('path');
const Excel = require('exceljs');

// Check for firebase-admin
let admin;
try {
    admin = require('firebase-admin');
} catch (e) {
    console.error('❌ Error: firebase-admin not installed.');
    console.log('   Run: npm install firebase-admin');
    process.exit(1);
}

// Configuration
const SERVICE_ACCOUNT_PATH = './serviceAccountKey.json';
const COLLECTION_NAME = 'pointsRules';

/**
 * Initialize Firebase Admin SDK
 */
function initializeFirebase() {
    if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
        console.error('❌ Error: Service account key not found.');
        console.log('');
        console.log('   To get your service account key:');
        console.log('   1. Go to Firebase Console -> Project Settings -> Service Accounts');
        console.log('   2. Click "Generate new private key"');
        console.log('   3. Save the file as "serviceAccountKey.json" in the project root');
        console.log('');
        process.exit(1);
    }

    const serviceAccount = require(SERVICE_ACCOUNT_PATH);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log('✅ Firebase Admin SDK initialized');
    return admin.firestore();
}

/**
 * Parse CSV or Excel file
 * @param {string} filePath - Path to the file
 * @returns {Array} Array of rule objects
 */
async function parseFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`❌ Error: File not found: ${filePath}`);
        process.exit(1);
    }

    const ext = path.extname(filePath).toLowerCase();
    const workbook = new Excel.Workbook();
    let rules = [];

    if (ext === '.csv') {
        // Parse CSV
        const worksheet = await workbook.csv.readFile(filePath);
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber > 1) { // Skip header row
                const rule = {
                    title: (row.values[1] || '').toString().trim(),
                    description: (row.values[2] || '').toString().trim(),
                    explanation: (row.values[3] || '').toString().trim(),
                    points: parseInt(row.values[4] || 0, 10)
                };
                if(rule.title) rules.push(rule);
            }
        });

    } else if (ext === '.xlsx' || ext === '.xls') {
        // Parse Excel
        await workbook.xlsx.readFile(filePath);
        const worksheet = workbook.getWorksheet(1);
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber > 1) { // Skip header row
                const rule = {
                    title: (row.values[1] || '').toString().trim(),
                    description: (row.values[2] || '').toString().trim(),
                    explanation: (row.values[3] || '').toString().trim(),
                    points: parseInt(row.values[4] || 0, 10)
                };
                if(rule.title) rules.push(rule);
            }
        });

    } else {
        console.error(`❌ Error: Unsupported file format: ${ext}`);
        console.log('   Supported formats: .csv, .xlsx, .xls');
        process.exit(1);
    }

    console.log(`✅ Parsed ${rules.length} rules from file`);
    return rules;
}

/**
 * Get existing rules from Firestore
 * @param {Firestore} db - Firestore instance
 * @returns {Map} Map of title -> document data
 */
async function getExistingRules(db) {
    const snapshot = await db.collection(COLLECTION_NAME).get();
    const existingRules = new Map();

    snapshot.forEach(doc => {
        const data = doc.data();
        const titleKey = (data.title || '').toLowerCase().trim();
        existingRules.set(titleKey, {
            id: doc.id,
            ...data
        });
    });

    console.log(`✅ Found ${existingRules.size} existing rules in Firebase`);
    return existingRules;
}

/**
 * Sync rules to Firestore
 * @param {Firestore} db - Firestore instance
 * @param {Array} fileRules - Rules from file
 * @param {Map} existingRules - Existing rules from Firestore
 */
async function syncRules(db, fileRules, existingRules) {
    const batch = db.batch();
    const now = admin.firestore.Timestamp.now();

    let updated = 0;
    let added = 0;
    let deactivated = 0;

    // Track which titles are in the file
    const fileTitles = new Set();

    // Process rules from file
    for (const rule of fileRules) {
        const titleKey = rule.title.toLowerCase().trim();
        fileTitles.add(titleKey);

        const existing = existingRules.get(titleKey);

        if (existing) {
            // Update existing rule
            const docRef = db.collection(COLLECTION_NAME).doc(existing.id);
            batch.update(docRef, {
                title: rule.title,
                description: rule.description,
                explanation: rule.explanation,
                points: rule.points,
                active: true,
                updatedAt: now
            });
            console.log(`  🔄 Update: "${rule.title}" (${rule.points} points)`);
            updated++;
        } else {
            // Add new rule
            const docRef = db.collection(COLLECTION_NAME).doc();
            batch.set(docRef, {
                title: rule.title,
                description: rule.description,
                explanation: rule.explanation,
                points: rule.points,
                active: true,
                createdAt: now,
                updatedAt: now
            });
            console.log(`  + Add: "${rule.title}" (${rule.points} points)`);
            added++;
        }
    }

    // Deactivate rules not in file
    for (const [titleKey, existing] of existingRules) {
        if (!fileTitles.has(titleKey) && existing.active !== false) {
            const docRef = db.collection(COLLECTION_NAME).doc(existing.id);
            batch.update(docRef, {
                active: false,
                updatedAt: now
            });
            console.log(`  - Deactivate: "${existing.title}"`);
            deactivated++;
        }
    }

    // Commit batch
    await batch.commit();

    console.log('');
    console.log('••••••••••••••••••••••••••••••••••••••••••');
    console.log(`✅ Sync complete!`);
    console.log(`  Updated:     ${updated}`);
    console.log(`  Added:       ${added}`);
    console.log(`  Deactivated: ${deactivated}`);
    console.log('••••••••••••••••••••••••••••••••••••••••••');
}

/**
 * Main function
 */
async function main() {
    console.log('');
    console.log('••••••••••••••••••••••••••••••••••••••••••');
    console.log('   Points Rules Sync Script');
    console.log('••••••••••••••••••••••••••••••••••••••••••');
    console.log('');

    // Get file path from command line
    const filePath = process.argv[2];

    if (!filePath) {
        console.error('❌ Error: No file specified.');
        console.log('');
        console.log('   Usage: node sync-points-rules.js <file>');
        console.log('   Example: node sync-points-rules.js points-rules.csv');
        console.log('');
        process.exit(1);
    }

    try {
        // Initialize Firebase
        const db = initializeFirebase();

        // Parse file
        const fileRules = await parseFile(filePath);

        if (fileRules.length === 0) {
            console.error('❌ Error: No valid rules found in file.');
            process.exit(1);
        }

        // Get existing rules
        const existingRules = await getExistingRules(db);

        // Sync rules
        console.log('');
        console.log('Syncing rules...');
        await syncRules(db, fileRules, existingRules);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }

    process.exit(0);
}

// Run
main();