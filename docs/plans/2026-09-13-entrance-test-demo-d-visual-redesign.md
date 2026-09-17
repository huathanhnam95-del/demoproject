# Entrance Test Demo D Visual Redesign — Execution Plan

> For the executor: follow this plan after explicit approval. Use the workspace Light route directly; do not inherit any generic skill instruction to spawn agents, enable Fast, commit unrelated files or deploy.

**Goal:** redesign all eight Demo D screens around C's recognizable visual language, combining the useful qualities of A/B and the PDF feedback while preserving and verifying D's content and workflow contracts.

**Architecture:** retain Demo D's ES modules, normalized content, state machine and IndexedDB stores. Recompose its view/shell and CSS, with bounded application/audio binding repairs needed to preserve readable content, focus, navigation and media lifecycle. Keep the existing CRM evaluator and ordinary D rating path.

**Tech stack:** existing HTML, CSS, native controls, Noto Sans, browser ES modules, MediaRecorder/Web Audio/DSP, IndexedDB, Node tests, Python Playwright with installed Chrome. No new framework or dependency.

**ArtifactMetadata:**
- `RequestFeedback: true`
- `Status: Proposed — awaiting user approval`
- `Task: 01a09b16-entrance-d-visual-plan`
- `Owner: Codex root planner; separate Luna X High implementation task after approval; originating root retains architecture and final audit`
- `Execution lineup proposed: Luna X High; separate implementation task; Light route; Standard speed; no subagents`

This is a plan, not implementation authorization. The existing root `C:/Cursor AI/implementation_plan.md` is unrelated and dirty; it is protected and is not edited. If execution later creates or modifies any `implementation_plan.md`, obey its last-tool-call/stop/approval gate. No push or deployment is included. The user approves this complete visual plan and execution lineup before coding; a new setting is not inferred from prose.

## 1. Authority, evidence and starting point

Read the [fresh evidence audit](../audits/entrance-test/2026-09-13-demo-d-visual-reaudit.md) first. E01–E07 and D01–D09 in that document distinguish source, observation, inference and proposal. The current release checkout is `C:/Users/Admin/.codex/worktrees/entrance-test-ui-demo-release-20260913/Cursor AI`, clean at `3157c6c40eb7669e9ee22f339877ac668feaa92c`; thirteen relevant live frontend files matched it after newline normalization. The shared checkout at `d188648e...` lacks D and is not the implementation base.

Fresh ratings: four raters, 410 A/B/C scores, zero D scores. Complete-rater visual means: A 4.250, B 3.667, C 3.833. **C is the foundation because of the user's instruction and the PDF's explicit preference, not because C won aggregate visual ratings.** Never restate the latter as a verified fact. Use ratings to prioritize weak screens, especially review/done, and to identify qualities worth retaining. No significance or task-performance claims.

The prior [overhaul handoff](2026-09-13-entrance-test-ui-demo-overhaul-handoff.md) remains historical workflow research. This plan supersedes its white/blue/soft-border visual direction and any claim that avoiding all of C's dark structural borders is required by the PDF. It preserves Noto Sans, demo-only scope, intentional QA helpers and historical-rating protection. The original [analysis](../entrance-test-ui-analysis.md) must be read alongside the corrective audits, not treated as unqualified truth.

All dimensions, tokens, motion timings, copy proposals and design choices below are **proposed**, not evaluator quotations or completed implementation. Placement/ownership continues to follow [project_structure.md](../../agent_docs/project_structure.md).

## 2. Selected visual direction and alternatives

**Selected: C / Signal, refined.** Preserve the black top band, square geometry, strong section framing, orange signal and numbered rhythm. Replace the beige field with white per PDF page 2. Use one strong outer task boundary, open internal sections, native inline controls and compact navigation. Use Noto Sans throughout. Borrow A's text spacing and B's precise operational contrast. D must feel related to C even with all text blurred.

Rejected alternative 1: copying C wholesale retains the detached rail, overly large passage typography, busy controls and weak review; it conflicts with the PDF and D workflow. Rejected alternative 2: lightly retinting current D leaves its sparse composition and long sidebar intact; the user's reported visual mismatch remains. The selected approach needs a view recomposition, not just token substitution.

### Recognizable C features — visual acceptance contract

1. Near-black full-width header with white Noto wordmark, compact tools and a restrained orange marker.
2. Square or 2px-radius geometry; a 2px charcoal outline around the primary task region, not nested cards around instruction/passage/control areas.
3. Numbered part rhythm, dark section rules, and orange current-part marker.
4. Primary black action with a static 3px burnt-orange offset; no gradient, glow or soft floating-card shadow.
5. Dense enough to give the task a defined place, with readable white space inside the task. At desktop the main passage and controls form one coherent column; no stranded 260px navigation sidebar.

White background does not erase C if these five features remain. Orange is a directional/interaction accent, not the correct-answer color. Show these features in welcome, task, review and done; do not make the opening screen the only designed screen.

### Reviewable design reference

