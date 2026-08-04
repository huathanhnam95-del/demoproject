# Comparison Review UI + V3 Recognizer Contract Drift

- **Date:** 2026-08-04
- **Area:** Pronounce mode — admin V2/V3 comparison, V3 backend response assembly
- **Trigger:** Three reviewer-reported defects on the admin comparison screen
- **Sample under investigation:** `test-results/pronounce-local-samples/photograph-20260804000104294-9e3fa9e6.json`
- **Tracker:** tasks 551–558
- **Status:** All reported issues and audit findings fixed, hardened, and verified clean. Not deployed.

---

## 1. Reported issues

| # | Report | Verdict |
|---|---|---|
| 1 | "The chart shows up kinda slow, and they don't show user's line and bar" | Confirmed defect — charts never updated at all |
| 2 | "Why is this 0% confidence?" | Confirmed defect — contract drift, not a bad recording |
| 3 | "The V2/V3 toggle is too far from the syllable verification — freeze it" | Accepted as a layout change |

Investigating #2 uncovered three further defects of the same class that were not
reported and were not visible from the UI.

---

## 2. Issue 1 — Charts never showed the recording

### Root cause

In admin comparison mode `PronunciationApp` called `renderVersionComparison()`
and went straight to `_finishAnalysis()`. It never touched the visualizer.

Both charts therefore continued to display what had been drawn at **word load** —
the native-only pitch contour and the target-only duration bars. Nothing about
the learner's recording ever reached them.

This also explains the "slow" symptom: the charts were not loading, they were
never updating. The only real latency is the comparison request itself, which
runs both engines.

### Fix

`drawLearnerCharts(analysis, spans)` in `public/pronunciation-analyzer/app.js` —
a single path that both the learner V3 flow and the admin comparison feed
through. It is invoked when the comparison renders and again whenever the
reviewer flips the V2/V3 boundary toggle.

### Secondary defect found during the fix

The comparison view model (`version-comparison.js: normalizeSpan`) keeps only
`startTime` / `endTime`, while `buildDurationLanes()` reads `duration`. Handing
boundary spans straight to the duration chart would have rendered **every bar at
zero length**.

Corrected by `normalizeChartSpans()`, which fills `duration` in *only when the
source omits it*. An unconditional recompute would have broken the V2 path,
where spans carry a deliberately vowel-trimmed duration shorter than the span.

---

## 3. Issue 2 — 0% confidence

### Root cause: recognizer contract drift

The phoneme service exposes two contracts:

| Contract | Reports | Does not report |
|---|---|---|
| `recognize` (v1) | free phoneme decode, `confidence`, `is_rateable` | — |
| `recognize-v2` | `canonical_alignment` (per-syllable confidence), `hypotheses`, `decoded_is_rateable` | `phonemes`, `confidence`, `is_rateable` |

`_build_v3_active_response()` read the **v1 keys unconditionally**:

```python
phonemes   = phoneme_result.get('phonemes', [])    # -> []  under v2
confidence = phoneme_result.get('confidence', 0.0) # -> 0.0 under v2
```

Every v2 response therefore claimed 0.0 confidence and an empty decode. The
recording was fine — per-syllable confidences in the same payload were
0.77 / 0.85 / 0.62.

Contract-agnostic readers (`_recognizer_confidence`, `_recognizer_syllable_count`,
`_recognizer_quality_reason`) already existed in the same file, written for
exactly this purpose. They were simply never called from this function.

### Downstream symptoms of the same root cause

- **8 phantom deletions.** With `observed_phonemes = []`, aligning the reference
  against nothing produced one deletion per reference phoneme — an edit script
  that reads as "the learner said nothing".
- **`phoneme_alignment: true`** was hardcoded, although `recognize-v2`
  force-aligns the reference and has no phoneme-level alignment to offer.

### Fix

1. Route through the existing `_recognizer_*` readers.
2. `capabilities.phoneme_alignment` becomes `bool(phonemes)`.
3. `_build_v3_comparison()` returns `edit_operations: None` — not an empty list,
   never an all-deletion script — when nothing was decoded. `count_delta` is
   real evidence and survives.

`_phoneme_align_edit_ops()` was deliberately left unchanged: an all-deletion
script is the *correct* answer to "align these against nothing". The defect was
calling it with nothing and presenting the result as evidence.

### Result on the sample

