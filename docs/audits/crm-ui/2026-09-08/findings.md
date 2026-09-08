# Reproducible findings — reconciled through external UI28

Earlier case rows remain historical evidence. A later fix does not erase a reproduced failure. Exact artifacts live under the external evidence root recorded in manifest.json.

| ID | Priority / current state | Finding and evidence |
| --- | --- | --- |
| F-01 | P2 externally fixed UI28 | Student UI20 retained; Course/Classroom actual mobile/desktop flows now pass. Integration pending. |
| F-02 | P2 fixed locally | UI18/UI19 establish actual Books mind-map/fullscreen entry, responsive controls, pointer Close/Export, keyboard and opener recovery. Historical static overflow is superseded. |
| F-03 | P3 externally fixed UI28 | Full local font faces render NFC/NFD through exact custom PostScript fonts; original text unchanged. Integration pending. |
| F-04 | P2 fixed UI23/UI27 | UI23 adds toast announcements; UI27 keeps validation/failed-save toasts clear of Student Save/Cancel. Four coordinator Chrome cases pass. Original form-wide validation does not establish a field-specific association defect. |
| F-05 | P2 fixed locally | UI15 handles delayed voice poll/status errors with visible failure and retry recovery. |
| F-06 | P2 fixed locally | UI16 guards Dashboard/Agents stale responses. |
| F-07 | P2 fixed locally UI22 | Success then failed compilation retry could download old Markdown. Root classifies this as misleading stale output, not irreversible data loss. UI22 clears/blocks downloads during pending/failed requests and verifies fresh retry artifacts and stale-response protection. |
| F-08 | P2 fixed locally UI22 | Graph GET failure was silently displayed as no links. UI22 distinguishes loading,403/error,empty and ready; real Retry keyboard/focus and recovery pass. |
| F-09 | P2 fixed locally UI23 | Profile failure now has visible Retry; pre-Retry and pending drafts are preserved, stale sessions ignored. Separate patch against b507; combined persistence acceptance remains main-owned. |
| F-10 | P2 fixed locally UI23 | Identity now distinguishes loading, unavailable, empty and retryable error; null-session stale responses and keyboard Retry focus verified. Separate patch against b507; combined persistence acceptance remains main-owned. |
| F-11 | P2 fixed locally UI23 | Finance summary/attendance failures render unavailable feedback; exact uncertain-payment request identity, enrollment/invoice selections and drafts survive failure and recovery. Separate patch against b507; combined persistence acceptance remains main-owned. |
| F-12 | P2 externally fixed UI24/UI28 | Native audio sizing retained; actual Teaching tab navigation and shell geometry pass at five widths. Integration pending. |
| F-13 | P3 externally fixed UI28 | Compact launcher clears actual AddCourse centers at360/390/1440; real clicks add0to1. Generic off-viewport sampling finding retained separately. Integration pending. |
| F-14 | P2 fixed locally UI25 | The wrapped303px Pages toolbar occupied a179px mobile reader. Mobile-only static positioning lets it scroll away. Same baseline/candidate harness confirms real selection, popup color click and local highlight persistence at390 and1440. Focus click before drag accounts for browser page-focus scrolling; no handler-only success claim. |
| F-15 | P2 fixed locally UI26 | Describe Image503 left an empty selector and retained the completed load promise. Inline loading/error/empty status and Retry now recover503 to200; concurrent retry calls share one request. Desktop/mobile actual Retry passed. |
| F-16 | P3 externally fixed UI28 | Compact mascot and native scroll clearance pass strict Retry at360/390 without corrective wheel loops. Integration pending. |
| F-17 | P2 fixed locally UI26 | Describe Image mobile See Results was under fixed toolbar/chat at the available scroll limit. Scoped220px bottom clearance makes the full flow pass at360 and390; desktop remains unchanged. |

Student toast footer-center overlap and reading mobile toolbar/chat overlaps are retained geometry observations. Do not claim permanent blockers from initial center hit tests; ordinary scrolling recovered tested Identity,Entrance,reading and Agents actions.

## Evidence limits

