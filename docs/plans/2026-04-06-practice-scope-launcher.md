# English vs PTE Practice (Scope-Aware Launcher) Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Add a Practice-scope toggle (**English Practice** = current behavior, **PTE Practice** = different launcher grouping/labels) without changing any existing mode engines, question banks, or practice flows.

**Architecture:** Reuse the existing launcher (`PRACTICE_LAUNCHER`, `renderPracticeLauncher()`, `switchToMode()`) and add a **scope-aware mode metadata resolver** that:

1) keeps English metadata as the default, and  
2) overlays PTE-only label/skill/visibility overrides.  
All UI that depends on `mode -> {label, skill, visibility}` reads through the resolver so "relocation" (e.g., `notes` -> Speaking in PTE) stays consistent everywhere (cards, active-skill sync, current-mode indicator, and "Help me choose a mode" modal).

**Tech Stack:** Vanilla JS (`public/script.js`), static HTML/CSS (`public/index.html`, `public/style.css`), Playwright harness (`tests/browser`).

---

## Summary (decision complete)

### English Practice (no changes)

- Current launcher stays exactly as-is.

### PTE Practice (launcher-only changes)

- **Speaking:** `read-aloud` (Read Aloud), `speak` (**Repeat Sentence**), `notes` (**Retell Lecture**)
- **Listening:** `extended` (Fill In the Blanks), `type` (**Write from Dictation**)
- **Reading:** `rfib` (Dropdown) (same)
- **Writing:** unchanged empty state
- **Hidden:** `pronounce`, `collo-dictate`, `watch` (and any future modes unless explicitly added to the PTE allowlist)

---

## Task 1: Add a failing browser check for scope toggle + relocation

**Files:**

- Create: `tests/browser/practice-scope-toggle-browser-check.js`

**Step 1: Implement a Playwright harness test (copy pattern from `tests/browser/practice-launcher-clickpath-browser-check.js`)**

- Setup: same express static server + overlay dismissal helpers.
- Assertions:
  1. Default scope is English (toggle shows English pressed/active).
  2. In English:
     - Listening selected on load.
     - `mode-btn-notes` is under Listening (visible when Listening selected, hidden when Speaking selected).
     - Card titles match current ("Repeat", "Dictate", "Take Notes").
  3. Toggle to PTE:
     - Speaking selected: only `read-aloud`, `speak`, `notes` cards visible.
     - Listening selected: only `extended`, `type` cards visible.
     - Titles swap: "Repeat Sentence", "Retell Lecture", "Write from Dictation".
  4. Click `notes` in PTE and assert:
     - Speaking remains selected (relocation works).
     - `#mode-notes` becomes active panel.
     - Current-mode indicator shows "Retell Lecture".
  5. Switch back to English:
     - Titles revert.
     - `notes` is back under Listening grouping.

**Step 2: Run to confirm it fails before implementation**

- Run: `node tests/browser/practice-scope-toggle-browser-check.js`
- Expected: FAIL (scope toggle absent; relocation/labels not implemented).

---

## Task 2: Add scope toggle UI (no inline handlers; no CSS collisions)

**Files:**

- Modify: `public/index.html`
- Modify: `public/style.css`

**Step 1: Add HTML inside `#panel-tutorials`, immediately above `#practice-skill-filter`**

Use dedicated classes (do **not** reuse `.segmented-btn`, which is used by the dashboard segmented control logic):

```html
<div class="practice-scope-filter" id="practice-scope-filter" role="group" aria-label="Practice scope">
  <button type="button" class="practice-scope-btn" data-practice-scope="english" aria-pressed="true">
    English Practice
  </button>
  <button type="button" class="practice-scope-btn" data-practice-scope="pte" aria-pressed="false">
    PTE Practice
  </button>
</div>
```

**Edge-case solution (dashboard collision):** `toggleDashboardPanel()` queries all `.segmented-btn`. Keeping the scope toggle on `.practice-scope-btn` prevents accidental activation/deactivation.

**Step 2: Add CSS matching current pill style**

- In `public/style.css`, add `.practice-scope-filter` and `.practice-scope-btn` styles by mirroring `.practice-skill-filter`/`.practice-skill-btn` (same rounded-pill look and `is-active` gradient).

---

## Task 3: Add encapsulated scope state (no namespace pollution) + persistence

**Files:**

- Modify: `public/script.js`

**Step 1: Store scope in the existing app state object**
`public/script.js` already uses `window.appState` (e.g., `window.appState.currentMode`). Extend it:

- Key: `window.appState.practiceScope`
- Allowed values: `'english' | 'pte'`
- Storage: `localStorage['practiceScope']`
- Define constants to avoid magic strings:
  - `const SCOPE_ENGLISH = 'english';`
  - `const SCOPE_PTE = 'pte';`
  - `const VALID_SCOPES = new Set([SCOPE_ENGLISH, SCOPE_PTE]);`
  - Use these constants everywhere instead of raw string literals.

