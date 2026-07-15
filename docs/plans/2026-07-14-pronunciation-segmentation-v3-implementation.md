# Pronunciation Segmentation V3 Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Reliably identify the syllables a learner actually produced—including missing and extra syllables—while restoring fresh-word native graphs, reliable duration data, and low-cost self-hosted operation.

**Architecture:** Repair the native-analysis cache independently, then benchmark and select a phoneme inference engine. Run the selected engine in a private `phoneme-recognizer` Cloud Run service; keep the existing `praat-api` as the public orchestrator that combines independent phoneme timing with Praat prosody through `/analyze/v3`. Native reference audio remains on `/analyze-url/v2`.

**Tech Stack:** Flask, PyTorch/Transformers or ONNX Runtime, Parselmouth/Praat, Google-authenticated Cloud Run services, Cloud Build, JavaScript ES modules, Python `unittest`, Node tests, and Playwright Chrome.

---

## Fixed decisions and safety constraints

- Learner syllable count comes only from independently observed phoneme nuclei. Target IPA and expected count are comparison inputs and must never synthesize, split, merge, or prune learner syllables.
- `PRONUNCIATION_V3_MODE=off|shadow|active` is a validated environment variable on `praat-api`, defaults to `off`, and is reported by `/health`. The frontend does not choose the scoring engine.
- Low-confidence recognition fails closed with a retry message. V2 may still supply contours, but its acoustic count cannot be presented as an independently observed learner count.
- Raw learner audio, consent records, and user identifiers never enter Git or structured logs.
- Existing dirty-worktree changes are user-owned. Before editing an overlapping file, inspect its current diff and preserve all unrelated hunks.
- Do not commit, push, deploy, alter IAM, or route production traffic unless separately authorized.

## Delivery sequence

1. Ship-ready cache repair.
2. Automated corpus plus a parallel manual first-party recording milestone.
3. PyTorch/ONNX feasibility benchmark and engine manifest.
4. Private recognizer runtime.
5. Service-to-service authentication.
6. Public `/analyze/v3` orchestration.
7. Learner UI integration.
8. Reproducible packaging and candidate infrastructure.
9. Full quality verification.
10. Shadow rollout and gated promotion.

Tasks 4–10 stop if Task 3 selects neither PyTorch nor ONNX. In that case, benchmark SpeechAce using the same corpus and produce a separate decision report. Tasks 3–8 may use the completed automated corpus while first-party collection proceeds, but Task 9 promotion gates and Task 10 active rollout require all 30 first-party Vietnamese-accented recordings.

---

## Task 1: Repair fresh-word native-analysis caching

**Files**

- Modify: `public/pronunciation-analyzer/word-reference-service.js`
- Modify: `public/pronunciation-analyzer/reference-contract.js`
- Test: `tests/pronunciation-analyzer/reference-contract.test.mjs`
- Test: `tests/browser/pronounce-mode-browser-check.js`

### 1.1 Write failing cache-refresh tests

Cover these cases individually:

- a valid audio-backed cached variant with no `nativeAnalysis` is refreshed;
- unusable native contours are refreshed;
- the first `/analyze-url/v2` failure and second success produces graphs;
- two failures preserve dictionary data but do not create a permanent successful graphless cache hit;
- a legitimate CMU/no-audio variant does not retry;
- a session-cache entry follows the same refresh rules as Firestore.

Run:

```powershell
node --no-warnings tests/pronunciation-analyzer/reference-contract.test.mjs
```

Expected: the new stale-analysis and retry tests fail for the missing behavior.

### 1.2 Implement refresh classification and retry

- Export `needsNativeAnalysisRefresh(reference)` from `reference-contract.js`.
- Refresh only variants that are valid, audio-backed, and missing usable contours.
- Add the named constant `NATIVE_ANALYSIS_RETRY_DELAY_MS = 500`; do not leave an unexplained literal delay.
- Retry once. Do not loop and do not retry non-transient 4xx validation errors.
- Preserve dictionary information after both attempts fail.
- Mark the native analysis retryable on the next lookup and show `Native contour temporarily unavailable` rather than a blank chart.

### 1.3 Verify logic and Chrome behavior

```powershell
node --no-warnings tests/pronunciation-analyzer/reference-contract.test.mjs
node tests/browser/pronounce-mode-browser-check.js
```

