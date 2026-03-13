# Practice Mode UI Regression Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Restore stable practice-mode rendering after the recent UI rewrite by fixing the markup/script contract, removing text-encoding corruption, and adding browser verification for dashboard-to-mode flows.

**Architecture:** Treat `public/index.html` and `public/script.js` as the source of truth for the practice-mode shell. Stop relying on ad hoc regex rewrite scripts as the effective implementation layer. Reconcile the DOM contract first, then repair corrupted literals, then lock behavior with a focused browser smoke test.

**Tech Stack:** Static HTML/CSS/JS, Express static serving, Playwright browser smoke tests, Service Worker cache busting.

---

### Task 1: Lock Down The Actual Regression Surface

**Files:**
- Modify: `public/index.html`
- Modify: `public/script.js`
- Modify: `public/difficulty-filter.js`
- Test: `tests/browser/practice-modes-browser-check.js`

**Step 1: Write the failing browser smoke test**

Create a browser test that:
- Loads `/index.html`
- Verifies the dashboard renders without uncaught page errors
- Enters `type`, `speak`, and `extended` modes
- Asserts each mode shows its expected filter controls and navigation shell
- Fails on console warnings containing `Difficulty filter elements not found`

**Step 2: Run test to verify it fails**

Run: `node tests/browser/practice-modes-browser-check.js`
Expected: FAIL because `type` and `speak` currently do not provide `difficulty-filter-*` elements while `public/difficulty-filter.js` still initializes them.

**Step 3: Document the DOM contract**

Define, in code comments near the selectors, whether `type` and `speak` should:
- keep difficulty filters and restore the missing markup, or
- intentionally drop difficulty filters and stop initializing them

Use one consistent contract across `public/index.html`, `public/script.js`, and `public/difficulty-filter.js`.

**Step 4: Run test to verify the contract is enforced**

Run: `node tests/browser/practice-modes-browser-check.js`
Expected: PASS for dashboard load and mode entry assertions.

**Step 5: Commit**

```bash
git add public/index.html public/script.js public/difficulty-filter.js tests/browser/practice-modes-browser-check.js
git commit -m "fix: restore practice mode DOM contract"
```

### Task 2: Remove Encoding Corruption From User-Facing UI Strings

**Files:**
- Modify: `public/script.js`
- Modify: `public/index.html`
- Modify: `public/style.css`
- Modify: `fix-ui.js`
- Modify: `fix-ui-filters.js`
- Modify: `fix-ui-clean.js`

**Step 1: Write a regression check for mojibake**

Add a small assertion in the browser smoke test, or a separate Node test, that fails if rendered UI text contains common corruption markers such as `Ã`, `â†`, or `ðŸ`.

**Step 2: Run test to verify it fails**

Run: `node tests/browser/practice-modes-browser-check.js`
Expected: FAIL because current rewritten strings include mojibake in multiple labels/icons.

**Step 3: Replace corrupted literals with stable text**

Normalize user-facing strings in `public/script.js` and `public/index.html`.
- Prefer plain ASCII labels where icons are optional.
- Only keep Unicode where it is already safely handled by the file encoding.
- Remove corrupted replacements from the helper scripts so they cannot reintroduce bad text later.

**Step 4: Run test to verify it passes**

Run: `node tests/browser/practice-modes-browser-check.js`
Expected: PASS with no mojibake markers in rendered text.

**Step 5: Commit**

```bash
git add public/script.js public/index.html public/style.css fix-ui.js fix-ui-filters.js fix-ui-clean.js tests/browser/practice-modes-browser-check.js
git commit -m "fix: remove practice mode text encoding corruption"
```

### Task 3: Replace Fragile Rewrite Scripts With One Safe Recovery Path

**Files:**
- Modify: `fix-ui.js`
- Modify: `fix-ui-filters.js`
- Modify: `fix-ui-clean.js`
- Optional Create: `scripts/repair-practice-mode-ui.js`
- Optional Delete: obsolete duplicate repair scripts if no longer needed

**Step 1: Write a failing script-level check**

Add a simple verification command that:
- runs the repair script in dry-run mode or against a temp copy
- asserts it produces valid output without duplicated sections or corrupted strings

**Step 2: Run check to verify current scripts are unsafe**

Run: the chosen verification command against the existing repair scripts.
Expected: FAIL or manual confirmation that the scripts contain corrupted literals and overlapping rewrite responsibilities.

**Step 3: Consolidate to one deterministic repair mechanism**

Choose one of these approaches:
- remove the repair scripts entirely if they are no longer needed, or
- replace them with one idempotent script that edits known anchors safely and preserves UTF-8

Do not keep multiple overlapping regex-based rewrite scripts that mutate the same `public/index.html` regions.

**Step 4: Verify the repair path**

Run the repair verification command and then rerun the browser smoke test.
Expected: PASS with no duplicated markup and no encoding corruption.

**Step 5: Commit**

```bash
git add fix-ui.js fix-ui-filters.js fix-ui-clean.js scripts/repair-practice-mode-ui.js tests/browser/practice-modes-browser-check.js
git commit -m "chore: consolidate practice mode repair tooling"
```

### Task 4: Re-verify Cache Behavior Only After Markup Is Stable

**Files:**
- Modify: `public/index.html`
- Modify: `public/sw.js`

**Step 1: Write a verification checklist**

Confirm that cache busting only changes after the repaired assets are final:
- stylesheet version string
- `script.js` version string
- Service Worker cache version

**Step 2: Run browser test on a fresh load**

Run: `node tests/browser/practice-modes-browser-check.js`
Expected: PASS on a clean browser context after asset version updates.

**Step 3: Apply final cache version bump if required**

Only bump asset versions once after Tasks 1-3 are complete, so stale broken JS/CSS cannot persist.

**Step 4: Re-run verification**

Run: `node tests/browser/practice-modes-browser-check.js`
Expected: PASS with the updated asset references.

**Step 5: Commit**

```bash
git add public/index.html public/sw.js tests/browser/practice-modes-browser-check.js
git commit -m "fix: finalize cache busting for repaired practice mode ui"
```
