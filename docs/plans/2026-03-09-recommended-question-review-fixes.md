# Recommended Question Review Fixes Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Fix the two verified follow-up regressions in the recommended-question feature: `notes` being incorrectly coupled to adaptive UI state, and duplicate initial `notes` loads on first entry.

**Architecture:** Add one browser regression script that exercises the real lazy-loaded `notes` path, then fix the two issues with the smallest possible surface area. Keep the shared recommendation engine intact and confine behavior changes to `public/script.js` and `public/take-notes-mode.js`.

**Tech Stack:** Plain browser JavaScript, Playwright, existing `server.js`, Node `assert`, existing lazy loader, existing `notes` module.

---

**Path convention:** Browser regression scripts live under `tests/` and are runnable with `node ...`. Runtime fixes stay in the existing browser entry points under `public/`.

### Task 1: Decouple Notes From Adaptive UI

**Files:**
- Create: `tests/recommendation-notes-regression.test.js`
- Modify: `public/script.js`

**Step 1: Write the failing browser regression test**

Create `tests/recommendation-notes-regression.test.js` with a Playwright script that:

- starts `server.js` on an ephemeral local port
- opens the app in Chromium
- forces `window.DifficultyManager.globalSettings.autoAdjustEnabled = true`
- forces `#difficulty-filter-container-notes` to `display: block` before switching modes
- calls `window.switchToMode('notes')`
- asserts that the computed display for `#difficulty-filter-container-notes` remains `block`

Use this assertion shape:

```js
const assert = require('assert');
const { chromium } = require('playwright');
const { spawn } = require('child_process');

assert.equal(result.before, 'block');
assert.equal(result.after, 'block');
console.log('notes adaptive visibility regression test passed');
```

**Step 2: Run the regression to verify it fails**

Run: `node tests/recommendation-notes-regression.test.js`

Expected: FAIL with an assertion equivalent to:

```text
AssertionError [ERR_ASSERTION]: 'none' == 'block'
```

**Step 3: Write the minimal implementation**

Modify `public/script.js` so adaptive/manual UI synchronization only applies to `type`, `speak`, and `extended`.

Implementation requirements:

- add a single source of truth such as:

```js
const ADAPTIVE_UI_MODES = new Set(['type', 'speak', 'extended']);
```

- in `window.switchToMode`, only call `window.updateAdaptiveUI(mode)` when `mode` is in that set
- inside `initAdaptiveToggles`, make `window.updateAdaptiveUI(mode)` return immediately for unsupported modes
- do not let the adaptive toggle code hide or mutate `notes` difficulty-filter visibility

**Step 4: Run the regression to verify it passes**

Run: `node tests/recommendation-notes-regression.test.js`

Expected: PASS with:

```text
notes adaptive visibility regression test passed
```

**Step 5: Commit**

```bash
git add tests/recommendation-notes-regression.test.js public/script.js
git commit -m "fix: keep notes recommendations independent from adaptive ui"
```

### Task 2: Deduplicate The First Notes Load

**Files:**
- Modify: `tests/recommendation-notes-regression.test.js`
- Modify: `public/take-notes-mode.js`

**Step 1: Extend the regression test with a duplicate-load assertion**

Extend `tests/recommendation-notes-regression.test.js` to wrap `firebase.firestore()` before the first `window.switchToMode('notes')` call and count how many times:

```js
db.collection('takeNotesEntries').get()
```

is invoked during the first entry into `notes`.

Add this assertion:

```js
assert.equal(result.notesGetCount, 1);
console.log('notes initial load dedupe regression test passed');
```

Expected result object shape:

```js
{
  before: 'block',
  after: 'block',
  notesGetCount: 1
}
```

**Step 2: Run the regression to verify it fails**

Run: `node tests/recommendation-notes-regression.test.js`

Expected: FAIL with an assertion equivalent to:

```text
AssertionError [ERR_ASSERTION]: 2 == 1
```

**Step 3: Write the minimal implementation**

Modify `public/take-notes-mode.js` to deduplicate concurrent first-load requests without changing later manual refresh behavior.

Implementation requirements:

- add a module-scoped in-flight promise, for example:

```js
let loadEntriesPromise = null;
```

- make `loadEntries()` return the existing in-flight promise when a load is already running
- clear `loadEntriesPromise` in `finally`
- keep the existing Firestore-to-Excel fallback behavior intact
- keep the public API name `loadEntries` intact so current callers do not need to change

Minimal structure:

```js
async function loadEntries() {
  if (loadEntriesPromise) return loadEntriesPromise;
  loadEntriesPromise = (async () => {
    // existing load logic
  })();
  try {
    return await loadEntriesPromise;
  } finally {
    loadEntriesPromise = null;
  }
}
```

**Step 4: Run the regression to verify it passes**

Run: `node tests/recommendation-notes-regression.test.js`

Expected: PASS with both log lines:

```text
notes adaptive visibility regression test passed
notes initial load dedupe regression test passed
```

**Step 5: Commit**

```bash
git add tests/recommendation-notes-regression.test.js public/take-notes-mode.js
git commit -m "fix: dedupe first notes load for recommendations"
```

### Task 3: Final Verification For The Full Feature

**Files:**
- Verify: `public/js/question-recommendation-engine.js`
- Verify: `public/index.html`
- Verify: `public/style.css`
- Verify: `public/script.js`
- Verify: `public/take-notes-mode.js`
- Verify: `tests/question-recommendation-engine.test.mjs`
- Verify: `tests/recommendation-ui-shape.test.js`
- Verify: `tests/recommendation-notes-regression.test.js`

**Step 1: Run automated verification**

Run:

```bash
node tests/question-recommendation-engine.test.mjs
node tests/recommendation-ui-shape.test.js
node tests/recommendation-notes-regression.test.js
```

Expected:

- engine test PASS
- UI shape test PASS
- notes regression test PASS

**Step 2: Run manual verification**

Verify in the browser:

1. `type` in manual mode:
   - `Recommended` is visible
   - clicking it jumps to a different visible item
2. `speak` in manual mode:
   - `Recommended` stays inside the active filtered dropdown set
3. `extended` in manual mode:
   - `Recommended` stays inside the active filtered dropdown set
4. `type`, `speak`, and `extended` in adaptive mode:
   - recommendation controls are hidden
5. `notes`:
   - difficulty filter stays visible when unlocked
   - `Recommended` still works
   - first entry into `notes` does not trigger a duplicate load/reset

**Step 3: Push and request follow-up review**

```bash
git push
```

Then request a focused review of the two fixes against the original review findings.
