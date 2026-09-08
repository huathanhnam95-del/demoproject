# Full CRM UI, Design and Layout Audit Execution Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to execute this audit task-by-task, with webapp-testing first. This is an audit execution plan, not authorization for product fixes or deployment.

**Goal:** Audit the practice platform and full CRM so every interaction gives immediate understandable feedback and preserves comfortable visual continuity, then produce a prioritized, separately approvable remediation backlog.

**Architecture:** Reconcile source inventories with full-shell Chrome observations and lightweight action-to-outcome measurements, then connect each finding to a specific role, state, workflow and version. Treat layout, typography, feedback and transitions as one interaction contract. Keep local fixtures, local persisted backend evidence and production observations in separate evidence classes.

**Tech stack:** Classic browser JavaScript CRM shell and workspace controllers, shared CSS tokens, Node/Functions CRM services, Firebase, Playwright with installed Google Chrome.

**ArtifactMetadata:**
- RequestFeedback: true
- Status: Audit and foundational remediation authorized; execution in progress. Fun/settings integration is not approved.
- Task: UI-02-crm-audit-plan
- Canonical owner: existing UI project in worktree 4287; duplicate planning track consolidated here
- Origin: `01a07e2b-0729-7910-b83d-9c81cc41a498` — Voice chat for CRM audit
- Preparation date: September 8, 2026, Vietnam Time
- Execution owner: assigned Codex coordinator; long-term product reviewer unresolved

## 1. Authorization and boundaries

The user subsequently authorized audit execution and foundational continuity remediation, including immediate feedback, removal of artificial navigation delays, stale-response protection and focus handling. The icon increment remains separately verified local work. Current CRM evidence uses isolated Chrome DOM/API fixtures, not authenticated or persisted production records. Continue independent audit work while the user evaluates the external motion prototypes. The first Fun prototype was rejected as insufficiently distinct; preserve it and Smooth for comparison. Revised motion research and standalone demonstration are authorized, but application Fun/settings integration awaits explicit approval. Push, deployment, production writes, paid AI/audio jobs, OCR activation and destructive operations remain separate authorization decisions.

The user has said “go back to normal” for all tasks. Normal routing is restored: Astra Medium coordinates; Luna X High is reserved for basic tightly specified assignments, Astra Low for moderately difficult bounded assignments, and scoped High/X High escalation follows the approved policy. Standard processing applies; no temporary Fast authorization remains. This audit stays on the direct Light route without subagents. Any future authorized delegation must explicitly set the supported model/effort and `fork_turns: none`. One owner controls browser, servers and emulator resources.

Use `C:\Cursor AI\.local\browser-test-credentials.md` for the documented default admin login, read privately at execution time. Never copy credentials, tokens or authenticated storage into tracked files. Lesser-role identities must be isolated fixtures or explicitly available test accounts, not changes to the real admin account.

## 2. Baseline and concurrent-work reconciliation

Canonical worktree: `C:\Users\Admin\.codex\worktrees\4287\Cursor AI`, source HEAD `9fadfec71222eccc056fb7ccf360f2bf8dd4d2ba`. Verified initially clean. The separately authorized icon increment now modifies only `public/index.html` and `public/style.css`; preserve those changes. Its external contract and passing completion evidence are in `C:\Users\Admin\.codex\ui-audit-20260908-4287`. This plan has a separate pre-write snapshot and contract in that directory's `crm-plan` child.

Use this worktree's [project structure authority](../../agent_docs/project_structure.md) and [machine policy](../../scripts/structure/policy.json). Both exist and were inspected. Do not import older repository structure or governance from the duplicate planning worktree. The supplied duplicate plan at `C:\Users\Admin\.codex\worktrees\8d7e\Cursor AI\docs\plans\2026-09-08-crm-ui-audit.md` was prepared on older `e3932069a9e0e7256357a656c72a5a114aa2c883`; useful coverage has been consolidated here. It is not a separate execution track or the canonical source baseline.

Projects is a concurrent candidate absent from this baseline's 13-entry ROUTES registry. The duplicate plan reports a Projects worktree `C:\Users\Admin\.codex\worktrees\b699\Cursor AI` and unfinished integrated work; those source/status claims are not freshly verified here. Before execution, obtain a settled manifest directly from the Projects owner and the data-input/shared-shell owner: candidate SHA, exact approved dirty-file hashes, feature flags, intended inclusion, unresolved work and runtime ownership. Audit each candidate independently until one integrated version is available. Do not cherry-pick, merge, copy a dirty tree, or audit a moving checkout without a separate declared scope.

The source release checkout contains unrelated work, including reported RTS audio changes. Do not touch it or copy its uncommitted content. Repository/release-preparation work and sealed artifacts remain outside this task.

Record source drift during execution and invalidate affected cases. Never restart or reuse another task's runtime/ports without ownership transfer. Port 8347 was used and released by the practice audit; this is not a permanent reservation or proof it will remain free. Data-input previously used HTTP9270; CRM recovery controls its emulator setup. Query owners again before reserving resources. Keep `agent_docs/project_progress.md` and `agent_docs/latest_session_work.md` unchanged in this Light-route planning task.

## 3. Source-grounded seed inventory

Paths in this section are relative to canonical worktree 4287 unless labelled Projects. The ROUTES registry, static panels, modal tabs, controller registrations, 51 files under public/js/crm and selected browser tests were inspected here. This is a seed inventory: dynamic descendants still require source/runtime reconciliation. Line numbers inherited from the consolidated draft are navigation hints and must be refreshed before execution; named paths and selectors are the authority.

