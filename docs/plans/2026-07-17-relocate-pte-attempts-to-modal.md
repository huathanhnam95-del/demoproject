# Design Document: Relocate PTE Attempts to Center Modal

This design details the relocation of the **My PTE Attempts** history list from the bottom of the Learning Center page to a unified, centered **Progress & History** modal, which also replaces the left-side slide-out drawer.

---

## 1. Overview & Context

* **Current State:**
  * The left-side collapsible panel (`progress-panel-side`) slides out from the left and displays vocabulary learning statistics (Not Started, In Progress, Completed, Consolidated, Mastered).
  * The attempts history list ("My PTE Attempts") renders inline below the skill card grid in the dashboard.
* **Proposed State:**
  * A new centered modal (`#progress-attempts-modal`) is introduced with two tabs:
    1. **Vocabulary Progress:** Displays the vocabulary stats, distribution, pie chart, next goal, and recent logs (moved from the left drawer).
    2. **PTE Attempts:** Displays the list of the user's recent PTE attempts (moved from the page footer).
  * The floating left-side slide toggle is completely removed.
  * Clicking the **Track Progress** card in the dashboard opens this unified modal to the **Vocabulary Progress** tab.
  * A secondary button, **PTE Attempts**, is added inside the **Track Progress** card. Clicking it opens the same modal with the **PTE Attempts** tab active by default.

---

## 2. Structural & Layout Changes

### 2.1 Dashboard Card (index.html)
The **Track Progress** card will be updated to host two CTAs:
```html
<div class="modern-card stats-card-modern"
  onclick="if(window.PTEAttemptArchive?.openProgressModal) { window.PTEAttemptArchive.openProgressModal('vocab-progress'); }" 
  tabindex="0" role="button" aria-label="View Progress Statistics">
  <div class="card-visual visual-stats">
    <!-- SVG Icon -->
  </div>
  <div class="card-body">
    <h3>Track Progress</h3>
    <p>Visualize your vocabulary growth and mastery tiers.</p>
    <div class="card-ctas" style="display: flex; gap: 8px; margin-top: 12px; width: 100%;">
      <button class="card-cta primary" style="flex: 1; margin: 0;"
        onclick="event.stopPropagation(); if(window.PTEAttemptArchive?.openProgressModal) { window.PTEAttemptArchive.openProgressModal('vocab-progress'); }">
        View Stats
      </button>
      <button class="card-cta secondary" style="flex: 1; margin: 0;"
        onclick="event.stopPropagation(); if(window.PTEAttemptArchive?.openProgressModal) { window.PTEAttemptArchive.openProgressModal('pte-attempts'); }">
        PTE Attempts
      </button>
    </div>
  </div>
</div>
```

### 2.2 Modal Structure (modals.js)
The HTML structure for the new modal:
```html
<div id="progress-attempts-modal" class="vocab-list-modal" style="display: none;">
  <div class="vocab-list-content-modal" style="max-width: 750px;">
    <div class="vocab-list-header">
      <h2>Progress & Attempts</h2>
      <button id="progress-attempts-close" class="vocab-add-close">×</button>
    </div>

    <div class="progress-tabs">
      <button class="progress-tab-btn active" data-tab="vocab-progress">Vocabulary Progress</button>
      <button class="progress-tab-btn" data-tab="pte-attempts">PTE Attempts</button>
    </div>

    <!-- Tab 1: Vocabulary Progress -->
    <div class="progress-tab-content active" id="tab-content-vocab-progress">
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
        <!-- Stats summary, distribution bar, pie chart, next goal, recent progress list -->
      </div>
    </div>

    <!-- Tab 2: PTE Attempts -->
    <div class="progress-tab-content" id="tab-content-pte-attempts">
      <div class="pte-attempt-history__bar" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
        <h3 style="font-size:1rem;margin:0;color:#111827;">My PTE Attempts</h3>
        <button type="button" id="pte-attempts-modal-refresh" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;">Refresh</button>
      </div>
      <div id="pte-attempts-modal-list" class="pte-attempt-history__list" role="list"></div>
    </div>
  </div>
</div>
```

---

## 3. Behavioral & Event Handling Changes

### 3.1 modals.js
* Define and auto-inject `ProgressAttemptsModalTemplate` on page load.

### 3.2 pte-attempt-archive.js
* Expose `window.PTEAttemptArchive.openProgressModal(defaultTab)` which:
  1. Activates the modal overlay.
  2. Highlights the correct tab button.
  3. Displays the correct tab content container.
  4. Triggers rendering logic for the selected tab (updates attempts list or vocabulary stats).
* Expose `window.PTEAttemptArchive.closeProgressModal()`.
* Update rendering logic to populate `#pte-attempts-modal-list` instead of the old page-bottom `#pte-attempt-history`.

### 3.3 script.js
* Update references from the old left-side drawer IDs to target the modal layout IDs.
* Prevent overlay collision between the old progress panel drawer and the new centered modal.

---

## 4. UI/CSS Customizations (style.css)
* Add `.progress-tabs`, `.progress-tab-btn`, and `.progress-tab-content` classes to match `.vocab-tabs` styling.
* Completely hide or clean up the old `.progress-panel-side`, `.progress-panel-toggle`, and `.progress-panel-overlay` rules to keep the file clean.
