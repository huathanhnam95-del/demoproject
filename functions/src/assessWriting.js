/**
 * assessWriting - Grammar and Style Checker using Gemini Pro
 * 
 * Features:
 * 1. Gemini Pro Analysis (Strict, Grammarly-like).
 * 2. Rate Limiting: 1 request per user per day.
 * 3. Fallback/Default: LanguageTool (handled on client or server? Server is safer for validation).
 * 
 * Note: The user requested LanguageTool as a fallback if they don't press the button, 
 * OR if they run out of credits. We'll handle the "Advanced Check" here.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { VertexAI } = require('@google-cloud/vertexai');
const admin = require('firebase-admin');
const {
    buildModelPrompt,
    extractJsonObject,
    extractVertexText,
    truncateForLog
} = require('./assessWriting.helpers');

// Initialize Vertex AI
// GCLOUD_PROJECT is automatically populated in Firebase Functions environments.
const project = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

const vertexAI = new VertexAI({ project, location });
const db = admin.firestore();

const assessWriting = onCall({ maxInstances: 10 }, async (request) => {
    // 1. Auth Check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { text, context } = request.data;
    const uid = request.auth.uid;

    if (!text || typeof text !== 'string' || text.length > 2000) {
        throw new HttpsError('invalid-argument', 'Valid text is required (max 2000 chars)');
    }

    // 2. Check Rate Limit (20 checks per day)
    const MAX_FREE_CHECKS = 20;
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    let aiStats = userData.aiWritingStats || { lastDate: '', count: 0 };

    // Reset if it's a new day
    if (aiStats.lastDate !== today) {
        aiStats = { lastDate: today, count: 0 };
    }

    if (aiStats.count >= MAX_FREE_CHECKS) {
        // Rate limit exceeded
        return {
            limited: true,
            message: `You have used your ${MAX_FREE_CHECKS} free AI checks for today.`,
            fallback: true // Signal client to use LanguageTool
        };
    }

    try {
        // 3. Perform Gemini Analysis (Using FLASH for efficiency)
        const model = vertexAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const systemPrompt = `
        You are an advanced AI writing assistant (Grammarly Pro style). 
        Analyze the user's sentence.
        
        Structuring Rules:
        - Return raw JSON only.
        - Fields: score (0-100), feedback (string), corrections (array of {original, replacement, type, reason}).
        - Types: grammar, spelling, punctuation, clarity, tone.
        `;

        const prompt = buildModelPrompt(text, context);

        const result = await model.generateContent(systemPrompt + prompt);
        const response = await result.response;
        const textResponse = extractVertexText(response);
        let analysis;
        try {
            analysis = extractJsonObject(textResponse);
        } catch (parseError) {
            parseError.rawResponse = textResponse;
            throw parseError;
        }

        // 4. Update Usage Record
        await userRef.set({
            aiWritingStats: {
                lastDate: today,
                count: (aiStats.count || 0) + 1
            }
        }, { merge: true });

        return {
            success: true,
            ...analysis
        };

    } catch (error) {
        console.error('Gemini Analysis Failed:', {
            uid,
            challengeId: context?.challengeId || '',
            contextId: context?.contextId || '',
            entryType: context?.entryType || '',
            hasUserDoc: userDoc.exists,
            hasPromptText: Boolean(context?.promptText),
            hasUsedCollocation: Boolean(context?.usedCollocation),
            parseFailure: /JSON|No JSON|Empty model response/i.test(String(error?.message || '')),
            errorMessage: error?.message || String(error),
            rawResponse: typeof error?.rawResponse === 'string' ? truncateForLog(error.rawResponse) : undefined
        });
        throw new HttpsError('internal', 'AI analysis failed');
    }
});

module.exports = {
    assessWriting,
    buildModelPrompt,
    extractJsonObject,
    extractVertexText
};
