# Read Aloud Practice UI — Four Repairs

**Date:** 2026-08-04
**Branch:** `codex/speaking-ui-review-repair`
**Status:** ✅ Implemented and verified (2026-08-04). Not deployed — production push requires
an explicit instruction. See the Verification section for the evidence.

---

## Context

While using the Read Aloud practice screen (V1.8.45, Advanced view), four defects were
reported:

1. There is no way to switch between **random** and **in-order** question navigation when
   using the ◀ / ▶ buttons.
2. The **Read → Prep → Record → Results** stepper renders like a static image; it never
   advances as the practice flow proceeds.
3. Guide modes are **mutually exclusive** — Reduced words and Linking cannot be shown at
   the same time.
4. The **Settings** sheet (Practice Target tab) is visually disorganised.

All four are real defects confirmed by reading the source. The intended outcome is a
practice screen where navigation order is user-controlled, the stepper reflects true
state, guide overlays compose, and the settings sheet is scannable.

---

## Diagnosis

### 1. Navigation is random-only

`loadNextPrompt()` — [public/read-aloud-mode.js:1251](../../public/read-aloud-mode.js#L1251) —
always picks `candidatePool[Math.floor(Math.random() * candidatePool.length)]`.

`loadPreviousPrompt()` — [public/read-aloud-mode.js:1243](../../public/read-aloud-mode.js#L1243) —
re-applies `this.lastPromptRow`, a **one-slot history**, not a true previous neighbour.
Pressing ◀ twice returns the same prompt.

No ordering state exists anywhere in the class.

### 2. Stepper is pinned at index 0

[public/js/speaking-practice-steps.js](../../public/js/speaking-practice-steps.js) is fully
functional: `setCurrent(index)` writes `data-state="complete|current|upcoming"` on each
`.spc-step`, and [public/speaking-practice-controller.css:147-164](../../public/speaking-practice-controller.css#L147)
styles all three states.

`syncStepPreview(state)` — [public/js/speaking-practice-controller.js:1057](../../public/js/speaking-practice-controller.js#L1057) —
reads `config.getStepIndex()`, defaulting to `0` when absent. **No adapter in
[public/js/speaking-practice-adapters.js](../../public/js/speaking-practice-adapters.js)
defines `getStepIndex`**, so every mode is frozen on step 1 forever.

Three modes (`rts`, `sgd`, `describe-image`) also ship their **own** working breadcrumb —
but [speaking-practice-controller.css:191-198](../../public/speaking-practice-controller.css#L191)
hides those with `display: none !important`, stating the shared preview is meant to be the
only learner-facing indicator. So there is no visible duplicate: the working breadcrumbs
are hidden and the frozen shared stepper is what learners actually see. See Fix 2b.

Correction from first-pass review: **no new public API is needed.** `syncController()`
already calls `syncStepPreview()` ([speaking-practice-controller.js:1363](../../public/js/speaking-practice-controller.js#L1363))
and is exposed as `SpeakingPracticeController.sync(modeId)`
([:1562](../../public/js/speaking-practice-controller.js#L1562)) — already used by
`asq-mode.js`, `rts-mode.js`, `take-notes-mode.js`, and Read Aloud itself
([read-aloud-mode.js:1153](../../public/read-aloud-mode.js#L1153)). The fix is therefore
two small pieces: supply `getStepIndex`, and call the existing `sync()` on state change.

### 3. Guide modes are a single enum

`this.connectedSpeechLevel` holds one of `off | linking | reduced_words | sound_changes`.
`toggleConnectedSpeechLevel()` ([:2020](../../public/read-aloud-mode.js#L2020)) *replaces*
the value rather than adding to a set, and `updatePromptGuideButtons()`
([:1769-1774](../../public/read-aloud-mode.js#L1769)) drives the button states from
`level === '<mode>'` equality checks.

The renderers take one scalar `focusFamily` and early-return for everything else:

| Function | File | Exclusive gate |
|---|---|---|
| `renderOverlay` | [read-aloud-linking.js:450](../../public/js/read-aloud-linking.js#L450) | bails when family is `reduced_words` or `off` |
| `applyTokenAnnotations` | [read-aloud-linking.js:692](../../public/js/read-aloud-linking.js#L692) | bails *unless* family is `reduced_words` or `all` |
| `buildAccessibleSummary` | [read-aloud-linking.js:232](../../public/js/read-aloud-linking.js#L232) | single-family empty-state text |
| `renderFallbackList` | [read-aloud-linking.js:608](../../public/js/read-aloud-linking.js#L608) | `!== 'sound_changes'` / `!== 'linking'` section gates |

**The data layer is already sufficient.** `analyzePrompt()` with
`enabledRuleSet: 'connected-speech-v3'` ([read-aloud-linking.js:146-226](../../public/js/read-aloud-linking.js#L146))
returns linking boundaries, assimilation boundaries *and* reduced-word `tokenAnnotations`
in a single pass. Only the display gate is exclusive — no new analysis work is required.

Chunking is already an independent boolean (`this.chunkingEnabled`) and composes fine.

### 4. Settings sheet has unlabelled filter rows

`initSettingsSheet()` ([:1616-1640](../../public/read-aloud-mode.js#L1616)) moves two raw
pill rows out of `#ra-practice-target-drawer`
([public/index.html:5167-5186](../../public/index.html#L5167)) into the Practice Target
panel. Those two rows carry **no `read-aloud-filter-label`** — only the
programmatically-built Difficulty section does. Result: two ambiguous "All" buttons
stacked above each other, centre-justified pills of mixed widths wrapping unevenly, and
`#ra-filter-feature-status` sitting inside the pill flex row.

---

## Proposed Changes

### Fix 1 — Random / in-order navigation toggle

**Files:** `public/read-aloud-mode.js`, `public/js/speaking-practice-controller.js`,
`public/speaking-practice-controller.css`

- Add `this.promptOrderMode` (`'random' | 'sequential'`), defaulting to `'random'`,
  persisted to `localStorage` under `ra-prompt-order-mode` — mirroring the existing
  persistence pattern at [read-aloud-mode.js:3117](../../public/read-aloud-mode.js#L3117).
- Add `getOrderedPromptPool()` returning `getFeaturedPromptPool(getFilteredDatabase())`, and
  `getCurrentPoolIndex()` locating `this.currentPromptRow` within it.
- Rewrite `loadNextPrompt()` to branch: `random` keeps the existing sample-audio-weighted
  pick; `sequential` advances to `pool[index + 1]` with wrap-around.
- Rewrite `loadPreviousPrompt()` to branch: `random` keeps `lastPromptRow` (unchanged
  behaviour); `sequential` steps to `pool[index - 1]` with wrap-around.
- Render a compact segmented control (🔀 Random / 🔢 In order) inside `.spc-picker-nav`
  in `buildControllerDOM()` ([speaking-practice-controller.js:658-697](../../public/js/speaking-practice-controller.js#L658)),
  shown only when the adapter declares `picker.orderModes`. Wire it in the Read Aloud
  adapter to `window.ReadAloudMode.setPromptOrderMode(mode)`.

Sequential order is defined over the **filtered** pool, so it stays consistent with the
active Practice Target and Difficulty filters.

### Fix 2 — Live stepper (all modes)

**Files:** `public/js/speaking-practice-adapters.js`, `public/read-aloud-mode.js`,
`public/asq-mode.js`, `public/take-notes-mode.js`

#### 2a. Read Aloud — drop the "Read" step

There is no distinct Read phase. `startPrepTimer()` fires the moment a prompt loads
([read-aloud-mode.js:1357](../../public/read-aloud-mode.js#L1357)), so state goes
`IDLE → PREP` immediately and a "Read" step could never be observed. Reading *is* the
prep activity — the status line during `PREP` literally says "Read the text silently to
prepare" ([:2398](../../public/read-aloud-mode.js#L2398)).

Change `steps` from `['Read', 'Prep', 'Record', 'Results']` to
**`['Prep', 'Record', 'Results']`** and add `getStepIndex()` mapping
`window.ReadAloudMode.state`:

| State | Step |
|---|---|
| `IDLE`, `PREP` | 0 — Prep |
| `REQUESTING_MIC`, `RECORDING`, `STOPPING_RECORDING`, `RECORDED` | 1 — Record |
| `RESULTS` | 2 — Results |

Call `window.SpeakingPracticeController?.sync?.('read-aloud')` at the end of
`updateUIForState()` ([:2359](../../public/read-aloud-mode.js#L2359)) — the single choke
point already invoked by every state transition. No new API surface.

#### 2b. Audit of the other modes

Every speaking mode was frozen on step 1, and four of them advertised phases their state
machine never enters. Three modes keep their own breadcrumb updated but hidden by CSS —
that hidden state is exactly the live signal the shared stepper needs, so it is reused
rather than duplicated.

| Mode | Old `steps` (frozen) | Real phases | Action |
|---|---|---|---|
| `read-aloud` | Read, Prep, Record, Results | PREP → RECORD → RESULTS | **Fix 2a** — drop "Read", drive from `ReadAloudMode.state` |
| `asq` | Listen, Answer, Results | idle → `isRecording` → result shown | Labels correct; drive from `ASQMode.isRecording` + `#asq-result-box` |
| `speak` | Listen, Record, Results | inline in `script.js`, no state var | Labels correct; drive from record/check/retry button visibility |
| `notes` | Audio, **Notes**, **Record**, Results | Guiding video → listen and take notes → results | **Relabel** `['Video', 'Notes', 'Results']`. "Record" was fictional — Retell Lecture is note-taking plus a text submit and never records |
| `rts` | Audio, Prep, Record, Results | audio → prep → record → results | Labels correct; drive from `#rts-step-progress` |
| `sgd` | Discussion, **Prep**, Record, Results | listen → record → results | **Relabel** `['Listen', 'Record', 'Results']` — the "Prep" phase does not exist |
| `describe-image` | Image, **Prep (25 s)**, **Record (40 s)**, Results | prepare → record → review | **Relabel** `['Prepare', 'Record', 'Review']` to match the state machine |
| `type` | none declared | n/a | No change |

For `rts` / `sgd` / `describe-image`, a shared `activeBreadcrumbIndex()` helper reads the
`.active` item from the mode's own (hidden) breadcrumb node. Those three mode files need
no state-machine changes — only a `sync()` call added to the breadcrumb updater they
already run on every transition.

### Fix 3 — Composable guide modes

**Files:** `public/read-aloud-mode.js`, `public/js/read-aloud-linking.js`

- Introduce `this.connectedSpeechModes` (a `Set`) as the source of truth. Keep
  `connectedSpeechLevel` as a **getter/setter facade** — the getter returns the highest-
  precedence active mode (`sound_changes > reduced_words > linking > off`), the setter
  collapses the set to that single mode. This preserves all ~25 existing consumers
  unchanged: analytics payloads, `getPromptAnalysisCacheKey()`
  ([:2007](../../public/read-aloud-mode.js#L2007)), `sessionConnectedSpeechLevel` in
  recording sessions ([:2548](../../public/read-aloud-mode.js#L2548)), results rendering
  ([:3410](../../public/read-aloud-mode.js#L3410)), and the browser tests that pin those
  labels.
- `toggleConnectedSpeechLevel(mode)` adds/removes from the set instead of replacing.
- `updatePromptGuideButtons()` drives each button from `modes.has(mode)`, so several can
  read as active simultaneously. The existing per-button `colorMap`
  ([:1762](../../public/read-aloud-mode.js#L1762)) already gives each guide a distinct
  colour, so overlapping layers stay visually distinguishable.
- `hydrateLinkingView()` always requests the superset ruleset
  (`connected-speech-v3`) when the set is non-empty, and passes
  `focusFamilies: [...modes]` alongside the existing scalar `focusFamily` (kept for
  backwards compatibility).
- In `read-aloud-linking.js`, change the four gate functions to accept
  `options.focusFamilies` (array) and fall back to `[options.focusFamily]` when absent.
  Each becomes an inclusion test (`families.includes('linking')`) rather than an equality
  test, so layers render independently and additively.

The multi-guide instruction copy at
[read-aloud-mode.js:1829-1837](../../public/read-aloud-mode.js#L1829) — `Active guides:
X + Y` — **already exists and is currently unreachable**; this change makes it live.

### Fix 4 — Settings sheet cleanup

**Files:** `public/index.html`, `public/read-aloud-mode.js`, `public/style.css`

- Add a `read-aloud-filter-label` heading to each of the two orphan rows in
  [index.html:5167-5186](../../public/index.html#L5167): **🎵 Sample Audio** and
  **🗣️ Prompt Feature** — matching the existing Difficulty section markup built at
  [read-aloud-mode.js:1631](../../public/read-aloud-mode.js#L1631).
- Wrap each group's pills in a `.read-aloud-filter-buttons` container and drop the inline
  `justify-content: center`, so all three sections share one left-aligned rhythm.
- Move `#ra-filter-feature-status` out of the pill flex row into its own line beneath.
- Normalise pill sizing in CSS so wrapped rows align.
- Per the workspace UI rule, keep the sections flowing on the panel background — **no new
  nested card wrappers**.

---

## Files Touched

| File | Fixes |
|---|---|
| `public/read-aloud-mode.js` | 1, 2a, 3, 4 |
| `public/js/read-aloud-linking.js` | 3 |
| `public/js/speaking-practice-controller.js` | 1 |
| `public/js/speaking-practice-adapters.js` | 1, 2a, 2b |
| `public/asq-mode.js`, `public/take-notes-mode.js` | 2b (expose a step signal) |
| `public/index.html` | 4 |
| `public/speaking-practice-controller.css`, `public/style.css` | 1, 4 |

`rts-mode.js`, `sgd-mode.js` and `describe-image-mode.js` need **no changes** — fix 2b for
those three is purely the removal of the redundant `steps` array from their adapter
entries.

---

## Verification

Chrome is the mandatory browser; credentials in `.local/browser-test-credentials.md`.

**Existing suites to re-run (all must stay green):**

```bash
node tests/browser/speaking-ui-review-regression-check.js
```

```bash
node tests/browser/speaking-ui-full-audit.js
```

```bash
node tests/browser/read-aloud-lifecycle-browser-check.js
```

```bash
node tests/browser/read-aloud-question-picker-v7-dom-contract-browser-check.js
```

```bash
node tests/browser/speaking-settings-audit.js
```

These assert only the *presence* of `.spc-steps` / `[data-spc-step]`, not the active
index, so they should pass without modification. Confirm rather than assume.

**Manual empirical checks (screenshot each):**

1. **Order toggle** — set In order, press ▶ three times, confirm IDs increment by one;
   press ◀, confirm it returns to the previous ID. Reload and confirm the choice persists.
   Switch to Random and confirm non-sequential IDs.
2. **Stepper (Read Aloud)** — confirm exactly three steps render (Prep / Record /
   Results, no "Read"), then record one full attempt and capture the stepper at each
   phase, confirming `data-state` moves through `complete` / `current` / `upcoming`.
2b. **Stepper (other modes)** — open each of `asq`, `speak`, `notes`, `rts`, `sgd`,
   `describe-image` and confirm **exactly one** stepper is visible per mode, that it
   advances, and that its labels match what the screen actually asks the user to do.
   Specifically: `notes` must no longer show a "Record" step, `sgd` must no longer show a
   "Prep" step, and `rts` / `sgd` / `describe-image` must show only their own breadcrumb.
3. **Multi-guide** — enable Linking *and* Reduced words together; confirm both the
   blue linking arcs and the amber weak-form underlines render on the same sentence, both
   buttons show `aria-pressed="true"`, and the instruction line reads
   `Active guides: Linking (consonant-vowel joins) + Reduced Words (weak forms).`
4. **Settings** — open ⚙ Settings → Practice Target and confirm three labelled,
   left-aligned sections with no duplicate bare "All" ambiguity.

**Result (2026-08-04):** all four fixes verified in headless Chrome via a new suite,
`tests/browser/read-aloud-practice-ui-repairs-check.js` — **29/29 checks pass**. Existing
suites re-run green: `speaking-ui-review-regression-check` (109 assertions),
`read-aloud-lifecycle-browser-check` (20), `read-aloud-question-picker-v7-dom-contract`,
`speaking-settings-audit`. `EXPECTED_STEP_COUNTS` in the regression check was updated from
the old incorrect values (read-aloud 4→3, describe-image 4→3, notes 4→3, sgd 4→3).
`tests/read-aloud-mode-regression.test.js` fails to boot its server for want of Firebase
credentials — confirmed identical on a stashed clean tree, so it is environmental.
Screenshots in `test-results/read-aloud-practice-ui-repairs/`.

**Post-implementation review (2026-08-04)** found and fixed one latent defect plus three
refactors:

- **Semantic trap in the family filter.** The four render gates disagreed about what an
  *unspecified* focus family meant — `renderOverlay` and `applyTokenAnnotations` treated it
  as "render nothing", while `buildAccessibleSummary` and `renderFallbackList` treated it as
  "render everything", and `renderAssimilationBadges` had no gate at all. The first version
  of this refactor flattened all five to "everything", which silently revived the dormant
  results-panel overlay at [read-aloud-mode.js:3889](../../public/read-aloud-mode.js#L3889)
  — a call site that has never rendered because it passes no options. `resolveFocusFamilies`
  now returns `null` for "unspecified" (distinct from `[]` for "nothing active") and each
  renderer keeps its own documented historical default, pinned by a regression check.
- `sessionConnectedSpeechLevel` is now a **derived accessor** over
  `sessionConnectedSpeechModes` instead of a separately stored string, removing the class of
  bug where the two drift apart. (The first pass assigned both, which would have collapsed a
  multi-guide session back to one mode on every change.)
- The dominant-mode precedence chain was duplicated across two getters; extracted to
  `ReadAloudMode.dominantConnectedSpeechMode()`.
- Nine `connectedSpeechLevel === 'off'` string comparisons in the render path replaced with
  `isConnectedSpeechEnabled()`.
- ASQ's `resetResultUI()` now resyncs the stepper, so clearing a result cannot leave the
  indicator stranded on Results.

### Fix 5 — Restore the Speech Coach results linking overlay (follow-up, 2026-08-04)

The review flagged the results-panel overlay at
[read-aloud-mode.js:3865-3891](../../public/read-aloud-mode.js#L3865) as dead code. Git
history shows it is not unimplemented — it is a **regression**:

| Commit | Date | Effect |
|---|---|---|
| `9a9bfd4f` V1.6.1 (Speech Coach) | 2026-03-30 | Added the overlay. `renderOverlay` had no family gate, so it rendered. |
| `daa9420b` V1.8.28 | 2026-07-25 | Added the family gate. The no-options call site began early-returning, silently blanking the overlay. |

So the feature worked for ~4 months and broke 10 days before this plan. Supporting
evidence that it is wanted:

- `renderOverlay` honours per-boundary colours at
  [read-aloud-linking.js:552](../../public/js/read-aloud-linking.js#L552)
  (`boundary.strokeColor || pathColor`) — built specifically for this call site, which is
  the only place that sets `strokeColor`.
- `.sc-linking-overlay` is fully styled in [style.css:19615](../../public/style.css#L19615)
  (absolute, inset 0, `pointer-events: none`, `z-index: 0`).
- The arc colours (`#10b981` / `#ef4444` / `#f59e0b`) are the same palette as the
  `.sc-token-bg--success/error/uncertain` highlights, and the results panel renders a
  **"● Good ● Needs practice ● Unclear" legend** directly beneath the paragraph — a legend
  that was only half-explaining itself while the arcs were missing.

**Decision: restore (option a).** The call site now passes `{ focusFamilies: ['linking'] }`.
Verified by `tests/browser/read-aloud-results-linking-overlay-check.js` (10/10), which
builds its fixture from a live `analyzePrompt` run so the phrases match real boundaries,
then asserts arc count, per-status colours, 2px stroke, `pointer-events: none`, absolute
positioning behind the text, containment within the paragraph box, and that token
annotations still render alongside. Screenshot:
`test-results/read-aloud-practice-ui-repairs/results-linking-overlay.png`.

The `renderOverlay with no options still renders nothing` check remains valid and passing —
it pins the *default*, which is unchanged; this call site now asks explicitly.

Two implementation notes worth keeping:
- Sequential navigation must capture the current row **before** `beginPromptLoad()`, which
  clears `currentPromptRow`. Without that anchor, every press restarts at index 0.
- The order toggle is appended to the DOM only when an adapter declares `picker.orderModes`.
  Rendering it hidden left zero-height buttons that failed the shared 44px touch-target
  assertion in other modes.

**Regression watch:** the Speech Coach results panel
([read-aloud-mode.js:3410](../../public/read-aloud-mode.js#L3410)) reads
`sessionConnectedSpeechLevel`. Verify a post-recording results render still shows the
correct layer filter after the getter/setter facade lands.

**Tracking:** append a row to `TASK_TRACKER.csv` with status `In Progress` at start; update
to `Done` with the Done Date only after the checks above produce evidence.

**Deployment:** none. Per workspace rules, no production push without an explicit
instruction.

---

## Round 2 — six further defects reported from the same screens (2026-08-04)

**Status:** ✅ Implemented and verified. Not deployed.

New suite: `tests/browser/practice-ui-repairs-round2-check.js` — **34/34 checks pass**.

| # | Report | Root cause | Fix |
|---|---|---|---|
| 1 | Easy Reading still on screen after Check (RFIB) | `checkAnswers()` set `state.supportVisible = true` on every grade, and the button was never hidden | Drop the forced reveal; hide the button and collapse the panel on Check, restore both in `resetActionButtons()` |
| 2 | D&D explanations should work like RFIB (? → popover) | D&D rendered a "Show explanation" heading plus one always-open card per blank | Replaced with a per-blank `?` button in the passage and a `.dd-popover` (answers, cues, clue, distractor analysis, explanation); score line now reads `x/y blanks correct — Click ? for explanations` |
| 3 | Random toggle dead in D&D | `DDMode.activate()` called `setupEventListeners()` on every activation — every other mode guards it. Two stacked handlers flipped the flag twice per click | Bind once behind `state.listenersBound`. Also made `updateNavigationUI()` random-aware in `dd`, `rop`, `rmcma`, `rmcsa`: the arrows walk the shuffle history, so list position must not disable them |
| 4 | Speaking should use Random ON/OFF, not "In order" | Round 1 shipped a two-button segmented control | One `.spc-order-toggle` button carrying 🎲 Random: ON/OFF with `aria-pressed`, matching the Reading modes |
| 5 | Stepper stuck on Record while a result was on screen | `submitToAzure()` renders an error result panel and returns `false`; only the success path set `state = 'RESULTS'` | `showAssessmentDisplay()` — the one place the result panel becomes visible — now advances the state machine. Added `assessmentStatusMessage` so the RESULTS branch of `updateUIForState()` cannot overwrite a scoring error with "Analysis complete." |
| 6 | UI glitch with Reduced words + Sound changes | Both layers wrote inline styles; the sound-change renderer used `style.cssText +=`, so a word in both layers lost its weak-form treatment entirely (confirmed in Chrome: the amber fill was replaced outright) | Both layers now style through CSS classes, with a combined rule that keeps the reduced-word fill and the sound-change dashed rule on shared words |

Screenshots: `test-results/practice-ui-repairs-round2/`.

`tests/browser/dd-mode-browser-check.js` and the order-toggle section of
`tests/browser/read-aloud-practice-ui-repairs-check.js` were updated to the new
contracts. Suites re-run green afterwards: `practice-ui-repairs-round2-check`
(34), `read-aloud-practice-ui-repairs-check`, `read-aloud-results-linking-overlay-check`
(10), `speaking-ui-review-regression-check` (109), `speaking-controller-browser-check`
(185), `read-aloud-lifecycle-browser-check` (20),
`read-aloud-question-picker-v7-dom-contract-browser-check`.

`dd-mode-browser-check`, `rfib-mode-browser-check`, `rmcma`, `rmcsa` and `rop`
complete every functional assertion but exit non-zero on a page error from the
Firebase CDN (`firebase-auth.js does not provide an export named
'signInWithCustomToken'`). Confirmed identical on a stashed clean tree —
environmental, not caused by this work.

---

## Out of Scope (flagged, not fixed)

- `renderFallbackList()` is exported from `read-aloud-linking.js`
  ([:1041](../../public/js/read-aloud-linking.js#L1041)) but **never called** —
  `hydrateLinkingView()` clears `#ra-linking-fallback-list` and hides it manually
  ([read-aloud-mode.js:1952-1958](../../public/read-aloud-mode.js#L1952)). On viewports
  narrower than `DESKTOP_MIN_WIDTH` (560 px) the guide layers therefore render nothing at
  all. Pre-existing mobile defect, worth its own task.
- Visually unifying the three mode-owned breadcrumbs (`rts-step-progress`,
  `sgd-step-progress`, `di-step-progress`) with the shared `.spc-steps` styling. They work
  correctly after this pass but each has its own bespoke look. A later consolidation could
  migrate them onto `SpeakingPracticeSteps` and delete the duplicate markup and CSS.
