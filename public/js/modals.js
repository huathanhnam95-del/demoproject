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

      <div class="vocab-tabs">
        <button class="vocab-tab-btn active" data-tab="bookmarks">Bookmarked Words</button>
        <button class="vocab-tab-btn" data-tab="missed">Frequently Missed</button>
        <button class="vocab-tab-btn" data-tab="practice">Vocabulary Practice</button>
      </div>

      <div class="vocab-tab-content active" id="tab-content-bookmarks">
        <table class="vocab-table">
          <thead>
            <tr>
              <th>Word</th>
              <th>Pronunciation</th>
              <th>Vietnamese</th>
              <th>Examples</th>
              <th>Source</th>
              <th>Form</th>
              <th>Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="vocab-table-body-bookmarks">
            <!-- Rows injected by JS -->
          </tbody>
        </table>
      </div>

      <div class="vocab-tab-content" id="tab-content-missed">
        <table class="vocab-table">
          <thead>
            <tr>
              <th>Word</th>
              <th>Pronunciation</th>
              <th>Vietnamese</th>
              <th>Examples</th>
              <th>Source</th>
              <th>Form</th>
              <th>Date</th>
              <th>Times Missed</th>
            </tr>
          </thead>
          <tbody id="vocab-table-body-missed">
            <!-- Rows injected by JS -->
          </tbody>
        </table>
      </div>
      <div class="vocab-tab-content" id="tab-content-practice">
        <div class="vocab-practice-container" style="padding: 24px; text-align: center;">
          <div class="practice-card"
            style="background: var(--bg-input); padding: 24px; border-radius: 12px; margin-bottom: 24px; border: 1px solid var(--border-light);">
            <div style="font-size: 48px; margin-bottom: 16px;">🔄</div>
            <h3>Spaced Repetition Review</h3>
            <p style="color: var(--text-muted); margin-bottom: 24px;">Review your vocabulary at optimal intervals to maximize
              retention.</p>

            <button id="srs-start-review-btn" class="btn-primary"
              style="padding: 12px 32px; font-size: 1.1rem; width: 100%; max-width: 300px;"
              onclick="if(window.SRSReview) window.SRSReview.launchReviewFromDashboard()">
              Open Daily Review <span id="srs-due-badge" class="badge-count"
                style="display:none; background: var(--danger); color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; margin-left: 8px;">0</span>
            </button>

            <div id="srs-next-review-info" class="srs-next-review"
              style="margin-top: 16px; color: var(--text-muted); font-size: 0.9rem; display: none;">
              Next review: <span id="srs-next-date">-</span>
            </div>
          </div>

          <!-- Tutorial Replay Settings -->
          <div class="tutorial-replay-section">
            <h4 class="tutorial-replay-header">📘 Play Tutorial Next Time</h4>
            <p class="tutorial-replay-desc">Enable to replay the tutorial for any mode you'd like to review.</p>
            <div class="tutorial-toggle-list">
              <div class="tutorial-toggle-item">
                <span class="toggle-label">🔊 Listen and Type</span>
                <label class="toggle-switch">
                  <input type="checkbox" id="tutorial-replay-listen">
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="tutorial-toggle-item">
                <span class="toggle-label">🎙️ Listen and Repeat</span>
                <label class="toggle-switch">
                  <input type="checkbox" id="tutorial-replay-speak">
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="tutorial-toggle-item">
                <span class="toggle-label">📝 Fill in the Blank</span>
                <label class="toggle-switch">
                  <input type="checkbox" id="tutorial-replay-cloze">
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="tutorial-toggle-item">
                <span class="toggle-label">✍️ Writing Challenge</span>
                <label class="toggle-switch">
                  <input type="checkbox" id="tutorial-replay-writing">
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const ProgressAttemptsModalTemplate = `
  <div id="progress-attempts-modal" class="vocab-list-modal" style="display: none;">
    <div class="vocab-list-content-modal progress-attempts-content-modal" style="max-width: 750px;">
      <div class="vocab-list-header">
        <h2>Progress & Attempts</h2>
        <button id="progress-attempts-close" class="vocab-add-close">×</button>
      </div>

      <div class="progress-tabs">
        <button class="progress-tab-btn active" data-tab="vocab-progress">Vocabulary Progress</button>
        <button class="progress-tab-btn" data-tab="pte-attempts">PTE Attempts</button>
      </div>

      <div class="progress-tab-content active" id="progress-tab-content-vocab">
        <div id="progress-guest-notice" class="progress-guest-notice" style="display: none;">
          <div class="guest-notice-content">
            <span class="guest-notice-icon">🔒</span>
            <p>Log in to save and track your progress across sessions.</p>
          </div>
        </div>
        <div id="progress-content-wrapper" class="progress-content-wrapper">
          <div class="progress-mode-indicator">
            <span id="progress-mode-label">Type Mode</span>
          </div>

          <div class="progress-summary">
            <h4>Stats</h4>
            <div class="tier-counts">
              <div class="tier-count completed-count">
                <span class="tier-count-number" id="completed-count">0</span>
                <span class="tier-count-label">Completed</span>
              </div>
              <div class="tier-count consolidated-count">
                <span class="tier-count-number" id="consolidated-count">0</span>
                <span class="tier-count-label">Consolidated</span>
              </div>
              <div class="tier-count mastered-count">
                <span class="tier-count-number" id="mastered-count">0</span>
                <span class="tier-count-label">Mastered</span>
              </div>
            </div>
          </div>

          <div class="tier-distribution">
            <h4>Distribution</h4>
            <div class="tier-bar">
              <div id="tier-bar-not-started" class="tier-bar-segment not-started" style="width: 0%;"></div>
              <div id="tier-bar-in-progress" class="tier-bar-segment in-progress" style="width: 0%;"></div>
              <div id="tier-bar-completed" class="tier-bar-segment completed" style="width: 0%;"></div>
              <div id="tier-bar-consolidated" class="tier-bar-segment consolidated" style="width: 0%;"></div>
              <div id="tier-bar-mastered" class="tier-bar-segment mastered" style="width: 0%;"></div>
            </div>

            <div class="distribution-pie-chart">
              <div class="pie-chart-container">
                <svg id="distribution-pie" viewBox="0 0 100 100" class="pie-chart-svg">
                  <circle cx="50" cy="50" r="40" fill="#e5e7eb" />
                </svg>
                <div class="pie-chart-center">
                  <span id="pie-total-count" class="pie-total-number">0</span>
                  <span class="pie-total-label">Total</span>
                </div>
              </div>
              <div class="pie-chart-legend">
                <div class="pie-legend-item">
                  <span class="pie-legend-dot not-started"></span>
                  <span class="pie-legend-label">Not Started</span>
                  <span id="pie-legend-not-started" class="pie-legend-value">0% (0)</span>
                </div>
                <div class="pie-legend-item">
                  <span class="pie-legend-dot in-progress"></span>
                  <span class="pie-legend-label">In Progress</span>
                  <span id="pie-legend-in-progress" class="pie-legend-value">0% (0)</span>
                </div>
                <div class="pie-legend-item">
                  <span class="pie-legend-dot completed"></span>
                  <span class="pie-legend-label">Completed</span>
                  <span id="pie-legend-completed" class="pie-legend-value">0% (0)</span>
                </div>
                <div class="pie-legend-item">
                  <span class="pie-legend-dot consolidated"></span>
                  <span class="pie-legend-label">Consolidated</span>
                  <span id="pie-legend-consolidated" class="pie-legend-value">0% (0)</span>
                </div>
                <div class="pie-legend-item">
                  <span class="pie-legend-dot mastered"></span>
                  <span class="pie-legend-label">Mastered</span>
                  <span id="pie-legend-mastered" class="pie-legend-value">0% (0)</span>
                </div>
              </div>
            </div>
          </div>

          <div class="next-goal">
            <h4>Next Goal</h4>
            <p id="next-goal-text" class="next-goal-text">Complete a question to start tracking!</p>
          </div>

          <div class="recent-progress">
            <h4>Recent</h4>
            <ul id="recent-progress-list" class="recent-progress-list">
              <li class="no-progress">No recent progress</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="progress-tab-content" id="progress-tab-content-attempts">
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
