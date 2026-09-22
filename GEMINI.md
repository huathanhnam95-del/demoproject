<!-- BEGIN PAR COMMAND ENTRYPOINT -->
## Automatic readiness and PAR

Before completing deployable work, evaluating R4D, or executing PAR, read the [release protocol](.agent/rules/session_tagging.md). Automatically record and mark verified ready tasks (R). PAR explicitly authorizes discovery, safe integration, verification, commit, push, deployment, and live checks for the current project's eligible batch; no repeated stage approvals are needed. Mark (D) only after all intended surfaces are verified live. Invalidate readiness when new work starts. Use verified native task IDs and shared readiness records; never guess a session or use another host's title helper. Existing safety and deployment gates still apply.
<!-- END PAR COMMAND ENTRYPOINT -->

<!-- BEGIN WORKSPACE PARALLEL WORK SAFETY -->
## Required safety policy for every agent

Read the complete policy in [parallel-work-safety.md](.agent/rules/parallel-work-safety.md) before writing, handing off, integrating, publishing, migrating data, or retiring work. It applies to every agent host and model in this workspace and supplements the account-wide policy.

Apply its ownership and preservation requirements to all workflows below: use one integration owner for the current destination, assign one writer per shared file/resource, preserve existing content and unowned dirty work, and record the exact changes and checks before integration. A shared tracker or release workflow does not permit competing writers or bypass that review. Integrate sequentially and verify both tasks' behavior; keep deployment and live-data changes within their authorized scope. Existing sessions must reread this policy before their next affected action. These instructions do not install or prove automated Git enforcement.
<!-- END WORKSPACE PARALLEL WORK SAFETY -->

<!-- BEGIN SHARED CURATED SKILLS -->
## Shared curated skills across agent applications

- This Windows account shares the curated skill methods across Codex, Claude and Gemini hosts. Each host has complete native skill packages; use its supplied catalog and read the selected native SKILL.md before applying it.
- Resolve references, scripts and assets from that native package. Normal skill use does not require cross-host filesystem access. The optional maintenance catalog is `C:/Users/Admin/.agents/shared-skills.md`; if it is outside the host's permitted scope, the native packages remain sufficient.
- For the catalogued skills, prefer the curated generic recipe over an older duplicate or cached skill body. Preserve explicit project domain rules, brand conventions, ownership, approval gates and release controls.
- Load only skills that materially help the task. No universal skill interview, startup banner or 1% relevance threshold is required by this integration.
- Sharing skills does not switch the host, model, reasoning, speed, delegation route or provider. Codex-only APIs and routing rules remain Codex-only; existing host-specific policies remain in force where applicable.
- When an account-wide skill update is authorized, reconcile the native copies listed in the maintenance catalog with the curated source and preserve backups; do not auto-update them during unrelated tasks.
<!-- END SHARED CURATED SKILLS -->

# Master Conductor File

> **Source of Truth for Agent Context**

## Context Reference

- [Tech Stack](./conductor/tech-stack.md)
- [Product Context](./conductor/product.md)
- [Project Configuration](./conductor/project.md)

## Active State

- **Status**: Active Development
- **Phase**: Release V2.0.15

## Instructions

This file guides the agent's understanding of the project structure and context.

## AI Task Tracking (CRITICAL)

- **Continuous Tracking Rule**: You MUST automatically check and update a `TASK_TRACKER.csv` file located in the **root directory of the current active workspace**.
- **Session Tag Hygiene (MANDATORY)**: Follow [.agent/rules/session_tagging.md](.agent/rules/session_tagging.md). Remove stale `(R)`/`(D)` markers before new implementation using a verified native task identity; never guess a session or invoke a no-ID helper.
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
8. **Invalidate stale readiness on new implementation**: Follow the release protocol's verified-identity title and readiness-record updates; never choose the latest database row as the active session.

## GSD Auto-Integration (MANDATORY)

Every task MUST follow the GSD (Get Stuff Done) methodology automatically. This is not optional.

### Step 1: Classify the Task

When a new task is created, immediately classify it:

> [!IMPORTANT]
> **Active Session Title Check**: Before new implementation, invalidate stale `(R)`/`(D)` status through the release protocol. Use the current host's verified task identity.

| Type | Examples | GSD Flow |
|------|----------|----------|
| **Quick Fix** | Bug fix, typo, config change, simple edit | Execute → Verify → Done |
| **Feature** | New functionality, UI change, new endpoint, new page | Plan → Pause for Approval → Execute → Verify → Done |
| **Investigation** | Debugging, research, performance issue, unknown cause | Research → Diagnose → Fix → Verify → Done |
| **Complex Task (Auto-Boost)** | $\ge 3$ files, cross-layer architecture, concurrency, core engine/scoring, audio/ASR pipelines | **Auto-Boost Protocol**: Announce → Multi-Perspective Trade-Offs → Subagents → Isolated Verification |

