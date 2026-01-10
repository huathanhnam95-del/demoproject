export class SyllableDetector {
    constructor(options = {}) {
        this.minEnergyThreshold = options.minEnergyThreshold || 0.008;
        this.minDuration = options.minDuration || 0.06;
    }

    /**
     * Detects syllables from energy and pitch data.
     * @param {Object} data { energies: [], pitches: [], times: [] }
     * @param {number} expectedCount Hint from IPA parser
     */
    detect(data, expectedCount = null) {
        if (data.energies.length === 0) return { syllables: [], noiseCount: 0 };

        // IF we have an expected count, use Guided Segmentation (Dictionary-Driven)
        if (expectedCount && expectedCount > 0) {
            return this.detectWithExpectedCount(data, expectedCount);
        }

        // OTHERWISE, use the previous Peak-Based Detection (Blind)
        // 1. Adaptive smoothing
        const windowSize = data.energies.length > 500 ? 7 : 5;
        const smoothedEnergy = this._smoothArray(data.energies, windowSize);

        // 2. Profile recording
        const peakEnergy = Math.max(...smoothedEnergy) || 0;
        const activeFrames = smoothedEnergy.filter(e => e > peakEnergy * 0.1);
        const avgActiveEnergy = activeFrames.length > 0
            ? activeFrames.reduce((a, b) => a + b, 0) / activeFrames.length
            : peakEnergy * 0.2;

        // 3. Peak Detection
        let minGap = 0.10;
        let syllables = this._detectByPeaks(data, smoothedEnergy, peakEnergy, avgActiveEnergy, minGap);

        // 4. Final noise filtering
        const initialCount = syllables.length;
        const filtered = this.filterNoiseSyllables(syllables, null, { peakEnergy, avgActiveEnergy });

        return {
            syllables: filtered,
            noiseCount: initialCount - filtered.length
        };
    }

    // =========================================================================
    // STRATEGY A: GUIDED SEGMENTATION (Dictionary Driven)
    // =========================================================================

    detectWithExpectedCount(data, expectedSyllables) {
        const { energies, pitches, times } = data;

        // Step 1: Find speech region
        const speech = this.findSpeechRegion(energies, times);

        // Step 2: Find boundary candidates
        const candidates = this.findBoundaryCandidates(
            energies, pitches, times,
            speech.startIdx, speech.endIdx
        );

        // Step 3: Select best boundaries based on expected count
        const boundaries = this.selectBoundaries(
            candidates,
            expectedSyllables,
            speech.startTime,
            speech.endTime
        );

        // Step 4: Create syllables from boundaries
        const syllables = [];
        const allBounds = [speech.startTime, ...boundaries, speech.endTime];

        // We'll calculate recording stats once for noise check (though minimal here)
        const peakEnergy = Math.max(...energies) || 0;
        const avgActiveEnergy = peakEnergy * 0.3; // estimate

        for (let i = 0; i < allBounds.length - 1; i++) {
            const startTime = allBounds[i];
            const endTime = allBounds[i + 1];

            // Find indices
            let startIdx = times.findIndex(t => t >= startTime);
            let endIdx = times.findIndex(t => t >= endTime);
            if (startIdx === -1) startIdx = 0;
            if (endIdx === -1) endIdx = times.length - 1;

            // Calculate stats for this syllable
            const sylPitches = pitches.slice(startIdx, endIdx + 1).filter(p => p !== null);
            const sylEnergies = energies.slice(startIdx, endIdx + 1);

            const maxEnergy = sylEnergies.length > 0 ? Math.max(...sylEnergies) : 0;
            const avgPitch = sylPitches.length > 0
                ? sylPitches.reduce((a, b) => a + b, 0) / sylPitches.length
                : 0;

            syllables.push({
                startTime,
                endTime,
                duration: endTime - startTime,
                avgPitch: avgPitch,
                maxPitch: sylPitches.length > 0 ? Math.max(...sylPitches) : 0,
                avgEnergy: sylEnergies.length > 0
                    ? sylEnergies.reduce((a, b) => a + b, 0) / sylEnergies.length
                    : 0,
                maxEnergy: maxEnergy,
                pitchConfidence: sylPitches.length / (sylEnergies.length || 1)
            });
        }

        // For guided detection, we generally assume "filtered" count is 0 
        // because we forced the count. But we might flag very weak ones?
        // Let's just return the forced segments.
        return {
            syllables: syllables,
            noiseCount: 0
        };
    }

    findSpeechRegion(energies, times) {
        const maxEnergy = Math.max(...energies) || 0;
        const threshold = maxEnergy * 0.10; // 10% of max

        let startIdx = 0;
        let endIdx = energies.length - 1;

        // Find start
        for (let i = 0; i < energies.length; i++) {
            if (energies[i] > threshold) {
                startIdx = Math.max(0, i - 2);
                break;
            }
        }

        // Find end
        for (let i = energies.length - 1; i >= 0; i--) {
            if (energies[i] > threshold) {
                endIdx = Math.min(energies.length - 1, i + 2);
                break;
            }
        }

        return {
            startTime: times[startIdx],
            endTime: times[endIdx],
            startIdx,
            endIdx
        };
    }

    findBoundaryCandidates(energies, pitches, times, startIdx, endIdx) {
        const candidates = [];
        const smoothed = this._smoothArray(energies, 3);

        for (let i = startIdx + 3; i < endIdx - 3; i++) {
            let score = 0;

            // Check for energy dip (even small ones)
            const localMax = Math.max(
                smoothed[i - 2], smoothed[i - 1],
                smoothed[i + 1], smoothed[i + 2]
            );
            const dipRatio = smoothed[i] / (localMax || 1);
            if (dipRatio < 0.98) {
                score += (1 - dipRatio) * 10; // Bigger dip = higher score
            }

            // Check for pitch inflection change (peaks/valleys in pitch)
            // Often boundaries happen where pitch direction changes
            if (pitches[i - 1] && pitches[i] && pitches[i + 1]) {
                const prevDiff = pitches[i] - pitches[i - 1];
                const nextDiff = pitches[i + 1] - pitches[i];
                if ((prevDiff > 0 && nextDiff < 0) || (prevDiff < 0 && nextDiff > 0)) {
                    score += 2;
                }
            }

            // Check for pitch jump
            if (pitches[i] && pitches[i + 1]) {
                const pitchChange = Math.abs(pitches[i + 1] - pitches[i]);
                if (pitchChange > 10) {
                    score += pitchChange / 20;
                }
            }

            if (score > 0) {
                candidates.push({
                    index: i,
                    time: times[i],
                    score: score
                });
            }
        }

        return this.mergeCandidates(candidates, 0.05);
    }

    mergeCandidates(candidates, minGap) {
        if (candidates.length === 0) return [];

        candidates.sort((a, b) => a.time - b.time);
        const merged = [candidates[0]];

        for (let i = 1; i < candidates.length; i++) {
            const last = merged[merged.length - 1];
            if (candidates[i].time - last.time < minGap) {
                // Keep the one with higher score
                if (candidates[i].score > last.score) {
                    merged[merged.length - 1] = candidates[i];
                }
            } else {
                merged.push(candidates[i]);
            }
        }

        return merged;
    }

    selectBoundaries(candidates, expectedSyllables, speechStart, speechEnd) {
        const numBoundaries = expectedSyllables - 1;

        if (candidates.length === 0 || numBoundaries <= 0) {
            return this.divideEvenly(speechStart, speechEnd, expectedSyllables);
        }

        if (candidates.length <= numBoundaries) {
            // Not enough candidates - use all + fill gaps
            return this.fillGaps(candidates, speechStart, speechEnd, expectedSyllables);
        }

        // More candidates than needed - Select N-1 best spaced ones
        const duration = speechEnd - speechStart;
        const idealGap = duration / expectedSyllables;

        // Sort by score (descending)
        const sortedScores = [...candidates].sort((a, b) => b.score - a.score);

        const selected = [];

        // Greedily select high scoring boundaries that fit well
        for (const candidate of sortedScores) {
            if (selected.length >= numBoundaries) break;

            // Avoid boundaries too close to start/end
            if (candidate.time - speechStart < idealGap * 0.5) continue;
            if (speechEnd - candidate.time < idealGap * 0.5) continue;

            // Avoid boundaries too close to already selected
            const tooClose = selected.some(s =>
                Math.abs(s.time - candidate.time) < idealGap * 0.6
            );

            if (!tooClose) {
                selected.push(candidate);
            }
        }

        if (selected.length < numBoundaries) {
            return this.fillGaps(selected, speechStart, speechEnd, expectedSyllables);
        }

        selected.sort((a, b) => a.time - b.time);
        return selected.map(s => s.time);
    }

    divideEvenly(startTime, endTime, syllableCount) {
        const duration = endTime - startTime;
        const syllableDuration = duration / syllableCount;
        const boundaries = [];
        for (let i = 1; i < syllableCount; i++) {
            boundaries.push(startTime + (syllableDuration * i));
        }
        return boundaries;
    }

    fillGaps(existingBoundaries, startTime, endTime, syllableCount) {
        const numNeeded = syllableCount - 1;
        // existingBoundaries might be objects or numbers
        let boundaries = existingBoundaries.map(b => b.time || b).sort((a, b) => a - b);

        if (boundaries.length >= numNeeded) {
            return boundaries.slice(0, numNeeded);
        }

        // Fill gaps in the largest spaces
        while (boundaries.length < numNeeded) {
            let maxGap = 0;
            let gapStart = startTime;
            let gapEnd = endTime;
            let insertIndex = 0;

            const sorted = [startTime, ...boundaries, endTime];
            for (let i = 0; i < sorted.length - 1; i++) {
                const gap = sorted[i + 1] - sorted[i];
                if (gap > maxGap) {
                    maxGap = gap;
                    gapStart = sorted[i];
                    gapEnd = sorted[i + 1];
                    insertIndex = i; // Insert after this index in boundaries
                }
            }
            // Add to boundaries list
            const mid = (gapStart + gapEnd) / 2;
            boundaries.push(mid);
            boundaries.sort((a, b) => a - b);
        }

        return boundaries;
    }

    // =========================================================================
    // STRATEGY B: PEAK DETECTION (Blind / Fallback)
    // =========================================================================

    _detectByPeaks(data, smoothedEnergy, peakEnergy, avgActiveEnergy, minGap) {
        const { energies, pitches, times } = data;
        const speechThreshold = peakEnergy * 0.12;

        const peaks = [];
        for (let i = 2; i < smoothedEnergy.length - 2; i++) {
            if (smoothedEnergy[i] > speechThreshold) {
                if (smoothedEnergy[i] >= smoothedEnergy[i - 1] &&
                    smoothedEnergy[i] >= smoothedEnergy[i - 2] &&
                    smoothedEnergy[i] > smoothedEnergy[i + 1] &&
                    smoothedEnergy[i] > smoothedEnergy[i + 2]) {
                    peaks.push({ index: i, time: times[i], energy: smoothedEnergy[i] });
                }
            }
        }

        const mergedPeaks = [];
        for (const p of peaks) {
            if (mergedPeaks.length === 0) {
                mergedPeaks.push(p);
            } else {
                const last = mergedPeaks[mergedPeaks.length - 1];
                if (p.time - last.time < minGap) {
                    if (p.energy > last.energy) {
                        mergedPeaks[mergedPeaks.length - 1] = p;
                    }
                } else {
                    mergedPeaks.push(p);
                }
            }
        }

        if (mergedPeaks.length === 0) return [];

        const syllables = [];
        for (let i = 0; i < mergedPeaks.length; i++) {
            const peak = mergedPeaks[i];

            let startTime, endTime;
            if (i === 0) {
                startTime = this._findSpeechEdge(times, smoothedEnergy, speechThreshold, peak.index, -1);
            } else {
                startTime = (mergedPeaks[i - 1].time + peak.time) / 2;
            }

            if (i === mergedPeaks.length - 1) {
                endTime = this._findSpeechEdge(times, smoothedEnergy, speechThreshold, peak.index, 1);
            } else {
                endTime = (peak.time + mergedPeaks[i + 1].time) / 2;
            }

            const sIdx = Math.max(0, times.findIndex(t => t >= startTime));
            let eIdx = times.findIndex(t => t >= endTime);
            if (eIdx === -1) eIdx = times.length - 1;

            const sylPitches = pitches.slice(sIdx, eIdx + 1).filter(p => p !== null);
            const sylEnergies = energies.slice(sIdx, eIdx + 1);

            syllables.push({
                startTime,
                endTime,
                duration: endTime - startTime,
                avgPitch: sylPitches.length > 0 ? sylPitches.reduce((a, b) => a + b, 0) / sylPitches.length : 0,
                maxPitch: sylPitches.length > 0 ? Math.max(...sylPitches) : 0,
                avgEnergy: sylEnergies.reduce((a, b) => a + b, 0) / (sylEnergies.length || 1),
                maxEnergy: Math.max(...sylEnergies) || 0,
                pitchConfidence: sylPitches.length / (eIdx - sIdx + 1 || 1)
            });
        }
        return syllables;
    }

    filterNoiseSyllables(syllables, expectedCount = null, stats = {}) {
        const { peakEnergy = 0, avgActiveEnergy = 0 } = stats;

        let filtered = syllables.filter(s => {
            if (s.avgPitch < 70 || s.avgPitch > 400) return false;
            const confidenceThreshold = avgActiveEnergy < 0.02 ? 0.25 : 0.4;
            if (s.pitchConfidence < confidenceThreshold) return false;
            return true;
        });

        if (filtered.length > 0) {
            filtered = filtered.filter(s => {
                const isStrongerThanAvgNoise = s.maxEnergy >= avgActiveEnergy * 0.20;
                const isStrongerThanPeakNoise = s.maxEnergy >= peakEnergy * 0.12;
                return isStrongerThanAvgNoise || isStrongerThanPeakNoise;
            });
        }

        if (expectedCount && filtered.length > expectedCount) {
            filtered.sort((a, b) => {
                const scoreA = a.maxEnergy + (a.avgPitch > 0 ? 0.5 : 0) + a.duration;
                const scoreB = b.maxEnergy + (b.avgPitch > 0 ? 0.5 : 0) + b.duration;
                return scoreB - scoreA;
            });
            filtered = filtered.slice(0, Math.max(expectedCount, 0));
            filtered.sort((a, b) => a.startTime - b.startTime);
        }

        return filtered;
    }

    _smoothArray(arr, windowSize) {
        const result = [];
        const half = Math.floor(windowSize / 2);
        for (let i = 0; i < arr.length; i++) {
            const start = Math.max(0, i - half);
            const end = Math.min(arr.length, i + half + 1);
            let sum = 0;
            for (let j = start; j < end; j++) sum += arr[j];
            result.push(sum / (end - start));
        }
        return result;
    }

    _findSpeechEdge(times, energies, threshold, startIdx, direction) {
        let i = startIdx;
        while (i >= 0 && i < energies.length) {
            if (energies[i] < threshold) break;
            i += direction;
        }
        const edgeIdx = Math.max(0, Math.min(times.length - 1, i - (direction * 1)));
        return times[edgeIdx];
    }
}
