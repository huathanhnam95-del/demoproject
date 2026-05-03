# SGD Mode Review & Hardening Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Thoroughly review and harden SGD (`sgd`) (Summarize Group Discussion): safe rendering, correct step flow, lifecycle cleanup on mode switches, audio missing/available UX, and stable Playwright checks (Chrome-only).

**Architecture:** `public/sgd-mode.js` (IIFE mode module) + `public/index.html` (`#mode-sgd`) + `public/style.css` (SGD UI) + `public/script.js` (launcher/scope/switchToMode) + Playwright checks in `tests/browser/`.

**Tech Stack:** Node.js, Playwright (Chromium), Express static harness, vanilla JS/HTML/CSS, Firebase optional (Firestore load path is supported but should be treated as untrusted input for rendering).

---

## Current Evidence / Findings (as of 2026-04-13)

- **XSS risk:** `public/sgd-mode.js` inserts raw transcript tokens into an HTML string and writes via `innerHTML`:
  - Matched spans contain `${part}` (unescaped) at `public/sgd-mode.js:867` and `public/sgd-mode.js:877`
  - Results render via `el.resultsContainer.innerHTML = html` at `public/sgd-mode.js:947`
  - Question dropdown uses `el.questionSelect.innerHTML = ...` and interpolates titles at `public/sgd-mode.js:462`
- **Lifecycle gaps:** SGD is not integrated into `window.switchToMode()` (no `mode === 'sgd'` branch). A global keydown listener (Alt+1/2/3 tab switching) can remain active if the listen step stays “display:block” while the overall mode panel is hidden.
- **Audio readiness:** `public/database/SGD/audio/` exists but is empty; `loadAudio()` only logs a warning. `checkFileExists()` also requires `content-type` to start with `audio/`, which can false-negative if hosting serves audio as `application/octet-stream`.
- **Dataset contract:** `public/database/SGD/SGD/SGD.xlsx` header row indicates IDs start at `2` (not `1`), so tests must not assume an ID `1` exists.
- **Shared test impact:** `node tests/browser/practice-modes-browser-check.js` currently fails because Speaking now shows `mode-btn-sgd` and the expected list doesn’t include it.

---

### Task 1: Capture baseline and set acceptance criteria

**Files:**
- Verify: `public/sgd-mode.js`
- Verify: `tests/browser/practice-modes-browser-check.js`

**Step 1: Run current launcher regression check**

Run: `node tests/browser/practice-modes-browser-check.js`

Expected: FAIL asserting Speaking visible cards, because `mode-btn-sgd` is now present.

**Step 2: Confirm dataset IDs**

Confirm spreadsheet exists:
- `public/database/SGD/SGD/SGD.xlsx`

Acceptance for tests: default SGD test ID should be `2` unless the test seeds its own dataset.

---

### Task 2: Remove XSS sinks from SGD rendering (OWASP A03)

**Files:**
- Modify: `public/sgd-mode.js`

**Step 1: Escape transcript tokens before they hit `innerHTML`**

In `compareTextsBySpeaker()`:
- For unmatched tokens, return `escapeHtml(part)` (not raw `part`)
- For matched tokens, return `<span class="sgd-matched">${escapeHtml(part)}</span>`

This ensures transcript content cannot inject HTML even though results currently render via `innerHTML`.

**Step 2: Replace `questionSelect.innerHTML` with DOM-built `<option>`**

In `updateQuestionSelector()`:
- Clear existing options
- For each entry, create an `option`, set `.value` to the index, set `.textContent` to `[Lvl X] id – title`

**Step 3: Optional hardening (preferred)**

Replace results string-building with DOM building:
- Build `.sgd-results-grid` with `document.createElement` and set `textContent` for text nodes.
- Only use `innerHTML` for static templates (no dynamic data).

---

### Task 3: Add SGD lifecycle hooks and integrate with `switchToMode()`

**Files:**
- Modify: `public/sgd-mode.js`
- Modify: `public/script.js`

**Step 1: Expose SGD lifecycle**

