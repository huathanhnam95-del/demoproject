# Unified Question + Filter Picker Redesign

## Summary
- Replace the current nested question/filter cards with one compact, sticky control bar plus a shared jump/filter sheet.
- Keep the same interaction pattern across all question-based modes, while letting each mode expose only the controls it actually needs.
- Extend progress status handling so the same status vocabulary works consistently across all modes that have question progress.

## Proposed UX
- Use a single sticky control bar at the top of each mode.
- Put `Prev`, `Current item`, and `Next` in the center, with the primary action on the right.
- Move secondary actions, filters, and mode toggles behind a shared `Filters` button.
- Show only active filter chips inline, so the bar stays compact.
- Use one shared sheet for both `Jump/Search` and `Filters`.
- On desktop, open the sheet as a right-side panel; on mobile, open it as a bottom sheet.

## Shared Sheet Structure
- `Jump` tab:
  - Search by ID, title, or excerpt.
  - Show `Recommended next`, `Random`, and current item shortcuts.
  - Render matching question rows with keyboard navigation.
- `Filters` tab:
  - Status multi-select.
  - Difficulty single-select where supported.
  - Length where supported.
  - Content availability filters where supported.
  - Mode-specific helper toggles where supported.
  - `Clear all` to restore defaults.

## Mode Mapping
- `Type`:
  - Primary action: `Play`.
  - Filters: Status, Length, Difficulty, Adaptive/Manual.
- `Speak`:
  - Primary action: `Start/Stop Recording`.
  - Filters: Status, Length, Difficulty, Adaptive/Manual.
- `Extended`:
  - Primary action: `Play`.
  - Filters: Status, Difficulty, Adaptive/Manual.
- `RFIB`:
  - Primary action: `Check`.
  - Filters: Status.
- `Notes`:
  - Primary action: `Play`.
  - Filters: Status, Difficulty, Guiding Video availability.
- `SGD`:
  - Primary action: `Play`.
  - Filters: Status, Difficulty.
- `Essay`:
  - Primary action: `Start Writing`.
  - Filters: Status.
- `ASQ`:
  - Primary action: `Record Answer`.
  - Filters: Status.
- `Read Aloud`:
  - Primary action: `Start/Stop Recording`.
  - Secondary actions: playback/sample audio in overflow or secondary slots.
  - Filters: Status, Difficulty, Sample Audio availability, Prompt Features.

## Status Model
- Standardize the visible status set as `Not Started`, `In Progress`, `Completed`, `Consolidated`, and `Mastered`.
- Reuse the existing Firestore progress pattern where possible.
- Record attempt completion from the mode’s natural completion moment:
  - `Type` / `Speak`: existing check flow.
  - `RFIB`: perfect completion.
  - `Notes`: submission accuracy.
  - `SGD`: overall score.
  - `Read Aloud`: assessment score.
  - `ASQ`: correctness.
  - `Essay`: final score percentage.
- Keep thresholds centralized so they can be tuned without rewriting mode logic.

## Implementation Notes
- Preserve current DOM IDs and event flows where possible to avoid breaking existing listeners.
- Let the new control bar drive the existing mode select and filter logic instead of replacing everything at once.
- Hide the old bulky selector layout with CSS once the shared UI is in place.
- Keep the bar visually restrained and neutral, with one accent color for the primary action and active states.

## Validation
- Verify the bar stays compact and sticky in every mode.
- Confirm jump/search works with both IDs and text.
- Confirm filters update the question list and active chips correctly.
- Confirm progress/status updates appear after the mode’s completion action.
- Smoke-test the updated UI in Chrome on desktop and mobile widths.

## Assumptions
- “All modes” means all discrete question-based practice modes, not route-level or game-only modes.
- Existing mode-specific controls remain available, but secondary actions move behind the shared overflow/sheet pattern.
- Search uses current question text/title/excerpt data already present in each mode’s dataset.