| Family | Required surfaces and interactions | Grounding |
|---|---|---|
| Practice platform | PTE/English scope and skill switching, all exposed modes, dashboard panels, question changes, instructions, coach/results/history, recording/playback feedback and return navigation; preserve completed icon increment | `public/index.html`, `public/script.js` PRACTICE_LAUNCHER/PRACTICE_SCOPE_CONFIG, `public/style.css`, mode modules and `public/js/speaking-practice-controller.js`; initial external evidence under `C:\Users\Admin\.codex\ui-audit-20260908-4287` |
| Shell and routing | Login, denied access, top nav, Courses dropdown, More, assistant drawer, account/logout, hash canonicalization, direct links, browser back/forward and return-to-list | `public/crm-admin.js:18`, `:1123`, `:4853`, `:4916`, `:5001`; `public/crm-admin.html:37`, `:1021` |
| Dashboard | Summary/funnel/revenue, Essay AI status, duplicates, merge-job status and audit log; drill-down links and action dialogs | `public/crm-admin.html:372`; `public/js/crm/dashboard-workspace.js` |
| Students | Directory/search/filter/pagination and all data-driven list modes; profile Info, Learning Profile, Student 360, Courses, Finance, Identity, Teaching Sessions | `public/crm-admin.html:476`, `:1049`, `:1065`; `public/js/crm/student-directory-workspace.js`, `student-modal.js`, `student-360.js` |
| Learning and entrance results | Entrance link creation/status, result link, score detail and reload, result/PDF/audio screens, missing/expired/unavailable results | `public/crm-admin.html:1143`; `public/js/crm/entrance-test-link-state.js`; `public/crm-entrance-test-result.html` and matching JS/CSS |
| Finance and identity | Enrolment/invoice/payment/settlement views and validation, amounts/currency/dates, source attribution, permissions and identity linkage | `public/js/crm/student-finance.js`, `finance-workflow.js`, `student-courses.js:497`; student profile markup |
| Teaching sessions | List, upload drawer, analysis pending/failed/ready, viewer Briefing/Mindmap/Flowchart/Data, fullscreen, PDF, docked audio and timestamps | `public/crm-admin.html:1599`, `:2440`, `:2470`; `public/js/crm/teaching-sessions.js`, `teaching-session-mindmap.js`, `teaching-session-pdf.js` |
| Enquiry | Search/list, create/edit, source selection, lead tasks/activity/reminders, entrance-test linkage, conversion and validation | `public/crm-admin.html:701`; `public/js/crm/lead-workspace.js`, `leads.js`, `task-activity-workspace.js` |
| Staff and Agents | Staff accounts, teacher profile/availability, role controls; agent management, reporting/export and commission-related states | `public/crm-admin.html:785`, `:886`; `public/js/crm/staff-workspace.js`, `teacher-profile.js`, `agent-sources-workspace.js` |
| Courses/classes | Courses, Classes, Teacher Schedule, Class Management; course Info/Management; classroom Settings/Scheduling/Attendance/Stream/Modules/Classwork/Review Board; hidden live delivery if reachable | `public/crm-admin.html:488`, `:499`, `:542`, `:689`, `:1697`, `:1833`, `:2039`; `public/js/crm/classroom-workspace.js` |
| Scheduling overlays | Calendar modes/ranges, teacher quick-add, session bubble, add/replace/reschedule/conflict/availability flows and nested dialogs | `public/crm-admin.html:619`, `:648`, `:2271`, `:2318`, `:2369`; scheduler workspace modules |
| Books | Library/collections/tags/add book; Summary/Chat/Chat History/Pages/Notes; Text/PDF reader; citations, mind maps/node inspectors/context menus, source notes, version history, regeneration confirmation, BGM, highlights/bookmarks, compilation, knowledge graph, elaboration and study notes | `public/crm-admin.html:970`; `public/js/crm/books-workspace.js:1236`, `:1811`, `:2207`, `:2893`, `:5569`, `:6159`, `:6435`, `:7450`, `:8808`, `:9989` |
| Pronunciation Samples | Capability-controlled entry, comparison arena, queue/task/version states, waveform/spectrogram, diagnostics, save checklist, unavailable audio/provider and locked states | `public/crm-admin.html:212`; `public/js/crm/pronunciation-dual-arena.js:125`, `segmentation-study.js:463`, `:636`, `:1668` |
| Voice Cloning | Worker health, wizard, studio, upload/record/preview, unavailable/failed/completed job states and dialogs | `public/crm-admin.html:218`; `public/js/crm/voice-cloning-workspace.js` |
| Dev Tools | Local-only route, unavailable API, status, previews and confirmation screens for sync/maintenance actions | `public/crm-admin.html:106`; `public/js/crm/devtools-access.js`; shell initialization `public/crm-admin.js:1161` |
| Other/discovered | Recycle, Settings, Chatbot, communications/activity surfaces, bulk delete confirmation and any dynamically inserted popup or view | Route table; `public/crm-admin.html:2391`; `public/js/crm/recycle-bin-workspace.js`, `communications-workspace.js`, `activity-surfaces.js` |
| Projects candidate | Entry/access, create/settings/membership, Board/Kanban/Timeline/Calendar/Charts and filters, custom columns, virtual rows, task details/discussions/files/mentions/history, linked records, notifications, recovery, automation designer/history, AI allowance/budget when implemented | Candidate paths reported by Projects draft, verify with its owner: `public/crm-admin.html`; `public/js/crm/projects/{board,access,discussion,views,automations-renderer}.js`; `public/css/crm-projects.css` |

Source discrepancy queue, not yet browser findings: Recycle/Settings/Chatbot routes lack corresponding primary static panels; Settings/Chatbot navigation is disabled “Soon”; several accepted Courses hashes have no main panel or point inside a modal. Confirm intended placeholder behavior, deep-link fallback and visible navigation before severity assignment. Inventory every reachable child state; do not count one screenshot per table row above as completion.

Access coverage includes admin, teacher, signed out, denied/expired session, local versus hosted Dev Tools, capability enabled/disabled and direct-link bypass attempts. Projects additionally needs its actual Owner/Editor/read-only membership and disabled feature states. Derive the final role vocabulary from the frozen access implementation instead of assuming generic roles.

## 4. Coverage matrix and deterministic state catalogue

