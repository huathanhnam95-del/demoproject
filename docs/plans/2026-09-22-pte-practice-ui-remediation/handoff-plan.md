# PTE practice modes — UI remediation (revised plan)

| | |
|---|---|
| **Date** | Tuesday, 22 September 2026 |
| **Status** | Plan revised; implementation in progress |
| **Supersedes / extends** | [2026-09-22 polish plan](../2026-09-22-pte-speaking-shell-polish/handoff-plan.md) (P1–P11) and [2026-09-21 fixes](../2026-09-21-pte-speaking-shell-v3-fixes/handoff-plan.md) (D1–D9) |
| **Design source of truth** | [2026-09-19 redesign plan](../2026-09-19-pte-speaking-redesign/handoff-plan.md) |
| **Evidence** | Chrome + Playwright sweep over 7 modes × 1440/1280/1024/768/390, driving each mode through listen → prep → recording → complete → feedback |
| **Tracker** | Tasks 1267 (Read Aloud diagnosis), 1268 (remaining modes diagnosis), 1270 (this remediation) |

---

## 0. What changed since the polish plan

The polish plan's chrome work **landed**: all 7 modes now report identical card padding
`22px 34px 26px`, dock `16px 26px`, progress inset `34px`, gutter ≥34px, no page
horizontal scroll and no legacy gradients in `.pte-dock`.

What it did **not** reach is layout behaviour *inside* the card. The measured defects
below are new findings, plus the owner's report that the Describe Image picture is too
small to use without zooming.

---

## 1. New item — Describe Image picture is too small (owner request)

> "The image in Describe Image is very small. Make it default to the bigger version that
> fits the layout and the screen, do not ask the user to have to zoom in on it."

Measured today:

| Where | Rule | Result |
|---|---|---|
| Practice stage | `.di-pte-stage-media { flex: 1; max-width: 460px }` next to an equal-weight `flex: 1` recorder column | image ≤ **436 × 356** inside an 872px card body |
| Feedback | `.di-fb-image-container { max-width: 240px }` | image ≤ **216px wide** — a thumbnail |
| Zoom | `#di-zoom-overlay` | the only way to actually read the picture |

The 2026-09-19 target mockup shows the same ~460px image, so this is a **deliberate
change to the design**, made at the owner's request: the picture is the question, and it
should be legible without a zoom step.

### Fix — I1 … I4

- **I1 — the picture leads the stage.** `.di-pte-stage-media` becomes the dominant
  column (`flex: 1 1 62%`), the recorder takes `flex: 0 1 34%`. Drop the 460px cap.
- **I2 — size to the layout and the screen.** The image scales to the column width and is
  bounded by the viewport, not a fixed pixel box:
  `max-width: 100%; max-height: min(54vh, 520px); width: auto; height: auto;` so the dock
  stays reachable on a laptop while the picture uses the space it has.
- **I3 — stack before it gets cramped.** Below 900px the stage goes single column and the
  picture takes the full body width, recorder centred underneath (today it only stacks at
  768px).
- **I4 — feedback shows the picture, not a stamp.** `.di-fb-image-container` loses the
  240px cap and fills its column, with `max-height: min(38vh, 340px)`.

Zoom stays, as an extra rather than a requirement.

**Acceptance:** at 1440×900 the practice picture is ≥ 520px wide (was 436) and the card
still fits the phases without the dock leaving the viewport; at 390px the picture spans
the full card body; in feedback the picture is ≥ 300px wide at 1440.

---

## 2. The systemic defect — three modes disable the shell's feedback grid

Describe Image, Retell Lecture and SGD each reveal their feedback block with an **inline**
`style.display = 'flex'`:

| Mode | Line |
|---|---|
| Describe Image | `public/describe-image-mode.js:1238` |
| Retell Lecture | `public/take-notes-mode.js:1702` |
| SGD | `public/sgd-mode.js:1943` |

Inline style beats every stylesheet rule, so on those three modes both
`.pte-fb { display: grid }` **and** `@media (max-width: 980px) { .pte-fb { grid-template-columns: 1fr } }`
are inert. Measured column widths:

| Mode | 1024px | 768px | 390px |
|---|---|---|---|
| Read Aloud / Repeat Sentence | stacks | stacks | stacks |
| Retell Lecture | 391 / 391 | **267 / 267** | stacks (own ≤600 rule) |
| SGD | 389 / 389 | **265 / 265** | stacks (own ≤600 rule) |
| Describe Image | 250 / 522 | 176 / 349 | **73 / 158** |

Retell Lecture and SGD hide the problem behind a **second `.pte-fb` nested inside the
first** (`.notes-fb-grid`, `.sgd-fb-grid`) at `1fr 1fr` — equal columns where the spec
says `minmax(0,1.08fr) minmax(0,1fr)`. Column gaps disagree too: RS 30, DI 30, SGD 24,
RTS 24, RL 20 (spec: 30).

### Fix — G1 … G3

- **G1** — replace the three inline `display:flex` writes with a class the stylesheet owns
  (`.pte-fb.is-open`), so the shell's grid and its ≤980px stacking rule apply again.
- **G2** — delete the nested duplicate `.pte-fb` class from `.notes-fb-grid` /
  `.sgd-fb-grid` and let the one grid drive the columns at `1.08fr / 1fr`, gap 30.
- **G3** — Describe Image's columns use the shell's `.pte-fb__left` / `.pte-fb__right`
  treatment (border-left, padding-left, `min-width: 0`) instead of its own `.pte-fb__col`.

---

## 3. Describe Image feedback is built from inline styles

Its feedback block carries **19 inline `style=""` attributes** with hard-coded hexes
(`#f1f5f9`, `#1d4ed8`, `#64748b`) and re-implements `.pte-tabs` and a `.pte-stat` that
does not match the shell's `.pte-stats`. At 390px in feedback:

- content sits **52.5px outside the card** (minimum gutter −52.5)
- `.pte-stat` spills **93px left / 69px right** of its parent
- `.pte-stats` clipped: 113px visible of 184px
- `.pte-tabs` overflows 32px right

### Fix — S1 … S3

- **S1** — rebuild the stats row as the shell's `.pte-stats` grid with `.pte-stats__bar`
  tiles; drop the inline `display:flex` and the hard-coded colours for design tokens.
- **S2** — the tabs use the shell's `.pte-tabs` pill group with no inline styling.
- **S3** — strip the legacy `modern-btn modern-btn--check` gradient from `#di-fb-ai-btn`
  (the P7 gradient strip only covered `.pte-dock`, not the card body), and give
  `#di-pte-recorder` `min-width: 0` so it stops spilling its stage by ~7px at 390 (P10).

---

## 4. Mobile loses ~20% of the screen in every mode

At a 390px viewport the card is only **295px** wide. Three horizontal paddings stack:

```
.container 16px  +  .mode-panel 14px  +  .pte-card margin 10px  =  40px per side
```

The design spec asks for a **10–16px** page gutter on phones.

### Fix — M1

Under `body.pte-shell-v3` at ≤600px, collapse the nesting: `.container` and the mode panel
drop their side padding and the card keeps a single 10px margin, giving a ~10px gutter and
about 55px more usable width per phone screen. Scoped to the shell so legacy pages are
untouched.

---

## 5. ASQ and RTS strand the learner

Both stay in `listen` indefinitely. The audio loads and plays (`readyState: 4`,
`duration: 2`, `paused: false`), yet nine seconds later the box still reads
**"Status: Beginning in 0 seconds"**, the dock offers only **"Next →"**, and there is no
Start recording, no error and no retry. Repeat Sentence, Retell Lecture and SGD all
advanced past `listen` on the identical stub, so the asymmetry is real. This matches
**D8** from the 21-Sep plan.

### Fix — A1

Give the shared audio box a failure/timeout state: if playback has not produced an `ended`
within its expected duration + grace, show "We couldn't play this clip" with **Try again**
and **Skip question**, and let the mode advance to `prep` so the recorder is reachable.

