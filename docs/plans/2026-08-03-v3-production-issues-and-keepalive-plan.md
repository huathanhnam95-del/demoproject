# V3 Pronunciation on Production — Issues Log and Reproducible Release Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load `executing-plans` to execute
> Phase R task-by-task. Execution must occur in a dedicated clean release
> worktree, never directly from the dirty development checkout.

**Goal:** Preserve the verified V3 cold-start repair while making every live
Cloud Run and Hosting artifact traceable to one reviewed commit, with explicit
candidate testing, promotion, rollback, and learner-safety gates.

**Architecture:** Keep `praat-api` public for browser calls and keep
`phoneme-recognizer` private behind service-account authentication. Build both
images from a detached clean worktree at the approved commit, promote the
recognizer before the API so the API candidate exercises the new recognizer,
then rehearse rollback and re-promotion before sign-off.

**Tech stack:** PowerShell, Git worktrees, Cloud Build, Cloud Run, Cloud
Scheduler, Firebase Hosting, Python/Node contract tests, Chrome Playwright, and
the Antigravity browser-agent confirmation workflow.

**Date:** 2026-08-03
**Last revised:** 2026-08-04
**Outcome:** V3 runs on production with **no minimum-instance idle charge**. Cold starts are *reduced*, not eliminated. See §3 for measured cost and §5 for review responses.

> **Corrected 2026-08-03 after review.** An earlier version of this document
> claimed the cold start was "eliminated during active hours" and quoted a
> `0.36%` free-tier figure. Both were wrong: Cloud Run may reclaim an idle
> instance at any time, so a ping reduces cold starts without guaranteeing
> their absence, and the cost estimate omitted billed startup time. Corrected
> below. Review: `docs/audits/pronunciation-v3/2026-08-03/v3-production-issues-and-keepalive-review.md`.
**Related:** `docs/audits/pronunciation-v3/2026-08-03/v3-recognizer-unavailable-root-cause.md` (root cause), `docs/plans/2026-08-03-v3-recognizer-cold-start-no-cost-plan.md` (remediation phases)

---

## 1. The original symptom

Pronounce mode's admin comparison showed `ENGINE V3 — Unavailable / "Analysis unavailable because model inference failed."` on both localhost and production. V2 rendered normally; V3 fell back to display-only Praat boundaries.

The message was wrong. The model never failed — in most cases it was never reached.

---

## 2. Every issue encountered, in the order found

### Issue 1 — Recognizer cold start exceeded the caller's timeout (production, root cause)

`phoneme-recognizer` scales to zero. Waking it (container start + torch import + model load) took **46–52 s**. The client gave up at **15 s**.

Log evidence — the recognizer answered correctly into a socket nobody was listening on:

| Time (UTC) | Source | Event |
|---|---|---|
| 05:23:22 | recognizer | `Starting new instance. Reason: AUTOSCALING` |
| 05:23:22 | recognizer | `POST /recognize/v2` → **200 in 51.94 s** |
| 05:23:37 | praat-api | `Read timed out. (read timeout=15)` |
| warm requests | recognizer | 200 in **0.33–1.33 s** |

**Solution:** widen every timeout so a cold start degrades to *slow* rather than *broken*.

| Layer | Was | Now |
|---|---|---|
| `_RECOGNIZER_HTTP_TIMEOUT_SEC` (`phoneme_client.py`) | 15 s | 75 s |
| `_V3_HARD_TIMEOUT_SECONDS` (`server.py`) | 18 s | 80 s |
| recognizer gunicorn `--timeout` | 30 s | 120 s |
| recognizer Cloud Run `timeoutSeconds` | 60 s | 120 s |

**Cost:** none. That instance time was already billed; only the answer was discarded.

---

### Issue 2 — Transport failures were reported as model failures

`requests.ReadTimeout` and `ConnectionError` fell into a generic `except Exception` and were relabelled `MODEL_INFERENCE_FAILED`. Every investigation was pointed at the wrong service. This is why the fault took so long to locate.

**Solution:** discriminate before the generic handler, in both handlers of `run_v3_pipeline()`:

```python
except requests.exceptions.Timeout:          phoneme_error = 'TIMEOUT'
except requests.exceptions.ConnectionError:  phoneme_error = 'RECOGNIZER_UNREACHABLE'
```

`RECOGNIZER_UNREACHABLE` added to `SERVICE_UNAVAILABLE_REASONS` so it never consumes a learner re-record attempt, plus its own copy string in `version-comparison.js`.

**Verified:** with the recognizer stopped, the envelope now reports `RECOGNIZER_UNREACHABLE` instead of `MODEL_INFERENCE_FAILED`.

---

### Issue 3 — Cloud Run routed traffic into a half-loaded container

The startup probe was `tcpSocket: 8080`. Gunicorn binds the port in under a second, so Cloud Run declared the instance ready and sent the pending request into a container whose model had not loaded. The entire load was paid *inside the learner's request*, outside the window where startup CPU boost applies.

Log evidence: `Default STARTUP TCP probe succeeded after 1 attempt` at 05:23:22, immediately followed by the 51.94 s request.

**Solution:** two halves, both required.

1. Load the model eagerly in `create_app()`, gated by `PHONEME_EAGER_LOAD=1` (set in `Dockerfile.phoneme`; off by default so mocked-backend unit tests keep the lazy path).
2. Replace the probe:

```bash
gcloud run services update phoneme-recognizer --region=us-central1 --project=parselmouth "--startup-probe=httpGet.path=/readyz,initialDelaySeconds=10,periodSeconds=5,failureThreshold=24,timeoutSeconds=5"
```

**Verified in production:** `STARTUP HTTP probe succeeded after 5 attempts … path "/readyz"`, with the model load running 12:37:28 → 12:38:18 during **startup**.

---

### Issue 4 — The image carried ~2.4 GB of unused CUDA payload

`requirements.phoneme-torch.txt` pinned `torch>=2.0,<3.0` with no CPU wheel index. On linux/amd64 pip resolves the **CUDA** build, pulling `nvidia-*` wheels that are dead weight on a CPU-only Cloud Run instance and must be streamed on every cold start.

