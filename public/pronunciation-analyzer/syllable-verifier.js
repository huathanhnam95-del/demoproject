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

        this.wavesurfer = null;
        this.regions = null;
        this.syllables = [];
        this.syllableLabels = [];
        this.isPlaying = false;
        this.playingRegionId = null;

        // Comparison mode
        this.comparisonMode = false;
        this.nativeAudio = null;
        this.nativeSyllables = [];

        this.init();
    }

    hasPlayableTiming(syllable) {
        return Number.isFinite(syllable?.startTime) &&
            Number.isFinite(syllable?.endTime) &&
            syllable.endTime > syllable.startTime;
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
                    </div>
                </div>
                
                <div class="sv-waveform-container">
                    <div id="sv-waveform"></div>
                </div>
                
                <div class="sv-syllable-bar" id="sv-syllable-bar">
                    <!-- Syllable labels inserted here -->
                </div>
                
                <div class="sv-info" id="sv-info">
                    <p>Click on any syllable to hear it individually.</p>
                </div>
                
                <div class="sv-comparison-label" id="sv-comparison-label"></div>
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

        // Region click handler
        this.regions.on('region-clicked', (region, e) => {
            e.stopPropagation();
            this.playSyllable(region.id);
        });

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
        const playAllBtn = document.getElementById('sv-play-all');
        const speedSelect = document.getElementById('sv-speed-select');

        if (playAllBtn) {
            playAllBtn.addEventListener('click', () => {
                const speed = parseFloat(speedSelect?.value || '1.0');
                this.playAll(speed);
            });
        }

        // Store speed selector reference
        this.speedSelect = speedSelect;
    }

    /**
     * Load audio and display syllable regions
     * @param {Blob|string} audio - Audio blob or URL
     * @param {Array} syllables - Array of syllable objects with startTime, endTime, duration
     * @param {Array} labels - Optional array of syllable text labels
     */
    async loadAudio(audio, syllables, labels = null) {
        if (!this.wavesurfer) return;

        this.syllables = syllables;
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

    createSyllableRegions() {
        if (!this.regions) return;

        // Clear existing regions
        this.regions.clearRegions();

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
            <p class="sv-hint">💡 Click any region to hear that syllable</p>
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
        if (this.nativeAudio) {
            this.nativeAudio.pause();
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

    // ============================================
    // A/B COMPARISON MODE
    // ============================================

    /**
     * Load both native and user audio for comparison
     */
    async loadComparison(userAudio, userSyllables, nativeAudioUrl, nativeSyllables, labels) {
        this.nativeSyllables = Array.isArray(nativeSyllables)
            ? nativeSyllables.filter((syllable) => this.hasPlayableTiming(syllable))
            : [];
        this.comparisonMode = Boolean(nativeAudioUrl && this.nativeSyllables.length > 0);

        // Load user audio first
        await this.loadAudio(userAudio, userSyllables, labels);

        // Load native audio into separate element
        if (this.comparisonMode) {
            this.nativeAudio = new Audio(nativeAudioUrl);
            await new Promise((resolve, reject) => {
                this.nativeAudio.addEventListener('canplaythrough', resolve, { once: true });
                this.nativeAudio.addEventListener('error', reject, { once: true });
                this.nativeAudio.load();
            });

            // Add compare button
            this.addComparisonControls();
        }
    }

    addComparisonControls() {
        const controls = this.container.querySelector('.sv-controls');
        if (!controls) return;

        // Check if button already exists
        if (controls.querySelector('.sv-btn-compare')) return;

        const compareBtn = document.createElement('button');
        compareBtn.className = 'sv-btn sv-btn-compare';
        compareBtn.innerHTML = '🔄 A/B';
        compareBtn.title = 'Compare native vs your pronunciation';
        compareBtn.addEventListener('click', () => this.playComparison());

        controls.appendChild(compareBtn);
    }

    /**
     * Play native and user syllables alternating for comparison
     */
    async playComparison() {
        this.stop();
        this.isPlaying = true;

        const minSyllables = Math.min(
            this.syllables.length,
            this.nativeSyllables.length
        );

        for (let i = 0; i < minSyllables; i++) {
            if (!this.isPlaying) break;

            // Show native label
            this.showComparisonLabel(i, 'native');

            // Play native syllable
            await this.playNativeSyllable(i);

            await this.sleep(200);

            // Show user label
            this.showComparisonLabel(i, 'user');

            // Play user syllable
            this.highlightSyllable(`syllable-${i}`);
            const region = this.regions?.getRegions().find(r => r.id === `syllable-${i}`);
            if (region) {
                await this.playRegionAsync(region);
            }

            await this.sleep(400);

            this.clearHighlight();
            this.clearComparisonLabel();
        }

        this.isPlaying = false;
        this.updatePlayButton();
    }

    async playNativeSyllable(index) {
        if (!this.nativeAudio || !this.nativeSyllables[index]) return;

        const syl = this.nativeSyllables[index];
        if (!this.hasPlayableTiming(syl)) {
            return;
        }

        return new Promise(resolve => {
            try {
                this.nativeAudio.currentTime = syl.startTime;
                this.nativeAudio.play();
            } catch (_error) {
                resolve();
                return;
            }

            const duration = (syl.endTime - syl.startTime) * 1000;
            setTimeout(() => {
                this.nativeAudio.pause();
                resolve();
            }, duration);
        });
    }

    showComparisonLabel(syllableIndex, type) {
        const label = document.getElementById('sv-comparison-label');
        if (!label) return;

        label.innerHTML = type === 'native'
            ? `🟢 Native: Syllable ${syllableIndex + 1}`
            : `🔵 Yours: Syllable ${syllableIndex + 1}`;

        label.className = `sv-comparison-label sv-${type}`;
    }

    clearComparisonLabel() {
        const label = document.getElementById('sv-comparison-label');
        if (label) {
            label.innerHTML = '';
            label.className = 'sv-comparison-label';
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
        if (this.nativeAudio) {
            this.nativeAudio.pause();
            this.nativeAudio = null;
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
