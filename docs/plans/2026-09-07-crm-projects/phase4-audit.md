# Phase4 root audit

Status: CLOSED LOCALLY. Final source/test revision47bfecd1f41a3988fbb7097682f13acf4578424f passed root canonical Phase4 5/5, Phase0 9/9 and Phase1 4/4. Phase2 and corrected Phase3 regressions also passed with their unchanged relevant code, as detailed below. All owned resources released. No push, deployment, production mutation or paid API call. Historical findings/ownership below are superseded by the final closure record.

## Acceptance gates

- Current authorization on discussion, history, attachment and lifecycle reads/writes/retries; no implicit admin content bypass; author versus Owner moderation; foreign reply/mention/file references rejected.
- Canonical executor and immutable operation/event identities; ordinary Undo preserves unrelated edits, rejects later affected-record edits, records compensation and never touches spending.
- Atomic inherited project/section/subtree lifecycle; explicit restore-chain/destination; pre-existing child lifecycle retained; inactive historical assignees retained without new access.
- Complete persisted reload comparison includes descendants, discussion versions, attachment metadata and bytes, custom values/order and durable references. Interrupted bounded bulk is all-or-nothing and response retry is idempotent.
- Real private Storage byte roundtrip and revocation; feature-prefix rules; no public download tokens, client paths, partial-file publication or legacy automatic purge enrollment.
- Actual Chrome detail composer/reply/edit/moderation/files, history/Undo and Archive/Trash/restore. Preserve selected stable task, draft/focus and project-switch isolation.
- Canonical manifested API/persisted/Chrome runs, full Storage-aware emulator ownership/cleanup, earlier-phase regressions and exact committed root run.

## Preparation findings sent to coder

Existing command-service records full previous task data in updateTask inverse.patch; compensation must update current revision/timestamps without clobbering newer edits or reviving invalid ordinary editing access. Existing project access transaction includes current identity/workforce/membership and must remain the shared fence.

Both production and local mounts install JSON parsers first; local JSON limit is 10kb. Attachment upload needs a bounded binary route and mount-level evidence. Board renderDetail rewrites metadata HTML, so a dedicated stable discussion container must retain drafts through routine renders.

Managed emulator support currently tracks Auth/Firestore only; adding Storage must cover configuration validation, lock metadata, distinct/available ports, environment, launch, readiness and normal/failure cleanup. Existing unmatched Storage paths deny client access. Legacy purge lists its separate CRM collections; prove isolation by invoking the real purge against an expired legacy fixture while project data and files remain unchanged.

Official setup checked September7: https://firebase.google.com/docs/emulator-suite/connect_storage . Admin SDK emulator endpoint uses host:port without protocol. The emulator does not establish production IAM or bucket configuration; local attachment evidence must be limited to application authorization, rules and persisted bytes. Production bucket/IAM configuration remains a release prerequisite, not a reason to skip the authorized local implementation.

## Initial source findings (open until verified)

