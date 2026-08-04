# Reading and Speaking RFIB UI Unification Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Apply RFIB's navigation, button, controller, picker, and settings-sheet design language to five Reading modes and seven Speaking modes while preserving every real control, stable DOM ID, event listener, state transition, and mode-specific capability.

**Architecture:** Keep mode JavaScript and existing DOM nodes as the behavioral source of truth. Reading uses selectors scoped under its five mode panels and the existing semantic classes/IDs; Speaking adds explicit adapter `actionRole` metadata and exposes it as restoration-safe `data-spc-action-role` styling hooks on the same adopted nodes. Shared presentation belongs in `read-mode-base.css`, `read-aloud-question-picker-v7.css`, and `speaking-practice-controller.css`; mode sheets contain only genuine mode-specific exceptions.

**Tech Stack:** HTML5, CSS custom properties, vanilla JavaScript, Node.js, Playwright with bundled Chromium/Chrome, existing browser test harnesses.

---

## Artifact metadata

- `RequestFeedback: false`
- Status: Approved scope; refined execution plan awaiting an explicit implementation command
- Plan-only edit: this document does not authorize deployment
- Workspace: `C:\Cursor AI`
- Required execution skills: `@executing-plans`, `@test-driven-development`, `@webapp-testing`, `@browser-agent`, `@verification-before-completion`

## 1. Approved product decisions

1. Include Reading modes `rfib`, `dd`, `rmcma`, `rmcsa`, and `rop`.
2. Include Speaking adapters `asq`, `rts`, `describe-image`, `notes`, `sgd`, `speak`, and `read-aloud`.
3. Keep Listening adapter `type` functionally covered by regression tests but visually outside this redesign.
4. Remove RFIB's dead `#rfib-random-toggle-btn` JavaScript reference. Do not add a new RFIB Random feature.
5. Keep picker arrows, ROP reorder arrows, and sheet-close buttons compact/icon-based.
6. Use RFIB's current semantic colors as the reference: slate Back, purple Next, blue Play, green Check/Submit, amber Retry, peach support.
7. Preserve Record/Stop red semantics and existing AI accent semantics, but align their geometry, typography, focus, shadow, and disabled states with RFIB.
8. Apply the same visual language to Speaking settings sheets without nested cards.

## 2. Scope boundaries

### In scope

- Reading navigation, picker, Random controls where already implemented, Play, Check/Submit, Retry, Next Question, Easy Reading, support, explanation, AI, and ROP reorder controls.
- Shared Speaking previous/next navigation, picker pill, Basic/Advanced/Settings controls, adopted action buttons, picker sheet, pagination, and settings sheet.
- Read Aloud's mode-owned buttons and settings presentation while preserving its native recording lifecycle.
- Chrome-only automated and interactive verification at desktop, tablet, and mobile widths.

### Out of scope

- New practice features, new buttons, new modes, content/data changes, scoring changes, or backend changes.
- Redesigning Listening `type`, Writing, or unrelated global buttons.
- Replacing native Read Aloud recorded-audio playback with a custom proxy.
- Rewriting the shared controller architecture.
- Production push, hosting deploy, or functions deploy.

## 3. Current working-tree facts to preserve

The executor must re-check these facts before editing because the relevant files are already dirty.

| Finding | Current source | Required resolution |
|---|---|---|
| DD action controls are absent from markup while JavaScript caches them | `public/index.html`; `public/dd-mode.js` `cacheElements()` | Restore `#dd-submit-btn`, `#dd-retry-btn`, and `#dd-next-question-btn` with their original states |
| ROP Next is missing a closing tag before Random | `public/index.html`, ROP picker bar | Close `#rop-v7-next-btn`; keep Random as a sibling |
| RFIB caches a Random control that does not exist | `public/rfib-mode.js` `cacheElements()` | Remove only the dead RFIB reference |
| Speaking pagination is styled from a Read Aloud-specific file | `.spc-*` selectors in `public/read-aloud-question-picker-v7.css` | Move `.spc-*` rules to `public/speaking-practice-controller.css`; retain `.ra-v7-*` rules |
| Picker pagination/search changes are already in progress | Reading scripts and `syncPickerSheet()` | Preserve search text, page reset, page count, and disabled Prev/Next behavior |
| Relevant files contain user changes | `git status --short` | Stage implementation hunks interactively; never overwrite whole files |

## 4. Source ownership map

| Concern | Source of truth | May be changed for this work? |
|---|---|---|
| Reading panel markup and stable IDs | `public/index.html` | Yes, additive classes/attributes and three structural repairs only |
| Reading shared tokens/layout | `public/read-mode-base.css` | Yes |
| Shared V7 picker visuals | `public/read-aloud-question-picker-v7.css` | Yes, only `.ra-v7-*`/Reading utilities remain here |
| RFIB-specific visuals | `public/rfib-mode.css` | Yes |
| DD-specific visuals | `public/dd-mode.css` | Yes |
| RMCMA-specific visuals | `public/rmcma-mode.css` | Yes |
| RMCSA-specific visuals | `public/rmcsa-mode.css` | Yes |
| ROP-specific visuals | `public/rop-mode.css` | Yes |
| Reading behavior | five mode JavaScript files | No behavior redesign; only remove dead RFIB lookup if approved above |
| Speaking capability inventory | `public/js/speaking-practice-adapters.js` | Yes, add declarative `actionRole` values only |
| Speaking adoption/restoration | `public/js/speaking-practice-controller.js` | Yes, copy/restore styling metadata only |
| Speaking visuals/settings | `public/speaking-practice-controller.css` | Yes |
| Read Aloud lifecycle | `public/read-aloud-mode.js` | No behavioral change |

## 5. Visual contract

### 5.1 Semantic palette

