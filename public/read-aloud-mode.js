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
    this.pendingBlob = null;
    this.pendingSession = null;
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
    this.selectedGuideItemId = null;
    this.currentGuideHasVisibleAssimilation = false;
    this.guideExplanationsExpanded = null;
    this.guideExplanationsToggled = false;

    // Kokoro TTS voice state
    this.audioManifest = null;
    this.currentQuestionId = null;
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
    // Status line the results panel was rendered with. Kept so a later
    // updateUIForState() cannot replace a scoring error with 'Analysis complete.'
    this.assessmentStatusMessage = '';
    this.isSubmitInFlight = false;
    this.userRecordingUrl = null;

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

  getActiveConnectedSpeechModes() {
    return [...(this.connectedSpeechModes || [])];
  }

  isConnectedSpeechModeActive(mode) {
    return !!this.connectedSpeechModes?.has(this.normalizeConnectedSpeechMode(mode));
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
    document.getElementById('ra-show-advanced-btn')?.addEventListener('click', () => this.toggleAdvancedAnalysisView());

    document.getElementById('ra-voice-male')?.addEventListener('click', () => this.setGender('male'));
    document.getElementById('ra-voice-female')?.addEventListener('click', () => this.setGender('female'));
    document.getElementById('ra-voice-picker-btn')?.addEventListener('click', () => this.randomizeVoice());
    document.getElementById('ra-voice-dropdown-toggle')?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleVoiceDropdown(); });
    document.getElementById('ra-voice-dropdown-list')?.addEventListener('click', (e) => this.handleVoiceDropdownClick(e));
    document.addEventListener('click', () => this.closeVoiceDropdown());
    document.getElementById('ra-speed-100')?.addEventListener('click', () => this.setSpeed('100'));
    document.getElementById('ra-speed-80')?.addEventListener('click', () => this.setSpeed('80'));
    document.getElementById('ra-play-audio-btn')?.addEventListener('click', () => this.playAudio());
    // Settings: toggle / events open Settings sheet
    document.getElementById('ra-practice-target-toggle')?.addEventListener('click', () => this.openSettingsSheet());

    window.addEventListener('spc-open-settings', (e) => {
      if (!e.detail?.modeId || e.detail?.modeId === 'read-aloud') {
        this.openSettingsSheet();
      }
    });

    const handleViewChange = () => {
      const isRaVisible = document.getElementById('mode-read-aloud')?.style.display !== 'none';
      if (this.isActive || isRaVisible) {
        if (typeof this.renderPromptForCurrentView === 'function') {
          this.renderPromptForCurrentView();
        }
        const viewMode = this.getEffectiveViewMode();
        if (this.state === 'RESULTS') {
          const showAdvContainer = document.getElementById('ra-show-advanced-container');
          const showAdvBtn = document.getElementById('ra-show-advanced-btn');
          if (viewMode === 'basic') {
            if (showAdvContainer) showAdvContainer.style.display = 'block';
            if (showAdvBtn) showAdvBtn.textContent = '✨ Show Advanced Analysis';
            this.hideConnectedSpeechPanel();
          } else if (this.lastAssessmentPayload?.connectedSpeech) {
            if (showAdvContainer) showAdvContainer.style.display = 'none';
            this.renderConnectedSpeechResults(this.lastAssessmentPayload.connectedSpeech, {
              transcriptText: this.lastAssessmentPayload.recognizedText || this.currentPromptPlainText,
              sessionViewMode: viewMode,
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
    document.addEventListener('keydown', (event) => this.handleQuestionPickerV7Keydown(event), true);

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
    document.getElementById('ra-prompt-stage')?.addEventListener('click', (event) => this.handleGuideTargetInteraction(event));
    document.getElementById('ra-prompt-stage')?.addEventListener('keydown', (event) => this.handleGuideTargetKeydown(event));
    document.getElementById('ra-connected-speech-badges')?.addEventListener('click', (event) => this.handleGuideTargetInteraction(event));
    document.getElementById('ra-connected-speech-badges')?.addEventListener('keydown', (event) => this.handleGuideTargetKeydown(event));
    document.getElementById('ra-connected-speech-list')?.addEventListener('click', (event) => this.handleGuideTargetInteraction(event));
    document.getElementById('ra-connected-speech-list')?.addEventListener('keydown', (event) => this.handleGuideTargetKeydown(event));
    document.getElementById('ra-linking-fallback-list')?.addEventListener('click', (event) => this.handleGuideTargetInteraction(event));
    document.getElementById('ra-linking-fallback-list')?.addEventListener('keydown', (event) => this.handleGuideTargetKeydown(event));
    document.getElementById('ra-speech-coach-toggle')?.addEventListener('click', () => this.toggleSpeechCoachVisibility());
    document.getElementById('ra-layer-level1')?.addEventListener('click', () => this.setSpeechCoachLayerFilter('linking'));
    document.getElementById('ra-layer-level2')?.addEventListener('click', () => this.setSpeechCoachLayerFilter('all'));
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

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.isActive || !(this.chunkingEnabled || this.isConnectedSpeechEnabled()) || !this.currentPromptPlainText) return;
      this.renderPromptForCurrentView();
    });

    this.resizeObserver.observe(promptStage);
  }

  disconnectPromptStageObserver() {
    if (!this.resizeObserver) return;
    this.resizeObserver.disconnect();
    this.resizeObserver = null;
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
        if (this.isActive && this.currentPromptPlainText && this.isConnectedSpeechEnabled()) {
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
      if (!this.shouldApplyPromptRender(promptKey, renderToken) || !this.isConnectedSpeechEnabled()) {
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
      this.difficultyFilter = diff;
      diffSection.querySelectorAll('.read-aloud-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.diff === diff);
      });
      const filtered = this.getFilteredDatabase();
      const preferredRow = this.getPreferredFilteredPromptRow(filtered, { preferLastPrompt: true });
      this.syncQuestionPickerOptions(filtered, preferredRow);
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
    console.log('[RA] closeSettingsSheet execution fired!');
    if (this.settingsSheet && typeof this.settingsSheet.close === 'function') {
      this.settingsSheet.close();
    }
    const sheetEl = document.getElementById('ra-settings-sheet');
    if (sheetEl) {
      sheetEl.classList.remove('is-active');
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

    // Color map: each guide button has a unique active color
    const colorMap = new Map([
      [chunkBtn, { bg: '#2563eb', shadow: 'rgba(37, 99, 235, 0.25)' }],
      [linkingBtn, { bg: '#2563eb', shadow: 'rgba(37, 99, 235, 0.25)' }],
      [reducedWordsBtn, { bg: '#d97706', shadow: 'rgba(217, 119, 6, 0.25)' }],
      [soundChangesBtn, { bg: '#b45309', shadow: 'rgba(180, 83, 9, 0.25)' }]
    ]);

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
      const colors = colorMap.get(button);
      if (displayActive && colors) {
        button.style.background = colors.bg;
        button.style.color = '#ffffff';
        button.style.boxShadow = '0 1px 3px ' + colors.shadow;
      } else {
        button.style.background = 'transparent';
        button.style.color = '#1f2937';
        button.style.boxShadow = 'none';
      }
      button.style.opacity = available ? '1' : '0.45';
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

    const viewMode = this.getEffectiveViewMode();
    const instructionEl = document.getElementById('ra-guide-instruction') || document.getElementById('ra-prompt-instruction-text');
    if (instructionEl) {
      if (viewMode === 'basic') {
        instructionEl.textContent = 'Read the text aloud into your microphone. Speak at a natural pace with clear pronunciation and pauses at punctuation.';
      } else {
        const activeGuides = [];
        if (this.chunkingEnabled && chunkAvailable) activeGuides.push('chunking');
        if (this.isConnectedSpeechModeActive('linking')) activeGuides.push('linking');
        if (this.isConnectedSpeechModeActive('reduced_words')) activeGuides.push('reduced_words');
        if (this.isConnectedSpeechModeActive('sound_changes')) activeGuides.push('sound_changes');

        if (activeGuides.length === 0) {
          instructionEl.textContent = 'Select a guide mode below to highlight pause groups, linking, reduced words, or sound changes.';
        } else if (activeGuides.length === 1) {
          const mode = activeGuides[0];
          if (mode === 'chunking') {
            instructionEl.textContent = 'Chunking mode: Displays natural pause groups and phrase breaks to help you pace your reading smoothly.';
          } else if (mode === 'linking') {
            instructionEl.textContent = 'Linking mode: Highlights word boundaries where ending consonants blend into starting vowels.';
          } else if (mode === 'reduced_words') {
            instructionEl.textContent = 'Reduced words mode: Marks function words (e.g. to, and, of) pronounced with weak schwa sounds.';
          } else if (mode === 'sound_changes') {
            instructionEl.textContent = 'Sound changes mode: Shows assimilation, elision, and connected speech sound transformations.';
          }
        } else {
          const labels = activeGuides.map(m => {
            if (m === 'chunking') return 'Chunking (pause groups)';
            if (m === 'linking') return 'Linking (consonant-vowel joins)';
            if (m === 'reduced_words') return 'Reduced Words (weak forms)';
            return 'Sound Changes';
          });
          instructionEl.textContent = `Active guides: ${labels.join(' + ')}.`;
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
        instText.textContent = 'Read the text aloud into your microphone. Speak at a natural pace with clear pronunciation and pauses at punctuation.';
      }
    }

    this.restorePlainTextVisibility();
    this.setPromptText(this.currentPromptPlainText, this.currentPromptChunkedText);
    this.updatePromptGuideButtons();
    if (this.state !== 'RESULTS') {
      this.clearConnectedSpeechResults();
    }

    if (viewMode === 'basic' || !window.ReadAloudLinking || !this.isConnectedSpeechEnabled()) {
      return;
    }

    this.hydrateLinkingView(this.activePromptKey, this.activePromptRenderToken);
    this.scheduleHydrationRetry(this.activePromptKey, this.activePromptRenderToken);

    if (document.fonts?.ready && !this.pendingFontHydration) {
      this.pendingFontHydration = document.fonts.ready.then(() => {
        this.pendingFontHydration = null;
        if (this.isActive && this.isConnectedSpeechEnabled()) {
          this.hydrateLinkingView(this.activePromptKey, this.activePromptRenderToken);
        }
      }).catch(() => {
        this.pendingFontHydration = null;
      });
    }
  }

  async hydrateLinkingView(promptKey, renderToken, attempt = 0) {
    if (!window.ReadAloudLinking || !this.currentPromptPlainText || !this.isConnectedSpeechEnabled()) return;
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

    if (!this.shouldApplyPromptRender(targetPromptKey, targetToken) || !this.isConnectedSpeechEnabled()) {
      return;
    }

    this.cancelPendingHydration();
    this.pendingLinkingFrame = requestAnimationFrame(() => {
      this.pendingLinkingFrame = null;
      if (!this.shouldApplyPromptRender(targetPromptKey, targetToken) || !this.isConnectedSpeechEnabled()) {
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
      const familyOptions = { focusFamilies: this.getActiveConnectedSpeechModes() };
      if (typeof window.ReadAloudLinking.applyTokenAnnotations === 'function') {
        window.ReadAloudLinking.applyTokenAnnotations(wordMap, filteredAnalysis, familyOptions);
      }
      const summaryText = window.ReadAloudLinking.buildAccessibleSummary(filteredAnalysis, familyOptions);
      summary.textContent = summaryText;
      this.renderPromptGuideExplanations(filteredAnalysis);

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
  }

  isConnectedSpeechEnabled() {
    return !!this.connectedSpeechModes?.size;
  }

  shouldApplyPromptRender(promptKey, renderToken) {
    return this.isActive && this.activePromptKey === promptKey && this.activePromptRenderToken === renderToken;
  }

  shouldApplyPromptLoad(promptLoadToken) {
    return this.isActive && promptLoadToken === this.promptLifecycleToken;
  }

  invalidateRecordingSession() {
    this.recordingRequestId += 1;
    if (this.currentRecordingSession) {
      this.currentRecordingSession.disposition = 'discard';
    }
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
    this.cancelPendingHydration();
    this.stopTimer();
    this.invalidateRecordingSession();
    this.clearRecordedAudio();
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
    if (prepTimerBox) prepTimerBox.style.opacity = '0.4';
    if (recordTimerBox) recordTimerBox.style.opacity = '0.4';
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
    const resultBox = document.getElementById('ra-result-box');
    const accuracyElement = document.getElementById('ra-accuracy-value');
    const feedbackElement = document.getElementById('ra-transcript-feedback');
    const checkBtn = document.getElementById('ra-check-btn');
    const retryBtn = document.getElementById('ra-retry-btn');
    const showAdvContainer = document.getElementById('ra-show-advanced-container');
    const showAdvBtn = document.getElementById('ra-show-advanced-btn');
    if (resultBox) resultBox.style.display = 'none';
    if (accuracyElement) accuracyElement.textContent = '--';
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
      const success = await this.submitToAzure(this.pendingBlob, this.pendingSession);
      if (success) {
        this.pendingBlob = null;
        this.pendingSession = null;
        this.state = 'RESULTS';
        this.updateUIForState();
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
    if (!playBtn) return;
    const shouldShow = !!this.userRecordingUrl && this.state !== 'RECORDING' && this.state !== 'REQUESTING_MIC';
    
    if (shouldShow) {
      playBtn.style.position = 'absolute';
      playBtn.style.opacity = '0';
      playBtn.style.width = '1px';
      playBtn.style.height = '1px';
      playBtn.style.overflow = 'hidden';
      // The native audio element is the visible playback control. Keep this
      // legacy proxy in the DOM for stable event wiring, but do not let its
      // transparent 1px box intercept Check/Retry clicks in the shared shell.
      playBtn.style.pointerEvents = 'none';
      playBtn.style.display = '';
      playBtn.disabled = false;
      
      if (audioEl) {
        audioEl.style.display = 'inline-flex';
        audioEl.style.height = '40px';
        audioEl.style.width = '240px';
        audioEl.style.borderRadius = '20px';
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
      }
    }

    this.refreshQuestionPickerV7AudioShortcuts();
  }

  clearRecordedAudio() {
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
    if (this.userRecordingUrl && window.URL && typeof window.URL.revokeObjectURL === 'function') {
      window.URL.revokeObjectURL(this.userRecordingUrl);
    }
    this.userRecordingUrl = null;
    this.updateRecordedAudioControl();
  }

  setRecordedAudio(rawBlob) {
    this.clearRecordedAudio();
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
    };
    if (typeof audioEl.load === 'function') {
      audioEl.load();
    }
    this.updateRecordedAudioControl();
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

  playRecordedAudio() {
    const audioEl = document.getElementById('ra-user-recording-audio');
    const playBtn = document.getElementById('ra-play-recording-btn');
    if (!audioEl || !this.userRecordingUrl || !playBtn) return;

    if (audioEl.paused) {
      this.stopReferenceAudioPlayback();
      const playPromise = audioEl.play();
      playBtn.textContent = 'Pause your recording';
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          playBtn.textContent = 'Play your recording';
        });
      }
      return;
    }

    audioEl.pause();
    playBtn.textContent = 'Play your recording';
  }

  applyRecordingCaptureFailure(recordingSession, message) {
    if (!this.shouldApplyAssessment(recordingSession)) return;
    const accuracyElement = document.getElementById('ra-accuracy-value');
    this.showAssessmentDisplay();
    this.setAssessmentStatusMessage(message);
    if (accuracyElement) accuracyElement.textContent = '--';
  }

  updateUIForState() {
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
      if (prepTimerBox) prepTimerBox.style.opacity = '1';
      if (recordTimerBox) recordTimerBox.style.opacity = '0.4';
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
      if (statusMsg) statusMsg.textContent = 'Read the text silently to prepare.';
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
      if (prepTimerBox) prepTimerBox.style.opacity = '0.4';
      if (recordTimerBox) recordTimerBox.style.opacity = '1';
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
      if (prepTimerBox) prepTimerBox.style.opacity = '0.4';
      if (recordTimerBox) recordTimerBox.style.opacity = '0.4';
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
      if (prepTimerBox) prepTimerBox.style.opacity = '0.4';
      if (recordTimerBox) recordTimerBox.style.opacity = '0.4';
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
      if (prepTimerBox) prepTimerBox.style.opacity = '0.4';
      if (recordTimerBox) recordTimerBox.style.opacity = '0.4';
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
      if (prepTimerBox) prepTimerBox.style.opacity = '0.4';
      if (recordTimerBox) recordTimerBox.style.opacity = '0.4';
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

    if (prepTimerBox) prepTimerBox.style.opacity = '0.4';
    if (recordTimerBox) recordTimerBox.style.opacity = '0.4';
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

  startPrepTimer() {
    this.stopTimer();
    let timeLeft = this.prepSeconds;
    this.updateTimerDisplay('ra-prep-time', timeLeft);

    this.timerInterval = setInterval(() => {
      timeLeft -= 1;
      if (timeLeft < 0) {
        this.stopTimer();
        this.startRecording();
      } else {
        this.updateTimerDisplay('ra-prep-time', timeLeft);
      }
    }, 1000);
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
          return;
        }
        if (recordedChunks.length === 0) {
          this.applyRecordingCaptureFailure(recordingSession, 'We couldn’t capture that recording. Please try again.');
          return;
        }
        const rawBlob = new Blob(recordedChunks, { type: activeRecorder.mimeType || 'audio/webm' });
        recordingSession.rawBlob = rawBlob;
        this.setRecordedAudio(rawBlob);

        this.pendingBlob = rawBlob;
        this.pendingSession = recordingSession;
        this.state = 'RECORDED';
        this.updateUIForState();
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
  }

  updateTimerDisplay(elementId, seconds) {
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

  async submitToAzure(rawBlob, recordingSession) {
    if (this.isSubmitInFlight) return false;
    this.isSubmitInFlight = true;
    const statusMsg = document.getElementById('ra-status-message');
    try {
      if (!this.shouldApplyAssessment(recordingSession)) return false;
      if (statusMsg) statusMsg.textContent = 'Formatting audio...';
      const wavBlob = await this.prepareWavBlob(rawBlob);
      recordingSession.wavBlob = wavBlob;
      if (!this.shouldApplyAssessment(recordingSession)) return false;

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
        body: formData
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

      this.processAzureResults(payload, recordingSession);
      return true;
    } catch (err) {
      console.error('Azure assessment error:', err);
      if (!this.shouldApplyAssessment(recordingSession)) return false;
      const accuracyElement = document.getElementById('ra-accuracy-value');
      const feedbackElement = document.getElementById('ra-transcript-feedback');
      this.showAssessmentDisplay();
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
      this.setAssessmentStatusMessage(failureStatus);
      if (accuracyElement) accuracyElement.textContent = '--';
      if (feedbackElement) {
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
        feedbackElement.innerHTML = `<p style="line-height: 1.6; font-size: 1rem; padding: 10px; border: 1px solid #f3d1d1; border-radius: 8px; background: #fff7f7; color: #b42318;">${fallbackText}</p>`;
      }
      this.clearConnectedSpeechResults();
      return false;
    } finally {
      this.isSubmitInFlight = false;
    }
  }

  async prepareWavBlob(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    if (typeof audioContext.close === 'function') await audioContext.close().catch(() => { });

    const quality = this.validateAudioBufferQuality(rendered);
    if (!quality.passed) {
      const error = new Error('Audio quality validation failed');
      error.code = 'INVALID_AUDIO';
      error.reason = quality.reason;
      throw error;
    }

    return this.audioBufferToWav(rendered);
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

    const frameSize = Math.max(1, Math.round(sampleRate * 0.01));
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
    if (maxRms < minimumFrameRms) {
      return { passed: false, reason: 'no_speech' };
    }

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

    if (firstSpeechFrame === -1 || lastSpeechFrame === -1) {
      return { passed: false, reason: 'no_speech' };
    }

    const speechDurationMs = Math.round((lastSpeechFrame - firstSpeechFrame + 1) * frameDurationMs);
    const clippedRatio = clippedSamples / totalSamples;

    if (speechDurationMs < 250) {
      return { passed: false, reason: 'too_short' };
    }

    if (speechDurationMs > 40000) {
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

  processAzureResults(payload, recordingSession) {
    if (!this.shouldApplyAssessment(recordingSession)) return;
    const accuracyElement = document.getElementById('ra-accuracy-value');
    const feedbackElement = document.getElementById('ra-transcript-feedback');

    this.showAssessmentDisplay();
    this.setAssessmentStatusMessage('Analysis complete.');
    if (accuracyElement) accuracyElement.textContent = payload.accuracyScore.toString();

    if (feedbackElement) {
      const recognizedText = String(payload.recognizedText || '').trim();
      let html = '';
      if (recognizedText) {
        html += `<div style="margin-bottom: 14px; padding: 12px 16px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 1rem; color: #1e293b; text-align: left;">`;
        html += `<strong style="color: #475569; margin-right: 6px;">Recognized Speech:</strong>`;
        html += `<span style="font-style: italic; font-weight: 500;">"${recognizedText}"</span>`;
        html += `</div>`;
      }

      if (!payload.words || payload.words.length === 0) {
        if (!recognizedText) {
          html += `<p style="line-height: 1.6; font-size: 1.05rem; padding: 10px; color: #6b7280; text-align: center;">No speech detected.</p>`;
        }
      } else {
        const hasFiniteMetricValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
        const supplementalMetrics = [
          { label: 'Fluency', value: payload.fluencyScore },
          { label: 'Completeness', value: payload.completenessScore },
          { label: 'Overall', value: payload.pronScore }
        ].filter((metric) => hasFiniteMetricValue(metric.value));

        html += '<div style="text-align: left; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 6px; font-weight: 600;">Word Accuracy Breakdown</div>';
        html += '<p style="line-height: 1.6; font-size: 1.05rem; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff; text-align: left;">';
        payload.words.forEach(w => {
          let color = 'inherit';
          if (w.errorType === 'Omission') {
            color = '#9ca3af'; // gray out omitted
            html += `<span style="color: ${color}; text-decoration: line-through; margin-right: 4px;" title="Omitted">${w.word}</span> `;
          } else if (w.errorType === 'Insertion') {
            color = '#f59e0b'; // orange for extra words
            html += `<span style="color: ${color}; font-style: italic; margin-right: 4px;" title="Inserted (Extra) word">[${w.word}]</span> `;
          } else if (w.accuracyScore < 60) {
            color = '#ef4444'; // red
            html += `<span style="color: ${color}; font-weight: 500; margin-right: 4px;" title="Accuracy: ${w.accuracyScore}">${w.word}</span> `;
          } else if (w.accuracyScore < 80) {
            color = '#f59e0b'; // orange
            html += `<span style="color: ${color}; margin-right: 4px;" title="Accuracy: ${w.accuracyScore}">${w.word}</span> `;
          } else {
            color = '#10b981'; // green
            html += `<span style="color: ${color}; margin-right: 4px;" title="Accuracy: ${w.accuracyScore}">${w.word}</span> `;
          }
        });
        html += '</p>';
        if (supplementalMetrics.length > 0) {
          html += `<p style="margin-top: 10px; font-size: 0.95em; color: #4b5563; text-align: center;">${supplementalMetrics.map((metric) => `<strong>${metric.label}:</strong> ${metric.value}%`).join(' &nbsp;|&nbsp; ')}</p>`;
        }
      }
      feedbackElement.innerHTML = html;
    }

    this.lastAssessmentPayload = payload;
    this.lastAssessmentSession = recordingSession;

    const sessionView = recordingSession?.sessionViewMode || this.getEffectiveViewMode();
    const sessionLevel = recordingSession?.sessionConnectedSpeechLevel || this.connectedSpeechLevel;
    const showAdvContainer = document.getElementById('ra-show-advanced-container');
    const showAdvBtn = document.getElementById('ra-show-advanced-btn');

    if (sessionView === 'basic') {
      if (showAdvContainer) showAdvContainer.style.display = 'block';
      if (showAdvBtn) showAdvBtn.textContent = '✨ Show Advanced Analysis';
      this.hideConnectedSpeechPanel();
    } else {
      if (showAdvContainer) showAdvContainer.style.display = 'none';
      this.renderConnectedSpeechResults(payload.connectedSpeech, {
        transcriptText: payload.recognizedText || this.currentPromptPlainText,
        sessionViewMode: sessionView,
        sessionConnectedSpeechLevel: sessionLevel
      });
    }

    window.PTEAttemptArchive?.saveAttempt?.({
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
    }).catch((error) => console.warn('[PTE Archive] Read Aloud save failed:', error));
  }

  clearConnectedSpeechResults() {
    if (this._segmentInterval) {
      clearInterval(this._segmentInterval);
      this._segmentInterval = null;
    }
    this.hideConnectedSpeechPanel();
  }

  hideConnectedSpeechPanel() {
    const box = document.getElementById('ra-connected-speech-box');
    const label = document.getElementById('ra-connected-speech-label');
    const list = document.getElementById('ra-connected-speech-list');
    const meta = document.getElementById('ra-connected-speech-meta');
    const summary = document.getElementById('ra-connected-speech-summary');
    const paragraph = document.getElementById('ra-connected-speech-paragraph');
    this.connectedSpeechPanelMode = 'hidden';
    this.currentGuideExplanationItems = [];
    this.selectedGuideItemId = null;
    this.currentGuideHasVisibleAssimilation = false;
    this.guideExplanationsExpanded = null;
    this.guideExplanationsToggled = false;
    if (box) box.style.display = 'none';
    if (paragraph) paragraph.innerHTML = '';
    if (label) label.textContent = 'Speech Coach';
    if (list) list.innerHTML = '';
    if (meta) meta.textContent = 'Preview';
    if (summary) summary.textContent = '';
  }

  toggleAdvancedAnalysisView() {
    const box = document.getElementById('ra-connected-speech-box');
    const btn = document.getElementById('ra-show-advanced-btn');
    if (!box || !btn) return;

    const isHidden = box.style.display === 'none' || !box.style.display;
    if (isHidden) {
      if (this.lastAssessmentPayload?.connectedSpeech) {
        this.renderConnectedSpeechResults(this.lastAssessmentPayload.connectedSpeech, {
          transcriptText: this.lastAssessmentPayload.recognizedText || this.currentPromptPlainText,
          sessionViewMode: 'advanced',
          sessionConnectedSpeechLevel: 'sound_changes'
        });
      }
      box.style.display = 'block';
      btn.textContent = 'Hide Advanced Analysis';
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      this.hideConnectedSpeechPanel();
      btn.textContent = '✨ Show Advanced Analysis';
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

    const rawItems = window.ReadAloudLinking.buildGuideExplanationItems(analysis);
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
    const seen = new Set();
    const items = [];
    for (const item of rawItems) {
      const itemCategory = this.normalizeConnectedSpeechMode(
        item?.category || item?.layer || item?.subtype || item?.badge || ''
      );
      if (allowedCategories && allowedCategories.size && !allowedCategories.has(itemCategory)) {
        continue;
      }
      const key = `${item.label}|${item.spokenAs}|${item.badge}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({ ...item, category: itemCategory });
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
    const paletteForLayer = (layer) => {
      if (layer === 'assimilation') {
        return {
          badgeStyle: 'background: rgba(180, 83, 9, 0.14); color: #92400e;',
          borderStyle: 'border-left: 2px solid #b45309;'
        };
      }
      if (layer === 'weak_forms') {
        return {
          badgeStyle: 'background: rgba(217, 119, 6, 0.14); color: #92400e;',
          borderStyle: 'border-left: 2px solid #d97706;'
        };
      }
      return {
        badgeStyle: 'background: rgba(37, 99, 235, 0.12); color: #1d4ed8;',
        borderStyle: 'border-left: 2px solid #2563eb;'
      };
    };

    box.style.display = 'block';
    label.textContent = 'Speech Coach';
    meta.textContent = this.connectedSpeechPanelMode === 'results' ? 'Feedback' : 'Preview';
    const toggleBtn = document.getElementById('ra-speech-coach-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = this.speechCoachVisible ? '\ud83d\udc41 Hide' : '\ud83d\udc41 Show';
      toggleBtn.setAttribute('aria-expanded', this.speechCoachVisible ? 'true' : 'false');
    }
    if (!this.speechCoachVisible) {
      list.style.display = 'none';
      summary.style.display = 'none';
    } else {
      summary.style.display = '';
    }
    summary.textContent = noSoundChangeMessage
      ? 'No sound changes in this sentence.'
      : (compactView && !showFullList
        ? 'Start here.'
        : `${items.length} pronunciation hint${items.length === 1 ? '' : 's'} in this prompt`);
    const renderGuideCard = (item, selected) => {
      const palette = paletteForLayer(item.layer);
      const spokenAs = item.spokenAs
        ? `<span style="font-size:0.86rem; color:#92400e; margin-left:6px;"><strong>${item.strongAs ? 'Strong:' : 'Try:'}</strong> ${item.strongAs ? `${escapeHtml(item.strongAs)} · <strong>Weak:</strong> ${escapeHtml(item.spokenAs)}` : escapeHtml(item.spokenAs)}</span>`
        : '';
      return `
        <button type="button" data-guide-item="${escapeHtml(item.id)}" data-guide-category="${escapeHtml(item.category || '')}" data-guide-target="${escapeHtml(item.id)}" data-selected="${selected ? 'true' : 'false'}" aria-pressed="${selected ? 'true' : 'false'}" style="display:flex; flex-direction:column; gap:6px; width:100%; text-align:left; padding:8px 12px; border-radius:8px; background:${selected ? '#fffaf0' : '#ffffff'}; border:1px solid ${selected ? '#f59e0b' : '#e5e7eb'}; ${palette.borderStyle} box-shadow:${selected ? '0 0 0 2px rgba(245, 158, 11, 0.18)' : 'none'}; cursor:pointer;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <div style="display:flex; align-items:baseline;">
              <strong style="font-size:0.95rem; color:#111827;">${escapeHtml(item.label || 'Hint')}</strong>
              ${spokenAs}
            </div>
            <span style="padding:2px 8px; border-radius:999px; font-size:0.7rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; ${palette.badgeStyle}">${escapeHtml(item.badge || 'Hint')}</span>
          </div>
          <div style="font-size:0.86rem; color:#4b5563; line-height:1.35;">${escapeHtml(item.explanation || '')}</div>
        </button>
      `;
    };
    const renderItemList = (itemList) => itemList.map((item) => renderGuideCard(item, item.id === this.selectedGuideItemId)).join('');
    const noSoundChangeHtml = noSoundChangeMessage
      ? `
        <div data-role="guide-no-sound-change" style="padding:10px 12px; border-radius:8px; border:1px solid rgba(180, 83, 9, 0.18); background:rgba(180, 83, 9, 0.08); color:#92400e; font-size:0.9rem; line-height:1.45;">
          This sentence still has linking or reduced words, but no sound-change example.
        </div>
      `
      : '';
    if (compactView) {
      const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedItem.id));
      const compactCard = renderGuideCard(selectedItem, true);
      const toggleLabel = showFullList ? 'Hide' : 'See more';
      list.style.display = 'flex';
      list.style.flexDirection = 'column';
      list.style.gap = '10px';
      list.innerHTML = `
        <div data-role="guide-selected-summary" style="display:flex; flex-direction:column; gap:10px;">
          ${noSoundChangeHtml}
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:0.84rem; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em;">
            <span>Start here</span>
            <span>${selectedIndex + 1} of ${items.length}</span>
          </div>
          <div data-role="guide-selected-card">${compactCard}</div>
          <button type="button" data-role="guide-toggle-details" aria-expanded="${showFullList ? 'true' : 'false'}" style="align-self:flex-start; padding:8px 12px; border-radius:999px; border:1px solid #d1d5db; background:#fff; color:#1f2937; font-weight:600; cursor:pointer;">${escapeHtml(toggleLabel)}</button>
        </div>
        <div data-role="guide-expanded-list" style="display:${showFullList ? 'flex' : 'none'}; flex-direction:column; gap:10px;">
          ${renderItemList(items)}
        </div>
      `;
    } else {
      list.style.display = 'grid';
      list.style.gap = '10px';
      list.innerHTML = `${noSoundChangeHtml}${renderItemList(items)}`;
    }
    this.syncGuideSelectionState();
  }

  async renderConnectedSpeechResults(connectedSpeech, options = {}) {
    const box = document.getElementById('ra-connected-speech-box');
    const label = document.getElementById('ra-connected-speech-label');
    const list = document.getElementById('ra-connected-speech-list');
    const meta = document.getElementById('ra-connected-speech-meta');
    const summary = document.getElementById('ra-connected-speech-summary');
    if (!box || !label || !list || !meta || !summary) return;

    const viewMode = options.sessionViewMode || this.lastAssessmentSession?.sessionViewMode || this.getEffectiveViewMode();
    if (viewMode === 'basic' || !connectedSpeech || connectedSpeech.status === 'not_applicable') {
      this.hideConnectedSpeechPanel();
      return;
    }

    this.connectedSpeechPanelMode = 'results';
    this.currentGuideExplanationItems = [];
    this.selectedGuideItemId = null;
    this.currentGuideHasVisibleAssimilation = false;
    box.style.display = 'block';
    label.textContent = 'Speech Coach';
    meta.textContent = 'Feedback';
    list.innerHTML = '';

    const wrapper = document.getElementById('ra-connected-speech-paragraph') || document.getElementById('ra-connected-speech-list');

    const detectedCount = Number(connectedSpeech?.summary?.detectedCount || 0);
    const notDetectedCount = Number(connectedSpeech?.summary?.notDetectedCount || 0);
    const uncertainCount = Number(connectedSpeech?.summary?.uncertainCount || 0);

    if (connectedSpeech.status === 'unavailable') {
      summary.textContent = 'Connected-speech feedback is temporarily unavailable for this attempt.';
      return;
    }

    // Learner-friendly summary
    const totalEvents = detectedCount + notDetectedCount + uncertainCount;
    if (totalEvents === 0) {
      summary.textContent = 'No connected speech patterns analysed in this attempt.';
    } else if (notDetectedCount === 0 && uncertainCount === 0) {
      summary.textContent = `Great job! You nailed all ${detectedCount} speech pattern${detectedCount === 1 ? '' : 's'}.`;
    } else if (detectedCount === 0) {
      summary.textContent = `${notDetectedCount} pattern${notDetectedCount === 1 ? ' needs' : 's need'} practice. Keep going!`;
    } else {
      summary.textContent = `You nailed ${detectedCount} pattern${detectedCount === 1 ? '' : 's'}! ${notDetectedCount} still need${notDetectedCount === 1 ? 's' : ''} practice.`;
    }

    const transcriptText = String(options.transcriptText || this.currentPromptPlainText || '').trim();

    // Aggregate events into reduced-word groups vs linking issues/successes
    const events = Array.isArray(connectedSpeech.events) ? connectedSpeech.events : [];
    await this.primeSharedPronunciations(events);
    const { groupedReduced, linkingIssues, linkingSuccesses } = this._aggregateSpeechEvents(events);

    // Build annotated paragraph with token highlights + SVG overlay
    const usedTokenAnnotation = await this._buildAnnotatedParagraph(events, wrapper, transcriptText);

    // Append legend if annotation succeeded
    if (usedTokenAnnotation && wrapper) {
      const legendEl = document.createElement('div');
      legendEl.className = 'sc-legend';
      legendEl.style.marginTop = '12px';
      legendEl.innerHTML = [
        '<span class="sc-legend-item"><span class="sc-legend-dot sc-legend-dot--success"></span> Good</span>',
        '<span class="sc-legend-item"><span class="sc-legend-dot sc-legend-dot--error"></span> Needs practice</span>',
        '<span class="sc-legend-item"><span class="sc-legend-dot sc-legend-dot--uncertain"></span> Unclear</span>'
      ].join('');
      wrapper.appendChild(legendEl);
    }

    // Build two-column result cards
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

    fragment.appendChild(leftCol);
    fragment.appendChild(rightCol);
    list.appendChild(fragment);

    this.bindSpeechCoachAccordions(list);
    this.bindSpeechCoachInteractions(list);

    const activeSpeechLevel = options.sessionConnectedSpeechLevel || this.lastAssessmentSession?.sessionConnectedSpeechLevel || this.connectedSpeechLevel;
    const initialFilter = (activeSpeechLevel === 'linking') ? 'linking' : (activeSpeechLevel === 'reduced_words') ? 'reduced' : (this.speechCoachLayerFilter || 'all');
    this.setSpeechCoachLayerFilter(initialFilter);
  }


  /** Delegated accordion handler for Speech Coach results */
  bindSpeechCoachAccordions(container) {
    if (!container) return;
    if (container.dataset.scAccordionBound) return;
    container.dataset.scAccordionBound = 'true';

    container.addEventListener('click', (event) => {
      if (event.target.closest('.sc-play-word-btn')) return;

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

  bindSpeechCoachInteractions(container) {
    if (!container) return;

    // Hover Highlight Delegation
    container.addEventListener('mouseover', (e) => {
      // Find the closest element that represents a speech event instance or card
      const target = e.target.closest('[data-event-index]');
      if (target) {
        const evIdx = target.dataset.eventIndex;
        // Highlight corresponding spans
        document.querySelectorAll(`#ra-connected-speech-box [data-event-index]`).forEach(span => {
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
          document.querySelectorAll(`#ra-connected-speech-box [data-event-index]`).forEach(span => {
            const indexes = String(span.dataset.eventIndex || '').split(/\s+/);
            if (indexes.includes(evIdx)) {
              span.classList.add('sc-token--hovered');
            }
          });
        });
      }
    });

    container.addEventListener('mouseout', (e) => {
      // Remove all hovered highlights
      document.querySelectorAll('#ra-connected-speech-box .sc-token--hovered').forEach(span => {
        span.classList.remove('sc-token--hovered');
      });
    });

    // Play Word segment Delegation
    container.addEventListener('click', (e) => {
      const playBtn = e.target.closest('.sc-play-word-btn');
      if (!playBtn) return;
      
      e.stopPropagation(); // prevent accordion toggle if inside card header
      
      const startMs = Number(playBtn.dataset.start);
      const endMs = Number(playBtn.dataset.end);
      const audioEl = document.getElementById('ra-user-recording-audio');
      
      if (!audioEl || isNaN(startMs) || isNaN(endMs)) return;
      
      const startSec = startMs / 1000;
      const endSec = endMs / 1000;
      
      this.playAudioSegment(audioEl, startSec, endSec);
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
              // Proactively scroll the parent accordion/content into view if collapsed
              const parent = card.closest('.sc-accordion-content');
              if (parent && parent.hidden) {
                const toggle = parent.parentNode.querySelector('[data-sc-accordion-toggle]');
                if (toggle && toggle.getAttribute('aria-expanded') === 'false') {
                  toggle.setAttribute('aria-expanded', 'true');
                  parent.hidden = false;
                  const chevron = toggle.querySelector('.sc-chevron');
                  if (chevron) chevron.classList.add('sc-chevron--open');
                }
              }
              card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
          });
        }
      });
      
      feedbackWrapper.addEventListener('mouseout', (e) => {
        container.querySelectorAll('.sc-card--hovered').forEach(card => {
          card.classList.remove('sc-card--hovered');
        });
      });
    }
  }

  playAudioSegment(audioEl, startSec, endSec) {
    if (this._segmentInterval) {
      clearInterval(this._segmentInterval);
      this._segmentInterval = null;
    }
    
    // Stop reference audio
    this.stopReferenceAudioPlayback();
    
    // Safety check - make sure the user recording is loaded
    if (!audioEl.src && this.userRecordingUrl) {
      audioEl.src = this.userRecordingUrl;
      audioEl.load();
    }
    
    if (!audioEl.src) return;
    
    // Hijack main play button text if active
    const recPlayBtn = document.getElementById('ra-play-recording-btn');
    if (recPlayBtn) {
      recPlayBtn.textContent = 'Play your recording';
    }
    
    // Seek and play
    audioEl.currentTime = startSec;
    const playPromise = audioEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        console.warn('Word segment audio playback failed:', err);
      });
    }
    
    // High-resolution interval check (every 10ms)
    this._segmentInterval = setInterval(() => {
      if (audioEl.currentTime >= endSec) {
        audioEl.pause();
        clearInterval(this._segmentInterval);
        this._segmentInterval = null;
      }
    }, 10);
    
    const cleanup = () => {
      if (this._segmentInterval) {
        clearInterval(this._segmentInterval);
        this._segmentInterval = null;
      }
      audioEl.removeEventListener('pause', cleanup);
      audioEl.removeEventListener('ended', cleanup);
    };
    audioEl.addEventListener('pause', cleanup);
    audioEl.addEventListener('ended', cleanup);
  }

  /** Aggregate connected speech events into reduced-word groups, linking issues, and linking successes */
  _aggregateSpeechEvents(events) {
    const groupedReduced = new Map();
    const linkingIssues = [];
    const linkingSuccesses = [];

    events.forEach((event) => {
      const eventCategory = this.normalizeConnectedSpeechMode(
        window.ReadAloudLinking?.getLearnerConnectedSpeechCategory?.(event.family || event.subtype || event.category || '')
        || event.category
        || event.subtype
        || 'linking'
      );
      const categoryLabel = window.ReadAloudLinking?.getLearnerConnectedSpeechCategoryLabel
        ? window.ReadAloudLinking.getLearnerConnectedSpeechCategoryLabel(eventCategory)
        : this.getConnectedSpeechDisplayLabel(eventCategory);
      const phrase = event.phrase || event.eventId || 'Word';
      const isReduced = eventCategory === 'weak_forms' || eventCategory === 'reduced_words' || String(categoryLabel).toLowerCase().includes('reduced');

      if (isReduced) {
        const key = phrase.toLowerCase();
        if (!groupedReduced.has(key)) {
          groupedReduced.set(key, { phrase, label: categoryLabel, items: [] });
        }
        groupedReduced.get(key).items.push(event);
      } else if (event.status === 'detected') {
        linkingSuccesses.push(event);
      } else {
        linkingIssues.push(event);
      }
    });

    return { groupedReduced, linkingIssues, linkingSuccesses };
  }

  /** Build annotated paragraph with token highlights and SVG linking overlay */
  async _buildAnnotatedParagraph(events, wrapper, transcriptText = this.currentPromptPlainText) {
    const annotatedContainer = document.createElement('div');
    annotatedContainer.className = 'sc-annotated-paragraph';
    const paragraphText = String(transcriptText || this.currentPromptPlainText || '').trim();

    let usedTokenAnnotation = false;
    if (window.ReadAloudLinking && paragraphText) {
      try {
        const analysisOptions = { connectedSpeechLevel: 'sound_changes', enabledRuleSet: 'connected-speech-v3' };
        const targetPromptKey = `result:${this.currentQuestionId || 'unknown'}:${paragraphText}`;
        const analysis = await this.getPromptAnalysis(targetPromptKey, paragraphText, analysisOptions);
        const tokens = analysis.tokens;
        if (tokens && tokens.length > 0) {
          const wordMap = window.ReadAloudLinking.renderLinkingLayer(annotatedContainer, { tokens, boundaries: [], tokenAnnotations: [] });

          const cleanWord = (s) => String(s || '').toLowerCase().replace(/[^\w]/g, '').trim();

          // Apply status-based CSS classes to matching word spans
          events.forEach((ev, evIndex) => {
            if (!ev.phrase) return;
            const targetWord = cleanWord(ev.phrase);
            if (!targetWord) return;
            let matched = false;
            wordMap.forEach((span) => {
              if (matched) return;
              const spanText = cleanWord(span.textContent);
              if (spanText === targetWord && !span.dataset.scSingleHighlighted) {
                span.dataset.scSingleHighlighted = 'true';
                
                // Add event index (supporting multiple space-separated indices)
                const existing = span.dataset.eventIndex;
                span.dataset.eventIndex = existing ? `${existing} ${evIndex}` : String(evIndex);

                span.classList.add('sc-token-highlight');
                const isEvReduced = ev.category === 'weak_forms' || String(ev.family).includes('reduced') || ev.category === 'reduced_words';
                if (ev.status === 'detected') {
                  span.classList.add('sc-token--success');
                  if (isEvReduced) span.classList.add('sc-token-bg--success');
                } else if (ev.status === 'not_detected') {
                  span.classList.add('sc-token--error');
                  if (isEvReduced) span.classList.add('sc-token-bg--error');
                } else {
                  span.classList.add('sc-token--uncertain');
                  if (isEvReduced) span.classList.add('sc-token-bg--uncertain');
                }
                span.title = ev.feedbackText || '';
                span.style.cursor = 'pointer';
                matched = true;
              }
            });
          });

          // Tag linking events on adjacent word spans in wordMap
          events.forEach((ev, evIndex) => {
            if (!ev.phrase) return;
            const phraseParts = String(ev.phrase).split(/\s+/).map(cleanWord).filter(Boolean);
            if (phraseParts.length < 2) return;

            let matched = false;
            wordMap.forEach((leftSpan, index) => {
              if (matched) return;
              let allMatch = true;
              const matchingSpans = [];
              for (let i = 0; i < phraseParts.length; i++) {
                const targetSpan = wordMap.get(index + i);
                if (!targetSpan || cleanWord(targetSpan.textContent) !== phraseParts[i]) {
                  allMatch = false;
                  break;
                }
                matchingSpans.push(targetSpan);
              }

              const matchKey = `scLinking_${evIndex}`;
              if (allMatch && matchingSpans.length === phraseParts.length && !leftSpan.dataset[matchKey]) {
                matchingSpans.forEach((span) => {
                  const existing = span.dataset.eventIndex;
                  span.dataset.eventIndex = existing ? `${existing} ${evIndex}` : String(evIndex);
                });
                leftSpan.dataset[matchKey] = 'true';
                matched = true;
              }
            });
          });

          // SVG linking overlay
          const overlaySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          overlaySvg.classList.add('sc-linking-overlay');
          annotatedContainer.insertBefore(overlaySvg, annotatedContainer.firstChild);

          const overlayBoundaries = analysis.boundaries.map((b) => {
            const leftWord = b.leftDisplay || b.leftWord || '';
            const rightWord = b.rightDisplay || b.rightWord || '';
            const bPhrase = `${leftWord} ${rightWord}`.toLowerCase().trim();
            const matchEvent = events.find((ev) => {
              const evPhraseLower = (ev.phrase || ev.eventId || '').toLowerCase().trim();
              const isEventLinking = ev.category === 'linking' || ev.category === 'sound_changes' || ev.layer === 'assimilation' || ev.layer === 'linking' || this.normalizeConnectedSpeechMode(ev.family) === 'linking' || ev.category === 'consonant_to_vowel';
              return evPhraseLower === bPhrase && isEventLinking;
            });
            if (matchEvent) {
              const color = matchEvent.status === 'detected' ? '#10b981' : matchEvent.status === 'not_detected' ? '#ef4444' : '#f59e0b';
              return { ...b, strokeColor: color };
            }
            return { ...b, confidence: 'low' };
          });

          if (wrapper) {
            wrapper.innerHTML = '';
            wrapper.appendChild(annotatedContainer);
            // These are linking arcs, so ask for that family explicitly. Without
            // it renderOverlay early-returns and the whole overlay silently
            // disappears — which is exactly what happened between V1.6.1 and
            // V1.8.28, when the family gate was introduced.
            window.ReadAloudLinking.renderOverlay(
              overlaySvg,
              annotatedContainer,
              { boundaries: overlayBoundaries },
              wordMap,
              { focusFamilies: ['linking'] }
            );
            usedTokenAnnotation = true;
          }
        }
      } catch (tokenErr) {
        console.warn('Token annotation failed, falling back to plain text:', tokenErr);
      }
    }

    if (!usedTokenAnnotation) {
      if (wrapper) wrapper.innerHTML = '';
      annotatedContainer.textContent = paragraphText;
      if (wrapper) wrapper.appendChild(annotatedContainer);
    }

    return usedTokenAnnotation;
  }

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
        const ipaHtml = ipaInfo ? ` <span style="font-size: 0.75rem; font-family: ui-monospace, monospace; color: #059669; font-weight: 500;">(Strong ${ipaInfo.strong} · Weak ${ipaInfo.reduced})</span>` : '';

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
          
          let playButtonHtml = '';
          if (hasTimestamps) {
            playButtonHtml = `
              <button class="sc-play-word-btn" type="button" data-event-index="${evIndex}" data-start="${i.startMs}" data-end="${i.endMs}" title="Play this word only">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </button>
            `;
          }

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
            <span style="color: #9ca3af; text-decoration: line-through; font-size: 0.68rem;">${ipaInfo.strong}</span>
            <span style="color: #059669; font-weight: 600;">Weak ${ipaInfo.reduced}</span>
          </div>
        ` : '';

        card.title = item.feedbackText || (ipaInfo ? `Weak form: ${ipaInfo.strong} ➔ ${ipaInfo.reduced}` : '');
        
        const hasTimestamps = typeof item.startMs === 'number' && typeof item.endMs === 'number';
        const timeText = hasTimestamps ? ` [${(item.startMs / 1000).toFixed(2)}s]` : '';
        
        let playButtonHtml = '';
        if (hasTimestamps) {
          playButtonHtml = `
            <button class="sc-play-word-btn sc-play-word-btn--single" type="button" data-event-index="${evIndex}" data-start="${item.startMs}" data-end="${item.endMs}" title="Play this word only">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
          `;
        }

        card.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 6px; padding: 2px 0;">
            <div style="display: flex; flex-direction: column; min-width: 0; flex-shrink: 1;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <strong class="sc-word-title" style="white-space: nowrap; font-size: 0.98rem; font-weight: 600;">${escapeHtml(group.phrase)}</strong>
                <span style="font-size: 0.72rem; color: #9ca3af; white-space: nowrap;">${timeText}</span>
              </div>
              ${ipaHtml}
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
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
      let playButtonHtml = '';
      if (hasTimestamps) {
        playButtonHtml = `
          <button class="sc-play-word-btn" type="button" data-event-index="${evIndex}" data-start="${event.startMs}" data-end="${event.endMs}" title="Play this segment only">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
        `;
      }
      
      const badgeCls = event.status === 'not_detected' ? 'sc-badge--error' : 'sc-badge--uncertain';

      const cardHeader = document.createElement('div');
      cardHeader.className = 'sc-accordion-header';
      cardHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #fff5f5; border-bottom: 1px solid #fee2e2; border-radius: 8px 8px 0 0; user-select: none;';

      cardHeader.innerHTML = `
        <div class="sc-accordion-label" data-sc-accordion-toggle="${accordionId}" style="display: flex; align-items: center; gap: 8px; flex: 1; cursor: pointer;">
          <strong class="sc-word-title" style="font-size: 0.98rem; color: #111827;">${escapeHtml(phrase)}</strong>
          <span class="sc-ipa-badge" style="font-size: 0.78rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #b91c1c; background: #fee2e2; padding: 2px 8px; border-radius: 12px; font-weight: 600;">${escapeHtml(ipaDetails.linkedIPA)}</span>
          <span style="font-size: 0.72rem; color: #9ca3af; white-space: nowrap;">${timeText}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${playButtonHtml}
          <span class="sc-status-badge ${badgeCls}">${escapeHtml(event.status || 'uncertain')}</span>
          <button type="button" class="sc-chevron-btn" data-sc-accordion-toggle="${accordionId}" title="Toggle details" style="background: transparent; border: none; padding: 2px 4px; cursor: pointer; display: flex; align-items: center; color: #9ca3af;">
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
        <div class="sc-instance" style="padding-top: 10px;">
          <div style="font-size: 0.76rem; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px;">
            Category: ${escapeHtml(categoryLabel)}
          </div>
          <div class="sc-instance-feedback" style="color: #991b1b; font-weight: 500;">
            ${escapeHtml(reasonExplanation.reason)}
          </div>

          <div style="font-size: 0.82rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 8px 12px; border-radius: 6px; margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-weight: 700; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.05em; color: #b91c1c; background: #fee2e2; padding: 2px 6px; border-radius: 4px;">Target IPA:</span>
            <span><span style="color: #4b5563;">${escapeHtml(ipaDetails.ipa1)}</span> + <span style="color: #4b5563;">${escapeHtml(ipaDetails.ipa2)}</span> <strong style="color: #dc2626; margin: 0 4px;">➔</strong> <strong style="color: #b91c1c; font-size: 0.88rem;">${escapeHtml(ipaDetails.linkedIPA)}</strong></span>
          </div>

          <div style="font-size: 0.84rem; color: #374151; margin-top: 8px; background: #fff5f5; padding: 8px 10px; border-radius: 6px; border-left: 2px solid #ef4444;">
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
      let playButtonHtml = '';
      if (hasTimestamps) {
        playButtonHtml = `
          <button class="sc-play-word-btn" type="button" data-event-index="${evIndex}" data-start="${event.startMs}" data-end="${event.endMs}" title="Play this segment only">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
        `;
      }

      const cardHeader = document.createElement('div');
      cardHeader.className = 'sc-accordion-header';
      cardHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #ecfdf5; border-bottom: 1px solid #d1fae5; border-radius: 8px 8px 0 0; user-select: none;';

      cardHeader.innerHTML = `
        <div class="sc-accordion-label" data-sc-accordion-toggle="${accordionId}" style="display: flex; align-items: center; gap: 8px; flex: 1; cursor: pointer;">
          <svg class="sc-check-icon" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="flex-shrink: 0;">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
          <strong class="sc-word-title" style="font-size: 0.98rem; color: #065f46;">${escapeHtml(phrase)}</strong>
          <span class="sc-ipa-badge" style="font-size: 0.78rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #047857; background: #d1fae5; padding: 2px 8px; border-radius: 12px; font-weight: 600;">${escapeHtml(ipaDetails.linkedIPA)}</span>
          <span style="font-size: 0.72rem; color: #6b7280; white-space: nowrap;">${timeText}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${playButtonHtml}
          <button type="button" class="sc-chevron-btn" data-sc-accordion-toggle="${accordionId}" title="Toggle details" style="background: transparent; border: none; padding: 2px 4px; cursor: pointer; display: flex; align-items: center; color: #065f46;">
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
        <div class="sc-instance" style="padding-top: 10px;">
          <div style="font-size: 0.76rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #047857; margin-bottom: 4px;">
            ✓ Seamless Link Connected
          </div>
          <div class="sc-instance-feedback" style="color: #111827; font-weight: 500;">
            ${escapeHtml(reasonExplanation.reason)}
          </div>

          <div style="font-size: 0.82rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; padding: 8px 12px; border-radius: 6px; margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-weight: 700; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.05em; color: #15803d; background: #dcfce7; padding: 2px 6px; border-radius: 4px;">IPA Style:</span>
            <span><span style="color: #4b5563;">${escapeHtml(ipaDetails.ipa1)}</span> + <span style="color: #4b5563;">${escapeHtml(ipaDetails.ipa2)}</span> <strong style="color: #047857; margin: 0 4px;">➔</strong> <strong style="color: #047857; font-size: 0.88rem;">${escapeHtml(ipaDetails.linkedIPA)}</strong></span>
          </div>

          <div style="font-size: 0.84rem; color: #065f46; margin-top: 8px; background: #ecfdf5; padding: 8px 10px; border-radius: 6px; border-left: 2px solid #10b981;">
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

  setSpeechCoachLayerFilter(filterMode) {
    this.speechCoachLayerFilter = filterMode; // 'linking' or 'all'
    const btn1 = document.getElementById('ra-layer-level1');
    const btn2 = document.getElementById('ra-layer-level2');
    
    if (filterMode === 'linking') {
      if (btn1) {
        btn1.style.background = '#ffffff';
        btn1.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        btn1.style.color = '#1d4ed8';
        btn1.classList.add('active');
      }
      if (btn2) {
        btn2.style.background = 'transparent';
        btn2.style.boxShadow = 'none';
        btn2.style.color = '#1f2937';
        btn2.classList.remove('active');
      }
    } else {
      if (btn2) {
        btn2.style.background = '#ffffff';
        btn2.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        btn2.style.color = '#1d4ed8';
        btn2.classList.add('active');
      }
      if (btn1) {
        btn1.style.background = 'transparent';
        btn1.style.boxShadow = 'none';
        btn1.style.color = '#1f2937';
        btn1.classList.remove('active');
      }
    }

    const leftCol = document.querySelector('#ra-connected-speech-list .sc-grid-left');
    const listGrid = document.getElementById('ra-connected-speech-list');

    if (leftCol) {
      leftCol.style.display = filterMode === 'linking' ? 'none' : 'flex';
    }
    if (listGrid) {
      listGrid.style.gridTemplateColumns = filterMode === 'linking' ? '1fr' : '1fr 1fr';
    }
  }

  handleGuideTargetKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    this.handleGuideTargetInteraction(event);
  }

  handleGuideTargetInteraction(event) {
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
    if (!target) return;
    if (event.type === 'keydown') {
      event.preventDefault();
    }
    const guideTarget = String(target.getAttribute('data-guide-target') || '').trim();
    if (!guideTarget) return;
    this.setSelectedGuideItem(guideTarget);
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

  syncGuideSelectionState() {
    const selectedGuideId = String(this.selectedGuideItemId || '');
    document.querySelectorAll('[data-guide-target]').forEach((node) => {
      const target = String(node.getAttribute('data-guide-target') || '');
      const selected = !!selectedGuideId && target === selectedGuideId && this.connectedSpeechPanelMode === 'guide';
      node.setAttribute('data-selected', selected ? 'true' : 'false');
      if (node.getAttribute('role') === 'button') {
        node.setAttribute('aria-pressed', selected ? 'true' : 'false');
      }
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
