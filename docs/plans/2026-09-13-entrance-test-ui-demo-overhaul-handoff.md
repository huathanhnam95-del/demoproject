# Entrance Test UI Demo D Overhaul — Execution Handoff Plan

> **For the executor:** load the `executing-plans` skill and execute the bounded tasks below after execution authorization. Workspace route, model, scope and approval rules take precedence over generic skill instructions. This handoff does not start implementation.

**Goal:** deliver a complete, polished fourth Entrance Test UI demo in the existing CRM evaluator that applies the evaluator PDF's interaction and aesthetic feedback, defaults to Noto Sans for English and Vietnamese, preserves intentional QA helpers, retains ratings, and demonstrates reliable answering, recording recovery, navigation and final review.

**Architecture:** add Demo D as a fourth rated design beside the existing A/B/C demos in the same CRM evaluator, while its focused browser modules and durable local demo storage remain independently testable. Reuse the production question/blank identifiers and audio DSP interface so later integration has clear boundaries. Extend only the evaluator's additive skin/rating contract; existing live learner code, APIs, scoring, historical A/B/C rating values and Projects styles remain outside this implementation package.

**Tech stack:** existing HTML/CSS/JavaScript; native browser controls; ES modules for the new candidate; IndexedDB for local demo drafts/audio; existing `AudioDspPipeline`; installed Chrome via Python Playwright; Node built-in test runner. No framework or new application dependency is required.

**Plan status:** detailed proposal updated on September 13, 2026 so the new design is rated as Demo D alongside A/B/C and defaults to Noto Sans for both English and Vietnamese; no code implementation, push or deployment has been performed. `ArtifactMetadata: { RequestFeedback: true }`.

**Plan location:** `C:/Cursor AI/docs/plans/2026-09-13-entrance-test-ui-demo-overhaul-handoff.md`. The unrelated root `C:/Cursor AI/implementation_plan.md` is owned by another active task and must not be overwritten. If an executor creates or updates any file named `implementation_plan.md`, the workspace's final-tool-call approval gate applies.

## 1. Decisions and scope that the executor must retain

| Topic | Decision for this package | Basis |
|---|---|---|
| Demo purpose | This is a UI demonstration and evaluation environment. | Explicit user correction. |
| QA answers and shortcuts | Keep fill-all, partial-answer, navigation and completion helpers available for testing. Do not remove or disable them as security cleanup. | Explicit user correction. |
| Answer-key exposure | Defer isolation/removal of real keys to a separately authorized live-release package. It is not a blocker for this demo. | Explicit user correction. |
| Typography | Demo D defaults to genuine Noto Sans for all UI copy in both language modes, English passages, controls and numerals. | Explicit request to default the fourth demo to Noto Sans for both English and Vietnamese. |
| Aesthetics | White/light, limited accents, flat sections, clear hierarchy, simpler controls and compact navigation. | Original PDF, with Noto replacing its earlier font preference for this iteration. |
| Persistence/review | Demonstrate honest save states, recoverable recordings, stable question identity and one final review. | User accepted point 3 of the audit response. |
| Assessment policy | Keep policy decisions separate from the visual overhaul. No new free-response task, countdown or retake cap. | User accepted point 4. |
| Evaluation | Test realistic learner tasks and collect structured observations. | User accepted point 5. |
| Existing alternatives | Preserve A/B/C and every existing `a:*`, `b:*` and `c:*` rating value as historical baselines. | Prevent the fourth design from changing what old ratings refer to. |
| Rating identity | Add the new design as `d` in the existing eight-page, five-criterion rating matrix. The required rating count becomes 160 (`4 × 8 × 5`); existing 120-score raters retain their A/B/C work and complete only the 40 new D scores. | Explicit request to keep ratings and make this the fourth demo. |
| Font evaluation | Keep existing saved font votes unchanged. Demo D opens with Noto Sans for Vietnamese UI and English passages; selecting a temporary evaluator font preview may override it, while clearing the preview restores Noto. Noto is not auto-voted for the rater. | Separates the requested visual default from historical font-vote data. |
| Current deliverable | Demo D available as the fourth rated design in the CRM UI evaluator and as a standalone page, with tests and an execution report. | Explicit user clarification. |
| Production integration | Document interfaces and unresolved production decisions; do not wire real attempts, uploads or submissions in this package. | Demo scope; publishing is separately authorized. |

**Execution lineup proposed:** Astra Medium root, Light route, Standard processing, no subagents. Confirm this lineup when the implementation project begins unless already explicitly approved for this package. Do not inherit CRM Projects' Fast exception or silently switch the conversational reasoning level. Use the workspace's evidence-based escalation policy if needed. These task breakdowns are sequencing instructions for one executor, not permission to delegate.

### Defaults that keep demo execution unblocked

- English guidance is the proposed initial demo default, following the PDF's English-only preference. Retain Vietnamese guidance through a compact `EN / VI` toggle for comparison and accessibility to current learners. Task passages stay English in both modes. This demo default does not settle the production language policy.
- Noto Sans is Demo D's initial rendered family for English guidance, Vietnamese guidance, task passages, controls and numerals. The evaluator may temporarily preview another catalogue font, but selecting Demo D with no explicit D preview and clearing a D preview must return both language roles to Noto Sans.
- Three speaking passages are **read aloud**, followed by four vocabulary passages, four grammar passages and two listening passages. Total: 13 groups, 45 written blanks, three recordings.
- No overall timer. Speaking displays elapsed recording time. Unlimited replacement of a recording remains available in the demo.
- Free navigation and flags remain available, as in the current lab. This is not an implicit approval to change production navigation policy.
- Mic check supports record/playback and an explicit skip action in the demo. Do not enforce a three-second pass requirement or speech-amplitude threshold as a test gate.
- Keep the lab's replay/speed capabilities available for comparison: the verified current `RATES` set is `[1, 0.75, 1.25]`, with 1× initially selected. Recheck and preserve it in the demo. Do not infer production playback policy from it.
- Written blanks may remain empty at final demo submission after an explicit review acknowledgement. A recording still processing or a failed/uncommitted save is not equivalent to an intentional blank.
- Save copy says **“Saved in this browser”**, never cloud-saved/uploaded. The done screen clearly describes a demo submission, without claiming a real link was locked or a teacher was notified.

## 2. Verified sources and preflight context

Inspection baseline: `d188648e36ef0c505951fdb622536654051adb82` in `C:/Cursor AI`. Reverify the execution checkout; do not assume this SHA remains current.

| Source | What to read/use | Constraints |
|---|---|---|
| `C:/Cursor AI/docs/entrance-test-ui-analysis.md` | Original synthesis and initial redesign suggestions. | Its “Complete & Audited” conclusions require the corrections in the audit. This file was untracked at handoff inspection; a fresh worktree may not contain it. |
| `C:/Cursor AI/docs/audits/entrance-test/2026-09-13-ui-claims-audit.md` | Verified claims, current-version distinctions, behavior evidence, and the user's subsequent scope correction. | Also untracked at handoff inspection; copy only this exact source if absent in the worktree. |
| `C:/Users/Admin/Downloads/Entrance Test.pdf` | All 15 pages; view annotated screenshots as well as extracted text. | Local evaluator material; no need to copy it into Git. |
| `C:/Users/Admin/.codex/audits/entrance-test-ui-20260913-01a09829/` | Original audit evidence: source hashes, ratings, PDF renders/text and 40 Chrome snapshots. | Historical evidence, not proof the new implementation passes. |
| `C:/Cursor AI/public/entrance-test-ui-lab.html` | Shared A/B/C engine; content around `SECTIONS`; QA panel; mic/recording; navigation; local storage; host bridge. | Preserve as baseline, including intentional QA functionality. |
| `C:/Cursor AI/public/js/crm/entrance-test-ui-lab.js` | `SKINS`, `NEED_RATINGS`, `frameUrl`, `renderSkinBar`, `renderRateTab`, results aggregation, `post`, page-message listener, `onClick`, `CrmEntranceTestUiLab.boot`. | Add Demo D and its additive `d:*` keys; preserve all existing A/B/C keys, values, criteria and Firestore document identities. The completion denominator becomes 160. |
| `C:/Cursor AI/public/js/entrance-test-ui-fonts.js` | Existing historical font catalogue. | Keep the catalogue and saved font votes unchanged. Demo D owns its local Noto default; do not auto-vote Noto or rewrite saved choices. |
| `C:/Cursor AI/public/css/crm-projects.css` | Lines 1–27 declare local Noto Sans 500 subsets; around lines 371–374 the Projects panel uses Noto Sans, weight 500, `font-synthesis: none`. | Font reference only. Do not import this entire stylesheet or change Projects. |
| `C:/Cursor AI/public/fonts/NotoSans-Medium-vietnamese.woff2`, `NotoSans-Medium-latin-ext.woff2`, `NotoSans-Medium-latin.woff2`, `NotoSans-OFL.txt` | Verified existing Projects font files and license. | Only weight 500 is declared currently. Do not relabel one static face as 400–700. |
| `C:/Cursor AI/public/entrance-test.js` | `buildSteps`, `renderParts`, save/restore, `prepareEntranceTestBlob`, `submitSpeaking`, `finalizeSubmit`. | Read-only production boundary. Old drafts use ordinal `stepIndex`. |
| `C:/Cursor AI/functions/src/entrance-test/test36plus.js` | Canonical prompts; `buildPublicSession`; blank IDs; scoring contracts. | Read-only; never import Firebase/server modules into the browser. Blank IDs are `${questionId}__b${index}`. |
| `C:/Cursor AI/public/js/audio-dsp-pipeline.js` | `enhance(rawBlob, options)` return contract and existing failure fallback. | Reuse without modifying shared DSP. Its result is an object containing `wavBlob`, not a Blob directly. |

