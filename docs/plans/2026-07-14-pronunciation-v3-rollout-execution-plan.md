# Pronunciation V3 Vietnamese Cohort Verification Plan

**Goal:** Verify that Pronunciation V3 accurately detects how many syllables a Vietnamese L1 learner actually spoke and displays usable stress, pitch, intensity, and syllable-timing feedback for rateable recordings.

**Scope:** This plan is for the `l1-vn-01` (Vietnamese L1) cohort only. It does not require evidence from five L1 cohorts. American-English pronunciation remains the reference standard, but the acoustic result must come from the learner's recording rather than being forced from the target word.

**Core product outcomes:**

1. Report the number of syllables actually spoken.
2. Show the detected syllables and their timing.
3. Show stress/pitch and intensity patterns when the recording is rateable.
4. Return a clear unavailable/unrateable reason instead of fabricating feedback when the audio is insufficient.

---

## Rules

- Work from `C:\Cursor AI`.
- Keep raw recordings only under the ignored `test-results\pronunciation-segmentation-corpus\` directory.
- Do not commit recordings, consent data, names, account IDs, credentials, or tokens.
- Use only deidentified cohort ID `l1-vn-01` for this verification.
- Do not force the observed syllable count from the target word or expected count.
- Do not deploy or push production without explicit user approval.
- A local test pass is not a production deployment approval.

## Step 1: Validate the Vietnamese clean corpus

**Purpose:** Confirm that the current clean recordings and labels are suitable for the accuracy check.

**Current target set:** 127 clean `l1-vn-01` recordings.

**Required checks:**

- At least 120 clean Vietnamese L1 recordings.
- Every clean entry uses `speakerCohort: "l1-vn-01"`.
- Every entry has a positive `targetSyllableCount` and `expectedObservedCount`.
- Every manifest `sourceHash` matches its local WAV file.
- Clean recordings exist for `busy`, `photograph`, `photography`, `banana`, `camera`, and `university`.
- No personally identifying information appears in the manifest.

**Commands:**

```powershell
python -m unittest backend.test_pronunciation_segmentation_corpus -v
```

Accented, omission, and insertion samples may remain as targeted regression fixtures, but they are not a multi-cohort gate for this Vietnamese-only release.

**Stop condition:** Do not benchmark if a clean WAV is missing, a hash does not match, or a clean label is invalid.

## Step 2: Measure clean syllable-count accuracy

**Purpose:** Measure the current model against the 127 clean Vietnamese L1 recordings.

**Command:**

```powershell
python scripts/benchmarks/phoneme_model_probe.py `
  --manifest tests/fixtures/pronunciation-segmentation/manifest.json `
  --audio-dir test-results/pronunciation-segmentation-corpus `
  --revision ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4 `
  --output test-results/pronunciation-model-benchmark-vn-clean-rerun `
  --allow-composition-mismatch
```

`--allow-composition-mismatch` is temporary compatibility with the existing benchmark script's older multi-cohort rule. For this run, evaluate the `clean` category only. Do not interpret the flag as evidence for non-Vietnamese cohorts.

**Accuracy gate:**

- At least 95% exact syllable-count accuracy across the 127 clean recordings.
- All six mandatory words must be correct.
- The observed count must remain unchanged when a deliberately different expected count is supplied.

**Evidence to retain:**

- `benchmark-summary.md`
- `probe-results.json`
- Per-recording expected count, observed count, nuclei, and confidence

**Stop condition:** If the accuracy gate fails, continue only to Step 3. Do not build or deploy a candidate.

## Step 3: Diagnose and repair only the failing recordings

**Purpose:** Keep the repair loop focused instead of redesigning the whole pronunciation system.

For each failed clean recording, compare:

1. Expected syllable count.
2. Raw recognized IPA/phoneme sequence.
3. Detected vowel nuclei.
4. Final grouped syllables.

Classify each failure:

- **Recognizer failure:** the raw phoneme output omitted or invented a vowel nucleus.
- **Syllabifier failure:** the raw nuclei are usable, but grouping or glide/diphthong handling produced the wrong count.
- **Audio/label failure:** the recording is unclear or the manual label is incorrect.

**Repair rule:**

- Change `IndependentSyllabifier` only for demonstrated grouping errors.
- If the recognizer is losing nuclei, evaluate the recognizer/model rather than adding word-specific syllable rules.
- Preserve target-count independence.
- Add a focused regression test for every repaired error class.

After a repair, rerun Step 2 once and compare the new per-recording results with the saved baseline.

## Step 4: Verify stress and pitch feedback in Chrome

**Purpose:** Confirm the behavior the learner actually sees after recording.

**Local checks:**

```powershell
python -m unittest backend.test_phoneme_service backend.test_phoneme_model_manifest -v
npm run test:pronounce:logic
npm run test:pronounce:browser
```

Then use Chrome to test representative Vietnamese L1 recordings, including:

- A correct two-syllable word such as `busy`.
- A correct three-syllable word such as `photograph`.
- A longer word such as `photography` or `university`.
- One intentionally unclear recording.

**Confirm:**

- The displayed syllable count matches what was spoken.
- Syllable boundaries and durations appear when available.
- Pitch and intensity graphs are not blank for rateable recordings.
- Primary stress is derived from the recorded acoustic pattern.
- Unclear audio receives an explicit unrateable reason.
- Changing the expected count does not change the observed acoustic count.

If login is required, use `C:\Cursor AI\.local\browser-test-credentials.md`. Run the local Playwright Chrome check first; use the interactive browser-agent workflow only when live confirmation or screenshots are needed.

## Step 5: Package and release only after the core behavior passes

Packaging and deployment are not part of the accuracy repair loop.

After Steps 1–4 pass:

1. Build the recognizer container on a Docker-capable machine.
2. Confirm `/healthz`, `/readyz`, and `/version`.
3. Deploy a non-production candidate only with explicit approval.
4. Run the same representative Chrome recording checks against the candidate.
5. Use a small controlled Vietnamese L1 pilot if additional production confidence is wanted.

Production deployment remains a separate explicit decision. A mandatory seven-day, 500-attempt shadow run is not required by this simplified plan.

## Completion checklist

- [ ] 127 clean Vietnamese L1 recordings pass integrity checks.
- [ ] Clean exact syllable-count accuracy is at least 95%.
- [ ] All six mandatory words are correct.
- [ ] Observed counts are independent of expected target counts.
- [ ] Rateable recordings show syllable timing, pitch, intensity, and stress feedback.
- [ ] Unrateable recordings return an explicit reason.
- [ ] Focused backend, logic, and Chrome tests pass.
- [ ] Any container or deployment work has separate approval.