Open [all eight proposed artboards plus mobile](C:/Users/Admin/.codex/audits/entrance-test-d-visual-redesign-20260913-01a09b16/visual-spec.html). Representative [speaking](C:/Users/Admin/.codex/audits/entrance-test-d-visual-redesign-20260913-01a09b16/proposed-speaking.png), [welcome](C:/Users/Admin/.codex/audits/entrance-test-d-visual-redesign-20260913-01a09b16/proposed-intro.png), [review](C:/Users/Admin/.codex/audits/entrance-test-d-visual-redesign-20260913-01a09b16/proposed-review.png) and [mobile](C:/Users/Admin/.codex/audits/entrance-test-d-visual-redesign-20260913-01a09b16/proposed-mobile.png) images make the composition concrete.

These are nonfunctional specification artifacts, with state examples and annotated content excerpts. They do not prove responsive behavior, media functionality or full-content fit. This written specification governs behavior, exact text and accessibility if an illustrative artboard omits a control state. Product screens must not contain the artboards' design annotations, sample receipt, or truncated/illustrative passages.

## 3. Design tokens

Retain the existing `--etu-*` prefix. Replace relevant values and introduce only named additions; do not spread one-off hex values through the stylesheet.

| Token / role | Proposed value | Usage |
|---|---|---|
| `--etu-font` | Existing local `'Noto Sans', system-ui, -apple-system, 'Segoe UI', sans-serif` | UI, passages, inputs, timers, numerals, EN and VI. Preserve font files/provenance. |
| `--etu-canvas` | `#ffffff` | Main canvas and task surface. |
| `--etu-subtle` | `#f5f5f5` | Recorder strip and occasional utility background. |
| `--etu-text`, new `--etu-chrome` | `#101010` | Body text, header background, primary button. |
| `--etu-secondary`, `--etu-muted` | `#525252` | Helpful secondary text; do not reduce contrast through opacity. |
| `--etu-divider` | `#d4d4d4` | Nonessential internal rules only. |
| `--etu-control-border` | `#737373` | Interactive control outlines; 1px normal. |
| New `--etu-structure-border` | `#191919` | 2px primary boundary/dock edge. |
| `--etu-accent` | `#ba310f` | Burnt orange current marker, small highlights. Darker than C's `#e8380d` for readable text. |
| `--etu-accent-hover` | `#972609` | Accent text hover. Primary button hover remains dark. |
| `--etu-selected` | `#f0f0f0` | Filled answers; use `#e5e5e5` for completed nav chips. Never indicate scored correctness. |
| `--etu-warning`, fill | `#92400e`, `#fffbeb` | Flags/intentional unanswered acknowledgement. Always add icon/text. |
| `--etu-danger` | `#b91c1c` | Error icon/message, not ordinary unanswered state. |
| `--etu-success` | `#166534` | Committed save/mic-success text; no green answer ticks. |
| `--etu-radius` | `2px` | Inputs/buttons/dialog; main stage/header remain square. |
| Spacing | 4, 8, 12, 16, 24, 32, 48px | Reuse current spacing scale. |
| Content | `1120px` max shell body; `72ch` max reading text | Shell centered; task media spans text region, without extra wrapper cards. |
| Control size | 44px minimum hit area, primary 48px min-height | All viewports; 8px gaps between separate controls. |
| Primary offset | `3px 3px 0 #ba310f` | Main actions only; reserve space so no edge clipping. |

Computed solid-color contrast examples (offline WCAG luminance formula): black/white 19.03:1, secondary/white 7.81:1, accent/white 5.94:1, control border/white 4.74:1, success/white 7.13:1, warning/warning-fill 6.84:1. These do not certify every composed state. Verify the actual candidate, including disabled, focus, selected and forced-colors states. Ordinary text target ≥4.5:1; meaningful graphics/control boundaries ≥3:1.

| Type role | Desktop | Narrow / mobile | Rules |
|---|---|---|---|
| Welcome/review/done title | 36px/1.2, 600 | 28px/1.25, 600 | At most ~24ch; no forced line break; no redundant eyebrow above it. |
| Section title | 24px/1.3, 600 | 22px/1.35, 600 | Noto, sentence case. |
| Task instruction | 20px/1.5, 600 | 18px/1.5, 600 | Actual action text, not “Instruction”. Stronger than passage. |
| Passage | 18px/1.8, 400 | 18px/1.75, 400 | No ellipsis, line clamp or rewritten punctuation. |
| Controls/body | 16px/1.5, 500 or 400 | Same | Inputs ≥16px; no tiny mobile form text. |
| Meta/status | 14px/1.45, 400/500 | Same | Numeric tabular variant; no separate mono face. |

Keep `font-synthesis: none`. Verify real font load at 400/500/600 and Vietnamese diacritics, not merely a computed family string. Apply 100/115/130% text settings consistently to reading text, instructions and necessary labels; controls grow rather than clip. Browser zoom is a separate test.

## 4. Common screen composition

### Shell

At viewport widths ≥1200px, center the body at max 1120px with 32px minimum outside gutters. Top header is full width, min-height 64px; inner header aligns with body. At 1000–1199px, use 24px gutters. Body begins 32px below header; it does not vertically center a tiny panel on a huge empty page. Title-first screens use a short 44×4px orange rule below the header and above their title, not another descriptive eyebrow.

Wordmark at left: square 30px `B` mark already available as text, then “Entrance assessment”. At right: one save status, EN/VI segmented choice and text-size control. Preserve explicit labels/pressed state and all settings. At narrow widths use two rows: brand first, tools wrapping below. Do not hide language/text-size features behind an unlabeled icon. A compact native text-size select is permitted in narrow layouts with the same 100/115/130 values and existing scale action; no duplicated focusable hidden controls.

