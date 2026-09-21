---
trigger: always_on
description: Preserve every task's work through exclusive ownership, reviewed integration, safe publication, and scoped cleanup.
---

<!-- BEGIN UNIVERSAL PARALLEL WORK SAFETY v1 -->
## Universal parallel work, integration, and data preservation

User-approved 2026-09-20 for all projects/worktrees/tasks and hosts: Codex, Gemini/Antigravity, Claude, OpenCode, Cursor, and others. Project rules may strengthen it. This grants no additional action authority; preserve user scope and host model rules.

### Ownership

1. **Inspect and reuse.** Identify common Git directory, branch/HEAD, destination, dirty/index/untracked state, and worktrees. Reuse compatible worktrees; create only for authorized parallel writing or necessary verification/release isolation. Avoid duplicate dependencies and whole-repository snapshots. Worktrees isolate editing, not integration or live data.
2. **One integration owner.** Use one coordinator and shared record per repository/destination across hosts. Reuse coordination or an external record keyed by the common Git directory. Record tasks/owners, paths/worktrees/branches/base SHAs, shared interfaces, dependencies, protected work, deployment/data surfaces, tests, handoffs, and retirement. Unknown ownership means serialize affected writes.
3. **One writer per resource.** Parallel tasks need disjoint paths and agreed interfaces. Shared entrypoints, config, lockfiles, generators/outputs, schemas/rules, runners, trackers, instructions, emulators, and data have one writer. Workers hand shared edits to that owner. Transfer after the writer stops and hands off. Tracking mandates never permit concurrent CSV edits; writing tests/generators also count as writers.
4. **Serialize Git and releases.** Only the coordinator changes the integration index/branch/HEAD. Never concurrently stage, commit, merge, cherry-pick, rebase, or switch in one checkout. Require exclusive coordination for shared destinations/releases; ledger notes, timers, and Git index locks do not lock the whole workflow. Unconfirmed ownership means wait for handoff and continue independent reads; never take over a slow writer.

### Preservation and integration

5. **Protect unfamiliar work.** Never reset, stash, clean, overwrite, delete, stage, or commit another task's work to clear a blocker. Preserve staged, dirty, untracked, and meaningful ignored files. Hashes/status are not backups. Before an operation can affect unique work, have its owner preserve a recoverable commit or verified narrow backup and record the restore location. Unrelated dirty paths may remain untouched; dirty overlaps stop the affected operation.
6. **Focused handoffs.** Supply small commits/exact patches with base SHA, owned paths, dependencies, tests, and issues. Stage owned paths only. Never bundle unrelated work or treat broad WIP/recovery snapshots as the feature delta.
7. **Required preflight.** Record destination SHA, candidate SHA or patch hash/base, dependencies, exact file/hunk changes, deletions/renames, shared conflicts, and source/destination index/dirty/untracked/ignored state. Check ancestry and patch equivalence for integrated work. Review config, generated pairs, schemas, lockfiles, and cross-feature interfaces. Stale review, unexplained changes, missing dependencies, unowned conflicts, or dirty overlaps block integration.
8. **Choose from history.** Normal merges are allowed when the entire branch delta is intended and reviewed. Old bases alone do not cause loss. For mixed workstreams, apply reviewed commits/hunks plus dependencies to the current destination; cherry-picking is not inherently safer. Never blindly choose whole ours/theirs files, copy old directories, or accept unrelated deletions. Preserve both tasks' behavior; unresolved product intent needs user direction.
9. **Integrate sequentially.** Immediately re-read destination HEAD, ownership, index/status, and protected overlapping hashes before applying; drift invalidates preflight. Integrate one candidate, record its SHA and source-to-destination mapping, then refresh the next. Never rebase/reset/switch another agent's active checkout; its owner refreshes at handoff.
10. **Verify the candidate.** Check the final diff against the captured destination: intended delta, protected work retained, generated consistency, interface compatibility. Run focused feature and affected cross-feature checks. Conflict-free merges, clean trees, and isolated tests are insufficient alone. Record tests/failures/limits; separate implemented, verified, integrated, pushed, and deployed states.

### Publication and retirement

11. **Preserve current production.** Deployment needs explicit authorization; push/data writes retain separate scope. One publisher owns overlapping site/service/rules/database/config surfaces. Inspect current live versions and complete configuration immediately before publishing; prove current production plus approved changes. Reconcile/reverify drift. Preserve complete Hosting manifests/config, replaced backend source/runtime config, and current rules. Never publish old worktrees wholesale. Follow project Git synchronization rules.
12. **Protect stored data separately.** Git does not back up databases, uploads, or local datasets. Tests use isolated data. Live migrations/imports/restores/cleanup need authorization, exact targets, current schema/version checks, verified backup/recovery, and an appropriate preservation method: transactions, conditional writes, idempotency, or staged migration. Never restore an old whole dataset over newer records. Recovery preserves subsequent valid writes/releases.
13. **Retain and retire safely.** Retain source/integration SHAs, artifact hashes, targets, tests, approved scope, previous live identities, and recovery steps. Mark integrated work to prevent replay. Authorized cleanup requires checking unique commits, dirty/untracked/meaningful ignored files, users/processes, and evidence reachability. Use exact paths and non-force removal; never remove dirty/uniquely referenced work or its only recovery route.

### Adoption

- Existing worktrees follow this policy at their next affected action; integrated does not mean safe to delete.
- Source: C:/Users/Admin/.agents/policies/parallel-work-safety.md. Keep marked global/workspace copies identical; preserve other instructions and verify synchronization.
- New hosts/projects must load supported global/project instructions before writes; existing sessions reread before affected actions. Local files do not configure remote/unknown hosts.
- These are mandatory agent instructions, not installed hooks or filesystem locks. Claim automated enforcement only after installing and testing a real gate. Policy updates also require scoped ownership.
<!-- END UNIVERSAL PARALLEL WORK SAFETY v1 -->
