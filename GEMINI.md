# Master Conductor File

> **Source of Truth for Agent Context**

## Context Reference

- [Tech Stack](./conductor/tech-stack.md)
- [Product Context](./conductor/product.md)
- [Project Configuration](./conductor/project.md)

## Active State

- **Status**: Active Development
- **Phase**: Release V1.8.7

## Instructions

This file guides the agent's understanding of the project structure and context.

## AI Task Tracking (CRITICAL)

- **Continuous Tracking Rule**: You MUST automatically check and update a `TASK_TRACKER.csv` file located in the **root directory of the current active workspace**.
- **When to update**: Only update the CSV when a task is **created** and when it is **completed**. Do NOT update the CSV at each stage of working, or when it's edited/fixed, unless the user explicitly types `#update`.
- **Starting a task**: Read the CSV in the current workspace, append a new line with the incremented Task No., current Created Date, a concise Task Description (avoiding commas), and set Current Status to 'In Progress'. Format: `TaskNo,CreatedDate,Description,Status,DoneDate`
- **Completing a task**: Update the existing row's Current Status to 'Done' and set the Done Date in the CSV.
- **Explicit updates (#update)**: If the user types `#update`, you must update the Current Status with a brief summary of the active step.
- **Automation**: DO NOT wait for the user to remind you. This is an automatic required step before and after executing work.

### Task Tracking Integrity Rules (MANDATORY)

1. **Never mark Done without proof**: A task can ONLY be marked as 'Done' AFTER empirical verification that the work is complete. If a session ends before verification, the task MUST remain 'In Progress'. Ending a conversation is NOT sufficient grounds to mark a task Done.
2. **Stale task audit on session start**: When reading TASK_TRACKER.csv at the beginning of a session, check for any 'In Progress' tasks. If found, verify whether they were completed in a previous session by checking conversation artifacts (task.md/walkthrough.md). Update accordingly.
3. **Edit in place — never rewrite the full file**: When updating a single row (e.g., marking Done), use targeted line edits (replace_file_content on the specific row). Do NOT read the entire CSV and write it back — this causes duplicate rows. This also applies when appending: target the last line or trailing newline and replace it with the new row + trailing newline. NEVER use write_to_file with Overwrite for this file.
4. **One task per deliverable**: If a task spans multiple conversations, the LAST conversation to complete the work is responsible for marking it Done. Do not create duplicate task entries for the same deliverable.
5. **Calculate TaskNo by scanning ALL rows**: When appending a new task, find the maximum TaskNo across the entire file — do NOT just read the last line. Out-of-order or deleted rows can cause duplicates if you only check the bottom.
6. **Preserve line endings**: Match the existing file's line ending style (`\r\n` on Windows). Mixed line endings cause git to flag every line as changed and make targeted edits unreliable.
7. **Verify after editing**: After any edit to TASK_TRACKER.csv, re-read the affected lines to confirm: (a) no duplicate TaskNos exist, (b) no duplicate rows were introduced, (c) the row count has not unexpectedly increased.

## GSD Auto-Integration (MANDATORY)

Every task MUST follow the GSD (Get Stuff Done) methodology automatically. This is not optional.

### Step 1: Classify the Task

When a new task is created, immediately classify it:

| Type | Examples | GSD Flow |
|------|----------|----------|
| **Quick Fix** | Bug fix, typo, config change, simple edit | Execute → Verify → Done |
| **Feature** | New functionality, UI change, new endpoint, new page | Plan → Execute → Verify → Done |
| **Investigation** | Debugging, research, performance issue, unknown cause | Research → Diagnose → Fix → Verify → Done |

### Step 2: Run the GSD Flow

**Quick Fix:**

1. Execute the fix directly
2. Verify empirically (run the app, check output, confirm the fix)
3. Mark done

**Feature (MUST plan before coding):**

1. **CEO Review** (medium+ features only) — Auto-run `/ceo-review` to challenge the premise and find the 10-star version. Skip for small features or when user says "just build it".
2. **Plan** — State what files will change, what the deliverable is, and what success looks like (2-3 sentences minimum)
3. **Execute** — Implement with atomic commits per logical unit
4. **Diff-QA** (if UI changes) — Auto-suggest `/diff-qa` to verify affected pages in browser
5. **Verify** — Run the app, test the feature, confirm it works. Screenshot or terminal proof preferred
6. Mark done
7. **Ship** (optional) — Run `/ship` to automate version bump, changelog, and push

**Investigation:**

1. **Research** — Reproduce the issue, gather evidence, read logs/errors
2. **Diagnose** — Identify root cause with evidence
3. **Fix** — Apply targeted fix
4. **Verify** — Confirm the issue is resolved with proof
5. Mark done

### GSD Core Rules (Always Enforced)

- 🔒 **No code without a plan** — For Features, state the plan before writing any code. Even a 2-line inline plan counts.
- ✅ **Empirical verification required** — Never claim "done" without running verification. No "it should work" — prove it works.
- 🧹 **Context hygiene** — After 3 failed debugging attempts on the same issue, stop → document what was tried → recommend a fresh approach or session.
- 💾 **State tracking** — Always update TASK_TRACKER.csv at task creation and completion.
- 🔄 **Atomic commits** — Each logical change gets its own commit with a descriptive message.

### Full GSD Mode (Optional)

For large multi-phase projects, the user can invoke the full GSD workflow explicitly:

- `/map` → Analyze codebase and create ARCHITECTURE.md
- `/plan N` → Decompose phase N into executable plans
- `/execute N` → Wave-based execution of phase plans
- `/verify N` → Validate against spec with empirical evidence

These full workflows use the `.gsd/` directory structure. The auto-integration above is the lightweight version that applies on every task.

### GStack-Inspired Workflows (Auto-Integrated)

These workflows add product thinking, automated QA, and release automation:

| Command | When | Description |
|---------|------|-------------|
| `/ceo-review` | **Auto** for medium+ features | Challenge the premise. Find the 10-star product. Gate planning with product vision. |
| `/diff-qa` | **Suggest** after UI changes | Analyze git diff → identify affected routes → run targeted browser tests → health score. |
| `/ship` | **Manual** when ready to release | Sync main → run tests → version bump → changelog → push. One command, zero friction. |

**Auto-trigger rules:**

- 🎯 `/ceo-review` triggers automatically when a Feature task is medium+ (new page/mode/flow, 3+ files, new user behavior). User can skip with "just build it".
- 🧪 `/diff-qa` is suggested after any HTML/CSS/JS UI changes. User can skip with "skip qa".
- 🚀 `/ship` is always manual — invoke when implementation and verification are complete.

## Triggers & Protocols

- **#council**: When the user types `#council [query]`:
  1. Write the relevant conversation context (chat history, prior analysis, key decisions) to a temp file at `/tmp/council_context.txt`.
  2. Run `node scripts/summon_council.js "[query]" --context /tmp/council_context.txt --out council_latest.txt`.
  3. Read `council_latest.txt` and present the full council output.
  The `--context` flag injects the temp file's contents as inline context so council personas can analyze the conversation. The script auto-saves to a timestamped file if `--out` is omitted, but always use `--out` for a predictable filename.
- **#hproto**: When the user types `#hproto`, immediately initiate the [Harness Engineering Protocol](.agent/workflows/harness-protocol.md) and guide the user through the Spec -> Plan -> Execute -> Verify loop.

## Response Formatting

- **Timestamp Rule**: ALWAYS include the Start time and End time of every response, on two separate lines at the end. Format:
  - `⏱️ Start: [Vietnam Time]`
  - `⏱️ End: [Vietnam Time]`

## Versioning & Commits

- **Versioning Rule**: ALWAYS name commits and pushes with explicit version tags.
- **Changelog Rule**: ALWAYS add a changelog summarizing all updates before pushing.
- **Next Version**: `V1.8.8`
- **SemVer Protocol**:
  - **Minor Push (Bug fixes, small edits)**: Increment the LAST digit (e.g., `1.0.0` -> `1.0.1`).
  - **Major Push (New functions, big updates)**: Increment the MIDDLE digit (e.g., `1.0.0` -> `1.1.0`).
  - **Breaking Change**: Increment the FIRST digit (e.g., `1.0.0` -> `2.0.0`).
