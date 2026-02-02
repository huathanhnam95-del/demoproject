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

    const log = Logger.create('VocabBook');

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

    // Save debouncing
    let saveTimeout = null;
    let lastSavedState = null;

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

        log.debug('Init - Elements found:', {
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
            progressToggle.addEventListener('click', () => {
                if (vocabPanelSide && vocabPanelSide.classList.contains('active')) {
                    closePanel();
                }
            });
        }

        // Add lifecycle listeners to flush pending saves
        window.addEventListener('beforeunload', flushVocabSave);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushVocabSave();
        });

        log.debug('Module initialized');
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
        // Unified Normalization: use shared DictionaryService logic
        const cleanWord = window.DictionaryService ? window.DictionaryService.normalizeWord(word) : word.trim().toLowerCase().replace(/[^a-z'-]/g, '');
        if (!cleanWord) return null;

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
                log.warn(`Phonetics.getIPA failed for: ${cleanWord}`, e);
            }
        }

        return '';
    }

    /**
     * Play Pronunciation using specific female voice if available
     */
    // ... (lines 370-394)
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

        // --- True Event Delegation: Attach single listener once ---
        if (!tbody.hasAttribute('data-delegated')) {
            tbody.setAttribute('data-delegated', 'true');
            tbody.addEventListener('click', (e) => {
                const target = e.target;

                // Handle Remove
                const removeBtn = target.closest('[data-action="remove-word"]');
                if (removeBtn) {
                    removeViaModal(removeBtn.dataset.lemma);
                    return;
                }

                // Handle Audio
                const audioBtn = target.closest('[data-action="play-audio"]');
                if (audioBtn) {
                    playPronunciation(audioBtn.dataset.word);
                    return;
                }

                // Handle Example Toggle
                const expandBtn = target.closest('[data-action="toggle-examples"]');
                if (expandBtn) {
                    const row = expandBtn.closest('tr');
                    const detailsRow = row.nextElementSibling;
                    if (detailsRow && detailsRow.classList.contains('vocab-row-details')) {
                        const isVisible = detailsRow.style.display === 'table-row';
                        detailsRow.style.display = isVisible ? 'none' : 'table-row';
                        expandBtn.textContent = isVisible ? '▼' : '▲';
                        expandBtn.classList.toggle('active', !isVisible);
                    }
                }
            });
        }

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
            const wordText = item.word || item.originalWord;
            const rowId = `vocab-row-${tabName}-${index}`;
            const mode = item.mode || '-';
            const questionId = item.questionId || '-';
            const pos = item.partOfSpeech || 'unknown';
            const posLabel = pos === 'unknown' ? '-' : pos;
            const posClass = pos !== 'unknown' ? `vocab-badge-pos vocab-badge-pos-${pos}` : 'vocab-badge-pos';

            return `
                <tr id="${rowId}" class="vocab-row-main">
                    <td class="vocab-word-cell">
                        <span class="vocab-word-text">${escapeHtml(wordText)}</span>
                    </td>
                    <td class="pronunciation-cell" data-word="${escapeHtml(wordText)}">
                        <span class="vocab-phonetic">...</span>
                        <button class="vocab-audio-btn-inline" data-action="play-audio" data-word="${escapeHtml(wordText)}" title="Listen">🔊</button>
                    </td>
                    <td class="translation-cell" data-word="${escapeHtml(wordText)}">
                        <span class="vocab-vietnamese" style="color:#3B82F6;font-weight:500;">...</span>
                    </td>
                    <td class="examples-action-cell" data-word="${escapeHtml(wordText)}">
                        <button class="vocab-table-expand-btn" data-action="toggle-examples" style="display:none;" title="Show Examples" type="button">▼</button>
                    </td>
                    <td>
                        <span class="vocab-badge vocab-badge-mode">${escapeHtml(mode)}</span>
                        <span class="vocab-badge vocab-badge-q">Q${escapeHtml(questionId)}</span>
                    </td>
                    <td><span class="${posClass}">${escapeHtml(posLabel)}</span></td>
                    <td>
                        ${tabName === 'missed'
                    ? `<span class="vocab-badge vocab-badge-miss">${item.missCount}</span>`
                    : `<button class="btn-icon-remove" data-action="remove-word" data-lemma="${escapeHtml(item.lemma)}" title="Remove">
                                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                               </button>`
                }
                    </td>
                </tr>
                <tr id="${rowId}-details" class="vocab-row-details" style="display: none;">
                    <td colspan="7">
                        <div class="vocab-table-details-content"></div>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rowsHtml;

        // Use mapLimit to fetch Phonetics and translations in background with concurrency control
        await mapLimit(items, 8, async (item) => {
            const wordText = item.word || item.originalWord;
            const escapedWord = CSS.escape(wordText);

            const [phonetic, entry] = await Promise.all([
                fetchPhonetics(wordText),
                window.DictionaryService ? window.DictionaryService.getVietnameseEntry(wordText) : Promise.resolve({ translation: '-', sentences: [] })
            ]);

            // Update UI via selectors (Safe and efficient)
            const pCells = tbody.querySelectorAll(`.pronunciation-cell[data-word="${escapedWord}"] .vocab-phonetic`);
            pCells.forEach(cell => cell.textContent = phonetic || '-');

            const tCells = tbody.querySelectorAll(`.translation-cell[data-word="${escapedWord}"] .vocab-vietnamese`);
            tCells.forEach(cell => cell.textContent = entry.translation || '-');

            const expandBtns = tbody.querySelectorAll(`.examples-action-cell[data-word="${escapedWord}"] .vocab-table-expand-btn`);
            if (entry.sentences && entry.sentences.length > 0) {
                expandBtns.forEach(btn => btn.style.display = 'inline-block');

                // Populate content once
                const detailCells = tbody.querySelectorAll(`.examples-action-cell[data-word="${escapedWord}"]`);
                detailCells.forEach(cell => {
                    const detailsRow = cell.closest('tr').nextElementSibling;
                    if (detailsRow && detailsRow.classList.contains('vocab-row-details')) {
                        const container = detailsRow.querySelector('.vocab-table-details-content');
                        if (container && !container.innerHTML) {
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
                        }
                    }
                });
            }
        });
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
            log.warn('DB not passed/found, initializing new instance from app');
            db = getFirestore(window.firebaseApp);
        }

        log.debug('setUser:', userId, 'db available:', !!db);

        if (userId) {
            if (db) {
                loadVocabData();
            } else {
                log.error('Critical: DB missing in setUser! Data cannot be saved.');
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
            log.error('Error checking checking vocab unlock status:', e);
        }
        return false;
    }

    /**
     * Check if the current user is an admin
     */
    function isAdmin() {
        if (typeof window.firebaseAuthFunctions !== 'undefined' && window.firebaseAuthFunctions.getCurrentUser) {
            const user = window.firebaseAuthFunctions.getCurrentUser();
            return user && user.email === 'huathanhnam95@gmail.com';
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
                log.log('Loaded Data:', data);
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
                    log.debug('Backfilled source info, saving...');
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
            // log.error('Error loading vocab data:', e);
        }
    }

    /**
     * Save vocabulary data to Firestore
     */
    async function saveVocabData() {
        if (!currentUserId || !db) {
            log.error('cannot save: missing user or db', { uid: currentUserId, db: !!db });
            return;
        }

        // NO-OP CHECK: Avoid unnecessary writes if data hasn't changed
        const currentState = JSON.stringify({
            bookmarks: vocabCache.bookmarkedWords,
            stats: vocabCache.wordStats,
            missed: vocabCache.frequentlyMissed,
            usedToMiss: vocabCache.usedToMiss,
            mastered: vocabCache.masteredWords
        });

        if (currentState === lastSavedState) {
            log.debug('Skipping save: No changes detected');
            return;
        }

        try {
            log.debug('Saving data...', {
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

            lastSavedState = currentState; // Update last saved state
            log.debug('Save success');
        } catch (e) {
            log.error('Error saving vocab data:', e);
        }
    }

    /**
     * Flush any pending save immediately
     */
    function flushVocabSave() {
        if (saveTimeout) {
            log.debug('Flushing pending vocab save...');
            clearTimeout(saveTimeout);
            saveTimeout = null;
            saveVocabData();
        }
    }

    /**
     * Debounced save wrapper
     */
    function debouncedSaveVocab() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveVocabData();
        }, 3000); // 3 second delay
    }

    /**
     * Lemmatize a word (proxy to DictionaryService)
     */
    function lemmatize(word) {
        return window.DictionaryService ? window.DictionaryService.lemmatize(word) : word.toLowerCase().trim();
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
            const partOfSpeech = window.DictionaryService ? window.DictionaryService.detectPartOfSpeech(word, sentence) : 'unknown';
            vocabCache.wordStats[lemma].partOfSpeech = partOfSpeech;

            // Fetch and store definition matching the POS
            const defData = window.DictionaryService ? await window.DictionaryService.getWordData(word, partOfSpeech) : { definition: 'Definition not available', example: '' };
            vocabCache.wordStats[lemma].definition = defData.definition;
            vocabCache.wordStats[lemma].example = defData.example || sentence;

            log.debug(`Detected POS: "${word}" as ${partOfSpeech} in: "${sentence.substring(0, 50)}..."`);
        }

        log.debug(`Tracked miss: "${word}" (${lemma}) from ${mode} Q${questionId}. Count: ${vocabCache.wordStats[lemma].missCount}`);

        // --- MASTERY REGRESSION CHECK: Is this word mastered? ---
        const masteredIndex = vocabCache.masteredWords.findIndex(w => w.lemma === lemma);
        if (masteredIndex !== -1) {
            const masteredEntry = vocabCache.masteredWords[masteredIndex];
            const currentMastery = masteredEntry.masteryPercentage || 100;
            const newMastery = Math.max(0, currentMastery - 10); // -10% on miss

            masteredEntry.masteryPercentage = newMastery;
            vocabCache.wordStats[lemma].masteryPercentage = newMastery;

            log.debug(`Mastered word "${lemma}" missed! Mastery: ${currentMastery}% → ${newMastery}%`);

            // If mastery drops below 50%, move back to frequentlyMissed
            if (newMastery < 50) {
                log.debug(`Word "${lemma}" lost mastery! Moving back to Frequently Missed.`);

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

            debouncedSaveVocab();
            return;
        }

        // --- REGRESSION CHECK: Is this word in usedToMiss? ---
        const usedToMissIndex = vocabCache.usedToMiss.findIndex(w => w.lemma === lemma);
        if (usedToMissIndex !== -1) {
            // Increment consecutive misses after move
            const usedToMissEntry = vocabCache.usedToMiss[usedToMissIndex];
            usedToMissEntry.consecutiveMissesAfterMove = (usedToMissEntry.consecutiveMissesAfterMove || 0) + 1;

            log.debug(`Word "${lemma}" missed again after improvement. Consecutive misses: ${usedToMissEntry.consecutiveMissesAfterMove}`);

            // If 3 consecutive misses after move, regress back to frequentlyMissed
            if (usedToMissEntry.consecutiveMissesAfterMove >= 3) {
                log.debug(`Word "${lemma}" regressed! Moving back to Frequently Missed.`);

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

            debouncedSaveVocab();
            return; // Don't process further for usedToMiss words
        }

        // Check if should be added to frequently missed (3+ misses)
        if (vocabCache.wordStats[lemma].missCount >= 3) {
            const existing = vocabCache.frequentlyMissed.find(w => w.lemma === lemma);
            if (!existing) {
                log.debug('Adding to Frequently Missed list');
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
                log.debug('Updating Frequently Missed count');
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

        debouncedSaveVocab();
    }

    /**
     * Track a word that was answered correctly
     */
    async function trackCorrectWord(word) {
        const lemma = lemmatize(word);
        if (!lemma) return;

        if (!vocabCache.wordStats[lemma]) return; // Only track if was missed before

        vocabCache.wordStats[lemma].correctStreak++;
        log.debug(`Tracked correct: "${word}" (${lemma}). Streak: ${vocabCache.wordStats[lemma].correctStreak}`);

        // --- MASTERY BOOST: Is this word mastered? Add +5% ---
        const masteredIndex = vocabCache.masteredWords.findIndex(w => w.lemma === lemma);
        if (masteredIndex !== -1) {
            const masteredEntry = vocabCache.masteredWords[masteredIndex];
            const currentMastery = masteredEntry.masteryPercentage || 100;
            const newMastery = Math.min(100, currentMastery + 5); // +5% on correct, cap at 100%

            masteredEntry.masteryPercentage = newMastery;
            vocabCache.wordStats[lemma].masteryPercentage = newMastery;

            log.debug(`Mastered word "${lemma}" correct! Mastery: ${currentMastery}% → ${newMastery}%`);
            debouncedSaveVocab();
            return; // Mastered words don't need further processing
        }

        // Check if should move to "Used to Miss" (3 correct in a row)
        if (vocabCache.wordStats[lemma].correctStreak >= 3) {
            const freqIndex = vocabCache.frequentlyMissed.findIndex(w => w.lemma === lemma);
            if (freqIndex !== -1) {
                const wordEntry = vocabCache.frequentlyMissed[freqIndex];

                log.debug(`Word "${lemma}" improved! Moving to Used to Miss list.`);

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

        debouncedSaveVocab();
    }

    /**
     * Award points for mastering a frequently missed word
     */
    async function awardMasteryPoints(lemma) {
        if (!currentUserId || !db) return;

        try {
            // Use unified points awarding function
            if (window.firebaseFirestoreFunctions && window.firebaseFirestoreFunctions.addPoints) {
                await window.firebaseFirestoreFunctions.addPoints(
                    currentUserId,
                    10,
                    'Vocabulary Improved',
                    `Word "${lemma}" moved to troubleshooting list`
                );
            } else {
                // Fallback (legacy)
                const userRef = doc(db, 'users', currentUserId);
                await updateDoc(userRef, {
                    totalPoints: increment(10),
                    coins: increment(10)
                });
            }

            // Show toast notification
            if (window.showPointsToast) {
                window.showPointsToast(10, 'vocabulary_mastered');
            }

            log.debug(`Awarded 10 points for mastering word: ${lemma}`);
        } catch (e) {
            log.error('Error awarding mastery points:', e);
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

            log.debug(`Word "${lemma}" MASTERED! Setting to 100% mastery.`);

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
            debouncedSaveVocab();
            return true;
        }

        // Also check frequentlyMissed (in case word bypassed usedToMiss)
        const freqIndex = vocabCache.frequentlyMissed.findIndex(w => w.lemma === lemma);
        if (freqIndex !== -1) {
            const wordEntry = vocabCache.frequentlyMissed[freqIndex];

            log.debug(`Word "${lemma}" MASTERED directly! Moving to Mastered list.`);

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
            debouncedSaveVocab();
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

        if (sentence && window.DictionaryService) {
            partOfSpeech = window.DictionaryService.detectPartOfSpeech(word, sentence);
            const wordData = await window.DictionaryService.getWordData(word, partOfSpeech);
            definition = wordData.definition;
            example = wordData.example || sentence;
            log.debug(`Bookmark: "${word}" as ${partOfSpeech}`);
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

        debouncedSaveVocab();
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
            debouncedSaveVocab();
            renderBookmarkedWords();
        }
    }

    /**
     * Show the "Add to Vocabulary" modal with missed words
     * @param {string} sentence - The original sentence context (NEW)
     */
    async function showAddModal(missedWords, questionId, mode, sentence = null) {
        log.debug('showAddModal called:', { missedWords, questionId, mode, sentence: sentence?.substring(0, 50) });
        const unlocked = await isUnlocked();
        if (!unlocked || !vocabAddModal || missedWords.length === 0) return;

        currentMissedWords = missedWords;
        currentQuestionId = questionId;
        currentMode = mode;
        currentSentence = sentence;

        vocabAddWords.innerHTML = '<div class="vocab-loading">Loading word details...</div>';
        vocabAddModal.style.display = 'flex';

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
                    ${hasSentences ? `<button class="vocab-expand-btn" title="Show Examples" type="button"></button>` : ''}
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
                    // Text content handled by CSS ::after
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
            log.debug(`Added ${addedCount} words to vocabulary book`);
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
                    ${window.DictionaryService && isAdmin() ?
                    `<button id="vocab-reset-cache-btn" class="vocab-btn-text" style="font-size:11px;color:#94a3b8;margin-left:10px;">Reset Cache</button>`
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

        // Reset Cache handler (Admin only)
        const resetBtn = vocabBookmarkedList.querySelector('#vocab-reset-cache-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm('Clear all dictionary caches? This will force a refresh of all translations.')) {
                    if (window.DictionaryService && typeof window.DictionaryService.clearCache === 'function') {
                        window.DictionaryService.clearCache();
                        alert('Cache cleared!');
                        location.reload();
                    }
                }
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
        log.debug('showToggle called, element:', !!vocabPanelToggle);
        if (vocabPanelToggle) {
            vocabPanelToggle.style.display = 'flex';
            log.debug('Toggle now visible');
        } else {
            log.warn('Toggle element not found!');
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
