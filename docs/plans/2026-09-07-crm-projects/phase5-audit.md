# Phase5 audit

Status: CLOSED LOCALLY. Final candidate db80fd2d passed canonical Phase5 10/10, Chrome16/16 and real transaction faults6/6. All Phase0-4 regressions passed on the same SHA. Historical finding states below are superseded by this final closure; all P5-A01 through P5-A17 corrections are verified. No deployment performed.

Requirements: PRJ-VIEWS, PRJ-CALENDAR, PRJ-LINKS, PRJ-SMOOTH, with inherited access/recovery guarantees.

## Findings during implementation

| ID | Evidence and required correction | State |
| --- | --- | --- |
| P5-A01 | Fixed capsule initially specified task links but omitted the approved project-level picker/write route. Reuse existing project GET, add owner-plus-CRM PATCH and independent project UI. | Contract corrected; implementation verification pending. |
| P5-A02 | Initial options query ordered leads/students by fullName; existing canonical create services store name, so Firestore would omit name-only records. | Source corrected to name; real fixture pending. |
| P5-A03 | Initial href used unsupported query-string tab/recordId navigation. Shell uses hash routes; lead list belongs to enquiry; student exact detail uses CRM identity or current gated callback. | Valid route/callback correction in progress; Chrome pending. |
| P5-A04 | Initial Timeline rendered sorted cards without a common Gantt date axis. | Shared axis/stored bars/distinguished derived spans requested; Chrome pending. |
| P5-A05 | New dependency/schedule commands initially lacked canonical field-scoped Undo. Dependency Undo must revalidate full graph and structure. | Source integration in progress; persisted race/Undo pending. |
| P5-A06 | Initial product warnings/availability exposed internal JSON instead of readable reasons and member names. | Human-readable presentation requested; Chrome pending. |
| P5-A07 | Adopted working swaps lacked source/status provenance; future annual choices could imply a2026 publication established future coverage. | Source corrected, focused model checks reported; final independent checks pending. |
| P5-A08 | Independent CRM Viewer could receive task-link canManage:true although writes require project editing rights. | Role-aware response correction requested; direct API pending. |
| P5-A09 | Independent reviewer reproduced recursive calendar merge preserving an omitted/cleared Tet or National Day choice. Save response could claim cleared while Firestore retained the old selection. | Explicit whole-map replacement assigned; real clear/reload/incomplete-preview test pending. |
| P5-A10 | Shared views linkAccess.canManage still used CRM-only permission, unlike corrected dedicated link reads. | Owner/Editor plus CRM response correction assigned; API assertion pending. |
| P5-A11 | Initial frontend discarded readable link results whenever canManage:false; authorized Editor/Viewer lost read-only links. | Frontend separates read results/editability; focused tests reported, Chrome pending. |
| P5-A12 | Root viewed real Chrome gantt.png: long date labels wrap/overlap between short stored and derived bars; leaf tasks also show redundant derived bars. | Bounded markup/CSS track correction assigned; cropped screenshot/nonoverlap check pending. |
| P5-A13 | Harness originally started emulators only for phases0–4, preventing Phase5 authenticated checks. | Root enabled emulator startup for every selected phase; phase0 harness contract and normal Phase5 diagnostic passed. |
| P5-A14 | Real Chrome diagnostic3 removed Viewer membership and received views404, but shared response remained populated after5seconds. Board preserve-refresh catch also restores cached membership/tasks on access-denial errors. | Bounded denial clearing and pending-callback invalidation assigned to frontend; independent Chrome repro retained. |
| P5-A15 | Chrome diagnostic4 seven-field filter retention loses section s1 during a view switch. fillFilters rebuilds options from transient empty Board data and preserves the already-lost DOM value. | Root confirmed source cause; preserve scoped filter drafts through transient reload and apply authoritative removals after load. |
| P5-A16 | Board/views denial clearing does not invalidate the separate Access controller's selected project, membership directory, picker and in-flight refreshes. | Root assigned explicit scoped Access invalidation and shell callback; no automatic fallback reopening. |
| P5-A17 | Phase1 regression administrator has authorized metadata list/members200 but deliberately lacks task-content membership (project/member-directory/views404). The content denial callback incorrectly clears the authorized membership-management surface. | Root diagnosed distinct authority boundaries; bounded content-denial versus management-denial correction assigned. |

