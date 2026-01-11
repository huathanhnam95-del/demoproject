import { AudioCapture } from './audio-capture.js';
import { PitchAnalyzer } from './pitch-analyzer.js';
import { SyllableDetector } from './syllable-detector.js';
import { StressVisualizer } from './stress-visualizer.js';
import { PraatAPI } from './praat-api.js';

class PronunciationApp {
    constructor() {
        this.audioCapture = new AudioCapture();
        this.pitchAnalyzer = new PitchAnalyzer();
        this.syllableDetector = new SyllableDetector();
        this.praatAPI = new PraatAPI();
        this.usePraatBackend = false; // Toggle: false = local JS, true = Praat backend
        this.visualizer = null; // init after DOM load

        this.recordBtn = document.getElementById('pa-record-btn');
        this.stopBtn = document.getElementById('pa-stop-btn');
        this.statusIndicator = document.getElementById('pa-status');
        this.resultsSummary = document.getElementById('pa-results-summary');
        this.spinner = document.getElementById('pa-spinner');

        // Dictionary elements
        this.wordInput = document.getElementById('pa-word-input');
        this.ipaDisplay = document.getElementById('pa-ipa-display');
        this.patternDisplay = document.getElementById('pa-pattern-display');

        this.expectedData = {
            ipa: '/ˈfoʊ.tə.ɡræf/',
            syllables: 3,
            primaryStress: 0
        };

        // Create debounced update function
        this.updateWordDataDebounced = this.debounce(() => this.updateWordData(), 500);

        this.initEventListeners();
        this.visualizer = new StressVisualizer('pa-pitch-chart', 'pa-stress-chart');

        // Check if Praat backend is available
        this.checkPraatBackend();

        // Initial fetch for default word
        this.updateWordData();
    }

    async checkPraatBackend() {
        const isAvailable = await this.praatAPI.checkHealth();
        if (isAvailable) {
            console.log('✅ Praat backend available - using server-side analysis');
            this.usePraatBackend = true;
        } else {
            console.log('ℹ️ Praat backend not available - using local JS analysis');
            this.usePraatBackend = false;
        }
    }