Real jsPDF2.5.1, Mermaid11.17.2 and pinned real SheetJS0.18.5 bytes were tested in their declared harnesses. Earlier fake PDF/waveform/parser fixtures remain historical and do not inherit that fidelity. Native teaching playback uses a real public MP3; physical audio quality is unverified. Mocked403 establishes local denied-state feedback, not actual backend ACL enforcement.

Original Books revision,segmentation and fixture setup failures remain retained with their adapters/diagnoses; no failing original suite is relabeled as an unmodified pass. Scope-specific missing optional @google/genai is not part of UI22 acceptance. No production readiness or full WCAG certification is claimed.

## Final practice evidence

All six listening and seven speaking/notes local families now have retained desktop/mobile execution. Retell Lecture currently accepts typed notes and has no recording controls. ASQ Stop is its submission boundary; it has no separate Check/Submit button. Obsolete hidden pickers, detached label fixtures, old explanation-toggle tests and audio Range setup failures remain preserved as failed harness history. HIW ignored audio was read from the existing local workspace by six exact candidate manifest filenames; the two full manifests differ, so no equivalence or native quality is claimed.

UI27 closes the remaining F-04 toast/footer defect. The integration coordinator ran focused-check-v2 in installed Chrome: invalid-save and failed-save at 1440x900 and 390x844 all passed, with zero findings, stable source hashes, alert/assertive/atomic semantics, uncovered Save/Cancel hit points and actual Cancel within one second. Test source was d34accb14 plus CSS SHA256 08983239722eedac79861db525078e1fcf0c226bba3c5393b8f3a027bd97d3c7, subsequently committed as d4b5441a731ce83a48a2d8967a0dcb96855034ad. UI root inspected the receipt and verified the tested CSS hash and normalized committed CSS content; it did not rerun the browser. Evidence: combined-ui27-toast-check/f04-result.json (SHA256 66f517f3dbd9933ca0aeab5a38d0ecfcdcfbb26496228fa8c973b5a6d01d37db). The original form-wide validation accepts any one Info field; F-04 never established a missing association with an individually required field, so that unsupported residual claim is removed.

## UI28 reopened fix-all status — external verification complete, integration pending

The user expanded remediation to all actionable residual observations, including F-03, F-13 and F-16. UI28 contains six modified paths and nine new font assets/license/stylesheet against813015aea8826e15f0548a3102938694e4002b08. Exact patch, source hashes, evidence hashes and reconstruction receipt are in external `reopen-all-20260909/integration-package/manifest.json`; patch SHA2568a461192a39d76d16a413887fdfac610ebc23515831f32bc79949ebcf3773d09. Read-only candidate apply-check passed and external reconstruction matched all15paths (LF-normalized text, exact binaries). No shared candidate source/index write, commit, push or deployment was performed by UI root.

Full Be Vietnam Pro WOFF2 delivery fixes decomposed Vietnamese fallback without normalizing source text. Course/Classroom mobile layouts and Teaching tabs now reflow; Review Board keeps intentional keyboard-scrollable columns. Compact accessible assistant controls and scroll clearance remove tested Agents/SST/reading overlaps. Entrance title/actions wrap. Books and Courses stale fixtures now match current intended contracts; the Scheduler date repair was already present and its focused Node suite passed. Identity six-state regression also passed.

Chrome evidence covers fonts390/1440; Course/Classroom360/390/768/1440; four reading families360/390/768/1440; SST360/390; Agents360/390/1440; Entrance12states; Teaching fivewidths; Identity sixstates; Books and Courses fixtures. These are scoped receipts, not one identical-source universal matrix: reading390/768/1440 and SST390 predate the final additive header scroll padding, while final360 reading and SST exercise it. The original360DD header failure and failed fixture adapters remain retained. Agents360 raw aggregate says pass-with-findings because a generic partial-visibility sample tested a center below the viewport; actual strict AddCourse center ownership and0to1 click passed at allthreewidths. No blanket zero-findings claim is made.

Combined role/persistence/receipt acceptance BLOCK196/197/198/200 remains coordinator-owned pending fresh receipts; BLOCK199 physical/provider evidence remains separate. CRM lead owns Chrome/runtime after UI release. Integration and native acceptance must be reported separately from this external-tested patch.
