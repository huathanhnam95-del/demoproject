# English Practice Pronounce V3

## Implementation report and production plan

Date: July 30, 2026  
Audience: English Practice Pronounce release team  
Scope: Adult Vietnamese-L1 English learners

> **Amended July 30, 2026 after two review rounds.** The first audit reproduced every claim in section 3 and found five defects: the trainer silently exported hand-written stress weights when no `stress_nuclei` rows existed and `--dry-run` wrote the artifact anyway; backend and network outages consumed learner re-record attempts; a stress-driven `incorrect` verdict rendered as a green "Verified" line; a failed health check dropped the learner onto browser-local V2 feedback; and a Praat failure returned a partial error body.
>
> A second review found four more: `google-auth` was missing from `backend/requirements.txt` although `phoneme_client.py` imports it to mint the Cloud Run ID token; `/health` reported an active deployment holding the placeholder artifact as `ok`; the learner UI still charged a re-record attempt for `RECOGNIZER_BUSY` and `RECOGNIZER_AUTH_FAILED`; and shadow telemetry read a `syllables` key that `recognize-v2` does not return, logging every `v3_count` as zero.
>
> All nine are fixed and covered by tests. Sections 2, 3, 4 and 5 reflect the corrected behaviour. The container smoke test remains unrun (Blocker C).

## 1. Executive summary

The requested Pronounce improvements have been implemented in code and verified locally. The learner flow now has:

- independent syllable-count evidence;
- conservative primary-stress verification;
- three states: verified, incorrect, and unrateable;
- no guessed wrong-stress location;
- two re-record requests, followed by an advisory-only result on the third recording;
- no green result from V2 or browser-local fallback analysis.

The feature is not ready to enable in production yet. The production verifier artifact is intentionally still `placeholder-untrained`, the existing feature shards were created before per-nucleus ranker data was added, and Docker is not installed in the current environment. The learner flag therefore remains off.

## 2. What was implemented

### Backend

- `/analyze/v3` is the authoritative learner endpoint.
- CTC and untargeted Praat syllable counts are compared; disagreement becomes `unrateable`.
- Count verification uses the CTC count, canonical/omission/insertion likelihoods, alignment confidence, and duration features.
- Stress verification uses relative within-recording duration, intensity, F0, spectral tilt, nucleus confidence, and voiced support.
- Stress is verified only when the expected nucleus clearly ranks first. The service does not claim which wrong syllable was stressed.
- Consequence to be aware of: with the ranker artifact the stress head can only return `verified` or `unrateable`, never `incorrect`. A correct syllable count with misplaced stress therefore reads as unrateable, not as a wrong answer. Only the count head can produce `incorrect` today.
- V3 failures return a complete unrateable response instead of a partial or misleading response. A Praat failure still answers 5xx so monitoring sees it, but the body carries the full unrateable contract.
- V3 responses include advisory-only `best_effort` data after the formal result is unrateable.
- V2 remains compatible for existing callers but cannot create a V3 learner pass.
- `/health` validates the verifier artifact rather than only parsing it. When the mode is `active` and the artifact fails validation the endpoint answers 503 with `status: degraded` and a `verifierStatus` reason, so deployment automation cannot accept an instance that is unable to score. `off` and `shadow` stay healthy with a placeholder, because V3 is not scoring in those modes.
- Shadow telemetry reads the `recognize-v2` fields (`decoded_syllable_count`, `canonical_alignment.syllables`) with a legacy v1 fallback, so the bake-off counts in section 5 step 2 are trustworthy.
- `backend/requirements.txt` pins `google-auth`, which `phoneme_client.py` imports lazily to mint the recognizer ID token whenever `PHONEME_SERVICE_AUTH=google`.

Key files:

- `backend/local_server/server.py`
- `backend/local_server/pronunciation_verifier.py`
- `backend/local_server/models/pronunciation-verifier-v1.json`
- `backend/test_pronunciation_verifier.py`
- `backend/test_pronunciation_api_v2.py`
- `backend/test_pronunciation_packaging.py`

### Training and data pipeline

- Feature extraction now stores aligned per-nucleus acoustic rows in `stress_nuclei`.
- Training exports a grouped stress-ranker artifact rather than a binary wrong-stress classifier.
- Training fails closed when no eligible stress-ranker rows survive filtering, instead of falling back to hand-written default weights. `--dry-run` evaluates without writing an artifact.
- Artifact validation checks schema, hashes, scaler shapes, finite parameters, fail-closed placeholder status, and that a ranker artifact records a positive number of training and calibration rows.
- Existing benchmark data remains useful for count calibration, but it must be re-extracted for the new stress-ranker fields before release.

