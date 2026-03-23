require('dotenv').config();
const { generateStoryThumbnail } = require('../../src/services/reading-journey/thumbnail-service');
const fs = require('fs/promises');
const { db } = require('../../src/utils/firebase');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log('Starting Reading Journey Thumbnail Backfill...');
    
    const firestore = db;
    if (!firestore) {
        console.error('Failed to initialize Firebase db');
        return;
    }

    console.log('Fetching eligible stories without thumbnails...');
    
    // Fetch stories that passed audit and don't have a thumbnail record yet
    const snapshot = await firestore.collection('reading_journey_outlines_v1')
        .where('qualityScore.passed', '==', true)
        .limit(40)
        .get();

    const allPassedStories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Filter out stories that already have thumbnailRecord
    const eligibleStories = allPassedStories
        .filter(story => !story.thumbnailRecord)
        .slice(0, 20);

    if (eligibleStories.length === 0) {
        console.log('No eligible stories found needing a thumbnail.');
        return;
    }

    console.log(`Found ${eligibleStories.length} stories to process.`);

    let successCount = 0;
    let failCount = 0;

    for (const story of eligibleStories) {
        console.log(`Processing story: ${story.id} (${story.title})`);
        try {
            // Attempt to generate
            const result = await generateStoryThumbnail(story.id, { dryRun: false });
            
            console.log(`✅ Success for ${story.id} - stored at ${result.record.imageStoragePath}`);
            successCount++;
        } catch (e) {
            console.error(`❌ Failed for ${story.id}:`, e.message);
            failCount++;
        }
        
        // Wait between generations to avoid rate limits
        await delay(2000);
    }

    console.log('=============================');
    console.log('Backfill Complete');
    console.log(`Success: ${successCount}`);
    console.log(`Failed:  ${failCount}`);
    console.log('=============================');

    const report = {
        timestamp: new Date().toISOString(),
        successCount,
        failCount,
        storiesProcessed: eligibleStories.length
    };

    try {
        await fs.mkdir('./docs/audits', { recursive: true });
        await fs.writeFile('./docs/audits/backfill_report.json', JSON.stringify(report, null, 2));
        console.log('Audit artifact written to docs/audits/backfill_report.json');
    } catch (err) {
        console.error('Failed to write audit artifact:', err);
    }
}

run();
