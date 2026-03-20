// src/services/reading-journey/thumbnail-contracts.js

function validateThumbnailSceneSummary(summary) {
    if (!summary) throw new Error('Scene summary is required');
    
    // Limits spoilerLevel to safe_library, safe_story_detail, or full
    const validSpoilerLevels = ['safe_library', 'safe_story_detail', 'full'];
    if (!validSpoilerLevels.includes(summary.spoilerLevel)) {
        throw new Error('spoilerLevel must be safe_library, safe_story_detail, or full');
    }
    
    return summary;
}

function buildThumbnailSceneSummary(data) {
    return validateThumbnailSceneSummary(data);
}

function validateThumbnailPromptSpec(spec) {
    if (!spec) throw new Error('Prompt spec is required');
    return spec;
}

function buildThumbnailPromptSpec(data) {
    return validateThumbnailPromptSpec(data);
}

function validateThumbnailAuditSpec(spec) {
    if (!spec) throw new Error('Audit spec is required');
    
    if (spec.universalCriteria) {
        spec.universalCriteria.forEach(c => {
            if (!c.id || !c.label || !c.severity || !c.question) {
                throw new Error('id, label, severity, and question are required for universal criteria');
            }
        });
    }
    
    if (spec.storyCriteria) {
        spec.storyCriteria.forEach(c => {
            if (!c.source) {
                throw new Error('source linking back to summary fields or beat ids is required for story criteria');
            }
        });
    }
    return spec;
}

function buildThumbnailAuditSpec(data) {
    return validateThumbnailAuditSpec(data);
}

function validateThumbnailGenerationRecord(record) {
    if (!record) throw new Error('Generation record is required');
    return record;
}

function buildThumbnailGenerationRecord(data) {
    return validateThumbnailGenerationRecord(data);
}

module.exports = {
    validateThumbnailSceneSummary,
    buildThumbnailSceneSummary,
    validateThumbnailPromptSpec,
    buildThumbnailPromptSpec,
    validateThumbnailAuditSpec,
    buildThumbnailAuditSpec,
    validateThumbnailGenerationRecord,
    buildThumbnailGenerationRecord
};
