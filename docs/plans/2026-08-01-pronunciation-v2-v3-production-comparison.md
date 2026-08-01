# Pronunciation V2/V3 Production Comparison Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load `executing-plans` to implement this plan task-by-task.

**Goal:** Let the authenticated production admin record once, compare complete V2 and V3 pronunciation analyses, preserve manual syllable marking, choose V2/V3/tie/neither, and permanently save the full comparison sample.

**Architecture:** Keep the normal learner path and global V3 shadow behavior unchanged. Add a single comparison-only Cloud Run response that returns independently normalized V2 and V3 payloads for the same WAV, an admin-gated comparison component in Pronounce mode, and a separate Firebase admin route/collection for full WAV plus judgment storage.

**Tech Stack:** Python/Flask/unittest, vanilla ES modules and Node test runner, WaveSurfer, Express/Firebase Functions, Firestore/Cloud Storage, Playwright Chrome, Cloud Build/Cloud Run/Firebase Hosting.

**Approved design:** `docs/plans/2026-08-01-pronunciation-v2-v3-production-comparison-design.md`

**Worktree:** `C:\Cursor AI-pronunciation-v2-v3-comparison`

---

## Non-negotiable contracts

- Existing `/analyze/v2` and `/analyze/v3` response behavior must remain backward-compatible.
- `PRONUNCIATION_V3_MODE=shadow` remains the global production mode.
- Comparison mode returns both versions only through the new comparison call; it does not become learner scoring.
- The comparison UI is visible only when its feature flag is enabled and `/api/admin/status` confirms the current user is an admin.
- The existing `#sv-manual-review` workflow and `/api/admin/dev/save-corpus-sample` route remain functional.
- Comparison records use their own collection/storage prefix and never enter the segmentation-training corpus implicitly.
- Four complete-result judgments are allowed: `v2`, `v3`, `tie`, `neither`.
- Partial engine failures save as `partial_failure` without an accuracy winner.
- All product behavior is implemented test-first.
- Browser verification is Chrome only. Login uses `C:\Cursor AI\.local\browser-test-credentials.md` without copying secrets into source or artifacts.
- Production deployment occurs only after the user approves this implementation plan.

---

### Task 1: Define the backend comparison response contract

**Files:**

- Modify: `backend/test_pronunciation_api_v2.py`
- Modify: `backend/local_server/server.py`

**Step 1: Write failing response-contract tests**

Add focused tests to `PronunciationV3ApiTest`:

```python
def test_compare_returns_v2_and_v3_while_global_mode_is_shadow(self):
    response = self.client.post('/analyze/compare', data=self.valid_comparison_form())
    self.assertEqual(response.status_code, 200)
    body = response.get_json()
    self.assertEqual(body['schemaVersion'], 'pronunciation-comparison-v1')
    self.assertEqual(body['mode'], 'comparison')
    self.assertEqual(body['v2']['status'], 'available')
    self.assertEqual(body['v3']['status'], 'available')
    self.assertEqual(body['context']['targetWord'], 'actual')

def test_compare_preserves_v2_when_v3_is_unavailable(self):
    response = self.client.post('/analyze/compare', data=self.valid_comparison_form())
    body = response.get_json()
    self.assertEqual(body['v2']['status'], 'available')
    self.assertEqual(body['v3']['status'], 'unavailable')
    self.assertEqual(body['v3']['reason'], 'MODEL_INFERENCE_FAILED')
```

Also cover:

- missing audio returns 400;
- missing/invalid reference IPA returns 400 rather than `REFERENCE_CONFLICT` in a successful payload;
- reference syllable count conflicts return 400;
- V2 failure does not discard a structurally valid V3 result when the V3 path remains available;
- both unavailable returns a normalized 503 comparison body;
- comparison IDs are stable-format, opaque, and unique;
- the existing `/analyze/v3` shadow test still returns the V2-adapted response.

**Step 2: Run the tests and confirm RED**

