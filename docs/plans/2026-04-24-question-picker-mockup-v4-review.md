# Question Picker Mockup v4 Review (Read Aloud baseline)

File reviewed:
- `C:\Cursor AI\docs\plans\question-picker-mockup-v4.html`

Reference design doc:
- `C:\Cursor AI\docs\plans\2026-04-24-question-filter-picker-redesign-design.md`

## Verdict
v4 is the strongest iteration so far and is **very close to implementation-ready** for the unified pattern (sticky control bar + shared Jump/Filter sheet). It also addresses key “don’t break functions” and accessibility gaps from earlier versions.

## What v4 improved (high value)

### 1) Stop Recording is explicitly supported
`ra-stop-btn` is now present (hidden by default) and can be swapped with `ra-record-btn` by JS.
- `C:\Cursor AI\docs\plans\question-picker-mockup-v4.html:133`
- `C:\Cursor AI\docs\plans\question-picker-mockup-v4.html:145`

### 2) Status filter now includes the full shared vocabulary
The filter tab includes: Not Started / In Progress / Completed / Consolidated / Mastered, matching the “status across modes” requirement.
- `C:\Cursor AI\docs\plans\question-picker-mockup-v4.html:341`

### 3) Dialog labeling and focus-trap groundwork
Adds `aria-labelledby` on the dialog and a basic focus trap + focus return.
- `C:\Cursor AI\docs\plans\question-picker-mockup-v4.html:221`
- `C:\Cursor AI\docs\plans\question-picker-mockup-v4.html:488`

### 4) Preserves “real select” wiring
Keeps a hidden `<select id="ra-question-select">` while using a separate pill button for opening Jump.
- `C:\Cursor AI\docs\plans\question-picker-mockup-v4.html:45`
- `C:\Cursor AI\docs\plans\question-picker-mockup-v4.html:56`

## Remaining issues / recommendations (before implementation)

### A) Existing Read Aloud JS will overwrite icon buttons (integration blocker)
In the current app, `read-aloud-mode.js` frequently does `button.textContent = ...` for `ra-next-btn` and `ra-record-btn`.
If you implement v4’s icon-based buttons without refactoring, those assignments will wipe out the icons and nested spans.

Recommended approach for production:
- Keep IDs (`ra-record-btn`, `ra-next-btn`) but change JS to update a dedicated label span (e.g. `[data-label]`) instead of overwriting `textContent`, OR
- Keep the existing text-only buttons and use icons via CSS background/SVG that won’t be replaced by `textContent`.

### B) Focus trap currently doesn’t account for hidden tabs/hidden footer
`maintainFocusTrap()` queries *all* focusable elements in the sheet, including elements inside the hidden tab panel and the hidden footer. This can cause the “first/last” element to be invisible and break the trap.
- `C:\Cursor AI\docs\plans\question-picker-mockup-v4.html:490`

Recommendation:
- Compute focusable elements from the **currently active tab panel** (+ header close button + visible footer), and re-evaluate on `switchTab()`.
- Ensure the focus trap listener is installed only once (opening repeatedly currently adds multiple `keydown` listeners).

### C) Difficulty filter is missing (confirm requirement for Read Aloud)
Your original requirements mention Difficulty for Read Aloud, but v4’s Filters tab does not include it.
If RA supports difficulty in the real dataset, add a segmented control (Any/Easy/Medium/Hard). If not supported, keep it absent but document that exception.

### D) `ra-prev-btn` still needs defined semantics
Read Aloud currently behaves like “next random prompt” in the app. A “previous” button requires a prompt history stack (or disable/hide the button when history is empty).
- `C:\Cursor AI\docs\plans\question-picker-mockup-v4.html:37`

### E) Decide “Apply Filters” vs “Done” (instant apply) across all modes
v4 includes an Apply button but it currently only closes the sheet.
This is fine if the app uses “instant apply”; if you intend “apply on confirm”, the UI needs “pending changes” handling (chips/count shouldn’t update until apply).
- `C:\Cursor AI\docs\plans\question-picker-mockup-v4.html:443`

### F) Minor a11y polish
- Add an `aria-label` to the chip “x” button (e.g. “Remove Status filter”).
- Consider focusing the search input when opening Jump, and the first filter control when opening Filters.

## Conclusion
v4 meets the redesign goals and is a good template for other modes. The main remaining “real app” risks are:
1) aligning with existing Read Aloud JS state updates (avoid `textContent` wiping icons), and
2) tightening the focus trap to ignore hidden tab content.

