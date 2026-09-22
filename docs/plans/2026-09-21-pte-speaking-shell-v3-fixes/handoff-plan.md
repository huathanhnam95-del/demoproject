# PTE Speaking shell v3 — fix handoff plan

| | |
|---|---|
| **Date** | Monday, 21 September 2026 |
| **Status** | Audit complete. Fixes not started. **Live since 21 Sep ~22:00**: another session deployed the current build and set `RELEASE_DEFAULT = true`, so every learner now sees the v3 shell — the defects below are user-facing. |
| **Audited build** | Repo `d3658c42f` on `feat/projects-subtasks-people` (v3 merged in `e6bc579de`) and **production** `https://betterenglishlearning.com` (V2.0.13) |
| **Design source of truth** | [../2026-09-19-pte-speaking-redesign/handoff-plan.md](../2026-09-19-pte-speaking-redesign/handoff-plan.md) and its target images + interactive mockups |
| **Engineering owner** | Unresolved — record in your task contract ([AGENTS.md](../../../AGENTS.md)) |
| **Tracker** | Task 1258 (this audit). Add a row per fix batch. |

**One-line summary:** the v3 shell is built, merged and now live by default, and it still has **9 differences from the approved mockups** (D1–D9) — the largest being that legacy CSS wins over the new button styles (red primary button instead of blue) and the Speech Coach marks stay on the passage while Coach is closed.

**Rollback lever while fixing:** set `RELEASE_DEFAULT = false` in `public/js/pte-shell-config.js` (or open any question with `?pteShell=legacy`) to put learners back on the old layout.

---

## 1. How the audit was run (reproduce before you fix)

```bash
# A. current repo, local static server, guest mode, stubbed recorder, shell forced on
node <scratch>/audit-v3.js <out-dir>        # script listed in §6.1; opens /index.html?pteShell=v3
# B. production, same page, shell forced on
node <scratch>/live-shot.js <out-dir>       # https://betterenglishlearning.com/pte-practice/speaking/read-aloud/818?pteShell=v3
# C. deployed vs repo file comparison (PowerShell)
Invoke-WebRequest https://betterenglishlearning.com/js/read-aloud-workspace-view.js  # compare with public/js/…
```

Evidence images in this folder: [`images/implemented/`](images/implemented/) — `live-read-aloud-prep.png` (production), `impl-*-prep.png` (repo build, all 7 modes), `impl-read-aloud-recording.png`, `impl-read-aloud-complete.png`.

---

## 2. Deploy status — resolved during this audit

When the owner reported the problem, production was serving an **older** v3 build, which is why the screenshot showed the old heading, the old instruction line and the Speaking tips box: those had already been fixed in the repo but not deployed.

Re-checked at 22:09 on 21 Sep 2026 — production now matches the repo, and the shell is on by default:

| File | Repo chars | Live chars | Same? |
|---|---|---|---|
| `public/js/read-aloud-workspace-view.js` | 14,642 | 14,642 | yes |
| `public/js/speaking-practice-controller.js` | 83,290 | 83,290 | yes |
| `public/css/pte-speaking-shell.css` | 41,268 | 41,268 | yes |
| `public/read-aloud-mode.js` | 335,057 | 335,057 | yes |
| `public/js/pte-shell-config.js` | `RELEASE_DEFAULT` | **`true`** | flag on for everyone |

Gone from the live page after that deploy: the "Question … READ ALOUD" heading, the "Read silently and plan your phrasing…" line and the Speaking tips box. Still present on the live page: everything in §3 below (measured live at 22:12, no query parameter).

---

## 3. Differences between the shipped code and the mockups

Measured on the repo build **and confirmed live** after the deploy above (screenshot: [live-after-deploy.png](images/implemented/live-after-deploy.png), measured with no query parameter). Target column links the approved image.

