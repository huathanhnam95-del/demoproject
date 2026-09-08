# Reproducible findings — reconciled through UI27

Earlier case rows remain historical evidence. A later fix does not erase a reproduced failure. Exact artifacts live under the external evidence root recorded in manifest.json.

| ID | Priority / current state | Finding and evidence |
| --- | --- | --- |
| F-01 | P2 fixed locally for Student shell | UI20 fixes narrow Student tab/content geometry; five actual Chrome widths passed. Original static course/classroom variants are not silently included in that fix. |
| F-02 | P2 fixed locally | UI18/UI19 establish actual Books mind-map/fullscreen entry, responsive controls, pointer Close/Export, keyboard and opener recovery. Historical static overflow is superseded. |
| F-03 | P3 open | NFD Vietnamese specimens fall back to Arial for four glyphs while NFC uses Be Vietnam Pro. Exact platform-font evidence remains font-zoom-real.json; no stored text normalization is authorized. |
| F-04 | P2 fixed UI23/UI27 | UI23 adds toast announcements; UI27 keeps validation/failed-save toasts clear of Student Save/Cancel. Four coordinator Chrome cases pass. Original form-wide validation does not establish a field-specific association defect. |
| F-05 | P2 fixed locally | UI15 handles delayed voice poll/status errors with visible failure and retry recovery. |
| F-06 | P2 fixed locally | UI16 guards Dashboard/Agents stale responses. |
| F-07 | P2 fixed locally UI22 | Success then failed compilation retry could download old Markdown. Root classifies this as misleading stale output, not irreversible data loss. UI22 clears/blocks downloads during pending/failed requests and verifies fresh retry artifacts and stale-response protection. |
| F-08 | P2 fixed locally UI22 | Graph GET failure was silently displayed as no links. UI22 distinguishes loading,403/error,empty and ready; real Retry keyboard/focus and recovery pass. |
| F-09 | P2 fixed locally UI23 | Profile failure now has visible Retry; pre-Retry and pending drafts are preserved, stale sessions ignored. Separate patch against b507; combined persistence acceptance remains main-owned. |
| F-10 | P2 fixed locally UI23 | Identity now distinguishes loading, unavailable, empty and retryable error; null-session stale responses and keyboard Retry focus verified. Separate patch against b507; combined persistence acceptance remains main-owned. |
| F-11 | P2 fixed locally UI23 | Finance summary/attendance failures render unavailable feedback; exact uncertain-payment request identity, enrollment/invoice selections and drafts survive failure and recovery. Separate patch against b507; combined persistence acceptance remains main-owned. |
| F-12 | P2 fixed locally UI24 | Scoped mobile CSS widens the teaching native audio control; actual pointer/keyboard pairs and seek pass at five widths. Separate teaching tab-strip/body overflow observations remain outside this fix. |
| F-13 | P3 open usability risk | At390 Agents Add Course center is under BEL launcher. Root normal nonforced click succeeded after910ms automatic scroll and added the course0to1. This is not a proven inaccessible action; no shared launcher fix is claimed. |
| F-14 | P2 fixed locally UI25 | The wrapped303px Pages toolbar occupied a179px mobile reader. Mobile-only static positioning lets it scroll away. Same baseline/candidate harness confirms real selection, popup color click and local highlight persistence at390 and1440. Focus click before drag accounts for browser page-focus scrolling; no handler-only success claim. |
| F-15 | P2 fixed locally UI26 | Describe Image503 left an empty selector and retained the completed load promise. Inline loading/error/empty status and Retry now recover503 to200; concurrent retry calls share one request. Desktop/mobile actual Retry passed. |
| F-16 | P3 open usability risk | SST Retry can sit under the BEL bubble. Ordinary upward scrolling plus an actual hit-tested mouse click completes the full mobile flow. Initial locator clicks could undo the scroll; this is not a proven inaccessible control. |
| F-17 | P2 fixed locally UI26 | Describe Image mobile See Results was under fixed toolbar/chat at the available scroll limit. Scoped220px bottom clearance makes the full flow pass at360 and390; desktop remains unchanged. |

Student toast footer-center overlap and reading mobile toolbar/chat overlaps are retained geometry observations. Do not claim permanent blockers from initial center hit tests; ordinary scrolling recovered tested Identity,Entrance,reading and Agents actions.

## Evidence limits

Real jsPDF2.5.1, Mermaid11.17.2 and pinned real SheetJS0.18.5 bytes were tested in their declared harnesses. Earlier fake PDF/waveform/parser fixtures remain historical and do not inherit that fidelity. Native teaching playback uses a real public MP3; physical audio quality is unverified. Mocked403 establishes local denied-state feedback, not actual backend ACL enforcement.

Original Books revision,segmentation and fixture setup failures remain retained with their adapters/diagnoses; no failing original suite is relabeled as an unmodified pass. Scope-specific missing optional @google/genai is not part of UI22 acceptance. No production readiness or full WCAG certification is claimed.

## Final practice evidence

All six listening and seven speaking/notes local families now have retained desktop/mobile execution. Retell Lecture currently accepts typed notes and has no recording controls. ASQ Stop is its submission boundary; it has no separate Check/Submit button. Obsolete hidden pickers, detached label fixtures, old explanation-toggle tests and audio Range setup failures remain preserved as failed harness history. HIW ignored audio was read from the existing local workspace by six exact candidate manifest filenames; the two full manifests differ, so no equivalence or native quality is claimed.

UI27 closes the remaining F-04 toast/footer defect. The integration coordinator ran focused-check-v2 in installed Chrome: invalid-save and failed-save at 1440x900 and 390x844 all passed, with zero findings, stable source hashes, alert/assertive/atomic semantics, uncovered Save/Cancel hit points and actual Cancel within one second. Test source was d34accb14 plus CSS SHA256 08983239722eedac79861db525078e1fcf0c226bba3c5393b8f3a027bd97d3c7, subsequently committed as d4b5441a731ce83a48a2d8967a0dcb96855034ad. UI root inspected the receipt and verified the tested CSS hash and normalized committed CSS content; it did not rerun the browser. Evidence: combined-ui27-toast-check/f04-result.json (SHA256 66f517f3dbd9933ca0aeab5a38d0ecfcdcfbb26496228fa8c973b5a6d01d37db). The original form-wide validation accepts any one Info field; F-04 never established a missing association with an individually required field, so that unsupported residual claim is removed.
