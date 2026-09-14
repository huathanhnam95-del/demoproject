# BEL Presentation Demo Online Multiplayer Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task. The repository's selected workflow, model, approval and production restrictions take precedence over generic skill defaults.

**Goal:** Add authenticated, cross-device play for one presenter and three participants to “Working as Equals at BEL,” reached through CRM > More > Presentation Demo.

**Architecture:** Keep the production Hosting site and Firebase Auth project. Introduce a server-authoritative simulation runtime in the same Google Cloud/Firebase project, with Realtime Database (RTDB) as the committed live-state authority and Firestore as the room directory, notebook and archive store. Browsers send input intentions; server code owns movement validation, activities, slide authority, membership, connection fencing and timers.

**Tech Stack:** Existing classic CRM scripts and ESM canvas game; Firebase Auth, Firestore, proposed RTDB instance, existing Functions HTTP API, proposed Node 22 Cloud Run WebSocket service; Node tests, Firebase emulators, Playwright with Chrome, proposed server PDF generation.

**ArtifactMetadata**
- Task ID: BEL-ONLINE-PLAN-20260914
- RequestFeedback: true
- Status: Proposed; planning only; implementation and deployment not authorized by this document
- Prepared: September 14, 2026, Vietnam Time
- Planning owner: Codex root
- Implementation owner: unresolved; assign before coding
- Operations, retained-data and release owners: unresolved; assign before production
- Route: Light, direct work, no subagents
- Proposed implementation tier: Astra Medium, Standard speed. Recommend Astra High for the bounded distributed-state/security architecture checkpoint. This is a recommendation, not a claim that the running model changed. Confirm the new project's lineup before coding as required by AGENTS.md.
- This document is under docs/plans/. The existing implementation_plan.md and durable project handoff documents were not modified.

---

## 1. Evidence and limits of this investigation

Paths in this plan are repository-relative unless an absolute checkout is named. Placement remains governed by [project_structure.md](../../agent_docs/project_structure.md); this plan does not replace it.

### Baseline reconciliation is mandatory

