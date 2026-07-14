import { AudioCapture } from './audio-capture.js';
import { PitchAnalyzer } from './pitch-analyzer.js';
import { SyllableDetector } from './syllable-detector.js';
import { StressVisualizer } from './stress-visualizer.js';
import { PraatAPI } from './praat-api.js';
import { WordReferenceService } from './word-reference-service.js';
import { NativeAudioPlayer } from './native-audio-player.js';
import { config } from './config.js';
import { analyzeRecordedAttempt } from './analysis-pipeline.js';
import {
    getSelectableReferenceVariants,
    hasUsableNativeContours,
    selectReferenceVariant
} from './reference-contract.js';
import { buildLexicalFallbackFeedback, canShowDetailedFeedback } from './chart-data.js';
import { buildPronunciationSummary } from './pronunciation-summary.js';

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
        this.currentReference = null;
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
        this.syllableCountDisplay = document.getElementById('pa-syllable-count');
        this.primaryStressDisplay = document.getElementById('pa-primary-stress');
        this.secondaryStressDisplay = document.getElementById('pa-secondary-stress');
        this.primaryStressFact = document.getElementById('pa-primary-stress-fact');
        this.secondaryStressFact = document.getElementById('pa-secondary-stress-fact');
        this.syllableStrip = document.getElementById('pa-syllable-strip');
        this.wordInfo = document.getElementById('pa-word-info');
        this.wordForms = document.getElementById('pa-word-forms');
        this.loadingPlaceholder = document.getElementById('pa-loading-placeholder');
        this.referenceStatus = document.getElementById('pa-reference-status');
        this.chartsContainer = document.getElementById('pa-charts-container');
        this.feedbackSection = document.getElementById('pa-feedback-section');

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

        // Initialize v3 support check (fire-and-forget, caches the result)
        this.praatAPI.checkV3Support().catch(() => {});

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

        // Native play button click
        const playNativeBtn = document.getElementById('pa-play-native-btn');
        if (playNativeBtn) {
            playNativeBtn.addEventListener('click', () => {
                if (this.nativeAudio) {
                    this.nativeAudio.currentTime = 0;
                    this.nativeAudio.play().catch((err) => {
                        console.error('Error playing native audio:', err);
                    });
                }
            });
        }
    }

    async updateWordData() {
        const word = this.wordInput.value.trim();
        if (!word) return;

        try {
            this.statusIndicator.textContent = "Loading native reference...";
            this.spinner.style.display = 'block';
            this.resetReferenceState();

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

            const wordRef = await this.wordRefService.getWordReference(word);
            this.currentReference = wordRef;

            if (this.loadingPlaceholder) this.loadingPlaceholder.style.display = 'none';

            const selectableVariants = wordRef?.variants?.length
                ? getSelectableReferenceVariants(wordRef)
                : [];

            if (selectableVariants.length) {
                // Show containers
                if (this.wordInfo) this.wordInfo.classList.remove('hidden');

                this.renderWordFormSelector(selectableVariants, wordRef.defaultVariantId);
                const initialVariant = selectableVariants.some(
                    (variant) => variant.id === wordRef.defaultVariantId
                )
                    ? selectReferenceVariant(wordRef)
                    : selectableVariants[0];
                this.displayWordData(initialVariant);
            } else {
                this.showReferenceUnavailable('Pronunciation reference under review.');
            }

        } catch (err) {
            Logger.error("Error fetching word data:", err);
            if (this.loadingPlaceholder) this.loadingPlaceholder.style.display = 'none';
            if (this.wordInfo) this.wordInfo.classList.remove('hidden');
            if (this.wordForms) this.wordForms.classList.add('hidden');
            this.clearPronunciationSummary({
                ipa: 'Error',
                message: err.message || 'Failed to load'
            });
            this.statusIndicator.textContent = "Error";
            this.nativePattern = null;
            this.nativeAudioPlayer.clearSource();
            if (this.nativeAudioContainer) this.nativeAudioContainer.style.display = 'none';
            if (this.referenceStatus) {
                this.referenceStatus.textContent = 'Pronunciation reference could not be loaded. Please try again.';
                this.referenceStatus.classList.add('pa-reference-status--conflict');
            }
            if (this.chartsContainer) this.chartsContainer.classList.add('hidden');
            if (this.feedbackSection) this.feedbackSection.style.display = 'none';
            this.recordBtn.disabled = true;
            this.stopBtn.disabled = true;
        } finally {
            this.spinner.style.display = 'none';
        }
    }

    resetReferenceState() {
        this.currentWordRef = null;
        this.currentReference = null;
        this.nativePattern = null;
        this.nativeAudioUrl = null;
        this.userAudioBlob = null;
        this.visualizer?.clear();
        this.nativeAudioPlayer.clearSource();
        if (this.nativeAudio) {
            this.nativeAudio.removeAttribute('src');
            this.nativeAudio.load();
        }
        if (this.nativeAudioContainer) this.nativeAudioContainer.style.display = 'none';
        if (this.referenceStatus) {
            this.referenceStatus.textContent = '';
            this.referenceStatus.classList.remove('pa-reference-status--conflict');
        }
        if (this.chartsContainer) this.chartsContainer.classList.add('hidden');
        if (this.feedbackSection) this.feedbackSection.style.display = 'none';
        if (this.resultsSummary) this.resultsSummary.innerHTML = '';
        this.recordBtn.disabled = true;
        this.stopBtn.disabled = true;
    }

    clearPronunciationSummary({
        ipa = 'Unavailable',
        message = 'Pronunciation reference unavailable.'
    } = {}) {
        if (this.ipaDisplay) this.ipaDisplay.textContent = ipa;
        if (this.patternDisplay) this.patternDisplay.textContent = message;
        if (this.syllableCountDisplay) this.syllableCountDisplay.textContent = 'Unavailable';
        if (this.primaryStressFact) this.primaryStressFact.hidden = true;
        if (this.secondaryStressFact) this.secondaryStressFact.hidden = true;
        if (this.syllableStrip) this.syllableStrip.replaceChildren();
    }

    clearLearnerAttemptState() {
        this.userAudioBlob = null;
        if (this.syllableVerifier) {
            this.syllableVerifier.destroy();
            this.syllableVerifier = null;
        }
        const verifierContainer = document.getElementById('syllable-verifier-container');
        if (verifierContainer) verifierContainer.replaceChildren();
        if (this.resultsSummary) this.resultsSummary.replaceChildren();
        if (this.feedbackSection) this.feedbackSection.style.display = 'none';
    }

    showReferenceUnavailable(message) {
        this.clearPronunciationSummary();
        if (this.referenceStatus) {
            this.referenceStatus.textContent = message;
            this.referenceStatus.classList.add('pa-reference-status--conflict');
        }
        this.recordBtn.disabled = true;
        this.stopBtn.disabled = true;
        this.statusIndicator.textContent = 'Reference unavailable';
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
                    praatAnalyze: (blob) => this.praatAPI.analyze(blob, expectedCount),
                    decodeBlob: (blob) => this.audioCapture.blobToAudioBuffer(blob),
                    pitchAnalyze: (audioBuffer) => this.pitchAnalyzer.analyze(audioBuffer),
                    detectSyllables: (analysisData) => this.syllableDetector.detect(analysisData),
                    onPendingStatus: (message) => {
                        if (this.statusIndicator) {
                            this.statusIndicator.textContent = message;
                        }
                    }
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
                        this.currentWordRef?.nativeAnalysis,
                        this.currentWordRef?.syllables || []
                    );
                    this.renderSyllableFeedback(
                        audioBlob,
                        analysis?.syllables || [],
                        0,
                        analysis?.quality,
                        analysis?.observed?.stressEvidence
                    );
                } else {
                    const analysisData = result.analysisData || { times: [], pitches: [], energies: [] };
                    const syllables = result.syllables || [];
                    const noiseCount = result.noiseCount || 0;

                    const learnerAnalysis = {
                        quality: result.quality,
                        observed: { syllableCount: syllables.length, syllables },
                        pitch: { times: analysisData.times, values: analysisData.pitches },
                        intensity: {
                            times: analysisData.times,
                            values: analysisData.energies.map((energy) => (
                                Number.isFinite(energy) && energy > 0
                                    ? 20 * Math.log10(energy)
                                    : null
                            ))
                        },
                        syllables
                    };
                    this.visualizer.drawComparisonPitchContour(
                        learnerAnalysis,
                        this.currentWordRef?.nativeAnalysis,
                        this.currentWordRef?.syllables || []
                    );
                    this.renderSyllableFeedback(
                        audioBlob,
                        syllables,
                        noiseCount,
                        result.quality,
                        { rateable: false, confidence: 0 }
                    );
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
        const syllables = this.currentWordRef?.nativeAnalysis?.observed?.syllables;
        if (!Array.isArray(syllables)) {
            return [];
        }

        return syllables.filter((syllable) => (
            Number.isFinite(syllable?.startTime) &&
            Number.isFinite(syllable?.endTime) &&
            syllable.endTime > syllable.startTime
        ));
    }

    renderSyllableFeedback(
        audioBlob,
        syllables,
        noiseCount = 0,
        learnerQuality = null,
        learnerStressEvidence = null
    ) {
        const targetCount = this.expectedData?.syllables || 0;
        const countsMatch = targetCount === syllables.length;
        const detailed = canShowDetailedFeedback({
            targetCount,
            observedCount: syllables.length,
            nativeQuality: this.currentWordRef?.nativeAnalysis?.quality,
            learnerQuality,
            nativeStressEvidence: this.currentWordRef?.nativeAnalysis?.observed?.stressEvidence,
            learnerStressEvidence
        });
        const lexicalFallback = buildLexicalFallbackFeedback({
            provider: this.currentWordRef?.source?.provider,
            targetCount,
            observedCount: syllables.length,
            targetPrimaryStress: this.expectedData?.primaryStress,
            observedPrimaryStress: learnerStressEvidence?.primaryStress,
            learnerQuality,
            learnerStressEvidence
        });

        if (!countsMatch) {
            this.visualizer.drawDurationChart(
                this.nativePattern || this.currentWordRef?.syllables || [],
                syllables
            );
            this.resultsSummary.textContent =
                `Target: ${targetCount} syllables. Observed: ${syllables.length}. ` +
                'A phoneme alignment is required to identify which syllable differs.';
        } else if (lexicalFallback && syllables.length > 0) {
            this.visualizer.drawDurationChart([], syllables);
            this.resultsSummary.textContent = lexicalFallback.message;
        } else if (detailed && this.nativePattern && syllables.length > 0) {
            const comparison = this.wordRefService.compareWithNative(
                syllables,
                this.nativePattern
            );
            this.visualizer.drawDurationChart(this.nativePattern, syllables);
            this.generateComparisonSummary(syllables, comparison);
        } else if (syllables.length > 0) {
            this.visualizer.drawDurationChart([], syllables);
            this.resultsSummary.textContent =
                'The recording was detected, but confidence is too low for detailed stress feedback. Please try again.';
        } else {
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
        const syllables = this.currentWordRef?.syllables;
        if (!Array.isArray(syllables) || syllables.length !== this.expectedData?.syllables) {
            return null;
        }
        return syllables.map((syllable) => syllable.label || syllable.ipa);
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
                <div class="pa-results-header">
                    <div class="pa-results-score" style="color: ${scoreColor};">
                        ${scoreEmoji} ${comparison.overallScore}%
                    </div>
                    <div class="pa-results-score-label">Prosody Match Score</div>
                </div>

                <div class="pa-results-metrics">
                    <div class="pa-results-metric-card">
                        <div class="pa-results-metric-val" style="color: #3b82f6;">${comparison.pitchScore}%</div>
                        <div class="pa-results-metric-label">Pitch</div>
                    </div>
                    <div class="pa-results-metric-card">
                        <div class="pa-results-metric-val" style="color: #8b5cf6;">${comparison.durationScore}%</div>
                        <div class="pa-results-metric-label">Duration</div>
                    </div>
                    <div class="pa-results-metric-card">
                        <div class="pa-results-metric-val" style="color: #10b981;">${comparison.intensityScore}%</div>
                        <div class="pa-results-metric-label">Volume</div>
                    </div>
                </div>

                <div class="pa-results-callout pa-results-callout--feedback">
                    <div class="pa-results-callout-title">Quick Feedback</div>
                    <div class="pa-results-callout-body">
                        <div style="margin-bottom: 6px;">${quickFeedback.overview}</div>
                        ${quickFeedback.strongestLine ? `<div style="margin-bottom: 6px;"><strong>Keep:</strong> ${quickFeedback.strongestLine}</div>` : ''}
                        <div style="margin-bottom: 6px;"><strong>${comparison.stressMatches ? 'Stress:' : 'Stress check:'}</strong> ${quickFeedback.stressLine.replace(/^Stress:\s*/, '')}</div>
                        <div><strong>Main fix:</strong> ${quickFeedback.mainFix}</div>
                    </div>
                </div>

                <div class="pa-results-callout pa-results-callout--coach">
                    <div class="pa-results-callout-title">Coach's Note</div>
                    <div class="pa-results-callout-body">
                        ${quickFeedback.coachNote}
                    </div>
                </div>

                <div class="pa-results-callout pa-results-callout--breakdown" style="padding-bottom: 20px;">
                    <div class="pa-results-callout-title">🎤 Your Syllable Breakdown:</div>
                    <div style="overflow-x: auto;">
                        <table class="pa-breakdown-table">
                            <thead>
                                <tr>
                                    <th>Syllable</th>
                                    <th style="text-align: center;">Start</th>
                                    <th style="text-align: center;">Duration</th>
                                    <th style="text-align: center;">Pitch</th>
                                    <th style="text-align: center;">Energy</th>
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
                                    return `<tr>
                                        <td style="font-weight: 600;">${label}${stressBadge}</td>
                                        <td style="text-align: center;">${startTime}</td>
                                        <td style="text-align: center; font-weight: 500;">${duration}</td>
                                        <td style="text-align: center;">${pitch}</td>
                                        <td style="text-align: center;">${energy}</td>
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
    renderPronunciationSummary(wordRef) {
        const summary = buildPronunciationSummary(wordRef);
        if (this.ipaDisplay) this.ipaDisplay.textContent = summary.ipa;
        if (this.patternDisplay) this.patternDisplay.textContent = summary.accessibleText;
        if (this.syllableCountDisplay) this.syllableCountDisplay.textContent = summary.countLabel;

        if (this.primaryStressFact) {
            this.primaryStressFact.hidden = !summary.primaryLabel;
        }
        if (this.primaryStressDisplay) {
            this.primaryStressDisplay.textContent = summary.primaryLabel || '';
        }
        if (this.secondaryStressFact) {
            this.secondaryStressFact.hidden = summary.secondaryLabels.length === 0;
        }
        if (this.secondaryStressDisplay) {
            this.secondaryStressDisplay.textContent = summary.secondaryLabels.join(', ');
        }

        if (this.syllableStrip) {
            const elements = summary.syllables.map((syllable) => {
                const element = document.createElement('span');
                element.className = `pa-syllable pa-syllable--${syllable.stress}`;

                const label = document.createElement('span');
                label.className = 'pa-syllable-label';
                label.textContent = syllable.label;
                element.appendChild(label);

                if (syllable.stress === 'primary' || syllable.stress === 'secondary') {
                    const role = document.createElement('small');
                    role.className = 'pa-syllable-role';
                    role.textContent = syllable.stress === 'primary' ? 'Primary' : 'Secondary';
                    element.appendChild(role);
                }
                return element;
            });
            this.syllableStrip.replaceChildren(...elements);
        }
    }

    displayWordData(wordRef) {
        if (!wordRef) return;

        this.currentWordRef = wordRef;
        const isValid = wordRef.validation?.status === 'valid';
        const isCmuFallback = wordRef.source?.provider === 'cmu-pronouncing-dictionary';
        const canScore = isValid && wordRef.capabilities.scoreCountStress;
        const canShowGraphs = (
            isValid &&
            wordRef.capabilities.showNativeGraphs &&
            hasUsableNativeContours(wordRef.nativeAnalysis)
        );
        const contourOnly = canShowGraphs && wordRef.nativeAnalysis?.quality?.rateable !== true;

        this.expectedData = {
            ipa: wordRef.displayIpa || '',
            syllables: wordRef.syllableCount,
            primaryStress: wordRef.primaryStress,
            secondaryStress: wordRef.secondaryStress || [],
            variantId: wordRef.id
        };

        this.renderPronunciationSummary(wordRef);
        if (this.referenceStatus) {
            this.referenceStatus.textContent = !isValid
                ? 'Pronunciation reference under review.'
                : isCmuFallback
                    ? 'CMU pronunciation fallback · native audio and contour unavailable.'
                    : contourOnly
                        ? 'Native pitch and volume shown. Syllable duration analysis is unavailable for this recording.'
                        : '';
            this.referenceStatus.classList.toggle('pa-reference-status--conflict', !isValid);
        }
        this.recordBtn.disabled = !canScore;
        this.stopBtn.disabled = true;
        if (this.feedbackSection) this.feedbackSection.style.display = 'none';
        if (this.resultsSummary) this.resultsSummary.innerHTML = '';

        // Show native audio player if audio available
        if (this.nativeAudio && this.nativeAudioContainer) {
            if (wordRef.audioUrl && wordRef.capabilities.playAudio) {
                const proxiedUrl = this.wordRefService.getProxiedAudioUrl(wordRef.audioUrl);
                this.nativeAudioUrl = proxiedUrl;
                this.nativeAudio.src = proxiedUrl;
                this.nativeAudioContainer.style.display = 'flex';
                this.nativeAudioPlayer.setAudioElement(this.nativeAudio);
                this.nativeAudioPlayer.preload(proxiedUrl).catch(() => {});

            } else {
                this.nativeAudioUrl = null;
                this.nativeAudioContainer.style.display = 'none';
                this.nativeAudioPlayer.clearSource();
            }
        }

        if (this.visualizer) {
            this.visualizer.clear();
            if (canShowGraphs && wordRef.nativeAnalysis.pitch?.values?.length > 0) {
                this.visualizer.drawNativePitchContour(
                    wordRef.nativeAnalysis,
                    wordRef.nativeAnalysis?.observed?.syllables || [],
                    wordRef.syllables || []
                );
                this.nativePattern = this.wordRefService.getExpectedPattern(wordRef);
                this.chartsContainer?.classList.remove('hidden');
            } else {
                this.nativePattern = null;
                this.chartsContainer?.classList.add('hidden');
            }
        }

        if (this.statusIndicator) {
            this.statusIndicator.textContent = canScore ? 'Ready' : 'Reference unavailable';
        }

        if (!wordRef.audioUrl) {
            this.nativeAudioUrl = null;
            this.nativeAudioPlayer.clearSource();
        }
    }

    /**
     * Render buttons to switch between word forms (Noun, Verb, etc.)
     */
    renderWordFormSelector(alternatives, selectedVariantId = null) {
        if (!this.wordForms) return;

        this.wordForms.innerHTML = '';
        this.wordForms.classList.add('hidden');

        const validAlts = (alternatives || []).filter((variant) => (
            variant?.validation?.status === 'valid' &&
            variant?.source?.exactMatch === true &&
            variant?.capabilities?.scoreCountStress === true &&
            variant?.displayIpa &&
            variant?.syllableCount > 0
        ));

        if (validAlts.length <= 1) {
            return;
        }

        this.wordForms.classList.remove('hidden');

        validAlts.forEach((alt, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';

            // Get POS and normalize for class name
            const pos = (alt.partOfSpeech || 'default').toLowerCase().replace(/[^a-z]/g, '');
            const posClass = `pa-pos-${['noun', 'verb', 'adj', 'adv'].includes(pos) ? pos : 'default'}`;

            btn.className = `pa-word-form-btn ${posClass}`;

            const posDisplay = alt.partOfSpeech || 'Word';
            const posFormatted = posDisplay.charAt(0).toUpperCase() + posDisplay.slice(1);
            btn.textContent = `${posFormatted}${alt.displayIpa ? ` ${alt.displayIpa}` : ''}`;
            btn.dataset.variantId = alt.id;
            btn.disabled = false;

            const isSelected = alt.id === selectedVariantId || (!selectedVariantId && index === 0);
            btn.setAttribute('aria-pressed', String(isSelected));
            if (isSelected) {
                btn.classList.add('active');
            }

            btn.onclick = () => {
                if (this.currentWordRef?.id !== alt.id) {
                    this.clearLearnerAttemptState();
                }
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
            btn.setAttribute('aria-pressed', 'false');
        });
        selectedBtn.classList.add('active');
        selectedBtn.setAttribute('aria-pressed', 'true');
    }
}

