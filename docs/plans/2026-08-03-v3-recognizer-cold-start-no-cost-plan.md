# V3 Phoneme Recognizer Cold-Start Remediation — No-Cost Implementation Plan

**Goal:** Make the Pronounce mode V3 comparison succeed on every request — including the first request after an idle period — without adding any recurring infrastructure cost.

**Root cause reference:** `docs/audits/pronunciation-v3/2026-08-03/v3-recognizer-unavailable-root-cause.md`

**Architecture:** Widen the V3 timeout budget so a cold start degrades to *slow* rather than *failed*; move the model load out of the learner's request by warming the recognizer when Pronounce mode opens and by gating Cloud Run readiness on `/readyz` instead of a bare TCP bind; then shrink the cold start itself by removing unused CUDA payload and right-sizing memory. Report transport failures with their true reason codes throughout.

**Tech Stack:** Python 3.11 Flask + gunicorn on Cloud Run (`praat-api`, `phoneme-recognizer`), `requests` client, vanilla JS ES modules under `public/pronunciation-analyzer/`, Node `.mjs` tests, `pytest`-style `unittest` under `backend/`.

**Cost constraint:** Cloud Run request-based billing charges for instance time while a request is in flight, not for idle time between requests. Every task below stays inside that model. **No task pins an always-on instance. `--min-instances` is explicitly out of scope.**

---

> ## ⚠️ SUPERSEDED FOR CURRENT STATE
>
> This document records the **remediation phases and their execution**. It is
> accurate as history, but it is *not* the current source of truth for
> production state, cost, or release process.
>
> **Current state, open blockers, and the release gate live in
> [`2026-08-03-v3-production-issues-and-keepalive-plan.md`](2026-08-03-v3-production-issues-and-keepalive-plan.md).**
>
> Two corrections applied here on 2026-08-03 after review: the `--to-latest`
> instruction below is **forbidden**, and the `$0` cost claims were wrong.
> Details inline.

## DEPLOYED TO PRODUCTION — 2026-08-03 12:40 UTC

| Service | New revision | Image |
|---|---|---|
| `phoneme-recognizer` | `phoneme-recognizer-00004-bbc` | `gcr.io/parselmouth/phoneme-recognizer:coldstart-20260803-1906` |
| `praat-api` | `praat-api-00039-kzk` | `…/praat-api:coldstart-20260803-1906` |

Rollback targets: `phoneme-recognizer-00002-vus`, `praat-api-00048-tix`.

**Image size: 4,436 MB → 2,001 MB** (pip layer 2,764 → 329 MB). The CPU wheel
pin built cleanly; Task 5.2's build caveat is resolved.

**Two deploy-time traps worth recording:**

1. *Traffic was pinned, not `LATEST`.* Both services routed 100% to a specific
   tagged revision (`pronunciation-v2v3-candidate`, `phoneme-v2v3-candidate`),
   so `gcloud run deploy` created new revisions that served **zero** traffic and
   reported the *old* revision name as "serving 100 percent".

   > ⛔ **The fix applied on the day — `update-traffic --to-latest` — is now
   > forbidden on these services.** It sets `latestRevision: true`, so every
   > future deploy takes production traffic the instant it is created, with no
   > smoke test. Traffic has since been re-pinned to explicit revisions. Use the
   > zero-traffic tagged rollout in
   > [`…keepalive-plan.md` §5](2026-08-03-v3-production-issues-and-keepalive-plan.md):
   > deploy `--no-traffic --tag=candidate`, smoke-test the candidate URL, then
   > `--to-revisions=<revision>=100`.

   Also note revision numbering here is **not monotonic** — the new `praat-api`
   revision was `00039-kzk` while `00048-tix` was older. Verify by
   `metadata.creationTimestamp` and image digest, never by revision number.
2. *PowerShell mangles comma-separated gcloud flag values.* An unquoted
   `--startup-probe=httpGet.path=/readyz,initialDelaySeconds=10,…` is parsed as
   a PowerShell array and joined with spaces, producing a probe whose **path**
   was the literal string `/readyz initialDelaySeconds=10 periodSeconds=5 …`.
   The flag value must be quoted as a whole.

**Verified in production:**