| ID | Defect | Evidence (repo build) | Target |
|---|---|---|---|
| **D1** | **Primary action is red, not blue**; "Finish recording" is crimson, not slate with a red square | live and repo: `#ra-record-btn` computed `background-color: rgba(0,0,0,0)`, `background-image: linear-gradient(135deg, #f43f5e, #e11d48)`; classes `modern-btn modern-btn--record pte-btn pte-btn--primary` | [ra-01](../2026-09-19-pte-speaking-redesign/images/target/read-aloud/ra-01-prep-coach-closed.png), [ra-03](../2026-09-19-pte-speaking-redesign/images/target/read-aloud/ra-03-recording.png) |
| **D2** | **Speech Coach marks stay on the passage while Coach is closed** (blue linking arcs, amber weak-form underlines) | live: `data-pte-coach="closed"` with 15 nodes inside `#ra-linking-overlay`; repo: overlay height 120px | [ra-01](../2026-09-19-pte-speaking-redesign/images/target/read-aloud/ra-01-prep-coach-closed.png) vs [ra-02](../2026-09-19-pte-speaking-redesign/images/target/read-aloud/ra-02-prep-coach-open-word-popover.png) |
| **D3** | **Question picker keeps its legacy look inside the new bar**: dark prev arrow, purple next arrow, white pill; and it sits next to the new back arrow, so two left arrows appear side by side | mode bar children: `.pte-btn--icon` (back) then `.spc-picker-prev`, `.spc-picker-pill`, `.spc-picker-next` | [ra-01](../2026-09-19-pte-speaking-redesign/images/target/read-aloud/ra-01-prep-coach-closed.png) |
| **D4** | **Level chip shows the full "A1 (BEGINNER I)"** instead of the compact "A1" | live: chip text `target A1 (BEGINNER I) tune`; `#difficulty-badge` moved unchanged | [ra-01](../2026-09-19-pte-speaking-redesign/images/target/read-aloud/ra-01-prep-coach-closed.png) |
| **D5** | **Coach count can be stale** — live now reads `Coach · 3` with 3 hints (correct), but the repo run showed `Coach · 5` in prep and `Coach · 0` in complete/feedback, so the count is refreshed only when `updateUIForState()` happens to run after the hints render | count reads `currentGuideExplanationItems.length` at `read-aloud-mode.js:3884`; the array is filled later at `:5309` with no refresh call | [ra-01](../2026-09-19-pte-speaking-redesign/images/target/read-aloud/ra-01-prep-coach-closed.png) (“Coach 4”) |
| **D6** | **SGD still shows the legacy audio status line** ("Loading audio…") | `#sgd-audio-status` VISIBLE in the v3 shell | [summarize-group-discussion-01](../2026-09-19-pte-speaking-redesign/images/target/speaking/summarize-group-discussion-01-listen.png) |
| **D7** | **ASQ and RTS have no two-column feedback** | `pte-fb` appears in `read-aloud-mode.js`, `script.js`, `describe-image-mode.js`, `sgd-mode.js`, `take-notes-mode.js` — **not** in `asq-mode.js`, `rts-mode.js` | [answer-short-question-05](../2026-09-19-pte-speaking-redesign/images/target/speaking/answer-short-question-05-feedback.png), [respond-to-situation-05](../2026-09-19-pte-speaking-redesign/images/target/speaking/respond-to-situation-05-feedback.png) |
| **D8** | **Audio box has no failure state** — when a clip cannot load it stays on "Beginning in 0 seconds" forever | RS / ASQ / SGD / RL in the offline audit | §4.5 of the design plan |
| **D9** | **Read Aloud may skip the Complete step** — after "Finish recording" the dock showed the feedback buttons (Try again / Next question) | offline run; assessment failed, so needs an online re-check | [ra-05](../2026-09-19-pte-speaking-redesign/images/target/read-aloud/ra-05-complete.png) |

Working well (do not regress): mode bar, card (940px, 20px radius), progress bar, test instruction with per-prompt timings, recorder widget in all three states (64 waveform bars, "00:02 Recording … 00:30", green Complete), dock phase visibility (Coach hidden while recording), Previous attempts section with guest note, `.pte-audio` box in the listen-first modes, and legacy nodes hidden in DI / RL / RTS / ASQ.

---

## 4. Fix tasks

Each task: root cause, exact change, acceptance. Decide the flag state first (§7): the shell is currently on for every learner.

### D1 — button colours (highest visual impact)

