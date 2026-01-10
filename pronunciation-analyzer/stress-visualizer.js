export class StressVisualizer {
    constructor(pitchCanvasId, stressCanvasId) {
        this.pitchCanvas = document.getElementById(pitchCanvasId);
        this.stressCanvas = document.getElementById(stressCanvasId);
        this.pitchChart = null;
        this.stressChart = null;
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

        // Normalize energy
        const maxPitch = Math.max(...slicedPitches.filter(p => p !== null)) || 200;
        const normalizedEnergies = slicedEnergies.map(e => e * maxPitch * 2);

        // 2. Prepare background regions for syllables
        // We'll use a Chart.js plugin to draw rectangles behind the chart
        const syllableRegionsPlugin = {
            id: 'syllableRegions',
            beforeDraw: (chart) => {
                if (syllables.length === 0) return;
                const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;

                syllables.forEach((s, i) => {
                    const startX = x.getPixelForValue(s.startTime); // Ensure labels map to time or use time scale
                    // Note: Since labels are strings, getPixelForValue might expect string index if not linear scale.
                    // But here labels are "0.00", "0.01". Chart.js usually handles loose matching or we rely on indices.
                    // Better approach for precision: Map time to index in 'slicedTimes', then map index to pixel.

                    // Simple index mapping:
                    // This is an approximation if x-axis is Category.
                    // If x-axis were 'linear', we could pass raw values.
                    // Let's use indices since labels are strings.

                    // Find closest index for start/end in the *sliced* arrays
                    // Times in 'slicedTimes' start from S, valid range.

                    // Optimization: find index in slicedTimes
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
                        label: 'Intensity',
                        data: normalizedEnergies,
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        borderColor: 'rgba(255, 99, 132, 0.5)',
                        fill: true,
                        yAxisID: 'y',
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
                    title: { display: true, text: 'Pitch & Intensity (Trimmed)' },
                    tooltip: { enabled: true }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Time (s)' },
                        ticks: { maxTicksLimit: 8 }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: 400,
                        title: { display: true, text: 'Hz' }
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
        const maxP = Math.max(...syllables.map(s => s.maxPitch)) || 1;
        const maxD = Math.max(...syllables.map(s => s.duration)) || 1;
        const maxE = Math.max(...syllables.map(s => s.maxEnergy)) || 1;

        // Determine stressed syllable (simple heuristic or use one passed in?)
        // Let's re-calculate score locally to highlight
        let stressedIndex = 0;
        let maxScore = -1;
        syllables.forEach((s, i) => {
            const score = (s.maxPitch / maxP) + (s.duration / maxD) + (s.maxEnergy / maxE);
            if (score > maxScore) { maxScore = score; stressedIndex = i; }
        });

        // Datasets
        // We'll show raw values in tooltips, but bar height is relative %
        const dataPitch = syllables.map(s => (s.maxPitch / maxP) * 100);
        const dataDuration = syllables.map(s => (s.duration / maxD) * 100);
        const dataEnergy = syllables.map(s => (s.maxEnergy / maxE) * 100);

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
}
