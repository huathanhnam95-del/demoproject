# V4 Follow-up Handoff Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining V4 production-confidence gaps by diagnosing recognizer contention, running a blind held-out segmentation evaluation, automating release smoke evidence, and separately evaluating the Firebase Admin major upgrade.

**Architecture:** Treat these as four bounded packages with independent commits and release decisions. Availability work is first because held-out acoustic results are not interpretable while the recognizer can return `RECOGNIZER_BUSY`; the blind evaluation follows only after an availability baseline is stable. Read-only production smoke automation may be developed after the availability contract is known, while the Firebase dependency upgrade remains isolated from V4 behavior and deployment.

**Tech Stack:** Python 3, Flask, PyTorch/CTC phoneme service, Cloud Run, PowerShell, Node.js 22, Firebase Functions v2, Firestore/Storage, Playwright Chrome, `unittest`, Node test runner, npm audit.

---

## Released baseline and safety boundary

- Start from current `origin/main`; the handoff was written from `4a48bff847efd9c59474cbbf1a582e20b6cebf8c`.
- Live pronunciation API: `praat-api-00074-zuv`, application SHA `d509e6f36ce76cd6e023c91453f5097069d1002f`; rollback `praat-api-00069-fub`.
- Live phoneme recognizer: `phoneme-recognizer-00016-lum`; do not mutate it during diagnosis. Its rollback must be captured again immediately before any candidate deployment.
- Live Firebase API: `api-00087-moq`, Node 22; rollback `api-00085-yaw`.
- Deterministic V4.1 rule/provenance checks passed, but three real-audio retries returned `RECOGNIZER_BUSY`; do not claim fresh live V4 acoustic success until Package A closes.
- Production dependency audit at handoff: 0 critical, 0 high, 9 moderate, 2 low for the production lock.
- Preserve raw CTC spans, measurement spans, V3 partitions, V4 partitions, manual spans, historical `automaticSegments`, study records, and holdout locks as separate authoritative contracts.
- Do not claim/release study tasks, unlock holdout, backfill Firestore, deploy, promote traffic, or update all Functions without a separately explicit authorization.
- Use an isolated worktree per package. Never import the dirty primary checkout.

## Execution order

1. Package A: `V4-A2-AVAIL-01` recognizer availability diagnosis and candidate proof.
2. Package B: `V4-A2-EVAL-01` preregistered blind held-out evaluation.
3. Package C: `V4-A2-SMOKE-01` repeatable release smoke evidence.
4. Package D: `FBASE-ADMIN-14-01` isolated Firebase Admin compatibility and security upgrade.

Package C may be implemented after Package A's observability schema is frozen. Package D may be developed independently, but must not share a release commit or deployment with A, B, or C.

---

## Package A — V4-A2-AVAIL-01

### Task 1: Capture an immutable contention baseline

**Files:**
- Create: `scripts/ops/diagnose-phoneme-recognizer-busy.ps1`
- Create: `tests/ops/diagnose-phoneme-recognizer-busy-contract.test.mjs`
- Generate, ignored: `test-results/v4-a2-availability/<timestamp>/baseline.json`

**Step 1: Write the failing contract test**

Require the diagnostic script to accept explicit project, region, service, revision, start/end UTC timestamps, and output path. Assert that it queries `/recognize/v2` status/latency, `/readyz`, revision instance events, Scheduler keepalive results, and `RECOGNIZER_BUSY` application logs without changing traffic or service configuration.

**Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/ops/diagnose-phoneme-recognizer-busy-contract.test.mjs
```

Expected: failure because the diagnostic script does not exist.

**Step 3: Implement the read-only collector**

The JSON artifact must contain:

```json
{
  "schemaVersion": "phoneme-recognizer-availability-v1",
  "sourceRevision": "phoneme-recognizer-00016-lum",
  "window": { "startUtc": "...", "endUtc": "..." },
  "requests": { "total": 0, "ok": 0, "busy": 0, "other4xx": 0, "other5xx": 0 },
  "latencyMs": { "p50": null, "p95": null, "max": null },
  "readyz": { "total": 0, "non200": 0 },
  "instances": [],
  "incompleteQueries": []
}
```

Fail closed when any required log query fails. Do not infer semaphore state from readiness alone.

**Step 4: Run the contract and one bounded production collection**

Run the contract, then collect at least one peak-use window and one quiet window. Expected: two complete JSON artifacts tied to the exact live revision; no service mutation.

**Step 5: Commit**

Commit only the script and contract test. Keep runtime evidence under ignored `test-results/` and record its hash in the review report.

### Task 2: Add inference-gate observability without changing scheduling

**Files:**
- Modify: `backend/phoneme_service/app.py:280-330`
- Modify: `backend/phoneme_service/app.py:425-515`
- Modify: `backend/phoneme_service/recognizer.py:120-200`
- Test: `backend/test_phoneme_service.py`
- Test: `backend/test_phoneme_backends.py`

**Step 1: Write failing tests**

Cover both `/recognize` and `/recognize/v2`:

- acquisition records a request ID, endpoint, acquire timestamp, and monotonic wait/busy duration;
- release occurs exactly once after success, validation failure after acquisition, backend exception, and alignment exception;
- a busy response identifies the active request age but never exposes audio, tokens, IPA, credentials, or learner identity;
- readiness remains model readiness and does not falsely claim inference capacity.

**Step 2: Verify RED**

Run:

```powershell
python -m unittest backend.test_phoneme_service backend.test_phoneme_backends -v
```

Expected: the new structured-state assertions fail.

**Step 3: Implement the minimum shared inference-gate helper**

Keep the single-inference invariant. Encapsulate acquire/release bookkeeping in `recognizer.py` and call it from both endpoints. Use `time.monotonic()` for durations and structured logs with these stable fields:

```text
event, requestId, endpoint, outcome, activeRequestAgeMs,
inferenceDurationMs, revision, instanceId
```

Do not add audio-derived data or reference IPA to logs.

**Step 4: Verify GREEN and regression coverage**

Run the two focused suites plus:

```powershell
python -m unittest backend.test_pronunciation_api_v2_recognizer backend.test_phoneme_client -v
```

Expected: all pass; response contracts remain additive/unchanged.

**Step 5: Commit**

Commit observability and tests without Cloud Run configuration changes.

### Task 3: Decide the remediation from evidence

**Artifact:**
- Create: `docs/audits/v4-a2-availability/<date>-root-cause.md`

**Step 1: Classify the evidence**

Choose exactly one primary category:

- `LEGITIMATE_CONTENTION`: inference completes and releases, but concurrent arrivals receive immediate 503 responses;
- `STUCK_INFERENCE`: active request age exceeds the endpoint timeout or release is missing;
- `COLD_START_MISCLASSIFICATION`: readiness/traffic arrives before usable inference capacity;
- `UPSTREAM_RETRY_STORM`: pronunciation API/client retries amplify load;
- `INSUFFICIENT_EVIDENCE`: required log correlation is incomplete.

**Step 2: Record rejected explanations**

Include correlated request IDs, timestamps, revision, latency distribution, instance count, and why `/readyz` alone was insufficient.

**Step 3: Define the minimum candidate change**

- For legitimate contention, prefer Cloud Run `containerConcurrency: 1` with existing max scale before changing the model semaphore.
- For a stuck inference, repair timeout/cancellation/release behavior before any concurrency change.
- For cold-start misclassification, change readiness/startup behavior without weakening model-manifest validation.
- For a retry storm, bound client retries/backoff while preserving fail-closed reasons.
- For insufficient evidence, stop; do not deploy a guessed fix.

**Step 4: Commit the audit**

No production mutation in this task.

### Task 4: Implement and verify the selected candidate

**Conditional files:**
- Modify if concurrency is selected: `scripts/release/pronunciation-v3.production.json`
- Modify if concurrency is selected: `scripts/release/pronunciation-v3.ps1`
- Test: `tests/ops/pronunciation-v3-release-contract.test.mjs`
- Modify only if proven necessary: `backend/phoneme_service/app.py`
- Modify only if proven necessary: `backend/local_server/phoneme_client.py`
- Test: `backend/test_phoneme_service.py`
- Test: `backend/test_phoneme_client.py`

**Step 1: Write a failing test for the selected remediation**

Do not write speculative branches. The test must reproduce the classified cause.

**Step 2: Implement the smallest fix**

Preserve private recognizer IAM, `/readyz`, model manifest, single-logit inference, V3 grouping, V4 grouping, and maximum two instances unless evidence and cost approval explicitly authorize otherwise.

**Step 3: Run local gates**

```powershell
python -m unittest backend.test_phoneme_service backend.test_phoneme_backends backend.test_pronunciation_api_v2_recognizer backend.test_phoneme_client backend.test_v4_syllabification -v
node --test tests/ops/pronunciation-v3-release-contract.test.mjs tests/ops/diagnose-phoneme-recognizer-busy-contract.test.mjs
git diff --check
```

Expected: all pass.

**Step 4: Heavy-route review**

Required sequence: Luna coder, Terra actual-diff reviewer, same coder repairs valid findings, independent Luna tester. Browser verification is unnecessary unless the pronunciation API/UI changes.

**Step 5: Commit the candidate**

Do not push or deploy without a separate explicit production authorization.

### Task 5: Zero-traffic candidate and availability gate

**Gate:** Explicit production authorization required before this task.

**Evidence artifact:**
- Generate, ignored: `test-results/v4-a2-availability/<timestamp>/candidate.json`
- Create after verification: `docs/audits/v4-a2-availability/<date>-candidate-result.md`

**Step 1: Capture rollback and exact source**

Fetch current `origin/main`, confirm a clean worktree, record live traffic/IAM/config, and resolve the immutable image digest.

**Step 2: Deploy at zero traffic**

Use the release script with an explicit revision and no IAM mutation. Never use `--to-latest`.

**Step 3: Run bounded real-audio checks**

Use one license-cleared, hash-pinned WAV fixture. Run sequential requests and a bounded burst against the candidate. Report HTTP status, reason, queue/wait time, inference time, and instance/revision identity. Do not store learner audio.

**Step 4: Acceptance gate**

The candidate passes only when:

- no request is attributed to the wrong revision;
- no semaphore/inference state remains active after the bounded run;
- no `RECOGNIZER_BUSY` occurs under the preregistered expected load;
- warm latency and rateability do not regress against the baseline threshold recorded in Task 3;
- one-inference V3/V4 and exact V4.1 provenance checks remain green;
- IAM remains private and cost settings remain within the approved envelope.

**Step 5: Promote or rollback explicitly**

Promote one named revision only after the gate passes. Otherwise leave production unchanged and document the failure.

---

## Package B — V4-A2-EVAL-01

### Task 6: Preregister the blind evaluation protocol

**Files:**
- Create: `docs/evals/v4-a2-heldout-protocol.md`
- Modify only if schema additions are required: `tests/audit/segmentation-study-v2-manifest.test.js`

**Step 1: Freeze roles and blinding**

Define separate identities for corpus administrator, manual annotator, metrics runner, and decision owner. Annotators may see audio, target word, and canonical reference IPA, but must not see V2/V3/V4 boundaries, version labels, or automatic preference judgments before manual boundaries are locked.

**Step 2: Freeze the dataset**

Use the existing development/holdout split and immutable manifest hash. Do not move samples between splits. Development may be used to refine annotation instructions; holdout remains locked until instructions, code SHA, metric definitions, and pass thresholds are approved.

**Step 3: Preregister metrics**

At minimum:

- boundary MAE, median absolute error, and P90 in milliseconds;
- percentage of boundaries within 30 ms and 80 ms;
- count/rateability/availability by version;
- exact phonological ownership accuracy for the short-vowel and maximal-onset rules;
- breakdown by syllable count, transition class, stressed-lax context, and ambiguity kind;
- paired V2/V3/V4 comparison on identical samples;
- exclusions with immutable reason codes.

**Step 4: Preregister thresholds**

The decision owner must approve numerical thresholds before holdout unblinding. Do not derive a passing threshold after seeing holdout results. The prior six-sample replay is exploratory evidence only, not a threshold source.

**Step 5: Commit the protocol**

Holdout remains server-locked.

### Task 7: Build an immutable blind export

**Files:**
- Create: `scripts/segmentation-study/export-blind-evaluation.js`
- Create: `tests/crm/segmentation-study-blind-export.test.js`
- Modify only if required: `functions/src/routes/admin/segmentation-study.js`

**Step 1: Write failing export tests**

Assert that the annotation bundle excludes automatic spans, V2/V3/V4 names, `automaticSegments`, `partitionVariants`, `v4Syllabification`, automatic judgments, holdout assignments, and metric outcomes. Preserve sample ID, audio hash, duration, canonical word/IPA, expected count, dialect, capture provenance, and an opaque split token.

**Step 2: Verify RED**

```powershell
node tests/crm/segmentation-study-blind-export.test.js
```

Expected: failure because the export does not exist.

**Step 3: Implement read-only export**

Default to development only. Require a separately signed/approved `--include-holdout` flag plus frozen protocol hash; fail closed otherwise. Never write Firestore.

**Step 4: Verify GREEN**

Run the new test plus `tests/crm/segmentation-study-route.test.js` and the manifest audit. Expected: all pass and holdout claim routes remain locked.

**Step 5: Commit**

Do not export production data during implementation.

### Task 8: Implement the paired metrics runner

**Files:**
- Create: `scripts/audit/v4-a2-heldout-evaluation.py`
- Create: `backend/test_v4_a2_heldout_evaluation.py`
- Reuse without mutation: `scripts/audit/pronunciation-segmentation-audit.py`

**Step 1: Write metric tests**

Cover exact pairing, boundary-key normalization, missing-version exclusions, duplicate sample rejection, manual-span contiguity, bootstrap confidence intervals, rule-context grouping, and fail-closed split/protocol/hash mismatch.

**Step 2: Verify RED**

```powershell
python -m unittest backend.test_v4_a2_heldout_evaluation -v
```

**Step 3: Implement deterministic metrics**

Inputs must be immutable manual annotations plus a separately generated automatic-analysis bundle. Outputs must include raw per-sample rows, aggregate JSON, and a Markdown report. Preserve all three automatic versions; never overwrite source records.

**Step 4: Verify GREEN and replay development only**

Run unit tests and a development replay. Confirm identical output hashes across two runs.

**Step 5: Commit**

No holdout results in the commit.

### Task 9: Run the blind holdout and make a decision

**Gate:** Protocol, thresholds, annotator agreement rule, availability gate, and explicit holdout authorization must all be approved first.

**Files:**
- Generate: `test-results/v4-a2-heldout/<protocol-hash>/raw.jsonl`
- Generate: `test-results/v4-a2-heldout/<protocol-hash>/summary.json`
- Create: `docs/audits/v4-a2/<date>-heldout-result.md`

**Step 1: Lock manual annotations**

Hash the bundle before revealing automatic outputs.

**Step 2: Run automatic analysis once per audio**

Reuse the same logits for V3 and V4. Record unavailable results; do not retry until success in a way that biases availability metrics.

**Step 3: Run the metrics runner**

No threshold or code changes after unblinding.

**Step 4: Independent verification**

Have an independent tester reproduce the summary from raw immutable inputs.

**Step 5: Decision**

Choose one: promote confidence claim, continue comparison-only with stated limits, revise on development data and schedule a new untouched holdout, or roll back V4 exposure. Never tune on the revealed holdout.

---

## Package C — V4-A2-SMOKE-01

### Task 10: Add a read-only production smoke command

**Files:**
- Create: `scripts/release/verify-v4-production.ps1`
- Create: `tests/ops/verify-v4-production-contract.test.mjs`
- Reuse: `scripts/release/pronunciation-v3.production.json`

**Step 1: Write failing contract tests**

Require explicit expected source SHA, Cloud Run revision, Firebase API revision/runtime, and origins. Assert checks for:

- pronunciation `/health` full SHA and status;
- one named Cloud Run revision at 100% traffic;
- recognizer revision/readiness and private IAM;
- Firebase API `ACTIVE` on Node 22;
- GET/OPTIONS CORS for custom, `.web.app`, and `.firebaseapp.com` origins;
- `POST /warm/v3` success;
- zero tracked `.firebase/` artifacts;
- no traffic, IAM, Firestore, Storage, task, or Hosting mutation.

**Step 2: Verify RED**

```powershell
node --test tests/ops/verify-v4-production-contract.test.mjs
```

**Step 3: Implement the command**

Output a versioned JSON artifact and a concise console summary. Any missing or ambiguous check must fail the command. Accept credentials through existing gcloud/Firebase sessions; never print tokens.

**Step 4: Verify with fixtures and live read-only execution**

Use fake CLI fixtures for deterministic tests, then run once against production with explicit expected revisions.

**Step 5: Commit**

### Task 11: Add authenticated Chrome smoke verification

**Files:**
- Create: `tests/browser/crm-segmentation-study-production-smoke.js`
- Reference only: `C:\Cursor AI\.local\browser-test-credentials.md`

**Step 1: Write the browser fixture contract**

Chrome only. Test custom domain and both Firebase aliases. Log in when the origin has no active session. Open Pronunciation Samples → Study, verify the queue loads, issue browser-origin health/warm fetches, and assert zero relevant console errors.

**Step 2: Add mutation guards**

Abort if the script attempts `claim-next`, `complete`, `release`, upload, delete, seed, or any non-warm POST. Assert the page remains `No word claimed` before and after.

**Step 3: Run locally against production**

Capture screenshots, console, network, origin, revision, and SHA into ignored `test-results/v4-a2-production-smoke/`.

**Step 4: Commit**

Do not commit credentials or generated artifacts.

### Task 12: Document the release invocation

**Files:**
- Modify: `scripts/release/pronunciation-v3.production.json`
- Modify: `docs/audits/pronunciation-v3/2026-08-04/release-status-and-next-steps.md`
- Test: `tests/ops/pronunciation-v3-release-contract.test.mjs`

Record that Firebase source discovery for the current module graph requires `FUNCTIONS_DISCOVERY_TIMEOUT=60` and that scoped API deployment must use a root-level temporary no-predeploy configuration. The temporary file must be removed and tracked-source parity checked after deployment. Do not place a deploy command in a generic npm script that could broaden scope.

---

## Package D — FBASE-ADMIN-14-01

### Task 13: Inventory Firebase Admin compatibility before updating

**Files:**
- Create: `docs/audits/firebase-admin/<date>-compatibility-inventory.md`
- Read: `functions/package.json`
- Read: `functions/src/**/*.js`
- Read: `src/**/*.js`

**Step 1: Verify the current supported release**

Use official Firebase release notes and npm metadata at execution time. Do not assume `14.3.0` remains current.

**Step 2: Inventory APIs**

List every Admin import and usage: app initialization, Auth triggers/helpers, Firestore, Storage, timestamps, transactions, batch writes, emulator configuration, and credential handling.

**Step 3: Identify breaking changes**

Map each official breaking change to an exact file and test. If coverage is absent, create a test task before the dependency change.

**Step 4: Commit the inventory only**

### Task 14: Add compatibility characterization tests

**Files:**
- Create: `tests/functions/firebase-admin-compatibility.test.mjs`
- Modify as needed: existing CRM/admin route tests

Test initialization idempotence, emulator-backed Auth/Firestore/Storage calls, timestamp serialization, transaction/batch semantics, HTTP API startup, scheduled-function discovery, and `studentIdentity` v1 Auth trigger export. Run on Node 22.

Expected initial result: all pass on the released dependency baseline.

### Task 15: Upgrade only Firebase Admin and regenerate the lock

**Files:**
- Modify: `functions/package.json`
- Modify: `functions/package-lock.json`
- Modify production code only where an official breaking change requires it.

Use normal npm resolution without `--force`, overrides, or manual lock edits. Keep `firebase-functions`, `unpdf`, and unrelated direct dependencies fixed unless an incompatibility is proven.

Run:

```powershell
Push-Location functions
npm ci
npm audit --package-lock-only --omit=dev --json
npm ls --omit=dev
Pop-Location
node tests/functions/firebase-admin-compatibility.test.mjs
node tests/audit/v4-a2-hardening-contract.test.js
node tests/crm/segmentation-study-route.test.js
node tests/crm/pronunciation-corpus-production-route.test.js
npm run lint:crm
git diff --check
```

Expected: no new critical/high production finding, all compatibility and V4 persistence contracts pass, and source discovery completes with the documented timeout.

### Task 16: Review and stage any deployment separately

Required Heavy-route sequence: coder, Terra reviewer, same coder repair, independent tester. Because the package lock is shared by the full Functions codebase, test every exported function before release even if only `api` is selected as the first canary.

Deployment requires separate explicit authorization and must record:

- exact commit and lock hash;
- current revision/runtime for every function in scope;
- rollback revisions;
- source-discovery evidence on Node 22;
- batch order and stopping criteria;
- post-deploy API, scheduled-function, Auth, Firestore, Storage, and Chrome checks.

Do not combine this deployment with a recognizer or V4 algorithm release.

---

## Final verification matrix

| Gate | Required evidence | Blocks |
|---|---|---|
| Availability | Correlated busy/active/latency evidence and passing zero-traffic candidate | Blind acoustic evaluation |
| Blinding | Approved protocol hash, frozen thresholds, locked manual annotations | Holdout unblinding |
| Accuracy | Independently reproduced paired V2/V3/V4 metrics | Any V4 acoustic-accuracy claim |
| Release smoke | CLI JSON plus authenticated Chrome artifacts on three origins | Future pronunciation promotion |
| Dependency compatibility | Node 22 full-function characterization, audit, actual-diff review | Firebase Admin deployment |

## Handoff stop conditions

Stop and return to the decision owner when:

- production logs cannot distinguish contention from a stuck inference;
- a proposed availability fix changes IAM, cost envelope, model, or max scale;
- holdout data or automatic boundaries are accidentally exposed to annotators;
- thresholds were not frozen before unblinding;
- a dependency fix requires `npm audit fix --force` or unrelated majors;
- a candidate cannot identify its exact full SHA and revision;
- any command would mutate Firestore, Storage, Hosting, tasks, or production traffic without explicit authorization.

## Execution handoff

Open a separate session in the package worktree and load `executing-plans`. Execute one package at a time, beginning with Package A. Do not begin Package B holdout work until Package A and the preregistration gate are complete. At every production boundary, stop and request explicit authorization.
