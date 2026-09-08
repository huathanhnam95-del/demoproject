# Phase7 audit

Status: CLOSED LOCALLY on source4ba7cfd1 after canonical6/6, Chrome10/10 and same-source Phase0-6 regressions. Root owns audit and acceptance decisions. Earlier entries below retain the investigation chronology and failed evidence.

| ID | Required boundary | Initial disposition |
|---|---|---|
| P7-A01 | Sample preview dynamic recipients follow earlier projected assignment; before-delay branch conditions still use immutable sample; after-delay effects provisional | Backend refinement assigned; initially empty/changed owner persisted oracle required |
| P7-A02 | Full filtered rules pagination across a bounded scan and empty continuation pages; cursors bind actor/project/all filters | Backend and independent API acceptance required |
| P7-A03 | Lost create/duplicate/save acknowledgement reconciles original payload/operation before changed mutation; newer local draft survives | UI/controller implementation plus held-response persisted proof required |
| P7-A04 | Owner403 immediately clears designer, even if authority refresh fails; resource404 never revokes unrelated project content | UI/controller and real Owner-to-Editor Chrome proof required |
| P7-A05 | Recipe/blocks preserve all node IDs, typed values, condition groups, branches and delay order; unknown references remain repairable | Pure deep-freeze roundtrip plus actual saved definitions required |
| P7-A06 | Draft/context/sample changes invalidate previews and fence held save/preview/open/history callbacks | Pure scoped race and real Chrome evidence required |
| P7-A07 | Save preserves designated actor; explicit transfer creates version; activation always uses fresh preview token | Existing engine lifecycle plus designer/persisted acceptance required |
| P7-A08 | Safe preview/run rendering uses friendly labels and omits raw JSON, leases/capabilities; keyboard and focus stay usable | Root source review and Chrome artifact/hit-testing required |
| P7-A09 | Projected set_field/assign must reject known resulting owner/assignee overlap, matching canonical updateTask | Root source finding sent to backend; negative and preceding-clear positive pure cases required |
| P7-A10 | Created-task preview must show canonical default owner/status/assignees/dates/values and reject default-owner overlap while preserving explicit null owner | Root found after first pure pass; bounded backend fix queued until writer slot releases; independent persisted oracle assigned |

Backend DTO agreement: list adds activeActorUid,draftActorUid,validationState:not_checked; query/folder/enabled cursor scope and max200 scanned records. Effects retain nodeId/type/payload for compatibility and add path,1-based sequence,target,changes,recipientUids,section,provisional. Custom changed fields use values.<columnId>, absent before/after values are null. See phase7-designer-preparation.md for full contract and acceptance.

No Phase7 implementation/verification result is claimed yet. Root will inspect actual diffs, run pure and independent API/persisted checks, real Chrome flows and affected canonical regressions before closure. Production and paid provider gates remain separate.

Root independently ran Node22 `--test tests/crm/projects/phase7-automation-preview.test.js`:9/9 passed on the released initial backend draft. P7-A09 is implemented with negative/preceding-clear cases. Backend list/preview changes remain uncommitted and require persisted verification; P7-A10 is not yet corrected. UI and independent API test workers currently own the two writer slots; root runtime remains idle.

## Backend diagnostic completed before user-requested pause

The preceding paragraphs record intermediate states, not the current backend status. Backend changes and independent API acceptance are committed as `851a42903b4fbcee1a7e70d7d8864c18c6db641d`. P7-A09 and P7-A10 were corrected before this revision. Root's custom Phase7 backend diagnostic passed 5/5 commands: fixture seed, preview 10/10, designer API 8/8, Phase6 API 10/10 and Phase6 persisted engine 21/21. Report: `test-results/crm-projects/phase7-backend-diagnostic-851a4290.json`; log has the same basename. Finished September 7, 2026, 09:10:50 PM Vietnam. Report revision matches the backend commit, errors are empty, emulator stopped; root independently found no managed lock or listeners on 9180/8188/8189/9399.

