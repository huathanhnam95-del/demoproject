# PTE Read Aloud Audio Player and Attempts History Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Replace the Read Aloud "Play your recording" button with a styled native HTML5 audio player, restore attempts history list support for Read Aloud mode, and defer pronunciation assessment until the user explicitly clicks "Check".

**Architecture:**
- Move `<audio id="ra-user-recording-audio">` inside the toolbar flex container (`.function-group`) in `public/index.html`.
- Add `controls` attribute to `<audio>` element so the native audio player is displayed.
- Modify `public/read-aloud-mode.js` state transitions:
  - Add `RECORDED` state.
  - When recording stops, store the blob in `this.pendingBlob` and transition to `RECORDED` state without submitting immediately.
  - Show the audio player and the "Check" button.
  - When the user clicks "Check", submit the pending recording to Azure for scoring and call `PTEAttemptArchive.saveAttempt`.
- Extend `public/js/pte-attempt-archive.js`:
  - Add `'read-aloud'` mode mapping to `updateHistoryUI` with target button `ra-next-btn` and panel `mode-read-aloud`.
  - Add `read-aloud` to `modeAliases` and `auth-state-changed` list.
- Call `window.PTEAttemptArchive.updateHistoryUI('read-aloud', ...)` when a prompt is loaded.

**Tech Stack:** JavaScript, HTML5 Audio, CSS, Firebase

---

### Task 1: Update public/index.html Layout

**Files:**
- Modify: `public/index.html`

**Step 1: Move and update audio player**
Move the `<audio id="ra-user-recording-audio">` tag inside `.function-group` next to `ra-play-recording-btn` and add `controls` attribute to it.

```html
                <button id="ra-play-recording-btn" class="modern-btn modern-btn--play" type="button"
                  style="display: none;">Play your recording</button>
                <audio id="ra-user-recording-audio" preload="metadata" controls style="display: none;"></audio>
```

---

### Task 2: Implement Recorded State and Check Logic in public/read-aloud-mode.js

**Files:**
- Modify: `public/read-aloud-mode.js`

**Step 1: Update stop recording handler**
Inside the `MediaRecorder` stop listener:
- Save raw blob in `this.pendingBlob` and the recording session in `this.pendingSession`.
- Call `this.setRecordedAudio(rawBlob)`.
- Set state to `'RECORDED'` and call `this.updateUIForState()`.

**Step 2: Update Check Button Click Handler**
Rewrite `handleCheckResult()` as an async function:
- Set loading text on Check button.
- Call `await this.submitToAzure(this.pendingBlob, this.pendingSession)`.
- If assessment succeeds, clear pending variables, transition to `'RESULTS'` state, and call `this.updateUIForState()`.
- If assessment fails, keep Check and Retry buttons enabled.

**Step 3: Update updateUIForState()**
- Handle `'RECORDED'` state:
  - Hide Record button and Stop button.
  - Show Check button and Retry button.
  - Show Next prompt button.
  - Call `this.updateRecordedAudioControl()`.
- Update `updateRecordedAudioControl()`:
  - Display the `<audio>` player element (height 40px, width 240px, border-radius 20px) when a recording exists and state is not recording/requesting mic.
  - Position and hide the legacy `#ra-play-recording-btn` (`opacity: 0`, `position: absolute`) so that Playwright browser tests continue to click it successfully.
- Update `showAssessmentDisplay()`:
  - Hide the Check button after successful assessment.
  - Show the Retry button.

**Step 4: Hook updateHistoryUI**
- Call `window.PTEAttemptArchive.updateHistoryUI('read-aloud', this.currentQuestionId)` at the end of `applyPromptRow()`.
- Call `window.PTEAttemptArchive.updateHistoryUI('read-aloud', this.currentQuestionId)` inside `submitToAzure()` on success.

---

### Task 3: Extend Attempts History in public/js/pte-attempt-archive.js

**Files:**
- Modify: `public/js/pte-attempt-archive.js`

**Step 1: Add read-aloud configuration to updateHistoryUI**
Add mapping:
```javascript
      'read-aloud': { startBtnId: 'ra-next-btn', panelId: 'mode-read-aloud', skill: 'speaking' }
```
Add `read-aloud` to mode aliases:
```javascript
      'read-aloud': ['read-aloud', 'read_aloud']
```
Add `read-aloud` to `auth-state-changed` list:
```javascript
    ['essay', 'swt', 'read-aloud'].forEach(mode => { ... })
```

---

### Task 4: Run Automated Tests

**Files:**
- Test: `tests/read-aloud-mode-regression.test.js`
- Test: `tests/browser/practice-modes-browser-check.js`

**Step 1: Run browser checks**
Verify that tests compile, route, and pass without rendering errors.
Run: `node tests/browser/practice-modes-browser-check.js`
Expected: PASS
