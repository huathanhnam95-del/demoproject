---
name: tutorials
description: Best practices for creating comprehensive in-app tutorials, onboarding flows, and user guides. Use when building tutorial systems, walkthroughs, or help content.
---

# Tutorial Design Skill

This skill covers **tutorial and onboarding design** for helping users learn the dictation practice app.

---

## Tutorial Types

| Type | Use When | Example |
|------|----------|---------|
| **Tooltip tour** | First-time feature intro | Step-by-step feature highlights |
| **Interactive walkthrough** | Teaching a workflow | "Try recording now" prompts |
| **Video tutorial** | Complex concepts | Pronunciation technique demo |
| **Contextual help** | On-demand assistance | (?) icons with hover tips |
| **Progressive onboarding** | Revealing features over time | Unlock features as skills grow |

---

## Onboarding Flow Structure

```javascript
const onboardingFlow = {
    steps: [
        {
            id: 'welcome',
            type: 'modal',
            title: 'Welcome to Dictation Practice!',
            content: 'Let\'s get you started in 30 seconds.',
            actions: ['Get Started', 'Skip Tour']
        },
        {
            id: 'play-audio',
            type: 'spotlight',
            target: '#play-btn',
            title: 'Listen to the Word',
            content: 'Tap here to hear the word spoken by a native speaker.',
            position: 'bottom',
            action: 'Click to continue'
        },
        {
            id: 'type-answer',
            type: 'spotlight',
            target: '#answer-input',
            title: 'Type What You Hear',
            content: 'Type the word exactly as you heard it.',
            position: 'top',
            allowInteraction: true
        },
        {
            id: 'complete',
            type: 'celebration',
            title: 'You\'re Ready!',
            content: 'Start practicing to build your vocabulary.',
            actions: ['Start Learning']
        }
    ],
    
    settings: {
        showOnFirstVisit: true,
        canSkip: true,
        saveProgress: true,
        replayFromSettings: true
    }
};
```

---

## Spotlight/Tooltip Component

```javascript
function showSpotlight(step) {
    const target = document.querySelector(step.target);
    const rect = target.getBoundingClientRect();
    
    // Create overlay with hole
    const overlay = createOverlayWithHole(rect);
    
    // Position tooltip
    const tooltip = createTooltip({
        title: step.title,
        content: step.content,
        position: step.position,
        target: rect
    });
    
    // Add pulse animation to target
    target.classList.add('tutorial-highlight');
    
    // Handle next/skip
    tooltip.onNext = () => nextStep();
    tooltip.onSkip = () => endTutorial();
}
```

```css
/* Overlay with spotlight hole */
.tutorial-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: var(--z-tutorial);
}

/* Pulsing highlight */
.tutorial-highlight {
    position: relative;
    z-index: calc(var(--z-tutorial) + 1);
    animation: pulse-highlight 1.5s infinite;
}

@keyframes pulse-highlight {
    0%, 100% { box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.5); }
    50% { box-shadow: 0 0 0 8px rgba(102, 126, 234, 0.3); }
}

/* Tooltip positioning */
.tutorial-tooltip {
    position: fixed;
    background: white;
    border-radius: 12px;
    padding: 16px;
    max-width: 300px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    z-index: calc(var(--z-tutorial) + 2);
}

.tutorial-tooltip::before {
    content: '';
    position: absolute;
    border: 8px solid transparent;
    /* Arrow positioning varies by position */
}
```

---

## Progress Tracking

```javascript
class TutorialManager {
    constructor(tutorialId) {
        this.id = tutorialId;
        this.storageKey = `tutorial_${tutorialId}`;
    }
    
    isCompleted() {
        return localStorage.getItem(this.storageKey) === 'completed';
    }
    
    getCurrentStep() {
        return parseInt(localStorage.getItem(`${this.storageKey}_step`) || '0');
    }
    
    saveStep(stepIndex) {
        localStorage.setItem(`${this.storageKey}_step`, stepIndex.toString());
    }
    
    markCompleted() {
        localStorage.setItem(this.storageKey, 'completed');
    }
    
    reset() {
        localStorage.removeItem(this.storageKey);
        localStorage.removeItem(`${this.storageKey}_step`);
    }
}
```

---

## Contextual Help Patterns

### Help Icon

```html
<label for="speed">
    Playback Speed
    <button class="help-icon" aria-label="Help">
        <svg><!-- ? icon --></svg>
    </button>
</label>

<div class="tooltip" role="tooltip">
    Slow down audio to hear pronunciation more clearly.
    Start at 0.75x for difficult words.
</div>
```

### Empty State Guidance

```html
<div class="empty-state">
    <img src="no-words.svg" alt="">
    <h3>No words added yet</h3>
    <p>Start by playing the audio and typing what you hear.</p>
    <button class="btn btn-primary">
        Try Your First Word
    </button>
</div>
```

### Error State Help

```html
<div class="error-state">
    <h3>Recording Failed</h3>
    <p>We couldn't access your microphone.</p>
    <details>
        <summary>How to fix this</summary>
        <ol>
            <li>Check your browser permissions</li>
            <li>Ensure your microphone is connected</li>
            <li>Try refreshing the page</li>
        </ol>
    </details>
    <button class="btn btn-primary">Try Again</button>
</div>
```

---

## Best Practices

### Do's ✅

- Focus on **one feature** at a time
- Use **action-oriented** language ("Click here" not "This is where...")
- Allow users to **skip** or **exit** anytime
- **Remember** where users left off
- Keep text **short** (1-2 sentences max)
- Use **interactive** steps where possible

### Don'ts ❌

- Don't show **all features** upfront
- Don't use **walls of text**
- Don't block **critical actions**
- Don't restart from beginning if interrupted
- Don't show tutorials to **returning users**

---

## Replay Functionality

```javascript
// Settings panel option
function renderTutorialSettings() {
    return `
        <div class="setting-group">
            <h4>Tutorials</h4>
            <label class="setting-item">
                <input 
                    type="checkbox" 
                    ${isTutorialEnabled('dictation') ? 'checked' : ''}
                    onchange="toggleTutorial('dictation', this.checked)"
                >
                <span>Show dictation tutorial</span>
            </label>
            <label class="setting-item">
                <input 
                    type="checkbox"
                    ${isTutorialEnabled('pronunciation') ? 'checked' : ''}
                    onchange="toggleTutorial('pronunciation', this.checked)"
                >
                <span>Show pronunciation tutorial</span>
            </label>
            <button class="btn btn-secondary" onclick="resetAllTutorials()">
                Reset All Tutorials
            </button>
        </div>
    `;
}
```

---

## Checklist

- [ ] Tutorial triggers on first visit
- [ ] Each step focuses on one action
- [ ] Skip button available on every step
- [ ] Progress saved if user leaves
- [ ] Replay option in settings
- [ ] Mobile-friendly positioning
- [ ] Keyboard navigation works (Tab, Enter, Escape)
