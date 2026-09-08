# Phase8 accounting audit

## September 8 local accounting acceptance

The recoverable accounting implementation is CLOSED LOCALLY; native paid-provider certification remains OPEN and dispatch stays disabled. Canonical `test-results/crm-projects/recovery-phase8-first.json` passed 7/7 commands: seed, 16 accounting tests, 3 API tests, 13 client tests, 6 actual external data-input consumer tests, 8 persisted tests and 5 real-Chrome checks. Root inspected source and the exhaustion/manual-draft screenshot; full `lint:crm` and diff checks passed. Consumer tests also passed 6/6 against data-input release `5397f953ecce4a27f99cb66611ceadacf87b41e1`.

Impacted Phase1 acceptance passed 4/4 in `recovery-phase1-regression-second.json`. The first run failed because the old browser fixture expected a now-forbidden USD5.25 allowance; the fixture now verifies a permitted USD4.25 reduction and persisted reload. Both reports remain retained. Managed emulators stopped cleanly after each canonical run.

Dispatch guards distinguish bounded active same-month calls from unresolved usage: concurrent Live/supporting calls share pending amounts, prior-month active dispatch blocks rollover, and explicit unknown usage blocks every feature. Complete settlement requires all pinned categories including explicit zeros. Native bounds, provider usage and deployed indexes have not been certified. No push, deployment, production mutation or paid call occurred.

Next authorized priority is shared voice session/relay/context/confirmation infrastructure for Projects and data input, followed by remaining Projects-specific Phase9 and Phase10 acceptance. Earlier checkpoints below are historical.
## September 8 recovery: integration active

The user-authorized replacement task resumed this preserved checkout; the pause below is historical. See `recovery-contract.md` for before-snapshot, exclusive assignments and cross-task release. HEAD remains `30ffb9a3`; Phase8 source is uncommitted. Data-input explicitly released the canonical contract and shared accounting ownership; its separate checkout is read-only to this task. Canonical policy now reflects the aggregate maximum USD5, admin lower only.

Independent read-only accounting audit ran the original 11 tests and reproduced two missing assertions: a crash after dispatch intent but before markUnknown allowed a new-month admission; complete evidence with an empty quantity map released the reservation for zero. The released repair establishes the UID unresolved obligation atomically with dispatch and requires explicit complete billing categories, including zeros. Focused accounting checks now pass 13/13 with ESLint. Root inspected the repaired source. This is not persisted acceptance.

Released router/access integration adds authenticated private budget reads with bounded query validation, hard 500-cent admin maximum, direct-client deny rules and reservation index declaration. Four focused API tests pass, including existing Phase1 API; Phase1 persisted fixtures were reconciled to the new cap. Index declaration has not been deployed or provider-validated. Actual persisted rules/access and Chrome checks remain required.

Active next gates: real data-input provider-consumer bridge, independent cross-adapter persisted contention/revocation/crash/settlement, actual Chrome shell budget/exhaustion/stale-account behavior, manifested Phase8 acceptance and impacted Phase1 regressions. Native paid dispatch remains hard-disabled. Root alone owns emulator execution, using demo project and Storage9399; data-input's ports8270/8271/9170/9370/9471/9472/9270 remain untouched. No push, merge, deployment, production mutation or paid call.

## Latest checkpoint: paused after current subtasks

September 7, 2026, approximately 10:21 PM Vietnam: both assigned workers released ownership and froze source. Backend reports 11/11 focused in-memory tests, focused ESLint and scoped diff checks passed. UI reports 12/12 client tests, shell static contracts, syntax, lint and diff checks passed; log: `test-results/crm-projects/phase8-budget-ui-local-checks.log`. These are subtask checks, not independent Phase8 acceptance. Source remains uncommitted. Root verified no managed emulator lock and no listeners on9180/8188/8189/9399 during shutdown; backend reports no running process.

Heartbeat `complete-crm-projects-locally` is PAUSED. No further workers, integration or phase execution until user resumes. Phases0–7 remain closed locally; Phase8 remains OPEN. Backend enforces the latest aggregate US$5 hard ceiling; the existing admin allowance write endpoint and canonical contract still need reconciliation. Remaining gates include router/rules/index integration, actual data-input adapter, independent review, persisted cross-service concurrency, real Chrome and provider hard-bound proof. Native paid dispatch remains disabled. No commit, push, deployment or paid provider call occurred during this pause turn.

