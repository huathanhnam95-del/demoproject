/**
 * SyllableVerifier - Interactive syllable boundary verification
 * Uses Wavesurfer.js for waveform display and region playback
 * 
 * Dependencies: Wavesurfer.js 7.x (via CDN)
 */

class SyllableVerifier {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.warn('SyllableVerifier: Container not found:', containerId);
            return;
        }

        this.options = {
            waveColor: '#4a90d9',
            progressColor: '#1e40af',
            cursorColor: '#ef4444',
            height: 100,
            ...options
        };
        this.manualReviewEnabled = this.options.enableManualReview !== false;

        this.wavesurfer = null;
        this.regions = null;
        this.syllables = [];
        this.syllableLabels = [];
        this.isPlaying = false;
        this.playingRegionId = null;

        this.manualReviewActive = false;
        this.manualSegments = [];
        this.manualBoundaryTimes = [];
        this.manualConvention = 'ipa-phonological-contiguous-v1';
        this.pendingManualStart = null;
        this.manualSaveInProgress = false;
        this.manualReviewSaved = false;
        this.lastManualInteraction = null;
        this.manualWaveformClickHandler = null;
        this.manualWaveformTargets = [];

        this.init();
    }

    init() {
        // Create UI structure
        this.container.innerHTML = `
            <div class="sv-wrapper">
                <div class="sv-header">
                    <h4>🔍 Syllable Verification</h4>
                    <div class="sv-controls">
                        <button class="sv-btn" id="sv-play-all" title="Play All">
                            ▶️ Play
                        </button>
                        <select class="sv-speed-select" id="sv-speed-select" title="Playback Speed">
                            <option value="1.0">1x</option>
                            <option value="0.75">0.75x</option>
                            <option value="0.5">0.5x</option>
                        </select>
                        ${this.manualReviewEnabled ? `
                            <button class="sv-btn sv-btn-manual" id="sv-manual-review" type="button"
                                title="Mark syllable boundaries yourself" aria-pressed="false">
                                Manual review
                            </button>
                        ` : ''}
                    </div>
                </div>
                
                <div class="sv-waveform-container">
                    <div id="sv-waveform"></div>
                </div>
                
                <div class="sv-syllable-bar" id="sv-syllable-bar">
                    <!-- Syllable labels inserted here -->
                </div>
                
                <div class="sv-info" id="sv-info">
                    <p>Use the numbered syllable labels below the waveform to hear them individually.</p>
                </div>
                
                ${this.manualReviewEnabled ? `
                    <div class="sv-manual-review-panel" id="sv-manual-review-panel" hidden>
                        <div class="sv-manual-review-copy">
                            <strong>Manual segmentation</strong>
                            <span id="sv-manual-instructions">Click the start and end of each syllable on the waveform.</span>
                        </div>
                        <div class="sv-manual-review-actions">
                            <span id="sv-manual-count" class="sv-manual-count">0 segments</span>
                            <button class="sv-btn sv-btn-subtle" id="sv-manual-undo" type="button" disabled>Undo</button>
                            <button class="sv-btn sv-btn-subtle" id="sv-manual-clear" type="button" disabled>Clear</button>
                            <button class="sv-btn sv-btn-save" id="sv-manual-save" type="button" disabled>Save to cloud</button>
                        </div>
                        <div class="sv-manual-status" id="sv-manual-status" role="status" aria-live="polite"></div>
                    </div>
                ` : ''}
            </div>
        `;

        this.initWavesurfer();
        this.bindEvents();
    }

    initWavesurfer() {
        // Check if WaveSurfer is available
        if (typeof WaveSurfer === 'undefined') {
            console.error('SyllableVerifier: WaveSurfer.js not loaded');
            this.container.innerHTML = '<p style="color: #dc2626;">Waveform library not loaded</p>';
            return;
        }

        // Initialize Wavesurfer.js
        this.wavesurfer = WaveSurfer.create({
            container: '#sv-waveform',
            waveColor: this.options.waveColor,
            progressColor: this.options.progressColor,
            cursorColor: this.options.cursorColor,
            height: this.options.height,
            normalize: true,
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
        });

        // Add regions plugin
        try {
            this.regions = this.wavesurfer.registerPlugin(
                WaveSurfer.Regions.create()
            );
        } catch (err) {
            console.error('SyllableVerifier: Failed to register Regions plugin', err);
        }

        // Region click on the waveform is intentionally not wired to
        // playback — users expect clicking the waveform to seek, not to
        // replay a whole syllable.  Playback is triggered only by the
        // label bar buttons ("1st", "2nd", …) below the waveform.

        // Playback events
        this.wavesurfer.on('finish', () => {
            this.isPlaying = false;
            this.updatePlayButton();
        });

        this.wavesurfer.on('play', () => {
            this.isPlaying = true;
            this.updatePlayButton();
        });

        this.wavesurfer.on('pause', () => {
            this.isPlaying = false;
            this.updatePlayButton();
        });
    }

    bindEvents() {
        const playAllBtn = this.container.querySelector('#sv-play-all');
        const speedSelect = this.container.querySelector('#sv-speed-select');
        const manualReviewBtn = this.container.querySelector('#sv-manual-review');
        const manualUndoBtn = this.container.querySelector('#sv-manual-undo');
        const manualClearBtn = this.container.querySelector('#sv-manual-clear');
        const manualSaveBtn = this.container.querySelector('#sv-manual-save');
        const waveform = this.container.querySelector('#sv-waveform');

        if (playAllBtn) {
            playAllBtn.addEventListener('click', () => {
                const speed = parseFloat(speedSelect?.value || '1.0');
                this.playAll(speed);
            });
        }

        this.speedSelect = speedSelect;
        manualReviewBtn?.addEventListener('click', () => {
            this.setManualReviewActive(!this.manualReviewActive);
        });
        manualUndoBtn?.addEventListener('click', () => this.undoManualSegment());
        manualClearBtn?.addEventListener('click', () => this.clearManualSegments());
        manualSaveBtn?.addEventListener('click', () => this.saveManualReview());

        // Capture clicks before a WaveSurfer region consumes them. This keeps
        // the boundary tool tied to the actual waveform pixels, including the
        // colored automatic regions drawn over the canvas.
        if (waveform) {
            this.manualWaveformClickHandler = (event) => {
                if (!this.manualReviewActive) return;
                event.preventDefault();
                event.stopPropagation();
                this.handleManualInteraction(this.getTimeFromPointerEvent(event));
            };
            this.bindManualWaveformClicks(waveform);
        }
    }

    bindManualWaveformClicks(waveform) {
        this.manualWaveformTargets.forEach((target) => {
            target.removeEventListener('click', this.manualWaveformClickHandler, true);
        });
        const targets = [waveform];
        // WaveSurfer 7 renders its canvas inside a shadow root. Events from
        // that root are not guaranteed to cross back to #sv-waveform, so bind
        // at both levels while keeping one handler/deduplication guard.
        waveform.querySelectorAll('*').forEach((node) => {
            if (node.shadowRoot) targets.push(node.shadowRoot);
        });
        this.manualWaveformTargets = [...new Set(targets)];
        this.manualWaveformTargets.forEach((target) => {
            target.addEventListener('click', this.manualWaveformClickHandler, true);
        });
    }

    setManualReviewActive(active) {
        this.manualReviewActive = Boolean(active);
        if (!this.manualReviewActive) {
            this.pendingManualStart = null;
            this.removeManualPendingMarker();
        }

        const button = this.container.querySelector('#sv-manual-review');
        const waveform = this.container.querySelector('#sv-waveform');
        const panel = this.container.querySelector('#sv-manual-review-panel');
        if (button) {
            button.classList.toggle('is-active', this.manualReviewActive);
            button.setAttribute('aria-pressed', String(this.manualReviewActive));
            button.textContent = this.manualReviewActive ? 'Exit manual review' : 'Manual review';
        }
        if (waveform) waveform.classList.toggle('sv-manual-active', this.manualReviewActive);
        if (panel) panel.hidden = !this.manualReviewActive;
        if (this.manualReviewActive) this.stop();
        this.updateManualReviewUi();
    }

    getTimeFromPointerEvent(event) {
        const waveform = this.container.querySelector('#sv-waveform');
        const duration = Number(this.wavesurfer?.getDuration?.() || 0);
        if (!waveform || !duration || !Number.isFinite(event?.clientX)) return null;
        const rect = waveform.getBoundingClientRect();
        if (!rect.width) return null;
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        return ratio * duration;
    }

    handleManualInteraction(rawTime) {
        if (!this.manualReviewActive || !this.wavesurfer) return false;
        this.manualConvention = 'ipa-phonological-contiguous-v1';
        const duration = Number(this.wavesurfer.getDuration?.() || 0);
        const time = Number(rawTime);
        if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return false;

        const clampedTime = Math.min(duration, Math.max(0, time));
        const now = Date.now();
        if (this.lastManualInteraction && now - this.lastManualInteraction.at < 60
            && Math.abs(this.lastManualInteraction.time - clampedTime) < 0.002) {
            return false;
        }
        this.lastManualInteraction = { at: now, time: clampedTime };

        const expectedCount = this.getExpectedManualSegmentCount();
        const requiredBoundaryCount = expectedCount + 1;
        if (this.manualBoundaryTimes.length >= requiredBoundaryCount) {
            this.setManualStatus('All required boundaries are already marked. Use Undo to change them.', 'error');
            return false;
        }

        const previousBoundary = this.manualBoundaryTimes.at(-1);
        if (Number.isFinite(previousBoundary) && clampedTime - previousBoundary < 0.01) {
            this.setManualStatus('Choose each next boundary after the previous one.', 'error');
            return false;
        }

        this.manualBoundaryTimes.push(clampedTime);
        this.rebuildManualSegmentsFromBoundaries();
        this.pendingManualStart = this.manualBoundaryTimes.length < requiredBoundaryCount
            ? clampedTime
            : null;
        this.manualReviewSaved = false;
        if (this.pendingManualStart === null) this.removeManualPendingMarker();
        else this.renderManualPendingMarker();
        this.createManualRegions();
        this.updateManualReviewUi();
        this.notifyManualSegmentsChanged();
        return true;
    }

    getExpectedManualSegmentCount() {
        const ipaCount = Array.isArray(this.ipaSegments) ? this.ipaSegments.length : 0;
        return Math.max(1, ipaCount || this.syllables.length || 1);
    }

    rebuildManualSegmentsFromBoundaries() {
        this.manualSegments = this.manualBoundaryTimes.slice(1).map((endTime, index) => {
            const startTime = this.manualBoundaryTimes[index];
            return {
                index,
                startTime,
                endTime,
                duration: Number((endTime - startTime).toFixed(6)),
                source: 'manual-review'
            };
        });
    }

    hasCompleteManualReview() {
        const expectedCount = this.getExpectedManualSegmentCount();
        return this.manualSegments.length === expectedCount
            && this.manualBoundaryTimes.length === expectedCount + 1
            && this.manualSegments.every((segment, index) => (
                segment.endTime > segment.startTime
                && (index === 0 || segment.startTime === this.manualSegments[index - 1].endTime)
            ));
    }

    renderManualPendingMarker() {
        if (!this.regions || this.pendingManualStart === null) return;
        this.removeManualPendingMarker();
        const duration = Number(this.wavesurfer?.getDuration?.() || 0);
        const end = Math.min(duration, this.pendingManualStart + Math.max(0.01, duration / 500));
        try {
            this.regions.addRegion({
                id: 'manual-pending',
                start: this.pendingManualStart,
                end,
                color: 'rgba(239, 68, 68, 0.85)',
                drag: false,
                resize: false
            });
        } catch (error) {
            console.warn('SyllableVerifier: Failed to draw pending manual boundary', error);
        }
    }

    removeManualPendingMarker() {
        const pending = this.regions?.getRegions?.().find((region) => region.id === 'manual-pending');
        pending?.remove?.();
    }

    createManualRegions() {
        if (!this.regions) return;
        this.regions.getRegions?.()
            .filter((region) => region.id.startsWith('manual-syllable-'))
            .forEach((region) => region.remove?.());

        const colors = [
            'rgba(239, 68, 68, 0.42)',
            'rgba(234, 88, 12, 0.42)',
            'rgba(220, 38, 127, 0.42)',
            'rgba(124, 58, 237, 0.42)'
        ];
        this.manualSegments.forEach((segment, index) => {
            try {
                this.regions.addRegion({
                    id: `manual-syllable-${index}`,
                    start: segment.startTime,
                    end: segment.endTime,
                    color: colors[index % colors.length],
                    drag: false,
                    resize: false
                });
            } catch (error) {
                console.warn(`SyllableVerifier: Failed to draw manual segment ${index}`, error);
            }
        });
    }

    undoManualSegment() {
        if (!this.manualBoundaryTimes.length) return;
        this.manualBoundaryTimes.pop();
        this.rebuildManualSegmentsFromBoundaries();
        this.pendingManualStart = this.manualBoundaryTimes.at(-1) ?? null;
        this.manualReviewSaved = false;
        if (this.pendingManualStart === null) this.removeManualPendingMarker();
        else this.renderManualPendingMarker();
        this.createManualRegions();
        this.setManualStatus('Last manual segment removed.', 'idle');
        this.updateManualReviewUi();
        this.notifyManualSegmentsChanged();
    }

    clearManualSegments() {
        this.manualSegments = [];
        this.manualBoundaryTimes = [];
        this.pendingManualStart = null;
        this.manualReviewSaved = false;
        this.removeManualPendingMarker();
        this.createManualRegions();
        this.setManualStatus('Manual segments cleared.', 'idle');
        this.updateManualReviewUi();
        this.notifyManualSegmentsChanged();
    }

    updateManualReviewUi() {
        const count = this.manualSegments.length;
        const expectedCount = this.getExpectedManualSegmentCount();
        const countEl = this.container.querySelector('#sv-manual-count');
        const instructions = this.container.querySelector('#sv-manual-instructions');
        const undo = this.container.querySelector('#sv-manual-undo');
        const clear = this.container.querySelector('#sv-manual-clear');
        const save = this.container.querySelector('#sv-manual-save');
        if (countEl) countEl.textContent = `${count} of ${expectedCount} segments`;
        if (instructions) {
            // Name the IPA syllable being marked so cluster consonants land on
            // the phonological side of the boundary. Without this the annotator
            // falls back to the spelling and the corpus records a convention
            // the aligner does not share.
            const boundaryCount = this.manualBoundaryTimes.length;
            const previousTarget = this.ipaSegments?.[Math.max(0, boundaryCount - 1)];
            const nextTarget = this.ipaSegments?.[boundaryCount];
            this.manualConvention = 'ipa-phonological-contiguous-v1';
            if (this.hasCompleteManualReview()) {
                instructions.textContent = 'All contiguous syllable boundaries are marked. Review them, then save.';
            } else if (boundaryCount === 0) {
                instructions.textContent = 'Click the start of the spoken word.';
            } else if (boundaryCount < expectedCount) {
                const boundaryLabel = previousTarget && nextTarget
                    ? ` between /${previousTarget}/ and /${nextTarget}/`
                    : '';
                instructions.textContent = `Click shared syllable boundary ${boundaryCount} of ${expectedCount - 1}${boundaryLabel}.`;
            } else {
                instructions.textContent = 'Click the end of the spoken word.';
            }
        }
        if (undo) undo.disabled = this.manualBoundaryTimes.length === 0 || this.manualSaveInProgress;
        if (clear) clear.disabled = this.manualBoundaryTimes.length === 0 || this.manualSaveInProgress;
        if (save) {
            save.disabled = !this.hasCompleteManualReview() || this.manualSaveInProgress || this.manualReviewSaved;
            save.textContent = this.manualReviewSaved ? 'Saved' : 'Save to cloud';
        }
    }

    setManualStatus(message, state = 'idle') {
        const status = this.container.querySelector('#sv-manual-status');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.state = state;
    }

    notifyManualSegmentsChanged() {
        if (typeof this.options.onManualSegmentsChange === 'function') {
            this.options.onManualSegmentsChange(this.manualSegments.map((segment) => ({ ...segment })));
        }
    }

    async saveManualReview() {
        if (this.manualSaveInProgress) return;
        if (!this.hasCompleteManualReview()) {
            this.setManualStatus(
                `Mark exactly ${this.getExpectedManualSegmentCount()} syllables before saving.`,
                'error'
            );
            return;
        }
        if (typeof this.options.onManualSave !== 'function') {
            this.setManualStatus('Cloud save is not available in this session.', 'error');
            return;
        }

        this.manualSaveInProgress = true;
        this.updateManualReviewUi();
        this.setManualStatus('Saving the recording and manual boundaries…', 'saving');
        try {
            const result = await this.options.onManualSave(
                this.manualSegments.map((segment) => ({ ...segment }))
            );
            const sampleId = result?.sampleId || result?.sample?.id || 'manual review';
            this.manualReviewSaved = true;
            const destination = result?.destination === 'local' ? 'Saved locally for review' : 'Saved to cloud';
            this.setManualStatus(`${destination}: ${sampleId}`, 'saved');
        } catch (error) {
            this.setManualStatus(error?.message || 'Cloud save failed. Please try again.', 'error');
        } finally {
            this.manualSaveInProgress = false;
            this.updateManualReviewUi();
        }
    }

    /**
     * Load audio and display syllable regions
     * @param {Blob|string} audio - Audio blob or URL
     * @param {Array} syllables - Array of syllable objects with startTime, endTime, duration
     * @param {Array} labels - Optional array of syllable text labels
     * @param {Array} ipaSegments - Optional per-syllable IPA, in phonological
     *   order. Manual segmentation is labelled from these rather than from
     *   `labels`: the orthographic labels chunk a word the way it is spelled
     *   ("in/dus/tri/al"), which assigns cluster consonants differently from
     *   the IPA the aligner uses ("ɪn/dʌ/stri/jəl"). Annotating against the
     *   spelling produces boundaries the aligner can never reproduce.
     */
    async loadAudio(audio, syllables, labels = null, ipaSegments = null) {
        if (!this.wavesurfer) return;

        this.syllables = syllables;
        this.ipaSegments = Array.isArray(ipaSegments) ? ipaSegments.slice() : [];
        this.manualSegments = [];
        this.manualBoundaryTimes = [];
        this.pendingManualStart = null;
        this.manualReviewSaved = false;
        this.removeManualPendingMarker();
        this.setManualStatus('', 'idle');
        this.updateManualReviewUi();
        const fallbackLabels = syllables.map((_, i) => {
            const ordinal = this.getOrdinal(i + 1);
            return `Play ${ordinal} Syl`;
        });
        // Generate ordinal labels: "Play 1st Syl", "Play 2nd Syl", etc.
        this.syllableLabels = Array.isArray(labels) && labels.length === syllables.length
            ? syllables.map((_, i) => labels[i] || fallbackLabels[i])
            : fallbackLabels;

        try {
            // Setup ready promise BEFORE loading to avoid race condition
            const readyPromise = new Promise((resolve, reject) => {
                const onReady = () => {
                    this.wavesurfer.un('ready', onReady);
                    this.wavesurfer.un('error', onError);
                    resolve();
                };
                const onError = (err) => {
                    this.wavesurfer.un('ready', onReady);
                    this.wavesurfer.un('error', onError);
                    reject(err);
                };
                this.wavesurfer.on('ready', onReady);
                this.wavesurfer.on('error', onError);

                // Fallback timeout in case ready event is missed or doesn't fire
                setTimeout(() => {
                    // Check if actually ready despite no event
                    if (this.wavesurfer && this.wavesurfer.getDuration() > 0) {
                        onReady();
                    } else {
                        // Don't reject, just proceed - might be partial load
                        console.warn('SyllableVerifier: Audio load timeout provided fallback');
                        onReady();
                    }
                }, 2000);
            });

            // Load audio into wavesurfer
            if (audio instanceof Blob) {
                const url = URL.createObjectURL(audio);
                await this.wavesurfer.load(url);
            } else {
                await this.wavesurfer.load(audio);
            }

            // Wait for ready event (or successful load)
            await readyPromise;

            const waveform = this.container.querySelector('#sv-waveform');
            if (waveform && this.manualWaveformClickHandler) {
                this.bindManualWaveformClicks(waveform);
            }

            // Create regions for each syllable
            this.createSyllableRegions();

            // Create syllable label bar
            this.createSyllableBar();

            // Show info
            this.updateInfo();

        } catch (err) {
            console.error('SyllableVerifier: Failed to load audio', err);
            this.container.querySelector('.sv-info').innerHTML =
                '<p style="color: #dc2626;">Failed to load audio waveform</p>';
        }
    }

    createSyllableRegions({ preserveManual = false } = {}) {
        if (!this.regions) return;

        // A genuinely new recording clears everything.  Version switching
        // only replaces automatic regions so manual spans and a pending
        // boundary remain visible and editable.
        if (preserveManual) {
            this.regions.getRegions?.()
                .filter((region) => !String(region.id || '').startsWith('manual-syllable-') && region.id !== 'manual-pending')
                .forEach((region) => region.remove?.());
        } else {
            this.regions.clearRegions();
        }

        const colors = [
            'rgba(59, 130, 246, 0.3)',   // Blue
            'rgba(16, 185, 129, 0.3)',   // Green
            'rgba(139, 92, 246, 0.3)',   // Purple
            'rgba(245, 158, 11, 0.3)',   // Amber
            'rgba(236, 72, 153, 0.3)',   // Pink
        ];

        this.syllables.forEach((syl, index) => {
            try {
                this.regions.addRegion({
                    id: `syllable-${index}`,
                    start: syl.startTime,
                    end: syl.endTime,
                    color: colors[index % colors.length],
                    drag: false,
                    resize: false,
                });
            } catch (err) {
                console.error(`SyllableVerifier: Failed to add region ${index}`, err);
            }
        });

        if (preserveManual) this.createManualRegions();
    }

    /**
     * Replace only the automatic syllable boundaries for a new V2/V3 view.
     * Manual segments, pending clicks, review mode, and save state belong to
     * the recording and must survive this inspection toggle.
     */
    setAutomaticSyllables(syllables = [], labels = null, ipaSegments = null) {
        this.syllables = Array.isArray(syllables) ? syllables : [];
        if (Array.isArray(labels) && labels.length === this.syllables.length) {
            this.syllableLabels = this.syllables.map((_, index) => labels[index] || this.getOrdinal(index + 1));
        } else {
            this.syllableLabels = this.syllables.map((_, index) => `Play ${this.getOrdinal(index + 1)} Syl`);
        }
        if (Array.isArray(ipaSegments)) this.ipaSegments = ipaSegments.slice();

        this.createSyllableRegions({ preserveManual: true });
        this.createSyllableBar();
        this.updateInfo();
        this.updateManualReviewUi();
    }

    /**
     * Format the display duration for a syllable.
     * Shows total duration when finite, otherwise vowel duration, or '—'.
     */
    formatSyllableDuration(syl) {
        const total = Number(syl?.duration);
        if (Number.isFinite(total) && total > 0) return `${total.toFixed(2)}s`;
        const totalCalc = Number(syl?.endTime) - Number(syl?.startTime);
        if (Number.isFinite(totalCalc) && totalCalc > 0) return `${totalCalc.toFixed(2)}s`;
        const vowel = Number(syl?.vowelDuration);
        if (Number.isFinite(vowel) && vowel > 0) return `${vowel.toFixed(2)}s`;
        return '\u2014';
    }

    /**
     * Resolve the display label for a syllable.
     * Uses target labels for aligned matches; labels inserted or unresolved
     * regions as 'Observed 1', 'Observed 2', etc.
     */
    resolveSyllableLabel(syl, index) {
        // If the syllable has an alignment type indicating insertion or unresolved,
        // use 'Observed N' numbering.
        const alignType = syl?.alignmentType || syl?.alignment_type;
        if (alignType === 'insertion' || alignType === 'unresolved') {
            const observedIndex = (syl?.observedIndex ?? index) + 1;
            return `Observed ${observedIndex}`;
        }
        // Use the provided label array for aligned (matched) syllables
        return this.syllableLabels[index] || `Observed ${index + 1}`;
    }

    createSyllableBar() {
        const bar = document.getElementById('sv-syllable-bar');
        if (!bar || !this.wavesurfer) return;

        const duration = this.wavesurfer.getDuration();
        if (!duration) return;

        bar.innerHTML = '';

        this.syllables.forEach((syl, index) => {
            const startPct = (syl.startTime / duration) * 100;
            const widthPct = ((syl.endTime - syl.startTime) / duration) * 100;

            const label = document.createElement('div');
            label.className = 'sv-syllable-label';
            label.style.left = `${startPct}%`;
            label.style.width = `${Math.max(widthPct, 5)}%`;
            label.style.maxWidth = `${Math.max(widthPct, 5)}%`;
            label.style.overflow = 'hidden';
            label.dataset.index = index;

            const displayLabel = this.resolveSyllableLabel(syl, index);
            const displayDuration = this.formatSyllableDuration(syl);

            label.innerHTML = `
                <span class="sv-syl-text" style="max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${displayLabel}</span>
                <span class="sv-syl-duration">${displayDuration}</span>
            `;

            label.addEventListener('click', () => {
                this.playSyllable(`syllable-${index}`);
            });

            bar.appendChild(label);
        });
    }

    updateInfo() {
        const info = document.getElementById('sv-info');
        if (!info) return;

        const total = this.syllables.reduce((sum, s) => sum + s.duration, 0);

        info.innerHTML = `
            <div class="sv-info-grid">
                <div class="sv-info-item">
                    <span class="sv-info-label">Syllables</span>
                    <span class="sv-info-value">${this.syllables.length}</span>
                </div>
                <div class="sv-info-item">
                    <span class="sv-info-label">Duration</span>
                    <span class="sv-info-value">${total.toFixed(2)}s</span>
                </div>
                <div class="sv-info-item">
                    <span class="sv-info-label">Avg</span>
                    <span class="sv-info-value">${(total / Math.max(1, this.syllables.length)).toFixed(2)}s</span>
                </div>
            </div>
            <p class="sv-hint">💡 Use a numbered label to hear that syllable</p>
        `;
    }

    /**
     * Play the entire audio at specified speed
     */
    playAll(speed = 1.0) {
        if (!this.wavesurfer) return;

        this.wavesurfer.setPlaybackRate(speed);
        if (this.isPlaying) {
            this.wavesurfer.pause();
        } else {
            this.wavesurfer.play();
        }
    }

    /**
     * Play a specific syllable region (stops at region end)
     */
    playSyllable(regionId) {
        if (!this.regions || !this.wavesurfer) return;

        const region = this.regions.getRegions().find(r => r.id === regionId);
        if (!region) return;

        // Stop any current playback first
        this.wavesurfer.pause();

        // Highlight the playing syllable
        this.highlightSyllable(regionId);

        // Get current speed from selector
        const speed = parseFloat(this.speedSelect?.value || '1.0');
        this.wavesurfer.setPlaybackRate(speed);

        // Seek to region start and play
        this.wavesurfer.setTime(region.start);
        this.wavesurfer.play();

        // Set up listener to stop at region end
        const checkEnd = () => {
            if (this.wavesurfer.getCurrentTime() >= region.end) {
                this.wavesurfer.pause();
                this.wavesurfer.un('audioprocess', checkEnd);
                this.clearHighlight();
            }
        };
        this.wavesurfer.on('audioprocess', checkEnd);

        // Also clear on pause/finish
        const cleanup = () => {
            this.wavesurfer.un('audioprocess', checkEnd);
            this.wavesurfer.un('pause', cleanup);
            this.wavesurfer.un('finish', cleanup);
            this.clearHighlight();
        };
        this.wavesurfer.on('pause', cleanup);
        this.wavesurfer.on('finish', cleanup);
    }

    /**
     * Play syllables one by one with gaps between them
     */
    async playBySyllable() {
        this.stop();
        this.isPlaying = true;

        for (let i = 0; i < this.syllables.length; i++) {
            if (!this.isPlaying) break; // Stopped by user

            const regionId = `syllable-${i}`;

            // Highlight current syllable
            this.highlightSyllable(regionId);

            // Play syllable
            const region = this.regions?.getRegions().find(r => r.id === regionId);
            if (region) {
                await this.playRegionAsync(region);
            }

            // Gap between syllables
            await this.sleep(300);

            this.clearHighlight();
        }

        this.isPlaying = false;
        this.updatePlayButton();
    }

    playRegionAsync(region) {
        return new Promise(resolve => {
            const duration = (region.end - region.start) * 1000;
            region.play();
            setTimeout(resolve, duration);
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    highlightSyllable(regionId) {
        // Update label bar
        const index = regionId.replace('syllable-', '');
        document.querySelectorAll('.sv-syllable-label').forEach(el => {
            el.classList.remove('playing');
        });
        const label = document.querySelector(`.sv-syllable-label[data-index="${index}"]`);
        if (label) {
            label.classList.add('playing');
        }
    }

    clearHighlight() {
        document.querySelectorAll('.sv-syllable-label').forEach(el => {
            el.classList.remove('playing');
        });
    }

    stop() {
        if (this.wavesurfer) {
            this.wavesurfer.stop();
        }
        this.isPlaying = false;
        this.clearHighlight();
        this.updatePlayButton();
    }

    updatePlayButton() {
        const btn = document.getElementById('sv-play-all');
        if (btn) {
            btn.textContent = this.isPlaying ? '⏸️ Pause' : '▶️ Play';
        }
    }

    /**
     * Get ordinal suffix for number (1st, 2nd, 3rd, etc.)
     */
    getOrdinal(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    // ============================================
    // V3 FEEDBACK MESSAGES
    // ============================================

    /**
     * Build a human-readable feedback message for v3 alignment issues.
     * @param {{ type: string, syllableIndex?: number, confidence?: number }} issue
     * @returns {string}
     */
    static buildV3FeedbackMessage(issue) {
        if (!issue || typeof issue !== 'object') {
            return 'Speech analysis is temporarily unavailable; try again.';
        }

        switch (issue.type) {
            case 'deletion': {
                const ordinal = SyllableVerifier.prototype.getOrdinal(
                    (issue.syllableIndex ?? 1) + 1
                );
                return `The ${ordinal} target syllable was not detected.`;
            }
            case 'insertion': {
                const afterIndex = issue.syllableIndex ?? 1;
                return `An extra vowel beat was detected after syllable ${afterIndex + 1}.`;
            }
            case 'low_confidence':
                return 'The syllable count is uncertain; try again more clearly.';
            case 'service_error':
                return 'Speech analysis is temporarily unavailable; try again.';
            default:
                return 'Speech analysis is temporarily unavailable; try again.';
        }
    }

    destroy() {
        if (this.wavesurfer) {
            this.wavesurfer.destroy();
            this.wavesurfer = null;
        }
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

// Export for use - works with both module and global patterns
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SyllableVerifier };
} else {
    window.SyllableVerifier = SyllableVerifier;
}
