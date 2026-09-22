# PTE Speaking shell — mode-entry transition and layout polish (fix plan)

| | |
|---|---|
| **Date** | Tuesday, 22 September 2026 |
| **Status** | Audit complete, fixes not started |
| **Audited** | Repo `d3658c42f` (local static server, `?pteShell=v3`) and production `https://betterenglishlearning.com` (v3 on by default since 21 Sep ~22:00) |
| **Design source of truth** | [../2026-09-19-pte-speaking-redesign/handoff-plan.md](../2026-09-19-pte-speaking-redesign/handoff-plan.md) + its target images |
| **Previous fix plan (still open)** | [../2026-09-21-pte-speaking-shell-v3-fixes/handoff-plan.md](../2026-09-21-pte-speaking-shell-v3-fixes/handoff-plan.md) — D1–D9. This plan adds P1–P11 and **replaces D1 with a systemic fix**. |
| **Tracker** | Task 1261 (this audit). Add a row per batch. |

**Summary of the two reported problems**

| Reported | What is actually happening | Measured |
|---|---|---|
| "It loads the wrong layout first, then the mode's UI" | No wrong layout is rendered. The app **keeps the dashboard on screen** until the mode's script and data have finished loading, then swaps in one step. There is no skeleton or progress for the mode itself, only a small "Opening Read Aloud…" toast. | Dashboard stays **1,581 ms** on production, 794 ms locally, before the card appears |
| "Clipping, text running outside the box, not refined" | The shared shell styles are **overridden by each mode's older, more specific CSS**, so padding, dividers and button colours are lost per mode. Read Aloud's card body ends up with **no left/right padding**, the feedback right column has **`padding-right: 0`**, stat tiles have no dividers or bars, and the tab strip stretches the full column. | See §3 table with measured values |

Both problems share one root cause pattern: **the shell tags the mode's existing element instead of owning its own wrapper**, so ID-level legacy selectors win. Fixing that once removes most of the visual defects, including D1 from the previous plan.

---

## 1. Evidence and how to reproduce

Scripts used (keep them in your scratch dir, they are not repo files):

| Script | What it does |
|---|---|
| `flash-probe.js` | Clicks into Read Aloud on a local server and samples the DOM every animation frame; prints when the dashboard hides and when `.pte-card` appears; writes a filmstrip |
| `live-timing.js` | Same measurement against production |
| `clip-audit.js` | For 7 modes × widths 1440/1280/1024/768/390: elements whose content is clipped (`overflow:hidden` and `scrollWidth > clientWidth`), elements spilling past their parent, page horizontal scroll |
| `measure.js` | Computed padding, grid, borders and button colours for the card, progress, feedback columns, stats, tabs and dock |

Images in [`images/`](images/): [flash-0000ms](images/flash-0000ms.png) · [flash-0493ms](images/flash-0493ms.png) · [flash-0837ms](images/flash-0837ms.png) · [flash-0922ms](images/flash-0922ms.png) · [flash-1147ms](images/flash-1147ms.png) (dashboard → card), [impl-feedback-1440](images/impl-feedback-1440.png), [impl-feedback-1024](images/impl-feedback-1024.png).

---

## 2. Problem A — the dashboard stays while the mode loads

### A.0 What the code does today

`public/script.js`:

- `window.switchToMode(mode)` (line ~2481) shows the "Opening …" toast through `UIContinuity.begin('practice-mode', …)` and awaits `activatePracticeMode(mode)`.
- `activatePracticeMode()` (line ~2002) runs the mode's `onEnter()` **first** (lines ~2334–2399; this triggers the lazy script load and the data/manifest fetches), then calls `syncSpeakingPracticeController()` (line ~2406) which mounts the v3 shell, and only then, inside the `deferSelectedPanelReveal` block (lines ~2407–2434), hides the dashboard and reveals the mode panel.
- The comment on that block states the intent: *"Keep outgoing content readable until the next state is ready; never delay the action for motion."*

So the behaviour is deliberate, but with a lazy-loaded mode script plus data fetches it reads as "the wrong page is still showing".

Measured, guest mode, warm cache:

| Path | Dashboard hidden at | Card visible at |
|---|---|---|
| Local static server | 734 ms | 794 ms |
| Production | 1,581 ms | 1,581 ms |

