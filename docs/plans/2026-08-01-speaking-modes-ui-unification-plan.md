# Speaking Modes UI Unification — Repair Plan (2026-08-01)

**Evidence:** [docs/audits/ui/2026-08-01-speaking-modes-ui-audit.md](../audits/ui/2026-08-01-speaking-modes-ui-audit.md)

**Goal:** Make all seven Speaking modes present one control system — same chrome typography,
same control inventory, same entry animation, same step preview — and remove the legacy
banners and orphaned text the user flagged.

**Governing principle (this is why the problem recurs):** every fix in this plan is applied at
the *system* level (controller CSS, controller lifecycle, shared component) and asserted across
**all seven modes**, never on the single mode where the bug was reported.

**Branch:** continue on `codex/speaking-ui-review-repair`. No deploy, no push.

**Modes in scope:** `read-aloud`, `rts`, `asq`, `describe-image`, `notes`, `sgd`, `speak`.

---

## Phase 0 — Lock the contract into tests first

**Files:** `tests/browser/speaking-ui-review-regression-check.js` (extend)

Convert every single-mode assertion into a loop over all seven modes:

- first-visible-frame trace has no `visible && !controller` entry, **for each mode**;
- every button inside `.spc-controller` resolves to the Outfit stack, **for each mode**;
- every interactive control in the controller and in the settings sheet is ≥ 44 px;
- an open settings sheet contains ≥ 1 control, or the ⚙ Settings trigger is not rendered;
- no `.info-box` descendant of a Speaking panel is visible;
- panel contains no visible text node matching `/^(Total (number of questions|images)|Points):/`.

**Expected RED before Phases 1–5:** failures in `notes`, `sgd`, `asq`, `speak` (first paint);
all 7 modes (Arial chrome, 36 px chrome); `rts`, `asq`, `describe-image` (empty sheets);
`notes`, `sgd`, `describe-image` (banners, orphan text).

Stop and fix the test if it goes green before the production changes land.

---

## Phase 1 — Controller chrome typography and touch targets (issue E, root cause of #1/#2)

**Files:** `public/speaking-practice-controller.css`

1. Add an explicit font declaration on the controller's own generated controls
   (`.spc-controller button, .spc-controller select, .spc-controller input`) using the app's
   Outfit stack via `font-family: inherit` plus a controller-level family — do **not** use a
   bare global `button {}` rule.
2. Raise `.spc-picker-prev`, `.spc-picker-next` and `.spc-view-toggle-btn` from 36 px to the
   shared 44 px control height; keep their current widths and roles.
3. Introduce/confirm `--spc-control-height: 44px` and use it everywhere instead of literals so
   the next mode cannot re-introduce 36 px.

**Verify:** the Phase 0 typography and touch-target loops go green for all 7 modes.

---

## Phase 2 — Atomic first paint for every Speaking mode (issue A, user #3)

**Files:** `public/script.js:2105-2111, 2238-2244`

1. Replace `const deferSelectedPanelReveal = mode === 'read-aloud'` with membership in the
   existing `speakingModes` list (`script.js:1566`) — that list is already the single source of
   truth for Speaking.
2. Keep the existing `isCurrentTransition()` guard after every awaited step; the reveal commit
   stays exactly where it is, after `syncSpeakingPracticeController()`.
3. RL and SGD hold ~700 ms today. Confirm the delay is index-loading, not rendering; if the
   hold exceeds ~400 ms, show the existing skeleton/preloader affordance during the
   preparation state rather than a blank container.

**Verify:** first-paint trace is flash-free for all 7 modes at 1440 px and 390 px.

---

## Phase 3 — Remove the legacy banners and orphan text (issues B and I, user #5/#6)

**Files:** `public/index.html`, plus the JS that populates the removed nodes

1. Delete `#notes-info-box` (4133), `#sgd-info-box` (4292), `#di-info-box` (4711) and their
   `.info-box-close` buttons. Grep for and remove the JS that shows/dismisses them so no
   handler binds to a missing node.
2. Fold the factual content of the DI banner ("25 s prep + 40 s recording") into the step
   indicator delivered in Phase 4 — the user asked for the timing to survive as steps, not as a
   warning bar.
3. Remove `#question-total`, `#score-notes`, `#score-sgd` and DI's "Total images" text from the
   Speaking panels, or move the count into the picker label where every other mode already
   shows it. Remove `#question-selector` from `speak` (`I2`).
4. Leave the Writing-mode banner at `index.html:4443` untouched — out of scope.

**Verify:** no visible `.info-box` and no orphan-count text in any Speaking panel.

---

## Phase 4 — One shared step indicator for all Speaking modes (issue D, user #4)

**Files:** new `public/js/speaking-practice-steps.js` + a block in
`public/speaking-practice-controller.css`; consumers in each mode's adapter

1. Extract the RTS breadcrumb (`.rts-step-progress`, `style.css:20961-21010`) into a shared
   `spc-steps` component that takes an ordered step list and a current index.
2. Register a step list per mode:
   - `read-aloud`: Read → Prep → Record → Results
   - `rts`: Audio → Prep → Record → Results (unchanged content)
   - `asq`: Listen → Answer → Results
   - `describe-image`: Image → Prep (25 s) → Record (40 s) → Results
   - `notes`: Audio → Notes → Record → Results
   - `sgd`: Discussion → Prep → Record → Results
   - `speak`: Listen → Record → Results
