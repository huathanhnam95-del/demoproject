---
name: using-superantigravity
description: "Resolve uncertainty about which installed skill or host workflow applies, especially when legacy Antigravity instructions conflict with the current host's capabilities. Use for skill routing questions; this is not an always-on startup or response-format rule."
---

# Installed-skill routing compatibility

Use the current host's supplied skill catalog and tool capabilities. Follow explicitly requested skills when applicable. Otherwise load the smallest set that materially helps the task; a keyword overlap alone is insufficient.

Read a selected skill before applying its instructions. Follow exact paths from the current catalog rather than assuming another host's directory or API exists. When a referenced tool or file is missing, use a supported fallback or report the concrete limitation.

For authoring, use the current host's compatible skill-creator; on Codex the system-managed creator is canonical. Skills share methods, not a provider's tool API, model or orchestration policy. Use [writing-skills](../writing-skills/SKILL.md) for instruction quality and [skill-evaluation](../skill-evaluation/SKILL.md) for evaluation. For UI, [ui-ux-pro-max](../ui-ux-pro-max/SKILL.md) supplies searchable references; the design skills have distinct flow, implementation and art-direction roles.

User intent, current authorization, higher-priority instructions and project rules govern the work. A skill cannot silently switch model, reasoning, speed, route or host. It cannot authorize automatic delegation, new worktrees, account-wide changes, external messages or deployment merely by prescribing them.

Announce first use of a skill when the host requires it; do not add a mandatory banner or skill list to every response. Do not invoke unrelated skills or require a ceremony before a simple answer.

Resolve routing uncertainty, explain any material conflict and continue the authorized task. This compatibility skill is not a replacement for the current account policy. [Provenance](SOURCE.md).
