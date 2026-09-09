# Phase10 integration and local candidate audit

Status: local performance and targeted regression repairs PASS; final canonical candidate validation pending. Native voice acceptance remains OPEN. Phase9 engineering scope closed locally at e910a62d73c947c451dbccad12e9394ba47df913 after canonical19/19 and Projects Chrome8/8. No release action is authorized by this audit.

## Acceptance ownership and conditions

Root owns runtime/browser/emulators, actual evidence review, architecture, manifest and release checkpoint. One AstraMedium worker owns the exact10000-task/30-column performance fixture and Chrome test; no nested delegation. The fixture must verify persisted shape before measuring, expand500 logical task rows, retain bounded virtual DOM and record actual active-input frame/interaction timings. Native speech response p95 is unmeasured and must remain a separate gate.

The integration regression executable runs actual accounts, activity, teacher scheduling, shell, board access, notification, automation and assistant client tests. These focused checks complement the full canonical phases; they do not substitute for persisted/browser integration. The final candidate will receive the applicable canonical regression pass after performance fixes settle.

Full CRM lint found one block-scoped function declaration in the previously committed Phase9 persisted test; changed it to a local async function expression without changing assertions. `phase10-crm-lint-second.log` passes the full declared `lint:crm` scope. The unrelated whole-repository eslint scan remains a separately recorded failure.

## Local release preparation, not deployment

- Candidate revision will be finalized after performance/regression acceptance. Source base for this phase is e910a62d73c947c451dbccad12e9394ba47df913.
- Manual Projects API is composed in functions/src/apiApp.js and local src/server/app.js using current Firebase identity and independent project membership. Default flags remain disabled: CRM_PROJECTS_ENABLED, CRM_PROJECTS_AUTOMATIONS_ENABLED and CRM_PROJECTS_PAID_VOICE_ENABLED. Flags alone cannot enable the hard-disabled native provider path.
- Firestore declarations are firestore.rules and firestore.indexes.json; project attachment boundaries are storage.rules. Direct AI draft/preview/proposal/session/attestation access is denied and server routes own current-authority reads/mutations. Emulator results do not certify deployed rules/index readiness.
- The scheduled function is crmProjectsAutomationProcessor in functions/src/index.js. Any future deployment must inventory the exact intended API and processor targets, preserve unrelated functions, and verify runtime configuration/feature flags. Do not infer selector scope from a prefix.
- Future release order: verify exact candidate and rollback reference; deploy reviewed rules/indexes/storage boundaries and wait for index readiness; deploy exact reviewed API/processor targets with Projects/automation still disabled; deploy matching Hosting assets; perform authorized smoke checks; enable only reviewed manual capabilities. Automation enablement requires its own verified worker and references. This is a preparation sequence, not execution permission.
- The shared relay now has a runnable Node22/Firebase composition and a Dockerfile candidate; see native-runtime-decision.md. Native provider registration is disabled. Container build, deployed service identity, native provider integration, pricing/upper-bound evidence, complete billing provenance and controlled native acceptance remain prerequisites before native voice enablement.
- Rollback should disable feature/automation admission first, stop new effects while preserving durable receipts/drafts/ledger obligations, then restore the verified prior API/Hosting revision. Do not erase project data, drafts or usage records, or relax security rules to roll back code. A deployed prior revision has not been inventoried in this local-only task.

## Evidence still required

RealChrome performance fixture, all applicable settled-candidate canonical phases, exact final source checkpoint and a concise deliverable separating local acceptance, native proof gaps and unchanged deployment state.

First Phase10 execution: persisted exact10000/30/depth21 integrity and actual500-row expansion pass. Initial load8303ms; expansion23188ms. MountedDOM maximum30 withinbound35. Timing acceptance is NOT established: the fixture collected67 eligible scroll intervals and no native drag events, failing its requiredsamplecount. Diagnostic67-sample p95~16.8ms is not an acceptance result. The test is being corrected to include delayed compositor scroll frames after trusted input and to prove an actual native drag start. Thresholds andminimumsample requirements remain unchanged. Detailed retained report:work/crm-projects-recovery/phase10-first-detail.json.

