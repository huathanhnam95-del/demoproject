# Shared live chat and AI-assisted input contract

Status: user-approved model split and aggregate hard ceiling; shared integration in progress. No deployed implementation or provider hard-bound proof is asserted.

## Ownership

On September 8 the Voice chat for data input task explicitly released canonical contract editing and shared budget integration to the CRM Projects recovery task. Projects owns the generic accounting integration and its domain adapter; data input owns its CRM entity adapter and consumer integration in its separate checkout. Exact writer assignments are recorded in `docs/plans/2026-09-07-crm-projects/recovery-contract.md`. No concurrent shared writer. Long-term domain owner remains unresolved. Neither task may mutate the frozen release candidate silently.

This file at `docs/specs/shared-ai-assistance.md` in the preserved b699 checkout is the canonical coordination record. Do not create competing feature-specific provider/accounting specifications.

## Responsibilities

- Gemini Live: realtime audio conversation, interruption and presentation of validated draft/result summaries.
- Gemini 3.8 Flash: interpretation of voice-derived instructions, typed requests, relevant images/context and draft corrections.
- Shared draft core: stable action IDs, immutable revisions/digests, provenance, expiry and reconnect status; no authority to execute arbitrary model tool names.
- Feature adapter: current context authorization, supported action schemas, deterministic validation, exact preview, confirmation policy and domain transaction/receipt execution.
- Shared accounting: reserve/dispatch/settle with trusted provider usage and feature attribution. Direct manual keystrokes and deterministic commands require no model call.

Projects commands stay under the Projects command boundary. CRM entity writes stay under CRM services. A Live session cannot acquire a second independently authoritative draft or bypass the draft core through a model-originated save command.

## Proposed module homes and API

These names are proposed for owner alignment before source creation; register exact files with structure/verification policy when required.

- `functions/src/ai-assistance/accounting/`: shared money/pricing, ledger and provider-usage logic, independent of Express and Projects types.
- `functions/src/ai-assistance/drafts/`: revision/digest and confirmation evidence contracts.
- `functions/src/ai-assistance/providers/`: Gemini 3.8 Flash request/output validation and provider accounting adapters.
- `services/crm-voice-relay/`: retain the previously approved authenticated relay boundary, if its owner registers this service in the applicable structure contract; feature-neutral internals, injected authorization/context adapters.
- `functions/src/crm/projects/`: Projects-specific eligibility, allowance configuration and command adapter.
- `functions/src/crm/data-input/`: CRM-specific eligibility, context and command adapter.
- Browser shared internals may live under `public/js/crm/ai-assistance/`; existing feature controllers compose them. Do not move the existing BEL shell until file ownership is released.

Proposed injected service calls:

1. `resolveAdmissionContext(actor, feature, purpose)` returns a server-derived budget account/scope and current domain eligibility, or denial.
2. `reserve(context, requestDigest, immutablePricing, provenMaximum)` atomically admits within the resolved allowance.
3. `authorizeDispatch(reservationId, currentAuthority)` records durable dispatch intent after current permission checks.
4. `settle(reservationId, trustedProviderEvidence)` reconciles exact cost idempotently; ambiguous usage stays reserved.
5. `readUsage(actor, authorizedBudgetScope)` exposes only permitted totals and feature attribution.

Accounting collections: `crmAiBudgetAccounts` (UID-wide unresolved obligations), `crmAiBudgetLedgers`, `crmAiBudgetReservations`; draft/conversation collection names remain pending interface alignment. Names must be added centrally to the owning collection registry and rules deny unintended direct access. Existing `crmProjectAllowanceConfigs` and `crmProjectAllowanceDefaults` remain the shared configuration source, subject to the hard ceiling below; do not copy, reset or create conflicting allowance configuration.

## User-confirmed staff-only shared allowance

The user explicitly clarified that these AI/live-chat features serve staff accounts with CRM access only. Students are CRM records managed by staff, not eligible users of this feature. There is no student live-chat feature or student allowance in this package.

