# Documentation Guidance

This file scopes work under `docs/` to documentation, plans, decisions, runbooks and evidence records. It does not authorize product code, runtime assets, deployment configuration, data migrations or cleanup. Follow the workspace process and protected contracts in [`AGENTS.md`](../AGENTS.md).

## System of record

- [`docs/specs/`](specs/) records feature intent, requirements and user-facing contracts.
- [`docs/plans/`](plans/) records implementation approach, scope and verification.
- Durable architectural decisions may be added under `docs/decisions/` through an explicitly declared documentation change; this directory is not currently a required source root.
- [`docs/runbooks/`](runbooks/) records operational procedures, effects and rollback routes.
- [`docs/audits/`](audits/) records compact, reproducible evidence with source SHA, tool/input identity, hashes, retention and restore information.
- [`agent_docs/project_structure.md`](../agent_docs/project_structure.md) is the single architecture and placement authority. Do not create a competing architecture map in `docs/`.

## Documentation-only rules

1. Start with the relevant spec, plan or decision record. If a requested change is underspecified, record the missing decision or ask the owner; do not invent a product contract.
2. Use explicit names and factual status. Separate proposed, verified, retained and unresolved information. Keep bulky regenerable output in the declared external or ignored evidence destination.
3. Link to authoritative source files and commands instead of copying rulebooks. Product documentation may explain existing behavior, but changing behavior requires the owning source and its verification.
4. Preserve existing product documentation requirements, provenance, privacy boundaries and rollback information. Do not remove uncertain evidence or diagnostic records without an exact-path review and restore route.
5. Keep records legible: use explicit names, avoid magic behavior and document public interfaces with JSDoc or docstrings when documentation changes accompany code. Do not leave commented-out material or unowned TODOs without a linked plan.
6. Every product feature remains verifiable; documentation-only changes state why product tests do not apply. Correct stale guidance encountered in the touched documentation scope when the correction is factual and bounded.

## Checks and supported commands

From the repository root, run `npm run test:structure` for the offline Node-only structure fixtures. For a task-local declaration, first write the external contract and before snapshot, then run:

```text
node scripts/structure/check.cjs snapshot --contract <external-task-dir>/structure-contract.json --out <external-task-dir>/structure-before.json
node scripts/structure/check.cjs check --base <resolved-base-sha> --contract <external-task-dir>/structure-contract.json --snapshot <external-task-dir>/structure-before.json --json
```

These commands inspect files and Git metadata; the snapshot writes only the explicit external output. CI uses a separate committed-tree scope and does not evaluate a human task declaration:

```text
node scripts/structure/check.cjs check --ci --base <base-sha> --head <head-sha> --json
node scripts/structure/check.cjs check --ci --full [--head <head-sha>] --json
```

Exit status `0` means pass (possibly with legacy debt notices), `1` means a structural violation, and `2` means missing, invalid or schema-invalid inputs. These checks do not run application tests, generators, browsers, Firebase, Cloud Run or deployment commands.
