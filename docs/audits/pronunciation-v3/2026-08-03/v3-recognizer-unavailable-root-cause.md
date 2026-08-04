# V3 phoneme recognizer unavailable — root cause and no-cost remediation

**Date:** 2026-08-03
**Branch:** `codex/speaking-ui-review-repair`
**Symptom:** Pronounce mode admin comparison shows `ENGINE V3 — Unavailable / "Analysis unavailable because model inference failed."` on both `localhost` and `betterenglishlearning.com`. V2 renders normally; V3 falls back to display-only Praat boundaries.
**Verification sample:** `test-results/pronounce-local-samples/photograph-20260803011926909-65561e59.wav` — word `photograph`, reference `/ˈfoʊtəˌɡræf/`, 3 syllables, variant `8050cda57bb448e7`.

**Implementation plan:** `docs/plans/2026-08-03-v3-recognizer-cold-start-no-cost-plan.md`

---

## 0. Verdict — yes, there is a no-cost solution

Nothing here requires spending money.

The recognizer already answers every cold request correctly, in 46–52 s. The caller hangs up at 15 s and discards the result. **Raising the four timeouts so they clear each other converts every one of those failures into a success, at zero cost** — that instance time is already billed today; only the answer is being thrown away. This is Phase 1 of the plan and it alone closes the reported defect.

The honest caveat: that makes the first recording after an idle period *slow* (~50 s), not instant. Phase 3 addresses that by pinging the recognizer when the learner opens Pronounce mode, moving the load into the 10–60 s they spend reading the word before pressing record. Combined, a cold hit becomes rare and, when it does land, completes rather than fails. Still zero recurring cost.

If the ~50 s itself is unacceptable, Phase 5 attacks it at the source — CPU-only torch wheels, right-sized memory, the ONNX engine. Also free, just more work.

The only option that costs money is `--min-instances`, and it buys convenience, not capability. It is out of scope. See §6 and §9.

---

## 1. Summary

Two independent faults produce the same on-screen message. Neither is in the analysis logic — the V3 code path is healthy and was proved working on both sides with the recorded sample.

| Environment | Root cause | Class |
|---|---|---|
| Production | `phoneme-recognizer` cold start (~46–52 s) exceeds the caller's 15 s read timeout. Every first request after an idle period fails; the recognizer then completes successfully into a closed socket. | Infrastructure / timeout budget |
| Local | `127.0.0.1:8082` recognizer was not running, so the Flask API was launched with an empty `PHONEME_SERVICE_URL`. The running Flask process (PID 17536, started 08:04:56) also predates the working-copy edits that added `ConfigurationError.reason`, so a *configuration* fault was reported as a *model inference* fault. | Stale process / launcher readiness gate |

A third, cosmetic defect amplifies both: `requests.ReadTimeout` and connection errors are swallowed by a generic `except Exception` and relabelled `MODEL_INFERENCE_FAILED`, so the UI reports a model failure for conditions where the model was never reached.

---

## 2. Production — cold start exceeds the client timeout

### 2.1 Configuration is correct

`praat-api` (revision `praat-api-00048-tix`, us-central1, project `parselmouth`):

```
PRONUNCIATION_V3_MODE = shadow
PHONEME_SERVICE_URL   = https://phoneme-recognizer-oq3kyypf4q-uc.a.run.app
PHONEME_SERVICE_AUTH  = google
serviceAccount        = 1071929245506-compute@developer.gserviceaccount.com
```

`phoneme-recognizer` IAM policy grants `roles/run.invoker` to that same service account. Nothing is misconfigured, and no credential is failing.

### 2.2 Evidence — the timing mismatch

