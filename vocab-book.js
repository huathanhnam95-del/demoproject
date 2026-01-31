/**
 * Vocabulary Book Module
 * Handles word tracking, bookmarking, mastery logic, and full list modal
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
        frequentlyMissed: [],
        usedToMiss: [],      // Words with 3+ consecutive correct (moved from frequentlyMissed)
        masteredWords: []    // Words that passed 14-day SRS review
    };

    // Cache for phonetics to avoid API spam
    const phoneticCache = new Map();

    // DOM elements
    let vocabPanelToggle, vocabPanelSide, vocabPanelContent, vocabPanelCloseBtn, vocabPanelOverlay;
    let vocabBookmarkedList, vocabFrequentList;
    let vocabAddModal, vocabAddWords, vocabAddBtn, vocabSkipBtn, vocabAddClose;

    // New Modal Elements
    let vocabListModal, vocabListClose;
    let vocabTabs, vocabTabContents;
    let vocabTableBodyBookmarks, vocabTableBodyMissed;

    // Current missed words for the add modal
    let currentMissedWords = [];
    let currentQuestionId = null;
    let currentMode = null;
    let currentSentence = null;

    /**
     * Escape HTML special characters to prevent XSS
     */
    function escapeHtml(s) {
        return (String(s || '')).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    /**
     * Run an async map with a concurrency limit
     * Uses atomic index-queue pattern to prevent race conditions.
     */
    async function mapLimit(arr, limit, fn) {
        const ret = new Array(arr.length);
        let nextIndex = 0;

        const worker = async () => {
            while (true) {
                const idx = nextIndex++;
                if (idx >= arr.length) return;
                ret[idx] = await fn(arr[idx], idx);
            }
        };

        await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
        return ret;
    }

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
        vocabPanelOverlay = document.getElementById('vocab-panel-overlay'); // New overlay
        vocabBookmarkedList = document.getElementById('vocab-bookmarked-list');
        vocabFrequentList = document.getElementById('vocab-frequent-list');
        vocabAddModal = document.getElementById('vocab-add-modal');
        vocabAddWords = document.getElementById('vocab-add-words');
        vocabAddBtn = document.getElementById('vocab-add-btn');
        vocabSkipBtn = document.getElementById('vocab-skip-btn');
        vocabAddClose = document.getElementById('vocab-add-close');

        // New Modal Elements
        vocabListModal = document.getElementById('vocab-list-modal');
        vocabListClose = document.getElementById('vocab-list-close');
        vocabTabs = document.querySelectorAll('.vocab-tab-btn');
        vocabTabContents = document.querySelectorAll('.vocab-tab-content');
        vocabTableBodyBookmarks = document.getElementById('vocab-table-body-bookmarks');
        vocabTableBodyMissed = document.getElementById('vocab-table-body-missed');

        console.log('[VocabBook] Init - Elements found:', {
            toggle: !!vocabPanelToggle,
            panel: !!vocabPanelSide,
            overlay: !!vocabPanelOverlay,
            modal: !!vocabAddModal,
            listModal: !!vocabListModal
        });

        // Setup event listeners
        if (vocabPanelToggle) {
            vocabPanelToggle.addEventListener('click', togglePanel);
        }
        if (vocabPanelCloseBtn) {
            vocabPanelCloseBtn.addEventListener('click', closePanel);
        }
        if (vocabPanelOverlay) {
            vocabPanelOverlay.addEventListener('click', closePanel);
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
        if (vocabListClose) {
            vocabListClose.addEventListener('click', hideListModal);
        }

        // Improving Words toggle handler
        const improvingToggle = document.getElementById('vocab-improving-toggle');
        const improvingList = document.getElementById('vocab-improving-list');
        if (improvingToggle && improvingList) {
            improvingToggle.addEventListener('click', () => {
                const isExpanded = improvingToggle.classList.toggle('expanded');
                improvingList.style.display = isExpanded ? 'block' : 'none';
            });
        }

        // Manual Add Listeners
        const manualAddBtn = document.getElementById('vocab-manual-add-btn');
        const manualAddModal = document.getElementById('vocab-manual-add-modal');
        const manualSubmit = document.getElementById('manual-add-submit');
        const manualCancel = document.getElementById('manual-add-cancel');

        if (manualAddBtn) manualAddBtn.addEventListener('click', () => {
            if (manualAddModal) {
                manualAddModal.style.display = 'flex';
                setTimeout(() => document.getElementById('manual-add-input')?.focus(), 100);
            }
        });
        if (manualCancel) manualCancel.addEventListener('click', () => {
            if (manualAddModal) manualAddModal.style.display = 'none';
        });
        if (manualSubmit) manualSubmit.addEventListener('click', handleManualAddSubmit);

        // Modal Click-Outside-To-Close
        if (vocabListModal) {
            vocabListModal.addEventListener('click', (e) => {
                // If clicking the backdrop (the modal wrapper itself)
                if (e.target === vocabListModal) {
                    hideListModal();
                }
            });
        }
        if (manualAddModal) {
            manualAddModal.addEventListener('click', (e) => {
                if (e.target === manualAddModal) {
                    manualAddModal.style.display = 'none';
                }
            });
        }

        // Tab Switching
        vocabTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                switchTab(target);
            });
        });

        // Exclusivity: Close Vocab when Progress Toggle is clicked
        const progressToggle = document.getElementById('progress-panel-toggle');
        if (progressToggle) {
            progressToggle.addEventListener('click', closePanel);
        }

        console.log('[VocabBook] Module initialized');
    }

    /**
     * Handle Manual Add Submit
     */
    async function handleManualAddSubmit() {
        const input = document.getElementById('manual-add-input');
        const word = input?.value?.trim();
        if (!word) return;

        const manualAddModal = document.getElementById('vocab-manual-add-modal');
        if (manualAddModal) manualAddModal.style.display = 'none';

        // Add to bookmarks
        await addBookmarkedWord(word, 'manual');
        if (input) input.value = '';

        // Show brief confirmation
        alert(`Word "${word}" added to your list!`);

        // Refresh list if open
        if (document.getElementById('vocab-panel-side').classList.contains('open')) {
            renderBookmarkedWords();
        }
    }

    /**
     * Switch Tabs in List Modal
     */
    function switchTab(tabName) {
        // Update Buttons
        vocabTabs.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Update Content
        vocabTabContents.forEach(content => {
            content.classList.toggle('active', content.id === `tab-content-${tabName}`);
        });
    }

    /**
     * Show the List Modal
     */
    function showListModal(initialTab = 'bookmarks') {
        // Close the vocab side panel first to avoid stacking issues
        closePanel();

        if (vocabListModal) {
            vocabListModal.style.display = 'flex';
            // Small timeout to allow display transition if needed, but primarily for class
            setTimeout(() => {
                vocabListModal.classList.add('active');
            }, 10);

            switchTab(initialTab);
            renderListTable('bookmarks');
            renderListTable('missed');
        }
    }

    /**
     * Hide the List Modal
     */
    function hideListModal() {
        if (vocabListModal) {
            vocabListModal.classList.remove('active');
            // Wait for transition to finish before hiding
            setTimeout(() => {
                vocabListModal.style.display = 'none';
            }, 300);
        }
    }

    // ... (rest of file)

    /**
     * Show toggle button when unlocked
     */
    function showToggle() {
        if (vocabPanelToggle) {
            vocabPanelToggle.style.display = 'flex';
        }
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
        // Check unlock status immediately if possible, or wait for auth
        // We can optimistically show toggle if we suspect it's unlocked, 
        // but better to let auth-ui handler call it.
        // However, we can make it visible by default in CSS if we prefer.
    }

    /**
     * Fetch Phonetic data using the new Phonetics pipeline
     * Uses CMU Dict → Wiktionary → espeak-ng fallback chain
     */
    async function fetchPhonetics(word) {
        let cleanWord = word.trim().toLowerCase().replace(/[’]/g, "'").replace(/[^a-z']/g, '');
        if (!cleanWord) return null;

        // Semantic contraction expansion for IPA (e.g., "we'll" -> "will")
        if (window.DictionaryService && window.DictionaryService.detectContraction) {
            const contraction = window.DictionaryService.detectContraction(cleanWord);
            if (contraction && contraction.head) {
                cleanWord = contraction.head;
            }
        } else {
            // Replicate core head-word extraction if service not loaded or private
            const mLL = cleanWord.match(/^([a-z]+)'ll$/);
            if (mLL) cleanWord = 'will';
            else if (cleanWord.endsWith("n't")) {
                const base = cleanWord.slice(0, -3);
                cleanWord = base === 'wo' ? 'will' : base;
            }
        }

        // Check local cache first
        if (phoneticCache.has(cleanWord)) {
            return phoneticCache.get(cleanWord);
        }

        // Use the new Phonetics module (CMU Dict → Wiktionary → espeak-ng)
        if (typeof Phonetics !== 'undefined' && Phonetics.getIPA) {
            try {
                const ipa = await Phonetics.getIPA(cleanWord);
                phoneticCache.set(cleanWord, ipa || '');
                return ipa || '';
            } catch (e) {
                console.warn(`[VocabBook] Phonetics.getIPA failed for: ${cleanWord}`, e);
            }
        }

        // If reached here, Phonetics module failed or was unavailable
        phoneticCache.set(cleanWord, '');
        return '';
    }

    /**
     * Play Pronunciation using specific female voice if available
     */
    function playPronunciation(word) {
        if ('speechSynthesis' in window) {
            const synth = window.speechSynthesis;
            synth.cancel(); // Stop current

            const utterance = new SpeechSynthesisUtterance(word);
            utterance.lang = 'en-US';

            // Voice selection logic matching script.js
            const voices = synth.getVoices();
            const preferred = voices.find((v) =>
                /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
            );

            if (preferred) {
                utterance.voice = preferred;
            }
            // Keep rate normal/slightly slow for clarity (script.js uses 1.0, but 0.9 is often better for single words)
            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            synth.speak(utterance);
        }
    }

    /**
     * Render the Data Table for a tab
     */
    async function renderListTable(tabName) {
        const tbody = tabName === 'bookmarks' ? vocabTableBodyBookmarks : vocabTableBodyMissed;
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">Loading...</td></tr>';

        let items = [];
        if (tabName === 'bookmarks') {
            items = [...vocabCache.bookmarkedWords].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
        } else {
            items = [...vocabCache.frequentlyMissed].sort((a, b) => b.missCount - a.missCount);
        }

        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;">No words found.</td></tr>';
            return;
        }

        // Generate Rows
        const rowsHtml = items.map((item, index) => {
            const wordText = item.word || item.originalWord; // Handle both structures
            const lemma = item.lemma;
            const rowId = `vocab-row-${tabName}-${index}`;

            // Source info (mode + question ID)
            const mode = item.mode || '-';
            const questionId = item.questionId || '-';
            const sourceCell = `<td>
                <span class="vocab-badge vocab-badge-mode">${escapeHtml(mode)}</span>
                <span class="vocab-badge vocab-badge-q">Q${escapeHtml(questionId)}</span>
            </td>`;

            // Form (Part of Speech) - NEW: Replaced SRS Status
            const pos = item.partOfSpeech || 'unknown';
            const posLabel = pos === 'unknown' ? '-' : pos;
            const posClass = pos !== 'unknown' ? `vocab-badge-pos vocab-badge-pos-${pos}` : 'vocab-badge-pos';
            const formCell = `<td><span class="${posClass}">${escapeHtml(posLabel)}</span></td>`;

            // Stats column for Missed tab, Actions for Bookmarks
            let statsCell = '';
            if (tabName === 'missed') {
                statsCell = `<td><span class="vocab-badge vocab-badge-miss">${item.missCount}</span></td>`;
            } else {
                statsCell = `<td>
                    <button class="btn-icon-remove" onclick="window.VocabularyBook.removeViaModal('${escapeHtml(item.lemma)}')" title="Remove">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </td>`;
            }

            return `
                <tr id="${rowId}" class="vocab-row-main">
                    <td class="vocab-word-cell">
                        <span class="vocab-word-text">${escapeHtml(wordText)}</span>
                    </td>
                    <td class="pronunciation-cell" data-word="${escapeHtml(wordText)}">
                        <span class="vocab-phonetic">...</span>
                        <button class="vocab-audio-btn-inline" onclick="window.VocabularyBook.playAudio('${escapeHtml(wordText)}')" title="Listen">🔊</button>
                    </td>
                    <td class="translation-cell" data-word="${escapeHtml(wordText)}">
                        <span class="vocab-vietnamese" style="color:#3B82F6;font-weight:500;">...</span>
                    </td>
                    <td class="examples-action-cell" data-word="${escapeHtml(wordText)}">
                        <button class="vocab-table-expand-btn" style="display:none;" title="Show Examples" type="button">▼</button>
                    </td>
                    ${sourceCell}
                    ${formCell}
                    ${statsCell}
                </tr>
                <tr id="${rowId}-details" class="vocab-row-details" style="display: none;">
                    <td colspan="7">
                        <div class="vocab-table-details-content">
                            <!-- Sentences go here -->
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rowsHtml;

        // Fetch Phonetics and Vietnamese translations in background
        for (const item of items) {
            const wordText = item.word || item.originalWord;
            const lemma = item.lemma;

            // Fetch Phonetics
            fetchPhonetics(wordText).then(phonetic => {
                const cells = tbody.querySelectorAll(`.pronunciation-cell[data-word="${CSS.escape(wordText)}"]`);
                cells.forEach(cell => {
                    const phoneticText = phonetic || '-';
                    cell.innerHTML = `<span class="vocab-phonetic">${escapeHtml(phoneticText)}</span> <button class="vocab-audio-btn-inline" onclick="window.VocabularyBook.playAudio('${escapeHtml(wordText)}')" title="Listen">🔊</button>`;
                });
            });

            // Fetch Vietnamese Entry using DictionaryService
            if (window.DictionaryService) {
                window.DictionaryService.getVietnameseEntry(wordText).then(entry => {
                    const escapedWord = CSS.escape(wordText);
                    const transCells = tbody.querySelectorAll(`.translation-cell[data-word="${escapedWord}"]`);
                    transCells.forEach(cell => {
                        cell.innerHTML = `<span class="vocab-vietnamese" style="color:#3B82F6;font-weight:500;">${escapeHtml(entry.translation || '-')}</span>`;
                    });

                    // Update examples button and content
                    const actionCells = tbody.querySelectorAll(`.examples-action-cell[data-word="${escapedWord}"]`);
                    actionCells.forEach((cell) => {
                        const expandBtn = cell.querySelector('.vocab-table-expand-btn');
                        if (entry.sentences && entry.sentences.length > 0) {
                            expandBtn.style.display = 'inline-block';

                            // Find the corresponding details row
                            const row = cell.closest('tr');
                            const detailsRow = row.nextElementSibling;
                            if (detailsRow && detailsRow.classList.contains('vocab-row-details')) {
                                const container = detailsRow.querySelector('.vocab-table-details-content');
                                container.innerHTML = `
                                    <div class="vocab-table-sentences">
                                        ${entry.sentences.slice(0, 3).map(s => `
                                            <div class="vocab-table-sentence">
                                                <div class="vi">${escapeHtml(s.vi)}</div>
                                                <div class="en">${escapeHtml(s.en)}</div>
                                            </div>
                                        `).join('')}
                                    </div>
                                `;

                                expandBtn.onclick = (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const isVisible = detailsRow.style.display === 'table-row';
                                    detailsRow.style.display = isVisible ? 'none' : 'table-row';
                                    expandBtn.textContent = isVisible ? '▼' : '▲';
                                    expandBtn.classList.toggle('active', !isVisible);
                                };
                            }
                        }
                    });
                });
            }
        }
    }

    /**
     * Remove word via Modal
     */
    function removeViaModal(lemma) {
        if (confirm('Remove this word from bookmarks?')) {
            removeBookmarkedWord(lemma);
            renderListTable('bookmarks'); // Re-render table
        }
    }


    /**
     * Set Firebase references when user logs in
     */
    function setUser(userId, firestore) {
        currentUserId = userId;
        // Prefer passed firestore, fallback to global, then init new
        db = firestore || window.firebaseDb;

        if (!db && window.firebaseApp) {
            console.warn('[VocabBook] DB not passed/found, initializing new instance from app');
            db = getFirestore(window.firebaseApp);
        }

        console.log('[VocabBook] setUser:', userId, 'db available:', !!db);

        if (userId) {
            if (db) {
                loadVocabData();
            } else {
                console.error('[VocabBook] Critical: DB missing in setUser! Data cannot be saved.');
            }
        }
    }

    /**
     * Check if vocabulary book is unlocked for current user
     */
    async function isUnlocked() {
        // Primary check: Shop Module (client-side cache)
        if (window.shopModule && typeof window.shopModule.isModeUnlocked === 'function') {
            const unlocked = window.shopModule.isModeUnlocked('vocabBook');
            if (unlocked) return true;
        }

        if (!currentUserId || !db) return false;

        try {
            const userDoc = await getDoc(doc(db, 'users', currentUserId));
            if (userDoc.exists()) {
                const data = userDoc.data();
                // Check both legacy flag and new array
                const isUnlocked = data.vocabularyBookUnlocked === true ||
                    (data.unlockedModes && data.unlockedModes.includes('vocabBook'));

                if (isUnlocked) return true;
            }
        } catch (e) {
            console.error('[VocabBook] Error checking checking vocab unlock status:', e);
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
                console.log('[VocabBook] Loaded Data:', data);
                vocabCache.bookmarkedWords = data.bookmarkedWords || [];
                vocabCache.wordStats = data.wordStats || {};
                vocabCache.frequentlyMissed = data.frequentlyMissed || [];
                vocabCache.usedToMiss = data.usedToMiss || [];
                vocabCache.masteredWords = data.masteredWords || [];

                // Backfill missing mode/questionId from wordStats for frequentlyMissed entries
                let needsSave = false;
                vocabCache.frequentlyMissed.forEach(entry => {
                    const stats = vocabCache.wordStats[entry.lemma];
                    if (stats) {
                        if (!entry.mode && stats.mode) {
                            entry.mode = stats.mode;
                            needsSave = true;
                        }
                        if (!entry.questionId && stats.questionId) {
                            entry.questionId = stats.questionId;
                            needsSave = true;
                        }
                    }
                });

                // Also backfill bookmarkedWords if needed
                vocabCache.bookmarkedWords.forEach(entry => {
                    const stats = vocabCache.wordStats[entry.lemma];
                    if (stats) {
                        if (!entry.mode && stats.mode) {
                            entry.mode = stats.mode;
                            needsSave = true;
                        }
                        if (!entry.questionId && stats.questionId) {
                            entry.questionId = stats.questionId;
                            needsSave = true;
                        }
                    }
                });

                if (needsSave) {
                    console.log('[VocabBook] Backfilled source info, saving...');
                    saveVocabData();
                }

                // Sync to SRS (Auto-track all current words)
                if (window.SRSReview && typeof window.SRSReview.initializeWord === 'function') {
                    const allWordsToSync = [
                        ...vocabCache.bookmarkedWords,
                        ...vocabCache.frequentlyMissed
                    ];

                    // Use a Set to avoid duplicates if word is in both lists
                    const syncedLemmas = new Set();

                    allWordsToSync.forEach(entry => {
                        const lemma = entry.lemma;
                        const word = entry.word || entry.originalWord;
                        if (lemma && word && !syncedLemmas.has(lemma)) {
                            window.SRSReview.initializeWord(lemma, word);
                            syncedLemmas.add(lemma);
                        }
                    });

                    // Update due badge after sync
                    if (allWordsToSync.length > 0) {
                        setTimeout(updateSRSDueBadge, 1000);
                    }
                }
            } else {
                // Initialize empty if doesn't exist
                vocabCache = {
                    bookmarkedWords: [],
                    wordStats: {},
                    frequentlyMissed: [],
                    usedToMiss: [],
                    masteredWords: []
                };
            }

            renderBookmarkedWords();
            renderFrequentlyMissed();
        } catch (e) {
            // console.error('Error loading vocab data:', e);
        }
    }

    /**
     * Save vocabulary data to Firestore
     */
    async function saveVocabData() {
        if (!currentUserId || !db) {
            console.error('[VocabBook] cannot save: missing user or db', { uid: currentUserId, db: !!db });
            return;
        }

        try {
            console.log('[VocabBook] Saving data...', {
                bookmarks: vocabCache.bookmarkedWords.length,
                stats: Object.keys(vocabCache.wordStats).length,
                missed: vocabCache.frequentlyMissed.length,
                usedToMiss: vocabCache.usedToMiss.length,
                mastered: vocabCache.masteredWords.length
            });
            await setDoc(doc(db, 'users', currentUserId, 'vocabularyBook', 'data'), {
                bookmarkedWords: vocabCache.bookmarkedWords,
                wordStats: vocabCache.wordStats,
                frequentlyMissed: vocabCache.frequentlyMissed,
                usedToMiss: vocabCache.usedToMiss,
                masteredWords: vocabCache.masteredWords,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log('[VocabBook] Save success');
        } catch (e) {
            console.error('[VocabBook] Error saving vocab data:', e);
        }
    }

    /**
     * Lemmatize a word using compromise.js (if available)
     */
    function lemmatize(word) {
        if (!word) return '';
        // Normalize curly apostrophes and preserve them
        const cleanWord = word.toLowerCase().trim().replace(/[’]/g, "'").replace(/[^a-z']/g, '');

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
     * Detect part of speech of a word within a sentence context
     * @param {string} word - The target word
     * @param {string} sentence - The full sentence containing the word
     * @returns {string} - Part of speech: 'noun', 'verb', 'adjective', 'adverb', 'preposition', etc.
     */
    function detectPartOfSpeech(word, sentence) {
        if (!word || !sentence) return 'unknown';

        // Use compromise.js for POS tagging if available
        if (typeof nlp !== 'undefined') {
            try {
                const doc = nlp(sentence);
                const cleanWord = word.toLowerCase().trim();

                // Find the word in the parsed sentence
                const terms = doc.terms().json();
                for (const term of terms) {
                    if (term.text.toLowerCase() === cleanWord) {
                        // Get the primary tag
                        const tags = term.tags || [];
                        if (tags.includes('Noun')) return 'noun';
                        if (tags.includes('Verb')) return 'verb';
                        if (tags.includes('Adjective')) return 'adjective';
                        if (tags.includes('Adverb')) return 'adverb';
                        if (tags.includes('Preposition')) return 'preposition';
                        if (tags.includes('Conjunction')) return 'conjunction';
                        if (tags.includes('Pronoun')) return 'pronoun';
                        if (tags.includes('Determiner')) return 'determiner';
                        if (tags.includes('Interjection')) return 'interjection';
                    }
                }

                // Fallback: just analyze the word itself
                const wordDoc = nlp(cleanWord);
                if (wordDoc.nouns().length > 0) return 'noun';
                if (wordDoc.verbs().length > 0) return 'verb';
                if (wordDoc.adjectives().length > 0) return 'adjective';
                if (wordDoc.adverbs().length > 0) return 'adverb';
            } catch (e) {
                console.warn('[VocabBook] POS detection failed:', e);
            }
        }

        return 'unknown';
    }

    /**
     * Fetch definition filtered by part of speech
     * @param {string} word - The word to look up
     * @param {string} partOfSpeech - Target POS: 'noun', 'verb', etc.
     * @returns {Promise<{definition: string, example: string}>}
     */
    async function fetchDefinitionByPOS(word, partOfSpeech = 'unknown') {
        const cleanWord = word.toLowerCase().trim().replace(/[^a-z]/g, '');
        if (!cleanWord) return { definition: '', example: '' };

        try {
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`);
            if (!response.ok) throw new Error('Not found');

            const data = await response.json();
            if (!data[0] || !data[0].meanings) {
                return { definition: 'Definition not available', example: '' };
            }

            // Try to find a meaning matching the target POS
            let targetMeaning = null;

            if (partOfSpeech !== 'unknown') {
                targetMeaning = data[0].meanings.find(m =>
                    m.partOfSpeech.toLowerCase() === partOfSpeech.toLowerCase()
                );
            }

            // Fallback to first meaning if no POS match
            if (!targetMeaning) {
                targetMeaning = data[0].meanings[0];
            }

            if (targetMeaning && targetMeaning.definitions && targetMeaning.definitions.length > 0) {
                const def = targetMeaning.definitions[0];
                return {
                    definition: def.definition || 'Definition not available',
                    example: def.example || ''
                };
            }

            return { definition: 'Definition not available', example: '' };
        } catch (e) {
            console.warn(`[VocabBook] Definition fetch failed for: ${cleanWord}`, e);
            return { definition: 'Definition not available', example: '' };
        }
    }

    /**
     * Track a word that was missed
     * @param {string} word - The word that was missed
     * @param {string} mode - The mode (type/speak/fill)
     * @param {number|string} questionId - The question ID
     * @param {string} sentence - The original sentence containing the word (NEW)
     */
    async function trackMissedWord(word, mode = null, questionId = null, sentence = null) {
        const lemma = lemmatize(word);
        if (!lemma) return;

        if (!vocabCache.wordStats[lemma]) {
            vocabCache.wordStats[lemma] = { missCount: 0, correctStreak: 0 };
        }

        vocabCache.wordStats[lemma].missCount++;
        vocabCache.wordStats[lemma].correctStreak = 0; // Reset streak on miss
        vocabCache.wordStats[lemma].lastMissedAt = new Date().toISOString();

        // Store source info (mode + questionId)
        if (mode) vocabCache.wordStats[lemma].mode = mode;
        if (questionId) vocabCache.wordStats[lemma].questionId = questionId;

        // NEW: Store sentence context and detect POS
        if (sentence) {
            vocabCache.wordStats[lemma].sentence = sentence;
            const pos = detectPartOfSpeech(word, sentence);
            vocabCache.wordStats[lemma].partOfSpeech = pos;

            // Fetch and store definition matching the POS
            const defData = await fetchDefinitionByPOS(word, pos);
            vocabCache.wordStats[lemma].definition = defData.definition;
            vocabCache.wordStats[lemma].example = defData.example || sentence;

            console.log(`[VocabBook] Detected POS: "${word}" as ${pos} in: "${sentence.substring(0, 50)}..."`);
        }

        console.log(`[VocabBook] Tracked miss: "${word}" (${lemma}) from ${mode} Q${questionId}. Count: ${vocabCache.wordStats[lemma].missCount}`);

        // --- MASTERY REGRESSION CHECK: Is this word mastered? ---
        const masteredIndex = vocabCache.masteredWords.findIndex(w => w.lemma === lemma);
        if (masteredIndex !== -1) {
            const masteredEntry = vocabCache.masteredWords[masteredIndex];
            const currentMastery = masteredEntry.masteryPercentage || 100;
            const newMastery = Math.max(0, currentMastery - 10); // -10% on miss

            masteredEntry.masteryPercentage = newMastery;
            vocabCache.wordStats[lemma].masteryPercentage = newMastery;

            console.log(`[VocabBook] Mastered word "${lemma}" missed! Mastery: ${currentMastery}% → ${newMastery}%`);

            // If mastery drops below 50%, move back to frequentlyMissed
            if (newMastery < 50) {
                console.log(`[VocabBook] Word "${lemma}" lost mastery! Moving back to Frequently Missed.`);

                vocabCache.masteredWords.splice(masteredIndex, 1);
                vocabCache.frequentlyMissed.push({
                    ...masteredEntry,
                    missCount: vocabCache.wordStats[lemma].missCount,
                    regressedFromMastery: true,
                    regressedAt: new Date().toISOString()
                });

                vocabCache.wordStats[lemma].isMastered = false;
                renderFrequentlyMissed();
            }

            saveVocabData();
            return;
        }

        // --- REGRESSION CHECK: Is this word in usedToMiss? ---
        const usedToMissIndex = vocabCache.usedToMiss.findIndex(w => w.lemma === lemma);
        if (usedToMissIndex !== -1) {
            // Increment consecutive misses after move
            const usedToMissEntry = vocabCache.usedToMiss[usedToMissIndex];
            usedToMissEntry.consecutiveMissesAfterMove = (usedToMissEntry.consecutiveMissesAfterMove || 0) + 1;

            console.log(`[VocabBook] Word "${lemma}" missed again after improvement. Consecutive misses: ${usedToMissEntry.consecutiveMissesAfterMove}`);

            // If 3 consecutive misses after move, regress back to frequentlyMissed
            if (usedToMissEntry.consecutiveMissesAfterMove >= 3) {
                console.log(`[VocabBook] Word "${lemma}" regressed! Moving back to Frequently Missed.`);

                // Remove from usedToMiss
                vocabCache.usedToMiss.splice(usedToMissIndex, 1);

                // Add back to frequentlyMissed
                vocabCache.frequentlyMissed.push({
                    ...usedToMissEntry,
                    missCount: vocabCache.wordStats[lemma].missCount,
                    regressedAt: new Date().toISOString()
                });

                // Update stats
                vocabCache.wordStats[lemma].inUsedToMiss = false;

                // Refresh UI
                renderFrequentlyMissed();
                renderUsedToMiss();
            }

            saveVocabData();
            return; // Don't process further for usedToMiss words
        }

        // Check if should be added to frequently missed (3+ misses)
        if (vocabCache.wordStats[lemma].missCount >= 3) {
            const existing = vocabCache.frequentlyMissed.find(w => w.lemma === lemma);
            if (!existing) {
                console.log('[VocabBook] Adding to Frequently Missed list');
                vocabCache.frequentlyMissed.push({
                    lemma: lemma,
                    originalWord: word,
                    missCount: vocabCache.wordStats[lemma].missCount,
                    mode: mode || '-',
                    questionId: questionId || '-',
                    addedAt: new Date().toISOString(),
                    // NEW: Include context data
                    sentence: vocabCache.wordStats[lemma].sentence || null,
                    partOfSpeech: vocabCache.wordStats[lemma].partOfSpeech || 'unknown',
                    definition: vocabCache.wordStats[lemma].definition || null,
                    example: vocabCache.wordStats[lemma].example || null
                });
            } else {
                console.log('[VocabBook] Updating Frequently Missed count');
                existing.missCount = vocabCache.wordStats[lemma].missCount;
                // Update source if provided
                if (mode) existing.mode = mode;
                if (questionId) existing.questionId = questionId;
                // Update context data if available
                if (vocabCache.wordStats[lemma].sentence) existing.sentence = vocabCache.wordStats[lemma].sentence;
                if (vocabCache.wordStats[lemma].partOfSpeech) existing.partOfSpeech = vocabCache.wordStats[lemma].partOfSpeech;
                if (vocabCache.wordStats[lemma].definition) existing.definition = vocabCache.wordStats[lemma].definition;
                if (vocabCache.wordStats[lemma].example) existing.example = vocabCache.wordStats[lemma].example;
            }

            // Live refresh the side panel
            renderFrequentlyMissed();
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
        console.log(`[VocabBook] Tracked correct: "${word}" (${lemma}). Streak: ${vocabCache.wordStats[lemma].correctStreak}`);

        // --- MASTERY BOOST: Is this word mastered? Add +5% ---
        const masteredIndex = vocabCache.masteredWords.findIndex(w => w.lemma === lemma);
        if (masteredIndex !== -1) {
            const masteredEntry = vocabCache.masteredWords[masteredIndex];
            const currentMastery = masteredEntry.masteryPercentage || 100;
            const newMastery = Math.min(100, currentMastery + 5); // +5% on correct, cap at 100%

            masteredEntry.masteryPercentage = newMastery;
            vocabCache.wordStats[lemma].masteryPercentage = newMastery;

            console.log(`[VocabBook] Mastered word "${lemma}" correct! Mastery: ${currentMastery}% → ${newMastery}%`);
            saveVocabData();
            return; // Mastered words don't need further processing
        }

        // Check if should move to "Used to Miss" (3 correct in a row)
        if (vocabCache.wordStats[lemma].correctStreak >= 3) {
            const freqIndex = vocabCache.frequentlyMissed.findIndex(w => w.lemma === lemma);
            if (freqIndex !== -1) {
                const wordEntry = vocabCache.frequentlyMissed[freqIndex];

                console.log(`[VocabBook] Word "${lemma}" improved! Moving to Used to Miss list.`);

                // Remove from frequently missed
                vocabCache.frequentlyMissed.splice(freqIndex, 1);

                // Add to usedToMiss list (preserve word data)
                vocabCache.usedToMiss.push({
                    ...wordEntry,
                    movedAt: new Date().toISOString(),
                    consecutiveMissesAfterMove: 0  // Track misses after move for regression
                });

                // Award 10 points!
                await awardMasteryPoints(lemma);

                // Reset correct streak but keep wordStats for tracking regression
                vocabCache.wordStats[lemma].correctStreak = 0;
                vocabCache.wordStats[lemma].inUsedToMiss = true;

                // Live refresh the side panel
                renderFrequentlyMissed();
                renderUsedToMiss();
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
     * Promote a word to Mastered status (called after 14-day SRS review success)
     * @param {string} lemma - The lemmatized word
     */
    function promoteToMastered(lemma) {
        if (!lemma) return;

        // Check if word is in usedToMiss
        const usedToMissIndex = vocabCache.usedToMiss.findIndex(w => w.lemma === lemma);
        if (usedToMissIndex !== -1) {
            const wordEntry = vocabCache.usedToMiss[usedToMissIndex];

            console.log(`[VocabBook] Word "${lemma}" MASTERED! Setting to 100% mastery.`);

            // Remove from usedToMiss
            vocabCache.usedToMiss.splice(usedToMissIndex, 1);

            // Add to masteredWords with 100% mastery
            vocabCache.masteredWords.push({
                ...wordEntry,
                masteredAt: new Date().toISOString(),
                status: 'mastered',
                masteryPercentage: 100  // NEW: Start at 100%
            });

            // Keep wordStats for tracking future performance
            if (vocabCache.wordStats[lemma]) {
                vocabCache.wordStats[lemma].masteryPercentage = 100;
                vocabCache.wordStats[lemma].isMastered = true;
            }

            renderUsedToMiss();
            saveVocabData();
            return true;
        }

        // Also check frequentlyMissed (in case word bypassed usedToMiss)
        const freqIndex = vocabCache.frequentlyMissed.findIndex(w => w.lemma === lemma);
        if (freqIndex !== -1) {
            const wordEntry = vocabCache.frequentlyMissed[freqIndex];

            console.log(`[VocabBook] Word "${lemma}" MASTERED directly! Moving to Mastered list.`);

            vocabCache.frequentlyMissed.splice(freqIndex, 1);
            vocabCache.masteredWords.push({
                ...wordEntry,
                masteredAt: new Date().toISOString(),
                status: 'mastered'
            });

            if (vocabCache.wordStats[lemma]) {
                delete vocabCache.wordStats[lemma];
            }

            renderFrequentlyMissed();
            saveVocabData();
            return true;
        }

        return false;
    }

    /**
     * Render the "Improving" list (words improved but not yet mastered)
     */
    function renderUsedToMiss() {
        const improvingList = document.getElementById('vocab-improving-list');
        const improvingToggle = document.getElementById('vocab-improving-toggle');
        const improvingCount = document.getElementById('vocab-improving-count');

        // Update count badge
        if (improvingCount) {
            improvingCount.textContent = vocabCache.usedToMiss.length;
        }

        // Show/hide toggle based on whether there are improving words
        if (improvingToggle) {
            improvingToggle.style.display = vocabCache.usedToMiss.length > 0 ? 'flex' : 'none';
        }

        if (!improvingList) return;

        if (vocabCache.usedToMiss.length === 0) {
            improvingList.innerHTML = '<div class="vocab-empty">No improving words yet</div>';
            return;
        }

        // Sort by movedAt desc (most recent first)
        const sorted = [...vocabCache.usedToMiss].sort((a, b) => {
            return new Date(b.movedAt || 0) - new Date(a.movedAt || 0);
        });

        const listHtml = sorted.map(w => {
            const missesAfterMove = w.consecutiveMissesAfterMove || 0;

            return `
            <div class="vocab-word-item vocab-improved">
              <div class="vocab-word-main">
                <span class="vocab-word-text">${w.originalWord}</span>
                <span class="vocab-badge vocab-badge-improved">✓ Improving</span>
              </div>
              <div class="vocab-word-meta">
                <span class="vocab-meta-item" title="Misses after improvement">${missesAfterMove > 0 ? `⚠️ ${missesAfterMove}/3` : '✨ Stable'}</span>
              </div>
            </div>
          `;
        }).join('');

        improvingList.innerHTML = `
            <div class="vocab-scroll-list">
                ${listHtml}
            </div>
        `;
    }

    /**
     * Add a word to bookmarked list
     * @param {string} word - The word to bookmark
     * @param {number|string} questionId - The question ID
     * @param {string} mode - The practice mode
     * @param {string} sentence - The original sentence containing the word (NEW)
     */
    async function addBookmarkedWord(word, questionId, mode, sentence = null) {
        const lemma = lemmatize(word);

        // Check for duplicates
        const exists = vocabCache.bookmarkedWords.some(w => w.lemma === lemma);
        if (exists) return false;

        // NEW: Detect POS and fetch definition if sentence provided
        let partOfSpeech = 'unknown';
        let definition = null;
        let example = null;

        if (sentence) {
            partOfSpeech = detectPartOfSpeech(word, sentence);
            const defData = await fetchDefinitionByPOS(word, partOfSpeech);
            definition = defData.definition;
            example = defData.example || sentence;
            console.log(`[VocabBook] Bookmark: "${word}" as ${partOfSpeech}`);
        }

        vocabCache.bookmarkedWords.push({
            word: word,
            lemma: lemma,
            questionId: questionId,
            mode: mode,
            addedAt: new Date().toISOString(),
            // NEW: Context data
            sentence: sentence,
            partOfSpeech: partOfSpeech,
            definition: definition,
            example: example
        });

        // Initialize SRS tracking for this word (pass context data)
        if (window.SRSReview && typeof window.SRSReview.initializeWord === 'function') {
            window.SRSReview.initializeWord(lemma, word, { partOfSpeech, definition, example, sentence });
            updateSRSDueBadge();
        }

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
     * @param {string} sentence - The original sentence context (NEW)
     */
    async function showAddModal(missedWords, questionId, mode, sentence = null) {
        console.log('[VocabBook] showAddModal called:', { missedWords, questionId, mode, sentence: sentence?.substring(0, 50) });
        const unlocked = await isUnlocked();
        if (!unlocked || !vocabAddModal || missedWords.length === 0) return;

        currentMissedWords = missedWords;
        currentQuestionId = questionId;
        currentMode = mode;
        currentSentence = sentence;

        vocabAddWords.innerHTML = '<div class="vocab-loading">Loading word details...</div>';
        vocabAddModal.style.display = 'block';

        // Fetch details for each word with concurrency limit of 5
        const wordDetails = await mapLimit(missedWords, 5, async (word) => {
            try {
                const entry = window.DictionaryService ? await window.DictionaryService.getVietnameseEntry(word) : { translation: 'Not found', sentences: [] };
                return { word, ...entry };
            } catch (e) {
                return { word, translation: 'Not found', sentences: [] };
            }
        });

        vocabAddWords.innerHTML = '';

        wordDetails.forEach((detail, index) => {
            const item = document.createElement('div');
            item.className = 'vocab-add-word-item';

            const hasSentences = detail.sentences && detail.sentences.length > 0;
            const sentenceHtml = hasSentences
                ? `<div class="vocab-details-sentences">
                    ${detail.sentences.slice(0, 3).map(s => `
                        <div class="vocab-detail-sentence">
                            <div class="vi">${escapeHtml(s.vi)}</div>
                            <div class="en">${escapeHtml(s.en)}</div>
                        </div>
                    `).join('')}
                   </div>`
                : '<div class="vocab-no-sentences">No example sentences available</div>';

            item.innerHTML = `
                <div class="vocab-word-row">
                    <input type="checkbox" id="vocab-word-${index}" value="${escapeHtml(detail.word)}">
                    <label for="vocab-word-${index}" class="vocab-word-label">
                        <span class="word">${escapeHtml(detail.word)}</span>
                        <span class="translation">${escapeHtml(detail.translation)}</span>
                    </label>
                    ${hasSentences ? `<button class="vocab-expand-btn" title="Show Examples" type="button">▼</button>` : ''}
                </div>
                <div class="vocab-word-details" style="display: none;">
                    ${sentenceHtml}
                </div>
            `;

            const checkbox = item.querySelector('input');
            const expandBtn = item.querySelector('.vocab-expand-btn');
            const details = item.querySelector('.vocab-word-details');

            checkbox.addEventListener('change', () => {
                item.classList.toggle('selected', checkbox.checked);
            });

            if (expandBtn && details) {
                expandBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const isVisible = details.style.display === 'block';
                    details.style.display = isVisible ? 'none' : 'block';
                    expandBtn.textContent = isVisible ? '▼' : '▲';
                    expandBtn.classList.toggle('active', !isVisible);
                });
            }

            item.addEventListener('click', (e) => {
                if (e.target !== checkbox && e.target.tagName !== 'LABEL' && !e.target.classList.contains('vocab-expand-btn')) {
                    e.preventDefault();
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });

            vocabAddWords.appendChild(item);
        });
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
        currentSentence = null; // NEW: Reset sentence
    }

    /**
     * Handle adding selected words
     */
    async function handleAddSelected() {
        const checkboxes = vocabAddWords.querySelectorAll('input:checked');
        let addedCount = 0;

        for (const cb of checkboxes) {
            // NEW: Pass sentence context to addBookmarkedWord (async)
            if (await addBookmarkedWord(cb.value, currentQuestionId, currentMode, currentSentence)) {
                addedCount++;
            }
        }

        if (addedCount > 0) {
            console.log(`Added ${addedCount} words to vocabulary book`);
        }

        hideAddModal();
    }

    function renderBookmarkedWords() {
        if (!vocabBookmarkedList) return;

        if (vocabCache.bookmarkedWords.length === 0) {
            vocabBookmarkedList.innerHTML = '<div class="vocab-empty">No bookmarked words yet</div>';
            return;
        }

        // Sort by recency (addedAt desc)
        const sorted = [...vocabCache.bookmarkedWords].sort((a, b) => {
            return new Date(b.addedAt || 0) - new Date(a.addedAt || 0);
        });

        const totalCount = sorted.length;
        const displayLimit = 5;
        const displayItems = sorted.slice(0, displayLimit);

        const listHtml = displayItems.map(w => `
      <div class="vocab-word-item">
        <div class="vocab-word-main">
          <span class="vocab-word-text">${w.word}</span>
          <div class="vocab-word-badges">
             <span class="vocab-badge vocab-badge-mode">${w.mode}</span>
             <span class="vocab-badge vocab-badge-q">Q${w.questionId}</span>
          </div>
        </div>
        <button class="vocab-word-remove" data-lemma="${w.lemma}" title="Remove">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
      </div>
    `).join('');

        // ALWAYS show button if there are items (as requested by user)
        const showButton = totalCount > 0;

        vocabBookmarkedList.innerHTML = `
            <div class="vocab-list-content">
                ${listHtml}
            </div>
            ${showButton ? `
                <div class="vocab-list-footer">
                    <button id="vocab-view-all-btn" class="vocab-btn-secondary">View All Items</button>
                    ${window.DictionaryService ?
                    `<button onclick="if(confirm('Clear all dictionary caches? This will force a refresh of all translations.')) { window.DictionaryService.clearCache(); alert('Cache cleared!'); location.reload(); }" class="vocab-btn-text" style="font-size:11px;color:#94a3b8;margin-left:10px;">Reset Cache</button>`
                    : ''}
                </div>
            ` : ''}
        `;

        // Add remove handlers
        vocabBookmarkedList.querySelectorAll('.vocab-word-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                removeBookmarkedWord(btn.dataset.lemma);
            });
        });

        // Add Show All handler
        const showAllBtn = vocabBookmarkedList.querySelector('#vocab-view-all-btn');
        if (showAllBtn) {
            showAllBtn.addEventListener('click', () => {
                showListModal('bookmarks');
            });
        }
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

        // Sort by missCount desc
        const sorted = [...vocabCache.frequentlyMissed].sort((a, b) => b.missCount - a.missCount);

        const totalCount = sorted.length;
        const displayLimit = 10;
        const displayItems = sorted.slice(0, displayLimit);

        const listHtml = displayItems.map(w => {
            const stats = vocabCache.wordStats[w.lemma] || {};
            // Determine streak color/status
            const isMastered = (stats.correctStreak || 0) >= 3;
            const streakClass = isMastered ? 'vocab-streak-mastered' : 'vocab-streak-progress';

            return `
        <div class="vocab-word-item">
          <div class="vocab-word-main">
            <span class="vocab-word-text">${w.originalWord}</span>
            <span class="vocab-badge vocab-badge-miss">Missed ${w.missCount}x</span>
          </div>
          <div class="vocab-word-streak ${streakClass}">
            <div class="streak-dots">
                ${[1, 2, 3].map(i => `<span class="streak-dot ${i <= (stats.correctStreak || 0) ? 'filled' : ''}"></span>`).join('')}
            </div>
          </div>
        </div>
      `;
        }).join('');

        // Wrapper for scroll (max 5 items visible approx 260px)
        const showButton = totalCount > 0;

        vocabFrequentList.innerHTML = `
            <div class="vocab-scroll-list">
                ${listHtml}
            </div>
            ${showButton ? `<button class="vocab-show-all-btn" id="vocab-show-all-missed">
                <span>View Full List (${totalCount})</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>` : ''}
        `;

        // Add Show All handler
        const showAllBtn = vocabFrequentList.querySelector('#vocab-show-all-missed');
        if (showAllBtn) {
            showAllBtn.addEventListener('click', () => {
                showListModal('missed');
            });
        }
    }

    /**
     * Toggle panel open/close
     */
    async function togglePanel() {
        // Enforce unlock check
        const unlocked = await isUnlocked();
        if (!unlocked) {
            // alert('Unlock "Vocab Book" in the Shop to use this feature!');
            // Open shop to nudge user
            if (window.shopModule && window.shopModule.openShop) {
                window.shopModule.openShop();
            }
            return;
        }

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
                if (vocabPanelOverlay) {
                    vocabPanelOverlay.classList.add('visible');
                }
            } else {
                if (vocabPanelOverlay) {
                    vocabPanelOverlay.classList.remove('visible');
                }
            }
        }
    }

    /**
     * Update the SRS due badge in the vocab panel
     */
    function updateSRSDueBadge() {
        const badge = document.getElementById('srs-due-badge');
        const nextReviewInfo = document.getElementById('srs-next-review-info');
        const startBtn = document.getElementById('srs-start-review-btn');

        if (!badge) return;

        let dueCount = 0;
        if (window.SRSReview && typeof window.SRSReview.getDueCount === 'function') {
            dueCount = window.SRSReview.getDueCount();
        }

        badge.textContent = dueCount;

        // Always keep button enabled - early review confirmation handles the rest
        if (startBtn) startBtn.disabled = false;

        // Show badge when words are due, hide when not
        if (dueCount > 0) {
            badge.style.display = 'inline';
            if (nextReviewInfo) nextReviewInfo.style.display = 'none';
        } else {
            badge.style.display = 'none';
            // Show next review info when no words due
            if (nextReviewInfo) nextReviewInfo.style.display = 'block';
        }
    }

    /**
     * Close the panel
     */
    function closePanel() {
        if (vocabPanelSide) {
            vocabPanelSide.classList.remove('expanded');
            if (vocabPanelOverlay) {
                vocabPanelOverlay.classList.remove('visible');
            }
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
        loadData: loadVocabData,
        playAudio: playPronunciation,
        removeViaModal: removeViaModal,
        togglePanel: togglePanel,
        updateSRSDueBadge: updateSRSDueBadge,
        promoteToMastered: promoteToMastered,
        lemmatize: lemmatize
    };

})();

// Expose to window
window.VocabularyBook = VocabularyBook;
