# Entrance Test Demo D: visual re-audit

Date: September 13, 2026, Vietnam Time. Owner: Codex root. Status: evidence gathered; redesign proposed, awaiting approval. This is documentation-only work on the Light route. No deployment, learner submission, scoring, rating update or font vote was performed.

## Evidence identity and limits

| ID | Evidence checked this turn | Identity and limits |
|---|---|---|
| E01 | Shared workspace and release source | Shared `C:/Cursor AI` HEAD is `d188648e36ef0c505951fdb622536654051adb82`, with substantial pre-existing dirty work. D is absent there. D source was read from clean `C:/Users/Admin/.codex/worktrees/entrance-test-ui-demo-release-20260913/Cursor AI`, HEAD `3157c6c40eb7669e9ee22f339877ac668feaa92c`. Do not build the redesign from the stale shared checkout. |
| E02 | Current public Hosting files | Thirteen GETs of A/B/C lab, CRM evaluator, D shell/CSS/eight JS modules/font CSS returned 200. Every file matches the release checkout after CRLF/LF normalization. Byte hashes differ because of line endings. This establishes these frontend assets' equivalence, not all production assets or server deployment provenance. |
| E03 | Fresh Firestore ratings | Read only `entranceTestUiRatings` in `listening-tasks-3ae34` at `2026-09-13T14:08:47.781Z` (9:08:47 PM Vietnam Time). Four documents, 410 valid A/B/C scores, no valid D scores. Raw snapshots and recomputation retained externally; no records changed. |
| E04 | Original feedback PDF | `C:/Users/Admin/Downloads/Entrance Test.pdf`, 15 pages, SHA-256 `d17f00c4f8ce966b7b6e6b6f148570f184810b7cc27264cb9aa3ffdea6b4bcc1`. All page text extracted again and rendered annotation contact sheet inspected. Author metadata is blank; attribution to Quỳnh comes from the prior report. |
| E05 | Local Chrome visual audit | Installed Chrome `153.0.8010.36`; exact release checkout served through a loopback Python server. 32 desktop states (A/B/C/D × eight screens, 1440×1000), 16 mobile states (C/D × eight, 390×844), D partial review and populated-state speaking: 50 snapshots. Zero pageerror events. These are inspection snapshots, not 50 passing acceptance tests. Synthetic local QA only; no authenticated CRM or real learner flow in this audit. |
| E06 | Prior analysis and handoff | Read `docs/entrance-test-ui-analysis.md`, `docs/audits/entrance-test/2026-09-13-ui-claims-audit.md`, and `docs/plans/2026-09-13-entrance-test-ui-demo-overhaul-handoff.md`. Preserve these historical documents. The new plan supersedes their visual direction only; preserve the earlier workflow and integrity requirements where consistent with verified source. |
| E07 | Proposed reference artboards | Nine static artboards (eight screens plus mobile) rendered in Chrome. These illustrate decisions, not a working candidate. Speaking uses actual first passage; several written-task artboards explicitly use excerpts/illustrative text to show composition. Implementation must render all canonical content without abbreviation. |

External evidence directory: `C:/Users/Admin/.codex/audits/entrance-test-d-visual-redesign-20260913-01a09b16/`. Includes `data-audit.cjs`, `ratings-live.json`, `ratings-summary.json`, `assets.json`, fetched text assets, `browser-audit.py`, `browser-results.json`, 50 screenshots, `comparison.jpg`, `pdf-text.json`, 15 PDF renders and `pdf-contact.jpg`. `render-spec.py`, `visual-spec.html` and `proposed-*.png` are design artifacts. `structure-contract.json` and `structure-before.json` declare the two new documentation paths and protect existing work. Retain the directory and original PDF until design approval and integration are resolved; no automatic cleanup. Historical reads are restored from retained JSON, while rerunning captures a new state. Product owner remains the user; executor ownership is defined in the handoff.

## What the ratings support

| Sample / metric | A | B | C | D |
|---|---:|---:|---:|---:|
| All valid ratings: count | 120 | 130 | 160 | 0 |
| All valid ratings: overall mean | 4.200 | 4.023 | 3.813 | No data |
| All valid ratings: visual mean | 4.250 | 3.538 | 3.563 | No data |
| Same three complete A/B/C raters: overall mean | 4.200 | 4.125 | 4.000 | No data |
| Same three complete A/B/C raters: visual mean | 4.250 | 3.667 | 3.833 | No data |

The complete-rater visual means each contain 24 scores from three people, not 24 independent participants. No sample supports the statement that C has the strongest aggregate visual score. C leads the complete-rater **intro overall** comparison (4.533 vs A 4.400/B 3.933), and PDF page 2 explicitly selects C as the preferred design. The user's latest instruction makes C the primary aesthetic foundation. That is the design authority; it does not require rewriting the ratings.