One outer `<main id="et-app">`; replace the nested task `<main>` with an appropriate section/div while retaining a real task heading. Keep a visible-on-focus skip link to the task. One page heading and descriptive navigation landmarks. One polite save live region. Display a single demo scope label in the shell footer. Route-level failures have their own visible message near the affected control.

Do not repeat raw persistence/internal identifiers in everyday interface copy. “Saved in this browser” is meaningful; schema/revision/fixture mechanics belong in the QA disclosure or evidence, not the learner-style task surface. Keep truthful local-demo disclosure at welcome and done.

### Task anatomy and scroll

Order: compact section/group metadata and flag → one outlined task stage → task actions → part/group dock. Within the stage, stack actual instruction, complete passage and recording/transport region in the order described per screen. Separators are 1px rules, no inner rounded cards/shadows. At desktop, stage padding 28px horizontally/24px vertically; narrow 16px. Use natural document scrolling, no nested scrollable passage panel or fixed content height.

For full-height standalone and embedded viewports, use a three-row shell (`auto 1fr auto`, minimum `100dvh`). Dock is sticky to the bottom of the demo's own viewport when space permits, with its real height accounted for in document flow and focus scroll margins. It never attaches to the outer CRM window. At viewport height ≤650px, on small screens with keyboard open, or where the available space would obscure the answer, fall back to a dock in normal flow. Never hide the last line/input/Next button behind it. Header scrolls normally on mobile; avoid double-sticky header+dock reducing reading space.

### Part and question navigation

Replace the right sidebar's 13 repeated text rows with four part buttons: Speaking, Vocabulary, Grammar, Listening. Show the selected part's group chips next to them on wide layouts and underneath on narrow layouts. Global group numbers: Speaking 1–3, Vocabulary 4–7, Grammar 8–11, Listening 12–13. Derive mapping from the canonical question array, retaining stable `questionId` values in data attributes. Group numbers are not individual blank numbers or score counts.

Click a chip using `nav-question` and existing guarded `goTo`; click a part to open its first group (deterministic, no new persisted navigation schema). Keep Previous/Next, flags, review shortcut and a full overview dialog. Current group remains identifiable with `aria-current="step"`, a 2px outline and orange bottom bar. Filled gray background indicates answered; partial has a distinct half-fill or dashed inner marker plus descriptive accessible name. Flag adds an amber flag icon and “Flagged” in the name independently of completion. Current/complete/flagged can coexist without one erasing another. Empty is white and numbered. Use `aria-label`, e.g. “Vocabulary, question 4, 1 of 4 blanks filled, flagged”.

Part controls are ordinary buttons inside a named navigation landmark, not a fake ARIA tab widget. Every group link is keyboard-operable in DOM order. Overview uses the existing dialog with grouped chips and state legend, focus containment, Escape close and focus restoration. Dialog state must survive harmless saving/timer updates. No hover-only navigation. Do not require the user to understand raw IDs such as `listen_write_q1__b8`.

## 5. Screen-by-screen specification

### S01 — Welcome / intro

Title and short lead occupy the first 120–150px of the content region. Beneath, a 60/40 split: left, four open rows, each with an orange two-digit part index, title, one-line task description and right-aligned group count; right, a “Before you begin” heading, two short practical instructions, the local-demo note and primary start/resume action. First row starts with a 2px top rule. Subsequent rows use 1px light rules; no four floating cards, duplicate “What you will see” headings or checklist repeating all four rows.

Keep accurate 3/4/4/2 group counts. Suggested lead: “Four parts. Work at your own pace and revisit any question before finishing.” Use existing demo policy, not a newly imposed test duration. Primary new-attempt action goes to mic check; label “Check microphone”. Returning attempt shows “Continue this demo”, saved completion count, and secondary “Start a new demo” with the existing confirmation. Starting over must not erase previous data through a global storage clear. Keep QA disclosure below, collapsed by default and stable across background saves. Welcome mobile becomes title → section rows → preparation/action; CTA fills available width.

### S02 — Microphone check

Title-first “Check your microphone”; one explanatory sentence. A max-840px stage has real instruction, quiet 44–64px high signal line, status at left and elapsed time at right while capturing, then actions. At idle show a flat line; while recording display measured input waveform without decorative bars. Ask permission only on explicit record action. The screen must support requesting, recording, processing, playable, denied/unavailable and retry states.

Idle: “Start recording” primary and existing skip action secondary. Recording: strong square stop control with text, elapsed timer, “Recording”; line follows the same capture stream. Processing: “Preparing playback…”; prevent duplicate actions while allowing the existing safe cancellation path. Playable: one native recorded-audio player and “Record again”, plus “Continue”; no duplicate duration caption. Denied: plain message with retry and the existing skip policy; no false passed indicator. Mic test must remain distinct from the three submitted-to-local-demo speaking takes. No new minimum duration or mandatory microphone policy.

### S03 — Speaking (all three passages)

Metadata: “Speaking · 1 of 3”; flag at opposite end. Inside stage: actual English/VI task instruction, full canonical `question.text`, recorder strip. Correct D01: the passage is required before the recorder for every question. A fixture/data parity test alone is insufficient. First desktop passage should fit comfortably without oversized 24–28px body type; long third passage grows naturally.

