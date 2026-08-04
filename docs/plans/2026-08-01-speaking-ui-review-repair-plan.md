# Speaking UI Review Repair Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Remove the verified Speaking-mode layout regressions, eliminate the Read Aloud old-layout flash, and make Read Aloud settings and shared action rows visually consistent while preserving every existing control and lifecycle.

**Architecture:** Keep the existing mode panels, IDs, adapters, and controller adoption/restoration logic as the behavioral source of truth. Repair the HTML containment boundary first, make visibility atomic with controller readiness for Read Aloud, and apply narrowly scoped CSS to the existing generated settings nodes and controller rows. Add Chrome regression coverage for the actual failure modes rather than relying only on settled controller assertions.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node.js, Express static test server, Playwright Chromium.

---

## Scope and safety boundary

- In scope: the extra Reading/Speaking container boundary, Read Aloud first paint, Read Aloud settings styling, shared Speaking action-row spacing, and browser regression coverage.
- Preserve all existing IDs, event listeners, disabled/hidden states, mode-specific controls, recording states, audio elements, and settings-node restoration behavior.
- Do not redesign unrelated modes, change scoring/content/backend behavior, deploy, or push.
- The working tree already contains user changes. Do not reset, checkout, or rewrite whole files. Stage or commit only this repair if explicitly requested later.
- Work on branch `codex/speaking-ui-review-repair`; leave unrelated dirty files untouched.

## Evidence this plan addresses

| Symptom | Evidence | Root cause to repair |
|---|---|---|
| Full-width controller strips and detached Speaking content | Chrome DOM inspection: several panels are direct children of `body`; Read Aloud/ASQ/Describe Image controllers measure ~1885px instead of the 1100px main content width | Extra closing `</div>` at `public/index.html:2845` closes the wrapper before later mode panels |
| Read Aloud old UI flashes before the shared controller | Cold-route Playwright trace: panel visible at ~44ms; controller present at ~808ms; ~764ms exposed | `switchToMode()` sets `.active`/`display:block` before async `ReadAloudMode.onEnter()` and controller synchronization |
| Read Aloud settings show native gray buttons | Computed Chrome styles: Arial, `2px outset`, square corners, native appearance | RA sheet uses `.ra-settings-sheet`, while shared settings CSS is scoped to `.spc-mode-settings-sheet`; `.read-aloud-filter-btn` has no recipe |
| Controls are visually separated by excessive whitespace | `.spc-row--actions` uses `space-between`; picker is capped at 580px | The action row has no bounded content layout and treats media/attempt slots as opposite edges |
| Existing tests remain green despite these defects | 185/185 controller checks and 8/8 settings checks passed | Tests cover settled DOM/functionality, not containment, first paint, computed settings styles, or spacing |

## Functional contracts

1. Every existing functional ID remains unique and unchanged.
2. No button is cloned, replaced, or made into a new behavior-bearing node for styling.
3. `ReadAloudMode` continues to own `PREP`, `REQUESTING_MIC`, `RECORDING`, `STOPPING_RECORDING`, `RECORDED`, and `RESULTS` transitions.
4. The visible recorded audio remains `#ra-user-recording-audio`; hidden lifecycle proxies remain hidden.
5. `adoptControls()`, `restoreControls()`, `settingsMovedNodes`, and `restoreSettingsNodes()` keep operating on the original nodes.
6. Non-Read-Aloud mode switching remains asynchronous and transition-token guarded.
7. At the first visible Read Aloud frame, either the shared controller is already mounted or the panel is intentionally held in a non-visible preparation state.
8. All migrated panels remain descendants of `main.container` at settled state.

---

## Task 1: Add focused Chrome regression coverage

**Files:**

- Create: `tests/browser/speaking-ui-review-regression-check.js`
- Reference only: `tests/browser/speaking-controller-browser-check.js`
- Reference only: `tests/browser/read-aloud-question-picker-v7-dom-contract-browser-check.js`

### Step 1.1: Create the test harness

Use the existing CommonJS Playwright pattern:

- serve `public/` through an ephemeral Express port;
- launch headless Chromium;
- set guest/tutorial local-storage values before navigation;
- wait for `window.switchToMode` and dismiss `#preloader-dismiss-btn` if present;
- close browser and server in `finally` blocks;
- write screenshots to `test-results/ui-review-2026-08-01/`.

Expected artifact: the new script runs and exits non-zero only when an assertion fails.

### Step 1.2: Add containment assertions

After activating each mode in this list, wait for its settled controller and assert the panel is inside `main.container`:

```js
const panels = ['speak', 'dd', 'rmcma', 'rmcsa', 'rop', 'describe-image', 'read-aloud', 'asq', 'rts'];
const state = await page.evaluate((modeIds) => modeIds.map((modeId) => {
  const panel = document.getElementById(`mode-${modeId}`);
  return {
    modeId,
    panelExists: !!panel,
    insideMain: !!panel?.closest('main.container'),
    controllerExists: !!panel?.querySelector('.spc-controller')
  };
}), panels);
```

