import { PronunciationApp } from './app.js';

let bootedApp = null;

export function bootPronunciationApp() {
    const pronouncePanel = document.getElementById('mode-pronounce');
    if (!pronouncePanel) {
        return null;
    }

    if (!bootedApp) {
        bootedApp = new PronunciationApp();
    }

    return bootedApp;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPronunciationApp, { once: true });
} else {
    bootPronunciationApp();
}
