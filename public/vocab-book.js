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

    // Centralized grammar/function word filter — words that should NEVER be tracked or bookmarked
    const GRAMMAR_WORDS = new Set([
        // Articles
        'a', 'an', 'the',
        // Conjunctions
        'and', 'or', 'but', 'nor', 'so', 'yet', 'for',
        // Prepositions
        'in', 'on', 'at', 'to', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through',
        'during', 'including', 'until', 'against', 'among', 'throughout', 'despite', 'towards',
        'upon', 'concerning', 'over', 'under', 'above', 'below', 'between', 'within', 'without',
        'across', 'around', 'behind', 'beside', 'besides', 'beyond', 'near', 'off', 'out', 'down',
        'toward', 'till',
        // Auxiliary / Modal verbs
        'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'having',
        'do', 'does', 'did', 'doing',
        'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall',
        // Demonstratives
        'this', 'that', 'these', 'those',
        // Pronouns
        'i', 'you', 'he', 'she', 'it', 'we', 'they',
        'me', 'him', 'her', 'us', 'them',
        'my', 'your', 'his', 'its', 'our', 'their',
        'mine', 'yours', 'hers', 'ours', 'theirs',
        'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
        // Relative / Interrogative
        'who', 'whom', 'whose', 'which', 'what', 'where', 'when', 'why', 'how', 'whether',
        // Adverbs / Particles (non-content)
        'not', 'no', 'yes', 'well', 'quite', 'just', 'also', 'still', 'even', 'only',
        'very', 'too', 'enough', 'rather', 'already', 'almost', 'really', 'perhaps', 'maybe',
        'never', 'always', 'often', 'sometimes', 'here', 'there', 'now', 'then', 'ago',
        'else', 'back', 'away', 'much', 'more', 'most', 'less', 'least',
        // Quantifiers / Determiners
        'some', 'any', 'many', 'few', 'all', 'each', 'every', 'both', 'other', 'another',
        'such', 'either', 'neither',
        // Linking words
        'as', 'if', 'while', 'though', 'although', 'because', 'since', 'unless', 'whereas',
        // Misc function words
        'than', 'like', 'next'
    ]);

    /**
     * Check if a word is a grammar/function word that should not be tracked
     */
    function isGrammarWord(word) {
        if (!word) return true;
        const normalized = String(word).trim().toLowerCase().replace(/[.,!?;:'"]/g, '');
        return !normalized || normalized.length <= 1 || GRAMMAR_WORDS.has(normalized);
    }

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
    let vocabUnlockCache = null;
    let guestUnlockNudgeShown = false;
    let activeCaptureRequestId = 0;
    let activeCaptureCandidates = [];
    let activeCaptureHydrationToken = 0;
    const GUEST_USER_ID = 'guest';
    const GUEST_VOCAB_STORAGE_KEY = 'bel_guest_vocab_v1';

    // Save debouncing
    let saveTimeout = null;
    let lastSavedState = null;

    function createEmptyVocabCache() {
        return {
            bookmarkedWords: [],
            wordStats: {},
            frequentlyMissed: [],
            usedToMiss: [],
            masteredWords: []
        };
    }

    function isGuestSession() {
        return currentUserId === GUEST_USER_ID;
    }

    function loadGuestVocabData() {
        try {
            const stored = localStorage.getItem(GUEST_VOCAB_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                vocabCache = {
                    bookmarkedWords: Array.isArray(parsed?.bookmarkedWords) ? parsed.bookmarkedWords : [],
                    wordStats: parsed?.wordStats && typeof parsed.wordStats === 'object' ? parsed.wordStats : {},
                    frequentlyMissed: Array.isArray(parsed?.frequentlyMissed) ? parsed.frequentlyMissed : [],
                    usedToMiss: Array.isArray(parsed?.usedToMiss) ? parsed.usedToMiss : [],
                    masteredWords: Array.isArray(parsed?.masteredWords) ? parsed.masteredWords : []
                };
            } else {
                vocabCache = createEmptyVocabCache();
            }
        } catch (e) {
            log.warn('Failed to load guest vocabulary data:', e);
            vocabCache = createEmptyVocabCache();
        }

        renderBookmarkedWords();
        renderFrequentlyMissed();
        renderUsedToMiss();

        if (window.SRSReview && typeof window.SRSReview.initializeWord === 'function') {
            const allWordsToSync = [...vocabCache.bookmarkedWords];
            const syncedLemmas = new Set();
            allWordsToSync.forEach(entry => {
                const lemma = entry?.lemma;
                const word = entry?.word || entry?.originalWord;
                if (!lemma || !word || syncedLemmas.has(lemma)) return;
                window.SRSReview.initializeWord(lemma, word, {
                    entryType: entry?.entryType || 'word',
                    partOfSpeech: entry?.partOfSpeech || 'unknown',
                    definition: entry?.definition || null,
                    example: entry?.example || null,
                    sentence: entry?.sentence || null,
                    allowedModes: entry?.allowedModes || null,
                    phraseAudioKey: entry?.phraseAudioKey || null
                });
                syncedLemmas.add(lemma);
            });
        }
    }

    function getCaptureKey(word) {
        const normalized = lemmatize(word);
        return normalized || String(word || '').trim().toLowerCase();
    }

    function normalizeEntryType(value) {
        return value === 'phrase' ? 'phrase' : 'word';
    }

    function getBookEntryKey(entry) {
        return String(entry?.lemma || '').trim();
    }

    function normalizeCaptureCandidate(candidate, index = 0) {
        if (!candidate) return null;

        if (typeof candidate === 'string') {
            const displayWord = String(candidate || '').trim();
            const key = getCaptureKey(displayWord);
            if (!displayWord || !key) return null;
            return {
                id: `${key}-${index}`,
                key,
                word: displayWord,
                lemma: key,
                entryType: 'word',
                selectedByDefault: true,
                sentence: null,
                phraseAudioKey: null,
                allowedModes: null,
                isDuplicate: false,
                translation: '',
                exampleLines: [],
                ready: false
            };
        }

        const entryType = normalizeEntryType(candidate.entryType);
        const displayWord = String(candidate.displayText || candidate.word || candidate.originalWord || '').trim();
        const key = String(candidate.key || candidate.lemma || (entryType === 'phrase'
            ? `phrase:${String(candidate.normalizedText || displayWord).trim().toLowerCase()}`
            : getCaptureKey(displayWord))).trim();

        if (!displayWord || !key) return null;

        return {
            id: `${key}-${index}`,
            key,
            word: displayWord,
            lemma: key,
            entryType,
            selectedByDefault: candidate.selectedByDefault !== false,
            sentence: candidate.sentence || null,
            phraseAudioKey: candidate.phraseAudioKey || null,
            allowedModes: Array.isArray(candidate.allowedModes) ? [...candidate.allowedModes] : (entryType === 'phrase' ? ['listen', 'speak'] : null),
            sourcePhraseKey: candidate.sourcePhraseKey || null,
            isDuplicate: false,
            translation: candidate.translation || '',
            exampleLines: Array.isArray(candidate.exampleLines) ? candidate.exampleLines : [],
            ready: entryType === 'phrase' || candidate.ready === true
        };
    }

    function escapeForSelector(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function buildCaptureCandidates(words) {
        if (!Array.isArray(words)) return [];

        const seen = new Set();
        const bookmarked = new Set(vocabCache.bookmarkedWords.map(getBookEntryKey));
        const candidates = [];

        words.forEach((rawCandidate, index) => {
            const candidate = normalizeCaptureCandidate(rawCandidate, index);
            if (!candidate || !candidate.lemma || seen.has(candidate.lemma)) return;
            seen.add(candidate.lemma);
            candidate.isDuplicate = bookmarked.has(candidate.lemma);
            candidates.push(candidate);
        });

        return candidates;
    }

    function setCaptureNotice(message = '', tone = 'info') {
        const notice = document.getElementById('vocab-add-notice');
        if (!notice) return;
        notice.className = `vocab-add-notice ${tone ? `tone-${tone}` : ''}`.trim();
        notice.textContent = message;
        notice.style.display = message ? 'block' : 'none';
    }

    function updateCaptureCta() {
        if (!vocabAddBtn || !vocabAddWords) return;

        const enabled = Array.from(vocabAddWords.querySelectorAll('input[type="checkbox"]:checked'))
            .filter(cb => !cb.disabled);

        vocabAddBtn.disabled = enabled.length === 0;
        vocabAddBtn.textContent = enabled.length > 0 ? `Add ${enabled.length} Item${enabled.length === 1 ? '' : 's'}` : 'Add Selected';
    }

    function renderCaptureCandidates(candidates, requestId) {
        if (!vocabAddWords) return;

        const totalSelectable = candidates.filter(c => !c.isDuplicate).length;
        const initialSelected = candidates.filter(c => !c.isDuplicate && c.selectedByDefault !== false).length;

        vocabAddWords.innerHTML = candidates.length === 0
            ? '<div class="vocab-empty">No content words available to save.</div>'
            : candidates.map((candidate, index) => {
                const checkboxId = `vocab-word-${requestId}-${index}`;
                const duplicateBadge = candidate.isDuplicate ? '<span class="vocab-capture-duplicate">Already saved</span>' : '';
                const typeBadge = candidate.entryType === 'phrase'
                    ? '<span class="vocab-capture-type">Phrase</span>'
                    : '<span class="vocab-capture-type">Word</span>';
                const subtitle = candidate.entryType === 'phrase'
                    ? (candidate.translation || 'Phrase from Collo-dictate')
                    : (candidate.isDuplicate ? 'Already saved' : 'Loading...');
                return `
                    <div class="vocab-add-word-item ${candidate.isDuplicate ? 'is-duplicate' : ''}" data-capture-key="${candidate.lemma}">
                        <div class="vocab-word-row">
                            <input type="checkbox" id="${checkboxId}" value="${escapeHtml(candidate.lemma)}"${candidate.isDuplicate ? ' disabled' : ''}${!candidate.isDuplicate && candidate.selectedByDefault !== false ? ' checked' : ''}>
                            <label for="${checkboxId}" class="vocab-word-label">
                                <span class="word">${escapeHtml(candidate.word)}</span>
                                <span class="translation" data-capture-translation="${candidate.lemma}">${escapeHtml(subtitle)}</span>
                            </label>
                            ${typeBadge}
                            ${duplicateBadge}
                        </div>
                        <div class="vocab-word-details" data-capture-details="${candidate.lemma}" style="display: none;"></div>
                    </div>
                `;
            }).join('');

        const summary = document.getElementById('vocab-add-summary');
        if (summary) {
            summary.textContent = candidates.length === 0
                ? 'Only content words are eligible for capture.'
                : `${totalSelectable} item${totalSelectable === 1 ? '' : 's'} eligible for saving.`;
        }

        if (initialSelected === 0) {
            setCaptureNotice('Select at least one word or choose Not now.', 'warn');
        } else if (candidates.every(c => c.isDuplicate)) {
            setCaptureNotice('These words are already in your Vocabulary Book.', 'warn');
        } else {
            setCaptureNotice('');
        }

        vocabAddWords.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const row = checkbox.closest('.vocab-add-word-item');
                if (row) row.classList.toggle('selected', checkbox.checked);
                updateCaptureCta();
                const selectedCount = Array.from(vocabAddWords.querySelectorAll('input[type="checkbox"]:checked'))
                    .filter(cb => !cb.disabled).length;
                if (selectedCount === 0) {
                    setCaptureNotice('Select at least one word or choose Not now.', 'warn');
                } else {
                    setCaptureNotice('');
                }
            });
        });

        vocabAddWords.querySelectorAll('.vocab-add-word-item').forEach((row, index) => {
            const candidate = candidates[index];
            if (candidate && !candidate.isDuplicate && candidate.selectedByDefault !== false) {
                row.classList.add('selected');
            }
        });

        updateCaptureCta();
        return candidates.length > 0;
    }

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
            let active = true;
            while (active) {
                const idx = nextIndex++;
                if (idx >= arr.length) {
                    active = false;
                    return;
                }
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

        // Ensure modal is present (fix for race condition with modals.js)
        if (typeof window.injectVocabListModal === 'function') {
            window.injectVocabListModal();
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

        syncToggleVisibility();
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
        if (window.shopModule?.showAlertModal) {
            window.shopModule.showAlertModal(`Word "${word}" added to your list.`, true);
        }

        // Refresh list if open
        if (document.getElementById('vocab-panel-side')?.classList.contains('expanded')) {
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

        // Use the shared American pronunciation contract and keep both
        // isolated strong and connected-speech weak forms visible.
        if (typeof Phonetics !== 'undefined' && typeof Phonetics.getPronunciations === 'function') {
            try {
                const pronunciations = await Phonetics.getPronunciations(cleanWord);
                phoneticCache.set(cleanWord, pronunciations || null);
                return pronunciations || null;
            } catch (e) {
                log.warn(`Phonetics.getPronunciations failed for: ${cleanWord}`, e);
            }
        }

        if (typeof Phonetics !== 'undefined' && Phonetics.getIPA) {
            try {
                const ipa = await Phonetics.getIPA(cleanWord);
                const fallback = {
                    forms: ipa ? [{ formRole: 'citation', ipa }] : []
                };
                phoneticCache.set(cleanWord, fallback);
                return fallback;
            } catch (e) {
                log.warn(`Phonetics.getIPA failed for: ${cleanWord}`, e);
            }
        }

        return '';
    }

    function formatPronunciationDisplay(pronunciations) {
        if (typeof pronunciations === 'string') return escapeHtml(pronunciations || '-');
        const forms = Array.isArray(pronunciations?.forms) ? pronunciations.forms : [];
        if (!forms.length) return '-';
        return forms
            .filter((form) => form?.ipa)
            .map((form) => {
                const label = form.formRole === 'weak'
                    ? 'Weak'
                    : form.formRole === 'strong'
                        ? 'Strong'
                        : 'Citation';
                return `<span class="vocab-phonetic-form vocab-phonetic-form--${label.toLowerCase()}"><span class="vocab-phonetic-form-label">${label}:</span> ${escapeHtml(form.ipa)}</span>`;
            })
            .join('<br>') || '-';
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

        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">Loading...</td></tr>';

        let items = [];
        if (tabName === 'bookmarks') {
            items = [...vocabCache.bookmarkedWords].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
        } else {
            items = [...vocabCache.frequentlyMissed].sort((a, b) => b.missCount - a.missCount);
        }

        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;">No words found.</td></tr>';
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

            const dateAdded = item.addedAt ? new Date(item.addedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '-';

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
                        ${mode === 'collo-dictate' ? '' : `<span class="vocab-badge vocab-badge-q">Q${escapeHtml(questionId)}</span>`}
                    </td>
                    <td><span class="${posClass}">${escapeHtml(posLabel)}</span></td>
                    <td class="date-cell" style="white-space:nowrap;font-size:12px;color:#64748b;">${dateAdded}</td>
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
                    <td colspan="8">
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
            pCells.forEach(cell => { cell.innerHTML = formatPronunciationDisplay(phonetic); });

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
    async function removeViaModal(lemma) {
        const confirmed = await window.showCustomConfirm(
            'Remove Bookmark?',
            'Remove this word from bookmarks?',
            true
        );
        if (confirmed) {
            removeBookmarkedWord(lemma);
            renderListTable('bookmarks'); // Re-render table
        }
    }


    /**
     * Set Firebase references when user logs in
     */
    function setUser(userId, firestore) {
        currentUserId = userId || null;
        // Prefer passed firestore, fallback to internal global
        db = firestore || (window.__FIREBASE_INTERNAL__ ? window.__FIREBASE_INTERNAL__.db : window.firebaseDb);
        vocabUnlockCache = null;
        guestUnlockNudgeShown = false;

        log.debug('setUser:', userId, 'db available:', !!db);

        if (isGuestSession()) {
            loadGuestVocabData();
        } else if (userId) {
            if (db) {
                loadVocabData();
            } else {
                log.error('Critical: DB missing in setUser! Data cannot be saved.');
            }
        } else {
            vocabCache = createEmptyVocabCache();
            renderBookmarkedWords();
            renderFrequentlyMissed();
            renderUsedToMiss();
        }
        syncToggleVisibility();
    }

    /**
     * Check if vocabulary book is unlocked for current user
     */
    async function isUnlocked() {
        if (isGuestSession()) return true;
        if (!currentUserId) return false;
        if (vocabUnlockCache === true) return true;

        const cachedProfile = window.currentUserProfile && typeof window.currentUserProfile === 'object'
            ? window.currentUserProfile
            : null;
        if (cachedProfile) {
            const unlockedFromProfile = cachedProfile.vocabularyBookUnlocked === true ||
                cachedProfile.vocabBookAutoUnlocked === true ||
                (Array.isArray(cachedProfile.unlockedModes) && cachedProfile.unlockedModes.includes('vocabBook'));
            if (unlockedFromProfile) {
                vocabUnlockCache = true;
                return true;
            }
        }

        if (!db) return false;

        try {
            const userDoc = await getDoc(doc(db, 'users', currentUserId));
            if (userDoc.exists()) {
                const data = userDoc.data();
                const unlocked = data.vocabularyBookUnlocked === true ||
                    data.vocabBookAutoUnlocked === true ||
                    (data.unlockedModes && data.unlockedModes.includes('vocabBook'));

                if (unlocked) {
                    vocabUnlockCache = true;
                    return true;
                }
            }
        } catch (e) {
            log.error('Error checking vocab unlock status:', e);
        }
        return false;
    }

    function cacheUnlockLocally() {
        vocabUnlockCache = true;
        if (window.currentUserProfile && typeof window.currentUserProfile === 'object') {
            window.currentUserProfile.vocabularyBookUnlocked = true;
            window.currentUserProfile.vocabBookAutoUnlocked = true;
        }

        if (currentUserId) {
            const profileKey = `userProfile_${currentUserId}`;
            try {
                const cached = localStorage.getItem(profileKey);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    parsed.vocabularyBookUnlocked = true;
                    parsed.vocabBookAutoUnlocked = true;
                    localStorage.setItem(profileKey, JSON.stringify(parsed));
                }
            } catch (e) {
                log.warn('Failed to update local profile cache after vocab auto-unlock:', e);
            }
        }
    }

    async function autoUnlockFromPractice(mode, missedWords) {
        if (isGuestSession()) return true;
        if (!currentUserId) return false;
        if (!Array.isArray(missedWords) || missedWords.length === 0) return false;
        if (!['type', 'speak', 'collo-dictate'].includes(mode)) return false;

        if (await isUnlocked()) return true;

        cacheUnlockLocally();
        showToggle();

        if (!db) {
            return true;
        }

        try {
            await setDoc(doc(db, 'users', currentUserId), {
                vocabularyBookUnlocked: true,
                vocabBookAutoUnlocked: true,
                vocabBookUnlockedAt: serverTimestamp()
            }, { merge: true });
        } catch (e) {
            log.warn('Failed to persist vocab auto-unlock (continuing local unlock):', e);
        }

        return true;
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
        if (isGuestSession()) {
            loadGuestVocabData();
            return;
        }
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
                    const allWordsToSync = [...vocabCache.bookmarkedWords];

                    // Use a Set to avoid duplicates if word is in both lists
                    const syncedLemmas = new Set();

                    allWordsToSync.forEach(entry => {
                        const lemma = entry.lemma;
                        const word = entry.word || entry.originalWord;
                        if (lemma && word && !syncedLemmas.has(lemma)) {
                            window.SRSReview.initializeWord(lemma, word, {
                                entryType: entry?.entryType || 'word',
                                partOfSpeech: entry?.partOfSpeech || 'unknown',
                                definition: entry?.definition || null,
                                example: entry?.example || null,
                                sentence: entry?.sentence || null,
                                allowedModes: entry?.allowedModes || null,
                                phraseAudioKey: entry?.phraseAudioKey || null
                            });
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
            renderUsedToMiss();
        } catch (e) {
            // log.error('Error loading vocab data:', e);
        }
    }

    /**
     * Save vocabulary data to Firestore
     */
    async function saveVocabData() {
        if (isGuestSession()) {
            const currentState = JSON.stringify(vocabCache);
            if (lastSavedState && currentState === lastSavedState) {
                return;
            }
            try {
                localStorage.setItem(
                    GUEST_VOCAB_STORAGE_KEY,
                    JSON.stringify({
                        bookmarkedWords: vocabCache.bookmarkedWords,
                        wordStats: vocabCache.wordStats,
                        frequentlyMissed: vocabCache.frequentlyMissed,
                        usedToMiss: vocabCache.usedToMiss,
                        masteredWords: vocabCache.masteredWords,
                        updatedAt: new Date().toISOString()
                    })
                );
                lastSavedState = currentState;
            } catch (e) {
                log.warn('Failed to save guest vocabulary data:', e);
            }
            return;
        }

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
        if (!currentUserId) return;
        const lemma = lemmatize(word);
        if (!lemma) return;

        // Reject grammar/function words — they should never accumulate miss counts
        if (isGrammarWord(lemma)) {
            log.debug(`Rejected grammar word from tracking: "${word}" (${lemma})`);
            return;
        }

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
        if (!currentUserId) return;
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
        if (isGuestSession()) return;
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
                <span class="vocab-word-text">${escapeHtml(w.originalWord)}</span>
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
        const entryType = normalizeEntryType(word?.entryType);
        const displayWord = typeof word === 'string'
            ? word
            : (word?.displayText || word?.word || word?.originalWord || '');
        const lemma = typeof word === 'string'
            ? lemmatize(word)
            : String(word?.key || word?.lemma || (entryType === 'phrase'
                ? `phrase:${String(word?.normalizedText || displayWord).trim().toLowerCase()}`
                : lemmatize(displayWord))).trim();

        // Reject grammar/function words (only for single words, not phrases)
        if (entryType === 'word' && isGrammarWord(lemma)) {
            log.debug(`Rejected grammar word from bookmark: "${displayWord}" (${lemma})`);
            return false;
        }

        // Check for duplicates
        const exists = vocabCache.bookmarkedWords.some(w => w.lemma === lemma);
        if (exists) return false;

        // NEW: Detect POS and fetch definition if sentence provided
        let partOfSpeech = entryType === 'phrase' ? 'phrase' : 'unknown';
        let definition = word?.definition || null;
        let example = word?.example || null;
        const resolvedSentence = word?.sentence || sentence;
        const allowedModes = Array.isArray(word?.allowedModes) ? [...word.allowedModes] : (entryType === 'phrase' ? ['listen', 'speak'] : null);
        const phraseAudioKey = word?.phraseAudioKey || null;

        if (entryType === 'word' && resolvedSentence && window.DictionaryService) {
            partOfSpeech = window.DictionaryService.detectPartOfSpeech(displayWord, resolvedSentence);
            const wordData = await window.DictionaryService.getWordData(displayWord, partOfSpeech);
            definition = wordData.definition;
            example = wordData.example || resolvedSentence;
            log.debug(`Bookmark: "${displayWord}" as ${partOfSpeech}`);
        }

        vocabCache.bookmarkedWords.push({
            word: displayWord,
            lemma: lemma,
            entryType: entryType,
            questionId: questionId,
            mode: mode,
            addedAt: new Date().toISOString(),
            // NEW: Context data
            sentence: resolvedSentence,
            partOfSpeech: partOfSpeech,
            definition: definition,
            example: example,
            allowedModes: allowedModes,
            phraseAudioKey: phraseAudioKey
        });

        // Initialize SRS tracking for this word (pass context data)
        if (window.SRSReview && typeof window.SRSReview.initializeWord === 'function') {
            window.SRSReview.initializeWord(lemma, displayWord, {
                entryType,
                partOfSpeech,
                definition,
                example,
                sentence: resolvedSentence,
                allowedModes,
                phraseAudioKey
            });
            if (typeof window.SRSReview.refreshEntrySurfaces === 'function') {
                window.SRSReview.refreshEntrySurfaces('bookmark-add');
            } else {
                updateSRSDueBadge();
            }
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
            if (window.SRSReview && typeof window.SRSReview.unenrollWord === 'function') {
                window.SRSReview.unenrollWord(lemma);
            } else if (window.SRSReview && typeof window.SRSReview.refreshEntrySurfaces === 'function') {
                window.SRSReview.refreshEntrySurfaces('bookmark-remove');
            }
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
        if (!vocabAddModal || !Array.isArray(missedWords) || missedWords.length === 0) return;
        if (!currentUserId) {
            if (!guestUnlockNudgeShown) {
                guestUnlockNudgeShown = true;
                window.shopModule?.showAlertModal?.('Please log in or choose Guest mode to save missed words to your Vocabulary Book.', true);
            }
            return;
        }

        const wasUnlocked = await isUnlocked();
        let unlocked = wasUnlocked;
        if (!unlocked) {
            unlocked = await autoUnlockFromPractice(mode, missedWords);
        }
        if (!unlocked) return;

        currentMissedWords = missedWords;
        currentQuestionId = questionId;
        currentMode = mode;
        currentSentence = sentence;

        const requestId = ++activeCaptureRequestId;
        activeCaptureHydrationToken += 1;
        const hydrationToken = activeCaptureHydrationToken;
        activeCaptureCandidates = buildCaptureCandidates(missedWords);

        if (vocabAddClose) {
            vocabAddClose.textContent = '×';
        }
        if (vocabSkipBtn) {
            vocabSkipBtn.textContent = 'Not now';
        }

        vocabAddModal.style.display = 'flex';
        requestAnimationFrame(() => vocabAddModal.classList.add('active'));
        renderCaptureCandidates(activeCaptureCandidates, requestId);

        const hasRenderableCandidates = activeCaptureCandidates.some(c => !c.isDuplicate);
        if (!hasRenderableCandidates) {
            setCaptureNotice('These words are already saved. Open Daily Review to start practicing them.', 'warn');
            updateCaptureCta();
        }

        const details = await mapLimit(activeCaptureCandidates, 4, async (candidate) => {
            if (!candidate) return candidate;
            if (hydrationToken !== activeCaptureHydrationToken) return candidate;
            if (candidate.entryType === 'phrase') {
                return {
                    ...candidate,
                    translation: candidate.translation || 'Phrase from Collo-dictate',
                    exampleLines: candidate.sentence ? [{ vi: '', en: candidate.sentence }] : [],
                    ready: true
                };
            }
            try {
                const entry = window.DictionaryService && typeof window.DictionaryService.getVietnameseEntry === 'function'
                    ? await window.DictionaryService.getVietnameseEntry(candidate.word)
                    : { translation: '', sentences: [] };
                return {
                    ...candidate,
                    translation: entry?.translation || '',
                    exampleLines: Array.isArray(entry?.sentences) ? entry.sentences : [],
                    ready: true
                };
            } catch (e) {
                return { ...candidate, ready: true };
            }
        });

        if (requestId !== activeCaptureRequestId) return;

        details.forEach(detail => {
            const escapedLemma = escapeForSelector(detail.lemma);
            const row = vocabAddWords.querySelector(`[data-capture-key="${escapedLemma}"]`);
            if (!row) return;
            const translationEl = row.querySelector(`[data-capture-translation="${escapedLemma}"]`);
            if (translationEl && !detail.isDuplicate) {
                translationEl.textContent = detail.translation || (detail.entryType === 'phrase' ? 'Phrase from Collo-dictate' : 'No translation found');
            }

            const detailsEl = row.querySelector(`[data-capture-details="${escapedLemma}"]`);
            if (detailsEl) {
                const sentences = detail.exampleLines || [];
                detailsEl.innerHTML = sentences.length > 0
                    ? `<div class="vocab-details-sentences">
                        ${sentences.slice(0, 3).map(s => `
                            <div class="vocab-detail-sentence">
                                <div class="vi">${escapeHtml(s.vi)}</div>
                                <div class="en">${escapeHtml(s.en)}</div>
                            </div>
                        `).join('')}
                       </div>`
                    : '<div class="vocab-no-sentences">No example sentences available</div>';
            }
        });

        if (!wasUnlocked && ['type', 'speak', 'collo-dictate'].includes(mode) && window.VocabTutorial?.start) {
            setTimeout(() => {
                if (requestId === activeCaptureRequestId) {
                    window.VocabTutorial.start('vocabAddModalIntro');
                }
            }, 120);
        }
    }

    /**
     * Hide the add modal
     */
    function hideAddModal() {
        if (vocabAddModal) {
            vocabAddModal.classList.remove('active');
            vocabAddModal.style.display = 'none';
        }
        currentMissedWords = [];
        currentQuestionId = null;
        currentMode = null;
        currentSentence = null; // NEW: Reset sentence
        activeCaptureCandidates = [];
        activeCaptureRequestId += 1;
        activeCaptureHydrationToken += 1;
        setCaptureNotice('');
    }

    /**
     * Handle adding selected words
     */
    async function handleAddSelected() {
        const checkboxes = vocabAddWords ? vocabAddWords.querySelectorAll('input:checked') : [];
        const selected = Array.from(checkboxes).filter(cb => !cb.disabled);
        if (selected.length === 0) {
            setCaptureNotice('Select at least one word or choose Not now.', 'warn');
            updateCaptureCta();
            return;
        }

        let addedCount = 0;
        let duplicateCount = 0;

        for (const cb of selected) {
            const candidate = activeCaptureCandidates.find(item => item.lemma === cb.value);
            if (await addBookmarkedWord(candidate || cb.value, currentQuestionId, currentMode, currentSentence)) {
                addedCount++;
            } else {
                duplicateCount++;
            }
        }

        if (addedCount > 0) {
            log.debug(`Added ${addedCount} words to vocabulary book`);
            hideAddModal();
            return;
        }

        if (duplicateCount > 0) {
            setCaptureNotice('These words are already in your Vocabulary Book.', 'warn');
            updateCaptureCta();
            return;
        }

        setCaptureNotice('Nothing was added.', 'warn');
    }

    async function handlePracticeCapture({ mode, questionId, sentenceText = null, missedWords = [], candidates = [] }) {
        const captureItems = Array.isArray(candidates) && candidates.length > 0 ? candidates : missedWords;
        return showAddModal(captureItems, questionId, mode, sentenceText);
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
          <span class="vocab-word-text">${escapeHtml(w.word)}</span>
          <div class="vocab-word-badges">
             <span class="vocab-badge vocab-badge-mode">${escapeHtml(w.entryType === 'phrase' ? 'phrase' : 'word')}</span>
             <span class="vocab-badge vocab-badge-mode">${escapeHtml(w.mode)}</span>
             ${w.mode === 'collo-dictate' ? '' : `<span class="vocab-badge vocab-badge-q">Q${escapeHtml(w.questionId)}</span>`}
          </div>
        </div>
        <button class="vocab-word-remove" data-lemma="${escapeHtml(w.lemma)}" title="Remove">
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

        // Add View All Items handler
        const viewAllBtn = vocabBookmarkedList.querySelector('#vocab-view-all-btn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => {
                showListModal('bookmarks');
            });
        }

        // Add remove handlers
        vocabBookmarkedList.querySelectorAll('.vocab-word-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                removeBookmarkedWord(btn.dataset.lemma);
            });
        });

        // Reset Cache handler (Admin only)
        const resetBtn = vocabBookmarkedList.querySelector('#vocab-reset-cache-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                const confirmed = await window.showCustomConfirm(
                    'Clear Cache?',
                    'Clear all dictionary caches? This will force a refresh of all translations.',
                    true
                );
                if (confirmed) {
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
            <span class="vocab-word-text">${escapeHtml(w.originalWord)}</span>
            <span class="vocab-badge vocab-badge-miss">Missed ${escapeHtml(w.missCount)}x</span>
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
        if (!currentUserId) {
            window.shopModule?.showAlertModal?.('Please log in to use Vocabulary Book.', true);
            return;
        }

        const unlocked = await isUnlocked();
        if (!unlocked) {
            window.shopModule?.showAlertModal?.('Vocabulary Book unlocks automatically after missed keywords in Type, Speak, or Collo-dictate mode.', true);
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

        let entryState = null;
        if (window.SRSReview && typeof window.SRSReview.getEntryState === 'function') {
            entryState = window.SRSReview.getEntryState();
        }

        const dueCount = Number(entryState?.dueCount || 0);
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
        if (vocabPanelToggle) {
            vocabPanelToggle.style.display = 'flex';
        }
    }

    async function syncToggleVisibility() {
        if (!vocabPanelToggle) return;
        const unlocked = await isUnlocked();
        vocabPanelToggle.style.display = unlocked ? 'flex' : 'none';
    }

    function getMissCount(word) {
        const lemma = lemmatize(word);
        return Number(vocabCache.wordStats?.[lemma]?.missCount || 0);
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
        handlePracticeCapture: handlePracticeCapture,
        hideAddModal: hideAddModal,
        showToggle: showToggle,
        loadData: loadVocabData,
        playAudio: playPronunciation,
        removeViaModal: removeViaModal,
        togglePanel: togglePanel,
        updateSRSDueBadge: updateSRSDueBadge,
        promoteToMastered: promoteToMastered,
        lemmatize: lemmatize,
        getMissCount: getMissCount,
        showListModal: showListModal,
        hideListModal: hideListModal
    };

})();

// Expose to window
window.VocabularyBook = VocabularyBook;
