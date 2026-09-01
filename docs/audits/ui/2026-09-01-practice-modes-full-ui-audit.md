# Practice Modes Full UI Audit — 2026-09-01

**Task:** 756. Prompted by two defects found by hand in one day (tasks 754 and 755), on the
reasoning that if two surfaced that way there were probably more.

**Method:** Headless Chromium (Playwright) over `public/` served statically, guest session,
mic stubbed, `speechSynthesis` and `HTMLMediaElement.play` instrumented. Cold page per surface,
desktop 1440×1000 and mobile 390×844. Every number below is read from the live DOM — computed
styles, geometry, hit-tests and click outcomes — not from reading source.

**Harness (re-runnable):**

```bash
node tests/browser/practice-modes-ui-full-audit.js
```

```bash
node tests/browser/practice-modes-ui-summarize.js
```

The summarizer takes an optional `--diff <other-report.json>` to compare two runs, which is how
the fixes below were verified.

**Artifacts:** `test-results/practice-ui-audit-2026-09-01/` (baseline, before any fix) and
`test-results/practice-ui-audit-final/` (after) — `report.json` plus a screenshot per surface
per viewport.

**Surfaces covered (28):** the 25 `.mode-panel` ids in `index.html` —
`read-aloud, rts, asq, describe-image, notes, sgd, speak` (Speaking);
`sst, lmcma, lmcsa, smw, hiw, hcs` (Listening); `rfib, dd, rmcma, rmcsa, rop` (Reading);
`essay, swt` (Writing); `pronounce, type, collo-dictate, watch, extended` — plus Vocabulary Book,
SRS review and Survival.

**Result:** 110 findings resolved — P1 46 → 8, P2 569 → 2, and every contrast failure closed.
Every remaining P1 traces to a by-design state or a harness limitation (see *Ruled out* below).
The two most serious findings were invisible to any static read of the code and had been shipping
unnoticed.

---

## What the two reported bugs had in common

Both were a symptom of something the codebase was missing rather than of the code that was
written.

- **755** — `.sst-audio` and its five clones set `width: min(470px, 100%)` with
  `padding: 22px 24px` and measured 518px, so the player clipped. The fix patched six copies
  by hand.
- **754** — the Write From Dictation Play button guarded on `audio.src`, which is always `""`
  because the source arrives as a `<source>` child.

The first has a root cause that reaches every mode; the second has a shape (a control that looks
live and does nothing, silently) that no existing test could have caught. Both are now covered by
probes in the harness.

---

## P1 — broken or unusable

### 1. Write Essay filter dropdowns rendered invisible text on an identical background

`public/write-essay-mode.css`

The filter toolbar in the Write Essay question picker was authored against a dark design system.
`--surface-1`, `--surface-2` and `--border-subtle` **are not defined anywhere in the learner
app**, so each fell through to its dark-theme fallback on a light page. The worst case:

```css
color: var(--text-primary, #f8fafc);   /* --text-primary IS defined: --gray-800 = #1e293b */
background: var(--surface-1, #1e293b); /* --surface-1 is NOT defined: falls back to #1e293b */
```

Measured on `.essay-filter-select`: `color: rgb(30,41,59)` on `background: rgb(30,41,59)`.
**Contrast 1.00:1** — the Type and Task-type filter values were literally invisible, in a
picker over 453 prompts.

The toolbar and its border were also invisible (`rgba(255,255,255,0.04)` and
`rgba(255,255,255,0.08)` on white).

**Fixed:** all four dark-theme fallbacks replaced with tokens this app actually defines
(`--gray-50`, `--bg-card`, `--border-light`, `--text-primary`, `--text-secondary`).

> Note: the contrast probe originally missed this, because a `<select>` paints its own value
> text rather than owning a child text node. The probe now checks text-bearing form controls
> explicitly — that check is what makes this defect class detectable in future.

### 2. Vocabulary Book panel header sat under the site header and could not be clicked

`public/style.css`

`.vocab-panel-side` is declared twice: `z-index: 3000` where it is defined, then `z-index: 1001`
further down under the comment "Ensure panel is above overlay". The later declaration wins.
`.site-header` is `position: fixed` at `z-index: 1100`, spanning the top 76px.

The panel is `top: 0; height: 100vh`, so its own header row — the **"+" add-word** button and the
**"×" close** button — lives inside that same 76px band, behind the site header.
`elementFromPoint` at the centre of each resolved to `.site-header__brand-subtitle`, and
Playwright could not click either one.

The override predates the site header and was written to beat a `z-index: 1000` overlay; 3000
satisfies that intent too.

