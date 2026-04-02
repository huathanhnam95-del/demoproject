# RFIB Phase-Based UX Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Transform RFIB from a single-screen flow into a multi-phase experience: Read → Choose → Listen → Correct → Submit, with an upgraded audio player and a hidden-by-default help system.

**Architecture:** All changes are contained in 3 files (`rfib-mode.js`, `rfib-mode.css`, `index.html`). A new `state.phase` property drives visibility of UI sections. The existing DOM elements are preserved and toggled by phase. No new dependencies.

**Tech Stack:** Vanilla JS, CSS, HTML

---

## Change 1 — Audio Controls Upgrade

**Current:** The audio card has only a simple "Play" button, male/female voice toggle, and a hidden `<audio>` element.

**Target:** Add play/pause toggle, stop button, speed selector, and a seek slider — matching the existing pattern in Extended mode (lines 2183–2207 of `index.html`).

### Files

#### [MODIFY] [index.html](file:///c:/Cursor%20AI/public/index.html)

Replace the `rfib-audio-actions` div (lines 2304–2310) with an expanded audio controls block:

```html
<div class="rfib-audio-actions">
  <button id="rfib-full-audio-play" class="modern-btn modern-btn--play" type="button">Play</button>
  <button id="rfib-full-audio-stop" class="modern-btn modern-btn--retry" type="button">Stop</button>
  <div class="rfib-speed-control">
    <label for="rfib-speed-select">Speed:</label>
    <select id="rfib-speed-select" class="speed-select">
      <option value="0.5">0.5x</option>
      <option value="0.75">0.75x</option>
      <option value="1" selected>1x</option>
      <option value="1.25">1.25x</option>
      <option value="1.5">1.5x</option>
      <option value="1.75">1.75x</option>
      <option value="2">2x</option>
    </select>
  </div>
  <div class="rfib-voice-toggle" id="rfib-full-audio-voice-male">
    <button type="button" class="rfib-voice-btn is-active" data-voice="male">Male</button>
    <button type="button" class="rfib-voice-btn" data-voice="female">Female</button>
  </div>
</div>
<div class="rfib-audio-slider-container">
  <span id="rfib-audio-current-time" class="rfib-audio-time">0:00</span>
  <input type="range" id="rfib-audio-slider" class="audio-slider" min="0" max="100" value="0" step="0.1">
  <span id="rfib-audio-total-time" class="rfib-audio-time">0:00</span>
</div>
```

#### [MODIFY] [rfib-mode.js](file:///c:/Cursor%20AI/public/rfib-mode.js)

- Cache new elements: `fullAudioStop`, `speedSelect`, `audioSlider`, `audioCurrentTime`, `audioTotalTime`.
- `setupEventListeners()` — wire:
  - `fullAudioPlay` toggles play/pause (swap text "Play" ↔ "Pause", match Extended mode pattern).
  - `fullAudioStop` resets `currentTime = 0`, pauses, resets slider to 0.
  - `speedSelect` sets `fullAudioPlayer.playbackRate`.
  - `audioSlider` on `input` → seek `fullAudioPlayer.currentTime`.
  - `fullAudioPlayer` `timeupdate` → update slider position + `audioCurrentTime` text.
  - `fullAudioPlayer` `loadedmetadata` → set `audioTotalTime` text and slider `max`.
  - `fullAudioPlayer` `ended` → reset play button text to "Play".
- `renderFullAudio()` — also reset slider, time displays, speed, and play button text.
- `reset()` — also reset slider and time displays.

#### [MODIFY] [rfib-mode.css](file:///c:/Cursor%20AI/public/rfib-mode.css)

Add styles:

- `.rfib-audio-slider-container` — flex row with gap, padding, centered alignment.
- `.rfib-audio-time` — small monospace font for time displays.
- `.rfib-speed-control` — inline flex with label and select.

---

## Change 2 — Hidden Support Panel with "Need Help?" Button

**Current:** The support toggle row (`Full | Beginner | Intermediate`) and support panel are always visible.

**Target:** Hide them by default. Add a "Need help?" button. Clicking it reveals the support toggle row + panel (same position, same layout). User then picks Beginner or Intermediate. Remove the "Full" toggle since the full audio is already in the audio card.

### Files

#### [MODIFY] [index.html](file:///c:/Cursor%20AI/public/index.html)

