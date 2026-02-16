# Smart Difficulty UX + Calibration (V2) Spec

**Status**: Implemented (2026-02-16)
**Owner**: Admin

## 0. Decisions (Resolved)

- Guest hints: **Yes** (baseline hints allowed for guests; active skill hints require login).
- 3rd-tier hint: **use `transcript_glimpse`** (temporary overlay; does not overwrite the hint drawer).
- Settings entrypoint: **difficulty badge click** opens Smart Difficulty settings.

## 1. Overview
>
> Make **Smart Difficulty / Adaptive Engine** a **core, always-on** feature (no shop lock), fix the current UX trust gaps (UI says “Active” while logic is gated), enforce consistent replay limits across **Type + Speak**, and redesign the **Hint** experience to be coherent with the **Skill Tree** and Difficulty scaffolding. Calibrate the scoring + promotion/demotion behavior so it feels fair (not harsh, not inert).

## 2. User Problems (Current Conflicts)

- “Adaptive Engine — Active” is shown even when the engine does not run (shop-gated).
- `DifficultyManager.isFeatureEnabled()` is called from `public/script.js` but missing from the facade → runtime error risk.
- Type replay is limited; Speak replay is not limited → inconsistent learning constraints.
- Hint UX is contradictory:
  - Level 1 hides the hint button because “auto first letters” is configured,
  - but auto-hints are disabled/commented out → beginners can get **no hints**.
- Storage schema drift:
  - DifficultyManager writes `globalSettings`,
  - AdaptiveEngineUI/AuthUI read/write `settings`.
- Calibration feels unfair/inconsistent:
  - Timer starts on question load (can punish idle time),
  - Speed weight can block promotion even with perfect accuracy,
  - Long grace period makes the engine feel “inactive” for long stretches.

## 3. Goals (The "Why")

- [ ] Trustworthy UX: UI state matches real engine behavior.
- [ ] Always-available smart difficulty for all users (guest + logged in).
- [ ] Consistent replay constraints: Type + Speak replay caps behave the same.
- [ ] Hints are predictable: never hidden without a replacement, and consistent with the Skill Tree.
- [ ] Calibration feels fair:
  - Promotions happen when the user is truly ready, without requiring “near-perfect + fast” only.
  - Demotions happen only on sustained struggle, not on a couple of bad attempts.
  - Engine responds within a reasonable number of attempts.

## 4. Requirements (The "What")

### 4.1 Smart Difficulty is Core (No Shop Gate)

- [ ] Remove “purchase/unlock” gating for Smart Difficulty:
  - [ ] Smart Difficulty is available for **every user**.
  - [ ] Default state is **enabled** (`autoAdjustEnabled = true`).
- [ ] Shop should not sell Smart Difficulty:
  - [ ] `autoAdjust` should not appear as a purchasable shop item.
  - [ ] No user should be able to spend coins to unlock it.

### 4.2 API + Storage Consistency

- [ ] Add `DifficultyManager.isFeatureEnabled()` for backward compatibility (used by `public/script.js`).
- [ ] Single storage contract for `localStorage['difficulty_profile']`:
  - [ ] Canonical: `{ globalSettings, profiles, version, lastSaved }`
  - [ ] Migration: if legacy `settings` exists, map to `globalSettings` on load.
- [ ] AdaptiveEngineUI reads `globalSettings` (not `settings`) and reflects:
  - [ ] Auto vs Manual state (title/status).
  - [ ] “Calibrating / Evaluating / Ready” status based on attempts.
- [ ] AuthUI level selection should **seed** the starting CEFR level without disabling auto-adjust.

### 4.3 Replay Limits (Type + Speak)

- [ ] Set `maxReplays = 5` for **both Type and Speak**, across all CEFR levels (1–6).
- [ ] Enforce replay limit in:
  - [ ] Type play button (already partially enforced).
  - [ ] Speak play button (currently unlimited).
- [ ] UI feedback:
  - [ ] Show “X times left” badge for Type and Speak.
  - [ ] When limit is reached, disable/hide Play and visually mark the badge.
- [ ] Reset replay counters correctly on:
  - [ ] question change
  - [ ] mode/tab switch (if it reloads question state)
  - [ ] **Note:** retry does **not** reset replay limits for the same question (prevents bypassing the cap).

### 4.4 Hint System (Best Approach, Skill Tree-Aware)

#### Design Principles

- [ ] Beginners must never be “stuck”: hints cannot be hidden with no alternative.
- [ ] Hints should feel like “assistance”:
  - [ ] They can reduce calibration (already supported via `assistCalibMult`).
  - [ ] They should not silently break the difficulty engine.
- [ ] The hint ladder must not reference missing shop APIs (`isItemUnlocked`).

#### Proposed Approach (Recommended)

- **Baseline scaffolding (free, difficulty-driven)**:
  - [ ] At low CEFR (A1/A2), show a minimal passive hint (at least **word count**) automatically.
  - [ ] Do not hide the hint button unless an auto-hint is actually displayed.
- **Active assist hints (skill tree-driven, paid, calibrated)**:
  - [ ] Clicking Hint uses Skill Tree active skills (server authoritative) when logged in:
    - Level 1 hint → `hint_wc`
    - Level 2 hint → `hint_fl`
    - Level 3+ hint → (decision) `transcript_glimpse` vs `hint_reveal` behavior
  - [ ] Guest users can still use baseline hints (and optionally a small free ladder) without server calls.
- [ ] Update the hint cost badge to display the *real* next cost for the current user path:
  - Logged-in: from skill result / SkillCatalog base cost
  - Guest: “free” (or local-only daily cap, if retained)

#### Open Decision (Needed for “Fix it”)

Resolved: **Use `transcript_glimpse` as the “heavy” third hint**.

### 4.5 Calibration Adjustments

- [ ] Make the engine feel responsive (not inert):
  - [ ] Reduce grace period from 20 attempts to a smaller value (proposal: 10).
- [ ] Make scoring fairer:
  - [ ] Start timing from first meaningful action (Play/Record), not on question load.
  - [ ] Reduce the weight of speed in the difficulty score (proposal: 20% speed / 80% accuracy).
  - [ ] Use **word-level accuracy** (F1 score on the word diff; penalizes missing + extra words) instead of a binary correct/incorrect flag for Type/Speak performance scoring.
- [ ] Keep thresholds understandable:
  - [ ] Promote on sustained high performance.
  - [ ] Demote only on sustained low performance.
- [ ] AdaptiveEngineUI should reflect the calibration state (“X sets to evaluation”) based on the new grace period.
  - Implementation note: evaluation readiness must match the engine: `requiredAttempts = max(gracePeriod, sensitivityWindowSize)`.

## 5. Taste Invariants (The "How")

- [ ] No “bait-and-switch”: never show “Active” if the engine is disabled.
- [ ] Minimal, local-only logic (no new network calls).
- [ ] No new global flags unless they are explicitly part of the API contract.
- [ ] No commented-out blocks left behind; remove or implement.
- [ ] Provide verification via runnable Node tests for key logic (DifficultyLogic, PerformanceTracker scoring, HintSystem generation).

## 6. Verification

Run:

- `node tests/difficulty-logic.test.mjs`
- `node tests/performance-tracker.test.js`
- `node tests/hint-system.test.js`
- `node tests/points-logic.test.js`
