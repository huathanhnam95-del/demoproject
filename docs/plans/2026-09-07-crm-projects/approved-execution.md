# CRM Projects — approved execution contract

Approved by the user on September 7, 2026 with **PLEASE IMPLEMENT THIS PLAN** in the originating task `01a078ce-0b47-7c42-9fe5-71449cd2af89`. This document persists that authorization and its final scope. It is not a request for another implementation-plan approval.

Execution checkout: `C:\Users\Admin\.codex\worktrees\b699\Cursor AI`; branch `codex/crm-projects-2026-09-07`; initial clean revision `c09ecba40bf7f84a92623caeb044ea0ac4fb4ba2`.

## Authority and execution discipline

- Astra **Medium** orchestrates, diagnoses, inspects actual source/diffs/test assertions and closes phases. Luna **X High** owns all coding, test creation, fixes and refactoring. Every coder receives `fork_turns: none`, bounded file ownership, no nested delegation. One coder by default; two only for disjoint ownership. No Terra/Astra Ultra/Gemini Auto-Boost for this Codex execution. This overrides earlier root-only Sol routing.
- Every phase follows prepare → Luna implement/test → Astra actual-code and evidence audit → Luna address valid findings/refactor proportionately → retest → evidence-backed closure. A clean audit needs no artificial refactor. After two failed attempts on the same defect, coder returns reproduction/evidence for root diagnosis.
- Do not advance phases with unresolved acceptance defects. Report each phase closure to the originating task, then continue without routine permission requests. All eleven phases are authorized. Do not substitute additional planning for implementation.
- Preserve unrelated edits, one writer for shared files/manifests/rules. Only root maintains this package's progress/audit documents. Do not overwrite global `agent_docs/project_progress.md`, `latest_session_work.md`, or unrelated plans.
- No push, deployment, production mutations or unbounded paid calls. Paid voice remains disabled until hard-cap evidence passes. Missing external prerequisites must be reported precisely while independent authorized work continues.
- Run `python scripts/session_tagger.py remove-deployed` when applicable; never mark deployed without a separately approved completed deployment.

## Accepted product scope and requirement IDs

| ID | Contract |
|---|---|
| PRJ-NAV | Dedicated Projects tab in the existing CRM; modern bright, friendly, comfortable flat UI, retaining Monday-familiar primary organization and automation creation/editing. Avoid nested cards, unreadable styling and childish/game-reward inventions. |
| PRJ-TREE | Projects contain sections; sections contain tasks; tasks recursively contain subtasks and deeper children. Inline edits, drag reorder/section moves/reparenting, stable IDs, children remain attached. |
| PRJ-FIELDS | Configurable project-wide typed columns shared across all sections and depths: text, number, date, people, status, priority, dropdown. Stable field IDs, task-specific values. One accountable owner plus additional assignees. |
| PRJ-VIEWS | List/table, Kanban, timeline/Gantt, calendar and charts present the same canonical persisted records. Finish-to-start dependencies, cycle detection/conflict warnings, no silent schedule shifts. |
| PRJ-DISCUSS | Discussions on tasks/subtasks at every depth: replies, mentions, permission-checked attachments, own-message edits, owner moderation and history. |
| PRJ-RECOVER | Archive, Trash, restore, history and Undo for projects/sections/subtrees. No initial automatic permanent purge; existing CRM retention unchanged. |
| PRJ-LINKS | Optional links to existing leads/students/classes; standalone projects remain valid. Linked content requires its existing module/record authorization independently. |
| PRJ-CALENDAR | Versioned verified official Vietnam holidays; editable working week; administrator full-day inclusive leave for Whole team or Specific person. Preserve manual calendar entries during official updates. |
| PRJ-ACCESS | Unified People & Access on existing UID/login. Preserve teaching profile/classes/history. Separate workforce/module grants from explicit per-project membership. No learner/parent/guest implicit access. |
| PRJ-RULES | AI-created workflows plus familiar manual recipe/canvas editor, versioned deterministic execution, sequential actions/conditions/branches/bounded delays, current-project only. |
| PRJ-NOTIFY | In-app assignment/discussion/deadline/automation notifications, read/unread, authorized deep links and mute preferences. |
| PRJ-AI | Context-aware Gemini voice planning AND editing; shared current page/view/selection/hierarchy/discussion/people/dates/CRM context. Visible preview and explicit spoken confirmation before mutation. |
| PRJ-BUDGET | Starting US$5 per eligible workforce UID per Vietnam calendar month, administrator-adjustable; no rollover, no overshoot. Cross-device reservations and actual metered usage, preserve spend on adjustment. |
| PRJ-SMOOTH | Large hierarchical boards remain smooth, unclipped, accessible and stable under remote changes, failed saves and concurrency; actual Chrome evidence required. |
| PRJ-LEGACY | Existing lead/student/class tasks, teaching/scheduling, accounts, navigation, notifications and recycle-bin behavior remain intact. |

