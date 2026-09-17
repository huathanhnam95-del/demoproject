# BEL Working as Equals Online Multiplayer — Production Release Plan

> **For Antigravity:** Load the executing-plans skill for a separately authorized implementation task. C:\Cursor AI\AGENTS.md and this task's explicit boundaries take precedence over generic skill workflows.

**Goal:** Prepare, verify, and safely release the authenticated one-presenter/three-participant BEL demo, then verify production, operate it through an observation window, and retain or retire its worktrees safely.

**Architecture:** Retain Firebase Hosting and Auth in listening-tasks-3ae34. The shared Functions API handles authenticated room/notebook/export requests; a dedicated Cloud Run gateway handles WebSockets and server-owned simulation. RTDB holds canonical live state; Firestore holds membership, notebooks, operations, and archives. Release artifacts must equal current production plus explicitly approved deltas.

**Tech stack:** Node 22, Firebase Auth/Firestore/RTDB, Functions v2, Cloud Run, Artifact Registry, Cloud Scheduler, Chrome/Playwright, existing BEL verification and structure tools.

**ArtifactMetadata**

- Task ID: BEL-RELEASE-PLAN-20260915-213625
- Planning task: 01a0a57f-1062-7282-9f86-5dfdc830a121 — Plan BEL production release completion
- Source task: 01a09a56-d502-76a3-96b9-570d0cc26cd6 — Expand Gamified Demo
- Repair task: 01a0a20c-b6d1-71e3-9bfd-a2e6eff62e8f — Finish BEL notebook reload repair
- Prepared: Tuesday, September 15, 2026, Vietnam Time
- RequestFeedback: true
- Status: Proposed execution plan; **production HOLD**
- Planning owner: Codex root, Astra X High requested, Standard speed
- Route: Light/direct; no subagents
- Authorized in this task: read-only investigation and one new timestamped plan in the main checkout
- Not authorized in this task: implementation, new worktree, source edit, commit, merge, push, deployment, provisioning, IAM change, or live-data write
- Publication approval: **not granted by this document**
- Existing implementation_plan.md and project handoff documents remain untouched.

## 1. Reading conventions and mandatory boundaries

Repository-relative paths below refer to **W = C:\Users\Admin\.codex\worktrees\a08e\Cursor AI**, unless expressly marked **M = C:\Cursor AI**. External evidence is **E = C:\Users\Admin\.codex\evidence\bel-demo-online**. Commands use W as their working directory unless stated otherwise. All future evidence goes into a new timestamped directory beneath E, outside Git.

Placement authority: [project_structure.md](../../agent_docs/project_structure.md). Process authority: [AGENTS.md](../../AGENTS.md). Documentation scope: [docs/AGENTS.md](../AGENTS.md). The earlier feature plan and runbook are inputs, not current deployment instructions:

- W\docs\plans\2026-09-14-bel-demo-online-multiplayer.md
- W\docs\runbooks\bel-presentation-demo-online.md
- M\docs\plans\2026-09-15-191230-release-safety-analysis-and-prevention.md

**Do not create a duplicate worktree.** Reuse W after its current owner releases it. If W becomes busy, wait for ownership; do not create another checkout to bypass that boundary. Frozen source/build directories outside Git are permissible artifacts after preparation is authorized; they must not become another unregistered development checkout.

**Refresh production immediately before every mutating release step.** This includes API enablement, resource creation, IAM bindings, remote builds/uploads, rules publication, Functions deployment, gateway configuration/traffic changes, Hosting version operations and release, feature activation, test-data writes, and recovery. Section 5 defines the required comparison and stop behavior.

Protect all dirty or unfamiliar work. Never reset, stash, clean, overwrite, force-remove, or prune it. No blanket firebase deploy, whole-public upload, all-Functions deployment, broad IAM replacement, or whole-worktree copy is allowed.

Local verification, local commit, merge, push, infrastructure changes, deployment, activation, and live acceptance have distinct receipts and authorization states. None implies the next.

## 2. Rechecked baseline and evidence

### 2.1 Current source and task state

| Item | Rechecked result | Planning consequence |
| --- | --- | --- |
| W candidate | 794a41147b5310e635b7c69a75a524bcfc6bccaf, clean; branch codex/bel-demo-online-implementation-20260914 | Start here; verify again at handoff |
| Candidate parent | 8207cc822ef17d812dd479cf169b19ed0eb1f5ce | The dependency repair is complete, not still running |
| Earlier runtime repair | 96bccd781437ed903999b5d02087623c37a25eff | Older runtime evidence needs file/hash applicability checks |
| Latest dependency follow-up | Seven committed paths, exactly declared, no unexpected paths | This seven-file delta is not the whole release scope |
| Branch delta against recorded remote-main base | 191 changed files, 23,078 insertions, 135 deletions | Audit the whole release candidate, not only its last commit |
| M | d188648e36ef0c505951fdb622536654051adb82, branch feat/projects-subtasks-people, many dirty/untracked paths | Planning destination only; preserve all existing work |
| Remote read | origin/main = 23a11b50a7df3d1ad86a807b8f101e2f099fdb5e; BEL branch not returned by exact ls-remote query | No push or merge is implied; refresh remote before either |
| Repair task | Idle; latest completed turn recommends container build, persisted checks, configuration/IAM and fresh Chrome acceptance | No in-flight repair was observed; still obtain ownership release before writing |
| Older BEL checkout | C:\Users\Admin\.codex\worktrees\bel-prod at 249a8fc86b5a293f82008b0db07c64aeca4ad2bd | Retained reference, not the release candidate |
| Older BEL dirty files | public/prototypes/bel-working-as-equals-demo/world/activity-renderer.mjs, world/scenes.mjs, world/sprites.mjs | Preserve and identify owner/recovery before any retirement |
| Tooling | Default node is 24.12.0; cached Node 22.23.2 exists; docker was not found on PATH | Select Node 22 explicitly; Docker availability/build remains a gate |

The current planning task title has no (D) prefix. Verify the executing task identity/title on resume and remove (D) through the supported title API if necessary.

### 2.2 Production reads performed for this plan

Fresh inventory was captured at **09:41:50 PM Vietnam Time**. The full Hosting refresh completed at **09:44:53 PM Vietnam Time**, September 15, 2026.

| Surface | Fresh observation | Limit |
| --- | --- | --- |
| Project/site | listening-tasks-3ae34; project number 737872673808 | Recheck selected target before every mutation |
| Hosting | Release 1789471509475000; version bc3d35b69e7792df, FINALIZED | Not a future publication baseline |
| Full Hosting map | 54,159 live paths; 75 proposed paths = 2 replacements + 73 additions; 54,232 final paths | Current constructed map, not deployed |
| Preservation | All 54,157 non-BEL paths unchanged; no removals; live CRM shell bases verified | Rebuild if production or approved scope changes |
| API | api-00129-dat, Node 22; immutable source generation 1789442285319127 | Full runtime/configuration and traffic audit still required |
| API source object | gs://gcf-v2-sources-737872673808-us-central1/api/function-source.zip#1789442285319127 | Retained zip hash verified by the local reconciliation verifier |
| API source zip SHA-256 | 774ae1326936c82c60376df91a6ec4f16793c4e6f742435170c1da34d7084950 | A source hash is not configuration equivalence |
| API BEL flags | No PRESENTATION_DEMO_* variables returned | Feature activation not established |
| API runtime identity | 737872673808-compute@developer.gserviceaccount.com | Fresh IAM read confirms roles/editor and roles/iam.serviceAccountTokenCreator |
| Firestore | Default database, asia-southeast1; ruleset ead24c04-f364-430c-94d9-a415ad918941 | Manifest's older named ruleset is stale metadata |
| Fresh Firestore rule source SHA-256 | 1023843cd89d2520685f414bdc22fe39262b9aa081aceb9169db28b47796ca76 | Reconcile actual bytes; do not compare names alone |
| RTDB | Inventory API returned HTTP 403; firebasedatabase.googleapis.com absent from enabled-service listing | Existence is unproven; do not interpret 403 as an empty inventory |
| Proposed gateway | bel-presentation-demo in asia-southeast1 returned HTTP 404 | Check all relevant locations/resources again before creation |
| Proposed maintenance function | presentationDemoMaintenanceRunner in us-central1 returned HTTP 404 | No deployed runner verified |
| Artifact Registry | Singapore repository listing returned no repositories | Recheck before selecting/creating bel |
| Supporting APIs | Artifact Registry, Cloud Build, Scheduler and Run returned enabled | No enablement performed |