- Add a **"Need help?"** button before the support toggle row (line ~2318):

  ```html
  <button id="rfib-need-help-btn" class="rfib-need-help-btn modern-btn modern-btn--hint" type="button">💡 Need help?</button>
  ```

- On the `.rfib-support-toggle-row` (line 2319), add `style="display: none;"` so it starts hidden.
- On `#rfib-support-panel` (line 2325), add `style="display: none;"` so it starts hidden.
- Remove the `#rfib-support-full-btn` button (line 2320) — the Full version concept is replaced by the main audio card. Only keep Beginner + Intermediate.

#### [MODIFY] [rfib-mode.js](file:///c:/Cursor%20AI/public/rfib-mode.js)

- Cache `needHelpBtn`.
- `setupEventListeners()` — add click handler on `needHelpBtn`:
  - Hides the "Need help?" button.
  - Shows `.rfib-support-toggle-row` and `#rfib-support-panel`.
  - Default variant switches to `'beginner'` (since Full is removed).
  - Calls `setSupportVariant('beginner')`.
- `renderCurrentQuestion()` — on new question, reset: hide support row/panel, show "Need help?" button.
- Remove `supportFullBtn` references from `cacheElements`, `setupEventListeners`, and `renderSupportVariantButtons`.
- Update `setSupportVariant` to only handle 'beginner' and 'intermediate'.

#### [MODIFY] [rfib-mode.css](file:///c:/Cursor%20AI/public/rfib-mode.css)

Add `.rfib-need-help-btn` styles:

- Margin to match existing spacing.
- Pill shape, warm accent border, subtle animation on hover.

---

## Change 3 — Phase-Based Flow (Read → Listen → Correct → Submit)

**Current:** User reads passage, chooses blanks, clicks "Check" immediately. Linear single-phase.

**Target:** Multi-phase flow:

| Phase | What Happens | UI State |
|-------|-------------|----------|
| **1 — Read & Choose** | User reads passage, selects blanks from dropdowns. Audio card is available for optional listening. | "Confirm Choices" button visible. No result box. |
| **2 — Prepare to Listen** | After clicking "Confirm Choices", show a 5-second countdown: *"Prepare to listen to the audio and verify your answers..."*. | All blanks disabled (gray). Full audio auto-plays after countdown. Timer banner appears. |
| **3 — Listen** | Audio plays. All blanks remain disabled (gray). **User can click any blank to mark it for correction** — marked blanks turn yellow. | Blanks are clickable but not editable. Clicking marks/unmarks them. |
| **4 — Correct** | Audio ends. Message: *"Audio finished. Correct your marked answers."*. **Only yellow-marked blanks re-enable** for editing. Gray blanks stay locked. | "Submit Final Answers" button appears. |
| **5 — Results** | User clicks "Submit Final Answers" → runs existing `checkAnswers()` logic → shows result box. | Same as current post-check state. |

### Selective Blank-Unlock Mechanic (Detail)

During phases 2–3, all blanks are disabled and grayed out. While audio is playing (phase 3), the user can **click** on individual blanks to "flag" them for correction. This does NOT open the dropdown — it only toggles a `is-marked` class (yellow highlight). After audio ends (phase 4), only blanks marked yellow re-enable as editable dropdowns. Unmarked blanks stay gray/locked with their original selection preserved.

**Visual states:**

| State | Background | Border | Cursor |
|-------|-----------|--------|--------|
| Normal (phase 1) | Default gradient | Default | pointer |
| Disabled/gray (phases 2–4 unmarked) | `#e8e4de` solid gray | muted gray | not-allowed |
| Marked/yellow (phase 3 click, phase 4 editable) | `#fff8dc` / warm yellow | `#d4a017` gold | pointer |

### Files

#### [MODIFY] [rfib-mode.js](file:///c:/Cursor%20AI/public/rfib-mode.js)

**State additions:**

```js
state.phase = 'choose'; // 'choose' | 'countdown' | 'listen' | 'correct' | 'results'
state.markedBlanks = new Set(); // indices of blanks marked for correction during listening
```

**New functions:**

