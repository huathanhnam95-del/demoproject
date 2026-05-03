# Question Picker Mockup v6 Review (Read Aloud baseline)

File reviewed:
- `C:\Cursor AI\docs\plans\question-picker-mockup-v6.html`

## Verdict
v6 is **overall a step forward** from v5 because it fixes a major keyboard-accessibility issue in the Status filter.  
However, it introduces some complexity/regressions in the segmented radio controls (Sample Audio / Difficulty) by mixing **native radios** with **custom ARIA radios**, which will likely cause duplicate focus stops and confusing screen-reader output if implemented as-is.

## What improved vs v5 (good changes)

### 1) Status filter is keyboard reachable again
v5 used `tabindex="-1"` on the checkbox inputs (keyboard users couldn’t reach them).  
v6 removes that and adds a visible focus style via `focus-within`.
- `C:\Cursor AI\docs\plans\question-picker-mockup-v6.html:327`

### 2) Icon-only nav buttons have accessible labels
Prev/Next now include `sr-only` text labels.
- Prev: `C:\Cursor AI\docs\plans\question-picker-mockup-v6.html:40`
- Next: `C:\Cursor AI\docs\plans\question-picker-mockup-v6.html:60`

### 3) Hidden `<select>` is kept out of tab order
This preserves app wiring while reducing accidental focus traps on a hidden control.
- `C:\Cursor AI\docs\plans\question-picker-mockup-v6.html:54`

## Issues / recommendations (before implementation)

### A) Don’t mix native radios with `role="radio"` elements (Sample Audio / Difficulty)
Each option currently has:
- a native `<input type="radio" class="sr-only">` (focusable)
- plus a `<div tabindex="0" role="radio">` (also focusable)

This creates **two tab stops per option**, duplicate semantics, and the custom radios are not in a `role="radiogroup"`.
- Sample Audio options: `C:\Cursor AI\docs\plans\question-picker-mockup-v6.html:365`
- Difficulty options: `C:\Cursor AI\docs\plans\question-picker-mockup-v6.html:396`

Recommended approach (simpler + more robust):
- Keep **only the native radio** (sr-only + `peer`), and add `peer-focus` styling on the visible segment so focus is visible without extra tabindex/roles.
- Remove the custom `role="radio"` divs and inline `onclick/onkeydown` handlers.

### B) Space key handler is likely incorrect
The custom handlers use `event.key === 'Space'`, but browsers typically report the spacebar as `' '` (space character).  
So keyboard selection may not work reliably.
- Example: `C:\Cursor AI\docs\plans\question-picker-mockup-v6.html:369`

(This goes away automatically if you revert to native radio behavior.)

### C) Existing Read Aloud JS will still wipe SVG/button markup unless refactored
The mockup keeps structured markup inside `ra-record-btn` / `ra-stop-btn` (SVG + `[data-label]` spans).
- `C:\Cursor AI\docs\plans\question-picker-mockup-v6.html:125`

But the current app (`C:\Cursor AI\public\read-aloud-mode.js`) assigns `recordBtn.textContent = ...` in multiple states, which would remove the SVG + spans.  
Implementation needs to switch those updates to target `[data-label]` instead of setting `textContent` on the whole button.

## Conclusion
If you keep the v6 layout and Status filter fix, but revert the segmented controls back to **native radios + peer-focus styling**, this will be a clean, consistent template to implement across modes.