Use the current RFIB/global control colors as the baseline. Define aliases in the Reading and Speaking scoped token blocks; do not edit the global `.nav-btn` or `.modern-btn` definitions.

| Role | Normal | Hover | Text |
|---|---|---|---|
| Back/Previous | `linear-gradient(135deg, #6b7280, #4b5563)` | `linear-gradient(135deg, #4b5563, #374151)` | `#ffffff` |
| Next | `linear-gradient(135deg, #8b5cf6, #7c3aed)` | `linear-gradient(135deg, #7c3aed, #6d28d9)` | `#ffffff` |
| Play | `linear-gradient(135deg, #3b82f6, #2563eb)` | `linear-gradient(135deg, #2563eb, #1d4ed8)` | `#ffffff` |
| Check/Submit | `linear-gradient(135deg, #22c55e, #16a34a)` | `linear-gradient(135deg, #16a34a, #15803d)` | `#ffffff` |
| Retry | `linear-gradient(135deg, #f59e0b, #d97706)` | `linear-gradient(135deg, #d97706, #b45309)` | `#ffffff` |
| Record/Stop | `linear-gradient(135deg, #f43f5e, #e11d48)` | `linear-gradient(135deg, #e11d48, #be123c)` | `#ffffff` |
| Support | `linear-gradient(135deg, #fff7ed, #ffedd5)` | `linear-gradient(135deg, #ffedd5, #fed7aa)` | `#c2410c` |
| Quiet utility | `#ffffff` with `var(--read-border)`/Speaking alias | warm neutral hover | `#4b5563` |
| Random inactive | quiet utility treatment | warm neutral hover | neutral text |
| Random active | `var(--read-accent-soft)`/Speaking alias | slightly stronger accent tint | `#9a5722` |
| AI | preserve existing AI gradient/colors | preserve existing hover hue | existing contrast-safe text |

### 5.2 Geometry and states

- Regular action height: minimum 44 px.
- Regular horizontal padding: 14-24 px depending on label length.
- Compact icon control: 36 x 36 px on desktop; 44 x 44 px at `max-width: 390px`.
- Control radius: `12px`; pills remain `999px`.
- Font: `var(--font-body, 'Outfit', system-ui, sans-serif)`.
- Weight: 600 for actions; 700 only for support/selected emphasis.
- Normal shadow: restrained 2-6 px elevation; hover may lift by 1 px.
- Active: return to `translateY(0)`; do not scale text buttons.
- Disabled: opacity around 0.5, `cursor: not-allowed`, no hover lift or stronger shadow.
- Focus: 2 px visible outline plus 2 px offset; do not remove native keyboard visibility without replacement.
- Reduced motion: transitions effectively disabled under `prefers-reduced-motion: reduce`.

### 5.3 Layout rules

- One elevated controller/header surface per mode; do not wrap action groups in additional cards.
- Button groups may wrap, but labels must not be clipped or overlap at 390 px.
- Picker pill takes remaining width and ellipsizes its question label.
- Previous and Next remain visually distinct even when icon-only.
- Settings sections use headings, spacing, and dividers on one sheet surface; no card-inside-sheet treatment.
- Desktop settings remain a right sheet; mobile remains a bottom sheet.

## 6. Functional contracts

1. Every existing functional ID remains unique and unchanged.
2. No button may be cloned or replaced to achieve styling.
3. Existing listeners remain on the original nodes.
4. Existing `disabled`, `hidden`, inline `display`, loading, active, `aria-pressed`, `aria-expanded`, and step visibility continue to control behavior.
5. `adoptControls()` records an anchor before moving a control and `restoreControls()` returns that exact node after the anchor.
6. `settingsMovedNodes` records original placement/display, and `restoreSettingsNodes()` runs before settings sheet destruction.
7. `data-spc-scope-hidden` remains the controller's step-visibility mechanism; styling must not overwrite mode-owned `style.display`.
8. Read Aloud keeps states `PREP`, `REQUESTING_MIC`, `RECORDING`, `STOPPING_RECORDING`, `RECORDED`, and `RESULTS`.
9. Read Aloud's visible recorded playback remains native `#ra-user-recording-audio`; hidden `#ra-play-recording-btn` is not treated as a visible action.
10. A mode without a capability receives no placeholder button.

## 7. Speaking action-role map

Add `actionRole` only to actual button entries. Do not add it to badges or settings containers.

| Mode | Exact mapping |
|---|---|
| ASQ | `asq-play-prompt-btn: play`; `asq-record-btn: record`; `asq-stop-btn: stop`; `asq-redo-btn: retry` |
| RTS | `play-rts-btn: play`; `rts-stop-btn: stop`; `rts-retry-btn: retry`; `rts-ai-score-btn: ai`; `rts-next-question-btn: next` |
| Describe Image | `play-di-btn: play`; `di-stop-btn: stop`; `di-retry-btn: retry`; `di-submit-btn: primary`; `di-results-retry-btn: retry`; `di-next-question-btn: next`; `di-ai-btn: ai`; `recommended-btn-di: support` |
| Notes | `play-notes-btn: play`; `notes-submit-btn: primary`; `notes-retry-btn: retry`; `recommended-btn-notes: support` |
| SGD | `play-sgd-btn: play`; `sgd-record-btn: record`; `sgd-stop-btn: stop`; `sgd-submit-btn: primary`; `sgd-retry-btn: retry`; `recommended-btn-sgd: support` |
| Repeat Sentence | `play-btn-speak: play`; `record-btn: record`; `check-btn-speak: primary`; `retry-btn-speak: retry`; `shadow-mode-btn: support`; `recommended-btn-speak: support` |
| Read Aloud | Style mode-owned IDs directly: `ra-play-audio-btn: play`; `ra-record-btn: record`; `ra-stop-btn: stop`; `ra-check-btn: primary`; `ra-retry-btn: retry`; `ra-next-btn: next`; history toggle: quiet utility |

