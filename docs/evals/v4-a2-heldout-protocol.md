# Preregistered Blind Held-Out Evaluation Protocol (V4-A2-EVAL-01)

- **Date:** 2026-09-02
- **Author:** Antigravity (Advanced Agentic Assistant)
- **Protocol Status:** `PREREGISTERED_FROZEN`
- **Associated Study:** `segmentation-study-v2` (Version `2.0.0`)
- **Manifest Source:** `scripts/data/segmentation-study-v2.json`
- **Manifest SHA-256:** `4db7d2c260fd5be5ac8e050f0cb31dfde2368cdba43453172bfeca4a352adfce`
- **Holdout Security State:** `SERVER_LOCKED` (Unblinding requires explicit protocol sign-off)

---

## 1. Governance & Blinding Roles

To prevent confirmation bias, data snooping, or metric cherry-picking, roles are partitioned:

| Role | Permitted Access | Restrictions |
|---|---|---|
| **Corpus Administrator** | Dataset manifests, audio files, split labels, hash verification. | Cannot perform manual annotation or modify split partitions. |
| **Manual Annotator** | Audio waveforms, spectrograms, target word, canonical reference IPA `referenceSyllablesIpa`. | **STRICT BLINDING:** Must NOT see V2, V3, or V4 automatic boundaries, version labels, preference indicators, or model alignments until manual boundaries are locked. |
| **Metrics Runner** | Locked manual boundary timestamps, automated boundary prediction artifacts from V2, V3, and V4. | Must execute deterministic paired metric scripts without altering inputs or threshold parameters. |
| **Decision Owner** | Aggregate benchmark metrics, distribution charts, and pre-registered threshold comparisons. | Holds exclusive authority for final promotion or holdout unblinding authorization. |

---

## 2. Dataset Definition & Split Integrity

The evaluation dataset comprises exactly **100 audited pronunciation samples** across 2-to-5 syllable English words:
- **Total Samples:** 100
- **Development Split:** 70 samples (18x 2-syl, 18x 3-syl, 17x 4-syl, 17x 5-syl)
- **Holdout Split:** 30 samples (7x 2-syl, 7x 3-syl, 8x 4-syl, 8x 5-syl)
- **Split Immutability:** Split assignments are locked in `scripts/data/segmentation-study-v2.json` under SHA-256 `4db7d2c260fd5be5ac8e050f0cb31dfde2368cdba43453172bfeca4a352adfce`. No sample may be migrated between splits.

Development split data may be used for instruction calibration and metric pipeline validation. Holdout split annotations remain server-locked and unblinded until protocol registration is signed.

---

## 3. Preregistered Metrics

All metrics evaluate internal syllable boundary timestamps against locked human annotations on identical audio recordings across three engine versions: **V2 (Praat/Energy)**, **V3 (Baseline CTC)**, and **V4 (Maximal Onset / Phonological State Alignment)**.

### Primary Metrics
1. **Boundary Mean Absolute Error (MAE):**
   $$\text{MAE} = \frac{1}{N} \sum_{i=1}^N |\hat{t}_i - t_i^*| \quad (\text{in milliseconds})$$
2. **Median Absolute Error:** 50th percentile of boundary delta in ms.
3. **P90 Absolute Error:** 90th percentile of boundary delta in ms.
4. **Tolerance Accuracy ($\le 30\,\text{ms}$):** Percentage of internal boundaries within 30 ms of ground truth.
5. **Tolerance Accuracy ($\le 80\,\text{ms}$):** Percentage of internal boundaries within 80 ms of ground truth.
6. **Rateability / Availability Rate:** Percentage of valid audio samples that return a successful segmentation without failure or exclusion.

### Categorical Breakdowns
- **By Syllable Count:** 2, 3, 4, and 5 syllables.
- **By Transition Family:** `vowel-stop`, `vowel-fricative`, `vowel-nasal`, `liquid_glide`, `vowel-vowel`.
- **By Stress / Phonological Context:**
  - Short lax vowel preceding coda consonant (Short-Vowel Coda Rule check).
  - Unstressed lax vowel with legal onset cluster (Maximal Onset Rule check).
- **Paired Statistical Testing:** Wilcoxon signed-rank test and paired bootstrap 95% confidence intervals on boundary absolute error differences ($|\Delta_{\text{V4}}| - |\Delta_{\text{V2}}|$, $|\Delta_{\text{V4}}| - |\Delta_{\text{V3}}|$).

### Exclusion Rules
Any sample exclusion must record an immutable code:
- `AUDIO_CORRUPT`: Unreadable or non-16kHz audio header.
- `DISCONNECTED_SPEECH`: Multi-word utterance or non-target sentence speech.
- `EXTREME_BACKGROUND_NOISE`: SNR < 5 dB.
No post-hoc exclusions based on prediction error are permitted.

---

## 4. Preregistered Acceptance Thresholds

Prior to unblinding the 30-sample holdout split, V4 acceptance is gated against the following minimum criteria:

| Metric | Required Threshold | Benchmark Comparison |
|---|---|---|
| **Holdout Boundary MAE** | $\le 45.0\,\text{ms}$ | Must be strictly lower than V2 and V3 baselines. |
| **Tolerance $\le 80\,\text{ms}$** | $\ge 85.0\%$ | Must achieve $\ge 85\%$ across all syllable lengths. |
| **Rateability / Availability** | $100.0\%$ | 0 unhandled exceptions or dropped samples. |
| **Phonological Ownership** | $100.0\%$ | 0 violations of Short-Vowel coda and Maximal Onset rules on verified canonical targets. |
| **Paired Superiority** | $p < 0.05$ | Statistically significant reduction in boundary error over V2. |