**Explicit exclusions:** reusable PROJECT templates, Monday import, project health dashboards, workload balancing/capacity dashboards, product task review/approval, time logging, cross-project My Work, external guests, per-subtask/private-comment ACL layers, email/SMS/push integrations, cross-project automation execution. Development code audit is required and is unrelated to excluded product approvals. Do not revive excluded UI/tests.

## Defaults and invariants

Project roles are **Owner / Editor / Viewer**. Owner manages membership/schema/settings/automations/project lifecycle. Editor mutates tasks/discussions and recoverable task lifecycle. Viewer reads. Organization admins manage accounts/calendars/allowances/memberships but require an explicit project role for project content. Last owner removal requires transfer. Teachers need a module grant AND membership and retain Teacher Schedule. Check current active account/membership at API, file, notification and AI-context boundaries; client claims are not sufficient.

Statuses have stable keys `not_started`, `in_progress`, `blocked`, `done`, with configurable labels. Default week Monday–Friday, editable, timezone Vietnam. Scheduling uses accountable owner's calendar or organization calendar if unassigned. Additional assignee leave may warn without introducing workload balancing. Parent progress and timeline spans are derived and visually distinguished from stored status/dates; they do not mutate parent fields unless an explicitly authorized rule does so. Charts label their active-leaf-task counting basis.

Archive/Trash retain data with no new permanent purge. Parent archive/delete covers descendants. Restore descendants, discussions, attachments, values and valid assignments; unavailable ancestors require chain restoration or an explicit destination. Inactive assignees remain historical and gain no restored access. Undo is a revision-checked compensating command with new history, cannot clobber subsequent edits and never refunds incurred AI spending.

## Architecture and shared contracts

Retain vanilla JavaScript, Express, Firebase and Chart.js. Keep project records separate from entity-bound `crmTasks` / `crmActivities` (mandatory lead/student/class references and legacy open/done/canceled semantics). Never reuse newest-500-before-filtering lists for accurate project queries/totals.

New code surfaces:

- `functions/src/crm/projects/` — focused domain/auth/command/query/rule/calendar/budget services.
- `functions/src/routes/crm/projects.js` — authenticated Projects router, mounted consistently in `functions/src/apiApp.js` and `src/server/app.js`.
- `public/js/crm/projects/`, `public/css/crm-projects.css` — feature-owned client modules/style. Keep `public/crm-admin.html` / `public/crm-admin.js` changes small and limited to integration.
- `services/crm-voice-relay/` — server-controlled authenticated Gemini Live WebSocket relay.
- `tests/crm/projects/`, `tests/browser/crm-projects/`, `scripts/crm/verify-projects-phase.js` — mandatory manifested checks and local evidence.
- `docs/plans/2026-09-07-crm-projects/` — approved scope, decisions, progress, audit resolutions and evidence references.

Domain records: projects (lifecycle/revision/CRM refs), members, sections/order, flat individually addressable tasks (parent reference/sibling order/title/status/owner/assignees/dates/typed values/revision), immutable-ID columns (type/label/options/order), task-addressed discussion/messages/replies/mentions/files, operations (actor/changes/revisions/result/inverse), versioned automations/events/runs, organization/personal calendars, per-account-month allowance/reservations/events/settlements/price versions. Firestore nesting does not limit UI hierarchy depth.

One validated command boundary serves manual edits, drag/drop, deterministic workflows and confirmed voice. Validate current access, references, types, expected revisions and retry idempotency. Per-task revisions for ordinary editing; transactionally serialize structural edits with ancestry/cycle checks, not a hot project revision for each keystroke. Root-only section reference with inherited descendant section is acceptable; any denormalized lineage needs atomic/fenced subtree consistency. Stable sibling rank tie-break and conflict-safe rebalance.

Filter before cursor pagination; full matching-set aggregates; explicit response revision/cursor; no page totals labelled complete. Initial query filters/sorts: section, status, owner/assignee, dates, title. Arbitrary custom-column query builders are deferred. Field replacement uses a new identity or validated explicit migration; archived field values survive. Permission-protected change/revision signals refresh relevant data without rebuilding the board. Deny client writes to protected project data and privileges.

## Phase 0 — baseline, isolation, routing and verification foundation

Requirements: PRJ-LEGACY, PRJ-ACCESS, PRJ-BUDGET, execution discipline.