- **Root cause:** `public/speaking-practice-controller.css:2133–2143` styles `#mode-read-aloud #ra-record-btn, #mode-read-aloud #ra-stop-btn` with the record gradient. That selector is **two IDs** (0,2,0,0). The v3 override at `public/css/pte-speaking-shell.css:90` is `body.pte-shell-v3 .pte-dock #ra-record-btn` — one ID plus two classes (0,1,2,1) — so the legacy rule wins regardless of file order. `.modern-btn--record` in `public/style.css:8000` is the same problem one level down.
- **Fix (do both):**
  1. In `public/js/speaking-practice-controller.js`, when adopting a control into the v3 dock, strip legacy visual classes and record them for restore on unmount:
     ```js
     const LEGACY_BTN_CLASSES = ['modern-btn', 'modern-btn--record', 'modern-btn--check', 'modern-btn--retry', 'modern-btn--play', 'recording'];
     entry.removedClasses = LEGACY_BTN_CLASSES.filter(c => el.classList.contains(c));
     el.classList.remove(...entry.removedClasses);          // restore in unmountV3()
     ```
  2. In `public/css/pte-speaking-shell.css`, raise the v3 overrides to beat two-ID selectors and clear the gradient:
     ```css
     body.pte-shell-v3 #mode-read-aloud .pte-dock .pte-btn { background-image: none; }
     body.pte-shell-v3 #mode-read-aloud .pte-dock #ra-record-btn,
     body.pte-shell-v3 #mode-read-aloud .pte-dock #ra-check-btn { background: var(--blue-600); color: #fff; }
     body.pte-shell-v3 #mode-read-aloud .pte-dock #ra-stop-btn { background: var(--text-primary); animation: none; }
     ```
     Do the same audit for the other six modes' ID-scoped button rules (`speaking-practice-controller.css` has `#mode-…` blocks for `describe-image`, `sgd`, `rts`, `notes`, `asq`, `speak`).
- **Accept:** in every mode and phase, `getComputedStyle(primary).backgroundColor === 'rgb(37, 99, 235)'` and `backgroundImage === 'none'`; the stop button is `rgb(30, 41, 59)` with the red square from `.pte-btn--stop::before`; no `pulse` animation in the dock.

### D2 — passage marks follow Coach

- **Root cause:** nothing links guide rendering to the Coach open state; guides render whenever the prompt analysis hydrates.
- **Fix:** in `public/read-aloud-mode.js`, gate the visual guides on `this.pteCoachOpen` while v3 is active:
  - when Coach closes: clear the guide overlay (`renderRecognizedLinkingOverlay(...)` target emptied / `#ra-linking-overlay` cleared) and remove the weak-form/sound-change classes from `#ra-text-prompt` (reuse `clearPromptVisualState()` paths that already exist);
  - when Coach opens: re-run `renderPromptForCurrentView()` so the chips' current selection draws again;
  - keep the learner's chip selection in memory so reopening restores it.
- **Decision needed (O-10, §8):** guides also decide what Speech Coach assesses ("reviews only the guides that are on when you record"). Default in this plan: **marks and assessment follow the chips**, and closing Coach turns the marks off but leaves the chip selection intact for the next attempt. Confirm before coding.
- **Accept:** with `data-pte-coach="closed"`, `#ra-linking-overlay` has no child paths and no `.ra-text` token carries a guide class; opening Coach restores them within one frame.

### D3 — picker inside the mode bar

- **Root cause:** `buildV3Shell()` moves `.spc-picker-nav` in unchanged, and `public/css/pte-speaking-shell.css:9` only constrains its width.
- **Fix:** add v3 styles that restyle the moved picker to the mockup: group background `var(--gray-100)`, 1px `--border-default`, radius 999px, 4px padding; arrows 34px circles, transparent background, `--text-secondary`, hover white + `--shadow-sm`; pill transparent, 600 weight, `--text-primary`, with the title in `--text-muted`. Remove the purple/dark legacy backgrounds under `body.pte-shell-v3` only. Then delete the separate back arrow from the left of the picker **or** add a 12px divider and an `aria-label` difference so two adjacent left arrows are not confusable — the mockup keeps back at the far left, the picker centred, so prefer moving the picker to `.pte-modebar__center` with `justify-self: center`.
- **Accept:** screenshot matches [ra-01](../2026-09-19-pte-speaking-redesign/images/target/read-aloud/ra-01-prep-coach-closed.png): one back arrow at the far left, the picker centred with two neutral arrows, no purple.

### D4 — compact level chip

- **Fix:** when moving `#difficulty-badge` into the mode bar, set a compact label: keep the full text in `title`/`aria-label`, render only the CEFR code (first token of `#diff-level-text`, e.g. "A1"). Restore the full text on unmount. Style: height 30px, radius 999px, `--green-50` background, `--green-700` text, 12.5px/600.
- **Accept:** chip reads "A1"; hovering shows "A1 (Beginner I)"; clicking still opens Smart Difficulty.

### D5 — Coach count

- **Root cause:** `read-aloud-mode.js:3884` reads `currentGuideExplanationItems.length` during `updateUIForState()`; the array is assigned later at `:5309` inside `renderPromptGuideExplanations()` (after async prompt analysis), and nothing refreshes the button.
- **Fix:** extract the count update into `syncPteCoachButton()` and call it from (a) `updateUIForState()`, (b) the end of `renderPromptGuideExplanations()`, (c) `hideConnectedSpeechPanel()` (count 0), and (d) after `processAzureResults()` so the feedback count uses `connectedSpeech.events.length`.
- **Accept:** on a prompt with N hints, the button reads `Coach · N` within 2s of load without any other interaction, and the same N appears on the "Coach tips · N" tab in Feedback.

