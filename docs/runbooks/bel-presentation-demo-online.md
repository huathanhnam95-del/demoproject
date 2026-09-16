# BEL Presentation Demo Online Runbook

Local acceptance evidence was collected September 15-16, 2026. The final self-review, structure/cleanup results and committed-source manifests are outside Git at C:\Users\Admin\.codex\evidence\bel-demo-online\implementation-release-20260915-213625. Production release requires separate explicit authorization.

## Local verification

Use the existing feature checkout. Read C:\Cursor AI\.local\browser-test-credentials.md before a login rehearsal. Do not copy credentials into source or evidence. The orchestrator creates isolated Firebase Auth emulator accounts and deletes its temporary account file after Chrome exits.

~~~powershell
node scripts/bel-demo/verify.mjs
node scripts/bel-demo/verify-online.cjs --unit
node scripts/bel-demo/rehearse-online.cjs --emulators --evidence C:\Users\Admin\.codex\evidence\bel-demo-online\chrome-new-run
node scripts/bel-demo/measure-online.cjs --minutes 30 --evidence C:\Users\Admin\.codex\evidence\bel-demo-online\measurement-new-run
~~~

Use a new external output directory for each run. Start emulator jobs sequentially: port probes are not cross-process reservations. Each orchestrator owns its five emulators, backend processes, temporary configuration and teardown. Preserve unrelated CRM emulators and their logs.

The unit command checks generated core/deck/font parity and all online unit tests. Emulator-only tests explicitly skip without emulator environment variables. The acceptance package's run-durable.cjs starts the emulators, runs firebase-stores.test.cjs plus both rules suites, and tears them down. Rules tests use real emulator ID tokens and anonymous requests against the exact RTDB namespace, proving GET and write denials.

Chrome uses four isolated accounts, real keyboard/click input, and committed-world inspection for geometry-aware walking. No fixture writes advance gameplay. The orchestrator also tests two gateways, notebook readback, primary process loss and surviving-backend archive readback. The measurement runner uses two rooms and eight sockets, records a 30-minute load window, and kills the primary halfway through. Setup/cleanup traffic is recorded separately.

## Runtime and trust boundaries

- RTDB presentationRooms/{roomId} is canonical live state. One owner renews its 15-second lease every five seconds. Only the current owner epoch reduces queued commands and atomically commits state plus receipts. Physics advances in 40 ms steps; snapshots commit on a 100 ms cadence.
- Other gateways enqueue authenticated intentions. Receipts survive owner loss; sequences survive connection replacement. The private inbox is capped at 64 entries, hot state at 64 KiB and public snapshots at 16 KiB. Public snapshots omit private queues, tickets, owner metadata and notebook text.
- RTDB receipt archival precedes hot receipt pruning. Firestore holds durable membership/notebook metadata and periodic runtime projections. Direct client access to the new Firestore collections and private RTDB roots is denied.
- Firebase ID tokens are checked against current account/profile/workforce state and room membership. WSS credentials use the subprotocol. Tickets are hashed, single-use and generation-bound. A valid first ticket must arrive within five seconds; lease acquisition can take longer. Socket authorization refreshes within 55 seconds, with fresh checks for presenter actions.
- Presenter loss does not pause other players. Confirmed disconnect repairs relationships and carried items; valid quick rejoin restores the same seat. Bridge timing survives owner outages longer than three minutes. Offline floor participants receive no new penalty. Normal J pairs require distinct carriers; presenter assistance completes remaining pairs when cooperation is unavailable.
- Server revision, content version and time align native reveals, properties, Determine and ETA. The original prototype and authored assets remain unchanged. Generated online core/deck copies have explicit parity checks.

## Notes, End and retention

A note operation has a stable ID, page version and private staged payload. A small accepted-effect reference attaches atomically to the active RTDB room. Firestore commits the page and receipt transactionally. End first fences the canonical room, drains accepted effects, and produces an immutable archive containing membership, notebook revisions, gameplay/deck and checksum. Storage failures retain retryable pending work.

