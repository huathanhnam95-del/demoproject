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
