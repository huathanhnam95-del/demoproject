---
name: ux-optimization
description: UX optimization principles for improving user experience, usability, and engagement. Use when analyzing user flows, improving interactions, or reducing friction.
---

# UX Optimization Skill

This skill covers **User Experience optimization** principles to improve usability, engagement, and satisfaction in the dictation practice app.

---

## Core UX Principles

| Principle | Description | Implementation |
| :--- | :--- | :--- |
| **Clarity** | Users should never be confused | Clear labels, obvious actions |
| **Consistency** | Same patterns throughout | Reuse components, terminology |
| **Feedback** | Every action gets a response | Visual/audio cues, status updates |
| **Efficiency** | Minimize steps to complete tasks | Shortcuts, smart defaults |
| **Forgiveness** | Easy to recover from errors | Undo, confirmation dialogs |

---

## Async Timing Patterns

> [!CAUTION]
> Triggering UI components (like tutorials) before DOM elements are visible is a **major bug source**. Always verify visibility first.

### Wait for Element Visibility

```javascript
// ✅ CORRECT: Wait for element to be visible before triggering dependent UI
async function waitForElementVisible(selector, timeoutMs = 5000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
        const element = document.querySelector(selector);
        if (element) {
            const rect = element.getBoundingClientRect();
            const styles = getComputedStyle(element);
            
            const isVisible = 
                styles.display !== 'none' &&
                styles.visibility !== 'hidden' &&
                styles.opacity !== '0' &&
                rect.width > 0 &&
                rect.height > 0;
                
            if (isVisible) return element;
        }
        await new Promise(r => setTimeout(r, 50));
    }
    
    console.warn(`Element ${selector} not visible after ${timeoutMs}ms`);
    return null;
}

// Usage: Tutorial waits for modal
async function showWritingChallenge() {
    const modal = document.getElementById('writing-modal');
    modal.classList.add('visible');
    
    // ⚠️ CRITICAL: Wait for CSS animation to complete
    await new Promise(r => setTimeout(r, 300));
    
    // Now safe to trigger tutorial
    const visibleModal = await waitForElementVisible('#writing-modal.visible');
    if (visibleModal) {
        VocabTutorial.startWritingChallengeTutorial();
    }
}
```

### Wait for Animation Complete

```javascript
// Wait for CSS transition/animation to finish
function waitForTransition(element) {
    return new Promise(resolve => {
        const handler = () => {
            element.removeEventListener('transitionend', handler);
            resolve();
        };
        element.addEventListener('transitionend', handler);
        
        // Fallback timeout in case event doesn't fire
        setTimeout(resolve, 500);
    });
}
```

### Verify Before Action

```javascript
// ❌ WRONG: Assumes element exists
function startTutorial() {
    const target = document.querySelector('#word-display');
    this.spotlight(target);  // Crashes if target is null!
}

// ✅ CORRECT: Check first, graceful fallback
function startTutorial() {
    const target = document.querySelector('#word-display');
    if (!target) {
        console.warn('Tutorial target not found, skipping');
        return;
    }
    this.spotlight(target);
}
```

---

## Modal Lifecycle Management

> [!IMPORTANT]
> Improper modal cleanup causes leftover overlays, blocked clicks, and stale event listeners.

### Complete Open/Close Sequence

```javascript
class ModalManager {
    constructor(modalId) {
        this.modal = document.getElementById(modalId);
        this.overlay = document.getElementById(`${modalId}-overlay`);
        this.boundClose = this.close.bind(this);
        this.boundKeyHandler = this.handleKeyDown.bind(this);
    }
    
    open() {
        // 1. Show overlay and modal
        this.overlay?.classList.add('visible');
        this.modal.classList.add('visible');
        
        // 2. Add event listeners
        this.overlay?.addEventListener('click', this.boundClose);
        document.addEventListener('keydown', this.boundKeyHandler);
        
        // 3. Focus trap (accessibility)
        this.modal.focus();
        
        // 4. Prevent body scroll
        document.body.style.overflow = 'hidden';
    }
    
    close() {
        // 1. Hide modal and overlay
        this.modal.classList.remove('visible');
        this.overlay?.classList.remove('visible');
        
        // 2. ⚠️ CRITICAL: Remove event listeners
        this.overlay?.removeEventListener('click', this.boundClose);
        document.removeEventListener('keydown', this.boundKeyHandler);
        
        // 3. ⚠️ CRITICAL: Reset pointer-events
        this.modal.style.pointerEvents = '';
        if (this.overlay) this.overlay.style.pointerEvents = '';
        
        // 4. Restore body scroll
        document.body.style.overflow = '';
        
        // 5. Return focus to trigger element
        this.triggerElement?.focus();
    }
    
    handleKeyDown(e) {
        if (e.key === 'Escape') this.close();
    }
}
```

### Cleanup Verification

