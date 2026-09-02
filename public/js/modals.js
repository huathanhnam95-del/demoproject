/* eslint-disable no-console */
/**
 * Modal Template Manager
 * Extracts large modal HTML structures from index.html to keep the main file clean.
 */

const VocabListModalTemplate = `
  <div id="vocab-list-modal" class="vocab-list-modal" style="display: none;">
    <div class="vocab-list-content-modal">
      <div class="vocab-list-header">
        <h2>Vocabulary List</h2>
        <button id="vocab-list-close" class="vocab-add-close">×</button>
      </div>

      <div class="vocab-tabs" role="tablist" aria-label="Vocabulary sections">
        <button class="vocab-tab-btn active" data-tab="bookmarks" role="tab" type="button"
          id="vocab-tab-bookmarks" aria-selected="true" aria-controls="tab-content-bookmarks">Bookmarked Words</button>
        <button class="vocab-tab-btn" data-tab="missed" role="tab" type="button"
          id="vocab-tab-missed" aria-selected="false" aria-controls="tab-content-missed" tabindex="-1">Frequently Missed</button>
        <button class="vocab-tab-btn" data-tab="practice" role="tab" type="button"
          id="vocab-tab-practice" aria-selected="false" aria-controls="tab-content-practice" tabindex="-1">Vocabulary Practice</button>
      </div>

      <div class="vocab-tab-content active" id="tab-content-bookmarks" role="tabpanel"
        aria-labelledby="vocab-tab-bookmarks" tabindex="0">
        <div id="vocab-toolbar-bookmarks"></div>
        <div id="vocab-list-bookmarks"></div>
      </div>

      <div class="vocab-tab-content" id="tab-content-missed" role="tabpanel"
        aria-labelledby="vocab-tab-missed" tabindex="0">
        <div id="vocab-toolbar-missed"></div>
        <div id="vocab-list-missed"></div>
      </div>
      <!-- Rendered by js/vocab/vocab-practice-view.js when this tab is first shown.
           Kept as an empty mount point so the dashboard can read live SRS state
           (due count, streak, mastery) instead of being static markup. -->
      <div class="vocab-tab-content" id="tab-content-practice" role="tabpanel"
        aria-labelledby="vocab-tab-practice" tabindex="0"></div>
    </div>
  </div>
`;

