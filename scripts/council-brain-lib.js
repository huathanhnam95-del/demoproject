const fs = require('fs');
const path = require('path');

const PERSONAS = {
    architect: {
        displayName: 'Architect',
        brief: 'Propose the strongest evidence-based structure or solution. Keep it concrete.'
    },
    challenger: {
        displayName: 'Challenger',
        brief: 'Critique the current plan aggressively, but only using the provided evidence and prior debate.'
    },
    reviewer: {
        displayName: 'Reviewer',
        brief: 'Synthesize the debate into the smallest set of grounded findings and actions.'
    }
};

const DEFAULT_PERSONA_ORDER = ['architect', 'challenger', 'reviewer'];
const MAX_EVIDENCE_SPAN_LINES = 20;
const DEFAULT_MAX_FULL_CONTEXT_LINES = 80;
const DEFAULT_EXCERPT_RADIUS_LINES = 2;
const DEFAULT_MAX_EXCERPT_MATCHES_PER_FILE = 4;
const DEFAULT_MAX_CONTEXT_CHARS = 120000;
const DEFAULT_MAX_ROLE_ATTEMPTS = 3;
const REQUIRED_SECTIONS = {
    architect: ['Observed Facts', 'Inferences', 'Recommendations', 'Unknowns'],
    challenger: ['Supported Concerns', 'Weak Claims', 'Corrections', 'Remaining Unknowns'],
    reviewer: ['Final Findings', 'Recommended Actions', 'Open Unknowns']
};
const ABSOLUTE_PATH_START_PATTERN = /[A-Za-z]:[\\/]/g;
const RELATIVE_PATH_START_PATTERN = /(?:\.{1,2}[\\/]|[A-Za-z0-9_-]+[\\/])/g;
const ROLE_ERROR_PATTERN = /^\[Error querying [^\]]+\]/;
const COMMON_SEARCH_TERMS = new Set([
    'review', 'logic', 'issue', 'issues', 'current', 'implementation', 'whole',
    'again', 'this', 'that', 'with', 'from', 'into', 'file', 'files', 'please'
]);