Status: OPEN implementation after Phase7 local closure on4ba7cfd1; documentation30ffb9a3. The canonical cross-feature policy is [shared-ai-assistance.md](../../specs/shared-ai-assistance.md). Root owns this audit and final acceptance. No provider call or production mutation is authorized by local tests.

## Ownership and source boundaries

Backend worker owns shared `functions/src/ai-assistance/collections.js` and `accounting/{money-pricing,ledger-service,provider-accounting}.js`, Projects `budget-service.js` adapter and pure Phase8 accounting tests. UI worker owns reusable `public/js/crm/ai-assistance/budget.js`, narrow CRM shell/CSS/cache-map integration and client tests. Router/rules/indexes plus independent persisted/browser tests will receive a separate explicit writer slot. No concurrent shared writer; generic accounting/client releases are separable from Projects integration for the data-input task. The current isolated checkout has no global structure registry pipeline; register new shared collections centrally in the feature registry and do not mutate the separate frozen safeguards candidate.

## Required proof

| ID | Boundary | Acceptance |
|---|---|---|
| P8-A01 | One eligible CRM staff UID/Vietnam-month balance across features/devices | Concurrent last-balance admissions across Projects/data-input adapters; feature attribution cannot create another wallet |
| P8-A02 | Current staff/domain authorization | Student/learner/parent/guest denied despite anomalous grants; current Auth/workforce/grant/membership and independent data-input record policy |
| P8-A03 | Exact arithmetic/configuration | BigInt nanodollar strings, override/default500cents transaction reads; malformed config denied, decreases preserve spent/pending, negative available blocks |
| P8-A04 | Immutable admission identity | Request/pricing/bounds/digest/month exact replay no double reserve; changed payload conflicts; current authority checked before replay |
| P8-A05 | Dispatch-before-I/O boundary | Durable intent plus one send permission, retries do not redispatch; crash/reconnect cannot refund ambiguous work |
| P8-A06 | Trusted complete settlement | Disjoint usage, aggregate validation only, exact evidence replay/no-op, conflicting/incomplete evidence cannot release funds, settlement survives later user revocation |
| P8-A07 | Unknown and over-bound obligations | Original month retained, UID guard prevents new-month bypass; record full charge on bound violation, no truncation or automatic block clearance |
| P8-A08 | Cancellation race | Only conclusively undispatched reservation can release; cancel/dispatch transaction race yields one outcome |
| P8-A09 | Native proof gate | Unknown provider bounds, schemas, tools/cache/tier billing fail closed; environment flags/fake adapters cannot certify production hard limits |
| P8-A10 | Current-user reads/UI | No caller UID/price/refund mutation API, bounded private DTOs/cursors; stale-account responses cleared, exhaustion preserves manual work and drafts |
| P8-A11 | Shared integration | Canonical collection registry/direct-write denial/indexes, reusable API/client contract and separate generic release; no unrelated assistant/model replacement |

Frozen UI DTO: `GET /api/projects/budget` returns `{budget:{uid,month,currency:'USD',allowanceNano,settledNano,pendingNano,availableNano,blocked,blockReason,paidDispatchAvailable}}`. Amounts are decimal strings; display rounding never changes ledger values. Backend methods remain internal for admission/dispatch/settlement. Shared data-input composes the same engine through its own authorized adapter and endpoint.

Native Flash/Live hard bounds are not yet proven. Official usage fields and advertised prices are documented in the provider-source note; they are not metered provider acceptance. Keep native paid dispatch disabled until the required proof exists. Local fake-provider tests establish only ledger/protocol behavior.

September 8 follow-up: root found the persisted `crmRole` discriminator absent from Projects AI staff filtering. Added it alongside existing role/flag checks without interpreting Auth practice claims. Accounting now passes17/17. Full affected Phase8 canonical reacceptance `recovery-phase8-crmrole.json` passed7/7 with no errors and stopped emulators. This supersedes the earlier16-test accounting count.
