# Story Thumbnail Generation Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Add a research-informed pipeline that creates one high-quality thumbnail per Reading Journey story by summarizing the story into a canonical visual scene, generating an image with Google's Gemini image models ("Nano Banana" workflow), and immediately auditing the output against universal and story-specific criteria.

**Architecture:** Keep the production pipeline in the existing Node/Express Reading Journey stack under `src/services/reading-journey/` so thumbnail generation can reuse the current Gemini JSON helpers, cache model, route mounting, and audit artifact patterns. Use a three-stage contract: `story -> scene summary`, `scene summary -> structured image prompt + audit rubric`, `generated image -> multimodal audit + repair loop`, with all shared records stored in cacheable JSON and all generated files written to a deterministic thumbnail artifact location.

**Tech Stack:** Express 5, existing Reading Journey services in `src/services/reading-journey/`, Google Vertex/Gemini image generation APIs, multimodal Gemini JSON evaluation, plain browser JS in `public/js/reading-journey.js`, Node `assert` tests, CLI audit scripts under `scripts/`, artifact reports under `docs/audits/`.

---

**Path convention:** Reading Journey backend services live in `src/services/reading-journey/`; Reading Journey HTTP endpoints live in `src/routes/reading-journey.js`; browser behavior lives in `public/js/reading-journey.js`; test files for this feature live in `tests/reading-journey-*.test.js`; batch generation and audit runners live in `scripts/`; generated audit reports live in `docs/audits/reading-journey-thumbnails/YYYY-MM-DD/`.

**Research-informed design constraints:**
- Use one canonical thumbnail scene per story, not one image per beat. The scene must represent the story's highest-salience moment while staying spoiler-safe for the library view.
- Build prompts as structured fields, not a single free-form paragraph. Required fields: subject, action, environment, mood, composition, camera framing, lighting, style, continuity anchors, exclusions, and thumbnail readability constraints.
- Persist universal criteria separately from story-specific criteria. Universal criteria cover thumbnail legibility, subject clarity, safe content, no text artifacts, and composition. Story-specific criteria cover named characters, setting, key props, action, and emotional tone.
- Audit criteria must be atomic. Each criterion should test one visual fact so the repair loop can target failures cleanly.
- Prefer reference-driven and iterative generation when a story already has a consistent character/style asset; otherwise use text-only generation for the first version and add references in later passes.
- Never ship hard-coded Google API keys. Existing exploratory Python scripts contain hard-coded credentials and must not be copied into the production path.

**Core contracts to implement:**
- `ThumbnailSceneSummary`
  - `storyId`
  - `outlineId`
  - `title`
  - `logline`
  - `thumbnailMoment`
  - `characters[]`
  - `setting`
  - `timeOfDay`
  - `keyProps[]`
  - `emotionalTone`
  - `spoilerLevel`
  - `sourceBeats[]`
- `ThumbnailPromptSpec`
  - `promptText`
  - `subject`
  - `action`
  - `environment`
  - `style`
  - `composition`
  - `camera`
  - `lighting`
  - `negativeConstraints[]`
  - `continuityAnchors[]`
  - `aspectRatio`
- `ThumbnailAuditSpec`
  - `universalCriteria[]`
  - `storyCriteria[]`
  - `blockingFailures[]`
  - `repairInstructions`
- `ThumbnailGenerationRecord`
  - `storyId`
  - `attempt`
  - `model`
  - `referenceImages[]`
  - `promptSpec`
  - `auditSpec`
  - `imagePath`
  - `auditResult`
  - `status`

### Task 1: Lock The Contracts And Spec

**Files:**
- Create: `docs/specs/features/reading-journey-thumbnails.md`
- Create: `src/services/reading-journey/thumbnail-contracts.js`
- Create: `tests/reading-journey-thumbnail-contracts.test.js`

**Step 1: Write the failing contract test**

