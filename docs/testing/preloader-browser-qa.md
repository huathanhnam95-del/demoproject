# Preloader Browser QA Checklist

This document provides a manual checklist for verifying the BEL cinematic 3D preloader across different rendering profiles.

## Environment Setup

1. **Start Local Server**:

   ```powershell
   .\node_modules\.bin\http-server.cmd public -p 4173
   ```

2. **Standard Browsing**:
   Open `http://127.0.0.1:4173/index.html` in a modern browser (Chrome/Edge preferred).

## Standard Path Verification

- [ ] **Visual Appearance**:
  - The "BEL" wordmark appears in the center, initially dim and then scales/brightens.
  - 3D depth is visible (letters are thick).
  - Energy ring/particles are visible around the logo.
  - Status text "Loading Practice Data..." is visible at the bottom.
- [ ] **Animation**:
  - Camera performs a cinematic "approach" (zoom from side).
  - Camera "prizes" the logo (slight drift/panning).
  - Animation feels smooth (target 60fps).
- [ ] **Dismissal**:
  - Logo performs a slight "zoom-in" and fades out when loading is complete.
  - Main application content appears seamlessly.

## Reduced-Motion Verification

To test, enable reduced motion in OS settings or use the browser test:

```bash
npm run test:preloader:browser:reduced
```

- [ ] **Behavior**:
  - Preloader appears instantly without scale/drift animation.
  - No camera movement.
  - No floating particles.
  - Dismissal is a simple fast fade (~200ms) or instant hide.

## Mobile/Low-Capability Verification

To test, use a narrow viewport (Mobile Emulation) or the browser test:

```bash
npm run test:preloader:browser:mobile
```

- [ ] **Scale**:
  - "BEL" wordmark is properly scaled for narrow screens (no overflow).
  - Status text is readable.
- [ ] **Performance**:
  - Particle count is noticeably lower.
  - Atmosphere glow may be disabled (depending on device profile).

## Error States

- [ ] **Fallback**:
  - If Three.js fails to load or WebGL is disabled, the preloader should show the 2D "BEL" wordmark as a fallback.
  - Check browser console for "BEL preloader fallback activated" message.