Each eligible staff UID has ONE monthly budget with an aggregate maximum of US$5 across ALL covered CRM AI/live-chat modes and supporting Live/Flash calls, including Project Management and lead/enquiry/student data input. The shared ledger derives account identity from UID and the server-derived Vietnam month. Reservations record feature and purpose for attribution but cannot multiply or partition the allowance. Administrators may lower the default or UID override from 500 cents, including zero, but may not raise the ceiling without an explicit new user decision. Preserve valid configuration and all settled/pending obligations; reject malformed or over-ceiling configuration rather than silently grant more allowance.

Admission requires an active staff account with CRM access plus current permission for the requested feature and target records. Shared budget availability does not grant Projects membership or access to student records. Student/learner accounts are denied regardless of any remaining budget. Both covered staff domains use the same budget engine; transport/accounting verification remains required before paid enablement. The earlier open question about student eligibility and per-feature allowance pooling is resolved by this clarification.

Retain integer money, atomic cross-device reservation, month-bound obligations, explicit pricing/bounds versions, no automatic refund on disconnect and no fabricated provider usage. Unknown or over-bound billing blocks subsequent admission according to the existing verified design. Both Live and Flash calls count toward their resolved budget account.

## Confirmation policy belongs to the feature

Projects retains explicit SPOKEN confirmation bound to actor/project/current revisions. CRM data input accepts its agreed explicit speech or review-button confirmation. The common core validates evidence against the adapter's policy; it never substitutes a click where spoken confirmation is required. Changed drafts invalidate confirmation, and the domain transaction consumes the matching authorization together with its effects/receipt.

## Required shared proof

Projects and data input sharing one staff UID race at the last allowance: only admissible work proceeds across tabs/devices/features. A denied/unknown feature cannot borrow Projects eligibility. Student accounts cannot obtain reservations. Revocation blocks dispatch but cannot erase settlement obligations. Live plus Flash costs are not double-counted or omitted. Reconnect neither refunds ambiguous work nor replays committed mutations. Confirmation valid in one feature cannot authorize another feature's writes. Manual editing remains available without model budget.

## Source integration

The current data-input implementation plan depends on this contract. Projects Phase 8/9 should link it, preserve existing domain configuration/tests, and report any actual conflict before source changes. Paid provider testing and deployment remain separate authorized steps; this document is not proof of provider availability or budget safety.

## Shared voice session milestone, September 8

User priority is now the common backend-controlled Live infrastructure serving both domain consumers. Complete essential Phase8 acceptance, then release this shared milestone before continuing Projects-only command expansion. This refines execution order within the approved package.

The shared session service owns persisted session identity, connection epochs, bounded context snapshots, provider utterance provenance and confirmation attestations. Domain adapters own current authorization, loading context and current preview/receipt, supported action schemas and transactional application. Model text never becomes a second authoritative draft. The browser never sends a confirmationToken to the model.

Proposed release interface to finalize against implementation:

- A feature adapter authenticates the current actor and resolves context hints to a bounded server-owned snapshot. A preview binding contains feature, actorUid, draftId, previewId, revision, draftDigest and expiresAtMs; Projects also binds projectId and its applicable revision fences. A deterministic context revision/digest invalidates pending confirmation when the binding changes.
- Session prepare runs current authorization before microphone permission and returns a short-lived one-use connection ticket. The authenticated relay consumes it, records a connection epoch and obtains the shared accounting dispatch permit before provider I/O. Default native preparation is unavailable while the hard-bound gate is closed. Engineering transport is explicit test-only composition, never an environment override of native eligibility.
- Reconnect reads durable authorized status and the domain's current draft/receipt. It never replays input, confirmation or effects automatically. A new provider connection requires a new admissible reservation; ambiguous prior usage remains charged/reserved and blocks admission. Stale epochs cannot emit authoritative events or mutate a resumed session.
- Only the server's registered provider adapter may finalize user-audio utterance evidence. Client text, source labels, assistant speech, tool output, quoted records and attachments cannot create that evidence. An utterance binds the context/preview visible when it began; switching context before finalization invalidates confirmation. The domain decides whether its explicit confirmation wording and required acknowledgements are satisfied.
- A server-created attestation binds one finalized user utterance to one exact current preview. Shared consumption validates actor/feature/binding/expiry/replay in the domain transaction and returns a staged write finalizer so all domain reads precede writes. The finalizer consumes attestation together with effects/receipt. Engineering attestations cannot authorize production effects.
- Shared browser transport implements prepare({actorUid,feature,signal}) -> connect({stream,signal,onEvent}), close(), interrupt(), with injected context access/update. Final user transcript events keep the existing data-input shape {type:'transcript',text,final}; assistant audio/text remains separately typed. Shared transport owns audio encoding/playback, identity fencing and cleanup. Context and validated summaries are server-derived; no independently mutable assistant draft.

