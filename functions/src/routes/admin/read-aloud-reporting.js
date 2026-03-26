const fs = require('fs');
const path = require('path');

const DEFAULT_INDEX_PATH = path.join(__dirname, '..', '..', 'data', 'read-aloud-connected-speech-index.json');
const ATTEMPTS_COLLECTION = 'readAloudConnectedSpeechAttempts';

let cachedIndex = null;
let cachedIndexPath = '';

function normalizePrompt(prompt) {
    if (!prompt || typeof prompt !== 'object') return null;
    return {
        rowKey: prompt.rowKey || null,
        questionId: prompt.questionId == null ? null : String(prompt.questionId),
        title: String(prompt.title || ''),
        hasSampleAudio: Boolean(prompt.hasSampleAudio),
        hasAnyConnectedSpeech: Boolean(prompt.hasAnyConnectedSpeech),
        hasLinking: Boolean(prompt.hasLinking),
        linkingCount: Number(prompt.linkingCount || 0),
        hasReducedWords: Boolean(prompt.hasReducedWords),
        reducedWordCount: Number(prompt.reducedWordCount || 0),
        hasSoundChanges: Boolean(prompt.hasSoundChanges),
        soundChangeCount: Number(prompt.soundChangeCount || 0),
        soundChangeSubtypes: Array.isArray(prompt.soundChangeSubtypes) ? prompt.soundChangeSubtypes.slice() : [],
        representativeExamples: Array.isArray(prompt.representativeExamples) ? prompt.representativeExamples.slice() : []
    };
}

function loadIndex(indexPath = DEFAULT_INDEX_PATH) {
    const resolvedPath = path.resolve(indexPath);
    if (cachedIndex && cachedIndexPath === resolvedPath) {
        return cachedIndex;
    }

    if (!fs.existsSync(resolvedPath)) {
        return null;
    }

    const raw = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = JSON.parse(raw);
    const prompts = Array.isArray(parsed.prompts) ? parsed.prompts.map(normalizePrompt).filter(Boolean) : [];
    cachedIndex = {
        ...parsed,
        prompts
    };
    cachedIndexPath = resolvedPath;
    return cachedIndex;
}

function buildPromptSummary(index) {
    const prompts = Array.isArray(index?.prompts) ? index.prompts : [];
    const soundChangeSubtypeCounts = {};

    const summary = {
        indexVersion: String(index?.indexVersion || index?.version || ''),
        generatedAt: String(index?.generatedAt || index?.updatedAt || ''),
        promptCount: prompts.length,
        audioAvailableCount: 0,
        audioUnavailableCount: 0,
        anyConnectedCount: 0,
        linkingCount: 0,
        reducedWordCount: 0,
        soundChangeCount: 0,
        soundChangeSubtypeCounts,
        samplePrompts: []
    };

    prompts.forEach((prompt) => {
        if (prompt.hasSampleAudio) summary.audioAvailableCount += 1;
        else summary.audioUnavailableCount += 1;
        if (prompt.hasAnyConnectedSpeech) summary.anyConnectedCount += 1;
        if (prompt.hasLinking) summary.linkingCount += 1;
        if (prompt.hasReducedWords) summary.reducedWordCount += 1;
        if (prompt.hasSoundChanges) summary.soundChangeCount += 1;
        (prompt.soundChangeSubtypes || []).forEach((subtype) => {
            const key = String(subtype || 'unknown').trim() || 'unknown';
            soundChangeSubtypeCounts[key] = (soundChangeSubtypeCounts[key] || 0) + 1;
        });
    });

    summary.samplePrompts = prompts
        .slice()
        .sort((left, right) => {
            const leftScore = (left.hasSoundChanges ? 3 : 0) + (left.hasReducedWords ? 2 : 0) + (left.hasLinking ? 1 : 0);
            const rightScore = (right.hasSoundChanges ? 3 : 0) + (right.hasReducedWords ? 2 : 0) + (right.hasLinking ? 1 : 0);
            if (rightScore !== leftScore) return rightScore - leftScore;
            return String(left.questionId || left.rowKey || '').localeCompare(String(right.questionId || right.rowKey || ''), 'en');
        })
        .slice(0, 12)
        .map((prompt) => ({
            rowKey: prompt.rowKey,
            questionId: prompt.questionId,
            title: prompt.title,
            hasSampleAudio: prompt.hasSampleAudio,
            hasLinking: prompt.hasLinking,
            hasReducedWords: prompt.hasReducedWords,
            hasSoundChanges: prompt.hasSoundChanges,
            soundChangeSubtypes: prompt.soundChangeSubtypes || []
        }));

    return summary;
}

