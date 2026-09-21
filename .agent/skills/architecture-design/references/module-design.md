# Module design: evaluate complexity at the callers

A useful module hides substantial knowledge behind an interface that callers can use correctly. Judge interface complexity alongside implementation complexity; a short function that forces every caller to reconstruct policy can make the system harder to maintain.

## Diagnostic questions

- What must a caller know, in which order, to use this component correctly?
- Which invariant has one clear owner? Which is repeated or contradicted elsewhere?
- Do the interface and returned values describe the caller's task, or expose incidental storage and orchestration details?
- If this abstraction disappeared, would the system lose an enforced rule or would it simply lose a forwarding layer? Trace representative callers before deciding.
- If two modules merged, would complexity be hidden more effectively, or would separate responsibilities, security checks or deployment lifecycles become entangled?
- Is a seam useful because a real dependency varies or needs controlled testing? An interface is not justified merely because another layer could exist.

## Design and migration

Compare a focused alternative with the existing contract. Explore two interface sketches when the tradeoff is genuinely unclear, not as mandatory ceremony. State the caller changes, total complexity, compatibility risks and verification implications.

Prefer tests of public behavior, including meaningful boundary and integration tests. Keep lower-level tests when they protect important invariants or make failure diagnosis effective. Before replacing or removing tests, show that independent assertions and required coverage survive; moving code is not evidence that tests are redundant.

For wide changes, expand compatibility first, migrate bounded callers, verify old and new paths, then contract only after use and compatibility evidence justify it. Keep authorization, transaction, persistence and recovery behavior explicit throughout.

No line-count limit, ban on ordinary architecture terms, or prescribed number of layers decides the result. A no-change conclusion is valid when the proposed benefit does not exceed migration and maintenance cost.

Adapted from Matt Pocock's codebase-design and deepening references; see [provenance](../SOURCE.md).
