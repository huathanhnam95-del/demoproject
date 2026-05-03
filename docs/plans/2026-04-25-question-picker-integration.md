# Question Picker v7 Integration — Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Replace the current flat Read Aloud question `<select>` dropdown and inline control buttons with the v7 sticky header bar + shared Jump/Filter slide-out sheet, making the UI consistent and modern.

**Architecture:** The existing RA panel lives in `public/index.html` (lines ~3054–3225). Question navigation uses a visible `<select id="ra-question-select">` populated dynamically by `read-aloud-mode.js` (`populateQuestionSelect`, line 606). The v7 mockup introduces three new DOM zones: (1) a sticky header bar with Prev/Next pill, question pill, record CTA, filter button, and audio shortcuts; (2) a full-height slide-out sheet (bottom-sheet on mobile, right-panel on desktop) with Jump and Filter tabs; (3) a hidden `<select>` that preserves the existing value semantics for JS compatibility. New CSS is extracted from Tailwind into vanilla classes.

**Tech Stack:** Vanilla HTML/CSS/JS. No framework, no Tailwind in production (styles converted to vanilla CSS classes).

**Reference Mockup:** `docs/plans/question-picker-mockup-v7.html`

---

## Scope & Non-Goals

### In Scope

- Read Aloud mode only (RA-specific integration)
- Sticky header bar with navigation, record CTA, filter, and audio controls
- Jump/Filter slide-out sheet with search, question list, and filter controls
- Vanilla CSS extracted from Tailwind mockup
- Full keyboard accessibility (focus trap, Escape close, Tab cycling)
- Preserving all existing `read-aloud-mode.js` wiring (the `setButtonLabels` contract already done)

### Non-Goals (Deferred)

- Applying the same pattern to other practice modes (ASQ, SGD, Essay, etc.)
- History/Previous button logic (placeholder `disabled` for now)
- Server-side filtering or pagination
- Mobile-app specific packaging

---

## Task 1: Extract v7 CSS into `style-ra-controlbar.css`

**Files:**

- Create: `public/style-ra-controlbar.css`
- Modify: `public/index.html` (add `<link>` tag)

**What:** Convert all Tailwind utility classes from the v7 mockup into semantic vanilla CSS classes. This keeps `index.html` clean and avoids Tailwind dependency.

**Key CSS classes to define:**

```css
/* Sticky Control Bar */
.ra-control-bar { ... }
.ra-nav-pill { ... }
.ra-question-pill { ... }
.ra-header-btn { ... }
.ra-record-cta { ... }
.ra-stop-cta { ... }

/* Slide-out Sheet */
.ra-sheet-backdrop { ... }
.ra-sheet { ... }
.ra-sheet--open { ... }
.ra-sheet-header { ... }
.ra-sheet-tabs { ... }
.ra-sheet-tab { ... }
.ra-sheet-tab--active { ... }
.ra-sheet-content { ... }
.ra-sheet-footer { ... }

/* Jump Tab */
.ra-jump-search { ... }
.ra-jump-quick-nav { ... }
.ra-jump-list { ... }
.ra-jump-item { ... }
.ra-jump-item--current { ... }

/* Filter Tab */
.ra-filter-group { ... }
.ra-filter-segmented { ... }
.ra-filter-chip { ... }
.ra-filter-chip--active { ... }
.ra-filter-status-grid { ... }

/* Mobile Action Menu */
.ra-mobile-actions { ... }

/* Responsive overrides */
@media (max-width: 640px) { ... }
```

**Step 1:** Create the CSS file with all classes converted from the mockup's Tailwind utilities.

**Step 2:** Add `<link rel="stylesheet" href="/style-ra-controlbar.css">` to `index.html` `<head>`, after the existing `style-practice-compact.css` link.

**Step 3:** Commit.

```bash
git add public/style-ra-controlbar.css public/index.html
git commit -m "feat(ra): add vanilla CSS for question picker control bar and sheet"
```

---

## Task 2: Add Control Bar and Sheet HTML to `index.html`

**Files:**

- Modify: `public/index.html`

**What:** Insert the v7 sticky header bar, slide-out sheet, and backdrop HTML into the RA mode panel. The HTML is placed _inside_ the `mode-read-aloud` panel (or just above the existing RA content area) so it's only visible when RA is active.

**Step 1:** Locate the RA panel section. Currently the RA content begins at the timers (line ~3054, `ra-status-bar`) and extends to the controls (line ~3224). The control bar goes _before_ the timers. The sheet/backdrop go after `</main>` closing tag or as siblings to the mode panel.

