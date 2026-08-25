# Echo Forge Combat Visual Effect Concepts

## 1. Overview & Motion Grammar

Combat visual effects in Echo Forge represent instantaneous feedback for speech recognition, combat collisions, and resource triggers.

All visual effects adhere to the strict motion grammar:
```text
windUp -> analysisHold (loopable & cancellable) -> result-specific resolve -> returnToIdle
```

- **Canvas Size**: 256×256 px (standard) and 320×320 px (burst/impact).
- **Transparency**: 100% alpha transparent backgrounds with zero baked stage color.
- **Reduced Motion Rule**: Static fallback keyframes provide complete visual clarity without rapid strobing or high-velocity screen movement.

---

## 2. Visual Effects Catalog

### 1. Analysis-Hold Effect (`ef-analysis-hold`)
- **Event Trigger**: `analysis.pending`, `analysis.noop`
- **Canvas / Pivot**: 256×256 px, centered pivot `(128, 128)`.
- **Z-Order**: 40 (renders in front of both combatants).
- **Concept**: A gentle, rotating orbital acoustic ring with 4 harmonic nodes pulsating smoothly in cyan (`#06b6d4`) and violet (`#7c3aed`).
- **Loop Behavior**: Continuous smooth loop while analysis is in flight. Immediately and safely halts on network resolution, abort, or no-op.
- **Static Fallback**: A static 4-node harmonic mandala indicating "analysis active".

### 2. Standard Hit Effect (`ef-effect-hit`)
- **Event Trigger**: `combat.damage.applied`, `player.attack.resolved`
- **Canvas / Pivot**: 256×256 px, target center pivot `(128, 128)`.
- **Z-Order**: 35.
- **Concept**: Radial acoustic shock slice with 3 violet energy wedges (`#8b5cf6`) dispersing along the impact plane.
- **Static Fallback**: Triple-prong impact flash with crisp vector outlines.

### 3. Critical Hit Effect (`ef-effect-critical`)
- **Event Trigger**: `player.attack.resolved` (High Accuracy > 90)
- **Canvas / Pivot**: 320×320 px, impact point pivot `(160, 160)`.
- **Z-Order**: 45.
- **Concept**: Searing amber-white acoustic fracture (`#fbbf24`) with dual cyan shockwaves expanding at 45° angles.
- **Static Fallback**: High-contrast star fracture with amber corona.

### 4. Block Barrier Effect (`ef-effect-block`)
- **Event Trigger**: `player.block.resolved`
- **Canvas / Pivot**: 256×256 px, guardian pivot `(128, 180)`.
- **Z-Order**: 25.
- **Concept**: Translucent slate-cyan honeycomb energy wall (`#06b6d4`, `#334155`) that ripples outward as damage is absorbed.
- **Static Fallback**: Solid honeycomb shield overlay with illuminated boundary nodes.

### 5. Parry Deflection Effect (`ef-effect-parry`)
- **Event Trigger**: `player.parry.started`, `player.parry.resolved`
- **Canvas / Pivot**: 256×256 px, midpoint pivot `(128, 140)`.
- **Z-Order**: 45.
- **Concept**: Sharp diamond-shaped cyan shockwave (`#22d3ee`) deflecting incoming red/amber intent vectors into the air.
- **Static Fallback**: Diamond flash with outward acoustic deflection cones.

### 6. Sound Reflection Effect (`ef-effect-reflection`)
- **Event Trigger**: `player.parry.resolved` (Enemy Stunned)
- **Canvas / Pivot**: 320×320 px, enemy center pivot `(160, 160)`.
- **Z-Order**: 35.
- **Concept**: Rebounded sound wave surging back toward the enemy, creating concentric destabilization rings around their core crystal.
- **Static Fallback**: Dual expanding concentric waveform rings.

### 7. Focus / Heal Resonance Effect (`ef-effect-focus`)
- **Event Trigger**: `combat.focus.changed`
- **Canvas / Pivot**: 256×256 px, bottom pivot `(128, 224)`.
- **Z-Order**: 15 (behind character).
- **Concept**: Upward spiral of soft violet-cyan harmonic particles (`#a78bfa`, `#38bdf8`) coalescing into the hero's core.
- **Static Fallback**: Upward-pointing acoustic aura pillar.

### 8. Resonance Burst Effect (`ef-combat-result`)
- **Event Trigger**: `combat.resonance.consumed`, `combat.victory`
- **Canvas / Pivot**: 320×320 px, baseline pivot `(160, 288)`.
- **Z-Order**: 30.
- **Concept**: 3-frame catastrophic resonance discharge: Frame 0 wind-up compression, Frame 1 full-stage harmonic burst (amber/cyan), Frame 2 dissipation return.
- **Static Fallback**: Frame 1 maximum burst snapshot.

---

## 3. Accessibility & Performance Safeguards

- **No Flash Hazard**: No single-frame pure white screen flashes; all luminance transitions use stepped opacity curves to prevent photo-sensitivity issues.
- **Separation of Concerns**: Effect visuals never determine damage or combat state. The visual effect responds exclusively to normalized state events emitted by the server-authoritative engine.
