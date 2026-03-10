# Manual Mode Recommendations Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Add a deterministic `Recommended` jump to manual question selection for Type, Speak, Fill (`extended`), and Notes, while preserving the current manual/adaptive behavior and all existing filters.

**Architecture:** Build a shared local recommendation helper that indexes each mode's question text and scores only the currently visible dropdown candidates by difficulty fit, vocabulary continuity, and recent-repeat penalty. Integrate that helper into `public/script.js` for Type/Speak/Fill and into `public/take-notes-mode.js` for Notes, with a small per-mode UI surface that exposes a `Recommended` button and a generic explanation label.

**Tech Stack:** Plain HTML/CSS/JS, existing `DifficultyManager` and `DifficultyFilter`, `localStorage` for lightweight per-session state, Node `assert` tests in `tests/`, existing browser script loading from `public/index.html`.

---

**Path convention:** Shared browser helpers live in `public/js/`; main practice-mode integration stays in `public/script.js`; Notes integration stays in `public/take-notes-mode.js`; lightweight Node tests live in `tests/`; design/spec updates stay in `docs/plans/` or `docs/specs/`.

### Task 1: Shared Recommendation Engine

**Files:**
- Create: `public/js/question-recommendation-engine.js`
- Test: `tests/question-recommendation-engine.test.mjs`

**Step 1: Write the failing engine test**

Create `tests/question-recommendation-engine.test.mjs` with assertions for:

```js
import assert from 'node:assert/strict';
import {
  mapCefrToQuestionLevel,
  createQuestionRecommendationEngine
} from '../public/js/question-recommendation-engine.js';

assert.equal(mapCefrToQuestionLevel(1), 1);
assert.equal(mapCefrToQuestionLevel(4), 2);
assert.equal(mapCefrToQuestionLevel(6), 3);

const engine = createQuestionRecommendationEngine({
  recentWindowSize: 3
});

const items = [
  { id: 101, level: 2, correctSentence: 'Public policy shapes media debate.' },
  { id: 102, level: 2, correctSentence: 'Media policy affects public trust.' },
  { id: 103, level: 3, correctSentence: 'Quantum mechanics confuses many students.' }
];

const index = engine.buildIndex('type', items);

const recommendation = engine.recommendNext({
  mode: 'type',
  currentQuestionId: 101,
  visibleQuestionIds: [101, 102, 103],
  currentCefrLevel: 4,
  recentQuestionIds: [100],
  index
});

assert.equal(recommendation.nextQuestionId, 102);
assert.equal(recommendation.reasonCode, 'level_and_continuity');

const repeatPenalty = engine.recommendNext({
  mode: 'type',
  currentQuestionId: 101,
  visibleQuestionIds: [101, 102, 103],
  currentCefrLevel: 4,
  recentQuestionIds: [102, 104, 105],
  index
});

assert.equal(repeatPenalty.nextQuestionId, 103);
assert.ok(['difficulty_only', 'fallback'].includes(repeatPenalty.reasonCode));
```

**Step 2: Run test to verify it fails**

Run: `node tests/question-recommendation-engine.test.mjs`

Expected: FAIL with `Cannot find module '../public/js/question-recommendation-engine.js'` or missing export errors.

**Step 3: Write minimal implementation**

Create `public/js/question-recommendation-engine.js` with:

- named exports for:
  - `mapCefrToQuestionLevel`
  - `createQuestionRecommendationEngine`
- a browser-global assignment:
  - `window.QuestionRecommendationEngine = { mapCefrToQuestionLevel, createQuestionRecommendationEngine }`
- engine helpers for:
  - text extraction per mode
  - token normalization
  - stopword-safe overlap scoring
  - deterministic difficulty scoring
  - recent-repeat penalty
- a `reasonCode` enum such as:
  - `level_and_continuity`
  - `difficulty_only`
  - `continuity_only`
  - `fallback`

Implementation constraints:

- Do not depend on network calls.
- Do not emit user-facing labels from the engine.
- Ignore candidates not present in `visibleQuestionIds`.
- Exclude the current question unless there are no other valid candidates.
- Default missing item `level` to `1`.

**Step 4: Run test to verify it passes**

Run: `node tests/question-recommendation-engine.test.mjs`

Expected: PASS with a final log line such as `question recommendation engine tests passed`.

**Step 5: Commit**

```bash
git add tests/question-recommendation-engine.test.mjs public/js/question-recommendation-engine.js
git commit -m "feat: add shared question recommendation engine"
```