- Assert that `thumbnail-contracts.js` exports builders or validators for:
  - `ThumbnailSceneSummary`
  - `ThumbnailPromptSpec`
  - `ThumbnailAuditSpec`
  - `ThumbnailGenerationRecord`
- Assert that:
  - universal criteria require `id`, `label`, `severity`, and `question`
  - story criteria require `source` linking back to summary fields or beat ids
  - `spoilerLevel` is limited to `safe_library`, `safe_story_detail`, or `full`

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-thumbnail-contracts.test.js`

Expected: FAIL because no thumbnail contract module exists yet.

**Step 3: Write minimal implementation**

- Create `thumbnail-contracts.js` with pure helpers that normalize and validate the four contracts.
- Create `reading-journey-thumbnails.md` describing:
  - thumbnail selection policy
  - JSON contracts
  - environment variables
  - route surface
  - audit pass/fail policy
- Document that the initial scope is one thumbnail per story library card, not per branch path.

**Step 4: Run test to verify it passes**

Run: `node tests/reading-journey-thumbnail-contracts.test.js`

Expected: PASS with a final line like `reading journey thumbnail contracts passed`.

**Step 5: Commit**

```bash
git add docs/specs/features/reading-journey-thumbnails.md src/services/reading-journey/thumbnail-contracts.js tests/reading-journey-thumbnail-contracts.test.js
git commit -m "docs: define reading journey thumbnail contracts"
```

### Task 2: Build Story-To-Scene Summary Extraction

**Files:**
- Create: `src/services/reading-journey/thumbnail-summary.js`
- Modify: `src/services/reading-journey/gemini.js`
- Create: `tests/reading-journey-thumbnail-summary.test.js`

**Step 1: Write the failing summary test**

- Assert that `buildThumbnailSceneSummary()` can consume:
  - outline metadata
  - generated beat transcript
  - optional title/premise
- Assert that the returned summary:
  - picks exactly one `thumbnailMoment`
  - maps at least one `sourceBeat`
  - extracts only the characters/settings/props needed for visualization
  - marks overly revealing end-state moments as `safe_story_detail` or `full`, never `safe_library`

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-thumbnail-summary.test.js`

Expected: FAIL because no summary extraction service exists yet.

**Step 3: Write minimal implementation**

- Add a new JSON-generation helper in `gemini.js` for thumbnail-summary prompts.
- Create `thumbnail-summary.js` with:
  - deterministic summarizer input assembly from outline + beats
  - spoiler-safe scene ranking
  - fallback heuristics if the model omits required fields
- Keep the summary contract narrow: enough detail to generate a thumbnail, not a full synopsis.

**Step 4: Run test to verify it passes**

Run: `node tests/reading-journey-thumbnail-summary.test.js`

Expected: PASS with stable output on the included fixtures.

**Step 5: Commit**

```bash
git add src/services/reading-journey/gemini.js src/services/reading-journey/thumbnail-summary.js tests/reading-journey-thumbnail-summary.test.js
git commit -m "feat: add story thumbnail scene summarization"
```

### Task 3: Build The Structured Prompt And Criteria Composer

**Files:**
- Create: `src/services/reading-journey/thumbnail-prompt.js`
- Create: `tests/reading-journey-thumbnail-prompt.test.js`

**Step 1: Write the failing prompt-composer test**

- Assert that `buildThumbnailPromptSpec()` always outputs:
  - `subject`
  - `action`
  - `environment`
  - `style`
  - `composition`
  - `camera`
  - `lighting`
  - `negativeConstraints`
  - `continuityAnchors`
  - `promptText`
