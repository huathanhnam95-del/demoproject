# Echo Forge — Visual Direction Options

> **Claude Opus visual ownership** · Three art-direction candidates for the Echo Forge pronunciation-combat RPG battle stage. Each option includes a desktop composition, a 360 px mobile layout, and a reduced-motion / static equivalent.

---

## Context

Echo Forge is a pronunciation-combat game inside the BEL learning platform. Learners **speak** to attack, block, and parry. The visual system consumes normalized event payloads from the backend and renders a single coherent battle stage — no dashboards, no nested cards.

**Palette anchors** (from `visual-contract.v1.json`): slate · violet · cyan · amber  
**BEL surfaces**: `bg-dark #0f172a` · `surface-dark #1e293b`  
**Typography**: Outfit (headings + body), monospace for IPA / timers  
**Asset slots**: `ef-hero-idle` 256×256 · `ef-analysis-hold` 256×256 4-frame loop · `ef-combat-result` 320×320 3-frame one-shot

---

## Option 1 — HD Pixel-Art RPG

### Concept

Crisp 32×32-base silhouettes upscaled to the contract canvas sizes (256 px, 320 px). A side-view stage with a subtle scanline overlay on dark slate. Deliberate sprite readability — every pose is instantly legible at arm's length. Pixel-art HUD with chunky health bars and 8-bit-inspired action buttons. The recording indicator uses a classic blinking `● REC` badge.

### Desktop (≥ 1024 px)

The hero stands left, the training dummy right, on a flat stone-tile floor. Health bars top-left (hero, cyan fill) and top-right (enemy, violet fill). Focus and Resonance gauges centered above the stage. Three pixel-styled action buttons at the bottom: **Attack · Block · Parry**. A microphone icon sits at the far right of the action bar.

### Mobile (360 px)

Characters are compressed into a tighter stage using `mobileSafeCrop` (224×224). Health bars stack above the stage horizontally. Action buttons fill full width. The microphone button sits below the action row. No horizontal overflow.

### Reduced Motion / Static

All animation removed: characters freeze on their `staticFallbackFrame` (frame 0). Health bars are solid-fill rectangles with no shimmer. The analysis-hold state shows a static "hold-1" frame with a text badge "Analyzing…". Combat results appear as instant icon swaps (sword icon for attack, shield for block) with a status text banner: _"Analysis complete — Good pronunciation"_. The REC indicator shows a static grey microphone.

### Evaluation

| Criterion | Score | Notes |
|-----------|-------|-------|
| **Readability** | ★★★★★ | Pixel art excels at silhouette clarity |
| **BEL fit** | ★★★★☆ | Retro aesthetic contrasts with BEL's modern Outfit typography but slate/violet palette aligns |
| **Production cost** | ★★★★★ | Pixel sprites are fast to produce and consistent |
| **Sprite consistency** | ★★★★★ | Pixel art's constrained palette ensures consistency across poses |
| **Mobile crop safety** | ★★★★★ | Chunky sprites remain readable at very small sizes |
| **Speaking/listening clarity** | ★★★★☆ | Clear poses but limited facial expression for speaking states |

---

## Option 2 — Illustrated 2D Cutout / Fantasy

### Concept

Layered illustrated characters with paper-doll anchor points on a watercolor-wash training dojo background. Card-game energy: action buttons styled as illustrated fantasy cards. Rich textures, warm amber lighting blended with cool cyan/violet magical effects. Characters have clear limb pivots for future animation. The microphone is an ornate glowing orb.

### Desktop (≥ 1024 px)

A warm-toned dojo interior serves as the battle stage. The hero (left) wields a speaking staff with violet energy swirls. The training golem (right) has articulated moss-covered limbs. Ornate illustrated health bars with character portraits. Three illustrated card buttons at center-bottom: **Attack · Block · Parry**. A glowing voice-command orb below the cards.

### Mobile (360 px)

Characters stack tighter with perspective foreshortening. Health bars simplify to compact top bars with small portraits. Action cards become full-width stacked buttons. The microphone orb sits at the bottom. Readable but loses some illustrated detail at small size.

### Reduced Motion / Static

Characters display in neutral standing poses — no energy effects, no particle animations, no glowing. Health bars are solid-filled with no shimmer. Action cards are flat (no hover/glow effects). A status text banner conveys outcomes as plain text. The microphone orb turns grey/inactive. All combat results communicated through text labels and static icons.

### Evaluation

| Criterion | Score | Notes |
|-----------|-------|-------|
| **Readability** | ★★★★☆ | Rich detail is beautiful but dense at small sizes |
| **BEL fit** | ★★★☆☆ | Fantasy/card aesthetic diverges from BEL's clean modern language |
| **Production cost** | ★★☆☆☆ | Illustrated assets are expensive to produce consistently |
| **Sprite consistency** | ★★★☆☆ | Maintaining illustrated style across many poses is challenging |
| **Mobile crop safety** | ★★★☆☆ | Detail loss on small screens; cropping cuts into composition |
| **Speaking/listening clarity** | ★★★★☆ | Expressive characters but speaking state may be lost in visual noise |