```powershell
python -m unittest backend.test_pronunciation_api_v2.PronunciationV3ApiTest -v
```

Expected: new tests fail because `/analyze/compare` does not exist; existing tests remain green.

**Step 3: Extract reusable V3 orchestration**

In `backend/local_server/server.py`, extract the internal work currently embedded in `analyze_v3()` into a request-independent helper that accepts:

```python
def run_v3_pipeline(
    tmp_path,
    *,
    wav_bytes,
    reference_ipa,
    expected_syllables,
    target_word,
    variant_id,
):
    ...
```

Return a typed dictionary containing the untargeted Praat result, phoneme result, normalized error/reason, elapsed time, request reference ID, and shadow telemetry fields. Keep the existing timeout/cancellation behavior.

Refactor `/analyze/v3` to call the helper without changing its `off`, `shadow`, or `active` outputs.

**Step 4: Implement `/analyze/compare` minimally**

The endpoint must:

1. validate and save the WAV once;
2. validate `reference_ipa`, `expected_syllables`, `target_word`, and `variant_id`;
3. run the current target-aligned V2 learner analysis;
4. run the V3 pipeline from the same WAV;
5. build independent `v2` and `v3` availability envelopes;
6. include context and exact revision metadata;
7. return partial success with HTTP 200 when one engine is available;
8. return 503 only when neither engine is available;
9. remove the temporary WAV in `finally`.

Do not change `_PRONUNCIATION_V3_MODE` and do not expose stored data.

**Step 5: Run GREEN and regression tests**

```powershell
python -m unittest backend.test_pronunciation_api_v2.PronunciationV3ApiTest -v
python -m unittest backend.test_pronunciation_alignment_v2 backend.test_phoneme_client -v
python -m py_compile backend/local_server/server.py
```

Expected: all commands exit 0; existing shadow behavior remains covered.

**Step 6: Commit**

```powershell
git add backend/local_server/server.py backend/test_pronunciation_api_v2.py
git commit -m "feat(pronunciation): return paired V2 V3 comparison"
```

---

### Task 2: Add the browser comparison API client

**Files:**

- Modify: `tests/pronunciation-analyzer/praat-api-v2.test.mjs`
- Modify: `public/pronunciation-analyzer/praat-api.js`

**Step 1: Write failing client tests**

Add tests proving `analyzeComparison()`:

- posts one WAV to `/analyze/compare`;
- includes `reference_ipa`, `expected_syllables`, `target_word`, and `variant_id`;
- returns both V2 and V3 envelopes unchanged;
- throws the backend message for a total failure;
- preserves a successful partial response;
- does not depend on `usePronunciationV3LearnerAnalysis`.

Example assertion:

```javascript
const result = await api.analyzeComparison(audio, {
    referenceIpa: '/ˈæktʃuəl/',
    expectedSyllables: 3,
    targetWord: 'actual',
    variantId: 'cmudict:actual'
});
assert.equal(capturedUrl, 'https://backend.test/analyze/compare');
assert.equal(capturedBody.get('reference_ipa'), '/ˈæktʃuəl/');
assert.equal(result.mode, 'comparison');
```

**Step 2: Confirm RED**

```powershell
node --no-warnings tests/pronunciation-analyzer/praat-api-v2.test.mjs
```

Expected: comparison tests fail because the method is missing.

**Step 3: Implement the minimal client method**

Reuse `ensureWav()` and the existing option naming. Do not route the comparison through `analyze()` and do not change the learner flag.

**Step 4: Confirm GREEN**

```powershell
node --no-warnings tests/pronunciation-analyzer/praat-api-v2.test.mjs
```

Expected: all client tests pass.

**Step 5: Commit**

```powershell
git add public/pronunciation-analyzer/praat-api.js tests/pronunciation-analyzer/praat-api-v2.test.mjs
git commit -m "feat(pronunciation): add comparison API client"
```

---

### Task 3: Build the comparison state and payload model

**Files:**

