# A2 Onboarding Activation Fixes Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Remove the top A2 Vietnamese PTE onboarding blockers (P0/P1) so a new learner can go from ad click → first success → save 1–3 words → start SRS within ~10 minutes, even on slow networks and in guest mode.

**Architecture:** Make small, testable changes in three layers: (1) acquisition/activation UX (landing + preloader), (2) Day 0 loop closure (guest scaffolding + guest vocab/SRS), and (3) startup performance (lazy-load non-core modes). Use Playwright audit runners as regression tests and Lighthouse as performance verification.

**Tech Stack:** Static frontend in `public/` (vanilla JS + modules), Node/Express server (`server.js`), Firebase Auth/Firestore, Playwright audit scripts (`scripts/audit/*`), Lighthouse audit runner (`scripts/audit/run-lighthouse-audit.js`).

---

## Context (read-only)

- Audit artifacts and findings:
  - Summary: `docs/audits/2026-03-01-a2-vn-pte-onboarding/summary.md`
  - Backlog (P0/P1/P2): `docs/audits/2026-03-01-a2-vn-pte-onboarding/issues-backlog.md`
  - Primary evidence reports: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T17-44-40-561Z__audit-run.json`, `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T18-59-31-793Z__auth-admin-audit.json`
  - Lighthouse baseline: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__app_mobile.html`

## Execution prerequisites (do once)

1. Create a clean worktree/branch (recommended)
   - Run: `git status`
   - Expected: clean or only unrelated changes stashed/committed.
2. Install deps
   - Run: `npm install`
   - Run: `npx playwright install chromium`
3. Ensure local server works
   - Run: `npm start`
   - Expected: server listening; app reachable at `https://localhost:8443`.

---

## Task 1: Turn P0 findings into failing regressions (fast “red bar”)

**Purpose:** Make the top blockers fail loudly until fixed, so they don’t regress later.

**Files:**

- Modify: `scripts/audit/run-a2-onboarding-audit.js`
- (Optional) Modify: `scripts/audit/README.md`

### Step 1: Add P0 assertions (initially failing)

- Add a CLI flag (example): `--assert-p0`
- When enabled, the runner should exit non-zero if any of these are true:
  - Slow3G preloader text contains “Security/Certificate”
  - Slow3G scenario required a bypass action
  - Guest Type Mode hint is “blocked by login”
  - Guest cannot add at least 1 vocab word and start an SRS session (once guest vocab/SRS is implemented; temporarily scope this assertion to “hint + preloader” first)

### Step 2: Run to confirm it fails on current baseline

- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --assert-p0`
- Expected: process exits with code `1` and prints which assertions failed.

### Step 3: Commit

- Run: `git add scripts/audit/run-a2-onboarding-audit.js scripts/audit/README.md`
- Run: `git commit -m "test(audit): add P0 onboarding regressions"`

---

## Task 2: Fix preloader “security/certificate” false-alarm on slow loads (P0)

**Purpose:** Remove trust-killing copy and avoid false positives when modules load slowly.

**Files:**

- Modify: `public/index.html:120-138` (preloader timeout script)
- Modify: `public/index.html:2673-2678` (dismiss handler copy/ids if changed)
- Test: `scripts/audit/run-a2-onboarding-audit.js` (assertions from Task 1)

### Step 1: Write/update the failing audit assertion

- Ensure the regression check reads `#preloader-text` and fails if it contains “Security/Certificate”.

### Step 2: Run audit to confirm failure

- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: FAIL on Slow3G preloader assertion.

### Step 3: Implement the fix (minimal, user-safe)

Implementation requirements:

- Replace the “Security/Certificate Block detected” message with neutral slow-load copy:
  - “Still loading… (slow network).”
  - Primary action: “Retry”
  - Secondary action: “Dismiss loading screen”
- Only show “Some files failed to load” when you have *real* evidence of a script/resource error.
  - Add a small preloader error collector:
    - `window.__preloaderResourceErrors = []`
    - `window.addEventListener('error', (e) => { if (e.target?.tagName === 'SCRIPT') push… }, true)`
  - Gate “failed to load” language behind `__preloaderResourceErrors.length > 0`.
- Increase/scale timeout for slow connections:
  - Use `navigator.connection?.effectiveType` when available (e.g. `3g`/`2g`) to set a larger initial timeout (e.g. 12–20s).

### Step 4: Re-run audit to confirm pass

- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: PASS (no scary preloader copy; no bypass required for Slow3G).

### Step 5: Commit

- Run: `git add public/index.html`
- Run: `git commit -m "fix(preloader): remove scary slow-load warning"`

---

## Task 3: Rewrite landing hero for A2 + add explicit PTE mapping (P0)

**Purpose:** Make value obvious in <10 seconds for PTE Listening/Speaking learners.

**Files:**

