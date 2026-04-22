# ASQ Mode Review & Hardening Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Thoroughly review and harden ASQ (`asq`) (Quiz / Answer Short Question): launcher gating, scope labels, audio playback, mic + browser STT, attempt submission hooks, and cleanup on mode switches; end with stable Playwright checks (Chrome-only) + a manual Chrome QA checklist.

**Architecture:** `public/asq-mode.js` (mode controller) + `public/index.html` (`#mode-asq`) + `public/script.js` (launcher/scope/switchToMode + ASQ gating) + Node Playwright checks in `tests/browser/`.

**Tech Stack:** Node.js, Playwright (Chromium), Express static harness, vanilla JS/HTML/CSS, optional Firebase emulators.

---

## Current Evidence / Findings (as of 2026-04-13)

- `node tests/browser/asq-mode-browser-check.js` fails due to UI overlays intercepting clicks (`#app-preloader` / `#entry-modal`), not ASQ logic itself.
- ASQ launcher gating requires `HEAD /database/quiz/ASQ/audio/manifest.json` to return 200 (implemented in `public/script.js` as `maybeEnableAsqModeInLauncher()`); the repo currently has many `public/database/quiz/ASQ/audio/*.mp3` but **no** `public/database/quiz/ASQ/audio/manifest.json`, so ASQ stays hidden in the launcher until generated.
- `public/script.js` calls `window.ASQMode.onEnter()` when switching to `asq`, but does not call `window.ASQMode.onExit()` when leaving, so mic/recording cleanup can leak across modes.

---

### Task 1: Capture baseline failures and lock acceptance criteria

**Files:**
- Create: `docs/plans/2026-04-13-asq-mode-review-notes.md` (short evidence log; optional)
- Verify: `tests/browser/asq-mode-browser-check.js`

**Step 1: Run the current ASQ check**

Run: `node tests/browser/asq-mode-browser-check.js`

Expected: FAIL with a click timeout mentioning an overlay intercepting pointer events (typically `#app-preloader` or `#entry-modal`).

**Step 2: Confirm overlay-dismissal pattern exists in the repo**

Reference: `tests/browser/practice-scope-toggle-browser-check.js` has a proven `dismissBlockingOverlays(page)` helper for the current app shell.

---

### Task 2: Make the ASQ Playwright check stable (Chrome-only, overlay dismissal)

**Files:**
- Modify: `tests/browser/asq-mode-browser-check.js`
- Reference: `tests/browser/practice-scope-toggle-browser-check.js` (`dismissBlockingOverlays(page)`)

**Step 1: Add a `dismissBlockingOverlays(page)` helper**

Implement the same logic used elsewhere:
- wait until `#app-preloader` is hidden or the dismiss button exists
- click `#preloader-dismiss-btn` if present
- click `#guest-mode-btn` if visible
- wait until `#entry-modal` is hidden and `#page-layout-wrapper` is visible

**Step 2: Call it right after navigation**

After `page.goto(...)` and before any `page.click(...)`, call `await dismissBlockingOverlays(page)`.

**Step 3: Re-run**

Run: `node tests/browser/asq-mode-browser-check.js`

Expected: PASS (no click timeouts).

---

### Task 3: Add ASQ lifecycle cleanup on mode switches

**Files:**
- Modify: `public/script.js` (inside `window.switchToMode = async function (mode) { ... }`)

**Step 1: Call `ASQMode.onExit()` when leaving ASQ**

Add a guard near the existing collo-dictate cleanup:
- If `currentActiveMode === 'asq' && mode !== 'asq'`, call `window.ASQMode?.onExit?.()`.

**Step 2: Keep `ASQMode.onEnter()` on entry**

Leave the existing `else if (mode === 'asq') { window.ASQMode?.onEnter?.(); }` in place.

**Step 3: Verify quickly**

Run: `node tests/browser/asq-mode-browser-check.js`

Expected: still PASS; ASQ no longer leaves recording/mic state active after switching away.

---

### Task 4: Make launcher gating real by generating the ASQ audio manifest

**Files:**
- Create: `scripts/asq/generate-audio-manifest.js` (generator)
- Create/Update: `public/database/quiz/ASQ/audio/manifest.json` (generated output)

**Step 1: Implement generator script**

Script requirements:
- Scan `public/database/quiz/ASQ/audio/` for `*.mp3` (optionally include `wav/m4a/aac/ogg`)
- For each file `<id>.<ext>`, add an entry `"id": "id.<ext>"`
- Write pretty JSON to `public/database/quiz/ASQ/audio/manifest.json`

**Step 2: Run generator**

Run: `node scripts/asq/generate-audio-manifest.js`

Expected: `public/database/quiz/ASQ/audio/manifest.json` exists and contains many numeric IDs mapping to mp3 filenames.

**Step 3: Manual Chrome spot-check (launcher visibility)**

Run: `npm run dev`

Open in Chrome: `https://localhost:8443`

Expected: ASQ card appears after reload and is selectable in the launcher.

---

### Task 5: Security + accessibility review pass (ASQ)

**Files:**
- Review: `public/asq-mode.js`
- Review: `public/index.html` (`#mode-asq`)

**Step 1: Security checks (OWASP A03 / XSS)**

Verify:
- No `innerHTML` usage with transcript/user-controlled strings (ASQ currently uses DOM construction for transcript feedback).
- Any dynamic strings go through `textContent` or DOM nodes.

**Step 2: Accessibility checks**

Verify in manual Chrome QA:
- `#asq-status-message` updates are perceivable (add `aria-live="polite"` only if needed).
- Keyboard-only flow works (dropdown → Play → Record → Stop → Redo).

---

### Task 6: Manual Chrome QA (real mic + real Web Speech STT)

**Prereqs:**
- Start app: `npm run dev`
- Use Chrome only
- If login is needed for any “logged-in scoring” checks, use `C:\Cursor AI\.local\browser-test-credentials.md` (do not inline credentials in docs/commits).

**Checks:**
- Scope labels:
  - English: ASQ shows as `Quiz`
  - PTE: ASQ shows as `Answer Short Question`
- Audio:
  - Play/Pause toggles correctly; audio updates when question changes
- Mic + STT:
  - Record → Stop shows results; transcript populates; correctness updates
- Redo:
  - Redo resets result UI and hides question text again

---

## Test Plan (acceptance)

Run:
- `node tests/browser/asq-mode-browser-check.js`
- `node tests/browser/practice-scope-toggle-browser-check.js`

Expected:
- All commands exit `0` in headless Chromium (Chrome-only).
- Manual Chrome QA passes (mic + STT).

