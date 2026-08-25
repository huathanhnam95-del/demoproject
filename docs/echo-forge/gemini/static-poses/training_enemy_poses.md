# Training Enemy Static Poses Specification

## 1. Overview & Fallback Contract

These static poses represent the keyframe postures for the Echo Resonance Construct / Training Enemy. When reduced motion is enabled, state transitions switch immediately to these static states.

All poses preserve:
- **Canvas Dimensions**: 256×256 px.
- **Pivot Point**: `(128, 224)` at bottom center hover plane.
- **Palette**: Slate (`#0f172a`), Violet (`#8b5cf6`), Amber (`#f59e0b`), Cyan (`#22d3ee`).
- **Transparency**: 100% alpha transparent background (`#00000000`).

---

## 2. Pose Matrix

| Pose Name | State Event Trigger | Bounding Box | Key Visual Indicators |
| :--- | :--- | :--- | :--- |
| **Neutral / Hover** | `combat.started`, `player.action.selected` | `140x190` px | Levitating balanced stance, core pulsing violet at 1 Hz. |
| **Telegraph / Charge** | `enemy.intent.presented` | `150x195` px | Arm pylons raised, core flares amber, acoustic runes orbit the crown. |
| **Attack-Ready / Release** | `enemy.intent.presented` (critical) | `160x180` px | Thrusting forward posture, sonic shockwave ring expanding from chest. |
| **Hit / Recoil** | `player.attack.resolved` | `140x170` px | Torso pitched backward, core flashing white-violet, pylons displaced. |
| **Reflected-Hit / Stun** | `player.parry.resolved` | `150x160` px | Destabilized rotation, cyan electrical arcs spanning disjointed plates. |
| **Victory** | `combat.defeat` (enemy wins) | `160x200` px | Elevated hover height, core blazing intense violet, arms spread wide. |
| **Defeated / Shattered** | `combat.victory` (enemy loses) | `170x110` px | Collapsed chassis on baseline, dim cracked core, floating pieces falling. |

---

## 3. Pose Descriptions & Geometry

```
   [NEUTRAL]       [TELEGRAPH]      [ATTACK-READY]        [HIT]           [STUN/PARRIED]      [VICTORY]       [DEFEATED]
    /---\            /---\             /---\             \---\               /- -/              /---\            ...
   |< * >|          |< # >|          >>|< # >|          | < * >|            | * * |            |<(O)>|          /---\
    \---/            \---/             \---/             /---/               \- -/              \---/          | * . |
     (o)              (O)               (o)>>             (o)                 (~)                (O)            \___/
 Pivot (128,224)  Pivot (128,224)   Pivot (128,224)   Pivot (128,224)     Pivot (128,224)    Pivot (128,224) Pivot (128,224)
```

1. **Neutral**: Standard idle hover at 32px above the contact baseline.
2. **Telegraph**: Distinct visual warning state. Amber intent runes appear clearly above the construct's head.
3. **Attack-Ready**: Clear forward vector telegraphing physical or sonic delivery.
4. **Hit**: Compressional distortion along the horizontal axis, indicating impact absorption.
5. **Reflected-Hit (Parried)**: Fragmented silhouette with cyan resonance disrupting plate alignment.
6. **Victory**: Looming high-altitude presence commanding the right side of the arena.
7. **Defeated**: Grounded inert scrap pile resting solidly on `y: 224`.

---

## 4. Mobile Safe Crop & Accessibility Review

- All 7 enemy poses fit within the `224x224` mobile-safe crop bounds.
- The amber telegraph state features both color shift and shape expansion (rune orbit + pylon flare) for color-blind accessibility.
