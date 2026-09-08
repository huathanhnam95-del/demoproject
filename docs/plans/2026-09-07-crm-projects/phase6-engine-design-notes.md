# Phase6 engine design notes

Status: root preparation while Phase5 implementation is active. This does not start Phase6 source work or claim acceptance. The approved package remains authoritative; freeze the concrete interfaces after Phase5 closure.

## Existing seams and constraints

Canonical domain runCommand atomically writes crmProjectOperations and crmProjectEvents, with actor authorization before operation replay. Its event currently includes command, affected IDs/paths and revision maps, but not the semantic before/after fields needed to distinguish status/assignment changes. Extend this shared boundary with a bounded semantic event snapshot rather than inferring historical transitions from a later current task read. Preserve generic response redaction and existing Undo/history.

functions/src/index.js has a legacy crmAutomationRunner every24hours. Phase6 requires its own explicit due/delay processor; do not repurpose that runner. Existing user_notifications client rules allow the recipient to read persisted payloads without current project membership. Therefore use a separate server-only Projects notification store/read boundary with current project permission and lifecycle filtering, or change the shared model only if compatibility and revocation are actually demonstrated. Do not put sensitive project/task names in legacy recipient-only documents and assume later revocation can hide them.

## Required design decisions before delegation

- Versioned validated immutable rule definitions; one definition shared by sentence and connected-block editors. Bounds on steps, branches, delays, nested conditions, created tasks, event ancestry and per-run actions. Define supported typed-value operators and reference validation explicitly.
- Deterministic trigger identity includes the original committed event and immutable rule version. Every action position, including branch path, has a stable journal key. Duplicate delivery, restart and crash after action commit cannot repeat a task creation or notification.
- Reuse canonical command validation and operation identity. Avoid an action commit followed by a separate non-atomic journal write that can duplicate effects. Either write journal/effect/outbox in one canonical transaction or dedupe by a deterministic canonical operation ID and reconcile the journal from that immutable result. Never let an external route forge automation origin, journal identity or execution context.
- Authority is the rule's explicitly designated current actor, rechecked on each effect, delay resume and notification read. No service-account shortcut around membership, suspension, roles, ancestry or record references. Definition ownership transfer must define how already-running versions behave.
- Due occurrences bind task due-date/revision semantics and Vietnam firing time. Rescheduling invalidates old occurrences; archive/trash suppresses normal firing. Leases are bounded and recoverable. A runner cannot mistake a held lease for successful completion.
- All-direct-children-complete uses the coherent effective direct-child set, excludes zero-child vacuous completion, and specifies transition dedupe. Rule-generated events carry bounded ancestry to stop cycles without disabling legitimate independent manual events.
- Notifications support assignment, discussion, deadline and automation, read/unread and mute. Current-authority detail/deep-link resolution is separate from safe tombstone metadata. No email/SMS/push, cross-project actions or ordinary model calls.

## Independent acceptance

Use real persisted races: duplicate event delivery, concurrent workers, crash/restart around action commit, delayed continuation, changed due date, membership/role revocation, archived task, broken reference, cyclic rules and max-action bounds. Assert exact effect IDs/counts plus immutable operation/event/journal identities. Include typed-value/branch definition roundtrip fixtures usable by Phase7. Root will freeze API/DTO and file ownership before implementation.

## Preparation review findings

Independent read-only test preparation confirmed canonical authorization precedes operation replay. Preserve that ordering for automation retries. Coverage must include semantic events from ordinary edits, bulk edits, Undo, schedule changes and automation effects; the current operation summaries often contain only revisions, so copying them is insufficient.

Rule-version selection must be fixed at the event's committed boundary rather than whichever version happens to be active when a delayed worker processes it. A bounded active-version registry read in the command transaction is one candidate; a timestamp-only comparison needs a demonstrated concurrent activation ordering contract. Avoid introducing a project-wide write counter for every ordinary task edit.

All-direct-children completion needs a coherent before/after transition, including simultaneous last-child completion, reopen/recomplete, effective lifecycle and reparenting. It is explicitly about direct children's stored completion, not all descendant leaves. Zero children never satisfies the trigger. A later parent/task read alone cannot reconstruct that transition.

Effect retry must preserve the originally journaled validated payload and deterministic operation ID. If an uncommitted action sees conflicting current revisions, halt visibly or use an explicitly specified re-evaluation policy; never reuse an already committed operation ID for a different payload. Notification recipients, self-notification suppression, discussion edit/new-mention policy and moderation tombstones must be specified before implementation.

Phase6 tests can reuse real Auth/Firestore fixtures and fresh-router restart support from Phase5, but need a dedicated injected clock/worker/fault helper. No internal clock, fault, lease or automation-origin inputs may become user-controlled HTTP parameters. These remain preparation findings, not implemented or accepted behavior.

Root source audit also found a canonical bulk-assignment validation gap to resolve before automation reuses it: recovery-service.js bulkUpdateTasks checks owner/additional-assignee overlap only inside the assigneeUids-changed branch. An owner-only patch can therefore select an existing additional assignee. Validate the resulting pair whenever either assignment field changes, and add a persisted rejected-batch/no-partial-effect assertion. Ordinary updateTask already checks the resulting pair unconditionally. No source change was made during the frozen Phase5 acceptance run.
