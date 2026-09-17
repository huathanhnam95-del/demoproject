---
ArtifactMetadata:
  RequestFeedback: true
  Route: Light
  PackageId: PRACTICE-UI-REDESIGN-20260913
  Status: Awaiting coordinator approval
  PlanningTaskId: 01a09b3c-38e9-7a51-8bee-24c3217ed570
  CoordinatorTaskId: 01a09b10-b7d1-7f83-9d86-ef8c666983cc
  ImplementationModel: gpt-5.6-luna
  ImplementationReasoning: xhigh
---

# Practice Mode Workspace and Retell Loading Implementation Plan

**Goal:** Make the current practice task and its primary action easy to find together, and make Retell Lecture entry, loading failures, and recovery responsive and bounded.

**Architecture:** Retain the existing mode controllers as the owners of phases, media, scoring, timers, and persistence. Extend the shared speaking controller with explicit, reversible placement of its existing controls into mode-owned task regions. Apply a common flat layout to the shared audio-player surfaces. Treat Retell loading and recovery as a separate change with its own reproduction and acceptance evidence.

**Technology:** Existing classic browser JavaScript globals, HTML/CSS, native audio, the existing XLSX/Firebase integrations, Node tests, and Playwright using installed Google Chrome.

**Execution authority:** The user authorized the originating coordinator to approve this plan and launch one Luna X High implementation task. Astra is limited to inspection and planning. All implementation, test writing/execution, verification, fixes, diff audits, and commits belong to Luna X High. Stay on the Light route; no subagents. Standard speed unless the user separately opts into Fast. If Luna cannot resolve an issue, return concrete evidence to the coordinator; do not silently assign implementation or verification to Astra.

**Approval boundary:** This plan grants no production deployment, push, production data writes, or automatic integration into the dirty saved checkout. A local candidate commit is part of completion. The root `C:\Cursor AI\implementation_plan.md` remains unrelated and protected.

## 1. Evidence, baseline, and limits

Inspected saved checkout: `C:\Cursor AI`, HEAD `d188648e36ef0c505951fdb622536654051adb82`. Source references below refer to the inspection-time working tree; line numbers are navigation aids, and symbols/IDs are the stable anchors.

| Evidence | Verified observation | Implication |
| --- | --- | --- |
| `public/js/speaking-practice-controller.js:695`, `:813`, `:1547` | Header and footer are built separately; the footer is appended at the end of the panel. Original buttons are moved into media/attempt slots. | Improve placement without rebuilding buttons or transferring business logic to the shell. |
| `public/css/practice-audio-player.css:25` | Player width is capped at 470px and centered; its companion metadata has the same cap. | This explains part of the player/response misalignment visible in Repeat Sentence. |
| `public/js/speaking-practice-adapters.js:73-423` | Eight adapters have explicit scope, picker, action, and phase contracts. | Shared changes affect more than Retell and Repeat Sentence. |
| `public/index.html:3976-4051` and `public/take-notes-mode.js:240` | Both `play-notes-btn` and `notes-start-btn` start the same practice flow. Submit/retry also have in-card duplicates. | Render one accessible control for each action per phase. |
| `public/index.html:3991` | The overview says “Lecture Audio Ready” before media verification. | Separate unknown/loading/ready/unavailable states. |
| `public/js/lazy-loader.js:168-177` | Notes loads Compromise, XLSX, YouTube helper, then the notes module serially. | Parallelize only verified independent prerequisites and remove the unused notes-specific YouTube-helper prerequisite. |
| `public/take-notes-mode.js:78-100`, `:503-556` | Module initialization starts loading. Firestore gets up to 8 seconds before Excel fetch begins; XLSX parsing is synchronous. | Avoid late module initialization starting a stale entry; fetch fallback concurrently and measure parse cost. |
| `public/take-notes-mode.js:858-929` | Five extensions are probed sequentially with unbounded HEAD requests. A successful HEAD enables the player before a playable media event. | Bound network and decode readiness; cancel/invalidate obsolete work. |
| `public/take-notes-mode.js:803-821` | Guiding video uses a direct iframe; the notes module does not call a YouTube-player API. | Its separate helper need not block Retell entry. Preserve Watch's dependency path. |
| `public/script.js:1842`, `:2122`, `:2269` | Mode assets are awaited before the panel is shown; notes entry is awaited afterward. Existing transition checks already exist. | Show a nonblocking loading shell early and extend existing transition protection rather than adding a competing router. |
| `public/index.html:2361` and `public/js/practice-audio-player.js` | Repeat Sentence intentionally restarts on Play, spends a replay, and disables seeking. | Preserve those semantics; a visual player update must not turn Play into a normal pause/resume toggle. |

Reviewed screenshots:

- `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-f66161b6-47d2-4f03-9760-0b80f9529288.png`: Retell overview, separated start actions, Firestore timeout/offline console messages.
- `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-e6fe8380-7de5-42cf-84ae-73567ea31518.png`: Repeat Sentence player, response, recording action, and progress spread across different widths. The black Thinking/microphone overlay is external voice UI and is excluded from app defect claims.

The originating inspection reported responsive clean Chrome entry and an automation stall after guiding-video entry. That is prior evidence, not a reproduced freeze in this planning task. Firestore delay, extension messages, media waits, iframe behavior, main-thread work, and automation failure must be distinguished. Do not label any one of these the proven freezing cause without a trace and reproduction.