Current finding to fix in the candidate: all skins share the same engine; B has white content with dark header chrome; navigation is persistent on desktop and a drawer below 860px; the rail stacks below the passage below 1000px. Do not design against an assumed full-screen dark B or an independent C architecture.

### Worktree and source transfer

1. Read the workspace instructions, `agent_docs/project_structure.md`, and `docs/AGENTS.md` in the actual execution checkout. Stay on the Light route unless the user changes it.
2. Record current HEAD, index status and targeted hashes. The shared checkout has unrelated Projects/other work; preserve it.
3. Create an isolated branch under `codex/`, for example `codex/entrance-test-ui-demo-overhaul`, in an unused, verified directory such as `C:/Users/Admin/.codex/worktrees/entrance-test-ui-demo/Cursor AI`. If the path/branch exists, inspect it; do not reset or remove it.
4. Base the worktree on the agreed source revision. Read-only comparison must identify any newer entrance-test changes before choosing the base. Do not copy the entire dirty shared checkout.
5. Ensure this handoff, the exact original analysis file and the exact audit file are accessible. Copy those named documents if absent, keeping provenance; do not bulk-add the docs directory or audit evidence.
6. Before coding, record the execution contract and before snapshot outside Git, with the exact path inventory in section 7 and an execution-specific external evidence directory. Record any necessary path change before touching it.
7. If source evidence materially differs, amend this handoff's affected decision and report the discrepancy. Routine layout choices within the specification do not require repeated approval.

## 3. PDF feedback translated into design requirements

This matrix is the visual acceptance authority for the candidate. The report's inferred hex colors, exact sizes and mandatory timing are not attributed to the evaluator.

| PDF pages | Actual feedback | Candidate treatment | How to verify |
|---|---|---|---|
| 2 | Prefers C, Be Vietnam Pro/Literata, white background, black text and only one or two other colors. | Keep clear grouping, but use an open white layout with soft dividers and a restrained blue accent. Trial Noto Sans per the newer user instruction. | Whole-screen inspection: no beige canvas, black structural outlines, offset shadows or many competing accents. Verify font actually rendered. |
| 3 | Remove redundant intro eyebrow; prefers all-English UI. | Remove “SẴN SÀNG BẮT ĐẦU”. Move the title upward. Start with complete English guidance; retain Vietnamese as a compact optional toggle. | Title is the first major content; switching language changes instructions and controls without changing answers or passages. |
| 4 | Remove preparation eyebrow; prefers a flat line when quiet and peaks when speaking; playback seems absent. | Remove “BƯỚC CHUẨN BỊ”. Add a quiet time-domain line visualizer and real record/stop/playback controls. | Silence produces a stable baseline; fake input animates; a real short take can be replayed. Human playback quality is checked separately. |
| 5 | Instructions should be larger and bold; question text should be smaller. | The actual task instruction receives semibold 20px desktop text; passage text starts at 18px regular. On mobile use 18px semibold instruction and 18px regular passage, with clear spacing. | Inspect instruction wording, not just a “Speaking 1/3” metadata label. Compare instruction hierarchy with the paragraph. |
| 6 | Recording duration caption is redundant. | Retain duration in the audio player; remove a second explanatory duration sentence. Keep processing/error messages where useful. | One duration presentation after recording, with a distinct elapsed timer only during recording. |
| 7–8 | Exam UI screenshots offered as hierarchy references. | Use compact task metadata, visible instructions, disciplined controls and restrained chrome. | Reference screenshots guide hierarchy; do not import exam rules, countdowns or scoring assumptions. |
| 9 | Prefers dropdowns; rail forces scrolling and hides the whole passage while selecting. | Native inline selects at each blank; no answer rail. Keep options adjacent to text. | Complete all blanks on a long passage without travelling to a detached column. Keyboard and mobile selection work. |
| 10 | Green tick implies the selected answer is correct. | Neutral blue selected state; no correctness checkmark beside an active answer. | Check every control type, including listening: selection/filled status must not imply correctness. |
| 11 | Classic dropdown appearance is enough. | Style the native select lightly. No custom popover/bottom sheet unless measured native limitations justify a later change. | Familiar affordance and stable focus; no new bespoke interaction burden. |
| 12 | Audio waveform is visually busy; filled listening blanks should stand out. | Simple audio player with real scrubber; neutral blue fill for nonempty listening inputs, matching cloze answers. | No decorative 120-bar audio strip; filled/empty differences remain clear without color alone. |
| 13 | Review repeats information and numeral font does not match. | Noto Sans numerals; four open section summaries with group links and concise missing counts; one explanation near Submit. | No repeated warning boxes or wall of red empty cards; exact missing targets are easy to reach. |
| 14–15 | Navigation has too much text; prefers compact parts and numbered questions with clear answer state. | Persistent part/group navigation on desktop; compact mobile controls with a question overview. Use partial/full labels and flags. | Find an unanswered group, switch parts and return to the same place without searching a long menu. |

**Resolution of the green-color tension:** the PDF distinguishes a green tick next to an answer from completion markers in navigation. For this trial, use neutral blue for answered/filled, a number/text count for partial completion, and amber for flags. Reserve green for successful mic access or committed save/receipt messaging, with explicit text. This is a proposed simplification, not a claim that green navigation is inherently wrong.

## 4. Aesthetic specification

### 4.1 Visual direction

The candidate should feel like a carefully typeset assessment: quiet, clear, modern and approachable. Its character comes from typography, spacing, alignment and readable content. A reviewer should see the instructions, passage and next action immediately.

- Keep the entire task surface white. A very light neutral background may distinguish a toolbar or footer, without creating an enclosing card around every section.
- Use thin neutral dividers for structure. Limit outlined boxes to actual controls, an audio recording area where helpful, and actionable error notices.
- Avoid gradients, heavy shadows, black frames, offset shadows, oversized decorative numerals, decorative eyebrow labels, all-caps microcopy and unrelated icons.
- Keep the BEL logo small, about 28px, with the assessment title. It should establish identity without competing with the reading task.
- Use one primary button per step. Secondary navigation uses text or outline buttons. Red is reserved for recording/stop state or a real failure, not every empty answer.
- Preserve comfortable whitespace, but avoid the lab's very wide speaking lines and large unused margins on short tasks.

### 4.2 Starting design tokens

These values are implementation starting points. Adjust within the same direction when browser measurement requires it; report material design changes with a before/after image.

```css
:root {
  --etu-font: 'Noto Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --etu-canvas: #ffffff;
  --etu-subtle: #f8fafc;
  --etu-text: #172033;
  --etu-secondary: #475569;
  --etu-muted: #64748b;
  --etu-divider: #e2e8f0;
  --etu-control-border: #94a3b8;
  --etu-accent: #1d4ed8;
  --etu-accent-hover: #1e40af;
  --etu-selected: #eff6ff;
  --etu-warning: #92400e;
  --etu-warning-fill: #fffbeb;
  --etu-danger: #b91c1c;
  --etu-success: #166534;
  --etu-radius: 6px;
  --etu-space-1: 4px;
  --etu-space-2: 8px;
  --etu-space-3: 12px;
  --etu-space-4: 16px;
  --etu-space-6: 24px;
  --etu-space-8: 32px;
  --etu-space-12: 48px;
  --etu-content-max: 960px;
  --etu-reading-max: 72ch;
}
```

Use `--etu-control-border` for a required input boundary; the lighter divider color is for decorative separation. Verify contrast in the rendered candidate rather than assuming every token combination passes.

### 4.3 Typography and the Projects reference

Verified Projects declaration: `font-family: 'Noto Sans', system-ui, sans-serif; font-weight: 500; font-synthesis: none`. Its existing Vietnamese/Latin subset files are local, static 500 faces. The candidate must use the **family**, without inheriting Projects' 125% CSS zoom or its table-scale rules.

Provision a candidate-local variable Noto Sans family supporting actual 400/500/600 weights and Vietnamese plus Latin coverage, from the official family distribution. Record source URL, retrieval date, weight range, license and SHA-256 for each font file in `SOURCES.md`; preserve the existing Noto license. Use `font-display: swap` and correct subset ranges. Do not fake semibold or declare a static 500 file as a variable font. Existing Projects assets remain unchanged.

| Element | Desktop | Mobile | Weight / notes |
|---|---|---|---|
| Intro title | 36px / 1.2 | 28px / 1.25 | 600; sentence case, short title |
| Screen title | 28px / 1.3 | 24px / 1.3 | 600 |
| Actual task instruction | 20px / 1.5 | 18px / 1.5 | 600; concise, two or three lines if needed |
| English passage | 18px / 1.75 | 18px / 1.7 | 400; `lang="en"`; natural wrapping |
| Body explanation | 16px / 1.6 | 16px / 1.6 | 400 |
| Buttons and native controls | 16px / 1.4 | 16px / 1.4 | 500; explicitly inherit family |
| Metadata/status | 14px / 1.45 | 14px / 1.45 | 400/500; do not hide critical guidance in smaller type |
| Timer/group numbers | Context size | Context size | Noto Sans with `font-variant-numeric: tabular-nums` |

