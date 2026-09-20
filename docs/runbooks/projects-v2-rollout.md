# Projects V2 local verification and rollout contract

Owner: PR12 task `01a0bbbe-6e85-7e41-88f5-1c6804394e13` for this local package; a production release owner is **unassigned**. Follow [repository structure](../../agent_docs/project_structure.md) and [workspace rules](../../AGENTS.md). This document authorizes no release.

Canonical worktree: `C:\Users\Admin\.codex\worktrees\382b\Cursor AI`, branch `codex/projects-v2-wave1`. PR12 starts at `cb1e431c0509bb3b515f2615689349a900ef05bb`; post-PR12 readiness fixes are separate commits on the same branch. Resolve the current immutable identity with `git rev-parse HEAD` and bind every release check to it. The complete PR12 commit-to-package mapping is in `C:\Users\Admin\.codex\external-evidence\projects-v2-pr12-20260920\HANDOFF.md`. Preserve the PR01–11 evidence chain, including failed reviews and their subsequent remediation reviews.

## Local checks

The explicit Projects selection is [verify-projects-v2.cjs](../../scripts/crm/verify-projects-v2.cjs). The existing CRM aggregate also registers every V2 Node test. The general unit registry remains unchanged: `tests/crm/projects` contains both offline and persisted emulator tests, so registering that entire directory as direct unit tests would violate its effect boundary.

From the canonical repository root, inspect without execution:

```text
node scripts/crm/verify-projects-v2.cjs --list
node scripts/crm/verify-crm-suite.js --list
node scripts/crm/verification-selection.cjs check
```

For a fresh settled candidate, set `CRM_TEST_JSDOM` to the available jsdom installation and `TEST_ESLINT_PATH` to the available ESLint package if dependencies are shared. Run:

```text
node scripts/crm/verify-projects-v2.cjs --out <new-absolute-external-directory> --base <exact-parent-sha> --head <committed-candidate-sha> --contract <external-contract.json> --snapshot <external-before.json>
```

Inputs: canonical source/tests, existing emulator guard/configuration, and the external contract/snapshot. Outputs: the new external directory, per-command stdout/stderr, a report with raw source hashes before/after, Chrome captures/reports, and emulator runtime files. The existing emulator helper also owns a temporary lock under ignored `test-results/crm-projects`; do not remove another owner's lock. The runner refuses pre-existing root emulator logs and archives its own diagnostics and exact lifecycle-child PID directories after shutdown, retaining hashes. This prevents generated runtime files from becoming source-placement violations. Effects: offline Node/Chrome checks and isolated demo Auth/Firestore/Storage fixture writes only. Guarded emulator test children receive `CRM_PROJECTS_ENABLED=true`; caller environment and production/presentation configuration remain unchanged. No deployment, credential acquisition or production reads/writes. Chrome fixtures abort remote requests and do not authenticate. Any future authenticated browser verification must first read `C:\Cursor AI\.local\browser-test-credentials.md` and keep its contents out of evidence.

Groups `node`, `routes`, `chrome`, `performance`, `emulator-guards`, `emulator`, `quality`, `structure`, `ci` can be selected with repeated `--group` arguments for focused diagnosis. Such a report explicitly covers selected groups only. The emulator lifecycle guards start their own isolated instances serially, before the persisted suite. Missing commands, failed startup, signals and nonzero exits remain failures. Nonzero check exits do not suppress later checks; unsafe runtime state or cleanup errors can halt the run and remain recorded errors. There is no baseline-waiver or skip-failures option. A dirty source check cannot establish committed-tree CI: rerun `--group ci` after the atomic commit and bind it to that SHA. Validate the task allowlist separately and compare browser normalized source hashes to committed blobs.

Chrome includes PR05–11 workflows, hidden Updates/Calendar consistency, flag-off/on shell boots, disposal/rollback controls, 390/intermediate/desktop, and PR10's actual 200% Chrome Page zoom. Shell zoom captures alone are only a CSS/layout surrogate. Performance runs 30/500/5000 at normal and 4× CPU with synthetic APIs; request/DOM/listener bounds do not prove latency budgets or production performance.

For an authenticated, isolated V2 smoke run, use the Phase 3 runner with `CRM_PROJECTS_V2_PRESENTATION=true`, the shared dependency path, and an unused dedicated port set. The V2 mode authenticates fixture users, exercises owner rename and quick-create persistence across reload, verifies Viewer read-only behavior, and tears down its owned Auth/Firestore/Storage emulators. Its report is deliberately `customScope: true` and `certifiesCanonicalPhase: false` because the legacy-only expanded Phase 3 matrix is not repeated in that smoke run. Preserve the report under `test-results/crm-projects` and copy the final summary and hashes into external evidence. Never stop or reuse another project's emulator process to free a default port. The default Phase 3 run must be reported separately; on the current candidate it reaches the legacy expanded UI project-creation wait and does not certify the phase.

## Cleanup inventory and retained ownership

