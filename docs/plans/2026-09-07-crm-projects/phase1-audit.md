# Phase 1 root audit

Status: closed locally on September 7, 2026, 10:49:14 AM Vietnam Time. Root independently verified committed source and real Auth/Firestore/Chrome evidence. Historical draft findings and failed runs are retained below. No production deployment.

## Required inspection and evidence

- Authentication: actual Firebase verifier in local and deployed mounts; current Auth disabled status and profile/workforce status. Reject deleted users, malformed/unsigned non-emulator tokens and stale privilege claims.
- Authorization: server-owned workforce grant AND explicit project membership for content, including organization administrators. Organization administrative operations have a distinct fresh-admin gate. No users-profile self-grant path.
- Membership: eligible active UID, valid role, transactional last-owner removal and transfer guards, concurrent changes, no implicit access from historical assignment. Preserve teacher profile/classes and legacy administrator routes.
- UI: existing directory exposes People & Access controls using existing UID. Teachers retain Schedule and gain Projects only when authorized. General workforce sees only authorized routes. Inspect all navigation and hash guards, not only button visibility.
- Boundaries: guessed project IDs, grant and membership revocation with the same token, suspended account, viewer writes, unauthorized module links and direct Firestore privilege writes must fail. Sensitive error responses must not leak hidden content.
- Persisted evidence: emulator-backed API mutation then independent reload/read; Chrome uses actual local API and emulator identity. Mock-only tests cannot close the phase.
- Regression: account lifecycle, scheduling and CRM shell baseline; default-off flags; local and Functions router parity. No production data or paid calls.

Phase 2 must reuse the Phase 1 authorization transaction fence for all content commands. A request-level check alone must not authorize a mutation after concurrent access revocation.

## Initial draft findings

| ID | Finding | Closure requirement |
|---|---|---|
| P1-A01 | Colon-concatenated membership keys collide for legal IDs. | Collision-free tuple encoding and collision test. |
| P1-A02 | Every grant string except `none` grants access, including `false` and empty strings. | Strict typed boolean grants; malformed values deny. |
| P1-A03 | Explicit profile `accountStatus: active` overrides `archived: true`. | Either inactive signal denies; test conflicting fields. |
| P1-A04 | Additional token revocation comparison uses `<=`, rejecting legitimate same-second fresh login. | Correct verifier semantics and real fresh-token test. |
| P1-A05 | Linked-record authorization trusts embedded authorizedUids/admin bypass metadata and blocks the whole project. | Actual linked-module/record resolver; authorized project remains available while unauthorized linked details are hidden/denied. |
| P1-A06 | Role PATCH can demote sole Owner; DELETE alone is guarded. | Transactional owner invariant on every role-changing path. |
| P1-A07 | Transactions trust actor/target permissions read outside the transaction. | Shared transactional access fence; deterministic revocation-between-check-and-commit tests. |
| P1-A08 | Workforce updates merge a stale whole record and sync Auth without a concurrency protocol. | Revision-aware submitted-field merge and fail-closed serialized/recoverable Auth synchronization. |
| P1-A09 | Default allowance document collides with an account whose UID is `default`. | Separate or tagged config identities with regression test. |
| P1-A10 | Initial router does not enforce disabled Projects flag. | Default-off API and UI behavior tested without changing legacy access. |
| P1-A11 | First UI places only admin People/calendar/allowance controls inside Projects, exposing failed requests to members and duplicating Staff. | Extend existing People directory; role-aware Projects/member UI; no admin-only requests for teacher/editor/viewer. |
| P1-A12 | Calendar uses raw numeric weekdays and colon-delimited leave syntax; allowance uses cents; UI writes omit revisions. | Ordinary weekday/date/person controls and USD input; carry expected revisions and pending state; no unimplemented budget-guarantee copy. |

These are observations of an in-progress draft, not final delivered defects. None is marked resolved based only on a requested fix.

Additional root source review on continuation:

- P1-A05 follow-up: serializer must remove stored `linkedRecords` even when the resolver returns no permitted links, and stored `id` must not override the canonical document ID. Regression requested with denied raw linked content.
- P1-A07 follow-up: transactional Owner lookup must validate stored UID/project identity against the collision-free document key, consistently with ordinary membership reads.
- Required local bootstrap regression currently fails before its assertion: `createApp` eagerly loads the real scheduler before applying injected test routes, and isolated Firebase has no configured database. Root confirmed the same eager-loading code in HEAD. Narrow lazy route dependency injection and complete test stubs are authorized so demo-only config publication can actually be tested without credentials.
- UI slice assigned to the same Phase 1 coder; emulator execution remains exclusively assigned to harness recovery until release. Root independent `emulator-isolation.test.js` passed on the repaired draft, but real lifecycle proof remains a separate gate.