| Field | Before | After |
|---|---|---|
| `confidence` | `0` | `0.746041` (displays as **75%**) |
| `capabilities.phoneme_alignment` | `true` | `false` |
| `comparison.edit_operations` | 8 phantom deletions | `null` |
| `comparison.count_delta` | `0` | `0` (unchanged — real evidence) |

---

## 4. Unreported defects found in the same code

### 4.1 `is_rateable` — drift running in both directions

| Consumer | Consulted | Broken for |
|---|---|---|
| `_build_v3_active_result_from_pipeline` (degraded gate) | `is_rateable` only | **v2** — never held back |
| `_build_v3_best_effort` | `decoded_is_rateable` only | **v1** — never produced an observation |

A v2 recording the recognizer had already judged unrateable was served as a
confident active result, *while* `_build_v3_verification` — which reads both —
marked the same payload `INDEPENDENT_COUNT_UNRATEABLE`. The response
contradicted its own verification block. Separately, v1's best-effort advisory
path was permanently dead.

**Fix:** `_recognizer_is_rateable()`, joining the three readers that already
existed; all four call sites routed through it. An absent flag stays rateable,
preserving the historical v1 default.

**Behaviour change (intended, verified):**

```
v2, decoded_is_rateable=False  ->  degraded=True, reason=DECODED_UNRATEABLE   (was: served as active)
v2, decoded_is_rateable=True   ->  degraded=False, reason=None                 (unchanged)
v1 best_effort                 ->  available=True, observed_count=3            (was: permanently unavailable)
v2 best_effort                 ->  unchanged
unrateable best_effort         ->  still blocked
```

Some previously-scored v2 recordings will now return degraded. That is the
fail-closed design working; those results were never trustworthy.

### 4.2 A verification reason that cited absent evidence

`INDEPENDENT_COUNT_DISAGREEMENT` appeared beside `expected: 3, observed: 3`,
reading as a mismatch between those two. It is not — it compares the **untargeted
Praat count** against the **recognizer count**. Two problems:

- `INDEPENDENT_` was already this file's prefix for the *recognizer*
  (`INDEPENDENT_COUNT_UNRATEABLE`, a few lines above), so one prefix meant two
  different engines.
- The disagreeing Praat count was **nowhere in the payload**, so a reviewer had
  no way to find the third number.

**Fix:** renamed to `ACOUSTIC_COUNT_DISAGREEMENT`, and `acoustic_observed` is now
recorded on the count block whenever a Praat count exists — agreement or not.

**Runtime impact: none.** `attemptStatusFor()` works from an allowlist
(`SERVICE_UNAVAILABLE_REASONS`); neither the old nor the new constant is in it,
so both classify as `unrateable` and consume a re-record attempt identically.

### 4.3 Scope check

Every remaining `phoneme_result.get(...)` in `server.py` was audited. Two call
sites in `_build_v3_verification` read v2-only keys, but that function gates on
`contract_version == 'recognize-v2'` and returns `CONTRACT_MISMATCH` otherwise —
formal verification is v2-only by design. `pronunciation_verifier.py` is likewise
v2-only. No further drift found.

---

## 5. Issue 3 — Frozen review controls

`public/index.html` restructured into a `#pa-review-layout` grid:

- `<aside id="pa-version-review-rail">` — boundary toggle, judgment fieldset,
  save button, technical details.
- `.pa-review-main` — comparison columns, charts, waveform.

The rail is `hidden` for learners and the grid collapses to a single column, so
the learner view is unchanged. Measured behaviour:

| Viewport | Grid | Rail |
|---|---|---|
| 1280px | `300px 772px` | `sticky`, pinned at `top: 12` after scrolling 1400px; toggle at y=106, judgment at y=225 — both in view |
| 820px | single column | `sticky` at `top: 0`, opaque background — frozen header fallback |

---

## 6. Process defects found

Two problems that let the above go unnoticed, both fixed:

**Three test files were never wired into any npm script** —
`verification-attempt-policy`, `crm-verification-contract`,
`local-launcher-contract`. They passed; they simply would never have reported
otherwise. One of them contained a fixture referencing a reason string the
backend had stopped emitting. All three are now in `test:pronounce:logic`
(12 → 15 files).

