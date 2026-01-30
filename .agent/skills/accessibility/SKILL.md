---
name: accessibility
description: Web accessibility (a11y) patterns for keyboard navigation, screen readers, and WCAG compliance. Use when ensuring the app is usable by people with disabilities.
---

# Accessibility (a11y) Skill

This skill covers **accessibility best practices** to ensure the dictation practice app is usable by everyone.

---

## Quick Wins Checklist

- [ ] All images have `alt` attributes
- [ ] Color contrast ratio ≥ 4.5:1 for text
- [ ] All interactive elements are keyboard accessible
- [ ] Focus states are visible
- [ ] Form inputs have associated labels
- [ ] Page has proper heading hierarchy (h1 → h2 → h3)
- [ ] Modals trap focus and return it on close

---

## Keyboard Navigation

### Focus Management

```javascript
// Trap focus in modal
function trapFocus(modal) {
    const focusable = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
        
        if (e.key === 'Escape') {
            closeModal();
        }
    });
    
    first.focus();
}
```

### Skip Links

```html
<a href="#main-content" class="skip-link">Skip to main content</a>

<style>
.skip-link {
    position: absolute;
    top: -40px;
    left: 0;
    padding: 8px;
    background: #000;
    color: #fff;
    z-index: 100;
}
.skip-link:focus {
    top: 0;
}
</style>
```

---

## ARIA Patterns

### Buttons that aren't `<button>`

```html
<!-- ❌ Bad -->
<div onclick="doAction()">Click me</div>

<!-- ✅ Good -->
<div role="button" tabindex="0" onclick="doAction()" onkeydown="if(event.key==='Enter')doAction()">
    Click me
</div>

<!-- ✅ Best - just use a button -->
<button onclick="doAction()">Click me</button>
```

### Live Regions (Announcements)

```html
<!-- For status updates -->
<div aria-live="polite" aria-atomic="true" id="status">
    <!-- Dynamic content announced by screen readers -->
</div>
```

```javascript
function announceScore(score) {
    document.getElementById('status').textContent = 
        `Your pronunciation score is ${score} out of 100`;
}
```

### Modal Dialogs

```html
<div role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <h2 id="modal-title">Recording Complete</h2>
    <!-- Modal content -->
</div>
```

---

## Color Contrast

### Minimum Ratios (WCAG AA)

| Element | Ratio |
| :--- | :--- |
| Normal text | 4.5:1 |
| Large text (18px+ bold, 24px+) | 3:1 |
| UI components | 3:1 |

### Test Colors

```css
/* ✅ Good contrast */
.text-good {
    color: #1a1a2e;
    background: #f0f0f0;
    /* Ratio: ~12:1 */
}

/* ❌ Poor contrast */
.text-bad {
    color: #888;
    background: #aaa;
    /* Ratio: ~1.5:1 */
}
```

---

## Form Accessibility

```html
<!-- Always associate labels -->
<label for="word-input">Enter word:</label>
<input type="text" id="word-input" name="word">

<!-- Error messages -->
<input 
    type="text" 
    id="word-input" 
    aria-describedby="word-error"
    aria-invalid="true"
>
<span id="word-error" class="error">Please enter a valid word</span>

<!-- Required fields -->
<input type="text" required aria-required="true">
```

---

## Audio/Video Content

### Provide Controls

```html
<audio controls>
    <source src="audio.mp3" type="audio/mpeg">
    <p>Your browser doesn't support audio. <a href="audio.mp3">Download</a></p>
</audio>
```

### Transcripts/Captions

```javascript
// For pronunciation practice, show text alongside audio
function playWordAudio(word) {
    // Visual feedback for deaf/HoH users
    document.getElementById('current-word').textContent = word;
    document.getElementById('phonetic').textContent = getPhonetic(word);
    
    // Play audio
    audio.play();
}
```

---

## Testing Tools

### Browser Extensions

- **axe DevTools** - Automated accessibility testing
- **WAVE** - Visual accessibility checker
- **Color Contrast Analyzer** - Check color ratios

### Manual Testing

1. **Keyboard only**: Can you use all features without a mouse?
2. **Screen reader**: Does content make sense when read aloud?
3. **Zoom 200%**: Is content still usable when zoomed?
4. **No color**: Can you understand UI without color cues?

---

## Common Issues & Solutions

### Issue: Focus invisible on custom elements

```css
/* Add visible focus indicator */
.custom-button:focus {
    outline: 2px solid #667eea;
    outline-offset: 2px;
}
```

### Issue: Screen reader reads wrong order

```css
/* Use display order, not visual order */
.container {
    display: flex;
    flex-direction: column;
}
```

### Issue: Dynamic content not announced

```javascript
// Use aria-live region
liveRegion.textContent = 'New word loaded: ' + word;
```
