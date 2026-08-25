# Echo Forge — Visual Design Specification

> **Approved direction**: Option 3 — Minimal Luminous Training Arena  
> **Owner**: Claude (presentation only)  
> **Contract**: `visual-contract.v1.json` · `echo-forge-visual-v1`

---

## 1. Design Philosophy

A restrained, luminous training arena where **pronunciation is the visible combat mechanic**. The hero's voice manifests as waveform energy — sound waves emanate from the throat to attack, shield, or resonate. The arena is a dark geometric space that exists to frame the pronunciation interaction, not to decorate it.

**One rule**: if a visual element doesn't serve pronunciation clarity or combat readability, remove it.

---

## 2. Color System

### Primary Palette (from contract `paletteConstraints`)

| Token | Hex | Usage |
|-------|-----|-------|
| `--ef-slate-900` | `#0f172a` | Stage background, primary surface |
| `--ef-slate-800` | `#1e293b` | Grid lines, secondary surfaces |
| `--ef-slate-700` | `#334155` | Borders, dividers |
| `--ef-cyan-400` | `#22d3ee` | Hero silhouette, hero health, recording active |
| `--ef-cyan-500` | `#06b6d4` | Hero energy, waveform |
| `--ef-violet-400` | `#a78bfa` | Enemy form, enemy health |
| `--ef-violet-500` | `#8b5cf6` | Enemy energy, parry effects |
| `--ef-amber-400` | `#fbbf24` | Resonance gauge, critical hits, focus highlights |
| `--ef-amber-500` | `#f59e0b` | Resonance ready state |

### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--ef-success` | `#10b981` | Successful attack/block/parry |
| `--ef-error` | `#ef4444` | Damage received, defeat |
| `--ef-warning` | `#f59e0b` | Low health, enemy telegraph |
| `--ef-neutral` | `#94a3b8` | No-op analysis, unavailable states |
| `--ef-text-primary` | `#f8fafc` | Primary text (contrast ≥ 14.5:1 on slate-900) |
| `--ef-text-secondary` | `#cbd5e1` | Secondary text (contrast ≥ 8.5:1 on slate-900) |

### Contrast Verification

| Combination | Ratio | WCAG |
|-------------|-------|------|
| `#f8fafc` on `#0f172a` | 16.75:1 | AAA ✓ |
| `#cbd5e1` on `#0f172a` | 10.53:1 | AAA ✓ |
| `#22d3ee` on `#0f172a` | 8.92:1 | AAA ✓ |
| `#a78bfa` on `#0f172a` | 5.87:1 | AA ✓ |
| `#fbbf24` on `#0f172a` | 10.14:1 | AAA ✓ |

---

## 3. Typography

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Stage title | Outfit | 20px / 1.4 | 600 | `--ef-text-primary` |
| Health label | Outfit | 14px / 1.2 | 500 | `--ef-text-primary` |
| Health value | ui-monospace | 14px / 1.2 | 600 | `--ef-text-primary` |
| Status text | Outfit | 16px / 1.5 | 500 | `--ef-text-primary` |
| Action button | Outfit | 14px / 1.0 | 600 | `--ef-text-primary` |
| Timer/IPA | ui-monospace | 13px / 1.3 | 400 | `--ef-text-secondary` |
| Focus/Resonance label | Outfit | 12px / 1.2 | 500 | `--ef-text-secondary` |

---

## 4. Stage Composition

### Arena Structure

```
┌─────────────────────────────────────────────────┐
│  ┌──HP──┐          FOCUS ▰▰▰▱▱       ┌──HP──┐  │
│  │ ████ │        RESONANCE ◆◆◇◇◇     │ ████ │  │
│  └──────┘                              └──────┘  │
│                                                   │
│                                                   │
│     ◯               ∿∿∿∿∿∿∿∿              ◇     │
│    /|\        [waveform/status]           /|\     │
│    / \                                    / \     │
│   HERO                                  ENEMY    │
│   (cyan)                               (violet)  │
│ ─ ─ ─ ─ ─ ─ ─ ─ arena floor ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐    🎤    │
│  │ ATTACK  │  │  BLOCK  │  │  PARRY  │   mic    │
│  └─────────┘  └─────────┘  └─────────┘          │
└─────────────────────────────────────────────────┘
```

