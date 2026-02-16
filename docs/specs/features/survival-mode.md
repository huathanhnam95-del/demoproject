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

## 4. Data & Contracts (The "Contract")

- UI overlay + canvas: `public/index.html` + `public/survival-style.css` / `public/style.css`
- Survival mode lifecycle is orchestrated from the main frontend mode switcher.

## 5. Verification

- Manual:
  - Start a run -> verify overlay renders and HUD updates.
  - Lose a run -> verify "restart" path is fast.