A visible text-size control provides 100%, 115%, 130% for reading and instructions, stored per demo. Scale both without CSS `zoom`, and never use it to replace browser zoom support. Do not add a learner-facing multi-font menu. Noto is the first candidate; if task trials reveal reading fatigue, compare alternatives in a subsequent review rather than silently reverting to Literata.

### 4.4 Desktop composition

```text
BEL   Entrance assessment                 Demo   VI / EN   Text size
------------------------------------------------------------------
Speaking · Passage 1 of 3                         Saved in browser

Read the passage aloud clearly and naturally.      <- instruction

Scientists make observations ...                  <- passage
...

[ Record ] / [ Stop ]       elapsed / recording playback

------------------------------------------------------------------
Speaking 1/3 | Vocabulary 0/4 | Grammar 0/4 | Listening 0/2
[1 Current] [2 Not started] [3 Not started]   Previous   Next   Review
```

The diagram expresses hierarchy, not a fixed-pixel promise. Content is centered with a 960px maximum outer width and a readable passage measure. Main side padding is 32–48px on desktop and 16–20px on phones. The navigation can use two rows; its height is content-driven. Do not force all controls into 60px.

### 4.5 Mobile composition and motion

- At 1024px and above, use desktop part tabs and group controls. Below that, allow wrapping before reducing content size.
- Below 768px, show the active part and group count in a compact summary, a question-overview button, and previous/next controls. The overview is a focus-managed dialog with part headings and numbered group buttons, not a long sidebar.
- Keep a visible route to Review on every question. On very narrow screens, place it in the header/overview instead of squeezing three footer buttons alongside a long label.
- Footer/header space must be reserved. Use a measured footer spacer or a layout that keeps it in flow; account for safe-area insets. On software-keyboard resize, the focused blank remains visible and scrollable above controls.
- No document-wide horizontal overflow at 320px. Native controls must fit their line or wrap to the next line; a long selected value must remain readable when focused/opened.
- Use short 120–180ms color/focus transitions and at most a subtle view entrance. No whole-page sliding, no answer-position animation, no layout jump after selecting, no flashing saved message. Respect `prefers-reduced-motion`.

## 5. Screen and interaction contracts

### 5.1 Intro

Show one title, one short explanation, four open section rows and one primary start/resume action. Show 3 read-aloud passages, 4 vocabulary passages, 4 grammar passages and 2 listening passages. Explain that there are multiple blanks within passages; do not imply only 13 individual response slots.

If a saved demo exists, show “Continue demo” and a secondary “Start a new demo” action. Starting a new demo must not silently destroy the old attempt; use a short confirmation or retain it as a local previous attempt. The title, instructions and controls change with language; data and content do not.

### 5.2 Mic check

One short instruction, the quiet visualizer, record/stop/playback controls, and continue/skip. Record until Stop; optionally provide a small suggested duration of a few seconds, but no automatic three-second pass/fail gate.

The line displays real time-domain input. It should be stable during quiet input and animate smoothly during activity. Do not equate a lit meter with intelligible speech or functioning speakers. Let the user confirm that playback is audible. Mic access denied/unavailable states explain what happened and offer Retry and Skip demo check.

Mic-check audio is temporary and never counts as a speaking response. Stop tracks and close contexts when leaving. Do not persist it with question recordings.

### 5.3 Speaking

Show metadata, prominent actual instruction, normal-sized passage, and one recording control area. States are idle → requesting permission → recording → processing → saving → ready, with recoverable permission/processing/storage failures. Elapsed time starts at zero when recording begins. Use text as well as color to identify recording.

After Stop, provide playback and “Record again”. Keep the previous committed take until a replacement has been successfully saved. A failed replacement must not erase the previous take. Navigation while recording presents **Stop and save / Stay**. The former stops, processes and commits the take before navigating; an error keeps the learner in a recoverable state. There is no silent abandonment.

Use `AudioDspPipeline.enhance(rawBlob, { createUrl: false })`. Extract `result.wavBlob` and inspect `stats`/`error`. The pipeline can return the raw Blob as a fallback; preserve its real MIME type instead of labeling it WAV. Do not change shared DSP thresholds. Keep a raw take until the durable processed/fallback take has committed; playback URLs are derived from stored Blobs and revoked on replacement/disposal.

The readiness label distinguishes “Recording saved in this browser” from “Processing” or “Not saved”. No upload/ASR/scoring request is made by the demo.

### 5.4 Vocabulary and grammar

Render inline native `<select>` controls from the question's ordered parts. The first blank's visible placeholder is a concise “Choose…” with a nearby or included blank number. Each control receives an accessible label such as “Vocabulary, passage 1, blank 2”. Preserve option order for the attempt and use stable `questionId`/`blankId` attributes.

An answered select has a soft blue background and accent boundary; the visible value already indicates its filled state. Do not add a checkmark. Do not move focus automatically when an answer is selected. Tab/Shift+Tab follows document order. Do not intercept native arrow keys or letter selection while a select is focused.

Widths should be based on option lengths within an explicit maximum, with `max-inline-size: 100%`; long controls wrap naturally. Avoid entire-passage rerendering on change, which would lose focus, scroll position or an open native selector. Patch the field, counts and save status.

### 5.5 Listening

Use the existing two audio assets, English passage and inline text inputs. Present Play/Pause, accessible seek/time and the retained demo speed control. Prefer native audio controls for the first pass; do not draw a random waveform.

Input value is preserved exactly during editing and reload, including casing and whitespace; derive filled status from `value.trim().length > 0`. Normalize only in a future submission adapter if required by the server contract. Do not replace text nodes or rebuild the input during composition. Use `compositionstart/compositionend` to avoid interrupting Vietnamese IME input in any editable UI.

Selecting another question pauses the current listening clip; coming back restores a deliberate playback position, with no autoplay. Persist the last position/rate only at throttled intervals or pause/navigation, not on every audio frame. Expose replay counts only if they help the evaluation; they must not look like a limit.

### 5.6 Navigation and flags

Stable group IDs drive navigation. Part counts represent **fully answered groups**, and each current group also shows its blank count, for example “2 of 4 blanks”. States: not started, partial, complete, flagged (orthogonal), current (orthogonal), and recording not yet saved (not complete).

Every state has a text/accessibility equivalent. Use `aria-current` for the active question button, `aria-pressed` for flag controls, and include partial counts in accessible names. Color is supplementary.

Moving to another question focuses its heading/instruction once. Returning to a previously visited long passage restores that passage's scroll position where practical. Answer changes must not focus the page body or scroll to a detached control.

### 5.7 Review and final demo submission

Review contains four section summaries with numbered group links, explicit counts and recording readiness. Show “Not started” neutrally. Use amber for partial groups or unsaved work and a concise actionable message. Provide “Go to first missing answer” and return to any group.

There is one final Submit demo button. If intentionally unanswered groups/blanks remain, show their exact counts and one confirmation in the review context. Do not add a second generic modal for complete submissions. Disable final commit while recording, processing, or a required persistence write is pending/failed; offer Retry or an explicit memory-only demo path with truthful copy if storage is unavailable.

On submit, flush the latest revision, then commit one local receipt referencing that revision. Repeated clicks during the same attempt must produce one receipt. Show Done only after that local acknowledgement. Reload restores Done and its committed values. No real learner token is locked, no teacher task is created, and no learner API endpoint is called.

### 5.8 Done

Show completion of the demo, a compact summary, and actions to review the saved demo or start another. Avoid claims of live grading, teacher review or contact unless clearly shown as a future-flow preview. If a future-flow preview is desired, label it within the QA panel rather than presenting it as a real status.

### 5.9 Demo QA tools

Keep an unobtrusive, keyboard-accessible “Demo tools” control. Required scenarios: reset this demo attempt; fill all written answers; fill most with missing/partial groups; mark review flags; provide clearly labeled fixture recordings for layout checks; jump to any of the eight screen types; simulate a save failure/retry; preview completion.

QA writes use the same state transitions/persistence path as ordinary interaction. A fixture recording is marked as a fixture and is excluded from human microphone-quality claims. Reset is limited to the candidate's database/keys; it must never clear all localStorage, CRM identity, old A/B/C drafts, existing ratings or production-token drafts. Replacing a user's recorded take through QA requires an explicit control/confirmation.

Keep these helpers for demo review. There is no answer-key-removal acceptance gate in this package.

## 6. State, persistence and module contracts

### 6.1 Public question shape

Use the existing canonical IDs: `speaking_q1..q3`, `vocab_q1..q4`, `grammar_q1..q4`, `listen_write_q1..q2`. Blank IDs follow the server convention, for example `vocab_q1__b1`.

The candidate's content module is an explicitly labeled **demo fixture**, derived from the existing lab/canonical content. Preserve exact canonical text when transferring it; the old lab normalized some quotation marks. Do not make another competing assessment source. A parity test compares the fixture's prompt text, blank count/options, section order and stable IDs against `buildPublicSession` from the server module. Answer keys remain available only to the demo QA path; they are allowed in this demo build by user instruction.

### 6.2 State contract

