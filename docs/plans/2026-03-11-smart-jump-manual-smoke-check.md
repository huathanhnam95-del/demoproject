# Smart Jump Manual Smoke Check Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Manually verify in a real browser that Smart Jump keeps the displayed question, dropdown selection, and actual media source aligned in Type, Speak, Extended, and Notes using real app behavior rather than mocked tests.

**Architecture:** Use a local browser session against the running app, with actual UI interaction and DevTools inspection of the active audio elements. Validate each Smart Jump mode under normal use and under a timing-sensitive sequence where Smart Jump is clicked while prior media is still loading.

**Tech Stack:** Local Node server, browser DevTools, app UI in `public/script.js` and `public/take-notes-mode.js`.

---

## Context For The Tester

- Smart Jump buttons exist in:
  - `Type`: `#recommended-btn-type`
  - `Speak`: `#recommended-btn-speak`
  - `Extended`: `#recommended-btn-extended`
  - `Notes`: `#recommended-btn-notes`
- Critical verification rule for every mode:
  - visible current question ID
  - dropdown selection
  - active audio source element
  must all point to the same question after Smart Jump
- Main browser elements to inspect:
  - Type/Speak shared audio: `#audio source`
  - Extended audio: `#audio-extended source`
  - Extended phrases audio: `#audio-phrases source`
  - Notes audio: `#notes-audio`

## Path Convention

- Save screenshots and notes under `tmp/manual-smoke-check/2026-03-11-smart-jump/`.
- If the folder does not exist yet, create it before starting the browser checks.

### Task 1: Preflight Setup

**Files:**
- Create: `tmp/manual-smoke-check/2026-03-11-smart-jump/`
- Verify: `public/script.js`
- Verify: `public/take-notes-mode.js`

**Step 1: Start the local app**

Run:

```bash
node server.js
```

Expected:
- terminal prints `Server running on http://localhost:<port>` or the configured local URL

**Step 2: Open the app in a real browser**

Use a normal browser window, not a headless test runner.

Recommended:
- Chrome or Edge
- one tab for the app
- DevTools open on the Elements tab

Open:

```text
http://localhost:3000
```

If your server logs a different port, use that exact port instead.

Expected:
- home page fully loads
- no blocking startup errors

**Step 3: Prepare evidence capture**

Create the folder:

```bash
mkdir tmp\manual-smoke-check\2026-03-11-smart-jump
```

Capture at minimum:
- one screenshot per mode after pass
- one short text note per mode describing what was checked

**Step 4: Set manual mode where required**

For `Type`, `Speak`, and `Extended`:
- switch from `Adaptive` to `Manual`
- confirm Smart Jump is visible and enabled

Expected:
- Smart Jump button visible
- recommendation summary visible

### Task 2: Type Mode Manual Smoke Check

**Files:**
- Verify: `public/script.js:6891-7062`
- Evidence: `tmp/manual-smoke-check/2026-03-11-smart-jump/type-pass.png`
- Evidence: `tmp/manual-smoke-check/2026-03-11-smart-jump/type-notes.txt`

**Step 1: Open Type mode**

UI steps:
1. Click the `Type` tab.
2. Switch to `Manual`.
3. Wait for the dropdown and Smart Jump summary to stabilize.

Expected:
- current question ID is visible
- dropdown shows the same question ID

**Step 2: Record the baseline state**

Before clicking Smart Jump, note:
- displayed current question ID
- dropdown value
- recommendation summary target question

In DevTools Elements, inspect:
- `audio#audio`
- child `source`

Record the current `src`.

**Step 3: Normal Smart Jump check**

UI steps:
1. Click `Smart Jump` once.
2. Wait until the UI settles.

Pass criteria:
- displayed current question ID equals the recommended target
- dropdown value equals the same target
- `#audio source[src]` filename matches that same question ID

**Step 4: Timing-sensitive Smart Jump check**

UI steps:
1. Select a different question manually from the dropdown.
2. Immediately click `Smart Jump` before the previous load fully settles.
3. Wait until the UI settles.

Pass criteria:
- displayed current question ID equals the final selected Smart Jump target
- dropdown value remains on that same target
- `#audio source[src]` still matches the final target, not the earlier manually selected question

**Step 5: Save evidence**

- Take screenshot: `type-pass.png`
- Write `type-notes.txt` with:
  - starting question
  - Smart Jump target
  - final displayed ID
  - final dropdown value
  - final audio `src`

### Task 3: Speak Mode Manual Smoke Check