- `STARTUP HTTP probe succeeded after 5 attempts … path "/readyz"` — Phase 4
  live. The ~50 s model load now runs during startup (12:37:28 → 12:38:18),
  gated by the probe, instead of inside a learner's request.
- `GET /health` → `recognizerConfigured: true` (field exists only in new code).
- `POST /warm/v3` → `202 {"status":"warming"}` in 0.5 s.
- Recorded-sample replay → `status: complete`, V3 available, **8.8 s**.
- **No `minScale` on either service** — no minimum-instance idle charge. (An
  earlier version of this line claimed "$0 recurring"; that overstated the
  case. Cloud Run bills startup, request processing, and graceful shutdown, and
  the free allowance is billing-account-wide. See the cost scenarios in
  [`…keepalive-plan.md` §3](2026-08-03-v3-production-issues-and-keepalive-plan.md).)

### Cold-start verification — PASSED (second attempt)

The **first** true cold test failed: `HTTP 504 in 61.2s`.

**Cause — a missed timeout layer.** Phase 1's table covered the client read
timeout, the V3 hard cap, and both of the *recognizer's* budgets, but omitted
the two budgets on `praat-api` itself — the service the browser actually calls
and the one that blocks while the recognizer cold-starts. Both sat at 60 s:

| Layer | Was | Now |
|---|---|---|
| `praat-api` gunicorn `--timeout` (`backend/Dockerfile`) | 60 s | **120 s** |
| `praat-api` Cloud Run `timeoutSeconds` | 60 s | **120 s** |

Widening every downstream budget is useless while the caller's own worker is
killed at 61 s. Guarded now by
`V3TimeoutBudgetTest.test_praat_api_worker_outlives_the_v3_wait`, which asserts
the praat-api worker budget exceeds `_V3_HARD_TIMEOUT_SECONDS`.

Redeployed as `praat-api-00040-gr4` (image `…:coldstart-20260803-2015`).

**Final results, measured after a full scale-to-zero idle:**

| Path | Before | After |
|---|---|---|
| Cold (first request after idle) | failed at 15 s | **HTTP 200 in 41.2 s**, `complete`, 3 syllables, `source: ctc` |
| Warm | 0.3–1.3 s | **2.6–2.7 s**, `complete` |
| Minimum-instance idle charge | none | **none** — no `minScale` on either service |

Note the cold path is ~41 s, not eliminated. That is the documented trade: the
no-cost fix makes a cold start *slow* rather than *broken*. Phase 3's warm-up
hop hides it behind the learner's reading time; only `--min-instances` would
remove it outright, and that is out of scope by the cost constraint.

**Subsequently added:** a Cloud Scheduler keep-alive ping (every 10 min,
06:00–23:50 `Asia/Ho_Chi_Minh`) holds an instance during active hours, so the
41 s path is rarely reached. It *reduces* cold starts rather than eliminating
them — Cloud Run may reclaim an idle instance at any time. Measure the rate
with `scripts/verify-phoneme-keepalive.ps1`; see
[`…keepalive-plan.md` §3](2026-08-03-v3-production-issues-and-keepalive-plan.md).

> **Release status:** this work is **not signed off**. Production is running
> code built from an uncommitted working tree, so the live `BUILD_SHA` does not
> identify the running source. Phase R in
> [`…keepalive-plan.md` §6](2026-08-03-v3-production-issues-and-keepalive-plan.md)
> is the blocking next step.

---

## Execution status — 2026-08-03

All code implemented and locally verified before deploy.

| Phase | Code | Local verification | Deploy |
|---|---|---|---|
| 1 — timeout budget | done | done | pending |
| 2 — transport reasons | done | done | pending |
| 3 — warm-up hop | done | done | pending |
| 4 — eager load + probe | done | unit-tested | pending (probe is a `gcloud` change) |
| 5 — CPU torch pin | done (5.1, 5.2) | hypothesis **confirmed** | pending (5.3, 5.4 not started) |
| 6 — local launcher | done | done | n/a (local only) |

