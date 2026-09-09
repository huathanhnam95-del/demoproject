# Phase6 engine and notification contract

Status: prepared during final Phase5 regressions. Source implementation begins only after Phase5 closure. The approved eleven-phase execution remains the authorization; this contract specifies its Phase6 interfaces.

## Boundaries

Use focused modules under functions/src/crm/projects/automation/ for definition validation, rule storage, execution and processing, plus notification-service.js. Preserve existing canonical command validation, history and Undo. No ordinary execution uses a model. Existing crmAutomationRunner and legacy user_notifications remain unchanged. New server-only collections must be explicitly denied to direct clients and documented with required indexes.

Owner manages definitions and activation. Each immutable version records a designated actorUid who must be a current project Owner at activation and execution. Transfer creates a new version; existing runs keep the original actor and stop if that actor loses authority. Every action/delay resume checks current active Auth/account/module grant, project membership, project/task ancestry and referenced records. A service account does not replace these checks.

## One persisted definition

Versioned definition schemaVersion:1 contains trigger, optional condition and steps. Every step has a stable unique nodeId, type and typed payload. Sequential arrays, if/else branches and delay nodes are the same representation used by both Phase7 editors and later AI drafts. Reject unknown fields/types and cross-project references. Bound definitions to64 nodes,8 nesting levels,64KB encoded size,100 active rules per project,30 days per delay and30 days total scheduled waiting. No arbitrary scripts, URLs, expressions or external side effects.

Triggers: task_created, status_changed, assignment_changed, due_date, all_direct_children_complete. Status changes may specify from/to stable status keys. Assignment changes include accountable owner and additional assignees. Due trigger includes a visible Vietnam time (HH:mm, default09:00) and bounded integer offsetDays (-30 through30). Unchanged values do not produce transitions. Completion means a nonempty coherent effective direct-child set transitions from not-all-done to all stored statuses done; grandchildren do not replace direct-child semantics.

Condition leaves reference built-in task fields or immutable custom column IDs and a validated literal. Operators: equals/not_equals; numeric/date less_than/less_or_equal/greater_than/greater_or_equal; text contains; people/dropdown contains or is_empty; status/priority equality. Groups all/any/not are bounded by the same depth/node limits. Validate against current schema at save, preview, activation and execution. Conditions evaluate the immutable triggering task snapshot initially; conditions encountered after a delay evaluate a fresh authorized snapshot, and the selected branch is journaled once.

Action kinds: set_field, assign, move_section, create_task, notify. Task targets are trigger_task or a validated same-project explicit taskId. set_field supports existing built-in editable fields and typed column values, excluding lifecycle/identity/structure bypasses. assign writes one owner plus distinct additional assignees through canonical validation. move_section uses canonical move semantics and expected structure revision. create_task chooses a current section and optional trigger-task/explicit parent; deterministic operation-derived IDs prevent duplicate creates. notify has a bounded plain-text message and explicit eligible member IDs or the triggering task owner/assignees. Validate target resolution; an empty required recipient/target is a visible broken-reference failure, not a successful action.

## Events and transaction integration

Canonical committed events contain bounded semantic before/after task changes, discussion metadata needed for notification recipients, and immutable active rule-version references captured in the same transaction. Do not reconstruct a historical transition from a later task read. Cover create/update/move, bulk edits, relevant lifecycle changes, schedule application and Undo. Preserve generic CRM response redaction. No raw privileged linked CRM content belongs in notification/event payloads.

Read a bounded active-version registry before command writes. Activation updates that registry transactionally. Event processing uses the recorded versions even if a later version is published; disabling a rule stops pending effects. Avoid a shared project write counter on ordinary edits. Completion-trigger coherence may require transactional sibling/graph reads when such a rule is active; implement explicit bounded logic, not delayed current-state inference. Read all required data before any Firestore write.

Task due occurrences need a semantic date-generation identity so due A→B→A cannot reactivate an old occurrence. Increment the generation only when due semantics change, including Undo, and initialize it on creation. Title-only edits must not manufacture another due occurrence. Date clearing, inactive ancestry and a changed generation invalidate queued occurrences. Restore does not replay an already completed occurrence without a new due generation; document the exact implemented policy and test it.

Fix the independently identified bulk assignment gap before reusing that path: whenever owner or assignees changes, validate the resulting owner is not an additional assignee. A rejected batch leaves no partial writes, operation or event.

## Runs, journals and bounded workers

