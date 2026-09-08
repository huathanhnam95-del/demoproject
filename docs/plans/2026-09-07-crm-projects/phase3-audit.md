# Phase 3 root audit

Status: CLOSED LOCALLY. Source/tests committed as 3972062e2989fda5d586dcef4dad7943524a9688. The earlier investigation checkpoints below are historical and superseded by this closure.

Root independently passed canonical Phase3 3/3 (test-results/crm-projects/root-phase3-committed.json, finished 2026-09-07T08:41:32Z), Phase1 regression 4/4 (root-phase1-after-board.json), and Phase2 regression 3/3 (root-phase2-after-board.json), all on that exact revision. Each report has success true and no errors. Managed emulator shutdown, absent lock and free ports 9180/8188/8189 were verified after the final run.

All recorded acceptance findings were addressed and exercised in the expanded real Chrome matrix: permissions and focused-editor downgrade, valid shared grids, bounded keyed rendering, selection/refresh scope fencing, pending queues, section-scoped order, no-op suppression, hover/edge dragging, complete append position, and persisted reparent/reload. The 411-logical-row fixture rendered a bounded viewport (22 rows at its recorded checkpoint). Seven typed fields, status-label validation, root/direct-child continuation, deliberate failure/retry, and stale-response cases passed. Root inspected the final settled move screenshot. The final coder and root runs had no hover stale-cursor response; earlier cursor failure is historical, not silently reclassified as success. Focused lint had passed before the unchanged source commit.

Socrates and Banach are complete with no current file/resource ownership. Phase4 discussions/history/recovery remains next. No production, push/deployment or paid calls; no Phase10-scale performance or later-phase feature completion claim.

Root acceptance review will inspect actual client state/DOM architecture, canonical API integration, shared project selection and Phase1 access preservation; stable hierarchy and revision/idempotency handling; all typed inline editors; pointer and keyboard move semantics; lazy branch continuation and bounded virtual DOM; pending/failed/remote response reconciliation; real Chrome persisted flows, focus/scroll, edge overlays and role controls.

The coder exclusively owns managed emulators/browser execution until explicit release. Root will audit settled screenshots and actual assertions, return defects proportionately, commit only allowlisted reviewed files and run the canonical committed package independently. No production, push/deployment or paid calls.

## Initial board draft review

Socrates checkpoint confirms source and draft tests exist; no emulator/browser resources running. Root identified these actual source findings before verification:

- P3-A01: Edit calls use default POST where canonical routes require PATCH.
- P3-A02: structureRevision prefers stale project metadata over the refreshed board revision.
- P3-A03: loadProject resets selection/expansion/focus during move and refresh, losing stable detail and editing context.
- P3-A04: Mutation completions lack captured project/generation fences; pending/drafts are not project-scoped. Late responses can affect a new project with the same task ID. Same-task edits need serialization and change/blur deduplication.
- P3-A05: New shared selectProject initially bypassed the existing membership mutation fence; creation must refresh access before selecting a new ID.
- P3-A06: Custom status-column labels do not implement configurable built-in task.status labels.

Root authorized a focused state/mutation correction and two narrow backend additions within this phase: query activeChildCount from the full-tree active children map; project.statusLabels configuration via Owner updateProject with expected record and schema revisions, preserving stable keys and advancing schema revision. Custom column values/status labels remain separate. Narrow command-service, validation and query edits are now in the coder allowlist. Every further backend expansion needs a concrete root assignment.

Refresh must preserve drafts/caret/focus/selection/expanded branches/scroll; project switching invalidates old completions. Source corrections and real Chrome evidence remain pending. The initial draft is not certified.

P3-A07: Draft contract test checks source string presence, which passes despite the demonstrated request/state bugs. Replace the meaningful state gates with executable deferred-response tests; retain only proportionate shell integration checks. Draft Chrome test covers initial edit/add/reload/Viewer slice only. Full pointer/keyboard/pagination/remote/failure/virtual DOM acceptance is still required.