Expected RED result before the markup repair: at least the panels after DD report `insideMain: false`.

### Step 1.3: Add first-visible-frame tracing

Install this observer with `context.addInitScript()` before navigation:

```js
(() => {
  const trace = [];
  const snapshot = () => {
    const panel = document.getElementById('mode-read-aloud');
    if (!panel) return;
    const visible = panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    const controller = !!panel.querySelector('.spc-controller');
    const last = trace[trace.length - 1];
    if (!last || last.visible !== visible || last.controller !== controller) {
      trace.push({ time: performance.now(), visible, controller });
    }
  };
  new MutationObserver(snapshot).observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });
  window.__readAloudUiTrace = () => trace.slice();
})();
```

Switch to Read Aloud from a cold page, wait for the controller, and assert no trace entry has `visible === true && controller === false`.

Expected RED result before the lifecycle repair: the trace contains a visible/no-controller interval.

### Step 1.4: Add settings computed-style assertions

Open the Read Aloud settings sheet through the real `.spc-settings-btn` or `ReadAloudMode.openSettings()` path. Assert all of these for `#ra-diff-all` and `.spc-sheet-tab`:

- font family inherits Outfit/system UI rather than Arial;
- `min-height` is at least 44px;
- border radius is 12px or the documented pill radius;
- border is a deliberate 1px CSS border, not native `outset`;
- `appearance` is `none` where the shared button recipe requires it;
- the selected difficulty button has a visible selected state.

Expected RED result before CSS/class repair: native `outset` border and default font are detected.

### Step 1.5: Add action-row layout assertions and screenshots

At 1440px and 390px, activate Speak and assert:

- `.spc-row--actions` does not create a gap larger than 320px between populated slots on desktop;
- the row has no horizontal overflow on mobile;
- picker, action buttons, and settings remain visible and do not overlap;
- all regular buttons remain at least 44px tall.

Capture:

- `speaking-ui-speak-desktop.png`
- `speaking-ui-read-aloud-settings-desktop.png`
- `speaking-ui-speak-mobile.png`

Expected RED result before action-layout repair: the desktop slot gap exceeds the threshold and/or mobile overflow is reported.

### Step 1.6: Run the new test and record RED evidence

Run:

```powershell
node tests/browser/speaking-ui-review-regression-check.js
```

Expected: non-zero exit with failures attributable to the known containment, first-paint, native settings, and/or action-gap defects. If it passes before production changes, stop and correct the test because it is not proving the reported bugs.

---

## Task 2: Repair the HTML containment boundary

**Files:**

- Modify: `public/index.html:2845`
- Test: `tests/browser/speaking-ui-review-regression-check.js`

### Step 2.1: Remove only the orphan closing wrapper tag

Delete the extra `</div>` immediately after the DD action group and before `#dd-result-summary`. Keep the legitimate closing tags for the DD panel and the main container. Do not reformat the surrounding dirty markup.

Expected artifact: `#mode-rmcma` and all later mode panels are parsed inside `main.container`.

### Step 2.2: Run containment and existing structural tests

Run:

```powershell
node tests/browser/speaking-ui-review-regression-check.js
node tests/browser/speaking-controller-browser-check.js
node tests/browser/all-modes-settings-check.js
```

Expected: containment assertions pass; unrelated first-paint/settings/action assertions may still fail until later tasks. Existing controller and settings behavior must remain green.

---

## Task 3: Make Read Aloud visibility atomic with controller readiness

**Files:**

- Modify: `public/script.js:2105-2111, 2229-2231`
- Test: `tests/browser/speaking-ui-review-regression-check.js`

### Step 3.1: Preserve the current mode during preparation

Before hiding the old panel, keep the selected panel in a preparation state for Read Aloud. The implementation must not expose `.mode-panel.active` with `display:block` until the async mode initialization and `syncSpeakingPracticeController()` have completed.

Use the existing `isCurrentTransition()` guard after every awaited initialization. Do not remove async initialization or make `switchToMode()` fire-and-forget.

The implementation may use one of these equivalent approaches, selected after reading the current transition flow:

- initialize Read Aloud and mount the controller while the selected panel remains `display:none`, then add `.active`/`display:block` in one final commit; or
- add a scoped preparation attribute/class that keeps the selected panel non-visible until the controller is present, then remove it immediately after synchronization.

The chosen approach must preserve existing visible behavior for every other mode and must not overwrite mode-owned inline display states after activation.

### Step 3.2: Remove or scope the generic fade that exposes an old layout

If the generic `.mode-panel.active` animation still paints legacy Read Aloud content before the controller is mounted, disable it for the preparation state or scope the animation to the settled state. Respect `prefers-reduced-motion`.

Expected artifact: no first-paint interval with Read Aloud visible and controller absent.

### Step 3.3: Run the first-paint regression and lifecycle tests

Run:

```powershell
node tests/browser/speaking-ui-review-regression-check.js
node tests/browser/read-aloud-lifecycle-browser-check.js
node tests/browser/read-aloud-question-picker-v7-dom-contract-browser-check.js
```

