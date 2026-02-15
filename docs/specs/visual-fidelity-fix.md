# Specification: Visual Fidelity Restoration (2.5D Penguin Crossing)

## Problem

The `bg_mountains.png` and `bg_shore.png` assets contain "fake" transparency (checkerboard patterns or solid backgrounds not properly keyed out), obscuring the `bg_sky.png` layer and breaking the parallax effect.

## Requirements

1. **Genuine Transparency**: All overlay assets (`bg_mountains`, `bg_shore`, `fg_snowbank`, `icebergs`) MUST have a true alpha channel (RGBA) where the background pixels are (0,0,0,0).
2. **No Artifacts**: Edges must be clean (no white/black halos).
3. **Visual Coherence**: Assets must match the "Arctic Night" aesthetic (cool blues, dark tones).
4. **Verification**: A specific test page or script must demonstrate the layering works correctly (e.g., placing the asset over a bright pink background to prove transparency).

## Implementation Strategy

- **Generation**: Use `generate_penguin_assets_v4.py` with modified prompts to request "solid magenta background" (0xFF00FF) or similar chroma-key friendly color.
- **Post-Processing**: Update the `make_transparent` function to precisely target this key color with a configurable threshold.
- **Validation**: Add a `unittest` or simple HTML check to overlays the images.
