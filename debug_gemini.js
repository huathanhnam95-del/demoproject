/* eslint-disable no-console */
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error('❌ ERROR: GEMINI_API_KEY is missing');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);

async function diagnose() {
    console.log('--- DIAGNOSIS START ---');
    try {
        console.log('Listing available models...');
        const result = await genAI.listModels();
        const modelNames = result.models.map(m => m.name);
        console.log('Available models:', JSON.stringify(modelNames, null, 2));

        const testModel = 'gemini-1.5-flash';
        if (modelNames.includes('models/' + testModel) || modelNames.includes(testModel)) {
            console.log(`\nTesting model: ${testModel}...`);
            const model = genAI.getGenerativeModel({ model: testModel });
            const testResult = await model.generateContent('Say hello');
            console.log('Test result:', testResult.response.text());
        } else {
            console.log(`\n⚠️ Warning: ${testModel} not found in available models.`);
        }
    } catch (e) {
        console.error('❌ DIAGNOSIS FAILURE:', e.message);
    }
    console.log('--- DIAGNOSIS END ---');
}

diagnose();
