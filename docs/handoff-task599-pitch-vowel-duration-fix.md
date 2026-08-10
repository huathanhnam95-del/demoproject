# Task 599: Fix Disconnected Pitch Line & Vowel Duration Truncation

**Date:** 2026-08-10
**Branch:** `codex/speech-coach-navigation-cleanup`
**Status:** Done — awaiting live verification after server restart

---

## Problem 1: Disconnected pitch line in Prosody Comparison chart

**Symptom:** The learner's pitch line in the "Your recording compared with the native pattern" chart appeared broken and fragmented, with visible gaps throughout the contour.

**Root cause:** All four Chart.js scatter datasets in `stress-visualizer.js` used `spanGaps: false`. During unvoiced consonants (/f/, /t/, /ɡ/ in "photograph"), the Praat pitch tracker returns `null` because there is no fundamental frequency to detect. Chart.js breaks the line at every `null` value, creating visual gaps. The native reference line appeared smoother only because professionally recorded audio has fewer tracking dropouts.

**Fix:** Changed `spanGaps: false` → `spanGaps: true` in all four dataset definitions. Since pitch data is already trimmed to the voiced speech window (±0.1s padding), the unvoiced gaps within a single word are short (30–80ms for consonants), and a straight connecting line is visually appropriate.

**Files changed:**
- `public/pronunciation-analyzer/stress-visualizer.js` — lines 234, 612, 623, 844

---

## Problem 2: Vowel /foʊ/ duration truncated in Syllable Verification

**Symptom:** The first syllable /foʊ/ in "photograph" showed only 0.08s duration in the syllable verifier, despite the waveform clearly showing more energy. Manual segmentation confirmed the syllable should be ~0.18s. The waveform region was too narrow.

**Root cause (three layers):**

### Layer 1 — Backend: measurement boundaries never computed

The CTC forced aligner produces narrow "token coverage" spans — only the frames where the model activates a target-state token. Blank frames between syllables are unassigned. For "photograph":

| Syllable | Raw CTC span | Gap to next |
|----------|-------------|-------------|
| /foʊ/    | 0.888–0.969 (0.08s) | 0.20s gap |
| /tə/     | 1.171–1.353 (0.18s) | 0.04s gap |
| /ɡræf/   | 1.393–1.696 (0.30s) | — |

The backend's `stress_alignment._derive_measurement_spans()` splits these gaps at the midpoint and produces wider `measurement_start_time`/`measurement_end_time` fields. However, the phoneme service running on Cloud Run uses a deployment that does not return these fields. The local server's `public_syllable_span()` only passes measurement fields through when they exist — it does not compute them itself.

### Layer 2 — Backend serialization: no fallback computation

`_build_v3_active_response()` serialized whatever the recognizer returned without checking for missing measurement boundaries. When the recognizer omitted them, the API response contained only the narrow raw boundaries.

### Layer 3 — Frontend: never read measurement fields

Even if measurement boundaries had been present, the frontend would have ignored them:
- `normalizeSpan()` in `version-comparison.js` read only `startTime`/`endTime`
- `normalizeChartSpans()` in `chart-data.js` read only `startTime`/`endTime`
- Both passed the narrow raw boundaries to the syllable verifier's waveform regions

**Fix (all three layers):**

| File | Change |
|------|--------|
| `backend/local_server/server.py` | Added `_ensure_measurement_boundaries()` — when spans lack measurement fields, computes them by splitting inter-syllable gaps at the midpoint. Runs before `public_syllable_span()` serialization. |
| `public/pronunciation-analyzer/version-comparison.js` | `normalizeSpan()` now prefers `measurementStartTime` over `startTime`. Recomputes `duration` when boundaries are widened. Preserves V2's analyzer-owned `duration` (no measurement fields on V2 spans). |
| `public/pronunciation-analyzer/chart-data.js` | `normalizeChartSpans()` now prefers `measurementStartTime` over `startTime`. Recomputes `duration` when boundaries differ from raw values. |

**Result for "photograph" sample after fix:**

| Syllable | Before | After |
|----------|--------|-------|
| /foʊ/    | 0.08s  | 0.18s |
| /tə/     | 0.18s  | 0.30s |
| /ɡræf/   | 0.30s  | 0.32s |

---

## Edge case caught during audit

The initial frontend fix widened `startTime`/`endTime` to measurement values but left the `duration` field untouched (still reflecting the narrow raw interval). This caused the syllable verifier's duration label (read from `syl.duration`) to disagree with the visible waveform region width (computed from `syl.startTime`/`syl.endTime`). Fixed by recomputing `duration` whenever boundaries are widened.

---

## Files changed (complete list)

| File | What changed |
|------|-------------|
| `public/pronunciation-analyzer/stress-visualizer.js` | `spanGaps: false` → `true` (4 instances) |
| `public/pronunciation-analyzer/chart-data.js` | `normalizeChartSpans()` prefers measurement boundaries |
| `public/pronunciation-analyzer/version-comparison.js` | `normalizeSpan()` prefers measurement boundaries |
| `backend/local_server/server.py` | `_ensure_measurement_boundaries()` computes gap-split display boundaries when recognizer omits them |

## Tests

- `tests/pronunciation-analyzer/chart-data.test.mjs` — pass
- `tests/pronunciation-analyzer/version-comparison.test.mjs` — 11/11 pass
- `tests/pronunciation-analyzer/version-comparison-ui-contract.test.mjs` — pass
- `backend/test_pronunciation_verifier.py` — 23/23 pass
- No JS parse/runtime errors in browser

## Verification needed

Restart the local Python server and record "photograph" to confirm:
1. Pitch contour is a continuous line (no gaps at consonants)
2. First syllable /foʊ/ region in the syllable verifier covers ~0.18s, not 0.08s
3. Duration label matches the visible region width
