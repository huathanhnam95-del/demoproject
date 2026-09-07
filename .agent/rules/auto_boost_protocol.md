---
trigger: always_on
---

# Auto-Boost Protocol for Complex Tasks

> **Gemini-only applicability:** This always-on rule applies to Gemini workflows and Gemini agent sessions only. Auto-Boost does not apply to any GPT/Codex session in this workspace; GPT/Codex follows the workspace Light/Medium/Heavy routes.

This rule automatically engages the deep multi-agent reasoning, architectural evaluation, and empirical verification capabilities of `/boost` whenever a task is classified as **Complex**, without requiring the user to manually invoke `/boost`.

---

## 1. Definition of a "Complex Task"

Before taking action, the agent MUST evaluate the incoming user request against this rubric. If a task satisfies **ANY** of the following criteria, it is classified as **Complex**:

| Trigger Criterion | Specific Threshold / Condition | Practical Workspace Examples |
| :--- | :--- | :--- |
| **Multi-File Scope** | Touches $\ge 3$ files across the codebase. | Coordinating edits across HTML templates, styles, client scripts, and backend routes. |
| **Cross-Layer Boundaries** | Crosses architectural tiers. | Frontend UI $\leftrightarrow$ Cloud Run Backend $\leftrightarrow$ Firestore Rules / Database $\leftrightarrow$ Audio Pipeline. |
| **Concurrency & Async Logic** | Timing-sensitive operations, race conditions, async queues, or batch scheduling. | Kokoro TTS generation pipelines, streaming ASR fallbacks, cache invalidation, audio-transcript alignment. |
| **Core Architecture & Risk** | Modifies mission-critical core engines, scoring rubrics, or security/auth boundaries. | Modifying `PRACTICE_LAUNCHER`, `practice-scoring.js`, Firestore security rules, Firebase auth claims, or CI/CD pipelines. |
| **Algorithmic Complexity** | Redesigning data structures, heuristic algorithms, or performance bottlenecks. | Longest Common Subsequence (LCS) alignment, Spaced Repetition (SRS) scheduling, multi-factor difficulty classifiers. |
| **High Ambiguity / Trade-offs** | Requires comparative analysis between multiple approaches or third-party engines. | Choosing between speech assessment providers, database schema refactors, or new practice mode architectures. |
| **Persistent / Stubborn Issues** | Any bug or investigation that has resisted 2+ prior fix attempts. | Hard-to-reproduce state leaks, browser-specific layout clipping, flaky E2E tests. |

### Excluded Tasks (Standard Fast-Path)
The following tasks are **NOT** complex and should use the standard direct flow without Auto-Boost overhead:
- Typos, copy, and localization string updates.
- Isolated single-element CSS styling or minor cosmetic tweaks.
- Single-file bug fixes with obvious root causes.
- Direct query lookups or explaining a specific function/concept.

---

## 2. Mandatory Auto-Boost Execution Workflow

When a task meets the **Complex Task** criteria, the agent MUST automatically execute the following pipeline:

### Step 1: Auto-Announcement Banner
Immediately announce that Auto-Boost has engaged and state the specific trigger criterion:
```text
🚀 [Auto-Boost Activated]: Classified as Complex Task (<Trigger Reason>).
Engaging multi-agent reasoning, architectural evaluation, and empirical verification pipeline.
```

### Step 2: Multi-Perspective Trade-Off Analysis
- Use sequential thinking to analyze edge cases and system-wide ripple effects.
- Propose and compare at least 2 distinct technical approaches with explicit pros, cons, and risks before committing to an implementation plan.

### Step 3: Specialist Subagent Orchestration
- When deep research, broad codebase analysis, or isolated validation is needed, proactively invoke specialized subagents (`invoke_subagent` with `research` or `self`).
- Maintain clean context separation: let subagents handle heavy file surveys or parallel investigations while the main agent drives synthesis.

### Step 4: Rigorous Implementation Plan Gate
- Produce a structured `implementation_plan.md` adhering to the planning mode protocol.
- Wait for user approval before modifying code.

### Step 5: Empirical Verification Gate
- Strictly enforce the `empirical-validation` skill: never mark a task complete without concrete, reproducible proof (running automated test scripts, Playwright browser checks, or CLI verification).
- Check adjacent features for regressions before completing the task.