English guidance proposal: “Read the passage aloud clearly and naturally. You can practise before recording.” Preserve existing Vietnamese guidance and English passage text in both locales. This sentence is instructional UI copy, not altered assessment content.

Idle recording region uses a measured quiet line and one clear Record action. Recording has Stop and elapsed time; retain visible passage, focus and scroll while time changes. Saved has one player and “Replace recording”. Replacement keeps the previous committed take until the new processed take is successfully stored. Failed processing/commit shows retry/recovery while retaining the valid old take. Next, Previous, dock and review all pass through the existing recording-navigation guard. Hide Previous on the first group; do not display a nonexistent question 0. No invented countdown, retake cap, scoring or phoneme feedback.

### S04 — Vocabulary (four groups / 15 blanks)

Metadata then instruction: “Choose the best word for each blank.” Render full original passage inside the single stage with native inline selects at original blank locations. Selected values use gray fill, dark text and standard dropdown chevron, never a tick or green correctness treatment. Blank visible placeholder is localized “Choose…”; accessible name includes part, group and blank ordinal, with stable `for`/`id` links.

Keep original option order/content and stable blank IDs. Controls min-height 44px, min-width approximately 9ch; allow long selected options to consume more width up to available line width, and verify the longest canonical choice is readable. Do not silently truncate the selected answer; native popup must expose full option labels. At narrow widths, a select wraps naturally with its nearby sentence. No new detached answer column or custom popup architecture. Passage does not jump to a rail after every answer. Part/group progress updates without losing focus or scroll.

### S05 — Grammar (four groups / 15 blanks)

Use the same stage and controls as vocabulary; the distinction comes from section title and instruction, not a new color/theme. English guidance: “Choose the correct form to complete the passage.” Maintain full original grammar text, blank positions and options. The longest grammar passage is a required responsive fixture; no shortened design text. Reuse styles and semantic control states; do not create a separate component with inconsistent border/height/focus behavior.

### S06 — Listening (two groups / 15 blanks)

Order: metadata, instruction “Listen to the recording and type the missing words”, simple transport, full passage with inline text fields. Transport is an open horizontal strip, separated by one rule: Play/Pause, real range, elapsed/total time, speed 0.8/1/1.2×. No decorative waveform. At narrow widths, range/time wrap to a second row; never shrink hit targets. Failed media displays Retry beside the affected transport while retaining all entered text.

Bind visible seek/progress attributes consistently (D08). Keep the same audio element and currentTime/playbackRate across answer typing, focus changes, text-size changes and save-status updates. Resume labels match actual media state. Navigating away stops audio and releases view-specific bindings according to the existing lifecycle. No autoplay. Empty input is white, entered text gray-filled with visible value; matching “filled” semantics to vocabulary/grammar does not signal correctness. Preserve IME composition/caret and exact strings across reload.

### S07 — Review / partial / ready / saving / failed

Title “Review your answers” with one summary sentence. Below, four full-width open section rows, each with section label, group chips and **explicit unit** count: “3 recordings saved”, “13 of 15 blanks filled”, etc. Desktop rows use 180px label / flexible chips / 180px count; narrow layouts stack label+count over chips. No 13-card red grid and no raw-ID link wall.

All groups remain reachable, including complete flagged groups. If blanks are missing, give one actionable row per incomplete group, e.g. “Vocabulary · Question 4 — 2 blanks missing”; use a native disclosure for individual “Blank 2”, “Blank 3” links. Those links preserve `data-question-id`/`data-blank-id` and focus the exact native control. Show individual missing controls on demand, not 45 verbose links by default. Keep one aggregate missing summary.

Preserve existing finish policy: missing speaking prevents finish; written omissions require acknowledgement; flags are advisory. Acknowledgement label includes remaining count and invalidates according to existing state semantics when answers change. Disable Finish while required recording/save processing is unresolved and provide its reason in adjacent text. On final submit show “Finishing…” and prevent duplicate activation. Persist/flush and local transaction precede the success state. On failure keep this review, answers and retry action; never replace it with a success receipt. No second generic confirmation modal after this explicit review.

### S08 — Done / receipt

Same black header and orange title marker, without editable task dock. Title “Demo complete”. Short statement distinguishes completion in this browser from a learner submission/score. One square 2px receipt region, max720px: actual receipt identifier, existing committed timestamp formatted in the user's locale, response counts if derivable from the committed draft. Long receipt identifiers wrap. Use Noto tabular numerals; do not show green scored-answer styling or invented score/results/delivery promises.

Reload must recover the same committed receipt. Keep the existing “Open the saved receipt” behavior; do not add a new submission/download mechanism. A direct evaluator Done preview without a committed receipt must explicitly say “Completion preview — no receipt saved” and avoid presenting an empty reference as successful submission. Memory-only fallback must say “Demo complete for this session — not saved in this browser”; do not inherit the current optimistic saved label without confirming durable storage. Normal answered content remains frozen in the receipt flow. QA return/reset remains in its existing deliberate entry point.

## 6. Cross-screen states and accessibility