Key files:

- `scripts/benchmarks/extract_pronunciation_calibration_features.py`
- `scripts/benchmarks/train_pronunciation_verifier.py`
- `scripts/benchmarks/pronunciation_calibration_schema.json`

### Pronounce UI

- The UI displays formal backend status only:
  - `Verified: ...`
  - `Incorrect: ...`
  - `Could not analyze this recording reliably.`
- The old guessed `Detected stress: syllable N` path was removed from learner feedback.
- Attempt state is keyed by word, variant, IPA, and expected count.
- First and second unrateable recordings request re-recording; the third shows an advisory warning.
- Word changes, variant changes, leaving Pronounce mode, reloads, and formal decisions reset the counter.
- Network, microphone, empty-audio, recognizer, and backend errors do not consume a recording attempt. Reasons that mean the service never judged the audio (`V3_NOT_ACTIVE`, `V3_VERIFICATION_UNAVAILABLE`, `V3_PRAAT_FAILED`, `V3_ANALYSIS_FAILED`, `MODEL_INFERENCE_FAILED`, `TIMEOUT`, `RECOGNIZER_BUSY`, `RECOGNIZER_AUTH_FAILED`, `CONTRACT_MISMATCH`, `INFERENCE_ERROR`, `VERIFIER_ARTIFACT_UNAVAILABLE`, `REFERENCE_CONFLICT`, `V2_FALLBACK_UNRATEABLE`) map to an `unavailable` status that the attempt counter ignores and that renders a service message rather than a re-record prompt. A packaging test asserts that every `RecognizerError` reason in `phoneme_client.py` appears in that set, so the two languages cannot drift apart again.
- When the learner flag is on, V3 is the sole authority for learner feedback. If the Praat health check fails at load and the pipeline falls back to browser-local analysis, the learner sees the service-unavailable message; the V2/local syllable and stress feedback is not rendered in V3's place.
- A formal `incorrect` driven by the stress head renders as an incorrect result, not as a verified one.

Key files:

- `public/pronunciation-analyzer/app.js`
- `public/pronunciation-analyzer/praat-api.js`
- `public/pronunciation-analyzer/verification-attempt-policy.js`
- `tests/pronunciation-analyzer/verification-attempt-policy.test.mjs`
- `tests/browser/pronounce-mode-browser-check.js`

## 3. Verification evidence

Passed:

```text
python -m unittest backend.test_phoneme_backends backend.test_phoneme_service backend.test_phoneme_syllabifier backend.test_pronunciation_verifier backend.test_pronunciation_packaging
Ran 107 tests ... OK
```

```text
python -m unittest backend.test_pronunciation_verifier_training backend.test_pronunciation_verifier_evaluation backend.test_pronunciation_calibration_dataset backend.test_pronunciation_feature_extraction backend.test_pronunciation_ctc_forward backend.test_pronunciation_arpabet backend.test_pronunciation_perturbations backend.test_kokoro_reference_dataset backend.test_perturbation_reference_dataset backend.test_vietnamese_external_dataset backend.test_vietnamese_external_evaluation backend.test_vietnamese_holdout_perturbations backend.test_pronunciation_api_v2_recognizer backend.test_pronunciation_api_v2 backend.test_pronunciation_alignment_v2 backend.test_phoneme_client
Ran 150 tests ... OK
```

```text
node --test tests/pronunciation-analyzer/analysis-pipeline.test.mjs tests/pronunciation-analyzer/praat-api-v2.test.mjs tests/pronunciation-analyzer/reference-ui-contract.test.mjs tests/pronunciation-analyzer/verification-attempt-policy.test.mjs
37 tests passed (all files under tests/pronunciation-analyzer/)
```

```text
node tests/browser/pronounce-mode-browser-check.js
pronounce-mode browser check passed

node tests/browser/pronounce-mode-syllable-playback-check.js
pronounce-mode syllable playback check passed
```

Calibration extraction dry run:

- 17,263 eligible SpeechOcean rows;
- 2,560 source recordings;
- dataset validation passed.

## 4. Current blockers

### Blocker A: no trained production artifact

`backend/local_server/models/pronunciation-verifier-v1.json` deliberately contains `placeholder-untrained`. Startup and runtime reject it. This prevents accidental production scoring with an uncalibrated model.