- P4-A01: Initial helper checked only local task lifecycle and membership existence. It now resolves effective ancestry and checks current mention eligibility/UID binding; callers and persisted regressions remain to verify.
- P4-A02: Discussion edit/moderate paths omit effective task lifecycle checks. Require active ancestry and matching project/task before ordinary mutation.
- P4-A03: Message history returns the unredacted current hidden message to Viewer, bypassing list redaction. One consistent moderation serializer is required across messages/history/files: Owner and original author may inspect retained content; other members receive tombstone metadata. This is moderation behavior, not an added private-thread ACL.
- P4-A04: Discussion/history read whole project collections before filtering; MAX_MESSAGES is enforced too late to bound reads. Require scoped bounded cursor continuation and malformed-cursor rejection.
- P4-A05: Moderation reason is optional and revisions are Number-coerced. Require reason for hide/delete and actual safe-integer revisions, consistent with canonical input contracts.
- P4-A06: Editor restore-chain can enqueue Owner-only project/section changes; generic Undo similarly lacks original-command authority. Enforce authority for every affected record/command plus expected ancestor/structure revisions.
- P4-A07: Local-active task under unavailable ancestry cannot recover because ALREADY_ACTIVE is checked before effective lifecycle. Restore-chain/destination must handle inherited lifecycle and validate active destination/order without silently reactivating unrelated records.
- P4-A08: Bulk and generic Undo interleave reads with writes. Prepare all reads/validation/planned changes before any transaction writes; real multi-record tests required.
- P4-A09: Full previous-record compensation can reset project schema/structure counters or restore invalid hierarchy/schema references. Preserve monotonic metadata, enforce relevant fences and active ancestry for ordinary field compensation. Preserve existing move Undo through the unified route.
  Concrete cross-phase case: Phase1 transferOwner changes ownerUid/membershipRevision without project.revision. Undo of an earlier project name/lifecycle operation must preserve that later ownership transfer; compensate only the originally changed fields instead of replaying a full project snapshot. Source and test coders received the case.
- P4-A10: Bulk bound measures request patches rather than complete stored inverse/operation. Reject duplicate target IDs and actual oversize history before writes; validate typed people values and only newly supplied assignments, retaining historical inactive assignments.
- P4-A11: Operation history can leak raw inverse message snapshots and scans unbounded operation collections. Require moderation-aware serialization and bounded project-scoped continuation.
- P4-A12: Initial attachment upload writes bytes before project authorization and overwrites the deterministic/client-selected path before idempotency rejection; operation digest omits byte content. Require authorized actor/message-bound reservation, SHA-bound semantics, immutable create-only object storage and reauthorized finalization. Denied/conflicting/replayed uploads must not overwrite or delete published bytes. Bind downloads to task/message and moderation; author-only attachment mutation with message revision/history updates. Tester received explicit byte-retention attack/retry cases.
- P4-A13: Effective lifecycle helper fetches every project task/section for each message operation. Replace with bounded ancestry traversal; guard genuinely needed full-graph reads using existing project limits.
- P4-A14: First pagination fix limits before cursor filtering, preventing traversal beyond the first window. Apply createdAt/document-ID ordering and startAfter in the datastore query before limit; test ties and more than two pages.
- P4-A15: First generic Undo fix uses positional arguments for object-argument assertNoCycle and can overwrite a restored project with the old full projectStructure snapshot in a later merge. Use the canonical helper signature and one coalesced project write or a structure-only patch. Bulk also references an unimported readProjectRows; lint/runtime verification is pending.
- P4-A16: Initial discussion client uses task-only drafts and colon-concatenated scope, omits role from refresh identity, retains old messages across switch, and late mutations act on current selection. Require tuple-scoped drafts, immediate epoch invalidation on switch/close, captured mutation scope and exact retry operation, role/lifecycle controls and real continuation. Edit/mentions/files/history/recovery UI was incomplete at initial review; full Chrome contract remains open.
- P4-A17: Valid message/bulk JSON can exceed pre-router legacy body limits. Scope an explicit bounded Projects parser before global parsers on both production/local aliases, retaining legacy limits. Firebase Functions rawBody multipart must also work; existing read-aloud.js supplies the repository precedent for bounded Busboy rawBody versus normal-stream Multer. Tests must exercise both transports and explicit size/parser errors.
- P4-T01: Initial persisted test accepts active after archive and describes a new SDK boundary while reusing the same context. Require exact archived/effective subtree state and honest reload boundaries. Obtain stale tokens before suspension, use the actual supported legacy purge fixture/workflow, compare unaffected fields exactly and re-download bytes after purge. Test coder owns corrections.

## Disjoint implementation and verification ownership

