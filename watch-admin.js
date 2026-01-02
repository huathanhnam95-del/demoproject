/**
 * Watch Admin Console
 * Admin interface for managing video questions
 */

(function () {
    'use strict';

    // Firebase config - MUST match the main app (index.html)
    const firebaseConfig = {
        apiKey: "AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ",
        authDomain: "listening-tasks-3ae34.firebaseapp.com",
        projectId: "listening-tasks-3ae34",
        storageBucket: "listening-tasks-3ae34.firebasestorage.app",
        messagingSenderId: "737872673808",
        appId: "1:737872673808:web:4db57599aa22b4830fde95",
        measurementId: "G-1891MSSLXT"
    };

    // Admin email whitelist
    const ADMIN_EMAIL = 'huathanhnam95@gmail.com';

    // State
    let videos = [];
    let currentVideo = null;
    let questions = [];
    let currentQuestion = null;
    let player = null;
    let videoDuration = 0;
    let hasUnsavedChanges = false;
    let isNewQuestion = false;

    // DOM Elements
    const elements = {};

    /**
     * Initialize admin console
     */
    async function init() {
        // Initialize Firebase
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }

        // Cache DOM elements
        cacheElements();

        // Show loading state
        elements.videoList.innerHTML = '<div class="admin-loading">Checking authentication...</div>';

        // Wait for Firebase auth to fully initialize
        // The first onAuthStateChanged may fire with null while Firebase is still loading
        // We use a promise to ensure we get the final auth state
        try {
            const user = await new Promise((resolve, reject) => {
                const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
                    unsubscribe(); // Unsubscribe after first callback
                    resolve(user);
                }, reject);

                // Timeout after 5 seconds if auth is stuck
                setTimeout(() => {
                    unsubscribe();
                    resolve(null);
                }, 5000);
            });

            if (user) {
                if (user.email !== ADMIN_EMAIL) {
                    alert('Access denied. Admin privileges required.');
                    window.location.href = 'index.html';
                    return;
                }
                elements.userEmail.textContent = user.email;
                await loadVideos();
            } else {
                // Not logged in - redirect to main app
                alert('Please log in as admin first.');
                window.location.href = 'index.html';
                return;
            }
        } catch (error) {
            console.error('Auth error:', error);
            window.location.href = 'index.html';
            return;
        }

        // Set up event listeners
        setupEventListeners();
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
    }

    /**
     * Load videos from Excel
     */
    async function loadVideos() {
        try {
            const response = await fetch('database/watch/Videos.xlsx');
            const arrayBuffer = await response.arrayBuffer();
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
        syncStatus.textContent = '🔄 Syncing videos to Firestore...';
        syncBtn.disabled = true;

        try {
            // Reload videos from Excel first
            const response = await fetch('database/watch/Videos.xlsx');
            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet);

            const db = firebase.firestore();
            const batch = db.batch();
            let syncCount = 0;

            for (const row of data) {
                // Use VideoID column from Excel - MUST be string for Firestore doc ID
                let videoId = row.VideoID || row['Video ID'] || extractVideoId(row.URL);
                if (!videoId || !row.URL) continue;

                // Convert to string (Excel might return numbers)
                videoId = String(videoId);

                const videoRef = db.collection('watchVideos').doc(videoId);
                batch.set(videoRef, {
                    id: videoId,
                    title: row.Title || 'Untitled Video',
                    level: row.Level || 'Beginner',
                    description: row.Description || '',
                    url: row.URL,
                    updatedAt: new Date(),
                    syncedFromExcel: true
                }, { merge: true });

                syncCount++;
            }

            await batch.commit();

            // Reload videos
            await loadVideos();

            // Show success
            syncStatus.className = 'admin-sync-status success';
            syncStatus.textContent = `✅ Successfully synced ${syncCount} videos to Firestore!`;

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
                 data-video-id="${video.id}" 
                 onclick="WatchAdmin.selectVideo('${video.id}')">
                <h4 class="admin-video-item-title">${video.title}</h4>
                <span class="admin-video-item-level ${video.level.toLowerCase()}">${video.level}</span>
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
            const questionPreview = q.questionText
                ? q.questionText.substring(0, 50) + (q.questionText.length > 50 ? '...' : '')
                : 'No question text';
            return `
                <div class="admin-question-item ${isSelected ? 'selected' : ''}" 
                     onclick="WatchAdmin.selectQuestion('${q.id}')">
                    <span class="admin-question-number">Q${index + 1}</span>
                    <span class="admin-question-time">${formatTime(q.timestamp)}</span>
                    <span class="admin-question-preview">${questionPreview}</span>
                    <span class="admin-question-type">${q.type === 'mc' ? 'MC' : 'Open'}</span>
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
                <input type="text" class="admin-input mc-option-input" value="${opt || ''}" placeholder="Option ${String.fromCharCode(65 + index)}" />
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
            alert('Please enter question text');
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

            alert('Question saved successfully!');
        } catch (error) {
            console.error('Error saving question:', error);
            alert('Error saving question. Please try again.');
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

            alert('Question deleted!');
        } catch (error) {
            console.error('Error deleting question:', error);
            alert('Error deleting question.');
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

    // Initialize on DOM ready
    document.addEventListener('DOMContentLoaded', init);

    // Public API
    window.WatchAdmin = {
        selectVideo,
        selectQuestion,
        removeMCOption
    };
})();