Measured from the deployed manifest:

```powershell
$tok = gcloud auth print-access-token
$hdr = @{ Authorization = "Bearer $tok"; Accept = "application/vnd.docker.distribution.manifest.v2+json" }
$m = Invoke-RestMethod -Uri "https://us-docker.pkg.dev/v2/parselmouth/gcr.io/phoneme-recognizer/manifests/<tag-or-digest>" -Headers $hdr
($m.layers | Measure-Object -Property size -Sum).Sum / 1MB
```

**Solution:**

```
--extra-index-url https://download.pytorch.org/whl/cpu
torch==2.9.1+cpu
```

**Result: 4,436 MB → 2,001 MB** (pip layer 2,764 → 329 MB). Guarded by `test_torch_pins_the_cpu_wheel_index`.

---

### Issue 5 — Cloud Run traffic was pinned to old revisions (deploy-time trap)

Both services routed 100% of traffic to a specific *tagged* revision (`phoneme-v2v3-candidate`, `pronunciation-v2v3-candidate`). `gcloud run deploy` created new revisions that served **zero** traffic, while printing *"revision [praat-api-00048-tix] has been deployed and is serving 100 percent of traffic"* — the **old** revision name. It is very easy to believe a deploy succeeded when nothing changed.

> ### ⛔ HISTORICAL — DO NOT COPY THIS COMMAND
>
> The fix applied on the day was
> `gcloud run services update-traffic … --to-latest`.
>
> **That command is now forbidden on these services.** It sets
> `latestRevision: true`, which swaps one failure for a worse one: instead of
> deploys silently serving nothing, *every* future deploy takes production
> traffic the moment it is created, with no smoke test. It is recorded here only
> so the incident narrative reads correctly.

**Correct solution:** the zero-traffic tagged rollout in §5 — deploy the
candidate with `--no-traffic --tag=candidate`, smoke-test the candidate URL,
then migrate explicitly with `--to-revisions=<revision>=100`. This is also
Google's recommended flow ([rollouts and traffic
migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)).

**Note:** revision numbering here is **not monotonic** — the new `praat-api` revision was named `00039-kzk` while `00048-tix` was older. Confirm by `metadata.creationTimestamp` and image digest, never by revision number.

---

### Issue 6 — PowerShell mangled comma-separated gcloud flags

An unquoted `--startup-probe=httpGet.path=/readyz,initialDelaySeconds=10,…` is parsed by PowerShell as an **array** and joined with spaces. The deployed probe had a `path` of the literal string `/readyz initialDelaySeconds=10 periodSeconds=5 failureThreshold=24 timeoutSeconds=5`, with default `failureThreshold: 3` / `timeoutSeconds: 1`.

**Solution:** quote the whole flag value as one string. Always re-read the deployed config after setting a compound flag.

**Second variant — logging filters.** The `gcloud.ps1` wrapper re-splits
argument strings, so a `--filter`/positional filter containing bare double
quotes arrives as several arguments and fails with `unrecognized arguments`.
This is why the originally documented 24 h verification command could not run
in this workspace. Escape the quotes before passing:

```powershell
gcloud logging read ($filter -replace '"', '\"') --project=parselmouth --freshness=24h
```

Handled by `Format-GcloudFilter` in `scripts/verify-phoneme-keepalive.ps1`.

---

### Issue 7 — `praat-api`'s own timeouts were missed (caused the first cold test to fail)

The first true cold test after deploying returned **`HTTP 504 in 61.2s`**.

Issue 1's table widened the client and the *recognizer's* budgets but omitted the two budgets on `praat-api` itself — the service the browser calls, and the one that blocks while the recognizer wakes. Both sat at 60 s. Widening every downstream limit is useless while the caller's own worker is killed at 61 s.

| Layer | Was | Now |
|---|---|---|
| `praat-api` gunicorn `--timeout` (`backend/Dockerfile`) | 60 s | 120 s |
| `praat-api` Cloud Run `timeoutSeconds` | 60 s | 120 s |

**Solution + guard:** `V3TimeoutBudgetTest.test_praat_api_worker_outlives_the_v3_wait` asserts the praat-api worker budget exceeds `_V3_HARD_TIMEOUT_SECONDS`, so this layer cannot silently regress.

**Lesson:** enumerate timeout layers end-to-end from the *browser inward*, not from the failing service outward.

---

### Issue 8 — Local recognizer down, and a stale Flask hid the reason

`127.0.0.1:8082` was not running, so Flask started with an empty `PHONEME_SERVICE_URL`. The Flask process (started 08:04:56) also predated the edits that added `ConfigurationError.reason`, so a *configuration* fault surfaced as a *model* fault.

Compounding it, `start_all_servers.bat` polled readiness by **iteration count**. While port 8082 refuses connections `curl` fails instantly, collapsing an advertised 180 s budget into ~30 s of real waiting, then silently starting Flask with no recognizer wiring.

**Solution:**

1. Poll on elapsed wall-clock time derived from `%TIME%`, including the
   midnight rollover guard. Do not increment a synthetic per-iteration timer.
2. Print an unmissable banner naming `RECOGNIZER_CONFIG_MISSING` when V3 is disabled.
3. Add `recognizerConfigured` (presence only, never the URL) to `/health`, so one curl answers "is V3 wired up?".

---

### Issue 9 — `/warm/v3`'s background thread is unreliable on Cloud Run (open)

`POST /warm/v3` returns `202` immediately and wakes the recognizer on a background thread. Cloud Run **throttles CPU the moment a response is sent**, so that thread may be starved before it completes. The endpoint responds correctly in production (202 in 0.5 s), but *whether it actually finishes the warm-up has not been verified*.

**Solution:** do not rely on it. Section 3's scheduled ping hits the recognizer directly and sidesteps the problem entirely. `/warm/v3` is retained as a harmless best-effort supplement; it should not be treated as the warming mechanism until verified.

---

