# Implementation Plan: Adaptive Engine Refinements

## 1. Passive Skill UI Updates

**Files to Modify:**

- `public/script.js`

**Action:**

- Add a helper function `updatePopoverCosts()` that checks `shopModule.hasSkill('discount_hint_tier1')` etc.
- Base costs: Word Ghost (15), First-Letter (25).
- Apply a fixed discount per tier (e.g. -2c per tier) mirroring `useActiveSkill.js` logic.
- Update the `.popover-cost` `textContent` for "Word Ghost" and "First-Letter Peek" button definitions inside `index.html` via DOM selection.
- Call `updatePopoverCosts()` when the `hintBtn` click event toggles the popover.

**Verification:**

- Open `http://localhost:5000`. Ensure the Action Popover displays `15c` and `25c`.
- Manually grant `discount_hint_tier1` via Firebase Emulator UI. Refresh and ensure the Action Popover displays `13c` and `23c`.

## 2. Error Heatmap Infrastructure

**Files to Modify:**

- `functions/src/submitAttempt.js`

**Action:**

- Inside `submitAttempt`, where `scoreContentMode` calculates diffs and returns `details.wordErrors`, extract the `wordErrors` array (which contains mistakenly typed words).
- If `wordErrors` is populated, prepare a batched update to `db.collection('users').doc(uid).collection('errorHeatmap').doc(contentId)`.
- Use `FieldValue.increment(1)` for each distinct misspelled word key. Note: Normalize words (lowercase, strip punctuation) before using them as field map keys to avoid invalid paths.
- Add this write logic to the main transaction block in `submitAttempt`.

**Verification:**

- Perform a simulated attempted submission in the frontend where you intentionally mistype a word.
- Inspect the Firebase Firestore Emulator under `users/{uid}/errorHeatmap/{contentId}` and confirm the misspelled word appears as a key with value `1`.

## 3. Configuration Sync & Cleanup

**Files to Modify/Delete:**

- Delete `public/js/difficulty-manager.bak.js`.
- View `public/js/points-logic.js` and `functions/src/pointsLogic.js`.

**Action:**

- Physically delete the `.bak.js` file.
- Perform a visual diff of the `CONFIG` constant at the top of both `pointsLogic` files. Ensure `DIFFICULTY`, `PARTIAL_CREDIT`, `GUARDRAIL_THRESHOLDS`, `RATING`, and `MODE_WEIGHTS` are identical. Fix any discrepancies.

**Verification:**

- Run `ls public/js/` to confirm deletion.
- Run `node --check` or `eslint` on the `pointsLogic` files to ensure they remain syntactically valid after synchronization.
