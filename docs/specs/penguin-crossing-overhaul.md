# Specification: Penguin Crossing 2.5D Overhaul

## 1. Vision

Transform "Penguin Crossing" from a basic typing prototype into a polished, "juicy", and engaging arcade experience. The goal is "Crossy Road meets Typer Shark" with a cozy Arctic aesthetic.

## 2. Core Gameplay Improvements

### 2.1. "Flow State" Mechanics

- **Combo System**:
  - Typing words correctly without errors builds a "Heat Meter".
  - **Levels**: Normal -> Heating Up -> ON FIRE!
  - **Visuals**: Penguin glows, icebergs get a gold rim, music/sfx pitch up (hooks only).
  - **Benefit**: Score multiplier (1x -> 1.5x -> 2x).
- **Streak**: Consecutive words without missing a beat speed up the gameplay slightly but drastically increase score.

### 2.2. Dynamic Spawning (`Spawner.js`)

- **Current**: Predictable Zig-Zag.
- **New**: "River Flow" Generation.
  - **Clusters**: Groups of tight, short words for rapid bursts.
  - **Gaps**: Larger jumps for long, complex words.
  - **Double Paths**: Occasional branching paths (choose Top or Bottom iceberg) to allow player agency (Risk vs Reward: Hard word for points vs Easy word for safety).

### 2.3. "Juice" & Feedback

- **Screen Shake**: On impact (landing a jump) and Game Over.
- **Particles**:
  - **Snow Puffs**: Trigger on land.
  - **Splash**: Trigger on missed jump / sinking.
  - **Sparkles**: Trigger on "Perfect Type" (no backspaces).
- **Camera**:
  - Implement "Lookahead": Camera pans slightly towards the target iceberg.
  - "Impact": Subtle zoom-in on critical moments (Game Over).

## 3. Visual Polish (`RendererV2.js`)

### 3.1. Lighting & Atmosphere

- **Vignette**: Darken corners (already exists, but refine).
- **Lantern/Glow**: If "On Fire", the penguin emits a warm point light that illuminates nearby snow (using additive blending).

### 3.2. HUD Redesign

- Replace standard text with "Wood Sign" aesthetic (partially implemented, needs polish).
- **Combo Meter**: A visual gauge (thermometer or flame icon) on the UI.
- **Score Popups**: Floating text (`+100`, `PERFECT!`) near the penguin on success.

## 4. Technical Architecture

### 4.1. Entity System

- Refactor `EntityManager` to handle **Particles** as a first-class citizen.
- Add `ParticleSystem` class.

### 4.2. Input

- Add "Typing Sound" hooks (even if silent for now, the function calls should be there).
- **Strict Mode** option (for subsequent updates, but prep capability).

## 5. Success Criteria

- [ ] Game feels "snappy" (particle feedback on every interaction).
- [ ] Combo system provides meaningful incentive to type accurately.
- [ ] Visuals (Transparency fixes) look integrated and high-quality.
- [ ] No regression in performance (60fps).
