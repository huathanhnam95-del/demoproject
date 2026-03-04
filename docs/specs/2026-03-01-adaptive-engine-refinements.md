# Harness Spec: Adaptive Engine Refinements & Pending Web App Work

**(Status: Executed on 2026-03-01)**

## What

Complete the final pending items for the Web App RPG Progression epic. This encapsulates:

1. **Passive Skill UI Application**: Clearly reflect discounted RPG ability costs in the Action Popover for users who own discount skills.
2. **Error Heatmap Database Infrastructure**: Provide backend per-attempt logging of missed words to a dedicated Firestore collection, laying the foundation for a frontend heatmap feature.
3. **Technical Debt & Polish**: Remove obsolete backup files (`difficulty-manager.bak.js`) and ensure the dual-track points logic configuration limits remain strictly in sync between client and server.

## Why

- **Passive Skill Feedback**: Players must visually see the benefits of their passive RPG investments. Without updated UI costs, buying "Rank 2 Word Ghost Discount" feels unrewarding.
- **Error Heatmap**: Capturing precise word-level failures at the moment of attempt submission enables the Stage 3 feature of identifying a user's systematically weak vocabulary.
- **Platform Stability**: Obsolete backup files create confusion, and configuration discrepancies between the client (`points-logic.js`) and server (`functions/src/pointsLogic.js`) can lead to unintended visual scoring disparities before the server corrects them.

## Requirements

1. **UI Discounts**: The `.popover-cost` elements in `index.html` must dynamically render base or discounted prices dynamically via `shopModule` or equivalent when the popover opens.
2. **Heatmap Logging**: The `submitAttempt` Cloud Function must record missed words (where `isCorrect === false` in `scoreContentMode`) into `{userDoc}/errorHeatmap/{contentId}` using `FieldValue.increment(1)` per word.
3. **File Cleanup**: `public/js/difficulty-manager.bak.js` must be deleted.
4. **Logic Sync**: Both client and server `points-logic.js` files must have strictly matching `MODE_WEIGHTS` and `DIFFICULTY` configurations.

## Constraints & Taste Invariants

- **Performance**: Heatmap writes must be batched or bundled in the existing `submitAttempt` transaction to avoid excessive discrete writes or race conditions.
- **Simplicity**: Do not over-engineer the UI discount logic; if the server `useActiveSkill` endpoint holds the ultimate source of truth, a client-side approximation or static map of `shopModule.hasSkill("discount_X")` is sufficient for visual feedback.
- **No AI Slop**: Remove any unused legacy code related to the features being modified.
