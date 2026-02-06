/**
 * Watch Question Keys Split Migration script
 * 
 * Separates sensitive 'correctAnswer' and 'modelAnswer' from the public 
 * '/questions' collection into a private '/questionKeys' collection.
 * 
 * Run with: node scripts/split-watch-keys.js
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin using the same service account as migrate-content.js
const serviceAccount = require('../serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function splitKeys() {
    console.log('🚀 Starting Watch Question keys split migration...\n');

    try {
        // 1. Get all video documents
        const videosSnapshot = await db.collection('watchVideos').get();
        console.log(`Found ${videosSnapshot.size} videos.`);

        let totalQuestionsProcessed = 0;
        let totalKeysCreated = 0;
        let totalFieldsDeleted = 0;

        for (const videoDoc of videosSnapshot.docs) {
            const videoId = videoDoc.id;
            console.log(`\n📹 Processing video: ${videoId}`);

            // 2. Get all questions for this video
            const questionsSnapshot = await videoDoc.ref.collection('questions').get();
            console.log(`  Found ${questionsSnapshot.size} questions.`);

            for (const qDoc of questionsSnapshot.docs) {
                const questionId = qDoc.id;
                const data = qDoc.data();

                // 3. Check if sensitive data exists
                const keyData = {};
                let hasSensitiveData = false;

                if (data.hasOwnProperty('correctAnswer')) {
                    keyData.correctAnswer = data.correctAnswer;
                    hasSensitiveData = true;
                }
                if (data.hasOwnProperty('modelAnswer')) {
                    keyData.modelAnswer = data.modelAnswer;
                    hasSensitiveData = true;
                }

                if (hasSensitiveData) {
                    console.log(`    🔑 Splitting keys for [${questionId}]...`);

                    const batch = db.batch();

                    // Create the key document in the private collection
                    const keyRef = videoDoc.ref.collection('questionKeys').doc(questionId);
                    batch.set(keyRef, keyData, { merge: true });

                    // Remove sensitive fields from the public document
                    const updateData = {};
                    if (data.hasOwnProperty('correctAnswer')) {
                        updateData.correctAnswer = admin.firestore.FieldValue.delete();
                    }
                    if (data.hasOwnProperty('modelAnswer')) {
                        updateData.modelAnswer = admin.firestore.FieldValue.delete();
                    }
                    batch.update(qDoc.ref, updateData);

                    await batch.commit();

                    totalKeysCreated++;
                    totalFieldsDeleted++;
                } else {
                    console.log(`    ℹ️ Question [${questionId}] already split or no sensitive data.`);
                }
                totalQuestionsProcessed++;
            }
        }

        console.log('\n' + '='.repeat(50));
        console.log('📊 Migration Summary:');
        console.log(`  Questions Processed: ${totalQuestionsProcessed}`);
        console.log(`  Keys Moved:          ${totalKeysCreated}`);
        console.log(`  Fields Hardened:     ${totalFieldsDeleted}`);
        console.log('='.repeat(50));
        console.log('✅ Migration complete!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

splitKeys().then(() => process.exit(0));