## 3. The keep-alive plan (implemented)

### Why a ping instead of `--min-instances`

Cloud Run request-based billing charges for startup, request processing, and
graceful shutdown. It does not charge the normal active rate for idle time
between requests when no minimum instance is configured. The keep-alive adds
billable requests and any startup/shutdown time caused by those requests; it
does not create a minimum-instance idle charge.

| Approach | Cold starts | Monthly cost |
|---|---|---|
| `--min-instances=1` | avoids most scale-to-zero starts | **~$37** estimated idle charge |
| Scheduled ping | best-effort reduction during active hours | billable usage; estimated below |
| Nothing | one ~41 s wait per idle period | request-driven usage only |

### The job

```bash
gcloud scheduler jobs create http phoneme-recognizer-keepalive --location=us-central1 --project=parselmouth --schedule="*/10 6-23 * * *" --time-zone="Asia/Ho_Chi_Minh" --uri="https://phoneme-recognizer-oq3kyypf4q-uc.a.run.app/readyz" --http-method=GET --oidc-service-account-email=1071929245506-compute@developer.gserviceaccount.com --oidc-token-audience="https://phoneme-recognizer-oq3kyypf4q-uc.a.run.app" --attempt-deadline=120s
```

**Schedule:** every 10 minutes, 06:00–23:50 Vietnam time (`Asia/Ho_Chi_Minh`), 108 pings/day.

Ten minutes, not fifteen: Cloud Run reclaims idle instances at around the 15-minute mark, so a 15-minute interval sits on the line and will periodically lose the race.

`cloudscheduler.googleapis.com` had to be enabled on `parselmouth` first. Auth is OIDC using the compute service account, which already holds `roles/run.invoker` on the recognizer.

### Measured cost

First scheduled fire, 14:10:10 UTC: **`GET /readyz` → 200 in 0.0034 s** (warm).

**Cloud Run bills instance startup and shutdown, not just request processing.**
The first ping after each overnight gap (23:50 → 06:00) starts a cold instance
and has been observed taking **~40 s**. A per-ping 100 ms estimate is therefore
wrong; the daily cold ping dominates the total.

Corrected, per month:

| Component | Instance-seconds |
|---|---|
| 1 cold ping/day × 30 × ~40 s | 1,200 |
| 107 warm pings/day × 30 × 0.1 s (billing minimum) | 321 |
| **Total** | **~1,521 s** |

- = 3,042 vCPU-seconds and 6,084 GiB-seconds (at 2 vCPU / 4 GiB)
- Free tier: 180,000 vCPU-s and 360,000 GiB-s

**≈ 1.7% of the free allowance** — roughly five times the figure first
published, and still comfortably inside it.

**Scenarios.** Cloud Run bills startup, request processing, **and graceful
shutdown**. Shutdown is not measured below and is not included in these
figures — it is a small additional term, and the authoritative number must come
from telemetry, not arithmetic.

| Scenario | Cold starts/day | Instance-seconds/mo | vCPU-s | GiB-s | % of free tier |
|---|---|---|---|---|---|
| Expected (1 daily 06:00 start) | 1 | ~1,521 | 3,042 | 6,084 | ~1.7% |
| Eviction-heavy (9 starts/day, roughly 1 per 2 h in the 18 h window) | 9 | ~11,097 | 22,194 | 44,388 | ~12.3% |

The eviction-heavy row is a planning scenario, not an observed or expected
rate. Earlier six-hour counts came from the superseded verifier that
double-counted Scheduler log rows and did not enforce the selected revision;
they are not evidence. Task L1 replaces them with a fixture-tested measurement.

**Authoritative measurement.** Replace these estimates with the actual
`run.googleapis.com/container/billable_instance_time` metric once the
observation window closes. The installed `gcloud monitoring` command group does
not expose a `time-series list` command; Task L2 therefore queries
`projects.timeSeries.list` through a checked-in PowerShell helper and records
the exact UTC interval and aggregation used.

**Why "$0" is not claimed:**

- The Cloud Run free tier is measured **per billing account**, shared with
  `praat-api`, `parselmouth-backend`, and real learner traffic. The keep-alive's
  share is small, but the pool is not this project's to spend alone.
- Cloud Scheduler is free only while a **billing-account-wide** free job slot
  remains; the 3-job allowance is not per project.
- Evictions add unplanned ~40 s startups, as the eviction-heavy row shows.

The accurate statement is **"no minimum-instance idle charge"** — the
keep-alive adds a small, bounded, measurable load that is very likely to remain
within the free allowance. It is not a guaranteed zero.

### Caveats

- **Best effort, not guaranteed.** Google can still evict an instance under pressure. The consequence is one ~41 s wake-up that now *succeeds* rather than fails.
- **Outside 06:00–23:59 the cold start returns.** A learner practising at 02:00 waits ~41 s. Deliberate: pinging overnight is free but pointless.
- **Free tier is shared** across `praat-api`, `phoneme-recognizer`, and `parselmouth-backend` in the same project. The ping's share is negligible, but the allowance is not per-service.

---

## 4. Final production state

| Path | Before | After |
|---|---|---|
| First recording after idle | ✗ failed at 15 s | ✓ **200 in 41.2 s**, `complete`, 3 syllables, `source: ctc` |
| Subsequent recordings | 1 s | ✓ **2.6–2.7 s** |
| During 06:00–23:59, instance held | — | ~3 s |
| During 06:00–23:59, instance evicted | — | ~41 s, succeeds |
| Minimum-instance idle charge | none | **none** — no `minScale` on either service |
| Billed instance time | request-driven | request-driven + ~1,521 s/mo expected keep-alive estimate; telemetry pending (§3, L2) |

Deployed revisions: `phoneme-recognizer-00004-bbc`, `praat-api-00040-gr4`.
Rollback targets: `phoneme-recognizer-00002-vus`, `praat-api-00048-tix`.

