---
name: motion-design
description: Motion design and animation principles for web UI. Use when creating loading animations, entrance transitions, progress indicators, or when timing and easing of UI animations needs expert guidance.
---

# Motion Design for Web UI

## Purpose

Expert guidance for creating purposeful, engaging animations that enhance user experience without becoming distracting. Covers loading screens, entrance animations, progress indicators, and timing principles.

## Loading Screen Animation Principles

### The 3-Second Rule

- Users perceive waits under 1s as instant
- 1-3s: "Something is happening" — show subtle motion
- 3-5s: "I'm waiting" — show progress + engaging animation
- 5s+: Risk of abandonment — add content or interaction

### Engagement Without Distraction

1. **Single focal point**: One main animated element, not many competing ones
2. **Smooth, continuous motion**: Avoid jarring starts/stops
3. **Purposeful pace**: Not too fast (frenetic), not too slow (boring)
4. **Anticipation**: Build toward a reveal, not just loop

## Easing Functions

### For Loading Animations

```javascript
// Smooth sine wave (continuous, organic)
const ease = Math.sin(time * speed) * amplitude;

// Ease-in-out cubic (smooth start/end)
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Spring-like overshoot (energetic entrance)
function springEase(t, damping = 0.6) {
  return 1 - Math.exp(-6 * t) * Math.cos(12 * t * damping);
}
```

### For Progress Bars

```javascript
// Simulated progress (fills smoothly even without real data)
function simulatedProgress(elapsed, minDuration) {
  const t = Math.min(elapsed / minDuration, 1.0);
  // Ease-out: fast start, slow finish (feels responsive)
  return 1 - Math.pow(1 - t, 3);
}
```

## Three.js Camera Animation Patterns

### Approach (Zoom In)

```javascript
// Camera starts far, moves to hero position
const progress = easeInOutCubic(elapsed / duration);
camera.position.lerpVectors(startPos, endPos, progress);
camera.lookAt(target);
```

### Orbit (Continuous)

```javascript
// Gentle continuous orbit for visual interest
const angle = time * rotationSpeed;
camera.position.x = Math.cos(angle) * radius;
camera.position.z = Math.sin(angle) * radius;
camera.lookAt(center);
```

### Drift (Subtle)

```javascript
// Very subtle position drift for "alive" feeling
camera.position.x += Math.sin(time * 0.3) * 0.002;
camera.position.y += Math.cos(time * 0.2) * 0.001;
```

## Progress Bar Animation

```css
/* Smooth fill with glow */
.progress-fill {
  transition: width 0.15s ease-out;
  background: linear-gradient(90deg, #1a73e8, #4285f4);
  box-shadow: 0 0 12px rgba(26, 115, 232, 0.4);
}

/* Shimmer overlay for activity indication */
.progress-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
```

## Entrance-to-Content Transition

```javascript
// Fade out loader, reveal content
function transitionOut(duration = 600) {
  preloader.style.transition = `opacity ${duration}ms ease-in-out`;
  preloader.style.opacity = '0';
  setTimeout(() => {
    preloader.style.display = 'none';
    content.style.opacity = '1';
  }, duration);
}
```

## Anti-Patterns to Avoid

- ❌ Multiple competing animations
- ❌ Rotation speed > 0.02 radians/frame (feels hyperactive)
- ❌ Pure white flash during transitions
- ❌ Abrupt start/stop without easing
- ❌ Loading text that changes too frequently
- ❌ Progress bar that jumps backward
