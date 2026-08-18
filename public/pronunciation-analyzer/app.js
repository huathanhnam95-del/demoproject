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
import {
    buildLexicalFallbackFeedback,
    canShowDetailedFeedback,
    normalizeChartSpans,
    normalizePlaybackSpans
} from './chart-data.js';
import { buildPronunciationSummary } from './pronunciation-summary.js';
import {
    buildComparisonSaveMetadata,
    buildComparisonViewModel,
    isCompleteComparison
} from './version-comparison.js';
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

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatComparisonMetric(value, key) {
    if (value === null || value === undefined || value === '') return 'Unavailable';
    const number = Number(value);
    if (!Number.isFinite(number)) return 'Unavailable';
    if (key === 'confidence') return `${Math.round(number * 100)}%`;
    if (key === 'duration') return `${number.toFixed(2)}s`;
    return String(number);
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
        this.cloudDebugSaveButton = null;
        this.cloudDebugSaveStatus = null;
        this.cloudDebugSnapshot = null;
        this._verificationAttemptState = resetAttemptState();
        this.versionComparison = null;
        this.versionComparisonView = null;
        this.versionComparisonManualSegments = [];
        this.versionComparisonBoundarySource = 'v2';
        this.versionComparisonJudgment = null;
        this.versionComparisonSaving = false;

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
        this.versionComparisonSection = document.getElementById('pa-version-comparison');
        this.versionComparisonV2 = document.getElementById('pa-version-v2');
        this.versionComparisonV3 = document.getElementById('pa-version-v3');
        this.versionComparisonState = document.getElementById('pa-version-comparison-state');
        this.versionComparisonJudgmentFieldset = document.getElementById('pa-version-judgment');
        this.versionComparisonSaveButton = document.getElementById('pa-version-save');
        this.versionComparisonSaveStatus = document.getElementById('pa-version-save-status');
        this.versionComparisonTechnicalContent = document.getElementById('pa-version-technical-content');
        this.versionComparisonBar = document.getElementById('pa-version-review-bar');
        this.versionComparisonColumns = document.getElementById('pa-version-columns');

        // Sub-tab navigation
        this.subTabs = document.querySelectorAll('.pa-sub-tab');
        this.subPanels = {
            practice: document.getElementById('pa-panel-practice'),
            analysis: document.getElementById('pa-panel-analysis'),
            feedback: document.getElementById('pa-panel-feedback')
        };
        this._activeSubTab = 'practice';

        // Native audio element
        this.nativeAudioContainer = document.getElementById('pa-native-audio-container');
        this.nativeAudio = document.getElementById('pa-native-audio');
        this.playNativeBtn = document.getElementById('pa-play-native-btn');
        this.audioSourceLabel = document.getElementById('pa-audio-source-label');
        this.audioPlaybackKind = null;
        this.nativeAudioPlayer = new NativeAudioPlayer(this.audioCapture.audioContext, this.nativeAudio);

        this.initLocalSampleTools();
        this.initCloudDebugSaveTools();
        this.initVersionComparisonControls();

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

        // Wake the V3 recognizer now so its cold start overlaps the time the
        // learner spends reading the word rather than their analysis request.
        this.warmV3Recognizer();

        // Initial fetch for default word
        this.updateWordData();
    }

    /**
     * Fire a debounced recognizer warm-up. Safe to call on every word change:
     * the backend collapses repeats inside its own window, and this guard
     * keeps a browsing learner from issuing a request per click.
     */
    warmV3Recognizer() {
        const now = Date.now();
        if (this._lastV3Warm && now - this._lastV3Warm < 60000) return;
        this._lastV3Warm = now;
        this.praatAPI.warmV3();
    }

    switchSubTab(tabName) {
        if (!this.subPanels[tabName]) return;
        this._activeSubTab = tabName;
        this.subTabs.forEach(btn => {
            const isTarget = btn.getAttribute('data-pa-tab') === tabName;
            btn.classList.toggle('active', isTarget);
            btn.setAttribute('aria-selected', String(isTarget));
            if (isTarget) {
                const dot = btn.querySelector('.pa-tab-dot');
                if (dot) dot.remove();
            }
        });
        Object.entries(this.subPanels).forEach(([name, panel]) => {
            if (panel) panel.classList.toggle('active', name === tabName);
        });
    }

    notifySubTab(tabName) {
        if (this._activeSubTab === tabName) return;
        const btn = document.getElementById(`pa-tab-${tabName}`);
        if (btn && !btn.querySelector('.pa-tab-dot')) {
            btn.insertAdjacentHTML('beforeend', '<span class="pa-tab-dot"></span>');
        }
    }

    clearSubTabDots() {
        this.subTabs.forEach(btn => {
            const dot = btn.querySelector('.pa-tab-dot');
            if (dot) dot.remove();
        });
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

        this.subTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const name = tab.getAttribute('data-pa-tab');
                if (name) this.switchSubTab(name);
            });
        });

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
        const playNativeBtn = this.playNativeBtn;
        if (playNativeBtn) {
            playNativeBtn.addEventListener('click', () => {
                if (this.audioPlaybackKind === 'device') {
                    this.playDeviceVoice();
                    return;
                }
                if (this.nativeAudio) {
                    this.nativeAudio.currentTime = 0;
                    this.nativeAudio.play().catch((err) => {
                        console.error('Error playing native audio:', err);
                    });
                }
            });
        }
    }

    playDeviceVoice() {
        if (!('speechSynthesis' in window) || !this.currentLookupWord) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(this.currentLookupWord);
        utterance.lang = 'en-US';
        const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.lang === 'en-US');
        if (voice) utterance.voice = voice;
        window.speechSynthesis.speak(utterance);
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

    initCloudDebugSaveTools() {
        if (this.localSampleEnabled || !this.resultsSummary) return;

        const tools = document.createElement('div');
        tools.id = 'pa-cloud-debug-tools';
        tools.className = 'pa-local-debug-tools';
        tools.style.display = 'none';
        tools.setAttribute('aria-label', 'Cloud pronunciation debugging tools');

        const button = document.createElement('button');
        button.id = 'pa-save-cloud-debug-btn';
        button.type = 'button';
        button.className = 'pa-btn pa-btn-local';
        button.textContent = '☁️ Save debug sample';
        button.title = 'Save this recording and its analysis to cloud for debugging';
        button.disabled = true;

        const status = document.createElement('span');
        status.id = 'pa-cloud-debug-status';
        status.className = 'pa-local-sample-status';
        status.setAttribute('role', 'status');

        tools.append(button, status);
        this.resultsSummary.insertAdjacentElement('afterend', tools);

        this.cloudDebugSaveButton = button;
        this.cloudDebugSaveStatus = status;
        this._cloudDebugTools = tools;
        button.addEventListener('click', () => this.saveCloudDebugSample());

        this.canUseManualReview().then((isAdmin) => {
            if (isAdmin) tools.style.display = '';
        });
    }

    setCloudDebugSnapshot(audioBlob, result, error = null) {
        if (this.localSampleEnabled || !audioBlob) return;
        this.cloudDebugSnapshot = {
            audioBlob,
            metadata: this.buildLocalSampleMetadata(audioBlob, result, error)
        };
        if (this.cloudDebugSaveButton) {
            this.cloudDebugSaveButton.disabled = false;
        }
        if (this.cloudDebugSaveStatus) {
            this.cloudDebugSaveStatus.textContent = 'Ready to save this recording for debugging.';
            this.cloudDebugSaveStatus.dataset.state = 'ready';
        }
    }

    clearCloudDebugSnapshot() {
        this.cloudDebugSnapshot = null;
        if (this.cloudDebugSaveButton) {
            this.cloudDebugSaveButton.disabled = true;
        }
        if (this.cloudDebugSaveStatus) {
            this.cloudDebugSaveStatus.textContent = '';
            this.cloudDebugSaveStatus.dataset.state = 'idle';
        }
    }

    buildCloudDebugMetadata(localMetadata) {
        const word = String(localMetadata?.word || 'unknown').trim();
        const ref = localMetadata?.reference || {};
        const syllables = Array.isArray(localMetadata?.analysis?.observedSyllables)
            ? localMetadata.analysis.observedSyllables : [];
        return {
            sampleId: localMetadata.sampleId,
            targetWord: word,
            referenceIpa: ref.displayIpa || ref.rawIpa || '',
            expectedObservedCount: syllables.length,
            targetSyllableCount: ref.syllableCount || syllables.length || 1,
            category: 'clean',
            speakerCohort: 'l1-vn-debug',
            needsManualReview: true,
            reviewReason: 'cloud-debug-save',
            automaticSegments: syllables
                .filter((s) => Number.isFinite(s?.startTime) && Number.isFinite(s?.endTime))
                .map((s) => ({ startTime: s.startTime, endTime: s.endTime }))
        };
    }

    async saveCloudDebugSample() {
        if (!this.cloudDebugSnapshot) return;

        const { audioBlob, metadata } = this.cloudDebugSnapshot;
        const user = window.firebaseAuthFunctions?.getCurrentUser?.() || window.auth?.currentUser;
        if (!user?.getIdToken) {
            if (this.cloudDebugSaveStatus) {
                this.cloudDebugSaveStatus.textContent = 'Cloud save requires an authenticated admin account.';
                this.cloudDebugSaveStatus.dataset.state = 'error';
            }
            return;
        }

        if (this.cloudDebugSaveButton) this.cloudDebugSaveButton.disabled = true;
        if (this.cloudDebugSaveStatus) {
            this.cloudDebugSaveStatus.textContent = 'Saving to cloud…';
            this.cloudDebugSaveStatus.dataset.state = 'saving';
        }

        try {
            const wavBlob = await this.praatAPI.ensureWav(audioBlob);
            const corpusMetadata = this.buildCloudDebugMetadata(metadata);
            const formData = new FormData();
            formData.append('audio', wavBlob, `${corpusMetadata.sampleId}.wav`);
            formData.append('metadata', JSON.stringify(corpusMetadata));

            const idToken = await user.getIdToken();
            const response = await fetch('/api/admin/dev/save-corpus-sample', {
                method: 'POST',
                headers: { Authorization: `Bearer ${idToken}` },
                body: formData
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.message || payload.error || `Cloud save failed (${response.status})`);
            }

            if (this.cloudDebugSaveStatus) {
                this.cloudDebugSaveStatus.textContent = `Saved to cloud: ${payload?.data?.sampleId || corpusMetadata.sampleId}`;
                this.cloudDebugSaveStatus.dataset.state = 'saved';
            }
        } catch (error) {
            if (this.cloudDebugSaveButton) this.cloudDebugSaveButton.disabled = false;
            if (this.cloudDebugSaveStatus) {
                this.cloudDebugSaveStatus.textContent = `Cloud save failed: ${error.message || error}`;
                this.cloudDebugSaveStatus.dataset.state = 'error';
            }
            Logger.error('Failed to save cloud debug sample:', error);
        }
    }

    initVersionComparisonControls() {
        this.versionComparisonColumns?.addEventListener('click', (e) => {
            const column = e.target.closest('.pa-version-column');
            if (!column) return;
            const version = column === this.versionComparisonV2 ? 'v2' : 'v3';
            this.setVersionComparisonBoundarySource(version);
        });
        this.versionComparisonJudgmentFieldset?.querySelectorAll('input[name="pa-version-judgment"]').forEach((input) => {
            input.addEventListener('change', () => {
                this.versionComparisonJudgment = input.value;
                this.updateVersionComparisonSaveState();
            });
        });
        this.versionComparisonSaveButton?.addEventListener('click', () => {
            this.saveVersionComparison();
        });
        this.resetVersionComparisonState();
    }

    async canUseVersionComparison() {
        if (config.features?.showPronunciationVersionComparison !== true) return false;
        // Manual review and comparison share the same admin-status promise so
        // a production recording never makes two auth/status requests.
        return this.canUseManualReview();
    }

    resetVersionComparisonState({ hide = true } = {}) {
        this.versionComparison = null;
        this.versionComparisonView = null;
        this.versionComparisonManualSegments = [];
        this.versionComparisonBoundarySource = 'v2';
        this.versionComparisonJudgment = null;
        this.versionComparisonSaving = false;
        this.versionComparisonJudgmentFieldset?.querySelectorAll('input[name="pa-version-judgment"]').forEach((input) => {
            input.checked = false;
        });
        if (this.versionComparisonJudgmentFieldset) this.versionComparisonJudgmentFieldset.hidden = false;
        if (this.versionComparisonSaveButton) this.versionComparisonSaveButton.disabled = true;
        if (this.versionComparisonSaveStatus) {
            this.versionComparisonSaveStatus.textContent = '';
            this.versionComparisonSaveStatus.dataset.state = 'idle';
        }
        if (this.versionComparisonState) this.versionComparisonState.textContent = 'Ready for review';
        if (this.versionComparisonTechnicalContent) this.versionComparisonTechnicalContent.textContent = '';
        if (hide) {
            if (this.versionComparisonSection) this.versionComparisonSection.hidden = true;
            this.setVersionComparisonBarVisible(false);
        }
    }

    setVersionComparisonBarVisible(visible) {
        if (this.versionComparisonBar) this.versionComparisonBar.hidden = !visible;
    }

    renderVersionComparisonColumn(column) {
        const target = column.version === 'v2' ? this.versionComparisonV2 : this.versionComparisonV3;
        if (!target) return;
        const statusCopy = column.status === 'available'
            ? `${column.syllableCount} automatic boundaries`
            : column.reason;
        const rows = this.versionComparisonView?.rows || [];
        target.innerHTML = `
            <div class="pa-version-column-heading">
                <div>
                    <p class="pa-version-eyebrow">Engine</p>
                    <h4 id="pa-version-${column.version}-title">${escapeHtml(column.label)}</h4>
                </div>
                <span class="pa-version-availability pa-version-availability--${column.status}">${column.status === 'available' ? 'Available' : 'Unavailable'}</span>
            </div>
            <p class="pa-version-column-status">${escapeHtml(statusCopy)}</p>
            <dl class="pa-version-metrics">
                ${rows.map((row) => {
                    const subtitle = row[`${column.version}Subtitle`];
                    return `
                    <div class="pa-version-metric-row">
                        <dt>${escapeHtml(row.label)}${subtitle ? ` <small class="pa-version-metric-subtitle">(${escapeHtml(subtitle)})</small>` : ''}</dt>
                        <dd>${escapeHtml(formatComparisonMetric(row[column.version], row.key))}</dd>
                    </div>
                    `;
                }).join('')}
            </dl>
            <div class="pa-version-boundaries" data-boundary-status="${escapeHtml(column.boundaryStatus)}" data-boundary-source="${escapeHtml(column.boundarySource)}" aria-label="${escapeHtml(`${column.label} ${column.boundaryLabel}`)}">
                <p class="pa-version-boundary-label">${escapeHtml(column.boundaryLabel)}</p>
                ${column.boundarySpans.length
                    ? column.boundarySpans.map((span, index) => `<span class="pa-version-boundary" data-index="${index}">${escapeHtml(span.label || `Boundary ${index + 1}`)} <small>${span.startTime.toFixed(2)}–${span.endTime.toFixed(2)}s</small></span>`).join('')
                    : '<span class="pa-version-empty">No automatic boundaries available.</span>'}
            </div>
        `;
    }

    renderVersionComparison(comparison, audioBlob = null) {
        this.versionComparison = comparison;
        this.versionComparisonView = buildComparisonViewModel(comparison);
        this.versionComparisonManualSegments = [];
        this.versionComparisonBoundarySource = this.versionComparisonView.columns.find((column) => column.version === 'v2' && column.status === 'available')
            ? 'v2'
            : 'v3';
        this.versionComparisonJudgment = null;
        if (this.versionComparisonSection) this.versionComparisonSection.hidden = false;
        this.setVersionComparisonBarVisible(true);
        if (this.resultsSummary) {
            this.resultsSummary.textContent = this.versionComparisonView.status === 'complete'
                ? 'Both pronunciation analyses are ready for your review.'
                : 'One pronunciation analysis was unavailable. Save this comparison as a failure after reviewing the available result.';
        }
        this.versionComparisonView.columns.forEach((column) => this.renderVersionComparisonColumn(column));
        if (this.versionComparisonJudgmentFieldset) {
            this.versionComparisonJudgmentFieldset.hidden = !isCompleteComparison(comparison);
        }
        if (this.versionComparisonState) {
            this.versionComparisonState.textContent = this.versionComparisonView.status === 'complete'
                ? 'Both analyses ready'
                : 'Partial result — save as a comparison failure';
        }
        if (this.versionComparisonTechnicalContent) {
            this.versionComparisonTechnicalContent.textContent = JSON.stringify({
                comparisonId: comparison?.comparisonId || null,
                context: comparison?.context || null,
                revisions: comparison?.revisions || null,
                intervals: this.versionComparisonView.columns.map((column) => ({
                    version: column.version,
                    displayedConvention: column.partitionConvention || column.boundarySource,
                    displayedSpans: column.boundarySpans,
                    rawCtcSpans: column.rawCtcSpans,
                    measurementConvention: column.measurementConvention,
                    measurementSpans: column.measurementSpans
                }))
            }, null, 2);
        }
        this.updateSelectedVersionComparisonColumn();
        this.updateVersionComparisonSaveState();
        this.renderVersionComparisonCharts();

        if (audioBlob && this.versionComparisonView.columns.some((column) => column.status === 'available')) {
            const initial = this.getSelectedVersionComparisonColumn();
            this.showSyllableVerifier(audioBlob, initial?.boundarySpans || [], {
                comparisonMode: true,
                labels: initial?.boundarySpans?.map((span) => span.label) || []
            });
        }
    }

    /** The column whose boundaries are currently selected, if any. */
    getSelectedVersionComparisonColumn() {
        return this.versionComparisonView?.columns?.find(
            (item) => item.version === this.versionComparisonBoundarySource
        ) || null;
    }

    /**
     * Draw the charts from the engine whose boundaries are selected. Without
     * this the comparison left both charts showing the native-only reference
     * drawn at word load, so the recording under review never appeared on them.
     */
    renderVersionComparisonCharts() {
        const column = this.getSelectedVersionComparisonColumn();
        const measurementSpans = column?.measurementSpans?.length
            ? column.measurementSpans
            : column?.boundarySpans;
        this.drawLearnerCharts(
            column?.analysis,
            normalizeChartSpans(measurementSpans),
            column?.boundarySpans || []
        );
    }

    updateSelectedVersionComparisonColumn() {
        [this.versionComparisonV2, this.versionComparisonV3].forEach((el) => {
            if (!el) return;
            const version = el === this.versionComparisonV2 ? 'v2' : 'v3';
            el.classList.toggle('is-selected', version === this.versionComparisonBoundarySource);
        });
    }

    setVersionComparisonBoundarySource(version) {
        if (!this.versionComparisonView || !['v2', 'v3'].includes(version)) return;
        const column = this.versionComparisonView.columns.find((item) => item.version === version);
        if (!column || column.status !== 'available') return;
        this.versionComparisonBoundarySource = version;
        this.updateSelectedVersionComparisonColumn();
        this.renderVersionComparisonCharts();
        if (this.syllableVerifier) {
            this.syllableVerifier.setActiveVersion(version);
            this.syllableVerifier.setAutomaticSyllables(
                column.boundarySpans,
                column.boundarySpans.map((span) => span.label),
                this.getSyllableIpaSegments()
            );
        }
    }

    updateVersionComparisonSaveState() {
        if (!this.versionComparisonSaveButton) return;
        const canSave = Boolean(
            this.versionComparison &&
            !this.versionComparisonSaving &&
            (!isCompleteComparison(this.versionComparison) || this.versionComparisonJudgment)
        );
        this.versionComparisonSaveButton.disabled = !canSave;
    }

    async saveVersionComparison() {
        if (this.versionComparisonSaving || !this.versionComparison || !this.userAudioBlob) return;
        if (isCompleteComparison(this.versionComparison) && !this.versionComparisonJudgment) return;
        const user = window.firebaseAuthFunctions?.getCurrentUser?.() || window.auth?.currentUser;
        if (!user?.getIdToken) {
            if (this.versionComparisonSaveStatus) {
                this.versionComparisonSaveStatus.textContent = 'Cloud save requires an authenticated admin account.';
                this.versionComparisonSaveStatus.dataset.state = 'error';
            }
            return;
        }

        this.versionComparisonSaving = true;
        this.updateVersionComparisonSaveState();
        if (this.versionComparisonSaveStatus) {
            this.versionComparisonSaveStatus.textContent = 'Saving the WAV, both analyses, and your judgment…';
            this.versionComparisonSaveStatus.dataset.state = 'saving';
        }
        try {
            const metadata = buildComparisonSaveMetadata(this.versionComparison, {
                judgment: this.versionComparisonJudgment,
                manualSegments: this.versionComparisonManualSegments
            });
            const wavBlob = await this.praatAPI.ensureWav(this.userAudioBlob);
            const formData = new FormData();
            formData.append('audio', wavBlob, `${metadata.comparisonId || 'comparison'}.wav`);
            formData.append('metadata', JSON.stringify(metadata));
            const idToken = await user.getIdToken();
            const response = await fetch('/api/admin/dev/save-analysis-comparison', {
                method: 'POST',
                headers: { Authorization: `Bearer ${idToken}` },
                body: formData
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || payload.error || `Comparison save failed (${response.status})`);
            const comparisonId = payload?.data?.comparisonId || payload?.comparisonId || metadata.comparisonId;
            if (this.versionComparisonSaveStatus) {
                this.versionComparisonSaveStatus.textContent = `Saved comparison ${comparisonId}.`;
                this.versionComparisonSaveStatus.dataset.state = 'saved';
            }
        } catch (error) {
            if (this.versionComparisonSaveStatus) {
                this.versionComparisonSaveStatus.textContent = error?.message || 'Comparison save failed. Try again.';
                this.versionComparisonSaveStatus.dataset.state = 'error';
            }
        } finally {
            this.versionComparisonSaving = false;
            this.updateVersionComparisonSaveState();
        }
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
        this.currentLookupWord = word;

        this.switchSubTab('practice');
        this.clearSubTabDots();

        // Selecting a word is the strongest signal that a recording is coming.
        this.warmV3Recognizer();

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
            this.resetVersionComparisonState();
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
        this.clearCloudDebugSnapshot();
        this.resetVersionComparisonState();
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
        const analysisEmpty = document.getElementById('pa-analysis-empty');
        if (analysisEmpty) analysisEmpty.style.display = '';
        const feedbackEmpty = document.getElementById('pa-feedback-empty');
        if (feedbackEmpty) feedbackEmpty.style.display = '';
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
        this.clearCloudDebugSnapshot();
        this.resetVersionComparisonState();
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
            this.resetVersionComparisonState();
            this.clearLocalSampleSnapshot('Local only · recording in progress…');
            this.clearCloudDebugSnapshot();

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
                const comparisonAuthorized = await this.canUseVersionComparison();
                if (comparisonAuthorized) {
                    try {
                        const comparison = await this.praatAPI.analyzeComparison(audioBlob, {
                            referenceIpa: this.currentWordRef?.displayIpa || this.currentWordRef?.rawIpa,
                            referenceSyllables: this.getSyllableIpaSegments(),
                            expectedSyllables: expectedCount,
                            targetWord: this.currentReference?.word,
                            variantId: this.currentWordRef?.id
                        });
                        result = { engine: 'comparison', quality: { rateable: true }, analysis: comparison };
                        this.setLocalSampleSnapshot(audioBlob, result);
                        this.setCloudDebugSnapshot(audioBlob, result);
                        localSamplePrepared = true;
                        this.renderVersionComparison(comparison, audioBlob);
                        this._finishAnalysis('Comparison ready');
                        return;
                    } catch (comparisonError) {
                        result = { engine: 'comparison', quality: { rateable: false }, analysis: null };
                        this.setLocalSampleSnapshot(audioBlob, result, comparisonError);
                        this.setCloudDebugSnapshot(audioBlob, result, comparisonError);
                        localSamplePrepared = true;
                        throw comparisonError;
                    }
                }

                result = await analyzeRecordedAttempt({
                    audioBlob,
                    expectedSyllables: expectedCount,
                    preferPraat: this.usePraatBackend,
                    praatAnalyze: (blob) => this.praatAPI.analyze(blob, expectedCount, {
                        referenceIpa: this.currentWordRef?.displayIpa || this.currentWordRef?.rawIpa,
                        referenceSyllables: this.getSyllableIpaSegments(),
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
                this.setCloudDebugSnapshot(audioBlob, result);
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
                        this.currentWordRef?.referenceAnalysis,
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
                        this.currentWordRef?.referenceAnalysis,
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
                    this.setCloudDebugSnapshot(audioBlob, result, err);
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
     * Draw the learner prosody and duration charts for one engine's output.
     * Both the learner V3 path and the admin comparison feed through here so
     * the charts always describe the recording, never the native reference
     * left over from word load. Returns whether anything was drawn.
     */
    drawLearnerCharts(analysis, measurementSpans = [], durationSpans = measurementSpans) {
        if (!this.visualizer || !analysis) {
            this.visualizer?.clear();
            this.chartsContainer?.classList.add('hidden');
            return false;
        }

        this.chartsContainer?.classList.remove('hidden');
        const analysisEmpty = document.getElementById('pa-analysis-empty');
        if (analysisEmpty) analysisEmpty.style.display = 'none';

        this.visualizer.drawComparisonPitchContour(
            analysis,
            this.currentWordRef?.referenceAnalysis,
            this.currentWordRef?.syllables || [],
            { learnerSyllables: measurementSpans, drawDuration: false }
        );

        // Duration lanes: observed spans against the native pattern when we
        // have one, otherwise the learner's own spans alone.
        this.visualizer.drawDurationChart(this.getTargetDurationSyllables(), durationSpans);
        return true;
    }

    /**
     * Draw the charts and arm syllable playback from V3 recognizer output.
     * Independent of the formal verdict: a learner whose count could not be
     * confirmed still gets working charts and playback.
     */
    renderV3Segmentation(analysis, syllables = [], audioBlob = null) {
        const chartSpans = normalizeChartSpans(syllables);
        const playbackSpans = normalizePlaybackSpans(syllables);
        const drawn = this.drawLearnerCharts(analysis, chartSpans, playbackSpans);
        if (audioBlob) {
            this.showSyllableVerifier(audioBlob, drawn ? playbackSpans : []);
        }
        if (drawn) this.switchSubTab('analysis');
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
    async showSyllableVerifier(audioBlob, syllables, {
        comparisonMode = false,
        labels = null
    } = {}) {
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
        const syllableLabels = Array.isArray(labels) && labels.length === syllables.length
            ? labels
            : this.getSyllableLabels();
        const enableManualReview = await this.canUseManualReview();

        // Create a single learner waveform. Native audio remains available in
        // the reference player above; the verifier is reserved for learner
        // segmentation and manual review.
        const verifierOptions = {
            enableManualReview,
            onManualSave: (segments) => this.saveManualReview(segments),
            onManualSegmentsChange: comparisonMode
                ? (segments) => {
                    this.versionComparisonManualSegments = segments.map((segment) => ({ ...segment }));
                    this.updateVersionComparisonSaveState();
                }
                : undefined
        };
        if (comparisonMode && this.versionComparisonView?.columns) {
            verifierOptions.versionSources = this.versionComparisonView.columns.map((col) => ({
                version: col.version,
                label: col.label,
                status: col.status
            }));
            verifierOptions.activeVersion = this.versionComparisonBoundarySource;
            verifierOptions.onVersionSwitch = (version) => this.setVersionComparisonBoundarySource(version);
        }
        this.syllableVerifier = new window.SyllableVerifier('syllable-verifier-container', verifierOptions);
        await this.syllableVerifier.loadAudio(
            audioBlob,
            syllables,
            syllableLabels,
            this.getSyllableIpaSegments()
        );
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
            const startTime = Number(
                segment?.partitionStartTime
                ?? segment?.partition_start_time
                ?? segment?.startTime
                ?? segment?.start
            );
            const endTime = Number(
                segment?.partitionEndTime
                ?? segment?.partition_end_time
                ?? segment?.endTime
                ?? segment?.end
            );
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
        const selectedComparisonColumn = this.getSelectedVersionComparisonColumn();
        const automaticUsesPartition = this.syllableVerifier?.syllables?.some((segment) => (
            Number.isFinite(Number(segment?.partitionStartTime ?? segment?.partition_start_time))
            && Number.isFinite(Number(segment?.partitionEndTime ?? segment?.partition_end_time))
        ));
        const automaticSegmentationConvention = selectedComparisonColumn?.partitionConvention
            || (automaticUsesPartition ? 'ctc-interspan-midpoint-contiguous-v1' : selectedComparisonColumn?.boundarySource)
            || 'automatic-boundary-unknown';
        const analysisRevision = selectedComparisonColumn?.analysis?.analysisVersion
            || this.versionComparison?.revisions?.[this.versionComparisonBoundarySource]
            || null;

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
            needsManualReview: false,
            reviewReason: null,
            // Which syllabification the manual boundaries follow. Samples saved
            // before this field exists were annotated against the orthographic
            // chunking and place cluster consonants differently, so they must
            // not be pooled with these without re-labelling.
            segmentationConvention: 'ipa-phonological-contiguous-v1',
            referenceSyllableIpa: this.getSyllableIpaSegments(),
            automaticSegmentationConvention,
            analysisRevision,
            sourceComparisonId: this.versionComparison?.comparisonId || null,
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
            this.currentWordRef?.referenceAnalysis?.observed?.syllables
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
        const expectedCount = Math.max(
            1,
            Number(this.expectedData?.syllables || this.currentWordRef?.syllableCount || 1)
        );
        if (!Array.isArray(manualSegments) || manualSegments.length !== expectedCount) {
            throw new Error(`Mark exactly ${expectedCount} syllables before saving.`);
        }
        if (manualSegments.some((segment, index) => (
            index > 0
            && Math.abs(Number(segment.startTime) - Number(manualSegments[index - 1].endTime)) > 0.000001
        ))) {
            throw new Error('Manual syllable spans must be contiguous before saving.');
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
            nativeQuality: this.currentWordRef?.referenceAnalysis?.quality,
            learnerQuality,
            nativeStressEvidence: this.currentWordRef?.referenceAnalysis?.observed?.stressEvidence,
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
     * Per-syllable IPA in phonological order, used to label manual segmentation.
     *
     * Deliberately not the same as getSyllableLabels(): those are the headword's
     * orthographic chunks ("in/dus/tri/al") and stay that way because they are
     * what a learner can read. The IPA segmentation ("ɪn/dʌ/stri/jəl") assigns
     * cluster consonants differently and is the convention the aligner and the
     * corpus use.
     */
    getSyllableIpaSegments() {
        const syllables = this.currentWordRef?.syllables;
        if (!Array.isArray(syllables) || syllables.length !== this.expectedData?.syllables) {
            return null;
        }
        return syllables.map((syllable) => syllable.ipa || null);
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
        const referenceAnalysis = wordRef.referenceAnalysis;
        const canShowGraphs = (
            isValid &&
            wordRef.capabilities.showReferenceGraph &&
            hasUsableNativeContours(referenceAnalysis)
        );
        const contourOnly = canShowGraphs && referenceAnalysis?.quality?.rateable !== true;
        const graphSource = referenceAnalysis?.graphSource || wordRef.graphSource;
        const isModeledGraph = graphSource?.kind === 'modeled';

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
                    : isModeledGraph
                        ? 'Expected stress pattern shown. No measured reference contour is available.'
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

        // Real reference audio is preferred. Device speech is temporary and
        // never becomes a measured reference or scoring input.
        if (this.nativeAudio && this.nativeAudioContainer) {
            if (wordRef.audioUrl && wordRef.capabilities.playAudio) {
                const proxiedUrl = this.wordRefService.getProxiedAudioUrl(wordRef.audioUrl);
                this.nativeAudioUrl = proxiedUrl;
                this.nativeAudio.src = proxiedUrl;
                this.nativeAudioContainer.style.display = 'flex';
                this.audioPlaybackKind = wordRef.audioSourceKind === 'generated' ? 'generated' : 'dictionary';
                if (this.audioSourceLabel) {
                    this.audioSourceLabel.textContent = this.audioPlaybackKind === 'generated'
                        ? 'Verified generated reference'
                        : 'Dictionary recording';
                }
                if (this.playNativeBtn) this.playNativeBtn.textContent = '🔊 Listen';
                this.nativeAudioPlayer.setAudioElement(this.nativeAudio);
                this.nativeAudioPlayer.preload(proxiedUrl).catch(() => {});
            } else if ('speechSynthesis' in window && this.currentLookupWord) {
                this.nativeAudioUrl = null;
                this.audioPlaybackKind = 'device';
                this.nativeAudio.removeAttribute('src');
                this.nativeAudioContainer.style.display = 'flex';
                this.nativeAudioPlayer.clearSource();
                if (this.audioSourceLabel) this.audioSourceLabel.textContent = 'Temporary device voice';
                if (this.playNativeBtn) this.playNativeBtn.textContent = '🔊 Device voice';
            } else {
                this.nativeAudioUrl = null;
                this.audioPlaybackKind = null;
                this.nativeAudioContainer.style.display = 'none';
                this.nativeAudioPlayer.clearSource();
            }
        }

        if (this.visualizer) {
            this.visualizer.clear();
            if (canShowGraphs && referenceAnalysis.pitch?.values?.length > 0) {
                this.visualizer.drawNativePitchContour(
                    referenceAnalysis,
                    referenceAnalysis?.observed?.syllables || [],
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