**Task 5.1 result — hypothesis confirmed.** The deployed image manifest
(`sha256:e41d84cc…`) is **4,436 MB compressed across 11 layers**, with a single
2,764 MB pip layer and a 1,454 MB model layer. A CPU-only torch install is
~250 MB, so Task 5.2 should remove roughly 2.5 GB — well over half the image.
This is almost certainly the dominant term in the 46–52 s cold start, since
Cloud Run streams image layers on instance start.

**Caveat:** Task 5.2 is **not build-verified** — Docker is unavailable on this
workstation, so the CPU wheel resolution has not been exercised. The first
Cloud Build run is the real test. If `torch==2.9.1+cpu` is unavailable for
`python:3.11-slim`, adjust the pin rather than dropping the index.

Test results: 75 backend tests (`test_phoneme_service`, `test_phoneme_client`,
`test_pronunciation_api_v2_recognizer`, `test_pronunciation_packaging`,
`test_local_pronounce_samples`) + 43 (`test_pronunciation_api_v2`) + 30
(packaging) pass; 52 frontend `tests/pronunciation-analyzer/*.test.mjs` pass.

### Live verification against the recorded sample

| Scenario | Before | After |
|---|---|---|
| Recognizer up, local stack | `MODEL_INFERENCE_FAILED` in 0.1 s | **`status: complete`, V3 available, 3 syllables, `segmentation_source: ctc`, 3.6 s** |
| Recognizer down | `MODEL_INFERENCE_FAILED` (blames the model) | **`RECOGNIZER_UNREACHABLE`** (names the real fault) |
| `POST /warm/v3` | route did not exist | **202 `{"status":"warming"}` in 9 ms** |
| `POST /warm/v3` repeat | — | **202 `{"status":"debounced"}`** |
| `GET /health` | no recognizer signal | **`recognizerConfigured: true`**, URL not leaked |

---

## Path Convention

- Recognizer client and V3 orchestration stay under `backend/local_server/`.
- Recognizer service code stays under `backend/phoneme_service/`.
- Pronounce mode runtime code stays under `public/pronunciation-analyzer/`.
- Backend tests live under `backend/test_*.py`; frontend logic tests live under `tests/pronunciation-analyzer/`.
- Container and deploy config: `backend/Dockerfile.phoneme`, `backend/cloudbuild.phoneme.yaml`, `backend/requirements.phoneme-*.txt`.

## Constraints and Defaults

- No new runtime dependencies.
- No UI redesign. The warm-up hop in Phase 3 adds no visible element — it is a fire-and-forget network call.
- No production deploy without explicit instruction (project deployment rule). Every phase is verified locally first.
- Do not change V2 behaviour. `praat-api`'s existing Praat path has run for months without incident and is not in scope.
- Reason codes added to envelopes must already exist in `SERVICE_UNAVAILABLE_REASONS` (`public/pronunciation-analyzer/verification-attempt-policy.js`) so they never consume a learner re-record attempt.

---

## Phase 1 — Make the cold path succeed (P0, free)

**Problem:** the recognizer answers cold requests correctly in 46–52 s; the caller hangs up at 15 s and discards the result.

**Principle:** each layer's timeout must clear the layer beneath it, with headroom.

### Task 1.1 — Widen the client read timeout

`backend/local_server/phoneme_client.py:78`

```python
_RECOGNIZER_HTTP_TIMEOUT_SEC = 75   # was 15
```

Covers the observed 52 s worst case plus ~40% headroom. Used by all four `self._session.post(...)` call sites (`:222`, `:247`, `:292`, `:301`) — no other edit needed.

### Task 1.2 — Widen the V3 leg hard cap

`backend/local_server/server.py:2298`

```python
_V3_HARD_TIMEOUT_SECONDS = 80   # was 18
```

Must exceed Task 1.1 so a genuine HTTP read timeout surfaces as `TIMEOUT` from the client rather than being pre-empted by the outer `concurrent.futures` cap.

### Task 1.3 — Widen the recognizer's own request budget

`backend/Dockerfile.phoneme`, CMD:

```
--timeout 120     # was 30
```

Cloud Run service (applied at deploy, not in code):

```bash
gcloud run services update phoneme-recognizer \
  --region=us-central1 --project=parselmouth \
  --timeout=120
```

### Task 1.4 — Widen `praat-api`'s own budgets ⚠️ ADDED AFTER TASKS 1.1–1.3 FAILED