1. Record checkout/branch/revision/dirty files/runtime versions/rules and baseline failures.
2. Apply the narrow workspace-wide GPT/Codex Auto-Boost exclusion in both isolated and primary `C:\Cursor AI\AGENTS.md` and `.agent/rules/auto_boost_protocol.md`, preserving dirty work and Gemini behavior. Do not copy the feature into primary. Restore ordinary Light default/persistence; preserve other routes/team/approval/deployment rules.
3. Set up isolated demo-project emulators and admin/teacher/staff-editor/viewer/unauthorized/suspended fixtures, never production data.
4. Build a phase manifest/runner with all mandatory tests; missing tests, no tests and failed commands must fail. Prove false-success prevention with deliberately failing fixtures.
5. Extend lint to nested feature modules and relay. Default Projects, automations and paid voice flags disabled.
6. Astra audits harness/isolation/routing; Luna fixes/refactors; rerun targeted account/task/scheduler/shell baselines. Exit only with evidence of a ready isolated environment.

## Phase 1 — People & Access

Requirements: PRJ-ACCESS, PRJ-LINKS, PRJ-BUDGET, PRJ-LEGACY.

1. Extend the account directory, preserving UID and teacher history; add workforce/module grants distinct from project memberships, Owner/Editor/Viewer and owner transfer.
2. Admin controls suspension, calendars and starting $5 allowance. Show Projects alongside Teacher Schedule when authorized.
3. Centralize authorization and align UI/API; block client self-escalation.
4. Direct API and Chrome matrix: admin/member versus nonmember, teacher, general workforce editor, viewer, learner/unauthorized, suspended; ID guessing, stale claims, revocation, last-owner transfer, linked-record restrictions.
5. Astra inspects real auth and assertions; Luna resolves findings/refactors; retest and close with persisted/Chrome evidence.

## Phase 2 — canonical domain and API

Requirements: PRJ-TREE, PRJ-FIELDS, PRJ-VIEWS, PRJ-ACCESS, PRJ-RECOVER.

1. Implement project/member/section/column/task services and typed shared commands; independent deep hierarchy, same-project/acyclic structure, eligible owner/assignees.
2. Implement sibling ordering, race-safe inverse moves, immutable field IDs, retained archived values, cursor queries, complete aggregates, indexes and change events.
3. Tests include deep trees, concurrent/inverse moves, duplicate operation, invalid typed values, deleted references and more than 500 records.
4. Astra inspects actual transactions/query/index/inverse design; Luna fixes/refactors and retests. Exit independently correct domain/API, not mock-only behavior.

## Phase 3 — primary board

Requirements: PRJ-NAV, PRJ-TREE, PRJ-FIELDS, PRJ-SMOOTH.

1. Projects chooser/tab; sectioned tree/table, inline cells and Add Column; keyboard creation/selection/focus; same-ID detail panel.
2. Drag reorder/section/reparent with indentation/insertion preview, retained descendants, edge auto-scroll/expand-on-hover. Pointer movement is transient; completed drop creates one logical operation. Keyboard move/indent/outdent alternatives.
3. Virtualize only visible expanded rows, lazy-load branches; pending optimistic state/rollback; overlays outside clipping; remote changes preserve editing/focus/scroll. Friendly flat styling, accessible states, reduced motion.
4. Chrome actual drag/scroll, menu hit-testing at edges, rapid changes, failed/slow network, persisted reload. Audit DOM/render/listener behavior and UX; fix/refactor/retest before closure.

## Phase 4 — discussions, history and recovery

Requirements: PRJ-DISCUSS, PRJ-RECOVER, PRJ-ACCESS, PRJ-LEGACY.

1. All-depth task threads, replies/mentions, authorized attachments; author editing/owner moderation/history.
2. Grouped operation history and revision-checked Undo; project/section/subtree Archive/Trash/restore; retain old notification/run references as tombstones. No new automatic permanent purge.
3. Real-backend nested deletion/restoration fixture: compare all content after reload, concurrent later-edit Undo conflict, interrupted bulk operation, existing CRM purge isolation.
4. Astra audits actual recovery data/permissions/inverses; Luna resolves findings/refactors; retest and close.

## Phase 5 — shared views, calendars and CRM links

Requirements: PRJ-VIEWS, PRJ-CALENDAR, PRJ-LINKS, PRJ-SMOOTH.

