# SRS Scheduler Redesign Plan

## Goal

Optimize the scheduling engine of the web application to match the efficiency and reliability of industry-standard tools (Anki). This plan focuses **exclusively on the scheduler logic**, ensuring all other app functions (audio, recording, UI) remain intact.

## Core Strategy: The "Dual-Engine" Scheduler

We will refactor the scheduling logic into a dedicated `SRSScheduler` module. This allows us to support two algorithms without cluttering the main UI code:

1. **Engine A: Robust SM-2 (Default)** - High fidelity to Anki's classic algorithm (Hard/Easy multipliers, Learning Steps).
2. **Engine B: FSRS v4.5 (Advanced)** - State-of-the-art efficiency using Machine Learning parameters (Difficulty, Stability, Retrievability).

## 1. Data Structure Optimization

We need to extend the card data model to support both engines without breaking existing data.

### Card Object Extensions

```javascript
{
  // Existing Fields (Preserved)
  id: "word_123",
  interval: 1,         // Days
  easeFactor: 2.5,     // SM-2 Multiplier
  repetitions: 0,
  
  // NEW: Scheduler State
  state: "learning",   // learning | reviewing | relearning | mastered
  stepIndex: 0,        // For intra-day learning steps (0=1m, 1=10m)
  
  // NEW: FSRS Fields (Initialized on demand)
  fsrs: {
    difficulty: 5,     // 1-10
    stability: 0,      // Days
    retrievability: 1, // Probability
    lastReview: timestamp
  }
}
```

## 2. Algorithm Specifications

### Engine A: Robust SM-2 (The Anki Standard)

Optimized to fix current "ease hell" and "linear growth" issues.

| Rating | Action | Interval Logic | Ease Factor Effect |
| :--- | :--- | :--- | :--- |
| **Again (1)** | Fail / Relearn | **Relearning**: Reset to Step 0 (1 min).<br>**Review**: Reset to Learning. | **-20%** (Min 130%) |
| **Hard (2)** | Struggle | **Interval * 1.2** (Fixed 1.2x multiplier). | **-15%** (Min 130%) |
| **Good (3)** | Pass | **Review**: `Interval * EaseFactor`.<br>**Learning**: Next Step (10m) or Graduate (1 day). | **No Change** |
| **Easy (4)** | Easy Bonus | **Review**: `Interval * EaseFactor * 1.3` (1.3x Bonus).<br>**Learning**: Graduate immediately to 4 days. | **+15%** |

**Configuration**:

* **Learning Steps**: `[1m, 10m]` (Intra-day reviews).
* **Graduating Interval**: `1 day`.
* **Easy Interval**: `4 days`.

### Engine B: FSRS v4.5 (Performance Option)

Optimizes retention by calculating: `Interval = Stability * 9 * (1/Retention - 1)`.

* **Difficulty (D)**: Updates on every review.
* **Stability (S)**: Compounded memory strength.
* **Handling**:
  * **Good**: Increases Stability based on D.
  * **Again**: Slashes Stability, Increases D significantly.

## 3. Integration Plan

We will implement this seamlessly into `srs-review.js`.

### Phase 1: The Scheduler Class

Create a clean wrapper for the logic.

```javascript
class SRSScheduler {
    calculate(card, rating, algorithm = 'SM2') { ... }
    _calculateSM2(card, rating) { ... }
    _calculateFSRS(card, rating) { ... }
}
```

### Phase 2: Migration & Persistence

* **Backward Compatibility**: The `calculate` method will check if `fsrs` fields exist. If not, it defaults to SM-2 or initializes them.
* **No UI Breakage**: The function signature `calculateNextReview(quality, card)` in `srs-review.js` will simply delegate to `SRSScheduler`.

### Phase 3: Mobile-Ready Constraints

* **Performance**: Logic is lightweight JS (no heavy WASM required for basic FSRS).
* **Offline First**: State is entirely JSON-serializable for LocalStorage/Firebase.

## Verification

1. **Unit Tests**: Run scenarios (New Card -> Again -> Good -> Good) and verify Intervals match Anki simulator.
2. **Regression Check**: Ensure "Mastered" status still triggers correctly.