No application/browser tests, implementation, source commits, or deployment were performed during planning. Inspection does not establish that every existing mode is currently passing.

## 2. Complete affected-mode inventory

The PTE/English labels are scope-dependent. Preserve `PRACTICE_LAUNCHER`, scope overrides, current URLs, question IDs, and scope activation rules.

### Shared structural changes: eight adapters

| Mode ID / learner label | Shared-shell scope | Task arrangement and protected behavior | Existing behavior owner |
| --- | --- | --- | --- |
| `notes` / Retell Lecture, English Take Notes | PTE only; English gets the compatible mode-local arrangement | Overview/start → optional guiding video/proceed → lecture audio, notes, submit → transcript/notes/results/retry. Currently typed notes, **no recording phase**. | `public/take-notes-mode.js` |
| `speak` / Repeat Sentence, English Repeat | PTE and English | Audio and replay allowance → record/stop beside response → Check and results/retry. Keep replay cap and disabled seek. | `public/script.js` |
| `type` / Write from Dictation, English Dictate | PTE and English | Audio → answer input with Check → results/retry. Preserve hints, adaptive choice, and progress. | `public/script.js` |
| `asq` / Answer Short Question | PTE | Prompt player and record/stop together with answer/result. Preserve Listen/Answer/Results lifecycle. | `public/asq-mode.js` |
| `rts` / Respond to a Situation | PTE | Audio → preparation and timer → recording/stop → results/retry/next/AI actions. | `public/rts-mode.js` |
| `describe-image` / Describe Image | PTE | Image and preparation → recording/stop → review/submit → results. Preserve the existing three-step preview and detailed internal states. | `public/describe-image-mode.js` |
| `sgd` / Summarize Group Discussion | PTE | Discussion audio → recording and submit → results/retry. No invented separate preparation phase. | `public/sgd-mode.js` |
| `read-aloud` / Read Aloud | PTE and English | Passage with prep/record timers and record controls; recorded audio/Check; results/history. Keep state-owned recording and settings sheet. | `public/read-aloud-mode.js` |

### Shared player layout changes: six additional listening modes

`hcs` (Highlight Correct Summary), `hiw` (Highlight Incorrect Words), `lmcma` (Listening Multiple Choice Multiple Answers), `lmcsa` (Listening Multiple Choice Single Answer), `smw` (Select Missing Word), and `sst` (Summarize Spoken Text) use `.practice-audio-player` in `public/index.html`.

Align each existing player with its prompt/choices/response and keep its existing controls near that response using HTML grouping and narrowly scoped layout rules. These six modes do **not** become speaking-controller adapters. Keep their own lifecycle, replay/speed policies, answer selection, highlighting, word counts, scoring, and results. Their behavior owners are the correspondingly named `public/<mode>-mode.js` files; those files are read-only in this package.

There are **14 distinct modes** in the implementation surface and **12 existing audio-player surfaces**. The latter include Read Aloud's sample player inside Settings; that settings player retains its own width and source tabs rather than expanding to the main task width.

### Adjacent surfaces protected from incidental redesign

Inventory and smoke-check routing/visibility for `extended`, `watch`, `pronounce`, `collo-dictate`, `rfib`, `dd`, `rmcsa`, `rmcma`, `rop`, `essay`, and `swt`. Do not silently migrate these eleven modes into the shared shell. Their body structures and interaction models differ, and no source-grounded case for a broad structural rewrite was established here. Shared CSS edits must not change their typography, drag/drop, dialogs, drafts, or controls. Further redesign of these modes requires a bounded follow-on scope after this package.

## 3. Chosen responsive design

Three approaches were considered:

1. **CSS-only alignment:** small diff but leaves action adoption at the panel end and retains Retell duplicates. Insufficient for the reported workflow problem.
2. **Explicit task regions with reversible control placement — selected:** uses the existing controllers and source nodes; changes layout where the task actually lives. Moderate scope, testable lifecycle preservation.
3. **One new universal mode renderer:** would duplicate or migrate many state machines and persistence contracts. Too much behavioral change for this request.

### Common visual structure

Use the existing BEL typography and colors. Keep Outfit for controls and the existing content font for learner text; introduce no font downloads or ornamental motion. Use one outer content alignment with the existing 1180px shell maximum, 24px desktop inset, and 14px narrow-screen inset. Interior regions use zero horizontal padding unless the input itself needs padding.

```text
Mode identity and Back to Dashboard
Question: previous | current question | next          Settings / Basic–Advanced
Current phase                         compact existing progress, when applicable

Current task region
  prompt / image / guiding video / lecture overview
  source audio + timeline + elapsed time + replay allowance, where applicable
  response / notes / recording status
  current action + timer + relevant secondary action

Results and optional supporting detail
```

This is a layout convention, not a new enclosing card. Use headings, spacing, and at most light dividers. Do not add a card around an existing input card/player/card. Flatten the Retell overview and redundant intermediate backgrounds/shadows. Inputs, an image/video surface, and a result visualization may keep the boundary needed to understand them.

Desktop behavior:

- At 1024px and above, question navigation and settings share one row when they fit. The current phase is visually close to the task, not lost between unrelated controls.
- Player, response, and action region share the same left edge and available content width. Remove the standalone 470px player island for the main twelve-player surfaces, with the Read Aloud settings exception above.
- Audio is compact: Play, timeline, elapsed/total time; volume occupies a compact second row. Keep replay status directly beside/below that player. Do not place playback speed or volume in a separate remote footer.
- Short audio and answer tasks flow vertically. For Retell results, transcript and notes can use two equal columns at 1024px+, then stack. Do not force all modes into a two-column split.
- Put the active action rail immediately after the response/task it controls, with a normal gap of 12–20px. For long passage/image tasks, put the timer/action rail beside the phase heading and before the long content, so the action is reachable without scrolling through the whole stimulus. Use explicit per-phase hosts rather than CSS visual reordering.
- Retain Read Aloud's existing full-width passage within its established passage zone. Do not introduce a new `ch` cap or expand its passage measure as a side effect of the wider shell.
- Consolidate existing recommendation/mastery progress into a compact line aligned to the task. Keep the real progress node and reset action; Basic/Advanced visibility and preference keys stay intact. Detailed filters remain in the existing Settings sheet, with the active-settings summary retained.

Mobile/tablet behavior:

- Below 1024px, let navigation wrap before reducing the task width. At 768px and below use one content column; at 640px and below the question picker gets a full row.
- At 390px and 320px, all controls remain keyboard/touch reachable; interactive targets are at least 44px. Time labels and phase text wrap rather than clipping. No document horizontal overflow beyond 1px rounding tolerance.
- The current action lives in the same task region and DOM reading order. The normal design uses an in-flow action rail, not a second fixed bottom toolbar. Keep the mobile navigation bar and chat trigger clear of the action; verify with hit testing, not z-index assumptions.
- With the virtual keyboard open, the notes/answer field and action can be scrolled into view without a fixed bar covering them. Preserve focus while typing; loading updates must not steal it.
- A full-width primary button may wrap above secondary actions on narrow screens. No duplicate desktop/mobile controls.

Accessibility: use real buttons, programmatic labels, visible focus, current-step semantics, and one polite live loading/status region per active task. Preserve Settings/picker dialog focus trapping, Escape dismissal, focus return, and reduced motion. Do not announce every timer tick. Retain non-color labels for progress and pronunciation results.

## 4. Shared controller contract

Extend the adapter configuration with an optional `layout` contract; existing adapters without it must retain their present fallback placement.

- `mediaHost`: selector or resolver returning an element **inside that adapter's panel** for `.spc-slot-media`.
- `attemptHost`: selector or resolver returning the active phase's element for `.spc-slot-attempt`.
- `progressHost`: optional panel-local element for the existing progress control, while retaining its declared Basic/Advanced policy.
- Host elements are static markup with `data-practice-media-host`, `data-practice-action-host`, or `data-practice-progress-host`; no state logic in those attributes.
- Resolvers derive placement from current mode-owned state/phase elements already used by `getStepIndex`. They do not advance phases, restart timers, fetch data, reset attempts, or write progress.
- Move the existing slot/control nodes, never clone them. Keep IDs, listeners, `disabled`, ARIA, runtime data, and restore anchors. Preserve the existing `visibilityScopeId` observers because adopted nodes no longer inherit their original parent's visibility.
- Validate the resolved host before moving. Do not allow a descendant of the moved node, an inactive foreign panel, or an absent host to swallow controls. Fall back to the original footer placement on invalid configuration and expose a useful development diagnostic.
- Placement sync is idempotent. Move only when the target parent changes; do not create a MutationObserver feedback loop or run a whole-panel scan on each media timeupdate. Use the existing explicit `sync()` boundaries and a bounded/coalesced observation only where necessary.
- Settings must not adopt a node that is simultaneously owned by a task host. Preserve Read Aloud's separate settings initialization and teardown path.
- On unmount/failed mount, disconnect every added observer/listener, restore slots and original controls, remove generated hosts if any, and clear owned page-level measurements. Do not reset unrelated mode preferences.
- Retain `.spc-footer` as the compatibility fallback until its consumers are safely accounted for. Empty fallback has zero visible height. Update `--spc-footer-height`/chat clearance from the actual applicable rail without leaving stale clearance after scope switches. Do not simply delete the `ResizeObserver` contract.

Prefer static hosts in `public/index.html` to reparenting entire mode bodies. Preserve existing `.question-selector`, `.unified-controls`, phase wrapper IDs, direct-child queries, and the picker selectors declared in adapters. Do not wrap those legacy navigation containers in a new parent.

## 5. Retell loading and recovery contract

This work is independently reviewable from the layout changes. Establish baseline timings before changing it. The following are proposed acceptance budgets, not measured current performance.

### Entry and data