## Intermediate root executions

- Node 22 mocked API contract: initial admin fixture barrier mismatch (403 versus expected 404), then passed after correction.
- CRM lint and auth-session-guard tests passed on intermediate draft.
- Continuation root rerun: `tests/server/local-admin-bootstrap.test.js` passes after lazy route loading; conflicting/demo project publication cases are still being expanded. `tests/crm/accounts-role-management.test.js` independently passes all 16 existing account-management assertion groups.
- Subsequent independent root checks pass: `tests/auth/auth-session-guard.test.js`, `tests/crm/crm-shell-static.test.js` (including updated asset-token contract), and `tests/crm/teacher-scheduler-behavior.test.js`. Canonical phase certification and final browser flow evidence still remain open.
- Independent real persisted test on ports 9280/8288/8289 failed during setup: `EMAIL_NOT_FOUND` for `profile-only@demo.crm-projects.test`, because seedFixtures lacked the requested account. Evidence: `test-results/crm-projects/root-phase1-persisted.log`. Permission matrix was not reached. Owned emulator shutdown returned `stopped: true`.
- Second independent run failed in infrastructure while coder ran its suite: Firebase Logging port collision `EADDRINUSE 127.0.0.1:4501` (`firebase-debug.log`, September 7 01:47:34 UTC). Auth/Firestore ports were different, but logging auto-selection raced. Root CLI PID 11432 exited; owned Firestore Java PID 20868 remained. Root verified its exact parent/project/ports/command line and stopped only that orphan; ports 9280/8288/8289 then clear. Evidence: `root-phase1-persisted-session-2/` and `root-phase1-persisted-2.log`. Future root/coder suites run sequentially; harness follow-up must cover hub/logging ownership and early CLI exit cleanup. This is not an access-test failure or canonical phase success.
- Final canonical Phase 1 run, full protected-write/concurrency matrix and Chrome mutation/reload evidence remain pending.
- Third root persisted run reached the disabled-account assertion at line 449: 401 instead of 403. All preceding assertions executed; cleanup returned `stopped: true`. Evidence: `root-phase1-persisted-3.log` and `root-phase1-persisted-session-3/`. Root real Auth probe confirmed both `verifyIdToken(token, true)` and `verifyIdToken(token, false)` throw `auth/user-disabled` in emulator mode. Local SDK `base-auth.js` uses `checkRevoked || isEmulator` after JWT verification. The second-verification fallback is therefore ineffective. Root prescribed direct mapping of the trusted provider disabled error to 403 `ACCOUNT_INACTIVE`, retaining 401 for revoked/invalid tokens. Evidence: `root-disabled-auth-probe.log`; cleanup passed.
- After Russell's bounded fixes, root inspected serializer, canonical membership summary/transaction checks and their new assertions; independently reran the mocked API test successfully. Coder managed run `phase-run-2026-09-07T02-42-15-352Z.json` passed fixture, API and persisted checks (3/4 commands), but Chrome failed early visibility assertion at browser line 207. Emulator started/stopped with no cleanup error. This is persisted evidence, not Phase 1 closure.

## Bounded continuation checkpoint

At root checkpoint September 7, 2026, 08:37:30 AM Vietnam Time, no listeners remained on owned ports 9180/8188/8189 or 9280/8288/8289. Coder is completing backend/API/persisted tests only, then must report before the UI slice. Agent-supplied clock estimates are not evidence; use tool clocks and report timestamps.

UI slice follow-through from actual current source:

- Move feature-off and Projects-only route checks before panel selection/render. Current feature-off guard runs after `activePanel` is computed; Projects-only users also need a hash guard against legacy panels.
- Refresh People & Access when Staff opens, not only when Projects opens; avoid duplicated directories and preserve existing account actions/teacher history.
- Non-admin Owner currently receives neither eligible people nor a complete members refresh. Use a scoped eligible-person API; Viewer/Editor display should not request admin resources.
- Keep admin nonmember project management metadata distinct from project content. Membership picker must work for an admin without automatic content membership.
- Remove implementation-phase copy from product text (currently `Accounting controls arrive in Phase 8`). Keep ordinary USD/date/person inputs and user-facing availability language.
- Expand actual Chrome test to every requested identity, teacher Schedule/Projects navigation, owner add/update/transfer, admin grant/suspension/allowance changes, second-session/reload persistence, denial and feature-off behavior. Use current Staff selectors and `channel: chrome`; no static selector counts as proof of permission.
- Unified table controls must survive Staff search/filter rerender through a stable renderer hook. Protected rows need their own UID marker so self module-grant controls work without exposing protected lifecycle actions.
- Root review of the replacement browser draft found fixture contamination (the supposedly unauthorized identity had just become Owner, and teacher ownership was transferred before its Owner check), a row-marker locator mismatch, and missing legacy account API support for the Staff table. Coder must repair setup and assertions before treating a browser run as evidence; capture screenshots and forbidden-request checks as well as visible controls.
- Root found `setPending(false)` enabling every Staff button/select/input, including pre-disabled legacy Delete and protected status controls. Scope pending behavior to feature-owned controls and preserve original policy; verify disabled controls remain disabled after a Projects save.
- Root diagnosis of repeated Chrome startup failures (`02-45-13` and `02-46-26` reports): HTML meta CSP blocks demo Auth 9180 and Firestore 8188; profile reads fail offline and admin falls into the teacher shell. Bounded demo-only HTML serving may add exact validated loopback origins to connect-src, with a small helper shared by local app and fixture server. Preserve ordinary/production HTML and every other CSP directive; keep Chrome CSP enabled. Verify non-demo unchanged and exact demo endpoints in focused tests before rerun.
- Chrome progressed to account mutation, then repeated profile-only restore failure (`02-49-26`, `02-51-30` reports, 409 STALE_REVISION). Root diagnosed newly rendered enabled controls appearing while the prior mutation's refresh is still pending, permitting overlapping mutation/refresh state. Preserve busy state across render, guard mutation entry, and wait for the prior operation's completion/enabled control in tests; no sleeps or removal of revision checks.
- CSP audit correction: HEAD already has a localhost/development-only wildcard CSP branch. Preserve that prior ordinary local behavior rather than falling through to static CSP; the new dedicated demo branch uses exact validated endpoints, and production remains untouched. Root explicitly corrected its earlier overly broad "ordinary HTML unchanged" wording. Add HTTP regression of both local paths and valid IPv6 origin formatting/normalization.
- Root visual inspection of `phase1-browser-admin.png` from run `02-59-30` found Teacher Schedule still occupying the top of the page while Projects is active below it. A visibility assertion on Projects alone missed simultaneous panels. Fix navigation and assert inactive panels hidden; capture the corrected actual layout.
- The same screenshot showed duplicate Viewer rows from noncanonical forged memberships persisted by earlier tests. Meitner must reset demo fixture state before browser setup. Russell owns a same-phase follow-up on the three access files: filter every membership query consumer/owner count by canonical tuple identity so forged Owner rows cannot satisfy the last-owner guard. Add directory and forged-owner regression assertions. No emulator runs by Russell; await release before final combined suite.

### Owner navigation race: root diagnosis, September 7, 2026

The expanded real Chrome Owner test failed twice after selecting Viewer and saving. Root reran the unchanged assertions with process-local Playwright request/response instrumentation (no product/test edits). `test-results/crm-projects/root-owner-race.log` proves two navigation refreshes requested `/access` (16/17), two member reads returned Editor (24/25), and the subsequent PATCH (26) actually submitted `role: Editor`, revision 1. The server correctly returned Editor at revision 2. This is a pre-save client DOM overwrite, not a server write or post-save persistence defect. Root diagnostic emulator cleanup returned `stopped: true`.

Root assigned the bounded correction to the existing Phase 1 UI coder: refresh busy ownership including navigation/member loading, coalesced or generation-fenced refreshes, captured project identity, and mutation pending preserved through post-save refresh. Deterministically delay refresh responses in Chrome and assert disabled editing, actual Viewer/Editor payloads and persisted readback. Do not weaken role assertions or add timing sleeps. Phase 1 remains open; the earlier 4/4 report predates this Owner interaction.

Root independently reran `tests/server/local-admin-bootstrap.test.js` on the latest source: passed. This is focused evidence only.

### Refresh fix and visual audit follow-through

Coder canonical report `phase-run-2026-09-07T03-33-10-690Z.json` passed all four commands with clean emulator shutdown. Root inspected actual refresh ownership/coalescing/generation fences and Chrome assertions: delayed navigation disables the role select; both Viewer and Editor are checked in PATCH payload, response and members readback. External reads are suppressed while a mutation is pending, while explicit internal post-save refresh remains allowed. Calendar weekday/exception controls now participate in busy state. Root requested one final held-PATCH/navigation regression of this second path before closure.

