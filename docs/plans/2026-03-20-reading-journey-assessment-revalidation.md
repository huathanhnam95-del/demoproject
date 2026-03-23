# Reading Journey Assessment Revalidation Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Finish the Reading Journey assessment feature so the live UI is accessible, the completion flow uses a single shared rendering source, and quiz content stays grounded in regenerated story snapshots.

**Architecture:** Keep the assessment UI in the browser, but treat the quiz deck as canonical data derived from the server-side reconstructed story path. The browser should only render and grade the normalized deck, while the backend validates that each question is still supported by the current regenerated story text, beat outline, and evidence paragraphs. Use committed corpus fixtures from regenerated outlines so future story regeneration cannot silently produce stale quiz targets.

**Tech Stack:** Vanilla browser JS in `public/js/`, Express route handlers in `src/routes/`, story and quiz services in `src/services/reading-journey/`, Node `assert` tests in `tests/`, Playwright browser checks in `tests/browser/`, smoke coverage in `scripts/`, and markdown specs/docs in `docs/specs/` and `docs/testing/`.

---

**Path convention:** Reading Journey browser code lives in `public/js/reading-journey*.js`; reading journey backend logic lives in `src/services/reading-journey/`; route handlers live in `src/routes/reading-journey.js`; unit tests live in `tests/reading-journey-*.test.js`; browser checks live in `tests/browser/reading-journey-*.js`; docs live in `docs/specs/features/` and `docs/testing/`; plan files live in `docs/plans/`.

## Task 1: Make The Quiz Status Region Visible And Stable

**Files:**
- Modify: `public/style.css`
- Modify: `tests/browser/reading-journey-quiz-browser-check.js`

**Step 1: Write the failing browser assertion**

Add or keep an assertion that the quiz status element is visible after the quiz renders and updates after a wrong vocab click.

Run: `node tests/browser/reading-journey-quiz-browser-check.js`

Expected: FAIL if the status region has no visible footprint.

**Step 2: Add the visible status styling**

Implement a real `.rj-quiz__status` rule in `public/style.css` with:
- spacing and padding
- readable typography
- a subtle bordered container
- a non-zero minimum height
- dark-mode support if the app uses it

Keep the `aria-live` region visible. Do not hide it with `display: none` or collapse it to zero height.

**Step 3: Run the browser check again**

Run: `node tests/browser/reading-journey-quiz-browser-check.js`

Expected: PASS with the status region visible and feedback text updating.

**Step 4: Commit**

```bash
git add public/style.css tests/browser/reading-journey-quiz-browser-check.js
git commit -m "fix: restore visible reading journey quiz status"
```

## Task 2: Remove Completion Screen Drift In The Live Host

**Files:**
- Modify: `public/js/reading-journey.js`
- Modify: `tests/reading-journey-assessment.test.js`

**Step 1: Write the failing helper-parity test**

Add a test that proves the live completion screen is rendered from the extracted helper markup instead of a hardcoded host copy.

Run: `node tests/reading-journey-assessment.test.js`

Expected: FAIL until the host completion path delegates cleanly.

**Step 2: Rewire the host completion path**

In `public/js/reading-journey.js`:
- replace the remaining hardcoded completion markup with `buildCompletionSummaryMarkup()`
- remove any placeholder completion fragments or dead legacy branches
- keep `showComplete()` as the lifecycle bridge only
- ensure the live host and extracted helper produce the same visible completion state

**Step 3: Run the helper test again**

Run: `node tests/reading-journey-assessment.test.js`

Expected: PASS with the completion markup matching the helper contract.

**Step 4: Commit**

```bash
git add public/js/reading-journey.js tests/reading-journey-assessment.test.js
git commit -m "refactor: delegate reading journey completion rendering"
```

## Task 3: Revalidate Quiz Generation Against Regenerated Story Content

**Files:**
- Modify: `src/services/reading-journey/quiz-builder.js`
- Modify: `src/services/reading-journey/gemini.js`
- Modify: `tests/reading-journey-quiz-builder.test.js`

**Step 1: Write the failing grounding test**

Add a regression test that feeds the builder a regenerated story snapshot and checks that:
- `click_word_meaning` targets still exist in the story text
- `tap_evidence` points to a valid paragraph index
- `sequence_events` still matches the regenerated beat outline
- stale draft questions are rejected or replaced

Run: `node tests/reading-journey-quiz-builder.test.js`

Expected: FAIL if the builder still trusts stale outline assumptions.

**Step 2: Tighten builder validation**

Update `quiz-builder.js` so it validates every question against the regenerated story artifacts before returning the quiz deck.

Minimum requirements:
- normalize text before comparison
- validate paragraph ranges against the returned story snapshot
- validate `sequence_events` against the regenerated beat outline text
- fall back to grounded replacement questions if the draft deck is stale

If the Gemini draft is missing or weak, deterministic fallback logic must still produce a valid deck.

**Step 3: Run the builder test again**

Run: `node tests/reading-journey-quiz-builder.test.js`

Expected: PASS with all questions grounded in the current story artifacts.

**Step 4: Commit**

```bash
git add src/services/reading-journey/quiz-builder.js src/services/reading-journey/gemini.js tests/reading-journey-quiz-builder.test.js
git commit -m "feat: ground reading journey quiz builder against regenerated stories"
```

## Task 4: Add Corpus-Based Regression Coverage For Regenerated Outlines

