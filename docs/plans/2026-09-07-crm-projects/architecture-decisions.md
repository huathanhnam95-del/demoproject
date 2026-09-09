# CRM Projects implementation decisions

Root-maintained decisions under the approved execution contract. These clarify implementation boundaries without expanding product scope.

## ADR-01 — preserve the old task model

Use separate Projects collections/services/router. Existing `activity-service.js` requires lead/student/class references; its `open/done/canceled` status and global newest-window query semantics do not match recursive project work. Optional CRM context links do not make an entity reference mandatory for a project. Legacy tasks and their counters remain isolated.

## ADR-02 — explicit workforce grants separate from learner profile creation

Prefer server-owned workforce records keyed by the existing Firebase UID for module grants, workforce settings and administrator-managed allowance configuration. Do not derive Projects authorization from arbitrary fields supplied when a client creates its `users/{uid}` learner profile: current profile-create rules allow unlisted fields beyond their existing denylist. A server-owned collection avoids expanding that escalation surface. Explicitly deny client writes and test direct attempts.

Every project-content operation must verify a current active identity/account, an enabled Projects module grant and explicit Owner/Editor/Viewer membership. Organization admin status alone is not project-content access. Organization administrative endpoints separately verify current admin status. Preserve teacher flags/history/classes and Teacher Schedule; do not weaken the legacy admin middleware to admit workforce users.

Production and local mounts must use the same project authorization service. Do not copy the existing local unsigned-JWT emulator shortcut into the new production path. Inject a Firebase token verifier into the router; isolate all test transports to a demo project and loopback endpoints.

## ADR-03 — separate structural serialization from ordinary edits

Task records are flat and individually addressed. Store `parentTaskId`; only root tasks carry the authoritative section reference. Descendants inherit their section through ancestry. This avoids rewriting all descendant section metadata during a root move. Transactionally serialize reparent/order operations and validate ancestry/cycles at the commit boundary. Do not use a single project revision as the contention point for every cell edit.

Use per-record expected revisions and actor-bound idempotency records with a canonical payload digest. Reusing an operation ID with a different actor or payload must not leak results or silently accept another command. Recheck current authorization even when returning an idempotent result. Ordinary edits cannot race silently with schema changes or lifecycle tombstones.

Detailed query/read-model, structural size limits and subtree recovery contracts must be proved in Phase 2/4 rather than inferred from a passing in-memory model. Full-project charts must account for ancestor lifecycle and active-leaf semantics; do not count a page or double-count summary parents.

## ADR-04 — evidence boundaries

Pure service tests prove local contracts; mocked routes prove handling only. Auth emulator tokens, real Firestore transactions, direct-client rule denials and persisted browser reloads prove different boundaries and must have separate evidence entries. The phase runner must fail for missing mandatory tests and preserve child failures. Performance thresholds are measured acceptance gates, not design claims.

## Baseline defect diagnosis — scheduler fixture date drift

Observed before Projects changes: `teacher-scheduler-client-controller.test.js:789` fails to find a completed session pill. Its completed-session fixture uses August 31, 2026 and returns August 31–September 6 from the mock API but creates empty date inputs. `teacher-scheduler-workspace.js:258-264` correctly fills those inputs with the actual current week; its reload prefers input values over mock payload dates (`:879-897`). On September 7 the fixture session is outside the selected range.

The bounded repair is to make that test's date-input range explicit before initialization and preserve its completed-pill/name/popover assertions. No production scheduler change is needed for this diagnosis. Luna owns the repair and before/after evidence; root audit pending.

## Approved shared usage-credit successor — September 9, 2026

The approved product policy now uses one shared monthly staff usage-credit allowance, conservatively calibrated to USD 5, with server-metered audio activity and explicitly estimated text/processing. Provider monetary history and unknown holds remain separate and truthful; incomplete invoice vectors alone do not block valid quota requests. The independent real-provider test campaign retains its USD 5 total guard. See [shared usage-credit execution contract](../2026-09-09-shared-usage-credits.md) for migration, month ownership, consumer APIs and acceptance. Implementation is authorized and underway; integrated acceptance and deployment remain unverified. Historical evidence above is retained at its recorded revision.