Create `docs/audits/crm-ui/<run-id>/coverage.csv`. One row represents a unique surface + role/capability + state + viewport/zoom + evidence class. Required columns:

`caseId, family, route, entryControl, surfaceId, sourceAnchor, sourceVersion, role, capabilityFlags, datasetId, state, viewport, zoom, inputMode, evidenceClass, expectedContract, commandOrSteps, status, findingIds, artifactIds, blockerOwner, blockerReason`.

Add transition-case fields: `action, priorState, pendingState, terminalState, requestIdentity, acknowledgementBudgetProposedMs, acknowledgementMeasuredMs, outcomeMeasuredMs, settleMeasuredMs, geometrySummaryId, liveObservationId, motionPreference, focusBeforeAfter, scrollBeforeAfter, staleResponseOutcome`. Keep proposed budgets and measured results in separate columns; an empty measurement is unverified, not zero.

Statuses: planned, pass, finding, blocked, not-applicable. Not-applicable requires a specific source/role reason; blocked never counts as pass. Report totals by family, role, state and device separately, with a denominator established after source/runtime reconciliation. Newly discovered surfaces expand that denominator visibly.

State fixtures: realistic populated records; zero records; no search matches; initial loading; slow dependent request; failed load with retry; failed save; validation and field-level errors; denied access; removed/stale record; offline/reconnection where supported; unsaved/cancelled edits; partial optional data; large lists; Vietnamese names/diacritics and mixed English; long unbroken identifiers/URLs and multi-line text; large/zero amounts, boundary dates and dense calendars. Use deterministic service/clock responses for unavailable provider states; label them simulated.

Minimum systematic coverage:

- Every reachable surface at desktop 1440×900, populated and empty; every form invalid and save-failure; every async surface loading/error; every permission gate both allowed and denied.
- Every distinct page/tab/dialog/drawer at 768×1024 and 390×844, populated with long content. Apply all error/validation variants to each distinct layout template; document justified reuse and test any divergent template separately.
- Shared shell, wide tables, calendars, Books readers, teaching viewer and Projects board/detail at 1920×1080, 1024×768, 360×800 and mobile landscape 844×390.
- Browser zoom 100%, 125%, 150%, 200% on desktop; 400% reflow stress on shell and representative complex workflows. Use actual Chrome browser zoom with a recorded verification method; deviceScaleFactor or CSS zoom alone is not equivalent.
- Keyboard traversal across every control family and each modal/drawer: Tab/Shift+Tab, Enter/Space, Escape, arrows where expected, focus visibility, focus containment/return and no keyboard traps. Record viewport emulation as Chrome emulation, not physical-device verification.

Expand combinations around actual failures. This is risk-based combination coverage with explicit dimensions, not an unsupported claim of testing the full Cartesian product.

## 5. Shared design and interaction review

Start from the real cascade: `public/crm-admin.html:9–19` loads shared tokens, shared styles and CRM styles. Inspect `public/design-tokens.css:123–176`, `public/crm-admin.css:15–92`, content shell `:748`, tables `:927`, buttons `:1080`, inputs `:1150`, modals `:1170`, plus inline and generated workspace styles and Projects CSS.

Measure computed font family/loaded font, size, weight, line height and Vietnamese glyph clipping; heading hierarchy; consistent label/help/error text; padding/gaps and shared left edges; panel width; density and row heights; control height and icon alignment; table wrapping/sticky behavior; color and status semantics; focus and disabled states; navigation discoverability; readable loading/error/empty messages. Propose a small token and component reference sheet based on current branding; do not redesign the brand during the audit.

Typography fixtures must include Vietnamese names and stacked diacritics (for example “Nguyễn Thị Mỹ”, “Điểm đầu vào”, “Hướng dẫn học tập”), mixed English/Vietnamese, uppercase, italic and bold, plus composed and decomposed Unicode equivalents. Inspect Chrome platform fonts for the actual glyph-bearing nodes, not only computed font-family. Repeat representative content with remote font loading blocked to verify fallback. Check line-box clipping, cropped accents in fixed-height inputs/buttons, truncation disclosure and font-scaling inheritance across every Books tab. Do not equate a successful font request with correct glyph rendering.

Use explicit proposed accessibility checks: ordinary text contrast 4.5:1, large text 3:1, meaningful control/focus boundaries 3:1; visible keyboard focus and programmatic names/errors; target size at least 24 CSS px or documented spacing exception, with 44px preferred for primary touch actions. Record measured colors/backgrounds, including overlays and disabled exceptions. These checks are audit acceptance targets, not a claim of a full accessibility certification.

For nesting, identify repeated decorative borders/backgrounds/shadows and compounded padding. Recommend flattening intermediate wrappers onto the parent surface while retaining meaningful dialog, grouping and hierarchy boundaries. Attach a measured before/example recommendation; do not prescribe removing every card.

Check clipping with bounding boxes and pointer hit tests, not just visibility flags. More-menu regression must include `elementFromPoint` below the header. For overlays, inspect z-index, scroll ownership, focus return and stacked Escape behavior. Inspect real audio/waveform readiness when required; a stubbed waveform does not prove rendering or audio quality. Preserve pronunciation provenance and exact timing contracts.

### 5.1 Interaction continuity is the first audit priority

The user's central requirement is that each action feels acknowledged and content does not abruptly flash, disappear, jump or leave the user unsure what happened. This is not a request to animate every control. Text input, audio, recording, validation and network work must never wait for decorative animation. An immediate stable state can be the best transition.

Current source evidence: `public/design-tokens.css` defines a 0.25s base transition on selected properties; `public/crm-admin.css` mixes 0.12–0.5s transitions, a 0.25s panel entrance and 0.3s modal entrance. `public/crm-admin.js` switches panels with `display` and triggers asynchronous controller refreshes. These are inspection leads, not evidence of a visual defect or a recommendation to standardize everything to 250ms. Inspect actual screens, timing and existing tokens before proposing a motion model.