**HTML to insert before `ra-status-bar` (line ~3054):**

```html
<!-- RA Control Bar (sticky header) -->
<header id="ra-control-bar" class="ra-control-bar" style="display: none;">
  <div class="ra-control-bar__left">
    <div class="ra-mode-badge">RA</div>
    <h1 class="ra-mode-title">Read Aloud</h1>
  </div>

  <div class="ra-control-bar__center">
    <div class="ra-nav-pill">
      <button id="ra-prev-btn" disabled title="Previous Question" class="ra-nav-arrow ra-nav-arrow--disabled">
        <svg><!-- chevron-left --></svg>
        <span data-label class="sr-only">Previous</span>
      </button>
      <button id="ra-question-pill" class="ra-question-pill">
        Loading...
      </button>
      <button id="ra-next-btn" title="Next Question" class="ra-nav-arrow">
        <svg><!-- chevron-right --></svg>
        <span data-label class="sr-only">Next</span>
      </button>
    </div>
  </div>

  <div class="ra-control-bar__right">
    <!-- Filter chips (desktop only) -->
    <span id="ra-active-filter-chip" class="ra-active-filter-chip" style="display: none;">
      <!-- Dynamically shows active filter summary -->
    </span>
    <button id="ra-open-filter-btn" class="ra-header-btn ra-header-btn--filter">
      <svg><!-- funnel icon --></svg>
      <span class="ra-header-btn__label">Filters</span>
      <span id="ra-filter-badge" class="ra-filter-badge" style="display: none;">0</span>
    </button>

    <!-- Audio shortcuts (desktop) -->
    <div class="ra-header-audio-group">
      <button id="header-ra-play-audio-btn" title="Play Sample" class="ra-header-btn ra-header-btn--audio">
        <svg><!-- play-circle --></svg>
      </button>
      <button id="header-ra-play-recording-btn" title="Your Playback" class="ra-header-btn ra-header-btn--audio" disabled>
        <svg><!-- speaker-wave --></svg>
      </button>
    </div>

    <!-- Mobile overflow -->
    <button id="ra-mobile-overflow-btn" class="ra-header-btn ra-mobile-overflow-trigger">
      <svg><!-- dots-vertical --></svg>
    </button>
    <div id="ra-mobile-actions-menu" class="ra-mobile-actions" style="display: none;">
      <!-- Play Sample / Your Playback buttons for mobile -->
    </div>

    <!-- Primary CTA -->
    <button id="ra-record-btn" class="ra-record-cta" disabled>
      <svg class="ra-record-cta__icon"><!-- microphone --></svg>
      <span class="ra-record-cta__label--full" data-label>Start Recording</span>
      <span class="ra-record-cta__label--short" data-label-short>Start</span>
    </button>
    <button id="ra-stop-btn" class="ra-stop-cta" style="display: none;">
      <svg class="ra-stop-cta__icon"><!-- stop-circle --></svg>
      <span class="ra-stop-cta__label--full" data-label>Stop Recording</span>
      <span class="ra-stop-cta__label--short" data-label-short>Stop</span>
    </button>
  </div>
</header>

<!-- Hidden select preserving existing JS value semantics -->
<select id="ra-question-select" class="sr-only" aria-hidden="true" tabindex="-1">
  <option value="random">Loading...</option>
</select>
```

**HTML to insert at end of RA section (before `</main>` or as global siblings):**

