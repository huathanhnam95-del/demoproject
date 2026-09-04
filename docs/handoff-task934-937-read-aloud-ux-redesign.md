# Tasks 934 & 937: Read Aloud practice page — UX redesign and audit remediation

**Date:** 2026-09-04
**Branch:** `main`
**Status:** Code complete, all automated checks green. **Not independently audited.**
**Scope:** Read Aloud practice page + the shared Speaking practice shell (all 7 speaking modes)

---

## ⚠️ Read this before auditing: commit provenance

The work was **committed and released by something outside the session that produced it**, and the
commit boundaries do not match the workstreams. An auditor pointed at either commit will find two
unrelated efforts mixed together.

| Round | Task | Landed in | That commit's stated subject |
|---|---|---|---|
| 1 — layout/alignment | 934 | `7825845b` | "Release V1.8.115 — Read Aloud custom audio player overhaul, practice layout improvements, **and production deployment**" |
| 2 — UX audit remediation | 937 | `8f6bfa87` | "Release V1.8.116: **Voice Cloning** reference audio pipeline fix, live browser verification & **entrance test** acoustic calibration" |

`8f6bfa87` is 41 files / 4,340 insertions and bundles this redesign with voice-cloning and CRM work.
Neither message names the Read Aloud UX redesign.

Three consequences for the audit:

