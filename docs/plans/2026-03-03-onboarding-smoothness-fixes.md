# Onboarding Smoothness Fixes Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Remove the P0 onboarding blockers so a new A2 Vietnamese PTE learner can reach first value (practice → save 1–3 words → start SRS) within ~10 minutes without trust-breaking messaging or dead ends.

**Architecture:** Keep fixes small and testable: (1) trust + clarity (preloader + landing copy), (2) Day 0 loop closure (guest hints + vocab + SRS), and (3) mobile performance (lazy-load non-core scripts). Use Playwright audit regressions for functional checks and Lighthouse for performance gates.

**Tech Stack:** Static frontend in `public/` (vanilla JS + modules), Node/Express server (`server.js`), Firebase Auth/Firestore, Playwright audit scripts (`scripts/audit/*`), Lighthouse runner (`scripts/audit/run-lighthouse-audit.js`).

**Skills:** @ux-optimization @performance-optimization @systematic-debugging

---

## Context (read-only)
- Audit summary + evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/summary.md`
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/issues-backlog.md`
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/journey-map.md`
- Existing audit runner + perf runner:
  - `scripts/audit/run-a2-onboarding-audit.js`
  - `scripts/audit/run-lighthouse-audit.js`

## Execution prerequisites (do once)
1. Create a clean worktree/branch (recommended).
   - Run: `git status`
   - Expected: clean or only unrelated changes stashed/committed.
2. Install deps.
   - Run: `npm install`
   - Run: `npx playwright install chromium`
3. Confirm local server.
   - Run: `npm start`
   - Expected: server listening; app reachable at `https://localhost:8443`.

---

## Task 0: Align specs with onboarding fixes (Spec First)

**Purpose:** Ensure specs reflect the behavior changes before code changes.

**Files:**
- Modify: `docs/specs/features/auth-and-onboarding.md` (preloader messaging + guest entry rules)
- Modify: `docs/specs/features/type-mode.md` (guest baseline hints)
- Modify: `docs/specs/features/vocabulary-book.md` (guest vocab add + local persistence)
- Modify: `docs/specs/features/srs-review.md` (due-count behavior during early review)
- Modify: `docs/specs/new-user-workflow.md` (Day 0 loop closure)
- Modify: `docs/specs/product.md` (A2/PTE above-the-fold messaging expectations)

**Step 1: Update specs**
- Add/adjust sections so the intended behavior is explicit (preloader copy, guest hints, guest vocab/SRS, due-count messaging).
- Artifact: updated spec files.

**Step 2: Commit**
- Run: `git add docs/specs/features/auth-and-onboarding.md docs/specs/features/type-mode.md docs/specs/features/vocabulary-book.md docs/specs/features/srs-review.md docs/specs/new-user-workflow.md docs/specs/product.md`
- Run: `git commit -m "docs: align onboarding specs with A2 fixes"`

---

## Task 1: Extend P0 audit regressions (functional + UI)

**Purpose:** Add explicit regressions for “SRS due count mismatch” and mobile performance gates.

**Files:**
- Modify: `scripts/audit/run-a2-onboarding-audit.js:446-556` (P0 assertion collection)
- Modify: `scripts/audit/run-a2-onboarding-audit.js:1500-1650` (S1 capture additions)
- Modify: `scripts/audit/run-lighthouse-audit.js` (performance thresholds)

**Step 1: Add failing audit assertions (A2 flow)**
Add to `collectP0AssertionFailures`:
- If SRS panel opens and due count shows “0 words due”, flag as failure **unless** an “early review” label is visible.
- Capture and persist `#srs-due-count` and `#srs-session-header` text in the S1 step.

Code snippet (example):
```js
// collectP0AssertionFailures
if (s1?.srsPanelVisible) {
  const dueText = String(s1.srsDueText || '').toLowerCase();
  const earlyLabel = String(s1.srsSessionLabel || '').toLowerCase();
  if (dueText.includes('0 words due') && !earlyLabel.includes('early')) {
    failures.push({ scenario: scenarioKey, step: 'S1_start_srs_review', reason: 'SRS shows 0 words due while session is active.' });
  }
}
```
- Artifact: updated audit script (fails on current baseline).

