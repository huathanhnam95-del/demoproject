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
const admin = require('firebase-admin');
const {
    buildModelPrompt,
    extractGeneratedText,
    extractJsonObject,
    extractVertexText,
    truncateForLog
} = require('./assessWriting.helpers');
const {
    DEFAULT_VERTEX_LOCATION,
    getGeminiModel,
    normalizeScalar,
    shouldUseGeminiFallback
} = require('./geminiVertexModels');

const db = admin.firestore();

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const JSON_GENERATION_CONFIG = {
    responseMimeType: 'application/json',
    temperature: 0.2
};

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
        const primaryModelName = normalizeScalar(process.env.AI_WRITING_GEMINI_MODEL) || DEFAULT_MODEL;
        const fallbackModelName = normalizeScalar(process.env.AI_WRITING_GEMINI_FALLBACK_MODEL) || FALLBACK_MODEL;
        const primaryLocation = normalizeScalar(process.env.AI_WRITING_VERTEX_LOCATION) || DEFAULT_VERTEX_LOCATION;
        const fallbackLocation = normalizeScalar(process.env.AI_WRITING_FALLBACK_VERTEX_LOCATION) || primaryLocation;
        const primaryModel = getGeminiModel({
            modelName: primaryModelName,
            location: primaryLocation,
            generationConfig: JSON_GENERATION_CONFIG
        });
        const fallbackModel = getGeminiModel({
            modelName: fallbackModelName,
            location: fallbackLocation,
            generationConfig: JSON_GENERATION_CONFIG
        });

        const systemPrompt = `
        You are an advanced AI writing assistant (Grammarly Pro style). 
        Analyze the user's sentence.
        
        Structuring Rules:
        - Return raw JSON only.
        - Fields: score (0-100), feedback (string), corrections (array of {original, replacement, type, reason}).
        - Types: grammar, spelling, punctuation, clarity, tone.
        `;

        const prompt = buildModelPrompt(text, context);

        let analysis;
        let rawTextResponse = '';

        try {
            const result = await primaryModel.generateContent(systemPrompt + prompt);
            rawTextResponse = await extractGeneratedText(result);
            analysis = extractJsonObject(rawTextResponse);
        } catch (error) {
            if (!shouldUseGeminiFallback(error)) {
                if (typeof rawTextResponse === 'string' && rawTextResponse) {
                    error.rawResponse = rawTextResponse;
                }
                throw error;
            }

            try {
                const result = await fallbackModel.generateContent(systemPrompt + prompt);
                rawTextResponse = await extractGeneratedText(result);
                analysis = extractJsonObject(rawTextResponse);
            } catch (fallbackError) {
                if (typeof rawTextResponse === 'string' && rawTextResponse) {
                    fallbackError.rawResponse = rawTextResponse;
                }
                throw fallbackError;
            }
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
    extractGeneratedText,
    extractVertexText
};