1. `startListeningPhase()`:
   - Set `state.phase = 'countdown'`, clear `state.markedBlanks`.
   - Disable all `.rfib-blank-select` dropdowns, add `.is-locked` class (gray).
   - Hide "Confirm Choices" button.
   - Show countdown banner: *"Prepare to listen and verify your answers…"* with 5s timer.
   - After 5s → set `state.phase = 'listen'`, auto-play `fullAudioPlayer`.
   - Attach click listeners on each `.rfib-blank-select` that toggle `is-marked` class and add/remove from `state.markedBlanks` (without opening the dropdown — use `event.preventDefault()`).
   - On `fullAudioPlayer.ended` → call `enterCorrectionPhase()`.

2. `enterCorrectionPhase()`:
   - Set `state.phase = 'correct'`.
   - For each blank: if its index is in `state.markedBlanks`, remove `.is-locked`, remove `disabled`, keep `.is-marked` (yellow). Otherwise, keep `.is-locked` and `disabled`.
   - Show banner: *"Audio finished. Correct your marked answers."*
   - Show `#rfib-submit-btn` ("Submit Final Answers").

3. `submitFinalAnswers()`:
   - Set `state.phase = 'results'`.
   - Re-enable ALL blanks temporarily (so `checkAnswers` can read values).
   - Call existing `checkAnswers()`.
   - Hide submit button, show retry.

**Modified functions:**

- `checkBtn` click handler → calls `startListeningPhase()` instead of `checkAnswers()`.
- `renderCurrentQuestion()` → reset `state.phase = 'choose'`, clear `state.markedBlanks`, remove `.is-locked`/`.is-marked` classes, hide banners, show "Confirm Choices", hide Submit button.
- `checkAnswers()` — no change to internal logic, just called from `submitFinalAnswers`.

#### [MODIFY] [index.html](file:///c:/Cursor%20AI/public/index.html)

Add between the actions row and result box:

```html
<!-- Phase banners -->
<div id="rfib-phase-banner" class="rfib-phase-banner" style="display: none;">
  <span id="rfib-phase-message" class="rfib-phase-message"></span>
  <span id="rfib-phase-timer" class="rfib-phase-timer"></span>
</div>

<!-- Submit button (shown in correction phase) -->
<div class="rfib-actions rfib-actions-submit" style="display: none;">
  <button id="rfib-submit-btn" class="modern-btn modern-btn--check" type="button">Submit Final Answers</button>
</div>
```

- Rename the existing `#rfib-check-btn` text from "Check" to "Confirm Choices".

#### [MODIFY] [rfib-mode.css](file:///c:/Cursor%20AI/public/rfib-mode.css)

Add styles:

- `.rfib-phase-banner` — rounded card, warm background, centered text, animated fade-in.
- `.rfib-phase-message` — descriptive text styling.
- `.rfib-phase-timer` — large countdown number, pulsing animation.
- `.rfib-blank-select.is-locked` — gray background (`#e8e4de`), muted border, `cursor: not-allowed`, reduced opacity.
- `.rfib-blank-select.is-marked` — warm yellow background (`#fff8dc`), gold border (`#d4a017`), `cursor: pointer`.
- `.rfib-blank-select.is-marked:not(:disabled)` — full opacity, normal cursor (editable in correction phase).

---

## Verification Plan

### Automated Tests

**Existing test:** `tests/browser/rfib-mode-browser-check.js` — covers: question loading, blank rendering, filling answers, checking results, support toggling, and retry. This test will need updates:

- The test currently clicks `#rfib-check-btn` and immediately expects results. With the phased flow, clicking check now triggers the countdown → listen → correct → submit pipeline. The test must:
  1. Click `#rfib-check-btn` (now "Confirm Choices").
  2. Wait for countdown (≤5s) + audio to play/end (or mock `ended` event).
  3. Click `#rfib-submit-btn`.
  4. Then assert results.

- The test clicks `#rfib-support-full-btn` — this button will be removed. Update to click `#rfib-need-help-btn` first, then `#rfib-support-beginner-btn`.

**Run command:**

```bash
node tests/browser/rfib-mode-browser-check.js
```

### Manual Verification

1. **Audio controls:** Open RFIB mode → verify play/pause toggles, stop resets, speed changes rate, slider seeks correctly, time display updates.
2. **Need help flow:** Confirm support panel hidden on load → click "Need help?" → panel appears with Beginner/Intermediate → selecting shows correct text/audio → switching questions re-hides panel.
3. **Phase flow:** Fill blanks → click "Confirm Choices" → see 5s countdown with locked blanks → audio auto-plays → audio ends → blanks unlock with correction message → click "Submit Final Answers" → results appear → retry resets to phase 1.
