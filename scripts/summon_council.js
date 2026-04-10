/* eslint-disable no-console */

const { VertexAI } = require('@google-cloud/vertexai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const {
    DEFAULT_PERSONA_ORDER,
    PERSONAS,
    renderCouncilOutput,
    renderCouncilTelemetry,
    resolveContextFiles,
    resolveOutputPath,
    runCouncilAnalysis
} = require('./council-brain-lib');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
const PRIMARY_MODEL_NAME = process.env.COUNCIL_PRIMARY_MODEL || 'gemini-2.5-flash';
const REPAIR_MODEL_NAME = process.env.COUNCIL_REPAIR_MODEL || PRIMARY_MODEL_NAME;
const MAX_ROLE_ATTEMPTS = Number.parseInt(process.env.COUNCIL_MAX_ROLE_ATTEMPTS || '3', 10) || 3;
const ALLOW_EXTERNAL_OUT = process.env.COUNCIL_ALLOW_EXTERNAL_OUT === '1';
const REPO_ROOT = path.join(__dirname, '..');

const ROLE_COLORS = {
    architect: '\x1b[34m',
    challenger: '\x1b[31m',
    reviewer: '\x1b[32m'
};
const PREVIEW_LENGTH = 200;

function shouldWidenContext(previousIssues) {
    return (previousIssues || []).some((issue) => /evidence|context/i.test(issue));
}

function getVertexAIClient() {
    if (!PROJECT_ID) {
        throw new Error('FIREBASE_PROJECT_ID is missing in .env. Required for Vertex AI.');
    }

    return new VertexAI({ project: PROJECT_ID, location: LOCATION });
}

function extractResponseText(response) {
    if (response?.candidates?.[0]?.content?.parts) {
        const textPart = response.candidates[0].content.parts.find((part) => typeof part.text === 'string');
        if (textPart?.text) {
            return textPart.text;
        }
    }

    return typeof response?.text === 'function' ? response.text() : JSON.stringify(response);
}