Expected: first-paint assertion passes; Read Aloud lifecycle and picker contracts remain green.

---

## Task 4: Apply the shared settings recipe to Read Aloud

**Files:**

- Modify: `public/read-aloud-mode.js:1581-1585`
- Modify: `public/speaking-practice-controller.css:1220-1333`
- Test: `tests/browser/speaking-ui-review-regression-check.js`

### Step 4.1: Add the shared settings class without changing the stable ID

Keep `id: 'ra-settings-sheet'` and add `spc-mode-settings-sheet` to the generated sheet class list while preserving `ra-settings-sheet` for existing selectors and cleanup logic.

Expected artifact: the same sheet element receives both mode-specific and shared settings classes.

### Step 4.2: Add a scoped Read Aloud filter-button recipe

In `speaking-practice-controller.css`, style `.ra-settings-sheet .read-aloud-filter-btn` and its states using the existing Speaking settings tokens:

- `font-family: inherit`;
- `min-height: 44px`;
- `border: 1px solid var(--spc-action-border)`;
- `border-radius: var(--spc-control-radius)`;
- `appearance: none`;
- white/neutral inactive state;
- selected state using the RFIB purple/blue accent;
- visible hover, focus-visible, and disabled states;
- wrapping layout for 390px.

Do not globally restyle native buttons or alter mode-owned inline display values.

### Step 4.3: Run settings and functional regressions

Run:

```powershell
node tests/browser/speaking-ui-review-regression-check.js
node tests/browser/all-modes-settings-check.js
node tests/browser/read-aloud-lifecycle-browser-check.js
```

Expected: computed-style assertions pass and settings open/close/restoration behavior remains green.

---

## Task 5: Rebalance the shared action row

**Files:**

- Modify: `public/speaking-practice-controller.css:84-109` and responsive blocks
- Test: `tests/browser/speaking-ui-review-regression-check.js`

### Step 5.1: Replace unbounded edge distribution with a bounded content row

Keep one controller surface and the existing `.spc-slot-media` / `.spc-slot-attempt` nodes. Adjust the action row so populated slots stay in a bounded flex/grid content area:

- use `justify-content: flex-start` or a two-column layout with a controlled column gap;
- allow the attempt slot to align right only within the controller content width, not the viewport;
- retain empty-slot hiding rules already present in the stylesheet;
- preserve action-role colors, disabled state, and adapter adoption behavior;
- at 390px, stack or wrap without horizontal scrolling.

Do not add nested cards or new action buttons.

### Step 5.2: Run layout and existing controller regressions

Run:

```powershell
node tests/browser/speaking-ui-review-regression-check.js
node tests/browser/speaking-controller-browser-check.js
```

Expected: gap/overflow assertions pass and the existing controller test remains green.

---

## Task 6: Full Chrome verification and diff audit

**Files:** None beyond the implementation and test files above.

### Step 6.1: Run all focused checks fresh

Run:

```powershell
node tests/browser/speaking-ui-review-regression-check.js
node tests/browser/speaking-controller-browser-check.js
node tests/browser/all-modes-settings-check.js
node tests/browser/read-aloud-question-picker-v7-dom-contract-browser-check.js
node tests/browser/read-aloud-lifecycle-browser-check.js
npm run test:rfib:browser
node tests/browser/dd-mode-browser-check.js
node tests/browser/rmcma-mode-browser-check.js
node tests/browser/rmcsa-mode-browser-check.js
node tests/browser/rop-mode-browser-check.js
git diff --check
```

Expected: every command exits 0; browser scripts report zero failed assertions; `git diff --check` reports no new whitespace errors.

### Step 6.2: Review screenshots and DOM contracts

Inspect the three new screenshots at desktop/mobile widths. Confirm:

- all controllers share the main content width;
- Read Aloud has no old-layout first frame;
- settings buttons use the same typography, geometry, and states as the RFIB-derived design;
- action groups are visually related and remain usable on mobile;
- no nested-card structure was introduced.

### Step 6.3: Audit the final diff

Run:

```powershell
git status --short
git diff --stat -- public/index.html public/script.js public/read-aloud-mode.js public/speaking-practice-controller.css tests/browser/speaking-ui-review-regression-check.js docs/plans/2026-08-01-speaking-ui-review-repair-plan.md
git diff --check
```

Expected artifact: only the focused repair files and test artifacts are attributable to this task; unrelated dirty files remain preserved and unmodified.

## Completion criteria

- No migrated panel is outside `main.container`.
- Cold Read Aloud activation has no visible/no-controller interval.
- Read Aloud difficulty and tabs no longer render as native Arial/outset controls.
- Shared action rows do not create viewport-scale dead space or mobile overflow.
- Existing controller, settings, picker, lifecycle, and Reading-mode tests pass.
- Chrome screenshots show a consistent settled design at desktop and 390px widths.
- No production deployment or remote push is performed.
