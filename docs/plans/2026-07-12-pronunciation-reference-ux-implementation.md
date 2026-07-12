# Pronunciation Reference UX Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Ensure only validated en-US pronunciations are selectable and render syllable/stress information as an accurate, accessible learner aid.

**Architecture:** Preserve source conflicts in the backend contract for diagnostics, but derive a strict selectable view in the frontend. Capture and filter Merriam-Webster dialect labels at extraction time. Move pronunciation-summary formatting into pure frontend functions so count, primary stress, secondary stress, and syllable labels share one canonical input.

**Tech Stack:** Python 3.10/Flask, JavaScript ES modules, HTML/CSS, Node assertions, Playwright Chrome.

---

### Task 1: Lock backend dialect behavior

**Files:**
- Modify: `backend/test_pronunciation_api_v2.py`
- Modify: `backend/local_server/server.py`

**Steps:**
1. Add a failing `photograph` fixture with one US noun pronunciation, one British noun pronunciation, and one exact verb entry without `prs`.
2. Assert the API keeps the metadata-only verb conflict for audit evidence, excludes the British pronunciation, and selects the US pronunciation.
3. Run the focused unittest and confirm the British-filter assertion fails.
4. Capture MW pronunciation labels and reject explicitly non-US pronunciation records while constructing en-US variants.
5. Re-run the focused unittest and confirm it passes.

### Task 2: Lock selectable-variant behavior

**Files:**
- Modify: `tests/pronunciation-analyzer/reference-contract.test.mjs`
- Modify: `public/pronunciation-analyzer/reference-contract.js`
- Modify: `public/pronunciation-analyzer/app.js`

**Steps:**
1. Add a failing pure-function test asserting valid exact variants are selectable and conflict variants are not.
2. Confirm the test fails because no selector function exists.
3. Implement `getSelectableReferenceVariants` and use it for initial selection and variant buttons.
4. Confirm the focused Node test passes.

### Task 3: Build a canonical stress-summary model

**Files:**
- Create: `public/pronunciation-analyzer/pronunciation-summary.js`
- Create: `tests/pronunciation-analyzer/pronunciation-summary.test.mjs`

**Steps:**
1. Add failing tests for a monosyllable, `photograph`, missing orthographic labels, and invalid stress indices.
2. Confirm the tests fail because the module does not exist.
3. Implement a pure model derived only from `syllableCount`, `primaryStress`, `secondaryStress`, and canonical `syllables`.
4. Confirm the focused tests pass.

### Task 4: Render the accessible pronunciation summary

**Files:**
- Modify: `public/index.html`
- Modify: `public/pronunciation-analyzer/app.js`
- Modify: `public/pronunciation-analyzer/style.css`
- Modify: `tests/pronunciation-analyzer/reference-ui-contract.test.mjs`

**Steps:**
1. Add failing contract assertions for fact elements, syllable strip, screen-reader summary, and `aria-pressed` selector state.
2. Confirm the UI contract fails.
3. Replace the dense pattern row with semantic fact and syllable containers, render the pure model, and add responsive BEL styling without nested cards.
4. Confirm UI contract and pronunciation logic tests pass.

### Task 5: Audit and Chrome verification

**Files:**
- Modify: `scripts/audit/pronunciation-reference-audit.py`
- Modify: `tests/browser/pronounce-mode-browser-check.js`

**Steps:**
1. Add assertions that conflicted variants are never reported as learner-selectable and that en-US references contain no explicitly British pronunciation.
2. Run backend, frontend, and browser pronunciation suites.
3. Run the deterministic 100-word audit against the local candidate.
4. Verify `photograph` in Chrome at desktop and narrow viewport: one selectable pronunciation, no blank verb state, accurate `/ˈfoʊtəˌɡræf/`, and readable primary/secondary stress cues.
5. Commit only pronunciation-related files; do not deploy production without a separate explicit request.