| Time (UTC) | Source | Event |
|---|---|---|
| 05:23:22 | phoneme-recognizer | `Starting new instance. Reason: AUTOSCALING` |
| 05:23:22 | phoneme-recognizer | `POST /recognize/v2` → **200 in 51.94 s** |
| 05:23:37 | praat-api | `V3 phoneme recognition error: HTTPSConnectionPool(...) Read timed out. (read timeout=15)` |
| 04:14:00 | phoneme-recognizer | cold `POST /recognize/v2` → **200 in 46.32 s** |
| 04:14:15 | praat-api | same read-timeout error |
| 04:17–05:26 | phoneme-recognizer | warm requests → 200 in **0.33 s – 1.33 s** |

The recognizer answers correctly every single time. The caller has already given up.

### 2.3 Why the caller gives up

| Limit | Value | Location |
|---|---|---|
| Recognizer HTTP read timeout | 15 s | [`phoneme_client.py:78`](../../../../backend/local_server/phoneme_client.py) `_RECOGNIZER_HTTP_TIMEOUT_SEC` |
| V3 leg hard cap | 18 s | [`server.py:2298`](../../../../backend/local_server/server.py) `_V3_HARD_TIMEOUT_SECONDS` |
| Recognizer gunicorn worker timeout | 30 s | `backend/Dockerfile.phoneme` CMD |
| Cloud Run request timeout | 60 s | `phoneme-recognizer` `spec.template.spec.timeoutSeconds` |

`phoneme-recognizer` has **no `minScale`**, so it scales to zero between sessions.

### 2.4 The startup probe is the aggravating factor

```
startupProbe:
  tcpSocket: { port: 8080 }
  failureThreshold: 1
  periodSeconds: 240
  timeoutSeconds: 240
```

The probe is **TCP, not `/readyz`**. Gunicorn binds the socket in well under a second, so Cloud Run marks the instance ready and routes the pending request into a container whose model has not loaded. The model is loaded lazily on first use (`_ensure_loaded()`, `backend/phoneme_service/backends.py:284`), so the entire multi-second load is paid *inside the learner's request* rather than during startup, where Cloud Run's startup CPU boost would apply and where the platform would hold traffic back until `/readyz` passed.

Confirmed in the logs: `Default STARTUP TCP probe succeeded after 1 attempt for container "phoneme-recognizer-1" on port 8080` at 05:23:22, immediately followed by the 51.94 s request.

### 2.5 Cold start is ~6× slower than the recorded benchmark

`backend/phoneme_service/model-manifest.json` records `coldLoadMs: 7759.16` (7.8 s) and `peakRssGiB: 0.163`. Observed Cloud Run cold path is 46–52 s. The model **is** baked into the image (`Dockerfile.phoneme` pre-downloads it, then sets `TRANSFORMERS_OFFLINE=1` / `HF_HUB_OFFLINE=1`), so this is not a runtime download. The gap is container start plus image-layer streaming plus torch import.

**Hypothesis, not yet confirmed:** `backend/requirements.phoneme-torch.txt` pins `torch>=2.0,<3.0` with **no CPU-wheel index**. On linux/amd64 that resolves to the CUDA build, dragging in several GB of `nvidia-*` wheels that are pure dead weight on a CPU-only Cloud Run instance. Layer streaming of that bulk is a plausible dominant term in the 46–52 s. To confirm:

```bash
gcloud run services describe phoneme-recognizer --region=us-central1 --project=parselmouth --format="value(spec.template.spec.containers[0].image)"
```

then inspect the manifest layer sizes, or rebuild locally and run `pip list | grep nvidia` inside the image.

### 2.6 Already-resolved noise in the same log window

- `04:12:17` — two `401 Unauthorized` against `https://phoneme-v2v3-candidate---phoneme-recognizer-...` The tagged revision URL is a different host from the base service URL, so the ID-token audience did not match. Traffic has since moved to the base URL.
- `04:08:14` — `Memory limit of 1024 MiB exceeded with 1053 MiB used`. Memory has since been raised to 4 GiB.

### 2.7 Empirical verification

Replaying the recorded sample against production while an instance was warm:

```
POST https://praat-api-1071929245506.us-central1.run.app/analyze/compare
  audio=photograph-20260803011926909-65561e59.wav
  reference_ipa=/ˈfoʊtəˌɡræf/  expected_syllables=3  target_word=photograph

→ HTTP 200 in 2.5 s
   status: complete
   v3.status: available   (reason: null)
   syllable_count: 3      segmentation_source: recognizer
```

Production V3 is fully functional. Only the cold path fails.

---

## 3. Local — recognizer down, stale Flask masking the reason

### 3.1 Observed state

- `127.0.0.1:8082` — **not listening**. The local recognizer was not running at all.
- `127.0.0.1:8081` — Flask API alive (PID 17536, **started 08:04:56**), `/health` reports `pronunciationV3Mode: off`.
- Working-copy edit times: `server.py` 08:43, `phoneme_client.py` 08:46, `start_all_servers.bat` 09:15 — **all after** the Flask process started. The running process is executing stale code.

### 3.2 Why the message says "model inference failed"

`ConfigurationError.reason` is an **uncommitted working-copy change** (`git diff backend/local_server/phoneme_client.py`). The pre-edit class carries no `reason` attribute, so the pre-edit `server.py` cannot map a missing `PHONEME_SERVICE_URL` onto `RECOGNIZER_CONFIG_MISSING`; it falls through to the generic handler and emits `MODEL_INFERENCE_FAILED`.

Verified: with the current code and `PHONEME_SERVICE_URL` unset, `create_phoneme_client()` raises `ConfigurationError reason=RECOGNIZER_CONFIG_MISSING` — the correct, actionable code the UI never showed you.

### 3.3 The launcher's readiness gate can silently disable V3

`backend/local_server/start_all_servers.bat:83-108`:

```bat
for /L %%i in (1,1,30) do ( ... curl --connect-timeout 1 --max-time 5 http://127.0.0.1:8082/readyz ... )
if !PHONEME_READY!==1 ( set PHONEME_SERVICE_URL=http://127.0.0.1:8082 ... )
else                  ( set PHONEME_SERVICE_URL=  ... )
```

While 8082 is refusing connections, curl fails instantly, so the "up to 180 seconds" loop collapses to roughly 30 s of real waiting. A first-ever model load that overruns that window drops into the `else` branch, which starts Flask with an **empty** `PHONEME_SERVICE_URL` — V3 is then off for the entire session with no visible warning beyond one line of console text in a minimised window.

Measured local cold readiness with a warm HF cache: **12 s**. A cold cache (first run, or after `pip install` of the torch extras) is materially longer.

### 3.4 Empirical verification

| Target | Recognizer on 8082 | `PHONEME_SERVICE_URL` | Result |
|---|---|---|---|
| Stale Flask :8081 (started 08:04) | up | (stale/empty) | `MODEL_INFERENCE_FAILED` **in 0.1 s** — no socket ever opened |
| Fresh Flask :8083 (current code) | up | `http://127.0.0.1:8082` | **HTTP 200 in 0.5 s, status `complete`, V3 available** |

Direct client call, bypassing Flask entirely:

```
PHONEME_SERVICE_URL=http://127.0.0.1:8082 PHONEME_SERVICE_AUTH=disabled
client.recognize_v2(wav, ['foʊ','tə','ɡræf'], 3, variant_id='8050cda57bb448e7')
→ OK  contract_version=recognize-v2  decoded_syllable_count=3
```

The local V3 path is healthy. The process under test was stale and unwired.

---

## 4. "Save sample locally" absent on production — by design, not a defect

The debug capture route is gated to loopback in **both** layers:

- Client: `LOCAL_PRONOUNCE_HOSTNAMES = new Set(['localhost', '127.0.0.1'])` — `public/pronunciation-analyzer/app.js:29`. The control is not rendered on any other host.
- Server: `_is_local_pronounce_request()` rejects non-loopback `remote_addr` with `403 LOCAL_ONLY` — `backend/local_server/server.py:660` and `:3260`.