Expected: both commands pass; fresh-word graph recovery and legitimate graphless fallbacks are both covered.

---

## Task 2: Establish the evaluation corpus

**Files**

- Create: `docs/testing/pronunciation-v3-corpus-protocol.md`
- Create: `scripts/audit/build-pronunciation-segmentation-corpus.py`
- Create: `tests/fixtures/pronunciation-segmentation/manifest.schema.json`
- Create: `tests/fixtures/pronunciation-segmentation/manifest.json` as the deidentified corpus index
- Create: `backend/test_pronunciation_segmentation_corpus.py`

### 2.1 Define the manifest and privacy rules

Each manifest row contains only:

- stable deidentified sample ID;
- target word and reference IPA;
- expected observed count and a separately verified canonical target syllable count;
- sample category: `clean`, `omission`, `insertion`, `accented`, or `unrateable`;
- speaker cohort, never a name or account ID;
- source hash and label provenance;
- manually verified syllable spans when applicable.

Raw recordings and consent records stay in access-controlled storage outside the repository. Local downloads go under ignored `test-results/pronunciation-segmentation-corpus/`.

### 2.2 Build the 120-recording minimum corpus

- 60 clean American-English recordings covering monophthongs, diphthongs, rhotic nuclei, schwa, syllabic consonants, weak vowels, and final consonant clusters.
- 30 adversarial recordings generated deterministically from manually verified clean spans by deleting or duplicating one syllable region.
- 30 first-party Vietnamese-accented recordings: five consenting adults saying six prompts each.
- Mandatory prompts: `busy`, `photograph`, `photography`, `banana`, `camera`, and `university`.

L2-ARCTIC may be used for preliminary research only after license review. It does not replace the first-party five-speaker promotion corpus.

### 2.3 Complete the manual first-party prerequisite

- Owner: a human research/data-collection coordinator, not the implementation agent.
- Expected duration: 5–10 business days after five speakers and the consent text are available.
- Required output: 30 deidentified, consented recordings plus labels and hashes that satisfy the manifest schema.
- Engineering may continue through Task 8 using the automated corpus, but Task 9 cannot declare the accented-speech gate passed and Task 10 cannot activate v3 until this milestone is complete.

### 2.4 Validate corpus integrity

```powershell
python -m unittest backend.test_pronunciation_segmentation_corpus -v
```

Expected: schema, category counts, unique IDs, hashes, and mandatory-word coverage pass. Active promotion remains blocked until the first-party cohort is complete.

---

## Task 3: Benchmark and select the inference engine

**Files**

- Create: `scripts/benchmarks/phoneme_model_probe.py`
- Create: `backend/phoneme_service/model-manifest.schema.json`
- Create: `backend/phoneme_service/model-manifest.json` from the benchmark verdict
- Create: `docs/audits/pronunciation-segmentation/model-benchmark-template.md`
- Create: `backend/test_phoneme_model_manifest.py`

### 3.1 Benchmark the pinned PyTorch model

For a pinned revision of `facebook/wav2vec2-lv-60-espeak-cv-ft`, record:

- artifact size and checksum;
- tokenizer vocabulary and checksum;
- emitted eSpeak/IPA symbols;
- cold-load latency;
- peak resident memory while loading and during inference;
- warm inference median and p95;
- clean count accuracy;
- omission and insertion detection;
- available Vietnamese-accented accuracy.

### 3.2 Calibrate confidence thresholds without contaminating the holdout

- Split the corpus deterministically into calibration and holdout partitions by source and speaker so one speaker or transformed source never appears in both.
- Start with mean phoneme confidence `0.65` and per-nucleus confidence `0.45`.
- Search mean thresholds from `0.50` through `0.80` in `0.05` steps and nucleus thresholds from `0.35` through `0.60` in `0.05` steps.
- Select the pair with the highest rateable coverage that still achieves at least 95% clean count accuracy and 90% insertion/omission precision on the calibration partition; break ties in favor of the higher thresholds.
- Freeze the selected values in `model-manifest.json`. All final accuracy and promotion claims use only the untouched holdout partition.

### 3.3 Execute the deterministic selection tree

1. Select PyTorch when peak RSS is at most 3.2 GiB and at least five of the six mandatory clean words are correct.
2. Otherwise export and benchmark an INT8 ONNX version of the same pinned model.
3. Select ONNX only when its accuracy is within one percentage point of PyTorch, peak RSS is at most 2 GiB, and latency or memory improves by at least 25%.
4. If neither engine passes, stop Tasks 4–10 and benchmark SpeechAce.

