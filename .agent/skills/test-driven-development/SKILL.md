---
name: test-driven-development
description: "Use behavior-focused red-green-refactor when implementing testable logic or fixing a bug that benefits from a regression test. Apply proportionately; cosmetic, documentation and other low-impact reversible edits do not automatically require new tests."
---

# Behavior-focused test development

Define observable success before changing behavior. Read existing tests and public contracts; reuse the project's test tools. Choose the test level that can expose the real risk with useful failure diagnostics.

## Red, green, refactor

1. **Red:** write one focused test for a required behavior or regression. Derive expected results independently from the implementation using known examples, fixtures, specifications or a separate calculation. Run it and establish that it fails for the intended missing or broken behavior, not bad setup.
2. **Green:** implement the complete behavior needed for that case while retaining existing requirements. Run the focused test and relevant adjacent checks. Do not weaken assertions or hard-code fixture answers just to pass.
3. **Refactor:** improve structure when it reduces actual complexity, keeping behavior and meaningful coverage intact. Rerun affected tests. Avoid broad unrelated cleanup.

Repeat by coherent vertical behavior. This does not require user approval for each test or interface when the implementation scope is already authorized.

## Meaningful evidence

- Assert outputs, state transitions, errors and side effects that users or callers rely on. Avoid tests that merely repeat private helper calls or duplicate the implementation's algorithm.
- Use unit tests for isolated policy, integration tests for contracts, and browser/native workflows when interaction defines correctness. A persistence requirement can legitimately need a direct persisted-record check.
- Control nondeterministic dependencies at appropriate boundaries. Prefer realistic fakes or fixtures when they preserve the contract; avoid excessive mocks that make a broken integration look correct.
- Cover meaningful invalid input, authorization, failure or recovery cases according to risk. Test count and line coverage alone do not demonstrate safety.
- Keep tests cohesive and readable. Do not create one test per function by rule or remove useful lower-level assertions just because a public test exists.

## Existing work and completion

If implementation already exists, preserve it. Establish the baseline and add independent characterization or regression evidence; isolate a reversible change only when needed to prove failure. Never delete unowned code or tests to restart a TDD sequence. Explain when red-before-green was not observed.

Stop once the requested behavior and affected contracts have appropriate evidence. Report the commands and outcomes, including any untested environment. [Provenance](SOURCE.md).