    // Debounce utility
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    initEventListeners() {
        this.recordBtn.addEventListener('click', () => this.startRecording());
        this.stopBtn.addEventListener('click', () => this.stopRecording());

        // Tab Switching Logic
        const pronounceTab = document.getElementById('tab-pronounce');
        const allTabs = document.querySelectorAll('.tab-btn');
        const allPanels = document.querySelectorAll('.mode-panel');
        const pronouncePanel = document.getElementById('mode-pronounce');

        if (pronounceTab) {
            pronounceTab.addEventListener('click', () => {
                // Deactivate all
                allTabs.forEach(t => t.classList.remove('active'));
                allPanels.forEach(p => p.classList.remove('active'));
                allPanels.forEach(p => p.style.display = 'none'); // Ensure hidden if style used

                // Activate Pronounce
                pronounceTab.classList.add('active');
                if (pronouncePanel) {
                    pronouncePanel.classList.add('active');
                    pronouncePanel.style.display = 'block';
                }
            });

            // Listen to other tabs to hide pronounce panel and deactivate pronounce tab
            allTabs.forEach(tab => {
                if (tab.id !== 'tab-pronounce') {
                    tab.addEventListener('click', () => {
                        if (pronouncePanel) {
                            pronouncePanel.classList.remove('active');
                            pronouncePanel.style.display = 'none';
                        }
                        if (pronounceTab) {
                            pronounceTab.classList.remove('active');
                        }
                    });
                }
            });
        }

        if (this.wordInput) {
            this.wordInput.addEventListener('input', () => this.updateWordDataDebounced());
            // Also on enter (immediate)
            this.wordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.updateWordData();
            });
        }
    }

    async updateWordData() {
        const word = this.wordInput.value.trim();
        if (!word) return;

        try {
            this.statusIndicator.textContent = "Fetching IPA...";
            // Access Phonetics from window as it's a global script
            const ipa = await window.Phonetics.getIPA(word);

            if (ipa) {
                const parsed = this.parseIPA(ipa);
                this.expectedData = {
                    ipa: ipa,
                    syllables: parsed.syllableCount,
                    primaryStress: parsed.primaryStress
                };

                this.ipaDisplay.textContent = ipa;
                this.patternDisplay.textContent = `${parsed.syllableCount} Syllables, Stress on ${parsed.primaryStress + 1}`;
            } else {
                this.ipaDisplay.textContent = "Not found";
                this.patternDisplay.textContent = "-";
            }
            this.statusIndicator.textContent = "Idle";
        } catch (err) {
            console.error("Error fetching word data:", err);
            this.statusIndicator.textContent = "Error";
        }
    }

    parseIPA(ipa) {
        // Clean IPA (remove slashes or brackets)
        const clean = ipa.replace(/[\/\[\]]/g, '');

        // IPA vowels (diphthongs first, then monophthongs with optional length mark)
        const vowelRegex = /(aɪ|eɪ|ɔɪ|aʊ|oʊ|ɪə|eə|ʊə|iː|uː|ɑː|ɔː|ɜː|eːɪ|[ɪieɛæəʌɑɒɔouʊaɚɝ])/g;

        const matches = [...clean.matchAll(vowelRegex)];

        if (matches.length === 0) {
            return { syllableCount: 1, primaryStress: 0 };
        }

        // Find primary stress marker position
        const stressPos = clean.indexOf('ˈ');
        let primaryStress = 0;

        if (stressPos !== -1) {
            // Count how many vowels appear BEFORE the stress marker
            // The stressed syllable is the NEXT vowel after ˈ
            let vowelsBefore = 0;
            for (const match of matches) {
                if (match.index < stressPos) {
                    vowelsBefore++;
                } else {
                    break;
                }
            }
            primaryStress = vowelsBefore; // 0-indexed
        }

        return {
            syllableCount: matches.length,
            primaryStress: primaryStress
        };
    }

    async startRecording() {
        try {
            await this.audioCapture.start();

            this.recordBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.statusIndicator.classList.add('recording');
            this.statusIndicator.textContent = "Recording...";
            this.resultsSummary.innerHTML = "";

            // Clear charts
            this.visualizer.clear();

        } catch (err) {
            alert("Could not start recording: " + err.message);
        }
    }

    async stopRecording() {
        this.stopBtn.disabled = true;
        this.statusIndicator.classList.remove('recording');
        this.statusIndicator.textContent = this.usePraatBackend ? "Analyzing with Praat..." : "Processing...";
        this.spinner.style.display = 'block';

        try {
            if (this.usePraatBackend) {
                // Use Praat backend
                const audioBlob = await this.audioCapture.stopAsBlob();
                if (!audioBlob) {
                    throw new Error('No audio recorded');
                }

                const expectedCount = this.expectedData?.syllables || null;
                const analysis = await this.praatAPI.analyze(audioBlob, expectedCount);

                this.visualizer.drawPitchContour(
                    analysis.pitch.times,
                    analysis.pitch.values,
                    analysis.intensity.values,
                    analysis.syllables
                );
                this.visualizer.drawSyllableStress(analysis.syllables);
                this.generateSummary(analysis.syllables, 0);
            } else {
                // Use local JS analysis
                const audioBuffer = await this.audioCapture.stop();
                if (!audioBuffer) return;

                // Execute heavy analysis in a timeout to allow UI update
                setTimeout(() => {
                    const analysisData = this.pitchAnalyzer.analyze(audioBuffer);
                    const expectedCount = this.expectedData ? this.expectedData.syllables : null;
                    const { syllables, noiseCount } = this.syllableDetector.detect(analysisData, expectedCount);

                    this.visualizer.drawPitchContour(analysisData.times, analysisData.pitches, analysisData.energies, syllables);
                    this.visualizer.drawSyllableStress(syllables);
                    this.generateSummary(syllables, noiseCount);

                    this.spinner.style.display = 'none';
                    this.recordBtn.disabled = false;
                    this.statusIndicator.textContent = "Idle";
                }, 100);
                return; // Exit early, setTimeout handles cleanup
            }

            this.spinner.style.display = 'none';
            this.recordBtn.disabled = false;
            this.statusIndicator.textContent = "Idle";

        } catch (err) {
            console.error(err);
            this.resultsSummary.innerHTML = `
                <div style="color: #dc2626;">
                    ⚠️ Analysis error: ${err.message}
                    ${this.usePraatBackend ? '<br><br>Make sure the Python backend is running:<br><code>cd backend && python server.py</code>' : ''}
                </div>
            `;
            this.statusIndicator.textContent = "Error";
            this.spinner.style.display = 'none';
            this.recordBtn.disabled = false;
        }
    }

    generateSummary(syllables, noiseCount = 0) {
        if (syllables.length === 0) {
            this.resultsSummary.innerHTML = `
                <div style="color: #dc2626;">
                    ⚠️ No syllables detected. Tips:
                    <ul style="margin-top: 8px; padding-left: 20px; font-size: 0.9em;">
                        <li>Speak louder and closer to the microphone</li>
                        <li>Pronounce each syllable clearly</li>
                        <li>Reduce background noise</li>
                    </ul>
                </div>
                ${noiseCount > 0 ? `<div style="color: #6b7280; font-size: 0.85em; margin-top: 10px;">ℹ️ Note: ${noiseCount} segments were filtered as noise.</div>` : ''}
            `;
            return;
        }

        let noiseHtml = '';
        if (noiseCount > 0) {
            noiseHtml = `<div style="color: #6b7280; font-size: 0.85em; margin-bottom: 10px;">ℹ️ Filtered ${noiseCount} noise segments (background noise/breath).</div>`;
        }

        // Find stressed syllable (simple heuristic: sum of normalized scores)
        const maxP = Math.max(...syllables.map(s => s.maxPitch)) || 1;
        const maxD = Math.max(...syllables.map(s => s.duration)) || 1;
        const maxE = Math.max(...syllables.map(s => s.maxEnergy)) || 1;

        let stressedIndex = 0;
        let maxScore = -1;

        const detailsHtml = syllables.map((s, i) => {
            const energy = s.intensity || s.maxEnergy || 0;
            const score = (s.maxPitch / maxP) + (s.duration / maxD) + (energy / maxE);
            if (score > maxScore) {
                maxScore = score;
                stressedIndex = i;
            }

            const pitchText = s.maxPitch > 0 ? `${Math.round(s.maxPitch)} Hz` : '<span style="color:#9ca3af">No pitch</span>';
            return `<li>Syllable ${i + 1}: ${s.duration.toFixed(2)}s, ${pitchText}</li>`;
        }).join('');

        this.resultsSummary.innerHTML = `
      ${noiseHtml}
      <div style="margin-bottom: 8px;"><strong>${syllables.length}</strong> syllables detected:</div>
      <ul style="list-style: none; padding-left: 0; margin-bottom: 12px; font-size: 0.9em; color: #4b5563;">
        ${detailsHtml}
      </ul>
      <div style="color: #1e40af; font-weight: 500; margin-bottom: 8px;">
        Detected stress: <strong>Syllable ${stressedIndex + 1}</strong>
        <span style="font-size: 0.85em; font-weight: normal; color: #6b7280;">(based on pitch, duration & intensity)</span>
      </div>
      ${this.generateComparison(syllables.length, stressedIndex)}
    `;
    }

    generateComparison(detectedCount, detectedStress) {
        if (!this.expectedData) return "";

        const countMatch = detectedCount === this.expectedData.syllables;
        const stressMatch = detectedStress === this.expectedData.primaryStress;

        let html = '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #cbd5e1;">';

        if (countMatch && stressMatch) {
            html += `<div style="color: #059669; font-weight: 600;">✅ Excellent! Matches the dictionary pattern.</div>`;
        } else {
            if (!countMatch) {
                html += `<div style="color: #d97706;">⚠️ Expected <strong>${this.expectedData.syllables}</strong> syllables, but detected <strong>${detectedCount}</strong>.</div>`;
            }
            if (!stressMatch) {
                html += `<div style="color: #dc2626;">❌ Stress mismatch. Dictionary suggests stress on <strong>Syllable ${this.expectedData.primaryStress + 1}</strong>.</div>`;
            }
        }

        html += '</div>';
        return html;
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    // Only init if container exists
    if (document.getElementById('pronunciation-analyzer-container')) {
        new PronunciationApp();
    }
});
