# Phase9 local execution audit

Status: CLOSED LOCALLY for engineering acceptance. Native paid-provider proof remains OPEN. Shared engineering infrastructure was released in9c51251b; confirmation-policy context addition inbd1c3514. Paid native Gemini remains disabled. Existing Phase9/10 execution authorization continues; these source milestones do not close canonical Phase9.

## Current implementation contracts

One domain writer owns the existing command/recovery transaction boundary and batch preparers. runCommand gains an internal prepareAuthorization callback returning replayed plus a synchronous consume finalizer. Fresh effects and original-operation replay must agree with the prepared authorization state. Existing manual wrappers retain their behavior.

Field and move preparers read and validate all relevant current state before returning a write-only flush. Field updates preserve existing bulk semantics and add preview fences. The initial structural batch moves at most20 independent roots under one existing active parent, keeps descendants attached, increments structure once and records one grouped inverse including rank rebalancing. Undo must be atomic and revision-fenced.

A separate shared draft writer owns bounded immutable ordered action revisions, stable server-created action IDs, exact request replay, current scope authorization, decline/recovery and transaction-bound commit staging. Correction changes only the addressed action and invalidates preview. Historical drafts remain readable after expiry; expiry blocks fresh execution. Core primitives do not apply domain changes or call models.

## Next integration

Projects owns supported action schemas, reference resolution, impact preview and current project/calendar/schema/task fences. Apply receives draft/preview/attestation references only; authoritative actions, original binding and operation ID come from persisted server records. Current project write access remains mandatory on committed receipt replay. Confirmation policy is spoken and bound to current context; engineering attestations cannot authorize production.

The browser must expose multiple selected tasks without disrupting existing single-task details, keep manual work available, show the authoritative preview, open automation proposals in the existing Phase7 editor, and retain interrupted/declined/exhausted drafts. Native unavailability must remain explicit. No model output, click, typed yes, reconnect or client source flag substitutes for spoken provenance.

Remaining required acceptance includes actual Chrome selected-three move and grouped Undo, resolved Mai/next-Thursday assignment, owner-when-blocked proposal, stable second-action correction, revocation/concurrency/disconnect replay, and Phase10 integration/performance. Real native speech/usage/latency remains an external proof gate, separate from local deterministic acceptance.

## Confirmed-draft engineering checkpoint

The shared immutable draft store, canonical batch preparers, Projects draft/preview/attestation adapter and authenticated reference-only routes are implemented. Full domain fences are revalidated before spoken confirmation and again before effects. Authorization document reads are deduplicated and sorted before hashing; a regression reproduced nondeterministic profile/workforce completion and verified its correction. Current scope authority remains required on receipt replay.

Node22 focused verification: `node --test tests/crm/projects/phase9-confirmed-batches.test.js tests/crm/projects/phase9-draft-store.test.js tests/crm/projects/phase9-projects-drafts.test.js tests/crm/projects/phase9-draft-routes.test.js tests/crm/projects/phase9-accounted-generation.test.js` passed36/36. Log: `work/crm-projects-recovery/phase9-core-node22.log`.

Actual Firestore/domain diagnostic: `verify-projects-phase.js --phase 9 --manifest work/crm-projects-recovery/phase9-drafts-manifest.json --report test-results/crm-projects/phase9-drafts-persisted-second.json` passed seed plus all5 persisted scenarios: three-root atomic move retaining descendants, one grouped Undo, second-action correction, closed/expired-session receipt replay with current membership enforcement, and stale-fence rejection preserving the draft/proof. Emulators stopped successfully. First run is retained:4/5 scenarios passed and the close-session test omitted its required epoch; the corrected test passed. These are engineering attestations, not native speech evidence.

Impacted canonical Phase4 regression `test-results/crm-projects/phase9-phase4-regression.json` passed5/5, including the persisted API and real Chrome recovery matrix. The shared accounting bridge now also accepts the explicit Projects purpose/context contracts while preserving data-input compatibility and hard-disabled native dispatch; actual external data-input consumer plus new bridge tests passed12/12.

UI multiselection, richer context and proposal integration are ongoing outside this core checkpoint. A focused-checkbox title-cell refresh finding is open pending repair and Chrome verification. No canonical Phase9 closure, paid-provider enablement, deployment or production mutation is claimed.