**This task was missing from the original plan, and its absence caused the
first production cold test to return `HTTP 504 in 61.2 s`.** Tasks 1.1–1.3
widen the client and the *recognizer*. But `praat-api` is the service the
browser calls, and it blocks while the recognizer wakes — so its own budgets
must clear `_V3_HARD_TIMEOUT_SECONDS` too. Both sat at 60 s.

`backend/Dockerfile`, CMD:

```
--timeout 120     # was 60
```

```bash
gcloud run services update praat-api --region=us-central1 --project=parselmouth --timeout=120
```

**The complete layer list, browser inward** — enumerate it this way, not
outward from the failing service, or a layer gets missed exactly as it was
here:

| # | Layer | Value |
|---|---|---|
| 1 | `praat-api` Cloud Run `timeoutSeconds` | 120 s |
| 2 | `praat-api` gunicorn `--timeout` | 120 s |
| 3 | `_V3_HARD_TIMEOUT_SECONDS` (`server.py`) | 80 s |
| 4 | `_RECOGNIZER_HTTP_TIMEOUT_SEC` (`phoneme_client.py`) | 75 s |
| 5 | `phoneme-recognizer` gunicorn `--timeout` | 120 s |
| 6 | `phoneme-recognizer` Cloud Run `timeoutSeconds` | 120 s |

### Task 1.5 — Guard the ordering with tests

In `backend/test_pronunciation_api_v2_recognizer.py`:

```
assert _RECOGNIZER_HTTP_TIMEOUT_SEC < _V3_HARD_TIMEOUT_SECONDS
assert _V3_HARD_TIMEOUT_SECONDS < 120   # gunicorn + Cloud Run request budget
```

plus `test_praat_api_worker_outlives_the_v3_wait`, which parses
`backend/Dockerfile` and asserts layer 2 exceeds layer 3 — the check that would
have caught the 504 before deploy.

Cheap regression fence against someone tightening one layer in isolation.

**Verification:** replay the recorded sample (§ Verification Protocol) against a deliberately cold production instance. Expect HTTP 200, `status: complete`, `v3.status: available`, elapsed 45–55 s. Today the same call returns `partial_failure` at 15 s.

**Cost:** none. That instance time is already billed today; the result is simply discarded.

---

## Phase 2 — Report the true failure reason (P0, free)

**Problem:** `requests.ReadTimeout` and `ConnectionError` fall into a generic `except Exception` and are relabelled `MODEL_INFERENCE_FAILED`, so the UI blames the model for conditions where the model was never reached. This is what made both of today's faults opaque.

### Task 2.1 — Discriminate transport failures

`backend/local_server/server.py`, both handlers in `run_v3_pipeline()` (client construction ~`:2946`, and future resolution ~`:2977`):

```python
except requests.exceptions.Timeout:
    phoneme_error = 'TIMEOUT'
except requests.exceptions.ConnectionError:
    phoneme_error = 'RECOGNIZER_UNREACHABLE'
except ConfigurationError as error:
    phoneme_error = getattr(error, 'reason', None) or REASON_RECOGNIZER_CONFIG_MISSING
except Exception as error:
    phoneme_error = getattr(error, 'reason', None) or 'MODEL_INFERENCE_FAILED'
```

Import `requests` at module scope in `server.py` if not already present. Order matters — the specific handlers must precede the generic one.

### Task 2.2 — Register the new code client-side

`public/pronunciation-analyzer/verification-attempt-policy.js:11-28` — add `RECOGNIZER_UNREACHABLE` to `SERVICE_UNAVAILABLE_REASONS` so it counts as "the service never judged this recording" and does not burn a re-record attempt. `TIMEOUT` is already present.

`public/pronunciation-analyzer/version-comparison.js:4-14` — add copy:

```js
RECOGNIZER_UNREACHABLE: 'Analysis unavailable because the recognizer could not be reached.',
```

### Task 2.3 — Tests

- `backend/test_pronunciation_api_v2_recognizer.py` — a stubbed client raising `requests.exceptions.ReadTimeout` yields `TIMEOUT`; one raising `ConnectionError` yields `RECOGNIZER_UNREACHABLE`.
- `tests/pronunciation-analyzer/verification-attempt-policy.test.mjs` — `RECOGNIZER_UNREACHABLE` maps to `unavailable`.
- `tests/pronunciation-analyzer/version-comparison.test.mjs` — the new reason renders its own copy string.

