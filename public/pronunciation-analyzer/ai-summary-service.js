/**
 * AI Summary Service for Pronunciation Feedback
 * Uses Google AI Studio (Gemini) API to generate friendly, teacher-like summaries.
 * Falls back to template-based summaries if API is unavailable.
 */

import { config } from './config.js';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export class AISummaryService {
    constructor() {
        this.apiKey = config.geminiApiKey || null;
    }

    /**
     * Generate a teacher-like summary from comparison data
     * @param {string} word - The word being practiced
     * @param {Object} comparison - Comparison scores object
     * @param {Array} userSyllables - User's syllable data
     * @param {string} ipa - IPA transcription
     * @returns {Promise<string>} HTML string with the summary
     */
    async generateSummary(word, comparison, userSyllables, ipa) {
        // First render template instantly (will be shown while AI loads)
        const templateSummary = this._generateTemplateSummary(word, comparison, userSyllables);

        // Try AI-generated summary
        try {
            const aiSummary = await this._callGeminiAPI(word, comparison, userSyllables, ipa);
            if (aiSummary) return aiSummary;
        } catch (err) {
            console.warn('AI summary unavailable, using template:', err.message);
        }

        return templateSummary;
    }

    /**
     * Template-based summary (instant, no API call)
     */
    _generateTemplateSummary(word, comparison, userSyllables) {
        const score = comparison.overallScore;
        const pieces = [];

        // Opening based on overall score
        if (score >= 85) {
            pieces.push(`Great job with "${word}"! Your pronunciation is really close to native.`);
        } else if (score >= 70) {
            pieces.push(`Nice effort on "${word}"! You're getting there — just a few things to polish.`);
        } else if (score >= 50) {
            pieces.push(`Good try on "${word}"! Let's work on a couple of things to make it sound more natural.`);
        } else {
            pieces.push(`Keep practicing "${word}" — every attempt gets you closer! Here's what to focus on.`);
        }

        // Identify the biggest weakness
        const scores = [
            { name: 'pitch', score: comparison.pitchScore, label: 'melody' },
            { name: 'duration', score: comparison.durationScore, label: 'rhythm' },
            { name: 'intensity', score: comparison.intensityScore, label: 'volume emphasis' }
        ].sort((a, b) => a.score - b.score);

        const weakest = scores[0];
        const strongest = scores[scores.length - 1];

        // Mention strength
        if (strongest.score >= 75) {
            pieces.push(`Your ${strongest.label} is your strongest area — keep it up!`);
        }

        // Mention weakness (conversational)
        if (weakest.score < 70) {
            const weakAdvice = {
                pitch: `Focus on the melody — try to match the rise and fall of how a native speaker says it. Listen to the reference audio and mimic the "shape" of the sound.`,
                duration: `Watch the timing of each syllable. Some are being held too long or cut too short. The Duration chart shows exactly where to adjust.`,
                intensity: `Try to make the stressed syllable stand out more — give it a little extra "oomph" with your voice. Think of it like putting a spotlight on that syllable.`
            };
            pieces.push(weakAdvice[weakest.name]);
        }

        // Stress pattern note
        if (!comparison.stressMatches) {
            pieces.push(`Also, double-check which syllable gets the main stress — that makes a big difference in how natural it sounds.`);
        }

        // Closing encouragement
        if (score < 80) {
            pieces.push(`Try listening to the native audio, then record yourself again. You'll notice improvement each time! 🎯`);
        }

        return pieces.join(' ');
    }

    /**
     * Call Gemini API for richer, context-aware summary
     */
    async _callGeminiAPI(word, comparison, userSyllables, ipa) {
        if (!this.apiKey) return null;

        const prompt = this._buildPrompt(word, comparison, userSyllables, ipa);

        const response = await fetch(`${GEMINI_API_URL}?key=${this.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: 150,
                    temperature: 0.7,
                    topP: 0.9
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) return null;

        // Clean up: remove markdown, ensure it's concise
        return text
            .replace(/\*\*/g, '')
            .replace(/\*/g, '')
            .replace(/^#+\s*/gm, '')
            .trim();
    }

    /**
     * Build the Gemini prompt
     */
    _buildPrompt(word, comparison, userSyllables, ipa) {
        const syllableInfo = userSyllables.map((s, i) => 
            `Syllable ${i+1}: duration=${s.duration?.toFixed(3)}s, pitch=${s.maxPitch ? Math.round(s.maxPitch) + 'Hz' : 'undetected'}`
        ).join(', ');

        return `You are a friendly English pronunciation coach giving brief feedback to a student who just practiced saying "${word}" (IPA: ${ipa || 'unknown'}).

Here are their scores compared to a native speaker:
- Overall: ${comparison.overallScore}%
- Pitch accuracy: ${comparison.pitchScore}%
- Duration/rhythm: ${comparison.durationScore}%
- Volume/stress: ${comparison.intensityScore}%
- Stress pattern match: ${comparison.stressMatches ? 'correct' : 'incorrect — ' + (comparison.stressFeedback || 'wrong syllable stressed')}
${comparison.syllableCountMatches === false ? `- They pronounced ${userSyllables.length} syllables instead of the expected count` : ''}
- Their syllables: ${syllableInfo}

Write a 2-3 sentence summary that:
1. Starts with encouragement (not generic — reference their specific strengths)
2. Points out the ONE most important thing to improve, explained simply
3. Uses casual, warm teacher language (like talking to a friend)

Keep it under 60 words. Do NOT use bullet points, emojis, or formatting. Just plain conversational text.`;
    }
}
