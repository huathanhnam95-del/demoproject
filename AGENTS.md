# Local Agent Notes

## Response Timestamps

- In every final response to the user, include both `Start time` and `End time`.
- Use a human-readable Vietnam Time format (e.g., `Wednesday, May 20, 2026, 05:23:10 AM`) instead of ISO 8601 string representation.
- Apply this as a default workspace behavior for all tasks unless a higher-priority instruction overrides it.

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
- **E2E Testing**: Add automated E2E browser tests in `tests/browser/` that verify the full user flow, ensuring `sessionStorage` mock is applied to bypass the onboarding welcome modal when necessary.

## Deployment Rule

- **Do not automatically push to production**: Only push/deploy to production when the user explicitly asks you to. Do not perform automated pushes to the remote repository.

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

- **Light route**: default when the user does not select a route. Work directly, load only relevant context, and do not spawn subagents.
- **Medium route**: selected only when the user asks for it. Enter deployment state, read and follow `agent_docs/workflow/medium_route.md`, and perform the work directly without subagents.
- **Heavy route**: selected only when the user asks for it. Enter deployment state, read and follow `agent_docs/workflow/heavy_route.md`, and coordinate the installed specialist subagents.
- Keep the selected route for the session until the user switches it or ends the session. Do not infer Medium or Heavy automatically.

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
