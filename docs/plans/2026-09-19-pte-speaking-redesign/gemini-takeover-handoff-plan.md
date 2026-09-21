# PTE Speaking v3 — Gemini takeover handoff plan

**Prepared:** 2026-09-21  
**Implementation checkout:** `C:\Users\Admin\.codex\worktrees\b3d5\Cursor AI`  
**Branch:** `feat/pte-speaking-shell-v3`  
**Canonical specification:** `C:\Cursor AI\docs\plans\2026-09-19-pte-speaking-redesign\handoff-plan.md`  
**Purpose:** let a Gemini/Antigravity coordinator safely finish Phase 3 review and implement Phases 4–9 without reconstructing prior decisions or repeating resolved work.

> **Mandatory start gate satisfied:** Phase 3 remediation committed as `2215c8ef1953b580705d655fda81e930018c7084`, row 1110 is Done, the feature worktree is clean, no test processes or writers remain, and ownership is released. Gemini may begin with the fresh Phase 3 specification review in Section 5; it must not skip either review gate.

---

## 1. Outcome and authority

Finish the feature-flagged PTE Speaking shell v3 for the remaining speaking modes, prove both v3 and legacy behavior, and leave an evidence-backed local candidate. This handoff does **not** authorize merging, pushing, preview deployment, production deployment, live database/storage writes, branch cleanup, or worktree retirement.

Authority order:

1. `C:\Cursor AI\AGENTS.md` and the active Gemini/Antigravity host instructions.
2. `C:\Cursor AI\.agent\rules\parallel-work-safety.md`.
3. `C:\Cursor AI\agent_docs\project_structure.md`.
4. The canonical redesign specification at `docs/plans/2026-09-19-pte-speaking-redesign/handoff-plan.md`.
5. This takeover plan, which translates the specification into execution and verification gates.

If this handoff conflicts with a higher authority, follow the higher authority and record the conflict in the phase evidence. Do not silently reinterpret product behavior.

## 2. Current verified state

### 2.1 Completed foundation

- Phase 0 setup and baseline evidence: tracker row `1107`, Done.
- Phase 1 shared shell/components: tracker row `1108`, Done.
- Phase 2 Read Aloud: tracker row `1109`, Done. The independently accepted Phase 2 candidate is `7f806e86d8295bc5d8daaf114b71418a43fdd827`.
- Phase 3 Repeat Sentence began at `2a9cd7c0ef3f5d8aa7d861941f7971d76996c440` and received several bounded async-ownership remediations. Its current review candidate is `2215c8ef1953b580705d655fda81e930018c7084`.

### 2.2 Final Phase 3 implementation handoff

Tracker row `1110` is Done. Commit `2215c8ef1953b580705d655fda81e930018c7084` changes exactly:

- `public/css/pte-speaking-shell.css`
- `public/js/speaking-practice-adapters.js`
- `public/js/speaking-practice-controller.js`
- `tests/browser/pte-repeat-sentence-v3-browser-check.js`

The implementation restores the Phase 3.8 Question order, Status, Length and Difficulty filters plus Reset progress through existing handlers; keeps locked choices honest in the selected UI state; supports the real top-level history `score` while retaining zero and snapshot score/maxScore; and keeps the mobile Repeat Sentence menu inside the viewport and above the fixed header. The CSS ownership contract was amended before editing and is scoped to Repeat Sentence v3 at widths up to 600 px.

Verification recorded in `C:\Users\Admin\.codex\task-evidence\pte-phase3-spec-gap-01a0c1bb\handoff.json`:

- focused specification cases: 4/4 at 1440 and 390 widths
- protected listen-back, Second Take and single-publication cases: 30/30
- legacy controller: 186 passed, 0 failed
- full v3 flow and explicit legacy/default checks: passed at both widths
- shared shell components, pronunciation tooltip and practice-mode regressions: passed
- eight affected contract suites, syntax, `git diff --check` and local task-delta structure check: passed
- tested blobs match the commit; worktree clean; no active writer/test process

Limits: fixtures only; no real microphone, Azure assessment, signed-in Firebase mutation, push, merge, deployment or live write. Automatic release readiness remains blocked by 1,481 inherited committed-tree structure findings that are identical on base and candidate; the task introduced zero new findings and none on its owned paths.

### 2.3 Protected contracts

Preserve all of these throughout the remaining phases:

- `PteShellConfig.RELEASE_DEFAULT` remains `false`.
- `?pteShell=v3` is opt-in; `?pteShell=legacy` and the default legacy behavior remain functional.
- English Practice and Write from Dictation remain on the legacy shell.
- Each mode owns its timers and state machine; the shared shell only mirrors phase and hosts controls.
- Recording uses `AudioDspPipeline` as required by `AGENTS.md`.
- Pronunciation/text comparison uses Azure comprehensive phoneme-level forced alignment and normalized Oxford American IPA where applicable. Do not substitute a transcript-only similarity algorithm for pronunciation assessment.
- Existing archive schema and prior attempts remain readable. No data migration is part of this package.
- All provider, authentication, storage, AI-scoring, and persistence tests use local fixtures unless the user separately authorizes live testing.
- Existing capture helpers, legacy UI, mode loaders, Firebase configuration, and unrelated dirty work are protected.
- Never weaken assertions, delete a failing case, hide a control, or bypass a wait merely to make a test pass.

