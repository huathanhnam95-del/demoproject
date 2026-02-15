---
description: Implement features using the "Harness Engineering" protocol (Spec -> Plan -> Execute -> Verify).
---

# Harness Engineering Protocol

This workflow implements the "Human Steers, Agent Executes" methodology.

## 1. Analysis & Spec Generation

- **Trigger**: New user request or feature idea.
- **Action**:
  - Check `docs/specs/` for existing relevant specs.
  - If new, create `docs/specs/[feature-name].md`.
  - **Content**: Define the *What* and *Why*. Explicitly list requirements, constraints, and "Taste" invariants.
- **Command**: `view_file docs/specs/[feature-name].md` (or create it).

## 2. Planning

- **Action**: Create an execution plan in `docs/plans/[feature-name]-plan.md`.
- **Content**:
  - Break down the spec into atomic steps.
  - Identify files to create/modify.
  - Define verification steps (tests to run).
- **Command**: `write_to_file` to create the plan.

## 3. Execution (The Loop)

- **Iterate**:
  - Pick the next step from the plan.
  - **Execute**: Write the code.
  - **Verify**: Run the specific test for that step.
  - **Reflect**: Did it work? If not, debug. If yes, mark step as done.
- **Key**: Do NOT deviate from the spec without updating the spec first.

## 4. Mechanical Review ("Ralph Wiggum Loop")

- **Action**: Before saying "I'm done," review your own work.
- **Checklist**:
  - [ ] Does it match the `docs/specs/[feature-name].md`?
  - [ ] Did I add "AI slop" (unnecessary comments, unused code)?
  - [ ] Did I update the relevant documentation?
- **Command**: `read_file` your own changes and critique them.

## 5. Gardening

- **Action**: Cleanup.
  - Move the plan to `docs/plans/completed/` (or delete if ephemeral).
  - Update `docs/AGENTS.md` if you learned something new about the repo.
  - Run any linting/formatting scripts.

## 6. Final Report

- **Action**: Notify the user.
- **Content**: Link to the Spec, the Plan, and the PR/Changes.