Extend `window.SGDMode` to include:
- `onEnter()`: `init()` (idempotent) then `loadEntries()`
- `onExit()`: call `reset()`, pause audio, stop recording timer, and force-hide listen/record/results steps so shortcuts cannot fire while hidden

**Step 2: Wire lifecycle in `window.switchToMode()`**

In `public/script.js`:
- If leaving SGD (`currentActiveMode === 'sgd' && mode !== 'sgd'`), call `window.SGDMode?.onExit?.()`
- If entering SGD (`mode === 'sgd'`), call `window.SGDMode?.onEnter?.()`

---

### Task 4: Make audio-missing UX explicit (and reduce false negatives)

**Files:**
- Modify: `public/index.html` (`#mode-sgd` area near the audio controls)
- Modify: `public/sgd-mode.js`

**Step 1: Add a visible status slot**

Add an element (e.g., `#sgd-audio-status`) that can show:
- “Loading audio…”
- “Audio not available for this question yet.”

**Step 2: Update `loadAudio()`**

Behavior:
- While probing, show loading state.
- If a file is found, set `audio.src` and clear the warning.
- If none found, clear `audio.src`, show “Audio not available…”, and disable the “Proceed to Speaking” button (or any UI that assumes listening happened).

**Step 3: Relax `checkFileExists()` content-type requirement**

Treat `r.ok` as sufficient (or accept `audio/*` OR `application/octet-stream`) so hosting quirks don’t block audio loading.

---

### Task 5: Update and add Playwright coverage (Chrome-only)

**Files:**
- Modify: `tests/browser/practice-modes-browser-check.js`
- Create: `tests/browser/sgd-mode-browser-check.js`
- (Optional shared fix): `tests/browser/practice-scope-toggle-browser-check.js` currently asserts a missing field; fix while in this area

**Step 1: Update practice-modes expected cards**

In `tests/browser/practice-modes-browser-check.js`:
- Update Speaking expected visible card IDs to include `mode-btn-sgd`.
- Add a `checkMode(page, 'sgd')` contract similar to other modes (selector presence + no corrupted text markers).

**Step 2: Add dedicated SGD browser check**

Create `tests/browser/sgd-mode-browser-check.js` that:
- Starts a harness server mounting `public/`
- Uses the existing overlay dismissal pattern (copy `dismissBlockingOverlays(page)` from `tests/browser/practice-scope-toggle-browser-check.js`)
- Stubs recording APIs via `page.addInitScript()`:
  - `navigator.mediaDevices.getUserMedia` → fake stream with stoppable tracks
  - `window.MediaRecorder` → minimal stub that emits `dataavailable` and `stop`
- Intercepts audio existence:
  - Return `200` + `content-type: audio/mpeg` for `HEAD /database/SGD/audio/2.mp3` and serve a tiny body for `GET` if needed
- Drives the flow:
  - `switchToMode('sgd')` → `Play` → fill speaker notes → proceed → record → stop → submit → assert results show matched highlights and overall accuracy updates

**Step 3: Run**

Run:
- `node tests/browser/practice-modes-browser-check.js`
- `node tests/browser/sgd-mode-browser-check.js`

Expected: both PASS.

---

### Task 6: Manual Chrome QA (SGD)

**Prereqs:**
- Start app: `npm run dev`
- Use Chrome only
- If any logged-in persistence checks are added, use `C:\Cursor AI\.local\browser-test-credentials.md` (do not inline credentials in docs/commits).

**Checks:**
- Scope labels: English “Discussion” vs PTE “Summarize Group Discussion”
- Step flow: Listen & Notes → Record (2:00 timer + warning at 0:30) → Results
- Keyboard: tabs are keyboard accessible; Alt+1/2/3 switches tabs only while SGD listen step is actually active
- Audio missing state: clear messaging; proceed button disabled until audio exists
- Results: highlights are correct; no raw HTML renders from transcript content

---

## Test Plan (acceptance)

Run:
- `node tests/browser/practice-modes-browser-check.js`
- `node tests/browser/sgd-mode-browser-check.js`

Expected:
- All commands exit `0` in headless Chromium (Chrome-only).
- Manual Chrome QA passes.

