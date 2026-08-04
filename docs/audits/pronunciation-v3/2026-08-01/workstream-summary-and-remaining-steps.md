# Pronunciation V3 Production Shadow Deployment Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load `executing-plans` before implementing this plan task-by-task.

**Status:** Draft — approval required before execution  
**RequestFeedback:** true  
**Date revised:** August 1, 2026  
**Production target:** Google Cloud Run service `praat-api` in project `parselmouth`, region `us-central1`  
**Release mode:** `PRONUNCIATION_V3_MODE=shadow`; learner-facing V3 activation remains off

**Goal:** Push the current pronunciation backend improvements to production shadow mode as quickly as safely possible, verify the new revision, and then continue upgrading telemetry, accuracy, and learner behavior from a stable deployed baseline.

**Architecture:** Build one immutable `praat-api` image from a clean pronunciation-only commit. Deploy it first as a tagged 0%-traffic Cloud Run candidate, smoke-test its V2-compatible shadow response and private recognizer call, then promote that exact revision to 100% with an exact rollback revision recorded. The existing private `phoneme-recognizer` service remains in place for this release.

**Tech stack:** Python 3, Flask, Gunicorn, Parselmouth/Praat, Cloud Build, Artifact Registry, Cloud Run, Cloud Logging, PowerShell.

---

## 1. Release decision

### Immediate objective

Deploy these `praat-api` changes:

- final-syllable trailing-silence trimming in `backend/local_server/server.py`;
- `flush=True` for V3/shadow log statements in `backend/local_server/server.py`;
- `PYTHONUNBUFFERED=1` in `backend/Dockerfile`;
- all pronunciation backend changes already contained in the selected clean base commit.

### Explicitly deferred — not deployment gates

The following work is temporarily skipped and must **not** block this production shadow deployment:

- the 127-recording Vietnamese L1 benchmark and its prior accuracy target;
- diagnosis or repair of the Vietnamese benchmark failures;
- re-labeling the three legacy `industrial` samples;
- the full 250-file shadow accuracy comparison;
- shadow-harness improvements for canonical IPA, `textPayload`, and one-to-one request correlation;
- dedicated runtime-service-account migration and broader IAM hardening;
- stress-scoring upgrades;
- learner-facing V3 activation.

The 127 Vietnamese sample is a future system-upgrade input, not a release criterion for this deployment.

### Safety boundary

This release may change production backend code and production Cloud Run traffic, but it must not:

- set `PRONUNCIATION_V3_MODE=active`;
- enable `usePronunciationV3LearnerAnalysis`;
- change Firebase Hosting or Firebase Functions;
- retrain or replace the phoneme model;
- change learner-facing scoring decisions;
- alter the current Cloud Run runtime identity or IAM policy;
- include unrelated UI, CRM, connected-speech, generated-index, screenshot, or hosting-cache changes.

---

## 2. Authorization model

Editing this plan does not execute the deployment.

A user reply of **“Approved — execute the production shadow deployment”** authorizes the following exact sequence, provided every stop condition below remains green:

1. create a pronunciation-only clean worktree/branch;
2. create an allowlisted local commit;
3. push that pronunciation-only branch;
4. build the immutable `praat-api` image;
5. deploy a tagged 0%-traffic candidate;
6. run the specified production smoke checks;
7. promote the exact verified candidate revision to 100%;
8. monitor and roll back automatically if a stated rollback condition is met.

It does not authorize learner activation, model replacement, Firebase deployment, or unrelated repository changes.

---

## 3. Deployment tasks

### Task 1: Isolate the production candidate

**Purpose:** Build from reviewed pronunciation files without contaminating the image or commit with the current dirty worktree.

**Files allowed in the deployment commit:**

- `backend/local_server/server.py`
- `backend/Dockerfile`
- `backend/test_pronunciation_alignment_v2.py` only if its new trailing-trim regression is not already in the selected base commit
- `docs/audits/pronunciation-v3/2026-07-31/segmentation-guard-kokoro-verification.md` only if the deployment record needs the existing verified evidence
- `docs/audits/pronunciation-v3/2026-08-01/workstream-summary-and-remaining-steps.md`

**Files explicitly excluded from this fast deployment commit:**

- `scripts/benchmarks/compare_v3_shadow.py`
- all `public/` UI files;
- all Firebase hosting caches and generated connected-speech files;
- all unrelated tests, screenshots, plans, and audit files;
- every recording and every file under `test-results/`.