**Traffic policy.** Both services were initially moved to `--to-latest` to
escape the pinned-revision trap of Issue 5. That left `latestRevision: true`,
meaning any future `gcloud run deploy` would take production traffic
immediately, before any smoke test. Corrected 2026-08-03: traffic is now pinned
explicitly to the two verified revisions above. **Future deploys must use the
service-specific Phase R flow in §6, not `--to-latest`.**

---

## 5. Review response (2026-08-03)

An independent review of this plan raised five findings. All five were valid;
two were defects introduced by this work rather than pre-existing.

| # | Finding | Status |
|---|---|---|
| P1 | Production follows `latestRevision` | **Fixed** — traffic pinned to `praat-api-00040-gr4` and `phoneme-recognizer-00004-bbc`; smoke-tested after (HTTP 200, `complete`, 5.1 s) |
| P1 | Deployed source is not reproducible | **Open** — requires a commit; see §6 Phase R |
| P2 | Cold-start elimination not demonstrated | **Fixed** — claim downgraded to best-effort reduction throughout; 24 h observation still pending |
| P2 | Cost estimate omits startup time | **Fixed** — recalculated in §3: ~1.7% expected / ~12.3% eviction-heavy, and "$0" replaced by "no minimum-instance idle charge" |
| P2 | Local launcher does not measure wall-clock | **Fixed** — see below |

### Second review response (2026-08-04)

| # | Finding | Resolution in this revision |
|---|---|---|
| P0 | `--no-allow-unauthenticated` on the API candidate could make the public browser API private | Phase R now preserves API IAM, keeps the recognizer private, and tests the real `/api/admin/status` boundary |
| P1 | A local `gcloud builds submit .` could label dirty source as `HEAD` | R3 creates an exact allowlist; R4 builds only from a detached clean worktree at `SOURCE_SHA` |
| P1 | The recognizer candidate was never promoted and the API candidate could exercise the old recognizer | R6–R9 enforce recognizer candidate → recognizer promotion → API candidate → API promotion |
| P1 | Rollback rehearsal left the old revisions live | R10 requires rollback smoke, recognizer-first re-promotion, API re-promotion, and final smoke |
| P1 | Keep-alive script could false-pass, double-count Scheduler rows, and ignore `-Revision` | R1 repairs the verifier and adds fixture-backed contract tests before it enters the source commit |
| P2 | Cost scenario arithmetic and Monitoring command were invalid | §3 corrects the scenario; L2 uses the Monitoring REST API through a tested helper |
| P2 | Authenticated browser acceptance was underspecified | R3 and R9 require installed Chrome, local Playwright first, protected local credentials, then browser-agent evidence |

### Launcher wall-clock (P2)

The reviewer was right, and the defect was mine. Issue 8's fix replaced an
iteration counter with *a different counter* — `_PHONEME_WAITED+=2` after each
pass — while the comment above it claimed wall-clock measurement. Each pass
costs 2 s (connection refused) to ~7 s (connect 1 s + `--max-time` 5 s +
sleep 2 s), so the advertised 180 s budget could overrun to roughly 10 minutes
against a service whose readiness requests keep timing out.

Now measured from `%TIME%` at loop entry and each pass, with a midnight
rollover guard. The contract test asserts the clock arithmetic is present and
that no fixed per-iteration increment (other than the 86400 rollover constant)
remains.

### Explicit promotion flow (replaces `--to-latest`)

The safe design is zero-traffic immutable candidate → candidate smoke → exact
revision promotion → post-promotion smoke → rollback rehearsal → exact
re-promotion. The two services cannot use one generic command: the recognizer
is private, the API is public, and the recognizer must be promoted first so the
API candidate exercises the new dependency. Section 6 contains the only
executable promotion sequence. Revision numbering is **not monotonic** — verify
by `metadata.creationTimestamp` and image digest, never by revision number.

---

## 6. Phase R — Reproducible release

> ### Execution status — 2026-08-04
>
> **Approved and executed** ("execute if nothing else is needed for revision").
>
> **Process failure to record:** this section was rewritten by review while work
> was in progress. The rewrite was committed in `18b65ed4` **without being
> read**, and a compressed 7-step version was executed from memory instead of
> the 10-step spec below. R3–R10 were completed out of order relative to R1–R2,
> which were meant to gate the commit. Retrofitted afterwards, in
> `docs/plans/…` order:
>
> | Task | State |
> |---|---|
> | R1 verifier repair + fixtures + contract tests | ✅ done (retrofit) — 9 contract tests |
> | R2 release entrypoint + JSON config + contract tests | ✅ done (retrofit) — 11 contract tests |
> | R3 allowlisted source commit | ⚠️ commit `18b65ed4` exists; no `release-source-allowlist.txt` |
> | R4 immutable digests | ✅ recorded |
> | R5 Hosting matches live bytes | ❌ **not done** — Hosting never deployed; needs approval (blast radius includes unrelated in-flight UI work) |
> | R6 recognizer candidate verified at 0% | ⚠️ deployed at 0%, **not** directly smoke-tested (see below) |
> | R7 recognizer promoted | ✅ `phoneme-recognizer-00010-rir` |
> | R8 API candidate verified | ✅ against the promoted recognizer |
> | R9 both at 100% + browser gate | ✅ production E2E passed |
> | R10 rollback + re-promotion + evidence | ⚠️ exercised for `praat-api` only |
>
> **Live release:** commit `18b65ed4`; `praat-api-00057-fiv`
> (`sha256:8d005aea…`), `phoneme-recognizer-00010-rir` (`sha256:dc1f139a…`).
> Both report `deploymentVersion`/`BUILD_SHA` = the release commit.
>
> **Invariants verified after deploy:** `praat-api` public; `phoneme-recognizer`
> private with only the compute SA as invoker; no `minScale` on either; traffic
> pinned to one explicit revision each with no `latestRevision`; rollback
> targets `praat-api-00040-gr4` and `phoneme-recognizer-00004-bbc` intact.
>
> **R6 could not be met as specified.** A private candidate needs an
> audience-scoped ID token. The CLI is authenticated as a *user* account, which
> cannot mint one, and impersonating the invoker SA is denied
> (`iam.serviceAccounts.getAccessToken`). Mitigation: each service was promoted
> separately with end-to-end verification after each, rollback ready. To close
> it, grant `roles/iam.serviceAccountTokenCreator` on the compute SA.
>
> **Two release-time defects found and fixed:**
> 1. `BUILD_SHA`/`GIT_SHA` set as *service-level* env vars **override the
>    image**, so a correct deploy still reported a stale commit. `backend/Dockerfile`
>    now bakes `ARG GIT_SHA` / `ENV BUILD_SHA`, matching `Dockerfile.phoneme`,
>    and `cloudbuild.pronunciation.yaml` passes `--build-arg` (R2).
> 2. Issue 6 struck a third time: an unquoted `--update-env-vars=a=1,b=2` was
>    split by PowerShell so `GIT_SHA` swallowed the whole string. Caught by
>    asserting equality with the SHA, not containment.

