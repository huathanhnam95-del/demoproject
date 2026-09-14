# BEL Online Multiplayer Candidate Audit

Date: September 14, 2026 (Vietnam Time)

## Provenance

- Candidate checkout: `C:\Users\Admin\.codex\worktrees\a08e\Cursor AI`
- Candidate branch: `codex/bel-demo-online-implementation-20260914`
- Implementation base: `23a11b50a7df3d1ad86a807b8f101e2f099fdb5e`
- Read-only authored baseline: `C:\Users\Admin\.codex\worktrees\bel-prod`, SHA `249a8fc86b5a293f82008b0db07c64aeca4ad2bd`
- External task contract: `C:\Users\Admin\.codex\task-contracts\BEL-ONLINE-IMPLEMENTATION-20260914\structure-contract.json`
- External pre-coding snapshot: `C:\Users\Admin\.codex\task-contracts\BEL-ONLINE-IMPLEMENTATION-20260914\structure-before.json`
- Evidence root: `C:\Users\Admin\.codex\evidence\bel-demo-online\20260914-212941\`

## Implemented surface

The candidate adds the CRM Presentation Demo route, a four-seat authenticated room contract, server-side identity and presenter fences, stable seat reservation, ticket and connection-generation fencing, authoritative runtime commands, notes with page CAS/privacy, end/expiry/archive flow, scoped PDF export, generated server/browser core parity, authored-deck packaging, feature-gated launcher wiring, fail-closed Firebase rules, and a Chrome rehearsal across four isolated authenticated contexts.

The authored game source and assets were restored from the read-only released baseline. The online core is checked byte-identical between its Functions and browser copies. The authored native deck is packaged at `public/presentation-demo/native/deck.html` without editing its source-of-truth copy.

## Verification evidence

| Gate | Result |
| --- | --- |
| Legacy demo verification | 46/46 passed |
| Online unit/security/lifecycle suite | 38/38 passed |
| Firebase rule contracts | 2/2 passed |
| Structure test suite | 45/45 passed |
| CRM verification | Application, static, route, browser, smoke and PDF checks passed; aggregate stopped at `scripts/crm/backfill-schedules.js` because no local `serviceAccountKey.json` exists |
| Authenticated Chrome rehearsal | Passed 11 assertions; four isolated contexts, one room, three participants, fifth-account rejection, takeover, bootstrap gate, notes, slide/skip, reconnect, end/archive, scoped exports and cross-user note denial |
| Structure delta checker | Candidate-owned declarations are covered. It still reports seven pre-existing findings: two unregistered public-root entries and three tracked cache findings represented by the base tree’s existing files |
| Emulator rehearsal wrapper | Not a full emulator run; it intentionally executes the bounded online unit stage and refuses live credential environments |

Browser evidence is in `run-8817\rehearsal.json` with traces, screenshots and scoped PDF outputs. The run observed 150 API requests, network input/heartbeat/join/create/end/export/notes traffic, no `BroadcastChannel`, and no unexpected console errors. The room code was `G85DTV` and the room ID was retained only in the external evidence artifact.

## Release disposition

HOLD for production. The candidate is locally demonstrable and its authority/privacy contracts are exercised, but it does not prove production readiness. The unresolved items are durable Firebase storage/RTDB authority, production WebSocket gateway and IAM, real multi-process maintenance, complete emulator orchestration, embedded Roboto PDF verification, and live deployment/release review. No production deployment, remote push, merge, or production data mutation was performed.