Build an action → acknowledgement/pending → success/error/cancel catalogue for every discovered interaction family:

| Interaction family | Required transition checks |
|---|---|
| Routes, dashboard panels and tabs | Immediate selected-state acknowledgement; retain useful previous content or stable loading geometry; coherent incoming/outgoing content; browser back/forward, scroll and focus continuity |
| Dialogs, drawers, menus and tooltips | Both entrance and exit; close/cancel/Escape and click-away; focus containment/return; no transparent blocker left behind; reversal during entrance or exit |
| Expand/collapse and accordions | Understandable disclosure state; adjacent content does not jump unexpectedly; opening then closing rapidly settles to the latest action |
| Search, filters, sorting and pagination | Input stays responsive; pending/result counts are clear; prior results are not falsely relabelled; intentional scroll reset is distinguished from lost position |
| Load, refresh, upload and background jobs | Acknowledgement before a slow response; reserve useful geometry; loading/empty/error are distinguishable; success reflects actual completion versus queued work |
| Save, validation, retry and cancel | Pending button/form feedback; edits retained on failure; no duplicate submission; clear saved state; cancel/navigation cannot be undone by a late response |
| Practice question, answer, audio and recording changes | Input/playback starts without animation delay; clear preparing/playing/recording/submitted feedback; preserve question identity, timing and existing interruption contracts |

For every family exercise cached/fast, deliberately slow, failed and out-of-order responses. Repeat clicks before completion; switch A→B→A; close while loading; navigate away during a request; retry after failure. Verify the latest intended state wins, with aborted or safely ignored stale results, no duplicate saves, no ghost overlays, no focus trap and no unexplained scroll reset. Record intended geometry changes separately from accidental movement. Do not fix races during the audit without an approved remediation scope.

Use the next available paint as the desired local acknowledgement behavior. A proposed investigation threshold is 100ms from input to visible acknowledgement on the recorded reference environment, not a claim of measured performance and not a required wait. Final operation time is separate and may depend on a provider. Do not add artificial delays to make loading or success animations visible. After baseline live observations and measurements, propose content-appropriate enter/exit duration and easing budgets only where motion improves continuity; preserve immediate feedback regardless of animation length.

With `prefers-reduced-motion: reduce`, remove nonessential movement while retaining immediate state changes, stable geometry and explicit pending/outcome feedback. Test both preferences; reduced motion must not create blank frames or hide confirmation. Do not assume the existing reduced-motion stylesheet covers dynamically inserted components.

### 5.2 Lightweight continuity evidence; no recordings

The user explicitly prohibits video/screen recordings because of storage concerns. Do not create recordings, bulky Playwright trace archives, frame sequences or screenshot streams as substitutes. This restriction supersedes earlier draft recording requirements. Do not delete existing evidence; no cleanup has been authorized.

Static screenshots alone cannot establish smoothness. Observe real Chrome transitions live while collecting bounded in-memory timing, animation lifecycle and layout/state assertions. Start measurement before input and stop at the final settled state or a defined timeout. Measure input-to-acknowledgement, request duration, outcome feedback and settle time separately. Observe transition/animation start, end and cancel events together with affected container/control geometry, visibility, active route/request identity, focus and scroll. Event absence can be correct for an immediate or reduced-motion change; it is not a failure by itself.

Use performance.now and requestAnimationFrame in one browser clock. Keep a bounded ring buffer only in memory; persist aggregate values such as acknowledgement delay, maximum unintended displacement, blank-state count/duration, final state, stale-response outcome and pass/fail assertions. Do not save per-frame samples, DOM dumps or network bodies. Summarize deliberate expansion separately from unexplained movement. Record browser version, viewport, fixture, motion preference and measurement limitations. In-memory observations have sampling limits; do not claim they prove the absence of every possible compositor flash.

Require at least one narrow-viewport and keyboard sequence for each distinct transition template, and slow-response/failure/reversal sequences for each asynchronous template. Repeat focused cases when findings or uncertain observations warrant it. High-frequency instrumentation can affect performance, so keep it scoped and compare a live uninstrumented observation when a result is near the proposed threshold. A simulated fixture proves only that injected scenario. Store compact numerical summaries and concise live-observation notes, plus only necessary small screenshots of a specific defect or settled comparison; never a screenshot stream.

Continuity passes when feedback is understandable without guessing; no blank flash or unexplained jump is observed in the checked sequences; both enter and exit settle coherently; focus/scroll/edit state follow the expected contract; fast repeats/reversals settle to the latest action; stale responses cannot overwrite the current screen; and reduced-motion behavior stays stable and clear. If live Chrome observation is unavailable, mark the perceptual part blocked while continuing numerical checks. Do not claim full motion verification from a headless assertion alone. After a separately approved fix, compare the same live sequence and compact measurements on the settled candidate, without recordings.

## 6. Browser, data and evidence strategy

Use local Playwright first with explicit installed Chrome (`channel: 'chrome'`), full CRM HTML, real fonts and the complete stylesheet/script cascade. Record Chrome/OS/Node versions, origin, build/hash manifest, viewport, zoom, locale, timezone, flags and fixture seed. Check rendered readiness explicitly; long-lived connections can prevent network-idle, so rely on bounded view/data/font readiness assertions. Capture console exceptions and relevant request failures with sensitive fields removed.

Use three separate evidence classes:

1. **Local simulated UI:** deterministic API responses and fault injection. Proves layout/interaction for the stated fixture only.
2. **Local persisted integration:** isolated demo/emulator backend, independent saved-record read, reload and fresh browser context. Proves local persistence contracts for that version.
3. **Production observation:** only if later approved; record served asset identity and backend environment independently. Existing test data only, no saves/jobs/claims/uploads/sync. A local source SHA does not establish the deployed version. Optional live Antigravity browser confirmation follows local Playwright, with a recorded blocker if the bridge is unavailable.

