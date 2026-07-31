---
name: color-palette-design
description: Color theory and palette design for web applications. Use when choosing background colors, balancing brightness, creating accessible color schemes, or when a design is "too bright", "too dark", or lacks energy.
---

# Color Palette Design for Web Applications

## Purpose

Expert guidance for creating balanced, accessible, and engaging color palettes. Specializes in solving common visual design problems like "too bright", "too white", "too dark", or "lacking energy."

## Color Psychology for Loading Screens

### Colors That Feel "Energetic but Comfortable"

- **Deep blue-grey backgrounds** (`#0f172a` to `#1e293b`): Professional depth without harshness
- **Warm mid-tones** (`#334155` to `#475569`): Comfortable contrast, inviting
- **Brand blue accents** (`#1a73e8`, `#3b82f6`): Energy, trust, movement
- **Soft highlights** (`#e2e8f0`, `#f1f5f9`): Clean without glaring

### The "Too White" Problem

When a design feels overwhelmingly white, it's usually because:

1. Background is pure white or near-white (`#ffffff`, `#f8f9fa`)
2. Lack of contrast layers — everything is the same brightness
3. No visual anchor point to ground the eye
4. Insufficient color saturation in accent elements

### Solutions for "Too White"

1. **Use a deep or mid-tone base**: Replace `#ffffff` with `#0f172a` (dark) or `#e8f0fe` (tinted)
2. **Add gradient depth**: Radial or linear gradients with 2-3 color stops
3. **Layer opacity**: Use semi-transparent overlays for depth
4. **Saturate accents**: Make brand color the focal point, not the background

## Balanced Background Recipes

### Deep Branded (Best for 3D Loaders)

```css
background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
/* With brand glow */
background-image: radial-gradient(
  circle at 50% 40%,
  rgba(26, 115, 232, 0.15) 0%,
  rgba(15, 23, 42, 0) 60%
);
```

### Soft Tinted (Elegant, Modern)

```css
background: #e8f0fe; /* Light blue-tinted white */
background-image: radial-gradient(
  circle at center,
  rgba(26, 115, 232, 0.06) 0%,
  transparent 70%
);
```

### Gradient Rich (Vibrant, Dynamic)

```css
background: linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%);
/* Deep navy to midnight blue — energetic but not harsh */
```

## WCAG Contrast Guidelines

- **Normal text**: Minimum 4.5:1 contrast ratio (AA)
- **Large text**: Minimum 3:1 contrast ratio (AA)
- **UI components**: Minimum 3:1 contrast ratio

### Quick Contrast Pairs

| Background | Text Color | Ratio | Rating |
|---|---|---|---|
| `#0f172a` | `#e2e8f0` | 13.5:1 | AAA ✅ |
| `#1e293b` | `#f1f5f9` | 10.8:1 | AAA ✅ |
| `#e8f0fe` | `#1e293b` | 9.2:1 | AAA ✅ |
| `#ffffff` | `#64748b` | 4.8:1 | AA ✅ |
| `#0f172a` | `#1a73e8` | 4.1:1 | AA ✅ |

## 11-Shade Scale from Brand Blue (#1a73e8)

| Shade | Hex | Use Case |
|---|---|---|
| 50 | `#e8f0fe` | Tinted backgrounds |
| 100 | `#d2e3fc` | Hover states |
| 200 | `#aecbfa` | Borders, dividers |
| 300 | `#8ab4f8` | Secondary accents |
| 400 | `#669df6` | Active states |
| 500 | `#4285f4` | Mid primary |
| 600 | `#1a73e8` | Primary (brand) |
| 700 | `#1967d2` | Primary hover |
| 800 | `#185abc` | Dark accent |
| 900 | `#174ea6` | Deep accent |
| 950 | `#0d2c6b` | Near-black accent |

## Integration with Three.js Scenes

When setting scene fog and background to match CSS:

```javascript
// For deep branded background:
scene.background = new THREE.Color(0x0f172a);
scene.fog = new THREE.FogExp2(0x0f172a, 0.035);

// For soft tinted background:
scene.background = new THREE.Color(0xe8f0fe);
scene.fog = new THREE.Fog(0xe8f0fe, 8, 30);
```
