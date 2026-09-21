---
name: domain-modeling
description: "Resolve ambiguous domain terminology, business rules, entity relationships and state meanings across code, product workflows or documentation. Use when differing meanings block a decision or implementation, or when a glossary is requested."
---

# Domain modeling

Produce a shared, evidence-backed model of the concepts needed for the current task. Work in conversation unless durable documentation is requested or already part of the authorized task.

1. Find existing terminology in project documentation, schemas, UI labels, tests and relevant behavior. Trace the smallest representative workflow before proposing new names.
2. Separate business meaning from storage and implementation. A table, screen or class is evidence about a concept, not automatically its definition.
3. Identify overloaded terms, identity and lifecycle rules, ownership, cardinality, and invariants. Distinguish observations, proposed changes and unresolved questions.
4. Ask only about consequential domain choices that evidence cannot settle. Do not invent business policy from a variable name or fill gaps with fabricated user research.
5. Test definitions against concrete examples and counterexamples: two similarly named objects, a failed transition, a duplicate, a deletion, or a historical record. Include only examples relevant to the task.

## Output

Use a compact glossary when useful: term, definition, examples or boundaries, and evidence. Add relationships or a state diagram only if they clarify behavior. Explicitly flag conflicting usage rather than silently standardizing it.

For an authorized documentation update, discover the project's existing glossary and decision-record conventions. Record settled terms there. Create a decision record only for a consequential tradeoff worth preserving. Do not prescribe CONTEXT.md, a docs/adr directory, or any one repository's naming scheme globally. Respect existing file ownership.

Renaming code, migrating data and changing product rules are separate implementation work; do not perform them merely because the model reveals a mismatch. Return a bounded proposed change if needed.

Stop when the requested concepts have usable definitions and remaining uncertainty is explicit. No artifact is required for a trivial terminology clarification. [Provenance](SOURCE.md).
