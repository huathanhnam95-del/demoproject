# Plan: Visual Fidelity Fix

## 1. Refine Generation Script (`scripts/generate_penguin_assets_v4.py`)

- [x] **Action**: Modify prompts for `bg_mountains`, `bg_shore`, `fg_snowbank`.
  - Change background request from "solid black" to "solid magenta (Hex #FF00FF)" to avoid conflict with dark mountain/shore textures.
- [ ] **Action**: Update `make_transparent` logic AGAIN.
  - Increase threshold from 45 to 80-100 to catch anti-aliased magenta fringes (halos).
  - (Optional) Implement "despill" if possible (convert residual magenta to white/transparent).

## 2. Update Renderer

- [ ] **Action**: Modify `RendererV2.js`.
  - `_drawEnvironmentLayers`: Remove `clipY` / `clipH` arguments for `bgMountains`, `bgShore`, etc.
  - Rely on parallax offset and transparency.

## 3. Regenerate Assets

- [ ] **Action**: Run the script for the problematic identifiers only.
  - `python scripts/generate_penguin_assets_v4.py --only mountains,shore,snowbank`

## 3. Verify Transparency

- [ ] **Action**: Inspect generated files.
- [ ] **Action**: Browser test in `localhost:3005`.

## 4. Final Polish

- [ ] **Action**: Commit the valid assets.