3. Render it **always visible** directly under the controller, with future steps in a muted
   state — the point is to preview the flow before Start (fixes `D2`).
4. Migrate `.di-step-progress` and `.sgd-step-progress` to the shared component and delete the
   duplicated CSS.
5. Do not wrap it in its own card — it sits on the panel background (project UI rule: no
   boxes-in-boxes).

**Verify:** all 7 panels expose `.spc-steps` with the right step count, visible before Start,
no horizontal overflow at 390 px.

---

## Phase 5 — Settings sheet: one recipe, no empty drawers (issues C, F3, G, user #1)

**Files:** `public/speaking-practice-controller.css`, `public/read-aloud-mode.js`,
`public/js/speaking-practice-adapters.js`

1. Extend the shared settings recipe from `.read-aloud-filter-btn` to **all** interactive
   controls inside `.spc-mode-settings-sheet` — explicitly including `.ra-filter-pill`:
   Outfit, `min-height: 44px`, `border-radius: var(--spc-control-radius)`, `appearance: none`,
   1 px deliberate border, and a single selected-state treatment shared with the difficulty
   buttons. This is the direct fix for the screenshot in user issue #1.
2. Restyle `.spc-sheet-close` to the neutral shared border; drop the orange accent (`C2`).
3. Unify difficulty/status filtering (`G1`) on the RA segmented-pill pattern. Replace the
   `Filter by Status ▼` / `Filter by Length ▼` / `Recommended ▼` dropdown buttons in
   `speak`/`notes`/`sgd` with the same segmented control; keep the existing IDs and handlers.
4. For `rts`, `asq`, `describe-image`: either populate the sheet with the shared difficulty
   filter (preferred — these modes have difficulty data) or do not create a sheet and do not
   render a ⚙ Settings button. No mode may ship a Settings entry point that opens nothing.
5. Show the ⚙ Settings and Basic/Advanced group consistently: either visible in all 7 modes or
   suppressed with a documented per-mode reason.

**Verify:** every open sheet has ≥ 1 control; every sheet control is Outfit / ≥ 44 px; no
Settings trigger without content.

---

## Phase 6 — Control inventory parity and layout (issues F1, F2, H, J)

**Files:** `public/index.html`, `public/js/speaking-practice-adapters.js`,
`public/speaking-practice-controller.css`, `public/read-aloud-mode.js`

1. Show the mode-tutorial `?` pill in all 7 Speaking modes (`F1`).
2. Give ASQ the prev/next arrows so its picker starts at the same x as every sibling (`F2`).
3. Read Aloud: adopt `#ra-record-btn` and the prep/record timers into `.spc-row--actions` like
   every other mode, keeping `ReadAloudMode`'s state machine and `#ra-user-recording-audio`
   ownership intact (`H1`).
4. Collapse `.spc-row--advanced` when empty and remove the reserved bottom padding on panels
   with no content below the controller (`J1`).
5. Restyle the `speak` attempts chip as a non-interactive status pill — no border, no button
   geometry (`J2`).
6. Reduce `.spc-row--actions` column gap from 24 px to the 8–12 px used elsewhere so related
   actions read as one group (`J3`).
7. Align the Read Aloud passage face with the app stack, or document the serif as deliberate
   reading typography (`J4`).

---

## Phase 7 — Full verification

```bash
node tests/browser/speaking-ui-review-regression-check.js
```

```bash
node tests/browser/speaking-ui-full-audit.js
```

```bash
node tests/browser/speaking-settings-audit.js
```

```bash
node tests/browser/speaking-controller-browser-check.js
```

```bash
node tests/browser/all-modes-settings-check.js
```

```bash
node tests/browser/read-aloud-lifecycle-browser-check.js
```

```bash
node tests/browser/read-aloud-question-picker-v7-dom-contract-browser-check.js
```

```bash
node tests/browser/asq-mode-browser-check.js
```

```bash
node tests/browser/describe-image-mode-browser-check.js
```

Then re-read `test-results/speaking-ui-audit-2026-08-01/report.json` and confirm every mode
reports `flashMs: 0`, controller chrome in Outfit, no banner, a visible stepper, and no orphan
text — at both 1440 px and 390 px.

---

## Sequencing and effort

| Phase | Fixes user issue | Risk | Rough size |
|---|---|---|---|
| 0 Tests | — | none | S |
| 1 Chrome typography + 44 px | #1, #2 | low | S |
| 2 Atomic first paint (all modes) | #3 | low | S |
| 3 Remove banners + orphan text | #5, #6 | low | S |
| 4 Shared step indicator | #4 | medium | M |
| 5 Settings unification | #1 | medium | M |
| 6 Inventory parity + RA action row | #2 | medium-high (RA lifecycle) | M |
| 7 Verification | — | none | S |

Phases 1–3 are independent and can land together as one commit; 4 and 5 are independent of each
other; 6 depends on 1 and 4.

## Completion criteria

- All 7 Speaking modes: zero visible-before-controller interval at both widths.
- All controller and settings-sheet controls: Outfit, ≥ 44 px, deliberate 1 px border.
- No PTE info banner and no orphaned count/score text in any Speaking panel.
- One step indicator component, visible before Start, in all 7 modes.
- No settings drawer opens empty; no Settings trigger without content.
- Existing controller, settings, picker, lifecycle and Reading-mode suites stay green.
- No deploy, no push.
