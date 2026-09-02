# Hero Turnaround & Consistency Reference Sheet

## 1. Character Identity & Art Direction

- **Character Concept**: The Acoustic Adept / Resonance Striker.
- **Role**: Learner avatar in Echo Forge combat sandbox. Performs pronunciation attacks, blocks, and timed parries.
- **Style Treatment**: Crisp 2D sprite with high silhouette readability, clean anti-aliased contours, subtle inner rim light, and high contrast against dark or light neutral stages.
- **Rendering Boundary**: Pure alpha transparent background (`#00000000`), zero baked stage color, zero drop shadow baked into sprite.

---

## 2. Palette Constraints & Material System

| Element | Color Name | Hex Code | Purpose |
| :--- | :--- | :--- | :--- |
| Primary Armor | Slate 900 | `#0f172a` | Main silhouette base, high contrast |
| Secondary Plating | Slate 700 | `#334155` | Joint armor and structural framing |
| Primary Accent | Violet 600 | `#7c3aed` | Acoustic resonance channel & sash |
| Glow / Focus Pulse | Cyan 500 | `#06b6d4` | Active articulation points and edge glow |
| Highlight Trim | Amber 400 | `#fbbf24` | Critical resonance ready state & burst |

---

## 3. Proportions & Geometric Anchors

- **Overall Canvas**: 256×256 px.
- **Character Height**: 180 px from head crown to feet baseline.
- **Head-to-Body Ratio**: 1:5.5 (heroic stylized proportion).
- **Pivot Point**: `(128, 224)` — centered on horizontal baseline at feet ground contact.
- **Transparent Padding**: Minimum 16 px (`top: 16, right: 16, bottom: 16, left: 16`).
- **Mobile-Safe Crop**: 224×224 px centered box (`x: 16..240, y: 16..240`).

---

## 4. Turnaround Views (4 Orthographic Projections)

```
       [FRONT]              [THREE-QUARTER]            [PROFILE]               [BACK]
      +---------+             +---------+             +---------+            +---------+
      |   (o)   |             |   (o)   |             |   ( )>  |            |   ( )   |  Crown/Visor
      |  /|#|\  |             |  //|#\  |             |   /|#   |            |  /|#|\  |  Torso/Cape
      |   |#|   |             |   |#|   |             |    |#   |            |   |#|   |  Waist/Sash
      |  / \ \  |             |  / / \  |             |   / |   |            |  / \ \  |  Legs/Boots
      +----+----+             +----+----+             +----+----+            +----+----+
        Pivot (128,224)         Pivot (128,224)         Pivot (128,224)        Pivot (128,224)
```

1. **Front View (0°)**:
   - Symmetrical chest rune plate with centered cyan resonance node.
   - Violet sash flowing downward to the right hip.
   - Dual acoustic focus gauntlets resting at sides.
2. **Three-Quarter View (45°)**:
   - Primary combat perspective facing right toward enemy.
   - Clear silhouette separation between front arm and torso.
   - Blade/focus focus tool held at a 30° forward angle.
3. **Profile View (90°)**:
   - Slim vertical profile showing back mantle curvature.
   - Distinct boot ground-contact baseline.
4. **Back View (180°)**:
   - Central acoustic spine resonator glowing violet.
   - Shoulder mantle resting cleanly across upper back.

---

## 5. Provenance & Generation Parameters

- **Source Reference**: `claude-hero-reference-v1`
- **Model**: `gemini-3.7-flash` (version `3.7`)
- **Generation Seed**: `unavailable`
- **Output Validation**: Strict transparency mask check (`alpha == 0` on outer margin).