**Fixed:** override restored to 3000. `.vocab-add-modal` moved 1002 → 3001 to follow it — at
1002 that modal had been sitting below the site header as well, so its top edge was covered on
every open.

---

## P2 — visibly wrong

### 3. No `box-sizing: border-box` reset in the learner app  *(root cause of 755)*

`public/design-tokens.css`

`crm-admin.css:6` has shipped a universal border-box reset since it was written. The learner
bundle — `design-tokens.css`, `style.css` and 17 mode stylesheets — had none. That is the whole
reason this bug class only ever appeared on the learner side.

57 rules across the learner CSS combine a `width: 100%` / `min()` / `calc()` with padding or a
border and no `box-sizing`, each overflowing its container by exactly its padding plus border.
Measured overflow that was still live after the six hand-patches from task 755:

| Surface | Element | Overflow |
|---|---|---|
| collo-dictate / mobile | `.control-toolbar > .function-group` | **+67px** |
| asq / mobile | mode panel inner wrapper | **+40px** |
| pronounce / mobile | `.pa-container` | **+24px** |
| rfib / desktop | `span.rfib-text` | +3 to +4px |
| describe-image / both | `#di-preview-img` | +2px |

**Fixed:** added the same reset `crm-admin.css` already had, to `design-tokens.css` — loaded
first by both `index.html` and `crm-admin.html`, so one rule covers both surfaces. The six
hand-patched `box-sizing` declarations were removed as now-redundant, which also proves the reset
is doing the work.

**Verified:** a geometry baseline was captured across all 28 surfaces *before* the reset landed
and diffed after. All of the above resolved; no layout that had been compensating broke. (The one
compensation pattern a global reset can break — `width: calc(100% - Npx)` paired with matching
padding — occurs once in the learner app, at `style.css:8194`, and that rule already declared
border-box.)

### 4. Collocation Dictation toolbar could only ever overflow on mobile

`public/style-scaffolding.css`

`.control-toolbar` is `display: flex` with `justify-content: space-between` and no `flex-wrap`.
At 390px the `.function-group` alone measured 368px against a 301px track, so its right-hand
buttons sat off-screen with no way to scroll to them. This one survived the border-box fix
because the group carries no padding — the content simply does not fit on one line.

**Fixed:** `flex-wrap: wrap` on the toolbar and both groups. Desktop has room for one line, so
nothing moves there.

### 5. Speaking step indicator failed AA on all seven Speaking modes

`public/speaking-practice-controller.css`

`.spc-step` and `.spc-step__marker` were hard-coded `#94a3b8` (gray-400) on white — **2.56:1**,
on every one of `read-aloud, rts, asq, describe-image, notes, sgd, speak`. An upcoming step is
meant to read quieter than the current one, but its label is informative text, not a disabled
control.

**Fixed:** both now use `--text-muted`, the token the previous remediation pass darkened to
`#5d6b7f` for exactly this case. The current/complete states keep their own stronger colours, so
the hierarchy is unchanged.

### 6. Six more contrast failures on informative text

| Surface | Element | Was | Ratio | Now |
|---|---|---|---|---|
| pronounce | `.pa-btn-record:disabled` | white on `#fca5a5` | **1.90:1** | dark red label |
| pronounce | `.pa-btn-stop:disabled` | white on `#9ca3af` | 2.54:1 | dark slate label |
| extended | `.question-total` | `#9ca3af` on white | 2.54:1 | `--text-muted` |
| extended | `.calibration-indicator` | `#d97706` on `#fef3c7` | 2.86:1 | `--gold-800` |
| srs-review | `.srs-stats span`, `.srs-progress`, close + settings buttons | `#9CA3AF` on white | 2.54:1 | `--text-muted` |
| srs-review | `.srs-phonetic` | `#6B7280` on blue-50 | 4.44:1 | `--text-secondary` |
| pronounce | `.pa-sub-tab` / `.active` | `#64748b` / `#3b82f6` | 4.34 / 3.68:1 | `--text-muted` / `--blue-600` |
| type, collo-dictate | `.tool-btn` | `#64748b` on slate-100 | 4.34:1 | `--text-muted` |

Record being disabled on arrival matters here: an unreadable "Record" is the *first* state a
learner sees in the Pronunciation panel.

---

## P3 — recorded, not fixed in this pass

- **103 mobile touch targets under 44×44**, concentrated in the listening modes: the 36×36
  prev/next icon buttons, the 28px-high speed buttons (`0.8x / 1.0x / 1.2x`), and the volume
  sliders at **16px** high. The sliders are the worst of it and are worth a pass of their own.