- Create: `public/pronunciation-analyzer/version-comparison.js`
- Create: `tests/pronunciation-analyzer/version-comparison.test.mjs`
- Modify: `package.json`

**Step 1: Write failing pure-logic tests**

Define the wished-for exports in tests:

```javascript
import {
    buildComparisonViewModel,
    buildComparisonSaveMetadata,
    isCompleteComparison,
    normalizeComparisonReason
} from '../../public/pronunciation-analyzer/version-comparison.js';
```

Cover:

- aligned V2/V3 row labels and counts;
- unavailable reasons using stable readable copy;
- complete versus partial comparison state;
- exactly four allowed judgments for complete comparisons;
- no winner accepted for partial failures;
- manual segments copied and normalized without mutating the verifier state;
- raw payloads remain serializable but typed arrays/binary data are omitted;
- generated metadata contains comparison/service/model revisions;
- save payload has no client-supplied UID/email/timestamps.

**Step 2: Confirm RED**

```powershell
node --no-warnings tests/pronunciation-analyzer/version-comparison.test.mjs
```

Expected: module-not-found failure.

**Step 3: Implement the pure model**

Keep DOM-free functions separate from rendering. Use the enums:

```javascript
export const COMPARISON_JUDGMENTS = Object.freeze(['v2', 'v3', 'tie', 'neither']);
export const COMPARISON_STATUSES = Object.freeze(['complete', 'partial_failure']);
```

**Step 4: Confirm GREEN and wire the logic suite**

Add the new test to `test:pronounce:logic`, then run:

```powershell
npm run test:pronounce:logic
```

Expected: the complete pronunciation logic suite exits 0.

**Step 5: Commit**

```powershell
git add public/pronunciation-analyzer/version-comparison.js tests/pronunciation-analyzer/version-comparison.test.mjs package.json
git commit -m "feat(pronunciation): model V2 V3 judgments"
```

---

### Task 4: Preserve manual boundaries while switching V2/V3 inspection

**Files:**

- Modify: `tests/pronunciation-analyzer/syllable-verifier.test.mjs`
- Modify: `public/pronunciation-analyzer/syllable-verifier.js`

**Step 1: Write failing verifier tests**

Add coverage for a new method:

```javascript
verifier.setAutomaticSyllables(v3Syllables, labels, ipaSegments);
assert.deepEqual(verifier.manualSegments, originalManualSegments);
assert.equal(verifier.manualReviewActive, true);
```

Verify:

- switching automatic boundaries redraws only automatic regions;
- manual regions, pending manual start, manual convention, and unsaved state persist;
- playback buttons use the newly selected automatic spans;
- the existing `Save to cloud` manual-review button and callback are unchanged;
- `loadAudio()` still clears state for a genuinely new recording.

**Step 2: Confirm RED**

```powershell
node --no-warnings tests/pronunciation-analyzer/syllable-verifier.test.mjs
```

Expected: failure because `setAutomaticSyllables` is missing.

**Step 3: Implement automatic-boundary replacement**

Extract automatic-region drawing from `loadAudio()`. The new method must not recreate WaveSurfer or reset manual state. Keep `loadAudio()` as the new-recording reset boundary.

**Step 4: Confirm GREEN**

```powershell
node --no-warnings tests/pronunciation-analyzer/syllable-verifier.test.mjs
```

Expected: all verifier tests pass.

**Step 5: Commit**

```powershell
git add public/pronunciation-analyzer/syllable-verifier.js tests/pronunciation-analyzer/syllable-verifier.test.mjs
git commit -m "feat(pronunciation): preserve manual spans across version views"
```

---

### Task 5: Implement the admin comparison UI

**Files:**

- Modify: `public/index.html`
- Modify: `public/pronunciation-analyzer/config.js`
- Modify: `public/pronunciation-analyzer/app.js`
- Modify: `public/pronunciation-analyzer/style.css`
- Modify: `tests/browser/pronounce-mode-browser-check.js`

