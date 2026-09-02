(() => {
  const log = Logger.create('App');

  window.showCustomConfirm = function(title, message, isDestructive = false) {
    return new Promise((resolve) => {
      const modalId = 'custom-confirm-modal';
      let confirmModal = document.getElementById(modalId);
      if (confirmModal) confirmModal.remove();

      confirmModal = document.createElement('div');
      confirmModal.id = modalId;
      confirmModal.className = 'shop-modal active';
      confirmModal.style.zIndex = '30000';

      confirmModal.innerHTML = `
        <div class="shop-modal-content" style="max-width: 420px; text-align: center; padding: 32px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.4); background: rgba(255,255,255,0.98); box-shadow: 0 20px 40px rgba(0,0,0,0.15);">
          <div style="font-size: 2.5rem; margin-bottom: 16px;">⚠️</div>
          <h3 style="margin-top: 0; color: #0f172a; font-family: 'Outfit', sans-serif; font-size: 1.4rem; font-weight: 600; margin-bottom: 12px;">${title}</h3>
          <p style="color: #475569; font-family: 'Outfit', sans-serif; font-size: 0.95rem; margin-bottom: 24px; line-height: 1.5; padding: 0 10px;">${message}</p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="${modalId}-cancel" style="flex: 1; padding: 12px 20px; border: 1px solid #cbd5e1; background: #ffffff; color: #475569; border-radius: 10px; cursor: pointer; font-family: 'Outfit', sans-serif; font-weight: 500; font-size: 0.95rem; transition: background 0.2s;">Cancel</button>
            <button id="${modalId}-confirm" style="flex: 1; padding: 12px 20px; border: none; background: ${isDestructive ? '#ef4444' : '#3b82f6'}; color: #ffffff; border-radius: 10px; cursor: pointer; font-family: 'Outfit', sans-serif; font-weight: 500; font-size: 0.95rem; transition: background 0.2s;">Confirm</button>
          </div>
        </div>
      `;

      document.body.appendChild(confirmModal);

      const confirmBtn = document.getElementById(`${modalId}-confirm`);
      const cancelBtn = document.getElementById(`${modalId}-cancel`);

      confirmBtn.onmouseenter = () => confirmBtn.style.background = isDestructive ? '#dc2626' : '#2563eb';
      confirmBtn.onmouseleave = () => confirmBtn.style.background = isDestructive ? '#ef4444' : '#3b82f6';
      cancelBtn.onmouseenter = () => cancelBtn.style.background = '#f1f5f9';
      cancelBtn.onmouseleave = () => cancelBtn.style.background = '#ffffff';

      function cleanup(result) {
        confirmModal.remove();
        resolve(result);
      }

      confirmBtn.onclick = () => cleanup(true);
      cancelBtn.onclick = () => cleanup(false);
      confirmModal.onclick = (e) => {
        if (e.target === confirmModal) cleanup(false);
      };
    });
  };

  // Database and question management
  let typeDatabase = [];
  let speakDatabase = [];
  let currentTypeQuestionId = 1;
  let currentSpeakQuestionId = 1;
  let questionRecommendationEngine = null;
  const recommendationIndexByMode = { type: null, speak: null, extended: null };
  const recommendationRecentByMode = { type: [], speak: [], extended: [] };
  const RECOMMENDATION_REASON_LABELS = {
    level_and_continuity: 'level + continuity fit',
    difficulty_only: 'difficulty fit',
    continuity_only: 'strong match',
    fallback: 'best available match'
  };
  let extendedQuestionLoaded = false; // Flag to lazy-load extended question only when Fill tab is clicked

  // Progress cache: stores progress status for all questions per mode
  // Structure: { mode: { questionId: { perfectCount, tier, lastCompletedAt } } }
  // This cache is used to avoid excessive Firestore reads when rendering dropdown
  // 
  // Tier Calculation:
  //   - 'none': 0 perfect completions
  //   - 'completed': 1 perfect completion
  //   - 'consolidated': 2 perfect completions
  //   - 'mastered': 3+ perfect completions
  let progressCache = {
    type: {},
    speak: {}
  };

  // Legacy alias for backward compatibility
  let masteryCache = progressCache;
  let correctSentenceType = ""; // Will be loaded from database for Type mode
  let correctSentenceSpeak = ""; // Will be loaded from database for Speak mode
  let sentenceLengthData = null; // Map<lengthRange, Set<questionId>> for Type mode
  let speakLengthData = null; // Map<lengthRange, Set<questionId>> for Speak mode

  // RPG assist attempt state (used for active-skill spending + calibration penalties).
  const CORE_PRACTICE_MODES = new Set(['type', 'speak', 'extended', 'rfib', 'watch', 'notes', 'pronounce']);
  const HINT_SKILL_BY_LEVEL = {
    1: 'word_ghost',
    2: 'first_letter_peek',
    3: 'hint_reveal',
    4: 'transcript_glimpse'
  };
  const GUEST_HINT_SESSION_KEY = 'bel_guest_hint_uses';
  const GUEST_HINT_SESSION_LIMIT = 12;

  function normalizeAttemptContentId(contentId) {
    return String(contentId ?? '');
  }

  // Assistance is tracked per question (within the current session) so users can't
  // bypass calibration penalties by hitting Retry (or switching tabs) after using a hint/skill.
  const questionAssistStateByMode = Object.create(null);

  function ensureQuestionAssistState(mode, contentId) {
    const normalized = normalizeAttemptContentId(contentId);
    const existing = questionAssistStateByMode[mode];
    if (!existing || existing.contentId !== normalized) {
      questionAssistStateByMode[mode] = {
        mode,
        contentId: normalized,
        assistCalibMult: 1.0,
        totalAssistCost: 0,
        skillsUsed: {}
      };
    }
    return questionAssistStateByMode[mode];
  }

  function createAttemptContext(mode, contentId) {
    const assistState = ensureQuestionAssistState(mode, contentId);
    return {
      attemptId: crypto.randomUUID(),
      mode,
      contentId: normalizeAttemptContentId(contentId),
      assistCalibMult: assistState.assistCalibMult,
      totalAssistCost: assistState.totalAssistCost,
      skillsUsed: { ...(assistState.skillsUsed || {}) },
      createdAtMs: Date.now()
    };
  }

  function getAttemptContext(mode, contentId) {
    const context = window.currentAttemptContext || null;
    if (!context) return null;
    if (mode && context.mode !== mode) return null;
    if (contentId !== undefined && context.contentId !== normalizeAttemptContentId(contentId)) return null;
    return context;
  }

  function startAttemptContext(mode, contentId) {
    const context = createAttemptContext(mode, contentId);
    window.currentAttemptContext = context;
    window._typoShieldUsedThisQuestion = false;
    window._secondTakeUsedThisQuestion = false;
    window._pronRuneUsedThisQuestion = false;
    window._pronRuneIpaCache = null;

    // Reset active-skill UI states on new question
    window.isChunkingActive = false;
    window.isShadowModeActive = false;
    const chkBtn = document.getElementById('chunking-btn');
    if (chkBtn) chkBtn.classList.remove('active');
    const shBtn = document.getElementById('shadow-mode-btn');
    if (shBtn) shBtn.classList.remove('active');
    const pronDisplay = document.getElementById('pron-rune-display');
    if (pronDisplay) pronDisplay.style.display = 'none';
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    // Cleanup stale second-take overlay (BUG-8)
    const staleOverlay = document.getElementById('second-take-overlay');
    if (staleOverlay) staleOverlay.remove();

    return context;
  }

  function ensureAttemptContext(mode, contentId) {
    const existing = getAttemptContext(mode, contentId);
    if (existing) return existing;
    return startAttemptContext(mode, contentId);
  }

  function registerAssistUsage(skillId, mode, contentId, useResult) {
    const context = ensureAttemptContext(mode, contentId);
    context.skillsUsed[skillId] = (context.skillsUsed[skillId] || 0) + 1;
    context.totalAssistCost += Number(useResult?.cost) || 0;

    const serverMult = Number(useResult?.attemptCalibMult);
    if (Number.isFinite(serverMult)) {
      context.assistCalibMult = Math.max(0.25, Math.min(1.0, serverMult));
    } else {
      const catalogMult = window.SkillCatalog?.getSkill?.(skillId)?.calibMult;
      if (Number.isFinite(catalogMult)) {
        context.assistCalibMult = Math.max(0.25, Math.min(context.assistCalibMult, catalogMult));
      }
    }

    // Persist assist penalties for this question across retries/new attempts.
    const state = ensureQuestionAssistState(mode, contentId);
    state.assistCalibMult = context.assistCalibMult;
    state.totalAssistCost = context.totalAssistCost;
    state.skillsUsed = { ...(context.skillsUsed || {}) };
  }

  function getAttemptAssistMeta(mode, contentId) {
    const context = getAttemptContext(mode, contentId);
    if (!context) {
      return { assistCalibMult: 1.0, assistCount: 0 };
    }
    const assistCount = Object.values(context.skillsUsed || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
    const assistCalibMult = Number.isFinite(context.assistCalibMult)
      ? Math.max(0.25, Math.min(1.0, context.assistCalibMult))
      : 1.0;
    return { assistCalibMult, assistCount };
  }

  async function useActiveSkillForAttempt(skillId, mode, contentId) {
    const normalizedContentId = normalizeAttemptContentId(contentId);
    if (!window.auth || !window.auth.currentUser) {
      // Guidance handled by UI via handleLockedSkillClick
      return { success: false, error: 'unauthenticated' };
    }

    if (!window.callUseActiveSkill) {
      console.warn('[RPG] useActiveSkill wrapper not available');
      return { success: false, error: 'use_active_skill_unavailable' };
    }

    const context = ensureAttemptContext(mode, normalizedContentId);
    const result = await window.callUseActiveSkill({
      attemptId: context.attemptId,
      mode,
      contentId: normalizedContentId,
      skillId
    });

    if (!result?.success) {
      if (result?.error === 'skill_locked') {
        window.shopModule?.showAlertModal?.('Keep practicing to unlock this feature.', true);
      } else if (result?.error === 'skill_retired') {
        window.shopModule?.showAlertModal?.('This skill has been retired.', true);
      }
      return result || { success: false, error: 'use_active_skill_failed' };
    }

    registerAssistUsage(skillId, mode, normalizedContentId, result);

    return result;
  }

  function getNextHintSkillId() {
    const currentLevel = Number(window.HintSystem?.getCurrentHintLevel?.() || 0);
    const nextLevel = currentLevel + 1;
    return HINT_SKILL_BY_LEVEL[nextLevel] || null;
  }

  function getGuestHintUses() {
    const raw = Number.parseInt(sessionStorage.getItem(GUEST_HINT_SESSION_KEY) || '0', 10);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return raw;
  }

  function getGuestHintRemaining() {
    return Math.max(0, GUEST_HINT_SESSION_LIMIT - getGuestHintUses());
  }

  function consumeGuestHintUse() {
    const next = Math.min(GUEST_HINT_SESSION_LIMIT, getGuestHintUses() + 1);
    sessionStorage.setItem(GUEST_HINT_SESSION_KEY, String(next));
    return Math.max(0, GUEST_HINT_SESSION_LIMIT - next);
  }

  function updateHintCostBadge() {
    const costBadge = document.getElementById('hint-cost-badge');
    const hintBtn = document.getElementById('hint-btn');
    if (!costBadge) return;

    if (hintBtn) {
      // Reset to an enabled baseline; branches below may disable.
      hintBtn.disabled = false;
      hintBtn.title = 'Open hint actions';
    }

    const hasUser = !!(window.auth && window.auth.currentUser);
    const state = window.HintSystem?.getState?.() || { hasMore: true, currentLevel: 0, maxLevel: 0 };

    if (!state.hasMore) {
      costBadge.textContent = '(All used)';
      costBadge.className = 'hint-cost-badge max-reached';
      if (hintBtn) {
        hintBtn.disabled = true;
        hintBtn.classList.remove('locked');
        hintBtn.title = 'No more hints available for this question';
      }
      return;
    }

    if (!hasUser) {
      const remaining = getGuestHintRemaining();
      if (remaining <= 0) {
        costBadge.textContent = '(Demo limit reached)';
        costBadge.className = 'hint-cost-badge paid';
        if (hintBtn) {
          hintBtn.disabled = true;
          hintBtn.classList.remove('locked');
          hintBtn.title = 'Guest hint limit reached for this session';
        }
        return;
      }

      costBadge.textContent = `(Free ${remaining} left)`;
      costBadge.className = 'hint-cost-badge';
      if (hintBtn) {
        hintBtn.disabled = false;
        hintBtn.classList.remove('locked');
        hintBtn.title = 'Use a free demo hint';
      }
      return;
    }

    if (!window.shopModule?.isSkillUnlocked?.('word_ghost')) {
      costBadge.textContent = 'Locked';
      costBadge.className = 'hint-cost-badge locked';
      if (hintBtn) {
        hintBtn.disabled = false; // Keep clickable for guidance
        hintBtn.classList.add('locked');
        hintBtn.title = 'Keep practicing to unlock hint actions';
      }
      return;
    }

    costBadge.textContent = 'Ready';
    costBadge.className = 'hint-cost-badge';
    if (hintBtn) {
      hintBtn.disabled = false;
      hintBtn.classList.remove('locked');
      hintBtn.title = 'Open hint actions';
    }
  }

  function renderTypeHintState({ allowBaseline = true } = {}) {
    const hintDisplayEl = document.getElementById('auto-hints-type');
    if (!window.HintSystem) return;

    const settings = window.DifficultyManager ? window.DifficultyManager.getCurrentSettings('type') : { level: 1 };
    const cefrLevel = Number(settings?.level) || 1;
    const isLowCefr = cefrLevel <= 2;

    const currentLevel = Number(window.HintSystem.getCurrentHintLevel?.() || 0);
    if (allowBaseline && currentLevel === 0 && isLowCefr && correctSentenceType) {
      window.HintSystem.primeHintLevel(1);
    }

    const levelToShow = Number(window.HintSystem.getCurrentHintLevel?.() || 0);
    if (!correctSentenceType || !hintDisplayEl || levelToShow <= 0) {
      if (hintDisplayEl) hintDisplayEl.style.display = 'none';
      updateHintCostBadge();
      return;
    }

    const hint = window.HintSystem.generateHint(correctSentenceType, levelToShow);
    if (!hint) {
      hintDisplayEl.style.display = 'none';
      updateHintCostBadge();
      return;
    }

    // Transcript Glimpse is an active overlay hint; don't auto-show it.
    if (hint.type === 'transcript-glimpse') {
      hintDisplayEl.style.display = 'none';
      updateHintCostBadge();
      return;
    }

    if (hint.content) {
      hintDisplayEl.style.display = 'block';
      hintDisplayEl.innerHTML = `<div class="auto-hint-item">${hint.content}</div>`;
    } else {
      hintDisplayEl.style.display = 'none';
    }

    updateHintCostBadge();
  }

  function showTranscriptGlimpseOverlay(sentence, durationMs = 2000) {
    const text = String(sentence || '').trim();
    if (!text) return;

    let overlay = document.getElementById('transcript-glimpse-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'transcript-glimpse-overlay';
      overlay.className = 'transcript-glimpse-overlay';
      overlay.innerHTML = `
        <div class="transcript-glimpse-card" role="dialog" aria-label="Transcript Glimpse">
          <div class="transcript-glimpse-title">Transcript Glimpse</div>
          <div class="transcript-glimpse-text"></div>
        </div>
      `;
      overlay.addEventListener('click', () => {
        overlay.style.display = 'none';
      });
      document.body.appendChild(overlay);
    }

    const textEl = overlay.querySelector('.transcript-glimpse-text');
    if (textEl) textEl.textContent = text;

    overlay.style.display = 'flex';
    clearTimeout(overlay._hideTimer);
    overlay._hideTimer = setTimeout(() => {
      overlay.style.display = 'none';
    }, Math.max(500, Number(durationMs) || 2000));
  }

  function updateActiveSkillControlLocks() {
    const speedBtn = document.getElementById('speed-toggle-btn');
    const loopBtn = document.getElementById('loop-btn');
    const hintBtn = document.getElementById('hint-btn');
    const chunkBtn = document.getElementById('chunking-btn');
    const hasUser = !!(window.auth && window.auth.currentUser);

    const canUseSlow = hasUser && !!window.shopModule?.isSkillUnlocked?.('slow_audio');
    const canUseLoop = hasUser && !!window.shopModule?.isSkillUnlocked?.('echo_loop');
    const canUseHints = hasUser && !!window.shopModule?.isSkillUnlocked?.('word_ghost');
    const canUseChunking = hasUser && !!window.shopModule?.isSkillUnlocked?.('chunking');

    if (speedBtn) {
      speedBtn.classList.toggle('locked', !canUseSlow);
      speedBtn.disabled = false; // Keep clickable for tooltips and guidance
      speedBtn.title = canUseSlow ? 'Playback Speed' : 'Keep practicing to unlock Slow Audio';
    }
    if (loopBtn) {
      loopBtn.classList.toggle('locked', !canUseLoop);
      loopBtn.disabled = false;
      loopBtn.title = canUseLoop ? 'Loop Audio' : 'Keep practicing to unlock Echo Loop';
    }
    if (chunkBtn) {
      if (canUseChunking) {
        chunkBtn.style.display = 'inline-block';
        chunkBtn.classList.remove('locked');
        chunkBtn.title = 'Segment Audio';
      } else {
        chunkBtn.style.display = 'none';
      }
    }
    // Shadow Mode button (Speak mode)
    const shadowBtn = document.getElementById('shadow-mode-btn');
    const canUseShadow = hasUser && !!window.shopModule?.isSkillUnlocked?.('shadow_mode');
    if (shadowBtn) {
      if (canUseShadow) {
        shadowBtn.style.display = 'inline-block';
        shadowBtn.classList.remove('locked');
        shadowBtn.title = 'Shadow Mode';
      } else {
        shadowBtn.style.display = 'none';
      }
    }
    // Streak Shield badge
    const streakBadge = document.getElementById('streak-shield-badge');
    const hasStreakShield = hasUser && !!window.shopModule?.hasSkill?.('streak_shield');
    if (streakBadge) {
      streakBadge.style.display = hasStreakShield ? 'inline-block' : 'none';
    }
    if (hintBtn) {
      // Logic handled in updateHintCostBadge
    }

    updateHintCostBadge();
  }
  /**
   * Handle clicks on locked skills to guide the user to the roadmap.
   */
  async function handleLockedSkillClick(skillId) {
    if (!window.auth || !window.auth.currentUser) {
      window.shopModule?.showAlertModal?.('Please log in to unlock skills.', true);
      return false;
    }

    // Open the progression roadmap.
    window.shopModule?.openShop?.('level-system-container');
    return true;
  }
  window.ensureAttemptContext = ensureAttemptContext;
  window.refreshActiveSkillLocks = updateActiveSkillControlLocks;

  // Dashboard Panel Logic (Modern Segmented Control)
  window.toggleDashboardPanel = function (panelId) {
    // 1. Panel Visibility Logic
    const panels = document.querySelectorAll('.dashboard-panel');
    panels.forEach(p => {
      p.classList.remove('active');
      p.style.display = 'none';
    });

    // Deactivate all buttons
    const buttons = document.querySelectorAll('.segmented-btn');
    buttons.forEach(b => b.classList.remove('active'));

    // Show target panel
    const targetPanel = document.getElementById(panelId);
    if (targetPanel) {
      targetPanel.classList.add('active');
      targetPanel.style.display = 'block';

      // 2. Button Activation & Backdrop Animation
      const btnId = 'btn-' + panelId;
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.classList.add('active');

        // Animate Backdrop
        const backdrop = document.getElementById('segmented-backdrop');
        if (backdrop) {
          backdrop.style.width = `${btn.offsetWidth}px`;
          backdrop.style.transform = `translateX(${btn.offsetLeft}px)`;
        }
      }

      // 3. Mode Panel Visibility Logic
      // Mode switching is now handled by Learning Center buttons
      // The tabs-header is permanently hidden in HTML
      const modePanels = document.querySelectorAll('.mode-panel');

      if (panelId === 'panel-srs' || panelId === 'panel-entertainment') {
        // Hide all mode panels when in non-practice dashboards
        modePanels.forEach(p => p.style.setProperty('display', 'none', 'important'));

        // Hide current mode indicator pill in header
        const indicator = document.getElementById('current-mode-indicator');
        if (indicator) indicator.style.display = 'none';
      } else {
        // Restore visibility of the active mode panel when in Learning Center
        modePanels.forEach(p => {
          if (p.classList.contains('active')) {
            p.style.removeProperty('display'); // Remove inline override to let CSS rule take over
            p.style.display = 'block'; // Fallback
          } else {
            p.style.setProperty('display', 'none', 'important');
          }
        });

        if (typeof updatePracticeScopeToggleUI === 'function') {
          updatePracticeScopeToggleUI();
        }

        if (typeof renderPracticeLauncher === 'function') {
          renderPracticeLauncher();
        }

        if (typeof updateCurrentModeIndicator === 'function') {
          updateCurrentModeIndicator(currentActiveMode);
        }
      }

      // 4. Extra: Trigger schedule table render if switching to SRS panel
      if (panelId === 'panel-srs' && window.SRSReview && typeof window.SRSReview.renderScheduleTable === 'function') {
        window.SRSReview.renderScheduleTable();
      }
    }
  };

  // Initialize backdrop position on load
  document.addEventListener('DOMContentLoaded', () => {
    // Initialize dashboard backdrop
    const initialBtn = document.querySelector('.segmented-btn.active');
    const backdrop = document.getElementById('segmented-backdrop');
    if (initialBtn && backdrop) {
      // Small timeout to ensure layout is stable
      setTimeout(() => {
        backdrop.style.width = `${initialBtn.offsetWidth}px`;
        backdrop.style.transform = `translateX(${initialBtn.offsetLeft}px)`;
        backdrop.style.opacity = '1'; // Fade in after positioning
      }, 100);
    }

    // Initialize mode panels visibility based on default active dashboard panel
    const activePanel = document.querySelector('.dashboard-panel.active');
    const modePanels = document.querySelectorAll('.mode-panel');
    const practiceScopeFilter = document.getElementById('practice-scope-filter');
    const practiceSkillFilter = document.getElementById('practice-skill-filter');

    if (practiceScopeFilter) {
      practiceScopeFilter.querySelectorAll('.practice-scope-btn[data-practice-scope]').forEach((button) => {
        button.addEventListener('click', () => {
          const scope = button.dataset.practiceScope;
          if (scope) setPracticeScope(scope);
        });
      });
      updatePracticeScopeToggleUI();
    }

    if (practiceSkillFilter) {
      practiceSkillFilter.querySelectorAll('.practice-skill-btn').forEach((button) => {
        button.addEventListener('click', () => {
          const skill = button.dataset.practiceSkill;
          if (skill) setSelectedPracticeSkill(skill);
        });
      });
      renderPracticeLauncher();
    }

    // CHECK FOR READING JOURNEY ROUTE FIRST
    const normalizedPath = (window.location.pathname || '/').replace(/\/+$/, '');
    const isReadingJourneyRoute = normalizedPath === '/readingjourney';

    if (isReadingJourneyRoute) {
      // Initialize Reading Journey and hide main app layout
      const rjRoot = document.getElementById('readingjourney-root');
      if (rjRoot && typeof window.initReadingJourney === 'function') {
        window.initReadingJourney(rjRoot);
        const pageWrapper = document.getElementById('page-layout-wrapper');
        if (pageWrapper) pageWrapper.style.display = 'none';
        rjRoot.style.display = 'block';
        return; // Skip standard practice mode initialization
      }
    }

    if (activePanel) {
      if (activePanel.id === 'panel-srs') {
        modePanels.forEach(p => p.style.display = 'none');
      } else {
        modePanels.forEach(p => p.style.display = 'none');
        updateCurrentModeIndicator('');
      }
    }

    // What's this? button click handler
    const whatIsThisBtn = document.getElementById('what-is-this-btn');
    if (whatIsThisBtn) {
      whatIsThisBtn.addEventListener('click', () => {
        window.showModeRecommendation();
      });
    }

    // Accessibility: Keyboard interaction for cards
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute('role') === 'button') {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('modern-card')) {
          e.preventDefault(); // Prevent scrolling on Space
          activeEl.click();
        }
      }
    });

    // Modal Close Logic - use reset function
    document.getElementById('mode-helper-close-btn')?.addEventListener('click', () => {
      const modal = document.getElementById('mode-helper-modal');
      if (modal) modal.style.display = 'none';
      resetGoalModalState(); // Clean up for next open
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('mode-helper-modal');
        if (modal && modal.style.display !== 'none') {
          modal.style.display = 'none';
          resetGoalModalState();
        }
      }
    });

    // Mode Helper Multiple Choice Flow
    document.getElementById('mode-helper-submit-btn')?.addEventListener('click', handleGoalSubmit);
    document.getElementById('mode-helper-back-btn')?.addEventListener('click', handleSuggestionsBack);
    document.getElementById('mode-helper-start-btn')?.addEventListener('click', handleStartLearning);

    // Enforce maximum 2 checkbox selections with live feedback
    document.querySelectorAll('#mode-helper-modal input[name="goal"]').forEach(checkbox => {
      checkbox.addEventListener('change', enforceMaxGoalSelection);
    });

    if (activePanel && activePanel.id !== 'panel-srs' && !currentActiveMode) {
      // Check if the URL contains a specific mode route (deep-link / refresh)
      const urlRoute = PracticeRouter.initFromURL();
      if (urlRoute && urlRoute.mode) {
        // URL has a mode — navigate to it (use replaceState since this is initial load)
        window.switchToMode?.(urlRoute.mode);
        // Replace the initial history entry so we don't push duplicate
        window.history.replaceState(
          { mode: urlRoute.mode, questionId: urlRoute.questionId, source: 'practice-router' },
          '',
          window.location.pathname
        );
        // If a question ID is specified, dispatch event for mode scripts to handle
        if (urlRoute.questionId) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('practice-route-question', {
              detail: { mode: urlRoute.mode, questionId: urlRoute.questionId }
            }));
          }, 300);
        }
      } else {
        // No URL route — ensure we are on the dashboard in a clean state
        // No URL route: stay on the dashboard (do not rewrite the URL or auto-enter a mode).
      }
    }
  });

  /**
   * Enforces the maximum 2 checkbox selection rule
   * Updates disabled state and helper text visibility
   */
  function enforceMaxGoalSelection() {
    const modal = document.getElementById('mode-helper-modal');
    if (!modal) return;

    const allCheckboxes = modal.querySelectorAll('input[name="goal"]');
    const checkedCount = modal.querySelectorAll('input[name="goal"]:checked').length;
    const helperText = modal.querySelector('.goal-limit-helper');

    if (checkedCount >= 2) {
      // Disable unchecked, show helper
      allCheckboxes.forEach(cb => {
        if (!cb.checked) {
          cb.disabled = true;
          cb.closest('.helper-option-checkbox')?.classList.add('disabled');
        }
      });
      if (helperText) helperText.classList.add('visible');
    } else {
      // Re-enable all
      allCheckboxes.forEach(cb => {
        cb.disabled = false;
        cb.closest('.helper-option-checkbox')?.classList.remove('disabled');
      });
      if (helperText) helperText.classList.remove('visible');
    }
  }

  /**
   * Completely resets the goal modal state
   * Should be called on: close, start learning, and open
   */
  function resetGoalModalState() {
    const modal = document.getElementById('mode-helper-modal');
    if (!modal) return;

    // Reset all checkboxes: uncheck and enable
    modal.querySelectorAll('input[name="goal"]').forEach(cb => {
      cb.checked = false;
      cb.disabled = false;
      cb.closest('.helper-option-checkbox')?.classList.remove('disabled');
    });

    // Reset selected mode
    selectedModeToStart = null;

    // Reset to step 1 (goals) using class toggles
    setGoalModalStep('goals');

    // Clear suggestions list
    const suggestionsList = modal.querySelector('#mode-suggestions-list');
    if (suggestionsList) suggestionsList.innerHTML = '';

    // Hide helper text
    const helperText = modal.querySelector('.goal-limit-helper');
    if (helperText) helperText.classList.remove('visible');
  }

  /**
   * Centralized step management for goal modal
   * @param {'goals' | 'suggestions'} step
   */
  function setGoalModalStep(step) {
    const modal = document.getElementById('mode-helper-modal');
    if (!modal) return;

    const goalsStep = modal.querySelector('#mode-helper-step-goals');
    const suggestionsStep = modal.querySelector('#mode-helper-step-suggestions');

    if (step === 'goals') {
      goalsStep?.classList.remove('is-hidden');
      suggestionsStep?.classList.add('is-hidden');
    } else if (step === 'suggestions') {
      goalsStep?.classList.add('is-hidden');
      suggestionsStep?.classList.remove('is-hidden');
    }
  }

  // Expose for external use
  window.resetGoalModalState = resetGoalModalState;

  // Track current active mode for tutorial button
  let currentActiveMode = '';
  let modeTransitionToken = 0;
  const PRACTICE_LAUNCHER = {
    defaultSkill: 'speaking',
    defaultMode: 'read-aloud',
    skills: {
      speaking: {
        label: 'Speaking',
        kind: 'live-skill',
        modeIds: ['speak', 'pronounce', 'read-aloud', 'asq', 'sgd', 'describe-image', 'rts']
      },
      listening: {
        label: 'Listening',
        kind: 'live-skill',
        modeIds: ['sst', 'lmcma', 'extended', 'hcs', 'lmcsa', 'smw', 'hiw', 'type', 'collo-dictate', 'notes', 'watch']
      },
      reading: {
        label: 'Reading',
        kind: 'live-skill',
        modeIds: ['rfib', 'dd', 'rmcsa', 'rmcma', 'rop']
      },
      writing: {
        label: 'Writing',
        kind: 'live-skill',
        modeIds: ['essay', 'swt']
      }
    },
    modes: {
      sst: {
        label: 'Summarize Spoken Text',
        skill: 'listening',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      type: {
        label: 'Dictate',
        skill: 'listening',
        hasTutorial: true,
        isLive: true,
        launcherVisible: true
      },
      'collo-dictate': {
        label: 'Collo-dictate',
        skill: 'listening',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      speak: {
        label: 'Repeat',
        skill: 'speaking',
        hasTutorial: true,
        isLive: true,
        launcherVisible: true
      },
      pronounce: {
        label: 'Pronounce',
        skill: 'speaking',
        hasTutorial: true,
        isLive: true,
        launcherVisible: true
      },
      extended: {
        label: 'Fill In the Blanks',
        skill: 'listening',
        hasTutorial: true,
        isLive: true,
        launcherVisible: true
      },
      watch: {
        label: 'Watch',
        skill: 'listening',
        hasTutorial: true,
        isLive: true,
        launcherVisible: true
      },
      notes: {
        label: 'Take Notes',
        skill: 'listening',
        hasTutorial: true,
        isLive: true,
        launcherVisible: true
      },
      'read-aloud': {
        label: 'Read Aloud',
        skill: 'speaking',
        hasTutorial: true,
        isLive: true,
        launcherVisible: true
      },
      asq: {
        label: 'Quiz',
        skill: 'speaking',
        hasTutorial: false,
        isLive: true,
        launcherVisible: false
      },
      rfib: {
        label: 'Fill in the Blanks (Dropdown)',
        skill: 'reading',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      dd: {
        label: 'Fill in the Blanks (Drag and Drop)',
        skill: 'reading',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      rmcsa: {
        label: 'Multiple Choice, Single Answer',
        skill: 'reading',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      rmcma: {
        label: 'Multiple Choice, Multiple Answers',
        skill: 'reading',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      lmcma: {
        label: 'Multiple Choice, Multiple Answers',
        skill: 'listening',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      lmcsa: {
        label: 'Multiple Choice, Single Answer',
        skill: 'listening',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      hcs: {
        label: 'Highlight Correct Summary',
        skill: 'listening',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      smw: {
        label: 'Select Missing Word',
        skill: 'listening',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      hiw: {
        label: 'Highlight Incorrect Words',
        skill: 'listening',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      rop: {
        label: 'Reorder Paragraph',
        skill: 'reading',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      essay: {
        label: 'Write Essay',
        skill: 'writing',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      swt: {
        label: 'Summarize Written Text',
        skill: 'writing',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      sgd: {
        label: 'Discussion',
        skill: 'speaking',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
      'describe-image': {
        label: 'Describe Image',
        skill: 'speaking',
        hasTutorial: false,
        isLive: true,
        launcherVisible: false
      },
      rts: {
        label: 'Respond To Situation',
        skill: 'speaking',
        hasTutorial: false,
        isLive: true,
        launcherVisible: false
      }
    }
  };

  const SCOPE_ENGLISH = 'english';
  const SCOPE_PTE = 'pte';
  const VALID_SCOPES = new Set([SCOPE_ENGLISH, SCOPE_PTE]);
  const PRACTICE_SCOPE_STORAGE_KEY = 'practiceScope';

  const PRACTICE_SCOPE_CONFIG = {
    [SCOPE_ENGLISH]: {
      visibleModes: new Set([
        'read-aloud', 'speak', 'notes', 'extended', 'type', 'rfib', 'essay', 'pronounce', 'collo-dictate'
      ]),
      modeOverrides: Object.freeze({})
    },
    [SCOPE_PTE]: {
      visibleModes: new Set([
        'read-aloud', 'speak', 'describe-image', 'notes', 'asq', 'sgd', 'essay', 'swt', 'sst', 'type', 'rfib', 'dd', 'rmcsa', 'rmcma', 'rop', 'extended', 'rts', 'lmcma', 'lmcsa', 'hcs', 'smw', 'hiw'
      ]),
      modeOverrides: Object.freeze({
        speak: { label: 'Repeat Sentence' },
        notes: { label: 'Retell Lecture', skill: 'speaking' },
        type: { label: 'Write from Dictation' },
        asq: { launcherVisible: true, label: 'Answer Short Questions' },
        sgd: { label: 'Summarize Group Discussion' },
        essay: { label: 'Write Essay' },
        swt: { label: 'Summarize Written Text' },
        sst: { label: 'Summarize Spoken Text' },
        'describe-image': { launcherVisible: true, label: 'Describe Image' },
        rts: { launcherVisible: true, label: 'Respond To Situation' },
        rop: { label: 'Reorder Paragraph' },
        dd: { label: 'Fill in the Blanks (Drag and Drop)' },
        lmcma: { label: 'Multiple Choice, Multiple Answers' },
        lmcsa: { label: 'Multiple Choice, Single Answer' },
        hcs: { label: 'Highlight Correct Summary' },
        smw: { label: 'Select Missing Word' },
        hiw: { label: 'Highlight Incorrect Words' }
      })
    }
  };

  function clonePlain(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clonePlain);
    const cloned = {};
    Object.entries(value).forEach(([key, val]) => {
      cloned[key] = clonePlain(val);
    });
    return cloned;
  }

  const PracticeScopeManager = (() => {
    let scope = SCOPE_PTE;
    const subscribers = new Set();

    function readStoredScope() {
      try {
        const raw = localStorage.getItem(PRACTICE_SCOPE_STORAGE_KEY);
        return VALID_SCOPES.has(raw) ? raw : null;
      } catch (_) {
        return null;
      }
    }

    function persistScope(nextScope) {
      try {
        localStorage.setItem(PRACTICE_SCOPE_STORAGE_KEY, nextScope);
      } catch (_) {
        // ignore
      }
    }

    function syncMirror() {
      window.appState = window.appState || {};
      window.appState.practiceScope = scope;
    }

    function getScope() {
      return scope;
    }

    function setScope(nextScope, { persist = true } = {}) {
      if (!VALID_SCOPES.has(nextScope)) return false;
      if (nextScope === scope) return false;
      scope = nextScope;
      syncMirror();
      if (persist) persistScope(scope);
      subscribers.forEach((fn) => {
        try {
          fn(scope);
        } catch (error) {
          console.error('[PracticeScopeManager] subscriber error:', error);
        }
      });
      return true;
    }

    function subscribe(fn) {
      if (typeof fn !== 'function') return () => { };
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    }

    scope = readStoredScope() || SCOPE_PTE;
    syncMirror();

    return Object.freeze({
      getScope,
      setScope,
      subscribe,
      SCOPE_ENGLISH,
      SCOPE_PTE,
      VALID_SCOPES
    });
  })();

  window.PracticeScopeManager = PracticeScopeManager;

  // =========================================================================
  //  PracticeRouter — URL-based navigation with History API
  //  Enables browser back/forward between modes and deep-linking.
  //  URL schema: /practice/{skill}/{mode}[/{questionId}]
  //  Only mode changes push history entries; question changes use replaceState.
  // =========================================================================
  const PracticeRouter = (() => {
    let _isPopstateNavigation = false;
    let _lastPopstateAt = 0;
    let _initialized = false;
    let _lastActivePath = window.location.pathname;
    let _lastActiveState = null;
    const POPSTATE_GRACE_MS = 600;

    function isPopstateNavigationWindow() {
      if (_isPopstateNavigation) return true;
      if (!_lastPopstateAt) return false;
      return Date.now() - _lastPopstateAt < POPSTATE_GRACE_MS;
    }

    function saveActiveState() {
      _lastActivePath = window.location.pathname;
      _lastActiveState = window.history.state;
    }

    function revertState() {
      try {
        window.history.replaceState(_lastActiveState, '', _lastActivePath);
      } catch (_) {}
    }

    /**
     * Build URL path for a given mode + optional question ID.
     * @param {string} mode - e.g. 'read-aloud', 'asq', 'type'
     * @param {string|number|null} questionId - optional question identifier
     * @returns {string} URL path like /practice/speaking/read-aloud/42
     */
    function buildPath(mode, questionId) {
      const scope = PracticeScopeManager.getScope();
      const prefix = scope === SCOPE_PTE ? '/pte-practice' : '/practice';
      if (!mode) return prefix;
      const meta = getResolvedModeMeta?.(mode) || PRACTICE_LAUNCHER.modes[mode];
      const skill = meta?.skill || 'speaking';
      let path = `${prefix}/${skill}/${mode}`;
      if (questionId != null && questionId !== '' && questionId !== 'random') {
        path += `/${questionId}`;
      }
      return path;
    }

    /**
     * Parse a URL pathname into { skill, mode, questionId }.
     * Handles: /practice, /practice/speaking/read-aloud, /practice/speaking/read-aloud/42
     * Also handles root / and non-practice paths gracefully.
     */
    function parseRoute(pathname) {
      const clean = (pathname || '/').replace(/\/+$/, '') || '/';
      const segments = clean.split('/').filter(Boolean);

      const isPte = segments[0] === 'pte-practice';
      const isEnglish = segments[0] === 'practice';

      if (!isPte && !isEnglish) {
        return { skill: null, mode: null, questionId: null, isPractice: false, scope: null };
      }

      return {
        skill: segments[1] || null,
        mode: segments[2] || null,
        questionId: segments[3] || null,
        isPractice: true,
        scope: isPte ? SCOPE_PTE : SCOPE_ENGLISH
      };
    }

    /**
     * Push a new history entry (mode change).
     * Called from switchToMode.
     */
    function pushRoute(mode, questionId) {
      if (isPopstateNavigationWindow()) return; // URL is already correct for this history entry
      const path = buildPath(mode, questionId);
      const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
      if (currentPath === path) return; // Already at this path
      try {
        window.history.pushState(
          { mode: mode || '', questionId: questionId || null, source: 'practice-router' },
          '',
          path
        );
        saveActiveState();
      } catch (_) { /* pushState may fail in some contexts */ }
    }

    /**
     * Replace current history entry (question change within same mode).
     * Called from question selectors.
     */
    function replaceRoute(mode, questionId) {
      if (isPopstateNavigationWindow()) return; // URL is already correct for this history entry
      // Guard against inactive mode scripts rewriting the URL while the user is on the dashboard.
      // Only allow question-level URL updates when the mode is active (or already reflected in the URL).
      if (mode) {
        const activeMode = String(window.appState?.currentMode || '').trim();
        if (activeMode !== String(mode)) {
          const currentRoute = parseRoute(window.location.pathname);
          const urlMode = String(currentRoute?.mode || '').trim();
          if (urlMode !== String(mode)) return;
        }
      }
      const path = buildPath(mode, questionId);
      const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
      if (currentPath === path) return; // Already at this path
      try {
        window.history.replaceState(
          { mode: mode || '', questionId: questionId || null, source: 'practice-router' },
          '',
          path
        );
        saveActiveState();
      } catch (_) { /* replaceState may fail in some contexts */ }
    }

    /**
     * Initialize from the current URL on page load.
     * Returns { mode, questionId } if a mode route was detected, or null for dashboard.
     */
    function initFromURL() {
      const route = parseRoute(window.location.pathname);
      if (!route.isPractice) return null;

      // Sync scope from URL prefix
      if (route.scope) {
        setPracticeScope(route.scope, { persist: true });
      }

      if (!route.mode) return null;

      // Validate that the mode exists
      const meta = PRACTICE_LAUNCHER.modes[route.mode];
      if (!meta) return null;

      saveActiveState();
      return { mode: route.mode, questionId: route.questionId };
    }

    /**
     * Set up the popstate listener for browser back/forward.
     */
    function setupPopstateListener() {
      window.addEventListener('popstate', async (event) => {
        _isPopstateNavigation = true;
        _lastPopstateAt = Date.now();
        try {
          const route = parseRoute(window.location.pathname);

          // Sync scope from URL prefix (matches initFromURL behavior)
          if (route.scope) {
            try {
              setPracticeScope(route.scope, { persist: true });
            } catch (_) { /* ignore */ }
          }

          if (!route.isPractice || !route.mode) {
            // Back to dashboard
            if (typeof window.exitCurrentMode === 'function') {
              const exited = await window.exitCurrentMode();
              if (exited === false) {
                revertState();
                return;
              }
            }
            saveActiveState();
            return;
          }

          // Validate mode exists
          const meta = PRACTICE_LAUNCHER.modes[route.mode];
          if (!meta) {
            if (typeof window.exitCurrentMode === 'function') {
              const exited = await window.exitCurrentMode();
              if (exited === false) {
                revertState();
                return;
              }
            }
            saveActiveState();
            return;
          }

          // Switch to the mode from the URL
          if (typeof window.switchToMode === 'function') {
            const switched = await window.switchToMode(route.mode);
            if (switched === false) {
              revertState();
              return;
            }
          }

          // If a specific question ID is in the URL, try to navigate to it
          if (route.questionId) {
            _navigateToQuestion(route.mode, route.questionId);
          }
          saveActiveState();
        } finally {
          _isPopstateNavigation = false;
        }
      });
    }

    /**
     * Try to navigate to a specific question within the current mode.
     * This dispatches a custom event that mode-specific scripts can listen to.
     */
    function _navigateToQuestion(mode, questionId) {
      // Dispatch a custom event that mode scripts can hook into
      window.dispatchEvent(new CustomEvent('practice-route-question', {
        detail: { mode, questionId }
      }));
    }

    /**
     * Check if current navigation is triggered by popstate (browser back/forward).
     */
    function isPopstateNavigation() {
      return _isPopstateNavigation;
    }

    if (!_initialized) {
      _initialized = true;
      setupPopstateListener();
    }

    return Object.freeze({
      pushRoute,
      replaceRoute,
      parseRoute,
      buildPath,
      initFromURL,
      isPopstateNavigation
    });
  })();

  window.PracticeRouter = PracticeRouter;

  function getPracticeScope() {
    return PracticeScopeManager.getScope();
  }

  function getPracticeScopeConfig(scope = getPracticeScope()) {
    return PRACTICE_SCOPE_CONFIG[scope] || PRACTICE_SCOPE_CONFIG[SCOPE_ENGLISH];
  }

  function getResolvedModeMeta(mode, scope = getPracticeScope()) {
    const baseMeta = PRACTICE_LAUNCHER.modes[mode] || null;
    if (!baseMeta) return null;
    const resolved = typeof structuredClone === 'function' ? structuredClone(baseMeta) : clonePlain(baseMeta);
    const overrides = getPracticeScopeConfig(scope)?.modeOverrides?.[mode];
    if (overrides && typeof overrides === 'object') {
      Object.assign(resolved, overrides);
    }
    return resolved;
  }

  function isModeVisibleInScope(mode, scope = getPracticeScope()) {
    const meta = getResolvedModeMeta(mode, scope);
    if (!meta) return false;

    // 1. Priority: Scope-specific visibleModes Set
    const visibleModes = getPracticeScopeConfig(scope)?.visibleModes;
    if (visibleModes instanceof Set) {
      return visibleModes.has(mode);
    }

    // 2. Fallback: Check launcherVisible flag in resolved meta (includes overrides)
    return meta.launcherVisible !== false;
  }

  function updatePracticeScopeToggleUI() {
    const root = document.getElementById('practice-scope-filter');
    if (!root) return;
    const scope = getPracticeScope();
    root.querySelectorAll('.practice-scope-btn[data-practice-scope]').forEach((btn) => {
      const btnScope = btn.dataset.practiceScope;
      const isActive = btnScope === scope;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function updatePracticeScopeUI() {
    updatePracticeScopeToggleUI();
    renderPracticeLauncher();
    if (currentActiveMode) {
      updateCurrentModeIndicator(currentActiveMode);
    }
  }

  async function maybeEnableAsqModeInLauncher() {
    try {
      const response = await fetch('/database/quiz/ASQ/audio/manifest.json', { method: 'HEAD' });
      if (!response.ok) return;

    // The PTE scope config now includes 'asq' in its visibleModes Set by default
    // We only need to ensure the manifest is actually usable
    const pteVisible = PRACTICE_SCOPE_CONFIG?.[SCOPE_PTE]?.visibleModes;
    if (pteVisible instanceof Set) {
      pteVisible.add('asq');
    }

      renderPracticeLauncher();
    } catch (_) {
      // Keep ASQ hidden when assets are missing/unreachable.
    }
  }

  function setPracticeScope(scope, { persist = true } = {}) {
    const changed = PracticeScopeManager.setScope(scope, { persist });
    if (!changed) return false;

    updatePracticeScopeToggleUI();

    if (currentActiveMode) {
      const activeSkill = getSkillForMode(currentActiveMode);
      if (activeSkill && activeSkill !== selectedPracticeSkill) {
        setSelectedPracticeSkill(activeSkill, { render: false });
      }
    }

    if (scope === SCOPE_PTE && currentActiveMode && !isModeVisibleInScope(currentActiveMode, scope)) {
      window.switchToMode?.('read-aloud');
      return true;
    }

    updatePracticeScopeUI();
    return true;
  }

  window.setPracticeScope = setPracticeScope;
  window.practiceVariantHooks = {
    [SCOPE_ENGLISH]: {},
    [SCOPE_PTE]: { notes: {} }
  };
  window.getPracticeVariantHooks = function (mode) {
    return window.practiceVariantHooks?.[getPracticeScope()]?.[mode] || null;
  };
  const PRACTICE_SKILL_ORDER = Object.keys(PRACTICE_LAUNCHER.skills);
  let selectedPracticeSkill = PRACTICE_LAUNCHER.defaultSkill;

  function getModeMeta(mode) {
    return getResolvedModeMeta(mode) || null;
  }
  // Exposed so other modules (e.g. the Vocab Book list) can render human mode
  // labels from this registry instead of keeping their own copy that drifts.
  window.getModeMeta = getModeMeta;

  function getSkillForMode(mode) {
    return getModeMeta(mode)?.skill || null;
  }

  function getModeDisplayName(mode) {
    return getModeMeta(mode)?.label || mode;
  }

  function setSelectedPracticeSkill(skill, { render = true } = {}) {
    if (!PRACTICE_SKILL_ORDER.includes(skill)) return false;
    const changed = selectedPracticeSkill !== skill;
    selectedPracticeSkill = skill;

    if (render) renderPracticeLauncher();
    return changed;
  }

  function renderPracticeLauncher() {
    const filterRoot = document.getElementById('practice-skill-filter');
    if (filterRoot) {
      filterRoot.querySelectorAll('.practice-skill-btn').forEach((button) => {
        const skill = button.dataset.practiceSkill;
        const skillMeta = PRACTICE_LAUNCHER.skills[skill];
        const isActive = skill === selectedPracticeSkill;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        button.setAttribute('aria-label', skillMeta?.label || button.querySelector('strong')?.textContent?.trim() || skill);
      });
    }

    document.querySelectorAll('#panel-tutorials .tutorial-grid .mode-switch-btn[data-practice-skill]').forEach((card) => {
      const cardMode = card.id ? card.id.replace(/^mode-btn-/, '') : '';
      const modeMeta = getModeMeta(cardMode);
      const shouldShow = !!modeMeta && isModeVisibleInScope(cardMode) && modeMeta.skill === selectedPracticeSkill;
      card.hidden = !shouldShow;
      card.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');

      const title = card.querySelector('.card-body h3');
      if (title && modeMeta?.label) {
        title.textContent = modeMeta.label;
      }
      if (modeMeta?.label) {
        card.setAttribute('aria-label', `${modeMeta.label} Practice mode`);
      }
    });

    const writingEmptyState = document.getElementById('practice-writing-empty');
    if (writingEmptyState) {
      const writingCards = Array.from(document.querySelectorAll('.tutorial-card[data-practice-skill="writing"]'));
      const hasVisibleWritingCards = writingCards.some(card => !card.hidden && card.id !== 'practice-writing-empty');
      const shouldShow = selectedPracticeSkill === 'writing' && !hasVisibleWritingCards;
      writingEmptyState.hidden = !shouldShow;
      writingEmptyState.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    }

  }

  function renderPracticeSkillFilter() {
    renderPracticeLauncher();
  }

  function syncSelectedSkillToMode(mode) {
    const skill = getSkillForMode(mode);
    if (skill) {
      setSelectedPracticeSkill(skill);
    } else {
      renderPracticeLauncher();
    }
  }

  // Single source of truth for which modes use the shared Speaking controller.
  const SPEAKING_MODES = ['asq', 'rts', 'describe-image', 'notes', 'sgd', 'speak', 'read-aloud', 'type'];

  /**
   * Update the current mode indicator shown between mode cards and progress bar
   * @param {string} mode - The active mode name
   */
  function updateCurrentModeIndicator(mode) {
    if (!mode) {
      currentActiveMode = '';
      window.appState = window.appState || {};
      window.appState.currentMode = '';
      const indicator = document.getElementById('current-mode-indicator');
      if (indicator) indicator.style.display = 'none';
      return;
    }
    currentActiveMode = mode;
    window.appState = window.appState || {};
    window.appState.currentMode = mode;
    const indicator = document.getElementById('current-mode-indicator');
    const modeName = document.getElementById('current-mode-name');
    const tutorialBtn = document.getElementById('mode-tutorial-btn');
    const backBtn = document.getElementById('back-to-dashboard-btn');
    const modeMeta = getModeMeta(mode);
    const hasTutorial = !!modeMeta?.hasTutorial;

    if (indicator && modeName) {
      // Show the indicator
      indicator.style.display = 'inline-flex';
      if (backBtn) backBtn.style.display = 'inline-flex';

      // Update mode name with display-friendly text
      modeName.textContent = modeMeta?.label || mode;
    }

    if (tutorialBtn) {
      // Speaking modes keep the pill in every mode so their chrome stays
      // identical; where no interactive tutorial exists yet it shows in a
      // disabled, honest state. Every other skill keeps the original
      // behaviour of hiding the pill when the mode has no tutorial.
      const showPill = hasTutorial || SPEAKING_MODES.includes(mode);
      tutorialBtn.hidden = !showPill;
      tutorialBtn.style.display = showPill ? '' : 'none';
      tutorialBtn.disabled = !hasTutorial;
      tutorialBtn.setAttribute('aria-disabled', hasTutorial ? 'false' : 'true');
      tutorialBtn.title = hasTutorial ? 'Learn about this mode' : 'Tutorial coming soon';
    }
  }

  const speakingModes = SPEAKING_MODES;

  function syncSpeakingPracticeController(mode = currentActiveMode, scope = PracticeScopeManager.getScope(), leavingMode = null) {
    const controller = window.SpeakingPracticeController;
    if (!controller || !mode || typeof controller.activate !== 'function') return;

    if (leavingMode && leavingMode !== mode && speakingModes.includes(leavingMode)) {
      if (typeof controller.unmount === 'function') {
        controller.unmount(leavingMode);
      }
    }

    if (typeof controller.isV2Active === 'function' && controller.isV2Active(mode, scope)) {
      controller.activate(mode, { scope });
    } else if (typeof controller.unmount === 'function') {
      controller.unmount(mode);
    }
  }

  PracticeScopeManager.subscribe((scope) => {
    if (currentActiveMode) {
      syncSpeakingPracticeController(currentActiveMode, scope);
    }
  });

  // Expose for external use
  window.updateCurrentModeIndicator = updateCurrentModeIndicator;

  // Event listener for mode tutorial button
  document.addEventListener('DOMContentLoaded', () => {
    const tutorialBtn = document.getElementById('mode-tutorial-btn');
    if (tutorialBtn) {
      tutorialBtn.addEventListener('click', () => {
        if (getModeMeta(currentActiveMode)?.hasTutorial && typeof window.startTutorial === 'function') {
          window.startTutorial(currentActiveMode, true);
        }
      });
    }
  });

  // Global Mode Recommendation Functions
  window.showModeRecommendation = function () {
    const modal = document.getElementById('mode-helper-modal');
    if (modal) {
      resetGoalModalState(); // Always open in clean state
      modal.style.display = 'flex';
    }
  };

  // Goal to modes mapping with descriptions
  const goalToModesMap = {
    'spelling': {
      modes: ['type', 'collo-dictate'],
      description: 'Write exactly what you hear to sharpen your spelling and collocations.',
      icon: '⌨️'
    },
    'speaking': {
      modes: ['speak', 'read-aloud'],
      description: 'Practice speaking full sentences with speech recognition.',
      icon: '🎤'
    },
    'accent': {
      modes: ['pronounce'],
      description: 'Get detailed phoneme-level feedback on your pronunciation.',
      icon: '🗣️'
    },
    'fluency': {
      modes: ['read-aloud'],
      description: 'Read passages aloud to build fluency and natural rhythm.',
      icon: '📖'
    },
    'collocations': {
      modes: ['collo-dictate'],
      description: 'Listen and type common word combinations to sound more natural.',
      icon: '🔗'
    },
    'vocabulary': {
      modes: ['extended', 'rfib'],
      description: 'Fill in blanks to reinforce vocabulary in context.',
      icon: '📝'
    },
    'reading': {
      modes: ['rfib'],
      description: 'Read academic passages and choose the best word for each blank.',
      icon: '📚'
    },
    'notetaking': {
      modes: ['notes'],
      description: 'Listen to lectures and practice capturing key points.',
      icon: '📓'
    }
  };

  // Selected mode to start (set when suggestions are shown)
  let selectedModeToStart = null;

  /**
   * Handle goal selection submit - shows suggestions, doesn't navigate directly
   * Maximum 2 goals can be selected
   */
  window.handleGoalSubmit = function () {
    const checkboxes = document.querySelectorAll('#mode-helper-modal input[name="goal"]:checked');
    const selectedGoals = Array.from(checkboxes).map(cb => cb.value);

    if (selectedGoals.length === 0) {
      // Visual feedback: shake the button
      const submitBtn = document.getElementById('mode-helper-submit-btn');
      if (submitBtn) {
        submitBtn.classList.add('shake');
        setTimeout(() => submitBtn.classList.remove('shake'), 500);
      }
      return;
    }

    if (selectedGoals.length > 2) {
      // Should not happen due to checkbox limit, but safety check
      alert('Please select at most 2 goals.');
      return;
    }

    // Generate suggestions based on selected goals
    const suggestions = [];
    const seenModes = new Set();

    selectedGoals.forEach(goal => {
      const mapping = goalToModesMap[goal];
      if (mapping) {
        mapping.modes.forEach(mode => {
          if (!isModeVisibleInScope(mode)) return;
          if (!seenModes.has(mode)) {
            seenModes.add(mode);
            suggestions.push({
              mode: mode,
              name: getModeDisplayName(mode),
              description: mapping.description,
              icon: mapping.icon
            });
          }
        });
      }
    });

    if (suggestions.length === 0) {
      const fallbackMode = 'read-aloud';
      if (isModeVisibleInScope(fallbackMode)) {
        suggestions.push({
          mode: fallbackMode,
          name: getModeDisplayName(fallbackMode),
          description: 'Recommended in this practice scope.',
          icon: '⭐'
        });
      }
    }

    // Set the first mode as default to start
    selectedModeToStart = suggestions.length > 0 ? suggestions[0].mode : 'type';

    // Render suggestions
    const suggestionsContainer = document.getElementById('mode-suggestions-list');
    if (suggestionsContainer) {
      suggestionsContainer.innerHTML = suggestions.map((s, index) => `
        <label class="suggestion-item ${index === 0 ? 'selected' : ''}">
          <input type="radio" name="suggested-mode" value="${s.mode}" ${index === 0 ? 'checked' : ''}>
          <div class="suggestion-content">
            <span class="suggestion-icon">${s.icon}</span>
            <div class="suggestion-text">
              <strong>${s.name}</strong>
              <span>${s.description}</span>
            </div>
          </div>
        </label>
      `).join('');

      // Add change listeners to update selectedModeToStart
      suggestionsContainer.querySelectorAll('input[name="suggested-mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
          selectedModeToStart = e.target.value;
          // Update visual selection
          suggestionsContainer.querySelectorAll('.suggestion-item').forEach(item => {
            item.classList.toggle('selected', item.querySelector('input').checked);
          });
        });
      });
    }

    // Switch to suggestions step
    setGoalModalStep('suggestions');
  };

  /**
   * Go back from suggestions to goal selection
   */
  function handleSuggestionsBack() {
    setGoalModalStep('goals');
  }

  /**
   * Start learning with the selected mode
   */
  function handleStartLearning() {
    const modal = document.getElementById('mode-helper-modal');
    if (modal) modal.style.display = 'none';

    // Capture mode before reset
    const modeToStart = selectedModeToStart;

    // Reset modal state for next time
    resetGoalModalState();

    // Switch to the selected mode
    if (modeToStart) {
      window.switchToMode(modeToStart);

      // Optional: Start tutorial for that mode
      if (typeof window.startTutorial === 'function') {
        setTimeout(() => {
          window.startTutorial(modeToStart, false);
        }, 500);
      }
    }
  }

  // Legacy function - kept for backward compatibility but no longer called directly
  window.handleModeSelection = function (goal) {
    // Now we use the multi-choice flow, but keep this for any external calls
    const modal = document.getElementById('mode-helper-modal');
    if (modal) modal.style.display = 'none';

    let targetMode = 'type';
    switch (goal) {
      case 'spelling': targetMode = 'type'; break;
      case 'speaking': targetMode = 'speak'; break;
      case 'accent': targetMode = 'pronounce'; break;
      case 'vocabulary': targetMode = 'extended'; break;
      case 'notetaking': targetMode = 'notes'; break;
      case 'listening': targetMode = 'watch'; break;
    }

    window.switchToMode(targetMode);
  };

  async function ensureModeAssets(mode) {
    if (!['watch', 'notes', 'rfib', 'rmcsa', 'rmcma', 'rop', 'dd', 'lmcma', 'lmcsa', 'hcs', 'smw', 'hiw', 'sst'].includes(mode)) return true;
    if (!window.BELLazyLoader || typeof window.BELLazyLoader.ensureModeScripts !== 'function') {
      return true;
    }

    try {
      await window.BELLazyLoader.ensureModeScripts(mode);
      return true;
    } catch (error) {
      console.error(`[switchToMode] Failed to load ${mode} assets:`, error);
      window.shopModule?.showAlertModal?.(
        `Could not load ${mode} mode right now. Please check your connection and try again.`,
        true
      );
      return false;
    }
  }

  window.exitCurrentMode = async function() {
    const leavingMode = currentActiveMode;
    if (leavingMode === 'essay') {
      if (window.WriteEssayMode?.shouldConfirmExit?.()) {
        const confirmed = await window.showCustomConfirm(
          'Leave Write Essay?',
          'Leaving Write Essay will discard your current draft. Continue?',
          true
        );
        if (!confirmed) return false;
      }
      window.WriteEssayMode?.onExit?.();
    }
    if (leavingMode === 'swt') {
      if (window.SWTMode?.shouldConfirmExit?.()) {
        const confirmed = await window.showCustomConfirm(
          'Leave Summarize Written Text?',
          'Leaving Summarize Written Text will discard your current draft. Continue?',
          true
        );
        if (!confirmed) return false;
      }
      window.SWTMode?.onExit?.();
    }
    if (leavingMode === 'sst') {
      if (window.SSTMode?.shouldConfirmExit?.()) {
        const confirmed = await window.showCustomConfirm(
          'Leave Summarize Spoken Text?',
          'Leaving Summarize Spoken Text will discard your current attempt. Continue?',
          true
        );
        if (!confirmed) return false;
      }
      window.SSTMode?.onExit?.();
    }
    if (leavingMode === 'dd') {
      if (window.DDMode?.shouldConfirmExit?.()) {
        const confirmed = await window.showCustomConfirm(
          'Leave Drag & Drop?',
          'Leaving Drag & Drop will discard your current attempt. Continue?',
          true
        );
        if (!confirmed) return false;
      }
      window.DDMode?.onExit?.();
    }
    if (leavingMode === 'read-aloud') window.ReadAloudMode?.onExit?.();
    if (leavingMode === 'notes') window.TakeNotesMode?.onExit?.();
    // TODO: if (leavingMode === 'speak') window.SpeakMode?.onExit?.();
    if (leavingMode === 'collo-dictate') window.ColloDictateMode?.onExit?.();
    if (leavingMode === 'asq') window.ASQMode?.onExit?.();
    if (leavingMode === 'sgd') window.SGDMode?.onExit?.();
    if (leavingMode === 'describe-image') window.DescribeImageMode?.onExit?.();
    if (leavingMode === 'rts') window.RTSMode?.onExit?.();
    if (leavingMode === 'rmcsa') window.RMCSAMode?.onExit?.();
    if (leavingMode === 'rmcma') window.RMCMAMode?.onExit?.();
    if (leavingMode === 'lmcma') window.LMCMAMode?.onExit?.();
    if (leavingMode === 'lmcsa') window.LMCSAMode?.onExit?.();
    if (leavingMode === 'hcs') window.HCSMode?.onExit?.();
    if (leavingMode === 'smw') window.SMWMode?.onExit?.();
    if (leavingMode === 'hiw') window.HIWMode?.onExit?.();
    if (leavingMode === 'rop') window.ROPMode?.onExit?.();

    modeTransitionToken += 1;
    if (leavingMode && window.SpeakingPracticeController?.unmount) {
      window.SpeakingPracticeController.unmount(leavingMode);
    }

    // Hide all mode panels
    document.querySelectorAll('.mode-panel').forEach(panel => {
      panel.classList.remove('active');
      panel.style.display = 'none';
    });
    
    // Show the dashboard again
    const dashboard = document.querySelector('.dashboard-modern-container');
    if (dashboard) {
      dashboard.style.display = 'block';
    }
    
    // Hide indicator and back button
    const indicator = document.getElementById('current-mode-indicator');
    if (indicator) indicator.style.display = 'none';
    const backBtn = document.getElementById('back-to-dashboard-btn');
    if (backBtn) backBtn.style.display = 'none';
    
    currentActiveMode = '';
    window.appState.currentMode = '';
    
    // Deselect tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.mode-switch-btn').forEach(btn => {
      btn.classList.remove('is-active');
      btn.setAttribute('aria-pressed', 'false');
    });

    // Update URL for browser back/forward navigation
    PracticeRouter.pushRoute(null);
    return true;
  };

  /**
   * Switch to a specific practice mode
   * Called by Learning Center mode buttons
   * @param {string} mode - 'type', 'speak', 'extended', 'watch', 'notes', 'pronounce'
   */
  window.switchToMode = async function (mode) {
    if (!mode) return;

    const transitionToken = ++modeTransitionToken;
    const isCurrentTransition = () => transitionToken === modeTransitionToken;
    const leavingMode = currentActiveMode;
    if (leavingMode === 'essay' && mode !== 'essay') {
      if (window.WriteEssayMode?.shouldConfirmExit?.()) {
        const confirmed = await window.showCustomConfirm(
          'Leave Write Essay?',
          'Leaving Write Essay will discard your current draft. Continue?',
          true
        );
        if (!isCurrentTransition()) return false;
        if (!confirmed) return false;
      }
      window.WriteEssayMode?.onExit?.();
    }
    if (leavingMode === 'collo-dictate' && mode !== 'collo-dictate') {
      window.ColloDictateMode?.onExit?.();
    }
    if (leavingMode === 'asq' && mode !== 'asq') {
      window.ASQMode?.onExit?.();
    }
    if (leavingMode === 'sgd' && mode !== 'sgd') {
      window.SGDMode?.onExit?.();
    }
    if (leavingMode === 'describe-image' && mode !== 'describe-image') {
      window.DescribeImageMode?.onExit?.();
    }
    if (leavingMode === 'swt' && mode !== 'swt') {
      if (window.SWTMode?.shouldConfirmExit?.()) {
        const confirmed = await window.showCustomConfirm(
          'Leave Summarize Written Text?',
          'Leaving Summarize Written Text will discard your current draft. Continue?',
          true
        );
        if (!isCurrentTransition()) return false;
        if (!confirmed) return false;
      }
      window.SWTMode?.onExit?.();
    }
    if (leavingMode === 'sst' && mode !== 'sst') {
      if (window.SSTMode?.shouldConfirmExit?.()) {
        const confirmed = await window.showCustomConfirm(
          'Leave Summarize Spoken Text?',
          'Leaving Summarize Spoken Text will discard your current attempt. Continue?',
          true
        );
        if (!isCurrentTransition()) return false;
        if (!confirmed) return false;
      }
      window.SSTMode?.onExit?.();
    }
    if (leavingMode === 'rts' && mode !== 'rts') {
      window.RTSMode?.onExit?.();
    }
    if (leavingMode === 'rmcsa' && mode !== 'rmcsa') {
      window.RMCSAMode?.onExit?.();
    }
    if (leavingMode === 'rmcma' && mode !== 'rmcma') {
      window.RMCMAMode?.onExit?.();
    }
    if (leavingMode === 'lmcma' && mode !== 'lmcma') {
      window.LMCMAMode?.onExit?.();
    }
    if (leavingMode === 'lmcsa' && mode !== 'lmcsa') {
      window.LMCSAMode?.onExit?.();
    }
    if (leavingMode === 'hcs' && mode !== 'hcs') {
      window.HCSMode?.onExit?.();
    }
    if (leavingMode === 'smw' && mode !== 'smw') {
      window.SMWMode?.onExit?.();
    }
    if (leavingMode === 'hiw' && mode !== 'hiw') {
      window.HIWMode?.onExit?.();
    }
    if (leavingMode === 'rop' && mode !== 'rop') {
      window.ROPMode?.onExit?.();
    }
    if (leavingMode === 'dd' && mode !== 'dd') {
      if (window.DDMode?.shouldConfirmExit?.()) {
        const confirmed = await window.showCustomConfirm(
          'Leave Drag & Drop?',
          'Leaving Drag & Drop will discard your current attempt. Continue?',
          true
        );
        if (!isCurrentTransition()) return false;
        if (!confirmed) return false;
      }
      window.DDMode?.onExit?.();
    }
    if (leavingMode === 'read-aloud' && mode !== 'read-aloud') {
      window.ReadAloudMode?.onExit?.();
    }
    if (leavingMode === 'notes' && mode !== 'notes') {
      window.TakeNotesMode?.onExit?.();
    }
    // TODO: if (leavingMode === 'speak' && mode !== 'speak') {
    //   window.SpeakMode?.onExit?.();
    // }

    if (leavingMode && leavingMode !== mode && window.SpeakingPracticeController?.unmount) {
      window.SpeakingPracticeController.unmount(leavingMode);
    }

    // Sync Adaptive UI state upon switching
    if (typeof window.updateAdaptiveUI === 'function') {
      window.updateAdaptiveUI(mode);
    }

    syncSelectedSkillToMode(mode);

    // Try to cleanup previous mode (safe if it doesn't exist)
    if (mode === 'survival') {
      if (typeof window.ensureSurvivalGameLoaded === 'function') {
        try {
          await window.ensureSurvivalGameLoaded();
          if (!isCurrentTransition()) return false;
        } catch (error) {
          console.error('Survival Game module failed to load:', error);
          window.shopModule?.showAlertModal?.('Survival game could not load. Please try again.', true);
          return;
        }
      }

      if (window.openSurvivalGame) {
        window.openSurvivalGame();
      } else {
        console.error('Survival Game module not loaded or initialized. Please try again in a few seconds.');
        if (window.shopModule && window.shopModule.showAlertModal) {
          window.shopModule.showAlertModal('Survival game is still loading. Please wait a moment.', true);
        }
      }
      return;
    }

    if (mode === 'watch' || mode === 'notes' || mode === 'rfib' || mode === 'rmcsa' || mode === 'rmcma' || mode === 'rop' || mode === 'dd' || mode === 'lmcma' || mode === 'lmcsa' || mode === 'hcs' || mode === 'smw' || mode === 'hiw' || mode === 'sst') {
      const assetsReady = await ensureModeAssets(mode);
      if (!assetsReady) return;
    }
    if (!isCurrentTransition()) return false;

    // Map mode names to tab IDs and panel IDs
    const tabId = 'tab-' + mode;
    const panelId = 'mode-' + mode;

    // RESTORE LAYOUT (Fixing blank screen after survival mode)
    // Skip on Reading Journey hidden route (it intentionally hides the main app wrapper).
    const normalizedPath = (window.location.pathname || '/').replace(/\/+$/, '');
    const isReadingJourneyRoute = normalizedPath === '/readingjourney';
    if (!isReadingJourneyRoute) {
      const pageWrapper = document.getElementById('page-layout-wrapper');
      if (pageWrapper && pageWrapper.style.display === 'none') {
        pageWrapper.style.display = 'block';
      }
    }

    // CLOSE SURVIVAL OVERLAY IF OPEN
    const survivalOverlay = document.getElementById('survival-game-overlay');
    const survivalOverlayVisible = !!(survivalOverlay && survivalOverlay.style.display !== 'none');
    if (survivalOverlayVisible && mode !== 'survival') {
      survivalOverlay.style.display = 'none';
      survivalOverlay.style.visibility = 'hidden';
      if (window.survivalGame && typeof window.survivalGame.stop === 'function') {
        window.survivalGame.stop();
      } else {
        document.body.classList.remove('survival-active');
      }
    }

    const tabBtn = document.getElementById(tabId);
    const modePanel = document.getElementById(panelId);

    if (tabBtn && modePanel) {
      // 1. Update tab button active states
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      tabBtn.classList.add('active');

      // 2. Hide all mode panels. Speaking modes stay hidden until their async
      // initialization and shared controller have both completed so a legacy
      // panel cannot flash before the new controller is mounted.
      const deferSelectedPanelReveal = speakingModes.includes(mode);
      document.querySelectorAll('.mode-panel').forEach(panel => {
        panel.classList.remove('active');
        panel.style.display = 'none';
        delete panel.dataset.modePreparing;
      });
      if (deferSelectedPanelReveal) {
        modePanel.dataset.modePreparing = 'true';
      } else {
        modePanel.classList.add('active');
        modePanel.style.display = 'block';
      }

      // 2.1 Hide Dashboard so it doesn't overlap
      const dashboard = document.querySelector('.dashboard-modern-container');
      if (dashboard) {
        dashboard.style.display = 'none';
      }

      // 3. Update mode-switch-btn active states in Learning Center
      document.querySelectorAll('.mode-switch-btn').forEach(btn => {
        const isSelected = btn.id === 'mode-btn-' + mode;
        btn.classList.toggle('is-active', isSelected);
        btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      });

      // 4. Update current mode indicator
      updateCurrentModeIndicator(mode);

      // HANDLE WATCH MODE CLEANUP/RESTORE
      const pageWrapper = document.getElementById('page-layout-wrapper');
      const watchQuestionPanel = document.getElementById('watch-question-panel');

      if (mode !== 'watch') {
        // Switching AWAY from Watch Mode
        // 1. Remove the side-by-side layout class
        if (pageWrapper) pageWrapper.classList.remove('watch-active');

        // 2. Explicitly hide the watch question panel (popup)
        if (watchQuestionPanel) watchQuestionPanel.style.display = 'none';

        // 3. Pause video to prevent background playback
        if (window.WatchMode && typeof window.WatchMode.pauseAndResetForTabSwitch === 'function') {
          window.WatchMode.pauseAndResetForTabSwitch();
        }
      } else {
        // Switching TO Watch Mode
        // 1. Initialize logic
        if (window.WatchMode && typeof window.WatchMode.init === 'function') {
          window.WatchMode.init();
        }

        // 2. Restore layout if video was active
        if (window.WatchMode && typeof window.WatchMode.refreshLayout === 'function') {
          window.WatchMode.refreshLayout();
        }
      }

      // NEW: Clear any existing results/animations from previous sessions/modes
      // This ensures switching from Type to Speak (or vice versa) cleans up the UI
      if (typeof resetScaffolding === 'function') {
        resetScaffolding();
      }

      // 4. Trigger any mode-specific initialization
      if (mode === 'extended' && typeof window.loadExtendedIfNeeded === 'function') {
        window.loadExtendedIfNeeded();
      } else if (mode === 'rfib' && window.RFIBMode && typeof window.RFIBMode.activate === 'function') {
        await window.RFIBMode.activate();
      } else if (mode === 'type' && typeDatabase.length > 0) {
        log.log(`[switchToMode] Switching to Type mode, reloading question ${currentTypeQuestionId}`);
        await loadQuestion('type', currentTypeQuestionId);
      } else if (mode === 'collo-dictate' && typeof window.ColloDictateMode?.onEnter === 'function') {
        await window.ColloDictateMode.onEnter();
      } else if (mode === 'sgd' && typeof window.SGDMode?.onEnter === 'function') {
        await window.SGDMode.onEnter();
      } else if (mode === 'speak' && speakDatabase.length > 0) {
        log.log(`[switchToMode] Switching to Speak mode, reloading question ${currentSpeakQuestionId}`);
        await loadQuestion('speak', currentSpeakQuestionId);
      } else if (mode === 'notes' && window.TakeNotesMode && typeof window.TakeNotesMode.loadEntries === 'function') {
        await window.TakeNotesMode.loadEntries();
      } else if (mode === 'rmcsa' && window.RMCSAMode && typeof window.RMCSAMode.activate === 'function') {
        await window.RMCSAMode.activate();
      } else if (mode === 'rmcma' && window.RMCMAMode && typeof window.RMCMAMode.activate === 'function') {
        await window.RMCMAMode.activate();
      } else if (mode === 'lmcma' && window.LMCMAMode && typeof window.LMCMAMode.activate === 'function') {
        await window.LMCMAMode.activate();
      } else if (mode === 'lmcsa' && window.LMCSAMode && typeof window.LMCSAMode.activate === 'function') {
        await window.LMCSAMode.activate();
      } else if (mode === 'hcs' && window.HCSMode && typeof window.HCSMode.activate === 'function') {
        await window.HCSMode.activate();
      } else if (mode === 'smw' && window.SMWMode && typeof window.SMWMode.activate === 'function') {
        await window.SMWMode.activate();
      } else if (mode === 'sst' && window.SSTMode && typeof window.SSTMode.activate === 'function') {
        await window.SSTMode.activate();
      } else if (mode === 'hiw' && window.HIWMode && typeof window.HIWMode.activate === 'function') {
        await window.HIWMode.activate();
      } else if (mode === 'rop' && window.ROPMode && typeof window.ROPMode.activate === 'function') {
        await window.ROPMode.activate();
      } else if (mode === 'dd' && window.DDMode && typeof window.DDMode.activate === 'function') {
        await window.DDMode.activate();
      } else if (mode === 'essay' && window.WriteEssayMode) {
        if (typeof window.WriteEssayMode.onEnter === 'function') {
          window.WriteEssayMode.onEnter();
        } else if (typeof window.WriteEssayMode.init === 'function') {
          window.WriteEssayMode.init();
        }
      } else if (mode === 'read-aloud') {
        // Hide the type-mode question box that bleeds through
        const typeQuestionBox = document.getElementById('mode-type');
        if (typeQuestionBox) typeQuestionBox.style.display = 'none';
        // Trigger ReadAloud mode init
        if (window.ReadAloudMode && typeof window.ReadAloudMode.onEnter === 'function') {
          await window.ReadAloudMode.onEnter();
        }
      } else if (mode === 'asq') {
        if (window.ASQMode && typeof window.ASQMode.onEnter === 'function') {
          await window.ASQMode.onEnter();
        }
      } else if (mode === 'describe-image') {
        if (window.DescribeImageMode && typeof window.DescribeImageMode.onEnter === 'function') {
          await window.DescribeImageMode.onEnter();
        }
      } else if (mode === 'swt') {
        if (window.SWTMode && typeof window.SWTMode.onEnter === 'function') {
          await window.SWTMode.onEnter();
        }
      } else if (mode === 'rts') {
        if (window.RTSMode && typeof window.RTSMode.onEnter === 'function') {
          await window.RTSMode.onEnter();
        }
      }

      if (!isCurrentTransition()) return false;

      syncSpeakingPracticeController(mode, PracticeScopeManager.getScope(), leavingMode);

      if (deferSelectedPanelReveal) {
        modePanel.classList.add('active');
        modePanel.style.display = 'block';
        delete modePanel.dataset.modePreparing;
      }

      // 5. Check if this is the first time using this mode - trigger tutorial
      const firstTimeKey = `${mode}ModeFirstUse`;
      const hasUsedBefore = localStorage.getItem(firstTimeKey);

      if (!hasUsedBefore) {
        // Mark as used
        localStorage.setItem(firstTimeKey, 'true');

        // Trigger tutorial after a short delay for UI to settle
        if (getModeMeta(mode)?.hasTutorial) {
          setTimeout(() => {
            if (typeof window.startTutorial === 'function') {
              window.startTutorial(mode, false); // Not forced, but first-time
            }
          }, 500);
        }
      }

      // 6. Force Layout Re-check (Self-correction)
      // This ensures that even if some other script tries to show a panel, we force hide it
      setTimeout(() => {
        if (!isCurrentTransition()) return;
        document.querySelectorAll('.mode-panel').forEach(panel => {
          if (panel.id !== panelId) {
            panel.style.display = 'none';
            panel.classList.remove('active');
          } else {
            panel.style.display = 'block';
            panel.classList.add('active');
          }
        });
      }, 50);

      // 7. Update URL for browser back/forward navigation. Preserve a
      // question ID that was supplied by a deep link while the mode finishes
      // its asynchronous initialization; the mode will replace it after it
      // has selected the matching entry.
      const currentRoute = PracticeRouter.parseRoute(window.location.pathname);
      const currentQuestionId = currentRoute?.mode === mode ? currentRoute.questionId : null;
      PracticeRouter.pushRoute(mode, currentQuestionId);
    }
  };

  /**
   * Refresh locked state of tabs based on user's unlocked modes
   * Called on login and periodically
   */
  window.refreshLockedTabs = async function () {
    // If shop module not loaded yet, wait a bit
    if (!window.shopModule) {
      setTimeout(window.refreshLockedTabs, 500);
      return;
    }

    await window.shopModule.refreshUserData();

    // List of tabs to check
    const tabs = [
      { id: 'speak', element: document.getElementById('tab-speak'), mode: 'speak' },
      { id: 'extended', element: document.getElementById('tab-extended'), mode: 'extended' },
      { id: 'watch', element: document.getElementById('tab-watch'), mode: 'watch' },
      { id: 'notes', element: document.getElementById('tab-notes'), mode: 'notes' },
      { id: 'pronounce', element: document.getElementById('tab-pronounce'), mode: 'pronounce' }
    ];

    tabs.forEach(tab => {
      if (!tab.element) return;

      const isUnlocked = true; // All core practice modes are now always available
      if (!isUnlocked) {
        tab.element.classList.add('locked');
      } else {
        tab.element.classList.remove('locked');
      }
    });

    updateActiveSkillControlLocks();
  };

  // refresh on load
  document.addEventListener('DOMContentLoaded', () => {
    // Initialize Difficulty Manager
    if (window.DifficultyManager) {
      window.DifficultyManager.init();
    }

    // Initialize Performance Trackers
    if (window.PerformanceTracker) {
      window.typePerformanceTracker = new PerformanceTracker('type');
      window.speakPerformanceTracker = new PerformanceTracker('speak');
      window.extendedPerformanceTracker = new PerformanceTracker('extended');
      window.notesPerformanceTracker = new PerformanceTracker('notes');
    }

    // Initialize shop module
    if (window.shopModule && window.shopModule.init) {
      window.shopModule.init();
    }
    window.refreshLockedTabs();
    window.refreshLengthFilterLocks();
    updateActiveSkillControlLocks();
    maybeEnableAsqModeInLauncher();
  });

  /**
   * Refresh locked state of Length Filter dropdown options
   * Removes lock icons if feature is unlocked
   */
  function isLengthFilterUnlocked(profile = null) {
    const p = profile && typeof profile === 'object'
      ? profile
      : (window.currentUserProfile && typeof window.currentUserProfile === 'object' ? window.currentUserProfile : null);

    const unlockedBySkillTree = !!(p?.unlockedSkills?.length_filter || p?.skillPassives?.length_filter);
    if (unlockedBySkillTree) return true;

    return !!window.shopModule?.isModeUnlocked?.('lengthFilter');
  }

  window.refreshLengthFilterLocks = function () {
    // If shop module not loaded yet, retry shortly
    if (!window.shopModule) {
      setTimeout(window.refreshLengthFilterLocks, 500);
      return;
    }

    const isUnlocked = isLengthFilterUnlocked();

    // Select all length filter menus (Type and Speak modes)
    const menus = document.querySelectorAll('#length-filter-menu-type, #length-filter-menu-speak');

    menus.forEach(menu => {
      const lockOptions = menu.querySelectorAll('.filter-option[data-locked="true"]');
      lockOptions.forEach(option => {
        if (isUnlocked) {
          // Unlock visual state
          option.removeAttribute('data-locked');
          option.classList.remove('locked');

          // Remove lock icon if present (assumes icon is inside option text or appended)
          // Based on user image, it might be a specific element or CSS class
          const lockIcon = option.querySelector('.lock-icon') || option.querySelector('span[role="img"][aria-label="locked"]'); // Adjust selector as needed based on actual HTML
          if (lockIcon) lockIcon.remove();

          // Fallback: Remove unicode lock if direct text content
          // This is safer if structure is unknown; ideally we toggle a class
          option.classList.add('unlocked-feature');
        } else {
          // Ensure locked state is present if locked (re-locking usually irrelevant but good for correctness)
          option.setAttribute('data-locked', 'true');
        }
      });
    });
  };

  // Listen for shop unlock events to update UI immediately
  window.addEventListener('shop-unlock', (e) => {
    if (e.detail && e.detail.mode === 'lengthFilter') {
      window.refreshLengthFilterLocks();
      const userId = window.authUI?.getCurrentUserId?.();
      if (userId) {
        checkFilterUnlockStatus(userId);
      }
    }
    updateActiveSkillControlLocks();
  });
  window.addEventListener('skill-unlock', (e) => {
    if (e.detail && e.detail.skillId === 'length_filter') {
      window.refreshLengthFilterLocks();
      const userId = window.authUI?.getCurrentUserId?.();
      if (userId) {
        checkFilterUnlockStatus(userId);
      }
    }
  });

  // ============================================
  // SCAFFOLDING HELPER FUNCTIONS
  // ============================================

  /**
   * Show an auto-generated hint in the scaffolding panel
   * @param {string} hintType - 'word-count', 'first-letters', 'word-lengths'
   * @param {string} content - HTML content to display
   */
  function showAutoHint(hintType, content) {
    // Feature disabled: Automatic hints removed from UI
    return;
  }

  /**
   * Clear all auto-generated hints
   */
  function clearAutoHints() {
    const container = document.getElementById('auto-hints-type');
    if (container) {
      container.innerHTML = '';
      container.style.display = 'none';
    }
  }

  /**
   * Generate first letters preview as HTML structure
   * @param {string} sentence - The correct sentence
   * @returns {string} - HTML string with structured character slots
   */
  function generateFirstLettersPreview(sentence) {
    const words = sentence.split(/\s+/).filter(Boolean);

    return `<div class="hint-sentence-container">` +
      words.map(word => {
        // Wrap word in container
        return `<span class="hint-word">` +
          word.split('').map((char, index) => {
            // Check if character is a letter
            if (/[a-zA-Z]/.test(char)) {
              if (index === 0) {
                // First letter - revealed
                return `<span class="hint-char revealed">${char}</span>`;
              } else {
                // Other letters - hidden slot
                return `<span class="hint-char hidden"></span>`;
              }
            } else {
              // Punctuation - shown as is
              return `<span class="hint-char punctuation">${char}</span>`;
            }
          }).join('') +
          `</span>`;
      }).join(' ') +
      `</div>`;
  }

  /**
   * Reset scaffolding state when question changes
   * @param {string} mode - 'type' or 'speak'
   */
  function resetScaffoldingState(mode) {
    if (mode === 'type') {
      // Reset replay counter
      window.typeReplayCount = 0;

      // Reset play button state (hidden — new wfd-audio player replaces it visually)
      const playBtn = document.getElementById('play-btn');
      if (playBtn) {
        playBtn.disabled = false;
        playBtn.style.display = 'none';
        playBtn.title = 'Play audio';
      }

      // Reset replay counter badge
      const replayBadge = document.getElementById('replay-counter-type');
      if (replayBadge) {
        if (window.DifficultyManager) {
          const settings = window.DifficultyManager.getCurrentSettings('type');
          const max = settings.maxReplays;
          // Infinity check for Level 1
          if (max === Infinity) {
            replayBadge.textContent = '🔊 Unlimited';
          } else {
            replayBadge.textContent = `🔊 ${max} times left`;
          }
          replayBadge.style.display = 'inline-block';
        } else {
          replayBadge.textContent = '';
          replayBadge.style.display = 'none';
        }
        replayBadge.classList.remove('limit-reached');
      }

      // Reset Hint System
      if (window.HintSystem) {
        window.HintSystem.reset();
      }

      // Clear auto hints container
      const autoHints = document.getElementById('auto-hints-type');
      if (autoHints) {
        autoHints.innerHTML = '';
        autoHints.style.display = 'none';
      }

      // Reset hint controls visibility (Level 1 Scaffolding Conflict Resolution)

      // Clear auto hints
      clearAutoHints();
    } else if (mode === 'speak') {
      window.speakReplayCount = 0;

      const playBtnSpeak = document.getElementById('play-btn-speak');
      if (playBtnSpeak) {
        playBtnSpeak.disabled = false;
        playBtnSpeak.style.display = 'inline-block';
        playBtnSpeak.title = 'Play audio';
      }

      const replayBadgeSpeak = document.getElementById('replay-counter-speak');
      if (replayBadgeSpeak) {
        if (window.DifficultyManager) {
          const settings = window.DifficultyManager.getCurrentSettings('speak');
          const max = settings.maxReplays;
          replayBadgeSpeak.textContent = `🔊 ${max} times left`;
          replayBadgeSpeak.style.display = 'inline-block';
        } else {
          replayBadgeSpeak.textContent = '';
          replayBadgeSpeak.style.display = 'none';
        }
        replayBadgeSpeak.classList.remove('limit-reached');
      }
    }
  }

  // Expose for external use
  window.resetScaffoldingState = resetScaffoldingState;

  // ============================================
  // WORD SCAFFOLDING PANEL (Figma Design)
  // ============================================

  /**
   * Show word scaffolding panel (Figma design)
   * @param {string} sentence - The correct sentence to hint
   * @param {string} mode - 'type' or 'speak' (default: 'type')
   */
  function showLetterHints(sentence, mode = 'type') {
    // Feature disabled: Hint box removed from UI
    return;
  }

  /**
   * Hide word scaffolding panel
   * @param {string} mode - 'type' or 'speak' (default: 'type')
   */
  function hideLetterHints(mode = 'type') {
    // If no mode specified, hide both to be safe, or just the requested one
    const containerId = `scaffolding-hints-${mode}`;
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = '';
      container.style.display = 'none';
    }
  }

  /**
   * Reveal the next hidden letter hint
   * @param {string} mode - 'type' or 'speak' (default: 'type')
   */
  function revealNextHint(mode = 'type') {
    const containerId = `scaffolding-hints-${mode}`;
    const hiddenBoxes = document.querySelectorAll(`#${containerId} .letter-box.hidden`);

    if (hiddenBoxes.length > 0) {
      // Find the correct sentence to get the actual letter
      // Determine sentence variable based on mode
      const correctSentence = mode === 'speak' ? window.correctSentenceSpeak : window.correctSentenceType;

      if (correctSentence) {
        const allBoxes = document.querySelectorAll(`#${containerId} .letter-box`);
        let letterIndex = 0;
        const sentence = correctSentence.replace(/[^a-zA-Z]/g, '');

        for (const box of allBoxes) {
          if (box.classList.contains('hidden')) {
            const char = sentence[letterIndex] || '';
            box.textContent = (letterIndex === 0) ? char.toUpperCase() : char.toLowerCase();
            box.classList.remove('hidden');
            box.classList.add('revealed');

            // Update hints used
            window.scaffoldingHintsUsed = (window.scaffoldingHintsUsed || 2) + 1;
            updateHintsDisplay(mode);
            break;
          }
          if (box.classList.contains('revealed') || box.classList.contains('hidden')) {
            letterIndex++;
          }
        }
      }
    }
  }

  /**
   * Update the hints display in footer
   * @param {string} mode - 'type' or 'speak'
   */
  function updateHintsDisplay(mode = 'type') {
    const MAX_CLICKS = 7;
    const remaining = Math.max(0, MAX_CLICKS - window.manualHintsUsedCount);
    const counterEl = document.getElementById(`hint-click-counter-${mode}`);
    if (counterEl) {
      counterEl.textContent = remaining;
    }
  }

  // Expose for external use
  window.showLetterHints = showLetterHints;
  window.hideLetterHints = hideLetterHints;
  window.revealNextHint = revealNextHint;
  window.revealClickedLetter = revealClickedLetter; // Expose new function

  /**
   * Handle click on hidden letter hint
   * @param {HTMLElement} element - The clicked letter box element
   */
  function revealClickedLetter(element) {
    // Safety checks
    if (!element || !element.classList.contains('hidden')) return;

    // Check limit (7 clickables per attempt)
    const MAX_CLICKS = 7;
    if (window.manualHintsUsedCount >= MAX_CLICKS) {
      // Optional: Visual feedback that limit is reached
      element.style.transform = 'translateX(2px)';
      setTimeout(() => element.style.transform = '', 100);
      return;
    }

    // Reveal the letter
    const letter = element.getAttribute('data-letter');
    if (letter) {
      element.textContent = letter;
      element.classList.remove('hidden');
      element.classList.add('revealed');

      // Remove click handler logic
      element.onclick = null;
      element.style.cursor = 'default';

      // Increment counter
      window.manualHintsUsedCount = (window.manualHintsUsedCount || 0) + 1;

      // Update UI counter
      // Infer mode from parent
      const parentContainer = element.closest('.scaffolding-letter-hints');
      let mode = 'type';
      if (parentContainer && parentContainer.id.includes('speak')) {
        mode = 'speak';
      }

      updateHintsDisplay(mode);
    }
  }

  /**
   * Load progress data for all questions in a mode
   * Uses Firestore's getAllProgressForMode for efficient batch loading
   * Called when mode changes or on initial load
   * 
   * @param {string} mode - 'type' or 'speak'
   * @returns {Promise<void>}
   */
  async function loadAllProgressForMode(mode) {
    // Guest mode: Do NOT load progress data
    if (window.authUI && window.authUI.isGuestMode && window.authUI.isGuestMode()) {
      progressCache[mode] = {};
      return;
    }

    // Check if Firebase functions are available and user is logged in
    if (!window.firebaseFirestoreFunctions || !window.authUI) {
      progressCache[mode] = {};
      return;
    }

    const userId = window.authUI.getCurrentUserId();
    if (!userId) {
      progressCache[mode] = {};
      return;
    }

    // Validate mode
    if (mode !== 'type' && mode !== 'speak') {
      return;
    }

    try {
      // Use batch loading function from Firestore module
      const result = await window.firebaseFirestoreFunctions.getAllProgressForMode(userId, mode);

      if (result.success) {
        // Store the progress map in cache
        progressCache[mode] = result.progressMap || {};
        log.log(`✓ Loaded progress data for ${mode} mode: `, progressCache[mode]);
      } else {
        log.error(`Error loading progress for ${mode} mode: `, result.error);
        progressCache[mode] = {};
      }
    } catch (error) {
      log.error(`Error loading all progress for ${mode} mode: `, error);
      progressCache[mode] = {};
    }
  }

  // Legacy function alias for backward compatibility
  const loadAllMasteryForMode = loadAllProgressForMode;

  /**
   * Update progress cache for a specific question
   * Called when progress changes (perfect completion or reset)
   * 
   * @param {string|number} questionId - Question ID
   * @param {string} mode - 'type' or 'speak'
   * @param {Object} progressData - { perfectCount, tier, lastCompletedAt }
   */
  function updateProgressCache(questionId, mode, progressData) {
    if (!progressCache[mode]) {
      progressCache[mode] = {};
    }

    progressCache[mode][questionId] = progressData;

    // Refresh the dropdown to reflect the change
    populateQuestionSelect(mode);

    // Update progress bar UI
    updateProgressBarUI(questionId, mode, progressData);

    // Update left panel
    updateProgressPanel(mode);
  }

  // Legacy function for backward compatibility
  function updateMasteryCache(questionId, mode, mastered) {
    const existingData = progressCache[mode]?.[questionId] || { perfectCount: 0, tier: 'none' };
    if (mastered) {
      // Increment is handled elsewhere, this is just for cache update
      updateProgressCache(questionId, mode, {
        ...existingData,
        tier: existingData.tier === 'none' ? 'completed' : existingData.tier
      });
    } else {
      updateProgressCache(questionId, mode, { perfectCount: 0, tier: 'none', lastCompletedAt: null });
    }
  }

  /**
   * Calculate state from attempt status and perfect count
   * 
   * State definitions:
   *   - 'not-started': User has never pressed Check (no attempts)
   *   - 'in-progress': User has attempted but perfectCount < 3
   *   - 'completed': perfectCount 3-5
   *   - 'consolidated': perfectCount 6-8
   *   - 'mastered': perfectCount >= 9
   * 
   * @param {boolean} hasAttempted - Whether user has attempted at least once
   * @param {number} perfectCount - Number of perfect completions
   * @returns {string}
   */
  function calculateState(hasAttempted, perfectCount) {
    if (perfectCount >= 9) return 'mastered';
    if (perfectCount >= 6) return 'consolidated';
    if (perfectCount >= 3) return 'completed';
    if (hasAttempted) return 'in-progress';
    return 'not-started';
  }
  /**
   * Load sentence length data from Excel (2nd sheet)
   * Format: "Length" column has "5-8 words", "9 words", etc.
   *         "Question ID" column has comma-separated question IDs
   */
  async function loadSentenceLengthData() {
    if (sentenceLengthData) return; // Already loaded

    try {
      log.log("Loading sentence length database...");
      const response = await fetch(`/database/type/WFD.xlsx?v=${Date.now()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch database file: ${response.statusText} `);
      }

      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      // Use the SECOND sheet (index 1) if available, otherwise first
      const sheetName = workbook.SheetNames.length > 1 ? workbook.SheetNames[1] : workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error('No sheets found in Excel file');
      }
      const worksheet = workbook.Sheets[sheetName];

      // Convert to JSON
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      // Process data: Map<lengthRange, Set<questionId>>
      // Data format: { "Length": "5-8 words", "Question ID": "1,2,3,4,5..." }
      sentenceLengthData = new Map();

      jsonData.forEach(row => {
        const lengthStr = row['Length'] || '';
        const questionIdStr = String(row['Question ID'] || '');

        // Extract length range from string like "5-8 words" -> "5-8"
        const lengthMatch = lengthStr.match(/^(\d+(?:-\d+)?)/);
        if (!lengthMatch) return;

        const lengthRange = lengthMatch[1]; // e.g., "5-8", "9", "10", "11", "12-15"

        // Parse comma-separated question IDs
        const questionIds = questionIdStr.split(',')
          .map(id => parseInt(id.trim(), 10))
          .filter(id => !isNaN(id) && id > 0);

        if (questionIds.length > 0) {
          sentenceLengthData.set(lengthRange, new Set(questionIds));
        }
      });

      log.log(`✓ Loaded sentence length data: ${sentenceLengthData.size} length ranges.`);
      sentenceLengthData.forEach((ids, range) => {
        log.log(`  - ${range}: ${ids.size} questions`);
      });

      // Refresh list to apply any active filters
      populateQuestionSelect('type');

    } catch (error) {
      log.error("Error loading sentence length database:", error);
      sentenceLengthData = null; // Reset on failure
    }
  }

  /**
   * Load speak mode length data from Excel (RS.xlsx, 2nd sheet)
   * Format: First column has "4-7 words", "8-9 words", etc.
   *         Second column has comma-separated question IDs
   */
  async function loadSpeakLengthData() {
    if (speakLengthData) return; // Already loaded

    try {
      log.debug("Loading speak length database...");
      const response = await fetch(`/database/speak/RS.xlsx?v=${Date.now()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch speak database file: ${response.statusText} `);
      }

      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      // Use the SECOND sheet (index 1) if available, otherwise first
      const sheetName = workbook.SheetNames.length > 1 ? workbook.SheetNames[1] : workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error('No sheets found in RS.xlsx');
      }
      const worksheet = workbook.Sheets[sheetName];

      // Convert to JSON (no headers)  
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      // Process data: Map<lengthRange, Set<questionId>>
      speakLengthData = new Map();

      jsonData.forEach(row => {
        if (!row || row.length < 2) return;

        const lengthStr = String(row[0] || '');
        const questionIdStr = String(row[1] || '');

        // Extract length range from string like "4-7 words" -> "4-7"
        const lengthMatch = lengthStr.match(/^(\d+(?:-\d+)?)/);
        if (!lengthMatch) return;

        const lengthRange = lengthMatch[1]; // e.g., "4-7", "8-9", "10-11", "12-13"

        // Parse comma-separated question IDs
        const questionIds = questionIdStr.split(',')
          .map(id => parseInt(id.trim(), 10))
          .filter(id => !isNaN(id) && id > 0);

        if (questionIds.length > 0) {
          speakLengthData.set(lengthRange, new Set(questionIds));
        }
      });

      log.debug(`✓ Loaded speak length data: ${speakLengthData.size} length ranges.`);
      speakLengthData.forEach((ids, range) => {
        log.debug(`  - ${range}: ${ids.size} questions`);
      });

      // Refresh list to apply any active filters
      populateQuestionSelect('speak');

    } catch (error) {
      log.error("Error loading speak length database:", error);
      speakLengthData = null; // Reset on failure
    }
  }

  /**
   * Filter question IDs by sentence length
   * @param {string} lengthRange - e.g., "5-8", "9", "12-15"
   * @param {string} mode - 'type' or 'speak'
   * @returns {Set<number>|null} Set of valid Question IDs or null if no filter/data
   */
  function getIdsForLengthRange(lengthRange, mode = 'type') {
    const dataSource = mode === 'speak' ? speakLengthData : sentenceLengthData;

    if (!dataSource || !lengthRange || lengthRange === 'all') return null;

    // Direct lookup by range key
    const ids = dataSource.get(lengthRange);

    if (ids && ids.size > 0) {
      log.debug(`Filter by length "${lengthRange}"(${mode}): ${ids.size} questions found`);
      return ids;
    }

    log.debug(`Filter by length "${lengthRange}"(${mode}): no questions found`);
    return new Set(); // Return empty set if not found
  }
  /**
   * Calculate tier from perfect count (legacy, for backward compatibility)
   * 
   * @param {number} perfectCount
   * @returns {string}
   */
  function calculateTier(perfectCount) {
    if (perfectCount >= 9) return 'mastered';
    if (perfectCount >= 6) return 'consolidated';
    if (perfectCount >= 3) return 'completed';
    return 'none';
  }

  /**
   * Get progress bar percentage from perfect count
   * Shows progress WITHIN the current tier, not across all tiers.
   * 
   * Uses perfectCount % 3 to calculate tier progress:
   *   - 0 within tier → 0%
   *   - 1 within tier → 33%
   *   - 2 within tier → 66%
   *   - 3 within tier → 100% (tier complete, advances to next)
   * 
   * For mastered tier (9+), always shows 100%.
   * 
   * @param {number} perfectCount
   * @returns {number}
   */
  function getProgressPercentage(perfectCount) {
    // Mastered tier (9+) always shows 100%
    if (perfectCount >= 9) return 100;

    // Calculate progress within current tier
    const progressWithinTier = perfectCount % 3;

    switch (progressWithinTier) {
      case 0: return 0;
      case 1: return 33;
      case 2: return 66;
      default: return 0;
    }
  }

  /**
   * Get the next state target label
   * Used for progress bar display
   * 
   * @param {string} currentState
   * @returns {string}
   */
  function getNextStateLabel(currentState) {
    switch (currentState) {
      case 'not-started': return 'Completed';
      case 'in-progress': return 'Completed';
      case 'completed': return 'Consolidated';
      case 'consolidated': return 'Mastered';
      case 'mastered': return 'Mastered ★';
      default: return 'Completed';
    }
  }

  // Legacy alias
  const getNextTierLabel = getNextStateLabel;

  /**
   * Get progress description showing X/3 completions toward next state
   * 
   * @param {boolean} hasAttempted - Whether user has attempted
   * @param {number} perfectCount - Number of perfect completions
   * @returns {string}
   */
  function getProgressDescription(hasAttempted, perfectCount) {
    if (perfectCount >= 9) return '★ Fully Mastered';

    const progressWithinTier = perfectCount % 3;
    const currentState = calculateState(hasAttempted, perfectCount);
    const nextState = getNextStateLabel(currentState);

    if (!hasAttempted) {
      return 'Not started';
    }

    return `${progressWithinTier}/3 to ${nextState}`;
  }

  /**
   * Update progress bar UI for a question
   * 
   * @param {string|number} questionId - Question ID
   * @param {string} mode - 'type' or 'speak'
   * @param {Object} progressData - { perfectCount, tier }
   */
  function updateProgressBarUI(questionId, mode, progressData) {
    const progressBar = document.getElementById(`progress-bar-${mode}`);
    const progressTarget = document.getElementById(`progress-target-${mode}`);
    const progressTierBadge = document.getElementById(`progress-tier-${mode}`);
    const resetBtn = document.getElementById(`reset-progress-${mode}-btn`);

    if (!progressBar) return;

    const isLoggedIn = window.authUI && !window.authUI.isGuestMode?.() && window.authUI.getCurrentUserId?.();
    progressBar.style.display = isLoggedIn ? 'block' : 'none';

    if (!isLoggedIn) return;

    const perfectCount = progressData?.perfectCount || 0;
    const hasAttempted = progressData?.hasAttempted || false;
    const state = calculateState(hasAttempted, perfectCount);

    const steps = progressBar.querySelectorAll('.progress-step');
    const connectors = progressBar.querySelectorAll('.progress-connector');
    const tierThresholds = [3, 6, 9];

    steps.forEach((step, i) => {
      const threshold = tierThresholds[i];
      const dot = step.querySelector('.progress-step-dot');
      step.classList.remove('reached', 'active');
      if (dot) dot.removeAttribute('data-sub');

      if (perfectCount >= threshold) {
        step.classList.add('reached');
      } else {
        const rangeStart = i === 0 ? 0 : tierThresholds[i - 1];
        if (perfectCount > rangeStart || (i === 0 && hasAttempted)) {
          step.classList.add('active');
          if (dot) dot.setAttribute('data-sub', `${perfectCount % 3}/3`);
        }
      }
    });

    const connectorRanges = [
      { start: 0, end: 3, cls: 'tier-completed' },
      { start: 3, end: 6, cls: 'tier-consolidated' }
    ];

    connectors.forEach((conn, i) => {
      const fill = conn.querySelector('.progress-connector-fill');
      if (!fill) return;
      const range = connectorRanges[i];
      if (!range) return;

      fill.className = 'progress-connector-fill';

      if (perfectCount >= range.end) {
        fill.style.width = '100%';
        fill.classList.add(range.cls);
      } else if (perfectCount > range.start) {
        const pct = Math.round(((perfectCount - range.start) / (range.end - range.start)) * 100);
        fill.style.width = `${pct}%`;
        fill.classList.add(range.cls);
      } else {
        fill.style.width = '0%';
      }
    });

    if (progressTarget) {
      progressTarget.textContent = getProgressDescription(hasAttempted, perfectCount);
    }

    if (progressTierBadge) {
      const stateLabels = {
        'not-started': 'Not Started',
        'in-progress': 'In Progress',
        'completed': 'Completed',
        'consolidated': 'Consolidated',
        'mastered': '★ Mastered'
      };
      progressTierBadge.textContent = stateLabels[state] || 'Not Started';
      progressTierBadge.className = `progress-tier-badge state-${state}`;
    }

    if (resetBtn) {
      resetBtn.style.display = (perfectCount > 0 || hasAttempted) ? 'inline-flex' : 'none';
    }
  }

  /**
   * Update the left-side progress panel
   * Shows overall progress summary, distribution bar, pie chart, next goal, and recent progress
   * 
   * @param {string} mode - 'type' or 'speak'
   */
  async function updateProgressPanel(mode) {
    // Only show for logged-in users
    const isLoggedIn = window.authUI && !window.authUI.isGuestMode?.() && window.authUI.getCurrentUserId?.();
    const guestNotice = document.getElementById('progress-guest-notice');
    const progressPanelContent = document.getElementById('progress-tab-content-question-mastery')
      || document.getElementById('progress-panel-content');

    // Toggle guest mode class for blur effect
    if (progressPanelContent) {
      progressPanelContent.classList.toggle('guest-mode', !isLoggedIn);
    }

    if (guestNotice) {
      guestNotice.style.display = isLoggedIn ? 'none' : 'block';
    }

    // Mode label is set before the guest early-return: the Type/Speak toggle
    // must still reflect the chosen mode for guests, who otherwise bail out
    // below with every count zeroed.
    const modeLabel = document.getElementById('progress-mode-label');
    if (modeLabel) {
      modeLabel.textContent = mode === 'type' ? 'Type Mode' : 'Speak Mode';
    }

    // Get total questions for this mode
    const database = mode === 'type' ? typeDatabase : speakDatabase;
    const totalQuestions = database.length;

    if (!isLoggedIn) {
      // Reset counts for guests - all questions are "not started"
      updateTierCounts(0, 0, 0, totalQuestions, totalQuestions);
      updateDistribution({ notStarted: totalQuestions, inProgress: 0, completed: 0, consolidated: 0, mastered: 0 }, totalQuestions);
      return;
    }

    // Count all states from cache
    const cache = progressCache[mode] || {};
    let notStartedCount = 0;
    let inProgressCount = 0;
    let completedCount = 0;
    let consolidatedCount = 0;
    let masteredCount = 0;

    // Count questions with cached progress
    const cachedQuestionIds = new Set(Object.keys(cache));

    // For each question in the database, determine its state
    database.forEach(item => {
      const questionId = String(item.id);
      const progress = cache[questionId];

      if (!progress) {
        notStartedCount++;
      } else {
        const hasAttempted = progress.hasAttempted || false;
        const perfectCount = progress.perfectCount || 0;
        const state = calculateState(hasAttempted, perfectCount);

        if (state === 'not-started') notStartedCount++;
        else if (state === 'in-progress') inProgressCount++;
        else if (state === 'completed') completedCount++;
        else if (state === 'consolidated') consolidatedCount++;
        else if (state === 'mastered') masteredCount++;
      }
    });

    // Update UI
    updateTierCounts(completedCount, consolidatedCount, masteredCount, totalQuestions, notStartedCount);

    // Update distribution bar and pie chart
    const stateCounts = {
      notStarted: notStartedCount,
      inProgress: inProgressCount,
      completed: completedCount,
      consolidated: consolidatedCount,
      mastered: masteredCount
    };
    updateDistribution(stateCounts, totalQuestions);
    updateNextGoalHint(completedCount, consolidatedCount, masteredCount, totalQuestions);

    // Load and display recent progress
    await updateRecentProgress(mode);
  }

  /**
   * Update tier count display
   */
  function updateTierCounts(completed, consolidated, mastered, total, notStarted) {
    setText('completed-count', completed);
    setText('consolidated-count', consolidated);
    setText('mastered-count', mastered);

    // Total / Not started carry the numbers the removed donut centre used to.
    if (total !== undefined) setText('tp-total-count', total);
    if (notStarted !== undefined) setText('tp-not-started-count', notStarted);
  }

  /**
   * Update distribution UI (stacked bar + legend)
   *
   * @param {Object} stateCounts - { notStarted, inProgress, completed, consolidated, mastered }
   * @param {number} total - Total number of questions
   */
  function updateDistribution(stateCounts, total) {
    updateTierDistributionBar(stateCounts, total);
  }

  /**
   * Update tier distribution bar
   * Width is proportional to counts for all 5 states
   * 
   * @param {Object} stateCounts - { notStarted, inProgress, completed, consolidated, mastered }
   * @param {number} total - Total number of questions
   */
  function updateTierDistributionBar(stateCounts, total) {
    const barNotStarted = document.getElementById('tier-bar-not-started');
    const barInProgress = document.getElementById('tier-bar-in-progress');
    const barCompleted = document.getElementById('tier-bar-completed');
    const barConsolidated = document.getElementById('tier-bar-consolidated');
    const barMastered = document.getElementById('tier-bar-mastered');

    if (total === 0) total = 1; // Prevent division by zero

    const notStartedPct = (stateCounts.notStarted / total) * 100;
    const inProgressPct = (stateCounts.inProgress / total) * 100;
    const completedPct = (stateCounts.completed / total) * 100;
    const consolidatedPct = (stateCounts.consolidated / total) * 100;
    const masteredPct = (stateCounts.mastered / total) * 100;

    if (barNotStarted) barNotStarted.style.width = `${notStartedPct}%`;
    if (barInProgress) barInProgress.style.width = `${inProgressPct}%`;
    if (barCompleted) barCompleted.style.width = `${completedPct}%`;
    if (barConsolidated) barConsolidated.style.width = `${consolidatedPct}%`;
    if (barMastered) barMastered.style.width = `${masteredPct}%`;

    // Legend counts used to be written by the donut renderer; the bar owns
    // them now so the two can never disagree.
    setText('tp-legend-not-started', stateCounts.notStarted);
    setText('tp-legend-in-progress', stateCounts.inProgress);
    setText('tp-legend-completed', stateCounts.completed);
    setText('tp-legend-consolidated', stateCounts.consolidated);
    setText('tp-legend-mastered', stateCounts.mastered);
  }

  /** Write a number into an element by id, if that element exists. */
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }


  /**
   * Update next goal hint message
   */
  function updateNextGoalHint(completed, consolidated, mastered, total) {
    const goalText = document.getElementById('next-goal-text');
    if (!goalText) return;

    const totalProgress = completed + consolidated + mastered;

    if (totalProgress === 0) {
      goalText.textContent = 'Complete a question to start tracking!';
    } else if (mastered >= total) {
      goalText.textContent = '🎉 All questions mastered! Amazing work!';
    } else if (completed > 0 && consolidated < total) {
      goalText.textContent = `Practice ${completed} question(s) again to reach Consolidated.`;
    } else if (consolidated > 0 && mastered < total) {
      goalText.textContent = `Practice ${consolidated} question(s) more to reach Mastered.`;
    } else {
      const remaining = total - totalProgress;
      goalText.textContent = `${remaining} question(s) remaining to complete.`;
    }
  }

  /**
   * Update recent progress list
   */
  async function updateRecentProgress(mode) {
    const recentList = document.getElementById('recent-progress-list');
    if (!recentList) return;

    const userId = window.authUI?.getCurrentUserId?.();
    if (!userId) {
      recentList.innerHTML = '<li class="no-progress">Log in to track progress</li>';
      return;
    }

    try {
      const result = await window.firebaseFirestoreFunctions.getRecentProgress(userId, mode, 5);

      if (result.success && result.recentProgress.length > 0) {
        recentList.innerHTML = result.recentProgress.map(item => `
          <li>
            <span>Question ${item.questionId}</span>
            <span class="recent-tier-badge ${item.tier}">${getTierLabel(item.tier)}</span>
          </li>
        `).join('');
      } else {
        recentList.innerHTML = '<li class="no-progress">No recent progress</li>';
      }
    } catch (error) {
      log.error('Error loading recent progress:', error);
      recentList.innerHTML = '<li class="no-progress">Unable to load</li>';
    }
  }

  /**
   * Get display label for tier
   */
  function getTierLabel(tier) {
    switch (tier) {
      case 'completed': return '✓ Completed';
      case 'consolidated': return '✓✓ Consolidated';
      case 'mastered': return '★ Mastered';
      default: return 'Not Started';
    }
  }

  /**
   * Load and display mastery status for a question in a specific mode
   * Guest mode: No mastery status is shown (returns early)
   * Authenticated mode: Loads mastery from Firestore and displays UI
   * 
   * Type and Speak modes are INDEPENDENT - each mode has its own mastery status
   * When switching tabs, mastery status is loaded separately for each mode
   * 
   * @param {string|number} questionId - Question ID
   * @param {string} mode - 'type' or 'speak' - the mode to check mastery for
   */
  /**
   * Load and display progress status for a question in a specific mode
   * Guest mode: No progress status is shown (returns early)
   * Authenticated mode: Loads progress from Firestore and displays UI
   * 
   * Type and Speak modes are INDEPENDENT - each mode has its own progress status
   * When switching tabs, progress status is loaded separately for each mode
   * 
   * @param {string|number} questionId - Question ID
   * @param {string} mode - 'type' or 'speak' - the mode to check progress for
   */
  async function loadProgressStatus(questionId, mode) {
    // Guest mode: Do NOT show progress status
    if (window.authUI && window.authUI.isGuestMode && window.authUI.isGuestMode()) {
      hideProgressBar('type');
      hideProgressBar('speak');
      return;
    }

    // Check if Firebase functions are available and user is logged in
    if (!window.firebaseFirestoreFunctions || !window.authUI) {
      hideProgressBar('type');
      hideProgressBar('speak');
      return;
    }

    const userId = window.authUI.getCurrentUserId();
    if (!userId) {
      hideProgressBar('type');
      hideProgressBar('speak');
      return;
    }

    // Validate mode
    if (!mode || (mode !== 'type' && mode !== 'speak')) {
      log.error('Invalid mode for loadProgressStatus:', mode);
      return;
    }

    try {
      // Get progress status for this specific mode and question
      const result = await window.firebaseFirestoreFunctions.getProgressStatus(userId, questionId, mode);

      if (result.success && result.progress) {
        const progress = result.progress;

        // Update cache
        if (!progressCache[mode]) progressCache[mode] = {};
        progressCache[mode][questionId] = progress;

        // Update progress bar UI
        updateProgressBarUI(questionId, mode, progress);
      } else {
        // No progress - show empty state
        updateProgressBarUI(questionId, mode, { perfectCount: 0, tier: 'none' });
      }

      // Refresh dropdown to show updated progress status
      populateQuestionSelect(mode);

      // Update left panel
      await updateProgressPanel(mode);

      // Note: We don't touch the other mode's UI - each mode is independent
    } catch (error) {
      log.error('Error loading progress status:', error);
      hideProgressBar(mode);
    }
  }

  // Legacy alias for backward compatibility
  const loadMasteryStatus = loadProgressStatus;

  /**
   * Hide progress bar for a mode
   * @param {string} mode - 'type' or 'speak'
   */
  function hideProgressBar(mode) {
    const progressBar = document.getElementById(`progress-bar-${mode}`);
    if (progressBar) {
      progressBar.style.display = 'none';
    }
  }

  /**
   * Show mastery status UI for a mode
   * @param {string} mode - 'type' or 'speak'
   * @param {boolean} showRemoveButton - Whether to show the remove button
   */
  function showMasteryStatus(mode, showRemoveButton = true) {
    const masteryStatusEl = document.getElementById(`mastery-status-${mode}`);
    const removeBtn = document.getElementById(`remove-mastery-${mode}-btn`);

    if (masteryStatusEl) {
      masteryStatusEl.style.display = 'flex';
    }

    if (removeBtn) {
      removeBtn.style.display = showRemoveButton ? 'inline-block' : 'none';
    }
  }

  /**
   * Hide mastery status UI for a mode
   * @param {string} mode - 'type' or 'speak'
   */
  function hideMasteryStatus(mode) {
    const masteryStatusEl = document.getElementById(`mastery-status-${mode}`);
    if (masteryStatusEl) {
      masteryStatusEl.style.display = 'none';
    }
  }

  /**
   * Handle remove mastered status button click
   * Removes mastery status for the current mode only
   * Type and Speak modes are independent - removing one does NOT affect the other
   * 
   * @param {string} mode - 'type' or 'speak'
   * @param {string|number} questionId - Question ID
   */
  async function handleRemoveMastery(mode, questionId) {
    // Guest mode: Cannot remove mastery (doesn't exist)
    if (window.authUI && window.authUI.isGuestMode && window.authUI.isGuestMode()) {
      return;
    }

    // Check if Firebase functions are available and user is logged in
    if (!window.firebaseFirestoreFunctions || !window.authUI) {
      alert('Error: Firebase not initialized');
      return;
    }

    const userId = window.authUI.getCurrentUserId();
    if (!userId) {
      alert('Error: Must be logged in to remove mastery status');
      return;
    }

    // Validate mode
    if (!mode || (mode !== 'type' && mode !== 'speak')) {
      alert('Error: Invalid mode');
      return;
    }

    // Confirm action
    const modeName = mode === 'type' ? 'Type' : 'Speak';
    const confirmed = await window.showCustomConfirm(
      'Remove Mastered Status?',
      `Are you sure you want to remove the mastered status for this question in ${modeName} mode?`,
      true
    );
    if (!confirmed) {
      return;
    }

    try {
      // Remove mastery for this specific mode only
      const result = await window.firebaseFirestoreFunctions.removeMasteryStatus(userId, questionId, mode);

      if (result.success) {
        // Update cache
        updateMasteryCache(questionId, mode, false);
        // Reload mastery status for this mode to update UI
        await loadMasteryStatus(questionId, mode);
        // Reload all mastery data to update dropdown
        await loadAllMasteryForMode(mode);
      } else {
        alert('Error removing mastery status: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      log.error('Error removing mastery status:', error);
      alert('Error removing mastery status. Please try again.');
    }
  }

  /**
   * Record practice attempt to Firestore
   * Guest mode: No data is recorded (returns early)
   * Authenticated mode: Records attempt to Firestore
   * 
   * Also updates mastery status if user achieves 100% correctness:
   * - Type mode: Marks question as mastered in Type mode only
   * - Speak mode: Marks question as mastered in Speak mode only
   * - Type and Speak modes are INDEPENDENT - mastery in one does NOT affect the other
   * 
   * @param {string|number} questionId - Question ID or text
   * @param {boolean} isCorrect - Whether the answer was correct (100% correct = true)
   * @param {string} mode - Practice mode ('type', 'speak', 'extended', 'phrases')
   */
  async function recordPracticeAttempt(questionId, isCorrect, mode = 'type') {
    // Guest mode: Do NOT write any personal data to Firestore
    if (window.authUI && window.authUI.isGuestMode && window.authUI.isGuestMode()) {
      return; // Silently skip tracking in guest mode
    }

    // Check if Firebase functions are available and user is logged in
    if (!window.firebaseFirestoreFunctions || !window.authUI) {
      return; // Silently fail if Firebase not initialized
    }

    const userId = window.authUI.getCurrentUserId();
    if (!userId) {
      return; // User not logged in and not guest mode, skip tracking
    }

    try {
      // Record attempt analytics handled server-side via Cloud Functions.
      const attemptLog = await window.firebaseFirestoreFunctions.recordPracticeAttempt(userId, questionId, isCorrect, mode);
      if (attemptLog && attemptLog.success === false) {
        log.warn('[Progress] recordPracticeAttempt failed:', attemptLog.error);
      }

      // For Type and Speak modes, track attempts and progress
      if (mode === 'type' || mode === 'speak') {
        // ALWAYS record that user attempted (pressed Check), regardless of correctness
        // This moves the question from "Not Started" to "In Progress"
        const attemptResult = await window.firebaseFirestoreFunctions.recordAttempt(
          userId,
          questionId,
          mode
        );

        // Update progress if 100% correct
        // State Progression (3 perfect completions per tier):
        //   - 0-2 perfect → In Progress
        //   - 3-5 perfect → Completed
        //   - 6-8 perfect → Consolidated
        //   - 9+ perfect → Mastered
        if (isCorrect) {
          // Increment perfect count and update state
          const result = await window.firebaseFirestoreFunctions.incrementProgress(
            userId,
            questionId,
            mode
          );

          if (result.success && result.progress) {
            // Update cache immediately with new progress data
            updateProgressCache(questionId, mode, result.progress);

            // Reload progress UI for this mode to show updated status
            await loadProgressStatus(questionId, mode);

            // Reload all progress data to update dropdown
            await loadAllProgressForMode(mode);
          }
        } else if (attemptResult.success && attemptResult.progress) {
          // Update cache with attempt (now In Progress if was Not Started)
          updateProgressCache(questionId, mode, attemptResult.progress);

          // Reload progress UI
          await loadProgressStatus(questionId, mode);

          // Reload all progress data to update dropdown
          await loadAllProgressForMode(mode);
        }
      }
      // Note: Non-perfect attempts do NOT reset progress - progress only increases
    } catch (error) {
      log.error('Error recording practice attempt:', error);
      // Don't show error to user, just log it
    }
  }

  window.recordPracticeAttempt = recordPracticeAttempt;

  const audio = document.getElementById("audio");
  const questionSelectType = document.getElementById("question-select-type");
  const questionSelectSpeak = document.getElementById("question-select-speak");
  const recommendationControlsType = document.getElementById("recommendation-controls-type");
  const recommendationControlsSpeak = document.getElementById("recommendation-controls-speak");
  const recommendedBtnType = document.getElementById("recommended-btn-type");
  const recommendedBtnSpeak = document.getElementById("recommended-btn-speak");
  const recommendationSummaryType = document.getElementById("recommendation-summary-type");
  const recommendationSummarySpeak = document.getElementById("recommendation-summary-speak");
  const currentQuestionIdType = document.getElementById("current-question-id-type");
  const currentQuestionIdSpeak = document.getElementById("current-question-id-speak");
  const totalQuestionsType = document.getElementById("total-questions-type");
  const totalQuestionsSpeak = document.getElementById("total-questions-speak");
  const playBtn = document.getElementById("play-btn");
  const checkBtn = document.getElementById("check-btn");
  const retryBtn = document.getElementById("retry-btn"); // NEW
  const input = document.getElementById("answer-input");
  const result = document.getElementById("result");
  const score = document.getElementById("score");
  const animationBox = document.getElementById("animation");
  const animationPanel = document.querySelector(".animation-panel");
  const replayBtn = document.getElementById("replay-btn");
  const skipAnimationBtn = document.getElementById("skip-animation-btn");

  // Tab switching
  const tabType = document.getElementById("tab-type");
  const tabSpeak = document.getElementById("tab-speak");
  const tabExtended = document.getElementById("tab-extended");
  const tabWatch = document.getElementById("tab-watch");
  const tabNotes = document.getElementById("tab-notes");
  const modeType = document.getElementById("mode-type");
  const modeSpeak = document.getElementById("mode-speak");
  const modeExtended = document.getElementById("mode-extended");
  const modeWatch = document.getElementById("mode-watch");
  const modeNotes = document.getElementById("mode-notes");
  const modePronounce = document.getElementById("mode-pronounce");
  const modeSGD = document.getElementById("mode-sgd");
  const tabSGD = document.getElementById("tab-sgd");
  const modeEssay = document.getElementById("mode-essay");
  const tabEssay = document.getElementById("tab-essay");

  // ============================================
  // Feedback Banner
  // Users can close the banner; choice is saved in sessionStorage
  // ============================================
  const feedbackBanner = document.querySelector('.feedback-banner');
  const feedbackBannerClose = document.querySelector('.feedback-banner-close');

  // Check if user already closed the banner this session
  if (feedbackBanner && sessionStorage.getItem('feedbackBannerClosed') === 'true') {
    feedbackBanner.classList.add('hidden');
  }

  // Handle banner close
  if (feedbackBannerClose) {
    feedbackBannerClose.addEventListener('click', () => {
      if (feedbackBanner) {
        feedbackBanner.classList.add('hidden');
        sessionStorage.setItem('feedbackBannerClosed', 'true');
      }
    });
  }

  // Speak mode elements
  const playBtnSpeak = document.getElementById("play-btn-speak");
  const recordBtn = document.getElementById("record-btn");
  const checkBtnSpeak = document.getElementById("check-btn-speak");
  const retryBtnSpeak = document.getElementById("retry-btn-speak"); // NEW

  // Mastery status remove buttons
  const removeMasteryTypeBtn = document.getElementById("remove-mastery-type-btn");
  const removeMasterySpeakBtn = document.getElementById("remove-mastery-speak-btn");

  // Audio Control Elements (Type Mode)
  const speedToggleBtn = document.getElementById("speed-toggle-btn");
  const loopBtn = document.getElementById("loop-btn");
  const chunkingBtn = document.getElementById("chunking-btn");

  window.isChunkingActive = false; // Add global state

  // Chunking Toggle Logic
  if (chunkingBtn) {
    chunkingBtn.addEventListener("click", async () => {
      if (chunkingBtn.classList.contains('locked')) {
        handleLockedSkillClick('chunking');
        return;
      }

      const nextChunkingState = !window.isChunkingActive;
      if (nextChunkingState) {
        const currentMode = window.currentMode || 'type';
        const questionId = window.currentTypeQuestionId || 'unknown';
        const skillResult = window.useActiveSkillForAttempt ? await window.useActiveSkillForAttempt('chunking', currentMode, questionId) : { success: true };
        if (!skillResult?.success) {
          return;
        }
      }

      window.isChunkingActive = nextChunkingState;
      chunkingBtn.classList.toggle("active", window.isChunkingActive);

      if (window.isChunkingActive) {
        chunkingBtn.title = "Segment Audio Active";
      } else {
        chunkingBtn.title = "Segment Audio";
        if (window.speechSynthesis) window.speechSynthesis.cancel();
      }
    });
  }

  // Speed Toggle Logic
  if (speedToggleBtn) {
    speedToggleBtn.addEventListener("click", async () => {
      // Check for locked state first
      if (speedToggleBtn.classList.contains('locked')) {
        handleLockedSkillClick('slow_audio');
        return;
      }

      const currentSpeed = audio.playbackRate;
      let newSpeed = 1.0;

      if (currentSpeed === 1.0) newSpeed = 0.75;
      else if (currentSpeed === 0.75) newSpeed = 0.5;
      else newSpeed = 1.0;

      if (newSpeed < 1.0) {
        const skillResult = await window.useActiveSkillForAttempt('slow_audio', 'type', currentTypeQuestionId);
        if (!skillResult?.success) {
          return;
        }
      }

      audio.playbackRate = newSpeed;
      if (newSpeed === 1.0) speedToggleBtn.textContent = "1.0x";
      else if (newSpeed === 0.75) speedToggleBtn.textContent = "0.75x";
      else if (newSpeed === 0.5) speedToggleBtn.textContent = "0.5x";
    });
  }

  // Loop Toggle Logic
  if (loopBtn) {
    loopBtn.addEventListener("click", async () => {
      // Check for locked state first
      if (loopBtn.classList.contains('locked')) {
        handleLockedSkillClick('echo_loop');
        return;
      }

      const nextLoopState = !audio.loop;
      if (nextLoopState) {
        const skillResult = await window.useActiveSkillForAttempt('echo_loop', 'type', currentTypeQuestionId);
        if (!skillResult?.success) {
          return;
        }
      }

      audio.loop = nextLoopState;
      loopBtn.classList.toggle("active", audio.loop);

      if (audio.loop) {
        loopBtn.title = "Loop Active";
      } else {
        loopBtn.title = "Loop Audio";
      }
    });
  }

  // WFD SST-style Audio Player Integration
  (function initWfdPlayer() {
    const wfdPlayBtn = document.getElementById('wfd-play-btn');
    const wfdPlayIcon = document.getElementById('wfd-play-icon');
    const wfdPlayLabel = document.getElementById('wfd-play-label');
    const wfdProgressFill = document.getElementById('wfd-progress-fill');
    const wfdSeek = document.getElementById('wfd-seek');
    const wfdAudioTime = document.getElementById('wfd-audio-time');
    const wfdVolume = document.getElementById('wfd-volume');

    if (!wfdPlayBtn || !audio) return;

    function fmtTime(s) {
      if (!s || !Number.isFinite(s)) return '00:00';
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    }

    function updateWfdProgress() {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const pct = Math.min(100, (audio.currentTime / audio.duration) * 100);
      if (wfdProgressFill) wfdProgressFill.style.width = `${pct}%`;
      if (wfdSeek) wfdSeek.value = String(pct);
      if (wfdAudioTime) wfdAudioTime.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`;
    }

    audio.addEventListener('timeupdate', updateWfdProgress);
    audio.addEventListener('loadedmetadata', updateWfdProgress);

    audio.addEventListener('play', () => {
      if (wfdPlayIcon) wfdPlayIcon.textContent = 'pause';
      if (wfdPlayLabel) wfdPlayLabel.textContent = 'Pause';
    });

    audio.addEventListener('pause', () => {
      if (wfdPlayIcon) wfdPlayIcon.textContent = 'play_arrow';
      if (wfdPlayLabel) wfdPlayLabel.textContent = 'Play';
    });

    audio.addEventListener('ended', () => {
      if (wfdPlayIcon) wfdPlayIcon.textContent = 'play_arrow';
      if (wfdPlayLabel) wfdPlayLabel.textContent = 'Play';
      if (wfdProgressFill) wfdProgressFill.style.width = '0';
      if (wfdSeek) wfdSeek.value = '0';
      if (wfdAudioTime) wfdAudioTime.textContent = `00:00 / ${fmtTime(audio.duration)}`;
    });

    wfdPlayBtn.addEventListener('click', () => {
      // loadQuestion() supplies audio via an appended <source> child, so audio.src
      // stays empty. Check currentSrc (and the pending <source>, which is all that
      // exists before resource selection resolves) instead.
      const hasAudioSource = audio.currentSrc || audio.getAttribute('src') || audio.querySelector('source[src]');
      if (!hasAudioSource) return;
      if (!audio.paused) {
        audio.pause();
      } else if (audio.currentTime > 0.1 && !audio.ended) {
        audio.volume = Number(wfdVolume?.value ?? 1);
        audio.play().catch(() => {});
      } else {
        audio.volume = Number(wfdVolume?.value ?? 1);
        playBtn.click();
      }
    });

    if (wfdSeek) {
      wfdSeek.addEventListener('input', () => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
        audio.currentTime = (Number(wfdSeek.value) / 100) * audio.duration;
        updateWfdProgress();
      });
    }

    if (wfdVolume) {
      wfdVolume.addEventListener('input', () => {
        audio.volume = Number(wfdVolume.value);
      });
    }

    window._resetWfdPlayer = function () {
      if (wfdProgressFill) wfdProgressFill.style.width = '0';
      if (wfdSeek) wfdSeek.value = '0';
      if (wfdAudioTime) wfdAudioTime.textContent = '00:00 / 00:00';
      if (wfdPlayIcon) wfdPlayIcon.textContent = 'play_arrow';
      if (wfdPlayLabel) wfdPlayLabel.textContent = 'Play';
    };
  })();

  // Hint Button Logic
  function updatePopoverAvailability() {
    if (!window.SkillCatalog) return;

    const skillButtons = [
      { id: 'skill-word-ghost', skillId: 'word_ghost', title: 'Word Ghost' },
      { id: 'skill-first-letter', skillId: 'first_letter_peek', title: 'First-Letter Peek' },
      { id: 'skill-hint-reveal', skillId: 'hint_reveal', title: 'Hint Reveal' },
      { id: 'skill-transcript-glimpse', skillId: 'transcript_glimpse', title: 'Transcript Glimpse' }
    ];

    skillButtons.forEach(({ id, skillId, title }) => {
      const button = document.getElementById(id);
      if (!button) return;

      const costEl = button.querySelector('.popover-cost');
      const unlock = window.SkillCatalog.getProgressionUnlockById?.(skillId);
      const isUnlocked = !!window.shopModule?.isSkillUnlocked?.(skillId);

      button.style.display = isUnlocked ? 'flex' : 'none';
      button.title = isUnlocked
        ? title
        : unlock
          ? `${title} unlocks at ${String(unlock.branch || '').replace(/^\w/, (c) => c.toUpperCase())} Level ${unlock.unlockLevel}`
          : `${title} is locked`;

      if (costEl) {
        costEl.textContent = isUnlocked ? 'Ready' : '';
      }
    });
  }

  const hintBtn = document.getElementById("hint-btn");
  const hintCostBadge = document.getElementById("hint-cost-badge");
  const autoHintsType = document.getElementById("auto-hints-type");
  if (hintBtn) {
    hintBtn.addEventListener("click", (e) => {
      const hasUser = !!(window.auth && window.auth.currentUser);
      if (!hasUser) {
        e.stopPropagation();

        const question = typeDatabase.find(q => q.id === currentTypeQuestionId);
        if (!question || !window.HintSystem) {
          return;
        }

        if (getGuestHintRemaining() <= 0) {
          window.shopModule?.showAlertModal?.('Demo hint limit reached for this session.', true);
          updateHintCostBadge();
          return;
        }

        const hintResult = window.HintSystem.useHint(question.correctSentence);
        window.hintUsedForCurrentQuestion = true;

        if (hintResult?.success) {
          consumeGuestHintUse();
          if (hintResult.hint?.type === 'transcript-glimpse') {
            showTranscriptGlimpseOverlay(hintResult.hint?.contentText || question.correctSentence, hintResult.hint?.transientMs);
          } else if (autoHintsType && hintResult.hint?.content) {
            autoHintsType.style.display = 'block';
            autoHintsType.innerHTML += `<div class="auto-hint-item">${hintResult.hint.content}</div>`;
          }
        } else if (hintResult?.error) {
          window.shopModule?.showAlertModal?.(hintResult.error, true);
        }

        updateHintCostBadge();
        return;
      }

      // Check for locked state first
      if (hintBtn.classList.contains('locked')) {
        handleLockedSkillClick('word_ghost');
        return;
      }

      const actionPopover = document.getElementById('action-popover-menu');
      if (actionPopover) {
        if (actionPopover.style.display !== 'flex') {
          updatePopoverAvailability();
          actionPopover.style.display = 'flex';
        } else {
          actionPopover.style.display = 'none';
        }
      }
      e.stopPropagation(); // ensure popover body click outside works
    });

    // Close popover when clicking outside
    document.addEventListener('click', (e) => {
      const actionPopover = document.getElementById('action-popover-menu');
      const hintControls = document.getElementById('hint-controls');
      if (actionPopover && actionPopover.style.display !== 'none' && hintControls && !hintControls.contains(e.target)) {
        actionPopover.style.display = 'none';
      }
    });

    // Word Ghost Skill
    const btnWordGhost = document.getElementById("skill-word-ghost");
    if (btnWordGhost) {
      btnWordGhost.addEventListener("click", async () => {
        const actionPopover = document.getElementById('action-popover-menu');
        if (actionPopover) actionPopover.style.display = "none";

        const question = typeDatabase.find(q => q.id === currentTypeQuestionId);
        if (!question) return;

        try {
          btnWordGhost.disabled = true;
          const skillResult = await useActiveSkillForAttempt('word_ghost', 'type', currentTypeQuestionId);

          if (skillResult?.success) {
            // Execute Hint logic: Word Ghost essentially reveals the next chunk via HintSystem
            if (window.HintSystem) {
              const hintResult = window.HintSystem.useHint(question.correctSentence);
              window.hintUsedForCurrentQuestion = true;

              if (hintResult?.success) {
                if (hintResult.hint?.type === 'transcript-glimpse') {
                  showTranscriptGlimpseOverlay(hintResult.hint?.contentText || question.correctSentence, hintResult.hint?.transientMs);
                } else if (autoHintsType && hintResult.hint?.content) {
                  autoHintsType.style.display = 'block';
                  autoHintsType.innerHTML += `<div class="auto-hint-item">${hintResult.hint.content}</div>`;
                }
              } else if (hintResult?.error) {
                window.shopModule?.showAlertModal?.(hintResult.error, true);
              }
            }

            setTimeout(updateHintCostBadge, 800);
          }
        } finally {
          btnWordGhost.disabled = false;
        }
      });
    }

    // First-Letter Peek Skill
    const btnFirstLetter = document.getElementById("skill-first-letter");
    if (btnFirstLetter) {
      btnFirstLetter.addEventListener("click", async () => {
        const actionPopover = document.getElementById('action-popover-menu');
        if (actionPopover) actionPopover.style.display = "none";

        const question = typeDatabase.find(q => q.id === currentTypeQuestionId);
        if (!question) return;

        try {
          btnFirstLetter.disabled = true;
          // Add a generic API call if useActiveSkillForAttempt maps skillId properly
          const skillResult = await useActiveSkillForAttempt('first_letter_peek', 'type', currentTypeQuestionId);

          if (skillResult?.success) {
            window.hintUsedForCurrentQuestion = true;

            // Use window.generateFirstLettersPreview if available, else simple fallback
            const lettersPreview = typeof window.generateFirstLettersPreview === 'function' ?
              window.generateFirstLettersPreview(question.correctSentence) :
              question.correctSentence.split(' ').map(w => w[0] + '_'.repeat(w.length - 1)).join(' ');

            if (autoHintsType) {
              autoHintsType.style.display = 'block';
              const hintId = 'first-letter-peek-' + Date.now();
              autoHintsType.innerHTML += `<div id="${hintId}" class="auto-hint-item" data-hint-type="first-letters">${lettersPreview}</div>`;

              // Explicitly time it as "timed peek (800ms) instead of persistent"
              setTimeout(() => {
                const firstLettersNode = document.getElementById(hintId);
                if (firstLettersNode) firstLettersNode.remove();
                if (autoHintsType.innerHTML.trim() === '') {
                  autoHintsType.style.display = 'none';
                }
              }, 800);
            }

            setTimeout(updateHintCostBadge, 800);
          }
        } finally {
          btnFirstLetter.disabled = false;
        }
      });
    }

    // Hint Reveal Skill
    const btnHintReveal = document.getElementById("skill-hint-reveal");
    if (btnHintReveal) {
      btnHintReveal.addEventListener("click", async () => {
        const actionPopover = document.getElementById('action-popover-menu');
        if (actionPopover) actionPopover.style.display = "none";

        const question = typeDatabase.find(q => q.id === currentTypeQuestionId);
        const input = document.getElementById("answer-input");
        if (!question || !input) return;

        try {
          btnHintReveal.disabled = true;
          const skillResult = await useActiveSkillForAttempt('hint_reveal', 'type', currentTypeQuestionId);
          if (!skillResult?.success) return;

          const correctWords = String(question.correctSentence || '').trim().split(/\s+/).filter(Boolean);
          const currentWords = String(input.value || '').trim().split(/\s+/).filter(Boolean);
          if (correctWords.length === 0) return;

          const diff = diffWords(input.value || '', question.correctSentence || '');
          const missingPiece = diff.find((part) => part.type === 'missing' || part.type === 'move-target');
          let revealIndex = -1;

          if (missingPiece) {
            revealIndex = correctWords.findIndex((word) => word.toLowerCase() === String(missingPiece.text || '').toLowerCase());
          }

          if (revealIndex < 0) {
            const scanLimit = Math.max(correctWords.length, currentWords.length);
            for (let i = 0; i < scanLimit; i += 1) {
              if ((currentWords[i] || '').toLowerCase() !== (correctWords[i] || '').toLowerCase()) {
                revealIndex = i;
                break;
              }
            }
          }

          if (revealIndex < 0) revealIndex = Math.min(currentWords.length, correctWords.length - 1);

          const nextWords = [...currentWords];
          nextWords[revealIndex] = correctWords[revealIndex];
          input.value = nextWords.join(' ');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();

          setTimeout(updateHintCostBadge, 800);
        } finally {
          btnHintReveal.disabled = false;
        }
      });
    }

    // Transcript Glimpse Skill
    const btnTranscriptGlimpse = document.getElementById("skill-transcript-glimpse");
    if (btnTranscriptGlimpse) {
      btnTranscriptGlimpse.addEventListener("click", async () => {
        const actionPopover = document.getElementById('action-popover-menu');
        if (actionPopover) actionPopover.style.display = "none";

        const question = typeDatabase.find(q => q.id === currentTypeQuestionId);
        if (!question) return;

        try {
          btnTranscriptGlimpse.disabled = true;
          const skillResult = await useActiveSkillForAttempt('transcript_glimpse', 'type', currentTypeQuestionId);

          if (skillResult?.success) {
            window.hintUsedForCurrentQuestion = true;

            showTranscriptGlimpseOverlay(question.correctSentence, 2000);

            setTimeout(updateHintCostBadge, 800);
          }
        } finally {
          btnTranscriptGlimpse.disabled = false;
        }
      });
    }
  }

  // Event listeners for remove mastery buttons
  if (removeMasteryTypeBtn) {
    removeMasteryTypeBtn.addEventListener("click", async () => {
      await handleRemoveMastery('type', currentTypeQuestionId);
    });
  }

  if (removeMasterySpeakBtn) {
    removeMasterySpeakBtn.addEventListener("click", async () => {
      await handleRemoveMastery('speak', currentSpeakQuestionId);
    });
  }
  const transcriptionText = document.getElementById("transcription-text");
  const recordingStatus = document.getElementById("recording-status");
  const scoreSpeak = document.getElementById("score-speak");
  const vocabularyPanel = document.getElementById("vocabulary-practice");
  const vocabularyWords = document.getElementById("vocabulary-words");
  const pronunciationPanel = document.getElementById("pronunciation-practice");
  const pronunciationWords = document.getElementById("pronunciation-words");
  const breakdownPanel = document.getElementById("breakdown-mode");
  const breakdownLines = document.getElementById("breakdown-lines");
  const breakdownBeginningBtn = document.getElementById("breakdown-beginning");
  const breakdownEndBtn = document.getElementById("breakdown-end");
  // Same vocabulary panels
  const sameVocabPanelType = document.getElementById("same-vocab-type");
  const sameVocabSentencesType = document.getElementById("same-vocab-sentences-type");
  const sameVocabPanelSpeak = document.getElementById("same-vocab-speak");
  const sameVocabSentencesSpeak = document.getElementById("same-vocab-sentences-speak");


  /**
   * Reset all scaffolding features (below the input) for the current mode
   * Called when a new question is selected or the Retry button is pressed
   */
  function resetScaffolding() {
    log.debug("Resetting scaffolding...");

    // 0. Stop ongoing background processes
    if (animationTimer) {
      clearTimeout(animationTimer);
      animationTimer = null;
    }
    animationOnComplete = null;

    if (synth) {
      synth.cancel();
    }

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    // Stop Extended audio players (avoid background playback when switching modes)
    const audioExtendedEl = document.getElementById('audio-extended');
    if (audioExtendedEl) {
      audioExtendedEl.pause();
      audioExtendedEl.currentTime = 0;
    }
    const audioPhrasesEl = document.getElementById('audio-phrases');
    if (audioPhrasesEl) {
      audioPhrasesEl.pause();
      audioPhrasesEl.currentTime = 0;
    }

    // 1. Clear result and score displays
    if (result) {
      result.innerHTML = "";
      result.style.display = "none";
    }
    if (score) score.textContent = "Points: 0";
    if (scoreSpeak) scoreSpeak.textContent = "Points: 0";

    // 2. Hide animation panel
    if (animationPanel) animationPanel.style.display = "none";
    if (animationBox) animationBox.innerHTML = "";

    // 3. Clear vocabulary practice
    if (vocabularyPanel) vocabularyPanel.style.display = "none";


    // 4. Clear pronunciation practice
    if (pronunciationPanel) pronunciationPanel.style.display = "none";
    if (breakdownPanel) breakdownPanel.style.display = "none";


    // 5. Clear same vocabulary panels
    if (sameVocabPanelType) sameVocabPanelType.style.display = "none";
    if (sameVocabPanelSpeak) sameVocabPanelSpeak.style.display = "none";

    // 6. Reset Transcription text (Speak mode)
    if (transcriptionText) {
      transcriptionText.textContent = "Click 'Start Recording' and speak...";
      transcriptionText.classList.add("empty");
    }

    // 7. Clear reading timer if any (Extended Listening)
    if (window.readingTimer) {
      clearInterval(window.readingTimer);
      window.readingTimer = null;
    }

    // 8. Reset Take Notes mode if it exists
    if (window.TakeNotesMode && typeof window.TakeNotesMode.reset === 'function') {
      window.TakeNotesMode.reset();
    }

    if (window.RFIBMode && typeof window.RFIBMode.reset === 'function') {
      window.RFIBMode.reset();
    }

    // 9. Stop Speech Recognition
    if (typeof isRecording !== 'undefined' && isRecording && typeof recognition !== 'undefined' && recognition) {
      recognition.stop();
      isRecording = false;
    }
    if (typeof wordRecognition !== 'undefined' && wordRecognition) {
      wordRecognition.stop();
      wordRecognition = null;
      if (typeof currentWordIndex !== 'undefined') currentWordIndex = -1;
    }
    if (typeof breakdownRecognition !== 'undefined' && breakdownRecognition) {
      breakdownRecognition.stop();
      breakdownRecognition = null;
    }

    // Reset internal state variables
    lastDiffType = [];
    lastDiffSpeak = [];
    vocabularyPracticeWordsType = [];
    vocabularyPracticeWordsSpeak = [];

    // Reset Performance Tracking Variables
    window.questionStartTime = null;
    window.currentQuestionAttempts = 0; // Will specific to mode if needed, but simple counter works for now
    window.hintUsedForCurrentQuestion = false;
  }

  /**
   * Show grammar warning popup
   * @param {string[]} warnings - Array of warning messages to display
   */
  function showGrammarWarning(warnings) {
    const modal = document.getElementById("grammar-warning-modal");
    const warningList = document.getElementById("grammar-warning-list");
    const okBtn = document.getElementById("grammar-warning-ok-btn");
    const closeBtn = document.getElementById("grammar-warning-close-btn");

    if (!modal || !warningList) return;

    // Populate warning list
    warningList.innerHTML = warnings
      .map(msg => `<li><span class="warning-bullet">•</span>${msg}</li>`)
      .join("");

    // Show modal
    modal.style.display = "flex";

    // Close handlers
    const closeModal = () => {
      modal.style.display = "none";
    };

    if (okBtn) okBtn.onclick = closeModal;
    if (closeBtn) closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };
  }

  // Speech recognition
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isRecording = false;
  let transcription = "";
  let wordRecognition = null; // For individual word pronunciation practice
  let currentWordIndex = -1; // Track which word is being practiced
  let sameVocabRecognitions = {}; // Store recognition instances for same vocab items (Speak mode)
  let sameVocabTranscriptions = {}; // Store transcriptions for each same vocab item (Speak mode)

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      recordingStatus.textContent = "Recording... (speak now)";
    };

    recognition.onaudiostart = () => {
      // Audio capture started - no need to log
    };

    recognition.onsoundstart = () => {
      // Sound detected - no need to log
    };

    recognition.onresult = (event) => {
      // Build complete transcript from ALL results (not just new ones)
      // This ensures we keep everything even after pauses/restarts
      let newFinalText = "";
      let interimText = "";

      // Process results starting from resultIndex (new results)
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          newFinalText += transcript + " ";
        } else {
          interimText += transcript;
        }
      }

      // If we got new final text, append it to our accumulated transcription
      if (newFinalText.trim()) {
        transcription = (transcription ? transcription + " " : "") + newFinalText.trim();
      }

      // Display: accumulated final transcript + current interim text
      const displayText = transcription + (interimText ? " " + interimText : "");
      transcriptionText.textContent = displayText || "Click 'Start Recording' and speak...";
      transcriptionText.classList.toggle("empty", !displayText);
    };

    recognition.onerror = (event) => {
      // Ignore "aborted" errors - they happen when we stop recognition intentionally
      if (event.error === "aborted") {
        return;
      }

      log.error("Speech recognition error:", event.error);
      if (event.error === "no-speech") {
        recordingStatus.textContent = "No speech detected. Try speaking louder or closer to the microphone.";
      } else if (event.error === "not-allowed") {
        recordingStatus.textContent = "Microphone access denied. Please allow microphone access in your browser settings.";
        isRecording = false;
        recordBtn.textContent = "Start Recording";
        recordBtn.classList.remove("recording");
        recordingStatus.classList.remove("active");
      } else if (event.error === "audio-capture") {
        recordingStatus.textContent = "No microphone found. Please connect a microphone.";
        isRecording = false;
        recordBtn.textContent = "Start Recording";
        recordBtn.classList.remove("recording");
        recordingStatus.classList.remove("active");
      } else if (event.error === "network") {
        recordingStatus.textContent = "Network error. Please check your internet connection.";
      } else {
        recordingStatus.textContent = `Error: ${event.error}`;
      }
    };

    recognition.onend = () => {
      if (isRecording) {
        // Restart if still supposed to be recording
        // Add a small delay to avoid immediate restart conflicts
        setTimeout(() => {
          if (isRecording) {
            try {
              log.debug("Restarting recognition...");
              recognition.start();
            } catch (e) {
              // Already started or error - check if it's a real error
              if (e.name !== "InvalidStateError" && !e.message.includes("already started")) {
                log.error("Failed to restart recognition:", e);
                isRecording = false;
                recordBtn.textContent = "Start Recording";
                recordBtn.classList.remove("recording");
                recordingStatus.classList.remove("active");
              }
            }
          }
        }, 100);
      } else {
        recordBtn.textContent = "Start Recording";
        recordBtn.classList.remove("recording");
        recordingStatus.classList.remove("active");
      }
    };
  } else {
    recordBtn.disabled = true;
    recordBtn.textContent = "Speech Recognition Not Available";
    transcriptionText.textContent = "Your browser does not support speech recognition. Please use Chrome or Edge.";
  }

  const STEP_INTERVAL_MS = 2400;
  let lastSteps = [];
  let lastAnimationMode = false; // Track if last animation was in speak mode
  let animationTimer = null;
  const synth = window.speechSynthesis || null;

  const normalize = (text) =>
    text
      .toLowerCase()
      .replace(/[.,!?;:]/g, " ") // drop punctuation for comparison
      .trim()
      .replace(/\s+/g, " ");

  // correctWordCount will be calculated dynamically based on current correctSentence
  const getCorrectWordCount = (mode = null) => {
    // Determine mode from active tab if not provided
    if (!mode) {
      mode = document.getElementById("tab-type").classList.contains("active") ? "type" : "speak";
    }
    const correctSentence = mode === "type" ? correctSentenceType : correctSentenceSpeak;
    if (!correctSentence) return 0;
    return normalize(correctSentence).split(" ").filter(Boolean).length;
  };

  const diffWords = (user, correct) => {
    const userWords = normalize(user).split(" ").filter(Boolean);
    const correctWordsLocal = normalize(correct).split(" ").filter(Boolean);

    const m = userWords.length;
    const n = correctWordsLocal.length;
    const dp = Array.from({ length: m + 1 }, () =>
      Array(n + 1).fill(0)
    );

    for (let i = 1; i <= m; i += 1) {
      for (let j = 1; j <= n; j += 1) {
        if (userWords[i - 1] === correctWordsLocal[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const pieces = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (
        i > 0 &&
        j > 0 &&
        userWords[i - 1] === correctWordsLocal[j - 1]
      ) {
        pieces.push({ text: correctWordsLocal[j - 1], type: "match" });
        i -= 1;
        j -= 1;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        pieces.push({ text: correctWordsLocal[j - 1], type: "missing" });
        j -= 1;
      } else {
        pieces.push({ text: userWords[i - 1], type: "extra" });
        i -= 1;
      }
    }

    const reversed = pieces.reverse();

    const missingCounts = reversed.reduce((acc, part) => {
      if (part.type === "missing") acc[part.text] = (acc[part.text] || 0) + 1;
      return acc;
    }, {});

    const mapped = reversed.map((part) => {
      if (part.type === "extra" && missingCounts[part.text] > 0) {
        missingCounts[part.text] -= 1;
        return { ...part, type: "misplaced" };
      }
      return part;
    });

    // Pair misplaced with one missing instance to mark destination
    const pendingMove = {};
    mapped.forEach((part, idx) => {
      if (part.type === "misplaced") {
        pendingMove[part.text] = (pendingMove[part.text] || 0) + 1;
      }
      if (part.type === "missing" && pendingMove[part.text] > 0) {
        pendingMove[part.text] -= 1;
        mapped[idx] = { ...part, type: "move-target" };
      }
    });

    return mapped;
  };

  function getWordDiffMetrics(diffPieces) {
    const pieces = Array.isArray(diffPieces) ? diffPieces : [];
    const matches = pieces.filter((p) => p.type === "match").length;
    const missing = pieces.filter((p) => p.type === "missing" || p.type === "move-target").length;
    const extra = pieces.filter((p) => p.type === "extra" || p.type === "misplaced").length;
    const denom = (2 * matches) + missing + extra;
    const f1 = denom > 0 ? Math.max(0, Math.min(1, (2 * matches) / denom)) : 0;

    return {
      matches,
      missing,
      extra,
      f1
    };
  }

  const renderDiff = (diff) => {
    return diff
      .map((part) => {
        if (part.type === "match") return part.text;
        if (part.type === "missing")
          return `<span class="word missing">${part.text}</span>`;
        if (part.type === "extra")
          return `<span class="word extra">${part.text}</span>`;
        if (part.type === "misplaced")
          return `<span class="word misplaced">${part.text}</span>`;
        return part.text;
      })
      .join(" ");
  };

  const choosePronunciation = (word, nextWord) => {
    const w = (word || "").toLowerCase();
    if (w === "the") {
      const n = (nextWord || "").trim().toLowerCase();
      const startsWithVowel = /^[aeiou]/.test(n);
      return startsWithVowel ? "thee" : "thuh";
    }
    return word;
  };

  const speakWord = (word, nextWord = "") => {
    if (!synth || !word) return;
    const spokenText = choosePronunciation(word, nextWord);
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(spokenText);
    utter.lang = "en-US";
    // Try to prefer a bright/happy US female voice by name substring if available
    const voices = synth.getVoices();
    const preferred = voices.find((v) =>
      /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
    );
    if (preferred) utter.voice = preferred;
    utter.rate = 1.05; // a bit quicker for a brighter feel
    utter.pitch = 1.1; // slightly higher pitch
    synth.speak(utter);
  };

  const renderAnimationStep = (step) => {
    const words = step.words
      .map((w, idx) => {
        const display =
          step.highlight &&
            step.highlight.index === idx &&
            step.highlight.type === "remove" &&
            step.highlight.ghost
            ? step.highlight.ghost
            : w === ""
              ? "&nbsp;"
              : w;
        const baseClass = w === "" ? "anim-word anim-base anim-empty" : "anim-word anim-base";
        const cls =
          step.highlight && step.highlight.index === idx
            ? step.highlight.type === "add"
              ? "anim-word anim-add"
              : "anim-word anim-remove"
            : baseClass;
        const dataWord = w ? ` data-word="${w}"` : "";
        return `<span class="${cls}"${dataWord}>${display}</span>`;
      })
      .join(" ");

    animationBox.innerHTML = `
      <div class="anim-line"><strong>${step.label || ""}</strong></div>
      <div class="anim-step">${words}</div>
    `;
  };

  const playWordAudio = (word, nextWord = "") => {
    speakWord(word, nextWord);
  };

  let currentAnimationIdx = 0;
  let animationSteps = [];
  let animationOnComplete = null;
  let isSpeakModeAnimation = false;


  const continueAnimation = () => {
    currentAnimationIdx += 1;
    if (currentAnimationIdx >= animationSteps.length) {
      if (animationOnComplete) animationOnComplete();
      return;
    }

    const step = animationSteps[currentAnimationIdx];
    renderAnimationStep(step);

    if (step.speak) {
      const hi = step.highlight ? step.highlight.index : null;
      const nextW =
        step.speakNext !== undefined
          ? step.speakNext
          : hi !== null && hi !== undefined
            ? step.words[hi + 1] || ""
            : "";
      playWordAudio(step.speak, nextW);
    }

    // Continue to next step after interval
    animationTimer = setTimeout(continueAnimation, STEP_INTERVAL_MS);
  };

  const skipAnimation = () => {
    if (animationTimer) {
      clearTimeout(animationTimer);
      animationTimer = null;
    }
    if (synth) synth.cancel();

    // Jump to the last step
    if (animationSteps.length > 0) {
      currentAnimationIdx = animationSteps.length - 1;
      const lastStep = animationSteps[currentAnimationIdx];
      renderAnimationStep(lastStep);

      // Call the completion callback
      if (animationOnComplete) {
        animationOnComplete();
      }
    }
  };

  const playAnimation = (steps, onComplete = () => { }, isSpeakMode = false) => {
    if (!steps || !steps.length) {
      if (onComplete) onComplete();
      return;
    }
    if (animationTimer) clearTimeout(animationTimer);
    if (synth) synth.cancel();

    animationSteps = steps;
    animationOnComplete = onComplete;
    isSpeakModeAnimation = isSpeakMode;
    currentAnimationIdx = 0;

    // Ensure animation box exists and is visible
    if (!animationBox) {
      log.error("Animation box element not found");
      if (onComplete) onComplete();
      return;
    }

    renderAnimationStep(steps[0]);
    if (steps[0].speak) {
      const hi = steps[0].highlight ? steps[0].highlight.index : null;
      const nextW =
        steps[0].speakNext !== undefined
          ? steps[0].speakNext
          : hi !== null && hi !== undefined
            ? steps[0].words[hi + 1] || ""
            : "";
      playWordAudio(steps[0].speak, nextW);
    }

    animationTimer = setTimeout(continueAnimation, STEP_INTERVAL_MS);
  };

  const buildAnimationSteps = (userText, mode = null) => {
    // Determine mode from active tab if not provided
    if (!mode) {
      mode = document.getElementById("tab-type").classList.contains("active") ? "type" : "speak";
    }
    const correctSentence = mode === "type" ? correctSentenceType : correctSentenceSpeak;
    const userWords = normalize(userText).split(" ").filter(Boolean);
    const correctWordsLocal = normalize(correctSentence).split(" ").filter(Boolean);
    const diff = diffWords(userText, correctSentence);

    const steps = [];
    const current = [...userWords]; // allow positions to shift naturally
    let curIdx = 0;
    let corIdx = 0;
    const moveQueue = [];

    steps.push({ label: "Your attempt", words: [...current] });

    diff.forEach((part) => {
      if (part.type === "match") {
        curIdx += 1;
        corIdx += 1;
        return;
      }

      if (part.type === "move-target") {
        const movedText = moveQueue.shift() || part.text;
        current.splice(curIdx, 0, movedText);
        steps.push({
          label: `Place "${movedText}"`,
          words: [...current],
          highlight: { index: curIdx, type: "add" },
          speakNext: current[curIdx + 1] || "",
        });
        curIdx += 1;
        corIdx += 1;
        return;
      }

      if (part.type === "missing") {
        current.splice(curIdx, 0, part.text);
        steps.push({
          label: `Add "${part.text}"`,
          words: [...current],
          highlight: { index: curIdx, type: "add" },
          speak: part.text,
          speakNext: correctWordsLocal[curIdx + 1] || "",
        });
        curIdx += 1;
        corIdx += 1;
        return;
      }

      // extra or misplaced -> remove
      const removedText = current[curIdx] || part.text;
      if (part.type === "misplaced") {
        moveQueue.push(removedText);
        const snapshot = [...current];
        steps.push({
          label: `Move "${removedText}"`,
          words: snapshot,
          highlight: { index: curIdx, type: "remove", ghost: removedText },
          speak: removedText,
        });
      } else {
        const snapshot = [...current];
        steps.push({
          label: `Remove "${removedText}"`,
          words: snapshot,
          highlight: { index: curIdx, type: "remove", ghost: removedText },
        });
      }
      current.splice(curIdx, 1); // remove and shift naturally
    });

    steps.push({ label: "Correct sentence", words: [...correctWordsLocal] });
    return steps;
  };

  // Tab switching
  tabType.addEventListener("click", async () => {
    document.getElementById('page-layout-wrapper')?.classList.remove('watch-active');
    // Hide Watch mode question panel
    const watchQuestionPanel = document.getElementById('watch-question-panel');
    if (watchQuestionPanel) watchQuestionPanel.style.display = 'none';
    // Pause Watch mode video and sync state for proper rewind detection later
    if (window.WatchMode && typeof window.WatchMode.pauseAndResetForTabSwitch === 'function') {
      window.WatchMode.pauseAndResetForTabSwitch();
    }
    tabType.classList.add("active");
    tabSpeak.classList.remove("active");
    tabExtended.classList.remove("active");
    if (tabWatch) tabWatch.classList.remove("active");
    if (tabNotes) tabNotes.classList.remove("active");
    if (tabPronounce) tabPronounce.classList.remove("active");
    modeType.classList.add("active");
    modeType.style.display = 'block';
    modeSpeak.classList.remove("active");
    modeSpeak.style.display = 'none';
    modeExtended.classList.remove("active");
    modeExtended.style.display = 'none';
    if (modeWatch) { modeWatch.classList.remove("active"); modeWatch.style.display = 'none'; }
    if (modeNotes) { modeNotes.classList.remove("active"); modeNotes.style.display = 'none'; }
    if (modePronounce) { modePronounce.classList.remove("active"); modePronounce.style.display = 'none'; }
    if (modeSGD) { modeSGD.classList.remove("active"); modeSGD.style.display = 'none'; }
    if (window.SGDMode && typeof window.SGDMode.reset === 'function') window.SGDMode.reset();
    if (modeEssay) { modeEssay.classList.remove("active"); modeEssay.style.display = 'none'; }
    if (window.WriteEssayMode && typeof window.WriteEssayMode.reset === 'function') window.WriteEssayMode.reset();

    // Rest active states
    document.querySelectorAll('.mode-switch-btn').forEach(btn => btn.classList.remove('active'));
    const typeModeBtn = document.querySelector('.mode-switch-btn[onclick*="type"]');
    if (typeModeBtn) typeModeBtn.classList.add('active');

    // Reset results and UI state
    resetScaffolding();

    // Reload the correct audio for Type mode
    if (typeDatabase.length > 0 && currentTypeQuestionId) {
      // Load all progress data for Type mode (to update dropdown)
      await loadAllProgressForMode("type");
      await loadQuestion("type", currentTypeQuestionId);
      // Load progress status for Type mode (independent from Speak mode)
      await loadProgressStatus(currentTypeQuestionId, "type");
      // Update progress panel for Type mode
      await updateProgressPanel("type");
    }
  });

  tabSpeak.addEventListener("click", async () => {
    document.getElementById('page-layout-wrapper')?.classList.remove('watch-active');
    // Hide Watch mode question panel
    const watchQuestionPanel = document.getElementById('watch-question-panel');
    if (watchQuestionPanel) watchQuestionPanel.style.display = 'none';
    // Pause Watch mode video and sync state for proper rewind detection later
    if (window.WatchMode && typeof window.WatchMode.pauseAndResetForTabSwitch === 'function') {
      window.WatchMode.pauseAndResetForTabSwitch();
    }
    tabSpeak.classList.add("active");
    tabType.classList.remove("active");
    tabExtended.classList.remove("active");
    if (tabWatch) tabWatch.classList.remove("active");
    if (tabNotes) tabNotes.classList.remove("active");
    if (tabPronounce) tabPronounce.classList.remove("active");
    if (tabSGD) tabSGD.classList.remove("active");
    modeSpeak.classList.add("active");
    modeSpeak.style.display = 'block';
    modeType.classList.remove("active");
    modeType.style.display = 'none';
    modeExtended.classList.remove("active");
    modeExtended.style.display = 'none';
    if (modeWatch) { modeWatch.classList.remove("active"); modeWatch.style.display = 'none'; }
    if (modeNotes) { modeNotes.classList.remove("active"); modeNotes.style.display = 'none'; }
    if (modePronounce) { modePronounce.classList.remove("active"); modePronounce.style.display = 'none'; }
    if (modeSGD) { modeSGD.classList.remove("active"); modeSGD.style.display = 'none'; }
    if (window.SGDMode && typeof window.SGDMode.reset === 'function') window.SGDMode.reset();
    if (modeEssay) { modeEssay.classList.remove("active"); modeEssay.style.display = 'none'; }
    if (window.WriteEssayMode && typeof window.WriteEssayMode.reset === 'function') window.WriteEssayMode.reset();

    // Rest active states
    document.querySelectorAll('.mode-switch-btn').forEach(btn => btn.classList.remove('active'));
    const speakModeBtn = document.querySelector('.mode-switch-btn[onclick*="speak"]');
    if (speakModeBtn) speakModeBtn.classList.add('active');

    // Reset results and UI state
    resetScaffolding();

    // Reload the correct audio for Speak mode
    if (speakDatabase.length > 0 && currentSpeakQuestionId) {
      log.debug(`[tabSpeak] Loading question ${currentSpeakQuestionId} for speak mode`);

      // Force clear audio before loading to ensure no artifacts
      if (audio) {
        audio.pause();
        while (audio.firstChild) audio.removeChild(audio.firstChild);
        audio.load();
      }

      // Load all progress data for Speak mode (to update dropdown)
      await loadAllProgressForMode("speak");
      await loadQuestion("speak", currentSpeakQuestionId);
      // Load progress status for Speak mode (independent from Type mode)
      await loadProgressStatus(currentSpeakQuestionId, "speak");
      // Update progress panel for Speak mode
      await updateProgressPanel("speak");
    } else {
      log.warn(`[tabSpeak] speakDatabase empty or invalid ID. Len: ${speakDatabase.length}, ID: ${currentSpeakQuestionId}`);
    }

    // Microphone access will be requested when user clicks "Start Recording"
  });

  tabExtended.addEventListener("click", () => {
    document.getElementById('page-layout-wrapper')?.classList.remove('watch-active');
    // Hide Watch mode question panel
    const watchQuestionPanel = document.getElementById('watch-question-panel');
    if (watchQuestionPanel) watchQuestionPanel.style.display = 'none';
    // Pause Watch mode video and sync state for proper rewind detection later
    if (window.WatchMode && typeof window.WatchMode.pauseAndResetForTabSwitch === 'function') {
      window.WatchMode.pauseAndResetForTabSwitch();
    }
    tabExtended.classList.add("active");
    tabType.classList.remove("active");
    tabSpeak.classList.remove("active");
    if (tabWatch) tabWatch.classList.remove("active");
    if (tabNotes) tabNotes.classList.remove("active");
    if (tabPronounce) tabPronounce.classList.remove("active");
    if (tabSGD) tabSGD.classList.remove("active");
    modeExtended.classList.add("active");
    modeExtended.style.display = 'block';
    modeType.classList.remove("active");
    modeType.style.display = 'none';
    modeSpeak.classList.remove("active");
    modeSpeak.style.display = 'none';
    if (modeWatch) { modeWatch.classList.remove("active"); modeWatch.style.display = 'none'; }
    if (modeNotes) { modeNotes.classList.remove("active"); modeNotes.style.display = 'none'; }
    if (modePronounce) { modePronounce.classList.remove("active"); modePronounce.style.display = 'none'; }
    if (modeSGD) { modeSGD.classList.remove("active"); modeSGD.style.display = 'none'; }
    if (window.SGDMode && typeof window.SGDMode.reset === 'function') window.SGDMode.reset();
    if (modeEssay) { modeEssay.classList.remove("active"); modeEssay.style.display = 'none'; }
    if (window.WriteEssayMode && typeof window.WriteEssayMode.reset === 'function') window.WriteEssayMode.reset();

    // Rest active states
    document.querySelectorAll('.mode-switch-btn').forEach(btn => btn.classList.remove('active'));
    const extendedModeBtn = document.querySelector('.mode-switch-btn[onclick*="extended"]');
    if (extendedModeBtn) extendedModeBtn.classList.add('active');

    // Reset results and UI state
    resetScaffolding();

    // Lazy-load extended question only on first tab click
    if (!extendedQuestionLoaded && extendedDatabase.length > 0) {
      extendedQuestionLoaded = true;
      loadExtendedQuestion(currentExtendedQuestionId || 1);
    }

    // Start Tutorial if needed
    if (typeof window.startTutorial === 'function') {
      window.startTutorial('extended');
    }
  });

  // Expose loadExtendedIfNeeded globally for switchToMode
  window.loadExtendedIfNeeded = function () {
    if (!extendedQuestionLoaded && extendedDatabase.length > 0) {
      extendedQuestionLoaded = true;
      loadExtendedQuestion(currentExtendedQuestionId || 1);
    }
  };


  // Watch mode tab handler
  if (tabWatch) {
    tabWatch.addEventListener("click", async () => {
      const assetsReady = await ensureModeAssets('watch');
      if (!assetsReady) return;

      tabWatch.classList.add("active");
      tabType.classList.remove("active");
      tabSpeak.classList.remove("active");
      tabExtended.classList.remove("active");
      if (tabNotes) tabNotes.classList.remove("active");
      if (tabPronounce) tabPronounce.classList.remove("active");
      if (tabSGD) tabSGD.classList.remove("active");
      if (modeWatch) { modeWatch.classList.add("active"); modeWatch.style.display = 'block'; }
      modeType.classList.remove("active");
      modeType.style.display = 'none';
      modeSpeak.classList.remove("active");
      modeSpeak.style.display = 'none';
      modeExtended.classList.remove("active");
      modeExtended.style.display = 'none';
      if (modeNotes) { modeNotes.classList.remove("active"); modeNotes.style.display = 'none'; }
      if (modePronounce) { modePronounce.classList.remove("active"); modePronounce.style.display = 'none'; }
      if (modeSGD) { modeSGD.classList.remove("active"); modeSGD.style.display = 'none'; }
      if (window.SGDMode && typeof window.SGDMode.reset === 'function') window.SGDMode.reset();

      // Highlight active mode button
      document.querySelectorAll('.mode-switch-btn').forEach(btn => btn.classList.remove('active'));
      const watchModeBtn = document.querySelector('.mode-switch-btn[onclick*="watch"]');
      if (watchModeBtn) watchModeBtn.classList.add('active');

      // Reset Take Notes mode if it was active
      if (window.TakeNotesMode && typeof window.TakeNotesMode.reset === 'function') {
        window.TakeNotesMode.reset();
      }

      // Hide valid mode panels
      if (sameVocabPanelType) sameVocabPanelType.style.display = "none";
      if (sameVocabPanelSpeak) sameVocabPanelSpeak.style.display = "none";
      if (vocabularyPanel) vocabularyPanel.style.display = "none";
      if (pronunciationPanel) pronunciationPanel.style.display = "none";
      if (breakdownPanel) breakdownPanel.style.display = "none";

      // Stop any active recordings
      if (isRecording && recognition) {
        recognition.stop();
        isRecording = false;
      }
      if (wordRecognition) {
        wordRecognition.stop();
        wordRecognition = null;
        currentWordIndex = -1;
      }
      if (breakdownRecognition) {
        breakdownRecognition.stop();
        breakdownRecognition = null;
      }

      // Initialize Watch mode
      if (window.WatchMode) {
        window.WatchMode.init();
      }

      // Start Tutorial if needed
      if (typeof window.startTutorial === 'function') {
        window.startTutorial('watch');
      }
    });
  }

  // Notes mode tab handler
  if (tabNotes) {
    tabNotes.addEventListener("click", async () => {
      const assetsReady = await ensureModeAssets('notes');
      if (!assetsReady) return;

      document.getElementById('page-layout-wrapper')?.classList.remove('watch-active');
      // Hide Watch mode question panel
      const watchQuestionPanel = document.getElementById('watch-question-panel');
      if (watchQuestionPanel) watchQuestionPanel.style.display = 'none';
      // Pause Watch mode video and sync state for proper rewind detection later
      if (window.WatchMode && typeof window.WatchMode.pauseAndResetForTabSwitch === 'function') {
        window.WatchMode.pauseAndResetForTabSwitch();
      }
      tabNotes.classList.add("active");
      tabType.classList.remove("active");
      tabSpeak.classList.remove("active");
      tabExtended.classList.remove("active");
      if (tabWatch) tabWatch.classList.remove("active");
      if (tabPronounce) tabPronounce.classList.remove("active");
      if (tabSGD) tabSGD.classList.remove("active");
      if (modeNotes) { modeNotes.classList.add("active"); modeNotes.style.display = 'block'; }
      modeType.classList.remove("active");
      modeType.style.display = 'none';
      modeSpeak.classList.remove("active");
      modeSpeak.style.display = 'none';
      modeExtended.classList.remove("active");
      modeExtended.style.display = 'none';
      if (modeWatch) { modeWatch.classList.remove("active"); modeWatch.style.display = 'none'; }
      if (modePronounce) { modePronounce.classList.remove("active"); modePronounce.style.display = 'none'; }
      if (modeSGD) { modeSGD.classList.remove("active"); modeSGD.style.display = 'none'; }
      if (window.SGDMode && typeof window.SGDMode.reset === 'function') window.SGDMode.reset();

      // Highlight active mode button
      document.querySelectorAll('.mode-switch-btn').forEach(btn => btn.classList.remove('active'));
      const notesModeBtn = document.querySelector('.mode-switch-btn[onclick*="notes"]');
      if (notesModeBtn) notesModeBtn.classList.add('active');

      // Hide valid mode panels
      if (sameVocabPanelType) sameVocabPanelType.style.display = "none";
      if (sameVocabPanelSpeak) sameVocabPanelSpeak.style.display = "none";
      if (vocabularyPanel) vocabularyPanel.style.display = "none";
      if (pronunciationPanel) pronunciationPanel.style.display = "none";
      if (breakdownPanel) breakdownPanel.style.display = "none";

      // Stop any active recordings
      if (isRecording && recognition) {
        recognition.stop();
        isRecording = false;
      }

      // Initialize Take Notes mode
      if (window.TakeNotesMode) {
        window.TakeNotesMode.loadEntries();
      }

      // Start Tutorial if needed
      if (typeof window.startTutorial === 'function') {
        window.startTutorial('notes');
      }
    });
  }

  // SGD mode tab handler
  if (tabSGD) {
    tabSGD.addEventListener("click", async () => {
      document.getElementById('page-layout-wrapper')?.classList.remove('watch-active');
      const watchQuestionPanel = document.getElementById('watch-question-panel');
      if (watchQuestionPanel) watchQuestionPanel.style.display = 'none';
      if (window.WatchMode && typeof window.WatchMode.pauseAndResetForTabSwitch === 'function') {
        window.WatchMode.pauseAndResetForTabSwitch();
      }
      if (tabSGD) tabSGD.classList.add("active");
      tabType.classList.remove("active");
      tabSpeak.classList.remove("active");
      tabExtended.classList.remove("active");
      if (tabWatch) tabWatch.classList.remove("active");
      if (tabNotes) tabNotes.classList.remove("active");
      if (tabPronounce) tabPronounce.classList.remove("active");
      if (tabEssay) tabEssay.classList.remove("active");
      if (modeSGD) { modeSGD.classList.add("active"); modeSGD.style.display = 'block'; }
      if (modeEssay) { modeEssay.classList.remove("active"); modeEssay.style.display = 'none'; }
      if (window.WriteEssayMode && typeof window.WriteEssayMode.reset === 'function') window.WriteEssayMode.reset();
      modeType.classList.remove("active");
      modeType.style.display = 'none';
      modeSpeak.classList.remove("active");
      modeSpeak.style.display = 'none';
      modeExtended.classList.remove("active");
      modeExtended.style.display = 'none';
      if (modeWatch) { modeWatch.classList.remove("active"); modeWatch.style.display = 'none'; }
      if (modeNotes) { modeNotes.classList.remove("active"); modeNotes.style.display = 'none'; }
      if (modePronounce) { modePronounce.classList.remove("active"); modePronounce.style.display = 'none'; }

      // Highlight active mode button
      document.querySelectorAll('.mode-switch-btn').forEach(btn => btn.classList.remove('active'));
      const sgdModeBtn = document.querySelector('.mode-switch-btn[onclick*="sgd"]');
      if (sgdModeBtn) sgdModeBtn.classList.add('active');

      // Hide other panels
      if (sameVocabPanelType) sameVocabPanelType.style.display = "none";
      if (sameVocabPanelSpeak) sameVocabPanelSpeak.style.display = "none";
      if (vocabularyPanel) vocabularyPanel.style.display = "none";
      if (pronunciationPanel) pronunciationPanel.style.display = "none";
      if (breakdownPanel) breakdownPanel.style.display = "none";

      // Stop any active recordings
      if (isRecording && recognition) {
        recognition.stop();
        isRecording = false;
      }

      // Reset Take Notes mode if it was active
      if (window.TakeNotesMode && typeof window.TakeNotesMode.reset === 'function') {
        window.TakeNotesMode.reset();
      }

      // Initialize SGD mode
      if (window.SGDMode) {
        window.SGDMode.loadEntries();
      }
    });
  }

  // Write Essay mode tab handler
  if (tabEssay) {
    tabEssay.addEventListener("click", async () => {
      document.getElementById('page-layout-wrapper')?.classList.remove('watch-active');
      const watchQuestionPanel = document.getElementById('watch-question-panel');
      if (watchQuestionPanel) watchQuestionPanel.style.display = 'none';
      if (window.WatchMode && typeof window.WatchMode.pauseAndResetForTabSwitch === 'function') {
        window.WatchMode.pauseAndResetForTabSwitch();
      }
      if (tabEssay) tabEssay.classList.add("active");
      tabType.classList.remove("active");
      tabSpeak.classList.remove("active");
      tabExtended.classList.remove("active");
      if (tabWatch) tabWatch.classList.remove("active");
      if (tabNotes) tabNotes.classList.remove("active");
      if (tabSGD) tabSGD.classList.remove("active");
      if (tabPronounce) tabPronounce.classList.remove("active");
      if (modeEssay) { modeEssay.classList.add("active"); modeEssay.style.display = 'block'; }
      modeType.classList.remove("active");
      modeType.style.display = 'none';
      modeSpeak.classList.remove("active");
      modeSpeak.style.display = 'none';
      modeExtended.classList.remove("active");
      modeExtended.style.display = 'none';
      if (modeWatch) { modeWatch.classList.remove("active"); modeWatch.style.display = 'none'; }
      if (modeNotes) { modeNotes.classList.remove("active"); modeNotes.style.display = 'none'; }
      if (modePronounce) { modePronounce.classList.remove("active"); modePronounce.style.display = 'none'; }
      if (modeSGD) { modeSGD.classList.remove("active"); modeSGD.style.display = 'none'; }
      if (window.SGDMode && typeof window.SGDMode.reset === 'function') window.SGDMode.reset();

      // Highlight active mode button
      document.querySelectorAll('.mode-switch-btn').forEach(btn => btn.classList.remove('active'));
      const essayModeBtn = document.querySelector('.mode-switch-btn[onclick*="essay"]');
      if (essayModeBtn) essayModeBtn.classList.add('active');

      // Hide other panels
      if (sameVocabPanelType) sameVocabPanelType.style.display = "none";
      if (sameVocabPanelSpeak) sameVocabPanelSpeak.style.display = "none";
      if (vocabularyPanel) vocabularyPanel.style.display = "none";
      if (pronunciationPanel) pronunciationPanel.style.display = "none";
      if (breakdownPanel) breakdownPanel.style.display = "none";

      // Stop any active recordings
      if (isRecording && recognition) {
        recognition.stop();
        isRecording = false;
      }

      // Reset Take Notes mode if it was active
      if (window.TakeNotesMode && typeof window.TakeNotesMode.reset === 'function') {
        window.TakeNotesMode.reset();
      }

      // Initialize Write Essay mode
      if (window.WriteEssayMode && typeof window.WriteEssayMode.init === 'function') {
        window.WriteEssayMode.init();
      } else if (window.WriteEssayMode && typeof window.WriteEssayMode.loadEntries === 'function') {
        window.WriteEssayMode.loadEntries();
      }
    });
  }

  // Pronounce mode tab handler
  const tabPronounce = document.getElementById('tab-pronounce');
  // pronunciationPanel is already defined globally


  if (tabPronounce) {
    tabPronounce.addEventListener("click", () => {
      document.getElementById('page-layout-wrapper')?.classList.remove('watch-active');
      // Hide Watch mode question panel
      const watchQuestionPanel = document.getElementById('watch-question-panel');
      if (watchQuestionPanel) watchQuestionPanel.style.display = 'none';

      // Pause Watch mode video
      if (window.WatchMode && typeof window.WatchMode.pauseAndResetForTabSwitch === 'function') {
        window.WatchMode.pauseAndResetForTabSwitch();
      }

      tabPronounce.classList.add("active");
      tabType.classList.remove("active");
      tabSpeak.classList.remove("active");
      tabExtended.classList.remove("active");
      if (tabWatch) tabWatch.classList.remove("active");
      if (tabNotes) tabNotes.classList.remove("active");
      if (tabSGD) tabSGD.classList.remove("active");

      modeType.classList.remove("active");
      modeType.style.display = 'none';
      modeSpeak.classList.remove("active");
      modeSpeak.style.display = 'none';
      modeExtended.classList.remove("active");
      modeExtended.style.display = 'none';
      if (modeWatch) { modeWatch.classList.remove("active"); modeWatch.style.display = 'none'; }
      if (modeNotes) { modeNotes.classList.remove("active"); modeNotes.style.display = 'none'; }
      if (modeSGD) { modeSGD.classList.remove("active"); modeSGD.style.display = 'none'; }
      if (window.SGDMode && typeof window.SGDMode.reset === 'function') window.SGDMode.reset();
      if (modeEssay) { modeEssay.classList.remove("active"); modeEssay.style.display = 'none'; }
      if (window.WriteEssayMode && typeof window.WriteEssayMode.reset === 'function') window.WriteEssayMode.reset();
      if (modePronounce) { modePronounce.classList.add("active"); modePronounce.style.display = 'block'; }

      // Highlight active mode button
      document.querySelectorAll('.mode-switch-btn').forEach(btn => btn.classList.remove('active'));
      const pronounceModeBtn = document.querySelector('.mode-switch-btn[onclick*="pronounce"]');
      if (pronounceModeBtn) pronounceModeBtn.classList.add('active');

      // Hide Speak mode's Pronunciation Practice panel (it belongs to Speak, not Pronounce)
      if (pronunciationPanel) {
        pronunciationPanel.style.display = 'none';
      }

      // Stop any active recordings
      if (isRecording && recognition) {
        recognition.stop();
        isRecording = false;
      }
      if (typeof wordRecognition !== 'undefined' && wordRecognition) {
        wordRecognition.stop();
        currentWordIndex = -1;
      }

      // Start Tutorial if needed
      if (typeof window.startTutorial === 'function') {
        window.startTutorial('pronounce');
      }
    });
  }

  // Extended Listening mode elements
  let extendedDatabase = [];
  let currentExtendedQuestionId = 1;
  let extendedCorrectTranscript = "";
  let extendedGappedTranscript = "";
  let extendedGapAnswers = {}; // Store user answers for gaps
  let readingTimer = null;
  let readingTimeLeft = 30;
  const modeLoadRequestIds = {
    type: 0,
    speak: 0,
    extended: 0
  };

  const beginModeLoadRequest = (mode) => {
    if (!Object.prototype.hasOwnProperty.call(modeLoadRequestIds, mode)) {
      return 0;
    }

    modeLoadRequestIds[mode] += 1;
    return modeLoadRequestIds[mode];
  };

  const isStaleModeLoadRequest = (mode, requestId) => {
    return !Object.prototype.hasOwnProperty.call(modeLoadRequestIds, mode) ||
      modeLoadRequestIds[mode] !== requestId;
  };

  const clearExtendedReadingTimer = () => {
    if (readingTimer) {
      clearInterval(readingTimer);
      readingTimer = null;
    }
    if (window.readingTimer) {
      clearInterval(window.readingTimer);
      window.readingTimer = null;
    }
  };

  const questionSelectExtended = document.getElementById("question-select-extended");
  const recommendationControlsExtended = document.getElementById("recommendation-controls-extended");
  const recommendedBtnExtended = document.getElementById("recommended-btn-extended");
  const recommendationSummaryExtended = document.getElementById("recommendation-summary-extended");
  const currentQuestionIdExtended = document.getElementById("current-question-id-extended");
  const totalQuestionsExtended = document.getElementById("total-questions-extended");
  const playPauseExtendedBtn = document.getElementById("play-pause-extended-btn");
  const checkExtendedBtn = document.getElementById("check-extended-btn");
  const supportModeBtn = document.getElementById("support-mode-btn");
  const redoExtendedBtn = document.getElementById("redo-extended-btn");
  const randomizeBlanksBtn = document.getElementById("randomize-blanks-btn");
  const supportPhrasesBtn = document.getElementById("support-phrases-btn");
  const playPausePhrasesBtn = document.getElementById("play-pause-phrases-btn");
  const skipReadingBtn = document.getElementById("skip-reading-btn");
  const readingTimerDisplay = document.getElementById("reading-timer-display");
  const readingPhase = document.getElementById("reading-phase");
  const listeningPhase = document.getElementById("listening-phase");
  const fullTranscript = document.getElementById("full-transcript");
  const gappedTranscript = document.getElementById("gapped-transcript");
  const checkResultExtended = document.getElementById("check-result-extended");
  const fillSingleWordsSection = document.getElementById("fill-single-words-section");
  const fillPhrasesSection = document.getElementById("fill-phrases-section");
  const phrasesTranscript = document.getElementById("phrases-transcript");
  const phraseLengthRadios = document.querySelectorAll('input[name="phrase-length"]');
  const checkPhrasesBtn = document.getElementById("check-phrases-btn");
  const redoPhrasesBtn = document.getElementById("redo-phrases-btn");
  const checkResultPhrases = document.getElementById("check-result-phrases");
  const audioExtended = document.getElementById("audio-extended");
  const audioPhrases = document.getElementById("audio-phrases");
  const audioSliderExtended = document.getElementById("audio-slider-extended");
  const speedSelectExtended = document.getElementById("speed-select-extended");
  const currentTimeExtended = document.getElementById("current-time-extended");
  const totalTimeExtended = document.getElementById("total-time-extended");

  // Phrases audio player controls
  const audioSliderPhrases = document.getElementById("audio-slider-phrases");
  const speedSelectPhrases = document.getElementById("speed-select-phrases");
  const currentTimePhrases = document.getElementById("current-time-phrases");
  const totalTimePhrases = document.getElementById("total-time-phrases");

  // Speech synthesis for word pronunciation in Extended Listening
  // Uses the same voice settings as Type mode
  const speakWordExtended = (word) => {
    // Clean the word (remove punctuation)
    const cleanWord = word.replace(/[.,!?;:()[\]{}'"]/g, '').trim();
    if (!cleanWord) return;

    // Cancel any ongoing speech
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(cleanWord);
    utterance.lang = 'en-US';

    // Use the same voice selection and settings as Type mode
    const setVoice = () => {
      const voices = speechSynthesis.getVoices();
      // Try to prefer a bright/happy US female voice by name substring if available
      const preferred = voices.find((v) =>
        /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
      );
      if (preferred) utterance.voice = preferred;

      // Use the same rate and pitch as Type mode
      utterance.rate = 1.05; // a bit quicker for a brighter feel
      utterance.pitch = 1.1; // slightly higher pitch
      utterance.volume = 1;

      speechSynthesis.speak(utterance);
    };

    // Ensure voices are loaded
    if (speechSynthesis.getVoices().length === 0) {
      speechSynthesis.onvoiceschanged = () => {
        setVoice();
      };
    } else {
      setVoice();
    }
  };

  // Make words in full transcript clickable
  const makeWordsClickable = (container, text) => {
    // Split text into words and punctuation, preserving spaces
    const words = text.split(/(\s+)/);
    const html = words.map(word => {
      const trimmed = word.trim();
      if (!trimmed || /^\s+$/.test(word)) {
        return word; // Return spaces as-is
      }
      // Check if it's punctuation only
      if (/^[.,!?;:()[\]{}'"]+$/.test(trimmed)) {
        return word; // Return punctuation as-is
      }
      // Make word clickable
      const cleanWord = trimmed.replace(/[.,!?;:()[\]{}'"]/g, '');
      if (cleanWord) {
        return `<span class="clickable-word" data-word="${cleanWord}">${word}</span>`;
      }
      return word;
    }).join('');

    container.innerHTML = html;

    // Add click listeners
    container.querySelectorAll('.clickable-word').forEach(span => {
      span.addEventListener('click', (e) => {
        const word = e.target.dataset.word || e.target.textContent.trim();
        speakWordExtended(word);

        // Visual feedback - highlight briefly
        e.target.classList.add('word-speaking');
        setTimeout(() => {
          e.target.classList.remove('word-speaking');
        }, 500);
      });
    });
  };

  // Make words in gapped transcript clickable (excluding gap inputs)
  const makeWordsInGappedTranscriptClickable = (container) => {
    // Get all text nodes and wrap words
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      // Skip if parent is an input element
      if (node.parentElement && node.parentElement.classList.contains('gap-input')) {
        continue;
      }
      textNodes.push(node);
    }

    textNodes.forEach(textNode => {
      const text = textNode.textContent;
      const words = text.split(/(\s+)/);
      const fragment = document.createDocumentFragment();

      words.forEach(word => {
        const trimmed = word.trim();
        if (!trimmed || /^\s+$/.test(word)) {
          fragment.appendChild(document.createTextNode(word));
          return;
        }
        // Check if it's punctuation only
        if (/^[.,!?;:()[\]{}'"]+$/.test(trimmed)) {
          fragment.appendChild(document.createTextNode(word));
          return;
        }
        // Make word clickable
        const cleanWord = trimmed.replace(/[.,!?;:()[\]{}'"]/g, '');
        if (cleanWord) {
          const span = document.createElement('span');
          span.className = 'clickable-word';
          span.textContent = word;
          span.dataset.word = cleanWord;
          span.addEventListener('click', (e) => {
            const word = e.target.dataset.word || e.target.textContent.trim();
            speakWordExtended(word);

            // Visual feedback - highlight briefly
            e.target.classList.add('word-speaking');
            setTimeout(() => {
              e.target.classList.remove('word-speaking');
            }, 500);
          });
          fragment.appendChild(span);
        } else {
          fragment.appendChild(document.createTextNode(word));
        }
      });

      textNode.parentNode.replaceChild(fragment, textNode);
    });
  };

  // Identify key content words (nouns, verbs, adjectives, adverbs - excluding common function words)
  // Excludes: names (capitalized words), words with "-", and function words
  const isContentWord = (word, originalWord, isSentenceStart = false) => {
    // Exclude words with hyphen (e.g., "over-saturated")
    if (originalWord.includes('-')) {
      return false;
    }

    // Exclude names (proper nouns) - words that are capitalized in the middle of sentences
    // Allow capitalized words at sentence start (they might be regular words)
    const cleanOriginal = originalWord.replace(/[.,!?;:]/g, '');
    if (!isSentenceStart && cleanOriginal.length > 0) {
      const firstChar = cleanOriginal[0];
      // If word starts with uppercase and is not at sentence start, it's likely a name
      if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
        // Check if the rest of the word is lowercase (e.g., "John", "Mary")
        // or if it's all uppercase (e.g., "USA", "NASA")
        const restOfWord = cleanOriginal.slice(1);
        if (restOfWord === restOfWord.toLowerCase() || cleanOriginal === cleanOriginal.toUpperCase()) {
          // It's likely a name - exclude it
          return false;
        }
      }
    }

    const functionWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'from', 'up', 'about', 'into', 'through', 'during', 'including', 'until', 'against', 'among',
      'throughout', 'despite', 'towards', 'upon', 'concerning', 'is', 'are', 'was', 'were', 'be',
      'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'will',
      'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall', 'this', 'that', 'these',
      'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs'
    ]);
    const cleanWord = word.toLowerCase().replace(/[.,!?;:]/g, '');
    return !functionWords.has(cleanWord) && cleanWord.length > 2;
  };

  // Generate gaps in transcript (max 1 per sentence, minimum 10 words between gaps)
  // Randomizes gap selection for variety
  const generateGaps = (transcript) => {
    const sentences = transcript.split(/([.!?]+\s*)/).filter(s => s.trim().length > 0);
    const gappedSentences = [];
    let lastGapPosition = -20;
    let totalWordCount = 0;

    sentences.forEach((sentence) => {
      const words = sentence.trim().split(/\s+/);
      if (words.length === 0) {
        gappedSentences.push(sentence);
        return;
      }

      const contentWordIndices = [];
      words.forEach((word, idx) => {
        // Check if this is the first word of the sentence (after punctuation)
        const isSentenceStart = idx === 0;
        if (isContentWord(word.toLowerCase(), word, isSentenceStart)) {
          contentWordIndices.push(idx);
        }
      });

      if (contentWordIndices.length === 0) {
        gappedSentences.push(sentence);
        totalWordCount += words.length;
        return;
      }

      // Filter indices that meet the minimum distance requirement
      const validIndices = contentWordIndices.filter(idx => {
        const positionFromLastGap = totalWordCount + idx - lastGapPosition;
        return positionFromLastGap >= 10;
      });

      if (validIndices.length === 0) {
        gappedSentences.push(sentence);
        totalWordCount += words.length;
        return;
      }

      // Randomly select one of the valid indices
      const randomIndex = Math.floor(Math.random() * validIndices.length);
      const gapIndex = validIndices[randomIndex];

      const gappedWords = [...words];
      const gapWord = gappedWords[gapIndex];
      const cleanGapWord = gapWord.replace(/[.,!?;:]/g, '');
      gappedWords[gapIndex] = `<input type="text" class="gap-input" data-gap-id="${totalWordCount + gapIndex}" data-correct="${cleanGapWord}" placeholder="" /><span class="gap-speaker-icon" data-word="${cleanGapWord}" aria-label="Pronounce ${cleanGapWord}" role="button" tabindex="0" style="display: none;">🔊</span>`;

      gappedSentences.push(gappedWords.join(' '));
      lastGapPosition = totalWordCount + gapIndex;
      totalWordCount += words.length;
    });

    return gappedSentences.join(' ');
  };

  // Check if a word is a function word (preposition, determiner, etc.)
  const isFunctionWord = (word) => {
    const functionWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'from', 'up', 'about', 'into', 'through', 'during', 'including', 'until', 'against', 'among',
      'throughout', 'despite', 'towards', 'upon', 'concerning', 'is', 'are', 'was', 'were', 'be',
      'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'will',
      'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall', 'this', 'that', 'these',
      'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
      'very', 'quite', 'pretty', 'much', 'more', 'most', 'other', 'some', 'any', 'all', 'each', 'every'
    ]);
    const cleanWord = word.toLowerCase().replace(/[.,!?;:]/g, '');
    return functionWords.has(cleanWord);
  };

  // Check if a phrase is meaningful (has at least one content word and forms a coherent unit)
  const isMeaningfulPhrase = (words, startIndex) => {
    // Must have at least one content word
    let hasContentWord = false;
    let contentWordIndices = [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const isSentenceStart = (startIndex + i) === 0;
      if (isContentWord(word.toLowerCase(), word, isSentenceStart)) {
        hasContentWord = true;
        contentWordIndices.push(i);
      }
    }
    if (!hasContentWord) return false;

    const firstWord = words[0].toLowerCase().replace(/[.,!?;:]/g, '');
    const lastWord = words[words.length - 1].toLowerCase().replace(/[.,!?;:]/g, '');

    // Prefer phrases that end with a content word (noun, verb, etc.)
    const lastIsContent = contentWordIndices.includes(words.length - 1);

    // If phrase starts with a preposition, it should include the object (noun)
    const prepositions = ['in', 'on', 'at', 'for', 'of', 'with', 'by', 'from', 'to', 'into', 'onto'];
    if (prepositions.includes(firstWord)) {
      // Must end with a content word (the object of the preposition)
      return lastIsContent;
    }

    // If phrase starts with a determiner or intensifier, it should include the noun/adjective
    const determiners = ['the', 'a', 'an', 'this', 'that', 'these', 'those', 'other', 'some', 'any', 'all'];
    const intensifiers = ['very', 'quite', 'pretty', 'much', 'more', 'most'];
    if (determiners.includes(firstWord) || intensifiers.includes(firstWord)) {
      // Must end with a content word
      return lastIsContent;
    }

    // If all words are content words, it's meaningful
    let allContent = true;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const isSentenceStart = (startIndex + i) === 0;
      if (!isContentWord(word.toLowerCase(), word, isSentenceStart)) {
        allContent = false;
        break;
      }
    }
    if (allContent) {
      // Prefer phrases that end with content words
      return lastIsContent;
    }

    return false;
  };


  // Extract meaningful 2- or 3-word noun phrase CORES using compromise
  const extractNounPhrases = (sentence, phraseLength) => {
    // Check if compromise is loaded (try both window.nlp and global nlp)
    const nlpFunction = typeof nlp !== 'undefined' ? nlp : (typeof window !== 'undefined' && window.nlp ? window.nlp : null);

    if (!nlpFunction) {
      log.error('compromise library not loaded. Available globals:', Object.keys(window).filter(k => k.includes('nlp') || k.includes('compromise')));
      return [];
    }

    const doc = nlpFunction(sentence);
    const rawNounPhrases = doc.nouns().out('array');

    log.debug(`[extractNounPhrases] Sentence: "${sentence}"`);
    log.debug(`[extractNounPhrases] Raw noun phrases from compromise:`, rawNounPhrases);
    log.debug(`[extractNounPhrases] Requested phrase length:`, phraseLength);

    const results = [];

    rawNounPhrases.forEach((np, npIdx) => {
      // Remove punctuation
      const clean = np.replace(/[.,!?;:]/g, '').trim();
      const words = clean.split(/\s+/).filter(w => w && w.length > 0);

      log.debug(`[extractNounPhrases] NP ${npIdx + 1}: "${np}" -> "${clean}" (${words.length} words)`);

      // Skip if NP too short
      if (words.length < phraseLength) {
        log.debug(`[extractNounPhrases] NP ${npIdx + 1} too short, skipping`);
        return;
      }

      /*
        Strategy:
        - Compromise returns long noun phrases (e.g. "a very adaptable nocturnal predator")
        - We must extract the RIGHTMOST meaningful core
        - This avoids determiners and keeps the head noun
      */

      let foundCore = false;
      for (let i = words.length - phraseLength; i >= 0; i--) {
        const candidate = words.slice(i, i + phraseLength);

        // Check if any word in candidate contains hyphens or punctuation
        const hasHyphenOrPunctuation = candidate.some(word => {
          // Remove all letters and numbers, check if anything remains (punctuation/hyphens)
          const cleaned = word.replace(/[a-zA-Z0-9]/g, '');
          return cleaned.length > 0;
        });

        if (hasHyphenOrPunctuation) {
          log.debug(`[extractNounPhrases] Rejected: contains hyphen or punctuation "${candidate.join(' ')}"`);
          continue;
        }

        const firstWord = candidate[0].toLowerCase();
        const lastWord = candidate[candidate.length - 1].toLowerCase();

        log.debug(`[extractNounPhrases] Testing candidate: "${candidate.join(' ')}" (first: "${firstWord}", last: "${lastWord}")`);

        // Reject determiners at start
        if (['the', 'a', 'an', 'this', 'that', 'these', 'those'].includes(firstWord)) {
          log.debug(`[extractNounPhrases] Rejected: starts with determiner "${firstWord}"`);
          continue;
        }

        // Reject function words at end
        if (['the', 'a', 'an', 'that', 'which', 'they', 'it'].includes(lastWord)) {
          log.debug(`[extractNounPhrases] Rejected: ends with function word "${lastWord}"`);
          continue;
        }

        const core = candidate.join(' ');
        log.debug(`[extractNounPhrases] ✓ Accepted core: "${core}"`);
        results.push(core);
        foundCore = true;
        break; // only one core per noun phrase
      }

      if (!foundCore) {
        log.debug(`[extractNounPhrases] No valid core found for NP ${npIdx + 1}`);
      }
    });

    // Remove duplicates
    const uniqueResults = [...new Set(results)];
    log.debug(`[extractNounPhrases] Final results (${uniqueResults.length} unique):`, uniqueResults);
    return uniqueResults;
  };

  // Generate phrase gaps using deterministic noun phrase extraction
  const generatePhraseGaps = async (transcript, phraseLength) => {
    // Split transcript into sentences
    const sentenceParts = transcript.split(/([.!?]+\s*)/);
    const sentences = [];
    const sentencePunctuation = [];

    for (let i = 0; i < sentenceParts.length; i += 2) {
      if (sentenceParts[i] && sentenceParts[i].trim()) {
        sentences.push(sentenceParts[i].trim());
        sentencePunctuation.push(sentenceParts[i + 1] || '');
      }
    }

    if (sentences.length === 0) {
      return transcript;
    }

    // Process each sentence with deterministic noun phrase extraction
    const gappedSentences = [];
    let lastGapEndPosition = -20;
    let totalWordCount = 0;

    sentences.forEach((sentence, sentenceIdx) => {
      const words = sentence.split(/\s+/).filter(w => w && w.length > 0);

      // Extract noun phrases using compromise
      const nounPhrases = extractNounPhrases(sentence, phraseLength);

      log.debug(`Sentence ${sentenceIdx + 1}: "${sentence}"`);
      log.debug(`Extracted noun phrases:`, nounPhrases);

      // If array is empty → NO BLANK
      if (nounPhrases.length === 0 || words.length < phraseLength) {
        log.debug(`Sentence ${sentenceIdx + 1} has no valid noun phrases, rendering without blank`);
        gappedSentences.push(sentence + sentencePunctuation[sentenceIdx]);
        totalWordCount += words.length;
        return;
      }

      // Randomly select ONE noun phrase
      const randomIndex = Math.floor(Math.random() * nounPhrases.length);
      const selectedPhrase = nounPhrases[randomIndex];
      const cleanPhrase = selectedPhrase.toLowerCase().trim();
      const phraseWords = cleanPhrase.split(/\s+/);

      // Find the phrase in the sentence
      log.debug(`[generatePhraseGaps] Looking for phrase: "${selectedPhrase}" (cleaned: "${cleanPhrase}")`);
      log.debug(`[generatePhraseGaps] Sentence words:`, words);

      let foundIndex = -1;
      for (let i = 0; i <= words.length - phraseLength; i++) {
        const candidateWords = words.slice(i, i + phraseLength);
        const candidateText = candidateWords
          .map(w => w.replace(/[.,!?;:]/g, '').toLowerCase().trim())
          .join(' ')
          .trim();

        log.debug(`[generatePhraseGaps] Position ${i}: candidate "${candidateText}" vs target "${cleanPhrase}"`);

        if (candidateText === cleanPhrase) {
          // Check minimum distance from last gap
          const phraseStartPosition = totalWordCount + i;
          const positionFromLastGap = phraseStartPosition - lastGapEndPosition;

          log.debug(`[generatePhraseGaps] Match found at position ${i}, distance from last gap: ${positionFromLastGap}`);

          if (positionFromLastGap >= 5) {
            foundIndex = i;
            log.debug(`[generatePhraseGaps] ✓ Valid match at position ${i}`);
            break;
          } else {
            log.debug(`[generatePhraseGaps] ✗ Too close to last gap (${positionFromLastGap} < 5)`);
          }
        }
      }

      if (foundIndex === -1) {
        log.debug(`[generatePhraseGaps] ✗ Phrase "${selectedPhrase}" not found in sentence or too close to last gap`);
      }

      if (foundIndex >= 0) {
        // Replace the phrase with a gap input
        const cleanPhraseText = words.slice(foundIndex, foundIndex + phraseLength).join(' ').replace(/[.,!?;:]/g, '');
        const resultWords = [];
        for (let i = 0; i < words.length; i++) {
          if (i === foundIndex) {
            // Insert gap input at the start of the phrase
            // Calculate width based on phrase length (approximately 8px per character + padding)
            const phraseWidth = Math.max(150, cleanPhraseText.length * 8 + 40);
            resultWords.push(`<input type="text" class="phrase-input" data-phrase-id="${totalWordCount + foundIndex}" data-correct="${cleanPhraseText}" placeholder="" style="width: ${phraseWidth}px; min-width: ${phraseWidth}px;" />`);
            // Skip the remaining words in the phrase
            i += phraseLength - 1;
          } else {
            resultWords.push(words[i]);
          }
        }

        gappedSentences.push(resultWords.join(' ') + sentencePunctuation[sentenceIdx]);
        lastGapEndPosition = totalWordCount + foundIndex + phraseLength - 1;
        totalWordCount += words.length;
      } else {
        // Phrase not found or too close to last gap, render sentence normally
        log.debug(`Selected phrase "${selectedPhrase}" not found or too close to last gap, rendering without blank`);
        gappedSentences.push(sentence + sentencePunctuation[sentenceIdx]);
        totalWordCount += words.length;
      }
    });

    return gappedSentences.join(' ');
  };

  // REMOVED: Fallback phrase generation - no longer used
  // Using deterministic compromise-based noun phrase extraction only
  const _generatePhraseGapsFallback_DISABLED = (transcript, phraseLength) => {
    const sentenceParts = transcript.split(/([.!?]+\s*)/);
    const sentences = [];
    const sentencePunctuation = [];

    for (let i = 0; i < sentenceParts.length; i += 2) {
      if (sentenceParts[i] && sentenceParts[i].trim()) {
        sentences.push(sentenceParts[i].trim());
        sentencePunctuation.push(sentenceParts[i + 1] || '');
      }
    }

    const gappedSentences = [];
    let lastGapEndPosition = -20;
    let totalWordCount = 0;

    sentences.forEach((sentence, sentenceIdx) => {
      const words = sentence.split(/\s+/);

      if (words.length < phraseLength) {
        gappedSentences.push(sentence + sentencePunctuation[sentenceIdx]);
        totalWordCount += words.length;
        return;
      }

      // Generate all possible phrases
      const phraseCandidates = [];
      for (let i = 0; i <= words.length - phraseLength; i++) {
        const phraseWords = words.slice(i, i + phraseLength);
        let hasPunctuationBetween = false;

        // Check for punctuation between words
        for (let j = 0; j < phraseLength - 1; j++) {
          const word = phraseWords[j];
          const wordWithPunct = word.replace(/[.,!?;:]/g, '');
          if (word.length > wordWithPunct.length) {
            const punct = word.slice(wordWithPunct.length);
            if (punct.includes(',') || punct.includes(';')) {
              hasPunctuationBetween = true;
              break;
            }
          }
        }

        if (!hasPunctuationBetween) {
          // Check minimum distance from last gap
          const phraseStartPosition = totalWordCount + i;
          const positionFromLastGap = phraseStartPosition - lastGapEndPosition;

          // Relaxed minimum distance to 5 words for fallback phrases
          if (positionFromLastGap >= 5) {
            phraseCandidates.push({
              startIndex: i,
              words: phraseWords,
              startPosition: phraseStartPosition
            });
          }
        }
      }

      if (phraseCandidates.length === 0) {
        gappedSentences.push(sentence + sentencePunctuation[sentenceIdx]);
        totalWordCount += words.length;
        return;
      }

      // Randomly select one phrase candidate
      const randomIndex = Math.floor(Math.random() * phraseCandidates.length);
      const selectedPhrase = phraseCandidates[randomIndex];

      // Replace the phrase with a gap input
      const cleanPhrase = selectedPhrase.words.join(' ').replace(/[.,!?;:]/g, '');

      // Build the sentence with gap
      const resultWords = [];
      for (let i = 0; i < words.length; i++) {
        if (i === selectedPhrase.startIndex) {
          // Insert gap input at the start of the phrase
          // Calculate width based on phrase length (approximately 8px per character + padding)
          const phraseWidth = Math.max(150, cleanPhrase.length * 8 + 40);
          resultWords.push(`<input type="text" class="phrase-input" data-phrase-id="${selectedPhrase.startPosition}" data-correct="${cleanPhrase}" placeholder="" style="width: ${phraseWidth}px; min-width: ${phraseWidth}px;" />`);
          // Skip the remaining words in the phrase
          i += phraseLength - 1;
        } else {
          resultWords.push(words[i]);
        }
      }

      gappedSentences.push(resultWords.join(' ') + sentencePunctuation[sentenceIdx]);
      lastGapEndPosition = totalWordCount + selectedPhrase.startIndex + phraseLength - 1;
      totalWordCount += words.length;
    });

    return gappedSentences.join(' ');
  };

  // State for phrases
  let extendedPhraseAnswers = {};
  let extendedPhraseTranscript = '';

  // Load Extended Listening question
  const loadExtendedQuestion = async (questionId) => {
    const requestId = beginModeLoadRequest('extended');
    const question = extendedDatabase.find(q => q.id === questionId);
    if (!question) {
      log.error(`Question ${questionId} not found`);
      return;
    }

    currentExtendedQuestionId = questionId;
    if (currentQuestionIdExtended) {
      currentQuestionIdExtended.textContent = questionId;
    }
    if (window.PracticeRouter && questionId != null) {
      window.PracticeRouter.replaceRoute('extended', questionId);
    }
    startAttemptContext('extended', questionId);
    window.questionStartTime = null;
    window.extendedQuestionStartTime = Date.now();
    window.currentQuestionAttempts = 0;
    window.hintUsedForCurrentQuestion = false;

    // Get transcript and clean it (remove existing gap markers like __word__)
    let rawTranscript = question.transcript || question.correctSentence || "";
    // Remove gap markers (double underscores) and keep the word
    extendedCorrectTranscript = rawTranscript.replace(/__([^_]+)__/g, '$1').trim();
    extendedGapAnswers = {};

    readingPhase.style.display = "block";
    listeningPhase.style.display = "none";
    readingTimeLeft = 30;

    // Hide Redo and Randomize Blanks buttons and result message
    redoExtendedBtn.style.display = 'none';
    randomizeBlanksBtn.style.display = 'none';
    checkResultExtended.style.display = 'none';
    fillSingleWordsSection.style.display = 'none';
    fillPhrasesSection.style.display = 'none';
    checkResultPhrases.style.display = 'none';

    // Reset support mode
    supportModeActive = false;
    if (supportModeBtn) {
      supportModeBtn.textContent = 'Show Hints';
      supportModeBtn.style.backgroundColor = '';
      supportModeBtn.style.color = '';
    }

    // Reset phrases support mode
    supportPhrasesActive = false;
    if (supportPhrasesBtn) {
      supportPhrasesBtn.textContent = 'Show Hints';
      supportPhrasesBtn.style.backgroundColor = '';
      supportPhrasesBtn.style.color = '';
    }

    // Set transcript with clickable words
    if (fullTranscript && extendedCorrectTranscript) {
      makeWordsClickable(fullTranscript, extendedCorrectTranscript);
    } else {
      log.warn('Cannot display transcript:', {
        fullTranscript: !!fullTranscript,
        transcriptText: extendedCorrectTranscript ? extendedCorrectTranscript.substring(0, 50) + '...' : 'empty'
      });
    }

    clearExtendedReadingTimer();

    if (isStaleModeLoadRequest('extended', requestId)) {
      return;
    }

    startReadingTimer();
    await loadExtendedAudio(question.audioFile, requestId);
  };

  // Load Extended Listening audio
  const loadExtendedAudio = async (audioFile, requestId = modeLoadRequestIds.extended) => {
    // Determine MIME type based on file extension
    const getAudioMimeType = (filename) => {
      const ext = filename.toLowerCase().split('.').pop();
      const mimeTypes = {
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'm4a': 'audio/mp4'
      };
      return mimeTypes[ext] || 'audio/mpeg';
    };

    // Get base filename (without extension) - use question ID
    const baseFilename = currentExtendedQuestionId.toString();

    // Try extensions in order: mp3, wav, m4a
    const tryExtensions = ['mp3', 'wav', 'm4a'];

    // Try to find the file by checking each extension in order
    let foundFile = null;

    for (let i = 0; i < tryExtensions.length; i++) {
      const ext = tryExtensions[i];
      const testFile = `${baseFilename}.${ext}`;
      const testPath = `database/extended/audio/${testFile}`;

      const exists = await checkFileExists(testPath);
      if (isStaleModeLoadRequest('extended', requestId)) {
        return;
      }
      log.debug(`[loadExtendedAudio] Checking ${testPath}: ${exists ? 'EXISTS' : 'NOT FOUND'}`);

      if (exists) {
        foundFile = testFile;
        log.debug(`[loadExtendedAudio] ✓ Found file: ${foundFile} (tried ${i + 1} of ${tryExtensions.length} extensions)`);
        break;
      }
    }

    if (!foundFile) {
      const errorMsg = `No audio file found for question ${currentExtendedQuestionId}. Tried: ${tryExtensions.map(ext => `${baseFilename}.${ext}`).join(', ')}`;
      log.error(`[loadExtendedAudio] ${errorMsg}`);
      alert(errorMsg);
      return;
    }

    const audioPath = `database/extended/audio/${foundFile}?t=${Date.now()}`;
    const mimeType = getAudioMimeType(foundFile);

    // Clear any existing source elements
    while (audioExtended.firstChild) {
      audioExtended.removeChild(audioExtended.firstChild);
    }

    // Create source element with proper type
    const source = document.createElement('source');
    source.src = audioPath;
    source.type = mimeType;
    audioExtended.appendChild(source);

    // Reset controls
    audioExtended.load(); // Reload the audio element
    audioExtended.currentTime = 0;
    audioSliderExtended.value = 0;
    currentTimeExtended.textContent = "0:00";
    totalTimeExtended.textContent = "0:00";
    playPauseExtendedBtn.textContent = "Play";

    // Also set up phrases audio with the same file (independent control)
    // Clear any existing source elements
    while (audioPhrases.firstChild) {
      audioPhrases.removeChild(audioPhrases.firstChild);
    }

    const phrasesSource = document.createElement('source');
    phrasesSource.src = audioPath;
    phrasesSource.type = mimeType;
    audioPhrases.appendChild(phrasesSource);
    audioPhrases.load();
    audioPhrases.currentTime = 0;
    audioSliderPhrases.value = 0;
    currentTimePhrases.textContent = "0:00";
    totalTimePhrases.textContent = "0:00";
    playPausePhrasesBtn.textContent = "Play";
  };

  // Start reading timer (30 seconds)
  const startReadingTimer = () => {
    readingTimerDisplay.textContent = readingTimeLeft;

    readingTimer = setInterval(() => {
      // Pause timer during tutorial
      if (window.isTutorialActive) return;

      readingTimeLeft--;
      readingTimerDisplay.textContent = readingTimeLeft;

      if (readingTimeLeft <= 0) {
        clearExtendedReadingTimer();
        startListeningPhase();
      }
    }, 1000);

    window.readingTimer = readingTimer;
  };

  // Skip reading time
  skipReadingBtn.addEventListener("click", () => {
    clearExtendedReadingTimer();
    startListeningPhase();
  });

  // Start listening phase with gapped transcript
  const startListeningPhase = () => {
    // Guard: if the user has navigated away, do not mutate the Extended UI.
    const extendedPanel = document.getElementById('mode-extended');
    if (extendedPanel && !extendedPanel.classList.contains('active')) return;

    readingPhase.style.display = "none";
    listeningPhase.style.display = "block";

    // Show Fill single words section
    fillSingleWordsSection.style.display = 'block';

    extendedGappedTranscript = generateGaps(extendedCorrectTranscript);
    gappedTranscript.innerHTML = extendedGappedTranscript;

    // Make words in gapped transcript clickable (excluding gap inputs)
    makeWordsInGappedTranscriptClickable(gappedTranscript);

    gappedTranscript.querySelectorAll('.gap-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const gapId = e.target.dataset.gapId;
        extendedGapAnswers[gapId] = e.target.value.trim().toLowerCase();
      });
    });

    // Generate and show phrase gaps (async)
    const selectedPhraseLength = parseInt(document.querySelector('input[name="phrase-length"]:checked').value, 10);
    phrasesTranscript.innerHTML = '<p>Analyzing phrases...</p>';
    fillPhrasesSection.style.display = 'block';

    generatePhraseGaps(extendedCorrectTranscript, selectedPhraseLength).then(result => {
      extendedPhraseTranscript = result;
      phrasesTranscript.innerHTML = extendedPhraseTranscript;
      extendedPhraseAnswers = {};

      // Add event listeners to phrase inputs
      phrasesTranscript.querySelectorAll('.phrase-input').forEach(input => {
        input.addEventListener('input', (e) => {
          const phraseId = e.target.dataset.phraseId;
          extendedPhraseAnswers[phraseId] = e.target.value.trim().toLowerCase();
        });
      });
    }).catch(error => {
      log.error('Error generating phrase gaps:', error);
      phrasesTranscript.innerHTML = '<p>Error generating phrases. Please try again.</p>';
    });
  };

  // Format time as MM:SS
  const formatTime = (seconds) => {
    if (isNaN(seconds) || !isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Update audio slider and time display
  const updateAudioControls = () => {
    if (!audioExtended.duration || !isFinite(audioExtended.duration)) return;

    const current = audioExtended.currentTime;
    const duration = audioExtended.duration;
    const percent = (current / duration) * 100;

    audioSliderExtended.value = percent;
    currentTimeExtended.textContent = formatTime(current);
    totalTimeExtended.textContent = formatTime(duration);
  };

  // Update play/pause button text
  const updatePlayPauseButton = () => {
    if (audioExtended.paused) {
      playPauseExtendedBtn.textContent = "Play";
    } else {
      playPauseExtendedBtn.textContent = "Pause";
    }
  };

  // Play/Pause Extended Listening audio
  playPauseExtendedBtn.addEventListener("click", () => {
    if (audioExtended.paused) {
      audioExtended.play().catch(error => {
        log.error("Error playing audio:", error);
      });
    } else {
      audioExtended.pause();
    }
    updatePlayPauseButton();
  });

  // Handle playback speed change
  speedSelectExtended.addEventListener("change", (e) => {
    audioExtended.playbackRate = parseFloat(e.target.value);
  });

  // Handle time slider (seek)
  let isDragging = false;
  audioSliderExtended.addEventListener("input", () => {
    isDragging = true;
    if (audioExtended.duration && isFinite(audioExtended.duration)) {
      const seekTime = (audioSliderExtended.value / 100) * audioExtended.duration;
      audioExtended.currentTime = seekTime;
    }
  });

  audioSliderExtended.addEventListener("change", () => {
    isDragging = false;
  });

  // Update controls as audio plays
  audioExtended.addEventListener("timeupdate", () => {
    if (!isDragging) {
      updateAudioControls();
    }
  });

  audioExtended.addEventListener("loadedmetadata", () => {
    updateAudioControls();
    totalTimeExtended.textContent = formatTime(audioExtended.duration);
  });

  audioExtended.addEventListener("play", () => {
    updatePlayPauseButton();
  });

  audioExtended.addEventListener("pause", () => {
    updatePlayPauseButton();
  });

  audioExtended.addEventListener("ended", () => {
    updatePlayPauseButton();
    audioExtended.currentTime = 0;
    updateAudioControls();
  });

  // Support mode: Show first and last letters with underscores (for single-word gaps)
  let supportModeActive = false;

  supportModeBtn.addEventListener("click", () => {
    const gapInputs = gappedTranscript.querySelectorAll('.gap-input');

    if (!supportModeActive) {
      // Activate support mode
      supportModeActive = true;
      supportModeBtn.textContent = 'Hide Hints';
      supportModeBtn.style.backgroundColor = '#4caf50';
      supportModeBtn.style.color = 'white';

      gapInputs.forEach(input => {
        const correctAnswer = input.dataset.correct;
        if (!correctAnswer || correctAnswer.length < 2) {
          // Skip single-letter words or empty answers
          return;
        }

        // Generate hint pattern: first letter + underscores + last letter
        const firstLetter = correctAnswer[0];
        const lastLetter = correctAnswer[correctAnswer.length - 1];
        const middleUnderscores = '_ '.repeat(Math.max(0, correctAnswer.length - 2)).trim();
        const hintPattern = `${firstLetter} ${middleUnderscores} ${lastLetter}`.replace(/\s+/g, ' ');

        // Store original placeholder if not already stored
        if (!input.dataset.originalPlaceholder) {
          input.dataset.originalPlaceholder = input.placeholder || '';
        }

        // Set placeholder to show hint
        input.placeholder = hintPattern;

        // Add visual indicator
        input.classList.add('support-mode-active');
      });
    } else {
      // Deactivate support mode
      supportModeActive = false;
      supportModeBtn.textContent = 'Show Hints';
      supportModeBtn.style.backgroundColor = '';
      supportModeBtn.style.color = '';

      gapInputs.forEach(input => {
        // Restore original placeholder
        const originalPlaceholder = input.dataset.originalPlaceholder || '';
        input.placeholder = originalPlaceholder;
        input.classList.remove('support-mode-active');
      });
    }
  });

  // Phrases audio player controls
  // Update phrases audio slider and time display
  const updatePhrasesAudioControls = () => {
    if (!audioPhrases.duration || !isFinite(audioPhrases.duration)) return;

    const current = audioPhrases.currentTime;
    const duration = audioPhrases.duration;
    const percent = (current / duration) * 100;

    audioSliderPhrases.value = percent;
    currentTimePhrases.textContent = formatTime(current);
    totalTimePhrases.textContent = formatTime(duration);
  };

  // Update phrases play/pause button text
  const updatePlayPausePhrasesButton = () => {
    if (audioPhrases.paused) {
      playPausePhrasesBtn.textContent = "Play";
    } else {
      playPausePhrasesBtn.textContent = "Pause";
    }
  };

  // Play/Pause Phrases audio (independent from main audio)
  playPausePhrasesBtn.addEventListener("click", () => {
    if (audioPhrases.paused) {
      audioPhrases.play().catch(error => {
        log.error("Error playing phrases audio:", error);
      });
    } else {
      audioPhrases.pause();
    }
    updatePlayPausePhrasesButton();
  });

  // Handle phrases playback speed change
  speedSelectPhrases.addEventListener("change", (e) => {
    audioPhrases.playbackRate = parseFloat(e.target.value);
  });

  // Handle phrases time slider (seek)
  let isDraggingPhrases = false;
  audioSliderPhrases.addEventListener("input", () => {
    isDraggingPhrases = true;
    if (audioPhrases.duration && isFinite(audioPhrases.duration)) {
      const seekTime = (audioSliderPhrases.value / 100) * audioPhrases.duration;
      audioPhrases.currentTime = seekTime;
    }
  });

  audioSliderPhrases.addEventListener("change", () => {
    isDraggingPhrases = false;
  });

  // Update phrases controls as audio plays
  audioPhrases.addEventListener("timeupdate", () => {
    if (!isDraggingPhrases) {
      updatePhrasesAudioControls();
    }
  });

  audioPhrases.addEventListener("loadedmetadata", () => {
    updatePhrasesAudioControls();
    totalTimePhrases.textContent = formatTime(audioPhrases.duration);
  });

  audioPhrases.addEventListener("play", () => {
    updatePlayPausePhrasesButton();
  });

  audioPhrases.addEventListener("pause", () => {
    updatePlayPausePhrasesButton();
  });

  audioPhrases.addEventListener("ended", () => {
    updatePlayPausePhrasesButton();
    audioPhrases.currentTime = 0;
    updatePhrasesAudioControls();
  });

  // Support mode for phrases: Show first and last letters with underscores
  let supportPhrasesActive = false;

  supportPhrasesBtn.addEventListener("click", () => {
    const phraseInputs = phrasesTranscript.querySelectorAll('.phrase-input');

    if (!supportPhrasesActive) {
      // Activate support mode
      supportPhrasesActive = true;
      supportPhrasesBtn.textContent = 'Hide Hints';
      supportPhrasesBtn.style.backgroundColor = '#4caf50';
      supportPhrasesBtn.style.color = 'white';

      phraseInputs.forEach(input => {
        const correctAnswer = input.dataset.correct;
        if (!correctAnswer || correctAnswer.length < 2) {
          // Skip single-character phrases or empty answers
          return;
        }

        // For phrases, show first and last letter of EACH word
        const words = correctAnswer.trim().split(/\s+/);
        if (words.length === 0) {
          return;
        }

        // Build hint pattern: for each word, show first letter + underscores + last letter
        const hintParts = words.map(word => {
          if (word.length < 2) {
            return word; // Single character word, return as is
          }
          const firstLetter = word[0];
          const lastLetter = word[word.length - 1];
          const middleUnderscores = '_ '.repeat(Math.max(0, word.length - 2)).trim();
          return `${firstLetter} ${middleUnderscores} ${lastLetter}`.replace(/\s+/g, ' ');
        });

        // Join words with spaces
        const hintPattern = hintParts.join(' ');

        // Store original placeholder if not already stored
        if (!input.dataset.originalPlaceholder) {
          input.dataset.originalPlaceholder = input.placeholder || '';
        }

        // Set placeholder to show hint
        input.placeholder = hintPattern;

        // Set input width based on phrase length to ensure hint is visible
        // Calculate width: hint pattern length * 8px per character + padding
        const estimatedWidth = Math.max(150, hintPattern.length * 8 + 40);
        input.style.width = `${estimatedWidth}px`;
        input.style.minWidth = `${estimatedWidth}px`;

        // Add visual indicator
        input.classList.add('support-mode-active');
      });
    } else {
      // Deactivate support mode
      supportPhrasesActive = false;
      supportPhrasesBtn.textContent = 'Show Hints';
      supportPhrasesBtn.style.backgroundColor = '';
      supportPhrasesBtn.style.color = '';

      phraseInputs.forEach(input => {
        // Restore original placeholder
        const originalPlaceholder = input.dataset.originalPlaceholder || '';
        input.placeholder = originalPlaceholder;
        input.classList.remove('support-mode-active');
      });
    }
  });

  // Check Extended Listening answers
  checkExtendedBtn.addEventListener("click", () => {
    const gapInputs = gappedTranscript.querySelectorAll('.gap-input');
    let correctCount = 0;
    let totalGaps = gapInputs.length;
    const gapResults = [];

    gapInputs.forEach(input => {
      const userAnswer = input.value.trim().toLowerCase();
      const correctAnswer = input.dataset.correct.toLowerCase();
      const correctAnswerDisplay = input.dataset.correct; // Keep original case for display
      const userAnswerDisplay = input.value.trim(); // Keep original case for display
      const isCorrect = userAnswer === correctAnswer;

      gapResults.push({
        gapId: input.dataset.gapId || String(gapResults.length + 1),
        userAnswer: userAnswerDisplay,
        normalizedUserAnswer: userAnswer,
        correctAnswer: correctAnswerDisplay,
        isCorrect
      });

      // Get the speaker icon (next sibling)
      const speakerIcon = input.nextElementSibling;

      // Create a replacement span that looks like an input but can contain HTML
      const replacementSpan = document.createElement('span');
      replacementSpan.className = 'gap-result';
      replacementSpan.style.display = 'inline-block';
      replacementSpan.style.padding = '2px 6px';
      replacementSpan.style.minWidth = '60px';
      replacementSpan.style.border = '2px solid';
      replacementSpan.style.borderRadius = '4px';
      replacementSpan.style.fontSize = 'inherit';
      replacementSpan.style.fontFamily = 'inherit';
      replacementSpan.style.verticalAlign = 'baseline';
      replacementSpan.style.textAlign = 'center';

      if (isCorrect) {
        // Correct: green color, bold, green box highlight
        replacementSpan.style.backgroundColor = '#dcfce7';
        replacementSpan.style.color = '#166534';
        replacementSpan.style.fontWeight = 'bold';
        replacementSpan.style.borderColor = '#16a34a';
        replacementSpan.textContent = correctAnswerDisplay;
        correctCount++;
      } else if (userAnswer === '') {
        // Empty: red box highlight, show correct word in green and bold
        replacementSpan.style.backgroundColor = '#fee2e2';
        replacementSpan.style.borderColor = '#dc2626';
        replacementSpan.innerHTML = `<span style="color: #16a34a; font-weight: bold;">${correctAnswerDisplay}</span>`;
      } else {
        // Incorrect: red color, show "typedword / correctword" with correct word in green
        replacementSpan.style.backgroundColor = '#fee2e2';
        replacementSpan.style.borderColor = '#dc2626';
        replacementSpan.innerHTML = `<span style="color: #991b1b;">${userAnswerDisplay}</span> / <span style="color: #16a34a; font-weight: bold;">${correctAnswerDisplay}</span>`;
      }

      // Replace the input with the span
      input.parentNode.replaceChild(replacementSpan, input);

      // Move the speaker icon after the replacement span if it exists
      if (speakerIcon && speakerIcon.classList.contains('gap-speaker-icon')) {
        replacementSpan.parentNode.insertBefore(speakerIcon, replacementSpan.nextSibling);
        speakerIcon.style.display = 'inline-block';
        speakerIcon.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Get the span element (not the text node inside it)
          const iconElement = e.currentTarget || e.target.closest('.gap-speaker-icon') || e.target;
          const correctWord = iconElement.dataset.word;
          if (correctWord) {
            speakWordExtended(correctWord);

            // Visual feedback - highlight icon briefly
            iconElement.classList.add('icon-speaking');
            setTimeout(() => {
              iconElement.classList.remove('icon-speaking');
            }, 500);
          }
        });
      }
    });

    // Show Redo and Randomize Blanks buttons
    redoExtendedBtn.style.display = 'inline-block';
    randomizeBlanksBtn.style.display = 'inline-block';

    // Show result message in custom box
    const isFullyCorrect = totalGaps > 0 && correctCount === totalGaps;
    checkResultExtended.textContent = `You got ${correctCount} out of ${totalGaps} gaps correct!`;
    checkResultExtended.style.display = 'block';

    recordPracticeAttempt(currentExtendedQuestionId || 'extended', isFullyCorrect, 'extended');

    if (window.extendedPerformanceTracker) {
      const timeTaken = Math.max(2, (Date.now() - (window.extendedQuestionStartTime || Date.now())) / 1000);
      const accuracy = totalGaps > 0 ? Math.max(0, Math.min(1, correctCount / totalGaps)) : 0;
      window.extendedPerformanceTracker.recordAttempt({
        correct: isFullyCorrect,
        accuracy,
        attempts: 1,
        hintUsed: !!supportModeActive,
        timeTaken,
        wordCount: totalGaps
      });
    }

    // Dual-Track Scoring Integration (v6)
    if (window.handleDualTrackScoring) {
      window.handleDualTrackScoring('extended', currentExtendedQuestionId || 'extended', correctCount, totalGaps);
    }

    const extendedQuestion = extendedDatabase.find(q => q.id === currentExtendedQuestionId) || null;
    window.PTEAttemptArchive?.saveAttempt?.({
      practiceMode: 'extended',
      promptSnapshot: {
        promptId: currentExtendedQuestionId || 'extended',
        text: extendedCorrectTranscript || extendedGappedTranscript || '',
        sourceAssetPaths: [extendedQuestion?.audioFile].filter(Boolean),
        data: extendedQuestion
      },
      responseSnapshot: {
        answers: gapResults.map(({ gapId, userAnswer }) => ({ gapId, userAnswer }))
      },
      answerSnapshot: {
        blanks: gapResults.map(({ gapId, correctAnswer, userAnswer, isCorrect }) => ({
          gapId,
          correctAnswer,
          userAnswer,
          isCorrect
        }))
      },
      resultSnapshot: {
        score: correctCount,
        maxScore: totalGaps,
        correct: isFullyCorrect,
        results: gapResults
      },
      scoringSource: 'client'
    }).catch((error) => log.warn('[PTE Archive] Extended save failed:', error));

    // Vocabulary Book tracking for Fill mode
    if (window.VocabularyBook) {
      const missedWords = [];
      const correctWords = [];

      // Collect missed and correct words from gap results
      document.querySelectorAll('.gap-result').forEach((span, index) => {
        const bgColor = span.style.backgroundColor;
        // Extract the correct word from the span content
        const correctWord = span.textContent.includes('/')
          ? span.textContent.split('/')[1].trim()
          : span.textContent.trim();

        if (bgColor.includes('dcfce7') || bgColor.includes('220, 252, 231')) {
          // Green = correct
          correctWords.push(correctWord);
        } else {
          // Red = incorrect or empty
          missedWords.push(correctWord);
        }
      });

      // Track words immediately when Check is pressed
      missedWords.forEach(word => window.VocabularyBook.trackMissedWord(word, 'fill', currentExtendedQuestionId));
      correctWords.forEach(word => window.VocabularyBook.trackCorrectWord(word));

      // Show add to vocabulary modal if there are missed words
      if (missedWords.length > 0) {
        window.VocabularyBook.handlePracticeCapture?.({
          mode: 'fill',
          questionId: currentExtendedQuestionId || 'extended',
          sentenceText: extendedCorrectTranscript,
          missedWords: filterContentWords(missedWords),
          correctWords
        });
      }
    }
  });

  // Redo button - clear all input boxes
  redoExtendedBtn.addEventListener("click", () => {
    // Reset support mode
    supportModeActive = false;
    supportModeBtn.textContent = 'Show Hints';
    supportModeBtn.style.backgroundColor = '';
    supportModeBtn.style.color = '';

    // Regenerate the transcript to restore inputs (since they were replaced with spans after checking)
    extendedGappedTranscript = generateGaps(extendedCorrectTranscript);
    gappedTranscript.innerHTML = extendedGappedTranscript;

    // Clear gap answers
    extendedGapAnswers = {};

    // Add event listeners to new gap inputs
    gappedTranscript.querySelectorAll('.gap-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const gapId = e.target.dataset.gapId;
        extendedGapAnswers[gapId] = e.target.value.trim().toLowerCase();
      });
    });

    // Make words in gapped transcript clickable (excluding gap inputs)
    makeWordsInGappedTranscriptClickable(gappedTranscript);

    // Hide buttons and result message
    redoExtendedBtn.style.display = 'none';
    randomizeBlanksBtn.style.display = 'none';
    checkResultExtended.style.display = 'none';
  });

  // Randomize Blanks button - regenerate gaps
  randomizeBlanksBtn.addEventListener("click", () => {
    // Reset support mode
    supportModeActive = false;
    supportModeBtn.textContent = 'Show Hints';
    supportModeBtn.style.backgroundColor = '';
    supportModeBtn.style.color = '';

    // Regenerate gaps with new randomization
    extendedGappedTranscript = generateGaps(extendedCorrectTranscript);
    gappedTranscript.innerHTML = extendedGappedTranscript;

    // Clear gap answers
    extendedGapAnswers = {};

    // Add event listeners to new gap inputs (typing mode only, no pronunciation)
    gappedTranscript.querySelectorAll('.gap-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const gapId = e.target.dataset.gapId;
        extendedGapAnswers[gapId] = e.target.value.trim().toLowerCase();
      });
    });

    // Hide buttons and result message (user needs to check again)
    redoExtendedBtn.style.display = 'none';
    randomizeBlanksBtn.style.display = 'none';
    checkResultExtended.style.display = 'none';
  });

  // Question selector for Extended Listening
  questionSelectExtended.addEventListener("change", (e) => {
    const questionId = parseInt(e.target.value, 10);
    if (questionId && questionId !== currentExtendedQuestionId) {
      loadExtendedQuestion(questionId);
    }
    refreshRecommendationUI('extended');
  });

  // Phrase length radio buttons - regenerate phrases when changed
  phraseLengthRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (fillPhrasesSection.style.display !== 'none') {
        const selectedPhraseLength = parseInt(radio.value, 10);
        phrasesTranscript.innerHTML = '<p>Analyzing phrases...</p>';

        generatePhraseGaps(extendedCorrectTranscript, selectedPhraseLength).then(result => {
          extendedPhraseTranscript = result;
          phrasesTranscript.innerHTML = extendedPhraseTranscript;
          extendedPhraseAnswers = {};

          // Add event listeners to new phrase inputs
          phrasesTranscript.querySelectorAll('.phrase-input').forEach(input => {
            input.addEventListener('input', (e) => {
              const phraseId = e.target.dataset.phraseId;
              extendedPhraseAnswers[phraseId] = e.target.value.trim().toLowerCase();
            });
          });
        }).catch(error => {
          log.error('Error generating phrase gaps:', error);
          phrasesTranscript.innerHTML = '<p>Error generating phrases. Please try again.</p>';
        });
      }
    });
  });

  // Check Phrases button
  checkPhrasesBtn.addEventListener("click", () => {
    const phraseInputs = phrasesTranscript.querySelectorAll('.phrase-input');
    let correctCount = 0;
    let totalPhrases = phraseInputs.length;
    const phraseResults = [];

    phraseInputs.forEach(input => {
      const userAnswer = input.value.trim().toLowerCase();
      const correctAnswer = input.dataset.correct.toLowerCase();
      const correctAnswerDisplay = input.dataset.correct; // Keep original case for display
      const userAnswerDisplay = input.value.trim(); // Keep original case for display
      const isCorrect = userAnswer === correctAnswer;

      phraseResults.push({
        phraseId: input.dataset.phraseId || input.dataset.gapId || String(phraseResults.length + 1),
        userAnswer: userAnswerDisplay,
        normalizedUserAnswer: userAnswer,
        correctAnswer: correctAnswerDisplay,
        isCorrect
      });

      // Split into words for comparison
      const userWords = userAnswer.split(/\s+/).filter(w => w.length > 0);
      const correctWords = correctAnswer.split(/\s+/).filter(w => w.length > 0);
      const correctWordsDisplay = correctAnswerDisplay.split(/\s+/).filter(w => w.length > 0);

      // Create a replacement span that looks like an input but can contain HTML
      const replacementSpan = document.createElement('span');
      replacementSpan.className = 'phrase-result';
      replacementSpan.style.display = 'inline-block';
      replacementSpan.style.padding = '2px 6px';
      replacementSpan.style.minWidth = '60px';
      replacementSpan.style.border = '2px solid';
      replacementSpan.style.borderRadius = '4px';
      replacementSpan.style.fontSize = 'inherit';
      replacementSpan.style.fontFamily = 'inherit';
      replacementSpan.style.verticalAlign = 'baseline';
      replacementSpan.style.textAlign = 'center';

      if (isCorrect) {
        // All words correct: green color, bold, green box highlight
        replacementSpan.style.backgroundColor = '#dcfce7';
        replacementSpan.style.color = '#166534';
        replacementSpan.style.fontWeight = 'bold';
        replacementSpan.style.borderColor = '#16a34a';
        replacementSpan.textContent = correctAnswerDisplay;
        correctCount++;
      } else if (userAnswer === '') {
        // Empty: red box highlight, show all correct words in green and bold
        replacementSpan.style.backgroundColor = '#fee2e2';
        replacementSpan.style.borderColor = '#dc2626';
        replacementSpan.innerHTML = correctWordsDisplay.map(word =>
          `<span style="color: #16a34a; font-weight: bold;">${word}</span>`
        ).join(' ');
      } else {
        // Compare word by word
        const userWordsDisplayArray = userAnswerDisplay.split(/\s+/).filter(w => w.length > 0);
        const typedParts = [];
        const correctParts = [];
        let allIncorrect = true;

        // Build correct parts (always show all correct words after slash)
        correctWordsDisplay.forEach(word => {
          correctParts.push(`<span style="color: #16a34a; font-weight: bold;">${word}</span>`);
        });

        // Compare each word
        for (let i = 0; i < Math.max(userWords.length, correctWords.length); i++) {
          const userWord = userWords[i];
          const correctWord = correctWords[i];
          const userWordDisplay = userWordsDisplayArray[i] || '';
          const correctWordDisplay = correctWordsDisplay[i] || '';

          if (userWord && correctWord) {
            if (userWord === correctWord) {
              // Word is correct - show in green
              typedParts.push(`<span style="color: #16a34a; font-weight: bold;">${correctWordDisplay}</span>`);
              allIncorrect = false;
            } else {
              // Word is incorrect - show in red and bold
              typedParts.push(`<span style="color: #991b1b; font-weight: bold;">${userWordDisplay}</span>`);
            }
          } else if (userWord) {
            // Extra word typed - show in red and bold
            typedParts.push(`<span style="color: #991b1b; font-weight: bold;">${userWordDisplay}</span>`);
          }
          // If correctWord exists but userWord doesn't, we don't add to typedParts (missing word)
        }

        // Build the display
        replacementSpan.style.backgroundColor = '#fee2e2';
        replacementSpan.style.borderColor = '#dc2626';

        if (allIncorrect && typedParts.length > 0) {
          // All words incorrect: show all typed words in red and bold, then slash, then all correct words in green
          replacementSpan.innerHTML = `<span style="color: #991b1b; font-weight: bold;">${userAnswerDisplay}</span> / ${correctParts.join(' ')}`;
        } else {
          // Some words correct, some incorrect: show typed words (red for incorrect, green for correct), then slash, then all correct words
          replacementSpan.innerHTML = `${typedParts.join(' ')} / ${correctParts.join(' ')}`;
        }
      }

      // Replace the input with the span
      input.parentNode.replaceChild(replacementSpan, input);
    });

    // Show Redo button
    redoPhrasesBtn.style.display = 'inline-block';

    // Show result message
    const isFullyCorrect = totalPhrases > 0 && correctCount === totalPhrases;
    checkResultPhrases.textContent = `You got ${correctCount} out of ${totalPhrases} phrases correct!`;
    checkResultPhrases.style.display = 'block';

    recordPracticeAttempt(currentExtendedQuestionId || 'extended', isFullyCorrect, 'phrases');

    if (window.extendedPerformanceTracker) {
      const timeTaken = Math.max(2, (Date.now() - (window.extendedQuestionStartTime || Date.now())) / 1000);
      const accuracy = totalPhrases > 0 ? Math.max(0, Math.min(1, correctCount / totalPhrases)) : 0;
      window.extendedPerformanceTracker.recordAttempt({
        correct: isFullyCorrect,
        accuracy,
        attempts: 1,
        hintUsed: !!supportPhrasesActive,
        timeTaken,
        wordCount: totalPhrases
      });
    }

    // Dual-Track Scoring Integration (v6)
    if (window.handleDualTrackScoring) {
      // Note: Phrases also contributes to the 'extended' mode pool for proficiency
      window.handleDualTrackScoring('extended', currentExtendedQuestionId || 'extended', correctCount, totalPhrases);
    }

    const extendedQuestion = extendedDatabase.find(q => q.id === currentExtendedQuestionId) || null;
    window.PTEAttemptArchive?.saveAttempt?.({
      practiceMode: 'extended',
      promptSnapshot: {
        promptId: currentExtendedQuestionId || 'extended',
        text: extendedCorrectTranscript || extendedGappedTranscript || '',
        sourceAssetPaths: [extendedQuestion?.audioFile].filter(Boolean),
        data: extendedQuestion
      },
      responseSnapshot: {
        phrases: phraseResults.map(({ phraseId, userAnswer }) => ({ phraseId, userAnswer }))
      },
      answerSnapshot: {
        phrases: phraseResults.map(({ phraseId, correctAnswer, userAnswer, isCorrect }) => ({
          phraseId,
          correctAnswer,
          userAnswer,
          isCorrect
        }))
      },
      resultSnapshot: {
        score: correctCount,
        maxScore: totalPhrases,
        correct: isFullyCorrect,
        results: phraseResults
      },
      scoringSource: 'client'
    }).catch((error) => log.warn('[PTE Archive] Extended phrases save failed:', error));
  });

  // Redo Phrases button
  redoPhrasesBtn.addEventListener("click", () => {
    // Reset phrases support mode
    supportPhrasesActive = false;
    if (supportPhrasesBtn) {
      supportPhrasesBtn.textContent = 'Show Hints';
      supportPhrasesBtn.style.backgroundColor = '';
      supportPhrasesBtn.style.color = '';
    }

    // Regenerate the phrases transcript to restore inputs (since they were replaced with spans after checking)
    const selectedPhraseLength = parseInt(document.querySelector('input[name="phrase-length"]:checked').value, 10);
    phrasesTranscript.innerHTML = '<p>Analyzing phrases...</p>';

    generatePhraseGaps(extendedCorrectTranscript, selectedPhraseLength).then(result => {
      extendedPhraseTranscript = result;
      phrasesTranscript.innerHTML = extendedPhraseTranscript;
      extendedPhraseAnswers = {};

      // Add event listeners to new phrase inputs
      phrasesTranscript.querySelectorAll('.phrase-input').forEach(input => {
        input.addEventListener('input', (e) => {
          const phraseId = e.target.dataset.phraseId;
          extendedPhraseAnswers[phraseId] = e.target.value.trim().toLowerCase();
        });
      });
    }).catch(error => {
      log.error('Error regenerating phrase gaps:', error);
      phrasesTranscript.innerHTML = '<p>Error regenerating phrases. Please try again.</p>';
    });

    // Hide buttons and result message
    redoPhrasesBtn.style.display = 'none';
    checkResultPhrases.style.display = 'none';
  });


  // Extract missed words from diff
  const getMissedWords = (diff) => {
    const missed = [];
    diff.forEach((part) => {
      if (part.type === "missing") {
        missed.push(part.text);
      }
    });
    // Remove duplicates while preserving order
    return [...new Set(missed)];
  };

  // Store vocabulary practice words for sentence generation
  let vocabularyPracticeWordsType = [];
  let vocabularyPracticeWordsSpeak = [];

  // Find sentences from database containing a specific word
  const findSentencesWithWord = (word, mode, excludeQuestionId, excludeQuestionIds = []) => {
    const database = mode === "type" ? typeDatabase : speakDatabase;
    const lowerWord = word.toLowerCase().trim();
    const wordRegex = new RegExp(`\\b${lowerWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

    // Combine all excluded IDs
    const allExcluded = [excludeQuestionId, ...excludeQuestionIds].filter(id => id !== undefined && id !== null);

    const matches = [];
    for (const item of database) {
      // Skip excluded questions
      if (allExcluded.includes(item.id)) continue;

      // Check if the sentence contains the word (case-insensitive, whole word match)
      if (wordRegex.test(item.correctSentence)) {
        matches.push(item);
      }
    }

    return matches;
  };

  // Function to pick another sentence with the same word
  const pickAnotherSentence = (sentenceId, targetWord, mode) => {
    const itemEl = document.querySelector(`.same-vocab-item [data-sentence-id="${sentenceId}"]`)?.closest('.same-vocab-item');
    if (!itemEl) return;

    const currentQuestionId = parseInt(itemEl.dataset.questionId, 10);
    const currentQuestionIds = [currentQuestionId];

    // Get all previously used question IDs for this word (stored in data attribute)
    const usedIdsStr = itemEl.dataset.usedQuestionIds || '';
    if (usedIdsStr) {
      const usedIds = usedIdsStr.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      currentQuestionIds.push(...usedIds);
    }

    // Find another sentence with the same word, excluding all used ones
    const currentMainQuestionId = mode === "type" ? currentTypeQuestionId : currentSpeakQuestionId;
    const matches = findSentencesWithWord(targetWord, mode, currentMainQuestionId, currentQuestionIds);

    if (matches.length === 0) {
      alert("No more sentences found with this word.");
      return;
    }

    // Pick a random match
    const newMatch = matches[Math.floor(Math.random() * matches.length)];

    // Update the item's question ID
    itemEl.dataset.questionId = newMatch.id;

    // Add current question ID to used list
    const updatedUsedIds = [...currentQuestionIds, newMatch.id].join(',');
    itemEl.dataset.usedQuestionIds = updatedUsedIds;

    // Update sentence display
    const sentenceEl = document.getElementById(`sentence-${sentenceId}`);
    if (sentenceEl) {
      sentenceEl.textContent = newMatch.correctSentence;
    }

    // Update Check button data attributes
    const checkBtn = document.querySelector(`.same-vocab-check-btn[data-sentence-id="${sentenceId}"]`);
    if (checkBtn) {
      checkBtn.dataset.correct = newMatch.correctSentence;
      checkBtn.dataset.questionId = newMatch.id;
    }

    // Update Play button data attributes
    const playBtn = document.querySelector(`.same-vocab-play-btn[data-sentence-id="${sentenceId}"]`);
    if (playBtn) {
      playBtn.dataset.questionId = newMatch.id;
    }

    // Reset input/transcription
    if (mode === "type") {
      const inputEl = document.getElementById(`input-${sentenceId}`);
      if (inputEl) inputEl.value = "";
    } else {
      const transcriptionEl = document.getElementById(`transcription-${sentenceId}`);
      if (transcriptionEl) {
        transcriptionEl.textContent = "Click \"Start Recording\" and speak...";
        transcriptionEl.classList.add("empty");
      }
      sameVocabTranscriptions[sentenceId] = "";
    }

    // Reset status
    const statusEl = document.getElementById(`status-${sentenceId}`);
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.className = "";
    }

    // Hide "Pick another" button again
    const pickAnotherBtn = document.querySelector(`.same-vocab-pick-another-btn[data-sentence-id="${sentenceId}"]`);
    if (pickAnotherBtn) pickAnotherBtn.style.display = "none";

    // Hide word label and sentence again
    const wordLabelEl = document.getElementById(`word-label-${sentenceId}`);
    if (wordLabelEl) wordLabelEl.style.display = "none";
    if (sentenceEl) sentenceEl.style.display = "none";
  };

  // Render "Other questions with the same vocabulary" box for Type mode
  const renderSameVocabularyType = () => {
    if (vocabularyPracticeWordsType.length === 0) {
      sameVocabPanelType.style.display = "none";
      return;
    }

    const currentQuestionId = currentTypeQuestionId;
    const sentencesHTML = [];

    vocabularyPracticeWordsType.forEach((word, idx) => {
      const matches = findSentencesWithWord(word, "type", currentQuestionId);

      if (matches.length > 0) {
        const match = matches[0]; // Use first match
        const sentenceId = `same-vocab-type-${idx}`;
        const targetWord = word.toLowerCase().trim();

        sentencesHTML.push(`
          <div class="same-vocab-item" data-vocab-word="${targetWord}" data-question-id="${match.id}">
            <div class="same-vocab-word-label" id="word-label-${sentenceId}" style="display: none;">Word to focus on: <strong>${word}</strong></div>
            <div class="same-vocab-sentence" id="sentence-${sentenceId}" style="display: none;">${match.correctSentence}</div>
            <div class="same-vocab-controls">
              <button class="same-vocab-play-btn" data-sentence-id="${sentenceId}" data-question-id="${match.id}" data-mode="type" type="button">Play</button>
              <input type="text" class="same-vocab-input" id="input-${sentenceId}" placeholder="Type your answer here..." />
              <button class="same-vocab-check-btn" data-sentence-id="${sentenceId}" data-word="${targetWord}" data-correct="${match.correctSentence}" data-question-id="${match.id}" data-mode="type" type="button">Check</button>
              <button class="same-vocab-pick-another-btn" data-sentence-id="${sentenceId}" data-word="${targetWord}" data-mode="type" type="button" style="display: none;">Pick another</button>
            </div>
            <div class="same-vocab-status" id="status-${sentenceId}"></div>
          </div>
        `);
      }
    });

    if (sentencesHTML.length === 0) {
      sameVocabPanelType.style.display = "none";
      return;
    }

    sameVocabPanelType.style.display = "block";
    sameVocabSentencesType.innerHTML = sentencesHTML.join("");

    // Add event listeners for Play buttons
    sameVocabSentencesType.querySelectorAll(".same-vocab-play-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const questionId = parseInt(btn.dataset.questionId, 10);
        const mode = btn.dataset.mode;
        playSameVocabAudio(questionId, mode, btn);
      });
    });

    // Add event listeners for Check buttons
    sameVocabSentencesType.querySelectorAll(".same-vocab-check-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sentenceId = btn.dataset.sentenceId;
        const targetWord = btn.dataset.word;
        const correctSentence = btn.dataset.correct;
        checkSameVocabAnswer(sentenceId, targetWord, correctSentence);
      });
    });

    // Add event listeners for "Pick another" buttons
    sameVocabSentencesType.querySelectorAll(".same-vocab-pick-another-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sentenceId = btn.dataset.sentenceId;
        const targetWord = btn.dataset.word;
        const mode = btn.dataset.mode;
        pickAnotherSentence(sentenceId, targetWord, mode);
      });
    });
  };

  // Render "Other questions with the same vocabulary" box for Speak mode
  const renderSameVocabularySpeak = () => {
    if (vocabularyPracticeWordsSpeak.length === 0) {
      sameVocabPanelSpeak.style.display = "none";
      return;
    }

    const currentQuestionId = currentSpeakQuestionId;
    const sentencesHTML = [];

    vocabularyPracticeWordsSpeak.forEach((word, idx) => {
      const matches = findSentencesWithWord(word, "speak", currentQuestionId);

      if (matches.length > 0) {
        const match = matches[0]; // Use first match
        const sentenceId = `same-vocab-speak-${idx}`;
        const targetWord = word.toLowerCase().trim();

        sentencesHTML.push(`
          <div class="same-vocab-item" data-vocab-word="${targetWord}" data-question-id="${match.id}">
            <div class="same-vocab-word-label" id="word-label-${sentenceId}" style="display: none;">Word to focus on: <strong>${word}</strong></div>
            <div class="same-vocab-sentence" id="sentence-${sentenceId}" style="display: none;">${match.correctSentence}</div>
            <div class="same-vocab-controls">
              <button class="same-vocab-play-btn" data-sentence-id="${sentenceId}" data-question-id="${match.id}" data-mode="speak" type="button">Play</button>
              <button class="same-vocab-record-btn" data-sentence-id="${sentenceId}" type="button">Start Recording</button>
              <button class="same-vocab-check-btn" data-sentence-id="${sentenceId}" data-word="${targetWord}" data-correct="${match.correctSentence}" data-question-id="${match.id}" data-mode="speak" type="button">Check</button>
              <button class="same-vocab-pick-another-btn" data-sentence-id="${sentenceId}" data-word="${targetWord}" data-mode="speak" type="button" style="display: none;">Pick another</button>
            </div>
            <div class="same-vocab-transcription" id="transcription-${sentenceId}">Click "Start Recording" and speak...</div>
            <div class="same-vocab-status" id="status-${sentenceId}"></div>
          </div>
        `);
      }
    });

    if (sentencesHTML.length === 0) {
      sameVocabPanelSpeak.style.display = "none";
      return;
    }

    sameVocabPanelSpeak.style.display = "block";
    sameVocabSentencesSpeak.innerHTML = sentencesHTML.join("");

    // Add event listeners for Play buttons
    sameVocabSentencesSpeak.querySelectorAll(".same-vocab-play-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const questionId = parseInt(btn.dataset.questionId, 10);
        const mode = btn.dataset.mode;
        playSameVocabAudio(questionId, mode, btn);
      });
    });

    // Add event listeners for Record buttons
    sameVocabSentencesSpeak.querySelectorAll(".same-vocab-record-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sentenceId = btn.dataset.sentenceId;
        startSameVocabRecording(sentenceId, btn);
      });
    });

    // Add event listeners for Check buttons
    sameVocabSentencesSpeak.querySelectorAll(".same-vocab-check-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sentenceId = btn.dataset.sentenceId;
        const targetWord = btn.dataset.word;
        const correctSentence = btn.dataset.correct;
        checkSameVocabAnswerSpeak(sentenceId, targetWord, correctSentence);
      });
    });

    // Add event listeners for "Pick another" buttons
    sameVocabSentencesSpeak.querySelectorAll(".same-vocab-pick-another-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sentenceId = btn.dataset.sentenceId;
        const targetWord = btn.dataset.word;
        const mode = btn.dataset.mode;
        pickAnotherSentence(sentenceId, targetWord, mode);
      });
    });
  };

  // Helper function to check if a file exists
  const checkFileExists = async (url) => {
    try {
      // Use HEAD method to check if file exists
      const response = await fetch(url, {
        method: 'HEAD',
        cache: 'no-cache'
      });

      const status = response.status;
      const contentType = response.headers.get('content-type');

      // Check if it's a successful response (200 OK)
      if (response.ok && status === 200) {
        // Must have audio content-type to be valid
        if (contentType && contentType.startsWith('audio/')) {
          log.debug(`[checkFileExists] ✓ Valid audio file: ${url} (Content-Type: ${contentType})`);
          return true;
        } else {
          log.debug(`[checkFileExists] ✗ Not an audio file: ${url} (Status: ${status}, Content-Type: ${contentType || 'none'})`);
          return false;
        }
      } else {
        log.debug(`[checkFileExists] ✗ Request failed: ${url} (Status: ${status})`);
        return false;
      }
    } catch (e) {
      log.debug(`[checkFileExists] ✗ Error checking ${url}:`, e.message);
      return false;
    }
  };

  // Play audio for same vocabulary question
  const playSameVocabAudio = async (questionId, mode, btn) => {
    log.debug(`playSameVocabAudio called: questionId=${questionId}, mode=${mode}`);

    const database = mode === "type" ? typeDatabase : speakDatabase;
    const question = database.find(item => item.id === questionId);

    if (!question) {
      log.error(`Question ${questionId} not found in ${mode} database`);
      log.debug(`Database length: ${database.length}`);
      log.debug(`First 10 IDs in ${mode} database:`, database.slice(0, 10).map(q => q.id));
      alert(`Question ${questionId} not found in ${mode} database`);
      return;
    }

    // Determine MIME type based on file extension
    const getAudioMimeType = (filename) => {
      const ext = filename.toLowerCase().split('.').pop();
      const mimeTypes = {
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'm4a': 'audio/mp4',
        'aac': 'audio/aac',
        'ogg': 'audio/ogg',
        'oga': 'audio/ogg'
      };
      return mimeTypes[ext] || 'audio/mpeg';
    };

    // Get the base filename (without extension)
    const baseFilename = question.audioFile
      ? question.audioFile.replace(/\.[^.]+$/, '')
      : questionId.toString();

    // Try extensions in order
    const tryExtensions = ['m4a', 'wav', 'mp3', 'aac', 'ogg'];

    // Find starting index - try database extension first
    let startIndex = 0;
    if (question.audioFile) {
      const currentExt = question.audioFile.toLowerCase().split('.').pop();
      const extIndex = tryExtensions.indexOf(currentExt);
      if (extIndex !== -1) {
        startIndex = extIndex;
      }
    }

    // Try to find the file by checking each extension
    let foundFile = null;
    let foundIndex = startIndex;

    // Check starting from database extension, then wrap around
    for (let i = 0; i < tryExtensions.length; i++) {
      const checkIndex = (startIndex + i) % tryExtensions.length;
      const ext = tryExtensions[checkIndex];
      const testFile = `${baseFilename}.${ext}`;
      const testPath = `database/${mode}/audio/${testFile}`;

      log.debug(`[playSameVocabAudio] Checking if file exists (attempt ${i + 1}/${tryExtensions.length}): ${testFile}`);
      const exists = await checkFileExists(testPath);

      if (exists) {
        foundFile = testFile;
        foundIndex = checkIndex;
        log.debug(`Found file: ${foundFile}`);
        break;
      }
    }

    if (!foundFile) {
      log.warn(`No audio file found for question ${questionId}. Tried all extensions.`);
      return;
    }

    const audioPath = `database/${mode}/audio/${foundFile}?t=${Date.now()}`;
    const mimeType = getAudioMimeType(foundFile);

    log.debug(`Playing audio: ${audioPath} (MIME type: ${mimeType})`);

    // Use dedicated vocab-audio element to avoid overwriting main question audio
    const vocabAudio = document.getElementById("vocab-audio");

    if (!vocabAudio) {
      log.error("Vocab audio element not found");
      return;
    }

    // Stop any currently playing audio and reset
    vocabAudio.pause();
    vocabAudio.currentTime = 0;

    // Clear any existing source elements
    while (vocabAudio.firstChild) {
      vocabAudio.removeChild(vocabAudio.firstChild);
    }

    // Create source element with proper type
    const source = document.createElement('source');
    source.src = audioPath;
    source.type = mimeType;
    vocabAudio.appendChild(source);

    // Load and play
    vocabAudio.load();
    vocabAudio.play().catch(err => {
      log.error("Error playing audio:", err);
    });
  };

  // Start recording for same vocabulary question (Speak mode)
  const startSameVocabRecording = (sentenceId, btn) => {
    log.debug("startSameVocabRecording called:", { sentenceId, btnText: btn.textContent });

    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in your browser.");
      return;
    }

    const transcriptionEl = document.getElementById(`transcription-${sentenceId}`);
    if (!transcriptionEl) {
      log.error(`Transcription element not found: transcription-${sentenceId}`);
      return;
    }

    // Stop main recognition if it's running to avoid conflicts
    if (recognition && isRecording) {
      try {
        recognition.stop();
        isRecording = false;
        if (recordBtn) {
          recordBtn.textContent = "Start Recording";
          recordBtn.classList.remove("recording");
        }
      } catch (e) {
        log.debug("Error stopping main recognition:", e);
      }
    }

    // Stop any existing recognition for this item
    if (sameVocabRecognitions[sentenceId]) {
      try {
        sameVocabRecognitions[sentenceId].stop();
        delete sameVocabRecognitions[sentenceId];
      } catch (e) {
        log.debug("Error stopping existing recognition:", e);
      }
    }

    // Initialize transcription if not exists
    if (!sameVocabTranscriptions[sentenceId]) {
      sameVocabTranscriptions[sentenceId] = "";
    }

    if (btn.textContent === "Start Recording") {
      // Clear previous transcription when starting a new recording
      sameVocabTranscriptions[sentenceId] = "";
      transcriptionEl.textContent = "Listening...";
      transcriptionEl.classList.remove("empty");
      transcriptionEl.style.borderColor = ""; // Clear any previous border color

      // Clear any previous status messages
      const statusEl = document.getElementById(`status-${sentenceId}`);
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.className = "";
      }

      // Create new recognition instance for this item
      const itemRecognition = new SpeechRecognition();
      itemRecognition.continuous = true;
      itemRecognition.interimResults = true;
      itemRecognition.lang = "en-US";

      // Start recording
      btn.textContent = "Stop Recording";
      btn.classList.add("recording");

      itemRecognition.onstart = () => {
        log.debug(`Recognition started for ${sentenceId}`);
        transcriptionEl.textContent = "Listening...";
      };

      itemRecognition.onresult = (event) => {
        let interimText = "";
        let finalText = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += transcript + " ";
          } else {
            interimText += transcript;
          }
        }

        // Accumulate final transcript
        if (finalText) {
          sameVocabTranscriptions[sentenceId] += finalText;
        }

        // Display: accumulated final transcript + current interim text
        const displayText = sameVocabTranscriptions[sentenceId] + (interimText ? " " + interimText : "");
        transcriptionEl.textContent = displayText || "Listening...";
        transcriptionEl.classList.remove("empty");
      };

      itemRecognition.onerror = (event) => {
        log.error(`Recognition error for ${sentenceId}:`, event.error);
        if (event.error === "no-speech") {
          transcriptionEl.textContent = "No speech detected. Try again.";
        } else if (event.error === "aborted") {
          // Ignore aborted errors - they happen when we stop manually
          return;
        } else {
          transcriptionEl.textContent = `Error: ${event.error}`;
          btn.textContent = "Start Recording";
          btn.classList.remove("recording");
        }
      };

      itemRecognition.onend = () => {
        log.debug(`Recognition ended for ${sentenceId}`);
        // Auto-restart if still in recording state
        if (btn.textContent === "Stop Recording") {
          try {
            log.debug(`Auto-restarting recognition for ${sentenceId}`);
            itemRecognition.start();
          } catch (e) {
            log.error("Failed to auto-restart recognition:", e);
            // Recognition might have been stopped manually
            btn.textContent = "Start Recording";
            btn.classList.remove("recording");
            if (!sameVocabTranscriptions[sentenceId] || sameVocabTranscriptions[sentenceId].trim() === "") {
              transcriptionEl.textContent = "Click 'Start Recording' and speak...";
              transcriptionEl.classList.add("empty");
            }
          }
        }
      };

      sameVocabRecognitions[sentenceId] = itemRecognition;

      try {
        log.debug(`Starting recognition for ${sentenceId}`);
        itemRecognition.start();
      } catch (e) {
        log.error("Failed to start recognition:", e);
        btn.textContent = "Start Recording";
        btn.classList.remove("recording");
        transcriptionEl.textContent = `Error: ${e.message}. Click 'Start Recording' and speak...`;
        transcriptionEl.classList.add("empty");
        delete sameVocabRecognitions[sentenceId];
      }
    } else {
      // Stop recording
      const itemRecognition = sameVocabRecognitions[sentenceId];
      if (itemRecognition) {
        try {
          itemRecognition.stop();
        } catch (e) {
          log.debug("Error stopping recognition:", e);
        }
        delete sameVocabRecognitions[sentenceId];
      }
      btn.textContent = "Start Recording";
      btn.classList.remove("recording");
      if (!sameVocabTranscriptions[sentenceId] || sameVocabTranscriptions[sentenceId].trim() === "") {
        transcriptionEl.textContent = "Click 'Start Recording' and speak...";
        transcriptionEl.classList.add("empty");
      }
    }
  };

  // Check answer for same vocabulary question (only assess the specific word)
  const checkSameVocabAnswer = (sentenceId, targetWord, correctSentence) => {
    const inputEl = document.getElementById(`input-${sentenceId}`);
    const statusEl = document.getElementById(`status-${sentenceId}`);
    const wordLabelEl = document.getElementById(`word-label-${sentenceId}`);
    const sentenceEl = document.getElementById(`sentence-${sentenceId}`);
    const pickAnotherBtn = document.querySelector(`.same-vocab-pick-another-btn[data-sentence-id="${sentenceId}"]`);

    if (!inputEl || !statusEl) return;

    // Show the word label and sentence when Check is pressed
    if (wordLabelEl) wordLabelEl.style.display = "block";
    if (sentenceEl) sentenceEl.style.display = "block";

    // Show "Pick another" button
    if (pickAnotherBtn) pickAnotherBtn.style.display = "inline-block";

    const userAnswer = inputEl.value.trim().toLowerCase();
    const correctSentenceLower = correctSentence.toLowerCase();

    // Extract the target word from the correct sentence (case-insensitive, whole word match)
    const wordRegex = new RegExp(`\\b${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const correctWordMatch = correctSentence.match(wordRegex);

    if (!correctWordMatch) {
      statusEl.textContent = "Error: Target word not found in correct sentence.";
      statusEl.className = "same-vocab-status error";
      return;
    }

    const correctWord = correctWordMatch[0].toLowerCase();

    // Check if user's answer contains the target word (case-insensitive, whole word match)
    const userAnswerRegex = new RegExp(`\\b${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const userHasWord = userAnswerRegex.test(userAnswer);

    if (userHasWord) {
      statusEl.textContent = "Correct!";
      statusEl.className = "same-vocab-status correct";
      inputEl.style.borderColor = "#16a34a";
    } else {
      statusEl.textContent = `Incorrect. The word "${correctWord}" is missing.`;
      statusEl.className = "same-vocab-status incorrect";
      inputEl.style.borderColor = "#dc2626";
    }
  };

  // Check answer for same vocabulary question (Speak mode - uses speech transcription)
  const checkSameVocabAnswerSpeak = (sentenceId, targetWord, correctSentence) => {
    const statusEl = document.getElementById(`status-${sentenceId}`);
    const wordLabelEl = document.getElementById(`word-label-${sentenceId}`);
    const sentenceEl = document.getElementById(`sentence-${sentenceId}`);
    const transcriptionEl = document.getElementById(`transcription-${sentenceId}`);
    const recordBtn = document.querySelector(`[data-sentence-id="${sentenceId}"].same-vocab-record-btn`);
    const pickAnotherBtn = document.querySelector(`.same-vocab-pick-another-btn[data-sentence-id="${sentenceId}"]`);

    if (!statusEl || !transcriptionEl) return;

    // Stop recording if active
    if (recordBtn && recordBtn.textContent === "Stop Recording") {
      if (sameVocabRecognitions[sentenceId]) {
        try {
          sameVocabRecognitions[sentenceId].stop();
        } catch (e) {
          // Ignore errors
        }
      }
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
    }

    // Show the word label and sentence when Check is pressed
    if (wordLabelEl) wordLabelEl.style.display = "block";
    if (sentenceEl) sentenceEl.style.display = "block";

    // Show "Pick another" button
    if (pickAnotherBtn) pickAnotherBtn.style.display = "inline-block";

    const userAnswer = (sameVocabTranscriptions[sentenceId] || "").trim().toLowerCase();

    if (!userAnswer) {
      statusEl.textContent = "Please record your answer first.";
      statusEl.className = "same-vocab-status error";
      return;
    }

    // Extract the target word from the correct sentence (case-insensitive, whole word match)
    const wordRegex = new RegExp(`\\b${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const correctWordMatch = correctSentence.match(wordRegex);

    if (!correctWordMatch) {
      statusEl.textContent = "Error: Target word not found in correct sentence.";
      statusEl.className = "same-vocab-status error";
      return;
    }

    const correctWord = correctWordMatch[0].toLowerCase();

    // Check if user's answer contains the target word (case-insensitive, whole word match)
    const userAnswerRegex = new RegExp(`\\b${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const userHasWord = userAnswerRegex.test(userAnswer);

    if (userHasWord) {
      statusEl.textContent = "Correct!";
      statusEl.className = "same-vocab-status correct";
      transcriptionEl.style.borderColor = "#16a34a";
    } else {
      statusEl.textContent = `Incorrect. The word "${correctWord}" is missing.`;
      statusEl.className = "same-vocab-status incorrect";
      transcriptionEl.style.borderColor = "#dc2626";
    }
  };

  // Render vocabulary practice box (for Type mode)
  const renderVocabularyPractice = (diff) => {
    if (!diff || !Array.isArray(diff) || diff.length === 0) {
      vocabularyPanel.style.display = "none";
      vocabularyPracticeWordsType = [];
      return;
    }

    // Get only missed words from the user's response
    const missedWords = getMissedWords(diff);

    // Filter to only show content words (keywords) from missed words
    const contentWords = filterContentWords(missedWords);

    // Store for sentence generation
    vocabularyPracticeWordsType = contentWords.map(w => w.toLowerCase().trim());

    if (contentWords.length === 0 || !vocabularyWords) {
      vocabularyPanel.style.display = "none";
      vocabularyPracticeWordsType = [];
      return;
    }

    vocabularyPanel.style.display = "block";
    vocabularyWords.innerHTML = contentWords
      .map(
        (word, idx) => `
      <div class="vocabulary-item" data-word-index="${idx}">
        <span class="vocabulary-word" id="vocab-word-${idx}">${word}</span>
        <button class="vocabulary-play-btn" data-word="${word}" data-index="${idx}" type="button">Play</button>
        <input type="text" class="vocabulary-input" id="vocab-input-${idx}" placeholder="Type word..." disabled />
        <button class="vocabulary-check-btn" data-word="${word}" data-index="${idx}" type="button">Check</button>
        <span class="vocabulary-status" id="vocab-status-${idx}"></span>
      </div>
    `
      )
      .join("");

    // Add event listeners to play buttons
    vocabularyWords.querySelectorAll(".vocabulary-play-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const word = btn.dataset.word;
        const index = parseInt(btn.dataset.index, 10);
        playVocabularyWord(word, index, btn);
      });
    });

    // Add event listeners to check buttons
    vocabularyWords.querySelectorAll(".vocabulary-check-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const word = btn.dataset.word;
        const index = parseInt(btn.dataset.index, 10);
        checkVocabularyWord(word, index, btn);
      });
    });
  };

  // Play vocabulary word audio and hide the word
  const playVocabularyWord = (word, index, btn) => {
    if (!synth || !word) return;

    // Hide the word
    const wordEl = document.getElementById(`vocab-word-${index}`);
    if (wordEl) {
      wordEl.style.display = "none";
    }

    // Play audio
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = "en-US";
    const voices = synth.getVoices();
    const preferred = voices.find((v) =>
      /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
    );
    if (preferred) utter.voice = preferred;
    utter.rate = 1.0;
    utter.pitch = 1.0;
    synth.speak(utter);

    // Enable input and clear status
    const inputEl = document.getElementById(`vocab-input-${index}`);
    const statusEl = document.getElementById(`vocab-status-${index}`);
    if (inputEl) {
      inputEl.disabled = false;
      inputEl.placeholder = "Type the word...";
      inputEl.value = "";
      inputEl.focus();
    }
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.className = "vocabulary-status";
    }
  };

  // Check typed vocabulary word
  const checkVocabularyWord = (expectedWord, index, btn) => {
    const inputEl = document.getElementById(`vocab-input-${index}`);
    const statusEl = document.getElementById(`vocab-status-${index}`);
    const wordEl = document.getElementById(`vocab-word-${index}`);

    if (!inputEl || !statusEl) return;

    const userInput = inputEl.value.trim().toLowerCase();
    const expected = expectedWord.toLowerCase().trim();

    if (!userInput) {
      statusEl.textContent = "Please type the word first.";
      statusEl.className = "vocabulary-status error";
      return;
    }

    // Disable input after check
    inputEl.disabled = true;
    inputEl.placeholder = "Press Play to listen to the word before typing";

    // Normalize for comparison
    const normalizedUser = normalize(userInput);
    const normalizedExpected = normalize(expected);

    if (normalizedUser === normalizedExpected) {
      statusEl.textContent = "✓ Correct!";
      statusEl.className = "vocabulary-status correct";
      // Show the word again
      if (wordEl) {
        wordEl.style.display = "inline";
      }
    } else {
      statusEl.textContent = `Incorrect. Correct: "${expectedWord}"`;
      statusEl.className = "vocabulary-status incorrect";
      // Show the word again
      if (wordEl) {
        wordEl.style.display = "inline";
      }
    }
  };

  // Render pronunciation practice box
  const renderPronunciationPractice = (missedWords) => {
    // Filter to only show content words (keywords)
    // Double-check: ensure we're filtering properly
    const contentWords = filterContentWords(missedWords);

    // Store for sentence generation (Speak mode)
    vocabularyPracticeWordsSpeak = contentWords.map(w => w.toLowerCase().trim());

    if (contentWords.length === 0) {
      pronunciationPanel.style.display = "none";
      vocabularyPracticeWordsSpeak = [];
      return;
    }

    pronunciationPanel.style.display = "block";
    pronunciationWords.innerHTML = contentWords
      .map(
        (word, idx) => `
      <div class="pronunciation-item" data-word-index="${idx}">
        <span class="pronunciation-word" id="pron-word-${idx}">${word}</span>
        <button class="pronunciation-record-btn" data-word="${word}" data-index="${idx}" type="button">Record</button>
        <span class="pronunciation-status" id="pron-status-${idx}"></span>
      </div>
    `
      )
      .join("");

    // Add event listeners to record buttons
    pronunciationWords.querySelectorAll(".pronunciation-record-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const word = btn.dataset.word;
        const index = parseInt(btn.dataset.index, 10);
        startWordRecording(word, index, btn);
      });
    });
  };

  // Start recording for individual word
  const startWordRecording = async (expectedWord, index, btn) => {
    if (!SpeechRecognition) {
      alert("Speech recognition is not available in your browser.");
      return;
    }

    // Ensure microphone access is granted
    await ensureMicrophoneAccess();

    // Stop any ongoing word recording
    if (wordRecognition) {
      wordRecognition.stop();
      wordRecognition = null;
    }

    // Stop main recording if active
    if (isRecording && recognition) {
      recognition.stop();
      isRecording = false;
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      recordingStatus.classList.remove("active");
    }

    currentWordIndex = index;
    btn.textContent = "Recording...";
    btn.classList.add("recording");
    const statusEl = document.getElementById(`pron-status-${index}`);
    statusEl.textContent = "Listening...";
    const wordEl = document.getElementById(`pron-word-${index}`);
    wordEl.classList.remove("correct", "incorrect");

    // Reuse wordRecognition if it exists, otherwise create new
    if (!wordRecognition) {
      wordRecognition = new SpeechRecognition();
      wordRecognition.continuous = false;
      wordRecognition.interimResults = false;
      wordRecognition.lang = "en-US";
      wordRecognition.maxAlternatives = 1;
    }

    wordRecognition.onresult = (event) => {
      const spokenText = event.results[0][0].transcript.trim().toLowerCase();
      const expected = normalize(expectedWord);
      const match = normalize(spokenText) === expected;

      wordEl.classList.remove("correct", "incorrect");
      if (match) {
        wordEl.classList.add("correct");
        statusEl.textContent = "✓ Correct!";
        statusEl.style.color = "#166534";
      } else {
        wordEl.classList.add("incorrect");
        statusEl.textContent = `You said: "${spokenText}"`;
        statusEl.style.color = "#b91c1c";
      }

      btn.textContent = "Record";
      btn.classList.remove("recording");
      wordRecognition = null;
      currentWordIndex = -1;
    };

    wordRecognition.onerror = (event) => {
      statusEl.textContent = `Error: ${event.error}`;
      statusEl.style.color = "#b91c1c";
      btn.textContent = "Record";
      btn.classList.remove("recording");
      wordRecognition = null;
      currentWordIndex = -1;
    };

    wordRecognition.onend = () => {
      if (currentWordIndex === index) {
        // Only reset if this is still the active recording
        btn.textContent = "Record";
        btn.classList.remove("recording");
        if (!statusEl.textContent || statusEl.textContent === "Listening...") {
          statusEl.textContent = "No speech detected. Try again.";
          statusEl.style.color = "#b91c1c";
        }
        wordRecognition = null;
        currentWordIndex = -1;
      }
    };

    try {
      wordRecognition.start();
    } catch (e) {
      log.error("Failed to start word recognition:", e);
      btn.textContent = "Record";
      btn.classList.remove("recording");
      statusEl.textContent = "Failed to start recording";
      statusEl.style.color = "#b91c1c";
      wordRecognition = null;
      currentWordIndex = -1;
    }
  };

  /**
   * Dual Track Scoring Helper (Track A: XP + Track B: Proficiency)
   * PHASE 2.1: TRUE SERVER-AUTHORITATIVE SCORING
   * Client sends raw answers when possible; server computes accuracy from canonical content.
   * For non-canonical activities (e.g. dynamic gap-fill, SRS quality, AI writing score), client sends
   * structured payload inputs that the server can normalize and clamp.
   */
  const handleDualTrackScoring = async (mode, questionId, userAnswerData, totalWords) => {
    // 1. Basic Validation
    if (!window.auth || !window.auth.currentUser) return; // Guest

    // 2. Check for Cloud Function wrapper
    if (!window.callSubmitAttempt) {
      console.warn('[Scoring] Cloud Function wrapper not loaded');
      return;
    }

    try {
      // 3. Build mode-specific payload with RAW answers (not computed accuracy)
      const normalizedContentId = String(questionId);
      const attemptContext = ensureAttemptContext(mode, normalizedContentId);
      const attemptId = attemptContext.attemptId;
      let payload = {};

      if (mode === 'type' || mode === 'speak') {
        // Send the actual user text for server-side F1 computation
        if (typeof userAnswerData === 'string') {
          payload = { text: userAnswerData };
        } else if (Array.isArray(userAnswerData)) {
          // If we received diff pieces, extract the user text from matches + extras
          const userText = userAnswerData
            .filter(p => p.type === 'match' || p.type === 'extra' || p.type === 'misplaced')
            .map(p => (p.text ?? p.value ?? ''))
            .filter(Boolean)
            .join(' ');
          payload = { text: userText };
        }
      } else if (mode === 'extended') {
        // Prefer canonical gap answers if available; otherwise accept client-verified counts.
        if (Array.isArray(userAnswerData)) {
          payload = { answers: userAnswerData };
        } else if (typeof userAnswerData === 'object' && userAnswerData?.answers) {
          payload = { answers: userAnswerData.answers };
        } else if (typeof userAnswerData === 'number' && typeof totalWords === 'number') {
          payload = { correctCount: userAnswerData, totalCount: totalWords };
        } else if (typeof userAnswerData === 'object' && userAnswerData?.correctCount !== undefined && userAnswerData?.totalCount !== undefined) {
          payload = { correctCount: userAnswerData.correctCount, totalCount: userAnswerData.totalCount };
        }
      } else if (mode === 'writingChallenge') {
        // Writing Challenge can submit either a raw sentence or an AI-derived accuracy (0..1).
        if (typeof userAnswerData === 'string') {
          payload = { text: userAnswerData };
        } else if (typeof userAnswerData === 'number') {
          payload = { accuracy: userAnswerData };
        } else if (typeof userAnswerData === 'object' && userAnswerData) {
          if (typeof userAnswerData.text === 'string') payload = { text: userAnswerData.text };
          else if (userAnswerData.accuracy !== undefined) payload = { accuracy: userAnswerData.accuracy };
        }
      } else if (mode === 'srs') {
        // SRS reviews submit a quality rating (0..5).
        if (typeof userAnswerData === 'number') {
          payload = { quality: userAnswerData };
        } else if (typeof userAnswerData === 'object' && userAnswerData) {
          if (userAnswerData.quality !== undefined) payload = { quality: userAnswerData.quality };
        }
      } else if (mode === 'watch') {
        // Multiple-choice: selectedIndex. Open-ended: text.
        if (typeof userAnswerData === 'number') {
          payload = { selectedIndex: userAnswerData };
        } else if (typeof userAnswerData === 'string') {
          payload = { text: userAnswerData };
        } else if (typeof userAnswerData === 'object' && userAnswerData.selectedIndex !== undefined) {
          payload = { selectedIndex: userAnswerData.selectedIndex };
        } else if (typeof userAnswerData === 'object' && typeof userAnswerData.text === 'string') {
          payload = { text: userAnswerData.text };
        }
      } else if (mode === 'notes') {
        // Send user's note text
        if (typeof userAnswerData === 'string') {
          payload = { text: userAnswerData };
        } else if (typeof userAnswerData === 'object' && userAnswerData.text) {
          payload = { text: userAnswerData.text };
        }
      } else {
        // Fallback: try to extract text
        payload = { text: String(userAnswerData) };
      }

      // 4. Call Cloud Function (server computes accuracy from canonical content)
      const result = await window.callSubmitAttempt({
        attemptId: attemptId,
        mode: mode,
        contentId: normalizedContentId,
        payload: payload
      });

      if (result.success) {
        log.debug('[Scoring] ✓ Server scored:', result.xpEarned, 'XP, accuracy:', result.accuracy);

        // Refresh UI if AuthUI is available
        if (window.updatePointsDisplay) {
          window.updatePointsDisplay();
        }
      } else if (result.alreadyRecorded) {
        log.debug('[Scoring] Attempt already recorded (idempotency)');
      } else {
        console.warn('[Scoring] Cloud Function returned error:', result.error);
      }

      if ((result.success || result.alreadyRecorded) && window.currentAttemptContext?.attemptId === attemptId) {
        window.currentAttemptContext = null;
      }

      return result ? { ...result, attemptId } : { attemptId, success: false };
    } catch (e) {
      console.error('[Scoring] Cloud Function call failed:', e);
      return null;
    }
  };

  // Expose globally for other modules (SRS, Writing Challenge)
  window.handleDualTrackScoring = handleDualTrackScoring;

  // Type mode check function
  const performCheckType = (userAnswer, scoreElement) => {
    const totalWords = getCorrectWordCount("type");
    if (!userAnswer.trim()) {
      result.innerHTML = `<span class="errors">Please provide your answer before checking.</span>`;
      scoreElement.textContent = `Points: 0 / ${totalWords}`;
      return;
    }

    const diff = diffWords(userAnswer, correctSentenceType);
    let hasErrors = diff.some((p) => p.type !== "match");
    const { matches: scoreValue, f1: wordAccuracy } = getWordDiffMetrics(diff);

    // Typo Shield: If exactly 1 word is wrong (1 missing + 1 extra), auto-forgive it
    if (hasErrors && window.shopModule && window.shopModule.isSkillUnlocked && window.shopModule.isSkillUnlocked('typo_shield')) {
      const missingCount = diff.filter(p => p.type === 'missing').length;
      const extraCount = diff.filter(p => p.type === 'extra').length;
      if (missingCount === 1 && extraCount === 1 && !window._typoShieldUsedThisQuestion) {
        window._typoShieldUsedThisQuestion = true;
        hasErrors = false;
        // Fire-and-forget skill usage for coin deduction
        useActiveSkillForAttempt('typo_shield', 'type', currentTypeQuestionId).catch(() => { });
      }
    }

    // Smart Difficulty Tracking (Includes Weighted Accuracy/Speed/Hints)
    if (window.typePerformanceTracker) {
      window.currentQuestionAttempts = (window.currentQuestionAttempts || 0) + 1;
      const timeTaken = (Date.now() - (window.questionStartTime || Date.now())) / 1000;
      const assistMeta = getAttemptAssistMeta('type', currentTypeQuestionId);

      const mergedCalibMult = assistMeta.assistCalibMult || 1.0;

      window.typePerformanceTracker.recordAttempt({
        correct: !hasErrors,
        accuracy: wordAccuracy,
        attempts: window.currentQuestionAttempts,
        hintUsed: window.hintUsedForCurrentQuestion || false,
        assistCalibMult: mergedCalibMult,
        assistCount: assistMeta.assistCount,
        timeTaken: timeTaken,
        wordCount: totalWords
      });
    }

    scoreElement.textContent = `Points: ${scoreValue} / ${totalWords}`;

    // Show vocabulary practice for type mode (only missed words)
    renderVocabularyPractice(diff);

    // Hide pronunciation practice and breakdown mode for type mode
    pronunciationPanel.style.display = "none";
    breakdownPanel.style.display = "none";

    // Store diff for sentence generation (Type mode)
    lastDiffType = diff;

    // Show same vocabulary panel and generate panel immediately after check (if there are errors)
    if (hasErrors) {
      renderSameVocabularyType();
    }

    // Show animation panel and result box for Type mode
    if (typeof animationPanel !== 'undefined') animationPanel.style.display = "block";
    if (typeof result !== 'undefined') result.style.display = "block";

    lastSteps = buildAnimationSteps(userAnswer, "type");
    if (!lastSteps || lastSteps.length === 0) {
      result.innerHTML = `<div class="errors">Error: Could not generate animation steps.</div>`;
      return;
    }
    animationBox.innerHTML = "";
    result.innerHTML = `<div class="errors">Playing correction animation...</div>`;

    lastAnimationMode = false; // Type mode
    playAnimation(lastSteps, () => {
      const feedback = hasErrors
        ? `<div class="errors">Keep practicing! Differences highlighted below:</div><div class="result-text">${renderDiff(diff)}</div>`
        : `<div class="ok">Great job! Perfect match.</div>`;

      result.innerHTML = `${feedback}<div class="correct-sentence">Correct sentence: ${correctSentenceType}</div>`;

      // Replay original audio if there are errors (points not max)
      if (hasErrors && scoreValue < totalWords) {
        audio.currentTime = 0;
        audio.play();
      }

      // Trigger Dual Track Scoring (Pass diff pieces for F1 accuracy)
      handleDualTrackScoring('type', currentTypeQuestionId, userAnswer, totalWords);

      // Persist per-question progress (progress bar + dropdown tier)
      recordPracticeAttempt(currentTypeQuestionId, !hasErrors, 'type');

      window.PTEAttemptArchive?.saveTextAttempt?.('type', {
        id: currentTypeQuestionId,
        text: correctSentenceType,
        source: 'write-from-dictation'
      }, userAnswer, {
        score: scoreValue,
        maxScore: totalWords,
        correct: !hasErrors,
        wordAccuracy,
        diff
      }, { scoringSource: 'client' }).catch((error) => log.warn('[PTE Archive] WFD save failed:', error));

      // Vocabulary Book tracking
      if (window.VocabularyBook) {
        const missedWords = getMissedWords(diff);
        const matchedWords = diff.filter(p => p.type === 'match').map(p => p.text);

        // Track missed words immediately when Check is pressed (pass sentence context)
        missedWords.forEach(word => window.VocabularyBook.trackMissedWord(word, 'type', currentTypeQuestionId, correctSentenceType));

        // Track correct words (for mastery tracking)
        matchedWords.forEach(word => window.VocabularyBook.trackCorrectWord(word));

        // Show add to vocabulary modal if there are missed words
        if (missedWords.length > 0) {
          const contentWords = filterContentWords(missedWords);
          if (contentWords.length > 0) {
            window.VocabularyBook.handlePracticeCapture?.({
              mode: 'type',
              questionId: currentTypeQuestionId,
              sentenceText: correctSentenceType,
              missedWords: contentWords,
              correctWords: matchedWords
            });
          }
        }
      }
    }, false);
  };

  // Speak mode check function
  const performCheckSpeak = (userAnswer, scoreElement) => {
    const totalWords = getCorrectWordCount("speak");
    if (!userAnswer.trim()) {
      result.innerHTML = `<span class="errors">Please provide your answer before checking.</span>`;
      scoreElement.textContent = `Points: 0 / ${totalWords}`;
      return;
    }

    const diff = diffWords(userAnswer, correctSentenceSpeak);
    const hasErrors = diff.some((p) => p.type !== "match");
    const { matches: scoreValue, f1: wordAccuracy } = getWordDiffMetrics(diff);

    // Smart Difficulty Tracking (Includes Weighted Accuracy/Speed/Hints)
    if (window.speakPerformanceTracker) {
      window.currentQuestionAttempts = (window.currentQuestionAttempts || 0) + 1;
      const timeTaken = (Date.now() - (window.questionStartTime || Date.now())) / 1000;
      const assistMeta = getAttemptAssistMeta('speak', currentSpeakQuestionId);

      window.speakPerformanceTracker.recordAttempt({
        correct: !hasErrors,
        accuracy: wordAccuracy,
        attempts: window.currentQuestionAttempts,
        hintUsed: window.hintUsedForCurrentQuestion || false,
        assistCalibMult: assistMeta.assistCalibMult,
        assistCount: assistMeta.assistCount,
        timeTaken: timeTaken,
        wordCount: totalWords
      });
    }

    scoreElement.textContent = `Points: ${scoreValue} / ${totalWords}`;

    // Show pronunciation practice and breakdown mode for speak mode
    const missedWords = getMissedWords(diff);
    renderPronunciationPractice(missedWords);
    renderBreakdownMode();

    // Store diff for sentence generation (Speak mode)
    lastDiffSpeak = diff;

    // Show same vocabulary panel after check (if there are errors)
    if (hasErrors) {
      renderSameVocabularySpeak();
    } else {
      sameVocabPanelSpeak.style.display = "none";
    }

    // Show animation panel and result box for Speak mode
    animationPanel.style.display = "block";
    result.style.display = "block";

    lastSteps = buildAnimationSteps(userAnswer, "speak");
    if (!lastSteps || lastSteps.length === 0) {
      result.innerHTML = `<div class="errors">Error: Could not generate animation steps.</div>`;
      return;
    }
    animationBox.innerHTML = "";
    result.innerHTML = `<div class="errors">Playing correction animation...</div>`;

    lastAnimationMode = true; // Speak mode
    playAnimation(lastSteps, () => {
      const feedback = hasErrors
        ? `<div class="errors">Keep practicing! Differences highlighted below:</div><div class="result-text">${renderDiff(diff)}</div>`
        : `<div class="ok">Great job! Perfect match.</div>`;

      result.innerHTML = `${feedback}<div class="correct-sentence">Correct sentence: ${correctSentenceSpeak}</div>`;

      // Replay original audio if there are errors (points not max)
      if (hasErrors && scoreValue < totalWords) {
        audio.currentTime = 0;
        audio.play();
      }

      // Trigger Dual Track Scoring (Pass diff pieces for F1 accuracy)
      handleDualTrackScoring('speak', currentSpeakQuestionId, userAnswer, totalWords);

      // Persist per-question progress (progress bar + dropdown tier)
      recordPracticeAttempt(currentSpeakQuestionId, !hasErrors, 'speak');

      window.PTEAttemptArchive?.saveTextAttempt?.('speak', {
        id: currentSpeakQuestionId,
        text: correctSentenceSpeak,
        source: 'repeat-sentence'
      }, userAnswer, {
        score: scoreValue,
        maxScore: totalWords,
        correct: !hasErrors,
        wordAccuracy,
        diff
      }, { scoringSource: 'client' }).catch((error) => log.warn('[PTE Archive] Repeat Sentence save failed:', error));

      // Vocabulary Book tracking
      if (window.VocabularyBook) {
        const matchedWords = diff.filter(p => p.type === 'match').map(p => p.text);

        // Track missed words immediately when Check is pressed (pass sentence context)
        missedWords.forEach(word => window.VocabularyBook.trackMissedWord(word, 'speak', currentSpeakQuestionId, correctSentenceSpeak));

        // Track correct words (for mastery tracking)
        matchedWords.forEach(word => window.VocabularyBook.trackCorrectWord(word));

        // Show add to vocabulary modal if there are missed words
        if (missedWords.length > 0) {
          const contentWords = filterContentWords(missedWords);
          if (contentWords.length > 0) {
            window.VocabularyBook.handlePracticeCapture?.({
              mode: 'speak',
              questionId: currentSpeakQuestionId,
              sentenceText: correctSentenceSpeak,
              missedWords: contentWords,
              correctWords: matchedWords
            });
          }
        }
      }

      // Second Take: If errors exist and user owns the skill, show a retry overlay
      if (hasErrors && window.shopModule && window.shopModule.isSkillUnlocked && window.shopModule.isSkillUnlocked('second_take')) {
        if (!window._secondTakeUsedThisQuestion) {
          window._secondTakeUsedThisQuestion = true;
          const secondTakeOverlay = document.createElement('div');
          secondTakeOverlay.className = 'second-take-overlay';
          secondTakeOverlay.id = 'second-take-overlay';
          const baseCost = window.SkillCatalog?.getSkill('second_take')?.baseCost || 10;
          secondTakeOverlay.innerHTML = `
            <div class="second-take-card">
              <h3>🎬 Second Take</h3>
              <p>Not your best take? Re-record and we'll keep the better score.</p>
              <button id="second-take-yes" class="modern-btn modern-btn--play">Retry (${baseCost}c)</button>
              <button id="second-take-no" class="modern-btn modern-btn--retry">Skip</button>
            </div>`;
          document.body.appendChild(secondTakeOverlay);

          document.getElementById('second-take-no').addEventListener('click', () => {
            secondTakeOverlay.remove();
          });
          document.getElementById('second-take-yes').addEventListener('click', async () => {
            secondTakeOverlay.remove();
            const skillResult = await useActiveSkillForAttempt('second_take', 'speak', currentSpeakQuestionId);
            if (skillResult?.success) {
              // Reset speak mode to allow re-recording
              if (recordBtn) { recordBtn.style.display = 'inline-block'; recordBtn.textContent = 'Start Recording'; }
              if (retryBtnSpeak) retryBtnSpeak.style.display = 'none';
              if (checkBtnSpeak) checkBtnSpeak.style.display = 'none';
              resetScaffolding();
              if (playBtnSpeak) playBtnSpeak.style.display = 'inline-block';
              window.SpeakingPracticeController?.sync?.('speak');
            }
          });
        }
      }
    }, true);
  };

  let lastDiffType = [];
  let lastDiffSpeak = [];

  // Database loading functions
  const loadDatabase = async (mode) => {
    try {
      const response = await fetch(`/database/${mode}/index.json?v=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`Failed to load ${mode} database: ${response.statusText}`);
      }
      const data = await response.json();
      return data.items || [];
    } catch (error) {
      log.error(`Error loading ${mode} database:`, error);
      // Return default item if database fails to load
      return [{
        id: 1,
        audioFile: "1.mp3",
        correctSentence: "Next time, we'll discuss the influence of the media on public policy.",
        category: "general"
      }];
    }
  };

  const loadQuestion = async (mode, questionId) => {
    const requestId = beginModeLoadRequest(mode);
    const database = mode === "type" ? typeDatabase : speakDatabase;
    const question = database.find(item => item.id === questionId);

    if (!question) {
      log.error(`Question ${questionId} not found in ${mode} database`);
      return false;
    }

    // Apply Smart Difficulty Settings
    if (window.DifficultyManager) {
      const diffSettings = window.DifficultyManager.getCurrentSettings(mode);
      const audioToAdjust = mode === 'type' ? audio : (mode === 'speak' ? audio : null);

      if (diffSettings && audioToAdjust) {
        // Apply playback speed
        audioToAdjust.playbackRate = diffSettings.playbackSpeed || 1.0;

        // Store current settings for hint system and scoring
        if (!window.currentDifficultySettings) window.currentDifficultySettings = {};
        window.currentDifficultySettings[mode] = diffSettings;

        // Update helper text if speed is adjusted
        // (Optional: Add a visual indicator of speed)
      }
    }

    // Determine MIME type based on file extension
    const getAudioMimeType = (filename) => {
      const ext = filename.toLowerCase().split('.').pop();
      const mimeTypes = {
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'm4a': 'audio/mp4',
        'aac': 'audio/aac',
        'ogg': 'audio/ogg',
        'oga': 'audio/ogg'
      };
      return mimeTypes[ext] || 'audio/mpeg';
    };

    // Get base filename (without extension)
    const baseFilename = question.audioFile
      ? question.audioFile.replace(/\.[^.]+$/, '')
      : questionId.toString();

    // Try extensions in order
    const tryExtensions = ['m4a', 'wav', 'mp3', 'aac', 'ogg'];

    // Find starting index - try database extension first
    let startIndex = 0;
    if (question.audioFile) {
      const currentExt = question.audioFile.toLowerCase().split('.').pop();
      const extIndex = tryExtensions.indexOf(currentExt);
      if (extIndex !== -1) {
        startIndex = extIndex;
      }
    }

    // Try to find the file by checking each extension
    let foundFile = null;

    // Check starting from database extension, then wrap around
    for (let i = 0; i < tryExtensions.length; i++) {
      const checkIndex = (startIndex + i) % tryExtensions.length;
      const ext = tryExtensions[checkIndex];
      const testFile = `${baseFilename}.${ext}`;
      const testPath = `database/${mode}/audio/${testFile}`;

      log.debug(`[loadQuestion] Checking if file exists (attempt ${i + 1}/${tryExtensions.length}): ${testPath}`);
      const exists = await checkFileExists(testPath);
      if (isStaleModeLoadRequest(mode, requestId)) {
        return false;
      }

      if (exists) {
        foundFile = testFile;
        log.debug(`[loadQuestion] Found file: ${foundFile} (database said: ${question.audioFile})`);
        break;
      }
    }

    if (!foundFile) {
      log.warn(`[loadQuestion] No audio file found for question ${questionId}. Tried all extensions.`);
      // Still try to load with database filename as fallback
      foundFile = question.audioFile || `${baseFilename}.mp3`;
    }

    if (isStaleModeLoadRequest(mode, requestId)) {
      return false;
    }

    if (mode === "type") {
      correctSentenceType = question.correctSentence;
    } else {
      correctSentenceSpeak = question.correctSentence;
    }

    const audioPath = `database/${mode}/audio/${foundFile}?t=${Date.now()}`;
    const mimeType = getAudioMimeType(foundFile);

    // Clear any existing source elements
    while (audio.firstChild) {
      audio.removeChild(audio.firstChild);
    }

    // Create source element with proper type
    const source = document.createElement('source');
    source.src = audioPath;
    source.type = mimeType;
    audio.appendChild(source);

    audio.load(); // Reload the audio element

    // TRIGGER HINTS IMMEDIATELY ON LOAD
    if (typeof showLetterHints === 'function') {
      if (mode === 'type') {
        showLetterHints(correctSentenceType, 'type');
      } else if (mode === 'speak') {
        showLetterHints(correctSentenceSpeak, 'speak');
      }
    }

    // Clear input/transcription
    if (mode === "type") {
      input.value = "";
      currentTypeQuestionId = questionId;
      currentQuestionIdType.textContent = questionId;
    } else {
      transcription = "";
      transcriptionText.textContent = "Click 'Start Recording' and speak...";
      transcriptionText.classList.add("empty");
      currentSpeakQuestionId = questionId;
      currentQuestionIdSpeak.textContent = questionId;
    }

    if (window.PracticeRouter && questionId != null) {
      window.PracticeRouter.replaceRoute(mode, questionId);
    }

    startAttemptContext(mode, questionId);
    window.questionStartTime = null;
    window.currentQuestionAttempts = 0;
    window.hintUsedForCurrentQuestion = false;

    // Reset UI state to initial
    if (mode === "type") {
      if (checkBtn) checkBtn.style.display = "none";
      if (retryBtn) retryBtn.style.display = "none";
      if (input) input.disabled = true;
      if (playBtn) playBtn.style.display = "none"; // Hidden — new wfd-audio player replaces it
    } else {
      if (checkBtnSpeak) checkBtnSpeak.style.display = "none";
      if (retryBtnSpeak) retryBtnSpeak.style.display = "none";
      if (recordBtn) recordBtn.style.display = "inline-block";
      if (playBtnSpeak) playBtnSpeak.style.display = "inline-block"; // Reset Play button
    }

    // Reset scores and hide panels
    resetScaffolding();

    // Reset scaffolding state (replay counters, auto-hints)
    resetScaffoldingState(mode);

    // Sync SpeakingPracticeController to immediately reflect reset UI state (e.g. 3-step indicator reset to Step 1)
    window.SpeakingPracticeController?.sync?.(mode);

    // Load mastery status for this question (logged-in users only)
    // Pass the mode so mastery status is shown for the correct mode
    await loadMasteryStatus(questionId, mode);

    window.SpeakingPracticeController?.sync?.(mode);

    return true;
  };

  const ensureRecommendationEngine = () => {
    if (questionRecommendationEngine) return questionRecommendationEngine;
    const factory = window.QuestionRecommendationEngine?.createQuestionRecommendationEngine;
    if (typeof factory !== 'function') return null;
    questionRecommendationEngine = factory({ recentWindowSize: 10 });
    return questionRecommendationEngine;
  };

  const getRecommendationElements = (mode) => {
    if (mode === 'type') {
      return {
        container: recommendationControlsType,
        button: recommendedBtnType,
        summary: recommendationSummaryType
      };
    }
    if (mode === 'speak') {
      return {
        container: recommendationControlsSpeak,
        button: recommendedBtnSpeak,
        summary: recommendationSummarySpeak
      };
    }
    if (mode === 'extended') {
      return {
        container: recommendationControlsExtended,
        button: recommendedBtnExtended,
        summary: recommendationSummaryExtended
      };
    }
    return { container: null, button: null, summary: null };
  };

  const getQuestionSelectForMode = (mode) => {
    if (mode === 'type') return questionSelectType;
    if (mode === 'speak') return questionSelectSpeak;
    if (mode === 'extended') return questionSelectExtended;
    return null;
  };

  const getCurrentQuestionIdForMode = (mode) => {
    if (mode === 'type') return currentTypeQuestionId;
    if (mode === 'speak') return currentSpeakQuestionId;
    if (mode === 'extended') return currentExtendedQuestionId;
    return null;
  };

  const getDatabaseForMode = (mode) => {
    if (mode === 'type') return typeDatabase;
    if (mode === 'speak') return speakDatabase;
    if (mode === 'extended') return extendedDatabase;
    return [];
  };

  const getVisibleQuestionIds = (mode) => {
    const select = getQuestionSelectForMode(mode);
    if (!select) return [];
    return Array.from(select.options)
      .map((option) => Number.parseInt(option.value, 10))
      .filter((id) => Number.isFinite(id));
  };

  const rememberRecommendedQuestion = (mode, questionId) => {
    const numericId = Number.parseInt(String(questionId), 10);
    if (!Number.isFinite(numericId)) return;
    const recent = recommendationRecentByMode[mode] || [];
    const deduped = recent.filter((id) => id !== numericId);
    deduped.push(numericId);
    recommendationRecentByMode[mode] = deduped.slice(-10);
  };

  const getCefrLevelForRecommendation = (mode) => {
    if (!window.DifficultyManager || typeof window.DifficultyManager.getCurrentSettings !== 'function') {
      return 1;
    }
    const settings = window.DifficultyManager.getCurrentSettings(mode);
    return Number(settings?.level) || 1;
  };

  const rebuildRecommendationIndex = (mode) => {
    const engine = ensureRecommendationEngine();
    if (!engine) return null;
    recommendationIndexByMode[mode] = engine.buildIndex(mode, getDatabaseForMode(mode));
    return recommendationIndexByMode[mode];
  };

  const getRecommendationLabel = (reasonCode) => RECOMMENDATION_REASON_LABELS[reasonCode] || 'best available match';

  const computeRecommendation = (mode) => {
    const engine = ensureRecommendationEngine();
    if (!engine) return null;

    const visibleQuestionIds = getVisibleQuestionIds(mode);
    if (visibleQuestionIds.length === 0) return null;

    const currentQuestionId = getCurrentQuestionIdForMode(mode);
    if (!Number.isFinite(Number(currentQuestionId))) return null;

    const index = recommendationIndexByMode[mode] || rebuildRecommendationIndex(mode);
    if (!index) return null;

    return engine.recommendNext({
      mode,
      currentQuestionId,
      currentCefrLevel: getCefrLevelForRecommendation(mode),
      visibleQuestionIds,
      recentQuestionIds: recommendationRecentByMode[mode] || [],
      index
    });
  };

  const renderRecommendationState = (mode, recommendation) => {
    const { button, summary } = getRecommendationElements(mode);
    if (!button || !summary) return;

    const currentQuestionId = Number(getCurrentQuestionIdForMode(mode));
    const nextQuestionId = Number(recommendation?.nextQuestionId);

    if (!recommendation || !Number.isFinite(nextQuestionId) || nextQuestionId === currentQuestionId) {
      button.disabled = true;
      summary.textContent = 'No better match in current filters';
      summary.classList.remove('is-hidden');
      return;
    }

    button.disabled = false;
    summary.textContent = `Recommended next: #${nextQuestionId} - ${getRecommendationLabel(recommendation.reasonCode)}`;
    summary.classList.remove('is-hidden');
  };

  const refreshRecommendationUI = (mode) => {
    const { container, button, summary } = getRecommendationElements(mode);
    if (!container || !button || !summary) return;

    const isAdaptive = !!window.DifficultyManager?.globalSettings?.autoAdjustEnabled;
    if (isAdaptive) {
      container.style.display = 'none';
      button.disabled = true;
      summary.classList.add('is-hidden');
      return;
    }

    container.style.display = 'flex';
    const recommendation = computeRecommendation(mode);
    renderRecommendationState(mode, recommendation);
  };

  const applyRecommendedQuestion = (mode) => {
    const recommendation = computeRecommendation(mode);
    if (!recommendation) {
      refreshRecommendationUI(mode);
      return;
    }

    const targetQuestionId = Number.parseInt(String(recommendation.nextQuestionId), 10);
    const currentQuestionId = Number(getCurrentQuestionIdForMode(mode));
    if (!Number.isFinite(targetQuestionId) || targetQuestionId === currentQuestionId) {
      refreshRecommendationUI(mode);
      return;
    }

    const select = getQuestionSelectForMode(mode);
    if (!select) return;

    const existsInVisiblePool = Array.from(select.options).some((option) => Number.parseInt(option.value, 10) === targetQuestionId);
    if (!existsInVisiblePool) {
      refreshRecommendationUI(mode);
      return;
    }

    rememberRecommendedQuestion(mode, targetQuestionId);
    select.value = String(targetQuestionId);
    select.dispatchEvent(new Event('change'));
    requestAnimationFrame(() => refreshRecommendationUI(mode));
  };

  const initRecommendationButtons = () => {
    if (recommendedBtnType) {
      recommendedBtnType.addEventListener('click', () => applyRecommendedQuestion('type'));
    }
    if (recommendedBtnSpeak) {
      recommendedBtnSpeak.addEventListener('click', () => applyRecommendedQuestion('speak'));
    }
    if (recommendedBtnExtended) {
      recommendedBtnExtended.addEventListener('click', () => applyRecommendedQuestion('extended'));
    }
  };

  /**
   * Populate the question select dropdown for a mode
   * Shows tier status indicators and filters based on multi-select tier filter
   * 
   * How progress data is merged:
   * - Reads from progressCache[mode] to get tier for each question
   * - Adds tier indicators (✓/✓✓/★) and applies tier class to options
   * 
   * How filtering works:
   * - Checks the tier filter checkboxes state for the current mode
   * - Each tier (completed, consolidated, mastered, none) can be shown/hidden
   * - Currently selected question is always shown, even if it would be filtered
   * 
   * @param {string} mode - 'type', 'speak', or 'extended'
   */
  const populateQuestionSelect = (mode) => {
    if (mode === "extended") {
      const database = extendedDatabase;
      const select = questionSelectExtended;
      const currentIdDisplay = currentQuestionIdExtended;
      const totalDisplay = totalQuestionsExtended;
      const currentId = currentExtendedQuestionId;

      // Difficulty Filter (Fill mode)
      const difficultyContainer = document.getElementById('difficulty-filter-container-extended');
      const difficultyMenu = document.getElementById('difficulty-filter-menu-extended');
      const selectedDifficultyOption = difficultyMenu?.querySelector('.filter-option.selected');
      const difficultyValue = selectedDifficultyOption?.dataset.value || 'all';

      let difficultyLevel = null;
      const isAdaptiveMode = !!window.DifficultyManager?.getGlobalSettings?.()?.autoAdjustEnabled;

      if (isAdaptiveMode) {
        if (difficultyValue !== 'all') {
          difficultyLevel = parseInt(difficultyValue, 10);
        } else if (!window.DifficultyManager.isCalibrated("extended")) {
          // Uncalibrated: Do not filter by difficulty so the user can choose or see a mix to calibrate naturally.
          difficultyLevel = null;
        } else {
          // Calibrated: Use the mapped content tier
          difficultyLevel = window.DifficultyManager.getContentTier?.("extended") ?? null;
        }
      } else {
        difficultyLevel = difficultyValue !== 'all' ? parseInt(difficultyValue, 10) : null;
      }

      const isDifficultyFilterActive = difficultyContainer && difficultyContainer.style.display !== 'none' && difficultyLevel !== null;

      select.innerHTML = "";
      let visibleCount = 0;
      database.forEach(item => {
        if (isDifficultyFilterActive && item.level !== difficultyLevel) return;

        visibleCount++;
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.id.toString();
        select.appendChild(option);
      });

      currentIdDisplay.textContent = currentId;
      totalDisplay.textContent = difficultyLevel !== null ? `${visibleCount} (${database.length} total)` : database.length;

      const currentExists = Array.from(select.options).some(opt => opt.value == currentId);
      if (currentExists) {
        select.value = currentId;
      } else if (select.options.length > 0) {
        const firstValue = parseInt(select.options[0].value, 10);
        select.value = firstValue;
        currentExtendedQuestionId = firstValue;
        currentQuestionIdExtended.textContent = firstValue;
        if (extendedQuestionLoaded) {
          loadExtendedQuestion(firstValue);
        }
      } else {
        log.debug('[populateQuestionSelect] No Fill questions match current difficulty filter');
      }

      refreshRecommendationUI('extended');
    } else {
      const database = mode === "type" ? typeDatabase : speakDatabase;
      const select = mode === "type" ? questionSelectType : questionSelectSpeak;
      const currentIdDisplay = mode === "type" ? currentQuestionIdType : currentQuestionIdSpeak;
      const totalDisplay = mode === "type" ? totalQuestionsType : totalQuestionsSpeak;

      // Get current selected question ID (to ensure it's always shown even if filtered)
      const currentId = mode === "type" ? currentTypeQuestionId : currentSpeakQuestionId;

      // Get state filter from new div-based options (check for .selected class)
      const statusMenu = document.getElementById(`status-filter-menu-${mode}`);
      const filterNotStarted = statusMenu?.querySelector('.filter-option[data-value="not-started"]')?.classList.contains('selected') ?? true;
      const filterInProgress = statusMenu?.querySelector('.filter-option[data-value="in-progress"]')?.classList.contains('selected') ?? true;
      const filterCompleted = statusMenu?.querySelector('.filter-option[data-value="completed"]')?.classList.contains('selected') ?? true;
      const filterConsolidated = statusMenu?.querySelector('.filter-option[data-value="consolidated"]')?.classList.contains('selected') ?? true;
      const filterMastered = statusMenu?.querySelector('.filter-option[data-value="mastered"]')?.classList.contains('selected') ?? true;

      // Get Sentence Length Filter (Type and Speak modes)
      let validLengthIds = null;
      const lengthContainer = document.getElementById(`length-filter-container-${mode}`);
      const lengthMenu = document.getElementById(`length-filter-menu-${mode}`);
      // Read from div-based options
      const selectedOption = lengthMenu?.querySelector('.filter-option.selected');
      const lengthValue = selectedOption?.dataset.value || 'all';
      // Apply filter only if visible (unlocked) and not "all"
      if (lengthContainer && lengthContainer.style.display !== 'none' && lengthValue !== 'all') {
        validLengthIds = getIdsForLengthRange(lengthValue, mode);
      }

      // Get Difficulty Filter (Type and Speak modes)
      const difficultyContainer = document.getElementById(`difficulty-filter-container-${mode}`);
      const difficultyMenu = document.getElementById(`difficulty-filter-menu-${mode}`);
      const selectedDifficultyOption = difficultyMenu?.querySelector('.filter-option.selected');
      const difficultyValue = selectedDifficultyOption?.dataset.value || 'all';

      let difficultyLevel = null;
      const isAdaptiveMode = !!window.DifficultyManager?.getGlobalSettings?.()?.autoAdjustEnabled;

      if (isAdaptiveMode) {
        if (difficultyValue !== 'all') {
          difficultyLevel = parseInt(difficultyValue, 10);
        } else if (!window.DifficultyManager.isCalibrated(mode)) {
          // Uncalibrated: Do not filter by difficulty so the user can see all options and calibrate smoothly.
          difficultyLevel = null;
        } else {
          // Calibrated: Use the mapped content tier
          difficultyLevel = window.DifficultyManager.getContentTier?.(mode) ?? null;
        }
      } else {
        difficultyLevel = difficultyValue !== 'all' ? parseInt(difficultyValue, 10) : null;
      }

      // Get progress cache for this mode
      const modeProgressCache = progressCache[mode] || {};

      select.innerHTML = "";
      let visibleCount = 0;
      let firstVisibleId = null;

      // Filter and render questions based on filters
      database.forEach(item => {
        const questionId = item.id;
        const progress = modeProgressCache[questionId] || { perfectCount: 0, hasAttempted: false };
        const hasAttempted = progress.hasAttempted || false;
        const perfectCount = progress.perfectCount || 0;
        const state = calculateState(hasAttempted, perfectCount);

        // 1. Status Filter
        let matchesStatus = false;
        if (state === 'not-started' && filterNotStarted) matchesStatus = true;
        else if (state === 'in-progress' && filterInProgress) matchesStatus = true;
        else if (state === 'completed' && filterCompleted) matchesStatus = true;
        else if (state === 'consolidated' && filterConsolidated) matchesStatus = true;
        else if (state === 'mastered' && filterMastered) matchesStatus = true;

        if (!matchesStatus) return;

        // 2. Length Filter
        const isLengthFilterActive = lengthContainer && lengthContainer.style.display !== 'none' && lengthValue !== 'all';
        if (isLengthFilterActive) {
          if (validLengthIds === null || !validLengthIds.has(questionId)) {
            return;
          }
        }

        // 3. Difficulty Filter
        const isDifficultyFilterActive = difficultyContainer && difficultyContainer.style.display !== 'none' && difficultyLevel !== null;
        if (isDifficultyFilterActive) {
          if (item.level !== difficultyLevel) {
            return;
          }
        }

        // If we reach here, it matches all active filters
        visibleCount++;
        if (firstVisibleId === null) firstVisibleId = questionId;

        // Create option element
        const option = document.createElement("option");
        option.value = questionId;

        // Add state indicator
        const stateIndicators = {
          'not-started': '',
          'in-progress': ' ◐ (In Progress)',
          'completed': ' ✓ (Completed)',
          'consolidated': ' ✓✓ (Consolidated)',
          'mastered': ' ★ (Mastered)'
        };

        option.textContent = `${questionId}${stateIndicators[state] || ''}`;
        option.classList.add(`state-${state}`);

        select.appendChild(option);
      });

      // Update display
      currentIdDisplay.textContent = currentId;
      const hasFilters = !filterNotStarted || !filterInProgress || !filterCompleted || !filterConsolidated || !filterMastered || (validLengthIds !== null) || (difficultyLevel !== null);
      if (totalDisplay) {
        totalDisplay.textContent = hasFilters ? `${visibleCount} (${database.length} total)` : database.length;
      }

      // Handle selection change if current question is filtered out
      const currentExists = Array.from(select.options).some(opt => opt.value == currentId);

      if (currentExists) {
        select.value = currentId;
      } else if (select.options.length > 0) {
        // Current question filtered out - select first available
        const firstValue = parseInt(select.options[0].value, 10);
        select.value = firstValue;

        // Update the active question global state and UI
        if (mode === 'type') {
          currentTypeQuestionId = firstValue;
          loadQuestion('type', firstValue);
        } else {
          currentSpeakQuestionId = firstValue;
          loadQuestion('speak', firstValue);
        }
      } else {
        // No results match filters - show "No results" or similar?
        // For now, keep current state but maybe warn user
        log.debug(`[populateQuestionSelect] No items match current filters for ${mode} mode`);
      }

      refreshRecommendationUI(mode);
    }
  };

  // Initialize databases
  const initializeDatabases = async () => {
    typeDatabase = await loadDatabase("type");
    speakDatabase = await loadDatabase("speak");
    extendedDatabase = await loadDatabase("extended");
    rebuildRecommendationIndex('type');
    rebuildRecommendationIndex('speak');
    rebuildRecommendationIndex('extended');

    // Load progress data for Type and Speak modes (cached for dropdown rendering)
    await loadAllProgressForMode("type");
    await loadAllProgressForMode("speak");

    // Populate selectors (will use progress cache to show tier indicators)
    populateQuestionSelect("type");
    populateQuestionSelect("speak");
    populateQuestionSelect("extended");

    // Load first question for each mode
    // Load Speak first (since Type tab is active by default, Type should load last to set the correct audio)
    if (speakDatabase.length > 0) {
      currentSpeakQuestionId = 1;
      await loadQuestion("speak", 1);
    }
    if (typeDatabase.length > 0) {
      currentTypeQuestionId = 1;
      await loadQuestion("type", 1);
    }
    // Extended mode: Don't load on init - will be lazy-loaded when Fill tab is clicked
    // This prevents the countdown timer from starting immediately on page load

    // Update progress bar for initial question
    const typeProgress = progressCache.type?.[1] || { perfectCount: 0, tier: 'none' };
    updateProgressBarUI(1, 'type', typeProgress);

    // Update left panel for Type mode (default active tab)
    await updateProgressPanel('type');
    refreshRecommendationUI('type');
    refreshRecommendationUI('speak');
    refreshRecommendationUI('extended');

    // Signal the 2D preloader that the app is ready
    // The preloader will wait its minimum duration (3s) before dismissing
    if (typeof window.finishBelPreloader === 'function') {
      window.finishBelPreloader();
    }
  };

  // Question selector event listeners
  questionSelectType.addEventListener("change", async (e) => {
    const questionId = parseInt(e.target.value, 10);
    if (questionId && await loadQuestion("type", questionId)) {
      currentTypeQuestionId = questionId;
      currentQuestionIdType.textContent = questionId;
    }
    refreshRecommendationUI('type');
  });

  questionSelectSpeak.addEventListener("change", async (e) => {
    const questionId = parseInt(e.target.value, 10);
    if (questionId && await loadQuestion("speak", questionId)) {
      currentSpeakQuestionId = questionId;
      currentQuestionIdSpeak.textContent = questionId;
    }
    refreshRecommendationUI('speak');
  });

  // ============================================
  // Back/Next Navigation Buttons
  // ============================================

  // Stop all audio and animations when navigating
  const stopAllAudioAndAnimations = () => {
    // Stop main audio
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    // Stop extended listening audio
    const audioExtended = document.getElementById("audio-extended");
    if (audioExtended) {
      audioExtended.pause();
      audioExtended.currentTime = 0;
    }

    // Stop phrases audio
    const audioPhrases = document.getElementById("audio-phrases");
    if (audioPhrases) {
      audioPhrases.pause();
      audioPhrases.currentTime = 0;
    }

    // Stop any TTS/Speech synthesis
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Stop/hide animations
    if (animationBox) {
      animationBox.innerHTML = '';
    }
    if (animationPanel) {
      animationPanel.style.display = 'none';
    }

    // Cancel any scheduled audio playback (use a global flag)
    window._navigationTriggered = true;
    setTimeout(() => { window._navigationTriggered = false; }, 100);
  };

  // Navigate to next/previous question in filtered dropdown
  const navigateQuestion = (mode, direction) => {
    const selectId = mode === 'extended' ? 'question-select-extended' : `question-select-${mode}`;
    const select = document.getElementById(selectId);
    if (!select) return;

    // Get all available options (filtered list)
    const options = Array.from(select.options);
    if (options.length === 0) return;

    const currentValue = parseInt(select.value, 10);
    const currentIndex = options.findIndex(opt => parseInt(opt.value, 10) === currentValue);

    let newIndex;
    if (direction === 'next') {
      newIndex = currentIndex + 1;
      if (newIndex >= options.length) {
        newIndex = 0; // Wrap to first
      }
    } else {
      newIndex = currentIndex - 1;
      if (newIndex < 0) {
        newIndex = options.length - 1; // Wrap to last
      }
    }

    const newValue = parseInt(options[newIndex].value, 10);
    select.value = newValue;
    select.dispatchEvent(new Event('change'));
  };

  // Type mode navigation
  const backBtnType = document.getElementById("back-btn-type");
  const nextBtnType = document.getElementById("next-btn-type");

  if (backBtnType) {
    backBtnType.addEventListener("click", () => {
      stopAllAudioAndAnimations();
      navigateQuestion('type', 'back');
    });
  }

  if (nextBtnType) {
    nextBtnType.addEventListener("click", () => {
      stopAllAudioAndAnimations();
      navigateQuestion('type', 'next');
    });
  }

  // Speak mode navigation
  const backBtnSpeak = document.getElementById("back-btn-speak");
  const nextBtnSpeak = document.getElementById("next-btn-speak");

  if (backBtnSpeak) {
    backBtnSpeak.addEventListener("click", () => {
      stopAllAudioAndAnimations();
      navigateQuestion('speak', 'back');
    });
  }

  if (nextBtnSpeak) {
    nextBtnSpeak.addEventListener("click", () => {
      stopAllAudioAndAnimations();
      navigateQuestion('speak', 'next');
    });
  }

  // Fill/Extended mode navigation
  const backBtnExtended = document.getElementById("back-btn-extended");
  const nextBtnExtended = document.getElementById("next-btn-extended");

  if (backBtnExtended) {
    backBtnExtended.addEventListener("click", () => {
      stopAllAudioAndAnimations();
      navigateQuestion('extended', 'back');
    });
  }

  if (nextBtnExtended) {
    nextBtnExtended.addEventListener("click", () => {
      stopAllAudioAndAnimations();
      navigateQuestion('extended', 'next');
    });
  }

  // Tier filter dropdown event listeners
  const setupTierFilterDropdown = (mode) => {
    const filterBtn = document.getElementById(`tier-filter-btn-${mode}`);
    const filterMenu = document.getElementById(`tier-filter-menu-${mode}`);
    const filterDropdown = filterBtn?.closest('.tier-filter-dropdown');

    if (!filterBtn || !filterMenu) return;

    // Toggle dropdown visibility
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = filterMenu.style.display !== 'none';
      filterMenu.style.display = isOpen ? 'none' : 'block';
      filterDropdown?.classList.toggle('open', !isOpen);
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!filterDropdown?.contains(e.target)) {
        filterMenu.style.display = 'none';
        filterDropdown?.classList.remove('open');
      }
    });

    // Update dropdown when filter checkboxes change
    ['not-started', 'in-progress', 'completed', 'consolidated', 'mastered'].forEach(state => {
      const checkbox = document.getElementById(`filter-${state}-${mode}`);
      if (checkbox) {
        checkbox.addEventListener('change', () => {
          populateQuestionSelect(mode);
        });
      }
    });
  };

  setupTierFilterDropdown('type');
  setupTierFilterDropdown('speak');

  // Progress panel toggle event listeners
  const progressPanelToggle = document.getElementById('progress-panel-toggle');
  const progressPanelCloseBtn = document.getElementById('progress-panel-close-btn');
  const progressPanelSide = document.getElementById('progress-panel-side');
  const progressPanelOverlay = document.getElementById('progress-panel-overlay');

  /**
   * Open the progress panel
   */
  function openProgressPanel() {
    if (window.PTEAttemptArchive?.openProgressModal) {
      window.PTEAttemptArchive.openProgressModal('vocab-progress');
    } else if (progressPanelSide) {
      progressPanelSide.classList.add('expanded');
      if (progressPanelOverlay) {
        progressPanelOverlay.classList.add('active');
      }
    }
  }

  /**
   * Close the progress panel
   */
  function closeProgressPanel() {
    if (window.PTEAttemptArchive?.closeProgressModal) {
      window.PTEAttemptArchive.closeProgressModal();
    } else if (progressPanelSide) {
      progressPanelSide.classList.remove('expanded');
      if (progressPanelOverlay) {
        progressPanelOverlay.classList.remove('active');
      }
    }
  }

  // Toggle button opens/closes panel
  if (progressPanelToggle) {
    progressPanelToggle.addEventListener('click', () => {
      const isExpanded = progressPanelSide?.classList.contains('expanded');
      if (isExpanded) {
        closeProgressPanel();
      } else {
        openProgressPanel();
      }
    });
  }

  // Close button closes panel
  if (progressPanelCloseBtn) {
    progressPanelCloseBtn.addEventListener('click', closeProgressPanel);
  }

  // Clicking overlay closes panel
  if (progressPanelOverlay) {
    progressPanelOverlay.addEventListener('click', closeProgressPanel);
  }

  // Reset progress button event listeners
  const setupResetProgressBtn = (mode) => {
    const resetBtn = document.getElementById(`reset-progress-${mode}-btn`);
    if (!resetBtn) return;

    resetBtn.addEventListener('click', async () => {
      const questionId = mode === 'type' ? currentTypeQuestionId : currentSpeakQuestionId;

      const confirmed = await window.showCustomConfirm(
        'Reset Progress?',
        `Reset progress for Question ${questionId} in ${mode === 'type' ? 'Type' : 'Speak'} mode?`,
        true
      );
      if (!confirmed) {
        return;
      }

      const userId = window.authUI?.getCurrentUserId?.();
      if (!userId) {
        alert('Must be logged in to reset progress');
        return;
      }

      try {
        const result = await window.firebaseFirestoreFunctions.resetProgress(userId, questionId, mode);
        if (result.success) {
          // Update cache and UI
          updateProgressCache(questionId, mode, { perfectCount: 0, tier: 'none', lastCompletedAt: null });
          log.debug(`✓ Progress reset for question ${questionId} in ${mode} mode`);
        } else {
          alert('Error resetting progress: ' + (result.error || 'Unknown error'));
        }
      } catch (error) {
        log.error('Error resetting progress:', error);
        alert('Error resetting progress');
      }
    });
  };

  setupResetProgressBtn('type');
  setupResetProgressBtn('speak');

  // Initialize on page load
  initRecommendationButtons();
  initializeDatabases();

  // ============================================
  // AUTH STATE CHANGE LISTENER
  // ============================================
  // When user logs in or out, we need to reload progress data
  // This ensures the progress UI updates immediately without
  // requiring the user to change questions or reload the page.
  // 
  // This callback is triggered by auth-ui.js when:
  // - User transitions from guest → logged-in
  // - User logs in fresh
  // - User logs out
  /**
   * Handle auth state changes and reload progress UI
   * 
   * @param {string} eventType - 'login' or 'logout'
   * @param {string|null} userId - User ID (null on logout)
   */
  async function handleAuthStateChange(eventType, userId) {
    log.debug(`✓ Progress UI: Handling auth state change - ${eventType}`);

    if (eventType === 'login' && userId) {
      // ============================================
      // RELOAD PROGRESS DATA AFTER LOGIN
      // ============================================
      // User just logged in - reload all progress data for current mode
      // This updates: progress bar, question status label, filter dropdown,
      // and progress side panel immediately.

      // Determine current mode based on active tab
      const isTypeActive = document.getElementById('tab-type')?.classList.contains('active');
      const isSpeakActive = document.getElementById('tab-speak')?.classList.contains('active');
      const currentMode = isTypeActive ? 'type' : (isSpeakActive ? 'speak' : 'type');
      const currentQuestionId = currentMode === 'type' ? currentTypeQuestionId : currentSpeakQuestionId;

      log.debug(`✓ Progress UI: Reloading progress for ${currentMode} mode, question ${currentQuestionId}`);

      // 1. Reload all progress data for current mode (for dropdown/filter)
      await loadAllProgressForMode(currentMode);

      // 2. Reload progress status for current question (for progress bar)
      await loadProgressStatus(currentQuestionId, currentMode);

      // 3. Re-render the question dropdown with updated progress indicators
      populateQuestionSelect(currentMode);

      // 4. Update the progress side panel
      await updateProgressPanel(currentMode);

      // 5. Check Sentence Length Filter Unlock Status
      if (window.checkFilterUnlockStatus) {
        window.checkFilterUnlockStatus(userId);
      }

      ['type', 'speak', 'extended', 'notes', 'rop'].forEach((mode) => {
        window.DifficultyFilter?.reloadSavedDifficulty?.(mode);
      });
      window.DifficultyFilter?.updateFilterVisibility?.();

      log.debug('✓ Progress UI: Reload complete after login');
    } else if (eventType === 'logout') {
      // ============================================
      // CLEAR PROGRESS UI AFTER LOGOUT
      // ============================================
      // User logged out - clear progress cache and hide progress UI elements

      // Clear progress cache
      progressCache.type = {};
      progressCache.speak = {};

      // Hide progress bars
      const progressBarType = document.getElementById('progress-bar-type');
      const progressBarSpeak = document.getElementById('progress-bar-speak');
      if (progressBarType) progressBarType.style.display = 'none';
      if (progressBarSpeak) progressBarSpeak.style.display = 'none';

      // Re-render dropdowns without progress indicators
      populateQuestionSelect('type');
      populateQuestionSelect('speak');

      // Update progress panel to show guest notice
      await updateProgressPanel('type');

      // Clear cached profile and hide account-only filters
      window.currentUserProfile = null;

      ['type', 'speak'].forEach((mode) => {
        const container = document.getElementById(`length-filter-container-${mode}`);
        if (container) container.style.display = 'none';
      });
      ['type', 'speak', 'extended', 'notes', 'rop'].forEach((mode) => {
        window.DifficultyFilter?.reloadSavedDifficulty?.(mode);
      });
      window.DifficultyFilter?.updateFilterVisibility?.();

      log.debug('✓ Progress UI: Cleared after logout');
    }

    updateActiveSkillControlLocks();
  }

  // Register the callback with auth-ui.js
  // This will be called whenever auth state changes
  const registerAuthCallback = () => {
    if (window.authUI && typeof window.authUI.onAuthStateChange === 'function') {
      window.authUI.onAuthStateChange(handleAuthStateChange);
      log.debug('✓ Progress UI: Auth state callback registered');
    } else {
      // Retry if auth-ui.js isn't ready yet
      setTimeout(registerAuthCallback, 100);
    }
  };
  registerAuthCallback();

  // Type mode
  playBtn.addEventListener("click", () => {
    // ============================================
    // REPLAY LIMIT CHECK (Smart Difficulty)
    // ============================================
    const isDifficultyActive = !!(window.DifficultyManager && typeof window.DifficultyManager.getCurrentSettings === 'function');

    if (isDifficultyActive) {
      const settings = window.DifficultyManager.getCurrentSettings('type');
      const maxReplays = settings.maxReplays || 5;

      // Increment replay counter
      window.typeReplayCount = (window.typeReplayCount || 0) + 1;

      const timesLeft = Math.max(0, maxReplays - window.typeReplayCount);

      // Update replay counter UI
      const replayBadge = document.getElementById('replay-counter-type');
      if (replayBadge) {
        replayBadge.textContent = `🔊 ${timesLeft} times left`;
        replayBadge.style.display = 'inline-block'; // Show it

        if (timesLeft === 0) {
          replayBadge.classList.add('limit-reached');
          if (playBtn) playBtn.style.display = 'none';
          const wfdBtn = document.getElementById('wfd-play-btn');
          if (wfdBtn) wfdBtn.disabled = true;
        }
      }
    }

    // Start timing from the first meaningful action (Play), not question load.
    if (!window.questionStartTime) {
      window.questionStartTime = Date.now();
    }

    // New flow: Enable input and show check button
    if (input) {
      input.disabled = false;
      input.focus();
    }
    if (checkBtn) checkBtn.style.display = "inline-block";
    if (retryBtn) retryBtn.style.display = "none";

    // ============================================
    // Hint System progression-aware + Baseline Scaffolding
    // ============================================
    const hintControlsEl = document.getElementById('hint-controls');

    if (hintControlsEl) {
      hintControlsEl.style.display = 'block';
    }

    if (window.HintSystem) {
      window.HintSystem.resetForNewQuestion(currentTypeQuestionId, 'type');
      renderTypeHintState();
    }

    if (window.isChunkingActive && window.correctSentenceType) {
      audio.pause();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      const chunks = window.correctSentenceType.split(/([.,!?;]+)/).filter(c => c.trim().length > 0);
      let i = 0;
      const playNextChunk = () => {
        if (i >= chunks.length) return;
        const textToSpeak = chunks[i] + (chunks[i + 1] && /^[.,!?;]+$/.test(chunks[i + 1]) ? chunks[i + 1] : '');
        if (chunks[i + 1] && /^[.,!?;]+$/.test(chunks[i + 1])) i += 2;
        else i++;

        if (!textToSpeak.trim() && i < chunks.length) {
          playNextChunk();
          return;
        }

        const uttr = new SpeechSynthesisUtterance(textToSpeak);
        uttr.rate = audio.playbackRate || 1.0;
        uttr.onend = () => {
          setTimeout(playNextChunk, 800);
        };
        window.speechSynthesis.speak(uttr);
      };
      playNextChunk();
      return;
    }

    audio.currentTime = 0;
    audio.play();
  });


  checkBtn.addEventListener("click", () => {
    // New flow: Disable input and show retry button, hide check button
    // Also hide Play button to prevent point farming (Play->Check->Play->Check)
    if (input) input.disabled = true;
    if (checkBtn) checkBtn.style.display = "none";
    if (playBtn) playBtn.style.display = "none";
    const wfdBtnChk = document.getElementById('wfd-play-btn');
    if (wfdBtnChk) wfdBtnChk.disabled = true;
    if (retryBtn) retryBtn.style.display = "inline-block";

    // Grammar check: capitalization and period
    const userInput = (input.value || "").trim();
    const grammarWarnings = [];

    if (userInput.length > 0) {
      // Check if first letter is capitalized
      const firstChar = userInput.charAt(0);
      if (firstChar !== firstChar.toUpperCase() || !/[A-Za-z]/.test(firstChar)) {
        if (/[a-z]/.test(firstChar)) {
          grammarWarnings.push("Start your sentence with a capital letter.");
        }
      }

      // Check if ends with a period
      const lastChar = userInput.charAt(userInput.length - 1);
      if (lastChar !== ".") {
        grammarWarnings.push("End your sentence with a period.");
      }
    }

    // Show grammar warning if any issues
    if (grammarWarnings.length > 0 && !window.isTutorialActive) {
      showGrammarWarning(grammarWarnings);
    }

    performCheckType(input.value, score);
  });

  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      // New flow: Clear input, disable it, and reset scaffolding
      // Show Play button again (was hidden after Check to prevent point farming)
      if (input) {
        input.value = "";
        input.disabled = true;
      }
      retryBtn.style.display = "none";
      resetScaffolding();

      // Restore Play button only if replays remain for this question (retry must not bypass the cap).
      let timesLeft = null;
      if (playBtn) {
        const replayCount = window.typeReplayCount || 0;
        if (window.DifficultyManager) {
          const settings = window.DifficultyManager.getCurrentSettings('type');
          const maxReplays = settings.maxReplays || 5;
          timesLeft = Math.max(0, maxReplays - replayCount);

          const replayBadge = document.getElementById('replay-counter-type');
          if (replayBadge) {
            replayBadge.textContent = `🔊 ${timesLeft} times left`;
            replayBadge.style.display = 'inline-block';
            replayBadge.classList.toggle('limit-reached', timesLeft === 0);
          }
        }

        playBtn.style.display = 'none';
        const wfdBtn = document.getElementById('wfd-play-btn');
        if (wfdBtn) wfdBtn.disabled = (timesLeft !== null && timesLeft <= 0);
      }

      // Hide hint controls and reset hint state for new attempt
      const hintControlsType = document.getElementById('hint-controls');
      const hintDisplayType = document.getElementById('auto-hints-type');
      if (window.HintSystem) window.HintSystem.resetForNewQuestion(currentTypeQuestionId, 'type');
      startAttemptContext('type', currentTypeQuestionId);
      window.questionStartTime = null;
      window.currentQuestionAttempts = 0;
      window.hintUsedForCurrentQuestion = false;

      // If the replay cap is reached, allow the user to keep practicing from memory:
      // enable input + Check even without replaying audio.
      if (timesLeft === 0) {
        if (input) {
          input.disabled = false;
          input.focus();
        }
        if (checkBtn) checkBtn.style.display = "inline-block";

        if (hintControlsType) hintControlsType.style.display = 'block';
        renderTypeHintState();

        // Start timing from the moment the retry begins (since Play is unavailable).
        window.questionStartTime = Date.now();
      } else {
        // Default: keep the "press Play to start" flow.
        if (checkBtn) checkBtn.style.display = "none";
        if (hintControlsType) hintControlsType.style.display = 'none';
        if (hintDisplayType) hintDisplayType.style.display = 'none';
      }
    });
  }




  // Speak mode
  playBtnSpeak.addEventListener("click", () => {
    // ============================================
    // REPLAY LIMIT CHECK (Smart Difficulty)
    // ============================================
    if (window.DifficultyManager) {
      const settings = window.DifficultyManager.getCurrentSettings('speak');
      const maxReplays = settings.maxReplays || 5;

      window.speakReplayCount = (window.speakReplayCount || 0) + 1;
      const timesLeft = Math.max(0, maxReplays - window.speakReplayCount);

      const replayBadgeSpeak = document.getElementById('replay-counter-speak');
      if (replayBadgeSpeak) {
        replayBadgeSpeak.textContent = `🔊 ${timesLeft} times left`;
        replayBadgeSpeak.style.display = 'inline-block';

        if (timesLeft === 0) {
          replayBadgeSpeak.classList.add('limit-reached');
          if (playBtnSpeak) playBtnSpeak.style.display = 'none';
        }
      }
    }

    // Start timing from the first meaningful action (Play), not question load.
    if (!window.questionStartTime) {
      window.questionStartTime = Date.now();
    }

    audio.currentTime = 0;
    audio.play();

    // Pronunciation Rune: Show IPA guide if skill owned
    const pronRuneDisplay = document.getElementById('pron-rune-display');
    const pronRuneText = document.getElementById('pron-rune-text');
    if (pronRuneDisplay && pronRuneText && window.shopModule && window.shopModule.isSkillUnlocked && window.shopModule.isSkillUnlocked('pron_rune') && correctSentenceSpeak) {
      pronRuneDisplay.style.display = 'flex';

      // Use cached IPA if available for this question (BUG-4 fix)
      if (window._pronRuneIpaCache) {
        pronRuneText.textContent = window._pronRuneIpaCache;
      } else {
        pronRuneText.textContent = 'Loading IPA...';

        // Fetch IPA for the first 3 content words
        const words = correctSentenceSpeak.split(/\s+/).filter(w => w.length > 3).slice(0, 3);
        const ipaPromises = words.map(async (word) => {
          const clean = word.replace(/[.,!?;:]/g, '').toLowerCase();
          try {
            const details = typeof window.Phonetics?.getIPAWithSource === 'function'
              ? await window.Phonetics.getIPAWithSource(clean)
              : null;
            return details?.ipa ? `${clean} ${details.ipa}` : `${clean}`;
          } catch { return `${clean}`; }
        });

        Promise.all(ipaPromises).then(results => {
          const ipaString = results.join('  •  ');
          pronRuneText.textContent = ipaString;
          window._pronRuneIpaCache = ipaString; // Cache for this question
        });
      }

      // Fire-and-forget skill usage for coin deduction (once per question)
      if (!window._pronRuneUsedThisQuestion) {
        window._pronRuneUsedThisQuestion = true;
        useActiveSkillForAttempt('pron_rune', 'speak', currentSpeakQuestionId).catch(() => { });
      }
    } else if (pronRuneDisplay) {
      pronRuneDisplay.style.display = 'none';
    }
  });

  // Shadow Mode Toggle Logic
  const shadowModeBtn = document.getElementById('shadow-mode-btn');
  window.isShadowModeActive = false;

  if (shadowModeBtn) {
    shadowModeBtn.addEventListener("click", async () => {
      if (shadowModeBtn.classList.contains('locked')) {
        handleLockedSkillClick('shadow_mode');
        return;
      }

      const nextState = !window.isShadowModeActive;
      if (nextState) {
        const skillResult = window.useActiveSkillForAttempt ? await window.useActiveSkillForAttempt('shadow_mode', 'speak', currentSpeakQuestionId) : { success: true };
        if (!skillResult?.success) return;
      }

      window.isShadowModeActive = nextState;
      shadowModeBtn.classList.toggle("active", window.isShadowModeActive);

      if (window.isShadowModeActive && correctSentenceSpeak) {
        // Play sentence slowly via speech synthesis for shadowing
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        const uttr = new SpeechSynthesisUtterance(correctSentenceSpeak);
        uttr.rate = 0.6;
        uttr.onend = () => {
          shadowModeBtn.title = "Shadow Mode — Done!";
          setTimeout(() => { shadowModeBtn.title = "Shadow Mode"; }, 2000);
        };
        window.speechSynthesis.speak(uttr);
        shadowModeBtn.title = "Shadowing... speak along!";
      } else {
        shadowModeBtn.title = "Shadow Mode";
        if (window.speechSynthesis) window.speechSynthesis.cancel();
      }
    });
  }

  // Note: Speech Recognition API handles permissions automatically.
  // The browser should remember permissions after the first grant.
  // If you're opening this as a local file (file://), browsers don't persist
  // permissions for security reasons - this is expected browser behavior.
  const ensureMicrophoneAccess = async () => {
    // No-op: Let each recognition instance request permission naturally
    // The browser will remember it after the first grant (unless file://)
  };

  // Custom Alert Helper for Tutorial
  const showCustomAlert = (title, message) => {
    const modal = document.getElementById('vocab-alert-modal');
    const titleEl = document.getElementById('vocab-alert-title');
    const msgEl = document.getElementById('vocab-alert-message');
    const okBtn = document.getElementById('vocab-alert-ok');

    if (modal && titleEl && msgEl && okBtn) {
      titleEl.textContent = title;
      msgEl.innerHTML = message; // Use innerHTML to support basic formatting if needed
      modal.style.display = 'flex';

      const closeModal = () => {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', closeModal);
      };

      okBtn.addEventListener('click', closeModal);
    } else {
      // Fallback if modal elements are missing
      alert(`${title}\n\n${message}`);
    }
  };

  recordBtn.addEventListener("click", async () => {
    if (!recognition) return;

    // Ensure microphone access is granted
    await ensureMicrophoneAccess();

    if (isRecording) {
      // Tutorial Mode Check: Prevent stopping if no speech is detected
      if (window.isTutorialActive && document.getElementById('tab-speak').classList.contains('active')) {
        const currentText = transcriptionText ? transcriptionText.textContent.trim() : "";
        // Check for empty or default states (meaning no transcription yet)
        const invalidStates = ["Listening...", "Starting...", "Click 'Start Recording' and speak...", ""];

        if (invalidStates.includes(currentText)) {
          showCustomAlert("Notice", "No speech detected. Please speak into the microphone before stopping.");
          return; // Prevent stopping
        }
      }

      // Stop recording
      try {
        recognition.stop();
      } catch (e) {
        // Ignore errors when stopping
      }
      isRecording = false;
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      recordingStatus.classList.remove("active");

      // New flow: Show check button when recording stops
      if (checkBtnSpeak) checkBtnSpeak.style.display = "inline-block";
      window.SpeakingPracticeController?.sync?.('speak');
    } else {
      // Start recording
      // First, make sure any previous recognition is stopped
      try {
        recognition.stop();
      } catch (e) {
        // Ignore if already stopped
      }

      // Wait a moment before starting to avoid conflicts
      await new Promise(resolve => setTimeout(resolve, 100));

      // Start timing from first meaningful action (Record) if Play wasn't used.
      if (!window.questionStartTime) {
        window.questionStartTime = Date.now();
      }

      transcription = "";
      transcriptionText.textContent = "Listening...";
      transcriptionText.classList.remove("empty");
      recordingStatus.textContent = "Starting...";
      recordingStatus.classList.add("active");
      recordBtn.textContent = "Stop Recording";
      recordBtn.classList.add("recording");
      isRecording = true;

      // New flow: Hide check button while recording
      if (checkBtnSpeak) checkBtnSpeak.style.display = "none";
      window.SpeakingPracticeController?.sync?.('speak');

      try {
        recognition.start();
      } catch (e) {
        // Handle specific error cases
        if (e.name === "InvalidStateError" || e.message.includes("already started")) {
          // Recognition is already running, just update UI
          recordingStatus.textContent = "Recording...";
        } else if (e.name === "NotAllowedError") {
          recordingStatus.textContent = "Microphone access denied. Please allow microphone access and try again.";
          isRecording = false;
          recordBtn.textContent = "Start Recording";
          recordBtn.classList.remove("recording");
          recordingStatus.classList.remove("active");
        } else {
          log.error("Failed to start recognition:", e);
          isRecording = false;
          recordBtn.textContent = "Start Recording";
          recordBtn.classList.remove("recording");
          recordingStatus.classList.remove("active");
          recordingStatus.textContent = `Error: ${e.message || "Failed to start"}`;
        }
      }
    }
  });

  checkBtnSpeak.addEventListener("click", () => {
    if (isRecording && recognition) {
      recognition.stop();
      isRecording = false;
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      recordingStatus.classList.remove("active");
    }

    // New flow: Hide record/check button and show retry button
    // Also hide Play button to prevent point farming
    if (recordBtn) recordBtn.style.display = "none";
    if (checkBtnSpeak) checkBtnSpeak.style.display = "none";
    if (playBtnSpeak) playBtnSpeak.style.display = "none";
    if (retryBtnSpeak) retryBtnSpeak.style.display = "inline-block";
    window.SpeakingPracticeController?.sync?.('speak');

    performCheckSpeak(transcription.trim(), scoreSpeak);
  });

  if (retryBtnSpeak) {
    retryBtnSpeak.addEventListener("click", () => {
      // New flow: Show record button, hide retry button, and reset scaffolding
      // Show Play button again (was hidden after Check to prevent point farming)
      if (recordBtn) recordBtn.style.display = "inline-block";
      retryBtnSpeak.style.display = "none";
      window.SpeakingPracticeController?.sync?.('speak');
      resetScaffolding();

      // Restore Play button only if replays remain for this question (retry must not bypass the cap).
      if (playBtnSpeak) {
        let timesLeft = null;
        const replayCount = window.speakReplayCount || 0;
        if (window.DifficultyManager) {
          const settings = window.DifficultyManager.getCurrentSettings('speak');
          const maxReplays = settings.maxReplays || 5;
          timesLeft = Math.max(0, maxReplays - replayCount);

          const replayBadgeSpeak = document.getElementById('replay-counter-speak');
          if (replayBadgeSpeak) {
            replayBadgeSpeak.textContent = `🔊 ${timesLeft} times left`;
            replayBadgeSpeak.style.display = 'inline-block';
            replayBadgeSpeak.classList.toggle('limit-reached', timesLeft === 0);
          }
        }

        playBtnSpeak.style.display = (timesLeft === null || timesLeft > 0) ? 'inline-block' : 'none';
      }

      startAttemptContext('speak', currentSpeakQuestionId);
      window.questionStartTime = null;
      window.currentQuestionAttempts = 0;
      window.hintUsedForCurrentQuestion = false;
    });
  }

  replayBtn.addEventListener("click", () => {
    if (lastSteps.length) playAnimation(lastSteps, () => { }, lastAnimationMode);
  });

  // Stop words to exclude from sentence generation
  const stopWords = new Set([
    // Articles
    "a", "an", "the",
    // Conjunctions
    "and", "or", "but", "nor", "so", "yet",
    // Prepositions
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "up", "about", "into", "through",
    "during", "including", "excluding", "following", "over", "under", "above", "below", "between",
    "among", "within", "without", "against", "across", "around", "behind", "beside", "besides",
    "beyond", "near", "off", "out", "down", "upon", "toward", "towards", "until", "till",
    // Auxiliary verbs
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
    // Modal verbs
    "will", "would", "should", "could", "may", "might", "must", "can", "shall",
    // Demonstratives
    "this", "that", "these", "those",
    // Personal pronouns
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
    // Possessive pronouns
    "my", "your", "his", "her", "its", "our", "their", "mine", "yours", "hers", "ours", "theirs",
    // Other grammar words
    "as", "if", "when", "where", "while", "which", "who", "whom", "whose", "what", "why", "how",
    // Common temporal and general words
    "next", "now", "then", "here", "there", "more", "most", "some", "any", "many", "much",
    // Adverbs / particles (non-content)
    "well", "quite", "just", "also", "still", "even", "only", "very", "too", "enough",
    "rather", "already", "almost", "really", "perhaps", "maybe", "never", "always", "often",
    "sometimes", "ago", "else", "back", "away", "less", "least", "not", "no", "yes",
    // Contractions
    "we'll", "we're", "we've", "we'd", "they'll", "they're", "they've", "they'd", "it's", "that's", "there's",
    "don't", "doesn't", "didn't", "won't", "wouldn't", "couldn't", "shouldn't", "can't", "isn't", "aren't",
    "wasn't", "weren't", "haven't", "hasn't", "hadn't", "i'm", "i've", "i'd", "i'll", "you're", "you've",
    "you'd", "you'll", "he's", "she's", "here's", "where's", "what's", "who's", "how's", "let's"
  ]);

  // Common verbs that shouldn't be used as keywords (nouns)
  const commonVerbs = new Set([
    "discuss", "analyze", "examine", "study", "review", "explore", "understand", "consider", "evaluate",
    "assess", "investigate", "explain", "describe", "present", "show", "demonstrate", "highlight", "focus",
    "address", "affect", "influence", "impact", "shape", "determine", "change", "improve", "create", "make",
    "take", "give", "get", "go", "come", "see", "know", "think", "say", "tell", "ask", "want", "need",
    "use", "work", "call", "try", "find", "keep", "let", "put", "mean", "set", "become", "leave", "feel",
    "seem", "bring", "begin", "help", "show", "hear", "play", "run", "move", "like", "live", "believe",
    "hold", "bring", "happen", "write", "sit", "stand", "lose", "pay", "meet", "include", "continue", "learn"
  ]);

  // Filter content words (exclude stop words and contractions only - keep verbs for pronunciation practice)
  const filterContentWords = (words) => {
    if (!words || !Array.isArray(words)) {
      return [];
    }

    return words.filter((word) => {
      if (!word || typeof word !== 'string') {
        return false;
      }

      // Normalize: lowercase, trim whitespace (including non-breaking spaces)
      let lowerWord = word.toLowerCase().trim();
      // Remove all whitespace characters
      lowerWord = lowerWord.replace(/\s+/g, '');

      // First check: Exclude contractions (any word with apostrophe) - check BEFORE removing punctuation
      if (lowerWord.includes("'")) {
        // Check if it's in stopWords (for contractions like "we'll")
        if (stopWords.has(lowerWord)) {
          return false;
        }
        // Exclude all other contractions
        return false;
      }

      // Remove all punctuation marks
      let normalized = lowerWord.replace(/[.,!?;:"()[\]{}]/g, '');
      normalized = normalized.trim();

      // Exclude if empty or single character
      if (!normalized || normalized.length <= 1) {
        return false;
      }

      // Explicit check for common stop words (double-check)
      const commonStopWords = ["the", "a", "an", "on", "of", "in", "at", "to", "for", "with", "by", "from"];
      if (commonStopWords.includes(normalized)) {
        return false;
      }

      // Exclude if it's a stop word (articles, prepositions, pronouns, etc.)
      // BUT keep verbs - they are content words that should be practiced
      if (stopWords.has(normalized)) {
        return false;
      }

      // Don't filter out verbs - they are content words that should be included
      // Return true for all other words (nouns, verbs, adjectives, adverbs, etc.)
      return true;
    });
  };



  // Skip Animation button
  if (skipAnimationBtn) {
    skipAnimationBtn.addEventListener("click", skipAnimation);
  }

  // Breakdown Mode functions
  let breakdownMode = "beginning"; // "beginning" or "end"
  let breakdownRecognition = null;

  const getWordSegment = (percentage, fromEnd = false) => {
    // Determine mode from active tab
    const mode = document.getElementById("tab-type").classList.contains("active") ? "type" : "speak";
    const correctSentence = mode === "type" ? correctSentenceType : correctSentenceSpeak;
    const words = normalize(correctSentence).split(" ").filter(Boolean);
    const totalWords = words.length;
    const wordCount = Math.ceil((totalWords * percentage) / 100);

    if (fromEnd) {
      return words.slice(-wordCount).join(" ");
    } else {
      return words.slice(0, wordCount).join(" ");
    }
  };

  // Process a phrase to handle "the" pronunciation correctly
  const processPhraseForSpeech = (phrase) => {
    const words = phrase.split(" ").filter(Boolean);
    const processedWords = words.map((word, idx) => {
      const nextWord = words[idx + 1] || "";
      return choosePronunciation(word, nextWord);
    });
    return processedWords.join(" ");
  };

  const playBreakdownSegment = (percentage) => {
    const segment = getWordSegment(percentage, breakdownMode === "end");

    // Cancel any ongoing speech
    if (synth) synth.cancel();

    // Process the entire phrase to handle "the" pronunciation correctly
    const processedPhrase = processPhraseForSpeech(segment);

    // Speak the entire phrase as one natural utterance
    const utter = new SpeechSynthesisUtterance(processedPhrase);
    utter.lang = "en-US";

    // Try to prefer a bright/happy US female voice by name substring if available
    const voices = synth.getVoices();
    const preferred = voices.find((v) =>
      /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
    );
    if (preferred) utter.voice = preferred;
    utter.rate = 1.0; // Natural speaking rate
    utter.pitch = 1.0; // Natural pitch

    synth.speak(utter);
  };

  const startBreakdownRecording = async (percentage, lineIndex, btn) => {
    if (!SpeechRecognition) {
      alert("Speech recognition is not available in your browser.");
      return;
    }

    await ensureMicrophoneAccess();

    // Stop any ongoing breakdown recording
    if (breakdownRecognition) {
      breakdownRecognition.stop();
      breakdownRecognition = null;
    }

    // Stop main recording if active
    if (isRecording && recognition) {
      recognition.stop();
      isRecording = false;
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      recordingStatus.classList.remove("active");
    }

    const expectedSegment = getWordSegment(percentage, breakdownMode === "end");
    const statusEl = document.getElementById(`breakdown-status-${lineIndex}`);

    btn.textContent = "Recording...";
    btn.disabled = true;
    btn.classList.add("recording");
    statusEl.textContent = "Listening...";
    statusEl.className = "breakdown-status";

    breakdownRecognition = new SpeechRecognition();
    breakdownRecognition.continuous = false;
    breakdownRecognition.interimResults = false;
    breakdownRecognition.lang = "en-US";
    breakdownRecognition.maxAlternatives = 1;

    breakdownRecognition.onresult = (event) => {
      const spokenText = event.results[0][0].transcript.trim();
      const expected = normalize(expectedSegment);
      const spoken = normalize(spokenText);
      const match = spoken === expected;

      if (match) {
        statusEl.textContent = "✓ Correct!";
        statusEl.className = "breakdown-status correct";
      } else {
        // Use diffWords to find missing words
        const diff = diffWords(spokenText, expectedSegment);
        const missingWords = [];
        diff.forEach((part) => {
          if (part.type === "missing") {
            missingWords.push(part.text);
          }
        });

        if (missingWords.length > 0) {
          statusEl.textContent = `Incorrect, you are missing these words: ${missingWords.join(", ")}`;
        } else {
          statusEl.textContent = `Incorrect. Expected: "${expectedSegment}"`;
        }
        statusEl.className = "breakdown-status incorrect";
      }

      btn.textContent = "Record";
      btn.disabled = false;
      btn.classList.remove("recording");
      breakdownRecognition = null;
    };

    breakdownRecognition.onerror = (event) => {
      statusEl.textContent = `Error: ${event.error}`;
      statusEl.className = "breakdown-status incorrect";
      btn.textContent = "Record";
      btn.disabled = false;
      btn.classList.remove("recording");
      breakdownRecognition = null;
    };

    breakdownRecognition.onend = () => {
      if (statusEl.textContent === "Listening...") {
        statusEl.textContent = "No speech detected. Try again.";
        statusEl.className = "breakdown-status incorrect";
      }
      btn.textContent = "Record";
      btn.disabled = false;
      btn.classList.remove("recording");
      breakdownRecognition = null;
    };

    try {
      breakdownRecognition.start();
    } catch (e) {
      log.error("Failed to start breakdown recognition:", e);
      btn.textContent = "Record";
      btn.disabled = false;
      btn.classList.remove("recording");
      statusEl.textContent = "Failed to start recording";
      statusEl.className = "breakdown-status incorrect";
      breakdownRecognition = null;
    }
  };

  const renderBreakdownMode = () => {
    breakdownPanel.style.display = "block";
    breakdownLines.innerHTML = `
      <div class="breakdown-line">
        <span class="breakdown-line-label">30%</span>
        <div class="breakdown-line-controls">
          <button class="breakdown-play-btn" data-percentage="30" type="button">Play</button>
          <button class="breakdown-record-btn" data-percentage="30" data-index="0" type="button">Record</button>
          <span class="breakdown-status" id="breakdown-status-0"></span>
        </div>
      </div>
      <div class="breakdown-line">
        <span class="breakdown-line-label">60%</span>
        <div class="breakdown-line-controls">
          <button class="breakdown-play-btn" data-percentage="60" type="button">Play</button>
          <button class="breakdown-record-btn" data-percentage="60" data-index="1" type="button">Record</button>
          <span class="breakdown-status" id="breakdown-status-1"></span>
        </div>
      </div>
      <div class="breakdown-line">
        <span class="breakdown-line-label">100%</span>
        <div class="breakdown-line-controls">
          <button class="breakdown-play-btn" data-percentage="100" type="button">Play</button>
          <button class="breakdown-record-btn" data-percentage="100" data-index="2" type="button">Record</button>
          <span class="breakdown-status" id="breakdown-status-2"></span>
        </div>
      </div>
    `;

    // Add event listeners
    breakdownLines.querySelectorAll(".breakdown-play-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const percentage = parseInt(btn.dataset.percentage, 10);
        playBreakdownSegment(percentage);
      });
    });

    breakdownLines.querySelectorAll(".breakdown-record-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const percentage = parseInt(btn.dataset.percentage, 10);
        const index = parseInt(btn.dataset.index, 10);
        startBreakdownRecording(percentage, index, btn);
      });
    });
  };

  // Breakdown mode option buttons
  breakdownBeginningBtn.addEventListener("click", () => {
    breakdownMode = "beginning";
    breakdownBeginningBtn.classList.add("active");
    breakdownEndBtn.classList.remove("active");
    renderBreakdownMode();
  });

  breakdownEndBtn.addEventListener("click", () => {
    breakdownMode = "end";
    breakdownEndBtn.classList.add("active");
    breakdownBeginningBtn.classList.remove("active");
    renderBreakdownMode();
  });

  animationBox.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const word = target.dataset.word;
    if (word) {
      const next = target.nextElementSibling?.getAttribute("data-word") || "";
      speakWord(word, next);
    }
  });
  // Expose functions to window for global access (required for auth-ui.js callbacks)
  window.populateQuestionSelect = populateQuestionSelect;
  window.loadSentenceLengthData = loadSentenceLengthData;

  // Global user profile storage
  window.currentUserProfile = null;

  /**
   * Check if Sentence Length Filters are unlocked for the user (Type and Speak)
   */
  async function checkFilterUnlockStatus(userId) {
    if (!userId || !window.firebaseFirestoreFunctions) return;
    try {
      let profile;
      if (window.currentUserProfile && window.currentUserProfile.userId === userId) {
        log.debug('Using cached profile for filter status');
        profile = window.currentUserProfile;
      } else {
        const result = await window.firebaseFirestoreFunctions.getUserProfile(userId);
        if (result && result.success && result.data) {
          profile = result.data;
          window.currentUserProfile = profile; // Store globally
        }
      }

      if (profile) {
        const unlockedBySkillTree = !!(profile?.unlockedSkills?.length_filter || profile?.skillPassives?.length_filter);
        const unlockedByModes = Array.isArray(profile.unlockedModes) && profile.unlockedModes.includes('lengthFilter');
        const unlockedByLegacyField = profile.lengthFilterUnlocked === true;

        const isUnlocked = unlockedBySkillTree || unlockedByModes || unlockedByLegacyField;
        const typeUnlocked = isUnlocked;
        const speakUnlocked = isUnlocked;

        const containerType = document.getElementById('length-filter-container-type');
        if (containerType) {
          containerType.style.display = typeUnlocked ? 'block' : 'none';
          if (typeUnlocked) {
            loadSentenceLengthData();
            applyLevelBasedRestrictions('type', profile);
          }
        }

        const containerSpeak = document.getElementById('length-filter-container-speak');
        if (containerSpeak) {
          containerSpeak.style.display = speakUnlocked ? 'block' : 'none';
          if (speakUnlocked) {
            loadSpeakLengthData();
            applyLevelBasedRestrictions('speak', profile);
          }
        }

        window.refreshLengthFilterLocks?.();
        window.DifficultyFilter?.updateFilterVisibility?.();
      }
    } catch (e) {
      log.error('Error checking filter unlock status:', e);
    }
  }

  /**
   * Apply filter option restrictions based on English Level
   */
  function applyLevelBasedRestrictions(mode, profile) {
    const menuId = `length-filter-menu-${mode}`;
    const menu = document.getElementById(menuId);
    if (!menu || !profile) return;

    // Determine if fully unlocked (via Shop or Expert level previously full unlocked)
    // Note: Expert level initially DOES NOT unlock filter. If unlocked, it's likely via Shop.
    // We check the 'FullUnlock' flag set during purchase.
    const isFullUnlock = mode === 'type'
      ? profile.sentenceLengthFilterFullUnlock
      : profile.speakLengthFilterFullUnlock;

    // PRIORITY OVERRIDE: Check Shop Module directly
    // This fixes the issue where Beginner users are restricted even after purchase
    const isShopUnlocked = isLengthFilterUnlocked(profile);

    if (isFullUnlock || isShopUnlocked) {
      // Show all options and unlock them
      menu.querySelectorAll('.filter-option').forEach(el => {
        el.style.display = 'flex';
        delete el.dataset.locked;
        el.classList.remove('locked');
        const icon = el.querySelector('.locked-icon');
        if (icon) icon.remove();
      });
      return;
    }

    // Level-based Logic
    const level = profile.englishLevel ? profile.englishLevel.toLowerCase() : null;
    if (!level) return; // Should not happen if unlocked via level, but safety check

    const options = menu.querySelectorAll('.filter-option');
    options.forEach(opt => {
      const val = opt.dataset.value;
      if (val === 'all') {
        // Always show 'All Lengths' for every level as requested
        opt.style.display = 'flex';

        // Tag as restricted for Beginner and Expert if not fully unlocked
        const level = (profile.englishLevel || '').toLowerCase();
        const fullUnlockKey = mode === 'speak' ? 'speakLengthFilterFullUnlock' : 'sentenceLengthFilterFullUnlock';
        const isFullUnlocked = profile[fullUnlockKey] === true;

        if ((level === 'beginner' || level === 'expert') && !isFullUnlocked) {
          opt.dataset.locked = "true";
          // Add visual cue for locked state if not already there
          if (!opt.querySelector('.locked-icon')) {
            const icon = document.createElement('span');
            icon.className = 'locked-icon';
            icon.textContent = '🔒';
            icon.style.marginLeft = 'auto';
            icon.style.fontSize = '0.9em';
            opt.appendChild(icon);
          }
        } else {
          delete opt.dataset.locked;
          const icon = opt.querySelector('.locked-icon');
          if (icon) icon.remove();
        }
      } else {
        let show = false;
        const level = (profile.englishLevel || '').toLowerCase();

        if (level === 'beginner') {
          // Only 5-8 (and maybe 4-7 for speak)
          if (val === '5-8' || val === '4-7') show = true;
        } else if (level === 'intermediate') {
          // 5-8, 9 (Type) / 4-7, 8-9 (Speak)
          if (val === '5-8' || val === '9') show = true;
          if (val === '4-7' || val === '8-9') show = true;
        } else if (level === 'expert' || level === 'advanced') {
          // Expert is now restricted similarly to Beginner by default unless fully unlocked
          // The user requested a popup for 'All lengths' for Experts too.
          if (val === '5-8' || val === '4-7') show = true;
        }
        opt.style.display = show ? 'flex' : 'none';
      }
    });

    // Auto-select the first visible option if current selection is hidden
    const selected = menu.querySelector('.filter-option.selected');
    if (!selected || selected.style.display === 'none') {
      const firstVisible = Array.from(options).find(el => el.style.display !== 'none');
      if (firstVisible) {
        // Simulate click or just set class
        options.forEach(o => o.classList.remove('selected'));
        firstVisible.classList.add('selected');
        // Update label
        const labelId = `length-filter-label-${mode}`;
        const labelEl = document.getElementById(labelId);
        if (labelEl) labelEl.textContent = firstVisible.querySelector('.filter-option-text').textContent.replace(/📏|📝/g, '').trim();
        // Trigger populate
        // window.populateQuestionSelect(mode); // Will be called by load data anyway
      }
    }
  }

  // Expose checks globally
  window.checkFilterUnlockStatus = checkFilterUnlockStatus;

  // ============================================
  // Status Filter (Multi-select with highlighting)
  // ============================================
  const statusFilterBtn = document.getElementById('status-filter-btn-type');
  const statusFilterMenu = document.getElementById('status-filter-menu-type');
  const statusFilterContainer = document.getElementById('status-filter-container-type');

  if (statusFilterBtn && statusFilterMenu) {
    // Toggle dropdown
    statusFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = statusFilterMenu.style.display === 'block';
      statusFilterMenu.style.display = isOpen ? 'none' : 'block';
      statusFilterContainer.classList.toggle('open', !isOpen);
    });

    // Handle option click (multi-select toggle)
    statusFilterMenu.querySelectorAll('.filter-option').forEach(option => {
      option.addEventListener('click', () => {
        option.classList.toggle('selected');
        populateQuestionSelect('type');
        updateStatusFilterLabel();
      });
    });

    // Update label to show count of selected
    const updateStatusFilterLabel = () => {
      const selectedCount = statusFilterMenu.querySelectorAll('.filter-option.selected').length;
      const totalCount = statusFilterMenu.querySelectorAll('.filter-option').length;
      const labelEl = document.getElementById('status-filter-label-type');
      if (labelEl) {
        if (selectedCount === totalCount) {
          labelEl.textContent = 'Filter by Status';
        } else {
          labelEl.textContent = `Status (${selectedCount}/${totalCount})`;
        }
      }
    };

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!statusFilterContainer.contains(e.target)) {
        statusFilterMenu.style.display = 'none';
        statusFilterContainer.classList.remove('open');
      }
    });
  }

  // ============================================
  // Length Filter (Single-select with highlighting)
  // ============================================
  const lengthFilterBtn = document.getElementById('length-filter-btn-type');
  const lengthFilterMenu = document.getElementById('length-filter-menu-type');
  const lengthFilterContainer = document.getElementById('length-filter-container-type');

  if (lengthFilterBtn && lengthFilterMenu) {
    // Toggle dropdown
    lengthFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = lengthFilterMenu.style.display === 'block';
      lengthFilterMenu.style.display = isOpen ? 'none' : 'block';
      lengthFilterContainer.classList.toggle('open', !isOpen);
    });

    // Handle option click (single-select)
    lengthFilterMenu.querySelectorAll('.filter-option').forEach(option => {
      option.addEventListener('click', (e) => {
        // Restricted Filter Check
        // Priority check: Is it unlocked via progression?
        const isUnlocked = isLengthFilterUnlocked();

        if (option.dataset.locked === "true" && !isUnlocked) {
          window.shopModule.showAlertModal("This feature is locked. Keep practicing to unlock it.", true);
          return; // Do not apply filter
        }

        // Remove selected from all
        lengthFilterMenu.querySelectorAll('.filter-option').forEach(o => o.classList.remove('selected'));
        // Add to clicked
        option.classList.add('selected');

        // Update label
        const text = option.querySelector('.filter-option-text')?.textContent || 'Filter by Length';
        const labelEl = document.getElementById('length-filter-label-type');
        if (labelEl) labelEl.textContent = text.replace(/📏|📝/g, '').trim();

        populateQuestionSelect('type');

        // Close menu after selection
        lengthFilterMenu.style.display = 'none';
        lengthFilterContainer.classList.remove('open');
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!lengthFilterContainer.contains(e.target)) {
        lengthFilterMenu.style.display = 'none';
        lengthFilterContainer.classList.remove('open');
      }
    });
  }

  // ============================================
  // Status Filter for Speak Mode
  // ============================================
  const statusFilterBtnSpeak = document.getElementById('status-filter-btn-speak');
  const statusFilterMenuSpeak = document.getElementById('status-filter-menu-speak');
  const statusFilterContainerSpeak = document.getElementById('status-filter-container-speak');

  if (statusFilterBtnSpeak && statusFilterMenuSpeak) {
    // Toggle dropdown
    statusFilterBtnSpeak.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = statusFilterMenuSpeak.style.display === 'block';
      statusFilterMenuSpeak.style.display = isOpen ? 'none' : 'block';
      statusFilterContainerSpeak.classList.toggle('open', !isOpen);
    });

    // Handle option click (multi-select toggle)
    statusFilterMenuSpeak.querySelectorAll('.filter-option').forEach(option => {
      option.addEventListener('click', () => {
        option.classList.toggle('selected');
        populateQuestionSelect('speak');
        updateStatusFilterLabelSpeak();
      });
    });

    // Update label to show count of selected
    const updateStatusFilterLabelSpeak = () => {
      const selectedCount = statusFilterMenuSpeak.querySelectorAll('.filter-option.selected').length;
      const totalCount = statusFilterMenuSpeak.querySelectorAll('.filter-option').length;
      const labelEl = document.getElementById('status-filter-label-speak');
      if (labelEl) {
        if (selectedCount === totalCount) {
          labelEl.textContent = 'Filter by Status';
        } else {
          labelEl.textContent = `Status (${selectedCount}/${totalCount})`;
        }
      }
    };

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!statusFilterContainerSpeak.contains(e.target)) {
        statusFilterMenuSpeak.style.display = 'none';
        statusFilterContainerSpeak.classList.remove('open');
      }
    });
  }

  // ============================================
  // Length Filter for Speak Mode
  // ============================================
  const lengthFilterBtnSpeak = document.getElementById('length-filter-btn-speak');
  const lengthFilterMenuSpeak = document.getElementById('length-filter-menu-speak');
  const lengthFilterContainerSpeak = document.getElementById('length-filter-container-speak');

  if (lengthFilterBtnSpeak && lengthFilterMenuSpeak) {
    // Toggle dropdown
    lengthFilterBtnSpeak.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = lengthFilterMenuSpeak.style.display === 'block';
      lengthFilterMenuSpeak.style.display = isOpen ? 'none' : 'block';
      lengthFilterContainerSpeak.classList.toggle('open', !isOpen);
    });

    // Handle option click (single-select)
    lengthFilterMenuSpeak.querySelectorAll('.filter-option').forEach(option => {
      option.addEventListener('click', (e) => {
        // Restricted Filter Check
        // Priority check: Is it unlocked via progression?
        const isUnlocked = isLengthFilterUnlocked();

        if (option.dataset.locked === "true" && !isUnlocked) {
          window.shopModule.showAlertModal("This feature is locked. Keep practicing to unlock it.", true);
          return; // Do not apply filter
        }

        // Remove selected from all
        lengthFilterMenuSpeak.querySelectorAll('.filter-option').forEach(o => o.classList.remove('selected'));
        // Add to clicked
        option.classList.add('selected');

        // Update label
        const text = option.querySelector('.filter-option-text')?.textContent || 'Filter by Length';
        const labelEl = document.getElementById('length-filter-label-speak');
        if (labelEl) labelEl.textContent = text.replace(/📏|📝/g, '').trim();

        populateQuestionSelect('speak');

        // Close menu after selection
        lengthFilterMenuSpeak.style.display = 'none';
        lengthFilterContainerSpeak.classList.remove('open');
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!lengthFilterContainerSpeak.contains(e.target)) {
        lengthFilterMenuSpeak.style.display = 'none';
        lengthFilterContainerSpeak.classList.remove('open');
      }
    });
  }

  // Expose loadSpeakLengthData globally
  window.loadSpeakLengthData = loadSpeakLengthData;

  // ============================================
  // Dictionary Peek (Reading Skill)
  // ============================================
  function initDictionaryPeek() {
    const bubble = document.getElementById('dict-peek-bubble');
    const btn = document.getElementById('dict-peek-btn');
    const costSpan = document.getElementById('dict-peek-cost');
    const modal = document.getElementById('dict-peek-modal');
    const modalBody = document.getElementById('dict-peek-body');
    const modalWord = document.getElementById('dict-peek-word');
    const closeBtn = document.getElementById('dict-peek-close');
    let currentSelectedText = '';

    if (!bubble || !btn || !modal) return;

    document.addEventListener('mousedown', (e) => {
      if (!bubble.contains(e.target) && !modal.contains(e.target) && e.target !== btn) {
        bubble.style.display = 'none';
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }

    document.addEventListener('selectionchange', () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const text = selection.toString().trim();
      if (!text || text.length > 30 || text.includes(' ')) {
        bubble.style.display = 'none';
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (bubble.contains(e.target) || modal.contains(e.target)) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        bubble.style.display = 'none';
        return;
      }

      const text = selection.toString().trim();
      if (!text || text.length > 30 || text.includes(' ')) return;

      if (!window.shopModule || !window.shopModule.isSkillUnlocked('dict_peek')) return;

      const currentMode = window.appState?.currentMode || 'extended'; // Fallback to extended
      if (currentMode !== 'extended' && currentMode !== 'watch' && currentMode !== 'rfib') return;

      currentSelectedText = text;

      let pct = 0;
      if (currentMode === 'watch' && window.shopModule.hasSkill('mode_license_watch')) pct += 0.15;
      if (currentMode === 'extended' && window.shopModule.hasSkill('mode_license_extended')) pct += 0.15;
      if (currentMode === 'rfib' && window.shopModule.hasSkill('mode_license_extended')) pct += 0.15;
      if (window.shopModule.hasSkill('frugal_reader_3')) pct += 0.30;
      else if (window.shopModule.hasSkill('frugal_reader_2')) pct += 0.20;
      else if (window.shopModule.hasSkill('frugal_reader_1')) pct += 0.10;
      pct = Math.min(0.5, Math.max(0, pct));

      const baseCost = window.SkillCatalog?.getSkill('dict_peek')?.baseCost || 1;
      const finalCost = Math.ceil(baseCost * (1 - pct));
      if (costSpan) costSpan.textContent = finalCost.toString();

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      bubble.style.display = 'block';

      // Calculate position
      const bubbleHeight = 40;
      let topPos = rect.bottom + window.scrollY + 8;
      // If bottom goes offscreen, show above
      if (topPos + bubbleHeight > window.innerHeight + window.scrollY) {
        topPos = rect.top + window.scrollY - bubbleHeight - 8;
      }

      bubble.style.top = `${topPos}px`;
      bubble.style.left = `${Math.max(10, rect.left + window.scrollX + (rect.width / 2) - 60)}px`;
    });

    btn.addEventListener('click', async () => {
      const questionId = window.currentTypeQuestionId || window.currentSpeakQuestionId || 'dict_peek';
      const currentMode = window.appState?.currentMode || 'extended';
      btn.disabled = true;
      bubble.style.display = 'none';

      try {
        const skillResult = window.useActiveSkillForAttempt ? await window.useActiveSkillForAttempt('dict_peek', currentMode, questionId) : { success: true };
        if (skillResult?.success) {
          modal.style.display = 'block';
          if (modalWord) modalWord.textContent = currentSelectedText;
          if (modalBody) modalBody.innerHTML = '<div style="padding: 20px; text-align: center;">Fetching definition...</div>';

          try {
            const cleanText = currentSelectedText.trim().toLowerCase();
            const [wordData, phoneticsData] = await Promise.all([
              window.DictionaryService ? window.DictionaryService.getWordData(cleanText) : Promise.resolve({ definition: '', example: '', vietnameseTranslation: '', sentences: [] }),
              window.Phonetics && typeof window.Phonetics.getIPAWithSource === 'function' ? window.Phonetics.getIPAWithSource(cleanText) : Promise.resolve({ ipa: '' })
            ]);

            let html = '';

            // Header info: Phonetics & Translation
            if (phoneticsData?.ipa || wordData?.vietnameseTranslation) {
              html += `<div class="dict-peek-header-info" style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:8px 12px;background:rgba(59,130,246,0.08);border-radius:8px;font-size:14px;">`;
              if (phoneticsData?.ipa) {
                html += `<span class="dict-peek-ipa" style="font-family:'Charis SIL',Georgia,serif;color:#2563eb;font-weight:600;font-size:15px;">${phoneticsData.ipa}</span>`;
              }
              if (wordData?.vietnameseTranslation) {
                html += `<span class="dict-peek-vi" style="color:#059669;font-weight:500;">(${wordData.vietnameseTranslation})</span>`;
              }
              html += `</div>`;
            }

            if (wordData?.definition) {
              const posLabel = wordData.partOfSpeech ? `<span class="dict-peek-pos" style="display:inline-block;padding:2px 8px;border-radius:4px;background:#e2e8f0;font-size:12px;color:#475569;margin-bottom:6px;">${wordData.partOfSpeech}</span>` : '';
              html += `${posLabel}<p class="dict-peek-def" style="margin-bottom:10px;line-height:1.5;color:#1e293b;">${wordData.definition}</p>`;
              if (wordData.example) {
                html += `<p class="dict-peek-example" style="font-style:italic;color:#64748b;font-size:13px;border-left:3px solid #cbd5e1;padding-left:8px;margin-bottom:10px;">"${wordData.example}"</p>`;
              }
            } else {
              // Fallback to legacy dictionaryapi lookup if DictionaryService returned empty
              try {
                const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanText)}`);
                if (resp.ok) {
                  const data = await resp.json();
                  if (data && data[0] && data[0].meanings) {
                    data[0].meanings.forEach(m => {
                      html += `<h4 class="dict-peek-pos" style="font-weight:600;margin-top:8px;color:#334155;">${m.partOfSpeech}</h4><ul class="dict-peek-defs" style="padding-left:18px;margin:4px 0;">`;
                      m.definitions.slice(0, 3).forEach(d => {
                        html += `<li style="margin-bottom:4px;">${d.definition}</li>`;
                      });
                      html += '</ul>';
                    });
                  }
                }
              } catch (fallbackErr) {
                // Ignore fallback error
              }
            }

            if (!html) {
              html = `<p>Definition not found for "${currentSelectedText}".</p>`;
            }
            if (modalBody) modalBody.innerHTML = html;

            if (window.hintCostBadge && document.getElementById('hint-cost-badge')) {
              const b = document.getElementById('hint-cost-badge');
              b.textContent = `-${Number(skillResult.cost) || 0} 🪙`;
            }
          } catch (e) {
            if (modalBody) modalBody.innerHTML = `<p>Definition not found for "${currentSelectedText}".</p>`;
          }
        }
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Attach when DOM is loaded or call immediately
  initDictionaryPeek();

  // ============================================
  // Auth State Synchronization
  // ============================================
  if (window.authUI && window.authUI.onAuthStateChanged) {
    window.authUI.onAuthStateChanged((userId) => {
      // Update progress panel for both modes
      updateProgressPanel('type');
      updateProgressPanel('speak');

      // Also refresh progress bars if visible
      const select = document.getElementById('question-select');
      if (select && select.value) {
        updateProgressBarUI(select.value, 'type', progressCache['type']?.[select.value]);
        updateProgressBarUI(select.value, 'speak', progressCache['speak']?.[select.value]);
      }

      // NEW: Refresh skill locks and hint badges when auth state changes
      if (typeof updateActiveSkillControlLocks === 'function') {
        updateActiveSkillControlLocks();
      }
      if (typeof updateHintCostBadge === 'function') {
        updateHintCostBadge();
      }
    });
  }

  // ============================================
  // Mobile Toolbar Button Handlers
  // Directly toggle panels instead of clicking hidden buttons
  // NOTE: Must defer attachment because toolbar HTML is at end of body
  // ============================================

  // Expose progress panel toggle function globally for mobile toolbar
  function toggleProgressPanel() {
    const isExpanded = progressPanelSide?.classList.contains('expanded');
    if (isExpanded) {
      closeProgressPanel();
    } else {
      openProgressPanel();
    }
  }
  window.toggleProgressPanel = toggleProgressPanel;

  // The progress modal lives outside this IIFE and re-renders the Question
  // Mastery tab through this hook (tab switch, Type/Speak toggle, auth change).
  // Without the export the call silently no-ops.
  window.updateProgressPanel = updateProgressPanel;

  // Defer mobile toolbar event listener attachment
  // The toolbar HTML is placed at the end of body, after script.js
  function setupMobileToolbar() {
    const mobileProgressBtn = document.getElementById('mobile-progress-btn');
    const mobileVocabBtn = document.getElementById('mobile-vocab-btn');
    const mobileAccountBtn = document.getElementById('mobile-account-btn');

    // Helper to trigger a click on a hidden element (robust fallback)
    const triggerDesktopToggle = (elementId) => {
      const btn = document.getElementById(elementId);
      if (btn) {
        // Dispatch a synthetic click event (works even on hidden elements)
        const event = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true
        });
        btn.dispatchEvent(event);
        return true;
      }
      return false;
    };

    if (mobileProgressBtn) {
      mobileProgressBtn.addEventListener('click', () => {
        // Progress panel is local, so direct function is best
        toggleProgressPanel();
      });
    }

    if (mobileVocabBtn) {
      mobileVocabBtn.addEventListener('click', () => {
        // First try triggering the desktop button listener (most robust)
        if (triggerDesktopToggle('vocab-panel-toggle')) return;

        // Fallback to global function
        if (window.VocabularyBook && window.VocabularyBook.togglePanel) {
          window.VocabularyBook.togglePanel();
        } else {
          log.error('Vocab panel toggle failed: Button not found and global function missing.');
        }
      });
    }

    if (mobileAccountBtn) {
      mobileAccountBtn.addEventListener('click', () => {
        // First try triggering the desktop button listener
        if (triggerDesktopToggle('account-panel-toggle')) return;

        // Fallback to global function
        if (window.authUI && window.authUI.toggleAccountPanel) {
          window.authUI.toggleAccountPanel();
        } else {
          log.error('Account panel toggle failed: Button not found and global function missing.');
        }
      });
    }
  }

  // --- Adaptive Difficulty Toggles ---
  function initAdaptiveToggles() {
    const modes = ['type', 'speak', 'extended'];

    window.updateAdaptiveUI = function (mode) {
      if (!window.DifficultyManager) return;
      if (!modes.includes(mode)) return;

      const isAdaptive = !!window.DifficultyManager?.getGlobalSettings?.()?.autoAdjustEnabled;

      const aRadio = document.getElementById(`adaptive-${mode}`);
      const mRadio = document.getElementById(`manual-${mode}`);
      if (aRadio) aRadio.checked = isAdaptive;
      if (mRadio) mRadio.checked = !isAdaptive;

      const calibIndicator = document.getElementById(`calibration-indicator-${mode}`);
      if (calibIndicator) {
        if (isAdaptive && !window.DifficultyManager.isCalibrated(mode)) {
          calibIndicator.style.display = 'block';
        } else {
          calibIndicator.style.display = 'none';
        }
      }

      refreshRecommendationUI(mode);
    };

    modes.forEach(mode => {
      const adaptiveRadio = document.getElementById(`adaptive-${mode}`);
      const manualRadio = document.getElementById(`manual-${mode}`);

      const handleToggle = (isAdaptive) => {
        if (!window.DifficultyManager) return;

        if (typeof window.DifficultyManager.setAutoAdjustEnabled === 'function') {
          window.DifficultyManager.setAutoAdjustEnabled(isAdaptive);
        } else {
          const settings = window.DifficultyManager?.getGlobalSettings?.();
          if (settings) settings.autoAdjustEnabled = isAdaptive;
          window.DifficultyManager.saveProfile?.();
        }

        modes.forEach(m => window.updateAdaptiveUI(m));

        if (typeof window.populateQuestionSelect === 'function') {
          window.populateQuestionSelect(mode);
        }
      };

      if (adaptiveRadio) adaptiveRadio.addEventListener('change', (e) => { if (e.target.checked) handleToggle(true); });
      if (manualRadio) manualRadio.addEventListener('change', (e) => { if (e.target.checked) handleToggle(false); });
    });

    modes.forEach(m => window.updateAdaptiveUI(m));
  }

  document.addEventListener('DOMContentLoaded', initAdaptiveToggles);

  // Setup immediately if DOM is already loaded, otherwise wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupMobileToolbar);
  } else {
    // DOM already loaded, but toolbar might still be parsing
    // Use requestAnimationFrame to ensure it's in the DOM
    requestAnimationFrame(setupMobileToolbar);
  }
})();