| Component | Required states and appearance | Interaction contract |
|---|---|---|
| Primary / secondary actions | Default, hover, pressed, focus, disabled, busy. Black primary/white text/static orange offset; secondary white/charcoal outline. Disabled gray with visible reason when consequential. | Same min target; focus 3px orange outline offset3 on white, white outline on black. Do not use transform movement that shifts controls. Busy label preserves width and existing click guard. |
| Filled/empty answer | White empty; gray filled; dark text and native indicator. Focus distinct from answered; no success check. | Semantic label survives rerender, selected value and composition survive saves/navigation. |
| Group chips | Empty, partial, complete, current, flagged and combinations. | State conveyed in accessible name and shape/text; no color-only distinction. Current key not overwritten by flag. |
| Persistence | Dirty/saving, committed, error+retry, memory-only, conflict/recovery. | One polite status region; no timer announcements every 250ms. “Saved” only when relevant durable operation completes. Errors remain discoverable and do not clear work. |
| Audio | Idle, permission pending/denied, recording, stopping/processing, saved/playable, playing/paused/ended, replacement, failure/cancel. | One capture stream, explicit stop/dispose, take guard/revision-aware commit retained; stop all tracks on cancellation/navigation/unload. No duplicate player lifetime. |
| Overview / details | Closed/open, keyboard focus, close/Escape, empty/partial/flagged content. | Focus trap only while modal; restore invoking control; save/media ticks must not close it. |
| Completion | Preview, pending commit, committed receipt, failed commit, memory-only. | No misleading success; one persisted receipt on repeated finish/reload. |

Headings and controls have natural reading order and visible labels. Use the existing native audio player for recorded takes; do not replace it with inaccessible SVG controls. A visual mic line has textual status and is not the sole indication of recording. Announce state transitions politely, not waveform samples/elapsed updates. Respect prefers-contrast and forced-colors: outlines/current/flag remain meaningful without background fills. Dialog close button and all dock buttons meet 44px targets.

## 7. Responsive and motion rules

| Available demo viewport | Composition and controls | Acceptance |
|---|---|---|
| 1440×1000 / 1280×900 | Max1120 body; 64px header; welcome split; one-column task stage; single dock row when all controls fit. | No huge unused sidebar; actual task instruction/first content visible above fold. |
| 1024×768 / 1000px boundary | 24px gutters; task stage remains single column; dock may use two rows. | No breakpoint gap that hides both navigation forms. |
| 768×1024 | 24px gutters; welcome stacks; tools wrap; dock parts above group chips. | Native selects and long labels fit; modal fully reachable. |
| 390×844 / 360×800 / 320×740 | 16px gutters (12px at320 if necessary), 16px stage padding, 44px targets, title28, instruction18. Parts wrap in two columns if labels cannot fit; chip row at most four per section. | `scrollWidth <= clientWidth` throughout; no `overflow-x:hidden` masking a defect. Footer/status text wraps. |
| CRM embed | Test actual host iframe width and 760px/620px heights from existing CSS; also isolated 900×760, 640×620 and 390×620 iframe harness. | Breakpoints based on iframe viewport; no parent-window assumptions; iframe and rating column usable without overlapped controls. |
| Text130%, browser zoom200%, mobile keyboard | Let type reflow and controls increase in height; short-height dock in normal flow. | All text visible, active input/caret reachable, focused control not hidden by shell/dock. Real browser zoom and hardware soft keyboard recorded separately. |

Only border/background/color transitions, 120ms ease-out; no page slides, parallax, pulsing shadows, confetti or synthetic waveform. Dialog may fade opacity120ms, with instant focus placement. Under reduced motion: disable optional transitions, animated scrolling and decorative line animation; provide static input level/status updates without losing recording feedback. A real waveform can update at ≤30fps while capture is active; stop sampling on stop/cancel/hidden/dispose. Media and timer updates mutate their own nodes rather than rebuilding the full task tree. This is a bounded lifecycle correction, not a state-store rewrite.

## 8. Protected contracts and visual revision

Preserve 13 group IDs, all three exact read-aloud texts, all 45 blank IDs/options/text fragments and listening URLs. Fix English **instructional copy** in `copy.js`, not by editing content fixtures. Preserve VI guidance, Noto font assets, current draft schema/content version, active attempt key, IndexedDB database/store names, take replacement commit controller, answer/flag mappings and local receipt transaction. No scoring, upload API or learner-link changes. Shared DSP remains unchanged and recorded audio still passes through its enhancement pipeline.

Keep `REVISION_ID = academic-noto-v1` as the existing draft/bridge compatibility value for this visual-only iteration; changing it would currently put old drafts into recovery. Introduce a separate display-only `data-visual-revision="signal-noto-v2"` on D's shell and record it in the candidate evidence. Do not conflate a visual revision with storage schema. CRM label may become “D · Signal Noto”; URL and bridge compatibility stay intact. The visual marker does not solve historical rating provenance by itself.

Before coding, reread rating counts without writing. Today's zero-D snapshot permits an uncomplicated local redesign comparison. If D scores have appeared, preserve every value and snapshot its prior visual attribution externally. Continue local visual work, but list any requested future re-rating/version separation as an explicit evaluation/release decision; do not silently overwrite, migrate or pool historical D scores as new-design evidence. A/B/C files, all `a:*`/`b:*`/`c:*` values, any `d:*` values and font-vote arrays stay byte/semantic equivalent. The matrix remains four skins × eight pages × five criteria =160, with only explicit star actions writing ratings.

Host preview, page navigation, return-to-A/B/C behavior and Noto reset must be tested in the synthetic evaluator. Do not broaden this task to redesign the CRM shell, change its rating semantics or migrate the Firestore schema. If a bridge/preview regression is reproduced, report the exact failing contract and seek a bounded scope extension before editing protected persistence/security modules.