Initialization (near the launcher config):

1. `window.appState = window.appState || {}`
2. `window.appState.practiceScope = safeReadLocalStorage('practiceScope') || 'english'`
3. If the stored value is invalid, fall back to `'english'`.

**Step 2: Provide a small public API**

- `function getPracticeScope()`
- `function setPracticeScope(scope, { persist = true } = {})`

`setPracticeScope()` must:

1. Validate scope (`'english'` or `'pte'`), else ignore.
2. No-op if scope unchanged.
3. Persist to localStorage when requested.
4. Call modular UI updates (Task 5).
5. Handle the "hidden active mode" edge case (Task 6).

Expose:

- `window.setPracticeScope = setPracticeScope`
- (Optional) `window.getPracticeScope = getPracticeScope`

---

## Task 4: Define PTE overrides schema with safe defaults (future-proof)

**Files:**

- Modify: `public/script.js`

**Step 1: Keep `PRACTICE_LAUNCHER` as the English source of truth**
Do not rename existing properties and do not change English labels/skills.

**Step 2: Add a strict PTE allowlist + per-mode overrides**

Define near `PRACTICE_LAUNCHER`:

- `const PTE_LAUNCHER_VISIBLE_MODES = new Set(['read-aloud', 'speak', 'notes', 'extended', 'type', 'rfib']);`
- `const PRACTICE_SCOPE_OVERRIDES = { [SCOPE_PTE]: { modes: { ... }}}`

> **Design note (scalability):** The `PRACTICE_SCOPE_OVERRIDES` keying by scope constant means adding a future scope (e.g., IELTS) only requires a new constant + a new key in this object — no structural changes to the resolver or allowlist pattern.

Override table (only deltas):

- `speak`: `{ label: 'Repeat Sentence' }`
- `notes`: `{ label: 'Retell Lecture', skill: 'speaking' }`
- `type`: `{ label: 'Write from Dictation' }`

**Default/fallback rules (explicit)**

- English scope:
  - Visibility uses the existing `launcherVisible !== false` check (as today).
  - Label/skill are from the base meta (as today).
- PTE scope:
  - A mode is visible in the launcher **only** if it is in `PTE_LAUNCHER_VISIBLE_MODES` AND `launcherVisible !== false`.
  - If a mode is in the allowlist but has no override entry, base label/skill are used (safe default).
  - Any future modes added to `PRACTICE_LAUNCHER` are **hidden in PTE** by default until explicitly allowlisted.

This removes the "undefined property" ambiguity and prevents accidental leakage of new modes into PTE.

**Step 3: Add resolver helpers**
Implement:

- `function getResolvedModeMeta(mode, scope = getPracticeScope())`
  - Base: `PRACTICE_LAUNCHER.modes[mode] || null`
  - If no base meta: return `null`
  - **Clone before merge:** `const resolved = structuredClone(baseMeta);` then `Object.assign(resolved, scopeOverrides)` — this prevents accidental mutation of `PRACTICE_LAUNCHER`.
- `function isModeVisibleInScope(mode, scope = getPracticeScope())`
  - English: `meta.launcherVisible !== false`
  - PTE: `PTE_LAUNCHER_VISIBLE_MODES.has(mode) && meta.launcherVisible !== false`

Update existing helpers to use the resolver:

- `getModeMeta()`, `getSkillForMode()`, `getModeDisplayName()`

---

## Task 5: Modularize scope-driven UI updates (council point #4)

**Files:**

- Modify: `public/script.js`

Create small functions so `setPracticeScope()` does not directly "do everything":

- `function updatePracticeScopeToggleUI()`:
  - Finds `#practice-scope-filter` buttons and sets:
    - `is-active` class
    - `aria-pressed`
- `function updatePracticeLauncherUI()`:
  - Calls `renderPracticeLauncher()` (existing) and ensures card titles/ARIA are updated (Task 7).
- `function updatePracticeScopeUI()`:
  - Calls `updatePracticeScopeToggleUI()`
  - Calls `updatePracticeLauncherUI()`
  - Calls `updateCurrentModeIndicator(currentActiveMode)` (safe even if unchanged)

Then `setPracticeScope()` becomes:

1. set state (+ persist)
2. resolve edge case (Task 6)
3. call `updatePracticeScopeUI()`

---

## Task 6: Edge case — switching scope while an English-only mode is active

**Files:**

- Modify: `public/script.js`

**Problem:** User is in `pronounce` (or another hidden-in-PTE mode) and switches to PTE. Without a policy, the active mode stays running but disappears from the launcher, confusing users and breaking "relocation" logic.

