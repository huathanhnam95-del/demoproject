
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- CONFIGURATION ---
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("❌ ERROR: GEMINI_API_KEY is missing in .env");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const MODEL_NAME = "gemini-2.0-flash"; // Or gemini-pro

// --- PERSONAS ---
const PERSONAS = {
    architect: {
        color: "\x1b[34m", // Blue
        name: "Architect",
        prompt: "You are the System Architect. Focus on scalability, file structure, and best practices. Be concise and authoritative."
    },
    challenger: {
        color: "\x1b[31m", // Red
        name: "Challenger",
        prompt: "You are the Challenger. Find potential bugs, security risks, and logic flaws. Ask 'Why?'. Be critical."
    },
    reviewer: {
        color: "\x1b[32m", // Green
        name: "Reviewer",
        prompt: "You are the Reviewer. Synthesize the debate and propose a practical implementation plan. Focus on UX and simplicity."
    }
};

async function summonCouncil() {
    const args = process.argv.slice(2);
    const userMessage = args[0];
    const contextFiles = args.slice(1);

    if (!userMessage) {
        console.log("Usage: node summon_council.js 'Your Question' [file_paths...]");
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

    console.log(`\n🔔 SUMMONING THE COUNCIL...`);
    console.log(`Topic: "${userMessage}"`);
    if (contextData) console.log(`Context: ${contextFiles.length} files loaded.`);

    // 2. The Debate (Parallel Execution)
    const promises = Object.entries(PERSONAS).map(async ([key, persona]) => {
        try {
            const model = genAI.getGenerativeModel({ model: MODEL_NAME });
            const systemPrompt = `Role: ${persona.prompt}\n\nContext:\n${contextData}`;

            const result = await model.generateContent(`${systemPrompt}\n\nUser Question: ${userMessage}`);
            const response = await result.response;
            return { key, text: response.text() };
        } catch (error) {
            return { key, text: `[Error querying ${persona.name}: ${error.message}]` };
        }
    });

    const results = await Promise.all(promises);

    // 3. Output
    console.log("\n" + "=".repeat(50));

    // Order: Architect -> Challenger -> Reviewer
    const order = ['architect', 'challenger', 'reviewer'];

    for (const roleKey of order) {
        const result = results.find(r => r.key === roleKey);
        const persona = PERSONAS[roleKey];

        console.log(`${persona.color}[ ${persona.name} ]\x1b[0m`);
        console.log(result.text.trim());
        console.log("-".repeat(50));
    }

    console.log("\n✅ Council Adjourned.");
}

summonCouncil();