**Steps:**

1. Record the current `HEAD`, `origin/main`, branch, and `git status --short` in `test-results/pronunciation-v3-deploy/deployment-baseline.md`.
2. Create a dedicated worktree and branch named `codex/pronunciation-v3-shadow-production` from the user-approved base commit.
3. Transfer only the allowlisted pronunciation diff.
4. Inspect `git diff --stat`, `git diff --check`, and the full allowlisted diff.
5. Confirm that the effective `backend/Dockerfile` still copies the canonical runtime modules and includes `ENV PYTHONUNBUFFERED=1`.

**Verify:** `git status --short` contains only allowlisted files, and `git diff --check` exits 0.

**Stop:** Any unrelated file, missing intended fix, merge conflict, or unexplained generated change stops the deployment.

**Done:** The clean candidate diff contains only the intended backend release.

### Task 2: Run the minimum production preflight suite

**Purpose:** Reconfirm the code that will be built, without waiting for the deferred Vietnamese or shadow-accuracy campaigns.

**Commands:**

```powershell
python -m py_compile backend/local_server/server.py backend/local_server/phoneme_client.py
python -m unittest backend.test_pronunciation_alignment_v2 -v
python -m unittest backend.test_pronunciation_api_v2 backend.test_phoneme_client -v
```

**Required results:**

- Python compilation exits 0;
- the focused pronunciation-alignment suite passes, including the trailing-trim regression;
- V3 shadow responses remain V2-compatible;
- shadow telemetry reads the `recognize-v2` contract fields;
- private-recognizer authentication/client tests pass;
- no test writes to production.

**Optional evidence rerun:**

```powershell
python scripts/benchmarks/evaluate_trailing_trim.py
```

Run this only if the existing 250-file WAV corpus is available. Its absence is not a blocker because the saved A/B artifact already records 250/250 analyses, zero count regressions, 21 trimmed files, and zero extensions.

**Stop:** Any compilation error or required test failure stops the deployment. Do not waive a failing backend contract test.

**Done:** All mandatory commands exit 0 and their output is saved under `test-results/pronunciation-v3-deploy/`.

### Task 3: Create and push the allowlisted release commit

**Purpose:** Give the Cloud Build image a reproducible source SHA.

**Steps:**

1. Stage each allowed path explicitly. Never run `git add .`.
2. Inspect `git diff --cached --stat` and `git diff --cached`.
3. Confirm no secret, audio, `test-results/`, hosting cache, generated index, or unrelated UI file is staged.
4. Create one commit with message:

```text
fix(pronunciation): deploy trailing trim and reliable shadow logging
```

5. Push only `codex/pronunciation-v3-shadow-production`.

**Verify:** The remote branch SHA equals the local candidate SHA and the commit contains only the allowlist.

**Stop:** A remote rejection, unexpected hook mutation, changed staged diff, or unrelated file stops the build.

**Done:** One immutable candidate SHA is available locally and remotely.

### Task 4: Capture the live rollback baseline

**Purpose:** Make rollback possible before creating a new revision.

**Read-only commands:**

```powershell
gcloud run services describe praat-api `
  --project parselmouth `
  --region us-central1 `
  --format json

gcloud run revisions list `
  --service praat-api `
  --project parselmouth `
  --region us-central1 `
  --format json
```

**Record:**

- current 100%-traffic revision;
- current image and digest;
- current runtime service account;
- current traffic tags;
- current environment variable names and non-secret values;
- secret mappings by secret name only;
- timeout, concurrency, CPU, memory, min/max instances;
- current `/health` response;
- exact rollback command targeting the current revision.

**Security:** Do not print secret values, access tokens, identity tokens, or credentials into logs or artifacts.

**Stop:** If the live service cannot be described, has split/unexplained traffic, is not in shadow mode, or differs materially from the expected architecture, stop before building or deploying.

**Done:** `test-results/pronunciation-v3-deploy/live-baseline.md` contains a redacted baseline and tested rollback syntax.

### Task 5: Build the immutable image

**Purpose:** Build the exact approved commit using the repository's real pronunciation build configuration.

**Command from the clean worktree:**

```powershell
$sha = git rev-parse HEAD
gcloud builds submit . `
  --project parselmouth `
  --config backend/cloudbuild.pronunciation.yaml `
  --substitutions "_GIT_SHA=$sha"
```