Root requested an explicit test/resource handoff to a fresh disjoint Phase3 verification coder. Until that release is acknowledged, Socrates still owns the test files and managed resources. No parallel emulator suites are permitted.

## Stable checkpoint review and ownership transfer

Socrates explicitly released both Phase3 test entrypoints and all managed emulator/browser resources to Banach. Source-only ownership remains with Socrates; Banach owns the entrypoints plus the two expanded helper files and exclusive emulator execution. No resources were active at transfer.

- P3-A08: New state.js is script-included but board.js does not call it; the board maintains duplicate state and queues. Helper-only tests cannot certify the actual app. Root requires integration or removal and real-controller behavioral evidence. Delimiter-composed project/task/field keys also collide for legal IDs; tuple encoding is required. Ignored finally promises in queue cleanup can create unhandled rejections.
- P3-A04 follow-up: createSection/createTask/createColumn/moveSection/moveColumn still apply results or refresh the current project without captured scope fences. Root requested one shared boundary for all project-specific mutation results, rather than selective handler fixes.
- P3-A06 follow-up: Partial project statusLabels patches replace the whole stored map. Root requires transactional merge of validated submitted keys to preserve other customized labels.

These remain open; the reported syntax/lint checkpoint is not a functional closure. Tester is informed of the disconnected helper and must not substitute model-only proof for real board behavior.

P3-A08 follow-up: stateModel is now called for switch/refresh scope tokens; its queue/draft/view helpers remain separate from the board's actual implementation. Tests of those unused methods are utility evidence only. Root verified that public/js/package.json declares type module, so Node22 require(state.js) returns an empty namespace despite the CommonJS tail; the global IIFE API can be loaded, but this is not proof of controller integration.

- P3-A09: Final setBusy(false) re-enables action buttons without reapplying Owner/Editor/Viewer restrictions after rendering. Busy state must combine with permission state.
- P3-A03 follow-up: preserve refresh still hides the workspace; snapshot/restore stores only row ID and vertical scroll, not active editor/caret or horizontal position. Require exact input focus continuity and a visible background refresh.

Tester was asked to run an honest initial Chrome diagnostic slice once runnable, then grow to the full acceptance matrix, coordinating each source-edit window. No Phase3 verification claim yet.

## Chrome diagnostic and root follow-up

Expanded Chrome reached project/section/task/subtask creation and typed field setup after the tester corrected native prompt sequencing. Viewer metadata showed `Viewer access` with both Add task and Add column enabled. Root traced P3-A09 to missing shell element registrations: board permission writes optional-chain absent button references while click handlers use direct DOM lookup. This is a demonstrated integration defect; source correction and a fresh browser run remain required.

P3-A10: Root inspected pending mutation cleanup. Same-project preserve refresh increments projectGeneration; task save completion/finally then skips reconciliation and pending cleanup. Successful move itself awaits that refresh before checking the old generation in finally, leaving the pending marker. Separate selection lifetime from refresh request ordering, clean up only the matching operation, and reconcile outstanding queues with refreshed snapshots. Real Chrome held-save/refresh/subsequent-edit and completed-move pending checks are required.

Tester released managed emulator resources after the Viewer diagnostic. Socrates owns the source correction window; Banach continues disjoint test work without starting another emulator until source freeze. Root also requested stronger exact order/retained moved descendants assertions and pre-reload stale-response isolation evidence. Phase3 remains OPEN.

P3-A11: Root viewed phase3-board-owner.png: task titles span the row under all headers, with other cells not aligned visibly. The grid repeats a custom-column count defaulting to zero, which is invalid CSS, while renderHeader sets that count only on the header. Shared valid templates (including zero custom columns) and actual Chrome cell/header geometry checks are required; successful selectOption calls alone do not prove visible usability.

