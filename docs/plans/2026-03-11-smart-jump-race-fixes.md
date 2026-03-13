# Smart Jump Race Fixes Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Eliminate Smart Jump race conditions so Type, Speak, and Extended always load the selected question's media and state, while Notes remains green.

**Architecture:** Add explicit per-mode load invalidation tokens and stop relying on `dispatchEvent('change')` plus optimistic state updates for Smart Jump. Centralize question transitions behind awaited helpers so selector state, current question ID, audio source, and recommendation summary update atomically for Type, Speak, and Extended. Keep the existing Notes token-guard behavior as the reference pattern and verify it is not regressed.

**Tech Stack:** Vanilla JavaScript, existing Playwright-based browser regression tests, ESLint, Node server runtime.

---

## Context For The Implementer

- Smart Jump exists in:
  - `type`: `public/script.js`
  - `speak`: `public/script.js`
  - `extended`: `public/script.js`
  - `notes`: `public/take-notes-mode.js`
- Current broken behavior is in `type`, `speak`, and `extended`:
  - the selector value can change to the recommended question
  - an older async audio probe can finish later and overwrite the active question ID and media source
- Notes already has the correct pattern:
  - load token: `public/take-notes-mode.js`
  - active-practice restart on selection: `public/take-notes-mode.js`
- Relevant `public/script.js` regions to modify:
  - `loadExtendedQuestion` / `loadExtendedAudio`: `public/script.js:4616-4757`
  - `loadQuestion`: `public/script.js:6871-7030`
  - recommendation apply path: `public/script.js:7179-7205`
  - fallback selection in `populateQuestionSelect`: `public/script.js:7235-7441`
  - selector change listeners: `public/script.js:7495-7513`

## Path Convention

- New browser regressions for Smart Jump go in `tests/` as standalone Node + Playwright scripts, matching the existing style of `tests/notes-smart-jump-regression.test.js`.

### Task 1: Add A Cross-Mode Failing Regression

**Files:**
- Create: `tests/smart-jump-race-regression.test.js`
- Reference: `tests/notes-smart-jump-regression.test.js`
- Reference: `public/script.js:4616-4757`
- Reference: `public/script.js:6871-7030`
- Reference: `public/script.js:7179-7205`

**Step 1: Write the failing test**

Create `tests/smart-jump-race-regression.test.js` with three browser checks:

- Type scenario:
  - stub `database/type/index.json`
  - delay `HEAD`/audio responses for question `1`
  - make question `2` fast
  - trigger a stale reload of question `1`
  - click Smart Jump
  - assert:
    - displayed current question ID is `2`
    - selected dropdown value is `2`
    - `#audio source[src]` points to question `2`
- Speak scenario:
  - same structure using `database/speak/*`
  - assert `current-question-id-speak`, `question-select-speak`, and `#audio source[src]`
- Extended scenario:
  - same structure using `database/extended/*`
  - assert `current-question-id-extended`, `question-select-extended`, and `#audio-extended source[src]`

Use the existing Notes regression style:

```js
assert.equal(result.currentId, '2');
assert.equal(result.selectValue, '2');
assert.match(result.sourceSrc, /\/2\.(mp3|wav|m4a|aac|ogg)(\?|$)/);
```

**Step 2: Run the regression to verify it fails**

Run:

```bash
node tests/smart-jump-race-regression.test.js
```

Expected:
- FAIL in at least the Type scenario
- failure should show a mismatch where current question ID or audio source remains on `1`

**Step 3: Commit the failing test**

```bash
git add tests/smart-jump-race-regression.test.js
git commit -m "test: cover smart jump race regressions"
```

### Task 2: Make Type And Speak Question Loads Race-Safe

**Files:**
- Modify: `public/script.js:6871-7030`
- Modify: `public/script.js:7179-7205`
- Modify: `public/script.js:7235-7441`
- Modify: `public/script.js:7495-7513`
- Reference: `public/take-notes-mode.js:62-84`
- Reference: `public/take-notes-mode.js:695-717`

**Step 1: Add per-mode invalidation state**

In `public/script.js`, add a top-level structure like:

```js
const questionLoadTokenByMode = {
  type: 0,
  speak: 0,
  extended: 0
};
```

Also add tiny helpers:

```js
const startQuestionLoad = (mode) => ++questionLoadTokenByMode[mode];
const isStaleQuestionLoad = (mode, token) => questionLoadTokenByMode[mode] !== token;
```

**Step 2: Guard `loadQuestion()` against stale completions**

Inside `loadQuestion(mode, questionId)`:

- capture `const loadToken = startQuestionLoad(mode);`
- after every awaited file probe, return early if stale
- before mutating audio DOM, return early if stale
- before setting:
  - `currentTypeQuestionId`
  - `currentSpeakQuestionId`
  - `currentQuestionIdType.textContent`
  - `currentQuestionIdSpeak.textContent`
  - scaffolding resets
  - mastery status load
  return early if stale

The rule is: no stale `loadQuestion()` call may touch DOM or global question state after a newer load has started.

**Step 3: Replace optimistic selector updates with awaited transitions**

Stop using this pattern in Type/Speak:

