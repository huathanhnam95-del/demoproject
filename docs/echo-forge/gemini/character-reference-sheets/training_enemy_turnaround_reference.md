# Training Enemy Turnaround & Consistency Reference Sheet

## 1. Character Identity & Art Direction

- **Character Concept**: Echo Resonance Golem / Training Construct.
- **Role**: Target entity in the Echo Forge combat sandbox. Broadcasts attack intents, takes damage from scored pronunciation attacks, and responds to successful/failed learner defences.
- **Style Treatment**: Segmented floating geometric construct with slate armor plates, an exposed pulsing violet resonance core, and distinct telegraph runes.
- **Rendering Boundary**: Pure alpha transparent background (`#00000000`), zero baked stage color, zero ground shadows baked into sprite.

---

## 2. Palette Constraints & Material System

| Element | Color Name | Hex Code | Purpose |
| :--- | :--- | :--- | :--- |
| Heavy Chassis | Slate 900 | `#0f172a` | Armored outer shell segments |
| Floating Pylons | Slate 600 | `#475569` | Levitating shoulder and arm components |
| Core Crystal | Violet 500 | `#8b5cf6` | Central power core, reacts to damage |
| Telegraph Glow | Amber 500 | `#f59e0b` | Intent warning and charge state |
| Stun / Weakness | Cyan 400 | `#22d3ee` | Harmonic destabilization on parry |

---

## 3. Proportions & Geometric Anchors

- **Overall Canvas**: 256×256 px.
- **Construct Size**: 190 px tall, 140 px wide.
- **Pivot Point**: `(128, 224)` — anchored at the center of the hover base / contact plane.
- **Transparent Padding**: Minimum 16 px (`top: 16, right: 16, bottom: 16, left: 16`).
- **Mobile-Safe Crop**: 224×224 px centered box (`x: 16..240, y: 16..240`).

---

## 4. Turnaround Views (4 Orthographic Projections)

```
       [FRONT]              [THREE-QUARTER]            [PROFILE]               [BACK]
      +---------+             +---------+             +---------+            +---------+
      |  /---\  |             |  /---\  |             |   /--\  |            |  /---\  |  Head/Crown
      | |< * >| |             | | *  >| |             |  | * |> |            | |  #  | |  Core Crystal
      |  \---/  |             |  \---/  |             |   \--/  |            |  \---/  |  Chassis
      |   (o)   |             |   (o)   |             |    (o)  |            |   (o)   |  Hover Repulsor
      +----+----+             +----+----+             +----+----+            +----+----+
        Pivot (128,224)         Pivot (128,224)         Pivot (128,224)        Pivot (128,224)
```

1. **Front View (0°)**:
   - Symmetrical floating chassis with central octagonal core housing.
   - Dual levitating fist pylons flanking the main body.
2. **Three-Quarter View (45°)**:
   - Primary combat perspective facing left toward the hero.
   - Distinct separation between leading arm pylon and central core.
3. **Profile View (90°)**:
   - Floating silhouette with backward slant for forward-momentum attack telegraphs.
4. **Back View (180°)**:
   - Armored carapace protecting the rear crystal node.

---

## 5. Provenance & Generation Parameters

- **Source Reference**: `claude-enemy-reference-v1`
- **Model**: `gemini-3.7-flash` (version `3.7`)
- **Generation Seed**: `unavailable`
- **Output Validation**: Strict transparency mask check (`alpha == 0` on outer margin).
