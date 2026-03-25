# Read Aloud Connected-Speech Hardening Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load `executing-plans` to implement this plan task-by-task.

**Goal:** Improve the current non-MFA connected-speech system by adding evaluation tooling, prompt-specific overrides, stronger abstention logic, better audio gating, richer Azure evidence use, clearer learner feedback, and edge-case coverage.

**Architecture:** Keep the current public contract and split between Node route and Python worker. Harden the existing heuristic scorer in place by making each event family more data-driven, more conservative when evidence is weak, and more observable in storage, metrics, and UI. Do not change the Phase 2 MFA boundary; this plan only improves the current system.

**Tech Stack:** Node/Express, vanilla JS frontend, Python Flask worker, Firebase Storage/Firestore, Azure Pronunciation Assessment, existing Node and Playwright test harnesses.

---

## Path Convention

- Evaluation datasets live under `data/evals/read-aloud-connected-speech/`.
- Evaluation and reporting scripts live under `scripts/evals/`.
- Validation docs for this feature live under `docs/audits/read-aloud-connected-speech/`.
- Test fixtures live under `tests/fixtures/read-aloud-connected-speech/` unless a test already embeds its fixture inline.

## Task 1: Create the Evaluation Artifacts and Validation Protocol

**Files:**
- Create: `data/evals/read-aloud-connected-speech/template.csv`
- Create: `docs/audits/read-aloud-connected-speech/validation.md`
- Create: `scripts/evals/read-aloud-connected-speech-metrics.js`
- Modify: `package.json`

**Step 1: Create the CSV template**

Create `data/evals/read-aloud-connected-speech/template.csv` with columns:

```csv
attemptId,questionId,eventId,family,phrase,referenceText,recognizedText,systemStatus,humanLabel,raterNotes,audioStatus,workerStatus,leftWord,rightWord,startMs,endMs,gapMs,leftAccuracy,rightAccuracy,relativeDuration,variant
```

**Step 2: Create the validation protocol**

Write `docs/audits/read-aloud-connected-speech/validation.md` with:
- label definitions: `detected`, `not_detected`, `uncertain`, `not_rateable`
- rating rules per family
- adjudication rule for disagreements
- launch thresholds per family
- abstention guidance for noisy or ambiguous clips

**Step 3: Add a failing metrics script test fixture**

Create a tiny sample CSV inside `tests/fixtures/read-aloud-connected-speech/sample-metrics.csv` with at least:
- one `detected`
- one `not_detected`
- one `uncertain`
- one `not_rateable`

**Step 4: Write the metrics script**

Create `scripts/evals/read-aloud-connected-speech-metrics.js` that:
- reads a CSV path from `process.argv[2]`
- groups rows by `family`
- prints counts for `detected`, `not_detected`, `uncertain`, `not_rateable`
- prints agreement counts when `humanLabel` is present
- exits non-zero on malformed input

**Step 5: Add package scripts**

Modify `package.json` and add:

```json
"eval:read-aloud:connected-speech": "node scripts/evals/read-aloud-connected-speech-metrics.js data/evals/read-aloud-connected-speech/template.csv"
```

**Step 6: Run the metrics script**

Run:

```bash
node scripts/evals/read-aloud-connected-speech-metrics.js tests/fixtures/read-aloud-connected-speech/sample-metrics.csv
```

Expected:
- exit code `0`
- console output includes each status bucket and at least one family summary

**Step 7: Commit**

```bash
git add data/evals/read-aloud-connected-speech/template.csv docs/audits/read-aloud-connected-speech/validation.md scripts/evals/read-aloud-connected-speech-metrics.js tests/fixtures/read-aloud-connected-speech/sample-metrics.csv package.json
git commit -m "docs: add connected speech validation artifacts"
```

## Task 2: Persist Richer Evidence for Labeling and Analytics

**Files:**
- Modify: `src/read-aloud/connected-speech-storage.js`
- Modify: `src/routes/read-aloud.js`
- Modify: `src/read-aloud/connected-speech-service.js`
- Test: `tests/read-aloud-route.test.js`

**Step 1: Write failing route assertions**

Extend `tests/read-aloud-route.test.js` to assert that persisted attempt records include:
- `audioStatus`
- `workerStatus`
- richer event evidence fields
- enough prompt and timing context to label an event offline