```js
// Serializable metadata; audio Blobs live in the recordings store.
const draft = {
  schemaVersion: 1,
  revisionId: 'academic-noto-v1',
  contentVersion: 'entrance_test_36plus_v1',
  attemptId: 'generated-local-uuid',
  revision: 0,
  view: 'intro', // intro | miccheck | question | review | done
  activeQuestionId: 'speaking_q1',
  answers: { /* questionId: { blankId: exactString } */ },
  flags: { /* questionId: true */ },
  recordingRefs: { /* questionId: { recordId, takeId, mimeType, durationMs, fixture } */ },
  playback: { /* questionId: { seconds, rate, plays } */ },
  locale: 'en',
  textScale: 100,
  micCheck: 'not-checked', // not-checked | checked | skipped; never a scored response
  submission: null // { receiptId, draftRevision, committedAt, mode: 'demo-local' }
};
```

Runtime-only state includes media streams, capture generation/take ID, pending promise queues, object URLs, focused target, open dialog, dirty revision and storage mode. Do not serialize these objects or a `blob:` URL.

Required pure functions in `state.js`:

```js
export function createDraft({ attemptId, revisionId, contentVersion }) {}
export function applyAction(draft, action, questionIndex) {}
export function summarizeQuestion(question, draft, runtimeReadiness) {}
export function summarizeAssessment(questions, draft, runtimeReadiness) {}
export function resolveResumeTarget(draft, questionIndex) {}
export function importLegacyDemoDraft(raw, skin, questionIndex) {}
```

Contracts, not signatures alone, determine correctness:

- `applyAction` preserves exact input strings and unrelated answers. The caller supplies stable IDs; unknown question/blank IDs are rejected or quarantined, never reinterpreted by array position.
- Every persistent change increases `revision`. Completion is derived; it is not an independently mutated counter.
- A text group is complete only when all of its expected blanks contain non-whitespace text. A speaking group is complete only when its recording reference resolves to a committed Blob, or a clearly labeled QA fixture is intentionally in use.
- Flags do not change answer counts. Current position does not imply completion.
- Restore validates version and IDs. An unsupported/corrupt draft is preserved for recovery and prompts an explicit new-demo choice; do not silently reset it.

### 6.3 IndexedDB and honest persistence

Database: `bel-entrance-test-ui-demo`, database version 1. Stores: `attempts` keyed by `attemptId`; `recordings` keyed by `[attemptId, questionId, takeId]`; `meta` keyed by a named property such as `activeAttemptId`. Candidate-only preference keys, if needed, begin `entrance_test_ui_candidate_v1:`. Never write `entrance_test_progress_v1:<token>`.

Required persistence interface:

```js
export async function openDemoStore({ indexedDB, clock }) {}
// returned adapter:
// loadAttempt(attemptId)
// saveDraft(draft) -> { committedRevision, committedAt }
// commitRecording({ draft, questionId, takeId, blob, metadata })
// loadRecording({ attemptId, questionId, takeId }) -> Blob | null
// commitSubmission({ attemptId, expectedRevision, receiptId })
// resetAttempt(attemptId)
// close()
```

- Commit the Blob and its draft reference in the same transaction. Resolve save promises on transaction completion, not merely `request.onsuccess`.
- Serialize writes and coalesce text changes with a short debounce (about 250ms). Flush on navigation/review/submit and `visibilitychange` where feasible. Do not claim guaranteed async completion during browser termination.
- A late write of revision N must not mark revision N+1 saved or overwrite it. `savedRevision === currentRevision` is required before the UI says the current work is saved.
- Use `takeId` and captured `questionId` to ignore stale recording callbacks. Navigating cannot attach a delayed take to the newly visible question.
- On replacement, commit the new take before removing the previous committed take. If either persistence or processing fails, preserve the previous take.
- Quota/private-storage failures leave the in-memory response playable/editable with explicit “Not saved in this browser” copy and Retry. Memory-only continuation is possible for a demo, but must never promise reload recovery.
- If multiple tabs open the same attempt, use an optimistic revision check or single-writer ownership. A stale writer gets a recoverable conflict message; no silent last-writer data loss.
- A submitted demo is locally immutable. QA/new-demo actions create or explicitly reset an attempt, rather than mutating its receipt behind the user's back.

### 6.4 Legacy demo import

Do not automatically overwrite A/B/C localStorage. An explicit QA “Import existing demo answers” action may read `entrance_test_ui_lab_v1:a`, `:b`, or `:c`, map ordinal answers to canonical blank IDs and map `q` to the corresponding stable question ID. Import text/flags only. Old in-memory recordings cannot be recovered; show that plainly. Retain source data unchanged and test with a sanitized fixture. Production `stepIndex` migration belongs to the later integration package.

### 6.5 Host bridge, Demo D and historical ratings

Preserve `window.CrmEntranceTestUiLab.boot()` and its classic-script loading. Add `{ id: 'd', label: 'D · Noto', hint: 'Sáng, phẳng, rõ thứ bậc' }` to `SKINS` so all existing `pageComplete`, `pagesDone`, rating-column and results aggregation paths include it naturally. `NEED_RATINGS` remains derived from `SKINS.length * PAGES.length * CRITERIA.length` and therefore becomes 160. Do not rename, migrate, clear or recompute existing `a:*`, `b:*` or `c:*` entries. An old record with all 120 legacy scores loads those scores intact, shows D at `0/8`, and requires only the 40 `d:*` scores before the current results gate is complete.

Within the same evaluator page, the fourth skin button selects `/entrance-test-ui/`; A/B/C continue to select their existing `entrance-test-ui-lab.html?skin=<id>` URLs. Demo D uses the same eight page chips and the same five-star rating column as the other designs. Results add a D card and D table column while preserving the exact A/B/C aggregates for the same input records. Ordinary interaction inside Demo D must never write ratings; only an explicit CRM star action writes the corresponding `d:<page>:<criterion>` value.

Demo D initializes both font roles to its local Noto Sans family. Preserve the existing global font-vote arrays and historical choices. A deliberate evaluator font-preview action may temporarily override either D font role without changing ratings or auto-voting; a clear/reset action restores Noto Sans for both roles. Returning to A/B/C preserves their current preview behavior. The evaluator copy must explain that D's baseline is Noto Sans even though font votes remain a separate exercise.

Use a revision-aware message contract for the new iframe:

```js
// Parent -> candidate
{ type: 'etui:goto', revisionId: 'academic-noto-v1', skin: 'd', page: 'vocab' }
// Candidate -> parent
{ type: 'etui:page', revisionId: 'academic-noto-v1', skin: 'd', page: 'vocab' }
{ type: 'etui:ready', revisionId: 'academic-noto-v1', skin: 'd' }
```

Check both `event.origin === location.origin` and `event.source === currentIframe.contentWindow`, then validate `revisionId` and `skin === 'd'` for candidate messages. Ignore legacy messages while D is active and D messages after returning to A/B/C. On ready, apply the current requested page. Do not rebuild the iframe for every page jump or status update. Keep the existing legacy message protocol unchanged.

If a rating save is pending when switching designs, finish the save for its captured rater/skin/page/criterion data; the switch must not drop or misattribute it. Candidate page/ready messages may update navigation state only. They must not call `scheduleSave`, mutate font votes or manufacture a D rating.

## 7. Exact implementation path inventory

All paths below are relative to the execution worktree root corresponding to `C:/Cursor AI`. Existing files are modified only for their listed responsibility. New directories follow the established `public/js/<domain>`, `public/css`, `public/fonts`, `tests/<domain>` and `docs/` homes. The standalone page is nested under `public/entrance-test-ui/` to avoid inventing a new unregistered public-root entry.

### Create

| ID | Exact path | Responsibility |
|---|---|---|
| P01 | `public/entrance-test-ui/index.html` | Standalone candidate shell; local font/CSS references; existing DSP script; ESM app entry. |
| P02 | `public/css/entrance-test-ui.css` | Candidate-only tokens, layout, fields, responsive navigation, focus, reduced motion. |
| P03 | `public/fonts/entrance-test-ui/noto-sans.css` | Candidate font-face declarations with real weight ranges and subset coverage. |
| P04 | `public/fonts/entrance-test-ui/NotoSans-Variable-vietnamese.woff2` | Verified variable font subset. |
| P05 | `public/fonts/entrance-test-ui/NotoSans-Variable-latin-ext.woff2` | Verified variable font subset. |
| P06 | `public/fonts/entrance-test-ui/NotoSans-Variable-latin.woff2` | Verified variable font subset. |
| P07 | `public/fonts/entrance-test-ui/SOURCES.md` | Font source/version/hash/weight/license record; link existing Noto license. |
| P08 | `public/js/entrance-test-ui/demo-data.js` | Demo content fixture/normalization and stable IDs; explicit provenance. |
| P09 | `public/js/entrance-test-ui/state.js` | Pure transitions, counts, navigation target and legacy-demo import. |
| P10 | `public/js/entrance-test-ui/persistence.js` | IndexedDB adapter and serialized revision-aware persistence. |
| P11 | `public/js/entrance-test-ui/audio.js` | Mic-check/capture/DSP/playback lifecycle; no scoring/network upload. |
| P12 | `public/js/entrance-test-ui/view.js` | Screen renderers and focused DOM updates; no storage/API calls. |
| P13 | `public/js/entrance-test-ui/copy.js` | Complete Vietnamese/English UI copy; task text remains in content. |
| P14 | `public/js/entrance-test-ui/qa.js` | Explicit demo scenarios using shared state/persistence actions. |
| P15 | `public/js/entrance-test-ui/app.js` | Lifecycle composition, events, storage coordination and parent bridge. |
| T01 | `tests/entrance-test-ui/content.test.mjs` | Canonical fixture/IDs/blank/option parity; no live calls. |
| T02 | `tests/entrance-test-ui/state.test.mjs` | Meaningful count/navigation/import/submission state invariants. |
| T03 | `tests/entrance-test-ui/persistence.test.mjs` | Queue/revision/stale callback behavior using injected test doubles; actual IDB is tested in Chrome. |
| T04 | `tests/browser/entrance-test-ui-demo-check.py` | Installed Chrome acceptance runner with selectable cases, local server lifecycle and evidence. |
| F01 | `tests/fixtures/entrance-test-ui/legacy-draft.json` | Sanitized old-lab draft for explicit import tests. |
| F02 | `tests/fixtures/entrance-test-ui/evaluator-host.html` | Real evaluator script in a minimal shell with in-memory Firestore stub; no live login/writes. |
| F03 | `tests/fixtures/entrance-test-ui/scenarios.json` | Deterministic partial/filled/flagged/error scenarios; no personal data. |
| D01 | `docs/audits/entrance-test/ui-demo-overhaul-execution.md` | Final candidate provenance, pass/fail evidence, visual review and pending human evaluation. |