---

## Option 3 — Minimal Luminous Training Arena

### Concept

Restrained geometric forms on a dark slate stage with subtle grid lines. The hero is an abstract cyan humanoid silhouette with waveform energy pulses emanating from the throat area — directly encoding pronunciation/speaking as a visual mechanic. The enemy is a geometric violet angular construct. Health/energy bars are thin gradient lines. Action buttons are minimal rounded capsules with subtle glow borders. A center waveform visualization shows the real-time audio/pronunciation state. Maximum clarity for speaking and listening outcomes.

### Desktop (≥ 1024 px)

Dark slate background with a perspective grid floor. Cyan hero silhouette (left) with concentric sound-wave rings around the head. Violet geometric enemy (right) with angular crystalline form. A waveform visualization floats between them, showing pronunciation amplitude. Thin health/energy bars top-left and top-right. Three capsule buttons at bottom: **Attack · Block · Parry**. A waveform microphone indicator at bottom-center.

### Mobile (360 px)

The geometric forms scale cleanly due to their vector-like nature. Grid lines simplify. Health bars remain thin and elegant. The waveform visualization compresses horizontally. Action buttons fill full width with subtle glow borders. The microphone indicator integrates below the action row. Clean and readable at any size.

### Reduced Motion / Static

The cyan silhouette stands perfectly still — no glow pulses, no sound-wave emanations. The violet enemy stands motionless. The center waveform shows a flat static line (frozen pronunciation snapshot). Health bars are solid fills with no shimmer. Action buttons have static borders with no glow animation. A text status area clearly shows combat outcomes. All information conveyed through shape, position, and text — zero motion.

### Evaluation

| Criterion | Score | Notes |
|-----------|-------|-------|
| **Readability** | ★★★★★ | Minimal forms = maximum clarity |
| **BEL fit** | ★★★★★ | Dark slate + clean geometry perfectly matches BEL's modern design system |
| **Production cost** | ★★★★☆ | Abstract forms are easier to produce but require design precision |
| **Sprite consistency** | ★★★★★ | Geometric/abstract style is inherently consistent |
| **Mobile crop safety** | ★★★★★ | Vector-like forms scale perfectly to any size |
| **Speaking/listening clarity** | ★★★★★ | Waveform-led design directly encodes pronunciation state |

---

## Comparison Matrix

| Criterion | Pixel-Art RPG | Illustrated Cutout | Luminous Arena |
|-----------|:---:|:---:|:---:|
| Readability | ★★★★★ | ★★★★☆ | ★★★★★ |
| BEL design fit | ★★★★☆ | ★★★☆☆ | ★★★★★ |
| Production cost | ★★★★★ | ★★☆☆☆ | ★★★★☆ |
| Sprite consistency | ★★★★★ | ★★★☆☆ | ★★★★★ |
| Mobile crop safety | ★★★★★ | ★★★☆☆ | ★★★★★ |
| Speaking/listening clarity | ★★★★☆ | ★★★★☆ | ★★★★★ |
| **Total** | **28/30** | **20/30** | **29/30** |

---

## Recommendation: Option 3 — Minimal Luminous Training Arena

**Option 3** is the recommended direction based on the following reasoning:

1. **BEL design alignment**: The dark slate surfaces, geometric clarity, and Outfit typography integrate seamlessly with the existing BEL design system. No aesthetic friction.

2. **Pronunciation-state clarity**: The waveform-led design directly encodes speaking and listening as first-class visual elements — the hero's throat-emanating sound waves make pronunciation the visible mechanic, not a hidden input behind a combat metaphor.

3. **Mobile-first excellence**: Abstract geometric forms scale perfectly to 360 px without detail loss. No cropping compromises. The waveform visualization works at any width.

4. **Production feasibility**: Abstract/geometric sprites are inherently consistent and reproducible by Gemini 3.7 Flash. Character-reference sheets are simpler to maintain than detailed illustrated assets.

5. **Accessibility strength**: High-contrast cyan/violet on dark slate naturally achieves WCAG-AA. Shape-based distinctions (geometric vs. organic forms) provide non-color-only differentiation. The static fallback is clean and unambiguous.

6. **Reduced-motion grace**: The static version of Option 3 is the most readable of all three options — it looks intentionally designed rather than "animation turned off."

Option 1 (Pixel-Art) is the runner-up — excellent readability and production efficiency, but the retro aesthetic may feel disconnected from BEL's modern design language. If the team wants a warmer, more character-driven feel, Option 1 is the fallback.

Option 2 (Illustrated) is not recommended — the production cost is prohibitively high for consistent multi-pose character generation, and the rich detail competes with pronunciation-state clarity on mobile.

---

> [!IMPORTANT]
> **Approval required**: Select one direction before Phase 2 (full design package) proceeds. Reply with your choice, or request modifications to any option.
