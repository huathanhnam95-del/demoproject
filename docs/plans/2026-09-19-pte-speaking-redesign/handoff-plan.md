# PTE Speaking redesign — implementation handoff plan

| | |
|---|---|
| **Date** | Saturday, 19 September 2026 |
| **Status** | Design approved by the product owner in chat (Read Aloud mockup v3, other Speaking modes mockup v1). **Not implemented.** |
| **Source SHA at time of writing** | `42a1686c0` (branch `feat/projects-subtasks-people`; start your work from `main`, see Phase 0) |
| **Engineering owner** | Unresolved. Record it in your task contract (see [AGENTS.md](../../../AGENTS.md)). |
| **Tracker** | `TASK_TRACKER.csv` rows 1216–1221 record the design work. Add new rows for each phase you execute. |
| **Scope** | PTE scope of 7 Speaking modes: Read Aloud (`read-aloud`), Repeat Sentence (`speak`), Describe Image (`describe-image`), Retell Lecture (`notes`), Answer Short Question (`asq`), Summarize Group Discussion (`sgd`), Respond to a Situation (`rts`). |

This plan is written for coding agents. Every task names the files, functions, element IDs and CSS classes to touch, gives the exact UI copy, and points to a target screenshot. **When a task and a screenshot disagree, the screenshot wins for layout and the task wins for behaviour.** If you find something the plan does not cover, stop and record the question in "Open decisions" (section 11) rather than inventing product behaviour.

---

## Contents

