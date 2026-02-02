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
              onclick="if(window.SRSReview) window.SRSReview.startReviewSession()">
              Start Review Session <span id="srs-due-badge" class="badge-count"
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

function injectVocabListModal() {
    if (!document.getElementById('vocab-list-modal')) {
        document.body.insertAdjacentHTML('beforeend', VocabListModalTemplate);
        console.log('✅ Vocab List Modal injected.');
    }
}

// Auto-inject on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectVocabListModal);
} else {
    injectVocabListModal();
}
