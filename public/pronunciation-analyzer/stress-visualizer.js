import { STRESS_WEIGHTS, calculateStressScore } from './stress-utils.js';
import {
    buildComparisonChartData,
    buildDurationLanes,
    buildNativeOnlyChartData,
    canShowDetailedFeedback,
    formatRelativePitchTooltip
} from './chart-data.js';

const ALIGNMENT_CONFIG = {
    PITCH_THRESHOLD: 75,        // Minimum Hz to consider as "speech" (Praat Standard)
    MIN_CONSECUTIVE_FRAMES: 3,  // Require consecutive frames to avoid noise
    INTENSITY_THRESHOLD: 40     // Alternative: use intensity for onset detection
};

// Finds the index where speech actually begins based on pitch OR intensity
function findSpeechOnsetIndex(pitchValues, intensityValues = [], config = ALIGNMENT_CONFIG) {
    let contiguousFrames = 0;

    // Check pitch first (primary indicator)
    for (let i = 0; i < pitchValues.length; i++) {
        // Check if pitch is valid number and above threshold
        const hasPitch = typeof pitchValues[i] === 'number' &&
            pitchValues[i] > config.PITCH_THRESHOLD;

        // Optional: Check intensity if available
        const hasIntensity = intensityValues.length > i &&
            intensityValues[i] > config.INTENSITY_THRESHOLD;

        if (hasPitch || (hasIntensity && i > 5)) { // Trust intensity more after start
            contiguousFrames++;
            if (contiguousFrames >= config.MIN_CONSECUTIVE_FRAMES) {
                return Math.max(0, i - config.MIN_CONSECUTIVE_FRAMES);
            }
        } else {
            contiguousFrames = 0;
        }
    }

    return 0; // Fallback to start
}

// Adjusts syllable start/end times based on alignment offset
function adjustSyllableTimes(syllables, onsetTime) {
    if (!syllables) return [];
    return syllables.map(s => ({
        ...s,
        startTime: Math.max(0, s.startTime - onsetTime),
        endTime: Math.max(0, s.endTime - onsetTime)
    }));
}

// Aligns native and user analysis data based on speech onset
function alignAnalysisData(nativeAnalysis, userAnalysis) {
    // 1. Find onset indices
    const nStartIdx = findSpeechOnsetIndex(nativeAnalysis.pitch.values, nativeAnalysis.intensity?.values);
    const uStartIdx = findSpeechOnsetIndex(userAnalysis.pitch.values, userAnalysis.intensity?.values);

    const nStartTime = nativeAnalysis.pitch.times[nStartIdx] || 0;
    const uStartTime = userAnalysis.pitch.times[uStartIdx] || 0;

    // 2. Create shift function
    // We want to shift everything so speech starts at t=0 for BOTH
    // But for the chart, we keep the Native timescale as "Reference" and shift User to match

    // Actually, simpler approach: Normalize BOTH to start at 0.0s for comparison
    const timeShift = uStartTime - nStartTime; // Difference to shift user

    // Return aligned data structures (copies)
    // We only need to shift the USER data to match Native's absolute time if we plot them together
    // OR we shift both to 0. 

    // Let's return new objects for plotting
    return {
        native: nativeAnalysis, // Keep native as is (or shift if needed)
        user: {
            ...userAnalysis,
            alignmentOffset: timeShift, // Store for debug
            pitch: {
                // Shift times so user speech lines up with native speech
                times: userAnalysis.pitch.times.map(t => t - timeShift),
                values: userAnalysis.pitch.values
            },
            syllables: adjustSyllableTimes(userAnalysis.syllables, timeShift) // Simplified override
        },
        metadata: {
            nativeOnset: nStartTime,
            userOnset: uStartTime,
            shiftApplied: timeShift
        }
    };
}

// Interpolates native data to match user's time points
function prepareChartData(nativeTimes, nativeValues, targetTimes) {
    // Linear interpolation
    return targetTimes.map(t => {
        // Find surrounding points
        const idx = nativeTimes.findIndex(nt => nt >= t);
        if (idx === -1) return null; // Past end
        if (idx === 0) return nativeValues[0]; // Before start

        const t1 = nativeTimes[idx - 1];
        const t2 = nativeTimes[idx];
        const v1 = nativeValues[idx - 1];
        const v2 = nativeValues[idx];

        if (typeof v1 !== 'number' || typeof v2 !== 'number') return null; // Gap

        // Interpolate
        const ratio = (t - t1) / (t2 - t1);
        return v1 + (v2 - v1) * ratio;
    });
}

class StressVisualizer {
    constructor(pitchCanvasId, stressCanvasId, onPlaySyllable = null) {
        this.pitchCanvas = document.getElementById(pitchCanvasId);
        this.stressCanvas = document.getElementById(stressCanvasId);
        this.pitchChart = null;
        this.stressChart = null;
        this.nativeAnalysis = null;
        this.timelineContainer = document.getElementById('pa-timeline-container');
        this.onPlaySyllable = onPlaySyllable;

        this.comparisonChartMode = 'pitch'; // 'pitch' or 'intensity'
        this.lastUserAnalysis = null;
        this.lastLearnerSyllables = null;
        this.lastNativeAnalysis = null;
        this.lastReferenceSyllables = null;
        this.initChartModeToggle();
    }

