---
name: mobile-app-development
description: Creating mobile apps from web apps using PWA, React Native, or Capacitor. Use when converting the web app to a mobile app or adding native app features.
---

# Mobile App Development Skill

This skill covers **converting the dictation practice web app** to a mobile app using PWA, React Native, or Capacitor.

---

## Approach Comparison

| Approach | Pros | Cons | Best For |
| :--- | :--- | :--- | :--- |
| **PWA** | Minimal code changes, no app store | Limited native APIs | Quick deployment |
| **Capacitor** | Reuse web code, native plugins | Additional build step | Existing web app |
| **React Native** | Full native performance | Complete rewrite | Performance-critical |

---

## Option 1: Progressive Web App (PWA)

### Requirements

1. `manifest.json` - App metadata
2. Service Worker - Offline support
3. HTTPS - Required for PWA

### manifest.json

```json
{
    "name": "Dictation Practice",
    "short_name": "Dictation",
    "description": "Practice English pronunciation and dictation",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#0f0f23",
    "theme_color": "#667eea",
    "orientation": "portrait-primary",
    "icons": [
        {
            "src": "/icons/icon-192.png",
            "sizes": "192x192",
            "type": "image/png"
        },
        {
            "src": "/icons/icon-512.png",
            "sizes": "512x512",
            "type": "image/png"
        }
    ]
}
```

### Service Worker (sw.js)

```javascript
const CACHE_NAME = 'dictation-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/icons/icon-192.png'
];

// Install - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
    );
});

// Fetch - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});
```

### Register Service Worker

```javascript
// In index.html or script.js
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW registered'))
        .catch(err => console.error('SW failed:', err));
}
```

---

## Option 2: Capacitor (Ionic)

### Setup

```bash
# Install Capacitor
npm install @capacitor/core @capacitor/cli
npx cap init "Dictation Practice" com.yourcompany.dictation

# Add platforms
npm install @capacitor/android @capacitor/ios
npx cap add android
npx cap add ios
```

### capacitor.config.ts

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.yourcompany.dictation',
    appName: 'Dictation Practice',
    webDir: 'dist',
    server: {
        androidScheme: 'https'
    },
    plugins: {
        SplashScreen: {
            launchAutoHide: true,
            backgroundColor: '#0f0f23'
        }
    }
};

export default config;
```

### Native Plugins

```bash
# Audio recording
npm install @capacitor-community/speech-recognition

# Push notifications
npm install @capacitor/push-notifications

# Storage
npm install @capacitor/preferences
```

### Build & Deploy

```bash
# Build web app
npm run build

# Sync to native projects
npx cap sync

# Open in IDE
npx cap open android  # Opens Android Studio
npx cap open ios      # Opens Xcode
```

---

## Option 3: React Native (New Project)

### Project Structure

```text
dictation-native/
├── src/
│   ├── components/
│   │   ├── AudioPlayer.tsx
│   │   ├── DictationInput.tsx
│   │   └── PronunciationFeedback.tsx
│   ├── screens/
│   │   ├── HomeScreen.tsx
│   │   ├── PracticeScreen.tsx
│   │   └── SRSReviewScreen.tsx
│   ├── services/
│   │   ├── api.ts
│   │   └── storage.ts
│   └── App.tsx
├── package.json
└── app.json
```

### Key Dependencies

```json
{
    "dependencies": {
        "react-native": "^0.72.0",
        "expo": "^49.0.0",
        "expo-av": "^13.0.0",
        "expo-speech": "^11.0.0",
        "@react-navigation/native": "^6.0.0"
    }
}
```

### Audio Recording (React Native)

```typescript
import { Audio } from 'expo-av';

async function startRecording() {
    await Audio.requestPermissionsAsync();
    await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
    });
    
    const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    
    return recording;
}
```

---

## Platform-Specific Considerations

### iOS

- Requires Apple Developer account ($99/year)
- TestFlight for beta testing
- App Store review process (1-7 days)
- Audio recording requires `NSMicrophoneUsageDescription` in Info.plist

### Android

- Google Play Developer account ($25 one-time)
- Internal testing tracks for beta
- Review process (1-3 days typically)
- Audio recording requires `RECORD_AUDIO` permission

---

## Deployment Checklist

### PWA

- [ ] manifest.json configured
- [ ] Service worker registered
- [ ] App icons (192x192, 512x512)
- [ ] HTTPS enabled
- [ ] Tested "Add to Home Screen"

### Capacitor

- [ ] Web build completed
- [ ] Native projects synced
- [ ] App icons for all sizes
- [ ] Splash screens configured
- [ ] Permissions declared

### App Store

- [ ] Screenshots for all device sizes
- [ ] App description and keywords
- [ ] Privacy policy URL
- [ ] Age rating questionnaire completed
