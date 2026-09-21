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

# Master Claude Rules & Context

> **Combined Source of Truth imported from Gemini / Antigravity and Codex**

## Response Timestamps
- In every final response to the user, include both `Start time` and `End time`.
- Use a human-readable Vietnam Time format (e.g., `Wednesday, May 20, 2026, 05:23:10 AM`) instead of ISO 8601 string representation.

## Browser Testing Credentials & Workflow
- For any browser testing plan or browser test execution that requires login, read `C:\Cursor AI\.local\browser-test-credentials.md`.
- Playwright-based testing is the primary browser verification pass for Chrome.
- Chrome is the default and mandatory browser for all test plans.

## Task Tracking & Verification (MANDATORY)
- Continuous Tracking: Automatically check and update `TASK_TRACKER.csv` in the root workspace.
- Starting a task: Append `TaskNo,CreatedDate,Description,Status,DoneDate` with status 'In Progress'.
- Completing a task: Update status to 'Done' and set Done Date.
- Targeted line edits — never rewrite full CSV file.
- Empirical Verification required: Never mark Done without proof.

## GSD Auto-Integration Protocol
- **Quick Fix**: Execute -> Verify -> Done
- **Feature**: Plan -> Pause for Approval -> Execute -> Verify -> Done
- **Investigation**: Research -> Diagnose -> Fix -> Verify -> Done

## UI Design Rules
- **Avoid Nested Card Structures ("Boxes in Boxes")**: Avoid wrapping components in multiple layers of cards or nested container boxes. Layout elements should flow naturally on the parent `.container` background.

## Council Workflow
- When user includes `#council`, execute `node scripts/summon_council.js "<request>"`.

## Deployment Rules
- **Remote Git Synchronization on Production Deployment**: Whenever deploying to production (or executing an approved production release / PAR), ALWAYS push the committed changes to the remote Git repository (`git push origin <branch>`) in addition to deploying the hosting assets. Never leave production releases unpushed to Git. Outside of an explicit deployment/release instruction, do not perform unprompted pushes to production branches.


--- 
### Modular Rule: context7.md
---
trigger: always_on
---

Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.


--- 
### Modular Rule: logicware.md
---
trigger: always_on
---

# Antigravity Logicware: Agent Context

**Role**: You are a Cognitive Architect designing AI agent workflows.

## Project Overview

This repository contains "Logicware"—pure Python implementations of advanced reasoning protocols. Unlike standard tools (which do things), these modules help agents *think*.

## Key Modules

### 1. Sequential Thinking (`sequential_thinking.py`)

**Purpose**: To slow down execution and force planning.
**Usage**:
Use `execute()` to log a thought. The output is a formatted string that serves as a "scratchpad" for the LLM's context window.

### 2. MRL Indexer (`k3_mrl_indexer.py`)

**Purpose**: Efficient semantic memory.
**Configuration**:

* `DEFAULT_MODEL`: text-embedding-004
* `BATCH_SIZE`: 5
**Key Methods**:
* `run_indexing(limit=N)`: Scans folder and builds `.pkl` index.
* `search(query, top_k=5)`: Returns ranked snippets.

### 3. Tournament Logic (`tournament_logic.py`)

**Purpose**: Conflict resolution.
**Logic**: Implement a voting or scoring mechanism where a neutral "Judge" persona evaluates outputs from "Proposer" and "Critic" personas.

## Implementation Notes

* **Dependencies**: MRL requires `google-genai`. Sequential Thinking is pure Python (no deps).
* **State**: Thinking history is ephemeral (in-memory). MRL index is persistent (disk).


---
### Codex Base Rules
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", "Set-Location -Path \"c:\\Cursor AI\"; rg -n \"#hproto|\\bhproto\\b\" -S ."], decision="allow")
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", "Set-Location -Path \"c:\\Cursor AI\"; Get-Content GEMINI.md -TotalCount 120"], decision="allow")
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", "Set-Location -Path \"c:\\Cursor AI\"; Get-Content .agent/workflows/harness-protocol.md -TotalCount 240"], decision="allow")
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", "Set-Location -Path \"c:\\Cursor AI\"; if (Test-Path docs/specs) { Get-ChildItem docs/specs -Force | Sort-Object Name | Format-Table -AutoSize Name,Length,LastWriteTime } else { \"docs/specs not found\" }"], decision="allow")
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", "Set-Location -Path \"c:\\Cursor AI\"; if (Test-Path docs/specs/features) { Get-ChildItem docs/specs/features -Recurse -Force | Sort-Object FullName | Format-Table -AutoSize FullName,Length } else { \"docs/specs/features not found\" }"], decision="allow")
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", "Set-Location -Path \"c:\\Cursor AI\"; Get-Content docs/specs/features/rpg-progression-and-economy.md -TotalCount 240"], decision="allow")
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", "Set-Location -Path \"c:\\Cursor AI\"; Get-Content docs/specs/features/vocabulary-book.md -TotalCount 260"], decision="allow")
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", "Set-Location -Path \"c:\\Cursor AI\"; rg -n \"Your Journey|shop-modal|Skill Tree|dashboard-segmented-control\" public/index.html public/shop-module.js public/style.css"], decision="allow")
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", "Set-Location -Path \"c:\\Cursor AI\"; $start=2290; $count=160; $i=0; Get-Content public/index.html | Select-Object -Skip ($start-1) -First $count | ForEach-Object { \"{0,5}: {1}\" -f ($start+$i++), $_ }"], decision="allow")
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", "Set-Location -Path \"c:\\Cursor AI\"; rg -n \"Length Filter|Difficulty Filter|Vocab Book|Survival\" public/shop-module.js"], decision="allow")
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", "Set-Location -Path \"c:\\Cursor AI\"; $start=1; $count=140; $i=0; Get-Content public/shop-module.js | Select-Object -Skip ($start-1) -First $count | ForEach-Object { \"{0,5}: {1}\" -f ($start+$i++), $_ }"], decision="allow")
prefix_rule(pattern=["C:\\Windows\\System32\\WindowsPowerSh
... (truncated for brevity)
