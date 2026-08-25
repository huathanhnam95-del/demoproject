# Echo Forge Mobile Silhouette & Readability Verification Sheet

## 1. Mobile Safe Crop Specification

All assets are authored on their full canvas and must remain completely readable when cropped to the mobile-safe region.

| Asset ID | Full Canvas | Mobile Safe Crop | Crop Box (px) | Padding Removed |
|:---|:---|:---|:---|:---|
| `ef-hero-idle` | 256×256 | 224×224 | `x: 16..240, y: 16..240` | 16px all sides |
| `ef-analysis-hold` | 256×256 | 208×208 | `x: 24..232, y: 24..232` | 24px all sides |
| `ef-combat-result` | 320×320 | 272×272 | `x: 24..296, y: 24..296` | 20px all sides (+ 4px margin) |

## 2. Hero Silhouette Readability at 224×224

All 7 hero poses verified within the 224×224 mobile crop:

| Pose | Bounding Box | Fits 224×224 | Critical Focal Points Inside Crop |
|:---|:---|:---|:---|
| Neutral / Idle | 100×180 | Yes | Head, hands, blade tip — all inside |
| Listening | 102×180 | Yes | Ear resonator, head tilt — inside |
| Speaking | 108×180 | Yes | Throat node, blade — inside |
| Guard / Block | 116×176 | Yes | Shield formation — fully inside |
| Hit / Damaged | 114×170 | Yes | Recoil arc — inside, no margin clip |
| Victory | 120×190 | Yes | Blade tip at max height — inside |
| Defeat | 130×120 | Yes | Kneeling pose — well inside bounds |

## 3. Enemy Silhouette Readability at 224×224

All 7 enemy poses verified within the 224×224 mobile crop:

| Pose | Bounding Box | Fits 224×224 | Critical Focal Points Inside Crop |
|:---|:---|:---|:---|
| Neutral / Hover | 140×190 | Yes | Core crystal, pylons — inside |
| Telegraph / Charge | 150×195 | Yes | Amber rune orbit — inside |
| Attack-Ready | 160×180 | Yes | Shockwave ring — inside |
| Hit / Recoil | 140×170 | Yes | Core flash — inside |
| Reflected-Hit / Stun | 150×160 | Yes | Cyan arcs — inside |
| Victory | 160×200 | Yes | Elevated hover — inside |
| Defeated / Shattered | 170×110 | Yes | Collapsed chassis — inside |

## 4. Icon Touch Target Compliance

| Specification | Value |
|:---|:---|
| Master icon canvas | 64×64 px |
| Minimum CSS touch target | 44×44 px |
| Touch margin | 4px per side |
| Silhouette distinction | 8 unique shapes (needle, hammer, chain, starburst, hexagon, crescent, diamond, fork) |

## 5. 360px Viewport Readability

At 360px mobile viewport width:
- Hero and enemy characters render at ~40% of viewport width, maintaining silhouette clarity.
- Icon action buttons render at 44×44 CSS px minimum — meets WCAG 2.5.8 target size.
- Analysis-hold effect at 208×208 crop remains readable behind character layers (z-order 40 > character z-order 20).
- Status text remains visible through all effect overlays at z-order separation.

## 6. Non-Color Distinction Verification

Every visual element is identifiable without color perception:

| Element Type | Non-Color Distinguisher |
|:---|:---|
| Hero vs Enemy | Smooth/geometric vs angular/crystalline form language |
| 8 action icons | Unique silhouette shapes per icon |
| Telegraph state | Shape expansion (rune orbit + pylon flare) + position shift |
| Hit vs Critical | Scale difference (256×256 vs 320×320) + radial pattern complexity |
| Block vs Parry | Hexagonal barrier vs dual-crescent deflector shape |
| Victory vs Defeat | Elevated expanded vs low collapsed silhouette |

## 7. Provenance

- **Source**: Consolidated from `hero_poses.md`, `training_enemy_poses.md`, `combat_actions_icons.md`, and `combat_effects.md`.
- **Contract Reference**: `visual-contract.v1.json` (`contractId: echo-forge-visual-v1`)