### Task 2: Recommendation UI Surface

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`
- Test: `tests/recommendation-ui-shape.test.js`

**Step 1: Write the failing UI-shape test**

Create `tests/recommendation-ui-shape.test.js` with assertions like:

```js
const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/style.css', 'utf8');

[
  'recommended-btn-type',
  'recommended-btn-speak',
  'recommended-btn-extended',
  'recommended-btn-notes',
  'recommendation-summary-type',
  'recommendation-summary-speak',
  'recommendation-summary-extended',
  'recommendation-summary-notes'
].forEach((id) => assert(html.includes(id), `${id} missing from index.html`));

assert(css.includes('.recommended-jump-btn'));
assert(css.includes('.recommendation-summary'));
```

**Step 2: Run test to verify it fails**

Run: `node tests/recommendation-ui-shape.test.js`

Expected: FAIL because the new ids and classes do not exist yet.

**Step 3: Write minimal implementation**

Modify `public/index.html` to add, for each mode:

- a `Recommended` button:
  - `recommended-btn-type`
  - `recommended-btn-speak`
  - `recommended-btn-extended`
  - `recommended-btn-notes`
- a summary container:
  - `recommendation-summary-type`
  - `recommendation-summary-speak`
  - `recommendation-summary-extended`
  - `recommendation-summary-notes`

Placement rules:

- Type/Speak/Fill: place inside the existing question-selection area, close to the current dropdown/navigation controls.
- Notes: place inside the existing question-selection area without adding a new manual/adaptive toggle.

Modify `public/style.css` to add:

- `.recommendation-controls`
- `.recommended-jump-btn`
- `.recommended-jump-btn:disabled`
- `.recommendation-summary`
- `.recommendation-summary.is-hidden`

UI behavior constraints:

- Summary copy must stay generic.
- Do not show shared words explicitly.
- Keep the new controls visually secondary to Play/Check actions.

**Step 4: Run test to verify it passes**

Run: `node tests/recommendation-ui-shape.test.js`

Expected: PASS with a final log line such as `recommendation ui shape tests passed`.

**Step 5: Commit**

```bash
git add tests/recommendation-ui-shape.test.js public/index.html public/style.css
git commit -m "feat: add recommendation controls to practice mode layouts"
```

### Task 3: Integrate Manual Recommendations in Type, Speak, and Fill

**Files:**
- Modify: `public/script.js`
- Modify: `public/index.html`
- Test: `tests/question-recommendation-engine.test.mjs`

**Step 1: Extend the engine test with visible-pool and reason-label coverage**

Append assertions to `tests/question-recommendation-engine.test.mjs` for:

```js
const visibleOnly = engine.recommendNext({
  mode: 'type',
  currentQuestionId: 101,
  visibleQuestionIds: [101, 103],
  currentCefrLevel: 4,
  recentQuestionIds: [],
  index
});

assert.equal(visibleOnly.nextQuestionId, 103);

const labelMap = {
  level_and_continuity: 'level + continuity fit',
  difficulty_only: 'difficulty fit',
  continuity_only: 'strong match',
  fallback: 'best available match'
};

assert.equal(labelMap.level_and_continuity, 'level + continuity fit');
```

**Step 2: Run test to verify it still fails or is incomplete**

Run: `node tests/question-recommendation-engine.test.mjs`

Expected: FAIL until the engine and integration-facing helpers cover the new cases.

**Step 3: Write minimal implementation**

Modify `public/script.js` to:

- initialize the engine once databases are loaded
- build per-mode indexes for:
  - `typeDatabase`
  - `speakDatabase`
  - `extendedDatabase`
- read visible question ids from the active `<select>` options
- maintain recent recommendation history per mode in lightweight state
- expose small helpers such as:
  - `getVisibleQuestionIds(mode)`
  - `computeRecommendation(mode)`
  - `renderRecommendationUI(mode)`
  - `applyRecommendedQuestion(mode)`
- wire `recommended-btn-type`, `recommended-btn-speak`, and `recommended-btn-extended`
- only show active recommendation controls in manual mode for Type/Speak/Fill
- recompute the recommendation after:
  - dropdown change
  - filter change
  - toggle change
  - successful recommended jump
  - initial database load

Behavior rules:

- `Next` and `Back` stay sequential in manual mode.
- Clicking `Recommended` jumps to the suggested question.
- If the user manually selects a new question, use it as the new anchor and recompute.
- If no valid recommendation exists, disable the button and show a neutral label such as `No better match in current filters`.

**Step 4: Run test to verify it passes**

Run: `node tests/question-recommendation-engine.test.mjs`

Expected: PASS with all visible-pool and fallback assertions succeeding.

**Step 5: Commit**

```bash
git add public/script.js tests/question-recommendation-engine.test.mjs public/index.html
git commit -m "feat: wire manual recommendations into type speak and fill"
```

### Task 4: Integrate Recommendations in Notes

**Files:**
- Modify: `public/take-notes-mode.js`
- Modify: `public/index.html`
- Test: `tests/question-recommendation-engine.test.mjs`

**Step 1: Extend the engine test with transcript-based Notes coverage**

Append assertions to `tests/question-recommendation-engine.test.mjs` for:

```js
const notesItems = [
  { id: '1', level: 2, transcript: 'Public policy affects university funding.' },
  { id: '2', level: 2, transcript: 'University policy affects public trust.' },
  { id: '3', level: 1, transcript: 'Small birds live in dense forest habitats.' }
];

