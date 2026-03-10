---
name: ui-design
description: UI design patterns and component best practices for building web applications. Use when creating new UI components, layouts, or visual interfaces. Generates creative, polished visual designs with high aesthetic quality that avoid generic AI slop.
---

# UI Design Skill

This skill covers **User Interface design patterns**, **aesthetic direction**, and component best practices for web applications.

---

## Aesthetics & Design Thinking

Create distinctive, production-grade interfaces that avoid generic "AI slop" aesthetics. Before coding, understand the context and commit to a **BOLD aesthetic direction**.

### Core Aesthetic Guidelines

- **Tone**: Pick an intentional flavor: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, brutalist, etc. Let this guide every choice.
- **Typography**: Choose unexpected, characterful display fonts paired with a refined body font. **Do not default to Inter, Roboto, Arial, or system fonts.**
- **Color & Theme**: Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Avoid cliché purple gradients on white backgrounds.
- **Motion**: Focus on high-impact moments. A well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions.
- **Spatial Composition**: Use unexpected layouts. Embrace asymmetry, overlap, grid-breaking elements, and generous negative space (or intentional density).
- **Backgrounds**: Create atmosphere and depth. Use gradient meshes, noise/grain textures, layered transparencies, and dramatic shadows rather than flat solid colors.

**CRITICAL**: Match the code complexity to the aesthetic. Maximalist designs need elaborate CSS/animations; minimalist designs need restraint, precision, and perfect typography/spacing. Never converge on the same predictable layout across tasks.

---

## Design System Foundation

### Color Tokens

```css
:root {
    /* Primary palette */
    --primary-50: #eef2ff;
    --primary-500: #667eea;
    --primary-600: #5a67d8;
    --primary-700: #4c51bf;
    
    /* Semantic colors */
    --success: #10b981;
    --warning: #f59e0b;
    --error: #ef4444;
    --info: #3b82f6;
    
    /* Neutrals */
    --gray-50: #f9fafb;
    --gray-100: #f3f4f6;
    --gray-800: #1f2937;
    --gray-900: #111827;
}
```

### Typography Scale

```css
:root {
    --font-sans: 'Inter', system-ui, sans-serif;
    --text-xs: 0.75rem;    /* 12px */
    --text-sm: 0.875rem;   /* 14px */
    --text-base: 1rem;     /* 16px */
    --text-lg: 1.125rem;   /* 18px */
    --text-xl: 1.25rem;    /* 20px */
    --text-2xl: 1.5rem;    /* 24px */
}
```

### Spacing Scale

```css
:root {
    --space-1: 0.25rem;  /* 4px */
    --space-2: 0.5rem;   /* 8px */
    --space-3: 0.75rem;  /* 12px */
    --space-4: 1rem;     /* 16px */
    --space-6: 1.5rem;   /* 24px */
    --space-8: 2rem;     /* 32px */
}
```

---

## Z-Index Architecture

> [!IMPORTANT]
> Z-index conflicts are a **major source of bugs**. Use the tiered system below to prevent modals appearing behind overlays, tutorials hidden by panels, and click events blocked.

### Predefined Tiers

```css
:root {
    /* Background layers */
    --z-base: 1;
    --z-dropdown: 100;
    --z-sticky: 500;
    --z-header: 1000;
    
    /* Overlay layers */
    --z-overlay: 5000;
    --z-modal: 10000;
    --z-modal-nested: 15000;    /* For modals inside modals */
    
    /* Critical layers */
    --z-toast: 50000;
    --z-tooltip: 60000;
    --z-tutorial: 100000;       /* Tutorials MUST be on top */
    --z-tutorial-spotlight: 100001;
    --z-tutorial-tooltip: 100002;
    
    /* Emergency (use sparingly) */
    --z-max: 2147483647;
}
```

### Stacking Context Rules

```css
/* ❌ WRONG: Creates unwanted stacking context */
.parent {
    position: relative;
    z-index: 1;  /* Child z-index now relative to THIS */
}
.child-modal {
    z-index: 99999;  /* Won't work as expected! */
}

/* ✅ CORRECT: Modal is direct child of body */
.modal {
    position: fixed;
    z-index: var(--z-modal);
}
```

### Isolation Pattern for Modals

```javascript
// Move modal to body to escape parent stacking context
function openModal(modalElement) {
    document.body.appendChild(modalElement);
    modalElement.classList.add('visible');
}

function closeModal(modalElement) {
    modalElement.classList.remove('visible');
    // Return to original location if needed
}
```

---

## Modal Best Practices

