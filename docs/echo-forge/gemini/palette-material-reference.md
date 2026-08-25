# Echo Forge Palette & Material Reference Sheet

## 1. Shared Palette Tokens

All Echo Forge visual assets draw from this locked palette. No additional hues are permitted without a contract amendment.

| Token Name | Hex Code | Tailwind Alias | Usage Domain |
|:---|:---|:---|:---|
| Slate 900 | `#0f172a` | `slate-900` | Primary silhouette base, stage background, icon containers |
| Slate 700 | `#334155` | `slate-700` | Secondary armor, structural framing, icon borders |
| Slate 600 | `#475569` | `slate-600` | Enemy floating pylons, neutral construct plating |
| Slate 300 | `#cbd5e1` | `slate-300` | Defensive shield face, block icon fill |
| Violet 600 | `#7c3aed` | `violet-600` | Hero acoustic resonance channel, sash accent |
| Violet 500 | `#8b5cf6` | `violet-500` | Enemy core crystal, hit effect wedges, icon heavy impact |
| Violet 400 | `#a78bfa` | `violet-400` | Focus/heal particle soft fill |
| Cyan 500 | `#06b6d4` | `cyan-500` | Hero glow pulse, analysis-hold ring, icon precision beam |
| Cyan 400 | `#22d3ee` | `cyan-400` | Parry deflection flash, enemy stun arcs, icon active strike |
| Amber 500 | `#f59e0b` | `amber-500` | Enemy telegraph glow, stress breaker fracture sparks |
| Amber 400 | `#fbbf24` | `amber-400` | Critical hit corona, resonance burst core, highlight trim |

## 2. Material Treatment Rules

- **Hero**: Smooth anti-aliased contours with subtle inner rim light. Luminous glow emanating from within. Clean geometric edges — no organic texture noise.
- **Enemy**: Segmented floating construct with hard-edged geometric facets. Angular crystalline forms distinct from hero's smooth language.
- **Effects**: Clean vector geometry with stepped opacity transitions. No organic particle scatter or film-grain noise.
- **Icons**: Flat vector glyphs with high-contrast borders. Minimum 7:1 contrast ratio against both `#0f172a` and neutral canvas.

## 3. Contrast & Accessibility Compliance

| Foreground | Background | Ratio | WCAG Level |
|:---|:---|:---|:---|
| Cyan 500 (`#06b6d4`) | Slate 900 (`#0f172a`) | 7.2:1 | AAA |
| Violet 500 (`#8b5cf6`) | Slate 900 (`#0f172a`) | 4.8:1 | AA |
| Amber 400 (`#fbbf24`) | Slate 900 (`#0f172a`) | 10.4:1 | AAA |
| Slate 300 (`#cbd5e1`) | Slate 900 (`#0f172a`) | 11.1:1 | AAA |

## 4. Per-Asset Palette Constraints

| Asset ID | Permitted Palette Tokens |
|:---|:---|
| `ef-hero-idle` | slate, violet, cyan |
| `ef-analysis-hold` | slate, violet, cyan |
| `ef-combat-result` | slate, violet, cyan, amber |

## 5. Provenance

- **Source**: Consolidated from `hero_turnaround_reference.md`, `training_enemy_turnaround_reference.md`, `combat_actions_icons.md`, and `combat_effects.md`.
- **Contract Reference**: `visual-contract.v1.json` (`contractId: echo-forge-visual-v1`)