1. Kanban by status with ancestry; timeline/Gantt editable dates and distinguished derived parent summaries; finish-to-start dependency cycles/conflicts; calendar; charts by status/accountable owner/completion on labelled active-leaf basis; consistent filters.
2. Organization workweek and inclusive full-day exceptions; Whole team / Specific person admin leave; accountable-owner calendar calculations; preview before schedule changes.
3. Versioned verified Vietnam holidays distinguish statutory/compensatory/employer-choice/public-sector swaps/proposals. App sync follows publication of verified revisions and retains manual entries. No invented official API.
4. Current verified law includes November 24 Culture Day (Resolution 28/2026/QH16 effective July 1, 2026). The September 6 government explainer describes November 23 off / November 28 work as a proposal, not approved holidays: https://xaydungchinhsach.chinhphu.vn/ngay-24-11-hang-nam-la-ngay-van-hoa-viet-nam-nguoi-lao-dong-duoc-nghi-huong-nguyen-luong-119260113152642414.htm . Recheck official sources when implementing data; do not treat public-sector swaps as private-employer defaults.
5. Optional CRM links independently authorize record details.
6. Tests: known chart counts beyond 500 tasks, persisted cross-view changes, leap/lunar dates, compensatory rest, leave/precedence/restricted links. Audit/fix/refactor/retest.

## Phase 6 — deterministic engine and in-app notifications

Requirements: PRJ-RULES, PRJ-NOTIFY, PRJ-ACCESS, PRJ-RECOVER.

1. Versioned rules: task-created/status-changed/assignment-changed/due-date/all-DIRECT-children-complete triggers; built-in and typed-value conditions; set-field/assign/move-section/create-task-or-subtask/in-app-notify actions. Sequential/if-else/bounded-delay within current project only.
2. Persisted event queue and action journal idempotency `(project, ruleVersion, event, actionPosition)`; atomic command/outbox, retry dedupe and cycle prevention.
3. Dedicated due/delay processor; do not repurpose existing 24-hour CRM runner. Visible Vietnam firing time. Due-date edits invalidate earlier occurrences; Archive/Trash suppress ordinary due actions; revoked permissions/broken refs halt with visible failures.
4. Assignment/discussion/deadline/automation categories, read/unread, mute and permission-filtered deep links. No model call for normal rule firing.
5. Test duplicates/restarts/races/rescheduled due/revoked membership/deleted tasks with no duplicates/leaks. Audit engine/journal/authorization; fix/refactor/retest.

## Phase 7 — automation designer

Requirements: PRJ-RULES, PRJ-NAV, PRJ-SMOOTH.

1. Automate Create/Manage, familiar sentence When/if/then selectors, progressively revealed conditions/actions. Connected multi-step/branch/delay blocks use the SAME persisted definition.
2. Sample-effect dry preview and explicit activation; search/folders/enabled toggle/duplicate/ownership/history/run logs/broken-reference repair. The same editor accepts AI drafts.
3. Chrome create→preview→activate→edit→duplicate→disable→repair and representation roundtrip tests. Astra checks usability plus actual definitions; Luna fixes/refactors and retests.
4. Reference patterns: https://support.monday.com/hc/en-us/articles/360012254440-Build-your-own-custom-automation and https://support.monday.com/hc/en-us/articles/15080944734482-The-board-Automations-page .

## Phase 8 — hard $5 monthly accounting

Requirements: PRJ-BUDGET, PRJ-ACCESS, PRJ-AI.

1. US$5 per eligible UID/Vietnam calendar month, adjustable without resetting spent, no rollover. High-precision integer/decimal money, round only display. UI: allowance/settled/pending/available.
2. Effective-date model pricing; reserve validated maximum before bounded paid work. Atomic admission considers all active reservations across tabs/devices. `available = allowance - settled - activeReservations`.
3. Settle provider usage using disjoint modality/thinking categories; dedupe reports, never sum total plus components or streaming snapshots blindly. Unknown/disconnected usage remains reserved until reconciled.
4. Exhaustion preserves draft/manual features. Old-month pending stays original month; stop/rotate bounded live work before boundary with new admission. User cap is not replaced by provider's delayed project spend cap.
5. Demonstrate bounds on context/output/audio/retries/in-flight work. A guessed reserve is not a hard cap. If bounds cannot be proven keep Live DISABLED and report the technical blocker without softening the cap.
6. All feature Gemini usage counts; hosting/storage/development subscriptions are separate. Minute estimates are not billing meters.
7. Approved reference prices from https://ai.google.dev/gemini-api/docs/pricing require fresh verification: 3.8 Flash $0.75 input/$3.75 output including thinking per 1M through 2026, $1.50/$7.50 from January 1, 2027; 3.1 Live $3 audio input/$12 audio output and $0.75 text input/$4.50 text output per 1M.
8. Tests: simultaneous last balance, duplicate/missing reports, retry, admin limit decrease, month/year boundaries. Audit exact arithmetic, rounding and reconciliation; fix/refactor/retest.

## Phase 9 — context-aware Gemini drafting and voice

Requirements: PRJ-AI, PRJ-BUDGET, PRJ-RULES, PRJ-ACCESS, PRJ-RECOVER.