Retained API image digest is sha256:44c63704c0b012c1fbd537be9d9d489b17be33f66a0cf2b6217894703a1275da. **This plan did not freshly verify that digest or every serving revision**; Phase 1 must.

### 2.3 Evidence index and disposition

| Evidence beneath E | What to use | Disposition |
| --- | --- | --- |
| release-remediation-followup-20260915-2045 | postcommit-allowlist.json; postcommit-hosting-overlay-binding.json; functions-npm-ci-node22-evidence.json; functions-npm-audit-node22.json; postcommit test logs | Exact 794a41147 dependency and seven-file follow-up evidence |
| audit-8207cc82-20260915-121844 | audit.md, result.json, independent-provenance.json | Historical HOLD: restored live lock installed vulnerable Multer 2.2.0 while local node_modules still had 2.3.0 |
| release-remediation-96bccd78-20260915-181911 | candidate-readiness.json, evidence-manifest.json, immutable source, rules compile, governance and shared-file evidence | Sealed parent remediation; rebind applicable files to final SHA |
| release-prep-96bccd78-20260915-152343 | deployment-manifest.md, owners-and-decisions.md, rollback-manifest.md, sanitized infrastructure inventory | Historical preparation only; commands, counts, identities and broad IAM proposal must not be executed as-is |
| acceptance-8e8d2fd3-20260915 | final-provenance.json, run-durable.cjs, resource-cost-envelope.json, soak-30m-final/measurement.json, Chrome/PDF and failed-run evidence | Earlier local acceptance; not current image or production proof |
| release-plan-20260915-213625 | current-live-identities.json; current-runtime-iam.json; current-live-firestore.rules; current-hosting-version.json; remediation-verification.json; fresh full Hosting/overlay maps | Fresh planning evidence; cloud operations were read-only |
| W\scripts\bel-demo\release-remediation-manifest.json | Exact 75 Hosting paths, API preservation/override hashes, generated pairs and context contract | Source contract; refresh stale production bindings through reviewed changes |

Retained fresh-install evidence reports Multer **2.3.0**, npm ci exit 0, npm ls exit 0, zero high/critical findings, no Multer advisory, and **9 moderate + 2 low** transitive findings. Unfiltered npm audit exits 1; do not label the entire audit clean. Release/remediation tests passed 7/7; route contracts 24/24; data-input multipart/rawBody checks 26/26; other Repeat Sentence/corpus/comparison checks passed.

The latest planning verifier passed under Node 22.23.2. Its context is **317 files / 35,802,542 bytes**, below 50 MB. The earlier 35,802,560-byte figure predates the final package repair. A first attempt under the machine's default Node 24 correctly refused before cloud refresh; that is a tool-selection refusal, not a candidate test failure.

No application/browser/emulator/container campaign was run by this planning task. Retained unit passes with seven emulator skips do not close persisted acceptance.

## 3. Decisions, owners, and approval records

### 3.1 Recommended release decisions

These defaults make the next package concrete. Record user approval and actual owners before dependent actions; do not treat recommendations as authorization.

| Decision | Recommended outcome | Required evidence / stop |
| --- | --- | --- |
| Project and data placement | Keep listening-tasks-3ae34 and existing Singapore Firestore; propose RTDB in asia-southeast1 | Verify existing instance inventory after API availability; wrong/immutable region stops creation |
| Gateway/registry | bel-presentation-demo and Docker repository bel in asia-southeast1 | Exact resource names, image URI, billing approval |
| Shared API | Retain api in us-central1 for this release | No regional migration hidden inside BEL; accept measured cross-region latency/cost |
| Maintenance | Retain candidate's five-minute us-central1 scheduled Function, timeout 300 s, maxInstances 1 | Dedicated runtime and invocation identities; verify memory under bounded archive work |
| Browser ingress | Direct public HTTPS/WSS gateway, application authentication, exact Origin allowlist | Correct the internal-only service.yaml proposal; if organization policy forbids it, HOLD and separately review a load-balancer design |
| Initial gateway capacity | Instance-based CPU allocation; 1 vCPU, 1 GiB, min 2, max 4, concurrency 80, timeout 3600 s | Re-measure actual container load, PDF overlap and failover; do not lower warm replicas without evidence |
| Public browser origin | Canonical betterenglishlearning.com; include .web.app and .firebaseapp.com only as explicitly approved operational origins | Exact HTTPS origins; no wildcard; WSS origin derived from verified service URL |
| Launch scope | One scheduled demo room, one designated admin presenter and three authorized participants; a second room for isolation acceptance | Operational launch scope is not a hard technical room or spending cap |
| Source integration | Prepare/push the feature branch only if authorized; do not merge into main by default | A later requested merge must reconcile with the then-current destination |
| Unrelated Projects UI | Preserve current live board/status/calendar/Timeline behavior; exclude walkthrough-only Gantt/new-calendar rollout | Record that distinction in the release receipt; never copy dirty main UI |
| Retention | Keep notebooks, archives, receipts, export audit and terminal room records; no automatic destructive retention for completed sessions | Name data custodian; obtain separate deletion approval if later required |
| Remaining dependency findings | Enumerate the 11 findings and approve a time-bounded residual-risk disposition if exposure is acceptable | High/critical or unexplained lock drift = HOLD; no bulk dependency upgrade |
| Budget | Proposed BEL incremental monthly envelope USD 200, alerts at 50/80/100%; proposed rehearsal variable-spend allowance USD 15 | User/billing owner must approve or substitute exact amounts before billable work; budgets are alerts, not caps |