**Cost:** none.

---

## Phase 3 — Overlap the cold start with human time (P1, free)

**Problem:** even at 50 s, a cold start in the learner's path is a bad experience. But a learner spends 10–60 s reading the word and preparing before pressing record — dead time the load can hide inside.

### Task 3.1 — Warm-up endpoint on `praat-api`

New route in `backend/local_server/server.py`:

```python
@app.route('/warm/v3', methods=['GET', 'POST'])
def warm_v3():
    """Fire-and-forget recognizer warm-up. Never blocks, never fails the caller."""
```

Behaviour:
- Returns `202 {'status': 'warming'}` immediately — never waits on the recognizer.
- Dispatches a background-thread authenticated `GET {PHONEME_SERVICE_URL}/readyz` with a short connect timeout and a generous read timeout.
- Debounced: if a warm-up was dispatched within the last 60 s, no-op and still return 202. Prevents a page refresh loop from fanning out requests.
- If `PHONEME_SERVICE_URL` is unset, returns `202 {'status': 'disabled'}` — never a 5xx, since this is best-effort.

### Task 3.2 — Client hop

`public/pronunciation-analyzer/praat-api.js` — add:

```js
warmV3() { return fetch(`${this.backendUrl}/warm/v3`, { method: 'POST', keepalive: true }).catch(() => {}); }
```

Errors are swallowed by design: a failed warm-up must never surface to the learner.

`public/pronunciation-analyzer/app.js` — call it at two points:
1. Pronounce mode entry (the same lifecycle hook that currently initialises the analyzer).
2. Word/variant selection, if more than 60 s has elapsed since the last call.

### Task 3.3 — Tests

- `backend/test_pronunciation_api_v2_recognizer.py` — `/warm/v3` returns 202 in under 100 ms even when the recognizer stub sleeps 30 s; the debounce suppresses a second dispatch inside the window; a missing `PHONEME_SERVICE_URL` still returns 202.
- `tests/browser/pronounce-mode-browser-check.js` — assert a `/warm/v3` request is observed on mode entry.

**Effect:** the instance loads while the learner reads. The analysis request then lands warm at ~1 s.

**Cost:** one trivial request per session. The instance time it consumes is time that would otherwise have been billed inside the analysis request.

---

## Phase 4 — Stop routing traffic into a half-loaded container (P1, free)

**Problem:** the Cloud Run startup probe is `tcpSocket: 8080`, not `/readyz`. Gunicorn binds in well under a second, Cloud Run declares the instance ready, and the pending request walks into a container whose model has not loaded — so the whole load is paid inside the request, outside the window where startup CPU boost applies.

Confirmed in logs: `Default STARTUP TCP probe succeeded after 1 attempt` at 05:23:22, immediately followed by a 51.94 s request.

### Task 4.1 — Load the model eagerly

`backend/phoneme_service/app.py`, in `create_app()` — invoke the backend's `_ensure_loaded()` during construction rather than leaving it to the first inference (`backend/phoneme_service/backends.py:284`). Keep the lazy path intact for unit tests that mock the backend; gate eager loading behind a `PHONEME_EAGER_LOAD` env var defaulting to on in the container, off under test.

### Task 4.2 — Gate readiness on `/readyz`

```bash
gcloud run services update phoneme-recognizer \
  --region=us-central1 --project=parselmouth \
  --startup-probe=httpGet.path=/readyz,initialDelaySeconds=10,periodSeconds=5,failureThreshold=24,timeoutSeconds=5
```

24 × 5 s = 120 s of startup budget, comfortably above the observed 52 s.

### Task 4.3 — Test

`backend/test_phoneme_service.py` — with `PHONEME_EAGER_LOAD=1`, `create_app()` leaves the backend loaded; `/readyz` returns 200 without triggering a load.

**Note:** this does not shorten the cold start by itself. What it buys is an *honest* readiness signal — which is what makes Phase 3's warm-up deterministic — plus startup CPU boost covering the load.

---

## Phase 5 — Shrink the cold start itself (P2, free, larger change)

