# V3 Pronunciation — Release Status and Next Steps

**Date:** 2026-08-04 (Vietnam Time)
**Release commit:** `18b65ed4` · follow-ups `45521852`, `65f675b0`
**Branch:** `codex/speaking-ui-review-repair` (not merged, not pushed)
**Status:** shipped and verified in production; three release gates remain open

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
| CPU-only torch wheels | Image 4,436 MB → 2,001 MB |
| `POST /warm/v3` + calls on Pronounce entry and word change | Cold load overlaps the learner's reading time (**committed, not deployed**) |
| Cloud Scheduler ping, every 10 min, 06:00–23:50 `Asia/Ho_Chi_Minh` | Holds an instance during active hours |
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
| During 06:00–23:59, instance held | — | ~3 s |
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

**Tests:** 20 ops · 52 pronunciation · 119 backend — all passing.

---

## 3. Open items

### Blocking a clean sign-off

| # | Item | Why it matters |
|---|---|---|
| 1 | **24 h keep-alive observation** | The keep-alive premise has never been measured over a full window. Everything about cold-start frequency is currently assumed. |
| 2 | **Hosting not deployed (R5)** | The committed frontend does not match live bytes. `/warm/v3` calls observed in production: **0**. |
| 3 | **Cost is arithmetic, not telemetry** | The ~1.7% free-tier figure was calculated, never measured. |

### Smaller gaps

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

**84 uncommitted files** remain in the working tree from the earlier Speaking UI
session — untouched by this work, but a large amount of unsaved change on one
branch.

---

## 4. Next steps, in order

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

Once several days of data exist:

```bash
gcloud monitoring time-series list --project=parselmouth --filter='metric.type="run.googleapis.com/container/billable_instance_time" AND resource.labels.service_name="phoneme-recognizer"' --format=json
```

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

## 5. Process notes worth keeping

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

## 6. Recommendation

Stop here. Let it run overnight, and start with Step 1 tomorrow.

Production is working and verified. Every remaining item is either a
measurement that needs time to elapse, a decision that is yours, or an
optimisation that is not urgent.