**Approval gate:** this section is a plan, not authorization. Do not create a
commit, submit a build, change IAM, deploy a revision, move traffic, or deploy
Hosting until the user explicitly approves Phase R execution.

**Goal:** every production artifact is traceable to one reviewed source commit;
both services retain their existing access boundary; V3 remains shadow-only for
learners; the exact candidate revisions are tested, promoted, rolled back, and
re-promoted; and the final state is captured as durable evidence.

**Required invariants:**

- `praat-api` remains **public** because the browser calls it without a Cloud
  Run identity token. Do not pass `--no-allow-unauthenticated` for this service.
- `phoneme-recognizer` remains **private**. The compute service account retains
  `roles/run.invoker`; tagged-revision ID tokens use the **base service URL** as
  their audience.
- `PRONUNCIATION_V3_MODE=shadow` and
  `public/pronunciation-analyzer/config.js` keeps
  `usePronunciationV3LearnerAnalysis=false`.
- Admin visibility is enforced at `https://betterenglishlearning.com` through
  `/api/admin/status` and the authenticated UI. `/analyze/compare` is not itself
  the admin authorization boundary.
- No command may use `--to-latest`. A traffic entry may contain zero-percent
  tags, but the only percentage-bearing entry must name an explicit revision.
- The previous revisions remain available throughout:
  `phoneme-recognizer-00004-bbc` and `praat-api-00040-gr4`.

**Dependency graph:**

| Task | Depends on | Gate opened |
|---|---|---|
| R1 | none | verifier is safe to commit |
| R2 | none | deployment behavior is codified |
| R3 | R1, R2 | `SOURCE_SHA` exists |
| R4 | R3 | immutable images/digests exist |
| R5 | R3 | committed Hosting source matches live bytes |
| R6 | R4 | recognizer candidate is verified at 0% |
| R7 | R6 | new recognizer serves 100% and is compatible with current API |
| R8 | R7 | API candidate is verified against the new recognizer |
| R9 | R5, R8 | both new revisions serve 100% and browser/safety gates pass |
| R10 | R9 | rollback and re-promotion are proven; release evidence is complete |

### Phase R-A — Make the release source complete and testable

#### R1 — Repair and contract-test the keep-alive verifier

**Files:**

- Modify: `scripts/verify-phoneme-keepalive.ps1`
- Create: `tests/ops/fixtures/phoneme-keepalive-complete.json`
- Create: `tests/ops/fixtures/phoneme-keepalive-query-failure.json`
- Create: `tests/ops/verify-phoneme-keepalive-contract.test.mjs`

**Action:**

1. Add `-StartUtc`, `-EndUtc`, `-FixturePath`, and `-OutputJson` inputs. Preserve
   `-Hours` as a convenience, but convert it into an explicit UTC interval
   before querying.
2. Route all native calls through one helper that captures stdout/stderr,
   checks `$LASTEXITCODE`, and exits non-zero if any required query fails.
3. Add the selected `resource.labels.revision_name` to the instance-start and
   `/readyz` filters. Restrict `/readyz` rows to
   `httpRequest.userAgent="Google-Cloud-Scheduler"`.
4. Count only Cloud Scheduler `AttemptFinished` entries; report their HTTP
   status and treat non-200 or missing finishes as incomplete evidence.
5. Calculate expected cron occurrences from the actual local timestamps in the
   observation interval. Do not use `Hours / 24 * 108` for partial days.
6. Per local date, classify only the **first** `AUTOSCALING` start at or shortly
   after 06:00 as expected. Later starts in the 06:00 hour are unplanned.
7. Separate evidence completeness from the measured eviction rate. Zero
   evictions may be reported, but must not be presented as a guarantee that
   Cloud Run will never evict the instance.

**Verify:**

```powershell
node --test tests/ops/verify-phoneme-keepalive-contract.test.mjs
```

