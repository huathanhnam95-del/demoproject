# V3 Production Issues and Keep-Alive Review

**Review date:** 2026-08-03
**Reviewed plan:** [`docs/plans/2026-08-03-v3-production-issues-and-keepalive-plan.md`](../../../plans/2026-08-03-v3-production-issues-and-keepalive-plan.md)
**Review status:** Core runtime fix verified; release process not ready for sign-off

## Scope

This review compared the plan with the current working-tree implementation and the live Cloud Run and Cloud Scheduler configuration. It was review-only; no product files were changed during the review.

## Summary

The V3 runtime path is functioning. Production health reports V3 shadow wiring, a UI-shaped `photograph` comparison returned HTTP 200 with V3 available, three syllables, and `source: ctc`, and authenticated Scheduler `/readyz` requests returned 200.

The deployment and evidence claims are not yet safe to approve. Production currently routes 100 percent to `latestRevision`; the deployed source is not reproducible from the recorded SHAs; the keep-alive result has not completed its required 24-hour verification; and the cost estimate omits startup time.

## Findings

### P1 - Production follows `latestRevision`

The plan recommends `gcloud run services update-traffic ... --to-latest`. Both live services currently have `latestRevision: true` with 100 percent traffic. This means a future revision can become production traffic automatically before it is smoke-tested.

Use an explicit revision promotion flow instead:

1. Build an immutable image from a clean, allowlisted source tree.
2. Deploy the candidate with zero traffic.
3. Smoke-test the candidate revision directly.
4. Route 100 percent explicitly to that verified revision.
5. Retain the prior revision as rollback.

Reference: [Cloud Run rollouts and traffic migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration).

### P1 - The deployed source is not reproducible

The plan records that the changes remain uncommitted. The live `BUILD_SHA` values identify commits that do not contain the timeout, eager-load, and CPU-wheel changes present in the working tree. The startup probe, service timeout, Scheduler job, and traffic policy are also configured imperatively and are not represented by a durable deployment manifest or script.

Commit an allowlisted release, build from that commit, record the immutable image digest and revision, and codify the Cloud Run and Scheduler configuration so the production state can be recreated and audited.

### P2 - Cold-start elimination is not demonstrated

The plan headline and final-state table say the cold start is eliminated during active hours, while the required 24-hour check remains open. Cloud Run documents that idle instances may be shut down at any time, so a ten-minute ping can reduce cold starts but cannot guarantee their absence.

Change the success statement to best-effort reduction until a defined observation window has been completed. Track the measured cold-start rate and the latency of the first request after idle.

Reference: [Cloud Run container runtime contract](https://docs.cloud.google.com/run/docs/container-contract).

### P2 - The cost estimate omits startup time

The estimate treats every ping as a 100 ms request. Live logs already showed a Scheduler `/readyz` request taking approximately 40 seconds when it started the recognizer. The first ping after the overnight gap can incur this startup cost each day. Cloud Run bills instance startup and shutdown time as well as request processing.

The service is likely to remain within the free tier, but the documented `0.36%` figure and unconditional `$0` claim require a calculation that includes startup time and billing-account-wide usage. Cloud Scheduler's three-job free tier is also measured per billing account, not per project.

References: [Cloud Run pricing](https://cloud.google.com/run/pricing) and [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing).

### P2 - The local launcher does not measure wall-clock time

`backend/local_server/start_all_servers.bat` increments `_PHONEME_WAITED` by two seconds after each readiness attempt, but `curl` may consume up to five seconds. A repeatedly timing-out readiness request can therefore exceed the advertised 180-second limit by several minutes.

Use an actual start timestamp and compare elapsed wall-clock time, or make the timeout budget account for the complete curl attempt. Update the contract test to assert the real behavior rather than the counter pattern.

## Verification evidence

- Production `/health` reported `pronunciationV3Mode: shadow` and `recognizerConfigured: true`.
- A production UI-shaped `photograph` comparison returned HTTP 200, `status: complete`, V2 available, V3 available, `syllable_count: 3`, and `segmentation_source: ctc`.
- Scheduler `/readyz` requests returned HTTP 200; a cold request took about 40 seconds and subsequent requests took about 0.003-0.004 seconds.
- Focused Python suite: 100 tests passed.
- Focused Node suite: 9 tests passed.
- Scoped `git diff --check`: passed.
- No production deployment or source changes were made during this review.

## Recommended release gate

Do not mark this work complete until the source is committed and reproducible, live traffic points to an explicitly verified revision, the keep-alive observation is complete, and the cost calculation is corrected. The timeout, eager-load, transport-reason classification, comparison contract, and local launcher tests are otherwise passing.