For isolated workflows, use a run-specific record prefix and manifest of exact IDs, fixture owners and backend project ID. Fail closed if a mutation could reach production. Record before/after sanitized fields and reload expectations; verify cleanup of only owned fixtures. No outbound messages, paid generation, live student uploads, billing settlement or real corpus claims. Test those controls with isolated substitutes.

Cross-screen scenarios:

- Enquiry/source → entrance link/result → conversion → Student Info/Learning/360 → course enrolment → schedule → attendance → finance; check identity/source and visible status after reload at each transition.
- Staff/teacher availability → classroom scheduling/conflict/reschedule → teacher view; verify dates, role visibility and persisted updates.
- Classroom module/classwork → isolated learner submission → Review Board → review/resubmission; include adjacent learner screens only as workflow boundaries.
- Student teaching-session fixture → pending/ready/error viewer → diagram/fullscreen/audio/PDF → reopen the same record.
- Books library → reader → citation/note/chat/history → return/reload; distinguish text provenance/ingestion defects from layout findings and retain existing OCR work ownership.
- Projects candidate membership → task create/edit → linked CRM record → views/filter → discussion/notification → automation/recovery; verify virtualized focus, lateral scrolling, permission downgrade and stale writes in its isolated environment.

## 7. Existing test reuse and gaps

From the frozen repository root, useful focused commands include:

```text
node tests/crm/crm-shell-static.test.js
node tests/browser/crm-nav-dropdown-browser-check.js
node tests/browser/crm-header-drag-scroll.test.js
node tests/browser/crm-admin-workflow-browser-check.js
node tests/browser/crm-staff-browser-check.js
node tests/browser/crm-scheduler-browser-check.js
node tests/browser/crm-books-ui-browser-check.js
node tests/browser/crm-pronunciation-samples-browser-check.js
npm run lint:crm
```

Expected result: exit 0 and actual assertions/artifacts inspected. These are existing regression references, not commands executed during plan preparation. Most currently launch bundled Chromium without a Chrome channel and therefore do not satisfy the Chrome audit gate unchanged. Prepare a separately declared Chrome audit harness under `tests/browser/`, with sanitized fixtures under `tests/fixtures/crm/`; do not silently edit legacy tests or count their screenshots as full-shell proof. The workflow fixture stubs fonts; header/Books fixtures omit parts of the shell. Segmentation fixtures stub WaveSurfer. Staff coverage is not automatically included in the current aggregate.

`npm run verify:crm` is not an offline-only suite: it mixes checks, browser fixtures and data utilities, including schedule-backfill reads using Firebase configuration. Review each effect and destination before execution; safe dry-run wording alone is insufficient. The canonical `scripts/crm/verification-selection.json` exists here with an empty `features` array; it does not establish full CRM coverage. Inspect `node scripts/crm/verify-crm-suite.js --list` and each referenced effect before selecting commands. The current aggregate includes `scripts/crm/backfill-schedules.js`, so do not run the aggregate blindly. Projects uses its own phase manifest and canonical runner; coordinate the owner before selecting those commands.

Do not run `tests/browser/crm-teaching-session-live-audit.js` as audit smoke: it uploads audio and creates a production session. Production Books scripts and other teaching-session scripts also have production/default-record assumptions. Existing-server tests, including `crm-student-courses-live-server-check.js`, require explicit origin and verified isolated backend; localhost alone does not prove data isolation. Existing output destinations under `tmp` or screenshot folders need a declared audit destination before reuse.

## 8. Ordered execution and deliverables

Each phase ends with coordinator review; no product fixes are part of these phases.

| Phase | Action | Reviewable output and exit gate |
|---|---|---|
| A | Resolve baseline, concurrent candidates, owner, credentials, ports, flags and data isolation; external contract + before snapshot | `docs/audits/crm-ui/<run-id>/baseline.md`; exact source/input manifest, approved effects and resources |
| B | Reconcile routes, HTML, dynamic renderers, permission gates and runtime discovery | `coverage.csv`; every seeded family expanded to actual surface/state rows, placeholders explicitly classified |
| C | Build or adapt scoped Chrome fixture harness and deterministic datasets | Declared `tests/browser/crm-ui-audit-browser-check.js` and `tests/fixtures/crm/ui-audit.json`; full-shell readiness and failure capture proven before broad runs |
| D | First audit interaction acknowledgement/continuity across practice and CRM shared templates; then layout/typography and Students/Enquiry/Courses/Staff/Agents and teaching/finance workflows | Compact timing/geometry/lifecycle summaries and live Chrome observations, then finding records; complete matrix slices and persisted integration evidence |
| E | Audit Books, tools, audio and separate Projects candidate; inspect cross-screen consistency | Remaining matrix slices; explicit unavailable-service and integration blockers |
| F | Independent review of evidence and deduplication; rank remediation packages and acceptance checks | `findings.md`, `remediation.md`, `completion.md`; coverage accounting, unresolved owners and no unsupported pass claims |

Coordinator audits actual source/measurements/screenshots, not only agent summaries. Remain direct under the current Light route. If the user explicitly switches to Heavy or requests delegation, assign bounded read-only families using the normal routing policy above, explicit model/effort and fork_turns="none"; do not infer Heavy from the word deep. If all agents share one runtime, queue execution under its sole owner; parallel source review must not become concurrent UI mutation.

Future compact records belong in the declared `docs/audits/crm-ui/<run-id>/` directory. Compact numerical summaries, concise notes and necessary small images go to the declared external evidence directory. Do not generate video, trace archives, frame sequences, screenshot streams or bulky logs. Keep any individually necessary export artifact explicitly scoped before generation. For this planning task, the sole repository output is this plan. External contract and before snapshot are in `C:\Users\Admin\.codex\ui-audit-20260908-4287\crm-plan`. The sole repository output of this planning increment is `docs/plans/2026-09-08-crm-ui-layout-audit-plan.md`; the previously verified icon files are pre-existing protected work. Retain evidence through remediation acceptance and handoff; record SHA-256, tool/input identity, owner, rerun recipe and restore path. Cleanup requires its own exact-path authorization; never discard failed evidence silently.

