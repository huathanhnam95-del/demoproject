# PTE speaking practice: review of the Gemini pass, UI/UX audit and fixes

| | |
|---|---|
| **Date** | Wednesday, 23 September 2026 |
| **Status** | Implemented and verified locally. **Not committed, pushed or deployed.** |
| **Base** | `feat/projects-subtasks-people` @ `23b8c716b`, on top of a large uncommitted tree (Opus UI pass, Gemini pass, BEL scoring/credits, canonical weak forms) |
| **Backups** | Dirty files as they were before this work: `.git/agent-release/backups/claude-1285-20260923/` (`files/` + `patches/`, hashes in `manifest.sha256`) |
| **Tracker** | Task 1285 |
| **Reviewed** | Gemini walkthrough `…/brain/29151a25-…/walkthrough.md` and its `implementation_plan.md` (tasks 1283, 1284) |

> **Before any release (PAR):** this tree mixes 4-5 workstreams inside the same files
> (`read-aloud-mode.js`, `describe-image-mode.js`, `pte-speaking-shell.css`, `script.js`).
> Separate them hunk by hunk. The Gemini changes this review replaced must not ship in their
> original form (section 1).

---

## 1. The Gemini pass: what held up and what did not

**Held up:**
- the CSS specificity fix that lets the Read Aloud coach drawer stack at ≤1100/≤980px
- the scoring-error panel reset between attempts
- the listen-back re-sync
- keeping `data-practice-layout` across mode switches
- hiding the empty SGD topic box

**Replaced:**