---

## 3. Coordination and ownership model

Gemini should act as coordinator and final auditor. Use a fresh, bounded implementation context for one phase at a time and a separate fresh read-only context for each review gate. Do not let an implementation writer review its own phase.

### 3.1 Serial execution is mandatory

The remaining phases overlap in shared files:

- `public/index.html`
- `public/js/speaking-practice-adapters.js`
- `public/js/speaking-practice-controller.js`
- `public/css/pte-speaking-shell.css`
- `public/css/pte-question-area.css`
- `TASK_TRACKER.csv`
- cross-mode browser harnesses

Therefore, run only one writer at a time. Do not parallelize Phase 4–8 implementation. Read-only investigation can run concurrently only when it does not claim mutable browser/emulator state and does not modify tests or evidence generators.

### 3.2 Per-phase lifecycle

Every phase follows this exact state machine:

1. **Coordinator preflight** — verify branch/HEAD, worktrees, status, current owner, base SHA, and tracker.
2. **Declare ownership** — write an external contract and before snapshot; list exact paths, not directories or wildcards.
3. **Set tracker row In Progress** — only the sole writer edits `TASK_TRACKER.csv`.
4. **Red tests first** — add focused assertions for the requested behavior and prove they fail for the intended reason.
5. **Implement the smallest vertical slice** — mode lifecycle, shell adapter, feedback, history, and responsive behavior work end-to-end.
6. **Focused green checks** — both `1440×900` and `390×844`, plus the mode's legacy regression.
7. **Affected shared regressions** — controller, components, archive/history, cross-mode and syntax/structure checks.
8. **Candidate freeze** — stop editing, record `git diff`, candidate SHA or staged paths, and exact commands/results.
9. **Commit only owned paths** — one focused commit, no unrelated files.
10. **Clean handoff** — verify clean worktree and release ownership.
11. **Fresh specification review** — compare implementation to the canonical phase requirements and target references. Verdict must begin `APPROVED` or `REJECTED`.
12. **Fresh code-quality review** — inspect async ownership, cleanup, recovery, compatibility and tests. Verdict must begin `APPROVED` or `REJECTED`.
13. If either review rejects, mark the tracker row In Progress and route the smallest bounded remediation. After the remediation, rerun **both** reviews; prior approval is stale after code changes.
14. Mark the phase Done only after implementation verification and both reviews pass.

### 3.3 Escalation guidance for Gemini

- Use the normal high-reasoning implementation mode for a new bounded phase.
- Escalate to the highest available reasoning mode immediately for interacting async ownership, archive publication, recording/audio lifecycle, or state-restoration problems.
- After one or two meaningful failed attempts, stop patching symptoms. Reproduce the race, identify the owner token/generation that should control the side effect, add a deterministic test, then implement the guard.
- Return to the normal tier after the difficult blocker is resolved.
- Do not claim a prose instruction changed the active model or reasoning mode. Record the actual selected mode in the task handoff.

---

## 4. Mandatory preflight and evidence setup

Run from PowerShell. Do not use `reset`, `stash`, `clean`, branch switching, or broad copy operations.

```powershell
$pteWorktree = 'C:\Users\Admin\.codex\worktrees\b3d5\Cursor AI'
$pteEvidence = 'C:\Users\Admin\.codex\task-evidence\pte-speaking-gemini-<phase>-<task-id>'

git -C $pteWorktree rev-parse --show-toplevel --git-common-dir HEAD
git -C $pteWorktree branch --show-current
git -C $pteWorktree status --porcelain=v1
git -C $pteWorktree worktree list --porcelain
git -C $pteWorktree log --oneline -20
```

Expected checkout:

- top level: `C:\Users\Admin\.codex\worktrees\b3d5\Cursor AI`
- branch: `feat/pte-speaking-shell-v3`
- no edits from another active owner

If the worktree is dirty, classify every path against the recorded owner. Do not take over, overwrite, commit, or move unknown work. Wait for the owner to hand off.

For each writer, create an external `structure-contract.json` under the evidence directory with:

- real task/session ID and owner
- exact base SHA
- exact create/modify/delete/rename paths
- external evidence output root and effect class
- protected contracts
- verification commands
- explicit exceptions, normally empty

Then capture the before state:

```powershell
node scripts/structure/check.cjs snapshot `
  --contract "$pteEvidence\structure-contract.json" `
  --out "$pteEvidence\structure-before.json"
```

At completion, run the local declaration check with the exact original base:

```powershell
npm run check:structure -- `
  --base <exact-base-sha> `
  --contract "$pteEvidence\structure-contract.json" `
  --snapshot "$pteEvidence\structure-before.json" `
  --json
```

Evidence must record:

- base SHA and candidate SHA
- `git status --porcelain=v1` before and after
- `git diff --name-status <base>..<candidate>` and `git diff --check`
- each command, cwd, exit code, and result count
- desktop/mobile viewport and flag value
- screenshots or traces only in the declared external evidence directory unless retained evidence is explicitly requested
- that provider/auth/storage/AI responses were local fixtures
- limitations and untested live boundaries

