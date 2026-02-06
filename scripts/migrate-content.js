/**
 * Content Migration Script
 * 
 * Imports Excel content to Firestore for server-side verification.
 * Run with: node scripts/migrate-content.js
 */

const admin = require('firebase-admin');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Initialize Firebase Admin
const serviceAccount = require('../serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Content sources
const CONTENT_SOURCES = {
    type: {
        file: 'public/database/type/WFD.xlsx',
        prefix: 'type_',
        parser: parseTypeContent
    },
    extended: {
        file: 'public/database/extended/LFIB.xlsx',
        prefix: 'extended_',
        parser: parseExtendedContent
    },
    speak: {
        file: 'public/database/speak/RS.xlsx',
        prefix: 'speak_',
        parser: parseSpeakContent
    }
};

/**
 * Parse Type mode content (WFD.xlsx)
 * Expected columns: ID, Text, Audio, Level
 */
function parseTypeContent(data) {
    return data.map((row, index) => {
        const id = row['ID'] || row['id'] || index + 1;
        const text = row['Text'] || row['text'] || row['Sentence'] || '';
        const level = row['Level'] || row['level'] || row['Difficulty'] || 'medium';

        return {
            id: String(id),
            mode: 'type',
            text: text.trim(),
            wordCount: text.trim().split(/\s+/).filter(w => w).length,
            difficultyTag: normalizeDifficulty(level),
            difficultyMultiplier: getDifficultyMultiplier(level),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
    }).filter(item => item.text.length > 0);
}

/**
 * Parse Extended mode content (LFIB.xlsx)
 * Expected columns: ID, Text (with {___} gaps), Answers
 */
function parseExtendedContent(data) {
    return data.map((row, index) => {
        const id = row['ID'] || row['id'] || index + 1;
        const text = row['Text'] || row['text'] || row['Sentence'] || '';
        const answersStr = row['Answers'] || row['answers'] || row['Answer'] || '';
        const level = row['Level'] || row['level'] || row['Difficulty'] || 'medium';

        // Parse gap answers
        const gapAnswers = answersStr.split(',').map((ans, idx) => ({
            index: idx,
            answers: ans.trim().split('/').map(a => a.trim().toLowerCase())
        }));

        return {
            id: String(id),
            mode: 'extended',
            text: text.trim(),
            gaps: gapAnswers,
            wordCount: text.trim().split(/\s+/).filter(w => w).length,
            difficultyTag: normalizeDifficulty(level),
            difficultyMultiplier: getDifficultyMultiplier(level),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
    }).filter(item => item.text.length > 0);
}

/**
 * Parse Speak mode content (RS.xlsx)
 * Expected columns: ID, Text, Audio
 */
function parseSpeakContent(data) {
    return data.map((row, index) => {
        const id = row['ID'] || row['id'] || index + 1;
        const text = row['Text'] || row['text'] || row['Sentence'] || '';
        const level = row['Level'] || row['level'] || row['Difficulty'] || 'medium';

        return {
            id: String(id),
            mode: 'speak',
            text: text.trim(),
            wordCount: text.trim().split(/\s+/).filter(w => w).length,
            difficultyTag: normalizeDifficulty(level),
            difficultyMultiplier: getDifficultyMultiplier(level),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
    }).filter(item => item.text.length > 0);
}

/**
 * Normalize difficulty string to tag
 */
function normalizeDifficulty(level) {
    const normalized = String(level).toLowerCase().trim();
    if (normalized.includes('easy') || normalized.includes('a1') || normalized.includes('a2')) {
        return 'easy';
    } else if (normalized.includes('hard') || normalized.includes('c1')) {
        return 'hard';
    } else if (normalized.includes('expert') || normalized.includes('c2')) {
        return 'expert';
    }
    return 'medium'; // Default
}

/**
 * Get difficulty multiplier from tag
 */
function getDifficultyMultiplier(level) {
    const tag = normalizeDifficulty(level);
    switch (tag) {
        case 'easy': return 1.0;
        case 'medium': return 1.5;
        case 'hard': return 2.0;
        case 'expert': return 2.5;
        default: return 1.5;
    }
}

/**
 * Read Excel file and return JSON data
 */
function readExcel(filePath) {
    const absolutePath = path.resolve(__dirname, '..', filePath);

    if (!fs.existsSync(absolutePath)) {
        console.warn(`⚠️ File not found: ${absolutePath}`);
        return [];
    }

    const workbook = XLSX.readFile(absolutePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet);
}

/**
 * Batch write documents to Firestore
 */
async function batchWrite(collectionName, documents, prefix) {
    const BATCH_SIZE = 500;
    let written = 0;

    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = documents.slice(i, i + BATCH_SIZE);

        chunk.forEach(doc => {
            const docId = `${prefix}${doc.id}`;
            const ref = db.collection(collectionName).doc(docId);
            batch.set(ref, doc, { merge: true });
        });

        await batch.commit();
        written += chunk.length;
        console.log(`  ✓ Written ${written}/${documents.length} documents`);
    }

    return written;
}

/**
 * Main migration function
 */
async function migrate() {
    console.log('🚀 Starting content migration...\n');

    const stats = {
        type: 0,
        extended: 0,
        speak: 0
    };

    for (const [mode, config] of Object.entries(CONTENT_SOURCES)) {
        console.log(`📁 Processing ${mode} content from ${config.file}...`);

        try {
            const rawData = readExcel(config.file);

            if (rawData.length === 0) {
                console.log(`  ⚠️ No data found in ${config.file}`);
                continue;
            }

            console.log(`  Found ${rawData.length} rows`);

            const documents = config.parser(rawData);
            console.log(`  Parsed ${documents.length} valid documents`);

            if (documents.length > 0) {
                const count = await batchWrite('contentItems', documents, config.prefix);
                stats[mode] = count;
            }

            console.log('');
        } catch (error) {
            console.error(`  ❌ Error processing ${mode}:`, error.message);
        }
    }

    console.log('='.repeat(50));
    console.log('📊 Migration Summary:');
    console.log(`  Type (WFD):      ${stats.type} documents`);
    console.log(`  Extended (LFIB): ${stats.extended} documents`);
    console.log(`  Speak (RS):      ${stats.speak} documents`);
    console.log(`  Total:           ${stats.type + stats.extended + stats.speak} documents`);
    console.log('='.repeat(50));
    console.log('✅ Migration complete!');
}

// Run migration
migrate()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    });