- Modify: `public/landing/index.html:56-115` (hero)
- Modify: `public/landing/landing.css` (badge styles if needed)
- Test: `scripts/audit/run-a2-onboarding-audit.js` (landing assertions)

### Step 1: Add landing assertions (initially failing)

- In the landing step, assert that:
  - Hero contains a visible “PTE” marker (e.g., “PTE: WFD · RS · RL”)
  - Hero subtitle does **not** include jargon terms (example denylist): “rolling accuracy”, “masking”, “forced listening time”

### Step 2: Run audit to confirm failure (Task 3)

- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: FAIL on landing assertion.

### Step 3: Implement copy + minimal UI

Suggested copy constraints (A2 English):

- 1 short promise sentence (≤ 12 words)
- 1 concrete “Day 0” action (≤ 10 minutes)
- PTE mapping line (WFD/RS/RL)

Suggested hero structure:

- Title: keep “learning zone”
- Subtitle: replace with A2-friendly phrasing (no engine jargon)
- Add a small badge row near CTA:
  - “PTE: Write From Dictation”
  - “Repeat Sentence”
  - “Retell Lecture”

### Step 4: Re-run audit to confirm pass (Task 3)

- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: PASS on landing assertions.

### Step 5: Commit (Task 3)

- Run: `git add public/landing/index.html public/landing/landing.css`
- Run: `git commit -m "fix(landing): A2 hero copy + PTE mapping"`

---

## Task 4: Enable baseline hints in guest mode (P0)

**Purpose:** A2 learners need scaffolding immediately; hints must not be hard-gated by login.

**Files:**

- Modify: `public/script.js:208-297` (`updateHintCostBadge`)
- Modify: `public/script.js:2729-2760` (hint button click handler)
- (Optional) Modify: `public/hint-system.js` (if new helper needed)
- Test: `scripts/audit/run-a2-onboarding-audit.js` (guest hint assertion)

### Step 1: Add/confirm failing assertion

- In the guest Type Mode assisted attempt step, assert:
  - `hintBlockedByLogin` is `false` (or equivalent UI check: hint button not in “locked” state for guests)

### Step 2: Run audit to confirm failure (Task 4)

- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: FAIL on guest hint assertion.

### Step 3: Implement guest baseline hints

Suggested copy constraints (A2 English):

- If `!window.auth?.currentUser`:
  - Allow `HintSystem.useHint(correctSentence)` for Type Mode without coin cost.
  - Keep a small per-session budget (example: 3 free hint uses) in `sessionStorage`.
  - Show badge text like “Free (2 left)” instead of “Locked”.
  - If budget exhausted, show a gentle nudge modal (“Create account to unlock more help + save progress”).
- For logged-in brand-new users with no hint skills unlocked:
  - Still allow 1 “baseline” hint level at low CEFR (word-count/first-letters) without requiring Skill Tree unlock.
  - Keep coin-based “active assist” skills gated as designed.

### Step 4: Re-run audit

- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: PASS on guest hint assertion + screenshot shows hint content.

### Step 5: Commit (Task 4)

- Run: `git add public/script.js public/hint-system.js`
- Run: `git commit -m "fix(hints): allow baseline hints for guests"`

---

## Task 5: Make Day 0 loop close for guests (practice → save words → SRS) (P0)

**Purpose:** Retention requires loop closure on Day 0; “no words / 0 due” dead ends cause churn.

**Files:**

- Modify: `public/vocab-book.js:1260-1270` (guest gate in `showAddModal`)
- Modify: `public/vocab-book.js` (add guest persistence via localStorage)
- Modify: `public/srs-review.js:931-1025` (guest support in `setUser` + `loadSRSData`)
- Modify: `public/srs-review.js:1069-1225` (guest persistence in `saveSRSSummary`/`saveCardSRS`/`initializeWord`)
- Test: `scripts/audit/run-a2-onboarding-audit.js` (new guest “add word + start SRS” assertion)

### Step 1: Add the regression check (initially failing)

- Extend the onboarding audit to assert that in guest mode:
  - After a low-accuracy attempt, the “Add to Vocabulary” UI can be opened
  - At least 1 word can be added (manual add is acceptable)
  - SRS UI can start a session and show at least 1 card

### Step 2: Run audit to confirm failure (Task 5)

- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: FAIL on guest vocab/SRS loop closure.

### Step 3: Implement guest-local Vocabulary Book

Minimum viable behavior:

- Remove the early return for guests in `showAddModal`.
- Add localStorage key (example): `bel_guest_vocab_v1`.
- When `currentUserId` is missing:
  - Store bookmarked words locally and render them in the vocab panel.
  - Show an inline banner: “Guest mode: saved on this device only. Create account to sync.”
  - Keep “Add selected” working.

### Step 4: Implement guest-local SRS

