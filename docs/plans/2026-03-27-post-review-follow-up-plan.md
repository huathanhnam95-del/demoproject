# Post-Review Follow-Up Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining confirmed post-review defects, align the `difficulty_filter` contract across layers, and start the highest-value coverage work without mixing unrelated subsystems.

**Architecture:** Execute this in two phases. Phase 1 closes confirmed user-facing/security defects and restores contract alignment. Phase 2 adds direct automated coverage for the highest-risk under-tested modules identified in the review backlog. Assume `difficulty_filter` remains an active product requirement because the server catalog and current spec still define it; if product explicitly retires it, replace Task 1 with a coordinated removal plan before touching code.

**Tech Stack:** Vanilla browser JavaScript, Firebase/Cloud Functions Node handlers, Node built-in test harness (`node`, `node:test`, `assert`), Playwright/browser checks only if source-level regression tests are insufficient.

---

### Task 1: Restore `difficulty_filter` Frontend Contract

**Files:**
- Create: `tests/difficulty-filter-contract.test.mjs`
- Modify: `public/js/modules/level-system.js`
- Modify: `public/js/skill-catalog.js`
- Test: `tests/difficulty-filter-migration.test.mjs`
- Reference: `functions/src/skillCatalog.js`
- Reference: `docs/specs/journey-skill-tree-filters-and-unlocks.md`

**Step 1: Write the failing contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('difficulty_filter exists in the frontend skill catalog and level tree', () => {
  const levelSystem = read('public/js/modules/level-system.js');
  const catalog = read('public/js/skill-catalog.js');

  assert.match(levelSystem, /difficulty_filter/);
  assert.match(catalog, /difficulty_filter/);
});
```

**Step 2: Run test to verify it fails**

Run: `node tests/difficulty-filter-contract.test.mjs`
Expected: FAIL because the current frontend tree no longer includes `difficulty_filter`.

**Step 3: Restore the minimal frontend contract**

Implement all of the following:

```js
const LEGACY_MODE_SKILL_UNLOCKS = {
  length_filter: 'lengthFilter',
  difficulty_filter: 'difficultyFilter'
};

const BRANCH_LAYOUT = {
  listening: ['length_filter', 'difficulty_filter', 'slow_audio', /* ... */]
};
```

Also restore the matching icon, layout point, and edge entries in `public/js/modules/level-system.js`, and add the `difficulty_filter` passive definition back into `public/js/skill-catalog.js` so the client catalog matches `functions/src/skillCatalog.js`.

**Step 4: Run tests to verify the contract**

Run: `node tests/difficulty-filter-contract.test.mjs`
Expected: PASS

Run: `node tests/difficulty-filter-migration.test.mjs`
Expected: PASS

**Step 5: Run syntax verification**

Run: `node --check public/js/modules/level-system.js`
Expected: exit 0

Run: `node --check public/js/skill-catalog.js`
Expected: exit 0

**Step 6: Commit**

```bash
git add tests/difficulty-filter-contract.test.mjs public/js/modules/level-system.js public/js/skill-catalog.js
git commit -m "fix: restore difficulty filter skill-tree contract"
```

### Task 2: Close The Remaining `VocabularyBook` Render Sink

**Files:**
- Create: `tests/vocab-book-rendering.test.js`
- Modify: `public/vocab-book.js`

**Step 1: Write the failing regression test**

Use a source-shape regression first, since the repo does not currently depend on jsdom:

```js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(process.cwd(), 'public/vocab-book.js'), 'utf8');

assert(source.includes('escapeHtml(w.originalWord)'), 'Improving list must escape originalWord.');
assert(!source.includes('${w.originalWord}</span>'), 'Improving list must not inject raw originalWord.');

console.log('vocab-book rendering regression passed');
```

**Step 2: Run test to verify it fails**

Run: `node tests/vocab-book-rendering.test.js`
Expected: FAIL because the improving list still interpolates `w.originalWord` directly.

**Step 3: Patch the render path**

In `renderImprovingWords()`, change the raw interpolation to escaped output:

```js
<span class="vocab-word-text">${escapeHtml(w.originalWord)}</span>
```

Keep the rest of the list structure unchanged.

**Step 4: Run verification**

Run: `node tests/vocab-book-rendering.test.js`
Expected: PASS

Run: `node --check public/vocab-book.js`
Expected: exit 0

**Step 5: Commit**

```bash
git add tests/vocab-book-rendering.test.js public/vocab-book.js
git commit -m "fix: escape vocab improving-list entries"
```

### Task 3: Remove Legacy `WatchMode` Unsafe Branches

**Files:**
- Create: `tests/watch-mode-rendering.test.js`
- Modify: `public/watch-mode.js`

**Step 1: Write the failing regression test**

```js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(process.cwd(), 'public/watch-mode.js'), 'utf8');

assert(!source.includes('onclick="WatchMode.selectVideo'), 'Legacy inline video card handler must be removed.');
assert(!source.includes('onclick="WatchMode.selectMCOption'), 'Legacy inline MC option handler must be removed.');
assert(!source.includes('onclick="WatchMode.seekToQuestion'), 'Legacy inline question marker handler must be removed.');

