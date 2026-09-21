---
name: systematic-debugging
description: "Diagnose a bug, failing test or unexpected runtime behavior by establishing the exact symptom, testing ranked hypotheses and verifying the cause. Use when the cause is not yet established or a proposed fix needs causal evidence."
---

# Systematic debugging

The objective is a causal explanation and a verified fix for the reported behavior. Match the effort to the failure; a known local cause does not require a long investigation ritual.

## Establish the symptom

Record expected and actual behavior, inputs, environment and relevant revision or artifact identity. Inspect the error and nearby execution path. Seek a repeatable check that detects the exact failure: a unit/integration test, command, recorded request or browser sequence.

If automation is not immediately possible, use a documented manual reproduction, existing logs or a controlled diagnostic probe. Exploratory reading is allowed before a reproduction exists. Clearly mark what has and has not been reproduced; do not claim a fix solely because an unrelated test passes.

Minimize the reproduction only while it still exhibits the original symptom. Preserve meaningful timing, authentication, state, data and integration conditions. A smaller test that loses the failure is not the same reproduction.

## Test explanations

List a small number of plausible causes ranked by evidence. For each, state an observation that would support it and one that would falsify it. Choose the cheapest discriminating check rather than making several speculative edits.

Trace data and state across relevant boundaries: producer, transport, consumer, persistence and rendering. Instrument the boundary where expected and actual behavior first diverge. Redact secrets and personal data; do not log full credentials, tokens or unrelated payloads.

Change one causal variable at a time when practical. Record meaningful attempts and results. After one or two unsuccessful approaches, revisit the reproduction and assumptions under the account's escalation policy instead of repeating the same guess. This skill never changes the model or reasoning setting itself.

## Fix and verify

1. Make the smallest complete change that addresses the evidenced cause and preserves required behavior. Follow the project's ownership and implementation rules.
2. Add a focused regression check where useful. Verify it catches the original failure for the right reason, then passes with the fix. Use independent expected results.
3. Rerun the original scenario in the relevant environment, including state or persistence checks when those define success. Broaden testing only for actual affected contracts or unresolved risk.
4. Remove temporary instrumentation that is no longer needed and account for any diagnostic artifacts. Preserve useful permanent observability deliberately.

Report the cause, change, evidence and remaining limits. If the original scenario remains unavailable, say so and distinguish a plausible fix from a verified resolution. [Provenance](SOURCE.md).