Ampere retains production/UI/harness/rules/mount ownership. Carver (projects_phase4_tests), a second fresh isolated Luna coder, owns only tests/crm/projects/phase4-* and tests/browser/crm-projects/phase4-*; Ampere explicitly released these before test work. Both are prohibited from nested agents and root docs/Git edits. Tests prepare independently while backend fixes land. Emulator execution remains with Ampere until root explicitly transfers it; Carver must not start emulators yet.

### Source freeze and diagnostic handoff

Ampere handed off the corrected backend/router/harness and draft clients. Root ran lint:crm successfully on this draft. Emulator execution explicitly transferred to Carver for API/persisted diagnostics, followed by Chrome after readiness. Auth9180/Firestore8188/8189 and lock were free. Storage9199/9299/9499 are occupied by unrelated node PID17168 and were left untouched; root verified9399 free. All Phase4 runs use process-local CRM_PROJECTS_EMULATOR_STORAGE_PORT=9399, propagated by the managed configuration. Cleanup must check only owned ports and preserve the unrelated process. Source is frozen pending bounded root-directed fixes. No Phase4 canonical pass yet.

### September 7 progress-request audit followup

Root re-read enabled-3 custom diagnostic: seed passes, API and persisted checks fail; this is not canonical acceptance. API assertion expects history.snapshot.body, but the explicit public serializer exposes history.body. The Storage denial helper calls the GCS download endpoint; it must test the Firebase client Rules surface before inferring a Rules leak. These test corrections were returned to Carver. Node22 remains the required canonical runtime; this diagnostic used the default Node24.

Root source inspection confirms P4-A09 remains open for lifecycle Undo: the project branch reconstructs change.previous and only preserves counters, unlike the updateProject branch. A later ownership transfer can therefore be overwritten. Require archive then transfer then new-Owner Undo regression and field-scoped compensation. P4-A16 remains open: history canUndo presently includes unsupported inverses and operations unavailable to Editor; align the public action flag with supported inverse and command authority. Ampere received these as deferred backend corrections while UI-only work continues.

### Astra backend candidate frozen for focused diagnostics

Sartre implemented bounded coherent recovery catalog/preview reads and route mounts; field-scoped compensation with absent-field handling; lifecycle project ownership preservation; canonical project revision triples/coalesced Undo writes; deterministic destination append rank; supported/role-aware history Undo and logical attachment history. Backend changed paths are recovery-service.js and routes/crm/projects.js; existing query-service exports reused. Coder Node22 syntax and lint passed. Root inspected the new source paths and returned Carver exclusive focused API/persisted diagnostic ownership using Storage9399. UI remains mutable and Chrome is not yet authorized to run. No new source commit or Phase4 closure is claimed.

### Account-switch audit finding — P4-A18 open

Root source inspection and Sartre's read-only trace confirmed that recovery retries are keyed only by projectId while sessionStorage and API authentication use the current UID. An uncertain account-A request survives null selection; account B opening the same project can receive A's Retry action and, if A never committed, execute its intent with B's authority. Late completion can also remove B's storage key. Project/role-only epochs do not fence same-project account changes. Backend authorization remains necessary but cannot identify this mismatched client intent.

Root authorized Sartre to bind retry maps, immutable storage keys, request scopes and response cleanup to captured UID/project, reject replay under another actor and add minimum persistent auth-change invalidation for visible project controllers. Backend stays frozen; Carver may continue API/persisted tests but must hold Chrome until source release and add a deterministic held-request account-switch regression. This finding is not closed by syntax or source change alone.
### P4-A18 source candidate released

Sartre completed the bounded account-isolation correction in recovery.js, discussion.js and crm-admin.js only. Root inspected actor/project retry and storage keys, immutable captured request cleanup, account/project/task discussion tuples, live-UID callback fences and persistent auth-change invalidation. The shell clears project views and reloads its existing authorization flow; an invalidation latch prevents late access callbacks from repopulating them. Recovery retries survive reload in per-account sessionStorage. Discussion drafts/file retries remain in-memory as before and clear on document reload; no new persistence claim.

