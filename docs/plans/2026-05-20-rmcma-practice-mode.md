# Multiple Choice Multiple Answers (RMCMA) Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Implement a new "Multiple Choice Multiple Answers" (RMCMA) reading practice mode, complete with dynamic Excel parsing, shuffling, color-coded submission verification, and AI-generated accordion explanations.

**Architecture:** Use Approach A: enrich the existing RMCMA.xlsx database with a new EXPLANATION column containing HTML detailed explanations generated via Gemini; then load the spreadsheet on-demand on the client side using the XLSX library (lazy-loaded), render with v7 layout picker elements, and verify answers with custom feedback styling.

**Tech Stack:** Vanilla JS, CSS, HTML5, XLSX, Vertex AI REST API, Python (Pandas/openpyxl).

---

### Task 1: Database Enrichment Script
Create a Python script to iterate over rows in `RMCMA.xlsx`, split and parse columns, fetch answers and questions, query Gemini, generate HTML explanations, and write them back into a new `EXPLANATION` column.

**Files:**
- Create: `public/database/RMCMA/enrich_rmcma.py`

**Step 1: Write the python script**
Write `public/database/RMCMA/enrich_rmcma.py` with code to parse columns, contact Gemini, and write in-place to `RMCMA.xlsx`.

**Step 2: Run enrichment**
Run: `python public/database/RMCMA/enrich_rmcma.py`
Expected output: Success messages showing all rows processed and saved to `RMCMA.xlsx`.

**Step 3: Commit**
```bash
git add public/database/RMCMA/enrich_rmcma.py public/database/RMCMA/RMCMA/RMCMA.xlsx
git commit -m "database: enrich RMCMA xlsx database with AI explanations"
```

---

### Task 2: Register RMCMA Practice Mode in Router
Register the new mode `rmcma` in `PRACTICE_LAUNCHER` and the scope configurations in `public/script.js`.

**Files:**
- Modify: `public/script.js`

**Step 1: Write code modifications**
1. Add `'rmcma'` to `PRACTICE_LAUNCHER.skills.reading.modeIds`.
2. Add `rmcma` definition block under `PRACTICE_LAUNCHER.modes`:
   ```javascript
   rmcma: {
     label: 'Multiple Choice Multiple Answers',
     skill: 'reading',
     hasTutorial: false,
     isLive: true,
     launcherVisible: true
   }
   ```
3. Add `'rmcma'` to `visibleModes` in both `SCOPE_ENGLISH` and `SCOPE_PTE` under `PRACTICE_SCOPE_CONFIG`.
4. In `ensureModeAssets`, add `'rmcma'` to the list of modes that trigger loading:
   `if (!['watch', 'notes', 'rfib', 'rmcma'].includes(mode)) return true;`
5. In `switchToMode(mode)` switch block or conditional blocks, show/hide the `mode-rmcma` element and call `window.RMCMAMode?.onEnter()` / `window.RMCMAMode?.onExit()`.

**Step 2: Run linter to check script.js**
Run: `npm run lint`
Expected output: No lint errors in `public/script.js`.

**Step 3: Commit**
```bash
git add public/script.js
git commit -m "router: register rmcma reading mode and add lifecycle hook in script.js"
```

---

### Task 3: Setup Lazy Loader
Update `public/js/lazy-loader.js` to ensure the `rmcma-mode.js` controller script is lazy-loaded along with its `xlsx` dependency.

**Files:**
- Modify: `public/js/lazy-loader.js`

**Step 1: Write code modifications**
1. Add `ensureRmcmaModeLoaded()` which calls `ensureXlsxLoaded()` and loads `rmcma-mode.js`.
2. In `ensureModeScripts(mode)`, add `if (mode === 'rmcma')` checks.

**Step 2: Run linter**
Run: `npm run lint`
Expected output: PASS with no lint errors.

**Step 3: Commit**
```bash
git add public/js/lazy-loader.js
git commit -m "loader: add lazy loading support for rmcma practice mode"
```

---

