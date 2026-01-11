/**
 * Database Service for Word Reference Caching
 * Uses Firestore to cache word data from Merriam-Webster
 */

import { config } from './config.js';

export class DatabaseService {
    constructor() {
        // Use existing Firebase compat SDK pattern
        if (typeof firebase === 'undefined' || !firebase.firestore) {
            console.warn('Firebase not initialized - database caching disabled');
            this.db = null;
        } else {
            this.db = firebase.firestore();
        }
        this.collection = config.wordReferencesCollection;
    }

    /**
     * Check if Firebase is available
     */
    isAvailable() {
        return this.db !== null;
    }

    /**
     * Get word data from database
     * Returns null if not found
     */
    async getWord(word) {
        if (!this.isAvailable()) return null;

        const normalizedWord = word.toLowerCase().trim();

        try {
            const docRef = this.db.collection(this.collection).doc(normalizedWord);
            const doc = await docRef.get();

            if (doc.exists) {
                console.log('📚 Database hit:', normalizedWord);

                // Update search count (fire and forget)
                docRef.update({
                    searchCount: firebase.firestore.FieldValue.increment(1),
                    lastAccessedAt: firebase.firestore.FieldValue.serverTimestamp()
                }).catch(() => { });

                return doc.data();
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
            const docRef = this.db.collection(this.collection).doc(normalizedWord);

            await docRef.set({
                ...wordData,
                word: normalizedWord,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                searchCount: 1
            });

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
            const docRef = this.db.collection(this.collection).doc(normalizedWord);
            const doc = await docRef.get();
            return doc.exists;
        } catch (error) {
            console.error('Database error (hasWord):', error);
            return false;
        }
    }
}