Explicit exclusions:

- `replay-counter-speak` remains a status badge.
- `progress-bar-*` remains progress UI.
- difficulty/status/length containers remain settings layout.
- `ra-user-recording-audio` remains a native audio element.
- `ra-play-recording-btn` remains a hidden lifecycle proxy.
- Listening `type` adapter entries do not receive new action roles in this scope.

---

## 8. Step-by-step implementation

### Task 0: Establish a recoverable dirty-worktree baseline

**Files:** None.

**Step 0.1: Inspect the workspace before editing**

Run:

```powershell
git status --short
git diff -- public/index.html public/read-mode-base.css public/rfib-mode.css public/dd-mode.css public/rmcma-mode.css public/rmcsa-mode.css public/rop-mode.css public/read-aloud-question-picker-v7.css public/js/speaking-practice-adapters.js public/js/speaking-practice-controller.js public/speaking-practice-controller.css
```

Expected artifact: terminal output identifying every pre-existing dirty file and hunk. Do not continue until the executor can distinguish baseline hunks from implementation hunks.

**Step 0.2: Confirm supported commands and existing tests**

Run:

```powershell
Test-Path tests/browser/speaking-controller-browser-check.js
Test-Path tests/browser/all-modes-settings-check.js
npm run
```

Expected artifact: both paths print `True`; npm lists `audit:read-modes`, `test:rfib:browser`, `verify:rfib`, `test:read-aloud:v7:browser`, `test:read-aloud:lifecycle:browser`, and `test:difficulty:browser`.

**Step 0.3: Check current syntax noise**

Run:

```powershell
git diff --check
```

Expected artifact: either no output/exit 0 or a recorded list of pre-existing whitespace errors. New work must not add errors.

### Task 1: Create the Reading control contract test

**Files:**

- Create: `tests/browser/reading-button-system-browser-check.js`
- Reference: `tests/browser/rfib-mode-browser-check.js`
- Reference: `tests/browser/dd-mode-browser-check.js`

**Step 1.1: Build the local Chrome harness**

Create a Playwright test script using the repository's existing CommonJS pattern:

```js
const assert = require('assert');
const express = require('express');
const path = require('path');
const { chromium } = require('playwright');

const READING_CONTRACTS = {
  rfib: {
    panel: '#mode-rfib',
    required: [
      'rfib-back-btn', 'rfib-question-select', 'rfib-next-btn',
      'rfib-full-audio-play', 'rfib-check-btn', 'rfib-retry-btn',
      'rfib-next-question-btn', 'rfib-easy-reading-btn'
    ]
  },
  dd: {
    panel: '#mode-dd',
    required: [
      'dd-v7-prev-btn', 'dd-v7-question-pill', 'dd-v7-next-btn',
      'dd-random-toggle-btn', 'dd-submit-btn', 'dd-retry-btn',
      'dd-next-question-btn', 'dd-v7-sheet-close'
    ]
  },
  rmcma: {
    panel: '#mode-rmcma',
    required: [
      'rmcma-v7-prev-btn', 'rmcma-v7-question-pill', 'rmcma-v7-next-btn',
      'rmcma-random-toggle-btn', 'rmcma-submit-btn', 'rmcma-retry-btn',
      'rmcma-explanation-toggle', 'rmcma-v7-sheet-close'
    ]
  },
  rmcsa: {
    panel: '#mode-rmcsa',
    required: [
      'rmcsa-v7-prev-btn', 'rmcsa-v7-question-pill', 'rmcsa-v7-next-btn',
      'rmcsa-random-toggle-btn', 'rmcsa-submit-btn', 'rmcsa-retry-btn',
      'rmcsa-explanation-toggle', 'rmcsa-v7-sheet-close'
    ]
  },
  rop: {
    panel: '#mode-rop',
    required: [
      'rop-v7-prev-btn', 'rop-v7-question-pill', 'rop-v7-next-btn',
      'rop-random-toggle-btn', 'rop-btn-move-right', 'rop-btn-move-left',
      'rop-btn-move-up', 'rop-btn-move-down', 'rop-submit-btn',
      'rop-retry-btn', 'rop-explanation-toggle', 'rop-critique-btn',
      'rop-v7-sheet-close'
    ]
  }
};
```

Reuse the overlay dismissal and Firebase-mocking approach from existing mode checks; do not assume a shared development server port.

Expected artifact: the new test file launches bundled Chromium headlessly against an ephemeral local Express server.

**Step 1.2: Add static and DOM integrity assertions**

For each contract assert:

- every required ID appears exactly once;
- `document.querySelectorAll('button button').length === 0`;
- every visible button has `type="button"` unless it is intentionally a form submit;
- every compact icon-only button has an accessible name;
- `#rfib-random-toggle-btn` is absent from HTML;
- the string `rfib-random-toggle-btn` is absent from `public/rfib-mode.js` after Task 2;
- no page error occurs.

Expected artifact: structural assertions are added to the test file.

**Step 1.3: Run the new test before repairs**

Run:

```powershell
node tests/browser/reading-button-system-browser-check.js
```

Expected artifact: non-zero exit with failures for missing DD action IDs, nested ROP button markup, and the dead RFIB JavaScript reference. Record any additional failure before proceeding.

### Task 2: Repair the three confirmed Reading contracts

**Files:**

- Modify: `public/index.html`
- Modify: `public/rfib-mode.js`
- Test: `tests/browser/reading-button-system-browser-check.js`

**Step 2.1: Restore DD actions**

Inside `#mode-dd`, immediately after `.dd-word-bank-card`, restore:

```html
<div class="dd-actions">
  <button id="dd-submit-btn" class="modern-btn modern-btn--check" type="button" disabled>Submit</button>
  <button id="dd-retry-btn" class="modern-btn modern-btn--retry" type="button" style="display: none;">Retry</button>
  <button id="dd-next-question-btn" class="modern-btn modern-btn--next" type="button" style="display: none;">Next Question</button>
</div>
```

Remove the orphan closing `</div>` left by the current deletion. Do not change the IDs, labels, initial states, or DD JavaScript.

Expected artifact: valid DD action markup in `public/index.html`.

**Step 2.2: Close the ROP Next button**

Change the picker structure so `#rop-v7-next-btn` closes before `#rop-random-toggle-btn`. Both must be siblings in `.ra-v7-nav`.

Expected artifact: valid sibling button markup in `public/index.html`.

**Step 2.3: Remove only the dead RFIB lookup**

Delete this cache line from `public/rfib-mode.js`:

```js
elements.randomToggleBtn = document.getElementById('rfib-random-toggle-btn');
```

Do not add Random markup or alter other modes' Random state.

Expected artifact: `public/rfib-mode.js` no longer references the nonexistent ID.

**Step 2.4: Verify structural repair**

Run:

```powershell
node tests/browser/reading-button-system-browser-check.js
node tests/browser/dd-mode-browser-check.js
node tests/browser/rop-mode-browser-check.js
npm run test:rfib:browser
```

Expected artifact: all four commands exit 0 with no missing IDs, nested buttons, page errors, or behavior regressions.

**Step 2.5: Stage only structural-repair hunks**

Run:

```powershell
git add -p -- public/index.html public/rfib-mode.js
git add -- tests/browser/reading-button-system-browser-check.js
git diff --cached --check
git diff --cached --name-only
```

Expected artifact: staged diff contains only the three repairs and the new contract test.

**Step 2.6: Commit the structural gate**

```powershell
git commit -m "fix: restore reading control contracts"
```

Expected artifact: one focused commit; unrelated dirty hunks remain unstaged.

### Task 3: Add the scoped Reading semantic button layer

**Files:**

- Modify: `tests/browser/reading-button-system-browser-check.js`
- Modify: `public/read-mode-base.css`
- Modify: `public/read-aloud-question-picker-v7.css`

**Step 3.1: Add failing computed-style assertions**

Add helpers that return `backgroundImage`, `backgroundColor`, `borderRadius`, `minHeight`, `fontFamily`, `opacity`, `cursor`, and focus outline for a selector. Assert representative pairs:

- `#rfib-back-btn` and Reading previous buttons use slate treatment;
- `#rfib-next-btn` and Reading next buttons use purple treatment;
- `#rfib-full-audio-play` uses blue;
- Check/Submit buttons use green;
- Retry buttons use amber;
- Easy Reading/support uses peach;
- compact controls use 36 px desktop and 44 px at 390 px;
- disabled controls do not lift on hover;
- focused controls have a visible outline;
- no horizontal panel overflow occurs at 390 px.

Expected artifact: expanded Reading contract test.

**Step 3.2: Confirm the style test fails before implementation**

Run:

```powershell
node tests/browser/reading-button-system-browser-check.js
```

Expected artifact: structural assertions pass; at least one shared V7 navigation/style assertion fails.

**Step 3.3: Define Reading action tokens**

In the existing five-panel token block in `public/read-mode-base.css`, add scoped aliases for back, next, play, primary, retry, record, support, neutral, focus, control height, and compact size. Keep values from Section 5.

Expected artifact: one authoritative Reading token block; no selector outside the five Reading panels changes appearance.

**Step 3.4: Add scoped regular-action recipes**

Under the five Reading panel selectors, normalize `.nav-btn`, `.modern-btn`, `.random-toggle-btn`, `.difficulty-filter-btn`, and mode support buttons for font, radius, target height, padding, shadow, transition, disabled, active, and focus-visible behavior. Apply semantic backgrounds using existing classes/IDs; do not rename or replace controls.

Expected artifact: shared Reading action rules in `public/read-mode-base.css`.

**Step 3.5: Normalize V7 compact controls**

In `public/read-aloud-question-picker-v7.css`:

- align `.ra-v7-icon-btn`, `.ra-v7-question-pill`, `.ra-v7-sheet-close`, `.ra-v7-pagination-btn`, and `.random-toggle-btn` with the token geometry;
- distinguish previous and next with Reading-panel-scoped ID suffix selectors;
- keep `.ra-v7-*` ownership in this file;
- remove no `.spc-*` rules yet except as part of Task 10, to keep commits focused.

Expected artifact: V7 picker controls match the Reading semantic system.

**Step 3.6: Run shared Reading style gates**

Run:

```powershell
npm run audit:read-modes
node tests/browser/reading-button-system-browser-check.js
git diff --check
```

Expected artifact: all commands exit 0; no defeated responsive base rule is reported.

**Step 3.7: Commit the shared Reading layer**

```powershell
git add -p -- public/read-mode-base.css public/read-aloud-question-picker-v7.css tests/browser/reading-button-system-browser-check.js
git diff --cached --check
git commit -m "style: define RFIB reading control system"
```

Expected artifact: one commit containing only shared Reading style/test hunks.

### Task 4: Reconcile RFIB with the shared system

**Files:**

- Modify: `public/rfib-mode.css`
- Modify: `tests/browser/rfib-mode-browser-check.js`
- Test: `tests/browser/reading-button-system-browser-check.js`

**Step 4.1: Add RFIB state assertions**

Extend the RFIB browser check to assert normal, playing, submitted, Retry-visible, Next Question-visible, and Easy Reading states. Assert Back/Next still change `#rfib-question-select` and Play still drives the existing audio element.

Expected artifact: RFIB test coverage for every styled state.

**Step 4.2: Remove conflicting RFIB button declarations**

