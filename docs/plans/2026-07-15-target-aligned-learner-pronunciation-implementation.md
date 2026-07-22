# Target-Aligned Learner Pronunciation Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Restore predetermined-count learner segmentation so every valid recording receives one measured feedback region per expected syllable.

**Architecture:** Keep the modern V2 response and frontend feedback contracts, but enable the existing Praat expected-count adjustment for learner audio. Keep V3 dormant behind an explicit client feature flag so backend health configuration cannot silently replace the approved production policy.

**Tech Stack:** Python 3.14, Flask, Parselmouth/Praat, JavaScript ES modules, Node test runner, Chrome/Playwright.

---

## Preconditions and boundaries

- Work from `C:\Cursor AI` on the existing pronunciation branch.
- Preserve unrelated dirty files; stage only files named in this plan.
- Do not deploy or push. Production deployment requires separate explicit approval.
- Keep no-speech rejection unchanged.
- Do not delete the V3 implementation; make its learner use opt-in only.
- The approved behavior is pedagogical target alignment, not independent omission/insertion recognition.

### Task 1: Specify learner target alignment in backend tests

**Files:**
- Modify: `backend/test_pronunciation_alignment_v2.py:121-140`
- Test: `backend/test_pronunciation_alignment_v2.py`

**Step 1: Replace the non-forcing learner expectation with a target-aligned expectation**

Rename the existing learner test to `test_learner_v2_uses_target_aligned_acoustic_feedback`. Make it expect:

```python
analyze.assert_called_once_with(
    "learner.wav",
    expected_syllables=4,
)
```

Add a focused response-contract test that calls `build_analysis_v2_response()` with two valid syllable regions and `expected_syllable_count=2`, then asserts:

```python
self.assertEqual(
    result["segmentation"]["method"],
    "target-aligned-acoustic-feedback",
)
self.assertEqual(result["observed"]["syllableCount"], 2)
```

**Step 2: Run the focused tests and verify RED**

Run:

```powershell
python -m unittest `
  backend.test_pronunciation_alignment_v2.PronunciationAlignmentV2Test.test_learner_v2_uses_target_aligned_acoustic_feedback `
  backend.test_pronunciation_alignment_v2.PronunciationAlignmentV2Test.test_learner_v2_labels_target_aligned_feedback -v
```

Expected: FAIL because learner V2 currently calls `allow_expected_adjustment=False` and labels its method `independent-acoustic-detection`.

### Task 2: Enable backend target-aligned segmentation

**Files:**
- Modify: `backend/local_server/server.py:1825-1906`
- Test: `backend/test_pronunciation_alignment_v2.py`

**Step 1: Implement the minimal backend policy**

In `analyze_audio_v2()`:

- keep native behavior unchanged;
- for learner audio, call `analyze_audio(audio_path, expected_syllables=expected_syllable_count)` so the existing default `allow_expected_adjustment=True` applies;
- replace the obsolete independent-detection comment with the approved target-alignment contract.

In `build_analysis_v2_response()`, set learner segmentation method to:

```python
(
    "target-aligned-acoustic-feedback"
    if expected_syllable_count
    else "independent-acoustic-detection"
)
```

Do not change the early no-speech behavior in `detect_syllables()`.

**Step 2: Run the focused tests and verify GREEN**

Run the Task 1 command again.

Expected: both tests PASS.

**Step 3: Run the backend pronunciation regression group**

Run:

```powershell
python -m unittest `
  backend.test_pronunciation_alignment_v2 `
  backend.test_pronunciation_api_v2 `
  backend.test_vowel_end_clamp -v
