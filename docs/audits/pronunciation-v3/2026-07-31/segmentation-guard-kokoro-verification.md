# Segmentation guard — Kokoro corpus verification

Date: July 31, 2026
Scope: Empirical validation of the `split_oversized_syllables` count-matched guard before production release
Harness: `scripts/benchmarks/evaluate_segmentation_guard.py`
Raw output: `test-results/pronunciation-kokoro-benchmark/segmentation-guard-ab.json`

## 1. Why this was run

The guard added in `backend/local_server/server.py` was derived from a single
hand-labelled recording (`industrial`). One sample is not sufficient evidence to
change segmentation behaviour for every word, so the guard was A/B'd across the
existing 250-file Kokoro benchmark corpus (50 words x 5 synthetic voices) with
CMU-derived syllable counts as ground truth.

Both arms run identical code except for the guard condition itself. The pre-fix
arm is reconstructed from the live function source with only
`or len(syllables) >= expected_count` removed, so `expected_avg` — and therefore
`max_duration` — is identical in both arms. Rewriting `expected_count` to force
the old path would have changed the split threshold too and attributed that
difference to the guard.

## 2. Results

| Metric | Guard ON (shipped) | Guard OFF (pre-fix) |
|---|---:|---:|
| Files analyzed | 250 | 250 |
| Syllable-count correct | 250 / 250 | 250 / 250 |
| Count accuracy | 1.000 | 1.000 |
| Files with internal gaps | **0** | 2 |
| Total spurious gap | **0.000 s** | 0.175 s |
| Analysis errors | 0 | 0 |

Files that lost gap artifacts:

| File | Word | Gap removed |
|---|---|---:|
| `kokoro-bf_emma-abundance` | abundance | 85 ms |
| `kokoro-bm_george-abandon` | abandon | 90 ms |

No file regressed on either metric.

## 3. Reading these numbers honestly

**Count accuracy of 1.000 is not evidence of quality.** In the target-guided
path (`allow_expected_adjustment=True`) the pipeline prunes and aligns spans to
the expected count by construction, so the observed count equals the expected
count regardless of the guard. The metric is saturated and cannot discriminate
between the two arms. It is reported only to demonstrate the guard causes **no
count regressions**.

The discriminating metric is the gap count. That is the artifact the guard was
introduced to remove, and it is strictly better with the guard on.

**Unguided acoustic count accuracy is 0.656** (164/250), error distribution
`{-3: 2, -2: 11, -1: 43, 0: 164, +1: 26, +2: 4}`. This is the raw Praat acoustic
detector with no target count. The guard does not affect this path at all:
`alignment_count` is `None` when `allow_expected_adjustment=False`, so
`split_oversized_syllables` returns early in both the old and new code. This
number is a pre-existing property of the acoustic detector, unchanged by this
release, and is materially worse than the 0.952 recorded in
`kokoro-250-gate-report.json` — that gate used the CTC phoneme recognizer plus
IndependentSyllabifier, a different and stronger path, not this acoustic one.

## 4. `industrial` regression case

Re-analyzed with the shipped code:

```text
0.695 - 0.955  (0.260s)
0.955 - 1.030  (0.075s)
1.030 - 1.165  (0.135s)
1.165 - 1.785  (0.620s)
internal gaps: [0.0, 0.0, 0.0]
```

The 160 ms artificial gap is gone. The known remaining limitation is unchanged
and still open: the final span is 620 ms against a hand-labelled `tri`+`al` of
473 ms, overshooting by roughly 69 ms at the front (absorbing `/s/` frication)
and 78 ms at the back (trailing silence). Because duration carries
`STRESS_WEIGHT_DURATION = 0.60`, that overshoot biases the stress score for the
final syllable. It is a separate defect from the gap and is not addressed here.

## 5. Kokoro generation note

Live Kokoro re-generation was not possible in this environment: the `kokoro`
package fails to build on Python 3.14 (`misaki` has no 3.14 wheels), and no
kokoro-fastapi server was running on `localhost:8880`. The Kokoro-82M weights
are cached locally (312 MB), so generation would work on a 3.11/3.12
interpreter. The 250 WAV files used here are genuine prior Kokoro output, which
is what the analysis pass requires; regenerating identical audio would not
change the measurement.

## 6. Verdict

The guard is safe to ship: zero count regressions across 250 files, two files
strictly improved, and no effect on the unguided path. It does not improve
pronunciation accuracy in general — it removes a specific segmentation artifact.
