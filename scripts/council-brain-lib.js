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
const REQUIRED_SECTIONS = {
    architect: ['Observed Facts', 'Inferences', 'Recommendations', 'Unknowns'],
    challenger: ['Supported Concerns', 'Weak Claims', 'Corrections', 'Remaining Unknowns'],
    reviewer: ['Final Findings', 'Recommended Actions', 'Open Unknowns']
};
const ABSOLUTE_PATH_START_PATTERN = /[A-Za-z]:[\\/]/g;
const RELATIVE_PATH_START_PATTERN = /(?:\.{1,2}[\\/]|[A-Za-z0-9_-]+[\\/])/g;

function normalizePathCandidate(candidate) {
    return candidate.replace(/^["'`]+|["'`.,;:!?]+$/g, '');
}

function extractPathFrom(message, startIndex) {
    const remainder = message.slice(startIndex);
    const match = remainder.match(/^[^"'`\n]+?\.[A-Za-z0-9]+/);
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

function resolveContextFiles(options) {
    const {
        userMessage,
        contextFiles = [],
        cwd = process.cwd(),
        existsSync = fs.existsSync,
        readFileSync = fs.readFileSync,
        statSync = fs.statSync
    } = options || {};

    const promptReferences = extractReferencedFiles(userMessage);
    const orderedCandidates = Array.from(new Set([
        ...contextFiles.map(normalizePathCandidate),
        ...promptReferences
    ].filter(Boolean)));

    const resolvedFiles = [];
    const missingFiles = [];
    const fileLineCounts = {};
    let contextData = '';

    for (const candidate of orderedCandidates) {
        const resolvedPath = resolvePathCandidate(candidate, cwd);
        if (!existsSync(resolvedPath)) {
            missingFiles.push(resolvedPath);
            continue;
        }

        let stats;
        try {
            stats = statSync(resolvedPath);
        } catch (_) {
            missingFiles.push(resolvedPath);
            continue;
        }

        if (!stats.isFile()) {
            missingFiles.push(resolvedPath);
            continue;
        }

        try {
            const content = readFileSync(resolvedPath, 'utf8');
            resolvedFiles.push(resolvedPath);
            fileLineCounts[resolvedPath] = content.split(/\r?\n/).length;
            contextData += `\n--- FILE: ${resolvedPath} ---\n${content}\n`;
        } catch (_) {
            missingFiles.push(resolvedPath);
        }
    }

    if (missingFiles.length > 0) {
        throw buildMissingContextError(missingFiles);
    }

    return {
        resolvedFiles,
        missingFiles,
        contextData,
        fileLineCounts
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

function buildRolePrompt({ roleKey, userMessage, contextData, priorOutputs }) {
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
        debateHistory.length > 0 ? `Debate History:\n${debateHistory.join('\n\n')}` : 'Debate History:\n- No prior role output yet.',
        '',
        roleSpecificInstructions[roleKey],
        '',
        `User Request:\n${userMessage}`
    ].join('\n');
}

function buildReviewerRetryPrompt({ userMessage, contextData, priorOutputs, evaluation }) {
    const basePrompt = buildRolePrompt({
        roleKey: 'reviewer',
        userMessage,
        contextData,
        priorOutputs
    });

    return [
        basePrompt,
        '',
        'Your previous reviewer output failed evidence precision checks.',
        `Invalid evidence tags: ${evaluation.invalidEvidenceTagCount}.`,
        `Broad evidence tags: ${evaluation.broadEvidenceTagCount}.`,
        `Keep each evidence span at or under ${MAX_EVIDENCE_SPAN_LINES} lines and only cite loaded files with valid ranges.`,
        'Rewrite the full reviewer output now.'
    ].join('\n');
}

async function runCouncilAnalysis(options) {
    const {
        userMessage,
        contextData = '',
        personaOrder = DEFAULT_PERSONA_ORDER,
        resolvedFiles = [],
        fileLineCounts = {},
        enforceReviewerEvidence = false,
        maxReviewerAttempts = 2,
        runRole
    } = options || {};

    if (typeof runRole !== 'function') {
        throw new Error('runRole is required.');
    }

    const outputs = {};

    for (const roleKey of personaOrder) {
        const prompt = buildRolePrompt({
            roleKey,
            userMessage,
            contextData,
            priorOutputs: outputs
        });
        let output = await runRole({ roleKey, prompt, priorOutputs: { ...outputs } });

        if (roleKey === 'reviewer' && enforceReviewerEvidence) {
            let attempts = 1;
            let evaluation = evaluateRoleOutput(roleKey, output, {
                resolvedFiles,
                fileLineCounts
            });

            while (attempts < maxReviewerAttempts && (
                evaluation.invalidEvidenceTagCount > 0 || evaluation.broadEvidenceTagCount > 0
            )) {
                attempts += 1;
                const retryPrompt = buildReviewerRetryPrompt({
                    userMessage,
                    contextData,
                    priorOutputs: outputs,
                    evaluation
                });
                output = await runRole({ roleKey, prompt: retryPrompt, priorOutputs: { ...outputs } });
                evaluation = evaluateRoleOutput(roleKey, output, {
                    resolvedFiles,
                    fileLineCounts
                });
            }
        }

        outputs[roleKey] = output;
    }

    return outputs;
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
    const matches = (text || '').match(/\[FILE:\s*[^\]]+:L\d+(?:-L?\d+)?\]/g);
    return matches ? matches.length : 0;
}

function parseEvidenceTags(text) {
    const tags = [];
    const pattern = /\[FILE:\s*(.+?):L(\d+)(?:-L?(\d+))?\]/g;
    let match;

    while ((match = pattern.exec(text || '')) !== null) {
        tags.push({
            raw: match[0],
            filePath: match[1].trim(),
            startLine: Number.parseInt(match[2], 10),
            endLine: Number.parseInt(match[3] || match[2], 10)
        });
    }

    return tags;
}

function normalizeResolvedFileMap(resolvedFiles, fileLineCounts) {
    const normalized = new Map();

    for (const filePath of resolvedFiles || []) {
        const normalizedPath = path.normalize(filePath).toLowerCase();
        normalized.set(normalizedPath, fileLineCounts?.[filePath] || 0);
    }

    return normalized;
}

function countInvalidEvidenceTags(text, resolvedFiles, fileLineCounts) {
    const normalizedFiles = normalizeResolvedFileMap(resolvedFiles, fileLineCounts);
    let invalidCount = 0;

    for (const tag of parseEvidenceTags(text)) {
        const normalizedTagPath = path.normalize(tag.filePath).toLowerCase();
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
    const normalized = text || '';
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

function renderCouncilOutput({ userMessage, outputs, personaOrder = DEFAULT_PERSONA_ORDER }) {
    let fileOutput = `Council Query: "${userMessage}"\n`;
    fileOutput += `${'='.repeat(50)}\n\n`;

    for (const roleKey of personaOrder) {
        const persona = PERSONAS[roleKey];
        const text = (outputs[roleKey] || '').trim();
        fileOutput += `[ ${persona.displayName} ]\n`;
        fileOutput += `${text}\n`;
        fileOutput += `${'-'.repeat(50)}\n\n`;
    }

    fileOutput += 'Council Adjourned.\n';
    return fileOutput;
}

function renderCouncilTelemetry({
    userMessage,
    resolvedFiles = [],
    fileLineCounts = {},
    outputs,
    personaOrder = DEFAULT_PERSONA_ORDER
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
        evaluation
    }, null, 2);
}

module.exports = {
    PERSONAS,
    DEFAULT_PERSONA_ORDER,
    MAX_EVIDENCE_SPAN_LINES,
    buildRolePrompt,
    buildReviewerRetryPrompt,
    evaluateCouncilOutputs,
    extractReferencedFiles,
    renderCouncilOutput,
    renderCouncilTelemetry,
    resolveContextFiles,
    runCouncilAnalysis
};