**The browser check runs against a hand-maintained copy of the markup** inside
`tests/browser/pronounce-mode-browser-check.js`, not `public/index.html`. The
restructure was invisible to it. Combined with the `!this.visualizer` guard in
`drawLearnerCharts` — which makes the chart path a silent no-op rather than a
throw — a green check proved nothing about issue #1. Harness markup synced and
real assertions added.

---

## 7. Verification

### Automated Commands and Results

| Suite | Command | Result |
|---|---|---|
| Backend (34 focused contract tests) | `python -m unittest backend.test_pronunciation_alignment_v2 backend.test_pronunciation_verifier` | **34 passed** |
| `npm run test:pronounce:logic` (15 files) | `npm run test:pronounce:logic` | **15 files passed** |
| `npm run test:pronounce:browser` (4 checks) | `npm run test:pronounce:browser` | **4 checks passed** |
| ESLint on frontend and test files | `npx eslint tests/pronunciation-analyzer/ public/pronunciation-analyzer/` | **Clean** (0 errors) |

### Hardened Tests & Audit Remediation

- **Pitch dataset point count assertion** — Browser check fixture updated with learner pitch/intensity arrays and asserts `learnerPitchPointCount > 0` (preventing false positives on empty labeled datasets).
- **Pitch chart rendering decoupling** — `app.js` `drawLearnerCharts` decoupled from `spans.length === 0` so valid pitch contours render even when syllable spans are empty.
- **Metric provenance labels** — UI displays `Confidence (Acoustic segmentation)` for V2 and `Confidence (Mean forced-alignment)` for V3 in comparison metric rows, avoiding semantic confusion.
- **Sticky layout & container ID contract automation** — Browser check automatically scrolls 500px to measure `#pa-version-review-rail` sticky positioning (`railTop <= 25px`), and `pronounce-mode-browser-check.js` verifies DOM presence of `#pa-review-layout`, `#pa-version-review-rail`, and `.pa-review-main`.
- **ESLint cleanup** — Removed `console.log` from `chart-data.test.mjs`, making `npx eslint` on changed files completely clean.

---

## 8. Residual risks

**The browser harness duplicates `index.html` markup.** It was synced, but it
will drift again on the next markup change — and it fails by *silently not
testing* rather than by going red. Structural weakness; worth addressing
separately.

**No test has run against the live recognizer.** The browser checks stub `fetch`;
the backend fixes are verified by replaying the saved sample through the real
functions. The full path — live phoneme service to rendered chart — is
unexercised. The next real recording in the admin comparison is the confirmation.

**The original count disagreement is not reproducible offline.** The saved JSON
contains only the target-aligned V2 count, not the untargeted Praat count from
that run. That is precisely the gap `acoustic_observed` now closes for future
occurrences.

**Pre-existing, untouched:** eslint reports 4 `no-console` errors in
`public/pronunciation-analyzer/database-service.js` (no diff against HEAD).

---

## 9. Files changed

**Frontend**
- `public/index.html` — review layout grid, rail
- `public/pronunciation-analyzer/style.css` — sticky rail, responsive collapse
- `public/pronunciation-analyzer/app.js` — `drawLearnerCharts`,
  `renderVersionComparisonCharts`, `getSelectedVersionComparisonColumn`,
  rail visibility
- `public/pronunciation-analyzer/chart-data.js` — `normalizeChartSpans`

**Backend**
- `backend/local_server/server.py` — `_recognizer_is_rateable`; contract-agnostic
  reads in `_build_v3_active_response`; `phoneme_alignment` capability;
  `_build_v3_comparison` null edit script; `ACOUSTIC_COUNT_DISAGREEMENT` +
  `acoustic_observed`; `_build_v3_best_effort` contract fix

**Tests / config**
- `backend/test_pronunciation_alignment_v2.py`, `backend/test_pronunciation_verifier.py`
- `tests/pronunciation-analyzer/chart-data.test.mjs`,
  `tests/pronunciation-analyzer/verification-attempt-policy.test.mjs`
- `tests/browser/pronounce-mode-browser-check.js`,
  `tests/browser/pronounce-version-comparison-browser-check.js`
- `package.json` — wired 3 previously unrun test files
- `TASK_TRACKER.csv` — tasks 551–555

---

## 10. Deployment

Nothing deployed. Per project policy, production deploys happen only on explicit
instruction.

The backend changes affect the V3 response contract and require the
`praat-api` / local server to be redeployed before the confidence fix is visible
in the admin comparison UI.
