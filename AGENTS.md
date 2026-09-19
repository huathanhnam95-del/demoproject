# Local Agent Notes

## Repository structure authority

- `agent_docs/project_structure.md` is the single human authority for repository placement, ownership boundaries, dependency direction, generated-output contracts and evidence retention. `README.md` is navigation only; `scripts/structure/policy.json` is the machine-readable companion.
- Before coding, record an external task contract with the task ID, owner (or an explicit unresolved owner), create/modify/delete/rename paths, output destinations and classes, protected contracts, verification and exceptions. Keep the contract and before snapshot outside Git.
- At completion, compare the actual worktree/index delta with that declaration and run the focused structure checks. Do not use a blanket path or output declaration to hide newly discovered work.

## Response Timestamps

- In every final response to the user, include both `Start time` and `End time`.
- Use a human-readable Vietnam Time format (e.g., `Wednesday, May 20, 2026, 05:23:10 AM`) instead of ISO 8601 string representation.
- Apply this as a default workspace behavior for all tasks unless a higher-priority instruction overrides it.

## Session Tagging & Deployment Protocol (`(R)` & `(D)`)

- **Ready for Deployment (`(R)`) & R4D Trigger**: When the user says "R4D" (ready for deployment) in any chat session, mark the session name with prefix `(R) ` via `scripts/session_tagger.py mark-ready`.
- **Push All Readied (`PAR`) Trigger**: When the user requests "PAR" (push all readied), discover all readied sessions (`scripts/session_tagger.py list-ready`), execute the workspace deployment verification and push workflow, and batch transition all deployed sessions to `(D) ` via `scripts/session_tagger.py mark-deployed --cid <cid>` or `scripts/session_tagger.py trace-deployed`.
- **Active Development Rule**: Active development sessions (planning, bug fixes, feature work, code edits, audits, test runs) **MUST NEVER** retain the `(D) ` prefix in their title.
- **Resume/new-task removal**: When a tagged `(D) ` session is resumed or a task starts, immediately remove the prefix through the supported task-title API after verifying the task and title identity. Codex must never run the no-ID Antigravity `scripts/session_tagger.py` helper or pass a Codex UUID to it. Antigravity may use that helper only with an explicit, verified Antigravity CID; do not infer a CID from the latest database row.
- **Deployment tagging**: After an approved production deployment, mark the session `(D) ` through the supported task-title API for Codex after verifying task/title identity. Antigravity uses its helper only with an explicit verified CID.
- **Batch Deployment Back-Tracing**: When an approved production deployment integrates work from multiple preceding chat sessions or development tracks (e.g. multi-task releases), trace back to each origin session that produced those changes (using `TASK_TRACKER.csv`, git commit log, or session search) and tag each origin session with `(D) ` via `scripts/session_tagger.py mark-deployed --cid <cid>` (or `mark-batch` / `trace-deployed`), in addition to marking the deploying session itself.

## Browser Testing Credentials

- For any browser testing plan or browser test execution that requires login, first read `C:\Cursor AI\.local\browser-test-credentials.md`.
- Use the admin account documented there unless the user explicitly says to use a different account.
- In plans, refer to that file path directly instead of inlining credentials.
- Treat that file as local-only secret material. Do not copy its contents into tracked files, commits, or audit docs unless the user explicitly asks for that.

## Browser Workflow

- For browser checks in this workspace, start with the local Playwright-based `webapp-testing` workflow for app verification and UI flows.
- Whenever writing a browser testing plan in this workspace, write the plan for Chrome only. Do not include test coverage for other browsers unless the user explicitly asks for them.
- After the Playwright pass, use the Antigravity `browser-agent` workflow as a second step when you want live browser confirmation, richer artifact capture, or an interactive repro.
- When a task needs browser automation and login, combine both steps with `C:\Cursor AI\.local\browser-test-credentials.md`.

## Council Workflow

- When the user includes `#council` in a request, invoke `node scripts/summon_council.js "<request without #council>" [relevant file_paths...]`.
- Treat the rest of the user request as the council prompt, and include any files under discussion as context arguments so the council can ground its analysis in evidence.
- Unless a specific output path is needed, allow the script to write its default timestamped `council_output_*.txt` file and matching `.telemetry.json` file in the repo root.
- Use the council output as advisory support for the task, then continue with a concise synthesis and the next implementation or review step.

## Kokoro TTS Local Engine

- **Location & Port**: `C:\Cursor AI\Kokoro-FastAPI`, runs on `http://127.0.0.1:8880`.
- **Startup**: Run `.\Kokoro-FastAPI\start-cpu.ps1` (or `.\Kokoro-FastAPI\start-gpu.ps1`), or start automatically via `scripts/kokoro/generate_speech_coach_audio.js`.
- **Environment**: Python virtualenv at `Kokoro-FastAPI/.venv` (Python 3.11/3.12 managed via `uv sync`).
- **Dependencies & Espeak**: Uses bundled `espeakng_loader` in `.venv/Lib/site-packages/espeakng_loader` with `PHONEMIZER_ESPEAK_LIBRARY` and `ESPEAK_DATA_PATH`.
- **Models & Voices**: Weights are in `Kokoro-FastAPI/api/src/models/v1_0/kokoro-v1_0.pth` (backed up in HuggingFace cache) and 68 voice profiles in `Kokoro-FastAPI/api/src/voices/v1_0/`.