**Step 1: Add failing DOM/browser assertions**

Extend the existing Pronounce harness to assert:

- non-admin sessions keep the current single-result workflow;
- authenticated admins see `#pa-version-comparison`;
- one captured WAV triggers exactly one `/analyze/compare` request;
- V2 and V3 use identical metric labels and render their distinct counts/spans;
- four real radio choices are keyboard reachable;
- Save remains disabled until a choice is made;
- V2/V3 boundary toggles call `setAutomaticSyllables` without clearing manual spans;
- the existing manual-review control is still visible and functional;
- partial failure hides the winner fieldset and shows `Save comparison failure`;
- a new recording clears prior comparison state only after the intended reset path;
- mobile layout stacks V2 then V3 without horizontal overflow.

**Step 2: Confirm RED**

```powershell
node tests/browser/pronounce-mode-browser-check.js
```

Expected: new assertions fail because the comparison DOM/behavior is absent.

**Step 3: Add stable DOM structure**

In `public/index.html`, add one non-nested comparison section after `#pa-results-summary`:

- `#pa-version-comparison`, hidden by default;
- `#pa-version-v2` and `#pa-version-v3` aligned regions;
- `#pa-version-boundary-source` toggle group;
- `#pa-version-judgment` fieldset with four radios;
- `#pa-version-save` button;
- `#pa-version-save-status` polite live region;
- `#pa-version-technical-details` disclosure.

Do not rename or remove existing Pronounce IDs.

**Step 4: Add the admin feature gate and app flow**

Add `showPronunciationVersionComparison: true` to `config.features`. Reuse one cached admin-status promise for comparison and manual-review access.

When comparison mode is authorized, `stopRecording()` must:

1. keep the captured audio blob;
2. call `praatAPI.analyzeComparison()`;
3. render the view model;
4. load the shared waveform using V2 boundaries initially when available, otherwise V3;
5. retain `onManualSegmentsChange` output in comparison state;
6. allow source toggles without resetting manual state;
7. submit only through the explicit comparison save action.

Non-admin sessions must continue through `analyzeRecordedAttempt()` unchanged.

**Step 5: Style the comparison intentionally**

Extend `style.css` using existing Pronounce variables and typography. Use a clean editorial comparison table/columns on the parent container background—no boxes inside boxes. Provide:

- aligned row baselines on desktop;
- clear V2/V3 headings without declaring a winner;
- visible focus/selected/unavailable states not dependent on color;
- compact technical details;
- mobile stacking at the existing breakpoint;
- reduced-motion compliance.

**Step 6: Confirm GREEN**

```powershell
node tests/browser/pronounce-mode-browser-check.js
npm run test:pronounce:logic
```

Expected: both commands exit 0 and the existing manual-review assertions remain green.

**Step 7: Commit**

```powershell
git add public/index.html public/pronunciation-analyzer/config.js public/pronunciation-analyzer/app.js public/pronunciation-analyzer/style.css tests/browser/pronounce-mode-browser-check.js
git commit -m "feat(pronunciation): show admin V2 V3 comparison"
```

---

### Task 6: Add permanent admin-only comparison storage

**Files:**

- Create: `functions/src/routes/admin/pronunciation-comparisons.js`
- Modify: `functions/src/routes/admin/create-crm-router.js`
- Modify: `functions/src/routes/admin/pronunciation-corpus.js`
- Create: `tests/crm/pronunciation-comparison-production-route.test.js`
- Modify: `tests/crm/sync-from-prod-router-contract.test.js`

**Step 1: Write failing validator and route tests**

Test the new route `POST /dev/save-analysis-comparison` for:

- admin middleware presence and unauthenticated rejection;
- required PCM WAV and maximum 5 MB / 15 seconds;
- collection `pronunciation_analysis_comparisons`;
- storage path `pronunciation-analysis-comparisons/<comparisonId>.wav`;
- complete judgments limited to `v2`, `v3`, `tie`, `neither`;
- partial failures rejecting any winner;
- non-empty word/reference/context;
- V2 and V3 analysis JSON size limits;
- manual spans ordered, non-overlapping, and inside actual WAV duration;
- source hash computed server-side;
- UID/email/timestamps overwritten server-side;
- successful response includes comparison ID, record summary, and signed audio URL;
- storage/Firestore failures return stable error codes.

**Step 2: Confirm RED**

```powershell
node tests/crm/pronunciation-comparison-production-route.test.js
node tests/crm/sync-from-prod-router-contract.test.js
```

Expected: route/module assertions fail because the comparison route is absent.

**Step 3: Share existing safe validators**

Export the existing timing normalizer from `pronunciation-corpus.js` without changing its corpus behavior. Reuse `validateWavBuffer` and timing normalization in the new route rather than duplicating WAV parsing.

**Step 4: Implement and register the route**

Use the existing multipart raw-body handling pattern and `requireAdminHandlers`. Bound each raw analysis JSON payload to 256 KB and the complete metadata body to 640 KB before Firestore persistence.

Store only serializable JSON and server-derived identity/timestamps. Save audio before Firestore; if Firestore fails after upload, delete the newly uploaded comparison object as compensating cleanup.

**Step 5: Confirm GREEN and CRM lint**

```powershell
node tests/crm/pronunciation-comparison-production-route.test.js
node tests/crm/pronunciation-corpus-production-route.test.js
node tests/crm/sync-from-prod-router-contract.test.js
npm run lint:crm
```

Expected: all commands exit 0.

**Step 6: Commit**

```powershell
git add functions/src/routes/admin/pronunciation-comparisons.js functions/src/routes/admin/create-crm-router.js functions/src/routes/admin/pronunciation-corpus.js tests/crm/pronunciation-comparison-production-route.test.js tests/crm/sync-from-prod-router-contract.test.js
git commit -m "feat(pronunciation): store admin comparison samples"
```

---

### Task 7: Wire comparison saving from the UI

**Files:**

- Modify: `tests/pronunciation-analyzer/version-comparison.test.mjs`
- Modify: `public/pronunciation-analyzer/version-comparison.js`
- Modify: `public/pronunciation-analyzer/app.js`
- Modify: `tests/browser/pronounce-mode-browser-check.js`

**Step 1: Write failing save-flow tests**

Cover:

- WAV conversion before upload;
- Firebase ID token attached to `/api/admin/dev/save-analysis-comparison`;
- complete comparison metadata plus selected judgment;
- manual segments included when present;
- partial failure sent without judgment;
- double-click/in-flight duplicate prevention;
- save success displays comparison ID;
- 401 prompts reauthentication but retains state;
- network/5xx error retains audio, results, vote, and manual segments for retry;
- existing manual `Save to cloud` continues to call `/api/admin/dev/save-corpus-sample`.

**Step 2: Confirm RED**

```powershell
node --no-warnings tests/pronunciation-analyzer/version-comparison.test.mjs
node tests/browser/pronounce-mode-browser-check.js
```

Expected: save-flow assertions fail.

**Step 3: Implement explicit save**

Build `FormData` with WAV plus bounded metadata, acquire the current ID token, post to the new admin route, and update the live region. Do not auto-save on judgment selection.

**Step 4: Confirm GREEN**

```powershell
npm run test:pronounce:logic
node tests/browser/pronounce-mode-browser-check.js
node tests/crm/pronunciation-comparison-production-route.test.js
```

Expected: all commands exit 0.

**Step 5: Commit**

```powershell
git add public/pronunciation-analyzer/version-comparison.js public/pronunciation-analyzer/app.js tests/pronunciation-analyzer/version-comparison.test.mjs tests/browser/pronounce-mode-browser-check.js
git commit -m "feat(pronunciation): save V2 V3 comparison judgments"
```

---

### Task 8: Add a focused Chrome comparison contract

**Files:**

