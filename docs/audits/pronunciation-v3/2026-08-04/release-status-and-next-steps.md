# V3 Pronunciation — Release Status and Next Steps

**Date:** 2026-08-04 (Vietnam Time)
**Release commit:** `18b65ed4` · follow-ups `45521852`, `65f675b0`
**Branch:** `codex/speaking-ui-review-repair` (not merged, not pushed)
**Status:** Core V3 backend fix is healthy in production; release sign-off remains blocked.

**Related:**
`docs/plans/2026-08-03-v3-production-issues-and-keepalive-plan.md` (current source of truth) ·
`docs/audits/pronunciation-v3/2026-08-03/v3-recognizer-unavailable-root-cause.md` (root cause) ·
`docs/audits/pronunciation-v3/2026-08-03/v3-production-issues-and-keepalive-review.md` (review)

---

## 1. What shipped

The V3 comparison reported *"model inference failed"* on the first request after
any idle period. The model never failed: `phoneme-recognizer` scales to zero and
took ~50 s to wake, while the caller gave up at 15 s and discarded the answer the
recognizer did produce.

| Change | Effect |
|---|---|
| Timeout budget widened at 6 layers, enumerated browser-inward | A cold start completes instead of failing |
| `requests.Timeout` → `TIMEOUT`, `ConnectionError` → `RECOGNIZER_UNREACHABLE` | Failures name the real cause instead of blaming the model |
| Eager model load + `/readyz` startup probe (was `tcpSocket`) | The ~50 s load runs during startup, not inside a learner's request |
| CPU-only torch wheels | Image 4,435.8 MiB → 2,000.7 MiB |
| `POST /warm/v3` + calls on Pronounce entry and word change | Cold load overlaps the learner's reading time (**committed, not deployed**) |
| Cloud Scheduler ping, every 10 min, 06:00–23:50 `Asia/Ho_Chi_Minh` | Intended best-effort warm instance retention during active hours |
| Local launcher: wall-clock readiness gate + loud V3-disabled banner | A misconfigured local session is obvious, not silent |

### Live production state

| Service | Revision | Digest |
|---|---|---|
| `praat-api` | `praat-api-00057-fiv` | `sha256:8d005aea…` |
| `phoneme-recognizer` | `phoneme-recognizer-00010-rir` | `sha256:dc1f139a…` |

Rollback targets: `praat-api-00040-gr4`, `phoneme-recognizer-00004-bbc`.

---

## 2. Verified

| Path | Before | After |
|---|---|---|
| First recording after idle | ✗ failed at 15 s | ✓ **HTTP 200 in 41.2 s**, `complete`, 3 syllables, `source: ctc` |
| Subsequent recordings | 1 s | ✓ **2.6–2.7 s** |
| During 06:00–23:59, instance held (best-effort) | — | ~3 s (partial post-promotion window: 10/10 matching, 0 failures, 0 unplanned starts, 3.08 ms median `/readyz`) |
| Recognizer down | `MODEL_INFERENCE_FAILED` | `RECOGNIZER_UNREACHABLE` |
| Minimum-instance idle charge | none | **none** |

**Browser E2E on production** (`tests/browser/pronounce-v3-production-e2e.js`) —
real Chrome, admin sign-in, fake microphone fed from the recorded `photograph`
sample, full record → analyse flow:

```
comparison status : complete
V2                : available
V3                : available
V3 source         : ctc
```

`tests/browser/pronounce-production-verify.js` also passes.

**Invariants confirmed after deploy:** `praat-api` public · `phoneme-recognizer`
private with only the compute SA as invoker · no `minScale` on either · traffic
pinned to one explicit revision each, no `latestRevision` · rollback targets
intact · rollback exercised in both directions on `praat-api`.

**Tests:** 20 ops (`npm run test:pronounce:ops`) · 43 pronunciation (`npm run test:pronounce:logic`, covering named release files, all passing) · 119 backend (`pytest backend/tests/test_recognizer_v3.py`) — all totals reproduced exactly.

---

## 3. Plan Issue Verdicts

