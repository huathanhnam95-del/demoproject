# Echo Forge — No-Animation Timing Sandbox Report

> **Date**: 2026-08-23  
> **Prototype**: `docs/echo-forge/claude/prototype/index.html`  
> **Art direction**: Option 3 — Minimal Luminous Training Arena (approved)  
> **Method**: Static-first prototype verified in browser with manual event cycling

---

## 1. Sandbox Overview

The timing sandbox is the interactive static prototype located at [`prototype/index.html`](file:///C:/Cursor%20AI-echo-forge-sandbox/docs/echo-forge/claude/prototype/index.html). It renders all 21 contract events using **static fallback frames only** — no production animation timings are baked in. All timing is expressed through named variables (`motion.idle`, `motion.windUp`, `motion.analysisHold`, `motion.resultResolve`, `motion.returnToIdle`) that the engine will supply at runtime.

### What was tested

- All 21 contract events cycled via the event selector and keyboard arrows
- Desktop layout (≥1024 px viewport)
- Mobile layout (360 px viewport via browser responsive mode)
- Reduced-motion toggle (simulates `prefers-reduced-motion: reduce`)
- Keyboard navigation through all interactive controls
- ARIA live region announcements (verified via browser accessibility inspector)
- Action button flows (Attack → Recording → Analysis → Result)

---

## 2. Static State Timing Observations

Each state was displayed statically. The following observations inform the timing variables the engine should provide:

### Transition Points

| From → To | Observation | Timing Guidance |
|-----------|-------------|-----------------|
| **idle → windUp** | Instant in prototype. Production should have a brief anticipation (100–300 ms recommended) to signal "action incoming" before the recording/analysis phase. | `motion.windUp.enter` |
| **windUp → analysisHold** | Instant in prototype. The transition should be smooth — the hero's pose shifts from "anticipation" to "listening/processing." Recommend ≤200 ms crossfade. | `motion.analysisHold.enter` |
| **analysisHold loop** | Static frame 0 (hold-1) displayed indefinitely in prototype. Production loop through 4 frames at a pace that conveys "processing" without urgency. Recommend 600–900 ms per full cycle. The loop MUST remain readable — hero silhouette and status text visible through the effect at all times. | `motion.analysisHold.cycleDuration` |
| **analysisHold → resolve** | Instant in prototype. Critical transition — analysis result becomes visible. Recommend ≤150 ms to maintain responsiveness. No delay between analysis.resolved event and visual feedback. | `motion.resultResolve.enter` |
| **resolve hold** | Static frame 1 (resolve) displayed in prototype. Production should hold the result frame long enough for the player to read the status text. Recommend 800–1200 ms minimum hold. | `motion.resultResolve.holdDuration` |
| **resolve → returnToIdle** | Instant in prototype. A gentle 300–500 ms ease-out return to idle prevents jarring state changes. | `motion.returnToIdle.duration` |
| **analysisHold → safe-stop** | Instant in prototype. If analysis fails or is cancelled, the hold loop must stop within a single frame (≤16 ms at 60 fps). Display static fallback frame 0 immediately. | `motion.analysisHold.safeStopMax` |

### HUD Timing

| Element | Observation | Timing Guidance |
|---------|-------------|-----------------|
| **Health bar decrease** | Instant in prototype. Production should use a smooth fill transition (300–500 ms) to make damage visible. | `hud.healthBar.transitionDuration` |
| **Focus pip fill** | Instant in prototype. A brief pop (150–200 ms scale-up) would add satisfying feedback. | `hud.focusPip.fillDuration` |
| **Resonance pip fill** | Instant in prototype. Similar pop to focus. When all 5 fill (resonance.ready), a brief amber pulse (400 ms) signals readiness. | `hud.resonancePip.fillDuration` |
| **Recording indicator pulse** | CSS animation at 1.5 s cycle in prototype. Appropriate for production. | `hud.recordingIndicator.pulseCycle` |
| **Result flash overlay** | 600 ms in prototype. Appropriate — long enough to notice, short enough to not obstruct. | `hud.resultFlash.duration` |

### Waveform Visualization

| State | Observation | Timing Guidance |
|-------|-------------|-----------------|
| **Idle** | Flat 4 px bars. Instant reset. | No timing needed |
| **Recording** | 100 ms random bar height updates in prototype. Production should match actual audio amplitude if available, or use this randomized fallback. | `waveform.recording.updateInterval` |
| **Analyzing** | Same 100 ms cycle but in amber. Could be slightly slower (150–200 ms) to differentiate from recording. | `waveform.analyzing.updateInterval` |
| **Reduced motion** | Static snapshot of bars at varied heights. No animation. | N/A |

---

## 3. Readability Assessment

### Desktop (1200 px viewport)

| Element | Readability | Notes |
|---------|-------------|-------|
| Hero silhouette | ✅ Excellent | Cyan on dark slate, clear geometric form |
| Enemy silhouette | ✅ Excellent | Violet on dark slate, distinct from hero |
| Health bars | ✅ Excellent | Thin but colored fills are highly visible |
| Focus/Resonance pips | ✅ Good | 12×12 px, amber on dark — visible but small |
| Status text | ✅ Excellent | 14 px Outfit on semi-transparent slate, centered |
| Action buttons | ✅ Excellent | 120×48 px capsules, clear labels, visible borders |
| Waveform | ✅ Good | 40% width, cyan/amber bars clearly visible between characters |
| Recording indicator | ✅ Good | Top-right corner, "REC" text with cyan dot |

### Mobile (360 px viewport)

| Element | Readability | Notes |
|---------|-------------|-------|
| Hero silhouette | ✅ Good | Scaled to 56×112 px — still recognizable |
| Enemy silhouette | ✅ Good | Scaled to 60×105 px — still distinct |
| Health bars | ✅ Good | Full width at reduced size |
| Focus/Resonance pips | ⚠ Adequate | 12×12 px pips are small at mobile; consider 14 px for Stage B |
| Status text | ✅ Good | 13 px, full width |
| Action buttons | ✅ Excellent | Full width, 3 buttons with 8 px gaps, all ≥44 px tall |
| Mic button | ✅ Good | Full width, 44 px tall |
| Waveform | ✅ Good | 50% width, compressed but visible |

### Reduced Motion

| Element | Readability | Notes |
|---------|-------------|-------|
| All states | ✅ Excellent | Static frames are clean and intentional — not "broken animation" |
| Status text | ✅ Excellent | Becomes the primary information channel |
| Health bars | ✅ Good | Instant transitions work fine |
| Waveform | ✅ Good | Static snapshot clearly shows "something happened" |

---

## 4. Accessibility Verification

| Check | Result | Notes |
|-------|--------|-------|
| ARIA live region present | ✅ | `#ef-aria-live` with polite/assertive switching |
| role=application on stage | ✅ | With `aria-roledescription="battle arena"` |
| role=progressbar on health bars | ✅ | With valuenow/valuemin/valuemax |
| role=meter on focus/resonance | ✅ | With aria-label |
| Keyboard tab through controls | ✅ | Attack → Block → Parry → Mic → Event select → Prev → Next → Reduced motion |
| Focus indicator visible | ✅ | 3px solid amber outline, 2px offset |
| All targets ≥44×44 px | ✅ | Action buttons 120×48, mic 48×48, mobile buttons full-width×44+ |
| Reduced motion toggle works | ✅ | Disables all CSS animations and JS waveform updates |
| Status text for every event | ✅ | 21/21 events have status text |
| Neutral error framing | ✅ | analysis.noop: "no combat judgment was made" |

---

## 5. Timing Variable Recommendations

Based on the static sandbox observations, here are the recommended timing variable defaults for the engine. These are **suggestions only** — the engine supplies the actual values.

```json
{
  "motion.windUp.enter": { "suggested": 200, "unit": "ms", "notes": "Brief anticipation" },
  "motion.analysisHold.enter": { "suggested": 150, "unit": "ms", "notes": "Smooth crossfade to hold" },
  "motion.analysisHold.cycleDuration": { "suggested": 750, "unit": "ms", "notes": "4-frame loop, ~187ms/frame" },
  "motion.analysisHold.safeStopMax": { "suggested": 16, "unit": "ms", "notes": "Single frame at 60fps" },
  "motion.resultResolve.enter": { "suggested": 100, "unit": "ms", "notes": "Snappy result reveal" },
  "motion.resultResolve.holdDuration": { "suggested": 1000, "unit": "ms", "notes": "Hold result for reading" },
  "motion.returnToIdle.duration": { "suggested": 400, "unit": "ms", "notes": "Gentle ease-out" },
  "hud.healthBar.transitionDuration": { "suggested": 400, "unit": "ms", "notes": "Smooth health decrease" },
  "hud.focusPip.fillDuration": { "suggested": 180, "unit": "ms", "notes": "Brief pop" },
  "hud.resonancePip.fillDuration": { "suggested": 180, "unit": "ms", "notes": "Brief pop" },
  "hud.recordingIndicator.pulseCycle": { "suggested": 1500, "unit": "ms", "notes": "Relaxed pulse" },
  "hud.resultFlash.duration": { "suggested": 600, "unit": "ms", "notes": "Noticeable but brief" },
  "waveform.recording.updateInterval": { "suggested": 100, "unit": "ms", "notes": "Match audio if available" },
  "waveform.analyzing.updateInterval": { "suggested": 150, "unit": "ms", "notes": "Slower than recording" }
}
```

---

## 6. Conclusion

The no-animation timing sandbox confirms that:

1. **All 21 contract events render correctly** with static fallback frames
2. **The stage composition is readable** at both desktop and 360 px mobile viewports
3. **Reduced-motion mode is fully functional** and visually intentional
4. **Accessibility requirements are met** (ARIA, keyboard, contrast, target sizes)
5. **The recommended art direction (Option 3) works** — cyan/violet luminous silhouettes on dark slate provide maximum pronunciation-state clarity
6. **Timing variables are identified** but not fixed — the engine supplies actual values

> **Gate passed**: The static sandbox is verified. Written approval for the art direction and draft Gemini request has been given. The finalized v1 versions of `motion-spec.v1.json` and `gemini-asset-request.v1.json` may now be published.
