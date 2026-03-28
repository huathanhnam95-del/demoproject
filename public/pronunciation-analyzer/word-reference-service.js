/* eslint-disable no-console */
/**
 * Word Reference Service
 * Main orchestrator: Check DB → Call backend for MW data → Save to DB → Return
 */

import { config } from './config.js';
import { DatabaseService } from './database-service.js';
import { STRESS_WEIGHTS, calculateStressScore, findStressedSyllable } from './stress-utils.js';

// Cache version - increment when backend algorithm changes
// v8: Force re-fetch for syllable inheritance fix (2026-01-29)
const CACHE_VERSION = 8;

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
                // VALIDATION:
                // - Version must be current
                // - Analysis must exist
                // - Alternatives must exist (new version requirement)
                const isValidVersion = dbData.cacheVersion && dbData.cacheVersion >= CACHE_VERSION;
                const hasValidAnalysis = dbData.nativeAnalysis && dbData.nativeAnalysis.pitch?.values?.length > 0;
                const hasAlternatives = Array.isArray(dbData.alternatives);

                if (isValidVersion && hasValidAnalysis && hasAlternatives) {
                    console.log('📚 Firestore hit with complete data:', normalizedWord);
                    this.sessionCache.set(normalizedWord, dbData);
                    return {
                        ...dbData,
                        fromCache: true,
                        cacheSource: 'database'
                    };
                } else {
                    let reason = '';
                    if (!isValidVersion) reason = 'outdated cache version';
                    else if (!hasValidAnalysis) reason = 'missing/empty analysis';
                    else if (!hasAlternatives) reason = 'missing multi-form data';

                    console.log(`⚠️ Database entry exists but ${reason}, re-fetching...`);
                }
            }
        }

        // 3. Fetch from backend (MW API + Praat analysis)
        console.log('🌐 Fetching from backend:', normalizedWord);
        const wordData = await this.fetchFromBackend(normalizedWord);

        // Debug: Log what we got from backend
        console.log('=== BACKEND RESPONSE ===');
        console.log('Alternatives found:', wordData.alternatives?.length || 0);
        console.log('Has nativeAnalysis:', !!wordData.nativeAnalysis);
        if (wordData.nativeAnalysis) {
            console.log('Pitch values:', wordData.nativeAnalysis.pitch?.values?.length);
            console.log('Syllables:', wordData.nativeAnalysis.syllables?.length);
        }

        // 4. Compress analysis data before saving (Firestore has size limits)
        // This step is now handled within fetchFromBackend for each alternative
        // if (wordData.nativeAnalysis) {
        //     wordData.nativeAnalysis = this.compressAnalysis(wordData.nativeAnalysis);
        // }

        // 5. Save to database for future use (with cache version)
        if (config.features.saveToDatabase && this.db.isAvailable()) {
            wordData.cacheVersion = CACHE_VERSION;

            // SANITIZATION: Firestore does not allow 'undefined' fields.
            // We must traverse the object and convert all undefined to null.
            const sanitizedData = this.sanitizeForFirestore(wordData);

            this.db.saveWord(sanitizedData).catch(err => {
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

        const alternatives = this.extractAlternatives(dictResult);

        if (alternatives.length === 0) {
            throw new Error('No pronunciation data found for this word');
        }

        // The primary result is now the first valid alternative
        const mwData = alternatives[0];

        // Step 2: Analyze ALL valid alternatives concurrently
        console.log(`🎵 Analyzing ${alternatives.length} valid word forms...`);

        // OPTIMIZATION: Track analysis by audio URL to avoid redundant processing
        const analysisCache = new Map();

        const analysisPromises = alternatives.map(async (alt) => {
            if (alt.audioUrl) {
                // If we already have analysis for this specific audio URL, reuse it
                if (analysisCache.has(alt.audioUrl)) {
                    console.log(`♻️ Reusing analysis for inherited audio: ${alt.partOfSpeech}`);
                    alt.nativeAnalysis = await analysisCache.get(alt.audioUrl);
                    return alt;
                }

                // Create the promise for this analysis and cache it
                const analysisPromise = (async () => {
                    try {
                        const analyzeResponse = await fetch(`${this.backendUrl}/analyze-url`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                audioUrl: alt.audioUrl,
                                expectedSyllables: alt.syllableCount
                            })
                        });

                        if (analyzeResponse.ok) {
                            const analysis = await analyzeResponse.json();
                            return this.compressAnalysis(analysis);
                        }
                    } catch (error) {
                        console.warn(`Could not analyze audio for form ${alt.partOfSpeech}:`, error);
                    }
                    return null;
                })();

                analysisCache.set(alt.audioUrl, analysisPromise);
                alt.nativeAnalysis = await analysisPromise;
            }
            return alt;
        });

        await Promise.all(analysisPromises);

        // DEDUPLICATION: Collapse identical word forms to keep the UI clean
        const seen = new Set();
        const uniqueAlternatives = (alternatives || []).filter(alt => {
            const pos = (alt.partOfSpeech || 'default').toLowerCase().trim();
            const ipa = (alt.pronunciation || '').toLowerCase().trim();
            const key = `${pos}:${ipa || word.toLowerCase()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        return {
            ...mwData,
            alternatives: uniqueAlternatives,
            nativeAnalysis: mwData.nativeAnalysis,
            source: mwData.source || 'merriam-webster'
        };
    }

    extractAlternatives(dictResult) {
        if (Array.isArray(dictResult?.alternatives) && dictResult.alternatives.length > 0) {
            return dictResult.alternatives.filter(Boolean);
        }

        if (Array.isArray(dictResult?.data) && dictResult.data.length > 0) {
            return dictResult.data.filter(Boolean);
        }

        if (dictResult?.data && typeof dictResult.data === 'object') {
            return [dictResult.data];
        }

        return [];
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
        // Prefer vowelDuration (voiced portion) if available for better stress cue accuracy
        const maxDuration = Math.max(...syllables.map(s => s.vowelDuration || s.duration || 1));
        const maxIntensity = Math.max(...syllables.map(s => s.intensity || 1));

        return syllables.map((syl, index) => ({
            syllable: index + 1,
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
        if (!analysis) return null;

        // Adaptive sampling: aim for 100 points total
        const currentPoints = analysis.pitch?.values?.length || 0;
        const targetPoints = 100;

        let sampleRate = Math.floor(currentPoints / targetPoints);
        if (sampleRate < 1) sampleRate = 1;
        // Cap at 3 to prevent losing too much resolution (30ms max gap)
        if (sampleRate > 3) sampleRate = 3;

        // Preserve critical points (syllable start/end times)
        // Convert syllable times to set for O(1) lookup (approximate matching)
        const criticalTimes = new Set();
        (analysis.syllables || []).forEach(s => {
            // Add start, end, and mid points
            criticalTimes.add(Math.round(s.startTime * 100));
            criticalTimes.add(Math.round(s.endTime * 100));
        });

        const filterWithCritical = (times, values) => {
            // Zip times and values to prevent index mismatch
            const zipped = times.map((t, i) => ({ t, v: values[i] }));

            const filtered = zipped.filter((item, i) => {
                const tCentis = Math.round(item.t * 100);
                // Keep if modulo matches OR if it's near a critical time (epsilon check)
                const isCritical = Array.from(criticalTimes).some(ct => Math.abs(ct - tCentis) <= 1);
                return (i % sampleRate === 0) || isCritical;
            });

            return {
                times: filtered.map(item => item.t),
                values: filtered.map(item => item.v)
            };
        };

        const pitchCompressed = filterWithCritical(analysis.pitch?.times || [], analysis.pitch?.values || []);
        const intensityCompressed = filterWithCritical(analysis.intensity?.times || [], analysis.intensity?.values || []);

        const compressed = {
            duration: analysis.duration,
            syllables: analysis.syllables,
            pitch: pitchCompressed,
            intensity: intensityCompressed
        };

        console.log(`📦 Compressed analysis: ${currentPoints} → ${compressed.pitch.values.length} points (rate: 1/${sampleRate})`);
        return compressed;
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