The existing feature shards do not contain the new `stress_nuclei` field. This is now enforced rather than assumed: `_fit_stress_ranker` raises when no eligible training or calibration rows survive, so a run against the old shards exits non-zero and writes nothing, and `validate_artifact` rejects any ranker artifact whose `training_positive_rows` or `calibration_positive_rows` is missing or zero. The placeholder hash is no longer the only thing standing between an untrained ranker and production.

### Blocker B0: the recognizer benchmark corpus cannot satisfy its own gate

`tests/fixtures/pronunciation-segmentation/manifest.json` holds 194 entries:
190 clean, 1 accented, 2 omission, 1 insertion, all from a single cohort
(`l1-vn-01`). The probe requires at least 60 clean, 30 accented and 30
adversarial samples and aborts otherwise, which is why the July 28 runs
recorded `verdict: provider-evaluation-required` and `cleanAccuracy 0.5354`.

The `cleanAccuracy 0.9167` figure in `backend/phoneme_service/model-manifest.json`
comes from a later re-recorded clean subset and can only have been produced
with `--allow-composition-mismatch`. It is a clean-only, single-cohort number
and should not be read as production accuracy. Closing this gap needs roughly
30 accented and 30 adversarial recordings — the only genuinely
manual-recording item remaining, and it affects confidence in the number
rather than the safety of the count-only release, whose precision is measured
independently on the SpeechOcean held-out split.

Re-running the probe with `--allow-composition-mismatch` on July 31 produced
`cleanAccuracy 0.8474`, 5/6 mandatory words, `verdict: torch`, warm median
202 ms, peak RSS 0.163 GiB. The difference from `0.9167` is not run variance:
`corpusManifestHash` changed from `6f5da154…` to `d0aa83bf…`, so the two
numbers were measured on different corpora. Model and tokenizer checksums are
unchanged.

The probe previously recorded `evidenceStatus: verified` whether or not the
composition gate had been waived — the warning went to stdout and never
reached the deployment artifact that `phoneme_service/app.py` gates readiness
on. `require_benchmark_evidence` now returns the waived requirements and
`write_manifest` records them as `waivedRequirements` with
`evidenceStatus: composition-waived`.

`phoneme_service/app.py` now accepts `composition-waived` so a
segmentation-only release can deploy, logs a warning naming the waived
requirements at load, and `/readyz` echoes `evidenceStatus` and
`waivedRequirements` in its 200 response so an operator sees the caveat
without reading container logs. Anything other than `verified` or
`composition-waived` still refuses to become ready.

### Blocker B: model comparison is not complete

The release plan requires a comparison of:

1. `facebook/wav2vec2-lv-60-espeak-cv-ft`
2. `facebook/wav2vec2-xlsr-53-espeak-cv-ft`

The selected model must meet both count precision gates. No new comparison result was used to promote this implementation.

### Blocker C: container smoke test unavailable

Docker is not installed in this environment, so the two-service container smoke test has not been run locally.

### Blocker D: production evidence gates remain open

The learner flag is still `false` in `public/pronunciation-analyzer/config.js`. No production deployment or feature-flag enablement was performed.

## 5. Next-step execution plan

### Step 1 - Re-extract the calibration features

Run the feature extractor against the immutable adult dataset using the selected recognizer candidate. Confirm that every retained stress-positive row contains:

- at least two nuclei;
- a valid expected stress index;
- finite acoustic fields;
- voiced and alignment support;
- no speaker, recording, derivative, or lexical-holdout leakage.

Keep failures in the coverage denominator.

### Step 2 - Benchmark both recognizer candidates

Run the same frozen dataset and threshold procedure for both required wav2vec2 candidates. Select the candidate with the highest automatic coverage only if both verified and incorrect count precision are at least 95%. If neither passes, leave V3 disabled.

### Step 3 - Train and freeze the verifier artifact

Train the count head and grouped stress ranker. Calibrate thresholds on calibration speakers, export JSON, calculate the artifact SHA, and replace the placeholder only after:

- count precision, coverage, and mismatch recall gates pass;
- stress false-verification gates pass;
- Vietnamese clean and transformed-error checks pass;
- prior-only and alignment-only ablations are beaten;
- the untouched final holdout has not been used for tuning.

### Step 4 - Run the release gate report

Publish one report containing:

- overall precision and coverage;
- inference failures;
- adult male/female subgroup results;
- calibration error;
- count mismatch recall;
- stress-positive verification rate;
- every real Vietnamese non-clean sample individually;
- synthetic Kokoro and transformed results separately.

### Step 5 - Build and smoke-test both services