const notesIndex = engine.buildIndex('notes', notesItems);
const notesRecommendation = engine.recommendNext({
  mode: 'notes',
  currentQuestionId: 1,
  visibleQuestionIds: [1, 2, 3],
  currentCefrLevel: 4,
  recentQuestionIds: [],
  index: notesIndex
});

assert.equal(notesRecommendation.nextQuestionId, 2);
assert.equal(notesRecommendation.reasonCode, 'level_and_continuity');
```

**Step 2: Run test to verify it fails or is incomplete**

Run: `node tests/question-recommendation-engine.test.mjs`

Expected: FAIL until Notes transcript extraction is handled correctly.

**Step 3: Write minimal implementation**

Modify `public/take-notes-mode.js` to:

- cache `recommended-btn-notes` and `recommendation-summary-notes`
- build a Notes index after entries are loaded
- derive visible ids from `filteredEntries`
- compute recommendations against the filtered Notes pool
- update the Notes recommendation UI after:
  - `loadEntries()`
  - `applyFilter()`
  - `onQuestionSelectChange()`
  - `goToPrevious()`
  - `goToNext()`
  - `selectEntry()`
- keep existing Notes previous/next behavior unchanged
- make `Recommended` jump directly to the suggested entry and then refresh the summary

Difficulty behavior:

- Use `window.DifficultyManager.getCurrentSettings('type')?.level` as the CEFR input for Notes in this phase.
- Keep Notes' own difficulty dropdown filtering intact.
- Do not add a new Notes-specific adaptive profile in this feature.

**Step 4: Run test to verify it passes**

Run: `node tests/question-recommendation-engine.test.mjs`

Expected: PASS with transcript-based Notes recommendations succeeding.

**Step 5: Commit**

```bash
git add public/take-notes-mode.js tests/question-recommendation-engine.test.mjs public/index.html
git commit -m "feat: add recommended jump to notes mode"
```

### Task 5: Spec Alignment and Verification

**Files:**
- Modify: `docs/specs/ai-suggested-practice.md`

**Step 1: Update the spec to match the approved implementation**

Revise `docs/specs/ai-suggested-practice.md` so it reflects:

- no third `AI Suggested` toggle state
- `Recommended` inside manual mode for Type/Speak/Fill
- `Recommended` action in Notes without a new toggle
- generic explanation labels only
- current filters as the candidate pool boundary
- sequential `Next`/`Back` preserved

**Step 2: Run automated verification**

Run:

```bash
node tests/question-recommendation-engine.test.mjs
node tests/recommendation-ui-shape.test.js
```

Expected:

- both commands PASS
- final logs confirm the engine and UI shape are in sync

**Step 3: Run manual verification**

Verify in the browser:

1. Type manual mode:
   - choose a question manually
   - confirm the summary updates
   - click `Recommended`
   - confirm a different visible question loads
2. Speak manual mode:
   - change difficulty/status filters
   - confirm recommendations stay inside the filtered set
3. Fill manual mode:
   - switch between difficulty filters
   - confirm the recommended target changes with the visible pool
4. Notes mode:
   - change status and difficulty filters
   - confirm `Recommended` jumps within the filtered Notes entries
5. Repeat avoidance:
   - click `Recommended` repeatedly
   - confirm the same item is not suggested immediately unless the filtered pool is too small
6. Adaptive protection:
   - switch Type/Speak/Fill to adaptive
   - confirm the recommendation button is hidden or disabled there

**Step 4: Commit**

```bash
git add docs/specs/ai-suggested-practice.md
git commit -m "docs: align recommendation spec with approved manual-mode design"
```
