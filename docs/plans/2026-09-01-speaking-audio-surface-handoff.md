# Speaking Audio Surface & SST Test Repair — Handoff

**Date:** 2026-09-01
**Branch:** `main`
**Status:** Task 766 shipped and verified. Read Aloud measure decided by the owner. Two threads
remain, both specified below and neither started.
**Task Tracker:** #766 (Done), #770 (this plan). Next executor should open a new task number.

---

## The one thing not to undo

**The Read Aloud passage now fills its column, and that is an owner decision, not an oversight.**

`public/speaking-practice-controller.css` has been narrowed three times today by three different
hands — `50ch`, then `52ch` with the box centred, and each time on the same reasoning: a long
measure causes line-tracking errors, and reading aloud under a timer is scored on the resulting
stumble. That effect is real and the reasoning is not wrong. The owner reviewed both the narrow
and the full-width renderings on 2026-09-01 and chose the full column anyway: a passage that
stops short of its container reads as a broken layout, and a centred 65-character column still
reads as short.

The rule now sets `max-width: none` on `#ra-text-prompt` / `.ra-text` and carries that history in
a comment. The measure is still bounded — `.ra-zone-passage` caps the column at 900px (860px
inside its padding), which is what actually limits the line. **If you think the measure should be
narrower, raise it with the owner; do not re-narrow it in passing.** If the 900px zone cap is ever
removed, reintroduce a cap on this rule rather than letting the line run.

---

## Concurrency warning — read before touching anything

This working tree is being edited by **several live agent sessions at once**. At the time of
writing there were 40 modified files, most of them not from this thread: CRM book ingest,
`site-header.css`, `srs-review.js`, `take-notes-mode.js`, `sgd-mode.js`, `style.css`,
`design-tokens.css`, and `speaking-practice-controller.js`.

This is not hypothetical. During task 766 a peer session rewrote the Read Aloud measure rule
mid-task, silently reverting an edit that had already been verified in the browser.

Practical rules for the executor:

1. **Re-read a file immediately before editing it**, and again after, to confirm your change survived.
2. **Stage narrowly.** `git add` only the files you touched — never `git add -A` — or you will
   sweep another session's half-finished work into your commit.
3. **`take-notes-mode.js` and `sgd-mode.js` are the exact files Thread A needs**, and both carry
   uncommitted peer changes from task 769 (Retell Lecture remediation, now marked Done but not
   committed). Check `git status` and coordinate before starting Thread A.

---

## State at handoff

Shipped under task 766, all verified in a real browser at `https://localhost:8443`:

| Change | Files |
|---|---|
| SST Previous/Next restored as chevron icon buttons with their own round surface | `public/index.html:3500`, `public/sst-mode.css:29` |
| Shared audio-player wiring module (play/pause, progress, seek, timestamp, volume) | `public/js/practice-audio-player.js` *(new, untracked)* |
| ASQ prompt audio uses the shared player, seek enabled | `public/index.html`, `public/asq-mode.js` |
| Repeat Sentence uses the shared player, seek disabled, replay badge beneath the box | `public/index.html`, `public/script.js` |
| Play/replay no longer hoisted into the SPC toolbar for ASQ and Repeat Sentence | `public/js/speaking-practice-adapters.js` |
| Companion `.practice-audio-meta` row for status that sits under the box | `public/css/practice-audio-player.css` |
| Read Aloud passage fills its column | `public/speaking-practice-controller.css:993` |

Test status at handoff:

- `tests/browser/asq-mode-browser-check.js` — PASS (updated to read `#asq-play-label`)
- `tests/browser/speaking-controller-browser-check.js` — PASS, 186/186 (5 assertions rewritten to
  the new contract: Play and the replay badge live in the audio box, not the toolbar)
- `tests/browser/practice-modes-browser-check.js` — PASS
- `tests/sst-shell-wiring.test.js`, `tests/sst-form-scoring.test.js` — PASS
- `tests/browser/sst-mode-browser-check.js` — **FAIL, pre-existing at HEAD.** This is Thread B.

---

## Thread A — Retell Lecture and SGD onto the shared audio player

**Goal:** all five Speaking surfaces that play a clip present the same audio box. ASQ and Repeat
Sentence already do. Retell Lecture and SGD still render a raw browser `<audio controls>` widget,
which looks like a different application depending on the browser.

### The finding that changes the approach

**Do not move the toolbar Play button in these two modes.** In ASQ and Repeat Sentence the toolbar
Play *was* the audio transport, so it moved into the box. Here it is not:

- `play-notes-btn` → `startPractice` ([take-notes-mode.js:229](../../public/take-notes-mode.js))
- `play-sgd-btn` → `startPractice` ([sgd-mode.js:275](../../public/sgd-mode.js))

Both are **"begin the exercise"** buttons that reveal the step card. The actual transport is the
native `<audio controls>` element inside that card. So this conversion replaces the *native player*
and leaves the adapter `controls` lists in `speaking-practice-adapters.js:199` and `:239` alone.

### Targets

| Mode | Audio element | Wrapper | Status element |
|---|---|---|---|
| Retell Lecture | `#notes-audio` ([index.html:4262](../../public/index.html)) | `.notes-audio-player` | `#notes-audio-status` |
| SGD | `#sgd-audio` ([index.html:4390](../../public/index.html)) | `.notes-audio-player` (reused) | `#sgd-audio-status` (outside the wrapper) |

### Steps

1. **Markup.** Replace each `<audio controls>` with the shared component block, keeping the `<audio>`
   element itself (now without `controls`, so the JS that sets `.src` / `.load()` keeps working
   untouched). Copy the structure from `#mode-asq` in `index.html` — button, progress wrap, fill,
   seek, timestamp, volume label, volume — renaming the id prefix to `notes` / `sgd`.