| Plan Issue | Verdict |
|---|---|
| 1. Cold start exceeded timeout | Fixed in production |
| 2. Transport failures mislabeled | Code-fixed and unit-tested; no fresh production failure injection |
| 3. Traffic entered half-loaded recognizer | Fixed: live `/readyz` startup probe |
| 4. CUDA-heavy image | Fixed: 4,435.8 MiB → 2,000.7 MiB |
| 5. Traffic pinned incorrectly | Fixed currently; explicit revisions receive 100% |
| 6. PowerShell flag corruption | Guarded by release script and passing contract tests |
| 7. API timeout layers missed | Fixed: live API and recognizer timeouts are 120 seconds |
| 8. Local launcher silently disabled V3 | Code and contract test fixed; full local-stack run not repeated |
| 9. `/warm/v3` background thread | Open and not deployed to Hosting |

---

## 4. Fresh Production Verification

- **Revisions & Digests:** Exact revisions (`praat-api-00057-fiv`, `phoneme-recognizer-00010-rir`) and digests match the report.
- **Access Controls:** API is public; recognizer is private to the compute service account (`1071929245506-compute@developer.gserviceaccount.com`).
- **Feature Flags:** Shadow mode is active and learner V3 remains disabled.
- **Auth Guarding:** Admin and corpus endpoints return unauthenticated 401.
- **Chrome E2E:** Authenticated Chrome completed record → analyze with V2 and V3 available, three syllables, `source: ctc`.
- **Direct Warm Replay:** Returned HTTP 200 in 2.888 seconds.
- **Warm-up Telemetry:** `/warm/v3` calls observed in production: **zero**.
- **Rollback Readiness:** Both rollback revisions (`praat-api-00040-gr4`, `phoneme-recognizer-00004-bbc`) remain ready.
- **Git Status:** The branch remains absent from `origin`.

---

## 5. Open items

### Blocking a clean sign-off

| # | Item | Why it matters |
|---|---|---|
| 1 | **24 h keep-alive observation** | The keep-alive premise has never been measured over a full 24-hour window. The exact 24-hour verifier currently fails closed because the Scheduler and revision are younger than 24 hours (38 Scheduler finishes vs 11 matching `/readyz` rows). |
| 2 | **Hosting not deployed (R5)** | The committed frontend does not match live bytes. `/warm/v3` calls observed in production: **0**. |
| 3 | **Cost is arithmetic, not telemetry** | The ~1.7% free-tier figure was calculated, never measured. |
| 4 | **Release-control gaps (R3, R6, R10, SHA)** | Outstanding release controls prevent complete sign-off (missing R3 allowlist, unverified R6 candidate, incomplete R10 recognizer rollback rehearsal, and image-baked SHA not deployed). |

### Release-control gaps & smaller items

- **R3** — commit exists, but no `release-source-allowlist.txt` enumerating reviewed paths.
- **R6** — private candidate revisions cannot be smoke-tested; the CLI is a user
  account and cannot mint an audience-scoped ID token. Needs
  `roles/iam.serviceAccountTokenCreator` on `1071929245506-compute@…`.
- **R10** — rollback rehearsed on `praat-api` only, not `phoneme-recognizer`.
- **SHA baking not yet live** — `backend/Dockerfile` now bakes `ARG GIT_SHA` /
  `ENV BUILD_SHA`, but production's marker still comes from the service-level env
  var set by hand. Correct today; properly sourced from the next build.
- **`/warm/v3` unverified** — Cloud Run throttles CPU once a response is sent, so
  the background warm-up thread may be starved. It responds correctly; whether it
  finishes its work is unknown. The Scheduler ping makes it non-load-bearing.

### Not release-related

**97 uncommitted entries** (62 tracked changes and 35 untracked files) remain in the working tree from the earlier Speaking UI session — untouched by this work, but a large amount of unsaved change on one branch.

---

## 6. Next steps, in order

### Step 1 — Measure the keep-alive (do this first)