Minimum viable behavior:

- Treat guests as a pseudo user id (example: `'guest'`) and load/save SRS data to localStorage:
  - Key: `bel_guest_srs_v1`
- Update `SRSReview.setUser` and `loadSRSData`:
  - If user is `'guest'`, load from localStorage instead of Firestore.
- Update save paths:
  - `saveCardSRS` / `saveSRSSummary` should write to localStorage when in guest mode.

### Step 5: Improve SRS empty state

- If no cards exist, show:
  - “Add 1–3 words first”
  - A button that opens the vocab panel and focuses “Manual Add”.

### Step 6: Re-run audit

- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: PASS (guest can add a word and start SRS without account).

### Step 7: Commit (Task 5)

- Run: `git add public/vocab-book.js public/srs-review.js scripts/audit/run-a2-onboarding-audit.js`
- Run: `git commit -m "fix(day0): enable guest vocab + guest SRS loop"`

---

## Task 6: Reduce app home startup cost by lazy-loading non-core modes (P0)

**Purpose:** Baseline Lighthouse app home LCP (~34s) is a conversion killer; reduce by not loading Watch/Survival/Pronounce dependencies until needed.

**Files:**

- Create: `public/js/lazy-loader.js` (script/module loader utility)
- Modify: `public/index.html:2489-2519` (Watch Mode scripts)
- Modify: `public/index.html:2809-2830` (Survival static import)
- Modify: `public/index.html:97-109` (Pronounce/analysis script placement if applicable)
- Modify: `public/script.js` (mode switcher hooks to lazy-load before entering a mode)
- Test: `scripts/audit/run-a2-onboarding-audit.js` (core loop still passes)
- Perf: `scripts/audit/run-lighthouse-audit.js`

### Step 1: Baseline Lighthouse capture (before changes)

- Run: `node scripts/audit/run-lighthouse-audit.js --base-url https://localhost:8443`
- Expected: writes new artifacts under `docs/audits/.../artifacts/perf/` with app home metrics.

### Step 2: Add the lazy loader utility

Utility requirements:

- Load external scripts once (`loadScriptOnce(url, { defer, async })`)
- Load ESM modules on demand (`import()` wrapper)
- Cache promises to prevent duplicate loads

### Step 3: Stop loading Watch Mode dependencies on initial load

- Remove/relocate these from initial page load (load only when entering Watch mode):
  - Firebase compat SDK scripts
  - `compromise`, `xlsx`, `youtube-player.js`, `watch-mode.js`, `take-notes-mode.js`
- Implement `ensureWatchModeLoaded()` called inside `switchToMode('watch')`.

### Step 4: Make Survival Mode import dynamic

- Replace static `import SurvivalGame from './js/survival-game/SurvivalGame.js';` with dynamic import inside `openSurvivalGame()` (or first time survival mode is selected).

### Step 5: Lazy-load Pronounce analysis dependencies

- Defer/late-load `pronunciation-analyzer/syllable-verifier.js` and any Wavesurfer-related deps until Pronounce mode is opened.

### Step 6: Re-run onboarding audit (core loop smoke)

- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: PASS (Type + guest vocab + SRS still work; modes still load when selected).

### Step 7: Re-run Lighthouse and compare

- Run: `node scripts/audit/run-lighthouse-audit.js --base-url https://localhost:8443`
- Expected: app home FCP/LCP significantly reduced vs baseline.
  - Target (first iteration): LCP < 10s in the same environment (then iterate).

### Step 8: Commit (Task 6)

- Run: `git add public/index.html public/script.js public/js/lazy-loader.js`
- Run: `git commit -m "perf(app): lazy-load non-core mode dependencies"`

---

## Task 7 (optional, P1): Wire up Adaptive Engine modal (trust-critical)

**Purpose:** If difficulty adapts, users need a readable “why” panel; audit found the modal didn’t open.

**Files:**

- Modify: `public/index.html` (ensure `js/adaptive-engine-ui.js` is loaded or remove dead UI)
- Modify: `public/js/difficulty-manager.js` (badge click handler)
- Test: extend `scripts/audit/run-a2-auth-admin-audit.js` to assert modal opens

### Verification

- Run: `node scripts/audit/run-a2-auth-admin-audit.js --base-url https://localhost:8443`
- Expected: step records `adaptiveEngineModalVisible: true` and screenshot shows modal content.

---

## Definition of done (for this plan)

- P0 regressions (Task 1 assertions) pass locally via Playwright runner.
- Slow3G no longer shows scary “security/certificate” UI copy.
- Landing hero is A2-readable and explicitly PTE-mapped.
- Guests can use baseline hints.
- Guests can save at least 1 word and start an SRS session (local-only) without signing up.
- Lighthouse app home materially improves (iterate until LCP is no longer a clear dropout risk).
