
/* eslint-disable no-console */

const { VertexAI } = require("@google-cloud/vertexai");
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- CONFIGURATION ---
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

if (!PROJECT_ID) {
    console.error("❌ ERROR: FIREBASE_PROJECT_ID is missing in .env. Required for Vertex AI.");
    process.exit(1);
}

const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
const MODEL_NAME = "gemini-2.5-flash"; // Valid Vertex AI model

// --- PERSONAS ---
const PERSONAS = {
    architect: {
        color: "\x1b[34m", // Blue
        name: "🏛️ Architect",
        prompt: "You are the Architect in the War Room. Design a galactic-scale system for The Sovereign. Focus on scalability, file structure, and best practices. Be concise and authoritative."
    },
    challenger: {
        color: "\x1b[31m", // Red
        name: "🔥 Challenger",
        prompt: "You are the Challenger in the War Room. Scrutinize every detail and find flaws for The Sovereign like a demanding boss at 5 PM. Find potential bugs, security risks, and logic flaws. Ask 'Why?'. Be fiercely critical."
    },
    reviewer: {
        color: "\x1b[32m", // Green
        name: "✨ Reviewer",
        prompt: "You are the Reviewer in the War Room. Resolve issues for The Sovereign with elegance and precision. Synthesize the debate and propose a practical implementation plan. Focus on UX and simplicity."
    }
};

async function summonCouncil() {
    const args = process.argv.slice(2);

    // Check for --out flag
    let outIndex = args.indexOf('--out');
    let outFile = null;
    if (outIndex !== -1 && outIndex < args.length - 1) {
        outFile = args[outIndex + 1];
        args.splice(outIndex, 2);
    }

    const userMessage = args[0];
    const contextFiles = args.slice(1);

    if (!userMessage) {
        console.log("Usage: node summon_council.js 'Your Question' [file_paths...] [--out filename]");
        return;
    }

    // 1. Context Loading
    let contextData = "";
    for (const filePath of contextFiles) {
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                contextData += `\n--- FILE: ${filePath} ---\n${content}\n`;
            }
        } catch (e) {
            console.warn(`Could not read file: ${filePath}`);
        }
    }

    console.log(`\n🧠 SUMMONING THE WAR ROOM COUNCIL...`);
    console.log(`Sovereign's Command: "${userMessage}"`);
    if (contextData) console.log(`Intelligence: ${contextFiles.length} files analyzed.`);

    // 2. The Debate (Parallel Execution)
    const promises = Object.entries(PERSONAS).map(async ([key, persona]) => {
        try {
            const model = vertexAI.getGenerativeModel({ model: MODEL_NAME });
            const systemPrompt = `Role: ${persona.prompt}\n\nContext:\n${contextData}`;

            const result = await model.generateContent(`${systemPrompt}\n\nUser Question: ${userMessage}`);
            const response = await result.response;
            const text = response.candidates && response.candidates[0] && response.candidates[0].content.parts[0].text
                ? response.candidates[0].content.parts[0].text
                : (typeof response.text === 'function' ? response.text() : JSON.stringify(response));
            return { key, text };
        } catch (error) {
            return { key, text: `[Error querying ${persona.name}: ${error.message}]` };
        }
    });

    const results = await Promise.all(promises);

    // 3. Output
    console.log("\n" + "=".repeat(50));
    let fileOutput = "=".repeat(50) + "\n\n";

    // Order: Architect -> Challenger -> Reviewer
    const order = ['architect', 'challenger', 'reviewer'];

    for (const roleKey of order) {
        const result = results.find(r => r.key === roleKey);
        const persona = PERSONAS[roleKey];

        console.log(`${persona.color}[ ${persona.name} ]\x1b[0m`);
        console.log(result.text.trim());
        console.log("-".repeat(50));

        fileOutput += `[ ${persona.name} ]\n`;
        fileOutput += result.text.trim() + "\n";
        fileOutput += "-".repeat(50) + "\n\n";
    }

    console.log("\n✅ Council Adjourned. The Sovereign's vision is secured.");
    fileOutput += "✅ Council Adjourned. The Sovereign's vision is secured.\n";

    if (outFile) {
        try {
            fs.writeFileSync(outFile, fileOutput, 'utf-8');
            console.log(`\n📄 Council output saved to: ${outFile}`);
        } catch (err) {
            console.error(`\n❌ Failed to save output to ${outFile}:`, err.message);
        }
    }
}

summonCouncil();