## Developing New Practice Modes

When implementing a new practice mode (e.g., in PTE Practice or English Practice), always complete the following checklist:
- **Routing & Tabs**: Register the new mode button inside the tab headers in `public/index.html` (e.g., `<button id="tab-[mode]" class="tab-btn" type="button" ...>`).
- **Dashboard Visibility**: Add the static visual card for the mode in the dashboard grid under `#panel-tutorials .tutorial-grid` inside `public/index.html`. Ensure `data-practice-skill` matches the skill category (e.g., `reading`, `listening`, `speaking`, `writing`) and `id="mode-btn-[mode]"` matches the mode ID.
- **Launcher Meta**: Configure the mode metadata in the `PRACTICE_LAUNCHER` object in `public/script.js` under both `skills.[category].modeIds` and `modes.[mode]`.
- **Audio DSP Enhancement Pipeline**: For any practice mode that records student audio (speaking, repetition, voice submissions), ALWAYS route recorded audio through `window.AudioDspPipeline.enhance(blob)` (or instantiate `window.AudioDspPipeline.createRecorder()`). This applies standard 80Hz rumble removal, 16kHz sinc-resampling, -3dBFS peak normalization, and silence trimming so that audio playback is crystal-clear and scoring accuracy is maximized across all devices.
- **E2E Testing**: Add automated E2E browser tests in `tests/browser/` that verify the full user flow, ensuring `sessionStorage` mock is applied to bypass the onboarding welcome modal when necessary.

## Pronunciation and Text Comparison Convention (MANDATORY)

- For any feature or practice mode that requires pronunciation and text comparison (such as Entrance Test, Read Aloud, Repeat Sentence, or any new speaking mode where students speak against reference text):
  - **Acoustic Forced Alignment**: Always use forced-alignment pronunciation assessment (Azure Speech `Dimension: 'Comprehensive'`, `Granularity: 'Phoneme'`, aligned against `expectedText`).
  - **Dual-Metric Semantic Separation**: Decouple whole-word communicative intelligibility (`accuracyScore: 0-100`) from narrow-band acoustic syllable precision (`syllables: [...]`).
  - **Syllable-Level Breakdown & Coaching**: Render interactive tokens with color-coded states (Green $\ge 80$, Amber $60-79$, Red $< 60$), floating tooltips displaying syllable chips with millisecond boundaries for isolated audio playback, spoken candidate phoneme diagnoses (`heardIpa`), and natural articulatory physical coaching tips.
  - **Oxford American IPA**: Strictly standardize all phonetics via `Phonetics.normalizeIPA()` (converting turned `ɹ -> r`, `/ɚ/ -> /ər/`, `/ɝ/ -> /ɜːr/`, `/ɛ/ -> /e/`, stripping tie bars and diacritics).
  - **Future Feature Mandate**: Always use this convention or explicitly ask the user for permission before using any alternative approach for pronunciation and text comparison.

## Deployment Rule

- **Remote Git Synchronization on Production Deployment**: Whenever deploying to production (or executing an approved production release / PAR), ALWAYS push the committed changes to the remote Git repository (`git push origin <branch>`) in addition to deploying the hosting assets. Never leave production releases unpushed to Git. Outside of an explicit deployment/release instruction, do not perform unprompted pushes to production branches.
- **Production Deployment Session Naming (`(D)`)**: After an approved production deployment, Codex uses the supported task-title API with verified task/title identity to mark the session. Antigravity uses its helper only with an explicit verified CID.

## Implementation Plan Approval Rule

- **Do not auto-proceed with implementation plan**:
  1. Whenever creating or updating `implementation_plan.md`, set `RequestFeedback: true` in `ArtifactMetadata`.
  2. Modifying `implementation_plan.md` **MUST BE THE ONLY AND LAST TOOL CALL IN YOUR RESPONSE TURN**.
  3. You are **EXPLICITLY FORBIDDEN** from combining `implementation_plan.md` edits with any subsequent tool calls (such as `invoke_subagent`, `run_command`, code edits, etc.) in the same response turn.
  4. After writing `implementation_plan.md`, you MUST **STOP calling tools immediately** and yield control to the user. Do not launch subagents, edit files, or execute commands until the user explicitly approves the plan.

## UI Design Rules

- **Avoid Nested Card Structures ("Boxes in Boxes")**: When designing or styling UI layouts, avoid wrapping components in multiple layers of cards or nested container boxes. Layout elements should flow naturally on the parent `.container` background, minimizing borders, shadows, and backdrop-filters on intermediate layout cards. Set horizontal paddings on intermediate elements to 0 where necessary to align with the main container boundaries.

## Codex Workflow Routes

The project uses three explicit Codex workflow routes. Existing project-specific rules in this file, especially deployment restrictions, browser requirements, and the implementation-plan approval gate, take precedence over generic route guidance.

