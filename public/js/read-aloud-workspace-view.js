/*
 * Read Aloud Workspace V2 View Controller
 * Destination: public/js/read-aloud-workspace-view.js
 * Browser: window.ReadAloudWorkspaceView
 *
 * Owns DOM mounting, stage-aware rendering, button visibility/emphasis,
 * and focus management for the V2 Read Aloud practice workspace.
 * Never creates MediaRecorder, modifies audio streams, or alters timers.
 */
(function expose(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ReadAloudWorkspaceView = api;
  if (typeof globalThis !== 'undefined') globalThis.ReadAloudWorkspaceView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createView() {
  'use strict';

  const ACTION_IDS = [
    'ra-record-btn',
    'ra-stop-btn',
    'ra-check-btn',
    'ra-retry-btn'
  ];

  const STAGE_INSTRUCTIONS = {
    'loading': 'Loading question…',
    'load-error': 'Question could not be loaded.',
    'unsupported': 'Recording is not supported in this browser.',
    'prepare': 'Read silently and plan your phrasing. Recording starts when preparation ends.',
    'requesting-mic': 'Allow microphone access in your browser. Recording has not started.',
    'recording': 'Read the passage aloud into your microphone.',
    'finishing': 'Finishing your recording…',
    'recording-ready': 'Your recording is ready. Listen back or get feedback.',
    'analyzing': 'Analyzing your pronunciation and fluency…',
    'feedback': 'Feedback is ready. Review your results and choose what to practice next.',
    'assessment-error': 'Analysis was interrupted. You can retry analysis with your retained recording.',
    'capture-error': 'Recording capture error. Please record again.',
    'result-unavailable': 'Assessment results unavailable.',
    'unavailable': 'This question is not ready for an attempt.'
  };

  class ReadAloudWorkspaceView {
    constructor(modeInstance) {
      this.mode = modeInstance;
      this.active = false;
      this.panel = null;
      this.headingEl = null;
      this.stepsHostEl = null;
      this.instructionEl = null;
      this.coachHostEl = null;
      this.tipsExpanded = false;
    }

    mount() {
      this.panel = document.getElementById('mode-read-aloud');
      if (!this.panel) return;

      this.panel.dataset.raWorkspace = 'v2';
      this.ensureLayoutHosts();
      this.active = true;
    }

    isV3Active() {
      const panel = this.panel || (typeof document !== 'undefined' && document.getElementById('mode-read-aloud'));
      if (panel) {
        if (panel.classList.contains('ra-pte-v3')) return true;
        if (this.mode && this.mode.pteView) return true;
        if (this.mode && this.mode.pteView === null) {
          return false;
        }
      }
      if (typeof this.mode?.isPteShellEnabled === 'function') {
        return Boolean(this.mode.isPteShellEnabled());
      }
      const scope = typeof window !== 'undefined' && window.PracticeScopeManager?.getScope
        ? window.PracticeScopeManager.getScope()
        : 'pte';
      return Boolean(typeof window !== 'undefined' && window.PteShellConfig?.isModeEnabled?.('read-aloud', scope));
    }

    ensureLayoutHosts() {
      const workbench = this.panel.querySelector('.ra-workbench');
      if (!workbench) return;
      const isV3 = this.isV3Active();

      // 1. Heading Host — do not create or show when v3 is active
      let heading = document.getElementById('ra-workspace-heading');
      if (isV3) {
        if (heading) {
          heading.style.display = 'none';
        }
        this.headingEl = null;
      } else {
        if (!heading) {
          heading = document.createElement('div');
          heading.id = 'ra-workspace-heading';
          heading.className = 'ra-workspace-header';
          heading.innerHTML = `
            <div class="ra-workspace-title-group">
              <span class="ra-workspace-qid" id="ra-workspace-qid-display">Question</span>
              <span class="ra-workspace-mode-label">Read Aloud</span>
            </div>
            <div class="ra-workspace-order-summary" id="ra-workspace-order-summary"></div>
          `;
          workbench.insertBefore(heading, workbench.firstChild);
        } else {
          heading.style.display = '';
        }
        this.headingEl = heading;
      }

      // 2. Steps Host — do not create or show when v3 is active
      let stepsHost = document.getElementById('ra-workspace-steps-host');
      if (isV3) {
        if (stepsHost) {
          stepsHost.style.display = 'none';
        }
        this.stepsHostEl = null;
      } else {
        if (!stepsHost) {
          stepsHost = document.createElement('div');
          stepsHost.id = 'ra-workspace-steps-host';
          if (heading && heading.parentNode) {
            heading.after(stepsHost);
          } else {
            workbench.prepend(stepsHost);
          }
        } else {
          stepsHost.style.display = '';
        }
        this.stepsHostEl = stepsHost;
      }

      // 3. Stage Instruction — keep in DOM but visually hidden (.pte-sr-only) under v3
      let instruction = document.getElementById('ra-workspace-instruction');
      if (!instruction) {
        instruction = document.createElement('div');
        instruction.id = 'ra-workspace-instruction';
        instruction.setAttribute('aria-live', 'polite');
        if (stepsHost && stepsHost.parentNode) {
          stepsHost.after(instruction);
        } else if (heading && heading.parentNode) {
          heading.after(instruction);
        } else {
          workbench.prepend(instruction);
        }
      }
      if (isV3) {
        instruction.classList.add('pte-sr-only');
        instruction.style.removeProperty('display');
      } else {
        instruction.classList.remove('pte-sr-only');
      }
      this.instructionEl = instruction;

      // 4. Coach Host (Speaking Tips) — do not create or show when v3 is active
      let coachHost = document.getElementById('ra-workspace-coach-host');
      if (isV3) {
        if (coachHost) {
          coachHost.style.display = 'none';
        }
        this.coachHostEl = null;
      } else {
        if (!coachHost) {
          coachHost = document.createElement('div');
          coachHost.id = 'ra-workspace-coach-host';
          coachHost.className = 'ra-tips-container';
          coachHost.innerHTML = `
            <div class="ra-tips-header">
              <span class="ra-tips-title">
                <span>💡 Speaking tips</span>
                <span class="ra-tips-count-badge" id="ra-workspace-tips-count">0</span>
              </span>
              <div class="ra-tips-actions">
                <button type="button" class="ra-tips-btn" id="ra-workspace-toggle-all-tips">View all tips</button>
              </div>
            </div>
            <div class="ra-tips-preview-content" id="ra-workspace-tips-preview">
              <span id="ra-workspace-tip-text">Read smoothly through the passage.</span>
            </div>
          `;
          const stage = this.panel.querySelector('.ra-stage');
          if (stage) {
            stage.appendChild(coachHost);
          }
        } else {
          coachHost.style.display = '';
        }
        this.coachHostEl = coachHost;

        // Bind toggle all tips (legacy mode only)
        const toggleAllTipsBtn = document.getElementById('ra-workspace-toggle-all-tips');
        if (toggleAllTipsBtn && !toggleAllTipsBtn.dataset.bound) {
          toggleAllTipsBtn.dataset.bound = 'true';
          toggleAllTipsBtn.addEventListener('click', () => {
            this.tipsExpanded = !this.tipsExpanded;
            toggleAllTipsBtn.textContent = this.tipsExpanded ? 'Hide tips' : 'View all tips';
            const coachBox = document.getElementById('ra-connected-speech-box');
            if (coachBox) {
              coachBox.style.display = this.tipsExpanded ? 'block' : 'none';
            }
          });
        }
      }

      // #ra-status-message → visually hidden too under v3
      const statusMessage = document.getElementById('ra-status-message');
      if (statusMessage) {
        if (isV3) {
          statusMessage.classList.add('pte-sr-only');
        } else {
          statusMessage.classList.remove('pte-sr-only');
        }
      }
    }

    render(model, snapshot) {
      if (!this.active) this.mount();
      this.ensureLayoutHosts();

      // 1. Update Question ID and Order Summary in Header
      const qidEl = document.getElementById('ra-workspace-qid-display');
      if (qidEl && this.mode?.currentQuestionId) {
        qidEl.textContent = `Question ${this.mode.currentQuestionId}`;
      } else if (qidEl && this.mode?.currentPromptRow?.id) {
        qidEl.textContent = `Question ${this.mode.currentPromptRow.id}`;
      }
      const orderSummaryEl = document.getElementById('ra-workspace-order-summary');
      if (orderSummaryEl && this.mode) {
        const orderMode = this.mode.promptOrderMode === 'sequential' ? 'Sequential' : 'Random';
        const total = this.mode.database?.length || 0;
        orderSummaryEl.textContent = total ? `${orderMode} • ${total} questions` : orderMode;
      }

      // 2. Update Stage Instruction
      if (this.instructionEl) {
        const customNotice = model.notice;
        const defaultInstruction = STAGE_INSTRUCTIONS[model.phase] || '';
        this.instructionEl.textContent = customNotice || defaultInstruction;
      }

      // 3. Render Action Nodes
      this.renderActionButtons(model);

      // 4. Update Timer Visual State
      this.renderTimers(model);

      // 5. Update Speaking Tips Summary
      this.renderSpeakingTipsSummary();
    }

    renderActionButtons(model) {
      const shown = new Map();

      if (model.primary) {
        shown.set(model.primary.id, {
          ...model.primary,
          emphasis: 'primary'
        });
      }

      if (model.secondary) {
        shown.set(model.secondary.id, {
          ...model.secondary,
          emphasis: 'secondary'
        });
      }

      for (const id of ACTION_IDS) {
        const button = document.getElementById(id);
        if (!button) continue;
        if (this.isV3Active() && button.hasAttribute('data-pte-phases')) continue;

        const action = shown.get(id);

        button.style.removeProperty('display');
        button.hidden = !action;
        button.disabled = !action || action.disabled;

        if (action) {
          if (button.textContent !== action.label) {
            button.textContent = action.label;
          }
          button.dataset.raEmphasis = action.emphasis;
        } else {
          delete button.dataset.raEmphasis;
        }
      }
    }

    renderTimers(model) {
      const prepBox = document.getElementById('ra-prep-timer-box');
      const recordBox = document.getElementById('ra-record-timer-box');

      if (prepBox) {
        const isPrepActive = model.timer === 'prep';
        prepBox.dataset.timerState = isPrepActive ? 'active' : 'idle';
        prepBox.style.opacity = isPrepActive ? '1' : '0.5';
      }

      if (recordBox) {
        const isRecordActive = model.timer === 'record';
        recordBox.dataset.timerState = isRecordActive ? 'active' : 'idle';
        recordBox.style.opacity = isRecordActive ? '1' : '0.5';
      }
    }

    renderSpeakingTipsSummary() {
      const countBadge = document.getElementById('ra-workspace-tips-count');
      const previewText = document.getElementById('ra-workspace-tip-text');
      const items = Array.isArray(this.mode?.currentGuideExplanationItems)
        ? this.mode.currentGuideExplanationItems
        : [];

      if (countBadge) {
        countBadge.textContent = String(items.length);
      }

      if (previewText) {
        if (items.length > 0) {
          const selectedId = this.mode?.selectedGuideItemId;
          const activeItem = items.find(i => i.id === selectedId) || items[0];
          const wordOrTarget = activeItem.label || activeItem.word || activeItem.target || activeItem.title || '';
          const tipMsg = activeItem.simpleExplanation || activeItem.explanation || activeItem.tip || activeItem.message || '';
          previewText.textContent = wordOrTarget && tipMsg ? `"${wordOrTarget}" — ${tipMsg}` : (tipMsg || wordOrTarget || 'Focus on smooth phrasing and natural linking.');
        } else {
          previewText.textContent = 'Read smoothly through the passage with natural phrasing.';
        }
      }

      // Wire up Coach button count in v3 dock
      const coachBtn = document.getElementById('ra-pte-coach-btn');
      if (coachBtn) {
        const count = typeof this.mode?.getPtePhase === 'function' && this.mode.getPtePhase() === 'feedback'
          ? (this.mode?.lastAssessmentPayload?.connectedSpeech?.events?.length ?? 0)
          : items.length;
        coachBtn.textContent = `Coach · ${count}`;
        if (typeof this.mode?.pteCoachOpen === 'boolean') {
          coachBtn.setAttribute('aria-pressed', String(this.mode.pteCoachOpen));
        }
      }
    }

    unmount() {
      if (this.panel) {
        delete this.panel.dataset.raWorkspace;
      }
      const removeHost = (el, id) => {
        const node = el || document.getElementById(id);
        if (node?.parentNode) {
          node.parentNode.removeChild(node);
        }
      };
      removeHost(this.headingEl, 'ra-workspace-heading');
      this.headingEl = null;
      removeHost(this.stepsHostEl, 'ra-workspace-steps-host');
      this.stepsHostEl = null;
      removeHost(this.instructionEl, 'ra-workspace-instruction');
      this.instructionEl = null;
      removeHost(this.coachHostEl, 'ra-workspace-coach-host');
      this.coachHostEl = null;

      for (const id of ACTION_IDS) {
        const button = document.getElementById(id);
        if (button) {
          button.hidden = false;
          delete button.dataset.raEmphasis;
        }
      }

      const prepBox = document.getElementById('ra-prep-timer-box');
      if (prepBox) {
        delete prepBox.dataset.timerState;
        prepBox.style.removeProperty('opacity');
      }
      const recordBox = document.getElementById('ra-record-timer-box');
      if (recordBox) {
        delete recordBox.dataset.timerState;
        recordBox.style.removeProperty('opacity');
      }

      const coachBox = document.getElementById('ra-connected-speech-box');
      if (coachBox && this.tipsExpanded) {
        coachBox.style.display = 'none';
      }
      this.tipsExpanded = false;
      this.active = false;
    }
  }

  return Object.freeze({
    createView: (modeInstance) => new ReadAloudWorkspaceView(modeInstance)
  });
});