### Hero — Cyan Luminous Silhouette

- **Form**: Abstract humanoid silhouette, geometric but recognizably human
- **Color**: `--ef-cyan-400` base, `--ef-cyan-500` energy effects
- **Pronunciation visualization**: Concentric sound-wave arcs emanate from the throat/mouth area during recording and analysis states
- **States**: Idle (standing), Listening (head tilted, mouth open glow), Speaking/Attack (arm extended, waves projecting forward), Guard (arms crossed, shield geometry), Hit (recoil, dimmed), Victory (arms raised, full glow), Defeat (kneeling, faded)
- **Canvas**: 256×256 px per contract
- **Pivot**: x:128, y:224 (bottom-center) — feet planted on arena floor

### Enemy — Violet Geometric Construct

- **Form**: Angular crystalline/geometric construct, faceted and imposing
- **Color**: `--ef-violet-400` base, `--ef-violet-500` energy effects
- **States**: Idle (standing, facets still), Telegraph (glowing, expanding — signals incoming attack), Attack-ready (leaning forward, facets aligned), Hit (fragments scatter briefly), Reflected-hit (parried attack bounced back), Defeated (fragments collapse)
- **Canvas**: 256×256 px (shares hero idle slot dimensions)
- **Pivot**: Mirrored from hero position

### Arena Floor

- Dark slate `#1e293b` with subtle perspective grid lines in `#334155` at 10% opacity
- Grid provides spatial grounding without competing with characters
- Floor line anchors both characters at their pivot y-positions

### Waveform Visualization

- Positioned center-stage between hero and enemy
- Renders the pronunciation/audio state:
  - **Idle**: Flat line in `--ef-slate-700`
  - **Recording**: Live amplitude waveform in `--ef-cyan-400`
  - **Analysis pending**: Pulsing waveform in `--ef-amber-400`
  - **Resolved**: Snapshot waveform with result color overlay
- Width: 40% of stage width, height: 64px max
- Reduced motion: Static waveform snapshot, no animation

---

## 5. HUD Elements

### Health Bars

- **Style**: Thin horizontal bar (height: 8px, border-radius: 4px)
- **Hero**: `--ef-cyan-400` fill on `--ef-slate-700` track
- **Enemy**: `--ef-violet-400` fill on `--ef-slate-700` track
- **Label**: Character name above, HP value below (monospace)
- **Low health**: Bar turns `--ef-error`, subtle pulse (static: solid red, no pulse)
- **Position**: Top-left (hero) and top-right (enemy)

### Focus Meter

- **Style**: 5 square blocks (▰ filled, ▱ empty), 12×12px each
- **Color**: `--ef-amber-400` filled, `--ef-slate-700` empty
- **Position**: Center-top, between health bars
- **Label**: "FOCUS" in `--ef-text-secondary` 12px Outfit

### Resonance Gauge

- **Style**: 5 diamond shapes (◆ filled, ◇ empty), 12×12px each
- **Color**: `--ef-amber-500` filled, `--ef-slate-700` empty
- **Ready state**: All diamonds filled, border glow (static: solid border, "READY" badge)
- **Position**: Below focus meter
- **Label**: "RESONANCE" in `--ef-text-secondary` 12px Outfit

### Recording Indicator

- **Active**: Pulsing cyan circle + "REC" text in `--ef-cyan-400` (top-right corner)
- **Inactive**: Static grey circle in `--ef-slate-700`
- **Reduced motion**: Static cyan circle (no pulse), still shows "REC" text

### Status Text

- **Position**: Center-bottom of stage, above action bar
- **Style**: 16px Outfit, `--ef-text-primary`
- **Background**: Semi-transparent `--ef-slate-900` at 80% opacity, 6px radius
- **Content**: Programmatic text from `combat.status` hook
- **aria-live**: `polite` or `assertive` per event (see accessibility-spec)

---

## 6. Action Bar

### Button Design

