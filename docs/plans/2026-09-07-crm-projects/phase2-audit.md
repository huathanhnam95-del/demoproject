# Phase 2 root audit

Status: CLOSED LOCALLY. Root independently verified commit 3742dd7f56a4fb6ddb9cb67b0a1fddf1fb4f143f on September 7, 2026, 12:11:07 PM Vietnam Time. The canonical Phase2 report passed 3/3, errors empty, emulator stopped, lock absent and ports released. Historical findings below are resolved by the final source and verification package; they describe intermediate drafts, not open blockers.

## Root review checklist

- Fresh transaction content access has no organizational-admin bypass; current identity/membership/grant and assignment target reads cover concurrent revocation and replay.
- Commands bind idempotency to actor and canonical validated payload; retries do not create duplicate operations/events and failed commands create neither.
- Flat hierarchy, inherited root section and lifecycle, full ancestry validation; inverse/concurrent moves cannot create cycles or overwrite newer structure.
- Rank representation and bounded rebalance remain correct for dense siblings above 500; deterministic order has no partial-publication path.
- Typed fields validate actual dates, finite numbers, allowed stable options and same-project/eligible UID values; archived identities/values persist.
- Query filtering precedes pagination, ancestry/lifecycle is coherent, cursors bind query and data revision, full matching-set leaf aggregates exclude summary parents.
- Protected data rules and necessary indexes align with actual server query paths; no legacy collection behavior changes.
- Real persisted tests cover each acceptance case, with mocked/pure evidence reported separately. Phase 0/1 regressions remain required when affected.

No implementation claim or closure is made before actual source and executable evidence are available. Coder exclusively owns managed emulator execution until handoff; root must not start a competing suite.

## Architecture checkpoint findings

- P2-A01: Initial fixed-width integer rank proposal cannot guarantee insertion with a bounded 128-record rebalance inside 650 consecutive integer ranks. Root selected exact reduced rational ranks and adversarial dense-window proof.
- P2-A02: Initial contentRevision increment on every mutation conflicts with per-record cell concurrency. Root selected full coherent snapshot digests for cursor invalidation, retaining structureRevision only for structural operations.
- P2-A03: Base64 JSON with public digests alone does not authenticate a cursor position. Root selected opaque protected server-side cursor records (or an explicitly reviewed equivalent shared-key mechanism). Tests must reject modified/cross-actor/project/filter/stale continuation.

These are pre-implementation architecture corrections, not verified fixes. Source and tests remain pending.

### Early utility probes

- P2-A04: Root Node22 probe of 650 ranks i/10^30 and insertion 325 produced 102 rebalance writes and an equal-rank pair x388/x389. Compaction reserved one interval too few for existing rows plus insertion. Missing outer bounds also used unrelated numeric constants, risking reversed negative/large-offset ranges. Root requested exact edge-derived bounds, correct interval count and adversarial regression. Malformed ranks must not silently become zero.
- P2-A05: Root Node22 probe showed digestPayload(JSON.parse('{"__proto__":{"a":1}}')) equals the digest for a2 and for an empty object. canonicalize() assigned into an ordinary object and dropped the special key through its prototype setter. Root requested safe own-key/null-prototype construction, consistent dictionary handling and nested-key hash/typed-value regression.
- P2-A06: Initial link validator copied arbitrary nested link objects. Root requested bounded scalar record references only (or deferred creation until Phase5), preserving the independent resolver boundary and avoiding unbounded metadata storage.

All are actual observations of unfinished utility modules. Root has not marked them resolved.
- P2-A07: Initial new content helpers defaulted allowedRoles to all project roles even with write:true or owner:true; those flags changed only error text. Root requested centralized flag/role semantics and direct Viewer-write/Editor-owner/admin-nonmember denial tests before command integration.

Root targeted follow-up: updated ordering helper passes nine direct Node22 cases (650 rows, insertion indices 1/325/649, numerator offsets 0 and +/-10^45, denominator 10^30), preserving strict order and at most 128 rebalance writes. Updated payload digest distinguishes nested __proto__ a1/a2/empty inputs. These resolve the demonstrated utility probes provisionally; manifested regression and persisted integration remain required for phase closure.

## First command-service draft review

P2-A08 through P2-A14 were returned as one bounded integration correction before router wiring:

- P2-A08: Command metadata is passed into strict entity validators, rejecting required operationId/revision fields. Meanwhile payload digests omit ordering indices and expected revisions. Normalize envelope and entity patch separately; bind all command semantics in the digest.
- P2-A09: Ordering helper expects row.rank but snapshotRows supplies row.data.rank. Root sibling selection also combines all sections because parentTaskId is null. Normalize rank inputs and group roots by section.
- P2-A10: Missing/null expected revision disables optimistic checks. Require typed revision preconditions for existing state and relevant destination structure/schema; reject invalid/fractional indices.
- P2-A11: Task values patch replaces the entire map, deleting unrelated/archived values. People-column values lack full eligibility checks and assignment membership checks ignore canonical tuple/role. Preserve untouched values and reuse canonical assignment access. Null accountable owner remains valid under approved unassigned-calendar default.
- P2-A12: Ordinary task edit does not read ancestors/section/project lifecycle and can set lifecycle directly. Moves/inverses need effective source/destination lifecycle fences; ordinary edit must not resurrect unavailable data.
- P2-A13: Move inverse stores only the moved task rank despite rebalance of sibling ranks, and affectedIds/revisions omit those siblings. Persist/revert the complete bounded structural effect with current revision checks.
- P2-A14: Project creation event/envelope has null projectId and replay checks only global eligibility. Bind created project identity and recheck current membership before returning a creation replay result.

These are source observations of the first untested draft. Root asked coder to prioritize them rather than carrying the contracts into broader integration unchanged. Persisted test remains an unfinished placeholder and cannot certify the phase.

## First query-service draft review

- P2-A15: Effective lifecycle omits project/section and collapses trashed into archived. Resolve actual section existence and all ancestors, with trashed > archived > active precedence, before row filtering and active-leaf counts.
- P2-A16: Snapshot digest uses application counters/timestamps but drops Firestore updateTime, missing persisted changes that do not bump application metadata. Retain actual document update times and canonical project revision in the digest.
- P2-A17: Serializers place stored data after canonical ID, allowing stored id override. Use canonical identity last or explicit DTOs; normalize nested snapshot rank for sorting.
- P2-A18: Cursor path shape, real date-filter validation and injected expiry clock require strengthening. Unknown object/string coercion is not typed query validation.
- P2-A19: Initial query has no explicit parent/root branch scope for lazy Phase3 tree loading. Add a branch filter without changing full-tree leaf determination; ancestorIds should not include self unless named as a path.

Returned as a single query correction batch while the coder addresses command integration. No phase certification yet.

- P2-A20: Reported runner change hardcoded this workstation's npm-cache Node path. Root requested restoring process.execPath and invoking the runner with Node22 externally; only Phase2 emulator selection belongs in this change.
- P2-A16 follow-up: actual Firestore updateTime must retain seconds/nanoseconds, not be truncated through JavaScript Date/ISO milliseconds. Cursor invalidation must distinguish writes within the same millisecond.

Root reran Phase1 mocked API test against the intermediate Phase2 router draft: passed. This does not certify the Phase2 domain or replace its real persisted matrix.

### Initial persisted slice and remaining verification

Coder report `test-results/crm-projects/phase2-domain-run-3.json` passed the initial real Auth/Firestore/router slice (3 manifested commands including fixture seed), with clean shutdown. Source remains uncommitted at report base b43a58dd. The run covers happy-path creation/edit/move/query, depth 25, 650+ records, basic denial/replay/column replacement. Root explicitly did not close Phase2: full concurrent/inverse/barrier/dense-order/filter/branch/lifecycle/typed-value/cursor/protected-collection matrix is still required.

Root follow-through found required create destination revisions still nullable, body numeric coercion still accepts booleans, project updateTime still loses nanoseconds, and the async parent-read loop still lacks its own cycle guard. These were returned with explicit regression cases.

P2-A05 follow-up direct probe: id('__proto__') is accepted, but validateTypedValues with that active text column and value hello returns an empty object. Canonical hashing is fixed; accepted typed-value map preservation remains unresolved until the actual value path is corrected and tested.

P2-A05 SDK boundary follow-up: root passed the now-safe validated __proto__ value map through the installed Firestore Serializer.encodeFields directly. Input keys contained __proto__; encoded fields were empty. The SDK assigns into a plain fields object at serializer.js:65. Root therefore requires unsupported reserved column IDs/value keys rejected at schema/value boundaries with a clear client error; JavaScript-only preservation is insufficient. Keep existing UID acceptance separate from the column-key restriction. Actual persisted/API rejection remains required.

Provider validation reference verified September 7, 2026: https://firebase.google.com/docs/firestore/quotas#collections_documents_and_fields. New domain document IDs must not be dot/double-dot or match the reserved double-underscore pattern; field names also exclude that pattern. Apply entity/column validation separately from existing Firebase UID acceptance. This complements the installed SDK serializer proof rather than relying on undocumented behavior. The project's 128-record rebalance cap remains an application constraint; do not equate all vendor transform/write limits.

## Stable checkpoint follow-up

Root audited the current production source while the disjoint test coder builds the full matrix. These findings were returned to McClintock; they remain open until actual source and persisted evidence resolve them:

- P2-A19 follow-up: standalone parentScope root is ignored because the predicate sits inside the parentTaskId condition. Require roots without supplying an unrelated parent ID.
- P2-A12 follow-up: moveTask checks source task ancestors but omits source effective section lifecycle, allowing an archived-section task to move into an active section. Shared effective-state validation must cover source and destination.
- P2-A05 follow-up: new ID validation still omits dot/double-dot and uid aliases the stricter entity validator. Separate existing identity acceptance from new entity/field restrictions.
- P2-A21: Creation rank rebalances omit changed siblings from operation/event affected IDs and revision maps. Record every changed record so later history and automation consume complete changes.
- P2-A22: Metadata APIs still require section/column reorder and standalone column archive before the board can use the canonical command boundary.
- P2-A23: Full snapshot reads have no bound. Root selected explicit Phase2 limits of 20,000 tasks, 1,000 sections and 200 columns, fetched with limit plus one and rejected with PROJECT_QUERY_LIMIT above the bound. No truncated success; this is an initial correctness constraint, not Phase10 performance evidence.

McClintock owns source corrections only; Lagrange owns test files and exclusive emulator execution. Root will wait for a stable source handoff before independent final verification.

- P2-A24: Root executable pure probe of 650 equal ranks (0/1), requested insertion 325 and new ID new returned rank 0/1 with no rewrites; actual insertion sorted at index 0. If the equal-rank span exceeds the bounded compaction window, reject ORDER_REBALANCE_EXHAUSTED without publishing a wrong order. Missing/empty ranks also must not silently become zero under an unimplemented legacy migration claim. Lagrange owns regressions for this separate case and correction of the original dense test, which replaced an existing row instead of inserting an additional row.

Stable-source review confirmed the new metadata routes and explicit query bounds are present. Final corrections requested after the tester releases its active run:

- P2-A21 follow-up: before/after revision maps keyed by bare IDs collide across legal project/task/section/column IDs. Use canonical Firestore document paths and identify project revision dimensions consistently. Complete createProject/Owner membership and Undo sibling/project revision maps. Preserve compatibility affectedIds and provide unambiguous affectedPaths.
- P2-A24 follow-up: root pure probe with a valid 256-character rank (254 nines followed by /1), insertion at end, returns a 257-character rank that the next read rejects. Enforce the same maximum on generated output before publishing, including compaction output.

Root verified run7 report success and stopped=true, but that historical run predates the full matrix and these corrections. No Phase2 closure claim.

Root follow-up utility verification on the final source batch: all nine dense-distinct cases passed (650 rows, three insertion positions, offsets zero and +/-10^45); tied-span and generated-overlength cases both reject INVALID_RANK before publication. Actual source now stores canonical path-keyed revision maps on operations and events, with explicit project revision dimensions and affectedPaths. These checks resolve the demonstrated pure utility defects; final persisted assertions and independent canonical run remain pending.

## Expanded matrix checkpoint

Tester report phase2-full-final-rerun.json passed at 2026-09-07 05:02:53 UTC with no retained emulator lock. Earlier failures were test sequencing (stale local structure revision after a successful move) and an invalid owner/additional-assignee overlap that correctly rejected before eligibility; assertions were corrected to isolate the intended cases. Source Undo effective lifecycle guard was audited before this successful report.

Root reviewed actual assertions for competing inverse moves, dense move position and complete Undo ranks/revisions, replay/fresh permission fences, typed retention and foreign parent, full pagination/filter/leaf/lifecycle/cursor behavior, and direct client rules. Two final focused coverage additions requested: Owner-only metadata denial matrix with no side effects, and persisted operation/event canonical-path collision regression. Phase2 remains open until those pass and root runs the committed canonical package independently.

## Final closure evidence

Product and tests committed as 3742dd7f56a4fb6ddb9cb67b0a1fddf1fb4f143f. Root independently executed Node22 scripts/crm/verify-projects-phase.js --phase2 against that exact commit. Report: test-results/crm-projects/root-phase2-committed.json; finished 2026-09-07T05:11:07.733Z, success true, 3/3 commands, errors empty. Root verified emulator stopped, lock absent and no listeners on 9180/8188/8189. Root lint passed; Phase1 mocked API regression passed against the Phase2 source. The final tester report phase2-full-final-role-path-rerun.json independently preceded this root run and passed the complete package.

Acceptance proof includes real Auth/router/Firestore transactions, depth25, competing inverse moves, exact persisted dense insertion and complete compensating Undo, fresh revocation barriers, replay conflict and current authorization, typed/archived value retention, metadata role denials with zero side effects, actual foreign parent rejection, full matching pagination beyond500, leaf-before-filter counts, lifecycle precedence, precise snapshot cursor binding, protected direct-client reads/writes and canonical path collision history. No remaining Phase2 acceptance finding is open.

Limits: full read-model scan is bounded at20,000 tasks/1,000 sections/200 columns and is not Phase10 performance proof. Phase2 Undo supports moves; broad recovery/history UI is Phase4. No board/Chrome rendering claim for Phase2. No push, deployment, production change or paid API call. Phase3 is authorized to proceed with a fresh Luna coder.
