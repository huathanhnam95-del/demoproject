# Survival Mode Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Survival Mode is an arcade typing "run" inspired by Vampire Survivors. It provides high-intensity repetition while still feeding the RPG progression loop.

## 2. Goals (The "Why")

- Make practice feel like a game session with immediate replays.
- Reward accuracy + speed while keeping vocabulary meaningful.

## 3. Requirements (The "What")

### Functional

- Enter Survival Mode from the mode switcher.
- Run loop:
  - enemies spawn, each mapped to a word/typing target
  - user types to attack/defend
  - periodic level-up choices (upgrade/weapon selection)
- Boss encounters on timers (scheduled difficulty spikes).
- A HUD that clearly shows:
  - time, HP, weapon level, XP bar, and key modifiers (e.g., word rush)
- Survival "run" outcomes contribute to XP/Coins and/or mastery signals (where applicable).

### Non-Functional

- 60fps target on typical hardware (canvas-based rendering).
- Instant restart flow (low friction between runs).
- Mode-load failures must be recoverable (show user-facing message and preserve main app usability).
- Audio and vocabulary-data failures are non-critical; gameplay should continue with fallback behavior.
- Exiting Survival must restore standard layout (no blank-page state after overlay close).

## 4. Data & Contracts (The "Contract")

- UI overlay + canvas: `public/index.html` + `public/survival-style.css` / `public/style.css`
- Entry + load guards: `public/script.js` (`switchToMode('survival')`, `ensureSurvivalGameLoaded` checks).
- Overlay open/close + retry wiring: `public/index.html` (`openSurvivalGame`, close handlers, retry button handlers).
- Engine lifecycle: `public/js/survival-game/SurvivalGame.js` (`start`, game-over modal flow, `stop`).
- Fallback signals in engine:
  - BGM/analysis failures are handled as warnings in `public/js/survival-game/AudioManager.js`.
  - Oxford list load failures fall back to built-in word sources in `public/js/survival-game/SurvivalGame.js`.

## 5. Verification

- Manual:
  - Start a run -> verify overlay renders and HUD updates.
  - Lose a run -> verify "restart" path is fast.
  - Force module load failure (or block survival module) -> verify recoverable alert and no main-layout corruption.
  - Simulate BGM failure/unavailable audio file -> verify run remains playable.
  - Exit from overlay -> verify normal app layout and mode switching still work.
