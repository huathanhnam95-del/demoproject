/**
 * Take Notes Mode Module
 * Handles the Take Notes practice mode in the learner app
 * UI matches Type/Speak modes with question selector and filter dropdown
 * 
 * Flow: Select question → Play → Watch guiding video (if available) → Listen to audio + take notes → See results
 */

(function () {
    'use strict';

    // State
    let entries = [];
    let filteredEntries = [];
    let currentEntryIndex = 0;
    let currentEntry = null;
    let notesPlayer = null;
    let isPlayerReady = false;
    let currentFilter = 'all'; // 'all', 'has-video', 'no-video'
    let isInitialized = false;

    // DOM Elements
    const elements = {};

    /**
     * Initialize Take Notes mode
     */
    function init() {
        if (isInitialized) {
            console.log('[TakeNotes] Already initialized');
            return;
        }

        cacheElements();
        if (!elements.questionSelect) {
            console.warn('[TakeNotes] UI elements not found, skipping init');
            return;
        }

        setupEventListeners();
        loadEntries();
        isInitialized = true;
        console.log('[TakeNotes] Module initialized');
    }

    /**
     * Reset UI state (called when switching away from Notes tab)
     */
    function reset() {
        // Hide practice area
        if (elements.practiceArea) {
            elements.practiceArea.style.display = 'none';
        }
        // Hide all steps
        if (elements.stepVideo) elements.stepVideo.style.display = 'none';
        if (elements.stepAudio) elements.stepAudio.style.display = 'none';
        if (elements.stepResults) elements.stepResults.style.display = 'none';

        // Clear YouTube player iframe to stop video playback
        if (elements.youtubePlayer) {
            elements.youtubePlayer.innerHTML = '';
        }

        // Stop any playing audio
        if (elements.audio) {
            elements.audio.pause();
            elements.audio.src = '';
        }
        // Clear user input
        if (elements.userInput) {
            elements.userInput.value = '';
        }
        console.log('[TakeNotes] Mode reset');
    }

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        // Question selector elements
        elements.currentQuestionId = document.getElementById('current-question-id-notes');
        elements.backBtn = document.getElementById('back-btn-notes');
        elements.nextBtn = document.getElementById('next-btn-notes');
        elements.questionSelect = document.getElementById('question-select-notes');
        elements.totalQuestions = document.getElementById('total-questions-notes');
        elements.playBtn = document.getElementById('play-notes-btn');
        elements.score = document.getElementById('score-notes');

        // Status filter
        elements.statusFilterBtn = document.getElementById('status-filter-btn-notes');
        elements.statusFilterLabel = document.getElementById('status-filter-label-notes');
        elements.statusFilterMenu = document.getElementById('status-filter-menu-notes');

        // Practice area
        elements.practiceArea = document.getElementById('notes-practice-area');

        // Step 1: Video
        elements.stepVideo = document.getElementById('notes-step-video');
        elements.youtubePlayer = document.getElementById('notes-youtube-player');
        elements.skipVideoBtn = document.getElementById('notes-skip-video-btn');

        // Step 2: Audio + Notes
        elements.stepAudio = document.getElementById('notes-step-audio');
        elements.audio = document.getElementById('notes-audio');
        elements.userInput = document.getElementById('notes-user-input');
        elements.submitBtn = document.getElementById('notes-submit-btn');

        // Step 3: Results
        elements.stepResults = document.getElementById('notes-step-results');
        elements.transcriptDisplay = document.getElementById('notes-transcript-display');
        elements.userDisplay = document.getElementById('notes-user-display');
        elements.matchCount = document.getElementById('notes-match-count');
        elements.retryBtn = document.getElementById('notes-retry-btn');
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Navigation
        if (elements.backBtn) {
            elements.backBtn.addEventListener('click', goToPrevious);
        }
        if (elements.nextBtn) {
            elements.nextBtn.addEventListener('click', goToNext);
        }
        if (elements.questionSelect) {
            elements.questionSelect.addEventListener('change', onQuestionSelectChange);
        }

        // Play button
        if (elements.playBtn) {
            elements.playBtn.addEventListener('click', startPractice);
        }

        // Status filter
        if (elements.statusFilterBtn) {
            elements.statusFilterBtn.addEventListener('click', toggleFilterMenu);
        }
        // Filter options
        const filterOptions = document.querySelectorAll('#status-filter-menu-notes .filter-option');
        filterOptions.forEach(option => {
            option.addEventListener('click', () => {
                const value = option.dataset.value;
                applyFilter(value);
                elements.statusFilterMenu.style.display = 'none';
            });
        });

        // Close filter menu when clicking outside
        document.addEventListener('click', (e) => {
            if (elements.statusFilterMenu && elements.statusFilterBtn) {
                if (!elements.statusFilterBtn.contains(e.target) && !elements.statusFilterMenu.contains(e.target)) {
                    elements.statusFilterMenu.style.display = 'none';
                }
            }
        });

        // Practice controls
        if (elements.skipVideoBtn) {
            elements.skipVideoBtn.addEventListener('click', goToAudioStep);
        }
        if (elements.submitBtn) {
            elements.submitBtn.addEventListener('click', submitNotes);
        }
        if (elements.retryBtn) {
            elements.retryBtn.addEventListener('click', retryPractice);
        }
    }

    /**
     * Load entries from Firestore or Excel
     */
    async function loadEntries() {
        if (!elements.questionSelect) return;

        elements.questionSelect.innerHTML = '<option value="">Loading...</option>';

        try {
            // Try to load from Firestore first
            if (typeof firebase !== 'undefined' && firebase.firestore) {
                try {
                    const db = firebase.firestore();
                    const snapshot = await db.collection('takeNotesEntries').get();

                    if (!snapshot.empty) {
                        entries = snapshot.docs.map(doc => doc.data());
                        console.log(`[TakeNotes] Loaded ${entries.length} entries from Firestore`);

                        // Sort entries numerically by ID
                        entries.sort((a, b) => {
                            const idA = parseInt(a.id, 10);
                            const idB = parseInt(b.id, 10);
                            return (isNaN(idA) || isNaN(idB)) ? a.id.localeCompare(b.id) : idA - idB;
                        });

                        applyFilter('all');
                        return;
                    }
                    console.log('[TakeNotes] No entries in Firestore, trying Excel...');
                } catch (firestoreError) {
                    console.warn('[TakeNotes] Firestore error, falling back to Excel:', firestoreError.message);
                }
            }

            // Fallback: Load from Excel
            const excelPath = 'database/Take%20Notes/RL/RL.xlsx';
            console.log('[TakeNotes] Fetching Excel from:', excelPath);

            const response = await fetch(excelPath);
            if (!response.ok) {
                throw new Error(`Excel file not found (${response.status})`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            entries = [];
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (row[0]) {
                    entries.push({
                        id: String(row[0]).trim(),
                        transcript: row[2] ? String(row[2]).trim() : '',
                        videoUrl: row[5] ? String(row[5]).trim() : ''
                    });
                }
            }

            console.log(`[TakeNotes] Loaded ${entries.length} entries from Excel`);

            // Sort entries numerically by ID
            entries.sort((a, b) => {
                const idA = parseInt(a.id, 10);
                const idB = parseInt(b.id, 10);
                return (isNaN(idA) || isNaN(idB)) ? a.id.localeCompare(b.id) : idA - idB;
            });

            applyFilter('all');

        } catch (error) {
            console.error('[TakeNotes] Error loading entries:', error);
            elements.questionSelect.innerHTML = '<option value="">Error loading</option>';
            if (elements.totalQuestions) elements.totalQuestions.textContent = '0';
        }
    }

    /**
     * Apply status filter
     */
    function applyFilter(filterValue) {
        currentFilter = filterValue;

        // Update filter label
        const filterLabels = {
            'all': 'All Questions',
            'has-video': 'Guiding Video',
            'no-video': 'No Guiding Video'
        };
        if (elements.statusFilterLabel) {
            elements.statusFilterLabel.textContent = filterLabels[filterValue] || 'Filter by Status';
        }

        // Apply filter
        switch (filterValue) {
            case 'has-video':
                filteredEntries = entries.filter(e => e.videoUrl && e.videoUrl.length > 0);
                break;
            case 'no-video':
                filteredEntries = entries.filter(e => !e.videoUrl || e.videoUrl.length === 0);
                break;
            default:
                filteredEntries = [...entries];
        }

        // Update UI
        updateQuestionSelector();
        currentEntryIndex = 0;
        if (filteredEntries.length > 0) {
            selectEntry(0);
        }
    }

    /**
     * Toggle filter menu visibility
     */
    function toggleFilterMenu() {
        if (!elements.statusFilterMenu) return;
        const isVisible = elements.statusFilterMenu.style.display !== 'none';
        elements.statusFilterMenu.style.display = isVisible ? 'none' : 'block';
    }

    /**
     * Update question selector dropdown
     */
    function updateQuestionSelector() {
        if (!elements.questionSelect) return;

        elements.questionSelect.innerHTML = filteredEntries.map((entry, index) => {
            const hasVideo = entry.videoUrl && entry.videoUrl.trim().length > 0;
            const label = hasVideo ? `${entry.id} - Video available` : entry.id;
            return `<option value="${index}">${label}</option>`;
        }).join('');

        if (elements.totalQuestions) {
            elements.totalQuestions.textContent = filteredEntries.length;
        }
    }

    /**
     * Handle question select change
     */
    function onQuestionSelectChange() {
        const index = parseInt(elements.questionSelect.value, 10);
        if (!isNaN(index)) {
            selectEntry(index);
        }
    }

    /**
     * Go to previous question
     */
    function goToPrevious() {
        if (currentEntryIndex > 0) {
            selectEntry(currentEntryIndex - 1);
        }
    }

    /**
     * Go to next question
     */
    function goToNext() {
        if (currentEntryIndex < filteredEntries.length - 1) {
            selectEntry(currentEntryIndex + 1);
        }
    }

    /**
     * Select an entry by index
     */
    function selectEntry(index) {
        if (index < 0 || index >= filteredEntries.length) return;

        currentEntryIndex = index;
        currentEntry = filteredEntries[index];

        // Update UI
        if (elements.currentQuestionId) {
            elements.currentQuestionId.textContent = currentEntry.id;
        }
        if (elements.questionSelect) {
            elements.questionSelect.value = index;
        }

        // Reset practice area
        reset();

        console.log('[TakeNotes] Selected entry:', currentEntry.id);
    }

    /**
     * Start practice - show practice area and begin flow
     */
    function startPractice() {
        if (!currentEntry) {
            alert('Please select a question first');
            return;
        }

        console.log('[TakeNotes] Starting practice for:', currentEntry.id);
        console.log('[TakeNotes] Entry data:', JSON.stringify(currentEntry));
        console.log('[TakeNotes] Video URL:', currentEntry.videoUrl);

        // Show practice area
        elements.practiceArea.style.display = 'block';

        // Clear previous state
        elements.stepVideo.style.display = 'none';
        elements.stepAudio.style.display = 'none';
        elements.stepResults.style.display = 'none';
        elements.userInput.value = '';

        // Check if has guiding video
        const hasVideo = currentEntry.videoUrl && currentEntry.videoUrl.trim().length > 0;
        console.log('[TakeNotes] Has guiding video:', hasVideo);

        if (hasVideo) {
            console.log('[TakeNotes] Loading guiding video...');
            loadGuidingVideo(currentEntry.videoUrl);
            elements.stepVideo.style.display = 'block';
        } else {
            console.log('[TakeNotes] No guiding video, going to audio step');
            goToAudioStep();
        }
    }

    /**
     * Load guiding video in YouTube player
     */
    function loadGuidingVideo(url) {
        const videoId = extractVideoId(url);
        if (!videoId) {
            console.warn('[TakeNotes] Invalid video URL:', url);
            goToAudioStep();
            return;
        }

        // Simple iframe embed
        elements.youtubePlayer.innerHTML = `
            <iframe 
                width="100%" 
                height="100%" 
                src="https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1"
                frameborder="0" 
                allow="autoplay; encrypted-media"
                allowfullscreen>
            </iframe>
        `;
    }

    /**
     * Extract video ID from YouTube URL
     */
    function extractVideoId(url) {
        if (!url) return null;
        const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : null;
    }

    /**
     * Go to audio step (Step 2)
     */
    function goToAudioStep() {
        console.log('[TakeNotes] Moving to audio step');

        // Clear video iframe
        if (elements.youtubePlayer) {
            elements.youtubePlayer.innerHTML = '';
        }

        // Hide video step, show audio step
        elements.stepVideo.style.display = 'none';
        elements.stepAudio.style.display = 'block';

        // Load audio
        loadAudio(currentEntry.id);
    }

    /**
     * Load audio file with extension fallback
     */
    async function loadAudio(audioId) {
        const tryExtensions = ['m4a', 'wav', 'mp3', 'aac', 'ogg'];
        const basePath = `database/Take%20Notes/RL/audio/${audioId}`;

        for (const ext of tryExtensions) {
            const audioPath = `${basePath}.${ext}`;
            const exists = await checkFileExists(audioPath);
            if (exists) {
                elements.audio.src = audioPath;
                console.log(`[TakeNotes] Loaded audio: ${audioPath}`);
                return;
            }
        }

        console.warn(`[TakeNotes] No audio file found for ${audioId}`);
    }

    /**
     * Check if file exists
     */
    async function checkFileExists(url) {
        try {
            const response = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
            const contentType = response.headers.get('content-type');
            return response.ok && contentType && contentType.startsWith('audio/');
        } catch (e) {
            return false;
        }
    }

    /**
     * Submit notes and show results
     */
    function submitNotes() {
        const userNotes = elements.userInput.value.trim();
        if (!userNotes) {
            alert('Please enter some notes before submitting.');
            return;
        }

        console.log('[TakeNotes] Submitting notes');

        // Hide audio step, show results step
        elements.stepAudio.style.display = 'none';
        elements.stepResults.style.display = 'block';

        // Compare notes with transcript
        const transcript = currentEntry.transcript || '';
        const { highlightedTranscript, matchedWords, transcriptWordCount } = compareTexts(transcript, userNotes);

        // Display results
        elements.transcriptDisplay.innerHTML = highlightedTranscript;
        elements.userDisplay.textContent = userNotes;
        elements.matchCount.textContent = matchedWords.length;

        // Save progress if user is logged in
        saveProgress(userNotes, matchedWords, transcriptWordCount);
    }

    /**
     * Retry practice - go back to audio step
     */
    function retryPractice() {
        elements.stepResults.style.display = 'none';
        elements.userInput.value = '';
        startPractice();
    }

    /**
     * Compare user notes with transcript and highlight matches
     */
    function compareTexts(transcript, userNotes) {
        // Use Compromise NLP for lemmatization
        const getLemma = (word) => {
            if (typeof nlp === 'undefined') {
                return word.toLowerCase().replace(/[^a-z0-9]/g, '');
            }

            const cleanWord = word.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!cleanWord) return '';

            const doc = nlp(cleanWord);

            // Try verbs -> infinitive (e.g., running -> run, went -> go)
            const verbs = doc.verbs().toInfinitive().out('text');
            if (verbs) return verbs;

            // Try nouns -> singular (e.g., children -> child)
            const nouns = doc.nouns().toSingular().out('text');
            if (nouns) return nouns;

            return cleanWord;
        };

        const clean = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

        // 1. Build User Indices
        const uniqueUserWords = new Set(userNotes.split(/\s+/).map(clean).filter(w => w));
        const exactUserSet = new Set(uniqueUserWords);
        const lemmaUserMap = new Map();

        uniqueUserWords.forEach(word => {
            const lemma = getLemma(word);
            if (!lemmaUserMap.has(lemma)) {
                lemmaUserMap.set(lemma, []);
            }
            lemmaUserMap.get(lemma).push(word);
        });

        const matchedWords = [];
        const transcriptWords = transcript.split(/(\s+)/);

        const highlightedTranscript = transcriptWords.map(part => {
            // Preserve whitespace and punct only chunks
            if (/^\s*$/.test(part)) return part;

            const cleanPart = clean(part);
            if (!cleanPart) return part;

            // Layer 1: Exact Match
            if (exactUserSet.has(cleanPart)) {
                matchedWords.push(part);
                return `<span class="notes-matched">${part}</span>`;
            }

            // Layer 2: Lemma Match with Constraint
            const partLemma = getLemma(cleanPart);
            if (lemmaUserMap.has(partLemma)) {
                const candidates = lemmaUserMap.get(partLemma);

                // Constraint: share at least 3 starting characters
                const hasValidMatch = candidates.some(userWord => {
                    if (userWord.length < 3 || cleanPart.length < 3) return false;
                    return userWord.substring(0, 3) === cleanPart.substring(0, 3);
                });

                if (hasValidMatch) {
                    matchedWords.push(part);
                    return `<span class="notes-matched">${part}</span>`;
                }
            }

            return part;
        }).join('');

        const transcriptWordCount = transcript.split(/\s+/).filter(w => w.length > 3).length; // Filter short words for better metric

        return { highlightedTranscript, matchedWords, transcriptWordCount };
    }

    /**
     * Save user progress to Firestore
     */
    async function saveProgress(userNotes, matchedWords, transcriptWordCount) {
        try {
            if (typeof firebase === 'undefined' || !firebase.auth) return;

            const user = firebase.auth().currentUser;
            if (!user) return;

            // Dual-Track Scoring Integration (Phase 2.1 - Server-Authoritative)
            if (window.handleDualTrackScoring) {
                // Pass raw user notes text for server-side word matching
                await window.handleDualTrackScoring('notes', currentEntry.id, userNotes);
            }

            const db = firebase.firestore();
            await db.collection('users').doc(user.uid)
                .collection('takeNotesProgress').doc(currentEntry.id)
                .set({
                    entryId: currentEntry.id,
                    userNotes: userNotes,
                    matchedWordsCount: matchedWords.length,
                    transcriptWordCount: transcriptWordCount,
                    completedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

            console.log('[TakeNotes] Progress saved');
        } catch (error) {
            console.error('[TakeNotes] Error saving progress:', error);
        }
    }

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('mode-notes')) {
            init();
        }
    });

    // Public API
    window.TakeNotesMode = {
        init,
        reset,
        loadEntries
    };

})();
