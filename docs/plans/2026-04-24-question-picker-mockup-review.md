# Question Picker Mockup Review (Read Aloud baseline)

Files reviewed:
- `C:\Cursor AI\docs\plans\question-picker-mockup.html`
- `C:\Cursor AI\docs\plans\2026-04-24-question-filter-picker-redesign-design.md`

## Verdict
The mockup is **strongly aligned** with the redesign goals: it removes nested boxes, reduces vertical space, and standardizes interaction into a **sticky control bar + shared “Jump & Filter” sheet**.

Before implementation, a few details should be adjusted so it (a) stays unambiguous for users and (b) maps cleanly onto current code (especially Read Aloud’s existing controls and filter model).

## What’s working well
- **Compact + consistent layout**: sticky bar is the only persistent chrome; everything else moves into a sheet.
- **Information density**: navigation is centered; actions are right-aligned; the page content stays uncluttered.
- **Sheet structure matches plan**: `Jump` (search + quick nav + results) and `Filters` (status + other filters) matches the intended shared pattern.
- **Status vocabulary**: the sheet includes the intended set (`Not Started`, `In Progress`, `Completed`, `Consolidated`, `Mastered`).

## Key adjustments recommended

### 1) Disambiguate “Status” chip semantics (filter vs. current question)
In the mockup the top-right chip shows `Status: Not Started` with an `x` affordance (looks like an *active filter chip*). Meanwhile the content card also shows `Not Started` (looks like the *current question’s progress state*).

Recommendation:
- Keep **filter chips** as removable chips (with `x`).
- Show **current question status** as a **non-removable badge** (or a dedicated “Progress” pill) with a clearly different style.

Where it appears in mockup:
- Chip: `C:\Cursor AI\docs\plans\question-picker-mockup.html:59`
- Content badge: `C:\Cursor AI\docs\plans\question-picker-mockup.html:100`

### 2) Separate “open Jump” vs “open Filters”
Right now, both the title pill and the Filters button call `toggleSheet()` and open the same sheet.

Recommendation:
- Clicking the **center title pill** should open the sheet directly on **Jump**.
- Clicking **Filters** should open directly on **Filters**.
- Keep “last opened tab” behavior only if it doesn’t add cognitive load.

Where it appears in mockup:
- Title pill opens sheet: `C:\Cursor AI\docs\plans\question-picker-mockup.html:44`
- Filters button opens sheet: `C:\Cursor AI\docs\plans\question-picker-mockup.html:70`

### 3) Read Aloud: surface the *real* primary/secondary actions
Your Read Aloud requirements list includes:
- Start Recording, Stop Recording, Playback, Play sample, Next/Prev question

The mockup currently surfaces only `Start` + prev/next arrows in the center control.

Recommendation (still compact):
- Keep `Start/Stop` as the primary action.
- Add 1–2 **secondary icon buttons** next to it (or in a small overflow menu):
  - `Play sample` (if available)
  - `Playback` (after recording exists)
- Ensure `Stop` is not hidden behind multiple clicks when recording is active.

Important code compatibility note:
- Read Aloud already has wired controls by ID (must preserve in implementation):  
  `ra-record-btn`, `ra-stop-btn`, `ra-play-recording-btn`, `ra-play-audio-btn`, `ra-next-btn`, `ra-question-select`.

### 4) Sample audio filter should be tri-state (Any / Has / None)
In current Read Aloud logic, sample audio filtering is tri-state (conceptually `all / available / unavailable`).

The mockup uses a single toggle `Has Sample Audio`, which can’t express “only questions without sample audio”.

Recommendation:
- Replace the toggle with a segmented control: **Any / Has / None**.

### 5) Add “Prompt Features” filters (Read Aloud-specific)
Read Aloud has prompt feature filters (connected speech features). Those should appear in the shared sheet under a mode-specific section (only shown for RA).

Recommendation:
- Add a “Prompt Features” section with multi-select chips:
  - Any connected speech
  - Linking
  - Reduced words
  - Sound changes
- Include a small inline loading/error label when the feature index is unavailable.

### 6) Mobile sheet behavior
The design doc proposes: desktop = right-side sheet, mobile = bottom sheet.

The mockup uses a right-side sheet on all sizes (mobile uses full-width).

Recommendation:
- Either (A) accept “right sheet full-width on mobile” as v1 and update the plan, or (B) implement bottom sheet for mobile for ergonomics.

### 7) Accessibility (implementation requirement)
When this becomes real UI, treat the sheet as a dialog:
- `role="dialog"`, `aria-modal="true"`, focus trap, `Esc` to close, restore focus on close.
- Ensure the active-chip `x`, segmented controls, and list rows are reachable and operable via keyboard.

## Overall conclusion
Yes—this mockup is **consistent with the redesign instructions** and is a good baseline for all modes.  
With the adjustments above (especially Read Aloud action surfacing + tri-state sample-audio filter + prompt-feature filters), it should translate cleanly into the existing code without breaking existing behavior.

