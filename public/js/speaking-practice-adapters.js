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

  // Wave 1: Answer Short Question. The native select remains the state source;
  // the controller only adopts the existing lifecycle controls.
  controller.register({
    modeId: 'asq',
    enabledScopes: ['pte'],
    panelId: 'mode-asq',
    picker: {
      sourceSelectId: 'asq-question-select'
    },
    controls: [
      { sourceId: 'asq-play-prompt-btn', slot: 'media', level: 'basic', order: 1 },
      { sourceId: 'asq-record-btn', slot: 'attempt', level: 'basic', order: 1 },
      { sourceId: 'asq-stop-btn', slot: 'attempt', level: 'basic', order: 2 },
      { sourceId: 'asq-redo-btn', slot: 'attempt', level: 'basic', order: 3 }
    ]
  });

  // Wave 1: Respond to a Situation. RTS exposes a small picker bridge while
  // retaining its mode-owned step flow, timers, scoring, and result controls.
  controller.register({
    modeId: 'rts',
    enabledScopes: ['pte'],
    panelId: 'mode-rts',
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
      { sourceId: 'play-rts-btn', slot: 'media', level: 'basic', order: 1 },
      { sourceId: 'rts-stop-btn', slot: 'attempt', level: 'basic', order: 1 },
      { sourceId: 'rts-retry-btn', slot: 'attempt', level: 'basic', order: 2 },
      { sourceId: 'rts-ai-score-btn', slot: 'attempt', level: 'basic', order: 3 },
      { sourceId: 'rts-next-question-btn', slot: 'attempt', level: 'basic', order: 4 }
    ]
  });

  // Wave 2: Describe Image. Filters and recommendations live in Advanced;
  // step/result actions remain lifecycle controls in the shared shell.
  controller.register({
    modeId: 'describe-image',
    enabledScopes: ['pte'],
    panelId: 'mode-describe-image',
    picker: {
      sourceSelectId: 'question-select-di',
      previousButtonId: 'back-btn-di',
      nextButtonId: 'next-btn-di'
    },
    controls: [
      { sourceId: 'play-di-btn', slot: 'media', level: 'basic', order: 1 },
      { sourceId: 'di-stop-btn', slot: 'attempt', level: 'basic', order: 1, visibilityScopeId: 'di-step-record' },
      { sourceId: 'di-retry-btn', slot: 'attempt', level: 'basic', order: 2, visibilityScopeId: 'di-step-review' },
      { sourceId: 'di-submit-btn', slot: 'attempt', level: 'basic', order: 3, visibilityScopeId: 'di-step-review' },
      { sourceId: 'di-results-retry-btn', slot: 'attempt', level: 'basic', order: 4, visibilityScopeId: 'di-step-results' },
      { sourceId: 'di-next-question-btn', slot: 'attempt', level: 'basic', order: 5, visibilityScopeId: 'di-step-results' },
      { sourceId: 'di-ai-btn', slot: 'advanced-action', level: 'advanced', order: 1, visibilityScopeId: 'di-step-results' },
      { sourceId: 'recommended-btn-di', slot: 'advanced-action', level: 'advanced', order: 2 },
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
    enabledScopes: ['pte'],
    panelId: 'mode-notes',
    picker: {
      sourceSelectId: 'question-select-notes',
      previousButtonId: 'back-btn-notes',
      nextButtonId: 'next-btn-notes'
    },
    controls: [
      { sourceId: 'play-notes-btn', slot: 'media', level: 'basic', order: 1 },
      { sourceId: 'notes-submit-btn', slot: 'attempt', level: 'basic', order: 1, visibilityScopeId: 'notes-step-audio' },
      { sourceId: 'notes-retry-btn', slot: 'attempt', level: 'basic', order: 2, visibilityScopeId: 'notes-step-results' },
      { sourceId: 'recommended-btn-notes', slot: 'advanced-action', level: 'advanced', order: 1 },
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

  // Wave 3A: Summarize Group Discussion. The multi-step practice flow stays
  // mode-owned; the shared shell adopts the question picker and lifecycle
  // controls that are safe to surface across its recording/results steps.
  controller.register({
    modeId: 'sgd',
    enabledScopes: ['pte'],
    panelId: 'mode-sgd',
    picker: {
      sourceSelectId: 'question-select-sgd',
      previousButtonId: 'back-btn-sgd',
      nextButtonId: 'next-btn-sgd'
    },
    controls: [
      { sourceId: 'play-sgd-btn', slot: 'media', level: 'basic', order: 1 },
      { sourceId: 'sgd-record-btn', slot: 'attempt', level: 'basic', order: 1, visibilityScopeId: 'sgd-step-record' },
      { sourceId: 'sgd-stop-btn', slot: 'attempt', level: 'basic', order: 2, visibilityScopeId: 'sgd-step-record' },
      { sourceId: 'sgd-submit-btn', slot: 'attempt', level: 'basic', order: 3, visibilityScopeId: 'sgd-step-record' },
      { sourceId: 'sgd-retry-btn', slot: 'attempt', level: 'basic', order: 4, visibilityScopeId: 'sgd-step-results' },
      { sourceId: 'recommended-btn-sgd', slot: 'advanced-action', level: 'advanced', order: 1 }
    ]
  });

  // Wave 3B: Repeat Sentence (Speak). This mode remains implemented inline
  // in script.js; the adapter centralizes only the shared shell wiring.
  controller.register({
    modeId: 'speak',
    enabledScopes: ['pte', 'english'],
    panelId: 'mode-speak',
    picker: {
      sourceSelectId: 'question-select-speak',
      previousButtonId: 'back-btn-speak',
      nextButtonId: 'next-btn-speak'
    },
    controls: [
      { sourceId: 'play-btn-speak', slot: 'media', level: 'basic', order: 1 },
      { sourceId: 'record-btn', slot: 'attempt', level: 'basic', order: 1 },
      { sourceId: 'check-btn-speak', slot: 'attempt', level: 'basic', order: 2 },
      { sourceId: 'retry-btn-speak', slot: 'attempt', level: 'basic', order: 3 },
      { sourceId: 'recommended-btn-speak', slot: 'advanced-action', level: 'advanced', order: 1 },
      { sourceId: 'progress-bar-speak', slot: 'advanced-setting', level: 'advanced', order: 1 },
      { sourceId: 'status-filter-container-speak', slot: 'advanced-setting', level: 'advanced', order: 2 },
      { sourceId: 'length-filter-container-speak', slot: 'advanced-setting', level: 'advanced', order: 3 },
      { sourceId: 'difficulty-filter-container-speak', slot: 'advanced-setting', level: 'advanced', order: 4 }
    ],
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
    enabledScopes: ['pte', 'english'],
    panelId: 'mode-read-aloud',
    picker: {
      sourceSelectId: 'ra-question-select',
      previous: () => { try { window.ReadAloudMode?.loadPreviousPrompt?.(); } catch (e) { console.error('[SPC Adapters] previous error:', e); } },
      next: () => { try { window.ReadAloudMode?.loadNextPrompt?.(); } catch (e) { console.error('[SPC Adapters] next error:', e); } }
    },
    controls: [
      // All advanced controls now live in the Settings sheet (side panel).
      // No SPC slot adoption needed.
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