This is a custom backend diagnostic (`certifiesCanonicalPhase:false`), not Phase7 closure. UI files were being authored separately during the run and were not exercised by it. The user then instructed a pause after current subtasks. Complete already-assigned UI/controller checks and Chrome test authoring, retain browser acceptance as pending, and do not start Phase8.

Current root UI review follow-ups remain with the UI owner: stable keyboard focus after rerender, identifiable failed run node, definition-walk/journal ordering, and callback invalidation when a draft/rule changes. Final disposition will be recorded in the pause handoff.

Final local disposition: those follow-ups were implemented and covered by the17 controller tests;9 definition tests cover typed immutable edits, recursion/import bounds, renderer safety and empty-value labels. Root independently passed26/26; worker's broader scoped run passed44/44 plus static/syntax/lint. See phase7-pause-handoff.md for evidence paths and the full pending browser/canonical boundary. P7-A03 through A08 have source/local-test evidence, but required actual Chrome/persisted UI acceptance is still open. No audit row is promoted to full phase acceptance merely from authored Chrome tests.

## First actual Chrome acceptance after resume

Canonical report `root-phase7-first-41d305d6-port9399.json` passed5/6 commands; Chrome6/8 failed. Initial launch without the Storage override safely refused occupied unrelated9199 before executing tests; that report is preserved separately. Dedicated9399 run cleaned up completely. Browser artifacts copied to `test-results/crm-projects/phase7-browser-first-41d305d6` before reruns.

P7-A11: exact task reselection is asynchronous. The second selection of the same sample satisfied the test's old `sample.id` predicate before the lookup completed. A preview could start against the prior sample, then be invalidated by the selection acknowledgement while status remained Preparing preview. Root and UI worker independently identified this ordering from controller/test source and network evidence (no intervening Board schema/member refresh). Add a held-reselection regression, prevent preview while selection is pending, give invalidation a clear state and wait for actual selection completion in Chrome.

P7-A12: browser field helper selected both the target-kind dropdown and Find task button sharing the path. Narrow to native input/select/textarea; preserve strict cardinality and missing-reference repair assertions.

The first Chrome run already proved initial save/preview/no effects/activation, actual deterministic persisted notification/run/history, nested definition representation equality, held project/account responses and Owner downgrade. It does not prove the entire interrupted lifecycle case. Root inspected the created-preview screenshot (full-page image resized for viewing; not a substitute for readable viewport/keyboard verification).

## Local closure

Source `4ba7cfd1cd9583df3866da98ce7623a8f1af8259` fixes pending exact selection, superseding search, failed selection and edited-draft races. Root independently passed31 editor/controller tests, and full CRM lint passed. Canonical `root-phase7-second-4ba7cfd1.json` passed6/6: seed, preview10, API8, contract9, client22, Chrome10. Browser evidence is `test-results/crm-projects/phase7-browser/report.json` and its screenshots; no unhandled page errors or Projects5xx. Native caret/focus checks and 390px layout/hit tests passed (designer clientWidth=scrollWidth=287); root inspected the screenshot and measured report. P7-A01 through A12 are resolved at the applicable local source/API/controller/Chrome boundaries.

Same-source canonical regressions: `root-phaseN-regression-4ba7cfd1.json` for N0–3 passed9/9,4/4,3/3,3/3. `root-phaseN-regression-enabled-4ba7cfd1.json` for N4–6 passed5/5,10/10,6/6. All reports certify canonical scope and emulator stopped. Final run finished September7,2026,10:06:29PM Vietnam; root independently verified no managed lock/listeners. The earlier Phase4 fresh-process run failed because its fixture requires `CRM_PROJECTS_ENABLED=true`; the process-only flag corrected setup without changing product defaults or denial assertions. Use that flag plus `CRM_PROJECTS_EMULATOR_STORAGE_PORT=9399` for resumed legacy fixture runs. Failed reports are retained.

Phase7 is local feature acceptance only, not deployment or paid-provider acceptance. Phase8 follows the canonical shared staff accounting contract; do not infer a separate Projects wallet from historical phase names.