1. Gemini-only product APIs: `gemini-3.8-flash` structured project/workflow drafts and `gemini-3.1-flash-live-preview` native-audio companion (approved technical default). No GPT/OpenAI provider/key/fallback. 3.8 has no Live/audio output; 3.1 synchronous function calls only, no unsupported async speech/affective/proactive promises.
2. Server-controlled Cloud Run WebSocket relay handles authentication, budgets and secrets; persisted conversation/draft/reconnect independent of instance. Enforce Phase 8 gate before paid Live enablement.
3. Permission-filtered active page/project/view/selected task IDs/ancestry/columns/people/dates/relevant discussion/CRM links updated on navigation/remote changes. Resolve contextual references; clarify genuine ambiguity.
4. Model proposes the same validated command drafts. Visible impact preview plus EXPLICIT SPOKEN confirmation bound to exact draft/revisions; recheck permission/revisions before grouped recoverable application. No auto-apply on reconnect. Automation drafts open Phase 7 editor.
5. Retain interrupted/declined/disconnected/exhausted drafts. Controlled metered provider acceptance within configured test allowance validates accounting/stop/latency; no unbounded production calls. Unavailable provider/access/cap-bound prerequisites keep paid Live off while independent manual features complete.
6. Tests: move three selected under parent; assign Mai and next Thursday; owner notification when blocked; correct only second task; concurrent edit before confirmation; revoke mid-call; disconnect after commit; two sessions at final balance. Audit actual context/confirmation/permissions/idempotency/cost interruption; fix/refactor/retest.
7. Official references: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash ; https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview ; https://ai.google.dev/api/live ; https://docs.cloud.google.com/run/docs/triggering/websockets .

## Phase 10 — integration, performance and local release candidate

Requirements: all PRJ requirements; no deployment authorization implied.

1. Account→project→recursive tasks→columns/people→views/calendars→discussion→automation→voice→Undo end-to-end; two-user persisted concurrency; indexes/rules/files/suspension.
2. Fixture: **10,000 tasks, depth >=20, 30 custom columns, 500 expanded logical rows**, viewport plus bounded overscan DOM. Real Chrome traces/screenshots/console/network.
3. Record desktop hardware/conditions: drag/scroll p95 frame interval <=20ms; workload interaction p75 <=200ms (distinguish field INP); immediate optimistic feedback, edge overlay hit tests, stable focus/scroll and no full-tree mount. Failures require bounded fixes and fresh traces.
4. Voice end-of-speech to start-audio p95 target 2s for short responses in recorded conditions; report tool/planning latency separately. No claimed timing without measured artifacts.
5. Regressions: teacher scheduling, legacy tasks, nav/accounts/notifications/recycle bin. Feature-off test preserves data.
6. Prepare exact candidate revision, rules/indexes/relay prerequisites, deploy order and rollback only. No push/deploy. Audit actual candidate and cross-phase behavior, fix/refactor/retest. Final report separates verified local features, blocked paid-Live prerequisites and deployment state.

## Mandatory verification and evidence

- `node scripts/crm/verify-projects-phase.js --phase N` and `--all`: missing mandatory files or failed tests cannot report success.
- `npm.cmd run lint:crm`; `git diff --check`.
- Inspect legacy `npm.cmd run verify:crm` endpoints/setup first: it mixes browser/data scripts. Use only isolated emulators/fixtures. Existing schedule backfill defaults to scan unless `--apply`; do not mutate production.
- Chrome-only local Playwright first. Before any authenticated browser checks read `C:\Cursor AI\.local\browser-test-credentials.md`, use documented admin unless steered, never copy secrets. Emulator fixture credentials remain separate and local.
- Distinguish mocked contracts from authenticated API/persisted reload/second-session evidence. Actual hit-testing is required for clipping; screenshots alone are insufficient.
- Each root-maintained phase record must include requirement IDs, changed files, exact commands/results, browser artifact paths (or explicitly not yet applicable), resolved audit findings, external prerequisites and tested revision/content provenance. End package includes scope/contracts, closure/audit history, commands/artifacts, Gemini reconciliation, pending prerequisites, rollback and local-vs-deployed distinction.

## September 7 user-approved model and speed refinement

The originating coordinator relayed explicit user approval to choose efficient models by task and use Fast mode, including its higher Codex credit consumption. This supersedes the fixed Luna-only coding rule above: root orchestration/final audit remains Astra Medium; fresh Astra Medium workers may own complex cross-layer recovery, authorization, automation, budget and voice work. Astra Low may own straightforward bounded edits. Luna X High remains available for routine implementation, focused tests/fixtures and documentation. No Sol or nested subagents; retain at most two concurrent coders with disjoint ownership and one emulator owner. Transfer current source ownership only at an explicit safe checkpoint; preserve all edits. No claim of measured model speed superiority.