### D6 — SGD legacy status line

- **Fix:** in `public/sgd-mode.js`, hide `#sgd-audio-status` while `v3Active` (the same treatment `notes`/`asq` already have) and surface load failures through the audio box (D8) instead.
- **Accept:** `#sgd-audio-status` is `hidden` in every SGD phase under v3; an audio failure is visible in `.pte-audio`.

### D7 — ASQ and RTS feedback

- **Fix:** implement the two-column feedback for both, following the mockups and the design plan §4.8:
  - **ASQ** ([target](../2026-09-19-pte-speaking-redesign/images/target/speaking/answer-short-question-05-feedback.png)): left = revealed question text + listen-back ("Question | Your recording"); right = single panel titled "Your answer": verdict block (green `--green-50` "Correct" + XP, red for incorrect), "You said: …", "Accepted answers: …". Reuse the values `showResult()` (`asq-mode.js:464`) already computes.
  - **RTS** ([target](../2026-09-19-pte-speaking-redesign/images/target/speaking/respond-to-situation-05-feedback.png)): left = "Your recording" player + "YOUR TRANSCRIPT"; right = tabs "AI score" (empty state + `#rts-ai-score-btn`, results from `displayAiScoreResults()` at `rts-mode.js:907`, guest → existing login prompt) and "Sample answers" (existing Full/Simplified from `buildSampleResponsesHtml()` at `:997` restyled as a segmented control).
- **Accept:** `.pte-fb` exists in both modes at feedback with two grid tracks at 1440px, one track at 390px; card height ≤ 740px at 1440×900.

### D8 — audio box failure state

- **Fix:** in `public/js/pte-audio-box.js`, add a `failed` state: on the `<audio>` `error` event, on a `play()` rejection that is not `NotAllowedError`, and on a `countdown()` that resolves while `audio.readyState === 0`, set `data-state="failed"` and the status "Audio could not load. Try again or pick another question."; expose `setFailed(message)`. Keep the existing "Click to start audio" for `NotAllowedError` (autoplay block).
- **Accept:** with the clip URL blocked, the box shows the failure text within 2s instead of sitting on "Beginning in 0 seconds"; the dock still lets the learner press Next.

### D9 — verify the Complete step online

- **Check:** with a real microphone and scoring reachable, finish a Read Aloud recording and confirm the dock shows **Record again · Play · Get feedback · Next →** (phase `complete`) and only moves to feedback after "Get feedback". If it auto-advances, gate the transition in `read-aloud-mode.js` (`handleCheckResult()` / `updateUIForState()`) on the phase, not on the assessment arriving.
- **Accept:** `complete` is reachable and stable; the offline/assessment-error path shows the feedback error state without skipping the Complete buttons.

---

## 5. Suggested order and batching

| Batch | Tasks | Why together |
|---|---|---|
| 1 | D1, D3, D4 | Pure presentation of the shell chrome; one visual review |
| 2 | D5, D2 | Both touch the Read Aloud coach path |
| 3 | D6, D8 | Audio-box behaviour and its status lines |
| 4 | D7 | New feedback layouts for two modes |
| 5 | D9 + full re-verify + deploy | Needs mic and live scoring |

---

## 6. Verification

### 6.1 Extend the cross-mode check

Add to `tests/browser/pte-speaking-shell-browser-check.js` (create if the implementation did not add it), running each mode with `?pteShell=v3`:

```js
// D1 — no legacy gradient in the dock
const primary = await page.evaluate(() => {
  const b = document.querySelector('.pte-dock .pte-btn--primary');
  const s = getComputedStyle(b);
  return { bg: s.backgroundColor, img: s.backgroundImage, cls: b.className };
});
assert.equal(primary.img, 'none');
assert.equal(primary.bg, 'rgb(37, 99, 235)');
assert.ok(!/modern-btn/.test(primary.cls));

// D2 — passage is clean while Coach is closed (Read Aloud)
const marks = await page.evaluate(() => ({
  overlay: document.querySelectorAll('#ra-linking-overlay *').length,
  coach: document.querySelector('#mode-read-aloud')?.dataset.pteCoach
}));
assert.equal(marks.coach, 'closed');
assert.equal(marks.overlay, 0);

// D5 — Coach count matches the rendered hints
const coach = await page.evaluate(() => ({
  label: [...document.querySelectorAll('.pte-dock button')].find(b => /Coach/.test(b.textContent))?.textContent,
  hints: document.querySelectorAll('#ra-connected-speech-list > *').length
}));
assert.ok(coach.label.endsWith(String(coach.hints)));

// D6 — no legacy status lines
for (const id of ['sgd-audio-status', 'asq-status-message', 'notes-audio-status', 'ra-status-message']) {
  assert.ok(await page.evaluate(i => { const el = document.getElementById(i); if (!el) return true; const r = el.getBoundingClientRect(); return r.width <= 1 || getComputedStyle(el).display === 'none'; }, id), id);
}

// D7 — two-column feedback everywhere
assert.equal((await page.evaluate(() => getComputedStyle(document.querySelector('.pte-fb')).gridTemplateColumns)).split(' ').length, 2);
```