Archive page documents now use a lossless `v2_` base64url encoding of the tuple `(roomId, uid, pageId)`. The prior colon-joined IDs remain readable because archive reads query the stored `roomId` and `uid` fields. The resolver returns exactly one page per tuple, prefers v2 only when the legacy and v2 semantic payloads are identical, and fails closed on conflicts or duplicate same-version records. New writes never create v1 IDs. A migration copies a verified v1 page to its v2 ID once, can be retried after an interrupted legacy delete without duplicating the write, and removes v1 only after the semantic payload is revalidated; archive checksum, page revision, and authorization metadata remain unchanged.

The notebook stores page selection and drafts under UID/room/page keys, saves after one second of inactivity, and preserves edits made during a save. Conflicts display the saved version and stop autosave until reconciliation. End makes the editor read-only. Participant reads/exports are author-only; the presenter can read participant notes. Presenter PDF scope includes exactly p1-p3 and excludes the presenter's private notebook.

Expiry is 24 hours after meaningful presenter activity. Heartbeats and participant actions do not extend it. Maintenance scans at most 100 expired records using a persisted cursor, retries bounded archive work, and cleans expired tickets/throttles and safely fenced abandoned staging. Completed sessions, notebooks, receipts, export audits and terminal RTDB state have no automatic destructive retention policy. Deletion requires a separately approved checksum/restore-path and retention contract.

PDF export embeds Roboto, wraps unbroken text, and runs in one bounded worker with a four-request queue. It returns a private response without creating a public Storage file. The local maximum-capacity test exported 3 notebooks x 100 pages x 50,000 characters: exactly 15,000,000 characters, 3,535 PDF pages, 23,739,558 bytes, 2.63 seconds and 392,753,152-byte peak process RSS. Extraction found all 300 end markers and Vietnamese text. First and last pages were visually checked. These are local measurements.

## Production configuration to approve

The proposed region is Singapore (asia-southeast1). Verify the actual project, RTDB instance URL/region, least-privilege service identity, private rules/indexes, ingress/load balancer, WSS upgrades, scheduler identity and complete Hosting/API/container manifests before publishing. backend/presentation-demo/service.yaml contains placeholders; it is not a deployable release specification.

Serve CRM and the online page from the canonical authenticated Hosting/API origin. On the API, set PRESENTATION_DEMO_REALTIME_ORIGIN to the exact public HTTPS gateway origin with no path, token, query or fragment. The browser converts it to WSS. On the gateway, set PRESENTATION_DEMO_ALLOWED_ORIGINS to exact permitted browser origins. Production rejects emulator and development-auth settings.

Set PRESENTATION_DEMO_DURABLE_READY=1 only after durable prerequisites are verified. PRESENTATION_DEMO_ONLINE_ENABLED=1 enables entry and the gateway; it defaults off. Keep controls consistent across API, gateways and maintenance:

| Control | Behavior |
| --- | --- |
| PRESENTATION_DEMO_ADMISSION_ENABLED=0 | Blocks create/resume requests; existing members can continue. |
| PRESENTATION_DEMO_MUTATIONS_ENABLED=0 | Blocks joins, tickets, connections, input, heartbeat, note changes and End; freezes authority ticks and preserves stored state. |
| PRESENTATION_DEMO_ARCHIVED_ACCESS_ENABLED=0 | Blocks archive, notebook and PDF reads. Keep enabled for ordinary recovery. |
| PRESENTATION_DEMO_ONLINE_ENABLED=0 | Disables API entry and gateway admission; existing sockets revoke on the next request or authorization refresh. |

The operation controls default enabled when unset; the main online switch defaults off. Mutation recovery is an outage: activity time catches up when resumed. Scheduled terminal/archive reconciliation remains available to preserve accepted work. Never route online room IDs through the legacy local transport.

Cloud Run needs CPU outside requests for leases and ticks during no-socket periods. Initial proposal: instance-based billing, 1 vCPU and at least 1 GiB per instance, two warm instances, maximum four, 3,600-second request timeout. Two warm instances support the failover target; a single warm instance's cold replacement is unmeasured. Confirm concurrency/memory on the production workload before activation.

## Resource and cost record