**Files:**
- Create: `tests/fixtures/reading-journey/regen-outline-301.json`
- Create: `tests/reading-journey-quiz-regenerated-corpus.test.js`

**Step 1: Create the corpus fixture**

Convert the current regenerated outline snapshot in `C:\\tmp\\regen-outline-301.json` into a committed test fixture under `tests/fixtures/reading-journey/regen-outline-301.json`.

Keep only the fields needed to verify quiz grounding:
- `outlineId`
- `title`
- `paths`
- `beats`
- `segment`
- `highlights`
- `endWrap`

**Step 2: Write the failing corpus test**

Add a test that loads the fixture and asserts:
- the returned quiz still contains exactly 5 questions
- at least one vocabulary question exists
- at least one comprehension question exists
- the text-location question points at a real paragraph
- the sequence question mirrors the regenerated beat outline
- stale click-word or sequence drafts do not survive validation

Run: `node tests/reading-journey-quiz-regenerated-corpus.test.js`

Expected: FAIL until the fixture and grounding assertions are in place.

**Step 3: Make the corpus test pass**

Wire the fixture into the existing builder and verify the returned deck is grounded in the actual regenerated text.

Run: `node tests/reading-journey-quiz-regenerated-corpus.test.js`

Expected: PASS with no stale targets.

**Step 4: Commit**

```bash
git add tests/fixtures/reading-journey/regen-outline-301.json tests/reading-journey-quiz-regenerated-corpus.test.js
git commit -m "test: add regenerated corpus coverage for reading journey quiz"
```

## Task 5: Keep Route And Browser Coverage Aligned With The Live Flow

**Files:**
- Modify: `src/routes/reading-journey.js`
- Modify: `tests/reading-journey-quiz-route.test.js`
- Modify: `tests/browser/reading-journey-quiz-browser-check.js`

**Step 1: Write the route regression**

Ensure the route test proves the backend is returning quiz data derived from the canonical reconstructed story, not browser-supplied transcript text.

Run: `node tests/reading-journey-quiz-route.test.js`

Expected: FAIL if the route no longer enforces the canonical story source.

**Step 2: Update the route contract if needed**

Keep the route response normalized and stable. If the regenerated corpus audit exposes a missing field, add it once at the route level and cover it in tests.

**Step 3: Keep the browser check focused on shipped behavior**

The browser check should verify:
- the quiz launches from the completion screen
- the status region is visible
- a wrong vocab click updates feedback
- the final results screen renders

Run: `node tests/browser/reading-journey-quiz-browser-check.js`

Expected: PASS against the live UI.

**Step 4: Commit**

```bash
git add src/routes/reading-journey.js tests/reading-journey-quiz-route.test.js tests/browser/reading-journey-quiz-browser-check.js
git commit -m "test: align reading journey route and browser coverage"
```

## Task 6: Cleanup Residue And Update Supporting Docs

**Files:**
- Modify: `public/js/reading-journey.js`
- Modify: `docs/specs/features/reading-journey-assessment.md`
- Modify: `docs/specs/features/reading-journey.md`
- Modify: `docs/testing/reading-journey-assessment-qa.md`

**Step 1: Remove stale residue**

Clean any remaining placeholder glyphs, dead legacy branches, or hardcoded completion fragments in `public/js/reading-journey.js`.

**Step 2: Keep the docs accurate**

Update the assessment spec and QA doc so they describe the final live behavior:
- visible quiz status region
- helper-owned completion and results markup
- corpus-based grounding against regenerated stories
- review queue behavior and retry rules

**Step 3: Run the full verification set**

Run:
- `node tests/reading-journey-assessment.test.js`
- `node tests/reading-journey-quiz-contracts.test.js`
- `node tests/reading-journey-quiz-builder.test.js`
- `node tests/reading-journey-quiz-regenerated-corpus.test.js`
- `node tests/reading-journey-quiz-route.test.js`
- `node tests/reading-journey-quiz-results.test.js`
- `node tests/reading-journey-quiz-utils.test.js`
- `node tests/browser/reading-journey-quiz-browser-check.js`
- `node scripts/smoke-reading-journey.js --start-server --port 8787`

Expected: all pass.

**Step 4: Commit**

```bash
git add public/js/reading-journey.js docs/specs/features/reading-journey-assessment.md docs/specs/features/reading-journey.md docs/testing/reading-journey-assessment-qa.md
git commit -m "chore: clean up reading journey assessment revalidation"
```

## Acceptance Criteria

- The quiz status region is visibly rendered and announced.
- The completion screen is sourced from the extracted assessment helper, not a stale host copy.
- Quiz questions remain grounded in regenerated story content.
- A regenerated story cannot produce a question with a missing target, paragraph, or sequence anchor.
- The browser check and smoke flow pass on the shipped UI.
- Supporting docs describe the actual implemented behavior.

## Final Verification Order

1. `node tests/reading-journey-quiz-regenerated-corpus.test.js`
2. `node tests/reading-journey-quiz-route.test.js`
3. `node tests/reading-journey-quiz-builder.test.js`
4. `node tests/reading-journey-quiz-results.test.js`
5. `node tests/reading-journey-quiz-utils.test.js`
6. `node tests/reading-journey-assessment.test.js`
7. `node tests/browser/reading-journey-quiz-browser-check.js`
8. `node scripts/smoke-reading-journey.js --start-server --port 8787`