> Not yet done in this batch — needs a live confirm against production audio before the
> timeout constant is chosen. Tracked separately.

---

## 6. Read Aloud (from the 1267 diagnosis)

- **R1** — `.ra-rail` keeps its legacy `max-height: calc(100vh − 244px)`, `overflow-y: auto`
  and `position: sticky; top: 153px` inside the card, so the card's height follows the
  **browser window height** (875px at 900vh, 1116px at 1200vh), 407px of coach content
  hides behind an inner scrollbar, and the rail runs 96px under the sticky dock. Its
  sticky header and bottom fade paint page grey `rgb(248,249,250)` on a white card.
- **R2** — the feedback left column is empty: the spec puts "recorder Complete,
  transcript/passage, legend, listen-back" there, but
  `[data-pte-phase="feedback"] #ra-prompt-stage { display: none }` hides the passage, so
  144px of content sits in a 455px column — 311px (results tab) to 567px (coach tab) of
  dead space.
- **R3** — the coach rail is a hard 360px, so at 1024 the passage column is squeezed to
  414px; the single-column breakpoint is 980px.
- **R4** — switching Results ↔ Coach tips swings the card 674 → 931 → 674px; the spec's
  budget is ≤740px at 1440×900.

---

## 7. SGD height

Feedback card **977.7px** at 1440×900 — 238px over the ≤740px budget. Prep card
**915.5px**, taller than a 900px laptop viewport, so learners scroll during a timed prep.
Legacy gradients survive on `#sgd-speaker-tabs` and `#sgd-topic`.

---

## 8. Not a defect

`.pte-audio`'s blue gradient appears in every listen-first mode and **is per spec §4.5**
(it mimics the real PTE player). Leave it.

Repeat Sentence is the reference implementation: feedback columns 571.1 / 528.9 (correct
1.08/1), imbalance 0, card 698px within budget, no spill at 390.

---

## 9. Order of work

| Batch | Items | Status |
|---|---|---|
| 1 | I1–I4 Describe Image picture size | this change |
| 2 | G1–G3 restore the shell feedback grid | this change |
| 3 | S1–S3 Describe Image feedback content | this change |
| 4 | M1 mobile gutter | this change |
| 5 | R1–R4 Read Aloud coach rail and feedback column | this change |
| 6 | SGD height, A1 audio failure state | follow-up |

## 9b. Full-width card (owner request, added after batch 5)

> "Why is there still a middle column in the modes that restrict the UI? Can't we just
> make it full screen instead of leaving the 2 sides with empty space?"

The page container was already full width (`max-width: none`). The narrow column came from
`.pte-card`'s own `max-width: 940px` (1200 in feedback), under a mode bar that *was* full
width — so the card read as an island. Measured unused space per side:

| Viewport | Card | Empty per side |
|---|---|---|
| 2560 | 940 | 810 (63% of the screen) |
| 1920 | 940 | 490 |
| 1440 | 940 | 250 |

Three separate caps were involved:

- **W1** `.pte-card` / `.pte-attempts` `max-width: 940px` → `none`. `.pte-card--wide`
  becomes `none` too, so the card no longer resizes between phases (this also retires the
  940 → 1200 jump reported in the 1267 diagnosis).
- **W2** Repeat Sentence carried a committed `.container:has(#mode-speak…) { max-width: 1280px; padding-inline: 16px }`
  — one mode deliberately narrower than the rest. Removed.
- **W3** `.container`'s legacy `max-width: 1100px` is only lifted by
  `practice-fluid-layout` while `body[data-practice-layout="fluid-v1"]` is set, and that
  attribute is **dropped on the Read Aloud → Repeat Sentence transition**
  ([read-aloud-mode.js:1196](../../../public/read-aloud-mode.js) deletes it after
  [script.js:2364](../../../public/script.js) sets it), which pinned the page back to
  1100px and made the card 45px narrower after some transitions than others. The shell now
  sets `max-width: none` and a `clamp(16px, 2vw, 40px)` gutter off its own
  `body.pte-shell-v3` class so width no longer depends on that flag.

