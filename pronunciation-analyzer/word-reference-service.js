/**
 * Word Reference Service
 * Main orchestrator: Check DB → Call backend for MW data → Save to DB → Return
 */

import { config } from './config.js';
import { DatabaseService } from './database-service.js';

// Cache version - increment when backend algorithm changes
// v2: Fixed stress detection for IPA strings (2026-01-12)
const CACHE_VERSION = 2;

export class WordReferenceService {
    constructor() {
        this.db = new DatabaseService();
        this.backendUrl = config.backendUrl;

        // Session cache (in-memory)
        this.sessionCache = new Map();
    }

    /**
     * Get complete word reference data with native audio analysis
     * Flow: Session Cache → Firestore → Backend (MW + Praat) → Save → Return
     */
    async getWordReference(word) {
        const normalizedWord = word.toLowerCase().trim();

        if (!normalizedWord) {
            throw new Error('Please enter a word');
        }

        // 1. Check session cache (fastest)
        if (config.sessionCacheEnabled && this.sessionCache.has(normalizedWord)) {
            console.log('🚀 Session cache hit:', normalizedWord);
            return {
                ...this.sessionCache.get(normalizedWord),
                fromCache: true,
                cacheSource: 'session'
            };
        }

        // 2. Check Firestore database
        if (config.features.saveToDatabase && this.db.isAvailable()) {
            const dbData = await this.db.getWord(normalizedWord);

            if (dbData) {
                console.log('=== DATABASE DATA ===');
                console.log('Word:', dbData.word);
                console.log('Cache version:', dbData.cacheVersion || 'none');
                console.log('Has nativeAnalysis:', !!dbData.nativeAnalysis);
                console.log('nativeAnalysis.pitch:', dbData.nativeAnalysis?.pitch?.values?.length || 'none');
                console.log('nativeAnalysis.syllables:', dbData.nativeAnalysis?.syllables?.length || 'none');

                // Check cache version - if outdated, re-fetch
                const isValidVersion = dbData.cacheVersion && dbData.cacheVersion >= CACHE_VERSION;
                const hasValidAnalysis = dbData.nativeAnalysis && dbData.nativeAnalysis.pitch?.values?.length > 0;

                if (isValidVersion && hasValidAnalysis) {
                    console.log('📚 Firestore hit with valid analysis:', normalizedWord);
                    this.sessionCache.set(normalizedWord, dbData);
                    return {
                        ...dbData,
                        fromCache: true,
                        cacheSource: 'database'
                    };
                } else {
                    const reason = !isValidVersion ? 'outdated cache version' : 'missing/empty analysis';
                    console.log(`⚠️ Database entry exists but ${reason}, re-fetching...`);
                }
            }
        }

        // 3. Fetch from backend (MW API + Praat analysis)
        console.log('🌐 Fetching from backend:', normalizedWord);
        const wordData = await this.fetchFromBackend(normalizedWord);

        // Debug: Log what we got from backend
        console.log('=== BACKEND RESPONSE ===');
        console.log('Has nativeAnalysis:', !!wordData.nativeAnalysis);
        if (wordData.nativeAnalysis) {
            console.log('Pitch values:', wordData.nativeAnalysis.pitch?.values?.length);
            console.log('Syllables:', wordData.nativeAnalysis.syllables?.length);
        }

        // 4. Compress analysis data before saving (Firestore has size limits)
        if (wordData.nativeAnalysis) {
            wordData.nativeAnalysis = this.compressAnalysis(wordData.nativeAnalysis);
        }

        // 5. Save to database for future use (with cache version)
        if (config.features.saveToDatabase && this.db.isAvailable()) {
            wordData.cacheVersion = CACHE_VERSION;
            this.db.saveWord(wordData).catch(err => {
                console.error('Error saving to database:', err);
            });
        }

        // 6. Cache in session
        this.sessionCache.set(normalizedWord, wordData);

        return {
            ...wordData,
            fromCache: false,
            cacheSource: 'backend'
        };
    }

