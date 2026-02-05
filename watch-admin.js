/**
 * Watch Admin Console
 * Admin interface for managing video questions
 */

(function () {
    'use strict';

    // State
    let firebaseConfig = null;

    // State
    let videos = [];
    let currentVideo = null;
    let questions = [];
    let currentQuestion = null;
    let player = null;
    let videoDuration = 0;
    let hasUnsavedChanges = false;
    let isNewQuestion = false;

    // Take Notes State
    let currentAdminMode = 'watch'; // 'watch' or 'notes'
    let notesEntries = [];
    let currentNotesEntry = null;

    // DOM Elements
    const elements = {};

    /**
     * Initialize admin console
     */
    async function init() {
        try {
            // 1. Fetch Config from server
            const configResponse = await fetch('/api/config');
            const configResult = await configResponse.json();
            if (!configResult.success) {
                throw new Error('Failed to fetch server configuration');
            }
            firebaseConfig = configResult.config;

            // 2. Initialize Firebase
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }

            // Cache DOM elements
            cacheElements();

            // Show loading state
            elements.videoList.innerHTML = '<div class="admin-loading">Checking authentication...</div>';

            // Wait for Firebase auth to fully initialize
            const user = await new Promise((resolve, reject) => {
                const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
                    unsubscribe();
                    resolve(user);
                }, reject);
                setTimeout(() => { unsubscribe(); resolve(null); }, 5000);
            });

            if (user) {
                // The server will enforce the specific admin email via middleware,
                // so we just display the email and proceed.
                elements.userEmail.textContent = user.email;
                await loadVideos();
            } else {
                showNotification('Please log in as admin first.', 'error');
                setTimeout(() => window.location.href = 'index.html', 2000);
                return;
            }
        } catch (error) {
            console.error('Initialization error:', error);
            showNotification('Initialization failed: ' + error.message, 'error');
            return;
        }

        // Set up event listeners
        setupEventListeners();
    }

    /**
     * Show a clean notification instead of alert()
     */
    function showNotification(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `admin-toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Simple animation/timeout
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Escape HTML special characters
     */
    function escapeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        elements.userEmail = document.getElementById('admin-user-email');
        elements.videoSearch = document.getElementById('video-search');
        elements.videoList = document.getElementById('video-list');
        elements.playerVideoTitle = document.getElementById('player-video-title');
        elements.playerContainer = document.getElementById('admin-youtube-player');
        elements.timelinePlay = document.getElementById('timeline-play');
        elements.timelineTime = document.getElementById('timeline-time');
        elements.timelineProgress = document.getElementById('timeline-progress');
        elements.timelineMarkers = document.getElementById('timeline-markers');
        elements.timeline = document.querySelector('.admin-timeline');
        elements.addQuestionBtn = document.getElementById('add-question-btn');
        elements.questionForm = document.getElementById('question-form');
        elements.editorPlaceholder = document.getElementById('editor-placeholder');
        elements.questionListContainer = document.getElementById('question-list-container');
        elements.questionList = document.getElementById('question-list');

        // Form fields
        elements.qId = document.getElementById('q-id');
        elements.qTimestamp = document.getElementById('q-timestamp');
        elements.qText = document.getElementById('q-text');
        elements.qVoiced = document.getElementById('q-voiced');
        elements.qType = document.getElementById('q-type');
        elements.mcOptionsSection = document.getElementById('mc-options-section');
        elements.mcOptionsList = document.getElementById('mc-options-list');
        elements.addOptionBtn = document.getElementById('add-option-btn');
        elements.qCorrectAnswer = document.getElementById('q-correct-answer');
        elements.openEndedSection = document.getElementById('open-ended-section');
        elements.qModelAnswer = document.getElementById('q-model-answer');
        elements.qCaseSensitive = document.getElementById('q-case-sensitive');
        elements.qAnswerRequired = document.getElementById('q-answer-required');
        elements.qAllowSkip = document.getElementById('q-allow-skip');
        elements.qReplayIncorrect = document.getElementById('q-replay-incorrect');

        // Buttons
        elements.updateTimestampBtn = document.getElementById('update-timestamp-btn');
        elements.saveQuestionBtn = document.getElementById('save-question-btn');
        elements.duplicateQuestionBtn = document.getElementById('duplicate-question-btn');
        elements.deleteQuestionBtn = document.getElementById('delete-question-btn');
        elements.cancelEditBtn = document.getElementById('cancel-edit-btn');
        elements.saveAllBtn = document.getElementById('admin-save-all');
        elements.syncExcelBtn = document.getElementById('sync-excel-btn');
        elements.syncStatus = document.getElementById('sync-status');

        // Modals
        elements.unsavedModal = document.getElementById('unsaved-modal');
        elements.deleteModal = document.getElementById('delete-modal');

        // Admin Mode Tabs
        elements.adminTabWatch = document.getElementById('admin-tab-watch');
        elements.adminTabNotes = document.getElementById('admin-tab-notes');
        elements.adminContentWatch = document.getElementById('admin-content-watch');
        elements.adminContentNotes = document.getElementById('admin-content-notes');

        // Take Notes Elements
        elements.notesEntrySearch = document.getElementById('notes-entry-search');
        elements.notesEntryList = document.getElementById('notes-entry-list');
        elements.notesEntryTitle = document.getElementById('notes-entry-title');
        elements.notesAudioWrapper = document.getElementById('notes-audio-wrapper');
        elements.notesPreviewAudio = document.getElementById('notes-preview-audio');
        elements.notesTranscriptText = document.getElementById('notes-transcript-text');
        elements.notesSyncExcelBtn = document.getElementById('notes-sync-excel-btn');
        elements.notesEditorPlaceholder = document.getElementById('notes-editor-placeholder');
        elements.notesEntryForm = document.getElementById('notes-entry-form');
        elements.notesEntryId = document.getElementById('notes-entry-id');
        elements.notesVideoUrl = document.getElementById('notes-video-url');
        elements.notesAudioId = document.getElementById('notes-audio-id');
        elements.notesTranscript = document.getElementById('notes-transcript');
        elements.notesSaveBtn = document.getElementById('notes-save-btn');
        elements.notesPlayAudioBtn = document.getElementById('notes-play-audio-btn');
        elements.notesPreviewVideoBtn = document.getElementById('notes-preview-video-btn');
        elements.notesVideoWrapper = document.getElementById('notes-video-wrapper');
        elements.notesPreviewVideo = document.getElementById('notes-preview-video');
    }

    /**
     * Set up event listeners
     */
    function setupEventListeners() {
        // Video search
        elements.videoSearch.addEventListener('input', debounce(filterVideos, 300));

        // Sync Excel button
        elements.syncExcelBtn.addEventListener('click', syncExcelToFirestore);

        // Timeline controls
        elements.timelinePlay.addEventListener('click', togglePlay);
        elements.addQuestionBtn.addEventListener('click', addQuestion);

        // Timeline click to seek
        if (elements.timeline) {
            elements.timeline.addEventListener('click', handleTimelineClick);
        }

        // Question type toggle
        elements.qType.addEventListener('change', toggleQuestionType);

        // Form buttons
        elements.updateTimestampBtn.addEventListener('click', updateTimestamp);
        elements.addOptionBtn.addEventListener('click', addMCOption);
        elements.saveQuestionBtn.addEventListener('click', saveQuestion);
        elements.duplicateQuestionBtn.addEventListener('click', duplicateQuestion);
        elements.deleteQuestionBtn.addEventListener('click', confirmDeleteQuestion);
        elements.cancelEditBtn.addEventListener('click', cancelEdit);

        // Modal buttons
        document.getElementById('confirm-delete-btn').addEventListener('click', deleteQuestion);
        document.getElementById('cancel-delete-btn').addEventListener('click', () => {
            elements.deleteModal.style.display = 'none';
        });

        // Track unsaved changes
        elements.questionForm.addEventListener('input', () => {
            hasUnsavedChanges = true;
        });

        // Warn on leave if unsaved
        window.addEventListener('beforeunload', (e) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        });

        // Admin Mode Tabs
        if (elements.adminTabWatch) {
            elements.adminTabWatch.addEventListener('click', () => switchAdminMode('watch'));
        }
        if (elements.adminTabNotes) {
            elements.adminTabNotes.addEventListener('click', () => switchAdminMode('notes'));
        }

        // Take Notes Event Listeners
        if (elements.notesSyncExcelBtn) {
            elements.notesSyncExcelBtn.addEventListener('click', syncNotesExcelToFirestore);
        }
        if (elements.notesEntrySearch) {
            elements.notesEntrySearch.addEventListener('input', debounce(filterNotesEntries, 300));
        }
        if (elements.notesSaveBtn) {
            elements.notesSaveBtn.addEventListener('click', saveNotesEntry);
        }
        if (elements.notesPlayAudioBtn) {
            elements.notesPlayAudioBtn.addEventListener('click', playNotesAudio);
        }
        if (elements.notesPreviewVideoBtn) {
            elements.notesPreviewVideoBtn.addEventListener('click', previewNotesVideo);
        }
    }

    /**
     * Load videos from Excel
     */
    async function loadVideos() {
        try {
            const response = await fetch('database/watch/Videos.xlsx');

            console.log('Video fetch status:', response.status);
            console.log('Video fetch type:', response.headers.get('content-type'));

            if (!response.ok) {
                const text = await response.text();
                console.error('Video fetch failed body (first 100 chars):', text.substring(0, 100));
                throw new Error(`Failed to fetch database file: ${response.status} ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();

            // Debug file size
            console.log('Video file size:', arrayBuffer.byteLength);

            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet);

            // Use VideoID column from Excel (first column) - convert to string
            videos = data.map((row, index) => {
                let id = row.VideoID || row['Video ID'] || extractVideoId(row.URL) || `video-${index}`;
                return {
                    id: String(id), // Convert to string for Firestore compatibility
                    title: row.Title || 'Untitled Video',
                    level: row.Level || 'Beginner',
                    description: row.Description || '',
                    url: row.URL || ''
                };
            }).filter(v => v.url && v.id);

            // Load question counts for each video
            await loadQuestionCounts();

            renderVideoList(videos);
        } catch (error) {
            console.error('Error loading videos:', error);
            elements.videoList.innerHTML = '<div class="admin-loading">Error loading videos</div>';
        }
    }

    /**
     * Sync Excel data to Firestore
     * Creates/updates video documents in /watchVideos collection
     */
    async function syncExcelToFirestore() {
        const syncStatus = elements.syncStatus;
        const syncBtn = elements.syncExcelBtn;

        // Show loading state
        syncStatus.style.display = 'block';
        syncStatus.className = 'admin-sync-status loading';
        syncStatus.textContent = '🔄 Syncing videos to Firestore (Server-side)...';
        syncBtn.disabled = true;

        try {
            const idToken = await firebase.auth().currentUser.getIdToken();
            const response = await fetch('/api/admin/sync-database', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ type: 'watch' })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Server-side sync failed');
            }

            // Reload videos
            await loadVideos();

            // Show success
            syncStatus.className = 'admin-sync-status success';
            syncStatus.textContent = `✅ ${result.message}`;

            // Hide after 3 seconds
            setTimeout(() => {
                syncStatus.style.display = 'none';
            }, 3000);

        } catch (error) {
            console.error('Error syncing to Firestore:', error);
            syncStatus.className = 'admin-sync-status error';
            syncStatus.textContent = `❌ Error: ${error.message}`;
        } finally {
            syncBtn.disabled = false;
        }
    }

    /**
     * Load question counts from Firestore
     */
    async function loadQuestionCounts() {
        const db = firebase.firestore();

        for (const video of videos) {
            try {
                const snapshot = await db.collection('watchVideos')
                    .doc(video.id)
                    .collection('questions')
                    .get();
                video.questionCount = snapshot.size;
            } catch (error) {
                video.questionCount = 0;
            }
        }
    }

    /**
     * Extract video ID from URL
     */
    function extractVideoId(url) {
        if (!url) return null;
        if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

        let match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];

        match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];

        return null;
    }

    /**
     * Render video list
     */
    function renderVideoList(videosToRender) {
        elements.videoList.innerHTML = videosToRender.map(video => `
            <div class="admin-video-item ${currentVideo?.id === video.id ? 'selected' : ''}" 
                 data-video-id="${escapeHTML(video.id)}" 
                 onclick="WatchAdmin.selectVideo('${escapeHTML(video.id)}')">
                <h4 class="admin-video-item-title">${escapeHTML(video.title)}</h4>
                <span class="admin-video-item-level ${escapeHTML(video.level.toLowerCase())}">${escapeHTML(video.level)}</span>
                <div class="admin-video-item-questions">${video.questionCount || 0} questions</div>
            </div>
        `).join('');
    }

    /**
     * Filter videos
     */
    function filterVideos() {
        const searchTerm = elements.videoSearch.value.toLowerCase();
        const filtered = videos.filter(video =>
            video.title.toLowerCase().includes(searchTerm)
        );
        renderVideoList(filtered);
    }

    /**
     * Select a video
     */
    async function selectVideo(videoId) {
        if (hasUnsavedChanges) {
            // Show unsaved warning
            if (!confirm('You have unsaved changes. Continue anyway?')) {
                return;
            }
        }

        currentVideo = videos.find(v => v.id === videoId);
        if (!currentVideo) return;

        // Update UI
        elements.playerVideoTitle.textContent = currentVideo.title;
        elements.addQuestionBtn.disabled = false;
        renderVideoList(videos);

        // Initialize player
        await initPlayer(currentVideo.url);

        // Load questions
        await loadQuestions(videoId);

        // Hide editor
        hideEditor();
    }

    /**
     * Initialize YouTube player
     */
    async function initPlayer(url) {
        if (window.YouTubePlayer) {
            await window.YouTubePlayer.init(elements.playerContainer, {
                onReady: onPlayerReady,
                onStateChange: onPlayerStateChange,
                onTimeUpdate: onTimeUpdate
            });
            window.YouTubePlayer.loadVideo(url);
            player = window.YouTubePlayer;
        }
    }

    function onPlayerReady() {
        elements.timelinePlay.textContent = '▶';
        // Poll for video duration (it's often 0 until video metadata loads)
        waitForDuration();
    }

    /**
     * Poll for video duration until it's available
     * YouTube API returns 0 until video metadata is fully loaded
     */
    let durationPollCount = 0;
    const MAX_DURATION_POLLS = 50; // 10 seconds max (50 * 200ms)

    function waitForDuration() {
        durationPollCount++;

        if (durationPollCount > MAX_DURATION_POLLS) {
            console.warn('[Admin] Gave up waiting for video duration after 10s');
            return;
        }

        if (player && typeof player.getDuration === 'function') {
            const duration = player.getDuration();
            if (duration > 0) {
                videoDuration = duration;
                console.log('[Admin] Video duration loaded:', formatTime(duration));
                updateTimelineMarkers();
                renderQuestionList();
                durationPollCount = 0; // Reset for next video
                return;
            }
        }

        // Keep polling every 200ms until duration is available or player is ready
        setTimeout(waitForDuration, 200);
    }

    function onPlayerStateChange(event) {
        if (event.data === 1) {
            elements.timelinePlay.textContent = '⏸';
            // Update duration when video starts playing (guaranteed to be available)
            if (player && player.getDuration() > 0) {
                videoDuration = player.getDuration();
                updateTimelineMarkers();
                renderQuestionList();
            }
        } else {
            elements.timelinePlay.textContent = '▶';
        }
    }

    function onTimeUpdate(currentTime) {
        if (videoDuration > 0) {
            const progress = (currentTime / videoDuration) * 100;
            elements.timelineProgress.style.width = `${progress}%`;
        }
        elements.timelineTime.textContent = `${formatTime(currentTime)} / ${formatTime(videoDuration)}`;
    }

    /**
     * Handle click on timeline to seek video
     */
    function handleTimelineClick(event) {
        if (!player || videoDuration <= 0) return;

        const rect = elements.timeline.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const percentage = clickX / rect.width;
        const seekTime = percentage * videoDuration;

        player.seekTo(seekTime);

        // Update the progress bar immediately for visual feedback
        elements.timelineProgress.style.width = `${percentage * 100}%`;
        elements.timelineTime.textContent = `${formatTime(seekTime)} / ${formatTime(videoDuration)}`;
    }

    /**
     * Toggle play/pause
     */
    function togglePlay() {
        if (!player) return;
        if (player.isPlaying()) {
            player.pause();
        } else {
            player.play();
        }
    }

    /**
     * Load questions from Firestore
     */
    async function loadQuestions(videoId) {
        try {
            const db = firebase.firestore();
            const snapshot = await db.collection('watchVideos')
                .doc(videoId)
                .collection('questions')
                .orderBy('timestamp')
                .get();

            questions = [];
            snapshot.forEach(doc => {
                questions.push({ id: doc.id, ...doc.data() });
            });

            updateTimelineMarkers();
            renderQuestionList();
        } catch (error) {
            console.error('Error loading questions:', error);
            questions = [];
        }
    }

    /**
     * Update timeline markers
     */
    function updateTimelineMarkers() {
        if (!elements.timelineMarkers || videoDuration === 0) return;

        elements.timelineMarkers.innerHTML = questions.map((q, index) => {
            const position = (q.timestamp / videoDuration) * 100;
            const isSelected = currentQuestion?.id === q.id;
            return `<div class="admin-timeline-marker ${isSelected ? 'selected' : ''}" 
                        style="left: ${position}%"
                        title="Q${index + 1} at ${formatTime(q.timestamp)}"
                        onclick="WatchAdmin.selectQuestion('${q.id}')">${index + 1}</div>`;
        }).join('');
    }

    /**
     * Render question list in editor panel
     */
    function renderQuestionList() {
        if (!elements.questionList || !elements.questionListContainer) return;

        if (questions.length === 0) {
            elements.questionListContainer.style.display = 'none';
            return;
        }

        elements.questionListContainer.style.display = 'block';

        elements.questionList.innerHTML = questions.map((q, index) => {
            const isSelected = currentQuestion?.id === q.id;
            const text = q.questionText || 'No question text';
            const questionPreview = text.substring(0, 50) + (text.length > 50 ? '...' : '');

            return `
                <div class="admin-question-item ${isSelected ? 'selected' : ''}" 
                     onclick="WatchAdmin.selectQuestion('${escapeHTML(q.id)}')">
                    <span class="admin-question-number">Q${index + 1}</span>
                    <span class="admin-question-time">${formatTime(q.timestamp)}</span>
                    <span class="admin-question-preview">${escapeHTML(questionPreview)}</span>
                    <span class="admin-question-type">${q.questionType === 'multiple_choice' ? 'MC' : 'Open'}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * Select a question for editing
     */
    function selectQuestion(questionId) {
        if (hasUnsavedChanges) {
            if (!confirm('You have unsaved changes. Continue anyway?')) {
                return;
            }
        }

        currentQuestion = questions.find(q => q.id === questionId);
        if (!currentQuestion) return;

        isNewQuestion = false;
        populateEditor(currentQuestion);
        showEditor();

        // Seek video to question time
        if (player) {
            player.seekTo(currentQuestion.timestamp);
        }

        updateTimelineMarkers();
        renderQuestionList();
    }

    /**
     * Add new question at current time
     */
    function addQuestion() {
        if (!player || !currentVideo) return;

        const timestamp = Math.floor(player.getCurrentTime());

        isNewQuestion = true;
        currentQuestion = {
            id: `q-${Date.now()}`,
            timestamp: timestamp,
            questionText: '',
            questionType: 'multiple_choice',
            options: ['', '', '', ''],
            correctAnswer: 0,
            voicedAudio: false,
            answerRequired: true,
            allowSkip: false,
            replayOnIncorrect: false
        };

        populateEditor(currentQuestion);
        showEditor();
    }

    /**
     * Populate editor with question data
     */
    function populateEditor(question) {
        elements.qId.value = question.id;
        elements.qTimestamp.value = question.timestamp;
        elements.qText.value = question.questionText || '';
        elements.qVoiced.checked = question.voicedAudio || false;
        elements.qType.value = question.questionType || 'multiple_choice';
        elements.qCorrectAnswer.value = question.correctAnswer || 0;
        elements.qModelAnswer.value = question.modelAnswer || '';
        elements.qCaseSensitive.checked = question.caseSensitive || false;
        elements.qAnswerRequired.checked = question.answerRequired !== false;
        elements.qAllowSkip.checked = question.allowSkip || false;
        elements.qReplayIncorrect.checked = question.replayOnIncorrect || false;

        // Render MC options
        renderMCOptions(question.options || ['', '', '', '']);

        // Toggle sections
        toggleQuestionType();

        hasUnsavedChanges = false;
    }

    /**
     * Render MC options inputs
     */
    function renderMCOptions(options) {
        elements.mcOptionsList.innerHTML = options.map((opt, index) => `
            <div class="admin-mc-option">
                <span class="admin-mc-option-label">${String.fromCharCode(65 + index)}</span>
                <input type="text" class="admin-input mc-option-input" value="${escapeHTML(opt || '')}" placeholder="Option ${String.fromCharCode(65 + index)}" />
                <button type="button" class="admin-mc-option-remove" onclick="WatchAdmin.removeMCOption(${index})">×</button>
            </div>
        `).join('');
    }

    /**
     * Add MC option
     */
    function addMCOption() {
        const inputs = elements.mcOptionsList.querySelectorAll('.mc-option-input');
        const currentOptions = Array.from(inputs).map(input => input.value);
        currentOptions.push('');
        renderMCOptions(currentOptions);
        hasUnsavedChanges = true;
    }

    /**
     * Remove MC option
     */
    function removeMCOption(index) {
        const inputs = elements.mcOptionsList.querySelectorAll('.mc-option-input');
        const currentOptions = Array.from(inputs).map(input => input.value);
        currentOptions.splice(index, 1);
        renderMCOptions(currentOptions);
        hasUnsavedChanges = true;
    }

    /**
     * Toggle question type sections
     */
    function toggleQuestionType() {
        const type = elements.qType.value;
        if (type === 'multiple_choice') {
            elements.mcOptionsSection.style.display = 'block';
            elements.openEndedSection.style.display = 'none';
        } else {
            elements.mcOptionsSection.style.display = 'none';
            elements.openEndedSection.style.display = 'block';
        }
    }

    /**
     * Update timestamp to current playback time
     */
    function updateTimestamp() {
        if (player) {
            const currentTime = Math.floor(player.getCurrentTime());
            elements.qTimestamp.value = currentTime;
            hasUnsavedChanges = true;
        }
    }

    /**
     * Save question
     */
    async function saveQuestion() {
        if (!currentVideo || !currentQuestion) return;

        // Gather form data
        const questionData = {
            timestamp: parseInt(elements.qTimestamp.value) || 0,
            questionText: elements.qText.value.trim(),
            questionType: elements.qType.value,
            voicedAudio: elements.qVoiced.checked,
            answerRequired: elements.qAnswerRequired.checked,
            allowSkip: elements.qAllowSkip.checked,
            replayOnIncorrect: elements.qReplayIncorrect.checked,
            updatedAt: new Date()
        };

        if (questionData.questionType === 'multiple_choice') {
            const inputs = elements.mcOptionsList.querySelectorAll('.mc-option-input');
            questionData.options = Array.from(inputs).map(input => input.value);
            questionData.correctAnswer = parseInt(elements.qCorrectAnswer.value) || 0;
        } else {
            questionData.modelAnswer = elements.qModelAnswer.value.trim();
            questionData.caseSensitive = elements.qCaseSensitive.checked;
        }

        // Validate
        if (!questionData.questionText) {
            showNotification('Please enter question text', 'warning');
            return;
        }

        try {
            const db = firebase.firestore();
            const questionId = isNewQuestion ? `q-${Date.now()}` : currentQuestion.id;

            await db.collection('watchVideos')
                .doc(currentVideo.id)
                .collection('questions')
                .doc(questionId)
                .set(questionData, { merge: true });

            console.log('Question saved:', questionId);
            hasUnsavedChanges = false;

            // Reload questions
            await loadQuestions(currentVideo.id);

            // Update video question count
            currentVideo.questionCount = questions.length;
            renderVideoList(videos);

            // Select the saved question
            currentQuestion = questions.find(q => q.id === questionId);
            if (currentQuestion) {
                selectQuestion(questionId);
            }

            showNotification('Question saved successfully!', 'success');
        } catch (error) {
            console.error('Error saving question:', error);
            showNotification('Error saving question. Please try again.', 'error');
        }
    }

    /**
     * Duplicate question
     */
    function duplicateQuestion() {
        if (!currentQuestion) return;

        isNewQuestion = true;
        currentQuestion = {
            ...currentQuestion,
            id: `q-${Date.now()}`,
            timestamp: currentQuestion.timestamp + 5 // Offset by 5 seconds
        };

        populateEditor(currentQuestion);
        hasUnsavedChanges = true;
    }

    /**
     * Confirm delete question
     */
    function confirmDeleteQuestion() {
        if (!currentQuestion || isNewQuestion) return;
        elements.deleteModal.style.display = 'flex';
    }

    /**
     * Delete question
     */
    async function deleteQuestion() {
        if (!currentVideo || !currentQuestion || isNewQuestion) return;

        try {
            const db = firebase.firestore();
            await db.collection('watchVideos')
                .doc(currentVideo.id)
                .collection('questions')
                .doc(currentQuestion.id)
                .delete();

            console.log('Question deleted:', currentQuestion.id);

            elements.deleteModal.style.display = 'none';
            hasUnsavedChanges = false;

            // Reload questions
            await loadQuestions(currentVideo.id);

            // Update video question count
            currentVideo.questionCount = questions.length;
            renderVideoList(videos);

            hideEditor();
            currentQuestion = null;

            showNotification('Question deleted!', 'success');
        } catch (error) {
            console.error('Error deleting question:', error);
            showNotification('Error deleting question.', 'error');
        }
    }

    /**
     * Cancel editing
     */
    function cancelEdit() {
        if (hasUnsavedChanges) {
            if (!confirm('You have unsaved changes. Discard them?')) {
                return;
            }
        }
        hideEditor();
        currentQuestion = null;
        hasUnsavedChanges = false;
        updateTimelineMarkers();
    }

    /**
     * Show editor
     */
    function showEditor() {
        elements.editorPlaceholder.style.display = 'none';
        elements.questionForm.style.display = 'flex';
    }

    /**
     * Hide editor
     */
    function hideEditor() {
        elements.editorPlaceholder.style.display = 'flex';
        elements.questionForm.style.display = 'none';
    }

    /**
     * Format seconds to MM:SS
     */
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Debounce utility
     */
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    // ========================================
    // TAKE NOTES FUNCTIONS
    // ========================================

    /**
     * Switch between Watch and Take Notes admin modes
     */
    function switchAdminMode(mode) {
        currentAdminMode = mode;

        // Update tab styles
        elements.adminTabWatch.classList.toggle('active', mode === 'watch');
        elements.adminTabNotes.classList.toggle('active', mode === 'notes');

        // Show/hide content
        elements.adminContentWatch.style.display = mode === 'watch' ? 'grid' : 'none';
        elements.adminContentNotes.style.display = mode === 'notes' ? 'grid' : 'none';

        // Auto-load data when switching to Take Notes mode
        if (mode === 'notes' && notesEntries.length === 0) {
            loadNotesEntries();
        }

        console.log(`[Admin] Switched to ${mode} mode`);
    }

    /**
     * Load Take Notes entries from Firestore (called on init)
     */
    async function loadNotesEntries() {
        try {
            elements.notesEntryList.innerHTML = '<div class="admin-loading">Loading entries...</div>';

            const db = firebase.firestore();
            const snapshot = await db.collection('takeNotesEntries').orderBy('id').get();

            if (snapshot.empty) {
                elements.notesEntryList.innerHTML = `
                    <div class="admin-empty">
                        <p>No entries in Firestore</p>
                        <p>Click "Update from Excel" to import data</p>
                    </div>
                `;
                notesEntries = [];
                return;
            }

            notesEntries = snapshot.docs.map(doc => doc.data());
            console.log(`[Admin] Loaded ${notesEntries.length} Take Notes entries from Firestore`);
            renderNotesEntryList(notesEntries);

        } catch (error) {
            console.error('[Admin] Error loading Take Notes entries:', error);
            elements.notesEntryList.innerHTML = `
                <div class="admin-error">
                    <p>Error loading entries: ${error.message}</p>
                    <p>Try clicking "Update from Excel" to import data</p>
                </div>
            `;
        }
    }

    /**
     * Sync Take Notes entries from Excel to Firestore
     */
    async function syncNotesExcelToFirestore() {
        const syncBtn = elements.notesSyncExcelBtn;
        const originalText = syncBtn.textContent;

        try {
            syncBtn.disabled = true;
            syncBtn.textContent = '🔄 Syncing...';

            const idToken = await firebase.auth().currentUser.getIdToken();
            const response = await fetch('/api/admin/sync-database', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ type: 'notes' })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Server-side sync failed');
            }

            console.log(`[Admin] Server result: ${result.message}`);

            // Reload entries from Firestore
            await loadNotesEntries();

            // Show success
            syncBtn.textContent = `✅ Synced!`;
            setTimeout(() => {
                syncBtn.disabled = false;
                syncBtn.textContent = originalText;
            }, 2000);

        } catch (error) {
            console.error('[Admin] Error syncing Take Notes entries:', error);
            syncBtn.textContent = `❌ Error: ${error.message}`;
            setTimeout(() => {
                syncBtn.disabled = false;
                syncBtn.textContent = originalText;
            }, 3000);
        }
    }

    /**
     * Render Take Notes entry list
     */
    function renderNotesEntryList(entriesToRender) {
        if (entriesToRender.length === 0) {
            elements.notesEntryList.innerHTML = '<div class="admin-empty">No entries found</div>';
            return;
        }

        // Sort numerically by ID (parse as integer for proper numerical sorting)
        const sortedEntries = [...entriesToRender].sort((a, b) => {
            const numA = parseInt(a.id, 10);
            const numB = parseInt(b.id, 10);
            // Handle non-numeric IDs by falling back to string comparison
            if (isNaN(numA) && isNaN(numB)) return a.id.localeCompare(b.id);
            if (isNaN(numA)) return 1;
            if (isNaN(numB)) return -1;
            return numA - numB;
        });

        elements.notesEntryList.innerHTML = sortedEntries.map(entry => {
            const transcript = entry.transcript || 'No transcript';
            const preview = transcript.substring(0, 50) + (transcript.length > 50 ? '...' : '');
            return `
                <div class="admin-video-item ${currentNotesEntry && currentNotesEntry.id === entry.id ? 'selected' : ''}" 
                     data-entry-id="${escapeHTML(entry.id)}"
                     onclick="window.WatchAdmin.selectNotesEntry('${escapeHTML(entry.id)}')">
                    <div class="admin-video-title">${escapeHTML(entry.id)}</div>
                    <div class="admin-video-meta">
                        ${escapeHTML(preview)}
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Filter Take Notes entries
     */
    function filterNotesEntries() {
        const query = elements.notesEntrySearch.value.toLowerCase().trim();
        if (!query) {
            renderNotesEntryList(notesEntries);
            return;
        }

        const filtered = notesEntries.filter(entry =>
            entry.id.toLowerCase().includes(query) ||
            entry.transcript.toLowerCase().includes(query)
        );
        renderNotesEntryList(filtered);
    }

    /**
     * Select a Take Notes entry
     */
    function selectNotesEntry(entryId) {
        const entry = notesEntries.find(e => e.id === entryId);
        if (!entry) return;

        currentNotesEntry = entry;

        console.log('[Admin] Selected entry:', entryId);
        console.log('[Admin] Entry data:', entry);
        console.log('[Admin] Entry videoUrl:', entry.videoUrl);

        // Update selection in list
        document.querySelectorAll('#notes-entry-list .admin-video-item').forEach(el => {
            el.classList.toggle('selected', el.dataset.entryId === entryId);
        });

        // Update title
        elements.notesEntryTitle.textContent = `Entry: ${entry.id}`;

        // Show audio preview
        elements.notesAudioWrapper.style.display = 'block';
        document.querySelector('.admin-player-placeholder')?.style.setProperty('display', 'none');

        // Update transcript preview
        elements.notesTranscriptText.textContent = entry.transcript || 'No transcript available';

        // Show editor form
        elements.notesEditorPlaceholder.style.display = 'none';
        elements.notesEntryForm.style.display = 'block';

        // Populate form
        elements.notesEntryId.value = entry.id;
        elements.notesVideoUrl.value = entry.videoUrl || '';
        elements.notesAudioId.value = entry.id;
        elements.notesTranscript.value = entry.transcript || '';

        console.log('[Admin] Video URL field value after setting:', elements.notesVideoUrl.value);

        // Try to load audio
        loadNotesAudio(entry.id);
    }

    /**
     * Load audio file for Take Notes entry with extension fallback
     */
    async function loadNotesAudio(audioId) {
        const tryExtensions = ['m4a', 'wav', 'mp3', 'aac', 'ogg'];
        const basePath = `database/Take Notes/RL/audio/${audioId}`;

        for (const ext of tryExtensions) {
            const audioPath = `${basePath}.${ext}`;
            const exists = await checkNotesFileExists(audioPath);
            if (exists) {
                elements.notesPreviewAudio.src = audioPath;
                console.log(`[Admin] Loaded audio: ${audioPath}`);
                return;
            }
        }

        console.warn(`[Admin] No audio file found for ${audioId}`);
        elements.notesPreviewAudio.src = '';
    }

    /**
     * Check if file exists (for audio detection)
     */
    async function checkNotesFileExists(url) {
        try {
            const response = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
            const contentType = response.headers.get('content-type');
            return response.ok && response.status === 200 && contentType && contentType.startsWith('audio/');
        } catch (e) {
            return false;
        }
    }

    /**
     * Play audio preview
     */
    function playNotesAudio() {
        if (elements.notesPreviewAudio.src) {
            elements.notesPreviewAudio.play();
        }
    }

    /**
     * Preview guiding video
     */
    function previewNotesVideo() {
        // Try cached element first, then fall back to direct DOM query
        const urlElement = elements.notesVideoUrl || document.getElementById('notes-video-url');
        const url = urlElement ? urlElement.value.trim() : '';

        console.log('[Admin] Preview video - URL element:', urlElement);
        console.log('[Admin] Preview video - URL value:', url);

        if (!url) {
            showNotification('No video URL entered', 'warning');
            return;
        }

        const videoId = extractVideoId(url);
        console.log('[Admin] Extracted video ID:', videoId);

        if (!videoId) {
            showNotification('Invalid YouTube URL', 'error');
            return;
        }

        // Show video wrapper, hide placeholder - use direct DOM queries
        const placeholder = document.querySelector('#notes-preview-container .admin-player-placeholder');
        const videoWrapper = document.getElementById('notes-video-wrapper');
        const previewVideo = document.getElementById('notes-preview-video');

        console.log('[Admin] Video wrapper:', videoWrapper);
        console.log('[Admin] Preview video container:', previewVideo);

        if (placeholder) placeholder.style.display = 'none';
        if (videoWrapper) {
            videoWrapper.style.display = 'block';
        }

        // Embed YouTube video
        if (previewVideo) {
            previewVideo.innerHTML = `
                <iframe 
                    width="100%" 
                    height="315" 
                    src="https://www.youtube.com/embed/${escapeHTML(videoId)}" 
                    frameborder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowfullscreen>
                </iframe>
            `;
            console.log('[Admin] Video iframe embedded successfully');
        } else {
            console.error('[Admin] Preview video container not found!');
        }

        console.log('[Admin] Previewing video:', videoId);
    }

    /**
     * Save Take Notes entry to Firestore
     */
    async function saveNotesEntry() {
        if (!currentNotesEntry) return;

        try {
            const db = firebase.firestore();
            const entryData = {
                id: elements.notesEntryId.value,
                videoUrl: elements.notesVideoUrl.value.trim(),
                transcript: elements.notesTranscript.value.trim(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await db.collection('takeNotesEntries').doc(entryData.id).set(entryData, { merge: true });

            showNotification('Entry saved to Firestore!', 'success');
            console.log('[Admin] Saved Take Notes entry:', entryData.id);
        } catch (error) {
            console.error('[Admin] Error saving entry:', error);
            showNotification('Error saving entry: ' + error.message, 'error');
        }
    }

    // Initialize on DOM ready
    document.addEventListener('DOMContentLoaded', init);

    // Public API
    window.WatchAdmin = {
        selectVideo,
        selectQuestion,
        removeMCOption,
        selectNotesEntry
    };
})();
