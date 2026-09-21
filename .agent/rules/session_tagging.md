---
trigger: always_on
description: Automatically mark verified deployable tasks (R); PAR discovers, integrates, verifies, commits, pushes and deploys the ready project batch; (D) requires live verification.
---

<!-- BEGIN UNIVERSAL PAR RELEASE v1 -->
# Automatic readiness and PAR release command

User-approved 2026-09-20 for every project and agent host. Read the universal parallel-work safety policy too. This protocol replaces older R4D/PAR/session-tagging instructions. Configuring or discussing PAR does not invoke a release.

## Commands and states

- Automatically mark a deployable task (R) when its approved implementation is complete, required local verification passes, its exact owned changes are recoverable, dependencies/targets are recorded, and no known blocker prevents release with those dependencies. Do not wait for the user to type R4D. Planning-only, partial, failed, or unverified work is not ready. (R) means eligible for coordinator release review, not already merged or guaranteed deployable against the latest live state.
- R4D remains a manual request to evaluate readiness now; never apply (R) merely because it was requested.
- PAR (case-insensitive, as an actual command) means Push All Readied: discover and revalidate ready work, integrate, verify, commit, push, deploy, and verify live. This explicit command authorizes those stages for the selected ready batch and its recorded deployment targets. Do not ask the user to repeat approval for each normal stage.
- Bare PAR is scoped to the current project/repository and its established integration destination and confirmed targets. Broaden only when the user explicitly names a broader scope. Infer established targets from verified project/release records; ask only if a material target, product decision, credential, or authority remains genuinely missing.
- (D) means the task's exact approved changes were pushed and successfully verified on all its intended production surfaces. Commit/push alone, a successful deploy command alone, or partial deployment is not (D).
- Before new implementation invalidates an (R) or (D) task, remove that prefix and mark its current readiness stale; preserve historical deployment receipts. Read-only status questions alone do not invalidate a verified release.

## Shared readiness record

Titles are a discovery aid, not the source of release evidence. Each producer maintains one record, not a shared CSV rewrite. For Git projects resolve the absolute common Git directory with git rev-parse --path-format=absolute --git-common-dir; use <common-git-dir>/agent-release/tasks/<host>-<task-id>.json. All worktrees and hosts for that repository use this same directory. For non-Git projects, record one agreed external registry location in the project instructions before write work.

The record must contain:
- schemaVersion: 1; host and verified task/session ID; original title; repository/common-directory identity; current worktree and branch.
- Approved task scope; exact base SHA and candidate commits, or an external owned-change patch/snapshot path with hash and base. Include untracked source if needed; a status/hash list alone does not preserve content. Do not commit another owner's work just to become ready.
- Exact owned create/modify/delete/rename paths; shared contracts; dependencies and origin task IDs; intended destination worktree/branch; remote and explicit deployment targets/surfaces.
- Verification commands, actual results, evidence paths, candidate identity, remaining blockers, and verification time.
- Readiness (ready/stale/blocked), completed stages, source-to-integration SHA mapping, release/batch receipt path, and whether the native title update succeeded.

Write only the producer's own record. Re-read before an update and coordinate any handoff with its owner. The record does not itself lock a checkout. Do not put credentials or secret values in it. Keep failure and deployed identities recoverable. If the host cannot rename titles, a verified ready record is the fallback; report that the visible title was not changed rather than pretending it was.

## Native task identity and title changes

Use supported host APIs and verify the exact task/title before adding one leading (R), replacing it with (D), or removing it. Preserve the remainder of the title. Never use another host's UUID or infer a session from whichever database file was most recently modified.

- Codex desktop: discover with list_threads (including pinned tasks), read_thread and list_archived_threads when needed; rename with set_thread_title using the verified threadId. Match common repository identity rather than requiring identical worktree paths. Use saved cursors/pagination or a sufficient supported listing; a short recent list is not all tasks. If the coordinator is not running in Codex, use an authorized Codex connector when available or the common readiness records.
- Antigravity: prefer a supported native title API. In a project with the existing scripts/session_tagger.py helper, list-ready is Antigravity-only. Mutating calls must name the verified Antigravity CID explicitly: mark-ready --cid <cid>, remove-ready --cid <cid>, remove-deployed --cid <cid>, or mark-deployed --cid <cid>. Verify the result by reading the exact session. Never use the helper without a CID, use --pattern/broad tracing as a mutation shortcut, or pass a Codex/Claude ID.
- Claude, Gemini CLI, OpenCode, Cursor, and other hosts: use their supported task/title tools where available. Do not edit private session databases or invent unsupported rename commands. Use the common per-task readiness record if no supported title API exists.

