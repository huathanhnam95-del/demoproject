# Master Conductor File

> **Source of Truth for Agent Context**

## Context Reference

- [Tech Stack](./conductor/tech-stack.md)
- [Product Context](./conductor/product.md)
- [Project Configuration](./conductor/project.md)

## Active State

- **Status**: Active Development
- **Phase**: Infrastructure Upgrade

## Instructions

This file guides the agent's understanding of the project structure and context.

## Triggers & Protocols

- **#council**: When the user types `#council [query]`, run `node scripts/summon_council.js "[query]"` and present the output.

## Versioning & Commits

- **Versioning Rule**: ALWAYS name commits and pushes with explicit version tags.
- **Changelog Rule**: ALWAYS add a changelog summarizing all updates before pushing.
- **Next Version**: `V1.0.0` (Use this for the immediate next push).
- **SemVer Protocol**:
  - **Minor Push (Bug fixes, small edits)**: Increment the LAST digit (e.g., `1.0.0` -> `1.0.1`).
  - **Major Push (New functions, big updates)**: Increment the MIDDLE digit (e.g., `1.0.0` -> `1.1.0`).
  - **Breaking Change**: Increment the FIRST digit (e.g., `1.0.0` -> `2.0.0`).