2. **Class naming is load-bearing.** `css/practice-audio-player.css` selects children with
   attribute-ends-with selectors (`[class$="-play-btn"]`). Every child class must *end* with the
   documented suffix, and **nothing may append a second class to those elements at runtime** — that
   breaks `$=` matching. Use a parent-state class or a data attribute instead. The file says this at
   the top; it is easy to trip over.

3. **Wiring.** One call each, at the point where the mode caches its DOM refs:

   ```js
   this.audioPlayer = window.PracticeAudioPlayer?.attach({
     prefix: 'notes',           // or 'sgd'
     audioId: 'notes-audio'     // or 'sgd-audio'
   }) || null;
   ```

   Unlike ASQ, these want the default `bindPlayButton: true` — the component owns its own new play
   button, because the toolbar button means something else. Call `player.reset()` where the mode
   swaps clips (`sgd-mode.js:907-968` reassigns `el.audio.src` in several branches; Retell Lecture
   does the same around `take-notes-mode.js:839`) and `player.setEnabled(false)` where the clip
   fails to load.

4. **Decide seek policy per mode.** SST disables seeking until submission because the lecture plays
   once; Repeat Sentence disables it because seeking would bypass the replay cap. Check whether
   Retell Lecture and SGD are meant to be single-play before enabling seek — if the exam allows free
   replay, `allowSeek` can stay at its default `true`.

5. **Retire the old styles.** `style.css:10356` (`.notes-audio-player`) exists to size the native
   widget. Once both modes use the component, that rule is either dead or fighting the component —
   check both before deleting.

6. **Tests.** `speaking-controller-browser-check.js` asserts `notesPlayAdopted` and `sgdPlayAdopted`
   — those stay true, since the toolbar buttons do not move. Add assertions in the shape of the ones
   written for task 766 (`asqPlayInAudioPlayer`, `speakPlayInAudioPlayer`, around lines 936 and 1023)
   confirming each mode's `.practice-audio-player` exists and holds a transport button.

### Verification

Real browser at `https://localhost:8443/pte-practice/speaking/notes` and `.../sgd`: start the
exercise, play the clip, confirm the timestamp advances, the fill tracks position, the label and
icon flip to Pause, and volume responds. Then mobile at 375px — the component reflows the timestamp
onto its own row, and that reflow should be checked, not assumed.

**Estimate:** roughly half a day for both, most of it in the per-mode `src` reassignment paths.

---

## Thread B — repair `tests/browser/sst-mode-browser-check.js`

Two distinct defects. Fix them in order; the second may not survive the first.

### B1 — the auth mock is missing an export (one line)

The test's `firebase-auth.js` mock does not export `signInWithCustomToken`, but
`public/firebase-auth-module.js:15` imports it — **at HEAD, so this fails on unmodified code**. The
page logs:

```
The requested module '.../firebase-auth.js' does not provide an export named 'signInWithCustomToken'
```

which alone trips the final `assert.deepStrictEqual(pageErrors, [], ...)` at the end of the run.

There is a known-good reference in the same repo: `tests/browser/practice-modes-browser-check.js:30`
already exports it. Copy that line into `setupFirebaseMocks` in the SST check.

While there, diff the two mocks fully — if one export drifted, others may have too.

### B2 — the renderer crashes switching to Type mode

At `tests/browser/sst-mode-browser-check.js:299`, `page.evaluate(() => window.switchToMode('type'))`
returns `Target page, context or browser has been closed`; a `page.on('crash')` probe confirms the
renderer, not the test, is dying.

What is already ruled out:

- **Not caused by task 766.** Re-run with the Repeat Sentence player disabled via an init script:
  identical crash.
- **Not reproducible in a real browser.** SST → Type switches cleanly in the Browser pane with all
  of task 766's changes live.
- **Not inherent to Type mode under Playwright.** `practice-modes-browser-check.js` switches to Type
  and passes — and note it is the same test that already has the B1 mock line.

That last point is the lead worth pulling first: **fix B1, re-run, and see whether B2 survives.** A
failed module import leaves `firebase-auth-module.js` partially initialised, and the crash may be a
downstream consequence rather than an independent bug.

If it does survive, the next steps are to diff the two tests' `chromium.launch` and `newContext`
options (SST launches bare at line 94; practice-modes sets a 1440×1200 viewport at line 224), then
run headed with `--enable-logging` to capture the renderer's own crash reason.

**Estimate:** B1 is minutes. B2 is an hour if B1 fixes it, unbounded if not — timebox it and report
rather than chasing it silently.

---

## Verification commands

```bash
node tests/browser/speaking-controller-browser-check.js && node tests/browser/asq-mode-browser-check.js && node tests/browser/practice-modes-browser-check.js && node tests/browser/sst-mode-browser-check.js
```

`npx eslint` is clean on all files touched by task 766. There is one pre-existing `no-empty` error
at `public/script.js:1127` (`PracticeRouter.revertState`) that predates this work — do not let it
read as a regression.

---

## Commit guidance

Task 766's slice was kept deliberately narrow. Stage the same way:

```bash
git add public/js/practice-audio-player.js public/index.html public/script.js public/asq-mode.js public/js/speaking-practice-adapters.js public/sst-mode.css public/css/practice-audio-player.css public/speaking-practice-controller.css tests/browser/asq-mode-browser-check.js tests/browser/speaking-controller-browser-check.js TASK_TRACKER.csv
```

`public/js/practice-audio-player.js` is **new and untracked** — it is the one file whose omission
would break every other change in the set. Confirm it is staged before committing.

Do not deploy. Production pushes happen only on an explicit instruction from the owner.
