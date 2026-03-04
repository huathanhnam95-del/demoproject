# Master Conductor File

> **Source of Truth for Agent Context**

## Context Reference

- [Tech Stack](./conductor/tech-stack.md)
- [Product Context](./conductor/product.md)
- [Project Configuration](./conductor/project.md)

## Active State

- **Status**: Active Development
- **Phase**: Release V1.3.0

## Instructions

This file guides the agent's understanding of the project structure and context.

## AI Task Tracking (CRITICAL)

- **Continuous Tracking Rule**: You MUST automatically check and update a `TASK_TRACKER.csv` file located in the **root directory of the current active workspace**.
- **When to update**: Only update the CSV when a task is **created** and when it is **completed**. Do NOT update the CSV at each stage of working, or when it's edited/fixed, unless the user explicitly types `#update`.
- **Starting a task**: Read the CSV in the current workspace, append a new line with the incremented Task No., current Created Date, a concise Task Description (avoiding commas), and set Current Status to 'In Progress'. Format: `TaskNo,CreatedDate,Description,Status,DoneDate`
- **Completing a task**: Update the existing row's Current Status to 'Done' and set the Done Date in the CSV.
- **Explicit updates (#update)**: If the user types `#update`, you must update the Current Status with a brief summary of the active step.
- **Automation**: DO NOT wait for the user to remind you. This is an automatic required step before and after executing work.

## Triggers & Protocols

- **#council**: When the user types `#council [query]`, run `node scripts/summon_council.js "[query]"` and present the output.
- **#hproto**: When the user types `#hproto`, immediately initiate the [Harness Engineering Protocol](.agent/workflows/harness-protocol.md) and guide the user through the Spec -> Plan -> Execute -> Verify loop.

## Versioning & Commits

- **Versioning Rule**: ALWAYS name commits and pushes with explicit version tags.
- **Changelog Rule**: ALWAYS add a changelog summarizing all updates before pushing.
- **Next Version**: `V1.3.3` (Minor bug fixes/refinement)
- **SemVer Protocol**:
  - **Minor Push (Bug fixes, small edits)**: Increment the LAST digit (e.g., `1.0.0` -> `1.0.1`).
  - **Major Push (New functions, big updates)**: Increment the MIDDLE digit (e.g., `1.0.0` -> `1.1.0`).
  - **Breaking Change**: Increment the FIRST digit (e.g., `1.0.0` -> `2.0.0`).