```javascript
// Debug helper: verify no leftover blocking elements
function verifyUICleanup() {
    const issues = [];
    
    // Check for visible overlays
    document.querySelectorAll('.modal-overlay.visible, .tutorial-overlay.visible')
        .forEach(el => issues.push(`Leftover overlay: ${el.id || el.className}`));
    
    // Check for pointer-events blockers
    document.querySelectorAll('[style*="pointer-events: none"]')
        .forEach(el => {
            if (el.offsetParent !== null) {  // Is visible
                issues.push(`Blocking element: ${el.id || el.className}`);
            }
        });
    
    // Check body scroll lock
    if (document.body.style.overflow === 'hidden') {
        issues.push('Body scroll still locked');
    }
    
    if (issues.length > 0) {
        console.warn('UI Cleanup issues:', issues);
    }
    
    return issues;
}
```

---

## Error Recovery Patterns

### Timeout Failsafes

```javascript
// ✅ CORRECT: Always have a timeout for async operations
async function analyzeAudio(blob) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    try {
        const response = await fetch('/api/analyze', {
            method: 'POST',
            body: blob,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            showError('Analysis timed out. Please try again.');
        } else {
            showError('Analysis failed. Please try again.');
        }
        return null;
    }
}
```

### Recording Button Reset

```javascript
// Prevent stuck "Recording..." states
function startRecording() {
    const btn = document.getElementById('record-btn');
    btn.textContent = 'Recording...';
    btn.disabled = true;
    
    // ⚠️ FAILSAFE: Reset after maximum duration
    const maxDuration = 10000;  // 10 seconds
    const failsafeTimer = setTimeout(() => {
        console.warn('Recording failsafe triggered');
        stopRecording();
        btn.textContent = 'Start Recording';
        btn.disabled = false;
        showToast('Recording stopped due to timeout', 'warning');
    }, maxDuration);
    
    // Store timer for cleanup
    btn.dataset.failsafeTimer = failsafeTimer;
}

function stopRecording() {
    const btn = document.getElementById('record-btn');
    clearTimeout(parseInt(btn.dataset.failsafeTimer));
    btn.textContent = 'Start Recording';
    btn.disabled = false;
}
```

### Graceful Degradation

```javascript
// Show content even if some features fail
async function loadWordDetails(word) {
    const container = document.getElementById('word-details');
    
    // Core content (must succeed)
    try {
        const definition = await fetchDefinition(word);
        container.innerHTML = `<h2>${word}</h2><p>${definition}</p>`;
    } catch (e) {
        container.innerHTML = `<h2>${word}</h2><p>Definition unavailable</p>`;
    }
    
    // Optional content (can fail silently)
    try {
        const examples = await fetchExamples(word);
        if (examples.length > 0) {
            container.innerHTML += `<h3>Examples</h3><ul>${examples.map(e => `<li>${e}</li>`).join('')}</ul>`;
        }
    } catch (e) {
        console.warn('Examples unavailable:', e);
        // Don't show error to user, just omit section
    }
}
```

---

## Click Target Verification

### Ensure Clickability

```javascript
// Debug: verify element is actually clickable
function verifyClickable(element) {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    // What element is actually at this position?
    const topElement = document.elementFromPoint(centerX, centerY);
    
    if (topElement !== element && !element.contains(topElement)) {
        console.warn('Element blocked by:', topElement);
        return false;
    }
    
    // Check pointer-events
    const styles = getComputedStyle(element);
    if (styles.pointerEvents === 'none') {
        console.warn('Element has pointer-events: none');
        return false;
    }
    
    return true;
}
```

### Click Handler Debugging

```javascript
// Attach to document to see what's receiving clicks
document.addEventListener('click', (e) => {
    console.log('Click received by:', e.target);
    console.log('Target classes:', e.target.className);
    console.log('Z-index:', getComputedStyle(e.target).zIndex);
}, true);  // Use capture phase
```

---

## Reduce Cognitive Load

### Progressive Disclosure

```javascript
// Show only essential information first
function showWordDetails(word, expanded = false) {
    return {
        // Always visible
        word: word.text,
        pronunciation: word.ipa,
        
        // Shown on demand
        ...(expanded && {
            etymology: word.etymology,
            collocations: word.collocations,
            examples: word.examples
        })
    };
}
```

### Chunking Information

```html
<!-- Break complex tasks into steps -->
<div class="wizard">
    <div class="wizard-step active">1. Listen</div>
    <div class="wizard-step">2. Type</div>
    <div class="wizard-step">3. Review</div>
</div>
```

### Smart Defaults

```javascript
// Pre-fill based on user behavior
const defaultSettings = {
    playbackSpeed: userPreferences.speed || 1.0,
    autoPlay: userHistory.usesAutoPlay ?? true,
    difficulty: inferDifficultyFromProgress(userProgress)
};
```

---

## Provide Effective Feedback

### Immediate Response

```css
/* Visual feedback on interaction */
.btn:active {
    transform: scale(0.98);
}

.input:focus {
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.3);
}
```

### Status Communication

```javascript
const feedbackMessages = {
    loading: 'Analyzing your pronunciation...',
    success: 'Great job! You scored 85%',
    error: 'Recording failed. Please try again.',
    warning: 'Your microphone volume is low'
};

function showFeedback(type, message) {
    const indicator = document.getElementById('status');
    indicator.className = `status status-${type}`;
    indicator.textContent = message;
    
    // Auto-dismiss success messages
    if (type === 'success') {
        setTimeout(() => indicator.classList.add('hidden'), 3000);
    }
}
```