In `public/rfib-mode.css`, keep RFIB-only layout and Easy Reading/support details, but remove or reduce declarations that duplicate the shared radius, font, shadow, hover, active, disabled, and focus recipes. Keep `.modern-btn--easy-reading` colors aligned with Section 5.

Expected artifact: RFIB consumes the shared system without changing its reference appearance.

**Step 4.3: Verify RFIB independently**

```powershell
npm run verify:rfib
node tests/browser/reading-button-system-browser-check.js
```

Expected artifact: both commands exit 0; audio, answer checking, Retry, Next Question, and Easy Reading remain functional.

**Step 4.4: Commit RFIB reconciliation**

```powershell
git add -p -- public/rfib-mode.css tests/browser/rfib-mode-browser-check.js tests/browser/reading-button-system-browser-check.js
git commit -m "style: reconcile RFIB controls with shared tokens"
```

Expected artifact: focused RFIB commit.

### Task 5: Apply the system to DD

**Files:**

- Modify: `public/dd-mode.css`
- Modify: `tests/browser/dd-mode-browser-check.js`
- Test: `tests/browser/reading-button-system-browser-check.js`

**Step 5.1: Add DD lifecycle assertions**

Assert Submit starts disabled, enables after valid placement, reveals Retry/Next after submission, and continues to support drag/drop plus keyboard click-to-place. Assert picker previous/next/Random/search/pagination/close still operate.

Expected artifact: DD test covers every affected control state.

**Step 5.2: Reconcile DD styles**

Remove mode-level action declarations that fight the shared recipe. Keep DD-only blank, chip, drag target, word-bank, and action-row layout. Ensure `.dd-actions` wraps at 390 px without clipping.

Expected artifact: DD controls visually match RFIB while DD interaction visuals remain distinct.

**Step 5.3: Verify DD**

```powershell
node tests/browser/dd-mode-browser-check.js
node tests/browser/reading-button-system-browser-check.js
npm run audit:read-modes
```

Expected artifact: all commands exit 0; DD behavior and responsive layout pass.

**Step 5.4: Commit DD migration**

```powershell
git add -p -- public/dd-mode.css tests/browser/dd-mode-browser-check.js tests/browser/reading-button-system-browser-check.js
git commit -m "style: apply RFIB controls to drag and drop"
```

Expected artifact: focused DD commit.

### Task 6: Apply the system to RMCMA and RMCSA

**Files:**

- Modify: `public/rmcma-mode.css`
- Modify: `public/rmcsa-mode.css`
- Modify: `tests/browser/rmcma-mode-browser-check.js`
- Modify: `tests/browser/rmcsa-mode-browser-check.js`
- Test: `tests/browser/reading-button-system-browser-check.js`

**Step 6.1: Add RMCMA control assertions**

Assert multiple choices can be selected, Submit scores them, Retry resets them, explanation toggles, and navigation/Random/picker controls retain state.

Expected artifact: expanded RMCMA test.

**Step 6.2: Add RMCSA control assertions**

Assert only one choice remains selected, Submit scores it, Retry resets it, explanation toggles, and navigation/Random/picker controls retain state.

Expected artifact: expanded RMCSA test.

**Step 6.3: Reconcile RMCMA styles**

Remove duplicate/conflicting action styles from `public/rmcma-mode.css`; retain multiple-answer choice and result presentation.

Expected artifact: RMCMA consumes shared controls.

**Step 6.4: Verify RMCMA before touching RMCSA**

```powershell
node tests/browser/rmcma-mode-browser-check.js
node tests/browser/reading-button-system-browser-check.js
```

Expected artifact: both commands exit 0.

**Step 6.5: Reconcile RMCSA styles**

Remove duplicate/conflicting action styles from `public/rmcsa-mode.css`; retain single-answer choice and result presentation.

Expected artifact: RMCSA consumes shared controls.

**Step 6.6: Verify both multiple-choice modes**

```powershell
node tests/browser/rmcma-mode-browser-check.js
node tests/browser/rmcsa-mode-browser-check.js
node tests/browser/reading-button-system-browser-check.js
npm run audit:read-modes
```

Expected artifact: all commands exit 0 with selection/scoring/explanation behavior intact.

**Step 6.7: Commit the paired migration**

```powershell
git add -p -- public/rmcma-mode.css public/rmcsa-mode.css tests/browser/rmcma-mode-browser-check.js tests/browser/rmcsa-mode-browser-check.js tests/browser/reading-button-system-browser-check.js
git commit -m "style: apply RFIB controls to reading choices"
```

Expected artifact: one bisectable multiple-choice commit.

### Task 7: Apply the system to ROP

**Files:**

- Modify: `public/rop-mode.css`
- Modify: `tests/browser/rop-mode-browser-check.js`
- Test: `tests/browser/reading-button-system-browser-check.js`

**Step 7.1: Add ROP control assertions**

Assert:

- move-right/left/up/down preserve their exact direction and disabled rules;
- Submit reveals scoring controls;
- Retry restores the workspace;
- explanation toggles;
- AI critique retains loading/spinner state;
- picker navigation, Random, search, pagination, and close remain functional.

Expected artifact: expanded ROP test.

**Step 7.2: Reconcile ROP action styles**

Use shared Submit/Retry/secondary/AI recipes. Keep `.rop-arrow-btn` compact and retain its desktop-versus-stacked SVG switching. Align its radius, border, focus, hover, active, and disabled states to the shared tokens.

Expected artifact: ROP action and reorder controls match RFIB geometry.

**Step 7.3: Verify ROP at desktop and mobile widths**

```powershell
node tests/browser/rop-mode-browser-check.js
node tests/browser/reading-button-system-browser-check.js
npm run audit:read-modes
```

Expected artifact: all commands exit 0; no reversed arrow meaning or mobile overflow.

