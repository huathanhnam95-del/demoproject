const { buildThumbnailSceneSummary } = require('./thumbnail-summary');
const { buildThumbnailPromptSpec, buildThumbnailAuditSpec } = require('./thumbnail-prompt');
const { generateThumbnailImage } = require('./thumbnail-generator');
const { auditThumbnail, shouldRetryThumbnail, buildRepairPromptDelta } = require('./thumbnail-audit');

async function generateStoryThumbnail(storyId, options = {}) {
    // 1. Fetch story and beats (Mocked for testing/dryRun)
    const outline = { title: 'Mock Story' };
    const beats = [{ id: 'beat-1' }];

    // 2. Build summary
    const summary = await buildThumbnailSceneSummary({ outline, beats });

    // 3. Build specs
    const promptSpec = buildThumbnailPromptSpec(summary);
    const auditSpec = buildThumbnailAuditSpec(summary);

    let attempt = 1;
    let passed = false;
    let lastAuditResult = null;
    let lastImageResponse = null;
    let repairPromptDelta = '';

    // 4. Generation & Audit Loop
    while (attempt <= 3 && !passed) {
        lastImageResponse = await generateThumbnailImage({
            promptSpec,
            repairPromptDelta,
            attempt
        });

        lastAuditResult = await auditThumbnail(lastImageResponse.imageBytes, auditSpec);

        if (lastAuditResult.passed) {
            passed = true;
        } else {
            if (shouldRetryThumbnail(lastAuditResult, attempt)) {
                repairPromptDelta = buildRepairPromptDelta(lastAuditResult);
                attempt++;
            } else {
                break; // Stop retrying if policy dictates
            }
        }
    }

    // 5. Persist to Storage and Firestore (mocked for dryRun)
    const db = require('../../utils/firebase').db;
    const fs = require('fs/promises');
    const path = require('path');
    
    // Save to public folder so the browser can serve it statically
    const publicPath = path.join(__dirname, '..', '..', '..', 'public', 'reading-journey', 'thumbnails');
    const fileName = `${storyId}.jpg`;
    
    const record = {
        storyId,
        createdAt: new Date().toISOString(),
        promptSpec,
        auditSpec,
        auditResult: lastAuditResult,
        attempts: lastImageResponse.attempt,
        imageStoragePath: `/reading-journey/thumbnails/${fileName}`,
        finalModel: lastImageResponse.model,
        isFallback: false
    };

    if (!options.dryRun) {
        try {
            await fs.mkdir(publicPath, { recursive: true });
            await fs.writeFile(path.join(publicPath, fileName), lastImageResponse.imageBytes);
            
            // Write to Firestore db
            const firestore = db;
            if (firestore) {
                await firestore.collection('reading_journey_outlines_v1').doc(storyId).update({
                    thumbnailRecord: record
                });
                console.log(`[ThumbnailService] Successfully updated Firestore for ${storyId}`);
            }
        } catch (e) {
            console.error(`[ThumbnailService] Error saving artifact for ${storyId}:`, e.message);
        }
    }

    return {
        record,
        buffer: lastImageResponse.imageBytes
    };
}

module.exports = {
    generateStoryThumbnail
};