**Step 2: Run audit to confirm failure**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: FAIL with a new SRS due-count assertion.
- Artifact: failing audit output (console log).

**Step 3: Add performance gate to Lighthouse runner**
Add score thresholds (mobile):
- Landing performance ≥ 70
- App home performance ≥ 55
Exit non-zero when below.

Code snippet (example):
```js
if (report.categories?.performance?.score < minScore) {
  throw new Error(`Perf score below threshold: ${target.id} ${score}`);
}
```
- Artifact: updated Lighthouse runner.

**Step 4: Run Lighthouse to confirm failure**
- Run: `node scripts/audit/run-lighthouse-audit.js --base-url https://localhost:8443`
- Expected: FAIL on current baseline app home (slow mobile).
- Artifact: failing Lighthouse output (console log + report).

**Step 5: Commit**
- Run: `git add scripts/audit/run-a2-onboarding-audit.js scripts/audit/run-lighthouse-audit.js`
- Run: `git commit -m "test(audit): add SRS due-count + perf regressions"`

---

## Task 2: Fix preloader trust copy + remove certificate warnings (P0)

**Purpose:** Eliminate fear-inducing “security/certificate” wording; show neutral slow-load messaging with clear actions.

**Files:**
- Modify: `public/index.html:118-176` (preloader timeout copy)
- Modify: `public/index.html:2730-2737` (preloader button IDs/handlers if copy changes)
- Modify: `public/auth-ui.js:77-81` (log wording)
- Modify: `public/auth-ui.js:883-935` (login/signup error copy)

**Step 1: Confirm failing audit (preloader assertion)**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: FAIL on “security/certificate wording” or “bypass required”.
- Artifact: failing audit output.

**Step 2: Implement neutral preloader copy + evidence-based error text**
Update preloader timeout logic:
- Replace “security/certificate” language with neutral “Slow network” copy.
- Show “Retry” + “Continue (limited mode)” buttons.
- Only show “Some files failed to load” when `window.__belPreloaderDiagnostics` has actual errors.

Code snippet (example):
```html
text.innerHTML = 'Still loading… (slow network).<br><span id="preloader-retry-btn">Retry</span> | <span id="preloader-dismiss-btn">Continue (limited mode)</span>';
```
Update auth error copy to neutral:
```js
errorDiv.textContent = 'Auth system not ready yet. Please try again in a moment.';
```
- Artifact: updated `public/index.html` + `public/auth-ui.js`.

**Step 3: Re-run audit**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: PASS on preloader assertions.
- Artifact: passing audit output.

**Step 4: Commit**
- Run: `git add public/index.html public/auth-ui.js`
- Run: `git commit -m "fix(preloader): remove scary copy + neutral auth messaging"`

---

## Task 3: Rewrite landing hero for A2 + explicit PTE mapping (P0)

**Purpose:** Make value obvious in ≤10 seconds with A2-level language and clear PTE task mapping.

**Files:**
- Modify: `public/landing/en/index.html:73-99` (hero title/subtitle/CTA microcopy)
- Modify: `public/landing/vi/index.html:73-99` (VI hero copy)
- Modify: `public/landing/landing.css` (small badge styles if needed)

**Step 1: Confirm failing audit (landing hero)**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: FAIL if A2-hostile jargon or missing PTE mapping.
- Artifact: failing audit output.

**Step 2: Implement A2-friendly hero copy**
Constraints:
- 1 short promise sentence (≤12 words).
- 1 concrete Day 0 action (≤10 minutes).
- Explicit PTE task mapping (WFD/RS/RL).