**Step 7.4: Commit ROP migration**

```powershell
git add -p -- public/rop-mode.css tests/browser/rop-mode-browser-check.js tests/browser/reading-button-system-browser-check.js
git commit -m "style: apply RFIB controls to reorder paragraphs"
```

Expected artifact: focused ROP commit.

### Task 8: Add explicit Speaking action-role metadata safely

**Files:**

- Modify: `tests/browser/speaking-controller-browser-check.js`
- Modify: `public/js/speaking-practice-adapters.js`
- Modify: `public/js/speaking-practice-controller.js`

**Step 8.1: Add failing adapter-role assertions**

For each mapping in Section 7, activate the adapter and assert the same source node appears inside the expected `.spc-slot-*` with the correct `data-spc-action-role`. Assert excluded badge/settings nodes have no role. Assert Listening `type` receives no new role metadata.

Expected artifact: Speaking test fails because role metadata is not implemented.

**Step 8.2: Add declarative `actionRole` values**

Update only actual button entries in `public/js/speaking-practice-adapters.js`, for example:

```js
{ sourceId: 'asq-play-prompt-btn', slot: 'media', level: 'basic', order: 1, actionRole: 'play' }
```

Use exactly: `back`, `next`, `play`, `primary`, `retry`, `record`, `stop`, `support`, `secondary`, `ai`, or `utility`. This task uses only roles listed in Section 7.

Expected artifact: adapter declarations carry explicit styling semantics without changing capability or order.

**Step 8.3: Preserve any original role value during adoption**

In `adoptControls()`, record the original dataset value before setting the new one:

```js
originalActionRole: el.dataset.spcActionRole
```

After recording the node:

```js
if (ctrl.actionRole) {
  el.dataset.spcActionRole = ctrl.actionRole;
}
```

Expected artifact: adopted nodes expose a role on the original DOM element.

**Step 8.4: Restore role metadata on unmount**

In `restoreControls()`:

```js
if (record.originalActionRole === undefined) {
  delete el.dataset.spcActionRole;
} else {
  el.dataset.spcActionRole = record.originalActionRole;
}
```

Do this alongside existing level/scope cleanup. Do not alter listener, display, or anchor handling.

Expected artifact: role metadata cannot leak between mode mounts.

**Step 8.5: Verify adoption and restoration**

```powershell
node tests/browser/speaking-controller-browser-check.js
npx eslint public/js/speaking-practice-controller.js public/js/speaking-practice-adapters.js
```

Expected artifact: controller test exits 0; ESLint reports no new errors.

**Step 8.6: Commit role metadata**

```powershell
git add -p -- public/js/speaking-practice-adapters.js public/js/speaking-practice-controller.js tests/browser/speaking-controller-browser-check.js
git commit -m "refactor: declare speaking action roles"
```

Expected artifact: behavior-neutral metadata commit.

### Task 9: Apply RFIB design to the Speaking controller and actions

**Files:**

- Modify: `tests/browser/speaking-controller-browser-check.js`
- Modify: `public/speaking-practice-controller.css`

**Step 9.1: Add failing Speaking computed-style assertions**

At 1440 x 1200 and 390 x 844, assert:

- `.spc-picker-prev` is slate and `.spc-picker-next` is purple;
- `.spc-picker-pill` uses RFIB control radius/border/surface;
- adopted roles map to Section 5 colors;
- primary/action targets are at least 44 px;
- mobile navigation remains in one usable row or wraps without overflow;
- disabled and focus-visible states are distinct;
- reduced-motion context reports effectively disabled transitions.

Expected artifact: Speaking controller test fails against the old circular-blue navigation.

**Step 9.2: Add Speaking aliases for RFIB action tokens**

Extend the existing `:root` token block in `public/speaking-practice-controller.css` with `--spc-action-*` aliases matching Section 5. Do not depend on variables scoped inside Reading panels.

Expected artifact: Speaking has a self-contained but matching token set.

**Step 9.3: Restyle controller navigation**

Update `.spc-controller`, `.spc-picker-prev`, `.spc-picker-next`, and `.spc-picker-pill` to use RFIB surface, border, radius, shadows, semantic previous/next colors, and responsive sizing. Keep sticky positioning, z-index, picker callbacks, and pill ellipsis.

Expected artifact: Speaking navigation visually matches RFIB without JavaScript behavior changes.

**Step 9.4: Style adopted role selectors**

Add scoped rules such as:

```css
.spc-controller [data-spc-action-role="play"] { /* blue recipe */ }
.spc-controller [data-spc-action-role="primary"] { /* green recipe */ }
.spc-controller [data-spc-action-role="retry"] { /* amber recipe */ }
.spc-controller [data-spc-action-role="record"],
.spc-controller [data-spc-action-role="stop"] { /* red recipe */ }
.spc-controller [data-spc-action-role="next"] { /* purple recipe */ }
.spc-controller [data-spc-action-role="support"] { /* peach recipe */ }
```

Include hover, active, disabled, focus-visible, loading, and recording states. Do not use `!important` unless required to preserve a state owned by an existing mode class, and document any such use inline.

Expected artifact: every adopted Speaking action receives a semantic RFIB treatment.

**Step 9.5: Style mode-owned Read Aloud actions**

Under `#mode-read-aloud`, apply equivalent recipes to the exact visible IDs in Section 7. Do not expose or restyle the hidden proxy as a visible button.

Expected artifact: Read Aloud's visible actions match the controller family while lifecycle ownership remains in `read-aloud-mode.js`.

**Step 9.6: Verify all Speaking adapters and excluded Listening mode**

```powershell
node tests/browser/speaking-controller-browser-check.js
node tests/browser/practice-modes-browser-check.js
npm run test:difficulty:browser
```

Expected artifact: all commands exit 0; the seven Speaking adapters pass and `type` behavior remains unaffected.

