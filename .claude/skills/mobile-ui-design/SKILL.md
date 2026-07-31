---
name: mobile-ui-design
description: Mobile UI/UX design patterns for touch interfaces, gestures, and adapting web designs to mobile. Use when designing mobile-specific layouts or fixing mobile usability issues.
---

# Mobile UI Design Skill

This skill covers **mobile-specific UI/UX design** patterns for adapting the dictation practice web app to mobile devices.

---

## Thumb Zone Design

```text
┌─────────────────────────────┐
│      HARD TO REACH          │  ← Navigation menus
│         (top)               │
├─────────────────────────────┤
│                             │
│        OK ZONE              │  ← Content viewing
│        (middle)             │
│                             │
├─────────────────────────────┤
│                             │
│      EASY ZONE              │  ← Primary actions
│       (bottom)              │  ← Play, Record, Submit
│                             │
└─────────────────────────────┘
```

### Implementation

```css
/* Bottom navigation for primary actions */
.mobile-actions {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 16px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
    background: var(--bg-primary);
}

/* Keep primary buttons in thumb zone */
.record-btn {
    width: 72px;
    height: 72px;
    margin: 0 auto;
}
```

---

## Touch Target Guidelines

### Minimum Sizes

| Platform | Minimum Size | Recommended |
| :--- | :--- | :--- |
| iOS | 44 × 44 pt | 48 × 48 pt |
| Android | 48 × 48 dp | 56 × 56 dp |
| Web | 44 × 44 px | 48 × 48 px |

### Spacing Between Targets

```css
/* Minimum 8px between touch targets */
.button-group {
    gap: 12px;
}

/* Larger hit area with padding */
.icon-button {
    width: 44px;
    height: 44px;
    padding: 10px;
}
.icon-button svg {
    width: 24px;
    height: 24px;
}
```

---

## Touch Gestures Reference

| Gesture | Use For | Example |
| :--- | :--- | :--- |
| **Tap** | Primary actions | Play, submit, select |
| **Swipe left/right** | Navigation, delete | Next/prev word, archive |
| **Swipe up** | Reveal more content | Show full analysis |
| **Long press** | Secondary menu | More options |
| **Pinch** | Zoom | Pitch graph zoom |
| **Pull down** | Refresh | Reload word list |

### Gesture Implementation

```javascript
// Swipe detection
let touchStartX = 0;

element.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
});

element.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchEndX - touchStartX;
    
    if (Math.abs(diff) > 50) { // Minimum swipe distance
        if (diff > 0) {
            onSwipeRight();
        } else {
            onSwipeLeft();
        }
    }
});
```

---

## Mobile Navigation Patterns

### Bottom Tab Bar

```html
<nav class="bottom-tabs">
    <a href="#practice" class="tab active">
        <svg class="tab-icon"><!-- practice icon --></svg>
        <span class="tab-label">Practice</span>
    </a>
    <a href="#review" class="tab">
        <svg class="tab-icon"><!-- review icon --></svg>
        <span class="tab-label">Review</span>
        <span class="badge">4</span>
    </a>
    <a href="#progress" class="tab">
        <svg class="tab-icon"><!-- chart icon --></svg>
        <span class="tab-label">Progress</span>
    </a>
</nav>
```

```css
.bottom-tabs {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
}

.tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 4px;
    color: var(--text-muted);
}

.tab.active {
    color: var(--primary);
}
```

### Hamburger Menu

```javascript
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const overlay = document.getElementById('menu-overlay');
    
    menu.classList.toggle('open');
    overlay.classList.toggle('active');
    document.body.classList.toggle('menu-open');
}
```

---

## Mobile Form Design

### Input Optimization

```html
<!-- Numeric keyboard -->
<input type="number" inputmode="numeric" pattern="[0-9]*">

<!-- Email keyboard -->
<input type="email" autocomplete="email">

<!-- Disable autocorrect for dictation -->
<input 
    type="text" 
    autocomplete="off" 
    autocorrect="off" 
    autocapitalize="off"
    spellcheck="false"
>
```

### Keyboard Handling

```css
/* Prevent layout shift when keyboard opens */
.input-container {
    position: sticky;
    bottom: 0;
}

/* Adjust for iOS visual viewport */
@supports (height: 100dvh) {
    .app-container {
        height: 100dvh;
    }
}
```

---

## Mobile-First Responsive Patterns

### Cards to Full Width

```css
/* Desktop: card grid */
.word-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
}

/* Mobile: full width stack */
@media (max-width: 480px) {
    .word-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    
    .word-card {
        border-radius: 0;
        margin: 0 -16px;
        padding: 16px;
    }
}
```

### Collapsible Details

```html
<!-- Expand on tap for mobile -->
<div class="word-details">
    <div class="word-summary" onclick="toggleDetails(this)">
        <h3>anonymous</h3>
        <span class="expand-icon">▼</span>
    </div>
    <div class="word-expanded">
        <!-- Definition, examples, etc. -->
    </div>
</div>
```

---

## Safe Areas (Notches & Home Indicators)

```css
/* Handle iPhone notch and home indicator */
.app-header {
    padding-top: env(safe-area-inset-top);
}

.app-footer {
    padding-bottom: env(safe-area-inset-bottom);
}

/* Full bleed with safe content */
.full-screen {
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
}
```

---

## Mobile Design Checklist

### Layout

- [ ] Primary actions in thumb zone (bottom)
- [ ] Safe area insets respected
- [ ] No horizontal scrolling
- [ ] Content readable at arm's length

### Touch

- [ ] Touch targets minimum 44×44px
- [ ] 8px+ spacing between targets
- [ ] No hover-dependent interactions
- [ ] Gesture hints for swipe actions

### Forms

- [ ] Appropriate keyboard types
- [ ] Labels always visible (not just placeholder)
- [ ] Submit button visible when keyboard open
- [ ] Clear error states

### Performance

- [ ] Smooth 60fps scrolling
- [ ] Responsive touch feedback (< 100ms)
- [ ] Loading states for async actions