### Step 2: Run the GSD Flow

**Quick Fix:**

1. Execute the fix directly
2. Verify empirically (run the app, check output, confirm the fix)
3. Mark done

**Feature (MUST plan before coding):**

1. **CEO Review** (medium+ features only) — Auto-run `/ceo-review` to challenge the premise and find the 10-star version. Skip for small features or when user says "just build it".
2. **Plan** — State what files will change, what the deliverable is, and what success looks like (2-3 sentences minimum), create/update `implementation_plan.md` with `RequestFeedback: true`, and **STOP tool execution immediately** to present the plan to the user.
3. **Wait for Approval** — Do NOT proceed to execution or code edits until the user explicitly approves the plan.
4. **Execute** — Implement with atomic commits per logical unit
5. **Diff-QA** (if UI changes) — Auto-suggest `/diff-qa` to verify affected pages in browser
6. **Verify** — Run the app, test the feature, confirm it works. Screenshot or term-proof preferred
7. Mark done
8. **Ship** (optional) — Run `/ship` to automate version bump, changelog, and push

**Investigation:**

1. **Research** — Reproduce the issue, gather evidence, read logs/errors
2. **Diagnose** — Identify root cause with evidence
3. **Fix** — Apply targeted fix
4. **Verify** — Confirm the issue is resolved with proof
5. Mark done

**Complex Task (Auto-Boost Flow - MANDATORY):**

1. **Auto-Announcement**: Immediately announce the trigger:
   `🚀 [Auto-Boost Activated]: Classified as Complex Task (<Trigger Reason>). Engaging multi-agent reasoning, architectural evaluation, and empirical verification pipeline.`
2. **Multi-Perspective Trade-Offs**: Propose and evaluate at least 2 viable architectural options with explicit pros/cons before touching code.
3. **Subagent Orchestration**: Proactively invoke specialist subagents (`invoke_subagent` with `DeepCoder`, `DeepInvestigator`, or `self`) for parallel research, deep verification, or isolated tasks.
4. **Plan & Gate**: Write `implementation_plan.md` with `RequestFeedback: true` and pause for approval before executing.
5. **Empirical Verification Gate**: Validate with concrete proof (browser automation or terminal test suites) before claiming completion.

### GSD Core Rules (Always Enforced)

- 🔒 **No code without a plan** — For Features, state the plan before writing any code. Even a 2-line inline plan counts.
- 🛑 **No auto-proceeding on plans** — After creating or updating `implementation_plan.md`, set `RequestFeedback: true` in `ArtifactMetadata`. Modifying `implementation_plan.md` MUST be the ONLY and LAST tool call in that turn. You are STRICTLY FORBIDDEN from generating subsequent tool calls (e.g., `invoke_subagent`, `run_command`, file edits) in the same turn. **STOP calling tools immediately** and wait for explicit user approval.
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
- **R4D**: Evaluate readiness using [.agent/rules/session_tagging.md](.agent/rules/session_tagging.md); apply `(R)` only after verification. Eligible tasks also mark themselves automatically without this command.
- **PAR**: Execute the complete current-project discovery, integration, verification, commit, push, deployment, and live-check sequence in [.agent/rules/session_tagging.md](.agent/rules/session_tagging.md). The command authorizes those normal release stages.
- **Auto-Boost Protocol**: Automatically activated on any **Complex Task** per [.agent/rules/auto_boost_protocol.md](.agent/rules/auto_boost_protocol.md). Automatically applies the deep reasoning, subagent orchestration, and empirical verification workflow of `/boost` without requiring manual `/boost` invocation.

## Response Formatting

- **Timestamp Rule**: ALWAYS include the Start time and End time of every response, on two separate lines at the end. Format:
  - `⏱️ Start: [Vietnam Time]`
  - `⏱️ End: [Vietnam Time]`

## Versioning & Commits

- **Versioning Rule**: ALWAYS name commits and pushes with explicit version tags.
- **Changelog Rule**: ALWAYS add a changelog summarizing all updates before pushing.
- **Next Version**: `V2.0.16`

- **Session Tagging Protocol (`(R)` & `(D)`)**: The single authority is [.agent/rules/session_tagging.md](.agent/rules/session_tagging.md). Ready tasks are automatically `(R)` with a verified shared readiness record. PAR discovers the eligible batch across supported hosts and registry records. Only complete, live-verified releases become `(D)`; failures and partial releases remain accurately recorded. All title mutations require verified native IDs.

- **SemVer Protocol**:
  - **Minor Push (Bug fixes, small edits)**: Increment the LAST digit (e.g., `1.0.0` -> `1.0.1`).
  - **Major Push (New functions, big updates)**: Increment the MIDDLE digit (e.g., `1.0.0` -> `1.1.0`).
  - **Breaking Change**: Increment the FIRST digit (e.g., `1.0.0` -> `2.0.0`).