async function summonCouncil() {
    const args = process.argv.slice(2);
    const outIndex = args.indexOf('--out');
    let requestedOutFile = null;

    if (outIndex !== -1 && outIndex < args.length - 1) {
        requestedOutFile = args[outIndex + 1];
        args.splice(outIndex, 2);
    }

    const contextIndex = args.indexOf('--context');
    let inlineContextFile = null;

    if (contextIndex !== -1 && contextIndex < args.length - 1) {
        inlineContextFile = args[contextIndex + 1];
        args.splice(contextIndex, 2);
    }

    const userMessage = args[0];
    const contextFiles = args.slice(1);

    if (!userMessage) {
        console.log("Usage: node summon_council.js 'Your Question' [file_paths...] [--context filepath] [--out filename]");
        return;
    }

    const outFile = resolveOutputPath({
        requestedOutFile,
        cwd: process.cwd(),
        repoRoot: REPO_ROOT,
        allowExternalOut: ALLOW_EXTERNAL_OUT
    });
    const telemetryPath = `${outFile}.telemetry.json`;

    let contextData = '';
    let resolvedFiles = [];
    let fileLineCounts = {};
    let truncatedFiles = [];
    const widenedContextCache = new Map();

    try {
        const resolution = resolveContextFiles({
            userMessage,
            contextFiles,
            cwd: process.cwd()
        });
        contextData = resolution.contextData;
        resolvedFiles = resolution.resolvedFiles;
        fileLineCounts = resolution.fileLineCounts;
        truncatedFiles = resolution.truncatedFiles || [];
    } catch (error) {
        if (error.code === 'MISSING_CONTEXT') {
            console.error(`\nMISSING_CONTEXT: ${error.missingFiles.join(', ')}`);
            process.exitCode = 1;
            return;
        }
        throw error;
    }

    // Prepend inline context if --context flag was provided
    if (inlineContextFile) {
        const resolvedContextPath = path.resolve(process.cwd(), inlineContextFile);
        try {
            const inlineContent = fs.readFileSync(resolvedContextPath, 'utf8');
            contextData = `--- INLINE CONTEXT (from conversation) ---\n${inlineContent}\n--- END INLINE CONTEXT ---\n\n${contextData}`;
        } catch (error) {
            console.error(`\n[COUNCIL] Failed to read inline context file: ${resolvedContextPath}`);
            console.error(`Error: ${error.message}`);
            process.exitCode = 1;
            return;
        }
    }

    console.log('\n[COUNCIL] Summoning the war room council...');
    console.log(`Sovereign's Command: "${userMessage}"`);
    if (inlineContextFile) {
        console.log(`Inline context: loaded from ${inlineContextFile}`);
    }
    if (resolvedFiles.length > 0) {
        console.log(`Intelligence: ${resolvedFiles.length} files analyzed.`);
    }
    if (truncatedFiles.length > 0) {
        console.log(`Context compaction: ${truncatedFiles.length} file(s) compacted or truncated.`);
    }

    const vertexAI = getVertexAIClient();
    const primaryModel = vertexAI.getGenerativeModel({ model: PRIMARY_MODEL_NAME });
    const repairModel = vertexAI.getGenerativeModel({ model: REPAIR_MODEL_NAME });
    const analysis = await runCouncilAnalysis({
        userMessage,
        contextData,
        resolvedFiles,
        fileLineCounts,
        validateRoles: true,
        maxRoleAttempts: MAX_ROLE_ATTEMPTS,
        getContextDataForAttempt: ({ attempt, previousIssues, defaultContextData }) => {
            if (attempt === 1 || truncatedFiles.length === 0 || !shouldWidenContext(previousIssues)) {
                return defaultContextData;
            }

            if (widenedContextCache.has(attempt)) {
                return widenedContextCache.get(attempt);
            }

            const widenedResolution = resolveContextFiles({
                userMessage,
                contextFiles,
                cwd: process.cwd(),
                maxFileLinesForFullContext: 160,
                excerptRadiusLines: 8,
                maxExcerptMatchesPerFile: 8,
                maxContextChars: 200000
            });
            truncatedFiles = Array.from(new Set([
                ...truncatedFiles,
                ...(widenedResolution.truncatedFiles || [])
            ]));
            widenedContextCache.set(attempt, widenedResolution.contextData);
            return widenedResolution.contextData;
        },
        runRole: async ({ roleKey, prompt, phase }) => {
            const model = phase === 'repair' ? repairModel : primaryModel;
            try {
                const result = await model.generateContent(prompt);
                const response = await result.response;
                return extractResponseText(response);
            } catch (error) {
                return `[Error querying ${PERSONAS[roleKey].displayName}: ${error.message}]`;
            }
        }
    });

    console.log(`\n${'='.repeat(50)}`);

    for (const roleKey of DEFAULT_PERSONA_ORDER) {
        const persona = PERSONAS[roleKey];
        const fullText = (analysis.outputs[roleKey] || '').trim();
        const preview = fullText.length > PREVIEW_LENGTH
            ? `${fullText.substring(0, PREVIEW_LENGTH)}... [truncated, see output file]`
            : fullText;

        console.log(`${ROLE_COLORS[roleKey]}[ ${persona.displayName} ]\x1b[0m`);
        console.log(preview);
        console.log('-'.repeat(50));
    }

    const fileOutput = renderCouncilOutput({
        userMessage,
        outputs: analysis.outputs,
        personaOrder: DEFAULT_PERSONA_ORDER,
        status: analysis.status
    });
    const telemetryOutput = renderCouncilTelemetry({
        userMessage,
        resolvedFiles,
        fileLineCounts,
        outputs: analysis.outputs,
        personaOrder: DEFAULT_PERSONA_ORDER,
        status: analysis.status,
        attemptsByRole: analysis.attemptsByRole,
        validationFailures: analysis.validationFailures,
        roleErrors: analysis.roleErrors,
        repairedRoles: analysis.repairedRoles,
        truncatedFiles
    });

    try {
        fs.writeFileSync(outFile, fileOutput, 'utf8');
        fs.writeFileSync(telemetryPath, telemetryOutput, 'utf8');
        if (analysis.status === 'success' || analysis.status === 'repaired_success') {
            console.log(`\n[COUNCIL] Council adjourned. Full output saved to: ${outFile}`);
        } else {
            console.error(`\n[COUNCIL] Council ended with status: ${analysis.status}`);
            process.exitCode = 1;
        }
        console.log(`Telemetry saved to: ${telemetryPath}`);
    } catch (error) {
        console.error(`\n[COUNCIL] Failed to save output to ${outFile}: ${error.message}`);
        console.log(fileOutput);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    summonCouncil().catch((error) => {
        console.error(`\n[COUNCIL] Council failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    summonCouncil
};
