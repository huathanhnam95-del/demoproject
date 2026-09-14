# BEL Presentation Demo Online Runbook

Status: candidate-only implementation. This runbook does not authorize a Firebase or Cloud Run release.

## Local launch

From the repository root, run the loopback adapter with the online feature enabled:

```powershell
$env:PRESENTATION_DEMO_ONLINE_ENABLED='1'
$env:PRESENTATION_DEMO_DEV_AUTH='1'
$env:NODE_PATH='C:\Cursor AI\node_modules'
$env:PORT='8787'
node backend/presentation-demo/server.cjs
```

Open `http://127.0.0.1:8787/crm-admin.html`, authenticate with the local browser fixture, choose More > Presentation Demo, and create or join a room. The local adapter accepts only `X-Demo-User` loopback identities; it is not a production authentication boundary.

The legacy prototype remains available at `/prototypes/bel-working-as-equals-demo/`. It redirects to the online entry only when `/api/config` reports `presentationDemoOnline: true`.

## Runtime boundaries

- The browser sends authenticated intentions and polls committed snapshots; it never owns room membership, coordinates, activity completion, slide authority, deadlines, or export scope.
- Room state, connection generations, command sequence fences, notebook CAS and archive checksums are server-owned by the candidate service.
- The committed Firebase rules for the new RTDB and Firestore presentation collections are fail-closed for direct client access.
- Notes are private to their author and the room presenter. Presenter PDF export includes all participant notes; participant export is author-scoped.
- The 24-hour expiry is based on meaningful presenter activity. Heartbeats and participant activity do not extend it.

## Verification

Run the focused candidate checks from the repository root:

```powershell
node scripts/bel-demo/verify.mjs
node scripts/bel-demo/verify-online.cjs --unit
node scripts/bel-demo/build-online-core.cjs --check
node scripts/bel-demo/package-online-deck.cjs --check
node scripts/bel-demo/build-pdf-fonts.cjs --check
node --test tests/firestore/presentation-demo-rules.test.cjs tests/database/presentation-demo-rules.test.cjs
python -B tests/browser/bel-demo-online/rehearsal.py --channel chrome --base-url http://127.0.0.1:8817 --accounts-file C:\Users\Admin\.codex\evidence\bel-demo-online\20260914-212941\accounts.synthetic.json --evidence C:\Users\Admin\.codex\evidence\bel-demo-online\20260914-212941\run-8817
```

The authenticated Chrome evidence is retained outside Git under `C:\Users\Admin\.codex\evidence\bel-demo-online\20260914-212941\run-8817\`. The synthetic account file contains no production credentials.

## Release blockers and handoff

This candidate is not production-ready until the release owner supplies and verifies:

1. Durable Firestore/RTDB adapters shared by API, gateway and maintenance processes. The current Functions wiring is intentionally memory-backed and the scheduled runner remains a feature-gated no-op pending that adapter.
2. A real authenticated Cloud Run WebSocket gateway with shared RTDB owner leases, ingress/IAM, reconnect and multi-instance recovery checks. The local browser transport is HTTP polling.
3. A real Firebase emulator orchestration run covering Auth, Firestore, RTDB, Functions and Storage. `rehearse-online.cjs` currently runs the bounded online unit stage and refuses live credentials; it does not start emulators.
4. A PDF implementation that embeds and verifies Roboto for Vietnamese text. The candidate copies the existing Roboto inputs for provenance, but its minimal exporter currently emits Type1 Helvetica.
5. Release-owner review of retention, billing, rate limits, IAM, monitoring, two-device/multi-instance recovery, and production account authorization.

No production deployment, remote push, merge, or production data mutation was performed for this candidate. To disable the local online entry, unset `PRESENTATION_DEMO_ONLINE_ENABLED` and restart the adapter.