```html
<!-- Sheet Backdrop -->
<div id="ra-sheet-backdrop" class="ra-sheet-backdrop" style="display: none;"></div>

<!-- Jump/Filter Sheet -->
<div id="ra-filter-sheet" class="ra-sheet" role="dialog" aria-modal="true"
     aria-labelledby="ra-sheet-title" tabindex="-1">
  <!-- Header -->
  <div class="ra-sheet-header">
    <div class="ra-sheet-handle" aria-hidden="true"></div>
    <h2 id="ra-sheet-title" class="ra-sheet-title">Jump & Filter</h2>
    <button id="ra-sheet-close-btn" class="ra-sheet-close" aria-label="Close dialog">
      <svg><!-- x-mark --></svg>
    </button>
  </div>

  <!-- Tabs -->
  <div class="ra-sheet-tabs" role="tablist">
    <button id="ra-tab-btn-jump" role="tab" aria-selected="true" aria-controls="ra-tab-jump"
            class="ra-sheet-tab ra-sheet-tab--active">Jump</button>
    <button id="ra-tab-btn-filter" role="tab" aria-selected="false" aria-controls="ra-tab-filter"
            class="ra-sheet-tab">Filters
      <span id="ra-filter-tab-dot" class="ra-filter-dot" style="display: none;"></span>
    </button>
  </div>

  <!-- Scrollable Content -->
  <div class="ra-sheet-content" id="ra-sheet-content-scroll">
    <!-- JUMP TAB -->
    <div id="ra-tab-jump" role="tabpanel" tabindex="0" aria-labelledby="ra-tab-btn-jump"
         class="ra-tab-content ra-tab-content--active">
      <div class="ra-jump-search-wrapper">
        <svg class="ra-jump-search-icon"><!-- search --></svg>
        <input type="search" id="ra-jump-search" class="ra-jump-search"
               aria-label="Search questions"
               placeholder="Search by ID, title, or excerpt...">
      </div>
      <div class="ra-jump-quick-nav">
        <h3 class="ra-section-label">Quick Navigation</h3>
        <div class="ra-jump-quick-buttons">
          <button id="ra-jump-recommended" class="ra-jump-quick-btn ra-jump-quick-btn--primary">
            Recommended Next
          </button>
          <button id="ra-jump-random" class="ra-jump-quick-btn">
            Random Question
          </button>
        </div>
      </div>
      <div class="ra-jump-results">
        <h3 class="ra-section-label">
          <span>Matching Questions</span>
          <span id="ra-jump-result-count" class="ra-result-count">0 results</span>
        </h3>
        <div id="ra-jump-list" class="ra-jump-list">
          <!-- Dynamically populated by JS -->
        </div>
      </div>
    </div>

    <!-- FILTER TAB -->
    <div id="ra-tab-filter" role="tabpanel" tabindex="0" aria-labelledby="ra-tab-btn-filter"
         class="ra-tab-content">

      <!-- Status Filter -->
      <div class="ra-filter-group">
        <div class="ra-filter-group__header">
          <h3 class="ra-section-label">Status</h3>
          <span class="ra-filter-hint">Select multiple</span>
        </div>
        <div id="ra-filter-status-grid" class="ra-filter-status-grid">
          <!-- Status checkboxes: Not Started, In Progress, Completed, Consolidated, Mastered -->
        </div>
      </div>

      <!-- Sample Audio Filter -->
      <fieldset class="ra-filter-group">
        <legend class="ra-section-label">Sample Audio</legend>
        <div class="ra-filter-segmented">
          <label class="ra-segment">
            <input type="radio" name="ra-sample-audio" value="all" class="sr-only peer">
            <div class="ra-segment__label">Any</div>
          </label>
          <label class="ra-segment">
            <input type="radio" name="ra-sample-audio" value="available" class="sr-only peer">
            <div class="ra-segment__label">Has Sample</div>
          </label>
          <label class="ra-segment">
            <input type="radio" name="ra-sample-audio" value="unavailable" class="sr-only peer">
            <div class="ra-segment__label">None</div>
          </label>
        </div>
      </fieldset>

      <!-- Difficulty Filter -->
      <fieldset class="ra-filter-group">
        <legend class="ra-section-label">Difficulty</legend>
        <div class="ra-filter-segmented">
          <label class="ra-segment">
            <input type="radio" name="ra-difficulty" value="any" checked class="sr-only peer">
            <div class="ra-segment__label">Any</div>
          </label>
          <label class="ra-segment">
            <input type="radio" name="ra-difficulty" value="easy" class="sr-only peer">
            <div class="ra-segment__label">Easy</div>
          </label>
          <label class="ra-segment">
            <input type="radio" name="ra-difficulty" value="medium" class="sr-only peer">
            <div class="ra-segment__label">Medium</div>
          </label>
          <label class="ra-segment">
            <input type="radio" name="ra-difficulty" value="hard" class="sr-only peer">
            <div class="ra-segment__label">Hard</div>
          </label>
        </div>
      </fieldset>

      <!-- Prompt Features (RA-specific) -->
      <div class="ra-filter-group">
        <div class="ra-filter-group__header">
          <h3 class="ra-section-label">Prompt Features</h3>
          <span class="ra-badge ra-badge--mode">RA Specific</span>
        </div>
        <div id="ra-filter-features-chips" class="ra-filter-chips">
          <!-- Feature filter chips: Any connected speech, Linking, Reduced words, Sound changes -->
        </div>
      </div>
    </div>
  </div>

  <!-- Footer (Filter tab only) -->
  <div id="ra-sheet-footer" class="ra-sheet-footer" style="display: none;">
    <button id="ra-filter-clear-btn" class="ra-sheet-footer__clear">Clear</button>
    <button id="ra-filter-done-btn" class="ra-sheet-footer__done">Done</button>
  </div>
</div>
```