Expected: fixture with five successful Scheduler finishes reports five—not
ten—executions; query failure exits non-zero; an extra 06:30 start is unplanned;
an invalid revision cannot return a green result.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-phoneme-keepalive.ps1 -Hours 1 -Revision phoneme-recognizer-00004-bbc -OutputJson
```

Expected: `scheduler.finished == readyz.schedulerResponses`, zero query errors,
and an explicit `evidenceComplete` boolean. The eviction count is descriptive.

**Done:** the verifier cannot emit complete/green evidence when a query fails,
double-count an execution, or silently read another revision.

#### R2 — Codify service, IAM, Scheduler, and traffic configuration

**Files:**

- Modify: `backend/Dockerfile`
- Modify: `backend/cloudbuild.pronunciation.yaml`
- Modify: `backend/test_pronunciation_packaging.py`
- Create: `scripts/release/pronunciation-v3.ps1`
- Create: `scripts/release/pronunciation-v3.production.json`
- Create: `tests/ops/pronunciation-v3-release-contract.test.mjs`

**Action:** create one PowerShell release entrypoint with `Describe`,
`DeployCandidate`, `Promote`, and `Rollback` actions plus `-WhatIf`. The JSON
configuration must declare:

- `phoneme-recognizer`: private; `/readyz` startup probe with 10 s initial
  delay, 5 s period, 24 failures, 5 s timeout; request timeout 120 s; 2 vCPU;
  4 GiB; `maxScale=2`; no `minScale`.
- `praat-api`: preserve public access; request timeout 120 s; 1 vCPU; 2 GiB;
  `maxScale=3`; no `minScale`; `PRONUNCIATION_V3_MODE=shadow`.
- Scheduler: `*/10 6-23 * * *`, `Asia/Ho_Chi_Minh`, 120 s deadline,
  `1071929245506-compute@developer.gserviceaccount.com`, and the base recognizer
  URL as both URI host and OIDC audience.
- Traffic: explicit revision names only. Reject `latest`, `LATEST`, and
  `--to-latest` before invoking `gcloud`.

`DeployCandidate` must not mutate IAM for either service. The script must first
snapshot and verify the current access mechanisms: public `praat-api`, private
`phoneme-recognizer`, and recognizer invoker binding for the compute service
account. Any IAM repair is a separate explicit action because Cloud Run IAM is
service-wide, not isolated to a candidate revision. In particular, never apply
`--no-allow-unauthenticated` to `praat-api`.

Add `ARG GIT_SHA` / `ENV BUILD_SHA=${GIT_SHA}` to `backend/Dockerfile` and pass
`--build-arg=GIT_SHA=${_GIT_SHA}` from
`backend/cloudbuild.pronunciation.yaml`, matching the recognizer image. A tag
named after a SHA is not enough; `/health` must report the source SHA embedded
in the API image rather than inherit a stale service environment variable.

**Verify:**

```powershell
node --test tests/ops/pronunciation-v3-release-contract.test.mjs
python -m unittest backend.test_pronunciation_packaging
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release/pronunciation-v3.ps1 -Action Describe -WhatIf
```

Expected: contract tests prove both services have explicit promotion and
rollback paths, the recognizer is private, the API remains public, shadow mode
is retained, and no generated command contains `--to-latest`.

**Done:** the intended production state and every mutating command exist in
reviewed files before the source commit is created.

#### R3 — Create the allowlisted source commit

**Files:** create
`docs/audits/pronunciation-v3/2026-08-04/release-source-allowlist.txt` and stage
only the reviewed paths named there. The allowlist must enumerate exact files;
wildcards such as `backend/test_*.py` are forbidden.

The initial candidate inventory to audit is:

```text
backend/Dockerfile
backend/Dockerfile.phoneme
backend/cloudbuild.pronunciation.yaml
backend/local_server/phoneme_client.py
backend/local_server/server.py
backend/local_server/start_all_servers.bat
backend/phoneme_service/app.py
backend/phoneme_service/local_server.py
backend/requirements.phoneme-torch.txt
backend/test_phoneme_client.py
backend/test_phoneme_service.py
backend/test_pronunciation_api_v2.py
backend/test_pronunciation_api_v2_recognizer.py
backend/test_pronunciation_packaging.py
public/pronunciation-analyzer/app.js
public/pronunciation-analyzer/config.js
public/pronunciation-analyzer/praat-api.js
public/pronunciation-analyzer/style.css
public/pronunciation-analyzer/syllable-verifier.js
public/pronunciation-analyzer/verification-attempt-policy.js
public/pronunciation-analyzer/version-comparison.js
scripts/release/pronunciation-v3.ps1
scripts/release/pronunciation-v3.production.json
scripts/verify-phoneme-keepalive.ps1
tests/browser/pronounce-production-verify.js
tests/browser/pronounce-version-comparison-production-auth-check.js
tests/ops/fixtures/phoneme-keepalive-complete.json
tests/ops/fixtures/phoneme-keepalive-query-failure.json
tests/ops/pronunciation-v3-release-contract.test.mjs
tests/ops/verify-phoneme-keepalive-contract.test.mjs
tests/pronunciation-analyzer/local-launcher-contract.test.mjs
tests/pronunciation-analyzer/praat-api-v2.test.mjs
tests/pronunciation-analyzer/syllable-verifier.test.mjs
tests/pronunciation-analyzer/verification-attempt-policy.test.mjs
tests/pronunciation-analyzer/version-comparison-ui-contract.test.mjs
tests/pronunciation-analyzer/version-comparison.test.mjs
docs/plans/2026-08-03-v3-production-issues-and-keepalive-plan.md
docs/audits/pronunciation-v3/2026-08-04/release-source-allowlist.txt
```

`public/pronunciation-analyzer/style.css`, `syllable-verifier.js`, and their
tests contain neighboring pronunciation work. Include them only if hunk review
proves the live V3 release depends on those exact changes. Explicitly exclude
tracked runtime artifacts such as
`backend/local_server/__pycache__/server.cpython-314.pyc`, the anomalous
`backend/local_server/emulators)` path, and every unrelated dirty file.

The review must explicitly include `backend/phoneme_service/local_server.py`.
It is currently untracked, admitted by `.gcloudignore`, and copied into the
recognizer image. Either commit it and its test as intended local-only safety
code, or exclude it from the build context; it may not remain an untracked
input.

**Action:**

1. Review every hunk in the large shared files, especially
   `backend/local_server/server.py` and
   `public/pronunciation-analyzer/app.js`; do not equate a filename allowlist
   with approval of unrelated hunks.
2. Stage only approved files/hunks. Preserve every unrelated dirty or untracked
   user file.
3. Update `tests/browser/pronounce-production-verify.js` to launch installed
   Chrome and add the unauthenticated admin, public API, CORS, shadow-mode, and
   learner-flag assertions. Create
   `tests/browser/pronounce-version-comparison-production-auth-check.js` for the
   credential-backed production flow, but do not execute it before deployment.
4. Run the focused backend, frontend, launcher, release-contract, and verifier
   suites before committing.

**Verify:**

```powershell
git diff --cached --check
git diff --cached --name-only
python -m unittest backend.test_phoneme_client backend.test_phoneme_service backend.test_pronunciation_api_v2 backend.test_pronunciation_api_v2_recognizer backend.test_pronunciation_packaging
node --test tests/pronunciation-analyzer/local-launcher-contract.test.mjs tests/pronunciation-analyzer/praat-api-v2.test.mjs tests/pronunciation-analyzer/version-comparison.test.mjs tests/pronunciation-analyzer/version-comparison-ui-contract.test.mjs tests/pronunciation-analyzer/verification-attempt-policy.test.mjs tests/ops/verify-phoneme-keepalive-contract.test.mjs tests/ops/pronunciation-v3-release-contract.test.mjs
```

Expected: all tests pass; staged paths exactly equal the reviewed allowlist;
`git diff --cached --check` is empty.

**Done:** one source commit:

```powershell
git commit -m "fix: make pronunciation V3 release reproducible"
$sourceSha = git rev-parse HEAD
```

Record the full SHA as `SOURCE_SHA`. Do not push it unless the user separately
asks for a push.

### Phase R-B — Build immutable candidates from the commit

#### R4 — Build in a detached clean worktree and record image digests

**Files read:** `.gcloudignore`, `backend/cloudbuild.phoneme.yaml`, and
`backend/cloudbuild.pronunciation.yaml`. This task must not modify source files.

**Action:** create a detached worktree at `SOURCE_SHA`; do not build from the
dirty development checkout.

```powershell
$sourceSha = git rev-parse HEAD
$shortSha = git rev-parse --short=12 HEAD
$releaseRoot = "C:\Cursor AI-release-pronunciation-v3-$shortSha"
git worktree add --detach $releaseRoot $sourceSha
if (git -C $releaseRoot status --porcelain) { throw 'Release worktree is not clean.' }
Set-Location $releaseRoot
gcloud builds submit --config=backend/cloudbuild.phoneme.yaml --substitutions="_GIT_SHA=$sourceSha" --project=parselmouth .
gcloud builds submit --config=backend/cloudbuild.pronunciation.yaml --substitutions="_GIT_SHA=$sourceSha" --project=parselmouth .
```

Capture each Cloud Build ID, then read `results.images[].digest` from
`gcloud builds describe`. Record full `IMAGE@sha256:DIGEST` values; tags alone
are insufficient.

**Verify:** the detached worktree remains clean after both builds; each build's
source SHA equals `SOURCE_SHA`; **both** images report
`BUILD_SHA=SOURCE_SHA`; both image digests are immutable and distinct from the
rollback images.

**Done:** two immutable image references and two successful Cloud Build IDs are
available for candidate deployment.

#### R5 — Verify committed Hosting source parity

**Files checked:**

- `public/pronunciation-analyzer/app.js`
- `public/pronunciation-analyzer/praat-api.js`
- `public/pronunciation-analyzer/version-comparison.js`
- `public/pronunciation-analyzer/verification-attempt-policy.js`
- `public/pronunciation-analyzer/config.js`

**Action:**

Download the live files from `https://betterenglishlearning.com`, hash the raw
bytes, and compare them with the same files in the clean worktree. Use a unique
cache-busting query and `Cache-Control: no-cache` so a stale browser/service
worker asset is not mistaken for production source. Record both hash sets.

