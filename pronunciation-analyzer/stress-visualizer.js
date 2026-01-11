export class StressVisualizer {
    constructor(pitchCanvasId, stressCanvasId) {
        this.pitchCanvas = document.getElementById(pitchCanvasId);
        this.stressCanvas = document.getElementById(stressCanvasId);
        this.pitchChart = null;
        this.stressChart = null;

        // Store native analysis for overlay comparison after user records
        this.nativeAnalysis = null;
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
        // 2. Prepare background regions for syllables
        // We'll use a Chart.js plugin to draw rectangles behind the chart
        const syllableRegionsPlugin = {
            id: 'syllableRegions',
            beforeDraw: (chart) => {
                if (syllables.length === 0) return;
                const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;

                syllables.forEach((s, i) => {
                    // Start/End mapping logic
                    const sIdx = slicedTimes.findIndex(t => t >= s.startTime);
                    const eIdx = slicedTimes.findIndex(t => t >= s.endTime);

                    if (sIdx === -1) return;
                    const finalSIdx = sIdx;
                    const finalEIdx = eIdx === -1 ? slicedTimes.length - 1 : eIdx;

                    const xStart = x.getPixelForValue(slicedTimes[finalSIdx].toFixed(2));
                    const width = x.getPixelForValue(slicedTimes[finalEIdx].toFixed(2)) - xStart;

                    ctx.fillStyle = i % 2 === 0 ? 'rgba(0, 0, 0, 0.05)' : 'rgba(0, 0, 0, 0.00)';
                    ctx.fillRect(xStart, top, width, bottom - top);

                    // Draw Label
                    ctx.fillStyle = "#666";
                    ctx.font = "10px sans-serif";
                    ctx.fillText(`Syl ${i + 1}`, xStart + 2, top + 10);
                });
            }
        };

        // Determine if we are using dB scale (Praat) or RMS (0-1)
        const isDbScale = maxEnergy > 10;

        // If RMS, we still normalize to overlay on pitch for now, OR we could use dual axis 0-1.
        // Let's use dual axis for both, much cleaner.

        this.pitchChart = new Chart(this.pitchCanvas, {
            type: 'line',
            data: {
                labels: slicedTimes.map(t => t.toFixed(2)),
                datasets: [
                    {
                        label: 'Pitch (Hz)',
                        data: slicedPitches,
                        borderColor: 'rgb(54, 162, 235)',
                        yAxisID: 'y',
                        spanGaps: true,
                        tension: 0.4,
                        pointRadius: 0
                    },
                    {
                        label: isDbScale ? 'Intensity (dB)' : 'Energy (RMS)',
                        data: slicedEnergies,
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        borderColor: 'rgba(255, 99, 132, 0.5)',
                        fill: true,
                        yAxisID: 'y1', // Use secondary axis
                        pointRadius: 0,
                        borderWidth: 1
                    }
                ]
            },
            plugins: [syllableRegionsPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    title: { display: true, text: 'Pitch & Intensity' },
                    tooltip: { enabled: true }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Time (s)' },
                        ticks: { maxTicksLimit: 8 }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        suggestedMax: 350,
                        title: { display: true, text: 'Pitch (Hz)' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        min: isDbScale ? 40 : 0,  // dB typically 40-100, RMS 0-1
                        max: isDbScale ? 100 : 1,
                        grid: {
                            drawOnChartArea: false, // only want the grid lines for one axis to show up
                        },
                        title: { display: true, text: isDbScale ? 'Intensity (dB)' : 'Energy' }
                    }
                }
            }
        });
    }

    drawSyllableStress(syllables) {
        if (this.stressChart) {
            this.stressChart.destroy();
            this.stressChart = null;
        }

        if (syllables.length === 0) return;

        const labels = syllables.map((_, i) => `Syl ${i + 1}`);

        // Find maxes for normalization
        // Support both old (maxEnergy) and new (intensity) property names
        const maxP = Math.max(...syllables.map(s => s.maxPitch)) || 1;
        const maxD = Math.max(...syllables.map(s => s.duration)) || 1;
        const maxE = Math.max(...syllables.map(s => s.intensity || s.maxEnergy || 1)) || 1;

        // Determine stressed syllable (simple heuristic or use one passed in?)
        // Let's re-calculate score locally to highlight
        let stressedIndex = 0;
        let maxScore = -1;
        syllables.forEach((s, i) => {
            const energy = s.intensity || s.maxEnergy || 0;
            const score = (s.maxPitch / maxP) + (s.duration / maxD) + (energy / maxE);
            if (score > maxScore) { maxScore = score; stressedIndex = i; }
        });

        // Datasets
        // We'll show raw values in tooltips, but bar height is relative %
        const dataPitch = syllables.map(s => (s.maxPitch / maxP) * 100);
        const dataDuration = syllables.map(s => (s.duration / maxD) * 100);
        const dataEnergy = syllables.map(s => ((s.intensity || s.maxEnergy || 0) / maxE) * 100);

        this.stressChart = new Chart(this.stressCanvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Pitch',
                        data: dataPitch,
                        backgroundColor: (ctx) => ctx.dataIndex === stressedIndex ? 'rgba(54, 162, 235, 1)' : 'rgba(54, 162, 235, 0.6)',
                    },
                    {
                        label: 'Duration',
                        data: dataDuration,
                        backgroundColor: (ctx) => ctx.dataIndex === stressedIndex ? 'rgba(255, 206, 86, 1)' : 'rgba(255, 206, 86, 0.6)',
                    },
                    {
                        label: 'Intensity',
                        data: dataEnergy,
                        backgroundColor: (ctx) => ctx.dataIndex === stressedIndex ? 'rgba(255, 99, 132, 1)' : 'rgba(255, 99, 132, 0.6)',
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: 'Syllable Stress (Stressed = Darker)' },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const idx = context.dataIndex;
                                const s = syllables[idx];
                                if (context.dataset.label === 'Pitch') return `Pitch: ${Math.round(s.maxPitch)} Hz`;
                                if (context.dataset.label === 'Duration') return `Duration: ${s.duration.toFixed(2)}s`;
                                if (context.dataset.label === 'Intensity') return `Intensity: ${(s.maxEnergy * 100).toFixed(0)}`;
                                return '';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        title: { display: true, text: 'Relative %' }
                    }
                },
                animation: {
                    onComplete: function (animation) {
                        const chart = animation.chart;
                        const ctx = chart.ctx;
                        ctx.save();
                        ctx.textAlign = 'center';
                        ctx.fillStyle = '#666';
                        ctx.font = '10px sans-serif';

                        // Draw values on top of bars
                        chart.data.datasets.forEach((dataset, i) => {
                            const meta = chart.getDatasetMeta(i);
                            meta.data.forEach((bar, index) => {
                                const s = syllables[index];
                                if (!s) return;
                                let text = '';
                                if (i === 0) text = `${Math.round(s.maxPitch)}Hz`;
                                if (i === 1) text = `${s.duration.toFixed(2)}s`;

                                if (text) ctx.fillText(text, bar.x, bar.y - 5);
                            });
                        });
                        ctx.restore();
                    }
                }
            }
        });
    }

    /**
     * Draw native speaker's pitch contour (called when word is loaded)
     * Shows the native pronunciation graph before user records
     */
    drawNativePitchContour(nativeAnalysis, syllables = []) {
        if (!nativeAnalysis || !nativeAnalysis.pitch) {
            console.log('No native analysis data for pitch contour');
            return;
        }

        // Store for later overlay comparison
        this.nativeAnalysis = nativeAnalysis;

        if (this.pitchChart) {
            this.pitchChart.destroy();
        }

        const times = nativeAnalysis.pitch.times;
        const pitches = nativeAnalysis.pitch.values;
        const intensities = nativeAnalysis.intensity?.values || [];

        // Calculate display range based on syllables
        let startIdx = 0;
        let endIdx = times.length - 1;
        const actualSyllables = syllables.length > 0 ? syllables : (nativeAnalysis.syllables || []);

        if (actualSyllables.length > 0) {
            const padding = 0.05;
            const startT = Math.max(0, actualSyllables[0].startTime - padding);
            const endT = actualSyllables[actualSyllables.length - 1].endTime + padding;

            startIdx = times.findIndex(t => t >= startT);
            if (startIdx === -1) startIdx = 0;

            for (let i = times.length - 1; i >= 0; i--) {
                if (times[i] <= endT) {
                    endIdx = i;
                    break;
                }
            }
        }

        // Slice data to speech region
        const slicedTimes = times.slice(startIdx, endIdx + 1);
        const slicedPitches = pitches.slice(startIdx, endIdx + 1);
        const slicedIntensities = intensities.slice(startIdx, endIdx + 1);

        // Normalize intensity for display
        const maxPitch = Math.max(...slicedPitches.filter(p => p !== null)) || 200;
        const maxIntensity = Math.max(...slicedIntensities) || 1;
        const normalizedIntensities = slicedIntensities.map(i =>
            (i / maxIntensity) * maxPitch * 0.6
        );

        // Syllable regions plugin
        const syllablePlugin = {
            id: 'nativeSyllableRegions',
            beforeDraw: (chart) => {
                if (actualSyllables.length === 0) return;

                const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;

                actualSyllables.forEach((syl, i) => {
                    const sIdx = slicedTimes.findIndex(t => t >= syl.startTime);
                    const eIdx = slicedTimes.findIndex(t => t >= syl.endTime);
                    if (sIdx === -1) return;

                    const finalEIdx = eIdx === -1 ? slicedTimes.length - 1 : eIdx;
                    const xStart = x.getPixelForValue(slicedTimes[sIdx].toFixed(2));
                    const xEnd = x.getPixelForValue(slicedTimes[finalEIdx].toFixed(2));

                    // Alternating background
                    ctx.fillStyle = i % 2 === 0 ? 'rgba(34, 197, 94, 0.08)' : 'rgba(34, 197, 94, 0.03)';
                    ctx.fillRect(xStart, top, xEnd - xStart, bottom - top);

                    // Syllable label
                    ctx.fillStyle = '#166534';
                    ctx.font = '10px sans-serif';
                    ctx.fillText(`Syl ${i + 1}`, xStart + 3, top + 12);
                });
            }
        };

        this.pitchChart = new Chart(this.pitchCanvas, {
            type: 'line',
            data: {
                labels: slicedTimes.map(t => t.toFixed(2)),
                datasets: [
                    {
                        label: 'Native Pitch (Hz)',
                        data: slicedPitches,
                        borderColor: 'rgb(34, 197, 94)',  // Green
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        borderWidth: 2.5,
                        tension: 0.3,
                        pointRadius: 0,
                        spanGaps: true,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Native Intensity',
                        data: normalizedIntensities,
                        borderColor: 'rgba(34, 197, 94, 0.4)',
                        backgroundColor: 'rgba(34, 197, 94, 0.15)',
                        fill: true,
                        borderWidth: 1,
                        tension: 0.3,
                        pointRadius: 0,
                        yAxisID: 'y'
                    }
                ]
            },
            plugins: [syllablePlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '🎯 Native Speaker - Pitch & Intensity',
                        font: { size: 14 }
                    },
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, padding: 8 }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Time (s)' },
                        ticks: { maxTicksLimit: 8 }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: 350,
                        title: { display: true, text: 'Pitch (Hz)' }
                    }
                }
            }
        });
    }

    /**
     * Draw user's pitch contour with native overlay (called after recording)
     * Shows both user (blue solid) and native (green dashed) for comparison
     */
    drawComparisonPitchContour(userAnalysis, nativeAnalysis = null) {
        // Use stored native analysis if not provided
        const native = nativeAnalysis || this.nativeAnalysis;

        if (this.pitchChart) {
            this.pitchChart.destroy();
        }

        if (!userAnalysis || !userAnalysis.pitch) {
            console.log('No user analysis data');
            return;
        }

        const userTimes = userAnalysis.pitch.times;
        const userPitches = userAnalysis.pitch.values;
        const userIntensities = userAnalysis.intensity?.values || [];
        const userSyllables = userAnalysis.syllables || [];

        // Find user speech region
        let uStartIdx = 0, uEndIdx = userTimes.length - 1;

        if (userSyllables.length > 0) {
            const padding = 0.05;
            const startT = Math.max(0, userSyllables[0].startTime - padding);
            const endT = userSyllables[userSyllables.length - 1].endTime + padding;
            uStartIdx = userTimes.findIndex(t => t >= startT);
            if (uStartIdx === -1) uStartIdx = 0;
            for (let i = userTimes.length - 1; i >= 0; i--) {
                if (userTimes[i] <= endT) { uEndIdx = i; break; }
            }
        }

        const slicedUserTimes = userTimes.slice(uStartIdx, uEndIdx + 1);
        const slicedUserPitches = userPitches.slice(uStartIdx, uEndIdx + 1);
        const slicedUserIntensities = userIntensities.slice(uStartIdx, uEndIdx + 1);

        // Normalize time to start from 0
        const userStartTime = slicedUserTimes[0] || 0;
        const labels = slicedUserTimes.map(t => (t - userStartTime).toFixed(2));

        // Normalize intensity for display
        const maxPitch = Math.max(...slicedUserPitches.filter(p => p !== null)) || 200;
        const maxIntensity = Math.max(...slicedUserIntensities) || 1;
        const normalizedUserIntensities = slicedUserIntensities.map(i =>
            (i / maxIntensity) * maxPitch * 0.6
        );

        const datasets = [
            {
                label: 'Your Pitch (Hz)',
                data: slicedUserPitches,
                borderColor: 'rgb(59, 130, 246)',  // Blue
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2.5,
                tension: 0.3,
                pointRadius: 0,
                spanGaps: true
            },
            {
                label: 'Your Intensity',
                data: normalizedUserIntensities,
                borderColor: 'rgba(244, 114, 182, 0.4)',
                backgroundColor: 'rgba(244, 114, 182, 0.15)',
                fill: true,
                borderWidth: 1,
                tension: 0.3,
                pointRadius: 0
            }
        ];

        // Add native reference as dashed line if available
        if (native && native.pitch) {
            const nativeTimes = native.pitch.times;
            const nativePitches = native.pitch.values;
            const nativeSyllables = native.syllables || [];

            // Find native speech region
            let nStartIdx = 0, nEndIdx = nativeTimes.length - 1;
            if (nativeSyllables.length > 0) {
                const padding = 0.05;
                const startT = Math.max(0, nativeSyllables[0].startTime - padding);
                const endT = nativeSyllables[nativeSyllables.length - 1].endTime + padding;
                nStartIdx = nativeTimes.findIndex(t => t >= startT);
                if (nStartIdx === -1) nStartIdx = 0;
                for (let i = nativeTimes.length - 1; i >= 0; i--) {
                    if (nativeTimes[i] <= endT) { nEndIdx = i; break; }
                }
            }

            const slicedNativePitches = nativePitches.slice(nStartIdx, nEndIdx + 1);

            // Resample native to match user time scale (simple interpolation)
            const resampledNative = [];
            const nativeLen = slicedNativePitches.length;
            const userLen = labels.length;

            for (let i = 0; i < userLen; i++) {
                const nativeIdx = Math.floor((i / userLen) * nativeLen);
                resampledNative.push(slicedNativePitches[Math.min(nativeIdx, nativeLen - 1)]);
            }

            datasets.unshift({
                label: 'Native Pitch (reference)',
                data: resampledNative,
                borderColor: 'rgba(34, 197, 94, 0.6)',  // Faded green
                backgroundColor: 'transparent',
                borderWidth: 2,
                borderDash: [5, 5],  // Dashed line
                tension: 0.3,
                pointRadius: 0,
                spanGaps: true
            });
        }

        // Syllable plugin for user syllables
        const syllablePlugin = {
            id: 'userSyllableRegions',
            beforeDraw: (chart) => {
                if (userSyllables.length === 0) return;

                const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;

                userSyllables.forEach((syl, i) => {
                    const relStart = syl.startTime - userStartTime;
                    const relEnd = syl.endTime - userStartTime;

                    const xStart = x.getPixelForValue(relStart.toFixed(2));
                    const xEnd = x.getPixelForValue(relEnd.toFixed(2));

                    ctx.fillStyle = i % 2 === 0 ? 'rgba(59, 130, 246, 0.08)' : 'rgba(59, 130, 246, 0.03)';
                    ctx.fillRect(xStart, top, xEnd - xStart, bottom - top);

                    ctx.fillStyle = '#1d4ed8';
                    ctx.font = '10px sans-serif';
                    ctx.fillText(`Syl ${i + 1}`, xStart + 3, top + 12);
                });
            }
        };

        this.pitchChart = new Chart(this.pitchCanvas, {
            type: 'line',
            data: { labels, datasets },
            plugins: [syllablePlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '📊 Your Recording vs Native (dashed green)',
                        font: { size: 14 }
                    },
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, padding: 8 }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Time (s)' },
                        ticks: { maxTicksLimit: 8 }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: 350,
                        title: { display: true, text: 'Pitch (Hz)' }
                    }
                }
            }
        });
    }

    /**
     * Draw native reference pattern only (before user records)
     */
    drawNativeReferenceOnly(nativePattern) {
        if (this.stressChart) {
            this.stressChart.destroy();
            this.stressChart = null;
        }

        if (!nativePattern || nativePattern.length === 0) return;

        const labels = nativePattern.map((_, i) => `Syllable ${i + 1}`);
        const stressedIndex = nativePattern.findIndex(p => p.isStressed);

        this.stressChart = new Chart(this.stressCanvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Native Reference',
                    data: nativePattern.map(p => p.relativePitch || 0),
                    backgroundColor: nativePattern.map((p, i) =>
                        i === stressedIndex ? 'rgba(34, 197, 94, 0.8)' : 'rgba(156, 163, 175, 0.6)'
                    ),
                    borderColor: nativePattern.map((p, i) =>
                        i === stressedIndex ? 'rgba(34, 197, 94, 1)' : 'rgba(156, 163, 175, 1)'
                    ),
                    borderWidth: 2,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top' },
                    title: {
                        display: true,
                        text: 'Native Speaker Pattern (Record to compare)',
                        font: { size: 14 }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        title: { display: true, text: 'Relative Stress (%)' }
                    }
                }
            }
        });
    }

    /**
     * Draw comparison chart (native vs user)
     */
    drawComparisonChart(nativePattern, userSyllables, comparison) {
        if (this.stressChart) {
            this.stressChart.destroy();
            this.stressChart = null;
        }

        if (!comparison || !comparison.syllables) return;

        const labels = comparison.syllables.map((_, i) => `Syl ${i + 1}`);

        // Calculate user relative values
        const userMaxPitch = Math.max(...userSyllables.map(s => s.maxPitch || 0)) || 1;
        const userRelativePitches = userSyllables.map(s =>
            Math.round(((s.maxPitch || 0) / userMaxPitch) * 100)
        );

        const stressedIndex = nativePattern.findIndex(p => p.isStressed);
        const userStressedIndex = comparison.userStressedSyllable - 1;

        this.stressChart = new Chart(this.stressCanvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Native',
                        data: nativePattern.map(p => p.relativePitch || 0),
                        backgroundColor: 'rgba(156, 163, 175, 0.6)',
                        borderColor: 'rgba(156, 163, 175, 1)',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Your Pronunciation',
                        data: userRelativePitches,
                        backgroundColor: userRelativePitches.map((_, i) => {
                            if (i === stressedIndex && i === userStressedIndex) {
                                return 'rgba(34, 197, 94, 0.8)';  // Green - correct
                            } else if (i === userStressedIndex) {
                                return 'rgba(239, 68, 68, 0.8)';   // Red - wrong stress
                            }
                            return 'rgba(59, 130, 246, 0.8)';      // Blue - normal
                        }),
                        borderColor: userRelativePitches.map((_, i) => {
                            if (i === stressedIndex && i === userStressedIndex) {
                                return 'rgba(34, 197, 94, 1)';
                            } else if (i === userStressedIndex) {
                                return 'rgba(239, 68, 68, 1)';
                            }
                            return 'rgba(59, 130, 246, 1)';
                        }),
                        borderWidth: 2,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top' },
                    title: {
                        display: true,
                        text: `Score: ${comparison.overallScore}% ${comparison.stressMatches ? '✅' : '❌ Stress mismatch'}`,
                        font: { size: 14 },
                        color: comparison.stressMatches ? '#22c55e' : '#ef4444'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        title: { display: true, text: 'Relative Stress (%)' }
                    }
                }
            }
        });
    }
}
