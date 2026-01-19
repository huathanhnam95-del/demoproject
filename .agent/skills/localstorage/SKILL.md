---
name: localstorage
description: LocalStorage and data persistence patterns for offline-first web apps. Use when working with saving user progress, caching data, or managing app state.
---

# LocalStorage & Data Persistence Skill

This skill covers **client-side data persistence** patterns for the dictation practice app.

---

## Storage Options Comparison

| Storage | Capacity | Persistence | Sync | Use Case |
|---------|----------|-------------|------|----------|
| **LocalStorage** | ~5-10MB | Permanent | No | Settings, progress |
| **SessionStorage** | ~5MB | Tab lifetime | No | Temporary state |
| **IndexedDB** | Large | Permanent | No | Large datasets |
| **Cookies** | 4KB | Configurable | Yes | Auth tokens |

---

## LocalStorage Patterns

### Basic CRUD

```javascript
// Create/Update
localStorage.setItem('key', JSON.stringify(value));

// Read
const value = JSON.parse(localStorage.getItem('key'));

// Delete
localStorage.removeItem('key');

// Clear all
localStorage.clear();
```

### Type-Safe Wrapper

```javascript
const Storage = {
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch {
            return defaultValue;
        }
    },
    
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                console.error('Storage quota exceeded');
            }
            return false;
        }
    },
    
    remove(key) {
        localStorage.removeItem(key);
    }
};
```

---

## Data Structures

### User Progress

```javascript
const progressData = {
    version: 1,  // For migration
    lastUpdated: Date.now(),
    
    typingMode: {
        wordsCompleted: 150,
        accuracy: 0.85,
        streak: 7
    },
    
    speakMode: {
        wordsAttempted: 50,
        averageScore: 72
    },
    
    coins: 1250,
    unlockedFeatures: ['expert-mode', 'all-lengths']
};

// Storage keys
const KEYS = {
    PROGRESS: 'user_progress',
    SRS_CARDS: 'srs_cards',
    SETTINGS: 'user_settings',
    CACHE_PREFIX: 'cache_'
};
```

---

## Versioned Storage (Migrations)

```javascript
const CURRENT_VERSION = 2;

function migrateStorage() {
    const data = Storage.get(KEYS.PROGRESS);
    if (!data) return;
    
    // Version 1 → 2: Added speakMode
    if (data.version === 1) {
        data.speakMode = { wordsAttempted: 0, averageScore: 0 };
        data.version = 2;
    }
    
    // Future migrations go here
    
    Storage.set(KEYS.PROGRESS, data);
}

// Call on app init
migrateStorage();
```

---

## Offline-First Pattern

```javascript
class OfflineFirstStore {
    constructor(storageKey, syncFn) {
        this.key = storageKey;
        this.syncFn = syncFn;
        this.pendingSync = [];
    }
    
    save(data) {
        // 1. Save locally immediately
        Storage.set(this.key, data);
        
        // 2. Queue for cloud sync
        this.queueSync(data);
    }
    
    async queueSync(data) {
        if (navigator.onLine) {
            await this.syncFn(data);
        } else {
            this.pendingSync.push(data);
            Storage.set(this.key + '_pending', this.pendingSync);
        }
    }
    
    async syncPending() {
        const pending = Storage.get(this.key + '_pending', []);
        for (const item of pending) {
            await this.syncFn(item);
        }
        Storage.remove(this.key + '_pending');
    }
}

// Listen for online status
window.addEventListener('online', () => {
    store.syncPending();
});
```

---

## Storage Events (Cross-Tab Sync)

```javascript
// Listen for changes in other tabs
window.addEventListener('storage', (e) => {
    if (e.key === KEYS.PROGRESS) {
        const newData = JSON.parse(e.newValue);
        updateUIWithProgress(newData);
    }
});
```

---

## Cache with Expiry

```javascript
function setCacheWithExpiry(key, data, ttlMs) {
    const item = {
        data,
        expiry: Date.now() + ttlMs
    };
    Storage.set(KEYS.CACHE_PREFIX + key, item);
}

function getCacheWithExpiry(key) {
    const item = Storage.get(KEYS.CACHE_PREFIX + key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
        Storage.remove(KEYS.CACHE_PREFIX + key);
        return null;
    }
    
    return item.data;
}
```

---

## Common Issues & Solutions

### Issue: QuotaExceededError

**Fix**: Implement cleanup strategy

```javascript
function cleanupOldCache() {
    const keys = Object.keys(localStorage)
        .filter(k => k.startsWith(KEYS.CACHE_PREFIX));
    
    // Remove oldest half
    keys.sort((a, b) => {
        const aTime = Storage.get(a)?.expiry || 0;
        const bTime = Storage.get(b)?.expiry || 0;
        return aTime - bTime;
    });
    
    keys.slice(0, Math.floor(keys.length / 2))
        .forEach(k => localStorage.removeItem(k));
}
```

### Issue: Data corruption

**Fix**: Always use try-catch, validate data shape

### Issue: Private browsing fails

**Fix**: Check availability first

```javascript
function isStorageAvailable() {
    try {
        const test = '__test__';
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
    } catch {
        return false;
    }
}
```

---

## Testing Checklist

- [ ] Data persists after page reload
- [ ] Data persists after browser restart
- [ ] Works in private/incognito mode (graceful fallback)
- [ ] Handles storage quota limits
- [ ] Cross-tab sync works
- [ ] Cloud sync resolves conflicts correctly
