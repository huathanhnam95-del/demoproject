/**
 * Database Service for Word Reference Caching
 * Uses Firestore (Modular SDK v9+) to cache word data from Merriam-Webster
 */

import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    increment,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { config } from './config.js';

export class DatabaseService {
    constructor() {
        // window.firebaseDb is initialized in index.html modular script
        this.db = window.firebaseDb;
        this.collectionName = config.wordReferencesCollection;

        if (!this.db) {
            console.warn('Firebase Firestore not initialized - database caching disabled');
        }
    }

    /**
     * Check if Firebase is available
     */
    isAvailable() {
        return !!this.db;
    }

    /**
     * Get word data from database
     * Returns null if not found
     */
    async getWord(word) {
        if (!this.isAvailable()) return null;

        const normalizedWord = word.toLowerCase().trim();

        try {
            const docRef = doc(this.db, this.collectionName, normalizedWord);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                console.log('📚 Database hit:', normalizedWord);

                // Update search count (fire and forget)
                updateDoc(docRef, {
                    searchCount: increment(1),
                    lastAccessedAt: serverTimestamp()
                }).catch(err => {
                    console.warn('Failed to update stats for:', normalizedWord, err.message);
                });

                return docSnap.data();
            }

            console.log('📚 Database miss:', normalizedWord);
            return null;

        } catch (error) {
            console.error('Database error (getWord):', error);
            return null;
        }
    }

    /**
     * Save word data to database
     */
    async saveWord(wordData) {
        if (!this.isAvailable()) return false;

        const normalizedWord = wordData.word.toLowerCase().trim();

        try {
            const docRef = doc(this.db, this.collectionName, normalizedWord);

            await setDoc(docRef, {
                ...wordData,
                word: normalizedWord,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                searchCount: 1
            }, { merge: true });

            console.log('📚 Saved to database:', normalizedWord);
            return true;

        } catch (error) {
            console.error('Database error (saveWord):', error);
            return false;
        }
    }

    /**
     * Check if word exists in database
     */
    async hasWord(word) {
        if (!this.isAvailable()) return false;

        const normalizedWord = word.toLowerCase().trim();

        try {
            const docRef = doc(this.db, this.collectionName, normalizedWord);
            const docSnap = await getDoc(docRef);
            return docSnap.exists();
        } catch (error) {
            console.error('Database error (hasWord):', error);
            return false;
        }
    }
}
