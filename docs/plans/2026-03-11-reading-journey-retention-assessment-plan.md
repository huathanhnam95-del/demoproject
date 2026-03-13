# Reading Journey Retention Assessment Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Add a retention-focused post-story assessment system to Reading Journey that mixes comprehension and vocabulary retrieval, avoids monotonous MCQ-only flows, and schedules lightweight spaced review for missed items.

**Architecture:** Keep quiz generation on the existing Reading Journey backend so the assessment deck is derived from the actual cached story path (`outlineId` + branch path) instead of trusting ad hoc browser text. Keep interaction grading client-side for instant formative feedback, but normalize all quiz contracts on the backend and return only the metadata needed to render evidence-based question types. Persist missed items and review schedules in versioned `localStorage` first so the prototype can validate the retention loop without requiring auth or Firestore schema changes.

**Tech Stack:** Express 5 routes in `src/routes/`, existing Gemini JSON helpers in `src/services/reading-journey/`, vanilla browser JS in `public/js/`, Node `assert` unit tests in `tests/`, Playwright browser checks in `tests/browser/`, smoke scripts in `scripts/`, versioned browser persistence via `localStorage`.

---

**Path convention:** Reading Journey backend logic lives under `src/services/reading-journey/`; Reading Journey HTTP endpoints live in `src/routes/reading-journey.js`; Reading Journey browser behavior lives in `public/js/reading-journey.js`; pure browser helper modules that can be tested in Node should live in `public/js/reading-journey-*.js`; Node unit tests should use `tests/reading-journey-*.test.js`; browser verification should use `tests/browser/reading-journey-*.js`; CLI smoke coverage should extend `scripts/smoke-reading-journey.js`. This plan targets the local `server.js` path first; do not mirror to `functions/src/` until the local prototype is validated.

**Research-informed product constraints to preserve:**
- Use a mixed retrieval deck, not a block of homogeneous MCQs.
- Keep the final quiz to 5 core questions with at most 1 bonus reflection item.
- Favor accuracy-first and explanatory feedback over speed-based scoring.
- Give exactly one scaffolded retry for interactive locate-the-text questions.
- Schedule missed items for spaced review on a 1-day, 3-day, 7-day cadence.
- Avoid gimmick-heavy interaction types that are weak on mobile or accessibility (for example, grid word-searches).
- Ensure every clickable text interaction is fully keyboard-usable and announced via live regions.

**Planned question types for MVP:**
- `mcq_main_idea`
- `click_word_meaning`
- `tap_evidence`
- `sequence_events`
- `short_answer`

**Question-type mix rules for MVP:**
- Every quiz must contain exactly 5 scored questions.
- Every quiz must include at least 1 comprehension item and at least 1 vocabulary item.
- Every quiz must include at least 1 interactive text-location item (`click_word_meaning` or `tap_evidence`).
- `A2` decks may use at most 1 free-response item and must use shorter prompts and more concrete evidence anchors.
- `C1` decks may use more inference-heavy `mcq_main_idea` and `short_answer`, but must still keep only one defensible answer in the story text.

### Task 1: Lock The Assessment Spec And Contracts

**Files:**
- Create: `docs/specs/features/reading-journey-assessment.md`
- Create: `src/services/reading-journey/quiz-contracts.js`
- Test: `tests/reading-journey-quiz-contracts.test.js`

**Step 1: Write the failing test**

- Assert that `quiz-contracts.js` exports:
  - `QUESTION_TYPES`
  - `normalizeQuizDeck`
  - `validateQuizQuestion`
  - `normalizeReviewQueue`
- Assert that a normalized quiz deck requires:
  - `quizId`
  - `outlineId`
  - `level`
  - `storySnapshot`
  - `questions`