### Task 4: Add HTML Templates for RMCMA Pane
Add the RMCMA CSS link to the head and the section template to `public/index.html` at line 2576.

**Files:**
- Modify: `public/index.html`

**Step 1: Write HTML markup**
1. Add `<link rel="stylesheet" href="rmcma-mode.css">` to the head near other mode styles.
2. Add the `<div id="mode-rmcma" class="mode-panel" style="display: none;">` content block at line 2576. It will contain:
   * A v7 Picker Bar (`rmcma-v7-picker-bar`) and dialog sheet (`rmcma-v7-sheet`).
   * A two-pane split area: Left pane showing the passage, Right pane showing the question and choices.
   * Action buttons: Submit, Retry, and Show Explanation accordion block.
3. Add a script script tag reference at the bottom of the file (or let the lazy loader load it):
   `<script src="/rmcma-mode.js" defer></script>` is NOT needed since it's lazy-loaded via the launcher/lazy-loader.

**Step 2: Verify HTML syntax**
Run: Check that page loads in browser without template errors.

**Step 3: Commit**
```bash
git add public/index.html
git commit -m "templates: add layout and v7 question picker elements for rmcma in index.html"
```

---

### Task 5: Implement RMCMA Mode Stylesheet
Create the stylesheet defining layouts, hover states, card selections, checkboxes, correction colors, and explanations.

**Files:**
- Create: `public/rmcma-mode.css`

**Step 1: Write CSS classes**
Define standard style variables, layout classes (`.rmcma-split-container`, `.rmcma-passage-panel`, `.rmcma-question-panel`), choice cards, states (`.is-correct`, `.is-incorrect`, `.is-missed`), and the explanation section.

**Step 2: Commit**
```bash
git add public/rmcma-mode.css
git commit -m "styles: create custom stylesheet for rmcma reading practice mode"
```

---

### Task 6: Implement RMCMA Mode Controller Logic
Create the core JS controller that loads the Excel file, parses question data, shuffles options, handles user input/selection, verifies answers, and toggles detailed explanations.

**Files:**
- Create: `public/rmcma-mode.js`

**Step 1: Write the javascript controller**
Create `public/rmcma-mode.js` with:
- State object: `questions`, `currentIndex`, `selectedOptions`, `submitted`.
- XLSX loading: Fetch `RMCMA.xlsx`, load sheet, parse to JSON.
- Parser: Regular expressions to split cells into `passage`, `question`, `choices` (an array of `{ text, isCorrect }`).
- Render engine:
  - Populate passage container.
  - Shuffle and display choice cards. Each card will have a checkbox.
- Actions:
  - Submit: Marks checked choices as green (correct) or red (incorrect), missed correct answers as dashed green. Displays scores.
  - Show Explanation: Collapses/expands explanation HTML block.
  - Retry: Resets selections, reshuffles, clears states.
- Expose `RMCMAMode` globally.

**Step 2: Run linter on new js file**
Run: `eslint public/rmcma-mode.js`
Expected output: No lint warnings/errors.

**Step 3: Commit**
```bash
git add public/rmcma-mode.js
git commit -m "logic: implement rmcma mode controller logic with parsing, shuffling, and verification"
```

---

### Task 7: Automated Browser Test and Verification
Write and execute a Playwright regression check for the RMCMA practice mode.

**Files:**
- Create: `tests/browser/rmcma-mode-browser-check.js`

**Step 1: Write the Playwright test**
Create `tests/browser/rmcma-mode-browser-check.js` modeling `tests/browser/rfib-mode-browser-check.js` to run the dev server on a dynamic port, load the practice site, enter `rmcma` mode, verify question selection, option clicking, submission verification checks, and retry reset behavior.

**Step 2: Run the test**
Run: `node tests/browser/rmcma-mode-browser-check.js`
Expected output: `RMCMA browser check passed for question 1.`

**Step 3: Commit**
```bash
git add tests/browser/rmcma-mode-browser-check.js
git commit -m "tests: add automated playwright verification test for rmcma mode"
```