Node22 syntax and CRM lint passed according to the source worker. All source is now frozen and Carver may proceed with Chrome after focused persisted verification/test readiness. P4-A18 remains open pending actual account-switch/late-response evidence; source inspection alone is not closure.
### Further Phase4 source/UI audit findings — open

P4-A19: Root and Sartre traced stale no-file message completion: submitMessage retains committed messageId, but sendMessage exits on stale epoch before finishMessage and load never reconciles it. Returning to the original task can retain a completed draft/retry. Runtime confirmation is pending behind repaired Chrome fixture barriers. A safe correction must settle only the exact completed request in its captured account/task scope, preserve a newer composer generation, and retain unfinished attachment retries. Matching text in a message list is not proof of command completion.

P4-A20: Root viewed the real Chrome run2 failure screenshot. The always-expanded recovery catalog appears above the primary board and consumes roughly300px even with zero records; loading50 active records would displace the primary board much further. Provide a compact accessible disclosure/entry point for project records/history/recovery, outside the active-workspace lifecycle container so archived projects remain recoverable. Opening it must expose existing actions; avoid eagerly rendering a full active-record catalog before the user opens it. This is a Phase4 usability correction grounded in the screenshot, not a new feature. Source remains frozen until the current focused run completes; no closure yet.
### Real Chrome source defect reproduced / bounded High implementation pass

Root inspected phase4-browser-diagnostic-astra-4.json and the actual failure screenshot: POST and subsequent GET succeed and exactly one original-project message renders, while the completed draft and Retry remain. Run4 finished2026-09-07T10:47:29.553Z with stopped:true; lock/listeners released. P4-A19 is now runtime-reproduced, not merely inferred. The same screenshot confirms P4-A20 recovery catalog displacement above the primary board.

Fresh projects_phase4_async_fix / Euler (Astra High, explicit fork_turns none) owns discussion.js/recovery.js and minimal related CSS for a bounded concurrency correction and compact recovery disclosure. This is authorized implementation-agent escalation, not a silent user-facing conversation setting change. Plato retains disjoint browser-test/helper preparation; runtime is held until source freeze. At most two coders; backend and passing API/persisted tests remain frozen. Root owns review and final gates.
### A19/A20 source candidate frozen for Chrome retest

Euler implemented exact-request settlement of confirmed message completion across navigation, guarded by captured account/task tuple and unchanged composer generation/raw draft. Completed request keys are removed only by identity; newer drafts and mutation tokens remain protected. Upload completion is explicit so skipped or uncertain files remain retryable. Recovery controls now use native details[data-recovery-disclosure] / summary[data-recovery-toggle], default collapsed for active projects with lazy catalog loading and a visible pending-retry indication.

Root inspected these paths; worker Node22 syntax/source ESLint/whitespace checks passed. Euler released all owned source; Plato now exclusively owns focused Chrome retest against frozen source. Tests preserve the original failure assertion and exercise disclosure keyboard access/board visibility, subsequent newer-draft retention and navigation before attachment upload. Backend/API/persisted evidence remains unchanged. A19/A20 remain open until Chrome and final root gates pass.
### Native Chrome caret correction verified; remaining matrix active

Euler reproduced the unfocused textarea range reset using a standalone native SELECT interaction. A guarded next-frame restoration retains immediate restoration and checks actor/tuple/epoch, composer generation, raw draft, newer interaction sequence and current focus. Root inspected the actual source. phase4-caret-native-micro-fix.json demonstrates restored54/54 and preservation of a deliberately newer10/10 selection. Managed phase4-caret-diagnostic-high-2.json finished2026-09-07T11:01:58.321Z with stopped:true: the draft/caret and account recovery assertions passed before a later moderation attribute assertion failed. This custom diagnostic does not certify Phase4.

