---
name: performance
description: Web app performance optimization including lazy loading, caching, and rendering efficiency. Use when addressing slow load times, memory issues, or UI jank.
---

# Performance Optimization Skill

This skill covers **performance best practices** for the dictation practice web app.

---

## Performance Checklist

### Initial Load

- [ ] Critical CSS inlined or preloaded
- [ ] JavaScript deferred/async where possible
- [ ] Images lazy loaded
- [ ] Fonts preloaded with `font-display: swap`

### Runtime

- [ ] Animations use `transform`/`opacity` only
- [ ] Event handlers debounced/throttled
- [ ] Large lists virtualized
- [ ] Memory leaks prevented

---

## Lazy Loading

### Images

```html
<!-- Native lazy loading -->
<img src="image.jpg" loading="lazy" alt="Description">

<!-- With placeholder -->
<img 
    src="placeholder.svg" 
    data-src="actual-image.jpg" 
    class="lazy"
    alt="Description"
>
```

```javascript
// Intersection Observer pattern
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            img.src = img.dataset.src;
            observer.unobserve(img);
        }
    });
});

document.querySelectorAll('img.lazy').forEach(img => {
    observer.observe(img);
});
```

### Code Splitting

```javascript
// Dynamic import for heavy modules
async function loadAnalyzer() {
    const { PronunciationAnalyzer } = await import('./pronunciation-analyzer.js');
    return new PronunciationAnalyzer();
}
```

---

## Caching Strategies

### LocalStorage Cache

```javascript
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getCached(key) {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_TTL) {
        localStorage.removeItem(key);
        return null;
    }
    return data;
}

function setCache(key, data) {
    localStorage.setItem(key, JSON.stringify({
        data,
        timestamp: Date.now()
    }));
}
```

### API Response Cache

```javascript
const apiCache = new Map();

async function fetchWithCache(url, ttl = 5 * 60 * 1000) {
    const cached = apiCache.get(url);
    if (cached && Date.now() - cached.time < ttl) {
        return cached.data;
    }
    
    const response = await fetch(url);
    const data = await response.json();
    apiCache.set(url, { data, time: Date.now() });
    return data;
}
```

---

## Animation Performance

### ✅ Good - GPU Accelerated

```css
.animated-element {
    transform: translateX(100px);
    opacity: 0.5;
    will-change: transform, opacity;
}
```

### ❌ Bad - Causes Reflow

```css
.animated-element {
    left: 100px;      /* Triggers layout */
    width: 200px;     /* Triggers layout */
    margin-top: 10px; /* Triggers layout */
}
```

---

## Debounce & Throttle

```javascript
// Debounce: wait until user stops
function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
}

// Use for search input
searchInput.addEventListener('input', debounce((e) => {
    performSearch(e.target.value);
}, 300));

// Throttle: limit frequency
function throttle(fn, limit) {
    let inThrottle;
    return (...args) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Use for scroll events
window.addEventListener('scroll', throttle(() => {
    updateScrollIndicator();
}, 100));
```

---

## Memory Management

### Prevent Leaks

```javascript
// ❌ Bad - listener never removed
element.addEventListener('click', handler);

// ✅ Good - cleanup on unmount
const controller = new AbortController();
element.addEventListener('click', handler, { signal: controller.signal });
// Later: controller.abort();

// ❌ Bad - timer runs forever
setInterval(updateUI, 1000);

// ✅ Good - clear when done
const timerId = setInterval(updateUI, 1000);
// Later: clearInterval(timerId);
```

### Release References

```javascript
// When closing modals
function closeModal() {
    modal.classList.remove('active');
    
    // Release audio resources
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.src = '';
    }
    
    // Clear large data
    currentAnalysisData = null;
}
```

---

## Measurement

### DevTools Performance Tab

1. Open DevTools (F12)
2. Go to Performance tab
3. Click Record → Interact → Stop
4. Look for: Long tasks, Layout shifts, Paint events

### Core Web Vitals

```javascript
// Measure LCP, FID, CLS
if ('web-vitals' in window) {
    webVitals.getCLS(console.log);
    webVitals.getFID(console.log);
    webVitals.getLCP(console.log);
}
```

---

## Common Issues & Solutions

### Issue: Janky scrolling

**Fix**: Use passive event listeners, virtualize long lists

### Issue: Slow initial load

**Fix**: Code split, lazy load images, defer non-critical JS

### Issue: Memory keeps growing

**Fix**: Remove event listeners, clear intervals, null references

### Issue: Input feels laggy  

**Fix**: Debounce handlers, avoid layout thrashing
