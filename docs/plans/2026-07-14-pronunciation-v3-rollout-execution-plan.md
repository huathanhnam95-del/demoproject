# Pronunciation V3 Rollout Execution Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Produce real corpus-backed evidence for pronunciation V3, verify the candidate service, and only then authorize a shadow rollout.

**Architecture:** The browser and local regression paths are already repaired. The remaining work is an evidence pipeline: collect and label protected audio, benchmark the pinned phoneme model, build the recognizer image, run the candidate audit, and use shadow mode before any active promotion. The service must remain not-ready until the manifest contains verified evidence.

**Tech Stack:** Python 3.14, Flask, PyTorch/Transformers, WAV audio, JSON Schema, Docker, Google Cloud Run, Chrome/Playwright, PowerShell.

---

## Important rules before starting

- Work from `C:\Cursor AI`.
- Do not commit raw recordings, consent forms, names, account IDs, access tokens, or model credentials.
- Store local audio only under the ignored directory `test-results\pronunciation-segmentation-corpus\`.
- Do not deploy or push production until the explicit deployment step below is approved.
- The current tracked manifest is intentionally empty and the model manifest is intentionally pending. Do not change those statuses by hand.
- If any required gate fails, stop promotion, record the failure, and fix the underlying evidence or code before continuing.

## Task 1: Confirm the repaired baseline

**Purpose:** Establish that the current code is healthy before adding external evidence.

**Files:** None changed.

**Commands:**

```powershell
Set-Location 'C:\Cursor AI'
python -m unittest discover -s backend -p "test_*.py"
npm run test:pronounce:logic
npm run test:pronounce:browser
```

**Expected:** Backend tests pass with only the known corpus-dependent skips; logic tests pass; both Chrome pronunciation browser checks pass.

**Stop condition:** Any failure means repair the regression first. Do not collect or benchmark against a failing baseline.

## Task 2: Prepare the protected audio corpus

**Purpose:** Create the real evaluation data required by the benchmark and promotion gates.

**Files:**
- Local-only audio: `test-results\pronunciation-segmentation-corpus\<sampleId>.wav`
- Modify later: `tests\fixtures\pronunciation-segmentation\manifest.json`

**Required corpus:**

- 60 clean American-English recordings.
- 30 adversarial recordings: omissions, insertions, hesitations, or controlled noise.
- 30 accented recordings from at least five deidentified speaker cohorts.
- At least one clean sample for each: `busy`, `photograph`, `photography`, `banana`, `camera`, `university`.

**For every sample, record:**

- `sampleId` matching `^[a-z0-9-]+$`.
- `targetWord` and American-English `referenceIpa`.
- `expectedObservedCount`: what the speaker actually produced.
- `targetSyllableCount`: independently verified canonical count for the prompted word.
- `category`, `speakerCohort`, `sourceHash`, `labelProvenance`.
- `verifiedSpans` using `{ "start": seconds, "end": seconds }` when available.

**Procedure:**

1. Obtain consent and store consent records outside the repository.
2. Record or import the WAV files at a supported sample rate.
3. Deidentify filenames and assign stable sample IDs.
4. Label the canonical target count separately from the observed recording count. For example, `busy` has `targetSyllableCount: 2`; an omission sample may have `expectedObservedCount: 1`.
5. Compute a SHA-256 hash for every WAV.
6. Keep the raw files in the ignored local corpus directory.

**Do not continue:** If the corpus is incomplete, leave the manifest empty or incomplete. The benchmark must fail closed.

## Task 3: Build and validate the manifest

**Purpose:** Convert the protected audio set into schema-validated metadata.

**Files:**
- Modify: `tests\fixtures\pronunciation-segmentation\manifest.json`
- Validate: `tests\fixtures\pronunciation-segmentation\manifest.schema.json`
- Reference: `scripts\audit\build-pronunciation-segmentation-corpus.py`

**Commands:**

```powershell
python scripts/audit/build-pronunciation-segmentation-corpus.py `
  --input-dir test-results/pronunciation-segmentation-corpus `
  --output tests/fixtures/pronunciation-segmentation/manifest.json `
  --schema tests/fixtures/pronunciation-segmentation/manifest.schema.json

python -m unittest backend.test_pronunciation_segmentation_corpus -v
```

**Manual checks before committing:**

- The manifest contains at least 120 entries.
- All six mandatory words have clean entries.
- Every entry has a positive `targetSyllableCount`.
- Every `sourceHash` matches the local WAV.
- No PII appears in the JSON.

**Expected:** Schema validation passes and corpus integrity tests pass. An incomplete corpus must fail validation or remain unsuitable for benchmarking.

**Commit artifact:** Commit only the deidentified manifest and schema-related documentation; never commit WAV files.

## Task 4: Run the pinned model benchmark

**Purpose:** Replace the pending model evidence with measurements from the actual pinned model and actual corpus audio.

**Files:**
- Read: `backend\phoneme_service\model-manifest.json`
- Generate: `test-results\pronunciation-model-benchmark\*`
- Update only from verified output: `backend\phoneme_service\model-manifest.json`

**Prerequisites:** Install the project’s Python dependencies, including PyTorch, Transformers, NumPy, SciPy, and psutil. Use the pinned revision already in the manifest; do not benchmark `latest`.

**Command:**

```powershell
python scripts/benchmarks/phoneme_model_probe.py `
  --manifest tests/fixtures/pronunciation-segmentation/manifest.json `
  --audio-dir test-results/pronunciation-segmentation-corpus `
  --revision ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4 `
  --output test-results/pronunciation-model-benchmark
```