When the isolated worktree lacks dependencies, reuse the existing dependencies without copying them:

```powershell
$env:NODE_PATH = 'C:\Cursor AI\node_modules'
```

Browser login, if genuinely required, must use `C:\Cursor AI\.local\browser-test-credentials.md`. Do not copy its contents into source, logs, plans, or commits.

---

## 5. Gate A — finish and independently accept Phase 3

### 5.1 Takeover acceptance

Gemini's Phase 3 review baseline is:

- **Candidate SHA:** `2215c8ef1953b580705d655fda81e930018c7084`
- **Base of final remediation:** `4d889410a9472a9d902408d527b8129f5c0e6a60`
- **Status:** clean worktree; row 1110 Done; ownership released
- **Evidence:** `C:\Users\Admin\.codex\task-evidence\pte-phase3-spec-gap-01a0c1bb\handoff.json` and adjacent logs/contracts
- **Patch SHA-256:** `99e136eb8cf48fa112ec06ff05b69bb0a8586a11c853cd21c4139c1a4d080f18`

Review the entire Phase 3 delta, not merely the last four-file remediation commit.

### 5.2 Fresh Phase 3 specification review

The reviewer must inspect the exact candidate and the complete Phase 3 delta, not only the last commit. At minimum verify:

- wrapper/card body, automatic audio flow, countdown and recorder timing
- replay counts and first automatic play not consuming a replay
- Shadow lock, activation and cancellation behavior
- transcript hidden until feedback
- all dock controls and phases from Appendix D.2
- Filters: Recommended/Manual, Status, Length, Difficulty; each option calls an existing handler or existing element click
- More → Reset progress invokes the existing reset control
- rejected/locked filter changes do not leave the menu showing a false selected state
- two-column feedback, listen-back source/selection synchronization, missed-word practice, advanced analysis visibility
- Next/Retry/Cancel/unmount ownership; stale async work cannot replace a new attempt or navigate
- raw and assessed archive saves publish one event/invalidation per committed result
- signed-in history shows the real list-summary top-level score; guest history still works
- legacy flag-off behavior remains unchanged

Required review result: `APPROVED` or `REJECTED` with file/line references and exact checks.

### 5.3 Fresh Phase 3 code-quality review

Inspect for:

- a single owner/generation per question and attempt
- ownership checks immediately before UI, navigation, archive publication, cache invalidation and error-state side effects
- invalidation on Next, Retry, Cancel, question change and unmount
- no stale promise `finally` block clearing a newer attempt's state
- idempotent event/listener setup and cleanup
- audio paused and `currentTime` reset when leaving a source
- object URLs, timers, animation frames, media tracks, speech recognition and audio contexts released
- errors recoverable by the current attempt and suppressed for obsolete attempts
- tests use real control handlers and browser playback state rather than checking only hidden DOM

### 5.4 Phase 3 minimum commands

Use the current test file paths and inspect each command before running:

```powershell
$env:NODE_PATH = 'C:\Cursor AI\node_modules'
node tests/browser/pte-repeat-sentence-v3-browser-check.js
node tests/pte-attempt-archive-frontend-contract.test.js
node tests/browser/speaking-controller-browser-check.js
node tests/browser/speaking-pronunciation-tooltip-check.js
node tests/browser/speaking-shell-cross-mode-check.js
node tests/browser/practice-modes-browser-check.js
node --test tests/pte-shell-next-rules.test.mjs tests/pte-recorder-widget.test.mjs
node --check public/script.js
node --check public/js/speaking-practice-adapters.js
node --check public/js/speaking-practice-controller.js
git diff --check
```

Do not advance to Phase 4 until both reviews approve the same exact SHA.

---

## 6. Phase 4 — Describe Image

### 6.1 Tracker and ownership

At start, append the next unused tracker row, expected `1111`, as `PTE speaking shell v3 Phase 4 Describe Image integration,In Progress`. Confirm it is unused first.

Likely owned paths:

- `TASK_TRACKER.csv`
- `public/describe-image-mode.js`
- `public/js/speaking-practice-adapters.js`
- `public/index.html` only if required markup is absent
- `public/css/pte-speaking-shell.css` and/or `public/css/pte-question-area.css` only for shared/reusable selectors
- new `tests/browser/pte-describe-image-v3-browser-check.js`
- existing `tests/browser/describe-image-mode-browser-check.js` only if a legitimate legacy assertion must be expanded

Do not edit shared components until the writer proves the mode cannot integrate through their existing APIs. Amend the external contract before editing a newly required path.

### 6.2 Coding sequence