- **Five duplicated audio players.** `hcs`, `hiw`, `lmcma`, `lmcsa` and `smw` each hard-code
  `background: #235e92` while `sst` uses `var(--sst-accent)`. Same component, six copies, one of
  them tokenised. This is the structure that let 755 need six separate fixes.
- **`swt-mode.css` and `write-essay-mode.css` contain no media queries at all**, where every
  other mode sheet has one to three.
- **Dead code** found while triaging, deliberately left alone so a UI regression stays easy to
  bisect: the `ra-v7-*` picker handlers and ~300 lines of picker methods in `read-aloud-mode.js`
  (the DOM was intentionally removed — `read-aloud-question-picker-v7-dom-contract-browser-check.js:195`
  asserts its absence); `swt-history-*` in `swt-mode.js:423-426,900`; `essay-history-*` in
  `write-essay-mode.js:147,700-701`; and 21 dead `getElementById` targets in `script.js`.
- **Survival HUD track label clips 146px** — `#survival-track-label` renders 326px of content in
  a 180px box with `overflow-x: hidden`, so most of the track name is cut. Only visible now
  because the Survival overlay reached the probe for the first time in the final run.
- **`.rfib-audio-card` spills 4px** on desktop with `overflow-x: visible` — a transparent card in
  a flex row, cosmetically invisible.

---

## Ruled out — signals that did not survive checking

Recorded so a later pass does not chase them again.

| Candidate | Verdict |
|---|---|
| Duplicate `preloader-dismiss-btn` id | Two mutually-exclusive `innerHTML` branches; never co-resident |
| Read Aloud's missing `ra-v7-*` picker DOM | Removed on purpose; a contract test asserts it stays removed |
| Missing `swt-history-*` / `essay-history-*` containers | Only ever touched by `if (el)` show/hide guards |
| 8 of 9 "inert Play" hits (`rts`, `describe-image`, `notes`, `sgd`, `essay`, `swt`, `type`, `survival`) | Start-a-task buttons and toggles that mutate the DOM immediately; audio follows a countdown |
| RFIB play/voice/slider "covered" | The deliberate `.rfib-audio-card.is-locked` overlay |
| SRS flashcard back button "covered" | The card is a flip card; the back face is behind the front |
| Watch video card blurb "clipped" | Deliberate `-webkit-line-clamp: 2` |
| Read Aloud `#ra-prompt-plain` "1530px hidden" | The visually-hidden accessible mirror of the prompt |
| DD blank slots / word chips "no listener" | Correct event delegation on their containers |
| Volume sliders "white on white 1:1" | `input[type=range]` paints no value text — a false positive from the probe's own form-control check, since corrected |

Three of these were fixed in the probe rather than in the app, so the harness no longer reports
them.

### Not reproducible through the product's own entry point

`#srs-audio-btn` ("🔊 Listen") registered as inert: no audio, no speech, no DOM mutation. The
harness forces the SRS panel open by setting `display` directly, which bypasses the app's own
guard, so the panel renders a card with no word behind it and `playCurrentWordAudio()` correctly
returns early on `!currentWord`. **Not confirmed as a product defect** — it needs a session with
words actually due to settle either way.

---

## Verification

| Check | Result |
|---|---|
| `practice-modes-ui-full-audit.js` baseline → final diff | **110 resolved** (P1 46→8, P2 569→2, contrast 64→0); no regressions attributable to the changes |
| Final run repeated | An earlier final run overlapped a `git stash push -- public/` used to prove the HCS failure was pre-existing, so `notes/mobile` was measured against pristine HEAD and reported a stepper contrast failure that no longer existed. Re-run with nothing stashed: that finding is gone, and the numbers above are from the clean run. **Do not stash while a run is in flight** — the harness reads the live filesystem. |
| `practice-modes-browser-check.js` | Pass |
| `vocab-book-ui-browser-check.js` | Pass — all checks |
| `hcs-` / `lmcsa-` / `smw-mode-browser-check.js` | **Fail — pre-existing.** Assert on `#<mode>-explanation-panel`, an id that exists nowhere in the repo (the real one is `#hcs-explanation-content`). Confirmed by stashing this session's changes and reproducing the identical failure at pristine HEAD. |
| `writing-modes-ui-parity-check.js` | **Fail — pre-existing.** Asserts the SWT split layout is two-column at 1440px; `swt-mode.css:30` deliberately sets `grid-template-columns: 1fr` with a comment explaining the stacked layout is intended. Neither file was modified in this session. |

The four stale-test failures are real bugs in the tests, not in the UI, and are worth their own
task — each currently gives false confidence on a mode this audit did touch.
