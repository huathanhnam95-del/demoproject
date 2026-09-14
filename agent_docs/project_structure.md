# Project Structure

## Authority and scope

This document is the single human authority for repository placement, ownership boundaries, dependency direction, generated-output contracts and evidence retention. `README.md` is a navigation index. `scripts/structure/policy.json` is the machine-readable registry used by the structure checker; it does not replace human review. `AGENTS.md` owns process, approval, browser, credential, model-routing and deployment rules. `docs/AGENTS.md` owns documentation-only conventions.

Long-term owners for several existing domains are still unassigned. Do not invent a person, team, GitHub handle or required remote review setting. A new exception requires a real owner, rationale and evidence; unresolved ownership is recorded explicitly and remains a review item.

## Before coding and completion

Before coding, create an external task contract and before snapshot. The contract names the task ID, actual owner (or unresolved owner), create/modify/delete/rename paths, generated or evidence destinations and their tracked/effect classes, protected contracts, verification commands and exceptions. Amend it before beginning newly discovered work; do not widen it after the fact with `**`.

At completion, compare the actual worktree/index delta and generated-output history with the declaration. Preserve unrelated user changes. Retained evidence records its source SHA, tool/input identity, hashes, retention and restore path. Cleanup is a registered exact-path candidate with pointer/status; this document and the checker do not authorize deletion.

The supported local commands are documented in [`README.md`](../README.md). The checker is intentionally finite: it detects configured placements, declared task deltas, selected artifact classes, simple command declarations and registered generated-pair parity. It does not prove semantic ownership, dynamic imports, application behavior, transcript or pronunciation accuracy, audio quality, release readiness or remote branch protection. There is no arbitrary line-count limit.

## Current deployment roots

- Firebase Hosting serves `public/`; `firebase.json` owns the Hosting rewrites, headers and predeploy relationship.
- Firebase Functions deploys the self-contained `functions/` package (`functions/src/index.js` and its `functions/src/**` domains). Firestore and Storage rules/indexes remain the explicit root configuration files.
- Pronunciation services are separately packaged from `backend/` through the existing Dockerfiles and Cloud Build/release scripts. Their service boundaries and model provenance remain intact.
- `src/` contains local Node routes and adapters. Deployed Functions code must not import back into `src/`, `public/` or other workstation-only roots.
- The authenticated BEL Presentation Demo is split by trust boundary: browser entry and CRM launchers live under `public/`, Functions handlers and authoritative room services under `functions/src/`, and the optional Cloud Run packaging seam under `backend/presentation-demo/`. The browser sends intentions only; room state, connection generations, lifecycle and export scope remain server-owned.

## Supported roots and special roots

New domain work belongs in an existing supported home: `public`, `functions`, `src`, `backend`, `scripts`, `tests`, `docs`, `agent_docs`, `assets`, `data`, `tools`, or the existing `.github`/`.agent` configuration scope. Existing `.claude`, `.gsd`, `conductor`, `antigravity-logicware`, `database`, `Generated Images`, `outputs`, `work`, `scratch`, `tmp` and `_tmp_pdf_debug` are legacy or specialized roots. They may receive reviewed updates in their established role; new general feature code there needs an explicit exception. Installed engines, caches and ignored directories are not source-placement approvals or automatic cleanup targets.

## Placement and dependency map

| Work | Home and boundary | Required registration or contract |
| --- | --- | --- |
| Learner practice mode | Existing-style thin `public/<mode>-mode.js` and optional stylesheet; multi-module internals may live under `public/js/<mode>/`. | Register the tab, dashboard card, `PRACTICE_LAUNCHER`, lazy-loader and relevant data/API paths. Recording modes use `AudioDspPipeline`; pronunciation/text comparison follows the mandatory Azure forced-alignment and normalized IPA conventions in `AGENTS.md`. |
| CRM feature | `public/js/crm/<feature>-workspace.js`; cohesive internals may live under `public/js/crm/<feature>/`. | Preserve the classic browser global registration pattern or document an explicit module conversion. `crm-admin.js` remains shell dispatch/registration, not a new feature persistence or render engine. Register required CRM markup, style, nav and hash routes. |
| Functions HTTP and domain logic | `functions/src/routes/admin/<feature>.js` for HTTP validation/auth/adapters; `functions/src/crm/<feature>-service.js` for CRM business logic, or the existing domain home for other features. | Use router → domain/service → injected infrastructure. Pure domain code does not depend on Express request/response or browser globals. Keep the Functions package self-contained for deployment. |
| BEL Presentation Demo online room | `functions/src/crm/presentation-demo/` for contracts, room lifecycle, connection fencing, runtime, notes, archive and export; `functions/src/routes/admin/presentation-demo.js` for HTTP boundaries; `public/presentation-demo/` and `public/js/presentation-demo/` for the authenticated entry and transport-only UI. | RTDB/Firestore paths are server-only and fail closed. Generated online core copies are registered in `scripts/structure/policy.json` and checked by `scripts/bel-demo/build-online-core.cjs`; the authored deck remains under the reconciled prototype source. |
| Local Node equivalent | `src/routes/<feature>.js` or existing `src/routes/admin.js` wiring. | Import the canonical Functions factory and inject local auth, database and response adapters. Deployed code never imports back into `src/`. |
| Browser and Node module scopes | Preserve each file's existing loader and format. CRM HTML currently loads its entry scripts as classic browser scripts, while `public/js/package.json` declares `type: module` for Node-facing files in that subtree; other browser files may already be ESM. | Do not change a global package `type` to convert one file. Preserve classic browser global registration where it exists, and keep ESM imports explicit. Browser code cannot import server credentials or Firebase Admin modules. Account for browser and Node loaders interpreting extensions differently. |
| Python/audio service | Existing `backend/local_server/` or `backend/phoneme_service/`; a new `backend/<service>/` needs a registered boundary. | Keep entrypoint → service logic → provider/DSP/model adapters and update the matching Dockerfile, requirements, Cloud Build and upload allowlists together. |
| Tests and fixtures | `tests/<domain>/`, `tests/browser/`, and sanitized `tests/fixtures/<domain>/`; existing `backend/test_*.py` remains in place until a separate move. | Ownership follows the feature. Update the real aggregate command when coverage changes. A filename containing `test` does not make data disposable. |
| Canonical authoring input | Existing authoritative workbook, JSON or source asset paths; new non-served inputs use `data/<domain>/` or `assets/<domain>/`. | Declare source authority, generator, outputs and provenance before writing derived content. Do not create a general root `content/` convenience home. |
| Generated deploy data/media | Existing `public/database/<mode>/` and `functions/src/data/`. | Each family has one canonical input/generator/output map. Intentional copies require byte or named semantic comparison. Required ignored/LFS media needs a verified provision source. |
| Maintenance and audit command | Existing `scripts/crm/`, `scripts/audit/`, `scripts/kokoro/`, `scripts/release/` or a justified `scripts/<domain>/`. | Record command, cwd, inputs/outputs, effect class, required config and safe verification mode. Do not place maintenance code in `public/` or create one-off root scripts. |
| Documentation and evidence | Feature records in `docs/specs/`, `docs/plans/`, `docs/runbooks/` and `docs/audits/<domain>/<run>/`; durable decision records may be added under a declared `docs/decisions/` change. Bulky regenerable output goes to the declared external/ignored evidence destination. | Evidence names source SHA, tool/input identity, hashes, retention and restore information, plus an actual owner or unresolved status. |