| Gemini change | Problem (verified) | Now |
|---|---|---|
| Audio-box fallback timer, `(duration‖4)+2 s` | Fired about 6 s into 60–120 s lectures, and did not pause the audio. The recorder then started while the lecture played on. It also skipped the question when autoplay was blocked, and whenever `play()` took more than 3 s. Failures completed silently. | Rewritten `public/js/pte-audio-box.js`:<br>• "Loading audio…" state<br>• a progress watchdog (15 s without progress)<br>• a stop-and-ask failure state with **Try again** / **Continue without audio**<br>• autoplay-blocked waits for a click<br>• a source swapped mid-play is retried<br>• no "Beginning in 0 seconds"<br>Proven:<br>• Gemini's box, RTS and ASQ fail all 7 original lifecycle scenarios.<br>• The finished code passes all 8 (the eighth covers the dock line). |
| Raw `/database/...` audio path set before the resolver (RTS, ASQ, RA sample voice) | Production rewrites those paths to `/404.html` (`firebase.json`), so every question made a failed request. Combined with the timer above, the question could be skipped. | Resolver first; the raw path is only the `.catch` fallback; the previous clip is cleared so it cannot replay. |
| `ai-scoring-gate.js`: HTTP 404 from the quote endpoint treated as "allowed, unmetered" | Added so the static test server (no API) would pass. It hid routing faults and left SGD and Retell stuck on "Analyzing…". | A 404 is an error again (plain message). SGD and Retell handle "unmetered, no result". The Read Aloud test now mocks the quote endpoint as "disabled" (503). |
| DI picture shrunk to `min(46vh,410px)` | Reversed your "bigger picture, no zoom" request to fit a 740px card target. | Restored `min(58vh,560px)` (owner decision, 23 Sep). The shell test checks the dock stays on screen instead. |
| Tests: DI/SGD "Start recording" clicks made optional with errors swallowed | A broken primary button could no longer fail a test. | Clicks are strict again. The countdown runs at real speed around them. |
| Claim E: `sharedDiAudioCtx` singleton | Never applied: the edit failed 3 times, and the walkthrough reported it done. Low impact (DI reuses the coordinator's context). | Recorded only. |

## 2. Production bugs found on the way

`public/sgd-mode.js` read `PREP_SECONDS` without declaring it, and the production file has the same line. At normal speed, Summarize Group Discussion's prep step throws a ReferenceError after the audio, so **the recorder never appears.** The browser suite only ran at 20× speed, which skips that line. The fix declares `PREP_SECONDS = 10` ("10 seconds to prepare"). The SGD suite now runs at real speed and passes. **Live until the next release.**

**A second one, found in the final checks:** Retell Lecture's `syncPteShell` asks the controller to sync, and the controller's sync calls Retell's `onSync`, which is `syncPteShell` again.
- Every Retell step change recursed until the stack overflowed. The empty `catch` swallowed the error, so the loop stayed invisible.
- Usually this only cost time: the Retell suite drops from 287 s to 55 s with the fix.
- Switching the practice scope from English back to PTE while Retell was open froze the page. The pre-task code freezes the same way.
- The fix is a re-entry guard in `syncController` (`public/js/speaking-practice-controller.js`): a mode's `onSync` cannot start another one.
- Also live until the next release.

## 3. UI/UX fixes (all seven speaking modes)

**High**
- **Phone dock.** One rule at ≤767px lifts the dock above the 60px mobile toolbar, with z-index 999, as the legacy footer did. It replaces five per-mode copies that applied only at ≤600px and missed Read Aloud and Retell (their buttons were hidden behind the toolbar).
- **"Ask me!".** On practice screens it is a 48px round chat button, lifted above the dock using `--pte-dock-height`, which the controller now publishes.
- **Microphone errors.**
  - New recorder-widget states: `showMicWaiting` (only after a delay), `showMicError`, and `describeMicError` (blocked / missing / busy / unsupported, in plain language).
  - The shell gains `setNotice` for a short dock line.
  - All seven modes return to prep (Retell: to Complete, where notes can still be scored), so **Start recording** is the retry.
  - Before, RA and ASQ wrote to hidden elements, RTS/SGD/ASQ were stuck in "recording", and DI/SGD/RL showed 5-second toasts.
- **Read Aloud capture failure.** One panel, "We couldn't capture your recording" with **Record again**, instead of:
  - a duplicated message
  - four empty tiles
  - a 00:00 player
  - "Coach tips · 0"
  - "Saved to Previous attempts" with nothing saved

**Medium**
- The dock claims "saved" only when Previous attempts lists the question; guests get "Saved below for this session…". The complete-phase copy and the Next dialog no longer claim a save.
- Picker labels:
  - RS: `#1 1` → `#1`
  - DI: `#0 #1 - Solar System` → `#1 Solar System` (`formatItem`)
  - RL: `[Lvl 1] #1 🎥 - Gas Giants` → `Gas Giants`
  - SGD: `#0 2 - #2 Writing…` → `#2 Writing an Essay` (`formatItem`; the option value is the list position)
  - ASQ: `#1109 Question 1109` → `#1109`
- DI picture: space kept while loading, "This picture didn't load" with **Try again**, zoom only once it has loaded.
- Score labels at 11.5px (were 9–9.5px); tiles go 2×2 in a narrow column (container query).
- RL, SGD and RTS feedback tabs use the shared pill tabs with roles and arrow keys (`SpeakingPracticeController.wireTabs`). RTS sample tabs lost their inline styles and emoji.
- One player for the learner's recording. RL/SGD/RTS feedback show the shared pill instead of a bare `<audio controls>` (the pill also now binds RTS's v3 element). RS, ASQ and DI keep their own richer players and no longer get a second one.
- No scroll areas inside cards (SGD 220/480px, RL 480px). RL's instruction callout, bordered audio card and icon are gone, matching the mockup.
- Phones: the header folds to one row, Filters becomes an icon, and the level chip is compact.
- The Filters/More popover fix now applies to every mode (it was RS/DI only).
- One instruction style (Arial 15px/1.6 #333) in all modes. The RTS situation is set like the RA passage.
- **Found during testing:**
  - Legacy RS recognition callbacks renamed the shell's button to "Start Recording". Guarded.
  - An unhandled ASQ speech-recognition rejection. Caught.
  - "Shadow · 5c" now reads "Shadow · 5 coins".
  - Retell's live waveform was never connected. Fixed.
- **Found in the final screenshot review:**
  - SGD still showed its old Play/Volume player under the notes, so the discussion could be replayed during prep and recording. The speaking-shell spec hides these players. It is now hidden in every phase: Feedback replays the discussion through the listen-back switch (section 8).
  - Feedback tabs in RL, SGD, RTS and ASQ stretched to the full column width, because those columns are flex columns. They are now as wide as their buttons, as in the other modes.
  - On phones, the listen-back pill dropped its time onto a second line: a generic `.pte-listen` rule outranked the pill's `nowrap`. It stays on one line now, and the track shrinks before the label does.
  - When the question audio failed, the dock kept saying "The recorder appears when the audio ends."
    - The audio box now sends a `pte-audio-state` event, and the shell shows the failure in the dock ("The audio couldn't play. Try again, or continue without it.").
    - The message clears on Try again, Continue or a new question.
    - The box stays quiet when the shell takes the message, so screen readers hear it once.
    - Used outside the shell, the box still announces it itself.

**Polish**
- The question arrows are quiet round chevrons, not gray/purple gradient squares.
- The level chip uses one calm blue style (B1 was red; higher levels were neon).
- Contrast:
  - recorder timers #8a8a8a → #6b6b6b
  - DI "cancelled" note (was 1.6:1)
  - AI-credit note colour; its primary button is blue, not indigo
- RTS's "Submit to AI Scoring" had become invisible (white text after the gradient strip). Legacy buttons in the card now get the shell's secondary style.
- The RA Speech Coach guide popup is a proper dialog: role, label, Escape, focus trap and return, and no listener build-up.
- The DI zoom button is 40px, and its time readout uses the token mono font.
- ASQ/RTS feedback uses the shared `.pte-fb` columns (1 column at ≤980px).
- The listen-back observer no longer reacts to every class change.

## 4. Owner decisions recorded here
- **DI picture:** bigger (`min(58vh,560px)`), even though the card can pass 740px; the dock stays on screen.
- **"Ask me!" on practice screens:** a compact round button.
- **Dock "Play" kept.** It is in the approved dock layout and seven suites use it, although it duplicates the listen-back player in Complete. Removing it is a separate call.
- **RA reduced-word marks while the Coach is closed (audit item M7): hidden until the Coach opens** (owner decision, 23 Sep, 19:10). Done in section 8.
- **SGD "Discussion" replay in Feedback:** built as the "Your recording | Discussion" switch (section 8).

## 5. Tests
- **New:** `tests/browser/pte-audio-box-lifecycle-check.js` (8 scenarios). They include:
  - a production-style media check that fails if RTS/ASQ request a raw `/database` audio path
  - the dock line when the question audio fails
- **New:** `tests/browser/pte-mobile-dock-check.js`. It covers 7 modes × 5 viewports (390, 700, 768, 1024×768, 1440) through every reachable phase:
  - hit-tests every dock button
  - one primary action
  - no sideways scroll
  - compact chat button
  - score labels
  - a blocked microphone at 390 and 1440
- **New:** `describeMicError` unit tests.
- **Changed, and why:**
  - DI and SGD: strict Start recording, real-speed countdowns
  - RA: quote-endpoint mock; waits for the resolved sample source
  - the shell suite checks the DI dock stays on screen (not a card ≤740px)
  - remediation: no nested scrollers
  - SGD/RTS/RL: the pill is the player
  - DI: a stub picture

## 6. Verification
Local runs in Chrome 153 through Playwright, 23 Sep 2026.
- **Baseline:** the tree as it was before this work.
- **Final:** the finished code, run after the last edit.

| Check | Baseline | Final |
|---|---|---|
| `tests/pte-recorder-widget.test.mjs` | pass | pass (adds `describeMicError`) |
| `tests/pte-shell-next-rules.test.mjs` | pass | pass |
| `npm run test:structure` / `test:security` | pass / pass | pass / pass |
| `pte-audio-box-lifecycle-check` (new) | — (Gemini's versions fail all 7 original scenarios) | 8/8 |
| `pte-shell-layout-contract-check` | pass | pass |
| `pte-speaking-remediation-check` | pass | pass |
| `pte-speaking-v3-unfinished-items-check` | pass | pass |
| `pte-read-aloud-v3-browser-check` | pass | pass (188/188) |
| `pte-repeat-sentence-v3-browser-check` | stopped at the 15-min limit: 76 checks passed, none failed | pass: all 97 checks, finished in 18 min |
| `pte-describe-image-v3-browser-check` | pass | pass |
| `pte-retell-lecture-v3-browser-check` | pass | pass (55 s after the freeze fix; was 287 s) |
| `pte-asq-v3-browser-check` | pass | pass |
| `pte-rts-v3-browser-check` | pass | pass |
| `pte-sgd-v3-browser-check` | pass (only ever at 20× speed) | pass (prep at real speed) |
| `pte-shell-components-browser-check` | pass | pass |
| `pte-speaking-shell-browser-check` | pass | pass |
| `pte-mobile-dock-check` (new) | — | pass: 7 modes × 5 sizes through every reachable phase, plus a blocked microphone at 390 and 1440 |

**Cross-feature suites** (20 other suites that load the changed files):
- **Pass:**
  - `frontend-practice-gating`, `practice-workspace-contract` and `pte-attempt-archive-frontend-contract` (unit)
  - `practice-font-browser-check`
  - `verify-wfd-spc`
- **Fail on the pre-task code too, with the same failures:** 12 older suites. They were compared by serving the pre-task files through an `express.static` preload.
  - `speaking-controller-browser-check`: 130 pass and 56 fail both ways. Before the freeze fix it hung at its Test 12 or 13 and hit the time limit.
  - practice-workspace-layout, practice-screen-regression, practice-ui-repairs-round2, all-modes-settings, notes-loading-recovery
  - six Read Aloud suites: question-picker-v7, coach-results, linking-and-reduced-words, practice-ui-repairs, results-linking-overlay, workbench-layout
  - Most look for the legacy controller (`.spc-controller`) or legacy buttons, which the v3 default (V2.0.14) no longer renders.
- **Also failing, not comparable by preload** (they use `server.js`): the `read-aloud-lifecycle` and `read-aloud-check` browser checks, and the `read-aloud-mode-regression` unit test.
  - The first two expect `.spc-controller` or a visible `#ra-record-btn`.
  - The third expects connected speech off by default. This task does not touch those toggles (the weak-forms work does).
- These legacy suites need retiring or updating for v3. That is a separate task.

Screenshots of every mode and phase at five sizes were reviewed side by side with the mockups. The key ones:
1. [Question audio failed](images/01-audio-failed-asq-1440.png): ASQ, 1440
2. [Microphone blocked](images/02-mic-blocked-ra-1440.png): RA, 1440
3. [Recording not captured](images/03-capture-failed-ra-1440.png): RA, 1440
4. [Phone practice screen](images/04-phone-rs-prep-390.png): RS, 390
   - one-row header
   - compact mode bar
   - dock above the toolbar
   - round chat button
5. [Phone feedback](images/05-phone-rts-feedback-390.png): RTS, 390. One-line recording pill and compact tabs.
6. [Retell feedback](images/06-rl-feedback-1440.png): 1440. One player, shared tabs, no boxes inside the card.

## 7. Follow-ups (not done here)
- The on-screen version still says V2.0.13 (`index.html:223`); production shows V2.0.14. This belongs to the release process.
- `TASK_TRACKER.csv` reuses task numbers 1279 and 1281.
- `tests/browser/pte-shell-v3-live-audit.js` writes its screenshots into the Gemini session folder and asserts almost nothing. It needs an evidence directory and real assertions.
- Locally, the media catalog on storage.googleapis.com was blocked by CORS for `localhost`, so DI pictures didn't load in local runs (production is unaffected). Task 1289 (another agent, 23 Sep) has since added a local-catalog fallback to `media-url-resolver.js`, which may change this. Not rechecked here.
- Other practice surfaces (reading, writing, listening): re-run the 28-surface harness from `2026-09-01-practice-modes-ui-audit-handoff.md`.
- `tests/read-aloud-mode-regression.test.js` still fails at its linking-overlay step (about line 907). Its mocked prompt "Did you see it?" produces no linking marks, so the overlay stays hidden.
  - Real prompts draw linking arcs: `read-aloud-practice-ui-repairs-check` passes.
  - The test's data mocks need updating for the spoken-forms linking engine. That's for the linking/weak-forms owner.

## 8. Follow-up round (task 1293, 23 Sep evening)
- **SGD "Your recording | Discussion" switch** (spec 7.4).
  - The shared listen-back pill (`pte-listen-back.js`) takes an optional second source per phase (`alt`).
  - When SGD reaches Feedback and the discussion audio has loaded, the pill's label becomes a two-button switch that rebinds the same player. The play and seek labels follow the source ("Play the discussion").
  - The old blue Play/Volume player is now hidden in every phase.
  - On phones the switch takes its own row.
  - The SGD suite checks the switch. The phone-layout check now fails if the pill overflows its card at any size.
  - Screenshots: [1440](images/07-sgd-discussion-switch-1440.png), [390](images/08-sgd-discussion-switch-390.png).
  - The RA clean passage: [1440](images/09-ra-clean-passage-1440.png).
- **RA passage clean until the Coach opens.**
  - Shell CSS hides the reduced-word, sound-change and linking marks, and their clicks, while `data-pte-coach` is not `open`. The border stays transparent, so words don't shift.
  - `ReadAloudMode.syncPteGuideTokens` takes the marked words out of the tab order (restored when the Coach opens or the shell unmounts) and closes an open word popover.
  - The RA suite checks both states. The Q1025 popover check now opens the Coach first.
- **Older suites.** Of the 15 that failed:
  - 14 now pass.
  - The regression test above is still open.
  - They request the legacy layout they were written for (`?pteShell=legacy`, which still ships as the fallback), and their stale expectations were updated with the commit that changed each behaviour:
    - Settings-sheet CSS rules were duplicated in `speaking-practice-controller.css`. Merged; the result is identical, since the later copy won before.
    - The RA instruction wording changed in V1.8.116.
    - RA actions live in `#ra-action-host` since `8f329a5d3`.
    - "Rhythm & Stress" was added as a fifth guide (task 1241).
    - The stepper moves to Results after a recording (workspace v2, V2.0.9).
    - Hidden guide buttons can no longer take focus in a test.
    - Linking is on by default, so the tests turn guides on only if they're off.
    - The V2.0.15 AI-credit gate needs the quote endpoint mocked as 503 ("credits off").
    - The controller suite accepts the "Leave Read Aloud?" prompt and enters Read Aloud before checking its Settings sheet.
    - `read-aloud-check` uses the current entry flow and now fails for real when recording doesn't start.