- Assert that `buildThumbnailAuditSpec()` always outputs:
  - at least 5 universal criteria
  - at least 3 story-specific criteria
  - atomic question wording
  - at least 1 blocking failure for policy/legibility/text artifact issues

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-thumbnail-prompt.test.js`

Expected: FAIL because no prompt/criteria composer exists yet.

**Step 3: Write minimal implementation**

- Create a prompt builder that translates `ThumbnailSceneSummary` into:
  - a structured prompt object
  - a flattened `promptText` for the model call
- Encode universal thumbnail rules directly in the builder:
  - focal subject reads at small size
  - no embedded text or UI
  - safe content only
  - strong single-scene composition
  - 16:9-friendly framing with center-safe subject placement
- Encode story criteria from summary fields:
  - named character appearance
  - key prop presence
  - setting accuracy
  - emotional tone
  - story action match

**Step 4: Run test to verify it passes**

Run: `node tests/reading-journey-thumbnail-prompt.test.js`

Expected: PASS with prompt text including all required sections in deterministic order.

**Step 5: Commit**

```bash
git add src/services/reading-journey/thumbnail-prompt.js tests/reading-journey-thumbnail-prompt.test.js
git commit -m "feat: add structured thumbnail prompt composer"
```

### Task 4: Add The Google Image Generation Adapter

**Files:**
- Create: `src/services/reading-journey/thumbnail-generator.js`
- Create: `tests/reading-journey-thumbnail-generator.test.js`
- Create: `scripts/test-reading-journey-thumbnail-generator.js`
- Modify: `docs/specs/features/ai-services.md`

**Step 1: Write the failing generator-adapter test**

- Assert that the adapter can build request payloads for:
  - text-only image generation
  - text + reference image generation
  - repair-pass regeneration
- Assert that the adapter never reads hard-coded API keys from source files.
- Assert that the adapter returns a normalized response object with `model`, `attempt`, `imageBytes` or `imagePath`, and `rawResponseMeta`.

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-thumbnail-generator.test.js`

Expected: FAIL because the production adapter does not exist yet.

**Step 3: Write minimal implementation**

- Create a Node production adapter that calls the chosen Google image endpoint via env-configured credentials.
- Support these env vars:
  - `READING_JOURNEY_THUMBNAILS_ENABLED`
  - `READING_JOURNEY_THUMBNAIL_MODEL`
  - `READING_JOURNEY_THUMBNAIL_AUDIT_MODEL`
  - `READING_JOURNEY_THUMBNAIL_MAX_ATTEMPTS`
  - `READING_JOURNEY_THUMBNAIL_OUTPUT_ROOT`
- Reuse the existing repo pattern of CLI smoke scripts for real API verification, but keep unit tests offline and payload-only.
- Update `ai-services.md` with the new backend-only image generation pathway and the rule that browser clients never call Google image APIs directly.

**Step 4: Run test and smoke verification**

Run:

1. `node tests/reading-journey-thumbnail-generator.test.js`
2. `node scripts/test-reading-journey-thumbnail-generator.js --dry-run`

Expected:

- test exits `0`
- dry run prints a normalized request preview without making a network call

**Step 5: Commit**

```bash
git add src/services/reading-journey/thumbnail-generator.js tests/reading-journey-thumbnail-generator.test.js scripts/test-reading-journey-thumbnail-generator.js docs/specs/features/ai-services.md
git commit -m "feat: add reading journey thumbnail generator adapter"
```

### Task 5: Add Immediate Multimodal Audit And Repair Loop

**Files:**
- Create: `src/services/reading-journey/thumbnail-audit.js`
- Create: `tests/reading-journey-thumbnail-audit.test.js`
- Create: `scripts/audit/run-reading-journey-thumbnail-audit.js`

**Step 1: Write the failing audit test**

- Assert that `auditThumbnail()`:
  - evaluates universal criteria and story criteria separately
  - returns per-criterion pass/fail with explanation
  - marks blocking failures distinctly
  - emits a `repairPromptDelta` when the result is fixable
- Assert that `shouldRetryThumbnail()` retries on:
  - missing key character
  - wrong setting
  - unreadable composition
  - text/watermark artifacts
