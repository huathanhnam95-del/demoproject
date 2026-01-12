import { AudioCapture } from './audio-capture.js';
import { PitchAnalyzer } from './pitch-analyzer.js';
import { SyllableDetector } from './syllable-detector.js';
import { StressVisualizer } from './stress-visualizer.js';
import { PraatAPI } from './praat-api.js';
import { WordReferenceService } from './word-reference-service.js';
import { config } from './config.js';

class PronunciationApp {
    constructor() {
        this.audioCapture = new AudioCapture();
        this.pitchAnalyzer = new PitchAnalyzer();
        this.syllableDetector = new SyllableDetector();
        this.praatAPI = new PraatAPI(config.backendUrl);
        this.usePraatBackend = false; // Toggle: false = local JS, true = Praat backend
        this.visualizer = null; // init after DOM load

        // Native reference service
        this.wordRefService = new WordReferenceService();
        this.currentWordRef = null;  // Current word reference data
        this.nativePattern = null;   // Native stress pattern for comparison

        this.recordBtn = document.getElementById('pa-record-btn');
        this.stopBtn = document.getElementById('pa-stop-btn');
        this.statusIndicator = document.getElementById('pa-status');
        this.resultsSummary = document.getElementById('pa-results-summary');
        this.spinner = document.getElementById('pa-spinner');

        // Dictionary elements
        this.wordInput = document.getElementById('pa-word-input');
        this.ipaDisplay = document.getElementById('pa-ipa-display');
        this.patternDisplay = document.getElementById('pa-pattern-display');

        // Native audio element
        this.nativeAudioContainer = document.getElementById('pa-native-audio-container');
        this.nativeAudio = document.getElementById('pa-native-audio');

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
                // Only deactivate pronounce-related elements, let other tab handlers manage their own
                // Remove active from pronounce tab if it was active (toggling behavior)

                // Hide all other panels and deactivate tabs
                allTabs.forEach(t => t.classList.remove('active'));
                allPanels.forEach(p => {
                    p.classList.remove('active');
                    // Only set display:none if NOT the pronounce panel (let CSS handle others)
                    if (p.id !== 'mode-pronounce') {
                        // Don't force display:none - let the existing CSS/JS handle it
                    }
                });

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
            this.statusIndicator.textContent = "Loading native reference...";
            this.spinner.style.display = 'block';
            this.visualizer.clear();

            // Hide native audio while loading
            if (this.nativeAudioContainer) {
                this.nativeAudioContainer.style.display = 'none';
            }

            // Try to get native reference from backend (MW API)
            let wordRef = null;
            try {
                wordRef = await this.wordRefService.getWordReference(word);
                this.currentWordRef = wordRef;
            } catch (refError) {
                console.warn('Native reference not available:', refError.message);
                // Fall back to existing Phonetics API
            }

            if (wordRef && wordRef.found !== false) {
                // Use MW data
                this.expectedData = {
                    ipa: wordRef.pronunciation || '',
                    syllables: wordRef.syllableCount || 1,
                    primaryStress: wordRef.stressedSyllable || 0
                };

                // Display pronunciation info
                this.ipaDisplay.textContent = wordRef.pronunciation || 'N/A';
                this.patternDisplay.textContent = `${wordRef.syllableCount} Syllables, Stress on ${(wordRef.stressedSyllable || 0) + 1}`;

                // Show native audio player if audio available
                if (wordRef.audioUrl && this.nativeAudio && this.nativeAudioContainer) {
                    const proxiedUrl = this.wordRefService.getProxiedAudioUrl(wordRef.audioUrl);
                    this.nativeAudio.src = proxiedUrl;
                    this.nativeAudioContainer.style.display = 'flex';
                }

                // *** Draw native pitch contour graph (LEFT CHART) ***
                console.log('=== DRAWING NATIVE PITCH CONTOUR ===');
                console.log('Has nativeAnalysis:', !!wordRef.nativeAnalysis);
                console.log('pitch.values length:', wordRef.nativeAnalysis?.pitch?.values?.length || 0);
                console.log('syllables length:', wordRef.nativeAnalysis?.syllables?.length || 0);

                if (wordRef.nativeAnalysis &&
                    wordRef.nativeAnalysis.pitch?.values?.length > 0) {
                    console.log('✅ Drawing native pitch contour...');
                    this.visualizer.drawNativePitchContour(
                        wordRef.nativeAnalysis,
                        wordRef.nativeAnalysis.syllables || []
                    );
                } else {
                    console.warn('⚠️ No native analysis data - left chart will be empty');
                }

                // Get and display native pattern (RIGHT CHART - bar chart)
                this.nativePattern = this.wordRefService.getExpectedPattern(wordRef);
                if (this.nativePattern && this.nativePattern.length > 0) {
                    this.visualizer.drawNativeReferenceOnly(this.nativePattern);
                }

                const cacheStatus = wordRef.fromCache ? ` (${wordRef.cacheSource})` : '';
                this.statusIndicator.textContent = `Ready${cacheStatus}`;

            } else {
                // Fallback to existing Phonetics API
                const ipa = await window.Phonetics?.getIPA(word);

                if (ipa) {
                    const parsed = this.parseIPA(ipa);
                    this.expectedData = {
                        ipa: ipa,
                        syllables: parsed.syllableCount,
                        primaryStress: parsed.primaryStress
                    };

                    this.ipaDisplay.textContent = ipa;
                    this.patternDisplay.textContent = `${parsed.syllableCount} Syllables, Stress on ${parsed.primaryStress + 1}`;

                    // Generate theoretical pattern
                    this.nativePattern = this.wordRefService.generateTheoreticalPattern(
                        parsed.syllableCount,
                        parsed.primaryStress
                    );
                    if (this.nativePattern) {
                        this.visualizer.drawNativeReferenceOnly(this.nativePattern);
                    }
                } else {
                    this.ipaDisplay.textContent = "Not found";
                    this.patternDisplay.textContent = "-";
                    this.nativePattern = null;
                }
                this.statusIndicator.textContent = "Idle";
            }

        } catch (err) {
            console.error("Error fetching word data:", err);
            this.ipaDisplay.textContent = "Error";
            this.patternDisplay.textContent = err.message || "Failed to load";
            this.statusIndicator.textContent = "Error";
            this.nativePattern = null;
        } finally {
            this.spinner.style.display = 'none';
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

                // *** Draw comparison pitch contour (user + native overlay) ***
                this.visualizer.drawComparisonPitchContour(
                    analysis,
                    this.currentWordRef?.nativeAnalysis
                );

                // Show comparison chart if we have native pattern
                if (this.nativePattern && analysis.syllables.length > 0) {
                    const comparison = this.wordRefService.compareWithNative(
                        analysis.syllables,
                        this.nativePattern
                    );
                    this.visualizer.drawComparisonChart(this.nativePattern, analysis.syllables, comparison);
                    this.generateComparisonSummary(analysis.syllables, comparison);
                } else {
                    this.visualizer.drawSyllableStress(analysis.syllables);
                    this.generateSummary(analysis.syllables, 0);
                }
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

    /**
     * Generate detailed comparison summary with native reference
     */
    generateComparisonSummary(userSyllables, comparison) {
        if (!comparison) {
            this.generateSummary(userSyllables, 0);
            return;
        }

        const scoreColor = comparison.overallScore >= 80 ? '#22c55e' :
            comparison.overallScore >= 60 ? '#f59e0b' : '#ef4444';
        const scoreEmoji = comparison.overallScore >= 80 ? '🎉' :
            comparison.overallScore >= 60 ? '👍' : '💪';

        let html = `
            <div class="pa-comparison-result">
                <div style="text-align: center; margin-bottom: 16px;">
                    <div style="font-size: 2rem; font-weight: bold; color: ${scoreColor};">
                        ${scoreEmoji} ${comparison.overallScore}%
                    </div>
                    <div style="color: #6b7280; font-size: 0.9rem;">Overall Match Score</div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;">
                    <div style="text-align: center; padding: 12px; background: #f1f5f9; border-radius: 8px;">
                        <div style="font-weight: 600; color: #3b82f6;">${comparison.pitchScore}%</div>
                        <div style="font-size: 0.8rem; color: #6b7280;">Pitch</div>
                    </div>
                    <div style="text-align: center; padding: 12px; background: #f1f5f9; border-radius: 8px;">
                        <div style="font-weight: 600; color: #8b5cf6;">${comparison.durationScore}%</div>
                        <div style="font-size: 0.8rem; color: #6b7280;">Timing</div>
                    </div>
                    <div style="text-align: center; padding: 12px; background: #f1f5f9; border-radius: 8px;">
                        <div style="font-weight: 600; color: #10b981;">${comparison.intensityScore}%</div>
                        <div style="font-size: 0.8rem; color: #6b7280;">Intensity</div>
                    </div>
                </div>
        `;

        // Stress comparison
        if (comparison.stressMatches) {
            html += `
                <div style="background: #dcfce7; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
                    <div style="color: #166534; font-weight: 500;">
                        ✅ Stress placement is correct! (Syllable ${comparison.nativeStressedSyllable})
                    </div>
                </div>
            `;
        } else {
            html += `
                <div style="background: #fee2e2; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
                    <div style="color: #991b1b; font-weight: 500;">
                        ❌ Stress mismatch: You stressed syllable ${comparison.userStressedSyllable}, 
                        but native speaker stresses syllable ${comparison.nativeStressedSyllable}
                    </div>
                </div>
            `;
        }

        // Syllable count
        if (!comparison.syllableCountMatches) {
            html += `
                <div style="background: #fef3c7; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
                    <div style="color: #92400e; font-weight: 500;">
                        ⚠️ You pronounced ${userSyllables.length} syllables, but native has ${this.nativePattern?.length || '?'}
                    </div>
                </div>
            `;
        }

        html += '</div>';
        this.resultsSummary.innerHTML = html;
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    // Only init if container exists
    if (document.getElementById('pronunciation-analyzer-container')) {
        new PronunciationApp();
    }
});