## 9. Finding record and remediation process

Every finding must contain: stable ID, title, family, source version and environment class, role/capabilities, viewport/zoom, fixture ID, entry route/control, exact reproduction steps, expected and actual behavior, a necessary small contextual screenshot when it adds evidence, compact computed measurements/hit tests and sanitized console/request summaries when applicable, severity, affected matrix rows, likely ownership/root cause confidence, recommendation and executable acceptance check. Use sanitized IDs, never personal student data. Source-only suspicions remain hypotheses until reproduced or explicitly marked blocked.

Severity proposals: P0 blocks critical access or exposes sensitive data; P1 prevents a core task or hides essential action/status; P2 materially harms reading, navigation, keyboard use or responsive operation with a workaround; P3 is minor consistency/polish. Rank by user impact, affected roles/screens and frequency before effort. Separate shared CSS root causes from domain-specific behavior. One shared finding may link many cases but each affected family still needs regression evidence.

Remediation is a later approval package: first access/focus/obstruction, missing acknowledgement, stale-response and loss-of-state risks; then shared continuity patterns and shell/tokens/controls; then high-use workflow layouts; then specialist workspace fixes; finally polish. Each package declares exclusive files, protected behavior, before/after examples, measurable acceptance and adjacent regressions. Preserve unrelated changes and avoid redesigning active Projects/data-input work without its owner. A fixed label requires rerunning the exact reproduction plus affected shared-component cases on the final candidate. Prefer a shared pending/transition contract over unrelated animation patches; do not mask a slow or incorrect workflow with motion.

## 10. Completion and blocker criteria

**Plan complete:** source-grounded inventory, execution matrix design, safe evidence strategy, concurrent-work reconciliation, remediation process and acceptance/blocker criteria are present; only declared documentation changed. Product tests and browser execution are not applicable to this plan-only change.

Preparation verification: use the canonical worktree's structure checker against this plan's external contract and snapshot; report actual exit status separately. This baseline includes its policy, unlike the duplicate draft. Documentation-only checks include exact file delta, route-family coverage, links and absence of copied secrets; product tests do not apply to this planning increment.

**Audit complete:** every in-scope reachable surface is reconciled; every required matrix row has pass/finding with evidence or a specifically accepted exclusion; every finding is reproducible and prioritized; local persistence claims include independent record/reload evidence; no unexplained page failures remain; evidence manifest and actual file delta match the external contract. Report findings, blocked cases and exclusions separately. An audit can finish with open defects; that does not mean the CRM is fixed or release-ready.

Interaction continuity is a mandatory completion dimension: the action/pending/outcome catalogue, normal/reduced-motion cases, fast-repeat and stale-response scenarios, and lightweight timing/lifecycle/layout evidence plus live Chrome observations must be accounted for, without recordings or bulky substitute artifacts. A screenshot-only audit does not satisfy the user's objective, even if every page has a screenshot. Report provisional timing budgets separately from measured results and include a concise root judgment about whether the interface communicates each action clearly.

**Partial/blocked audit:** missing roles/fixtures/Chrome/services/fonts, unknown backend binding, unresolved source version, inaccessible candidate, ongoing conflicting ownership or incomplete integrated workflow. Record affected case IDs, evidence collected, owner, exact next action and which conclusions cannot be made. Continue independent coverage, but do not report “full audit complete” while required cases remain blocked without accepted scope change.

**Remediation complete:** separately approved changes pass their finding-specific and adjacent acceptance checks, with after evidence on a settled candidate. **Production verified:** only after separately authorized deployment/observation with actual served-version evidence. Neither follows from local test success.

Current decision boundary: review the standalone revised motion prototype before any Fun/settings integration. Audit execution and foundational remediation continue under their existing authorization. The existing UI project remains the owner; do not start a duplicate task. Deployment remains a separate decision.

## 11. Local execution checkpoint — September 8, 2026

UI-03's external contract and before snapshot in `C:\Users\Admin\.codex\ui-audit-20260908-4287\continuity` declare the exact shared feedback, shell, student-directory and practice-router paths. The candidate removes three animation-only waits; preserves the previous student rows while refreshing; ignores superseded student responses; guards delayed tutorials; and adds scoped modal/menu focus and reduced-motion support. No application Fun preference or backend change is included.

Installed-Chrome isolated checks pass for feedback ownership, retained geometry, modal close/reopen and focus (including controllers that focus synchronously), dropdown Escape state, out-of-order student refreshes and failed-refresh retention. The existing CRM workflow fixture also passes with installed Chrome and screenshot output omitted. This is fixture evidence only. The existing practice back/popstate test reaches `/pte-practice/speaking/read-aloud/731` but its original `/practice` substring expectation is obsolete. With only that expectation adapted to the current route schema in the external harness, its remaining history assertions pass; the unmodified test remains outdated.

UI-05 separately declares Staff refresh fixes and test changes in external `staff-continuity`. The new reproduction initially failed acknowledgment, latest-response ordering and retained rows after failure. All now pass for both teacher and account lists. The existing Staff/class-management browser fixture also passes. Role assignment, account mutation and backend contracts are unchanged. UI-06 corrected missing cache-version tokens on the new shared assets; the static CRM shell check now passes.

Read-only UI-07 swept ten routes at five widths using the full local shell with Staff API/auth/font fixtures. No document horizontal overflow was measured. Teacher Schedule initially remained visible alongside every route: its unconditional `display: flex !important` overrode router inline `display: none`. UI-08 scopes that flex override to visible schedule states. The focused hidden/active test passes, and the follow-up sweep shows exactly the selected panel on the seven implemented inspected routes. Recycle, Settings and Chatbot direct hashes now demonstrate their pre-existing empty main area; these are open route-fallback findings, not passes. Settings/Chatbot visible controls are disabled Soon placeholders, and Recycle has no navigation control in this shell. The repeated external sweep replaced its earlier aggregate file; before-state counts remain recorded in the tool output and this note (35 implemented route cases had an extra schedule, and 15 unavailable-route cases showed only the schedule). Do not imply a retained raw before JSON.

