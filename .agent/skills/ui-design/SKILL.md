---
name: ui-design
description: "Implement or refine web interface components, responsive layouts and visual states within a product design system. Use for UI construction and visual polish; use flow research or art-direction skills only when those decisions are actually needed."
---

# UI implementation

Read the existing screen, component contracts, design tokens and relevant project rules. Preserve established branding and interaction patterns. Identify the specific user task and the behavior that must remain intact.

## Build the interface

- Reuse suitable components and tokens before introducing new variants. Keep hierarchy, alignment, spacing and typography consistent; choose fonts for the actual product rather than obeying a universal font ban.
- Use semantic elements and clear labels. Provide keyboard operation, visible focus, appropriate names and descriptions, sensible focus movement and sufficient contrast.
- Handle relevant loading, empty, error, validation, disabled and success states. Preserve data and explain recovery when an action fails.
- Check narrow and wide layouts, long labels, realistic content, zoom and localization where applicable. Avoid nested cards and decorative containers that obscure hierarchy; respect more specific project layout rules.
- Keep motion purposeful and honor reduced-motion settings. Account for layout stability, image sizing and the actual cost of effects.

For concrete visual or platform options, consult [UI UX Pro Max](../ui-ux-pro-max/SKILL.md) with a targeted query. A catalog recommendation is a candidate, not a reason to replace the current brand. Load the specialist accessibility or mobile skill only when that work is part of the task.

## Verify and deliver

Use the project's actual browser workflow to inspect the rendered result. Check the changed task flow and shared behavior likely to regress, not just a static screenshot. Use appropriate component or interaction tests when behavior changes; cosmetic edits usually need visual verification rather than implementation-mirroring tests.

Report the changed UI behavior and actual verification. Do not claim usability or accessibility certification from a palette or automated scan. Stop when the requested interface and acceptance states are complete. [Provenance](SOURCE.md).