| Surface | PR12 disposition and reason |
| --- | --- |
| V2 detail `.crm-board-status-select` hiding selector | Remove the redundant detail-only selector; the unconditional V2 `.crm-board-status-select { display: none }` rule owns the same native-control hiding. Browser/AX checks protect the custom trigger. |
| Legacy `ui-scale.js` input, summary click/keydown, pointerdown, theme click listeners | Detach on disposal; cancel its pending theme timer, close the disclosure/portal and make disposal idempotent. A disposed owner must not write preferences or intercept a replacement controller. |
| Legacy scale theme observer, document/window handlers and portal | Keep the active behavior and existing disconnect/removal paths. Required when flag-off; the new cleanup completes its lifecycle. |
| Workspace utility resize/click/keydown/automation observer | Retain: gated to legacy; the V2 shell returns before these are installed. |
| V2 shell sidebar ResizeObserver, utility handlers and restoration comments | Retain: active responsive layout/navigation and reversible DOM relocation. Disposal disconnects/removes/restores them. |
| Board detail surface, mobile observer/windows, delegated row handlers, canonical field queue | Retain: required PR04–11 behavior, authority/focus/virtualization/mutation contracts. |
| Discussion hydration and Calendar cache/authority fences | Retain unchanged: PR11 remediation is required for hidden loaded records and invalidated in-flight responses. |
| Legacy CSS, responsive overrides, canonical selects, `board`/Timeline compatibility IDs | Retain: flag-off, responsive/forced-colors, domain editor and old-link consumers remain reachable. Similar selectors under different media/container conditions are not duplicates. |

No other obsolete handler, observer, shim or presentation path was proven safe to remove. Restore PR12 changes from its exact parent only as a reviewed delta on the then-current destination; never replace a newer directory wholesale.

## Migration, rollback and forward recovery

`window.__CRM_PRESENTATION_CONFIG__.projectsV2` remains literal `false` in `public/crm-admin.html`. Only strict boolean `true` selects V2; this is presentation selection, not permission/role/automation enablement. Canonical domain controllers and server contracts remain shared. No database/schema migration is part of PR12.

Legacy scale uses `crm:projects:ui-scale`, valid 70–150 in steps of 5, fallback 125. V2 reads a valid explicit old value once into actor-scoped `crm:projects:v2:prefs:1:<encoded-uid>`; missing/invalid old scale starts V2 at 100. The old key is not overwritten. V2 density/text preferences and per-project column preferences remain separate and can survive rollback; legacy does not consume them. Never reset all users to 100%.

For an approved rollback, change the trusted presentation configuration to false in a reconciled release and reload the document. Tear down existing presentation/board ownership before intentionally switching a local fixture. Do not merely hide V2 DOM or initialize two owners. Shell disposal restores moved utilities/labels/styles, board disposal closes detail/editors and removes the mobile/layout machinery; scale disposal now retires all its listeners. The same canonical task writes and automation effects remain valid. Do not restore a database backup to roll back a presentation.

Forward recovery uses a separately reviewed candidate with the flag enabled through the approved configuration route and a fresh document/controller initialization. It reuses retained valid actor/project preferences and current canonical records. Rehearse both directions on synthetic data and preserve valid writes made between them. Mid-document boolean reassignment alone is not a supported runtime switch.

## Settled gates and release prerequisites

The earlier six `board-successor-interaction`, two `board-keyboard-move-focus`, inherited board-contract, persisted profile/depth, and 200% detail-heading failures were remediated after PR12. Current settled Node, route, isolated-emulator, task-detail Chrome, and 51-check mobile/accessibility evidence is retained under `C:\Users\Admin\.codex\external-evidence\projects-v2-final-readiness-20260920`, `C:\Users\Admin\.codex\external-evidence\projects-v2-persisted-blockers-20260920`, and `C:\Users\Admin\.codex\external-evidence\projects-v2-zoom-blocker-20260920`. The authenticated V2 smoke report is `test-results/crm-projects/phase3-auth-v2-current-head.json`; it is additional noncanonical evidence and does not replace the canonical Phase 3 matrix.

The committed-tree CI still has **1,955 unwaived repository-wide structure blockers** and 1,089 notices. A corrected-base fingerprint comparison found no additions or removals between base and candidate, and no Projects V2 changed path intersects a blocker path. These remain genuine repository release blockers but are separately owned structure-governance debt; do not widen policy, add wildcard baselines, weaken checks, or sweep unrelated files into this candidate.

PR11/PR12 synthetic 5,000-task save measurements are noisy and sometimes slower than their exact parent. Preserve those comparisons alongside fresh source-bound samples. Local structural bounds do not establish first-meaningful-paint latency, authenticated network/backend performance, a production SLO, or full assistive-technology acceptance.

Before production: obtain explicit release approval; assign one publisher for all overlapping surfaces; resolve or explicitly govern the repository-wide structure blockers; complete human visual, NVDA + Chrome, and physical-touch signoff on the exact candidate; establish Projects-specific operational monitoring plus measured authenticated performance budgets; and choose the internal cohort and flag rollout separately. The local authenticated V2 smoke closes the fixture-level Auth/domain gap but does not substitute for a real non-production tenant or production telemetry.

Immediately before any authorized release, refresh the destination/production baseline, reconcile current production plus only the approved delta, retain the complete live Hosting manifest/configuration (and full source/runtime config for any approved backend surface), rerun affected gates and record exact artifact hashes, old/live identities and recovery steps. Push the approved committed changes as part of that authorized release. Verify deployed identities and affected/shared workflows afterward. Rollback and forward recovery must preserve releases made later. Retain this canonical worktree and all evidence until a separately authorized retirement satisfies the workspace rules.