Euler released source/test/runtime ownership. Plato now owns independent Chrome verification and bounded test corrections; Sartre performs read-only review of the final asynchronous UI changes. Backend and passing API/persisted source remain frozen. Phase4 remains open until the full Chrome matrix, root review, committed canonical verification and appropriate regressions pass. Phases5–10 remain authorized afterward.

### P4-A21 reproduced: recovery completion after same-account navigation

Read-only final UI review identified execute removing the captured retry then returning on the old epoch without reconciling a returned same-account/project view. Root inspected the exact branch. Independent real Chrome run9 held an archive request across P-to-Q-to-P navigation, observed POST200, then Retry remained visible for15seconds with no subsequent catalog GET. Evidence: phase4-browser-diagnostic-astra-9.json and captured failure artifacts. Managed runner exited; lock and owned listeners released.

Euler owns only recovery.js for a bounded correction: exact-request cleanup, separate account/project and epoch fences, execution ownership for pending/status, and guarded fresh-read reconciliation that preserves newer interactions and refreshes retained selection revisions. Plato keeps the reproducing browser test frozen and will independently retest after source release. Run8 already traversed moderation, attachment conflict/retry/download, lifecycle chain/destination and exact bulk Undo reload before a title input assertion defect; its correction reads inputValue. Phase4 remains OPEN and uncommitted.

### P4-A21 source refinement and durable regression checks

Chrome run10 passed the same-account late-success Retry/catalog regression and downstream flows before a reload assertion incorrectly required persisted project selection. The approved contract requires project availability and persisted content; the test now verifies the exact option and explicitly reselects that project/task before checking its title.

Final read-only review caught an over-broad interaction guard that could discard authoritative catalog data after a benign click. Euler removed only that reconciliation interaction comparison while retaining actor/project/epoch/execution/query guards and status ownership. Seven focused checks passed, including current selected IDs receiving new revisions, harmless clicks, exact duplicate retry, known versus uncertain failures and account isolation. Root promoted them to tests/crm/projects/phase4-recovery-client.test.js and the canonical Phase4 manifest; root execution passed all seven and all Projects source/test ESLint passed. Canonical Phase4 now contains seed plus four checks, five total. Frozen corrected Chrome run11 is active; no phase closure yet.

### Expanded Chrome pass and committed acceptance run

Independent Chrome diagnostic run13 passed2/2 commands, including actual Reply parent binding/nesting/reload and all four fixture depths with cross-thread isolation. It also passed account and role changes, attachment interruption/retry/download, same-account recovery completion, lifecycle chain/destination and exact bulk Undo. Console evidence contains437 responses, zero page errors and zero unexpected console errors; the one injected attachment409 remains explicitly recorded. Root viewed the reply/depth and Viewer screenshots. Runner cleanup released the lock and managed listeners.

Root inspected and committed the30 allowlisted product/test paths as1d56451f574fc657424b5a52eca02175eae63a58. Product directories match this commit; local settings, policy/doc edits and unrelated phase2-audit.md changes remain outside it. Root canonical Phase4 acceptance is now running against that exact revision. Phase4 closure requires that result plus regressions; diagnostic success alone is not closure.

### Earlier-phase regressions: open findings

Root canonical Phase4 passed5/5 on1d56451f574fc657424b5a52eca02175eae63a58, finished2026-09-07T11:24:59.894Z with emulator stopped and no owned lock/listeners. Phase2 regression passed3/3. Phase3 regression failed edge-autoscroll; Plato prepared actual viewport/container/pointer/hit-test evidence instrumentation without changing its scrolling assertion. Geometry diagnosis is pending.

Phase1 API/persisted passed; its browser helper raced the newly required sign-out reload against its next login navigation. Sartre changed only that helper to await the real reload, null Auth and final signed-out redirect; runtime retest remains pending. Phase0 passed8/9; its old static asset allowlist recognizes only Phase1 Projects assets and rejects Phase3 state.js. Root also identified changed Phase4 assets still using earlier cache tokens. Sartre owns explicit per-asset cache-version expectations and changed-asset HTML tokens, preserving unrelated shared assets. These regression findings keep Phase4 OPEN; no Phase5 start or production action.