Added explicit required feature-off persisted acceptance to the Phase10 manifest: authenticated read/write/proposal/apply denial, unchanged domain/draft/preview/voice/ledger records, paused automation and retained access after re-enable. Root execution remains pending.

Second Phase10 execution: integration9/9 and feature-off persisted3/3 pass. Exact fixture and expansion pass again, DOM31/bound35. Performance acceptance still open:1000trusted wheel events produced180qualifying intervals, below200. Root identified rAF frame-start timestamp compared against newer event performance.now as another censor; pending-input observation replaces that predicate. Independent audit additionally requires retaining slow intervals beyond250ms, continuous DOM observation, and asserted selection/detail outcomes before performance closure. Evidence:phase10-second.json and work/crm-projects-recovery/phase10-second-detail.json.

Third Phase10 run establishes a real performance failure after audited measurement repair:359wheel samples p95~33.4ms and125native-drag samples p95~16.8ms; aggregate33.3ms exceeds20ms. Legacy and feature-off pass. Root identified scroll-only rebuilding of all mounted35-column rows plus flattening500logicalrows on every event. A bounded viewport-only reuse path is assigned; all content/permission/selection refresh paths retain full rendering. No threshold relaxation. Retainedreport:work/crm-projects-recovery/phase10-third-detail.json.

Fourth Phase10 Chrome5/5 passes:wheelp9516.8ms,dragp9516.9ms,interactionpaintp7551.2ms (notINP), DOMmax31/bound35, no runtime errors, actual trace retained. Overall4/5commands because CRM shell static expected oldboard cacheversion; matchingtestexpectation updated. Independent source audit found publicselectTask must full-render changedtask/expandedancestors nowthat scrolling reusescachedrows; narrow correction andregression required beforefinalcandidate. Fourthreport retained as diagnostic, notfinalclosure.

Initial all-phase attempt99c423ca stopped by root atPhase0: legacyharness invoked canonical--all assumingfuturefilesmissing; nowallfilesexist it recursivelyspawned itself. Rootterminated onlyverifiedrunner46624anditsdescendants, verifiedzeroownedportlisteners, removeditsstalelock. Fixedtest to useisolated11-phasefixture withmandatorymissingPhase10file and30s childtimeout. DirectNode22harnessnowpasses. Thisabortedrun isnotacceptance; sourcecandidatewillbecheckpointedandretested.

## Settled regression repairs

Canonical `settled-all-9bfa6573.json` completed with62/67 commands passing and clean emulator shutdown. Five failures were traced to test assumptions: the board contract omitted selected task IDs; two browser fixtures waited on whichever project a prior phase had left selected; the accounting fixture used the raw transaction runner instead of the production closed-transaction retry; performance refresh waited before the real pending acknowledgment cleared and used a30-second full branch reload timeout.

Test-only checkpoint d1958b5b653c90b4d8b8304f620ac0f4ebbfb47c repaired those assumptions. Custom diagnostic `regression-repairs-d1958b5b.json` passed6/6 commands, including the seed and all five prior failures: board contract6 cases, Phase5Chrome16/16, Phase6Chrome11/11, Phase8persisted8/8 and Phase10Chrome5/5. The custom manifest explicitly does not certify a canonical phase or a new full all-phase pass.

The latest performance report retains strict p95<=20ms wheel/drag and p75<=200ms interaction-to-paint thresholds, actual trusted input, a persisted10000-task/30-column/depth21 fixture,500 expanded tasks, bounded DOM, optimistic write/reload checks and a separate Chrome trace. Aggregate active-frame p95 is16.8ms and interaction-to-paint p75 is50.8ms. Native voice remains unmeasured. These local machine figures are not production latency or field INP.

---

## Superseding Phase 10 evidence and acceptance-status addendum — 2026-09-08

This addendum is appended to the historical Phase 10 audit. It preserves every historical diagnostic and appends the current frozen-candidate status. Where the historical audit says “hard-disabled” or requires “hard-cap evidence,” the superseding policy and evidence wording below controls current reporting.

### Current frozen snapshot

