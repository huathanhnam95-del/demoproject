# Phase9 command preparation

Read-only source investigation during Phase6 regressions. No Phase9 implementation or provider execution. Root must resolve these integration gaps before claiming grouped confirmed AI application.

## Reusable commands and actual limits

Canonical createTask/updateTask/moveTask provide current authority, typed validation, exact operation identity and atomic operation/event persistence. A move changes one subtree, with structure and task revision fences. Recovery bulkUpdateTasks atomically edits up to100 distinct tasks/900KB and records a grouped field inverse; it cannot change parent, section or rank. Calendar preview/apply covers one task with a15minute snapshot fence. Existing Undo compensates one supported operation at a time and has no general multi-step group inverse. createTask records an inverse but its Undo path is not currently supported.

The approved move-three-selected example therefore needs a bounded structural batch: resolve every selected ID/destination/order, calculate the final graph and sibling rebalances, validate cycles/ancestry and all expected revisions, then commit one canonical operation/event with one grouped inverse. Three sequential moveTask calls are not an atomic group. Reversing their existing inverses also fails: each Undo changes structureRevision, invalidating the preceding inverse's original post-move fence.

Assignment/date batches can reuse bulkUpdateTasks only after exact values and per-task revisions are resolved. Calendar-informed assignment/date changes need a batch preview that evaluates the proposed owner/date combination and binds calendar/dependency versions. Correcting only the second task addresses a stable draft action ID and resolved task ID, not a mutable list position; preserve all other actions and invalidate previous confirmation.

## Confirmation and reconnect

Persist draft digest, actor/project, ordered actions, resolved IDs/values, revisions/schema/structure/calendar fences, explicit spoken confirmation evidence and expiry. Consume the matching authorization in the same transaction as the grouped effect. Request-time confirmation alone leaves a race. Reconnect reads current-authority draft/status and the original canonical operation result; it does not auto-apply or substitute a new operation ID after ambiguous acknowledgement.

runCommand has an internal authorize callback before execution/replay that can support the confirmation fence, but current public wrappers do not expose an AI-specific capability. Automation's prepared-payload/journal/lease pattern is reusable as a design; its actual capability requires an enabled rule and designated Owner and must not be reused unchanged for Editor AI commands. Add a separate internal draft capability; untrusted JSON/model output must not forge it.

For bounded application, prefer atomic field or structural batches with matching grouped Undo. If a future request cannot fit atomic limits, explicitly present a recoverable multi-step run with possible partial completion and per-step outcomes; never call it atomic or promise automatic rollback. Creation Undo and project/workflow draft application require explicit verification rather than assuming the stored inverse is executable.

Required proof: concurrent edit after preview before spoken confirmation, revocation during session, two sessions at final budget, stable second-action correction, exact move-three graph and one grouped inverse, crash/disconnect after commit with one operation, and no automatic replay on reconnect. Provider text is proposal data, never authority or confirmation evidence.