**Files:**
- Verify: `public/script.js:6891-7062`
- Evidence: `tmp/manual-smoke-check/2026-03-11-smart-jump/speak-pass.png`
- Evidence: `tmp/manual-smoke-check/2026-03-11-smart-jump/speak-notes.txt`

**Step 1: Open Speak mode**

UI steps:
1. Click the `Speak` tab.
2. Switch to `Manual`.

Expected:
- Smart Jump visible and enabled

**Step 2: Normal Smart Jump check**

Repeat the same method as Type.

Pass criteria:
- displayed current question ID matches the Smart Jump target
- dropdown value matches that same ID
- `#audio source[src]` matches that same ID

**Step 3: Timing-sensitive Smart Jump check**

UI steps:
1. Change the dropdown to another question.
2. Immediately click `Smart Jump`.
3. Wait until settled.

Pass criteria:
- no reversion to the earlier question
- final displayed ID, dropdown, and audio source all match

**Step 4: Save evidence**

- Take screenshot: `speak-pass.png`
- Write `speak-notes.txt`

### Task 4: Extended Mode Manual Smoke Check

**Files:**
- Verify: `public/script.js:4615-4777`
- Evidence: `tmp/manual-smoke-check/2026-03-11-smart-jump/extended-pass.png`
- Evidence: `tmp/manual-smoke-check/2026-03-11-smart-jump/extended-notes.txt`

**Step 1: Open Extended mode**

UI steps:
1. Click the `Fill` / `Extended` tab.
2. Switch to `Manual`.

Expected:
- current question ID is visible
- Smart Jump visible

**Step 2: Normal Smart Jump check**

Inspect both:
- `#audio-extended source`
- `#audio-phrases source`

Pass criteria:
- displayed current question ID equals the Smart Jump target
- dropdown value equals the same target
- both `#audio-extended source[src]` and `#audio-phrases source[src]` point to the same question ID

**Step 3: Timing-sensitive Smart Jump check**

UI steps:
1. Change the question from the dropdown.
2. Immediately click `Smart Jump`.
3. Wait until reading phase and media settle.

Pass criteria:
- displayed current question ID remains on the final Smart Jump target
- dropdown value remains on the same target
- both audio elements use the final target file
- no visible reversion to the earlier question

**Step 4: Save evidence**

- Take screenshot: `extended-pass.png`
- Write `extended-notes.txt`

### Task 5: Notes Mode Non-Regression Smoke Check

**Files:**
- Verify: `public/take-notes-mode.js:62-84`
- Verify: `public/take-notes-mode.js:583-607`
- Verify: `public/take-notes-mode.js:695-717`
- Evidence: `tmp/manual-smoke-check/2026-03-11-smart-jump/notes-pass.png`
- Evidence: `tmp/manual-smoke-check/2026-03-11-smart-jump/notes-notes.txt`

**Step 1: Open Notes mode**

UI steps:
1. Click the `Notes` tab.
2. Wait for entries to load.
3. Click `Play` to enter practice.

Expected:
- practice area becomes visible
- audio step or guiding-video step appears

**Step 2: Smart Jump during active practice**

UI steps:
1. While practice is active, click `Smart Jump`.
2. Wait for the new entry to load.

Pass criteria:
- displayed current question ID changes to the Smart Jump target
- practice remains active
- `#notes-audio[src]` matches the new target question
- no blank or stale audio from the previous question

**Step 3: Save evidence**

- Take screenshot: `notes-pass.png`
- Write `notes-notes.txt`

### Task 6: Failure Triage Checklist

**Files:**
- Create if needed: `tmp/manual-smoke-check/2026-03-11-smart-jump/failures.txt`

**Step 1: If any mode fails, record exact failure signature**

For each failure, record:
- mode
- previous question ID
- Smart Jump target
- final displayed question ID
- final dropdown value
- final audio source `src`
- whether the UI reverted after a delay

**Step 2: Capture supporting evidence**

Capture:
- screenshot with DevTools open
- browser console errors if any
- Network tab request order if stale media appears

**Step 3: Stop and report**

Do not continue to “pass” the mode if any of these happen:
- displayed ID and dropdown differ
- audio source points to a different question than the visible ID
- Notes practice collapses after Smart Jump
- Extended main audio and phrases audio diverge

## Final Verification Summary

The smoke check passes only if all of these are true:
- Type: pass
- Speak: pass
- Extended: pass
- Notes non-regression: pass
- evidence files exist for every mode

Recommended closeout note format:

```text
Type: PASS
Speak: PASS
Extended: PASS
Notes: PASS
Evidence folder: tmp/manual-smoke-check/2026-03-11-smart-jump
```