### Modify

| Exact path | Allowed change |
|---|---|
| `public/js/crm/entrance-test-ui-lab.js` | Add rated Demo D, route its iframe URL/bridge, default its two font roles to Noto Sans, and extend completion/results without changing existing A/B/C rating keys or values. |
| `package.json` | Add only the two focused test commands in section 10; preserve every other script/dependency. |
| `scripts/structure/policy.json` | Append only the corresponding two command declarations; no root/baseline/exception widening. Reconcile with the active owner's current policy before integration. |
| `docs/plans/2026-09-13-entrance-test-ui-demo-overhaul-handoff.md` | Execution status, actual scope revisions and evidence references; never rewrite user decisions silently. |

### Read-only / protected

Production learner HTML/JS/CSS; `functions/src/entrance-test/test36plus.js`; `functions/src/routes/entrance-tests.js`; `src/routes/entrance-tests.js`; CRM result/PDF pages; learner-link helpers; Firestore/Storage rules; Firebase config; shared DSP; Projects files and existing fonts; original A/B/C lab and font catalogue; old ratings/documents. `agent_docs/project_progress.md` and `latest_session_work.md` are not part of this Light-route package. No deletes or renames are planned.

Generated screenshots, fake microphone WAV files, console/network logs, manifests and evaluation notes go only to an execution-specific external evidence directory, for example `C:/Users/Admin/.codex/audits/entrance-test-ui-demo-execution-<run-id>/`. Declare the resolved exact directory in the external contract; do not add bulky output to Git.

## 8. Execution sequence and dependencies

Execute in order with one owner. File IDs below resolve to the exact paths in section 7. Keep one browser/server owner; stop owned processes in `finally` blocks. A checkpoint is a locally reviewable state, not a production release or a reason to ask for approval again within an authorized package.

```text
0. Isolate and record baseline
   ├─ 1. Noto font and visual shell
   └─ 2. Canonical fixture and state
           └─ 3. Durable local persistence
1 + 2 + 3 → 4. Intro, shared shell and inline answering
                 ├─ 5. Mic check and speaking
                 └─ 6. Listening and compact navigation
4 + 5 + 6 → 7. Review, demo receipt and QA scenarios
                 → 8. Evaluator integration
                 → 9. Settled-candidate verification
                 → 10. Visual review and execution handoff
```

The forks indicate dependencies only; they do not authorize agents or concurrent writers. Develop proportionate behavioral tests for state and persistence. Do not add tests that merely repeat a CSS constant or assert that a file contains an implementation string.

### Task 0 — Establish an isolated execution baseline

**Files:** read the sources in section 2; create only the external execution contract, snapshot and provenance record at this step.

1. Inspect current `git status --short`, `git rev-parse HEAD` and the relevant source diff. Record the output externally. Confirm the execution model/route if not already approved for this package.
2. Create the isolated worktree described in section 2 from the agreed revision. Record its absolute path, branch and SHA. Do not overwrite an existing worktree.
3. Verify the three source documents are available. If transfer is needed, copy only their exact paths and record hashes; classify those transfers in the execution contract before writing them.
4. Declare every created/modified file from section 7 and the exact output directory. Add source-document transfers explicitly if needed. Record long-term feature ownership as unresolved if no person has been assigned.
5. Create the before snapshot using the current documented `check:structure` CLI. Keep the exact contract bytes unchanged afterward; if scope changes, follow the checker's supported contract/snapshot procedure before the new work.
6. Record current A/B/C evaluator, rating-record and Projects font source hashes. Confirm the current denominator is 120, the additive Demo D target is 160, the question/blank counts and actual `RATES` set. Resolve any discrepancy before fixture implementation.

**Exit evidence:** isolated worktree identity, external declaration and before snapshot, exact source inventory. No product files changed yet.

### Task 1 — Establish the Noto visual shell

**Files:** P01–P07 (`public/entrance-test-ui/index.html`, `public/css/entrance-test-ui.css`, and the five declared candidate font files).

1. Provision the Noto Sans variable Vietnamese, Latin Extended and Latin subsets from the official family distribution. Verify actual font metadata supports regular 400, medium 500 and semibold 600; record source URL, version, SHA-256, subset coverage and license reference in P07. Do not relabel the existing static 500 files.
2. Write P03 with correct `unicode-range`, genuine weight range and `font-display: swap`. Resolve assets relative to that stylesheet. Keep `font-synthesis: none`; test Vietnamese precomposed and combining-mark samples.
3. Write the candidate-scoped tokens, typography, layout and focus rules in P02. Use a root class such as `.et-ui`; avoid global changes to the CRM host or old lab.
4. Create P01 with semantic header/main/footer, stylesheet references and module entry. Load the existing shared DSP script before the module needing it. All asset references must work from the nested `/entrance-test-ui/` route.
5. Inspect a representative instruction, English passage, Vietnamese sentence, select, text field, button and timer in Chrome. Verify rendered fonts, loaded subset resources and real weight faces. A computed `font-family` string alone is insufficient if the face failed to load.

**Exit evidence:** a font/typography capture at desktop and narrow width, no missing font requests, no overflow at 320px. Do not spend this checkpoint polishing empty states that will be replaced by the real screens.

### Task 2 — Build the content fixture and pure state model

**Files:** P08 `demo-data.js`, P09 `state.js`, T01 `content.test.mjs`, T02 `state.test.mjs`, F01 `legacy-draft.json`, F03 `scenarios.json` under their section 7 directories.

1. Write T01 against the canonical `buildPublicSession` output: 13 question groups, 45 blanks, identical stable IDs, passage segments, blank order and exact option strings. Compare the normalized browser fixture with the public content shape; exclude timestamps/session identity from semantic comparison. Any extra demo answer keys must be explicitly identified as QA-only fixture fields.
2. Run `node --test tests/entrance-test-ui/content.test.mjs`; the initial failure should identify the absent fixture or parity mismatch, not a missing unrelated service.
3. Implement P08 as a static browser-safe fixture with provenance. Preserve current listening asset references after checking their availability. Do not add a new scoring engine or browser import of the server module.
4. Write F01 as a sanitized current-lab draft, including a partial group and flag. Write F03 with all-empty, partial, complete, flagged, missing-audio and failed-save scenarios using stable IDs.
5. Write T02 for exact answer preservation, partial/completed counts, flags, navigation, locale/text-size independence, resume targeting, unsupported content versions and explicit legacy import. Include a draft with whitespace and punctuation to prove storage does not normalize user text.
6. Implement P09's pure functions from section 6.2. Keep platform I/O and DOM objects out of it. A completion summary is derived from current content and committed recording references, not a cached UI counter.
7. Run `node --test tests/entrance-test-ui/content.test.mjs tests/entrance-test-ui/state.test.mjs`; expect exit 0, with no Firebase/service/network setup.

**Exit evidence:** passing parity/state assertions and deterministic scenario fixtures. The original lab and canonical server source remain unchanged.

### Task 3 — Implement durable local drafts and recording commits

**Files:** P10 `public/js/entrance-test-ui/persistence.js`, T03 `tests/entrance-test-ui/persistence.test.mjs`; use P09's already defined contract.

1. Write T03 around an injected adapter/clock: coalesced writes, late revision acknowledgements, rejected writes retaining dirty state, recording replacement failure, stale take callbacks and optimistic revision conflicts. Tests should drive controllable deferred promises; do not substitute arbitrary sleep durations for ordering assertions.
2. Run `node --test tests/entrance-test-ui/persistence.test.mjs`; verify the failure demonstrates the missing contract.
3. Implement P10 using IndexedDB transactions and the section 6.3 interface. Keep debouncing/serialization in this module; the view receives explicit persistence state.
4. Implement atomic new-Blob/reference commits. Preserve the old reference and Blob on failed replacement; reclaim an old take only after the new transaction commits.
5. Implement local receipt commit with an expected revision and repeat-call idempotency. A double click must return one receipt rather than create divergent attempt states.
6. Run T03; expect exit 0. Keep actual IndexedDB/reload/storage-failure coverage assigned to Chrome in Task 9. A passing fake-adapter test does not establish browser durability.

**Exit evidence:** tested ordering/error behavior and the exact store schema. Capture unsupported-storage behavior explicitly; no false saved state.

