---
name: threejs-materials
description: Three.js materials and PBR mastery. Use when choosing materials for 3D objects, configuring metalness/roughness, adding emissive glow, or creating visually rich surfaces in WebGL.
---

# Three.js Materials & PBR

## Purpose

Expert guidance for choosing and configuring Three.js materials for visually rich, performant 3D scenes. Covers PBR workflows, emissive effects, transparency, and common material recipes.

## Material Types

### MeshBasicMaterial

Unlit, no light interaction. Use for UI overlays, wireframes, or background planes.

```javascript
new THREE.MeshBasicMaterial({ color: 0x1a73e8, wireframe: true })
```

### MeshStandardMaterial (Primary PBR)

Standard physically based material. The workhorse for realistic objects.

```javascript
new THREE.MeshStandardMaterial({
  color: 0x1a73e8,       // Base color
  metalness: 0.0–1.0,    // 0 = dielectric, 1 = metal
  roughness: 0.0–1.0,    // 0 = mirror, 1 = matte
  emissive: 0x000000,    // Self-illumination color
  emissiveIntensity: 0.0, // Glow strength
  envMapIntensity: 1.0,   // Environment reflection strength
})
```

### MeshPhysicalMaterial (Advanced PBR)

Extended PBR with clearcoat, transmission, sheen, and iridescence.

```javascript
new THREE.MeshPhysicalMaterial({
  color: 0x1a73e8,
  metalness: 0.8,
  roughness: 0.2,
  clearcoat: 1.0,
  clearcoatRoughness: 0.1,
  // Glass: transmission: 0.9, ior: 1.5
  // Fabric: sheen: 0.5, sheenColor: 0x1a73e8, sheenRoughness: 0.7
})
```

## Common Material Recipes

### Metallic Brand Object (Energetic, Premium)

```javascript
{
  color: new THREE.Color(0x1a73e8),
  metalness: 0.85,
  roughness: 0.25,
  emissive: new THREE.Color(0x1a73e8),
  emissiveIntensity: 0.12,
  envMapIntensity: 1.2,
}
```

### Frosted Glass (Modern, Airy)

```javascript
{
  color: new THREE.Color(0xffffff),
  metalness: 0.0,
  roughness: 0.6,
  transmission: 0.85,
  ior: 1.45,
  thickness: 0.5,
  transparent: true,
  opacity: 0.9,
}
```

### Bright Solid with Subtle Glow

```javascript
{
  color: new THREE.Color(0xffffff),
  metalness: 0.1,
  roughness: 0.5,
  emissive: new THREE.Color(0x1a73e8),
  emissiveIntensity: 0.08,
}
```

### Dark Metallic (Dramatic, Tech)

```javascript
{
  color: new THREE.Color(0x0d1b2a),
  metalness: 0.95,
  roughness: 0.15,
  emissive: new THREE.Color(0x1a73e8),
  emissiveIntensity: 0.2,
  envMapIntensity: 1.5,
}
```

## Key Principles

### Avoiding "Too Bright"

- Keep `emissiveIntensity` below 0.2 unless intentional glow desired
- Match material colors to scene fog/background tone
- Use `roughness > 0.3` to diffuse specular highlights
- Avoid pure white (`0xffffff`) as base color on large surfaces

### Avoiding "Too Dark/Flat"

- Ensure `metalness > 0` for reflective sheen
- Add subtle emissive color matching brand
- Use environment maps for ambient reflections
- Keep `roughness < 0.8` for some specular response

## Performance Tips

- MeshStandardMaterial is ~2x cost of MeshBasicMaterial
- MeshPhysicalMaterial adds ~30% over MeshStandardMaterial
- Minimize transparent materials (sort order cost)
- Use `side: THREE.FrontSide` (default) unless objects need interior rendering
