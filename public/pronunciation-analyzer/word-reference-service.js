/* eslint-disable no-console */
/**
 * Word Reference Service
 * Main orchestrator: Check DB → Call backend for MW data → Save to DB → Return
 */

import { config } from './config.js';
import { DatabaseService } from './database-service.js';
import { STRESS_WEIGHTS, calculateStressScore, findStressedSyllable } from './stress-utils.js';
import {
    ALGORITHM_VERSION,
    SCHEMA_VERSION,
    attachValidatedNativeAnalyses,
    buildReferenceCacheKey,
    compressAnalysisV2,
    referenceNeedsNativeAnalysisRefresh,
    validateReferenceV2
} from './reference-contract.js';

const CACHE_VERSION = SCHEMA_VERSION;

export class WordReferenceService {
    constructor() {
        this.db = new DatabaseService();
        this.backendUrl = config.backendUrl;

        // Session cache (in-memory)
        this.sessionCache = new Map();
    }

    async decorateLearnerIPA(reference) {
        const phonetics = typeof window !== 'undefined' ? window.Phonetics : null;
        if (!reference?.variants || !phonetics || typeof phonetics.getIPA !== 'function') {
            return reference;
        }

        let learnerDisplayIpa = '';
        try {
            learnerDisplayIpa = await phonetics.getIPA(reference.word);
        } catch (error) {
            console.warn('[WordReferenceService] Shared learner IPA lookup failed:', error);
        }

        const variants = learnerDisplayIpa
            ? reference.variants.map((variant) => ({ ...variant, learnerDisplayIpa }))
            : reference.variants;

        return { ...reference, variants };
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

        const cacheKey = buildReferenceCacheKey(normalizedWord);

        // 1. Check session cache (fastest)
        if (config.sessionCacheEnabled && this.sessionCache.has(cacheKey)) {
            console.log('🚀 Session cache hit:', normalizedWord);
            const cachedReference = this.sessionCache.get(cacheKey);
            const reference = await this.refreshCachedReference(cachedReference);
            const learnerReference = await this.decorateLearnerIPA(reference);
            this.sessionCache.set(cacheKey, learnerReference);
            return {
                ...learnerReference,
                fromCache: true,
                cacheSource: 'session'
            };
        }

        // 2. Check Firestore database
        if (config.features.saveToDatabase && this.db.isAvailable()) {
            const dbData = await this.db.getWord(normalizedWord);

            if (dbData?.referenceV2) {
                try {
                    const reference = validateReferenceV2(dbData.referenceV2, {
                        expectedWord: normalizedWord
                    });
                    const refreshedReference = await this.refreshCachedReference(reference);
                    const learnerReference = await this.decorateLearnerIPA(refreshedReference);
                    console.log('📚 Firestore v2 hit:', normalizedWord);
                    this.sessionCache.set(cacheKey, learnerReference);
                    if (refreshedReference !== reference) {
                        this.saveReference(normalizedWord, refreshedReference);
                    }
                    return {
                        ...learnerReference,
                        fromCache: true,
                        cacheSource: 'database'
                    };
                } catch (error) {
                    console.warn('Cached reference rejected; refetching:', error.message);
                }
            } else if (dbData) {
                console.log('Legacy pronunciation cache found; lazily refetching:', normalizedWord);
            }
        }

        // 3. Fetch from backend (MW API + Praat analysis)
        console.log('🌐 Fetching from backend:', normalizedWord);
        const wordData = await this.fetchFromBackend(normalizedWord);

        // 4. Save under the additive v2 field. Legacy fields remain ignored.
        if (config.features.saveToDatabase && this.db.isAvailable()) {
            this.saveReference(normalizedWord, wordData);
        }

        // 5. Cache in session with the full contract identity.
        const learnerReference = await this.decorateLearnerIPA(wordData);
        this.sessionCache.set(cacheKey, learnerReference);

        return {
            ...learnerReference,
            fromCache: false,
            cacheSource: 'backend'
        };
    }

