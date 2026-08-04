# Speaking Modes UI Audit — 2026-08-01

> **Status update 2026-08-02:** the unification fixes landed and were re-verified from a
> fresh audit run. Issues A1, B1, C1–C3, D1–D2, E1–E2, F1–F3, H1, I1–I2, J1–J3 are closed.
> Three follow-up defects found during that review (stepper flush against the controller,
> stepper 24 px over-wide, Read Aloud timer baseline) were fixed in
> `public/speaking-practice-controller.css` and re-verified.
>
> **G1 closed 2026-08-02.** The status, length and difficulty dropdowns in
> speak/notes/sgd/describe-image now render as the same always-visible, labelled segmented
> pills Read Aloud uses (44 px, Outfit, radius 12, shared purple selected state). The trigger
> buttons and popup behaviour are suppressed in CSS scoped to `.spc-mode-settings-sheet`; the
> option nodes, IDs and click handlers are untouched, and the controller strips its injected
> labels and ARIA on restore. Reading/Listening modes that use the same markup outside a
> Speaking sheet are unaffected.
>
> **Residual dead space closed 2026-08-02.** Root cause was legacy control wrappers
> (`.controls` in Retell Lecture / SGD / Describe Image, the Start-button row in Repeat
> Sentence) that keep their own margins after the controller adopts their buttons, leaving
> them zero-height but still spaced. They now hide via `:not(:has(*))` while they hold nothing
> but the controller's restore anchor, and reappear automatically when the buttons are
> restored. rts 16 → 0 px, notes/sgd 20 → 0 px, describe-image 32 → 12 px (the remaining 12 px
> is `#di-image-preview`'s own deliberate bottom margin, matching the stepper gap).
>
> **Tutorial pill scope corrected.** The F1 fix had made the `?` pill visible in *every* mode,
> which broke the documented contract that Reading modes without a tutorial hide it. It is now
> always shown for Speaking modes (disabled where no tutorial exists) and keeps the original
> hide-when-no-tutorial behaviour everywhere else.
>
> **Two stale expectations in `tests/browser/practice-modes-browser-check.js` corrected**, both
> pre-existing and unrelated to Speaking (the first was reproduced identically on a pristine
> `HEAD` worktree; the second was masked behind it): `sgd: { difficulty: false }` contradicted
> committed markup that ships `#difficulty-filter-container-sgd`, and the rfib mode-display
> expectation still read `Fill in the blanks` after the label was disambiguated from the
> drag-and-drop variant to `Fill in the Blanks (Dropdown)`.
>
> `tests/browser/rfib-mode-browser-check.js` failed once during this pass and passed on two
> consecutive re-runs with no intervening change — flaky, not a regression.

**Method:** Headless Chromium (Playwright) over `public/`, guest session, mic stubbed.
Cold page per mode, desktop 1440×1000 and mobile 390×844. Computed styles + geometry
captured from the live DOM, not from source reading.

**Harnesses (re-runnable):**

```bash
node tests/browser/speaking-ui-full-audit.js
```

```bash
node tests/browser/speaking-settings-audit.js
```

**Artifacts:** `test-results/speaking-ui-audit-2026-08-01/` — `report.json`,
`settings-report2.json`, and per-mode screenshots at both widths.

**Modes covered:** `read-aloud`, `rts` (Repeat Sentence), `asq` (Answer Short Question),
`describe-image`, `notes` (Retell Lecture), `sgd` (Summarize Group Discussion), `speak`.

---

## Part 1 — Review of the 2026-08-01 repair plan

| Plan task | Status | Evidence |
|---|---|---|
| T1 Regression coverage | Done | `tests/browser/speaking-ui-review-regression-check.js` exists and exits 0 |
| T2 HTML containment boundary | **Verified fixed** | All 7 Speaking panels report `insideMain: true`, all measure 1100 px inside a 1180 px `main.container` |
| T3 Read Aloud atomic first paint | **Verified fixed** | RA trace has no `visible && !controller` entry (flash = 0 ms) at both widths |
| T4 Shared settings recipe for RA | **Partially done** | `#ra-diff-*` are now Outfit / 44 px / radius 12 px. The eight `.ra-filter-pill` buttons in the same panel are still Arial / 30–34 px / radius 999 px / `appearance:auto` |
| T5 Rebalance action row | Done for `speak` | `.spc-row--actions` is `flex-start`, no mobile overflow, max slot gap 24 px |
| T6 Full verification | Passed but under-scoped | The check only asserts RA first paint, only `#ra-diff-all` styling, only the `speak` action row |

**Why the plan's green tests missed the reported symptoms:** each assertion was written
against the single mode where the defect was first observed. The same defects exist in
sibling modes that the suite never activates.

---

## Part 2 — Issue inventory

Severity: **P1** blocks or breaks the experience · **P2** visible inconsistency · **P3** polish.

### A. Legacy-UI flash on mode entry (user issue #3)

| Mode | Visible-before-controller window |
|---|---|
| `notes` (Retell Lecture) | **728 ms** desktop / **718 ms** mobile |
| `sgd` | **689 ms** desktop / **699 ms** mobile |
| `asq` | 119 ms / 108 ms |
| `speak` | 24 ms / 23 ms |
| `describe-image`, `rts` | 5–7 ms |
| `read-aloud` | 0 ms |

**A1 (P1).** `public/script.js:2105` computes `deferSelectedPanelReveal = mode === 'read-aloud'`.
The atomic-reveal fix is hard-coded to one mode, so every other Speaking mode still paints
its legacy panel first. RL and SGD are worst because their adapters do async question-index
work before the controller mounts.

### B. Banners (user issues #5 and #6)

**B1 (P1).** Three legacy yellow "info box" banners still render, and they break the
controller card: `#notes-info-box` (`index.html:4133`), `#sgd-info-box` (`4292`),
`#di-info-box` (`4711`). Each is a full-width warning-styled bar with a `×` close button
(`.info-box-close`, 28 px, radius 0, Arial) sitting directly under the controller. Screenshot
evidence: `notes-desktop.png`, `sgd-desktop.png`, `describe-image-desktop.png`.
Escalated by the user to "remove"; DI's should be replaced by a step indicator (see D).

### C. Read Aloud settings sheet (user issue #1)

**C1 (P1).** Two different button languages inside one panel:

| Control | Class | Font | Height | Radius | `appearance` |
|---|---|---|---|---|---|
| Sample-audio / prompt-feature filters | `.ra-filter-pill` | **Arial** | **30–34 px** | **999 px** | **auto** |
| Difficulty levels | `.read-aloud-filter-btn` | Outfit | 44 px | 12 px | none |

The plan's Task 4.2 recipe targets `.read-aloud-filter-btn` only. The pills are authored in
`public/index.html:5142–5160` and moved into the sheet at `public/read-aloud-mode.js:1615`, so
they never receive it. This is exactly the "messy / inconsistent buttons" in the screenshot.

**C2 (P2).** `.spc-sheet-close` (`×`) is Arial 20 px with a 1 px **orange** border
(`rgb(254,215,170)`) — an accent that appears nowhere else in the design.

**C3 (P2).** Sub-44 px touch targets in the sheet: filter pills at 30 px and 34 px.

### D. Step indicator (user issue #4)

**D1 (P2).** The "Audio → Prep → Record → Results" breadcrumb the user wants everywhere is
`.rts-step-progress` (`index.html:4610`, CSS `style.css:20961`). Near-duplicates already exist
as `.di-step-progress` and `.sgd-step-progress` — three copies of the same idea. Missing
entirely from `read-aloud`, `asq`, `notes`, `speak`.

**D2 (P2).** Where the stepper exists it is hidden until the learner presses Start, so the
flow is never previewed — the opposite of what the user asked for.

### E. Shared controller chrome typography (root cause of "inconsistent to the overall design")

**E1 (P1).** Every controller-owned button renders in **Arial**, while every adapter-adopted
mode button renders in **Outfit**, in all 7 modes:

| Element | Font | Size | Height |
|---|---|---|---|
| `.spc-picker-*` (question picker) | Arial | 14 px | 44 px |
| `.spc-picker-prev` / `-next` | Arial | 16 px | **36 px** |
| `.spc-view-toggle-btn` (Basic / Advanced / ⚙ Settings) | Arial | 13 px | **36 px** |
| Adopted mode buttons (Play, Record, Start) | Outfit | 15.2 px | 44 px |

`public/speaking-practice-controller.css` never sets `font-family`, so the UA default wins on
`<button>`. This is the single highest-leverage fix: it makes the whole bar look foreign.

**E2 (P2).** Controller chrome is 36 px tall — below the 44 px touch target the same
stylesheet enforces on action buttons, and below its own picker at 44 px.

### F. Control inventory is not consistent across modes (user issue #2)

| Mode | Help `?` | Prev/Next | Basic/Adv/Settings | Attempts chip | Stepper |
|---|---|---|---|---|---|
| read-aloud | ✅ | ✅ | ✅ | — | ❌ |
| rts | ❌ | ✅ | **hidden** | — | ✅ (hidden) |
| asq | ❌ | **❌** | **hidden** | ✅ | ❌ |
| describe-image | ❌ | ✅ | ✅ | — | ✅ (hidden) |
| notes | ✅ | ✅ | ✅ | — | ❌ |
| sgd | ❌ | ✅ | ✅ | — | ✅ (hidden) |
| speak | ✅ | ✅ | ✅ | ✅ | ❌ |

**F1 (P2).** The mode-tutorial `?` pill shows in 3 of 7 modes.
**F2 (P2).** ASQ has no prev/next arrows — its picker is the only one that starts at the card's
left edge, so the whole column misaligns against every sibling mode.
**F3 (P1).** RTS and ASQ create a settings sheet whose trigger is hidden — the sheet exists,
is reachable by keyboard/script, and is **empty** (header + one tab, no controls). Same for
`describe-image`: `spc-settings-sheet-describe-image` contains zero controls behind a
**visible** ⚙ Settings button. Clicking Settings in Describe Image opens an empty drawer.

### G. Difficulty filtering has three different UIs

**G1 (P2).** Same user intent, three presentations:
- `read-aloud`: pill row + 44 px segmented difficulty buttons;
- `speak` / `notes` / `sgd`: Arial dropdown buttons `Filter by Status ▼`, `Filter by Length ▼`, `Recommended ▼`;
- `rts` / `asq` / `describe-image`: nothing at all.

### H. Read Aloud does not use the shared action row

**H1 (P1).** RA's `.spc-row--actions` is empty (0 children). Its record button, prep/record
timers and hint live in `#ra-zone-actions`, a detached 158 px block below the passage. Every
other mode adopts its action buttons into the controller. Same-family modes therefore put the
primary CTA in two different places.

### I. Orphaned legacy text outside any card

**I1 (P2).** Raw, unstyled text nodes still render below the controller:
`Total number of questions: 540` (`#question-total`, notes/DI), `Points: 0`
(`#score-notes`, `#score-sgd`), `Total images: 1170` (DI). Left-aligned at arbitrary
positions, no card, no label styling. See `notes-desktop.png`.

**I2 (P3).** In `speak`, `#question-selector` survives as a 6 px-tall zero-content strip
between the controller and the transcription box.

### J. Layout / spacing

**J1 (P2).** The controller card reserves space for empty rows: `.spc-row--advanced` is
present but zero-height in all 7 modes, and `notes`/`asq`/`describe-image` show 40–90 px of
dead white space at the bottom of the panel card.

**J2 (P2).** `speak`'s "5 times left" attempts chip is rendered with button geometry
(border, radius, 44 px) next to Play, so it reads as a clickable control but is inert.

**J3 (P3).** `.spc-row--actions` uses `gap: 8px 24px`. The 24 px column gap visually splits
Play from Start Recording in `speak` and Play from Record answer in `asq` into two groups.

**J4 (P3).** Read Aloud's passage renders in a serif face while all surrounding chrome is
Outfit.

### K. Non-blocking

**K1 (P3).** Every Speaking mode logs the same console errors under a static server:
`word-reference-service.js` `ERR_CONNECTION_REFUSED` to the Praat backend, plus one 404.
Expected offline; noted so it is not mistaken for a UI regression.

---

## Part 3 — Why this keeps recurring

1. **Fixes are applied per-mode, not per-system.** `deferSelectedPanelReveal` hard-codes
   `read-aloud`; the settings recipe hard-codes `.read-aloud-filter-btn`; the action-row fix
   was verified only on `speak`.
2. **Tests assert the settled DOM of one mode.** 185 controller checks pass while six modes
   flash legacy UI, three settings drawers are empty, and all controller chrome is Arial.
3. **No shared token contract for controller chrome.** `speaking-practice-controller.css` styles
   geometry but never declares `font-family`, so the UA default silently wins on every
   `<button>` the controller itself creates.
4. **Legacy nodes are hidden, not removed.** Info boxes, `#question-total`, `#score-*` and
   `#question-selector` are all still in the panel and still paint.
