# Echo Forge Combat Action Icon Concepts

## 1. Design Tokens & Visual Hierarchy

- **Canvas Size**: 64×64 px master icon grid (rendered at 44×44 CSS px minimum for touch target compliance).
- **Style**: Clean vector glyphs with high contrast borders, clear symbolic silhouettes, and zero decorative noise.
- **Palette Tokens**:
  - Background container: Slate 900 (`#0f172a`) with 1px border Slate 700 (`#334155`).
  - Active Strike / Cyan Accent: Cyan 400 (`#22d3ee`).
  - Heavy Impact / Violet Accent: Violet 500 (`#8b5cf6`).
  - Critical / Burst Accent: Amber 400 (`#fbbf24`).
  - Defensive Slate: Slate 300 (`#cbd5e1`).

---

## 2. Attack Actions Family

### 1. Precision Strike (`ef-icon-precision-strike`)
- **Visual Concept**: A sharp needle-like acoustic frequency beam piercing cleanly through a concentric phonetic target ring.
- **Symbolism**: Accurate phoneme articulation and vowel targeting.
- **Coloration**: Cyan beam (`#06b6d4`) on dark slate backing with white focal point.
- **Silhouette**: High-contrast diagonal piercing vector.

### 2. Stress Breaker (`ef-icon-stress-breaker`)
- **Visual Concept**: A heavy geometric hammer descending onto an accented peak waveform, shattering acoustic tension lines.
- **Symbolism**: Primary lexical stress and syllable emphasis.
- **Coloration**: Violet hammer head (`#7c3aed`) with amber fracture sparks (`#f59e0b`).
- **Silhouette**: Solid angular downward wedge.

### 3. Echo Chain (`ef-icon-echo-chain`)
- **Visual Concept**: Three interlocking harmonic rings linked in a diagonal cadence wave.
- **Symbolism**: Connected speech, liaison, and rhythmic fluency.
- **Coloration**: Flowing cyan-to-violet gradient rings (`#06b6d4` -> `#8b5cf6`).
- **Silhouette**: Triple interlocking chain link pattern.

### 4. Resonance Burst (`ef-icon-resonance-burst`)
- **Visual Concept**: An exploding 8-point sonic supernova with radial shockwaves dispersing outward.
- **Symbolism**: Consumed maximum resonance gauge for massive bonus damage.
- **Coloration**: Brilliant amber core (`#fbbf24`) with violet perimeter arcs (`#7c3aed`).
- **Silhouette**: Starburst with bold alternating radial spokes.

---

## 3. Defence & Utility Family

### 5. Block (`ef-icon-block`)
- **Visual Concept**: A sturdy hexagonal acoustic barrier plate with reinforced slate rim.
- **Symbolism**: Standard prompt audio absorption / listening defence.
- **Coloration**: Slate 300 shield face (`#cbd5e1`) with cyan border glow (`#06b6d4`).
- **Silhouette**: Solid symmetrical hexagon.

### 6. Parry (`ef-icon-parry`)
- **Visual Concept**: Dual curved sonic deflectors creating an interference pattern that redirects an incoming spike.
- **Symbolism**: Timed phonetic counter-reaction.
- **Coloration**: High-energy cyan reflection crescent (`#22d3ee`) with violet sparks.
- **Silhouette**: Opposing crescent blades creating an energetic diamond center.

### 7. Focus (`ef-icon-focus`)
- **Visual Concept**: An open acoustic aperture lens converging multiple erratic frequency lines into a single coherent laser.
- **Symbolism**: Pronunciation precision tuning / turn stabilization.
- **Coloration**: Radiant cyan eye/lens (`#06b6d4`) inside violet diamond housing.
- **Silhouette**: Concentric diamond aperture.

### 8. Resonance (`ef-icon-resonance`)
- **Visual Concept**: A glowing tuning fork with pulsing sinusoidal acoustic aura rings.
- **Symbolism**: Gauge charge level and harmonic alignment.
- **Coloration**: Pulsing violet tines (`#8b5cf6`) radiating amber harmonic ripples (`#fbbf24`).
- **Silhouette**: Twin-pronged acoustic tuning fork.

---

## 4. Non-Color Accessibility & Touch Compliance

- **Shape Distinction**: Every icon possesses a unique outer silhouette (needle, hammer, chain, starburst, hexagon, crescent, diamond, fork) so identification does not depend on color perception.
- **Touch Target**: Sized at 64×64 master assets, rendered within min 44×44 CSS px tap areas with 4px margin.
- **Contrast Ratio**: Exceeds 7:1 against both `#0f172a` and neutral canvas backgrounds.