The earlier report correctly reproduces much arithmetic but conflates all-rater and matched-rater screen comparisons and overstates statistical conclusions. Raters did not record UI revision, viewing order, viewport or per-score font settings. C has all four raters; A has three; B has the fourth only for intro/mic. Do not infer statistical superiority, fatigue reduction, or a causal usability effect from these ordinal preference scores.

| Screen, same three complete raters | A | B | C | Practical use |
|---|---:|---:|---:|---|
| Intro | 4.400 | 3.933 | 4.533 | Preserve C's strong opening hierarchy and identifiable actions. |
| Mic check | 4.533 | 4.067 | 4.000 | Borrow A's readable, calm grouping; provide real playback. |
| Speaking | 4.267 | 4.667 | 4.467 | Borrow B's legible recording state; restore D's missing passage. |
| Vocabulary | 4.333 | 4.400 | 4.333 | Keep D's inline controls and A's reading measure. |
| Grammar | 4.333 | 4.467 | 4.133 | Keep strong instruction/control separation without outlines around every option. |
| Listening | 4.467 | 4.467 | 4.000 | Quiet transport, no decorative waveform. |
| Review | 3.600 | 3.400 | 3.133 | All weak: explicit redesign priority, not wholesale reuse. |
| Done | 3.667 | 3.600 | 3.400 | Clear credible receipt; avoid implying live submission. |

Fourteen unranked font picks remain unchanged. All four evaluators include Be Vietnam Pro for Vietnamese; Literata and Source Serif 4 each receive two English picks. Noto Sans is the user's newer direction, not an outcome of those votes. No historical votes should be recast as Noto approval.

## Four-demo visual audit

| Demo | Verified appearance | Retain for D | Correct or exclude |
|---|---|---|---|
| A, Editorial | Warm `#fbfaf7` canvas, Newsreader passage default, burgundy action, thin rules, quiet opening. | Reading measure, generous paragraph rhythm, low competition around text. | Do not import serif fonts or detached answer rail. Review and done are not strong precedents. |
| B, Instrument | White content under near-black header; bright green accents and compact numeric chrome; Lora passage default. It is not a full-screen dark design. | High contrast recording controls and precise elapsed-time display. | Green answer ticks imply correctness; decorative listening bars are unnecessary. No countdown exists to preserve. |
| C, Signal | `#101010` header, `#f2efe6` canvas, `#e8380d` accents, square 2px structural borders, 4px orange button offset, Archivo passage default. | Black top band, square geometry, strong structural rules, orange directional accent, numbered section rhythm and decisive actions. These must remain visibly recognizable. | White canvas per PDF; fewer heavy boundaries inside tasks, no beige field, no answer rail, no long sidebar. Keep a small CTA offset only. |
| Current D, Noto Focus | White canvas/header, blue rounded controls, thin gray rules, open columns and 260px text sidebar; Noto Sans computed as body family. | Local drafts/recording references, inline controls, free navigation/flags, language/text sizing, QA helpers, review and local receipt path. | Current composition has lost C's visual identity. Header tools, repeated metadata, sparse main content and review link wall need recomposition. |

A/B/C share markup and engine; their “container architecture” is not three distinct architectures. Their current appearances cannot establish exactly what each rater saw historically. The old report's instruction to strip C's borders, beige and offset shadows, followed by the prior handoff's white/blue/soft-divider specification, plausibly explains D's visual divergence. This is an inference from the documents and current result, not a measured causal finding.

## D defects and source constraints exposed by this audit

Source anchors below refer to the release checkout from E01; all served text modules matched E02.

