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
    const storagePath = `reading-journey/thumbnails/${storyId}/thumb_${Date.now()}.jpg`;
    
    const record = {
        storyId,
        createdAt: new Date().toISOString(),
        promptSpec,
        auditSpec,
        auditResult: lastAuditResult,
        attempts: lastImageResponse.attempt,
        imageStoragePath: storagePath,
        finalModel: lastImageResponse.model,
        isFallback: false
    };

    if (!options.dryRun) {
        // Real upload and database write logic goes here
    }

    return {
        record,
        buffer: lastImageResponse.imageBytes
    };
}

module.exports = {
    generateStoryThumbnail
};