- Snapshot date: 2026-09-08 (Asia/Bangkok).
- Candidate: `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI`, exact `HEAD` `d4b5441a731ce83a48a2d8967a0dcb96855034ad`.
- Canonical r2 source was `d34accb14d6758d8531423caa5b828948a5af71f`; the exact retry r3 source is the frozen `d4b5441a731ce83a48a2d8967a0dcb96855034ad`.
- No product code, runtime configuration, deployment target or production data were changed by this addendum.

### Superseding interpretation of budget and native gates

The current authorized budget language is a monitored shared USD 5 per staff account per calendar month across all live-chat services. It is not a provider-invoice hard cap. Bounded admission, reservation, metering, reconciliation and stopping on unknown usage remain required. No-overshoot is an admission and ledger rule; it is not an absolute invoice cap. A campaign estimate or operational ceiling does not authorize dispatch.

The nonpaid wrapper forced native-off flags and missing-provider-credential environment are execution safeguards for that wrapper. They do not establish that the engineering/provider path is permanently hard-disabled. Physical microphone/speaker verification and Vietnamese ASR fidelity remain unverified; native end-of-speech/rendered-audio latency remains unmeasured. Earlier controlled native provider-output evidence does exist in the candidate native decision record (`native-edit-12`, project creation15, rename17, task creation18 and response mute19), but it is not this snapshot native latency campaign or release gate. The historical native-hard-disabled phrasing must be read as a current nonpaid-run safety setting only.

### Current Phase 10 evidence

- The retained performance report is `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI\test-results\crm-projects\phase10-performance-browser\report.json`, SHA-256 `94d390e24d2d7329ac1296fe5c0e2d9307eee741fc3506c3f57efe2ed9efd989`.
- All five declared performance cases passed. The artifact records 455 active frame samples at p95 16.9 ms and 40 trusted interaction samples at p75 48.5 ms. The fixture verified persisted 10,000-task/30-column/depth-21 integrity, expanded 500 logical tasks, retained bounded DOM and captured a separate trace.
- The report explicitly records native voice as `UNMEASURED`; synthetic relay timings cannot satisfy the native gate. Do not convert the nonpaid browser result into a native latency result or field INP claim.

### Current frozen-candidate acceptance snapshot

- Canonical r2 evidence: 57/77 required tests passed after excluding the runner seed command; its raw report is 58/78 commands including that seed.
- Exact r3 retry evidence: 12/20 required descriptors passed and 8 failed; its raw report is 13/21 commands including the seed.
- Honest cross-revision union: 69/77 required tests. Acceptance is unfinished. Connected journey and supplements remain pending.
- The current r3 report lists these eight unresolved descriptors: `phase1-people-access-browser`, `phase3-board-browser`, `phase4-recovery-persisted`, `phase4-discussions-recovery-browser`, `phase5-views-calendar-links-browser`, `phase6-notifications-browser`, `shared-voice-browser` and `phase9-gemini-relay-browser`. A later repair or rerun must retain this provenance and report new results against the exact successor SHA.

### Release and rollback boundary

This audit addendum authorizes no push, deployment, production mutation, provider call or runtime window. The user owns production release approval; main/coordinator prepares and audits exact-SHA evidence, source/config/routes/secret/target inventory, pending journey/supplement/retry execution and native admission. Preserve historical reports, external copies and failed observations. Any rollback must stop new effects while preserving durable drafts, receipts and usage obligations before restoring a verified prior revision; no rollback occurred in this snapshot.

### Supporting evidence paths

- Canonical r2 report: `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI\work\final-acceptance\projects-final-d34accb-20260908-r2\canonical\report.json`.
- Exact r3 retry report: `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI\work\final-acceptance\projects-final-d4b5441-20260908-r3\retry\report.json`.
- External plan and native protocol: `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\acceptance-plan.md` and `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\latency\README.md`.


## Successor acceptance addendum — phase10 audit

**Date:** 2026-09-09 (Asia/Bangkok)
**Status:** settled local acceptance and release limitations; historical evidence is retained below its original revision.

This dated addendum preserves the complete historical document prefix byte-for-byte.

## Audit basis and scope

