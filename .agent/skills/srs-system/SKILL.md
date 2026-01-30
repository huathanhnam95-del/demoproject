---
name: srs-system
description: Spaced Repetition System implementation patterns including SM-2 algorithm, scheduling, and review UI. Use when working with vocabulary learning, review scheduling, or flashcard features.
---

# SRS System Skill

This skill covers the **Spaced Repetition System** implementation for vocabulary learning in the dictation practice app.

## Project Context

Key files:

- `srs-review.js` - Core SRS logic and UI
- `srs-review.css` - Review interface styles
- `vocab-book.js` - Vocabulary management

---

## SM-2 Algorithm

The SuperMemo 2 (SM-2) algorithm schedules reviews based on recall quality.

```javascript
function calculateNextReview(card, quality) {
    // quality: 0-5 (0=complete failure, 5=perfect recall)
    
    if (quality < 3) {
        // Failed - reset to beginning
        card.repetitions = 0;
        card.interval = 1;
    } else {
        // Success - increase interval
        if (card.repetitions === 0) {
            card.interval = 1;
        } else if (card.repetitions === 1) {
            card.interval = 6;
        } else {
            card.interval = Math.round(card.interval * card.easeFactor);
        }
        card.repetitions++;
    }
    
    // Update ease factor (min 1.3)
    card.easeFactor = Math.max(1.3,
        card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    );
    
    // Calculate next review date
    card.nextReview = addDays(new Date(), card.interval);
    
    return card;
}
```

---

## Data Structure

```javascript
const srsCard = {
    id: 'word_anonymous',
    word: 'anonymous',
    definition: 'not identified by name',
    example: 'an anonymous donor',
    
    // SRS fields
    repetitions: 0,      // Successful reviews in a row
    interval: 1,         // Days until next review
    easeFactor: 2.5,     // Difficulty multiplier
    nextReview: Date,    // Next review timestamp
    
    // Optional
    audioUrl: null,
    collocations: [],
    lastReviewed: Date
};
```

---

## Review Session Flow

```mermaid
flowchart TD
    A[Start Review] --> B[Get Due Cards]
    B --> C{Any Due?}
    C -->|No| D[Show "All Caught Up"]
    C -->|Yes| E[Show Card Front]
    E --> F[User Thinks]
    F --> G[Show Answer]
    G --> H[User Rates: Again/Hard/Good/Easy]
    H --> I[Calculate Next Review]
    I --> J{More Cards?}
    J -->|Yes| E
    J -->|No| K[Show Summary]
```

---

## Getting Due Cards

```javascript
function getDueCards() {
    const now = new Date();
    return cards.filter(card => {
        const nextReview = new Date(card.nextReview);
        return nextReview <= now;
    }).sort((a, b) => {
        // Prioritize by: overdue > new > ease
        return new Date(a.nextReview) - new Date(b.nextReview);
    });
}
```

---

## Quality Ratings

| Rating | Description | Interval Effect |
| :--- | :--- | :--- |
| **0 - Again** | Complete failure | Reset to 1 day |
| **1 - Hard** | Struggled | 1.2x current |
| **2 - Good** | Some hesitation | Normal progression |
| **3 - Easy** | Perfect recall | 2.5x current |

---

## LocalStorage Persistence

```javascript
const SRS_STORAGE_KEY = 'srs_cards';

function saveCards(cards) {
    localStorage.setItem(SRS_STORAGE_KEY, JSON.stringify(cards));
}

function loadCards() {
    const stored = localStorage.getItem(SRS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
}

// Sync with Firestore when user is logged in
async function syncWithCloud(userId) {
    const local = loadCards();
    const cloud = await getFirestoreCards(userId);
    const merged = mergeCardsWithConflictResolution(local, cloud);
    saveCards(merged);
    await saveFirestoreCards(userId, merged);
}
```

---

## Common Issues & Solutions

### Issue: Cards not appearing as due

**Check**: Date comparison logic, timezone handling

### Issue: Interval growing too fast

**Fix**: Cap maximum interval (e.g., 365 days)

### Issue: Data loss on clear storage

**Fix**: Implement cloud backup before clearing

### Issue: Duplicate cards after sync

**Fix**: Use deterministic IDs, implement deduplication

---

## Testing Checklist

- [ ] New card shows on day 1
- [ ] "Again" resets interval to 1
- [ ] "Easy" significantly increases interval
- [ ] Due count badge updates correctly
- [ ] Cards persist across sessions
- [ ] Cloud sync merges correctly
