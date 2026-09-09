# Phase6 acceptance matrix

Status: CLOSED LOCALLY on237aba17; same-revision Phase0-6 canonical batch passed, cleanup verified. Root owns this matrix and canonical manifest. Phase5 closure01dd9dfa/source db80fd2d is baseline. All tests use isolated demo Auth/Firestore/Storage, Node22 and Chrome; no production or provider calls.

## Required independent evidence

| Boundary | Concrete proof |
|---|---|
| Strict definition | Every trigger/action/operator; unknown fields, wrong typed column values, archived/missing references, cross-project targets, duplicate node IDs, depth/node/byte/delay limits rejected |
| Rule lifecycle | Owner-only create/version/preview/activate/disable/duplicate/transfer; Viewer/Editor/admin nonmember denied; immutable old versions, stale preview/schema/reference/revision fences; retries create one operation/version |
| Event snapshot | Commit status A to B to C before processing; B-trigger sees B, not C. Registry activation interleaving captures exactly the version active in the commit. No raw privileged CRM or discussion body |
| Atomic outbox | Rejected commands leave task/operation/event counts unchanged; bulk owner-only assignment conflict rejects entire batch |
| Exact-once action | Duplicate delivery, two workers, equal actions at different node paths, crash before effect, crash after effect before journal, process restart; verify actual task/event/operation/run/journal counts |
| Lease fencing | Expired worker after takeover cannot write; revoke actor/disable rule after preparation and before canonical transaction; neither stale lease nor replay leaks prior authorized effect |
| Branch/delay | Initial snapshot condition, persisted branch choice, fresh condition after delay, restart continuation, cumulative delay bound, visible node error and bounded retries |
| Due generation | Creation, date change A-B-A, clear, title-only edit, Undo, archive/restore, inactive ancestor, version activation before/after scheduled occurrence. Inject clock around Vietnam midnight and09:00; no sleeps or assumed real scheduler evidence |
| Direct children | Empty parent does not fire; two concurrent last children complete once; reopen/recomplete is new transition; grandchildren do not replace direct children; reparent/archive/restore coherent effective sets |
| Loop prevention | A-B-A rule ancestry stops with visible reason; distinct later manual event works; max hops/effects/work batch bound |
| Notification creation | Assignment newly added recipients; self suppression; mentions/reply-parent author/owner/assignee dedupe; edits only new mentions; two notify nodes remain separate |
| Preferences | Complete replacement/CAS revision, scoped category/project validation, mute-at-creation suppression, unmute no replay; default empty and idempotent read |
| Privacy | Real Auth revocation, suspended account, unrelated UID/project, inactive task/ancestor, moderated discussion. Feed omits revoked; tombstone contains no stale label/body; target reauthorizes; all new collections deny direct client access |
| Flags | Automations off rejects activation and preserves pending work; built-in notifications still work with Projects on. Projects off pauses both. Defaults remain off |
| Chrome | Actual shipped panel, category/pagination/read persistence/mute/unmute/conflict/error/empty, authorized task/message opening, tombstone and membership loss, held-response account/project switch fences |

## Execution and reporting

Pure definition/client tests run without emulators. API/persisted tests use real transactions; deterministic fault injection exists only through service construction, never HTTP. Browser fixtures use actual APIs/Auth and shipped assets, explicit held-response barriers only for race reproduction. Each test reports individual cases; preserve failed reports and rerun after the root diagnoses a demonstrated defect. Missing mandatory files must fail the canonical phase.

Before closure, root reviews source and test assertions, commits the source candidate, runs canonical Phase6 plus affected Phase0-5 regressions sequentially, verifies exact report SHA and managed runtime cleanup, and records remaining release limitations. Local scheduled-service execution is not a deployed scheduler claim.

## Changed source and verification files

Requirements covered: PRJ-RULES, PRJ-NOTIFY, PRJ-ACCESS, PRJ-RECOVER, plus existing PRJ-NAV behavior through notification targets.

Compared with Phase5 closure01dd9dfa, candidate237aba17 changes:

- firestore.rules; firestore.indexes.json.
- functions/src/crm/projects/automation/{definition,event-capture,execution-context,processor,references,rule-service,store}.js.
- functions/src/crm/projects/domain/command-service.js; notification-service.js and recovery-service.js under functions/src/crm/projects/.
- functions/src/index.js; functions/src/routes/crm/projects.js.
- public/crm-admin.html; public/crm-admin.js; public/css/crm-projects.css; public/js/crm/projects/{discussion,notifications}.js.
- scripts/crm/projects/phase-manifest.json; tests/crm/crm-shell-static.test.js.
- tests/crm/projects/phase6-{engine-contract,engine-notifications,engine-persisted,notifications-client}.test.js; phase6-test-helpers.js.
- tests/browser/crm-projects/phase6-notifications-browser-check.js.

Phase0-6 same-revision reports `root-phaseN-final-237aba17.json` independently inspected:9/9,4/4,3/3,3/3,5/5,10/10,6/6; each success/canonical true, errors empty and managed emulator stopped. Final Phase6 completed2026-09-07T13:56:04.375Z. Root verified absent lock and zero managed listeners. Phase7 ordered sample/recipient projection refinement is explicitly tracked in its preparation contract.

Release prerequisites remain separate: deploy server functions/scheduled processor and required Firestore rules/indexes before enabling features; perform authorized live acceptance and observe real scheduling after deployment. No remote push, deployed index, production scheduler or provider operation is proved by these local runs. Existing model budget/voice features are later phases and remain outside Phase6 acceptance.
