# Practice workspace and Retell loading verification

Date: 2026-09-13
Candidate: `C:\Users\Admin\.codex\worktrees\99d8\Cursor AI`
Branch: `codex/practice-mode-ui-redesign-20260913`
Base SHA: `d188648e36ef0c505951fdb622536654051adb82`
Implementation commit: `6636b5b03aaa087b391b2a09d21c01ee6514cf1b`
Model/effort: `gpt-5.6-luna` / `xhigh`

## Scope and provenance

The candidate was created from the exact inspected base SHA. The saved checkout at `C:\Cursor AI` was not edited, copied back, merged, pushed, or deployed. Its protected root plan remained SHA-256 `40F5A1E6BCF06DE0A1C18199C37E177E1FB3E0B5C0A7A03EB188FEB2D76AAA36`.

The external task contract and before snapshot were retained at:

- `C:\Users\Admin\Documents\Codex\task-contracts\PRACTICE-UI-IMPLEMENT-20260913\candidate-99d8\structure-contract.json`
- `C:\Users\Admin\Documents\Codex\task-contracts\PRACTICE-UI-IMPLEMENT-20260913\candidate-99d8\structure-before.json`

Their SHA-256 values are respectively `bc9ca76e01c94bfc3f4013ff3cf6df0261cc3314ef3d6b7d53d65e40d8bb855` and `fb2a281b7ae42cb61941a2cdaf321f243c9c089341a9192e0e2f2307076e31b7`.

The change keeps the existing mode controllers as behavior owners, adds explicit reversible task-local hosts for the shared speaking adapters, aligns the affected audio players in flow, and gives Retell Lecture generation-bound loading, bounded catalog/audio recovery, truthful readiness status, and one canonical action per phase. Read Aloud Settings keeps its compact player exception. No dependency, schema, backend, or deployment change was made. No `package.json` delta was retained; focused checks were run directly so the external command registry remained unchanged.

## Verification results

All JavaScript syntax checks for changed product and test files passed.

The focused source tests passed: 7 tests, 7 passes across `tests/practice-workspace-contract.test.js` and `tests/notes-loading-recovery.test.js`.

The focused Chrome checks used installed Google Chrome through Playwright (`Chrome 153.0.8010.36`) and passed:

- Practice workspace layout: 125 probes across 1440, 1024, 768, 390, and 320 pixel viewports, covering shared modes, standalone listening modes, and adjacent-mode smoke checks.
- Retell loading/recovery: 6 probes, including early shell visibility, local fallback offer, bounded Firestore fallback, canonical actions, audio readiness, and retry state.
- Ten existing Chrome checks covering speaking controller placement, cross-mode shell behavior, UI regressions, Notes navigation/audio, Notes mode controls, practice-router back/popstate, lazy-loader retry/RFIB, practice modes, Read Aloud lifecycle, and pronunciation tooltip behavior.

The structure suite passed 45/45 tests. The final external structure completion check returned exit code 0 with no blocking findings. Its notices are pre-existing legacy placement and command-scope findings.

The retained focused evidence is under:

`C:\Users\Admin\Documents\Codex\task-contracts\PRACTICE-UI-IMPLEMENT-20260913\candidate-99d8\evidence\candidate-20260913`

It includes the five viewport screenshots, the layout report, Notes recovery report/screenshot, and the performance JSON samples. Browser-generated outputs that were not declared repository paths were moved, recoverably, to the sibling `generated-output-quarantine` directory under the same external task directory; baseline `tmp` artifacts were preserved.

## Performance spot samples

These are two spot samples, not a five-cold/five-warm performance claim. Both runs used Chrome 153 at a 1440 pixel viewport and reported a 1425 pixel document width.

| Run | DOMContentLoaded | Workspace ready |
| --- | ---: | ---: |
| Exact-base cold | 3678 ms | 315 ms |
| Exact-base warm | 541 ms | 166 ms |
| Candidate cold | 3897 ms | 369 ms |
| Candidate warm | 597 ms | 216 ms |

This sample is slightly slower for the candidate, so no performance improvement is claimed. It does show no horizontal-width regression at the sampled desktop viewport.

## Limits and non-green checks

The broad `npm run verify:crm` run progressed through its available checks but stopped at `scripts/crm/backfill-schedules.js` because `serviceAccountKey.json` was not present; Firebase initialization then attempted `null.collection`. This is an environment prerequisite failure, not a UI assertion failure, and no CRM files were changed.

Two server-backed Notes regression attempts were also environment-limited: the default process lacked `@google/genai`, while the saved Functions dependency path reached the server but lacked the `db` dependency. The isolated source and Chrome fixture checks above passed without treating those unavailable services as production evidence.

No production persistence, live deployment, merge, push, or second interactive browser-agent confirmation is claimed by this candidate audit.

## Reproduction

From the candidate root, run the two source tests directly, then:

```powershell
node tests/browser/practice-workspace-layout-browser-check.js
node tests/browser/notes-loading-recovery-browser-check.js
node --test tests/structure/check.test.cjs
```

For the exact external structure completion check, use the contract and snapshot paths above with base SHA `d188648e36ef0c505951fdb622536654051adb82`.
