---
name: ui-ux-pro-max
description: "Search local UI/UX, visual-style, typography, color, chart and platform guidance when a design decision needs concrete options. Use as a design reference for existing or new products; ordinary copy or logic changes do not need a design search."
---

# UI UX Pro Max reference

Provide relevant design options from the bundled catalog, then apply project constraints and judgment. The search engine runs locally with Python's standard library. Its recommendations are advisory, not proof of accessibility or product suitability.

## Establish context

Read the affected screen, existing components, tokens and any project design instructions. Identify the actual audience, task and stack. Preserve established branding unless a redesign is in scope. Ask only for material choices that cannot be learned from available evidence.

Resolve `scripts/search.py` relative to this SKILL.md's installed directory, not the current project directory. Check that Python is available. On Windows use a quoted absolute path; for this account:

```powershell
$uiSearch = 'C:\Cursor AI\.agent\skills\ui-ux-pro-max\scripts\search.py'
python -X utf8 $uiSearch 'keyboard focus navigation' --domain ux --max-results 3 --json
```

On another host substitute the actual installed path. If the runtime is unavailable, use existing project guidance and explain that catalog retrieval was not run; do not install software automatically.

## Choose the smallest useful query

- For one decision, query that domain: `--domain ux`, `style`, `color`, `typography`, or `chart`. Use `--help` for the installed domains and stacks.
- For platform implementation, run a separate `--stack` query with the detected stack, such as `--stack react` or `--stack wpf`.
- For a new product or an explicitly requested visual-system exploration, use `--design-system --project-name "Example" --format markdown`. State the product and audience in the query. A full system is unnecessary for a local fix.
- `--stack` is ignored in design-system mode. Never present design-system output as stack-validated; query the stack separately if relevant.

Read the returned rules and rationale, including warnings. If results miss the need, refine once or switch to the project's specialist guidance; do not force a catalog match. A zero-result response is valid. Evaluate any proposed fonts, libraries or motion against actual availability, performance and accessibility requirements before adopting them.

## Apply and verify

For an existing product, map suggestions onto its components and tokens. For a new visual direction, explain the few choices that affect hierarchy, readability, interaction and implementation. Use [ui-design](../ui-design/SKILL.md) for component work, [ui-ux-designer](../ui-ux-designer/SKILL.md) for flows, or [frontend-design](../frontend-design/SKILL.md) when art direction is needed; load only the relevant skill.

Verify rendered contrast, focus, keyboard use, responsive behavior and states through the current project's browser or native-app workflow. Existing specialist accessibility guidance remains authoritative for its scope.

## Durable output is project-local

Return recommendations in the requested artifact. Do not persist project branding in this global skill. Prefer the project's approved design documentation location.

`--persist --output-dir "ABSOLUTE_APPROVED_OUTPUT_ROOT"` writes under `design-system/<project-slug>/`. Use it only when that layout is appropriate and writing a design artifact is in scope. Read existing masters and page overrides first. Keep the default non-overwrite behavior; do not add `--force` simply to bypass an existing file. Reconcile changed decisions explicitly.

Complete when relevant guidance has been applied or rejected with a reason and the task's verification is reported. Do not continue generating alternatives after the decision is sufficient.

See [source and license](SOURCE.md) for the pinned runtime and catalog.