## 9. Exclusive file ownership and execution inventory

The separate Luna X High implementation task is the only product writer and owns its browser/server during this Light-route package. The originating root retains architecture and final audit responsibility. No workers or nested agents. Preserve others' work; if the user later selects Heavy, ownership must be released and reassigned explicitly before any concurrent writes.

Create a fresh isolated `codex/entrance-test-d-visual-redesign` worktree from the verified release SHA (or a explicitly reconciled newer base). Do not switch/reset the shared dirty checkout or edit the release checkout. Copy/reference this approved plan into the new worktree only under its declared docs path. Before product changes, write an external execution contract and snapshot using the structure checker; declare these exact paths, not wildcard directories.

| Path relative to candidate root | Operation / owner responsibility |
|---|---|
| `public/entrance-test-ui/index.html` | Modify: implementation task shell semantics, skip link, visual marker, nonduplicated footer. |
| `public/css/entrance-test-ui.css` | Modify: implementation task all tokens/layout/states/responsive/motion, retained class compatibility where useful. |
| `public/js/entrance-test-ui/view.js` | Modify: implementation task eight screens, grouping/navigation, readable labels, actual passages and status rendering. |
| `public/js/entrance-test-ui/copy.js` | Modify: implementation task EN section instructions, VI equivalents for new UI controls, precise count/preview/error copy. |
| `public/js/entrance-test-ui/app.js` | Modify: implementation task section-navigation adapter, focus/details preservation, transient updates and media bindings, truthful completion status. |
| `public/js/entrance-test-ui/audio.js` | Modify: implementation task scoped analyser lifecycle and state UI support on existing stream; preserve recording/DSP contract. |
| `public/js/crm/entrance-test-ui-lab.js` | Modify: implementation task D display label only unless a specifically declared host integration need is established. |
| `tests/entrance-test-ui/view.test.mjs` | Modify: real instruction/passage, review labels/targets, all state rendering and semantic contracts. |
| `tests/entrance-test-ui/audio.test.mjs` | Modify: measured-line resource cleanup and retained audio transitions. |
| `tests/entrance-test-ui/host.test.mjs` | Modify: D label expectation only; retain routing/rating protection assertions. |
| `tests/browser/entrance-test-ui-demo-check.py` | Modify: extend existing Chrome acceptance harness with cases below and targeted redacted artifacts. |
| `docs/audits/entrance-test/2026-09-13-demo-d-visual-execution.md` | Create: implementation task final candidate report with verified/pending statuses and evidence pointers. |

No deletes or renames. No package dependency/script change expected: existing unit suite already runs view/audio/host tests; existing browser command runs this harness. If the final candidate requires another file, update the external contract before editing and explain why; do not hide it inside a broad output declaration. `state.js`, `persistence.js`, `demo-data.js`, `qa.js`, font files, A/B/C lab/font catalogue, global CRM CSS/HTML, learner pages, Functions/routes/scorer, shared DSP, Firebase configs/rules and Projects files remain protected. Source-level guard defects outside these bounds are reported, not silently repaired.

`agent_docs/project_progress.md` and `latest_session_work.md` remain untouched in the Light route. Do not edit the old reports to make historical outcomes look different. No automatic Git push, hosting command, rating write or deployment tagging.

## 10. Ordered execution tasks

### Task 0 — Freeze the approved baseline and contract

Verify clean release SHA, live relevant assets if drift is suspected, approved visual direction/lineup, before ratings/font values, and current source assets. Create isolated worktree and external contract/snapshot; inventory protected hashes and stored synthetic fixture. Expected artifact: baseline manifest with exact base SHA and declared paths. If another base already changed D, reconcile actual diffs before applying this plan.

### Task 1 — Capture the failing presentation contracts

Extend `view.test.mjs` with canonical three-speaking-passage DOM assertions; four English instruction assertions; review labels with exact target IDs and complete flagged question access. These must expose D01/D02/D03 before implementation. Add proportionate Chrome assertions for 390px overflow and focus-preserving saving; record baseline failure evidence externally. Do not keep known defects by converting assertions to screenshots only.

### Task 2 — Establish shell and C tokens

Modify shell/CSS only for the common frame and tokens, preserving boot IDs. Render welcome, one speaking stage and review in the candidate with real source content. Verify Noto weights, dark header, square outline, orange marker and correct computed tokens at 1440/390 widths. Expected artifact: one coherent C-derived skeleton, not three alternatives. Do not claim aesthetic acceptance from this intermediate state.

### Task 3 — Recompose task views and copy

Update `view.js` and `copy.js`: full speaking text, real localized instructions, vocabulary/grammar/listening single-stage layout, clear inline labels and consistent answer states. Preserve data attributes and IDs used by application bindings. Correct duplicate duration/header/footer text. Run focused view/content tests. Expected artifact: all actual tasks visible and readable, same normalized content hashes.

### Task 4 — Compact navigation and review

Use existing stable IDs/actions for dock, Previous/Next, overview and missing-blank links. Add section navigation mapping in app without changing state schema. Make all complete/partial/flagged groups reachable in review, hide raw IDs in visible text, and preserve finish/ack policy. Test active/flagged/current combinations and exact blank focus at each part boundary. Expected artifact: navigation/review that handles real 13-group/45-blank content at all stated widths.