### Phase3 edge-autoscroll diagnosis

The real Chrome geometry diagnostic proves the planned test pointer was outside the viewport: viewport height1100, scroll container top482.4375/bottom1164.4375, pointer y1160.4375 and elementFromPoint null. The collapsed recovery disclosure changes layout height; the test previously chose a container-visible row without ensuring viewport visibility. This run does not establish an autoscroll source defect. Root authorized only a test geometry correction: bring the full container into view before target selection, remeasure and assert pointer viewport/hit validity, retain actual scrollTop increase and cancelled-drag no-write assertions. Evidence: phase3-board-edge-autoscroll-geometry.json and phase3-edge-geometry-diagnostic-1.json. Managed runner cleanup confirmed; corrected Phase3 retest pending.

### Regression corrections committed for final gates

Corrected Phase3 canonical run passed3/3: pointer y887.4375 within1100px viewport, actual target hit, scrollTop0-to-17 and cancelled-drag no-write assertion passed. The complete expanded board matrix also passed. This resolves the invalid test pointer without altering product scrolling code.

Root committed the four reviewed regression/cache files as e2ae706993d0bec7252c473367ed0fdbd7bbcf52. Final exact-commit runs are executing Phase1, Phase0, Phase3 and Phase4 in sequence with fresh managed emulator lifecycles. Phase2 already passed on1d56451f and no backend/domain code changed in the follow-up commit. Phase4 remains open until final gates finish.

## Final closure — September 7, 2026

Product implementation commit1d56451f574fc657424b5a52eca02175eae63a58; cache/test regression correctione2ae706993d0bec7252c473367ed0fdbd7bbcf52; final source/test revision47bfecd1f41a3988fbb7097682f13acf4578424f. Root reviewed source, exact assertions, final focused independent review and actual Reply/depth/Viewer Chrome screenshots. P4-A01 through P4-A21 and the recorded test/regression findings are resolved within the approved local scope.

- root-phase4-phase4-final.json: canonical5/5, errors[], finished2026-09-07T11:45:22.856Z on47bfecd1. Includes seven controller concurrency cases, full API, persisted recovery/private Storage faults and full realChrome matrix.
- root-phase0-phase4-final.json: canonical9/9 on47bfecd1, finished11:41:05.692Z.
- root-phase1-phase4-final.json: canonical4/4 on47bfecd1, finished11:42:11.012Z, including realChrome access, role, signout/account and legacy-navigation flows.
- root-phase2-after-phase4.json: canonical3/3 on1d56451f, finished11:29:35.972Z. No domain/backend changes occurred in later commits.
- phase3-edge-geometry-corrected-2.json: canonical3/3 against1d56451f plus the frozen HTML/test corrections subsequently committed in e2ae7069, finished11:36:25.210Z. Full expanded board checks passed; pointer inside viewport, actual autoscroll0-to-17, no cancelled-drag write. Relevant source/test content remained unchanged afterward.

Final root verification: emulator stopped:true, lock absent, zero listeners on owned9180/8188/8189/9399. Product directories clean. Final Chrome covers actual Reply parent/nesting/reload, all four fixture depths and isolation, mentions, edits/moderation/history, attachment conflict and delayed-upload retry/download, same-actor navigation and account switching, role downgrade/Viewer, task/section/project lifecycle and unavailable-chain/destination recovery, exact bulk status/Undo reload, no page/unexpected console errors. Deeper API fixture and persisted byte checks supplement browser evidence; no Phase10scale/latency claim.

Production indexes/Storage IAM, deployment and paid-provider validation remain later release prerequisites, not local completion claims. Proceed with approved Phase5; no additional routine approval is required.