---
name: architecture-design
description: "Design or evaluate a new system or substantial feature when boundaries, state ownership, consistency, scale, reliability or deployment tradeoffs matter. Use existing project constraints; routine local changes do not require an architecture process."
---

# Architecture design

Start with the behavior to deliver and the constraints that could change the decision. Read the existing system before designing its replacement.

## Frame the decision

Establish relevant users and operations; state and data ownership; expected load and latency; consistency and failure behavior; security and privacy boundaries; integration contracts; deployment, operating cost and recovery constraints. Use measured values or label assumptions. Ask only for material choices that cannot be inferred; there is no required question count.

## Compare viable designs

Usually compare the existing design with one focused alternative. Add another only when it resolves a real tradeoff. Explain dependency direction, interfaces, important data flows, failure modes and how each choice meets the requirements.

For module boundaries, read [module-design principles](references/module-design.md). Hide meaningful complexity behind a clear interface and assign each invariant an owner. Avoid layers that merely forward calls, but retain boundaries that enforce authorization, transactions, compatibility or independent change.

For distributed work, make timeouts, retries, idempotency, ordering and partial failure explicit where relevant. For evolving data, describe compatibility, migration, rollback or forward recovery, and the interval when old and new versions coexist. Do not add queues, services or persistence solely for hypothetical future scale.

## Make the decision reviewable

State the recommended design, why it fits, what it gives up, and the evidence or threshold that would justify revisiting it. Use a small diagram only when it clarifies the decision. Define acceptance and verification proportionately, including important failure paths and observability.

Keep the design in the requested format and existing project documentation conventions. Planning alone does not authorize source edits, new worktrees, publication or deployment. If implementation is already authorized and the design is sufficiently determined, proceed under the project's route without reopening settled approvals.

Stop once the decision is actionable and unresolved risks are explicit. Do not produce elaborate alternatives for a solved local problem. [Provenance](SOURCE.md).