The 5/6 rule is a feasibility gate, not a production quality gate. Any engine entering implementation with 5/6 must gain a regression fixture and reach 6/6 through verified decoding, symbol normalization, or audio preprocessing before promotion. It may not be promoted at 5/6.

### 3.4 Record the decision

- Raw JSON and Markdown: ignored `test-results/pronunciation-model-benchmark/`.
- Sanitized tracked report: `docs/audits/pronunciation-segmentation/`.
- Tracked `backend/phoneme_service/model-manifest.json` containing schema version, selected engine, model revision, tokenizer checksum, model checksum, and quantization details.

```powershell
python scripts/benchmarks/phoneme_model_probe.py --manifest tests/fixtures/pronunciation-segmentation/manifest.json --output test-results/pronunciation-model-benchmark
python -m unittest backend.test_phoneme_model_manifest -v
```

Expected: the report produces exactly one verdict—`torch`, `onnx`, or `provider-evaluation-required`—and the manifest validates when a local engine is selected.

---

## Task 4: Build the private phoneme recognizer in three verified slices

**Files**

- Create: `backend/phoneme_service/app.py`
- Create: `backend/phoneme_service/recognizer.py`
- Create: `backend/phoneme_service/backends.py`
- Create: `backend/phoneme_service/syllabifier.py`
- Create: `backend/requirements.phoneme-torch.txt`
- Create: `backend/requirements.phoneme-onnx.txt`
- Create: `backend/test_phoneme_backends.py`
- Create: `backend/test_phoneme_syllabifier.py`
- Create: `backend/test_phoneme_service.py`

### 4A: Engine backend and raw CTC decoding

`RecognizerBackend.recognize(samples, sample_rate)` returns phoneme symbols, frame spans, confidence, effective stride, engine version, and model revision. Implement `TorchRecognizerBackend` and `OnnxRecognizerBackend`; instantiate only the backend selected by `model-manifest.json`.

- Accept WAV up to 5 MB and 15 seconds.
- Downmix stereo and resample only when the input is not already mono 16 kHz.
- Remove CTC blanks and group repeated frames.
- Derive timestamps from the effective model stride.
- Generate and validate the supported symbol table from the pinned tokenizer.

```powershell
python -m unittest backend.test_phoneme_backends -v
```

Expected: manifest selection, audio normalization, raw decoding, timestamp conversion, confidence extraction, and engine parity fixtures pass before syllabification begins.

### 4B: Independent syllabification and calibrated quality policy

- Apply longest-match normalization before nucleus detection.
- Treat diphthongs and rhotic sequences as one nucleus.
- Support schwa and syllabic consonants.
- Never accept target word, target IPA, or expected count.
- Load the frozen mean and per-nucleus confidence thresholds from `model-manifest.json`; do not duplicate threshold literals in runtime code.

A result is rateable only when:

- at least one nucleus is detected;
- mean accepted phoneme confidence meets `quality.meanPhonemeConfidence` from the manifest, initially calibrated from candidate `0.65`;
- every accepted nucleus meets `quality.minNucleusConfidence` from the manifest, initially calibrated from candidate `0.45`;
- existing duration and energy gates pass.

Return one explicit reason when unrateable:

- `NO_SPEECH`
- `NO_PHONEME_SEQUENCE`
- `LOW_PHONEME_CONFIDENCE`
- `MODEL_UNAVAILABLE`
- `MODEL_INFERENCE_FAILED`
- `RECOGNIZER_BUSY`

```powershell
python -m unittest backend.test_phoneme_syllabifier -v
```

Expected: monophthongs, diphthongs, rhotic vowels, syllabic consonants, omissions, insertions, independent counts, and fail-closed quality decisions pass.

### 4C: Flask service and operational endpoints

- `POST /recognize/v1`: private inference endpoint.
- `GET /healthz`: process liveness; never acquires the inference semaphore.
- `GET /readyz`: 200 only after model and tokenizer validation; never acquires the inference semaphore.
- `GET /version`: selected engine, model revision, manifest checksum, and build SHA.

Run:

```powershell
python -m unittest backend.test_phoneme_service -v
```