1. [How to use this plan](#1-how-to-use-this-plan)
2. [What changes, in one page](#2-what-changes-in-one-page)
3. [Visual references (image index)](#3-visual-references-image-index)
4. [Design specification](#4-design-specification)
5. [Architecture](#5-architecture)
6. [Phase 0 — setup](#phase-0--setup)
7. [Phase 1 — shared shell and components](#phase-1--shared-shell-and-components)
8. [Phase 2 — Read Aloud](#phase-2--read-aloud)
9. [Phases 3–8 — the other Speaking modes](#phases-38--the-other-speaking-modes)
10. [Phase 9 — cross-mode QA, rollout, documentation](#phase-9--cross-mode-qa-rollout-documentation)
11. [Open decisions](#11-open-decisions)
12. [Appendices: copy deck, element maps, phase matrices](#12-appendices)

---

## 1. How to use this plan

### 1.1 Rules you must follow (from the repo)

- [AGENTS.md](../../../AGENTS.md) and [agent_docs/project_structure.md](../../../agent_docs/project_structure.md) govern placement. Before coding, write the **external task contract** and before snapshot (`node scripts/structure/check.cjs snapshot …`) as described in [docs/AGENTS.md](../../AGENTS.md). Declare every path this plan tells you to create or modify.
- Track work in `TASK_TRACKER.csv` (append a row with `In Progress`; set `Done` only with proof). Use targeted line edits; never rewrite the file.
- **Never deploy to production.** Preview-channel deploys only when the product owner asks. No `git push` to production branches unless instructed.
- Browser verification is **Chrome only**, using the local Playwright workflow (`tests/browser/*.js` pattern). Login credentials, if ever needed, are in `C:\Cursor AI\.local\browser-test-credentials.md`. Do not copy them anywhere.
- Recording code must route audio through `window.AudioDspPipeline` (mandatory, see AGENTS.md "Developing New Practice Modes").
- Read Aloud and Repeat Sentence scoring must keep the **Azure forced-alignment** convention and the word colour thresholds **Green ≥ 80, Amber 60–79, Red < 60** (AGENTS.md "Pronunciation and Text Comparison Convention"). This plan changes layout, not scoring.
- Keep each file's loader format: `speaking-practice-controller.js`, the mode files and the new modules in this plan are **classic browser scripts that register globals** (`window.X = …`). Do not convert them to ES modules.

### 1.2 How to read the references

- Open the interactive mockups locally in Chrome: [`mockups/read-aloud.html`](mockups/read-aloud.html) and [`mockups/speaking-modes.html`](mockups/speaking-modes.html). They are self-contained (Google Fonts only). Use the **State** switcher, turn **Notes** on to see numbered annotations, and **Current app** to compare with today's screen. Turn **Live timers** on to watch the countdown → recording → Complete sequence.
- Static screenshots of every state are in [`images/target/`](images/target/). The user's own reference images are in [`images/reference/`](images/reference/). Today's screens are in [`images/current/`](images/current/).
- The mockups are the visual source of truth for spacing, colour and copy. Their CSS (inline `<style>` blocks) can be lifted into the production stylesheets named in this plan; rename classes to the `pte-` prefix given in section 4.

### 1.3 Definition of done (every phase)

1. The feature flag `?pteShell=v3` shows the new layout for the phase's mode(s); `?pteShell=legacy` and the default (flag off) show today's layout unchanged.
2. The phase's new Playwright check passes in Chrome at **1440×900** and **390×844**, and the existing checks listed for that phase still pass with the flag off.
3. A screenshot of each state is saved to the evidence folder you declared in your task contract (not into `public/`), and compared by eye with the matching image in `images/target/`.
4. No new console errors; no horizontal page scroll at 390px; feedback card height ≤ **740px** at 1440×900 (measured by the Phase 9 script).
5. `TASK_TRACKER.csv` row set to `Done` with the date.

---

## 2. What changes, in one page

**Keep**: the PTE question area agreed earlier: instruction line (Arial), question content, the blue **audio box** with "Status:" line and volume, plus timings from each mode.
**Replace**: everything around it, using BEL design tokens (`public/design-tokens.css`).

| Area | Today | New (v3) |
|---|---|---|
| Top of page | Page header row ("Practice", Back to Dashboard, mode pill with `?`, level chip) + SPC row (picker, 🎲 Random, Basic/Advanced, ⚙ Settings, ⛶) + RA heading "Question 996 · READ ALOUD" + step bar + status line | **One mode bar**: back · mode name + "Speaking" · v7 picker · Filters · More (⋯) · level chip ([ra-01](images/target/read-aloud/ra-01-prep-coach-closed.png)) |
| Steps | Numbered step bar `SpeakingPracticeSteps` | Thin 3-segment **progress bar** at the top of the card |
| Recorder | Blue "Recorded Answer" box / footer PREP TIME & RECORD TIME | **Recorder widget** from the guideline: countdown circle → red recording ring + elapsed + live waveform + total → green Complete ([ref-05](images/reference/ref-05-recorder-guideline.png)) |
| Audio-then-speak tasks | Play button, player and recorder visible together | **Audio box first; recorder appears only after the audio ends** ([ref-03](images/reference/ref-03-audio-box-then-recorder.png)) |
| Actions | `spc-footer` with rainbow buttons (red, green, orange, purple), separate "Next prompt" | **Action dock** at the bottom of the card: status text left; helpers, one blue primary, **Next →** right; helpers hidden while recording |
| Next | Always allowed | "**Cannot skip**" dialog during the countdown to recording; confirmation dialog while listening, recording, or complete; direct on Feedback |
| Helpers | Speech Coach rail always open + tips box (RA); Shadow in Advanced row (RS); Play prompt (ASQ) | Helpers next to the primary button: **Coach** (RA), **Replay · n** and **Shadow · 5c** (RS), **Replay question** (ASQ), **Intro video** (RL) |
| Settings | ⚙ Settings sheet with tabs (RA: Practice Target / Listen / History) | Filters popover (question selection), sample voice beside the sample player in Feedback, **Previous attempts** as a section at the end of the page |
| Feedback | Long single column, scroll needed | **Two columns, no scrolling**: what you said on the left; scores, next steps and a second tab on the right |
| History | Hidden behind Settings → History → button | **Previous attempts** section always visible at the end of the mode page |

---

## 3. Visual references (image index)

All paths are relative to this folder.

### 3.1 Reference images from the product owner

| File | What it fixes |
|---|---|
| [ref-01-pte-screen-captures-strip.webp](images/reference/ref-01-pte-screen-captures-strip.webp) | Original 18 PTE test screen captures (tiny). Enlarged sheets: [ref-01a](images/reference/ref-01a-pte-captures-speaking.png), [ref-01b](images/reference/ref-01b-pte-captures-speaking-writing.png), [ref-01c](images/reference/ref-01c-pte-captures-listening.png) |
| [ref-02-question-area-to-keep.png](images/reference/ref-02-question-area-to-keep.png) | The only part styled like the test: instruction, recorder/audio box, passage |
| [ref-03-audio-box-then-recorder.png](images/reference/ref-03-audio-box-then-recorder.png) | Audio box and recorder must appear one after another, not together |
| [ref-04-remove-dock-status-line.png](images/reference/ref-04-remove-dock-status-line.png) | Remove the "Listening to you…" line + level bars from the dock during recording (the waveform replaces it) |
| [ref-05-recorder-guideline.png](images/reference/ref-05-recorder-guideline.png) | **Recorder widget guideline** + Next rules (Vietnamese notes translated in section 4.6) |

### 3.2 Target screenshots — Read Aloud (`images/target/read-aloud/`)

| # | File | State |
|---|---|---|
| 1 | [ra-01-prep-coach-closed.png](images/target/read-aloud/ra-01-prep-coach-closed.png) | Prepare, Coach closed (default) |
| 2 | [ra-02-prep-coach-open-word-popover.png](images/target/read-aloud/ra-02-prep-coach-open-word-popover.png) | Prepare, Coach drawer open, word popover on "the" |
| 3 | [ra-03-recording.png](images/target/read-aloud/ra-03-recording.png) | Recording (Coach button and drawer hidden) |
| 4 | [ra-04-complete-coach-open.png](images/target/read-aloud/ra-04-complete-coach-open.png) | Complete, Coach reopened |
| 5 | [ra-05-complete.png](images/target/read-aloud/ra-05-complete.png) | Complete, Coach closed |
| 6 | [ra-06-feedback-results-tab.png](images/target/read-aloud/ra-06-feedback-results-tab.png) | Feedback, two columns, "Your results" tab |
| 7 | [ra-07-feedback-sample-voice.png](images/target/read-aloud/ra-07-feedback-sample-voice.png) | Feedback, Sample source selected → voice/speed row |
| 8 | [ra-08-feedback-coach-tab.png](images/target/read-aloud/ra-08-feedback-coach-tab.png) | Feedback, "Coach tips · 4" tab (Coach button in dock) |
| 9 | [ra-09-feedback-advanced-analysis.png](images/target/read-aloud/ra-09-feedback-advanced-analysis.png) | Feedback, advanced analysis expanded (only case that may scroll) |
| 10 | [ra-10-previous-attempts-section.png](images/target/read-aloud/ra-10-previous-attempts-section.png) | Previous attempts section |
| 11 | [ra-11-filters-popover.png](images/target/read-aloud/ra-11-filters-popover.png) | Filters popover |
| 12 | [ra-12-more-menu.png](images/target/read-aloud/ra-12-more-menu.png) | More menu |
| 13 | [ra-13-question-picker.png](images/target/read-aloud/ra-13-question-picker.png) | Question picker popover (reuse the existing v7 sheet behaviour) |
| 14 | [ra-14-dialog-cannot-skip.png](images/target/read-aloud/ra-14-dialog-cannot-skip.png) | Next during countdown |
| 15 | [ra-15-dialog-confirm-next.png](images/target/read-aloud/ra-15-dialog-confirm-next.png) | Next while recording |
| 16 | [ra-16-annotated-prep.png](images/target/read-aloud/ra-16-annotated-prep.png) | Prepare with numbered annotations (see Appendix C) |
| 17 | [ra-17-annotated-feedback.png](images/target/read-aloud/ra-17-annotated-feedback.png) | Feedback with numbered annotations |
| 18 | [ra-18-mobile-prep.png](images/target/read-aloud/ra-18-mobile-prep.png) | 390px, Prepare |
| 19 | [ra-19-mobile-feedback.png](images/target/read-aloud/ra-19-mobile-feedback.png) | 390px, Feedback (columns stack) |
| — | [ra-rw-01-countdown.png](images/target/read-aloud/ra-rw-01-countdown.png), [ra-rw-02-recording.png](images/target/read-aloud/ra-rw-02-recording.png), [ra-rw-03-complete.png](images/target/read-aloud/ra-rw-03-complete.png) | Recorder widget close-ups |

### 3.3 Target screenshots — other modes (`images/target/speaking/`)

Each mode has: `-00-annotated-prepare`, `-01-listen` (audio modes), `-02-prepare`, `-03-recording`, `-04-complete`, `-05-feedback`, `-06-feedback-second-tab`.

| Mode | Files |
|---|---|
| Repeat Sentence | [00](images/target/speaking/repeat-sentence-00-annotated-prepare.png) · [01](images/target/speaking/repeat-sentence-01-listen.png) · [02](images/target/speaking/repeat-sentence-02-prepare.png) · [03](images/target/speaking/repeat-sentence-03-recording.png) · [04](images/target/speaking/repeat-sentence-04-complete.png) · [05](images/target/speaking/repeat-sentence-05-feedback.png) · [06](images/target/speaking/repeat-sentence-06-feedback-second-tab.png) |
| Describe Image | [00](images/target/speaking/describe-image-00-annotated-prepare.png) · [02](images/target/speaking/describe-image-02-prepare.png) · [03](images/target/speaking/describe-image-03-recording.png) · [04](images/target/speaking/describe-image-04-complete.png) · [05](images/target/speaking/describe-image-05-feedback.png) · [06](images/target/speaking/describe-image-06-feedback-second-tab.png) · [07 zoom](images/target/speaking/describe-image-07-zoom.png) |
| Retell Lecture | [00](images/target/speaking/retell-lecture-00-annotated-prepare.png) · [01](images/target/speaking/retell-lecture-01-listen.png) · [02](images/target/speaking/retell-lecture-02-prepare.png) · [03](images/target/speaking/retell-lecture-03-recording.png) · [04](images/target/speaking/retell-lecture-04-complete.png) · [05](images/target/speaking/retell-lecture-05-feedback.png) · [06](images/target/speaking/retell-lecture-06-feedback-second-tab.png) |
| Answer Short Question | [00](images/target/speaking/answer-short-question-00-annotated-prepare.png) · [01](images/target/speaking/answer-short-question-01-listen.png) · [02](images/target/speaking/answer-short-question-02-prepare.png) · [03](images/target/speaking/answer-short-question-03-recording.png) · [04](images/target/speaking/answer-short-question-04-complete.png) · [05](images/target/speaking/answer-short-question-05-feedback.png) |
| Summarize Group Discussion | [00](images/target/speaking/summarize-group-discussion-00-annotated-prepare.png) · [01](images/target/speaking/summarize-group-discussion-01-listen.png) · [02](images/target/speaking/summarize-group-discussion-02-prepare.png) · [03](images/target/speaking/summarize-group-discussion-03-recording.png) · [04](images/target/speaking/summarize-group-discussion-04-complete.png) · [05](images/target/speaking/summarize-group-discussion-05-feedback.png) · [06](images/target/speaking/summarize-group-discussion-06-feedback-second-tab.png) |
| Respond to a Situation | [00](images/target/speaking/respond-to-situation-00-annotated-prepare.png) · [01](images/target/speaking/respond-to-situation-01-listen.png) · [02](images/target/speaking/respond-to-situation-02-prepare.png) · [03](images/target/speaking/respond-to-situation-03-recording.png) · [04](images/target/speaking/respond-to-situation-04-complete.png) · [05](images/target/speaking/respond-to-situation-05-feedback.png) · [06](images/target/speaking/respond-to-situation-06-feedback-second-tab.png) |

### 3.4 Today's screens (`images/current/`)

[current-ra-prep](images/current/current-ra-prep.jpg) · [current-ra-recording](images/current/current-ra-recording.jpg) · [current-ra-recorded](images/current/current-ra-recorded.jpg) · [current-ra-results-offline-error](images/current/current-ra-results-offline-error.jpg) (scoring was offline during capture) · [current-rs](images/current/current-rs.jpg) · [current-di](images/current/current-di.jpg) (chart is a stand-in) · [current-rl](images/current/current-rl.jpg) · [current-asq](images/current/current-asq.jpg) · [current-sgd](images/current/current-sgd.jpg) · [current-rts](images/current/current-rts.jpg)

---

## 4. Design specification

### 4.1 Tokens

Use the variables already defined in `public/design-tokens.css`. Do not hard-code these hex values in new CSS except where marked "PTE area".

| Role | Token / value |
|---|---|
| Page background | `--bg-main` (`#f8f9fa`) |
| Surfaces | `--bg-surface` (`#fff`); secondary surface `#f8fafc`; tint `--gray-100` (`#f1f5f9`) |
| Text | `--text-primary` (`#1e293b`), `--text-secondary` (`#475569`), `--text-muted` (`#5d6b7f`) |
| Lines | `--border-default` (`#e2e8f0`), strong line `--gray-300` (`#cbd5e1`) |
| Primary action | `--blue-600` (`#2563eb`), hover `--blue-700`; tint `--blue-50`, `--blue-100`, `--blue-200` |
| Success / warning / danger | `--green-600/700/50/100`, `--gold-100/800` + amber `#d97706`, `--red-600/700/50/100` |
| Skill colours | Speaking `--skill-speaking` (blue) |
| Shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg` |
| Focus | `--focus-ring` (2px solid blue, offset 2px) |
| Fonts | UI: `--font-body` (Outfit). Mono labels: `--font-mono`. **PTE area only:** `Arial, Helvetica, sans-serif` |
| Radii | Card 20px · popover/dialog 16–18px · buttons 12px · pills 999px |
| Type scale | 12 / 13 / 15 / 16 / 18 / 24px from the tokens file |

**PTE area constants** (only inside the question area):

| Element | Value |
|---|---|
| Instruction | Arial 15px / 1.6, `#333`, weight 400 |
| Passage (RA), situation text (RTS) | Arial 17px / 2.15 (RA needs the line-height for linking arcs), `#222` |
| Audio box | 300px wide, `linear-gradient(#36699f, #28598f)`, border `1px solid #1c4675`, radius 2px, padding `14px 20px 16px`, shadow `0 1px 3px rgba(0,0,0,.25)`, text white Arial 14px; progress track 10px high `#a4bddb` with white fill; volume slider 120px |
| Recorder widget | see 4.4 |

### 4.2 Layout of a mode page (v3)

```
┌ global site header (unchanged) ──────────────────────────────────────────────┐
├ .pte-modebar  [‹] Read Aloud SPEAKING   (‹ #450 One of the great… ♪ ›)   [Filters][⋯][A1] ┤
│                                                                              │
│   ┌ .pte-card (max-width 940px; 1200px in Feedback) ───────────────────────┐ │
│   │ .pte-progress  ▬▬▬▬ Prepare   ──── Record   ──── Feedback             │ │
│   │ .pte-card__body  → the mode's question area (PTE styling)               │ │
│   │ .pte-dock  status text …………………  [helpers] [Primary] [Next →]         │ │
│   └─────────────────────────────────────────────────────────────────────────┘ │
│   .pte-attempts  Previous attempts (always visible)                           │
│                                                            (Coach drawer 360px, RA only)
└──────────────────────────────────────────────────────────────────────────────┘
```

- Page gutter: 24px desktop, 10–16px on phones. Card inner padding: `22px 34px 26px` (desktop), `18px 16px 22px` (≤600px).
- Card: `background var(--bg-surface); border 1px solid var(--border-default); border-radius 20px; box-shadow var(--shadow-md)`.
- Card width: `max-width 940px` in Prepare/Listen/Recording/Complete; `max-width 1200px` in Feedback (class `pte-card--wide`). The Previous attempts section uses the same max-width as the card above it.
- When the RA Coach drawer is open, the workspace becomes a 2-column grid `minmax(0,1fr) 360px`; below 980px the drawer stacks under the card.

### 4.3 Mode bar — `.pte-modebar`

Target: [ra-01](images/target/read-aloud/ra-01-prep-coach-closed.png) (top row), [ra-11](images/target/read-aloud/ra-11-filters-popover.png), [ra-12](images/target/read-aloud/ra-12-more-menu.png), [ra-13](images/target/read-aloud/ra-13-question-picker.png).

```html
<div class="pte-modebar" data-spc-mode="read-aloud">
  <div class="pte-modebar__left">
    <button class="pte-iconbtn" type="button" aria-label="Back to dashboard" data-pte-action="back">‹</button>
    <div class="pte-modebar__title"><b>Read Aloud</b><small>Speaking</small></div>
  </div>
  <div class="pte-modebar__center"><!-- existing .spc-picker-nav moved here (prev · pill · next) --></div>
  <div class="pte-modebar__right">
    <button class="pte-toolbtn" type="button" data-pte-menu="filters" aria-haspopup="dialog" aria-expanded="false">Filters <span class="pte-count" hidden>1</span></button>
    <button class="pte-iconbtn" type="button" data-pte-menu="more" aria-haspopup="menu" aria-expanded="false" aria-label="More options">⋯</button>
    <!-- existing #difficulty-badge moved here, restyled compact -->
  </div>
</div>
```

- Grid `minmax(0,1fr) auto minmax(0,1fr)`, padding `12px 24px`, white background, bottom border. ≤980px: single column, items left-aligned and wrapping.
- **Back** calls `window.exitCurrentMode()` (the handler on today's `#back-to-dashboard-btn`).
- **Title**: adapter `v3.title`; small label "Speaking" in `--blue-600`, 12px, uppercase, letter-spacing .06em.
- **Picker**: reuse the existing controller picker (`dom.pickerNav` from `buildControllerDOM()` + `buildPicker()` / `syncPickerSheet()`); restyle as the pill in the mockup (tint background, 34px round prev/next). The pill text is `#{id} {title}` plus `♪` when sample audio exists (RA). Popover content = today's v7 sheet (search + list + "1,449 questions · Random order" footer).
- **Filters**: shown only when the adapter declares `v3.filters` with at least one group (ASQ and RTS have none → hide the button). Popover lists groups as single-select pill options; badge shows the number of non-default groups; footer shows "{n} questions match" and a **Reset** link. The popover must drive today's filter logic, not a copy of it (see each mode's filter map in Appendix B).
- **More (⋯)**: menu items from `v3.moreItems` + two defaults: "Focus mode — Hide the page header while you practise" (today's ⛶ behaviour, `applyFocusWidth()` / `bel:speaking-controller:focus-width:v1`) and "How {Mode} works — Timing, scoring and tips" (today's `#mode-tutorial-btn` click). RS adds "Reset progress — Start this question set again" (`#reset-progress-speak-btn` click).
- **Level chip**: move the existing `#difficulty-badge` (contains `#diff-level-text`) into `.pte-modebar__right` while the v3 shell is mounted and put it back on unmount. Show only the CEFR code (e.g. "A1") with the full label in `title`.
- **Hidden while v3 is mounted**: the page header row `.main-header` (Practice title, `#back-to-dashboard-btn`, `#current-mode-indicator`, `#level-header-display`), the SPC primary row `.spc-row--primary`, the Advanced row `.spc-row--advanced`, `.spc-view-toggle` (Basic / Advanced / ⚙ Settings / ⛶), `.spc-order-toggle`. Restore them all on unmount.

### 4.4 Recorder widget — `.pte-rec` (new shared component)

Targets: [ra-rw-01](images/target/read-aloud/ra-rw-01-countdown.png), [ra-rw-02](images/target/read-aloud/ra-rw-02-recording.png), [ra-rw-03](images/target/read-aloud/ra-rw-03-complete.png); guideline [ref-05](images/reference/ref-05-recorder-guideline.png).

| State | DOM | Visual spec |
|---|---|---|
| `countdown` | `<span class="pte-rec__ring">34</span><span class="pte-rec__msg">The recording will begin in 34 seconds</span>` | Ring 44×44, `border 2px solid #7a7a7a`, white fill, number Arial 16px `#555` tabular-nums. Message Arial 14px `#6b6b6b`. Singular "1 second". |
| `recording` | `<span class="pte-rec__ring pte-rec__ring--rec"><i></i></span><span class="pte-rec__col"><small class="pte-rec__elapsed">00:02</small><span>Recording</span></span><span class="pte-rec__wave">64 × <i></i></span><span class="pte-rec__total">00:34</span>` | Ring border `2.5px solid #f26b6b`; inner dot 18px `#f04e4e`, pulse `scale(.82)` every 1.2s. Elapsed 12.5px `#8a8a8a`. Wave box 200×28 (max 40vw): 64 bars, gap 1px, idle bar 1px high `#c9ced6`, recorded bar `#4aa3df` with height from audio level (3–26px); the newest 4 bars animate `scaleY(.45→1.15)` alternate .45s. Total 13px `#8a8a8a`. |
| `complete` | `<span class="pte-rec__ring pte-rec__ring--done"><i></i></span><span>Complete</span><span class="pte-rec__line"></span>` | Ring border `2.5px solid #2eb82e`, dot 18px `#2eb82e`. Line 200×2 `#9aa0a8`. |

- Container: `display:inline-flex; align-items:center; gap:14px; min-height:48px;` centred in the card (`.pte-center`). In Describe Image it sits in the right column next to the image.
- Accessibility: `role="status"` on a visually hidden sibling that is updated **only on state change** ("Recording starts in 34 seconds", "Recording", "Recording complete"); the per-second number is `aria-hidden`. Respect `prefers-reduced-motion` (no pulse, no bar animation).
- The widget **never owns timers**. Modes call its methods from their existing timer ticks.

### 4.5 Audio box — `.pte-audio` (new shared component)

Targets: [repeat-sentence-01-listen](images/target/speaking/repeat-sentence-01-listen.png), [repeat-sentence-02-prepare](images/target/speaking/repeat-sentence-02-prepare.png).

```html
<div class="pte-audio" data-state="countdown|playing|completed">
  <div class="pte-audio__status">Status: <b>Beginning in 3 seconds</b></div>
  <div class="pte-audio__track"><i style="width:0%"></i></div>
  <label class="pte-audio__vol"><svg …speaker…/><input type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume"></label>
</div>
```

- Status copy: "Beginning in {n} seconds" → "Playing" → "Completed". Track fill = `audio.currentTime / audio.duration`. Volume binds to `audio.volume`.
- No Play button and no seeking (test behaviour). Replays happen only through mode helpers (RS "Replay · n", ASQ "Replay question").
- The mode's existing `<audio>` element and its `.practice-audio-player` section stay in the DOM with the `hidden` attribute, so existing listeners and `PracticeAudioPlayer.attach()` wiring keep working.

### 4.6 Next rules and dialogs

Translated notes from [ref-05](images/reference/ref-05-recorder-guideline.png): *"When the 40 s countdown reaches 0 the screen switches to recording. After the recording time it switches to Complete. While counting down to start recording you cannot press Next; Next shows a 'Cannot Skip' dialog. While recording or after Complete, Next shows the confirmation dialog."*

| Phase | Next → does |
|---|---|
| `prep` (recorder countdown running) | Opens **Cannot skip** dialog |
| `listen` (audio countdown or playing) | Opens **Go to the next question?** with the listen body |
| `recording` | Opens **Go to the next question?** with the recording body; on Yes: discard nothing — stop capture, save attempt without feedback |
| `complete` | Opens **Go to the next question?** with the complete body |
| `feedback` | Moves on directly (primary "Next question →") |

Dialog copy and markup: see Appendix A. Targets: [ra-14](images/target/read-aloud/ra-14-dialog-cannot-skip.png), [ra-15](images/target/read-aloud/ra-15-dialog-confirm-next.png). Dialog: fixed overlay `rgba(15,23,42,.38)` + `backdrop-filter: blur(2px)`; panel 400px, radius 18px, padding `22px 22px 18px`, `role="alertdialog"`, focus trapped (reuse the controller's internal `trapFocus()` / `lockScroll()`), Escape closes, focus returns to Next. Timers keep running while a dialog is open (the test does not pause).

### 4.7 Action dock — `.pte-dock`

Targets: bottom row of every target screenshot; RA Coach placement [ra-01](images/target/read-aloud/ra-01-prep-coach-closed.png); RS helpers [repeat-sentence-02](images/target/speaking/repeat-sentence-02-prepare.png).

```html
<div class="pte-dock">
  <div class="pte-dock__status" aria-live="polite">Recording starts automatically when the countdown ends.</div>
  <div class="pte-dock__actions">
    <!-- helpers (hidden in 'recording') -->
    <!-- adopted mode buttons, one of them .pte-btn--primary -->
    <button class="pte-btn pte-btn--ghost" type="button" id="pte-next-read-aloud">Next →</button>
  </div>
</div>
```

- Layout: flex, space-between, wrap; `padding 16px 26px`; top border; `position: sticky; bottom: 0` inside the card; radius `0 0 20px 20px`. `.pte-dock__actions` has `margin-left:auto; justify-content:flex-end` so wrapped buttons stay right-aligned.
- Buttons: height 44px, radius 12px, 15px/600 Outfit, padding `0 20px`.
  - `.pte-btn--primary`: `--blue-600` background, white text, shadow `0 1px 2px rgba(37,99,235,.25), 0 4px 12px -4px rgba(37,99,235,.45)`.
  - `.pte-btn` (secondary): white, `1px solid #cbd5e1`.
  - `.pte-btn--ghost`: transparent border and background, `--text-secondary`.
  - `.pte-btn--stop` (Finish recording): `#1e293b` background, white text, 10×10 red square (`#ff5a4f`, radius 2px) before the label.
  - `.pte-btn--helper`: secondary style, weight 500, optional count chip (20px pill, tint background; blue when pressed) and coin chip (`--gold-100` / `--gold-800`, "5c").
- **Exactly one primary per phase.** In Feedback, "Next question →" is the primary and "Next →" is not shown.
- Phase visibility is driven by `data-pte-phases="prep complete feedback"` on each dock control; the shell toggles `hidden` on phase change. Per-mode matrices are in Appendix D.
- Status text per phase: Appendix A.

### 4.8 Two-column Feedback — `.pte-fb`

Targets: [ra-06](images/target/read-aloud/ra-06-feedback-results-tab.png), [repeat-sentence-05](images/target/speaking/repeat-sentence-05-feedback.png), [describe-image-05](images/target/speaking/describe-image-05-feedback.png), [summarize-group-discussion-05](images/target/speaking/summarize-group-discussion-05-feedback.png), [respond-to-situation-05](images/target/speaking/respond-to-situation-05-feedback.png).

```html
<p class="pte-instr">…instruction…</p>
<div class="pte-fb">
  <div class="pte-fb__left"><!-- what you said: recorder Complete, transcript/passage, legend, listen-back --></div>
  <div class="pte-fb__right">
    <div class="pte-tabs" role="tablist"><button role="tab" aria-selected="true">Your results</button><button role="tab">Coach tips · 4</button></div>
    <div class="pte-tabpanel" role="tabpanel"><!-- stats row, practise list, advanced link --></div>
  </div>
</div>
```

- Grid `minmax(0,1.08fr) minmax(0,1fr)`, column gap 30px; right column has `border-left 1px solid var(--border-default); padding-left 28px`. ≤980px: one column, right column gets a top border instead.
- **Stats row** `.pte-stats`: 4 tiles in one row inside a 16px-radius outlined box; label 11.5px uppercase muted; value 24px/600 with a 16px muted unit; 5px progress bar under it (`--blue-600`). The first tile has a `--blue-50` background.
- **Practise list** `.pte-fixes`: rows `24px icon | text | actions`, 8px vertical padding, icon circles 22px (red `!`, amber `?`, green `✓`), small pill buttons "▶ You" / "▶ Model" (12.5px).
- **Listen-back row** `.pte-listen`: segmented "Your recording | Sample" (or mode-specific sources) + mini player pill (30px round play button, 120px track, `m:ss / m:ss`).
- **Height budget:** at 1440×900 the card in Feedback must be ≤ 740px tall (mockups measure 402–694px). Only the optional "Show advanced analysis" expansion may exceed it.

### 4.9 Previous attempts — `.pte-attempts` (new shared component)

Target: [ra-10](images/target/read-aloud/ra-10-previous-attempts-section.png).

- Section after the card: header "Previous attempts" + trend chip (green, e.g. "+18 since your first try") + segmented "This question · {n} | All {Mode name}".
- List in one outlined 16px-radius box; each row: `when` (bold, "Just now" / "Yesterday" / "18 Sep 2026") + sub-line time; score chips (mode formatter); duration `m:ss`; actions "▶ Play" and "Open feedback".
- The newest row gets class `is-new`, a `--blue-50` background and a "New" tag when it was created in this page session.
- Note under the list: "Your recordings and scores for this question are kept here after every attempt."
- Empty states: signed out → "Sign in to keep your attempts. Attempts from this session stay here until you leave the page."; signed in with none → "No attempts for this question yet."

### 4.10 Read Aloud Coach drawer and word popover

Targets: [ra-02](images/target/read-aloud/ra-02-prep-coach-open-word-popover.png), [ra-08](images/target/read-aloud/ra-08-feedback-coach-tab.png).

- Drawer: today's `#ra-connected-speech-box` (`.ra-rail`) restyled as a 360px right column with header "Speech Coach" / "Tap a hint or a marked word", a close (✕) button, guide chips row, hint list, footer "Speech Coach reviews only the guides that are on when you record."
- Guide chips = today's `#ra-prompt-guides-group` toggles (`#ra-toggle-chunking-btn`, `#ra-toggle-linking-btn`, `#ra-toggle-reduced-words-btn`, `#ra-toggle-sound-changes-btn`) restyled as pills with counts; chips with a count of 0 are disabled.
- Word popover: clicking a marked word (reduced word, linking, sound change) opens a 290px popover under the word: word + type chip, "Say it like **{say}**", explanation, IPA line (Roboto Mono 13px), "▶ Listen" (existing model audio via `playSpeechCoachModelAudio()` / `speakGuidePhrase()`), "Close". Build it on today's sound-change tooltip machinery (`showSoundChangeTooltip()`, `handleGuideTargetInteraction()`, `positionSoundChangeTooltip()`), extended to all guide types.
- Default: **closed**. Persist the learner's choice in `localStorage['bel:ra:coach-open:v1']` (`'1'`/`'0'`), wrapped in try/catch.

---

## 5. Architecture

### 5.1 Feature flag — new `public/js/pte-shell-config.js`

Mirror `public/js/read-aloud-workspace-config.js`.

```js
(function () {
  'use strict';
  // Off until the product owner approves rollout (see Phase 9).
  const RELEASE_DEFAULT = false;
  // Modes that may use v3 when the flag is on. Add one mode per phase.
  const ENABLED_MODES = ['read-aloud', 'speak', 'describe-image', 'asq', 'rts', 'sgd', 'notes'];

  let requested = null;
  try { requested = new URL(window.location.href).searchParams.get('pteShell'); } catch (_) {}
  if (!requested) { try { requested = localStorage.getItem('bel:pte-shell'); } catch (_) {} }

  const enabled = requested === 'v3' || (requested !== 'legacy' && RELEASE_DEFAULT);

  window.PteShellConfig = Object.freeze({
    enabled: Boolean(enabled),
    requested,
    isModeEnabled(modeId, scope) {
      return Boolean(enabled) && (scope || 'pte') === 'pte' && ENABLED_MODES.includes(modeId);
    }
  });
})();
```

Load it in `public/index.html` directly before `speaking-practice-controller.js` (line ~6075 today), with the same cache-busting pattern: `?v=20260919_pte_v3`. English scope and Write from Dictation (`type`, also registered with the controller) **stay on the legacy shell**.

### 5.2 New and modified files

| File | Action | Purpose |
|---|---|---|
| `public/js/pte-shell-config.js` | create | Feature flag (5.1) |
| `public/js/pte-recorder-widget.js` | create | `window.PteRecorderWidget` (5.4) |
| `public/js/pte-audio-box.js` | create | `window.PteAudioBox` (5.5) |
| `public/js/pte-attempt-history-section.js` | create | `window.PteAttemptHistory` (5.6) |
| `public/css/pte-speaking-shell.css` | create | Mode bar, card, progress, dock, buttons, dialogs, popovers, feedback grid, stats, practise list, attempts, drawer (all `.pte-*`) |
| `public/css/pte-question-area.css` | create | PTE area typography + audio box + recorder widget |
| `public/js/speaking-practice-controller.js` | modify | v3 branch in `activate()` / `unmount()`; new internal builders; new public methods (5.3) |
| `public/js/speaking-practice-adapters.js` | modify | `shell:'v3'` + `v3:{…}` block for the 7 modes (5.3, Phases 2–8) |
| `public/js/pte-attempt-archive.js` | modify | Dispatch `pte-attempt-archive:saved` after a successful save (5.6) |
| `public/read-aloud-mode.js`, `public/js/read-aloud-workspace-view.js` | modify | Phase 2 |
| `public/script.js` (Repeat Sentence block) | modify | Phase 3 |
| `public/describe-image-mode.js`, `public/asq-mode.js`, `public/rts-mode.js`, `public/sgd-mode.js`, `public/take-notes-mode.js` | modify | Phases 4–8 |
| `public/index.html` | modify | Includes; wrapper IDs `speak-practice-area`, `asq-practice-area`; hidden legacy audio sections stay |
| `public/sw.js` | modify if it precaches assets | Add new files to the precache list if one exists (check before editing) |
| `tests/browser/pte-speaking-shell-browser-check.js` | create | Cross-mode v3 check (Phase 9) |
| `tests/browser/pte-read-aloud-v3-browser-check.js` etc. | create | One per mode (Phases 2–8) |
| `tests/pte-shell-next-rules.test.mjs`, `tests/pte-recorder-widget.test.mjs` | create | Node unit tests for pure logic |

### 5.3 Speaking Practice Controller changes

Keep the public API and the legacy path byte-for-byte in behaviour when v3 is off.

**Adapter opt-in:**

```js
controller.register({
  modeId: 'read-aloud',
  // …existing fields stay (picker, controls, getStepIndex …) and keep powering legacy…
  shell: 'v3',
  v3: {
    title: 'Read Aloud',
    skillLabel: 'Speaking',
    cardBodySelector: '#mode-read-aloud .ra-workbench',   // node that becomes .pte-card__body
    progressSteps: ['Prepare', 'Record', 'Feedback'],
    getPhase: () => /* 'loading'|'listen'|'prep'|'recording'|'complete'|'feedback' */,
    phaseToStep: { listen: 0, prep: 0, recording: 1, complete: 1, feedback: 2 },
    statusText: { /* Appendix A */ },
    filters: [ /* Appendix B */ ],
    moreItems: [ /* { id, label, description, onSelect } */ ],
    dock: {
      helpers: [ /* { id, label, icon, count(), pressed(), onClick(), phases:[…] } */ ],
      actions: [ /* { sourceId, phases:[…], variant:'primary'|'secondary'|'ghost'|'stop', label } */ ]
    },
    next: {
      goNext: () => window.ReadAloudMode?.loadNextPrompt?.(),
      onConfirmFromRecording: () => { /* mode-specific: stop + save without feedback */ }
    },
    attempts: {
      practiceMode: 'read-aloud',
      modeLabel: 'Read Aloud',
      getPromptId: () => /* current prompt id */,
      formatScores: (attempt) => [ /* strings for chips */ ],
      formatTrend: (attempts) => '+18 since your first try'
    },
    feedback: { maxWidth: 1200 }
  }
});
```

**Controller internals to add** (new functions inside `speaking-practice-controller.js`):

| Function | Responsibility |
|---|---|
| `isV3(config, scope)` | `config.shell === 'v3' && window.PteShellConfig?.isModeEnabled(config.modeId, scope)` |
| `buildV3Shell(config, state)` | Build `.pte-modebar`, wrap `cardBodySelector` in `.pte-card` with `.pte-progress` + `.pte-dock`, insert `.pte-attempts` host after the card; move `dom.pickerNav` into the mode bar; move `#difficulty-badge`; hide legacy rows (4.3). Record every moved node with a comment anchor, exactly like `adoptControls()` does, so `unmount()` can restore. |
| `adoptV3Dock(config, state)` | For each `v3.dock.actions[i]`: move `#sourceId` into `.pte-dock__actions`, set `data-pte-phases`, add `pte-btn` + variant class, set label if given (store original text for restore). Build helper buttons from `v3.dock.helpers`. Create `#pte-next-{modeId}`. |
| `setPhase(modeId, phase)` | Public. Stores the phase, toggles `hidden` on dock controls by `data-pte-phases`, updates `.pte-dock__status`, `.pte-progress` (done/now classes), `pte-card--wide` in `feedback`. Called by modes (and by `syncController()` via `v3.getPhase()`). |
| `openV3Dialog(kind, state)` | Builds Appendix A dialogs; `kind ∈ {'noskip','confirm'}`. Returns a Promise<boolean>. |
| `handleV3Next(state)` | Implements 4.6 using the current phase. |
| `openV3Menu(kind, state)` | Filters / More / picker popovers (reuse `syncPickerSheet()` for the picker list). Close on outside click and Escape; `aria-expanded` on the trigger. |
| `unmountV3(state)` | Restore every moved node, labels, classes and hidden legacy rows. |

`activate()` → if `isV3(config, scope)`: call `buildV3Shell()`, `buildPicker()`, `adoptV3Dock()`, `PteAttemptHistory.mount(…)`, skip `wireViewToggle()`/`applyView()` and the Settings sheet, set `document.body.classList.add('pte-shell-v3')`. `unmount()` → if the state was v3: `unmountV3()`, remove the body class.

`syncController(modeId)` → when v3: `setPhase(modeId, config.v3.getPhase())` in addition to the existing picker sync.

### 5.4 `window.PteRecorderWidget`

```js
/**
 * @param {HTMLElement} host   element the widget renders into (replaces its children)
 * @param {{ totalSeconds:number }} options
 */
const rec = PteRecorderWidget.create(host, { totalSeconds: 34 });
rec.showCountdown(34);          // state 'countdown'
rec.tick(33);                   // updates the number + message, no re-render of the whole node
rec.showRecording(34);          // state 'recording', elapsed 00:00, total 00:34
rec.attachStream(mediaStream);  // AnalyserNode (fftSize 256) → pushes one bar per 1/(64/total) s from RMS; optional
rec.setElapsed(12);             // elapsed text + fills bars proportionally when no stream is attached
rec.showComplete();             // state 'complete'
rec.destroy();                  // disconnect analyser, clear host
```

- Pure helpers exported for unit tests via `module.exports` guard (like `read-aloud-workspace-config.js`): `formatClock(sec) → '00:12'`, `countdownMessage(n) → 'The recording will begin in 1 second'`, `barsOn(elapsed,total,count=64)`.
- Waveform from the stream: create an `AudioContext` + `MediaStreamAudioSourceNode` → `AnalyserNode`; every animation frame compute RMS of `getByteTimeDomainData`, map to 3–26px, append to the bar at index `barsOn(elapsed,total)`. Close the context in `destroy()`. If `AudioContext` fails, fall back to `setElapsed()` drawing a seeded pattern.

### 5.5 `window.PteAudioBox`

```js
const box = PteAudioBox.create(host, { audio: HTMLAudioElement });
await box.countdown(3);   // "Beginning in 3/2/1 seconds"; resolves at 0 (rejects if destroyed)
await box.play();         // starts audio, "Playing", progress follows timeupdate; resolves on 'ended'
box.setCompleted();       // "Completed", track 100%
box.replay();             // restart from 0 (used by helpers)
box.reset();              // back to countdown-ready state, 0%
box.destroy();
```

- Must not create its own `<audio>`; always use the mode's element.
- `play()` must handle autoplay rejection: if `audio.play()` rejects (no user gesture), show "Status: **Click to start audio**" and make the box focusable/clickable once (`role="button"`, Enter/Space). This is the only interactive state of the box.

### 5.6 `window.PteAttemptHistory` + archive event

- In `public/js/pte-attempt-archive.js`, after a successful `saveAttempt()` / `saveTextAttempt()` / `saveStateAttempt()` resolution, dispatch:
  ```js
  window.dispatchEvent(new CustomEvent('pte-attempt-archive:saved', {
    detail: { attemptId, practiceMode, promptId }
  }));
  ```
  and call `invalidateHistoryCache()` first.
- `PteAttemptHistory.mount(hostEl, { practiceMode, modeLabel, getPromptId, formatScores, formatTrend })`:
  - Data: `await PTEAttemptArchive.fetchUserAttemptsCached()` (returns `null` when nobody is signed in, otherwise an array of at most 50 PTE attempts; see `public/js/pte-attempt-archive.js` ~1637). On `null` use the in-memory session list (the component keeps every `pte-attempt-archive:saved` and every guest-mode completion the mode reports via `PteAttemptHistory.recordLocal(summary)`).
  - Filter: `a.practiceMode === practiceMode` (keys used today: `read-aloud`, `speak`, `describe-image`, `notes`, `asq`, `sgd`, `rts`). "This question" additionally matches `a.promptId === getPromptId()`; if `promptId` is missing on older rows, fall back to `a.promptSnapshot?.id`.
  - Fields available from `GET /api/practice-attempts` (see `summarizeAttemptForList()` in `functions/src/routes/practice-attempts.js`): `attemptId, practiceMode, modeLabel, createdAt, submittedAt, audio.studentUrl, audio.durationMs, score, promptId, responseSummary`. The endpoint returns the latest 50 attempts for the user across modes. **No backend change in this plan**; if product later wants more than 50, add `practiceMode`/`promptId` query params and a Firestore composite index in a separate task.
  - "Open feedback" dispatches the existing `pte-attempt-archive:open` event with `{ attemptId }` (opens today's review modal).
  - Read `updateHistoryUI(mode, questionId)` (~1659) before writing the filter: it is today's per-question history renderer used by Read Aloud (`read-aloud-mode.js` ~1973) and already resolves the question id per mode (`resolveHistoryQuestionId`). Reuse its id resolution instead of re-deriving it.
  - "▶ Play" plays `audio.studentUrl` in a single shared `<audio>` owned by the component (stop any previous one).
  - Re-render on `pte-attempt-archive:saved` and when the picker changes question.

---

## Phase 0 — setup

| ID | Task | Details | Done when |
|---|---|---|---|
| 0.1 | Branch | `git switch main && git pull --ff-only && git switch -c feat/pte-speaking-shell-v3`. The design branch `feat/projects-subtasks-people` is unrelated. | Branch exists |
| 0.2 | Task contract | Write the external contract (task ID, owner, every path in 5.2, evidence folder outside Git), then the before snapshot (`node scripts/structure/check.cjs snapshot …`). | Contract + snapshot files exist outside the repo |
| 0.3 | Tracker | Append one row per phase you start, status `In Progress`. | Rows added |
| 0.4 | Baseline evidence | Run the existing checks with the flag **off** and keep the output: `node tests/browser/speaking-controller-browser-check.js`, `node tests/browser/speaking-shell-cross-mode-check.js`, `node tests/browser/read-aloud-workspace-browser-check.js`, `node tests/browser/practice-modes-ui-full-audit.js --modes read-aloud,speak,describe-image,notes,asq,sgd,rts --viewport desktop`. | Baseline stored |
| 0.5 | Test harness helper | In your new tests, open the app the same way `tests/browser/practice-modes-ui-full-audit.js` does (express static server on `public/`, `initScript()` with guest mode + stub `MediaRecorder` + `getUserMedia`, `dismissOverlays()`), then navigate with `?pteShell=v3` and call `window.switchToMode(modeId)`. Factor the shared bits into `tests/browser/helpers/pte-shell-harness.js`. | Helper exported and used by one smoke test |

---

## Phase 1 — shared shell and components

| ID | Task | Files | Steps | Acceptance |
|---|---|---|---|---|
| 1.1 | Flag | `public/js/pte-shell-config.js`, `public/index.html` | Create per 5.1; include before the controller. | `window.PteShellConfig.enabled` is `true` with `?pteShell=v3`, `false` by default and with `?pteShell=legacy`. |
| 1.2 | Stylesheets | `public/css/pte-speaking-shell.css`, `public/css/pte-question-area.css`, `public/index.html` | Port the mockup CSS: from `mockups/read-aloud.html` sections "mode bar", "workspace", "action dock", "feedback section", "coach drawer", "popovers", "annotations" (**skip annotations**) and from `mockups/speaking-modes.html` "speaking set additions". Rename to the `.pte-*` classes in section 4. Use tokens (4.1). Link both files after `speaking-practice-controller.css` (line ~47). | Stylesheets load; no selector leaks outside `.pte-*` or `body.pte-shell-v3` (grep your diff). |
| 1.3 | Recorder widget | `public/js/pte-recorder-widget.js`, `tests/pte-recorder-widget.test.mjs` | Implement 5.4. Unit-test `formatClock`, `countdownMessage` (singular/plural), `barsOn` (0, mid, total). | `node --test tests/pte-recorder-widget.test.mjs` passes; a scratch page renders the three states identical to [ra-rw-01..03](images/target/read-aloud/). |
| 1.4 | Audio box | `public/js/pte-audio-box.js` | Implement 5.5 including the autoplay-rejection state. | Countdown → Playing → Completed with a real clip; progress and volume work. |
| 1.5 | Controller v3 shell | `public/js/speaking-practice-controller.js` | Implement 5.3: `isV3`, `buildV3Shell`, `adoptV3Dock`, `setPhase`, `openV3Menu`, `openV3Dialog`, `handleV3Next`, `unmountV3`; expose `setPhase`, `getPhase`, `openDialog` on `window.SpeakingPracticeController`. Legacy path unchanged. | With a **test-only adapter** (`testOnly: true`, like the Wave 0 synthetic adapter) the shell mounts/unmounts cleanly 10× without leaking nodes (count `.pte-modebar` = 1, legacy rows restored after unmount). |
| 1.6 | Next rules | same + `tests/pte-shell-next-rules.test.mjs` | Put the phase→action decision in a pure function `resolveNextAction(phase) → 'noskip'|'confirm'|'direct'` exported for tests. | Unit test covers all 6 phases (`loading` → `'direct'` disabled button). |
| 1.7 | Attempts section | `public/js/pte-attempt-history-section.js`, `public/js/pte-attempt-archive.js` | Implement 5.6 and the `saved` event. | Guest: empty state + session rows; signed in (Playwright with credentials file): rows for the current question; "Open feedback" opens today's review modal. |
| 1.8 | Menus | controller | Filters popover (driven by adapter `filters[].get/set`), More menu, picker popover — per 4.3 and [ra-11..13](images/target/read-aloud/). | Keyboard: Tab reaches every item; Escape closes and returns focus; outside click closes. |

---

## Phase 2 — Read Aloud

Mode code: `public/read-aloud-mode.js` (class `ReadAloudMode`, global `window.ReadAloudMode`), `public/js/read-aloud-workspace-view.js` (`window.ReadAloudWorkspaceView`), model `public/js/read-aloud-workspace-model.js`, markup `public/index.html` lines ~5094–5400 (`#mode-read-aloud`).

**Targets:** [ra-01](images/target/read-aloud/ra-01-prep-coach-closed.png) … [ra-19](images/target/read-aloud/ra-19-mobile-feedback.png). Annotated: [ra-16](images/target/read-aloud/ra-16-annotated-prep.png), [ra-17](images/target/read-aloud/ra-17-annotated-feedback.png).

### 2.1 Phase mapping

`v3.getPhase` for Read Aloud (states from `this.state`):

| `ReadAloudMode.state` | Phase |
|---|---|
| `IDLE` (prompt loading) | `loading` |
| `PREP` | `prep` |
| `REQUESTING_MIC`, `RECORDING`, `STOPPING_RECORDING` | `recording` |
| `RECORDED` | `complete` |
| `RESULTS` (includes analysing, assessment error, result unavailable) | `feedback` |

Call `SpeakingPracticeController.setPhase('read-aloud', phase)` at the end of `updateUIForState()` (line ~3644) when v3 is active (`window.PteShellConfig?.isModeEnabled('read-aloud','pte')`).

### 2.2 Tasks

| ID | Task | Exact changes | Target |
|---|---|---|---|
| 2.1 | Adapter | In `speaking-practice-adapters.js` Read Aloud registration (line ~372): add `shell:'v3'` and the `v3` block: `title:'Read Aloud'`, `cardBodySelector:'#mode-read-aloud .ra-workbench'`, `progressSteps:['Prepare','Record','Feedback']`, `getPhase` (2.1 table), `filters` (Appendix B.1), `moreItems:[]`, dock (Appendix D.1), `next.goNext: () => ReadAloudMode.loadNextPrompt()`, attempts (`practiceMode:'read-aloud'`, `getPromptId: () => ReadAloudMode.currentQuestionId`, `formatScores: a => ['Overall ' + a.score?.pronScore + '%', 'Accuracy ' + a.score?.accuracyScore + '%', 'Fluency ' + a.score?.fluencyScore + '%']` — **verify the score field names** by logging one saved attempt from `processAzureResults()` line ~4585 before relying on them). | [ra-16](images/target/read-aloud/ra-16-annotated-prep.png) |
| 2.2 | Hide duplicated UI under v3 | In `ReadAloudWorkspaceView.ensureLayoutHosts()`: when v3 is active, do not create/show `#ra-workspace-heading`, `#ra-workspace-steps-host`, `#ra-workspace-coach-host` (tips box). Keep `#ra-workspace-instruction` in the DOM but visually hidden (`.pte-sr-only`) for screen-reader stage announcements. `#ra-status-message` → visually hidden too. | [ra-01](images/target/read-aloud/ra-01-prep-coach-closed.png) |
| 2.3 | PTE instruction | Insert `<p class="pte-instr" id="ra-pte-instruction">` as the first child of `.ra-stage`. Text: `Look at the text below. In ${this.prepSeconds} seconds, you must read this text aloud as naturally and clearly as possible. You have ${this.recordSeconds} seconds to read aloud.` Update it in `applyPromptRow()` right after lines ~1952–1953 where `prepSeconds`/`recordSeconds` are computed (prep = 40 if ≥ 60 words, else clamp(round(words/1.5), 30, 35); record = min(prep, 40)). | [ra-01](images/target/read-aloud/ra-01-prep-coach-closed.png) |
| 2.4 | Passage styling | Add class `pte-passage` to `#ra-prompt-stage`: no card border/background/padding; `#ra-text-prompt` Arial 17px / 2.15. After the class change call the existing linking re-layout (the SVG `#ra-linking-overlay` is positioned from word boxes; trigger `this.renderPromptForCurrentView()` or dispatch `resize`). | [ra-01](images/target/read-aloud/ra-01-prep-coach-closed.png) |
| 2.5 | Recorder widget | Create host `<div class="pte-center"><div id="ra-pte-recorder"></div></div>` between the instruction and `#ra-prompt-stage`. Create `this.pteRecorder = PteRecorderWidget.create(host,{totalSeconds:this.recordSeconds})` in `onEnter()`. `startPrepTimer()` (~3897): `showCountdown(this.prepSeconds)` then `tick(timeLeft)` on each tick. `startRecording()` (~3938): `showRecording(this.recordSeconds)`, `attachStream(stream)` once the stream exists, `setElapsed()` each tick. `RECORDED`/`RESULTS`: `showComplete()`. Hide `#ra-prep-timer-box` and `#ra-record-timer-box` under v3 (remove them from the adapter's v3 dock actions). | [ra-rw-01..03](images/target/read-aloud/) |
| 2.6 | Dock | Dock per Appendix D.1: helper **Coach** (`id:'ra-pte-coach-btn'`, icon lightbulb, count = number of hint groups = `ReadAloudMode` prompt guide count used today for "N pronunciation hints in this prompt"), `#ra-record-btn` "Start recording" (primary, `prep`), `#ra-stop-btn` "Finish recording" (stop, `recording`), a new "Cancel" ghost button (`recording`, see 2.7), `#ra-retry-btn` "Record again" (ghost, `complete`) / "Try again" (ghost, `feedback`), `#ra-play-recording-btn` "Play" (secondary, `complete`), `#ra-check-btn` "Get feedback" (primary, `complete`), shell **Next →** (`listen/prep/recording/complete`), and in `feedback` the shell renders "Next question →" (primary) wired to `next.goNext`. Remove the legacy purple `#ra-next-btn` from view under v3 (hidden, not deleted). | [ra-01](images/target/read-aloud/ra-01-prep-coach-closed.png), [ra-03](images/target/read-aloud/ra-03-recording.png), [ra-05](images/target/read-aloud/ra-05-complete.png), [ra-06](images/target/read-aloud/ra-06-feedback-results-tab.png) |
| 2.7 | Cancel while recording | New method `cancelRecording()` on `ReadAloudMode`: `this.invalidateRecordingSession()` (line ~2785 sets `disposition = 'discard'`), stop `mediaRecorder` and stream as `stopRecordingManually()` does, then `this.retryCurrentPrompt()` (line ~3005, returns to `PREP` and restarts the countdown). | [ra-03](images/target/read-aloud/ra-03-recording.png) |
| 2.8 | Coach drawer | Coach button toggles `#ra-connected-speech-box` as the right drawer (4.10) via a new `setCoachOpen(open)` that wraps today's `toggleSpeechCoachVisibility()` (line ~4731) and persists `bel:ra:coach-open:v1`. Move `#ra-prompt-guides-group` into the drawer header as chips. Coach button + drawer are **hidden in `recording`** and restored after. Passage guide marks stay if Coach was on (reading aid; open decision O-6). | [ra-02](images/target/read-aloud/ra-02-prep-coach-open-word-popover.png), [ra-04](images/target/read-aloud/ra-04-complete-coach-open.png) |
| 2.9 | Word popover | Extend `showSoundChangeTooltip()` / `handleGuideTargetInteraction()` so reduced-word and linking targets also open the popover (4.10). Close on Escape, outside click, and phase change. | [ra-02](images/target/read-aloud/ra-02-prep-coach-open-word-popover.png) |
| 2.10 | Filters | Map Appendix B.1 groups to today's controls: Sample audio → `setSampleAudioFilter('all'|'available'|'unavailable')` (buttons `#ra-filter-all/-available/-unavailable`); Prompt feature → `setPromptFeatureFilter(...)` (`#ra-filter-feature-all`, `#ra-filter-any-connected`, `#ra-filter-linking`, `#ra-filter-reduced-words`, `#ra-filter-sound-changes`); Difficulty → today's difficulty buttons in the Practice Target drawer; Order → `ReadAloudMode.setPromptOrderMode('random'|'sequential')`. Count uses `refreshFilterControls()` state. Do **not** build the ⚙ Settings sheet under v3 (skip `ReadAloudMode.initSettingsSheet()` call in `activate()`). | [ra-11](images/target/read-aloud/ra-11-filters-popover.png) |
| 2.11 | Feedback layout | In `RESULTS`, render `.pte-fb` inside the card body: **left** = instruction, recorder (Complete), the scored transcript from `renderRecognizedTranscript()` (the `.ra-merged-transcript-shell` from `#ra-transcript-feedback`) **in place of** `#ra-prompt-stage` (hide the prompt stage in `RESULTS`), the legend (Good / Unclear / Needs practice / Speech Coach checked + "Click a word to hear yourself say it."), then the listen-back row: move `#ra-audio-source-tabs` (`#ra-source-tab-yours` / `#ra-source-tab-sample`) + `#ra-player-section` (custom player) into `.pte-listen`, restyled as the mini player; when Sample is selected show the voice row (`#ra-voice-male`, `#ra-voice-female`, `#ra-speed-100`, `#ra-speed-80`, `#ra-voice-picker-btn` + `#ra-voice-dropdown-toggle`). **Right** = tabs "Your results" / "Coach tips · N". Your results: `.pte-stats` from `payload.accuracyScore`, `fluencyScore`, `completenessScore`, `pronScore` (today shown by `#ra-accuracy-readout` and `.ra-transcript-metrics` — hide those two under v3); "What to practise next" list built from (a) words with `accuracyScore < 60` (red `!`), (b) Speech Coach events with status uncertain/not detected (amber `?`), (c) up to one success (green `✓`), max 4 rows, each with "▶ You" (`playRecordedWordSegment(startMs,endMs)`) and "▶ Model" (`playSpeechCoachModelAudio()`); link "Show advanced analysis ›" = `#ra-show-advanced-btn` restyled as a link (`toggleAdvancedAnalysisView()`). Coach tab = the Speech Coach result sections (`renderConnectedSpeechResults()` output). Dock Coach button in `feedback` switches the right column to the Coach tab. | [ra-06](images/target/read-aloud/ra-06-feedback-results-tab.png) … [ra-09](images/target/read-aloud/ra-09-feedback-advanced-analysis.png) |
| 2.12 | Previous attempts | Mount `PteAttemptHistory` below the card with the adapter's `attempts` config. Remove the History tab usage under v3 (`#ra-history-action-host`, `#ra-history-content-host` stay in DOM, not shown). | [ra-10](images/target/read-aloud/ra-10-previous-attempts-section.png) |
| 2.13 | Next rules | Shell Next uses 4.6. From `recording` → Yes: call `stopRecordingManually()` and let the existing save path store the attempt **without** triggering assessment (set a flag `this.skipAssessmentOnce = true` that `handleCheckResult()` respects), then `loadNextPrompt()`. From `complete` → Yes: `loadNextPrompt({ force: true })` (`force` bypasses `confirmDiscardAttempt()`, line ~1849, because the attempt is already saved). | [ra-14](images/target/read-aloud/ra-14-dialog-cannot-skip.png), [ra-15](images/target/read-aloud/ra-15-dialog-confirm-next.png) |
| 2.14 | Tests | Create `tests/browser/pte-read-aloud-v3-browser-check.js` (assertions in Phase 9 list). Re-run with flag off: `read-aloud-workspace-browser-check.js`, `read-aloud-lifecycle-browser-check.js`, `read-aloud-record-cycle-check.js`, `read-aloud-coach-results-check.js`, `read-aloud-results-linking-overlay-check.js`, `read-aloud-question-picker-v7-dom-contract-browser-check.js`, `ra-guide-toggle-check.js`, `spc-settings-sheet-verify.js`. | All pass |

---

## Phases 3–8 — the other Speaking modes

Shared rules for all six:

- Audio modes (RS, RL, ASQ, SGD, RTS) run: **audio countdown → audio plays (PteAudioBox) → recorder appears (PteRecorderWidget countdown) → recording → Complete → Feedback**. The recorder host is created empty and only filled when the audio ends ([ref-03](images/reference/ref-03-audio-box-then-recorder.png)). Use a 350 ms fade-in (`opacity 0→1, translateY 6px→0`), none under reduced motion.
- Question starts automatically when a question is loaded (no "Start", "Start Practice", "Start Lecture", "Play" gate). If the browser blocks autoplay, the audio box shows "Click to start audio" (5.5).
- Every mode keeps its own timers and state machine. The shell only receives `setPhase()` calls.
- The helper buttons are hidden during `recording`.
- Filters per mode: Appendix B. Dock per mode: Appendix D. Copy: Appendix A.

### Phase 3 — Repeat Sentence (`speak`, code in `public/script.js`)

Targets: [repeat-sentence-00..06](images/target/speaking/). Today: [current-rs](images/current/current-rs.jpg).

| ID | Task | Exact changes |
|---|---|---|
| 3.1 | Wrapper | In `index.html`, wrap the Repeat Sentence practice elements (`section.speak-audio`, `.practice-audio-meta`, the "Speak what you hear:" label, `#transcription-display`, result/animation elements) in `<div id="speak-practice-area">`. `cardBodySelector:'#speak-practice-area'`. |
| 3.2 | Audio | `PteAudioBox.create(host,{audio})` using the sentence `<audio>` that `window.speakAudioPlayer` (`PracticeAudioPlayer.attach({prefix:'speak'…})`, script.js ~3870) controls. Hide `section.speak-audio` under v3. Countdown 3 s → `box.play()`. The first automatic play **does not** consume a replay. |
| 3.3 | Replay helper | Helper "Replay · {left}" (`phases:['prep','complete']`): calls the same logic as `playBtnSpeak` click (script.js ~10044: increments `window.speakReplayCount`, respects `DifficultyManager.getCurrentSettings('speak').maxReplays`, default 5) then `box.replay()`. Disabled at 0. Hide `#replay-counter-speak` under v3 (the count lives on the button). |
| 3.4 | Shadow helper | Adopt `#shadow-mode-btn` as a helper ("Shadow" + coin chip "5c", `aria-pressed` from `window.isShadowModeActive`, `phases:['prep']`). Keep its existing click handler (script.js ~10121) including the `locked` state. |
| 3.5 | Recording | When audio ends → `PteRecorderWidget` countdown 3 s → programmatically trigger today's start logic (the `recordBtn` click handler at script.js ~10187 — extract its body into `startRepeatSentenceRecording()` and call that) → 15 s max → auto-stop (extract the stop branch into `stopRepeatSentenceRecording()`), phase `complete`. `startRepeatSentenceAudioCapture()` / `stopRepeatSentenceAudioCapture()` (~4578 / ~4522) are unchanged. |
| 3.6 | Transcript box | Hide `#transcription-display` and its label during `listen`/`prep`/`recording` under v3 (it distracted during speaking); the recognised text is shown in Feedback. |
| 3.7 | Feedback | `#check-btn-speak` = "Get feedback" (primary, `complete`); `#retry-btn-speak` = "Try again" (ghost, `feedback`). Two columns ([repeat-sentence-05](images/target/speaking/repeat-sentence-05-feedback.png)): **left** = "THE SENTENCE" with the word diff from `performCheckSpeak()` (`renderDiff(diff)` / acoustic tokens), legend, "Correction" row with `#replay-btn` ("Replay animation"), `#breakdown-beginning` ("From the beginning"), `#breakdown-end` ("From the end"), `#skip-animation-btn` hidden unless animating, listen-back "Your recording | Original sentence". **Right** tabs "Your results" (stats: Points `scoreValue/totalWords` from `#score-speak`, Pronunciation / Fluency / Completeness from the Azure assessment when present — hide tiles that have no value) + "What to practise next"; "Practise missed words" = `renderPronunciationPractice(missedWords)` output ([repeat-sentence-06](images/target/speaking/repeat-sentence-06-feedback-second-tab.png)). |
| 3.8 | Filters / More | Appendix B.2; More adds "Reset progress" → `#reset-progress-speak-btn` click. Recommended jump `#recommended-btn-speak` becomes the "Question order: Recommended" option. |
| 3.9 | Tests | New `tests/browser/pte-repeat-sentence-v3-browser-check.js`; re-run with flag off: `speaking-controller-browser-check.js`, `speaking-pronunciation-tooltip-check.js`, `practice-modes-browser-check.js`. |

### Phase 4 — Describe Image (`describe-image`, `public/describe-image-mode.js`)

Targets: [describe-image-00..07](images/target/speaking/). Today: [current-di](images/current/current-di.jpg).

| ID | Task | Exact changes |
|---|---|---|
| 4.1 | Auto start | Under v3 call `startPractice()` (~378) as soon as `updateQuestionDisplay()` (~270) finishes loading the image; hide `#play-di-btn`. |
| 4.2 | Layout | `cardBodySelector:'#di-practice-area'`. In `#di-step-prepare`: PTE instruction ("Look at the image below. In 25 seconds…"), then a row: left `#di-image-container` (460px max, white, 1px `#d6d6d6` border, 12px padding) with `#di-zoom-btn` moved **into the image corner** as a 34px icon button (top-right, `aria-label="Zoom image"`); right the recorder widget. Hide `.notes-step-header` badge + `#di-prep-timer` under v3. |
| 4.3 | Timers | `startPrepTimer()`/`tickPrep()` (~454/465) → `rec.showCountdown(25)` / `rec.tick(n)`; `startRecordingSession()`/`tickRecord()` (~479/558) → `showRecording(40)` / `setElapsed`; `stopRecording()` (~575) → `showComplete()`. Keep `#di-stop-btn` = "Finish recording". |
| 4.4 | Zoom | `openZoom()` / `closeZoom()` (~786/795) keep working; zoom view per [describe-image-07](images/target/speaking/describe-image-07-zoom.png): fixed overlay inset 6vh/6vw, radius 14px, click or Escape closes. |
| 4.5 | Feedback | `#di-submit-btn` = "Get feedback" (primary, `complete`); `#di-retry-btn` = "Record again" (`complete`); `#di-results-retry-btn` = "Try again" (`feedback`); `#di-next-question-btn` hidden under v3 (shell Next). Two columns ([describe-image-05](images/target/speaking/describe-image-05-feedback.png)): left = image (small), "Your recording" player, "WHAT YOU SAID" transcript; right tabs "Key points" (stats + key-point checklist from the entry's `keyPoints` + `#di-ai-btn` "AI content assessment" with note "Opens in Ask me! with your transcript and the key points" — keep `sendAIAssessment()` ~729 unchanged) and "Sample answer" (`#di-sample-answer`, [describe-image-06](images/target/speaking/describe-image-06-feedback-second-tab.png)). Key-point coverage today is only produced by the AI assessment; until a local matcher exists, show the checklist **without** ✓/✗ and the tile "Key points —/5" (open decision O-7). |
| 4.6 | Tests | New `pte-describe-image-v3-browser-check.js`; re-run `describe-image-mode-browser-check.js` with flag off. |

### Phase 5 — Answer Short Question (`asq`, `public/asq-mode.js`, class `AsqMode`, `window.ASQMode`)

Targets: [answer-short-question-00..05](images/target/speaking/). Today: [current-asq](images/current/current-asq.jpg).

| ID | Task | Exact changes |
|---|---|---|
| 5.1 | Wrapper | In `index.html` give the `div` that holds `section.asq-audio` and `#asq-status-message` the id `asq-practice-area`; `cardBodySelector:'#asq-practice-area'`. |
| 5.2 | Flow | On `setQuestionById()` (~708) under v3: audio box countdown 3 s → `playPrompt()` logic (~396) through the box → on end, recorder countdown 1 s → `startRecording()` (~545) → 10 s max → `stopRecording()` (~697) → `complete`. Hide `section.asq-audio` and `#asq-status-message` under v3. |
| 5.3 | Helper | "Replay question" (`phases:['prep','complete']`) → `box.replay()`. |
| 5.4 | Dock | `#asq-record-btn` = "Start recording" (`prep`), `#asq-stop-btn` = "Finish recording" (`recording`), `#asq-redo-btn` = "Try again" (`feedback`), "Get feedback" (primary, `complete`) triggers the existing result display (`showResult()` ~464, which today runs right after stop — gate it behind this button under v3). |
| 5.5 | Feedback | Single tab titled "Your answer". Left: "THE QUESTION" (revealed question text), listen-back "Question | Your recording". Right: verdict block (green `--green-50`, "Correct" 22px + "+{xp} XP"; red for "Incorrect"), "You said: “…”", "Accepted answers: …" (from `showResult()` data). |
| 5.6 | Filters | None → Filters button hidden. |
| 5.7 | Tests | New `pte-asq-v3-browser-check.js`; re-run `asq-mode-browser-check.js`, `tests/asq-logic.test.js`. |

### Phase 6 — Respond to a Situation (`rts`, `public/rts-mode.js`)

Targets: [respond-to-situation-00..06](images/target/speaking/). Today: [current-rts](images/current/current-rts.jpg).

| ID | Task | Exact changes |
|---|---|---|
| 6.1 | Auto start | Under v3 call `startFlow()` (~392) when `loadQuestion()` (~291) completes; hide `#play-rts-btn`. |
| 6.2 | Layout | `cardBodySelector:'#rts-practice-area'`. Order: PTE instruction ("Listen to and read a description of a situation. You will have 10 seconds to think…" — uses the app's current 10 s; open decision O-3), `#rts-prompt-text` restyled as plain PTE text (no card), audio box, recorder host. Hide `#rts-audio-countdown-box` (its countdown moves into the audio box: `startAudioCountdown()` ~403 → `box` "Beginning in 15 seconds"). |
| 6.3 | Timers | `startAudioPlayback()`/`onAudioEnded()` (~435/451) → box Playing/Completed then show recorder; `startPrepTimer()` (~475, 10 s) → recorder countdown; `startRecording()` (~512, 40 s) → recording; `stopRecording()`/`onRecordingComplete()` (~594/608) → Complete. |
| 6.4 | Feedback | `showResults()` (~674) renders into `.pte-fb`: left = "Your recording" player + "YOUR TRANSCRIPT" (`#rts-transcript`); right tabs "AI score" (empty state "Not scored yet" + explanation + `#rts-ai-score-btn` "Submit to AI scoring"; results from `displayAiScoreResults()` ~907 replace the empty state; guest → today's login prompt `#rts-ai-score-login-btn`) and "Sample answers" (today's Full / Simplified tabs from `buildSampleResponsesHtml()`/`initSampleResponseTabs()` ~997/1017 restyled as a segmented control). `#rts-retry-btn` = "Try again"; `#rts-next-question-btn` hidden (shell Next). |
| 6.5 | Tests | New `pte-rts-v3-browser-check.js`; re-run `rts-mode-browser-check.js`, `rts-mode-full-browser-check.js`. |

### Phase 7 — Summarize Group Discussion (`sgd`, `public/sgd-mode.js`)

Targets: [summarize-group-discussion-00..06](images/target/speaking/). Today: [current-sgd](images/current/current-sgd.jpg).

| ID | Task | Exact changes |
|---|---|---|
| 7.1 | One screen | `cardBodySelector:'#sgd-practice-area'`. Under v3 there is **no separate recording step**: `goToRecordingStep()` (~1062) must not hide the listen step; instead it shows the recorder host under the audio box. `goBackToNotes()` (~1100) and `#sgd-next-step-btn` / `#sgd-back-to-notes-btn` are hidden under v3. |
| 7.2 | Layout | PTE instruction; row: group icon (130px, `people` SVG from the mockup) + audio box; recorder host; notes panel with tabs **Topic / Speaker 1 / Speaker 2 / Speaker 3** (today's `renderSpeakerTabs()` ~779 + `#sgd-note-panels`), header "Your notes · type while you listen" (listen/prep) or "· look at them while you speak" (recording). Notes stay editable. |
| 7.3 | Flow | `startPractice()`/`goToListeningStep()` (~753/762) automatically; audio countdown 3 s → play (`loadAudio()` ~918 element) → on end recorder countdown 10 s → `startRecordingSession()` (~1113) → 120 s → `stopRecording()` (~1193) → `complete`. `#sgd-record-btn` "Start recording" (`prep`), `#sgd-stop-btn` "Finish recording", `#sgd-submit-btn` "Get feedback" (primary, `complete`, runs `submitNotes()` ~1219), `#sgd-retry-btn` "Try again". |
| 7.4 | Feedback | `displayResults()` (~1424) into `.pte-fb`: left = listen-back "Your recording | Discussion" + "YOUR NOTES" by speaker with matched words highlighted (`--green-100` background, `--green-700` text); right tabs "Who said what" (stats: Overall = `#sgd-overall-accuracy`, one tile per speaker from `compareTextsBySpeaker()` ~1304; key-idea list) and "Transcript" (speaker-labelled transcript with the same highlights). |
| 7.5 | Tests | New `pte-sgd-v3-browser-check.js`; re-run `sgd-mode-browser-check.js`. |

### Phase 8 — Retell Lecture (`notes`, `public/take-notes-mode.js`)

Targets: [retell-lecture-00..06](images/target/speaking/). Today: [current-rl](images/current/current-rl.jpg).

**8A — layout (no new recording yet)**

| ID | Task | Exact changes |
|---|---|---|
| 8A.1 | Auto start | Skip the overview card and `#notes-start-btn` under v3: call `startPractice()` (~773) then `goToAudioStep()` (~838) directly. The guiding video becomes the helper **Intro video** (`phases:['listen']`) that calls `loadGuidingVideo()` (~805) inside a modal (reuse `SpeakingPracticeController.createSheet`). `#notes-skip-video-btn` is not shown. |
| 8A.2 | Layout | `cardBodySelector:'#notes-practice-area'`: PTE instruction (RL wording), audio box (hide `section.notes-audio` + `#notes-audio-status`), notes box `#notes-user-input` under it with header "Your notes · type while you listen". |
| 8A.3 | Dock / results | Until 8B ships: after the audio ends, show "Get feedback" (primary) = `submitNotes()` (~949); hide both `#notes-submit-btn` and `#notes-in-card-submit-btn`; `#notes-retry-btn` = "Try again". Feedback two columns: left = your notes with matches highlighted (from `compareTexts()` ~1021), right tabs "Your results" (Notes match %) / "Lecture transcript". |

**8B — recording step (needs decision O-1 before starting)**

| ID | Task | Exact changes |
|---|---|---|
| 8B.1 | Recording | After the lecture ends: recorder countdown 10 s → record 40 s via `AudioDspPipeline.createRecorder()` (mandatory) + browser speech recognition for a transcript (same pattern as `rts-mode.js startSpeechRecognition()` ~643) → Complete. |
| 8B.2 | Scoring | Content coverage = key-idea match between the speech transcript and the lecture transcript using the existing `compareTexts()`; fluency/pronunciation only if O-1 approves an unscripted assessment call. |
| 8B.3 | Attempts | Save with `PTEAttemptArchive.saveStateAttempt('notes', …)` including the audio, so the attempts list can play it. |
| 8B.4 | Tests | `pte-retell-lecture-v3-browser-check.js`; re-run `notes-mode-browser-check.js`, `notes-navigation-audio-browser-check.js`, `verify-retell-lecture.js`. |

---

## Phase 9 — cross-mode QA, rollout, documentation

### 9.1 New cross-mode check — `tests/browser/pte-speaking-shell-browser-check.js`

For each mode in `['read-aloud','speak','describe-image','notes','asq','sgd','rts']` with `?pteShell=v3`, stub `MediaRecorder`/`getUserMedia` (as in the audit harness) and shorten timers through a test hook (`window.__PTE_TEST_TIME_SCALE = 0.05` read by the modes' tick intervals — add this hook in each mode behind `if (window.__PTE_TEST_TIME_SCALE)`):

1. Exactly one `.pte-modebar`; `.spc-view-toggle`, `.spc-row--advanced`, `.main-header` not visible.
2. Audio modes: while phase is `listen`, `.pte-rec` does not exist or is empty; after the audio `ended` event it exists (ref-03 rule).
3. Phase `prep`: clicking `#pte-next-{mode}` opens a dialog whose title is "Cannot skip".
4. Phase `recording`: no element with `data-pte-helper` is visible; Next opens "Go to the next question?".
5. Phase `recording`: `.pte-rec[data-state=recording]` shows `00:0x` and at least one `.pte-rec__wave i.is-on` after 2 scaled seconds.
6. Phase `feedback`: `.pte-card` height ≤ 740px at 1440×900; `.pte-fb` has 2 columns (`getComputedStyle(...).gridTemplateColumns` has 2 tracks); exactly one `.pte-btn--primary` visible in the dock.
7. `.pte-attempts` exists in every phase.
8. At 390×844: `document.documentElement.scrollWidth === 390`.
9. Flag off (`?pteShell=legacy`): no `.pte-modebar`; today's `.spc-row--primary` visible.

Fit-measurement snippet (same as used for the mockups):

```js
const cardH = await page.evaluate(() => Math.round(document.querySelector('.pte-card').getBoundingClientRect().height));
assert(cardH <= 740, `feedback card is ${cardH}px`);
```

### 9.2 Regression runs (flag off)

`speaking-controller-browser-check.js`, `speaking-shell-cross-mode-check.js`, `speaking-ui-full-audit.js`, `speaking-ui-review-regression-check.js`, `production-speaking-controller-check.js` (read it first — it may target production; run only the local mode), `practice-modes-ui-full-audit.js --viewport desktop,mobile`, `verify-wfd-spc.js` (Write from Dictation must be unchanged), plus unit tests `node --test tests/cross-mode-controller-remediations.test.mjs tests/pte-shell-next-rules.test.mjs tests/pte-recorder-widget.test.mjs`.

### 9.3 Accessibility checklist

- All new buttons are `<button type="button">` with visible focus (`--focus-ring`).
- Popovers: `aria-haspopup`, `aria-expanded`, Escape closes, focus returns to the trigger.
- Dialogs: `role="alertdialog"`, `aria-modal="true"`, labelled and described, focus trapped.
- Recorder/audio status announced once per state change (4.4).
- Colour is never the only signal: word states also differ by underline style; verdicts have text.
- `prefers-reduced-motion`: no pulse, waveform bars static, no fade-in.

### 9.4 Rollout

1. All phases merged with `RELEASE_DEFAULT = false`.
2. Product owner reviews with `?pteShell=v3` locally and on a **preview channel** (only when asked; see `scripts/release/` and the deployment rules in AGENTS.md).
3. Enable per mode by editing `ENABLED_MODES`, then flip `RELEASE_DEFAULT` to `true` in a separate, approved change.
4. Rollback: set `RELEASE_DEFAULT = false` (or learners use `?pteShell=legacy`); no data migration is involved.

### 9.5 Documentation

Update the feature records in `docs/specs/features/` that describe these modes (`speak-mode.md`, `notes-mode.md`, and add sections for the others if missing) with the v3 behaviour; link back to this plan. Record the final evidence under `docs/audits/pte-speaking-shell/<date>/` only if the product owner asks for retained evidence (otherwise keep it in your external evidence folder).

---

## 11. Open decisions

| ID | Decision | Default in this plan |
|---|---|---|
| O-1 | Retell Lecture recording step (8B): approve adding speech recording + how to score free speech (content-only vs an unscripted pronunciation assessment) | 8A ships first; 8B blocked until decided |
| O-2 | Audio box style: keep the blue PTE box or match a new guideline image | Keep the blue box |
| O-3 | Respond to a Situation timings: keep the app's 15 s wait / 10 s think / 40 s answer or use the test's 20 s think | Keep app timings; instruction text says 10 s |
| O-4 | Feedback "Next question →" skips confirmation | Skips |
| O-5 | "Start recording" still available during the countdown (practice shortcut) | Available; only Next is blocked |
| O-6 | Read Aloud guide marks stay on the passage while recording if Coach was on | Stay |
| O-7 | Describe Image key-point ✓/✗ without AI: build a local matcher or show only after AI assessment | Checklist without marks until AI result |
| O-8 | "Ask me!" launcher: shrink to a 48px round button (global change) | Out of scope; separate task |
| O-9 | Coach closed by default for every learner | Closed; remembered per learner |

---

## 12. Appendices

### Appendix A — copy deck

**Instructions (PTE area, Arial):**

| Mode | Text |
|---|---|
| Read Aloud | Look at the text below. In {prep} seconds, you must read this text aloud as naturally and clearly as possible. You have {record} seconds to read aloud. |
| Repeat Sentence | You will hear a sentence. Please repeat the sentence exactly as you hear it. You will hear the sentence only once. |
| Describe Image | Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing. You will have 40 seconds to give your response. |
| Retell Lecture | You will hear a lecture. After listening to the lecture, in 10 seconds, please speak into the microphone and retell what you have just heard from the lecture in your own words. You will have 40 seconds to give your response. |
| Answer Short Question | You will hear a question. Please give a simple and short answer. Often just one or a few words is enough. |
| Summarize Group Discussion | You will hear three people having a discussion. When you hear the beep, summarize the whole discussion. You will have 10 seconds to prepare and 2 minutes to give your response. |
| Respond to a Situation | Listen to and read a description of a situation. You will have 10 seconds to think about your answer. Then you will hear a beep. You will have 40 seconds to answer the question. Please answer as completely as you can. |

**Audio box:** `Status: Beginning in {n} seconds` · `Status: Playing` · `Status: Completed` · `Status: Click to start audio`

**Recorder:** `The recording will begin in {n} seconds` (`1 second`) · `Recording` · `Complete`

**Dock status text:**

| Phase | Text |
|---|---|
| listen | Listen carefully. The recorder appears when the audio ends. |
| prep | Recording starts automatically when the countdown ends. |
| recording | RA "Read the passage aloud." · RS "Repeat the sentence." · DI "Describe the image." · RL "Retell the lecture." · ASQ "Answer the question." · SGD "Summarize the discussion." · RTS "Respond to the situation." |
| complete | Recording saved. Listen back or get feedback. |
| feedback | Saved to Previous attempts below. |

**Buttons:** Start recording · Finish recording · Cancel · Record again · Play · Get feedback · Try again · Next → · Next question → · Coach · Replay · Shadow · Replay question · Intro video · Filters · Reset · Show advanced analysis › / Hide advanced analysis › · ▶ You · ▶ Model · ▶ Play · Open feedback · Stay here · OK

**Dialogs:**

| Kind | Title | Body | Buttons |
|---|---|---|---|
| noskip | Cannot skip | The recording is about to begin. As in the test, you can't move to the next question during the countdown. | OK (primary) |
| confirm (listen) | Go to the next question? | You haven't answered this question yet. It will be marked as skipped. | Stay here · Next question (primary) |
| confirm (recording) | Go to the next question? | Your recording will stop and this attempt will be saved without feedback. | Stay here · Next question (primary) |
| confirm (complete) | Go to the next question? | This attempt is saved. You can get feedback on it later from Previous attempts at the bottom of the page. | Stay here · Next question (primary) |

**Feedback tabs:** RA "Your results" / "Coach tips · {n}" · RS "Your results" / "Practise missed words" · DI "Key points" / "Sample answer" · RL "Your results" / "Lecture transcript" · ASQ "Your answer" (single) · SGD "Who said what" / "Transcript" · RTS "AI score" / "Sample answers"

**More menu:** Focus mode — Hide the page header while you practise · How {Mode} works — Timing, scoring and tips · (RS) Reset progress — Start this question set again

**Previous attempts:** Previous attempts · {trend} · This question · {n} · All {Mode} · Just now · New · Yesterday · Your recordings and scores for this question are kept here after every attempt. · Sign in to keep your attempts. Attempts from this session stay here until you leave the page. · No attempts for this question yet.

### Appendix B — filters per mode

| # | Mode | Groups (label: options) | Today's source |
|---|---|---|---|
| B.1 | Read Aloud | Sample audio: All / Available / No audio · Prompt feature: All prompts / Any connected speech / Linking / Reduced words / Sound changes · Difficulty: Recommended / Level 1 (Easy) / Level 2 (Medium) / Level 3 (Hard) · Order: Random / In order | `#ra-practice-target-drawer` buttons (`#ra-filter-*`), `setSampleAudioFilter()`, `setPromptFeatureFilter()`, `setPromptOrderMode()` |
| B.2 | Repeat Sentence | Question order: Recommended / Manual · Status · Length · Difficulty | `#recommended-btn-speak`, `#adaptive-speak`/`#manual-speak`, `#status-filter-container-speak`, `#length-filter-container-speak`, `#difficulty-filter-container-speak` |
| B.3 | Describe Image | Difficulty | `#difficulty-filter-container-di` (`applyDifficultyFilter()`) |
| B.4 | Retell Lecture | Question order: Recommended / Manual · Status · Difficulty | `#recommended-btn-notes`, `#status-filter-container-notes`, `#difficulty-filter-container-notes` |
| B.5 | ASQ | — (Filters hidden) | — |
| B.6 | SGD | Question order: Recommended / Manual · Difficulty | `#recommended-btn-sgd`, `#difficulty-filter-container-sgd` |
| B.7 | RTS | — (Filters hidden) | — |

Implementation rule: each group's `set(value)` must call the mode's existing handler (or `.click()` the existing option element) so filtering logic stays in one place.

### Appendix C — annotation numbers used in the mockups

1 mode bar · 2 picker · 3 Filters · 4 Coach · 5 More · 6 progress bar · 7 recorder widget · 8 action dock · 9 Coach drawer / Coach tab · 10 feedback right column · 11 listen-back row · 12 practise list · 13 advanced analysis · 14 Ask me! · 15 Next · 16 Previous attempts · 20 audio box · 21 first helper · 22 Shadow · 23 notes · 24 zoom · 25 feedback left column · 26 feedback stats · 27 AI action. The mockups' "Where each current control went" tables (open the HTML files) map every current control to its new place per mode.

### Appendix D — dock matrices (`data-pte-phases`)

**D.1 Read Aloud**

| Control | loading | prep | recording | complete | feedback |
|---|---|---|---|---|---|
| Coach (helper) | – | ✓ | – | ✓ | ✓ (switches right-column tab) |
| `#ra-record-btn` Start recording (primary) | – | ✓ | – | – | – |
| Cancel (ghost) | – | – | ✓ | – | – |
| `#ra-stop-btn` Finish recording (stop) | – | – | ✓ | – | – |
| `#ra-retry-btn` Record again / Try again (ghost) | – | – | – | ✓ | ✓ |
| `#ra-play-recording-btn` Play | – | – | – | ✓ | – |
| `#ra-check-btn` Get feedback (primary) | – | – | – | ✓ | – |
| Next → (ghost) | disabled | ✓ | ✓ | ✓ | – |
| Next question → (primary) | – | – | – | – | ✓ |

**D.2 Repeat Sentence** — listen: Next · prep: Replay·n, Shadow·5c, Start recording (primary), Next · recording: Cancel, Finish recording, Next · complete: Replay·n, Record again, Play, Get feedback (primary), Next · feedback: Try again, Next question (primary)

**D.3 Describe Image** — prep: Start recording (primary), Next · recording: Cancel, Finish recording, Next · complete: Record again, Play, Get feedback (primary), Next · feedback: Try again, Next question (primary)

**D.4 Retell Lecture** — listen: Intro video, Next · prep: Start recording (primary), Next · recording: Cancel, Finish recording, Next · complete: Record again, Play, Get feedback (primary), Next · feedback: Try again, Next question (primary). (8A without recording: complete → Get feedback only.)

**D.5 ASQ** — listen: Next · prep: Replay question, Start recording (primary), Next · recording: Cancel, Finish recording, Next · complete: Replay question, Record again, Play, Get feedback (primary), Next · feedback: Try again, Next question (primary)

**D.6 SGD** — listen: Next · prep: Start recording (primary), Next · recording: Cancel, Finish recording, Next · complete: Record again, Play, Get feedback (primary), Next · feedback: Try again, Next question (primary)

**D.7 RTS** — listen: Next · prep: Start recording (primary), Next · recording: Cancel, Finish recording, Next · complete: Record again, Play, Get feedback (primary), Next · feedback: Try again, Next question (primary)

### Appendix E — timings

| Mode | Audio wait | Audio | Prep before recording | Recording |
|---|---|---|---|---|
| Read Aloud | – | – | 30–40 s by word count (`applyPromptRow()`) | = prep, max 40 s |
| Repeat Sentence | 3 s | clip | 3 s | 15 s |
| Describe Image | – | – | 25 s | 40 s |
| Retell Lecture | 3 s | lecture | 10 s | 40 s (8B) |
| ASQ | 3 s | question | 1 s | 10 s |
| SGD | 3 s | discussion | 10 s | 120 s |
| RTS | 15 s | clip | 10 s | 40 s |

### Appendix F — current element → v3 location (all modes)

| Current | v3 |
|---|---|
| `.main-header` (Practice, `#back-to-dashboard-btn`, `#current-mode-indicator`, `#mode-tutorial-btn`) | Mode bar back button; title; "How … works" in More |
| `#difficulty-badge` / `#diff-level-text` | Mode bar level chip |
| `.spc-row--primary` picker (`.spc-picker-prev`, `#spc-picker-{mode}`, `.spc-picker-next`) | Mode bar centre |
| `.spc-order-toggle` 🎲 Random | Filters → Order (RA) |
| `.spc-view-toggle` Basic / Advanced | Removed under v3 |
| `.spc-settings-btn` ⚙ Settings + sheet | Filters popover; RA Listen tab → Feedback voice row; RA History tab → Previous attempts |
| `.spc-focus-btn` ⛶ | More → Focus mode |
| `SpeakingPracticeSteps` step bar | `.pte-progress` |
| `.spc-footer` / `.spc-slot-media` / `.spc-slot-attempt` | `.pte-dock` |
| `.spc-row--advanced` (`.spc-slot-advanced-action`, `.spc-slot-advanced-setting`, active chip) | Helpers in the dock; filters in the popover |
| `.practice-audio-player` sections (speaking modes) | Hidden; `.pte-audio` shows status/progress/volume |
| RA `#ra-workspace-heading`, `#ra-workspace-steps-host`, `#ra-workspace-coach-host`, `#ra-status-message`, `#ra-prep-timer-box`, `#ra-record-timer-box`, `#ra-next-btn` | Hidden (sr-only where noted) |
| RA `#ra-connected-speech-box` | Coach drawer / Coach tab |
| RA `#ra-accuracy-readout`, `.ra-transcript-metrics` | `.pte-stats` |
| RS `#replay-counter-speak`, `#transcription-display` | Replay count on helper; transcript in Feedback |
| DI `#play-di-btn`, `#di-prep-timer`, `#di-next-question-btn` | Auto start; recorder widget; shell Next |
| RL overview card, `#notes-start-btn`, `#notes-skip-video-btn`, `#notes-submit-btn`, `#notes-in-card-submit-btn` | Auto start; Intro video helper; one "Get feedback" |
| ASQ `#asq-play-prompt-btn` section, `#asq-status-message` | Audio box; Replay question helper |
| SGD `#play-sgd-btn`, `#sgd-next-step-btn`, `#sgd-back-to-notes-btn` | Auto start; single screen |
| RTS `#play-rts-btn`, `#rts-audio-countdown-box`, `#rts-next-question-btn` | Auto start; audio box countdown; shell Next |
