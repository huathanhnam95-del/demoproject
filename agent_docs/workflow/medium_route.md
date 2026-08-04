# Medium Route

Use this workflow only after the user selects the Medium route under the project `AGENTS.md`.

## Main-agent role

The main agent performs the work directly without spawning or delegating to subagents. Use the full project workflow proportionately: understand relevant context, plan when needed, implement the requested changes, verify the result, and keep work within scope.

## Stage execution

Divide substantial work into bounded stages such as context loading, targeted inspection, implementation, verification, and final review. Before each stage, batch independent, already-known, non-conflicting operations according to `AGENTS.md`. Keep dependent or overlapping edits sequential. Run checks concurrently only when they do not share build output, generated files, fixtures, databases, ports, devices, or other mutable state.

Do not manufacture stages or commands merely to create a batch. Small tasks may remain a compact inspection, edit, and verification sequence.

## Plans and status

The project-level implementation-plan approval rule remains controlling. For an approved durable or multi-session work package, record goal, scope, constraints, acceptance criteria, major steps, dependencies, verification, blockers, and next action in `agent_docs/project_progress.md`.

Update that file at most twice per coherent package:

1. Mark the package active and record its bounded plan.
2. Reconcile final status, verification evidence, blockers, and next action.

Do not use durable documents as live scratch state.

## Documentation and working rules

Update durable documentation only for architecture, structure, workflow, public behavior, significant decisions, or module usage changes. Use verified implementation and test results as the source of truth. Preserve unrelated user work, keep changes focused, and never hide blockers or claim unrun checks passed.

## Blockers

Record the failed step and exact evidence, suspected cause, completed changes, repository state, affected criterion, and the decision or external input required. Never present partial work as completion.

## End-of-session handoff

Run this only when the user directly says `end this session`, ignoring capitalization and surrounding punctuation.

1. Confirm verification occurred after the last relevant change.
2. Collect compact final status, diff, whitespace/error, and changed-file review evidence.
3. Clear `project_progress.md` if the package is complete; otherwise reconcile it.
4. Replace `latest_session_work.md` with changes, verification, pending work, blockers, and the next entry point.
5. Update durable docs only when warranted.
6. Stage or commit only when consistent with the user's request and the controlling project Git rules.