Expected: request validation, size/duration limits, busy behavior, health endpoints, readiness, version identity, and backend integration pass.

---

## Task 5: Add private Cloud Run authentication

**Files**

- Create: `backend/local_server/phoneme_client.py`
- Modify: `backend/requirements.txt`
- Create: `backend/test_phoneme_client.py`
- Modify: `backend/test_pronunciation_api_v2.py`

### 5.1 Implement the authenticated client

- Add a pinned compatible `google-auth` dependency.
- Use `PHONEME_SERVICE_URL` without a path as the ID-token audience.
- Send the Google-signed token in `Authorization: Bearer`.
- Cache it until five minutes before expiry.
- Retry once only when a token refresh resolves a 401/403.
- Map persistent 401/403 to `RECOGNIZER_AUTH_FAILED`.
- Never retry model, quality, or validation failures.

### 5.2 Lock down local bypass

Permit `PHONEME_SERVICE_AUTH=disabled` only when:

- the target hostname is `localhost` or `127.0.0.1`; and
- the Cloud Run marker `K_SERVICE` is absent.

If `K_SERVICE` exists while auth is disabled, fail application startup with a configuration error. Log no token contents.

### 5.3 Define IAM configuration

- Runtime identity: `praat-api-runtime@parselmouth.iam.gserviceaccount.com`.
- Attach it to `praat-api`.
- Disable unauthenticated access to `phoneme-recognizer`.
- Grant the runtime identity only `roles/run.invoker` on `phoneme-recognizer`.
- Do not create or download service-account keys.
- Record the exact `gcloud` service-account, service-identity, and `roles/run.invoker` commands in `docs/runbooks/pronunciation-backend.md`; do not introduce Terraform solely for this feature.
- Treat those commands as an authorization-gated deployment checklist. Unit tests cover client behavior, but IAM changes require a no-traffic candidate smoke test.

Run:

```powershell
python -m unittest backend.test_phoneme_client backend.test_pronunciation_api_v2 -v
```

Expected: token caching, refresh, auth failure mapping, localhost bypass, and Cloud Run startup rejection all pass.

---

## Task 6: Add the public `/analyze/v3` orchestrator

**Files**

- Modify: `backend/local_server/server.py`
- Test: `backend/test_pronunciation_api_v2.py`
- Test: `backend/test_pronunciation_alignment_v2.py`

### 6.1 Define the request and response contract

Accept multipart `audio`, optional `reference_ipa`, and optional `expected_syllables`. The optional fields are comparison-only.

Return `pronunciation-analysis-v3` with:

- `mode`: `off`, `shadow`, or `active`;
- `engine`: `praat-v2` or `ctc-praat`;
- rateability, confidence, reasons, and degraded status;
- observed phonemes and independently segmented syllables;
- comparison count delta and edit operations;
- pitch, intensity, total duration, and sample rate;
- capabilities for graphs, syllable duration, and phoneme alignment.

### 6.2 Fuse independent timing with Praat prosody

- Run Praat and private recognition concurrently.
- Use phoneme boundaries as authoritative learner segmentation.
- Aggregate pitch, intensity, total duration, and voiced duration inside each observed span.
- Preserve total duration when vowel duration is unavailable.
- Compare with target IPA only after observation is complete.
- Use stable edit-alignment tie order: match, substitution, deletion, insertion.

### 6.3 Implement runtime modes

- Read `PRONUNCIATION_V3_MODE` from the `praat-api` environment at startup, default it to `off`, reject unknown values, and expose the effective value through `/health`.
- Require `PHONEME_SERVICE_URL` when mode is `shadow` or `active`; fail startup instead of silently downgrading a misconfigured candidate.
- `off`: execute v2 only and adapt it to the v3 response shape.
- `shadow`: execute both, log disagreement, and return v2-adapted output.
- `active`: return v3; retain Praat contours when recognition is unrateable.
- Hard orchestrator timeout: 18 seconds.
- Configure the `praat-api` Cloud Run request timeout to 30 seconds, leaving 12 seconds for request parsing, cancellation, response serialization, and platform overhead after the 18-second application deadline.
- Never use a v2 acoustic count as a confident v3 learner count.

```powershell
python -m unittest backend.test_pronunciation_api_v2 backend.test_pronunciation_alignment_v2 -v
```

Expected: all existing v2/native tests remain green; v3 observation, comparison-only targets, modes, timeout, and degraded behavior pass.