**Expected image:**

```text
us-central1-docker.pkg.dev/parselmouth/cloud-run-source-deploy/praat-api:<full-git-sha>
```

**Verify:** Cloud Build succeeds, the published tag equals the candidate Git SHA, and Artifact Registry reports an immutable digest. Record the build ID and digest.

**Stop:** Do not retry a failed build by changing dependencies, Dockerfiles, or source in place. Diagnose, update the plan/diff, rerun tests, and create a new commit SHA.

**Done:** The candidate image digest is recorded and no Cloud Run traffic has changed.

### Task 6: Deploy a 0%-traffic shadow candidate

**Purpose:** Verify the production container and configuration before exposing normal traffic.

**Deployment requirements:**

- deploy the exact image digest/tag from Task 5;
- use `--no-traffic` and a unique candidate tag;
- preserve the captured runtime service account for this fast release;
- preserve existing secrets, timeout, concurrency, scaling, CPU, memory, VPC/network, and unrelated environment variables;
- explicitly keep:
  - `PRONUNCIATION_V3_MODE=shadow`
  - the current `PHONEME_SERVICE_URL`
  - `PHONEME_SERVICE_AUTH=google`
  - `BUILD_SHA=<candidate SHA>`
  - `PYTHONUNBUFFERED=1`
- do not change IAM in this task.

Use the no-traffic deployment pattern in `docs/runbooks/pronunciation-backend.md`. Do not use `gcloud run services update ... --to-latest` as a shortcut.

**Verify after creation:**

```powershell
gcloud run services describe praat-api `
  --project parselmouth `
  --region us-central1 `
  --format json
```

Confirm the new candidate has a tag but 0% normal traffic, and the previous production revision still has 100%.

**Stop:** Any unexpected traffic movement triggers immediate routing back to the recorded prior revision.

**Done:** A tagged candidate URL and exact candidate revision name are recorded without changing normal production traffic.

### Task 7: Smoke-test the tagged candidate

**Purpose:** Prove the new revision starts, preserves V2 behavior, invokes the private recognizer, and emits prompt shadow telemetry.

**Checks:**

1. Candidate `/health` returns HTTP 200 and reports:
   - candidate deployment SHA/revision;
   - `pronunciationV3Mode: shadow`;
   - expected schema/analysis versions;
   - healthy V2 path.
2. Post one known WAV to the tagged candidate `/analyze/v3` with:
   - `target_word`;
   - valid canonical `reference_ipa`;
   - matching `expected_syllables`;
   - a unique `variant_id` containing the candidate SHA and timestamp.
3. Confirm HTTP 200 and `mode: shadow`; the client-facing body remains the V2-adapted result.
4. Query Cloud Logging for the exact candidate revision and unique `variant_id`, checking `textPayload`.
5. Confirm a V3 shadow row arrives promptly and has no `REFERENCE_CONFLICT`, authentication failure, recognizer timeout, or model-inference infrastructure error.
6. Confirm the public health/V2 endpoints still satisfy the existing production contract.

**Accuracy note:** The single smoke recording does not need to prove model accuracy. It proves deployability, request integrity, private-service invocation, and telemetry delivery.

**Stop:** Roll back/delete the 0%-traffic candidate if health fails, the response is not shadow/V2-compatible, the recognizer cannot be invoked, or telemetry does not arrive within the bounded verification window.

**Done:** `test-results/pronunciation-v3-deploy/candidate-smoke.json` records the redacted request ID, revision, response contract, and matching log evidence.

### Task 8: Promote the exact verified revision

**Purpose:** Route production traffic only to the candidate that passed Task 7.

**Rule:** Promote by exact revision name, not `--to-latest`, so a concurrent revision cannot be selected accidentally.

**Command pattern:**

```powershell
gcloud run services update-traffic praat-api `
  --project parselmouth `
  --region us-central1 `
  --to-revisions "<verified-candidate-revision>=100"
```

**Immediate verification:**

- service traffic reports the candidate at 100%;
- `/health` reports the candidate revision/SHA and shadow mode;
- one production `/analyze/v2` request returns the established V2 contract;
- one production `/analyze/v3` request returns `mode: shadow` with the V2-compatible body;
- shadow telemetry appears from the promoted revision;
- no learner feature flag or active-mode environment value changed.

**Done:** The exact verified revision serves 100% of `praat-api` production traffic in shadow mode.