The route writes WAV + JSON into the developer workspace (`test-results/pronounce-local-samples/`), which a Cloud Run container has no durable place for. Nothing to repair. Capturing production samples would be a new feature — a Cloud Storage sink plus admin authorisation and a retention policy, since learner audio is personal data.

---

## 5. Why this is only surfacing now

The V3 recognizer is **two days old**, not months old.

| Service | First revision | Age |
|---|---|---|
| `phoneme-recognizer-00001-xh7` | 2026-08-01 06:42 UTC | 2 days |
| `phoneme-recognizer-00002-vus` | 2026-08-03 04:09 UTC | today |

What has been running for months at no cost is **`praat-api`** — the V2 leg. That is pure signal processing: a small image, no ML weights, a cold start of a second or two. Scale-to-zero has always been invisible there, because its cold start fits comfortably inside any sane timeout.

The V3 leg is a different animal: a wav2vec2 CTC model on a 2 vCPU / 4 GiB instance. Nothing started charging you. What changed is that a new component was added whose cold start is long enough to blow through a timeout budget that was written for the old one. `min-instances` is not a bill that appeared — it is one *proposed remedy* that would create a new bill, and it is not the remedy this document recommends.

---

## 6. No-cost remediation — summary

Cloud Run request-based billing charges for instance time while a request is in flight, not for idle time between requests. Every item below stays inside that model — none of them pins an always-on instance, so none of them adds recurring cost.

> **Task-by-task implementation detail, rollout order, tests, and success criteria live in
> `docs/plans/2026-08-03-v3-recognizer-cold-start-no-cost-plan.md`.**
> This section is the rationale; that document is the work.

### P0 — Make the cold path succeed instead of fail (free)

Widen the timeout budget so a cold start degrades to *slow* rather than *broken*. Every layer must clear the one beneath it:

| Setting | Now | Proposed |
|---|---|---|
| `_RECOGNIZER_HTTP_TIMEOUT_SEC` (`phoneme_client.py`) | 15 s | 75 s |
| `_V3_HARD_TIMEOUT_SECONDS` (`server.py`) | 18 s | 80 s |
| gunicorn `--timeout` (`Dockerfile.phoneme`) | 30 s | 120 s |
| Cloud Run `timeoutSeconds` (phoneme-recognizer) | 60 s | 120 s |

Cost: nothing. You are already paying for those 50 s of instance time today — you are simply throwing the result away at 15 s.

### P0 — Report the real failure (free)

In `run_v3_pipeline()` (`server.py:2977`), catch `requests.exceptions.Timeout` → `TIMEOUT` and `requests.exceptions.ConnectionError` → `RECOGNIZER_UNREACHABLE` before the generic `except Exception` → `MODEL_INFERENCE_FAILED`. Both codes already exist in `SERVICE_UNAVAILABLE_REASONS` (`verification-attempt-policy.js:11-28`), so neither consumes a learner re-record attempt. This is what would have made both of today's faults self-diagnosing.

### P1 — Overlap the cold start with human time (free)

Add a warm-up hop fired when the learner **opens** Pronounce mode, long before they press record:

1. `praat-api` exposes `GET /warm/v3` — a fire-and-forget authenticated `GET /readyz` against the recognizer, returning 202 immediately.
2. The frontend calls it on mode entry and on word selection.

A learner spends 10–60 s reading the word and preparing before recording. The instance loads during that window, and the analysis request lands warm at ~1 s. Cost is one trivial request per session; the instance time consumed is time you would have paid inside the analysis request anyway.

### P1 — Stop routing traffic into a half-loaded container (free)

1. Load the model **eagerly** in `create_app()` (or a gunicorn `--preload`) rather than lazily on first inference.
2. Replace the TCP startup probe with an HTTP startup probe on `/readyz`:

```bash
gcloud run services update phoneme-recognizer \
  --region=us-central1 --project=parselmouth \
  --startup-probe=httpGet.path=/readyz,initialDelaySeconds=10,periodSeconds=5,failureThreshold=24,timeoutSeconds=5
```