Worktree-local .codex/config.toml now requests service_tier="fast" and enables features.fast_mode. A fresh standalone Codex app-server config/read resolved this enabled project layer and effective fast tier, while the global user layer remained default. This verifies fresh configuration loading only, not already-running request tiers or future subagent inheritance. Keep this local execution configuration out of product commit allowlists. Supported running-task controls were unavailable from the current tool surface; no session metadata or global defaults were edited.

## CRM Projects execution override — user approved September 7, 2026

Applies only to the approved CRM Projects implementation in this worktree. It supersedes conflicting Sol-only, fixed-Luna and Auto-Boost routing above or inherited from parent instructions for this package.

- Luna X High: the most basic, tightly specified tasks.
- Astra Low: slightly harder but still bounded coding tasks.
- Astra Medium: default planning, orchestration and substantial or complex implementation; root owns final audit and decisions.
- After one or two meaningful unsuccessful attempts on the same issue, stop repeating the approach. Root diagnoses actual reproduction, failure evidence and attempted changes, then chooses a scoped Astra High or X High specialist when warranted. High suits a bounded difficult issue; X High suits interacting causes, architecture or persistent ambiguity. Escalate directly when justified, including before repeated failures for a known critical issue. Return to the normal task tier after resolution. No new permission question is required.
- Set the actual supported model and reasoning effort explicitly in every assignment. Use fork_turns="none", self-contained scope and no nested agents. Fixed-Luna named roles do not implement an Astra assignment. No Sol agents; Terra is not a standard tier. At most two concurrent coders with disjoint files/contracts and one shared emulator owner. Require explicit safe ownership release before reassignment; preserve in-flight work.
- Fast mode is approved, including higher Codex credit use. Local .codex/config.toml requests Fast; distinguish verified fresh config resolution from actual request tier. Never claim the root's current reasoning or any running request tier changed merely because a file or instruction changed. If root reasoning cannot be changed through a callable control, use a bounded authorized High/X High specialist while retaining root responsibility.
- Complete all eleven approved phases with the existing audit/fix/retest gates. Use focused checks while changing behavior and the applicable settled-candidate acceptance/regression gates. No push/deployment, production mutation, paid product API call, global config/memory update or unrelated-project changes. Do not edit implementation_plan.md for execution-setting refinements.

Durable scope and evidence: docs/plans/2026-09-07-crm-projects/approved-execution.md and progress.md.

### Processing speed is a separate explicit opt-in

Standard is the normal processing default. Fast requires an explicit user request; complexity, urgency, model choice and reasoning escalation never imply Fast authorization. The user explicitly approved Fast for this ongoing CRM Projects implementation only, so retain its narrow local override without asking again. Do not copy that override into global settings, other worktrees, unrelated/new tasks or reusable model defaults. When this approved execution ends, remove its local Fast override before reusing the checkout for unrelated work. A future task without explicit Fast authorization uses Standard. Configuration evidence does not establish an in-flight serving tier.

### Planning and discussion escalation clarification

Planning, design and discussion escalation: When the problem is difficult, ambiguous or remains unresolved after one or two meaningful attempts, explain the unresolved issue to the user and recommend Astra High or X High according to the problem. A known difficult problem can justify an immediate recommendation; do not repeat an unchanged approach at Medium or require a rigid escalation sequence. For the user-facing conversation, recommend the upgrade instead of silently switching its model or reasoning. This recommendation rule is distinct from already-authorized bounded implementation-agent escalation and does not reopen that authorization. Return to the normal tier after resolution. Medium remains the ordinary planning default. Fast remains a separate explicit opt-in; reasoning escalation never implies Fast permission.

## Standard processing override - September7,2026

User instruction relayed by task01a07bb3-c04d-73c3-a3c9-e7912e144148 supersedes all prior Fast approvals for this package: use Standard processing for all executions. Preserve existing model/reasoning and work scope. Local saved service_tier is default, Fast feature disabled; these saved settings do not prove a running turn changed service tier. Propagate to active agents. No available app/agent tool currently exposes a running-tier update or readback.

## User-requested pause - September 7, 2026

The user instructed: "pause execution after finishing current subtasks". This supersedes automatic continuation through the remaining phases. Finish the active Phase7 backend diagnostic and already-assigned designer UI/controller tests and Chrome test authoring, preserve verified results and pending gates, then pause. Do not start Phase8 or additional implementation. Resume remaining work only on a subsequent user instruction.

## User-requested resume - September 7, 2026, 09:36 PM Vietnam

Task01a0792b-f7f4-7011-971e-2e9f6cdbaa5c relayed the user's explicit request to resume Plan CRM Projects tab. Resume the existing approved roadmap from checkpoint41d305d6; the pause above is superseded. Retain Standard processing and current model/effort authorization. Root verified all workers completed/released and dedicated ports/lock clear before restarting Phase7 acceptance. No additional production or paid-provider authorization was granted. Do not touch the safeguards release checkout or primary8443 process.