Acceptance requires real local socket/client and persisted multi-instance/epoch tests, wrong actor/feature/preview/revision/expiry and assistant-origin denial, consumed attestation replay prevention, cancel/interrupt/disconnect cleanup, cross-feature one-wallet admissions, and actual Chrome consumer integration. Synthetic/engineering audio evidence must be labelled as such; it does not certify natural speech, native provider accounting or latency. Native paid Live remains disabled pending hard bounds and separately authorized metered acceptance.

### Released engineering interface

`createVoiceSessionService` and `createVoiceConfirmationService` are exported from shared voice/session-service.js and voice/confirmation-service.js. `createRelayServer` is exported from services/crm-voice-relay/server.js; install its exact scoped package lock. Compose current authentication, registered feature context/policy, the shared ledger and a server-owned provider factory. Native construction remains disabled by design; an engineering factory and engineering model/provider namespace are required for local transport.

The browser export is `CrmAiVoiceTransport.createTransport({getUid,getIdToken,getContext,baseUrl,workletUrl})`. HTTP POST /prepare and /status use Authorization and exact Origin; WebSocket /voice uses a first-frame ticket/token handshake, never URL credentials. AudioWorklet emits20ms PCM16k chunks; transport batches at most100ms/3200bytes per frame. Playback is bounded PCM24k. A server `confirmation_ready` event contains only an opaque attestation reference; the domain reloads its persisted binding and rechecks target authority before applying or replaying a receipt. Never forward that reference or any review confirmationToken to a model.

Real local Chrome consumption using data-input voice.js/voice-panel.js passed6/6, with synthetic microphone/transcripts and unchanged domain drafts. The Projects context adapter is planning-only (previewBinding:null, confirm:false). This release is not native paid enablement or a second domain draft implementation.

Confirmation policy receives `confirm({text,binding,context})`: `context` is the deeply frozen, already-resolved domain context payload, covered by the utterance's context digest. This supports domain-specific required payment acknowledgements without additional nontransactional queries or client evidence. Binding is also a frozen clone. Changing the context invalidates prior confirmation under the existing fence.

### Projects confirmed-draft extension under local acceptance

Projects now supplies its server-owned immutable draft and current preview binding through the same adapter. It supports canonical field-update and grouped-move actions, exact spoken confirmation policy, and atomic attestation consumption with domain effects and receipt. The earlier planning-only description applies to the initial shared release; the confirmed-draft extension is recorded in local checkpoint02d156d. Current Phase9 integration acceptance remains open.

Transcript envelopes add the server-matched `utteranceId` alongside `type`, `text` and `final`. Existing consumers may ignore the additive field; Projects uses it to suppress repeated final transcript display. It remains provider-derived metadata and is never accepted as a client confirmation claim. A bounded relay audio-queue repair is under test and not yet released.

The pending relay repair batches only adjacent queued audio frames up to the existing frame-byte limit. Original PCM frames, ordering, hashes and global queue bounds are retained; every batch checks current authorization/context before provider input. Control/provider events seal batches. A valid confirmation attestation ends capture for that connection before the domain callback; queued/later audio cannot create a new utterance or contend with consumption. The connected session remains available for that atomic transaction. A new voice start requires a new prepared connection; ordinary final transcripts continue capture. These changes await real Projects Chrome acceptance and exact release identification.

Local validation completed in canonical Phase9:19/19 commands, both shared data-input and Projects realChrome acceptance pass, emulators stopped. The coalesced-input/terminal-confirmation contract above is locally verified; native paid remains disabled. Exact local source release is identified by the subsequent checkpoint commit, not by this document alone.