### Overlay Structure

```html
<!-- Correct structure: overlay + modal as siblings -->
<div class="modal-overlay" id="my-modal-overlay"></div>
<div class="modal" id="my-modal" role="dialog" aria-modal="true">
    <header class="modal-header">
        <h2>Modal Title</h2>
        <button class="btn-close" aria-label="Close">×</button>
    </header>
    <div class="modal-body">
        <!-- Content -->
    </div>
    <footer class="modal-footer">
        <button class="btn btn-secondary">Cancel</button>
        <button class="btn btn-primary">Confirm</button>
    </footer>
</div>
```

### Modal CSS Pattern

```css
.modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: var(--z-overlay);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s, visibility 0.2s;
}

.modal-overlay.visible {
    opacity: 1;
    visibility: visible;
}

.modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.95);
    z-index: var(--z-modal);
    opacity: 0;
    visibility: hidden;
    transition: all 0.2s ease-out;
}

.modal.visible {
    opacity: 1;
    visibility: visible;
    transform: translate(-50%, -50%) scale(1);
}
```

### Nested Modal Pattern

```css
/* When a modal opens another modal (e.g., Writing Challenge inside SRS) */
.nested-modal {
    z-index: var(--z-modal-nested);
}

.nested-modal-overlay {
    z-index: calc(var(--z-modal-nested) - 1);
}
```

---

## Pointer-Events Guide

> [!CAUTION]
> Incorrect `pointer-events` usage causes buttons to become unclickable. This is a common bug source.

### When to Use `pointer-events: none`

```css
/* ✅ Correct: Overlay should NOT block tutorial tooltip clicks */
.tutorial-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-tutorial);
    pointer-events: none;  /* Let clicks through */
}

/* But the spotlight cutout SHOULD be clickable */
.tutorial-spotlight {
    pointer-events: auto;  /* Re-enable for this element */
}

.tutorial-tooltip {
    pointer-events: auto;  /* Buttons must be clickable */
}
```

### Common Anti-Patterns

```css
/* ❌ WRONG: Blocking clicks on entire container */
.container {
    pointer-events: none;
}
.container .button {
    /* This button CANNOT be clicked! */
}

/* ✅ CORRECT: Only block specific elements */
.decorative-element {
    pointer-events: none;
}
.button {
    pointer-events: auto;
}
```

### Cleanup After Modal Close

```javascript
function closeModal(modal) {
    modal.classList.remove('visible');
    
    // ⚠️ CRITICAL: Remove any pointer-events overrides
    modal.style.pointerEvents = '';
    
    // Remove any overlays that might still block clicks
    const leftoverOverlays = document.querySelectorAll('.modal-overlay.visible');
    leftoverOverlays.forEach(overlay => overlay.classList.remove('visible'));
}
```

---

## Layout Patterns

### Card Grid

```css
.card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-4);
}
```

### Split Screen

```css
.split-screen {
    display: grid;
    grid-template-columns: 1fr 1fr;
    min-height: 100vh;
}

@media (max-width: 768px) {
    .split-screen {
        grid-template-columns: 1fr;
    }
}
```

### Sticky Header

```css
.header {
    position: sticky;
    top: 0;
    z-index: var(--z-header);
    background: var(--bg-primary);
    backdrop-filter: blur(8px);
}
```

---

## Component Patterns

### Button Variants

```html
<!-- Primary -->
<button class="btn btn-primary">Primary Action</button>

<!-- Secondary -->
<button class="btn btn-secondary">Secondary</button>

<!-- Ghost -->
<button class="btn btn-ghost">Ghost</button>

<!-- Icon only -->
<button class="btn btn-icon" aria-label="Settings">
    <svg>...</svg>
</button>
```

```css
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: 8px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
}

.btn-primary {
    background: var(--primary-500);
    color: white;
}

.btn-primary:hover {
    background: var(--primary-600);
    transform: translateY(-1px);
}
```

### Card Component

```html
<article class="card">
    <header class="card-header">
        <h3 class="card-title">Word of the Day</h3>
        <span class="badge">New</span>
    </header>
    <div class="card-body">
        <p>Content goes here</p>
    </div>
    <footer class="card-footer">
        <button class="btn btn-primary">Learn More</button>
    </footer>
</article>
```

---

## Form Components

### Input with Label

```html
<div class="form-field">
    <label for="word-input" class="form-label">Enter word</label>
    <input 
        type="text" 
        id="word-input" 
        class="form-input"
        placeholder="Type here..."
    >
    <span class="form-hint">Press Enter to submit</span>
</div>
```