console.log('watch-mode rendering regression passed');
```

**Step 2: Run test to verify it fails**

Run: `node tests/watch-mode-rendering.test.js`
Expected: FAIL because legacy template branches still exist below early returns.

**Step 3: Remove the dead legacy branches**

Delete the unreachable template-string blocks that start after the early `return` statements in:
- `renderVideoGrid()`
- `renderMCOptions()`
- `renderQuestionMarkers()`

Do not change the current safe DOM-based implementations.

**Step 4: Run verification**

Run: `node tests/watch-mode-rendering.test.js`
Expected: PASS

Run: `node --check public/watch-mode.js`
Expected: exit 0

**Step 5: Commit**

```bash
git add tests/watch-mode-rendering.test.js public/watch-mode.js
git commit -m "chore: remove legacy watch mode render branches"
```

### Task 4: Add Direct Node Coverage For `DictionaryService` And `LevelSystem`

**Files:**
- Create: `tests/dictionary-service.test.mjs`
- Create: `tests/level-system-contract.test.mjs`
- Modify: `public/dictionary-service.js` only if a small pure helper export/test seam is required
- Modify: `public/js/modules/level-system.js` only if a small pure helper export/test seam is required

**Step 1: Write the failing dictionary tests**

Cover these cases with small, pure tests:

```js
test('initCaches ignores expired entries', () => { /* ... */ });
test('tracauInFlight dedupes concurrent requests', async () => { /* ... */ });
test('upgradeInFlight dedupes cache-upgrade jobs', async () => { /* ... */ });
```

**Step 2: Run test to verify it fails**

Run: `node tests/dictionary-service.test.mjs`
Expected: FAIL because the helper seam or harness does not exist yet.

**Step 3: Write the failing level-system tests**

Cover these cases:

```js
test('difficulty_filter follows length_filter in listening branch', () => { /* ... */ });
test('multi-parent availability unlocks when any parent is owned', () => { /* ... */ });
test('legacy difficultyFilter unlock maps to difficulty_filter', () => { /* ... */ });
```

**Step 4: Run test to verify it fails**

Run: `node tests/level-system-contract.test.mjs`
Expected: FAIL until the harness and restored contract are in place.

**Step 5: Implement the smallest test seam**

If needed, expose pure helpers behind a narrow test hook such as:

```js
window.LevelSystem.__test = {
  hasUnlockedSkill,
  getNodeState
};
```

Prefer zero behavior changes. Do not refactor rendering beyond what is needed for test access.

**Step 6: Run verification**

Run: `node tests/dictionary-service.test.mjs`
Expected: PASS

Run: `node tests/level-system-contract.test.mjs`
Expected: PASS

Run: `node --check public/dictionary-service.js`
Expected: exit 0

Run: `node --check public/js/modules/level-system.js`
Expected: exit 0

**Step 7: Commit**

```bash
git add tests/dictionary-service.test.mjs tests/level-system-contract.test.mjs public/dictionary-service.js public/js/modules/level-system.js
git commit -m "test: add dictionary and level system regression coverage"
```

### Task 5: Add Deterministic Survival Runtime Seams Before Deep Gameplay Tests

**Files:**
- Create: `tests/survival-runtime.test.mjs`
- Modify: `public/js/survival-game/SurvivalGame.js`
- Modify: `public/js/survival-game/EntityManager.js`
- Reference: `tests/survival-balance.test.mjs`
- Reference: `tests/survival-config-balance.test.mjs`
- Reference: `tests/survival-modal-input.test.mjs`

**Step 1: Write the failing runtime test**

Start with one deterministic scenario:

```js
test('wave timer rollover increments wave and schedules next spawn deterministically', () => {
  // fake clock + fixed RNG + predictable scheduler
});
```

**Step 2: Run test to verify it fails**

Run: `node tests/survival-runtime.test.mjs`
Expected: FAIL because the runtime does not yet expose deterministic seams.

**Step 3: Add minimal seams**

Allow injection of:

```js
const now = options?.now || (() => performance.now());
const rng = options?.rng || Math.random;
const raf = options?.raf || window.requestAnimationFrame.bind(window);
```

Thread them only where needed for timer and spawn determinism.

**Step 4: Run verification**

Run: `node tests/survival-runtime.test.mjs`
Expected: PASS

Run: `node tests/survival-balance.test.mjs`
Expected: PASS

Run: `node tests/survival-config-balance.test.mjs`
Expected: PASS

Run: `node tests/survival-modal-input.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/survival-runtime.test.mjs public/js/survival-game/SurvivalGame.js public/js/survival-game/EntityManager.js
git commit -m "test: add deterministic survival runtime seam"
```

## Deferred After Task 5

- Add a second `WatchMode` regression around workbook freshness and service-worker caching.
- Add browser-level hostile-entry coverage for `VocabularyBook` if source-shape regressions prove too weak.
- Add direct SRS review restore/offline regression coverage in a follow-up plan once the above defects are closed.