- Assert that:
  - `click_word_meaning` requires `target.word`, `target.paragraphIndex`, and `acceptedSurfaceForms`
  - `tap_evidence` requires `target.paragraphIndex` and at least one evidence anchor
  - `sequence_events` requires ordered items with stable ids
  - `short_answer` requires a `rubric` and `idealAnswers`
  - only `A2|B1|B2|C1` are accepted levels

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-quiz-contracts.test.js`

Expected: FAIL because the contract module does not exist yet.

**Step 3: Write minimal implementation**

- Create `quiz-contracts.js` with pure normalization and validation helpers for:
  - the quiz deck payload
  - each question type
  - the local spaced-review queue shape
- Create `reading-journey-assessment.md` describing:
  - the five MVP question types
  - CEFR mix rules
  - grading philosophy (`formative`, `instant feedback`, `one scaffolded retry`)
  - local storage strategy for review scheduling
  - accessibility requirements for clickable text
- Make the contracts strict enough that backend generation failures are caught before the browser renders them.

**Step 4: Run test to verify it passes**

Run: `node tests/reading-journey-quiz-contracts.test.js`

Expected: PASS with a final line like `reading journey quiz contracts passed`.

**Step 5: Commit**

```bash
git add docs/specs/features/reading-journey-assessment.md src/services/reading-journey/quiz-contracts.js tests/reading-journey-quiz-contracts.test.js
git commit -m "docs: define reading journey assessment contracts"
```

### Task 2: Build Story-To-Quiz Generation On The Backend

**Files:**
- Create: `src/services/reading-journey/quiz-builder.js`
- Modify: `src/services/reading-journey/gemini.js`
- Test: `tests/reading-journey-quiz-builder.test.js`

**Step 1: Write the failing test**

- Assert that `buildAssessmentQuiz()` can consume:
  - `outline`
  - `outlineId`
  - `level`
  - `segments`
  - `endWrap`
  - `beatOutline`
  - `highlights`
- Assert that the returned deck:
  - contains exactly 5 questions
  - includes at least 1 vocabulary and 1 comprehension question
  - includes at least 1 interactive text-location question
  - never references a paragraph index outside the story snapshot
  - never uses a target word that is absent from the story text
  - respects `A2` and `C1` mix rules

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-quiz-builder.test.js`

Expected: FAIL because no quiz builder exists yet.

**Step 3: Write minimal implementation**

- Add a new backend helper in `gemini.js` for assessment quiz generation with a strict JSON schema.
- Create `quiz-builder.js` that:
  - reconstructs paragraph/sentence metadata from story segments
  - asks Gemini for a deck proposal
  - validates the proposed questions against the normalized story snapshot
  - patches obvious defects with deterministic fallback logic:
    - drop invalid distractors
    - replace missing target-word questions with MCQ or evidence items
    - clamp paragraph indices to valid ranges
    - downgrade overly hard question types at `A2`
- Ensure the builder produces the hint metadata needed for your click-word behavior:
  - `target.paragraphIndex`
  - `acceptedSurfaceForms`
  - optional `hintMessage`

**Step 4: Run test to verify it passes**

Run: `node tests/reading-journey-quiz-builder.test.js`

Expected: PASS with deterministic question counts and all indices validated.

**Step 5: Commit**

```bash
git add src/services/reading-journey/gemini.js src/services/reading-journey/quiz-builder.js tests/reading-journey-quiz-builder.test.js
git commit -m "feat: add reading journey assessment quiz builder"
```

### Task 3: Expose A Post-Story Quiz Endpoint Using Canonical Story Data

**Files:**
- Modify: `src/routes/reading-journey.js`
- Test: `tests/reading-journey-quiz-route.test.js`
- Modify: `docs/specs/features/reading-journey.md`

**Step 1: Write the failing test**

- Assert that `POST /api/reading-journey/quiz`:
  - requires `outlineId`, `path`, and `level`
  - rebuilds the completed story from cached beats instead of trusting browser text
  - returns a normalized quiz deck with `storySnapshot`
  - rejects incomplete paths
  - rejects requests when the ending beat is unavailable
- Assert that `quiz` payloads do not require the browser to send the entire story transcript.

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-quiz-route.test.js`

Expected: FAIL because the route does not exist yet.

**Step 3: Write minimal implementation**

- Add a route handler in `src/routes/reading-journey.js`:
  - `POST /reading-journey/quiz`
- Reuse the existing completed-story reconstruction pattern already used for deferred assessment.
- Return:
  - `quizId`
  - `outlineId`
  - `level`
  - `storySnapshot`
  - `questions`
  - `recommendedReviewCount`
- Update `docs/specs/features/reading-journey.md` to document the new endpoint and the fact that post-story assessment now exists in the hidden prototype.

**Step 4: Run test to verify it passes**

Run: `node tests/reading-journey-quiz-route.test.js`

Expected: PASS with a response that includes 5 normalized questions and no raw browser-supplied transcript field.

**Step 5: Commit**

```bash
git add src/routes/reading-journey.js tests/reading-journey-quiz-route.test.js docs/specs/features/reading-journey.md
git commit -m "feat: add reading journey quiz endpoint"
```

### Task 4: Build Frontend Quiz Helpers And Versioned Review Storage

**Files:**
- Create: `public/js/reading-journey-quiz-utils.js`
- Create: `public/js/reading-journey-quiz-storage.js`
- Test: `tests/reading-journey-quiz-utils.test.js`

**Step 1: Write the failing test**

- Assert that `reading-journey-quiz-utils.js` exports pure helpers for:
  - tokenizing story paragraphs into stable word tokens
  - normalizing accepted word surface forms
  - checking click-word answers
  - checking evidence-tap answers
  - computing sequence correctness
- Assert that `reading-journey-quiz-storage.js` exports:
  - `loadReviewQueue()`
  - `saveReviewQueue()`
  - `enqueueMissedItems()`
  - `getDueReviewItems()`
- Assert that the review queue:
  - is versioned
  - survives malformed localStorage data
  - schedules retries at 1 day, 3 days, and 7 days

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-quiz-utils.test.js`

