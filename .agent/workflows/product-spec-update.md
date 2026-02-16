---
description: How to analyze and update product specifications before a production push.
---

# Product Spec Update Protocol

**Trigger**: Before any `V*.*.*` release or after a major feature implementation.

## 1. Context Analysis

- **Run**: `git log --oneline -n 20` to see recent commits.
- **Review**: Check `conductor/` content plans (e.g., `feature-matrix.md`, `gap-plan.md`) for completed items.
- **Identify**:
  - New Features (e.g., "Added Survival Mode")
  - Tech Stack Changes (e.g., "Added Parselmouth")
  - UX/UI Shifts (e.g., "Moved to Glassmorphism")

## 2. Update Product Definition ("The What")

- **File**: `docs/specs/product.md`
- **Action**:
  - Add new items to **Core Features**.
  - Update **Tech Stack** if new libraries were added.
  - Ensure **Target Audience** still matches the product direction.

## 3. Update Product Guidelines ("The How")

- **File**: `docs/specs/product-guidelines.md`
- **Action**:
  - Refine **Visual Style** if the design system changed.
  - Update **UX Principles** based on user feedback or new game modes.
  - Ensure **Tone and Voice** matches the current application feel.

## 4. Verification

- **Check**: key discrepancies between `product.md` and the actual codebase.
- **Confirm**: `product.md` accurately describes the *current* state of the software, not just the *planned* state.

## 5. Commit

- **Command**: `git add docs/specs/`
- **Message**: `docs(specs): update product specs for V[VERSION]`
