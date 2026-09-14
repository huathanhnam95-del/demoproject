# BEL online demo repair summary

## Candidate

- Base: `23a11b50a7df3d1ad86a807b8f101e2f099fdb5e`
- Repair started from: `c802e07421dfb826b8d86f24477582c0132552f9`
- Scope: bounded implementation and audit repair only; no merge, push, deployment, or production data mutation.

## Audit findings addressed

- F01/F02/F07: current Auth user, CRM profile/workforce eligibility, revoked-token, disabled-account, membership, seat, role, and presenter checks are enforced; connection responses are public DTOs without runtime/private notebook bodies.
- F03/F04/F06/F09: Firebase Firestore/RTDB durable adapters, transactional membership/runtime/ticket/notes/archive state, authenticated WebSocket gateway, bootstrap/reconnect fences, expiry maintenance, and late-join revision protection are implemented.
- F05/F12: server-authorized movement bounds/collision, deck ranges, bridge/reversal/cubes intention checks, presenter activity expiry touch, edit-field keyboard guards, multi-page notes, and local drafts are covered.
- F08/F10/F11: author-only notebook CAS/tombstones, terminal archive retry, embedded Roboto Unicode PDF output with wrapping, authenticated capabilities, room history, and archive read UI are covered.
- F13: the emulator orchestrator is demo-project scoped, credential-free, UI-disabled, dynamically port-isolated, and exercises real Auth/Firestore/RTDB/Storage/Functions plus two durable backend instances.

## Verification evidence

- `npm run verify:bel-demo:online`: passed; 49 tests, 48 passed, 1 emulator-only skip; 9 online core pairs and 2 font pairs verified.
- `npm run lint:crm`: passed.
- `npm run test:structure`: passed 45/45.
- `node --test tests/bel-demo-online/*.test.cjs tests/bel-demo-online/*.test.mjs`: passed 48, skipped 1.
- `node tests/crm/data-input/voice-runtime.test.cjs`: passed 14/14 after installing its declared service-local `ws` dependency.
- Genuine Chrome/Auth/emulator evidence: `C:\Users\Admin\.codex\evidence\bel-demo-online\repair-c802e074-20260914\genuine-final3\online-rehearsal-summary.json`.
- PDF extraction/render evidence: `genuine-final3\bel-admin-rehearsal-export.pdf`, `genuine-final3\bel-p1-rehearsal-export.pdf`, and `genuine-final3\admin-page-1.png`; pypdf extracted Unicode text and the rendered page stayed within bounds.

## Remaining release gates

- `npm run verify:crm` reached the final backfill utility but exits because this isolated checkout has no local `serviceAccountKey.json`. No credential was created or copied, and no production verification or deployment was attempted.
- Production deployment remains intentionally pending explicit user authorization and its separate release gates.