### Task 4 — Compose intro, shared layout and inline answers

**Files:** P12 `view.js`, P13 `copy.js`, P15 `app.js`; refine P01/P02 within their declared roles.

1. Write P13 with complete VI/EN copy for normal, loading, empty, recording, saving, failed-save, review and done states. Do not assemble sentences by joining translated fragments. Keep academic passage text in P08.
2. Implement P12's shared shell, intro/resume view, task title/instruction and vocabulary/grammar passages. Each blank has a persistent DOM control keyed by its canonical ID and an explicit accessible name.
3. Implement P15's startup: load/validate active attempt, expose recovery if invalid, and create a new draft only when appropriate. Compose state, persistence, view and events without placing I/O inside P12.
4. Wire native `select` changes to `applyAction` and the save queue. Update the selected/filled state, counts and save label without rebuilding the active passage control. Preserve focus, current select identity and scroll position.
5. Implement text-size/language controls without resetting the attempt or rebuilding active media. Support resume, explicit new-demo confirmation, and cancel returning focus to its trigger.
6. Exercise one partial passage through reload in Chrome. Record exact selected option strings and the resulting stable-ID draft, then confirm the restored UI shows the same values.

**Exit evidence:** complete intro, resume, vocabulary and grammar flow; stable keyboard focus; honest saved/saving/failed states. No detached answer rail.

### Task 5 — Complete microphone check and speaking

**Files:** P11 `audio.js`; extend P12, P13 and P15; use P10's recording transaction.

1. Implement P11 with injected media devices, recorder factory and DSP function so lifecycle failures can be reproduced without a physical microphone.
2. Implement mic permission request, quiet baseline visualization, record/stop/playback and skip. Use time-domain samples and a modest canvas; release tracks and animation frames on leaving the screen. A visualizer is not itself evidence that recording playback works.
3. Implement read-aloud recording states: idle → requesting → recording → stopping/processing → saved/playable; errors return to a recoverable state. Use elapsed time; prevent duplicate recorder starts and repeated Stop handling.
4. On Stop, call the existing `AudioDspPipeline.enhance` and consume its object result correctly. Preserve actual Blob MIME type if DSP falls back. Store the processed recording with metadata; do not label an uncommitted Blob saved.
5. Implement replacement without discarding the existing playable take until the new one commits. Revoke only object URLs that are no longer used; never revoke the restored active player URL during unrelated rendering.
6. When navigating during recording, offer Stop and save / Stay. If processing is already underway, finish or surface failure before leaving; bind callbacks to the captured question/take identity.
7. Test fake mic, denied permission, processing failure, replacement failure and reload playback in Chrome. Separately perform a short physical-microphone recording/playback check; document if that human check remains pending.

**Exit evidence:** all three read-aloud groups usable, persisted recordings reload into the correct group, and no active microphone remains after leaving/done/reset.

### Task 6 — Complete listening and compact navigation

**Files:** extend P11–P13 and P15; refine P02.

1. Add a simple listening player: Play/Pause, elapsed/total time, keyboard-operable progress range, and the current lab's exact speed choices. Handle metadata loading, unavailable media and retry without clearing answers.
2. Render listening inputs inline. Use `input` with composition-aware handling; never rewrite the live value or caret during an IME composition. Persist exact text; use trimming only for completion checks.
3. Highlight filled inputs with a light neutral/blue treatment. No green correctness tick; empty fields retain a visible border and explicit label.
4. Implement desktop part navigation and the compact narrow-screen question overview. Distinguish current, partial, complete and flagged states using text/counts/shape as well as color.
5. Keep the current instruction and first passage line visible when changing question. Remove unconditional `scrollIntoView` that pulls a lower answer rail into view. Scroll only for an explicit jump target or to reveal a genuinely obscured focus target.
6. Implement overview dialog focus entry, Escape dismissal, contained tab order and return focus. Keep native select popups under browser control; do not trap their keyboard interaction.
7. Verify listening playback time/rate survive answer edits and navigation according to the section 5 contract. Do not resume audible playback automatically after a reload without user interaction.

**Exit evidence:** a learner can answer, flag and revisit all 13 groups at narrow width without lost input, inaccessible controls or unexpected audio restart.

### Task 7 — Complete final review, demo receipt and QA controls

**Files:** extend P12–P15; use P09/P10; extend T02/T03 only for newly introduced behavioral contracts.

1. Render the review as four flat sections with accurate counts, clearly identified missing responses, flag markers and direct jumps to the relevant blank/recording. Avoid a nested card per blank.
2. For Jump to missing, set both the correct question and focus target. On returning to review, derive counts from current state rather than the previous review DOM.
3. Flush pending writes and resolve recording processing before final submission. Treat intentional blanks through one acknowledgement; treat save failures through retry/recovery copy. Acknowledging blanks must not bypass a failed save.
4. Commit one local receipt with `commitSubmission`. Prevent duplicate activation while pending. Render demo Done only after commit, or explain the storage failure and remain recoverable.
5. Implement P14's QA actions through the same state/persistence interfaces: fill all, partial, clear current, flags, jump, complete, and explicit reset. Label synthetic/fixture recordings; do not imply a generated marker is the learner's actual recorded speech.
6. Make QA reset target only this candidate's attempt/database keys. Preserve legacy A/B/C drafts, production token drafts, other browser storage and old ratings.
7. Extend state/persistence tests for the final blank acknowledgement and duplicate submit contracts; run the focused suite once for these changes.

**Exit evidence:** a complete demo can be reached manually and with QA helpers; review accurately reflects partial work; refresh after submission restores the same receipt.

### Task 8 — Add rated Demo D to the current evaluator

**Files:** modify `public/js/crm/entrance-test-ui-lab.js`; create F02 `tests/fixtures/entrance-test-ui/evaluator-host.html`; extend P15's parent bridge.

1. Build the fixture host using the real classic evaluator script and an in-memory Firestore stub matching only the methods that script calls. Provide synthetic rater data and capture writes. Do not duplicate evaluator logic in the fixture.
2. Add Demo D to `SKINS` and route `state.skin === 'd'` to `/entrance-test-ui/`; keep A/B/C URLs and IDs unchanged. Let the derived completion requirement move from 120 to 160 while preserving every loaded legacy rating entry.
3. Initialize Demo D's English and Vietnamese font roles to Noto Sans. Keep existing A/B/C font-preview behavior and saved font votes unchanged; a temporary D preview override must not auto-vote the font, and clearing it restores Noto.
4. Implement the section 6.5 ready/page/goto bridge. Capture desired page until ready, validate source/origin/revision, and avoid iframe reload for in-candidate page changes.
5. Keep the standard rating column active for D. Update evaluator guidance to say there are four demos, expose D progress as `0/8` through `8/8`, and keep the font-vote requirement separate from D's Noto baseline. The standalone candidate remains usable without the CRM host.
6. Test A → D → B, B → D → B, all eight D page buttons, iframe reload/ready, forged message source, late saves, and an old 120-rating record. Assert D star clicks write only `d:*` keys, ordinary candidate interaction writes none, existing A/B/C values remain byte-for-byte equivalent, results include D, and the completed requirement is 160.

**Exit evidence:** the current evaluator offers Demo D as a fourth fully rated design on the same page while historical A/B/C scores, font votes and behavior remain intact.

### Task 9 — Register and run the settled-candidate checks

**Files:** create T04 `tests/browser/entrance-test-ui-demo-check.py`; extend T01–T03 and F02/F03 only where evidence exposes a missing assertion; modify `package.json` and `scripts/structure/policy.json` for the exact commands in section 10.

1. Implement the local Chrome runner with cases `visual`, `input`, `storage`, `audio`, `navigation`, `review`, `host` and `all`. Require `--output` to be an absolute external evidence directory. Emit structured pass/fail results, browser version, source identity and selected screenshots.
2. Start a local static server inside the runner and shut it down in `finally`; serve only `public/` and the explicitly mapped sanitized fixtures. Never serve the repository root or `.local` credentials. Use an available loopback port and record it.
3. Launch installed Chrome with Playwright's `channel="chrome"`. Generate synthetic mic audio with Python's standard `wave` module into the external evidence directory and use Chrome's fake-media flags for automated recording cases. This proves lifecycle behavior; it does not prove physical microphone sound quality.
4. Intercept unintended learner API/Firestore writes. Use the local host stub for rating assertions. Real media/font loads needed by the demo are allowed and logged. Do not make the tests dependent on real student attempts or changes to production records.
5. Register the two package commands and their matching policy declarations. Do not add broad filesystem exceptions, dependencies or global module-type changes.
6. Run the command sequence in section 10. Fix demonstrated failures within the declared paths, then rerun affected cases. Once the settled candidate passes, do not repeatedly rerun broad suites without a new reason.

**Exit evidence:** assertion-backed local results for section 9's matrix, with any blocked/untested item stated explicitly. Screenshots supplement behavioral assertions.

### Task 10 — Perform the design review and produce the handoff

**Files:** D01 `docs/audits/entrance-test/ui-demo-overhaul-execution.md`; update this handoff's execution status; external evidence only for captures/results.

