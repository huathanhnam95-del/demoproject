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
import {
    attemptStatusFor,
    createAttemptKey,
    nextAttemptState,
    resetAttemptState
} from './verification-attempt-policy.js';

const LOCAL_PRONOUNCE_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

export function isLocalPronounceHost(hostname = null) {
    const resolvedHostname = hostname ?? (
        typeof window !== 'undefined' ? window.location?.hostname : ''
    );
    return LOCAL_PRONOUNCE_HOSTNAMES.has(String(resolvedHostname || '').toLowerCase());
}

function toSerializable(value) {
    try {
        return JSON.parse(JSON.stringify(value, (_key, candidate) => {
            if (typeof ArrayBuffer !== 'undefined' && (
                candidate instanceof ArrayBuffer || ArrayBuffer.isView(candidate)
            )) {
                return undefined;
            }
            return candidate;
        }));
    } catch (_error) {
        return null;
    }
}

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
        this.localSampleEnabled = isLocalPronounceHost();
        this.localSampleSnapshot = null;
        this.localSampleTools = null;
        this.localSampleSaveButton = null;
        this.localSampleStatus = null;
        this._verificationAttemptState = resetAttemptState();

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

        this.initLocalSampleTools();

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
                        this._verificationAttemptState = resetAttemptState();
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

    initLocalSampleTools() {
        if (!this.localSampleEnabled || !this.resultsSummary) return;

        const tools = document.createElement('div');
        tools.id = 'pa-local-debug-tools';
        tools.className = 'pa-local-debug-tools';
        tools.setAttribute('aria-label', 'Local pronunciation debugging tools');

        const button = document.createElement('button');
        button.id = 'pa-save-local-sample-btn';
        button.type = 'button';
        button.className = 'pa-btn pa-btn-local';
        button.textContent = '💾 Save sample locally';
        button.title = 'Save this recording and its analysis to the local test-results folder';
        button.disabled = true;

        const status = document.createElement('span');
        status.id = 'pa-local-sample-status';
        status.className = 'pa-local-sample-status';
        status.setAttribute('role', 'status');

        tools.append(button, status);
        this.resultsSummary.insertAdjacentElement('afterend', tools);

        this.localSampleTools = tools;
        this.localSampleSaveButton = button;
        this.localSampleStatus = status;
        button.addEventListener('click', () => this.saveLocalSample());
        this.clearLocalSampleSnapshot();
    }

    clearLocalSampleSnapshot(message = 'Local only · available after a recording is analyzed.') {
        this.localSampleSnapshot = null;
        if (this.localSampleSaveButton) {
            this.localSampleSaveButton.disabled = true;
        }
        if (this.localSampleStatus) {
            this.localSampleStatus.textContent = message;
            this.localSampleStatus.dataset.state = 'idle';
        }
    }

    buildLocalSampleMetadata(audioBlob, result, error = null) {
        const word = String(
            this.currentReference?.word || this.wordInput?.value || 'unknown'
        ).trim();
        const wordSlug = word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'word';
        const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
        const randomSuffix = globalThis.crypto?.randomUUID
            ? globalThis.crypto.randomUUID().slice(0, 8)
            : Math.random().toString(36).slice(2, 10);
        const variant = this.currentWordRef || {};
        const safeResult = toSerializable(result) || {};
        const referenceSyllables = Array.isArray(variant.syllables)
            ? variant.syllables.map((syllable, index) => ({
                index: syllable?.index ?? index,
                ipa: syllable?.ipa || null,
                label: syllable?.label || null,
                stress: syllable?.stress || null,
                syllabicConsonant: Boolean(syllable?.syllabicConsonant)
            }))
            : [];

        return {
            format: 'bel-pronounce-local-sample',
            schemaVersion: 1,
            source: 'pronounce-mode-local',
            sampleId: `${wordSlug}-${timestamp}-${randomSuffix}`,
            createdAt: new Date().toISOString(),
            word,
            reference: {
                variantId: variant.id || this.expectedData?.variantId || null,
                displayIpa: variant.learnerDisplayIpa || variant.displayIpa || this.expectedData?.ipa || null,
                rawIpa: variant.rawIpa || null,
                syllableCount: this.expectedData?.syllables ?? variant.syllableCount ?? null,
                primaryStress: this.expectedData?.primaryStress ?? variant.primaryStress ?? null,
                secondaryStress: Array.isArray(this.expectedData?.secondaryStress)
                    ? this.expectedData.secondaryStress
                    : (variant.secondaryStress || []),
                syllables: referenceSyllables,
                source: toSerializable(variant.source) || null
            },
            recording: {
                mimeType: audioBlob?.type || null,
                bytes: Number.isFinite(audioBlob?.size) ? audioBlob.size : null
            },
            analysis: {
                engine: safeResult.engine || null,
                usedPraatFallback: Boolean(safeResult.usedPraatFallback),
                quality: safeResult.quality || null,
                observedSyllables: safeResult.syllables || [],
                analysis: safeResult.analysis || null,
                analysisData: safeResult.analysisData || null,
                noiseCount: safeResult.noiseCount || 0,
                praatError: safeResult.praatError || null
            },
            error: error ? String(error.message || error) : null,
            browser: {
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null
            }
        };
    }

    setLocalSampleSnapshot(audioBlob, result, error = null) {
        if (!this.localSampleEnabled || !audioBlob) return;

        this.localSampleSnapshot = {
            audioBlob,
            metadata: this.buildLocalSampleMetadata(audioBlob, result, error)
        };
        if (this.localSampleSaveButton) {
            this.localSampleSaveButton.disabled = false;
        }
        if (this.localSampleStatus) {
            this.localSampleStatus.textContent = 'Local only · this recording is ready to save for debugging.';
            this.localSampleStatus.dataset.state = 'ready';
        }
    }

    async saveLocalSample() {
        if (!this.localSampleEnabled || !this.localSampleSnapshot) return;

        const { audioBlob, metadata } = this.localSampleSnapshot;
        if (this.localSampleSaveButton) {
            this.localSampleSaveButton.disabled = true;
        }
        if (this.localSampleStatus) {
            this.localSampleStatus.textContent = 'Saving locally…';
            this.localSampleStatus.dataset.state = 'saving';
        }

        try {
            const wavBlob = await this.praatAPI.ensureWav(audioBlob);
            const formData = new FormData();
            formData.append('audio', wavBlob, `${metadata.sampleId}.wav`);
            formData.append('metadata', JSON.stringify(metadata));

            const response = await fetch(`${config.backendUrl}/debug/pronounce-samples`, {
                method: 'POST',
                body: formData
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Local save failed (${response.status})`);
            }

            if (this.localSampleStatus) {
                this.localSampleStatus.textContent = `Saved locally: ${payload.audioPath || payload.sampleId || metadata.sampleId}`;
                this.localSampleStatus.dataset.state = 'saved';
            }
        } catch (error) {
            if (this.localSampleSaveButton) {
                this.localSampleSaveButton.disabled = false;
            }
            if (this.localSampleStatus) {
                this.localSampleStatus.textContent = `Local save failed: ${error.message || error}`;
                this.localSampleStatus.dataset.state = 'error';
            }
            Logger.error('Failed to save local Pronounce sample:', error);
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
        this.clearLocalSampleSnapshot();
        this._verificationAttemptState = resetAttemptState();
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
        this._verificationAttemptState = resetAttemptState();
        this.userAudioBlob = null;
        this.clearLocalSampleSnapshot();
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
            this.clearLocalSampleSnapshot('Local only · recording in progress…');

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

            let audioBlob = null;
            let result = null;
            let localSamplePrepared = false;
            try {
                const capture = await this.audioCapture.stopCapture();
                audioBlob = capture?.blob || null;
                if (!audioBlob) {
                    throw new Error('No audio recorded');
                }
                this.userAudioBlob = audioBlob;

                const expectedCount = this.expectedData?.syllables || null;
                result = await analyzeRecordedAttempt({
                    audioBlob,
                    expectedSyllables: expectedCount,
                    preferPraat: this.usePraatBackend,
                    praatAnalyze: (blob) => this.praatAPI.analyze(blob, expectedCount, {
                        referenceIpa: this.currentWordRef?.displayIpa || this.currentWordRef?.rawIpa,
                        targetWord: this.currentReference?.word,
                        variantId: this.currentWordRef?.id
                    }),
                    decodeBlob: (blob) => this.audioCapture.blobToAudioBuffer(blob),
                    pitchAnalyze: (audioBuffer) => this.pitchAnalyzer.analyze(audioBuffer),
                    detectSyllables: (analysisData) => this.syllableDetector.detect(analysisData),
                    onPendingStatus: (message) => {
                        if (this.statusIndicator) {
                            this.statusIndicator.textContent = message;
                        }
                    }
                });
                this.setLocalSampleSnapshot(audioBlob, result);
                localSamplePrepared = true;

                if (config.features?.usePronunciationV3LearnerAnalysis === true) {
                    // V3 is the sole authority for learner feedback. When the
                    // backend is unreachable the pipeline falls back to local
                    // analysis; that fallback must not render syllable or
                    // stress feedback in V3's place.
                    const isV3 = result.engine === 'praat'
                        && result.analysis?.analysisVersion === 'pronunciation-analysis-v3';
                    this.renderV3LearnerResult(
                        isV3 ? result.analysis.verification : null,
                        isV3 ? result.analysis.best_effort : null,
                        isV3 ? result.syllables : [],
                        audioBlob,
                        isV3 ? result.analysis : null
                    );
                    this._finishAnalysis('Idle');
                    return;
                }

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
                if (audioBlob && !localSamplePrepared) {
                    this.setLocalSampleSnapshot(audioBlob, result, err);
                }
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

    getVerificationAttemptKey() {
        return createAttemptKey({
            word: this.currentReference?.word,
            variantId: this.currentWordRef?.id,
            ipa: this.currentWordRef?.displayIpa || this.currentWordRef?.rawIpa,
            expectedCount: this.expectedData?.syllables
        });
    }

    renderV3LearnerResult(verification, bestEffort, syllables = [], audioBlob = null, analysis = null) {
        const key = this.getVerificationAttemptKey();
        const attemptStatus = attemptStatusFor(verification);
        const expectedCount = this.expectedData?.syllables;

        // Charts and playback are descriptive, not a verdict. They are driven
        // by the recognizer's syllable spans and Praat's contours, so they
        // render whenever segmentation exists — including when the count
        // could not be confirmed.
        this.renderV3Segmentation(analysis, syllables, audioBlob);

        if (attemptStatus === 'unavailable') {
            // Nothing was judged, so nothing is spent.
            this._verificationAttemptState = nextAttemptState(
                this._verificationAttemptState,
                { key, status: 'unavailable' }
            );
            this.resultsSummary.textContent = 'Pronunciation checking is temporarily unavailable. Your recording was not scored — please try again shortly.';
            return;
        }

        if (attemptStatus === 'verified' || attemptStatus === 'incorrect') {
            this._verificationAttemptState = nextAttemptState(
                this._verificationAttemptState,
                { key, status: attemptStatus }
            );
            const count = verification.count || {};
            const stress = verification.primary_stress || {};
            const shown = count.expected ?? expectedCount;
            if (attemptStatus === 'incorrect') {
                if (count.status === 'incorrect') {
                    this.resultsSummary.textContent = `Incorrect: heard ${count.observed ?? 'an unknown number of'} syllables; expected ${shown}.`;
                } else {
                    // Count was fine; the stress head is what failed. Never
                    // fall through to a "Verified" line here.
                    this.resultsSummary.textContent = `Incorrect: ${shown} syllables are correct, but the primary stress does not match syllable ${Number.isInteger(Number(stress.expected)) ? Number(stress.expected) + 1 : 'the expected one'}.`;
                }
            } else if (stress.applicable === false) {
                this.resultsSummary.textContent = `Verified: ${shown} syllable${shown === 1 ? '' : 's'} confirmed.`;
            } else {
                const expectedStress = Number(stress.expected);
                this.resultsSummary.textContent = `Verified: ${shown} syllables; primary stress matches syllable ${Number.isInteger(expectedStress) ? expectedStress + 1 : 'the expected'}.`;
            }
        } else {
            const state = nextAttemptState(this._verificationAttemptState, { key, status: 'unrateable' });
            this._verificationAttemptState = state;
            if (state.action === 'retry') {
                this.resultsSummary.textContent = `Could not analyze this recording reliably. Please make re-recording ${state.retryNumber} of 2.`;
            } else if (state.action === 'advisory' && bestEffort?.available) {
                const observed = bestEffort.observed_count;
                const strongest = bestEffort.expected_stress_appears_strongest;
                this.resultsSummary.textContent = `There was difficulty analyzing your recording. This result may be inaccurate. Observed syllables: ${observed ?? 'unclear'}${strongest === true ? '; expected stress appears strongest.' : ''}`;
            } else {
                this.resultsSummary.textContent = 'Could not analyze this recording reliably.';
            }
        }
    }

    /**
     * Draw the pitch and duration charts and arm syllable playback from V3
     * recognizer output. Independent of the formal verdict: a learner whose
     * count could not be confirmed still gets working charts and playback.
     */
    renderV3Segmentation(analysis, syllables = [], audioBlob = null) {
        const spans = (Array.isArray(syllables) ? syllables : []).filter((syllable) => (
            Number.isFinite(syllable?.startTime) &&
            Number.isFinite(syllable?.endTime) &&
            syllable.endTime > syllable.startTime
        ));

        if (!analysis || spans.length === 0) {
            this.visualizer?.clear();
            this.chartsContainer?.classList.add('hidden');
            if (audioBlob) {
                this.showSyllableVerifier(audioBlob, []);
            }
            return;
        }

        this.chartsContainer?.classList.remove('hidden');

        // Pitch contour: learner (Praat contours aligned to V3 spans) vs native.
        this.visualizer.drawComparisonPitchContour(
            analysis,
            this.currentWordRef?.nativeAnalysis,
            this.currentWordRef?.syllables || []
        );

        // Duration lanes: recognizer spans against the native pattern when we
        // have one, otherwise the learner's own spans alone.
        this.visualizer.drawDurationChart(this.getTargetDurationSyllables(), spans);

        if (audioBlob) {
            this.showSyllableVerifier(audioBlob, spans);
        }
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

    async canUseManualReview() {
        if (this.localSampleEnabled) return true;

        const user = window.firebaseAuthFunctions?.getCurrentUser?.() || window.auth?.currentUser;
        if (!user?.getIdToken) {
            this._manualReviewAccessUser = null;
            this._manualReviewAccessPromise = null;
            return false;
        }

        if (!this._manualReviewAccessPromise || this._manualReviewAccessUser !== user) {
            this._manualReviewAccessUser = user;
            this._manualReviewAccessPromise = (async () => {
                try {
                    const idToken = await user.getIdToken();
                    const response = await fetch('/api/admin/status', {
                        method: 'GET',
                        headers: { Authorization: `Bearer ${idToken}` },
                        cache: 'no-store'
                    });
                    const payload = await response.json().catch(() => null);
                    return Boolean(response.ok && payload?.success && payload?.isAdmin);
                } catch (_error) {
                    return false;
                }
            })();
        }

        return this._manualReviewAccessPromise;
    }

    /**
     * Show syllable verification waveform with click-to-play
     */
    async showSyllableVerifier(audioBlob, syllables) {
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
        const enableManualReview = await this.canUseManualReview();

        // Create a single learner waveform. Native audio remains available in
        // the reference player above; the verifier is reserved for learner
        // segmentation and manual review.
        this.syllableVerifier = new window.SyllableVerifier('syllable-verifier-container', {
            enableManualReview,
            onManualSave: (segments) => this.saveManualReview(segments)
        });
        this.syllableVerifier.loadAudio(audioBlob, syllables, syllableLabels);
    }

    buildManualReviewMetadata(manualSegments) {
        const word = String(
            this.currentReference?.word || this.wordInput?.value || 'unknown'
        ).trim();
        const wordSlug = word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'word';
        const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
        const randomSuffix = globalThis.crypto?.randomUUID
            ? globalThis.crypto.randomUUID().slice(0, 8)
            : Math.random().toString(36).slice(2, 10);
        const targetCount = Math.max(
            1,
            Number(this.expectedData?.syllables || this.currentWordRef?.syllableCount || manualSegments.length || 1)
        );
        const observedCount = manualSegments.length;
        const category = observedCount === targetCount
            ? 'clean'
            : (observedCount < targetCount ? 'omission' : 'insertion');
        const toSpan = (segment, index) => {
            const startTime = Number(segment?.startTime ?? segment?.start);
            const endTime = Number(segment?.endTime ?? segment?.end);
            return {
                index,
                startTime,
                endTime,
                duration: endTime - startTime
            };
        };
        const automaticSegments = Array.isArray(this.syllableVerifier?.syllables)
            ? this.syllableVerifier.syllables.map(toSpan)
            : [];

        return {
            sampleId: `${wordSlug}-manual-review-${timestamp}-${randomSuffix}`,
            targetWord: word,
            referenceIpa: String(
                this.currentWordRef?.learnerDisplayIpa || this.currentWordRef?.displayIpa || this.currentWordRef?.rawIpa || this.expectedData?.ipa || ''
            ).trim(),
            expectedObservedCount: observedCount,
            targetSyllableCount: targetCount,
            category,
            speakerCohort: 'pronounce-manual-review',
            needsRerecording: false,
            rerecordReason: null,
            needsManualReview: true,
            reviewReason: 'manual_syllable_segmentation',
            manualSegments: manualSegments.map(toSpan),
            automaticSegments
        };
    }

    buildLocalManualReviewMetadata(manualSegments, reviewMetadata = null) {
        const normalizedReviewMetadata = reviewMetadata || this.buildManualReviewMetadata(manualSegments);
        const localMetadata = this.buildLocalSampleMetadata(this.userAudioBlob, {
            engine: 'manual-review',
            quality: {
                rateable: false,
                confidence: 0,
                reasons: ['MANUAL_SYLLABLE_SEGMENTATION']
            },
            syllables: normalizedReviewMetadata.automaticSegments,
            analysis: {
                manualSegments: normalizedReviewMetadata.manualSegments,
                automaticSegments: normalizedReviewMetadata.automaticSegments,
                reviewReason: normalizedReviewMetadata.reviewReason
            }
        });
        localMetadata.sampleId = normalizedReviewMetadata.sampleId;
        localMetadata.manualReview = normalizedReviewMetadata;
        localMetadata.analysis.manualSegments = normalizedReviewMetadata.manualSegments;
        localMetadata.analysis.automaticSegments = normalizedReviewMetadata.automaticSegments;
        return localMetadata;
    }

    getTargetDurationSyllables() {
        const candidates = [
            this.nativePattern,
            this.currentWordRef?.nativeAnalysis?.observed?.syllables
        ];
        return candidates.find((candidate) => (
            Array.isArray(candidate) &&
            candidate.length > 0 &&
            candidate.some((syllable) => Number.isFinite(Number(
                syllable?.vowelDuration ?? syllable?.duration
            )))
        )) || [];
    }

    async saveManualReview(manualSegments) {
        if (!this.userAudioBlob) {
            throw new Error('The recording is no longer available. Please record it again.');
        }
        if (!Array.isArray(manualSegments) || manualSegments.length === 0) {
            throw new Error('Mark at least one syllable before saving.');
        }

        const metadata = this.buildManualReviewMetadata(manualSegments);
        const wavBlob = await this.praatAPI.ensureWav(this.userAudioBlob);
        const formData = new FormData();
        formData.append('audio', wavBlob, `${metadata.sampleId}.wav`);

        if (this.localSampleEnabled) {
            const localMetadata = this.buildLocalManualReviewMetadata(manualSegments, metadata);
            formData.append('metadata', JSON.stringify(localMetadata));
            const response = await fetch(`${config.backendUrl}/debug/pronounce-samples`, {
                method: 'POST',
                body: formData
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Local manual review save failed (${response.status})`);
            }
            return {
                ...(payload.data || payload),
                destination: 'local',
                sampleId: payload.sampleId || localMetadata.sampleId
            };
        }

        const user = window.firebaseAuthFunctions?.getCurrentUser?.() || window.auth?.currentUser;
        if (!user?.getIdToken) {
            throw new Error('Cloud save requires an authenticated admin account.');
        }

        const idToken = await user.getIdToken();
        formData.append('metadata', JSON.stringify(metadata));

        const response = await fetch('/api/admin/dev/save-corpus-sample', {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}` },
            body: formData
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || payload.error || `Cloud save failed (${response.status})`);
        }

        return payload.data || payload;
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
        const attemptKey = this.getVerificationAttemptKey();
        const markUnrateableAttempt = () => {
            this._verificationAttemptState = nextAttemptState(
                this._verificationAttemptState,
                { key: attemptKey, status: 'unrateable' }
            );
            return this._verificationAttemptState;
        };
        const resetFormalAttempt = () => {
            this._verificationAttemptState = resetAttemptState(attemptKey);
        };
        const targetDurationSyllables = this.getTargetDurationSyllables();
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
                targetDurationSyllables,
                syllables
            );
            this.resultsSummary.textContent =
                `Target: ${targetCount} syllables. Observed: ${syllables.length}. ` +
                'A phoneme alignment is required to identify which syllable differs.';
        } else if (lexicalFallback && syllables.length > 0) {
            resetFormalAttempt();
            this.visualizer.drawDurationChart(targetDurationSyllables, syllables);
            this.resultsSummary.textContent = lexicalFallback.message;
        } else if (detailed && targetDurationSyllables.length > 0 && syllables.length > 0) {
            resetFormalAttempt();
            const comparison = this.wordRefService.compareWithNative(
                syllables,
                targetDurationSyllables
            );
            this.visualizer.drawDurationChart(targetDurationSyllables, syllables);
            this.generateComparisonSummary(syllables, comparison);
        } else if (syllables.length > 0) {
            this.visualizer.drawDurationChart(targetDurationSyllables, syllables);
            const state = markUnrateableAttempt();
            this.resultsSummary.textContent = state.action === 'retry'
                ? `Could not analyze this recording reliably. Please make re-recording ${state.retryNumber} of 2.`
                : 'There was difficulty analyzing your recording. This result may be inaccurate. You can save it for manual review.';
        } else {
            this.generateSummary(syllables, noiseCount);
        }

        if (audioBlob) {
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

        this.resultsSummary.innerHTML = `
      ${noiseHtml}
      <div style="margin-bottom: 8px;"><strong>${syllables.length}</strong> syllables detected:</div>
      <ul style="list-style: none; padding-left: 0; margin-bottom: 12px; font-size: 0.9em; color: #4b5563;">
        ${detailsHtml}
      </ul>
      <div style="color: #6b7280; font-size: 0.85em;">Stress could not be verified reliably from this recording.</div>
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
            ipa: wordRef.learnerDisplayIpa || wordRef.displayIpa || '',
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
                        : wordRef.audioUrl && !canShowGraphs
                            ? 'Native contour temporarily unavailable. It will be retried automatically.'
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
            const learnerIpa = alt.learnerDisplayIpa || alt.displayIpa;
            btn.textContent = `${posFormatted}${learnerIpa ? ` ${learnerIpa}` : ''}`;
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