**Expected:** The command evaluates real WAV files, reports mandatory-word accuracy, confidence calibration, warm latency, cold load, and RSS, then writes a manifest with `evidenceStatus: "verified"` only if evidence is complete.

**Stop conditions:**

- Empty or undersized corpus.
- Missing mandatory words or audio.
- Hash mismatch.
- Fewer than 5/6 mandatory words correct.
- Peak RSS or latency outside the limits.
- No confidence threshold satisfies the calibration gates.

Do not edit benchmark numbers manually to make a gate pass.

## Task 5: Verify the recognizer service and container

**Purpose:** Ensure the model manifest and service readiness behavior match the measured verdict.

**Files:**
- `backend\Dockerfile.phoneme`
- `backend\cloudbuild.phoneme.yaml`
- `backend\phoneme_service\model-manifest.json`

**Commands:**

```powershell
python -m unittest backend.test_phoneme_service backend.test_phoneme_model_manifest backend.test_pronunciation_packaging -v
docker build --file backend/Dockerfile.phoneme --tag phoneme-recognizer:candidate .
docker run --rm -p 8081:8081 phoneme-recognizer:candidate
```

In another PowerShell window:

```powershell
Invoke-WebRequest http://127.0.0.1:8081/healthz
Invoke-WebRequest http://127.0.0.1:8081/readyz
```

**Expected:** `/healthz` returns 200; `/readyz` returns 200 only after verified evidence and the selected engine are available. The image uses the pinned model revision and offline runtime settings.

**Stop condition:** If Docker is unavailable, do not claim the image passed. Move this task to a Docker-capable build runner.

## Task 6: Start a non-production candidate

**Purpose:** Test the real `/analyze/v3` endpoint without exposing it to users.

**Files:** No production files changed.

**Procedure:**

1. Deploy the image to a separate Cloud Run candidate service with no production traffic.
2. Configure the candidate’s V3 mode as `active` only after Task 5 passes; use `shadow` first if the service is connected to real user traffic.
3. Record the candidate URL and build SHA.
4. Confirm `/health`, `/healthz`, `/readyz`, and `/version`.
5. Confirm the service reports the expected model revision and manifest checksum.

**Authorization:** This is the first step requiring deployment authority. Do not execute it until explicitly approved.

## Task 7: Run the real segmentation audit

**Purpose:** Exercise native graphs, target-forcing independence, timing, accuracy, and latency against the candidate.

**Command:**

```powershell
python scripts/audit/pronunciation-segmentation-audit.py `
  --base-url '<CANDIDATE_URL>' `
  --manifest tests/fixtures/pronunciation-segmentation/manifest.json `
  --model-manifest backend/phoneme_service/model-manifest.json `
  --output test-results/audit-results
```

**Expected:** The report at `test-results\audit-results\pronunciation-v3-audit-report.md` passes every gate:

- 6/6 mandatory clean words.
- At least 95% clean accuracy.
- At least 90% omission and insertion precision/recall.
- At least 90% accented accuracy.
- Boundary MAE no greater than 60 ms.
- Per-syllable duration availability at least 98%.
- Warm p95 no greater than 2 seconds.
- RSS no greater than 3.5 GiB.
- Native graph coverage at least 99%.
- No target-forced counts.
- No unexplained blank graphs.

**Stop condition:** Any failed gate blocks promotion. Investigate the raw JSON report and add a regression test before rerunning.

## Task 8: Verify the user-facing Chrome flow against the candidate

**Purpose:** Confirm that the real candidate response is rendered correctly in the browser.

**Files:** Existing browser checks in `tests\browser\`.

**Procedure:**

1. If login is required, read `C:\Cursor AI\.local\browser-test-credentials.md`; never copy credentials into notes or commits.
2. Run the local Playwright Chrome checks.
3. In the candidate UI, search `photograph`, `photography`, `busy`, and a previously uncached word.
4. Confirm syllable counts, native pitch/intensity graphs, and syllable duration charts.
5. Record a screenshot or console artifact only if it contains no personal data.

**Command:**

```powershell
npm run test:pronounce:browser
```

**Expected:** No blank graph for a valid audio-backed variant; `busy` has two syllables; `photograph` has three; duration remains unavailable only when the service explicitly reports it unavailable.

## Task 9: Run shadow mode before active promotion

**Purpose:** Compare V2 and V3 safely using real traffic without changing user scoring.

**Requirements:**

- At least seven days and 500 valid attempts.
- Structured logs include V2/V3 counts, disagreement category, confidence, latency, reason, model revision, and target word.
- No audio, tokens, account IDs, or consent data in logs.
- Monitor recognizer busy and authentication-failure rates.

**Procedure:**

1. Enable shadow mode on the no-traffic or controlled candidate.
2. Export daily aggregate disagreement reports.
3. Investigate every unexpected insertion, omission, timeout, or blank graph.
4. Keep V2 as the user-facing result until all shadow gates pass.

## Task 10: Decide promotion or rollback

Promote only when Tasks 1–9 are complete and every audit gate passes. Keep the candidate in shadow or roll it back if any gate fails, if readiness becomes unstable, or if the model evidence cannot be reproduced. Production deployment requires a separate explicit approval; this plan does not authorize it automatically.

## Final handoff checklist

- [ ] Corpus manifest and hashes reviewed.
- [ ] Raw audio remains outside Git.
- [ ] Benchmark output is reproducible.
- [ ] `evidenceStatus` is `verified`.
- [ ] Docker image build and `/readyz` pass.
- [ ] Candidate audit report passes all gates.
- [ ] Chrome candidate flow passes.
- [ ] Shadow evidence meets duration and volume requirements.
- [ ] Promotion decision and rollback owner are documented.