- Current candidate snapshot is the 341-path test-only HEAD `f402bb778158d0d2084db13091ec04d61f0f5e0c`; the new source changes are test-only and production paths remain unchanged. The journey, shared-shell and performance reports were produced at evidence revision `725f16b012fc595938ba6d717b0f6da235849df3`, so that provenance is kept explicit.
- Governance base: `2e1fa31962d2580a643f840c2112ed8e520b1fe2`.
- The retained canonical inventory has passing evidence for 77/77 descriptors across named revisions. That is a cross-revision retention result, not one canonical current run. Historical failures and their evidence remain part of the audit record.
- This addendum records the settled local documentation integration. It records local acceptance evidence; it does not establish a push, deployment, current deployed configuration, production mutation or release completion.

## Settled phase10 evidence

The narrow journey run `projects-journey-725f16b01-20260909-r1` passed seed, discussion and connected-journey commands. Its staged report is `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\results\projects-journey-725f16b01-20260909-r1\successor\staged\report.json`, SHA-256 `830518195037de256d1f2a6c204889dd70d436b94b7fef7bcb912c819dabe661`. The connected-journey artifact is `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\results\projects-journey-725f16b01-20260909-r1\successor\artifacts\test-results\crm-projects\phase10-connected-journey\report.json`, SHA-256 `5f491dfa250e7c74e23183d15d31d7bfaac20fa3f97beb757e70302900d36605`. Six cases passed across two current accounts, including persisted confirmation, Undo and reload with teacher-reference retention. The journey uses engineering service-assembly/proposal responses and synthetic audio/provider fixtures; it does not prove a real provider, physical microphone/speaker behavior, Vietnamese ASR fidelity or spoken Undo. `paidProviderCalls` is zero.

The phase10 performance browser report is now **PASS 5/5**, rather than pending. It is `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\results\projects-perf-725f16b01-20260909-r1\successor\artifacts\test-results\crm-projects\phase10-performance-browser\report.json`, SHA-256 `377B258BF213245FBD9EF69B4FA5F8DDBCE39F56E940DF745DB5F15B7D5ADDA8`. The report records active-frame p95 16.8 ms, interaction-to-paint p75 46.9 ms, persisted 10,000 tasks/30 columns/depth 21, 500 expanded tasks, trusted wheel/drag interaction and a retained Chrome trace. It is not evidence of native voice latency or field INP.

The shared-shell smoke report is `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\shared-shell-successor\runs\20260909-023259-048\smoke-results.json`, SHA-256 `34A19602CC939E709C0B7001C2451378B20BCC539055574A62CE988C77972981`. Projects and Data Input initialized; the shared scripts each had one DOM load and one request; measured provider, native and blocked attempts were zero. The guard recorded 62 total attempts, 60 local and 2 other, with fetch/http/https/undici/WebSocket capability coverage. The fixture had no assigned project, so budget initialization was ineligible and this is not a monthly-balance proof.

Supporting scoped evidence remains separated by run:

- Phase 9 refresh: staged report SHA-256 `ee169b70881041b173dab3bf7094ab1906b922d7d45aaeeb987d6a0decd4265c` at `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\results\projects-phase9-19d6e664f-20260909-r1\successor\staged\report.json`; its nine declared cases passed.
- Phase 3 and remote observation: staged report SHA-256 `8cd99fa2a315df14fa9283197c653757962cdece005d97ff80de5d3c68b14317` at `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\results\projects-final-19d6e664f-20260909-r1\successor\staged\report.json`; only the Phase 3 and remote commands are scoped as passed, while other descriptors in that broader report retain their failures.
- Retained calendar supplement: artifact SHA-256 `5dbce2881d078d06e5d929124fdb40917b2b73d4e471a39ce641e94bc409159a` at `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\results\projects-supplements-4be62dfd2-20260909-r1\supplements\artifacts\test-results\crm-projects\nonvoice-calendar-browser\report.json`.

## Policy and release inventory boundary

The superseding policy is a monitored shared USD 5 per staff account per calendar month across all live-chat services. It supersedes historical provider-invoice hard-cap wording; it is a monitored admission, metering, reconciliation and ledger policy, not a provider invoice cap. Standard is requested; the actual service tier is unverified.