### CRM verification selection

`scripts/crm/verification-selection.json` is a runner-specific registry, not a second architecture map or a structure-policy input. Its entries contain exactly `id`, `sourceRoots`, `testRoot` and `unitTests`; the selector validates those paths and inventories only matching unit-test files beneath each declared test root. It does not infer ownership, effects, imports or coverage. Registration is a reviewer responsibility, and browser, emulator, network, data-operation and other effectful checks remain explicit commands in the existing runner.

Inspect selection with `node scripts/crm/verification-selection.cjs check --root <repo> --registry <path>` or `node scripts/crm/verification-selection.cjs --list --root <repo> --registry <path>`. Inspect the composed runner with `node scripts/crm/verify-crm-suite.js --list --root <repo> --registry <path>`; `--list --lint` reports only the lint selection. These modes are read-only. Registered direct Node unit checks are inserted before the existing ordered checks by feature ID and path. `lint:crm` gates on selection and then runs its declared ESLint targets only; it does not expand to the full CRM suite or imply full-suite coverage. Fixture roots and registry overrides are inspection-only inputs and are rejected for execution.

## Generated, canonical and evidence families

Canonical inputs are authoritative source files. Generated deploy outputs are reproducible artifacts under their declared public or Functions destination. Intentional copies are tested for byte identity or a named semantic comparison. Evidence is review output and is not silently promoted to source or deploy content. Existing connected-speech and segmentation families are registered in `scripts/structure/policy.json`; STR-01 validates their declared relationships without running generators. Release inventory and staging remain a later release package.

The online Presentation Demo has two additional registered copy families: the browser/server core modules are byte-identical copies from `functions/src/crm/presentation-demo/core/` to `public/js/presentation-demo/core/`, and the PDF Roboto files are byte-identical copies from `public/fonts/` to the Functions font directory. `package-online-deck.cjs` rewrites only resource aliases and the frame adapter in a generated deck; it does not edit the authored native deck.

## Structural rules and trust limits

1. Declare paths, outputs, owner and protected contracts before work; use approved homes.
2. Keep dependency direction and responsibility explicit: shell code routes, feature code owns behavior, domain factories own shared server logic, and adapters inject local infrastructure.
3. Give every generated/publication family one owner, source, generator and output contract.
4. Do not newly track dependencies, caches, temporary outputs or undeclared bulky evidence. Existing debt is preserved until separately reviewed.
5. Supported commands declare program, cwd, inputs/outputs, effects and required configuration. Docs may contain illustrative Windows paths; checks are context-aware.
6. Keep this document as the one architecture authority. Scoped documents link here rather than creating competing maps.
7. Source, meaningful tests and retained evidence share feature ownership. Documentation-only work may explain why product tests do not apply.
8. Releases verify one source SHA and frozen generated artifact immediately before publication. CI configuration alone does not establish remote branch protection.

The adoption baseline is a finite, reviewed set of exact fingerprints tied to the fixed adoption SHA. It is not a recursive allowlist: a new file under a baselined directory, a moved artifact or a new occurrence fails. Unchanged legacy findings are notices. A candidate checker, policy or baseline cannot silently bless itself; policy widening and baseline changes need human governance review. CI committed-tree checks and local task-contract/snapshot checks are separate scopes: CI does not receive or evaluate a human declaration, while local completion mode requires both external inputs.

## Cleanup register

Potential cleanup stays in an exact-path register with rationale, owner/triage status, source/evidence pointer, checksum and restore route. A register entry records review status; it does not delete files, rewrite history, remove ignored media or change deployment roots. Unknown consumers, missing provenance or missing restore evidence keep the candidate retained.

## Feature completion supplement

Before a feature change, identify its existing domain, path changes, canonical/generated destinations, served/API/data contracts, owner and meaningful verification. Afterward, check registration, affected and adjacent flows, stored/reloaded results, response content types, audio/provenance and real browser behavior where applicable. Keep the existing new-practice-mode, pronunciation, browser, credentials and deployment requirements in `AGENTS.md`; this map supplements them.
