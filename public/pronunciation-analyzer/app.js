import { AudioCapture } from './audio-capture.js';
import { PitchAnalyzer } from './pitch-analyzer.js';
import { SyllableDetector } from './syllable-detector.js';
import { StressVisualizer } from './stress-visualizer.js';
import { PraatAPI } from './praat-api.js';
import { WordReferenceService } from './word-reference-service.js';
import { NativeAudioPlayer } from './native-audio-player.js';
import { config } from './config.js';
import { analyzeRecordedAttempt } from './analysis-pipeline.js';

export class PronunciationApp {
    constructor() {
        this.audioCapture = new AudioCapture();
        this.pitchAnalyzer = new PitchAnalyzer();
        this.syllableDetector = new SyllableDetector();
        this.praatAPI = new PraatAPI(config.backendUrl);
        this.usePraatBackend = config.features.usePraatBackend || false; // Respect config, will be confirmed by health check
        this.visualizer = null; // init after DOM load

        // Native reference service
        this.wordRefService = new WordReferenceService();
        this.currentWordRef = null;  // Current word reference data
        this.nativePattern = null;   // Native stress pattern for comparison

        // Syllable verification
        this.syllableVerifier = null;
        this.userAudioBlob = null;
        this.nativeAudioUrl = null;

        this.recordBtn = document.getElementById('pa-record-btn');
        this.stopBtn = document.getElementById('pa-stop-btn');
        this.statusIndicator = document.getElementById('pa-status');
        this.resultsSummary = document.getElementById('pa-results-summary');
        this.spinner = document.getElementById('pa-spinner');

        // Dictionary elements
        this.wordInput = document.getElementById('pa-word-input');
        this.ipaDisplay = document.getElementById('pa-ipa-display');
        this.patternDisplay = document.getElementById('pa-pattern-display');
        this.wordInfo = document.getElementById('pa-word-info');
        this.wordForms = document.getElementById('pa-word-forms');
        this.loadingPlaceholder = document.getElementById('pa-loading-placeholder');

        // Native audio element
        this.nativeAudioContainer = document.getElementById('pa-native-audio-container');
        this.nativeAudio = document.getElementById('pa-native-audio');
        this.nativeAudioPlayer = new NativeAudioPlayer(this.audioCapture.audioContext, this.nativeAudio);

        this.expectedData = {
            ipa: '/ˈfoʊ.tə.ɡræf/',
            syllables: 3,
            primaryStress: 0
        };

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
        try {
            const isAvailable = await this.praatAPI.checkHealth();
            if (isAvailable) {
                Logger.log('✅ Praat backend available - using server-side analysis');
                this.usePraatBackend = true;
            } else {
                Logger.log('ℹ️ Praat backend not available - falling back to local JS analysis');
                this.usePraatBackend = false;
            }
        } catch (e) {
            Logger.log('ℹ️ Praat health check failed - using local JS analysis');
            this.usePraatBackend = false;
        }
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

            // Hide old data while loading
            if (this.wordInfo) this.wordInfo.classList.add('hidden');
            if (this.wordForms) this.wordForms.classList.add('hidden');
            if (this.loadingPlaceholder) this.loadingPlaceholder.style.display = 'flex';
            if (this.nativeAudioContainer) {
                this.nativeAudioContainer.style.display = 'none';
            }
            this.nativeAudioPlayer.clearSource();

            // Clear previous results
            if (this.resultsSummary) this.resultsSummary.innerHTML = "";
            if (this.syllableVerifier) {
                this.syllableVerifier.destroy();
                this.syllableVerifier = null;
            }
            const verifierContainer = document.getElementById('syllable-verifier-container');
            if (verifierContainer) verifierContainer.innerHTML = "";

            // Try to get native reference from backend (MW API)
            let wordRef = null;
            try {
                wordRef = await this.wordRefService.getWordReference(word);
                this.currentWordRef = wordRef;
            } catch (refError) {
                console.warn('Native reference not available:', refError.message);
                // Fall back to existing Phonetics API
            }

            if (this.loadingPlaceholder) this.loadingPlaceholder.style.display = 'none';

            if (wordRef && wordRef.found !== false) {
                // Show containers
                if (this.wordInfo) this.wordInfo.classList.remove('hidden');
                if (this.wordForms) this.wordForms.classList.remove('hidden');

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
            Logger.error("Error fetching word data:", err);
            this.ipaDisplay.textContent = "Error";
            this.patternDisplay.textContent = err.message || "Failed to load";
            this.statusIndicator.textContent = "Error";
            this.nativePattern = null;
            this.nativeAudioPlayer.clearSource();
        } finally {
            this.spinner.style.display = 'none';
        }
    }

