# Question Picker Mockup v3 Review (Read Aloud baseline)

File reviewed:
- `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html`

Reference design doc:
- `C:\Cursor AI\docs\plans\2026-04-24-question-filter-picker-redesign-design.md`

## Verdict
v3 is **very close to “implementation-ready”** from a UX + consistency standpoint:
- Sticky control bar is compact and uncluttered.
- Jump/Filter sheet is shared, predictable, and mobile-friendly.
- It explicitly addresses the “don’t break existing functions” concern better than v2.

## What v3 improved (high value)

### 1) Compatibility-safe “question select”
v2 used `id="ra-question-select"` on a `<div>`, which would break Read Aloud’s existing JS expectations.

v3 fixes this by:
- introducing a visible pill button (`id="ra-question-pill"`) for opening Jump  
  `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:51`
- keeping a hidden real `<select id="ra-question-select">` for wiring compatibility  
  `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:57`

### 2) Mobile secondary actions solved
Desktop keeps inline sample/playback icons, and mobile gets an overflow menu:
- desktop icons: `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:100`
- mobile overflow menu: `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:121`

### 3) Accessibility is meaningfully improved (still not “complete”)
Notable additions:
- dialog focusability (`tabindex="-1"`)  
  `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:202`
- restore focus to trigger element on close  
  `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:492`
- tab semantics (`role="tablist"`, `role="tab"`, `aria-selected`)  
  `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:225`

### 4) Safe-area support on iOS
Adds `viewport-fit=cover` and safe-area padding utility:
- `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:6`
- `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:19`

## Gaps / changes recommended (before you implement)

### A) Read Aloud **must still support Stop Recording**
The current app has a separate `ra-stop-btn` that `read-aloud-mode.js` wires up.

In v3, `ra-stop-btn` does not appear in the mockup (so implementing this literally would break stop-recording unless JS is refactored).

Recommendation:
- Keep both `ra-record-btn` and `ra-stop-btn` in the bar and swap visibility (same footprint), or refactor the JS to toggle a single button.

### B) Status filter list should include the full shared set (consistency across modes)
Your design instructions require: `Not Started`, `In Progress`, `Completed`, `Consolidated`, `Mastered`.

v3’s filter UI shows only a subset (missing `Completed` and `Consolidated`).  
See: `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:322`

### C) Read Aloud “Play sample” wiring choice still needs a clear implementation strategy
To avoid duplicate IDs, v3 uses:
- `header-ra-play-audio-btn`  
  `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:102`
- `header-ra-play-recording-btn`  
  `C:\Cursor AI\docs\plans\question-picker-mockup-v3.html:110`

This avoids collisions, but current JS won’t auto-bind to those IDs. Decide one:
- move the existing elements into the header (preserve original IDs), or
- bind events to both old + header IDs, or
- make header buttons proxy-click the existing controls.

### D) Optional but recommended: improve dialog labeling + focus trap
v3 is close; add for production:
- `aria-labelledby="sheet-title"` on `#filter-sheet`
- real focus trap (Tab/Shift+Tab loop) instead of just `sheet.focus()`

### E) Decide whether filters are “Apply” or “instant apply” across all modes
v3 uses `Apply Filters`. That’s fine, but the final choice needs to be consistent across every mode using the shared sheet pattern.

## Conclusion
v3 is the best of the three mockups so far. The remaining “must fix” items are:
1) add a Stop Recording affordance that matches existing Read Aloud wiring, and
2) include the full shared status vocabulary in the filters.

