# Heavy Route

Use this workflow only after the user selects the Heavy route under the project `AGENTS.md`.

## Main-agent role

The main agent owns direction, planning, package boundaries, coordination, integration, targeted critical review, `agent_docs/project_progress.md`, and `agent_docs/latest_session_work.md`. Delegate bounded production implementation, independent testing, investigation, and durable documentation to specialist agents without duplicating their exhaustive work unless risk or conflicting evidence requires it.

Simple questions inside a Heavy-route session do not require unnecessary delegation.

## Plans and status

The project-level implementation-plan approval rule remains controlling. Once implementation is approved, record goal, scope, constraints, acceptance criteria, ordered phases, stable task IDs, roles, dependencies, verification gates, blockers, parallel boundaries, and next action.

For each durable package, update `project_progress.md` at most twice: once to activate the bounded package and once to reconcile the final verified state. Use `latest_session_work.md` only for durable cross-session state or an explicit `end this session` handoff.

## Specialist roles

- `explorer`: read-only investigation of bounded code, tools, libraries, applications, or configuration.
- `executor_luna`: default implementation worker.
- `executor_sol`: exceptional fallback for difficult cross-cutting work that cannot be narrowed; never use more than one at a time.
- `tester`: independent focused testing and failure analysis.
- `doc-writer`: verified durable documentation, excluding the two main-agent-owned status files.

Use a proportionate worker count. Every spawn must use `fork_turns="none"`. A first task capsule must be self-contained and no more than 400 words, with: task ID, outcome, ownership, acceptance criteria, source paths, validation, protected areas, and return format. Include only necessary documents, source/test interfaces, expected edit surface, and protected scope.

Workers may inspect adjacent dependencies only to diagnose a blocker. They must report evidence and proposed scope changes, then wait for the main agent to amend ownership. Subagents must not edit Git state, `project_progress.md`, or `latest_session_work.md`.

Start with `executor_luna` for implementation. Add the tester after the executor's smallest relevant self-check unless parallel test research is clearly independent. Delegate documentation only after verification. Split work only across genuinely independent modules or files.

Follow-ups should normally be no more than 120 words and contain only package ID, iteration, changed state, new evidence, affected criterion, and next action. Worker events are `proof`, `defect`, `blocker`, `replacement/takeover`, and `final`; intent-only updates are not evidence.

## Lifecycle and repair loop

Reuse one executor thread per work package and one tester thread per verification package. Send verified production defects back to the same executor and corrected work to the same tester.

If a worker returns no concrete evidence, send one short delta retry. A second consecutive evidence-free response requires replacement. If both original and replacement fail, disclose the loss of independent execution and take over only as allowed by the controlling project rules.

Use waits of about 60 seconds and rely on events instead of frequent polling. Store long logs in a temporary directory and report exact commands and log paths rather than pasting them into agent messages.

## Execution and verification

1. Executor implements a coherent increment and runs the smallest relevant check.
2. Executor repairs scoped production failures and reruns until validation passes or a genuine blocker is evidenced.
3. Tester adds or updates deterministic coverage, runs the focused gate, then the required broader regression.
4. Tester fixes only test, fixture, mock, or test-data defects; production defects return to the executor.
5. Repeat only in response to new evidence; never weaken validation or claim unrun checks passed.

The main agent should not rerun checks already evidenced by the responsible role unless later changes, conflicting evidence, or integration risk invalidate them. Keep changes within approved plan boundaries and avoid unrelated refactors, silent error suppression, and unplanned public API or schema changes.

At the end of a Heavy-route shift, report each specialist role and how many times it was called.

## Blockers

Workers report `partial` or `blocked` with the failed step, evidence, suspected cause, completed changes, and required decision. If a required role is unavailable, report that explicitly rather than silently presenting a reduced workflow as complete.

## End-of-session handoff

Run this only when the user directly says `end this session`, ignoring capitalization and surrounding punctuation.

1. Collect checkpoints only from incomplete workers and confirm current verification.
2. Complete warranted durable documentation.
3. When meaningful project files changed, use or spawn one read-only `explorer` for a bounded closure audit of changed-file counts, diff statistics, whitespace/errors, largest unignored file, generated payloads, unexpected scope, and blockers.
4. Reconcile or clear `project_progress.md`, then replace `latest_session_work.md` with the verified handoff.
5. Run only compact checks required by those predictable status writes.
6. Stage or commit only when consistent with the user's request and the controlling project Git rules.

Every completed session must leave honest status, bounded changes, current verification, preserved user work, and a clear continuation point.
