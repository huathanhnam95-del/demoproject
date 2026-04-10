/**
 * Firebase Initialization Module
 * 
 * Centralizes Firebase configuration and instances to avoid global exposure.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';

const firebaseConfig = {
    apiKey: "AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ",
    authDomain: "listening-tasks-3ae34.firebaseapp.com",
    projectId: "listening-tasks-3ae34",
    storageBucket: "listening-tasks-3ae34.firebasestorage.app",
    messagingSenderId: "737872673808",
    appId: "1:737872673808:web:4db57599aa22b4830fde95",
    measurementId: "G-1891MSSLXT"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

// ── Emulator Redirect (local dev only) ────────────────────────────
// When running locally, route all Firebase calls to local emulators
// so test data never touches production.
let _h = String(window.location.hostname || '').trim().toLowerCase();
if (_h.startsWith('[') && _h.endsWith(']')) _h = _h.slice(1, -1); // IPv6 literal
const isLocal = _h === 'localhost'
    || _h === '127.0.0.1'
    || _h === '::1'
    || _h.endsWith('.local')
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(_h)
    || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(_h)
    || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(_h);

if (isLocal) {
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, 'localhost', 5001);
    console.warn('🔧 [Modular SDK] Firebase Emulators active — local data only.');
}

// Export instances
export { app, auth, db, functions };

// INTERNAL USE ONLY: For non-module script legacy support (Temporary Migration)
// We still expose them BUT via a more controlled window object that we will eventually remove.
window.__FIREBASE_INTERNAL__ = { auth, db, functions };

// Legacy compat: some scripts still expect `window.auth.currentUser`.
window.auth = window.auth || auth;