### Task 5 — Recorder/transport/transient lifecycle

Implement a measured mic line using the current capture stream, with injected/testable Web Audio factories where needed. Stop/close analyser resources safely without interfering with take processing. Use targeted text/canvas/status updates for timer ticks and saving; preserve active DOM nodes for audio, editing, dialogs and QA disclosures. Align seek selector and transport events. Prove failed replacement retains old Blob and typing does not restart playback. Do not bypass the DSP or duplicate getUserMedia to animate a line.

### Task 6 — Completion and exceptional states

Render genuine committed receipt, evaluator preview without receipt, pending/failure and memory-only variants. Ensure status reflects durable versus session-only completion, including reload. Render all persistence/permission/audio failure states and recovery with plain copy; keep failed work visible. Expected artifact: S01–S08 and every state from section6 have inspectable behavior and screenshot identity.

### Task 7 — Responsive and accessibility pass

Apply breakpoint rules and reduced motion; test keyboard-only traversal, dialogs, native controls, 130% text, real Chrome200% zoom, short iframe heights and long VI copy. Repair geometry/focus defects at their source. No blanket overflow clipping, no duplicate hidden controls, no font replacement. Expected artifact: viewport/state acceptance record and explicit human/device items still pending.

### Task 8 — Evaluator and frozen-candidate acceptance

Update D label in host and its test. Run synthetic evaluator preservation checks, then all focused suites below once on the settled candidate. Inspect screenshots beside current C and current D at identical sizes. Reconcile actual paths/index against contract and protected hashes; produce execution report. Present all eight screens and representative mobile/recorded/review/error states to the user for visual acceptance. No merge, push or deployment follows automatically.

## 11. Chrome acceptance matrix

Use case IDs in JSON and report; screenshots carry source SHA and `signal-noto-v2`. Baseline audit observations are not candidate passes.

| Case | Required check and pass condition |
|---|---|
| VIS-01 | A/B/C and old-D/new-D same-viewport comparisons: all five C features from section2 are visibly retained on welcome/task/review/done. User approves full eight-screen result; automated CSS assertions support but cannot replace that judgement. |
| VIS-02 | All eight page routes in CRM and standalone; full 13-group traversal. Header, stage and dock align, no nested cards, no missing task actions, no abbreviated passages. |
| TXT-01 | Visible speaking DOM exactly matches all three canonical `question.text` values. Vocabulary/grammar/listening text fragments, 45 blank IDs and options match fixture; compare both data and rendered controls. |
| TXT-02 | EN task pages display actual instructions; VI shows correct guidance without altering passage/answers. Noto400/500/600 font faces load for Latin and Vietnamese; verify representative rendered font via Chrome/CDP where available, plus font requests/document.fonts. |
| NAV-01 | Every global group1–13, all four part controls, previous/next boundaries, flags and review work with keyboard and pointer. Current+complete+flagged state remains distinguishable. Nav uses existing recording guard. |
| NAV-02 | Partial review has four section summaries and compact group controls; exact missing links land/focus the correct blank. Complete flagged groups remain reachable. Counts name units accurately. No raw internal IDs visible. |
| INP-01 | Real longest passages and option values at320/360/390/768/1024/1440; empty/filled/focus states work, values readable. Keyboard selection/IME composition and mid-string caret do not jump after save. |
| MIC-01 | Permission start/deny/retry, idle/recording/stop/processing/playback; measured silence/known fake tone produces distinct line samples. One stream; cancel/navigation/stop/unload leave no live tracks/RAF/analyser resources. Fake tone is not human sound-quality proof. |
| AUD-01 | Record/process/DSP/play/replace; force replacement failure and preserve old take; return/reload restores correct stored Blob/ref. Timer ticks do not move focus or remount recorder controls. |
| AUD-02 | Listening play/pause/seek/rate/ended/retry; while audio plays, type and change answers and settings. Audio node/currentTime/rate continue as expected, progress follows time, no duplicate playback. Navigate away stops old media. |
| SAV-01 | Dirty→saving→committed/error/retry/memory-only and cross-tab revision conflict. Refresh restores exact text, flags, settings and selected group. Each status claim matches actual storage outcome; repeated announcements suppressed. |
| END-01 | Missing speaking blocks finish; written omissions need acknowledgement. Flush pending edits, double-click Finish, failure/retry and reload: one committed receipt, correct draft revision, no premature done. Direct evaluator done preview and memory-only completion are labelled truthfully. |
| A11Y-01 | Keyboard-only entire flow, visible focus, native select/range names, heading/landmark order, modal Escape/focus restore, one save live region. Saving/time updates preserve open details/dialog and focused controls. |
| RSP-01 | All S01–S08 at390×844; representative longest/failed/review states at320/360/768/1024/1440, text130%, Chrome200% zoom, 900×760/640×620/390×620 iframe. No horizontal overflow or obscured focus. No CSS zoom substitute. |
| MOT-01 | Reduced-motion and forced-colors: no unnecessary transitions; current/filled/flag/focus still discernible. No decorative listening waveform. |
| HST-01 | Synthetic evaluator: four skins and160 criteria; old A/B/C records and fonts identical before/after D interaction, D-only explicit star action, ordinary demo interaction writes zero ratings. Existing frame route/bridge ID unchanged; visual revision recorded separately. A/B/C route and preview behavior unchanged. |
| HST-02 | D font preview/reset and page chips round-trip; change skins during a pending render/save and ensure rating attribution is unchanged. If baseline bridge failures surface, report the actual condition and scope any fix explicitly. |
| ISO-01 | No learner API/scoring/upload requests, no production rating writes, no backend/deploy changes. QA helpers remain accessible, reset limited to owned candidate attempt/store in isolated synthetic context. |