Expected: FAIL because the helper modules do not exist yet.

**Step 3: Write minimal implementation**

- Create `reading-journey-quiz-utils.js` with pure, browser-safe helpers for:
  - paragraph tokenization
  - stable token ids
  - correctness checks for each interactive type
  - formatting ARIA-safe status messages
- Create `reading-journey-quiz-storage.js` with a versioned `localStorage` wrapper:
  - storage key: `rj_assessment_review_v1`
  - safe JSON parsing fallback
  - migration hook for future schema changes
  - enqueue logic for missed items only
- Keep the storage payload minimal:
  - `questionType`
  - `prompt`
  - `level`
  - `storyTitle`
  - `reviewState`
  - enough target metadata to re-render a lighter review card later

**Step 4: Run test to verify it passes**

Run: `node tests/reading-journey-quiz-utils.test.js`

Expected: PASS with stable token ids and deterministic review scheduling.

**Step 5: Commit**

```bash
git add public/js/reading-journey-quiz-utils.js public/js/reading-journey-quiz-storage.js tests/reading-journey-quiz-utils.test.js
git commit -m "feat: add reading journey quiz helpers and storage"
```

### Task 5: Integrate The Quiz UI Into The Reading Journey Flow

**Files:**
- Modify: `public/js/reading-journey.js`
- Test: `tests/browser/reading-journey-quiz-browser-check.js`

**Step 1: Write the failing browser test**

- Assert that a completed Reading Journey now offers:
  - `Check Understanding`
  - `Skip for now`
- Assert that the quiz UI can render:
  - one standard question card
  - one clickable passage interaction
  - one result summary
- Assert that:
  - clickable words are keyboard focusable
  - status feedback is announced in an `aria-live` region
  - the primary CTA remains reachable on a mobile viewport

**Step 2: Run browser verification to confirm it fails**

Run:

```bash
node tests/browser/reading-journey-quiz-browser-check.js --base-url http://127.0.0.1:8443
```

Expected: FAIL because the completion screen does not yet offer the assessment flow.

**Step 3: Write minimal implementation**

- Extend `public/js/reading-journey.js` state to include:
  - `quiz`
  - `quizIndex`
  - `quizAnswers`
  - `quizStatus`
  - `reviewQueueCount`
- Replace the current terminal completion card with a two-step flow:
  - completion summary
  - quiz launcher
- Render question-specific layouts:
  - `mcq_main_idea`: existing answer-card pattern
  - `click_word_meaning`: passage words rendered as buttons; wrong click flashes red, then highlights the correct paragraph and keeps the question active for one retry
  - `tap_evidence`: paragraph cards or sentence chips with one correct evidence region
  - `sequence_events`: reorderable cards with keyboard fallback buttons (`Move left`, `Move right`)
  - `short_answer`: one-line or two-line text input with rubric-guided feedback
- Add an `aria-live="polite"` status node for correctness, retry hints, and result announcements.
- Preserve the current Reading Journey visual language; do not introduce a separate route or standalone page.

**Step 4: Run browser verification to confirm it passes**

Run:

```bash
node tests/browser/reading-journey-quiz-browser-check.js --base-url http://127.0.0.1:8443
```

Expected: PASS with no browser errors and screenshots written under `tmp/`.

**Step 5: Commit**

```bash
git add public/js/reading-journey.js tests/browser/reading-journey-quiz-browser-check.js
git commit -m "feat: add reading journey quiz ui flow"
```

### Task 6: Add Scoring, Explanations, And Spaced Review Feedback

**Files:**
- Modify: `public/js/reading-journey.js`
- Modify: `public/js/reading-journey-quiz-storage.js`
- Test: `tests/reading-journey-quiz-results.test.js`

**Step 1: Write the failing test**

- Assert that result computation:
  - scores 5 questions correctly
  - groups misses by `vocabulary` vs `comprehension`
  - stores only missed items in the review queue
  - recommends `same level`, `review`, or `harder level` based on score bands