Add edge-case assertions for:
- `questionId` present but zero eligible events
- Azure success with missing word timings
- worker fallback path returning `uncertain`

**Step 2: Run the route test and confirm failure**

Run:

```bash
npm run test:read-aloud:route
```

Expected:
- at least one assertion failure about missing persistence fields

**Step 3: Expand the persistence record**

Modify `src/routes/read-aloud.js` and `src/read-aloud/connected-speech-storage.js` so stored attempt documents include:
- `audioStatus`
- `workerStatus`
- `connectedSpeechVersion`
- `eventFamilyCounts`
- `recognizedText`
- event-level evidence snapshots needed by the eval CSV exporter

Keep persistence best-effort and non-blocking.

**Step 4: Expose richer event evidence**

Modify `src/read-aloud/connected-speech-service.js` so event payloads consistently include:
- `eventId`
- `family`
- `phrase`
- `status`
- `confidence`
- `evidence.reason` where relevant
- timing and score values used in the decision

**Step 5: Re-run the route tests**

Run:

```bash
npm run test:read-aloud:route
```

Expected:
- `read-aloud route tests passed`

**Step 6: Commit**

```bash
git add src/read-aloud/connected-speech-storage.js src/routes/read-aloud.js src/read-aloud/connected-speech-service.js tests/read-aloud-route.test.js
git commit -m "feat: persist connected speech evidence for evaluation"
```

## Task 3: Expand the Prompt Override Bank and Family Config Surface

**Files:**
- Modify: `data/read-aloud/connected-speech-overrides.json`
- Modify: `src/read-aloud/connected-speech-service.js`
- Test: `tests/read-aloud-route.test.js`
- Test: `backend/test_connected_speech_worker.py`

**Step 1: Write failing tests for override-driven behavior**

Add tests for:
- prompt-specific suppression of weak generic events
- explicit yod coalescence templates
- explicit weak-form configs
- blocked boundaries across punctuation
- repeated words that must still resolve to the correct indexes

**Step 2: Run the targeted tests**

Run:

```bash
npm run test:read-aloud:route
python backend/test_connected_speech_worker.py
```

Expected:
- failures tied to missing override handling or incorrect event selection

**Step 3: Expand the override schema**

Modify `data/read-aloud/connected-speech-overrides.json` to support:
- `suppressBaselineEventIds`
- `blockedBoundaries`
- `extraEvents`
- per-family threshold overrides
- per-event feedback text overrides

**Step 4: Update event generation**

Modify `src/read-aloud/connected-speech-service.js` so it:
- merges generic and curated events deterministically
- blocks punctuation and forbidden boundaries before scoring
- resolves repeated words by index, never by text alone
- supports per-family detector config from overrides

**Step 5: Re-run the route and worker tests**

Run:

```bash
npm run test:read-aloud:route
python backend/test_connected_speech_worker.py
```

Expected:
- route test passes
- worker test prints `OK`

**Step 6: Commit**

```bash
git add data/read-aloud/connected-speech-overrides.json src/read-aloud/connected-speech-service.js tests/read-aloud-route.test.js backend/test_connected_speech_worker.py
git commit -m "feat: add curated connected speech override support"
```

## Task 4: Harden Scoring, Abstention, and Not-Rateable Handling

**Files:**
- Modify: `src/read-aloud/connected-speech-service.js`
- Modify: `backend/connected_speech_worker.py`
- Test: `backend/test_connected_speech_worker.py`
- Test: `tests/read-aloud-route.test.js`

**Step 1: Write failing worker and route cases**

Add tests for:
- family-specific thresholds instead of one generic gap rule
- low-confidence clips returning `uncertain`
- not-rateable inputs mapped safely at the API layer
- missing or out-of-order timing fields
- overlapping family eligibility on the same boundary

**Step 2: Run the failing tests**

Run:

```bash
python backend/test_connected_speech_worker.py
npm run test:read-aloud:route
```

Expected:
- failures on new `uncertain` and `not_rateable` cases

**Step 3: Introduce family-specific decision helpers**

Refactor both the Node fallback scorer and Python worker so each family has its own helper and thresholds:
- `catenation`
- `same_consonant_merge`
- `n_bilabial_assimilation`
- `yod_coalescence`
- `weak_form_reduction`

