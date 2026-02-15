# Plan: Penguin Crossing Overhaul

## Phase 1: Foundation & "Juice" System

### 1.1. Particle System (`src/ParticleSystem.js`)

- [ ] Create `Particle` class (x, y, vx, vy, life, color, size).
- [ ] Create `ParticleSystem` manager.
- [ ] Implement `emit(type, x, y)` for "snow", "water", "sparkle".

### 1.2. Renderer Updates (`src/RendererV2.js`)

- [ ] Implement `_drawParticles()`.
- [ ] Implement `cameraShake` (offset x/y based on trauma).
- [ ] Add `addTrauma(amount)` method to Renderer.

### 1.3. Integration

- [ ] Integrate `ParticleSystem` into `GameEngine`.
- [ ] Trigger "Snow Puff" on landing (`Penguin.update`).
- [ ] Trigger "Shake" on mistakes.

## Phase 2: Gameplay Mechanics

### 2.1. Combo System (`src/GameEngine.js`)

- [ ] Add `combo` and `heat` state variables.
- [ ] Logic:
  - Correct word: `heat += 10`, `combo++`.
  - Mistake: `heat = 0`, `combo = 0`.
  - `heat` decays over time? Or just resets on miss?
- [ ] Effect:
  - Multiplier = `1 + floor(heat / 50) * 0.5`.

### 2.2. Dynamic Spawning (`src/Spawner.js`)

- [ ] Refactor `spawnNext` to use "patterns" instead of pure random.
- [ ] **Pattern: Burst**: 3 icebergs, short distance, short words.
- [ ] **Pattern: Gap**: 1 iceberg, long distance, long word.
- [ ] **Pattern: Branch**: (Optional, if time permits) Two icebergs at same X, different Y.

## Phase 3: Visual Polish & UI

### 3.1. HUD (`src/RendererV2.js`)

- [ ] Add `HeatGauge` (draw a bar or fire icon).
- [ ] Add Floating Text support (`Renderer.addFloatingText(x, y, text, color)`).
- [ ] Trigger floating text on word complete (`+Score`).

### 3.2. Lighting (`src/RendererV2.js`)

- [ ] Add `_drawVignette` improvement (pulse red on low time / danger).
- [ ] Add simple radial gradient "glow" around penguin when Heat > 50.

## Phase 4: Verification

- [ ] Playtest: Ensure particles feel good.
- [ ] Playtest: Verify combos work and score increases.
- [ ] Playtest: Check performance.
