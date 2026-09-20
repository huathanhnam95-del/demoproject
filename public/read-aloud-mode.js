class ReadAloudMode {
  static KOKORO_VOICES = {
    male: [
      { id: 'am_echo', name: 'Echo', accent: 'American' },
      { id: 'am_eric', name: 'Eric', accent: 'American' },
      { id: 'am_fenrir', name: 'Fenrir', accent: 'American' },
      { id: 'am_liam', name: 'Liam', accent: 'American' },
      { id: 'am_michael', name: 'Michael', accent: 'American' },
      { id: 'am_puck', name: 'Puck', accent: 'American' },
      { id: 'bm_fable', name: 'Fable', accent: 'British' },
      { id: 'bm_george', name: 'George', accent: 'British' },
      { id: 'bm_lewis', name: 'Lewis', accent: 'British' },
    ],
    female: [
      { id: 'af_alloy', name: 'Alloy', accent: 'American' },
      { id: 'af_bella', name: 'Bella', accent: 'American' },
      { id: 'af_heart', name: 'Heart', accent: 'American' },
      { id: 'af_kore', name: 'Kore', accent: 'American' },
      { id: 'af_sarah', name: 'Sarah', accent: 'American' },
      { id: 'bf_emma', name: 'Emma', accent: 'British' },
    ],
  };
  constructor() {
    this.isActive = false;
    this.isEntering = false;
    this.currentPromptPlainText = '';
    this.currentPromptChunkedText = '';
    this.currentPromptRenderState = null;
    this.currentPromptFeatureRecord = null;
    this.currentPromptRow = null;
    this.lastPromptRow = null;
    this.currentPromptReady = false;
    this.prepSeconds = 0;
    this.recordSeconds = 0;
    this.state = 'IDLE'; // IDLE, PREP, REQUESTING_MIC, RECORDING, STOPPING_RECORDING, RECORDED, RESULTS
    this.timerInterval = null;
    this.prepTutorialHold = null; // pause/resume listeners while a tutorial overlay is open
    this.pendingBlob = null;
    this.pendingSession = null;
    this.pendingPteNextOwnership = null;
    this.database = [];
    this.currentTranscript = '';
    this.hasLoadedDatabase = false;
    this.supportMessage = 'Microphone recording is not supported in this browser. Please use Chrome or Edge.';

    // Prompt guides state.
    // connectedSpeechModes is the source of truth — several guides can be active
    // at once. `connectedSpeechLevel` is a compatibility accessor over it (see
    // the get/set pair below) so existing analytics, cache keys, and session
    // payloads keep seeing a single dominant level.
    this.chunkingEnabled = false;
    this.connectedSpeechModes = new Set();
    this.connectedSpeechLevel = 'off';
    this.sessionChunkingEnabled = false;
    this.sessionConnectedSpeechModes = new Set();
    this.connectedSpeechLayerOverrides = new Set();
    this.sessionConnectedSpeechLayerOverrides = new Set();
    this.promptAnalysisCache = new Map();
    this.promptAnalysisPromiseCache = new Map();
    this.sharedLinkingPronunciations = new Map();
    this.sharedReducedWordForms = new Map();
    this.sharedPronunciationWarmup = this.primeSharedPronunciations([{
      phrase: 'a an the to of and for can have has had was were from that some as at than but or are you your them his her do does must should would could us she he we is seven ten'
    }]).catch((error) => {
      console.warn('[ReadAloud] Shared pronunciation warmup failed:', error);
    });
    this.activePromptKey = null;
    this.activePromptRenderToken = 0;
    this.resizeObserver = null;
    this.pendingLinkingFrame = null;
    this.pendingLinkingRetry = null;
    this.pendingFontHydration = null;
    this.connectedSpeechPanelMode = 'hidden';
    this.currentGuideExplanationItems = [];
    this.currentGuideInteractionItems = new Map();
    this.selectedGuideItemId = null;
    this.currentGuideHasVisibleAssimilation = false;
    // The toggle wrote 'ra-speech-coach-visible' but nothing ever read it, so
    // the flag started undefined and the coach opened collapsed every session.
    // Now that the coach sits in a rail beside the passage rather than in a card
    // far below it, open is the useful default.
    this.speechCoachVisible = (() => {
      try {
        const stored = localStorage.getItem('ra-speech-coach-visible');
        return stored === null ? true : stored !== 'false';
      } catch (_) {
        return true;
      }
    })();
    this.guideExplanationsExpanded = null;
    this.guideExplanationsToggled = false;
    this.activeSoundChangeTooltipId = null;
    this.soundChangeTooltipPinned = false;
    this.soundChangeTooltipLeaveTimer = null;
    this.lastRecognizedLinkingPairs = [];

    // Kokoro TTS voice state
    this.audioManifest = null;
    this.currentQuestionId = null;
    this.speechCoachAudioManifestCache = new Map();
    this.speechCoachAudioManifestPromises = new Map();
    this.speechCoachModelAudio = null;
    this.speechCoachModelButton = null;
    this.speechCoachYoursButton = null;
    this.selectedGender = null;
    this.selectedVoiceId = null;
    this.selectedVoiceName = null;
    this.selectedVoiceAccent = null;
    this.selectedSpeed = '100';
    this.hasLoadedManifest = false;
    this.sampleAudioFilter = 'all';
    this.promptFeatureFilter = 'all';
    this.difficultyFilter = 'all';
    this.voiceDropdownOpen = false;
    this.promptFeatureIndex = new Map();
    this.promptFeatureIndexReady = false;
    this.promptFeatureIndexPromise = null;
    this.promptFeatureIndexVersion = '';
    this.promptFeatureIndexError = null;
    this.featuredPromptIndex = null;
    this.featuredPromptIndexReady = false;
    this.featuredPromptIndexPromise = null;
    this.featuredPromptIndexError = null;
    this.featuredPromptIndexVersion = '';
    this.practiceTargetDrawerOpen = false;
    this.settingsSheet = null;
    this.promptOrderMode = this.loadPromptOrderMode();

    // Recording state
    this.mediaRecorder = null;
    this.audioStream = null;
    this.currentRecordingSession = null;
    this.promptLifecycleToken = 0;
    this.recordingRequestId = 0;
    this.hasAssessmentResult = false;
    this.lastAssessmentPayload = null;
    this.lastAssessmentSession = null;
    // Status line the results panel was rendered with. Kept so a later
    // updateUIForState() cannot replace a scoring error with 'Analysis complete.'
    this.assessmentStatusMessage = '';
    this.isSubmitInFlight = false;
    this.userRecordingUrl = null;
    this.assessmentAudioBuffer = null;
    this.wordPlaybackContext = null;
    this.wordPlaybackSource = null;
    this.wordPlaybackButton = null;
    this.recordedSegmentPlayback = { revision: 0, sourceKind: null, sourceNode: null, mediaElement: null, timer: null, button: null, metadataCleanup: null };
    this.speechCoachResultRevision = 0;
    this.customPlayerActiveSource = 'yours';

    // Question Picker v7 (Read Aloud only)
    this.v7JumpQuery = '';
    this.v7SheetTab = 'jump';
    this.v7LastFocusedElement = null;

    this.bindEvents();
  }

  static escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  static formatTime(seconds) {
    if (window.PracticeAudioPlayer?.formatTime) {
      return window.PracticeAudioPlayer.formatTime(seconds);
    }
    if (!seconds || !Number.isFinite(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Highest-precedence guide in a set, for the many callers that still expect a
   * single level (analytics payloads, analysis cache keys, recording sessions,
   * the results panel). Precedence mirrors the old cumulative ordering.
   */
  static dominantConnectedSpeechMode(modes) {
    if (!modes || modes.size === 0) return 'off';
    if (modes.has('sound_changes')) return 'sound_changes';
    if (modes.has('reduced_words')) return 'reduced_words';
    if (modes.has('linking')) return 'linking';
    return 'off';
  }

  /** Collapse a set to a single level, in place. */
  collapseConnectedSpeechModes(setName, level) {
    const normalized = this.normalizeConnectedSpeechMode(level);
    if (!this[setName]) this[setName] = new Set();
    this[setName].clear();
    if (normalized !== 'off') this[setName].add(normalized);
  }

  get connectedSpeechLevel() {
    return ReadAloudMode.dominantConnectedSpeechMode(this.connectedSpeechModes);
  }

  /** Assigning a single level collapses the active set to just that level. */
  set connectedSpeechLevel(level) {
    this.collapseConnectedSpeechModes('connectedSpeechModes', level);
  }

  /**
   * Derived from sessionConnectedSpeechModes rather than stored separately, so
   * the two can never drift apart.
   */
  get sessionConnectedSpeechLevel() {
    return ReadAloudMode.dominantConnectedSpeechMode(this.sessionConnectedSpeechModes);
  }

  set sessionConnectedSpeechLevel(level) {
    this.collapseConnectedSpeechModes('sessionConnectedSpeechModes', level);
  }

  /**
   * The single funnel the render path, the guide cards and the assessment
   * session all read from. In the simple tier it reports the fixed beginner set
   * rather than the chip selection, so a Basic learner sees marks and coaching
   * without the chips ever being shown to them. `connectedSpeechModes` stays
   * untouched, so switching to Advanced restores whatever they had picked.
   */
  getActiveConnectedSpeechModes() {
    if (this.isPteShellEnabled()) return [...(this.connectedSpeechModes || [])];
    if (this.getCoachTier() === 'simple') {
      return [...this.getSimpleTierModes()];
    }
    return [...(this.connectedSpeechModes || [])];
  }

  isConnectedSpeechModeActive(mode) {
    return !!this.connectedSpeechModes?.has(this.normalizeConnectedSpeechMode(mode));
  }

  getAssessmentConnectedSpeechModes(options = {}, session = this.lastAssessmentSession) {
    const helper = window.ReadAloudSpeechCoach;
    if (!helper?.resolveSelectedModes) return new Set(['linking', 'reduced_words', 'sound_changes']);
    const source = {};
    if (options.sessionConnectedSpeechModes instanceof Set || Array.isArray(options.sessionConnectedSpeechModes)) {
      source.sessionConnectedSpeechModes = options.sessionConnectedSpeechModes;
    } else if (session?.sessionConnectedSpeechModes instanceof Set || Array.isArray(session?.sessionConnectedSpeechModes)) {
      source.sessionConnectedSpeechModes = session.sessionConnectedSpeechModes;
    } else if (Object.prototype.hasOwnProperty.call(options, 'sessionConnectedSpeechLevel')) {
      source.sessionConnectedSpeechLevel = options.sessionConnectedSpeechLevel;
    } else if (session && Object.prototype.hasOwnProperty.call(session, 'sessionConnectedSpeechLevel')) {
      source.sessionConnectedSpeechLevel = session.sessionConnectedSpeechLevel;
    }
    return new Set(helper.resolveSelectedModes(source));
  }

  filterSpeechCoachEvents(events, modes) {
    const selectedModes = modes instanceof Set ? [...modes] : [...(modes || [])];
    return window.ReadAloudSpeechCoach?.buildResultModel?.({
      events,
      sessionConnectedSpeechModes: selectedModes
    }).events || [];
  }

  setSpeechCoachModeHint(hostId, guidance = null) {
    const host = document.getElementById(hostId);
    if (!host) return;
    this.closeSpeechCoachModeTooltips();
    host.replaceChildren();
    if (!guidance?.message || !guidance?.triggerLabel) {
      host.hidden = true;
      return;
    }

    const tooltipId = `${hostId}-tooltip`;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ra-feedback-mode-hint__trigger';
    trigger.textContent = guidance.triggerLabel;
    trigger.setAttribute('aria-describedby', tooltipId);
    trigger.setAttribute('aria-expanded', 'false');

    const tooltip = document.createElement('span');
    tooltip.id = tooltipId;
    tooltip.className = 'ra-feedback-mode-hint__tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = guidance.message;
    tooltip.hidden = true;

    const open = () => this.openSpeechCoachModeTooltip(host);
    const closeIfUnpinned = (event) => {
      if (host.dataset.tooltipPinned === 'true' || host.contains(event.relatedTarget)) return;
      this.closeSpeechCoachModeTooltips();
    };
    trigger.addEventListener('pointerenter', open);
    trigger.addEventListener('pointerleave', closeIfUnpinned);
    trigger.addEventListener('focus', open);
    trigger.addEventListener('blur', closeIfUnpinned);
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const shouldPin = host.dataset.tooltipPinned !== 'true' || tooltip.hidden;
      this.closeSpeechCoachModeTooltips();
      if (shouldPin) {
        host.dataset.tooltipPinned = 'true';
        this.openSpeechCoachModeTooltip(host);
      }
    });
    host.append(trigger, tooltip);
    host.hidden = false;
  }

  updateSpeechCoachModeHints(selectedModes) {
    const modes = selectedModes instanceof Set ? [...selectedModes] : [...(selectedModes || [])];
    const guidance = window.ReadAloudSpeechCoach?.getGuidance?.(modes) || null;
    if (modes.length === 0) {
      this.setSpeechCoachModeHint('ra-feedback-mode-hint', guidance);
      this.setSpeechCoachModeHint('ra-connected-speech-mode-hint');
      return;
    }
    this.setSpeechCoachModeHint('ra-feedback-mode-hint');
    this.setSpeechCoachModeHint('ra-connected-speech-mode-hint', guidance);
  }

  openSpeechCoachModeTooltip(host) {
    const tooltip = host?.querySelector('[role="tooltip"]');
    const trigger = host?.querySelector('.ra-feedback-mode-hint__trigger');
    if (!tooltip || !trigger) return;
    tooltip.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }

  closeSpeechCoachModeTooltips() {
    document.querySelectorAll('.ra-feedback-mode-hint').forEach((host) => {
      host.dataset.tooltipPinned = 'false';
      const tooltip = host.querySelector('[role="tooltip"]');
      const trigger = host.querySelector('.ra-feedback-mode-hint__trigger');
      if (tooltip) tooltip.hidden = true;
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }

  normalizeConnectedSpeechMode(level) {
    const candidate = String(level || '').trim().toLowerCase();
    if (!candidate) return 'off';
    if (candidate === 'off' || candidate === 'linking' || candidate === 'reduced_words' || candidate === 'sound_changes') {
      return candidate;
    }
    if (candidate === 'v1_linking') return 'linking';
    if (candidate === 'v2_reduced_words') return 'reduced_words';
    if (candidate === 'v3_sound_changes') return 'sound_changes';
    return 'off';
  }

  getEffectiveViewMode() {
    const modePanel = document.getElementById('mode-read-aloud');
    const controller = modePanel?.querySelector('.spc-controller');
    const domView = modePanel?.dataset?.spcView || controller?.dataset?.spcView;
    if (domView === 'basic' || domView === 'advanced') {
      return domView;
    }
    if (window.SpeakingPracticeController?.getPreferredView) {
      const preferred = window.SpeakingPracticeController.getPreferredView();
      if (preferred === 'basic' || preferred === 'advanced') {
        return preferred;
      }
    }
    return 'basic';
  }

  /**
   * Basic and Advanced are not "coach off" and "coach on" — they are two tiers of
   * the same coach. Basic used to suppress the guide marks and the rail entirely,
   * which meant a first-time learner (Basic is the default view) never saw the
   * feature at all unless they found the Advanced toggle.
   *
   * simple: marks on, plain-language rail, no chips, no IPA, no scored sections.
   * full:   the learner picks guides, and gets IPA and the scored breakdown.
   */
  getCoachTier() {
    return this.getEffectiveViewMode() === 'advanced' ? 'full' : 'simple';
  }

  /**
   * In the simple tier the learner does not choose guides — the two that carry
   * the most value for a beginner are always on. The chips stay Advanced-only.
   */
  getSimpleTierModes() {
    return new Set(['linking', 'reduced_words']);
  }

  getLegacyConnectedSpeechLevel(mode = this.connectedSpeechLevel) {
    const normalized = this.normalizeConnectedSpeechMode(mode);
    if (normalized === 'linking') return 'v1_linking';
    if (normalized === 'reduced_words') return 'v2_reduced_words';
    if (normalized === 'sound_changes') return 'v3_sound_changes';
    return 'off';
  }

  getConnectedSpeechDisplayLabel(mode = this.connectedSpeechLevel) {
    const normalized = this.normalizeConnectedSpeechMode(mode);
    if (normalized === 'linking') return 'Linking';
    if (normalized === 'reduced_words') return 'Reduced words';
    if (normalized === 'sound_changes') return 'Sound changes';
    return 'Off';
  }

  getConnectedSpeechAnnouncement() {
    const active = this.getActiveConnectedSpeechModes();
    if (active.length === 0) {
      return 'Connected speech turned off.';
    }
    const order = ['linking', 'reduced_words', 'sound_changes'];
    const labels = order
      .filter((mode) => active.includes(mode))
      .map((mode) => this.getConnectedSpeechDisplayLabel(mode).toLowerCase());
    if (labels.length === 1) {
      return `Connected speech showing ${labels[0]}.`;
    }
    const last = labels.pop();
    return `Connected speech showing ${labels.join(', ')} and ${last}.`;
  }

  /**
   * Guides can now be combined, so the analysis always runs with the superset
   * ruleset whenever anything is active. connected-speech-v3 adds assimilation
   * on top of the linking-v1 rules, and is what makes reduced-word annotations
   * available, so one pass covers every combination. Which layers actually get
   * drawn is decided at render time from the active mode set.
   */
  getConnectedSpeechRuleSet() {
    return this.connectedSpeechModes?.size ? 'connected-speech-v3' : 'none';
  }

  getConnectedSpeechPromptCategoryMap() {
    const record = this.currentPromptFeatureRecord || {};
    const examples = record.previewExamplesByCategory || {};
    return new Map(
      Object.entries(examples).map(([category, items]) => [
        this.normalizeConnectedSpeechMode(category),
        Array.isArray(items) ? items : []
      ])
        .filter(([, items]) => Array.isArray(items) && items.length > 0)
    );
  }

  bindEvents() {
    document.getElementById('ra-next-btn')?.addEventListener('click', () => this.loadNextPrompt());
    document.getElementById('ra-record-btn')?.addEventListener('click', () => this.handleRecordClick());
    document.getElementById('ra-stop-btn')?.addEventListener('click', () => this.stopRecordingManually());
    document.getElementById('ra-play-recording-btn')?.addEventListener('click', () => this.playRecordedAudio());
    document.getElementById('ra-check-btn')?.addEventListener('click', () => this.handleCheckResult());
    document.getElementById('ra-retry-btn')?.addEventListener('click', () => this.retryCurrentPrompt());
    document.getElementById('ra-show-advanced-btn')?.addEventListener('click', () => { void this.toggleAdvancedAnalysisView(); });

    document.getElementById('ra-voice-male')?.addEventListener('click', () => this.setGender('male'));
    document.getElementById('ra-voice-female')?.addEventListener('click', () => this.setGender('female'));
    document.getElementById('ra-voice-picker-btn')?.addEventListener('click', () => this.randomizeVoice());
    document.getElementById('ra-voice-dropdown-toggle')?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleVoiceDropdown(); });
    document.getElementById('ra-voice-dropdown-list')?.addEventListener('click', (e) => this.handleVoiceDropdownClick(e));
    document.addEventListener('click', () => this.closeVoiceDropdown());
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.ra-feedback-mode-hint')) this.closeSpeechCoachModeTooltips();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeSpeechCoachModeTooltips();
    });
    document.getElementById('ra-speed-100')?.addEventListener('click', () => this.setSpeed('100'));
    document.getElementById('ra-speed-80')?.addEventListener('click', () => this.setSpeed('80'));
    document.getElementById('ra-play-audio-btn')?.addEventListener('click', () => this.playAudio());
    // Settings: toggle / events open Settings sheet
    document.getElementById('ra-practice-target-toggle')?.addEventListener('click', () => this.openSettingsSheet());
    this.bindCustomAudioPlayer();

    window.addEventListener('spc-open-settings', (e) => {
      if (!e.detail?.modeId || e.detail?.modeId === 'read-aloud') {
        this.openSettingsSheet();
      }
    });

    const handleViewChange = async () => {
      const isRaVisible = document.getElementById('mode-read-aloud')?.style.display !== 'none';
      if (this.isActive || isRaVisible) {
        // Basic shows linking and reduced words without ever exposing a chip, so a
        // learner arriving in Advanced for the first time has an empty chip set and
        // would land on a blank passage — a step backwards from what they were just
        // looking at. Carry the simple tier's guides across as the starting point.
        if (this.getEffectiveViewMode() === 'advanced' && !this.connectedSpeechModes?.size && !this._hasSeededAdvancedModes) {
          this.connectedSpeechModes = new Set(this.getSimpleTierModes());
          this.sessionConnectedSpeechModes = new Set(this.getSimpleTierModes());
          this._hasSeededAdvancedModes = true;
          this.updatePromptGuideButtons();
        }
        if (typeof this.renderPromptForCurrentView === 'function') {
          this.renderPromptForCurrentView();
        }
        const viewMode = this.getEffectiveViewMode();
        if (this.state === 'RESULTS') {
          const showAdvContainer = document.getElementById('ra-show-advanced-container');
          const showAdvBtn = document.getElementById('ra-show-advanced-btn');
          if (this.lastAssessmentPayload?.connectedSpeech) {
            // Both tiers render the coach; only the depth of it changes.
            const resultModes = this.getAssessmentConnectedSpeechModes({}, this.lastAssessmentSession);
            if (showAdvContainer) {
              showAdvContainer.style.display = viewMode === 'basic' && resultModes.size > 0 ? 'block' : 'none';
            }
            if (showAdvBtn && viewMode === 'basic') showAdvBtn.textContent = '✨ Show detailed analysis';
            await this.renderConnectedSpeechResults(this.lastAssessmentPayload.connectedSpeech, {
              transcriptText: this.lastAssessmentPayload.recognizedText || this.currentPromptPlainText,
              sessionViewMode: viewMode,
              sessionConnectedSpeechModes: this.lastAssessmentSession?.sessionConnectedSpeechModes,
              sessionConnectedSpeechLevel: this.lastAssessmentSession?.sessionConnectedSpeechLevel || this.connectedSpeechLevel
            });
          }
        }
      }
    };
    window.addEventListener('spc-view-change', handleViewChange);
    window.addEventListener('spc-view-changed', handleViewChange);

    document.getElementById('ra-question-select')?.addEventListener('change', (event) => {
      if (event.target.value === 'random') {
        this.loadNextPrompt();
      } else {
        this.loadSpecificPrompt(parseInt(event.target.value, 10));
      }
    });

    // Question Picker v7 bindings (Read Aloud only)
    document.getElementById('ra-v7-prev-btn')?.addEventListener('click', () => this.loadPreviousPrompt());
    document.getElementById('ra-v7-next-btn')?.addEventListener('click', () => this.loadNextPrompt());
    document.getElementById('ra-v7-question-pill')?.addEventListener('click', () => this.openQuestionPickerV7('jump'));
    document.getElementById('ra-v7-filters-btn')?.addEventListener('click', () => this.openQuestionPickerV7('filters'));
    document.getElementById('ra-v7-sheet-close')?.addEventListener('click', () => this.closeQuestionPickerV7());
    document.getElementById('ra-v7-done-btn')?.addEventListener('click', () => this.closeQuestionPickerV7());
    document.getElementById('ra-v7-backdrop')?.addEventListener('click', () => this.closeQuestionPickerV7());
    document.getElementById('ra-v7-tab-jump')?.addEventListener('click', () => this.setQuestionPickerV7Tab('jump'));
    document.getElementById('ra-v7-tab-filters')?.addEventListener('click', () => this.setQuestionPickerV7Tab('filters'));
    document.getElementById('ra-v7-jump-search')?.addEventListener('input', (event) => {
      this.v7JumpQuery = String(event?.target?.value || '');
      this.renderQuestionPickerV7JumpList();
    });
    document.getElementById('ra-v7-jump-list')?.addEventListener('click', (event) => this.handleQuestionPickerV7JumpClick(event));
    document.getElementById('ra-v7-panel-filters')?.addEventListener('click', (event) => this.handleQuestionPickerV7FilterClick(event));
    if (document.getElementById('ra-v7-sheet')) {
      document.addEventListener('keydown', (event) => this.handleQuestionPickerV7Keydown(event), true);
    }

    // Header audio shortcuts (v7 proxy buttons)
    document.getElementById('header-ra-play-audio-btn')?.addEventListener('click', () => this.playAudio());
    document.getElementById('header-ra-play-recording-btn')?.addEventListener('click', () => this.playRecordedAudio());

    document.getElementById('ra-toggle-chunking-btn')?.addEventListener('click', () => this.togglePromptGuide('chunking'));
    document.getElementById('ra-toggle-linking-btn')?.addEventListener('click', () => this.toggleConnectedSpeechLevel('linking'));
    document.getElementById('ra-toggle-reduced-words-btn')?.addEventListener('click', () => this.toggleConnectedSpeechLevel('reduced_words'));
    document.getElementById('ra-toggle-sound-changes-btn')?.addEventListener('click', () => this.toggleConnectedSpeechLevel('sound_changes'));
    document.getElementById('ra-toggle-chunking-btn')?.addEventListener('keydown', (event) => this.handlePromptGuideKeydown(event, 'chunking'));
    document.getElementById('ra-toggle-linking-btn')?.addEventListener('keydown', (event) => this.handleConnectedSpeechKeydown(event, 'linking'));
    document.getElementById('ra-toggle-reduced-words-btn')?.addEventListener('keydown', (event) => this.handleConnectedSpeechKeydown(event, 'reduced_words'));
    document.getElementById('ra-toggle-sound-changes-btn')?.addEventListener('keydown', (event) => this.handleConnectedSpeechKeydown(event, 'sound_changes'));
    const promptStage = document.getElementById('ra-prompt-stage');
    promptStage?.addEventListener('click', (event) => this.handleGuideTargetInteraction(event));
    promptStage?.addEventListener('keydown', (event) => this.handleGuideTargetKeydown(event));
    promptStage?.addEventListener('pointerover', (event) => this.handleSoundChangeTooltipEnter(event));
    promptStage?.addEventListener('pointerout', (event) => this.handleSoundChangeTooltipLeave(event));
    promptStage?.addEventListener('focusin', (event) => this.handleSoundChangeTooltipEnter(event));
    promptStage?.addEventListener('focusout', (event) => this.handleSoundChangeTooltipLeave(event));
    const soundChangeTooltip = document.getElementById('ra-sound-change-tooltip');
    soundChangeTooltip?.addEventListener('pointerenter', () => {
      if (this.soundChangeTooltipLeaveTimer) {
        clearTimeout(this.soundChangeTooltipLeaveTimer);
        this.soundChangeTooltipLeaveTimer = null;
      }
    });
    soundChangeTooltip?.addEventListener('pointerleave', (event) => {
      if (this.soundChangeTooltipPinned) return;
      const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
      const relatedTarget = this.getSoundChangeTooltipTarget(related);
      const relatedGuideId = String(relatedTarget?.getAttribute('data-guide-target') || '').trim();
      if (relatedGuideId && relatedGuideId === this.activeSoundChangeTooltipId) return;
      this.hideSoundChangeTooltip();
    });
    document.getElementById('ra-connected-speech-badges')?.addEventListener('click', (event) => this.handleGuideTargetInteraction(event));
    document.getElementById('ra-connected-speech-badges')?.addEventListener('keydown', (event) => this.handleGuideTargetKeydown(event));
    document.getElementById('ra-connected-speech-list')?.addEventListener('click', (event) => this.handleGuideTargetInteraction(event));
    document.getElementById('ra-connected-speech-list')?.addEventListener('keydown', (event) => this.handleGuideTargetKeydown(event));
    document.getElementById('ra-linking-fallback-list')?.addEventListener('click', (event) => this.handleGuideTargetInteraction(event));
    document.getElementById('ra-linking-fallback-list')?.addEventListener('keydown', (event) => this.handleGuideTargetKeydown(event));
    document.addEventListener('click', (event) => {
      if (this.activeSoundChangeTooltipId
          && !event.target.closest('#ra-prompt-stage')
          && !event.target.closest('#ra-sound-change-tooltip')) {
        this.hideSoundChangeTooltip();
      }
    });
    document.getElementById('ra-speech-coach-toggle')?.addEventListener('click', () => this.toggleSpeechCoachVisibility());
    document.getElementById('ra-connected-speech-box')?.addEventListener('click', (e) => {
      const infoBtn = e.target.closest('.sc-info-tip');
      if (infoBtn) {
        e.stopPropagation();
        const type = infoBtn.dataset.scInfo || 'general';
        this.showSpeechCoachInfoModal(type);
      }
    });

    document.getElementById('ra-filter-all')?.addEventListener('click', () => this.setSampleAudioFilter('all'));
    document.getElementById('ra-filter-available')?.addEventListener('click', () => this.setSampleAudioFilter('available'));
    document.getElementById('ra-filter-unavailable')?.addEventListener('click', () => this.setSampleAudioFilter('unavailable'));
    document.getElementById('ra-filter-feature-all')?.addEventListener('click', () => this.setPromptFeatureFilter('all'));
    document.getElementById('ra-filter-any-connected')?.addEventListener('click', () => this.setPromptFeatureFilter('any_connected'));
    document.getElementById('ra-filter-linking')?.addEventListener('click', () => this.setPromptFeatureFilter('linking'));
    document.getElementById('ra-filter-reduced-words')?.addEventListener('click', () => this.setPromptFeatureFilter('reduced_words'));
    document.getElementById('ra-filter-sound-changes')?.addEventListener('click', () => this.setPromptFeatureFilter('sound_changes'));

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName !== 'class') return;
        const panel = document.getElementById('mode-read-aloud');
        if (!panel) return;
        if (panel.classList.contains('active')) {
          if (!this.isActive) {
            this.onEnter();
          }
        } else if (this.isActive) {
          this.onExit();
        }
      });
    });

    const panel = document.getElementById('mode-read-aloud');
    if (panel) observer.observe(panel, { attributes: true });
  }

  getActiveCustomAudioElement() {
    return this.customPlayerActiveSource === 'sample'
      ? document.getElementById('ra-elevenlabs-audio')
      : document.getElementById('ra-user-recording-audio');
  }

  updateCustomPlayButton(isPlaying) {
    const playIcon = document.getElementById('ra-custom-play-icon');
    const playLabel = document.getElementById('ra-custom-play-label');
    const playBtn = document.getElementById('ra-custom-play-btn');
    if (playIcon) playIcon.textContent = isPlaying ? 'pause' : 'play_arrow';
    if (playLabel) playLabel.textContent = isPlaying ? 'Pause' : 'Play';
    if (playBtn) playBtn.setAttribute('aria-label', isPlaying ? 'Pause audio' : 'Play audio');
  }

  syncCustomAudioProgress() {
    const audio = this.getActiveCustomAudioElement();
    const progressFill = document.getElementById('ra-custom-progress-fill');
    const seekInput = document.getElementById('ra-custom-seek');
    const timeDisplay = document.getElementById('ra-custom-audio-time');
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      if (progressFill) progressFill.style.width = '0%';
      if (seekInput) {
        seekInput.value = '0';
        seekInput.disabled = !audio || !audio.src;
      }
      const cur = audio ? ReadAloudMode.formatTime(audio.currentTime) : '00:00';
      if (timeDisplay) timeDisplay.textContent = `${cur} / 00:00`;
      return;
    }
    if (seekInput) seekInput.disabled = false;
    const pct = Math.min(100, Math.max(0, (audio.currentTime / audio.duration) * 100));
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (seekInput) seekInput.value = String(pct);
    if (timeDisplay) {
      const cur = ReadAloudMode.formatTime(audio.currentTime);
      const dur = ReadAloudMode.formatTime(audio.duration);
      timeDisplay.textContent = `${cur} / ${dur}`;
    }
  }

  toggleCustomPlayerPlayback() {
    const audio = this.getActiveCustomAudioElement();
    if (!audio || !audio.src) return;
    if (audio.paused) {
      this.stopSpeechCoachModelAudio();
      this.stopSpeechCoachYoursAudio({ pause: true, resetTime: true });
      const otherAudio = this.customPlayerActiveSource === 'sample'
        ? document.getElementById('ra-user-recording-audio')
        : document.getElementById('ra-elevenlabs-audio');
      if (otherAudio && !otherAudio.paused) {
        otherAudio.pause();
      }
      const volumeInput = document.getElementById('ra-custom-volume');
      if (volumeInput) audio.volume = Number(volumeInput.value);
      const playPromise = audio.play();
      this.updateCustomPlayButton(true);
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          this.updateCustomPlayButton(false);
        });
      }
    } else {
      audio.pause();
      this.updateCustomPlayButton(false);
    }
  }

  switchCustomAudioSource(source) {
    if (this.customPlayerActiveSource === source) return;
    const currentAudio = this.getActiveCustomAudioElement();
    if (currentAudio && !currentAudio.paused) currentAudio.pause();

    this.customPlayerActiveSource = source;

    const tabYours = document.getElementById('ra-source-tab-yours');
    const tabSample = document.getElementById('ra-source-tab-sample');

    if (source === 'yours') {
      tabYours?.classList.add('active');
      tabYours?.setAttribute('aria-selected', 'true');
      tabSample?.classList.remove('active');
      tabSample?.setAttribute('aria-selected', 'false');
    } else {
      tabSample?.classList.add('active');
      tabSample?.setAttribute('aria-selected', 'true');
      tabYours?.classList.remove('active');
      tabYours?.setAttribute('aria-selected', 'false');
      const sampleAudio = document.getElementById('ra-elevenlabs-audio');
      if (sampleAudio && (!sampleAudio.src || sampleAudio.src.endsWith('/null') || sampleAudio.src.endsWith('/undefined'))) {
        if (!this.selectedGender && this.audioManifest && this.currentQuestionId) {
          const entry = this.audioManifest[this.currentQuestionId];
          if (entry) {
            this.selectedGender = entry.female ? 'female' : (entry.male ? 'male' : 'male');
          }
        }
        this.updateAudioSrc();
      }
    }

    const newAudio = this.getActiveCustomAudioElement();
    this.updateCustomPlayButton(newAudio ? !newAudio.paused : false);
    this.syncCustomAudioProgress();
  }

  bindCustomAudioPlayer() {
    const playBtn = document.getElementById('ra-custom-play-btn');
    const seekInput = document.getElementById('ra-custom-seek');
    const volumeInput = document.getElementById('ra-custom-volume');
    const tabYours = document.getElementById('ra-source-tab-yours');
    const tabSample = document.getElementById('ra-source-tab-sample');

    tabYours?.addEventListener('click', () => this.switchCustomAudioSource('yours'));
    tabSample?.addEventListener('click', () => this.switchCustomAudioSource('sample'));

    playBtn?.addEventListener('click', () => this.toggleCustomPlayerPlayback());

    seekInput?.addEventListener('input', () => {
      const audio = this.getActiveCustomAudioElement();
      if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const pct = Math.min(100, Math.max(0, Number(seekInput.value) || 0));
      audio.currentTime = (pct / 100) * audio.duration;
      this.syncCustomAudioProgress();
    });

    volumeInput?.addEventListener('input', () => {
      const audio = this.getActiveCustomAudioElement();
      if (audio) audio.volume = Number(volumeInput.value);
    });

    const bindAudioEvents = (audio) => {
      if (!audio) return;
      audio.addEventListener('play', () => {
        if (this.getActiveCustomAudioElement() === audio) this.updateCustomPlayButton(true);
      });
      audio.addEventListener('pause', () => {
        if (this.getActiveCustomAudioElement() === audio) this.updateCustomPlayButton(false);
      });
      audio.addEventListener('ended', () => {
        if (this.getActiveCustomAudioElement() === audio) {
          this.updateCustomPlayButton(false);
          this.syncCustomAudioProgress();
        }
      });
      audio.addEventListener('timeupdate', () => {
        if (this.getActiveCustomAudioElement() === audio) this.syncCustomAudioProgress();
      });
      audio.addEventListener('loadedmetadata', () => {
        if (this.getActiveCustomAudioElement() === audio) this.syncCustomAudioProgress();
      });
    };

    bindAudioEvents(document.getElementById('ra-user-recording-audio'));
    bindAudioEvents(document.getElementById('ra-elevenlabs-audio'));
  }

  isQuestionPickerV7Open() {
    const sheet = document.getElementById('ra-v7-sheet');
    return !!sheet && sheet.classList.contains('is-open');
  }

  openQuestionPickerV7(tab = 'jump') {
    const sheet = document.getElementById('ra-v7-sheet');
    const backdrop = document.getElementById('ra-v7-backdrop');
    if (!sheet || !backdrop) return;

    this.v7LastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    backdrop.classList.add('is-open');
    sheet.classList.add('is-open');
    this.setQuestionPickerV7Tab(tab);

    // Ensure contents are up-to-date before focusing.
    this.refreshQuestionPickerV7UI({ rebuildJumpList: true });

    const focusTarget = tab === 'filters'
      ? sheet.querySelector('#ra-v7-panel-filters button')
      : document.getElementById('ra-v7-jump-search');

    if (focusTarget && typeof focusTarget.focus === 'function') {
      setTimeout(() => {
        try { focusTarget.focus(); } catch (_) { /* ignore */ }
      }, 0);
    } else if (typeof sheet.focus === 'function') {
      setTimeout(() => {
        try { sheet.focus(); } catch (_) { /* ignore */ }
      }, 0);
    }
  }

  closeQuestionPickerV7() {
    const sheet = document.getElementById('ra-v7-sheet');
    const backdrop = document.getElementById('ra-v7-backdrop');
    if (!sheet || !backdrop) return;
    backdrop.classList.remove('is-open');
    sheet.classList.remove('is-open');

    const restoreTarget = this.v7LastFocusedElement;
    this.v7LastFocusedElement = null;
    if (restoreTarget && document.contains(restoreTarget) && typeof restoreTarget.focus === 'function') {
      setTimeout(() => {
        try { restoreTarget.focus(); } catch (_) { /* ignore */ }
      }, 0);
    }
  }

  setQuestionPickerV7Tab(tab) {
    const normalized = tab === 'filters' ? 'filters' : 'jump';
    this.v7SheetTab = normalized;

    const tabJump = document.getElementById('ra-v7-tab-jump');
    const tabFilters = document.getElementById('ra-v7-tab-filters');
    const panelJump = document.getElementById('ra-v7-panel-jump');
    const panelFilters = document.getElementById('ra-v7-panel-filters');

    const isJump = normalized === 'jump';
    if (tabJump) tabJump.setAttribute('aria-selected', isJump ? 'true' : 'false');
    if (tabFilters) tabFilters.setAttribute('aria-selected', isJump ? 'false' : 'true');
    if (panelJump) panelJump.style.display = isJump ? '' : 'none';
    if (panelFilters) panelFilters.style.display = isJump ? 'none' : '';
  }

  handleQuestionPickerV7Keydown(event) {
    if (!event || event.key !== 'Escape') return;
    if (!this.isQuestionPickerV7Open()) return;
    event.preventDefault();
    this.closeQuestionPickerV7();
  }

  handleQuestionPickerV7JumpClick(event) {
    const list = document.getElementById('ra-v7-jump-list');
    if (!list) return;
    const target = event?.target instanceof Element ? event.target : null;
    const button = target?.closest?.('button[data-value]') || null;
    if (!button || !list.contains(button)) return;

    const value = String(button.dataset.value || '');
    const select = document.getElementById('ra-question-select');
    if (!select) return;

    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    this.closeQuestionPickerV7();
  }

  handleQuestionPickerV7FilterClick(event) {
    const panel = document.getElementById('ra-v7-panel-filters');
    if (!panel) return;
    const target = event?.target instanceof Element ? event.target : null;
    const button = target?.closest?.('button[data-filter-kind][data-filter]') || null;
    if (!button || !panel.contains(button)) return;

    const kind = String(button.dataset.filterKind || '');
    const value = String(button.dataset.filter || '');

    if (kind === 'sample-audio') {
      this.setSampleAudioFilter(value);
      return;
    }

    if (kind === 'prompt-feature') {
      this.setPromptFeatureFilter(value);
    }
  }

  getQuestionPickerV7Options() {
    const select = document.getElementById('ra-question-select');
    if (!select) return [];
    return Array.from(select.options || []).map((option) => ({
      value: String(option.value || ''),
      label: String(option.textContent || '').trim()
    }));
  }

  updateQuestionPickerV7Pill() {
    const pill = document.getElementById('ra-v7-question-pill');
    const select = document.getElementById('ra-question-select');
    if (!pill || !select) return;

    const selected = select.selectedOptions && select.selectedOptions.length
      ? select.selectedOptions[0]
      : Array.from(select.options).find((opt) => opt.value === select.value);

    const label = String(selected?.textContent || '').trim();
    pill.textContent = label || 'Select a question…';
  }

  renderQuestionPickerV7JumpList(page = null) {
    const container = document.getElementById('ra-v7-jump-list');
    const select = document.getElementById('ra-question-select');
    if (!container || !select) return;

    const query = String(this.v7JumpQuery || '').trim().toLowerCase();
    const currentValue = String(select.value || '');
    const options = this.getQuestionPickerV7Options();

    container.innerHTML = '';

    const filtered = query
      ? options.filter((opt) => opt.label.toLowerCase().includes(query))
      : options;

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.style.padding = '12px 14px';
      empty.style.color = '#6b7280';
      empty.textContent = 'No matches.';
      container.appendChild(empty);
      return;
    }

    const pageSize = 20;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

    if (page === null || page === undefined) {
      const currentIdx = filtered.findIndex((opt) => opt.value === currentValue);
      this.v7JumpPage = currentIdx >= 0 ? Math.floor(currentIdx / pageSize) + 1 : 1;
    } else {
      this.v7JumpPage = Math.max(1, Math.min(page, totalPages));
    }

    const currentPage = this.v7JumpPage;
    const pagedItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    pagedItems.forEach((opt) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ra-v7-list-item';
      button.dataset.value = opt.value;
      button.setAttribute('role', 'option');

      const isCurrent = opt.value === currentValue;
      button.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
      if (isCurrent) button.classList.add('is-current');

      const primary = document.createElement('span');
      primary.className = 'ra-v7-list-primary';
      primary.textContent = opt.label || opt.value;

      const secondary = document.createElement('span');
      secondary.className = 'ra-v7-list-secondary';
      secondary.textContent = opt.value === 'random' ? 'Random question' : `Value: ${opt.value}`;

      button.appendChild(primary);
      button.appendChild(secondary);
      container.appendChild(button);
    });

    if (totalPages > 1) {
      const pagContainer = document.createElement('div');
      pagContainer.className = 'ra-v7-pagination';

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'ra-v7-pagination-btn';
      prevBtn.disabled = currentPage <= 1;
      prevBtn.textContent = '← Prev';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renderQuestionPickerV7JumpList(currentPage - 1);
      });

      const info = document.createElement('span');
      info.className = 'ra-v7-pagination-info';
      info.textContent = `Page ${currentPage} of ${totalPages} (${filtered.length} items)`;

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'ra-v7-pagination-btn';
      nextBtn.disabled = currentPage >= totalPages;
      nextBtn.textContent = 'Next →';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renderQuestionPickerV7JumpList(currentPage + 1);
      });

      pagContainer.appendChild(prevBtn);
      pagContainer.appendChild(info);
      pagContainer.appendChild(nextBtn);
      container.appendChild(pagContainer);
    }
  }

  refreshQuestionPickerV7Filters() {
    const panel = document.getElementById('ra-v7-panel-filters');
    if (!panel) return;

    const buttons = Array.from(panel.querySelectorAll('button[data-filter-kind][data-filter]'));
    buttons.forEach((button) => {
      const kind = String(button.dataset.filterKind || '');
      const value = String(button.dataset.filter || '');

      const selected = kind === 'sample-audio'
        ? value === this.sampleAudioFilter
        : value === this.promptFeatureFilter;

      const disablePromptFilter = kind === 'prompt-feature'
        && value !== 'all'
        && !this.promptFeatureIndexReady;

      button.disabled = disablePromptFilter;
      button.setAttribute('aria-disabled', disablePromptFilter ? 'true' : 'false');
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
      button.classList.toggle('is-current', selected);
    });

    const badge = document.getElementById('ra-v7-filters-count');
    if (badge) {
      const count = (this.sampleAudioFilter !== 'all' ? 1 : 0) + (this.promptFeatureFilter !== 'all' ? 1 : 0);
      badge.textContent = String(count);
      badge.style.display = count > 0 ? '' : 'none';
    }
  }

  refreshQuestionPickerV7AudioShortcuts() {
    const playSample = document.getElementById('header-ra-play-audio-btn');
    if (playSample) {
      const hasSample = !!(this.audioManifest && this.currentQuestionId && this.audioManifest[this.currentQuestionId]);
      playSample.disabled = !hasSample;
      playSample.setAttribute('aria-disabled', hasSample ? 'false' : 'true');
    }

    const playRecording = document.getElementById('header-ra-play-recording-btn');
    if (playRecording) {
      const canPlay = !!this.userRecordingUrl
        && this.state !== 'RECORDING'
        && this.state !== 'REQUESTING_MIC'
        && this.state !== 'STOPPING_RECORDING';
      playRecording.disabled = !canPlay;
      playRecording.setAttribute('aria-disabled', canPlay ? 'false' : 'true');
    }
  }

  refreshQuestionPickerV7NavState() {
    const nextBtn = document.getElementById('ra-v7-next-btn');
    if (nextBtn) {
      const allowNext = this.state !== 'RECORDING' && this.state !== 'STOPPING_RECORDING';
      nextBtn.disabled = !allowNext;
      nextBtn.setAttribute('aria-disabled', allowNext ? 'false' : 'true');
      nextBtn.style.display = allowNext ? '' : 'none';
    }
  }

  refreshQuestionPickerV7UI(options = {}) {
    const { rebuildJumpList = false } = options;
    this.updateQuestionPickerV7Pill();
    this.refreshQuestionPickerV7Filters();
    this.refreshQuestionPickerV7AudioShortcuts();
    this.refreshQuestionPickerV7NavState();
    if (rebuildJumpList) {
      this.renderQuestionPickerV7JumpList();
    }
  }

  async onEnter() {
    if (this.isEntering || this.isActive) return;
    this.isEntering = true;
    this.isActive = true;
    this.sessionChunkingEnabled = false;
    this.sessionConnectedSpeechModes = new Set();
    this.chunkingEnabled = false;
    this.connectedSpeechLevel = 'off';
    this.connectedSpeechLayerOverrides = new Set();
    this.sessionConnectedSpeechLayerOverrides = new Set();
    this.promptFeatureFilter = 'all';
    this.activePromptRenderToken += 1;
    this.updatePromptGuideButtons();
    this.refreshFilterControls();
    this.announceLinkingStatus('Prompt guides reset.');
    this.observePromptStage();
    if (this.isPteShellEnabled()) {
      const beginnerModes = this.getSimpleTierModes();
      this.connectedSpeechModes = new Set(beginnerModes);
      this.sessionConnectedSpeechModes = new Set(beginnerModes);
    }

    // Initialize Settings sheet — moves inline controls into side panel.
    // Deferred to next frame because SPC.activate() runs AFTER onEnter() in switchToMode(),
    // so .spc-row--primary doesn't exist until after this method returns.
    requestAnimationFrame(() => {
      try { this.initSettingsSheet(); } catch (e) { console.error('[RA] Settings sheet init failed:', e); }
    });

    try {
      await this.loadManifest();
      await this.loadNextPrompt();
    } finally {
      this.isEntering = false;
    }
  }

  onExit() {
    this.activePromptRenderToken += 1;
    this.promptLifecycleToken += 1;
    this.isActive = false;
    this.chunkingEnabled = false;
    this.connectedSpeechLevel = 'off';
    this.sessionChunkingEnabled = false;
    this.sessionConnectedSpeechModes = new Set();
    this.connectedSpeechLayerOverrides = new Set();
    this.sessionConnectedSpeechLayerOverrides = new Set();
    this.promptFeatureFilter = 'all';
    this.resetPromptContext();
    this.cancelPendingHydration();
    this.disconnectPromptStageObserver();
    this.clearPromptVisualState();
    this.restorePlainTextVisibility();
    this.updatePromptGuideButtons();
    this.refreshFilterControls();
    this.cleanup();
  }

  observePromptStage() {
    const promptStage = document.getElementById('ra-prompt-stage');
    if (!promptStage || this.resizeObserver || typeof ResizeObserver === 'undefined') return;

    this.lastPromptStageWidth = Math.round(promptStage.getBoundingClientRect().width);
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.isActive || !(this.chunkingEnabled || this.hasActiveCoachGuides()) || !this.currentPromptPlainText) return;
      const newWidth = Math.round(promptStage.getBoundingClientRect().width);
      if (Number.isFinite(this.lastPromptStageWidth) && Math.abs(newWidth - this.lastPromptStageWidth) < 2) return;
      this.lastPromptStageWidth = newWidth;
      this.renderPromptForCurrentView();
      if (this.state === 'RESULTS') {
        this.renderRecognizedLinkingOverlay();
      }
    });

    this.resizeObserver.observe(promptStage);
  }

  disconnectPromptStageObserver() {
    if (!this.resizeObserver) return;
    this.resizeObserver.disconnect();
    this.resizeObserver = null;
    this.lastPromptStageWidth = null;
  }

  async loadDatabase() {
    try {
      const response = await fetch(`/database/RA/RA.xlsx?v=${Date.now()}`);
      if (!response.ok) throw new Error('Failed to fetch RA.xlsx');
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet);

      this.database = rawData.filter((row) => row.ANSWER || row['ANSWER FOR COMPARE OR TRANSCRIPT']);
      await this.loadPromptFeatureIndex();
      await this.loadFeaturedPromptIndex();
      this.hasLoadedDatabase = true;
      this.populateQuestionSelect();
    } catch (_) {
      this.resetPromptContext();
      this.setPromptText('Error loading prompts.');
      this.hasLoadedDatabase = false;
      this.promptFeatureIndexReady = false;
      this.promptFeatureIndexPromise = null;
      this.promptFeatureIndexVersion = '';
      this.promptFeatureIndexError = null;
      this.featuredPromptIndex = null;
      this.featuredPromptIndexReady = false;
      this.featuredPromptIndexPromise = null;
      this.featuredPromptIndexVersion = '';
      this.featuredPromptIndexError = null;
      this.refreshFilterControls();
    }
  }

  setSampleAudioFilter(filterType) {
    if (this.sampleAudioFilter === filterType) return;
    const preferLastPrompt = filterType === 'all';
    this.sampleAudioFilter = filterType;
    this.refreshFilterControls();
    this.refreshQuestionPickerV7UI({ rebuildJumpList: true });

    if (this.hasLoadedDatabase) {
      this.syncPromptAfterFilterChange({ preferLastPrompt });
    }
  }

  setPromptFeatureFilter(filterType) {
    const allowedFilters = new Set(['all', 'any_connected', 'linking', 'reduced_words', 'sound_changes']);
    if (!allowedFilters.has(filterType)) return;
    if (filterType !== 'all' && !this.promptFeatureIndexReady) return;
    if (this.promptFeatureFilter === filterType) return;
    const previousFilter = this.promptFeatureFilter;
    this.promptFeatureFilter = filterType;
    this.refreshFilterControls();
    this.refreshQuestionPickerV7UI({ rebuildJumpList: true });

    if (this.hasLoadedDatabase) {
      this.syncPromptAfterFilterChange({
        preferLastPrompt: filterType === 'all',
        forceReload: filterType !== 'all' && previousFilter !== filterType
      });
    }
  }

  refreshFilterControls() {
    const filterStates = [
      { id: 'ra-filter-all', active: this.sampleAudioFilter === 'all' },
      { id: 'ra-filter-available', active: this.sampleAudioFilter === 'available' },
      { id: 'ra-filter-unavailable', active: this.sampleAudioFilter === 'unavailable' },
      { id: 'ra-filter-feature-all', active: this.promptFeatureFilter === 'all' },
      { id: 'ra-filter-any-connected', active: this.promptFeatureFilter === 'any_connected', disabled: !this.promptFeatureIndexReady, label: 'Any connected speech' },
      { id: 'ra-filter-linking', active: this.promptFeatureFilter === 'linking', disabled: !this.promptFeatureIndexReady, label: 'Linking' },
      { id: 'ra-filter-reduced-words', active: this.promptFeatureFilter === 'reduced_words', disabled: !this.promptFeatureIndexReady, label: 'Reduced words' },
      { id: 'ra-filter-sound-changes', active: this.promptFeatureFilter === 'sound_changes', disabled: !this.promptFeatureIndexReady, label: 'Sound changes' }
    ];

    filterStates.forEach((state) => {
      const btn = document.getElementById(state.id);
      if (!btn) return;
      const active = !!state.active;
      const disabled = !!state.disabled;
      if (state.label) {
        btn.textContent = disabled && state.busyLabel ? state.busyLabel : state.label;
      }
      btn.disabled = disabled;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('active', active);
      // Visual states handled by .ra-filter-pill / .ra-filter-pill.active CSS classes
      btn.style.opacity = disabled ? '0.55' : '';
      btn.style.cursor = disabled ? 'not-allowed' : '';
      btn.title = disabled ? 'Prompt index unavailable.' : '';
    });

    const status = document.getElementById('ra-filter-feature-status');
    if (status) {
      if (this.promptFeatureIndexReady) {
        status.textContent = '';
      } else if (this.promptFeatureIndexPromise) {
        status.textContent = 'Loading prompt index...';
      } else {
        status.textContent = this.promptFeatureIndexError || 'Prompt index unavailable.';
      }
    }

    // Keep v7 sheet filter controls in sync even if legacy pills are hidden.
    this.refreshQuestionPickerV7Filters();
  }

  async loadPromptFeatureIndex() {
    if (this.promptFeatureIndexPromise) {
      return this.promptFeatureIndexPromise;
    }

    this.promptFeatureIndexReady = false;
    this.promptFeatureIndexError = null;
    this.refreshFilterControls();

    this.promptFeatureIndexPromise = (async () => {
      try {
        const response = await fetch(`/database/RA/connected-speech-index.json?v=${Date.now()}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch connected speech index (${response.status})`);
        }
        const index = await response.json();
        const map = new Map();
        (Array.isArray(index?.prompts) ? index.prompts : []).forEach((prompt) => {
          if (!prompt) return;
          if (prompt.rowKey) {
            map.set(String(prompt.rowKey), prompt);
          }
          if (prompt.questionId != null && String(prompt.questionId).trim()) {
            map.set(`id:${String(prompt.questionId).trim()}`, prompt);
          }
        });
        this.promptFeatureIndex = map;
        this.promptFeatureIndexVersion = String(index?.indexVersion || '');
        this.promptFeatureIndexReady = true;
        if (this.currentPromptRow) {
          this.currentPromptFeatureRecord = this.getPromptFeatureRecord(this.currentPromptRow);
        }
        if (this.isActive && this.currentPromptPlainText && this.hasActiveCoachGuides()) {
          this.renderPromptForCurrentView();
        }
        return map;
      } catch (error) {
        console.warn('RA prompt feature index unavailable:', error?.message || error);
        this.promptFeatureIndex = new Map();
        this.promptFeatureIndexVersion = '';
        this.promptFeatureIndexError = 'Prompt index unavailable.';
        this.promptFeatureIndexReady = false;
        return this.promptFeatureIndex;
      } finally {
        this.promptFeatureIndexPromise = null;
        this.refreshFilterControls();
      }
    })();

    return this.promptFeatureIndexPromise;
  }

  async loadFeaturedPromptIndex() {
    if (this.featuredPromptIndexPromise) {
      return this.featuredPromptIndexPromise;
    }

    this.featuredPromptIndexReady = false;
    this.featuredPromptIndexError = null;

    this.featuredPromptIndexPromise = (async () => {
      try {
        const response = await fetch(`/database/RA/connected-speech-featured-prompts.json?v=${Date.now()}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch featured prompt index (${response.status})`);
        }
        const index = await response.json();
        this.featuredPromptIndex = index;
        this.featuredPromptIndexVersion = String(index?.version || '');
        this.featuredPromptIndexReady = true;
        return index;
      } catch (error) {
        console.warn('RA featured prompt index unavailable:', error?.message || error);
        this.featuredPromptIndex = null;
        this.featuredPromptIndexVersion = '';
        this.featuredPromptIndexError = 'Featured prompt index unavailable.';
        this.featuredPromptIndexReady = false;
        return null;
      } finally {
        this.featuredPromptIndexPromise = null;
      }
    })();

    return this.featuredPromptIndexPromise;
  }

  getPromptFeatureRowKey(row) {
    if (!row) return '';
    const id = row.ID != null ? String(row.ID).trim() : '';
    if (id) return `id:${id}`;
    const promptText = String(row['ANSWER FOR COMPARE OR TRANSCRIPT'] || row.ANSWER || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return promptText ? `prompt:${promptText}` : '';
  }

  getPromptFeatureRecord(row) {
    const rowKey = this.getPromptFeatureRowKey(row);
    if (!rowKey || !this.promptFeatureIndex) return null;
    return this.promptFeatureIndex.get(rowKey) || null;
  }

  getPromptFeatureIdsForFilter(filterType) {
    const families = this.featuredPromptIndex?.families || {};
    const ids = Array.isArray(families[filterType]) ? families[filterType] : [];
    return ids
      .map((value) => String(value || '').trim())
      .filter(Boolean);
  }

  getFeaturedPromptPool(filteredDb) {
    if (!this.featuredPromptIndexReady || this.promptFeatureFilter === 'all') {
      return filteredDb;
    }

    const featuredIds = new Set(this.getPromptFeatureIdsForFilter(this.promptFeatureFilter));
    if (featuredIds.size === 0) {
      return filteredDb;
    }

    const curatedPool = filteredDb.filter((row) => featuredIds.has(String(row.ID != null ? row.ID : '').trim()));
    return curatedPool.length > 0 ? curatedPool : filteredDb;
  }

  matchesPromptFeatureFilter(row, filterType) {
    const record = this.getPromptFeatureRecord(row);
    if (!record) return false;
    if (filterType === 'any_connected') return !!record.hasAnyConnectedSpeech;
    if (filterType === 'linking') return !!record.hasLinking;
    if (filterType === 'reduced_words') return !!record.hasReducedWords;
    if (filterType === 'sound_changes') return !!record.hasSoundChanges;
    return true;
  }

  getFilteredDatabase() {
    if (!this.database) return [];
    let filtered = this.database;

    if (this.sampleAudioFilter !== 'all' && this.hasLoadedManifest && this.audioManifest) {
      filtered = filtered.filter((row) => {
        const hasAudio = !!this.audioManifest[String(row.ID)];
        return this.sampleAudioFilter === 'available' ? hasAudio : !hasAudio;
      });
    }

    if (this.promptFeatureFilter !== 'all') {
      if (!this.promptFeatureIndexReady) {
        return [];
      }
      filtered = filtered.filter((row) => this.matchesPromptFeatureFilter(row, this.promptFeatureFilter));
    }

    if (this.difficultyFilter !== 'all') {
      filtered = filtered.filter((row) => {
        const itemLevel = this.classifyPromptDifficulty(row);
        return String(itemLevel) === String(this.difficultyFilter);
      });
    }

    return filtered;
  }

  /**
   * 7-Factor Read Aloud Difficulty Classifier
   * Evaluates passage difficulty (Level 1: Easy, Level 2: Medium, Level 3: Hard)
   * based on the 7 core linguistic & phonetic difficulty dimensions:
   * 
   * 1. WORD FREQUENCY: Rarer words are harder to recognize and speak
   * 2. SPELLING COMPLEXITY: Low-frequency / irregular spelling patterns add difficulty
   * 3. PRONOUNCEABILITY DEMAND: Unusual word forms & complex consonant clusters add production load
   * 4. SYNTACTIC COMPLEXITY: Sentence length, embedded clauses, and parentheticals
   * 5. CONCEPTUAL DENSITY: Information density and multi-word technical units packed in short space
   * 6. CONCRETENESS VS. ABSTRACTNESS: Abstract nominalizations and non-physical concepts
   * 7. VOCABULARY FAMILIARITY: Academic, domain-specific, or specialized terminology
   */
  classifyPromptDifficulty(row) {
    if (!row) return '2';
    // 1. Explicit database column (Level, level, Difficulty, difficulty, Tier)
    const rawLevel = row.Level || row.level || row.Difficulty || row.difficulty || row.Tier || row.tier;
    if (rawLevel !== undefined && rawLevel !== null && rawLevel !== '') {
      const str = String(rawLevel).trim();
      if (str === '1' || str.toLowerCase().includes('easy') || str.toLowerCase().includes('level 1')) return '1';
      if (str === '2' || str.toLowerCase().includes('med') || str.toLowerCase().includes('level 2')) return '2';
      if (str === '3' || str.toLowerCase().includes('hard') || str.toLowerCase().includes('adv') || str.toLowerCase().includes('level 3')) return '3';
    }

    // 2. 7-Factor Classifier Calculation
    const text = String(row['ANSWER FOR COMPARE OR TRANSCRIPT'] || row.ANSWER || '').trim();
    if (!text) return '2';

    const words = text.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    if (wordCount === 0) return '2';

    const cleanWords = words.map(w => w.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean);

    // ── FACTOR 1: WORD FREQUENCY (Rarer words) ──
    const commonLongWords = new Set(['children','language','languages','electricity','building','important','different','following','business','question','government','national','research','american','computer','possible','community','together','industry','activity','students','university','education','learning','sentence','examples','example','practice','problem','farmers','waited']);
    const rareWords = cleanWords.filter(w => {
      if (commonLongWords.has(w)) return false;
      if (w.length >= 10) return true;
      if (w.length >= 8 && !/^(every|about|before|between|through|another|because|without|against|himself|herself|someone|nothing|already|always|around)/.test(w)) return true;
      return /(?:esen|quis|heur|conun|phora|archaeo|ephem|ubiq|juven|senesc)/.test(w);
    });
    const wordFrequencyScore = rareWords.length / Math.max(1, wordCount);

    // ── FACTOR 2: SPELLING COMPLEXITY (Low-frequency spelling patterns) ──
    const irregularSpellingRegex = /(?:ieu|eau|ough|eigh|aigh|ae|oe|eui|sch|ph|rh|rrh|gn|kn|wr|ps|pt|mn|mb|bt|tch|dg)/i;
    const spellingComplexWords = cleanWords.filter(w => irregularSpellingRegex.test(w));
    const spellingComplexityScore = spellingComplexWords.length / Math.max(1, wordCount);

    // ── FACTOR 3: PRONOUNCEABILITY DEMAND (Consonant clusters & phonological load) ──
    const clusterRegex = /[bcdfghjklmnpqrstvwxyz]{3,}/i;
    const difficultClustersRegex = /(?:spl|str|scr|rth|lth|mph|nth|rch|spt|chth|rch|lsh)/i;
    const pronounceableWords = words.filter(w => {
      const clean = w.toLowerCase().replace(/[^a-z]/g, '');
      return clusterRegex.test(clean) || difficultClustersRegex.test(clean) || (clean.length >= 10 && this.countWordSyllables(clean) >= 4);
    });
    const pronounceabilityScore = pronounceableWords.length / Math.max(1, wordCount);

    // ── FACTOR 4: SYNTACTIC COMPLEXITY (Sentence length & clause structure) ──
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgSentenceLength = wordCount / Math.max(1, sentences.length);
    const clauseMarkers = (text.match(/;|:|--|—|, which|, that|, who|, whom|, whose|whereas|although|nevertheless|consequently|subsequently|furthermore|notwithstanding|until that point|provided that/gi) || []).length;
    let syntacticScore = 0;
    if (avgSentenceLength >= 22 || clauseMarkers >= 3) syntacticScore = 3;
    else if (avgSentenceLength >= 15 || clauseMarkers >= 1) syntacticScore = 2;
    else syntacticScore = 1;

    // ── FACTOR 5: CONCEPTUAL DENSITY (Information density & technical units) ──
    const stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','it','its','this','that','these','those','i','you','he','she','we','they']);
    const contentWords = cleanWords.filter(w => !stopWords.has(w) && w.length > 2);
    const contentDensity = contentWords.length / Math.max(1, wordCount);
    let conceptualScore = 0;
    if (contentDensity > 0.65 || (wordCount > 55 && contentDensity > 0.60)) conceptualScore = 3;
    else if (contentDensity >= 0.52) conceptualScore = 2;
    else conceptualScore = 1;

    // ── FACTOR 6: CONCRETENESS VS. ABSTRACTNESS (Abstract nominalizations & concepts) ──
    const abstractSuffixRegex = /(?:tion|sion|ment|ness|ity|ism|ance|ence|ship|ization|isation|ology)$/i;
    const abstractWords = cleanWords.filter(w => abstractSuffixRegex.test(w) || /^(notion|sovereignty|globalisation|globalization|phenomenon|paradigm|framework|ideology|ethos|hypothesis|philosophy|era)$/i.test(w));
    const abstractRatio = abstractWords.length / Math.max(1, wordCount);

    // ── FACTOR 7: VOCABULARY FAMILIARITY (Academic & domain-specific jargon) ──
    const academicWords = cleanWords.filter(w => {
      if (commonLongWords.has(w)) return false;
      return (w.length >= 8 && this.countWordSyllables(w) >= 3) || /^(photovoltaic|electromagnetic|photoelectric|monocrystalline|silicon|radiation|inflationary|aggregate|sluggish|jurisprudence|archaeological|hegemony|demographic)/i.test(w);
    });
    const familiarityScore = academicWords.length / Math.max(1, wordCount);

    // ── WEIGHTED COMPOSITE SCORING ──
    let totalPoints = 0;

    // Factor 1: Word Frequency
    if (wordFrequencyScore >= 0.18) totalPoints += 3.0;
    else if (wordFrequencyScore >= 0.10) totalPoints += 2.0;
    else totalPoints += 1.0;

    // Factor 2: Spelling Complexity
    if (spellingComplexityScore >= 0.15) totalPoints += 3.0;
    else if (spellingComplexityScore >= 0.08) totalPoints += 2.0;
    else totalPoints += 1.0;

    // Factor 3: Pronounceability Demand
    if (pronounceabilityScore >= 0.16) totalPoints += 3.0;
    else if (pronounceabilityScore >= 0.08) totalPoints += 2.0;
    else totalPoints += 1.0;

    // Factor 4: Syntactic Complexity
    totalPoints += syntacticScore;

    // Factor 5: Conceptual Density
    totalPoints += conceptualScore;

    // Factor 6: Concreteness vs. Abstractness
    if (abstractRatio >= 0.14) totalPoints += 3.0;
    else if (abstractRatio >= 0.07) totalPoints += 2.0;
    else totalPoints += 1.0;

    // Factor 7: Vocabulary Familiarity
    if (familiarityScore >= 0.18) totalPoints += 3.0;
    else if (familiarityScore >= 0.10) totalPoints += 2.0;
    else totalPoints += 1.0;

    // Factor Spike Boost: If any individual factor is extremely high (Level 3 intensity),
    // ensure single-sentence passages with high difficulty on that factor trigger Level 3.
    let spikeCount = 0;
    if (wordFrequencyScore >= 0.18) spikeCount++;
    if (spellingComplexityScore >= 0.15) spikeCount++;
    if (pronounceabilityScore >= 0.16) spikeCount++;
    if (syntacticScore >= 3) spikeCount++;
    if (conceptualScore >= 3) spikeCount++;
    if (abstractRatio >= 0.14) spikeCount++;
    if (familiarityScore >= 0.18) spikeCount++;

    if (spikeCount >= 2) totalPoints += 2.0;
    else if (spikeCount >= 1) totalPoints += 1.0;

    // Final Level Mapping (Scale: 7.0 to 23.0)
    if (totalPoints >= 15.0) return '3';
    if (totalPoints >= 10.5) return '2';
    return '1';
  }

  countWordSyllables(word) {
    const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    const matches = w.replace(/(?:[^laeiouy]es|ed|e)$/i, '').match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  getPreferredFilteredPromptRow(filteredDb = this.getFilteredDatabase(), options = {}) {
    const { preferLastPrompt = false } = options;
    if (!Array.isArray(filteredDb) || filteredDb.length === 0) {
      return null;
    }

    const candidates = preferLastPrompt
      ? [this.lastPromptRow, this.currentPromptRow]
      : [this.currentPromptRow, this.lastPromptRow];
    return candidates.find((row) => row && filteredDb.includes(row)) || null;
  }

  syncQuestionSelectValue(row = this.currentPromptRow) {
    const select = document.getElementById('ra-question-select');
    if (!select) return;

    if (!row || !Array.isArray(this.database)) {
      select.value = 'random';
      window.SpeakingPracticeController?.sync?.('read-aloud');
      return;
    }

    const originalIndex = this.database.indexOf(row);
    if (originalIndex < 0) {
      select.value = 'random';
      window.SpeakingPracticeController?.sync?.('read-aloud');
      return;
    }

    const optionValue = String(originalIndex);
    const hasOption = Array.from(select.options).some((option) => option.value === optionValue);
    select.value = hasOption ? optionValue : 'random';

    this.refreshQuestionPickerV7UI({ rebuildJumpList: this.isQuestionPickerV7Open() });
    // The shared controller may mount before the async RA database finishes
    // loading. Keep its pill and picker sheet synchronized with this silent
    // state update (the native select remains the source of truth).
    window.SpeakingPracticeController?.sync?.('read-aloud');
  }

  populateQuestionSelect(selectedRow = this.currentPromptRow) {
    const select = document.getElementById('ra-question-select');
    const filteredDb = this.getFilteredDatabase();
    if (!select) return;

    if (!filteredDb || filteredDb.length === 0) {
      select.innerHTML = '<option value="random">No questions match the current filters.</option>';
      select.disabled = true;
      select.style.display = 'block';
      return;
    }

    select.disabled = false;
    select.innerHTML = '<option value="random">🔀 Random Question</option>';
    filteredDb.forEach((row) => {
      const originalIndex = this.database.indexOf(row);
      const option = document.createElement('option');
      option.value = String(originalIndex);
      const text = row['ANSWER FOR COMPARE OR TRANSCRIPT'] || row.ANSWER || 'No text';
      let excerpt = text.substring(0, 35).replace(/\n/g, ' ');
      if (text.length > 35) excerpt += '...';
      const hasAudio = this.hasLoadedManifest && this.audioManifest && this.audioManifest[String(row.ID)];
      const prefix = hasAudio ? '🎵 ' : '';
      option.textContent = `Q${originalIndex + 1}: ${prefix}${excerpt}`;
      select.appendChild(option);
    });

    select.style.display = 'block';
    this.syncQuestionSelectValue(selectedRow);
    this.refreshQuestionPickerV7UI({ rebuildJumpList: true });
  }

  syncPromptAfterFilterChange(options = {}) {
    const { preferLastPrompt = false, forceReload = false } = options;
    if (!this.hasLoadedDatabase) {
      return;
    }

    const filteredDb = this.getFilteredDatabase();
    const preferredRow = forceReload
      ? null
      : this.getPreferredFilteredPromptRow(filteredDb, { preferLastPrompt });
    this.populateQuestionSelect(preferredRow);

    if (filteredDb.length === 0) {
      this.finishPromptLoadWithoutPrompt('No questions match the current filters.');
      return;
    }

    if (preferredRow) {
      if (this.currentPromptRow === preferredRow && this.currentPromptReady) {
        this.currentPromptFeatureRecord = this.getPromptFeatureRecord(preferredRow);
        this.syncQuestionSelectValue(preferredRow);
        return;
      }

      const promptLoadToken = this.beginPromptLoad();
      if (!this.shouldApplyPromptLoad(promptLoadToken)) {
        return;
      }
      this.applyPromptRow(preferredRow, promptLoadToken);
      return;
    }

    const recoveringPreviousPrompt = preferLastPrompt && !this.currentPromptRow && !!this.lastPromptRow;
    this.loadNextPrompt({ rememberPrompt: !recoveringPreviousPrompt });
  }

  loadPromptOrderMode() {
    try {
      const stored = localStorage.getItem('ra-prompt-order-mode');
      return stored === 'sequential' ? 'sequential' : 'random';
    } catch (_) {
      return 'random';
    }
  }

  setPromptOrderMode(mode) {
    const normalized = mode === 'sequential' ? 'sequential' : 'random';
    if (this.promptOrderMode === normalized) return;
    this.promptOrderMode = normalized;
    try { localStorage.setItem('ra-prompt-order-mode', normalized); } catch (_) { /* ignore */ }
    this.announceLinkingStatus(normalized === 'sequential'
      ? 'Questions now follow database order.'
      : 'Questions are now picked at random.');
    window.SpeakingPracticeController?.sync?.('read-aloud');
  }

  /**
   * The pool the prev/next buttons walk in sequential mode. Uses the same
   * filtered/featured pool as random mode so navigation always respects the
   * active Practice Target and Difficulty filters.
   */
  getOrderedPromptPool() {
    const filtered = this.getFilteredDatabase();
    if (!filtered.length) return [];
    return this.getFeaturedPromptPool(filtered);
  }

  getCurrentPoolIndex(pool, anchorRow = this.currentPromptRow) {
    if (!anchorRow || !Array.isArray(pool) || !pool.length) return -1;
    const direct = pool.indexOf(anchorRow);
    if (direct !== -1) return direct;
    // The featured pool can hold cloned rows; fall back to matching on ID.
    const currentId = anchorRow.ID != null ? String(anchorRow.ID) : null;
    if (!currentId) return -1;
    return pool.findIndex((row) => String(row?.ID) === currentId);
  }

  /**
   * Step one place through the ordered pool. `direction` is +1 or -1.
   *
   * `anchorRow` must be captured before beginPromptLoad() runs — that call
   * clears currentPromptRow, which would otherwise restart from index 0 on
   * every press.
   */
  stepThroughOrderedPool(direction, promptLoadToken = null, anchorRow = this.currentPromptRow) {
    const pool = this.getOrderedPromptPool();
    if (!pool.length) {
      this.finishPromptLoadWithoutPrompt('No questions match the current filters.');
      return;
    }
    const currentIndex = this.getCurrentPoolIndex(pool, anchorRow);
    const nextIndex = currentIndex === -1
      ? (direction > 0 ? 0 : pool.length - 1)
      : (currentIndex + direction + pool.length) % pool.length;
    this.applyPromptRow(pool[nextIndex], promptLoadToken ?? this.beginPromptLoad());
  }

  loadPreviousPrompt() {
    if (this.promptOrderMode === 'sequential' && this.hasLoadedDatabase) {
      const anchorRow = this.currentPromptRow || this.lastPromptRow;
      this.stepThroughOrderedPool(-1, null, anchorRow);
      return;
    }
    if (this.lastPromptRow) {
      this.applyPromptRow(this.lastPromptRow, this.beginPromptLoad(), { rememberPrompt: false });
    } else {
      this.loadNextPrompt();
    }
  }

  async loadNextPrompt(options = {}) {
    const { rememberPrompt = true } = options;
    // Captured before beginPromptLoad() clears it — sequential mode needs to
    // know where it currently is.
    const anchorRow = this.currentPromptRow || this.lastPromptRow;
    const promptLoadToken = this.beginPromptLoad({ selectRandom: true });

    if (!this.hasLoadedDatabase) {
      await this.loadDatabase();
    }
    if (!this.shouldApplyPromptLoad(promptLoadToken)) {
      return;
    }

    if (!this.database || this.database.length === 0) {
      this.finishPromptLoadWithoutPrompt('Database empty or failed to load.');
      return;
    }

    const filteredDb = this.getFilteredDatabase();
    if (filteredDb.length === 0) {
      this.finishPromptLoadWithoutPrompt('No questions match the current filters.');
      return;
    }

    if (this.promptOrderMode === 'sequential') {
      this.stepThroughOrderedPool(1, promptLoadToken, anchorRow);
      return;
    }

    const candidatePool = this.getFeaturedPromptPool(filteredDb);
    let randomRow;
    if (this.sampleAudioFilter === 'all' && this.audioManifest && Object.keys(this.audioManifest).length > 0 && (!this.firstLoadDone || Math.random() < 0.2)) {
      const audioIds = Object.keys(this.audioManifest);
      const randomId = audioIds[Math.floor(Math.random() * audioIds.length)];
      randomRow = candidatePool.find((row) => String(row.ID) === randomId) || candidatePool[Math.floor(Math.random() * candidatePool.length)];
      this.firstLoadDone = true;
    } else {
      randomRow = candidatePool[Math.floor(Math.random() * candidatePool.length)];
      this.firstLoadDone = true;
    }

    this.applyPromptRow(randomRow, promptLoadToken, { rememberPrompt });
  }

  async loadSpecificPrompt(index) {
    const promptLoadToken = this.beginPromptLoad();

    if (!this.hasLoadedDatabase) {
      await this.loadDatabase();
    }
    if (!this.shouldApplyPromptLoad(promptLoadToken)) {
      return;
    }

    if (!this.database || this.database.length === 0) {
      this.finishPromptLoadWithoutPrompt('Database empty or failed to load.');
      return;
    }

    const row = this.database[index];
    if (!row) {
      this.finishPromptLoadWithoutPrompt('Prompt unavailable.');
      return;
    }
    this.applyPromptRow(row, promptLoadToken);
  }

  applyPromptRow(row, promptLoadToken = this.promptLifecycleToken, options = {}) {
    const { rememberPrompt = true } = options;
    if (!this.shouldApplyPromptLoad(promptLoadToken)) {
      return;
    }
    const prompt = row['ANSWER FOR COMPARE OR TRANSCRIPT'] || row.ANSWER || 'No text available';
    const chunkedPrompt = row['ANSWER CHUNKED'] || '';
    this.promptLifecycleToken += 1;
    this.currentQuestionId = row.ID != null ? String(row.ID) : null;
    this.currentPromptPlainText = prompt;
    this.currentPromptChunkedText = chunkedPrompt;
    this.currentPromptFeatureRecord = this.getPromptFeatureRecord(row);
    this.currentPromptRow = row;
    if (rememberPrompt) {
      this.lastPromptRow = row;
    }
    this.activePromptKey = this.getPromptKey(prompt);
    this.activePromptRenderToken += 1;
    this.chunkingEnabled = this.sessionChunkingEnabled;
    // Carry the whole guide selection across prompts, not just the dominant one.
    this.connectedSpeechModes = new Set(this.sessionConnectedSpeechModes || []);

    const inputWordCount = parseInt(row['Word count'], 10);
    const actualWordCount = Number.isNaN(inputWordCount)
      ? prompt.split(/\s+/).filter(Boolean).length
      : inputWordCount;

    this.prepSeconds = actualWordCount >= 60 ? 40 : Math.max(30, Math.min(35, Math.round(actualWordCount / 1.5)));
    this.recordSeconds = Math.min(this.prepSeconds, 40);

    this.setPromptText(prompt, chunkedPrompt);
    this.updateAudioPlayerVisibility();
    this.updatePromptGuideButtons();
    this.syncQuestionSelectValue(row);
    this.renderPromptForCurrentView();
    this.updateUIForState();

    // Update URL with current question ID (replaceState — no history entry per question)
    if (window.PracticeRouter && this.currentQuestionId) {
      window.PracticeRouter.replaceRoute('read-aloud', this.currentQuestionId);
    }

    if (window.PTEAttemptArchive && typeof window.PTEAttemptArchive.updateHistoryUI === 'function') {
      window.PTEAttemptArchive.updateHistoryUI('read-aloud', this.currentQuestionId);
    }

    if (this.getRecordingSupportState().supported) {
      this.startPrepTimer();
    } else {
      this.applyUnsupportedState();
    }
    this.currentPromptReady = true;
  }

  getPromptKey(promptText = this.currentPromptPlainText) {
    if (this.currentQuestionId) {
      return `question:${this.currentQuestionId}`;
    }
    return `prompt:${String(promptText || '').trim().toLowerCase()}`;
  }

  setPromptText(text, chunkedText = this.currentPromptChunkedText) {
    const textNode = document.getElementById('ra-text-prompt');
    const accessibleNode = document.getElementById('ra-prompt-plain');
    const grammar = window.ReadAloudPromptGrammar;
    const renderer = window.ReadAloudPromptRenderer;
    if (!textNode || !accessibleNode) return;

    if (!grammar || !renderer?.renderPrompt) {
      textNode.textContent = text;
      accessibleNode.textContent = text;
      this.currentPromptRenderState = {
        wordMap: new Map(),
        blockedBoundarySet: new Set(),
        chunkingAvailable: false,
        renderDiagnostics: { reason: 'renderer_unavailable' }
      };
      return;
    }

    this.currentPromptRenderState = renderer.renderPrompt({
      visibleContainer: textNode,
      accessibleContainer: accessibleNode,
      plainText: text,
      chunkedText,
      chunkingEnabled: this.chunkingEnabled,
      grammar
    });
  }

  clearPromptVisualState() {
    const overlay = document.getElementById('ra-linking-overlay');
    const badgeLayer = document.getElementById('ra-connected-speech-badges');
    const fallbackList = document.getElementById('ra-linking-fallback-list');
    const summary = document.getElementById('ra-linking-a11y-summary');
    this.selectedGuideItemId = null;
    this.hideSoundChangeTooltip();
    this.guideExplanationsExpanded = null;
    this.guideExplanationsToggled = false;

    const textNode = document.getElementById('ra-text-prompt');
    if (textNode) {
      textNode.innerHTML = '';
    }
    if (overlay) overlay.style.display = 'none';
    if (badgeLayer) {
      badgeLayer.innerHTML = '';
      badgeLayer.style.display = 'none';
    }
    if (fallbackList) {
      fallbackList.innerHTML = '';
      fallbackList.style.display = 'none';
      fallbackList.style.flexWrap = 'wrap';
    }
    if (summary) summary.textContent = '';
  }

  restorePlainTextVisibility() {
    const textNode = document.getElementById('ra-text-prompt');
    if (!textNode) return;
    textNode.style.display = '';
    textNode.style.position = 'relative';
    textNode.style.width = '';
    textNode.style.height = '';
    textNode.style.overflow = '';
    textNode.style.clip = '';
    textNode.style.whiteSpace = '';
  }

  cancelPendingHydration() {
    if (this.pendingLinkingFrame) {
      cancelAnimationFrame(this.pendingLinkingFrame);
      this.pendingLinkingFrame = null;
    }
    if (this.pendingLinkingRetry) {
      clearTimeout(this.pendingLinkingRetry);
      this.pendingLinkingRetry = null;
    }
  }

  invalidatePromptRenderState() {
    this.activePromptRenderToken += 1;
    this.cancelPendingHydration();
  }

  scheduleHydrationRetry(promptKey = this.activePromptKey, renderToken = this.activePromptRenderToken, delayMs = 120, attempt = 1) {
    if (this.pendingLinkingRetry) {
      clearTimeout(this.pendingLinkingRetry);
    }
    this.pendingLinkingRetry = setTimeout(() => {
      this.pendingLinkingRetry = null;
      if (!this.shouldApplyPromptRender(promptKey, renderToken) || !this.hasActiveCoachGuides()) {
        return;
      }
      this.hydrateLinkingView(promptKey, renderToken, attempt);
    }, delayMs);
  }

  clearPromptIdentityState() {
    this.currentQuestionId = null;
    this.currentPromptPlainText = '';
    this.currentPromptChunkedText = '';
    this.currentPromptRenderState = null;
    this.currentPromptFeatureRecord = null;
    this.currentPromptRow = null;
    this.activePromptKey = null;
  }

  resetPromptContext() {
    this.invalidatePromptRenderState();
    this.clearPromptIdentityState();
    this.currentPromptReady = false;
  }

  beginPromptLoad(options = {}) {
    const { selectRandom = false } = options;
    this.promptLifecycleToken += 1;
    const promptLoadToken = this.promptLifecycleToken;
    this.cleanup();
    this.resetPromptContext();
    this.state = 'PREP';
    this.currentTranscript = '';
    this.clearPromptVisualState();
    this.clearConnectedSpeechResults();
    this.resetAssessmentDisplay();
    this.restorePlainTextVisibility();
    const select = document.getElementById('ra-question-select');
    if (selectRandom && select) select.value = 'random';
    this.setPromptText('Loading...');
    return promptLoadToken;
  }

  finishPromptLoadWithoutPrompt(message) {
    this.resetPromptContext();
    this.setPromptText(message);
    this.currentPromptReady = true;
  }

  handlePromptGuideKeydown(event, guide) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.togglePromptGuide(guide);
  }

  togglePromptGuide(guide, options = {}) {
    if (guide !== 'chunking' && guide !== 'linking') return;
    const { announce = true, persist = true } = options;
    const chunkingAvailable = !!this.currentPromptChunkedText && this.currentPromptRenderState?.chunkingAvailable !== false;
    if (guide === 'chunking' && !chunkingAvailable) {
      const chunkBtn = document.getElementById('ra-toggle-chunking-btn');
      if (chunkBtn) chunkBtn.disabled = true;
      if (announce) {
        this.announceLinkingStatus('Chunking unavailable for this prompt.');
      }
      this.updatePromptGuideButtons();
      return;
    }

    if (guide === 'chunking') {
      this.chunkingEnabled = !this.chunkingEnabled;
    } else {
      this.toggleConnectedSpeechLevel('linking', { announce, persist });
      return;
    }

    if (persist) {
      this.sessionChunkingEnabled = this.chunkingEnabled;
    }
    this.updatePromptGuideButtons();
    if (announce) {
      if (guide === 'chunking') {
        this.announceLinkingStatus(this.chunkingEnabled ? 'Chunking enabled.' : 'Chunking disabled.');
      } else {
        this.announceLinkingStatus(this.isConnectedSpeechEnabled() ? 'Connected speech enabled.' : 'Connected speech disabled.');
      }
    }
    this.renderPromptForCurrentView();
  }

  togglePracticeTargetDrawer(forceOpen = null) {
    // Redirects to Settings sheet if available
    if (this.settingsSheet) {
      this.openSettingsSheet('practice-target');
      return;
    }
    const toggle = document.getElementById('ra-practice-target-toggle');
    const drawer = document.getElementById('ra-practice-target-drawer');
    if (!toggle || !drawer) return;
    const shouldOpen = typeof forceOpen === 'boolean'
      ? forceOpen
      : drawer.hasAttribute('hidden');
    if (shouldOpen) {
      drawer.removeAttribute('hidden');
      toggle.setAttribute('aria-expanded', 'true');
    } else {
      drawer.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', 'false');
    }
    this.practiceTargetDrawerOpen = shouldOpen;
  }

  /** Create the Settings sheet using SPC's createSheet infrastructure */
  initSettingsSheet() {
    if (this.isPteShellEnabled()) return;
    if (this.settingsSheet) return;
    if (!window.SpeakingPracticeController?.createSheet) {
      console.warn('[RA] SPC.createSheet not ready — retrying initSettingsSheet');
      setTimeout(() => this.initSettingsSheet(), 150);
      return;
    }

    try {
      this.settingsSheet = window.SpeakingPracticeController.createSheet({
        id: 'ra-settings-sheet',
        title: 'Settings',
        className: 'ra-settings-sheet spc-mode-settings-sheet'
      });
    } catch (e) {
      console.error('[RA] Failed to create Settings sheet:', e);
      return;
    }



    const body = this.settingsSheet.body;

    // Build tabbed navigation
    const tabs = document.createElement('div');
    tabs.className = 'spc-sheet-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = `
      <button class="spc-sheet-tab active" role="tab" aria-selected="true" data-tab="practice-target" type="button">🎯 Practice Target</button>
      <button class="spc-sheet-tab" role="tab" aria-selected="false" data-tab="listen" type="button">🔊 Listen</button>
      <button class="spc-sheet-tab" role="tab" aria-selected="false" data-tab="history" type="button">📋 History</button>
    `;
    body.appendChild(tabs);

    // Tab panels container
    const panelsContainer = document.createElement('div');
    panelsContainer.className = 'ra-settings-panels';

    // Panel 1: Practice Target
    const targetPanel = document.createElement('div');
    targetPanel.className = 'spc-sheet-tab-panel active';
    targetPanel.dataset.tab = 'practice-target';
    targetPanel.setAttribute('role', 'tabpanel');

    // Move existing filter elements into this panel (move, not clone, to avoid duplicate IDs)
    const practiceTargetDrawer = document.getElementById('ra-practice-target-drawer');
    if (practiceTargetDrawer) {
      const filters = practiceTargetDrawer.querySelectorAll('.read-aloud-filters');
      const statusEl = document.getElementById('ra-filter-feature-status');
      filters.forEach(f => targetPanel.appendChild(f));
      // The status line lives inside its filter group; only relocate it if it
      // was left behind in the drawer.
      if (statusEl && !targetPanel.contains(statusEl)) targetPanel.appendChild(statusEl);
      // Hide the now-empty drawer
      practiceTargetDrawer.setAttribute('hidden', '');
    }

    // Difficulty / Word Length filter section
    const diffSection = document.createElement('div');
    diffSection.className = 'read-aloud-filters';
    diffSection.innerHTML = `
      <span class="read-aloud-filter-label">📊 Difficulty Level:</span>
      <div class="read-aloud-filter-buttons" role="group" aria-label="Difficulty filter">
        <button id="ra-diff-all" class="read-aloud-filter-btn active" type="button" data-diff="all">Recommended</button>
        <button id="ra-diff-1" class="read-aloud-filter-btn" type="button" data-diff="1">🟢 Level 1 (Easy)</button>
        <button id="ra-diff-2" class="read-aloud-filter-btn" type="button" data-diff="2">🟡 Level 2 (Medium)</button>
        <button id="ra-diff-3" class="read-aloud-filter-btn" type="button" data-diff="3">🔴 Level 3 (Hard)</button>
      </div>
    `;
    targetPanel.appendChild(diffSection);

    diffSection.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-diff]');
      if (!btn) return;
      const diff = btn.dataset.diff;
      this.setDifficultyFilter(diff);
      diffSection.querySelectorAll('.read-aloud-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.diff === diff);
      });
    });
    panelsContainer.appendChild(targetPanel);

    // Panel 2: Listen / TTS
    const listenPanel = document.createElement('div');
    listenPanel.className = 'spc-sheet-tab-panel';
    listenPanel.dataset.tab = 'listen';
    listenPanel.setAttribute('role', 'tabpanel');

    // Move the audio player content into this panel
    const audioPlayer = document.getElementById('ra-audio-player');
    if (audioPlayer) {
      listenPanel.appendChild(audioPlayer);
      audioPlayer.style.display = '';
      audioPlayer.style.marginBottom = '0';
    }
    panelsContainer.appendChild(listenPanel);

    // Panel 3: History
    const historyPanel = document.createElement('div');
    historyPanel.className = 'spc-sheet-tab-panel';
    historyPanel.dataset.tab = 'history';
    historyPanel.setAttribute('role', 'tabpanel');

    // Move history hosts into this panel
    const historyActionHost = document.getElementById('ra-history-action-host');
    const historyContentHost = document.getElementById('ra-history-content-host');
    if (historyActionHost) historyPanel.appendChild(historyActionHost);
    if (historyContentHost) historyPanel.appendChild(historyContentHost);
    panelsContainer.appendChild(historyPanel);

    body.appendChild(panelsContainer);

    // Wire tab switching
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.spc-sheet-tab');
      if (!tab) return;
      const tabId = tab.dataset.tab;

      // Update tab states
      tabs.querySelectorAll('.spc-sheet-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      // Update panel visibility
      panelsContainer.querySelectorAll('.spc-sheet-tab-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.tab === tabId);
      });
    });

    /* eslint-disable-next-line no-console */
    console.log('[RA] Settings sheet initialized with', {
      filters: !!practiceTargetDrawer,
      audio: !!audioPlayer,
      history: !!(historyActionHost || historyContentHost)
    });
  }

  /** Open the Settings sheet, optionally switching to a specific tab */
  openSettingsSheet(tabId = null) {
    if (!this.settingsSheet) {
      this.initSettingsSheet();
    }
    if (!this.settingsSheet) return;

    if (tabId) {
      const tabs = this.settingsSheet.body.querySelector('.spc-sheet-tabs');
      const panels = this.settingsSheet.body.querySelector('.ra-settings-panels');
      if (tabs && panels) {
        tabs.querySelectorAll('.spc-sheet-tab').forEach(t => {
          const isTarget = t.dataset.tab === tabId;
          t.classList.toggle('active', isTarget);
          t.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        });
        panels.querySelectorAll('.spc-sheet-tab-panel').forEach(p => {
          p.classList.toggle('active', p.dataset.tab === tabId);
        });
      }
    }

    this.settingsSheet.open();
  }

  /** Close the Settings sheet */
  closeSettingsSheet() {
    /* eslint-disable-next-line no-console */
    console.log('[RA] closeSettingsSheet execution fired!');
    if (this.settingsSheet && typeof this.settingsSheet.close === 'function') {
      this.settingsSheet.close();
    }
    const sheetEl = document.getElementById('ra-settings-sheet');
    if (sheetEl) {
      sheetEl.classList.remove('is-active');
      /* eslint-disable-next-line no-console */
      console.log('[RA] sheetEl is-active removed:', !sheetEl.classList.contains('is-active'));
    }
    const backdrop = document.querySelector('.spc-sheet-backdrop[data-spc-sheet-id="ra-settings-sheet"]');
    if (backdrop) backdrop.classList.remove('is-active');
  }

  updatePromptGuideButtons() {
    const chunkBtn = document.getElementById('ra-toggle-chunking-btn');
    const linkingBtn = document.getElementById('ra-toggle-linking-btn');
    const reducedWordsBtn = document.getElementById('ra-toggle-reduced-words-btn');
    const soundChangesBtn = document.getElementById('ra-toggle-sound-changes-btn');
    const chunkAvailable = !!this.currentPromptChunkedText && this.currentPromptRenderState?.chunkingAvailable !== false;

    // Active colour comes from the chip's own .ra-guide-chip--* class in
    // style.css, keyed off aria-pressed. It used to be painted here on every
    // render, which put the guide palette out of reach of every stylesheet.
    [
      [chunkBtn, this.chunkingEnabled, chunkAvailable],
      [linkingBtn, this.isConnectedSpeechModeActive('linking'), true],
      [reducedWordsBtn, this.isConnectedSpeechModeActive('reduced_words'), true],
      [soundChangesBtn, this.isConnectedSpeechModeActive('sound_changes'), true]
    ].forEach(([button, active, available]) => {
      if (!button) return;
      const displayActive = available ? active : false;
      button.setAttribute('aria-pressed', displayActive ? 'true' : 'false');
      if (button.getAttribute('role') === 'radio') {
        button.setAttribute('aria-checked', displayActive ? 'true' : 'false');
      }
      button.disabled = !available;
      if (button === chunkBtn) {
        button.title = available ? 'Show semantic chunking markers.' : 'Chunking unavailable for this prompt.';
      } else if (button === linkingBtn) {
        button.title = 'Show connected speech linking hints.';
      } else if (button === soundChangesBtn) {
        button.title = 'Show connected speech sound change hints.';
      } else {
        button.title = 'Show connected speech reduced words.';
      }
    });

    // Legend keys follow the guides that are actually drawing marks, which in the
    // simple tier is the fixed beginner set rather than the chip selection.
    const legendModes = new Set(this.getActiveConnectedSpeechModes());
    document.querySelectorAll('#ra-guide-legend .ra-legend-item').forEach((item) => {
      item.hidden = !legendModes.has(item.getAttribute('data-legend'));
    });

    const viewMode = this.getEffectiveViewMode();
    const instructionEl = document.getElementById('ra-guide-instruction') || document.getElementById('ra-prompt-instruction-text');
    if (instructionEl) {
      if (viewMode === 'basic') {
        instructionEl.textContent = this.getBasicPhaseInstruction();
      } else {
        const activeGuides = [];
        if (this.chunkingEnabled && chunkAvailable) activeGuides.push('chunking');
        if (this.isConnectedSpeechModeActive('linking')) activeGuides.push('linking');
        if (this.isConnectedSpeechModeActive('reduced_words')) activeGuides.push('reduced_words');
        if (this.isConnectedSpeechModeActive('sound_changes')) activeGuides.push('sound_changes');

        if (activeGuides.length === 0) {
          instructionEl.textContent = 'Read the sentence aloud. Turn on a guide above to see where words join, which to say lightly, and where sounds blend.';
        } else if (activeGuides.length === 1) {
          const mode = activeGuides[0];
          if (mode === 'chunking') {
            instructionEl.textContent = 'Read the sentence aloud, pausing where the marks break it into groups.';
          } else if (mode === 'linking') {
            instructionEl.textContent = 'Read the sentence aloud. Where words are joined by a curve, run them together without a pause.';
          } else if (mode === 'reduced_words') {
            instructionEl.textContent = 'Read the sentence aloud. Say the marked words lightly and quickly — do not stress them.';
          } else if (mode === 'sound_changes') {
            instructionEl.textContent = 'Read the sentence aloud. Where words are badged, let the two sounds blend into one.';
          }
        } else {
          // Was "Active guides: X + Y." — a readout of state, which never told the
          // learner what to do. Lead with the action; name the guides after it.
          const labels = activeGuides.map(m => {
            if (m === 'chunking') return 'pause groups';
            if (m === 'linking') return 'joins';
            if (m === 'reduced_words') return 'light words';
            return 'sound changes';
          });
          const tail = labels.length > 1
            ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
            : labels[0];
          instructionEl.textContent = `Read the sentence aloud, following the marks for ${tail}.`;
        }
      }
    }
  }

  announceLinkingStatus(message) {
    const statusNode = document.getElementById('ra-linking-status');
    if (statusNode) {
      statusNode.textContent = message;
    }
  }

  renderPromptForCurrentView() {
    const overlay = document.getElementById('ra-linking-overlay');
    const badgeLayer = document.getElementById('ra-connected-speech-badges');
    const fallbackList = document.getElementById('ra-linking-fallback-list');
    const summary = document.getElementById('ra-linking-a11y-summary');
    const promptStage = document.getElementById('ra-prompt-stage');

    if (!promptStage || !overlay || !badgeLayer || !fallbackList || !summary) return;

    this.cancelPendingHydration();
    this.clearPromptVisualState();
    if (!this.currentPromptPlainText) {
      return;
    }

    const viewMode = this.getEffectiveViewMode();
    const instText = document.getElementById('ra-prompt-instruction-text');
    if (instText) {
      if (viewMode === 'advanced') {
        instText.textContent = 'Use chunking for pause groups and connected speech for linking, reduced words, and sound changes.';
      } else {
        instText.textContent = this.getBasicPhaseInstruction();
      }
    }

    this.restorePlainTextVisibility();
    this.setPromptText(this.currentPromptPlainText, this.currentPromptChunkedText);
    this.updatePromptGuideButtons();
    if (this.state !== 'RESULTS') {
      this.clearConnectedSpeechResults();
    }

    // Basic used to return here, so the passage carried no linking arcs or weak-form
    // marks at all and the coach never mounted. The simple tier draws the same marks
    // from a fixed beginner set (see getActiveConnectedSpeechModes), so the only
    // thing Basic still withholds is the chip row and the IPA detail.
    const hasActiveGuides = this.hasActiveCoachGuides();
    if (!window.ReadAloudLinking || !hasActiveGuides) {
      return;
    }

    this.hydrateLinkingView(this.activePromptKey, this.activePromptRenderToken);
    this.scheduleHydrationRetry(this.activePromptKey, this.activePromptRenderToken);

    if (document.fonts?.ready && !this.pendingFontHydration) {
      this.pendingFontHydration = document.fonts.ready.then(() => {
        this.pendingFontHydration = null;
        if (this.shouldApplyPromptRender(this.activePromptKey, this.activePromptRenderToken)
            && this.hasActiveCoachGuides()) {
          this.hydrateLinkingView(this.activePromptKey, this.activePromptRenderToken);
        }
        if (this.state === 'RESULTS') {
          this.renderRecognizedLinkingOverlay();
        }
      }).catch(() => {
        this.pendingFontHydration = null;
      });
    }
  }

  async hydrateLinkingView(promptKey, renderToken, attempt = 0) {
    if (!window.ReadAloudLinking
        || !this.currentPromptPlainText
        || !this.hasActiveCoachGuides()) return;
    const targetPromptKey = promptKey || this.activePromptKey;
    const targetToken = renderToken || this.activePromptRenderToken;
    // Analyse the full superset regardless of which guides are on, so one cached
    // result serves every combination. Layer filtering happens at render time.
    const analysisOptions = {
      accentProfile: 'en-US',
      connectedSpeechLevel: 'sound_changes',
      enabledRuleSet: this.getConnectedSpeechRuleSet()
    };
    const analysis = await this.getPromptAnalysis(targetPromptKey, this.currentPromptPlainText, analysisOptions);
    const filteredAnalysis = window.ReadAloudLinking.filterAnalysisByBlockedBoundaries(
      analysis,
      this.currentPromptRenderState?.blockedBoundarySet
    );

    if (!this.shouldApplyPromptRender(targetPromptKey, targetToken) || !this.hasActiveCoachGuides()) {
      return;
    }

    this.cancelPendingHydration();
    this.pendingLinkingFrame = requestAnimationFrame(() => {
      this.pendingLinkingFrame = null;
      if (this.activeSoundChangeTooltipId) {
        const promptStage = document.getElementById('ra-prompt-stage');
        const activeTargets = this.getSoundChangeTooltipTargets(this.activeSoundChangeTooltipId, promptStage);
        const tooltip = document.getElementById('ra-sound-change-tooltip');
        if (activeTargets.length && tooltip && tooltip.getAttribute('aria-hidden') === 'false') {
          this.positionSoundChangeTooltip(tooltip, promptStage, activeTargets);
        } else {
          this.hideSoundChangeTooltip();
        }
      }
      if (!this.shouldApplyPromptRender(targetPromptKey, targetToken) || !this.hasActiveCoachGuides()) {
        return;
      }

      const promptStage = document.getElementById('ra-prompt-stage');
      const overlay = document.getElementById('ra-linking-overlay');
      const badgeLayer = document.getElementById('ra-connected-speech-badges');
      const fallbackList = document.getElementById('ra-linking-fallback-list');
      const summary = document.getElementById('ra-linking-a11y-summary');
      if (!promptStage || !overlay || !badgeLayer || !fallbackList || !summary) {
        return;
      }

      const wordMap = this.currentPromptRenderState?.wordMap || new Map();
      // Every layer comes out of one superset analysis, so the render pass is
      // told exactly which families the learner switched on.
      const activeModes = this.getActiveConnectedSpeechModes();
      const focusFamilies = [...activeModes];
      const hasVisibleAssimilation = typeof window.ReadAloudLinking?.hasVisibleAssimilation === 'function'
        ? window.ReadAloudLinking.hasVisibleAssimilation(filteredAnalysis)
        : Boolean(this.currentGuideHasVisibleAssimilation);
      this.currentGuideHasVisibleAssimilation = hasVisibleAssimilation;
      if (activeModes.includes('sound_changes') && !hasVisibleAssimilation) {
        if (!focusFamilies.includes('reduced_words')) {
          focusFamilies.push('reduced_words');
        }
      }
      const familyOptions = { focusFamilies };
      if (typeof window.ReadAloudLinking.applyTokenAnnotations === 'function') {
        window.ReadAloudLinking.applyTokenAnnotations(wordMap, filteredAnalysis, familyOptions);
      }
      const summaryText = window.ReadAloudLinking.buildAccessibleSummary(filteredAnalysis, familyOptions);
      summary.textContent = summaryText;
      // Results own the Coach rail once assessment has completed. A late
      // ResizeObserver/font hydration pass must not replace assessed feedback
      // with the prompt's Preview cards.
      if (this.state !== 'RESULTS') {
        this.renderPromptGuideExplanations(filteredAnalysis);
      }

      const promptWidth = Math.min(window.innerWidth || 0, promptStage.getBoundingClientRect().width || 0);
      const useFallback = promptWidth < (window.ReadAloudLinking.DESKTOP_MIN_WIDTH || 560);
      const hasBoundaryVisuals = Array.isArray(filteredAnalysis.boundaries)
        && filteredAnalysis.boundaries.some((boundary) => (
          !boundary.blocked && (boundary.confidence === 'high' || boundary.confidence === 'medium')
        ));
      let renderedCount = 0;

      fallbackList.style.display = 'none';
      fallbackList.innerHTML = '';

      if (useFallback) {
        badgeLayer.style.display = 'none';
        badgeLayer.innerHTML = '';
        overlay.style.display = 'none';
      } else {
        const overlayResult = window.ReadAloudLinking.renderOverlay(overlay, promptStage, filteredAnalysis, wordMap, familyOptions);
        const badgeResult = typeof window.ReadAloudLinking.renderAssimilationBadges === 'function'
          ? window.ReadAloudLinking.renderAssimilationBadges(badgeLayer, promptStage, filteredAnalysis, wordMap, familyOptions)
          : { renderedCount: 0 };
        renderedCount = overlayResult.renderedCount + (badgeResult.renderedCount || 0);
        if (renderedCount === 0) {
          overlay.style.display = 'none';
          badgeLayer.style.display = 'none';
        }
      }

      if (!useFallback && renderedCount === 0 && hasBoundaryVisuals && attempt < 1) {
        this.scheduleHydrationRetry(targetPromptKey, targetToken, 60, attempt + 1);
      }
      this.syncGuideSelectionState();
    });
  }

  async getPromptAnalysis(promptKey, promptText, options = {}) {
    const cacheKey = this.getPromptAnalysisCacheKey(promptKey, options);
    if (this.promptAnalysisCache.has(cacheKey)) {
      return this.promptAnalysisCache.get(cacheKey);
    }
    if (this.promptAnalysisPromiseCache.has(cacheKey)) {
      return this.promptAnalysisPromiseCache.get(cacheKey);
    }

    const analysisPromise = window.ReadAloudLinking.analyzePrompt(promptText, options)
      .then((analysis) => {
        this.promptAnalysisCache.set(cacheKey, analysis);
        this.promptAnalysisPromiseCache.delete(cacheKey);
        return analysis;
      })
      .catch((error) => {
        this.promptAnalysisPromiseCache.delete(cacheKey);
        return {
          tokens: window.ReadAloudLinking.tokenizePrompt(promptText),
          boundaries: [],
          tokenAnnotations: [],
          error
        };
      });

    this.promptAnalysisPromiseCache.set(cacheKey, analysisPromise);
    return analysisPromise;
  }

  getPromptAnalysisCacheKey(promptKey, options = {}) {
    const accentProfile = String(options.accentProfile || 'en-US');
    const connectedSpeechLevel = this.normalizeConnectedSpeechMode(options.connectedSpeechLevel || 'off');
    const enabledRuleSet = String(options.enabledRuleSet || (connectedSpeechLevel === 'off' ? 'none' : connectedSpeechLevel === 'sound_changes' ? 'connected-speech-v3' : 'linking-v1'));
    return `${promptKey}::${accentProfile}::${connectedSpeechLevel}::${enabledRuleSet}`;
  }

  handleConnectedSpeechKeydown(event, level) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleConnectedSpeechLevel(level);
  }

  /** Add or remove one guide, leaving the other active guides untouched. */
  toggleConnectedSpeechLevel(level, options = {}) {
    const normalizedLevel = this.normalizeConnectedSpeechMode(level);
    if (normalizedLevel === 'off') {
      this.applyConnectedSpeechModes([], options);
      return;
    }
    const active = new Set(this.connectedSpeechModes);
    if (active.has(normalizedLevel)) {
      active.delete(normalizedLevel);
    } else {
      active.add(normalizedLevel);
    }
    this.applyConnectedSpeechModes([...active], options);
  }

  setConnectedSpeechLevel(level, options = {}) {
    const normalizedLevel = this.normalizeConnectedSpeechMode(level);
    this.applyConnectedSpeechModes(normalizedLevel === 'off' ? [] : [normalizedLevel], options);
  }

  applyConnectedSpeechModes(modes, options = {}) {
    const { announce = true, persist = true } = options;
    const next = new Set(
      (Array.isArray(modes) ? modes : [])
        .map((mode) => this.normalizeConnectedSpeechMode(mode))
        .filter((mode) => mode !== 'off')
    );

    const current = this.connectedSpeechModes || new Set();
    const unchanged = next.size === current.size && [...next].every((mode) => current.has(mode));
    if (unchanged) {
      this.updatePromptGuideButtons();
      return;
    }

    this.invalidatePromptRenderState();
    this.connectedSpeechModes = next;

    if (persist) {
      // sessionConnectedSpeechLevel derives from this set — assigning it here
      // would collapse the session back to a single mode.
      this.sessionConnectedSpeechModes = new Set(next);
    }

    this.updatePromptGuideButtons();
    if (announce) {
      this.announceLinkingStatus(this.getConnectedSpeechAnnouncement());
    }
    this.renderPromptForCurrentView();

    if (this.state === 'RESULTS' && this.lastAssessmentPayload?.connectedSpeech) {
      if (this.lastAssessmentSession) {
        this.lastAssessmentSession.sessionConnectedSpeechModes = [...next];
      }
      this.renderConnectedSpeechResults(this.lastAssessmentPayload.connectedSpeech, {
        transcriptText: this.lastAssessmentPayload.recognizedText || this.currentPromptPlainText,
        words: this.lastAssessmentPayload.words || [],
        metrics: {
          fluencyScore: this.lastAssessmentPayload.fluencyScore,
          completenessScore: this.lastAssessmentPayload.completenessScore,
          pronScore: this.lastAssessmentPayload.pronScore
        },
        sessionViewMode: this.getEffectiveViewMode(),
        sessionConnectedSpeechModes: [...next]
      });
    }
  }

  isConnectedSpeechEnabled() {
    return !!this.connectedSpeechModes?.size;
  }

  /**
   * Whether anything should be drawn on the passage right now.
   *
   * isConnectedSpeechEnabled() asks "has the learner switched a chip on", which is
   * always false in Basic because Basic has no chips. The render path needs the
   * tier-aware question instead, or the simple tier draws nothing.
   */
  hasActiveCoachGuides() {
    return this.getActiveConnectedSpeechModes().length > 0;
  }

  shouldApplyPromptRender(promptKey, renderToken) {
    return this.isActive
      && this.activePromptKey === promptKey
      && this.activePromptRenderToken === renderToken;
  }

  shouldApplyPromptLoad(promptLoadToken) {
    return this.isActive && promptLoadToken === this.promptLifecycleToken;
  }

  invalidateRecordingSession() {
    const invalidatedSessions = new Set([
      this.currentRecordingSession,
      this.pendingSession
    ].filter(Boolean));
    this.recordingRequestId += 1;
    invalidatedSessions.forEach((session) => {
      session.disposition = 'discard';
      session.assessmentAbortController?.abort();
      session.assessmentAbortController = null;
    });
    this.isSubmitInFlight = false;
  }

  isSameRecordingSession(session) {
    return !!session
      && this.currentRecordingSession === session
      && session.id === this.recordingRequestId;
  }

  stopTracks(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    stream.getTracks().forEach((track) => track.stop());
  }

  cleanup() {
    this.pendingPteNextOwnership = null;
    this.invalidateSpeechCoachResultRender();
    this.cancelPendingHydration();
    this.stopTimer();
    this.invalidateRecordingSession();
    this.clearRecordedAudio();
    this.stopSpeechCoachModelAudio();
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
      this.mediaRecorder = null;
      this.currentRecordingSession = null;
    }
    this.stopMediaStream();

    this.stopReferenceAudioPlayback();

    this.state = 'IDLE';
    this.isSubmitInFlight = false;
  }

  stopMediaStream() {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
  }

  getRecordingSupportState() {
    const hasGetUserMedia = !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
    const hasMediaRecorder = typeof window.MediaRecorder === 'function';
    const hasAudioContext = typeof window.AudioContext === 'function' || typeof window.webkitAudioContext === 'function';
    const hasOfflineAudioContext = typeof window.OfflineAudioContext === 'function';
    return {
      supported: hasGetUserMedia && hasMediaRecorder && hasAudioContext && hasOfflineAudioContext
    };
  }

  applyUnsupportedState() {
    const statusMsg = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    const nextBtn = document.getElementById('ra-next-btn');
    const prepTimerBox = document.getElementById('ra-prep-timer-box');
    const recordTimerBox = document.getElementById('ra-record-timer-box');

    if (statusMsg) statusMsg.textContent = this.supportMessage;
    if (recordBtn) {
      recordBtn.textContent = 'Unsupported Browser';
      recordBtn.disabled = true;
    }
    if (nextBtn) nextBtn.style.display = 'none';
    this.setTimerEmphasis('none');
  }

  handleMicrophoneAccessError(error) {
    const errorName = String(error?.name || '');
    let message = 'A microphone is unavailable right now. Check your device and try again.';
    if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
      message = 'Microphone access was blocked. Allow microphone access and try again.';
    } else if (errorName === 'NotFoundError') {
      message = 'A microphone is unavailable right now. Check your device and try again.';
    } else if (errorName === 'NotReadableError' || errorName === 'AbortError') {
      message = 'A microphone is unavailable right now. Check your device and try again.';
    }

    this.state = 'PREP';
    this.updateUIForState();

    const statusMsg = document.getElementById('ra-status-message');
    if (statusMsg) statusMsg.textContent = message;
  }

  setAssessmentStatusMessage(message) {
    this.assessmentStatusMessage = String(message || '');
    const statusMsg = document.getElementById('ra-status-message');
    if (statusMsg) statusMsg.textContent = this.assessmentStatusMessage;
  }

  resetAssessmentDisplay() {
    this.hasAssessmentResult = false;
    this.assessmentStatusMessage = '';
    this.lastAssessmentPayload = null;
    this.lastAssessmentSession = null;
    if (this.pteView) {
      delete this.pteView.payload;
      this.pteView.stats?.replaceChildren();
      this.pteView.fixes?.replaceChildren();
    }
    const resultBox = document.getElementById('ra-result-box');
    const accuracyElement = document.getElementById('ra-accuracy-value');
    const feedbackElement = document.getElementById('ra-transcript-feedback');
    const checkBtn = document.getElementById('ra-check-btn');
    const retryBtn = document.getElementById('ra-retry-btn');
    const showAdvContainer = document.getElementById('ra-show-advanced-container');
    const showAdvBtn = document.getElementById('ra-show-advanced-btn');
    if (resultBox) resultBox.style.display = 'none';
    if (accuracyElement) accuracyElement.textContent = '--';
    // The score reads as a stat next to the guide chips rather than a 2.5rem
    // number in a card of its own, so it hides separately from the result block.
    document.getElementById('ra-accuracy-readout')?.setAttribute('hidden', '');
    if (feedbackElement) feedbackElement.innerHTML = '';
    if (showAdvContainer) showAdvContainer.style.display = 'none';
    if (showAdvBtn) showAdvBtn.textContent = '✨ Show Advanced Analysis';
    if (checkBtn) {
      checkBtn.style.display = 'none';
      checkBtn.textContent = 'Check';
      checkBtn.disabled = false;
    }
    if (retryBtn) {
      retryBtn.style.display = 'none';
      retryBtn.disabled = false;
    }
  }

  showAssessmentDisplay() {
    this.hasAssessmentResult = true;
    const resultBox = document.getElementById('ra-result-box');
    const checkBtn = document.getElementById('ra-check-btn');
    const retryBtn = document.getElementById('ra-retry-btn');
    if (resultBox) resultBox.style.display = 'block';
    document.getElementById('ra-accuracy-readout')?.removeAttribute('hidden');
    if (checkBtn) checkBtn.style.display = 'none';
    if (retryBtn) {
      retryBtn.style.display = 'inline-flex';
      retryBtn.disabled = false;
    }
    // Showing the results panel *is* reaching the Results phase — including when
    // the attempt could not be scored. Without this the stepper stayed on Record
    // while the learner was already looking at a result.
    if (this.state !== 'RESULTS') {
      this.state = 'RESULTS';
      this.updateUIForState();
      this.renderPromptForCurrentView();
    }
  }

  async handleCheckResult() {
    const checkBtn = document.getElementById('ra-check-btn');
    const retryBtn = document.getElementById('ra-retry-btn');
    if (checkBtn) {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking...';
    }
    if (retryBtn) {
      retryBtn.disabled = true;
    }
    try {
      const recordingSession = this.pendingSession;
      const success = await this.submitToAzure(this.pendingBlob, recordingSession);
      if (!this.shouldApplyAssessment(recordingSession)) return;
      if (success) {
        this.pendingBlob = null;
        this.pendingSession = null;
        this.state = 'RESULTS';
        this.updateUIForState();
        this.renderPromptForCurrentView();
      } else {
        if (checkBtn) {
          checkBtn.disabled = false;
          checkBtn.textContent = 'Check';
        }
        if (retryBtn) {
          retryBtn.disabled = false;
        }
      }
    } catch (error) {
      console.error('Check failed:', error);
      if (checkBtn) {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Check';
      }
      if (retryBtn) {
        retryBtn.disabled = false;
      }
    }
  }

  retryCurrentPrompt() {
    this.invalidateRecordingSession();
    if (this.isPteShellEnabled()) { this.pendingBlob = null; this.pendingSession = null; }
    this.invalidateSpeechCoachResultRender();
    this.stopTimer();
    this.state = 'PREP';
    this.resetAssessmentDisplay();
    this.clearRecordedAudio();
    this.renderPromptForCurrentView();
    this.updateUIForState();
    if (this.getRecordingSupportState().supported) {
      this.startPrepTimer();
    }
  }

  updateRecordedAudioControl() {
    const playBtn = document.getElementById('ra-play-recording-btn');
    const audioEl = document.getElementById('ra-user-recording-audio');
    const realPlayerWrapper = document.getElementById('ra-real-audio-player-wrapper');
    if (!playBtn) return;
    const shouldShow = !!this.userRecordingUrl && this.state !== 'RECORDING' && this.state !== 'REQUESTING_MIC';
    
    if (shouldShow) {
      playBtn.style.position = 'absolute';
      playBtn.style.opacity = '0';
      playBtn.style.width = '1px';
      playBtn.style.height = '1px';
      playBtn.style.overflow = 'hidden';
      // The native audio element is kept hidden as the playback engine. Keep this
      // legacy proxy in the DOM for stable event wiring, but do not let its
      // transparent 1px box intercept Check/Retry clicks in the shared shell.
      playBtn.style.pointerEvents = 'none';
      playBtn.style.display = '';
      playBtn.disabled = false;
      
      if (audioEl) {
        audioEl.style.display = 'inline-block';
        audioEl.style.width = '0px';
        audioEl.style.height = '0px';
        audioEl.style.opacity = '0';
        audioEl.style.position = 'absolute';
        audioEl.style.pointerEvents = 'none';
        audioEl.style.overflow = 'hidden';
        audioEl.removeAttribute('controls');
      }

      if (realPlayerWrapper) {
        realPlayerWrapper.style.display = 'flex';
        const hasSample = !!(this.audioManifest && this.currentQuestionId && this.audioManifest[this.currentQuestionId]);
        const tabSample = document.getElementById('ra-source-tab-sample');
        if (tabSample) {
          tabSample.disabled = !hasSample;
          tabSample.title = hasSample ? 'Listen to native speaker sample' : 'Sample audio not available for this question';
        }
        this.switchCustomAudioSource('yours');
      }
    } else {
      playBtn.style.position = '';
      playBtn.style.opacity = '';
      playBtn.style.width = '';
      playBtn.style.height = '';
      playBtn.style.overflow = '';
      playBtn.style.pointerEvents = '';
      playBtn.style.display = 'none';
      playBtn.disabled = true;
      playBtn.textContent = 'Play your recording';
      
      if (audioEl) {
        audioEl.style.display = 'none';
        audioEl.style.width = '';
        audioEl.style.height = '';
        audioEl.style.opacity = '';
        audioEl.style.position = '';
        audioEl.style.pointerEvents = '';
        audioEl.style.overflow = '';
      }
      if (realPlayerWrapper) {
        realPlayerWrapper.style.display = 'none';
      }
      this.updateCustomPlayButton(false);
      this.syncCustomAudioProgress();
    }

    this.refreshQuestionPickerV7AudioShortcuts();
  }

  clearRecordedAudio({ preserveAssessmentBuffer = false } = {}) {
    this.stopSpeechCoachYoursAudio({ pause: true, resetTime: true });
    this.stopSpeechCoachModelAudio();
    this.stopReferenceAudioPlayback();
    const audioEl = document.getElementById('ra-user-recording-audio');
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl.onended = null;
      audioEl.removeAttribute('src');
      if (typeof audioEl.load === 'function') {
        audioEl.load();
      }
    }
    const realPlayerWrapper = document.getElementById('ra-real-audio-player-wrapper');
    if (realPlayerWrapper) {
      realPlayerWrapper.style.display = 'none';
    }
    this.updateCustomPlayButton(false);
    this.syncCustomAudioProgress();

    if (this.userRecordingUrl && window.URL && typeof window.URL.revokeObjectURL === 'function') {
      window.URL.revokeObjectURL(this.userRecordingUrl);
    }
    this.userRecordingUrl = null;
    if (!preserveAssessmentBuffer) this.assessmentAudioBuffer = null;
    this.updateRecordedAudioControl();
  }

  setRecordedAudio(rawBlob, { preserveAssessmentBuffer = false } = {}) {
    this.clearRecordedAudio({ preserveAssessmentBuffer });
    if (!rawBlob || !window.URL || typeof window.URL.createObjectURL !== 'function') {
      return;
    }
    const audioEl = document.getElementById('ra-user-recording-audio');
    if (!audioEl) return;
    this.userRecordingUrl = window.URL.createObjectURL(rawBlob);
    audioEl.src = this.userRecordingUrl;
    audioEl.onended = () => {
      const playBtn = document.getElementById('ra-play-recording-btn');
      if (playBtn) playBtn.textContent = 'Play your recording';
      this.updateCustomPlayButton(false);
      this.syncCustomAudioProgress();
    };
    if (typeof audioEl.load === 'function') {
      audioEl.load();
    }
    this.updateRecordedAudioControl();
    this.syncCustomAudioProgress();
  }

  stopReferenceAudioPlayback() {
    const audioEl = document.getElementById('ra-elevenlabs-audio');
    if (audioEl && !audioEl.paused) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
    const playBtn = document.getElementById('ra-play-audio-btn');
    if (playBtn) playBtn.textContent = 'Play';
  }

  loadSpeechCoachAudioCatalog() {
    if (!this.speechCoachAudioCatalogPromise) {
      this.speechCoachAudioCatalogPromise = fetch('/database/RA/speech-coach-audio/v1/manifest.json', { cache: 'no-cache' })
        .then((response) => response.ok ? response.json() : null)
        .then((catalog) => {
          const ids = catalog?.questionManifestIds;
          if (catalog?.version !== 'sc-kokoro-v1' || !Array.isArray(ids)
            || ids.some((id) => typeof id !== 'string' || !/^[1-9]\d*$/.test(id))
            || new Set(ids).size !== ids.length) return null;
          return new Set(ids);
        })
        .catch(() => null);
    }
    return this.speechCoachAudioCatalogPromise;
  }

  async loadSpeechCoachAudioManifest(questionId = this.currentQuestionId) {
    const id = String(questionId || '').trim();
    if (!/^[1-9]\d*$/.test(id)) return null;
    if (this.speechCoachAudioManifestCache.has(id)) return this.speechCoachAudioManifestCache.get(id);
    if (this.speechCoachAudioManifestPromises.has(id)) return this.speechCoachAudioManifestPromises.get(id);
    const promise = this.loadSpeechCoachAudioCatalog()
      .then((ids) => {
        if (ids && !ids.has(id)) return null;
        return fetch(`/database/RA/speech-coach-audio/v1/questions/${encodeURIComponent(id)}.json`, { cache: 'force-cache' })
          .then((response) => response.ok ? response.json() : null);
      })
      .catch(() => null)
      .then((manifest) => {
        this.speechCoachAudioManifestCache.set(id, manifest);
        this.speechCoachAudioManifestPromises.delete(id);
        return manifest;
      });
    this.speechCoachAudioManifestPromises.set(id, promise);
    return promise;
  }

  getSpeechCoachAudioEntry(event) {
    const eventId = String(event?.eventId || '').trim();
    const questionId = String(this.currentQuestionId || '').trim();
    const manifest = this.speechCoachAudioManifestCache.get(questionId);
    if (!eventId
      || manifest?.version !== 'sc-kokoro-v1'
      || String(manifest?.questionId || '').trim() !== questionId
      || !manifest?.events) return null;
    const entry = manifest.events[eventId];
    if (!entry
      || entry.status !== 'ready'
      || String(entry.eventId || '') !== eventId
      || !String(entry.assetId || '').trim()
      || !Number.isFinite(Number(entry.durationMs))
      || Number(entry.durationMs) <= 0
      || !/^[a-f0-9]{64}$/i.test(String(entry.mp3Sha256 || ''))
      || !/^\/database\/RA\/speech-coach-audio\/v1\/clips\/[a-f0-9]{2}\/[a-f0-9]{64}\.mp3$/i.test(String(entry.file || ''))) return null;
    return entry;
  }

  /**
   * Resolve the manifest event id for a preview card's model clip.
   *
   * This used to return null for anything but a sound change, so linking and
   * reduced-word cards never offered audio — even though the manifests carry
   * ready `catenation` clips. It now resolves every family the manifest can
   * describe; callers fall back to synthesis when no clip is present, which is
   * most of the time (clip coverage is a few questions, not the whole bank).
   */
  getSpeechCoachGuideEvent(item) {
    if (!item || !Number.isInteger(Number(item.startWordIndex)) || !Number.isInteger(Number(item.endWordIndex))) return null;
    const questionId = String(this.currentQuestionId || '').trim();
    if (!questionId) return null;

    let family = null;
    if (item.category === 'sound_changes') {
      family = String(item.subtype || '').startsWith('coalescent_') ? 'yod_coalescence' : 'n_bilabial_assimilation';
    } else if (item.category === 'linking') {
      family = String(item.subtype || 'catenation');
    }
    if (!family) return null;

    const eventId = `q-${questionId}-${family}-${Number(item.startWordIndex)}-${Number(item.endWordIndex)}`;
    // Only offer the manifest control when a ready clip actually exists for it.
    // The manifest is cached per question by loadSpeechCoachAudioManifest(); if it
    // has not loaded yet there is nothing to play, so fall through to synthesis.
    const manifest = this.speechCoachAudioManifestCache?.get(questionId);
    const entry = manifest?.events?.[eventId];
    if (!entry || entry.status !== 'ready') return null;

    return { eventId, family, phrase: item.label || '', startWordIndex: Number(item.startWordIndex), endWordIndex: Number(item.endWordIndex) };
  }

  /**
   * Fallback model audio for cards with no recorded clip. Speaks the card's own
   * phrase through the browser voice — never the IPA and never the respelling,
   * which synthesis reads as nonsense. Renders nothing where the API is absent
   * rather than showing a control that cannot work.
   */
  _buildSpokenModelFallbackControl(item) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return '';
    const phrase = String(item?.label || '').trim();
    if (!phrase) return '';
    const escapeHtml = ReadAloudMode.escapeHtml;
    return `<button class="sc-audio-btn sc-audio-btn--model sc-audio-btn--synth" type="button" data-speak-phrase="${escapeHtml(phrase)}" title="Hear this read by the browser voice" aria-label="Hear ${escapeHtml(phrase)} read aloud"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span>Listen</span></button>`;
  }

  /** Speak a short phrase with the browser voice, cancelling anything in flight. */
  speakGuidePhrase(phrase) {
    const text = String(phrase || '').trim();
    if (!text || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.85;
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn('[ReadAloud] Speech synthesis failed:', error);
    }
  }

  hasPlayableRecordingSource() {
    const audioEl = document.getElementById('ra-user-recording-audio');
    return !!this.assessmentAudioBuffer
      || !!String(this.userRecordingUrl || '').trim()
      || !!String(audioEl?.getAttribute('src') || '').trim();
  }

  _buildSpeechCoachPlaybackControls(event, evIndex, hasTimestamps, title = 'Play this segment') {
    const yoursHtml = !hasTimestamps
      ? ''
      : (this.hasPlayableRecordingSource()
        ? `<button class="sc-play-word-btn sc-audio-btn sc-audio-btn--yours" type="button" data-event-index="${evIndex}" data-start="${event.startMs}" data-end="${event.endMs}" title="${title}" aria-label="Play your recording segment"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>Yours</span></button>`
        : `<button class="sc-play-word-btn sc-audio-btn sc-audio-btn--yours sc-audio-btn--unavailable" type="button" disabled aria-disabled="true" title="Your recording segment is unavailable" aria-label="Your recording segment is unavailable"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>Yours</span></button>`);
    const model = this.getSpeechCoachAudioEntry(event);
    if (model?.status === 'ready' && model.file) {
      return `<div class="sc-audio-controls">${yoursHtml}<button class="sc-model-play-btn sc-audio-btn sc-audio-btn--model" type="button" data-event-index="${evIndex}" data-model-src="${ReadAloudMode.escapeHtml(String(model.file))}" title="Play the model connected-speech example" aria-label="Play model pronunciation"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>Model</span></button></div>`;
    }
    return `<div class="sc-audio-controls">${yoursHtml}<button class="sc-model-play-btn sc-audio-btn sc-audio-btn--model sc-audio-btn--unavailable" type="button" disabled aria-disabled="true" title="Model audio unavailable" aria-label="Model audio unavailable"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>Model unavailable</span></button></div>`;
  }

  stopSpeechCoachModelAudio() {
    if (this.speechCoachModelAudio) {
      this.speechCoachModelAudio.pause();
      this.speechCoachModelAudio.currentTime = 0;
      this.speechCoachModelAudio.removeAttribute('src');
      if (typeof this.speechCoachModelAudio.load === 'function') this.speechCoachModelAudio.load();
    }
    if (this.speechCoachModelButton) {
      this.speechCoachModelButton.classList.remove('is-playing');
      this.speechCoachModelButton.setAttribute('aria-label', 'Play model pronunciation');
      this.speechCoachModelButton.querySelector('span')?.replaceChildren(document.createTextNode('Model'));
    }
    this.speechCoachModelButton = null;
    document.querySelectorAll('.sc-model-play-btn.is-playing').forEach((button) => {
      button.classList.remove('is-playing');
      button.setAttribute('aria-label', 'Play model pronunciation');
      const label = button.querySelector('span');
      if (label) label.textContent = 'Model';
    });
  }

  resetRecordedWordButton(button) {
    if (!button) return;
    button.classList.remove('is-playing');
    if (button.classList.contains('ra-word-token')) {
      const playable = button.dataset.playable === 'true';
      button.setAttribute('aria-label', playable ? `${button.textContent.trim()}, click to play your recording.` : `${button.textContent.trim()}, no recording segment available.`);
      return;
    }
    button.setAttribute('aria-label', 'Play your recording segment');
    const label = button.querySelector('span');
    if (label) label.textContent = 'Yours';
  }

  stopRecordedWordPlayback() {
    this.cancelRecordedSegmentPlayback();
  }

  cancelRecordedSegmentPlayback({ pause = false, resetTime = false } = {}) {
    const previous = this.recordedSegmentPlayback || {};
    const revision = Number(previous.revision || 0) + 1;
    previous.metadataCleanup?.('stale');
    if (previous.timer) clearInterval(previous.timer);
    if (previous.sourceNode) {
      previous.sourceNode.onended = null;
      try { previous.sourceNode.stop(); } catch (_) { /* already stopped */ }
    }
    if (pause && previous.mediaElement && !previous.mediaElement.paused) previous.mediaElement.pause();
    if (resetTime && previous.mediaElement) {
      try { previous.mediaElement.currentTime = 0; } catch (_) { /* metadata may be unavailable */ }
    }
    this.resetRecordedWordButton(previous.button || this.wordPlaybackButton);
    this.recordedSegmentPlayback = {
      revision,
      sourceKind: null,
      sourceNode: null,
      mediaElement: null,
      timer: null,
      button: null,
      metadataCleanup: null
    };
    this.wordPlaybackSource = null;
    this.wordPlaybackButton = null;
    this.speechCoachYoursButton = null;
    this._segmentInterval = null;
    this.updateCustomPlayButton(false);
    this.syncCustomAudioProgress();
    return revision;
  }

  waitForRecordedAudioMetadata(audioEl, revision, timeoutMs = 2000) {
    if (Number(audioEl?.readyState) >= 1) return Promise.resolve({ ready: true, reason: 'ready' });
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ready, reason) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        audioEl.removeEventListener('loadedmetadata', onReady);
        audioEl.removeEventListener('error', onError);
        if (this.recordedSegmentPlayback.revision === revision) {
          this.recordedSegmentPlayback.metadataCleanup = null;
        }
        resolve({ ready, reason });
      };
      const onReady = () => finish(true, 'ready');
      const onError = () => finish(false, 'metadata_error');
      const timeout = setTimeout(() => finish(false, 'metadata_timeout'), timeoutMs);
      audioEl.addEventListener('loadedmetadata', onReady, { once: true });
      audioEl.addEventListener('error', onError, { once: true });
      this.recordedSegmentPlayback.metadataCleanup = (reason = 'stale') => finish(false, reason);
    });
  }

  async playRecordedWordSegment(startMs, endMs, button = null) {
    const start = Number(startMs);
    const end = Number(endMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { started: false, source: null, reason: 'invalid_range' };
    }
    if (!this.hasPlayableRecordingSource()) {
      return { started: false, source: null, reason: 'no_source' };
    }

    const activePlayback = this.recordedSegmentPlayback || {};
    if (button && activePlayback.button === button
        && (activePlayback.sourceNode || activePlayback.timer || activePlayback.metadataCleanup)) {
      const source = activePlayback.sourceKind;
      this.stopSpeechCoachYoursAudio({ pause: true });
      return { started: false, source, reason: 'stopped' };
    }

    this.stopSpeechCoachYoursAudio({ pause: true, resetTime: true });
    this.stopSpeechCoachModelAudio();
    this.stopReferenceAudioPlayback();
    if (window.PronunciationTooltip && typeof window.PronunciationTooltip.stopSegmentPlayback === 'function') {
      window.PronunciationTooltip.stopSegmentPlayback();
    }
    this.switchCustomAudioSource('yours');
    const audioEl = document.getElementById('ra-user-recording-audio');
    if (audioEl) {
      if (!audioEl.paused) audioEl.pause();
      audioEl.currentTime = 0;
    }

    const revision = this.recordedSegmentPlayback.revision;
    this.recordedSegmentPlayback.button = button;
    this.wordPlaybackButton = button;
    this.speechCoachYoursButton = button;
    if (button) {
      button.classList.add('is-playing');
      if (button.classList.contains('ra-word-token')) {
        button.setAttribute('aria-label', 'Stop your recorded word segment');
      } else {
        button.setAttribute('aria-label', 'Loading your recording segment');
        const label = button.querySelector('span');
        if (label) label.textContent = 'Loading yours...';
      }
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (this.assessmentAudioBuffer && typeof AudioContextCtor === 'function') {
      if (!this.wordPlaybackContext || this.wordPlaybackContext.state === 'closed') {
        this.wordPlaybackContext = new AudioContextCtor();
      }

      const context = this.wordPlaybackContext;
      const offsetSec = Math.max(0, start / 1000);
      const durationSec = Math.min(
        Math.max(0, end / 1000 - offsetSec),
        Math.max(0, Number(this.assessmentAudioBuffer.duration) - offsetSec)
      );
      if (!(durationSec > 0)) {
        this.stopRecordedWordPlayback();
        return { started: false, source: 'decoded-buffer', reason: 'invalid_range' };
      }

      if (context.state === 'suspended' && typeof context.resume === 'function') {
        try {
          await context.resume();
        } catch (_) {
          if (this.recordedSegmentPlayback.revision === revision) this.stopRecordedWordPlayback();
          return { started: false, source: 'decoded-buffer', reason: 'resume_failed' };
        }
      }
      if (this.recordedSegmentPlayback.revision !== revision) {
        return { started: false, source: 'decoded-buffer', reason: 'stale' };
      }
      try {
        const source = context.createBufferSource();
        source.buffer = this.assessmentAudioBuffer;
        source.connect(context.destination);
        source.onended = () => {
          if (this.recordedSegmentPlayback.revision === revision
              && this.recordedSegmentPlayback.sourceNode === source) this.stopRecordedWordPlayback();
        };
        this.recordedSegmentPlayback.sourceKind = 'decoded-buffer';
        this.recordedSegmentPlayback.sourceNode = source;
        this.wordPlaybackSource = source;
        source.start(0, offsetSec, durationSec);
        if (button && !button.classList.contains('ra-word-token')) {
          button.setAttribute('aria-label', 'Stop your recording segment');
          const label = button.querySelector('span');
          if (label) label.textContent = 'Stop yours';
        }
        return { started: true, source: 'decoded-buffer', reason: 'started' };
      } catch (error) {
        console.warn('[ReadAloud] Word segment playback failed:', error);
        if (this.recordedSegmentPlayback.revision === revision) this.stopRecordedWordPlayback();
        return { started: false, source: 'decoded-buffer', reason: 'start_failed' };
      }
    }

    if (!audioEl) {
      this.stopRecordedWordPlayback();
      return { started: false, source: 'native-audio', reason: 'missing_element' };
    }
    if (!audioEl.getAttribute('src') && this.userRecordingUrl) {
      audioEl.src = this.userRecordingUrl;
      if (typeof audioEl.load === 'function') audioEl.load();
    }
    if (!audioEl.getAttribute('src')) {
      this.stopRecordedWordPlayback();
      return { started: false, source: 'native-audio', reason: 'no_source' };
    }

    this.recordedSegmentPlayback.sourceKind = 'native-audio';
    this.recordedSegmentPlayback.mediaElement = audioEl;
    const readiness = await this.waitForRecordedAudioMetadata(audioEl, revision);
    if (this.recordedSegmentPlayback.revision !== revision) {
      return { started: false, source: 'native-audio', reason: 'stale' };
    }
    if (!readiness.ready) {
      this.stopRecordedWordPlayback();
      return { started: false, source: 'native-audio', reason: readiness.reason };
    }

    const endSec = end / 1000;
    try {
      const duration = Number(audioEl.duration);
      const maxStart = Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - 0.001) : Number.POSITIVE_INFINITY;
      audioEl.currentTime = Math.min(Math.max(0, start / 1000), maxStart);
    } catch (_) {
      this.stopRecordedWordPlayback();
      return { started: false, source: 'native-audio', reason: 'seek_failed' };
    }
    const timer = setInterval(() => {
      if (this.recordedSegmentPlayback.revision !== revision) return;
      if (audioEl.currentTime >= endSec || audioEl.ended) {
        this.stopSpeechCoachYoursAudio({ pause: true });
      }
    }, 25);
    this.recordedSegmentPlayback.timer = timer;
    this._segmentInterval = timer;
    try {
      await audioEl.play();
      if (this.recordedSegmentPlayback.revision !== revision) {
        return { started: false, source: 'native-audio', reason: 'stale' };
      }
      if (button && !button.classList.contains('ra-word-token')) {
        button.setAttribute('aria-label', 'Stop your recording segment');
        const label = button.querySelector('span');
        if (label) label.textContent = 'Stop yours';
      }
      return { started: true, source: 'native-audio', reason: 'started' };
    } catch (error) {
      console.warn('[ReadAloud] Recorded segment playback failed:', error);
      if (this.recordedSegmentPlayback.revision === revision) this.stopSpeechCoachYoursAudio({ pause: true });
      return { started: false, source: 'native-audio', reason: 'play_rejected' };
    }
  }

  stopSpeechCoachYoursAudio({ pause = false, resetTime = false } = {}) {
    this.cancelRecordedSegmentPlayback({ pause, resetTime });
  }

  playSpeechCoachModelAudio(button) {
    const src = String(button?.dataset?.modelSrc || '').trim();
    if (!src) return;
    if (!this.speechCoachModelAudio) {
      this.speechCoachModelAudio = new Audio();
      this.speechCoachModelAudio.preload = 'auto';
      this.speechCoachModelAudio.addEventListener('ended', () => this.stopSpeechCoachModelAudio());
      this.speechCoachModelAudio.addEventListener('error', () => {
        const failedButton = this.speechCoachModelButton;
        this.stopSpeechCoachModelAudio();
        if (failedButton) {
          failedButton.disabled = true;
          failedButton.setAttribute('aria-disabled', 'true');
          failedButton.classList.add('sc-audio-btn--unavailable');
          failedButton.setAttribute('aria-label', 'Model audio unavailable');
          const label = failedButton.querySelector('span');
          if (label) label.textContent = 'Model unavailable';
        }
      });
    }
    if (this.speechCoachModelButton === button && !this.speechCoachModelAudio.paused) {
      this.stopSpeechCoachModelAudio();
      return;
    }
    this.stopSpeechCoachModelAudio();
    this.stopSpeechCoachYoursAudio({ pause: true, resetTime: true });
    const userAudio = document.getElementById('ra-user-recording-audio');
    if (userAudio && !userAudio.paused) userAudio.pause();
    if (userAudio) userAudio.currentTime = 0;
    const recordedPlayBtn = document.getElementById('ra-play-recording-btn');
    if (recordedPlayBtn) recordedPlayBtn.textContent = 'Play your recording';
    this.stopReferenceAudioPlayback();
    this.speechCoachModelButton = button;
    this.speechCoachModelAudio.src = src;
    this.speechCoachModelAudio.load();
    const label = button.querySelector('span');
    if (label) label.textContent = 'Loading model...';
    button.setAttribute('aria-label', 'Loading model audio');
    button.classList.add('is-playing');
    Promise.resolve(this.speechCoachModelAudio.play()).then(() => {
      if (this.speechCoachModelButton === button) {
        if (label) label.textContent = 'Stop model';
        button.setAttribute('aria-label', 'Stop model audio');
      }
    }).catch(() => {
      this.stopSpeechCoachModelAudio();
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.classList.add('sc-audio-btn--unavailable');
      button.setAttribute('aria-label', 'Model audio unavailable');
      if (label) label.textContent = 'Model unavailable';
    });
  }

  playRecordedAudio() {
    const audioEl = document.getElementById('ra-user-recording-audio');
    const playBtn = document.getElementById('ra-play-recording-btn');
    if (!audioEl || !this.userRecordingUrl || !playBtn) return;

    if (this.speechCoachYoursButton) {
      this.stopSpeechCoachYoursAudio({ pause: true, resetTime: true });
    }

    if (audioEl.paused) {
      this.stopSpeechCoachModelAudio();
      this.stopReferenceAudioPlayback();
      this.switchCustomAudioSource('yours');
      const volumeInput = document.getElementById('ra-custom-volume');
      if (volumeInput) audioEl.volume = Number(volumeInput.value);
      const playPromise = audioEl.play();
      playBtn.textContent = 'Pause your recording';
      this.updateCustomPlayButton(true);
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          playBtn.textContent = 'Play your recording';
          this.updateCustomPlayButton(false);
        });
      }
      return;
    }

    audioEl.pause();
    playBtn.textContent = 'Play your recording';
    this.updateCustomPlayButton(false);
  }

  applyRecordingCaptureFailure(recordingSession, message) {
    if (!this.shouldApplyAssessment(recordingSession)) return;
    this.renderAssessmentFailure(message, 'We could not prepare this recording for scoring.');
  }

  renderAssessmentFailure(message, detail = 'We could not score this attempt.') {
    this.lastAssessmentPayload = null;
    this.lastAssessmentSession = null;
    if (this.pteView) delete this.pteView.payload;
    this.setAssessmentStatusMessage(message);
    const accuracyElement = document.getElementById('ra-accuracy-value');
    const feedbackElement = document.getElementById('ra-transcript-feedback');
    if (accuracyElement) accuracyElement.textContent = '--';
    if (feedbackElement) {
      feedbackElement.innerHTML = `<p style="line-height: 1.6; font-size: 1rem; padding: 10px; border: 1px solid #f3d1d1; border-radius: 8px; background: #fff7f7; color: #b42318;">${detail}</p>`;
    }
    this.clearConnectedSpeechResults();
    this.showAssessmentDisplay();
  }

  isPteShellEnabled() {
    return !!window.PteShellConfig?.isModeEnabled('read-aloud', window.PracticeScopeManager?.getScope?.() || 'pte');
  }

  getPtePhase() {
    return ({ PREP: 'prep', REQUESTING_MIC: 'recording', RECORDING: 'recording', STOPPING_RECORDING: 'recording', RECORDED: 'complete', RESULTS: 'feedback' })[this.state] || 'loading';
  }

  setDifficultyFilter(value) {
    if (!['all', '1', '2', '3'].includes(String(value))) return;
    this.difficultyFilter = String(value);
    const filtered = this.getFilteredDatabase();
    this.syncQuestionPickerOptions(filtered, this.getPreferredFilteredPromptRow(filtered, { preferLastPrompt: true }));
  }

  mountPteShell() {
    if (this.pteView || !this.isPteShellEnabled()) return;
    const panel = document.getElementById('mode-read-aloud');
    const stage = panel.querySelector('.ra-stage');
    const split = panel.querySelector('.ra-split');
    const coach = document.getElementById('ra-connected-speech-box');
    const view = this.pteView = { panel, stage, split, coach, moved: [], created: [], phase: null, payload: null };
    const create = (tag, className, id, parent) => {
      const node = document.createElement(tag); node.className = className; if (id) node.id = id;
      parent.append(node); view.created.push(node); return node;
    };
    const move = (node, parent) => {
      if (!node) return;
      const anchor = document.createComment('Read Aloud v3 origin'); node.before(anchor);
      view.moved.push({ node, anchor }); parent.append(node);
    };
    panel.classList.add('ra-pte-v3');
    view.instruction = create('p', 'pte-instr', 'ra-pte-instruction', stage);
    const recorderCenter = create('div', 'pte-center', null, stage);
    const recorder = create('div', '', 'ra-pte-recorder', recorderCenter);
    stage.prepend(view.instruction, recorderCenter);
    const announcement = create('p', 'pte-sr-only', 'ra-workspace-instruction', stage);
    announcement.setAttribute('role', 'status');
    view.announcement = announcement;
    this.pteRecorder = window.PteRecorderWidget.create(recorder, { totalSeconds: this.recordSeconds });
    document.getElementById('ra-prompt-stage').classList.add('pte-passage');
    view.right = create('div', 'pte-fb__right', 'ra-pte-right', split);
    view.tabs = create('div', 'pte-tabs', 'ra-pte-feedback-tabs', view.right);
    view.tabs.setAttribute('role', 'tablist'); view.tabs.setAttribute('aria-label', 'Feedback');
    for (const [key, label] of [['results', 'Your results'], ['coach', 'Coach tips']]) {
      const button = create('button', 'pte-btn', `ra-pte-tab-${key}`, view.tabs);
      button.type = 'button'; button.textContent = label; button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', key === 'results' ? 'ra-pte-results' : 'ra-connected-speech-box');
      button.addEventListener('click', () => this.selectPteFeedbackTab(key));
      button.addEventListener('keydown', event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 'results' : event.key === 'End' ? 'coach' : key === 'results' ? 'coach' : 'results';
          this.selectPteFeedbackTab(next); document.getElementById(`ra-pte-tab-${next}`).focus();
        }
      });
    }
    view.results = create('section', '', 'ra-pte-results', view.right);
    view.results.setAttribute('role', 'tabpanel'); view.results.setAttribute('aria-labelledby', 'ra-pte-tab-results');
    view.stats = create('div', 'pte-stats', null, view.results);
    const heading = create('div', 'ra-pte-next-heading', null, view.results);
    const title = create('strong', '', null, heading); title.textContent = 'What to practise next';
    move(document.getElementById('ra-show-advanced-container'), heading);
    view.fixes = create('div', 'pte-practice-next pte-fixes', null, view.results);
    move(coach, view.right);
    move(document.getElementById('ra-prompt-guides-group'), coach.querySelector('.ra-rail-header'));
    move(document.getElementById('ra-audio-player'), stage);
    const cancel = create('button', 'pte-btn', 'ra-pte-cancel-btn', panel);
    cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => this.cancelRecording());
    try { this.pteCoachOpen = localStorage.getItem('bel:ra:coach-open:v1') === 'true'; } catch (_) { this.pteCoachOpen = false; }
    this.pteFeedbackTab = 'results';
    view.keydown = event => { if (event.key === 'Escape') this.hideSoundChangeTooltip(); };
    document.addEventListener('keydown', view.keydown);
    this.renderPromptForCurrentView();
    this.syncPteShell();
    window.dispatchEvent(new Event('resize'));
  }

  unmountPteShell() {
    const view = this.pteView; if (!view) return;
    this.pteRecorder?.destroy(); this.pteRecorder = null;
    this.hideSoundChangeTooltip(); document.removeEventListener('keydown', view.keydown);
    view.moved.reverse().forEach(({ node, anchor }) => anchor.replaceWith(node));
    view.created.reverse().forEach(node => node.remove());
    view.panel.classList.remove('ra-pte-v3'); view.split.classList.remove('pte-fb');
    document.getElementById('ra-prompt-stage')?.classList.remove('pte-passage');
    delete view.panel.dataset.ptePhase; delete view.panel.dataset.pteCoach;
    this.pteView = null;
  }

  selectPteFeedbackTab(tab) {
    this.pteFeedbackTab = tab;
    if (tab === 'coach' && !this.speechCoachVisible) this.toggleSpeechCoachVisibility();
    this.syncPteShell();
    window.dispatchEvent(new Event('resize'));
  }

  setCoachOpen(open) {
    this.pteCoachOpen = !!open;
    try { localStorage.setItem('bel:ra:coach-open:v1', String(this.pteCoachOpen)); } catch (_) { /* local preferences may be unavailable */ }
    if (this.speechCoachVisible !== this.pteCoachOpen) this.toggleSpeechCoachVisibility();
    if (this.state === 'RESULTS') this.pteFeedbackTab = 'coach';
    this.syncPteShell();
    window.dispatchEvent(new Event('resize'));
  }

  syncPteShell() {
    const view = this.pteView; if (!view) return;
    const phase = this.getPtePhase();
    const feedback = phase === 'feedback';
    if (phase !== view.phase) {
      this.hideSoundChangeTooltip();
      if (phase === 'prep') this.pteRecorder.showCountdown(this.prepSeconds);
      else if (phase === 'recording') this.pteRecorder.showRecording(this.recordSeconds);
      else if (phase === 'complete' || feedback) this.pteRecorder.showComplete();
      if (feedback) this.pteFeedbackTab = 'results';
      view.phase = phase;
    }
    if (this.state === 'RECORDING' && this.audioStream && view.stream !== this.audioStream) {
      this.pteRecorder.attachStream(this.audioStream); view.stream = this.audioStream;
    }
    view.panel.dataset.ptePhase = phase;
    view.panel.dataset.pteCoach = this.pteCoachOpen ? 'open' : 'closed';
    view.split.classList.toggle('pte-fb', feedback);
    view.instruction.textContent = `Look at the text below. In ${this.prepSeconds} seconds, you must read this text aloud as naturally and clearly as possible. You have ${this.recordSeconds} seconds to read aloud.`;
    const status = document.getElementById('ra-status-message');
    if (status) { status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); }
    const message = feedback ? this.assessmentStatusMessage || 'Getting feedback.' : this.getBasicPhaseInstruction();
    if (view.announcement.textContent !== message) view.announcement.textContent = message;
    const labels = { 'ra-record-btn': 'Start recording', 'ra-stop-btn': 'Finish recording', 'ra-retry-btn': feedback ? 'Try again' : 'Record again', 'ra-play-recording-btn': 'Play', 'ra-check-btn': 'Get feedback' };
    Object.entries(labels).forEach(([id, label]) => {
      const button = document.getElementById(id);
      if (!button?.hasAttribute('data-pte-phases')) return;
      button.textContent = label;
      button.style.display = '';
    });
    const stop = document.getElementById('ra-stop-btn'); if (stop) stop.disabled = this.state !== 'RECORDING';
    view.tabs.hidden = !feedback; view.results.hidden = !feedback || this.pteFeedbackTab !== 'results';
    view.right.hidden = !feedback && (phase === 'recording' || !this.pteCoachOpen);
    view.coach.classList.toggle('ra-pte-coach-hidden', phase === 'recording' || (feedback ? this.pteFeedbackTab !== 'coach' : !this.pteCoachOpen));
    for (const key of ['results', 'coach']) {
      const tab = document.getElementById(`ra-pte-tab-${key}`);
      tab.setAttribute('aria-selected', String(this.pteFeedbackTab === key)); tab.tabIndex = this.pteFeedbackTab === key ? 0 : -1;
    }
    document.getElementById('ra-pte-tab-coach').textContent = `Coach tips · ${this.lastAssessmentPayload?.connectedSpeech?.events?.length || 0}`;
    if (feedback) this.renderPteFeedback();
    if (document.getElementById('pte-next-read-aloud')) window.SpeakingPracticeController?.setPhase('read-aloud', phase);
  }

  renderPteFeedback() {
    const view = this.pteView, payload = this.lastAssessmentPayload;
    if (!view || view.payload === payload) return;
    view.payload = payload; view.stats.replaceChildren(); view.fixes.replaceChildren();
    const node = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el; };
    for (const [label, key] of [['Accuracy', 'accuracyScore'], ['Fluency', 'fluencyScore'], ['Completeness', 'completenessScore'], ['Overall', 'pronScore']]) {
      const cell = node('div', ''); cell.append(node('small', label), node('strong', Number.isFinite(payload?.[key]) ? `${payload[key]}%` : '—')); view.stats.append(cell);
    }
    if (!payload) { view.fixes.append(node('p', this.assessmentStatusMessage || 'Getting feedback…')); return; }
    const words = (payload.words || []).filter(word => Number.isFinite(word.accuracyScore) && word.accuracyScore < 60);
    const events = payload.connectedSpeech?.events || [];
    const rows = [...words.map(word => ({ label: word.word, detail: `Needs practice (${word.accuracyScore}%)`, startMs: word.startMs, endMs: word.endMs, kind: 'error' })),
      ...events.filter(event => ['uncertain', 'not_detected'].includes(event.status)).map(event => ({ ...event, label: event.phrase, detail: event.feedbackText || event.tip || 'Practise this phrase.', kind: 'uncertain' })),
      ...events.filter(event => event.status === 'detected').slice(0, 1).map(event => ({ ...event, label: event.phrase, detail: 'Good. Keep linking it.', kind: 'success' }))].slice(0, 4);
    if (!rows.length) view.fixes.append(node('p', 'Read the scored transcript and use Coach tips to review your pronunciation.'));
    rows.forEach(item => {
      const row = node('div', ''); row.className = `ra-pte-fix ra-pte-fix--${item.kind}`;
      const copy = node('div', ''); copy.append(node('strong', item.label || 'Speech Coach'), node('p', item.detail));
      const actions = node('div', ''); actions.className = 'ra-pte-fix-actions';
      const you = node('button', '▶ You'); you.className = 'pte-btn'; you.type = 'button';
      const start = item.startMs ?? Number(item.startSec) * 1000, end = item.endMs ?? Number(item.endSec) * 1000;
      you.disabled = !Number.isFinite(start) || !Number.isFinite(end) || end <= start;
      you.addEventListener('click', () => this.playRecordedWordSegment(start, end, you)); actions.append(you);
      const model = node('button', '▶ Model'); model.className = 'pte-btn'; model.type = 'button';
      model.addEventListener('click', () => {
        const original = [...document.querySelectorAll('#ra-connected-speech-list .sc-model-play-btn')].find(button => button.dataset.eventId === item.eventId);
        if (original && !original.disabled) this.playSpeechCoachModelAudio(original);
        else this.speakGuidePhrase(item.label);
      }); actions.append(model);
      row.append(node('span', item.kind === 'error' ? '!' : item.kind === 'success' ? '✓' : '?'), copy, actions); view.fixes.append(row);
    });
    const advanced = document.getElementById('ra-show-advanced-container'); if (advanced) advanced.style.display = '';
    const button = document.getElementById('ra-show-advanced-btn'); if (button) button.textContent = 'Show advanced analysis ›';
  }

  updateUIForState() {
    this.updateLegacyUIForState();
    this.syncPteShell();
  }

  updateLegacyUIForState() {
    // Single choke point for every state transition — keep the shared step
    // indicator in step with the state machine from here.
    window.SpeakingPracticeController?.sync?.('read-aloud');

    if (!this.getRecordingSupportState().supported) {
      this.applyUnsupportedState();
      this.refreshQuestionPickerV7NavState();
      this.refreshQuestionPickerV7AudioShortcuts();
      return;
    }

    this.refreshQuestionPickerV7NavState();
    this.refreshQuestionPickerV7AudioShortcuts();

    const prepTimerBox = document.getElementById('ra-prep-timer-box');
    const recordTimerBox = document.getElementById('ra-record-timer-box');
    const recordBtn = document.getElementById('ra-record-btn');
    const nextBtn = document.getElementById('ra-next-btn');
    const statusMsg = document.getElementById('ra-status-message');
    const resultBox = document.getElementById('ra-result-box');
    const stopBtn = document.getElementById('ra-stop-btn');
    const checkBtn = document.getElementById('ra-check-btn');
    const retryBtn = document.getElementById('ra-retry-btn');

    const isRecordingActive = (this.state === 'REQUESTING_MIC' || this.state === 'RECORDING' || this.state === 'STOPPING_RECORDING');
    if (window.SpeakingPracticeController?.setViewToggleDisabled) {
      window.SpeakingPracticeController.setViewToggleDisabled(isRecordingActive);
    }

    if (this.state === 'PREP') {
      this.setTimerEmphasis('prep');
      if (nextBtn) {
        nextBtn.style.display = '';
        nextBtn.disabled = false;
        nextBtn.textContent = 'Next prompt';
      }
      if (recordBtn) {
        recordBtn.textContent = 'Start recording now';
        recordBtn.disabled = false;
        recordBtn.style.display = '';
      }
      // The guide instruction above the passage now carries the prep guidance
      // (getBasicPhaseInstruction), so this line no longer repeats it.
      if (statusMsg) statusMsg.textContent = '';
      if (resultBox) resultBox.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'none';
      if (checkBtn) checkBtn.style.display = 'none';
      if (retryBtn) retryBtn.style.display = 'none';
      this.updateRecordedAudioControl();
      this.updateTimerDisplay('ra-prep-time', this.prepSeconds);
      this.updateTimerDisplay('ra-record-time', this.recordSeconds);
      return;
    }

    if (this.state === 'RECORDING') {
      this.setTimerEmphasis('record');
      if (nextBtn) nextBtn.style.display = 'none';
      if (recordBtn) recordBtn.style.display = 'none';
      if (statusMsg) statusMsg.textContent = 'Recording... Please read aloud.';
      if (resultBox) resultBox.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'inline-flex';
      if (checkBtn) checkBtn.style.display = 'none';
      if (retryBtn) retryBtn.style.display = 'none';
      this.updateRecordedAudioControl();
      return;
    }

    if (this.state === 'REQUESTING_MIC') {
      this.setTimerEmphasis('none');
      if (nextBtn) {
        nextBtn.style.display = '';
        nextBtn.disabled = false;
        nextBtn.textContent = 'Next prompt';
      }
      if (recordBtn) {
        recordBtn.textContent = 'Waiting for Mic...';
        recordBtn.disabled = true;
        recordBtn.style.display = '';
      }
      if (statusMsg) statusMsg.textContent = 'Requesting microphone access...';
      if (resultBox) resultBox.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'none';
      if (checkBtn) checkBtn.style.display = 'none';
      if (retryBtn) retryBtn.style.display = 'none';
      this.updateRecordedAudioControl();
      return;
    }

    if (this.state === 'STOPPING_RECORDING') {
      this.setTimerEmphasis('none');
      if (nextBtn) nextBtn.style.display = 'none';
      if (recordBtn) recordBtn.style.display = 'none';
      if (statusMsg) statusMsg.textContent = 'Finishing recording...';
      if (resultBox) resultBox.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'none';
      if (checkBtn) checkBtn.style.display = 'none';
      if (retryBtn) retryBtn.style.display = 'none';
      this.updateRecordedAudioControl();
      return;
    }

    if (this.state === 'RECORDED') {
      this.setTimerEmphasis('none');
      if (nextBtn) {
        nextBtn.style.display = '';
        nextBtn.disabled = false;
        nextBtn.textContent = 'Next prompt';
      }
      if (recordBtn) recordBtn.style.display = 'none';
      if (statusMsg) statusMsg.textContent = 'Recording captured. Click Check to submit or Retry to record again.';
      if (resultBox) resultBox.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'none';
      if (checkBtn) {
        checkBtn.style.display = 'inline-flex';
        checkBtn.disabled = false;
        checkBtn.textContent = 'Check';
      }
      if (retryBtn) {
        retryBtn.style.display = 'inline-flex';
        retryBtn.disabled = false;
      }
      this.updateRecordedAudioControl();
      return;
    }

    if (this.state === 'RESULTS') {
      this.setTimerEmphasis('none');
      if (nextBtn) nextBtn.style.display = 'none';
      if (recordBtn) {
        recordBtn.textContent = 'Next prompt';
        recordBtn.disabled = false;
        recordBtn.style.display = '';
      }
      if (statusMsg) {
        statusMsg.textContent = this.assessmentStatusMessage
          || (this.hasAssessmentResult ? 'Analysis complete.' : 'Analysis failed.');
      }
      if (resultBox) resultBox.style.display = this.hasAssessmentResult ? 'block' : 'none';
      if (stopBtn) stopBtn.style.display = 'none';
      if (checkBtn) checkBtn.style.display = 'none';
      if (retryBtn) retryBtn.style.display = 'inline-flex';
      this.updateRecordedAudioControl();
      return;
    }

    this.setTimerEmphasis('none');
    if (nextBtn) nextBtn.style.display = 'none';
    if (recordBtn) {
      recordBtn.textContent = 'Next prompt';
      recordBtn.disabled = false;
      recordBtn.style.display = '';
    }
    if (statusMsg) statusMsg.textContent = 'Processing...';
    if (resultBox) resultBox.style.display = this.hasAssessmentResult ? 'block' : 'none';
    if (stopBtn) stopBtn.style.display = 'none';
    if (checkBtn) checkBtn.style.display = 'none';
    if (retryBtn) retryBtn.style.display = 'inline-flex';
    this.updateRecordedAudioControl();
  }

  /**
   * The basic-mode instruction used to read "Read the text aloud into your microphone…"
   * in every phase — including Prep, where the status line directly below the passage
   * says "Read the text silently to prepare." Both were on screen at once, telling the
   * learner to do opposite things. The instruction now follows the phase.
   */
  /**
   * Exactly one timer is live at a time, but both used to render at 2rem with the
   * inactive one merely dimmed — two big countdowns competing before the learner
   * had done anything. The idle timer collapses to a small label instead.
   */
  setTimerEmphasis(active) {
    const boxes = {
      prep: document.getElementById('ra-prep-timer-box'),
      record: document.getElementById('ra-record-timer-box')
    };
    Object.entries(boxes).forEach(([key, box]) => {
      if (!box) return;
      const isActive = key === active;
      box.dataset.timerState = isActive ? 'active' : 'idle';
      // Kept for anything still reading inline opacity; the data attribute drives styling.
      box.style.opacity = isActive ? '1' : '';
    });
  }

  getBasicPhaseInstruction() {
    // Basic now shows the linking and reduced-word marks, so the instruction has
    // to account for them — otherwise the learner sees curves and shading under
    // the text with nothing telling them what to do about it.
    if (this.state === 'PREP') {
      return 'Read silently and plan your phrasing. The curves show words that run together; shaded words are said lightly. Recording starts when the prep timer ends.';
    }
    return 'Read the text aloud into your microphone. Run the joined words together and keep the shaded words light and quick.';
  }

  startPrepTimer() {
    this.stopTimer();
    let timeLeft = this.prepSeconds;
    this.updateTimerDisplay('ra-prep-time', timeLeft);

    // A blocking tutorial covers the prompt, so a countdown running behind it spends the
    // learner's prep on reading the tutorial. Measured before this guard: prep fell
    // 00:32 -> 00:22 over ten seconds with the overlay confirmed open.
    //
    // The tutorial auto-start is deferred (tutorial.js queueAutoStart), so it usually
    // opens AFTER the countdown has begun — hold on tutorial:start and resume from the
    // same remaining time on tutorial:end.
    const tick = () => {
      this.timerInterval = setInterval(() => {
        timeLeft -= 1;
        if (timeLeft < 0) {
          this.stopTimer();
          this.startRecording();
        } else {
          this.updateTimerDisplay('ra-prep-time', timeLeft);
        }
      }, 1000);
    };

    this.prepTutorialHold = {
      onStart: () => {
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
      },
      onEnd: () => {
        if (this.isActive && this.state === 'PREP' && !this.timerInterval) tick();
      }
    };
    window.addEventListener('tutorial:start', this.prepTutorialHold.onStart);
    window.addEventListener('tutorial:end', this.prepTutorialHold.onEnd);

    if (!window.isTutorialActive) tick();
  }

  async startRecording() {
    this.cleanup();
    this.resetAssessmentDisplay();
    const recordingSession = {
      id: this.recordingRequestId + 1,
      disposition: 'submit',
      promptToken: this.promptLifecycleToken,
      referenceText: this.currentPromptPlainText,
      questionId: this.currentQuestionId || null,
      phase: 'requesting-mic',
      sessionViewMode: this.getEffectiveViewMode(),
      sessionChunkingEnabled: !!this.chunkingEnabled,
      sessionConnectedSpeechModes: Object.freeze(this.getActiveConnectedSpeechModes()),
      sessionConnectedSpeechLevel: this.connectedSpeechLevel || 'off'
    };
    this.recordingRequestId = recordingSession.id;
    this.currentRecordingSession = recordingSession;
    this.state = 'REQUESTING_MIC';
    this.updateUIForState();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const shouldContinue = this.isSameRecordingSession(recordingSession)
        && this.isActive
        && recordingSession.disposition === 'submit'
        && recordingSession.promptToken === this.promptLifecycleToken
        && recordingSession.referenceText === this.currentPromptPlainText;
      if (!shouldContinue) {
        this.stopTracks(stream);
        return;
      }

      const recordedChunks = [];
      const activeRecorder = new window.MediaRecorder(stream);
      let resolveCapture;
      recordingSession.capturePromise = new Promise(resolve => { resolveCapture = resolve; });
      activeRecorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) recordedChunks.push(event.data);
      });
      activeRecorder.addEventListener('stop', async () => {
        const shouldSubmit = this.currentRecordingSession === recordingSession && recordingSession.disposition === 'submit';
        if (this.currentRecordingSession === recordingSession) {
          this.currentRecordingSession = null;
        }
        if (this.mediaRecorder === activeRecorder) {
          this.mediaRecorder = null;
        }
        if (!shouldSubmit) {
          resolveCapture();
          return;
        }
        if (recordedChunks.length === 0) {
          this.applyRecordingCaptureFailure(recordingSession, 'We couldn’t capture that recording. Please try again.');
          resolveCapture();
          return;
        }
        const rawBlob = new Blob(recordedChunks, { type: activeRecorder.mimeType || 'audio/webm' });
        recordingSession.rawBlob = rawBlob;
        let playbackBlob = rawBlob;
        if (this.isPteShellEnabled()) {
          try {
            let preparedAudioBuffer = null;
            playbackBlob = await this.prepareWavBlob(rawBlob, (audioBuffer) => {
              preparedAudioBuffer = audioBuffer;
            });
            if (recordingSession.id !== this.recordingRequestId || !this.shouldApplyAssessment(recordingSession)) { resolveCapture(); return; }
            recordingSession.wavBlob = playbackBlob;
            recordingSession.assessmentAudioBuffer = preparedAudioBuffer;
            recordingSession.durationMs = Math.round((preparedAudioBuffer?.duration || 0) * 1000);
            this.assessmentAudioBuffer = preparedAudioBuffer;
          } catch (error) {
            if (recordingSession.id !== this.recordingRequestId) { resolveCapture(); return; }
            this.applyRecordingCaptureFailure(recordingSession, 'We couldn’t prepare that recording. Please try again.');
            resolveCapture(); return;
          }
        }
        this.setRecordedAudio(playbackBlob, { preserveAssessmentBuffer: this.isPteShellEnabled() });

        this.pendingBlob = rawBlob;
        this.pendingSession = recordingSession;
        this.state = 'RECORDED';
        this.updateUIForState();
        resolveCapture();
        if (this.isPteShellEnabled()) {
          this.savePteCapture(recordingSession).catch(error => {
            if (!this.shouldApplyAssessment(recordingSession)) return;
            const status = this.pteView?.panel.querySelector('.pte-dock__status');
            if (status) status.textContent = `Recording captured, but saving failed: ${error.message}`;
          });
        }
      });
      activeRecorder.start();
      if (!this.isSameRecordingSession(recordingSession)) {
        this.stopTracks(stream);
        if (activeRecorder.state === 'recording') {
          activeRecorder.stop();
        }
        return;
      }

      this.audioStream = stream;
      this.mediaRecorder = activeRecorder;
      recordingSession.phase = 'recording';
      this.state = 'RECORDING';
      this.updateUIForState();

      let timeLeft = this.recordSeconds;
      this.updateTimerDisplay('ra-record-time', timeLeft);
      this.timerInterval = setInterval(() => {
        timeLeft -= 1;
        if (timeLeft < 0) {
          this.stopTimer();
          this.handleRecordClick();
        } else {
          this.updateTimerDisplay('ra-record-time', timeLeft);
        }
      }, 1000);
    } catch (error) {
      console.error('Microphone access failed:', error);
      if (!this.isSameRecordingSession(recordingSession)) {
        return;
      }
      this.currentRecordingSession = null;
      this.mediaRecorder = null;
      this.stopMediaStream();
      this.handleMicrophoneAccessError(error);
    }
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    // Detach the tutorial pause/resume listeners, so leaving the mode cannot resurrect a
    // countdown once the tutorial finally closes.
    if (this.prepTutorialHold) {
      window.removeEventListener('tutorial:start', this.prepTutorialHold.onStart);
      window.removeEventListener('tutorial:end', this.prepTutorialHold.onEnd);
      this.prepTutorialHold = null;
    }
  }

  updateTimerDisplay(elementId, seconds) {
    if (this.pteRecorder) {
      if (elementId === 'ra-prep-time' && this.state === 'PREP') this.pteRecorder.tick(seconds);
      if (elementId === 'ra-record-time' && this.state === 'RECORDING') this.pteRecorder.setElapsed(this.recordSeconds - seconds);
    }
    const el = document.getElementById(elementId);
    if (!el) return;
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
    el.textContent = `${minutes}:${remainingSeconds}`;
  }

  handleRecordClick() {
    if (this.state === 'PREP') {
      if (!this.getRecordingSupportState().supported) {
        this.applyUnsupportedState();
        return;
      }
      this.startRecording();
      return;
    }

    if (this.state === 'REQUESTING_MIC') {
      return;
    }

    if (this.state === 'RECORDING') {
      this.stopTimer();
      this.state = 'STOPPING_RECORDING';
      this.updateUIForState();

      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      }
      this.stopMediaStream();
      return;
    }

    if (this.state === 'RESULTS') {
      this.loadNextPrompt();
    }
  }

  stopRecordingManually() {
    if (this.state !== 'RECORDING') return;
    this.stopTimer();
    this.state = 'STOPPING_RECORDING';
    this.updateUIForState();

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    this.stopMediaStream();

    this.stopReferenceAudioPlayback();
  }

  cancelRecording() {
    if (!['REQUESTING_MIC', 'RECORDING', 'STOPPING_RECORDING'].includes(this.state)) return;
    this.cleanup();
    this.pendingBlob = null; this.pendingSession = null;
    this.retryCurrentPrompt();
  }

  async finishPteRecordingForNext() {
    if (this.state === 'REQUESTING_MIC') throw new Error('Wait for microphone access or cancel the recording.');
    const session = this.currentRecordingSession || this.pendingSession;
    if (!session) throw new Error('There is no recording to save yet.');
    const ownership = this.createPteNextOwnership(session);
    this.pendingPteNextOwnership = ownership;
    this.stopRecordingManually();
    await session.capturePromise;
    if (!this.shouldApplyPteNextOwnership(ownership)) return false;
    if (!session.wavBlob) throw new Error('The recording could not be captured. Please try again.');
    await this.savePteCapture(session);
    return this.shouldApplyPteNextOwnership(ownership);
  }

  async advancePtePrompt() {
    const ownership = this.pendingPteNextOwnership || this.createPteNextOwnership(this.pendingSession);
    this.pendingPteNextOwnership = null;
    if (!this.shouldApplyPteNextOwnership(ownership)) return false;
    if (ownership.session) await this.savePteCapture(ownership.session);
    if (!this.shouldApplyPteNextOwnership(ownership)) return false;
    return this.loadNextPrompt({ force: true });
  }

  createPteNextOwnership(session = null) {
    return {
      session,
      promptToken: this.promptLifecycleToken,
      questionId: this.currentQuestionId,
      referenceText: this.currentPromptPlainText
    };
  }

  shouldApplyPteNextOwnership(ownership) {
    if (!ownership || !this.isActive
      || ownership.promptToken !== this.promptLifecycleToken
      || ownership.questionId !== this.currentQuestionId
      || ownership.referenceText !== this.currentPromptPlainText) {
      return false;
    }
    if (!ownership.session) return true;
    return this.shouldApplyAssessment(ownership.session)
      && (this.pendingSession === ownership.session || this.currentRecordingSession === ownership.session);
  }

  savePteCapture(session) {
    if (session.archivePromise) return session.archivePromise;
    session.archivePromise = (async () => {
      const blob = session.wavBlob;
      if (!blob) throw new Error('Finish recording before moving on.');
      const input = {
        practiceMode: 'read-aloud',
        attemptId: session.archiveCandidateId ||= `att_ra_${Date.now()}_${session.id}`,
        promptSnapshot: { promptId: session.questionId, text: session.referenceText, source: 'read-aloud' },
        responseSnapshot: { referenceText: session.referenceText },
        scoringSnapshot: { source: 'none', success: false, status: 'unassessed' },
        media: [{ slot: 'student', label: 'Student read aloud', blob, contentType: blob.type, durationMs: session.durationMs }]
      };
      if (!window.PTEAttemptArchive?.saveAttempt) throw new Error('Attempt saving is unavailable. Please try again.');
      const saved = await window.PTEAttemptArchive.saveAttempt(input);
      if (saved?.skipped && saved.reason !== 'guest') throw new Error('This attempt could not be saved.');
      if (saved?.skipped) {
        session.localAttemptId ||= `ra-${Date.now()}-${session.id}`;
        session.historyAudioUrl ||= URL.createObjectURL(blob);
        window.PteAttemptHistory?.recordLocal({ ...input, media: undefined, attemptId: session.localAttemptId, promptId: session.questionId,
          audio: { studentUrl: session.historyAudioUrl, durationMs: session.durationMs } });
      } else session.archiveAttemptId = saved?.attemptId || input.attemptId;
      return saved;
    })().catch(error => { session.archivePromise = null; throw error; });
    return session.archivePromise;
  }

  async submitToAzure(rawBlob, recordingSession) {
    if (!this.shouldApplyAssessment(recordingSession)) return false;
    if (this.isSubmitInFlight) return false;
    this.isSubmitInFlight = true;
    const assessmentAbortController = typeof AbortController === 'function'
      ? new AbortController()
      : null;
    recordingSession.assessmentAbortController = assessmentAbortController;
    const statusMsg = document.getElementById('ra-status-message');
    try {
      if (statusMsg) statusMsg.textContent = 'Formatting audio...';
      let preparedAudioBuffer = null;
      const wavBlob = await this.prepareWavBlob(rawBlob, (audioBuffer) => {
        preparedAudioBuffer = audioBuffer;
      });
      if (!this.shouldApplyAssessment(recordingSession)) return false;
      recordingSession.wavBlob = wavBlob;
      recordingSession.assessmentAudioBuffer = preparedAudioBuffer;
      this.assessmentAudioBuffer = preparedAudioBuffer;
      if (preparedAudioBuffer) {
        this.setRecordedAudio(wavBlob, { preserveAssessmentBuffer: true });
      }

      if (statusMsg) statusMsg.textContent = 'Analyzing pronunciation...';
      const formData = new FormData();
      formData.append('audio', wavBlob, 'recording.wav');
      formData.append('referenceText', recordingSession.referenceText);
      if (recordingSession.questionId) {
        formData.append('questionId', recordingSession.questionId);
      }
      this.lastAssessmentRequest = {
        questionId: recordingSession.questionId || null,
        referenceText: recordingSession.referenceText,
        fieldNames: Array.from(formData.keys())
      };

      const response = await fetch('/api/read-aloud/assess', {
        method: 'POST',
        body: formData,
        ...(assessmentAbortController ? { signal: assessmentAbortController.signal } : {})
      });

      const payload = await response.json().catch(() => null);
      if (!this.shouldApplyAssessment(recordingSession)) return false;
      if (!response.ok || !payload?.success) {
        const error = new Error(payload?.message || 'Assessment failed.');
        error.code = payload?.error || null;
        error.reason = payload?.details?.reason || null;
        error.details = payload?.details || null;
        throw error;
      }
      if (this.isUnusableZeroScoreAssessment(payload)) {
        const error = new Error('Pronunciation scores were unavailable for this recording.');
        error.code = 'AZURE_ASSESSMENT_FAILED';
        error.reason = 'scores_unavailable';
        error.details = { scorePattern: 'all_zero' };
        throw error;
      }

      return await this.processAzureResults(payload, recordingSession);
    } catch (err) {
      if (!this.shouldApplyAssessment(recordingSession)) return false;
      console.error('Azure assessment error:', err);
      let failureStatus;
      if (err?.code === 'INVALID_AUDIO' && err?.reason === 'too_long') {
        failureStatus = 'That recording was too long to score. Keep it under 40 seconds and try again.';
      } else if (err?.code === 'INVALID_AUDIO' && err?.reason === 'no_speech') {
        failureStatus = 'No speech was detected. Please check your microphone and try again.';
      } else if (err?.code === 'INVALID_AUDIO' && err?.reason === 'too_short') {
        failureStatus = 'That recording was too short. Please try again.';
      } else if (err?.code === 'INVALID_AUDIO' && err?.reason === 'clipped') {
        failureStatus = 'Your audio is too loud or clipped. Please adjust your microphone volume.';
      } else if (err?.code === 'AZURE_ASSESSMENT_FAILED' && err?.reason === 'scores_unavailable') {
        failureStatus = 'We captured the transcript, but pronunciation scoring was unavailable. Keep it under 40 seconds and try again.';
      } else if (err?.code === 'INVALID_AUDIO') {
        failureStatus = 'We couldn’t read that recording. Please try again.';
      } else {
        failureStatus = 'Assessment failed. Please try again.';
      }
      const fallbackText = err?.code === 'INVALID_AUDIO' && err?.reason === 'too_long'
        ? 'That recording was too long for the current scorer. Try keeping it under 40 seconds.'
        : err?.code === 'INVALID_AUDIO' && err?.reason === 'no_speech'
          ? 'We did not detect any speech in your recording. Please ensure your microphone is working.'
          : err?.code === 'INVALID_AUDIO' && err?.reason === 'too_short'
            ? 'Your recording was too short. Please try to speak clearly and fully.'
            : err?.code === 'INVALID_AUDIO' && err?.reason === 'clipped'
              ? 'Your audio signal was clipped or too loud. Try adjusting your input volume.'
              : err?.code === 'AZURE_ASSESSMENT_FAILED' && err?.reason === 'scores_unavailable'
                ? 'Your speech was transcribed, but pronunciation scores were not returned for this attempt.'
                : 'We could not score this attempt.';
      this.renderAssessmentFailure(failureStatus, fallbackText);
      return false;
    } finally {
      if (recordingSession.assessmentAbortController === assessmentAbortController) {
        recordingSession.assessmentAbortController = null;
      }
      if (recordingSession.id === this.recordingRequestId) {
        this.isSubmitInFlight = false;
      }
    }
  }

  async prepareWavBlob(blob, captureAudioBuffer = null) {
    if (window.AudioDspPipeline && typeof window.AudioDspPipeline.enhance === 'function') {
      const result = await window.AudioDspPipeline.enhance(blob, {
        targetSampleRate: 16000,
        highpassFreq: 80,
        targetPeakDb: -3,
        trim: true,
        paddingMs: 150,
        createUrl: false
      });

      if (!result.audioBuffer) {
        throw new Error('Audio enhancement failed to produce a valid buffer');
      }

      const quality = this.validateAudioBufferQuality(result.audioBuffer);
      if (!quality.passed) {
        const error = new Error('Audio quality validation failed');
        error.code = 'INVALID_AUDIO';
        error.reason = quality.reason;
        throw error;
      }

      if (typeof captureAudioBuffer === 'function') captureAudioBuffer(result.audioBuffer);
      return result.wavBlob;
    }

    const arrayBuffer = await blob.arrayBuffer();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('AudioContext is not supported.');
    const audioContext = new AudioContextCtor();
    let rendered;

    try {
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));

      const outputLength = Math.ceil(decoded.duration * 16000);
      const offline = new OfflineAudioContext(1, outputLength, 16000);

      // DSP chain: source → 80 Hz high-pass filter → destination
      const source = offline.createBufferSource();
      source.buffer = decoded;

      const highpass = offline.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 80;
      highpass.Q.value = 0.707; // Butterworth (maximally flat passband)

      source.connect(highpass);
      highpass.connect(offline.destination);
      source.start(0);

      // iOS Safari can suspend OfflineAudioContext when the screen locks.
      // Apply a 3-second timeout fallback: skip DSP and use a basic resample.
      try {
        rendered = await Promise.race([
          offline.startRendering(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('OfflineAudioContext timeout')), 3000)
          )
        ]);
      } catch (timeoutErr) {
        // Fallback: basic resample without DSP enhancements
        console.warn('[ReadAloud] OfflineAudioContext timed out, falling back to basic resample:', timeoutErr.message);
        const fallbackOffline = new OfflineAudioContext(1, outputLength, 16000);
        const fallbackSource = fallbackOffline.createBufferSource();
        fallbackSource.buffer = decoded;
        fallbackSource.connect(fallbackOffline.destination);
        fallbackSource.start(0);
        rendered = await Promise.race([
          fallbackOffline.startRendering(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Fallback timeout')), 3000))
        ]).catch(() => decoded);
      }
    } finally {
      if (typeof audioContext.close === 'function') await audioContext.close().catch(() => { });
    }

    // Peak normalization to -3 dBFS (target peak at ~70.8% of full scale)
    const channelData = rendered.getChannelData(0);
    let maxPeak = 0;
    for (let i = 0; i < channelData.length; i++) {
      const absVal = Math.abs(channelData[i]);
      if (absVal > maxPeak) maxPeak = absVal;
    }
    if (maxPeak > 0) {
      const targetPeak = Math.pow(10, -3 / 20); // ~0.7079
      const gain = targetPeak / maxPeak;
      if (gain < 0.99 || gain > 1.01) {
        for (let i = 0; i < channelData.length; i++) {
          channelData[i] = Math.max(-1, Math.min(1, channelData[i] * gain));
        }
      }
    }

    // Leading/trailing silence trimming (preserve inter-word pauses)
    const trimmed = this.trimSilence(rendered, 150);

    const quality = this.validateAudioBufferQuality(trimmed);
    if (!quality.passed) {
      const error = new Error('Audio quality validation failed');
      error.code = 'INVALID_AUDIO';
      error.reason = quality.reason;
      throw error;
    }

    if (typeof captureAudioBuffer === 'function') captureAudioBuffer(trimmed);
    return this.audioBufferToWav(trimmed);
  }

  /**
   * Detects speech boundaries using frame-based RMS energy thresholding.
   * Returns { firstSampleIndex, lastSampleIndex, speechDurationMs, frameRms, maxRms, threshold }
   * or null if no speech is detected.
   */
  detectSpeechBoundaries(channelData, sampleRate) {
    if (window.AudioDspPipeline && typeof window.AudioDspPipeline.detectSpeechBoundaries === 'function') {
      return window.AudioDspPipeline.detectSpeechBoundaries(channelData, sampleRate);
    }
    const totalSamples = channelData.length;
    const frameSize = Math.max(1, Math.round(sampleRate * 0.01)); // 10ms frames
    const frameDurationMs = (frameSize / sampleRate) * 1000;
    const frameRms = [];

    for (let offset = 0; offset < totalSamples; offset += frameSize) {
      const end = Math.min(totalSamples, offset + frameSize);
      let energy = 0;
      for (let i = offset; i < end; i++) {
        const val = channelData[i];
        energy += val * val;
      }
      frameRms.push(Math.sqrt(energy / Math.max(1, end - offset)));
    }

    const maxRms = frameRms.reduce((highest, val) => Math.max(highest, val), 0);
    const minimumFrameRms = 0.01;
    if (maxRms < minimumFrameRms) return null;

    const minimumFrameThreshold = 0.008;
    const frameRmsFraction = 0.18;
    const threshold = Math.max(minimumFrameThreshold, maxRms * frameRmsFraction);

    let firstSpeechFrame = -1;
    let lastSpeechFrame = -1;
    let speechFrameCount = 0;

    for (let i = 0; i < frameRms.length; i++) {
      if (frameRms[i] >= threshold) {
        speechFrameCount++;
        if (firstSpeechFrame === -1) firstSpeechFrame = i;
        lastSpeechFrame = i;
      }
    }

    if (firstSpeechFrame === -1 || lastSpeechFrame === -1) return null;

    const firstSampleIndex = firstSpeechFrame * frameSize;
    const lastSampleIndex = Math.min(totalSamples - 1, (lastSpeechFrame + 1) * frameSize - 1);
    const speechDurationMs = Math.round((lastSpeechFrame - firstSpeechFrame + 1) * frameDurationMs);

    return { firstSampleIndex, lastSampleIndex, speechDurationMs, speechFrameCount, frameRms, maxRms, threshold };
  }

  /**
   * Trims leading and trailing silence from an AudioBuffer, preserving inter-word pauses.
   * Adds paddingMs of silence padding on both sides to avoid cutting breath/onset transients.
   * Returns the original buffer unchanged if no speech boundaries are detected or if
   * trimming would remove less than 10% of the total duration.
   */
  trimSilence(audioBuffer, paddingMs = 150) {
    if (window.AudioDspPipeline && typeof window.AudioDspPipeline.trimSilence === 'function') {
      return window.AudioDspPipeline.trimSilence(audioBuffer, { paddingMs });
    }
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const boundaries = this.detectSpeechBoundaries(channelData, sampleRate);

    if (!boundaries) return audioBuffer;

    const paddingSamples = Math.round((paddingMs / 1000) * sampleRate);
    const trimStart = Math.max(0, boundaries.firstSampleIndex - paddingSamples);
    const trimEnd = Math.min(channelData.length, boundaries.lastSampleIndex + 1 + paddingSamples);
    const trimmedLength = trimEnd - trimStart;

    // Skip trimming if it would remove less than 10% of total samples (not worth the overhead)
    if (trimmedLength <= 0 || trimmedLength >= channelData.length * 0.9) return audioBuffer;

    let trimmedBuffer = null;
    if (typeof AudioBuffer === 'function') {
      try {
        trimmedBuffer = new AudioBuffer({ numberOfChannels: 1, length: trimmedLength, sampleRate });
      } catch (_) {
        trimmedBuffer = null;
      }
    }
    if (!trimmedBuffer) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return audioBuffer;
      const tmpCtx = new AudioContextCtor();
      try {
        trimmedBuffer = tmpCtx.createBuffer(1, trimmedLength, sampleRate);
      } finally {
        if (typeof tmpCtx.close === 'function') tmpCtx.close().catch(() => {});
      }
    }
    const trimmedData = trimmedBuffer.getChannelData(0);
    for (let i = 0; i < trimmedLength; i++) {
      trimmedData[i] = channelData[trimStart + i];
    }
    return trimmedBuffer;
  }

  validateAudioBufferQuality(audioBuffer) {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;

    const minimumPeakAmplitude = 320 / 32768;
    let maxAbs = 0;
    let clippedSamples = 0;

    for (let i = 0; i < totalSamples; i++) {
      const absVal = Math.abs(channelData[i]);
      if (absVal >= 32760 / 32768) clippedSamples++;
      if (absVal > maxAbs) maxAbs = absVal;
    }

    if (maxAbs < minimumPeakAmplitude) {
      return { passed: false, reason: 'no_speech' };
    }

    // Delegate speech boundary detection to the shared helper
    const boundaries = this.detectSpeechBoundaries(channelData, sampleRate);

    if (!boundaries) {
      return { passed: false, reason: 'no_speech' };
    }

    const clippedRatio = clippedSamples / totalSamples;

    if (boundaries.speechDurationMs < 250) {
      return { passed: false, reason: 'too_short' };
    }

    if (boundaries.speechDurationMs > 40000) {
      return { passed: false, reason: 'too_long' };
    }

    if (clippedRatio >= 0.005) {
      return { passed: false, reason: 'clipped' };
    }

    return { passed: true };
  }

  audioBufferToWav(buffer) {
    const channelData = buffer.getChannelData(0);
    const dataLength = channelData.length;
    const wavBuffer = new ArrayBuffer(44 + dataLength * 2);
    const view = new DataView(wavBuffer);
    const writeString = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength * 2, true);
    let offset = 44;
    for (let i = 0; i < dataLength; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  shouldApplyAssessment(recordingSession) {
    return !!recordingSession
      && this.isActive
      && recordingSession.disposition === 'submit'
      && recordingSession.id === this.recordingRequestId
      && recordingSession.promptToken === this.promptLifecycleToken
      && recordingSession.referenceText === this.currentPromptPlainText;
  }

  isUnusableZeroScoreAssessment(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const hasFiniteMetricValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    const finiteScores = [
      payload.accuracyScore,
      payload.fluencyScore,
      payload.completenessScore,
      payload.pronScore,
      ...(Array.isArray(payload.words) ? payload.words.map((word) => word?.accuracyScore) : [])
    ]
      .filter((score) => hasFiniteMetricValue(score))
      .map((score) => Number(score));
    if (finiteScores.length === 0) return false;
    const hasTranscriptEvidence = !!String(payload.recognizedText || '').trim()
      || (Array.isArray(payload.words) && payload.words.length > 0);
    return hasTranscriptEvidence && finiteScores.every((score) => score === 0);
  }

  async processAzureResults(payload, recordingSession) {
    if (!this.shouldApplyAssessment(recordingSession)) return false;
    const accuracyElement = document.getElementById('ra-accuracy-value');
    const feedbackElement = document.getElementById('ra-transcript-feedback');
    const assessmentModes = this.getAssessmentConnectedSpeechModes({}, recordingSession);
    const assessmentEvents = this.filterSpeechCoachEvents(payload.connectedSpeech?.events || [], assessmentModes);

    this.showAssessmentDisplay();
    this.setAssessmentStatusMessage('Analysis complete.');
    if (accuracyElement) accuracyElement.textContent = payload.accuracyScore.toString();

    if (feedbackElement) {
      this.renderRecognizedTranscript(
        payload.words || [],
        payload.recognizedText || '',
        assessmentEvents,
        {
          fluencyScore: payload.fluencyScore,
          completenessScore: payload.completenessScore,
          pronScore: payload.pronScore
        }
      );
    }

    this.lastAssessmentPayload = payload;
    this.lastAssessmentSession = recordingSession;

    const sessionView = recordingSession?.sessionViewMode || this.getEffectiveViewMode();
    const sessionLevel = recordingSession?.sessionConnectedSpeechLevel || this.connectedSpeechLevel;
    const showAdvContainer = document.getElementById('ra-show-advanced-container');
    const showAdvBtn = document.getElementById('ra-show-advanced-btn');

    // Basic used to hide the coach here and offer a button that revealed a panel.
    // It now renders the same findings in the simple tier, and the button switches
    // the learner to Advanced for IPA and the full scored breakdown.
    const isSimpleTier = sessionView === 'basic';
    if (showAdvContainer) {
      showAdvContainer.style.display = isSimpleTier && assessmentModes.size > 0 ? 'block' : 'none';
    }
    if (showAdvBtn && isSimpleTier) showAdvBtn.textContent = '✨ Show detailed analysis';
    {
      this.renderPromptForCurrentView();
      await this.renderConnectedSpeechResults(payload.connectedSpeech, {
        transcriptText: payload.recognizedText || this.currentPromptPlainText,
        words: payload.words || [],
        metrics: {
          fluencyScore: payload.fluencyScore,
          completenessScore: payload.completenessScore,
          pronScore: payload.pronScore
        },
        sessionViewMode: sessionView,
        sessionConnectedSpeechModes: [...assessmentModes],
        sessionConnectedSpeechLevel: sessionLevel
      });
    }
    if (!this.shouldApplyAssessment(recordingSession)) return false;

    const attemptInput = {
      practiceMode: 'read-aloud',
      promptSnapshot: {
        promptId: recordingSession.questionId || null,
        text: recordingSession.referenceText || this.currentPromptPlainText || '',
        source: 'read-aloud',
        data: {
          promptKey: this.activePromptKey || null,
          promptToken: recordingSession.promptToken || null
        }
      },
      responseSnapshot: {
        recognizedText: payload.recognizedText || '',
        referenceText: recordingSession.referenceText || ''
      },
      answerSnapshot: {
        referenceText: recordingSession.referenceText || '',
        words: payload.words || []
      },
      resultSnapshot: {
        accuracyScore: payload.accuracyScore,
        fluencyScore: payload.fluencyScore,
        completenessScore: payload.completenessScore,
        pronScore: payload.pronScore,
        connectedSpeech: payload.connectedSpeech || null
      },
      scoringSnapshot: {
        source: 'azure',
        success: true
      },
      scoringSource: 'azure',
      media: recordingSession.wavBlob ? [{
        slot: 'student',
        label: 'Student read aloud',
        blob: recordingSession.wavBlob,
        contentType: 'audio/wav'
      }] : []
    };
    if (this.isPteShellEnabled() && recordingSession.wavBlob) {
      try {
        await this.savePteCapture(recordingSession);
        if (!this.shouldApplyAssessment(recordingSession)) return false;
        if (recordingSession.archiveAttemptId) {
          if (!this.shouldApplyAssessment(recordingSession)) return false;
          await window.PTEAttemptArchive.patchAttempt(recordingSession.archiveAttemptId, attemptInput);
          if (!this.shouldApplyAssessment(recordingSession)) return false;
          window.PTEAttemptArchive.invalidateHistoryCache();
          window.dispatchEvent(new CustomEvent('pte-attempt-archive:saved', { detail: { attemptId: recordingSession.archiveAttemptId, practiceMode: 'read-aloud', promptId: recordingSession.questionId } }));
        } else {
          if (!this.shouldApplyAssessment(recordingSession)) return false;
          window.PteAttemptHistory?.recordLocal({ ...attemptInput, media: undefined, attemptId: recordingSession.localAttemptId, promptId: recordingSession.questionId,
            audio: { studentUrl: recordingSession.historyAudioUrl, durationMs: recordingSession.durationMs } });
        }
      } catch (error) {
        if (this.shouldApplyAssessment(recordingSession)) {
          console.warn('[PTE Archive] Read Aloud save failed:', error);
        }
      }
      if (!this.shouldApplyAssessment(recordingSession)) return false;
      this.syncPteShell();
    } else {
      window.PTEAttemptArchive?.saveAttempt?.(attemptInput).catch((error) => console.warn('[PTE Archive] Read Aloud save failed:', error));
    }
    return true;
  }

  clearConnectedSpeechResults() {
    this.lastRecognizedLinkingPairs = [];
    const overlay = document.querySelector('#ra-merged-recognized-transcript .ra-recognized-linking-overlay');
    if (overlay) overlay.replaceChildren();
    this.hideConnectedSpeechPanel();
  }

  beginSpeechCoachResultRender() {
    this.speechCoachResultRevision += 1;
    this.cancelPendingHydration();
    this.activePromptRenderToken += 1;
    this.stopSpeechCoachYoursAudio({ pause: true });
    this.stopSpeechCoachModelAudio();
    this.closeSpeechCoachModeTooltips();
    this.clearSpeechCoachHoverState();
    return this.speechCoachResultRevision;
  }

  isSpeechCoachResultRevisionCurrent(revision) {
    return revision === this.speechCoachResultRevision;
  }

  invalidateSpeechCoachResultRender() {
    this.speechCoachResultRevision += 1;
    this.closeSpeechCoachModeTooltips();
    this.clearSpeechCoachHoverState();
    this.stopSpeechCoachYoursAudio({ pause: true });
    return this.speechCoachResultRevision;
  }

  hideConnectedSpeechPanel({ invalidate = true } = {}) {
    const box = document.getElementById('ra-connected-speech-box');
    const label = document.getElementById('ra-connected-speech-label');
    const list = document.getElementById('ra-connected-speech-list');
    const meta = document.getElementById('ra-connected-speech-meta');
    const summary = document.getElementById('ra-connected-speech-summary');
    const paragraph = document.getElementById('ra-connected-speech-paragraph');
    if (invalidate) this.invalidateSpeechCoachResultRender();
    this.connectedSpeechPanelMode = 'hidden';
    this.currentGuideExplanationItems = [];
    this.currentGuideInteractionItems = new Map();
    this.selectedGuideItemId = null;
    this.currentGuideHasVisibleAssimilation = false;
    this.guideExplanationsExpanded = null;
    this.guideExplanationsToggled = false;
    this.clearSpeechCoachHoverState();
    this.setSpeechCoachModeHint('ra-feedback-mode-hint');
    this.setSpeechCoachModeHint('ra-connected-speech-mode-hint');
    if (box) box.style.display = 'none';
    if (paragraph) paragraph.innerHTML = '';
    if (label) label.textContent = 'Speech Coach';
    if (list) list.innerHTML = '';
    if (meta) meta.textContent = 'Preview';
    if (summary) summary.textContent = '';
  }

  /**
   * Basic now renders its own coach, so this button no longer reveals a hidden
   * panel — it promotes the learner to Advanced, where the same findings carry
   * IPA and the full scored breakdown. Switching the view re-renders through
   * handleViewChange, so there is nothing to render here.
   */
  async toggleAdvancedAnalysisView() {
    const box = document.getElementById('ra-connected-speech-box');
    const btn = document.getElementById('ra-show-advanced-btn');
    if (!box || !btn) return { visible: false, reason: 'missing_dom', revision: this.speechCoachResultRevision };

    if (this.getCoachTier() === 'simple') {
      try {
        window.SpeakingPracticeController?.setPreferredView?.('advanced');
      } catch (error) {
        console.error('[ReadAloud] Could not switch to advanced view:', error);
      }
      return { visible: true, reason: 'promoted_to_advanced', revision: this.speechCoachResultRevision };
    }

    const isHidden = box.style.display === 'none' || !box.style.display;
    if (isHidden) {
      const selectedModes = this.getAssessmentConnectedSpeechModes({}, this.lastAssessmentSession);
      if (selectedModes.size === 0) {
        this.hideConnectedSpeechPanel();
        this.updateSpeechCoachModeHints(selectedModes);
        btn.textContent = '✨ Show Advanced Analysis';
        return { visible: false, reason: 'no_modes', revision: this.speechCoachResultRevision };
      }

      if (!this.lastAssessmentPayload?.connectedSpeech) {
        return { visible: false, reason: 'missing_results', revision: this.speechCoachResultRevision };
      }
      const outcome = await this.renderConnectedSpeechResults(this.lastAssessmentPayload.connectedSpeech, {
        transcriptText: this.lastAssessmentPayload.recognizedText || this.currentPromptPlainText,
        sessionViewMode: 'advanced',
        sessionConnectedSpeechModes: this.lastAssessmentSession?.sessionConnectedSpeechModes,
        sessionConnectedSpeechLevel: this.lastAssessmentSession?.sessionConnectedSpeechLevel || 'off'
      });
      btn.textContent = outcome.visible ? 'Hide Advanced Analysis' : btn.textContent;
      if (outcome.visible) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return outcome;
    } else {
      this.hideConnectedSpeechPanel();
      btn.textContent = '✨ Show Advanced Analysis';
      return { visible: false, reason: 'hidden', revision: this.speechCoachResultRevision };
    }
  }

  toggleSpeechCoachVisibility() {
    this.speechCoachVisible = !this.speechCoachVisible;
    try { localStorage.setItem('ra-speech-coach-visible', String(this.speechCoachVisible)); } catch (_) { /* ignore */ }
    const box = document.getElementById('ra-connected-speech-box');
    const toggleBtn = document.getElementById('ra-speech-coach-toggle');
    const list = document.getElementById('ra-connected-speech-list');
    const summaryEl = document.getElementById('ra-connected-speech-summary');
    if (this.speechCoachVisible) {
      if (list) list.style.display = '';
      if (summaryEl) summaryEl.style.display = '';
    } else {
      if (list) list.style.display = 'none';
      if (summaryEl) summaryEl.style.display = 'none';
    }
    if (toggleBtn) {
      toggleBtn.textContent = this.speechCoachVisible ? '\ud83d\udc41 Hide' : '\ud83d\udc41 Show';
      toggleBtn.setAttribute('aria-expanded', this.speechCoachVisible ? 'true' : 'false');
    }
  }

  renderPromptGuideExplanations(analysis) {
    if (!window.ReadAloudLinking || typeof window.ReadAloudLinking.buildGuideExplanationItems !== 'function') {
      return;
    }

    const buildItems = window.ReadAloudLinking.buildGuideExplanationItems;
    // buildGuideExplanationItems intentionally caps/deduplicates the Coach
    // drawer. The passage renderer does not: it marks every eligible boundary
    // and weak-form token. Build each source item in isolation as well so every
    // rendered target retains complete popover metadata without expanding the
    // concise drawer summary.
    const completeItemsById = new Map();
    const collectCompleteItems = (scopedAnalysis) => {
      buildItems(scopedAnalysis).forEach((item) => {
        if (item?.id && !completeItemsById.has(item.id)) completeItemsById.set(item.id, item);
      });
    };
    collectCompleteItems(analysis);
    (Array.isArray(analysis?.boundaries) ? analysis.boundaries : []).forEach((boundary) => {
      collectCompleteItems({ ...analysis, boundaries: [boundary], tokenAnnotations: [] });
    });
    (Array.isArray(analysis?.tokenAnnotations) ? analysis.tokenAnnotations : []).forEach((annotation) => {
      collectCompleteItems({ ...analysis, boundaries: [], tokenAnnotations: [annotation] });
    });

    const rawItems = buildItems(analysis);
    if (!rawItems.length) {
      this.hideConnectedSpeechPanel();
      return;
    }

    const promptRecord = this.currentPromptFeatureRecord;
    const allowedCategoryMap = this.getConnectedSpeechPromptCategoryMap();
    const activeModes = this.getActiveConnectedSpeechModes();
    const allowedCategories = promptRecord
      ? new Set(Array.from(allowedCategoryMap.keys()).filter(Boolean))
      : null;
    if (allowedCategories) {
      activeModes.forEach((mode) => allowedCategories.add(mode));
    }
    if (promptRecord && allowedCategories.size === 0) {
      this.hideConnectedSpeechPanel();
      return;
    }
    const normalizeAllowedItem = (item) => {
      const itemCategory = this.normalizeConnectedSpeechMode(
        item?.category || item?.layer || item?.subtype || item?.badge || ''
      );
      if (allowedCategories && allowedCategories.size && !allowedCategories.has(itemCategory)) return null;
      return { ...item, category: itemCategory };
    };
    this.currentGuideInteractionItems = new Map();
    completeItemsById.forEach((item, id) => {
      const normalized = normalizeAllowedItem(item);
      if (normalized) this.currentGuideInteractionItems.set(id, normalized);
    });

    const seen = new Set();
    const items = [];
    for (const item of rawItems) {
      const normalized = normalizeAllowedItem(item);
      if (!normalized) continue;
      const key = `${item.label}|${item.spokenAs}|${item.badge}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push(normalized);
      }
    }

    if (!items.length) {
      this.hideConnectedSpeechPanel();
      return;
    }

    this.currentGuideExplanationItems = items;
    this.currentGuideHasVisibleAssimilation = typeof window.ReadAloudLinking.hasVisibleAssimilation === 'function'
      ? window.ReadAloudLinking.hasVisibleAssimilation(analysis)
      : items.some((item) => item.layer === 'assimilation');
    this.connectedSpeechPanelMode = 'guide';
    if (!this.selectedGuideItemId || !items.some((item) => item.id === this.selectedGuideItemId)) {
      this.selectedGuideItemId = items[0].id;
    }
    if (!this.guideExplanationsToggled) {
      this.guideExplanationsExpanded = !this.isCompactConnectedSpeechGuideLayout();
    }
    this.renderConnectedSpeechGuidePanel();
  }

  isCompactConnectedSpeechGuideLayout() {
    return (window.innerWidth || 0) < 940;
  }

  renderConnectedSpeechGuidePanel() {
    const box = document.getElementById('ra-connected-speech-box');
    const label = document.getElementById('ra-connected-speech-label');
    const list = document.getElementById('ra-connected-speech-list');
    const meta = document.getElementById('ra-connected-speech-meta');
    const summary = document.getElementById('ra-connected-speech-summary');
    if (!box || !label || !list || !meta || !summary) {
      return;
    }

    const items = Array.isArray(this.currentGuideExplanationItems) ? this.currentGuideExplanationItems : [];
    if (!items.length) {
      this.hideConnectedSpeechPanel();
      return;
    }
    const manifestQuestionId = String(this.currentQuestionId || '').trim();
    if (manifestQuestionId
      && !this.speechCoachAudioManifestCache.has(manifestQuestionId)
      && !this.speechCoachAudioManifestPromises.has(manifestQuestionId)) {
      void this.loadSpeechCoachAudioManifest(manifestQuestionId).then(() => {
        if (this.connectedSpeechPanelMode === 'guide'
          && String(this.currentQuestionId || '').trim() === manifestQuestionId) {
          this.renderConnectedSpeechGuidePanel();
        }
      });
    }
    const compactView = this.isCompactConnectedSpeechGuideLayout();
    if (!this.guideExplanationsToggled) {
      this.guideExplanationsExpanded = !compactView;
    }
    const showFullList = !compactView || this.guideExplanationsExpanded;
    const selectedItem = items.find((item) => item.id === this.selectedGuideItemId) || items[0];
    const noSoundChangeMessage = this.normalizeConnectedSpeechMode(this.connectedSpeechLevel) === 'sound_changes'
      && items.length > 0
      && !this.currentGuideHasVisibleAssimilation;

    const escapeHtml = ReadAloudMode.escapeHtml;
    // One class per connected-speech family. The palette used to be six hex
    // literals returned from here into inline style attributes, which put the
    // coach's colours out of reach of every stylesheet; they are now tokens
    // (--coach-*) applied through .sc-card--*.
    const layerClass = (layer) => {
      if (layer === 'assimilation') return 'sc-card--sound';
      if (layer === 'weak_forms') return 'sc-card--reduced';
      return 'sc-card--linking';
    };

    box.style.display = '';
    box.dataset.coachTier = this.getCoachTier();
    label.textContent = 'Speech Coach';
    meta.textContent = this.connectedSpeechPanelMode === 'results' ? 'Feedback' : 'Preview';
    const toggleBtn = document.getElementById('ra-speech-coach-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = this.speechCoachVisible ? '\ud83d\udc41 Hide' : '\ud83d\udc41 Show';
      toggleBtn.setAttribute('aria-expanded', this.speechCoachVisible ? 'true' : 'false');
    }
    summary.style.display = this.speechCoachVisible ? '' : 'none';
    // The compact layout already labels the selected card "START HERE"; repeating
    // it in the summary said the same thing twice in adjacent lines.
    summary.textContent = noSoundChangeMessage
      ? 'No sound changes in this sentence.'
      : `${items.length} pronunciation hint${items.length === 1 ? '' : 's'} in this prompt`;
    const isSimpleTier = this.getCoachTier() === 'simple';
    const renderGuideCard = (item, selected) => {
      // Model audio used to be gated to sound changes only, so a beginner facing a
      // reduced-word card had IPA and no way to hear it. Every family that resolves
      // a manifest clip gets one; everything else falls back to speech synthesis.
      const guideEvent = this.getSpeechCoachGuideEvent(item);
      const modelAudio = guideEvent
        ? this._buildSpeechCoachPlaybackControls(guideEvent, -1, false, 'Play the model example')
        : this._buildSpokenModelFallbackControl(item);

      // Plain language leads; IPA is a quiet secondary line and is dropped
      // entirely in the simple tier (see [data-coach-tier="simple"] in style.css).
      const sayItLike = item.sayItLike
        ? `<span class="sc-card-say"><span class="sc-card-say-label">Say it like</span> <strong>${escapeHtml(item.sayItLike)}</strong></span>`
        : '';
      const spokenAs = item.spokenAs
        ? `<span class="sc-card-ipa"><strong>${item.strongAs ? 'Strong:' : 'Try:'}</strong> ${item.strongAs ? `${escapeHtml(item.strongAs)} · <strong>Weak:</strong> ${escapeHtml(item.spokenAs)}` : escapeHtml(item.spokenAs)}</span>`
        : '';
      return `
        <div class="sc-guide-item sc-card ${layerClass(item.layer)}" data-guide-item="${escapeHtml(item.id)}" data-guide-category="${escapeHtml(item.category || '')}" data-start-word="${Number.isFinite(item.startWordIndex) ? item.startWordIndex : ''}" data-end-word="${Number.isFinite(item.endWordIndex) ? item.endWordIndex : ''}" data-selected="${selected ? 'true' : 'false'}">
          <button type="button" class="sc-card-body" data-guide-target="${escapeHtml(item.id)}" data-selected="${selected ? 'true' : 'false'}" aria-pressed="${selected ? 'true' : 'false'}">
            <span class="sc-card-head">
              <strong class="sc-card-word">${escapeHtml(item.label || 'Hint')}</strong>
              <span class="sc-card-badge">${escapeHtml(item.badge || 'Hint')}</span>
            </span>
            ${sayItLike}
            <span class="sc-card-tip">${escapeHtml((isSimpleTier && item.simpleExplanation) || item.explanation || '')}</span>
            ${spokenAs}
          </button>
          ${modelAudio ? `<div class="sc-card-audio">${modelAudio}</div>` : ''}
        </div>
      `;
    };
    const renderItemList = (itemList) => itemList.map((item) => renderGuideCard(item, item.id === this.selectedGuideItemId)).join('');
    const noSoundChangeHtml = noSoundChangeMessage
      ? `
        <div class="sc-empty-note" data-role="guide-no-sound-change">
          This sentence still has linking or reduced words, but no sound-change example.
        </div>
      `
      : '';
    if (compactView) {
      const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedItem.id));
      const compactCard = renderGuideCard(selectedItem, true);
      const toggleLabel = showFullList ? 'Hide' : 'See more';
      list.style.display = '';
      list.innerHTML = `
        <div class="sc-compact" data-role="guide-selected-summary">
          ${noSoundChangeHtml}
          <div class="sc-compact-counter">
            <span>Start here</span>
            <span>${selectedIndex + 1} of ${items.length}</span>
          </div>
          <div data-role="guide-selected-card">${compactCard}</div>
          <button type="button" class="sc-compact-toggle" data-role="guide-toggle-details" aria-expanded="${showFullList ? 'true' : 'false'}">${escapeHtml(toggleLabel)}</button>
        </div>
        <div class="sc-compact-expanded" data-role="guide-expanded-list" style="display:${showFullList ? '' : 'none'};">
          ${renderItemList(items)}
        </div>
      `;
    } else {
      list.style.display = '';
      list.innerHTML = `${noSoundChangeHtml}${renderItemList(items)}`;
    }
    // Applied after the render branches above, which both write to
    // list.style.display — before them the Hide toggle was overridden on every
    // re-render and the panel came back visible.
    if (!this.speechCoachVisible) list.style.display = 'none';
    this.bindGuideRailHover(list);
    this.syncGuideSelectionState();
    this.scrollSelectedGuideCardIntoView();
  }

  renderRecognizedTranscript(words = [], recognizedText = '', events = [], metrics = {}) {
    const feedbackElement = document.getElementById('ra-transcript-feedback');
    if (!feedbackElement) return null;

    const normalizedWords = Array.isArray(words) ? words : [];
    const normalizedEvents = Array.isArray(events) ? events : [];
    const cleanWord = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').trim();
    const eventIndexesByWord = normalizedWords.map(() => new Set());
    const linkingPairs = [];
    const reducedWordTokens = new Map();

    const classifyMode = (ev) => {
      if (ev?.coachMode) return ev.coachMode;
      if (window.ReadAloudSpeechCoach?.classifyEvent) {
        const res = window.ReadAloudSpeechCoach.classifyEvent(ev);
        if (res) return res;
      }
      const cat = String(ev?.category || ev?.family || ev?.layer || ev?.subtype || '').toLowerCase();
      if (cat.includes('linking') || cat.includes('consonant_to_vowel') || cat.includes('catenation')) return 'linking';
      if (cat.includes('reduced') || cat.includes('weak')) return 'reduced_words';
      if (cat.includes('sound_change') || cat.includes('assimilation')) return 'sound_changes';
      return null;
    };

    const assignEventRange = (eventIndex, startIndex, endIndex) => {
      const first = Math.max(0, Math.min(normalizedWords.length - 1, Number(startIndex)));
      const last = Math.max(first, Math.min(normalizedWords.length - 1, Number(endIndex)));
      if (!Number.isFinite(first) || !Number.isFinite(last) || normalizedWords.length === 0) return false;

      const event = normalizedEvents[eventIndex];
      const mode = classifyMode(event);
      const status = String(event?.status || 'uncertain').toLowerCase();

      if (mode === 'reduced_words') {
        const targetIndex = Number.isInteger(Number(event?.startWordIndex))
          ? Number(event.startWordIndex)
          : first;
        if (targetIndex >= 0 && targetIndex < normalizedWords.length) {
          eventIndexesByWord[targetIndex].add(eventIndex);
          reducedWordTokens.set(targetIndex, { status, eventIndex });
        } else {
          eventIndexesByWord[first].add(eventIndex);
          reducedWordTokens.set(first, { status, eventIndex });
        }
        return true;
      }

      for (let index = first; index <= last; index += 1) eventIndexesByWord[index].add(eventIndex);

      if (mode === 'linking') {
        const leftWord = normalizedWords[first];
        const rightWord = normalizedWords[last > first ? last : first + 1];
        const isLeftOmission = String(leftWord?.errorType || '').toLowerCase() === 'omission';
        const isRightOmission = String(rightWord?.errorType || '').toLowerCase() === 'omission';

        const effectiveStatus = (isLeftOmission || isRightOmission) && status === 'detected'
          ? 'not_detected'
          : status;
        const strokeColor = effectiveStatus === 'detected'
          ? '#10b981'
          : effectiveStatus === 'not_detected'
            ? '#ef4444'
            : '#f59e0b';

        // Do not draw linking arcs between pairs where BOTH words were completely omitted
        if (!(isLeftOmission && isRightOmission)) {
          if (last > first) {
            for (let i = first; i < last; i += 1) {
              const pairLeftOmission = String(normalizedWords[i]?.errorType || '').toLowerCase() === 'omission';
              const pairRightOmission = String(normalizedWords[i + 1]?.errorType || '').toLowerCase() === 'omission';
              if (pairLeftOmission && pairRightOmission) continue;
              const pairStatus = (pairLeftOmission || pairRightOmission) && status === 'detected' ? 'not_detected' : effectiveStatus;
              const pairStroke = pairStatus === 'detected' ? '#10b981' : pairStatus === 'not_detected' ? '#ef4444' : '#f59e0b';
              linkingPairs.push({ leftWordIndex: i, rightWordIndex: i + 1, status: pairStatus, strokeColor: pairStroke, eventIndex });
            }
          } else if (first + 1 < normalizedWords.length) {
            linkingPairs.push({ leftWordIndex: first, rightWordIndex: first + 1, status: effectiveStatus, strokeColor, eventIndex });
          }
        }
      }
      return true;
    };

    normalizedEvents.forEach((event, eventIndex) => {
      let assigned = false;
      const startWordIndex = Number(event?.startWordIndex ?? event?.wordIndex);
      const endWordIndex = Number(event?.endWordIndex ?? event?.wordIndex);
      if (Number.isInteger(startWordIndex)
        && Number.isInteger(endWordIndex)
        && startWordIndex >= 0
        && endWordIndex >= startWordIndex
        && startWordIndex < normalizedWords.length
        && endWordIndex >= 0) {
        assigned = assignEventRange(eventIndex, startWordIndex, endWordIndex);
      }

      if (!assigned) {
        const eventStart = Number(event?.startMs);
        const eventEnd = Number(event?.endMs);
        if (Number.isFinite(eventStart) && Number.isFinite(eventEnd) && eventEnd > eventStart) {
          let minIdx = Infinity;
          let maxIdx = -1;
          normalizedWords.forEach((word, wordIndex) => {
            const wordStart = Number(word?.startMs);
            const wordEnd = Number(word?.endMs);
            if (Number.isFinite(wordStart) && Number.isFinite(wordEnd)
              && wordEnd > eventStart && wordStart < eventEnd) {
              if (wordIndex < minIdx) minIdx = wordIndex;
              if (wordIndex > maxIdx) maxIdx = wordIndex;
            }
          });
          if (minIdx <= maxIdx) {
            assigned = assignEventRange(eventIndex, minIdx, maxIdx);
          }
        }
      }

      if (!assigned) {
        const phraseParts = String(event?.phrase || '').split(/\s+/).map(cleanWord).filter(Boolean);
        if (phraseParts.length > 0) {
          for (let start = 0; start <= normalizedWords.length - phraseParts.length; start += 1) {
            const matches = phraseParts.every((part, offset) => cleanWord(normalizedWords[start + offset]?.word) === part);
            if (matches) {
              assignEventRange(eventIndex, start, start + phraseParts.length - 1);
              break;
            }
          }
        }
      }
    });

    const dedupedPairsMap = new Map();
    linkingPairs.forEach((pair) => {
      const key = `${pair.leftWordIndex}-${pair.rightWordIndex}`;
      if (!dedupedPairsMap.has(key)) {
        dedupedPairsMap.set(key, pair);
      } else {
        const existing = dedupedPairsMap.get(key);
        if (pair.status === 'not_detected' || (pair.status === 'uncertain' && existing.status === 'detected')) {
          dedupedPairsMap.set(key, pair);
        }
      }
    });
    const finalLinkingPairs = Array.from(dedupedPairsMap.values());

    feedbackElement.replaceChildren();
    document.getElementById('ra-connected-speech-paragraph')?.replaceChildren();

    const shell = document.createElement('div');
    shell.className = 'ra-merged-transcript-shell';
    const heading = document.createElement('div');
    heading.className = 'ra-merged-transcript-heading';
    heading.textContent = 'Recognized';
    shell.appendChild(heading);

    const transcript = document.createElement('div');
    transcript.id = 'ra-merged-recognized-transcript';
    transcript.className = 'ra-merged-recognized-transcript';
    transcript.setAttribute('role', 'group');
    transcript.setAttribute('aria-label', 'Recognized speech with word accuracy');

    if (normalizedWords.length === 0) {
      transcript.textContent = String(recognizedText || '').trim() || 'No speech detected.';
      transcript.classList.add('ra-merged-recognized-transcript--empty');
    } else {
      normalizedWords.forEach((word, wordIndex) => {
        const errorType = String(word?.errorType || 'None');
        const normalizedErrorType = errorType.toLowerCase();
        const startMs = Number(word?.startMs);
        const endMs = Number(word?.endMs);
        const playable = normalizedErrorType !== 'omission'
          && Number.isFinite(startMs)
          && Number.isFinite(endMs)
          && endMs > startMs
          && this.hasPlayableRecordingSource();
        const token = document.createElement('button');
        token.type = 'button';
        token.className = 'ra-word-token';
        token.dataset.wordIndex = String(wordIndex);
        token.dataset.errorType = errorType;
        token.dataset.playable = playable ? 'true' : 'false';
        token.dataset.word = String(word?.word || '').trim();
        if (Number.isFinite(Number(word?.accuracyScore))) {
          token.dataset.accuracy = String(Math.round(Number(word.accuracyScore)));
        }
        if (Array.isArray(word?.syllables) && word.syllables.length > 0) {
          token.dataset.syllables = JSON.stringify(word.syllables);
        }
        if (Number.isFinite(startMs)) token.dataset.startMs = String(startMs);
        if (Number.isFinite(endMs)) token.dataset.endMs = String(endMs);
        const eventIndexes = Array.from(eventIndexesByWord[wordIndex] || []);
        if (eventIndexes.length > 0) {
          token.dataset.eventIndex = eventIndexes.join(' ');
          const linkedStatuses = eventIndexes.map((index) => String(normalizedEvents[index]?.status || 'uncertain'));
          if (linkedStatuses.includes('not_detected')) token.classList.add('ra-word-token--coach-error');
          else if (linkedStatuses.includes('uncertain')) token.classList.add('ra-word-token--coach-uncertain');
          else token.classList.add('ra-word-token--coach-success');
        }

        if (reducedWordTokens.has(wordIndex)) {
          const reducedInfo = reducedWordTokens.get(wordIndex);
          token.classList.add('ra-word-token--reduced');
          const reducedStatus = reducedInfo.status === 'detected'
            ? 'success'
            : reducedInfo.status === 'not_detected'
              ? 'error'
              : 'uncertain';
          token.classList.add(`sc-token-bg--${reducedStatus}`);
        }

        if (normalizedErrorType === 'omission') {
          token.classList.add('ra-word-token--omission');
        } else if (normalizedErrorType === 'insertion') {
          token.classList.add('ra-word-token--insertion');
        } else if (Number(word?.accuracyScore) < 60) {
          token.classList.add('ra-word-token--error');
        } else if (Number(word?.accuracyScore) < 80) {
          token.classList.add('ra-word-token--uncertain');
        } else {
          token.classList.add('ra-word-token--success');
        }
        if (!playable) token.classList.add('ra-word-token--unavailable');

        const displayWord = String(word?.word || '').trim();
        token.textContent = normalizedErrorType === 'insertion' ? `[${displayWord}]` : displayWord;
        const statusText = normalizedErrorType === 'omission'
          ? 'omitted'
          : normalizedErrorType === 'insertion'
            ? 'inserted'
            : `accuracy ${Number.isFinite(Number(word?.accuracyScore)) ? Number(word.accuracyScore) : 0}`;
        token.title = playable ? `Click to hear this recorded word (${statusText})` : `${displayWord} (${statusText}; no recording segment available)`;
        token.setAttribute('aria-disabled', playable ? 'false' : 'true');
        token.setAttribute('aria-label', playable ? `${displayWord}, ${statusText}. Click to play.` : `${displayWord}, ${statusText}. No recording segment available.`);
        transcript.appendChild(token);
        transcript.appendChild(document.createTextNode(' '));
      });

      const overlaySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      overlaySvg.className.baseVal = 'ra-recognized-linking-overlay';
      overlaySvg.setAttribute('aria-hidden', 'true');
      transcript.appendChild(overlaySvg);
    }
    shell.appendChild(transcript);

    const instruction = document.createElement('p');
    instruction.id = 'ra-transcript-instruction';
    instruction.className = 'ra-transcript-instruction';
    instruction.textContent = 'Click a word to hear your recording. Ctrl+click a highlighted word to jump to feedback.';
    shell.appendChild(instruction);

    if (normalizedWords.length > 0) {
      const legend = document.createElement('div');
      legend.className = 'ra-transcript-legend';
      legend.innerHTML = '<span><i class="ra-transcript-legend__swatch ra-transcript-legend__swatch--success"></i>Good</span><span><i class="ra-transcript-legend__swatch ra-transcript-legend__swatch--uncertain"></i>Unclear</span><span><i class="ra-transcript-legend__swatch ra-transcript-legend__swatch--error"></i>Needs practice</span>'
        + (normalizedEvents.length > 0 ? '<span><i class="ra-transcript-legend__swatch ra-transcript-legend__swatch--coach"></i>Speech Coach highlight</span>' : '');
      shell.appendChild(legend);
    }

    const hasFiniteMetricValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    const supplementalMetrics = [
      { label: 'Fluency', value: metrics.fluencyScore },
      { label: 'Completeness', value: metrics.completenessScore },
      { label: 'Overall', value: metrics.pronScore }
    ].filter((metric) => hasFiniteMetricValue(metric.value));
    if (supplementalMetrics.length > 0) {
      const metricsEl = document.createElement('p');
      metricsEl.className = 'ra-transcript-metrics';
      metricsEl.innerHTML = supplementalMetrics.map((metric) => `<strong>${ReadAloudMode.escapeHtml(metric.label)}:</strong> ${ReadAloudMode.escapeHtml(metric.value)}%`).join(' &nbsp;|&nbsp; ');
      shell.appendChild(metricsEl);
    }

    feedbackElement.appendChild(shell);
    this.bindMergedTranscriptInteractions(transcript);
    this.lastRecognizedLinkingPairs = finalLinkingPairs;
    this.renderRecognizedLinkingOverlay(transcript, transcript.querySelector('.ra-recognized-linking-overlay'), finalLinkingPairs);
    requestAnimationFrame(() => {
      this.renderRecognizedLinkingOverlay(transcript, transcript.querySelector('.ra-recognized-linking-overlay'), finalLinkingPairs);
    });
    return transcript;
  }

  bindMergedTranscriptInteractions(transcript) {
    if (!transcript || transcript.dataset.interactionsBound === 'true') return;
    transcript.dataset.interactionsBound = 'true';
    transcript.addEventListener('click', (event) => {
      const token = event.target.closest('.ra-word-token');
      if (!token || !transcript.contains(token)) return;
      if (event.ctrlKey) {
        event.preventDefault();
        this.navigateToSpeechCoachFeedback(token);
        return;
      }
      if (token.dataset.playable !== 'true') return;
      this.playRecordedWordSegment(Number(token.dataset.startMs), Number(token.dataset.endMs), token);
    });
    transcript.addEventListener('keydown', (event) => {
      const token = event.target.closest('.ra-word-token');
      if (!token || !transcript.contains(token) || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      if (event.ctrlKey) {
        this.navigateToSpeechCoachFeedback(token);
      } else if (token.dataset.playable === 'true') {
        this.playRecordedWordSegment(Number(token.dataset.startMs), Number(token.dataset.endMs), token);
      }
    });

    if (window.PronunciationTooltip && typeof window.PronunciationTooltip.bindHoverTooltip === 'function') {
      window.PronunciationTooltip.bindHoverTooltip(transcript, {
        selector: '.ra-word-token',
        playSyllable: (sStart, sEnd, chip) => {
          this.stopRecordedWordPlayback?.();
          const buffer = this.assessmentAudioBuffer || this.speechCoachRecordingBuffer;
          const audioEl = document.getElementById('ra-user-recording-audio');
          if (buffer) {
            window.PronunciationTooltip.playAudioSegment(buffer, sStart, sEnd, chip);
          } else if (audioEl) {
            window.PronunciationTooltip.playAudioSegment(audioEl, sStart, sEnd, chip);
          } else {
            this.playRecordedWordSegment(sStart, sEnd, null);
          }
        }
      });
    }
  }

  navigateToSpeechCoachFeedback(token) {
    const eventIndexes = String(token?.dataset?.eventIndex || '').split(/\s+/).filter(Boolean);
    if (eventIndexes.length === 0) return;
    document.querySelectorAll('#ra-connected-speech-list .sc-card--selected').forEach((card) => card.classList.remove('sc-card--selected'));
    const matches = [];
    document.querySelectorAll('#ra-connected-speech-list [data-event-index]').forEach((node) => {
      const indexes = String(node.dataset.eventIndex || '').split(/\s+/);
      if (!eventIndexes.some((index) => indexes.includes(index))) return;
      const card = node.closest('.sc-accordion-card, .sc-single-card') || node;
      if (!matches.includes(card)) matches.push(card);
    });
    matches.forEach((card) => {
      const content = card.querySelector('.sc-accordion-content');
      const toggle = card.querySelector('[data-sc-accordion-toggle]');
      if (content?.hidden && toggle) {
        toggle.click();
      }
      card.classList.add('sc-card--selected');
      card.setAttribute('tabindex', '-1');
    });
    const first = matches[0];
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first.focus({ preventScroll: true });
    }
  }

  renderRecognizedLinkingOverlay(transcriptEl, overlaySvgEl, pairsList) {
    const transcript = transcriptEl || document.getElementById('ra-merged-recognized-transcript');
    if (!transcript) return;
    const overlaySvg = overlaySvgEl || transcript.querySelector('.ra-recognized-linking-overlay');
    if (!overlaySvg) return;
    const pairs = Array.isArray(pairsList) ? pairsList : (this.lastRecognizedLinkingPairs || []);
    this.lastRecognizedLinkingPairs = pairs;

    overlaySvg.replaceChildren();
    if (pairs.length === 0) {
      overlaySvg.style.display = 'none';
      return;
    }
    overlaySvg.style.display = 'block';

    const transcriptRect = transcript.getBoundingClientRect();
    if (transcriptRect.width === 0 || transcriptRect.height === 0) {
      requestAnimationFrame(() => {
        const retryRect = transcript.getBoundingClientRect();
        if (retryRect.width > 0 && retryRect.height > 0) {
          this.renderRecognizedLinkingOverlay(transcript, overlaySvg, pairs);
        }
      });
      return;
    }

    pairs.forEach((pair) => {
      const leftToken = transcript.querySelector(`.ra-word-token[data-word-index="${pair.leftWordIndex}"]`);
      const rightToken = transcript.querySelector(`.ra-word-token[data-word-index="${pair.rightWordIndex}"]`);
      if (!leftToken || !rightToken) return;

      const leftError = String(leftToken.dataset.errorType || '').toLowerCase();
      const rightError = String(rightToken.dataset.errorType || '').toLowerCase();
      if (leftError === 'omission' && rightError === 'omission') return;

      const leftRect = leftToken.getBoundingClientRect();
      const rightRect = rightToken.getBoundingClientRect();

      // Ensure words are on the same line (tolerance 12px)
      if (Math.abs(leftRect.top - rightRect.top) > 12) return;

      const startX = leftRect.right - transcriptRect.left - 3;
      const endX = rightRect.left - transcriptRect.left + 3;
      const baseY = Math.max(leftRect.bottom, rightRect.bottom) - transcriptRect.top + 1;
      const controlX = (startX + endX) / 2;
      const controlY = baseY + 8;

      if (endX <= startX) return;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${startX} ${baseY} Q ${controlX} ${controlY} ${endX} ${baseY}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', pair.strokeColor || '#10b981');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      if (pair.eventIndex !== undefined) {
        path.dataset.eventIndex = String(pair.eventIndex);
      }
      path.dataset.linkingStatus = pair.status || 'detected';
      overlaySvg.appendChild(path);
    });

    const width = Math.max(transcriptRect.width, 1);
    const height = Math.max(transcriptRect.height, 1);
    overlaySvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    overlaySvg.setAttribute('width', `${width}`);
    overlaySvg.setAttribute('height', `${height}`);
  }

  async renderConnectedSpeechResults(connectedSpeech, options = {}) {
    const revision = this.beginSpeechCoachResultRender();
    const box = document.getElementById('ra-connected-speech-box');
    const label = document.getElementById('ra-connected-speech-label');
    const list = document.getElementById('ra-connected-speech-list');
    const meta = document.getElementById('ra-connected-speech-meta');
    const summary = document.getElementById('ra-connected-speech-summary');
    if (!box || !label || !list || !meta || !summary) {
      return { visible: false, reason: 'missing_dom', revision };
    }
    document.getElementById('ra-connected-speech-paragraph')?.replaceChildren();

    const viewMode = options.sessionViewMode || this.lastAssessmentSession?.sessionViewMode || this.getEffectiveViewMode();
    const selectedModes = this.getAssessmentConnectedSpeechModes(options);
    const rawEvents = Array.isArray(connectedSpeech?.events) ? connectedSpeech.events : [];
    const resultModel = window.ReadAloudSpeechCoach.buildResultModel({
      events: rawEvents,
      sessionConnectedSpeechModes: [...selectedModes]
    });
    const events = resultModel.events;
    const transcriptText = String(options.transcriptText || this.currentPromptPlainText || '').trim();

    this.renderRecognizedTranscript(
      options.words || this.lastAssessmentPayload?.words || [],
      transcriptText,
      events,
      options.metrics || {}
    );

    if (selectedModes.size === 0) {
      this.hideConnectedSpeechPanel({ invalidate: false });
      this.updateSpeechCoachModeHints(selectedModes);
      return { visible: false, reason: 'no_modes', revision };
    }

    this.setSpeechCoachModeHint('ra-feedback-mode-hint');
    if (!connectedSpeech || connectedSpeech.status === 'not_applicable') {
      this.hideConnectedSpeechPanel({ invalidate: false });
      return { visible: false, reason: 'not_applicable', revision };
    }

    this.connectedSpeechPanelMode = 'results';
    this.currentGuideExplanationItems = [];
    this.currentGuideInteractionItems = new Map();
    this.selectedGuideItemId = null;
    this.currentGuideHasVisibleAssimilation = false;
    box.style.display = '';
    box.dataset.coachTier = this.getCoachTier();
    label.textContent = 'Speech Coach';
    meta.textContent = 'Feedback';
    list.innerHTML = '';

    if (connectedSpeech.status === 'unavailable') {
      summary.textContent = 'Connected-speech feedback is temporarily unavailable for this attempt.';
      this.updateSpeechCoachModeHints(selectedModes);
      return { visible: true, reason: 'unavailable', revision };
    }

    const totalEvents = events.length;
    if (totalEvents === 0) {
      summary.textContent = 'No selected Speech Coach patterns were found in this attempt.';
    } else {
      summary.textContent = resultModel.headline;
    }

    await Promise.all([
      this.loadSpeechCoachAudioManifest(this.currentQuestionId),
      this.primeSharedPronunciations(events)
    ]);
    if (!this.isSpeechCoachResultRevisionCurrent(revision)) {
      return { visible: false, reason: 'stale', revision };
    }
    const { groupedReduced, linkingIssues, linkingSuccesses, soundChanges } = this._prepareSpeechCoachSections(resultModel);

    // Build populated result columns. Empty columns are omitted so a single
    // feedback family never leaves an unexplained blank half of the grid.
    const fragment = document.createDocumentFragment();
    const leftCol = document.createElement('div');
    leftCol.className = 'sc-grid-left';
    const rightCol = document.createElement('div');
    rightCol.className = 'sc-grid-right';

    if (groupedReduced.size > 0) {
      leftCol.appendChild(this._buildReducedWordsSection(groupedReduced, events));
    }
    if (linkingIssues.length > 0) {
      rightCol.appendChild(this._buildLinkingIssuesSection(linkingIssues, events));
    }
    if (linkingSuccesses.length > 0) {
      rightCol.appendChild(this._buildSuccessPillsSection(linkingSuccesses, events));
    }
    if (soundChanges.length > 0) {
      rightCol.appendChild(this._buildSoundChangesSection(soundChanges, events));
    }

    if (leftCol.childElementCount > 0) fragment.appendChild(leftCol);
    if (rightCol.childElementCount > 0) fragment.appendChild(rightCol);
    list.appendChild(fragment);

    this.bindSpeechCoachAccordions(list);
    this.bindSpeechCoachInteractions(list);
    this.updateSpeechCoachModeHints(selectedModes);
    return { visible: true, reason: 'visible', revision };
  }


  /** Delegated accordion handler for Speech Coach results */
  bindSpeechCoachAccordions(container) {
    if (!container) return;
    if (container.dataset.scAccordionBound) return;
    container.dataset.scAccordionBound = 'true';

    container.addEventListener('click', (event) => {
      if (event.target.closest('.sc-play-word-btn, .sc-model-play-btn')) return;

      const toggle = event.target.closest('[data-sc-accordion-toggle]');
      if (!toggle) return;
      const targetId = toggle.dataset.scAccordionToggle;
      const content = document.getElementById(targetId);
      if (!content) return;
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!isExpanded));
      content.hidden = isExpanded;
      const card = toggle.closest('.sc-accordion-card');
      if (card) {
        const chevron = card.querySelector('.sc-chevron');
        if (chevron) {
          chevron.classList.toggle('sc-chevron--open', !isExpanded);
        }
      }
    });
  }

  clearSpeechCoachHoverState() {
    document.querySelectorAll('#ra-merged-recognized-transcript .sc-token--hovered').forEach((token) => {
      token.classList.remove('sc-token--hovered');
    });
    document.querySelectorAll('#ra-connected-speech-list .sc-card--hovered').forEach((card) => {
      card.classList.remove('sc-card--hovered');
    });
  }

  bindSpeechCoachInteractions(container) {
    if (!container) return;
    if (container.dataset.scInteractionsBound === 'true') return;
    container.dataset.scInteractionsBound = 'true';

    // Hover Highlight Delegation
    container.addEventListener('mouseover', (e) => {
      // Find the closest element that represents a speech event instance or card
      const target = e.target.closest('[data-event-index]');
      if (target) {
        const evIdx = target.dataset.eventIndex;
        // Highlight corresponding spans
        document.querySelectorAll('#ra-merged-recognized-transcript .ra-word-token[data-event-index]').forEach(span => {
          const indexes = String(span.dataset.eventIndex || '').split(/\s+/);
          if (indexes.includes(evIdx)) {
            span.classList.add('sc-token--hovered');
          }
        });
        return;
      }

      // If hovering over an accordion group header, highlight all child instances
      const groupHeader = e.target.closest('.sc-accordion-card');
      if (groupHeader) {
        // Find all event indexes inside the card
        const childInstances = groupHeader.querySelectorAll('[data-event-index]');
        childInstances.forEach(inst => {
          const evIdx = inst.dataset.eventIndex;
          document.querySelectorAll('#ra-merged-recognized-transcript .ra-word-token[data-event-index]').forEach(span => {
            const indexes = String(span.dataset.eventIndex || '').split(/\s+/);
            if (indexes.includes(evIdx)) {
              span.classList.add('sc-token--hovered');
            }
          });
        });
      }
    });

    container.addEventListener('mouseout', (e) => {
      const hoverTarget = e.target.closest('[data-event-index], .sc-accordion-card');
      if (hoverTarget && e.relatedTarget && hoverTarget.contains(e.relatedTarget)) return;
      this.clearSpeechCoachHoverState();
    });

    // Play Word segment Delegation
    container.addEventListener('click', (e) => {
      const playBtn = e.target.closest('.sc-play-word-btn');
      if (!playBtn) return;
      
      e.stopPropagation(); // prevent accordion toggle if inside card header
      
      const startMs = Number(playBtn.dataset.start);
      const endMs = Number(playBtn.dataset.end);
      
      if (isNaN(startMs) || isNaN(endMs)) return;
      if (this.speechCoachYoursButton === playBtn && this.wordPlaybackSource) {
        this.stopSpeechCoachYoursAudio({ pause: true });
        return;
      }
      
      const startSec = startMs / 1000;
      const endSec = endMs / 1000;
      this.stopSpeechCoachModelAudio();
      this.playAudioSegment(null, startSec, endSec, playBtn);
    });

    // Bidirectional Hover (hovering over word spans highlights cards)
    const feedbackWrapper = document.getElementById('ra-connected-speech-box');
    if (feedbackWrapper && !feedbackWrapper.dataset.scBidirectionalBound) {
      feedbackWrapper.dataset.scBidirectionalBound = 'true';
      
      feedbackWrapper.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-event-index]');
        if (target) {
          const indexes = String(target.dataset.eventIndex || '').split(/\s+/);
          indexes.forEach(evIdx => {
            if (!evIdx) return;
            // Find card elements with this eventIndex and highlight them
            container.querySelectorAll(`[data-event-index="${evIdx}"]`).forEach(card => {
              card.classList.add('sc-card--hovered');
            });
          });
        }
      });
      
      feedbackWrapper.addEventListener('mouseout', (e) => {
        if (e.relatedTarget && feedbackWrapper.contains(e.relatedTarget)) return;
        this.clearSpeechCoachHoverState();
      });
    }

    const transcriptWrapper = document.getElementById('ra-transcript-feedback');
    if (transcriptWrapper && !transcriptWrapper.dataset.scTranscriptBidirectionalBound) {
      transcriptWrapper.dataset.scTranscriptBidirectionalBound = 'true';
      transcriptWrapper.addEventListener('mouseover', (event) => {
        const token = event.target.closest('#ra-merged-recognized-transcript .ra-word-token[data-event-index]');
        if (!token) return;
        const indexes = String(token.dataset.eventIndex || '').split(/\s+/).filter(Boolean);
        container.querySelectorAll('[data-event-index]').forEach((node) => {
          const nodeIndexes = String(node.dataset.eventIndex || '').split(/\s+/);
          if (indexes.some((index) => nodeIndexes.includes(index))) {
            const card = node.closest('.sc-accordion-card, .sc-single-card') || node;
            card.classList.add('sc-card--hovered');
          }
        });
      });
      transcriptWrapper.addEventListener('mouseout', (event) => {
        if (event.relatedTarget && transcriptWrapper.contains(event.relatedTarget)) return;
        this.clearSpeechCoachHoverState();
      });
    }
  }

  playAudioSegment(audioEl, startSec, endSec, button = null) {
    return this.playRecordedWordSegment(Number(startSec) * 1000, Number(endSec) * 1000, button);
  }

  /** Prepare display-ready sections from the pure Speech Coach result model. */
  _prepareSpeechCoachSections(resultModel) {
    const groupedReduced = new Map();
    const sections = resultModel?.sections || {};
    (sections.reducedWords || []).forEach((event) => {
      const categoryLabel = window.ReadAloudLinking?.getLearnerConnectedSpeechCategoryLabel
        ? window.ReadAloudLinking.getLearnerConnectedSpeechCategoryLabel('reduced_words')
        : this.getConnectedSpeechDisplayLabel('reduced_words');
      const phrase = event.phrase || event.eventId || 'Word';
      const key = phrase.toLowerCase();
      if (!groupedReduced.has(key)) {
        groupedReduced.set(key, { phrase, label: categoryLabel, items: [] });
      }
      groupedReduced.get(key).items.push(event);
    });

    return {
      groupedReduced,
      linkingIssues: sections.linkingIssues || [],
      linkingSuccesses: sections.linkingSuccesses || [],
      soundChanges: sections.soundChanges || []
    };
  }

  _buildSoundChangesSection(soundChanges, events) {
    const escapeHtml = ReadAloudMode.escapeHtml;
    const section = document.createElement('div');
    section.className = 'sc-section';
    const header = document.createElement('h4');
    header.className = 'sc-section-header';
    header.textContent = 'Sound Changes';
    section.appendChild(header);
    const stack = document.createElement('div');
    stack.className = 'sc-accordion-stack';
    soundChanges.forEach((event) => {
      const evIndex = events ? events.indexOf(event) : -1;
      const card = document.createElement('div');
      const statusClass = event.status === 'detected'
        ? { border: 'sc-border--success', badge: 'sc-badge--success' }
        : event.status === 'not_detected'
          ? { border: 'sc-border--error', badge: 'sc-badge--error' }
          : { border: 'sc-border--mixed', badge: 'sc-badge--uncertain' };
      card.className = `sc-single-card ${statusClass.border}`;
      if (evIndex !== -1) card.dataset.eventIndex = String(evIndex);
      const familyLabel = event.family === 'yod_coalescence' ? 'Yod coalescence' : 'Bilabial assimilation';
      const hasTimestamps = typeof event.startMs === 'number' && typeof event.endMs === 'number';
      const controls = this._buildSpeechCoachPlaybackControls(event, evIndex, hasTimestamps, 'Play your recording segment');
      card.innerHTML = `<div class="sc-sound-change-row"><div><strong class="sc-word-title">${escapeHtml(event.phrase || 'Sound change')}</strong><span class="sc-sound-change-family">${escapeHtml(familyLabel)}</span></div><div class="sc-sound-change-actions">${controls}<span class="sc-status-badge ${statusClass.badge}">${escapeHtml(event.status || 'uncertain')}</span></div></div>`;
      stack.appendChild(card);
    });
    section.appendChild(stack);
    return section;
  }

  /* _buildAnnotatedParagraph() was removed here. It built a second, separately
     annotated copy of the passage for the coach panel and was never called by
     any render path. Results now annotate the one passage in .ra-prompt-stage
     that the learner is already reading. */

  async primeSharedPronunciations(events = []) {
    const phonetics = window.Phonetics;
    if (!phonetics || typeof phonetics.getPronunciations !== 'function') return;

    const requests = new Map();
    (Array.isArray(events) ? events : []).forEach((event) => {
      const words = String(event?.phrase || '').trim().split(/\s+/).filter(Boolean);
      words.forEach((word, index) => {
        const clean = word.replace(/[^a-zA-Z']/g, '').toLowerCase();
        if (!clean) return;
        const nextWord = words[index + 1] || '';
        const nextSound = /^[aeiou]/i.test(nextWord) ? 'vowel' : 'consonant';
        if (!requests.has(clean)) requests.set(clean, nextSound);
      });
    });

    await Promise.all([...requests.entries()].map(async ([word, nextSound]) => {
      try {
        const result = await phonetics.getPronunciations(word, {
          context: 'connectedSpeech',
          nextSound
        });
        const selectedIPA = result?.selected?.ipa || result?.forms?.[0]?.ipa || '';
        if (selectedIPA) this.sharedLinkingPronunciations.set(word, selectedIPA);

        const strong = (result?.forms || [])
          .filter((form) => form?.formRole === 'strong' && form.ipa)
          .map((form) => form.ipa);
        const weakForms = (result?.forms || [])
          .filter((form) => form?.formRole === 'weak' && form.ipa)
          .map((form) => {
            if (form.condition?.nextSound === 'consonant') return `${form.ipa} before a consonant sound`;
            if (form.condition?.nextSound === 'vowel') return `${form.ipa} before a vowel sound`;
            return form.ipa;
          });
        const weak = weakForms.join(weakForms.some((form) => form.includes(' before ')) ? '; ' : ', ');
        if (strong.length && weak) {
          this.sharedReducedWordForms.set(word, {
            strong: [...new Set(strong)].join(' or '),
            reduced: [...new Set(weakForms)].join(weakForms.some((form) => form.includes(' before ')) ? '; ' : ', ')
          });
        }
      } catch (error) {
        console.warn(`[ReadAloud] Shared pronunciation lookup failed for ${word}:`, error);
      }
    }));
  }

  _getReducedWordIpaInfo(phrase) {
    const clean = String(phrase || '').toLowerCase().trim().replace(/[^a-z']/g, '');
    return this.sharedReducedWordForms.get(clean) || null;
  }

  /** Build "Reduced Words" section with accordion cards and single-occurrence grid */
  _buildReducedWordsSection(groupedReduced, events) {
    const escapeHtml = ReadAloudMode.escapeHtml;
    const section = document.createElement('div');
    section.className = 'sc-section';

    const header = document.createElement('h4');
    header.className = 'sc-section-header';
    header.innerHTML = 'Reduced Words <span class="sc-info-tip" data-sc-info="reduced" title="Click for info on Reduced Words" style="cursor:pointer;">ⓘ</span>';
    section.appendChild(header);

    const singles = [];
    const multiples = [];
    groupedReduced.forEach((group) => {
      if (group.items.length === 1) { singles.push(group); } else { multiples.push(group); }
    });

    if (multiples.length > 0) {
      const stackContainer = document.createElement('div');
      stackContainer.className = 'sc-accordion-stack';
      multiples.forEach((group, groupIdx) => {
        const totalCount = group.items.length;
        const successCount = group.items.filter((i) => i.status === 'detected').length;
        const issuesCount = totalCount - successCount;
        const statusClass = issuesCount === 0 ? 'sc-border--success' : issuesCount === totalCount ? 'sc-border--error' : 'sc-border--mixed';
        const accordionId = `sc-accordion-red-${groupIdx}`;

        const card = document.createElement('div');
        card.className = `sc-accordion-card ${statusClass}`;
        const cardHeader = document.createElement('button');
        cardHeader.type = 'button';
        cardHeader.className = 'sc-accordion-toggle';
        cardHeader.setAttribute('aria-expanded', 'false');
        cardHeader.setAttribute('aria-controls', accordionId);
        cardHeader.dataset.scAccordionToggle = accordionId;

        const ipaInfo = this._getReducedWordIpaInfo(group.phrase);
        const ipaHtml = ipaInfo ? ` <span class="sc-inline-ipa">(Strong ${ipaInfo.strong} · Weak ${ipaInfo.reduced})</span>` : '';

        const labelSide = document.createElement('div');
        labelSide.className = 'sc-accordion-label';
        labelSide.innerHTML = `<strong class="sc-word-title">${escapeHtml(group.phrase)}</strong>${ipaHtml}<span class="sc-count-badge">${totalCount}x</span>`;

        const dotSide = document.createElement('div');
        dotSide.className = 'sc-accordion-dots';
        group.items.forEach((i, dotIdx) => {
          const dot = document.createElement('span');
          dot.className = `sc-status-dot ${i.status === 'detected' ? 'sc-status-dot--success' : i.status === 'not_detected' ? 'sc-status-dot--error' : 'sc-status-dot--uncertain'}`;
          dot.setAttribute('aria-label', `Instance ${dotIdx + 1}: ${i.status || 'uncertain'}`);
          dotSide.appendChild(dot);
        });
        const chevron = document.createElement('span');
        chevron.className = 'sc-chevron';
        chevron.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>';
        dotSide.appendChild(chevron);

        cardHeader.appendChild(labelSide);
        cardHeader.appendChild(dotSide);
        card.appendChild(cardHeader);

        const cardContent = document.createElement('div');
        cardContent.className = 'sc-accordion-content';
        cardContent.id = accordionId;
        cardContent.hidden = true;

        group.items.forEach((i, idx) => {
          const evIndex = events ? events.indexOf(i) : -1;
          const instance = document.createElement('div');
          instance.className = `sc-instance${idx > 0 ? ' sc-instance--bordered' : ''}`;
          if (evIndex !== -1) {
            instance.dataset.eventIndex = String(evIndex);
          }
          const statusCls = i.status === 'detected' ? 'sc-badge--success' : i.status === 'not_detected' ? 'sc-badge--error' : 'sc-badge--uncertain';
          
          const hasTimestamps = typeof i.startMs === 'number' && typeof i.endMs === 'number';
          const timeText = hasTimestamps ? ` [${(i.startMs / 1000).toFixed(2)}s]` : '';
          
          const playButtonHtml = this._buildSpeechCoachPlaybackControls(i, evIndex, hasTimestamps, 'Play your recording segment');

          const defaultFeedback = ipaInfo
            ? `Weak form reduction: pronounce "${group.phrase}" as ${ipaInfo.reduced} in connected speech. The strong form is ${ipaInfo.strong} for citation or emphasis.`
            : 'No detailed coaching tips provided for this instance.';

          instance.innerHTML = `<div class="sc-instance-header"><span class="sc-status-badge ${statusCls}">${escapeHtml(i.status || 'uncertain')}</span><span class="sc-instance-label">Instance ${idx + 1}${timeText}</span>${playButtonHtml}</div><div class="sc-instance-feedback">${escapeHtml(i.feedbackText || defaultFeedback)}</div>`;
          cardContent.appendChild(instance);
        });
        card.appendChild(cardContent);
        stackContainer.appendChild(card);
      });
      section.appendChild(stackContainer);
    }

    if (singles.length > 0) {
      const gridContainer = document.createElement('div');
      gridContainer.className = singles.length >= 2 ? 'sc-singles-grid' : 'sc-accordion-stack';
      singles.forEach((group) => {
        const item = group.items[0];
        const evIndex = events ? events.indexOf(item) : -1;
        const statusClass = item.status === 'detected' ? 'sc-border--success' : item.status === 'not_detected' ? 'sc-border--error' : 'sc-border--mixed';
        const dotCls = item.status === 'detected' ? 'sc-status-dot--success' : item.status === 'not_detected' ? 'sc-status-dot--error' : 'sc-status-dot--uncertain';
        
        const card = document.createElement('div');
        card.className = `sc-single-card ${statusClass}`;
        if (evIndex !== -1) {
          card.dataset.eventIndex = String(evIndex);
        }
        
        const ipaInfo = this._getReducedWordIpaInfo(group.phrase);
        const ipaHtml = ipaInfo ? `
          <div style="font-size: 0.72rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; margin-top: 2px; display: flex; align-items: center; gap: 4px;">
            <span class="sc-ipa-strong">${ipaInfo.strong}</span>
            <span class="sc-ipa-weak">Weak ${ipaInfo.reduced}</span>
          </div>
        ` : '';

        card.title = item.feedbackText || (ipaInfo ? `Weak form: ${ipaInfo.strong} ➔ ${ipaInfo.reduced}` : '');
        
        const hasTimestamps = typeof item.startMs === 'number' && typeof item.endMs === 'number';
        const timeText = hasTimestamps ? ` [${(item.startMs / 1000).toFixed(2)}s]` : '';
        
        const playButtonHtml = this._buildSpeechCoachPlaybackControls(item, evIndex, hasTimestamps, 'Play your recording segment');

        card.innerHTML = `
          <div class="sc-single-card-row">
            <div class="sc-single-card-copy">
              <div class="sc-single-card-title-row">
                <strong class="sc-word-title" style="font-size: 0.98rem; font-weight: 600;">${escapeHtml(group.phrase)}</strong>
                <span class="sc-section-time">${timeText}</span>
              </div>
              ${ipaHtml}
            </div>
            <div class="sc-single-card-actions">
              ${playButtonHtml}
              <span class="sc-status-dot ${dotCls}"></span>
            </div>
          </div>
        `;
        gridContainer.appendChild(card);
      });
      section.appendChild(gridContainer);
    }

    return section;
  }

  /** Get IPA breakdown & formula for a linked word pair */
  _getLinkingIpaDetails(w1, w2, event) {
    const cleanW1 = String(w1 || '').replace(/[^a-zA-Z]/g, '').toLowerCase();
    const cleanW2 = String(w2 || '').replace(/[^a-zA-Z]/g, '').toLowerCase();

    let ipa1 = this.sharedLinkingPronunciations.get(cleanW1) || '';
    let ipa2 = this.sharedLinkingPronunciations.get(cleanW2) || '';

    if (window.Phonetics && typeof window.Phonetics._cache !== 'undefined') {
      const cache = window.Phonetics._cache;
      if (!ipa1 && cache.has(cleanW1)) {
        const val = cache.get(cleanW1);
        ipa1 = typeof val === 'object' ? val.ipa : val;
      }
      if (!ipa2 && cache.has(cleanW2)) {
        const val = cache.get(cleanW2);
        ipa2 = typeof val === 'object' ? val.ipa : val;
      }
    }

    if (!ipa1) ipa1 = '/' + (cleanW1 || 'word1') + '/';
    if (!ipa2) ipa2 = '/' + (cleanW2 || 'word2') + '/';

    const norm1 = ipa1.replace(/^\/|\/$/g, '').trim();
    const norm2 = ipa2.replace(/^\/|\/$/g, '').trim();

    const w1EndsInIY = /(y|ee|e|ie|ea|ey|i)$/i.test(cleanW1) || /[iːeɪaɪɔɪ]$/.test(norm1);
    const w1EndsInUW = /(o|oo|ow|ew|u|ue)$/i.test(cleanW1) || /[uːaʊoʊəʊ]$/.test(norm1);
    const isCoalescentDJ = cleanW1.endsWith('d') && cleanW2.startsWith('y');
    const isCoalescentTJ = cleanW1.endsWith('t') && cleanW2.startsWith('y');
    const isSameConsonant = norm1.slice(-1) && norm1.slice(-1) === norm2.slice(0, 1);

    let linkedIPA = '';
    if (isCoalescentDJ) {
      linkedIPA = '/' + norm1.slice(0, -1) + 'dʒ' + norm2.slice(1) + '/';
    } else if (isCoalescentTJ) {
      linkedIPA = '/' + norm1.slice(0, -1) + 'tʃ' + norm2.slice(1) + '/';
    } else if (w1EndsInIY && /^[aeiouɪʌæɒəei]/i.test(cleanW2)) {
      linkedIPA = '/' + norm1 + '.j' + norm2.replace(/^[ˈˌ]/, '') + '/';
    } else if (w1EndsInUW && /^[aeiouɪʌæɒəei]/i.test(cleanW2)) {
      linkedIPA = '/' + norm1 + '.w' + norm2.replace(/^[ˈˌ]/, '') + '/';
    } else if (isSameConsonant) {
      linkedIPA = '/' + norm1 + ' ‿ ' + norm2 + '/';
    } else {
      linkedIPA = '/' + norm1 + '.' + norm2.replace(/^[ˈˌ]/, '') + '/';
    }

    const formula = `/${norm1}/ + /${norm2}/ ➔ ${linkedIPA}`;

    return {
      ipa1: `/${norm1}/`,
      ipa2: `/${norm2}/`,
      linkedIPA,
      formula
    };
  }

  /** Build "Needs Attention" section with issue cards */
  _buildLinkingIssuesSection(linkingIssues, events) {
    const escapeHtml = ReadAloudMode.escapeHtml;
    const section = document.createElement('div');
    section.className = 'sc-section';

    const header = document.createElement('h4');
    header.className = 'sc-section-header';
    header.innerHTML = 'Needs Attention <span class="sc-info-tip" data-sc-info="issues" title="Click for info on Needs Attention Links" style="cursor:pointer;">ⓘ</span>';
    section.appendChild(header);

    const issueStack = document.createElement('div');
    issueStack.className = 'sc-accordion-stack';

    const resolveCategory = (ev) => {
      const cat = this.normalizeConnectedSpeechMode(
        window.ReadAloudLinking?.getLearnerConnectedSpeechCategory?.(ev.family || ev.subtype || ev.category || '')
        || ev.category || ev.subtype || 'linking'
      );
      const label = window.ReadAloudLinking?.getLearnerConnectedSpeechCategoryLabel
        ? window.ReadAloudLinking.getLearnerConnectedSpeechCategoryLabel(cat)
        : this.getConnectedSpeechDisplayLabel(cat);
      return { categoryLabel: label };
    };

    linkingIssues.forEach((event, idx) => {
      const evIndex = events ? events.indexOf(event) : -1;
      const { categoryLabel } = resolveCategory(event);
      const borderCls = event.status === 'not_detected' ? 'sc-border--error' : 'sc-border--mixed';
      const accordionId = `sc-issue-acc-${idx}`;

      const card = document.createElement('div');
      card.className = `sc-accordion-card ${borderCls}`;
      if (evIndex !== -1) {
        card.dataset.eventIndex = String(evIndex);
      }
      
      const phrase = String(event.phrase || 'Word pair').trim();
      const pWords = phrase.split(/\s+/);
      const ipaDetails = this._getLinkingIpaDetails(pWords[0], pWords[1], event);

      const hasTimestamps = typeof event.startMs === 'number' && typeof event.endMs === 'number';
      const timeText = hasTimestamps ? ` [${(event.startMs / 1000).toFixed(2)}s]` : '';
      const playButtonHtml = this._buildSpeechCoachPlaybackControls(event, evIndex, hasTimestamps, 'Play your recording segment');
      
      const badgeCls = event.status === 'not_detected' ? 'sc-badge--error' : 'sc-badge--uncertain';

      const cardHeader = document.createElement('div');
      cardHeader.className = 'sc-accordion-header sc-accordion-header--error';

      cardHeader.innerHTML = `
        <div class="sc-accordion-label" data-sc-accordion-toggle="${accordionId}">
          <strong class="sc-word-title">${escapeHtml(phrase)}</strong>
          <span class="sc-ipa-badge">${escapeHtml(ipaDetails.linkedIPA)}</span>
        </div>
        <div class="sc-accordion-controls">
          ${playButtonHtml}
          <span class="sc-status-badge ${badgeCls}">${escapeHtml(event.status || 'uncertain')}</span>
          <span class="sc-timestamp">${timeText}</span>
          <button type="button" class="sc-chevron-btn" data-sc-accordion-toggle="${accordionId}" title="Toggle details">
            <span class="sc-chevron"><svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg></span>
          </button>
        </div>
      `;
      card.appendChild(cardHeader);

      const cardContent = document.createElement('div');
      cardContent.className = 'sc-accordion-content';
      cardContent.id = accordionId;
      cardContent.hidden = true;

      const reasonExplanation = this._getNeedsAttentionReasonText(event);

      cardContent.innerHTML = `
        <div class="sc-instance sc-instance--detail">
          <div class="sc-detail-label">
            Category: ${escapeHtml(categoryLabel)}
          </div>
          <div class="sc-instance-feedback sc-instance-feedback--error">
            ${escapeHtml(reasonExplanation.reason)}
          </div>

          <div class="sc-ipa-row">
            <span class="sc-ipa-chip">Target IPA:</span>
            <span><span class="sc-ipa-part">${escapeHtml(ipaDetails.ipa1)}</span> + <span class="sc-ipa-part">${escapeHtml(ipaDetails.ipa2)}</span> <strong class="sc-ipa-arrow">➔</strong> <strong class="sc-ipa-result">${escapeHtml(ipaDetails.linkedIPA)}</strong></span>
          </div>

          <div class="sc-fix-note">
            <strong>How to fix:</strong> ${escapeHtml(reasonExplanation.tip)}
          </div>
        </div>
      `;

      card.appendChild(cardContent);
      issueStack.appendChild(card);
    });

    section.appendChild(issueStack);
    return section;
  }

  /** Build "Successful Links" section with expandable accordion cards and explanations */
  _buildSuccessPillsSection(linkingSuccesses, events) {
    const escapeHtml = ReadAloudMode.escapeHtml;
    const section = document.createElement('div');
    section.className = 'sc-section';

    const header = document.createElement('h4');
    header.className = 'sc-section-header';
    header.innerHTML = 'Successful Links <span class="sc-info-tip" data-sc-info="success" title="Click for info on Successful Links" style="cursor:pointer;">ⓘ</span>';
    section.appendChild(header);

    const stackContainer = document.createElement('div');
    stackContainer.className = 'sc-accordion-stack';

    linkingSuccesses.forEach((event, idx) => {
      const evIndex = events ? events.indexOf(event) : -1;
      const accordionId = `sc-success-acc-${idx}`;

      const card = document.createElement('div');
      card.className = 'sc-accordion-card sc-border--success';
      if (evIndex !== -1) {
        card.dataset.eventIndex = String(evIndex);
      }

      const phrase = String(event.phrase || 'Word pair').trim();
      const pWords = phrase.split(/\s+/);
      const ipaDetails = this._getLinkingIpaDetails(pWords[0], pWords[1], event);

      const hasTimestamps = typeof event.startMs === 'number' && typeof event.endMs === 'number';
      const timeText = hasTimestamps ? ` [${(event.startMs / 1000).toFixed(2)}s]` : '';
      const playButtonHtml = this._buildSpeechCoachPlaybackControls(event, evIndex, hasTimestamps, 'Play your recording segment');

      const cardHeader = document.createElement('div');
      cardHeader.className = 'sc-accordion-header sc-accordion-header--success';

      cardHeader.innerHTML = `
        <div class="sc-accordion-label" data-sc-accordion-toggle="${accordionId}">
          <svg class="sc-check-icon" width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
          <strong class="sc-word-title">${escapeHtml(phrase)}</strong>
          <span class="sc-ipa-badge">${escapeHtml(ipaDetails.linkedIPA)}</span>
        </div>
        <div class="sc-accordion-controls">
          ${playButtonHtml}
          <span class="sc-timestamp">${timeText}</span>
          <button type="button" class="sc-chevron-btn" data-sc-accordion-toggle="${accordionId}" title="Toggle details">
            <span class="sc-chevron"><svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg></span>
          </button>
        </div>
      `;
      card.appendChild(cardHeader);

      const cardContent = document.createElement('div');
      cardContent.className = 'sc-accordion-content';
      cardContent.id = accordionId;
      cardContent.hidden = true;

      const reasonExplanation = this._getSuccessLinkReasonText(event);

      cardContent.innerHTML = `
        <div class="sc-instance sc-instance--detail">
          <div class="sc-detail-label">
            ✓ Seamless Link Connected
          </div>
          <div class="sc-instance-feedback">
            ${escapeHtml(reasonExplanation.reason)}
          </div>

          <div class="sc-ipa-row">
            <span class="sc-ipa-chip">IPA Style:</span>
            <span><span class="sc-ipa-part">${escapeHtml(ipaDetails.ipa1)}</span> + <span class="sc-ipa-part">${escapeHtml(ipaDetails.ipa2)}</span> <strong class="sc-ipa-arrow">➔</strong> <strong class="sc-ipa-result">${escapeHtml(ipaDetails.linkedIPA)}</strong></span>
          </div>

          <div class="sc-fix-note">
            <strong>Why you nailed it:</strong> ${escapeHtml(reasonExplanation.tip)}
          </div>
        </div>
      `;

      card.appendChild(cardContent);
      stackContainer.appendChild(card);
    });

    section.appendChild(stackContainer);
    return section;
  }

  _getSuccessLinkReasonText(event) {
    const phrase = String(event.phrase || 'Word pair').trim();
    const words = phrase.split(/\s+/);
    const w1 = words[0] || 'first word';
    const w2 = words[1] || 'second word';

    const cleanW1 = w1.replace(/[^a-zA-Z]/g, '').toLowerCase();
    const cleanW2 = w2.replace(/[^a-zA-Z]/g, '').toLowerCase();
    const ipaDetails = this._getLinkingIpaDetails(cleanW1, cleanW2, event);

    const w1EndsInIY = /(y|ee|e|ie|ea|ey|i)$/i.test(cleanW1);
    const w1EndsInUW = /(o|oo|ow|ew|u|ue)$/i.test(cleanW1);
    const w2StartsWithVowel = /^[aeiou]/i.test(cleanW2);

    if (w2StartsWithVowel) {
      if (w1EndsInIY) {
        return {
          reason: `Vowel-to-vowel link (linking /j/): The ending vowel sound in "${w1}" glides smoothly into "${w2}" with an intrusive /j/ sound (${ipaDetails.formula}).`,
          tip: `Gliding from "${w1}" into "${w2}" using /j/ (${ipaDetails.linkedIPA}) creates a seamless transition without inserting a harsh glottal stop.`
        };
      }

      if (w1EndsInUW) {
        return {
          reason: `Vowel-to-vowel link (linking /w/): The rounded vowel ending in "${w1}" glides smoothly into "${w2}" with an intrusive /w/ sound (${ipaDetails.formula}).`,
          tip: `Gliding from the rounded vowel in "${w1}" into "${w2}" (${ipaDetails.linkedIPA}) keeps your vocal airflow fluid for PTE Oral Fluency.`
        };
      }

      const isVoicedFricative = /(s|z|ve|se|ze)$/i.test(cleanW1);
      const isVoicelessStop = /(t|p|k|ck|tt)$/i.test(cleanW1);
      const isNasal = /(m|n|ng)$/i.test(cleanW1);

      if (isVoicedFricative) {
        return {
          reason: `Consonant-to-vowel link (voiced fricative): The ending consonant of "${w1}" merged directly into "${w2}" (${ipaDetails.formula}).`,
          tip: `Carrying the voiced vibration from "${w1}" straight into "${w2}" (${ipaDetails.linkedIPA}) prevents unnatural vocal drops between words.`
        };
      }

      if (isVoicelessStop) {
        return {
          reason: `Consonant-to-vowel link (resyllabification): The final stop consonant in "${w1}" shifted to become the initial onset of "${w2}" (${ipaDetails.formula}).`,
          tip: `Resyllabifying "${w1}" into "${w2}" (${ipaDetails.linkedIPA}) eliminates robotic micro-pauses.`
        };
      }

      if (isNasal) {
        return {
          reason: `Consonant-to-vowel link (nasal flow): The nasal consonant in "${w1}" connected smoothly into "${w2}" (${ipaDetails.formula}).`,
          tip: `Continuing vocal airflow through the nasal sound into "${w2}" (${ipaDetails.linkedIPA}) ensures rhythmic academic speech.`
        };
      }

      return {
        reason: `Consonant-to-vowel link (${ipaDetails.formula}): The ending consonant of "${w1}" merged smoothly into the initial vowel sound of "${w2}".`,
        tip: `Merging final consonants into initial vowels (${ipaDetails.linkedIPA}) maintains steady pacing and native-like rhythm.`
      };
    }

    return {
      reason: event.feedbackText || `You connected "${w1}" and "${w2}" smoothly (${ipaDetails.linkedIPA}) without an artificial pause.`,
      tip: `Maintaining continuous speech between "${w1}" and "${w2}" (${ipaDetails.linkedIPA}) directly improves your PTE Oral Fluency score.`
    };
  }

  _getNeedsAttentionReasonText(event) {
    const phrase = String(event.phrase || 'Word pair').trim();
    const words = phrase.split(/\s+/);
    const w1 = words[0] || 'first word';
    const w2 = words[1] || 'second word';

    const cleanW1 = w1.replace(/[^a-zA-Z]/g, '').toLowerCase();
    const cleanW2 = w2.replace(/[^a-zA-Z]/g, '').toLowerCase();
    const ipaDetails = this._getLinkingIpaDetails(cleanW1, cleanW2, event);

    const w1EndsInIY = /(y|ee|e|ie|ea|ey|i)$/i.test(cleanW1);
    const w1EndsInUW = /(o|oo|ow|ew|u|ue)$/i.test(cleanW1);
    const w2StartsWithVowel = /^[aeiou]/i.test(cleanW2);

    let reason = event.feedbackText || `An unnatural pause or break was detected between "${w1}" and "${w2}" (${ipaDetails.formula}).`;
    let tip = `Try pronouncing "${w1} ${w2}" in one continuous breath as ${ipaDetails.linkedIPA} without taking a pause.`;

    if (w2StartsWithVowel) {
      if (w1EndsInIY) {
        reason = `Missed vowel-to-vowel link (${ipaDetails.formula}): "${w1}" ends in a vowel sound and "${w2}" opens with a vowel, but an unnatural break or glottal stop was detected.`;
        tip = `Glide smoothly from "${w1}" to "${w2}" using a subtle /j/ transition: Target ${ipaDetails.linkedIPA}.`;
      } else if (w1EndsInUW) {
        reason = `Missed vowel-to-vowel link (${ipaDetails.formula}): "${w1}" ends in a rounded vowel sound and "${w2}" opens with a vowel, but speech was interrupted.`;
        tip = `Glide smoothly from "${w1}" to "${w2}" using a subtle /w/ transition: Target ${ipaDetails.linkedIPA}.`;
      } else {
        reason = `Missed consonant-to-vowel link (${ipaDetails.formula}): Speech Coach detected a hesitation between the final sound of "${w1}" and opening vowel of "${w2}".`;
        tip = `Attach the ending consonant of "${w1}" directly to "${w2}" to pronounce it smoothly as ${ipaDetails.linkedIPA}.`;
      }
    }

    return { reason, tip };
  }

  showSpeechCoachInfoModal(type) {
    let title = 'Speech Coach Guide';
    let bodyHtml = '';

    if (type === 'reduced') {
      title = 'Reduced Words Guide';
      bodyHtml = `
        <p><strong>What are Reduced Words?</strong> In natural spoken English, functional words (like <em>to, and, of, have, for, can</em>) are pronounced in their weak form with lighter, shorter vowel sounds (e.g. schwa /ə/).</p>
        <p><strong>Why it matters:</strong> Reducing functional words gives English its characteristic rhythm and emphasizes key content words.</p>
        <p><strong>PTE Fluency:</strong> Natural word reductions make your speech sound fluid and native-like instead of overly rigid.</p>
      `;
    } else if (type === 'success') {
      title = 'Successful Links Guide';
      bodyHtml = `
        <p><strong>What are Successful Links?</strong> In fluent speech, words do not stand isolated. Word boundaries blend smoothly into one another.</p>
        <p><strong>Common Link Types:</strong></p>
        <ul style="margin: 6px 0 12px 20px; font-size: 0.9rem; line-height: 1.6;">
          <li><strong>Consonant → Vowel:</strong> e.g., <em>"cancer is"</em> → pronounced <em>can-ce-ris</em></li>
          <li><strong>Smooth Transition:</strong> Airflow is maintained across word boundaries without glottal stops.</li>
        </ul>
        <p><strong>PTE Impact:</strong> Smooth linking boosts your Oral Fluency score!</p>
      `;
    } else if (type === 'issues') {
      title = 'Needs Attention Links Guide';
      bodyHtml = `
        <p><strong>What does Needs Attention mean?</strong> Speech Coach detected an artificial pause, break, or glottal stop between these words where fluent speech links them.</p>
        <p><strong>How to improve:</strong></p>
        <ul style="margin: 6px 0 12px 20px; font-size: 0.9rem; line-height: 1.6;">
          <li>Click the <strong>▶ Play</strong> button on any card to hear your recording for that segment.</li>
          <li>Click the card to read the coaching tip on how to join the words.</li>
          <li>Practice linking the two words together in a single breath unit.</li>
        </ul>
      `;
    }

    let modalOverlay = document.getElementById('sc-info-modal-overlay');
    if (!modalOverlay) {
      modalOverlay = document.createElement('div');
      modalOverlay.id = 'sc-info-modal-overlay';
      modalOverlay.style.cssText = 'position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; padding:16px; backdrop-filter:blur(2px);';
      document.body.appendChild(modalOverlay);
    }

    modalOverlay.innerHTML = `
      <div style="background:#fff; border-radius:12px; max-width:480px; width:100%; padding:20px 24px; box-shadow:0 10px 25px rgba(0,0,0,0.2); position:relative; font-family:inherit;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; border-bottom:1px solid #f3f4f6; padding-bottom:10px;">
          <h3 style="margin:0; font-size:1.15rem; color:#111827; font-weight:700;">${title}</h3>
          <button type="button" id="sc-info-modal-close" style="border:none; background:transparent; font-size:1.4rem; color:#6b7280; cursor:pointer; line-height:1;">&times;</button>
        </div>
        <div style="font-size:0.92rem; color:#374151; line-height:1.55;">
          ${bodyHtml}
        </div>
        <div style="margin-top:18px; text-align:right;">
          <button type="button" id="sc-info-modal-ok" style="padding:8px 18px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-weight:600; cursor:pointer;">Got it</button>
        </div>
      </div>
    `;

    modalOverlay.style.display = 'flex';

    const closeModal = () => {
      modalOverlay.style.display = 'none';
    };

    document.getElementById('sc-info-modal-close')?.addEventListener('click', closeModal);
    document.getElementById('sc-info-modal-ok')?.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });
  }

  handleGuideTargetKeydown(event) {
    if (event.key === 'Escape' && this.activeSoundChangeTooltipId) {
      event.preventDefault();
      this.hideSoundChangeTooltip();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    this.handleGuideTargetInteraction(event);
  }

  getSoundChangeTooltipTarget(node) {
    if (!(node instanceof Element)) return null;
    return node.closest(this.pteView ? '[data-guide-target]' : '[data-guide-target][data-sound-change-subtype]');
  }

  getSoundChangeTooltipTargets(guideId, stage = document.getElementById('ra-prompt-stage')) {
    if (!guideId || !stage) return [];
    return Array.from(stage.querySelectorAll(this.pteView ? '[data-guide-target]' : '[data-guide-target][data-sound-change-subtype]'))
      .filter((node) => String(node.getAttribute('data-guide-target') || '') === guideId);
  }

  handleSoundChangeTooltipEnter(event) {
    if (this.soundChangeTooltipPinned) return;
    if (this.soundChangeTooltipLeaveTimer) {
      clearTimeout(this.soundChangeTooltipLeaveTimer);
      this.soundChangeTooltipLeaveTimer = null;
    }
    const target = this.getSoundChangeTooltipTarget(event?.target);
    const guideId = String(target?.getAttribute('data-guide-target') || '').trim();
    if (!target || !guideId) return;
    if (this.activeSoundChangeTooltipId === guideId) return;
    this.showSoundChangeTooltip(guideId, target, { pinned: false });
  }

  handleSoundChangeTooltipLeave(event) {
    if (this.soundChangeTooltipPinned) return;

    const sourceTarget = this.getSoundChangeTooltipTarget(event?.target);
    const leftTooltip = event?.target instanceof Element
      && !!event.target.closest('#ra-sound-change-tooltip');
    if (!sourceTarget && !leftTooltip) return;

    const relatedTarget = event?.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (relatedTarget?.closest('#ra-sound-change-tooltip')) {
      if (this.soundChangeTooltipLeaveTimer) {
        clearTimeout(this.soundChangeTooltipLeaveTimer);
        this.soundChangeTooltipLeaveTimer = null;
      }
      return;
    }

    const relatedSoundChangeTarget = this.getSoundChangeTooltipTarget(relatedTarget);
    const relatedGuideId = String(relatedSoundChangeTarget?.getAttribute('data-guide-target') || '').trim();
    if (relatedGuideId && relatedGuideId === this.activeSoundChangeTooltipId) {
      if (this.soundChangeTooltipLeaveTimer) {
        clearTimeout(this.soundChangeTooltipLeaveTimer);
        this.soundChangeTooltipLeaveTimer = null;
      }
      return;
    }

    if (event?.type === 'focusout') {
      if (this.soundChangeTooltipLeaveTimer) {
        clearTimeout(this.soundChangeTooltipLeaveTimer);
        this.soundChangeTooltipLeaveTimer = null;
      }
      this.hideSoundChangeTooltip();
      return;
    }

    if (this.soundChangeTooltipLeaveTimer) {
      clearTimeout(this.soundChangeTooltipLeaveTimer);
    }
    this.soundChangeTooltipLeaveTimer = setTimeout(() => {
      this.soundChangeTooltipLeaveTimer = null;
      if (!this.soundChangeTooltipPinned) {
        this.hideSoundChangeTooltip();
      }
    }, 100);
  }

  handleGuideTargetInteraction(event) {
    const modelButton = event?.type === 'click' && event?.target instanceof Element
      ? event.target.closest('.sc-model-play-btn')
      : null;
    if (modelButton) {
      event.stopPropagation();
      if (!modelButton.disabled) this.playSpeechCoachModelAudio(modelButton);
      return;
    }
    const spokenModelButton = event?.type === 'click' && event?.target instanceof Element
      ? event.target.closest('[data-speak-phrase]')
      : null;
    if (spokenModelButton) {
      event.stopPropagation();
      if (!spokenModelButton.disabled) this.speakGuidePhrase(spokenModelButton.getAttribute('data-speak-phrase'));
      return;
    }
    const target = event?.target instanceof Element
      ? event.target.closest('[data-guide-target]')
      : null;
    const detailsToggle = event?.target instanceof Element
      ? event.target.closest('[data-role="guide-toggle-details"]')
      : null;
    if (detailsToggle) {
      if (event.type === 'keydown') {
        event.preventDefault();
      }
      this.toggleConnectedSpeechGuideDetails();
      return;
    }
    if (!target) {
      this.hideSoundChangeTooltip();
      return;
    }
    if (event.type === 'keydown') {
      event.preventDefault();
    }
    const guideTarget = String(target.getAttribute('data-guide-target') || '').trim();
    if (!guideTarget) return;
    this.setSelectedGuideItem(guideTarget);

    if (this.pteView && target.closest('#ra-prompt-stage')) {
      if (this.activeSoundChangeTooltipId === guideTarget && this.soundChangeTooltipPinned) this.hideSoundChangeTooltip();
      else this.showSoundChangeTooltip(guideTarget, target, { pinned: true });
      return;
    }

    if (guideTarget.startsWith('boundary-')) {
      const subtype = target.dataset.soundChangeSubtype;
      if (subtype) {
        if (this.activeSoundChangeTooltipId === guideTarget && this.soundChangeTooltipPinned) {
          this.hideSoundChangeTooltip();
        } else {
          this.showSoundChangeTooltip(guideTarget, target, { pinned: true });
        }
        return;
      }
    }
    this.hideSoundChangeTooltip();
  }

  setSelectedGuideItem(guideId) {
    if (!guideId || this.connectedSpeechPanelMode !== 'guide') {
      return;
    }
    this.selectedGuideItemId = guideId;
    this.renderConnectedSpeechGuidePanel();
  }

  toggleConnectedSpeechGuideDetails(forceExpanded = null) {
    if (this.connectedSpeechPanelMode !== 'guide') return;
    if (!this.isCompactConnectedSpeechGuideLayout()) {
      this.guideExplanationsExpanded = true;
      this.renderConnectedSpeechGuidePanel();
      return;
    }
    this.guideExplanationsToggled = true;
    this.guideExplanationsExpanded = typeof forceExpanded === 'boolean'
      ? forceExpanded
      : !this.guideExplanationsExpanded;
    this.renderConnectedSpeechGuidePanel();
  }

  /**
   * Keep the rail scrolled to whichever card matches the current selection, so
   * clicking a marked word in the passage brings its explanation into view
   * instead of leaving the learner to hunt for it.
   */
  scrollSelectedGuideCardIntoView() {
    const selectedGuideId = String(this.selectedGuideItemId || '');
    if (!selectedGuideId || this.connectedSpeechPanelMode !== 'guide') return;
    const list = document.getElementById('ra-connected-speech-list');
    if (!list) return;
    const card = list.querySelector(`.sc-guide-item[data-guide-item="${CSS.escape(selectedGuideId)}"]`);
    if (!card) return;
    try {
      card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    } catch (_) {
      card.scrollIntoView(false);
    }
  }

  /**
   * Hovering a coach card lights the word it describes, up in the passage. The
   * results view already did this against the recognized transcript; the
   * preview view had no link between a card and its word at all.
   */
  bindGuideRailHover(container) {
    if (!container || container.dataset.raGuideHoverBound === 'true') return;
    container.dataset.raGuideHoverBound = 'true';

    // Join on word index, not on data-guide-target: the stage only carries
    // guide targets for weak forms and sound changes, so a linking card had
    // nothing to point at. Every rendered word carries data-word-index.
    const highlight = (card, on) => {
      const stage = document.getElementById('ra-prompt-stage');
      if (!stage || !card) return;
      const start = Number(card.getAttribute('data-start-word'));
      const end = Number(card.getAttribute('data-end-word'));
      const guideId = card.getAttribute('data-guide-item');
      const matched = new Set();
      if (Number.isFinite(start)) {
        const last = Number.isFinite(end) ? end : start;
        for (let i = Math.min(start, last); i <= Math.max(start, last); i += 1) {
          stage.querySelectorAll(`[data-word-index="${i}"]`).forEach((n) => matched.add(n));
        }
      }
      if (guideId) {
        stage.querySelectorAll(`[data-guide-target="${CSS.escape(guideId)}"]`).forEach((n) => matched.add(n));
      }
      matched.forEach((node) => node.classList.toggle('sc-token--hovered', on));
    };

    // Synthesis fallback playback for cards with no recorded clip.
    container.addEventListener('click', (e) => {
      const speakBtn = e.target.closest('[data-speak-phrase]');
      if (!speakBtn) return;
      e.preventDefault();
      e.stopPropagation();
      this.speakGuidePhrase(speakBtn.getAttribute('data-speak-phrase'));
    });

    container.addEventListener('mouseover', (e) => {
      const card = e.target.closest('.sc-guide-item');
      if (card) highlight(card, true);
    });
    container.addEventListener('mouseout', (e) => {
      const card = e.target.closest('.sc-guide-item');
      if (!card) return;
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      highlight(card, false);
    });

    // Keyboard parity: tabbing to a card lights its word exactly as hovering does.
    container.addEventListener('focusin', (e) => {
      const card = e.target.closest('.sc-guide-item');
      if (card) highlight(card, true);
    });
    container.addEventListener('focusout', (e) => {
      const card = e.target.closest('.sc-guide-item');
      if (!card) return;
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      highlight(card, false);
    });
  }

  syncGuideSelectionState() {
    const selectedGuideId = String(this.selectedGuideItemId || '');
    document.querySelectorAll('[data-guide-target]').forEach((node) => {
      const target = String(node.getAttribute('data-guide-target') || '');
      const selected = !!selectedGuideId && target === selectedGuideId && this.connectedSpeechPanelMode === 'guide';
      node.setAttribute('data-selected', selected ? 'true' : 'false');
      if (node.matches('button, [role="button"]')) {
        node.setAttribute('aria-pressed', selected ? 'true' : 'false');
      }
      // The card wrapper carries the selected styling, and only the inner
      // button is tagged with data-guide-target — without this the highlight
      // stayed on whichever card happened to render first.
      node.closest('.sc-guide-item')?.setAttribute('data-selected', selected ? 'true' : 'false');
      if (node.closest('#ra-linking-fallback-list')) {
        const layer = String(node.getAttribute('data-guide-layer') || 'linking');
        const layerStyles = layer === 'assimilation'
          ? { background: 'rgba(180, 83, 9, 0.10)', color: '#b45309', border: 'rgba(0,0,0,0.08)' }
          : { background: 'rgba(37, 99, 235, 0.08)', color: '#1d4ed8', border: 'rgba(0,0,0,0.08)' };
        node.style.background = selected ? 'rgba(245, 158, 11, 0.12)' : layerStyles.background;
        node.style.color = selected ? '#92400e' : layerStyles.color;
        node.style.boxShadow = selected ? '0 0 0 2px rgba(245, 158, 11, 0.18)' : 'none';
        node.style.borderColor = selected ? '#f59e0b' : layerStyles.border;
      }
      if (node.hasAttribute('data-connected-speech-layer')) {
        node.style.outline = selected ? '2px solid rgba(245, 158, 11, 0.7)' : 'none';
        node.style.outlineOffset = selected ? '2px' : '0';
      } else if (node.closest('#ra-connected-speech-badges')) {
        node.style.boxShadow = selected
          ? '0 0 0 2px rgba(245, 158, 11, 0.18), 0 1px 2px rgba(180, 83, 9, 0.12)'
          : '0 1px 2px rgba(180, 83, 9, 0.12)';
      }
    });
  }

  clearSoundChangeTooltipAssociations(stage = document.getElementById('ra-prompt-stage')) {
    stage?.querySelectorAll('[aria-describedby~="ra-sound-change-tooltip"]').forEach((node) => {
      const remainingIds = String(node.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== 'ra-sound-change-tooltip');
      if (remainingIds.length) {
        node.setAttribute('aria-describedby', remainingIds.join(' '));
      } else {
        node.removeAttribute('aria-describedby');
      }
    });
  }

  associateSoundChangeTooltipTargets(spans, stage) {
    this.clearSoundChangeTooltipAssociations(stage);
    spans.forEach((span) => {
      const describedByIds = new Set(String(span.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      describedByIds.add('ra-sound-change-tooltip');
      span.setAttribute('aria-describedby', Array.from(describedByIds).join(' '));
    });
  }

  positionSoundChangeTooltip(tooltip, stage, spans) {
    const stageRect = stage.getBoundingClientRect();
    const rects = spans.map((span) => span.getBoundingClientRect());
    const leftMost = Math.min(...rects.map((rect) => rect.left));
    const rightMost = Math.max(...rects.map((rect) => rect.right));
    const topMost = Math.min(...rects.map((rect) => rect.top));
    const bottomMost = Math.max(...rects.map((rect) => rect.bottom));
    const centerX = ((leftMost + rightMost) / 2) - stageRect.left;
    const targetTop = topMost - stageRect.top;
    const belowTop = bottomMost - stageRect.top + 8;
    const arrowEl = tooltip.querySelector('.ra-sound-change-tooltip__arrow');

    tooltip.style.display = 'block';
    tooltip.style.left = `${centerX}px`;
    tooltip.style.top = `${belowTop}px`;
    tooltip.style.transform = 'translateX(-50%)';
    tooltip.classList.remove('ra-sound-change-tooltip--above');
    if (arrowEl) arrowEl.style.left = '50%';

    const tooltipRect = tooltip.getBoundingClientRect();
    const aboveTop = targetTop - tooltipRect.height - 8;
    if (tooltipRect.bottom > stageRect.bottom - 4 && aboveTop >= 4) {
      tooltip.style.top = `${aboveTop}px`;
      tooltip.classList.add('ra-sound-change-tooltip--above');
    } else {
      tooltip.style.top = `${belowTop}px`;
      tooltip.classList.remove('ra-sound-change-tooltip--above');
    }

    const updatedRect = tooltip.getBoundingClientRect();
    if (updatedRect.left < stageRect.left) {
      const shift = stageRect.left - updatedRect.left + 4;
      tooltip.style.transform = `translateX(calc(-50% + ${shift}px))`;
      if (arrowEl) arrowEl.style.left = `calc(50% - ${shift}px)`;
    } else if (updatedRect.right > stageRect.right) {
      const shift = updatedRect.right - stageRect.right + 4;
      tooltip.style.transform = `translateX(calc(-50% - ${shift}px))`;
      if (arrowEl) arrowEl.style.left = `calc(50% + ${shift}px)`;
    }

    tooltip.setAttribute('aria-hidden', 'false');
  }

  normalizeGuidePopoverIpa(value, word = '') {
    const phonetics = window.Phonetics;
    if (!value || typeof phonetics?.normalizeIPA !== 'function') return '';
    const source = String(value);
    const tokens = [...source.matchAll(/\/([^/]+)\//g)].map((match) => match[1]);
    if (!tokens.length) return '';
    const normalized = tokens
      .map((token) => phonetics.normalizeIPA(token, word))
      .filter(Boolean)
      .map((token) => `/${String(token).replace(/^\/+|\/+$/g, '')}/`);
    return [...new Set(normalized)].join(' or ');
  }

  getGuidePopoverIpa(item) {
    if (!item) return '';
    const label = String(item.label || '').trim();
    const weak = this.normalizeGuidePopoverIpa(item.targetIpa || item.spokenAs, label);
    const strong = this.normalizeGuidePopoverIpa(item.strongAs, label);
    if (strong && weak) return `Strong ${strong} · Weak ${weak}`;
    if (weak || strong) return weak || strong;

    if (item.category === 'linking') {
      const wordIpas = label.split(/\s+/).map((word) => {
        const clean = word.replace(/[^a-zA-Z']/g, '').toLowerCase();
        const source = this.sharedLinkingPronunciations.get(clean) || '';
        return this.normalizeGuidePopoverIpa(source, clean);
      }).filter(Boolean);
      if (wordIpas.length) return wordIpas.join(' + ');
    }
    return '';
  }

  buildGuidePopoverListenControl(item) {
    if (!item) return '';
    const guideEvent = this.getSpeechCoachGuideEvent(item);
    const model = guideEvent ? this.getSpeechCoachAudioEntry(guideEvent) : null;
    const escapeHtml = ReadAloudMode.escapeHtml;
    if (model?.status === 'ready' && model.file) {
      return `<button class="sc-model-play-btn sc-audio-btn sc-audio-btn--model" type="button" data-model-src="${escapeHtml(String(model.file))}" aria-label="Listen"><span aria-hidden="true">▶</span><span>Listen</span></button>`;
    }
    const phrase = String(item.label || '').trim();
    if (phrase && window.speechSynthesis) {
      return `<button class="sc-audio-btn sc-audio-btn--model sc-audio-btn--synth" type="button" data-speak-phrase="${escapeHtml(phrase)}" aria-label="Listen"><span aria-hidden="true">▶</span><span>Listen</span></button>`;
    }
    return '';
  }

  showSoundChangeTooltip(guideId, clickedSpan, { pinned = false } = {}) {
    const tooltip = document.getElementById('ra-sound-change-tooltip');
    const stage = document.getElementById('ra-prompt-stage');
    if (!tooltip || !stage) return;

    const subtype = clickedSpan?.dataset?.soundChangeSubtype;
    let copy = subtype && window.ReadAloudLinking
      ? window.ReadAloudLinking.getSoundChangeCopy(subtype)
      : null;
    const item = this.pteView && (
      this.currentGuideInteractionItems?.get(guideId)
      || this.currentGuideExplanationItems.find(entry => entry.id === guideId)
    );
    if (!copy && item) copy = { arrow: item.spokenAs || item.sayItLike || item.badge, explanation: item.explanation };
    if (!copy) {
      this.hideSoundChangeTooltip();
      return;
    }

    const spans = this.getSoundChangeTooltipTargets(guideId, stage);
    if (!spans.length) {
      this.hideSoundChangeTooltip();
      return;
    }

    const wordTexts = spans.map(s => s.textContent.trim());
    const wordPair = wordTexts.join(' ');

    const wordsEl = tooltip.querySelector('.ra-sound-change-tooltip__words');
    const transformEl = tooltip.querySelector('.ra-sound-change-tooltip__transform')
      || tooltip.querySelector('.ra-sound-change-tooltip__label');
    const explanationEl = tooltip.querySelector('.ra-sound-change-tooltip__explanation');
    if (wordsEl) wordsEl.textContent = wordPair;
    if (transformEl) transformEl.textContent = copy.arrow || 'Sound change';
    if (explanationEl) explanationEl.textContent = copy.explanation || '';
    const badge = tooltip.querySelector('.ra-sound-change-tooltip__badge');
    if (badge) badge.textContent = item?.badge || 'Sound Change';

    const sayEl = tooltip.querySelector('.ra-sound-change-tooltip__say');
    const sayValueEl = tooltip.querySelector('.ra-sound-change-tooltip__say-value');
    const sayItLike = String(item?.sayItLike || copy.sayItLike || '').trim();
    if (sayValueEl) sayValueEl.textContent = sayItLike;
    if (sayEl) sayEl.hidden = !sayItLike;

    const ipaEl = tooltip.querySelector('.ra-sound-change-tooltip__ipa');
    const ipaValueEl = tooltip.querySelector('.ra-sound-change-tooltip__ipa-value');
    const ipa = this.getGuidePopoverIpa(item || copy);
    if (ipaValueEl) ipaValueEl.textContent = ipa;
    if (ipaEl) ipaEl.hidden = !ipa;

    const audioEl = tooltip.querySelector('.ra-sound-change-tooltip__audio');
    if (audioEl) audioEl.innerHTML = this.buildGuidePopoverListenControl(item);

    const closeBtn = tooltip.querySelector('.ra-sound-change-tooltip__close');
    if (closeBtn) {
      closeBtn.onclick = (e) => { e.stopPropagation(); this.hideSoundChangeTooltip(); };
    }

    this.associateSoundChangeTooltipTargets(spans, stage);
    this.positionSoundChangeTooltip(tooltip, stage, spans);

    this.activeSoundChangeTooltipId = guideId;
    this.soundChangeTooltipPinned = !!pinned;
  }

  hideSoundChangeTooltip() {
    if (this.soundChangeTooltipLeaveTimer) {
      clearTimeout(this.soundChangeTooltipLeaveTimer);
      this.soundChangeTooltipLeaveTimer = null;
    }
    const tooltip = document.getElementById('ra-sound-change-tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
      tooltip.setAttribute('aria-hidden', 'true');
      tooltip.classList.remove('ra-sound-change-tooltip--above');
    }
    this.clearSoundChangeTooltipAssociations();
    this.activeSoundChangeTooltipId = null;
    this.soundChangeTooltipPinned = false;
  }

  async loadManifest() {
    if (this.hasLoadedManifest) return;
    try {
      const res = await fetch('/database/RA/Voice/audio/manifest.json');
      if (res.ok) {
        this.audioManifest = await res.json();
      }
    } catch (error) {
      console.warn('RA audio manifest not available:', error.message);
    }
    this.hasLoadedManifest = true;
  }

  updateAudioPlayerVisibility() {
    const player = document.getElementById('ra-audio-player');
    const playBtn = document.getElementById('ra-play-audio-btn');
    if (!player) return;

    player.style.display = 'block';

    if (this.audioManifest && this.currentQuestionId && this.audioManifest[this.currentQuestionId]) {
      if (playBtn) {
        const hasVoiceAudio = this._resolveAudioFilename() !== null;
        playBtn.disabled = !hasVoiceAudio && !this.selectedVoiceId;
        playBtn.innerHTML = hasVoiceAudio ? '▶ Play' : (this.selectedVoiceId ? '▶ Play' : 'Pick a voice');
        playBtn.style.opacity = hasVoiceAudio || this.selectedVoiceId ? '1' : '0.5';
        playBtn.title = hasVoiceAudio ? 'Listen to reference audio' : 'Select a voice first';
      }
      this.updateAudioSrc();
      this.refreshQuestionPickerV7AudioShortcuts();
      return;
    }

    if (playBtn) {
      playBtn.disabled = true;
      playBtn.innerHTML = 'Unavailable';
      playBtn.style.opacity = '0.5';
      playBtn.title = 'Audio not yet generated for this text';
    }

    this.refreshQuestionPickerV7AudioShortcuts();
  }

  /** Resolve the audio filename for the current question + selected voice */
  _resolveAudioFilename() {
    if (!this.audioManifest || !this.currentQuestionId || !this.selectedGender) return null;
    const entry = this.audioManifest[this.currentQuestionId];
    if (!entry) return null;
    const genderBlock = entry[this.selectedGender];
    if (!genderBlock) return null;

    // New schema: gender -> voiceId -> { name, accent, files: { "100": filename, "80": filename } }
    if (this.selectedVoiceId && genderBlock[this.selectedVoiceId]) {
      const voiceEntry = genderBlock[this.selectedVoiceId];
      if (voiceEntry.files) {
        return voiceEntry.files[this.selectedSpeed] || voiceEntry.files['100'] || Object.values(voiceEntry.files)[0] || null;
      }
    }

    // Legacy schema: gender -> { voiceId, voiceName, files: { "100": filename, "80": filename } }
    if (genderBlock.files) {
      return genderBlock.files[this.selectedSpeed] || genderBlock.files['100'] || genderBlock.files['80'] || null;
    }

    // Fallback: pick any available voice for this gender in new schema
    if (this.selectedGender) {
      const voices = ReadAloudMode.KOKORO_VOICES[this.selectedGender] || [];
      for (const v of voices) {
        if (genderBlock[v.id] && genderBlock[v.id].files) {
          const f = genderBlock[v.id].files[this.selectedSpeed] || genderBlock[v.id].files['100'] || Object.values(genderBlock[v.id].files)[0];
          if (f) return f;
        }
      }
    }
    return null;
  }

  updateAudioSrc() {
    const audioEl = document.getElementById('ra-elevenlabs-audio');
    if (!audioEl) return;
    const filename = this._resolveAudioFilename();
    if (filename) {
      audioEl.src = `/database/RA/Voice/audio/Audio by folder/${this.currentQuestionId}/${filename}`;
      audioEl.load();
    }
  }

  setGender(gender) {
    // Stop any playing audio
    const audioEl = document.getElementById('ra-elevenlabs-audio');
    if (audioEl && !audioEl.paused) {
      audioEl.pause();
      audioEl.currentTime = 0;
      const playBtn = document.getElementById('ra-play-audio-btn');
      if (playBtn) playBtn.textContent = '▶ Play';
    }

    this.selectedGender = gender;
    const maleBtn = document.getElementById('ra-voice-male');
    const femaleBtn = document.getElementById('ra-voice-female');
    if (gender === 'male') {
      if (maleBtn) maleBtn.classList.add('ra-toggle-active');
      if (femaleBtn) femaleBtn.classList.remove('ra-toggle-active');
    } else {
      if (femaleBtn) femaleBtn.classList.add('ra-toggle-active');
      if (maleBtn) maleBtn.classList.remove('ra-toggle-active');
    }
    this.randomizeVoice();
    this.renderVoiceDropdown();
    this.closeVoiceDropdown();
  }

  randomizeVoice() {
    if (!this.selectedGender) return;
    const voices = ReadAloudMode.KOKORO_VOICES[this.selectedGender];
    if (!voices || voices.length === 0) return;
    const randomVoice = voices[Math.floor(Math.random() * voices.length)];
    this.selectedVoiceId = randomVoice.id;
    this.selectedVoiceName = randomVoice.name;
    this.selectedVoiceAccent = randomVoice.accent;
    this._updateVoicePickerDisplay();
    this.updateAudioSrc();
    this.updateAudioPlayerVisibility();
  }

  setVoice(voiceId) {
    if (!this.selectedGender) return;
    const voices = ReadAloudMode.KOKORO_VOICES[this.selectedGender];
    const voice = voices?.find(v => v.id === voiceId);
    if (!voice) return;
    this.selectedVoiceId = voice.id;
    this.selectedVoiceName = voice.name;
    this.selectedVoiceAccent = voice.accent;
    this._updateVoicePickerDisplay();
    this.updateAudioSrc();
    this.updateAudioPlayerVisibility();
    this.closeVoiceDropdown();
  }

  _updateVoicePickerDisplay() {
    const pickerBtn = document.getElementById('ra-voice-picker-btn');
    if (!pickerBtn) return;
    if (this.selectedVoiceName) {
      pickerBtn.innerHTML = `🎲 ${this.selectedVoiceName} <span style="color: var(--text-muted); font-weight: 400;">— ${this.selectedVoiceAccent}</span>`;
    } else {
      pickerBtn.innerHTML = '🎲 Pick a voice';
    }
    // Update checkmark in dropdown
    const listEl = document.getElementById('ra-voice-dropdown-list');
    if (listEl) {
      listEl.querySelectorAll('.ra-voice-option').forEach(opt => {
        const check = opt.querySelector('.ra-voice-check');
        if (check) check.style.visibility = opt.dataset.voiceId === this.selectedVoiceId ? 'visible' : 'hidden';
      });
    }
  }

  renderVoiceDropdown() {
    const listEl = document.getElementById('ra-voice-dropdown-list');
    if (!listEl || !this.selectedGender) return;
    const voices = ReadAloudMode.KOKORO_VOICES[this.selectedGender] || [];
    listEl.innerHTML = voices.map(v => {
      const isSelected = v.id === this.selectedVoiceId;
      return `<div class="ra-voice-option" data-voice-id="${v.id}" role="option" tabindex="0"
        style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; border-radius: 6px; transition: background 0.15s;"
        onmouseenter="this.style.background='rgba(59,130,246,0.08)'" onmouseleave="this.style.background='transparent'">
        <span class="ra-voice-check" style="visibility: ${isSelected ? 'visible' : 'hidden'}; font-size: 0.85rem; color: #3b82f6;">✓</span>
        <span style="font-weight: 500; font-size: 0.85rem;">${v.name}</span>
        <span style="color: var(--text-muted, #6b7280); font-size: 0.8rem; font-weight: 400;">— ${v.accent}</span>
      </div>`;
    }).join('');
  }

  toggleVoiceDropdown() {
    this.voiceDropdownOpen = !this.voiceDropdownOpen;
    const listEl = document.getElementById('ra-voice-dropdown-list');
    const toggleBtn = document.getElementById('ra-voice-dropdown-toggle');
    if (listEl) listEl.style.display = this.voiceDropdownOpen ? 'block' : 'none';
    if (toggleBtn) toggleBtn.textContent = this.voiceDropdownOpen ? '▴' : '▾';
  }

  closeVoiceDropdown() {
    this.voiceDropdownOpen = false;
    const listEl = document.getElementById('ra-voice-dropdown-list');
    const toggleBtn = document.getElementById('ra-voice-dropdown-toggle');
    if (listEl) listEl.style.display = 'none';
    if (toggleBtn) toggleBtn.textContent = '▾';
  }

  handleVoiceDropdownClick(e) {
    const option = e.target.closest('.ra-voice-option');
    if (!option) return;
    e.stopPropagation();
    const voiceId = option.dataset.voiceId;
    if (voiceId) this.setVoice(voiceId);
  }

  setSpeed(speed) {
    this.selectedSpeed = speed;
    const normalBtn = document.getElementById('ra-speed-100');
    const slowBtn = document.getElementById('ra-speed-80');
    if (speed === '100') {
      if (normalBtn) normalBtn.classList.add('ra-toggle-active');
      if (slowBtn) slowBtn.classList.remove('ra-toggle-active');
    } else {
      if (slowBtn) slowBtn.classList.add('ra-toggle-active');
      if (normalBtn) normalBtn.classList.remove('ra-toggle-active');
    }
    this.updateAudioSrc();
  }

  playAudio() {
    const audioEl = document.getElementById('ra-elevenlabs-audio');
    const playBtn = document.getElementById('ra-play-audio-btn');
    if (!audioEl) return;

    if (audioEl.paused) {
      this.stopSpeechCoachModelAudio();
      this.stopSpeechCoachYoursAudio({ pause: true, resetTime: true });
      const recordedAudioEl = document.getElementById('ra-user-recording-audio');
      const recordedPlayBtn = document.getElementById('ra-play-recording-btn');
      if (recordedAudioEl && !recordedAudioEl.paused) {
        recordedAudioEl.pause();
        recordedAudioEl.currentTime = 0;
      }
      if (recordedPlayBtn) recordedPlayBtn.textContent = 'Play your recording';
      audioEl.play();
      if (playBtn) playBtn.textContent = 'Pause';
      audioEl.onended = () => {
        if (playBtn) playBtn.textContent = 'Play';
      };
      return;
    }

    audioEl.pause();
    if (playBtn) playBtn.textContent = 'Play';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.ReadAloudMode = new ReadAloudMode();

  // Deep-link support: listen for PracticeRouter question navigation events
  window.addEventListener('practice-route-question', (event) => {
    const { mode, questionId } = event.detail || {};
    if (mode !== 'read-aloud' || !questionId || !window.ReadAloudMode) return;
    const ra = window.ReadAloudMode;
    if (!ra.isActive || !ra.hasLoadedDatabase || !ra.database) return;
    // Find the database index by question ID
    const idx = ra.database.findIndex((row) => String(row.ID) === String(questionId));
    if (idx >= 0) {
      ra.loadSpecificPrompt(idx);
    }
  });
});
