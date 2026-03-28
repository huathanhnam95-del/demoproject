# Practice Skill Filter Follow-Up Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Harden the Practice skill-filter launcher so it stays maintainable, accessible, and safe for future Reading/Writing expansion without changing current live-mode behavior.

**Architecture:** Keep launcher cleanup inside `public/script.js` for this phase. Move launcher state into one internal registry, make the skill controls a real button group, keep `window.switchToMode(mode)` as the only public transition API, and version shell assets so new markup and JS cannot drift under service-worker cache.

**Tech Stack:** Static HTML/CSS/JS, Express static serving, Playwright browser regressions, service worker caching.

---

## Context For The Implementer

- The launcher already filters practice cards by skill.
- `Listening` remains the default selected skill.
- `Type` remains the default active mode.
- `Reading` is still placeholder-only.
- `Writing` is still empty-state-only.
- Current tutorials must keep working for supported live modes.
- Legacy lower tabs remain in the DOM and must keep working as callers into the same mode system.
- No new global launcher API should be added in this phase.
- No selected-skill persistence should be added in this phase.
- No new standalone `practice-skill-launcher.js` file should be created in this phase.

Relevant current files and anchors:
- Launcher markup: `public/index.html:1055-1367`
- Reading placeholder / Writing empty state: `public/index.html:1336-1367`
- Legacy lower tabs: `public/index.html:1534-1544`
- Launcher state/constants: `public/script.js:733-822`
- Launcher initialization in dashboard load: `public/script.js:567-579`
- Canonical mode entrypoint: `public/script.js:1069-1245`
- Lazy asset mode loading: `public/script.js:1045-1104`
- Adaptive toggle hook: `public/script.js:9459-9513`
- Browser launcher regression: `tests/browser/practice-modes-browser-check.js`

Service worker facts already confirmed:
- `public/sw.js` caches `/index.html` and `/style.css`
- `public/index.html` loads `style.css` with a version query
- `public/index.html` loads `script.js` without a version query

That means markup/JS drift is a real deployment risk unless this follow-up explicitly versions `script.js` and bumps the service-worker cache version.

## Internal Interface Decisions

Use one internal registry inside `public/script.js` instead of scattered constants:

```js
const PRACTICE_LAUNCHER = {
  defaultSkill: 'listening',
  defaultMode: 'type',
  skills: {
    speaking: {
      label: 'Speaking',
      kind: 'live-skill',
      modeIds: ['speak', 'pronounce', 'read-aloud']
    },
    listening: {
      label: 'Listening',
      kind: 'live-skill',
      modeIds: ['type', 'collo-dictate', 'extended', 'watch', 'notes']
    },
    reading: {
      label: 'Reading',
      kind: 'placeholder-skill',
      placeholderCardId: 'mode-btn-reading'
    },
    writing: {
      label: 'Writing',
      kind: 'empty-skill',
      emptyStateId: 'practice-writing-empty'
    }
  },
  modes: {
    type: { label: 'Type', skill: 'listening', cardId: 'mode-btn-type', panelId: 'mode-type', tabId: 'tab-type', hasTutorial: true, isLive: true, requiresAssets: false },
    'collo-dictate': { label: 'Collo-dictate', skill: 'listening', cardId: 'mode-btn-collo-dictate', panelId: 'mode-collo-dictate', tabId: 'tab-collo-dictate', hasTutorial: false, isLive: true, requiresAssets: false },
    speak: { label: 'Speak', skill: 'speaking', cardId: 'mode-btn-speak', panelId: 'mode-speak', tabId: 'tab-speak', hasTutorial: true, isLive: true, requiresAssets: false },
    pronounce: { label: 'Pronounce', skill: 'speaking', cardId: 'mode-btn-pronounce', panelId: 'mode-pronounce', tabId: 'tab-pronounce', hasTutorial: true, isLive: true, requiresAssets: false },
    extended: { label: 'Fill', skill: 'listening', cardId: 'mode-btn-extended', panelId: 'mode-extended', tabId: 'tab-extended', hasTutorial: true, isLive: true, requiresAssets: false },
    watch: { label: 'Watch', skill: 'listening', cardId: 'mode-btn-watch', panelId: 'mode-watch', tabId: 'tab-watch', hasTutorial: true, isLive: true, requiresAssets: true },
    notes: { label: 'Note', skill: 'listening', cardId: 'mode-btn-notes', panelId: 'mode-notes', tabId: 'tab-notes', hasTutorial: true, isLive: true, requiresAssets: true },
    'read-aloud': { label: 'Read Aloud', skill: 'speaking', cardId: 'mode-btn-read-aloud', panelId: 'mode-read-aloud', tabId: 'tab-read-aloud', hasTutorial: true, isLive: true, requiresAssets: false }
  }
};
```

