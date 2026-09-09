# Shared voice infrastructure recovery audit

Status: OPEN local integration. This milestone serves both Projects and CRM data input before Projects-only Phase9 command expansion. It does not close Phase9 or Phase10.

## Owned boundaries

The session core persists one-use tickets, connection epochs, bounded authorized context, finalized engineering user-audio utterances and exact-preview attestations. Domain adapters must recheck target-record/project authority on fresh effects and consumed receipt replay; feature-wide eligibility alone is insufficient. Attestation preparation finishes reads before returning a staged consumer to use alongside domain effects and the receipt in one transaction.

The relay owns exact Origin and token checks, server-selected provider/admission descriptors, shared ledger permission before I/O, bounded PCM queues, provider context and interruption/cleanup. Browser transport composes the existing data-input voice lifecycle and never directly commits drafts. Engineering provider events and native Gemini observations remain separate. Native paid provider execution remains disabled.

## Root and independent audit findings

1. Initial pure tests missed stale authorized context on prepare replay. The repair must refresh or redact summary/preview and invalidate the context revision while returning no replay ticket.
2. A changed server preview before speech could silently become the confirmed binding. The repair must suppress attestation until context synchronization; ordinary planning speech remains usable without a preview. During-speech changes also invalidate confirmation.
3. Relay readStatus can itself refresh context. An implicit context change must stop the connection before accepting further speech, so the refresh cannot silently authorize an unseen preview.
4. Browser provider audio can arrive while AudioWorklet initialization is pending. Startup must bound and order audio readiness, and cleanup must notify consumers exactly once on unexpected disconnect or identity loss.
5. Existing consumed-marker tests alone did not establish atomic domain effects and receipt replay. Real Firestore tests must cover competing claims, rollback, exactly-one effect/receipt and current persisted authority.

## Evidence boundaries

Core pure and real-local-socket tests are development checks. The final shared release requires settled-source persisted and Chrome consumer evidence, not just reports from writers. Synthetic PCM and fake provider transcripts must be labelled engineering evidence and cannot certify actual speech recognition, Gemini billing bounds or native latency. No paid call, deployment or production mutation is part of these checks.
Shared core diagnostic `test-results/crm-projects/shared-voice-first.json` passed3/3 commands (seed,12 pure session tests,6 persisted cases/56 runtime assertions), no errors, emulators stopped. It explicitly does not certify canonical Phase9. Transport initially passed13/13 on Node22; independent audit then reproduced three more races: an external status reader can clear the contextChanged flag before the socket sees it; accounting delay can defer provider shutdown; concurrent browser prepare calls can share the same generation. These are assigned for repair before Chrome acceptance and release.

Chrome diagnostics reached real native PCM capture, then exposed sustained per-packet authority cost: the server-only diagnostic recorded QUEUE_LIMIT, queued33, queuedBytes28224. No queue limit was raised. A bounded100ms client PCM batching repair is in progress, retaining20ms worklet output and all per-frame current authorization. Earlier setup-only failures were a hidden .codex path blocked by Express sendFile and page-level omission of the AudioWorklet network event; the harness now serves exact hashed bytes and records the server's actual response completion. Failed logs and queue diagnostic report are retained.

Projects context pure8/8 and actual canonical-domain persisted3/3 passed, including current Viewer membership, student crmRole denial, and archive-column retention without historical data changes.

## Shared engineering milestone accepted locally

Settled Chrome report `test-results/crm-projects/shared-voice-browser-batched.json` passed2/2 commands (seed plus6/6 Chrome cases), errors empty, managed emulators stopped. Root viewed final-draft-text.png and inspected the actual report. It composes released common transport/session/ledger with the real external data-input voice.js/voice-panel.js and real Auth/Firestore emulators. Native Chrome microphone, AudioWorklet, AudioContext, WebSocket and fetch execute; generated PCM and server synthetic transcripts are explicitly engineering evidence. Partial text does not append, final text appends once, stored utterance survives, interruption stops playback while capture continues, unexpected disconnect/UID changes clean resources, unknown usage blocks until test fixture reset, and domain drafts/project data remain unchanged.

Final transport tests17/17 pass on Node22; core12/12, real persisted core6/6 (56 assertions), Projects context8/8 and real canonical-domain context3/3 pass in the retained diagnostic reports. Full lint:crm and diff checks pass. No unhandled Chrome page errors. Browser100ms PCM batches retain at most3200bytes; explicit context/interrupt flushes bounded partial input, and close discards unsent audio. Server queue limits and authority checks remain unchanged.

This closes only the shared engineering infrastructure milestone. Native Gemini speech/billing/latency, Projects canonical executable drafts/spoken application and full Phase9/10 acceptance remain open. No provider key, paid call, production mutation, push or deployment occurred.