    parseIPA(ipa) {
        // Clean IPA (remove slashes or brackets)
        const clean = ipa
            .replaceAll('/', '')
            .replaceAll('[', '')
            .replaceAll(']', '');

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
        if (!this.nativeAudioUrl) {
            console.warn('No native audio available');
            return;
        }

        this.nativeAudioPlayer.playSegment(this.nativeAudioUrl, startTime, endTime)
            .catch((error) => Logger.error("Playback failed:", error));
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
        if (this._analysisInProgress) {
            return this._analysisInProgress;
        }

        this._analysisInProgress = (async () => {
            this.stopBtn.disabled = true;
            this.statusIndicator.classList.remove('recording');
            this.statusIndicator.textContent = this.usePraatBackend ? 'Analyzing with Praat...' : 'Processing...';
            this.spinner.style.display = 'block';

            try {
                const capture = await this.audioCapture.stopCapture();
                const audioBlob = capture?.blob || null;
                if (!audioBlob) {
                    throw new Error('No audio recorded');
                }

                const expectedCount = this.expectedData?.syllables || null;
                const result = await analyzeRecordedAttempt({
                    audioBlob,
                    expectedSyllables: expectedCount,
                    preferPraat: this.usePraatBackend,
                    praatAnalyze: (blob, expectedSyllables) => this.praatAPI.analyze(blob, expectedSyllables),
                    decodeBlob: (blob) => this.audioCapture.blobToAudioBuffer(blob),
                    pitchAnalyze: (audioBuffer) => this.pitchAnalyzer.analyze(audioBuffer),
                    detectSyllables: (analysisData, syllableCount) => this.syllableDetector.detect(analysisData, syllableCount)
                });

                if (!result.quality?.rateable) {
                    this.visualizer.clear();
                    this.generateUnrateableSummary(result.quality?.reason, result.quality);
                    this._finishAnalysis('Idle');
                    return;
                }

                if (result.usedPraatFallback) {
                    Logger.log('Praat backend analysis failed; local analysis was used.');
                }

                if (result.engine === 'praat') {
                    const analysis = result.analysis;
                    this.visualizer.drawComparisonPitchContour(
                        analysis,
                        this.currentWordRef?.nativeAnalysis
                    );
                    this.renderSyllableFeedback(audioBlob, analysis?.syllables || [], 0);
                } else {
                    const analysisData = result.analysisData || { times: [], pitches: [], energies: [] };
                    const syllables = result.syllables || [];
                    const noiseCount = result.noiseCount || 0;

                    this.visualizer.drawPitchContour(analysisData.times, analysisData.pitches, analysisData.energies, syllables);
                    this.renderSyllableFeedback(audioBlob, syllables, noiseCount);
                }

                this._finishAnalysis('Idle');
            } catch (err) {
                Logger.error(err);
                this.resultsSummary.innerHTML = `
                    <div style="color: #dc2626; font-size: 0.95rem; padding: 12px;">
                        Analysis error: ${err.message}
                        <br><br>
                        <span style="color: #6b7280; font-size: 0.85rem;">Try recording again. If the issue persists, please check your microphone or connection.</span>
                    </div>
                `;
                this._finishAnalysis('Error');
            } finally {
                this._analysisInProgress = null;
            }
        })();

        return this._analysisInProgress;
    }

    _finishAnalysis(statusText = 'Idle') {
        this.spinner.style.display = 'none';
        this.recordBtn.disabled = false;
        this.stopBtn.disabled = true;
        this.statusIndicator.classList.remove('recording');
        this.statusIndicator.textContent = statusText;
    }