### Task 9: Monitor and close the deployment

**Purpose:** Catch startup, latency, authentication, and contract regressions immediately after promotion.

**Observation window:** Minimum 15 minutes after 100% promotion, with checks at promotion, +5 minutes, and +15 minutes.

**Monitor:**

- Cloud Run 5xx responses and container restarts;
- `/health` availability;
- V2 and V3 request latency;
- recognizer authentication failures;
- `REFERENCE_CONFLICT`, timeout, and inference-error frequency;
- shadow-log arrival;
- unexpected active-mode or learner-facing behavior.

**Rollback immediately if:**

- `/health` fails twice consecutively;
- V2 contract smoke fails;
- repeated container startup/restart failure occurs;
- production 5xx rate materially exceeds the captured baseline;
- the candidate runs in any mode other than `shadow`;
- the candidate causes a learner-facing contract regression;
- private recognizer authentication is consistently broken.

**Rollback pattern:**

```powershell
gcloud run services update-traffic praat-api `
  --project parselmouth `
  --region us-central1 `
  --to-revisions "<recorded-prior-revision>=100"
```

After rollback, verify `/health`, `/analyze/v2`, `/analyze/v3`, and traffic allocation. Preserve failed-candidate logs and do not delete the revision until diagnosis is complete.

**Closeout artifact:** Update this document with candidate SHA, image digest, build ID, revision, deployment time, smoke results, monitoring results, rollback revision, and final live status.

**Done:** The candidate remains healthy for the observation window or rollback is completed and verified.

---

## 4. Post-deployment upgrade queue

These tasks begin only after the production shadow deployment is closed successfully. They do not retroactively gate it.

### Upgrade A: Repair the shadow comparison harness

- add canonical `reference_ipa` to the frozen Kokoro dataset;
- query both Cloud Logging `textPayload` and `jsonPayload.message`;
- send unique run/record IDs and include them in server telemetry;
- join responses and logs one-to-one rather than by `target_word`;
- fail on duplicates, missing rows, null V3 counts, mixed revisions, or `REFERENCE_CONFLICT`;
- add offline unit tests before another production measurement.

### Upgrade B: Run the paired production shadow report

- submit the full 250-file Kokoro corpus only after Upgrade A passes;
- report paired V3/V2 exact accuracy, coverage, disagreements, error reasons, p50/p95 latency, model revision, dataset hash, and unmatched rows;
- treat the result as synthetic production-wiring evidence, not Vietnamese learner evidence.

### Upgrade C: Resume Vietnamese learner work

- revisit the 127 Vietnamese recordings when the user restores that priority;
- diagnose recognizer, syllabifier, audio, and label failures;
- re-run the cohort only after targeted upgrades;
- define learner-activation criteria at that time.

### Upgrade D: Complete labeling and security hardening

- redraw and isolate the three legacy `industrial` samples;
- migrate `praat-api` from the default Compute identity to a dedicated least-privilege runtime service account;
- verify Secret Manager and private-recognizer permissions before removing the old invoker binding.

### Upgrade E: Plan learner activation separately

Any future `PRONUNCIATION_V3_MODE=active` change or `usePronunciationV3LearnerAnalysis` enablement requires a new plan, learner-facing Chrome evidence, explicit scoring-scope decisions, and separate production approval.

---

## 5. Completion checklist for this deployment

- [ ] User approved execution of this production shadow plan.
- [ ] Candidate worktree contains only allowlisted pronunciation files.
- [ ] Mandatory backend preflight commands pass.
- [ ] One allowlisted commit is created and pushed.
- [ ] Correct `backend/cloudbuild.pronunciation.yaml` build succeeds.
- [ ] Image SHA and immutable digest are recorded.
- [ ] Previous live revision and rollback command are recorded.
- [ ] Tagged candidate has 0% normal traffic during smoke testing.
- [ ] Candidate health and V2-compatible shadow response pass.
- [ ] Private recognizer invocation and prompt `textPayload` logging pass.
- [ ] Exact verified revision is promoted to 100%.
- [ ] `PRONUNCIATION_V3_MODE` remains `shadow`.
- [ ] Learner feature flag remains disabled.
- [ ] Fifteen-minute monitoring window passes or rollback is verified.
- [ ] Deployment closeout evidence is written.
- [ ] Vietnamese 127-sample work remains deferred and is not reported as a failed deployment gate.