```js
if (questionId && loadQuestion(...)) {
  currentTypeQuestionId = questionId;
}
```

Instead make the selector listeners `async` and await the actual load:

```js
questionSelectType.addEventListener('change', async (e) => {
  const questionId = parseInt(e.target.value, 10);
  if (questionId) {
    await loadQuestion('type', questionId);
  }
  refreshRecommendationUI('type');
});
```

Do the same for Speak.

**Step 4: Make Smart Jump use awaited question selection**

Refactor `applyRecommendedQuestion(mode)` so Type/Speak do not depend on `dispatchEvent(new Event('change'))` plus `requestAnimationFrame`.

Add a helper such as:

```js
const applyQuestionSelection = async (mode, targetQuestionId) => {
  const select = getQuestionSelectForMode(mode);
  select.value = String(targetQuestionId);
  if (mode === 'type' || mode === 'speak') {
    await loadQuestion(mode, targetQuestionId);
  }
  refreshRecommendationUI(mode);
};
```

Then call that helper from `applyRecommendedQuestion(mode)`.

**Step 5: Update non-user selection entry points**

In `populateQuestionSelect()` for Type/Speak, when the current question is filtered out and the first visible item is selected, await the same selection helper instead of directly mutating `currentTypeQuestionId` / `currentSpeakQuestionId`.

**Step 6: Run the regression to verify Type and Speak pass**

Run:

```bash
node tests/smart-jump-race-regression.test.js
```

Expected:
- Type passes
- Speak passes
- Extended may still fail until Task 3 is complete

**Step 7: Commit**

```bash
git add public/script.js
git commit -m "fix: serialize smart jump loads for type and speak"
```

### Task 3: Make Extended Smart Jump Race-Safe

**Files:**
- Modify: `public/script.js:4616-4757`
- Modify: `public/script.js:5314-5319`
- Modify: `public/script.js:7179-7205`
- Modify: `public/script.js:7235-7294`
- Test: `tests/smart-jump-race-regression.test.js`

**Step 1: Add an Extended-specific invalidation guard**

Reuse `questionLoadTokenByMode.extended`.

Inside `loadExtendedQuestion(questionId)`:

- capture `const loadToken = startQuestionLoad('extended');`
- after any await, return if stale
- before setting reading/listening UI, timers, transcript, and question ID display, return if stale

Inside `loadExtendedAudio(audioFile)`:

- accept `questionId` and `loadToken` explicitly instead of relying on `currentExtendedQuestionId`
- base the filename on the explicit `questionId`
- after each awaited file existence check, return if stale
- before mutating `audioExtended` / `audioPhrases`, return if stale

Prefer this signature:

```js
const loadExtendedAudio = async (questionId, audioFile, loadToken) => { ... }
```

**Step 2: Make Extended selector and Smart Jump awaited**

- change `questionSelectExtended` listener to `async`
- await `loadExtendedQuestion(questionId)`
- refactor `applyRecommendedQuestion('extended')` to use the same awaited helper path
- update the `populateQuestionSelect('extended')` fallback path to await the helper as well

**Step 3: Run the regression to verify Extended passes**

Run:

```bash
node tests/smart-jump-race-regression.test.js
```

Expected:
- Type PASS
- Speak PASS
- Extended PASS

**Step 4: Commit**

```bash
git add public/script.js tests/smart-jump-race-regression.test.js
git commit -m "fix: serialize smart jump loads for extended"
```

### Task 4: Full Validation And Notes Safety Check

**Files:**
- Verify: `public/script.js`
- Verify: `public/take-notes-mode.js`
- Verify: `tests/smart-jump-race-regression.test.js`
- Verify: `tests/notes-smart-jump-regression.test.js`

**Step 1: Run targeted regressions**

Run:

```bash
node tests/smart-jump-race-regression.test.js
node tests/notes-smart-jump-regression.test.js
```

Expected:
- both commands PASS
- Notes still passes with its existing token guard

**Step 2: Run lint on touched files**

Run:

```bash
npx eslint public/script.js public/take-notes-mode.js tests/smart-jump-race-regression.test.js tests/notes-smart-jump-regression.test.js
```

Expected:
- no lint errors

**Step 3: Manual smoke verification**

Run the app and manually verify:

1. Type:
   - enter manual mode
   - press Smart Jump repeatedly while audio is still resolving
   - confirm question ID, dropdown selection, and audio all stay aligned
2. Speak:
   - same check
3. Extended:
   - same check, including `audio-extended` and phrases audio
4. Notes:
   - confirm existing Smart Jump behavior still restarts the selected practice entry correctly

**Step 4: Commit final validation state**

```bash
git add public/script.js tests/smart-jump-race-regression.test.js
git commit -m "test: verify smart jump stability across practice modes"
```

## Plan Validation Notes

- Requirement coverage:
  - Type Smart Jump bug: covered
  - Speak shared bug: covered
  - Extended shared bug: covered
  - Notes non-regression: covered
- Dependency order:
  - test first
  - Type/Speak fix second
  - Extended fix third
  - full validation last
- Scope sanity:
  - one new test artifact
  - one shared script refactor
  - one extended-specific refactor
  - one validation task
