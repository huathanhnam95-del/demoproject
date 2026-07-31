---
name: mobile-testing
description: Testing and optimizing mobile web app UI/UX including responsive design, touch interactions, and cross-device verification. Use when testing mobile layouts, fixing touch issues, or verifying responsive behavior.
---

# Mobile Testing Skill

This skill covers **mobile web app testing** and optimization for the dictation practice app.

---

## Testing Devices Matrix

| Category | Devices to Test |
| :--- | :--- |
| **iOS** | iPhone SE (375px), iPhone 14 (390px), iPhone 14 Pro Max (430px), iPad (768px) |
| **Android** | Pixel 5 (393px), Samsung Galaxy S21 (360px), Galaxy Tab (800px) |
| **Breakpoints** | 320px, 375px, 414px, 768px, 1024px, 1280px |

---

## Chrome DevTools Testing

### Device Mode Setup

1. Open DevTools (F12)
2. Click "Toggle Device Toolbar" (Ctrl+Shift+M)
3. Select device or set custom dimensions
4. Toggle "Rotate" for orientation testing

### Network Throttling

```javascript
// Simulate slow connections
// DevTools > Network tab > Throttling dropdown
// - Slow 3G: 500ms latency, 500 Kbps
// - Fast 3G: 100ms latency, 1.5 Mbps
// - Offline: Test offline behavior
```

### Touch Events

```javascript
// Enable touch emulation in DevTools
// Settings > Devices > Enable touch
// Verify: touch events trigger, no hover-dependent UI
```

---

## Responsive Layout Tests

### Viewport Meta Tag

```html
<!-- Required in index.html -->
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
```

### CSS Breakpoint Testing

```css
/* Test each breakpoint */
@media (max-width: 480px) { /* Mobile portrait */ }
@media (max-width: 768px) { /* Tablet/mobile landscape */ }
@media (max-width: 1024px) { /* Tablet landscape */ }
```

### Common Layout Issues

| Issue | Symptom | Fix |
| :--- | :--- | :--- |
| Horizontal scroll | Content wider than viewport | Use `max-width: 100%`, check fixed widths |
| Text too small | Hard to read | Use `16px` minimum font size |
| Elements overlap | Z-index conflicts | Check stacking context |
| Content cut off | Overflow hidden | Use `overflow: auto` where needed |

---

## Touch Testing Checklist

### Touch Targets

```javascript
// Minimum touch target size: 48x48px (44x44px iOS minimum)
function validateTouchTargets() {
    const buttons = document.querySelectorAll('button, a, [onclick]');
    buttons.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 44) {
            console.warn('Touch target too small:', el);
        }
    });
}
```

### Touch Event Testing

```javascript
// Test touch instead of click
element.addEventListener('touchstart', (e) => {
    console.log('Touch started:', e.touches);
});

element.addEventListener('touchend', (e) => {
    console.log('Touch ended');
});

// Verify no 300ms delay
// Use touch-action: manipulation or fastclick
```

---

## Orientation Testing

```javascript
// Test landscape/portrait switching
window.addEventListener('orientationchange', () => {
    console.log('Orientation:', screen.orientation.type);
    // Verify layout adapts
});

// CSS for orientation
@media (orientation: landscape) {
    .practice-area {
        flex-direction: row;
    }
}
```

---

## Performance Testing

### Mobile Performance Budget

| Metric | Target | Tool |
| :--- | :--- | :--- |
| First Contentful Paint | < 1.8s | Lighthouse |
| Largest Contentful Paint | < 2.5s | Lighthouse |
| Time to Interactive | < 3.9s | Lighthouse |
| Total Bundle Size | < 500KB | DevTools |

### Testing Commands

```bash
# Run Lighthouse audit
npx lighthouse https://localhost:8443 --view

# Check bundle size
npm run build && du -sh dist/
```

---

## Audio Testing on Mobile

### Microphone Access

```javascript
// Test on actual device - simulators may not work
async function testMicrophoneAccess() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('✅ Microphone access granted');
        stream.getTracks().forEach(track => track.stop());
    } catch (err) {
        console.error('❌ Microphone access denied:', err);
    }
}
```

### Audio Playback

```javascript
// iOS requires user interaction for audio
document.addEventListener('touchstart', () => {
    const audio = new Audio();
    audio.play().catch(() => {});
}, { once: true });
```

---

## Testing Automation

### Playwright Mobile Testing

```javascript
import { test, devices } from '@playwright/test';

const iPhone = devices['iPhone 13'];

test.use({ ...iPhone });

test('mobile dictation flow', async ({ page }) => {
    await page.goto('https://localhost:8443');
    
    // Verify mobile layout
    await expect(page.locator('.mobile-nav')).toBeVisible();
    
    // Test touch interaction
    await page.tap('#play-btn');
    
    // Verify audio plays
    await expect(page.locator('.audio-status')).toHaveText('Playing');
});
```

---

## Mobile Testing Checklist

### Layout

- [ ] No horizontal scrolling at any breakpoint
- [ ] Text readable without zooming (minimum 16px)
- [ ] Images scale properly
- [ ] Modals fit on screen

### Touch

- [ ] All buttons at least 44x44px
- [ ] Adequate spacing between touch targets
- [ ] No hover-only interactions
- [ ] Forms have proper keyboard types

### Performance

- [ ] Loads under 3s on 3G
- [ ] Animations smooth (60fps)
- [ ] No memory leaks during recording

### Audio

- [ ] Microphone permission prompt appears
- [ ] Recording works on iOS and Android
- [ ] Playback works without user gesture issues
