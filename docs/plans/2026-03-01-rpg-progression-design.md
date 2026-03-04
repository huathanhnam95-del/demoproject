# Design: RPG Progression & Shop Implementation (Web App)

Date: 2026-03-01
Status: Approved

## 1. Objective

Complete the transition of the web application's RPG system from a "mode unlocking" model to a "Skill Economy" model. This involves removing practice mode gating, implementing a contextual "Active Skill" menu, and wiring up economy-linked tools (Hints, Audio Controls) to the Firebase backend.

## 2. Architecture & Components

### 2.1 Mode Gating Removal

- **Goal**: All core practice modes (Type, Speak, Extended, Watch, Notes) available from Day 1.
- **Change**: Remove the `window.shopModule.isModeUnlocked` check in `public/script.js`.
- **Source of Truth**: `CORE_PRACTICE_MODES` in the client-side configuration.

### 2.2 Active Skills Popover UI

- **Component**: A new contextual "Skill Palette" popover anchored to the Hint button.
- **Behavior**: Clicking the Hint button opens a menu of available skills for the active mode.
- **Data Source**: `window.SkillCatalog.DATA.active`.
- **Visuals**:
  - Item Name, Coin Cost, and subtle hover tooltip for "Calibration Impact".
  - Lock icons for unpurchased skills.
  - Disabled state for used/unavailable skills.

### 2.3 Audio Control Integration

- **Intercept**: Setters for playback speed and loop state.
- **Economy Hook**: Trigger `useActiveSkill('slow_audio' | 'echo_loop')` before applying the effect.
- **Policy Enforcement**: Charge `per_attempt` for slow audio and `per_enable` for loops.

## 3. Data Flow & Economy

1. **Client Request**: User clicks an unlocked skill in the popover.
2. **Server Auth**: Client calls `useActiveSkill(skillId, attemptId)`.
3. **Coin Deduction**: Server deducts coins, updates `assistLedger`, and returns `success: true` + `attemptCalibMult`.
4. **Effect Execution**: Client applies the visual/audio effect only on server success.
5. **Scoring Penalty**: `performance-tracker.js` applies the `attemptCalibMult` to the final session score.

## 4. Adaptive Engine Penalties

- **Difficulty Multiplier**: Assisted attempts will have their performance score scaled by the returned `calibMult` (e.g., 0.25x for full reveal).
- **Smurf Protection**: `DifficultyManager` will enforce a "Pure Streak" requirement for level-up promotion (requires `calibMult >= 0.9`).

## 5. Implementation Sequence (Depth-First)

1. **Milestone 1**: Mode Gating Removal & Core Backend Connection (verify `useActiveSkill` calls work).
2. **Milestone 2**: Hint Popover implementation (Word Ghost & First-Letter Peek effects).
3. **Milestone 3**: Audio Player integration (Slow-Mo & Loop charging).
4. **Milestone 4**: Adaptive Engine & UI Polish (Calibration tooltips and Smurf logic).