    /**
     * Fetch word data from backend (MW API + Praat analysis)
     */
    async fetchFromBackend(word) {
        // Step 1: Get dictionary data
        const dictResponse = await fetch(`${this.backendUrl}/dictionary/${encodeURIComponent(word)}`);

        if (!dictResponse.ok) {
            const error = await dictResponse.json().catch(() => ({}));
            console.error('❌ BACKEND ERROR DETAIL:', error);
            if (error.trace) console.error('Traceback:', error.trace);
            throw new Error(error.error || 'Dictionary lookup failed');
        }

        const dictResult = await dictResponse.json();

        if (!dictResult.found) {
            if (dictResult.suggestions && dictResult.suggestions.length > 0) {
                throw new Error(`Word not found. Did you mean: ${dictResult.suggestions.join(', ')}?`);
            }
            throw new Error('Word not found in dictionary');
        }

        const mwData = dictResult.data;

        // Step 2: Analyze native audio with Praat (if audio URL available)
        let nativeAnalysis = null;

        if (mwData.audioUrl) {
            try {
                const analyzeResponse = await fetch(`${this.backendUrl}/analyze-url`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        audioUrl: mwData.audioUrl,
                        expectedSyllables: mwData.syllableCount
                    })
                });

                if (analyzeResponse.ok) {
                    nativeAnalysis = await analyzeResponse.json();
                    console.log('🎵 Native audio analyzed:', nativeAnalysis);
                }
            } catch (error) {
                console.warn('Could not analyze native audio:', error);
            }
        }

        return {
            ...mwData,
            nativeAnalysis,
            source: 'merriam-webster'
        };
    }

    /**
     * Get proxied audio URL for playback
     */
    getProxiedAudioUrl(originalUrl) {
        if (!originalUrl) return null;
        return `${this.backendUrl}/proxy-audio?url=${encodeURIComponent(originalUrl)}`;
    }

    /**
     * Get expected stress pattern (for comparison chart)
     * Returns relative values (0-100) for each syllable
     */
    getExpectedPattern(wordReference) {
        if (!wordReference) return null;

        const { syllableCount, stressedSyllable, nativeAnalysis } = wordReference;

        // If we have native analysis, use actual values
        if (nativeAnalysis && nativeAnalysis.syllables && nativeAnalysis.syllables.length > 0) {
            return this.normalizePattern(nativeAnalysis.syllables, stressedSyllable);
        }

        // Otherwise, generate theoretical pattern
        return this.generateTheoreticalPattern(syllableCount, stressedSyllable);
    }

    /**
     * Normalize native analysis to relative percentages
     */
    normalizePattern(syllables, stressedSyllable) {
        const maxPitch = Math.max(...syllables.map(s => s.maxPitch || s.avgPitch || 1));
        const maxDuration = Math.max(...syllables.map(s => s.duration || 1));
        const maxIntensity = Math.max(...syllables.map(s => s.intensity || 1));

        return syllables.map((syl, index) => ({
            syllable: index + 1,
            isStressed: index === stressedSyllable,

            // Actual values
            pitch: syl.maxPitch || syl.avgPitch || 0,
            duration: syl.duration || 0,
            intensity: syl.intensity || 0,

            // Relative values (0-100)
            relativePitch: Math.round(((syl.maxPitch || syl.avgPitch || 0) / maxPitch) * 100),
            relativeDuration: Math.round(((syl.duration || 0) / maxDuration) * 100),
            relativeIntensity: Math.round(((syl.intensity || 0) / maxIntensity) * 100)
        }));
    }

    /**
     * Generate theoretical pattern when native audio isn't available
     */
    generateTheoreticalPattern(syllableCount, stressedSyllable) {
        const pattern = [];

        for (let i = 0; i < syllableCount; i++) {
            const isStressed = i === stressedSyllable;
            pattern.push({
                syllable: i + 1,
                isStressed: isStressed,
                pitch: isStressed ? 160 : 110,
                duration: isStressed ? 0.28 : 0.18,
                intensity: isStressed ? 70 : 50,
                relativePitch: isStressed ? 100 : 65,
                relativeDuration: isStressed ? 100 : 65,
                relativeIntensity: isStressed ? 100 : 60
            });
        }

        return pattern;
    }

    /**
     * Compare user's pronunciation with native reference
     */
    compareWithNative(userSyllables, nativePattern) {
        if (!userSyllables || !nativePattern) return null;

        const userMaxPitch = Math.max(...userSyllables.map(s => s.maxPitch || 1));
        const userMaxDuration = Math.max(...userSyllables.map(s => s.duration || 1));
        const userMaxIntensity = Math.max(...userSyllables.map(s => s.intensity || s.maxEnergy || 1));

        const comparison = [];
        const count = Math.min(userSyllables.length, nativePattern.length);

        for (let i = 0; i < count; i++) {
            const user = userSyllables[i];
            const native = nativePattern[i];

            const userRelativePitch = Math.round(((user.maxPitch || 0) / userMaxPitch) * 100);
            const userRelativeDuration = Math.round(((user.duration || 0) / userMaxDuration) * 100);
            const userRelativeIntensity = Math.round(((user.intensity || user.maxEnergy || 0) / userMaxIntensity) * 100);

            comparison.push({
                syllable: i + 1,
                isStressed: native.isStressed,
                userPitch: userRelativePitch,
                userDuration: userRelativeDuration,
                userIntensity: userRelativeIntensity,
                nativePitch: native.relativePitch,
                nativeDuration: native.relativeDuration,
                nativeIntensity: native.relativeIntensity,
                pitchScore: Math.max(0, 100 - Math.abs(userRelativePitch - native.relativePitch)),
                durationScore: Math.max(0, 100 - Math.abs(userRelativeDuration - native.relativeDuration)),
                intensityScore: Math.max(0, 100 - Math.abs(userRelativeIntensity - native.relativeIntensity))
            });
        }

        // Overall scores
        const avgPitchScore = comparison.reduce((sum, c) => sum + c.pitchScore, 0) / count;
        const avgDurationScore = comparison.reduce((sum, c) => sum + c.durationScore, 0) / count;
        const avgIntensityScore = comparison.reduce((sum, c) => sum + c.intensityScore, 0) / count;
        const overallScore = Math.round((avgPitchScore + avgDurationScore + avgIntensityScore) / 3);

        // Find user's stressed syllable
        const userStressedIndex = this.findUserStressedSyllable(userSyllables);
        const nativeStressedIndex = nativePattern.findIndex(p => p.isStressed);
        const stressMatches = userStressedIndex === nativeStressedIndex;

        return {
            syllables: comparison,
            overallScore,
            pitchScore: Math.round(avgPitchScore),
            durationScore: Math.round(avgDurationScore),
            intensityScore: Math.round(avgIntensityScore),
            stressMatches,
            userStressedSyllable: userStressedIndex + 1,
            nativeStressedSyllable: nativeStressedIndex + 1,
            syllableCountMatches: userSyllables.length === nativePattern.length
        };
    }

    /**
     * Find which syllable the user stressed most
     */
    findUserStressedSyllable(syllables) {
        if (!syllables || syllables.length === 0) return 0;

        const maxPitch = Math.max(...syllables.map(s => s.maxPitch || 0));
        const maxDuration = Math.max(...syllables.map(s => s.duration || 0));
        const maxEnergy = Math.max(...syllables.map(s => s.intensity || s.maxEnergy || 0));

        let maxScore = -1;
        let stressedIndex = 0;

        syllables.forEach((s, i) => {
            const score =
                (s.maxPitch || 0) / (maxPitch || 1) +
                (s.duration || 0) / (maxDuration || 1) +
                (s.intensity || s.maxEnergy || 0) / (maxEnergy || 1);

            if (score > maxScore) {
                maxScore = score;
                stressedIndex = i;
            }
        });

        return stressedIndex;
    }

    /**
     * Clear session cache
     */
    clearCache() {
        this.sessionCache.clear();
    }

    /**
     * Compress analysis data for Firestore storage
     * Reduces pitch/intensity arrays by sampling every Nth point
     */
    compressAnalysis(analysis) {
        if (!analysis) return null;

        const sampleRate = 5; // Keep every 5th data point

        const compressed = {
            duration: analysis.duration,
            syllables: analysis.syllables,
            pitch: {
                times: analysis.pitch?.times?.filter((_, i) => i % sampleRate === 0) || [],
                values: analysis.pitch?.values?.filter((_, i) => i % sampleRate === 0) || []
            },
            intensity: {
                times: analysis.intensity?.times?.filter((_, i) => i % sampleRate === 0) || [],
                values: analysis.intensity?.values?.filter((_, i) => i % sampleRate === 0) || []
            }
        };

        console.log(`📦 Compressed analysis: ${analysis.pitch?.values?.length || 0} → ${compressed.pitch.values.length} points`);
        return compressed;
    }
}