**Step 2:** Remove or hide the OLD inline controls that are now superseded:

- The old `ra-next-btn` and `ra-record-btn` inside `.function-group` (lines 3206–3219) — hide these with `style="display: none;"` and mark them `aria-hidden="true"`. They stay in the DOM for any legacy references but the new header buttons take over.
- The visible `<select id="ra-question-select">` (if created in JS) becomes hidden via the `sr-only` class.

**Step 3:** Commit.

```bash
git add public/index.html
git commit -m "feat(ra): add control bar and jump/filter sheet HTML"
```

---

## Task 3: Add Sheet Controller JS — `public/js/ra-sheet-controller.js`

**Files:**

- Create: `public/js/ra-sheet-controller.js`
- Modify: `public/index.html` (add `<script>` tag)

**What:** Self-contained JS module that handles:

- Opening/closing the sheet (backdrop click, Escape key, close button)
- Tab switching (Jump ↔ Filter), including footer visibility
- Focus trap (the optimized `refreshFocusTrap` from the mockup)
- Search filtering in the Jump list
- Populating the Jump list from `ReadAloudMode.getFilteredDatabase()`
- Wiring the filter controls to `ReadAloudMode.setSampleAudioFilter()`, `ReadAloudMode.setPromptFeatureFilter()`, etc.
- Syncing the question pill text from the hidden `<select>`
- Mobile action menu toggle

**Key API surface:**

```javascript
window.RASheetController = {
  open(tab),          // 'jump' | 'filter'
  close(),
  switchTab(tabId),
  refreshJumpList(),
  refreshFilterState(),
  syncQuestionPill(),
  
  // Internal
  _refreshFocusTrap(),
  _onSearch(query),
  _onJumpItemClick(index),
  _onDone(),
  _onClear(),
};
```

**Step 1:** Create `public/js/ra-sheet-controller.js` with all functions.

**Step 2:** Add `<script src="js/ra-sheet-controller.js"></script>` to `index.html`, after the `read-aloud-mode.js` script tag.

**Step 3:** Commit.

```bash
git add public/js/ra-sheet-controller.js public/index.html
git commit -m "feat(ra): add sheet controller JS for jump/filter panel"
```

---

## Task 4: Wire Control Bar Buttons in `read-aloud-mode.js`

**Files:**

- Modify: `public/read-aloud-mode.js`

**What:** Add event listener bindings for the new header buttons and sync the question pill whenever the prompt changes.

**Changes:**

1. **In the constructor / `init` method** (around line 156–213): Add bindings for:
   - `ra-question-pill` → `RASheetController.open('jump')`
   - `ra-open-filter-btn` → `RASheetController.open('filter')`
   - `ra-prev-btn` → no-op (disabled placeholder)
   - `ra-mobile-overflow-btn` → toggle mobile actions menu
   - `ra-sheet-close-btn` → `RASheetController.close()`
   - `ra-sheet-backdrop` → `RASheetController.close()`
   - `ra-jump-random` → `ReadAloudMode.loadNextPrompt()`
   - `ra-filter-done-btn` → `RASheetController.close()`
   - `ra-filter-clear-btn` → reset all filters and close

2. **In `loadSpecificPrompt` / after prompt load** (around `syncQuestionSelectValue`): Also call `RASheetController.syncQuestionPill()` to update the pill text.

3. **In `populateQuestionSelect`**: Also call `RASheetController.refreshJumpList()` to sync the jump tab.

4. **Show/hide `ra-control-bar`** in `onEnter()` / `onExit()`:
   - `onEnter()`: set `ra-control-bar.style.display = ''`
   - `onExit()`: set `ra-control-bar.style.display = 'none'`

**Step 1:** Apply the modifications.

**Step 2:** Commit.

```bash
git add public/read-aloud-mode.js
git commit -m "feat(ra): wire control bar and sheet to ReadAloudMode lifecycle"
```

---

## Task 5: Remove Old Inline Navigation Controls

**Files:**

- Modify: `public/index.html`

**What:** Fully hide the old inline question selector and bottom control buttons that have been superseded by the header bar. Specifically:

- The old `#ra-read-aloud-controls .function-group` div (lines 3203–3221): set `display: none`.
- Keep the `<audio>` elements (`ra-user-recording-audio`, `ra-elevenlabs-audio`) where they are — they are headless and not affected.
- Hide the old `ra-play-audio-btn` inside the inline audio player section (line 3148–3149) since the header now has `header-ra-play-audio-btn`.