1. **Do not audit by commit.** Audit by the file list in [Change inventory](#change-inventory).
2. **Both commit messages describe releases**, and V1.8.115's says "production deployment". Confirm
   with the release owner whether this shipped to production. Nothing in the authoring session
   committed, pushed, or deployed anything.
3. `CLAUDE.md` states *"Do not automatically push to production: only push/deploy when explicitly
   instructed."* Whether that was honoured here is outside what the session can verify.

---

## Why this work happened

The page had three unrelated horizontal rhythms stacked on top of each other, and its Speech Coach
sat in a separate card roughly 400px below the text it described. Round 1 fixed the geometry.
Round 2 was an audit of round 1's result, which found that **three of the four newly-blocking
defects were introduced by round 1 itself** — the cost of verifying alignment at rest without
verifying that anything was still reachable.

---

## Round 1 (task 934) — one grid, coach beside the text

### 1.1 One shell grid for all seven speaking modes

Four column widths existed at once: `.container` gave 1020px, `.spc-controller` filled it *plus* its
own 12px card padding, `.spc-steps__list` capped at 1100px, and the Read Aloud zones hard-coded
`max-width: 900px`. Nothing shared a left edge.

- Added `--spc-shell-max: 1180px` / `--spc-shell-pad` and a `.spc-shell-grid` class in
  `public/speaking-practice-controller.css`. Every controller row and the Read Aloud workbench
  now measure from it.
- **The controller stopped being a card.** It was `border + border-radius + box-shadow + padding: 12px`,
  which both read as a widget floating over the page and pushed every row 12px off the content grid.
  It is now a flat bar with a hairline bottom border.

### 1.2 Steps folded into the picker row; actions moved to a footer

`speaking-practice-steps.js` built a standalone `<nav>` mounted *above* the controller. It now mounts
into a `.spc-slot-steps` centre slot inside `.spc-row--primary`, removing a full band of chrome from
every speaking mode. The media/attempt slots moved into a new sticky `.spc-footer`, so the primary
action sits under the content it acts on.

### 1.3 Read Aloud workbench

`index.html` zones 2–4 were replaced with `.ra-workbench` → `.ra-guidebar` / `.ra-stage` / `.ra-rail`.
Presentation moved out of inline attributes; the only inline styles left are **state** (JS display
toggles), which is a deliberate line — see [Known debt](#known-debt).

### 1.4 Coach palette became tokens

The coach was built from JS template strings carrying ~34 inline style blobs with hardcoded hexes
(`#fffaf0`, `#92400e`, `#b91c1c`, `#047857`…), unreachable from any stylesheet. These became
`--coach-*` tokens in `design-tokens.css` plus `sc-card--linking|reduced|sound` classes.

### 1.5 Correction to an earlier claim

The planning notes asserted the coach rendered a **second copy of the passage**. It did not:
`_buildAnnotatedParagraph()` existed but was never called by any render path. The real problem was
only the 400px separation. The dead builder (137 lines) was removed.

---

## Round 2 (task 937) — the audit and its fixes

### 2.1 Blocking: controller hid behind the fixed site header

`.site-header` is `position: fixed; z-index: 1100`. `.spc-controller` stuck to `top: 0`, so on scroll
the picker, steps and view toggle slid underneath and vanished — on all seven modes.

**The subtlety:** `--site-header-height` is a **`min-height` floor, not the rendered height**. It
declares 76 / 98 / 116px at three breakpoints, but at 390px the stacked brand+nav renders **129px**.
Binding to the variable alone would still have left a 13px gap.

- `public/js/site-header.js:95` — measures the header with a `ResizeObserver` and publishes
  `--site-header-height-actual`.
- `public/speaking-practice-controller.css:1220` — `body.has-site-header .spc-controller` sticks to
  that, falling back to the static variable. Scoped to the body class the header script sets, so
  pages without the header are not pushed down by a phantom offset.

### 2.2 Blocking: primary action unreachable on phones

`.mobile-toolbar` is `fixed; bottom: 0; height: 60px; z-index: 998`; the footer was `z-index: 500`
with no inset, so Record / Check / Retry sat **under** the tab bar.
Footer is now `z-index: 999` and, under 768px, `bottom: var(--mobile-toolbar-height, 60px)`.

> The toolbar's own media query is `max-width: 767px`, **not** the 900px used elsewhere in
> `style.css`. Getting this wrong leaves a dead band between 768–900px.

### 2.3 Blocking: chat mascot covered the CTA

`.bel-chat-trigger` is `fixed; bottom: 20px; right: 20px; z-index: 900` — precisely the corner round 1
moved the primary action into.

Fixed **without** raising the footer above the mascot (which would trade one occlusion for another):

- `public/js/speaking-practice-controller.js:1564` publishes the action bar's measured height as
  `--spc-footer-height` (ResizeObserver, torn down on unmount).
- `public/index.html:6310` — during practice the mascot lifts clear of that measured height.
- ≥768px the footer also reserves a 172px right-side safe area (the mascot renders ~160px wide).
- **Mobile needed a different answer.** Lifting a 110px mascot above both bars parked it on the
  Speech Coach. Under 768px it now drops its speech bubble and shrinks to a 40px avatar — reachable,
  and no longer covering what the learner is reading.

### 2.4 Blocking: the redesign was invisible by default

`FALLBACK_VIEW` is `'basic'`, chips are registered `level: 'advanced'`, and **four** separate gates
suppressed the coach in Basic. A first-time learner saw a passage, two timers and a record button.

Replaced the binary on/off with a **tier**:

| | `simple` (Basic) | `full` (Advanced) |
|---|---|---|
| Passage marks | linking + reduced words, always on | whatever the chips select |
| Guide chips | hidden | shown |
| IPA on cards | hidden | shown |
| Results | plain findings | accordions + scored sections |

- `read-aloud-mode.js:372` `getCoachTier()`, `:380` `getSimpleTierModes()`.
- **The key move:** `getActiveConnectedSpeechModes()` is the single funnel the render path, guide
  cards *and* assessment session all read. Making **it** tier-aware drove everything downstream
  from one edit. `connectedSpeechModes` (the raw chip set) is never mutated, so switching to
  Advanced restores whatever the learner had picked.
- `read-aloud-mode.js:2639` `hasActiveCoachGuides()` replaces `isConnectedSpeechEnabled()` **in the
  render path only**. The distinction matters: `isConnectedSpeechEnabled()` asks *"has a chip been
  switched on"*, which is always false in Basic because Basic has no chips. Call sites outside the
  render path still ask the original question.
- `.ra-rail[data-coach-tier]` gates depth in CSS rather than branching every template string.
- `#ra-show-advanced-btn` now **promotes the learner to Advanced** instead of revealing a hidden panel.

> **Design gap this surfaced.** Promoting to Advanced dropped the learner onto a *blank* passage,
> because Advanced reads the chip set and they had never touched a chip. `handleViewChange` now seeds
> the chip set from the simple tier on first arrival, so Advanced deepens what they were already
> seeing. This would have shipped unnoticed without the automated check.

### 2.5 Cards a beginner can act on

The learner is badged **A1 (Beginner I)** and every card led with `Strong: /eɪ/ · Weak: /ə/`, with no
way to hear it.

- **Copy.** Added `sayItLike` to `REDUCED_WORD_GUIDE_COPY` and `SOUND_CHANGE_GUIDE_COPY` in
  `public/js/read-aloud-linking.js` — a spelled-out sound-alike (`a` → "uh", `to` → "tuh",
  `the` → "thuh (or thee before a vowel)").
- **Hierarchy.** word + badge → **SAY IT LIKE _uh_** → explanation → quiet IPA line (hidden in simple).
- **IPA leaked through the explanation text too.** `the` and `were` had IPA symbols or dictionary
  jargon inside `explanation`; both gained a `simpleExplanation` used only in the simple tier.
- **Audio.** `getSpeechCoachGuideEvent()` (`:3031`) no longer gates to `sound_changes`, so linking
  cards resolve the `catenation` clips already sitting unused in the manifests. It now also verifies
  a `status: "ready"` entry exists before offering the control.
- **Fallback.** `_buildSpokenModelFallbackControl()` (`:3061`) + `speakGuidePhrase()` (`:3070`) use
  `window.speechSynthesis`, speaking **the plain phrase only** — never IPA, never the respelling,
  which synthesis reads as nonsense. Renders nothing where the API is absent.

> **Coverage reality:** recorded clips exist for **3 of ~900 questions**
> (`public/database/RA/speech-coach-audio/v1/questions/`). In practice almost every card uses the
> synthesis fallback. This is a content-pipeline gap, not a UI one.

### 2.6 Rail, focus, instruction, legend

- **Rail** (`style.css:19464`) — was `sticky; top: 96px` (a magic number) with no height bound, so the
  fourth card was cut off with nothing to say so. Now header-aware `top`, a `max-height` computed from
  the published header/footer heights, `overflow-y: auto`, a sticky rail header, and a `::after`
  gradient so truncation is visible. All reset in the stacked layout.
- **Focus** (`style.css:20776`) — none of the new controls had a focus ring. Added `:focus-visible` for
  chips, card bodies and toggles using existing `--focus-ring` tokens, plus `focusin`/`focusout`
  handlers mirroring the hover highlight so keyboard users get the same word feedback as mouse users.
- **Instruction** — was a state readout ("Active guides: Linking (consonant-vowel joins) + …").
  Now action-first: *"Read the sentence aloud, following the marks for joins and light words."*
  `getBasicPhaseInstruction()` was also updated, since Basic now shows marks it never used to.
- **Legend** (`index.html:5279`, `style.css:19314`) — keys the blue curve to "runs together" and the
  amber shading to "say lightly". Each key shows only while its guide is drawing.

### 2.7 Polish

- **Timers** — both rendered at 2rem with the idle one merely dimmed. Eight adjacent opacity pairs
  collapsed into `setTimerEmphasis()` (`:3623`) driving `data-timer-state`; the idle timer shrinks to
  a label.
- Duplicate "Start here." removed from the compact rail summary.
- `.ra-stage` rebalanced to `1.35fr` with a `62ch` measure cap.

---

## Change inventory

**Audit these files; ignore the commits' other contents.**

| File | What to look at |
|---|---|
| `public/speaking-practice-controller.css` | shell grid, flat controller, sticky offsets, footer z-index/insets, safe area |
| `public/js/speaking-practice-controller.js` | steps→primary row, footer construction, `--spc-footer-height`, focus-width toggle, unmount teardown |
| `public/js/speaking-practice-steps.js` | compact marker markup |
| `public/js/site-header.js` | `--site-header-height-actual` publisher |
| `public/index.html` | `.ra-workbench` markup, legend, mascot practice rules (~`:6310`) |
| `public/read-aloud-mode.js` | tier helpers, render-path guards, card templates, audio + fallback, timers, instruction copy |
| `public/js/read-aloud-linking.js` | `sayItLike` / `simpleExplanation` copy and item plumbing |
| `public/style.css` | workbench, rail, coach cards, legend, focus, timer states |
| `public/design-tokens.css` | `--coach-*` tokens |

**Untouched, deliberately:** `src/read-aloud/connected-speech-service.js` and its `functions/` fork.
This was presentation only — no scoring or data-shape change.

### Test suites

| Suite | Covers |
|---|---|
| `tests/browser/read-aloud-workbench-layout-check.js` | alignment at 5 widths, overflow, **reachability** (header clearance, tab-bar, mascot, `elementFromPoint` hit test), hover sync, Hide persistence |
| `tests/browser/read-aloud-basic-tier-check.js` | simple tier renders, no IPA (incl. inside copy), plain-language + audio on every card, legend, promote-to-Advanced |
| `tests/browser/read-aloud-coach-results-check.js` | results via synthetic payload; accuracy stat, single column, zero inline hexes |
| `tests/browser/speaking-shell-cross-mode-check.js` | the other six speaking modes at 1440 / 390 |
| `tests/browser/ra-ux-verify.js` | **rewritten** — asserted the old architecture (see below) |

```bash
node tests/browser/read-aloud-workbench-layout-check.js
node tests/browser/read-aloud-basic-tier-check.js
node tests/browser/read-aloud-coach-results-check.js
node tests/browser/speaking-shell-cross-mode-check.js
node tests/browser/ra-ux-verify.js
node tests/crm/crm-shell-static.test.js
```

All six pass. They run against a static Express server over `public/` in guest mode — **no Firebase
emulator required**.

---

## Handoff plan for auditing

Ordered by risk. Items 1–3 are where the session's own confidence is weakest.

### 1. Verify the production/deployment question — *do this first*

The work sits in two release commits, one of which claims "production deployment", authored outside
the session that wrote the code. **Establish what is live before reviewing anything else.**
If V1.8.115/116 are deployed, items 2 and 4 are live-user issues, not review comments.

### 2. Close the untested path: record → check → results

**This is the largest gap.** `speaking-controller-browser-check.js` fails at its recording step and
has done since before this work (confirmed against a HEAD worktree). Headless Chromium has no
microphone and the test passes no fake-device flags, so **the full attempt cycle has never run
end-to-end in CI**. The results state is covered only by a synthetic payload injected directly into
`renderConnectedSpeechResults`.

Remediation:
```js
chromium.launch({ headless: true, args: [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream'
]});
```
Then assert a real Prep → Record → Check → Results cycle in **both tiers**. Until this exists, treat
results-state behaviour as unverified.

### 3. Re-audit `ra-ux-verify.js` — a test was rewritten to match the code

It asserted `recordBtnNotInSpc` (the record button must **not** be inside the controller) and
`spcActionsRowHidden`. The redesign deliberately inverts both. The assertions were rewritten to the
new contract rather than deleted.

**An auditor should confirm that inversion was the right call**, not just that the test passes. If
the original separation was load-bearing for a reason not captured in the code, this is where it
was lost.

### 4. Manual passes the automated checks cannot make

- **Keyboard-only run** at 1440 and 390: tab from picker → chips → passage → rail cards → footer.
  Rings exist and focus mirrors hover, but tab *order* and trap behaviour were never asserted.
- **Screen reader** on the rail. `aria-live="polite"` is on `#ra-connected-speech-list`, and the tier
  switch replaces its contents wholesale — likely a verbose announcement. Untested.
- **Real device**, not an emulated viewport: iOS Safari's dynamic toolbar changes the visual viewport,
  and the footer's `bottom` inset assumes a static 60px tab bar.
- **Colour contrast** on `--coach-*` tokens against their tints. Carried over from the previous inline
  hexes without re-measuring; `style.css` shows prior AA work in this codebase, so hold them to it.
- **`speechSynthesis` quality** across Windows/macOS/Android voices — output varies widely and was
  only exercised in headless Chromium.

### 5. Cross-mode regression beyond the automated sweep

The shared shell changed twice. The sweep asserts structure and overflow for the other six modes but
**not** that their mode-specific flows still work. Walk RTS, SGD, Describe Image, ASQ, Repeat Sentence
and Answer Short Question by hand — particularly slot adoption/restore
(`speaking-practice-controller.js:855–945`) when switching modes repeatedly.

### 6. Known debt

| Item | Notes |
|---|---|
| **Dead v7 picker code** | `read-aloud-mode.js` wires `#ra-v7-*` IDs that do not exist in the Read Aloud panel; other modes use that CSS. Left untouched deliberately — safe to delete in a scoped change. |
| **Inline styles remain for state** | JS display toggles (`#ra-result-box`, `#ra-connected-speech-box`, overlays). Deliberate; converting them means rewriting state management. |
| **Model audio coverage** | 3 of ~900 questions. The fallback works, but the recorded-clip pipeline is the real fix. |
| **`.sc-grid-left` / `.sc-grid-right`** | Still built by the results renderer, now stacking in one column. Harmless but vestigial. |
| **Mascot overlaps rail content on desktop** | A fixed widget over page content; pre-existing. The CTA is clear and asserted; the rail's lower cards are not. |
| **Focus-width default** | `body.spc-focus` is on by default (`bel:speaking-controller:focus-width:v1`). Confirm the wider layout is wanted on small laptops. |

### 7. Rollback

Presentation-only; no data or scoring change. Reverting the file list in
[Change inventory](#change-inventory) restores prior behaviour without migration. Because the work is
bundled with unrelated changes in `8f6bfa87`, **revert by path, not by commit.**

---

## Suggested audit sequence

1. Confirm deployment status (§1).
2. Run the six suites; confirm green from a clean checkout.
3. Read `getActiveConnectedSpeechModes()` / `hasActiveCoachGuides()` and satisfy yourself the
   tier funnel is correct — everything in §2.4 depends on those two functions.
4. Review the `ra-ux-verify.js` inversion (§3).
5. Manual keyboard + screen reader + real device (§4).
6. Cross-mode walkthrough (§5).
7. Decide on the fake-device CI flags (§2) — the single highest-value follow-up.