Run identity deterministically includes projectId, ruleId, versionId and event/occurrence ID. Action identity includes runId and immutable node path. Two equal action payloads at distinct positions are distinct effects. Store the validated action payload before attempting it; retries never silently substitute a changed payload under an existing operation ID.

Use recoverable bounded leases with owner/token/expiry checked on each transition. States include queued, running, waiting, completed, failed, canceled; journal states distinguish prepared and committed effects. A held lease is pending. Persist exact continuation and branch choice across restart/delay. Canonical effect operation IDs provide the crash-after-effect-before-journal dedupe boundary; reconcile the immutable operation result after restart. Notifications and their journal/outbox identity must likewise commit atomically or use deterministic create identity.

Any automation origin/ancestry/action identity is internal-only, bound to the executor; clients cannot supply it through ordinary routes. Limit ancestry to8 rule hops,64 effects per run and a bounded processor batch. Reject repeated rule ancestry to stop A→B→A loops while allowing independent later manual events. Persist visible error code, failed node, attempts and timing; do not label a skipped conflict or inaccessible target successful. No unlimited retries.

Expose a dedicated processor service with injected clock, worker ID and test-only failure hooks. Production schedule is a new export, separate from the existing24-hour runner. Scan/query bounded event, due and delayed work; save progress without losing incomplete/leased work. Functions and local app route mounts share the same service contract. No public HTTP route exposes worker execution, fault injection or privileged origin context.

## HTTP contract

Under /api/projects/:projectId (and existing supported alias), Owner-only routes:

- GET /automations: bounded cursor list with title/folder/enabled/currentVersion/revision.
- POST /automations: operationId, title, folder, definition; creates disabled draft with immutable version.
- GET /automations/:ruleId: metadata, selected immutable version and validation diagnostics.
- PATCH /automations/:ruleId: operationId, expectedRevision, supported title/folder/enabled:false metadata edits.
- POST /automations/:ruleId/versions: operationId, expectedRevision, definition and actorUid; appends disabled candidate version.
- POST /automations/:ruleId/preview: versionId and sampleTaskId; returns exact version digest, sample effects, warnings/broken references and expiring previewToken. No task effects.
- POST /automations/:ruleId/activate: operationId, expectedRevision, versionId, previewToken; exact definition/reference/current-authority checks before activation.
- POST /automations/:ruleId/duplicate: operationId, expectedRevision; fresh rule identity, disabled copy.
- GET /automations/:ruleId/versions and /runs; GET /automation-runs/:runId: bounded authorized history and node/action logs.

Use existing success/error envelopes, strict validation, cursor fences and operation idempotency. Version changes never mutate immutable versions. Phase7 uses these routes for repair, ownership changes and AI draft entry; do not invent a separate editor-only engine.

## In-app notifications

Separate server-only notification records support assignment, discussion, deadline and automation categories. Deterministic identity includes original event/occurrence, category and recipient. Assignment targets newly assigned owner/assignees, excluding the acting user. New discussion messages notify explicit mentions, reply author and current task owner/assignees, deduplicated and excluding the author. Editing a message notifies only newly added mentions. Moderation must prevent old body exposure. Deadline targets current owner/assignees at due-date09:00 Vietnam, once per semantic occurrence. Automation uses its explicit validated recipients.

Recipient APIs under /api/projects/notifications: GET list (optional projectId/category/unread filter, cursor), PATCH /:notificationId read boolean, GET /:notificationId/target for current-authority deep-link resolution. Preferences GET/PATCH /notification-preferences support project/category mute, scoped to the current UID. Place these before parameterized project routes. No caller supplies another recipient UID. Mute suppresses creation/delivery for the matching category while retaining existing read history; unmute does not replay suppressed notifications.

List/detail/read mutation recheck current recipient identity and project authority. Revoked membership omits the record; inactive task/discussion references return a generic unavailable tombstone without old sensitive labels/body. Deep links resolve current canonical selection and never trust persisted hrefs. Paginate the authorized feed explicitly; do not advertise a complete unread count derived from a page. Preserve existing CRM notification behavior.

A flat Projects notification panel exposes category/mute, read/unread, retry/loading/empty states and current-authority task opening. Clear cached content and pending callbacks on account/project access denial. Notification source author and UI changes have disjoint file ownership; root owns shared integration/manifest decisions.

## Acceptance

Required real persisted tests: immutable A→B→C event semantics; version activation race; duplicate delivery/concurrent workers; two equal actions at different positions; crashes before/after effect commit; delayed restart and changed authority; due reschedule/A→B→A/date clear/title-only edit/archive/restore; coherent final-child races/reopen/reparent/zero-child; typed conditions/branches; cyclic rules and bounds; broken references; precise notification counts/self suppression/mute/read privacy/moderation/deep links/direct Firestore denial. Include feature-off preservation and no provider call.

