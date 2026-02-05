/**
 * Firebase Initialization Module
 * 
 * Centralizes Firebase configuration and instances to avoid global exposure.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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

// Export instances
export { app, auth, db };

// INTERNAL USE ONLY: For non-module script legacy support (Temporary Migration)
// We still expose them BUT via a more controlled window object that we will eventually remove.
window.__FIREBASE_INTERNAL__ = { auth, db };
