---
name: writing-plans
description: "Decompose an approved goal or substantial specification into executable, independently verifiable slices when a plan is requested or needed for coordination. Keep simple tasks direct and follow the current project documentation and approval rules."
---

# Executable planning

Establish the intended outcome, existing behavior, protected work and acceptance criteria. Read the relevant code and project conventions before naming implementation paths. Ask about unresolved product decisions, not facts the repository can answer.

## Slice by useful behavior

Prefer vertical slices that deliver or prove an end-to-end capability. An infrastructure-only task is appropriate when it is a real prerequisite, not merely because layers can be assigned separately.

For each slice state the outcome, required inputs, owner, exact files or contracts when known, verification, and actual dependencies. Distinguish hard prerequisites from work that merely happens nearby. Do not promise parallelism for shared files, mutable test environments or unknown contracts.

Separate discovery tasks from implementation-ready tasks. Where paths are not yet known, bound the investigation and its output rather than inventing filenames or declaring a blanket directory allowlist.

For a wide migration, consider expand, migrate and contract: provide compatibility, move bounded consumers with evidence, then remove the old path only when remaining use and required coverage have been checked. Preserve an explicit recovery route for stateful changes.

## Make execution unambiguous

Include applicable tests and success criteria, relevant runtime or data prerequisites, output destinations, ownership boundaries and material risks. Use steps large enough to represent meaningful outcomes; do not force every action into a tiny timed task.

Reuse compatible existing worktrees. Create one only for an authorized parallel writer or a justified release/verification boundary under the account rules. A planning skill does not itself authorize agents, publication, migration or production deployment.

Use the requested artifact and the project's existing documentation locations. Respect any explicit plan-feedback gate. Do not create implementation_plan.md or another gated artifact just to add ceremony to a small task. Keep durable plans current when scope changes, without overwriting other owners' work.

Complete when the next implementer can identify what to change, what to preserve, what depends on what, and how to prove success. If implementation is already authorized and no applicable gate remains, continue according to the chosen route. [Provenance](SOURCE.md).