**Step 9.7: Commit Speaking controller styling**

```powershell
git add -p -- public/speaking-practice-controller.css tests/browser/speaking-controller-browser-check.js
git commit -m "style: apply RFIB design to speaking controls"
```

Expected artifact: focused controller/action style commit.

### Task 10: Apply RFIB design to Speaking picker and settings sheets

**Files:**

- Modify: `tests/browser/all-modes-settings-check.js`
- Modify: `tests/browser/read-aloud-question-picker-v7-dom-contract-browser-check.js`
- Modify: `tests/browser/speaking-controller-browser-check.js`
- Modify: `public/speaking-practice-controller.css`
- Modify: `public/read-aloud-question-picker-v7.css`

**Step 10.1: Expand settings-sheet behavior assertions**

For each Speaking mode, verify Settings opens, expected sections are present, unsupported sections are absent, tabs work, Escape/close restores focus, and opening/closing does not create duplicate IDs.

Expected artifact: `all-modes-settings-check.js` verifies more than sheet visibility.

**Step 10.2: Add node-restoration assertions**

Record each settings node's parent/next sibling before opening. After closing and after controller unmount, assert it returns to the anchor position with its original inline display. Repeat mount/unmount once to detect stranded nodes.

Expected artifact: controller/settings tests lock restoration order.

**Step 10.3: Move shared pagination CSS ownership**

Move only these rules from `public/read-aloud-question-picker-v7.css` to `public/speaking-practice-controller.css`:

- `.spc-sheet-pagination`
- `.spc-pagination-btn`
- `.spc-pagination-info`

Leave `.ra-v7-pagination`, `.ra-v7-pagination-btn`, `.ra-v7-pagination-info`, page-number, and Reading Random rules in the V7 stylesheet.

Expected artifact: no `.spc-*` selector remains in the Read Aloud/V7 stylesheet.

**Step 10.4: Restyle the picker sheet**

Apply RFIB surface, radius, warm border, list-row current state, search focus, compact close, and pagination controls to `.spc-sheet` picker content. Preserve side-sheet/bottom-sheet breakpoints and pointer-event layering.

Expected artifact: picker sheet matches RFIB and retains search/pagination.

**Step 10.5: Restyle the settings sheet without nested cards**

Update `.spc-mode-settings-sheet`, `.spc-settings-section`, section titles, tabs, dropdown buttons, toggles, active chips, and History presentation. Keep sections transparent with spacing/dividers; do not add inner card backgrounds/shadows.

Expected artifact: settings uses one coherent sheet surface.

**Step 10.6: Verify settings and Read Aloud picker contracts**

```powershell
node tests/browser/all-modes-settings-check.js
node tests/browser/speaking-controller-browser-check.js
npm run test:read-aloud:v7:browser
```

Expected artifact: all commands exit 0; no duplicate IDs, stranded settings nodes, focus loss, or pagination regression.

**Step 10.7: Verify Read Aloud lifecycle separately**

```powershell
npm run test:read-aloud:lifecycle:browser
node tests/browser/read-aloud-check.js
```

Expected artifact: lifecycle reaches recorded playback and results; Retry and Next still work; native audio remains visible and wired to a blob URL.

**Step 10.8: Commit picker/settings styling**

```powershell
git add -p -- public/speaking-practice-controller.css public/read-aloud-question-picker-v7.css tests/browser/all-modes-settings-check.js tests/browser/read-aloud-question-picker-v7-dom-contract-browser-check.js tests/browser/speaking-controller-browser-check.js
git commit -m "style: unify speaking sheets with RFIB"
```

Expected artifact: focused sheet/settings commit.

### Task 11: Run reproducible Chrome visual acceptance

**Files:**

- Modify: `tests/browser/reading-button-system-browser-check.js`
- Modify: `tests/browser/speaking-controller-browser-check.js`
- Runtime artifacts: `test-results/reading-speaking-rfib-ui/`

**Step 11.1: Add deterministic screenshot capture**

Use exact viewports and filenames:

| Viewport | Size | Required filenames |
|---|---:|---|
| Desktop | 1440 x 1200 | `reading-rfib-default-desktop.png`, `reading-rfib-submitted-desktop.png`, `reading-dd-desktop.png`, `reading-rmcma-desktop.png`, `reading-rmcsa-desktop.png`, `reading-rop-desktop.png`, `speaking-asq-desktop.png`, `speaking-sgd-desktop.png`, `speaking-read-aloud-recorded-desktop.png`, `speaking-settings-desktop.png` |
| Tablet | 768 x 1024 | `reading-controls-tablet.png`, `speaking-controller-tablet.png`, `speaking-settings-tablet.png` |
| Mobile | 390 x 844 | `reading-controls-mobile.png`, `reading-rop-mobile.png`, `speaking-controller-mobile.png`, `speaking-picker-mobile.png`, `speaking-settings-mobile.png` |

Store them under `test-results/reading-speaking-rfib-ui/`. Attach listeners for `pageerror` and console errors; fail the script on new relevant errors.

Expected artifact: deterministic screenshots and machine-readable pass/fail console output.

**Step 11.2: Run the automated Playwright gate**

If login is required, first read `C:\Cursor AI\.local\browser-test-credentials.md`; never print or commit its contents.

Run:

```powershell
node tests/browser/reading-button-system-browser-check.js
node tests/browser/speaking-controller-browser-check.js
```

Expected artifact: both commands exit 0 and all required screenshot files exist. Automated failure blocks the interactive pass.

**Step 11.3: Perform interactive browser-agent inspection**

After Playwright passes, inspect the same states in Chrome and record:

- route/mode;
- viewport;
- control state;
- screenshot path;
- pass/fail for clipping, overflow, hierarchy, z-index, pointer interception, focus, and mobile ergonomics.