- Assert that the retry policy stops after the configured max attempts.

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-thumbnail-audit.test.js`

Expected: FAIL because no audit loop exists yet.

**Step 3: Write minimal implementation**

- Create an audit service that sends the generated image plus the `ThumbnailAuditSpec` to a multimodal Gemini evaluator and requests strict JSON output.
- Make every criterion atomic so repair prompts can be generated as targeted deltas instead of full rewrites.
- Implement:
  - `auditThumbnail()`
  - `buildRepairPromptDelta()`
  - `shouldRetryThumbnail()`
  - `summarizeAuditForLogs()`
- Add a CLI audit runner that can score a generated image from disk and write a report JSON under `docs/audits/reading-journey-thumbnails/YYYY-MM-DD/`.

**Step 4: Run test and local audit smoke**

Run:

1. `node tests/reading-journey-thumbnail-audit.test.js`
2. `node scripts/audit/run-reading-journey-thumbnail-audit.js --sample-report`

Expected:

- test exits `0`
- sample report is written under `docs/audits/reading-journey-thumbnails/<today>/`

**Step 5: Commit**

```bash
git add src/services/reading-journey/thumbnail-audit.js tests/reading-journey-thumbnail-audit.test.js scripts/audit/run-reading-journey-thumbnail-audit.js
git commit -m "feat: add reading journey thumbnail audit loop"
```

### Task 6: Persist Thumbnail Records And Expose Backend Endpoints

**Files:**
- Modify: `src/services/reading-journey/cache.js`
- Modify: `src/routes/reading-journey.js`
- Create: `tests/reading-journey-thumbnail-routes.test.js`

**Step 1: Write the failing route-contract test**

- Assert that the backend exposes:
  - `POST /api/reading-journey/thumbnails/generate`
  - `POST /api/reading-journey/thumbnails/regenerate`
  - `GET /api/reading-journey/thumbnails/:storyId`
- Assert that route responses include:
  - `summary`
  - `promptSpec`
  - `auditSpec`
  - `generation`
  - `audit`
- Assert that cache writes never store raw user free-text beyond the already-generated story transcript and normalized thumbnail contracts.

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-thumbnail-routes.test.js`

Expected: FAIL because no thumbnail routes exist yet.

**Step 3: Write minimal implementation**

- Add a thumbnail cache collection or file-backed equivalent with versioned ids tied to `outlineId` or `storyId`.
- Implement route handlers for:
  - batch-safe thumbnail generation for an existing story
  - regeneration from a failed audit
  - retrieval for the library UI
- Preserve the Reading Journey feature-flag behavior: if Reading Journey is off, thumbnail routes should also return `404`.

**Step 4: Run test to verify it passes**

Run: `node tests/reading-journey-thumbnail-routes.test.js`

Expected: PASS with route-shape assertions satisfied.

**Step 5: Commit**

```bash
git add src/services/reading-journey/cache.js src/routes/reading-journey.js tests/reading-journey-thumbnail-routes.test.js
git commit -m "feat: add reading journey thumbnail routes and persistence"
```

### Task 7: Backfill Existing Stories And Produce Audit Artifacts

**Files:**
- Create: `scripts/generate-reading-journey-thumbnails.js`
- Create: `tests/reading-journey-thumbnail-batch.test.js`
- Modify: `docs/specs/features/reading-journey.md`

**Step 1: Write the failing batch-runner test**

- Assert that the batch script can:
  - read existing outlines/stories
  - skip stories with approved thumbnails unless `--force`
  - cap concurrency
  - emit summary JSON for pass/fail counts