**Problem:** `model-manifest.json` records `coldLoadMs: 7759` and `peakRssGiB: 0.163`. Production is 46–52 s — roughly 6× the benchmark. The model is baked into the image (`Dockerfile.phoneme` pre-downloads it, then sets `TRANSFORMERS_OFFLINE=1`/`HF_HUB_OFFLINE=1`), so this is not a runtime download. The gap is container start plus image-layer streaming plus torch import.

### Task 5.1 — Confirm the CUDA hypothesis first — **CONFIRMED 2026-08-03**

Measured from the deployed manifest rather than a local build:

```powershell
$tok = gcloud auth print-access-token
$hdr = @{ Authorization = "Bearer $tok"; Accept = "application/vnd.docker.distribution.manifest.v2+json" }
$m = Invoke-RestMethod -Uri "https://us-docker.pkg.dev/v2/parselmouth/gcr.io/phoneme-recognizer/manifests/sha256:e41d84cc29ed5e69c7d4ca5ed1ae0031d8e6fdb71c06f2cb17ff50d9eb603993" -Headers $hdr
($m.layers | Measure-Object -Property size -Sum).Sum / 1MB
```

Result: **4,436 MB compressed, 11 layers** — largest 2,764 MB (pip), then
1,454 MB (baked model). Task 5.2 applied.

<details><summary>Original hypothesis text (retained for provenance)</summary>

`backend/requirements.phoneme-torch.txt` pins `torch>=2.0,<3.0` with **no CPU-wheel index**. On linux/amd64 that resolves to the CUDA build, pulling several GB of `nvidia-*` wheels that are pure dead weight on a CPU-only Cloud Run instance.

Confirm before acting:

```bash
docker build -f backend/Dockerfile.phoneme --build-arg MODEL_REVISION=ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4 -t phoneme-probe .
```

```bash
docker run --rm phoneme-probe pip list --format=freeze | grep -i nvidia
```

If that returns rows, the hypothesis holds. If it returns nothing, skip Task 5.2 and re-open the investigation.

</details>

### Task 5.2 — Pin CPU-only torch

`backend/requirements.phoneme-torch.txt`:

```
--extra-index-url https://download.pytorch.org/whl/cpu
torch==2.9.1+cpu
```

Pin the exact version already validated locally (2.9.1). Record before/after image size and cold-start latency in the audit doc — this is the largest single free win if the hypothesis holds.

### Task 5.3 — Right-size memory

The service sits at 4 GiB, provisioned reactively after a 1024 MiB OOM at 04:08 UTC. The manifest's `peakRssGiB: 0.163` is a benchmark figure, not a production working set. Measure actual peak RSS under a realistic request, then set the allocation to measured peak × 2 rounded up. Smaller allocation means less to stream on cold start.

### Task 5.4 — Evaluate the ONNX engine

`backend/requirements.phoneme-onnx.txt` already exists and `model-manifest.json` carries `selectedEngine` (currently `"torch"`). `onnxruntime` loads faster and with a far smaller footprint than torch.

Gate on accuracy: the ONNX build must clear the same corpus checks as the torch build before `selectedEngine` flips. Do not swap engines to chase latency at the cost of `cleanAccuracy` (currently 0.8474) or `mandatoryWordsCorrect` (5/6).

---

## Phase 6 — Local development reliability (free, independent)

These are separate from the production cold-start work and can land in any order.

### Task 6.1 — Fix the launcher readiness gate

`backend/local_server/start_all_servers.bat:83-98` — the loop advertises "up to 180 seconds" but polls by iteration count. While 8082 refuses connections `curl` fails instantly, collapsing the real wait to roughly 30 s. Poll on elapsed wall-clock time instead so the advertised budget is the actual budget.

### Task 6.2 — Make the V3-disabled fallback loud

`start_all_servers.bat:108` — when `PHONEME_READY` is 0, Flask starts with an empty `PHONEME_SERVICE_URL` and V3 is silently off for the whole session. Print a clearly-marked banner. Consider a non-zero exit or an explicit `--allow-no-v3` opt-in so the degraded mode is chosen, not stumbled into.

### Task 6.3 — Surface the wiring in `/health`