1. Read `updateQuestionDisplay`, `startPractice`, `startPrepTimer`, `tickPrep`, `startRecordingSession`, `tickRecord`, `stopRecording`, `displayResults`, `openZoom`, and `closeZoom` in `public/describe-image-mode.js`.
2. Map every existing timer, listener, recording handle, media stream, DSP promise and save promise. Define one question/attempt generation token and invalidate it on Retry, Next, question change and unmount.
3. Add the adapter contract: title, card body `#di-practice-area`, phase getter/map, Difficulty filter calling the existing difficulty handler, dock actions, attempts metadata and lifecycle hooks.
4. Under v3 only, auto-start after the image is committed to the current question. Legacy keeps its existing play/start behavior.
5. Mount the recorder beside the image. Feed the existing timer values into `PteRecorderWidget`; do not create a second independent countdown.
6. Preserve `AudioDspPipeline` recording and existing recording/save semantics. Guard every continuation after `await` with the current generation.
7. Move the existing zoom control into the image corner through the shell lifecycle so unmount restores it. Escape and backdrop click close the overlay and return focus to the trigger.
8. Build the two-column feedback with existing DOM/data. The key-point list has no artificial pass/fail marks before AI assessment; show `Key points —/5` as required by decision O-7.
9. Keep `sendAIAssessment()` and login/provider boundaries unchanged. It must remain a deliberate user action, never automatic during feedback.
10. Stop playback, recording, recognition, timers and stale saves on Next/Retry/unmount before rendering a replacement question.

### 6.3 Red/green browser cases

Run each v3 case at `1440×900` and `390×844`:

- load/question change auto-starts exactly once
- 25-second prep and 40-second recording are represented by the shared recorder
- manual Start recording cannot create a second recorder or timer
- Finish recording reaches Complete once
- Cancel/Retry/Next/unmount invalidate late `getUserMedia`, DSP and save completions
- zoom opens, traps/returns focus, closes by Escape and backdrop, and does not overflow mobile width
- Complete and Feedback dock matrices match Appendix D.3
- Feedback contains image, actual listen-back recording, transcript, key-point placeholder, AI action and sample answer
- AI success, rejection, login-required and late response after navigation use local fixtures and cannot alter a replacement attempt
- Previous attempts filters the current prompt and plays only one recording at a time
- `document.documentElement.scrollWidth === 390` on mobile
- `?pteShell=legacy` shows no v3 mode bar and passes the existing mode flow

### 6.4 Required verification

```powershell
node tests/browser/pte-describe-image-v3-browser-check.js
node tests/browser/describe-image-mode-browser-check.js
node tests/browser/speaking-controller-browser-check.js
node tests/browser/speaking-shell-cross-mode-check.js
node tests/pte-attempt-archive-frontend-contract.test.js
node --test tests/pte-shell-next-rules.test.mjs tests/pte-recorder-widget.test.mjs
node --check public/describe-image-mode.js
node --check public/js/speaking-practice-adapters.js
git diff --check
```

Then freeze, commit, and run fresh specification and quality reviews.

---

## 7. Phase 5 — Answer Short Question

### 7.1 Tracker and ownership

Expected next row: `1112`, after confirming it is unused. Likely paths:

- `TASK_TRACKER.csv`
- `public/asq-mode.js`
- `public/js/speaking-practice-adapters.js`
- `public/index.html` for `#asq-practice-area` only if absent
- shared CSS only if existing classes cannot express the design
- new `tests/browser/pte-asq-v3-browser-check.js`
- existing `tests/browser/asq-mode-browser-check.js` and `tests/asq-logic.test.js` only for legitimate regression coverage

### 7.2 Coding sequence

1. Read the `AsqMode` question selection, `playPrompt`, `showResult`, recording start/stop, recognition, accepted-answer and retry code before editing.
2. Define question and attempt generations. Audio countdown, prompt playback, recorder countdown, recognition, DSP, scoring and archive writes all belong to the current generation.
3. Under v3, after `setQuestionById()` commits the current question: 3-second audio countdown → prompt play → 1-second recorder countdown → recording up to 10 seconds → Complete.
4. Do not run `showResult()` automatically when recording stops under v3. The existing Get feedback action owns result evaluation. Preserve automatic legacy behavior.
5. Add Replay question for prep/complete using the existing audio element through `PteAudioBox`. Stop/reset it on transition.
6. Render one feedback tab: question, Question/Your recording listen-back, verdict text, learner transcript and accepted answers. Preserve XP calculation and accepted-answer normalization from the existing logic.
7. ASQ has no Filters button. Do not add invented filters.
8. Save/archive only the current attempt. Late recognition, DSP, answer evaluation or save completion must not overwrite a new question or publish stale history.

### 7.3 Red/green cases

- automatic 3 s → audio → 1 s → record lifecycle, once per question
- blocked autoplay exposes the shared click-to-start state
- Replay question works only in allowed phases and does not overlap learner playback
- correct, incorrect, alternate accepted answer, empty transcript and recognition rejection
- Get feedback is the only v3 result transition
- Retry/Next/question change/unmount during every pending async boundary
- old speech-recognition callbacks cannot populate a new question
- archive/history contains correct mode, prompt, transcript, score/verdict and audio
- one primary dock action per phase; no Filters control
- mobile no-overflow and readable feedback
- legacy ASQ behavior remains unchanged

### 7.4 Required verification

```powershell
node tests/browser/pte-asq-v3-browser-check.js
node tests/browser/asq-mode-browser-check.js
node tests/asq-logic.test.js
node tests/browser/speaking-controller-browser-check.js
node tests/browser/speaking-shell-cross-mode-check.js
node tests/pte-attempt-archive-frontend-contract.test.js
node --test tests/pte-shell-next-rules.test.mjs tests/pte-recorder-widget.test.mjs
node --check public/asq-mode.js
node --check public/js/speaking-practice-adapters.js
git diff --check
```