---

## Minimize User Effort

### Reduce Clicks

```javascript
// Bad: Multiple steps
// Click settings → Click audio → Adjust speed

// Good: Direct access
<button onclick="toggleSpeed()">
    Speed: 1.0x ▾
</button>
```

### Remember User State

```javascript
// Restore last session
function restoreUserSession() {
    const lastWord = localStorage.getItem('lastWord');
    const lastMode = localStorage.getItem('lastMode');
    const position = localStorage.getItem('scrollPosition');
    
    if (lastMode) setMode(lastMode);
    if (lastWord) scrollToWord(lastWord);
    if (position) window.scrollTo(0, position);
}
```

### Keyboard Shortcuts

```javascript
const shortcuts = {
    'Space': 'playAudio',
    'Enter': 'submitAnswer',
    'Escape': 'closeModal',
    'ArrowRight': 'nextWord',
    'ArrowLeft': 'prevWord',
    'r': 'startRecording'
};
```

---

## Handle Errors Gracefully

### Prevention

```javascript
// Validate before submission
function validateInput(input) {
    if (!input.trim()) {
        showHint('Please type your answer');
        return false;
    }
    return true;
}

// Confirmation for destructive actions
function resetProgress() {
    if (confirm('This will reset all your progress. Continue?')) {
        localStorage.clear();
        location.reload();
    }
}
```

### Recovery

```javascript
// Always provide escape routes
function showError(error, actions) {
    showModal({
        title: 'Something went wrong',
        message: error.message,
        actions: [
            { label: 'Try Again', onClick: actions.retry },
            { label: 'Go Back', onClick: actions.goBack },
            { label: 'Report Issue', onClick: actions.report }
        ]
    });
}
```

---

## Microinteractions

### Hover States

```css
.word-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
```

### Success Animations

```css
@keyframes celebrate {
    0% { transform: scale(1); }
    50% { transform: scale(1.1); }
    100% { transform: scale(1); }
}

.score-display.success {
    animation: celebrate 0.5s ease;
}
```

### Loading Feedback

```css
.recording-indicator {
    animation: pulse 1.5s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}
```

---

## UX Anti-Patterns to Avoid

> [!WARNING]
> These patterns cause recurring bugs. Avoid them.

| Anti-Pattern | Problem | Solution |
| :--- | :--- | :--- |
| **Triggering UI before DOM ready** | Tutorials appear in wrong position | Use `waitForElementVisible()` |
| **Not cleaning up event listeners** | Memory leaks, duplicate handlers | Store references, remove in `close()` |
| **Forgetting pointer-events reset** | Elements become unclickable | Reset styles in cleanup |
| **Missing timeout failsafes** | Loading states stuck forever | Always have timeout + dismiss button |
| **Catching errors silently** | Hidden failures confuse debugging | Log errors, show user-friendly message |
| **Hardcoded z-index values** | Layering conflicts | Use CSS variables, tiered system |
| **Not checking element existence** | Null reference crashes | Guard with `if (element)` |
| **Blocking entire container** | Child buttons unclickable | Only block specific decorative elements |

---

## UX Debugging Checklist

### Element Not Clickable

- [ ] Use `document.elementFromPoint(x, y)` to find blocking element
- [ ] Check for `pointer-events: none` on element or ancestors
- [ ] Look for invisible overlays (`.modal-overlay.visible`)
- [ ] Verify z-index - is something on top?

### Modal Not Closing Properly

- [ ] Are event listeners removed in `close()`?
- [ ] Is overlay visibility toggled?
- [ ] Are pointer-events reset to default?
- [ ] Is body scroll restored?

### Tutorial Appearing Wrong

- [ ] Is target element visible when tutorial starts?
- [ ] Did you wait for CSS animation to complete?
- [ ] Is tutorial z-index higher than target container?
- [ ] Use `getBoundingClientRect()` to verify target position

### Stuck Loading State

- [ ] Is there a timeout failsafe?
- [ ] Does the dismiss button work?
- [ ] Is the network request failing silently?
- [ ] Check console for unhandled promise rejections

---

## UX Metrics to Track

| Metric | What it Measures | Target |
| :--- | :--- | :--- |
| **Task Completion Rate** | % completing main flows | > 90% |
| **Time on Task** | Efficiency of flows | Minimize |
| **Error Rate** | Frequency of errors | < 5% |
| **Bounce Rate** | Users who leave early | < 30% |
| **User Satisfaction** | Subjective experience | > 4/5 |

---

## UX Checklist

- [ ] Every action provides feedback
- [ ] Error messages are helpful, not blaming
- [ ] Key actions are accessible via keyboard
- [ ] Loading states prevent user confusion
- [ ] Destructive actions require confirmation
- [ ] User preferences are remembered
- [ ] Modal cleanup is complete (overlay, listeners, pointer-events)
- [ ] Tutorials wait for target visibility
- [ ] Timeout failsafes exist for all async operations
- [ ] Click targets are verified accessible