    generateUnrateableSummary(reason, quality) {
        const reasonCopy = {
            no_speech: 'No speech detected. Speak once after pressing Record and reduce background noise.',
            too_short: 'Recording too short to analyze reliably. Say the full word once at a normal pace.',
            low_energy: 'Speech was too quiet to analyze reliably. Speak a little louder and closer to the microphone.',
            low_voicing: 'The recording did not contain enough clear vowel sound to locate syllables. Hold each vowel a bit more clearly.'
        };
        const message = reasonCopy[reason] || 'The recording could not be scored reliably. Try again with clearer speech.';
        const metrics = quality?.metrics || {};
        const extra = [
            `Peak energy: ${typeof metrics.peakEnergy === 'number' ? metrics.peakEnergy.toFixed(3) : '0.000'}`,
            `Active speech: ${Math.round(metrics.activeSpeechDurationMs || 0)}ms`,
            `Voiced frame ratio: ${Math.round((metrics.voicedFrameRatio || 0) * 100)}%`
        ].join(' · ');

        this.resultsSummary.innerHTML = `
            <div style="color: #b91c1c; font-size: 0.95rem; padding: 12px;">
                ${message}
                <div style="margin-top: 8px; color: #6b7280; font-size: 0.85rem;">${extra}</div>
            </div>
        `;
    }