Latest received owner reports identify data-input candidate `f546ebe8ea53e39124e562cc31b770c7105ebe21` atop `683f12632629080f0b0b7b8f473ffde6ccc88544` in `C:\Cursor AI-data-input-20260907`, with broad local acceptance at `97b1adc41a058e206e073f0ba5956805dd5c8881` and narrower subsequent checks. Shared engineering commits in b699 are `9c51251bee99c8a28a6ec680e3169d45f307aeb7` and callback extension `bd1c35143a5d1ead6533d2a4c6887a35f994fa32`; uncommitted Projects Phase 9 is excluded. These are owner-reported candidate boundaries, not this audit's integrated verification. Auth/Firestore/Storage runtimes remain reserved to those owners. No cross-candidate integration is authorized by these reports.

UI-09 reproduces the unavailable-route empty panel and adds a pre-render fallback with an explanatory toast. Recycle/Settings/Chatbot hashes now resolve to Dashboard; disabled navigation remains disabled and Books child routes retain their workspace. The external Chrome sweep asserts exactly the expected panel, normalized hash and no document overflow across 50 route/width cases (390, 768, 1024, 1440, 1920). It passes, together with the static shell contract. The sweep uses Staff fixtures and does not establish other workspaces' backend completeness or typography. Reproduction and final results remain under external `route-fallback`; earlier `shell-sweep/results.json` retains the intermediate blank-route result.

External `motion-demo/index.html` is now the unified selector for Minimal Play (default), Original Smooth, Original Fun / stagger, and Tangible. The original comparison is preserved in `motion-demo/original.html`. No demo code is served by the application. The revised preview tests the same tasks in both styles, with anchored reveals and source-to-destination travel instead of shake/stagger. Enjoyment is a user judgment; research does not establish a learning benefit. Full-shell authenticated workflows, persisted-state checks, actual CRM font glyphs, candidate reconciliation and the remaining coverage matrix are still open. Do not describe the full audit as complete.


## 12. Resumed audit evidence and remaining coverage — September 8, 2026

The full audit remains in progress. The 50 route/width assertions establish shell visibility, fallback and document overflow only; they are not 50 completed workflow audits. UI-12 changes only this plan. Its external contract, before snapshot, reproduction harness and results are under `C:\Users\Admin\.codex\ui-audit-20260908-4287\audit-resume`. Existing application changes remain protected pre-existing work.

An independent actual loopback HTTP reproduction returns 404 for `GET /api/admin/sync-from-prod/collections` while running the real CRM shell with isolated authentication/business fixtures. Staff still loads, the sync navigation is hidden, the sync capability is disabled and its status says “Prod-to-local sync routes are unavailable.” No page exception occurred; two unrelated local Ollama request failures were captured. Source inspection confirms sync routes are conditionally mounted when `FIRESTORE_EMULATOR_HOST` is configured. This is a handled optional-capability probe in a composition without the route, not a demonstrated application failure. No product fix was made for this 404. A separate held-response check subsequently reproduced a startup dependency; UI-13 below records its bounded fix.

Three additional existing browser checks passed with installed Chrome: More dropdown, Books UI, and scheduler. The external adapter selects Chrome, omits screenshot-only writes and contains external requests; it does not change assertions. Books uses component DOM and in-memory request fixtures. Scheduler serves the local shell on an owned ephemeral loopback port with in-memory server state, real scheduling-service logic and stubbed Firebase/Ollama. Its server closes after execution. None of these checks verifies real login, backend persistence, real provider responses or actual font rendering.

| Surface or dimension | Verified evidence | Still open |
| --- | --- | --- |
| Practice launcher/router | Eight skill scopes; icon geometry; adapted history assertions; pending ownership and delayed-navigation guards | Remaining practice workflows and real provider responses |
| CRM shell | Ten route hashes at five widths; single-panel visibility; fallback; dropdown pointer hit-testing and Escape | Remaining route families, permissions, browser zoom and actual Vietnamese font glyphs |
| Students / Staff | Out-of-order response guards, pending feedback, old-row retention; existing isolated workflow checks | Student detail tabs, finance, identity, 360, entrance workflows and persisted record/reload evidence |
| Books | Reader page changes, reduced motion, formatting, new chat/history/rename, full saved note text, citation navigation/highlight and narrow viewport bounds | Full-shell role integration, real source/OCR/provider fidelity, persisted chat/note reload and comprehensive modal coverage |
| Courses / scheduler | Admin seed/add/replace, teacher placement and drag/reschedule, conflict rejection without mutation calls, regeneration preview/version/body and refreshed in-memory state | Persisted scheduling backend, remaining class tabs, other roles, mobile calendar and timing/accessibility states |
| Dashboard / Agents / Enquiry | Shell visibility and selected existing fixture paths only | Refresh ordering, complete conversion/activity/drilldown workflows and errors |
| Pronunciation / voice tools | Inventory only | Device/provider-backed UI flows and behavior |
| Projects / data input | Owner-reported candidate boundaries only; no Projects files changed in 4287 | Settled integrated candidate and independent workflow audit; ongoing ownership reconciliation |
| Cross-cutting dialogs / typography | Scoped shared modal focus, repeat/reopen and reduced-motion checks | Dynamic/class-only overlays, all forms, keyboard order, zoom, real fonts and composed/decomposed Vietnamese |

Next independent work is to expand remaining source/interaction inventory and audit bounded missing states. Candidate integration waits for exact ownership and settled baseline evidence; that does not block independent local fixture coverage. No production deployment or motion-preference application integration is implied by this checkpoint.


### UI-13 — optional sync discovery no longer blocks startup