Do not label a screenshot-only inspection as a behavior pass. Use assertions against source content, DOM, media time, tracks, stored/reloaded state and synthetic host writes. Required manual follow-up: listen to a real mic test/recording; real mobile soft keyboard; user visual review. Report pending status until actually done, without blocking all independent automated work.

## 12. Verification commands and evidence

Run commands from the isolated candidate root. Existing browser harness owns a local server and generates its fake microphone fixture; no CRM login needed for its synthetic host.

```powershell
npm run test:entrance-test-ui
npm run lint:crm
python -X utf8 tests/browser/entrance-test-ui-demo-check.py --case all --output '<external-execution-dir>/chrome'
npm run test:structure
git diff --check
node scripts/structure/check.cjs check --base <verified-candidate-base-sha> --contract '<external-execution-dir>/structure-contract.json' --snapshot '<external-execution-dir>/structure-before.json' --json
```

Expected: exit0 with the new and existing focused assertions passing, no new structure violations, clean diff whitespace. Unit test count will increase beyond the original26; do not hardcode the historical count as a success requirement. Run targeted tests during edits; once the settled candidate passes, do not repeat broad suites without a new change/failure.

Inspect `node scripts/crm/verify-crm-suite.js --list` and the registered effects before running the applicable `npm run verify:crm` aggregate. Current structure policy declares `remote-write` among its effects. Use the established local/emulator configuration if it keeps all writes synthetic. If the aggregate requires real remote mutation or unavailable services, record exact blocked commands and cause; do not run it against production or claim full CRM validation from the focused host fixture. Do not invent a fake “safe mode” flag. Product/API tests are not necessary for this documentation-only planning turn; they apply to execution.

For an actual authenticated CRM Chrome check, first read `C:/Cursor AI/.local/browser-test-credentials.md`, use its admin account and never copy credentials into tests/reports/logs. This plan authorizes no live rating action. Start with local Python Playwright; use the `browser-agent` workflow afterward only if live confirmation or richer interactive evidence is needed. This audit used local Playwright plus live GET/hash comparison, not a second authenticated browser workflow.

Evidence manifest: exact SHA/branch/worktree, visual revision, file hashes, Chrome/Python/Node versions, timezone timestamps, viewport/iframe size/text-scale/actual zoom, input fixture identity, test commands and exits, per-case pass/fail/blocked, console/request failures with secret redaction, representative screenshots, persisted state checks and protected-file delta. Retain source worktree/evidence until user acceptance and integration decision. The only authored report is the exact execution-doc path from section9; bulky traces/media stay in declared external storage.

## 13. Approval and completion boundaries

Planning complete means evidence, this specification and reference artboards are ready for review. It does not mean the design is approved or any product defect fixed. User approval unlocks the bounded implementation inventory and proposed Luna X High / separate task / Light / Standard / no-subagent lineup. If diagnosis becomes difficult after meaningful failures, recommend Astra High/X High for discussion as required; do not pretend settings changed.

Implementation complete requires all scope-appropriate automated acceptance, truthful pending manual/device checks, actual code/structure audit, and all eight redesigned screens delivered. User visual acceptance is separate. Merge/integration, production learner adoption and deployment are separate future instructions. No push/deploy is authorized here.

Local rollback: retain the candidate branch and evidence, and revert only this candidate's allowlisted visual changes if requested. Do not clear shared storage, delete rating documents, reset the shared worktree or erase original D evidence. Keep earlier ratings and reports for comparison.

### Copyable executor handoff

> After the user approves this plan and lineup, implement `docs/plans/2026-09-13-entrance-test-demo-d-visual-redesign.md` in an isolated worktree based on verified release SHA `3157c6c40eb7669e9ee22f339877ac668feaa92c`, reconciling drift first. Use Luna X High in the separate implementation task, Light route, Standard speed, no subagents. Preserve C's dark header, strong square structure, burnt-orange signal and numbered rhythm; use white canvas, Noto Sans, D's inline answers and local persistence. Follow S01–S08 and the reference artboards, but render complete canonical content. Fix observed missing speaking text, generic English instructions, raw review IDs, mobile overflow, redundant duration and transient/media-binding problems within the declared inventory. Preserve current storage/content/bridge compatibility and record a separate visual revision. Protect all historical ratings, votes, A/B/C, QA helpers, learner/backend contracts and unrelated work. Execute tasks0–8 and Chrome cases with concrete stored-state/media evidence. Present all eight screens for visual approval; report pending human/device checks honestly. Do not push, deploy, or modify the unrelated root implementation plan.


**Final routing direction:** The originating task requested a separate Luna X High implementation task. This supersedes the earlier proposed Astra execution lineup for this handoff. Do not create that task or start product work from this planning task. If the lifecycle work exceeds the bounded plan or fails meaningfully, return concrete failure evidence to the originating root for a scoped escalation decision.