Example EN copy:
```html
<p class="hero-subtitle">PTE Listening + Speaking practice in 10 minutes a day.</p>
<p class="cta-microcopy">Day 0: do 3 listens, save 1–3 words, review now.</p>
```
Example VI copy:
```html
<p class="hero-subtitle">Luyện PTE Nghe + Nói mỗi ngày chỉ 10 phút.</p>
<p class="cta-microcopy">Ngày 0: làm 3 bài, lưu 1–3 từ, ôn ngay.</p>
```
- Artifact: updated EN/VI landing pages (+ CSS if needed).

**Step 3: Re-run audit**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: PASS on landing assertions.
- Artifact: passing audit output.

**Step 4: Commit**
- Run: `git add public/landing/en/index.html public/landing/vi/index.html public/landing/landing.css`
- Run: `git commit -m "fix(landing): A2 hero copy + PTE Day 0 promise"`

---

## Task 4: Allow baseline hints in guest mode (P0)

**Purpose:** A2 learners need scaffolding immediately; hint ladder should not hard-gate on login.

**Files:**
- Modify: `public/script.js:226-329` (`updateHintCostBadge`)
- Modify: `public/script.js:2795-2832` (guest hint button handler)
- Modify: `public/script.js:406-459` (`updateActiveSkillControlLocks`)

**Step 1: Confirm failing audit (guest hint)**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: FAIL on `P2_type_assisted_attempt`.
- Artifact: failing audit output.

**Step 2: Implement guest baseline hints**
Behavior:
- Guests get free hint uses (session-limited) without login gating.
- After limit, show gentle signup nudge **without blocking** the current attempt.

Code snippet (example):
```js
if (!hasUser) {
  const remaining = getGuestHintRemaining();
  costBadge.textContent = `(Free ${remaining} left)`;
  hintBtn.disabled = remaining <= 0;
  hintBtn.classList.remove('locked');
}
```
- Artifact: updated `public/script.js`.

**Step 3: Re-run audit**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: PASS on guest hint assertion.
- Artifact: passing audit output.

**Step 4: Commit**
- Run: `git add public/script.js`
- Run: `git commit -m "fix(hints): allow baseline hints for guests"`

---

## Task 5: Close Day 0 loop for guests (practice → save words → SRS) (P0)

**Purpose:** Ensure guests can capture missed words and start SRS on Day 0.

**Files:**
- Modify: `public/vocab-book.js:1357-1366` (remove guest block in `showAddModal`)
- Modify: `public/vocab-book.js` (guest banner + local save copy)
- Modify: `public/srs-review.js:999-1041` (ensure guest SRS loads)
- Modify: `public/srs-review.js:1283-1317` (ensure guest save path used on initialize)

**Step 1: Confirm failing audit (guest vocab + SRS)**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: FAIL on `V1_vocab_manual_add` or `S1_start_srs_review`.
- Artifact: failing audit output.

**Step 2: Implement guest vocab add (no hard gate)**
Update `showAddModal`:
- Remove early return on `!currentUserId`.
- Show guest banner: “Saved on this device only. Create account to sync.”

Code snippet (example):
```js
if (!currentUserId) {
  showGuestBanner('Guest mode: saved on this device only.');
}
```
- Artifact: updated `public/vocab-book.js`.

**Step 3: Ensure guest SRS persists & displays**
Confirm `initializeWord` triggers `saveGuestSRSData` via `saveCardSRS` when guest.
If missing, add guard:
```js
if (isGuestSession()) saveGuestSRSData();
```
- Artifact: updated `public/srs-review.js`.

**Step 4: Re-run audit**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: PASS on guest vocab + SRS steps.
- Artifact: passing audit output.

**Step 5: Commit**
- Run: `git add public/vocab-book.js public/srs-review.js`
- Run: `git commit -m "fix(day0): allow guest vocab + srs loop"`

---

## Task 6: Fix SRS “0 words due” mismatch during active session (P1)

**Purpose:** Avoid trust-breaking UX: if a session is active, due count must reflect it.