---

## Task 7: Integrate the learner frontend

**Files**

- Modify: `public/pronunciation-analyzer/praat-api.js`
- Modify: `public/pronunciation-analyzer/analysis-pipeline.js`
- Modify: `public/pronunciation-analyzer/app.js`
- Modify: `public/pronunciation-analyzer/syllable-verifier.js`
- Test: `tests/pronunciation-analyzer/praat-api-v2.test.mjs`
- Test: `tests/pronunciation-analyzer/analysis-pipeline.test.mjs`
- Test: `tests/pronunciation-analyzer/syllable-verifier.test.mjs`

### 7.1 Adopt the server-controlled v3 contract

- Call `/analyze/v3` once health advertises v3 support.
- Treat `mode` and `engine` as server-owned.
- Start a two-second timer when the request begins.
- If still pending, show `Preparing speech analysis…`.
- Clear the timer on success or failure.
- Do not add streaming or heartbeat infrastructure.

### 7.2 Render timings and mismatch feedback safely

- Display total duration whenever finite.
- Show `—` only when neither total nor vowel duration exists.
- Use target labels only for aligned matches.
- Label inserted or unresolved regions `Observed 1`, `Observed 2`, and so on.
- Bound label widths and allow horizontal scrolling so regions cannot overlap.
- Keep raw phoneme arrays internal in v1.

Support these messages:

- `The second target syllable was not detected.`
- `An extra vowel beat was detected after syllable 2.`
- `The syllable count is uncertain; try again more clearly.`
- `Speech analysis is temporarily unavailable; try again.`

```powershell
npm run test:pronounce:logic
```

Expected: frontend logic passes, including delayed-status cleanup, duration fallback, mismatch labels, and fail-closed feedback. The current `test:pronounce:logic` script already runs the three touched frontend test modules among ten pronunciation tests; modify `package.json` only if implementation creates an additional JavaScript test module.

---

## Task 8: Package and build reproducibly

**Files**

- Create: `backend/Dockerfile.phoneme`
- Create: `backend/cloudbuild.phoneme.yaml`
- Modify: `.gcloudignore`
- Modify: `backend/test_pronunciation_packaging.py`
- Modify: `docs/runbooks/pronunciation-backend.md`

### 8.1 Define Cloud Build

Use:

```yaml
timeout: 1800s
options:
  machineType: E2_HIGHCPU_8
  logging: CLOUD_LOGGING_ONLY
```

Accept `_GIT_SHA`, `_MODEL_REVISION`, `_INFERENCE_ENGINE`, and `_REPOSITORY`. Build an immutable SHA-tagged image. The build must not deploy or change traffic.

Update the deny-by-default `.gcloudignore` whitelist explicitly for:

- `backend/Dockerfile.phoneme`;
- `backend/cloudbuild.phoneme.yaml`;
- both `backend/requirements.phoneme-*.txt` files;
- `backend/phoneme_service/*.py`;
- `backend/phoneme_service/model-manifest.json` and its schema.

Do not broaden the whitelist to all of `backend/` or include tests, local audio, credentials, or `test-results/`.

### 8.2 Define the runtime shape

Shadow candidate:

- 2 vCPU;
- 4 GiB memory;
- concurrency 1;
- minimum instances 0;
- maximum instances 3;
- one Gunicorn worker;
- two request threads;
- one inference semaphore.

The second thread exists for health/readiness handling; it is not expected to increase inference throughput.

Active candidate after promotion approval:

- same CPU, memory, and concurrency;
- maximum instances 10;
- minimum instances 0 initially.

Set both the recognizer and `praat-api` Cloud Run request timeouts to 30 seconds in the authorization-gated deployment commands. The application-level recognizer/orchestrator deadlines remain shorter and must cancel work before the platform deadline.

Configure `/readyz` as the startup probe and `/healthz` as liveness.

### 8.3 Define numerical alerts

- Cloud Billing budget for the recognizer: USD 50/month, notifications at 50%, 90%, and 100% forecast/actual thresholds.
- Instance-count alert: more than five active recognizer instances for ten consecutive minutes.
- Warm p95 latency alert: above two seconds for ten consecutive minutes.
- `RECOGNIZER_BUSY` alert: above 2% of requests over 15 minutes.
- Authentication failure alert: any sustained `RECOGNIZER_AUTH_FAILED` rate above 0.5% over five minutes.

