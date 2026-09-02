# Hero Static Poses Specification

## 1. Overview & Fallback Contract

Every static pose represents an approved keyframe and fallback frame for the Hero character in Echo Forge. Under `prefers-reduced-motion: reduce`, the game renders these exact static keyframes without transition tweening.

All poses preserve:
- **Canvas Dimensions**: 256×256 px.
- **Pivot Point**: `(128, 224)` on horizontal baseline.
- **Palette**: Slate (`#0f172a`), Violet (`#7c3aed`), Cyan (`#06b6d4`).
- **Transparency**: 100% alpha transparent background (`#00000000`).

---

## 2. Pose Matrix

| Pose Name | State Event Trigger | Bounding Box | Key Visual Indicators |
| :--- | :--- | :--- | :--- |
| **Neutral / Idle** | `combat.started`, `player.action.selected` | `100x180` px | Upright relaxed ready stance, focus blade angled downward at 45°. |
| **Listening** | `recording.started` (audio intake) | `102x180` px | Head tilted slightly, ear resonator glowing cyan, blade held horizontally. |
| **Speaking** | `recording.started` (learner speech) | `108x180` px | Chest forward, throat node illuminated in violet, blade raised in vocal focus. |
| **Guard / Block** | `player.block.resolved` | `116x176` px | Compact defensive crouch, focus blade held vertically as an acoustic shield. |
| **Hit / Damaged** | `combat.damage.applied` | `114x170` px | Recoiled backward stance, staggered footing, violet flicker across armor plates. |
| **Victory** | `combat.victory` | `120x190` px | Blade thrust skyward, dual cyan resonance wings flared from mantle. |
| **Defeat** | `combat.defeat` | `130x120` px | Dropped to one knee, blade planted in ground plane, subdued core glow. |

---

## 3. Pose Descriptions & Geometry

```
   [NEUTRAL]        [LISTENING]       [SPEAKING]         [GUARD]           [HIT]           [VICTORY]         [DEFEAT]
      (o)              (o)>             \(o)/              (o)              /(o)              \(o)/             ...
     /|#|\             /|#\              |#|              /|#|               |#\               |#|              (o)
      |#|               |#|              |#|              [###]             / |#               |#|              /#\
     / \ \             / \ \            / \ \             / |               /  \              / \ \            /---\
    Pivot (128,224)   Pivot (128,224)  Pivot (128,224)   Pivot (128,224)   Pivot (128,224)   Pivot (128,224)  Pivot (128,224)
```

1. **Neutral (ef-hero-idle, Frame 0)**:
   - Base position for all combat states.
   - Symmetrical balance with right foot slightly forward.
2. **Listening**:
   - Resonator halo expands 8px around character crown.
   - Arms positioned defensively while audio plays.
3. **Speaking**:
   - Dynamic vocalization stance with forward projection.
   - Cyan wave lines emitting from visor.
4. **Guard**:
   - Defensive anchor. Center of mass shifted 12px lower.
   - Forearms crossed with glowing energy barrier.
5. **Hit**:
   - Backward displacement within the 224×224 mobile crop.
   - Armor sparks rendered without breaking canvas bounds.
6. **Victory**:
   - Extended vertical silhouette, cape flaring outward.
7. **Defeat**:
   - Low profile posture, zero negative vertical overshoot beyond baseline `y: 224`.

---

## 4. Mobile Safe Crop & Accessibility Review

- All 7 poses remain completely inside the `224x224` mobile safe crop box (`x: 16..240, y: 16..240`).
- No critical focal points (head, hands, blade) clip into the 16px transparent margin.
- High contrast silhouette ensures recognizability at 360px screen width without relying solely on color indicators.