**Files:**
- Modify: `public/srs-review.js:2920-2925` (`updateStatsDisplay`)
- Modify: `public/srs-review.js:1608-1660` (session start flags)
- Modify: `public/srs-review.js:1350-1368` (`renderScheduleTable`)

**Step 1: Confirm failing audit (new assertion)**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: FAIL on SRS due-count mismatch.
- Artifact: failing audit output.

**Step 2: Implement coherent due-count logic**
If `reviewSession.active === true` and `dueCount === 0`:
- Show “Early review” or “Review session active” instead of “0 words due”.

Code snippet (example):
```js
if (reviewSession.active && dueCount === 0) {
  elements.srsDueCount.textContent = 'Early review';
}
```
- Artifact: updated `public/srs-review.js`.

**Step 3: Re-run audit**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --assert-p0`
- Expected: PASS on SRS due-count assertion.
- Artifact: passing audit output.

**Step 4: Commit**
- Run: `git add public/srs-review.js`
- Run: `git commit -m "fix(srs): clarify due count during active session"`

---

## Task 7: Improve mobile app home performance (P0)

**Purpose:** Reduce early load time before first practice.

**Files:**
- Modify: `public/index.html:2329-2717` (heavy script tags)
- Modify: `public/js/lazy-loader.js:119-169` (extend lazy-load helpers)
- Modify: `public/script.js` (load on-demand when user opens specific modes)

**Step 1: Confirm failing perf gate**
- Run: `node scripts/audit/run-lighthouse-audit.js --base-url https://localhost:8443`
- Expected: FAIL on app home performance threshold.
- Artifact: failing Lighthouse output.

**Step 2: Defer/lazy-load non-core scripts**
Move heavy non-core scripts to lazy loader:
- `compromise` (notes mode)
- `chart.js` (SRS + pronunciation charts)
- `wavesurfer` (pronunciation analyzer)
- `canvas-confetti` (reward effects)

Code snippet (example):
```js
await window.BELLazyLoader.ensureCompromiseLoaded();
await window.BELLazyLoader.ensureChartLoaded();
```
- Artifact: updated `public/index.html`, `public/js/lazy-loader.js`, `public/script.js`.

**Step 3: Re-run Lighthouse**
- Run: `node scripts/audit/run-lighthouse-audit.js --base-url https://localhost:8443`
- Expected: PASS on landing/app performance thresholds.
- Artifact: passing Lighthouse output.

**Step 4: Commit**
- Run: `git add public/index.html public/js/lazy-loader.js public/script.js`
- Run: `git commit -m "perf(mobile): lazy-load non-core scripts"`

---

## Task 8: Re-run full onboarding audit + update artifacts

**Purpose:** Produce updated evidence and summary after fixes.

**Files:**
- Modify: `docs/audits/2026-03-01-a2-vn-pte-onboarding/summary.md`
- Modify: `docs/audits/2026-03-01-a2-vn-pte-onboarding/issues-backlog.md`
- Add: new artifacts under `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/`

**Step 1: Run full audit (record evidence)**
- Run: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --full-only --record-video --assert-p0`
- Expected: PASS with new screenshots/videos/logs.
- Artifact: new audit run report + media.

**Step 2: Update audit summary + backlog**
- Update summary to reflect resolved P0s and remaining P1s.
- Artifact: updated audit docs.

**Step 3: Commit**
- Run: `git add docs/audits/2026-03-01-a2-vn-pte-onboarding`
- Run: `git commit -m "docs(audit): refresh onboarding evidence after fixes"`

---

Plan complete and saved to `docs/plans/2026-03-03-onboarding-smoothness-fixes.md`.

Two execution options:
1. **Subagent-Driven (this session)** — dispatch a fresh subagent per task, review between tasks. **REQUIRED:** switch to **Fast Mode** and load @executing-plans.
2. **Parallel Session** — open a new session in a worktree and run @executing-plans with checkpoints.

Which approach do you want?
