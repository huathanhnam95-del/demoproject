/**
 * Vocabulary Book Module
 * Handles word tracking, bookmarking, and mastery logic
 */

import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    arrayUnion,
    arrayRemove,
    serverTimestamp,
    increment,
    collection,
    query,
    where,
    limit,
    getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// No IIFE needed for module
const VocabularyBook = (function () {
    'use strict';

    // Firebase references
    let db = null;
    let currentUserId = null;

    // Local cache
    let vocabCache = {
        bookmarkedWords: [],
        wordStats: {},
        frequentlyMissed: []
    };

    // DOM elements
    let vocabPanelToggle, vocabPanelSide, vocabPanelContent, vocabPanelCloseBtn;
    let vocabBookmarkedList, vocabFrequentList;
    let vocabAddModal, vocabAddWords, vocabAddBtn, vocabSkipBtn, vocabAddClose;

    // Current missed words for the add modal
    let currentMissedWords = [];
    let currentQuestionId = null;
    let currentMode = null;

    /**
     * Initialize the Vocabulary Book module
     */
    function init() {
        // Init DB from global if available (fallback) or wait for setUser
        if (window.firebaseDb) {
            db = window.firebaseDb;
        }

        // Get DOM elements
        vocabPanelToggle = document.getElementById('vocab-panel-toggle');
        vocabPanelSide = document.getElementById('vocab-panel-side');
        vocabPanelContent = document.getElementById('vocab-panel-content');
        vocabPanelCloseBtn = document.getElementById('vocab-panel-close-btn');
        vocabBookmarkedList = document.getElementById('vocab-bookmarked-list');
        vocabFrequentList = document.getElementById('vocab-frequent-list');
        vocabAddModal = document.getElementById('vocab-add-modal');
        vocabAddWords = document.getElementById('vocab-add-words');
        vocabAddBtn = document.getElementById('vocab-add-btn');
        vocabSkipBtn = document.getElementById('vocab-skip-btn');
        vocabAddClose = document.getElementById('vocab-add-close');

        console.log('[VocabBook] Init - Elements found:', {
            toggle: !!vocabPanelToggle,
            panel: !!vocabPanelSide,
            modal: !!vocabAddModal,
            addBtn: !!vocabAddBtn
        });

        // Setup event listeners
        if (vocabPanelToggle) {
            vocabPanelToggle.addEventListener('click', togglePanel);
        }
        if (vocabPanelCloseBtn) {
            vocabPanelCloseBtn.addEventListener('click', closePanel);
        }
        if (vocabAddBtn) {
            vocabAddBtn.addEventListener('click', handleAddSelected);
        }
        if (vocabSkipBtn) {
            vocabSkipBtn.addEventListener('click', hideAddModal);
        }
        if (vocabAddClose) {
            vocabAddClose.addEventListener('click', hideAddModal);
        }

        // Exclusivity: Close Vocab when Progress Toggle is clicked
        const progressToggle = document.getElementById('progress-panel-toggle');
        if (progressToggle) {
            progressToggle.addEventListener('click', closePanel);
        }

        console.log('[VocabBook] Module initialized');
    }

    /**
     * Set Firebase references when user logs in
     */
    function setUser(userId, firestore) {
        currentUserId = userId;
        // Prefer passed firestore, fallback to global, then init new
        db = firestore || window.firebaseDb;

        if (!db && window.firebaseApp) {
            db = getFirestore(window.firebaseApp);
        }

        console.log('[VocabBook] setUser:', userId, 'db:', !!db);

        if (userId) {
            loadVocabData();
        }
    }

    /**
     * Check if vocabulary book is unlocked for current user
     */
    async function isUnlocked() {
        if (!currentUserId) {
            // console.log('[VocabBook] isUnlocked: No currentUserId set');
            return false;
        }

        if (!db) {
            console.error('[VocabBook] isUnlocked: DB not set');
            return false;
        }

        try {
            const userDoc = await getDoc(doc(db, 'users', currentUserId));
            if (userDoc.exists()) {
                const data = userDoc.data();
                const isUnlocked = data.vocabularyBookUnlocked === true;

                // Auto-fix: If false, check history just in case
                if (!isUnlocked) {
                    try {
                        const historyRef = collection(db, 'users', currentUserId, 'pointsHistory');
                        const q = query(historyRef, where('title', '==', 'Unlock: Vocabulary Book'), limit(1));
                        const snapshot = await getDocs(q);

                        if (!snapshot.empty) {
                            console.log('[VocabBook] Found purchase in history, auto-fixing flag...');
                            await updateDoc(doc(db, 'users', currentUserId), {
                                vocabularyBookUnlocked: true
                            });
                            return true;
                        }
                    } catch (err) {
                        console.warn('Error checking history for autofix:', err);
                    }
                }

                // console.log('[VocabBook] isUnlocked check:', isUnlocked, 'uid:', currentUserId);
                return isUnlocked;
            }
        } catch (e) {
            console.error('[VocabBook] Error checking vocab unlock status:', e);
        }
        return false;
    }

    /**
     * Load vocabulary data from Firestore
     */
    async function loadVocabData() {
        if (!currentUserId || !db) return;

        try {
            const vocabDoc = await getDoc(doc(db, 'users', currentUserId, 'vocabularyBook', 'data'));

            if (vocabDoc.exists()) {
                const data = vocabDoc.data();
                vocabCache.bookmarkedWords = data.bookmarkedWords || [];
                vocabCache.wordStats = data.wordStats || {};
                vocabCache.frequentlyMissed = data.frequentlyMissed || [];
            } else {
                // Initialize empty if doesn't exist
                vocabCache = {
                    bookmarkedWords: [],
                    wordStats: {},
                    frequentlyMissed: []
                };
            }

            renderBookmarkedWords();
            renderFrequentlyMissed();
        } catch (e) {
            console.error('Error loading vocab data:', e);
        }
    }

    /**
     * Save vocabulary data to Firestore
     */
    async function saveVocabData() {
        if (!currentUserId || !db) return;

        try {
            await setDoc(doc(db, 'users', currentUserId, 'vocabularyBook', 'data'), {
                bookmarkedWords: vocabCache.bookmarkedWords,
                wordStats: vocabCache.wordStats,
                frequentlyMissed: vocabCache.frequentlyMissed,
                updatedAt: serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.error('Error saving vocab data:', e);
        }
    }

    /**
     * Lemmatize a word using compromise.js (if available)
     */
    function lemmatize(word) {
        if (!word) return '';
        const cleanWord = word.toLowerCase().trim().replace(/[^a-z]/g, '');

        // Use compromise.js if available
        if (typeof nlp !== 'undefined') {
            const doc = nlp(cleanWord);
            // Get the root form
            const verbs = doc.verbs().toInfinitive().out('array');
            if (verbs.length > 0) return verbs[0];

            const nouns = doc.nouns().toSingular().out('array');
            if (nouns.length > 0) return nouns[0];
        }

        return cleanWord;
    }

    /**
     * Track a word that was missed
     */
    function trackMissedWord(word) {
        const lemma = lemmatize(word);
        if (!lemma) return;

        if (!vocabCache.wordStats[lemma]) {
            vocabCache.wordStats[lemma] = { missCount: 0, correctStreak: 0 };
        }

        vocabCache.wordStats[lemma].missCount++;
        vocabCache.wordStats[lemma].correctStreak = 0; // Reset streak on miss
        vocabCache.wordStats[lemma].lastMissedAt = new Date().toISOString();

        // Check if should be added to frequently missed (3+ misses)
        if (vocabCache.wordStats[lemma].missCount >= 3) {
            const existing = vocabCache.frequentlyMissed.find(w => w.lemma === lemma);
            if (!existing) {
                vocabCache.frequentlyMissed.push({
                    lemma: lemma,
                    originalWord: word,
                    missCount: vocabCache.wordStats[lemma].missCount,
                    addedAt: new Date().toISOString()
                });
            } else {
                existing.missCount = vocabCache.wordStats[lemma].missCount;
            }
        }

        saveVocabData();
    }

    /**
     * Track a word that was answered correctly
     */
    async function trackCorrectWord(word) {
        const lemma = lemmatize(word);
        if (!lemma) return;

        if (!vocabCache.wordStats[lemma]) return; // Only track if was missed before

        vocabCache.wordStats[lemma].correctStreak++;

        // Check if mastered (3 correct in a row)
        if (vocabCache.wordStats[lemma].correctStreak >= 3) {
            const freqIndex = vocabCache.frequentlyMissed.findIndex(w => w.lemma === lemma);
            if (freqIndex !== -1) {
                // Remove from frequently missed
                vocabCache.frequentlyMissed.splice(freqIndex, 1);

                // Award 10 points!
                await awardMasteryPoints(lemma);

                // Reset stats for this word
                delete vocabCache.wordStats[lemma];
            }
        }

        saveVocabData();
    }

    /**
     * Award points for mastering a frequently missed word
     */
    async function awardMasteryPoints(lemma) {
        if (!currentUserId || !db) return;

        try {
            const userRef = doc(db, 'users', currentUserId);
            await updateDoc(userRef, {
                practicePoints: increment(10)
            });

            // Show toast notification
            if (window.showPointsToast) {
                window.showPointsToast(10, 'vocabulary_mastered');
            }

            console.log(`Awarded 10 points for mastering word: ${lemma}`);
        } catch (e) {
            console.error('Error awarding mastery points:', e);
        }
    }

    /**
     * Add a word to bookmarked list
     */
    function addBookmarkedWord(word, questionId, mode) {
        const lemma = lemmatize(word);

        // Check for duplicates
        const exists = vocabCache.bookmarkedWords.some(w => w.lemma === lemma);
        if (exists) return false;

        vocabCache.bookmarkedWords.push({
            word: word,
            lemma: lemma,
            questionId: questionId,
            mode: mode,
            addedAt: new Date().toISOString()
        });

        saveVocabData();
        renderBookmarkedWords();
        return true;
    }

    /**
     * Remove a bookmarked word
     */
    function removeBookmarkedWord(lemma) {
        const index = vocabCache.bookmarkedWords.findIndex(w => w.lemma === lemma);
        if (index !== -1) {
            vocabCache.bookmarkedWords.splice(index, 1);
            saveVocabData();
            renderBookmarkedWords();
        }
    }

    /**
     * Show the "Add to Vocabulary" modal with missed words
     */
    async function showAddModal(missedWords, questionId, mode) {
        console.log('[VocabBook] showAddModal called:', { missedWords, questionId, mode });
        const unlocked = await isUnlocked();
        console.log('[VocabBook] isUnlocked result:', unlocked, 'modal element:', !!vocabAddModal);
        if (!unlocked || !vocabAddModal || missedWords.length === 0) {
            console.log('[VocabBook] Skipping modal - unlocked:', unlocked, 'modal:', !!vocabAddModal, 'words:', missedWords.length);
            return;
        }

        currentMissedWords = missedWords;
        currentQuestionId = questionId;
        currentMode = mode;

        // Clear previous words
        vocabAddWords.innerHTML = '';

        // Add checkboxes for each word
        missedWords.forEach((word, index) => {
            const item = document.createElement('div');
            item.className = 'vocab-add-word-item';
            item.innerHTML = `
        <input type="checkbox" id="vocab-word-${index}" value="${word}">
        <label for="vocab-word-${index}">${word}</label>
      `;
            item.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const checkbox = item.querySelector('input');
                    checkbox.checked = !checkbox.checked;
                }
                item.classList.toggle('selected', item.querySelector('input').checked);
            });
            vocabAddWords.appendChild(item);
        });

        vocabAddModal.style.display = 'block';
    }

    /**
     * Hide the add modal
     */
    function hideAddModal() {
        if (vocabAddModal) {
            vocabAddModal.style.display = 'none';
        }
        currentMissedWords = [];
        currentQuestionId = null;
        currentMode = null;
    }

    /**
     * Handle adding selected words
     */
    function handleAddSelected() {
        const checkboxes = vocabAddWords.querySelectorAll('input:checked');
        let addedCount = 0;

        checkboxes.forEach(cb => {
            if (addBookmarkedWord(cb.value, currentQuestionId, currentMode)) {
                addedCount++;
            }
        });

        if (addedCount > 0) {
            console.log(`Added ${addedCount} words to vocabulary book`);
        }

        hideAddModal();
    }

    /**
     * Render bookmarked words list
     */
    function renderBookmarkedWords() {
        if (!vocabBookmarkedList) return;

        if (vocabCache.bookmarkedWords.length === 0) {
            vocabBookmarkedList.innerHTML = '<div class="vocab-empty">No bookmarked words yet</div>';
            return;
        }

        vocabBookmarkedList.innerHTML = vocabCache.bookmarkedWords.map(w => `
      <div class="vocab-word-item">
        <div>
          <span class="vocab-word-text">${w.word}</span>
          <div class="vocab-word-meta">${w.mode} • Q${w.questionId}</div>
        </div>
        <button class="vocab-word-remove" data-lemma="${w.lemma}" title="Remove">×</button>
      </div>
    `).join('');

        // Add remove handlers
        vocabBookmarkedList.querySelectorAll('.vocab-word-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                removeBookmarkedWord(btn.dataset.lemma);
            });
        });
    }

    /**
     * Render frequently missed words list
     */
    function renderFrequentlyMissed() {
        if (!vocabFrequentList) return;

        if (vocabCache.frequentlyMissed.length === 0) {
            vocabFrequentList.innerHTML = '<div class="vocab-empty">No frequently missed words</div>';
            return;
        }

        vocabFrequentList.innerHTML = vocabCache.frequentlyMissed.map(w => {
            const stats = vocabCache.wordStats[w.lemma] || {};
            return `
        <div class="vocab-word-item">
          <div>
            <span class="vocab-word-text">${w.originalWord}</span>
            <div class="vocab-word-miss-count">Missed ${w.missCount}x</div>
          </div>
          <div class="vocab-word-streak">
            ${stats.correctStreak || 0}/3 ✓
          </div>
        </div>
      `;
        }).join('');
    }

    /**
     * Toggle panel open/close
     */
    function togglePanel() {
        if (vocabPanelSide) {
            // Exclusivity: Close Progress Panel if opening Vocab
            if (!vocabPanelSide.classList.contains('expanded')) {
                const progressPanel = document.getElementById('progress-panel-side');
                if (progressPanel) {
                    progressPanel.classList.remove('expanded');
                }
            }

            vocabPanelSide.classList.toggle('expanded');
            if (vocabPanelSide.classList.contains('expanded')) {
                loadVocabData(); // Refresh data when opening
            }
        }
    }

    /**
     * Close the panel
     */
    function closePanel() {
        if (vocabPanelSide) {
            vocabPanelSide.classList.remove('expanded');
        }
    }

    /**
     * Show toggle button when unlocked
     */
    function showToggle() {
        console.log('[VocabBook] showToggle called, element:', !!vocabPanelToggle);
        if (vocabPanelToggle) {
            vocabPanelToggle.style.display = 'flex';
            console.log('[VocabBook] Toggle now visible');
        } else {
            console.warn('[VocabBook] Toggle element not found!');
        }
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        setUser: setUser,
        isUnlocked: isUnlocked,
        trackMissedWord: trackMissedWord,
        trackCorrectWord: trackCorrectWord,
        showAddModal: showAddModal,
        hideAddModal: hideAddModal,
        showToggle: showToggle,
        loadData: loadVocabData
    };

})();

// Expose to window
window.VocabularyBook = VocabularyBook;

