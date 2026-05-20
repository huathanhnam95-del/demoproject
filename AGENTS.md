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

## Developing New Practice Modes

When implementing a new practice mode (e.g., in PTE Practice or English Practice), always complete the following checklist:
- **Routing & Tabs**: Register the new mode button inside the tab headers in `public/index.html` (e.g., `<button id="tab-[mode]" class="tab-btn" type="button" ...>`).
- **Dashboard Visibility**: Add the static visual card for the mode in the dashboard grid under `#panel-tutorials .tutorial-grid` inside `public/index.html`. Ensure `data-practice-skill` matches the skill category (e.g., `reading`, `listening`, `speaking`, `writing`) and `id="mode-btn-[mode]"` matches the mode ID.
- **Launcher Meta**: Configure the mode metadata in the `PRACTICE_LAUNCHER` object in `public/script.js` under both `skills.[category].modeIds` and `modes.[mode]`.
- **E2E Testing**: Add automated E2E browser tests in `tests/browser/` that verify the full user flow, ensuring `sessionStorage` mock is applied to bypass the onboarding welcome modal when necessary.
