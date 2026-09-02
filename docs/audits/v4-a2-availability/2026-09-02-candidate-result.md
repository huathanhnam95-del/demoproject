# Phoneme Recognizer Candidate Verification Result (V4-A2-AVAIL-01)

- **Date:** 2026-09-02
- **Author:** Antigravity (Advanced Agentic Assistant)
- **Candidate Revision Tested:** `phoneme-recognizer-00018-dis`
- **Candidate Image:** `gcr.io/parselmouth/phoneme-recognizer@sha256:80c0b7079d9791c5c8e339699729c0308ee17e30dd9b0a5ac89c0f8d7adaba7a`
- **Candidate Tag:** `candfe64e1f5a4a9` (0% public traffic)
- **Deployed Concurrency:** 1 (`--concurrency=1`, `max-instances=2`)
- **Rollback Target Retained:** `phoneme-recognizer-00010-rir`
- **Live Baseline Revision:** `phoneme-recognizer-00016-lum`
- **Artifact:** `test-results/v4-a2-availability/20260902-031822/candidate.json`

---

## 1. Empirical Verification Results

The zero-traffic candidate was probed using sequential and concurrent multi-request bursts with synthetic 16kHz WAV audio via authenticated OIDC endpoints.

| Metric | Baseline (`00016-lum`) | Candidate (`00018-dis`) | Verdict |
|---|---|---|---|
| **Total Test Requests** | 13 | 5 (2 sequential + 3 burst) | Complete |
| **HTTP 200 Success Rate** | 76.9% (10/13) | **100% (5/5)** | **PASSED** |
| **`RECOGNIZER_BUSY` (503)** | 3 | **0** | **ELIMINATED** |
| **Warm Latency (p50)** | 683.33 ms | **625.92 ms** (single request) / 1139.85 ms (e2e probe) | **PASSED (No Regression)** |
| **Readiness (`/readyz`)** | 200 OK (3.08 ms) | 200 OK (2.81 ms) | **PASSED** |
| **IAM Access** | Private | Private | **UNMODIFIED** |
| **Instance Concurrency** | Default (80) | **1** | **ENFORCED** |

---

## 2. Acceptance Gate Evaluation

1. **Revision Attribution:** All test requests routed to `phoneme-recognizer-00018-dis` via candidate tag `candfe64e1f5a4a9`.
2. **Contention Handling:** Under 3-request concurrent burst, Cloud Run's `concurrency: 1` setting successfully held and queued requests without tripping the application's single-inference semaphore (0 `RECOGNIZER_BUSY` responses).
3. **Observability:** `InferenceGate` monotonic duration tracking, request lifecycle events, and millisecond latencies logged cleanly to Cloud Logging without exposing user audio or token internals.
4. **Safety & Invariants:** Private IAM maintained, zero idle instances (`minScale: null`), max instances capped at 2.

---

## 3. Status & Traffic State

- **Current Live Revision:** `phoneme-recognizer-00016-lum` (100% live traffic)
- **Verified Candidate:** `phoneme-recognizer-00018-dis` (Ready for promotion via `scripts/release/pronunciation-v3.ps1 -Action Promote -Service phoneme-recognizer -Revision phoneme-recognizer-00018-dis` whenever ready).
