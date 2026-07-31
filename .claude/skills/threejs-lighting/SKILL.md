---
name: threejs-lighting
description: Three.js lighting and shadow mastery. Use when setting up 3D scene lighting, configuring shadows, choosing light types, or debugging visual brightness/contrast issues in WebGL scenes.
---

# Three.js Lighting & Shadows

## Purpose

Provides expert knowledge for architecting complex lighting environments in Three.js scenes. Covers all core light types, shadow configuration, environment-based lighting (IBL), and performance optimization.

## Core Light Types

### AmbientLight

Uniform, non-directional fill. Use for baseline visibility.

```javascript
const ambient = new THREE.AmbientLight(color, intensity);
// Typical: intensity 0.1–0.4
// For dark scenes with dramatic contrast: 0.05–0.15
// For bright, airy scenes: 0.3–0.6
```

### DirectionalLight

Parallel rays simulating sun/key light. Best for primary illumination.

```javascript
const dir = new THREE.DirectionalLight(color, intensity);
dir.position.set(5, 8, 5);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 50;
// Shadow frustum: set left/right/top/bottom to encompass your scene
```

### PointLight

Omnidirectional, falls off with distance.

```javascript
const point = new THREE.PointLight(color, intensity, distance, decay);
// distance = max range (0 = infinite)
// decay = 2 for physically correct (requires renderer.physicallyCorrectLights)
```

### SpotLight

Cone-shaped with inner/outer angle.

```javascript
const spot = new THREE.SpotLight(color, intensity, distance, angle, penumbra, decay);
// angle = max cone angle in radians (Math.PI / 4 typical)
// penumbra = 0–1 softness of cone edge
```

### HemisphereLight

Two-color sky/ground fill. Excellent for natural outdoor ambience.

```javascript
const hemi = new THREE.HemisphereLight(skyColor, groundColor, intensity);
// Good default: skyColor = scene accent, groundColor = warm shadow fill
```

### RectAreaLight

Area light for soft studio-quality illumination (requires RectAreaLightHelper).

```javascript
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
RectAreaLightUniformsLib.init();
const rect = new THREE.RectAreaLight(color, intensity, width, height);
```

## Lighting Strategies by Scene Type

### Dark & Dramatic (Cosmic, Tech)

- Ambient: `0x0a0a1a`, intensity 0.08
- Key: PointLight or SpotLight with brand color, intensity 1.2–2.0
- Fill: DirectionalLight from opposite side, intensity 0.2–0.4
- Fog: FogExp2 with dark color, density 0.02–0.04

### Bright & Airy (Clean, Modern)

- Ambient: `0xffffff`, intensity 0.5–0.7
- Key: DirectionalLight `0xffffff`, intensity 0.8–1.2
- Fill: HemisphereLight sky=accent, ground=warm, intensity 0.3
- Fog: Fog with light color, near/far tuned to scene scale

### Balanced & Vibrant (Branded, Energetic)

- Ambient: `0x1a1a2e`, intensity 0.15–0.25
- Key: DirectionalLight `0xffffff`, intensity 0.6
- Brand accent: PointLight with brand color, intensity 1.0–1.5
- Fill: DirectionalLight with complementary cool tone, intensity 0.3
- Background: Deep gradient (not pure black or pure white)

## Performance Tips

- Limit shadow-casting lights to 1–2
- Use `shadow.mapSize` of 512 for mobile, 1024 for desktop
- Disable `castShadow` on fill/ambient lights
- Use `renderer.physicallyCorrectLights = true` for realistic falloff
- Consider baking ambient occlusion into textures
