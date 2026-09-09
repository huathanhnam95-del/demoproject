# Phase 2 domain execution contract

Activated after independently verified Phase 1 closure on September 7, 2026, 10:49:14 AM Vietnam Time. This refines the already approved Phase 2 scope; it is not a new approval request. Root owns architecture and audit; a fresh Luna coder owns implementation after release.

## Shared command boundary

Use focused domain, validation, ordering, command and query modules under `functions/src/crm/projects/`; extend the existing Projects router and its injected access service. Do not create a second authorization implementation. Expose a transaction content-access fence using the current identity reader and canonical membership check. It must require active Auth/profile/workforce, typed Projects grant and explicit role, including for organization administrators. The management fence's admin bypass is inappropriate for content commands. Validate eligible assignment targets in the same transaction, including membership, current workforce and Auth.

Commands receive a bounded operation ID, command kind, project ID, target ID, submitted patch and expected record/structure revisions. Canonicalize the validated payload and bind its digest to actor and operation ID. Within one transaction: fresh access, idempotency lookup, complete reference/schema/ancestry reads, revision validation, domain writes, immutable operation/inverse and event/outbox. An exact retry returns its original result only after current authorization; a changed actor/payload conflicts. No history/event on failed commands. The operation event includes affected IDs, before/after revisions and origin for later automation deduplication, but must not contain unauthorized CRM details.

Project creation requires current Projects eligibility and explicitly creates its Owner membership atomically. Owners manage project/section/schema settings; Owner and Editor edit tasks; Viewer reads. Project administrative membership management remains the existing Phase 1 behavior.

## Canonical records and structure

Projects have content/settings revision and separate structure revision. Sections, columns and tasks use stable IDs, own revisions and lifecycle. Tasks use parentTaskId; only root tasks own sectionId. All descendant section and effective lifecycle are derived through validated ancestry. Avoid descendant rewrites for moves, and do not cap hierarchy at Firestore nesting limits. Prove depth 25 now (Phase 10 load target is at least 20).

A structural transaction reads and advances structureRevision, validates source/target project, destination section, complete ancestor chain, active lifecycle and no cycles. Moving a task retains every child. Persist enough inverse information for revision-checked compensating moves; replay cannot overwrite a later move or a changed destination. Ordinary cell edits use record revision without incrementing a global project revision. Schema/lifecycle records are nevertheless read transactionally so concurrent changes force validation again.

Sibling order is server-generated, deterministic and stable with an ID tie-break. Reordering must not require rewriting a whole project or more than Firestore's transaction limit. Use bounded local rank rebalancing with the same structural fence; prove insertion into a dense window in a sibling set larger than 500, not merely normal spaced ranks. Report the selected rank representation and numeric/string exhaustion behavior for root audit. No silently truncated rebalance or partial ordering publication.

## Typed values

Immutable column IDs, type, label, stable option keys and order. Types: text, finite number, actual ISO calendar date, eligible people UID values, status, priority and dropdown. Built-in status keys remain not_started/in_progress/blocked/done with configurable labels. One accountable owner plus unique additional assignees. Validate unknown keys, null/clear semantics, length/count bounds, non-finite numbers, invalid dates/options and cross-project references. Type replacement receives a new ID; archived columns retain old values. Parent progress/date spans are derived separately from stored fields.

## Query correctness

One canonical read model supports tree branches and all later views. Resolve effective ancestry/lifecycle before applying section/status/owner/assignee/date/title filters. Filter and sort before cursor pagination. Return explicit next cursor, query identity/revision and matching count. Detect stale/tampered/cross-project or changed-filter cursors without leaking other project data. Full matching-set active-leaf aggregates must not be page totals or newest-500 samples; label counting basis.

A complete project read and in-memory filtering is an acceptable initial correctness implementation if explicitly identified and bounded with an honest error rather than truncated success. It is not proof of Phase 10 performance. Avoid N+1 ancestor reads by assembling a coherent project snapshot. The snapshot/cursor strategy must prevent mixed revisions or omission/duplication during concurrent mutation. Add only indexes actually required by implemented queries and preserve existing entries. Change signals/history reads require current authorization and cannot leak record details after revocation.

## Required implementation and verification package

Owned paths after Phase 1 release: new feature domain modules, narrow access-service export/refactor, existing Projects router, relevant Firestore rules/index entries, Phase 2 API and persisted tests, and phase-runner emulator selection. No board/UI, automation, paid API, production or legacy task edits. Keep files focused and return expansion needs to root.

Mandatory tests already manifested: `tests/crm/projects/phase2-domain-api.test.js` and `phase2-domain-persisted.test.js`. Use real demo Firestore transactions and real router/token path for persisted acceptance. Include deep hierarchy, cross-project/ancestor-cycle denial, concurrent inverse moves, same operation retry and payload/actor mismatch, permission revocation before commit and before replay, invalid/archived typed fields, assignment revocation, deleted reference, 650+ tasks with filters matching records beyond 500, dense order rebalance, cursor invalidation and exact known active-leaf counts. Deny direct client writes to every new protected collection. Preserve Phase 1 tests.

Root audits actual implementation, transactions, inverse data and test assertions, then runs independent canonical Phase 2 on the committed revision after coder fixes. A passing mocked test alone cannot close Phase 2. No implementation may begin until Phase 1 is certified.

## Root architecture checkpoint decisions

The initial coder proposal used fixed-width integer ranks and a project-wide contentRevision. Root rejected both before implementation: dense consecutive ranks can exhaust a bounded window, and updating one contentRevision for every cell defeats the separate structural contention contract.

Use exact rational ranks with canonical numerator/positive denominator strings, BigInt comparison and reduction, stable ID tie-break. Midpoints remain exact; bounded local rebalancing (at most 128 siblings) redistributes rational positions between external bounds without a full-project write. Guard oversized records honestly instead of rounding or partial publication. Prove insertion/rebalance inside 650 consecutive ranks.

Use a coherent read-only transaction for the query snapshot and a digest of all relevant canonical IDs/revisions/update times, structural/schema/lifecycle state and query parameters. Ordinary cell commands update their own record revision; only structural commands advance the shared structure revision. No hot global cell-edit revision.

Cursor integrity must be real: base64 JSON with public hashes is not tamper protection. Prefer opaque random IDs in a protected server-only cursor collection, binding actor, project, canonical query, full snapshot digest, last position and expiry. Store continuation state after reading the coherent snapshot; a intervening mutation makes the next request reject stale continuation. Never persist complete result sets or expose cursor secret/key material in project serializers. Root will audit the implemented integrity mechanism and tests.