Required Chrome notification flow is added to the Phase6 manifest alongside engine/persisted checks. Use real Auth/Firestore and shipped UI, with account-switch/held-response fences. Phase7 separately verifies the full designer. Do not claim deployment, actual scheduler execution in production or paid provider behavior from local service tests.

## Review clarifications (authoritative over ambiguous wording above)

- Automation notification identity is runId + immutable node/action path + recipient. Built-in notifications retain event/occurrence + category + recipient identity. Distinct notify nodes or rules must never collapse into one effect.
- Due admission transactionally captures the current active-version registry and checks current due-generation/lifecycle. A newly activated due rule applies to an already-due eligible task only if its scheduled firing time is on or after that version's activation time. No retrospective catch-up for pre-activation deadlines. Once admitted, the run retains that immutable version; disabling cancels pending effects, and re-enabling does not revive canceled runs or already-completed occurrences. A new version can apply to future occurrences under this policy.
- move_section means move the selected target subtree to the destination section root; the preview explicitly states that a nested target will leave its current parent. This uses the existing canonical moveTask semantics and never silently preserves an impossible cross-section parent relation.
- Internal execution context must validate current actor, enabled rule, prepared journal and exact lease token inside the canonical effect transaction before writes. A separate preflight lease check is insufficient. The context is constructed by the executor and unavailable to HTTP callers.
- Initial and duplicate rule versions designate the authenticated creating Owner as actorUid. A later version may select another current Owner; transfer never rewrites an older version/run actor.
- A reply's notification recipient is the validated parent message author, not the new reply author. Resolve it transactionally; still suppress the acting author and deduplicate with mentions/assignments.
- When the automation feature flag is disabled, activation is rejected and automation processors neither apply effects nor acknowledge/consume queued work. Persist it for later processing, subject to normal lease/authority/lifecycle checks. Built-in Projects assignment/discussion/deadline notifications remain available while the Projects feature itself is enabled. Turning Projects off pauses both without deleting data.

## Frozen notification DTO for parallel implementation

Existing success:true envelope applies. GET /notifications returns items, nextCursor and hasMore. Each item contains notificationId, projectId, category, createdAt, read and available; message/taskLabel are present only for a currently available target. Do not return stale labels for tombstones. Filters are optional projectId, category and unread; cursor binds current UID and normalized filter scope. A bounded authorized page is not a global unread total.

PATCH /notifications/:id accepts read:boolean and returns notificationId/read; setting the same boolean is idempotent. GET /notifications/:id/target returns available:true/projectId/taskId/optional messageId, or available:false without a stale destination. Permission loss rejects or omits the record according to the list/detail boundary; persisted href is never trusted.

GET /notification-preferences returns revision and muted:[{projectId,category}]. PATCH accepts expectedRevision and the complete replacement muted list, validates each project/category/current authority, and atomically increments revision; stale revisions return409. Default revision0 and empty muted list. No arbitrary UID or broad account-wide wildcard is accepted. UI retains unsaved preferences on transient failure and refreshes conflict state explicitly.

## Exact notification task opening

GET /:projectId/tasks/:taskId returns the current authorized task DTO as task, including pathIds/ancestor context needed for canonical Board selection and existing generic CRM redaction. Notification target resolution returns IDs only; the client then selects the project and reads this exact task, fencing every await by current account/project/generation. Current content and effective ancestry checks apply again at task read. Do not scan all paginated tasks to open a notification.

## Processing edge policies

Mute is evaluated at delivery creation; suppressed delivery needs a durable processed marker, preventing unmute/redelivery replay. An otherwise eligible due occurrence whose task or ancestor is inactive at firing becomes durably canceled/suppressed for that generation. Restore after firing does not catch up; restore before firing remains eligible. A new due date edit creates a new generation. Unauthorized feed scanning may return an empty page with a valid continuation; it must not prematurely terminate traversal or expose unauthorized totals. Unsupported event schema yields a visible processing failure rather than silent acknowledgement.

Saving a candidate version does not implicitly disable an existing active version or cancel its captured runs. Keep active currentVersion distinct from candidateVersion. Explicit disable advances cancellation generation; activating a new version while enabled preserves already captured prior-version runs, each using its immutable definition/actor. Duplicate creates a disabled rule. Preview resolves required dynamic recipients against the sample and exposes empty/broken references before activation.
