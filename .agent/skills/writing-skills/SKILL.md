---
name: writing-skills
description: "Improve the wording and structure of SKILL.md or other agent-facing instructions: narrow triggers, remove conflicts, use precise references and define verifiable completion. Use for instruction quality; use the current host's compatible skill-creator for package creation and skill-evaluation for behavioral comparisons."
---

# Writing agent instructions

Read the target instructions and their actual consumers. Establish the behavior to improve and preserve useful existing content. For creating or restructuring a skill package, use the current host's compatible skill-creator. On Codex, the canonical entry is the `skill-creator` supplied in its native catalog. On Claude or Gemini hosts, use their supported authoring workflow and metadata. If no compatible creator is available, edit the SKILL.md and required resources directly, validate their paths and frontmatter, and report the validation limits. This skill focuses on instructional quality rather than duplicating that workflow.

## Write for a concrete task

- Put activation conditions in the description: what situation needs the skill, with a discriminating boundary where necessary. Avoid universal triggers such as every conversation or a remote possibility of relevance.
- Lead the body with the intended outcome and relevant constraints. Separate ordered operations from reference facts and optional techniques.
- Give precise paths or retrieval cues for information the agent cannot know. Load detailed references conditionally, close to the decision that needs them.
- Specify observable completion and useful error handling. Include the fallback when a host-specific tool or prerequisite is unavailable.
- State permitted side effects and preserve the current authorization, ownership and project rules. Do not create generic approval gates, model changes, automatic delegation or publication from an ordinary writing task.
- Remove repeated rules, contradictory examples, stale host assumptions and instructions that do not change behavior. Retain essential exceptions and evidence requirements; brevity is not an excuse to lose the contract.

For global skills, keep process reusable and obtain brand, stack, documentation locations and deployment targets from the current project. Avoid storing one project's facts as universal defaults.

## Verify the instruction

Check metadata, names, referenced files and executable examples with available local validators. Inspect positive and negative trigger cases, overlap with installed skills, and plausible failure paths. Static checks establish package quality, not agent performance.

When behavioral evaluation is requested or needed to support a quality claim, use [skill-evaluation](../skill-evaluation/SKILL.md). Compare the candidate with a baseline on representative tasks, preserve raw evidence and report limitations. Use only authorized runtime and delegation paths; do not invoke another provider automatically.

Complete when the instruction is coherent, discoverable and its claimed validation is supported. Report consequential behavior changes and any untested assumptions. [Provenance](SOURCE.md).