### Core workflow principles

- Keep modules focused, interfaces clear, coupling intentional, and changes easy to test, debug, replace, extend, and reuse.
- Define acceptance and verification requirements proportionately before implementation.
- Keep related tests cohesive without weakening assertions, hiding failures, or reducing meaningful coverage to save tokens.
- Preserve unrelated user work and never let route automation broaden the user's requested scope.

### Working states

- `leaf state`: small changes, document work, investigation, and general questions outside a durable implementation plan.
- `deployment state`: planning or executing a broad, durable, potentially multi-session package.

### Route selection

- **GPT/Codex Auto-Boost exclusion**: Auto-Boost is Gemini-only and does not apply to any GPT/Codex session in this workspace. GPT/Codex follows the Light/Medium/Heavy routes below.
- **Light route**: default whenever the user does not select a route. Work directly, load only relevant context, and do not spawn subagents.
- **Medium route**: selected only when the user asks for it. Enter deployment state, read and follow `agent_docs/workflow/medium_route.md`, and perform the work directly without subagents.
- **Heavy route**: selected only when the user asks for it. Enter deployment state, read and follow `agent_docs/workflow/heavy_route.md`, and coordinate the installed specialist subagents.
- Keep the selected route for the session until the user switches it or ends the session. Do not infer Medium or Heavy automatically.

### Current STR-01 routing

- The coordinator may use Astra medium for the independent review and Luna xhigh for the bounded implementation worker for this STR-01 package. This is task-specific routing and does not change the default model or route for unrelated work.

### Project documentation framework

Workflow documentation lives under `agent_docs/`:

- `project_overview.md`: goals, architecture, workflows, and major decisions.
- `project_core_tech.md`: concise notes on specialized technologies and architecture.
- `project_structure.md`: directory layout, components, modules, and ownership boundaries.
- `project_progress.md`: active durable plan and cross-session execution status.
- `project_diary.md`: durable decisions, rejected approaches, and lessons.
- `latest_session_work.md`: the latest cross-session handoff and unfinished work.

Only the main agent may edit `project_progress.md` and `latest_session_work.md`. Edit them only in deployment state or when the user explicitly requests it. Record verified facts, not temporary reasoning or raw logs. Never delete a main project document without warning the user and receiving a second explicit confirmation.

On first entering deployment state, load `project_overview.md`, `project_structure.md`, `project_progress.md`, and `latest_session_work.md` in one bounded read-only batch. Interpret overview and structure before reconciling progress and handoff state, then inspect only the smallest relevant source and test surface.

### Tool batching

Within each bounded stage, batch independent, already-known, non-conflicting read-only operations when practical. Use partial-failure-safe batching when useful results remain valid after another operation fails. Keep dependent investigation, approvals, overlapping writes, Git mutations, agent lifecycle operations, and checks sharing mutable resources sequential.


## Reusable model workflow — user approved September 7, 2026

This model policy supersedes conflicting reusable model-routing rules; preserve project-specific scope, approval and verification requirements.

- Default to Astra Medium for planning/orchestration and substantial implementation. Use Luna X High for the most basic tightly specified tasks and Astra Low for somewhat harder bounded coding. Terra is not a standard tier; no Sol subagents.
- After one or two meaningful unsuccessful attempts at the same roadblock, root diagnoses actual reproduction, failure evidence and changes. Choose scoped Astra High or X High as warranted, including direct escalation for interacting causes, architecture, persistent ambiguity or a known critical problem. Return to the normal task tier when resolved; do not repeat an unchanged approach or require a mandatory ladder.
- At the beginning of each NEW project, present the proposed model/reasoning lineup and obtain user confirmation before implementation. The current CRM Projects lineup and escalation discretion are already approved; do not reopen that approval.
- Use explicit supported model/effort assignments with fork_turns="none", self-contained contexts, no nested agents, exclusive file ownership and one shared emulator/test owner. Fixed-Luna roles cannot stand in for an Astra worker. Preserve in-flight edits and require safe ownership release before reassignment. Keep verification proportionate and evidence-based.
- Speed is separate: Standard by default; Fast only upon explicit user request, never inferred from difficulty, urgency, model or escalation. Current CRM Projects Fast opt-in applies only to that ongoing implementation. Do not propagate it to global defaults or unrelated/new tasks. Configuration defaults are not proof of active request settings.

### Planning and discussion escalation clarification

Planning, design and discussion escalation: When the problem is difficult, ambiguous or remains unresolved after one or two meaningful attempts, explain the unresolved issue to the user and recommend Astra High or X High according to the problem. A known difficult problem can justify an immediate recommendation; do not repeat an unchanged approach at Medium or require a rigid escalation sequence. For the user-facing conversation, recommend the upgrade instead of silently switching its model or reasoning. This recommendation rule is distinct from already-authorized bounded implementation-agent escalation and does not reopen that authorization. Return to the normal tier after resolution. Medium remains the ordinary planning default. Fast remains a separate explicit opt-in; reasoning escalation never implies Fast permission.