    /**
     * Fetch word data from backend (MW API + Praat analysis)
     */
    async fetchFromBackend(word) {
        const dictResponse = await fetch(`${this.backendUrl}/dictionary/v2/${encodeURIComponent(word)}`);

        if (!dictResponse.ok) {
            const error = await dictResponse.json().catch(() => ({}));
            console.error('❌ BACKEND ERROR DETAIL:', error);
            if (error.trace) console.error('Traceback:', error.trace);
            throw new Error(error.error || 'Dictionary lookup failed');
        }

        const dictResult = validateReferenceV2(await dictResponse.json(), {
            expectedWord: word
        });
        if (dictResult.variants.length === 0) {
            if (dictResult.suggestions?.length) {
                throw new Error(`Word not found. Did you mean: ${dictResult.suggestions.join(', ')}?`);
            }
            throw new Error('No pronunciation reference is available for this word');
        }

        return attachValidatedNativeAnalyses(
            dictResult,
            (variant) => this.analyzeNativeVariant(variant)
        );
    }

    async refreshCachedReference(reference) {
        if (!referenceNeedsNativeAnalysisRefresh(reference)) return reference;
        return attachValidatedNativeAnalyses(
            reference,
            (variant) => this.analyzeNativeVariant(variant),
            { refreshOnly: true }
        );
    }

