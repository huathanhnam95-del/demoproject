---
name: code-refactoring-refactor-clean
description: "Refactor an authorized code area to reduce evidenced complexity, duplication or coupling while preserving behavior and meaningful tests. Use for targeted structural improvements, not speculative rewrites or mandatory cleanup around unrelated fixes."
---

# Behavior-preserving refactoring

Identify the concrete pain: repeated policy, callers that coordinate internal details, inconsistent ownership, brittle tests or difficult changes. Read representative callers and existing contracts before choosing a structure. File length or a metric threshold alone does not justify a rewrite.

Establish the current behavior and relevant test baseline. Preserve dirty work and separate a requested behavior change from a structural change in the reasoning and verification. Use characterization tests where behavior is important but undocumented.

Apply [module-design principles](../architecture-design/references/module-design.md) when changing interfaces or ownership. Use the [implementation playbook](resources/implementation-playbook.md) for sequencing. An optional [simplicity review](references/simplicity-review.md) helps check whether a proposed abstraction earns its cost.

Prefer focused steps that can be reviewed and verified. Move policy to a clear owner, reduce duplication only when the concepts are truly the same, and keep security, transaction, compatibility and lifecycle boundaries explicit. Existing code, platform features and suitable dependencies may be better than a new abstraction.

For wide changes, preserve compatibility while migrating callers. Do not remove old paths until remaining use and behavior have been checked. Do not replace tests solely because their former module disappears; retain independent assertions that protect meaningful behavior.

Verify the changed contracts and original scenarios with proportionate tests. Compare the final diff against the authorized scope, including generated files and shared interfaces. Explain what became easier, what behavior is preserved and what evidence supports that claim. A no-change recommendation is valid if the benefit does not justify the risk. [Provenance](SOURCE.md).