## Universal AI input architecture refinement - September 7, 2026

Task01a07b81-40c3-7091-8b77-4c40fd749ab2 relayed the user's explicit instruction that platform live chats and AI-assisted input, including Projects, share one cross-feature provider/transport/draft/accounting contract with domain command adapters. Gemini Live handles realtime speaking/listening; Gemini3.8Flash interprets instructions, text and images and prepares/corrects typed drafts. Domain backends retain authorization, validation, confirmation and persistence. Ordinary manual keystrokes remain model-independent. Do not create parallel independent assistants or wallets. This refines future Phase8/9 module boundaries; it does not authorize unrelated model replacement or deployment.

Coordinate shared source ownership/names with that planning task before code changes. Preserve the Projects explicit spoken-confirmation requirement and existing workforce allowance eligibility; universal transport does not itself grant other populations a new allowance. Phase7 remains unchanged.

The user then explicitly resolved scope: staff accounts with CRM access only; no student live-chat users or student allowance. One staff UID plus Vietnam month identifies one shared balance across covered CRM AI modes, including Projects and staff data input. Features/purposes are attribution only. Preserve numeric defaults/overrides and independent domain/record permissions. Canonical contract: `docs/specs/shared-ai-assistance.md`, promoted from the aligned data-input task's latest contract.

## Autonomous local-readiness goal - September 7, 2026

The user requested autonomous goals for Projects, safeguards and data input while away. Projects owns its goal and `complete-crm-projects-locally` heartbeat; continue the existing roadmap with real Chrome and persisted evidence to local deployment readiness. Inspect active workers/resources before each continuation; never duplicate ownership. No deployment tonight, remote push, production mutation or unauthorized paid call. Keep paid Live disabled without proven bounds and report external prerequisites honestly. Other tasks own their own goals/checkouts; do not resume unrelated work.

---

## Superseding acceptance-policy and evidence addendum — 2026-09-08

This addendum is appended to the historical record above. It supersedes any conflicting acceptance-policy wording in that record while preserving the historical decisions, diagnostics and evidence verbatim. It is a current snapshot, not a rewrite of the original plan.

### Snapshot provenance

- Snapshot date: 2026-09-08 (Asia/Bangkok).
- Frozen candidate under review: `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI`, exact `HEAD` `d4b5441a731ce83a48a2d8967a0dcb96855034ad`.
- Historical source files copied without changing their content: `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI\docs\plans\2026-09-07-crm-projects\approved-execution.md` and `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI\docs\plans\2026-09-07-crm-projects\phase10-audit.md`.
- The copies and this addendum are external review artifacts under `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\audit-addenda`. No product code, runtime configuration, deployment target or production record was changed by this addendum.

### Superseding budget and execution policy

- The currently authorized policy is a **monitored shared USD 5 per staff account per calendar month across all live-chat services**. It is monitored, not a provider-invoice hard cap. No-overshoot is an admission and ledger rule; it is not an absolute invoice cap. The historical hard-cap gate language is superseded for current reporting.
- Bounded admission, reservation, actual metering, reconciliation, no overshoot and stopping on unknown usage remain required engineering controls. A planning estimate or campaign ceiling is an operational stop condition for its declared campaign; it must not be represented as an invoice cap.
- This policy update does not reopen permission for paid dispatch. The user owns production release approval; the coordinator prepares and audits the candidate, explicit runtime window, credential/admission checks, exact successor SHA, source/config/route/secret inventory and final acceptance evidence.
- Model and routing record for this snapshot: Astra Medium owns root orchestration and substantial work; Luna X High handles basic tightly scoped work; adaptive Astra High/X High is available when evidence warrants escalation; Standard was instructed; actual running service tier is not tool-verified; no nested delegation is authorized.

### Superseding native capability wording

- “Native hard-disabled” claims in the historical plan are superseded as absolute capability statements. The nonpaid acceptance harness intentionally forces native paid execution off and removes provider credentials; that is a runtime safety posture for this run.
- Native engineering/provider capability and earlier controlled paid evidence exist in the candidate’s `docs\plans\2026-09-07-crm-projects\native-runtime-decision.md` and the external acceptance material. Those artifacts do not establish current release readiness.
- Physical microphone/speaker verification and Vietnamese ASR fidelity remain unverified; native end-of-speech/rendered-audio latency remains unmeasured, so no native p95 claim is made. Earlier controlled native provider-output evidence does exist: `native-edit-12`, project creation15, rename17, task creation18 and response mute19 are recorded in the candidate native decision document. That evidence does not constitute this snapshot native latency campaign or release gate. The external `latency\README.md` remains a measurement protocol and offline calibration package.
- No provider call, production mutation, push or deployment is authorized by this document. Native capability remains a separately gated evidence track owned by the coordinator.