1. Compare the real candidate with every PDF row in section 3. Capture representative intro, mic, speaking, vocabulary, grammar, listening and review screens on desktop and mobile. Use actual passage content, not a shortened design fixture.
2. Review hierarchy, line length, whitespace, answer affordances, colors, recording/playback states and all numeral fonts. Correct visual defects in the already declared files, then repeat only affected acceptance cases.
3. Write D01 with candidate SHA plus uncommitted content hashes where applicable, exact changed-file inventory, command results, evidence paths/hashes, font provenance, known issues, and the status of human evaluation. Keep production readiness explicitly separate.
4. Compare the final worktree/index delta with the external declaration and run the structure checks. Resolve undeclared paths without hiding them in a broad exception.
5. Provide the standalone launch path, evaluator launch instructions, test commands, QA scenario list and rollback instructions. Keep the candidate branch/worktree intact for review. No push, merge or deployment is included.

**Exit evidence:** locally verified demo and a reviewable implementation report. Human usability evaluation may be a separately scheduled milestone; do not mark it passed because automated checks passed.

## 9. Acceptance matrix

The identifiers below should appear in the browser result JSON and execution report. The evaluator's aesthetic requests are covered by the PDF matrix; this table adds explicit failure conditions.

| ID | Scenario | Required observation/assertion |
|---|---|---|
| VIS-01 | Noto / VI and EN | Rendered face is Noto Sans for passage, input, select, button and numeral samples. Required font subsets load; Vietnamese marks are intact; weights are genuine. |
| VIS-02 | Layout widths | At 1440, 1024, 768, 390, 360 and 320 CSS px, no document horizontal overflow beyond a 1px rounding tolerance; primary content and controls remain usable. |
| VIS-03 | Hierarchy | Actual instruction is visually stronger than the passage; no eyebrow clutter, detached answer rail, decorative listening waveform or repeated review caption. |
| VIS-04 | Text and zoom | Text settings 100/115/130% preserve answers and navigation. Chrome at 200% zoom remains operable; verify 400% reflow at a 1280px desktop baseline. Record actual CSS viewport. |
| INP-01 | Select keyboard flow | Tab to a named select, choose by keyboard and tab onward; focus does not fall to BODY, selected value persists and active control identity is stable. |
| INP-02 | Listening composition | Type/edit punctuation, spaces and Vietnamese composition samples; no truncated value, caret jump or dropped final composition event. |
| INP-03 | Filled versus correct | Filled answers use neutral state, never answer-key correctness feedback. A partially filled passage does not appear complete. |
| STO-01 | Written reload | After a successful save indication, reload restores exact answers, flags, current question, language and text setting. |
| STO-02 | Delayed writes | Delay revision N, edit N+1 and navigate; N's completion cannot mark N+1 saved or restore older text over newer text. |
| STO-03 | Failed write | Inject transaction failure/quota error; dirty values stay visible, save status is truthful, Retry works, and review does not silently submit. |
| STO-04 | Recording reload | Commit a take, reload and play the restored Blob on the same question; duration/MIME metadata agree with the playable asset. |
| STO-05 | Failed replacement | Preserve and play the prior take when processing/commit of its replacement fails. A delayed callback cannot attach to another question. |
| STO-06 | Conflict/corruption | A second tab's stale write is rejected/recovered; an unsupported/corrupt draft is retained with recovery UI, not silently reset. |
| STO-07 | Reset isolation | Reset removes only the intended candidate attempt. Seeded old-lab, production-token and unrelated storage values remain byte-identical. |
| AUD-01 | Mic check | Real record/stop/playback works; quiet input has a flat baseline; skip remains usable; denied permission has recovery copy. |
| AUD-02 | Speaking | Start/Stop/replace and navigation while recording follow the defined states. No duplicate recorder or live track survives leaving/reset/done. |
| AUD-03 | Listening | Seek by keyboard, change speed, answer and revisit; playback state is preserved as specified. Unavailable media provides retry without clearing answers. |
| NAV-01 | Counts and flags | Section counts, partial state, current marker and flags correspond to stable IDs. Flagging alone never increases completed count. |
| NAV-02 | Narrow overview | Open, choose a question, close with Escape and restore trigger focus. Page changes show instructions without scrolling the top out of view. |
| NAV-03 | Mobile footer | At 390×844 and 360×640, controls and last blank are not hidden by footer. Perform a manual Chrome Android soft-keyboard check if a device is available; desktop viewport emulation alone does not prove this case. |
| REV-01 | Review jumps | Jump to a missing response targets the exact blank; fixing it updates counts on return. Flags remain visible. |
| REV-02 | Submit | Partial submission needs one blank acknowledgement. Pending/failed save is handled separately. Double activation produces one local receipt. |
| REV-03 | Done/reload | Done clearly says demo; refresh restores the same receipt without real submission, score, teacher notification or production-link lock claims. |
| QA-01 | Intentional helpers | Fill-all/partial/jump/reset/complete remain available and work through shared state/storage; fixtures are identified as demo material. |
| HST-01 | Demo switching | A/B/C → D → same/different legacy skin works; the D page bridge works without rebuilding the iframe on every jump. |
| HST-02 | Ratings extension | The matrix is 160 ratings (`4 × 8 × 5`); an old 120-rating record retains all A/B/C values and needs only D's 40 ratings. Explicit D star actions write `d:*`; in-demo interactions create zero rating writes; late saves remain correctly attributed. Results show D without changing A/B/C aggregates. |
| HST-03 | Message isolation | Messages from a different origin/source or stale revision do not navigate the candidate or mutate ratings. |
| HST-04 | Demo D font default | On first D load and after clearing a D preview, Vietnamese UI, English UI/passage, controls and numerals render in local Noto Sans. Temporary evaluator previews and historical font votes remain separate and do not auto-vote Noto. |
| A11Y-01 | Controls | All fields have meaningful accessible names; buttons have unambiguous names/states; keyboard focus is visible; dialog focus is correct. |
| A11Y-02 | Contrast/motion | Text and essential control boundaries meet the relevant WCAG 2.2 AA contrast requirements; selected/error states have non-color cues. Reduced motion removes nonessential transitions. |
| REG-01 | Existing surface | Production learner files, canonical content, shared DSP and original lab remain unchanged. CRM evaluator legacy smoke flow passes against the fixture host. |
| REG-02 | Runtime cleanliness | No uncaught page errors, failed required local resources or unintended learner API writes in the tested flows. |

