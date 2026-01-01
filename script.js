(() => {
  // Database and question management
  let typeDatabase = [];
  let speakDatabase = [];
  let currentTypeQuestionId = 1;
  let currentSpeakQuestionId = 1;

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
        console.log(`✓ Loaded progress data for ${mode} mode:`, progressCache[mode]);
      } else {
        console.error(`Error loading progress for ${mode} mode:`, result.error);
        progressCache[mode] = {};
      }
    } catch (error) {
      console.error(`Error loading all progress for ${mode} mode:`, error);
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
      console.log("Loading sentence length database...");
      const response = await fetch('database/type/WFD.xlsx');

      if (!response.ok) {
        throw new Error(`Failed to fetch database file: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      // Use the SECOND sheet (index 1)
      const sheetName = workbook.SheetNames[1];
      if (!sheetName) {
        throw new Error('Second sheet not found in Excel file');
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

      console.log(`✓ Loaded sentence length data: ${sentenceLengthData.size} length ranges.`);
      sentenceLengthData.forEach((ids, range) => {
        console.log(`  - ${range}: ${ids.size} questions`);
      });

      // Refresh list to apply any active filters
      populateQuestionSelect('type');

    } catch (error) {
      console.error("Error loading sentence length database:", error);
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
      console.log("Loading speak length database...");
      const response = await fetch('database/speak/RS.xlsx');

      if (!response.ok) {
        throw new Error(`Failed to fetch speak database file: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      // Use the SECOND sheet (index 1)
      const sheetName = workbook.SheetNames[1];
      if (!sheetName) {
        throw new Error('Second sheet not found in RS.xlsx');
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

      console.log(`✓ Loaded speak length data: ${speakLengthData.size} length ranges.`);
      speakLengthData.forEach((ids, range) => {
        console.log(`  - ${range}: ${ids.size} questions`);
      });

      // Refresh list to apply any active filters
      populateQuestionSelect('speak');

    } catch (error) {
      console.error("Error loading speak length database:", error);
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
      console.log(`Filter by length "${lengthRange}" (${mode}): ${ids.size} questions found`);
      return ids;
    }

    console.log(`Filter by length "${lengthRange}" (${mode}): no questions found`);
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
    const progressFill = document.getElementById(`progress-bar-fill-${mode}`);
    const progressTarget = document.getElementById(`progress-target-${mode}`);
    const progressTierBadge = document.getElementById(`progress-tier-${mode}`);
    const resetBtn = document.getElementById(`reset-progress-${mode}-btn`);

    if (!progressBar) return;

    // Show progress bar for logged-in users
    const isLoggedIn = window.authUI && !window.authUI.isGuestMode?.() && window.authUI.getCurrentUserId?.();
    progressBar.style.display = isLoggedIn ? 'block' : 'none';

    if (!isLoggedIn) return;

    const perfectCount = progressData?.perfectCount || 0;
    const hasAttempted = progressData?.hasAttempted || false;
    const state = calculateState(hasAttempted, perfectCount);
    const percentage = getProgressPercentage(perfectCount);

    // Update progress fill
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
      progressFill.className = `progress-bar-fill state-${state}`;
    }

    // Update target label with progress description
    if (progressTarget) {
      progressTarget.textContent = getProgressDescription(hasAttempted, perfectCount);
    }

    // Update state badge
    if (progressTierBadge) {
      const stateLabels = {
        'not-started': 'Not Started',
        'in-progress': `In Progress (${perfectCount}/3)`,
        'completed': `✓ Completed (${perfectCount} total)`,
        'consolidated': `✓✓ Consolidated (${perfectCount} total)`,
        'mastered': `★ Mastered (${perfectCount} total)`
      };
      progressTierBadge.textContent = stateLabels[state] || 'Not Started';
      progressTierBadge.className = `progress-tier-badge state-${state}`;
    }

    // Show/hide reset button (show if any progress or attempts)
    if (resetBtn) {
      resetBtn.style.display = (perfectCount > 0 || hasAttempted) ? 'inline-block' : 'none';
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
    const progressPanelContent = document.getElementById('progress-panel-content');

    // Toggle guest mode class for blur effect
    if (progressPanelContent) {
      progressPanelContent.classList.toggle('guest-mode', !isLoggedIn);
    }

    if (guestNotice) {
      guestNotice.style.display = isLoggedIn ? 'none' : 'block';
    }

    // Get total questions for this mode
    const database = mode === 'type' ? typeDatabase : speakDatabase;
    const totalQuestions = database.length;

    if (!isLoggedIn) {
      // Reset counts for guests - all questions are "not started"
      updateTierCounts(0, 0, 0);
      updateDistribution({ notStarted: totalQuestions, inProgress: 0, completed: 0, consolidated: 0, mastered: 0 }, totalQuestions);
      return;
    }

    // Update mode label
    const modeLabel = document.getElementById('progress-mode-label');
    if (modeLabel) {
      modeLabel.textContent = mode === 'type' ? 'Type Mode' : 'Speak Mode';
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
    updateTierCounts(completedCount, consolidatedCount, masteredCount);

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
  function updateTierCounts(completed, consolidated, mastered) {
    const completedEl = document.getElementById('completed-count');
    const consolidatedEl = document.getElementById('consolidated-count');
    const masteredEl = document.getElementById('mastered-count');

    if (completedEl) completedEl.textContent = completed;
    if (consolidatedEl) consolidatedEl.textContent = consolidated;
    if (masteredEl) masteredEl.textContent = mastered;
  }

  /**
   * Update distribution UI (bar and pie chart)
   * 
   * @param {Object} stateCounts - { notStarted, inProgress, completed, consolidated, mastered }
   * @param {number} total - Total number of questions
   */
  function updateDistribution(stateCounts, total) {
    updateTierDistributionBar(stateCounts, total);
    updateDistributionPieChart(stateCounts, total);
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
  }

  /**
   * Update distribution pie chart
   * Renders SVG pie chart with all 5 states
   * 
   * @param {Object} stateCounts - { notStarted, inProgress, completed, consolidated, mastered }
   * @param {number} total - Total number of questions
   */
  function updateDistributionPieChart(stateCounts, total) {
    const pieSvg = document.getElementById('distribution-pie');
    const pieTotalCount = document.getElementById('pie-total-count');

    if (!pieSvg) return;

    // Update total count in center
    if (pieTotalCount) {
      pieTotalCount.textContent = total;
    }

    // Define colors for each state
    const stateColors = {
      notStarted: '#6b7280',
      inProgress: '#7c3aed',
      completed: '#f59e0b',
      consolidated: '#3b82f6',
      mastered: '#22c55e'
    };

    // State order for rendering (reversed so mastered is on top visually)
    const stateOrder = ['notStarted', 'inProgress', 'completed', 'consolidated', 'mastered'];

    // Calculate percentages and update legend
    const percentages = {};
    stateOrder.forEach(state => {
      const count = stateCounts[state] || 0;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      percentages[state] = pct;

      // Update legend
      const legendEl = document.getElementById(`pie-legend-${state.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
      if (legendEl) {
        legendEl.textContent = `${pct}% (${count})`;
      }
    });

    // Generate SVG paths for pie chart
    // Using stroke-dasharray technique for donut chart
    const radius = 40;
    const circumference = 2 * Math.PI * radius;

    // Clear existing paths
    pieSvg.innerHTML = '';

    // Add background circle
    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', '50');
    bgCircle.setAttribute('cy', '50');
    bgCircle.setAttribute('r', String(radius));
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', '#e5e7eb');
    bgCircle.setAttribute('stroke-width', '20');
    pieSvg.appendChild(bgCircle);

    // Calculate cumulative offset for each segment
    let cumulativePercent = 0;

    // Render segments in order
    stateOrder.forEach(state => {
      const count = stateCounts[state] || 0;
      if (count === 0) return;

      const percent = (count / total) * 100;
      const dashLength = (percent / 100) * circumference;
      const dashOffset = (cumulativePercent / 100) * circumference;

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '50');
      circle.setAttribute('cy', '50');
      circle.setAttribute('r', String(radius));
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', stateColors[state]);
      circle.setAttribute('stroke-width', '20');
      circle.setAttribute('stroke-dasharray', `${dashLength} ${circumference}`);
      circle.setAttribute('stroke-dashoffset', String(-dashOffset));
      circle.style.transition = 'stroke-dasharray 0.4s ease, stroke-dashoffset 0.4s ease';

      pieSvg.appendChild(circle);

      cumulativePercent += percent;
    });

    // Add center circle (white) to create donut effect
    const centerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    centerCircle.setAttribute('cx', '50');
    centerCircle.setAttribute('cy', '50');
    centerCircle.setAttribute('r', '30');
    centerCircle.setAttribute('fill', '#ffffff');
    pieSvg.appendChild(centerCircle);
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
      console.error('Error loading recent progress:', error);
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
      console.error('Invalid mode for loadProgressStatus:', mode);
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
      console.error('Error loading progress status:', error);
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
    if (!confirm(`Are you sure you want to remove the mastered status for this question in ${modeName} mode?`)) {
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
      console.error('Error removing mastery status:', error);
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
      // Record the practice attempt
      await window.firebaseFirestoreFunctions.recordPracticeAttempt(userId, questionId, isCorrect, mode);

      // -----------------------------------------------------
      // POINTS SYSTEM INTEGRATION
      // -----------------------------------------------------

      // 1. First Light (Daily Practice) - Awarded on FIRST attempt of the day
      // Uses "daily" deduplication to ensure it only happens once per day
      const firstLightResult = await window.firebaseFirestoreFunctions.awardPoints('First Light', {
        preventDuplicate: 'daily',
        customDescription: 'First practice of the day!'
      });
      if (firstLightResult && firstLightResult.pointsAwarded) {
        window.authUI.showPointsToast(firstLightResult.ruleTitle, firstLightResult.pointsAwarded);
      }

      // 2. Perfect Score Points
      // 2. Perfect Score Points - NOW HANDLED IN PROGRESS UPDATE (below)
      // to ensure it only awards on the FIRST time 100% accuracy is reached.
      // -----------------------------------------------------

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

            // Check for Level Up Bonuses (Tier Reached)
            const pc = result.progress.perfectCount;

            // 1. First Time Perfect Score (Reach 1 perfect)
            if (pc === 1) {
              if (mode === 'type') {
                const typeResult = await window.firebaseFirestoreFunctions.awardPoints('Perfect Dictation', {
                  preventDuplicate: 'once',
                  context: `q${questionId}_perfect_v2`, // v2 to reset history for this new logic if needed, or just standard unique key
                  customDescription: `First perfect dictation on Q${questionId}`
                });
                if (typeResult && typeResult.pointsAwarded) {
                  window.authUI.showPointsToast(typeResult.ruleTitle, typeResult.pointsAwarded);
                }
              } else if (mode === 'speak') {
                const speakResult = await window.firebaseFirestoreFunctions.awardPoints('Perfect Repetition', {
                  preventDuplicate: 'once',
                  context: `q${questionId}_perfect_v2`,
                  customDescription: `First perfect repetition on Q${questionId}`
                });
                if (speakResult && speakResult.pointsAwarded) {
                  window.authUI.showPointsToast(speakResult.ruleTitle, speakResult.pointsAwarded);
                }
              }
            }

            // Level Up: Completed (Reach 3 perfects)
            if (pc === 3) {
              const luResult = await window.firebaseFirestoreFunctions.awardPoints('Level Up: Completed', {
                preventDuplicate: 'once',
                context: `${mode}_${questionId}_completed`, // Unique per question per mode
                customDescription: `Reached Completed tier on Q${questionId}`
              });
              if (luResult && luResult.pointsAwarded) {
                window.authUI.showPointsToast(luResult.ruleTitle, luResult.pointsAwarded);
              }
            }

            // Level Up: Consolidated (Reach 6 perfects)
            else if (pc === 6) {
              const luResult = await window.firebaseFirestoreFunctions.awardPoints('Level Up: Consolidated', {
                preventDuplicate: 'once',
                context: `${mode}_${questionId}_consolidated`,
                customDescription: `Reached Consolidated tier on Q${questionId}`
              });
              if (luResult && luResult.pointsAwarded) {
                window.authUI.showPointsToast(luResult.ruleTitle, luResult.pointsAwarded);
              }
            }

            // Level Up: Mastered (Reach 9 perfects)
            else if (pc === 9) {
              const luResult = await window.firebaseFirestoreFunctions.awardPoints('Level Up: Mastered', {
                preventDuplicate: 'once',
                context: `${mode}_${questionId}_mastered`,
                customDescription: `Mastered Q${questionId}!`
              });
              if (luResult && luResult.pointsAwarded) {
                window.authUI.showPointsToast(luResult.ruleTitle, luResult.pointsAwarded);
              }
            }
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
      console.error('Error recording practice attempt:', error);
      // Don't show error to user, just log it
    }
  }

  const audio = document.getElementById("audio");
  const questionSelectType = document.getElementById("question-select-type");
  const questionSelectSpeak = document.getElementById("question-select-speak");
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
  const modeType = document.getElementById("mode-type");
  const modeSpeak = document.getElementById("mode-speak");
  const modeExtended = document.getElementById("mode-extended");

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
  // Type mode generate panel
  const generatePanelType = document.getElementById("generate-sentences-type");
  const generateBtnType = document.getElementById("generate-type-btn");
  const showAllSentencesBtnType = document.getElementById("show-all-sentences-type-btn");
  const hideAllSentencesBtnType = document.getElementById("hide-all-sentences-type-btn");
  const generatedSentencesType = document.getElementById("generated-sentences-type");

  // Speak mode generate panel
  const generatePanelSpeak = document.getElementById("generate-sentences-speak");
  const generateBtnSpeak = document.getElementById("generate-speak-btn");
  const showAllSentencesBtnSpeak = document.getElementById("show-all-sentences-speak-btn");
  const hideAllSentencesBtnSpeak = document.getElementById("hide-all-sentences-speak-btn");
  const generatedSentencesSpeak = document.getElementById("generated-sentences-speak");

  /**
   * Reset all scaffolding features (below the input) for the current mode
   * Called when a new question is selected or the Retry button is pressed
   */
  function resetScaffolding() {
    console.log("Resetting scaffolding...");

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
    if (generatedSentencesType) generatedSentencesType.innerHTML = "";
    if (generatePanelType) generatePanelType.style.display = "none";

    // 4. Clear pronunciation practice
    if (pronunciationPanel) pronunciationPanel.style.display = "none";
    if (breakdownPanel) breakdownPanel.style.display = "none";
    if (generatedSentencesSpeak) generatedSentencesSpeak.innerHTML = "";
    if (generatePanelSpeak) generatePanelSpeak.style.display = "none";

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

    // Reset internal state variables
    lastDiffType = [];
    lastDiffSpeak = [];
    vocabularyPracticeWordsType = [];
    vocabularyPracticeWordsSpeak = [];
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

      console.error("Speech recognition error:", event.error);
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
              console.log("Restarting recognition...");
              recognition.start();
            } catch (e) {
              // Already started or error - check if it's a real error
              if (e.name !== "InvalidStateError" && !e.message.includes("already started")) {
                console.error("Failed to restart recognition:", e);
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
      console.error("Animation box element not found");
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
    tabType.classList.add("active");
    tabSpeak.classList.remove("active");
    tabExtended.classList.remove("active");
    modeType.classList.add("active");
    modeSpeak.classList.remove("active");
    modeExtended.classList.remove("active");

    // Hide Speak mode panels
    pronunciationPanel.style.display = "none";
    breakdownPanel.style.display = "none";
    generatePanelSpeak.style.display = "none";
    sameVocabPanelSpeak.style.display = "none";

    // Hide shared panels (will be shown when Check is pressed in Type mode)
    animationPanel.style.display = "none";
    result.style.display = "none";
    generatePanelType.style.display = "none";
    vocabularyPanel.style.display = "none";

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
  });

  tabSpeak.addEventListener("click", async () => {
    tabSpeak.classList.add("active");
    tabType.classList.remove("active");
    tabExtended.classList.remove("active");
    modeSpeak.classList.add("active");
    modeType.classList.remove("active");
    modeExtended.classList.remove("active");

    // Hide Type mode panels
    generatePanelType.style.display = "none";
    sameVocabPanelType.style.display = "none";

    // Hide shared panels (will be shown when Check is pressed in Speak mode)
    animationPanel.style.display = "none";
    result.style.display = "none";
    generatePanelSpeak.style.display = "none";

    // Reload the correct audio for Speak mode
    if (speakDatabase.length > 0 && currentSpeakQuestionId) {
      // Load all progress data for Speak mode (to update dropdown)
      await loadAllProgressForMode("speak");
      await loadQuestion("speak", currentSpeakQuestionId);
      // Load progress status for Speak mode (independent from Type mode)
      await loadProgressStatus(currentSpeakQuestionId, "speak");
      // Update progress panel for Speak mode
      await updateProgressPanel("speak");
    }

    // Microphone access will be requested when user clicks "Start Recording"
  });

  tabExtended.addEventListener("click", () => {
    tabExtended.classList.add("active");
    tabType.classList.remove("active");
    tabSpeak.classList.remove("active");
    modeExtended.classList.add("active");
    modeType.classList.remove("active");
    modeSpeak.classList.remove("active");

    // Hide all other mode panels
    animationPanel.style.display = "none";
    result.style.display = "none";
    generatePanelType.style.display = "none";
    generatePanelSpeak.style.display = "none";
    sameVocabPanelType.style.display = "none";
    sameVocabPanelSpeak.style.display = "none";
    vocabularyPanel.style.display = "none";
    pronunciationPanel.style.display = "none";
    breakdownPanel.style.display = "none";

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
  });

  // Extended Listening mode elements
  let extendedDatabase = [];
  let currentExtendedQuestionId = 1;
  let extendedCorrectTranscript = "";
  let extendedGappedTranscript = "";
  let extendedGapAnswers = {}; // Store user answers for gaps
  let readingTimer = null;
  let readingTimeLeft = 30;

  const questionSelectExtended = document.getElementById("question-select-extended");
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
    const cleanWord = word.replace(/[.,!?;:()\[\]{}'"]/g, '').trim();
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
      if (/^[.,!?;:()\[\]{}'"]+$/.test(trimmed)) {
        return word; // Return punctuation as-is
      }
      // Make word clickable
      const cleanWord = trimmed.replace(/[.,!?;:()\[\]{}'"]/g, '');
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
    while (node = walker.nextNode()) {
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
        if (/^[.,!?;:()\[\]{}'"]+$/.test(trimmed)) {
          fragment.appendChild(document.createTextNode(word));
          return;
        }
        // Make word clickable
        const cleanWord = trimmed.replace(/[.,!?;:()\[\]{}'"]/g, '');
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
      console.error('compromise library not loaded. Available globals:', Object.keys(window).filter(k => k.includes('nlp') || k.includes('compromise')));
      return [];
    }

    const doc = nlpFunction(sentence);
    const rawNounPhrases = doc.nouns().out('array');

    console.log(`[extractNounPhrases] Sentence: "${sentence}"`);
    console.log(`[extractNounPhrases] Raw noun phrases from compromise:`, rawNounPhrases);
    console.log(`[extractNounPhrases] Requested phrase length:`, phraseLength);

    const results = [];

    rawNounPhrases.forEach((np, npIdx) => {
      // Remove punctuation
      const clean = np.replace(/[.,!?;:]/g, '').trim();
      const words = clean.split(/\s+/).filter(w => w && w.length > 0);

      console.log(`[extractNounPhrases] NP ${npIdx + 1}: "${np}" -> "${clean}" (${words.length} words)`);

      // Skip if NP too short
      if (words.length < phraseLength) {
        console.log(`[extractNounPhrases] NP ${npIdx + 1} too short, skipping`);
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
          console.log(`[extractNounPhrases] Rejected: contains hyphen or punctuation "${candidate.join(' ')}"`);
          continue;
        }

        const firstWord = candidate[0].toLowerCase();
        const lastWord = candidate[candidate.length - 1].toLowerCase();

        console.log(`[extractNounPhrases] Testing candidate: "${candidate.join(' ')}" (first: "${firstWord}", last: "${lastWord}")`);

        // Reject determiners at start
        if (['the', 'a', 'an', 'this', 'that', 'these', 'those'].includes(firstWord)) {
          console.log(`[extractNounPhrases] Rejected: starts with determiner "${firstWord}"`);
          continue;
        }

        // Reject function words at end
        if (['the', 'a', 'an', 'that', 'which', 'they', 'it'].includes(lastWord)) {
          console.log(`[extractNounPhrases] Rejected: ends with function word "${lastWord}"`);
          continue;
        }

        const core = candidate.join(' ');
        console.log(`[extractNounPhrases] ✓ Accepted core: "${core}"`);
        results.push(core);
        foundCore = true;
        break; // only one core per noun phrase
      }

      if (!foundCore) {
        console.log(`[extractNounPhrases] No valid core found for NP ${npIdx + 1}`);
      }
    });

    // Remove duplicates
    const uniqueResults = [...new Set(results)];
    console.log(`[extractNounPhrases] Final results (${uniqueResults.length} unique):`, uniqueResults);
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

      console.log(`Sentence ${sentenceIdx + 1}: "${sentence}"`);
      console.log(`Extracted noun phrases:`, nounPhrases);

      // If array is empty → NO BLANK
      if (nounPhrases.length === 0 || words.length < phraseLength) {
        console.log(`Sentence ${sentenceIdx + 1} has no valid noun phrases, rendering without blank`);
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
      console.log(`[generatePhraseGaps] Looking for phrase: "${selectedPhrase}" (cleaned: "${cleanPhrase}")`);
      console.log(`[generatePhraseGaps] Sentence words:`, words);

      let foundIndex = -1;
      for (let i = 0; i <= words.length - phraseLength; i++) {
        const candidateWords = words.slice(i, i + phraseLength);
        const candidateText = candidateWords
          .map(w => w.replace(/[.,!?;:]/g, '').toLowerCase().trim())
          .join(' ')
          .trim();

        console.log(`[generatePhraseGaps] Position ${i}: candidate "${candidateText}" vs target "${cleanPhrase}"`);

        if (candidateText === cleanPhrase) {
          // Check minimum distance from last gap
          const phraseStartPosition = totalWordCount + i;
          const positionFromLastGap = phraseStartPosition - lastGapEndPosition;

          console.log(`[generatePhraseGaps] Match found at position ${i}, distance from last gap: ${positionFromLastGap}`);

          if (positionFromLastGap >= 5) {
            foundIndex = i;
            console.log(`[generatePhraseGaps] ✓ Valid match at position ${i}`);
            break;
          } else {
            console.log(`[generatePhraseGaps] ✗ Too close to last gap (${positionFromLastGap} < 5)`);
          }
        }
      }

      if (foundIndex === -1) {
        console.log(`[generatePhraseGaps] ✗ Phrase "${selectedPhrase}" not found in sentence or too close to last gap`);
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
        console.log(`Selected phrase "${selectedPhrase}" not found or too close to last gap, rendering without blank`);
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
    const question = extendedDatabase.find(q => q.id === questionId);
    if (!question) {
      console.error(`Question ${questionId} not found`);
      return;
    }

    currentExtendedQuestionId = questionId;
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
      console.warn('Cannot display transcript:', {
        fullTranscript: !!fullTranscript,
        transcriptText: extendedCorrectTranscript ? extendedCorrectTranscript.substring(0, 50) + '...' : 'empty'
      });
    }

    if (readingTimer) {
      clearInterval(readingTimer);
      readingTimer = null;
    }

    startReadingTimer();
    await loadExtendedAudio(question.audioFile);
  };

  // Load Extended Listening audio
  const loadExtendedAudio = async (audioFile) => {
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
      console.log(`[loadExtendedAudio] Checking ${testPath}: ${exists ? 'EXISTS' : 'NOT FOUND'}`);

      if (exists) {
        foundFile = testFile;
        console.log(`[loadExtendedAudio] ✓ Found file: ${foundFile} (tried ${i + 1} of ${tryExtensions.length} extensions)`);
        break;
      }
    }

    if (!foundFile) {
      const errorMsg = `No audio file found for question ${currentExtendedQuestionId}. Tried: ${tryExtensions.map(ext => `${baseFilename}.${ext}`).join(', ')}`;
      console.error(`[loadExtendedAudio] ${errorMsg}`);
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
      readingTimeLeft--;
      readingTimerDisplay.textContent = readingTimeLeft;

      if (readingTimeLeft <= 0) {
        clearInterval(readingTimer);
        readingTimer = null;
        startListeningPhase();
      }
    }, 1000);
  };

  // Skip reading time
  skipReadingBtn.addEventListener("click", () => {
    if (readingTimer) {
      clearInterval(readingTimer);
      readingTimer = null;
    }
    startListeningPhase();
  });

  // Start listening phase with gapped transcript
  const startListeningPhase = () => {
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
      console.error('Error generating phrase gaps:', error);
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
        console.error("Error playing audio:", error);
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
        console.error("Error playing phrases audio:", error);
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

    gapInputs.forEach(input => {
      const userAnswer = input.value.trim().toLowerCase();
      const correctAnswer = input.dataset.correct.toLowerCase();
      const correctAnswerDisplay = input.dataset.correct; // Keep original case for display
      const userAnswerDisplay = input.value.trim(); // Keep original case for display

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

      if (userAnswer === correctAnswer) {
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
    checkResultExtended.textContent = `You got ${correctCount} out of ${totalGaps} gaps correct!`;
    checkResultExtended.style.display = 'block';

    // Record practice attempt for extended listening (single words)
    // Consider correct if all gaps are correct
    const isFullyCorrect = correctCount === totalGaps && totalGaps > 0;
    recordPracticeAttempt(currentExtendedQuestionId || 'extended', isFullyCorrect, 'extended');

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
        window.VocabularyBook.showAddModal(missedWords, currentExtendedQuestionId || 'extended', 'fill');
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
          console.error('Error generating phrase gaps:', error);
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

    phraseInputs.forEach(input => {
      const userAnswer = input.value.trim().toLowerCase();
      const correctAnswer = input.dataset.correct.toLowerCase();
      const correctAnswerDisplay = input.dataset.correct; // Keep original case for display
      const userAnswerDisplay = input.value.trim(); // Keep original case for display

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

      if (userAnswer === correctAnswer) {
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
    checkResultPhrases.textContent = `You got ${correctCount} out of ${totalPhrases} phrases correct!`;
    checkResultPhrases.style.display = 'block';

    // Record practice attempt for phrases
    // Consider correct if all phrases are correct
    const isFullyCorrect = correctCount === totalPhrases && totalPhrases > 0;
    recordPracticeAttempt(currentExtendedQuestionId || 'extended', isFullyCorrect, 'phrases');
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
      console.error('Error regenerating phrase gaps:', error);
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
          console.log(`[checkFileExists] ✓ Valid audio file: ${url} (Content-Type: ${contentType})`);
          return true;
        } else {
          console.log(`[checkFileExists] ✗ Not an audio file: ${url} (Status: ${status}, Content-Type: ${contentType || 'none'})`);
          return false;
        }
      } else {
        console.log(`[checkFileExists] ✗ Request failed: ${url} (Status: ${status})`);
        return false;
      }
    } catch (e) {
      console.log(`[checkFileExists] ✗ Error checking ${url}:`, e.message);
      return false;
    }
  };

  // Play audio for same vocabulary question
  const playSameVocabAudio = async (questionId, mode, btn) => {
    console.log(`playSameVocabAudio called: questionId=${questionId}, mode=${mode}`);

    const database = mode === "type" ? typeDatabase : speakDatabase;
    const question = database.find(item => item.id === questionId);

    if (!question) {
      console.error(`Question ${questionId} not found in ${mode} database`);
      console.log(`Database length: ${database.length}`);
      console.log(`First 10 IDs in ${mode} database:`, database.slice(0, 10).map(q => q.id));
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

      console.log(`Checking if file exists: ${testFile}`);
      const exists = await checkFileExists(testPath);

      if (exists) {
        foundFile = testFile;
        foundIndex = checkIndex;
        console.log(`Found file: ${foundFile}`);
        break;
      }
    }

    if (!foundFile) {
      console.warn(`No audio file found for question ${questionId}. Tried all extensions.`);
      return;
    }

    const audioPath = `database/${mode}/audio/${foundFile}?t=${Date.now()}`;
    const mimeType = getAudioMimeType(foundFile);

    console.log(`Playing audio: ${audioPath} (MIME type: ${mimeType})`);

    // Use dedicated vocab-audio element to avoid overwriting main question audio
    const vocabAudio = document.getElementById("vocab-audio");

    if (!vocabAudio) {
      console.error("Vocab audio element not found");
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
      console.error("Error playing audio:", err);
    });
  };

  // Start recording for same vocabulary question (Speak mode)
  const startSameVocabRecording = (sentenceId, btn) => {
    console.log("startSameVocabRecording called:", { sentenceId, btnText: btn.textContent });

    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in your browser.");
      return;
    }

    const transcriptionEl = document.getElementById(`transcription-${sentenceId}`);
    if (!transcriptionEl) {
      console.error(`Transcription element not found: transcription-${sentenceId}`);
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
        console.log("Error stopping main recognition:", e);
      }
    }

    // Stop any existing recognition for this item
    if (sameVocabRecognitions[sentenceId]) {
      try {
        sameVocabRecognitions[sentenceId].stop();
        delete sameVocabRecognitions[sentenceId];
      } catch (e) {
        console.log("Error stopping existing recognition:", e);
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
        console.log(`Recognition started for ${sentenceId}`);
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
        console.error(`Recognition error for ${sentenceId}:`, event.error);
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
        console.log(`Recognition ended for ${sentenceId}`);
        // Auto-restart if still in recording state
        if (btn.textContent === "Stop Recording") {
          try {
            console.log(`Auto-restarting recognition for ${sentenceId}`);
            itemRecognition.start();
          } catch (e) {
            console.error("Failed to auto-restart recognition:", e);
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
        console.log(`Starting recognition for ${sentenceId}`);
        itemRecognition.start();
      } catch (e) {
        console.error("Failed to start recognition:", e);
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
          console.log("Error stopping recognition:", e);
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

    if (contentWords.length === 0) {
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
        <input type="text" class="vocabulary-input" id="vocab-input-${idx}" placeholder="Press Play to listen to the word before typing" disabled />
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
      console.error("Failed to start word recognition:", e);
      btn.textContent = "Record";
      btn.classList.remove("recording");
      statusEl.textContent = "Failed to start recording";
      statusEl.style.color = "#b91c1c";
      wordRecognition = null;
      currentWordIndex = -1;
    }
  };

  // Type mode check function
  const performCheckType = (userAnswer, scoreElement) => {
    const diff = diffWords(userAnswer, correctSentenceType);
    const hasErrors = diff.some((p) => p.type !== "match");
    const scoreValue = diff.filter((p) => p.type === "match").length;

    if (!userAnswer.trim()) {
      result.innerHTML = `<span class="errors">Please provide your answer before checking.</span>`;
      scoreElement.textContent = `Points: 0 / ${getCorrectWordCount()}`;
      return;
    }

    // Record practice attempt (correct if no errors)
    recordPracticeAttempt(currentTypeQuestionId, !hasErrors, 'type');

    scoreElement.textContent = `Points: ${scoreValue} / ${getCorrectWordCount()}`;

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
      generatePanelType.style.display = "block";
    } else {
      sameVocabPanelType.style.display = "none";
      generatePanelType.style.display = "none";
    }

    // Show animation panel and result box for Type mode
    animationPanel.style.display = "block";
    result.style.display = "block";

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
      if (hasErrors && scoreValue < getCorrectWordCount("type")) {
        audio.currentTime = 0;
        audio.play();
      }

      // Vocabulary Book tracking
      if (window.VocabularyBook) {
        const missedWords = getMissedWords(diff);
        const matchedWords = diff.filter(p => p.type === 'match').map(p => p.text);

        // Track missed words immediately when Check is pressed
        missedWords.forEach(word => window.VocabularyBook.trackMissedWord(word, 'type', currentTypeQuestionId));

        // Track correct words (for mastery tracking)
        matchedWords.forEach(word => window.VocabularyBook.trackCorrectWord(word));

        // Show add to vocabulary modal if there are missed words
        if (missedWords.length > 0) {
          const contentWords = filterContentWords(missedWords);
          if (contentWords.length > 0) {
            window.VocabularyBook.showAddModal(contentWords, currentTypeQuestionId, 'type');
          }
        }
      }
    }, false);
  };

  // Speak mode check function
  const performCheckSpeak = (userAnswer, scoreElement) => {
    const diff = diffWords(userAnswer, correctSentenceSpeak);
    const hasErrors = diff.some((p) => p.type !== "match");
    const scoreValue = diff.filter((p) => p.type === "match").length;

    if (!userAnswer.trim()) {
      result.innerHTML = `<span class="errors">Please provide your answer before checking.</span>`;
      scoreElement.textContent = `Points: 0 / ${getCorrectWordCount()}`;
      return;
    }

    // Record practice attempt (correct if no errors)
    recordPracticeAttempt(currentSpeakQuestionId, !hasErrors, 'speak');

    scoreElement.textContent = `Points: ${scoreValue} / ${getCorrectWordCount()}`;

    // Show pronunciation practice and breakdown mode for speak mode
    const missedWords = getMissedWords(diff);
    renderPronunciationPractice(missedWords);
    renderBreakdownMode();

    // Store diff for sentence generation (Speak mode)
    lastDiffSpeak = diff;

    // Show same vocabulary panel and generate panel immediately after check (if there are errors)
    if (hasErrors) {
      renderSameVocabularySpeak();
      generatePanelSpeak.style.display = "block";
    } else {
      sameVocabPanelSpeak.style.display = "none";
      generatePanelSpeak.style.display = "none";
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
      if (hasErrors && scoreValue < getCorrectWordCount("speak")) {
        audio.currentTime = 0;
        audio.play();
      }

      // Vocabulary Book tracking
      if (window.VocabularyBook) {
        const matchedWords = diff.filter(p => p.type === 'match').map(p => p.text);

        // Track missed words immediately when Check is pressed
        missedWords.forEach(word => window.VocabularyBook.trackMissedWord(word, 'speak', currentSpeakQuestionId));

        // Track correct words (for mastery tracking)
        matchedWords.forEach(word => window.VocabularyBook.trackCorrectWord(word));

        // Show add to vocabulary modal if there are missed words
        if (missedWords.length > 0) {
          const contentWords = filterContentWords(missedWords);
          if (contentWords.length > 0) {
            window.VocabularyBook.showAddModal(contentWords, currentSpeakQuestionId, 'speak');
          }
        }
      }
    }, true);
  };

  let lastDiffType = [];
  let lastDiffSpeak = [];

  // Database loading functions
  const loadDatabase = async (mode) => {
    try {
      const response = await fetch(`database/${mode}/index.json`);
      if (!response.ok) {
        throw new Error(`Failed to load ${mode} database: ${response.statusText}`);
      }
      const data = await response.json();
      return data.items || [];
    } catch (error) {
      console.error(`Error loading ${mode} database:`, error);
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
    const database = mode === "type" ? typeDatabase : speakDatabase;
    const question = database.find(item => item.id === questionId);

    if (!question) {
      console.error(`Question ${questionId} not found in ${mode} database`);
      return false;
    }

    // Update correct sentence based on mode
    if (mode === "type") {
      correctSentenceType = question.correctSentence;
    } else {
      correctSentenceSpeak = question.correctSentence;
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

      const exists = await checkFileExists(testPath);

      if (exists) {
        foundFile = testFile;
        console.log(`[loadQuestion] Found file: ${foundFile} (database said: ${question.audioFile})`);
        break;
      }
    }

    if (!foundFile) {
      console.warn(`[loadQuestion] No audio file found for question ${questionId}. Tried all extensions.`);
      // Still try to load with database filename as fallback
      foundFile = question.audioFile || `${baseFilename}.mp3`;
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

    // Reset UI state to initial
    if (mode === "type") {
      if (checkBtn) checkBtn.style.display = "none";
      if (retryBtn) retryBtn.style.display = "none";
      if (input) input.disabled = true;
    } else {
      if (checkBtnSpeak) checkBtnSpeak.style.display = "none";
      if (retryBtnSpeak) retryBtnSpeak.style.display = "none";
      if (recordBtn) recordBtn.style.display = "inline-block";
    }

    // Reset scores and hide panels
    resetScaffolding();

    // Load mastery status for this question (logged-in users only)
    // Pass the mode so mastery status is shown for the correct mode
    await loadMasteryStatus(questionId, mode);

    return true;
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

      select.innerHTML = "";
      database.forEach(item => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.id.toString();
        select.appendChild(option);
      });

      currentIdDisplay.textContent = currentExtendedQuestionId;
      totalDisplay.textContent = database.length;
      select.value = currentExtendedQuestionId;
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

      // Get progress cache for this mode
      const modeProgressCache = progressCache[mode] || {};

      select.innerHTML = "";
      let visibleCount = 0;

      // Filter and render questions based on filters
      database.forEach(item => {
        const questionId = item.id;
        const progress = modeProgressCache[questionId] || { perfectCount: 0, hasAttempted: false };
        const hasAttempted = progress.hasAttempted || false;
        const perfectCount = progress.perfectCount || 0;
        const tier = calculateTier(perfectCount); // Using calculated tier for consistency
        const state = calculateState(hasAttempted, perfectCount);

        // 1. Status Filter
        let shouldShow = false;
        if (state === 'not-started' && filterNotStarted) shouldShow = true;
        else if (state === 'in-progress' && filterInProgress) shouldShow = true;
        else if (state === 'completed' && filterCompleted) shouldShow = true;
        else if (state === 'consolidated' && filterConsolidated) shouldShow = true;
        else if (state === 'mastered' && filterMastered) shouldShow = true;

        // 2. Length Filter (Type mode only)
        if (shouldShow && lengthContainer && lengthContainer.style.display !== 'none' && lengthValue !== 'all') {
          // If data hasn't loaded (validLengthIds is null), hide everything
          if (validLengthIds === null) {
            shouldShow = false;
          } else if (!validLengthIds.has(questionId)) {
            shouldShow = false;
          }
        }

        // Don't force currentId to show if it doesn't match filters

        if (!shouldShow) {
          return; // Skip this question based on filter
        }

        visibleCount++;

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
      const hasFilters = !filterNotStarted || !filterInProgress || !filterCompleted || !filterConsolidated || !filterMastered || (validLengthIds !== null);
      totalDisplay.textContent = hasFilters ? `${visibleCount} (${database.length} total)` : database.length;

      // Set selected value (ensure current question is selected)
      select.value = currentId;

      // Make sure selected question exists in dropdown
      const existingOption = select.querySelector(`option[value="${currentId}"]`);
      if (!existingOption) {
        // Check if length filter is active - if so, don't force add a non-matching question
        const isLengthFilterActive = lengthContainer && lengthContainer.style.display !== 'none' && lengthValue !== 'all';
        const currentIdMatchesLengthFilter = !isLengthFilterActive || (validLengthIds && validLengthIds.has(currentId));

        if (currentIdMatchesLengthFilter) {
          // Add current question if it was filtered out by status (but matches length filter)
          const progress = modeProgressCache[currentId] || { perfectCount: 0, hasAttempted: false };
          const hasAttempted = progress.hasAttempted || false;
          const perfectCount = progress.perfectCount || 0;
          const state = calculateState(hasAttempted, perfectCount);
          const stateIndicators = {
            'not-started': '',
            'in-progress': ' ◐ (In Progress)',
            'completed': ' ✓ (Completed)',
            'consolidated': ' ✓✓ (Consolidated)',
            'mastered': ' ★ (Mastered)'
          };

          const option = document.createElement("option");
          option.value = currentId;
          option.textContent = `${currentId}${stateIndicators[state] || ''}`;
          option.classList.add(`state-${state}`);
          select.appendChild(option);
          select.value = currentId;
        } else if (select.options.length > 0) {
          // Length filter is active and current question doesn't match - select first available
          select.selectedIndex = 0;
          const firstValue = parseInt(select.options[0].value, 10);
          if (mode === 'type') {
            currentTypeQuestionId = firstValue;
            loadQuestion('type', firstValue);
          } else {
            currentSpeakQuestionId = firstValue;
            loadQuestion('speak', firstValue);
          }
        }
      }
    }

  };

  // Initialize databases
  const initializeDatabases = async () => {
    typeDatabase = await loadDatabase("type");
    speakDatabase = await loadDatabase("speak");
    extendedDatabase = await loadDatabase("extended");

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
    if (extendedDatabase.length > 0) {
      currentExtendedQuestionId = 1;
      loadExtendedQuestion(1);
    }

    // Update progress bar for initial question
    const typeProgress = progressCache.type?.[1] || { perfectCount: 0, tier: 'none' };
    updateProgressBarUI(1, 'type', typeProgress);

    // Update left panel for Type mode (default active tab)
    await updateProgressPanel('type');
  };

  // Question selector event listeners
  questionSelectType.addEventListener("change", (e) => {
    const questionId = parseInt(e.target.value, 10);
    if (questionId && loadQuestion("type", questionId)) {
      currentTypeQuestionId = questionId;
      currentQuestionIdType.textContent = questionId;
    }
  });

  questionSelectSpeak.addEventListener("change", (e) => {
    const questionId = parseInt(e.target.value, 10);
    if (questionId && loadQuestion("speak", questionId)) {
      currentSpeakQuestionId = questionId;
      currentQuestionIdSpeak.textContent = questionId;
    }
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
    if (progressPanelSide) {
      progressPanelSide.classList.add('expanded');
    }
    if (progressPanelOverlay) {
      progressPanelOverlay.classList.add('active');
    }
  }

  /**
   * Close the progress panel
   */
  function closeProgressPanel() {
    if (progressPanelSide) {
      progressPanelSide.classList.remove('expanded');
    }
    if (progressPanelOverlay) {
      progressPanelOverlay.classList.remove('active');
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

      if (!confirm(`Reset progress for Question ${questionId} in ${mode === 'type' ? 'Type' : 'Speak'} mode?`)) {
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
          console.log(`✓ Progress reset for question ${questionId} in ${mode} mode`);
        } else {
          alert('Error resetting progress: ' + (result.error || 'Unknown error'));
        }
      } catch (error) {
        console.error('Error resetting progress:', error);
        alert('Error resetting progress');
      }
    });
  };

  setupResetProgressBtn('type');
  setupResetProgressBtn('speak');

  // Initialize on page load
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
    console.log(`✓ Progress UI: Handling auth state change - ${eventType}`);

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

      console.log(`✓ Progress UI: Reloading progress for ${currentMode} mode, question ${currentQuestionId}`);

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

      console.log('✓ Progress UI: Reload complete after login');
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

      console.log('✓ Progress UI: Cleared after logout');
    }
  }

  // Register the callback with auth-ui.js
  // This will be called whenever auth state changes
  const registerAuthCallback = () => {
    if (window.authUI && window.authUI.onAuthStateChange) {
      window.authUI.onAuthStateChange(handleAuthStateChange);
      console.log('✓ Progress UI: Auth state callback registered');
    } else {
      // Retry if auth-ui.js isn't ready yet
      setTimeout(registerAuthCallback, 100);
    }
  };
  registerAuthCallback();

  // Type mode
  playBtn.addEventListener("click", () => {
    // New flow: Enable input and show check button
    if (input) {
      input.disabled = false;
      input.focus();
    }
    if (checkBtn) checkBtn.style.display = "inline-block";
    if (retryBtn) retryBtn.style.display = "none";

    audio.currentTime = 0;
    audio.play();
  });

  checkBtn.addEventListener("click", () => {
    // New flow: Disable input and show retry button, hide check button
    // Also hide Play button to prevent point farming (Play->Check->Play->Check)
    if (input) input.disabled = true;
    if (checkBtn) checkBtn.style.display = "none";
    if (playBtn) playBtn.style.display = "none";
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
    if (grammarWarnings.length > 0) {
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
      if (playBtn) playBtn.style.display = "inline-block";
      resetScaffolding();
    });
  }

  // Speak mode
  playBtnSpeak.addEventListener("click", () => {
    audio.currentTime = 0;
    audio.play();
  });

  // Note: Speech Recognition API handles permissions automatically.
  // The browser should remember permissions after the first grant.
  // If you're opening this as a local file (file://), browsers don't persist
  // permissions for security reasons - this is expected browser behavior.
  const ensureMicrophoneAccess = async () => {
    // No-op: Let each recognition instance request permission naturally
    // The browser will remember it after the first grant (unless file://)
  };

  recordBtn.addEventListener("click", async () => {
    if (!recognition) return;

    // Ensure microphone access is granted
    await ensureMicrophoneAccess();

    if (isRecording) {
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
          console.error("Failed to start recognition:", e);
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

    performCheckSpeak(transcription.trim(), scoreSpeak);
  });

  if (retryBtnSpeak) {
    retryBtnSpeak.addEventListener("click", () => {
      // New flow: Show record button, hide retry button, and reset scaffolding
      // Show Play button again (was hidden after Check to prevent point farming)
      if (recordBtn) recordBtn.style.display = "inline-block";
      if (playBtnSpeak) playBtnSpeak.style.display = "inline-block";
      retryBtnSpeak.style.display = "none";
      resetScaffolding();
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
    "next", "time", "now", "then", "here", "there", "more", "most", "some", "any", "many", "much",
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
      let normalized = lowerWord.replace(/[.,!?;:"()\[\]{}]/g, '');
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

  // Check if a word is likely a verb (past tense, -ed, -ing forms, etc.)
  const isLikelyVerb = (word) => {
    const lower = word.toLowerCase();
    // Common verb endings
    if (lower.endsWith('ed') && lower.length > 3) return true;
    if (lower.endsWith('ing') && lower.length > 4) return true;
    if (lower.endsWith('es') && lower.length > 3) return true;
    if (lower.endsWith('s') && lower.length > 2 && !lower.endsWith('ss') && !lower.endsWith('us')) return true;
    // Check against common verbs list
    if (commonVerbs.has(lower)) return true;
    // Check if it's a past tense form of common verbs
    const verbStems = ['live', 'work', 'play', 'study', 'learn', 'teach', 'help', 'make', 'take', 'give', 'get', 'go', 'come', 'see', 'know', 'think', 'say', 'tell', 'ask', 'want', 'need', 'use', 'call', 'try', 'find', 'keep', 'let', 'put', 'mean', 'set', 'become', 'leave', 'feel', 'seem', 'bring', 'begin', 'help', 'hear', 'run', 'move', 'like', 'believe', 'hold', 'happen', 'write', 'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue'];
    if (verbStems.some(stem => lower === stem + 'd' || lower === stem + 'ed')) return true;
    return false;
  };

  // Check if a word is likely an adjective (superlative, comparative, -est, -er, etc.)
  const isLikelyAdjective = (word) => {
    const lower = word.toLowerCase();
    // Superlative and comparative forms
    if (lower.endsWith('est') && lower.length > 4) return true;
    if (lower.endsWith('er') && lower.length > 3 && !lower.endsWith('ter') && !lower.endsWith('der')) return true;
    // Common adjectives that shouldn't be used as nouns
    const commonAdjectives = ['large', 'larger', 'largest', 'small', 'smaller', 'smallest', 'big', 'bigger', 'biggest', 'good', 'better', 'best', 'bad', 'worse', 'worst', 'high', 'higher', 'highest', 'low', 'lower', 'lowest', 'new', 'newer', 'newest', 'old', 'older', 'oldest', 'young', 'younger', 'youngest', 'important', 'different', 'difficult', 'easy', 'hard', 'simple', 'complex'];
    if (commonAdjectives.includes(lower)) return true;
    return false;
  };

  // Extract keywords from diff (missing and misplaced words, excluding stop words, verbs, and adjectives)
  const extractKeywords = (diff) => {
    const keywords = [];
    diff.forEach((part) => {
      const word = part.text.toLowerCase().trim();
      // Exclude stop words, contractions, verbs, and adjectives
      if ((part.type === "missing" || part.type === "misplaced") &&
        !stopWords.has(word) &&
        !commonVerbs.has(word) &&
        !isLikelyVerb(word) &&
        !isLikelyAdjective(word) &&
        word.length > 1 && // Exclude single characters
        !word.includes("'") && // Exclude contractions
        !word.match(/^[a-z]+'[a-z]+$/)) { // Exclude any word with apostrophe
        keywords.push(word);
      }
    });
    // Remove duplicates and return only content words (nouns, etc.)
    return [...new Set(keywords)];
  };

  // Generate a meaningful, grammatically correct sentence using specific keywords
  const generateSentence = (selectedKeywords, sentenceNum) => {
    if (!selectedKeywords || selectedKeywords.length === 0) return null;

    // Validate keywords are valid (only basic checks - words are already filtered from vocabulary practice)
    const isValidKeyword = (kw) => {
      if (!kw || kw.length <= 1) return false;
      if (kw.includes("'")) return false;
      if (stopWords.has(kw)) return false; // Still filter stop words
      if (kw.match(/^[a-z]+'[a-z]+$/)) return false;
      // Don't filter verbs/adjectives - these come from vocabulary practice and should be used
      return true;
    };

    // Filter and validate the provided keywords (only basic validation)
    const finalKeywords = selectedKeywords.filter(isValidKeyword);
    if (finalKeywords.length === 0) return null;

    // Natural sentence templates that are grammatically correct
    const templates = [
      // Template 1: Subject + verb + the + keyword1 + preposition + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const subjects = ["We", "They", "People", "Researchers", "Experts", "Students", "Teachers"];
        const verbs = ["discuss", "analyze", "examine", "study", "review", "explore", "understand", "consider"];
        const preps = ["of", "in", "on", "for", "about", "with", "through"];
        const subject = subjects[Math.floor(Math.random() * subjects.length)];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const prep = preps[Math.floor(Math.random() * preps.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `${subject} ${verb} the ${kw1} ${prep} ${kw2}.`;
        }
        return `${subject} ${verb} the ${kw1}.`;
      },

      // Template 2: The + keyword1 + verb + the + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["affects", "influences", "impacts", "shapes", "determines", "changes", "improves"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `The ${kw1} ${verb} the ${kw2}.`;
        }
        return `The ${kw1} matters.`;
      },

      // Template 3: This + keyword1 + helps + verb + the + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["understand", "explain", "analyze", "evaluate", "assess"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `This ${kw1} helps ${verb} the ${kw2}.`;
        }
        return `This ${kw1} is important.`;
      },

      // Template 4: We + should + verb + the + keyword1 + preposition + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const modals = ["should", "must", "need to", "can", "will"];
        const verbs = ["discuss", "analyze", "examine", "study", "review", "consider"];
        const preps = ["of", "in", "on", "for", "about"];
        const modal = modals[Math.floor(Math.random() * modals.length)];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const prep = preps[Math.floor(Math.random() * preps.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `We ${modal} ${verb} the ${kw1} ${prep} ${kw2}.`;
        }
        return `We ${modal} ${verb} the ${kw1}.`;
      },

      // Template 5: The + keyword1 + shows + how + keyword2 + affects + keyword3
      (kw1, kw2, kw3) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["shows", "explains", "demonstrates", "illustrates", "reveals"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        if (kw2 && kw3 && isValidKeyword(kw2) && isValidKeyword(kw3)) {
          return `The ${kw1} ${verb} how ${kw2} affects ${kw3}.`;
        } else if (kw2 && isValidKeyword(kw2)) {
          return `The ${kw1} ${verb} the ${kw2}.`;
        }
        return `The ${kw1} is significant.`;
      },

      // Template 6: People + often + verb + the + keyword1 + preposition + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["discuss", "analyze", "examine", "study", "review"];
        const preps = ["of", "in", "on", "for", "about"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const prep = preps[Math.floor(Math.random() * preps.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `People often ${verb} the ${kw1} ${prep} ${kw2}.`;
        }
        return `People often ${verb} the ${kw1}.`;
      },

      // Template 7: It + is + important + to + verb + the + keyword1 + preposition + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["understand", "analyze", "examine", "study", "consider"];
        const preps = ["of", "in", "on", "for", "about"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const prep = preps[Math.floor(Math.random() * preps.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `It is important to ${verb} the ${kw1} ${prep} ${kw2}.`;
        }
        return `It is important to ${verb} the ${kw1}.`;
      },

      // Template 8: Many + people + verb + the + keyword1 + preposition + keyword2
      (kw1, kw2) => {
        if (!isValidKeyword(kw1)) return null;
        const verbs = ["discuss", "analyze", "examine", "study", "review"];
        const preps = ["of", "in", "on", "for", "about"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const prep = preps[Math.floor(Math.random() * preps.length)];
        if (kw2 && isValidKeyword(kw2)) {
          return `Many people ${verb} the ${kw1} ${prep} ${kw2}.`;
        }
        return `Many people ${verb} the ${kw1}.`;
      }
    ];

    // Select a template based on sentence number
    const templateIdx = sentenceNum % templates.length;
    const template = templates[templateIdx];

    // Generate sentence based on number of valid keywords
    let sentence = null;
    if (finalKeywords.length >= 3) {
      sentence = template(finalKeywords[0], finalKeywords[1], finalKeywords[2]);
    } else if (finalKeywords.length === 2) {
      sentence = template(finalKeywords[0], finalKeywords[1]);
    } else if (finalKeywords.length === 1) {
      sentence = template(finalKeywords[0]);
    }

    // Fallback if template doesn't work
    if (!sentence && finalKeywords.length > 0) {
      const kw = finalKeywords[0];
      if (isValidKeyword(kw)) {
        const verbs = ["discuss", "analyze", "examine", "study"];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        sentence = `We ${verb} the ${kw}.`;

        if (finalKeywords.length > 1 && isValidKeyword(finalKeywords[1])) {
          const preps = ["of", "in", "on", "for", "about"];
          const prep = preps[Math.floor(Math.random() * preps.length)];
          sentence = `We ${verb} the ${kw} ${prep} ${finalKeywords[1]}.`;
        }
      }
    }

    if (!sentence) return null;

    // Ensure proper capitalization and formatting
    sentence = sentence.trim();
    sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
    if (!sentence.endsWith(".")) {
      sentence += ".";
    }

    // Clean up any double spaces
    sentence = sentence.replace(/\s+/g, " ");

    // Validate and fix grammar errors
    sentence = validateAndFixGrammar(sentence, finalKeywords);

    if (!sentence) return null; // If validation failed, return null

    // Determine which keywords were actually used in the sentence
    const usedKeywords = finalKeywords.filter(kw =>
      sentence.toLowerCase().includes(kw.toLowerCase())
    );

    return {
      text: sentence,
      keywords: usedKeywords.length > 0 ? usedKeywords : finalKeywords.slice(0, Math.min(3, finalKeywords.length))
    };
  };

  // Validate and fix grammar errors in generated sentences
  const validateAndFixGrammar = (sentence, keywords) => {
    if (!sentence) return null;

    const lower = sentence.toLowerCase();
    const words = sentence.split(/\s+/);

    // Check for common grammar errors

    // Error 1: "the [verb]" - verb used as noun (e.g., "the lived", "the studied")
    for (let i = 0; i < words.length - 1; i++) {
      const word = words[i].toLowerCase().replace(/[.,!?;:]/g, '');
      const nextWord = words[i + 1].toLowerCase().replace(/[.,!?;:]/g, '');
      if (word === 'the' && (isLikelyVerb(nextWord) || commonVerbs.has(nextWord))) {
        // Replace with a valid noun or remove the problematic keyword
        return null; // Return null to regenerate
      }
    }

    // Error 2: "This [verb]" - verb used as noun
    for (let i = 0; i < words.length - 1; i++) {
      const word = words[i].toLowerCase().replace(/[.,!?;:]/g, '');
      const nextWord = words[i + 1].toLowerCase().replace(/[.,!?;:]/g, '');
      if (word === 'this' && (isLikelyVerb(nextWord) || commonVerbs.has(nextWord))) {
        return null; // Return null to regenerate
      }
    }

    // Error 3: "[adjective] matters" or "[adjective] is important" - adjective used as noun
    for (let i = 0; i < words.length - 1; i++) {
      const word = words[i].toLowerCase().replace(/[.,!?;:]/g, '');
      const nextWord = words[i + 1].toLowerCase().replace(/[.,!?;:]/g, '');
      if (isLikelyAdjective(word) && (nextWord === 'matters' || nextWord === 'is')) {
        return null; // Return null to regenerate
      }
    }

    // Error 4: "the [adjective]" without a following noun
    for (let i = 0; i < words.length - 1; i++) {
      const word = words[i].toLowerCase().replace(/[.,!?;:]/g, '');
      const nextWord = words[i + 1].toLowerCase().replace(/[.,!?;:]/g, '');
      if (word === 'the' && isLikelyAdjective(nextWord)) {
        // Check if there's a noun after the adjective
        if (i + 2 >= words.length || isLikelyVerb(words[i + 2].toLowerCase().replace(/[.,!?;:]/g, ''))) {
          return null; // Return null to regenerate
        }
      }
    }

    // Error 5: Check for nonsensical patterns like "verb the verb"
    for (let i = 0; i < words.length - 2; i++) {
      const word1 = words[i].toLowerCase().replace(/[.,!?;:]/g, '');
      const word2 = words[i + 1].toLowerCase().replace(/[.,!?;:]/g, '');
      const word3 = words[i + 2].toLowerCase().replace(/[.,!?;:]/g, '');
      if ((isLikelyVerb(word1) || commonVerbs.has(word1)) &&
        word2 === 'the' &&
        (isLikelyVerb(word3) || commonVerbs.has(word3))) {
        return null; // Return null to regenerate
      }
    }

    // Error 6: Check for problematic patterns using regex
    const problematicPatterns = [
      /\bthe\s+(largest|smallest|biggest|smallest|highest|lowest|newest|oldest|youngest)\s+(matters|is|are|was|were)\b/i,
      /\bthis\s+(largest|smallest|biggest|smallest|highest|lowest|newest|oldest|youngest)\s+(is|are|was|were)\b/i,
      /\b(lived|worked|played|studied|learned|taught|helped|made|took|gave|got|went|came|saw|knew|thought|said|told|asked|wanted|needed|used|called|tried|found|kept|let|put|meant|set|became|left|felt|seemed|brought|began|heard|ran|moved|believed|held|happened|wrote|sat|stood|lost|paid|met|included|continued)\s+(matters|is|are|was|were)\b/i
    ];

    for (const pattern of problematicPatterns) {
      if (pattern.test(sentence)) {
        return null; // Return null to regenerate
      }
    }

    return sentence; // Sentence passed validation
  };

  // Generate 5 sentences
  // Helper function to highlight keywords in sentence text
  const highlightKeywords = (text, keywords) => {
    let highlighted = text;
    keywords.forEach(keyword => {
      // Create a regex that matches the keyword as a whole word (case insensitive)
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      highlighted = highlighted.replace(regex, (match) => {
        return `<strong class="sentence-keyword">${match}</strong>`;
      });
    });
    return highlighted;
  };

  // Type mode: Generate sentences with text input
  const generateSentencesType = () => {
    if (lastDiffType.length === 0) {
      generatedSentencesType.innerHTML = "<div class='error'>Please check your answer first to generate sentences.</div>";
      return;
    }

    // Use vocabulary practice words directly (these are already filtered content words)
    let validKeywords = vocabularyPracticeWordsType.length > 0
      ? [...vocabularyPracticeWordsType]
      : [];

    // Fallback: if no vocabulary practice words, extract from diff (but don't filter as strictly)
    if (validKeywords.length === 0) {
      const missedWords = getMissedWords(lastDiffType);
      validKeywords = filterContentWords(missedWords).map(w => w.toLowerCase().trim());
    }

    if (validKeywords.length === 0) {
      generatedSentencesType.innerHTML = "<div class='error'>No keywords found. All errors are stop words.</div>";
      return;
    }

    // Remove duplicates and ensure all are valid
    validKeywords = [...new Set(validKeywords)].filter(kw =>
      kw &&
      kw.length > 1 &&
      !kw.includes("'") &&
      !kw.match(/^[a-z]+'[a-z]+$/)
    );

    if (validKeywords.length === 0) {
      generatedSentencesType.innerHTML = "<div class='error'>No valid keywords found.</div>";
      return;
    }

    // Distribute keywords across 5 sentences to ensure all are used
    const distributeKeywords = (keywords, numSentences) => {
      const distributed = [];
      const shuffled = [...keywords].sort(() => Math.random() - 0.5);

      // Distribute keywords evenly across sentences
      // Each sentence should get at least 1 keyword, up to 3 keywords
      // Ensure all keywords are used
      for (let i = 0; i < numSentences; i++) {
        distributed.push([]);
      }

      // Round-robin distribution to ensure even spread
      let keywordIdx = 0;
      for (let i = 0; i < shuffled.length; i++) {
        const sentenceIdx = keywordIdx % numSentences;
        // Only add if the sentence doesn't already have 3 keywords
        if (distributed[sentenceIdx].length < 3) {
          distributed[sentenceIdx].push(shuffled[i]);
        } else {
          // Find next sentence with space
          let found = false;
          for (let j = 0; j < numSentences; j++) {
            const checkIdx = (sentenceIdx + j + 1) % numSentences;
            if (distributed[checkIdx].length < 3) {
              distributed[checkIdx].push(shuffled[i]);
              found = true;
              break;
            }
          }
          // If all sentences have 3 keywords, add to the first one
          if (!found) {
            distributed[0].push(shuffled[i]);
          }
        }
        keywordIdx++;
      }

      // Ensure each sentence has at least 1 keyword
      for (let i = 0; i < numSentences; i++) {
        if (distributed[i].length === 0) {
          // Take from sentences with more than 1 keyword
          for (let j = 0; j < numSentences; j++) {
            if (distributed[j].length > 1) {
              distributed[i].push(distributed[j].pop());
              break;
            }
          }
        }
      }

      // Always return exactly numSentences arrays (even if some are empty)
      // Pad with empty arrays if needed
      while (distributed.length < numSentences) {
        distributed.push([]);
      }

      return distributed.slice(0, numSentences);
    };

    const keywordDistribution = distributeKeywords(validKeywords, 5);

    // Track which keywords have been used at least once (to ensure all are used)
    const usedKeywordsSet = new Set();
    const allKeywords = [...validKeywords];

    const sentences = [];
    let attempts = 0;
    const maxAttempts = 500; // Increased attempts to ensure we get 5 sentences

    // Keep generating until we have 5 sentences
    while (sentences.length < 5 && attempts < maxAttempts) {
      attempts++;
      const sentenceIndex = sentences.length;

      // Priority: First use unused keywords, then reuse any keywords
      let keywordsForThisSentence = [];

      // First, try to get unused keywords from distribution
      const unusedKeywords = allKeywords.filter(kw => !usedKeywordsSet.has(kw));

      if (unusedKeywords.length > 0) {
        // Use unused keywords first - get 1-2 from the distribution for this sentence
        const distIdx = sentenceIndex % keywordDistribution.length;
        const distKeywords = keywordDistribution[distIdx] || [];
        const unusedFromDist = distKeywords.filter(kw => !usedKeywordsSet.has(kw));

        if (unusedFromDist.length > 0) {
          keywordsForThisSentence = unusedFromDist.slice(0, 2); // Use 1-2 unused keywords
        } else {
          // Get any unused keyword
          keywordsForThisSentence = [unusedKeywords[0]];
        }
      } else {
        // All keywords have been used at least once, now we can reuse them
        // Get keywords from distribution for this sentence
        const distIdx = sentenceIndex % keywordDistribution.length;
        keywordsForThisSentence = keywordDistribution[distIdx] || [];

        // If still empty, use any available keyword
        if (keywordsForThisSentence.length === 0 && allKeywords.length > 0) {
          keywordsForThisSentence = [allKeywords[sentenceIndex % allKeywords.length]];
        }
      }

      // Ensure we have at least one keyword
      if (keywordsForThisSentence.length === 0 && allKeywords.length > 0) {
        keywordsForThisSentence = [allKeywords[0]];
      }

      // Try multiple template variations
      let sentence = null;
      for (let templateOffset = 0; templateOffset < 20 && !sentence; templateOffset++) {
        const sentenceNum = sentenceIndex * 100 + attempts + templateOffset;
        sentence = generateSentence(keywordsForThisSentence, sentenceNum);

        if (sentence && sentence.text) {
          // Double-check the sentence is valid
          const validated = validateAndFixGrammar(sentence.text, sentence.keywords);
          if (validated) {
            sentence.text = validated;
            // Mark keywords as used (at least once)
            sentence.keywords.forEach(kw => usedKeywordsSet.add(kw));
            sentences.push(sentence);
            break; // Successfully generated a sentence
          } else {
            sentence = null; // Try next template
          }
        }
      }

      // If we couldn't generate a sentence, try with just one keyword
      if (!sentence && keywordsForThisSentence.length > 0) {
        const singleKeyword = keywordsForThisSentence[0];
        for (let templateOffset = 0; templateOffset < 20 && !sentence; templateOffset++) {
          const sentenceNum = sentenceIndex * 100 + attempts + templateOffset + 1000;
          sentence = generateSentence([singleKeyword], sentenceNum);

          if (sentence && sentence.text) {
            const validated = validateAndFixGrammar(sentence.text, sentence.keywords);
            if (validated) {
              sentence.text = validated;
              // Mark keyword as used
              sentence.keywords.forEach(kw => usedKeywordsSet.add(kw));
              sentences.push(sentence);
              break;
            } else {
              sentence = null;
            }
          }
        }
      }

      // If still no sentence, try with any keyword from the list
      if (!sentence && allKeywords.length > 0) {
        const anyKeyword = allKeywords[sentenceIndex % allKeywords.length];
        for (let templateOffset = 0; templateOffset < 20 && !sentence; templateOffset++) {
          const sentenceNum = sentenceIndex * 100 + attempts + templateOffset + 2000;
          sentence = generateSentence([anyKeyword], sentenceNum);

          if (sentence && sentence.text) {
            const validated = validateAndFixGrammar(sentence.text, sentence.keywords);
            if (validated) {
              sentence.text = validated;
              sentence.keywords.forEach(kw => usedKeywordsSet.add(kw));
              sentences.push(sentence);
              break;
            } else {
              sentence = null;
            }
          }
        }
      }

      // If we still couldn't generate a sentence after all attempts, 
      // accept it anyway if it was generated (even if grammar validation failed)
      // This ensures we always get 5 sentences
      if (!sentence && allKeywords.length > 0) {
        const anyKeyword = allKeywords[sentenceIndex % allKeywords.length];
        sentence = generateSentence([anyKeyword], sentenceIndex * 1000 + attempts);
        if (sentence && sentence.text) {
          // Accept the sentence even if grammar validation fails
          sentence.text = sentence.text.trim();
          sentence.text = sentence.text.charAt(0).toUpperCase() + sentence.text.slice(1);
          if (!sentence.text.endsWith(".")) {
            sentence.text += ".";
          }
          sentence.keywords.forEach(kw => usedKeywordsSet.add(kw));
          sentences.push(sentence);
        }
      }
    }

    if (sentences.length === 0) {
      generatedSentencesType.innerHTML = "<div class='error'>Could not generate valid sentences. Please try again.</div>";
      return;
    }

    // Render sentences (default hidden) with text input for Type mode
    generatedSentencesType.innerHTML = sentences.map((sentence, idx) => {
      const sentenceId = `sentence-type-${idx}`;
      const highlightedText = highlightKeywords(sentence.text, sentence.keywords);
      return `
        <div class="generated-sentence" data-sentence-id="${sentenceId}">
          <div class="sentence-header">
            <span class="sentence-number">Sentence ${idx + 1}</span>
            <button class="sentence-show-btn" data-sentence="${idx}" type="button">Show</button>
            <button class="sentence-play-btn" data-sentence="${idx}" type="button">Play</button>
          </div>
          <div class="sentence-text" data-sentence-text="${idx}" style="display: none;">${highlightedText}</div>
          <div class="sentence-input-container">
            <textarea class="sentence-input" id="input-${sentenceId}" rows="2" placeholder="Type the sentence here..."></textarea>
            <button class="sentence-check-btn" data-sentence="${idx}" type="button">Check</button>
          </div>
          <div class="sentence-status" id="status-${sentenceId}"></div>
        </div>
      `;
    }).join("");

    // Show Show All / Hide All buttons
    showAllSentencesBtnType.style.display = "inline-block";
    hideAllSentencesBtnType.style.display = "inline-block";

    // Store sentences data
    window.generatedSentencesDataType = sentences;

    // Add event listeners for Show buttons
    generatedSentencesType.querySelectorAll(".sentence-show-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        const textEl = document.querySelector(`[data-sentence-text="${idx}"]`);

        if (textEl.style.display === "none") {
          textEl.style.display = "block";
          btn.textContent = "Hide";
          btn.classList.add("sentence-hide-btn");
          btn.classList.remove("sentence-show-btn");
        } else {
          textEl.style.display = "none";
          btn.textContent = "Show";
          btn.classList.add("sentence-show-btn");
          btn.classList.remove("sentence-hide-btn");
        }
      });
    });

    // Add event listeners for Play buttons
    generatedSentencesType.querySelectorAll(".sentence-play-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        playGeneratedSentenceType(idx);
      });
    });

    // Add event listeners for Check buttons (Type mode)
    generatedSentencesType.querySelectorAll(".sentence-check-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        checkGeneratedSentenceType(idx);
      });
    });

    generatePanelType.style.display = "block";
  };

  // Speak mode: Generate sentences with Record button
  const generateSentencesSpeak = () => {
    if (lastDiffSpeak.length === 0) {
      generatedSentencesSpeak.innerHTML = "<div class='error'>Please check your answer first to generate sentences.</div>";
      return;
    }

    // Use pronunciation practice words directly (these are already filtered content words)
    let validKeywords = vocabularyPracticeWordsSpeak.length > 0
      ? [...vocabularyPracticeWordsSpeak]
      : [];

    // Fallback: if no pronunciation practice words, extract from diff (but don't filter as strictly)
    if (validKeywords.length === 0) {
      const missedWords = getMissedWords(lastDiffSpeak);
      validKeywords = filterContentWords(missedWords).map(w => w.toLowerCase().trim());
    }

    if (validKeywords.length === 0) {
      generatedSentencesSpeak.innerHTML = "<div class='error'>No keywords found. All errors are stop words.</div>";
      return;
    }

    // Remove duplicates and ensure all are valid
    validKeywords = [...new Set(validKeywords)].filter(kw =>
      kw &&
      kw.length > 1 &&
      !kw.includes("'") &&
      !kw.match(/^[a-z]+'[a-z]+$/)
    );

    if (validKeywords.length === 0) {
      generatedSentencesSpeak.innerHTML = "<div class='error'>No valid keywords found.</div>";
      return;
    }

    // Distribute keywords across 5 sentences to ensure all are used
    const distributeKeywords = (keywords, numSentences) => {
      const distributed = [];
      const shuffled = [...keywords].sort(() => Math.random() - 0.5);

      // Distribute keywords evenly across sentences
      // Each sentence should get at least 1 keyword, up to 3 keywords
      // Ensure all keywords are used
      for (let i = 0; i < numSentences; i++) {
        distributed.push([]);
      }

      // Round-robin distribution to ensure even spread
      let keywordIdx = 0;
      for (let i = 0; i < shuffled.length; i++) {
        const sentenceIdx = keywordIdx % numSentences;
        // Only add if the sentence doesn't already have 3 keywords
        if (distributed[sentenceIdx].length < 3) {
          distributed[sentenceIdx].push(shuffled[i]);
        } else {
          // Find next sentence with space
          let found = false;
          for (let j = 0; j < numSentences; j++) {
            const checkIdx = (sentenceIdx + j + 1) % numSentences;
            if (distributed[checkIdx].length < 3) {
              distributed[checkIdx].push(shuffled[i]);
              found = true;
              break;
            }
          }
          // If all sentences have 3 keywords, add to the first one
          if (!found) {
            distributed[0].push(shuffled[i]);
          }
        }
        keywordIdx++;
      }

      // Ensure each sentence has at least 1 keyword
      for (let i = 0; i < numSentences; i++) {
        if (distributed[i].length === 0) {
          // Take from sentences with more than 1 keyword
          for (let j = 0; j < numSentences; j++) {
            if (distributed[j].length > 1) {
              distributed[i].push(distributed[j].pop());
              break;
            }
          }
        }
      }

      // Always return exactly numSentences arrays (even if some are empty)
      // Pad with empty arrays if needed
      while (distributed.length < numSentences) {
        distributed.push([]);
      }

      return distributed.slice(0, numSentences);
    };

    const keywordDistribution = distributeKeywords(validKeywords, 5);

    // Track which keywords have been used at least once (to ensure all are used)
    const usedKeywordsSet = new Set();
    const allKeywords = [...validKeywords];

    const sentences = [];
    let attempts = 0;
    const maxAttempts = 500; // Increased attempts to ensure we get 5 sentences

    // Keep generating until we have 5 sentences
    while (sentences.length < 5 && attempts < maxAttempts) {
      attempts++;
      const sentenceIndex = sentences.length;

      // Priority: First use unused keywords, then reuse any keywords
      let keywordsForThisSentence = [];

      // First, try to get unused keywords from distribution
      const unusedKeywords = allKeywords.filter(kw => !usedKeywordsSet.has(kw));

      if (unusedKeywords.length > 0) {
        // Use unused keywords first - get 1-2 from the distribution for this sentence
        const distIdx = sentenceIndex % keywordDistribution.length;
        const distKeywords = keywordDistribution[distIdx] || [];
        const unusedFromDist = distKeywords.filter(kw => !usedKeywordsSet.has(kw));

        if (unusedFromDist.length > 0) {
          keywordsForThisSentence = unusedFromDist.slice(0, 2); // Use 1-2 unused keywords
        } else {
          // Get any unused keyword
          keywordsForThisSentence = [unusedKeywords[0]];
        }
      } else {
        // All keywords have been used at least once, now we can reuse them
        // Get keywords from distribution for this sentence
        const distIdx = sentenceIndex % keywordDistribution.length;
        keywordsForThisSentence = keywordDistribution[distIdx] || [];

        // If still empty, use any available keyword
        if (keywordsForThisSentence.length === 0 && allKeywords.length > 0) {
          keywordsForThisSentence = [allKeywords[sentenceIndex % allKeywords.length]];
        }
      }

      // Ensure we have at least one keyword
      if (keywordsForThisSentence.length === 0 && allKeywords.length > 0) {
        keywordsForThisSentence = [allKeywords[0]];
      }

      // Try multiple template variations
      let sentence = null;
      for (let templateOffset = 0; templateOffset < 20 && !sentence; templateOffset++) {
        const sentenceNum = sentenceIndex * 100 + attempts + templateOffset;
        sentence = generateSentence(keywordsForThisSentence, sentenceNum);

        if (sentence && sentence.text) {
          // Double-check the sentence is valid
          const validated = validateAndFixGrammar(sentence.text, sentence.keywords);
          if (validated) {
            sentence.text = validated;
            // Mark keywords as used (at least once)
            sentence.keywords.forEach(kw => usedKeywordsSet.add(kw));
            sentences.push(sentence);
            break; // Successfully generated a sentence
          } else {
            sentence = null; // Try next template
          }
        }
      }

      // If we couldn't generate a sentence, try with just one keyword
      if (!sentence && keywordsForThisSentence.length > 0) {
        const singleKeyword = keywordsForThisSentence[0];
        for (let templateOffset = 0; templateOffset < 20 && !sentence; templateOffset++) {
          const sentenceNum = sentenceIndex * 100 + attempts + templateOffset + 1000;
          sentence = generateSentence([singleKeyword], sentenceNum);

          if (sentence && sentence.text) {
            const validated = validateAndFixGrammar(sentence.text, sentence.keywords);
            if (validated) {
              sentence.text = validated;
              // Mark keyword as used
              sentence.keywords.forEach(kw => usedKeywordsSet.add(kw));
              sentences.push(sentence);
              break;
            } else {
              sentence = null;
            }
          }
        }
      }

      // If still no sentence, try with any keyword from the list
      if (!sentence && allKeywords.length > 0) {
        const anyKeyword = allKeywords[sentenceIndex % allKeywords.length];
        for (let templateOffset = 0; templateOffset < 20 && !sentence; templateOffset++) {
          const sentenceNum = sentenceIndex * 100 + attempts + templateOffset + 2000;
          sentence = generateSentence([anyKeyword], sentenceNum);

          if (sentence && sentence.text) {
            const validated = validateAndFixGrammar(sentence.text, sentence.keywords);
            if (validated) {
              sentence.text = validated;
              sentence.keywords.forEach(kw => usedKeywordsSet.add(kw));
              sentences.push(sentence);
              break;
            } else {
              sentence = null;
            }
          }
        }
      }

      // If we still couldn't generate a sentence after all attempts, 
      // accept it anyway if it was generated (even if grammar validation failed)
      // This ensures we always get 5 sentences
      if (!sentence && allKeywords.length > 0) {
        const anyKeyword = allKeywords[sentenceIndex % allKeywords.length];
        sentence = generateSentence([anyKeyword], sentenceIndex * 1000 + attempts);
        if (sentence && sentence.text) {
          // Accept the sentence even if grammar validation fails
          sentence.text = sentence.text.trim();
          sentence.text = sentence.text.charAt(0).toUpperCase() + sentence.text.slice(1);
          if (!sentence.text.endsWith(".")) {
            sentence.text += ".";
          }
          sentence.keywords.forEach(kw => usedKeywordsSet.add(kw));
          sentences.push(sentence);
        }
      }
    }

    if (sentences.length === 0) {
      generatedSentencesSpeak.innerHTML = "<div class='error'>Could not generate valid sentences. Please try again.</div>";
      return;
    }

    // Render sentences (default hidden) with Record button for Speak mode
    generatedSentencesSpeak.innerHTML = sentences.map((sentence, idx) => {
      const sentenceId = `sentence-speak-${idx}`;
      const highlightedText = highlightKeywords(sentence.text, sentence.keywords);
      return `
        <div class="generated-sentence" data-sentence-id="${sentenceId}">
          <div class="sentence-header">
            <span class="sentence-number">Sentence ${idx + 1}</span>
            <button class="sentence-show-btn" data-sentence="${idx}" type="button">Show</button>
            <button class="sentence-play-btn" data-sentence="${idx}" type="button">Play</button>
            <button class="sentence-record-btn" data-sentence="${idx}" type="button">Record</button>
          </div>
          <div class="sentence-text" data-sentence-text="${idx}" style="display: none;">${highlightedText}</div>
          <div class="sentence-status" id="status-${sentenceId}"></div>
        </div>
      `;
    }).join("");

    // Show Show All / Hide All buttons
    showAllSentencesBtnSpeak.style.display = "inline-block";
    hideAllSentencesBtnSpeak.style.display = "inline-block";

    // Store sentences data
    window.generatedSentencesDataSpeak = sentences;

    // Add event listeners for Show buttons
    generatedSentencesSpeak.querySelectorAll(".sentence-show-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        const textEl = document.querySelector(`[data-sentence-text="${idx}"]`);

        if (textEl.style.display === "none") {
          textEl.style.display = "block";
          btn.textContent = "Hide";
          btn.classList.add("sentence-hide-btn");
          btn.classList.remove("sentence-show-btn");
        } else {
          textEl.style.display = "none";
          btn.textContent = "Show";
          btn.classList.add("sentence-show-btn");
          btn.classList.remove("sentence-hide-btn");
        }
      });
    });

    // Add event listeners for Play buttons
    generatedSentencesSpeak.querySelectorAll(".sentence-play-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        playGeneratedSentenceSpeak(idx);
      });
    });

    // Add event listeners for Record buttons
    generatedSentencesSpeak.querySelectorAll(".sentence-record-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.sentence, 10);
        recordGeneratedSentence(idx, btn);
      });
    });

    generatePanelSpeak.style.display = "block";
  };

  // Play a generated sentence (Type mode)
  const playGeneratedSentenceType = (idx) => {
    if (!window.generatedSentencesDataType || !window.generatedSentencesDataType[idx]) return;

    const sentence = window.generatedSentencesDataType[idx].text;
    if (synth) {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(sentence);
      utter.lang = "en-US";
      const voices = synth.getVoices();
      const preferred = voices.find((v) =>
        /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
      );
      if (preferred) utter.voice = preferred;
      utter.rate = 1.0;
      utter.pitch = 1.0;
      synth.speak(utter);
    }
  };

  // Play a generated sentence (Speak mode)
  const playGeneratedSentenceSpeak = (idx) => {
    if (!window.generatedSentencesDataSpeak || !window.generatedSentencesDataSpeak[idx]) return;

    const sentence = window.generatedSentencesDataSpeak[idx].text;
    if (synth) {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(sentence);
      utter.lang = "en-US";
      const voices = synth.getVoices();
      const preferred = voices.find((v) =>
        /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
      );
      if (preferred) utter.voice = preferred;
      utter.rate = 1.0;
      utter.pitch = 1.0;
      synth.speak(utter);
    }
  };

  // Check typed input for Type mode generated sentences
  const checkGeneratedSentenceType = (idx) => {
    if (!window.generatedSentencesDataType || !window.generatedSentencesDataType[idx]) return;

    const sentence = window.generatedSentencesDataType[idx];
    const sentenceId = `sentence-type-${idx}`;
    const inputEl = document.getElementById(`input-${sentenceId}`);
    const statusEl = document.getElementById(`status-${sentenceId}`);

    if (!inputEl || !statusEl) return;

    const userInput = inputEl.value.trim();
    if (!userInput) {
      statusEl.textContent = "Please type your answer first.";
      statusEl.className = "sentence-status error";
      return;
    }

    const userWords = normalize(userInput).split(" ").filter(Boolean);
    const expectedWords = normalize(sentence.text).split(" ").filter(Boolean);

    // Check which keywords are missing
    const missingKeywords = [];
    sentence.keywords.forEach((keyword) => {
      const found = userWords.some(word => normalize(word) === normalize(keyword));
      if (!found) {
        missingKeywords.push(keyword);
      }
    });

    if (missingKeywords.length === 0) {
      statusEl.textContent = "✓ All keywords typed correctly!";
      statusEl.className = "sentence-status correct";
    } else {
      statusEl.textContent = `You missed these words: ${missingKeywords.join(", ")}`;
      statusEl.className = "sentence-status incorrect";
    }
  };

  // Record and assess a generated sentence
  let sentenceRecognition = null;
  const recordGeneratedSentence = (idx, btn) => {
    if (!SpeechRecognition) {
      alert("Speech recognition not available in your browser.");
      return;
    }

    if (!window.generatedSentencesData || !window.generatedSentencesData[idx]) return;

    const sentence = window.generatedSentencesData[idx];
    const statusEl = document.getElementById(`status-sentence-${idx}`);

    if (sentenceRecognition) {
      sentenceRecognition.stop();
      sentenceRecognition = null;
      btn.textContent = "Record";
      return;
    }

    btn.textContent = "Stop";
    statusEl.textContent = "Listening...";

    sentenceRecognition = new SpeechRecognition();
    sentenceRecognition.continuous = false;
    sentenceRecognition.interimResults = false;
    sentenceRecognition.lang = "en-US";

    sentenceRecognition.onresult = (event) => {
      const spokenText = event.results[0][0].transcript.trim().toLowerCase();
      const spokenWords = normalize(spokenText).split(" ").filter(Boolean);

      // Check which keywords are missing
      const missingKeywords = [];
      sentence.keywords.forEach((keyword) => {
        const found = spokenWords.some(word => normalize(word) === normalize(keyword));
        if (!found) {
          missingKeywords.push(keyword);
        }
      });

      if (missingKeywords.length === 0) {
        statusEl.textContent = "✓ All keywords spoken correctly!";
        statusEl.className = "sentence-status correct";
      } else {
        statusEl.textContent = `You missed these words: ${missingKeywords.join(", ")}`;
        statusEl.className = "sentence-status incorrect";
      }

      sentenceRecognition = null;
      btn.textContent = "Record";
    };

    sentenceRecognition.onerror = (event) => {
      if (event.error !== "aborted") {
        statusEl.textContent = `Error: ${event.error}`;
        statusEl.className = "sentence-status error";
      }
      sentenceRecognition = null;
      btn.textContent = "Record";
    };

    sentenceRecognition.onend = () => {
      sentenceRecognition = null;
      btn.textContent = "Record";
    };

    try {
      sentenceRecognition.start();
    } catch (e) {
      statusEl.textContent = "Failed to start recording";
      statusEl.className = "sentence-status error";
      sentenceRecognition = null;
      btn.textContent = "Record";
    }
  };

  // Type mode event listeners
  generateBtnType.addEventListener("click", generateSentencesType);

  // Show All sentences (Type mode)
  showAllSentencesBtnType.addEventListener("click", () => {
    const sentenceTexts = generatedSentencesType.querySelectorAll(".sentence-text");
    const showBtns = generatedSentencesType.querySelectorAll(".sentence-show-btn, .sentence-hide-btn");

    sentenceTexts.forEach((textEl) => {
      textEl.style.display = "block";
    });
    showBtns.forEach((btn) => {
      btn.textContent = "Hide";
      btn.classList.add("sentence-hide-btn");
      btn.classList.remove("sentence-show-btn");
    });
  });

  // Hide All sentences (Type mode)
  hideAllSentencesBtnType.addEventListener("click", () => {
    const sentenceTexts = generatedSentencesType.querySelectorAll(".sentence-text");
    const showBtns = generatedSentencesType.querySelectorAll(".sentence-show-btn, .sentence-hide-btn");

    sentenceTexts.forEach((textEl) => {
      textEl.style.display = "none";
    });
    showBtns.forEach((btn) => {
      btn.textContent = "Show";
      btn.classList.add("sentence-show-btn");
      btn.classList.remove("sentence-hide-btn");
    });
  });

  // Speak mode event listeners
  generateBtnSpeak.addEventListener("click", generateSentencesSpeak);

  // Show All sentences (Speak mode)
  showAllSentencesBtnSpeak.addEventListener("click", () => {
    const sentenceTexts = generatedSentencesSpeak.querySelectorAll(".sentence-text");
    const showBtns = generatedSentencesSpeak.querySelectorAll(".sentence-show-btn, .sentence-hide-btn");

    sentenceTexts.forEach((textEl) => {
      textEl.style.display = "block";
    });
    showBtns.forEach((btn) => {
      btn.textContent = "Hide";
      btn.classList.add("sentence-hide-btn");
      btn.classList.remove("sentence-show-btn");
    });
  });

  // Hide All sentences (Speak mode)
  hideAllSentencesBtnSpeak.addEventListener("click", () => {
    const sentenceTexts = generatedSentencesSpeak.querySelectorAll(".sentence-text");
    const showBtns = generatedSentencesSpeak.querySelectorAll(".sentence-show-btn, .sentence-hide-btn");

    sentenceTexts.forEach((textEl) => {
      textEl.style.display = "none";
    });
    showBtns.forEach((btn) => {
      btn.textContent = "Show";
      btn.classList.add("sentence-show-btn");
      btn.classList.remove("sentence-hide-btn");
    });
  });

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
      console.error("Failed to start breakdown recognition:", e);
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
      const result = await window.firebaseFirestoreFunctions.getUserProfile(userId);
      if (result && result.success && result.data) {
        window.currentUserProfile = result.data; // Store globally

        // Check Type mode filter
        if (result.data.sentenceLengthFilterUnlocked) {
          const containerType = document.getElementById('length-filter-container-type');
          if (containerType) {
            containerType.style.display = 'block';
            loadSentenceLengthData();
            applyLevelBasedRestrictions('type', result.data);
          }
        }
        // Check Speak mode filter
        if (result.data.speakLengthFilterUnlocked) {
          const containerSpeak = document.getElementById('length-filter-container-speak');
          if (containerSpeak) {
            containerSpeak.style.display = 'block';
            loadSpeakLengthData();
            applyLevelBasedRestrictions('speak', result.data);
          }
        }
      }
    } catch (e) {
      console.error('Error checking filter unlock status:', e);
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

    if (isFullUnlock) {
      // Show all options
      menu.querySelectorAll('.filter-option').forEach(el => el.style.display = 'flex');
      return;
    }

    // Level-based Logic
    const level = profile.englishLevel;
    if (!level) return; // Should not happen if unlocked via level, but safety check

    const options = menu.querySelectorAll('.filter-option');
    options.forEach(opt => {
      const val = opt.dataset.value;
      if (val === 'all') {
        opt.style.display = 'flex'; // Always show 'All'? Or remove it? 
        // Request says: "Only show... 5-8 words". 'All' implies all. 
        // Maybe hide 'All' too if restricted? 
        // "Only show the first option: 5–8 words." -> This implies 'All' should be hidden or strictly 5-8.
        // If I hide 'All', I must select '5-8' by default.
        // Let's hide 'All' for Beginner/Intermediate to force specific practice.
        opt.style.display = 'none';
      } else {
        let show = false;

        if (level === 'beginner') {
          // Only 5-8 (and maybe 4-7 for speak)
          if (val === '5-8' || val === '4-7') show = true;
        } else if (level === 'intermediate') {
          // 5-8, 9 (Type) / 4-7, 8-9 (Speak)
          if (val === '5-8' || val === '9') show = true;
          if (val === '4-7' || val === '8-9') show = true;
        } else if (level === 'expert') {
          // Expert doesn't unlock by default. If here, it means it's unlocked but NOT fully? 
          // Should typically be full unlock if Expert has it. 
          // But if they somehow got here without full unlock, show all?
          // User said: "Expert: Do not unlock".
          // If they have it, assume full.
          show = true;
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
    function updateStatusFilterLabel() {
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
    }

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
      option.addEventListener('click', () => {
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
    function updateStatusFilterLabelSpeak() {
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
    }

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
      option.addEventListener('click', () => {
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

  // Handle unlock event from Shopping Modal (supports both modes)
  window.onFilterUnlocked = (mode = 'type') => {
    const container = document.getElementById(`length-filter-container-${mode}`);
    const menu = document.getElementById(`length-filter-menu-${mode}`);

    if (container) {
      container.style.display = 'block';

      // Load appropriate data
      if (mode === 'type') {
        loadSentenceLengthData();
      } else if (mode === 'speak') {
        loadSpeakLengthData();
      }

      // Reset to "All Lengths"
      const allOption = menu?.querySelector('.filter-option[data-value="all"]');
      if (allOption && menu) {
        menu.querySelectorAll('.filter-option').forEach(o => o.classList.remove('selected'));
        allOption.classList.add('selected');
      }
      const labelElement = document.getElementById(`length-filter-label-${mode}`);
      if (labelElement) labelElement.textContent = 'Filter by Length';
      populateQuestionSelect(mode);

      // Start tutorial for first-time users
      if (window.LengthFilterTutorial && !window.LengthFilterTutorial.hasCompleted(mode)) {
        // Small delay to let the UI settle
        setTimeout(() => {
          window.LengthFilterTutorial.start(mode);
        }, 500);
      }
    }
  };

  // Expose loadSpeakLengthData globally
  window.loadSpeakLengthData = loadSpeakLengthData;
})();