function normalizePathCandidate(candidate) {
    return String(candidate || '').replace(/^["'`]+|["'`.,;:!?]+$/g, '');
}

function toPathKey(filePath) {
    const normalized = path.normalize(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function extractPathFrom(message, startIndex) {
    const remainder = message.slice(startIndex);
    const match = remainder.match(/^[^"'`\n]+?\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*/);
    return match ? normalizePathCandidate(match[0]) : null;
}

function extractReferencedFiles(userMessage) {
    if (!userMessage) return [];

    const matches = [];
    const occupiedRanges = [];
    let match;

    while ((match = ABSOLUTE_PATH_START_PATTERN.exec(userMessage)) !== null) {
        const candidate = extractPathFrom(userMessage, match.index);
        if (candidate) {
            matches.push(candidate);
            occupiedRanges.push({
                start: match.index,
                end: match.index + candidate.length
            });
        }
    }

    while ((match = RELATIVE_PATH_START_PATTERN.exec(userMessage)) !== null) {
        const startIndex = match.index;
        const previousChar = startIndex > 0 ? userMessage[startIndex - 1] : '';
        const previousTwo = startIndex > 1 ? userMessage.slice(startIndex - 2, startIndex) : '';
        const looksNestedInAbsolutePath = previousChar === '\\' || previousChar === '/' || previousTwo.endsWith(':');
        const hasBoundary = startIndex === 0 || /\s|["'`(]/.test(previousChar);

        if (looksNestedInAbsolutePath || !hasBoundary) {
            continue;
        }

        if (occupiedRanges.some((range) => startIndex >= range.start && startIndex < range.end)) {
            continue;
        }

        const candidate = extractPathFrom(userMessage, startIndex);
        if (candidate) {
            matches.push(candidate);
        }
    }

    return Array.from(new Set(matches.map(normalizePathCandidate).filter(Boolean)));
}

function resolvePathCandidate(candidate, cwd) {
    if (path.isAbsolute(candidate)) {
        return path.normalize(candidate);
    }
    return path.resolve(cwd || process.cwd(), candidate);
}

function buildMissingContextError(missingFiles) {
    const error = new Error(`Missing context file(s): ${missingFiles.join(', ')}`);
    error.code = 'MISSING_CONTEXT';
    error.missingFiles = missingFiles;
    return error;
}

function normalizeEvidenceMarkup(text) {
    return String(text || '')
        .replace(/\[FILE:\s*`([^`]+?)`\]/g, '[FILE: $1]')
        .replace(/\[FILE:\s*"([^"]+?)"\]/g, '[FILE: $1]')
        .replace(/\[FILE:\s*'([^']+?)'\]/g, '[FILE: $1]');
}

function normalizeEvidenceFilePath(value) {
    return normalizePathCandidate(String(value || '').replace(/^["'`]+|["'`]+$/g, ''));
}

function extractSearchTerms(userMessage, resolvedPath) {
    const promptTerms = (String(userMessage || '').match(/[A-Za-z_][A-Za-z0-9_.-]{2,}/g) || [])
        .map((term) => term.toLowerCase())
        .filter((term) => term.length >= 4 && !COMMON_SEARCH_TERMS.has(term));
    const pathTerms = path.basename(resolvedPath)
        .split(/[^A-Za-z0-9_]+/)
        .map((term) => term.toLowerCase())
        .filter((term) => term.length >= 4 && !COMMON_SEARCH_TERMS.has(term));

    return Array.from(new Set([...promptTerms, ...pathTerms]));
}

function mergeRanges(ranges) {
    if (ranges.length === 0) return [];

    const sorted = [...ranges].sort((left, right) => left.start - right.start);
    const merged = [sorted[0]];

    for (let index = 1; index < sorted.length; index += 1) {
        const current = sorted[index];
        const previous = merged[merged.length - 1];
        if (current.start <= previous.end + 1) {
            previous.end = Math.max(previous.end, current.end);
            continue;
        }
        merged.push(current);
    }

    return merged;
}

function formatFileLines(lines, startLineNumber) {
    return lines.map((line, index) => `L${startLineNumber + index}: ${line}`).join('\n');
}

function buildContextSection({
    resolvedPath,
    content,
    userMessage,
    maxFileLinesForFullContext = DEFAULT_MAX_FULL_CONTEXT_LINES,
    excerptRadiusLines = DEFAULT_EXCERPT_RADIUS_LINES,
    maxExcerptMatchesPerFile = DEFAULT_MAX_EXCERPT_MATCHES_PER_FILE
}) {
    const lines = content.split(/\r?\n/);
    const isFullContext = lines.length <= maxFileLinesForFullContext;
    let sectionBody = '';
    let compacted = false;

    if (isFullContext) {
        sectionBody = formatFileLines(lines, 1);
    } else {
        compacted = true;
        const searchTerms = extractSearchTerms(userMessage, resolvedPath);
        const matchingIndexes = [];

        lines.forEach((line, index) => {
            const lowerLine = line.toLowerCase();
            if (searchTerms.some((term) => lowerLine.includes(term))) {
                matchingIndexes.push(index);
            }
        });

        const fallbackIndexes = matchingIndexes.length > 0
            ? matchingIndexes
            : lines.slice(0, Math.min(lines.length, excerptRadiusLines * 2 + 4)).map((_, index) => index);
        const ranges = mergeRanges(
            fallbackIndexes.slice(0, maxExcerptMatchesPerFile).map((index) => ({
                start: Math.max(0, index - excerptRadiusLines),
                end: Math.min(lines.length - 1, index + excerptRadiusLines)
            }))
        );

        const rendered = [];
        ranges.forEach((range, rangeIndex) => {
            if (rangeIndex > 0) {
                rendered.push('... [excerpt gap] ...');
            }
            rendered.push(formatFileLines(lines.slice(range.start, range.end + 1), range.start + 1));
        });
        sectionBody = rendered.join('\n');
    }

    return {
        compacted,
        text: `\n--- FILE: ${resolvedPath} ---\n${sectionBody}\n`
    };
}

function resolveContextFiles(options) {
    const {
        userMessage,
        contextFiles = [],
        cwd = process.cwd(),
        existsSync = fs.existsSync,
        readFileSync = fs.readFileSync,
        statSync = fs.statSync,
        maxFileLinesForFullContext = DEFAULT_MAX_FULL_CONTEXT_LINES,
        excerptRadiusLines = DEFAULT_EXCERPT_RADIUS_LINES,
        maxExcerptMatchesPerFile = DEFAULT_MAX_EXCERPT_MATCHES_PER_FILE,
        maxContextChars = DEFAULT_MAX_CONTEXT_CHARS
    } = options || {};

    const promptReferences = extractReferencedFiles(userMessage);
    const orderedCandidates = Array.from(new Set([
        ...contextFiles.map(normalizePathCandidate),
        ...promptReferences
    ].filter(Boolean)));

    const resolvedFiles = [];
    const missingFiles = [];
    const fileLineCounts = {};
    const seenResolvedPaths = new Set();
    const seenMissingPaths = new Set();
    const truncatedFiles = [];
    let contextData = '';

    for (const candidate of orderedCandidates) {
        const resolvedPath = resolvePathCandidate(candidate, cwd);
        const pathKey = toPathKey(resolvedPath);

        if (seenResolvedPaths.has(pathKey) || seenMissingPaths.has(pathKey)) {
            continue;
        }

        if (!existsSync(resolvedPath)) {
            missingFiles.push(resolvedPath);
            seenMissingPaths.add(pathKey);
            continue;
        }

        let stats;
        try {
            stats = statSync(resolvedPath);
        } catch (_) {
            missingFiles.push(resolvedPath);
            seenMissingPaths.add(pathKey);
            continue;
        }

        if (!stats.isFile()) {
            missingFiles.push(resolvedPath);
            seenMissingPaths.add(pathKey);
            continue;
        }

        try {
            const content = readFileSync(resolvedPath, 'utf8');
            resolvedFiles.push(resolvedPath);
            seenResolvedPaths.add(pathKey);
            fileLineCounts[resolvedPath] = content.split(/\r?\n/).length;
            const contextSection = buildContextSection({
                resolvedPath,
                content,
                userMessage,
                maxFileLinesForFullContext,
                excerptRadiusLines,
                maxExcerptMatchesPerFile
            });
            let nextSection = contextSection.text;
            if ((contextData.length + nextSection.length) > maxContextChars) {
                const remainingChars = Math.max(0, maxContextChars - contextData.length);
                nextSection = remainingChars > 0
                    ? `${nextSection.slice(0, remainingChars).trimEnd()}\n... [context truncated]\n`
                    : '';
                truncatedFiles.push(resolvedPath);
            } else if (contextSection.compacted) {
                truncatedFiles.push(resolvedPath);
            }
            contextData += nextSection;
        } catch (_) {
            missingFiles.push(resolvedPath);
            seenMissingPaths.add(pathKey);
        }
    }

    if (missingFiles.length > 0) {
        throw buildMissingContextError(missingFiles);
    }

    return {
        resolvedFiles,
        missingFiles,
        contextData,
        fileLineCounts,
        truncatedFiles
    };
}

function buildEvidenceBlock(contextData) {
    const trimmedContext = (contextData || '').trim();
    if (!trimmedContext) {
        return 'Context Evidence:\n- No external context was loaded. Do not invent file contents. If the request depends on missing files, answer with INSUFFICIENT_CONTEXT.';
    }

    return [
        'Context Evidence:',
        trimmedContext,
        '',
        'Reasoning rules:',
        '- Separate observed facts from inferences.',
        '- If evidence is missing, say INSUFFICIENT_CONTEXT instead of guessing.',
        '- Keep recommendations grounded in the observed facts.',
        '- Use evidence tags in the form [FILE: /path/to/file.js:L10-L15] for grounded claims.',
        `- Keep evidence spans precise. Avoid citing more than ${MAX_EVIDENCE_SPAN_LINES} lines in one tag unless absolutely necessary.`,
        '- If no direct evidence exists, write No direct evidence.'
    ].join('\n');
}

function extractClaimBullets(text, maxBullets = 6) {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s+/.test(line))
        .slice(0, maxBullets);
}

function buildReviewerDebateSummary(priorOutputs, priorEvaluations = {}) {
    const summarySections = [];

    for (const priorRoleKey of ['architect', 'challenger']) {
        const output = priorOutputs[priorRoleKey];
        if (!output) {
            continue;
        }

        const persona = PERSONAS[priorRoleKey];
        const evaluation = priorEvaluations[priorRoleKey] || {};
        const bullets = extractClaimBullets(output);
        const summaryLines = [
            `${persona.displayName} Summary:`,
            `- Validation: ${evaluation.hasRequiredSections && (evaluation.mentionsInsufficientContext || evaluation.hasEvidenceTags) && evaluation.invalidEvidenceTagCount === 0 && evaluation.broadEvidenceTagCount === 0 ? 'grounded' : 'needs review'}`,
            `- Evidence tags: ${evaluation.evidenceTagCount || 0}`,
            `- Invalid evidence tags: ${evaluation.invalidEvidenceTagCount || 0}`,
            `- Broad evidence tags: ${evaluation.broadEvidenceTagCount || 0}`
        ];

        if (bullets.length > 0) {
            summaryLines.push(...bullets);
        } else {
            summaryLines.push('- No summarized claims available.');
        }

        summarySections.push(summaryLines.join('\n'));
    }

    if (summarySections.length === 0) {
        return 'Debate History:\n- No prior role output yet.';
    }

    return `Debate History:\n${summarySections.join('\n\n')}`;
}

function buildRolePrompt({ roleKey, userMessage, contextData, priorOutputs, priorEvaluations = {} }) {
    const persona = PERSONAS[roleKey];
    const evidenceBlock = buildEvidenceBlock(contextData);
    const debateHistory = [];

    if (priorOutputs.architect) {
        debateHistory.push(`Architect Output:\n${priorOutputs.architect}`);
    }
    if (priorOutputs.challenger) {
        debateHistory.push(`Challenger Output:\n${priorOutputs.challenger}`);
    }

    const roleSpecificInstructions = {
        architect: [
            'Output sections exactly as:',
            '1. Observed Facts',
            '2. Inferences',
            '3. Recommendations',
            '4. Unknowns'
        ].join('\n'),
        challenger: [
            'Challenge the architect output.',
            'Do not introduce new facts unless they already appear in Context Evidence.',
            'Output sections exactly as:',
            '1. Supported Concerns',
            '2. Weak Claims',
            '3. Corrections',
            '4. Remaining Unknowns'
        ].join('\n'),
        reviewer: [
            'Synthesize the architect and challenger outputs into one grounded verdict.',
            'Remove duplicate recommendations.',
            'Only keep claims that are supported by Context Evidence or prior outputs.',
            'Output sections exactly as:',
            '1. Final Findings',
            '2. Recommended Actions',
            '3. Open Unknowns'
        ].join('\n')
    };

    return [
        `Role: ${persona.displayName}`,
        persona.brief,
        '',
        evidenceBlock,
        roleKey === 'reviewer'
            ? buildReviewerDebateSummary(priorOutputs, priorEvaluations)
            : (debateHistory.length > 0 ? `Debate History:\n${debateHistory.join('\n\n')}` : 'Debate History:\n- No prior role output yet.'),
        '',
        roleSpecificInstructions[roleKey],
        '',
        `User Request:\n${userMessage}`
    ].join('\n');
}

function buildRoleRepairPrompt({ roleKey, userMessage, contextData, priorOutputs, priorEvaluations, evaluation, issues, contextUpdated = false }) {
    const basePrompt = buildRolePrompt({
        roleKey,
        userMessage,
        contextData,
        priorOutputs,
        priorEvaluations
    });

    return [
        basePrompt,
        '',
        roleKey === 'reviewer'
            ? 'Your previous reviewer output failed evidence precision checks.'
            : `Your previous ${roleKey} output failed validation.`,
        `Issues to fix: ${issues.join('; ')}.`,
        `Invalid evidence tags: ${evaluation.invalidEvidenceTagCount}.`,
        `Broad evidence tags: ${evaluation.broadEvidenceTagCount}.`,
        contextUpdated ? 'Additional context has been provided for this retry. Re-evaluate your claims using the updated evidence.' : 'Use the same loaded context and tighten the claims.',
        'If evidence exists, cite it precisely. If evidence does not exist, say INSUFFICIENT_CONTEXT and keep the required sections.',
        `Keep each evidence span at or under ${MAX_EVIDENCE_SPAN_LINES} lines and only cite loaded files with valid ranges.`,
        `Rewrite the full ${roleKey} output now.`
    ].join('\n');
}

function getRoleValidationIssues(roleKey, output, evaluation) {
    const issues = [];
    const trimmedOutput = String(output || '').trim();
    if (ROLE_ERROR_PATTERN.test(trimmedOutput)) {
        issues.push('role error output');
    }
    if (!evaluation.hasRequiredSections) {
        issues.push(`missing sections: ${evaluation.missingSections.join(', ')}`);
    }
    if (evaluation.duplicateBulletCount > 0) {
        issues.push(`duplicate bullets: ${evaluation.duplicateBulletCount}`);
    }
    if (!evaluation.mentionsInsufficientContext) {
        if (!evaluation.hasEvidenceTags) {
            issues.push('missing evidence');
        }
        if (evaluation.invalidEvidenceTagCount > 0) {
            issues.push(`invalid evidence tags: ${evaluation.invalidEvidenceTagCount}`);
        }
        if (evaluation.broadEvidenceTagCount > 0) {
            issues.push(`broad evidence tags: ${evaluation.broadEvidenceTagCount}`);
        }
    }
    return issues;
}

async function runCouncilAnalysis(options) {
    const {
        userMessage,
        contextData = '',
        personaOrder = DEFAULT_PERSONA_ORDER,
        resolvedFiles = [],
        fileLineCounts = {},
        getContextDataForAttempt,
        validateRoles = false,
        enforceReviewerEvidence = false,
        maxReviewerAttempts = 2,
        maxRoleAttempts = DEFAULT_MAX_ROLE_ATTEMPTS,
        runRole
    } = options || {};

    if (typeof runRole !== 'function') {
        throw new Error('runRole is required.');
    }

    const outputs = {};
    const attemptsByRole = {};
    const validationFailures = {};
    const roleErrors = {};
    const evaluationsByRole = {};
    const repairedRoles = [];

    for (const roleKey of personaOrder) {
        const shouldValidateRole = validateRoles || (enforceReviewerEvidence && roleKey === 'reviewer');
        const allowedAttempts = shouldValidateRole
            ? (validateRoles ? maxRoleAttempts : maxReviewerAttempts)
            : 1;
        let attempts = 0;
        let output = '';
        let evaluation = null;
        let issues = [];
        let attemptContextData = contextData;
        let contextUpdated = false;

        do {
            attempts += 1;
            if (typeof getContextDataForAttempt === 'function') {
                const nextContextData = getContextDataForAttempt({
                    roleKey,
                    attempt: attempts,
                    previousIssues: issues,
                    previousEvaluation: evaluation,
                    defaultContextData: contextData
                });
                if (typeof nextContextData === 'string' && nextContextData.length > 0) {
                    contextUpdated = nextContextData !== attemptContextData;
                    attemptContextData = nextContextData;
                } else {
                    contextUpdated = false;
                    attemptContextData = contextData;
                }
            } else {
                contextUpdated = false;
                attemptContextData = contextData;
            }
            const prompt = attempts === 1
                ? buildRolePrompt({
                    roleKey,
                    userMessage,
                    contextData: attemptContextData,
                    priorOutputs: outputs,
                    priorEvaluations: evaluationsByRole
                })
                : buildRoleRepairPrompt({
                    roleKey,
                    userMessage,
                    contextData: attemptContextData,
                    priorOutputs: outputs,
                    priorEvaluations: evaluationsByRole,
                    evaluation,
                    issues,
                    contextUpdated
                });

            try {
                output = await runRole({
                    roleKey,
                    prompt,
                    priorOutputs: { ...outputs },
                    attempt: attempts,
                    phase: attempts === 1 ? 'initial' : 'repair'
                });
            } catch (error) {
                output = `[Error querying ${PERSONAS[roleKey].displayName}: ${error.message}]`;
            }

            evaluation = evaluateRoleOutput(roleKey, output, {
                resolvedFiles,
                fileLineCounts
            });
            issues = shouldValidateRole ? getRoleValidationIssues(roleKey, output, evaluation) : [];
        } while (issues.length > 0 && attempts < allowedAttempts);

        outputs[roleKey] = output;
        attemptsByRole[roleKey] = attempts;
        evaluationsByRole[roleKey] = evaluation;
        validationFailures[roleKey] = issues;
        if (attempts > 1 && issues.length === 0) {
            repairedRoles.push(roleKey);
        }
        if (ROLE_ERROR_PATTERN.test(String(output || '').trim())) {
            roleErrors[roleKey] = String(output || '').trim();
        }
    }

    const allRolesAbstained = personaOrder.length > 0 && personaOrder.every(
        (roleKey) => evaluationsByRole[roleKey]?.mentionsInsufficientContext
    );
    const hasValidationFailures = personaOrder.some((roleKey) => (validationFailures[roleKey] || []).length > 0);
    const hasRoleErrors = Object.keys(roleErrors).length > 0;
    const status = hasRoleErrors
        ? 'role_error'
        : hasValidationFailures
            ? 'failed_validation'
            : allRolesAbstained
                ? 'insufficient_context'
                : repairedRoles.length > 0
                    ? 'repaired_success'
                    : 'success';

    return {
        ...outputs,
        outputs,
        attemptsByRole,
        evaluationsByRole,
        validationFailures,
        roleErrors,
        repairedRoles,
        status
    };
}

function countDuplicateBullets(text) {
    const bulletLines = (text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s+/.test(line))
        .map((line) => line.replace(/^[-*]\s+/, '').trim().toLowerCase())
        .filter(Boolean);

    const counts = new Map();
    let duplicateCount = 0;
    for (const bullet of bulletLines) {
        const nextCount = (counts.get(bullet) || 0) + 1;
        counts.set(bullet, nextCount);
        if (nextCount === 2) {
            duplicateCount += 1;
        }
    }

    return duplicateCount;
}

function countEvidenceTags(text) {
    const matches = normalizeEvidenceMarkup(text).match(/\[FILE:\s*[^\]]+:L\d+(?:-L?\d+)?\]/g);
    return matches ? matches.length : 0;
}

function parseEvidenceTags(text) {
    const tags = [];
    const pattern = /\[FILE:\s*(.+?):L(\d+)(?:-L?(\d+))?\]/g;
    const normalizedText = normalizeEvidenceMarkup(text);
    let match;

    while ((match = pattern.exec(normalizedText)) !== null) {
        tags.push({
            raw: match[0],
            filePath: normalizeEvidenceFilePath(match[1].trim()),
            startLine: Number.parseInt(match[2], 10),
            endLine: Number.parseInt(match[3] || match[2], 10)
        });
    }

    return tags;
}

function normalizeResolvedFileMap(resolvedFiles, fileLineCounts) {
    const normalized = new Map();

    for (const filePath of resolvedFiles || []) {
        const normalizedPath = toPathKey(filePath);
        normalized.set(normalizedPath, fileLineCounts?.[filePath] || 0);
    }

    return normalized;
}

function countInvalidEvidenceTags(text, resolvedFiles, fileLineCounts) {
    const normalizedFiles = normalizeResolvedFileMap(resolvedFiles, fileLineCounts);
    let invalidCount = 0;

    for (const tag of parseEvidenceTags(text)) {
        const normalizedTagPath = toPathKey(tag.filePath);
        const lineCount = normalizedFiles.get(normalizedTagPath);
        const hasKnownFile = typeof lineCount === 'number' && lineCount > 0;
        const hasValidRange = tag.startLine >= 1 && tag.endLine >= tag.startLine && tag.endLine <= lineCount;

        if (!hasKnownFile || !hasValidRange) {
            invalidCount += 1;
        }
    }

    return invalidCount;
}

function countBroadEvidenceTags(text) {
    let broadCount = 0;

    for (const tag of parseEvidenceTags(text)) {
        if ((tag.endLine - tag.startLine + 1) > MAX_EVIDENCE_SPAN_LINES) {
            broadCount += 1;
        }
    }

    return broadCount;
}

function evaluateRoleOutput(roleKey, text, options = {}) {
    const requiredSections = REQUIRED_SECTIONS[roleKey] || [];
    const normalized = normalizeEvidenceMarkup(text || '');
    const missingSections = requiredSections.filter((section) => !normalized.includes(section));
    const evidenceTagCount = countEvidenceTags(normalized);
    const invalidEvidenceTagCount = countInvalidEvidenceTags(
        normalized,
        options.resolvedFiles,
        options.fileLineCounts
    );
    const broadEvidenceTagCount = countBroadEvidenceTags(normalized);

    return {
        roleKey,
        outputLength: normalized.length,
        hasRequiredSections: missingSections.length === 0,
        missingSections,
        hasEvidenceTags: evidenceTagCount > 0,
        evidenceTagCount,
        invalidEvidenceTagCount,
        broadEvidenceTagCount,
        mentionsInsufficientContext: normalized.includes('INSUFFICIENT_CONTEXT'),
        duplicateBulletCount: countDuplicateBullets(normalized)
    };
}

function evaluateCouncilOutputs({
    outputs,
    personaOrder = DEFAULT_PERSONA_ORDER,
    resolvedFiles = [],
    fileLineCounts = {}
}) {
    const roles = {};
    let rolesWithMissingSections = 0;
    let rolesWithDuplicateBullets = 0;
    let rolesMissingEvidenceTags = 0;
    let rolesWithInvalidEvidenceTags = 0;
    let rolesWithBroadEvidenceTags = 0;

    for (const roleKey of personaOrder) {
        const evaluation = evaluateRoleOutput(roleKey, outputs[roleKey] || '', {
            resolvedFiles,
            fileLineCounts
        });
        roles[roleKey] = evaluation;
        if (!evaluation.hasRequiredSections) {
            rolesWithMissingSections += 1;
        }
        if (evaluation.duplicateBulletCount > 0) {
            rolesWithDuplicateBullets += 1;
        }
        if (!evaluation.hasEvidenceTags) {
            rolesMissingEvidenceTags += 1;
        }
        if (evaluation.invalidEvidenceTagCount > 0) {
            rolesWithInvalidEvidenceTags += 1;
        }
        if (evaluation.broadEvidenceTagCount > 0) {
            rolesWithBroadEvidenceTags += 1;
        }
    }

    return {
        roles,
        summary: {
            totalRoles: personaOrder.length,
            rolesWithMissingSections,
            rolesWithDuplicateBullets,
            rolesMissingEvidenceTags,
            rolesWithInvalidEvidenceTags,
            rolesWithBroadEvidenceTags
        }
    };
}

function renderCouncilOutput({ userMessage, outputs, personaOrder = DEFAULT_PERSONA_ORDER, status = 'success' }) {
    let fileOutput = `Council Query: "${userMessage}"\n`;
    fileOutput += `${'='.repeat(50)}\n\n`;

    for (const roleKey of personaOrder) {
        const persona = PERSONAS[roleKey];
        const text = (outputs[roleKey] || '').trim();
        fileOutput += `[ ${persona.displayName} ]\n`;
        fileOutput += `${text}\n`;
        fileOutput += `${'-'.repeat(50)}\n\n`;
    }

    fileOutput += status === 'success' || status === 'repaired_success'
        ? 'Council Adjourned.\n'
        : `Council Ended With Status: ${status}\n`;
    return fileOutput;
}

function renderCouncilTelemetry({
    userMessage,
    resolvedFiles = [],
    fileLineCounts = {},
    outputs,
    personaOrder = DEFAULT_PERSONA_ORDER,
    status = 'success',
    attemptsByRole = {},
    validationFailures = {},
    roleErrors = {},
    repairedRoles = [],
    truncatedFiles = []
}) {
    const evaluation = evaluateCouncilOutputs({
        outputs,
        personaOrder,
        resolvedFiles,
        fileLineCounts
    });
    return JSON.stringify({
        generatedAt: new Date().toISOString(),
        userMessage,
        resolvedFiles,
        fileLineCounts,
        status,
        attemptsByRole,
        validationFailures,
        roleErrors,
        repairedRoles,
        truncatedFiles,
        evaluation
    }, null, 2);
}

function isPathInsideRoot(candidatePath, rootPath) {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveOutputPath({
    requestedOutFile,
    cwd = process.cwd(),
    repoRoot = path.resolve(cwd),
    allowExternalOut = false,
    now = new Date()
} = {}) {
    if (!requestedOutFile) {
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return path.join(repoRoot, `council_output_${timestamp}.txt`);
    }

    const resolvedPath = path.isAbsolute(requestedOutFile)
        ? path.normalize(requestedOutFile)
        : path.resolve(cwd, requestedOutFile);
    if (!allowExternalOut && !isPathInsideRoot(resolvedPath, path.resolve(repoRoot))) {
        throw new Error('Requested output path is outside the repository.');
    }

    return resolvedPath;
}

module.exports = {
    PERSONAS,
    DEFAULT_PERSONA_ORDER,
    MAX_EVIDENCE_SPAN_LINES,
    buildRolePrompt,
    buildRoleRepairPrompt,
    evaluateRoleOutput,
    evaluateCouncilOutputs,
    extractReferencedFiles,
    renderCouncilOutput,
    renderCouncilTelemetry,
    resolveContextFiles,
    resolveOutputPath,
    runCouncilAnalysis
};
