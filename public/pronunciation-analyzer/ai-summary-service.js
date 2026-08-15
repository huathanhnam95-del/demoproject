/**
 * AI Summary Service for Pronunciation Feedback
 * Uses Google Cloud Vertex AI (via backend proxy) to generate friendly, teacher-like summaries.
 * Falls back to instant template-based summaries if API is unavailable.
 */

import { config } from './config.js';

export class AISummaryService {
    constructor() {
        this.endpoint = config.aiSummaryEndpoint || '/api/pronunciation-ai/summary';
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
            pieces.push(`Great job with "${word}"! Your prosody is really close to the native pattern.`);
        } else if (score >= 70) {
            pieces.push(`Nice effort on "${word}"! You're getting there — just a few prosody details to polish.`);
        } else if (score >= 50) {
            pieces.push(`Good try on "${word}"! Let's work on a couple of melody and rhythm details to make it sound more natural.`);
        } else {
            pieces.push(`Keep practicing "${word}" — every attempt gets you closer! Here's what to focus on for prosody.`);
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
            pieces.push(`Also, double-check which syllable gets the main stress cue — that makes a big difference in how natural it sounds.`);
        }

        // Closing encouragement
        if (score < 80) {
            pieces.push(`Try listening to the native audio, then record yourself again. You'll notice improvement each time! 🎯`);
        }

        return pieces.join(' ');
    }

    /**
     * Call backend proxy for Vertex AI summary
     */
    async _callGeminiAPI(word, comparison, userSyllables, ipa) {
        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                word,
                comparison,
                userSyllables,
                ipa
            })
        });

        if (!response.ok) {
            throw new Error(`Summary API error: ${response.status}`);
        }

        const data = await response.json();
        const summary = data?.summary || data?.data?.summary;

        if (!summary) return null;

        return String(summary).trim();
    }
}