## Integration audit in progress

Phase9 remains OPEN until the canonical suite and Chrome workflows pass. Added implementation covers server-resolved people/date/discussion/link context, shared-accounted proposals with durable validated-result recovery, selected-task UI, assistant previews and voice confirmation, and proposal-only automation editor integration. Native paid assistance remains hard-disabled.

Current diagnostic evidence: `phase9-api-first.json` passed seed plus all7 HTTP/persisted cases, including reference resolution, provider-time context changes, automation permissions, and direct denial for all5 new collections. `phase9-context-persisted-first.json` passed5 commands including context and existing link/view integrations. These custom manifests do not certify Phase9.

Independent code audit identified and repaired successful-save visibility across board refresh and new automation proposals inheriting an existing rule identity. Completion is fenced to the same account/project/draft after refresh. New automation proposals start a separate rule draft and preserve any existing unsaved draft. Focused client checks passed15 assistant cases and24 automation cases. The focused checkbox surrounding-cell refresh correction is implemented; Chrome validation remains pending.

The first browser diagnostic reached the real shell but selected a project before the access controller finished initialization; no workflow cases ran. Its failure is retained in `phase9-browser-first.json`. The fixture now waits on the actual pending control and requires the selected project's GET response and consistent board/view/assistant context. The second browser diagnostic is in progress.

The canonical manifest retains all original Phase9 checks and adds confirmed batches, immutable draft store, Projects draft/route/accounting contracts, context details, proposals, selection, assistant client and persisted draft acceptance. No Phase10 transition or release claim is made here.

Real Chrome diagnostic progress: project initialization and board loading are independent. The fixture now waits on both actual pending controls; instrumentation verifies canonical selected IDs and checked IDs agree after mouse, Space and third selection. The first workflow passes. Actual microphone admission occurs after prepare and native worklet PCM reaches the relay. Rich Projects context checks on each100ms frame exhausted the existing queue (`QUEUE_LIMIT`,33 messages,133264 bytes); the failure is retained in `phase9-browser-fifth.json`. A bounded adjacent-audio batching repair is underway without weakening current context/authority or raising limits. No later browser case is claimed passed.

A separate reviewed keyboard defect was fixed: preserved refresh snapshots now identify selection checkboxes and restore focus to the checkbox, preserving subsequent Space-key operation. Combined UI acceptance after this correction passed46 tests (`phase9-ui-audit-final.log`).

The sixth Chrome diagnostic passed ordinary transcript/provenance after bounded batching, then reached reference-only apply but received Firestore `10 ABORTED: Transaction lock timeout` while ongoing audio continued transaction work. Confirmation now terminates input for that connection: the relay discards queued/later audio after issuing the attestation, and the browser stops capture before handing confirmation to the domain. The authenticated session remains connected for fresh atomic consumption. Ordinary final transcripts do not terminate input. No limits or domain authority checks were weakened. Shared socket/browser-VM tests passed24/24, including late queued worklet callbacks, terminal-input ordering and unchanged byte bounds. Browser acceptance is rerunning.

Changed-file lint passes (`phase9-changed-lint.log`). An exploratory root `eslint .` scan failed with2106 errors across unrelated repository files (`phase9-full-lint.log`); this is not reported as a clean full-repository lint result. The scoped result covers changed tracked JavaScript plus new Projects/voice tests and sources.


## Canonical local closure

`test-results/crm-projects/phase9-canonical-first.json` passed19/19 commands, certifiesCanonicalPhase:true, errors:[], emulator started/stopped:true. The real Projects Chrome report passed all8 workflow cases with no page runtime errors and actual server AudioWorklet200 evidence. The unchanged shared data-input browser consumer also passed in this canonical run. Core immutable drafts, canonical batch application, context/proposal contracts, direct rules denial and persisted replay/Undo/stale-fence cases passed. The final independent read-only audit reported no additional concrete blockers; root inspected actual code, assertions, report fields and the committed-state screenshot. Changed-source lint passes. Earlier diagnostic failures are retained and explained above.

Phase9 local engineering acceptance is complete. Controlled native provider accounting and real native response-latency evidence remain unavailable; paid dispatch stays hard-disabled. No push, deployment or production mutation occurred. Proceed automatically to Phase10 integration/performance under existing authorization.
