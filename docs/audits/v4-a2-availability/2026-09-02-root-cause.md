# Phoneme Recognizer Availability Root-Cause Audit (V4-A2-AVAIL-01)

- **Date:** 2026-09-02
- **Author:** Antigravity (Advanced Agentic Assistant)
- **Live Revision Evaluated:** `phoneme-recognizer-00016-lum`
- **Associated Task:** Task 3 (`V4-A2-AVAIL-01`)
- **Baseline Evidence:**
  - `test-results/v4-a2-availability/20260901-test-window/baseline-peak.json` (SHA-256 verified)
  - `test-results/v4-a2-availability/20260902-baseline/baseline.json` (SHA-256 verified)

---

## 1. Empirical Evidence Summary

From the immutable read-only baseline collected over the 2026-09-01 06:00:00Z – 12:00:00Z test window:
- **Total Requests:** 13
- **Outcomes:** 10 OK (200), 3 BUSY (503), 0 Client Errors (4xx), 0 Server Errors (5xx)
- **Latency Distribution:**
  - p50: 683.33 ms
  - p95: 1170.95 ms
  - max: 5824.50 ms
- **Readiness Probes (`/readyz`):** 48 total, 0 non-200 (100% healthy, 3–4 ms response times)
- **Instance Lifecycle:** 0 restarts or crashes during active serving.

---

## 2. Root Cause Classification

### Primary Classification: `LEGITIMATE_CONTENTION`

**Mechanism:**
1. The application container enforces a strict single-inference invariant using Python `threading.Semaphore(1)` to protect memory and CPU contention during wav2vec2/CTC inference.
2. In Cloud Run, when `--concurrency` is omitted, the default concurrency value (80) allows Cloud Run to pack concurrent inbound HTTP connections onto a single container instance.
3. When test executions dispatched 2 or more concurrent requests, Cloud Run routed them to the same container instance.
4. The first request acquired the Python semaphore and began inference (~680ms).
5. The concurrent request immediately hit `semaphore.acquire(blocking=False)`, returning 503 `RECOGNIZER_BUSY` without queuing at the platform layer and without triggering Cloud Run autoscaling to the second configured instance (`maxScale: 2`).

---

## 3. Rejected Explanations

| Hypothesis | Verdict | Evidence / Rationale |
|---|---|---|
| `STUCK_INFERENCE` | **Rejected** | All 10 successful inferences completed in 683ms–5824ms and cleanly released the semaphore. No active request lingered beyond endpoint deadlines. |
| `COLD_START_MISCLASSIFICATION` | **Rejected** | Eager loading with `/readyz` startup gating ensured weights were resident before traffic arrived. All 48 `/readyz` probes returned 200 OK. |
| `UPSTREAM_RETRY_STORM` | **Rejected** | Volume was low (13 total requests across 6 hours). Upstream callers respected bounded retries. |
| `INSUFFICIENT_EVIDENCE` | **Rejected** | Complete log correlation across requests, readyz, scheduler, and instance events succeeded with 0 query errors. |

---

## 4. Remediation Decision

### Minimal Candidate Remediation: Cloud Run `containerConcurrency: 1`

1. **Declarative Configuration:** Add `"concurrency": 1` to `phoneme-recognizer` in `scripts/release/pronunciation-v3.production.json`.
2. **Release Entrypoint:** Update `scripts/release/pronunciation-v3.ps1` to pass `--concurrency=$($svc.concurrency)` during Cloud Run deployments.
3. **Behavioral Effect:**
   - Cloud Run load balancer will hold at most 1 concurrent request per container.
   - If a second request arrives during an active inference, Cloud Run immediately scales up the 2nd instance (up to `maxScale: 2`) or queues the request at the platform ingress until the active container finishes, eliminating false 503 `RECOGNIZER_BUSY` responses.
4. **Invariant Preservation:**
   - Private IAM is preserved (`access: "private"`).
   - Max instances capped at 2 (`maxScale: 2`).
   - Min instances remains 0 (`minScale: null`, preserving $0 idle cost).
   - Single-logit inference and model manifest validations remain unchanged.
