/**
 * Speaking Practice Adapters — Mode Registration
 * Each adapter registers a configuration describing the mode's capabilities
 * with SpeakingPracticeController.
 *
 * Adapters are added incrementally per migration wave.
 * Wave 0: No production adapters (test-only synthetic adapter in browser tests)
 * Wave 1: RTS, ASQ
 * Wave 2: Describe Image, Retell Lecture
 * Wave 3A: SGD
 * Wave 3B: Repeat Sentence (Speak)
 * Wave 3C: Write From Dictation (Type)
 * Wave 4: Read Aloud (3 sub-gates)
 */
(function () {
  'use strict';

  // Guard: controller must be loaded first
  if (!window.SpeakingPracticeController) {
    console.warn('[SPC Adapters] SpeakingPracticeController not found. Skipping adapter registration.');
    return;
  }

  const controller = window.SpeakingPracticeController;

  /**
   * Safely checks if a filter label element differs from its default value.
   * Returns false if the element does not exist in the DOM.
   */
  function isFilterActive(elementId, defaultText) {
    const el = document.getElementById(elementId);
    if (!el) return false;
    const text = el.textContent?.trim();
    return text !== undefined && text !== defaultText;
  }

  /**
   * True when an element exists and is not display:none (walking ancestors is
   * unnecessary here — the step hosts are toggled directly by their own mode).
   */
  function isShown(elementId) {
    const el = document.getElementById(elementId);
    return !!el && el.style.display !== 'none' && !el.hidden;
  }

  /**
   * Read the active index from a mode-owned progress breadcrumb.
   *
   * RTS / SGD / Describe Image keep their own breadcrumb nodes updated by their
   * state machines, but speaking-practice-controller.css hides them so the
   * shared preview is the only learner-facing indicator. Deriving the index
   * from those nodes reuses that live state without duplicating it.
   */
  function activeBreadcrumbIndex(containerId, itemSelector) {
    const container = document.getElementById(containerId);
    if (!container) return 0;
    const items = [...container.querySelectorAll(itemSelector)];
    const index = items.findIndex((item) => item.classList.contains('active'));
    return index === -1 ? 0 : index;
  }

  function shiftSelectOption(selectId, direction) {
    const select = document.getElementById(selectId);
    if (!select || !select.options.length) return;
    const nextIndex = select.selectedIndex + direction;
    if (nextIndex < 0 || nextIndex >= select.options.length) return;
    select.selectedIndex = nextIndex;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function panelHost(controllerState, selector) {
    if (!selector || !controllerState?.panel) return null;
    return controllerState.panel.querySelector(selector) || null;
  }

  function phaseHost(controllerState, selectors, fallbackSelector) {
    const index = typeof controllerState?.config?.getStepIndex === 'function'
      ? controllerState.config.getStepIndex()
      : 0;
    return panelHost(controllerState, selectors[index] || fallbackSelector);
  }

  function progressHost(controllerState) {
    return panelHost(controllerState, '[data-practice-progress-host]');
  }

  function notesPhaseHost(controllerState) {
    if (isShown('notes-step-results')) return panelHost(controllerState, '#notes-results-action-host');
    if (isShown('notes-step-audio')) return panelHost(controllerState, '#notes-audio-action-host');
    if (isShown('notes-step-video')) return panelHost(controllerState, '#notes-video-action-host');
    return panelHost(controllerState, '#notes-ready-action-host');
  }

  // Wave 1: Answer Short Question. The native select remains the state source;
  // the controller only adopts the existing lifecycle controls.
  controller.register({
    modeId: 'asq',
    shell: 'v3',
    v3: {
      title: 'Answer Short Question',
      cardBodySelector: '#asq-practice-area',
      progressSteps: ['Listen', 'Answer', 'Feedback'],
      phaseToStep: { loading: 0, listen: 0, prep: 1, recording: 1, complete: 1, feedback: 2 },
      statusText: { recording: 'Answer the question.' },
      getPhase: () => window.ASQMode?.getPtePhase?.() || 'loading',
      onMount: () => window.ASQMode?.mountPteShell?.(),
      onSync: () => window.ASQMode?.syncPteShell?.(),
      onUnmount: () => window.ASQMode?.unmountPteShell?.(),
      filters: [],
      dock: {
        helpers: [
          {
            id: 'asq-replay-btn',
            label: 'Replay question',
            phases: ['prep', 'complete'],
            onClick: () => window.ASQMode?.replayQuestion?.()
          }
        ],
        actions: [
          { sourceId: 'asq-record-btn', label: 'Start recording', variant: 'primary', phases: ['prep'] },
          { sourceId: 'asq-cancel-btn', label: 'Cancel', variant: 'ghost', phases: ['recording'] },
          { sourceId: 'asq-stop-btn', label: 'Finish recording', variant: 'stop', phases: ['recording'] },
          { sourceId: 'asq-retry-btn', label: 'Record again', variant: 'ghost', phases: ['complete'] },
          { sourceId: 'asq-play-btn', label: 'Play', phases: ['complete'] },
          { sourceId: 'asq-submit-btn', label: 'Get feedback', variant: 'primary', phases: ['complete'] },
          { sourceId: 'asq-redo-btn', label: 'Try again', variant: 'ghost', phases: ['feedback'] }
        ]
      },
      next: {
        onConfirmFromRecording: () => window.ASQMode?.finishRecordingForNext?.(),
        goNext: () => window.ASQMode?.advanceQuestion?.()
      },
      attempts: {
        practiceMode: 'asq',
        modeLabel: 'Answer Short Question',
        getPromptId: () => window.ASQMode?.currentId || null,
        formatScores: (attempt) => {
          const res = attempt.resultSnapshot;
          if (res) {
            if (res.correct === true) return ['Correct'];
            if (res.correct === false) return ['Incorrect'];
          }
          return ['—'];
        }
      }
    },
    enabledScopes: ['pte'],
    panelId: 'mode-asq',
    steps: ['Listen', 'Answer', 'Results'],
    getStepIndex: () => {
      if (isShown('asq-result-box')) return 2;
      if (window.ASQMode?.isRecording) return 1;
      return 0;
    },
    layout: {
      mediaHost: (state) => panelHost(state, '.asq-audio'),
      attemptHost: (state) => panelHost(state, '#asq-action-host'),
      progressHost
    },
    picker: {
      sourceSelectId: 'asq-question-select',
      previous: () => shiftSelectOption('asq-question-select', -1),
      next: () => shiftSelectOption('asq-question-select', 1)
    },
    legacyContainerSelector: '#mode-asq > .question-selector',
    // The prompt Play control now lives inside the shared .practice-audio-player box
    // in the panel body, so it is deliberately not hoisted into the toolbar.
    controls: [
      { sourceId: 'asq-record-btn', slot: 'attempt', level: 'basic', order: 1, actionRole: 'record' },
      { sourceId: 'asq-stop-btn', slot: 'attempt', level: 'basic', order: 2, actionRole: 'stop' },
      { sourceId: 'asq-redo-btn', slot: 'attempt', level: 'basic', order: 3, actionRole: 'retry' }
    ]
  });

  // Wave 1: Respond to a Situation. RTS exposes a small picker bridge while
  // retaining its mode-owned step flow, timers, scoring, and result controls.
  controller.register({
    modeId: 'rts',
    shell: 'v3',
    v3: {
      title: 'Respond to a Situation',
      cardBodySelector: '#rts-practice-area',
      progressSteps: ['Listen', 'Prep', 'Record', 'Feedback'],
      phaseToStep: { loading: 0, listen: 0, prep: 1, recording: 2, complete: 2, feedback: 3 },
      statusText: { recording: 'Respond to the situation.' },
      getPhase: () => window.RTSMode?.getPtePhase?.() || 'loading',
      onMount: () => window.RTSMode?.mountPteShell?.(),
      onSync: () => window.RTSMode?.syncPteShell?.(),
      onUnmount: () => window.RTSMode?.unmountPteShell?.(),
      filters: [],
      dock: {
        actions: [
          { sourceId: 'rts-record-btn', label: 'Start recording', variant: 'primary', phases: ['prep'] },
          { sourceId: 'rts-cancel-btn', label: 'Cancel', variant: 'ghost', phases: ['recording'] },
          { sourceId: 'rts-stop-btn', label: 'Finish recording', variant: 'stop', phases: ['recording'] },
          { sourceId: 'rts-retry-btn', label: 'Record again', variant: 'ghost', phases: ['complete'] },
          { sourceId: 'rts-play-btn', label: 'Play', phases: ['complete'] },
          { sourceId: 'rts-submit-btn', label: 'Get feedback', variant: 'primary', phases: ['complete'] },
          { sourceId: 'rts-redo-btn', label: 'Try again', variant: 'ghost', phases: ['feedback'] }
        ]
      },
      next: {
        onConfirmFromRecording: () => window.RTSMode?.finishRecordingForNext?.(),
        goNext: () => window.RTSMode?.advanceQuestion?.()
      },
      attempts: {
        practiceMode: 'rts',
        modeLabel: 'Respond to a Situation',
        getPromptId: () => window.RTSMode?.getCurrentId?.() || null,
        formatScores: (attempt) => {
          const res = attempt.resultSnapshot;
          if (res?.overall?.total != null && Number.isFinite(Number(res.overall.total))) {
            return [`${res.overall.total}/${res.overall.maxTotal || 6}`];
          }
          const rawScore = res?.score ?? attempt.score;
          if (rawScore != null && Number.isFinite(Number(rawScore))) {
            return [`${rawScore}/6`];
          }
          return ['—'];
        }
      }
    },
    enabledScopes: ['pte'],
    panelId: 'mode-rts',
    steps: ['Audio', 'Prep', 'Record', 'Results'],
    getStepIndex: () => activeBreadcrumbIndex('rts-step-progress', '.rts-step-dot'),
    layout: {
      mediaHost: (state) => panelHost(state, '#rts-start-controls'),
      attemptHost: (state) => phaseHost(state, {
        0: '#rts-audio-action-host',
        1: '#rts-prep-action-host',
        2: '#rts-action-host',
        3: '#rts-results-action-host'
      }, '#rts-audio-action-host'),
      progressHost
    },
    picker: {
      getItems: () => window.RTSMode?.getItems?.() ?? [],
      getCurrentId: () => window.RTSMode?.getCurrentId?.() ?? null,
      select: (id) => { try { window.RTSMode?.select?.(id); } catch (e) { console.error('[SPC Adapters] select error:', e); } },
      previous: () => {
        try {
          const items = window.RTSMode?.getItems?.() ?? [];
          const currentId = String(window.RTSMode?.getCurrentId?.() ?? '');
          const index = items.findIndex((item) => String(item.id) === currentId);
          if (index > 0) window.RTSMode?.select?.(items[index - 1].id);
        } catch (e) {
          console.error('[SPC Adapters] previous error:', e);
        }
      },
      next: () => {
        try {
          const items = window.RTSMode?.getItems?.() ?? [];
          const currentId = String(window.RTSMode?.getCurrentId?.() ?? '');
          const index = items.findIndex((item) => String(item.id) === currentId);
          if (index >= 0 && index < items.length - 1) window.RTSMode?.select?.(items[index + 1].id);
        } catch (e) {
          console.error('[SPC Adapters] next error:', e);
        }
      },
      legacyContainerId: 'rts-v7-picker-bar'
    },
    controls: [
      { sourceId: 'play-rts-btn', slot: 'media', level: 'basic', order: 1, actionRole: 'play' },
      { sourceId: 'rts-stop-btn', slot: 'attempt', level: 'basic', order: 1, actionRole: 'stop', visibilityScopeId: 'rts-step-record' },
      { sourceId: 'rts-retry-btn', slot: 'attempt', level: 'basic', order: 2, actionRole: 'retry', visibilityScopeId: 'rts-step-results' },
      { sourceId: 'rts-ai-score-btn', slot: 'attempt', level: 'basic', order: 3, actionRole: 'ai', visibilityScopeId: 'rts-step-results' },
      { sourceId: 'rts-next-question-btn', slot: 'attempt', level: 'basic', order: 4, actionRole: 'next', visibilityScopeId: 'rts-step-results' }
    ],
    legacyContainerSelector: '#mode-rts > .question-selector'
  });

  // Wave 1: Summarize Group Discussion.
  controller.register({
    modeId: 'sgd',
    shell: 'v3',
    v3: {
      title: 'Summarize Group Discussion',
      cardBodySelector: '#sgd-practice-area',
      progressSteps: ['Listen', 'Prep', 'Record', 'Feedback'],
      phaseToStep: { loading: 0, listen: 0, prep: 1, recording: 2, complete: 2, feedback: 3 },
      statusText: { recording: 'Summarize the group discussion.' },
      getPhase: () => window.SGDMode?.getPtePhase?.() || 'loading',
      onMount: () => window.SGDMode?.mountPteShell?.(),
      onSync: () => window.SGDMode?.syncPteShell?.(),
      onUnmount: () => window.SGDMode?.unmountPteShell?.(),
      filters: [],
      dock: {
        actions: [
          { sourceId: 'sgd-record-btn', label: 'Start recording', variant: 'primary', phases: ['prep'] },
          { sourceId: 'sgd-cancel-btn', label: 'Cancel', variant: 'ghost', phases: ['recording'] },
          { sourceId: 'sgd-stop-btn', label: 'Finish recording', variant: 'stop', phases: ['recording'] },
          { sourceId: 'sgd-retry-btn', label: 'Record again', variant: 'ghost', phases: ['complete'] },
          { sourceId: 'sgd-play-user-btn', label: 'Play', phases: ['complete'] },
          { sourceId: 'sgd-submit-btn', label: 'Get feedback', variant: 'primary', phases: ['complete'] },
          { sourceId: 'sgd-redo-btn', label: 'Try again', variant: 'ghost', phases: ['feedback'] }
        ]
      },
      next: {
        onConfirmFromRecording: () => window.SGDMode?.finishRecordingForNext?.(),
        goNext: () => window.SGDMode?.advanceQuestion?.()
      },
      attempts: {
        practiceMode: 'sgd',
        modeLabel: 'Summarize Group Discussion',
        getPromptId: () => window.SGDMode?.getCurrentId?.() || null,
        formatScores: (attempt) => {
          const res = attempt.resultSnapshot;
          if (res?.overall?.accuracy != null && Number.isFinite(Number(res.overall.accuracy))) {
            return [`${Math.round(res.overall.accuracy * 100)}%`];
          }
          if (res?.score != null && Number.isFinite(Number(res.score))) {
            return [`${res.score}%`];
          }
          return ['—'];
        }
      }
    },
    enabledScopes: ['pte'],
    panelId: 'mode-sgd',
    steps: ['Listen', 'Record', 'Results'],
    getStepIndex: () => activeBreadcrumbIndex('sgd-step-progress', '.sgd-progress-step'),
    layout: {
      mediaHost: (state) => panelHost(state, '#sgd-start-controls'),
      attemptHost: (state) => phaseHost(state, {
        0: '#sgd-listen-action-host',
        1: '#sgd-action-host',
        2: '#sgd-results-action-host'
      }, '#sgd-listen-action-host'),
      progressHost
    },
    picker: {
      getItems: () => window.SGDMode?.getItems?.() ?? [],
      getCurrentId: () => window.SGDMode?.getCurrentId?.() ?? null,
      select: (id) => { try { window.SGDMode?.select?.(id); } catch (e) { console.error('[SPC Adapters] select error:', e); } },
      previous: () => {
        try {
          const items = window.SGDMode?.getItems?.() ?? [];
          const currentId = String(window.SGDMode?.getCurrentId?.() ?? '');
          const index = items.findIndex((item) => String(item.id) === currentId);
          if (index > 0) window.SGDMode?.select?.(items[index - 1].id);
        } catch (e) {
          console.error('[SPC Adapters] previous error:', e);
        }
      },
      next: () => {
        try {
          const items = window.SGDMode?.getItems?.() ?? [];
          const currentId = String(window.SGDMode?.getCurrentId?.() ?? '');
          const index = items.findIndex((item) => String(item.id) === currentId);
          if (index >= 0 && index < items.length - 1) window.SGDMode?.select?.(items[index + 1].id);
        } catch (e) {
          console.error('[SPC Adapters] next error:', e);
        }
      },
      sourceSelectId: 'question-select-sgd',
      previousButtonId: 'back-btn-sgd',
      nextButtonId: 'next-btn-sgd'
    },
    controls: [
      { sourceId: 'play-sgd-btn', slot: 'media', level: 'basic', order: 1, actionRole: 'play' },
      { sourceId: 'sgd-next-step-btn', slot: 'attempt', level: 'basic', order: 1, actionRole: 'primary', visibilityScopeId: 'sgd-step-listen' },
      { sourceId: 'sgd-record-btn', slot: 'attempt', level: 'basic', order: 1, actionRole: 'record', visibilityScopeId: 'sgd-step-record' },
      { sourceId: 'sgd-stop-btn', slot: 'attempt', level: 'basic', order: 2, actionRole: 'stop', visibilityScopeId: 'sgd-step-record' },
      { sourceId: 'sgd-submit-btn', slot: 'attempt', level: 'basic', order: 3, actionRole: 'primary', visibilityScopeId: 'sgd-step-record' },
      { sourceId: 'sgd-retry-btn', slot: 'attempt', level: 'basic', order: 4, actionRole: 'retry', visibilityScopeId: 'sgd-step-results' },
      { sourceId: 'recommended-btn-sgd', slot: 'advanced-action', level: 'advanced', order: 1, actionRole: 'support' },
      { sourceId: 'difficulty-filter-container-sgd', slot: 'advanced-setting', level: 'advanced', order: 1 }
    ],
    legacyContainerSelector: '#mode-sgd > .question-selector',
    advancedSettings: [
      {
        key: 'difficulty',
        sourceId: 'difficulty-filter-container-sgd',
        isActive: () => isFilterActive('difficulty-filter-label-sgd', 'Recommended'),
        summaryLabel: 'Difficulty filter'
      }
    ]
  });

  // Wave 2: Describe Image. Filters and recommendations live in Advanced;
  // step/result actions remain lifecycle controls in the shared shell.
  controller.register({
    modeId: 'describe-image',
    shell: 'v3',
    v3: {
      title: 'Describe Image',
      cardBodySelector: '#di-practice-area',
      progressSteps: ['Prepare', 'Record', 'Feedback'],
      getPhase: () => window.DescribeImageMode?.getPtePhase?.() || 'loading',
      onMount: () => window.DescribeImageMode?.mountPteShell?.(),
      onSync: () => window.DescribeImageMode?.syncPteShell?.(),
      onUnmount: () => window.DescribeImageMode?.unmountPteShell?.(),
      filters: [
        {
          label: 'Difficulty',
          get: () => window.DescribeImageMode?.getDifficultyFilter?.() || 'all',
          set: (val) => window.DescribeImageMode?.setDifficultyFilter?.(val),
          options: [
            { value: 'all', label: 'Recommended' },
            { value: '1', label: 'Level 1 (Easy)' },
            { value: '2', label: 'Level 2 (Medium)' },
            { value: '3', label: 'Level 3 (Hard)' }
          ]
        }
      ],
      dock: {
        actions: [
          { sourceId: 'di-record-btn', label: 'Start recording', variant: 'primary', phases: ['prep'] },
          { sourceId: 'di-cancel-btn', label: 'Cancel', variant: 'ghost', phases: ['recording'] },
          { sourceId: 'di-stop-btn', label: 'Finish recording', variant: 'stop', phases: ['recording'] },
          { sourceId: 'di-retry-btn', label: 'Record again', variant: 'ghost', phases: ['complete'] },
          { sourceId: 'di-play-btn', label: 'Play', phases: ['complete'] },
          { sourceId: 'di-submit-btn', label: 'Get feedback', variant: 'primary', phases: ['complete'] },
          { sourceId: 'di-results-retry-btn', label: 'Try again', variant: 'ghost', phases: ['feedback'] }
        ]
      },
      next: {
        onConfirmFromRecording: () => window.DescribeImageMode?.finishRecordingForNext?.(),
        goNext: () => window.DescribeImageMode?.advanceQuestion?.()
      },
      attempts: {
        practiceMode: 'describe-image',
        modeLabel: 'Describe Image',
        getPromptId: () => window.DescribeImageMode?.getCurrentQuestionId?.(),
        formatScores: attempt => {
          const res = attempt.resultSnapshot;
          if (res && Number.isFinite(res.score)) {
            return [`Score ${res.score}/5`];
          }
          return ['Key points —/5'];
        }
      }
    },
    enabledScopes: ['pte'],
    panelId: 'mode-describe-image',
    // Three phases, matching #di-step-progress. The previous four-step list
    // (Image / Prep / Record / Results) did not match the state machine.
    steps: ['Prepare', 'Record', 'Review'],
    getStepIndex: () => activeBreadcrumbIndex('di-step-progress', '.di-progress-step'),
    layout: {
      mediaHost: (state) => panelHost(state, '#di-start-controls'),
      attemptHost: (state) => phaseHost(state, {
        0: '#di-prepare-action-host',
        1: '#di-action-host',
        2: '#di-review-action-host',
        3: '#di-results-action-host'
      }, '#di-prepare-action-host'),
      progressHost
    },
    picker: {
      sourceSelectId: 'question-select-di',
      previousButtonId: 'back-btn-di',
      nextButtonId: 'next-btn-di'
    },
    legacyContainerSelector: '#mode-describe-image > .question-selector',
    controls: [
      { sourceId: 'play-di-btn', slot: 'media', level: 'basic', order: 1, actionRole: 'play' },
      { sourceId: 'di-stop-btn', slot: 'attempt', level: 'basic', order: 1, actionRole: 'stop', visibilityScopeId: 'di-step-record' },
      { sourceId: 'di-retry-btn', slot: 'attempt', level: 'basic', order: 2, actionRole: 'retry', visibilityScopeId: 'di-step-review' },
      { sourceId: 'di-submit-btn', slot: 'attempt', level: 'basic', order: 3, actionRole: 'primary', visibilityScopeId: 'di-step-review' },
      { sourceId: 'di-results-retry-btn', slot: 'attempt', level: 'basic', order: 4, actionRole: 'retry', visibilityScopeId: 'di-step-results' },
      { sourceId: 'di-next-question-btn', slot: 'attempt', level: 'basic', order: 5, actionRole: 'next', visibilityScopeId: 'di-step-results' },
      { sourceId: 'di-ai-btn', slot: 'advanced-action', level: 'advanced', order: 1, actionRole: 'ai', visibilityScopeId: 'di-step-results' },
      { sourceId: 'difficulty-filter-container-di', slot: 'advanced-setting', level: 'advanced', order: 1 }
    ],
    advancedSettings: [
      {
        key: 'difficulty',
        sourceId: 'difficulty-filter-container-di',
        isActive: () => isFilterActive('difficulty-filter-label-di', 'Recommended'),
        summaryLabel: 'Difficulty filter'
      }
    ]
  });

  // Wave 2: PTE Retell Lecture (the existing Take Notes implementation).
  // English Take Notes stays legacy because enabledScopes intentionally omits it.
  controller.register({
    modeId: 'notes',
    shell: 'v3',
    v3: {
      title: 'Retell Lecture',
      cardBodySelector: '#notes-practice-area',
      progressSteps: ['Listen', 'Record', 'Feedback'],
      phaseToStep: { loading: 0, listen: 0, prep: 1, recording: 1, complete: 1, feedback: 2 },
      statusText: {
        listen: 'Listen and take notes.',
        prep: 'Prepare to retell the lecture in 10 seconds.',
        recording: 'Retell what you have heard from the lecture.',
        complete: 'Audio ended. Review your notes and get feedback.'
      },
      getPhase: () => window.TakeNotesMode?.getPtePhase?.() || 'loading',
      onMount: () => window.TakeNotesMode?.mountPteShell?.(),
      onSync: () => window.TakeNotesMode?.syncPteShell?.(),
      onUnmount: () => window.TakeNotesMode?.unmountPteShell?.(),
      filters: [
        {
          label: 'Status',
          get: () => window.TakeNotesMode?.getCurrentFilter?.() || 'all',
          set: (val) => window.TakeNotesMode?.applyFilters?.(val),
          options: [
            { value: 'all', label: 'All Questions' },
            { value: 'has-video', label: 'Guiding Video' },
            { value: 'no-video', label: 'No Guiding Video' }
          ]
        },
        {
          label: 'Difficulty',
          get: () => window.DifficultyFilter ? window.DifficultyFilter.getCurrentDifficulty('notes') : 'all',
          set: (val) => window.DifficultyFilter?.setDifficulty?.('notes', val),
          options: [
            { value: 'all', label: 'Recommended' },
            { value: '1', label: 'Level 1 (Easy)' },
            { value: '2', label: 'Level 2 (Medium)' },
            { value: '3', label: 'Level 3 (Hard)' }
          ]
        }
      ],
      dock: {
        helpers: [
          {
            id: 'notes-intro-video-btn',
            label: 'Intro video',
            phases: ['listen', 'complete'],
            count: () => (window.TakeNotesMode?.hasGuidingVideo?.() ? 1 : 0),
            onClick: () => window.TakeNotesMode?.openIntroVideoModal?.()
          }
        ],
        actions: [
          { sourceId: 'notes-record-btn', label: 'Start recording', variant: 'primary', phases: ['prep'] },
          { sourceId: 'notes-cancel-btn', label: 'Cancel', variant: 'ghost', phases: ['recording'] },
          { sourceId: 'notes-stop-btn', label: 'Finish recording', variant: 'stop', phases: ['recording'] },
          { sourceId: 'notes-retry-btn', label: 'Record again', variant: 'ghost', phases: ['complete'] },
          { sourceId: 'notes-rec-play-btn', label: 'Play', phases: ['complete'] },
          { sourceId: 'notes-submit-btn', label: 'Get feedback', variant: 'primary', phases: ['complete'] },
          { sourceId: 'notes-redo-btn', label: 'Try again', variant: 'ghost', phases: ['feedback'] }
        ]
      },
      next: {
        onConfirmFromRecording: () => window.TakeNotesMode?.finishRecordingForNext?.(),
        goNext: () => window.TakeNotesMode?.advanceQuestion?.()
      },
      attempts: {
        practiceMode: 'notes',
        modeLabel: 'Retell Lecture',
        getPromptId: () => window.TakeNotesMode?.getCurrentEntry?.()?.id || null,
        formatScores: (attempt) => {
          const res = attempt.resultSnapshot;
          if (res?.score != null && Number.isFinite(Number(res.score))) {
            const max = res.maxScore ? `/${res.maxScore}` : '';
            return [`${res.score}${max} matched`];
          }
          const rawScore = attempt.score;
          if (rawScore != null && Number.isFinite(Number(rawScore))) {
            return [`${rawScore} matched`];
          }
          return ['—'];
        }
      }
    },
    enabledScopes: ['pte'],
    panelId: 'mode-notes',
    // Retell Lecture as implemented never records: the flow is guiding video →
    // listen and take notes → results. The old 'Record' step did not exist.
    steps: ['Video', 'Notes', 'Results'],
    getStepIndex: () => {
      if (isShown('notes-step-results')) return 2;
      if (isShown('notes-step-audio')) return 1;
      return 0;
    },
    layout: {
      mediaHost: (state) => panelHost(state, '#notes-audio-host'),
      attemptHost: (state) => notesPhaseHost(state),
      progressHost
    },
    picker: {
      getItems: () => window.TakeNotesMode?.getItems?.() ?? [],
      getCurrentId: () => window.TakeNotesMode?.getCurrentEntry()?.id ?? null,
      select: (id) => { try { window.TakeNotesMode?.selectEntryById?.(id); } catch (e) { console.error('[SPC Adapters] select error:', e); } },
      previous: () => { try { window.TakeNotesMode?.previous?.(); } catch (e) { console.error('[SPC Adapters] previous error:', e); } },
      next: () => { try { window.TakeNotesMode?.next?.(); } catch (e) { console.error('[SPC Adapters] next error:', e); } },
      sourceSelectId: 'question-select-notes',
      previousButtonId: 'back-btn-notes',
      nextButtonId: 'next-btn-notes'
    },
    legacyContainerSelector: '#mode-notes > .question-selector',
    controls: [
      { sourceId: 'notes-start-btn', slot: 'attempt', level: 'basic', order: 1, actionRole: 'primary', visibilityScopeId: 'notes-step-ready' },
      { sourceId: 'notes-skip-video-btn', slot: 'attempt', level: 'basic', order: 2, actionRole: 'secondary', visibilityScopeId: 'notes-step-video' },
      { sourceId: 'notes-submit-btn', slot: 'attempt', level: 'basic', order: 3, actionRole: 'primary', visibilityScopeId: 'notes-step-audio' },
      { sourceId: 'notes-retry-btn', slot: 'attempt', level: 'basic', order: 4, actionRole: 'retry', visibilityScopeId: 'notes-step-results' },
      { sourceId: 'recommended-btn-notes', slot: 'advanced-action', level: 'advanced', order: 1, actionRole: 'support' },
      { sourceId: 'difficulty-filter-container-notes', slot: 'advanced-setting', level: 'advanced', order: 1 },
      { sourceId: 'status-filter-container-notes', slot: 'advanced-setting', level: 'advanced', order: 2 }
    ],
    advancedSettings: [
      {
        key: 'difficulty',
        sourceId: 'difficulty-filter-container-notes',
        isActive: () => isFilterActive('difficulty-filter-label-notes', 'Recommended'),
        summaryLabel: 'Difficulty filter'
      },
      {
        key: 'status',
        sourceId: 'status-filter-container-notes',
        isActive: () => isFilterActive('status-filter-label-notes', 'Filter by Status'),
        summaryLabel: 'Status filter'
      }
    ]
  });

  // Wave 3B: Repeat Sentence (Speak). This mode remains implemented inline
  // in script.js; the adapter centralizes only the shared shell wiring.
  controller.register({
    modeId: 'speak',
    shell: 'v3',
    v3: {
      title: 'Repeat Sentence', skillLabel: 'Speaking', cardBodySelector: '#speak-practice-area',
      progressSteps: ['Listen', 'Record', 'Feedback'],
      getPhase: () => window.RepeatSentenceV3?.phase || 'loading',
      onMount: () => window.RepeatSentenceV3?.mount(),
      onUnmount: () => window.RepeatSentenceV3?.unmount(),
      onSync: () => window.RepeatSentenceV3?.sync(),
      statusText: { recording: 'Repeat the sentence.' },
      filters: [
        { label: 'Question order',
          get: () => document.getElementById('adaptive-speak')?.checked ? 'recommended' : 'manual',
          set: value => {
            // The recommendation jump is available in manual mode. Run its existing
            // handler before enabling adaptive selection, which disables that button.
            if (value === 'recommended') document.getElementById('recommended-btn-speak')?.click();
            document.getElementById(value === 'recommended' ? 'adaptive-speak' : 'manual-speak')?.click();
          },
          options: [{ value: 'recommended', label: 'Recommended' }, { value: 'manual', label: 'Manual' }] },
        { label: 'Status',
          get: () => {
            const options = [...document.querySelectorAll('#status-filter-menu-speak .filter-option')];
            const selected = options.filter(option => option.classList.contains('selected'));
            return selected.length === options.length ? 'all' : selected.length === 1 ? selected[0].dataset.value : null;
          },
          set: value => {
            document.querySelectorAll('#status-filter-menu-speak .filter-option').forEach(option => {
              if (option.classList.contains('selected') !== (value === 'all' || option.dataset.value === value)) option.click();
            });
          },
          options: [{ value: 'all', label: 'All' }, { value: 'not-started', label: 'Not started' },
            { value: 'in-progress', label: 'In progress' }, { value: 'completed', label: 'Completed' },
            { value: 'consolidated', label: 'Consolidated' }, { value: 'mastered', label: 'Mastered' }] },
        ...[
          { key: 'length', label: 'Length', options: [{ value: 'all', label: 'All lengths' },
            ...['4-7', '8-9', '10-11', '12-13'].map(value => ({ value, label: `${value} words` }))] },
          { key: 'difficulty', label: 'Difficulty', options: [{ value: 'all', label: 'Recommended' },
            { value: '1', label: 'Level 1 (Easy)' }, { value: '2', label: 'Level 2 (Medium)' }, { value: '3', label: 'Level 3 (Hard)' }] }
        ].map(({ key, label, options }) => ({ label, options,
          get: () => document.querySelector(`#${key}-filter-menu-speak .filter-option.selected`)?.dataset.value || 'all',
          set: value => {
            // Hidden legacy containers indicate a progression lock, even though
            // the v3 shell exposes the group. Keep that lock in force.
            if (value !== 'all' && document.getElementById(`${key}-filter-container-speak`)?.style.display === 'none') {
              window.shopModule?.showAlertModal?.('This feature is locked. Keep practicing to unlock it.', true);
              return;
            }
            document.querySelector(`#${key}-filter-menu-speak .filter-option[data-value="${value}"]`)?.click();
          }
        }))
      ],
      moreItems: [{ label: 'Reset progress', description: 'Start this question set again',
        onSelect: () => document.getElementById('reset-progress-speak-btn')?.click() }],
      dock: {
        helpers: [{ id: 'speak-pte-replay', label: 'Replay', phases: ['prep', 'complete'],
          count: () => window.RepeatSentenceV3?.replaysLeft(), onClick: () => window.RepeatSentenceV3?.replay() }],
        actions: [
          { sourceId: 'shadow-mode-btn', label: 'Shadow · 5c', phases: ['prep'], variant: 'helper' },
          { sourceId: 'record-btn', label: 'Start recording', phases: ['prep'], variant: 'primary' },
          { sourceId: 'speak-pte-cancel', label: 'Cancel', phases: ['recording'], variant: 'ghost' },
          { sourceId: 'speak-pte-stop', label: 'Finish recording', phases: ['recording'], variant: 'stop' },
          { sourceId: 'retry-btn-speak', label: 'Record again', phases: ['complete', 'feedback'], variant: 'ghost' },
          { sourceId: 'speak-pte-play', label: 'Play', phases: ['complete'], variant: 'secondary' },
          { sourceId: 'check-btn-speak', label: 'Get feedback', phases: ['complete'], variant: 'primary' }
        ]
      },
      next: {
        onConfirmFromRecording: () => window.RepeatSentenceV3?.stop(),
        goNext: () => window.RepeatSentenceV3?.next()
      },
      attempts: {
        practiceMode: 'speak', modeLabel: 'Repeat Sentence',
        getPromptId: () => document.getElementById('current-question-id-speak')?.textContent,
        formatScores: attempt => {
          const score = attempt.resultSnapshot?.score ?? attempt.score;
          const maxScore = attempt.resultSnapshot?.maxScore;
          return Number.isFinite(score) ? [`Points ${score}${Number.isFinite(maxScore) ? `/${maxScore}` : ''}`] : [];
        }
      }
    },
    enabledScopes: ['pte', 'english'],
    panelId: 'mode-speak',
    steps: ['Listen', 'Record', 'Results'],
    getStepIndex: () => {
      if (isShown('retry-btn-speak')) return 2;
      if (isShown('check-btn-speak')) return 1;
      const recordBtn = document.getElementById('record-btn');
      if (recordBtn && recordBtn.textContent.trim() === 'Stop Recording') return 1;
      return 0;
    },
    layout: {
      mediaHost: (state) => panelHost(state, '.speak-audio'),
      attemptHost: (state) => panelHost(state, '#speak-action-host'),
      progressHost
    },
    picker: {
      sourceSelectId: 'question-select-speak',
      previousButtonId: 'back-btn-speak',
      nextButtonId: 'next-btn-speak'
    },
    // Play and the replay counter now live inside the shared .practice-audio-player
    // box in the panel body, so neither is hoisted into the toolbar.
    controls: [
      { sourceId: 'record-btn', slot: 'attempt', level: 'basic', order: 1, actionRole: 'record' },
      { sourceId: 'check-btn-speak', slot: 'attempt', level: 'basic', order: 2, actionRole: 'primary' },
      { sourceId: 'retry-btn-speak', slot: 'attempt', level: 'basic', order: 3, actionRole: 'retry' },
      { sourceId: 'shadow-mode-btn', slot: 'advanced-action', level: 'advanced', order: 2, actionRole: 'support' },
      { sourceId: 'recommended-btn-speak', slot: 'advanced-action', level: 'advanced', order: 1, actionRole: 'support' },
      { sourceId: 'progress-bar-speak', slot: 'advanced-setting', level: 'advanced', order: 1 },
      { sourceId: 'status-filter-container-speak', slot: 'advanced-setting', level: 'advanced', order: 2 },
      { sourceId: 'length-filter-container-speak', slot: 'advanced-setting', level: 'advanced', order: 3 },
      { sourceId: 'difficulty-filter-container-speak', slot: 'advanced-setting', level: 'advanced', order: 4 }
    ],
    legacyContainerSelector: '#mode-speak > .unified-controls',
    inPlaceControls: [],
    advancedSettings: [
      {
        key: 'adaptive-mode',
        isActive: () => document.getElementById('manual-speak')?.checked === true,
        summaryLabel: 'Manual selection'
      },
      {
        key: 'status',
        sourceId: 'status-filter-container-speak',
        isActive: () => isFilterActive('status-filter-label-speak', 'Filter by Status'),
        summaryLabel: 'Status filter'
      },
      {
        key: 'length',
        sourceId: 'length-filter-container-speak',
        isActive: () => isFilterActive('length-filter-label-speak', 'Filter by Length'),
        summaryLabel: 'Length filter'
      },
      {
        key: 'difficulty',
        sourceId: 'difficulty-filter-container-speak',
        isActive: () => isFilterActive('difficulty-filter-label-speak', 'Recommended'),
        summaryLabel: 'Difficulty filter'
      }
    ]
  });

  // Wave 3C: Write From Dictation (Type). Mirrors the Speak adapter pattern —
  // basic view shows only the question picker and core action buttons, while
  // advanced view reveals progress, adaptive toggle, and filter dropdowns.
  controller.register({
    modeId: 'type',
    enabledScopes: ['pte', 'english'],
    panelId: 'mode-type',
    steps: ['Listen', 'Answer', 'Results'],
    getStepIndex: () => {
      if (isShown('retry-btn')) return 2;
      if (isShown('check-btn')) return 1;
      return 0;
    },
    layout: {
      mediaHost: (state) => panelHost(state, '.wfd-audio'),
      attemptHost: (state) => panelHost(state, '#type-action-host'),
      progressHost
    },
    picker: {
      sourceSelectId: 'question-select-type',
      previousButtonId: 'back-btn-type',
      nextButtonId: 'next-btn-type'
    },
    controls: [
      { sourceId: 'play-btn', slot: 'media', level: 'basic', order: 1 },
      { sourceId: 'check-btn', slot: 'attempt', level: 'basic', order: 1 },
      { sourceId: 'retry-btn', slot: 'attempt', level: 'basic', order: 2 },
      { sourceId: 'recommended-btn-type', slot: 'advanced-action', level: 'advanced', order: 1 },
      { sourceId: 'progress-bar-type', slot: 'advanced-setting', level: 'advanced', order: 1 },
      { sourceId: 'status-filter-container-type', slot: 'advanced-setting', level: 'advanced', order: 2 },
      { sourceId: 'length-filter-container-type', slot: 'advanced-setting', level: 'advanced', order: 3 },
      { sourceId: 'difficulty-filter-container-type', slot: 'advanced-setting', level: 'advanced', order: 4 }
    ],
    inPlaceControls: [],
    advancedSettings: [
      {
        key: 'adaptive-mode',
        isActive: () => document.getElementById('manual-type')?.checked === true,
        summaryLabel: 'Manual selection'
      },
      {
        key: 'status',
        sourceId: 'status-filter-container-type',
        isActive: () => isFilterActive('status-filter-label-type', 'Filter by Status'),
        summaryLabel: 'Status filter'
      },
      {
        key: 'length',
        sourceId: 'length-filter-container-type',
        isActive: () => isFilterActive('length-filter-label-type', 'Filter by Length'),
        summaryLabel: 'Length filter'
      },
      {
        key: 'difficulty',
        sourceId: 'difficulty-filter-container-type',
        isActive: () => isFilterActive('difficulty-filter-label-type', 'Recommended'),
        summaryLabel: 'Difficulty filter'
      }
    ]
  });

  // Wave 4A: Read Aloud picker/settings shell. Recording assessment and
  // results remain owned by read-aloud-mode.js; the shared controller only
  // adopts the stable navigation and in-place guide controls.
  // Practice target, audio player, and history are now in the Settings sheet.
  controller.register({
    modeId: 'read-aloud',
    shell: 'v3',
    v3: {
      title: 'Read Aloud', cardBodySelector: '#mode-read-aloud .ra-workbench',
      progressSteps: ['Prepare', 'Record', 'Feedback'],
      getPhase: () => window.ReadAloudMode?.getPtePhase?.() || 'loading',
      onMount: () => window.ReadAloudMode?.mountPteShell?.(),
      onSync: () => window.ReadAloudMode?.syncPteShell?.(),
      onUnmount: () => window.ReadAloudMode?.unmountPteShell?.(),
      filters: [
        { label: 'Sample audio', get: () => window.ReadAloudMode?.sampleAudioFilter, set: value => window.ReadAloudMode?.setSampleAudioFilter(value),
          options: [{ value: 'all', label: 'All' }, { value: 'available', label: 'Available' }, { value: 'unavailable', label: 'No audio' }] },
        { label: 'Prompt feature', get: () => window.ReadAloudMode?.promptFeatureFilter, set: value => window.ReadAloudMode?.setPromptFeatureFilter(value),
          options: [{ value: 'all', label: 'All prompts' }, { value: 'any_connected', label: 'Any connected speech' }, { value: 'linking', label: 'Linking' }, { value: 'reduced_words', label: 'Reduced words' }, { value: 'sound_changes', label: 'Sound changes' }] },
        { label: 'Difficulty', get: () => window.ReadAloudMode?.difficultyFilter, set: value => window.ReadAloudMode?.setDifficultyFilter(value),
          options: [{ value: 'all', label: 'Recommended' }, { value: '1', label: 'Level 1 (Easy)' }, { value: '2', label: 'Level 2 (Medium)' }, { value: '3', label: 'Level 3 (Hard)' }] },
        { label: 'Order', get: () => window.ReadAloudMode?.promptOrderMode, set: value => window.ReadAloudMode?.setPromptOrderMode(value),
          options: [{ value: 'random', label: 'Random' }, { value: 'sequential', label: 'In order' }] }
      ],
      dock: {
        helpers: [{ id: 'ra-pte-coach-btn', label: 'Coach', phases: ['prep', 'complete', 'feedback'],
          count: () => {
            const mode = window.ReadAloudMode;
            if (!mode) return 0;
            if (typeof mode.getPtePhase === 'function' && mode.getPtePhase() === 'feedback') {
              return mode.lastAssessmentPayload?.connectedSpeech?.events?.length ?? 0;
            }
            return mode.currentGuideExplanationItems?.length ?? 0;
          },
          pressed: () => !!window.ReadAloudMode?.pteCoachOpen,
          onClick: () => window.ReadAloudMode?.setCoachOpen(!window.ReadAloudMode.pteCoachOpen) }],
        actions: [
          { sourceId: 'ra-record-btn', label: 'Start recording', variant: 'primary', phases: ['prep'] },
          { sourceId: 'ra-pte-cancel-btn', label: 'Cancel', variant: 'ghost', phases: ['recording'] },
          { sourceId: 'ra-stop-btn', label: 'Finish recording', variant: 'stop', phases: ['recording'] },
          { sourceId: 'ra-retry-btn', label: 'Record again', variant: 'ghost', phases: ['complete', 'feedback'] },
          { sourceId: 'ra-play-recording-btn', label: 'Play', phases: ['complete'] },
          { sourceId: 'ra-check-btn', label: 'Get feedback', variant: 'primary', phases: ['complete'] }
        ]
      },
      next: {
        onConfirmFromRecording: () => window.ReadAloudMode.finishPteRecordingForNext(),
        goNext: () => window.ReadAloudMode.advancePtePrompt()
      },
      attempts: {
        practiceMode: 'read-aloud', modeLabel: 'Read Aloud', getPromptId: () => window.ReadAloudMode?.currentQuestionId,
        formatScores: attempt => {
          const score = attempt.resultSnapshot;
          return [['Overall', 'pronScore'], ['Accuracy', 'accuracyScore'], ['Fluency', 'fluencyScore']]
            .filter(([, key]) => Number.isFinite(score?.[key])).map(([label, key]) => `${label} ${score[key]}%`);
        }
      }
    },
    enabledScopes: ['pte', 'english'],
    panelId: 'mode-read-aloud',
    // There is no separate Read phase: startPrepTimer() fires as soon as a prompt
    // loads, and reading silently *is* the prep activity.
    steps: ['Prep', 'Record', 'Results'],
    stepsHost: (state) =>
      window.ReadAloudWorkspaceConfig?.enabled
        ? document.getElementById('ra-workspace-steps-host')
        : null,
    getStepIndex: () => {
      const modeState = window.ReadAloudMode?.state;
      if (window.ReadAloudWorkspaceConfig?.enabled) {
        if (modeState === 'RESULTS' || modeState === 'RECORDED') return 2;
        if (modeState === 'REQUESTING_MIC' || modeState === 'RECORDING' || modeState === 'STOPPING_RECORDING') return 1;
        return 0;
      }
      switch (modeState) {
        case 'RESULTS': return 2;
        case 'REQUESTING_MIC':
        case 'RECORDING':
        case 'STOPPING_RECORDING':
        case 'RECORDED': return 1;
        default: return 0;
      }
    },
    layout: {
      mediaHost: (state) => panelHost(state, '#ra-action-host'),
      attemptHost: (state) => panelHost(state, '#ra-action-host'),
      progressHost
    },
    picker: {
      sourceSelectId: 'ra-question-select',
      orderModes: {
        get: () => window.ReadAloudMode?.promptOrderMode || 'random',
        set: (mode) => { try { window.ReadAloudMode?.setPromptOrderMode?.(mode); } catch (e) { console.error('[SPC Adapters] order mode error:', e); } }
      },
      previous: () => { try { window.ReadAloudMode?.loadPreviousPrompt?.(); } catch (e) { console.error('[SPC Adapters] previous error:', e); } },
      next: () => { try { window.ReadAloudMode?.loadNextPrompt?.(); } catch (e) { console.error('[SPC Adapters] next error:', e); } }
    },
    controls: [
      // Keep Read Aloud's state-machine-owned controls intact while adopting
      // their existing DOM nodes into the shared action row.
      { sourceId: 'ra-prep-timer-box', slot: 'media', level: 'basic', order: 1 },
      { sourceId: 'ra-record-timer-box', slot: 'media', level: 'basic', order: 2 },
      { sourceId: 'ra-record-btn', slot: 'attempt', level: 'basic', order: 1, actionRole: 'record' },
      { sourceId: 'ra-stop-btn', slot: 'attempt', level: 'basic', order: 2, actionRole: 'stop' },
      { sourceId: 'ra-play-recording-btn', slot: 'attempt', level: 'basic', order: 3, actionRole: 'play' },
      { sourceId: 'ra-check-btn', slot: 'attempt', level: 'basic', order: 4, actionRole: 'primary' },
      { sourceId: 'ra-retry-btn', slot: 'attempt', level: 'basic', order: 5, actionRole: 'retry' }
    ],
    inPlaceControls: [
      { sourceId: 'ra-prompt-guides-group', level: 'advanced' }
    ],
    advancedSettings: [
      {
        key: 'sample-audio',
        isActive: () => document.getElementById('ra-filter-all')?.classList.contains('active') === false,
        summaryLabel: 'Sample audio filter'
      },
      {
        key: 'prompt-feature',
        isActive: () => document.getElementById('ra-filter-feature-all')?.classList.contains('active') === false,
        summaryLabel: 'Prompt feature filter'
      },
      {
        key: 'voice',
        isActive: () => !!window.ReadAloudMode && (!!window.ReadAloudMode.selectedGender || !!window.ReadAloudMode.selectedVoiceId),
        summaryLabel: 'Voice'
      },
      {
        key: 'speed',
        isActive: () => !!window.ReadAloudMode && window.ReadAloudMode.selectedSpeed !== '100',
        summaryLabel: 'Playback speed'
      }
    ]
  });

})();