Use these internal helpers:
- `getLauncherSkillForMode(mode)`
- `getModeMeta(mode)`
- `renderPracticeLauncher()`
- `syncPracticeSkillToMode(mode)`

## Task 1: Lock The Launcher Contract In Tests First

**Files:**
- Modify: `tests/browser/practice-modes-browser-check.js`
- Reference: `public/index.html`
- Reference: `public/script.js`

**Step 1: Extend the browser test with the new launcher contract**

Add assertions for:
- launcher wrapper uses `role="group"` and `aria-label="Practice skills"`
- skill buttons expose `aria-pressed`
- Reading placeholder has no focusable descendants
- Writing empty state appears only for `writing`
- clicking a skill does not change the active mode panel
- programmatic `switchToMode('read-aloud')` still syncs launcher skill to `speaking`
- returning to the Learning Center preserves the current-mode indicator

**Step 2: Run the regression to verify it fails against current semantics**

Run:

```bash
node tests/browser/practice-modes-browser-check.js
```

Expected:
- FAIL because the launcher still uses `role="tablist"`
- FAIL or report missing assertions for placeholder non-interactivity until the refactor is complete

**Step 3: Commit the failing regression**

```bash
git add tests/browser/practice-modes-browser-check.js
git commit -m "test: tighten practice launcher contract"
```

## Task 2: Consolidate Launcher State Into One Registry

**Files:**
- Modify: `public/script.js`

**Step 1: Replace scattered launcher constants**

Remove or absorb these separate structures:
- `PRACTICE_SKILL_ORDER`
- `PRACTICE_SKILL_LABELS`
- `MODE_DISPLAY_NAMES`
- `MODE_TO_SKILL`
- `TUTORIAL_ENABLED_MODES`

Replace them with the single `PRACTICE_LAUNCHER` registry defined above.

**Step 2: Refactor helper functions to read from the registry**

Implement:
- `getLauncherSkillForMode(mode)`
- `getModeMeta(mode)`
- `renderPracticeLauncher()`
- `syncPracticeSkillToMode(mode)`

Rules:
- no duplicated skill or mode label literals outside the registry
- tutorial availability reads from `modeMeta.hasTutorial`
- lazy asset requirement reads from `modeMeta.requiresAssets`
- live vs placeholder vs empty state reads from `skills[*].kind`

**Step 3: Keep the public mode transition unchanged**

Do not change:
- function name `window.switchToMode`
- tab ids
- panel ids
- existing mode strings used by helpers, tutorials, and tests

**Step 4: Run syntax check**

Run:

```bash
node --check public/script.js
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add public/script.js
git commit -m "refactor: centralize practice launcher registry"
```