No legacy layout is ever painted: `.spc-row--primary`, `.spc-footer` and `#ra-workspace-heading` never became visible in any sample.

### A.1 Fix — reveal the card immediately with a skeleton

In `activatePracticeMode()`, split the reveal into two steps:

```js
// 1. Immediately: swap panels and show the shell skeleton (no awaiting).
revealModePanel(modePanel, { skeleton: true });   // hides dashboard, shows panel, adds .pte-shell-loading
// 2. Then: load + init the mode as today.
await modeOnEnter();
syncSpeakingPracticeController(mode, scope, leavingMode);
modePanel.classList.remove('pte-shell-loading');
```

Keep `deferSelectedPanelReveal` only for the fast path: if the mode's script is already loaded **and** `onEnter()` settles within 150 ms (race it with a timer), reveal without the skeleton so quick switches do not flash a skeleton.

### A.2 Fix — the skeleton itself

Add to `public/css/pte-speaking-shell.css` a `.pte-shell-loading` state that renders the shell's own shape before the mode has content: mode bar with the title already known, card with the progress bar, three grey blocks (instruction line 60%, a 44px centred pill for the recorder, three passage lines), and the dock with a disabled primary button. Use `--gray-100` blocks at 60% opacity with a 1.4 s shimmer, disabled under `prefers-reduced-motion`. No spinner.

### A.3 Fix — prefetch on intent

In `public/js/lazy-loader.js`, expose `prefetchMode(modeId)` that injects `<link rel="prefetch">` (or loads the script with low priority) and call it from the dashboard card's `pointerenter`/`focus` (`public/script.js`, the `#panel-tutorials .tutorial-grid .mode-switch-btn` wiring at line ~1516). Guard with `navigator.connection?.saveData` and only prefetch once per mode per session.

### A.4 Acceptance

- Card (or its skeleton) is visible **within 150 ms** of the click on a warm cache; the dashboard is hidden by then.
- Nothing from the previous screen remains once the panel is revealed.
- The skeleton never shows for longer than the real content takes; switching between two already-loaded modes shows no skeleton at all.
- A repeat of `flash-probe.js` shows `card` first-visible ≤ 150 ms and `dashboard` last-visible ≤ 150 ms.

---

## 3. Problem B — layout quality

Measured values vs the design spec (§4 of the design plan). All are current on production.

| ID | Defect | Measured now | Target |
|---|---|---|---|
| **P1** | **Read Aloud card body has no side padding** — the instruction, passage and columns touch the card border | `.ra-workbench.pte-card__body` computed `padding: 0px 0px 32px` | `22px 34px 26px` |
| **P2** | **Feedback right column has no right padding** — text runs to the card edge (obvious at ≤1280) | `.pte-fb__right` `padding-right: 0px`; right edge 1312 vs card right 1313 | `padding: 0 0 0 28px` **plus** the body's 34px side padding |
| **P3** | **Feedback left column is not the shell's column** — Read Aloud reuses `.ra-stage`, so shell column styles never apply | `.pte-fb` children: `ra-stage`, `pte-fb__right` | left column carries `.pte-fb__left` |
| **P4** | **Stat tiles have no dividers and no value bars**; empty state shows four "—" tiles | `.pte-stats > div` `border-left: 0 none`; no bar element | 1px left dividers, 5px progress bar per tile, first tile tinted |
| **P5** | **Tab strip stretches the whole column** and is a grey band | `.pte-tabs` width 533 px, `padding: 0`, grey fill | inline pill group, auto width, 3px padding, white active pill with `--shadow-sm` |
| **P6** | **Progress bar: "done" and "now" look identical** and it is inset 26px while the body is 34px | `.pte-progress > .is-now, .is-done { border-color: var(--blue-600) }` (shared rule) | done = `--blue-200`, now = `--blue-600` + label `--blue-700`, todo = `--border-default`; same side inset as the body |
| **P7** | **Legacy button gradients still win** — "Try again" is orange, "Start recording" red, "Finish recording" crimson | `modern-btn--retry` gradient `#f59e0b…`; `modern-btn--record` `#f43f5e…` | `.pte-btn--ghost` / `--primary` / `--stop` per the design plan §4.7 |
| **P8** | **Card body padding differs per mode** | RA `0 0 32px`; ASQ `10px 20px 20px`; RTS `16px 20px`; RS/DI/SGD/RL `22px 34px 26px` | identical in all 7 |
| **P9** | **Volume slider overflows the audio box** at 390px in Retell Lecture and SGD | `.pte-audio__vol input` spills 25px right / 43px left of its label | slider `width: 100%; min-width: 0` inside a flexible row |
| **P10** | **Describe Image recorder spills its stage** by 10px each side at 390px | `.di-pte-stage-rec` overRight 10, overLeft 10 | stage children `min-width: 0`, recorder wraps under the image below 700px |
| **P11** | **Question pill truncates hard** at 1024 and below (e.g. "Q749: 🎵 Virtual reality (VR) is no…" clipped from 268px to 158px) | `.spc-picker-pill-label` clientWidth 158 vs scrollWidth 268 | show `#id` + first 3–4 words, full text in `title`; hide the 🎵 glyph under 1100px |