Singapore prices checked September 15, 2026: instance-based Cloud Run costs $0.0000216/vCPU-second plus $0.0000024/GiB-second. One continuously allocated 1-vCPU/1-GiB instance is $0.0864/hour or $63.07 per 730-hour month; two are $126.14/month before free tiers/discounts. [Cloud Run pricing](https://cloud.google.com/run/pricing).

Firestore costs $0.0369/100,000 reads, $0.1107/100,000 writes and $0.0123/100,000 deletes; storage is $0.000252877/GiB-hour. RTDB download is $1/GB and storage $5/GB-month. [Firestore pricing](https://cloud.google.com/firestore/pricing), [Firebase pricing](https://firebase.google.com/pricing).

The final local run measured 1,800.215 seconds, two rooms and eight clients, including an actual primary-backend shutdown halfway through. It passed with 54,920 measured commands, 140,801 snapshots, zero command failures and zero wire-parser errors. The earlier run with two parser errors is retained as diagnostic evidence and is excluded from final operation-count acceptance.

| Measurement | Final local result |
| --- | --- |
| Command / snapshot-age p95 | 373 ms / 92 ms |
| Normal reconnect / owner failover | 343 ms / 14,054 ms |
| Largest hot room / public snapshot | 17,962 / 6,491 bytes |
| RTDB wire upload / download | 1,359,278,638 / 2,592,588,957 bytes |
| RTDB wire actions | 161,761 gets; 86,429 puts/CAS attempts; 5,924 merges |
| Firestore reads / writes | 2,745 / 668 |
| Firestore transactions / attempts | 668 / 671 |
| Authority transactions / callbacks | 161,244 / 231,520; ratio 1.436, maximum sampled ratio 1.746 |
| Browser socket upload / download | 6,699,200 / 921,562,599 bytes |
| Largest backend RSS / sampled CPU peak | 310,157,312 bytes / 1.051 CPU cores |
| Backend average CPU | Approximately 0.92 cores per process during its observed lifetime |
| Projected cost per room-hour | $2.6804: RTDB $2.5923, Firestore $0.0018, shared warm compute $0.0864 |

The cost projection assumes two simultaneous rooms sharing two continuously warm 1-vCPU/1-GiB instances. The compute floor remains $126.14 per 730-hour month. One vCPU has limited headroom at the observed average CPU load; validate the production CPU limit and concurrency before activation or increasing room count. The maximum PDF workload separately peaked at 392,753,152 bytes RSS.

The authoritative counters and calculation are in soak-30m-final/measurement.json and resource-cost-envelope.json in the evidence directory. Setup/cleanup traffic is excluded from the load-window totals. Emulator TCP includes protocol overhead but excludes production TLS. RTDB action counts are protocol requests, including CAS attempts, rather than billing units. Local CPU and emulator latency do not establish real-network latency or an actual bill. Free tiers, discounts, storage growth, external egress, Hosting/Functions, taxes and other products are separate. Budget approval and representative production-network checks remain release decisions.

## Release and rollback

1. Review the clean commit, exact allowlist, generated hashes, local acceptance report and retained failures. Resolve the operator, budget and infrastructure prerequisites. Obtain explicit authorization for the concrete publication scope.
2. Preserve current Hosting/API/container/rules/index/flag manifests and a verified restore path. If live Hosting contains paths absent from this candidate, preserve its complete manifest and overlay only approved committed blobs. The publisher must set the live Hosting release message to the exact `BEL-RELEASE schema=1 candidate=<40-lowercase-hex> base=<40-lowercase-hex> scope=<64-lowercase-hex> owner=<safe-owner> resources=<comma-separated-scope>` contract produced by `formatReleaseIdentityMessage()`. This message is the fresh provenance anchor for the HTTPS provider; it is not a substitute for the current Hosting, Functions, Cloud Run, rules, index, Realtime and runtime-config reads.
3. The release driver requires a reviewed baseline state, an externally backed schema-versioned lease (`schemaVersion: 1`, `expiryUnit: epoch-seconds`) and an explicit expected post-mutation state for every action. A pending operation cannot be taken over merely because its timestamp expires; the owner heartbeats renewal during long publication. If a mutation may have started and completion is ambiguous or ownership is lost, the lease becomes `state: HOLD`, `operationState: uncertain`, and is retained for explicit reconciliation. No automatic retry or duplicate publish is allowed. Its CLI is read-only; the dry-run adapter cannot publish. Never substitute an observed live state for the reviewed baseline or post-state. Bind the candidate manifest and dependency evidence to the exact full revision plus raw hashes of `functions/package.json`, `functions/package-lock.json`, and the gateway lockfiles; retain install, tree, and audit results outside Git.
4. For Codex’s release verification, use Chrome-only local checks plus the HTTPS read-only deployed-identities provider (`https://listening-tasks-3ae34.web.app/api/release/deployed-identities`, passed as `--deployed-identities-url`) after publication, with a final candidate manifest binding the full 40-character candidate SHA to raw local candidate bytes. The provider token is the local-only `BEL_DEPLOYED_IDENTITIES_TOKEN` environment value and must never be recorded in evidence. A file readback is configuration-only and cannot authorize a live mutation. The provider must return a fresh schema-versioned response containing Hosting version/config, Function revision/source/runtime, Cloud Run revision/image digest/config, Firestore rules/index identities, Realtime identity, runtime-config identity, the release provenance fields and a complete `stateHash`; it must fail closed without current provenance or an authoritative read. The CRM step must load plain `/crm-admin.html`, click More, click the actual `.crm-nav-more-dropdown .crm-dropdown-menu button[data-main="presentation-demo"]` item, wait for `#crm-presentation-demo-workspace`, and open the popup only through `#crm-presentation-demo-open`. At every scenario boundary, reread and validate the complete top-level approval, lease, and current provider state; the provider state must match the complete reviewed `expectedState`, not only a hash. The scenario must exercise the authored Studio A monitor presentation where feasible and label any presenter transition fallback as `presenter-skip-recovery`, reconnect with the same room/scene/slot state, save three Vietnamese participant notes, clear browser-local draft/catalog keys, reread them from the server after reload, end the room, and verify both presenter-participant and participant-own PDFs with extracted text and privacy assertions. Diagnostics are retained separately for each CRM, lobby, and game page. For this release, three participant accounts and physical four-computer acceptance are explicit user-owned post-deployment checks waived from Codex verification; Codex must not claim either scenario passed or create those accounts. Candidate evidence must bind `response.body()` bytes actually served to Chrome to the final manifest/source hash; the live entrance annotation stylesheet is preserved as a 2,951-byte baseline before the candidate's additive rule, and the Chrome gate verifies a 200 `text/css` response plus the loaded `.et-annotation-overlay` and `.et-annotation-capture-layer` rules without suppressing MIME failures. This is pre-publication candidate evidence; post-deployment verification remains a separate gate against the published identity.
5. Publish only approved artifacts/configuration. Verify live hashes, authorization, WSS reconnect, persisted notes, archive/PDF privacy and scheduled expiry metadata before ordinary use. The user owns the waived multiplayer account and physical-device checks and must record their outcome separately after deployment; they are not Codex evidence for this candidate.
6. Stop admission first for recovery. If active mutations are unsafe, disable mutations across API/gateways while retaining compatible private read/export access. Preserve queues, notes, terminal fences and archives.
7. Rollback is a forward recovery from a fresh current-production manifest. Immediately reread Hosting/API/container/rules/index/flag identities and compare them with the reviewed recovery baseline. If an intervening unrelated release is present, stop and rebuild the recovery manifest from that current state plus the approved inverse delta; preserve every unrelated path/hash and publish only the reconciled manifest. `createRollbackManifest()` and its regression test demonstrate that an intervening unrelated file survives while only the approved inverse overlay changes. Never restore a stale whole release.
8. Apply the reconciled inverse delta, retain the current/intervening/recovery manifests, and verify the exact resulting identities before reopening admission. Restore only frozen schema-compatible service/Hosting revisions and keep private rules enforced. Do not delete collections, reuse retired codes or reseed rooms. Recheck live CRM access, reconnect and saved-note export before reopening admission.

Monitor owner churn, snapshot age, transaction retries, reconnect time, stale-generation rejection, note conflicts, accepted-effect backlog, archive failures, export memory/duration and RTDB bandwidth. Configure alerts and budgets only with release-owner approval. The loopback /local-measurements endpoint is test-only and disabled in production.

No merge, push, production deployment or production data mutation is part of this task. Focused CRM lint/read-only regressions are separate from aggregate verify:crm, whose operational checks require production credentials and include backfill paths; this task does not authorize those operations.