Freeze, commit, then run both independent reviews.

---

## 8. Phase 6 — Respond to a Situation

### 8.1 Tracker and ownership

Expected next row: `1113`. Likely paths:

- `TASK_TRACKER.csv`
- `public/rts-mode.js`
- `public/js/speaking-practice-adapters.js`
- shared CSS only if required
- new `tests/browser/pte-rts-v3-browser-check.js`
- existing `tests/browser/rts-mode-browser-check.js`
- existing `tests/browser/rts-mode-full-browser-check.js`

### 8.2 Coding sequence

1. Read `loadQuestion`, `startFlow`, `startAudioCountdown`, `startAudioPlayback`, `onAudioEnded`, `startPrepTimer`, `startRecording`, `stopRecording`, `showResults`, speech recognition and AI-score functions.
2. Preserve the approved timings: 15-second audio wait, current audio duration, 10-second preparation, 40-second response.
3. Under v3, auto-start only after `loadQuestion()` has committed the new prompt. Hide the legacy play/countdown UI without bypassing its state logic.
4. Present instruction, plain prompt, audio box and recorder in the same card. Recorder appears only after audio ends.
5. Route recording through the existing DSP path. Add/retain generation guards for prompt audio, recorder acquisition, recognition, DSP, save and AI score.
6. Feedback left: recording and transcript. Right tabs: AI score and sample answers. Preserve the existing Full/Simplified sample-response logic.
7. AI scoring remains user-triggered. Use the existing authentication prompt and provider adapter. Do not invent a local score or call live AI during tests.
8. A late AI response/rejection after Retry, Next or unmount must not change the current attempt.

### 8.3 Red/green cases

- exact 15/10/40 phase transitions with scaled test time
- audio box visibility before recorder; recorder absent until audio end
- autoplay rejection and manual recovery
- Cancel/Retry/Next/unmount at countdown, audio, prep, recording, DSP, save and AI-score boundaries
- AI guest/login state, success, provider rejection and late completion using fixtures
- Full/Simplified sample segmented control and stable selection
- transcript and audio remain associated with the same question
- attempts/history save once and replay the correct response
- mobile no-overflow; legacy tests unchanged

### 8.4 Required verification

```powershell
node tests/browser/pte-rts-v3-browser-check.js
node tests/browser/rts-mode-browser-check.js
node tests/browser/rts-mode-full-browser-check.js
node tests/browser/speaking-controller-browser-check.js
node tests/browser/speaking-shell-cross-mode-check.js
node tests/pte-attempt-archive-frontend-contract.test.js
node --test tests/pte-shell-next-rules.test.mjs tests/pte-recorder-widget.test.mjs
node --check public/rts-mode.js
node --check public/js/speaking-practice-adapters.js
git diff --check
```

Freeze, commit, then run both independent reviews.

---

## 9. Phase 7 — Summarize Group Discussion

### 9.1 Tracker and ownership

Expected next row: `1114`. Likely paths:

- `TASK_TRACKER.csv`
- `public/sgd-mode.js`
- `public/js/speaking-practice-adapters.js`
- shared CSS only when reusable shell styles are insufficient
- new `tests/browser/pte-sgd-v3-browser-check.js`
- existing `tests/browser/sgd-mode-browser-check.js`
- `tests/sgd-difficulty-classification.test.js` only if affected

### 9.2 Coding sequence

1. Read `startPractice`, `goToListeningStep`, `loadAudio`, `goToRecordingStep`, `goBackToNotes`, `startRecordingSession`, `stopRecording`, `submitNotes`, `compareTextsBySpeaker`, `displayResults`, tab rendering and note persistence.
2. Under v3, use one screen. Recording begins below the audio box; do not hide or replace the editable notes panel.
3. Keep Topic/Speaker 1/Speaker 2/Speaker 3 notes editable through listen, prep and recording. Preserve the existing source of truth; do not clone note state into an unsynchronized shell object.
4. Flow: auto-start → 3-second audio countdown → discussion play → 10-second recorder countdown → recording up to 120 seconds → Complete → explicit Get feedback.
5. Hide legacy step navigation only under v3. Legacy retains `goToRecordingStep`, back-to-notes and its current layout.
6. Feedback left: learner recording and notes with existing matched-word highlighting. Right: per-speaker/overall stats and transcript.
7. Guard audio, recording, recognition/DSP, note submission, result rendering and archive publication by the active question/attempt generation.

### 9.3 Red/green cases

- one-screen continuity; notes never disappear or reset during recording
- all four note tabs retain independent text
- 3/10/120 flow and manual start/finish behavior
- discussion and learner listen-back never overlap
- Next/Retry/unmount during audio, countdown, recording, DSP, comparison and save
- speaker matching uses the correct speaker labels and does not cross-contaminate notes
- feedback stats and transcript reflect the same fixture
- attempts/history contains audio and response summary once
- responsive layout at both viewports, including long notes and long speaker labels
- legacy SGD browser flow and difficulty classification remain green

### 9.4 Required verification

