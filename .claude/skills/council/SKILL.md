---
name: council
description: Invoke the local war-room council workflow whenever the user includes `#council`, asks for a council review, wants architect/challenger/reviewer debate, or requests a multi-perspective grounded review of code, plans, bugs, or decisions. Do not simulate the council from memory when this applies. Run `C:\Cursor AI\scripts\summon_council.js`, pass the user's request without the `#council` tag, include relevant file paths as context, then use the council output to support the final response.
---

# Council

Use this skill when the user wants the local council workflow, especially when they write `#council`.

## Purpose

The council is a local evidence-grounded review pass backed by `C:\Cursor AI\scripts\summon_council.js`.
It runs three roles:

- Architect
- Challenger
- Reviewer

The council is support for the task, not the end result by itself. Run it, read the output, then continue the task with a concise synthesis and the next concrete step.

## Required workflow

1. Strip the `#council` token from the user request and keep the rest as the council prompt.
2. Identify the most relevant files for the request.
3. Run the council script from `C:\Cursor AI`:

```powershell
node scripts/summon_council.js "<prompt without #council>" [relevant file_paths...]
```

4. Let the script write its default timestamped output unless you need a custom `--out` path.
5. Read the generated `council_output_*.txt` file and use it as advisory input.
6. Continue with the actual task. Do not stop at "the council said X".

## File selection rules

- Include files directly mentioned by the user.
- Include files you inspected that materially affect the task.
- Keep the context focused. Prefer a small relevant set over broad dumps.
- If a required file does not exist, surface that clearly instead of pretending the council ran with it.

## Failure handling

- If the script fails because context files are missing, report the missing paths clearly.
- If the script fails because Vertex AI or environment variables are unavailable, say that the council could not be invoked and continue with normal reasoning only if the user still wants you to proceed.
- Do not claim "council-style review" as a substitute when the user explicitly requested `#council`. Either run the script or explain the exact blocker.

## Response pattern

After the council runs:

- Summarize the highest-signal findings briefly.
- Distinguish council findings from your own next action.
- Proceed with implementation, review, or debugging as requested.
