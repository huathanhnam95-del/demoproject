# Project Progress

## Active package: HPRON-01 pronunciation and notification recovery

- Goal: diagnose, fix, and verify the Pronounce-mode reference contour, HTTP 503, notification composite-index failure, and related Firestore Listen-channel errors shown on production.
- Scope: `public/pronunciation-analyzer/**`, the smallest relevant backend/service surface, `public/js/notification-center.js`, `firestore.indexes.json`, and focused logic/browser/index tests. Preserve all unrelated dirty work.
- Constraints: Heavy route; root-cause evidence before fixes; failing regression tests before production code; no push, deployment, production data mutation, or traffic change without separate explicit authorization.
- Acceptance status: lexical variant and measured-reference identity are aligned; the reference remains Merriam-Webster `photograph` noun variant `8050cda57bb448e7`. The collapsed duration canvas and offline SPA fallback are fixed locally. The notification query's exact index is declared and regression-tested, but is still absent from deployed Firestore. Chrome shows both local charts at `800x350` with zero console errors and 200 local WebChannel responses. Focused/broader checks and production source/API boot pass.
- Phases: HPRON-01A/B/C diagnosis and reproduction complete; HPRON-01D test-first implementation complete; HPRON-01E Terra actual-diff review and repairs complete; HPRON-01F local Chrome and command verification complete. Production deployment/verification remains pending explicit authorization.
- Roles: root lead; Luna researcher for pronunciation; Luna researcher for notification/index; Luna browser debugger; Luna coder after root-cause confirmation; Terra reviewer after implementation.
- Verified evidence: `npm run test:pronounce:logic`, Chrome pronunciation browser harness, service-worker config test, notification contract, exact Firestore-index contract, production source/API/CORS/schema boot, and scoped `git diff --check` all pass. Local 8081 health and 8082 readiness pass. Artifact: `test-results/hpron01f-ui/hpron01f-local-after-search.png`.
- Remaining gate: deployed indexes list only `uid + isRead + createdAt`; deploy the existing `uid + createdAt DESC` index and Hosting changes, then repeat production Chrome console/network verification. No push or deployment has occurred.
- Next action: obtain explicit production deployment authorization or leave the verified local patch for user-controlled release.

## Completed package: PRON-V3-LOCAL-ERROR-01

- Missing local recognizer configuration now propagates as `RECOGNIZER_CONFIG_MISSING` with safe diagnostics and non-consuming attempt-policy coverage.
- Unavailable V3 count/confidence render unavailable; degraded Praat spans remain explicitly display-only acoustic boundaries.
- The Windows local launcher starts a loopback-only phoneme module, waits on `/readyz`, rejects HTTP failure, bounds readiness waiting to approximately 180 seconds, and injects local disabled auth only after readiness; fallback clears recognizer variables and reports V3 unavailable.
- Fresh verification: 60 backend tests passed, pronunciation logic suite passed, launcher and attempt-policy contracts passed, exact `photograph` WAV replay returned V2 count 3 plus V3 `RECOGNIZER_CONFIG_MISSING` with null count, and Chrome screenshot evidence confirmed the corrected unavailable state.
- No production deployment, push, commit, or learner-facing V3 activation occurred.
