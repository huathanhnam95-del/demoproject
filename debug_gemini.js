/* eslint-disable no-console */
const { VertexAI } = require('@google-cloud/vertexai');
require('dotenv').config();

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

if (!PROJECT_ID) {
    console.error('❌ ERROR: FIREBASE_PROJECT_ID is missing');
    process.exit(1);
}

const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });

async function diagnose() {
    console.log('--- DIAGNOSIS START (VERTEX AI) ---');
    try {
        const testModel = 'gemini-1.5-flash';
        console.log(`\nTesting model: ${testModel}...`);

        const model = vertexAI.getGenerativeModel({ model: testModel });
        const testResult = await model.generateContent('Say hello');

        // Vertex AI response structure is slightly different depending on version, 
        // but typically has candidates[0].content.parts[0].text
        console.log('Test result:', testResult.response.text());
        console.log('✅ Vertex AI authentication successful!');
    } catch (e) {
        console.error('❌ DIAGNOSIS FAILURE:', e.message);
    }
    console.log('--- DIAGNOSIS END ---');
}

diagnose();
