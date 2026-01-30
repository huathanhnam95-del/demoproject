---
name: visualization
description: Data visualization and visual design principles for learning content. Use when creating charts, progress displays, or visual feedback for pronunciation analysis.
---

# Visualization Skill

This skill covers **visualization design** for presenting learning data, pronunciation analysis, and progress in the dictation practice app.

---

## Visualization Principles

| Principle | Description | Example |
| :--- | :--- | :--- |
| **Clarity** | Remove visual noise | No 3D effects, no chartjunk |
| **Hierarchy** | Emphasize important data | Larger/bolder for key metrics |
| **Consistency** | Same encoding throughout | Green = good, red = needs work |
| **Context** | Compare to meaningful reference | Native speaker pitch overlay |
| **Accuracy** | Don't distort proportions | Start y-axis at 0 for bars |

---

## Progress Visualization

### Circular Progress Ring

```html
<svg class="progress-ring" viewBox="0 0 100 100">
    <circle class="progress-ring-bg" cx="50" cy="50" r="45"/>
    <circle 
        class="progress-ring-fill" 
        cx="50" cy="50" r="45"
        stroke-dasharray="283"
        stroke-dashoffset="70" <!-- 75% progress -->
    />
    <text x="50" y="55" class="progress-text">75%</text>
</svg>
```

```css
.progress-ring-fill {
    stroke: var(--primary-500);
    stroke-width: 8;
    fill: none;
    transform: rotate(-90deg);
    transform-origin: center;
    transition: stroke-dashoffset 0.5s ease;
}
```

### Streak Calendar

```javascript
function renderStreakCalendar(completedDays) {
    const weeks = 7;
    const days = 52 * 7; // 1 year
    
    return Array(days).fill(0).map((_, i) => {
        const level = getActivityLevel(completedDays, i);
        return `<div class="day level-${level}"></div>`;
    }).join('');
}
```

```css
.day { width: 10px; height: 10px; border-radius: 2px; }
.level-0 { background: var(--gray-100); }
.level-1 { background: #c6e48b; }
.level-2 { background: #7bc96f; }
.level-3 { background: #239a3b; }
.level-4 { background: #196127; }
```

---

## Pronunciation Analysis Visualization

### Pitch Contour Graph

```javascript
function drawPitchContour(canvas, userPitch, nativePitch) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Draw native reference (background)
    ctx.strokeStyle = 'rgba(102, 126, 234, 0.3)';
    ctx.lineWidth = 8;
    drawLine(ctx, nativePitch, width, height);
    
    // Draw user pitch (foreground)
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 3;
    drawLine(ctx, userPitch, width, height);
}

function drawLine(ctx, data, width, height) {
    ctx.beginPath();
    data.forEach((point, i) => {
        const x = (i / data.length) * width;
        const y = height - (point / 400) * height; // Normalize pitch
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
}
```

### Syllable Breakdown

```html
<div class="syllable-chart">
    <div class="syllable" style="flex: 1">
        <div class="syllable-bar" style="height: 60%"></div>
        <span class="syllable-text">a</span>
    </div>
    <div class="syllable stressed" style="flex: 1.5">
        <div class="syllable-bar" style="height: 100%"></div>
        <span class="syllable-text">NON</span>
    </div>
    <div class="syllable" style="flex: 1">
        <div class="syllable-bar" style="height: 50%"></div>
        <span class="syllable-text">y</span>
    </div>
    <div class="syllable" style="flex: 1">
        <div class="syllable-bar" style="height: 40%"></div>
        <span class="syllable-text">mous</span>
    </div>
</div>
```

---

## Score Display

### Animated Score Counter

```javascript
function animateScore(element, from, to, duration = 1000) {
    const start = performance.now();
    
    function update(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = easeOutCubic(progress);
        const current = Math.round(from + (to - from) * eased);
        
        element.textContent = current;
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}

function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
}
```

### Score Color Coding

```javascript
function getScoreColor(score) {
    if (score >= 90) return { color: '#10b981', label: 'Excellent' };
    if (score >= 75) return { color: '#3b82f6', label: 'Good' };
    if (score >= 60) return { color: '#f59e0b', label: 'Fair' };
    return { color: '#ef4444', label: 'Needs Practice' };
}
```

---

## Comparison Visualizations

### Before/After Comparison

```html
<div class="comparison-slider">
    <div class="comparison-native">
        <canvas id="native-waveform"></canvas>
        <span class="label">Native Speaker</span>
    </div>
    <div class="comparison-user">
        <canvas id="user-waveform"></canvas>
        <span class="label">Your Recording</span>
    </div>
</div>
```

### Accuracy Heatmap

```javascript
function renderAccuracyHeatmap(words) {
    return words.map(word => {
        const accuracy = word.correctCount / word.attemptCount;
        return {
            text: word.text,
            color: accuracyToColor(accuracy),
            tooltip: `${Math.round(accuracy * 100)}% accuracy`
        };
    });
}

function accuracyToColor(accuracy) {
    // Red → Yellow → Green gradient
    const hue = accuracy * 120; // 0 = red, 120 = green
    return `hsl(${hue}, 70%, 50%)`;
}
```

---

## Charts for Learning Progress

### Weekly Progress Bar Chart

```javascript
function renderWeeklyProgress(data) {
    const maxValue = Math.max(...data.map(d => d.value));
    
    return data.map(day => ({
        label: day.name,
        height: (day.value / maxValue) * 100,
        value: day.value
    }));
}
```

### Vocabulary Growth Line Chart

```javascript
const chartConfig = {
    type: 'line',
    data: {
        labels: getLast30Days(),
        datasets: [{
            label: 'Words Learned',
            data: cumulativeWordCount,
            borderColor: '#667eea',
            fill: true,
            backgroundColor: 'rgba(102, 126, 234, 0.1)'
        }]
    }
};
```

---

## Color Palette for Data

```css
:root {
    /* Qualitative (categories) */
    --chart-1: #667eea;
    --chart-2: #f093fb;
    --chart-3: #4ade80;
    --chart-4: #fbbf24;
    
    /* Sequential (low to high) */
    --seq-1: #eef2ff;
    --seq-2: #c7d2fe;
    --seq-3: #818cf8;
    --seq-4: #4f46e5;
    
    /* Diverging (negative/positive) */
    --neg: #ef4444;
    --neutral: #f3f4f6;
    --pos: #10b981;
}
```

---

## Checklist

- [ ] Use consistent color encoding
- [ ] Label axes and important values
- [ ] Provide comparison context (native reference)
- [ ] Animate transitions smoothly
- [ ] Make interactive elements obvious
- [ ] Test with colorblind filters