    /**
     * Show syllable verification waveform with click-to-play
     */
    showSyllableVerifier(audioBlob, syllables) {
        Logger.log('Main: showSyllableVerifier called with:', {
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

        const nativeComparisonSyllables = this.getNativeComparisonSyllables();

        // Check if we have native audio for comparison mode
        if (this.nativeAudioUrl && nativeComparisonSyllables.length > 0) {
            // Use comparison mode with A/B playback
            this.syllableVerifier.loadComparison(
                audioBlob,
                syllables,
                this.nativeAudioUrl,
                nativeComparisonSyllables,
                syllableLabels
            );
        } else {
            // Simple mode - just user audio
            this.syllableVerifier.loadAudio(audioBlob, syllables, syllableLabels);
        }
    }

    getNativeComparisonSyllables() {
        const syllables = this.currentWordRef?.nativeAnalysis?.syllables;
        if (!Array.isArray(syllables)) {
            return [];
        }

        return syllables.filter((syllable) => (
            Number.isFinite(syllable?.startTime) &&
            Number.isFinite(syllable?.endTime) &&
            syllable.endTime > syllable.startTime
        ));
    }

    renderSyllableFeedback(audioBlob, syllables, noiseCount = 0) {
        if (this.nativePattern && syllables.length > 0) {
            const comparison = this.wordRefService.compareWithNative(
                syllables,
                this.nativePattern
            );
            this.visualizer.drawDurationChart(this.nativePattern, syllables);
            this.generateComparisonSummary(syllables, comparison);
        } else {
            this.visualizer.drawDurationChart([], syllables);
            this.generateSummary(syllables, noiseCount);
        }

        if (syllables.length > 0 && audioBlob) {
            this.showSyllableVerifier(audioBlob, syllables);
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
            .replaceAll('/', '')       // Remove slashes/brackets
            .replaceAll('[', '')
            .replaceAll(']', '')
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

        const detailsHtml = syllables.map((s, i) => {
            const pitchText = s.maxPitch > 0 ? `${Math.round(s.maxPitch)} Hz` : '<span style="color:#9ca3af">No pitch</span>';
            return `<li>Syllable ${i + 1}: ${s.duration.toFixed(2)}s, ${pitchText}</li>`;
        }).join('');

        const stressedIndex = this.wordRefService.findUserStressedSyllable(syllables);

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

    buildPrimaryAction(comparison, userSyllables) {
        if (!comparison.syllableCountMatches) {
            return `Say ${this.nativePattern?.length || '?'} syllables, not ${userSyllables.length}.`;
        }

        if (!comparison.stressMatches) {
            return comparison.stressFeedback || `Move the main stress toward syllable ${comparison.nativeStressedSyllable || 1}.`;
        }

        const scoredSyllables = [...(comparison.syllables || [])]
            .map((syllable) => ({
                ...syllable,
                avg: (syllable.pitchScore + syllable.durationScore + syllable.intensityScore) / 3
            }))
            .sort((a, b) => a.avg - b.avg);

        const weakest = scoredSyllables[0];
        if (!weakest || (weakest.avg >= 92 && comparison.overallScore >= 90)) {
            return 'Keep this pattern. The next attempt is just small polish.';
        }

        if (weakest.durationScore <= weakest.pitchScore && weakest.durationScore <= weakest.intensityScore) {
            return weakest.userDuration > weakest.nativeDuration
                ? `Shorten syllable ${weakest.syllable} slightly.`
                : `Hold syllable ${weakest.syllable} a bit longer.`;
        }

        if (weakest.pitchScore <= weakest.durationScore && weakest.pitchScore <= weakest.intensityScore) {
            return weakest.userPitch > weakest.nativePitch
                ? `Lower the pitch on syllable ${weakest.syllable} slightly.`
                : `Raise the pitch on syllable ${weakest.syllable} slightly.`;
        }

        return weakest.userIntensity > weakest.nativeIntensity
            ? `Make syllable ${weakest.syllable} a bit softer.`
            : `Make syllable ${weakest.syllable} a bit stronger.`;
    }

    buildQuickFeedback(comparison, userSyllables) {
        const dimensions = [
            { label: 'Pitch', score: comparison.pitchScore },
            { label: 'Duration', score: comparison.durationScore },
            { label: 'Volume', score: comparison.intensityScore }
        ].sort((a, b) => b.score - a.score);

        let overview = 'Keep working on the overall shape.';
        if (comparison.overallScore >= 90) {
            overview = 'Very close to the native pattern.';
        } else if (comparison.overallScore >= 75) {
            overview = 'Close overall, with one clear fix to make.';
        } else if (comparison.overallScore >= 60) {
            overview = 'A few parts are close, but the pattern still needs tightening.';
        }

        const strongestLine = dimensions[0]?.score >= 85
            ? `Best area: ${dimensions[0].label.toLowerCase()}.`
            : null;

        const sameStressCue = comparison.nativeStressedSyllable === comparison.userStressedSyllable;
        const stressLine = comparison.stressMatches
            ? sameStressCue
                ? `Stress: target syllable ${comparison.nativeStressedSyllable || 1}; your strongest cue lands there too.`
                : `Stress: target syllable ${comparison.nativeStressedSyllable || 1}; the overall pattern matches, but your strongest cue lands on syllable ${comparison.userStressedSyllable || 1}.`
            : `Stress: target syllable ${comparison.nativeStressedSyllable || 1}; your strongest cue landed on syllable ${comparison.userStressedSyllable || 1}.`;

        const mainFix = this.buildPrimaryAction(comparison, userSyllables);

        return {
            overview,
            strongestLine,
            stressLine,
            mainFix,
            coachNote: this.buildCoachNote(comparison, userSyllables, {
                strongestLine,
                mainFix
            })
        };
    }

    buildCoachNote(comparison, userSyllables, quickFeedback) {
        const expectedCount = this.expectedData?.syllables || this.nativePattern?.length || comparison.syllables?.length || 1;
        const strongestArea = quickFeedback?.strongestLine
            ? quickFeedback.strongestLine.replace(/^Best area:\s*/i, '').replace(/\.$/, '')
            : null;

        let opening = 'That was a solid attempt.';
        if (comparison.overallScore >= 92) {
            opening = 'That was very close to the native model.';
        } else if (comparison.overallScore >= 80) {
            opening = 'That was a strong attempt overall.';
        } else if (comparison.overallScore < 60) {
            opening = 'That was a useful try, and the next adjustment is clear.';
        }

        const strengthSentence = strongestArea
            ? `Your ${strongestArea} is already working well.`
            : (comparison.stressMatches
                ? 'Your stress placement is heading in the right direction.'
                : 'You already have parts of the word shape in place.');

        let focusSentence = '';
        if (!comparison.syllableCountMatches) {
            if (userSyllables.length > expectedCount) {
                focusSentence = `The main thing now is to keep the word in ${expectedCount} syllable${expectedCount === 1 ? '' : 's'} so the ending stays attached instead of breaking into an extra beat.`;
            } else {
                focusSentence = `The main thing now is to give all ${expectedCount} syllable${expectedCount === 1 ? '' : 's'} enough space so the word does not get compressed.`;
            }
        } else if (!comparison.stressMatches) {
            focusSentence = `Keep your strongest energy on syllable ${comparison.nativeStressedSyllable || 1}; that will make the word sound more natural right away.`;
        } else if (quickFeedback?.mainFix?.startsWith('Keep this pattern')) {
            focusSentence = 'At this point, stay relaxed and repeat the same rhythm and emphasis on the next try.';
        } else {
            const rewrittenFix = quickFeedback?.mainFix
                ? quickFeedback.mainFix.charAt(0).toLowerCase() + quickFeedback.mainFix.slice(1)
                : 'keep matching the native rhythm';
            focusSentence = `To make it sound even cleaner, ${rewrittenFix}`;
        }

        const closing = comparison.overallScore >= 90
            ? 'Listen once more and say it again the same way; you are very close.'
            : 'Listen once more, make that one adjustment, and try again.';

        return `${opening} ${strengthSentence} ${focusSentence} ${closing}`;
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
        const quickFeedback = this.buildQuickFeedback(comparison, userSyllables);

        let html = `
            <div class="pa-comparison-result">
                <div style="text-align: center; margin-bottom: 16px;">
                    <div style="font-size: 2rem; font-weight: bold; color: ${scoreColor};">
                        ${scoreEmoji} ${comparison.overallScore}%
                    </div>
                    <div style="color: #6b7280; font-size: 0.9rem;">Prosody Match Score</div>
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

                <div style="margin-bottom: 20px; padding: 16px; background: #f8fafc; border-radius: 12px; border: 1px solid #dbeafe;">
                    <div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 10px; color: #1e3a8a;">Quick Feedback</div>
                    <div style="color: #334155; font-size: 0.92rem; line-height: 1.55;">
                        <div style="margin-bottom: 6px;">${quickFeedback.overview}</div>
                        ${quickFeedback.strongestLine ? `<div style="margin-bottom: 6px;"><strong>Keep:</strong> ${quickFeedback.strongestLine}</div>` : ''}
                        <div style="margin-bottom: 6px;"><strong>${comparison.stressMatches ? 'Stress:' : 'Stress check:'}</strong> ${quickFeedback.stressLine.replace(/^Stress:\s*/, '')}</div>
                        <div><strong>Main fix:</strong> ${quickFeedback.mainFix}</div>
                    </div>
                </div>

                <div style="margin-bottom: 20px; padding: 16px; background: #fff8e8; border-radius: 12px; border: 1px solid #fde68a;">
                    <div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 10px; color: #92400e;">Coach's Note</div>
                    <div style="color: #7c2d12; font-size: 0.92rem; line-height: 1.6;">
                        ${quickFeedback.coachNote}
                    </div>
                </div>

                <div style="margin-bottom: 20px; padding: 16px; background: #f0f9ff; border-radius: 12px; border: 1px solid #bae6fd;">
                    <div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 12px; color: #0c4a6e;">🎤 Your Syllable Breakdown:</div>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                            <thead>
                                <tr style="background: #e0f2fe; color: #075985;">
                                    <th style="padding: 8px 10px; text-align: left; border-bottom: 2px solid #7dd3fc;">Syllable</th>
                                    <th style="padding: 8px 10px; text-align: center; border-bottom: 2px solid #7dd3fc;">Start</th>
                                    <th style="padding: 8px 10px; text-align: center; border-bottom: 2px solid #7dd3fc;">Duration</th>
                                    <th style="padding: 8px 10px; text-align: center; border-bottom: 2px solid #7dd3fc;">Pitch</th>
                                    <th style="padding: 8px 10px; text-align: center; border-bottom: 2px solid #7dd3fc;">Energy</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${userSyllables.map((s, i) => {
                                    const label = this.getSyllableLabels()?.[i] || `Syl ${i + 1}`;
                                    const isStressed = comparison.syllables?.[i]?.isUserStressed ?? (comparison.userStressedSyllable === i + 1);
                                    const startTime = s.startTime != null ? s.startTime.toFixed(3) + 's' : '-';
                                    const duration = s.duration != null ? s.duration.toFixed(3) + 's' : '-';
                                    const pitch = s.maxPitch > 0 ? Math.round(s.maxPitch) + ' Hz' : '<span style="color:#9ca3af">—</span>';
                                    const energy = (s.intensity || s.maxEnergy) > 0 ? (s.intensity || s.maxEnergy).toFixed(1) : '<span style="color:#9ca3af">—</span>';
                                    const stressBadge = isStressed ? ' <span style="background:#fbbf24;color:#78350f;font-size:0.7rem;padding:1px 5px;border-radius:4px;font-weight:600;">STRESS</span>' : '';
                                    return `<tr style="border-bottom: 1px solid #e0f2fe;">
                                        <td style="padding: 6px 10px; font-weight: 600; color: #1e40af;">${label}${stressBadge}</td>
                                        <td style="padding: 6px 10px; text-align: center; color: #475569;">${startTime}</td>
                                        <td style="padding: 6px 10px; text-align: center; color: #475569; font-weight: 500;">${duration}</td>
                                        <td style="padding: 6px 10px; text-align: center; color: #3b82f6;">${pitch}</td>
                                        <td style="padding: 6px 10px; text-align: center; color: #10b981;">${energy}</td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
                
        `;
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
                this.nativeAudioUrl = proxiedUrl;
                this.nativeAudio.src = proxiedUrl;
                this.nativeAudioContainer.style.display = 'flex';
                this.nativeAudioPlayer.setAudioElement(this.nativeAudio);
                this.nativeAudioPlayer.preload(proxiedUrl).catch(() => {});

                // Play audio automatically when switching forms (optional but nice)
                // this.nativeAudio.play().catch(() => {}); 
            } else {
                this.nativeAudioUrl = null;
                this.nativeAudioContainer.style.display = 'none';
                this.nativeAudioPlayer.clearSource();
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

        if (!wordRef.audioUrl) {
            this.nativeAudioUrl = null;
            this.nativeAudioPlayer.clearSource();
        }
    }

    /**
     * Render buttons to switch between word forms (Noun, Verb, etc.)
     */
    renderWordFormSelector(alternatives) {
        if (!this.wordForms) return;

        this.wordForms.innerHTML = '';
        this.wordForms.classList.add('hidden');

        // Filter valid alternatives (must have definitions or audio)
        const validAlts = (alternatives || []).filter(a => a.definition || a.audioUrl);

        if (validAlts.length <= 1) {
            return;
        }

        this.wordForms.classList.remove('hidden');

        validAlts.forEach((alt, index) => {
            const btn = document.createElement('button');

            // Get POS and normalize for class name
            const pos = (alt.partOfSpeech || 'default').toLowerCase().replace(/[^a-z]/g, '');
            const posClass = `pa-pos-${['noun', 'verb', 'adj', 'adv'].includes(pos) ? pos : 'default'}`;

            btn.className = `pa-word-form-btn ${posClass}`;

            // Text: Part of Speech + IPA
            const posDisplay = alt.partOfSpeech || 'Word';
            const posFormatted = posDisplay.charAt(0).toUpperCase() + posDisplay.slice(1);
            const ipa = alt.pronunciation ? ` /${alt.pronunciation}/` : '';

            // Add indicator for inherited pronunciation
            if (alt.inheritedPronunciation) {
                btn.innerHTML = `<span>${posFormatted}${ipa}</span> <span style="font-size: 0.75em; opacity: 0.7; font-weight: normal; margin-left: 4px;">(Shared)</span>`;
            } else {
                btn.innerHTML = `<span>${posFormatted}${ipa}</span>`;
            }

            // Highlight the first one initially
            if (index === 0) {
                btn.classList.add('active');
            }

            btn.onclick = () => {
                this.displayWordData(alt);
                this.highlightSelectedForm(btn);
            };

            this.wordForms.appendChild(btn);
        });
    }

    highlightSelectedForm(selectedBtn) {
        if (!this.wordForms) return;
        const buttons = this.wordForms.querySelectorAll('button');
        buttons.forEach(btn => {
            btn.classList.remove('active');
        });
        selectedBtn.classList.add('active');
    }
}