Run after a full day has elapsed:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-phoneme-keepalive.ps1 -Hours 24 -Revision phoneme-recognizer-00010-rir
```

Two possible outcomes, both useful:

- `evidenceComplete: True` with a low unplanned-start count — the keep-alive is
  working. Record the eviction rate and the max `/readyz` latency.
- Non-zero exit with `queryErrors` — the evidence cannot be trusted, and the
  reason is printed. Fix that before drawing any conclusion.

Do not build anything on the keep-alive until this returns. Note that a window
spanning a revision promotion will legitimately fail closed on a
finishes-vs-`/readyz` mismatch.

### Step 2 — Decide on the frontend

The warm-up hop is committed but not live, so the Scheduler ping is currently
doing all the work. Deploying Hosting ships **everything** in `public/`,
including the unrelated Speaking UI changes.

**Recommendation: leave it.** The ping covers the cold path; the warm-up is
belt-and-braces. Ship it when the Speaking UI work is ready to ship anyway.

### Step 3 — Replace the cost estimate with telemetry

Once several days of data exist, execute the tested Monitoring REST helper required by plan §7/L2:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/measure-phoneme-billable-time.ps1 -Hours 24 -Revision phoneme-recognizer-00010-rir
```

(Note: `gcloud monitoring time-series list` is an invalid gcloud command. The Monitoring REST API helper `scripts/measure-phoneme-billable-time.ps1` queries `projects.timeSeries.list` directly.)

Report actual billed instance time against the free allowance, remembering the
allowance is **billing-account-wide** and shared with `praat-api`,
`parselmouth-backend`, and real learner traffic.

### Step 4 — Close the smaller gaps

Write the R3 allowlist; grant `roles/iam.serviceAccountTokenCreator` so R6's
candidate smoke test becomes possible; rehearse rollback on
`phoneme-recognizer`.

### Step 5 — Optional optimisation (plan §7)

Both free, neither urgent while the ping holds:

- **Right-size memory.** Provisioned at 4 GiB reactively after a 1024 MiB OOM;
  the manifest records `peakRssGiB: 0.163`. Measure the true working set.
- **Evaluate the ONNX engine.** `requirements.phoneme-onnx.txt` already exists;
  `onnxruntime` loads faster and lighter than torch. The largest remaining lever
  on the 41 s cold start. Must clear the same corpus gates (`cleanAccuracy`
  0.8474, `mandatoryWordsCorrect` 5/6) before `selectedEngine` flips.

---

## 7. Process notes worth keeping

Three things went wrong in the *execution*, all now guarded:

1. **A rewritten plan was committed without being read**, and a remembered
   7-step version was executed instead of the reviewed 10-step spec. R1 and R2
   were meant to gate the commit and were skipped; both were retrofitted
   afterwards. Re-read a plan immediately before acting on it, especially when
   review is running concurrently.

2. **PowerShell splits unquoted comma-separated gcloud flag values** into an
   array and rejoins them with spaces. This silently corrupted `--startup-probe`
   (probe path became the entire parameter string) and `--update-env-vars`
   (`GIT_SHA` swallowed the whole string) — **three separate times**. Every
   compound flag must be quoted, and the deployed config re-read afterwards.

3. **`--to-latest` fixed one failure by creating a worse one.** It escaped the
   pinned-revision trap but set `latestRevision: true`, so any future deploy
   would have taken production traffic with no smoke test. Now forbidden in
   code: `scripts/release/pronunciation-v3.ps1` rejects it before invoking
   gcloud, and a contract test asserts the guard runs inside the single gcloud
   wrapper.

A fourth, caught by the retrofit rather than in production: the first
keep-alive verifier **could report a clean pass on worthless evidence**. The
repaired version fails closed, and on its first live run immediately did so.

---

## 8. Summary & Recommendation

**Status:** Core V3 backend fix is healthy in production; release sign-off remains blocked.

While the core backend fixes are functioning cleanly in live production, full release sign-off remains blocked by outstanding release-control gaps and verification gates:
- Missing R3 `release-source-allowlist.txt` enumerating reviewed paths.
- Unverified R6 private candidate revision smoke test (`roles/iam.serviceAccountTokenCreator` permission needed).
- Incomplete R10 recognizer rollback rehearsal (`phoneme-recognizer` un-rehearsed).
- Image-baked `GIT_SHA` / `BUILD_SHA` not yet deployed to production.
- Unverified 24h keep-alive observation window (fails closed until 24h elapses).
- Frontend `/warm/v3` integration not deployed to Hosting.
- Telemetry-based cost verification pending via `scripts/measure-phoneme-billable-time.ps1`.

Let the service run overnight, and proceed with Step 1 (`scripts/verify-phoneme-keepalive.ps1`) once 24 hours have elapsed.
