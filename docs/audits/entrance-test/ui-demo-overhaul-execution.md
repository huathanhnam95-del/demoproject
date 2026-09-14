# Entrance Test UI Demo D execution report

Date: 2026-09-13
Execution branch: `codex/entrance-test-ui-demo-overhaul`
Base: `d188648e36ef0c505951fdb622536654051adb82`
Deployment: not authorized; no push, deploy, or live-data write was performed.

## Outcome

Demo D is implemented as a fourth rateable CRM design beside the existing A/B/C frames. The existing A/B/C routes and rating keys remain in the CRM host. Demo D uses a standalone candidate at `/entrance-test-ui/`, has revision-tagged `etui:*` bridge messages, and defaults both English and Vietnamese UI text to the bundled variable Noto Sans font.

The candidate is demo-only: its content is a browser-safe snapshot of the canonical Entrance Test 36+ fixture, with local IndexedDB draft/recording persistence, local receipt completion, no scoring, and no learner/API submission path.

## Implemented scope

- Added the semantic Demo D shell, candidate-scoped CSS, bilingual copy, stable content fixture, state reducer, IndexedDB adapter, debounced save queue, revision conflict handling, recording take guard, DSP-backed recorder, listening player, navigation, review/acknowledgement, local receipt, recovery screen, and labeled Demo QA controls.
- Added three bundled Noto Sans variable-font subsets plus provenance and SHA-256 records. The candidate CSS uses weight range 100–900 and the browser check verified 400/500/600 for Noto Sans.
- Extended the CRM evaluator from 3 × 8 × 5 = 120 rating cells to 4 × 8 × 5 = 160. Existing A/B/C rating keys remain untouched; Demo D uses the same ordinary five-star interaction and is not a preview-only bypass.
- Added focused Node tests, a sanitized evaluator-host fixture, and a Chrome-only Playwright runner with synthetic microphone input.

## Verification evidence

| Check | Result |
| --- | --- |
| `npm run test:entrance-test-ui` | 26 passed, 0 failed |
| Chrome candidate/input/storage case | Passed; Noto Sans loaded, weights 400/500/600 verified, exact select value survived reload, isolated IndexedDB store created, local `demo-d-*` receipt produced |
| Chrome synthetic microphone case | Passed; fake microphone take reached ready state through the DSP recorder path |
| Chrome CRM host case | Passed; 4 skins exposed, D routed to `/entrance-test-ui/`, A/B historical routes still opened, D star rendered `4/5`, requirement copy showed 160 cells |
| `npm run test:structure` | 45 passed, 0 failed |
| `npm run lint:crm` | CRM lint passed |
| `npm run verify:crm -- --list` | Passed; applicable CRM verification inventory listed without executing production writes |

The final combined Chrome manifest is at `C:/Users/Admin/.codex/audits/entrance-test-ui-demo-execution-20260913-01a098c9/browser-final/manifest.json`. It records Chrome `153.0.8010.36`, viewport 1440×1000, zero page errors, and the screenshots used for visual inspection:

- `browser-final/candidate-done.png`
- `browser-final/candidate-miccheck.png`
- `browser-final/evaluator-demo-d.png`

The final structure-check output is retained at `C:/Users/Admin/.codex/audits/entrance-test-ui-demo-execution-20260913-01a098c9/structure-check-final-output.txt`. Its declared-scope delta was clean, but the repository checker still reports pre-existing governance findings for tracked public root entries/cache artifacts (`R1.PUBLIC_ROOT_ENTRY`, `R1.UNSUPPORTED_ROOT`, `R4.TRACKED_CACHE`) outside this package; no Demo D file was reported in that blocker set.

## Explicit limitations

- No production Hosting/Functions deployment, remote push, live CRM rating write, or live learner attempt was performed.
- The Chrome evaluator fixture intentionally omits Firebase, so its rating interaction is verified in-memory. Production Firestore persistence and cross-rater results remain outside this local demo execution.
- The browser manifest contains expected static-resource 404 console notices from the existing host/font fixture environment; there were no uncaught page errors and the acceptance cases passed.