- Create: `tests/browser/pronounce-version-comparison-browser-check.js`
- Modify: `package.json`
- Artifacts: `test-results/pronunciation-v2-v3-comparison/`

**Step 1: Write the focused browser test before changing the runner**

The test must launch Chrome/Chromium only and assert the full admin flow using mocked backend/admin routes:

1. authenticated admin gate succeeds;
2. one recording produces one comparison request;
3. V2 and V3 render distinct counts and boundary sets;
4. switch V2 -> V3 -> manual without losing manual segments;
5. select each four-way judgment using keyboard controls;
6. save one complete comparison and validate multipart metadata;
7. render and save a partial failure;
8. reject duplicate save clicks;
9. stack correctly at mobile width;
10. preserve non-admin legacy behavior;
11. capture desktop and mobile screenshots;
12. fail on page errors, unhandled rejections, or relevant console errors.

**Step 2: Confirm RED**

```powershell
node tests/browser/pronounce-version-comparison-browser-check.js
```

Expected: failure because the feature contract is incomplete or the test is not yet wired.

**Step 3: Complete only the minimal fixes exposed by the focused test**

Use test-first fixes in the already-owned files. Do not expand into CRM history, batch analysis, or learner activation.

**Step 4: Confirm GREEN and add to the browser suite**

Add the focused script to `test:pronounce:browser`, then run:

```powershell
npm run test:pronounce:browser
```

Expected: the entire Chrome-only Pronounce browser suite exits 0 and screenshots exist at desktop/mobile sizes.

**Step 5: Visually inspect screenshots**

Verify aligned labels, no nested-card effect, no clipping, clear selection/focus states, readable unavailable reasons, and preserved manual waveform controls.

**Step 6: Commit**

```powershell
git add tests/browser/pronounce-version-comparison-browser-check.js package.json
git commit -m "test(pronunciation): cover production comparison workflow"
```

---

### Task 9: Run the complete pre-deployment verification gate

**Files:**

- Create: `docs/audits/pronunciation-v3/2026-08-01/v2-v3-comparison-verification.md`
- Artifacts: `test-results/pronunciation-v2-v3-comparison/`

**Step 1: Run backend verification**

```powershell
python -m py_compile backend/local_server/server.py
python -m unittest backend.test_pronunciation_api_v2 backend.test_pronunciation_alignment_v2 backend.test_phoneme_client -v
```

**Step 2: Run frontend and route verification**

```powershell
npm run test:pronounce:logic
node tests/crm/pronunciation-comparison-production-route.test.js
node tests/crm/pronunciation-corpus-production-route.test.js
node tests/crm/sync-from-prod-router-contract.test.js
npm run lint:crm
```

**Step 3: Run full Chrome verification**

```powershell
npm run test:pronounce:browser
```

**Step 4: Review the diff and artifacts**

```powershell
git status --short
git diff --check HEAD~8..HEAD
git diff --stat HEAD~8..HEAD
```

Confirm no audio, secret, credential, generated connected-speech artifact, hosting cache, or unrelated UI change is tracked.

**Step 5: Write the verification report**

Record exact commands, exit codes, test counts, screenshot paths, limitations, commit SHA, and the three deployment targets. Do not call the feature complete if any required command fails.

**Step 6: Commit**

```powershell
git add docs/audits/pronunciation-v3/2026-08-01/v2-v3-comparison-verification.md
git commit -m "docs(pronunciation): verify V2 V3 comparison"
```

---

### Task 10: Deploy Cloud Run, Functions, and Hosting to production

**Prerequisite:** Tasks 1–9 are green and the user has explicitly approved execution of this plan, including production deployment.

**Files:**

- Read: `docs/runbooks/pronunciation-backend.md`
- Build: `backend/cloudbuild.pronunciation.yaml`
- Local-only credentials: `C:\Cursor AI\.local\browser-test-credentials.md`
- Update after deployment: `docs/audits/pronunciation-v3/2026-08-01/v2-v3-comparison-verification.md`

