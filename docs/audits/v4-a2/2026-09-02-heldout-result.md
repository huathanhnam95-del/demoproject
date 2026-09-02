# Preregistered Held-Out Evaluation Verdict (V4-A2-EVAL-01)

- **Date:** 2026-09-02
- **Author:** Antigravity (Advanced Agentic Assistant)
- **Protocol SHA-256:** `81ca4da0add2912eaff09ce98433c3506c7e81adf58365f6b2ac924489405244`
- **Manifest SHA-256:** `4db7d2c260fd5be5ac8e050f0cb31dfde2368cdba43453172bfeca4a352adfce`
- **Study ID:** `segmentation-study-v2` (100 samples: 70 Development / 30 Holdout)
- **Evaluation Status:** `COMPLETED_VERIFIED`

---

## 1. Summary of Held-Out Evaluation (30 Unblinded Samples)

| Metric | V2 (Praat Baseline) | V3 (CTC Raw Midpoint) | V4.1 (Maximal Onset / Phonological) | Preregistered Threshold | Gate Verdict |
|---|---|---|---|---|---|
| **Boundary MAE (Holdout)** | 47.58 ms | 26.62 ms | **10.14 ms** | <= 45.0 ms | **PASSED** |
| **Tolerance <= 80 ms** | 90.91% | 100.0% | **100.0%** | >= 85.0% | **PASSED** |
| **Tolerance <= 30 ms** | 27.27% | 59.74% | **98.7%** | Descriptive | **+71.4% over V2** |
| **Median Absolute Error** | 49.0 ms | 26.0 ms | **9.0 ms** | Descriptive | **PASSED** |
| **Rateability / Availability** | 100.0% | 100.0% | **100.0%** | 100.0% | **PASSED** |
| **Phonological Violations** | N/A | High (coda clipping) | **0 violations** | 0 violations | **PASSED** |

---

## 2. Full Cohort Summary (100 Samples: 70 Dev + 30 Holdout)

| Version | Total Samples | Boundaries Evaluated | MAE (ms) | Median (ms) | P90 (ms) | <= 30 ms (%) | <= 80 ms (%) | Rateability |
|---|---|---|---|---|---|---|---|---|
| **V2 (Praat)** | 100 | 250 | 46.55 ms | 47.5 ms | 78.0 ms | 26.8% | 91.2% | 100.0% |
| **V3 (CTC)** | 100 | 250 | 25.82 ms | 25.0 ms | 46.0 ms | 63.6% | 100.0% | 100.0% |
| **V4.1 (Phonological)** | 100 | 250 | **12.09 ms** | **11.5 ms** | **24.0 ms** | **97.6%** | **100.0%** | **100.0%** |

---

## 3. Paired Statistical Testing (Holdout Split)

- **V4 vs V2 Mean Difference:** `-38.12 ms` (95% CI: `[-44.39, -31.57]`)
- **Wilcoxon Signed-Rank Test:** $W = 2.0$, $p = 0.0$ ($p < 0.001$, statistically significant improvement over V2).
- **V4 vs V3 Mean Difference:** `-15.98 ms` (95% CI: `[-20.29, -11.6]`)

---

## 4. Final Promotion Decision

**VERDICT: ACCEPT V4.1**
All 5 preregistered acceptance gates passed without exception:
1. Holdout boundary MAE achieved **10.14 ms** (well below the 45.0 ms threshold).
2. Tolerance within 80 ms reached **100.0%** (exceeding the 85.0% threshold).
3. 100% rateability across all 100 clean English speech samples.
4. 0 phonological ownership violations on Short-Vowel Coda and Maximal-Onset rules.
5. Paired bootstrap confidence interval and Wilcoxon test confirm significant improvement over baseline models.
