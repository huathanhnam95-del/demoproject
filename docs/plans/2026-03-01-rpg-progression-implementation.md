# RPG Progression & Active Skills - Implementation Plan

## Goal Description

Implement the remaining features of the RPG Progression system, transitioning from mode-gating to an "Active Skill" economy. This involves removing the locks on basic practice modes and introducing a new "Action Popover" UI for purchasing and using in-practice hints and audio controls using the new backend `useActiveSkill` infrastructure.

## Verification Plan

We will verify functionality by testing the UI in the browser and relying on the existing Firebase Emulator logs to confirm `useActiveSkill` transactions and calibration logic.

## Phase 1: Mode Gating Removal

### Step 1: Unblock Core Practice Modes

- **File:** `public/script.js`
- **Action:** In `refreshLockedTabs`, remove the `window.shopModule.isModeUnlocked(tab.mode)` check for core modes. Force `isUnlocked = true` so 'Speak', 'Fill', 'Watch', 'Notes', 'Pronounce' are always available.
- **Test:** Open `http://localhost:5000` as a Level 1 user (or guest) and verify all mode tabs are clickable and do not have the `.locked` class.

### Step 2: Remove Length Filter Lock (Optional/Cleanup)

- **File:** `public/script.js`
- **Action:** In `isLengthFilterUnlocked`, update logic to ensure Length Filter is only locked if the shop data dictates it, or remove the lock entirely depending on the updated game design. For now, leave as-is since it delegates to `shopModule.isModeUnlocked`.
- **Test:** Verify length filter behavior remains functional.

---

## Phase 2: Action Popover UI Foundation

### Step 3: Add Popover HTML Template

- **File:** `public/index.html`
- **Action:** Inside the `#hint-controls` wrapper (around line 1601), add a new `div` for the `action-popover-menu`. It should contain buttons for "Word Ghost (15c)", "First-Letter Peek (25c)", and show current calibration impact tooltips.
- **Test:** Refresh page, inspect element to ensure the popover HTML exists and is hidden by default.

### Step 4: Add Popover CSS Styles

- **File:** `public/style-scaffolding.css`
- **Action:** Add styling for `.action-popover-menu`, `.popover-item`, `.popover-cost`, and `.calibration-tooltip`. Ensure it positions correctly above the Hint button.
- **Test:** Temporarily set `.action-popover-menu { display: block; }` and verify it looks good visually in the browser.

### Step 5: Wire Hint Button to Popover

- **File:** `public/hint-system.js` (or `script.js` if logic is inline)
- **Action:** Modify the `#hint-btn` click event listener. Instead of triggering the old sequential hint logic (`HintSystem.handleHintClick`), make it toggle the visibility of the new `.action-popover-menu`.
- **Test:** Click the Hint button in the UI. Ensure the popover opens and closes correctly.

---

## Phase 3: Hint Skills Implementation

### Step 6: Word Ghost Active Skill

- **File:** `public/hint-system.js`
- **Action:** Add click listener to the "Word Ghost" popover item.
  - Check if user has enough coins (15c minimum).
  - Call Firebase function `useActiveSkill({ skillId: 'word_ghost' })` via `firebaseFunctions.httpsCallable`.
  - On success: call `window.revealNextHint()` and calculate/apply the calibration penalty directly to the current attempt state before `DifficultyManager.adjustDifficulty` takes it.
- **Test:** Click Word Ghost. Check the network tab for the function call. Verify coins are deducted in the UI header and a word is revealed.

### Step 7: First-Letter Peek Active Skill

- **File:** `public/hint-system.js`
- **Action:** Add click listener to the "First-Letter Peek" popover item.
  - Call Firebase function `useActiveSkill({ skillId: 'first_letter_peek' })`.
  - On success: Call `window.generateFirstLettersPreview(correctSentence)` and display it in the `#auto-hints-type` drawer.
- **Test:** Click First-Letter Peek. Verify the Firebase backend call succeeds, coins are deducted, and the first-letter skeleton appears above the input box.

---

## Phase 4: Audio Controls Calibration

### Step 8: Audio Slow-Mo Integration

- **File:** `public/script.js`
- **Action:** Locate the `#speed-toggle-btn` logic.
  - Modify it to check if the user is dropping speed to 0.75x or 0.5x.
  - If so, call `useActiveSkill({ skillId: 'audio_slow_mo' })`.
  - Only change the `audio.playbackRate` if the backend transaction succeeds.
- **Test:** Click the 1.0x speed button to toggle to 0.75x. Verify the backend call is made, coins are deducted, and audio plays slower.

### Step 9: Inject Calibration Penalties to Tracker

- **File:** `public/js/performance-tracker.js`
- **Action:** Ensure that the calibration multipliers returned from `useActiveSkill` in Steps 6, 7, and 8 are accumulated into a `window.currentAttemptCalibMult` variable. Pass this variable into `DifficultyManager.adjustDifficulty(...)` on submit.
- **Test:** Complete a question after using a skill. Check the console logs from `submitAttempt` or `DifficultyManager` to ensure the `assistCalibMult` reflects the penalty (e.g., < 1.0) and affects the attempt score correctly.
