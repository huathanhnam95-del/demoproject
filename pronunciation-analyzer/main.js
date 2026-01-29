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

        // Syllable verification
        this.syllableVerifier = null;
        this.userAudioBlob = null;

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

        // Initialize visualizer with playback callback
        this.visualizer = new StressVisualizer(
            'pa-pitch-chart',
            'pa-stress-chart',
            (start, end) => this.playSyllable(start, end)
        );

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
            // Search button click
            const searchBtn = document.getElementById('pa-search-btn');
            if (searchBtn) {
                searchBtn.addEventListener('click', () => this.updateWordData());
            }
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
                // Render word form selector (if multiple forms exist)
                this.renderWordFormSelector(wordRef.alternatives || []);

                // Display the primary (first) result
                this.displayWordData(wordRef);

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
                        this.visualizer.drawDurationChart(this.nativePattern, []);
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

    /**
     * Play specific syllable from native audio
     */
    playSyllable(startTime, endTime) {
        if (!this.nativeAudio || !this.nativeAudio.src) {
            console.warn('No native audio available');
            return;
        }

        // Stop any current playback
        this.nativeAudio.pause();

        // Add small padding for clearer listening
        const start = Math.max(0, startTime - 0.05);
        const duration = (endTime - startTime) + 0.1;

        this.nativeAudio.currentTime = start;

        // Play and set timeout to stop
        this.nativeAudio.play().catch(e => console.error("Playback failed:", e));

        // Clear existing timeout if any
        if (this.audioStopTimeout) {
            clearTimeout(this.audioStopTimeout);
        }

        this.audioStopTimeout = setTimeout(() => {
            this.nativeAudio.pause();
            this.audioStopTimeout = null;
        }, duration * 1000);
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
                    this.visualizer.drawDurationChart(this.nativePattern, analysis.syllables);
                    this.generateComparisonSummary(analysis.syllables, comparison);

                    // Show syllable verification waveform
                    this.showSyllableVerifier(audioBlob, analysis.syllables);
                } else {
                    this.visualizer.drawDurationChart([], analysis.syllables);
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
                    this.visualizer.drawDurationChart([], syllables);
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

    /**
     * Show syllable verification waveform with click-to-play
     */
    showSyllableVerifier(audioBlob, syllables) {
        console.log('Main: showSyllableVerifier called with:', {
            audioBlobSize: audioBlob?.size,
            syllablesCount: syllables?.length,
            syllablesData: syllables
        });
        // Store audio blob for later use
        this.userAudioBlob = audioBlob;

        // Check if SyllableVerifier is available (loaded via CDN)
        if (typeof window.SyllableVerifier === 'undefined') {
            console.warn('SyllableVerifier not loaded');
            return;
        }

        // Destroy previous instance
        if (this.syllableVerifier) {
            this.syllableVerifier.destroy();
        }

        // Get syllable labels from IPA if available
        const syllableLabels = this.getSyllableLabels();

        // Create new verifier
        this.syllableVerifier = new window.SyllableVerifier('syllable-verifier-container');

        // Check if we have native audio for comparison mode
        if (this.nativeAudioUrl && this.nativePattern && this.nativePattern.length > 0) {
            // Use comparison mode with A/B playback
            this.syllableVerifier.loadComparison(
                audioBlob,
                syllables,
                this.nativeAudioUrl,
                this.nativePattern,
                syllableLabels
            );
        } else {
            // Simple mode - just user audio
            this.syllableVerifier.loadAudio(audioBlob, syllables, syllableLabels);
        }
    }

    /**
     * Get syllable labels from IPA string
     */
    getSyllableLabels() {
        if (!this.expectedData || !this.expectedData.ipa) {
            return null; // Will default to "Syl 1", "Syl 2", etc.
        }

        // Try to parse syllables from IPA
        // Common separators: . ˈ ˌ
        const ipa = this.expectedData.ipa
            .replace(/[\/\[\]]/g, '')  // Remove slashes/brackets
            .replace(/ˈ|ˌ/g, '.')      // Replace stress marks with dots
            .split('.')
            .filter(s => s.trim().length > 0);

        // Only use if count matches
        return ipa.length === this.expectedData.syllables ? ipa : null;
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

        // 1. Generate Actionable Tips
        const tips = [];

        // Priority 1: Stress placement / Pattern Match
        if (!comparison.stressMatches) {
            const feedback = comparison.stressFeedback ||
                `Stress Pattern Mismatch: Your emphasis pattern differs from the native speaker. Try to match the highs and lows of the native pitch and duration pattern.`;
            tips.push(`🎯 <strong>Stress Pattern</strong>: ${feedback}`);
        } else if (comparison.stressScore < 80) {
            tips.push(`🎯 <strong>Stress Balance</strong>: Good placement, but try to make the difference between stressed and unstressed syllables more distinct.`);
        }

        // Priority 2: Syllable count
        if (!comparison.syllableCountMatches) {
            tips.push(`🔢 <strong>Number of Syllables</strong>: Try to pronounce exactly ${this.nativePattern?.length || '?'} syllables (you pronounced ${userSyllables.length}).`);
        }

        // Priority 3: Global Factor Issues (If Overall scores are < 80)
        if (comparison.pitchScore < 80) {
            tips.push(`🎵 <strong>Overall Pitch</strong>: Your melody pattern is ${comparison.pitchScore >= 60 ? 'slightly off' : 'needs adjustment'}. Follow the dashed green line on the chart.`);
        }
        if (comparison.durationScore < 80) {
            tips.push(`⏱️ <strong>Overall Duration</strong>: Your rhythm is ${comparison.durationScore >= 60 ? 'fair' : 'needs work'}. Try to match the bar lengths in the Duration chart.`);
        }
        if (comparison.intensityScore < 80) {
            tips.push(`🔊 <strong>Overall Volume</strong>: Your stress emphasis is ${comparison.intensityScore >= 60 ? 'a bit weak' : 'not clear'}. Try using more breath on stressed syllables.`);
        }

        // Priority 4: Specific syllable issues (find worst syllable)
        if (comparison.syllables && comparison.syllables.length > 0) {
            const worstSyllables = [...comparison.syllables]
                .map(s => {
                    const avg = (s.pitchScore + s.durationScore + s.intensityScore) / 3;
                    return { ...s, avg };
                })
                .sort((a, b) => a.avg - b.avg);

            const worst = worstSyllables[0];
            // If the worst syllable is significantly below average OR if we don't have many tips yet
            if (worst.avg < 75 || (tips.length < 2 && worst.avg < 90)) {
                if (worst.pitchScore < worst.durationScore && worst.pitchScore < worst.intensityScore) {
                    const action = worst.userPitch > worst.nativePitch ? 'lowering' : 'raising';
                    tips.push(`🎵 <strong>Pitch Tip</strong>: Try ${action} your pitch for <strong>syllable ${worst.syllable}</strong>.`);
                } else if (worst.durationScore < worst.pitchScore && worst.durationScore < worst.intensityScore) {
                    const action = worst.userDuration > worst.nativeDuration ? 'shortening' : 'holding';
                    const verb = action === 'shortening' ? 'shortening' : 'holding';
                    const suffix = action === 'shortening' ? '' : ' a bit longer';
                    tips.push(`⏱️ <strong>Duration Tip</strong>: Try ${verb} <strong>syllable ${worst.syllable}</strong>${suffix}.`);
                } else {
                    const action = worst.userIntensity > worst.nativeIntensity ? 'softer' : 'stronger';
                    tips.push(`🔊 <strong>Volume Tip</strong>: Try making <strong>syllable ${worst.syllable}</strong> a bit ${action}.`);
                }
            }
        }

        // Limit to top 3 tips for better coverage
        const displayTips = tips.slice(0, 3);
        let tipsHtml = '';
        if (displayTips.length > 0) {
            tipsHtml = `
                <div style="margin-bottom: 20px; padding: 16px; background: #fff7ed; border-radius: 12px; border: 1px solid #ffedd5;">
                    <div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 10px; color: #9a3412;">💡 Performance Guide (How to Improve):</div>
                    <ul style="margin: 0; padding-left: 20px; color: #7c2d12; font-size: 0.9rem;">
                        ${displayTips.map(tip => `<li style="margin-bottom: 8px;">${tip}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        let html = `
            <div class="pa-comparison-result">
                <div style="text-align: center; margin-bottom: 16px;">
                    <div style="font-size: 2rem; font-weight: bold; color: ${scoreColor};">
                        ${scoreEmoji} ${comparison.overallScore}%
                    </div>
                    <div style="color: #6b7280; font-size: 0.9rem;">Overall Match Score</div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
                    <div style="text-align: center; padding: 12px; background: #f1f5f9; border-radius: 8px;">
                        <div style="font-weight: 600; color: #3b82f6;">${comparison.pitchScore}%</div>
                        <div style="font-size: 0.8rem; color: #6b7280;">Pitch</div>
                    </div>
                    <div style="text-align: center; padding: 12px; background: #f1f5f9; border-radius: 8px;">
                        <div style="font-weight: 600; color: #8b5cf6;">${comparison.durationScore}%</div>
                        <div style="font-size: 0.8rem; color: #6b7280;">Duration</div>
                    </div>
                    <div style="text-align: center; padding: 12px; background: #f1f5f9; border-radius: 8px;">
                        <div style="font-weight: 600; color: #10b981;">${comparison.intensityScore}%</div>
                        <div style="font-size: 0.8rem; color: #6b7280;">Volume</div>
                    </div>
                </div>

                ${tipsHtml}

                <!-- Performance Summary Section -->
                <div style="margin-bottom: 20px; padding: 16px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
                    <div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 12px; color: #475569;">Detailed Ratings:</div>
                    
                    <!-- Stress Pattern Row (moved here) -->
                    <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; font-size: 0.9rem; padding: 10px; background: ${comparison.stressMatches ? '#dcfce7' : '#fef3c7'}; border-radius: 8px;">
                        <div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                            ${comparison.stressMatches ? '✅' : '⚠️'}
                        </div>
                        <div style="flex: 1;">
                            <span style="font-weight: 600; color: ${comparison.stressMatches ? '#166534' : '#92400e'};">🎯 Stress Pattern:</span>
                            <span style="color: ${comparison.stressMatches ? '#15803d' : '#78350f'}; margin-left: 4px;">
                                ${comparison.stressMatches
                ? `Matches! ${comparison.patternCorrelation ? `(${comparison.patternCorrelation}% correlation)` : ''}`
                : `${comparison.patternCorrelation || 0}% match — ${comparison.stressFeedback || 'Try to match the emphasis pattern'}`
            }
                            </span>
                        </div>
                    </div>
                    
                    <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; font-size: 0.9rem;">
                        <div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                            ${comparison.pitchScore >= 80 ? '✅' : comparison.pitchScore >= 60 ? '⚠️' : '❌'}
                        </div>
                        <div style="flex: 1;">
                            <span style="font-weight: 600; color: #3b82f6;">🎵 Pitch:</span>
                            <span style="color: #64748b; margin-left: 4px;">${comparison.pitchScore >= 80 ? 'Your intonation pattern matches the native melody well.' : comparison.pitchScore >= 60 ? 'Your melody is close, but some patterns could be smoother.' : 'Try to follow the native pitch contour (melody) more closely.'}</span>
                        </div>
                    </div>
                    
                    <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; font-size: 0.9rem;">
                        <div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                            ${comparison.durationScore >= 80 ? '✅' : comparison.durationScore >= 60 ? '⚠️' : '❌'}
                        </div>
                        <div style="flex: 1;">
                            <span style="font-weight: 600; color: #8b5cf6;">⏱️ Duration:</span>
                            <span style="color: #64748b; margin-left: 4px;">${comparison.durationScore >= 80 ? 'Your rhythm and vowel lengths are consistent with native speech.' : comparison.durationScore >= 60 ? 'Your rhythm is okay, but some vowels are slightly off in length.' : 'Pay attention to vowel lengths to improve your overall rhythm.'}</span>
                        </div>
                    </div>
                    
                    <div style="display: flex; align-items: flex-start; gap: 10px; font-size: 0.9rem;">
                        <div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                            ${comparison.intensityScore >= 80 ? '✅' : comparison.intensityScore >= 60 ? '⚠️' : '❌'}
                        </div>
                        <div style="flex: 1;">
                            <span style="font-weight: 600; color: #10b981;">🔊 Volume:</span>
                            <span style="color: #64748b; margin-left: 4px;">${comparison.intensityScore >= 80 ? 'Your stress emphasis and relative loudness are clear.' : comparison.intensityScore >= 60 ? 'You have some emphasis, but it could be more distinct.' : 'Try to emphasize the stressed syllable with a bit more volume.'}</span>
                        </div>
                    </div>
                </div>
        `;

        // Stress comparison - removed as it's now integrated above

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

    /**
     * Display word data (IPA, charts, audio)
     * Extracted from updateWordData to allow switching between forms
     */
    displayWordData(wordRef) {
        if (!wordRef) return;

        this.currentWordRef = wordRef;

        // Use MW data
        this.expectedData = {
            ipa: wordRef.pronunciation || '',
            syllables: wordRef.syllableCount || 1,
            primaryStress: wordRef.stressedSyllable || 0
        };

        // Display pronunciation info
        if (this.ipaDisplay) this.ipaDisplay.textContent = wordRef.pronunciation || 'N/A';
        if (this.patternDisplay) this.patternDisplay.textContent = `${wordRef.syllableCount} Syllables, Stress on ${(wordRef.stressedSyllable || 0) + 1}`;

        // Show native audio player if audio available
        if (this.nativeAudio && this.nativeAudioContainer) {
            if (wordRef.audioUrl) {
                const proxiedUrl = this.wordRefService.getProxiedAudioUrl(wordRef.audioUrl);
                this.nativeAudio.src = proxiedUrl;
                this.nativeAudioContainer.style.display = 'flex';

                // Play audio automatically when switching forms (optional but nice)
                // this.nativeAudio.play().catch(() => {}); 
            } else {
                this.nativeAudioContainer.style.display = 'none';
            }
        }

        // *** Draw native pitch contour graph (LEFT CHART) ***
        if (this.visualizer) {
            this.visualizer.clear();

            if (wordRef.nativeAnalysis && wordRef.nativeAnalysis.pitch?.values?.length > 0) {
                this.visualizer.drawNativePitchContour(
                    wordRef.nativeAnalysis,
                    wordRef.nativeAnalysis.syllables || []
                );
            }

            // Get and display native pattern (RIGHT CHART - bar chart)
            this.nativePattern = this.wordRefService.getExpectedPattern(wordRef);
            if (this.nativePattern && this.nativePattern.length > 0) {
                this.visualizer.drawDurationChart(this.nativePattern, []);
            }
        }

        if (this.statusIndicator) this.statusIndicator.textContent = "Ready";

        // Update SyllableVerifier (Waveform) if it exists
        if (window.syllableVerifier && wordRef.audioUrl) {
            // We need to re-initialize verifier with new audio
            // This might require a method on SyllableVerifier to load new URL without full init
            // For now, assuming user will interact with main UI
        }
    }

    /**
     * Render buttons to switch between word forms (Noun, Verb, etc.)
     */
    renderWordFormSelector(alternatives) {
        const container = document.getElementById('pa-word-forms');
        if (!container) return;

        container.innerHTML = '';
        container.style.display = 'none';

        // Filter valid alternatives (must have definitions or audio)
        const validAlts = (alternatives || []).filter(a => a.definition || a.audioUrl);

        if (validAlts.length <= 1) {
            return;
        }

        container.style.display = 'flex';

        validAlts.forEach((alt, index) => {
            const btn = document.createElement('button');
            btn.className = 'pa-word-form-btn';

            // Inline styles for pill appearance (move to CSS later if needed)
            btn.style.padding = '6px 14px';
            btn.style.fontSize = '0.9rem';
            btn.style.borderRadius = '20px';
            btn.style.border = '1px solid #e5e7eb';
            btn.style.background = '#f3f4f6';
            btn.style.color = '#374151';
            btn.style.cursor = 'pointer';
            btn.style.transition = 'all 0.2s';
            btn.style.fontWeight = '500';

            // Text: Part of Speech + IPA
            const pos = alt.partOfSpeech || 'Word';
            // Capitalize first letter
            const posFormatted = pos.charAt(0).toUpperCase() + pos.slice(1);
            const ipa = alt.pronunciation ? ` /${alt.pronunciation}/` : '';

            // Add indicator for inherited pronunciation
            if (alt.inheritedPronunciation) {
                btn.innerHTML = `${posFormatted}${ipa} <span style="font-size: 0.75em; opacity: 0.7; font-weight: normal;">(Shared)</span>`;
            } else {
                btn.textContent = `${posFormatted}${ipa}`;
            }

            // Highlight the first one initially
            if (index === 0) {
                this.highlightSelectedForm(btn);
            }

            btn.onclick = () => {
                this.displayWordData(alt);
                this.highlightSelectedForm(btn);
            };

            container.appendChild(btn);
        });
    }

    highlightSelectedForm(selectedBtn) {
        const container = document.getElementById('pa-word-forms');
        const buttons = container.querySelectorAll('button');
        buttons.forEach(btn => {
            btn.style.background = '#f3f4f6';
            btn.style.color = '#374151';
            btn.style.borderColor = '#e5e7eb';
            btn.style.boxShadow = 'none';
        });

        // Active styles (Blue)
        selectedBtn.style.background = '#3b82f6';
        selectedBtn.style.color = 'white';
        selectedBtn.style.borderColor = '#2563eb';
        selectedBtn.style.boxShadow = '0 2px 4px rgba(37, 99, 235, 0.2)';
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    // Only init if container exists
    if (document.getElementById('pronunciation-analyzer-container')) {
        new PronunciationApp();
    }
});