### 3.1 The systemic cause (fix this first)

`public/js/speaking-practice-controller.js:1657` adds the class to the **mode's own element**:

```js
card.append(progress); rememberV3(state, body, card); body.classList.add('pte-card__body');
```

For Read Aloud that element is `.ra-workbench`, and `public/css/read-aloud-workspace.css:19` styles it as
`#mode-read-aloud[data-ra-workspace="v2"] .ra-workbench { padding: 0 0 2rem; }` — an ID + attribute + class selector, which beats `.pte-card__body` (one class). ASQ and RTS have the same pattern with their own paddings. The button colours (P7, and D1 in the previous plan) are the same trap one level down.

**Fix:** let the shell own its wrapper.

```js
// speaking-practice-controller.js — buildV3Shell()
const cardBody = v3Element('div', 'pte-card__body');   // shell-owned, no legacy rules target it
body.before(cardBody);                                  // body = the mode's existing node
cardBody.append(body);                                  // move the mode node inside
rememberV3(state, body, cardBody);                      // restore on unmount
```

Then in `public/css/pte-speaking-shell.css`:

```css
body.pte-shell-v3 .pte-card__body > * { padding-inline: 0; margin-inline: 0; max-width: none; }
```

so a mode's own horizontal padding no longer doubles up, and delete the per-mode body-padding overrides for ASQ and RTS. Apply the same ownership rule to the dock buttons (strip `modern-btn*` classes on adopt, restore on unmount) — that fixes P7 and the previous plan's D1 in one place.

### 3.2 Per-defect fixes