1. Show the existing notes panel with a nonblocking loading status promptly after the user chooses it. Keep Dashboard, Back, and switching modes usable. Disable only controls that require unavailable data. Do not cover the app with a modal spinner.
2. Give each entry/retry a generation tied to the existing route transition. Module `init()` binds/cache-initializes only; it must not start an obsolete catalog load simply because a script finished after navigation away. `onEnter()` owns the load. Audit legacy notes-tab and public `loadEntries()` callers for the same idempotent behavior.
3. For Notes only, load independent Compromise and XLSX prerequisites concurrently; retain their availability before scoring/parsing. Do not use the lexical fallback silently because a redesigned loader failed to load Compromise. Remove Notes' wait for the YouTube helper: the guiding iframe is independent. Keep Watch and other loader paths unchanged.
4. Maintain the shared loader's URL deduplication and failed-load retry behavior. Use one total Notes entry deadline of 12 seconds, measured from the transition request, including dependencies and catalog work. The 12-second deadline must settle the UI even if underlying shared script/Firebase work cannot be physically aborted. Late completion cannot activate a panel or overwrite a newer entry.
5. Start the Firestore request and workbook fetch concurrently after required dependencies are available. Firestore remains authoritative while pending, with its existing maximum 8-second wait bounded by the remaining entry deadline. Workbook fetch/array-buffer work is bounded to 6 seconds or the remaining deadline, whichever is shorter. Only parse/use the workbook when the fallback is needed or the user requests it; measure synchronous parse duration.
6. If Firestore is still pending after 1.5 seconds and a workbook is available, offer “Use local questions” beside the status. Choosing it commits that source for the current entry. Otherwise fall back automatically on Firestore failure/empty result/timeout. If a ready local catalog is already available in memory, offer it immediately. Do not add a new persistent cache or change storage schemas.
7. Never swap an active question, typed notes, or selected filters when a late Firestore response arrives. Discard obsolete results; any later refresh happens through an explicit retry/reentry boundary. Preserve pending deep-link question ID; do not silently replace an unavailable requested ID with question 1. Explain that the selected source lacks it and offer the existing picker.
8. Loading failure ends with an inline explanation, Retry loading, and usable navigation. Retry clears only failed in-flight state and starts a fresh generation. Preserve typed notes if recovery happens within the same question/attempt.

Healthy local fixture target: usable catalog within 3 seconds of mode selection in each baseline/candidate batch; interaction acknowledgement within 250ms. Slow/offline target: a visible actionable state throughout, local recovery offered within 1.5 seconds of fallback availability, and a terminal ready/error state by the 12-second total entry deadline. Capture five cold and five warm entries, recording all samples; do not mask an outlier by reporting only an average.

### Guiding video

Keep the current guiding-video phase and explicit Proceed to Notes action. It must work even if the iframe is blocked, slow, or never loads; do not wait for iframe callbacks to permit proceeding. An iframe load event does not prove playback. If the embed is unavailable, explain that proceeding is possible without declaring that the video played. Leaving the phase destroys/clears its iframe so audio cannot continue in the background. Repeat start/proceed actions must not create multiple iframes or duplicate attempts.

### Lecture audio

- Before verification, use “Lecture audio not checked” or an equivalent truthful neutral status. Use Loading while resolving; use Ready only after the current audio reaches `canplay`/equivalent playable readiness. Metadata alone and successful HEAD are insufficient.
- Keep absolute `/database/Take%20Notes/RL/audio/<encoded-id>.<extension>` URLs and the supported `mp3`, `m4a`, `wav`, `aac`, `ogg` order.
- Use AbortController for HEAD/fetch probes: at most 2 seconds each and a **10-second total resolve-and-ready deadline**, including media readiness. Every stage consumes remaining budget; do not multiply five timeouts and then start a fresh decode timeout.
- Abort previous probes on question change, retry, exit, and scope change; increment the existing audio token. Uncancellable media/Firebase events must also validate the generation, current question, and active phase.
- Keep the current successful response/content-type validation. A Hosting HTML fallback, missing file, decode error, stalled load, or expired deadline must leave Play disabled with Retry audio/Choose another question. Never label a network timeout as confirmed missing content.
- Retrying audio preserves notes and does not submit or increment progress. Remove prior audio listeners/timers before attaching new ones. A stale `canplay` cannot enable the current question's player.
- Add an optional `onPlaybackError` callback to `PracticeAudioPlayer.attach` so Notes can surface rejected `audio.play()` promises. Existing callers keep their current behavior. A denied autoplay/user gesture is a recoverable playback error, not proof of a frozen app.

If baseline tracing shows XLSX parsing or text comparison causing material long tasks, report duration, input size, and call stack. Apply only a measured bounded fix within this plan's files. Moving parsing to a new worker/new asset pipeline is not pre-approved without an exact contract amendment and coordinator decision.

## 6. Files, ownership, and dirty-work protection

One later Luna task owns all paths below exclusively. Other work is present in the repository; preserve it and do not revert changes made by others. No parallel writers, emulator owners, or browser owners.

Planning artifacts already outside Git:

- `C:\Users\Admin\Documents\Codex\task-contracts\PRACTICE-UI-PLAN-20260913-01a09b3c\structure-contract.json`
- Same directory: `structure-before.json`, `before-worktree.patch`, `before-index.patch`, `protected-root-implementation_plan.md`, and `inspected-source-hashes.json`.
- The root plan's inspected SHA-256 is `40F5A1E6BCF06DE0A1C18199C37E177E1FB3E0B5C0A7A03EB188FEB2D76AAA36`. It must remain unchanged by this package.