Root viewed actual Teacher Owner, Viewer and Staff screenshots. Teacher panel separation/Owner controls are correct. Viewer capture needs to wait for settled loading. Staff capture revealed the right Notes rail clipped: the added table's minimum width expands the main grid column despite the table wrapper's own overflow. Bounded correction: constrain the Staff main grid column with min-width: 0, preserve internal table scrolling, and assert viewport/rail bounds plus reachable row actions. The rail's prior Teacher Schedule-only copy also needs to acknowledge explicitly granted Projects membership. These are final Phase 1 acceptance items; the 4/4 report does not by itself close them.

The coder briefly returned a usage-limit error before those final edits. Root live usage lookup reported available capacity and retried the same bounded task; no reset credit consumed. No production changes or deployment.

### Independent committed verification

Phase 1 code/tests committed as `a53a6b2e24ac876b28dcad4ad7923383f8d3e433`. Root independently reran canonical Phase 0: `root-phase0-after-access.json`, success 9/9, clean managed shutdown, completed 03:43:11 UTC. Fresh root CRM lint also passed.

Root canonical Phase 1 on that commit passed fixtures, mocked API and real persisted matrix. Chrome completed Owner/Staff/Viewer flows but timed out at unauthorized redirect assertion line 486: Playwright logged navigation to the correct `/index.html`, then waited for its full `load` event. Report `root-phase1-committed.json` records failure honestly, with emulator shutdown complete and ports clear. The assertion is about denial/redirect, so root prescribed test-only DOM-content readiness rather than unrelated practice-page full-load readiness; retain the exact target route and login-failure assertions. Phase 1 awaits that correction and independent recertification.


## Final root closure

Product implementation: `a53a6b2e24ac876b28dcad4ad7923383f8d3e433`. Test readiness correction: `52db887e4639c817cba37b3ead5d1f42933b1d13`.

| Findings | Resolution and evidence |
|---|---|
| P1-A01 through A04 | Collision-free canonical membership tuples, strict boolean grant/status rules and provider revocation semantics. Root inspected source and regressions; final API and real persisted matrix pass. |
| P1-A05 | Stored links/linkedRecords/id cannot bypass serialization; independently authorized resolver hook is fail-closed and denied linked details do not deny otherwise authorized project access. Actual lead/student/class resolver integration remains approved Phase 5 scope. |
| P1-A06 and A07 | Transactional canonical actor/target/Owner fences and last-owner transfer invariants; forged rows ignored consistently. Real concurrency/revocation barriers, sole-owner and competing transfer checks pass. Phase 2 must reuse this fence for content commands without the management admin bypass. |
| P1-A08 | Revision-aware submitted-field updates, durable recoverable Auth synchronization, per-UID serialization and fail-closed pending/failed states. Real failure/retry/reconcile/concurrent status tests pass; teacher records preserved. |
| P1-A09 | Separate allowance-default identity and UID override records; typed USD configuration and directory join verified. This is configuration only; hard reservation accounting is Phase 8. |
| P1-A10 | API default-off enforcement and feature-off navigation preserve legacy Staff access; verified in Chrome and API tests. |
| P1-A11 and A12 | Existing Staff directory extended, role-scoped project membership UI, ordinary USD/calendar inputs, expected revisions and complete busy ownership. Chrome mutation/readback, self-protection, filter rerender, Owner/Editor/Viewer boundaries and account status flow pass. |
| Follow-up regressions | Demo-only exact-origin CSP preserves ordinary local behavior; bootstrap dependency injection tested; Teacher flex layout preserved while inactive panels hide; canonical fixture reset removes forged member contamination; navigation and held-save races have deterministic Chrome coverage; Staff rail fits viewport with internal table scrolling. |

Independent root reports:

- `test-results/crm-projects/root-phase0-after-access.json`: canonical success 9/9 on product commit a53a6b2e, no failed commands, cleanup complete, 03:43:11 UTC.
- `test-results/crm-projects/root-phase1-final.json`: canonical success 4/4 on 52db887e, no errors, cleanup complete, 03:49:14 UTC. Real Chrome includes held navigation GET and held PATCH across Schedule/Projects navigation, exact roles in payload/response/readback, separate reload persistence, denial and feature-off flows.
- Root CRM lint, auth guard and local bootstrap checks passed during final review. Staged whitespace checks passed. Root inspected actual Staff, Teacher Owner and Viewer screenshots; corrected Staff Notes rail is wholly visible and teacher navigation is separate.
- Root verified ports 9180/8188/8189 have no listeners and the managed project lock is absent after final run.

Evidence boundary: local demo-project Auth/Firestore and actual Chrome with real Projects router; the browser harness supplies a narrow legacy directory adapter. No deployed Functions/Hosting or production user state was tested or changed. Paid APIs remain off. Phase 1 is closed and Phase 2 implementation may begin under the already approved contract.
