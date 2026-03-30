# Local Agent Notes

## Browser Testing Credentials

- For any browser testing plan or browser test execution that requires login, first read `C:\Cursor AI\.local\browser-test-credentials.md`.
- Use the admin account documented there unless the user explicitly says to use a different account.
- In plans, refer to that file path directly instead of inlining credentials.
- Treat that file as local-only secret material. Do not copy its contents into tracked files, commits, or audit docs unless the user explicitly asks for that.

## Council Workflow

- When the user includes `#council` in a request, invoke `node scripts/summon_council.js "<request without #council>" [relevant file_paths...]`.
- Treat the rest of the user request as the council prompt, and include any files under discussion as context arguments so the council can ground its analysis in evidence.
- Unless a specific output path is needed, allow the script to write its default timestamped `council_output_*.txt` file and matching `.telemetry.json` file in the repo root.
- Use the council output as advisory support for the task, then continue with a concise synthesis and the next implementation or review step.