Earlier local measurement projected **USD 126.14/month** for two continuously warm 1-vCPU/1-GiB instances and **USD 2.6804 per room-hour** at two-room load, dominated by RTDB transfer. These are retained estimates, not a fresh regional quote or bill. Use the live [Cloud Run pricing page](https://cloud.google.com/run/pricing) with Singapore selected and [Firebase pricing](https://firebase.google.com/pricing) to regenerate the cost sheet. Include Artifact Registry storage/builds, RTDB storage/download, Firestore operations, cross-region/external egress, Functions/Scheduler, logs, Hosting, taxes and idle floor. Avoid double-counting the compute share already included in the room-hour estimate.

### 3.2 Required ownership

| Role | Owner now | Assignment before execution |
| --- | --- | --- |
| Plan author | Current Codex root | Documentation only |
| Implementation/candidate owner | Unassigned pending handoff from repair task | One root working in W; Luna X High at Standard speed for the requested separate implementation handoff; difficult architecture/release audit requires an explicitly assigned qualified reviewer |
| Release approver | User | Approves explicit stages and concrete scope |
| Release operator / sole publisher | Unassigned | One named person or task ID owns every overlapping release mutation |
| IAM / billing owner | Unassigned | Reviews exact grants, identities, costs and resource creation |
| Acceptance owner | Unassigned | Owns Chrome, local emulators, real devices and sanitized results |
| Incident / recovery commander | Unassigned | Authorized to stop admission and apply the sealed recovery procedure |
| Data / evidence custodian | Unassigned | Retention, test-record register, private artifact access and restore verification |
| Existing bel-prod dirty work | Unresolved owner | Identify and preserve before any handoff/removal |

One individual may cover several roles, but no required role may remain anonymous at publication. Do not appoint absent people by inference.

Approval records:

1. **Preparation approval:** this plan, W ownership, precise source/config/test edits and local verification. Local commits require explicit inclusion.
2. **Infrastructure/build approval:** exact project/resources, region, spend, IAM policy delta, remote builder/upload if needed. Local preparation may finish before this.
3. **Source approval:** exact branch/ref and SHA; separate optional merge destination and scope.
4. **Production approval:** exact source/build hashes, complete surface/configuration deltas, activation sequence, designated test-data writes, monitoring destination, recovery actions and operating window.

A single explicit user approval may cover several concrete stages. Do not ask again for a stage already covered. Any material change to scope, cost, permissions, data effects or reviewed candidate requires an updated review.

## 4. Least-privilege identity and configuration contract

### 4.1 Identity design

Create no keys. Use Cloud Run/Functions attached service identities and ADC. Keep deployment/build permissions out of runtime identities.

| Identity (proposed name) | Intended access | Explicit exclusions / proof |
| --- | --- | --- |
| Gateway runtime: bel-presentation-demo | Required Firestore entity transactions/read/write for the configured database; RTDB data operations; Auth user read/revocation checks; logging where needed | No Editor/Owner, project IAM modification, deployment, broad impersonation, or unrelated secret/bucket access |
| Maintenance runtime: bel-presentation-maintenance | Required room/archive/expiry/ticket/operation Firestore and RTDB work | No user administration, unrelated storage/secrets or deployment |
| Shared API replacement runtime: crm-api-runtime | Exact permission union needed by all currently deployed API routes, plus approved BEL operations | Complete shared-API permission inventory and regression evidence before replacing compute identity |
| Scheduler caller | Only invoke presentationDemoMaintenanceRunner with correct OIDC audience | No database access; preserve platform service-agent grants separately |
| Build identity | Read declared build inputs, write only approved image repository and build logs | No runtime database/Auth permissions; no project Editor |
| Publisher | Explicit release privileges for approved resources; actAs only the named runtime identities | No blanket project-wide impersonation or persistent new Owner grant |

Gateway code calls verifyIdToken(token, true) and getUser: database roles alone are insufficient. Include a reviewed Auth read permission such as firebaseauth.users.get via an appropriate custom role or Firebase Authentication Viewer; verify runtime behavior with the selected identity. See [Firebase Auth IAM permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth).

Use database-scoped Firestore grants/conditions where supported. Record the real IAM scope: server SDK access is governed by IAM and bypasses client rules; it is not collection-level isolation. RTDB administrative access may be broader than a path or individual instance under the supported IAM model. Do not claim that client deny rules constrain an Admin SDK identity. See [Firestore server security](https://docs.cloud.google.com/firestore/native/docs/security/iam) and [RTDB administrative access](https://firebase.google.com/docs/database/admin/start).

The older three-role gateway proposal is insufficient as final IAM proof. Determine the minimal supported RTDB data access, test it, and state any database/project-wide residual access for explicit review. Do not silently switch to a new Firebase project or permissive rules to solve an IAM limitation.

Do not revoke Editor or Token Creator from the existing compute account globally: other services may depend on it. First inventory consumers and migrate the BEL-related replacements onto reviewed identities. If the shared API cannot run under its reviewed least-privilege identity, stop the API release; do not quietly retain the broad identity as a waived gate. Unrelated consumer migration remains separately owned work.

### 4.2 Configuration to seal

For each replaced Function and gateway retain both a confidential complete configuration snapshot and a sanitized manifest. Cover service identity, image/source digest, region, CPU/memory/concurrency, min/max instances, timeout, ingress, invokers, traffic, network/VPC settings, environment, secret references/versions, labels, execution environment, probes and scheduler target/audience/retry settings.

The shared API's current environment contains unrelated configuration and secrets. Reconstruct its complete deployed configuration from the approved secret source. Preserve every existing value unless the exact change is approved; hash the private file without printing its contents. Never replace it with a BEL-only dotenv/env-vars file.

Production BEL values:

| Field | Required release value |
| --- | --- |
| NODE_ENV | production for gateway; no development auth |
| FIREBASE_PROJECT_ID / project identity | listening-tasks-3ae34, verified against ADC and database |
| FIREBASE_DATABASE_URL | Exact approved regional instance URL; read from created/selected instance |
| PRESENTATION_DEMO_REALTIME_ORIGIN | Exact public HTTPS gateway origin; no path/query/token/fragment |
| PRESENTATION_DEMO_ALLOWED_ORIGINS | Exact approved Hosting origins |
| PRESENTATION_DEMO_DURABLE_READY | 1 only after real stores/rules/IAM are verified |
| PRESENTATION_DEMO_ONLINE_ENABLED | 0 in disabled rollout; 1 for controlled activation |
| PRESENTATION_DEMO_ADMISSION_ENABLED | Explicit 0 until approved canary create; then 1 |
| PRESENTATION_DEMO_MUTATIONS_ENABLED | Explicit 0 during disabled rollout; 1 only for authorized active test/use |
| PRESENTATION_DEMO_ARCHIVED_ACCESS_ENABLED | 1 for normal operation/recovery unless confidentiality incident demands closure |
| Emulator / developer / metrics settings | Absent from production; test-only /local-measurements disabled |

Operation controls default enabled when unset; never rely on missing variables as a freeze. API flags are captured at startup in places, so changing a file alone is not activation. Deploy and verify the resulting serving revisions.

The gateway's /config currently contains demo-local Firebase values. Production browser entry must use canonical Hosting/API configuration, not the standalone gateway's static UI/config. Include this boundary in smoke tests; fix it under a declared source contract if direct gateway UI is intended.

## 5. One-publisher protocol and freshness gate F

The release operator holds one externally recorded release lease for these overlapping surfaces:

- Hosting site listening-tasks-3ae34 and its shared configuration.
- Functions api and presentationDemoMaintenanceRunner, including their Cloud Run services and scheduler.
- Current Firestore policy/database and approved RTDB instance/rules.
- Shared runtime identity/configuration bindings and the BEL gateway/repository.

Record lease owner/task, acquisition time, expiry/renewal, exact resources, operation currently in flight, expected baseline, approval reference and recovery contact. All overlapping publishers acknowledge serialization. Do not steal an expired lease without checking owner, pending operations and current production.

**F, executed immediately before each mutating command/API call:**

1. Verify current owner/lease, authorization scope, candidate SHA, clean owned files and artifact hashes.
2. Re-read current identities for every affected/shared surface and all dependency identities required by this action: Hosting release/version/config, API source/revisions/traffic/runtime settings, gateway revision/digest/settings, rule release/source, database identity/rules/indexes, IAM etags, relevant resources/APIs, scheduler and remote ref when applicable.
3. Compare with the latest expected-state vector. This vector begins at the reviewed baseline and advances only from successful receipts of this same release.
4. Prove the next result is **current production plus this approved delta**. Compare complete maps/source/configuration, not selected marker strings.
5. On unowned drift, unknown identity, lost lease, missing config, permission failure or artifact mismatch: **stop before writing**. Refresh the complete changed surface, reconcile, rebuild hashes, rerun affected checks and audit; renew approval if its material scope changed.
6. Execute one bounded mutation. Save request scope, operation ID, result/etag/version/revision and timestamp; read back the actual result. Advance expected state only after it matches.
7. If outcome is uncertain, query the operation/resource first. Do not retry non-idempotent creation/publication blindly.

For batched Hosting uploads/populate operations, F checks the production baseline and the owned unreleased candidate version before each mutating request. Full immutable maps can be retained between unchanged identities; rebuild when identities differ. Provider version/etag preconditions are used where available. Cooperative serialization and last-moment reads are necessary where Hosting lacks atomic live-release compare-and-swap; detect an unexpected post-write change and enter recovery immediately.

Live test-data writes use a short, explicitly bounded acceptance transaction/window under the same lease: F before each mutating test scenario, record expected test-record/version changes, and stop its clients on any drift or failed assertion. Background game ticks are application behavior, not individual operator release commands.

No overnight pause preserves freshness. Resume always starts with F.

## 6. Phase 0 — Accept handoff and preserve ownership

**Owner:** implementation root. **Effects:** read-only first; external preservation only after preparation authorization.

**Inputs:** this plan, W, repair task status, complete worktree inventory, before snapshots and current candidate.

1. Recheck repair task with read_thread or a compact wait_threads snapshot; inspect W HEAD, index/status and relevant file hashes. Confirm no writer or test process still owns W.
2. Record a new external task contract: owner/task, branch/base, exact create/modify/delete/rename paths, generated outputs, shared paths, deployment surfaces, protected work and retirement condition. Capture the before snapshot with the structure checker.
3. Preserve the three bel-prod dirty source files and any newly discovered unique work through the owner-approved checkpoint or exact external archive with checksums and a tested restore path. Do not adopt those files into W by assumption.
4. Inventory unique commits, untracked/ignored source and required media, LFS/external artifacts and processes for every BEL-related checkout. Check registration and actual directory existence separately.
5. Record W as the sole candidate checkout. Keep M for documentation/read-only reference.

**Output:** ownership handoff and external preservation manifest.
**Gate G0:** current SHA and scope known, W exclusively available, protected work recoverable.
**Stop:** ambiguous ownership, ongoing writer/test, unexplained source differences or missing unique work. Wait/reconcile; no new worktree.

## 7. Phase 1 — Reconcile source, live state and concrete implementation scope

**Owner:** implementation root; IAM/release owners review their parts.
**Effects:** read-only preparation, then only approved local changes.

### 7.1 Reconstruct the release delta

Use git log/diff and the immutable deployed API source, complete Hosting maps and current rules. Build an exact path/action ledger for the full release, distinguishing:

- Existing live content preserved without change.
- Approved BEL source/generated/browser additions.
- Approved Multer 2.3.0 security override.
- Existing candidate additions to Projects change-feed hints and domain behavior.
- Test/governance/documentation files that must never be uploaded as runtime files unless intentionally part of the declared artifact.

The two newer Projects API behaviors already carried by the candidate must be explicitly listed in final approval or excluded through a reviewed candidate amendment. Their presence in W does not prove they are current production or part of a pure BEL delta.

Download/reconcile the full immutable source bundle for every replaced service; bind object generation, raw zip hash, extracted file map and normalization policy. Inspect API entrypoints, route wiring, package files, generated Read Aloud index and all changes outside the BEL domain. Preserve deployed clean /crm-admin# links.

If a generated Read Aloud canonical/output pair differs, restore declared parity through an approved source change; do not publish the canonical public data file automatically just because it is needed for repository parity.

### 7.2 Starting change allowlist for the next local package

This is a planning boundary, not blanket permission. The next contract must list exact files before editing.

| Responsibility | Exact starting files / source of exact expansion |
| --- | --- |
| Deployment specification, identity bindings and scheduler resource controls | backend/presentation-demo/service.yaml; functions/src/index.js |
| Container reproducibility and copied runtime contents | backend/presentation-demo/Dockerfile; backend/presentation-demo/Dockerfile.dockerignore; both package/lock pairs only if a verified repair needs them |
| Live binding and reviewed delta validation | scripts/bel-demo/release-remediation-manifest.json; scripts/bel-demo/verify-release-remediation.cjs; tests/bel-demo/release-remediation.test.cjs |
| Freshness/serialization release driver, proposed new source | scripts/bel-demo/release-online.cjs; tests/bel-demo/release-online.test.cjs |
| Actual-namespace denial coverage | tests/firestore/presentation-demo-rules.test.cjs; tests/database/presentation-demo-rules.test.cjs; tests/bel-demo-online/firebase-stores.test.cjs |
| Current-policy reconciliation if needed | firestore.rules; database.rules.json; firebase.json only for exact required target/packaging changes |
| Production Chrome harness, proposed new source | tests/browser/bel-demo-online/production_rehearsal.py |
| Runbook updates | docs/runbooks/bel-presentation-demo-online.md |
| Shared CRM entry reconciliation if live changed | public/crm-admin.html; public/crm-admin.js |
| Complete API reconciliation expansion | Enumerate actual paths from deployed source comparison before editing; no functions/** blanket |
| Structure registration | scripts/structure/policy.json only if the new command/output registration actually requires it; human-reviewed exact change |

Prefer the existing driver logic in the historical external hosting-overlay-release.cjs as a reviewed input. It is not ready to execute: it binds an old SHA/version and includes automatic deletion of an unreleased version. The new driver must default to read-only validation, require explicit execution/approval inputs, implement F, protect exact-source/config scopes, and retain failed artifacts for diagnosis. Removal of an owned unreleased version is a separate recorded action.

A meaningful driver test must simulate live drift before version creation, before upload and before release, assert zero subsequent publication, reject wrong SHA/path/config and enforce lease ownership. Do not add tests that merely mirror constants.

**Output:** final local edit contract, baseline vector, path delta ledger, updated deployable specification and freshness driver.
**Gate G1:** every changed path and non-BEL behavior classified; no unexplained deletions or stale shared-file replacement.
**Stop:** unavailable immutable source, unowned delta, ambiguous configuration, incompatible schema or unknown live rule behavior.

## 8. Phase 2 — Clean dependencies and actual container build

**Owner:** candidate/build owner.
**Effects:** local build/install and temporary container work; remote build/upload only under infrastructure/build approval.

1. Use Node 22.23.2 or an explicitly verified supported Node 22 patch and record npm version. Do not use machine-default Node 24.
2. Fresh-install both gateway and Functions production dependencies from exact committed locks in a disposable external build context or the actual container. Do not rely on W's old node_modules.
3. Assert Functions package and lock pin Multer 2.3.0; verify registry integrity, installed version, dependency tree and full production audit. Keep the intended override when reconciling deployed packages.
4. Classify all remaining findings by exposure and owner. Do not run npm audit fix or regenerate the entire lock opportunistically.
5. Build the actual Dockerfile from committed/filtered checkout bytes. Pin or record the resolved Node 22 base-image digest; record source/context manifest, Docker/BuildKit identity, logs, exit code, platform, resulting image digest and SBOM/audit.
6. Validate the actual build context against the allowlist: current expected 317 files and approximately 35.8 MB; no public/database, dependency tree, Git metadata, credentials, private dotenv or undeclared local files.
7. Run the resulting image with production settings and feature disabled. Expect listening on PORT/0.0.0.0, /healthz success, feature routes disabled, no unauthenticated room access and no local-measurements endpoint. A healthy in-memory disabled server is startup evidence only.
8. With a separately isolated demo-emulator environment, run the same image's durable API/WSS/auth/notebook/archive/PDF path. Production-mode rejection of emulator/developer settings must remain intact; use a declared non-production container test configuration for emulator connectivity.
9. Later in Phase 7, validate durable=true and actual identity/database access in a disabled production revision. Do not substitute the local emulator result.

Safe command forms, after verifying the exact input/output variables and tooling:

~~~text
Node22 scripts/bel-demo/verify-online.cjs --unit
Node22 --test tests/bel-demo/release-remediation.test.cjs
npm ci --omit=dev                 [inside each sealed package/build environment]
npm audit --omit=dev --json       [retain full findings and exit status]
npm ls multer --json              [Functions package]
docker build --file backend/presentation-demo/Dockerfile --tag <owned-local-tag> <sealed-context>
docker run <owned-name, loopback port, reviewed environment> <exact-image-digest>
~~~

Node22 is a placeholder for the verified executable, not a new command. Cached planning executable: C:\Users\Admin\AppData\Local\npm-cache\_npx\52027bd8fc0022aa\node_modules\node\bin\node.exe. Recheck existence/version; do not make the cache path a permanent production dependency.

If Docker is unavailable, stop the build gate and select an already authorized Docker-capable host or request the concrete billable Cloud Build operation. Do not silently install Docker, enable APIs, push source or run a remote build. Remote Cloud Build must specify the BEL Dockerfile and narrow staged context; generic source deployment is not equivalent. Run F before submission/upload.

**Output:** fresh-lock dependency report, immutable image and build/smoke evidence.
**Gate G2:** actual image builds and starts; exact locks/image verified; no high/critical findings without an explicit narrow disposition; runtime contents complete.
**Stop:** missing builder, dependency mismatch, startup failure, memory failure, absent PDF/fonts/core modules or secret leakage.

## 9. Phase 3 — Settled-candidate local acceptance

**Owner:** acceptance owner, with one process/emulator owner.
**Effects:** isolated local test data only. No production credentials in test services.

Use the local Playwright webapp-testing workflow and **Chrome only**. Read C:\Cursor AI\.local\browser-test-credentials.md before login planning/execution; never copy its credentials into tracked files or reports. The existing BEL orchestrator derives disposable emulator fixtures; its output is not four physical-device evidence.

### 9.1 Required checks

| Check | Invocation / setup | Passing evidence |
| --- | --- | --- |
| Generated/legacy BEL | Node22 scripts/bel-demo/verify.mjs; Node22 scripts/bel-demo/verify-online.cjs --unit | Core/deck/font parity, actual assertions, source hashes; classify skips |
| Release safety | Remediation tests plus new release-driver tests | Current baseline/approved delta, lock override and drift-stop tests pass |
| BEL persisted stores | Owned startOnlineEmulators from scripts/bel-demo/start-online-emulators.cjs, demo-bel-online only; run tests/bel-demo-online/firebase-stores.test.cjs | All emulator-only cases execute; accepted operations survive restarts |
| Rules | Same owned emulators plus tests/firestore/presentation-demo-rules.test.cjs and tests/database/presentation-demo-rules.test.cjs | Compiled exact candidate policies; real anonymous/authenticated denial results |
| CRM multipart persistence | Dedicated demo-crm-projects Auth/Firestore/Storage, scripts/crm/projects/emulator-process.js and emulator-config.js; then Node22 tests/crm/projects/phase4-recovery-persisted.test.js | CRM_PROJECTS_EMULATOR_READY=1 set only by verified owner; real persisted upload/recovery/authorization/cleanup checks |
| Data-input transaction regression | tests/crm/data-input/emulator-check.cjs under its own reviewed isolated setup; attachment-http/routes and commit checks | Preview no-write, authorized commit/readback, replay, attachment behavior |
| Shared API routes | Existing Repeat Sentence, pronunciation corpus/comparison multipart/rawBody checks and corrected CRM clean-link tests | Fresh-installed Functions tree and exact candidate; no live production fixture mutation |
| Full CRM gate | First inspect Node22 scripts/crm/verify-crm-suite.js --list; then npm run verify:crm only with every effectful check confined to authorized emulators/fixtures | Exit 0 for required safe acceptance; document any unavailable check as HOLD or explicit narrow waiver |
| Structure | npm run test:structure and external contract/snapshot check; committed-tree check against resolved destination/base where applicable | No candidate blockers or unreviewed governance widening |
| Chrome | Node22 scripts/bel-demo/rehearse-online.cjs --emulators --evidence <new-external-dir> | Actual keyboard/click four-account flow, reload, notes and failover |
| Resource rehearsal | Node22 scripts/bel-demo/measure-online.cjs --minutes 30 --evidence <new-external-dir> | Two rooms/eight sockets, actual process loss, no parser/command errors, CPU/memory/traffic measurements |

The aggregate CRM runner contains effectful smoke scripts and scripts/crm/backfill-schedules.js. Do not run it against ambient production configuration. If a constituent cannot be redirected safely, finish the unaffected isolated checks, report the exact unavailable gate, and obtain a narrow disposition before publication. Never remove assertions or label focused checks as full-suite acceptance.

BEL and CRM Projects emulator projects/configurations differ; their flags are not interchangeable. Start campaigns sequentially, preserve unrelated emulators and reserve owned ports/processes. Retain failures and ensure owned teardown releases ports. The retained external run-durable.cjs is a useful adapter example, not an assumed supported command; review/copy it into new external evidence or register an equivalent exact test runner.

### 9.2 Security, recovery and content assertions

- Exercise all nine COLLECTIONS values in functions/src/crm/presentation-demo/firebase-stores.cjs: presentationDemoRooms, presentationDemoRoomCodes, presentationDemoPresenterLocks, presentationDemoTickets, presentationDemoOperations, presentationDemoNotebooks, presentationDemoNotebookPages, presentationDemoArchives, presentationDemoArchivePages.
- Deny direct anonymous and authenticated client GET/write against those collections and RTDB presentationRooms, presentationReceipts and presentationRoomOutbox. Retain current legacy crmPresentation* denies and unrelated policies. Test fallback deny with real requests; six static legacy markers are insufficient.
- RTDB Firebase client ID tokens use the proper REST auth mechanism in emulator checks; an Admin-style Bearer request can bypass rules and invalidate the test.
- Verify current-account/disabled/revoked/demoted handling, presenter-only create/End/deck authority, fifth-player capacity, outsider/wrong-room privacy, single-use ticket replay, origin rejection and stale connection generation.
- Verify concurrent join/create/End/expiry, owner-epoch fencing, queued-command receipts, accepted-note replay, delayed saves, reload/page selection, conflict preservation and pending PDF readiness.
- End must fence, drain accepted effects and materialize immutable archives. Retry must neither lose notes nor duplicate accepted operations.
- Exercise normal game progression and activities, including the latest sprite fixes, bridge outage/recovery, J assistance policy, native reveals, Determine and ETA. Preserve the approved visual/content contract.
- Participant PDFs contain only that participant's notebook. Presenter export contains exactly p1–p3 and excludes the presenter's private notebook. Validate Vietnamese text, wrapping, page counts and private response headers.
- Use emulator fake time for 24-hour inactivity and terminal races. Production will verify stored deadline/configuration without fast-forwarding clocks or mass-editing records.

Adopt the earlier proposed performance gates unless explicitly revised with evidence: p95 command commit <=500 ms, p95 snapshot age <=500 ms, ordinary reconnect <=5 seconds after transport/auth recovery, owner failover <=20 seconds, no sustained retry storm. Retained 30-minute results (373 ms / 92 ms / 343 ms / 14.054 s) are historical local measurements.

One vCPU previously averaged about 0.92 cores per backend under two-room load; test the actual container with overlapping PDF work. Do not infer memory adequacy from a standalone PDF test or infer multi-instance distribution from minInstances=2.

**Output:** SHA/image-bound acceptance report, failed/pass artifacts, cost/resource sheet and cleanup receipt.
**Gate G3:** all required local assertions pass with no unexplained skips; exact-candidate persisted checks run.
**Stop:** any privacy/integrity/fencing failure, missing test environment, weakened assertion or unacceptable latency/resource envelope.

## 10. Phase 4 — Seal surface artifacts and recovery package

**Owner:** release operator; candidate owner prepares.
**Effects:** local artifact creation only until explicit remote approval.

### 10.1 Hosting

Use scripts/bel-demo/release-remediation-manifest.json's exact candidatePaths as the starting **75-path** allowlist. Preserve every current live path/hash/configuration, replacing only approved entries. Reconcile crm-admin.html and crm-admin.js against fresh live bytes; remove BEL additions to verify the remaining shell equals its live base.

Extract exact source bytes using committed checkout filters, as in git cat-file --filters --path=<path> <SHA>:<path>. Record source blob identity, filtered raw SHA-256, gzip level-9 hash and served path. Do not mix normalized hashes with upload hashes.

Current map: 54,159 -> 54,232 files, 2 replacements, 73 additions, 54,157 preserved. These counts are observations, not constants to force onto a changed production version.

Clone/materialize the complete current-live Hosting version/configuration and overlay approved blobs. Preserve cleanUrls, headers, rewrites and unrelated cache settings. Existing live /api/** rewrite points to Cloud Run api in us-central1; do not replace it wholesale with stale firebase.json. No Hosting configuration change is needed for direct WSS beyond any separately proven CSP requirement.

Retain all required clone/map operations, upload requests and final version identity. Never deploy W\public or M\public as a whole. Never delete a live-only path to make the manifest fit.

### 10.2 Functions/API and gateway

Seal the **complete** Functions source package and runtime configuration for api, and the complete package/configuration for the new maintenance function. Reconcile deployed source, approved BEL additions, explicit security override and approved newer shared behaviors. Record every file not in deployed source and every deletion.

Use only explicit Functions selectors api and presentationDemoMaintenanceRunner; no incidental export deletion/update or all-functions deployment. A selector limits deployed functions, not the amount of source/configuration replaced inside api.

Seal gateway image by digest, not a mutable tag. Include its runtime spec, service identity, exact DB/origins, probes, flags, traffic and resource limits. Record how Firebase function discovery and predeploy hooks run and exclude unrelated generators/effectful hooks from the release path through a reviewed configuration.

### 10.3 Policies and data

Re-read current Firestore source and merge only approved BEL denial changes. Current manifest ruleset name is older than production; refresh its metadata and compile/test the resulting exact bytes. Preserve Entrance Test DemoD annotations and every unrelated rule.

If RTDB is new, initialize the exact deny-by-default policy before use. If an instance exists, compare its complete current policy and preserve unrelated access contracts. Do not apply root .read/.write=false over an unexamined shared instance.

No Firestore indexes, field overrides, Storage rules, migrations or bulk data writes are in default scope. Inspect query requirements and deployed index state. If a required index is missing, produce a separate exact reviewed additive index delta, wait for READY and rerun affected acceptance; never deploy the candidate's whole index file.

### 10.4 Package contents

Produce one signed-off/sanitized release manifest with:

- Source commit/branch/base and complete path/action allowlist.
- Hosting raw/gzip maps, configuration hash and prior live identity.
- API source generation/archive/file hashes, current and proposed runtime configuration hashes, secret version references and serving traffic.
- Gateway build/base/image digest, SBOM/dependency report and actual smoke result.
- Firestore/RTDB rule source hashes, release identities and compile/denial evidence.
- Resource/IAM/scheduler delta, cost sheet, owners, approvals and F expected-state vector.
- Test command/exit/assertion counts, skips/failures and exact candidate/image binding.
- Recovery artifacts for every surface, existing data compatibility and restore instructions.
- Confidential restore package location/owner/checksums; no secret values in shared manifests.

**Gate G4:** exact artifacts and recovery are reproducible; full current-production preservation proven.
**Stop:** missing bytes/configuration/secret source, unresolved non-BEL delta, unreproducible filters or missing rollback data compatibility.

## 11. Phase 5 — Final audit, approval and source state

**Owner:** root release auditor and user approver. Light route stays direct. A separate read-only audit task may be requested; do not spawn it automatically.

1. Audit the actual final code, image, assertions, complete surface differences and recovery package at the exact SHA. Use Astra High/X High for the difficult distributed-state/release checkpoint through supported settings.
2. Require G0–G4 plus owner/IAM/cost/retention decisions. Any unresolved P0/P1, material privacy/integrity risk or mandatory failed check holds publication.
3. Present one concrete review package for source push, infrastructure and production scope. If a remote build is needed before the final audit, obtain its narrower build authorization first, then finish the package.
4. If local commit is authorized, commit only declared source/test/config/doc changes in W. Recheck the full candidate and bind any applicable prior test evidence by exact unchanged hashes.
5. If push is authorized, run F and re-read remote refs; push the exact candidate SHA to the approved feature ref without force. Verify remote SHA receipt.
6. Do not merge main by default. If later authorized, refresh the actual destination tip, reconcile the exact feature delta there using W or a compatible existing destination checkout after ownership transfer. Review all shared/config/generated/lock files. Do not switch or overwrite dirty M. Rerun affected acceptance on the merge candidate; never claim a feature-branch test proves the merge.
7. If destination reconciliation cannot be performed safely with existing checkouts, stop for ownership resolution. This plan prohibits creating another worktree.

**Output:** audit verdict, exact approvals, optional commit/push/merge receipts.
**Gate G5:** publication candidate, authorization and source provenance agree.
**Stop:** approval applies to a different SHA/artifact, remote drift, ambiguous destination or unpreserved work.

## 12. Phase 6 — Approved infrastructure and identity preparation

**Owner:** sole publisher, IAM/billing owners.
**Effects:** billable/control-plane mutations, only after approval. **Run F before each action.**

Order:

1. Resolve API access for inventory. If RTDB API enablement is approved and necessary, enable only it, wait for completion, then inventory instances again. A newly visible existing instance must be reconciled before creating anything.
2. Create/select the approved Singapore RTDB instance and verify identity, URL and region. Immediately apply the reviewed private rules before application use.
3. Create/select the approved Singapore Artifact Registry repository. Configure reviewed retention/cleanup policy only if included in approval; retain current/previous release digests.
4. Create named runtime/build/scheduler identities and apply exact reviewed IAM bindings with current etags. Re-read policy and prove no unrelated binding removal. Test positive required access and negative unrelated access where meaningful; emulator success does not prove cloud IAM.
5. Submit any approved remote build or upload the previously verified image. Verify registry digest matches the built artifact; preserve source/build provenance.
6. Prepare monitoring and budget notifications only to approved destinations, with named operator. Do not send test messages to people without explicit approval.

Do not run the old release-prep commands verbatim. Use gcloud/Firebase purpose-built commands or APIs with explicit project/region/resource selectors; inspect current help/schema, concrete arguments and expected effects before execution.

**Output:** resource identities, IAM/budget receipts, registry image digest and updated expected-state vector.
**Gate G6:** infrastructure exists in approved locations, required identities work, no broad runtime role substitution.
**Stop:** unapproved cost, name/region collision, IAM drift, missing access, unexpected resource or unsupported policy scope.

## 13. Phase 7 — Disabled server rollout, policies and Hosting overlay

**Owner:** sole publisher. **Run F before every mutation and after each operation read back state.**

1. Publish the compiled live-preserving Firestore policy and the exact RTDB policy as separate bounded operations. Verify identity/source hashes and production direct-client read denials using designated scopes; mutating denial probes require explicit test scope.
2. Deploy the gateway image by digest with online=0, admission=0, mutations=0, archived-access=1, correct identities/DB/origins and approved capacity/ingress. Set durable=1 only after its real store prerequisites are ready.
3. Check production gateway /healthz indicates durable=true and the exact revision/digest. Confirm feature-disabled behavior, invalid-token/origin denial, no development-auth bypass, no test metrics and correct container lifecycle.
4. Publish only the reconciled api and presentationDemoMaintenanceRunner with BEL disabled and complete preserved configuration. Verify underlying revisions, source/image identities, traffic, secret references and service accounts.
5. Verify scheduler target, region, five-minute cadence, OIDC caller/audience, timeout/retry and no public invocation. With online=0 it must not perform BEL maintenance. Do not run destructive “expiry tests” on real records.
6. Smoke shared API/CRM auth, Projects links/board/calendar, Entrance Test annotations and affected upload routes in approved test scope. Stop on regressions before publishing the launcher.
7. Run F again; construct the Hosting version from exact current live configuration/map and approved overlay. Populate/upload only required hashes, finalize, recheck live baseline and lease immediately before release, then publish that version.
8. Read back full resulting map/configuration and affected assets from canonical and approved alternate origins. Verify content types, no stale SPA fallback for modules, shared shell preservation and unchanged unrelated paths.

At this stage the files and servers may be deployed while the demo remains disabled. Report that state accurately; do not mark the release accepted.

**Output:** disabled deployed identities and complete preservation/health receipt.
**Gate G7:** every surface matches its sealed artifact and shared workflows pass.
**Stop:** any drift, wrong target, unexpected file/function/config removal, auth/rules failure, startup error or shared regression.

## 14. Phase 8 — Controlled activation and live four-player Chrome acceptance

**Owner:** publisher + acceptance owner; incident commander available.
**Effects:** approved configuration changes and exact test-room records only.

### 14.1 Prerequisites and activation

Read the credentials file again. Obtain three distinct authorized participant CRM accounts and one fifth eligible negative-control account through a private fixture file or user-supplied accounts. Four tabs sharing one UID are insufficient. Production account creation, role changes, disabling or demotion require explicit scope; local emulator variants cover those attacks otherwise.

Use four independent Chrome clients across physical computers for final live acceptance. If devices are unavailable, retain isolated-context results as intermediate evidence and keep the real-device gate open. The existing rehearsal.py contains emulator-oriented setup and direct sign-in; do not point it at production unchanged. The proposed production_rehearsal.py must use approved account fixtures and the normal CRM launch, with no emulator seeding, debug authority hooks, forced gameplay writes or production cleanup.

Activation sequence under F:

1. Gateway and maintenance online=1, durable=1; keep admission=0 and mutations=0 while checking compatibility. No existing online rooms are assumed; inventory them first.
2. API online=1 with admission=0/mutations=0 and the exact gateway origin; verify canonical config/launcher sees the feature and create remains closed.
3. During the approved acceptance window, enable mutations consistently across required services, then admission. Verify resulting serving revisions and effective flags. Because there is no proven per-test-account activation gate, treat this as a real live opening; a quiet time window alone does not technically restrict users.
4. Create only the designated canary room; record its UID pseudonyms, room ID, creation operation and retention owner. After its four seats are established, admission can be disabled to prevent additional create/resume calls while the accepted room continues; verify exact switch semantics.

### 14.2 Mandatory live scenario matrix

| Scenario | Required observation |
| --- | --- |
| CRM access | Admin logs in through documented account, opens More > Presentation Demo; participants use authorized access; unrelated CRM panels retain their guards |
| Room join | Presenter creates one room/code; p1–p3 join; fifth account denied capacity; no seat reassignment or duplicate UID |
| Cross-device authority | All four move/interact and see one committed world; presenter-only deck/reveal actions; correct native content, sprites, Determine and ETA |
| Actual network recovery | Disconnect/reconnect one participant and presenter; stable seats, no lost accepted action, no duplicate notes; other players remain usable |
| Cross-instance recovery | Record which gateway instance/owner epoch serves the room; prove real handoff with an explicitly approved bounded gateway interruption/rollout while all shared services remain protected |
| Finite WSS lifetime | Run through a real connection lifetime boundary, including at least one 3600-second Cloud Run timeout/reconnect for the canary, or retain this as an unmet gate | 
| Notes | Save unique synthetic Vietnamese text per participant, wait for acknowledged save, reload/reconnect and read back exact content/version from authoritative storage |
| Privacy | Participants cannot read/export another notebook; outsider bootstrap/room enumeration fails generically; unauthenticated/invalid-origin/ticket-replay actions rejected |
| End/archive | Presenter End fences live mutations, accepted notes survive, archive completes, retry is idempotent; membership and notebook revisions agree with readback |
| PDF | Participant export contains own notes only; presenter export includes exactly p1–p3; Vietnamese renders; expected text/page scope and private headers verified |
| Expiry/maintenance | Stored expiresAt = meaningful presenter activity +24 h; heartbeat does not extend it; deployed scheduler identity/configuration and authorized empty/non-destructive run verified |
| Shared regressions | CRM login/cold bootstrap; current Projects board/status/links/calendar/Timeline; Entrance Test DemoD annotations; affected upload flows and a representative shared API health route |
| Production state | Final Hosting/API/gateway/rules/IAM/scheduler identities still match expected state; no unexpected writes outside canary register |

Cloud Run WebSockets have finite request timeouts and reconnections can reach a different instance; session affinity is not a correctness guarantee. See [Cloud Run WebSocket guidance](https://docs.cloud.google.com/run/docs/triggering/websockets). Direct browser access requires compatible ingress; see [Cloud Run ingress](https://docs.cloud.google.com/run/docs/securing/ingress).

Performance targets remain p95 command/snapshot <=500 ms, reconnect <=5 s and owner failover <=20 s on the representative production network. Use sanitized correlation IDs, server revisions and aggregate timings; do not record tokens, private notes or ticket subprotocols in shared traces.

After Playwright, use the browser-agent workflow for live interactive confirmation/richer capture when available and authorized by the selected route. Do not silently spawn a browser subagent in Light mode. Supported direct browser tools or an acceptance operator can supply the second live confirmation; record the actual method.

**Output:** production Chrome report, screenshots/traces with redaction, room/operation/readback ledger, PDFs with hashes, deployed identities and measured latency.
**Gate G8:** all mandatory scenarios pass on the deployed package; no unexplained skipped physical-device/recovery boundary.
**Stop:** first integrity/privacy/shared-regression assertion failure closes admission immediately; freeze mutations if unsafe, preserve data/evidence and invoke Section 16. No ordinary users admitted until acceptance clears.

## 15. Phase 9 — Observation, failure analysis and operating handoff

**Owner:** operations/incident commander and data custodian.
**Effects:** approved monitoring and bounded operational recovery only.

Maintain active observation through the live rehearsal and at least the next 24 hours before declaring operational closure. A separate scheduled follow-up/automation is created only when explicitly authorized; this plan does not create one.

Proposed alerts, to be approved and sealed:

- Snapshot age >2 s for 1 minute or repeat owner churn >3 changes/room in 5 minutes.
- Archive/accepted-effect backlog >5 minutes or any confirmed lost/duplicated accepted operation.
- Unexpected authorization success/privacy leak: immediate incident.
- Export memory pressure, gateway/API 5xx, reconnect/failover beyond accepted thresholds.
- RTDB transfer materially exceeds the measured envelope; budget alerts at approved thresholds.

Track room count, RTDB bytes, Firestore reads/writes/retries, memory/CPU, request errors, reconnect timing, archive/export durations and actual billing lag. Maximum instances and budget alerts are not hard spending controls. Stop new admission when limits are exceeded; preserve existing rooms before freezing.

For any post-release failure:

1. Record detection time, affected workflows/accounts (pseudonyms), release identities, request/operation IDs and user-visible symptom.
2. Take sanitized logs and authoritative readback before retry/recovery; preserve accepted-note queues, receipts, archive revisions, failed builds and Chrome evidence.
3. Determine whether the cause is artifact drift, config/identity/secret mismatch, cloud network/region latency, rules/indexes, dependency install, owner fencing or UI/cache behavior.
4. Reproduce with the exact image/source/config in the isolated environment. Do not diagnose by editing production data.
5. Assign one owner, specify the bounded fix and verify the failed assertion plus affected shared regressions.
6. Build a new current-production-plus-fix package, rerun F/audit and obtain any changed authorization before publishing.
7. Write the incident's cause, detection gap, recovery receipts and prevention test into retained evidence/runbook scope. Mark unresolved claims explicitly.

**Output:** 24-hour observation report, cost review, incident dispositions and named operating/data owners.
**Gate G9:** no unresolved release-blocking failures; all accepted work recoverable; monitoring and support ownership handed over.

## 16. Recovery and rollback — preserve later production and all accepted data

The incident commander owns recovery decisions. The initial production approval should explicitly authorize these concrete stop/recovery actions. Otherwise obtain the missing authority before a dependent mutation. **F applies to every recovery step.**

### 16.1 First response

- Stop admission on the current complete API/gateway configuration, preserving unrelated values. This blocks create/resume, not all existing-room writes.
- If data integrity is at risk, set mutations=0 across API and gateway; verify actual revisions and wait/confirm socket authorization refresh or disconnect. Account for already accepted pending work.
- Keep archived-access=1 for ordinary recovery. For a confidentiality incident, close archived access too.
- Avoid online=0 on maintenance if accepted-effect/archive reconciliation is needed: its current scheduled handler returns immediately when online=0. Choose coherent controls and verify the runner actually drains safe work.
- Freeze is an outage, not a game-time pause; persisted deadlines may catch up on resume. Never rewrite timestamps to conceal the outage.

### 16.2 Surface-specific recovery

| Surface | Safe rollback / forward recovery |
| --- | --- |
| Hosting | Read current live map/config. Remove or reverse only this release's owned delta, overlaying prior approved blobs onto that current map. Remove a newly added path only when it is still owned/unmodified by a later release and removal is approved. Preserve all later unrelated releases. |
| Shared API | Restore a schema-compatible reviewed implementation/configuration only after reconciling it with current deployed source/config and later releases. Prefer a forward BEL disable/fix if an old API lacks new room/archive contracts. Never route shared api traffic blindly to an old revision. |
| Gateway | Route/deploy an approved compatible image/configuration by digest; fence/drain old owners and verify epochs/reconnect. Preserve later unrelated configuration and dedicated identity. |
| Firestore/RTDB rules | Keep BEL data private. Merge only the safe inverse delta onto current rules, compile/test, publish and read back. Never restore a broad old ruleset that removes later unrelated protections. |
| IAM | Re-read current policy/etag. Revert only this release's exact binding changes when safe for current consumers. Do not restore project Editor as a convenient fix. |
| Scheduler | Preserve accepted terminal work; disable/reschedule only the owned runner when necessary. Keep current target/identity changes made by other releases. |
| Data | No bulk delete, room reseed, code reuse, archive overwrite or notebook truncation. Preserve terminal fences, queued effects, receipts and member scopes. Restore only through separately authorized, checksummed, idempotent repair. |
| New infrastructure | Leave disabled resources retained during investigation. Deletion is separately approved after proving no stored data, referenced image, process or later release depends on them. |

If production has changed since the rollback package was created, stop and construct **current production plus the approved inverse/fix**. A retained prior version is recovery input, not permission to replace the entire current system.

### 16.3 Recovery exit gate

Verify fresh identities, current full maps/configuration, shared CRM/API access, privacy denials, accepted-note readback, archive/PDF and reconnect/fencing before reopening admission. Record lost/duplicate operation count explicitly; unknown is a failed gate. Retain incident evidence and require renewed acceptance on the recovered candidate.

## 17. Phase 10 — Safe integration, evidence retention and worktree retirement

**Owner:** source owner + evidence custodian; incident commander releases retention hold.

1. Record separate final states: source committed, pushed, merged (if authorized), deployed, activated, live accepted, observed and operationally handed over.
2. Preserve exact source commits, external artifacts, image digests, approval and recovery receipts in reachable refs/storage. Verify restoration of unique source and the evidence manifest.
3. Integrate into the current approved destination only if authorized and using the reconciliation process in Phase 5. Do not retire W while its work exists only as unreferenced commits or missing ignored assets.
4. Inspect W and bel-prod independently: tracked/index/untracked/ignored source, unique commits, media, active processes/working directories, test ports and evidence references.
5. bel-prod's three dirty world files are a hard retention condition until their owner integrates or recoverably archives them and intentionally resolves the dirty state. This plan does not discard them.
6. Retire W only when integrated or recoverably archived, clean, no process depends on it, commits remain reachable and no incident requires it. Use non-force git worktree remove on the verified exact absolute path.
7. Never use recursive shell deletion, git clean/reset/stash, forced removal, or blanket git worktree prune. Stale registrations require an exact separate safe-cleanup record.
8. Record before/after worktree registration, retained refs/evidence paths, hashes and restore instructions. Flag more than three BEL checkouts or combined size above 20 GiB for review; do not delete to satisfy the threshold.
9. After approved deployment and verified task identity, use the supported Codex title API to add (D). Remove it immediately on resumed development/audit. Do not run the no-ID session_tagger.py helper.

**Output:** final release/handoff report and per-worktree retirement or explicit retention decision.
**Gate G10:** work and recovery remain reachable; clean retired checkout has no consumers. A retained dirty reference is a valid completed disposition, not a reason to destroy work.

## 18. Handoff capsule for a separate implementation task

Copy the following only when the user asks to start the separate task. Creating/sending that task is not part of this planning request.

> Prepare the BEL Working as Equals online demo for a separately approved production release using C:\Cursor AI\docs\plans\2026-09-15-213625-bel-online-production-release-plan.md. In this capsule, M = C:\Cursor AI and E = C:\Users\Admin\.codex\evidence\bel-demo-online. Reuse W = C:\Users\Admin\.codex\worktrees\a08e\Cursor AI; do not create any new worktree. Expected starting SHA is 794a41147b5310e635b7c69a75a524bcfc6bccaf on codex/bel-demo-online-implementation-20260914, clean when planned. Recheck repair task 01a0a20c-b6d1-71e3-9bfd-a2e6eff62e8f and obtain sole ownership before writing.
>
> Follow C:\Cursor AI\AGENTS.md, docs/AGENTS.md and agent_docs/project_structure.md. Use model gpt-5.6-luna with reasoning xhigh, Standard speed, Light/direct route, as explicitly requested for this handoff. Execute bounded tasks from this plan; do not independently redesign the distributed-state or release architecture. After one or two meaningful failures, preserve evidence and request a scoped Astra High/X High diagnosis or audit rather than repeating the same approach. No subagents without explicit route/user authorization. The release owner retains architecture and final audit responsibility; a Luna implementation pass does not replace that audit.
>
> Begin with external task contract/before snapshot and Phase 0 preservation. Keep M dirty work and bel-prod's dirty activity-renderer.mjs, scenes.mjs and sprites.mjs intact. The dependency repair is complete: exact Multer 2.3.0 and fresh install evidence; zero high/critical, 11 moderate/low remain. Do not revert the lock to deployed source.
>
> Required remaining work: actual Node 22 container build/smoke, current-candidate durable BEL and separate CRM Projects emulator acceptance, exact namespace denial checks, production-safe Chrome harness, complete live API/configuration and Hosting/rules reconciliation, explicit identities/IAM/cost/region/owners, tested freshness/serialization driver, sealed recovery, final audit.
>
> Evidence: E\release-remediation-followup-20260915-2045; E\audit-8207cc82-20260915-121844; E\release-remediation-96bccd78-20260915-181911; E\acceptance-8e8d2fd3-20260915; fresh planning inventory E\release-plan-20260915-213625. Do not execute historical release-prep commands unchanged.
>
> Current observed Hosting bc3d35b69e7792df has 54,159 paths; proposed 75-path overlay preserves 54,157 unrelated paths. API api-00129-dat uses source generation 1789442285319127 and broad compute identity. Firestore ruleset ead24c04-f364-430c-94d9-a415ad918941 is newer than the manifest's named ruleset. RTDB inventory returned 403/API not enabled; proposed gateway/maintenance returned 404. Refresh all of these.
>
> Do only the stages explicitly authorized in the new task. No commit/push/merge, remote build, provisioning/IAM, production publication/activation or live-data writes without corresponding authorization. Finish all authorized local preparation before asking for approval of a concrete next package. Run F immediately before every mutating release/recovery step; one publisher only.
>
> Return exact SHA/branch/status, paths changed, build/context/image hashes, test assertions/exits/skips, fresh live identities, whole-surface preservation evidence, owner/cost/IAM decisions, unresolved gates and concrete approval scope. Keep local, merged, pushed, deployed, activated and live-accepted states separate. Include Start time and End time in Vietnam Time.

## 19. Plan acceptance checklist

- [ ] No duplicate worktree; W ownership transfer and bel-prod protection recorded.
- [ ] Dependency repair recognized as completed; old HOLD and stale evidence clearly distinguished.
- [ ] Complete current-source/config/Hosting/rules delta, not last-commit-only approval.
- [ ] Actual container build and fresh-lock image verification, dedicated persisted emulator checks and Chrome acceptance.
- [ ] Exact current-live Hosting overlay and API source/configuration preservation.
- [ ] Actual Firestore/RTDB namespaces denied and complete current policy preserved.
- [ ] Least-privilege identities, Auth reads, shared API migration, scheduler caller and residual database scope reviewed.
- [ ] Region/ingress/capacity/cost/owners/accounts decided before dependent action.
- [ ] One publisher; F immediately before every mutating release step; drift forces reconciliation.
- [ ] Disabled rollout, bounded activation, live physical four-player/recovery/PDF evidence.
- [ ] Failure analysis, data-preserving recovery and 24-hour observation.
- [ ] Safe current-destination integration and non-force retirement/retention decision.
- [ ] Separate implementation capsule and separate approvals; this task stops at the plan.

**Readiness conclusion:** The release plan is ready for review. The candidate is **not ready for production deployment**. The immediate executable prerequisite is an actual Node 22 Docker/image build on an authorized capable host, followed by current-candidate persisted acceptance; infrastructure/identity/budget approvals and final live-preserving release audit remain mandatory.

**Finalization note:** The user requested immediate finalization with no further exploration or tests. This task created only this new plan in the repository; external planning evidence and the pre-write structure snapshot are retained under E\release-plan-20260915-213625. Post-write structure tests/checks were not run after that instruction. The checklist above defines future execution acceptance, not completed release gates. No implementation, commit, push, deployment, provisioning, IAM change or live-data write was performed by this planning task.