    async analyzeNativeVariant(variant) {
        const analyzeResponse = await fetch(`${this.backendUrl}/analyze-url/v2`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audioUrl: variant.audioUrl,
                variantId: variant.id,
                expectedSyllableCount: variant.syllableCount
            })
        });
        if (!analyzeResponse.ok) {
            const error = new Error('Native pronunciation analysis failed');
            error.status = analyzeResponse.status;
            throw error;
        }
        return this.compressAnalysis(await analyzeResponse.json());
    }

    saveReference(word, referenceV2) {
        const sanitizedData = this.sanitizeForFirestore({
            word,
            cacheVersion: CACHE_VERSION,
            referenceAlgorithmVersion: ALGORITHM_VERSION,
            referenceV2
        });
        this.db.saveWord(sanitizedData).catch(err => {
            console.error('Error saving to database:', err);
        });
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

        const { syllableCount, primaryStress, nativeAnalysis } = wordReference;
        const nativeSyllables = nativeAnalysis?.observed?.syllables;

        // If we have native analysis, use actual values
        if (Array.isArray(nativeSyllables) && nativeSyllables.length === syllableCount) {
            return this.normalizePattern(
                nativeSyllables,
                primaryStress,
                wordReference.syllables || []
            );
        }

        return null;
    }

    /**
     * Normalize native analysis to relative percentages
     */
    normalizePattern(syllables, stressedSyllable, referenceSyllables = []) {
        const maxPitch = Math.max(...syllables.map(s => s.maxPitch || s.avgPitch || 1));
        // Prefer vowelDuration (voiced portion) if available for better stress cue accuracy
        const maxDuration = Math.max(...syllables.map(s => s.vowelDuration || s.duration || 1));
        const maxIntensity = Math.max(...syllables.map(s => s.intensity || 1));

        return syllables.map((syl, index) => ({
            syllable: index + 1,
            ipa: referenceSyllables[index]?.ipa || null,
            isStressed: index === stressedSyllable,

            // Actual values
            pitch: syl.maxPitch || syl.avgPitch || 0,
            duration: syl.vowelDuration || syl.duration || 0,
            intensity: syl.intensity || 0,

            // Relative values (0-100)
            relativePitch: Math.round(((syl.maxPitch || syl.avgPitch || 0) / maxPitch) * 100),
            relativeDuration: Math.round(((syl.vowelDuration || syl.duration || 0) / maxDuration) * 100),
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
     * Uses pattern correlation instead of finding "max stressed syllable"
     */
    compareWithNative(userSyllables, nativePattern) {
        if (!userSyllables || !nativePattern) return null;

        const userMaxPitch = Math.max(...userSyllables.map(s => s.maxPitch || 1));
        const userMaxDuration = Math.max(...userSyllables.map(s => s.vowelDuration || s.duration || 1));
        const userMaxIntensity = Math.max(...userSyllables.map(s => s.intensity || s.maxEnergy || 1));
        const userStressedIndex = findStressedSyllable(userSyllables, {
            finalSyllableDurationPenalty: 0.85
        });

        const comparison = [];
        const count = Math.min(userSyllables.length, nativePattern.length);

        for (let i = 0; i < count; i++) {
            const user = userSyllables[i];
            const native = nativePattern[i];

            const userRelPitch = Math.round(((user.maxPitch || 0) / userMaxPitch) * 100);
            const userRelDur = Math.round(((user.vowelDuration || user.duration || 0) / userMaxDuration) * 100);
            const userRelInt = Math.round(((user.intensity || user.maxEnergy || 0) / userMaxIntensity) * 100);

            comparison.push({
                syllable: i + 1,
                isTargetStressed: !!native.isStressed,
                isUserStressed: i === userStressedIndex,
                userPitch: userRelPitch,
                userDuration: userRelDur,
                userIntensity: userRelInt,
                nativePitch: native.relativePitch,
                nativeDuration: native.relativeDuration,
                nativeIntensity: native.relativeIntensity,
                pitchScore: Math.max(0, 100 - Math.abs(userRelPitch - native.relativePitch)),
                durationScore: Math.max(0, 100 - Math.abs(userRelDur - native.relativeDuration)),
                intensityScore: Math.max(0, 100 - Math.abs(userRelInt - native.relativeIntensity))
            });
        }

        // Overall scores
        const avgPitchScore = comparison.reduce((sum, c) => sum + c.pitchScore, 0) / count;
        const avgDurationScore = comparison.reduce((sum, c) => sum + c.durationScore, 0) / count;
        const avgIntensityScore = comparison.reduce((sum, c) => sum + c.intensityScore, 0) / count;

        const overallScore = Math.round(
            (avgPitchScore * STRESS_WEIGHTS.pitch) +
            (avgDurationScore * STRESS_WEIGHTS.duration) +
            (avgIntensityScore * STRESS_WEIGHTS.intensity)
        );

        // === NEW: Pattern Correlation Approach ===
        const nativeStressedIndex = nativePattern.findIndex(p => p.isStressed);
        const stressComparison = this.compareStressPattern(userSyllables, nativePattern, nativeStressedIndex);

        return {
            syllables: comparison,
            overallScore,
            pitchScore: Math.round(avgPitchScore),
            durationScore: Math.round(avgDurationScore),
            intensityScore: Math.round(avgIntensityScore),
            // === CHANGED: Use pattern correlation ===
            stressMatches: stressComparison.matches,
            patternCorrelation: stressComparison.confidence,
            stressFeedback: stressComparison.message,
            // Keep native stressed for reference
            nativeStressedSyllable: nativeStressedIndex >= 0 ? nativeStressedIndex + 1 : 1,
            userStressedSyllable: userStressedIndex >= 0 ? userStressedIndex + 1 : 1,
            syllableCountMatches: userSyllables.length === nativePattern.length
        };
    }

    /**
     * Find which syllable the user stressed most
     * Uses Scientific Weighting: Pitch (0.45), Duration (0.35), Intensity (0.20)
     * Includes final syllable penalty to compensate for natural lengthening.
     */
    findUserStressedSyllable(syllables) {
        if (!syllables || syllables.length === 0) return 0;
        return findStressedSyllable(syllables, {
            finalSyllableDurationPenalty: 0.85
        });
    }

    /**
     * Clear session cache
     */
    clearCache() {
        this.sessionCache.clear();
    }

    /**
     * Compare stress pattern using Pearson correlation
     * Asks "Does your pattern match native?" instead of "Which syllable did you stress?"
     */
    compareStressPattern(userSyllables, nativeSyllables, nativeStressedIndex) {
        if (!userSyllables?.length || !nativeSyllables?.length) {
            return { matches: true, confidence: 100, message: '' };
        }

        // Normalize to percentages for multiple features
        const normalize = (syllables, key) => {
            const values = syllables.map(s => s[key] || 0);
            const max = Math.max(...values) || 1;
            return values.map(v => v / max);
        };

        // Get user patterns
        const userDur = normalize(userSyllables, 'duration');
        const userPitch = normalize(userSyllables, 'maxPitch');
        const userInt = normalize(userSyllables, 'intensity');

        // Get native patterns (already have relativePitch etc as 0-100)
        const nativeMaxDur = Math.max(...nativeSyllables.map(s => s.duration || 0)) || 1;
        const nativeMaxPitch = Math.max(...nativeSyllables.map(s => s.maxPitch || s.pitch || 0)) || 1;
        const nativeMaxInt = Math.max(...nativeSyllables.map(s => s.intensity || 0)) || 1;

        const nativeDur = nativeSyllables.map(s => (s.duration || 0) / nativeMaxDur);
        const nativePitch = nativeSyllables.map(s => (s.maxPitch || s.pitch || 0) / nativeMaxPitch);
        const nativeInt = nativeSyllables.map(s => (s.intensity || 0) / nativeMaxInt);

        // Calculate correlations
        const minLen = Math.min(userSyllables.length, nativeSyllables.length);
        const durCorr = this.pearsonCorrelation(userDur.slice(0, minLen), nativeDur.slice(0, minLen));
        const pitchCorr = this.pearsonCorrelation(userPitch.slice(0, minLen), nativePitch.slice(0, minLen));
        const intCorr = this.pearsonCorrelation(userInt.slice(0, minLen), nativeInt.slice(0, minLen));

        // Weighted average uses the canonical stress weights.
        const avgCorr = (pitchCorr * STRESS_WEIGHTS.pitch) +
            (durCorr * STRESS_WEIGHTS.duration) +
            (intCorr * STRESS_WEIGHTS.intensity);

        // Pattern matches if correlation > 0.7
        const matches = avgCorr > 0.7;
        const confidence = Math.round(Math.max(0, avgCorr) * 100);

        return {
            matches,
            confidence,
            message: matches
                ? "Your stress pattern matches the native speaker!"
                : this.generatePatternMismatchFeedback(userSyllables, nativeSyllables, nativeStressedIndex, userDur, nativeDur)
        };
    }

    /**
     * Calculate Pearson correlation coefficient
     */
    pearsonCorrelation(x, y) {
        const n = Math.min(x.length, y.length);
        if (n < 2) return 1;

        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

        for (let i = 0; i < n; i++) {
            sumX += x[i];
            sumY += y[i];
            sumXY += x[i] * y[i];
            sumX2 += x[i] * x[i];
            sumY2 += y[i] * y[i];
        }

        const num = n * sumXY - sumX * sumY;
        const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

        return den === 0 ? 0 : num / den;
    }

    /**
     * Generate specific feedback when patterns don't match
     */
    generatePatternMismatchFeedback(userSyllables, nativeSyllables, stressedIdx, userRel, nativeRel) {
        const minLen = Math.min(userSyllables.length, nativeSyllables.length);

        // Find where user deviates most
        const deviations = [];
        for (let i = 0; i < minLen; i++) {
            deviations.push({
                syllable: i + 1,
                diff: userRel[i] - nativeRel[i],
                isStressed: i === stressedIdx
            });
        }

        // Check if stressed syllable is under-emphasized
        const stressedDev = deviations.find(d => d.isStressed);
        if (stressedDev && stressedDev.diff < -0.15) {
            return `Syllable ${stressedIdx + 1} needs more emphasis - hold it longer and raise pitch`;
        }

        // Find over-emphasized unstressed syllables
        const overEmph = deviations
            .filter(d => d.diff > 0.15 && !d.isStressed)
            .sort((a, b) => b.diff - a.diff)[0];

        if (overEmph) {
            return `Syllable ${overEmph.syllable} is too prominent - make it shorter/quieter`;
        }

        return "Adjust your rhythm to better match the native pattern";
    }

    /**
     * Compress analysis data for Firestore storage
     * Uses Adaptive Sampling: Keeps ~100 points or max 30ms resolution
     */
    compressAnalysis(analysis) {
        return compressAnalysisV2(analysis);
    }

    /**
     * Recursively sanitize data for Firestore by converting 'undefined' to 'null'
     */
    sanitizeForFirestore(obj) {
        if (obj === undefined) return null;
        if (obj === null || typeof obj !== 'object') return obj;

        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeForFirestore(item));
        }

        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            sanitized[key] = this.sanitizeForFirestore(value);
        }
        return sanitized;
    }
}