Expected artifact: a manual observation table for the verification report. Browser-agent supplements, but never replaces, Playwright.

**Step 11.4: Handle visual findings**

- For a functional issue, first add a Playwright reproduction, then fix forward and rerun the affected task gate.
- For a purely visual issue, fix the smallest scoped CSS rule and rerun both Playwright and interactive inspection.
- Do not continue with a known acceptance failure.

Expected artifact: either a clean acceptance result or a focused corrective commit with reproduced evidence.

**Step 11.5: Commit test refinements only**

```powershell
git add -p -- tests/browser/reading-button-system-browser-check.js tests/browser/speaking-controller-browser-check.js
git commit -m "test: add RFIB UI visual acceptance coverage"
```

Expected artifact: tests committed; screenshots remain untracked unless the user explicitly requests tracked artifacts.

### Task 12: Run the final regression gate and write evidence

**Files:**

- Create: `docs/audits/ui/2026-08-01-reading-speaking-rfib-ui-verification.md`

**Step 12.1: Run the complete scoped gate**

```powershell
npm run audit:read-modes
npm run verify:rfib
node tests/browser/dd-mode-browser-check.js
node tests/browser/rmcma-mode-browser-check.js
node tests/browser/rmcsa-mode-browser-check.js
node tests/browser/rop-mode-browser-check.js
node tests/browser/reading-button-system-browser-check.js
node tests/browser/speaking-controller-browser-check.js
node tests/browser/all-modes-settings-check.js
npm run test:read-aloud:v7:browser
npm run test:read-aloud:lifecycle:browser
node tests/browser/read-aloud-check.js
node tests/browser/practice-modes-browser-check.js
node tests/browser/practice-font-browser-check.js
npm run test:difficulty:browser
npx eslint public/js/speaking-practice-controller.js public/js/speaking-practice-adapters.js public/rfib-mode.js
git diff --check
```

Expected artifact: every command exits 0. Separate unrelated environment noise from assertion failures; do not call the work complete if a scoped assertion fails.

**Step 12.2: Write the verification report**

The report must contain:

- commit list by task;
- exact commands and pass/fail counts;
- Chrome viewport matrix;
- screenshot paths;
- delivered semantic role matrix;
- confirmation that stable IDs/listeners remained intact;
- confirmation that adopted and settings nodes restored after repeated mount/unmount;
- confirmation that Read Aloud native playback and lifecycle passed;
- confirmation that Listening `type` was not intentionally restyled;
- dirty-worktree/environment limitations;
- explicit statement that no deployment occurred.

Expected artifact: `docs/audits/ui/2026-08-01-reading-speaking-rfib-ui-verification.md`.

**Step 12.3: Review the report against actual evidence**

Run:

```powershell
Get-Content docs/audits/ui/2026-08-01-reading-speaking-rfib-ui-verification.md
git status --short
git diff --check
```

Expected artifact: report claims match current command output and artifacts; unrelated dirty files are clearly separated.

**Step 12.4: Commit verification evidence**

```powershell
git add -- docs/audits/ui/2026-08-01-reading-speaking-rfib-ui-verification.md
git commit -m "docs: verify RFIB reading and speaking UI"
```

Expected artifact: final evidence commit. Do not push or deploy.

---

## 9. Acceptance checklist

### Reading

- [ ] RFIB Back is slate, Next is purple, Play is blue, Check is green, and Easy Reading is peach.
- [ ] RFIB behavior and audio lifecycle are unchanged.
- [ ] DD has restored Submit, Retry, and Next Question buttons.
- [ ] DD drag/drop and keyboard click-to-place both work.
- [ ] RMCMA retains multiple-answer selection/scoring.
- [ ] RMCSA retains single-answer selection/scoring.
- [ ] ROP arrows preserve direction, state, and responsive glyph behavior.
- [ ] Existing Random toggles work only in modes that already support Random.
- [ ] Picker search, pagination, and close work in all applicable Reading modes.

### Speaking

- [ ] Previous is slate and Next is purple in the shared controller.
- [ ] Every adopted action has the correct declared role.
- [ ] No role metadata leaks after unmount.
- [ ] Basic/Advanced/Settings controls work in every included adapter.
- [ ] Step-scoped actions remain hidden until their mode state permits them.
- [ ] Settings nodes restore to anchors with original inline display.
- [ ] Read Aloud native recorded audio remains visible and functional.
- [ ] Listening `type` retains behavior and is not intentionally redesigned.

### Accessibility and responsive behavior

- [ ] Primary targets are at least 44 px.
- [ ] Compact targets become 44 px at 390 px.
- [ ] Keyboard focus is visible.
- [ ] Disabled controls do not animate or appear actionable.
- [ ] Icon-only controls have accessible names.
- [ ] No nested interactive elements exist.
- [ ] No horizontal overflow at 390 px.
- [ ] Reduced-motion preference disables nonessential transitions.
- [ ] Sheets trap/restore focus and do not allow backdrop pointer leakage.

## 10. Failure and rollback policy

1. Stop at the first failing focused gate; do not accumulate unrelated fixes.
2. Before a task commit, fix forward within task-owned hunks and rerun the focused gate.
3. If a later gate identifies an isolated bad task commit with no dependent commit, use `git revert <commit>` only after confirming the revert touches task-owned changes.
4. If later work depends on the commit or user hunks overlap, create a focused corrective commit instead of reverting.
5. Never use `git reset --hard`, `git checkout --`, or broad file replacement in this dirty checkout.
6. After any correction or revert, rerun the failed test, the complete task gate, and `git diff --check`.

## 11. Execution gate

The scope and product decisions are approved, but this refined plan still requires an explicit implementation command. Execution must proceed task by task with test checkpoints and must stop before any push or deployment.