## PAR coordinator sequence

1. **Discover and freeze scope.** Establish one integration/release owner. Read this protocol, project release instructions, the shared registry, registered worktrees, and accessible native task lists. Reconcile the union of (R) titles and ready records for this repository. Inspect completed unmarked tasks/worktrees where evidence exists; promote them only after the same readiness checks. Do not assume a clean, idle, archived, or completed-looking worktree is ready. Record discovered, eligible, blocked, excluded, and already-deployed items. Report inaccessible hosts/listing limits; do not claim exhaustive discovery without evidence. Freeze candidate identities and batch membership before integration; newly readied work waits for the next batch.
2. **Validate candidates.** Check each exact commit/patch, scope, dependencies, tests, dirty/untracked/ignored work, writer activity, intended destination, and deployment targets. Invalidate stale readiness and remove misleading (R) tags. Check ancestry and patch equivalence; skip duplicate application but retain work that is integrated and still needs publication. A legacy (R) title without a record requires reconstruction and verification. Preserve active/unowned work.
3. **Prepare the current destination.** Refresh the actual intended destination and relevant remote state safely; record HEAD, ownership and protected content. Use the established main worktree and branch for this repository; 'main worktree' does not imply a branch named main. Apply the universal preflight; dirty overlaps or unknown ownership stop the affected integration. Do not use reset/stash/clean, broad WIP merges, or wholesale old-file replacement to clear it.
4. **Integrate sequentially.** Order dependencies, reconcile each reviewed delta and shared contract, recheck destination drift, and record source-to-result mappings. Re-run affected integration and cross-feature tests plus required structure/generated-output checks on the settled candidate. Apply project version/changelog rules only as required. Do not invent a version from an old instruction example or include unrelated local changes.
5. **Commit, push, and reconcile production.** Commit only the verified batch changes (or record already committed equivalents), inspect the exact publishable Git history/delta, and push to the confirmed remote/branch under project rules. Never force-push or publish unrelated history just to make PAR succeed. Immediately before deployment, inspect current live versions and full affected configuration; prove current production plus this approved batch. Reconcile/reverify any drift. Freeze the source SHA/artifact and record recovery steps.
6. **Deploy and verify live.** Publish only recorded targets/surfaces, serializing overlapping publishers. Preserve complete live manifests, runtime configuration, rules, and stored data. PAR does not authorize destructive migrations, data replacement, unrelated cleanup, or new targets; obtain any missing authority for those effects. Verify deployed identities and affected/shared live workflows. Check remote Git provenance as required.
7. **Record accurate completion.** Save a batch receipt under <common-git-dir>/agent-release/batches/<batch-id>.json containing selected tasks, authorization, source/integration/pushed SHAs, artifact hashes, targets, previous/new live identities, checks, outcomes, and recovery paths. Update only successfully verified task records and titles to (D), including the coordinator if its entire release scope succeeded. Keep incomplete/partial tasks clearly pending or blocked; do not mark an entire batch deployed after one surface succeeds. Reread titles/records to confirm and report exact results.
8. **Handle blockers and retries.** Continue safe independent eligible items when a blocked item can be excluded without violating dependencies/shared release contracts. Otherwise stop the affected group and explain the concrete blocker. Record completed stages; on retry inspect remote/live identities before replaying actions. Never automatically restore an older whole release over newer valid changes. If nothing eligible remains, report that without an empty commit or deployment. Worktree cleanup is separate and remains subject to its own authorization and preservation checks.

## Adoption and limits

Maintain identical marked copies from C:/Users/Admin/.agents/policies/release-readiness.md in the registered host-native files and workspace rule. Every producer reads the current protocol before marking readiness; every coordinator reads it on PAR. For remote hosts with separate Git storage, collect their verified handoffs through supported access and explicitly record missing coverage. This is an agent-executed command protocol, not a background watcher, universal title API, or installed Git enforcement hook.
<!-- END UNIVERSAL PAR RELEASE v1 -->

