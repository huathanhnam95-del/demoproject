# Task 608: V3 Vowel Cutoff Fix — Plan

**Date:** 2026-08-10 (updated 2026-08-11)
**Status:** In Progress — Phase 1+3C implemented, pending server restart and live evaluation
**Tracker:** TASK_TRACKER.csv row 608
**Related:** Task 599 handoff (`docs/handoff-task599-pitch-vowel-duration-fix.md`)

---

## Problem

The V3 forced-alignment model returns truncated boundaries for syllables with diphthongs. For "photograph" /ˈfoʊ.tə.ɡræf/:

| Syllable | V3 raw boundary | V2 acoustic boundary |
|----------|----------------|---------------------|
| /foʊ/    | 0.10s          | 0.31s               |
| /tə/     | 0.18s          | —                   |
| /ɡræf/   | 0.26s          | —                   |

The 0.10s boundary for /foʊ/ is perceptually wrong — the diphthong /oʊ/ is clearly longer in the waveform. V3 confidence for this sample is 65% (mean forced-alignment).

---

## Root Cause (3 layers)

### Layer 1 — CTC Token Coverage (model-inherent)
The CTC forced aligner's `startTime`/`endTime` cover only frames where the model activates a target-state token. Blank frames between syllables are unassigned. Diphthongs like /oʊ/ have acoustic energy extending into blank frames, so the raw CTC span is very narrow.

**Code:** `backend/local_server/server.py` → `_build_v3_active_response()` line 2502

### Layer 2 — Measurement Boundaries (backend fix exists, not deployed)
`_ensure_measurement_boundaries()` in `server.py:2531` was added in Task 599 to split inter-syllable blank gaps at the midpoint and produce wider `measurementStartTime`/`measurementEndTime`. For "photograph", this moves /foʊ/ from 0.08s → 0.18s.

**Status:** Code is in the repo but the Python server hasn't been restarted on production.

### Layer 3 — Frontend (already deployed)
`normalizeSpan()` in `version-comparison.js:34` and `normalizeChartSpans()` in `chart-data.js:273` already prefer `measurementStartTime` over `startTime`. These are JS files and are already live.

### Why "Legacy recognizer boundaries (convention unknown)"
The production phoneme recognizer uses the v1 contract shape (no `canonical_alignment.syllable_span_type`), so `segmentation_convention` is `None` in the V3 response. This triggers the "Legacy" label in `version-comparison.js:137`.

### Why 65% confidence
The confidence is the mean forced-alignment posterior across phonemes from `_recognizer_confidence()`. The low score correlates with the CTC model struggling to align the diphthong /oʊ/ transition. This is model-side and won't change with boundary fixes.

---

## Action Plan

### Phase 1: Deploy existing fix (IMMEDIATE)
**Action:** Restart the production Python backend to deploy the Task 599 fix.
**Expected result:** /foʊ/ boundary widens from 0.10s → ~0.18s via measurement boundaries.
**Files already changed (in repo, need server restart):**
- `backend/local_server/server.py` — `_ensure_measurement_boundaries()`
- `public/pronunciation-analyzer/version-comparison.js` — `normalizeSpan()` prefers measurement boundaries
- `public/pronunciation-analyzer/chart-data.js` — `normalizeChartSpans()` prefers measurement boundaries

### Phase 2: Evaluate after server restart
After the Python backend restarts, test "photograph" and other diphthong words:
- Does /foʊ/ duration look correct against the waveform?
- Does syllable playback sound right?
- Compare with V2's 0.31s — is V3 still noticeably short?

If acceptable, close this task. If still too short, the remaining options below can be explored.

### Phase 3: Intensity-envelope widening — IMPLEMENTED (Option C)

Added `_widen_by_intensity_envelope()` in `server.py` (after `_ensure_measurement_boundaries()`).

**How it works:**
1. After midpoint-split measurement boundaries are computed, scan the Praat intensity contour forward from each syllable's measurement end
2. Extend the measurement end boundary while intensity stays above 45% of the syllable's peak
3. Cap at the next syllable's raw CTC start (never overlap into token-active frames)
4. After all extensions, resolve any remaining overlaps by re-splitting at the midpoint

**Simulated results for "photograph":**

| Syllable | Raw CTC | After midpoint split | After intensity widening |
|----------|---------|---------------------|------------------------|
| /foʊ/    | 0.08s   | 0.18s               | **0.23s**              |
| /tə/     | 0.18s   | 0.30s               | 0.26s                  |
| /ɡræf/   | 0.30s   | 0.32s               | 0.32s                  |

The intensity widening extends /foʊ/ by ~45ms where the diphthong's acoustic energy continues past the gap midpoint. The overlap resolution ensures no adjacent boundaries cross.

**Tests:** 23/23 backend tests pass; all frontend tests pass.

### Remaining options (if further tuning needed)

| Option | Approach | Trade-off |
|--------|----------|-----------|
| **A. Nucleus-aware widening** | Use IPA reference to identify diphthong syllables; apply a phonetic duration floor | Most accurate; requires phoneme-type classification; complex |
| **B. V2 boundary fallback** | When V3 confidence < 70% and boundary < 50% of V2, prefer V2 | Simple; couples V3 to V2; V2 has its own inaccuracies |
| **D. Backend recognizer fix** | Update Cloud Run recognizer to return measurement boundaries natively | Cleanest long-term fix; requires model service deployment |
| **Tune drop_ratio** | Current `drop_ratio=0.45` (45% of peak). Lower values extend further but risk bleeding into consonant onsets. Can be tuned per-word or per-phoneme-type. | Simple knob; risk of over-extension |

---

## Key Files Reference

| File | Role |
|------|------|
| `backend/local_server/server.py:2502` | `_build_v3_active_response()` — builds V3 response from recognizer + Praat |
| `backend/local_server/server.py:2531` | `_ensure_measurement_boundaries()` — gap-split boundary widening |
| `backend/local_server/server.py:2560` | `_widen_by_intensity_envelope()` — intensity-based boundary extension (NEW) |
| `backend/local_server/server.py:2620` | `public_syllable_span()` — serializes spans with measurement fields |
| `backend/local_server/server.py:3349` | `/analyze/compare` route — comparison endpoint |
| `backend/phoneme_service/stress_alignment.py:56` | `_derive_measurement_spans()` — original nucleus-aware widening |
| `public/pronunciation-analyzer/version-comparison.js:34` | `normalizeSpan()` — prefers measurement boundaries |
| `public/pronunciation-analyzer/chart-data.js:273` | `normalizeChartSpans()` — prefers measurement boundaries |
| `public/pronunciation-analyzer/analysis-pipeline.js:107` | `repairPraatSyllableBoundaries()` — boundary repair (narrows only) |
| `public/pronunciation-analyzer/analysis-pipeline.js:222` | `collapseTrailingConsonantTail()` — trailing tail merge |

---

## Companion Fix (Task 607 — Done)

Added cloud debug save button for production (`app.js:312-435`). Authenticated admins on production can now save recordings + analysis to cloud via `/api/admin/dev/save-corpus-sample` for debugging. Uses `speakerCohort: 'l1-vn-debug'`, `needsManualReview: true`.