```

Expected: PASS. Silence/no-speech tests remain unrateable.

**Step 4: Commit the backend behavior**

```powershell
git add backend/local_server/server.py backend/test_pronunciation_alignment_v2.py
git commit -m "fix: restore target-aligned learner syllables"
```

### Task 3: Specify V2 as the production learner client

**Files:**
- Modify: `tests/pronunciation-analyzer/praat-api-v2.test.mjs:1-180`
- Test: `tests/pronunciation-analyzer/praat-api-v2.test.mjs`

**Step 1: Write the production-policy test**

Import `config` and add a test named `analyze() stays on v2 when production v3 learner analysis is disabled`. Mock `/health` as `active`, call `analyze()` with expected count `2`, and assert:

```javascript
assert.ok(fetchCalls.some((url) => url.includes('/analyze/v2')));
assert.ok(!fetchCalls.some((url) => url.includes('/analyze/v3')));
```

Update the existing explicit active/shadow delegation tests to set the future opt-in flag to `true`, preserving coverage for dormant V3 code.

**Step 2: Run the client test and verify RED**

Run:

```powershell
node --no-warnings tests/pronunciation-analyzer/praat-api-v2.test.mjs
```

Expected: FAIL because `PraatAPI.analyze()` currently follows backend health and calls V3 whenever mode is active or shadow.

### Task 4: Add the explicit learner-analysis feature flag

**Files:**
- Modify: `public/pronunciation-analyzer/config.js:34-39`
- Modify: `public/pronunciation-analyzer/praat-api.js:72-105`
- Test: `tests/pronunciation-analyzer/praat-api-v2.test.mjs`

**Step 1: Implement the minimal client policy**

Add this production-default feature flag:

```javascript
usePronunciationV3LearnerAnalysis: false
```

In `PraatAPI.analyze()`, perform the V3 health/delegation check only when that flag is exactly `true`. Otherwise post directly to `/analyze/v2`, including `expected_syllables` as it already does.

Keep `checkV3Support()` and `analyzeV3()` intact for future explicitly approved experiments.

**Step 2: Run the client test and verify GREEN**

Run the Task 3 command again.

Expected: all Praat API tests PASS, including explicit opt-in V3 coverage.

**Step 3: Run all pronunciation logic tests**

Run:

```powershell
npm run test:pronounce:logic
```

Expected: PASS.

**Step 4: Commit the client policy**

```powershell
git add public/pronunciation-analyzer/config.js public/pronunciation-analyzer/praat-api.js tests/pronunciation-analyzer/praat-api-v2.test.mjs
git commit -m "fix: keep learner feedback on target-aligned v2"
```

### Task 5: Verify the real saved `busy` recording

**Files:**
- Read only: `test-results/single-sample-pronunciation-busy/audio/busy-clean-l1-vn-01-20260715-161035647.wav`

**Step 1: Start or reuse the local pronunciation backend**

Verify:

```powershell
Invoke-RestMethod -SkipCertificateCheck https://localhost:8081/health
```

Expected: HTTP 200 with the pronunciation backend health payload.

**Step 2: Post the saved WAV to `/analyze/v2` with `expected_syllables=2`**

Use the existing Python `requests` environment to submit the real WAV as multipart form data.

Expected response:

- HTTP 200;
- `analysisVersion` is `pronunciation-analysis-v2`;
- `observed.syllableCount` is `2`;
- `observed.syllables` contains two positive-duration regions;
- `segmentation.method` is `target-aligned-acoustic-feedback`;
- `quality.rateable` is true.

**Step 3: Prove silence protection remains intact**

Run the existing no-speech/backend tests again rather than fabricating a target-aligned result for silence.

Expected: no-speech cases remain empty and unrateable.

### Task 6: Run final regression and Chrome verification

**Files:** None expected beyond earlier tasks.

**Step 1: Run the full backend suite**

```powershell
python -m unittest discover -s backend -p "test_*.py"
```

Expected: PASS, with only documented environment/corpus skips.

**Step 2: Run the pronunciation verification suite**

```powershell
npm run verify:pronounce
```

Expected: logic tests and both Chrome browser checks PASS.

**Step 3: Check repository hygiene for scoped files**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors. Unrelated pre-existing dirty files remain untouched and are reported separately.

**Step 4: Record deployment readiness**

Report the real-WAV result, focused tests, full backend tests, and Chrome verification. Do not deploy or push until the user gives explicit production approval.
