# Phase6 audit

Status: CLOSED LOCALLY on237aba17. Same-revision Phase0-6 canonical checks passed; cleanup verified. Findings below retain discovery history; closure evidence and the Phase7 preview refinement boundary appear at the end.

| ID | Finding / required evidence | State |
|---|---|---|
| P6-A01 | Notification target IDs cannot open an arbitrary task through existing Board without exact authorized task read. Add current-ancestry GET task DTO and fence every UI await. | Corrected; API and real Chrome exact task/message/navigation proof passed |
| P6-A02 | Definition validation truthiness silently ignores malformed optional condition and else. Presence-based strict validation required. Invalid date must yield domain error, not RangeError500. | Corrected; strict negative definition/API cases passed |
| P6-A03 | Durable mute suppression and inactive-at-firing due cancellation are required to prevent later unmute/restore replay. | Corrected; persisted mute/due/restore and Chrome cases passed |
| P6-A04 | Event capture wraps transactions to collect semantic snapshots. Verify original read-before-write ordering, coherent completion race, merge semantics, due generation and safe payloads across all canonical commands. | Pure and persisted snapshot/race/atomic rollback evidence passed |

Fixture discipline: seed shared Auth once per process; separate project IDs per failure family. Re-seeding during a held revocation scenario could erase the very authority change under test. Worker restart tests reconstruct worker instances with the same Firestore and clock, not only HTTP routers. Exact-once tests compare actual persisted operation/event/task/journal/notification identities and counts.

P6-A05: Initial appendVersion implementation disabled the active rule and incremented cancellation generation. Root requires distinct active/candidate pointers so saving a candidate does not cancel captured prior-version events. Explicit disable alone advances cancellation generation. Also resolve dynamic sample recipients during preview. Sent to backend; persisted version oracle pending.

P6-A06: Notification creation initially caps union at50, below valid task owner plus50assignees and discussion mention/reply union. Raise bounded built-in union or chunk deterministically; explicit automation recipient bound remains50. Feed chronological ordering requested.

P6-A07: Notification target held before ordinary project navigation can resolve after navigation and adopt the new shell counter as baseline. Capture navigation generation before target request; preserve one intentional notification-driven project transition. UI worker confirming read-only; edit slot pending.

P6-A08: Processor acquire counts every normal delay resume toward five-attempt retry cap; valid workflows with more than five delays fail. Retry accounting must distinguish successful waiting/progress from repeated failures/reclaims.

P6-A09: Bounded worker queries select first waiting/running records without eligibility filtering or fair cursor, allowing future/leased entries to starve later ready work. Require durable fair scan or eligible timestamp query.

P6-A10: Canonical effect context initially checks lease/rule/journal but leaves trigger lifecycle/due/reference checks in preflight. A due change or archived trigger between preparation and effect can escape expectedRevision when the action targets a different task. Revalidate inside effect transaction. Persisted held-beforeEffect counterexample assigned.

## First root diagnostic - passed, not canonical closure

`test-results/crm-projects/phase6-diagnostic-1.json`: custom scope, success true,5/5 commands (fixtureseed; definition7/7; notificationclient15/15; API8/8; persisted18/18), no failed commands, emulator stopped. Finished September7,2026,08:13:57PM Vietnam Time. Root independently checked absent emulator lock and zero listeners on9180/8188/8189/9399. Source remained fixed during run.

Persisted proof includes captured V1 surviving V2candidate/activation, two equal task/notify action identities, before/aftercommit crashes, stalelease takeover, notify effectCount reconciliation,45candidate fanout40+5, actor revocation/disable afterpreparation, seven delays and freshbranch, all canonical actions/typedvalues, waiting fairness, dueA-B-A/Undo/title-only/no-retroactive activation, changedtrigger due/ancestor againstdifferenttarget, inactivefiringrestore policy, concurrent directchildcompletion/reopen/reparent and cycle ancestry.

P6-A01 exacttask API and P6-A07 UI heldnavigation still need realChrome acceptance. Other source corrections have focused/persisted evidence; canonical finalSHA and all affected regressions remain pending. Required smaller authorization/lifecycle gaps assigned to independent tester: previewexpiry/crossactor/schemachange, actortransfer/oldrunrevocation, directchildarchive/restore and bounded repeated crash exhaustion. Chrome file being authored separately. No production or provider acceptance claim.

## First canonical failure and bounded corrections