The checked-in release inventory was verified read-only: `firebase.json` uses public Hosting; Functions uses Node.js 22; `/api/**` rewrites to `api` in `us-central1`; `firestore.rules`, `firestore.indexes.json` and `storage.rules` are present; the scheduled export is `crmProjectsAutomationProcessor/us-central1`; the relay Dockerfile runs `services/crm-voice-relay/runtime.js` on Node 22 and validates its allowed-origins, native-enabled and paired composition module/SHA settings; candidate `.firebaserc` is absent. This is checked-in configuration evidence only. Deployed targets, deployed config/secrets, index readiness, service identity and the prior deployed rollback revision are unverified.

Any future rollback must inventory exact targets, disable new feature/automation admission first, preserve durable drafts, receipts and ledger obligations, retain exact target/rollback records, and restore a verified prior API/Hosting revision. No push, deployment, production mutation or rollback occurred in this documentation step.

## Block status and release limits

- **BLOCK-196:** scoped integrated local acceptance is closed, with the journey and shared-shell fixture qualifications above.
- **BLOCK-197:** verified by the 20-case real Chrome supplement at `f402bb778158d0d2084db13091ec04d61f0f5e0c`, run `projects-roles-f402bb778-20260909-r2`. Owner, Editor and Viewer each read all five views with explicit task-control permissions; Owner/Editor UI edits persist; Viewer PATCH returns 403 and preserves the complete task. The nonmember administrator receives only the allowlisted management metadata, while selecting the project yields 404 with hidden task content and disabled mutations; all direct protected reads/writes return 404. The unauthorized account sees the access-denied gate and receives 403, with denied mutations preserving the complete task. This is 15 member/view cases plus two permitted saves, one Viewer denial and two nonmember boundary cases; it does not label nonmembers as having project view access. Raw report: `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\results\projects-roles-f402bb778-20260909-r2\successor\artifacts\test-results\crm-projects\role-view-browser\report.json`, SHA-256 `7e2725dbac3876e3c88825060c8e1e01bcc23a6a387e0b772921bea746265f11`. Assertion source: `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI\tests\browser\crm-projects\role-view-browser-check.js`, SHA-256 `c7351af5f2c8942f438cf5b370b458e781f79d6062ab94190c6a8b28c27bc758`. The earlier ef9ed run retained 18 passing cases and a failed administrator-picker assumption; the corrected test preserves those cases and verifies management metadata separately from protected content.
- **BLOCK-198:** verified only in the Data Input scope by `C:\Users\Admin\Documents\Codex\crm-data-input-2026-09-07\execution\successor-acceptance-matrix.json`, revision `44a98a56`.
- **BLOCK-199:** qualified; historical real-provider tests and synthetic microphone evidence exist, but native latency and physical microphone/speaker behavior remain unverified.
- **BLOCK-200:** verified by `C:\Users\Admin\Documents\Codex\crm-data-input-2026-09-07\execution\combined-final-c12c2f0d-20260908\chrome-real-results-fixed.json`, with the recovery supplement at `combined-recovery-c12-20260908/recovery-results.json`, revision `44a98a56`.

The six accepted UI documents were copied byte-for-byte into their planned repository destinations from `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\final-delivery-staging`; their staging manifest SHA-256 is `a179990c16952008bd08b3ae9c8d0c2da04f10f16ecbb56900eb9f0d4c6824ea`, preserving 242 historical evidence rows. Historical source claims are kept separate from current successor evidence. No push, deployment or current deployed-configuration verification is recorded. The USD 2.05 allowance for 20 real-provider trials remains unanswered, and no additional paid dispatch is authorized.

The source checkpoint before this documentation commit is `f402bb778158d0d2084db13091ec04d61f0f5e0c` with 341 governance-base changed paths. This documentation integration adds six accepted UI paths and appends two existing audit records, for 347 planned changed paths. The coordinating task owns the final exact-SHA structure replay after the documentation commit; its result must be recorded separately.

The coordinating task's settled cross-owner mapping is `C:\Users\Admin\Documents\Codex\2026-09-08\crm-integration\ui-cross-owner-closure-f402bb7.json`, SHA-256 `16aef7826a06cc84c15cad0d2cd17a3319557e64f88789ee79e13e25f4babe33`. It supersedes the earlier mapping while preserving the original UI coverage rows.