**Step 1: Push the reviewed branch**

```powershell
git status --short
git push -u origin codex/pronunciation-v2-v3-comparison
```

Expected: clean status and remote SHA equals local HEAD.

**Step 2: Record all rollback baselines**

Read-only capture:

- current `praat-api` 100%-traffic revision/image/env;
- current Firebase Functions `api` revision;
- current Hosting release/version;
- existing Cloud Run mode remains `shadow`.

Redact secret values.

**Step 3: Build the immutable Cloud Run image**

```powershell
$comparisonSha = git rev-parse HEAD
gcloud builds submit . `
  --project parselmouth `
  --config backend/cloudbuild.pronunciation.yaml `
  --substitutions "_GIT_SHA=$comparisonSha"
```

Expected: successful build, immutable image digest recorded.

**Step 4: Deploy a tagged 0%-traffic Cloud Run candidate**

Follow `docs/runbooks/pronunciation-backend.md`. Preserve current service account, secrets, scaling, timeout, and all unrelated env. Explicitly keep `PRONUNCIATION_V3_MODE=shadow`.

Verify candidate `/health`, `/analyze/v2`, `/analyze/v3` shadow behavior, and `/analyze/compare` complete/partial contracts before traffic promotion.

**Step 5: Promote the exact verified Cloud Run revision**

Route by exact revision name, never `--to-latest`. Smoke `/health` and `/analyze/compare`; monitor 5xx, latency, restarts, auth errors, and shadow logs. Roll back to the recorded prior revision on contract or health failure.

**Step 6: Deploy only the Firebase `api` function**

```powershell
firebase deploy --only functions:api
```

Expected: Functions deployment completes and unauthenticated `/api/admin/dev/save-analysis-comparison` fails closed with 401/403. Verify the deployed function revision independently; do not infer success from Hosting.

**Step 7: Deploy Hosting**

```powershell
firebase deploy --only hosting
```

Expected: Hosting deployment completes and production serves the new comparison JS/CSS/HTML assets. Reconcile any predeploy-generated files before commit; never stage them automatically.

**Step 8: Run authenticated production Chrome verification**

Read the local credential file first. Using the admin account:

1. open production Pronounce mode;
2. confirm comparison UI is admin-only;
3. record a clearly labeled smoke word;
4. inspect both V2/V3 boundary sets;
5. add manual syllable segments;
6. select one of the four judgments;
7. save the full comparison;
8. verify success ID, Firestore record shape, signed audio retrieval, and revision metadata;
9. confirm existing manual `Save to cloud` remains usable;
10. confirm a guest/non-admin session retains the old single-result UI.

Save screenshots and redacted network evidence. Retain the smoke comparison with `isSmokeTest: true` unless the audit explicitly removes it.

**Step 9: Monitor and close**

Observe Cloud Run, Functions, and Hosting for at least 15 minutes. Record final live revisions, smoke comparison ID, monitoring result, and rollback commands in the verification report.

**Step 10: Commit deployment evidence**

```powershell
git add docs/audits/pronunciation-v3/2026-08-01/v2-v3-comparison-verification.md
git commit -m "docs(pronunciation): record production comparison deployment"
git push
```

Stage only the report update. Do not include credentials, audio, signed URLs, or generated artifacts.

---

## Completion criteria

- Production admin records once and sees both V2 and V3 results.
- V2 and V3 labels are aligned and neither is preselected as winner.
- V2/V3 boundary inspection preserves manually marked syllables.
- Four-way judgments save only after explicit confirmation.
- Full WAV, raw analyses, revisions, vote, and optional manual spans persist in the separate comparison store.
- Partial engine failures can be saved without a false winner.
- Existing learner flow and existing manual corpus-save function remain unchanged for non-admins.
- Cloud Run remains globally in V3 shadow mode.
- Backend, logic, route, Chrome, visual, and authenticated production evidence are all recorded.
- All three production layers have exact verified revisions and rollback targets.
