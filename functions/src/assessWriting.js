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
const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const db = admin.firestore();

const assessWriting = onCall({ maxInstances: 10 }, async (request) => {
    // 1. Auth Check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { text, context, type } = request.data;
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
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const systemPrompt = `
        You are an advanced AI writing assistant (Grammarly Pro style). 
        Analyze the user's sentence.
        
        Structuring Rules:
        - Return raw JSON only.
        - Fields: score (0-100), feedback (string), corrections (array of {original, replacement, type, reason}).
        - Types: grammar, spelling, punctuation, clarity, tone.
        `;

        const prompt = `
        Context: ${context?.word ? 'Target word: ' + context.word : 'General writing'}
        Text: "${text}"
        `;

        const result = await model.generateContent(systemPrompt + prompt);
        const response = await result.response;
        const textResponse = response.text();

        // Clean JSON
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        const jsonString = jsonMatch ? jsonMatch[0] : "{}";
        const analysis = JSON.parse(jsonString);

        // 4. Update Usage Record
        await userRef.update({
            'aiWritingStats.lastDate': today,
            'aiWritingStats.count': (aiStats.count || 0) + 1
        });

        return {
            success: true,
            ...analysis
        };

    } catch (error) {
        console.error('Gemini Analysis Failed:', error);
        // Fallback to LanguageTool if Gemini fails? 
        // For now, return error so client can handle fallback
        throw new HttpsError('internal', 'AI analysis failed');
    }
});

module.exports = { assessWriting };
