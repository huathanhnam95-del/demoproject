# Optional simplicity review

Use this lens during an authorized review or refactor when complexity is relevant. It supplements correctness, security, accessibility and regression review.

- Is the added behavior required? Identify the requirement before calling it unnecessary.
- Is an existing component, standard-library facility, native platform feature or installed dependency suitable? Check semantics, edge cases and operating constraints before substituting it.
- Does an abstraction hide meaningful policy or enforce a boundary, or does it only add indirection? Inspect representative callers.
- Which concrete requirement or measured threshold justifies configuration, caching, persistence, distribution or extensibility?
- Would removing the code preserve required failure handling, compatibility, authorization, accessibility, observability and test evidence?
- Is the proposed simplification easier to understand and maintain across the whole call path, including operational cost?

Report only useful findings with paths, evidence, benefit and tradeoffs. Do not implement them during a read-only review. Do not score by lines removed, use a smallest-diff quota, or replace complete validation with a single happy-path check. No persistent minimalism mode or hook is needed.

Adapted from Ponytail's reuse and complexity-review ideas. [Provenance and license](../SOURCE.md).