## Verification provenance

Backend worker reports7/7 pure model/query cases and targeted ESLint clean. These use pure functions and a supplied snapshot/mock cursor store; they do not prove actual Auth/Firestore transactions, mount wiring, persistence or rendering. Root will record exact final test reports, source revision, browser artifacts, cleanup and affected Phase0-4 regressions after freeze. Preserve unrelated phase2-audit.md edits and local-only .codex/config.toml.

Root independently reran Phase5 models using Node22:7/7 pass. Frontend source released with5/5 focused controller cases and targeted syntax/lint clean; actual Chrome remains pending. Independent read-only backend reviewer returned P5-A09 and P5-A10; no other actionable findings in its bounded review. API/persisted tester exclusively owns managed runtime; original backend worker has a narrow no-runtime correction assignment for those two findings. Canonical manifest now includes mandatory models, client, API, persisted and browser entries.

## Current evidence and ownership

Source/pure tests committed114b33de after frozen-source lint. API diagnostic phase5-diagnostic/report-3.json passed seed/API/persisted3/3 commands,8 API cases and3 persisted cases, errors[], stoppedtrue. Root independently confirmed lockabsent and zero managed listeners. Expanded cross-project/dependency-edge/fresh-server assertions were added afterward with syntax/lint only; the final canonical run must execute them.

Chrome diagnostic2 reached real browser and captured full-population-charts.png, gantt.png, calendar.png and stored-versus-derived.png under test-results/crm-projects/phase5-browser. Root viewed gantt.png and opened P5-A12. Worker reports main view/edit/dependency/student/calendar flows passed, but link reload timing and held-route test handling need correction; this is not a full acceptance pass. Hume owns Chrome tests and exclusive runtime, currently idle pending Laplace's no-runtime Gantt source correction. API test author released files/runtime. Phase5 remains OPEN.

Laplace released the Gantt correction: bars now have accessible labels without visible overflowing text, stored/derived tracks are separate, and secondary derived bars appear only for parents. Focused controller5/5 and syntax/lint passed. Hume resumed exclusive browser verification. Root requested an explicit membership-revocation404 case because view refresh currently preserves response on404; the actual browser outcome is pending. Extended API/persisted tests and fresh-server helper are frozen but await execution after Chrome releases runtime.

Diagnostic3 verified the Gantt separation/nonoverlap and captured gantt-readable-crop.png, independently viewed by root. Held view/project-picker/task-picker/schedule-preview callbacks across project switches passed. It reproduced P5-A14; link assertions still need a complete asynchronous wait audit and one account-switch poll needs an initialization guard. Hume retains runtime but holds next start; Laplace owns only Board/views and focused client regression corrections for denial clearing. Server API authorization itself correctly rejected the revoked member. No full Phase5 acceptance claim.

Root independently ran all current Phase5 models/views/board-access focused tests:23/23 pass, and npm run lint:crm exits0. The new board-access test is registered as mandatory. Diagnostic4 is running against the frozen denial correction; P5-A15 arose in its expanded filter test. Frontend worker prepared P5-A15/P5-A16 changes read-only while Chrome owns runtime; source edits wait for run cleanup. These focused passes do not close the newly found defects or the full phase.

## Canonical candidate acceptance

Candidate e3668286944b04575f06e6cfaf3cc52ccd2d7b28 contains the final source, complete Phase5 tests and manifest. Root independently passed29/29 focused model/client checks, full CRM lint and staged diff whitespace validation. Canonical report test-results/crm-projects/root-phase5-candidate-e3668286.json finished2026-09-07T12:29:59.792Z with success:true, canonicalManifest/isCanonicalScope/certifiesCanonicalPhase:true,8/8 commands,errors[],emulator.stopped:true. Expanded API8/8 and persisted3/3 cases passed; Chrome16/16 passed. Root independently read the final report and verified lockabsent/zero managed listeners before taking runtime ownership.

