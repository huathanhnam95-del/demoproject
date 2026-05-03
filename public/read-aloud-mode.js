class ReadAloudMode {
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
    this.state = 'IDLE'; // IDLE, PREP, RECORDING, RESULTS
    this.timerInterval = null;
    this.database = [];
    this.currentTranscript = '';
    this.hasLoadedDatabase = false;
    this.supportMessage = 'Microphone recording is not supported in this browser. Please use Chrome or Edge.';

    // Prompt guides state
    this.chunkingEnabled = false;
    this.connectedSpeechLevel = 'off';
    this.sessionChunkingEnabled = false;
    this.sessionConnectedSpeechLevel = 'off';
    this.connectedSpeechLayerOverrides = new Set();
    this.sessionConnectedSpeechLayerOverrides = new Set();
    this.promptAnalysisCache = new Map();
    this.promptAnalysisPromiseCache = new Map();
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

    // ElevenLabs audio state
    this.audioManifest = null;
    this.currentQuestionId = null;
    this.selectedGender = 'male';
    this.selectedSpeed = '100';
    this.hasLoadedManifest = false;
    this.sampleAudioFilter = 'all';
    this.promptFeatureFilter = 'all';
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

    // Recording state
    this.mediaRecorder = null;
    this.audioStream = null;
    this.currentRecordingSession = null;
    this.promptLifecycleToken = 0;
    this.recordingRequestId = 0;
    this.hasAssessmentResult = false;
    this.userRecordingUrl = null;

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

  getConnectedSpeechAnnouncement(mode = this.connectedSpeechLevel) {
    const normalized = this.normalizeConnectedSpeechMode(mode);
    if (normalized === 'sound_changes') {
      return 'Connected speech set to linking, reduced words, and sound changes.';
    }
    if (normalized === 'reduced_words') {
      return 'Connected speech set to linking plus reduced words.';
    }
    if (normalized === 'linking') {
      return 'Connected speech set to linking only.';
    }
    return 'Connected speech turned off.';
  }

  getConnectedSpeechRuleSet() {
    const mode = this.normalizeConnectedSpeechMode(this.connectedSpeechLevel);
    if (mode === 'off') {
      return 'none';
    }
    if (mode === 'sound_changes') {
      return 'connected-speech-v3';
    }
    return 'linking-v1';
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

    document.getElementById('ra-voice-male')?.addEventListener('click', () => this.setGender('male'));
    document.getElementById('ra-voice-female')?.addEventListener('click', () => this.setGender('female'));
    document.getElementById('ra-speed-100')?.addEventListener('click', () => this.setSpeed('100'));
    document.getElementById('ra-speed-80')?.addEventListener('click', () => this.setSpeed('80'));
    document.getElementById('ra-play-audio-btn')?.addEventListener('click', () => this.playAudio());
    document.getElementById('ra-practice-target-toggle')?.addEventListener('click', () => this.togglePracticeTargetDrawer());

    document.getElementById('ra-question-select')?.addEventListener('change', (event) => {
      if (event.target.value === 'random') {
        this.loadNextPrompt();
      } else {
        this.loadSpecificPrompt(parseInt(event.target.value, 10));
      }
    });

    document.getElementById('ra-toggle-chunking-btn')?.addEventListener('click', () => this.togglePromptGuide('chunking'));
    document.getElementById('ra-toggle-connected-off-btn')?.addEventListener('click', () => this.setConnectedSpeechLevel('off'));
    document.getElementById('ra-toggle-linking-btn')?.addEventListener('click', () => this.setConnectedSpeechLevel('linking'));
    document.getElementById('ra-toggle-reduced-words-btn')?.addEventListener('click', () => this.setConnectedSpeechLevel('reduced_words'));
    document.getElementById('ra-toggle-sound-changes-btn')?.addEventListener('click', () => this.setConnectedSpeechLevel('sound_changes'));
    document.getElementById('ra-toggle-chunking-btn')?.addEventListener('keydown', (event) => this.handlePromptGuideKeydown(event, 'chunking'));
    document.getElementById('ra-toggle-connected-off-btn')?.addEventListener('keydown', (event) => this.handleConnectedSpeechKeydown(event, 'off'));
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

  async onEnter() {
    if (this.isEntering || this.isActive) return;
    this.isEntering = true;
    this.isActive = true;
    this.sessionChunkingEnabled = false;
    this.sessionConnectedSpeechLevel = 'off';
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
    this.sessionConnectedSpeechLevel = 'off';
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
      if (!this.isActive || !(this.chunkingEnabled || this.connectedSpeechLevel !== 'off') || !this.currentPromptPlainText) return;
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
      btn.style.background = active ? 'rgba(37, 99, 235, 0.1)' : 'transparent';
      btn.style.border = active ? '1px solid var(--brand-primary, #2563eb)' : '1px solid var(--border-light, #e5e7eb)';
      btn.style.color = active ? 'var(--brand-primary, #2563eb)' : 'var(--text-muted, #6b7280)';
      btn.style.opacity = disabled ? '0.55' : '1';
      btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
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
        if (this.isActive && this.currentPromptPlainText && this.normalizeConnectedSpeechMode(this.connectedSpeechLevel) !== 'off') {
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

    return filtered;
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
      return;
    }

    const originalIndex = this.database.indexOf(row);
    if (originalIndex < 0) {
      select.value = 'random';
      return;
    }

    const optionValue = String(originalIndex);
    const hasOption = Array.from(select.options).some((option) => option.value === optionValue);
    select.value = hasOption ? optionValue : 'random';
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

  async loadNextPrompt(options = {}) {
    const { rememberPrompt = true } = options;
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
    this.connectedSpeechLevel = this.normalizeConnectedSpeechMode(this.sessionConnectedSpeechLevel || 'off');

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
      if (!this.shouldApplyPromptRender(promptKey, renderToken) || this.connectedSpeechLevel === 'off') {
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
      const nextLevel = this.normalizeConnectedSpeechMode(this.connectedSpeechLevel) === 'off' ? 'linking' : 'off';
      this.setConnectedSpeechLevel(nextLevel, { announce, persist });
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

  updatePromptGuideButtons() {
    const chunkBtn = document.getElementById('ra-toggle-chunking-btn');
    const offBtn = document.getElementById('ra-toggle-connected-off-btn');
    const linkingBtn = document.getElementById('ra-toggle-linking-btn');
    const reducedWordsBtn = document.getElementById('ra-toggle-reduced-words-btn');
    const soundChangesBtn = document.getElementById('ra-toggle-sound-changes-btn');
    const chunkAvailable = !!this.currentPromptChunkedText && this.currentPromptRenderState?.chunkingAvailable !== false;
    const level = this.normalizeConnectedSpeechMode(this.connectedSpeechLevel);

    [
      [chunkBtn, this.chunkingEnabled, chunkAvailable],
      [offBtn, level === 'off', true],
      [linkingBtn, level === 'linking', true],
      [reducedWordsBtn, level === 'reduced_words', true],
      [soundChangesBtn, level === 'sound_changes', true]
    ].forEach(([button, active, available]) => {
      if (!button) return;
      const displayActive = available ? active : false;
      button.setAttribute('aria-pressed', displayActive ? 'true' : 'false');
      if (button.getAttribute('role') === 'radio') {
        button.setAttribute('aria-checked', displayActive ? 'true' : 'false');
      }
      button.disabled = !available;
      const isConnectedSpeechButton = button !== chunkBtn;
      if (isConnectedSpeechButton && button === offBtn) {
        button.style.background = displayActive ? '#6b7280' : 'transparent';
        button.style.color = displayActive ? '#ffffff' : '#1f2937';
        button.style.boxShadow = displayActive ? '0 1px 3px rgba(107, 114, 128, 0.25)' : 'none';
      } else if (isConnectedSpeechButton && button === reducedWordsBtn) {
        button.style.background = displayActive ? '#d97706' : 'transparent';
        button.style.color = displayActive ? '#ffffff' : '#1f2937';
        button.style.boxShadow = displayActive ? '0 1px 3px rgba(217, 119, 6, 0.25)' : 'none';
      } else if (isConnectedSpeechButton && button === soundChangesBtn) {
        button.style.background = displayActive ? '#b45309' : 'transparent';
        button.style.color = displayActive ? '#ffffff' : '#1f2937';
        button.style.boxShadow = displayActive ? '0 1px 3px rgba(180, 83, 9, 0.25)' : 'none';
      } else {
        button.style.background = displayActive ? '#2563eb' : 'transparent';
        button.style.color = displayActive ? '#ffffff' : '#1f2937';
        button.style.boxShadow = displayActive ? '0 1px 3px rgba(37, 99, 235, 0.25)' : 'none';
      }
      button.style.opacity = available ? '1' : '0.45';
      if (button === chunkBtn) {
        button.title = available ? 'Show semantic chunking markers.' : 'Chunking unavailable for this prompt.';
      } else if (button === offBtn) {
        button.title = 'Hide connected speech hints.';
      } else if (button === linkingBtn) {
        button.title = 'Show connected speech linking hints.';
      } else if (button === soundChangesBtn) {
        button.title = 'Show connected speech sound change hints.';
      } else {
        button.title = 'Show connected speech reduced words.';
      }
    });
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

    this.restorePlainTextVisibility();
    this.setPromptText(this.currentPromptPlainText, this.currentPromptChunkedText);
    this.updatePromptGuideButtons();
    if (this.state !== 'RESULTS') {
      this.clearConnectedSpeechResults();
    }

    if (!window.ReadAloudLinking || this.connectedSpeechLevel === 'off') {
      return;
    }

    this.hydrateLinkingView(this.activePromptKey, this.activePromptRenderToken);
    this.scheduleHydrationRetry(this.activePromptKey, this.activePromptRenderToken);

    if (document.fonts?.ready && !this.pendingFontHydration) {
      this.pendingFontHydration = document.fonts.ready.then(() => {
        this.pendingFontHydration = null;
        if (this.isActive && this.connectedSpeechLevel !== 'off') {
          this.hydrateLinkingView(this.activePromptKey, this.activePromptRenderToken);
        }
      }).catch(() => {
        this.pendingFontHydration = null;
      });
    }
  }

  async hydrateLinkingView(promptKey, renderToken, attempt = 0) {
    if (!window.ReadAloudLinking || !this.currentPromptPlainText || this.connectedSpeechLevel === 'off') return;
    const targetPromptKey = promptKey || this.activePromptKey;
    const targetToken = renderToken || this.activePromptRenderToken;
    const analysisOptions = {
      accentProfile: 'en-US',
      connectedSpeechLevel: this.connectedSpeechLevel,
      enabledRuleSet: this.getConnectedSpeechRuleSet()
    };
    const analysis = await this.getPromptAnalysis(targetPromptKey, this.currentPromptPlainText, analysisOptions);
    const filteredAnalysis = window.ReadAloudLinking.filterAnalysisByBlockedBoundaries(
      analysis,
      this.currentPromptRenderState?.blockedBoundarySet
    );

    if (!this.shouldApplyPromptRender(targetPromptKey, targetToken) || this.connectedSpeechLevel === 'off') {
      return;
    }

    this.cancelPendingHydration();
    this.pendingLinkingFrame = requestAnimationFrame(() => {
      this.pendingLinkingFrame = null;
      if (!this.shouldApplyPromptRender(targetPromptKey, targetToken) || this.connectedSpeechLevel === 'off') {
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
      if (typeof window.ReadAloudLinking.applyTokenAnnotations === 'function') {
        window.ReadAloudLinking.applyTokenAnnotations(wordMap, filteredAnalysis);
      }
      const focusFamily = this.normalizeConnectedSpeechMode(this.connectedSpeechLevel);
      const summaryText = window.ReadAloudLinking.buildAccessibleSummary(filteredAnalysis, { focusFamily });
      summary.textContent = summaryText;
      this.renderPromptGuideExplanations(filteredAnalysis);

      const promptWidth = Math.min(window.innerWidth || 0, promptStage.getBoundingClientRect().width || 0);
      const useFallback = promptWidth < (window.ReadAloudLinking.DESKTOP_MIN_WIDTH || 560);
      const hasBoundaryVisuals = Array.isArray(filteredAnalysis.boundaries)
        && filteredAnalysis.boundaries.some((boundary) => (
          !boundary.blocked && (boundary.confidence === 'high' || boundary.confidence === 'medium')
        ));
      let renderedCount = 0;

      if (useFallback) {
        badgeLayer.style.display = 'none';
        badgeLayer.innerHTML = '';
        if (hasBoundaryVisuals) {
          fallbackList.style.display = 'flex';
          renderedCount = window.ReadAloudLinking.renderFallbackList(fallbackList, filteredAnalysis, { focusFamily });
        } else {
          fallbackList.style.display = 'none';
        }
        overlay.style.display = 'none';
      } else {
        const overlayResult = window.ReadAloudLinking.renderOverlay(overlay, promptStage, filteredAnalysis, wordMap);
        const badgeResult = typeof window.ReadAloudLinking.renderAssimilationBadges === 'function'
          ? window.ReadAloudLinking.renderAssimilationBadges(badgeLayer, promptStage, filteredAnalysis, wordMap)
          : { renderedCount: 0 };
        renderedCount = overlayResult.renderedCount + (badgeResult.renderedCount || 0);
        if (overlayResult.hiddenBoundaries?.length) {
          fallbackList.style.display = 'flex';
          window.ReadAloudLinking.renderFallbackList(fallbackList, filteredAnalysis, {
            boundaries: overlayResult.hiddenBoundaries,
            focusFamily
          });
        } else if (renderedCount === 0) {
          if (hasBoundaryVisuals) {
            fallbackList.style.display = 'flex';
            window.ReadAloudLinking.renderFallbackList(fallbackList, filteredAnalysis, { focusFamily });
            overlay.style.display = 'none';
            badgeLayer.style.display = 'none';
          } else {
            fallbackList.style.display = 'none';
            overlay.style.display = 'none';
            badgeLayer.style.display = 'none';
          }
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
    this.setConnectedSpeechLevel(level);
  }

  setConnectedSpeechLevel(level, options = {}) {
    const normalizedLevel = this.normalizeConnectedSpeechMode(level);
    const { announce = true, persist = true } = options;
    if (this.connectedSpeechLevel === normalizedLevel) {
      this.updatePromptGuideButtons();
      return;
    }

    this.invalidatePromptRenderState();
    this.connectedSpeechLevel = normalizedLevel;

    if (persist) {
      this.sessionConnectedSpeechLevel = normalizedLevel;
    }

    this.updatePromptGuideButtons();
    if (announce) {
      this.announceLinkingStatus(this.getConnectedSpeechAnnouncement(normalizedLevel));
    }
    this.renderPromptForCurrentView();
  }

  isConnectedSpeechEnabled() {
    return this.connectedSpeechLevel !== 'off';
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

  resetAssessmentDisplay() {
    this.hasAssessmentResult = false;
    const resultBox = document.getElementById('ra-result-box');
    const accuracyElement = document.getElementById('ra-accuracy-value');
    const feedbackElement = document.getElementById('ra-transcript-feedback');
    if (resultBox) resultBox.style.display = 'none';
    if (accuracyElement) accuracyElement.textContent = '--';
    if (feedbackElement) feedbackElement.innerHTML = '';
  }

  showAssessmentDisplay() {
    this.hasAssessmentResult = true;
    const resultBox = document.getElementById('ra-result-box');
    if (resultBox) resultBox.style.display = 'block';
  }

  updateRecordedAudioControl() {
    const playBtn = document.getElementById('ra-play-recording-btn');
    if (!playBtn) return;
    const shouldShow = !!this.userRecordingUrl && this.state !== 'RECORDING' && this.state !== 'REQUESTING_MIC';
    playBtn.style.display = shouldShow ? '' : 'none';
    playBtn.disabled = !this.userRecordingUrl;
    if (!shouldShow) {
      playBtn.textContent = 'Play your recording';
    }
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
    const statusMsg = document.getElementById('ra-status-message');
    const accuracyElement = document.getElementById('ra-accuracy-value');
    this.showAssessmentDisplay();
    if (statusMsg) statusMsg.textContent = message;
    if (accuracyElement) accuracyElement.textContent = '--';
  }

  updateUIForState() {
    if (!this.getRecordingSupportState().supported) {
      this.applyUnsupportedState();
      return;
    }

    const prepTimerBox = document.getElementById('ra-prep-timer-box');
    const recordTimerBox = document.getElementById('ra-record-timer-box');
    const recordBtn = document.getElementById('ra-record-btn');
    const nextBtn = document.getElementById('ra-next-btn');
    const statusMsg = document.getElementById('ra-status-message');
    const resultBox = document.getElementById('ra-result-box');
    const stopBtn = document.getElementById('ra-stop-btn');

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
      phase: 'requesting-mic'
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
        this.setRecordedAudio(rawBlob);
        await this.submitToAzure(rawBlob, recordingSession);
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
      this.state = 'RESULTS';
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
    this.state = 'RESULTS';
    this.updateUIForState();

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    this.stopMediaStream();

    this.stopReferenceAudioPlayback();
  }

  async submitToAzure(rawBlob, recordingSession) {
    const statusMsg = document.getElementById('ra-status-message');
    try {
      if (!this.shouldApplyAssessment(recordingSession)) return;
      if (statusMsg) statusMsg.textContent = 'Formatting audio...';
      const wavBlob = await this.prepareWavBlob(rawBlob);
      if (!this.shouldApplyAssessment(recordingSession)) return;

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
      if (!this.shouldApplyAssessment(recordingSession)) return;
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
    } catch (err) {
      console.error('Azure assessment error:', err);
      if (!this.shouldApplyAssessment(recordingSession)) return;
      const accuracyElement = document.getElementById('ra-accuracy-value');
      const feedbackElement = document.getElementById('ra-transcript-feedback');
      this.showAssessmentDisplay();
      if (statusMsg) {
        if (err?.code === 'INVALID_AUDIO' && err?.reason === 'too_long') {
          statusMsg.textContent = 'That recording was too long to score. Keep it under 40 seconds and try again.';
        } else if (err?.code === 'AZURE_ASSESSMENT_FAILED' && err?.reason === 'scores_unavailable') {
          statusMsg.textContent = 'We captured the transcript, but pronunciation scoring was unavailable. Keep it under 40 seconds and try again.';
        } else if (err?.code === 'INVALID_AUDIO') {
          statusMsg.textContent = 'We couldn’t read that recording. Please try again.';
        } else {
          statusMsg.textContent = 'Assessment failed. Please try again.';
        }
      }
      if (accuracyElement) accuracyElement.textContent = '--';
      if (feedbackElement) {
        const fallbackText = err?.code === 'INVALID_AUDIO' && err?.reason === 'too_long'
          ? 'That recording was too long for the current scorer. Try keeping it under 40 seconds.'
          : err?.code === 'AZURE_ASSESSMENT_FAILED' && err?.reason === 'scores_unavailable'
            ? 'Your speech was transcribed, but pronunciation scores were not returned for this attempt.'
            : 'We could not score this attempt.';
        feedbackElement.innerHTML = `<p style="line-height: 1.6; font-size: 1rem; padding: 10px; border: 1px solid #f3d1d1; border-radius: 8px; background: #fff7f7; color: #b42318;">${fallbackText}</p>`;
      }
      this.clearConnectedSpeechResults();
    }
  }

  async prepareWavBlob(blob) {
    if (blob.type === 'audio/wav' || blob.type === 'audio/wave') return blob;
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
    return this.audioBufferToWav(rendered);
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
    const statusMsg = document.getElementById('ra-status-message');
    const accuracyElement = document.getElementById('ra-accuracy-value');
    const feedbackElement = document.getElementById('ra-transcript-feedback');

    this.showAssessmentDisplay();
    if (statusMsg) statusMsg.textContent = 'Analysis complete.';
    if (accuracyElement) accuracyElement.textContent = payload.accuracyScore.toString();

    if (feedbackElement) {
      if (!payload.words || payload.words.length === 0) {
        feedbackElement.innerHTML = `You said: <i>"${payload.recognizedText || 'Nothing detected'}"</i>`;
      } else {
        const hasFiniteMetricValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
        const supplementalMetrics = [
          { label: 'Fluency', value: payload.fluencyScore },
          { label: 'Completeness', value: payload.completenessScore },
          { label: 'Overall', value: payload.pronScore }
        ].filter((metric) => hasFiniteMetricValue(metric.value));
        let html = '<p style="line-height: 1.6; font-size: 1.1rem; padding: 10px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;">';
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
          html += `<p style="margin-top: 10px; font-size: 0.95em; color: #4b5563;">${supplementalMetrics.map((metric) => `<strong>${metric.label}:</strong> ${metric.value}%`).join(' &nbsp;|&nbsp; ')}</p>`;
        }
        feedbackElement.innerHTML = html;
      }
    }

    this.renderConnectedSpeechResults(payload.connectedSpeech);
  }

  clearConnectedSpeechResults() {
    this.hideConnectedSpeechPanel();
  }

  hideConnectedSpeechPanel() {
    const box = document.getElementById('ra-connected-speech-box');
    const label = document.getElementById('ra-connected-speech-label');
    const list = document.getElementById('ra-connected-speech-list');
    const meta = document.getElementById('ra-connected-speech-meta');
    const summary = document.getElementById('ra-connected-speech-summary');
    this.connectedSpeechPanelMode = 'hidden';
    this.currentGuideExplanationItems = [];
    this.selectedGuideItemId = null;
    this.currentGuideHasVisibleAssimilation = false;
    this.guideExplanationsExpanded = null;
    this.guideExplanationsToggled = false;
    if (box) box.style.display = 'none';
    if (label) label.textContent = 'Speech Coach';
    if (list) list.innerHTML = '';
    if (meta) meta.textContent = 'Preview';
    if (summary) summary.textContent = '';
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
    const currentLevel = this.normalizeConnectedSpeechMode(this.connectedSpeechLevel);
    const allowedCategories = promptRecord
      ? new Set(Array.from(allowedCategoryMap.keys()).filter(Boolean))
      : null;
    if (allowedCategories && currentLevel && currentLevel !== 'off') {
      allowedCategories.add(currentLevel);
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
          borderStyle: 'border-left: 4px solid #b45309;'
        };
      }
      if (layer === 'weak_forms') {
        return {
          badgeStyle: 'background: rgba(217, 119, 6, 0.14); color: #92400e;',
          borderStyle: 'border-left: 4px solid #d97706;'
        };
      }
      return {
        badgeStyle: 'background: rgba(37, 99, 235, 0.12); color: #1d4ed8;',
        borderStyle: 'border-left: 4px solid #2563eb;'
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
        ? `<span style="font-size:0.86rem; color:#92400e; margin-left:6px;"><strong>Try:</strong> ${escapeHtml(item.spokenAs)}</span>`
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

  async renderConnectedSpeechResults(connectedSpeech) {
    const box = document.getElementById('ra-connected-speech-box');
    const label = document.getElementById('ra-connected-speech-label');
    const list = document.getElementById('ra-connected-speech-list');
    const summary = document.getElementById('ra-connected-speech-summary');
    if (!box || !label || !list || !summary) return;

    if (!connectedSpeech || connectedSpeech.status === 'not_applicable') {
      this.hideConnectedSpeechPanel();
      return;
    }

    this.connectedSpeechPanelMode = 'results';
    this.currentGuideExplanationItems = [];
    this.selectedGuideItemId = null;
    this.currentGuideHasVisibleAssimilation = false;
    box.style.display = 'block';
    label.textContent = 'Speech Coach';
    list.innerHTML = '';

    const wrapper = document.getElementById('ra-transcript-feedback');

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

    // Aggregate events into reduced-word groups vs linking issues/successes
    const events = Array.isArray(connectedSpeech.events) ? connectedSpeech.events : [];
    const { groupedReduced, linkingIssues, linkingSuccesses } = this._aggregateSpeechEvents(events);

    // Build annotated paragraph with token highlights + SVG overlay
    const usedTokenAnnotation = await this._buildAnnotatedParagraph(events, wrapper);

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
      leftCol.appendChild(this._buildReducedWordsSection(groupedReduced));
    }
    if (linkingIssues.length > 0) {
      rightCol.appendChild(this._buildLinkingIssuesSection(linkingIssues));
    }
    if (linkingSuccesses.length > 0) {
      rightCol.appendChild(this._buildSuccessPillsSection(linkingSuccesses));
    }

    fragment.appendChild(leftCol);
    fragment.appendChild(rightCol);
    list.appendChild(fragment);

    this.bindSpeechCoachAccordions(list);
  }


  /** Delegated accordion handler for Speech Coach results */
  bindSpeechCoachAccordions(container) {
    if (!container) return;
    container.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-sc-accordion-toggle]');
      if (!toggle) return;
      const targetId = toggle.dataset.scAccordionToggle;
      const content = document.getElementById(targetId);
      if (!content) return;
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!isExpanded));
      content.hidden = isExpanded;
      const chevron = toggle.querySelector('.sc-chevron');
      if (chevron) {
        chevron.classList.toggle('sc-chevron--open', !isExpanded);
      }
    });
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
  async _buildAnnotatedParagraph(events, wrapper) {
    const annotatedContainer = document.createElement('div');
    annotatedContainer.className = 'sc-annotated-paragraph';

    let usedTokenAnnotation = false;
    if (window.ReadAloudLinking && this.currentPromptPlainText) {
      try {
        const analysisOptions = { connectedSpeechLevel: 'sound_changes', enabledRuleSet: 'connected-speech-v3' };
        const targetPromptKey = this.currentPromptId || 'result_eval';
        const analysis = await this.getPromptAnalysis(targetPromptKey, this.currentPromptPlainText, analysisOptions);
        const tokens = analysis.tokens;
        if (tokens && tokens.length > 0) {
          const wordMap = window.ReadAloudLinking.renderLinkingLayer(annotatedContainer, { tokens, boundaries: [], tokenAnnotations: [] });

          // Apply status-based CSS classes to matching word spans
          events.forEach((ev) => {
            if (!ev.phrase) return;
            const phraseLower = ev.phrase.toLowerCase().trim();
            wordMap.forEach((span) => {
              const spanText = (span.textContent || '').toLowerCase().trim();
              if (spanText === phraseLower && !span.dataset.scHighlighted) {
                span.dataset.scHighlighted = 'true';
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
            window.ReadAloudLinking.renderOverlay(overlaySvg, annotatedContainer, { boundaries: overlayBoundaries }, wordMap);
            usedTokenAnnotation = true;
          }
        }
      } catch (tokenErr) {
        console.warn('Token annotation failed, falling back to plain text:', tokenErr);
      }
    }

    if (!usedTokenAnnotation) {
      if (wrapper) wrapper.innerHTML = '';
      annotatedContainer.textContent = this.currentPromptPlainText || '';
      if (wrapper) wrapper.appendChild(annotatedContainer);
    }

    return usedTokenAnnotation;
  }

  /** Build "Reduced Words" section with accordion cards and single-occurrence grid */
  _buildReducedWordsSection(groupedReduced) {
    const escapeHtml = ReadAloudMode.escapeHtml;
    const section = document.createElement('div');
    section.className = 'sc-section';

    const header = document.createElement('h4');
    header.className = 'sc-section-header';
    header.innerHTML = 'Reduced Words <span class="sc-info-tip" title="In natural speech, common words like &ldquo;to&rdquo;, &ldquo;and&rdquo;, &ldquo;of&rdquo; are pronounced shorter and lighter. This section checks whether you did that.">ⓘ</span>';
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
        const accordionId = `sc-accordion-${groupIdx}`;

        const card = document.createElement('div');
        card.className = `sc-accordion-card ${statusClass}`;
        const cardHeader = document.createElement('button');
        cardHeader.type = 'button';
        cardHeader.className = 'sc-accordion-toggle';
        cardHeader.setAttribute('aria-expanded', 'false');
        cardHeader.setAttribute('aria-controls', accordionId);
        cardHeader.dataset.scAccordionToggle = accordionId;

        const labelSide = document.createElement('div');
        labelSide.className = 'sc-accordion-label';
        labelSide.innerHTML = `<strong class="sc-word-title">${escapeHtml(group.phrase)}</strong><span class="sc-count-badge">${totalCount}x</span>`;

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
          const instance = document.createElement('div');
          instance.className = `sc-instance${idx > 0 ? ' sc-instance--bordered' : ''}`;
          const statusCls = i.status === 'detected' ? 'sc-badge--success' : i.status === 'not_detected' ? 'sc-badge--error' : 'sc-badge--uncertain';
          instance.innerHTML = `<div class="sc-instance-header"><span class="sc-status-badge ${statusCls}">${escapeHtml(i.status || 'uncertain')}</span><span class="sc-instance-label">Instance ${idx + 1}</span></div><div class="sc-instance-feedback">${escapeHtml(i.feedbackText || 'No detailed coaching tips provided for this instance.')}</div>`;
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
        const statusClass = item.status === 'detected' ? 'sc-border--success' : item.status === 'not_detected' ? 'sc-border--error' : 'sc-border--mixed';
        const dotCls = item.status === 'detected' ? 'sc-status-dot--success' : item.status === 'not_detected' ? 'sc-status-dot--error' : 'sc-status-dot--uncertain';
        const card = document.createElement('div');
        card.className = `sc-single-card ${statusClass}`;
        card.title = item.feedbackText || '';
        card.innerHTML = `<strong class="sc-word-title">${escapeHtml(group.phrase)}</strong><span class="sc-status-dot ${dotCls}"></span>`;
        gridContainer.appendChild(card);
      });
      section.appendChild(gridContainer);
    }

    return section;
  }

  /** Build "Needs Attention" section with issue cards */
  _buildLinkingIssuesSection(linkingIssues) {
    const escapeHtml = ReadAloudMode.escapeHtml;
    const section = document.createElement('div');
    section.className = 'sc-section';

    const header = document.createElement('h4');
    header.className = 'sc-section-header';
    header.innerHTML = 'Needs Attention <span class="sc-info-tip" title="These are places where words should flow together smoothly, but the link wasn\'t detected in your speech. Try saying them closer together.">ⓘ</span>';
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

    linkingIssues.forEach((event) => {
      const { categoryLabel } = resolveCategory(event);
      const borderCls = event.status === 'not_detected' ? 'sc-border--error' : 'sc-border--mixed';
      const card = document.createElement('div');
      card.className = `sc-issue-card ${borderCls}`;
      const badgeCls = event.status === 'not_detected' ? 'sc-badge--error' : 'sc-badge--uncertain';
      card.innerHTML = `<div class="sc-issue-header"><strong class="sc-issue-phrase">${escapeHtml(event.phrase || event.eventId || 'Event')}</strong><span class="sc-status-badge ${badgeCls}">${escapeHtml(event.status || 'uncertain')}</span></div><div class="sc-issue-category">${escapeHtml(categoryLabel)}</div><div class="sc-issue-feedback">${escapeHtml(event.feedbackText || '')}</div>`;
      issueStack.appendChild(card);
    });

    section.appendChild(issueStack);
    return section;
  }

  /** Build "Successful Links" section with green pill tags */
  _buildSuccessPillsSection(linkingSuccesses) {
    const escapeHtml = ReadAloudMode.escapeHtml;
    const section = document.createElement('div');
    section.className = 'sc-section';

    const header = document.createElement('h4');
    header.className = 'sc-section-header';
    header.innerHTML = 'Successful Links <span class="sc-info-tip" title="These word pairs flowed together naturally in your speech. Nice work!">ⓘ</span>';
    section.appendChild(header);

    const pillWrap = document.createElement('div');
    pillWrap.className = 'sc-pill-wrap';

    linkingSuccesses.forEach((event) => {
      const pill = document.createElement('span');
      pill.className = 'sc-success-pill';
      pill.title = event.feedbackText || '';
      pill.innerHTML = `<svg class="sc-check-icon" width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>${escapeHtml(event.phrase || 'Word')}`;
      pillWrap.appendChild(pill);
    });

    section.appendChild(pillWrap);
    return section;
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
        playBtn.disabled = false;
        playBtn.innerHTML = 'Play';
        playBtn.style.opacity = '1';
        playBtn.title = 'Listen to reference audio';
      }
      this.updateAudioSrc();
      return;
    }

    if (playBtn) {
      playBtn.disabled = true;
      playBtn.innerHTML = 'Unavailable';
      playBtn.style.opacity = '0.5';
      playBtn.title = 'Audio not yet generated for this text';
    }
  }

  updateAudioSrc() {
    const audioEl = document.getElementById('ra-elevenlabs-audio');
    if (!audioEl || !this.audioManifest || !this.currentQuestionId) return;
    const entry = this.audioManifest[this.currentQuestionId];
    if (!entry) return;
    const genderEntry = entry[this.selectedGender];
    if (!genderEntry || !genderEntry.files) return;
    const filename = genderEntry.files[this.selectedSpeed];
    if (filename) {
      audioEl.src = `/database/RA/Voice/audio/${filename}`;
      audioEl.load();
    }
  }

  setGender(gender) {
    this.selectedGender = gender;
    const maleBtn = document.getElementById('ra-voice-male');
    const femaleBtn = document.getElementById('ra-voice-female');
    if (gender === 'male') {
      if (maleBtn) {
        maleBtn.style.background = '#3b82f6';
        maleBtn.style.color = '#ffffff';
        maleBtn.style.fontWeight = '600';
        maleBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      }
      if (femaleBtn) {
        femaleBtn.style.background = 'transparent';
        femaleBtn.style.color = '#4b5563';
        femaleBtn.style.fontWeight = '500';
        femaleBtn.style.boxShadow = 'none';
      }
    } else {
      if (femaleBtn) {
        femaleBtn.style.background = '#3b82f6';
        femaleBtn.style.color = '#ffffff';
        femaleBtn.style.fontWeight = '600';
        femaleBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      }
      if (maleBtn) {
        maleBtn.style.background = 'transparent';
        maleBtn.style.color = '#4b5563';
        maleBtn.style.fontWeight = '500';
        maleBtn.style.boxShadow = 'none';
      }
    }
    this.updateAudioSrc();
  }

  setSpeed(speed) {
    this.selectedSpeed = speed;
    const normalBtn = document.getElementById('ra-speed-100');
    const slowBtn = document.getElementById('ra-speed-80');
    if (speed === '100') {
      if (normalBtn) {
        normalBtn.style.background = '#3b82f6';
        normalBtn.style.color = '#ffffff';
        normalBtn.style.fontWeight = '600';
        normalBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      }
      if (slowBtn) {
        slowBtn.style.background = 'transparent';
        slowBtn.style.color = '#4b5563';
        slowBtn.style.fontWeight = '500';
        slowBtn.style.boxShadow = 'none';
      }
    } else {
      if (slowBtn) {
        slowBtn.style.background = '#3b82f6';
        slowBtn.style.color = '#ffffff';
        slowBtn.style.fontWeight = '600';
        slowBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      }
      if (normalBtn) {
        normalBtn.style.background = 'transparent';
        normalBtn.style.color = '#4b5563';
        normalBtn.style.fontWeight = '500';
        normalBtn.style.boxShadow = 'none';
      }
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
});