Use the repository Dockerfiles:

1. Build/deploy the phoneme recognizer.
2. Confirm `/readyz`, tokenizer blank ID, model revision, and recognizer contract.
3. Build/deploy the Praat/V3 service.
4. Set `PHONEME_SERVICE_URL`, `PRONUNCIATION_V3_MODE` (`shadow` first, then `active`), and `PRONUNCIATION_VERIFIER_ARTIFACT` if the artifact is not at the default path. Startup rejects an unknown mode and requires `PHONEME_SERVICE_URL` whenever the mode is not `off`. Confirm the effective values via `/health` (`pronunciationV3Mode`, `verifierRevision`).
5. Run stored-sample checks against the deployed services.

### Step 6 - Enable safely

1. Deploy V3 in shadow mode.
2. Run authenticated Chrome checks using `C:\Cursor AI\.local\browser-test-credentials.md`.
3. Keep the learner flag off while checking production responses.
4. Confirm V2/local fallback cannot create a green result.
5. Enable `usePronunciationV3LearnerAnalysis` only for English Practice -> Pronounce.
6. Monitor the first 100 attempts and publish the automatic report.

### Step 7 - Roll back if necessary

Rollback order:

1. Turn off the learner feature flag.
2. Restore the previous Praat API revision.
3. Restore the previous phoneme recognizer revision if required.

## 6. Plain-language explanation

The code changes are ready, but the “scoring brain” is not trained and approved yet.

Right now the app has the safety rules and the user experience, but it is intentionally refusing to give official scores because the model file is a placeholder. That is why the feature is still switched off.

To put this into production, the team must first:

1. Re-run the audio analysis so each syllable has the new duration, loudness, and pitch measurements.
2. Train the scoring model with those measurements.
3. Test it on recordings it has never seen before.
4. Confirm it is accurate enough and safely says “I cannot tell” when uncertain.
5. Package and deploy the recognizer and Praat services.
6. Test the real production services with Chrome.
7. Turn on the Pronounce feature flag.

In short: the user-facing screens are implemented; the remaining work is to produce and approve the real trained model, then deploy the two backend services and enable the flag.

## 6a. Count-only release profile (July 31, 2026)

The full verdict model is not achievable on the current corpus: only 589 of
17,202 feature rows carry a stress label, and the held-out evaluation returned
`incorrect_precision 0.0` with `count_mismatch_recall 0.0` over 426 real
mismatches. Synthetic augmentation did not move either number. Detecting wrong
pronunciations therefore needs mispronounced audio the corpus does not contain.

The shipped release is a **count-only profile** instead:

- `release_profile: count-only`, `stress.mode: disabled` — stress is never fitted, never exported, never scored, and never claimed.
- The count head keeps its calibrated `verified` threshold but its `incorrect` threshold is the disabling sentinel, so `incorrect` is unreachable by construction.
- Learners see `Verified: N syllables confirmed.` when the count is confirmed, and an honest "could not analyze" otherwise. No verdict is ever invented.

Held-out test split (7,979 rows, never used for fitting or thresholds):

| Metric | Value | Gate |
|---|---|---|
| Verified precision | 0.9813 | ≥ 0.95 pass |
| Verified precision, bootstrap lower 95% | 0.9773 | pass |
| Verified decisions | 4,543 | pass |
| Coverage | 0.569 | confirms ~57%, silent otherwise |
| Incorrect decisions | 0 | disabled by design |
| Expected calibration error | 0.023 | pass |
| Female subgroup precision | 0.9710 | pass |
| Male subgroup precision | 0.9916 | pass |

The remaining failing gates in the evaluation report (`incorrect_*`,
`count_mismatch_recall`, `stress_*`, `acoustic_ablation`) all concern the
disabled classes and do not apply to this profile.

### Charts and playback

Segmentation is treated as descriptive, not as a verdict, so the pitch chart,
the duration chart, and syllable playback render whenever spans exist —
including when the count could not be confirmed. When the recognizer is
unavailable the response carries `segmentation_source: praat-fallback` with
untargeted Praat nuclei so charts and playback keep working, while
`syllable_count` stays unset and verification stays `unrateable`.

Components marked `applicable: false` are excluded from the re-record attempt
decision, so the permanent `STRESS_SCORING_DISABLED` reason cannot mask a
recognizer outage.

## 7. Release decision

Current decision: **do not enable in production yet**.

Reason: the implementation is locally tested, but the trained artifact, model bake-off, final accuracy gates, and container deployment evidence are not complete.