const ProgressAttemptsModalTemplate = `
  <div id="progress-attempts-modal" class="progress-modal" style="display: none;">
    <div class="progress-modal-content progress-attempts-content-modal">
      <div class="progress-modal-header">
        <h2>Progress</h2>
        <button id="progress-attempts-close" class="vocab-add-close" type="button" aria-label="Close progress">×</button>
      </div>

      <div class="progress-tabs" role="tablist" aria-label="Progress sections">
        <button class="progress-tab-btn active" data-tab="vocabulary" role="tab" type="button"
          id="progress-tab-vocabulary" aria-selected="true"
          aria-controls="progress-tab-content-vocabulary">Vocabulary</button>
        <button class="progress-tab-btn" data-tab="question-mastery" role="tab" type="button"
          id="progress-tab-question-mastery" aria-selected="false"
          aria-controls="progress-tab-content-question-mastery" tabindex="-1">Question Mastery</button>
        <button class="progress-tab-btn" data-tab="pte-attempts" role="tab" type="button"
          id="progress-tab-pte-attempts" aria-selected="false"
          aria-controls="progress-tab-content-attempts" tabindex="-1">PTE Attempts</button>
      </div>

      <!-- Vocabulary: real SRS data. Rendered by pte-attempt-archive.js on first
           open via readPracticeState() so the numbers can never drift from the
           Vocab Book dashboard, which reads the same helper. -->
      <div class="progress-tab-content active" id="progress-tab-content-vocabulary"
        data-tab-panel="vocabulary" role="tabpanel"
        aria-labelledby="progress-tab-vocabulary" tabindex="0">
        <div id="tp-vocabulary-mount"></div>
      </div>

      <div class="progress-tab-content" id="progress-tab-content-question-mastery"
        data-tab-panel="question-mastery" role="tabpanel"
        aria-labelledby="progress-tab-question-mastery" tabindex="0">
        <!-- Question tiers come from Firestore only, so guests genuinely have
             nothing here. The Vocabulary tab has no such gate: SRS supports
             guests through localStorage. -->
        <div id="progress-guest-notice" class="progress-guest-notice" style="display: none;">
          <div class="guest-notice-content">
            <span class="guest-notice-icon" aria-hidden="true">🔒</span>
            <p>Log in to save and track your progress across sessions.</p>
          </div>
        </div>
        <div id="progress-content-wrapper" class="progress-content-wrapper">
          <div class="tp-segmented" role="group" aria-label="Practice mode">
            <button type="button" class="tp-segmented-btn is-active" data-qm-mode="type">Type</button>
            <button type="button" class="tp-segmented-btn" data-qm-mode="speak">Speak</button>
          </div>
          <span id="progress-mode-label" class="tp-sr-only">Type Mode</span>

          <section class="tp-section">
            <h4 class="tp-section-title">Stats</h4>
            <div class="tp-stat-row">
              <div class="tp-stat">
                <span class="tp-stat-value" id="tp-total-count">0</span>
                <span class="tp-stat-label">Total</span>
              </div>
              <div class="tp-stat">
                <span class="tp-stat-value" id="tp-not-started-count">0</span>
                <span class="tp-stat-label">Not started</span>
              </div>
              <div class="tp-stat">
                <span class="tp-stat-value" id="completed-count">0</span>
                <span class="tp-stat-label">Completed</span>
              </div>
              <div class="tp-stat">
                <span class="tp-stat-value" id="consolidated-count">0</span>
                <span class="tp-stat-label">Consolidated</span>
              </div>
              <div class="tp-stat">
                <span class="tp-stat-value" id="mastered-count">0</span>
                <span class="tp-stat-label">Mastered</span>
              </div>
            </div>
          </section>

          <section class="tp-section">
            <h4 class="tp-section-title">Distribution</h4>
            <div class="tp-bar" role="img" aria-label="Question mastery distribution">
              <div id="tier-bar-not-started" class="tp-bar-segment" data-tier="not-started" style="width: 0%;"></div>
              <div id="tier-bar-in-progress" class="tp-bar-segment" data-tier="in-progress" style="width: 0%;"></div>
              <div id="tier-bar-completed" class="tp-bar-segment" data-tier="completed" style="width: 0%;"></div>
              <div id="tier-bar-consolidated" class="tp-bar-segment" data-tier="consolidated" style="width: 0%;"></div>
              <div id="tier-bar-mastered" class="tp-bar-segment" data-tier="mastered" style="width: 0%;"></div>
            </div>
            <ul class="tp-legend">
              <li class="tp-legend-item">
                <span class="tp-legend-dot" data-tier="not-started"></span>
                <span class="tp-legend-label">Not started</span>
                <span class="tp-legend-value" id="tp-legend-not-started">0</span>
              </li>
              <li class="tp-legend-item">
                <span class="tp-legend-dot" data-tier="in-progress"></span>
                <span class="tp-legend-label">In progress</span>
                <span class="tp-legend-value" id="tp-legend-in-progress">0</span>
              </li>
              <li class="tp-legend-item">
                <span class="tp-legend-dot" data-tier="completed"></span>
                <span class="tp-legend-label">Completed</span>
                <span class="tp-legend-value" id="tp-legend-completed">0</span>
              </li>
              <li class="tp-legend-item">
                <span class="tp-legend-dot" data-tier="consolidated"></span>
                <span class="tp-legend-label">Consolidated</span>
                <span class="tp-legend-value" id="tp-legend-consolidated">0</span>
              </li>
              <li class="tp-legend-item">
                <span class="tp-legend-dot" data-tier="mastered"></span>
                <span class="tp-legend-label">Mastered</span>
                <span class="tp-legend-value" id="tp-legend-mastered">0</span>
              </li>
            </ul>
          </section>

          <section class="tp-section">
            <h4 class="tp-section-title">Next goal</h4>
            <p id="next-goal-text" class="tp-goal-text">Complete a question to start tracking!</p>
          </section>

          <section class="tp-section">
            <h4 class="tp-section-title">Recent</h4>
            <ul id="recent-progress-list" class="recent-progress-list">
              <li class="no-progress">No recent progress</li>
            </ul>
          </section>
        </div>
      </div>

      <div class="progress-tab-content" id="progress-tab-content-attempts"
        data-tab-panel="pte-attempts" role="tabpanel"
        aria-labelledby="progress-tab-pte-attempts" tabindex="0">
        <div class="pte-attempt-history__bar">
          <h3 class="pte-attempt-history__title">My PTE Attempts</h3>
          <button type="button" id="pte-attempts-modal-refresh" class="pte-attempts-refresh-btn">Refresh</button>
        </div>
        <div id="pte-attempts-modal-list" class="pte-attempt-history__list" role="list"></div>
      </div>
    </div>
  </div>
`;

function injectVocabListModal() {
  if (!document.getElementById('vocab-list-modal')) {
    document.body.insertAdjacentHTML('beforeend', VocabListModalTemplate);
    console.log('✅ Vocab List Modal injected.');
  }
}

function injectProgressAttemptsModal() {
  if (!document.getElementById('progress-attempts-modal')) {
    document.body.insertAdjacentHTML('beforeend', ProgressAttemptsModalTemplate);
    console.log('✅ Progress & Attempts Modal injected.');
  }
}

// Auto-inject on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectVocabListModal();
    injectProgressAttemptsModal();
  });
} else {
  injectVocabListModal();
  injectProgressAttemptsModal();
}
