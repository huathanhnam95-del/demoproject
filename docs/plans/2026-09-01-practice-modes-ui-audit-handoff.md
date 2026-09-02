# Practice Modes UI Audit — Handoff

**Date:** 2026-09-01
**Branch:** `main`
**Status:** Audit complete, fixes committed, harness committed. Backlog and open threads below.
**Task Tracker:** #756 (Done). Related: #753 (remediation), #754 (WFD Play), #755 (audio clipping)

**Commits**

| SHA | Contents |
|---|---|
| `b9bfb911` | Task 756 — audit fixes, harness, findings doc, this handoff |
| `bb575524` | Tasks 753/754 — pre-existing remediation, separated so the two bisect apart |

**Not pushed, and the branch is one commit behind `origin/main`** (`97603fab feat: add V4 A2
syllabification provenance`). The fast-forward was deliberately not taken: that upstream commit
modifies `public/crm-admin.html` and `public/crm-admin.css`, which is the same area as the
unresolved conflict described in *Open threads → 6*. Rebasing before that conflict is resolved
would tangle the two. `bb575524` touches `crm-admin.css`, so expect a conflict there on rebase —
resolve it together with the HTML.

---

## Summary

Two UI defects were reported by hand in one day — a Write From Dictation Play button that did
nothing (#754) and a listening-mode audio player clipped on its right edge (#755). The premise of
this task was that if two surfaced that way, more were shipping unnoticed. That was correct.

A re-runnable Playwright harness now measures all 28 learner practice surfaces at two viewports.
It found the root cause behind #755 and two defects more serious than either reported bug.

Full findings with measurements: `docs/audits/ui/2026-09-01-practice-modes-full-ui-audit.md`.

---

## The one thing not to undo

**`public/design-tokens.css` now carries a global `box-sizing: border-box` reset, and six mode
stylesheets depend on it.**

The learner app never had a border-box reset; `crm-admin.css:6` has had one since it was written,
which is exactly why this bug class only ever appeared on the learner side. 57 rules across the
learner CSS combine a width with padding or a border, each overflowing its container by exactly
that padding plus border.

Task #755 had patched `box-sizing` into `.hcs-audio`, `.hiw-audio`, `.lmcma-audio`,
`.lmcsa-audio`, `.smw-audio`, `.sst-audio` and `.wfd-audio` by hand. Those seven declarations were
removed once the reset landed, so **`hcs/hiw/lmcma/lmcsa/smw/sst-mode.css` are now byte-identical
to their pre-#755 state.**

**Consequence:** deleting the reset block silently reintroduces #755 across all six listening
modes, plus the +67px Collocation Dictation toolbar, the +40px ASQ panel and the +24px
Pronunciation panel. The block is load-bearing, not cosmetic. Its comment says so.

---

## What was fixed

| # | Surface | Defect | Measured | File |
|---|---|---|---|---|
| 1 | Write Essay | Filter dropdown values invisible — same colour as their background | **1.00:1** | `write-essay-mode.css` |
| 2 | Vocabulary Book | Panel "+" and "×" buttons behind the site header, unclickable | z-index 1001 vs 1100 | `style.css` |
| 3 | All modes | No border-box reset (root cause of #755) | up to **+67px** overflow | `design-tokens.css` |
| 4 | Collocation Dictation | Toolbar could only overflow on mobile — no `flex-wrap` | 368px in a 301px track | `style-scaffolding.css` |
| 5 | All 7 Speaking modes | Step indicator failed AA | **2.56:1** | `speaking-practice-controller.css` |
| 6 | Pronounce, Extended, SRS | Nine more contrast failures on informative text | 1.90–4.44:1 | 4 files |

### Finding 1 in detail — it was a dark-theme block on a light page

`.essay-filter-*` was authored against a design system this app does not have. `--surface-1`,
`--surface-2` and `--border-subtle` are defined **nowhere** in the learner bundle, so each fell
through to its dark fallback:

```css
color:      var(--text-primary, #f8fafc);  /* --text-primary IS defined: --gray-800 = #1e293b */
background: var(--surface-1,   #1e293b);   /* --surface-1 is NOT: falls back to #1e293b */
```

Both sides resolved to `#1e293b`. The Type and Task-type filters over 453 prompts rendered
invisible text. The toolbar and its border were invisible too.

If any other component starts using `--surface-*` or `--border-subtle`, it will break the same
way. Either define those tokens or keep them out of the learner CSS.

### Finding 2 in detail — a duplicate declaration, not a design choice

`.vocab-panel-side` is declared twice in `style.css`: `z-index: 3000` where it is defined, then
`z-index: 1001` further down under "Ensure panel is above overlay". The later one wins.
`.site-header` is `position: fixed` at `z-index: 1100`.

The panel is `top: 0; height: 100vh`, so its own header row sits inside the header's 76px band —
behind it. `elementFromPoint` at the centre of both buttons resolved to
`.site-header__brand-subtitle`. The override predates the site header and was written to beat a
z-index 1000 overlay; 3000 satisfies that intent too. `.vocab-add-modal` was raised 1002 → 3001 to
follow, since at 1002 it had been sitting under the header as well.

---

## Open threads, in priority order

### 1. Four stale browser tests give false confidence

All four fail against **unmodified** code — confirmed by stashing every working change and
reproducing identical failures at pristine HEAD. They currently pass judgement on modes this audit
touched, so they are worse than no test.

- `hcs-mode-browser-check.js:287`, `lmcsa-mode-browser-check.js:257`,
  `smw-mode-browser-check.js:255` — all call
  `getComputedStyle(document.getElementById('<mode>-explanation-panel'))`, which throws because
  that id exists nowhere in the repo. The real id is `#hcs-explanation-content`.
- `writing-modes-ui-parity-check.js:402` — asserts the SWT split layout is two-column at 1440px,
  but `swt-mode.css:30` deliberately sets `grid-template-columns: 1fr` with a comment explaining
  the stacked layout is intended ("source text on top, compose box below — not side-by-side").
  The test contradicts a committed design decision.
- `sst-mode-browser-check.js:188` also fails ("Target page, context or browser has been closed").
  Root cause not diagnosed.

### 2. `#srs-audio-btn` — unconfirmed, not cleared

The SRS "🔊 Listen" button registered as inert: no audio, no speech, no DOM mutation. But the
harness forces that panel open by setting `display` directly, which bypasses the app's own guard,
so the card had no word behind it and `playCurrentWordAudio()` correctly returned early on
`!currentWord`.

Settle it by teaching the harness to open SRS through the product's own entry point, with words
actually due.

### 3. P3 backlog — 184 findings, none fixed

- **103 mobile touch targets under 44×44.** Worst are the volume sliders at **16px high**, then
  the 28px speed buttons (`0.8x / 1.0x / 1.2x`) and the 36×36 prev/next icon buttons across the
  listening modes.
- **17 `content-spills` / 9 `content-clipped`**, including `#survival-track-label` hiding **146px**
  of track name inside a 180px box.
- **31 `under-floating-chrome`** — controls sitting under the mobile toolbar or guest toast.
  Non-deterministic between runs; triage before acting on any of them.
- **24 `no-listener`** — all verified as correct event delegation. Kept as a tripwire, not a
  backlog.

### 4. Five duplicated audio players

`hcs`, `hiw`, `lmcma`, `lmcsa` and `smw` each hard-code `background: #235e92`; `sst` uses
`var(--sst-accent)`. Same component, six copies, one tokenised. This duplication is the reason
#755 needed six separate fixes instead of one.

### 5. Dead code — deliberately left in place

Removing it is a separate change with its own risk; mixing it in would make a UI-regression bisect
harder.

- `ra-v7-*` handlers and ~300 lines of picker methods in `read-aloud-mode.js`. The DOM was removed
  on purpose — `read-aloud-question-picker-v7-dom-contract-browser-check.js:195` asserts it stays
  removed.
- `swt-history-*` in `swt-mode.js:423-426,900`; `essay-history-*` in
  `write-essay-mode.js:147,700-701`. Both only ever touched by `if (el)` show/hide guards.
- 21 dead `getElementById` targets in `script.js`.

### 6. Two unrelated blockers found in passing

- **`public/crm-admin.html` has live merge-conflict markers at lines 524–562**, in the
  Segmentation Study panel. Upstream has the automatic-judgment checkbox row plus Loop A-B
  controls; the stashed side has a V2/V3/V4/Manual/Compare tab strip. Both are real features, so
  this needs a product decision, not a merge. Deliberately left untouched and uncommitted.
- **`TASK_TRACKER.csv` has two rows numbered 754** — the WFD Play fix and the BLOCKED crm-admin
  conflict. Renumber the blocked one when it is next touched.

---

## The harness

```bash
node tests/browser/practice-modes-ui-full-audit.js
node tests/browser/practice-modes-ui-summarize.js
```

`--diff <other-report.json>` on the summarizer compares two runs; that is how every fix here was
verified.

**Files:** `practice-modes-ui-full-audit.js` is the entry point and requires `-runner.js` and
`-probe.js`. `-summarize.js` does triage and diffing.

**Flags:** `--modes a,b` · `--viewport desktop|mobile` · `--out <dir>` · `--headed` · `--no-shots`.

**How it runs:** serves `public/` over ephemeral express — no `server.js`, no Firebase, no
emulators. Question data is static under `public/database/`, so real content loads. `/api/*` 404s
and Dialogflow/Firebase console noise are expected and filtered by the summarizer.

**Probes:** overflow/clipping, page-level horizontal scroll, inert controls (listener census),
media probe (clicks each Play-ish control and checks whether anything actually started), hit
testing, zero-size and touch-target geometry, contrast, and a cross-mode style inventory. The
first two were written specifically to reproduce #755 and #754.

### Three probe corrections worth knowing

Each initially produced confident false findings. If the harness ever reports something
surprising, suspect the probe before the app:

1. **Alpha compositing.** `effectiveBg` hard-coded `a: 1`, so the first translucent layer was
   treated as opaque and the walk stopped there — it reported the Write Essay labels as
   slate-on-blue at 1.79:1 when they are slate on white. Now proper Porter-Duff source-over.
2. **Form-control text.** A `<select>` paints its own value text rather than owning a child text
   node, so the text-node walk never saw it — which is how a 1.00:1 control went unreported. The
   check now covers text-bearing controls only; including `input[type=range]` reported every
   volume slider as white-on-white.
3. **Deliberate clipping.** `-webkit-line-clamp` (Watch video blurbs) and visually-hidden 1×1
   mirrors (`#ra-prompt-plain`, read-aloud's accessible prompt copy) are now skipped.

### Never stash while a run is in flight

The harness reads the live filesystem. During this task a `git stash push -- public/` used to
verify a pre-existing test failure overlapped a background audit run, and one surface got measured
against pristine HEAD. It produced a plausible-looking contrast finding that was not real.

### Artifacts

`test-results/` is gitignored. Keep `practice-ui-audit-2026-09-01` (the pre-fix baseline — every
`--diff` compares against it) and `practice-ui-audit-final`. The intermediate `practice-ui-smoke`,
`practice-ui-recheck` and `practice-ui-audit-after` directories can be deleted.

---

## Verification performed

| Check | Result |
|---|---|
| Baseline → final `--diff` | **110 resolved** (P1 46→8, P2 569→2, contrast 64→0); no regressions attributable to the changes |
| `practice-modes-browser-check.js` | Pass |
| `vocab-book-ui-browser-check.js` | Pass — all checks |
| `hcs-` / `lmcsa-` / `smw-mode-browser-check.js` | Fail — pre-existing, reproduced at pristine HEAD |
| `writing-modes-ui-parity-check.js` | Fail — pre-existing, contradicts committed CSS |

Not deployed. Project rules require an explicit instruction, and these changes have not been seen
in production.