After the shared-template correction, the next Chrome run failed on expander hit testing. Fresh phase3-board-base-geometry.json/.png confirms inherited columns now work, but fixed 46px rows have 104px intrinsic grid tracks: people/date controls overflow and the next row intercepts the expander center. Root identified a second A11 cause: markup uses crm-board-people-field/crm-board-date-cell while the new CSS targets crm-projects-board-prefixed names. Socrates owns a bounded selector/cell sizing correction; tester remains paused with resources released. Backend additions and the expanded matrix have not yet been reached in this run.

Subsequent Chrome diagnostics passed base expansion, UI creation, typed fields, status-label API fences/role checks, exact root/direct-child continuation and bounded offscreen rendering. Test-only defects corrected included expecting an offscreen row in the DOM, matching the wrong query encoding and asserting scrollTop on a one-row fixture. These are diagnostic slices, not full Phase3 closure.

P3-A12: Root source inspection confirms renderVirtualRows unconditionally replaces row-group innerHTML on scroll, violating the intended stable editor identity. A remote test encountered STALE_REVISION, but its mixed focus/scroll sequencing did not establish the precise cause; the isolated remote-refresh case then passed. Do not claim the revision race proven to originate from scroll. Socrates now owns keyed row reconciliation with bounded active-row retention and readable date widths; Banach owns a genuine large-fixture scroll/focus regression. No fresh full matrix pass yet.

The keyed-renderer run reached keyboard movement after completing the earlier geometry, typed/status/role, continuation and deferred-state cases. It failed waiting for outdent after indent. Root source review shows successful indent does not expand its destination, so the selected row can disappear. The next correction must keep the moved selection visible/focused. Reused row nodes also need current draggable/permission attributes; focused-cell retention cannot preserve editing after downgrade. Internal row identities must distinguish a task named section:x from section x, since domain IDs permit colons.

Remaining coverage explicitly identified: hover expansion, pointer edge auto-scroll, section drops/reorder, column reorder, zero-column geometry, edge hit testing, switch failures and active-editor role downgrade. Banach is adding them. Root additionally found hover timer restart on every dragover and missing dragend cleanup; Socrates owns these narrow client fixes in the same source window. No Phase3 closure, push or deployment.

Expanded diagnostics subsequently reached hover after passing role downgrade/revocation, zero/two-column geometry, exact section/column reorder and continuation. Hover expansion passed but drop issued no request. Root found virtualization retained the focused row but not the drag source, which can leave overscan when a large branch opens. The source now pins the active drag row and its cells through the gesture, within a bounded extra row; unchanged real-pointer testing remains required.

A later rerun stopped earlier on intermittent native Section prompt acceptance with no section request. The cause was not established. Root authorized replacing the native prompt with an explicit inline section form, consistent with other board forms: Owner/busy gating, one submit path, duplicate prevention, Cancel without a write and stale-scope fencing. The tester has adapted real UI assertions and failure diagnostics. This is a UX change with pending browser verification, not a claim that the intermittent native-dialog cause was proven.

Root also requested and inspected a queued-load scope guard: after awaiting an earlier load, the requested project/epoch must still be current before any live map or busy-state mutation. All source is frozen for the next expanded run; no full Phase3 success yet.

Later root-directed corrections kept the project picker available during read loads, scoped root sibling calculations to their section, and suppressed unchanged task/section/column drops before operation creation. Chrome subsequently completed the functional matrix including settled reparent reload. Final console checks exposed intentional Phase1 status-route fallback 404s and deliberate task permission/conflict/abort cases; the classifier is limited to their exact fixture paths/statuses, favicon returns 204, and all page errors/unexpected URLs still fail.

The final attempted run, phase3-verified-final.json, remained unsuccessful because a direct-child cursor request returned 409 after a concurrent hover-drop mutation. Domain STALE_CURSOR is an intended snapshot fence, but recovery must be demonstrated before treating that event as expected. Banach is adding response-code capture and exact fresh branch completeness/visible error checks after the drop. Do not claim the current report passed or Phase3 closed. Root independently ran lint:crm successfully earlier in this sequence; final committed-source verification is still pending.
