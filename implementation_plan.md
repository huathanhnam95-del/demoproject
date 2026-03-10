# SRS Scheduler Redesign Plan (Revised)

## Goal

Optimize the scheduling engine of the web application to match the efficiency and reliability of industry-standard tools (Anki).

*Status update (March 2026): The core architectural redesign for the "Dual-Engine" scheduler (SM-2 + FSRS v4.5) has been successfully implemented in `public/srs-scheduler.js` and `public/srs-review.js`. The current focus is strictly on **Verification and Regression Testing**.*

## User Review Required

No immediate user review required for architectural choices, as the Dual-Engine is live. However, the proposed Automated Unit Testing approach requires confirmation before execution.

## Proposed Changes (Completed)

The following components have been fully migrated and are actively running in production:

### Core Scheduling Logic

#### [MODIFY] `public/srs-scheduler.js`

- Implements `calculateSM2` and `calculateFSRS` (via `ts-fsrs`) algorithms.
- Unified single-entry calculation method `SRSScheduler.calculate()`.
- Supports extraction of Retrievability and Stability for statistics.

### Controller & UI Integration

#### [MODIFY] `public/srs-review.js`

- Delegated all scheduling math to `srs-scheduler.js`.
- Implemented Settings UI to allow users to toggle between algorithms seamlessly.
- Integrated `Chart.js` rendering for "Memory Health".

## Proposed Changes (Pending)

### Unit Testing Suite

Currently, there are no dedicated automated tests for the complex temporal math inside `SRSScheduler` in the `tests/` directory.

#### [NEW] `tests/srs-scheduler.test.mjs`

Create a Node.js-compatible test script to verify both engines:

- **SM-2 Tests**: Verify graduating interval (1d), easy interval (4d), hard multiplier (1.2x), and ease factor penalties.
- **FSRS Tests**: Verify integration with `ts-fsrs` returns expected retrievability, stability, and difficulty floats given mock inputs.
- **Mastery Scenarios**: Ensure words correctly graduate to the `mastered` state across both engines.

## Verification Plan

### Automated Tests

- Build and run `node tests/srs-scheduler.test.mjs` to ensure the core mathematical formulas do not regress during future updates.

### Manual Verification

- Launch the application locally using `node server.js`.
- Open the SRS Review panel.
- Verify that changing between SM-2 and FSRS algorithms in the Settings modal successfully persists and alters the next scheduled button intervals.