- **P2, P3:** in `read-aloud-mode.js` where the feedback grid is built, give the left column `class="pte-fb__left"` (keep `ra-stage` for the mode's own rules) and set `.pte-fb__right { padding: 0 0 0 28px }`; the outer body padding supplies the right gutter. Check the same markup in `script.js` (RS), `describe-image-mode.js`, `sgd-mode.js`, `take-notes-mode.js`.
- **P4:** extend `.pte-stats` (css line 36–40): `> div + div { border-left: 1px solid var(--border-default) }`, add `<span class="pte-stats__bar"><i style="width:N%"></i></span>` per tile, value `24px/600` with a `16px` muted unit. When a score is missing render one muted "Not scored" row spanning the four columns instead of four "—" tiles.
- **P5:** replace the RA override at css line 123–124 with the shared pill group: `display:inline-flex; width:auto; padding:3px; gap:2px; background:var(--gray-100); border-radius:999px` and the active pill `background:#fff; box-shadow:var(--shadow-sm)`. Delete the underline variant at lines 33–35 or keep it only for the modes that use it — one tab style across the shell.
- **P6:** split the shared rule at css line 15 into `.is-done { border-color: var(--blue-200); color: var(--text-secondary) }` and `.is-now { border-color: var(--blue-600); color: var(--blue-700); font-weight: 600 }`; change `.pte-progress` padding to `14px 34px 0` to match the body.
- **P9, P10:** `.pte-audio__vol { display:flex; align-items:center; gap:8px; min-width:0 } .pte-audio__vol input { flex:1 1 auto; width:100%; min-width:0 }`; for DI add `@media (max-width: 700px) { .di-pte-stage { grid-template-columns: 1fr; } .di-pte-stage-rec { justify-self: center; } }`.
- **P11:** in the picker label, render `#{id}` + a 4-word excerpt, put the full title in `title`, and add `@media (max-width: 1100px) { .pte-modebar .spc-picker-pill-label .pill-audio-glyph { display: none } }`.

### 3.3 Empty and error states (the screen in the owner's report)

When scoring fails, the card currently shows an empty left column, four "—" tiles and a one-line message. Replace with a single state block spanning both columns: title "We couldn't score this attempt", one line of cause, and two actions — "Try again" (primary) and "Keep the recording" (ghost) — plus the recorder row still showing **Complete**. Same treatment for "no transcript detected".

---

## 4. Order of work

| Batch | Items | Notes |
|---|---|---|
| 1 | §3.1 shell-owned body wrapper + class stripping | Fixes P1, P7, P8 and the previous plan's D1 together |
| 2 | P2, P3, P4, P5, P6 | Feedback and card chrome; one visual review against the target images |
| 3 | P9, P10, P11 + the previous plan's D6 | Narrow-width and truncation issues |
| 4 | §3.3 empty/error states | Needs the copy agreed |
| 5 | Problem A (A.1–A.3) | Touches the launcher; verify all 25 practice modes still open |
| 6 | Previous plan's D2, D5, D7, D9 | Coach marks, Coach count, ASQ/RTS feedback, Complete step |

---

## 5. Verification

### 5.1 New test — `tests/browser/pte-shell-layout-contract-check.js`

Run each mode with `?pteShell=v3` at 1440, 1280, 1024, 768 and 390:

```js
// P1/P8 — identical body padding in every mode
const pad = await page.evaluate(() => getComputedStyle(document.querySelector('.pte-card__body')).padding);
assert.equal(pad, '22px 34px 26px');

// P2 — no text touches the card edge
const gutter = await page.evaluate(() => {
  const card = document.querySelector('.pte-card').getBoundingClientRect();
  return [...document.querySelectorAll('.pte-card__body *')]
    .map(el => { const r = el.getBoundingClientRect(); return Math.min(r.left - card.left, card.right - r.right); })
    .filter(n => Number.isFinite(n)).sort((a, b) => a - b)[0];
});
assert.ok(gutter >= 16, `content gutter is ${gutter}px`);

// P7 — no legacy gradient anywhere in the dock
const gradients = await page.evaluate(() => [...document.querySelectorAll('.pte-dock button')]
  .filter(b => getComputedStyle(b).backgroundImage !== 'none').map(b => b.textContent.trim()));
assert.deepEqual(gradients, []);

// P9/P10 — nothing spills past its parent
// (reuse the spill probe from clip-audit.js; assert an empty list)

// A.4 — entry transition
assert.ok(cardVisibleMs <= 150, `card appeared after ${cardVisibleMs}ms`);
```

Also keep the assertions from the design plan §9.1 (recorder only after audio, Cannot-skip dialog, helpers hidden while recording, feedback card ≤ 740px, no horizontal scroll at 390px).

### 5.2 Regression

`speaking-controller-browser-check.js`, `speaking-shell-cross-mode-check.js`, `read-aloud-workspace-browser-check.js`, `verify-wfd-spc.js`, `practice-modes-ui-full-audit.js --viewport desktop,mobile`, `npm run test:structure`. The full audit already probes overflow and clipping — run it **with the shell on** as well by setting `localStorage['bel:pte-shell'] = 'v3'` in its `initScript()`.

### 5.3 Visual check

Compare against the target images at 1440 and 1024 for: Read Aloud prep, recording, complete, feedback; and the listen-first modes at 390.

---

## 6. Flag and release

The shell is on for every learner (`RELEASE_DEFAULT = true`). These defects are cosmetic apart from the truncation at 1024 and the missing feedback layouts (previous plan D7), so the shell can stay on while the batches land. If the owner prefers, set `RELEASE_DEFAULT = false` and deploy; reviewers keep `?pteShell=v3`. Every release: ask for authorisation, deploy hosting, push the commits, then re-run §5.1 against production.

---

## 7. Open questions

| ID | Question | Default |
|---|---|---|
| O-12 | Skeleton or a short delay? If the mode usually loads in under ~300 ms on the owner's connection, a 150 ms delay with no skeleton may feel calmer | Skeleton with a 150 ms fast-path |
| O-13 | Prefetch mode scripts on hover for every card, or only the last-used mode? | Hover prefetch, once per mode per session |
| O-14 | Error-state copy in §3.3 | As written above |
| O-10, O-11 (previous plan) | Coach marks vs assessment; picker placement | Unchanged |