Each helper must:
- prefer abstention when evidence is weak
- emit a `reason` in `evidence`
- preserve existing response shape

**Step 4: Add not-rateable semantics internally**

Implement an internal `not_rateable` classification for:
- missing timing
- invalid spans
- clipped or truncated audio
- recognition too weak to support an event decision

Map it at the public response layer to a safe learner-facing status:
- either `uncertain` or `unavailable`, depending on source of failure

**Step 5: Re-run the tests**

Run:

```bash
python backend/test_connected_speech_worker.py
npm run test:read-aloud:route
```

Expected:
- worker test output shows all tests pass
- route test passes

**Step 6: Commit**

```bash
git add src/read-aloud/connected-speech-service.js backend/connected_speech_worker.py backend/test_connected_speech_worker.py tests/read-aloud-route.test.js
git commit -m "feat: harden connected speech scoring and abstention"
```

## Task 5: Improve Audio Quality Gating Before Event Scoring

**Files:**
- Modify: `src/routes/read-aloud.js`
- Modify: `backend/connected_speech_worker.py`
- Test: `tests/read-aloud-route.test.js`
- Test: `backend/test_connected_speech_worker.py`

**Step 1: Write failing audio-quality tests**

Add route or worker tests for:
- silence-only WAV
- clipping-heavy WAV
- truncated WAV data chunk
- too-low amplitude audio
- speech shorter than the prompt can plausibly contain

Reuse inline WAV generation patterns already present in the current tests.

**Step 2: Run the tests to confirm failure**

Run:

```bash
npm run test:read-aloud:route
python backend/test_connected_speech_worker.py
```

Expected:
- failures on new invalid-audio cases

**Step 3: Implement additional quality checks**

In `src/routes/read-aloud.js` and `backend/connected_speech_worker.py`, add lightweight checks for:
- RMS floor
- near-zero variance
- sample clipping ratio
- minimum active speech duration

Do not add heavyweight DSP dependencies in this phase.

**Step 4: Re-run the tests**

Run:

```bash
npm run test:read-aloud:route
python backend/test_connected_speech_worker.py
```

Expected:
- tests pass and invalid audio is downgraded or rejected consistently

**Step 5: Commit**

```bash
git add src/routes/read-aloud.js backend/connected_speech_worker.py tests/read-aloud-route.test.js backend/test_connected_speech_worker.py
git commit -m "feat: add audio quality gating for connected speech"
```

## Task 6: Use Richer Azure Evidence Without Changing the Public Contract

**Files:**
- Modify: `src/read-aloud/connected-speech-service.js`
- Modify: `src/routes/read-aloud.js`
- Test: `tests/read-aloud-route.test.js`
- Test: `backend/test_connected_speech_worker.py`

**Step 1: Add failing tests for richer Azure evidence**

Cover:
- phoneme evidence present and improves a weak-form decision
- phoneme evidence missing and scorer falls back gracefully
- recognized text diverges from prompt and system abstains more aggressively

**Step 2: Run the tests**

Run:

```bash
npm run test:read-aloud:route
python backend/test_connected_speech_worker.py
```

Expected:
- failures tied to missing evidence extraction or fallback behavior

**Step 3: Extract and normalize more Azure evidence**

Modify the Node scorer to normalize, when available:
- per-word phoneme accuracy
- phoneme candidate strings
- word error type
- recognized text divergence flags

Use that evidence only to refine family decisions, not to widen scope.

**Step 4: Re-run the tests**

Run:

```bash
npm run test:read-aloud:route
python backend/test_connected_speech_worker.py
```

Expected:
- tests pass with both rich and sparse Azure payloads

**Step 5: Commit**

```bash
git add src/read-aloud/connected-speech-service.js src/routes/read-aloud.js tests/read-aloud-route.test.js backend/test_connected_speech_worker.py
git commit -m "feat: incorporate richer Azure evidence into connected speech scoring"
```

## Task 7: Improve Learner Feedback and Browser Regression Coverage

**Files:**
- Modify: `public/read-aloud-mode.js`
- Modify: `public/index.html`
- Test: `tests/read-aloud-mode-regression.test.js`

**Step 1: Add failing browser assertions**

Extend the regression test for:
- family-specific feedback text
- neutral rendering of `uncertain`
- safe rendering when `connectedSpeech.status = unavailable`
- no results block when `not_applicable`

