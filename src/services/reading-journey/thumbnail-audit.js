// src/services/reading-journey/thumbnail-audit.js

function getAuditModelName() {
    return process.env.READING_JOURNEY_THUMBNAIL_AUDIT_MODEL || 'gemini-1.5-pro';
}

function getMaxAttempts() {
    return parseInt(process.env.READING_JOURNEY_THUMBNAIL_MAX_ATTEMPTS || '3', 10);
}

async function auditThumbnail(imageBytes, auditSpec) {
    if (!imageBytes || !auditSpec) throw new Error('Missing arguments for audit');
    
    // For test mode, mock the response
    if (process.env.NODE_ENV === 'test' || process.env.DRY_RUN) {
        return {
            passed: true,
            universalResults: (auditSpec.universalCriteria || []).map(c => ({ id: c.id, passed: true, explanation: 'Looks good' })),
            storyResults: (auditSpec.storyCriteria || []).map(c => ({ id: c.id, passed: true, explanation: 'Matches' })),
            blockingFailuresFound: []
        };
    }
    
    // Real implementation would invoke multimodal AI evaluation
    return {
        passed: true,
        universalResults: (auditSpec.universalCriteria || []).map(c => ({ id: c.id, passed: true, explanation: 'OK' })),
        storyResults: (auditSpec.storyCriteria || []).map(c => ({ id: c.id, passed: true, explanation: 'OK' })),
        blockingFailuresFound: []
    };
}

function buildRepairPromptDelta(auditResult) {
    if (!auditResult || auditResult.passed) return '';
    
    const failures = [
        ...(auditResult.universalResults || []).filter(r => !r.passed),
        ...(auditResult.storyResults || []).filter(r => !r.passed)
    ];
    
    if (failures.length === 0) return '';
    return 'Fix the following issues: ' + failures.map(f => f.explanation).join('. ');
}

function shouldRetryThumbnail(auditResult, attempt) {
    if (auditResult.passed) return false;
    if (attempt >= getMaxAttempts()) return false;
    
    if (auditResult.blockingFailuresFound && auditResult.blockingFailuresFound.length > 0) {
        return true;
    }
    
    const failedStory = (auditResult.storyResults || []).filter(r => !r.passed);
    if (failedStory.length > 0) return true;
    
    return false;
}

function summarizeAuditForLogs(auditResult) {
    return {
        passed: auditResult.passed,
        blockingCount: (auditResult.blockingFailuresFound || []).length,
        failedRules: [
            ...(auditResult.universalResults || []).filter(r => !r.passed).map(r => r.id),
            ...(auditResult.storyResults || []).filter(r => !r.passed).map(r => r.id)
        ]
    };
}

module.exports = {
    auditThumbnail,
    buildRepairPromptDelta,
    shouldRetryThumbnail,
    summarizeAuditForLogs
};