- Assert that explanatory feedback is attached to each result row.

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-quiz-results.test.js`

Expected: FAIL because result computation and review persistence do not exist yet.

**Step 3: Write minimal implementation**

- Add result helpers that:
  - compute overall score
  - compute per-skill counts
  - map score bands to next-step recommendations
- Persist only missed items to the review queue.
- Add a result screen showing:
  - score
  - strengths
  - review areas
  - a retry CTA
  - a continue-reading CTA
- Ensure each wrong answer shows:
  - the correct answer
  - a brief explanation
  - the relevant evidence line or paragraph when available

**Step 4: Run test to verify it passes**

Run: `node tests/reading-journey-quiz-results.test.js`

Expected: PASS with deterministic score bands and review queue writes.

**Step 5: Commit**

```bash
git add public/js/reading-journey.js public/js/reading-journey-quiz-storage.js tests/reading-journey-quiz-results.test.js
git commit -m "feat: add reading journey quiz scoring and review queue"
```

### Task 7: Expand Smoke Coverage And Manual QA Guidance

**Files:**
- Modify: `scripts/smoke-reading-journey.js`
- Create: `docs/testing/reading-journey-assessment-qa.md`

**Step 1: Write the failing verification expectation**

- Extend the smoke script expectation set to require:
  - successful `POST /api/reading-journey/quiz`
  - exactly 5 questions returned
  - valid question type mix
  - at least 1 interactive text-location item
  - no invalid paragraph indices

**Step 2: Run the smoke script to verify it fails**

Run:

```bash
node scripts/smoke-reading-journey.js --start-server --port 8787
```

Expected: FAIL because the smoke script does not yet call the quiz endpoint or validate question mix.

**Step 3: Write minimal implementation**

- Extend `scripts/smoke-reading-journey.js` so that after the ending beat:
  - it calls the quiz endpoint
  - validates the question mix
  - validates the returned story snapshot and target indices
- Create `reading-journey-assessment-qa.md` with manual checks for:
  - desktop and mobile
  - keyboard-only passage selection
  - retry hint behavior for click-word questions
  - review queue persistence after refresh
  - disabled feature behavior when Reading Journey is off

**Step 4: Run smoke verification to confirm it passes**

Run:

```bash
node scripts/smoke-reading-journey.js --start-server --port 8787
```

Expected: PASS with a final line like `Reading Journey smoke passed.`

**Step 5: Commit**

```bash
git add scripts/smoke-reading-journey.js docs/testing/reading-journey-assessment-qa.md
git commit -m "test: add reading journey assessment smoke coverage"
```

### Task 8: Post-MVP Hardening And Promotion Gate

**Files:**
- Modify: `docs/specs/features/reading-journey-assessment.md`
- Modify: `docs/specs/features/reading-journey.md`

**Step 1: Write the release checklist**

- Document the criteria required before mirroring this feature into `functions/src/` or exposing it beyond the hidden route:
  - browser test passes
  - smoke test passes
  - no critical accessibility blockers
  - review queue survives reload
  - generated decks remain valid across `A2`, `B1`, `B2`, and `C1`

**Step 2: Verify the checklist is present**

Run: `rg -n "Promotion gate|functions/src|accessibility blockers" docs/specs/features/reading-journey*.md`

Expected: Matching lines in both spec files.

**Step 3: Write minimal implementation**

- Add a short promotion gate section explaining that:
  - the feature stays formative, not exam-secure
  - client-side grading is acceptable for this hidden prototype
  - `functions/src/` parity is deferred until the prototype passes local QA

**Step 4: Re-run spec check**

Run: `rg -n "Promotion gate|functions/src|accessibility blockers" docs/specs/features/reading-journey*.md`

Expected: Matching lines for all three phrases.

**Step 5: Commit**

```bash
git add docs/specs/features/reading-journey-assessment.md docs/specs/features/reading-journey.md
git commit -m "docs: add reading journey assessment promotion gate"
```

## Verification Matrix

Run these before calling the feature complete:

```bash
node tests/reading-journey-quiz-contracts.test.js
node tests/reading-journey-quiz-builder.test.js
node tests/reading-journey-quiz-route.test.js
node tests/reading-journey-quiz-utils.test.js
node tests/reading-journey-quiz-results.test.js
node tests/browser/reading-journey-quiz-browser-check.js --base-url http://127.0.0.1:8443
node scripts/smoke-reading-journey.js --start-server --port 8787
```

Expected final state:
- All unit tests PASS
- Browser check PASS with no console errors
- Smoke script PASS with valid quiz generation
- Reading Journey completion screen shows the quiz launcher
- Missed items are visible in the local spaced-review queue after reload

## Non-Goals For This Plan

- No teacher/admin reporting dashboard yet
- No secure anti-cheat assessment logic
- No Firebase/Firestore persistence for quiz attempts in MVP
- No `functions/src/` parity until the local prototype is validated
- No points economy or badge layer in the first release

## Execution Notes

- Keep question generation and validation narrow. If Gemini emits invalid decks too often, reduce variety before adding more interaction types.
- Prefer a clean 5-question deck over a bigger, noisier assessment.
- Do not ship inaccessible inline `<span>` click targets. Use real buttons or equivalent keyboard-operable controls.
- If the browser flow becomes too dense inside `public/js/reading-journey.js`, split renderers into additional `public/js/reading-journey-*.js` modules before adding more features.