**Reading measure.** A full-width card would otherwise run a passage at ~300 characters
per line on a wide monitor, which is unusable for a read-aloud task. So prose is capped
per element, not by starving the card: `.pte-instr` at `90ch`, `.pte-passage` /
transcripts / samples at `100ch`, and above 1600px the passage gains `font-size: 1.08em`
so spare room buys legibility instead of longer lines. The Read Aloud coach rail is
bounded at `minmax(300px, 420px)` so it does not stretch to 950px on a wide screen.

**Result** — identical at every width, all seven modes:

| Viewport | Card before | Card after | Empty per side |
|---|---|---|---|
| 1920 | 940 | **1732** | 490 → 94 |
| 1440 | 940 | **1271** | 250 → 85 |
| 1280 | 940 | **1118** | 170 → 81 |

Still open: the `data-practice-layout` flag is genuinely lost on that transition. The
shell no longer depends on it, but other fluid-layout rules (region widths, workarea
grid) silently stop applying — worth fixing at the source.

## 9c. Review and refactor pass

Findings from reviewing the changes above, with what was done:

| # | Finding | Action |
|---|---|---|
| R-1 | **The passage measure cap never worked.** `max-width` was silently dropped — even an inline `110ch` computed to `none`. Cause: `practice-fluid-layout.css:88-95`, section 5 *"Reading Region: Full Usable Width by Default"*, marks the passage `[data-practice-reading]` and forces `max-width` **and** `max-inline-size` to `none` with `!important`. | **Rule removed.** It was fighting a deliberate, documented product decision *and* the owner's "no empty space" request. Legibility is bought with type size instead: the passage steps to `1.12em` at 1280+ and `1.25em` at 1600+. |
| R-2 | **The prose measure reached only 3 of 7 modes.** ASQ, RTS, SGD and Retell Lecture name their instruction `*-pte-instruction` with no shared class, so `.pte-instr` never matched. | All four now carry `pte-instr` as well. Measured result: **~100 characters per line in all seven modes**, from one token. |
| R-3 | **Three hard-coded measures** (`62ch` in style.css, `90ch`/`100ch` added here). | Collapsed to `--pte-measure` / `--pte-measure-tight` on `body.pte-shell-v3`. |
| R-4 | **Two gradient-strip rules with different scopes** (`.pte-dock .pte-btn` vs `.pte-card__body …`) — which is exactly how `#di-fb-ai-btn` kept its gradient. | Merged into one rule covering dock and card body. |
| R-5 | **SGD leftovers**: the shell restyles `.sgd-speaker-tabs` into a wrapped pill row but left the legacy grey gradient band and underline behind it; `.sgd-topic-display` used a decorative two-stop gradient. | Band and underline cleared; topic panel flattened to `var(--blue-50)`. Remaining gradients across all modes: **`.pte-audio` only**, which is per design spec §4.5. |
| R-6 | **Dead per-mode column rules** — `grid-template-columns: 1fr` for `.sgd-fb-grid`/`.notes-fb-grid` at ≤600px, redundant since `.pte-fb` stacks at ≤980px. | Removed; the mode-specific phone `gap` kept. |
| R-7 | `.pte-card--wide` is now a no-op (the card is fluid in every phase) but `setPhase()` still toggles it. | Annotated as a no-op hook rather than churning the controller, which has another writer. |

Verified after the pass: **0 layout issues** (no spill, clipping or horizontal scroll) across
7 modes × {1440, 390} × 5 phases; feedback columns identical at `608/563 gap 30` in every
mode that has them; Read Aloud coach tab 735.6px (budget 740); `npm run test:structure`
45/45; all five edited mode scripts parse.

## 10. Verification

Re-run the diagnosis sweep and assert:

- Describe Image practice picture ≥520px wide at 1440; feedback picture ≥300px
- `.pte-fb` computes `display: grid` in all modes that have one
- one column at ≤980px in every mode; no element spills its parent at 390
- minimum content gutter ≥10px at 390, ≥16px at 1440
- Read Aloud card height identical at 900vh and 1200vh in practice + coach open
