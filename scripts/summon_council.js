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
    runCouncilAnalysis
} = require('./council-brain-lib');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
const MODEL_NAME = 'gemini-2.5-flash';

const ROLE_COLORS = {
    architect: '\x1b[34m',
    challenger: '\x1b[31m',
    reviewer: '\x1b[32m'
};

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
    let outFile = null;

    if (outIndex !== -1 && outIndex < args.length - 1) {
        outFile = args[outIndex + 1];
        args.splice(outIndex, 2);
    }

    if (!outFile) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        outFile = path.join(__dirname, '..', `council_output_${timestamp}.txt`);
    }

    const userMessage = args[0];
    const contextFiles = args.slice(1);

    if (!userMessage) {
        console.log("Usage: node summon_council.js 'Your Question' [file_paths...] [--out filename]");
        return;
    }

    let contextData = '';
    let resolvedFiles = [];
    let fileLineCounts = {};

    try {
        const resolution = resolveContextFiles({
            userMessage,
            contextFiles,
            cwd: process.cwd()
        });
        contextData = resolution.contextData;
        resolvedFiles = resolution.resolvedFiles;
        fileLineCounts = resolution.fileLineCounts;
    } catch (error) {
        if (error.code === 'MISSING_CONTEXT') {
            console.error(`\nMISSING_CONTEXT: ${error.missingFiles.join(', ')}`);
            process.exitCode = 1;
            return;
        }
        throw error;
    }

    console.log('\n🧠 SUMMONING THE WAR ROOM COUNCIL...');
    console.log(`Sovereign's Command: "${userMessage}"`);
    if (resolvedFiles.length > 0) {
        console.log(`Intelligence: ${resolvedFiles.length} files analyzed.`);
    }

    const vertexAI = getVertexAIClient();
    const model = vertexAI.getGenerativeModel({ model: MODEL_NAME });
    const outputs = await runCouncilAnalysis({
        userMessage,
        contextData,
        resolvedFiles,
        fileLineCounts,
        enforceReviewerEvidence: true,
        runRole: async ({ roleKey, prompt }) => {
            try {
                const result = await model.generateContent(prompt);
                const response = await result.response;
                return extractResponseText(response);
            } catch (error) {
                return `[Error querying ${PERSONAS[roleKey].displayName}: ${error.message}]`;
            }
        }
    });

    const PREVIEW_LENGTH = 200;
    console.log(`\n${'='.repeat(50)}`);

    for (const roleKey of DEFAULT_PERSONA_ORDER) {
        const persona = PERSONAS[roleKey];
        const fullText = (outputs[roleKey] || '').trim();
        const preview = fullText.length > PREVIEW_LENGTH
            ? `${fullText.substring(0, PREVIEW_LENGTH)}... [truncated, see output file]`
            : fullText;

        console.log(`${ROLE_COLORS[roleKey]}[ ${persona.displayName} ]\x1b[0m`);
        console.log(preview);
        console.log('-'.repeat(50));
    }

    const fileOutput = renderCouncilOutput({
        userMessage,
        outputs,
        personaOrder: DEFAULT_PERSONA_ORDER
    });
    const telemetryOutput = renderCouncilTelemetry({
        userMessage,
        resolvedFiles,
        fileLineCounts,
        outputs,
        personaOrder: DEFAULT_PERSONA_ORDER
    });
    const telemetryPath = `${outFile}.telemetry.json`;

    try {
        fs.writeFileSync(outFile, fileOutput, 'utf8');
        fs.writeFileSync(telemetryPath, telemetryOutput, 'utf8');
        console.log(`\n✅ Council Adjourned. Full output saved to: ${outFile}`);
        console.log(`Telemetry saved to: ${telemetryPath}`);
    } catch (error) {
        console.error(`\n❌ Failed to save output to ${outFile}: ${error.message}`);
        console.log(fileOutput);
    }
}

if (require.main === module) {
    summonCouncil().catch((error) => {
        console.error(`\n❌ Council failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    summonCouncil
};
