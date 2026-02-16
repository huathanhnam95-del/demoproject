# Smart Difficulty UX + Calibration (V2) — Execution Plan

Links:
- Spec: `docs/specs/smart-difficulty-ux-v2.md`

## 0) Decisions (confirmed)

- Guest hints:
  - Confirmed: **baseline hints allowed for guests** (local-only; no coins), Skill Tree hints require login.
- 3rd-tier hint:
  - Confirmed: use **`transcript_glimpse`** as the “heavy” third hint for Type mode.
- Settings entrypoint:
  - Confirmed: clicking the **difficulty badge** opens Smart Difficulty settings.

## 1) Remove Smart Difficulty shop gating (core always-on)

**Files**
- `public/shop-module.js`
- `public/js/difficulty-manager.js`
- `public/index.html` (only if UI needs minor wiring)

**Steps**
- Make `autoAdjust` always unlocked (core) and remove it from purchasable shop surface.
- Ensure DifficultyManager behaves correctly if `shopModule` is missing (no hidden “locked” state).
- Add `DifficultyManager.isFeatureEnabled()` as a stable facade API (back-compat).
- Call `updateIndicator()` during init so the badge shows without waiting for a tab click.

**Verify**
- Load the app (guest + logged-in) and confirm:
  - No lock UI for Smart Difficulty.
  - No console errors from missing `isFeatureEnabled`.
  - Difficulty badge appears and reflects current mode level.

## 2) Fix storage schema drift + migration

**Files**
- `public/js/difficulty-manager.js`
- `public/js/adaptive-engine-ui.js`
- `public/auth-ui.js`

**Steps**
- Canonicalize `difficulty_profile` to `{ globalSettings, profiles, version, lastSaved }`.
- Add migration: if `settings` exists, map → `globalSettings` on load and re-save.
- Update AdaptiveEngineUI to read `globalSettings` and reflect Auto vs Manual states.
- Update AuthUI “level selection” to seed starting CEFR without disabling auto-adjust.

**Verify**
- Fresh profile: storage created with `globalSettings`.
- Legacy profile: existing `settings` is migrated and UI still works.
- Adaptive Engine modal displays correct state and stats.

## 3) Enforce replay limit = 5 for Type + Speak

**Files**
- `public/js/difficulty/DifficultyConfig.js`
- `public/index.html`
- `public/script.js`

**Steps**
- Set `maxReplays = 5` for Type + Speak across levels 1–6.
- Add Speak replay badge element (parallel to Type’s `replay-counter-type`).
- Implement Speak replay counting + disable behavior.
- Ensure counters reset on question change (and mode switch if it loads new question state).
  - Retry should **not** reset replay limits for the same question.

**Verify**
- Type: Play 5 times → badge hits 0, Play disables/hides.
- Speak: Play 5 times → same behavior.
- Switching questions resets counters.

## 4) Rethink + fix the Hint system (skill tree-aware)

**Files**
- `public/hint-system.js`
- `public/script.js`
- (optional) `public/js/skill-catalog.js` (only if we need a new mapping helper)

**Steps**
- Remove broken references to `shopModule.isItemUnlocked` (no such API).
- Ensure Level 1 never hides hints without actually showing an auto-hint.
- Implement the chosen hint model:
  - Baseline free hint at low CEFR (recommended: auto word count).
  - Paid skill-based hints when logged in (`hint_wc`, `hint_fl`, and chosen tier-3 hint).
- Update hint cost badge to show the *real* next cost for the active path (guest vs logged-in).

**Verify**
- Level 1 (A1): user sees a baseline hint (or hint button remains visible).
- Logged-in: hint click deducts coins via active skill and marks calibration penalty.
- No console errors from HintSystem.

## 5) Calibration tuning (fairness + responsiveness)

**Files**
- `public/js/difficulty/DifficultyConfig.js`
- `public/js/difficulty/DifficultyLogic.js`
- `public/js/performance-tracker.js`
- `public/js/adaptive-engine-ui.js`

**Steps**
- Reduce grace period (proposal: 20 → 10) and keep AE UI consistent with it.
- Start timing from first meaningful action (Play/Record) rather than question load.
- Adjust difficulty score weights (proposal: 80% accuracy / 20% speed).
- Use word-level accuracy (F1 score on word diff) instead of binary correct/incorrect for Type/Speak.

**Verify**
- Simulate a sequence of attempts in a Node test (see next step) to confirm:
  - Promotion is reachable with consistent performance.
  - Demotion requires sustained struggle.

## 6) Add verifiable tests (Node runnable)

**Files**
- `tests/difficulty-logic.test.mjs` (new)
- `tests/performance-tracker.test.js` (new)
- `tests/hint-system.test.js` (new)

**Steps**
- Add small unit tests that import the ESM modules and validate:
  - DifficultyLogic thresholds + grace period behavior.
  - PerformanceTracker scoring weight changes.
  - HintSystem hint generation + no shop API dependency.

**Verify (commands)**
- `node tests/points-logic.test.js`
- `node tests/difficulty-logic.test.mjs`
- `node tests/performance-tracker.test.js`
- `node tests/hint-system.test.js`
- `npm run lint` (optional, but preferred)

## 7) Documentation + external mirror update

**Files**
- `C:\\Users\\Admin\\.gemini\\antigravity\\brain\\eb5b90f2-6146-4fac-993d-716ec8e2d1e1\\difficulty-system.md.resolved`

**Steps**
- Update the mirror doc to reflect:
  - Smart Difficulty always-on
  - New replay limits
  - Hint behavior + skill tree integration
  - Updated calibration parameters

**Verify**
- Manual spot-check: doc matches current code paths + storage schema.