Preserve `test-results/crm-projects/root-phase6-candidate-433f4380.json`:4/6 commands passed. Definition7/7, client15/15, API9/9 passed; persisted20/21 and Chrome failed. Cleanup stopped the emulators; root verified absent lock, zero managed listeners and no remaining headless Chrome.

The held-running fairness fixture prepared create actions before subsequent fixture task creation. Actual Firestore run evidence showed `STALE_STRUCTURE_REVISION` at `/make`, attempts2, while three other leases remained held. Correction creates all four tasks before preparing any action; exact recovery count and held-run assertions remain unchanged.

Chrome passed its first case, then reloaded and selected a project while Access was still pending. Network showed only initial-project successful reads, with no requested-project read. The helper now waits for shell, Access and Board readiness; response/action promises have immediate rejection handlers. Failures retain screenshots, DOM and controller state before a fresh-shell recovery for subsequent cases. All eleven acceptance cases remain.

P6-A11: Late due-processing catch-up must not claim the deadline is today. Copy now says "A task reached its due date." These bounded corrections are committed in25f2a92e; canonical rerun is pending. No failure is waived or counted as a pass.

## Corrected canonical candidate and final lifecycle correction

`root-phase6-candidate-25f2a92e.json` passed canonical6/6: definition7, client15, API9, persisted21, Chrome11, plus fixture seed. Root verified stopped:true, absent lock and zero managed listeners. Chrome report preserved as `phase6-browser-report-25f2a92e.json`; seven screenshots under `phase6-browser/`. Root viewed the long paged-message screenshot (downscaled, limited legibility) and the readable notification-access-revoked screenshot: cached feed/Board content cleared while independent admin membership metadata remained. The automated exact-message focus and navigation assertions passed.

P6-A12: Read-only designer preparation found duplicate inherited the source candidateVersion, causing default GET to resolve a cross-rule version404; disabled append also retained an obsolete candidate. Source correction e8b7cbad clears the candidate on replacement version and removes inherited activation timestamp from duplicates. Active candidate save and explicit disable semantics remain intact. Independent API case checks fresh copy GET, source/registry preservation, disabledV3 default GET, old immutable versions and exact retry counts. API suite now10cases. Fresh full CRM lint and staged whitespace checks passed. Final canonical e8b7cbad is running; affected Phase0-5 regressions remain required before closure.

Final source e8b7cbad canonical report `root-phase6-final-e8b7cbad.json` passed6/6, certifiesCanonicalPhase:true, errors:[], finished2026-09-07T13:37:30.280Z. Definition7/client15/API10/persisted21/Chrome11 all passed. Root checked stopped:true, absent lock and zero managed listeners. Browser report preserved as `phase6-browser-report-e8b7cbad.json`. Phase0-5 regression batch now runs sequentially on this exact source; closure remains open until those reports are inspected.

P6-A13: Phase0 regression on e8b7cbad passed8/9; exact shell asset test still expected Phase5 CSS/admin and Phase4 discussion, and omitted the new notification asset. Actual HTML correctly versions all changed assets asPhase6. Root updated only the explicit test version map and added the mandatory notification asset entry; the exact assertion loops remain unchanged. Focused shell static test passed. Commit237aba17 contains this test-only correction; all Phase0-6 canonical checks now rerun sequentially on237aba17 for a single-revision closure. Failed `root-phase0-final-e8b7cbad.json` remains preserved; emulator cleanup succeeded.

## Local closure

Root independently inspected reports `test-results/crm-projects/root-phaseN-final-237aba17.json` for N0..6: every revision is237aba179d24c4ff27bf721401049045dca84324, success/certifiesCanonicalPhase true, errors empty, managed emulator stopped. Totals respectively9/9,4/4,3/3,3/3,5/5,10/10,6/6. Final Phase6 finished2026-09-07T13:56:04.375Z. Root verified absent lock and zero listeners9180/8188/8189/9399. Phase6 definition7, client15, API10, persisted21 and Chrome11 passed. Browser report preserved as phase6-browser-report-237aba17.json; seven screenshot paths are recorded there. CRM lint and exact shell contract passed.

P6-A01..A13 corrections have source and executable evidence described above. No deployed scheduler/index/rules, production mutation, remote push or paid provider acceptance is claimed. Phase7's richer sample projection has an explicit integration refinement: current Phase6 preview checks dynamic recipients on the initial sample, while execution correctly resolves them after prior actions. Assign-then-notify with an initially empty/changed owner requires ordered sample evaluation in Phase7; this conservative preview limitation is documented, not claimed resolved by the engine suites. Phase7 implementation continues under the existing approval.