```powershell
node tests/browser/pte-sgd-v3-browser-check.js
node tests/browser/sgd-mode-browser-check.js
node tests/sgd-difficulty-classification.test.js
node tests/browser/speaking-controller-browser-check.js
node tests/browser/speaking-shell-cross-mode-check.js
node tests/pte-attempt-archive-frontend-contract.test.js
node --test tests/pte-shell-next-rules.test.mjs tests/pte-recorder-widget.test.mjs
node --check public/sgd-mode.js
node --check public/js/speaking-practice-adapters.js
git diff --check
```

Freeze, commit, then run both independent reviews.

---

## 10. Phase 8 — Retell Lecture

Phase 8 is deliberately split. Implement 8A first. Prior coordination memory records a user preference for **content-only** Retell Lecture scoring, but the canonical specification still labels O-1 open and does not unambiguously confirm that the recording step itself is authorized. Treat the memory as context, not current authorization: verify the recording decision with the user before 8B, and if approved use content coverage only unless the user explicitly authorizes an unscripted fluency/pronunciation assessment.

### 10.1 Phase 8A tracker and ownership

Expected next row: `1115`, description `PTE speaking shell v3 Phase 8A Retell Lecture layout and notes feedback`. Likely paths:

- `TASK_TRACKER.csv`
- `public/take-notes-mode.js`
- `public/js/speaking-practice-adapters.js`
- shared CSS only if necessary
- new `tests/browser/pte-retell-lecture-v3-browser-check.js`
- existing `tests/browser/notes-mode-browser-check.js`
- existing `tests/browser/notes-navigation-audio-browser-check.js`
- existing notes loading/recovery tests if lifecycle changes reach them

### 10.2 Phase 8A coding sequence

1. Read `startPractice`, `loadGuidingVideo`, `goToAudioStep`, `loadAudio`, `submitNotes`, `compareTexts`, navigation/audio cleanup and recovery paths.
2. Under v3, skip the overview and start button. Go directly to audio after the current question is committed.
3. Move the guiding video to an Intro video helper during listen. Open it through the existing sheet/modal API; restore focus and cancel obsolete loads on close/question change/unmount.
4. Render instruction, shared audio box and editable notes area. Hide legacy audio status and duplicate submit controls only under v3.
5. After audio ends, expose a single Get feedback action that calls the existing notes submission/comparison path.
6. Feedback left: matched learner notes. Right: Notes match and Lecture transcript tabs.
7. Preserve current audio loading recovery and navigation cancellation behavior. Generation-guard question audio, video, comparison and archive side effects.

### 10.3 Phase 8A red/green cases

- auto-start once per lecture; no overview/start gate under v3
- Intro video opens/closes accessibly and cannot continue after departure
- autoplay rejection has a recoverable audio-box state
- notes remain editable and persist through audio and feedback
- one Get feedback action; duplicate legacy submit controls hidden only under v3
- navigation during pending audio/video/comparison/save cannot mutate the next lecture
- feedback highlighting and transcript correspond to the same fixture
- mobile no-overflow; legacy notes flow unchanged
- loading failure and retry behavior remains green

### 10.4 Phase 8A required verification

```powershell
node tests/browser/pte-retell-lecture-v3-browser-check.js
node tests/browser/notes-mode-browser-check.js
node tests/browser/notes-navigation-audio-browser-check.js
node tests/browser/notes-loading-recovery-browser-check.js
node tests/notes-loading-recovery.test.js
node tests/notes-smart-jump-regression.test.js
node tests/recommendation-notes-regression.test.js
node tests/browser/speaking-controller-browser-check.js
node tests/browser/speaking-shell-cross-mode-check.js
node tests/pte-attempt-archive-frontend-contract.test.js
node --test tests/pte-shell-next-rules.test.mjs tests/pte-recorder-widget.test.mjs
node --check public/take-notes-mode.js
node --check public/js/speaking-practice-adapters.js
git diff --check
```

Freeze, commit, then run both independent reviews.

### 10.5 Phase 8B hard decision gate

Ask the user, in plain language:

> Should Retell Lecture add a 40-second spoken recording after the lecture? If yes, should feedback score content coverage only, or may it call an approved unscripted speech assessment for fluency/pronunciation?

Until answered, do not create row 1116, add recording UI, call an assessment provider, or change archive semantics. Phase 8A and Phase 9 QA can proceed with the documented no-recording behavior.

If approved, Phase 8B must:

- record through `AudioDspPipeline.createRecorder()`
- use the established speech-recognition lifecycle pattern without letting recognition own the audio result
- count down 10 seconds and record 40 seconds
- score content coverage against lecture key ideas using the existing comparison logic
- add fluency/pronunciation only under the exact approved provider/contract
- save via `PTEAttemptArchive.saveStateAttempt('notes', …)` with audio
- cover permission denial, recognition rejection, DSP failure, Retry/Next/unmount, stale assessment, archive failure/retry and guest/signed-in history at both viewports

---

## 11. Phase 9 — cross-mode hardening and documentation

Phase 9 starts only when Phase 3 and each implemented Phase 4–8 slice have both review approvals.

### 11.1 Tracker and ownership

Expected next row after completed implementation rows: `PTE speaking shell v3 Phase 9 cross-mode QA and documentation`. Confirm the actual next ID rather than assuming it.

Likely paths:

- `TASK_TRACKER.csv`
- new `tests/browser/pte-speaking-shell-browser-check.js`
- mode files only if the shared test exposes a real defect
- existing cross-mode tests only for valid expanded coverage
- feature documentation under `docs/specs/features/`
- shared CSS/controller/adapters only through a separately declared bounded remediation

Do not combine broad QA findings into one uncontrolled refactor. Freeze the candidate, triage each failure, and assign the smallest owner/path set.

### 11.2 Cross-mode browser contract

For `read-aloud`, `speak`, `describe-image`, `notes`, `asq`, `sgd`, and `rts`, test `?pteShell=v3` at `1440×900` and `390×844` using local MediaRecorder/getUserMedia/provider fixtures and `window.__PTE_TEST_TIME_SCALE = 0.05` only in test mode.

Assert:

1. exactly one `.pte-modebar`
2. legacy header/view/advanced rows hidden only in v3
3. audio modes have no populated recorder before audio ends
4. prep Next shows `Cannot skip`
5. recording hides helpers and Next requires confirmation
6. recorder clock and waveform advance
7. feedback card height is at most 740 px at desktop
8. feedback uses two columns where specified
9. exactly one visible primary dock action per phase
10. Previous attempts exists in every phase and updates once per save
11. mobile document width equals 390 and no fixed overlay escapes the viewport
12. `?pteShell=legacy` has no v3 mode bar and preserves the existing primary controls
13. repeated mount/unmount does not duplicate listeners, controls, dialogs or archive events
14. audio/recording/recognition/AI callbacks from a departed mode cannot affect the active mode

### 11.3 Accessibility verification

Verify with browser assertions, not only code inspection:

- all controls are real `<button type="button">` elements
- visible keyboard focus uses the shared focus token
- popovers expose and update `aria-haspopup`/`aria-expanded`; Escape closes and focus returns
- dialogs are labelled `alertdialog`, modal, described, focus-trapped and restore focus
- recorder/audio status announcements occur once per transition
- word/verdict states use text/underline/icon in addition to color
- reduced motion disables pulse, waveform motion and fades
- tab panels and segmented controls expose selected state and keyboard operation
- zoom and video overlays are closable without pointer input

### 11.4 Final local regression matrix

First confirm each file exists in the candidate; do not treat a stale plan filename as a passing command.

```powershell
$env:NODE_PATH = 'C:\Cursor AI\node_modules'

node tests/browser/pte-speaking-shell-browser-check.js
node tests/browser/pte-shell-components-browser-check.js
node tests/browser/pte-read-aloud-v3-browser-check.js
node tests/browser/pte-repeat-sentence-v3-browser-check.js
node tests/browser/pte-describe-image-v3-browser-check.js
node tests/browser/pte-asq-v3-browser-check.js
node tests/browser/pte-rts-v3-browser-check.js
node tests/browser/pte-sgd-v3-browser-check.js
node tests/browser/pte-retell-lecture-v3-browser-check.js

node tests/browser/speaking-controller-browser-check.js
node tests/browser/speaking-shell-cross-mode-check.js
node tests/browser/speaking-ui-full-audit.js
node tests/browser/speaking-ui-review-regression-check.js
node tests/browser/practice-modes-browser-check.js
node tests/browser/practice-modes-ui-full-audit.js --viewport desktop,mobile

node tests/browser/describe-image-mode-browser-check.js
node tests/browser/asq-mode-browser-check.js
node tests/browser/rts-mode-browser-check.js
node tests/browser/rts-mode-full-browser-check.js
node tests/browser/sgd-mode-browser-check.js
node tests/browser/notes-mode-browser-check.js
node tests/browser/notes-navigation-audio-browser-check.js
node tests/browser/notes-loading-recovery-browser-check.js

node tests/pte-attempt-archive-frontend-contract.test.js
node tests/pte-attempt-archive-scope-contract.test.js
node tests/asq-logic.test.js
node tests/sgd-difficulty-classification.test.js
node tests/notes-loading-recovery.test.js
node tests/notes-smart-jump-regression.test.js
node tests/recommendation-notes-regression.test.js
node --test tests/pte-shell-next-rules.test.mjs tests/pte-recorder-widget.test.mjs
```

Read `tests/browser/production-speaking-controller-check.js` before running it. If it can target production or a live service, run only a confirmed local mode or omit it with an explicit limitation. Do not access production merely because the file name appears in the original plan.

Also run syntax checks for every changed JavaScript file, `git diff --check`, the exact structure check, and inspect the final path delta against the accumulated phase contracts.

### 11.5 Documentation

Update the existing feature records under `docs/specs/features/` for the shipped v3 behavior. Link to the canonical specification and this takeover plan. Document:

- v3 opt-in URL/local-storage flag
- legacy fallback
- per-mode flow and timers
- recording/DSP/assessment boundaries
- archive/history behavior
- accessibility behavior
- known limitations, especially Phase 8B if deferred

Keep large screenshots/traces in the external evidence directory. Add `docs/audits/pte-speaking-shell/<date>/` only if the product owner explicitly requests tracked evidence.

### 11.6 Final review

