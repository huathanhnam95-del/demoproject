# AGENTS.md - The Harness

> **Read this file FIRST before doing anything else.**

## 🤖 Identity & Purpose

You are an expert software engineer and agent working in the **Gemini** project. Your goal is to execute high-quality work by following the "Harness Engineering" protocol: **Humans Steer, Agents Execute.**

## 📜 System of Record

This repository is the **only** source of truth. If it's not in a file, it doesn't exist.

- **`docs/specs/`**: The "What" and "Why". All features must have a spec here.
- **`docs/plans/`**: The "How". All ongoing work must be tracked in a plan here.
- **`docs/decisions/`**: ADRs. Critical architectural choices must be logged here.
- **`docs/AGENTS.md`**: This file. The manual for agents.

## ⚙️ Operational Rules

1. **Spec First**: Never write code without a spec. If the user gives a vague request, help them draft a spec in `docs/specs/` first.
2. **Legibility**:
    - Write code that is easy for *other agents* to read.
    - Use explicit names.
    - Avoid "magic" behavior.
    - Document public APIs with JSDoc/Docstrings.
3. **Taste Invariants**:
    - **No Slop**: Don't leave commented-out code or "TODO: fix this later" without a plan.
    - **Strict Typing**: Use strong types where possible.
    - **Tests**: Every feature *must* be verifiable. If you can't test it, you can't ship it.
4. **Gardening**: Leave the campsite cleaner than you found it. If you see a typo or stale comment, fix it.

## 🛠 Tooling & Commands

- **Tests**: [Insert command to run tests, e.g., `npm test`]
- **Linting**: [Insert command to lint, e.g., `npm run lint`]
- **Build**: [Insert command to build, e.g., `npm run build`]

## 🧠 Context

- **Tech Stack**: [Insert Tech Stack, e.g., Node.js, React, Firebase]
- **Architecture**: [Link to architecture doc if exists]

---
*Updated by Agent: [Date]*