**Decision:** If the active mode is not visible in the target scope, auto-switch to `read-aloud`.

Implementation in `setPracticeScope('pte')`:

- If `currentActiveMode` is truthy and `isModeVisibleInScope(currentActiveMode, 'pte') === false`, call `window.switchToMode('read-aloud')` after scope state is set (so the indicator/skill sync use PTE meta).

English->PTE is the critical path; PTE->English can keep the current mode as-is.

---

## Task 7: Make launcher rendering + skill sync fully scope-aware (core relocation fix)

**Files:**

- Modify: `public/script.js`

**Step 1: Wire scope toggle listeners (no inline handlers)**
In `DOMContentLoaded`, find `#practice-scope-filter` and attach `click` listeners:

- `setPracticeScope(button.dataset.practiceScope)`

**Step 2: Update `renderPracticeLauncher()` card logic**
Current code uses `card.dataset.practiceSkill` to group cards. This breaks PTE relocation because HTML still says `notes` is Listening.

Change the card loop to:

1. Parse mode from card id (`mode-btn-<mode>`).
2. `const modeMeta = getResolvedModeMeta(mode)`
3. `const shouldShow = !!modeMeta && isModeVisibleInScope(mode) && modeMeta.skill === selectedPracticeSkill`
4. Set `card.hidden`, `aria-hidden`.
5. Update:
   - `card.querySelector('.card-body h3')` text to `modeMeta.label`
   - `card.setAttribute('aria-label', \`\${modeMeta.label} Practice mode\`)` (or preserve existing phrasing)

**Step 3: Fix "selected skill follows mode"**
`syncSelectedSkillToMode(mode)` must use `getSkillForMode(mode)` which must be scope-aware (resolved meta), so clicking `notes` in PTE keeps **Speaking** selected.

**Step 4: Fix the "active mode panel belongs to selected skill tab" logic**
Current code checks `PRACTICE_LAUNCHER.skills[selectedPracticeSkill].modeIds`. That becomes incorrect when scope remaps a mode’s skill.

Replace with:

- `const activeModeSkill = getSkillForMode(currentActiveMode)`
- Consider the panel "belongs" if `activeModeSkill === selectedPracticeSkill`

This prevents hiding the active `notes` panel when PTE Speaking is selected.

---

## Task 8: Make the "Help me choose a mode" modal scope-aware (edge case)

**Files:**

- Modify: `public/script.js`

In `handleGoalSubmit`:

1. When building `suggestions`, skip any mode where `isModeVisibleInScope(mode) === false`.
2. If filtering yields zero suggestions (e.g., accent goal in PTE where `pronounce` is hidden), fallback to:
   - mode: `read-aloud`
   - name: `getModeDisplayName('read-aloud')`
   - description: "Recommended in this practice scope."

This avoids an empty suggestion list and keeps the flow usable in PTE.

---

## Task 9: Scaffold future divergent behavior (Retell Lecture follow-up recording)

**Files:**

- Modify: `public/script.js`
- Modify: `public/take-notes-mode.js`

**Step 1: Add a neutral hook registry**
In `public/script.js`:

- `window.practiceVariantHooks = { english: {}, pte: { notes: {} } }`
- `window.getPracticeVariantHooks = (mode) => window.practiceVariantHooks?.[getPracticeScope()]?.[mode] || null`

**Step 2: Add a safe hook call in Take Notes submission**
In `public/take-notes-mode.js`, at the end of `submitNotes()` (after saving progress), call:

- `window.getPracticeVariantHooks?.('notes')?.afterSubmit?.({ entryId: String(currentEntry?.id || ''), userNotes })`

No hook is defined today, so English + PTE remain unchanged; future PTE work can add a timed recording follow-up without touching the English flow.

---

## Verification Plan

### Automated

1. Run: `node tests/browser/practice-launcher-clickpath-browser-check.js`
   - Expected: PASS (English unchanged).
2. Run: `node tests/browser/practice-scope-toggle-browser-check.js`
   - Expected: PASS.

### Manual (Chrome only)

1. Load `public/index.html` and confirm default scope is English and UI matches current.
2. Toggle PTE and verify:
   - Speaking: Read Aloud, Repeat Sentence, Retell Lecture
   - Listening: Fill In the Blanks, Write from Dictation
   - Reading: Dropdown; Writing empty state unchanged
3. While in `pronounce`, toggle to PTE and confirm it auto-switches to `read-aloud`.
4. No console errors during toggling, mode switching, and help modal usage.

---

## Assumptions / Defaults

- Default scope: `english`
- Scope persistence: `localStorage['practiceScope']`
- PTE launcher is an allowlist subset; future modes are hidden in PTE unless allowlisted.