| Evidence inspected | Verified observation | Consequence |
| --- | --- | --- |
| Assigned checkout C:\Users\Admin\.codex\worktrees\a08e\Cursor AI, HEAD 23a11b50a7df3d1ad86a807b8f101e2f099fdb5e | Clean before this documentation task; presentation prototype absent | Do not start implementation from this HEAD without reconciling the released demo and current production shell |
| C:\Users\Admin\.codex\worktrees\bel-prod, HEAD 249a8fc86b5a293f82008b0db07c64aeca4ad2bd | Clean; contains demo from 0baecef63 plus annotation release integration | Read-only gameplay source baseline, not proof that every current production file belongs to this SHA |
| C:\Cursor AI, HEAD d188648e36ef0c505951fdb622536654051adb82 | Many unrelated tracked and untracked changes | Preserve this checkout; never copy its whole working tree into a candidate |
| Production GET of /prototypes/bel-working-as-equals-demo/ on listening-tasks-3ae34.web.app | HTTP 200, correct game title and app.mjs entry | The static game is served |
| Six production game modules compared with bel-prod | All six equal after CRLF-to-LF normalization; raw hashes differ because of line endings | Source logic is grounded in sampled live files; no claim of a full live artifact audit |
| Production GET of /crm-admin.html | No “Presentation Demo,” “presentation-demo,” or “bel-working” match in returned HTML | Entry point is a required addition. Authenticated DOM/navigation was not rehearsed in this planning task |
| .firebaserc; firebase.json | Project/site listening-tasks-3ae34; public/ Hosting root; /api/** -> Functions api, us-central1; Firestore/Auth/Functions/Storage emulators | Reuse existing project and API conventions; RTDB and realtime-service configuration are new work |
| functions/src/apiApp.js:81–127 | Existing token middleware verifies Firebase ID tokens; legacy admin middleware reads users/{uid}.isAdmin | Reuse identity provider, but add feature-specific current-account and revoked-token checks |
| public/crm-admin.js:1236–1260, 2037–2133, 5555 onward | CRM recognizes admin, teacher and Projects-authorized access; hash/navigation guards constrain non-admin panels | Add the new capability to both navigation and route guards without opening unrelated admin panels |

Sampled production SHA-256 values, from raw response bytes:

| Module below /prototypes/bel-working-as-equals-demo/ | Live SHA-256 |
| --- | --- |
| app.mjs | 638610d0ca807258ab5643c714d69b2f10c7ddc389e82e3554270d7217fcdee2 |
| state/protocol.mjs | 969db72733de398a3ea0a285bdce9dabcd5656c2fa9dbf63154a5f77637be2dc |
| world/network.mjs | 6bb8ca607f1e00fba1677bbfbbc5264bd936c1f549ba99a4e375b9b53dfe15ca |
| world/simulation.mjs | 6b946c983e4bfcd41b380917771043d0c1c4f55d18b240eff3a2ec2410117700 |
| state/session.mjs | 0a07b4df8f6407c73768c1e53a0eafa04633c0553dbc44e324cc5a1f52a4d6c7 |
| ui/notebook.mjs | a96a4f4e1f59807bf0eae1e3e8a8d422ebf2f822bae44220b0a1f59f94a12814 |

### Current demo contracts to preserve or deliberately replace

The following anchors are in public/prototypes/bel-working-as-equals-demo/ at the bel-prod SHA:

- README.md explicitly describes four views in one Chrome profile, no remote multiplayer and no Firebase credentials.
- state/protocol.mjs:8–40 uses BroadcastChannel, browser Web Locks and a presenter-owned synchronous store. Its default heartbeat is 1 second, lease 6 seconds. A second connection receives SEAT_BUSY.
- world/network.mjs:1–64 runs the world in the presenter tab at 33 ms intervals, saves localStorage roughly every second, rejects stale input sequence numbers and keeps action receipts.
- state/session.mjs:3–7, 65–97, 145–158, 203 onward validates profiles, note page versions, command IDs and presenter commands. The public snapshot includes all players' saved notes. Notes allow 100 pages, 200-character titles and 50,000-character bodies.
- state/progression.mjs:28 onward requires all four connected, ready players at a presentation room and the presenter at the monitor.
- world/simulation.mjs:65–83 and 102–123 pauses simulation when the presenter is absent; disconnect drops carried objects, releases handholds and vacates seats.
- world/scenes.mjs:33–36 gives Reception -> Studio A an ordinary doorway. The new initial roster gate must cover both doorway actions and presenter Continue.
- activities/bridge.mjs requires all four players for readiness and ticks; keeps 60/30/10-second phases, generation checks, explicit assisted Skip and Reset before G starts.
- activities/reversal.mjs requires all four for ticks; implements six statements, 3-second opening, 5-second choice, 10-second interval and non-stacking 20-second reversed controls.
- activities/cubes.mjs:16 onward requires two distinct carriers for each of three correct pairs. Existing code has no general J assisted completion.
- presentation/adapter.mjs validates iframe source and same origin and routes presenter actions. presentation/frame.mjs preserves native authored handlers. presentation/final.mjs uses one etaOrigin but calculates against each browser's Date.now(); clock skew needs correction online.
- ui/notebook.mjs uses browser-local drafts and page version conflicts. Other people's saved notes are currently readable. There is no demo PDF exporter.
- scripts/bel-demo/verify.mjs runs session, world, presentation and activity tests. Existing Chrome scripts under tests/browser/bel-demo/ are staged, same-profile rehearsals; they are not a four-account online test.
- tests/bel-demo/presentation.test.mjs and presentation/source-manifest.json preserve external authored source/art provenance. Some existing tests require external source files. Missing originals must be reported, not replaced by weaker assertions.

No authenticated production session was opened, no production records were created, and no current deployed Functions revision, RTDB inventory, billing state or IAM policy was inspected. Those are explicit Phase 0 checks. Product tests have not been run in this documentation-only task.

## 2. Decisions and approval checkpoints

### Confirmed behavior

1. Existing CRM authentication on the existing BEL project/site.
2. Participant room-code entry and admin-only create/resume presenter room.
3. Game opens in a new tab and CRM stays open.
4. Exactly p0 presenter and p1–p3 participant slots. An account cannot occupy two slots in the same room. Offline slots remain reserved.
5. One active room per presenter, resumable from CRM.
6. Reception onward exit locked until all three participant accounts have joined.
7. After initial play begins, disconnect never creates an automatic whole-room pause; missing connections are excluded from arrival gates.
8. Preserve presenter-only control, synchronized authored deck, activities, notes, character controls, collision and animations.
9. Reconnect restores identity and state, with safe reconciliation of relationships/objects.
10. Explicit presenter End or 24 hours of presenter inactivity ends the room. Closing one tab does not end it.
11. Preserve completed sessions and notes. Presenter exports all participants' notes; participant exports only their own.
12. Desktop scope. Chrome-only browser acceptance. No automatic deployment or remote push.

### Proposed details requiring plan review, not silent product changes

- **Notebook privacy:** recommend only the author and that room's presenter can read notes. This changes the existing peer read-only notebook behavior. A preference question was raised during planning and was unanswered when drafting. If shared read-only notes are chosen, document that separately and retain the server restriction on export scope; do not silently change the data projection.
- **Initial gate semantics:** require all three permanent participant slots to have completed one authenticated game bootstrap (not merely a code lookup). Set an irreversible allParticipantsJoinedAt latch. This satisfies “have joined”; participants need not remain online to keep the latch open. Arrival gates still require currently connected players to arrive.
- **Start transition:** lobby permits Homes, Street and Reception. The joined latch does not teleport anybody; the first accepted onward transition from Reception sets lifecycle=playing and startedAt atomically. After the latch is set, disconnect never re-locks that initial exit.
- **One connection per slot:** another device asks to “Continue here” if the slot is already connected. Confirming atomically replaces its connection generation and makes the old tab read-only/disconnected. Automatic reconnect never steals a live connection back.
- **Inactivity:** last meaningful, accepted presenter room interaction, including explicit resume and note edits, resets the 24-hour deadline. Socket heartbeat, passive CRM page refresh and participant activity do not reset it. A presenter leaving a tab unattended cannot retain a room forever.
- **Retention:** retain completed room summaries and notebooks until an explicit future retention/deletion policy is approved. Proposed transient cleanup windows: tickets 60 seconds, terminal RTDB state 7 days after verified archive, receipts/audit 90 days minimum, room-code tombstones 30 days. No destructive cleanup before archive verification.
- **Infrastructure:** a new RTDB instance and a small Cloud Run service in listening-tasks-3ae34, with region, IAM and operating-cost review in Phase 0. The current project configuration does not prove an RTDB instance exists.
- **Scale:** release acceptance guarantees four users per room. Global room capacity is a measured operational limit established in Phase 2; never rely on an untested unlimited-room promise.
- **Model routing:** Astra Medium/Standard for direct implementation; recommend Astra High review of ownership fencing, cross-store recovery and access control. No subagents under the current Light route.

Checkpoint C0 accepts these details, the source baseline, actual owners, proposed model lineup, and the external task contract. Approval of a plan authorizes only the explicitly approved next work; it does not authorize production deployment.

## 3. Recommended architecture and trust boundaries

### Why the authority must leave the browser

The existing simulation has continuous physics and timers. Leaving it in the presenter browser would violate continuity on presenter disconnect and preserve a client-side authority boundary. A transport-only change is therefore insufficient.

Recommended deployment boundaries:

~~~mermaid
flowchart LR
  CRM["CRM launcher / Firebase Auth"] --> API["Existing Functions API"]
  GAME["Four Chrome game tabs"] --> WS["Cloud Run authenticated gateways"]
  API --> FS["Firestore directory, notes, archive"]
  API --> RT["RTDB committed room authority"]
  WS --> RT
  RT --> ENGINE["One fenced simulation owner per room"]
  ENGINE --> RT
  ENGINE --> FS
~~~

- **Functions API:** authenticated capability, room provisioning, joining/resume, connection tickets, note operations, archive access and PDF exports.
- **Cloud Run gateways:** authenticate every socket, forward validated input to the room owner and distribute committed room projections. Any gateway instance may hold any player socket.
- **Single simulation owner per room:** elected via an RTDB transaction, with a monotonically increasing ownerEpoch, owner ID and renewable lease. Only that epoch can commit simulation updates.
- **RTDB:** canonical live room lifecycle, slots, connection generations, gameplay state, authoritative time/deadlines and live command sequence fences. Separate bounded input mailboxes let gateways on different instances reach the owner.
- **Firestore:** unique room-code and presenter-lock directory, queryable room summaries, notebook pages, durable operation receipts, event archive and finalized sessions.
- **Browser:** input capture, prediction/interpolation, rendering, note drafts and iframe presentation. No authority over identity, seat, role, coordinates, unlocks, deadlines, shared notes or export scope.

RTDB transactions may rerun callbacks; reducers must be pure and must not send messages or write another database inside those callbacks. See [Firebase transaction guidance](https://firebase.google.com/docs/database/admin/save-data).

Cloud Run WebSockets have finite request lifetimes and affinity is best effort. All instances must share room state and gateway delivery; reconnect to another instance is normal. Session affinity and max-instances=1 are not correctness mechanisms. See [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets).

### Explicit alternatives

| Option | Decision |
| --- | --- |
| Presenter remains host; RTDB only relays packets | Reject: presenter/device loss still freezes the game |
| Firestore listeners on every rendered frame or every key event | Reject as the default: unnecessary write/read amplification and room-document contention |
| Client-writable RTDB coordinates/slide state | Reject: rules alone cannot reproduce authoritative collision and activity validation |
| RTDB committed live state + independent server simulation + Firestore archive | Recommended, subject to Phase 2 measured latency/bandwidth/recovery acceptance |
| Dedicated game hosting/Redis cluster | Not part of this first plan; revisit only if the measured RTDB design fails its bounded acceptance |

The RTDB addition is not required merely for an online indicator. Firebase documents RTDB-based presence for Firestore, but here socket heartbeat leases and authenticated connection generations are the gameplay presence authority. Neither a browser-supplied connected flag nor a raw onDisconnect event can release a slot. [Firebase presence guidance](https://firebase.google.com/docs/firestore/solutions/presence)

## 4. Data model and source of truth

Use stable random room IDs distinct from the human code. Version every room with schemaVersion=2, protocolVersion, contentVersion, simulationVersion and buildSha.

### Firestore — server access only

| Path | Fields and contract |
| --- | --- |
| crmPresentationPresenterLocks/{presenterUid} | roomId, createOperationId, phase, createdAt; one document per presenter prevents concurrent create in different tabs/devices |
| crmPresentationRoomCodes/{code} | roomId, allocationId, status, createdAt, tombstoneUntil; atomically reserve unique code |
| crmPresentationRooms/{roomId} | presenterUid, code, provisioning state, runtimeVersion, lifecycleMirror, lastMirroredRuntimeRevision, createdAt, endedAt, endReason, archiveStatus; directory/mirror, never live gameplay authority |
| crmPresentationRooms/{roomId}/members/{uid} | seatId, originalRole, displayName snapshot, joinedAt, membershipVersion; durable archive authorization, populated from canonical committed RTDB membership |
| crmPresentationRooms/{roomId}/notebooks/{uid} | notebookRevision, page order, archivedAt; no full notebook in room root |
| crmPresentationRooms/{roomId}/notebooks/{uid}/pages/{pageId} | title, body, version, createdAt, updatedAt, deletedAt; tombstones preserve optimistic concurrency and prevent stale resurrection |
| crmPresentationRooms/{roomId}/operations/{operationId} | actorUid, payloadHash, operation type, result/version, acceptedAt, completedAt; no reusable token |
| crmPresentationRooms/{roomId}/events/{eventId} | membership, lifecycle, assisted completion, connection replacement, export, authorization/security outcomes; monotonic runtime revision or operation ID |
| crmPresentationArchives/{roomId} | terminal schema, immutable member list, final gameplay/deck snapshot, final notebook revision references, checksum, finalizedAt |
| crmPresentationTickets/{ticketHash} | uid, roomId, seatId, connectionGeneration, expiry, consumedAt, requestedOrigin; random secret returned only once, stored hashed |
| crmPresentationProvisioning/{operationId} | state, room/code/lock IDs, retry count, last error class, next retry; recoverable cross-store provisioning |
| crmPresentationRateLimits/{bucketId} | bounded server-owned counters/expiry; distributed join/export/ticket throttling |

Indexes: presenterUid + createdAt; lifecycleMirror + reconciliation due time; archive membership lookup via per-user membership query or bounded authorized directory query. Define exact queries first and add only required composite indexes. Exempt note bodies, snapshot blobs, hashes and event payloads from indexing.

Notes remain separate documents: 100 pages of 50,000 characters cannot fit in one Firestore document. Preserve existing limits unless a reviewed decision changes them.

### RTDB — server access only

~~~text
presentationDemo/v2/rooms/{roomId}/authority
  schemaVersion, contentVersion, simulationVersion
  lifecycle: provisioning | lobby | playing | ending | ended
  presenterUid, createdAt, lastPresenterActivityAt, expiresAt
  allParticipantsJoinedAt, startedAt, endedAt, endReason
  owner: { instanceId, epoch, leaseUntil }
  revision, committedAt, simulationTime
  members: p0..p3 -> { uid|null, joinedAt, bootstrapCompletedAt }
  connections: p0..p3 -> { generation, sessionId, connectionId, leaseUntil, ready }
  game: compact profile/location/world/activity/deck state
  commandCursors: per slot -> lastAcceptedSequence, compact recent receipts
  pendingEffects: bounded IDs of accepted notes/archive/audit operations

presentationDemo/v2/rooms/{roomId}/inputs/{seatId}
  generation, connectionId, inputSequence, receivedAt, allowed key booleans

presentationDemo/v2/rooms/{roomId}/inbox/{operationId}
  authenticated actor/connection envelope and validated discrete command

presentationDemo/v2/rooms/{roomId}/results/{operationId}
  committed result or terminal rejection, expiry

presentationDemo/v2/rooms/{roomId}/effects/{operationId}
  durable effect payload and processing state, separate from hot simulation snapshots
~~~

Compact state uses source content IDs, not repeated slide text, assets or notes. Gateways subscribe to committed state and project it per actor; room-code directory, credentials, input mailbox, receipts and private notes are never broadcast.

**Authority rule:** RTDB is definitive for a live room's slots, connection generation and terminal state. Firestore mirrors can lag, but cannot grant a slot or resurrect a room. Archive API uses Firestore only after finalized archive verification; until then it consults terminal RTDB membership.

## 5. Room lifecycle, concurrency and idempotency

### Create/resume

1. Verify current Firebase identity and active CRM account; require users/{uid}.isAdmin === true for create/resume as presenter. No client role claim or alternate workforce-admin interpretation may expand this presenter permission.
2. Generate a random code with a cryptographic RNG from ACDEFGHJKMNPQRTUVWXY34679: six characters, uppercase, 25-character alphabet excluding commonly confusing digits/letters.
3. Firestore transaction reads the presenter's lock and the selected code. Existing active/provisioning room returns that same room; otherwise reserve lock, code, room ID and provisioning operation together. Retry code collision with bounded new candidates.
4. Idempotently create the corresponding RTDB room with the same allocation ID and p0 UID. No callable code or join response exposes a partially provisioned room as ready.
5. Finalize Firestore directory. On crash, replay provisioning by operation ID. Do not release a lock merely because provisioning is slow.
6. Reconciler can repair incomplete steps or mark a failed allocation terminal after verifying RTDB never became playable. Compare roomId/allocationId when releasing any lock.
7. “Resume” finds the existing room from the presenter lock, checks canonical runtime state/expiry and obtains a connection ticket; it never reseeds gameplay.

### Join and slot reservation

- Normalize trim/uppercase; validate the six-character alphabet before lookup. Code is discovery, not authentication.
- Rate-limit by authenticated UID and hashed trusted source IP. Proposed starting limits: 10 join attempts/minute/UID, 60/minute/IP, bounded per-project ingress; measure and tune without weakening auth.
- Resolve directory to roomId, then transact on RTDB authority. Check lifecycle and expiry, search every occupied seat for UID first, return existing seat if present, otherwise reserve first empty p1–p3.
- p0 cannot also become p1–p3. An admin joining as participant does not gain presenter capability.
- Fifth distinct account gets ROOM_FULL; no spectator/fourth participant slot. Disconnected or signed-out participants retain slots for that room's lifetime.
- Concurrent same-UID join returns one seat; simultaneous joins to the final seat give exactly one success.
- Persist membership mirror through an idempotent effect after the RTDB commit. If mirror write fails, membership remains valid and reconciliation catches up.
- Full/invalid/closed responses disclose no member names or room contents to outsiders.

### Commands and receipts

Use a server-generated stable room-membership session identity, distinct from a short-lived network connection. A new device receives the same seat and a new connection generation.

~~~json
{
  "protocolVersion": 2,
  "roomId": "opaque-room-id",
  "connectionGeneration": 3,
  "commandId": "uuid",
  "sequence": 17,
  "expectedDomainRevision": 42,
  "type": "bridge.place",
  "payload": { "instanceId": "F", "activityGeneration": 2, "targetId": "plank-2" }
}
~~~

- Server derives actor UID, seat and role from authenticated membership; ignore or reject supplied actor/role fields.
- Same commandId/sequence and identical payload returns the committed result. Changed-payload reuse returns IDEMPOTENCY_CONFLICT without effects.
- Discrete gameplay commands have an ordered per-slot sequence. Reject sequence gaps for recovery; allow the client to resync and resend the next unaccepted command. Input movement has its own latest-wins sequence.
- Keep a small recent result cache in hot state and archive receipts separately. A permanent per-slot sequence high-water mark survives connection-generation changes and prevents replay after cache pruning. Bootstrap supplies the accepted sequence; device takeover must not reset it. An old evicted result returns ALREADY_APPLIED_RESYNC, never re-executes. Retries retain command ID and sequence even after reconnect.
- Note page versions and notebook revisions are independent from movement revisions. New movement cannot cause a note-save conflict.
- Commands accepted in an old scene, bridge generation or connection generation fail explicitly.
- Commit state, command cursor and pending effect references atomically before publishing an action success. Transport receipt is distinct from application commit.
- Unknown outcome uses the original commandId and sequence; never silently generate a new action on timeout.

### End, expiry and archives

- End requires current admin status AND the room's original presenter UID. Other admins have no blanket presenter control.
- Transaction switches canonical runtime to ending, clears input and invalidates connection mutation capabilities. This is the end linearization point; no new gameplay/note command is accepted afterward.
- Drain already-accepted note effects idempotently, freeze notebook revisions, persist final gameplay and member snapshots, verify checksums and mark archive finalized.
- API may return 202 ENDING while archive work continues. Retried End returns the same terminal operation.
- After canonical end is recorded, directory code becomes closed/tombstoned and the presenter lock is released only if it still points to this room. Archive failure must never turn the old room active again.
- Every admission, command and heartbeat handler checks server time against expiresAt. Active runtime also checks expiry; a scheduled reconciler runs every five minutes for rooms with no runtime owner. Logical expiry is exact even if archive materialization is delayed.
- expiresAt = lastPresenterActivityAt + 24 hours. Concurrent activity vs expiry resolves by the canonical transaction; after terminal end, a delayed activity cannot revive the room.
- Room code lookup refuses ended/expired rooms. Existing authorized members can access completed history by room ID through CRM.
- TTL is only eventual cleanup for transient records, not the 24-hour room timer; Firestore TTL is asynchronous and does not recursively remove subcollections. [Firestore TTL](https://firebase.google.com/docs/firestore/ttl)

## 6. Simulation, transport, presence and recovery

### Committed-state simulation

- Move pure gameplay reducers/geometry/activity logic to a self-contained Functions domain package; the Cloud Run container imports that package from its own build context.
- Preserve 30 Hz physics integration initially, with bounded fixed substeps and the existing 75 ms maximum movement step. Commit a compact RTDB snapshot at a proposed 10 Hz and publish only committed authoritative snapshots.
- Input message contains W/A/S/D booleans, sequence and UI-blocked intent; server uses trusted receipt time, clears stale keys after 300 ms and enforces movement speed, scene geometry, collisions and nearby interaction distance.
- Client prediction is visual only, using the same generated pure geometry. Interpolate other players. Reconcile prediction to server state without changing collision bounds, mount/seat/carry poses or handhold distance.
- Owner lease proposal: 5-second renewal, 15-second expiry. Tick commits compare owner epoch, room revision and lease validity inside the RTDB transaction. A stale owner cannot commit even if it wakes after a pause.
- Gateway relays input through RTDB mailboxes/inbox; the owner is independent of which gateway holds a socket. All gateways forward only successfully committed revisions.
- On transaction conflict, read the latest committed state and recompute from it; do not replay side effects or apply accumulated dt twice.
- Cap and monitor mailbox size, state size and transaction retries. Initial target: hot authority <=64 KiB excluding separate effects; publish projection <=16 KiB. Measure actual end-to-end bandwidth before approving the frequency.
- Durable authoritative publication means process replacement restores the last published position, not a browser's unacknowledged predicted position.
- If persistence is unavailable, show service recovery and stop authoritative mutations. User disconnect must not pause healthy players, but backend failure must not pretend saves succeeded.
- For no-socket periods, use persisted activity deadlines and resumable ticks rather than relying on an immortal container. Cloud Run settings must support background processing while needed; record CPU allocation/minimum-instance costs explicitly.

### Authentication and connection admission

- Existing Firebase Auth SDK/session is reused on the same canonical site origin. A new device signs into its CRM account normally.
- No credentials or tokens in room-code URLs, query strings, analytics, logs or localStorage. URL may contain only an opaque room ID.
- Ticket endpoint checks revoked/disabled user state, current CRM eligibility and membership, then issues a cryptographically random 60-second single-use ticket stored hashed.
- Browser opens WSS to the configured exact realtime origin. Within five seconds, send the ticket in the first authentication message; before success, no room subscription or data is returned.
- Consume ticket atomically, check allowed Origin, bind socket to UID/seat/generation/connection ID, and send authorized bootstrap.
- Refresh authorization at least every 60 seconds and before each privileged presenter/export operation. Revalidate promptly on room/account changes; fail closed on unknown status. Demotion removes presenter commands and all-participant export even if the tab remains open.
- Socket authentication must not depend on user-supplied email or stale custom claims. Existing auth middleware's non-revocation verification alone is insufficient. [Firebase session management](https://firebase.google.com/docs/auth/admin/manage-sessions)
- On sign-out, close game socket and clear account-specific in-memory data/drafts according to saved-draft policy. Sign-out is a disconnect, not room End.
- Connection ticket replay, wrong-room ticket, wrong-origin handshake, stale generation and expired auth receive no room data.

### Presence

- Proposed heartbeat every 5 seconds, connected lease 20 seconds. Gateway records server receipt time; browser timestamps do not extend a lease.
- Unexpected network loss marks “reconnecting” locally immediately; server excludes the connection after the lease expires. Clean close can mark disconnected sooner, only if its connection generation still matches.
- Heartbeats update presence, not lastPresenterActivityAt.
- A delayed goodbye from device A cannot disconnect replacement device B.
- ready means the current connection acknowledged the current scene/content bootstrap. Server location remains authoritative; a forged ready packet cannot move a player to the monitor.
- During slow reconnect, the reserved character stays offline/non-colliding. The three-slot membership does not change.

### Gameplay policy after disconnect

| Contract | Online behavior |
| --- | --- |
| Initial Reception exit | Cannot enter A or use Continue past Reception until the three-slot joined latch is set. Server checks all paths |
| Presentation arrival | Presenter must be present/authorized at the monitor; require only connected, ready participants in that room. Re-evaluate on disconnect. No vacuous bypass of presenter authority |
| Existing active slide | Preserve slide, reveal steps, properties, Determine/ETA and shared origin. Participant loss does not pause it. Presenter loss leaves it displayed; no participant gains control |
| Ordinary world/activity | Continue for connected users if no explicit presenter pause or presentation pause applies. Remove global “p0 disconnected” and automatic “group pause” conditions |
| Bridge F | Connected-player readiness at start; once running, disconnect does not freeze phase clock. Keep 60/30/10 timings and reset generations. Presenter assisted Skip remains usable even with fewer players, including insufficient gathering; it builds the bridge and players still walk across |
| Reversal I | Connected-player readiness at start. Timers continue thereafter. Disconnected players get an explicit offline/unevaluated result, not a new punishment. Preserve existing penalty deadlines and non-stacking behavior on return |
| Cubes J | Keep normal two-distinct-carrier matching. Add explicit presenter assisted completion for remaining pairs when the available group cannot finish; persist assisted status, never fake normal matches |
| Other arrival/section gates | Audit every all-player loop, Continue path and activity tick; use one shared presence-aware policy helper. No hidden four-connected-player assumption |
| Explicit pause | Retain presenter pause/resume. Disconnect does not clear an intentional pause or automatically grant resume rights |
| Zero connected participants | Preserve activity state; presenter can continue/skip where explicitly supported. End still follows presenter action or expiry |

### Reconnect reconciliation

1. Authenticated UID resolves the original seat; load committed profile, appearance, notebook revision, scene/instance, position, deck, activity generation, object and social state.
2. Keep position if still walkable and section is valid. Otherwise use the closest safe anchor in the current valid section and record a reason.
3. Short reconnect within the same lease retains valid carried item, seat/ride and mutual accepted handhold.
4. After confirmed disconnect, release collision occupancy and handholds so an online partner is not trapped; persist a resume hint. Drop carried objects safely so others can proceed. Do not restore a stale owner claim or duplicate an object on return.
5. Restore an unclaimed seat/ride/item only if still valid and unaltered; otherwise retain the safe new world truth. Never steal another player's object or seat.
6. A released handhold needs renewed consent if the partner moved on; an invitation alone is never a relationship.
7. If the group has advanced beyond a now-closed scene or reset an activity, reconnect at that section's entry. Preserve personal notes and completed achievements; do not reopen finished activities.
8. Debuffs use authoritative remaining duration/deadline; reconnect does not restart a 20-second penalty. Shared ETA origin never resets.
9. Process restart reloads the last committed runtime revision and checks every relationship invariant. It does not invoke the v1 blanket recoverSession group pause.

## 7. API and event contracts

Base: /api/presentation-demo, registered by the existing Functions API and mirrored in the local Node adapter. All responses use existing success/error envelopes plus requestId.

| Endpoint | Authorization | Contract |
| --- | --- | --- |
| GET /capabilities | Active CRM identity | canParticipate, canPresent, feature availability, protocol/content versions |
| GET /rooms/active | Active CRM identity | Only caller's occupied live room summaries and their own presenter lock; no global room listing |
| POST /rooms | Active CRM admin | Idempotency-Key required; create or return own existing presenter room |
| POST /rooms/join | Active CRM identity | code; reserve/return one seat; no client actor assignment |
| GET /rooms/:id/bootstrap | Room member/current account | Actor-specific state, server time, role, revision and connection status; no other private notebooks |
| POST /rooms/:id/connections | Member; admin again for p0 | Ticket; explicit replaceExisting intent if live connection exists; atomic generation replacement |
| POST /rooms/:id/end | Owning presenter/current admin | Idempotent terminal operation; 200 finalized or 202 archiving |
| GET /rooms/:id/notebooks/:uid | Own UID or owning presenter/current admin | Paginated saved pages and notebook revision |
| PUT /rooms/:id/notebooks/me/pages/:pageId | Active room member | title/body/expectedVersion + operation ID; own UID derived from token |
| DELETE /rooms/:id/notebooks/me/pages/:pageId | Active room member | expectedVersion + operation ID; tombstone, not version reset |
| GET /sessions | Current account | Only completed sessions with retained authorized membership |
| GET /sessions/:id | Retained member/current account | Authorized archive projection and own notebook; presenter aggregate access requires current admin |
| POST /rooms/:id/exports | Own notebook, or owning presenter/current admin | scope=own or participants; captured note revisions; application/pdf response |
| GET /operations/:id | Operation actor or authorized presenter where appropriate | Sanitized status/result; never raw queue payloads |

WSS client messages: authenticate, heartbeat, ready, input, command, resync, reauthenticate, disconnect.
Server messages: authenticated, snapshot, commandCommitted, commandRejected, presence, replaced, authRequired, roomEnding, roomEnded, serviceRecovering, protocolMismatch.

Common error codes: UNAUTHORIZED, CRM_ACCESS_REQUIRED, PRESENTER_REQUIRED, FORBIDDEN, ROOM_UNAVAILABLE, ROOM_FULL, ROOM_ENDED, ACTIVE_ROOM_EXISTS, CONNECTION_ACTIVE, CONNECTION_REPLACED, TICKET_EXPIRED, RATE_LIMITED, PROTOCOL_MISMATCH, STALE_COMMAND, NOTE_CONFLICT, IDEMPOTENCY_CONFLICT, OUTCOME_UNKNOWN, ARCHIVE_PENDING.

Use 401 for absent/invalid identity, 403 for known role/scope failure, generic 404/ROOM_UNAVAILABLE for unauthorized room enumeration, 409 for concurrency conflicts, 410 for a known member's ended live room, 429 with Retry-After, and 503 for unavailable authority. No stack traces, tokens or private note content in errors.

## 8. Security rules, notes and PDF export

### Rules and IAM

Clients have no direct read/write access to the new live/private stores. The game uses authenticated server projections instead of handing a full database snapshot to browsers.

Illustrative Firestore rule pattern; expand to the exact collections above and check overlap with all existing matches:

~~~text
match /crmPresentationRooms/{document=**} { allow read, write: if false; }
match /crmPresentationArchives/{document=**} { allow read, write: if false; }
match /crmPresentationPresenterLocks/{document=**} { allow read, write: if false; }
match /crmPresentationRoomCodes/{document=**} { allow read, write: if false; }
match /crmPresentationTickets/{document=**} { allow read, write: if false; }
match /crmPresentationProvisioning/{document=**} { allow read, write: if false; }
match /crmPresentationRateLimits/{document=**} { allow read, write: if false; }
~~~

RTDB rules deny client access under presentationDemo, including reads. Do not add a broad authenticated-user read at a parent path. Existing unrelated database paths retain their reviewed rules. Storage does not need a new public export path.

Rules are not a substitute for API checks: Admin/server libraries bypass Firestore rules. Emulator tests must separately test direct-client denials and authenticated service behavior. [Firestore rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)

Dedicated runtime service account, workload identity/ADC, no downloaded key file. Grant only needed Firebase/Firestore access and service invocation; record where database-level IAM cannot limit one collection/path. Application checks remain mandatory. Use exact HTTPS/WSS origins and CSP additions, bounded messages, schema validation, per-UID/connection limits and distributed ticket/join/export throttling.

No new browser test bypass, emulator flag or debug command may activate on production origins. Production runtime refuses emulator settings; local tests refuse production resources.

### Notebook persistence

- Save ownership derives from UID. Profile customization remains independent from the CRM account's role/name.
- Local drafts are keyed by UID + roomId + pageId and remain untrusted; never store a whole shared notebook or connection secret in localStorage.
- Autosave after a short debounce (proposed 1 second), plus explicit Save. Display saving/saved/offline-draft states; only server acknowledgement means cross-device saved.
- Note writes are accepted through a bounded durable operation queue before the room end fence. An accepted operation ID remains recoverable even if the socket/API response is lost.
- Stage effect data separately, then atomically reference it from the live authority; unreferenced staging may be cleaned later. Process note effect with Firestore transaction: check original operation receipt, compare expected page version, update page/notebook revision and receipt together.
- End drains accepted note effects before freezing the archive. New writes after ending fail. Race tests prove no acknowledged page disappears.
- Same-account device conflicts retain the unsaved draft and show the current saved page; no silent last-writer-wins overwrite.
- Unsaved offline keystrokes cannot appear on a second device until transmitted. Make this distinction visible and test it.
- Ended notebooks are read-only in the first release; exports remain available.
- Proposed private policy removes peer note bodies from projections and peer notebook actions. Presenter viewing all participants remains supported. If peer read-only sharing is approved, use an explicit scoped read API.

### PDF export

- Generate PDFs server-side from authorized persisted notes. Do not trust a client list of UIDs or HTML.
- scope=participants resolves exactly p1–p3 in that room and is allowed only to original presenter with current CRM admin status; another admin cannot export it.
- Participant scope=own resolves UID from auth even if the body supplies another user. Reject extra ownership fields.
- Use a consistent read of notebook revisions and pages; active-room export captures a point-in-time snapshot. Label it with room, authors, export timestamp and saved revision. Pending/offline drafts are not represented as saved.
- Produce a real downloadable application/pdf with Content-Disposition attachment and Cache-Control private, no-store.
- Proposed PDF library: a pinned supported server PDF library such as PDFKit after dependency review; bundle licensed Roboto Regular/Bold from the existing public/fonts source through a declared copy/provenance contract. Vietnamese diacritics, long unbroken text, empty notes, page breaks and maximum-size notebooks must be checked.
- Avoid remote HTML rendering or fetching note-supplied URLs. Stream or buffer within a measured memory/time limit; cap concurrent exports. Large valid notebooks must paginate or return an explicit retryable service limit, never truncate.
- No public Storage download URL. Prefer streaming without retained PDF files; original notes remain in Firestore.
- Persist an export audit event with scope and notebook revisions, not note bodies or bearer tokens.

## 9. CRM and game UI flow

1. Existing CRM login/bootstrap obtains capabilities from the server.
2. More contains Presentation Demo for every eligible CRM participant, including teacher and Projects-only access. Add a narrow allowlisted route, proposed #presentation-demo; keep other legacy admin routes restricted.
3. A flat page offers “Join a room” with a six-character code. Only canPresent=true reveals “Create presenter room” or “Resume presenter room.”
4. Show copyable code, participant occupancy 0/3–3/3, offline vs empty distinction and resume controls. No account lists are exposed before authorized room join.
5. Join/create reserves a new same-origin tab in the user click gesture to avoid popup blocking. Complete auth and admission there; if blocked, show an explicit Open game link. CRM tab remains open, authenticated and on the same panel.
6. Game URL is /presentation-demo/?room=<opaque-id>. The new tab obtains its own Firebase session state and ticket, not a token passed by opener.
7. If no identity exists, use the normal CRM login with a validated same-origin return destination. Avoid open redirects. A URL alone cannot join or select p0.
8. Game loading confirms content/schema version before ready; failures retain slot and let the user retry.
9. Display exact distinction between reconnecting, offline draft, replaced by another device, room ended and service recovery. Do not show “waiting for all four” after start.
10. Presenter tools preserve slides, reveals, properties, pause, Continue and assisted actions. “End room” is separate from “End presentation” and “Close tab”; confirm this irreversible session end in the UI.
11. Participants get My notes / Export my notes. Presenter gets participant notebook access / Export participants' notes. Completed sessions are reached from the same CRM page.
12. Retain desktop keyboard interactions and readable game/notes geometry. Show a desktop-only explanation on narrow/mobile devices; do not implement touch controls in this package.

Canonical site origin matters: Firebase Auth browser persistence and local drafts do not automatically carry between custom domain, web.app and firebaseapp.com aliases. Keep the launched tab on the current approved origin and rehearse the actual production origin.

## 10. File boundaries and phased execution

All filenames below are proposed unless identified as existing. Before each phase, amend the external contract for any newly discovered exact file. No wildcard contract entries. Root implements directly under the current route and audits the actual changes.

### Phase 0 — Freeze source, scope, owners and prerequisites

**Dependency:** Plan review; no product code until C0.

1. Record the fresh source SHA and exact production Hosting/API identities, sampled/full relevant asset hashes, dirty-tree inventory and required retained source assets.
2. Reconcile bel-prod demo files/tests with the current live-preserving shell baseline in an isolated codex/ branch. Review exact selected paths, never merge all unrelated work.
3. Read C:\Cursor AI\AGENTS.md and agent_docs/project_structure.md again at execution time. Read C:\Cursor AI\.local\browser-test-credentials.md before any authenticated browser plan/run; do not copy its secrets.
4. Read-only inventory existing RTDB instance(s), Firestore location, Functions/API revision, authorized domains, project billing and Cloud Run capabilities. Record proposed service/instance region without provisioning.
5. Resolve CRM eligibility: current admin, teacher or active Projects member. Extract/reuse narrow identity checks while explicitly requiring profile.isAdmin for presenter. Do not inherit the broader Projects “workforce admin” presenter rule.
6. Agree privacy, inactivity definition, initial latch, retention, connection takeover, operational budget and account fixtures.
7. Write a fresh external structure-contract.json and structure-before.json with task ID, actual/unresolved owner, exact create/modify/delete/rename paths, output classes, protected contracts, verification and exceptions.
8. Produce a provenance manifest and architecture checkpoint record in the declared external evidence folder.

**Checkpoint C0 evidence:** clean isolated candidate identity; exact file manifest; original asset availability; approval/owner record; emulator-only test topology; no product writes outside declaration.

### Phase 1 — Domain contracts and server package

**Dependency:** C0.

Create canonical domain files under functions/src/crm/presentation-demo/:
- contracts.cjs, identity.cjs, room-service.cjs, runtime-store.cjs, operation-store.cjs
- core/state/session.mjs, core/state/progression.mjs
- core/world/simulation.mjs, core/world/scenes.mjs, core/world/geometry.mjs
- core/activities/bridge.mjs, core/activities/reversal.mjs, core/activities/cubes.mjs
- core/content/source.mjs

The nine core files start from the exact demo equivalents; changes are reviewed v2 semantics. No deployed code imports public/ or src/. Keep canonical content wording and unchanged geometry byte/semantic parity.

Create scripts/bel-demo/build-online-core.cjs and scripts/bel-demo/online-core-manifest.json. Generate matching files under public/js/presentation-demo/core/ with the same nine relative suffixes. Register the source/output pairing in scripts/structure/policy.json through governance review; update agent_docs/project_structure.md only for the new runtime boundary and generated family.

Create tests/bel-demo-online/contracts.test.cjs, identity.test.cjs, rooms.test.cjs, core-parity.test.mjs and gameplay.test.mjs.

**Task sequence:** specify failing behavioral assertions; capture failing output; implement one canonical module at a time; run its focused assertions; inspect the delta; checkpoint the settled module. Keep commit scope local and exact; no push.

**Acceptance:** runtime validation rejects extra fields/forged identity; deterministic v1 geometry/source parity; same UID/seat invariant; new gate policy explicitly covers every old all-player dependency.

### Phase 2 — Real-time authority vertical slice and go/no-go test

**Dependency:** Phase 1. This phase proves the architecture before broad UI work.

Create:
- functions/src/crm/presentation-demo/runtime.cjs, connection-service.cjs, reconciler.cjs
- backend/presentation-demo/server.cjs, package.json, package-lock.json, Dockerfile, service.yaml
- tests/bel-demo-online/runtime.test.cjs, connections.test.cjs, recovery.test.cjs
- tests/bel-demo-online/emulator.integration.test.cjs
- scripts/bel-demo/online-emulators.json, rehearse-online.cjs

service.yaml records proposed resource/timeout/CPU/instance configuration only; no deployment in this phase. Docker build copies the canonical Functions domain into the container; no tracked second server implementation.

**Task sequence:** build the smallest room containing four authenticated fake clients, movement and one presenter action; add two gateway instances sharing emulators; force owner replacement and process death; then measure.

**Acceptance gate C2:**
- Four clients on different gateway instances see one committed world.
- Concurrent owners/old epoch cannot commit; restart restores last published position and accepted action.
- Participant and presenter socket loss leave connected-player movement working.
- Forced finite WebSocket lifetime reconnect works.
- Provisional local/real-network targets: p95 command commit <=500 ms on the representative production network; p95 snapshot age <=500 ms; no sustained transaction retry storm; normal reconnect <=5 seconds after transport/auth is available, owner failover <=20 seconds.
- Run 30-minute four-client rehearsal and record actual state sizes, ingress/egress, operation counts, runtime CPU/memory, writes/reads and projected room-hour cost using current regional prices.
- Two rooms operated concurrently do not leak state or block one another.
- Failure requires diagnosis and an amended reviewed architecture; do not compensate with client authority or disabling assertions.

These are proposed release thresholds, not measured results. Region latency may require adjustment with explicit evidence.

### Phase 3 — API, access control, rules and lifecycle

**Dependency:** C2.

Create:
- functions/src/routes/admin/presentation-demo.js
- src/routes/presentation-demo.js
- functions/src/crm/presentation-demo/maintenance.cjs
- database.rules.json
- tests/bel-demo-online/routes.test.cjs, lifecycle.test.cjs, security.test.cjs
- tests/firestore/presentation-demo-rules.test.cjs
- tests/database/presentation-demo-rules.test.cjs

Modify:
- functions/src/apiApp.js (feature router injection)
- functions/src/index.js (bounded scheduled maintenance export)
- server.js (local adapter)
- firebase.json (RTDB rules/emulator registration and reviewed service integration)
- .firebaserc only if a verified explicit database target needs registration
- firestore.rules and firestore.indexes.json

Implement create saga, code transactions, join reservation, ticket consumption, role/disabled checks, 24-hour expiry and resumable terminal workflow. API feature remains off by default.

**Acceptance:** racing create/join/end/expiry tests; unauthorized HTTP/WSS/direct DB access denied; all four slots stable through reconnect; old socket cannot act; failed mirrors cannot grant access or revive rooms. Firestore and RTDB security tests both pass.

### Phase 4 — Online game, CRM entry and gameplay preservation

**Dependency:** Phases 2–3.

Create:
- public/presentation-demo/index.html
- public/js/crm/presentation-demo-workspace.js
- public/js/presentation-demo/app.mjs, auth.mjs, transport.mjs, view-model.mjs
- public/js/presentation-demo/notebook.mjs
- public/js/presentation-demo/presentation/adapter.mjs, frame.mjs, final.mjs
- public/css/presentation-demo.css
- scripts/bel-demo/package-online-deck.cjs
- tests/bel-demo-online/launcher.test.cjs, presentation.test.mjs
- tests/browser/bel-demo-online/rehearsal.py

Modify existing CRM shell only for markup, dispatch and capabilities:
- public/crm-admin.html, public/crm-admin.js
- public/js/crm/state.js, public/js/crm/dom.js where route/element registrations require it
- public/crm-admin.css only if a shell-specific layout change is necessary; declare before touching it
- public/prototypes/bel-working-as-equals-demo/index.html: after online activation, its legacy direct URL must lead to the authenticated online entry instead of exposing a guest presenter launcher. Preserve the original HTML in the frozen rollback artifact; keep original assets and localStorage untouched.

Reuse original game art, sprites, renderer and input modules through explicit imports and an online view adapter. No source art regeneration. Copy/extract only modules that need changed online semantics; every new file is listed above or declared before work.

Online native deck is a generated served copy at public/presentation-demo/native/deck.html, with assets referenced through the existing prototype's native paths. Its generator preserves the authored source and injects only the online frame adapter/base path. Register exact input/output hash/semantic contracts. Never edit canonical external deck files.

Online frame messages preserve same-origin/source checks and include room revision, content version and server time offset. Align ETA display to server time without changing native Determine/ETA wording/handlers. Preserve reveal steps and property changes on reload.

**Acceptance:** CRM teacher/Projects/admin route checks; popup-block handling; initial gate including presenter Continue; four-account movement/collisions/mount/seating/handholds; all deck groups; F/I/J normal and assisted paths; notes remain editable alongside presentation; current game art/source parity holds. No fallback to BroadcastChannel if online transport fails.

### Phase 5 — Notes, archive, export and maintenance

**Dependency:** Phase 3; UI integrates after Phase 4.

Create:
- functions/src/crm/presentation-demo/notes-service.cjs, archive-service.cjs, pdf-service.cjs
- functions/src/crm/presentation-demo/fonts/Roboto-Regular.ttf, Roboto-Bold.ttf as declared generated copies from existing public/fonts sources
- scripts/bel-demo/build-pdf-fonts.cjs
- tests/bel-demo-online/notes.test.cjs, archives.test.cjs, pdf.test.cjs

Modify functions/package.json and functions/package-lock.json only for the selected PDF dependency. Reuse notebook/UI files from Phase 4. Add font provenance/copy parity to the existing online manifest and structure policy.

**Acceptance:** note CAS/conflict/replay; max-size valid notebooks; accepted-save vs End race; process crash while archiving; offline draft survives failed save; second device reads saved version; participant cross-user PDF denied; presenter export includes all three notebooks; unrelated admin denied; Vietnamese PDF text/layout verified; completed records survive transient cleanup.

### Phase 6 — Settled-candidate acceptance and operational handoff

**Dependency:** Phases 1–5.

Create/modify only declared tests, plus:
- scripts/bel-demo/verify-online.cjs
- docs/runbooks/bel-presentation-demo-online.md
- docs/audits/bel-demo-online/<run>/summary.md (resolve run path before contract)
- package.json (focused verification commands)
- scripts/crm/verification-selection.json (only eligible offline unit entries)
- scripts/crm/verify-crm-suite.js only for explicitly effectful check wiring, if needed

Run the complete meaningful verification once on a settled candidate. Diagnose failures, fix narrowly and rerun affected checks; do not repeatedly rerun broad suites without cause.

**Checkpoint C6:** exact source SHA and build manifests; all required assertions; emulator evidence; actual four-account Chrome rehearsal; authorization failure evidence; archive/PDF persisted evidence; resource/cost envelope; structure delta check; signed-off release/rollback runbook.

### Phase 7 — Separately authorized production release

**Dependency:** C6 and explicit user approval of the concrete release candidate.

1. Re-read live Hosting, API, rules/indexes and service identities immediately before release; reconcile intervening changes.
2. Prepare exact release manifest and backups: source SHA, selected paths, Docker digest, generated asset hashes, Firebase project/site/database IDs, Functions selectors, rules/index revisions, configuration/feature flag and rollback artifacts.
3. The current release wrapper is not proof it supports the new database, scheduler or Cloud Run selectors. Extend the wrapper with tests in a separately declared release-tool change, or document exact supported product commands in the approved runbook. Do not use blanket deploy/full shortcuts or bypass predeploy safeguards.
4. Publish server/rules/schema support with online entry disabled, validate readiness, then publish the online launcher/game. Existing local prototype data remains untouched.
5. Explicit approval must cover new RTDB/Cloud Run provisioning, required IAM/API changes and billable production resources, plus the exact publication scope.
6. Run live four-player rehearsal with real authorized CRM accounts and separate devices/contexts. Verify persistence from authorized server readback, not only rendered UI.
7. Only after successful live acceptance mark release complete; apply deployed task title tagging through the supported task API after verifying identity.
8. No automatic remote push. A release failure holds further publication unless the user explicitly approves a narrowly described waiver with retained evidence.

## 11. Verification commands and evidence package

Existing commands are real repository commands. Proposed commands must be implemented with the named harnesses before claiming they run.

| Check | Command from candidate repository root | Expected evidence |
| --- | --- | --- |
| Existing offline demo | node scripts/bel-demo/verify.mjs | Exit 0; all four existing suites and original source-manifest assertions; report unavailable external originals explicitly |
| Online offline unit checks (proposed) | node scripts/bel-demo/verify-online.cjs --unit | Exit 0; contracts, auth, room lifecycle, deterministic simulation, notes/PDF and projection assertions |
| Emulator integration (proposed) | node scripts/bel-demo/rehearse-online.cjs --emulators --project demo-bel-online --evidence <external-evidence> | Runner launches explicit Auth/Firestore/RTDB/Functions emulators plus local realtime service, fails if a live project/credential is selected; exit 0 with real rules/client denials |
| Chrome local four-account rehearsal (proposed) | python -B tests/browser/bel-demo-online/rehearsal.py --channel chrome --base-url <local-url> --accounts-file <local-secret-fixture-file> --evidence <external-evidence> | Four independent authenticated contexts, real UI input, persisted assertions, trace/console/network evidence |
| CRM settled-candidate regression | npm run verify:crm | Applicable aggregate checks pass; record environment prerequisites/failures separately |
| Core generated parity (proposed) | node scripts/bel-demo/build-online-core.cjs --check | Read-only byte/semantic comparison passes; no source regeneration during acceptance |
| Deck/font provenance (proposed) | node scripts/bel-demo/package-online-deck.cjs --check and node scripts/bel-demo/build-pdf-fonts.cjs --check | All registered generated outputs match authoritative inputs |
| Structural fixtures | npm run test:structure | Exit 0 |
| Actual task delta | node scripts/structure/check.cjs check --base <candidate-base-sha> --contract <external-task>/structure-contract.json --snapshot <external-task>/structure-before.json --json | Exit 0 and human comparison of actual path/output delta |

Use the workspace webapp-testing Playwright workflow first, configured for Chrome only. Use browser-agent afterward only if live interactive confirmation/richer capture is useful. Do not replace actual user flows with state injection, DOM-only presence checks or observation endpoints that can mutate the world.

C:\Cursor AI\.local\browser-test-credentials.md supplies the required admin login. It currently documents only that admin account. Three distinct authorized participant CRM accounts and a fifth eligible nonmember account for capacity/outsider checks are additional execution prerequisites; store any fixture credentials outside Git. Do not invent accounts, promote users or reuse one account for four roles. Emulators may seed synthetic equivalents with the same role structure.

### Required rehearsal matrix

| Scenario | Observable proof |
| --- | --- |
| CRM entry for admin, teacher and Projects-only account | More item and correct panel; participant cannot see presenter option; unrelated admin panels remain inaccessible |
| Four real accounts, isolated contexts | Four distinct server UIDs mapped exactly p0–p3; separate auth/localStorage; CRM tabs remain open |
| Real cross-device play | At least two physical computers in rehearsal, preferably four; game uses network transport; no shared browser profile/BroadcastChannel dependency |
| Concurrent room creation | Two clicks/devices return one presenter room/lock |
| Concurrent joining | Same UID returns same seat; final-slot race yields one winner; fifth distinct join denied; offline seat still full |
| Reception lock | Attempts through F interaction, click doorway and presenter Continue fail at 0/1/2 joined; third bootstrap sets latch once |
| Gameplay fidelity | WASD, F/click proximity, E release, rides, seating, carry/drop, collisions, street reset, consent handholds and separate home instances |
| Deck sequence | A 1–3, C 4–9, E 10–16, G 17–18, I 19–20, J 21; reveals/properties/Determine/ETA identical across players; intentional ±2-minute client clock skew does not split ETA |
| Activities | F full 60/30/10 normal success and skip/reset before G; I all six statements and reversal; J wrong pair retains cubes, three correct pairs, assisted fallback |
| Participant loss | Disconnect at arrival and during F/I/J; other players continue; lost actor excluded after lease; no new offline penalty |
| Presenter loss | Existing movement/activity/timers continue; slide stays synchronized; participant presenter-command attempts denied |
| Reconnect and takeover | Same seat/profile/notes/position/activity/deck; second device replaces generation; stale first device input/heartbeat/goodbye rejected |
| Relationship reconciliation | Fast reconnect preserves valid relationship; confirmed disconnect frees partner/objects; stale item/seat not duplicated or stolen; advanced room reconciles safely |
| Server/gateway failure | Two instances; owner kill; late stale writes; retry callback; socket timeout; monotonic revisions and last committed restore |
| Auth attacks | Unauthenticated, expired/revoked token, disabled account, demoted presenter, forged role/seat/position/ready, wrong-room/ticket replay and outsider bootstrap denied |
| Notes | Save/readback/reload/cross-device restore, page CAS conflict, lost-response retry, offline draft, duplicate/delete replay, save-versus-End race |
| Exports | Presenter PDF contains three participants; each participant PDF contains own notes only; direct all-notes and other-user requests denied; other admin denied |
| Lifecycle | Fake-clock 24-hour boundary, heartbeat does not extend; participant activity does not extend; explicit End, lost response, archive retry, preserved history/notes |
| Cleanup/rollback | Terminal RTDB retained until archive verified; failed archive not deleted; old code cannot revive; feature flag rollback preserves archives and denies mutation appropriately |

For production, use normal timings and a real disconnect/reconnect; do not wait 24 real hours merely to retest the deadline arithmetic already proven with an emulator fake clock. Verify the persisted production expiry timestamp and deployed scheduled-job configuration. Production account disable/demotion tests require explicit authorization for designated test accounts; do not alter real user roles as an incidental check.

Every retained run records: source SHA, relevant file/build hashes, browser/runtime versions, project/database/service identities, account pseudonyms and roles, timestamps, command/result logs with exit codes, failed as well as passing assertions, screenshots/video/trace where useful, sanitized HTTP/WSS errors, authoritative state/readback revisions, PDF hashes/page/text checks, retained evidence owner and restore path. Keep full traces/PDFs/credentials out of Git; compact audit summary points to their exact external location. Redact tokens and note content from shared logs.

## 12. Monitoring, cleanup, migration and rollback

### Monitoring

Emit structured events with room ID, operation ID, source revision, actor pseudonym and error class. Never log passwords, ID tokens, ticket secrets, raw room-code attempts or notebook bodies.

Measure active rooms, connected slots, join denial reasons, reconnect duration, connection replacements, owner lease conflicts, stale-generation rejects, snapshot age, tick/commit latency, transaction retries, note conflict/outbox age, archive completion/failure, export success/failure/duration, service errors and RTDB bandwidth.

Proposed alerts: sustained snapshot age >2 seconds, repeated owner churn, archive backlog >5 minutes, overdue logical room endings, high ticket/room-code rejection rates, save failures and operational budget threshold. Alert to the assigned operator only after destination/threshold configuration is approved; this plan does not send notifications or create automations.

### Cleanup/retention

- Reconciler is idempotent with bounded pages/batches and resumable cursor.
- Keep code tombstones and terminal identity/version fences beyond ticket and retry lifetimes.
- Delete expired tickets and obsolete input/result mailboxes only after their retention floor.
- Before removing terminal RTDB live state, verify archive checksum, immutable membership and notebook revision references, and a restore path.
- Completed sessions/notes are excluded from TTL. A future data-retention change requires its own decision and exact-path cleanup contract.
- An unresolved outbox/archive error is retained and alerted, never treated as successful cleanup.
- Storage PDF files are not created by default. If later needed, private retention and authenticated download are a separate declared contract.

### Migration

- Online schema v2 starts new authenticated rooms. Browser-local v1 tokens are not Firebase identity and cannot claim an online presenter or participant slot.
- Preserve the original prototype artifact and browser-local saves for history and rollback. CRM launches the new /presentation-demo/ path when enabled; the old public game URL leads to the authenticated entry. Do not delete localStorage or claim old anonymous notebooks have acquired verified CRM ownership. Any later legacy recovery/import must use an explicit, validated mapping rather than opening a guest presenter path in the online release.
- No automatic upload of old shared localStorage notebooks or anonymous participants. Legacy import, if later requested, needs explicit UID mapping, consent, validation and its own plan.
- Preserve art/deck/source text and mechanics through core parity tests and generated-output contracts.
- Pin protocol/content/simulation version for a room's lifetime. Unknown versions produce an explicit compatibility message, not an automatic reseed.
- Feature flags: online entry enabled, new-room admission enabled, live mutations enabled, archived access enabled. Server enforces each flag; UI flag alone is not a control.

### Rollback

1. Disable new-room admission first. Keep existing compatible rooms connected while diagnosing if safe.
2. If an authority/security defect affects active play, disable mutations and mark service recovery; preserve runtime snapshots, note outbox and archives.
3. Roll back Hosting to the frozen prior artifact and realtime/API to known schema-compatible revisions. Do not route online room IDs through the v1 local transport.
4. Keep archive/own-notes access available through the compatible API. An old API unable to understand v2 must reject safely; retain the minimal read/export service until rooms/archive operations settle.
5. Database schemas are additive. Do not delete v2 collections or overwrite state with the legacy bundle during rollback.
6. Restore previous rules only if they continue to deny the new private paths. Never roll back to a broad grant.
7. Re-verify live CRM access, data privacy, one representative reconnect and saved-note export after a rollback; full four-player acceptance is required before enabling online entry again.
8. Record exact prior/current Hosting release, API revision, Cloud Run digest, RTDB rules, Firestore rules/indexes, flags and retained source manifest. Do not label a local green test as production rollback proof.

## 13. Principal risks and completion criteria

| Risk | Mitigation and release gate |
| --- | --- |
| Assigned checkout lacks the live demo | Phase 0 source reconciliation and exact artifact provenance |
| Current CRM permissions hide new page from teachers/Projects users | Capability-aware nav + hash guard regression, no broad admin access |
| Split-brain simulation across service instances | RTDB transactional owner epoch, shared mailbox/projection, two-instance failover test |
| High-frequency database bandwidth/latency | Compact source IDs, measured 10 Hz commit target, Phase 2 cost/latency gate |
| Cross-store partial failure | RTDB live authority; explicit Firestore provisioning/effect/archive reconciliation; crash at each boundary |
| Large notes/PDF memory limits | Page documents, bounded rendering, no hot-state notes, max-size export acceptance |
| Stale auth allows presenter control | Current profile admin check, revoked/disabled checks, periodic socket reauthorization |
| Reconnect duplicates objects or controls | Connection generations, permanent seat identity, object/relationship reconciliation |
| Disconnect still stalls hidden activity logic | Audit every all-player readiness/tick path; rehearsal in each activity |
| Old shared notes conflict with export privacy | Explicit notebook-visibility decision and actor-specific payload tests |
| Auth persistence differs by origin | Same-origin CRM launch and rehearsal on actual production domain |
| A later Hosting release erases the entry/demo | Exact live-preserving release manifest and post-release artifact/flow checks |

Planning is complete when this document is source-grounded, path- and contract-specific, covers the confirmed requirements and identifies unverified prerequisites. Implementation is complete only at C6. Production release is complete only after explicit approval, exact publication evidence and live four-player verification. None of those implementation or release outcomes is claimed by this plan.
