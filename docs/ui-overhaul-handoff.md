# Practice Page UI/UX Overhaul — Handoff Plan

> **Version**: 1.1 (Edge Case Audit added)  
> **Date**: August 14, 2026  
> **Scope**: Main Practice page (Learning Center tab)  
> **Target files**: `public/index.html`, `public/style.css`, `public/script.js`, `public/design-tokens.css`, `public/style-practice-compact.css`

---

## 1. Executive Summary

The Practice page is the primary landing surface for all learners. This overhaul addresses 14 audit findings across four categories: visual hierarchy (critical), learner motivation (critical), information architecture (medium), and accessibility (medium). The redesign shifts from a generic blue/purple Google-inspired palette to a green-primary, gold-accent, blue-tint color system at a 70/15/10/5 ratio (white/green/gold/blue).

### Before → After

| Dimension | Current | Target |
|---|---|---|
| Color identity | Google Blue (#1a73e8) primary | Green (#1A8A5C) primary |
| Progress visibility | None (only "Lvl 5" badge) | Per-skill progress bars + percentages |
| Information architecture | 7 items visible at once, no sequence | Hero "Continue" card → skills → modes |
| Design identity | Generic AI aesthetic | Warm, growth-oriented learning environment |
| Accessibility | Missing ARIA, contrast issues | WCAG AA compliant, keyboard navigable |

---

## 2. Color System

### 2.1 Root CSS Variable Mapping

Replace the entire `:root` color block in `style.css:0-51`.

```css
/* OLD — Remove these */
--primary: #1a73e8;
--primary-hover: #1765cc;
--primary-light: rgba(26, 115, 232, 0.08);
--primary-tonal: #f8fbff;

/* NEW — Green-primary system */
--primary: #1A8A5C;
--primary-hover: #12704A;
--primary-light: rgba(26, 138, 92, 0.08);
--primary-tonal: #EEFAF2;
```

### 2.2 Full Palette Reference

#### Green (primary — 15% of surface)
| Token | Hex | Usage |
|---|---|---|
| `--green-50` | `#EEFAF2` | Skill icon backgrounds, tag backgrounds |
| `--green-100` | `#C5E8D0` | Hero card border, level pill border |
| `--green-200` | `#5CC48A` | Progress bar gradient start |
| `--green-500` | `#1A8A5C` | Primary buttons, active tab underline, progress bar end |
| `--green-700` | `#0D5E3A` | Progress ring text, dark green text |
| `--green-900` | `#083D25` | (dark mode only) |

#### Gold (accent — 10% of surface)
| Token | Hex | Usage |
|---|---|---|
| `--gold-50` | `#FFF8E7` | Speaking icon bg, Read Aloud icon bg, footer tip bg |
| `--gold-100` | `#FCEDC2` | Streak badge border, footer tip border |
| `--gold-200` | `#F5D56B` | Speaking progress gradient start |
| `--gold-500` | `#D4940A` | Streak badge text, Speaking progress end, NEW badge, notification dot, hero tag text, "Help me choose" text |
| `--gold-700` | `#92600A` | Footer tip text, dark gold text |
| `--gold-900` | `#5C3D06` | (dark mode only) |

#### Blue (tint — 5% of surface)
| Token | Hex | Usage |
|---|---|---|
| `--blue-50` | `#EBF4FF` | Listening/Writing icon bg, Repeat mode icon bg |
| `--blue-100` | `#BDD9F5` | Listening card left-border |
| `--blue-500` | `#2B6CB0` | Listening icon color, Repeat icon color |
| `--blue-700` | `#1A4971` | Writing icon color, Writing card left-border |

#### Neutrals (white/gray — 70% of surface)
| Token | Hex | Usage |
|---|---|---|
| `--bg-main` | `#FBFCFB` | Page background (near-white, barely green) |
| `--bg-card` | `#FFFFFF` | All card surfaces |
| `--border-light` | `#E8ECE9` | Default card borders, tab dividers |
| `--text-main` | `#1A2E22` | Primary text (dark forest) |
| `--text-muted` | `#8A9990` | Secondary text, subtitles |
| `--text-body` | `#5A7565` | Body text, descriptions |
| `--text-faint` | `#A0ADA5` | Timestamps, hints |
| `--bg-input` | `#EDF0EE` | Input backgrounds, progress bar tracks |

### 2.3 Skill-Specific Accent Colors

Update `style.css:651-669`:

```css
/* OLD */
.practice-skill-btn.card-speaking { --accent-color: #3b82f6; --accent-rgb: 59, 130, 246; }
.practice-skill-btn.card-listening { --accent-color: #8b5cf6; --accent-rgb: 139, 92, 246; }
.practice-skill-btn.card-reading { --accent-color: #10b981; --accent-rgb: 16, 185, 129; }
.practice-skill-btn.card-writing { --accent-color: #f59e0b; --accent-rgb: 245, 158, 11; }

/* NEW */
.practice-skill-btn.card-speaking { --accent-color: #D4940A; --accent-rgb: 212, 148, 10; }
.practice-skill-btn.card-listening { --accent-color: #2B6CB0; --accent-rgb: 43, 108, 176; }
.practice-skill-btn.card-reading { --accent-color: #1A8A5C; --accent-rgb: 26, 138, 92; }
.practice-skill-btn.card-writing { --accent-color: #1A4971; --accent-rgb: 26, 73, 113; }
```

### 2.4 Skill Active-State Backgrounds

Update `style.css:691-713`:

```css
/* NEW active states */
.practice-skill-btn.card-speaking.is-active { background: #FFFCF5; border-color: #D4940A; border-width: 2px; }
.practice-skill-btn.card-listening.is-active { background: #F7FBFF; border-color: #2B6CB0; border-width: 2px; }
.practice-skill-btn.card-reading.is-active { background: #F5FCF8; border-color: #1A8A5C; border-width: 2px; }
.practice-skill-btn.card-writing.is-active { background: #F7FAFF; border-color: #1A4971; border-width: 2px; }
```

---

## 3. Phase 1 — Hero Card + Progress Visibility

**Estimated effort**: ~2 hours  
**Files touched**: `index.html`, `style.css`, `script.js`  
**Fixes audit**: #2 (zero progress), #5 (buried CTA), #8 (no continue)

### 3.1 Add Hero "Continue" Card

**Location**: `index.html`, insert BEFORE `<div class="dashboard-modern-container">` (line ~938)

```html
<!-- Hero Continue Card -->
<div class="hero-continue-card" id="hero-continue-card" style="display:none;">
  <div class="hero-continue-inner">
    <div class="hero-continue-left">
      <span class="hero-continue-tag">
        <span class="material-symbols-outlined" style="font-size:14px;">auto_awesome</span>
        Recommended for you
      </span>
      <h2 class="hero-continue-title" id="hero-continue-title">Continue your practice</h2>
      <p class="hero-continue-sub" id="hero-continue-sub">Pick up where you left off.</p>
      <button class="hero-continue-btn" id="hero-continue-btn" onclick="heroResumePractice()">
        Continue
        <span class="material-symbols-outlined" style="font-size:18px;">arrow_forward</span>
      </button>
    </div>
    <div class="hero-continue-right">
      <svg class="hero-progress-ring" viewBox="0 0 72 72" width="72" height="72">
        <circle cx="36" cy="36" r="30" fill="none" stroke="#EDF0EE" stroke-width="5"/>
        <circle id="hero-ring-fg" cx="36" cy="36" r="30" fill="none" stroke="#1A8A5C" stroke-width="5"
          stroke-dasharray="188.5" stroke-dashoffset="188.5"
          transform="rotate(-90 36 36)" stroke-linecap="round"/>
        <text id="hero-ring-pct" x="36" y="33" text-anchor="middle" font-size="16" font-weight="800" fill="#0D5E3A">0%</text>
        <text x="36" y="44" text-anchor="middle" font-size="9" fill="#1A8A5C" font-weight="600">complete</text>
      </svg>
    </div>
  </div>
</div>
```

**CSS** — Add to `style.css` after line ~510 (after `.dashboard-modern-container`):

```css
/* ── Hero Continue Card ── */
.hero-continue-card {
  max-width: 800px;
  margin: 0 auto 24px;
}

.hero-continue-inner {
  background: #FFFFFF;
  border-radius: 14px;
  padding: 22px 24px;
  display: flex;
  align-items: center;
  gap: 20px;
  border: 1.5px solid #C5E8D0;
  box-shadow: 0 2px 12px rgba(26, 138, 92, 0.05);
  position: relative;
  overflow: hidden;
}

.hero-continue-inner::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #1A8A5C 0%, #D4940A 60%, #2B6CB0 100%);
}

.hero-continue-left { flex: 1; }

.hero-continue-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: #D4940A;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 6px;
}

.hero-continue-title {
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--text-main);
  margin: 0 0 4px;
  line-height: 1.2;
}

.hero-continue-sub {
  font-size: 0.85rem;
  color: #5A7565;
  line-height: 1.5;
  margin: 0;
}

.hero-continue-btn {
  margin-top: 14px;
  background: #1A8A5C;
  color: #fff;
  border: none;
  padding: 10px 22px;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-shadow: 0 3px 10px rgba(26, 138, 92, 0.2);
  transition: all 0.2s ease;
  font-family: inherit;
}

.hero-continue-btn:hover {
  background: #12704A;
  transform: translateY(-1px);
}

.hero-continue-right {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
}

@media (max-width: 500px) {
  .hero-continue-inner { flex-direction: column; text-align: center; }
  .hero-continue-right { order: -1; }
}
```

**JavaScript** — Add to `script.js`, call from `renderPracticeLauncher()`:

```javascript
function renderHeroCard() {
  const card = document.getElementById('hero-continue-card');
  const lastMode = localStorage.getItem('bel_last_mode');
  const lastSkill = localStorage.getItem('bel_last_skill');
  const progress = parseInt(localStorage.getItem('bel_progress_' + lastSkill) || '0', 10);

  if (!lastMode || !lastSkill) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  const skillNames = { speaking: 'Speaking', listening: 'Listening', reading: 'Reading', writing: 'Writing' };
  const skillName = skillNames[lastSkill] || lastSkill;

  document.getElementById('hero-continue-title').textContent = 'Continue your ' + skillName + ' practice';
  document.getElementById('hero-continue-sub').textContent =
    "You're " + progress + '% through your current session. Pick up where you left off.';
  document.getElementById('hero-ring-pct').textContent = progress + '%';

  const circumference = 188.5;
  const offset = circumference - (circumference * progress / 100);
  document.getElementById('hero-ring-fg').setAttribute('stroke-dashoffset', offset);
}

function heroResumePractice() {
  const lastMode = localStorage.getItem('bel_last_mode');
  if (lastMode) window.switchToMode(lastMode);
}
```

### 3.2 Add Progress Bars to Skill Cards

**Location**: `index.html:970-1046` — Inside each `.practice-skill-btn`, after `.content-wrapper`, add:

```html
<div class="skill-progress-row">
  <div class="skill-progress-bar">
    <div class="skill-progress-fill" data-skill="speaking" style="width:0%"></div>
  </div>
  <span class="skill-progress-pct" data-skill="speaking">0%</span>
</div>
<div class="skill-progress-meta" data-skill="speaking"></div>
```

Repeat for each skill card, changing `data-skill` to `listening`, `reading`, `writing`.

**CSS** — Add after `.skill-card-chevron` rules (line ~811):

```css
/* ── Skill Progress Bars ── */
.skill-progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 10px;
  position: relative;
  z-index: 1;
}

.skill-progress-bar {
  flex: 1;
  height: 6px;
  background: #EDF0EE;
  border-radius: 3px;
  overflow: hidden;
}

.skill-progress-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #5CC48A, #1A8A5C);
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.card-speaking .skill-progress-fill {
  background: linear-gradient(90deg, #F5D56B, #D4940A);
}

.skill-progress-pct {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-main);
  min-width: 30px;
  text-align: right;
}

.skill-progress-meta {
  font-size: 0.65rem;
  color: #A0ADA5;
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  position: relative;
  z-index: 1;
}
```

**JavaScript** — Add rendering logic:

```javascript
function updateSkillProgress() {
  const skills = ['speaking', 'listening', 'reading', 'writing'];
  skills.forEach(skill => {
    const progress = parseInt(localStorage.getItem('bel_progress_' + skill) || '0', 10);
    const lastPracticed = localStorage.getItem('bel_last_practiced_' + skill);

    const fills = document.querySelectorAll('.skill-progress-fill[data-skill="' + skill + '"]');
    const pcts = document.querySelectorAll('.skill-progress-pct[data-skill="' + skill + '"]');
    const metas = document.querySelectorAll('.skill-progress-meta[data-skill="' + skill + '"]');

    fills.forEach(el => el.style.width = progress + '%');
    pcts.forEach(el => el.textContent = progress + '%');
    metas.forEach(el => {
      if (lastPracticed) {
        el.innerHTML = '<span class="material-symbols-outlined" style="font-size:12px;">schedule</span> ' +
          formatTimeAgo(parseInt(lastPracticed, 10));
      } else {
        el.textContent = 'Not started yet';
      }
    });
  });
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return days + ' days ago';
}
```

### 3.3 Add Streak Counter to Header

**Location**: `index.html` — In the top nav/header, near the user avatar area.

```html
<div class="streak-badge" id="streak-badge" style="display:none;">
  <span class="material-symbols-outlined" style="font-size:14px;">local_fire_department</span>
  <span id="streak-count">0</span> days
</div>
```

**CSS**:

```css
.streak-badge {
  background: #FFF8E7;
  color: #92600A;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 5px 11px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid #FCEDC2;
}
```

**JavaScript**:

```javascript
function renderStreakBadge() {
  const badge = document.getElementById('streak-badge');
  const streak = calculateStreak();
  if (streak > 0) {
    badge.style.display = 'inline-flex';
    document.getElementById('streak-count').textContent = streak;
  } else {
    badge.style.display = 'none';
  }
}

function calculateStreak() {
  const history = JSON.parse(localStorage.getItem('bel_practice_dates') || '[]');
  if (!history.length) return 0;

  const today = new Date().toISOString().slice(0, 10);
  let streak = 0;
  let checkDate = new Date(today);

  for (let i = 0; i < 365; i++) {
    const dateStr = checkDate.toISOString().slice(0, 10);
    if (history.includes(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function recordPracticeDate() {
  const today = new Date().toISOString().slice(0, 10);
  const history = JSON.parse(localStorage.getItem('bel_practice_dates') || '[]');
  if (!history.includes(today)) {
    history.push(today);
    if (history.length > 365) history.shift();
    localStorage.setItem('bel_practice_dates', JSON.stringify(history));
  }
}
```

---

## 4. Phase 2 — Information Architecture Cleanup

**Estimated effort**: ~1 hour  
**Fixes audit**: #1 (two-step confusion), #3 (flat hierarchy), #10 (PTE/English toggle)

### 4.1 Hide Practice Modes Until Skill Selected

**File**: `style.css:824-831`

```css
/* NEW — Tutorial grid starts hidden */
.tutorial-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr); /* was 4 */
  gap: 16px; /* was 24px */
  margin-bottom: 32px;
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.3s ease,
              margin 0.3s ease;
  margin-top: 0;
}

.tutorial-grid.is-revealed {
  max-height: 2000px;
  opacity: 1;
  margin-top: 16px;
}
```

**File**: `script.js` — In `setSelectedPracticeSkill()` (line ~1460), add after filtering:

```javascript
const grid = document.querySelector('.tutorial-grid');
if (grid) grid.classList.add('is-revealed');
```

**File**: `index.html` — Remove or rephrase the instruction text "Select a skill first, then pick a practice mode." Replace with a section header:

```html
<h3 class="section-title" style="display:flex;align-items:center;gap:8px;">
  Practice modes
</h3>
```

### 4.2 Move PTE/English Toggle to Profile

**File**: `index.html:964-968` — Hide `.practice-scope-filter`:

```html
<!-- Remove from page. Auto-select scope based on user profile. -->
<!-- If needed, add to settings/profile page instead. -->
```

**File**: `script.js:1415-1434` — Keep `setPracticeScope()` logic, but call it on page load based on stored preference instead of showing UI toggle:

```javascript
// On page load, auto-apply scope
const savedScope = localStorage.getItem('bel_practice_scope') || 'english';
setPracticeScope(savedScope);
```

### 4.3 Sentence Case on Tab Labels

**File**: `index.html:939-954` — Change button text:

```
"Learning Center" → "Learning center"
"Daily Review"    → "Daily review"  
"Entertainment Hub" → "Entertainment"
```

---

## 5. Phase 3 — Visual Identity

**Estimated effort**: ~1.5 hours  
**Fixes audit**: #4 (generic aesthetic), #9 (decorative illustrations)

### 5.1 Update Root CSS Variables

**File**: `style.css:0-51` — Full replacement:

```css
:root {
  color-scheme: light;
  font-family: 'Outfit', system-ui, -apple-system, sans-serif;

  /* Color System — Green Primary */
  --primary: #1A8A5C;
  --primary-hover: #12704A;
  --primary-light: rgba(26, 138, 92, 0.08);
  --primary-tonal: #EEFAF2;

  --success: #1A8A5C;
  --success-hover: #12704A;
  --success-light: #EEFAF2;
  --success-text: #0D5E3A;

  --danger: #d93025;
  --danger-hover: #b3261e;
  --danger-light: #fce8e6;
  --danger-text: #a50e0e;

  --warning: #D4940A;
  --warning-bg: linear-gradient(135deg, #FFF8E7 0%, #FCEDC2 100%);
  --warning-text: #92600A;

  --bg-main: #FBFCFB;
  --bg-card: #FFFFFF;
  --bg-input: #EDF0EE;

  --text-main: #1A2E22;
  --text-muted: #8A9990;
  --text-body: #5A7565;
  --border-light: #E8ECE9;

  /* Elevation */
  --shadow-sm: 0 1px 3px rgba(26, 46, 34, 0.06);
  --shadow-md: 0 4px 12px rgba(26, 46, 34, 0.08);
  --shadow-premium: 0 10px 40px rgba(26, 46, 34, 0.04);

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --radius-xl: 32px;
  --radius-pill: 500px;

  --transition-base: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  --transition-fast: all 0.2s ease-out;
}
```

### 5.2 Update Pulse Animation Color

**File**: `style.css:66-78` — Change blue to green:

```css
@keyframes pulse-soft {
  0%   { box-shadow: 0 0 0 0 rgba(26, 138, 92, 0.4); }
  70%  { box-shadow: 0 0 0 10px rgba(26, 138, 92, 0); }
  100% { box-shadow: 0 0 0 0 rgba(26, 138, 92, 0); }
}
```

### 5.3 Remove Watermark SVGs

**File**: `index.html:970-1046` — Remove all `<svg class="watermark">...</svg>` elements from inside each `.practice-skill-btn`.

**File**: `style.css:738-758` — Remove or comment out `.watermark` and `.practice-skill-btn:hover .watermark` rules.

### 5.4 Add Left-Border Accents to Skill Cards

**File**: `style.css` — Add after `.practice-skill-btn` base rules:

```css
.practice-skill-btn {
  border-left: 3px solid transparent;
  border-radius: 14px; /* slightly smaller than 16px */
}

.practice-skill-btn.card-speaking { border-left-color: #D4940A; }
.practice-skill-btn.card-listening { border-left-color: #2B6CB0; }
.practice-skill-btn.card-reading { border-left-color: #1A8A5C; }
.practice-skill-btn.card-writing { border-left-color: #1A4971; }
```

### 5.5 Update Segmented Control Active Color

**File**: `style.css:553-557`:

```css
/* OLD */
.segmented-btn.active { color: var(--primary); }

/* Already inherits new --primary (#1A8A5C), no change needed if Phase 5.1 is done first */
```

### 5.6 Update Mode Cards — Drop Glassmorphism

**File**: `style.css:858-875`:

```css
/* OLD */
.modern-card {
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  ...
}

/* NEW */
.modern-card {
  background: #FFFFFF;
  /* backdrop-filter removed for performance */
  border: 1.5px solid #E8ECE9;
  border-radius: 14px;
  cursor: pointer;
  transition: transform 0.25s var(--ease-smooth),
              box-shadow 0.25s var(--ease-smooth),
              border-color 0.25s var(--ease-smooth);
  display: flex;
  flex-direction: column;
  position: relative;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.modern-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: #1A8A5C;
}
```

### 5.7 Update Tutorial Grid to 3 Columns

**File**: `style.css:828`:

```css
/* OLD */
grid-template-columns: repeat(4, 1fr);

/* NEW */
grid-template-columns: repeat(3, 1fr);
```

### 5.8 Add "Help Me Choose" Footer

**File**: `index.html` — Move the "Help me choose a mode" button from the bottom to a styled footer card. Update the wrapper:

```html
<div class="help-choose-footer" onclick="handleHelpChoose()">
  <span class="material-symbols-outlined" style="font-size:16px;">auto_awesome</span>
  Not sure where to start? Let me help you choose
</div>
```

**CSS**:

```css
.help-choose-footer {
  margin-top: 16px;
  text-align: center;
  padding: 12px 16px;
  background: #FFF8E7;
  border-radius: 12px;
  border: 1px solid #FCEDC2;
  cursor: pointer;
  transition: all 0.15s;
  font-size: 0.85rem;
  color: #92600A;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.help-choose-footer:hover {
  background: #FFF3D6;
  border-color: #F5D56B;
}
```

---

## 6. Phase 4 — Accessibility

**Estimated effort**: ~1 hour  
**Fixes audit**: #11-14

### 6.1 Add ARIA Labels

**File**: `index.html` — Header icons:

```html
<!-- Notification bell -->
<button aria-label="4 notifications" class="notification-btn">...</button>

<!-- User avatar -->
<button aria-label="User profile" class="avatar-btn">...</button>
```

**File**: `index.html:970-1046` — Skill card chevrons:

```html
<!-- Add to each .practice-skill-btn -->
<span class="skill-card-chevron material-symbols-outlined" aria-hidden="true">chevron_right</span>
```

Each `.practice-skill-btn` should have:

```html
<button class="practice-skill-btn card-speaking"
        role="tab"
        aria-selected="false"
        data-practice-skill="speaking">
```

### 6.2 Add Tablist Pattern to Segmented Controls

**File**: `index.html:939-954`:

```html
<div class="dashboard-segmented-control" role="tablist" aria-label="Dashboard sections">
  <button class="segmented-btn active" role="tab" aria-selected="true" id="btn-panel-tutorials">
    Learning center
  </button>
  <button class="segmented-btn" role="tab" aria-selected="false" id="btn-panel-srs">
    Daily review
  </button>
  <button class="segmented-btn" role="tab" aria-selected="false" id="btn-panel-entertainment">
    Entertainment
  </button>
</div>
```

**File**: `script.js` — Add keyboard handler in `toggleDashboardPanel()`:

```javascript
document.querySelector('.dashboard-segmented-control').addEventListener('keydown', (e) => {
  const tabs = [...e.currentTarget.querySelectorAll('[role="tab"]')];
  const current = tabs.indexOf(document.activeElement);
  let next = -1;

  if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
  else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;

  if (next >= 0) {
    e.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  }
});
```

### 6.3 Fix Color Contrast

Verify and update these specific pairings:

| Element | Background | Text color | Min ratio | Action |
|---|---|---|---|---|
| `.skill-progress-meta` | `#FFFFFF` | `#A0ADA5` → `#7A8A80` | 4.5:1 | Darken text |
| `.hero-continue-sub` | `#FFFFFF` | `#5A7565` | 4.5:1 | Already passes |
| Gold footer tip text | `#FFF8E7` | `#92600A` | 4.5:1 | Already passes |
| `.text-faint` timestamps | `#FFFFFF` | `#A0ADA5` → `#7A8A80` | 4.5:1 | Darken text |

### 6.4 Add Focus-Visible Rings

**File**: `style.css` — Ensure all interactive elements have visible focus:

```css
.practice-skill-btn:focus-visible,
.segmented-btn:focus-visible,
.modern-card:focus-visible,
.hero-continue-btn:focus-visible,
.help-choose-footer:focus-visible {
  outline: 3px solid rgba(26, 138, 92, 0.4);
  outline-offset: 2px;
}
```

---

## 7. Verification Checklist

After each phase, verify:

- [ ] Page loads without console errors
- [ ] All skill cards are clickable and filter correctly
- [ ] Mode switching works (click skill → see filtered mode cards)
- [ ] Colors render correctly in both light and dark mode
- [ ] Progress bars display and update from localStorage
- [ ] Hero card shows/hides based on practice history
- [ ] Streak badge calculates correctly
- [ ] Tab keyboard navigation (arrow keys) works
- [ ] Screen reader reads all interactive elements
- [ ] No WCAG AA contrast failures (use browser DevTools audit)
- [ ] Responsive layout works at 500px, 640px, 900px, 1200px widths
- [ ] Hover states work on all cards
- [ ] Animations respect `prefers-reduced-motion`

---

## 8. Dark Mode Considerations

The current CSS uses `color-scheme: light` with no dark mode support. When dark mode is added in the future, use this palette:

| Light token | Dark value |
|---|---|
| `--bg-main: #FBFCFB` | `#0F1210` |
| `--bg-card: #FFFFFF` | `#1A1E1B` |
| `--border-light: #E8ECE9` | `#2A3230` |
| `--text-main: #1A2E22` | `#E8F0EC` |
| `--text-muted: #8A9990` | `#7A8A80` |
| `--primary: #1A8A5C` | `#5CC48A` (lighter green for dark bg) |
| Gold/Blue accent colors | Same hex values (already high contrast) |

---

## 9. localStorage Keys Reference

| Key | Type | Description |
|---|---|---|
| `bel_last_mode` | string | Last practiced mode ID (e.g., `'read-aloud'`) |
| `bel_last_skill` | string | Last practiced skill (e.g., `'reading'`) |
| `bel_progress_{skill}` | number (0-100) | Per-skill progress percentage |
| `bel_last_practiced_{skill}` | timestamp (ms) | Last practice timestamp per skill |
| `bel_practice_dates` | JSON array | ISO date strings for streak calculation |
| `bel_practice_scope` | string | `'pte'` or `'english'` |

These keys should be set inside `window.switchToMode()` when a learner starts or completes exercises.

---

## 10. Edge Case Audit (Addendum)

> Added after audit pass — these issues are not covered in Phases 1–4 above and must be addressed during implementation.

### 10.1 `--primary` Blast Radius

**Issue**: `--primary` is referenced **232 times across 18 files**, not just `style.css`. Changing `:root { --primary }` affects CRM admin, classroom, landing pages, and practice compact mode.

**Mitigation**: Phase 1 must audit all 18 files. For pages that should keep the old blue primary, scope the new green `--primary` under a `.practice-page` or `#dashboard` selector instead of `:root`. Alternatively, define a new `--primary-green` and migrate practice-page references to it.

**Files affected** (non-exhaustive): `style.css`, `crm-admin.css`, `style-practice-compact.css`, `classroom.css`, `landing/vi/style.css`, `landing/en/style.css`, and 12+ JS files referencing `--primary` via `getComputedStyle`.

### 10.2 Conflicting Design Token Files

**Issue**: `design-tokens.css` defines `--brand-primary: #1557b0` and `--color-info: #1a73e8`. `style-practice-compact.css` overrides `--primary: #4F46E5` (indigo) on line 7. None of these align with the new green primary.

**Mitigation**:
- Update `design-tokens.css` to use the new `--brand-primary` value, or deprecate it in favor of the canonical `:root` token.
- Decide whether `style-practice-compact.css` should inherit the new primary or retain its indigo override (it's used in compact/mobile practice mode).

### 10.3 Hardcoded Hex Values

**Issue**: 44 instances of `#1a73e8` (current blue primary) are hardcoded across 10 files, bypassing CSS variables. The token-based approach won't reach them.

**Mitigation**: Run a codebase-wide find-and-replace for `#1a73e8` → `var(--primary)` where possible. In JS files where CSS variable syntax isn't valid (e.g., inline styles, canvas), replace with the new hex value `#1A8A5C`.

### 10.4 ARIA Attribute Conflict

**Issue**: The plan proposes `role="tab"` + `aria-selected` on skill filter buttons, but `index.html` lines 965–1025 already use `aria-pressed="true/false"`, and `renderPracticeLauncher()` toggles `aria-pressed` programmatically.

**Mitigation**: Pick one pattern:
- **Toggle button** (current): keep `aria-pressed`, remove `role="tab"` from plan.
- **Tab** (plan): switch to `role="tablist"` container + `role="tab"` buttons + `aria-selected`, and update `renderPracticeLauncher()` to toggle `aria-selected` instead of `aria-pressed`.

**Recommendation**: Keep `aria-pressed` (toggle button pattern). The skill filter doesn't control tab panels — it filters a card grid. Tab semantics are incorrect here.

### 10.5 CSS Specificity War

**Issue**: `design-tokens.css` lines 53–62 apply `!important` to `.tutorial-grid .tutorial-btn` (border, box-shadow, background, transform). Any new tutorial card styles in `style.css` will lose the specificity battle.

**Mitigation**: Either:
- Move the new tutorial card styles into `design-tokens.css` (replacing the existing `!important` rules), or
- Add the new styles with matching specificity + `!important`, or
- Remove the `!important` from `design-tokens.css` and ensure load order is correct.

### 10.6 No Dark Mode CSS Infrastructure

**Issue**: `style.css` contains zero `@media (prefers-color-scheme: dark)` queries. Section 8 of this plan provides a dark palette table but no implementation guidance.

**Mitigation**: Add to Phase 4 (or create a Phase 5):
1. Add `<meta name="color-scheme" content="light dark">` to `index.html`.
2. Create a `@media (prefers-color-scheme: dark)` block in `style.css` that redefines all `:root` color tokens.
3. Add a manual toggle button that sets `data-theme="dark"` on `<html>` and persists choice to `localStorage`.
4. Use `[data-theme="dark"]` selector to override tokens when the user forces dark mode.

### 10.7 `prefers-reduced-motion` Scope

**Issue**: The single existing rule at `style.css:1540` is a blanket kill: `animation: none !important; transition: none !important` on `*`. The plan's new animations (reveal, progress bar pulse, streak counter) will all be disabled by this rule with no graceful fallback.

**Mitigation**: Either:
- Accept the blanket kill (simplest — users who want reduced motion get no animations), or
- Replace the blanket rule with scoped `@media (prefers-reduced-motion: reduce)` blocks per animation, providing static fallbacks (e.g., progress bar starts at final width, cards appear without stagger).

### 10.8 localStorage Write Integration

**Issue**: The plan introduces keys like `bel_last_mode`, `bel_progress_{skill}`, `bel_last_practiced_{skill}`, and `bel_practice_dates`, but `window.switchToMode()` in `script.js` doesn't write any `bel_` keys. Without adding the writes, progress bars and streak counter will render empty.

**Mitigation**: Add to Phase 3 implementation:
```js
// Inside switchToMode(), after mode switch confirms:
localStorage.setItem('bel_last_mode', modeId);
localStorage.setItem('bel_last_skill', selectedPracticeSkill);
localStorage.setItem('bel_last_practiced_' + selectedPracticeSkill, Date.now().toString());

// Inside the mode completion callback (when a practice session ends):
const key = 'bel_progress_' + selectedPracticeSkill;
const current = parseInt(localStorage.getItem(key) || '0', 10);
localStorage.setItem(key, Math.min(100, current + delta).toString());

// Streak update:
const dates = JSON.parse(localStorage.getItem('bel_practice_dates') || '[]');
const today = new Date().toISOString().slice(0, 10);
if (!dates.includes(today)) {
  dates.push(today);
  localStorage.setItem('bel_practice_dates', JSON.stringify(dates));
}
```

### 10.9 Border-Radius + Border-Left Visual Artifact

**Issue**: The plan adds `border-left: 3px solid var(--accent-color)` to skill cards with `border-radius: 14px`. The left corners will show the colored border curving while the right corners remain borderless — creating an asymmetric, visually broken appearance.

**Mitigation**: Use a `::before` pseudo-element instead:
```css
.practice-skill-btn {
  position: relative;
  overflow: hidden;
}
.practice-skill-btn::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent-color);
  border-radius: 3px 0 0 3px;
}
```

### 10.10 Accent Color References Beyond `style.css`

**Issue**: Skill accent colors (`#3b82f6`, `#8b5cf6`, `#10b981`, `#f59e0b`) appear in 42+ files beyond `style.css` — including JS files setting inline styles, HTML attributes, and other CSS files.

**Mitigation**: If the accent palette changes, run a codebase-wide grep for each old hex value and update. If the accent colors are staying the same (the plan keeps them), document this explicitly so future implementers don't accidentally change them.

---

### Audit Summary

| # | Finding | Severity | Phase Impact |
|---|---|---|---|
| 10.1 | `--primary` blast radius (232 refs, 18 files) | **High** | Phase 1 |
| 10.2 | Conflicting design token files | **High** | Phase 1 |
| 10.3 | 44 hardcoded `#1a73e8` values | **Medium** | Phase 1 |
| 10.4 | ARIA `aria-pressed` vs `aria-selected` conflict | **Medium** | Phase 2 |
| 10.5 | `!important` specificity war on tutorial cards | **Medium** | Phase 2 |
| 10.6 | No dark mode CSS infrastructure | **Low** | Phase 4+ |
| 10.7 | Blanket `prefers-reduced-motion` kills new animations | **Low** | Phase 2 |
| 10.8 | localStorage writes missing from `switchToMode()` | **High** | Phase 3 |
| 10.9 | Border-radius + border-left visual artifact | **Low** | Phase 2 |
| 10.10 | Accent colors in 42+ files | **Info** | Phase 1 |