Dirty work includes the root plan, `package.json`, `public/describe-image-mode.js`, `public/rts-mode.js`, `public/hiw-mode.js`, `public/hiw-mode.css`, their tests/data, and unrelated CRM/presentation work. Do not reset, stash, broadly stage, or copy these changes. Do not copy runtime database/media directories out of the saved checkout without an exact provenance/required-fixture declaration.

Implementation starts from a clean candidate at the inspected HEAD, not from all current dirty files:

```powershell
git worktree add -b codex/practice-mode-ui-redesign-20260913 'C:\Users\Admin\.codex\worktrees\practice-mode-ui-redesign-20260913\Cursor AI' d188648e36ef0c505951fdb622536654051adb82
```

If that branch/path already exists, inspect and reuse only after proving ownership and clean state; never remove another task's worktree. The candidate may differ from dirty DI/RTS/HIW behavior seen in the saved checkout. Record that difference explicitly; do not claim integration with those uncommitted fixes.

Before copying this plan or editing the candidate, Luna records a new external implementation contract and canonical before snapshot under `C:\Users\Admin\Documents\Codex\task-contracts\PRACTICE-UI-IMPLEMENT-20260913\`. Include exact create/modify paths, base SHA, actual Luna task ID, unresolved long-term domain owner, generated/evidence destinations, protected contracts, and commands. Copy only this approved plan into the candidate. Do not edit its contents during execution: an edit to `implementation_plan.md` reopens the last-call approval gate.

### Allowed product modifications

| File | Allowed responsibility |
| --- | --- |
| `public/index.html` | Mode-local flat grouping/host attributes, Retell recovery controls/status, player alignment hooks; preserve IDs and registration. |
| `public/speaking-practice-controller.css` | Scoped header/task/action/progress geometry and compatibility-footer behavior. Preserve unrelated typography rules. |
| `public/js/speaking-practice-controller.js` | Optional host resolution, reversible placement, cleanup, and accurate layout measurements only. |
| `public/js/speaking-practice-adapters.js` | Explicit host/phase mapping for the eight adapters; preserve enabledScopes and mode-owned actions. |
| `public/css/practice-audio-player.css` | Scoped main-task player/meta alignment and responsive geometry; keep Read Aloud Settings exception and existing child-class selector contract. |
| `public/style.css` | Existing Notes and Type/Speak body geometry, duplicate-action visibility, and directly affected task-region rules only; no global restyling. |
| `public/take-notes-mode.js` | Entry/catalog/audio generations, deadlines, recovery, canonical-action wiring, cleanup; preserve scoring and progress shape. |
| `public/js/lazy-loader.js` | Notes-only dependency ordering/deadline integration; preserve other modes' retry/deduplication behavior. |
| `public/script.js` | Notes loading-shell/entry boundary, existing transition checks, and necessary Type/Speak layout integration only; preserve assessment and recording logic. |
| `public/js/practice-audio-player.js` | Optional playback-error notification with default-compatible behavior. |
| `package.json` | Add only the focused practice-workspace verification command; no dependency or unrelated script changes. |

No new product module, font, library, data format, backend route, service worker, generated workbook/audio file, or deployment config is required.

### Allowed test/document changes

Create:

- `tests/practice-workspace-contract.test.js`
- `tests/notes-loading-recovery.test.js`
- `tests/browser/helpers/launch-practice-chrome.js`
- `tests/browser/practice-workspace-layout-browser-check.js`
- `tests/browser/notes-loading-recovery-browser-check.js`
- `docs/audits/practice-ui/2026-09-13-candidate/verification.md`

Modify these existing browser checks only for explicit Chrome launching, declared evidence output paths, and assertions genuinely changed by the approved layout contract:

- `tests/browser/speaking-controller-browser-check.js`
- `tests/browser/speaking-shell-cross-mode-check.js`
- `tests/browser/speaking-ui-review-regression-check.js`
- `tests/browser/notes-navigation-audio-browser-check.js`
- `tests/browser/notes-mode-browser-check.js`
- `tests/browser/practice-router-back-popstate-browser-check.js`
- `tests/browser/lazy-loader-retry-rfib-browser-check.js`
- `tests/browser/practice-modes-browser-check.js`
- `tests/browser/read-aloud-lifecycle-browser-check.js`
- `tests/browser/speaking-pronunciation-tooltip-check.js`

The approved plan itself is copied as a create in the clean candidate. Do not modify the existing notes recommendation tests, scoring routes, dirty RTS/HIW tests, structure policy/baseline, AGENTS files, `agent_docs/project_progress.md`, or `agent_docs/latest_session_work.md`.

Retain runtime screenshots, traces, timing samples, sanitized console/network logs, and fixture-only persisted records under the implementation external task directory's `evidence/<run-id>/`. Register each harness's output there; do not create new screenshots beneath tracked `tests/browser/` paths. The compact audit document records source SHA, relevant hashes, Chrome version, commands, fixture/service identity, result counts, limitations, and restore/reproduction instructions. Keep evidence until candidate acceptance and the coordinator's retention decision; no cleanup is authorized by this plan.

## 7. Staged implementation tasks

### Task 0 — Establish the exact candidate and evidence boundary

Owner: Luna X High.

1. Read `AGENTS.md`, `agent_docs/project_structure.md`, `docs/AGENTS.md`, and this approved plan. Load the relevant execution, testing, accessibility, and verification skills while preserving this model/route/approval contract.
2. Verify the saved-checkout planning delta and protected root-plan hash. Run its task-local structure completion check using the planning contract/snapshot. If other tasks changed files concurrently, distinguish those deltas with ownership evidence; do not erase them or widen the planning declaration.
3. Create the clean candidate, its external contract/snapshot, and copy this exact plan. Record plan hash and coordinator approval provenance.
4. Check Node, installed Chrome, dependencies, and required ignored media availability. Use candidate dependencies/lockfile; do not update dependencies or borrow an unverified running server from another checkout.
5. Declare the ten existing browser-harness adjustments and new helper before writing them. The helper launches `chromium.launch({ channel: 'chrome', ... })`, reports the browser version, and fails clearly if Chrome is unavailable. Do not silently fall back to bundled Chromium. Existing tests mostly use bare `chromium.launch`, so their current names alone do not prove Chrome coverage.

Acceptance: clean owned candidate; exact inputs/output roots known; no source work in the saved checkout; no tests performed by Astra.

### Task 1 — Establish meaningful baseline and failing acceptance checks

Files: new contract/recovery/layout tests, Chrome helper, and the listed existing harnesses.

1. Build the new Chrome tests against the actual candidate HTML/CSS/controller/adapters and actual mode scripts. Use deterministic sanitized service responses and small audio served by the test fixture. Do not build a separate demo page or implement the expected layout inside the fixture.
2. Record baseline geometry for all 14 affected modes at 1440x900, 1024x768, 768x1024, 390x844, and 320x740; record Basic/Advanced, long question labels, settings open, and applicable phases. Capture the two reported routes through both direct URL entry and dashboard navigation.
3. Add failures for detached action placement, mismatched player/response edges, duplicate accessible actions, blocked hit targets, stale mount state, and Retell readiness/timeouts. Keep assertions against semantic outcomes, not only classes or screenshot existence.
4. Record Retell timings/network/long tasks for cold and warm entry, Start Lecture, Proceed to Notes, audio ready/play, question change, and exit. Collect click acknowledgement, state transitions, request durations, long-task counts/max duration, and terminal outcome separately.
5. Inject pending/rejected Firestore, valid/failed workbook, blocked helper script, hung HEAD, wrong content-type, delayed media readiness, blocked iframe, and navigation during load. Separate a still-responsive pending promise from a renderer stall or a stalled automation call.

Expected: new behavioral/layout assertions expose baseline gaps. An old test failure is triaged before being attributed to this package. Do not weaken existing scoring/lifecycle assertions to obtain a green baseline.

### Task 2 — Add reversible local control placement

Files: `speaking-practice-controller.js`, `speaking-practice-adapters.js`, controller CSS, HTML, and focused contract/browser tests.

1. Implement the optional layout contract from section 4, with panel ownership validation, original-node adoption, fallback, and teardown.
2. Add hosts to existing mode/phase containers. Resolve action hosts for Notes ready/video/audio/results; Speak listen/record/results; Type answer/results; ASQ answer/results; RTS audio/prep/record/results; DI prepare/record/review/results; SGD listen/record/results; RA prompt/recorded/results.
3. Preserve mode-owned internal phase distinctions even when a preview shows fewer steps. Do not use a three-step preview index as a substitute for a four-state internal result workflow.
4. Move timer/media slots only to the relevant local host. Controls already inside a player stay there; do not duplicate them in the action rail.
5. Verify repeated mount/sync/unmount, English/PTE switch, Settings open/close, and failed mount. Assert original node identity, exactly one click callback, correct hidden/disabled state, unchanged preference values, and zero orphan controls/overlays.

Acceptance: every adapter's active action is in its declared active task host, original controls restore correctly, and timers/scoring are still solely mode-owned.

### Task 3 — Apply the responsive workspace across the affected modes

Files: HTML, controller CSS, player CSS, scoped existing `style.css`, and layout browser test.

1. Align question navigation, task content, player, metadata, and action region. Remove nested-card decoration from intermediate regions.
2. Implement the desktop/mobile arrangements from section 3. Scope every new rule to declared practice hosts/modes; do not use a global `.mode-panel > *` flattening rule.
3. Align the six standalone listening players and their response/action groups in place. Do not register new adapters or modify their behavior modules.
4. Compact existing progress/recommendation presentation without changing stored mastery or reset semantics. Preserve all existing settings and their keyboard access.
5. Verify Read Aloud passage width and sample player separately; preserve the deliberate full-column passage and compact Settings player.
6. Replace old footer-location assertions with task adjacency, active action availability, identity/restoration, and visibility-scope assertions. Keep comparable or stronger lifecycle coverage.

Acceptance: shared task edges differ by at most 2px within each mode; primary action is separated from its task by 12–20px in normal short-task layouts; all 14 modes have reachable current actions at the target widths; no nested intermediate cards or horizontal overflow; keyboard order follows visual flow.

### Task 4 — Consolidate Retell and Repeat Sentence actions

Files: HTML, Notes module, adapters, scoped CSS; `script.js` only where the existing Speak integration requires it.

Retell:

1. Use `notes-start-btn` as the canonical overview Start Lecture control. Keep `play-notes-btn` as a hidden compatibility alias while consumers are checked; it must not be visible, tabbable, or adopted as a second action in either scope.
2. Keep the existing `notes-submit-btn` and `notes-retry-btn` as canonical controls in their local phase hosts. Hide `notes-in-card-submit-btn` and `notes-in-card-retry-btn` aliases in both scopes rather than rendering replacement controls. Retain compatibility listeners only where needed; test exactly one submission per user action.
3. Keep Proceed to Notes beside the video, the audio player immediately above notes, and Submit below the notes. Results pair transcript and notes with existing match/progress semantics and one Retry.
4. Update overview wording to reflect the actual flow; add no speech recording or new pronunciation assessment to Retell.

Repeat Sentence:

1. Keep Play/timeline/time/volume/replay allowance in one player region.
2. Place the existing `record-btn`, then state-dependent Check/Retry, beside the response region. Preserve transcript, recording playback, timers, progress, and settings.
3. Verify Play still spends one replay and restarts, seek stays disabled, Stop does not trigger assessment, and Check invokes the existing assessment path exactly once.

Acceptance: one accessible primary action per phase; no action uses a cloned node; English and PTE variants preserve their labels/routing and saved behavior.

### Task 5 — Implement Retell bounded loading and recovery

Files: Notes module, notes-only lazy-loader path, Notes entry branch in `script.js`, optional player-error callback, HTML/status CSS, and recovery tests.

1. Implement the exact entry/data policy and generations in section 5. Reuse current transition protection. Preserve question IDs, route restoration, filtering, recommendation, `loadEntriesPromise` deduplication, and `hasLoadedEntries` semantics.
2. Fetch fallback concurrently but retain Firestore priority until failure/timeout or explicit local selection. Do not commit stale remote data over a local attempt. Verify both source outcomes against the same normalized entry shape.
3. Implement bounded audio probes/readiness, current-question validation, abort/cleanup, and explicit retry. Add media/playback failure feedback without enabling playback from a HEAD response.
4. Make video proceeding and navigation independent of iframe readiness. Clear abandoned media and iframe playback.
5. Run focused recovery tests after each behavior change. Compare baseline and candidate timings using the same fixture, Chrome version, and route entry method.

Acceptance: 12-second entry and 10-second audio terminal budgets hold under injected hangs; navigation remains usable; no late completion changes the active mode/question/notes; all probes/listeners/timers are retired correctly; readiness is truthful. Report performance improvement and remaining unreproduced freezing separately.

### Task 6 — Verify protected behavior and persistent history

Owner: the same Luna task; one browser/emulator owner.

Use local Playwright first. Before an authenticated browser plan/run, read `C:\Cursor AI\.local\browser-test-credentials.md`; use its admin account and never copy credentials into tracked files, commands, reports, screenshots, or logs. Reference the existing credential helper where useful. Candidate-local emulator identity must be explicit; never let a fixture or assessment test fall through to a production write or paid scoring endpoint.

For an authenticated integration pass, start the candidate's configured local emulator/server through the existing `npm run emulators` and `npm start` workflows after checking their configuration, ports, and local-only endpoints. Do not rely on the dirty checkout's untracked `dev:server` helper. Missing emulator configuration is a reported prerequisite, not permission to test writes against production.

Verify:

- Notes: start/video skip/audio/typing/submit/results/retry, filters/recommendation, deep-link question identity, no-video path, empty notes validation, audio recovery preserving draft, exit/reentry and PTE/English behavior.
- Speak/RA/ASQ/RTS/DI/SGD: permission denied and granted, record/stop/playback/check or submit as applicable, timers, cancellation, retry/next, and stale result exclusion. Preserve `AudioDspPipeline` usage; a fixture must not bypass it to make a UI test pass.
- Pronunciation paths: unchanged Azure forced-alignment contract (`expectedText`, Comprehensive/Phoneme), word `accuracyScore` separate from syllables, existing color thresholds, valid millisecond playback bounds, `heardIpa`/coaching, and `Phonetics.normalizeIPA()`. Verify rendering with compatible payloads and unchanged request construction. Do not introduce new semantic/acoustic scoring or fabricate word timings.
- Read Aloud: Stop captures/stages; Check assesses. Preserve `REQUESTING_MIC`, `STOPPING_RECORDING`, `RECORDED`, recording playback, attempt archive/history, and Settings teardown.
- Type and the six standalone listening modes: original response/choice/highlighting, replay/seek/speed permissions, submission and result review, applicable word counts/timers, next/retry, and stored progress.
- Existing historical records and preferences: seed representative legacy records in local storage/IndexedDB/emulators, record their values, load them through normal UI, submit one new local attempt, reload, and prove old records remain semantically/byte unchanged as appropriate. Existing records lacking newer optional fields remain viewable. Do not infer production persistence from this fixture exercise.
- All eleven adjacent modes: dashboard entry/back, correct active panel, no shared-style clipping/overflow, and no unexpected controller mount. This is a scope/routing regression pass, not a claim of exhaustive mode-specific assessment testing.
- Accessibility: keyboard-only question selection/settings/actions, dialog focus return, focus persistence during loading, 200% zoom, reduced motion, touch target sizes, and `elementFromPoint` at action centers with app chat/mobile navigation present. Test the mobile text field with keyboard/viewport reduction.

After Playwright, obtain a second interactive local Chrome confirmation using the workspace `browser-agent` workflow if available, with the same candidate source and representative Retell/Repeat flows. If unavailable, record the exact tooling limitation and leave that evidence item unfulfilled; do not invent browser confirmation.

### Task 7 — Settled-candidate checks and local commit

Run focused checks during their relevant tasks. Once the candidate is settled, run the acceptance collection once; repeat only the checks affected by a subsequent fix.

New focused command to register in `package.json`:

```text
npm run test:practice-workspace
```

It executes the two new Node tests and two new Chrome tests in sequence and exits nonzero on any failed assertion. All four files use the real implementation or an isolated VM loading the actual source; do not test a reimplementation of the expected algorithm.

Run these existing focused regressions, using the Chrome helper for browser files:

```text
node tests/notes-smart-jump-regression.test.js
node tests/recommendation-notes-regression.test.js
node tests/repeat-sentence-route.test.js
node tests/asq-logic.test.js
node tests/browser/speaking-controller-browser-check.js
node tests/browser/speaking-shell-cross-mode-check.js
node tests/browser/speaking-ui-review-regression-check.js
node tests/browser/notes-navigation-audio-browser-check.js
node tests/browser/notes-mode-browser-check.js
node tests/browser/practice-router-back-popstate-browser-check.js
node tests/browser/lazy-loader-retry-rfib-browser-check.js
node tests/browser/practice-modes-browser-check.js
node tests/browser/read-aloud-lifecycle-browser-check.js
node tests/browser/speaking-pronunciation-tooltip-check.js
```

The lifecycle check takes `BROWSER_TEST_BASE_URL` for the candidate local service. Tests that start their own fixture server keep that behavior. Record exact outputs and prerequisite failures; do not call a skipped test passing. No production-named browser script is included.

Also run `node --check` on each changed product/test JavaScript file, `git diff --check`, `npm run test:structure`, and the required workspace `npm run verify:crm` once on the settled candidate. No Python implementation changes are in scope, so Python unit suites are not applicable. CRM failures unrelated to this allowlist are reported with baseline evidence and are not an invitation to edit CRM files.

Task-local structure commands, from the applicable checkout, with its exact external contract/snapshot:

```text
node scripts/structure/check.cjs snapshot --contract <external-task-dir>/structure-contract.json --out <external-task-dir>/structure-before.json
node scripts/structure/check.cjs check --base d188648e36ef0c505951fdb622536654051adb82 --contract <external-task-dir>/structure-contract.json --snapshot <external-task-dir>/structure-before.json --json
```

Snapshot is before edits; do not replace it with an after snapshot to conceal undeclared deltas. Expected structure result: exit 0, possibly with unchanged legacy notices. New violations require a real fix or a coordinator-reviewed exact exception; no policy/baseline widening.

Final audit and commit:

1. Luna audits the actual diff against every protected contract and the file allowlist. Check phase hosts, listener/observer cleanup, immutable historical data, timeout accounting, and source selection; do not rely on screenshots alone.
2. Write the compact verification record with actual pass/fail counts, baseline/candidate measurements, exact candidate SHA/file hashes, test service configuration, and unresolved evidence. Do not claim the freeze fixed if it was never reproduced; state the bounded loading defects corrected and what was verified.
3. Compare actual worktree/index changes against the external contract. Confirm the saved checkout's unrelated work/root plan were not changed by this task.
4. Stage only explicitly declared candidate paths using an exact list, inspect the staged diff, and create a local commit, suggested subject `Improve practice workspace layout and Retell loading recovery`. Do not use `git add .`.
5. Record the commit SHA, confirm its source tree matches the tested content hashes, and report candidate worktree/branch and clean status. A documentation-only final evidence addition does not require repeating unrelated browser runs; bind the evidence to the tested product hashes and explain the commit relationship.
6. Stop after local completion. Do not merge, copy code back, push, tag `(D)`, or deploy. A later integration/release request must reconcile the dirty DI/RTS/HIW and other concurrent work explicitly.

## 8. Definition of done

- Coordinator approval of this dedicated plan is recorded before implementation.
- One Luna X High task performs all implementation, tests, verification, fixes, and the local commit.
- All eight controller modes have coherent, reversible task-local controls; the six additional player layouts are aligned; the eleven adjacent modes remain outside the structural migration.
- Retell has one accessible start/submit/retry action per phase, truthful media readiness, bounded recoverable loading, and safe cancellation/reentry. Its existing typed-note/scoring flow remains intact.
- Repeat Sentence retains replay limits, recording/Check separation, pronunciation rendering, settings, and history in the new arrangement.
- Phases, timers, scoring APIs, DSP, normalized IPA, saved records, progress, and routing are preserved with source/runtime/persisted-local evidence appropriate to each contract.
- The Chrome matrix and focused regressions pass with declared provenance; unavailable checks and an unreproduced freeze remain explicit limitations, not green checkmarks.
- Structure/diff audits match the exact declaration, historical/dirty work remains protected, and the final local commit exists. No production push or deployment has occurred.

## Approval note

The dedicated path was selected by the coordinator to avoid overwriting the dirty CRM Projects plan at the repository root. The planner stops immediately after creating this file under the workspace final-write rule. Consequently, the post-write structure check is assigned to Luna in Task 0; the planner makes no claim that it has already passed.