Add `recognizerConfigured: bool(os.environ.get('PHONEME_SERVICE_URL'))` to the `/health` payload. One curl then answers "is V3 wired up?" without reading process environments. Never expose the URL itself — presence only, consistent with the existing logging discipline in `run_v3_pipeline()`.

### Task 6.4 — Update the launcher contract test

`tests/pronunciation-analyzer/local-launcher-contract.test.mjs:12-14` asserts the current branch structure. Update alongside Tasks 6.1–6.2.

---

## Rollout Order

| Phase | Blocking? | Deploy needed | Effect |
|---|---|---|---|
| 1 | — | praat-api + phoneme-recognizer | Cold requests succeed (~50 s) instead of failing |
| 2 | — | praat-api | Failures name their real cause |
| 3 | after 1 | praat-api + hosting | Cold start hidden behind learner prep time |
| 4 | after 3 | phoneme-recognizer | Readiness becomes honest; warm-up becomes deterministic |
| 5 | after 4 | phoneme-recognizer | Cold start shrinks at the source |
| 6 | independent | none (local only) | Local sessions stop silently losing V3 |

Phases 1 and 2 alone close the reported defect. Phases 3–5 are progressive quality-of-service improvements, each still free.

---

## Verification Protocol

Every phase is verified with the same recorded sample before and after:

`test-results/pronounce-local-samples/photograph-20260803011926909-65561e59.wav` — `photograph`, `/ˈfoʊtəˌɡræf/`, 3 syllables, variant `8050cda57bb448e7`.

```bash
python - <<'PY'
import requests, time
wav = 'test-results/pronounce-local-samples/photograph-20260803011926909-65561e59.wav'
url = 'https://praat-api-1071929245506.us-central1.run.app/analyze/compare'
data = {'reference_ipa': '/ˈfoʊtəˌɡræf/', 'expected_syllables': '3',
        'target_word': 'photograph', 'variant_id': '8050cda57bb448e7'}
t = time.time()
r = requests.post(url, files={'audio': ('recording.wav', open(wav,'rb'), 'audio/wav')},
                  data=data, timeout=180, verify=False)
j = r.json()
print(f'HTTP {r.status_code} in {time.time()-t:.1f}s  status={j.get("status")}')
print('v3:', j['v3']['status'], j['v3']['reason'])
PY
```

**A cold instance is required to prove Phase 1.** Warm instances pass today and prove nothing. Wait for scale-to-zero (~15 min idle) or deploy a new revision, then confirm the first request against it.

Correlate the result with both services' logs:

```bash
gcloud logging read 'resource.labels.service_name="phoneme-recognizer"' --project=parselmouth --limit=20 --freshness=1h --format="value(timestamp,httpRequest.latency,httpRequest.status)"
```

Local, before testing `localhost`:

```bash
PORT=8082 python -m backend.phoneme_service.local_server
```

```bash
curl -s http://127.0.0.1:8082/readyz
```

---

## Out of Scope

- **`--min-instances=1`.** Eliminates the cold path entirely, but pins an always-billed instance — at the current 2 vCPU / 4 GiB and us-central1 idle rates, roughly **$37/month** after free tier. Excluded by the cost constraint. Revisit only if Phases 1–5 leave the cold path unacceptably slow, and only after Task 5.3, which would materially reduce that figure.
- **Production sample capture.** "Save sample locally" is loopback-gated by design in both layers and writes to the developer workspace. Exposing it in production would need a Cloud Storage sink, admin authorisation, and a retention policy for learner audio as personal data. A separate feature, not a fix.
- **V2 / Praat behaviour.** Unchanged and unaffected.

---

## Success Criteria

1. A cold-instance replay of the recorded sample against production returns `status: complete` with `v3.status: available`.
2. No V3 comparison failure in the logs is attributed to `MODEL_INFERENCE_FAILED` when the true cause was transport.
3. A learner opening Pronounce mode and recording within a normal interval sees V3 respond in ~1 s.
4. `gcloud run services describe phoneme-recognizer` shows no `minScale` annotation — the no-cost constraint held.
5. A local session with the recognizer down fails loudly and names `RECOGNIZER_CONFIG_MISSING`, not `MODEL_INFERENCE_FAILED`.
