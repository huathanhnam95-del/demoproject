# Question Picker Mockup v2 Review (Read Aloud baseline)

File reviewed:
- `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html`

Reference design doc:
- `C:\Cursor AI\docs\plans\2026-04-24-question-filter-picker-redesign-design.md`

## Verdict
This v2 mockup is **a clear improvement** and is now **strongly compliant** with the redesign instructions:
- fewer nested boxes
- far less empty vertical space
- consistent layout model (sticky bar + shared sheet)
- mode-specific filters and actions live behind one pattern

## What v2 fixed (vs. v1)

### 1) Filter chip vs. current-question status is now clear
- Removable filter chip is visually neutral and clearly “chip-like”.  
  See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:61`
- Current-question progress badge is **not removable** and styled differently.  
  See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:139`

### 2) “Open Jump” vs “Open Filters” is now deterministic
- Center title opens Jump directly.  
  See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:47`
- Filters button opens Filters directly.  
  See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:74`

### 3) Read Aloud secondary actions are surfaced
- Sample audio and playback are available as compact icon buttons (desktop).  
  See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:86`

### 4) Sample audio filter is tri-state
- Any / Has Sample / None is present (matches the real-world RA filter needs).  
  See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:315`

### 5) Prompt feature filters are present
- Prompt Features section exists and is clearly marked as RA-specific.  
  See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:329`

### 6) Mobile sheet ergonomics improved
- Desktop = right-side sheet; mobile = bottom sheet with handle.  
  See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:168`

### 7) Basic dialog accessibility included
- `role="dialog"` + `aria-modal="true"` and `Esc` closes.  
  See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:169`

## Remaining issues / recommendations (before implementation)

### A) **Do not repurpose `id="ra-question-select"` as a non-`<select>` in production**
Read Aloud’s current JS expects `ra-question-select` to behave like a `<select>` (uses `.options`, `.value`, `.disabled`, and listens for `change`).
- In the mockup it is a clickable `<div>`.  
  See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:45`

Recommended implementation-safe approach:
- Keep a real `<select id="ra-question-select">` for compatibility (can be visually hidden).
- Add a separate pill/button (e.g. `id="ra-question-pill"`) that opens Jump.
- When a Jump list item is clicked, set the `<select>` value and dispatch `change`.

### B) Avoid duplicate IDs when integrating
In the current app, `ra-play-audio-btn` already exists in the Read Aloud audio player area. If the header button is added without moving/removing the old element, you will create an invalid DOM and break event wiring.  
See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:88`

Recommendation:
- Move the existing element into the bar, or rename one and update wiring intentionally.

### C) “Previous Question” needs real behavior
`id="ra-prev-btn"` is new in the mockup, but the current Read Aloud flow is “next random prompt”. If you want true “previous”, you’ll need a small prompt history stack.  
See: `C:\Cursor AI\docs\plans\question-picker-mockup-v2.html:37`

### D) Mobile access to secondary actions
Secondary icons are hidden on small screens (`hidden sm:flex`). If users need sample audio/playback on mobile, add:
- an overflow menu in the bar, or
- quick actions in the Jump tab, or
- “Audio controls” section in Filters (mode-specific).

### E) Decide “Apply” vs “instant apply” and keep consistent across modes
The mockup uses `Apply Filters`. Some existing modes apply filters immediately. Either approach works, but the pattern should be consistent across all modes (and the chip count should reflect unapplied changes if using Apply).

### F) Focus management (a11y)
V2 adds `role="dialog"` and `Esc`, but production should also include:
- focus trap inside the sheet
- return focus to the triggering button on close
- ensure the backdrop isn’t focusable

### G) Tailwind utility sanity
Classes like `pb-safe` aren’t standard Tailwind via CDN; if this becomes real Tailwind code, ensure you have safe-area utilities configured or replace with explicit CSS.

## Conclusion
Ship the **v2 structure** as the shared pattern across modes; it now matches the redesign objectives well.  
The main “don’t break existing functions” blockers are (A) `ra-question-select` element type and (B) avoiding duplicate IDs like `ra-play-audio-btn`.