Use [WCAG 2.2](https://www.w3.org/TR/WCAG22/) for the accessibility requirements, including 1.4.3, 1.4.10, 1.4.11, 2.1.1, 2.4.7 and 2.5.8. The proposed 44px touch targets and typography scale are design choices, not claims that WCAG mandates every listed pixel value. Automated checks plus manual keyboard inspection do not constitute a full accessibility audit.

## 10. Test commands, registration and evidence rules

### Focused commands to add during execution

```json
{
  "test:entrance-test-ui": "node --test tests/entrance-test-ui/content.test.mjs tests/entrance-test-ui/state.test.mjs tests/entrance-test-ui/persistence.test.mjs",
  "test:entrance-test-ui:browser": "python -X utf8 tests/browser/entrance-test-ui-demo-check.py"
}
```

Append matching entries to the existing `commands` list in `scripts/structure/policy.json`, preserving its current schema:

```json
[
  {
    "name": "test:entrance-test-ui",
    "program": "node",
    "args": ["--test", "tests/entrance-test-ui/content.test.mjs", "tests/entrance-test-ui/state.test.mjs", "tests/entrance-test-ui/persistence.test.mjs"],
    "target": "tests/entrance-test-ui/content.test.mjs",
    "effects": ["read-only"]
  },
  {
    "name": "test:entrance-test-ui:browser",
    "program": "python",
    "args": ["-X", "utf8", "tests/browser/entrance-test-ui-demo-check.py"],
    "target": "tests/browser/entrance-test-ui-demo-check.py",
    "effects": ["local-write", "external-temp"]
  }
]
```

Reconcile these declarations with the actual schema at execution. Declare local server startup, local IndexedDB writes and generated evidence in the execution contract. The unit suite remains read-only by using in-memory doubles; if its effects change, update the declaration truthfully.

Run from the isolated worktree. Replace the illustrative output directory with the exact declared directory:

```powershell
npm run test:entrance-test-ui
npm run test:entrance-test-ui:browser -- --case all --output 'C:\Users\Admin\.codex\audits\entrance-test-ui-demo-execution-<run-id>'
npm run test:structure
npm run lint:crm
npm run verify:crm -- --list
```

Expected: unit/structure/lint commands exit 0; the browser runner exits 0 only when all selected assertions pass; `--list` emits the actual CRM check inventory. Missing Chrome, fixtures, fonts or required media are failures or explicitly blocked checks, not silent skips with a green result.

Because the CRM evaluator changes, run the applicable CRM aggregate against the settled candidate after inspecting that inventory and its configuration. The current `verify:crm` effect declaration includes remote writes; do not blindly run live mutations during a demo-only task. Use the existing documented local/emulator configuration where supported. If the aggregate cannot run within this scope, record the exact blocked checks and cause; do not claim full CRM verification from the evaluator fixture alone. No new environment flag or safe mode should be invented in the plan.

Run the current documented structure local-completion command with the execution contract and before snapshot. Record command, exit code and findings externally. Do not update the structure baseline to erase new findings.

### Browser workflow and login

- Start with the workspace's local Python Playwright `webapp-testing` workflow and **Chrome only**. A fixture host and standalone candidate require no login.
- For any optional actual CRM login check, first read `C:/Cursor AI/.local/browser-test-credentials.md` and use its admin account. Never inline credentials in this plan, tests, screenshots, tracked docs or logs. Use synthetic rater data; no production student changes or live rating submission is needed.
- After Playwright, use the configured `browser-agent` workflow only when live interactive confirmation or richer capture is useful and available. If unavailable, record that limitation; do not claim it ran.
- A human listening check, true browser zoom and a device soft keyboard are distinct from fake microphone/viewport automation. Report each separately.

### Evidence minimum

The external result manifest records source SHA and changed-file hashes, UTC/Vietnam timestamps, Chrome and runtime versions, viewport/zoom, case IDs, input scenario IDs, output hashes, and pass/fail/blocked status. Include console errors and failed requests with sensitive data redacted. Keep only representative screenshots; do not generate large recordings/traces by default.

Retain the exact source worktree/branch and evidence directory until review/integration is resolved; record owner and restore path. No automatic evidence deletion is authorized. A local pass is not deployed/live evidence.

## 11. Aesthetic and learner evaluation protocol

### First review: the visual candidate

Show Demo D as the fourth selectable and rateable design across the full flow, with A/B/C still selectable as unchanged references. Do not build another set of unrelated variants inside D. Compare these concrete questions:

1. Can the reader identify the instruction before the passage, without the interface feeling oversized?
2. Does Noto Sans stay comfortable across a full English passage and Vietnamese instructions, including 400/500/600 weights?
3. Does the page feel open and orderly without nested cards or thick structural borders?
4. Can someone see where to answer and distinguish filled, missing, current and flagged states without interpreting color as a score?
5. Are microphone and listening controls self-explanatory, and is saved/playable/processing status obvious?
6. Does the compact overview make it easy to move around and return to unfinished work?

Use PDF page references in review notes. If a treatment is intentionally different from the PDF, state why: Noto follows the newer user preference; an optional Vietnamese toggle supplements the proposed English default; neutral answer styling resolves the PDF's warning about green correctness cues. Do not say the evaluator requested the exact proposed tokens or dimensions.

### Formative task study

Proposed sample: 5–8 representative learners plus 1–2 staff observers if available. This is a practical formative round, not a statistically powered preference result. The executor prepares the protocol and local artifacts; contacting/recruiting people or sending messages requires the user's instruction.

Use synthetic identities and non-sensitive observations. Have participants complete:

| Task | Observe/record |
|---|---|
| Start and find instructions | Time to first correct action, hesitation, whether instructions are missed. |
| Record, listen and replace a read-aloud take | Permission confusion, replay discovery, confidence that the intended take is saved. |
| Fill a vocabulary/grammar passage | Mis-clicks, lost place, keyboard/touch friction, whether option selection obscures context. |
| Answer listening blanks | Ability to control audio while typing; missed text/caret movement; interpretation of filled styling. |
| Flag a question and revisit it | Navigation path, wrong question jumps, understanding of flags versus completion. |
| Refresh and resume a partial attempt | Whether the correct state returns and whether save wording matches participant expectations. |
| Review, fix one missing answer and finish | Ability to locate omissions, duplicate confirmation confusion, understanding of demo completion. |

Record task completion without assistance, navigation/input errors, time on task, recovery success, one ease rating after each task, and verbatim short observations with consent. Separate English knowledge errors from UI errors; a UI selection task can specify which visible option to choose.

For comparisons, log exact demo ID, font/viewport and candidate revision. Counterbalance A/B/C/D order where possible and use equivalent task material to reduce practice effects. Preserve the old lab; do not modify its content or fonts just to manufacture a controlled comparison. Treat unmatched comparisons descriptively and avoid claiming statistical superiority.

**Proposed decision rule:** first resolve any reproducible lost work, inaccessible answer control, mistaken correctness feedback or inability to finish the demo. Then prioritize repeated confusion and task friction over average star scores. Report medians/ranges and individual failures; do not invent a percentage improvement target before a comparable baseline exists. The small historical rating sample does not select the final design by itself.

### Milestone labels

- **Implemented:** required screens and interactions exist.
- **Locally verified:** automated and manual local checks have recorded outcomes; remaining device/human items are listed.
- **User visually accepted:** the user has accepted the complete candidate or named revisions.
- **Learner evaluated:** the formative tasks were actually run and their findings recorded.
- **Production ready/deployed:** separate later milestones; neither is reached by this demo package.

## 12. Separate production integration backlog

These items are recorded to keep the demo compatible with later integration. They are **not execution tasks in this package**, and the intentional QA answer helpers remain available now.

| Later workstream | Concrete decisions/work required before live use |
|---|---|
| Demo/production separation | Choose how the evaluator/QA environment is isolated; remove answer-key/test-only exposure from the actual learner delivery path; verify served artifacts and data responses. Do not merely hide a QA button with CSS. |
| Real attempt adapter | Map stable question/blank IDs to the current public-session and save APIs. Preserve exact text and the server's expected answer ordering; do not send the candidate draft object as an assumed API payload. |
| Draft migration/sync | Specify supported old `stepIndex` drafts, content version mismatch behavior, local/remote conflict handling, offline recovery and identity boundaries per attempt token. |
| Audio upload | Adapt the committed local Blob to the existing upload/assessment contract, correct MIME/file extension, retries and server acknowledgement. Local storage success is not upload success. |
| Submission integrity | Define idempotent final submit, recovery after lost response, receipt/status fetch and already-submitted behavior. Verify link locking and error codes against the current server. |
| Academic policy | Obtain decisions on language default, mic-check requirement, navigation/backtracking, retakes, replay limits/speed, empty-answer allowance, timing and completion policy. Do not infer them from reference exam screenshots. |
| Pronunciation/scoring | Preserve mandatory expected-text forced alignment, separate communicative accuracy/syllable precision and normalized IPA if pronunciation comparison is integrated. This demo introduces no alternative scoring. |
| Staff results/PDF | Verify downstream result display, recordings, blank mapping and exports against real submitted test fixtures in the authorized environment. |
| Release | Freeze reviewed SHA/file inventory, run authorized end-to-end and persisted-state checks, stage exact artifacts and obtain explicit publishing instruction. Keep rollback source/artifacts and verify the actual live deployment afterward. |

An unresolved production item does not block visual demo delivery. Conversely, completion of the demo is not evidence that those items are solved.

## 13. Rollback and completion checklist

Demo D rollback is local and narrow: remove D from the evaluator's selectable `SKINS` list and restore only its host integration diff if withdrawing the candidate. Keep the standalone candidate branch, evidence and any additive `d:*` rating values for review; do not delete rating fields or rewrite A/B/C history. Do not reset the shared checkout, delete all IndexedDB/localStorage or remove another task's files. No production rollback is necessary because this package does not publish.

Before handing execution back:

- [ ] User's demo/QA correction remains explicit; helpers are available.
- [ ] Demo D is the fourth CRM evaluator design, its rating column is active, and old 120-rating records retain all A/B/C values.
- [ ] Noto Sans is the verified Demo D default for English and Vietnamese, with real weights and Vietnamese coverage.
- [ ] Every PDF feedback row has a treatment and observed result.
- [ ] All eight pages and all 13 groups work; 45 written blanks and three recordings map correctly.
- [ ] Reload, save failures, recording replacement, exact text and one final receipt are covered.
- [ ] Mobile, keyboard, focus, text-size and reduced-motion checks have results.
- [ ] Legacy lab, A/B/C rating values, font votes and production surfaces retain their protected contracts; D uses additive `d:*` ratings and the 160-score completion target.
- [ ] Changed files match the external declaration; tests are meaningful and required checks have honest statuses.
- [ ] Evidence links and candidate launch instructions resolve; source identity is recorded.
- [ ] Human evaluation and production integration have distinct statuses.
- [ ] No push/deployment or unrelated implementation-plan edit occurred.

## 14. Copyable executor handoff

> Read `C:/Cursor AI/docs/plans/2026-09-13-entrance-test-ui-demo-overhaul-handoff.md` and the linked audit/PDF evidence. Implement Demo D as the fourth selectable and rateable Entrance Test UI demo in the existing CRM evaluator, within the exact path inventory and after execution authorization. Preserve intentional QA helpers and defer production answer-key isolation. Default both English and Vietnamese roles to verified local Noto Sans using genuine regular/medium/semibold faces; temporary evaluator font previews must remain separate from saved font votes. Follow the PDF matrix's light, flat, restrained design, inline blanks, simple audio and compact review/navigation. Extend the rating matrix additively to `d:*` and 160 required scores while preserving every existing A/B/C value and font vote. Use the proposed Astra Medium / Light route / Standard / no-subagent lineup once confirmed for this package. Work in an isolated `codex/` worktree, record an external task contract and snapshot, preserve unrelated work, and keep the original A/B/C demos intact. Complete tasks 0–10, run proportionate Chrome/state/persistence/CRM/structure checks as specified, and write the execution report with actual evidence and explicit pending human checks. Do not modify the unrelated root `implementation_plan.md`, change production learner APIs/scoring, push or deploy. If current source differs, report and resolve the concrete discrepancy within the approved boundary rather than inventing compatibility.

**Status at plan handoff:** PDF and current source findings incorporated; Projects font verified; execution specification prepared. Product implementation, candidate acceptance tests, learner evaluation and production integration have not started in this planning turn.

Planning verification is limited to source/path/contract consistency and the documentation structure checks. Product tests do not apply to this documentation-only change; the implementation checks above are requirements for the future candidate, not completed results.