This does not shorten the cold start on its own, but it makes readiness *honest* — which is what makes the P1 warm-up hop deterministic, and it lets startup CPU boost cover the load.

### P2 — Attack the cold start itself (free, larger change)

- **Pin CPU-only torch.** Add `--extra-index-url https://download.pytorch.org/whl/cpu` and pin `torch==2.x.y+cpu` in `requirements.phoneme-torch.txt`. If §2.5's hypothesis holds, this removes multiple GB of unused CUDA payload from the image and should cut cold start substantially. Verify the image shrinks and `pip list` shows no `nvidia-*` wheels.
- **Right-size memory.** The manifest records `peakRssGiB: 0.163`; the service is provisioned at 4 GiB after an OOM at 1 GiB. The true working set sits somewhere between. Measuring it and trimming reduces both cold-start streaming and any future min-instance cost.
- **Evaluate the ONNX engine.** `requirements.phoneme-onnx.txt` already exists and `model-manifest.json` carries `selectedEngine`. `onnxruntime` loads faster and with a far smaller footprint than torch. If accuracy holds against the existing corpus gates, this is the single largest cold-start win available.

### Local, separately (free)

1. Restart the local stack so 8081 runs the current working copy.
2. Fix the readiness gate in `start_all_servers.bat` — poll on wall-clock elapsed time, not iteration count, so a connection-refused loop cannot collapse a 180 s budget into 30 s.
3. Make the fallback loud: if `PHONEME_READY` is 0, print a clearly-marked banner so a V3-disabled session is obvious rather than silent.

### Rejected

**`--min-instances=1`.** Works, and eliminates the cold path entirely, but pins an always-billed instance: at the current 2 vCPU / 4 GiB and us-central1 idle rates (~$0.0000025 per vCPU-s and per GiB-s), roughly **$37/month** after free tier. Rejected as inconsistent with the no-cost constraint. Worth revisiting only if P0–P2 leave the cold path unacceptably slow — and only after the P2 right-sizing, which would reduce that figure.

---

## 7. Verification commands

Replay the recorded sample against either environment:

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

Bring the local recognizer up before testing localhost:

```bash
PORT=8082 python -m backend.phoneme_service.local_server
```

```bash
curl -s http://127.0.0.1:8082/readyz
```

Correlate a production failure with its cold start:

```bash
gcloud logging read 'resource.labels.service_name="phoneme-recognizer"' --project=parselmouth --limit=30 --freshness=6h --format="value(timestamp,httpRequest.latency,httpRequest.status)"
```

---

## 8. Open items

- [ ] Confirm or refute the CUDA-wheel hypothesis in §2.5 by inspecting the deployed image.
- [ ] Measure true peak RSS under load to right-size the 4 GiB allocation.
- [ ] Decide whether production sample capture (§4) is wanted as a real feature.
- [ ] Nothing in §6 has been implemented or deployed. Production changes await explicit instruction per the project deployment rule.

---

## 9. Cost appendix — for the record

Kept only so the rejected option is documented rather than re-litigated.

`--min-instances=1` on `phoneme-recognizer` at its current 2 vCPU / 4 GiB, us-central1 idle rates ($0.0000025 per vCPU-second and per GiB-second), billed across 2,592,000 seconds per month and net of the project free tier that `praat-api` also draws on:

| | monthly |
|---|---|
| idle CPU (2 vCPU) | ~$12.50 |
| idle memory (4 GiB) | ~$25.00 |
| **total** | **~$37** |

Memory is the dominant term, which is why Task 5.3 (right-sizing the reactively-provisioned 4 GiB) would materially reduce this figure should the option ever be revisited.

For contrast, the current configuration costs approximately nothing at rest: with no `minScale` the service holds zero instances between sessions, and each request bills only the seconds it actually occupies. That is also precisely why the first request fails — there is nothing running to answer it.