```powershell
python -m unittest backend.test_pronunciation_packaging -v
docker build --file backend/Dockerfile.phoneme --tag phoneme-recognizer:candidate .
```

Expected: packaging tests and local image build pass; the selected model is available offline at runtime.

---

## Task 9: Execute full verification

**Files**

- Create: `scripts/audit/pronunciation-segmentation-audit.py`
- Create: `backend/test_pronunciation_segmentation_audit.py`

### 9.1 Automated suites

```powershell
python -m unittest backend.test_pronunciation_segmentation_corpus backend.test_phoneme_model_manifest backend.test_phoneme_backends backend.test_phoneme_syllabifier backend.test_phoneme_service backend.test_phoneme_client backend.test_pronunciation_api_v2 backend.test_pronunciation_alignment_v2 backend.test_pronunciation_packaging backend.test_pronunciation_segmentation_audit -v
npm run test:pronounce:logic
npm run test:pronounce:browser
python scripts/audit/pronunciation-segmentation-audit.py --base-url $candidateUrl
```

Browser verification is Chrome-only. If login is required, first read `C:\Cursor AI\.local\browser-test-credentials.md` and use the documented admin account without copying credentials into tracked artifacts.

### 9.2 Required behavioral cases

- `busy` → 2
- `photograph` → 3
- `photography` → 4
- `banana` → 3
- `camera` → 2
- `university` → 5
- removed middle syllable reduces observed count;
- duplicated middle syllable increases observed count;
- diphthongs remain one nucleus;
- final consonant tails do not become syllables;
- weak schwa remains detectable;
- noise and whispered speech fail closed;
- fresh audio-backed words receive graphs;
- every rateable observed syllable has a positive duration and the duration chart renders.

### 9.3 Promotion gates

- Mandatory clean words: 6/6.
- Overall clean count accuracy: at least 95%.
- Insertion precision and recall: each at least 90%.
- Omission precision and recall: each at least 90%.
- Vietnamese-accented count accuracy: at least 90%.
- Boundary mean absolute error: at most 60 ms.
- Duration available for at least 98% of rateable recordings.
- Warm `/analyze/v3` p95: at most two seconds.
- Cold request p95: at most 15 seconds with visible loading feedback.
- Peak recognizer RSS: at most 3.5 GiB.
- Fresh native graph availability: at least 99%.
- Zero target-forced learner counts.
- Zero unexplained blank graphs.

Any failed gate blocks promotion and becomes a regression fixture before another candidate.

---

## Task 10: Shadow rollout and rollback

### 10.1 Shadow requirements

- Deploy both services as no-traffic candidates only after local verification and explicit deployment authorization.
- Run `shadow` mode for at least seven days and 500 valid attempts.
- Log v2/v3 counts, disagreement category, confidence, latency, reason code, model revision, and target word.
- Never log audio, tokens, consent data, or user identifiers.
- Use at most three recognizer instances during shadow mode.

### 10.2 Active promotion

- Promote only after every Task 9 gate passes.
- Raise maximum instances to ten to support classroom bursts.
- Return `RECOGNIZER_BUSY` rather than allowing a request to exceed the 18-second orchestrator timeout.
- Keep minimum instances at zero initially.
- Raising minimum instances or maximum instances beyond ten requires explicit cost approval.

### 10.3 Rollback and model updates

- Change mode to `off` in a configuration revision or route traffic to the previous verified revision.
- Preserve v2 and native endpoints throughout rollout.
- Every model update requires a new manifest, benchmark, full audit, shadow comparison, and explicit promotion.

---

## Explicit non-goals

- Do not modify `backend/connected_speech_worker.py`; it remains an independent Azure connected-speech component.
- Do not remove `xlsxwriter` during this feature.
- Do not display phoneme-level timelines to learners in v1.
- Do not use Azure, SpeechSuper, or SpeechAce as the authoritative observed syllable count.
- Do not replace native `/analyze-url/v2` alignment.
- Do not weaken confidence, corpus, latency, or accuracy gates to meet a schedule.

## Completion definition

The task is complete only when the cache repair is verified, one independent engine is selected from recorded evidence, v3 passes all automated and empirical gates, the shadow cohort satisfies the rollout thresholds, and production promotion—if requested separately—retains a tested immediate rollback path.