Run a fresh full-package specification review and code-quality review over the complete Phase 0–9 delta. The final reviewers must verify that fixes made for later modes did not invalidate prior approvals for Read Aloud or Repeat Sentence.

---

## 12. Common coding rules for every remaining mode

### 12.1 Async ownership pattern

Every mode needs an explicit lifecycle owner, normally a monotonically increasing question/attempt generation. The exact implementation may follow the established Read Aloud/Repeat Sentence pattern, but it must satisfy:

- increment/invalidate before starting a new question or attempt
- invalidate before Next, Retry, Cancel and unmount side effects begin
- capture the generation before each async operation
- check it after every `await` and immediately before UI, navigation, error, archive, cache or event side effects
- do not let an obsolete `catch` show an error in the replacement session
- do not let an obsolete `finally` clear a replacement session's loading/saving state
- preserve retry ownership after a recoverable current-attempt failure
- make publication checks occur before cache invalidation/event dispatch, not only afterward

### 12.2 Audio and media cleanup

On phase exit, question change, Retry, Next and unmount as applicable:

- pause shared audio and learner listen-back
- reset source selection and `currentTime` when the design requires a fresh start
- stop all MediaStream tracks
- stop/abort MediaRecorder and speech recognition safely
- cancel timers, intervals, animation frames and audio-box countdowns
- disconnect/close analyser and AudioContext resources
- revoke obsolete object URLs only after no active player owns them
- prevent a departed DSP completion from replacing the current blob/audio URL

### 12.3 UI lifecycle

- Mount once; repeated `sync` must not add duplicate listeners or DOM.
- Adopt existing controls instead of cloning behavior. Record anchors so unmount restores original location, classes, labels, hidden state and ARIA.
- Keep legacy behavior outside the v3 branch.
- Reuse shell tokens/classes. Do not add nested card-on-card containers.
- On mobile, prefer natural flow and existing container width; no fixed pixel widths that force horizontal scrolling.
- A menu selection updates only after the underlying existing handler accepts it.

### 12.4 Tests must prove behavior

Avoid shallow tests such as “element exists” when the requirement is lifecycle behavior. Use real local browser interactions and assert:

- playback `paused`, `currentTime`, selected source and audible owner
- actual handler invocation/click path
- visible DOM and computed layout, not only backing state
- exact event/invalidation count
- navigation count and question ID after delayed completions
- persisted/list-summary shape for history
- recovery after a controlled failure
- stale completion suppression after Retry/Next/unmount
- both desktop and mobile widths
- legacy flag-off behavior

---

## 13. Commit, review and handoff format

Each implementation/remediation handoff must include:

1. commit SHA and parent/base SHA
2. exact created/modified/deleted/renamed paths
3. tracker row and final status
4. behavior implemented
5. all verification commands with pass counts
6. browser widths and flag modes
7. fixture/live boundary statement
8. known limitations and open decisions
9. `git status --porcelain=v1` result
10. ownership release statement

Each reviewer must return:

```text
APPROVED
- Candidate: <sha>
- Scope reviewed: <phase/full delta>
- Evidence: <commands and inspected behavior>
- Limitations: <local fixtures/live boundaries>
```

or:

```text
REJECTED
- Candidate: <sha>
- Blocking finding 1: <severity, file:line, behavior, reproduction>
- Required correction: <bounded outcome, not speculative rewrite>
- Evidence: <command/repro>
```

Never accept an empty completion or a task that ends without a verdict. Recover with a fresh independent review context rather than interpreting silence as approval.

---

## 14. Stop conditions and prohibited actions

Stop and ask the user when:

- Phase 8B decision O-1 is reached
- a product decision differs from the canonical open-decision defaults
- the required change expands into backend schema, Firestore indexes, provider contracts or live configuration
- another owner has overlapping dirty work
- production/live evidence is necessary
- release, preview, merge, push or deployment is requested by implication rather than explicitly

Without explicit authorization, Gemini must not:

- merge or cherry-pick into `C:\Cursor AI`
- push any branch
- create a preview channel or deploy Hosting/Functions/services/rules
- alter live Firestore, Storage, auth or AI data
- flip `RELEASE_DEFAULT` to `true`
- reset, stash, clean or delete worktrees/evidence
- retire the feature worktree

The final state requested by this plan is a clean, locally verified, independently reviewed feature-branch candidate with release default off and a complete evidence/handoff record.

---

## 15. Immediate Gemini start checklist

- [ ] Read all authority files in Section 1.
- [x] Confirm the current Phase 3 writer has stopped and released ownership.
- [x] Record Phase 3 remediation SHA `2215c8ef1953b580705d655fda81e930018c7084` and its external evidence.
- [ ] Verify branch, common Git directory, worktree status and tracker rows.
- [ ] Run fresh Phase 3 specification review.
- [ ] If approved, run fresh Phase 3 code-quality review.
- [ ] If either rejects, create one smallest bounded remediation and repeat both reviews.
- [ ] Start Phase 4 only after both reviews approve the same SHA.
- [ ] Execute Phases 4, 5, 6, 7 and 8A serially with their per-phase gates.
- [ ] Ask the user before Phase 8B.
- [ ] Run Phase 9 full cross-mode and legacy hardening.
- [ ] Stop at a reviewed local candidate; do not publish.
