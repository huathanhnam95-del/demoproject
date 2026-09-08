# Phase 0 root audit

Status: **P0-A06 reopened during Phase 1** after a parallel-suite startup failure left an owned Firestore process behind. The original committed-revision normal-completion evidence remains valid; failure-path cleanup and suite scheduling require fresh proof.

| ID | Finding | Required resolution/evidence |
|---|---|---|
| P0-A01 | Initial manifest phase meanings differed from approved sequence (membership at 3, relay at 7, UI at 9). | Match approved phases 0–10, with mandatory persisted/API/browser checks; no placeholder implementation tests. |
| P0-A02 | Harness fixture hardcoded baseline SHA and initially exercised only `--phase0`. | Compare actual HEAD dynamically and test approved `--phase N` syntax. |
| P0-A03 | Custom-manifest/no-emulator fixture success could be confused with canonical phase completion. | Explicit fixture scope; canonical required emulator checks cannot be bypassed into a green phase. |
| P0-A04 | Emulator startup race resolved an error-watcher after 100ms before endpoint readiness. | Wait for actual readiness or fail on bounded timeout/early exit; test slow startup. |
| P0-A05 | Static emulator config did not follow accepted port overrides; relative rule path was missing. | Use correct rules and matching runtime ports; never fall back silently to open rules. |
| P0-A06 | Windows `.cmd` spawn with `shell:false` and immediate kill risk invalid launch/orphan Java process. | Launch resolved CLI safely; owned-process-tree cleanup; await shutdown and prove successive runs release ports. |
| P0-A07 | Seed profiles used generic role/canEdit only, not actual admin/teacher flags; injected app could bypass config isolation. | Realistic identity/role/grant fixture contract and fail-closed app/config/project checks. |
| P0-A08 | Existing completed-session scheduler test selects current week despite a fixed old session week. | Test-only explicit date inputs; preserve production code and meaningful assertions; red/green evidence. |
| P0-A09 | Draft runner preflight checked future missing files even for `--phase 0`. | Validate manifest shape globally but mandatory file presence for selected phase only; `--all` must preflight all phases. |

Additional final-review checks: truth of report success/failed counts; executable failure and timeout propagation; safe workspace paths; actual tested content versus just base HEAD; dependency/runtime provenance; no paid voice enabled; primary instruction diff preserves unrelated changes. Emulator shutdown must not claim success merely because a kill was requested.

## Verified finding resolution

- **P0-A08 resolved:** root inspected the exact five-line test-only diff (explicit August 31–September 6 input range, explanatory comment). No scheduler product changes. Root reran the test and observed all twelve assertion groups pass; the earlier root run failed at the completed-pill assertion.
- **P0-A01/A02/A03/A09 resolved:** manifest matches approved phases 0–10; dynamic HEAD and both phase syntaxes are exercised. Custom scope cannot certify canonical completion. Missing Phase 1 or all-phase tests fail preflight without running commands; selected Phase 0 completes independently.
- **P0-A04/A05/A06 resolved:** startup waits for HTTP readiness with bounded failure, runtime configuration uses the actual rules/indexes and selected ports, and Windows launches the resolved Firebase CLI through Node. Shutdown awaits owned process-tree termination and released ports. Coder successive runs and two independent root runs completed cleanup.
- **P0-A07 resolved:** seed/roundtrip checks actual account flags, status, grants and claims, while isolation tests reject non-demo/non-loopback/mismatched injected app configurations. Fixture credentials are ephemeral local emulator material.

## Closure evidence

- Exact tested revision: `d756c55cb387b80f01e5741fd1bf2b530975f18c`.
- Independent root Node 22.23.2 run: `test-results/crm-projects/root-phase0-committed.json`, finished September 7, 2026, 07:45:35 AM Vietnam Time. Canonical scope, success true, 9 passed / 0 failed, no errors, emulator started and stopped. Ports 9280/8288/8289.
- Previous independent root run: `test-results/crm-projects/root-phase0.json`, also 9/9. Coder successive runs: `tmp/crm-projects-phase0-report-9.json` and `-10.json`.
- Fresh `npm run lint:crm` and `git diff --check` passed. Root and Functions dependencies are local; lockfiles unchanged.
- Root inspected narrow routing edits in both checkouts; feature changes remain isolated. Projects/automations/paid voice default disabled. No paid route, UI feature, production migration, push or deployment is claimed by this phase.

## Reopened P0-A06 — startup failure cleanup / suite scheduling

September 7, 2026, 08:47:34 AM Vietnam Time: root alternate-port persisted test and coder default suite raced on auto-selected Firebase Logging port 4501. `firebase-debug.log` records `EADDRINUSE 127.0.0.1:4501`. Root CLI PID 11432 exited; Firestore Java PID 20868 remained listening on 8288/8289, and the cleanup function reported unreleased ports rather than success. Root verified the exact Java command line, parent PID, demo project and port ownership, stopped only PID 20868, and confirmed root ports were released. The coder suite was not stopped by root.

Failing artifacts: `test-results/crm-projects/root-phase1-persisted-session-2/` and `root-phase1-persisted-2.log`. This run did not establish any People & Access permission result. Root/coder scheduling is now sequential. Bounded resolution: enforce sequential same-project suite ownership and prove owned-process cleanup after startup failure as well as normal completion before re-closing this finding.

### P0-A06 recovery verification

Root inspected the repair and independently ran `emulator-isolation.test.js` and standalone `emulator-lifecycle.test.js` with Node 22. Both passed. The real Windows lifecycle run recovered the Firestore descendant after startup failure, stopped normal Firestore child 22896, and recovered child 28200 after forced CLI exit while preserving unrelated PID 22760. Evidence: `test-results/crm-projects/root-harness-lifecycle.log`. Fresh listener checks found ports 9180/8188/8189 free and the owned lock absent.

The lock rejects a concurrent same-project suite even with alternate ports, preserves stale/replaced locks, and requires explicit verified stale cleanup. Descendant termination rechecks current lineage, command, project, port and creation identity. Pre-spawn occupied-port failure preserves the unrelated listener. This resolves P0-A06's observed failure path; canonical baseline recertification awaits the Phase 1 shell version update (coder's intermediate run was 8/9, with a cache-token assertion failure).
