# Question Picker Mockup v5 Review (Read Aloud baseline)

File reviewed:
- `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html`

Reference design doc:
- `C:\Cursor AI\docs\plans\2026-04-24-question-filter-picker-redesign-design.md`

## Verdict
v5 is the most complete mockup so far and is **highly aligned** with the redesign goals (compact sticky bar + shared Jump/Filter sheet + consistent mental model across modes).

It also meaningfully improves accessibility and implementation realism compared with v4. The main remaining risks are **keyboard accessibility of the filters** and **alignment with the existing Read Aloud JS that currently overwrites button contents via `textContent`**.

## What v5 improved (high value)

### 1) “Prev” semantics handled safely
`ra-prev-btn` is explicitly disabled, which avoids promising “previous” functionality until a real history stack exists.
- `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:23`

### 2) A11y polish: proper labels + focus behavior
- Removable chip `x` has an accessible name (`aria-label`).
  - `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:73`
- Jump search input is focus-targeted when opening Jump.
  - `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:254`
- Dialog focus trap is refreshed on tab change and cleaned up on close.
  - `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:492`

### 3) Focus trap is now “visible-only”
This fixes the earlier issue where hidden tabs / hidden footer could accidentally become the “first/last” trap endpoints.
- `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:499`

### 4) Filters now match the stated RA requirements
- Status (full shared set) + Sample Audio tri-state + Difficulty + Prompt Features.
  - Status list: `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:320`
  - Sample Audio: `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:364`
  - Difficulty: `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:389`
  - Prompt Features: `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:420`

## Remaining issues / recommendations (before implementation)

### A) Keyboard accessibility regression: `tabindex="-1"` on checkboxes
The Status checkboxes are currently not keyboard-focusable because the `<input>` elements have `tabindex="-1"`. Labels are not focusable by default, so keyboard users can’t reach or toggle these filters.
- Example: `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:330`

Recommendation:
- Remove `tabindex="-1"` on all filter inputs, or implement a deliberate “chip/roving tabindex” pattern (with `role`, `tabindex="0"`, and key handlers) if you’re not using native inputs.

### B) Existing Read Aloud JS will still wipe icons unless refactored
The mockup adds `data-label` spans inside `ra-record-btn` / `ra-stop-btn`, but the current app code sets `recordBtn.textContent = ...`, which would remove the SVG + spans entirely.
- Record/Stop markup: `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:123`

Recommendation (implementation requirement):
- Update Read Aloud JS to set text on `recordBtn.querySelector('[data-label]')` (and the short label) instead of using `textContent`, and do the same for other buttons that currently use `textContent`.

Related: `ra-next-btn` in the real app is also assigned `textContent = 'Next prompt'`, which would replace the arrow icon. Decide whether:
- `ra-next-btn` stays text-only in production, or
- it becomes icon + label span (and JS is updated accordingly).

### C) Focus trap cleanup: avoid expensive style checks per keypress (optional)
The “visible-only” filtering is good, but `getComputedStyle` + `offsetWidth/height` in `refreshFocusTrap()` is a bit heavy. This is fine in practice because it runs on tab switch/open (not every keypress), but keep it that way (don’t recompute on each `Tab`).

### D) Apply vs instant apply still needs one global decision
The mockup still has `Apply Filters` as a sheet footer CTA. That’s fine, but if the app uses instant filtering, consider renaming to `Done` to reduce cognitive dissonance (and keep “Apply” for modes where changes are staged).
- `C:\Cursor AI\docs\plans\question-picker-mockup-v5.html:454`

## Conclusion
v5 is a strong template to roll out across modes. To make it “code-safe” in the current repo, the remaining must-fix items are:
1) restore keyboard focusability for filter controls, and
2) refactor Read Aloud UI updates to stop using `textContent` on buttons that should keep icons/structured markup.

