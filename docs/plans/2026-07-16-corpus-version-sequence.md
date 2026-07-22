# Corpus Pronunciation Version Sequence Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Add deterministic clean/omission/insertion/accented/unrateable recording versions with inline instructions and Previous/Next Version navigation.

**Architecture:** Keep the existing corpus recorder and save endpoint. Add a client-side version definition table, derive metadata and instructions from the current word plus version, and add guarded navigation around the existing recording/save state. Keep each version as its own sample record and preserve the existing analyzer.

**Tech Stack:** Vanilla browser JavaScript, static CRM HTML, existing Firebase-authenticated API, Playwright Chrome regression tests.

**Status:** Complete and production-verified in commit `d10acf65`.

---

### Task 1: Add failing browser coverage for the version sequence

**Status:** Complete

**Files:**
- Modify: `tests/browser/crm-pronunciation-samples-browser-check.js`

**Steps:**
1. Extend the mocked CRM flow to assert the version indicator, inline clean instruction, disabled category/count controls, Previous Version button, and Next Version button.
2. Add assertions that Next Version changes metadata and instruction to omission, insertion, accented, and unrateable in order, with expected counts target-1, target+1, target, and 0 respectively.
3. Add an assertion that Previous Version returns to the preceding version and that an unsaved captured recording requires confirmation before navigation.
4. Run `node tests/browser/crm-pronunciation-samples-browser-check.js`; the new assertions must fail before implementation.

### Task 2: Implement the deterministic version model and inline guidance

**Status:** Complete

**Files:**
- Modify: `public/crm-admin.js`
- Modify: `public/crm-admin.html`

**Steps:**
1. Add a fixed five-entry version definition table with category, label, expected-count policy, and detailed instruction generator.
2. Track `currentVersionIndex` independently from the current word; reset it to clean when a word is selected or Next Word is used.
3. Add `applyCurrentVersion()` to update the locked category, expected count, sample ID, version indicator, instruction panel, and step guidance.
4. Add Previous Version and Next Version controls. Disable Previous on version 1; make Next Version the forward action after saving. Guard navigation when audio exists but is not saved with a confirmation dialog.
5. Ensure save metadata uses the current version category and expected count and that save success advances the user prompt without silently changing the version.
6. Remove any duplicate/static instruction copy outside the existing inline instruction panel.

### Task 3: Run focused validation and fix regressions

**Status:** Complete — focused Chrome test and full CRM verification suite passed.

**Files:**
- Modify: `tests/browser/crm-pronunciation-samples-browser-check.js` (only if test fixtures need synchronization)

**Steps:**
1. Run `node --check public/crm-admin.js`.
2. Run `node tests/browser/crm-pronunciation-samples-browser-check.js` and require PASS.
3. Run `node scripts/crm/verify-crm-suite.js` and require `crm verification suite passed`.
4. Run `git diff --check`.

### Task 4: Production Chrome verification and deployment

**Status:** Complete — Hosting deployed and live Chrome verification passed on `betterenglishlearning.com`.

**Files:**
- No new product files; use the existing production deployment workflow.

**Steps:**
1. Use the admin credentials in `C:\Cursor AI\.local\browser-test-credentials.md` for Chrome verification.
2. Verify a production word can move clean → omission → insertion → accented → unrateable and back with Previous Version, with instructions visible in the inline green panel.
3. Deploy Functions and Hosting from clean deployment worktrees only after focused tests pass.
4. Re-run the production Chrome smoke check and record the deployed commit and URLs.