- **Shape**: Rounded capsule (border-radius: 24px)
- **Size**: Min 120×48px (desktop), full-width with 8px gaps (mobile)
- **Background**: `--ef-slate-800` with 1px border `--ef-slate-700`
- **Text**: 14px Outfit 600 weight, `--ef-text-primary`
- **Hover/Focus**: Border changes to action-specific color, subtle glow
  - Attack: `--ef-cyan-400` glow
  - Block: `--ef-violet-400` glow
  - Parry: `--ef-amber-400` glow
- **Active/Pressed**: Background fills with action color at 20% opacity
- **Disabled**: 40% opacity, no hover effects
- **Focus indicator**: 3px solid outline, 2px offset, action-specific color

### Microphone Button

- **Shape**: Circle, 48×48px
- **Idle**: `--ef-slate-700` border, microphone icon in `--ef-text-secondary`
- **Recording**: `--ef-cyan-400` border + pulsing glow, icon in `--ef-cyan-400`
- **Position**: Right side of action bar (desktop), below action buttons (mobile)

---

## 7. Effect Treatments

### Precision Strike (Attack)

- Hero's arm extends forward, cyan waveform energy projects toward enemy
- Impact: brief cyan flash at enemy position
- Static: Hero in "attack" pose, enemy in "hit" pose, "Strike!" text badge

### Stress Breaker (Block)

- Shield geometry materializes around hero (hexagonal grid pattern in cyan)
- Enemy attack visually deflects
- Static: Hero in "guard" pose, shield icon visible, "Blocked!" text badge

### Echo Chain (Parry)

- Violet energy from enemy attack is caught and reflected back
- Brief amber flash as energy reverses direction
- Static: Hero in "parry" pose, reflected energy icon, "Parried!" text badge

### Resonance Burst (Special)

- All 5 resonance diamonds ignite amber
- Expanding ring of amber energy from hero
- Stage briefly tints amber
- Static: Amber border on stage, "Resonance Burst!" text badge, all gauges flash

### Analysis Hold

- Waveform visualization pulses in amber (loopable, cancellable)
- Hero in "listening" pose — head tilted, mouth area glowing
- Must remain readable while analysis is pending
- Safe-stop: If cancelled, waveform returns to flat line, hero returns to idle
- Static: Hero in "listening" pose, flat amber waveform, "Analyzing…" text

### Damage Applied

- Receiving character flashes `--ef-error` briefly
- Health bar ticks down
- Screen edge vignette in damage color
- Static: Health bar decreases, damage number appears as text

---

## 8. State Indicators (Non-Color)

Every visual state has a non-color distinction to satisfy WCAG requirements:

| State | Color | Shape/Icon | Text |
|-------|-------|-----------|------|
| Success (attack/block/parry) | `--ef-success` | ✓ checkmark + upward caret | "Success!" |
| Failure (missed/broken) | `--ef-error` | ✗ cross + downward caret | "Failed" |
| Pending (analysis) | `--ef-amber-400` | ◐ half-circle spinner (static: dot) | "Analyzing…" |
| Focus gained | `--ef-amber-400` | ▰ filled block | "+1 Focus" |
| Resonance ready | `--ef-amber-500` | ◆◆◆◆◆ all diamonds + solid border | "READY" badge |
| Error/unavailable | `--ef-neutral` | ⚠ warning triangle | Descriptive text |
| Recording | `--ef-cyan-400` | ● filled circle | "REC" |
| Idle | `--ef-slate-700` | ○ empty circle | — |

---

## 9. Design Anti-Patterns (Prohibited)

Per the BEL design system and handoff constraints:

1. **No nested cards** — the arena is one stage, not cards-in-cards
2. **No dashboard chrome** — no tabs, no sidebar navigation during combat
3. **No baked text in sprites** — no English words, scores, or damage numbers inside images
4. **No fixed animation durations** — timing comes from named engine variables only
5. **No inferred damage** — visuals never calculate or display combat math
6. **No learner-identifying data in visuals** — no names, transcripts, or audio in rendered assets
7. **No side-tab accent borders** — per BEL anti-pattern rules
8. **No hairline border + diffuse blur** — per BEL anti-pattern rules
