# Adaptive Question Selection: Browser Testing Plan

This document outlines the systematic manual testing procedures required to verify that the Adaptive Question Selection feature functions perfectly within the browser environment. 

This plan is specifically focused on the UI experience, the state management between toggles, and ensuring that the smart engine properly serves questions based on the user's calibration profile.

---

## Prerequisites
1. Open the application locally or navigate to the staging environment.
2. Open the Chrome DevTools / Browser Inspector.
3. Keep the **Application -> Local Storage** tab open to monitor `difficulty_profile` changes.
4. Keep the **Console** open to monitor `[DifficultyManager]` logs.

---

## Test Scenario 1: Initial State & Uncalibrated Experience
**Goal:** Verify that a brand new user defaults to Adaptive Mode and receives an unfiltered list of questions to enable smooth calibration.

1. **Clear Storage:** Go to Application -> Local Storage and delete `difficulty_profile` (if it exists).
2. **Reload the Page.**
3. **Verify UI State:** Look at the Difficulty toggle on the main interface. It should be set to **Adaptive** by default.
4. **Verify Question Selection (Type/Speak Mode):**
   * Do not click any manual difficulty buttons.
   * Open the mode (e.g., Type Mode) and click Start.
   * Because you are *uncalibrated*, the system should not restrict you to Level 1. 
   * **Action:** Play through 3-4 questions and observe the UI. You should ideally see a mix of difficulties (if the DB allows) or all questions available in the DB being looped through naturally.

---

## Test Scenario 2: The Calibration Threshold
**Goal:** Verify that after the grace period, the engine locks the user into a specific calibrated level.

1. **Continue from Scenario 1.**
2. **Simulate Play:** Play through a total of 10 consecutive attempts (the `GRACE_PERIOD_ATTEMPTS`).
   * *Tip: To speed this up, you can purposely fail them all quickly or answer them all perfectly.*
3. **Trigger Adjustment:** On the 10th or 11th attempt, watch the UI and the Console.
4. **Verify Adjustment UI:** An Ascension Modal or a toast notification should appear stating: `"Difficulty increased to Level X"` or `"Difficulty decreased"`.
5. **Verify State Locking:** Check Local Storage. The `userDifficultyProfile.type.level` should now have a fixed integer (e.g., `2`).
6. **Verify Question Pool:** Play the next question. The system should now *only* serve questions matching this new calibrated level.

---

## Test Scenario 3: Manual Override
**Goal:** Verify that users can take control of their learning experience at any time, overriding the AI.

1. **Toggle Switch:** Click the "Adaptive / Manual" toggle to switch to **Manual Mode**.
2. **Verify Settings:** A settings modal or UI should appear allowing you to select a specific level (1-6).
3. **Select Level 4.**
4. **Verify Local Storage:** Look at Local Storage. `globalSettings.autoAdjustEnabled` should now be `false`, and `manualLevel` should be `4`.
5. **Verify Gameplay:** Play a round. The system should now *exclusively* serve Level 4 questions.
6. **Verify Non-Adjustment:** Intentionally fail 10 times in a row. Because you are in manual mode, the system *must not* demote you to Level 3. No toasts or modals should appear.

---

## Test Scenario 4: Returning to Adaptive
**Goal:** Verify that re-enabling Adaptive mode picks up from the saved state.

1. **Re-Toggle:** Switch the toggle back to **Adaptive**.
2. **Verify UI:** The manual level selector should disable or disappear.
3. **Verify State:** The system should pull the last recorded `level` from the `difficulty_profile` (not the manual level you just played on, but the last organic level achieved in Scenario 2).
4. **Verify Gameplay:** Play a round. The questions should instantly align with the restored organic level.

---

## Test Scenario 5: Mode Isolation
**Goal:** Ensure that calibration in Type Mode does not accidentally bleed into Speak Mode or SRS.

1. Verify you are calibrated in **Type Mode** (e.g., Level 3).
2. Switch tabs to **Speak Mode**.
3. **Verify UI:** If you have never played Speak Mode, the badge should indicate it is at the baseline (Level 1) or Uncalibrated.
4. **Verify Local Storage:** `userDifficultyProfile.speak.history` should be completely empty (length 0), proving that stats are isolated per mode.

---

## Pass Criteria
The feature is considered **Production Ready** if all 5 scenarios pass without triggering console errors, infinite loops, or jarring/empty question lists.