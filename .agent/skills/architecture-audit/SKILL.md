---
name: architecture-audit
description: "Perform a bounded read-only architecture assessment when asked to audit module boundaries, coupling, change hotspots or refactoring opportunities. Return evidenced findings and a no-change conclusion when appropriate; this does not authorize refactoring."
---

# Architecture audit

Define the requested subsystem and decision before exploring. Use existing architecture documents and relevant callers to bound the audit; do not inventory an entire repository without need.

## Collect evidence

- Trace one or two representative operations through the target area. Inspect implementations, interfaces, callers and tests together.
- Where available, use change history to identify repeated co-changes or defects. Churn is a lead, not a defect by itself; explain generated or mechanical changes separately.
- Look for callers coordinating internal steps, duplicated policy, scattered state ownership, leaked storage details, inconsistent invariants and dependencies that make relevant tests brittle.
- Apply [module-design principles](../architecture-design/references/module-design.md) to an observed problem. Assess total complexity across callers and implementation, not file length or the number of classes.
- Verify current runtime behavior or documented contracts when a conclusion depends on them. Mark untested assumptions and missing evidence.

## Evaluate whether a change earns its cost

Compare leaving the design alone with a focused alternative. Describe what becomes easier to change or verify, what complexity merely moves, compatibility risks, migration work and the test evidence needed. Prefer recommendations tied to actual requirements or recurring pain over speculative flexibility.

For each material finding report the affected paths and caller evidence, consequence, proposed direction, confidence and cost/risk. Distinguish architectural risk from a confirmed bug. Prioritize a small set of useful findings; a justified no-change result is valid.

## Boundaries and completion

This audit is read-only unless the user separately authorizes implementation. Do not edit source, delete tests, create tickets externally or launch agents automatically. Use the current host's read-only tools and route; if unavailable, report the evidence limit.

Return the requested report, with enough evidence to accept or reject each recommendation and a stopping point for investigation. For a selected new design use [architecture-design](../architecture-design/SKILL.md); do not automatically start that phase. [Provenance](SOURCE.md).
