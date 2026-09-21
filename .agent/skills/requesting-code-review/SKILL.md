---
name: requesting-code-review
description: "Prepare and perform a focused review of completed or in-progress changes, or request an authorized reviewer. Use to assess requirement coverage, correctness, security, regressions and maintainability against the actual candidate."
---

# Review a concrete candidate

Identify the requested scope and acceptance criteria. Review the actual change state; a commit range alone does not include dirty work. This skill can be executed directly and does not require delegation.

## Establish scope

Read repository instructions and inspect status before selecting a diff. Include the relevant staged, unstaged and untracked files when reviewing work in progress; read new files directly. For a committed change, verify the base and candidate revisions. Preserve unrelated edits and identify which changes belong to this task.

Read changed logic with its callers, contracts and tests. Generated outputs, schemas, configuration, dependencies and shared entry points need explicit attention when affected. Do not stage, reset, commit or modify source merely to obtain a reviewable diff.

## Review distinct concerns

1. **Requirements:** Does the candidate deliver the requested behavior, including relevant error, empty, loading and recovery paths? Are omissions or scope expansion hidden by tests or summaries?
2. **Correctness and risk:** Trace important inputs, state, async ordering and failure paths. Check authorization, trust boundaries, data loss, persistence, compatibility, resource lifecycle and meaningful performance risks.
3. **Standards and maintainability:** Apply the project's actual conventions. Assess contracts and complexity from caller evidence. An optional [simplicity review](../code-refactoring/references/simplicity-review.md) can reveal avoidable machinery, but fewer lines do not outweigh required behavior or verification.

Evaluate the assertions and evidence, not just a passing test count. Distinguish a reproduced failure from a plausible risk. Do not invent findings to fill a quota or promote personal style preferences into defects.

## Report and hand off

Return actionable findings in severity order with file/line, concrete trigger, consequence and a bounded correction. State assumptions, unverified areas and tests performed. If no actionable defect is found, say so with the review's limits.

If the selected route authorizes delegation, give the reviewer the exact candidate, requirements, owned scope and verification evidence using the host's actual tools. Otherwise review directly. No absent Task API or code-reviewer template is required.

After fixes, inspect the actual updated diff and rerun affected checks. Review completion does not authorize merging, pushing or deploying. [Provenance](SOURCE.md).