Keep the existing assertions from the design plan §9.1 (recorder appears only after audio, "Cannot skip" during the countdown, helpers hidden while recording, card ≤ 740px in feedback, no horizontal scroll at 390px).

### 6.2 Regression runs with the flag off

`node tests/browser/speaking-controller-browser-check.js`, `speaking-shell-cross-mode-check.js`, `read-aloud-workspace-browser-check.js`, `read-aloud-record-cycle-check.js`, `verify-wfd-spc.js` (Write from Dictation must stay on the legacy shell), `practice-modes-ui-full-audit.js --viewport desktop,mobile`, and `npm run test:structure`.

### 6.3 Manual pass (Chrome, per the workspace rule)

Read Aloud and one listen-first mode: prep → recording → complete → feedback, with Coach opened and closed, at 1440×900 and 390×844. Compare side by side with the target images in §3.

---

## 7. Release handling (owner decision)

The shell is already live by default (deployed 21 Sep ~22:00 by another session, tracker row 1259). So:

1. **Decide whether to keep it on while the fixes land.** The defects are cosmetic apart from D7 (ASQ/RTS feedback) and D8 (no failure message when audio cannot load). To pause, set `RELEASE_DEFAULT = false` and deploy; learners return to the old layout, and reviewers keep `?pteShell=v3`.
2. Fix in the batches of §5 behind the flag state the owner chooses.
3. Each release: ask for authorisation, deploy hosting, push the commits to the remote (workspace rule), then re-run §6.1 **against production** and compare with the target images.
4. Because one session deploys and another may be editing, confirm the integration owner before committing (parallel-work policy).

---

## 8. Open decisions

| ID | Decision | Default here |
|---|---|---|
| O-10 | Does closing Coach also turn off what Speech Coach assesses? (D2) | Yes — marks and assessment both follow the chips; the selection is remembered |
| O-11 | Keep the extra back arrow beside the picker, or centre the picker as in the mockup? (D3) | Centre the picker, single back arrow at the far left |
| O-1 (open from the design plan) | Retell Lecture recording step and its scoring | Layout only until decided |
| O-7 (open) | Describe Image key-point ✓/✗ without the AI call | Checklist without marks |

---

## 9. Evidence index

| Image | What it shows |
|---|---|
| [live-read-aloud-prep.png](images/implemented/live-read-aloud-prep.png) | Production **before** the 22:00 deploy — stale build: old heading, old instruction, tips box, `Coach · 0`, red primary |
| [live-after-deploy.png](images/implemented/live-after-deploy.png) | Production **after** the deploy, flag on by default — heading/instruction/tips gone, `Coach · 3`, but D1–D4 still visible |
| [impl-read-aloud-prep.png](images/implemented/impl-read-aloud-prep.png) | Repo build — heading/tips gone, `Coach · 5`, but red primary (D1), marks on the passage (D2), legacy picker arrows (D3), full level chip (D4) |
| [impl-read-aloud-recording.png](images/implemented/impl-read-aloud-recording.png) | Recorder ring, elapsed, waveform, total; Coach hidden; Cancel / Finish / Next |
| [impl-read-aloud-complete.png](images/implemented/impl-read-aloud-complete.png) | Complete ring; dock showed feedback buttons in the offline run (D9) |
| [impl-speak-prep.png](images/implemented/impl-speak-prep.png), [impl-asq-prep.png](images/implemented/impl-asq-prep.png), [impl-sgd-prep.png](images/implemented/impl-sgd-prep.png), [impl-rts-prep.png](images/implemented/impl-rts-prep.png), [impl-notes-prep.png](images/implemented/impl-notes-prep.png), [impl-describe-image-prep.png](images/implemented/impl-describe-image-prep.png) | The other six modes in the repo build |