| ID | Finding and evidence | Required disposition |
|---|---|---|
| D01 | `view.js::renderTask` constructs speaking passage HTML but substitutes only `renderRecorder` into `taskBody`. Desktop and mobile speaking snapshots contain no passage. | Display exact `question.text` above recording controls for all three read-aloud tasks; assert in rendered DOM, not data fixture alone. |
| D02 | English task instructions fall back to `copy.instruction` = “Instruction”. Normalized data supplies `instructionVi`, not English instructions. Chrome shows an “Instruction” label followed by “Instruction”. | Add explicit English instructional copy by section without rewriting assessment content; show one real instruction. |
| D03 | `renderReview` expands every missing blank into raw IDs such as `vocab_q1__b2`. Partially filled review remains a tall wall of links. Complete but flagged questions are omitted from its missing-only links. | Four section rows, 13 numbered group links, concise human labels, expandable missing-blank targets, and access to complete flagged questions. |
| D04 | Every D mobile snapshot measured 393px document width in a 390px viewport. | Eliminate horizontal overflow through layout/flex constraints; do not conceal it using overflow clipping. Recheck all pages and font/scale combinations. |
| D05 | `renderRecorder` shows elapsed time, “saved recording · Ns”, and native player duration. | Use one elapsed timer while recording and one duration in the committed player; remove redundant captions. |
| D06 | `app.js::drawBaseline` only paints a straight line. `audio.js` contains no analyser path. | A motionless line must not masquerade as a live level display. Implement the PDF's real mic signal line with deterministic cleanup, or retain truthful textual status while that acceptance item remains pending. |
| D07 | `render()` replaces the entire app/header markup; the timer emits every 250ms. Browser audit initially saw QA details close when an asynchronous render replaced the node. Source also rewires listening audio after rendering. | Preserve focus, details/dialog state and media elements during transient status updates. Verify playing audio, text composition and replacement recovery; do not assume the old tests prove them. |
| D08 | `wireListeningAudio` looks for `[data-audio-progress]`, while the view exposes `[data-audio-action="seek"]`. | Align the transport binding and prove progress/seek/time are synchronized. Current omission is source-verified; this turn did not measure playback continuity end to end. |
| D09 | Header and footer repeat save/demo labels. The original HTML footer includes text that the rendered footer repeats. | One polite save announcement; one visible demo scope label; nonduplicated save error/retry presentation. |

Recorded browser harness issues: the first inspection completed screenshots but a QA click raced a rerender. The next helper launch encountered a stale listener/empty response. The audit moved to an owned in-process random-port server and waited for the save render before opening QA; the final run completed with 50 saved observations and no page errors. These harness corrections are not product fixes. The deterministic QA-collapse observation is retained under D07.

The existing persistence, state and audio modules provide valuable behavior, but this inspection is not a fresh full regression pass. It would be inaccurate to describe every improved D workflow as verified correct. The redesign plan preserves those contracts and closes the observed presentation/lifecycle gaps with focused tests. Existing host-message checks are incomplete in source; any broader bridge hardening must be diagnosed and declared separately rather than silently folded into cosmetic changes.

## PDF-to-design traceability

| Pages | What is actually in the PDF | New plan's treatment |
|---|---|---|
| 1 | Cover. | No implementation requirement. |
| 2 | Chooses C; prefers Be Vietnam Pro/Literata; white background, black text, one or two extra colors. | C's identifiable structure retained; white canvas, charcoal and burnt orange. Noto supersedes the older font preference by user instruction. |
| 3 | Remove redundant welcome eyebrow, raise title; English UI preferred. | Title-first opening, one demo label in shell; complete English guidance with retained optional VI. |
| 4 | Remove preparation eyebrow; quiet line and peaks when speaking; missing playback noted. | Actual mic signal line plus record/stop/play, bounded state strip. |
| 5 | Larger, bolder instruction than question text. | 20px/600 instruction, 18px/400 passage at desktop; restore actual English instruction and speaking passage. Sizes are proposed. |
| 6 | Annotated redundant duration text. | One committed-recording duration, no extra duration sentence. |
| 7–8 | IELTS/PTE reference screenshots. | Hierarchy references only; no imported exam timing, retake or scoring policies. |
| 9 | Dropdowns preferred; detached answers require scrolling and hide passage context. | Keep native inline controls and all text in one flow. |
| 10 | Green check beside selected answer suggests correctness. | Neutral gray filled answer, visible value and descriptive state. |
| 11 | Familiar classic dropdown sufficient. | Native select; no custom listbox/sheet. |
| 12 | Listening bars too busy; filled blanks should stand out. | Simple transport and gray filled input state. |
| 13 | Repetitive review copy, mismatched numeric font. | Noto numerals, compact group rows, one missing summary and acknowledgement. |
| 14–15 | Compact part labels, numbered questions and clear answered states; example uses green answered navigation. | Persistent part/group dock; gray answered state and orange current marker. This palette choice deliberately differs from green example and uses labels/shapes too. |

The PDF does not categorically reject all of C's visual language, prescribe exact tokens, or demand a generic minimalist redesign. The new [visual specification and execution handoff](../../plans/2026-09-13-entrance-test-demo-d-visual-redesign.md) resolves the tension explicitly.

## Handoff status

Audit source/ratings/PDF/Chrome evidence is complete at the stated scope. Proposed design and acceptance requirements are prepared. Product implementation, full functional regression, accessibility certification, human listening, user visual acceptance and deployment have not occurred in this planning turn. Documentation verification results are recorded externally in `planning-verification.json` and structure output.