### Current frozen-candidate acceptance snapshot

- Canonical r2 report on source `d34accb14d6758d8531423caa5b828948a5af71f`: 57 of 77 required canonical tests passed after excluding the runner’s fixture-seed command from the required-test denominator. The raw report summary is 58 of 78 commands because that seed command is included.
- Exact twenty-test retry r3 report on source `d4b5441a731ce83a48a2d8967a0dcb96855034ad`: 12 of 20 required retry descriptors passed and 8 failed. The raw report summary is 13 of 21 commands because it includes the fixture-seed command.
- The honest cross-revision union is 69/77 (69 of 77) required tests. This is not a completed acceptance result. Journey and supplements remain pending separate runs.
- The retained Phase 10 performance artifact records all five declared cases passed, 455 active frame samples at p95 16.9 ms, and 40 trusted interaction samples at p75 48.5 ms. These are local browser-rendering figures under the declared fixture; they are not field INP, production latency or native voice evidence.
- The eight current r3 retry failures remain open in the report: `phase1-people-access-browser`, `phase3-board-browser`, `phase4-recovery-persisted`, `phase4-discussions-recovery-browser`, `phase5-views-calendar-links-browser`, `phase6-notifications-browser`, `shared-voice-browser` and `phase9-gemini-relay-browser`. Ongoing repairs or external patches must be revalidated against the frozen successor and must not be silently counted as passes.
- The external staff repaint patch is sealed at `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\staff-repaint-fix\staff-repaint-fix.patch` (SHA-256 `3d900fd58aa37d1d36453d20557a6396db2b66fe136d0a15c64539bc341ef00e`). It has not been applied to this candidate and does not change the totals above.

### Release, rollback and evidence boundaries

- The user owns production release approval. Main/coordinator prepares and audits the final gate, exact candidate SHA, declared source paths, runtime configuration, routes, secret names, target inventory and any later execution window. This addendum grants none of those actions.
- Before any future release, retain raw candidate-generated reports and external copies, verify the settled successor and planned patch hashes, rerun pending journey/supplement/retry scope as applicable, and separately review native evidence. No historical report may be overwritten.
- Any rollback must follow the reviewed feature-admission and durable-record procedure in the historical plan: stop new effects, preserve drafts/receipts/usage obligations and restore the verified prior revision. No production rollback or data mutation occurred here.

### Evidence references and hashes

- Candidate canonical r2 report: `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI\work\final-acceptance\projects-final-d34accb-20260908-r2\canonical\report.json` (SHA-256 `b964256988c2459dc70382852d6bef0f19fd3ab5b54483eda326bc8f7b9ae88b`).
- Candidate exact retry r3 report: `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI\work\final-acceptance\projects-final-d4b5441-20260908-r3\retry\report.json` (SHA-256 `b5a8d886ef48b647af000021e0515dce4d7444607570fda3fb9957dd8b1aa3bf`).
- Candidate strict performance report: `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI\test-results\crm-projects\phase10-performance-browser\report.json` (SHA-256 `94d390e24d2d7329ac1296fe5c0e2d9307eee741fc3506c3f57efe2ed9efd989`).
- External preserved retry inventory: `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\r2-failure-inventory.json` (SHA-256 `d10c134a04b7e6f83746c1567cef5de869e5eb61960f864e59cce32e003c44`).
- External fixed retry manifest: `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\retry-manifest.json` (SHA-256 `f4b560dc27fa43c0c0406f318dab1dae966e05ee79a98b7835c7812afbd3985d`).
- External final patch checkpoint used for execution authority: `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\final-review-checkpoint.json` (SHA-256 `8eca65988f8f1aa7b0b4ef39675e927cfc5c7ed10b2358ff327e0c3997c6426f`). The historical `root-release-checkpoint.json` remains immutable and is not treated as final execution authority.
- External acceptance plan: `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\acceptance-plan.md` (SHA-256 `7261376fdac85c75056e63791f74adbd812d9ed39a6a37346c780ad42bf627f4`).
- External native latency protocol: `C:\Users\Admin\Documents\Codex\2026-09-08\crm-projects-recovery\work\final-acceptance-package\latency\README.md` (SHA-256 `3d71bdb6568033991836a1427f16adab040d39cbcfe870f08445e86abc9c34d7`).
- Candidate native engineering decision: `C:\Users\Admin\.codex\worktrees\crm-projects-integration-candidate-20260908b\Cursor AI\docs\plans\2026-09-07-crm-projects\native-runtime-decision.md` (SHA-256 `657685523a5daa1b9bf8f23a7fc15faa4686e3668b6383f215e16054d3e7fe26`).