## Task 3: Fix Skill Filter Semantics And Placeholder Markup

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`
- Modify: `public/script.js`

**Step 1: Replace fake tab semantics**

In `public/index.html`:
- change the launcher wrapper from `role="tablist"` to `role="group"`
- keep `aria-label="Practice skills"`
- keep the controls as real `<button>` elements
- keep `aria-pressed` as the selected-state attribute

**Step 2: Make Reading placeholder fully non-interactive**

In `public/index.html`:
- remove any nested live button from the Reading placeholder
- replace it with a styled non-button element that looks like the current CTA
- ensure the card itself is not keyboard focusable

In `public/style.css`:
- add or update a selector for `.card-cta.is-disabled` so the placeholder still looks deliberate

**Step 3: Keep Writing empty state declarative**

Keep:
- one dedicated empty-state block
- visibility controlled only by `renderPracticeLauncher()`
- `hidden` as the primary state mechanism
- `aria-hidden` synced with visibility

**Step 4: Update the current-mode indicator tutorial behavior to be registry-driven**

In `public/script.js`:
- show the tutorial pill button only when `modeMeta.hasTutorial` is true
- remove hard-coded tutorial mode lists outside the registry

**Step 5: Run browser regression**

Run:

```bash
node tests/browser/practice-modes-browser-check.js
```

Expected:
- PASS for launcher semantics and placeholder assertions

**Step 6: Commit**

```bash
git add public/index.html public/style.css public/script.js tests/browser/practice-modes-browser-check.js
git commit -m "fix: normalize practice launcher semantics"
```

## Task 4: Untangle Launcher Rendering From Mode-Switch Side Effects

**Files:**
- Modify: `public/script.js`

**Step 1: Make launcher rendering one explicit internal operation**

Create a single internal render path:
- `renderPracticeLauncher()`

It must be responsible for:
- skill button pressed-state
- live card visibility
- Reading placeholder visibility
- Writing empty-state visibility

No other function should manually toggle those DOM nodes.

**Step 2: Restrict mode-switch side effects**

`window.switchToMode(mode)` may:
- sync selected skill via `syncPracticeSkillToMode(mode)`
- update the active mode indicator
- load assets
- show or hide mode panels

It must not:
- directly manipulate Reading placeholder visibility
- directly manipulate Writing empty-state visibility
- hard-code skill-specific card show/hide branches

**Step 3: Keep dashboard panel re-entry stable**

When toggling back to the Learning Center:
- call `renderPracticeLauncher()`
- call `updateCurrentModeIndicator(currentActiveMode)`
- do not override the selected skill unless a real mode switch occurred

**Step 4: Run focused regression checks**

Run:

```bash
node tests/browser/practice-modes-browser-check.js
node tests/recommendation-notes-regression.test.js
node tests/recommendation-extended-regression.test.js
```

Expected:
- PASS
- helper-driven and lazy-loaded modes remain stable

**Step 5: Commit**

```bash
git add public/script.js tests/browser/practice-modes-browser-check.js
git commit -m "refactor: isolate practice launcher rendering"
```

## Task 5: Lock Launcher And Legacy Tabs To One Authority

**Files:**
- Modify: `public/script.js`
- Optional Modify: `public/index.html` only if comments or attributes help clarify ownership

**Step 1: Document the ownership rule in code comments**

Near `window.switchToMode(mode)`, add a short comment explaining:
- the launcher is a filtered shell
- legacy tab buttons and helper flows are callers
- launcher skill state must derive from real mode transitions

**Step 2: Normalize all internal callers**

Review and keep working:
- helper modal start-learning flow
- legacy lower tab flow
- direct browser/test `switchToMode(...)` calls
- dashboard re-entry path

Ensure all these paths still resolve through `window.switchToMode(mode)` and do not introduce separate launcher-only state changes except for skill-filter clicks.

**Step 3: Verify read-aloud and Smart Jump are not regressed**

Run:

```bash
node tests/smart-jump-race-regression.test.js
node tests/read-aloud-mode-regression.test.js
```

Expected:
- PASS
- launcher cleanup does not disturb already-fixed async mode loading

**Step 4: Commit**

```bash
git add public/script.js
git commit -m "docs: clarify practice launcher ownership"
```

## Task 6: Add Asset Versioning And Service-Worker Safety

**Files:**
- Modify: `public/index.html`
- Modify: `public/sw.js`

**Step 1: Version `script.js` explicitly**

Update the module script tag in `public/index.html` from:

```html
<script type="module" src="script.js"></script>
```

to a versioned URL such as:

```html
<script type="module" src="script.js?v=20260327_practice_launcher_cleanup"></script>
```

Use the same version-token style already used for `style.css`.

**Step 2: Bump `style.css` version query if launcher markup or styles changed**

Update the `style.css?v=...` token in `public/index.html` to a new value for this launcher cleanup release.

**Step 3: Bump service-worker cache version**

Update `CACHE_VERSION` in `public/sw.js` from `bel-offline-v7` to the next version.

**Step 4: Re-run browser regression on a fresh context**

Run:

```bash
node tests/browser/practice-modes-browser-check.js
```

Expected:
- PASS
- no stale shell mismatch between HTML, CSS, and JS

**Step 5: Commit**

```bash
git add public/index.html public/sw.js tests/browser/practice-modes-browser-check.js
git commit -m "fix: version practice launcher shell assets"
```

## Task 7: Final Verification Sweep

**Files:**
- No new code changes expected

**Step 1: Run the full launcher-related verification set**

Run:

```bash
node --check public/script.js
node tests/browser/practice-modes-browser-check.js
node tests/recommendation-notes-regression.test.js
node tests/recommendation-extended-regression.test.js
node tests/smart-jump-race-regression.test.js
node tests/read-aloud-mode-regression.test.js
```

Expected:
- all commands exit successfully

**Step 2: Manual smoke checklist**

Check in browser:
- default load shows Listening and Type
- clicking Speaking filters to Speak / Pronounce / Read Aloud only
- clicking Reading shows placeholder only
- clicking Writing shows empty state only
- clicking a skill does not change the active mode
- helper modal mode entry keeps launcher skill in sync
- returning from another dashboard panel keeps launcher and current-mode pill correct

**Step 3: Commit final polish if needed**

```bash
git add public/index.html public/script.js public/style.css public/sw.js tests/browser/practice-modes-browser-check.js
git commit -m "chore: finalize practice launcher cleanup"
```

## Test Cases And Scenarios

### Core Launcher Flow
- First load: `Listening` selected, `Type` active
- Skill click only filters cards
- `switchToMode('read-aloud')` selects `Speaking`
- `switchToMode('type')` returns launcher to `Listening`

### Placeholder / Empty-State
- `Reading` shows only the placeholder card
- Reading placeholder has no focusable child controls
- `Writing` shows only the empty state
- Neither Reading nor Writing can open a mode or tutorial

### Cross-Panel Behavior
- Leave Learning Center for another dashboard panel and return
- current-mode indicator remains accurate
- selected skill remains coherent with active mode unless the user explicitly changed the filter

### Helper / Legacy Entry Paths
- helper modal recommended mode entry works
- lower legacy tabs still work
- direct programmatic `switchToMode(...)` still works
- lazy-loaded modes (`watch`, `notes`) still enter correctly

### Regression Risk Areas
- tutorial affordance only shown for supported modes
- no markup/JS drift under service-worker caching
- no launcher state drift after Smart Jump or other async question loads
- no new global API surface added

## Edge Cases

- User selects `Writing` while `Type` remains the active mode below
- User selects `Reading` then code programmatically switches to `read-aloud`
- Launcher filter state differs from the active mode because no real switch happened yet
- Hidden active card is not visible in the filtered list, but the current-mode pill must remain truthful
- `collo-dictate` remains live but tutorial-less
- `watch` or `notes` fail asset loading; launcher should stay stable and the selected skill should not become corrupted
- Service worker serves stale `index.html` or `script.js`
- Future Reading live mode is added without rewriting the skill-selection logic
- Future Writing live mode is added without reintroducing hard-coded branches

## Assumptions And Defaults

- Save the plan under `docs/plans/` because that is the repo’s established planning location.
- Keep the cleanup inside `public/script.js` for this phase.
- Do not persist selected skill yet.
- Do not implement a live Reading or Writing mode yet.
- Preserve the current visual design except for semantic and accessibility cleanup.
- Existing tutorial coverage remains unchanged; only visibility rules are cleaned up.
- Existing tab ids, panel ids, and mode strings remain stable for compatibility.