function normalizeCreatedAt(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTrimmed(value) {
    return String(value == null ? '' : value).trim();
}

function normalizeBucket(value, fallback = 'unknown') {
    const normalized = normalizeTrimmed(value).toLowerCase();
    return normalized || fallback;
}

function isRealShadowRecord(shadow) {
    if (!shadow || typeof shadow !== 'object') return false;
    return shadow.shadowKind === 'mfa_result' || shadow.engine === 'mfa' || shadow.mode === 'mfa_primary';
}

function isPlaceholderShadowRecord(shadow) {
    if (!shadow || typeof shadow !== 'object') return false;
    if (shadow.shadowKind === 'placeholder' || shadow.shadowKind === 'shadow_placeholder') return true;
    if (shadow.shadowKind && shadow.shadowKind !== 'placeholder') return false;
    return shadow.mode === 'shadow_mfa' || shadow.primarySource === 'heuristic' || shadow.note === 'MFA rollout scaffold; heuristic result mirrored until the MFA worker is wired in.';
}

function classifyAudioQuality(attempt) {
    const passed = normalizeBucket(attempt?.audioQualityPassed, '');
    const reason = normalizeBucket(attempt?.audioQualityReason || attempt?.audioQuality?.reason, '');
    const hasAudioQualityObject = Boolean(attempt?.audioQuality && typeof attempt.audioQuality === 'object');
    const hasAudioQualityFields = passed || reason;

    if (passed === 'true' || passed === 'passed') {
        return { outcome: 'passed', reason: null };
    }

    if (passed === 'false' || passed === 'failed') {
        return { outcome: 'failed', reason: reason || 'unspecified_failure' };
    }

    if (reason && reason !== 'none' && reason !== 'unknown') {
        return { outcome: 'failed', reason };
    }

    if (hasAudioQualityObject || hasAudioQualityFields) {
        return { outcome: 'unknown', reason: null };
    }

    return { outcome: 'missing', reason: null };
}

function buildUsageSummary(attempts, days) {
    const guideLevelCounts = {};
    const familyFilterCounts = {};
    const requestedAlignmentModeCounts = {};
    const actualScoringModeCounts = {};
    const alignmentFallbackReasonCounts = {};
    const workerStatusCounts = {};
    const audioQualityOutcomeCounts = {};
    const audioQualityFailureReasonCounts = {};
    let promptIndexVersionComparableCount = 0;
    let promptIndexVersionMismatchCount = 0;
    let promptIndexVersionUncomparableCount = 0;
    const promptCounts = {};
    let v3NoSoundChangeCount = 0;
    let realShadowAttemptCount = 0;
    let shadowPlaceholderCount = 0;

    attempts.forEach((attempt) => {
        const guideLevel = normalizeBucket(attempt?.clientContext?.guideLevel, 'unknown');
        const familyFilter = normalizeBucket(attempt?.clientContext?.promptFamilyFilter, 'unknown');
        const requestedAlignmentMode = normalizeBucket(attempt?.requestedAlignmentMode, 'legacy_unknown');
        const scoringMode = normalizeBucket(attempt?.scoringMode, 'heuristic');
        const workerStatus = normalizeBucket(attempt?.workerStatus, 'unknown');
        const alignmentFallbackReason = normalizeBucket(attempt?.alignmentFallbackReason, 'none');
        const audioQuality = classifyAudioQuality(attempt);
        const clientPromptIndexVersion = normalizeTrimmed(attempt?.clientContext?.promptIndexVersion);
        const serverPromptIndexVersion = normalizeTrimmed(attempt?.promptIndexVersion);
        const questionId = String(attempt?.questionId || '').trim();
        const questionTitle = String(attempt?.promptFeatureSnapshot?.title || '');
        const shadow = attempt?.connectedSpeechShadow || null;

        guideLevelCounts[guideLevel] = (guideLevelCounts[guideLevel] || 0) + 1;
        familyFilterCounts[familyFilter] = (familyFilterCounts[familyFilter] || 0) + 1;
        requestedAlignmentModeCounts[requestedAlignmentMode] = (requestedAlignmentModeCounts[requestedAlignmentMode] || 0) + 1;
        actualScoringModeCounts[scoringMode] = (actualScoringModeCounts[scoringMode] || 0) + 1;
        alignmentFallbackReasonCounts[alignmentFallbackReason] = (alignmentFallbackReasonCounts[alignmentFallbackReason] || 0) + 1;
        workerStatusCounts[workerStatus] = (workerStatusCounts[workerStatus] || 0) + 1;
        audioQualityOutcomeCounts[audioQuality.outcome] = (audioQualityOutcomeCounts[audioQuality.outcome] || 0) + 1;
        if (audioQuality.outcome === 'failed') {
            const failureReason = normalizeBucket(audioQuality.reason, 'unspecified_failure');
            audioQualityFailureReasonCounts[failureReason] = (audioQualityFailureReasonCounts[failureReason] || 0) + 1;
        }
        if (shadow) {
            if (isRealShadowRecord(shadow)) {
                realShadowAttemptCount += 1;
            } else if (isPlaceholderShadowRecord(shadow)) {
                shadowPlaceholderCount += 1;
            } else {
                shadowPlaceholderCount += 1;
            }
        }

        if (clientPromptIndexVersion && serverPromptIndexVersion) {
            promptIndexVersionComparableCount += 1;
            if (clientPromptIndexVersion !== serverPromptIndexVersion) {
                promptIndexVersionMismatchCount += 1;
            }
        } else {
            promptIndexVersionUncomparableCount += 1;
        }

        if (guideLevel === 'v3_sound_changes' && attempt?.promptFeatureSnapshot && !attempt.promptFeatureSnapshot.hasSoundChanges) {
            v3NoSoundChangeCount += 1;
        }

        const promptKey = questionId || String(attempt?.promptFeatureSnapshot?.rowKey || 'unknown');
        if (!promptCounts[promptKey]) {
            promptCounts[promptKey] = {
                questionId: questionId || null,
                title: questionTitle || promptKey,
                count: 0
            };
        }
        promptCounts[promptKey].count += 1;
    });

    const topPrompts = Object.values(promptCounts)
        .sort((left, right) => right.count - left.count || String(left.questionId || left.title || '').localeCompare(String(right.questionId || right.title || ''), 'en'))
        .slice(0, 10);

    return {
        generatedAt: new Date().toISOString(),
        periodDays: days,
        attemptCount: attempts.length,
        guideLevelCounts,
        familyFilterCounts,
        requestedAlignmentModeCounts,
        actualScoringModeCounts,
        scoringModeCounts: actualScoringModeCounts,
        workerStatusCounts,
        alignmentFallbackReasonCounts,
        audioQualityOutcomeCounts,
        audioQualityFailureReasonCounts,
        audioQualityReasonCounts: audioQualityFailureReasonCounts,
        realShadowAttemptCount,
        shadowPlaceholderCount,
        shadowAttemptCount: realShadowAttemptCount + shadowPlaceholderCount,
        promptIndexVersionComparableCount,
        promptIndexVersionMismatchCount,
        promptIndexVersionUncomparableCount,
        v3NoSoundChangeCount,
        topPrompts
    };
}

module.exports = function registerReadAloudReportingRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers } = deps;
    const indexPath = deps.readAloudIndexPath || DEFAULT_INDEX_PATH;

    router.get('/read-aloud/prompt-summary', ...requireAdminHandlers, async (_req, res) => {
        try {
            const index = loadIndex(indexPath);
            if (!index) {
                return sendError(res, 503, 'INDEX_UNAVAILABLE', 'Read Aloud prompt index unavailable.');
            }

            const promptSummary = buildPromptSummary(index);
            return sendSuccess(res, { promptSummary });
        } catch (error) {
            return sendError(res, 500, 'GET_READ_ALOUD_PROMPT_SUMMARY_ERROR', 'Failed to load Read Aloud prompt summary.', error?.message || error);
        }
    });

    router.get('/read-aloud/usage-summary', ...requireAdminHandlers, async (req, res) => {
        try {
            const daysRaw = Number(req.query?.days);
            const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(30, Math.floor(daysRaw))) : 7;
            const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

            let snap;
            try {
                snap = await db.collection(ATTEMPTS_COLLECTION)
                    .where('createdAt', '>=', startDate)
                    .get();
            } catch (_) {
                snap = await db.collection(ATTEMPTS_COLLECTION).get();
            }

            const attempts = snap.docs
                .map((doc) => ({ attemptId: doc.id, ...doc.data() }))
                .filter((attempt) => {
                    const createdAt = normalizeCreatedAt(attempt.createdAt);
                    return !createdAt || createdAt >= startDate;
                });

            return sendSuccess(res, { usageSummary: buildUsageSummary(attempts, days) });
        } catch (error) {
            return sendError(res, 500, 'GET_READ_ALOUD_USAGE_SUMMARY_ERROR', 'Failed to load Read Aloud usage summary.', error?.message || error);
        }
    });
};