The delayed-response reproduction held the sync collections response for 2.5 seconds: Staff was not loaded during the hold and became ready after the response. A stronger deterministic check held the HTTP response until after checking Staff readiness; before the fix, that assertion timed out at two seconds. The sync API wrapper has no request timeout, making an unresolved optional probe a local admin startup dependency.

`public/crm-admin.js` now starts `initDevTools()` without awaiting it and catches unexpected initialization rejection. Local/admin eligibility, capability hiding, disabled sync controls, collection/job loading and server authorization are preserved. No sync route was added. After the change, Staff becomes ready while the probe is held; releasing it with 404 retains the unavailable status and disabled controls. There are no page exceptions. The fast-404 reproduction, existing Staff/class-management Chrome fixture, static shell contract, dev-tools route guard and JavaScript syntax check pass. This verifies local fixture startup behavior, not real backend persistence.

The exact contract, before snapshot, failing before-check text, executable held-response harness and passing JSON are in external `sync-startup`. UI-13 modifies only the existing shell JavaScript and this plan, preserving the previous candidate. No production or other-owner runtime was touched. The full coverage gaps above remain open.


## 13. Expanded evidence and integration dependency

The current reviewable evidence package is [baseline](../audits/crm-ui/2026-09-08/baseline.md), [coverage](../audits/crm-ui/2026-09-08/coverage.csv), [findings](../audits/crm-ui/2026-09-08/findings.md), [remediation](../audits/crm-ui/2026-09-08/remediation.md), [partial status](../audits/crm-ui/2026-09-08/completion.md) and [exact source manifest](../audits/crm-ui/2026-09-08/manifest.json). These records distinguish completed assertions, open defects, unavailable integrated coverage and still-planned independent cases.

UI-15 fixes failed voice polling/status feedback; UI-16 fixes Dashboard/Agents response ordering. Their exact contracts and passing structure reports are in external voice-error-feedback and refresh-order. UI-14 was read-only evidence gathering; its planned documentation edit was superseded by UI-17 after the source fixes, using a fresh before snapshot. UI-17 changes only this plan and the six audit records.

The integration coordinator has confirmed that no combined mounted candidate exists and will assign exact version/origin/roles/runtime ownership. Data-input payment-followup work remains active; do not freeze its previous final candidate. Nonvoice9de84120 is settled; three authorized preserved-emulator GETs independently confirm selected persisted state but do not prove all UI roles/views. Continue independent planned coverage while the integrated target is unavailable. Motion redesign/integration remains excluded.


## 14. Reconciliation through UI22 — September8 evening checkpoint

This section supersedes older current-status statements above while retaining their historical evidence. The six audit records now reconcile real PDF/Mermaid/native-audio/reading-content checks,Student error cases,shared control families and sealed UI18–22 patches. Student/Teaching/Books/shared remainder rows are audited findings; only the actual remaining practice question/result package remains planned. See completion.md for exact local versus main-runtime boundaries and manifest.json for the25-path UI22 source chain.

The combined b507 source candidate now exists. UI23 error-state work is separately authorized against its exact shell/finance blobs in an isolated checkout; it is not a whole-file overlay and is not yet in this manifest. Teaching native audio sizing is separately authorized after writers release. No production or application motion-demo integration is implied. Original read-only findings and newly authorized fixes are tracked independently; the audit remains active until remaining coverage is accounted for.

## 15. Sealed UI23/UI24 checkpoint

UI23 is now sealed as a separate four-function, two-file patch against b507. UI24 teaching native audio CSS is sealed afterUI22 in the25-path chain. Exact manifests, qualification of UI23 sparse structure findings and retained test limitations are in the audit records. Original listening/speaking execution is still incomplete; fresh external-only fixture runs resume independently of the main-owned combined runtime. No additional product fix or deployment is implied.


## 16. Final assigned local audit — UI25/UI26

This section supersedes earlier current-status statements while preserving historical checkpoints. All six listening and seven speaking/typed-notes families now have actual retained desktop/mobile local fixture execution; OPEN-205 is no longer planned. Retell Lecture currently accepts typed notes, and ASQ Stop submits automatically. See the exact row counts, source identities and limitations in completion.md and manifest.json.

UI25 mobile Books selection and UI26 Describe Image load recovery/action clearance are sealed separately afterUI24. The final26-path application tree is bf83cb1482b927635b7702c78e9d848989135b4c; UI23 remains separate. Actual pointer flows and five final DI cases pass, with focused structure0 and exact patch reconstruction.

The assigned local audit is complete with documented residual findings. Four combined role/persisted/receipt acceptance rows remain integration-coordinator owned and physical/provider evidence remains separate. No unconditional original cross-owner audit completion, full WCAG certification or production readiness is inferred. Deployment/push still requires explicit authorization; the external demo is excluded.

## 17. UI27 bounded closure

UI27 closes the remaining F-04 toast/footer defect. The integration coordinator ran focused-check-v2 in installed Chrome: invalid-save and failed-save at 1440x900 and 390x844 all passed, with zero findings, stable source hashes, alert/assertive/atomic semantics, uncovered Save/Cancel hit points and actual Cancel within one second. Test source was d34accb14 plus CSS SHA256 08983239722eedac79861db525078e1fcf0c226bba3c5393b8f3a027bd97d3c7, subsequently committed as d4b5441a731ce83a48a2d8967a0dcb96855034ad. UI root inspected the receipt and verified the tested CSS hash and normalized committed CSS content; it did not rerun the browser. Evidence: combined-ui27-toast-check/f04-result.json (SHA256 66f517f3dbd9933ca0aeab5a38d0ecfcdcfbb26496228fa8c973b5a6d01d37db). The original form-wide validation accepts any one Info field; F-04 never established a missing association with an individually required field, so that unsupported residual claim is removed.

Assigned UI remediation is closed; the separate integration and physical/provider evidence boundaries above remain unchanged. No new source changes or browser execution were performed during this documentation reconciliation.