    initChartModeToggle() {
        const container = document.getElementById('pa-chart-mode-toggle');
        if (!container) return;
        const buttons = container.querySelectorAll('.pa-chart-toggle-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.comparisonChartMode = btn.dataset.mode;
                if (this.lastUserAnalysis && this.lastNativeAnalysis) {
                    this.drawComparisonPitchContour(
                        this.lastUserAnalysis,
                        this.lastNativeAnalysis,
                        this.lastReferenceSyllables,
                        {
                            learnerSyllables: this.lastLearnerSyllables,
                            drawDuration: false
                        }
                    );
                } else if (this.lastNativeAnalysis) {
                    this.drawNativePitchContour(
                        this.lastNativeAnalysis,
                        this.lastAcousticSyllables || [],
                        this.lastReferenceSyllables || []
                    );
                }
            });
        });
    }

    clear() {
        if (this.pitchChart) {
            this.pitchChart.destroy();
            this.pitchChart = null;
        }
        if (this.stressChart) {
            this.stressChart.destroy();
            this.stressChart = null;
        }
        this.lastUserAnalysis = null;
        this.lastLearnerSyllables = null;
        this.lastNativeAnalysis = null;
        this.lastReferenceSyllables = null;
        this.lastAcousticSyllables = null;
        this.toggleFeedbackSection(false);
    }

    destroy() {
        this.clear();
        this.pitchCanvas = null;
        this.stressCanvas = null;
    }

    drawPitchContour(times, pitches, energies, syllables = []) {
        if (this.pitchChart) {
            this.pitchChart.destroy();
            this.pitchChart = null;
        }

        // 1. Trim timeframe to speech + padding (0.1s)
        let startIndex = 0;
        let endIndex = times.length - 1;

        if (syllables.length > 0) {
            const startT = Math.max(0, syllables[0].startTime - 0.1);
            const endT = syllables[syllables.length - 1].endTime + 0.1;

            // Find indices close to these times
            startIndex = times.findIndex(t => t >= startT);
            if (startIndex === -1) startIndex = 0;

            // Find end index
            for (let i = times.length - 1; i >= 0; i--) {
                if (times[i] <= endT) {
                    endIndex = i;
                    break;
                }
            }
        }

        // Slice data
        const slicedTimes = times.slice(startIndex, endIndex + 1);
        const slicedPitches = pitches.slice(startIndex, endIndex + 1);
        const slicedEnergies = energies.slice(startIndex, endIndex + 1);

        // Normalize energy to overlay on pitch scale
        // Handle both RMS (0-1) and dB (40-90+) scales
        const maxPitch = Math.max(...slicedPitches.filter(p => p !== null)) || 200;
        const maxEnergy = Math.max(...slicedEnergies) || 1;

        // Determine if we are using dB scale (Praat) or RMS (0-1)
        const isDbScale = maxEnergy > 10;

        const showPitch = this.comparisonChartMode === 'pitch';
        const showIntensity = this.comparisonChartMode === 'intensity';

        const datasets = [];
        if (showPitch) {
            datasets.push({
                label: 'Pitch (Hz)',
                data: slicedTimes.map((t, i) => ({ x: t, y: slicedPitches[i] })),
                borderColor: 'rgb(54, 162, 235)',
                yAxisID: 'y',
                spanGaps: true,
                tension: 0.4,
                pointRadius: 0,
                showLine: true
            });
        }
        if (showIntensity) {
            datasets.push({
                label: isDbScale ? 'Intensity (dB)' : 'Energy (RMS)',
                data: slicedTimes.map((t, i) => ({ x: t, y: slicedEnergies[i] })),
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                borderColor: 'rgba(255, 99, 132, 0.5)',
                fill: true,
                yAxisID: 'y1',
                pointRadius: 0,
                borderWidth: 1,
                showLine: true
            });
        }

        const scales = {
            x: {
                title: { display: true, text: 'Time (s)' },
                ticks: { maxTicksLimit: 8 }
            }
        };

        if (showPitch) {
            scales.y = {
                type: 'linear',
                display: true,
                position: 'left',
                beginAtZero: true,
                suggestedMax: 350,
                title: { display: true, text: 'Pitch (Hz)' }
            };
        }
        if (showIntensity) {
            scales.y1 = {
                type: 'linear',
                display: true,
                position: 'left',
                min: isDbScale ? 40 : 0,
                max: isDbScale ? 100 : 1,
                title: { display: true, text: isDbScale ? 'Intensity (dB)' : 'Energy' }
            };
        }

        this.pitchChart = new Chart(this.pitchCanvas, {
            type: 'scatter',
            data: { datasets },
            plugins: [],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    title: { display: true, text: showPitch ? 'Pitch Contour' : 'Intensity Contour' },
                    tooltip: { enabled: true }
                },
                scales
            }
        });
    }

    /**
     * Draw duration comparison chart (horizontal bars)
     * Matches the reference image style: Native (Green border), User (Blue solid)
     */
    drawDurationChart(nativeSyllables, userSyllables) {
        if (this.stressChart) this.stressChart.destroy();
        const durationCard = this.stressCanvas?.closest('.pa-chart-card');
        if (durationCard) durationCard.hidden = false;
        const hasUserSyllables = Array.isArray(userSyllables) && userSyllables.length > 0;
        const lanes = buildDurationLanes(nativeSyllables, userSyllables);

        let labels = [];
        let datasets = [];

        if (hasUserSyllables) {
            labels = [
                ...lanes.target.labels.map((label) => 'Target: ' + label),
                ...lanes.observed.labels
            ];
            const targetData = [
                ...lanes.target.durations,
                ...lanes.observed.durations.map(() => null)
            ];
            const observedData = [
                ...lanes.target.durations.map(() => null),
                ...lanes.observed.durations
            ];
            datasets = [
                {
                    label: 'Target duration',
                    data: targetData,
                    backgroundColor: 'rgba(34, 197, 94, 0.8)',
                    borderColor: 'rgb(34, 197, 94)',
                    borderWidth: 1
                },
                {
                    label: 'Observed duration',
                    data: observedData,
                    backgroundColor: 'rgba(59, 130, 246, 0.8)',
                    borderColor: 'rgb(59, 130, 246)',
                    borderWidth: 1
                }
            ];
        } else {
            labels = lanes.target.labels;
            datasets = [
                {
                    label: 'Target duration',
                    data: lanes.target.durations,
                    backgroundColor: 'rgba(34, 197, 94, 0.8)',
                    borderColor: 'rgb(34, 197, 94)',
                    borderWidth: 1
                }
            ];
        }

        this.stressChart = new Chart(this.stressCanvas, {
            type: 'bar',
            data: {
                labels,
                datasets
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: hasUserSyllables
                            ? (lanes.countsMatch ? 'Target and observed duration' : 'Target and observed counts differ')
                            : 'Target Syllable Durations'
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => (
                                context.dataset.label + ': ' +
                                Number(context.parsed.x).toFixed(3) + ' s'
                            )
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        title: { display: true, text: 'Duration (seconds)' }
                    }
                }
            }
        });
    }

    drawDurationChartLegacy(nativeSyllables, userSyllables) {
        if (this.stressChart) {
            this.stressChart.destroy();
            this.stressChart = null;
        }

        const maxSyls = Math.max(nativeSyllables?.length || 0, userSyllables?.length || 0);
        if (maxSyls === 0) return;

        const labels = Array.from({ length: maxSyls }, (_, i) => `Syl ${i + 1}`);

        // Data processing - extract durations
        const nativeData = nativeSyllables?.map(s => s.duration) || [];
        const userData = userSyllables?.map(s => s.duration) || [];

        // Plugin to draw value labels at the end of bars
        const durationValuePlugin = {
            id: 'durationValues',
            afterDatasetsDraw: (chart) => {
                const { ctx } = chart;
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    ctx.save();
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.font = 'bold 11px sans-serif';
                    ctx.fillStyle = dataset.borderColor || '#374151';

                    meta.data.forEach((bar, index) => {
                        const value = dataset.data[index];
                        if (value === undefined || value === null) return;

                        // Reference image shows labels next to bars
                        // Use bar.x (end of horizontal bar) + margin
                        const x = bar.x + 5;
                        const y = bar.y;
                        ctx.fillText(`${value.toFixed(2)}s`, x, y);
                    });
                    ctx.restore();
                });
            }
        };

        this.stressChart = new Chart(this.stressCanvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Native Reference',
                        data: nativeData,
                        backgroundColor: 'rgba(34, 197, 94, 0.8)', // Solid green
                        borderColor: 'rgb(34, 197, 94)',
                        borderWidth: 2,
                        borderRadius: 2,
                        barPercentage: 0.4,
                        categoryPercentage: 0.8
                    },
                    {
                        label: 'Your Duration',
                        data: userData,
                        backgroundColor: 'rgba(59, 130, 246, 0.8)', // Solid blue
                        borderColor: 'rgb(59, 130, 246)',
                        borderWidth: 1,
                        borderRadius: 2,
                        barPercentage: 0.4,
                        categoryPercentage: 0.8
                    }
                ]
            },
            plugins: [durationValuePlugin],
            options: {
                indexAxis: 'y', // Makes it horizontal
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { boxWidth: 12, font: { size: 11 } }
                    },
                    tooltip: {
                        enabled: true,
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(2)}s`
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        title: { display: true, text: 'Duration (seconds)', font: { weight: 'bold' } },
                        // Add some padding for the labels
                        suggestedMax: Math.max(...nativeData, ...userData, 0.1) * 1.2
                    },
                    y: {
                        ticks: { font: { weight: 'bold' } }
                    }
                }
            }
        });
    }

    /**
     * Normalize analysis data to start from time 0.0
     * Shifts all times so that the first syllable starts at 0
     */
    normalizeToZero(analysis) {
        if (!analysis || !analysis.syllables || analysis.syllables.length === 0) {
            return analysis;
        }

        // Find the start time of the first syllable
        const speechStartTime = analysis.syllables[0].startTime;

        if (speechStartTime === 0) {
            return analysis; // Already normalized
        }

        // Create a new normalized copy
        const normalized = {
            ...analysis,
            duration: analysis.duration,

            // Shift pitch times
            pitch: {
                times: analysis.pitch.times.map(t => t - speechStartTime),
                values: [...analysis.pitch.values]
            },

            // Shift intensity times
            intensity: {
                times: (analysis.intensity?.times || []).map(t => t - speechStartTime),
                values: [...(analysis.intensity?.values || [])]
            },

            // Shift syllable times
            syllables: analysis.syllables.map(syl => ({
                ...syl,
                startTime: Math.max(0, syl.startTime - speechStartTime),
                endTime: syl.endTime - speechStartTime
            }))
        };

        return normalized;
    }

    /**
     * Trim data to only include the speech region (removes silence before/after)
     */
    trimToSpeechRegion(analysis, padding = 0.02) {
        if (!analysis || !analysis.syllables || analysis.syllables.length === 0) {
            return analysis;
        }

        const firstSylStart = analysis.syllables[0].startTime;
        const lastSylEnd = analysis.syllables[analysis.syllables.length - 1].endTime;

        const trimStart = Math.max(0, firstSylStart - padding);
        const trimEnd = lastSylEnd + padding;

        // Find indices for trimming
        const startIdx = analysis.pitch.times.findIndex(t => t >= trimStart);
        let endIdx = analysis.pitch.times.findIndex(t => t > trimEnd);

        const actualEndIdx = endIdx === -1 ? analysis.pitch.times.length : endIdx;

        // Also trim intensity if possible (assuming similar sampling)
        const intensityValues = analysis.intensity?.values || [];
        const intensityTimes = analysis.intensity?.times || [];

        let iStartIdx = startIdx;
        let iEndIdx = actualEndIdx;

        if (intensityTimes.length > 0) {
            iStartIdx = intensityTimes.findIndex(t => t >= trimStart);
            let iEnd = intensityTimes.findIndex(t => t > trimEnd);
            iEndIdx = iEnd === -1 ? intensityTimes.length : iEnd;
        }

        return {
            ...analysis,
            pitch: {
                times: analysis.pitch.times.slice(startIdx, actualEndIdx),
                values: analysis.pitch.values.slice(startIdx, actualEndIdx)
            },
            intensity: {
                times: intensityTimes.slice(iStartIdx, iEndIdx),
                values: intensityValues.slice(iStartIdx, iEndIdx)
            },
            syllables: analysis.syllables // Keep syllables as-is (they define the region)
        };
    }

    /**
     * Draw native pitch contour only (before user records)
     * Also normalized to start at 0
     */
    drawNativePitchContour(nativeAnalysis, acousticSyllables = [], referenceSyllables = []) {
        if (!nativeAnalysis?.pitch) return;
        this.lastNativeAnalysis = nativeAnalysis;
        this.lastAcousticSyllables = acousticSyllables;
        this.lastReferenceSyllables = referenceSyllables;

        if (this.pitchChart) this.pitchChart.destroy();
        const chartData = buildNativeOnlyChartData(nativeAnalysis);
        const referenceLabel = nativeAnalysis?.graphSource?.label || 'Measured dictionary reference';
        const pitchUnit = nativeAnalysis?.pitch?.unit === 'semitones' ? 'semitones' : 'Hz';

        const showPitch = this.comparisonChartMode === 'pitch';
        const showIntensity = this.comparisonChartMode === 'intensity';

        const chartDatasets = [];
        if (showPitch) {
            chartDatasets.push({
                label: `${referenceLabel} pitch (${pitchUnit})`,
                data: chartData.pitch,
                borderColor: 'rgb(34, 197, 94)',
                pointRadius: 0,
                showLine: true,
                spanGaps: true,
                yAxisID: 'y'
            });
        }
        if (showIntensity) {
            chartDatasets.push({
                label: `${referenceLabel} intensity (dB)`,
                data: chartData.intensity,
                borderColor: 'rgba(244, 114, 182, 0.8)',
                pointRadius: 0,
                showLine: true,
                spanGaps: true,
                yAxisID: 'y1'
            });
        }

        const chartScales = {
            x: { title: { display: true, text: 'Time (s)' } }
        };

        if (showPitch) {
            chartScales.y = {
                position: 'left',
                title: { display: true, text: chartData.pitchAxisLabel }
            };
        }
        if (showIntensity) {
            chartScales.y1 = {
                position: 'left',
                title: { display: true, text: chartData.intensityAxisLabel },
                grid: { drawOnChartArea: true }
            };
        }

        this.pitchChart = new Chart(this.pitchCanvas, {
            type: 'scatter',
            data: {
                datasets: chartDatasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: showPitch ? `${referenceLabel} pitch contour` : `${referenceLabel} intensity contour` },
                    tooltip: {
                        callbacks: {
                            label: (context) => (
                                context.dataset.yAxisID === 'y'
                                    ? context.dataset.label + ': ' + Number(context.parsed.y).toFixed(pitchUnit === 'Hz' ? 0 : 1) + ' ' + pitchUnit
                                    : context.dataset.label + ': ' + Number(context.parsed.y).toFixed(1) + ' dB'
                            )
                        }
                    }
                },
                scales: chartScales
            }
        });

        const targetDurations = acousticSyllables.map((syllable, index) => ({
            ...syllable,
            ipa: referenceSyllables[index]?.ipa || null
        }));
        if (targetDurations.length > 0) {
            this.drawDurationChart(targetDurations, []);
        } else {
            if (this.stressChart) {
                this.stressChart.destroy();
                this.stressChart = null;
            }
            const durationCard = this.stressCanvas?.closest('.pa-chart-card');
            if (durationCard) durationCard.hidden = true;
        }
    }

    drawNativePitchContourLegacy(nativeAnalysis, syllables = []) {
        if (!nativeAnalysis || !nativeAnalysis.pitch) {
            return;
        }

        this.nativeAnalysis = nativeAnalysis;

        if (this.pitchChart) {
            this.pitchChart.destroy();
        }

        // Trim and normalize native data
        let normalized = this.trimToSpeechRegion(nativeAnalysis);
        normalized = this.normalizeToZero(normalized);

        const times = normalized.pitch.times;
        const pitches = normalized.pitch.values;
        const intensities = normalized.intensity?.values || [];
        const normalizedSyllables = normalized.syllables;

        // Normalize intensity for display
        const maxPitch = Math.max(...pitches.filter(p => typeof p === 'number')) || 200;
        const maxIntensity = Math.max(...intensities) || 1;
        const normalizedIntensities = intensities.map(i =>
            (typeof i === 'number' && maxIntensity > 0) ? (i / maxIntensity) * maxPitch * 0.5 : 0
        );

        const maxTime = times[times.length - 1] || 1;
        const chartMaxTime = Math.ceil(maxTime * 10) / 10 + 0.05;

        this.pitchChart = new Chart(this.pitchCanvas, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Native Pitch (Hz)',
                        data: times.map((t, i) => ({ x: t, y: pitches[i] })),
                        borderColor: 'rgb(34, 197, 94)',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        borderWidth: 2.5,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        spanGaps: true,
                        showLine: true
                    },
                    {
                        label: 'Native Volume',
                        data: (normalized.intensity?.times || []).map((t, i) => ({
                            x: t,
                            y: normalizedIntensities[i]
                        })),
                        borderColor: 'rgba(34, 197, 94, 0.4)',
                        backgroundColor: 'rgba(34, 197, 94, 0.15)',
                        fill: true,
                        borderWidth: 1,
                        tension: 0.1, // Low tension for intensity
                        pointRadius: 0,
                        showLine: true
                    }
                ]
            },
            plugins: [],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '🎯 Native Speaker - Pitch & Volume',
                        font: { size: 13 }
                    },
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, padding: 8 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const label = ctx.dataset.label || '';
                                const value = ctx.parsed.y;
                                if (value === null) return `${label}: -`;
                                return `${label}: ${Math.round(value)} Hz`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        title: { display: true, text: 'Time (s)' },
                        min: 0,
                        max: chartMaxTime,
                        ticks: {
                            stepSize: 0.1,
                            callback: (value) => value.toFixed(1)
                        }
                    },
                    y: {
                        beginAtZero: true,
                        min: 0,
                        suggestedMax: 350,
                        title: { display: true, text: 'Pitch (Hz)' }
                    }
                }
            }
        });

        // Draw duration reference
        this.drawDurationChart(normalizedSyllables, []);
    }

    /**
     * Draw comparison pitch contour with both native and user normalized to start at 0
     * Replaces previous alignAnalysisData logic with normalizeToZero + scatter chart
     */
    drawComparisonPitchContour(
        userAnalysis,
        nativeAnalysis = null,
        referenceSyllables = [],
        options = {}
    ) {
        const {
            drawDuration = true,
            learnerSyllables: requestedLearnerSyllables = null
        } = options || {};
        const analysisSyllables = userAnalysis?.observed?.syllables;
        const resolvedLearnerSyllables = Array.isArray(requestedLearnerSyllables)
            ? requestedLearnerSyllables
            : Array.isArray(analysisSyllables)
                ? analysisSyllables
                : (Array.isArray(userAnalysis?.observed_syllables)
                    ? userAnalysis.observed_syllables
                    : (Array.isArray(userAnalysis?.syllables) ? userAnalysis.syllables : []));
        this.lastUserAnalysis = userAnalysis;
        this.lastLearnerSyllables = resolvedLearnerSyllables;
        this.lastNativeAnalysis = nativeAnalysis;
        this.lastReferenceSyllables = referenceSyllables;

        if (!nativeAnalysis || !userAnalysis) {
            this.drawPitchContour(
                userAnalysis?.pitch?.times || [],
                userAnalysis?.pitch?.values || [],
                userAnalysis?.intensity?.values || [],
                resolvedLearnerSyllables
            );
            return;
        }
        if (this.pitchChart) this.pitchChart.destroy();
        const chartData = buildComparisonChartData(nativeAnalysis, userAnalysis);
        const referenceLabel = nativeAnalysis?.graphSource?.label || 'Measured dictionary reference';
        const dataset = (label, data, color, axis, dashed = false) => ({
            label,
            data,
            borderColor: color,
            borderDash: dashed ? [6, 4] : [],
            pointRadius: 0,
            showLine: true,
            spanGaps: true,
            yAxisID: axis
        });

        let datasets = [];
        let yScales = {};

        if (this.comparisonChartMode === 'pitch') {
            datasets = [
                dataset(`${referenceLabel} relative pitch`, chartData.native.pitch, 'rgb(99, 102, 241)', 'y', true),
                dataset('Your relative pitch', chartData.learner.pitch, 'rgb(34, 197, 94)', 'y')
            ];
            yScales = {
                x: { title: { display: true, text: 'Time (s)' } },
                y: {
                    position: 'left',
                    title: { display: true, text: chartData.pitchAxisLabel }
                }
            };
        } else {
            datasets = [
                dataset(`${referenceLabel} relative intensity`, chartData.native.intensity, 'rgb(99, 102, 241)', 'y', true),
                dataset('Your relative intensity', chartData.learner.intensity, 'rgb(244, 114, 182)', 'y')
            ];
            yScales = {
                x: { title: { display: true, text: 'Time (s)' } },
                y: {
                    position: 'left',
                    title: { display: true, text: chartData.intensityAxisLabel }
                }
            };
        }

        this.pitchChart = new Chart(this.pitchCanvas, {
            type: 'scatter',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: 'Your recording compared with the reference pattern' },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const point = context.raw;
                                if (this.comparisonChartMode === 'pitch') {
                                    return context.dataset.label + ': ' + formatRelativePitchTooltip(point);
                                }
                                if (point?.y === null) return context.dataset.label + ': no voiced intensity';
                                return (
                                    context.dataset.label + ': ' +
                                    Number(point.y).toFixed(1) + ' dB relative · ' +
                                    Number(point.rawDb).toFixed(1) + ' dB'
                                );
                            }
                        }
                    }
                },
                scales: yScales
            }
        });

        const nativeSyllables = nativeAnalysis?.observed?.syllables || [];
        const targetDurations = nativeSyllables.map((syllable, index) => ({
            ...syllable,
            ipa: referenceSyllables[index]?.ipa || null,
            isStressed: referenceSyllables[index]?.stress === 'primary'
        }));
        if (drawDuration) this.drawDurationChart(targetDurations, resolvedLearnerSyllables);

        const detailed = canShowDetailedFeedback({
            targetCount: referenceSyllables.length || nativeSyllables.length,
            observedCount: resolvedLearnerSyllables.length,
            nativeQuality: nativeAnalysis.quality,
            learnerQuality: userAnalysis.quality,
            nativeStressEvidence: nativeAnalysis?.observed?.stressEvidence,
            learnerStressEvidence: userAnalysis?.observed?.stressEvidence
        });
        if (detailed) {
            this.generateFeedback(targetDurations, resolvedLearnerSyllables, nativeSyllables);
        } else {
            this.toggleFeedbackSection(false);
        }
    }

    drawComparisonPitchContourLegacy(userAnalysis, nativeAnalysis = null) {
        const native = nativeAnalysis || this.nativeAnalysis;

        if (this.pitchChart) {
            this.pitchChart.destroy();
        }

        const datasets = [];
        let maxTime = 0;
        let maxIntensity = 1;

        // ========================================
        // NORMALIZE NATIVE DATA
        // ========================================
        let normalizedNative = null;
        if (native && native.pitch && native.syllables?.length > 0) {
            // Trim to speech region, then normalize to start at 0
            normalizedNative = this.trimToSpeechRegion(native);
            normalizedNative = this.normalizeToZero(normalizedNative);

            const nativeTimes = normalizedNative.pitch.times;
            const nativePitches = normalizedNative.pitch.values;

            maxTime = Math.max(maxTime, nativeTimes[nativeTimes.length - 1] || 0);

            datasets.push({
                label: 'Native Pitch (reference)',
                data: nativeTimes.map((t, i) => ({
                    x: parseFloat(t.toFixed(2)),
                    y: nativePitches[i]
                })),
                borderColor: 'rgba(34, 197, 94, 0.7)',
                backgroundColor: 'rgba(34, 197, 94, 0.05)',
                borderWidth: 2.5,
                borderDash: [6, 4],
                tension: 0.3,
                pointRadius: 0, // Hidden by default
                pointHoverRadius: 4,
                pointStyle: 'rectRot',
                spanGaps: true,
                xAxisID: 'x',
                yAxisID: 'y',
                parsing: { xAxisKey: 'x', yAxisKey: 'y' },
                showLine: true
            });
        }

        // ========================================
        // NORMALIZE USER DATA & ALIGN PITCH
        // ========================================
        let normalizedUser = null;
        let userSyllables = [];

        if (userAnalysis && userAnalysis.pitch && userAnalysis.syllables?.length > 0) {
            // Trim to speech region, then normalize to start at 0
            normalizedUser = this.trimToSpeechRegion(userAnalysis);
            normalizedUser = this.normalizeToZero(normalizedUser);

            userSyllables = normalizedUser.syllables;

            const userTimes = normalizedUser.pitch.times;
            const originalUserPitches = normalizedUser.pitch.values;
            const userIntensities = normalizedUser.intensity?.values || [];

            maxTime = Math.max(maxTime, userTimes[userTimes.length - 1] || 0);

            // --- PITCH ALIGNMENT LOGIC ---
            // Calculate mean pitch for Native and User to align ranges
            const getMeanPitch = (values) => {
                const valid = values.filter(v => typeof v === 'number' && v > 0);
                if (valid.length === 0) return 0;
                return valid.reduce((a, b) => a + b, 0) / valid.length;
            };

            // Get valid native pitches from the dataset prepared above, or raw data
            const nativeValidPitches = (normalizedNative?.pitch.values || []).filter(p => typeof p === 'number' && p > 0);
            const userValidPitches = originalUserPitches.filter(p => typeof p === 'number' && p > 0);

            let pitchShift = 0;
            // Only align if we have data for both
            if (nativeValidPitches.length > 0 && userValidPitches.length > 0) {
                const nativeMean = getMeanPitch(normalizedNative.pitch.values);
                const userMean = getMeanPitch(originalUserPitches);
                pitchShift = nativeMean - userMean;
            }

            // Apply shift to user pitches for visualization
            const alignedUserPitches = originalUserPitches.map(p => {
                if (typeof p !== 'number' || p <= 0) return null;
                return p + pitchShift;
            });
            // -----------------------------

            // Normalize intensity for display (Handle dB vs RMS)
            const maxPitch = Math.max(...originalUserPitches.filter(p => typeof p === 'number')) || 200;
            maxIntensity = Math.max(...userIntensities) || 1;
            const isDbScale = maxIntensity > 10;

            const normalizedIntensities = userIntensities.map(i => {
                if (typeof i !== 'number') return 0;
                return i;
            });

            datasets.push({
                label: pitchShift !== 0 ? 'Your Pitch (Aligned)' : 'Your Pitch (Hz)',
                data: userTimes.map((t, i) => ({
                    x: parseFloat(t.toFixed(2)),
                    y: alignedUserPitches[i] // Use aligned values
                })),
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2.5,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointStyle: 'circle',
                spanGaps: true,
                xAxisID: 'x',
                yAxisID: 'y',
                parsing: { xAxisKey: 'x', yAxisKey: 'y' }
            });

            const userIntTimes = normalizedUser.intensity?.times || [];

            datasets.push({
                label: 'Your Volume',
                data: userIntTimes.map((t, i) => ({
                    x: parseFloat(t.toFixed(2)),
                    y: normalizedIntensities[i]
                })),
                borderColor: 'rgba(244, 114, 182, 0.3)',
                backgroundColor: 'rgba(244, 114, 182, 0.15)',
                fill: true,
                borderWidth: 1,
                tension: 0.1,
                pointRadius: 0,
                xAxisID: 'x',
                yAxisID: 'y1',
                parsing: { xAxisKey: 'x', yAxisKey: 'y' },
                showLine: true
            });
        }


        // ========================================
        // CREATE CHART
        // ========================================

        this.pitchChart = new Chart(this.pitchCanvas, {
            type: 'scatter',  // Correct type, declared once
            data: { datasets },
            plugins: [], // Plugin removed
            options: {
                responsive: true,
                maintainAspectRatio: false,
                showLine: true,
                plugins: {
                    title: {
                        display: true,
                        text: '📊 Your Recording vs Native (dashed green)',
                        font: { size: 13 }
                    },
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 15, padding: 10, font: { size: 11 } }
                    },
                    tooltip: {
                        enabled: true,
                        callbacks: {
                            label: (ctx) => {
                                const label = ctx.dataset.label || '';
                                const value = ctx.parsed.y;
                                if (value === null) return `${label}: -`;
                                if (ctx.dataset.yAxisID === 'y1') {
                                    return `${label}: ${value.toFixed(1)}`;
                                }
                                return `${label}: ${Math.round(value)} Hz`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        title: { display: true, text: 'Time (s)' },
                        min: 0,
                        max: Math.ceil(maxTime * 10) / 10 + 0.05,
                        ticks: {
                            stepSize: 0.1,
                            callback: (value) => value.toFixed(1)
                        }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Pitch (Hz)' },
                        suggestedMax: 350,
                        position: 'left'
                    },
                    y1: {
                        beginAtZero: true,
                        min: 0,
                        title: { display: true, text: 'Volume' },
                        position: 'right',
                        grid: {
                            drawOnChartArea: false // Prevent grid line overlap
                        },
                        suggestedMax: maxIntensity > 1 ? maxIntensity * 1.2 : 100
                    }
                }
            }
        });


        // Generate detailed feedback
        const feedbackNativePattern = (native && native.pitch_pattern) ? native.pitch_pattern : (native && native.syllables ? native.syllables : []);
        const feedbackPlaybackSyllables = native?.syllables || [];
        this.generateFeedback(feedbackNativePattern, userSyllables, feedbackPlaybackSyllables);

        // Draw duration comparison chart
        this.drawDurationChart(normalizedNative?.syllables || [], userSyllables);
    }


    /**
     * Show/Hide feedback section
     */
    toggleFeedbackSection(show) {
        const section = document.getElementById('pa-feedback-section');
        if (section) section.style.display = show ? 'block' : 'none';
        if (!show) {
            const content = document.getElementById('pa-feedback-content');
            if (content) content.innerHTML = '';
            const tabs = document.getElementById('pa-syllable-tabs');
            if (tabs) tabs.innerHTML = '';
        }
    }

    /**
     * Generate detailed feedback per syllable
     */
    generateFeedback(nativePattern, userSyllables, nativePlaybackSyllables = null) {
        this.toggleFeedbackSection(true);

        const container = document.getElementById('pa-feedback-content');
        const tabContainer = document.getElementById('pa-syllable-tabs');
        if (!container || !tabContainer) return;

        // Clear previous
        container.innerHTML = '';
        tabContainer.innerHTML = '';

        // Calculate relative values for scaling comparison (0-100)
        const userMaxPitch = Math.max(...userSyllables.map(s => s.maxPitch || 0)) || 1;
        const userMaxDur = Math.max(...userSyllables.map(s => s.vowelDuration || s.duration || 0)) || 1;
        const userMaxInt = Math.max(...userSyllables.map(s => s.intensity || s.maxEnergy || 0)) || 1;

        const nativeMaxPitch = Math.max(...nativePattern.map(s => s.maxPitch || s.pitch || 0)) || 1;
        const nativeMaxDur = Math.max(...nativePattern.map(s => s.duration || s.vowelDuration || 0)) || 1;
        const nativeMaxInt = Math.max(...nativePattern.map(s => s.intensity || 0)) || 1;

        // Generate Tabs
        nativePattern.forEach((_, i) => {
            const tab = document.createElement('div');
            tab.className = `pa-syl-tab ${i === 0 ? 'active' : ''}`;
            tab.textContent = `Syllable ${i + 1}`;
            tab.onclick = () => this.switchFeedbackTab(i);
            tabContainer.appendChild(tab);
        });

        // Generate Feedback Cards (hidden by default except first)
        nativePattern.forEach((nativeSyl, i) => {
            const userSyl = userSyllables[i];
            const playbackSyl = nativePlaybackSyllables?.[i] || nativeSyl;
            if (!userSyl) return;

            const card = document.createElement('div');
            card.className = 'pa-feedback-card';
            card.id = `pa-feedback-syl-${i}`;
            card.style.display = i === 0 ? 'block' : 'none';

            const isStressed = nativeSyl.isStressed;
            const stressLabel = isStressed ? `<span class="pa-highlight-syl">Primary Stress</span>` : "Unstressed";

            // --- 1. Pitch Pattern ---
            const uPitchRel = (userSyl.maxPitch / userMaxPitch) * 100;
            const nPitchRel = nativeSyl.relativePitch || ((nativeSyl.maxPitch || nativeSyl.pitch || 0) / nativeMaxPitch) * 100;
            const pitchMsgStat = `(You: ${Math.round(uPitchRel)}%, Target: ${Math.round(nPitchRel)}%)`;

            let pitchMsg = `Good pitch matching! ${pitchMsgStat}`;
            let pitchClass = "good";

            if (uPitchRel > nPitchRel + 20) {
                pitchMsg = `Pitch too high relative to the rest of the word. ${pitchMsgStat} Try lowering your voice for this syllable.`;
                pitchClass = "warn";
            } else if (uPitchRel < nPitchRel - 20) {
                pitchMsg = `Pitch too low. ${pitchMsgStat} Try raising your pitch to match the intonation.`;
                pitchClass = "warn";
            }

            // --- 2. Duration (Timing) ---
            const uDurVal = userSyl.vowelDuration || userSyl.duration || 0;
            const nDurVal = nativeSyl.vowelDuration || nativeSyl.duration || 0;

            const uDurRel = (uDurVal / userMaxDur) * 100;
            const nDurRel = nativeSyl.relativeDuration || (nDurVal / (nativeMaxDur || 1)) * 100;
            const durMsgStat = `(You: ${uDurVal.toFixed(2)}s, Target: ${nDurVal.toFixed(2)}s)`;

            let durMsg = `Timing matches well. ${durMsgStat}`;
            let durClass = "good";

            if (uDurRel > nDurRel + 20) {
                durMsg = `Too long. ${durMsgStat} Try to shorten the vowel sound here.`;
                durClass = "warn";
            } else if (uDurRel < nDurRel - 20) {
                durMsg = `Too fast. ${durMsgStat} Don't rush - give the vowel more time.`;
                durClass = "warn";
            }

            // --- 3. Volume (Intensity) ---
            const uIntVal = userSyl.intensity || userSyl.maxEnergy || 0;
            const nIntVal = nativeSyl.intensity || 0;

            const uIntRel = (uIntVal / userMaxInt) * 100;
            const nIntRel = nativeSyl.relativeIntensity || (nIntVal / (nativeMaxInt || 1)) * 100;
            const intMsgStat = `(You: ${Math.round(uIntRel)}%, Target: ${Math.round(nIntRel)}%)`;

            let intMsg = `Volume is balanced. ${intMsgStat}`;
            let intClass = "good";

            if (uIntRel > nIntRel + 25) {
                intMsg = `Too loud relative to other syllables. ${intMsgStat}`;
                intClass = "warn";
            } else if (uIntRel < nIntRel - 25) {
                intMsg = `Too quiet. ${intMsgStat} This syllable needs more breath/energy.`;
                intClass = "warn";
            }

            card.innerHTML = `
                <div class="pa-feedback-header">
                    <span class="pa-feedback-title">Syllable ${i + 1} Analysis</span>
                    ${this.onPlaySyllable && Number.isFinite(playbackSyl?.startTime) && Number.isFinite(playbackSyl?.endTime) ?
                    `<button class="pa-play-syl-btn" data-start="${playbackSyl.startTime}" data-end="${playbackSyl.endTime}">
                            🔊 Play Syllable
                        </button>` : ''}
                </div>

                <div class="pa-feedback-row">
                    <div class="pa-feedback-icon">🎵</div>
                    <div class="pa-feedback-detail">
                        <span class="pa-feedback-subtitle">Pitch Analysis (${stressLabel})</span>
                        <p class="pa-feedback-text ${pitchClass}">${pitchMsg}</p>
                        <p class="pa-pitch-info">
                            <i class="pa-info-icon">ℹ️</i> 
                            Match % evaluates your <strong>intonation pattern</strong> (melody), not raw Hz frequency.
                        </p>
                    </div>
                </div>
                <div class="pa-feedback-row">
                    <div class="pa-feedback-icon">⏱️</div>
                    <div class="pa-feedback-detail">
                        <span class="pa-feedback-subtitle">Duration (Timing)</span>
                        <p class="pa-feedback-text ${durClass}">${durMsg}</p>
                    </div>
                </div>
                <div class="pa-feedback-row">
                    <div class="pa-feedback-icon">🔊</div>
                    <div class="pa-feedback-detail">
                        <span class="pa-feedback-subtitle">Volume</span>
                        <p class="pa-feedback-text ${intClass}">${intMsg}</p>
                    </div>
                </div>
            `;

            // Attach play handler
            const playBtn = card.querySelector('.pa-play-syl-btn');
            if (playBtn) {
                playBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.onPlaySyllable) {
                        this.onPlaySyllable(playbackSyl.startTime, playbackSyl.endTime);
                    }
                });
            }

            container.appendChild(card);
        });
    }

    /**
     * Switch visible feedback tab
     */
    switchFeedbackTab(index) {
        // Update Tabs
        const tabs = document.querySelectorAll('.pa-syl-tab');
        tabs.forEach((t, i) => {
            if (i === index) t.classList.add('active');
            else t.classList.remove('active');
        });

        // Update Content
        const cards = document.querySelectorAll('.pa-feedback-card');
        cards.forEach((c, i) => {
            c.style.display = i === index ? 'block' : 'none';
        });
    }
}

export { StressVisualizer };
