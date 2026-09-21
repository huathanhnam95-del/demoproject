---
name: skill-evaluation
description: "Evaluate a skill revision against a baseline using representative tasks, trigger cases and observed outcomes, or aggregate and review existing evaluation evidence. Use for skill quality measurement; package creation belongs to the current host's compatible skill-creator."
---

# Skill evaluation

Measure whether a skill improves the intended behavior without creating scope, safety or trigger regressions. The preserved evaluation utilities support evidence collection; they do not prove quality by themselves.

## Define the comparison

Read the skill, source revision and proposed change. Select representative positive tasks, nearby negative triggers and important failure cases. Specify independent acceptance criteria before viewing candidate outputs. Include scope preservation, required behavior and meaningful verification; do not optimize only tokens or answer length.

Use the current host's authorized execution route. A Light task runs directly; do not spawn agents or invoke a different model/provider merely because a legacy evaluation recipe mentions them. If isolated model runs are unavailable or not authorized, perform static validation and describe the remaining behavioral comparison explicitly.

For actual comparisons, keep model, effort, tools, inputs and environment comparable; record differences. Preserve separate baseline and candidate outputs. Repeat sufficiently when variability affects the decision. Grade against the defined criteria with concrete evidence and uncertainty, and use blind comparison when practical. Do not fabricate missing token, timing or pass-rate data.

## Evidence and local utilities

Store runs outside the installed skill and outside protected project paths, under an approved task evidence directory. The retained [schemas](references/schemas.md) describe the legacy JSON formats. Fields and example provider names there are format examples, not model-routing instructions; record only metrics actually exposed by the current host.

For collected run directories, a standard-library static viewer is available:

```powershell
$evalRoot = 'C:\Cursor AI\.agent\skills\skill-evaluation'
python -X utf8 "$evalRoot\eval-viewer\generate_review.py" 'ABSOLUTE_RUN_DIRECTORY' --static 'ABSOLUTE_REVIEW_HTML'
```

Substitute actual absolute paths and inspect `--help` first. Prefer the static viewer: the retained server mode can attempt to terminate a process on its port and is not part of this workflow. Do not run that mode against an unowned port.

The retained legacy `aggregate_benchmark.py` is archival tooling, not a trusted measurement path: it can substitute output characters for token counts, assume three runs per configuration, and treat missing metrics as zero. Do not use its raw summaries for performance claims. Compute the requested summary from measured run records with actual sample counts and mark missing metrics unavailable; record the method alongside the results. The static viewer can show individual outputs without importing a legacy benchmark summary.

The retained `run_eval.py`, `run_loop.py` and `improve_description.py` are legacy Claude/Anthropic adapters. They require an explicitly selected compatible runtime, credentials and dependencies. Do not run them as Codex-native tools, install their dependencies automatically or infer cross-provider authorization from a request to evaluate a skill. The retained grader/comparator/analyzer documents are optional rubric references, not commands to dispatch agents.

For package validation and creation, use the current host's compatible authoring workflow. On Codex, use the canonical `skill-creator` supplied in its native catalog; do not treat Codex-specific UI or tool metadata as requirements for another host. A plumbing fixture that tests aggregation or HTML output must be labeled synthetic and excluded from performance claims.

## Decision

Compare requirement completion and regressions first, then unnecessary questions, time, tool calls and tokens if measured. Report sample size, environment and limitations. Recommend retain, revise or reject with observed evidence; a syntactically valid skill has not thereby won an A/B test. Stop once the requested evaluation has a supported result or a specific execution limit is recorded. [Provenance](SOURCE.md).