The final Chrome report and screenshots under test-results/crm-projects/phase5-browser establish all shared filters, actual Gantt geometry, canonical status/date/dependency/Undo flows, calendar choice persistence, project and task CRM links, exact authorized student navigation, independent CRM revocation, project/account change fencing and full/member delayed-response membership revocation. Root viewed membership-revoked-full.png and confirmed empty task/detail/member content and explicit empty selection; other authorized project memberships remain visible. P5-A01 through P5-A16 are corrected and covered by the canonical candidate. Phase5 closure still awaits the affected Phase0–4 regression batch.

Regression batch on e3668286: canonical Phase0 passed9/9; Phase1 API/persisted passed but Chrome failed at initial administrator membership readiness. Saved phase1-readiness artifact records independent members200 and task-content404, proving P5-A17 rather than a readiness timing defect. Batch stopped before Phase2–4. Runtime cleaned, lockabsent and zero managed listeners verified. Laplace owns only Access denial distinction, one shell callback and focused Access tests; Phase1 browser assertions remain authoritative and unchanged.

P5-A17 corrected in42e07871580c44d0bdb074e656b4c0153a78f087: administrator content denial preserves/revalidates the independent members boundary; management denial still invalidates it. Content-denied IDs remain excluded from Board/views on ordinary metadata refresh until explicit user selection. Root reviewed source, passed25/25 current client cases and full CRM lint. Canonical Phase1 rerun root-phase1-final-42e07871.json passed4/4 including the unchanged Chrome matrix, finished2026-09-07T12:35:52.998Z,stopped:true. Root's remaining Phase2/3/4/5/0 batch is running sequentially against the same source revision.

The first Phase2 regression stopped at competing inverse parent moves: one200 and one500 rather than expected409. Preserved root-phase2-final-42e07871.json and phase2-42e07871-lock-timeout.log show emulator transaction lock timeout followed by code3 Transaction is invalid or closed. Current installed Firestore SDK retries code3 only for its transaction-has-expired wording. No assertions changed. Root launched one unchanged canonical rerun and requested a read-only bounded resilience diagnosis; no Phase2 or Phase5 completion claim is based on the failed run.

## Final candidate db80fd2d

The unchanged Phase2 rerun passed3/3 and Phase3 passed3/3 on42e07871. Phase4 API/persisted passed but Chrome selected a shared-ID task while a project-switch refresh was still in flight; the later load cleared that click. The helper now requires target view/board readiness and scoped connected rows, verifies the selected tuple and releases the held archive route in finally. Recovery assertions were preserved; no product change was made for that readiness correction.

Candidate db80fd2dcea95f60613d0a9ea36d38030efcfebf adds a narrow two-attempt fresh-transaction wrapper for numeric3 with exact closed-transaction wording. It does not retry domain/access/general invalid-argument errors. The canonical callback returns replay/new results only through a successfully awaited transaction, preserving authorization-before-replay and immutable operation/revision fences. Root reviewed the actual diff, passed helper/domain focused checks and CRM lint.

Canonical root-phase5-final-db80fd2d.json passed10/10 commands,errors[],stopped:true. Real persisted fault injection passed6/6: pre-callback recovery, staged rollback, committed-but-acknowledgement-lost replay, postcommit revocation denial, concurrent structure conflict and bounded exhaustion with no result/write leak. API8/8, query persisted3/3 and Chrome16/16 also passed. Root independently read these results. The same candidate is still undergoing Phase4/2/1/3/0 regressions before Phase5 closure.

## Final closure evidence

Root verified all six `root-phaseN-final-db80fd2d.json` reports (N=0..5): canonical certification true, success true, exact revision db80fd2dcea95f60613d0a9ea36d38030efcfebf, zero command failures/errors, emulator stopped. Counts: Phase0 9/9; Phase1 4/4; Phase2 3/3; Phase3 3/3; Phase4 5/5; Phase5 10/10. Phase5 covers API8/8, query persisted3/3, transaction fault persisted6/6 and real Chrome16/16. Root confirmed no emulator lock and zero managed listeners afterward.

The closed-transaction retry is narrowly classified and bounded; real fault tests prove rollback, lost acknowledgement replay, revocation before replay, concurrent structure conflict and exhausted retry behavior. Phase4 browser readiness now waits for the target project scope to settle; original recovery assertions pass. The unchanged Phase1 matrix proves administrator metadata access remains independent from content access. Full CRM lint and targeted final syntax/lint/diff checks passed during candidate preparation. No scale/performance, deployment or production scheduler claim is made.