> [!WARNING]
> Do NOT delete the old elements — set them to `display: none; aria-hidden: true`. The `setButtonLabels` refactor already supports both old and new IDs via the proxy pattern. Future cleanup can remove the old DOM once the new UI is stable.

**Step 1:** Apply the changes.

**Step 2:** Commit.

```bash
git add public/index.html
git commit -m "refactor(ra): hide superseded inline navigation controls"
```

---

## Task 6: CSS Refinements & Responsive Testing

**Files:**

- Modify: `public/style-ra-controlbar.css`

**What:** Fine-tune responsive breakpoints, color variables (map to existing `--primary`, `--text-main`, etc.), and ensure the sheet animation matches the mockup's `transition-transform duration-300` behavior.

**Key CSS details:**

- Sheet transform: `translateY(100%)` → `translateY(0)` for mobile; `translateX(100%)` → `translateX(0)` for desktop.
- Focus-visible ring on all interactive elements: `outline: 2px solid var(--primary); outline-offset: 2px`
- `peer-checked` → `.ra-segment input:checked + .ra-segment__label` selector pattern
- Safe area padding: `padding-bottom: env(safe-area-inset-bottom, 16px)`

**Step 1:** Refine the CSS.

**Step 2:** Commit.

```bash
git add public/style-ra-controlbar.css
git commit -m "style(ra): refine responsive breakpoints and sheet animations"
```

---

## Verification Plan

### Automated Tests

#### 1. Existing Regression Test Suite

**Command:**

```bash
node tests/read-aloud-mode-regression.test.js
```

**What it covers:** All existing RA flows — unsupported/supported device flow, chunking, assessment guards, microphone, audio filter, prompt feature filters, speech coach, and the `assertButtonMarkupIntegrity` guardrail added earlier in this session.

**Expected result:** All assertions pass. The hidden `ra-question-select` must still be callable by JS.

#### 2. New Test: `assertControlBarLifecycle` (append to `tests/read-aloud-mode-regression.test.js`)

**Command:** Same as above.

**What to test:**

- `ra-control-bar` is `display: none` before entering RA mode
- `ra-control-bar` becomes visible after `switchToMode('read-aloud')`
- `ra-question-pill` text updates after `loadSpecificPrompt(0)`
- `ra-next-btn` click advances to the next prompt
- `ra-control-bar` returns to `display: none` after exiting RA mode
- `ra-record-btn` CTA retains SVG and `[data-label]` spans after state transitions

#### 3. New Test: `assertSheetOpenClose` (append to `tests/read-aloud-mode-regression.test.js`)

**What to test:**

- Clicking `ra-open-filter-btn` shows `ra-sheet-backdrop` and opens the sheet
- `ra-filter-sheet` has the correct `role="dialog"` and `aria-modal="true"`
- Tab switching between Jump and Filter shows/hides the correct tab panels and footer
- Clicking `ra-sheet-close-btn` or backdrop closes the sheet
- Pressing `Escape` closes the sheet
- Focus returns to the trigger element after close

### Manual Verification

> [!IMPORTANT]
> After automated tests pass, manually verify in a browser at <http://localhost:PORT>.

1. **Desktop (≥1024px):** Enter Read Aloud mode → sticky bar appears → click question pill → right-side sheet slides in → search works → click a question → sheet closes → prompt loads → click Filters → filter tab shows → toggle "Has Sample" → click Done → sheet closes → dropdown re-filtered
2. **Mobile (≤640px):** Same flow but sheet appears as bottom sheet → handle visible → 3-dot menu shows audio actions
3. **Keyboard-only navigation:** Tab through header → open sheet via Enter → Tab through sheet controls → Shift+Tab wraps → Escape closes → focus returns
4. **Screen reader:** Verify `role="dialog"`, `aria-modal`, `aria-labelledby`, and `aria-live` regions announce correctly

---

## Dependency Graph

```
Task 1 (CSS) ──┐
               ├──► Task 2 (HTML) ──► Task 4 (Wire JS) ──► Task 5 (Remove old UI)
Task 3 (Sheet JS) ─┘                                            │
                                                                 ▼
                                                          Task 6 (Polish)
                                                                 │
                                                                 ▼
                                                         Verification
```

Tasks 1 and 3 can be done in parallel. Task 2 depends on both. Task 4 depends on Task 2. Task 5 depends on Task 4. Task 6 is a polish pass after everything works.