**Step 2: Run the browser regression**

Run:

```bash
npm run test:read-aloud:browser
```

Expected:
- at least one failure around missing UI states or copy

**Step 3: Update the UI rendering**

Modify `public/read-aloud-mode.js` and `public/index.html` so the results block:
- uses family-specific guidance
- distinguishes `uncertain` from `not_detected`
- avoids alarming copy for unsupported judgments
- keeps the current layout stable on desktop and mobile

**Step 4: Re-run the browser regression**

Run:

```bash
npm run test:read-aloud:browser
```

Expected:
- `read-aloud mode regression test passed`

**Step 5: Commit**

```bash
git add public/read-aloud-mode.js public/index.html tests/read-aloud-mode-regression.test.js
git commit -m "feat: improve connected speech learner feedback"
```

## Task 8: Add Rollup Reporting and End-to-End Verification

**Files:**
- Create: `scripts/evals/read-aloud-connected-speech-report.js`
- Modify: `package.json`
- Verify: `tests/read-aloud-route.test.js`
- Verify: `tests/read-aloud-mode-regression.test.js`
- Verify: `backend/test_connected_speech_worker.py`

**Step 1: Create the reporting script**

Create `scripts/evals/read-aloud-connected-speech-report.js` to read exported attempt data and print:
- event counts by family
- abstention rate by family
- top failure reasons
- prompt IDs with highest disagreement

Use only built-in Node modules unless an existing dependency is already present.

**Step 2: Add the package script**

Modify `package.json` and add:

```json
"report:read-aloud:connected-speech": "node scripts/evals/read-aloud-connected-speech-report.js"
```

**Step 3: Run the full verification set**

Run:

```bash
npm run test:read-aloud:route
npm run test:read-aloud:browser
python backend/test_connected_speech_worker.py
```

Expected:
- route test prints `read-aloud route tests passed`
- browser test prints `read-aloud mode regression test passed`
- Python test prints `OK`

**Step 4: Run the eval tooling**

Run:

```bash
node scripts/evals/read-aloud-connected-speech-metrics.js tests/fixtures/read-aloud-connected-speech/sample-metrics.csv
node scripts/evals/read-aloud-connected-speech-report.js
```

Expected:
- both scripts exit `0`
- metrics output includes per-family counts
- report output includes at least one summary heading even when data is sparse

**Step 5: Commit**

```bash
git add scripts/evals/read-aloud-connected-speech-report.js scripts/evals/read-aloud-connected-speech-metrics.js package.json
git commit -m "chore: add connected speech reporting and final verification"
```

---

## Edge-Case Matrix

The implementation is not complete until these cases are covered by tests or explicit fallback handling:

### Prompt and tokenization

- repeated words such as `to to` or `did you did you`
- apostrophes and curly quotes in `don't you`
- punctuation boundaries that should block scoring
- prompts with zero eligible connected-speech events
- prompt text and override bank drifting out of sync

### Azure payload quality

- missing `Offset` or `Duration`
- words returned out of order
- recognized text diverges sharply from the prompt
- detailed phoneme evidence absent
- word count mismatch between prompt and Azure output

### Audio quality

- valid WAV container but silence-only content
- heavy clipping
- very low amplitude speech
- truncated recording
- short or partial utterance

### Decision conflicts

- one boundary qualifies for multiple families
- canonical fast speech being mistaken for linking
- reduction nearly deleting a function word
- user pauses intentionally at a grammatically valid place
- strong timing evidence but weak recognition evidence

### Service and storage behavior

- worker unavailable after Azure succeeds
- storage upload fails
- Firestore write fails
- stale assessment results arrive after prompt switch
- stale microphone permissions resolve after leaving Read Aloud

### UI behavior

- `not_applicable` hides the results block
- `uncertain` is neutral, not punitive
- `unavailable` does not hide Azure scores
- unsafe event text is escaped before rendering

## Final Validation Checklist

- `npm run test:read-aloud:route`
- `npm run test:read-aloud:browser`
- `python backend/test_connected_speech_worker.py`
- `node scripts/evals/read-aloud-connected-speech-metrics.js tests/fixtures/read-aloud-connected-speech/sample-metrics.csv`
- manual read-through of `docs/audits/read-aloud-connected-speech/validation.md`

All five must succeed before calling this hardening phase complete.
