# Demo D inline feedback execution evidence

Baseline: `42f829389216ed9214c7f373484269d3528130d0`.
Branch: `codex/entrance-test-d-annotations-20260914`.
Isolated checkout: `C:\Users\Admin\.codex\worktrees\entrance-test-ui-demo-release-20260913\Cursor AI`.
Evidence directory: `C:\Users\Admin\.codex\audits\entrance-test-d-annotations-20260914`.

## Delivered behavior

Demo D is the sole visible evaluator and completion uses its 40 valid ratings. Historical A/B/C scores and font votes remain stored. Rating edits merge the explicit changed fields in a transaction; failed or stale reviewer loads lock editing. Existing draft, answer, audio and historical standalone routes remain covered by regression checks.

The host exposes pen and keyboard selection, a comment dialog, shared paginated feedback, edit, re-anchor, soft-delete and restore. Saves use signed-in UID plus reviewer label, server timestamps, version comparison and mutation IDs for retry idempotency. Dirty text, IME composition, identity changes, offline retries and conflicts have explicit UI handling. The iframe bridge validates origin, source, revision, generation, nonce and message shape. Overlay and host lifecycle listeners are disposed on exit.

Annotations use a separate admin-only Firestore namespace, `entranceTestUiAnnotations/demo-d/items`. Rules enforce bounded exact document and nested shapes, identity, immutable creation fields, timestamps and version progression. Hard deletion is denied.

## Authorized plan adjustment

The initial eight-fragment schema exceeded the emulator's 1,000-expression security-rule evaluation limit. Following the supervising task's explicit adjustment, client and rules allow three fragments, f0 through f2. A selection intersecting more than three targets becomes one complete enclosing layout-region anchor; selection bounds are retained and fragments are never truncated. Security validation was retained. Positive final-listening-context three-text-fragment create, another-admin edit, re-anchor, delete and restore pass. Negative tests reject invalid f2 and fourth fragments and explicitly fail if a rejection is caused by the expression budget.

Text anchors resolve using stable text-run identifiers, offsets and fingerprints. Element anchors use relative geometry. Layout anchors deliberately become unavailable after layout-signature changes (viewport, language, text scale or font) and require re-anchoring rather than drawing at a misleading position.

## Verification

- `npm run test:entrance-test-ui`: exit 0, 40 passed (`unit-completion.log`).
- Firestore emulator rules runner: exit 0, 10 passed (`rules-final.log`), including real store transactions, conflict and retry tests.
- `npm run verify:crm`: exit 0 (`verify-crm-emulator.log`, `verify-crm-emulator-exit.txt`), including aggregate lint, unit, browser and smoke checks. It used dedicated loopback Firestore 8189/Auth 9198, a demo project, externally installed test dependencies, and a temporary project-ID-only fixture for an unchanged backfill script. That fixture had no key and was removed afterward.
- `npm run test:structure`: exit 0, 45 passed (`structure-completion.log`).
- All changed JavaScript files passed `node --check` (`syntax-completion.log`).
- Existing Chrome demo suite: exit 0 (`demo-completion/manifest.json`), including candidate desktop/mobile/short-mobile, audio and evaluator tests. A final copy-only host subtitle correction followed this run.
- Annotation Chrome acceptance: `final-browser/manifest.json` passed; `completion-browser/manifest.json` repeats acceptance after that subtitle correction. Tests cover actual pointer drawing, keyboard selection, native dialogs, resize at 320/390/768/1024/1440 widths, device scale factors 1 and 2, text-range geometry, whole-region fallback, exact-question return and answer preservation, lifecycle, identity, failures and edit/delete/restore.
- The integrated Chrome case uses actual CRM host/iframe assets with real Auth/Firestore emulators and a second authenticated context. It verifies persisted UID, timestamp and version 3 after delete/restore. Test serving strips CSP and injects local emulator configuration; unrelated API reads are stubbed. This is candidate/emulator evidence, not production evidence.
- External `candidate-source-hashes.json` identifies every product/test/config file in this candidate. Final delta and whitespace validation are retained in `structure-completion.json` and `diff-completion.log`.

## Limits and release boundary

Automated 200% scale evidence is CDP page/pinch scale, not manual Chrome desktop zoom. No manual screen-reader certification is claimed. Broad layout marks require re-anchoring after layout-signature changes. Emulator performance and access checks do not establish production persistence or production deployment correctness.

No push, merge or deployment was performed. A future approved release needs Hosting assets plus the narrowly scoped Firestore rules change; no Functions deployment or index change is included. Production authenticated smoke and persisted-record verification remain release steps. Rollback should restore the baseline Hosting assets and previous rules together; stored annotation documents can remain retained separately. Historical ratings must not be deleted.

The external contract was amended explicitly for exact npm command registration and the temporary emulator fixture. Original contract/snapshot bytes are retained. Generated browser outputs were moved to external evidence only after confirming they were absent from the baseline snapshot. No policy baseline or broad placement exception was introduced.

## Exact changed files
- `firestore.rules`
- `package.json`
- `public/crm-admin.html`
- `public/crm-admin.js`
- `public/css/entrance-test-ui-annotations.css`
- `public/entrance-test-ui/index.html`
- `public/js/crm/entrance-test-ui-lab.js`
- `public/js/crm/entrance-test-ui/annotations-controller.js`
- `public/js/crm/entrance-test-ui/annotations-store.js`
- `public/js/entrance-test-ui/annotation-anchors.js`
- `public/js/entrance-test-ui/annotation-model.js`
- `public/js/entrance-test-ui/annotation-overlay.js`
- `public/js/entrance-test-ui/app.js`
- `public/js/entrance-test-ui/view.js`
- `scripts/structure/policy.json`
- `tests/browser/entrance-test-ui-annotations-check.py`
- `tests/browser/entrance-test-ui-demo-check.py`
- `tests/entrance-test-ui/annotation-anchors.test.mjs`
- `tests/entrance-test-ui/annotation-host.test.mjs`
- `tests/entrance-test-ui/annotation-model.test.mjs`
- `tests/entrance-test-ui/annotation-store.test.mjs`
- `tests/entrance-test-ui/host.test.mjs`
- `tests/entrance-test-ui/view.test.mjs`
- `tests/firestore/entrance-test-ui-annotations-rules.test.cjs`
- `tests/fixtures/entrance-test-ui/evaluator-host.html`
- docs/audits/entrance-test/2026-09-14-demo-d-annotations-execution.md


Final acceptance: completion-browser-retry.log exited 0 with the explicit local emulator variables. The earlier completion-browser.log records the safety guard rejecting missing emulator configuration before integration. Owned emulator processes were stopped after verification. The candidate remains an uncommitted local delta, identified by baseline plus candidate-source-hashes.json; no new release SHA is claimed.