- Assert that audit artifacts are written under the feature-specific `docs/audits/reading-journey-thumbnails/YYYY-MM-DD/` directory.

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-thumbnail-batch.test.js`

Expected: FAIL because the batch runner does not exist yet.

**Step 3: Write minimal implementation**

- Create a CLI batch runner matching existing Reading Journey simulation patterns:
  - `--count`
  - `--outline-id`
  - `--force`
  - `--start-server`
  - `--port`
  - `--concurrency`
  - `--max-attempts`
- Update `reading-journey.md` to mention the thumbnail subsystem and its artifact output path.

**Step 4: Run test and smoke verification**

Run:

1. `node tests/reading-journey-thumbnail-batch.test.js`
2. `node scripts/generate-reading-journey-thumbnails.js --count 3 --dry-run`

Expected:

- test exits `0`
- dry run prints the selected stories plus planned output paths and exits cleanly

**Step 5: Commit**

```bash
git add scripts/generate-reading-journey-thumbnails.js tests/reading-journey-thumbnail-batch.test.js docs/specs/features/reading-journey.md
git commit -m "feat: add reading journey thumbnail batch generator"
```

### Task 8: Render Thumbnails In The Story Library

**Files:**
- Modify: `public/js/reading-journey.js`
- Modify: `public/style.css`
- Modify: `public/index.html`
- Create: `tests/reading-journey-thumbnail-ui.test.js`

**Step 1: Write the failing UI-shape test**

- Assert that story library cards can render:
  - thumbnail image
  - loading/fallback placeholder
  - audit-failed badge or hidden state for rejected thumbnails
- Assert that missing thumbnails do not break the library and fall back to text-only cards.

**Step 2: Run test to verify it fails**

Run: `node tests/reading-journey-thumbnail-ui.test.js`

Expected: FAIL because the library card renderer does not yet consume thumbnail data.

**Step 3: Write minimal implementation**

- Update `public/js/reading-journey.js` to request thumbnail metadata when loading the story library.
- Render approved thumbnails only. Do not show failed or blocked generations to end users.
- Preserve current behavior if no thumbnail exists.
- Add minimal CSS for image ratio, placeholder handling, and small-card readability.

**Step 4: Run test to verify it passes**

Run: `node tests/reading-journey-thumbnail-ui.test.js`

Expected: PASS with stable card markup expectations.

**Step 5: Commit**

```bash
git add public/js/reading-journey.js public/style.css public/index.html tests/reading-journey-thumbnail-ui.test.js
git commit -m "feat: render reading journey thumbnails in story library"
```

### Task 9: Full Verification And Manual Review

**Files:**
- Modify: `docs/specs/features/reading-journey-thumbnails.md`
- Modify: `docs/specs/features/ai-services.md`

**Step 1: Run the focused automated suite**

Run:

1. `node tests/reading-journey-thumbnail-contracts.test.js`
2. `node tests/reading-journey-thumbnail-summary.test.js`
3. `node tests/reading-journey-thumbnail-prompt.test.js`
4. `node tests/reading-journey-thumbnail-generator.test.js`
5. `node tests/reading-journey-thumbnail-audit.test.js`
6. `node tests/reading-journey-thumbnail-routes.test.js`
7. `node tests/reading-journey-thumbnail-batch.test.js`
8. `node tests/reading-journey-thumbnail-ui.test.js`

Expected: all commands exit `0`.

**Step 2: Run end-to-end smoke**

Run:

1. `node scripts/generate-reading-journey-thumbnails.js --count 5 --start-server --port 8792`
2. `node scripts/audit/run-reading-journey-thumbnail-audit.js --latest`

Expected:

- at least 5 stories receive generation records
- each story has an audit JSON artifact
- rejected images either regenerate successfully or remain explicitly marked `rejected`

**Step 3: Manual review checklist**

- Verify library cards show only approved thumbnails.
- Verify at least one audit failure produced a useful repair delta instead of a vague retry.
- Verify thumbnails still communicate the story when viewed at small-card size.
- Verify no generated image contains visible text artifacts, stray limbs, or setting/story mismatches.
- Verify logs do not expose secrets or raw Google credentials.

**Step 4: Final documentation pass**

- Update the thumbnail spec with any final env var names, route shapes, and operational notes discovered during smoke testing.
- Update AI services docs if the final model names differ from the initial draft.

**Step 5: Commit**

```bash
git add docs/specs/features/reading-journey-thumbnails.md docs/specs/features/ai-services.md
git commit -m "docs: finalize reading journey thumbnail verification notes"
```
