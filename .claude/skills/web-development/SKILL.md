---
name: web-development
description: Frontend development patterns for interactive web apps with audio, animations, and modals. Use when building UI components, fixing CSS issues, or implementing user interactions.
---

# Web Development Skill

This skill covers **frontend patterns** for the dictation practice app including audio visualization, modals, tutorials, and responsive design.

## Tech Stack

- **HTML/CSS/Vanilla JS** (no framework)
- **HTTPS** required for microphone access
- **CSS animations** for smooth UX
- **LocalStorage** for user progress

Key files:

- `index.html` - Main app
- `style.css` - Global styles
- `script.js` - Core logic
- `dictionary-service.js` - Word data
- `srs-review.js` - Spaced repetition

---

## Design System

### Z-Index Layers

```css
/* Establish clear stacking context */
--z-base: 1;
--z-dropdown: 100;
--z-modal: 1000;
--z-overlay: 1500;
--z-tutorial: 2000;
--z-tooltip: 2500;
```

### Color Palette

```css
/* Dark mode primary */
--bg-primary: #0f0f23;
--bg-secondary: #1a1a2e;
--accent: #667eea;
--accent-secondary: #764ba2;
--text-primary: #f0f0f0;
--success: #4ade80;
--warning: #fbbf24;
--error: #f87171;
```

---

## Modal Pattern

```javascript
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    const overlay = document.getElementById('overlay');
    
    overlay.classList.add('active');
    modal.classList.add('active');
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    const overlay = document.getElementById('overlay');
    
    overlay.classList.remove('active');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}
```

---

## Audio Recording Pattern

```javascript
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });
        
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (e) => {
            audioChunks.push(e.data);
        };
        
        mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            processAudio(blob);
        };
        
        mediaRecorder.start();
    } catch (err) {
        console.error('Microphone access denied:', err);
        showError('Please enable microphone access');
    }
}
```

---

## Tutorial System Pattern

```javascript
const tutorialSteps = [
    {
        target: '#record-btn',
        title: 'Record Your Voice',
        content: 'Click here to start recording',
        position: 'bottom'
    },
    // ... more steps
];

function showTutorialStep(index) {
    const step = tutorialSteps[index];
    const target = document.querySelector(step.target);
    const rect = target.getBoundingClientRect();
    
    // Position tooltip relative to target
    // Add spotlight effect
    // Handle next/skip actions
}
```

---

## Common Issues & Solutions

### Issue: Modal hidden behind other elements

**Fix**: Ensure modal has `position: fixed` and high `z-index`

### Issue: Microphone not working

**Check**: HTTPS required, permissions granted, no other app using mic

### Issue: Animations janky

**Fix**: Use `transform` and `opacity` only, enable `will-change`

### Issue: Mobile keyboard pushing content

**Fix**: Use `visualViewport` API or `position: fixed` for input containers

---

## Testing Checklist

- [ ] Test in Chrome, Firefox, Safari, Edge
- [ ] Verify mobile responsiveness (320px - 1920px)
- [ ] Check keyboard navigation (Tab, Enter, Escape)
- [ ] Validate color contrast (WCAG AA)
- [ ] Test with slow network (3G simulation)
- [ ] Verify all modals can be closed