**Verify:** each live SHA-256 equals the clean-worktree SHA-256 and the live
files contain the expected V3 comparison and learner-disabled anchors.

**Done:** every affected live Hosting file matches `SOURCE_SHA`. If any hash
differs, stop Phase R and create a separately approved Hosting preview/release
step; do not silently deploy Hosting as part of the Cloud Run repair.

### Phase R-C — Ordered two-service rollout

#### R6 — Deploy and validate the private recognizer candidate

**Files read:** `scripts/release/pronunciation-v3.ps1` and
`scripts/release/pronunciation-v3.production.json` from the clean worktree.

**Action:**

Use a unique tag such as `release-$shortSha`; never reuse the generic
`candidate` tag.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release/pronunciation-v3.ps1 -Action DeployCandidate -Service phoneme-recognizer -Image 'IMAGE@sha256:DIGEST' -Tag "release-$shortSha"
```

Mint the ID token for the **base** recognizer URL and call the tagged `/readyz`
URL. Verify HTTP 200 after startup, the exact candidate revision name, image
digest, startup probe, timeout, resources, no `minScale`, and unchanged private
IAM.

**Verify:** `gcloud run revisions describe` matches the recorded digest and
configuration; authenticated tagged `/readyz` returns 200; unauthenticated
tagged `/readyz` returns 401/403.

**Done:** the recognizer candidate has passed direct authenticated readiness
and immutable-config checks while serving 0% base traffic.

#### R7 — Promote the recognizer, then prove compatibility with the live API

**Files read:**
`test-results/pronounce-local-samples/photograph-20260803011926909-65561e59.wav`
and its recorded reference `/ˈfoʊtəˌɡræf/`, three expected syllables, variant
`8050cda57bb448e7`.

**Action:**

Promote the exact recognizer candidate revision to 100%. Immediately replay the
recorded `photograph` sample through the still-current `praat-api` base URL.

Expected: HTTP 200 within 80 s, `status: complete`, V2 and V3 available,
`syllable_count: 3`, and `segmentation_source: ctc`. If it fails, route the
recognizer back to `phoneme-recognizer-00004-bbc=100` and stop.

**Verify:** traffic names the exact recognizer revision with no
`latestRevision: true`; the comparison response and Cloud Run logs correlate to
that revision and contain no transport/model availability error.

**Done:** existing production `praat-api` is proven compatible with the new
recognizer revision before the API candidate is deployed.

#### R8 — Deploy and validate the public API candidate

**Files read:** the same release script/config and recorded `photograph` sample
used in R6–R7.

**Action:**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release/pronunciation-v3.ps1 -Action DeployCandidate -Service praat-api -Image 'IMAGE@sha256:DIGEST' -Tag "release-$shortSha"
```

This action must omit both `--no-allow-unauthenticated` and any IAM mutation.
Because the base recognizer now points to the new verified revision, replaying
`photograph` against the tagged API candidate tests the new pair end-to-end.

Required candidate checks:

1. Unauthenticated tagged `/health` returns 200.
2. `pronunciationV3Mode=shadow` and `recognizerConfigured=true`.
3. Exact API image digest, request timeout 120 s, resources, and no `minScale`.
4. CORS permits `https://betterenglishlearning.com`.
5. Recorded comparison returns the same complete V2/V3 contract as R7.

**Verify:** an unauthenticated request reaches the tagged application, the
candidate revision/digest match the release manifest inputs, and the recorded
comparison is served by the tagged API revision while its recognizer call lands
on the newly promoted recognizer revision.

**Done:** the public API candidate passes while serving 0% base traffic and
without changing the established Cloud Run access boundary.

### Phase R-D — Production acceptance and rollback proof

#### R9 — Promote the API and run the Chrome/admin/learner safety gate

**Files:**

- Read: `C:\Cursor AI\.local\browser-test-credentials.md` (never stage)
- Run: `tests/browser/pronounce-version-comparison-browser-check.js`
- Run: `tests/browser/pronounce-production-verify.js`
- Run: `tests/browser/pronounce-version-comparison-production-auth-check.js`
- Record artifacts under: `test-results/pronunciation-v3-release/`

**Action:**

Promote the exact API candidate revision to 100%, then verify both services'
traffic tables contain one percentage-bearing entry at 100% with an explicit
revision name and no `latestRevision: true`.

Browser verification is Chrome-only and uses
`C:\Cursor AI\.local\browser-test-credentials.md` without copying credentials
into logs, scripts, screenshots, commits, or audit documents.

Run in this order:

1. Local deterministic Chrome Playwright contract:
   `node tests/browser/pronounce-version-comparison-browser-check.js`.
2. Production unauthenticated Chrome/API check: run the committed
   `tests/browser/pronounce-production-verify.js` with `channel: 'chrome'`;
   require `/api/admin/status` to return 401/403 while public `praat-api`
   health/CORS remain available.
3. Authenticated production Chrome check in
   `tests/browser/pronounce-version-comparison-production-auth-check.js` using
   the local credential file. Require V2/V3 columns, complete `photograph`
   analysis, enabled Save, `PRONUNCIATION_V3_MODE=shadow`, and
   `usePronunciationV3LearnerAnalysis=false`.
4. Antigravity `browser-agent` confirmation after Playwright, capturing the
   admin comparison screenshot and console/network evidence.

**Verify:** all three Playwright commands exit 0; unauthenticated admin status
is 401/403; authenticated Chrome renders and enables the comparison controls;
browser-agent evidence shows no relevant console/network errors.

**Done:** admin comparison is visible to the authenticated admin, fails closed
for unauthenticated users, the learner path still returns V2-compatible
analysis, and browser evidence names the exact promoted revisions.

#### R10 — Rehearse rollback, re-promote, and record the release

**Action:**

1. Roll back `praat-api` to `praat-api-00040-gr4`, then
   `phoneme-recognizer` to `phoneme-recognizer-00004-bbc`.
2. Run health plus the recorded comparison smoke. If rollback fails, stop and
   keep the last known-good traffic state.
3. Re-promote the new recognizer revision first and rerun the compatibility
   smoke.
4. Re-promote the new API revision second and rerun the full post-promotion
   smoke, including traffic-table assertions.

**Files:** create
`docs/audits/pronunciation-v3/2026-08-04/reproducible-release-manifest.json`
containing `SOURCE_SHA`, build IDs, image digests, candidate URLs, promoted and
rollback revisions, traffic snapshots, configuration hashes, Hosting hashes,
test results, and browser artifact paths. Do not include tokens or credentials.

**Verify:** the evidence manifest's final traffic entries match fresh live
service descriptions; both `/health` and recorded comparison checks pass after
re-promotion; `PRONUNCIATION_V3_MODE=shadow` and learner V3 remains false.

**Done:** the new exact revisions again serve 100%, rollback has been exercised
successfully, the old revisions remain retained, and the evidence manifest is
committed in a follow-up documentation commit. Phase R may then be signed off.

---

## 7. Later work (blocked on successful Phase R)

### L1 — Close the keep-alive observation with the repaired verifier

Run the repaired script against the newly promoted recognizer revision over an
explicit full observation interval:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-phoneme-keepalive.ps1 -Hours 24 -Revision NEW_RECOGNIZER_REVISION -OutputJson
```

Record evidence completeness, successful Scheduler finishes, Scheduler
failures, Scheduler `/readyz` responses, planned daily starts, unplanned starts,
unplanned starts per active hour, median/p95/max latency, and first request
after idle. The result is a measured rate, not a promise of zero future starts.
The earlier six-hour numbers were produced by the superseded counter and are
not release evidence.

### L2 — Replace the cost estimate with Monitoring telemetry

Create `scripts/measure-phoneme-billable-time.ps1` and a fixture-backed contract
test. Query Cloud Monitoring `projects.timeSeries.list` for
`run.googleapis.com/container/billable_instance_time`, the exact recognizer
revision, and the same UTC interval as L1. Record the aggregation and raw
response alongside the computed vCPU-seconds/GiB-seconds; do not use the
non-existent `gcloud monitoring time-series list` command.

### L3 — Resolve `/warm/v3`

Verify whether its background thread completes under request-based CPU
allocation. Remove it if it adds no measurable value, or convert it to a
synchronous bounded request with an explicit latency budget and tests.

### L4 — Right-size recognizer memory

Measure the real production working set under cold load and inference. The
manifest's `peakRssGiB: 0.163` is not a production sizing value, and the service
has already exceeded 1 GiB. Change memory only after measurement and a
zero-traffic candidate test.

### L5 — Evaluate the ONNX engine

`onnxruntime` may load faster and lighter than torch. It must clear the same
current corpus gates (`cleanAccuracy` 0.8474 and `mandatoryWordsCorrect` 5/6),
preserve V3 shadow/admin-only boundaries, and pass the same candidate,
promotion, rollback, and Chrome acceptance flow before `selectedEngine` changes.