### Validation States

```css
.form-input.is-valid {
    border-color: var(--success);
}

.form-input.is-invalid {
    border-color: var(--error);
}

.form-error {
    color: var(--error);
    font-size: var(--text-sm);
    margin-top: var(--space-1);
}
```

---

## Loading State Patterns

> [!TIP]
> Always include timeout failsafes to prevent infinite loading states.

### Loading with Timeout Failsafe

```javascript
function showLoading(container, timeoutMs = 15000) {
    const loader = document.createElement('div');
    loader.className = 'loading-state';
    loader.innerHTML = `
        <div class="spinner"></div>
        <p class="loading-text">Loading...</p>
        <button class="dismiss-btn hidden">Dismiss</button>
    `;
    container.appendChild(loader);
    
    // Show dismiss button after timeout
    const dismissBtn = loader.querySelector('.dismiss-btn');
    setTimeout(() => {
        dismissBtn.classList.remove('hidden');
        loader.querySelector('.loading-text').textContent = 
            'Taking longer than expected...';
    }, timeoutMs);
    
    dismissBtn.addEventListener('click', () => loader.remove());
    
    return loader;
}
```

### Skeleton Loading

```html
<!-- Skeleton -->
<div class="skeleton skeleton-text"></div>
<div class="skeleton skeleton-avatar"></div>

<!-- Progress bar -->
<div class="progress" role="progressbar" aria-valuenow="50">
    <div class="progress-bar" style="width: 50%"></div>
</div>
```

```css
.skeleton {
    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
```

---

## Viewport & Responsive Patterns

### Safe Positioning (Prevent Clipping)

```javascript
// Ensure element stays within viewport bounds
function positionWithinViewport(element, targetRect) {
    const rect = element.getBoundingClientRect();
    const viewport = {
        width: window.innerWidth,
        height: window.innerHeight
    };
    
    let top = targetRect.bottom + 10;
    let left = targetRect.left;
    
    // Prevent right overflow
    if (left + rect.width > viewport.width - 20) {
        left = viewport.width - rect.width - 20;
    }
    
    // Prevent bottom overflow - flip above target
    if (top + rect.height > viewport.height - 20) {
        top = targetRect.top - rect.height - 10;
    }
    
    // Prevent left overflow
    if (left < 20) left = 20;
    
    // Prevent top overflow
    if (top < 20) top = 20;
    
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
}
```

### Responsive Breakpoints

```css
/* Mobile first approach */
@media (min-width: 640px) { /* sm */ }
@media (min-width: 768px) { /* md */ }
@media (min-width: 1024px) { /* lg */ }
@media (min-width: 1280px) { /* xl */ }
```

---

## Feedback Components

### Toast Notifications

```javascript
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    document.getElementById('toast-container').appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
}
```

---

## Visual Debugging Checklist

Use this when diagnosing layering/click issues:

### Z-Index Issues

- [ ] Is the element inside a parent with `position: relative/absolute` and `z-index`?
- [ ] Would moving the element to `<body>` fix the issue?
- [ ] Are you using CSS variables for z-index tiers?
- [ ] Open DevTools → Layers panel to visualize stacking contexts

### Click/Pointer Issues

- [ ] Does any ancestor have `pointer-events: none`?
- [ ] Is there an invisible overlay blocking clicks (`opacity: 0` but still there)?
- [ ] Check for leftover `.visible` classes on overlays
- [ ] Use DevTools → Elements → select element under cursor to find blockers

### Modal Issues

- [ ] Is the modal a direct child of `<body>`?
- [ ] Does `closeModal()` properly clean up:
  - Overlay visibility
  - Pointer-events overrides
  - Event listeners
- [ ] Are animations complete before allowing interaction?

---

## Design Checklist

- [ ] Choose a distinct aesthetic theme and stick to it (avoid generic UI slop)
- [ ] Select bold, characterful typography (avoid Inter/Roboto defaults)
- [ ] Add atmospheric backgrounds (noise, meshes, patterns) instead of flat colors
- [ ] Ensure layout uses interesting composition (asymmetry, overlap, intentional spacing)
- [ ] Use semantic HTML elements
- [ ] Ensure color contrast meets WCAG AA (4.5:1)
- [ ] Add focus states to all interactive elements
- [ ] Test at mobile, tablet, and desktop sizes
- [ ] Use CSS custom properties for theming
- [ ] Include loading and empty states
- [ ] Use z-index tiers consistently
- [ ] Test modal open/close cleanup
- [ ] Verify click targets are accessible
