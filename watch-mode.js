/**
 * Watch Mode Module
 * Handles video lessons with timed questions
 * 
 * Data Layer:
 * - Video data: from Excel file (Title, Level, Description, URL)
 * - Question data: from Firestore /watchVideos/{videoId}/questions
 * - User progress: from Firestore /users/{userId}/watchProgress/{videoId}
 */

const WatchMode = (function () {
    'use strict';

    // State
    let videos = [];
    let currentVideo = null;
    let questions = [];
    let currentQuestion = null;
    let questionQueue = []; // Queue for multiple questions at same timestamp
    let answeredQuestions = new Set(); // Tracks questions that earned points (persisted)
    let triggeredThisSession = new Set(); // Tracks questions triggered this playback session
    let watchPoints = 0;
    let player = null;
    let videoDuration = 0;
    let lastCheckedTime = 0;
    let skipFirstTimeUpdate = false; // Skip first time update after video switch to prevent immediate triggers
    let questionTimestamps = [];
    let isInitialized = false;

    // Constants
    const POINTS_MULTIPLE_CHOICE = 5;
    const POINTS_OPEN_ENDED = 10;
    const EXCEL_PATH = 'database/watch/Videos.xlsx';

    // DOM Elements (cached)
    let elements = {};

    /**
     * Initialize Watch mode
     */
    async function init() {
        if (isInitialized) return;

        // Cache DOM elements
        cacheElements();

        // Set up event listeners
        setupEventListeners();

        // Load videos from Excel
        await loadVideos();

        isInitialized = true;
        console.log('[WatchMode] Initialized');
    }

    /**
     * Cache DOM elements for performance
     */
    function cacheElements() {
        elements = {
            // Views
            videoListView: document.getElementById('watch-video-list-view'),
            playerView: document.getElementById('watch-player-view'),

            // Video list
            videoGrid: document.getElementById('watch-video-grid'),
            searchInput: document.getElementById('watch-search-input'),
            levelFilter: document.getElementById('watch-level-filter'),

            // Player
            playerWrapper: document.getElementById('watch-player-wrapper'),
            youtubePlayer: document.getElementById('watch-youtube-player'),
            backToListBtn: document.getElementById('watch-back-to-list'),
            currentTitle: document.getElementById('watch-current-title'),
            currentDescription: document.getElementById('watch-current-description'),
            playBtn: document.getElementById('watch-play-btn'),
            timeDisplay: document.getElementById('watch-time-display'),
            progressFill: document.getElementById('watch-progress-fill'),
            progressBar: document.getElementById('watch-progress-bar'),
            questionMarkers: document.getElementById('watch-question-markers'),
            scoreDisplay: document.getElementById('watch-score'),

            // Question panel (side panel, not overlay)
            questionOverlay: document.getElementById('watch-question-panel'),
            questionNumber: document.getElementById('watch-question-number'),
            questionText: document.getElementById('watch-question-text'),
            playQuestionAudio: document.getElementById('watch-play-question-audio'),
            skipBtn: document.getElementById('watch-skip-question'),
            mcOptions: document.getElementById('watch-mc-options'),
            openAnswer: document.getElementById('watch-open-answer'),
            answerInput: document.getElementById('watch-answer-input'),
            submitBtn: document.getElementById('watch-submit-answer'),
            feedback: document.getElementById('watch-feedback'),
            feedbackText: document.getElementById('watch-feedback-text'),
            continueBtn: document.getElementById('watch-continue-btn'),
            replaySegmentBtn: document.getElementById('watch-replay-segment-btn')
        };
    }

    /**
     * Set up event listeners
     */
    function setupEventListeners() {
        // Search and filter
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', debounce(filterVideos, 300));
        }
        if (elements.levelFilter) {
            elements.levelFilter.addEventListener('change', filterVideos);
        }

        // Back button
        if (elements.backToListBtn) {
            elements.backToListBtn.addEventListener('click', showVideoList);
        }

        // Play button
        if (elements.playBtn) {
            elements.playBtn.addEventListener('click', togglePlay);
        }

        // Question actions
        if (elements.submitBtn) {
            elements.submitBtn.addEventListener('click', submitAnswer);
        }
        if (elements.skipBtn) {
            elements.skipBtn.addEventListener('click', skipQuestion);
        }
        if (elements.continueBtn) {
            elements.continueBtn.addEventListener('click', continuePlayback);
        }
        if (elements.replaySegmentBtn) {
            elements.replaySegmentBtn.addEventListener('click', replaySegment);
        }
        if (elements.playQuestionAudio) {
            elements.playQuestionAudio.addEventListener('click', playQuestionTTS);
        }

        // Progress bar click to seek
        if (elements.progressBar) {
            elements.progressBar.addEventListener('click', handleProgressBarClick);
        }
    }

    /**
     * Load videos from Excel file
     */
    async function loadVideos() {
        try {
            const response = await fetch(EXCEL_PATH);
            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet);

            // Use VideoID column from Excel (first column) - convert to string
            videos = data.map((row, index) => {
                let id = row.VideoID || row['Video ID'] || (row.URL ? extractVideoId(row.URL) : null) || `video-${index}`;
                return {
                    id: String(id), // Convert to string for Firestore compatibility
                    title: row.Title || 'Untitled Video',
                    level: row.Level || 'Beginner',
                    description: row.Description || '',
                    url: row.URL || '',
                    thumbnail: row.URL ? getYouTubeThumbnail(row.URL) : null
                };
            }).filter(v => v.url && v.id);

            console.log(`[WatchMode] Loaded ${videos.length} videos`);
            renderVideoGrid(videos);
        } catch (error) {
            console.error('[WatchMode] Error loading videos:', error);
            elements.videoGrid.innerHTML = `
                <div class="watch-empty-state">
                    <h3>Unable to load videos</h3>
                    <p>Something went wrong. Please try again later.</p>
                </div>
            `;
        }
    }

    /**
     * Extract video ID from YouTube URL
     */
    function extractVideoId(url) {
        if (!url) return null;
        if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

        let match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];

        match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];

        match = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];

        return null;
    }

    /**
     * Get YouTube thumbnail URL
     */
    function getYouTubeThumbnail(url) {
        const videoId = extractVideoId(url);
        if (videoId) {
            return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        }
        return null;
    }

    /**
     * Render video grid
     */
    function renderVideoGrid(videosToRender) {
        if (!elements.videoGrid) return;

        if (videosToRender.length === 0) {
            elements.videoGrid.innerHTML = `
                <div class="watch-empty-state">
                    <h3>No videos found</h3>
                    <p>Try adjusting your search or filter</p>
                </div>
            `;
            return;
        }

        elements.videoGrid.innerHTML = videosToRender.map(video => `
            <div class="watch-video-card" data-video-id="${video.id}" onclick="WatchMode.selectVideo('${video.id}')">
                <div class="watch-video-thumbnail">
                    ${video.thumbnail ? `<img src="${video.thumbnail}" alt="${video.title}" onerror="this.style.display='none'">` : '▶'}
                </div>
                <div class="watch-video-card-info">
                    <span class="watch-video-card-level ${video.level.toLowerCase()}">${video.level}</span>
                    <h4 class="watch-video-card-title">${video.title}</h4>
                    <p class="watch-video-card-desc">${video.description}</p>
                </div>
            </div>
        `).join('');
    }

    /**
     * Filter videos based on search and level
     */
    function filterVideos() {
        const searchTerm = (elements.searchInput?.value || '').toLowerCase();
        const levelFilter = elements.levelFilter?.value || '';

        const filtered = videos.filter(video => {
            const matchesSearch = !searchTerm ||
                video.title.toLowerCase().includes(searchTerm) ||
                video.description.toLowerCase().includes(searchTerm);
            const matchesLevel = !levelFilter || video.level === levelFilter;
            return matchesSearch && matchesLevel;
        });

        renderVideoGrid(filtered);
    }

    /**
     * Select a video to watch
     */
    async function selectVideo(videoId) {
        currentVideo = videos.find(v => v.id === videoId);
        if (!currentVideo) {
            console.error('[WatchMode] Video not found:', videoId);
            return;
        }

        // Reset question state BEFORE loading new video
        currentQuestion = null;
        questionQueue = [];
        triggeredThisSession.clear();
        lastCheckedTime = 0;
        videoDuration = 0;
        skipFirstTimeUpdate = true; // Skip first time update to prevent immediate question triggers

        // Hide question panel from any previous video
        if (elements.questionOverlay) {
            elements.questionOverlay.style.display = 'none';
        }

        // Update UI
        elements.currentTitle.textContent = currentVideo.title;
        elements.currentDescription.textContent = currentVideo.description;

        // Show player view
        elements.videoListView.style.display = 'none';
        elements.playerView.style.display = 'block';

        // Enable side-by-side layout for question panel
        const pageWrapper = document.getElementById('page-layout-wrapper');
        if (pageWrapper) pageWrapper.classList.add('watch-active');

        // Load questions from Firestore
        await loadQuestions(videoId);

        // Initialize YouTube player
        await initializePlayer(currentVideo.url);

        // Load user progress (this may seek to saved position)
        await loadUserProgress(videoId);

        // Reset lastCheckedTime AFTER loading progress to prevent immediate triggers
        lastCheckedTime = player ? player.getCurrentTime() : 0;

        updateScoreDisplay();
    }

    /**
     * Initialize YouTube player
     */
    async function initializePlayer(url) {
        if (window.YouTubePlayer) {
            await window.YouTubePlayer.init(elements.youtubePlayer, {
                onReady: onPlayerReady,
                onStateChange: onPlayerStateChange,
                onTimeUpdate: onTimeUpdate
            });
            window.YouTubePlayer.loadVideo(url);
            player = window.YouTubePlayer;
        } else {
            console.error('[WatchMode] YouTubePlayer module not loaded');
        }
    }

    /**
     * Player ready callback
     */
    function onPlayerReady() {
        console.log('[WatchMode] Player ready');
        elements.playBtn.textContent = 'Play';

        // Try to get duration and show markers immediately
        if (player && typeof player.getDuration === 'function') {
            const duration = player.getDuration();
            if (duration > 0) {
                videoDuration = duration;
                updateQuestionMarkers();
            }
        }
    }

    /**
     * Player state change callback
     */
    function onPlayerStateChange(event) {
        if (event.data === 1) { // Playing
            elements.playBtn.textContent = 'Pause';

            // Update duration and markers when playing starts
            if (player && typeof player.getDuration === 'function') {
                videoDuration = player.getDuration();
                updateQuestionMarkers();
            }
        } else if (event.data === 2) { // Paused
            elements.playBtn.textContent = 'Play';
        }
    }

    /**
     * Time update callback - check for question triggers
     */
    function onTimeUpdate(currentTime) {
        // Update progress bar
        if (videoDuration > 0) {
            const progress = (currentTime / videoDuration) * 100;
            elements.progressFill.style.width = `${progress}%`;
        }

        // Update time display
        elements.timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(videoDuration)}`;

        // Skip the first time update after video switch to sync lastCheckedTime
        // This prevents questions from immediately triggering due to race conditions
        if (skipFirstTimeUpdate) {
            skipFirstTimeUpdate = false;
            lastCheckedTime = currentTime;
            console.log('[WatchMode] First time update, synced lastCheckedTime to:', currentTime);
            return;
        }

        // Check for question triggers
        checkQuestionTriggers(currentTime);
    }

    /**
     * Check if we should trigger a question at current time
     * Questions can be re-triggered when rewinding, but points are only awarded once
     * Multiple questions at the same timestamp are queued and shown one by one
     */
    function checkQuestionTriggers(currentTime) {
        // Collect all questions at timestamps we just crossed
        const questionsToTrigger = [];

        for (const question of questions) {
            const timestamp = question.timestamp;
            // Check if we just crossed this timestamp (within 0.5s tolerance for same timestamp)
            if (lastCheckedTime < timestamp && currentTime >= timestamp) {
                // Only trigger if not already shown in this playback segment
                if (!triggeredThisSession.has(question.id)) {
                    questionsToTrigger.push(question);
                }
            }
        }

        // If we have questions to trigger, add to queue and start showing
        if (questionsToTrigger.length > 0) {
            questionQueue.push(...questionsToTrigger);

            // Start showing if not already showing a question
            if (!currentQuestion) {
                showNextQuestion();
            }
        }

        // If user seeked backwards, reset triggered questions for timestamps ahead
        if (currentTime < lastCheckedTime) {
            for (const question of questions) {
                if (question.timestamp > currentTime) {
                    triggeredThisSession.delete(question.id);
                }
            }
            // Also clear the queue since we're going back
            questionQueue = [];
        }

        lastCheckedTime = currentTime;
    }

    /**
     * Show the next question from the queue
     */
    function showNextQuestion() {
        if (questionQueue.length === 0) {
            // No more questions, continue video
            if (player) player.play();
            return;
        }

        const question = questionQueue.shift();
        triggerQuestion(question);
    }

    /**
     * Trigger a question - pause video and show overlay
     */
    function triggerQuestion(question) {
        currentQuestion = question;

        // Mark as triggered this session
        triggeredThisSession.add(question.id);

        // Pause video
        if (player) player.pause();

        // Show question overlay
        showQuestionOverlay(question);
    }

    /**
     * Show question overlay modal
     */
    function showQuestionOverlay(question) {
        // Set question number
        const questionIndex = questions.indexOf(question) + 1;
        elements.questionNumber.textContent = `Question ${questionIndex} of ${questions.length}`;

        // Set question text
        elements.questionText.textContent = question.questionText;

        // Show/hide audio button
        // Audio button removed - always hidden
        elements.playQuestionAudio.style.display = 'none';

        // Show/hide skip button
        elements.skipBtn.style.display = question.allowSkip ? 'inline-block' : 'none';

        // Set up answer area based on type
        if (question.questionType === 'multiple_choice') {
            elements.mcOptions.style.display = 'flex';
            elements.openAnswer.style.display = 'none';
            renderMCOptions(question.options);
        } else {
            elements.mcOptions.style.display = 'none';
            elements.openAnswer.style.display = 'block';
            elements.answerInput.value = '';
        }

        // Hide feedback initially
        elements.feedback.style.display = 'none';
        elements.submitBtn.style.display = 'inline-block';

        // Show overlay
        elements.questionOverlay.style.display = 'block';
    }

    /**
     * Render multiple choice options
     */
    function renderMCOptions(options) {
        if (!options || !Array.isArray(options)) {
            elements.mcOptions.innerHTML = '<p>No options available</p>';
            return;
        }

        elements.mcOptions.innerHTML = options.map((option, index) => `
            <button class="watch-mc-option" data-index="${index}" onclick="WatchMode.selectMCOption(${index})">
                ${String.fromCharCode(65 + index)}. ${option}
            </button>
        `).join('');
    }

    /**
     * Select a multiple choice option
     */
    function selectMCOption(index) {
        // Remove selected class from all options
        elements.mcOptions.querySelectorAll('.watch-mc-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        // Add selected class to clicked option
        const selected = elements.mcOptions.querySelector(`[data-index="${index}"]`);
        if (selected) {
            selected.classList.add('selected');
        }
    }

    /**
     * Submit answer
     */
    async function submitAnswer() {
        if (!currentQuestion) return;

        let isCorrect = false;
        let userAnswer = null;

        if (currentQuestion.questionType === 'multiple_choice') {
            const selectedOption = elements.mcOptions.querySelector('.selected');
            if (!selectedOption) {
                alert('Please select an answer');
                return;
            }
            userAnswer = parseInt(selectedOption.dataset.index);
            isCorrect = userAnswer === currentQuestion.correctAnswer;

            // Show correct/incorrect styling
            elements.mcOptions.querySelectorAll('.watch-mc-option').forEach((opt, idx) => {
                opt.classList.remove('selected');
                if (idx === currentQuestion.correctAnswer) {
                    opt.classList.add('correct');
                } else if (idx === userAnswer && !isCorrect) {
                    opt.classList.add('incorrect');
                }
            });
        } else {
            // Open-ended - any answer gets points
            userAnswer = elements.answerInput.value.trim();
            if (!userAnswer) {
                alert('Please enter an answer');
                return;
            }
            isCorrect = true; // Open-ended always counts as attempted = correct for points
        }

        // Check if this question was already answered (for points)
        const alreadyAnswered = answeredQuestions.has(currentQuestion.id);

        // Award points only if correct AND not already answered
        if (isCorrect && !alreadyAnswered) {
            const points = currentQuestion.questionType === 'multiple_choice'
                ? POINTS_MULTIPLE_CHOICE
                : POINTS_OPEN_ENDED;
            watchPoints += points;
            await awardPoints(points, currentQuestion);

            // Mark question as answered (for points tracking)
            answeredQuestions.add(currentQuestion.id);
        }

        // Update UI
        updateScoreDisplay();
        showFeedback(isCorrect, userAnswer, alreadyAnswered);

        // Save progress
        await saveProgress();
    }

    /**
     * Show feedback after answering
     * @param {boolean} isCorrect - Whether the answer was correct
     * @param {*} userAnswer - The user's answer
     * @param {boolean} alreadyAnswered - Whether this question was already answered before
     */
    function showFeedback(isCorrect, userAnswer, alreadyAnswered = false) {
        elements.submitBtn.style.display = 'none';
        elements.feedback.style.display = 'block';

        if (currentQuestion.questionType === 'multiple_choice') {
            if (isCorrect) {
                elements.feedback.className = 'watch-feedback correct';
                if (alreadyAnswered) {
                    elements.feedbackText.textContent = '✓ Correct! (Already answered - no additional points)';
                } else {
                    elements.feedbackText.textContent = `✓ Correct! +${POINTS_MULTIPLE_CHOICE} points`;
                }
                elements.replaySegmentBtn.style.display = 'none';
            } else {
                elements.feedback.className = 'watch-feedback incorrect';
                elements.feedbackText.textContent = '✗ Incorrect. The correct answer is highlighted.';
                elements.replaySegmentBtn.style.display = currentQuestion.replayOnIncorrect ? 'inline-block' : 'none';
            }
        } else {
            elements.feedback.className = 'watch-feedback correct';
            if (alreadyAnswered) {
                elements.feedbackText.textContent = '✓ Answer submitted! (Already answered - no additional points)';
            } else {
                elements.feedbackText.textContent = `✓ Answer submitted! +${POINTS_OPEN_ENDED} points`;
            }
            if (currentQuestion.modelAnswer) {
                elements.feedbackText.textContent += `\n\nModel answer: ${currentQuestion.modelAnswer}`;
            }
            elements.replaySegmentBtn.style.display = 'none';
        }
    }

    /**
     * Skip question
     */
    function skipQuestion() {
        hideQuestionOverlay();
        continuePlayback();
    }

    /**
     * Continue playback after question
     * Shows next question in queue if any, otherwise resumes video
     */
    function continuePlayback() {
        hideQuestionOverlay();

        // Check if there are more questions in the queue
        if (questionQueue.length > 0) {
            showNextQuestion();
        } else {
            if (player) player.play();
        }
    }

    /**
     * Replay the segment before the question
     */
    function replaySegment() {
        hideQuestionOverlay();
        // Seek back 10 seconds before the question timestamp
        const seekTime = Math.max(0, currentQuestion.timestamp - 10);
        if (player) {
            player.seekTo(seekTime);
            player.play();
        }
    }

    /**
     * Hide question overlay
     */
    function hideQuestionOverlay() {
        elements.questionOverlay.style.display = 'none';
        currentQuestion = null;

        // Update marker styling
        updateQuestionMarkers();
    }

    /**
     * Play question text using TTS
     */
    function playQuestionTTS() {
        if (!currentQuestion || !currentQuestion.voicedAudio) return;

        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(currentQuestion.questionText);
            utterance.lang = 'en-US';
            window.speechSynthesis.speak(utterance);
        }
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
     * Pause video and reset state for tab switching
     * Called when user switches away from Watch tab to prevent
     * time update issues when they return and rewind
     */
    function pauseAndResetForTabSwitch() {
        if (!player) return;

        // Pause the video
        player.pause();

        // Sync lastCheckedTime to current position to ensure proper rewind detection later
        const currentTime = player.getCurrentTime();
        if (typeof currentTime === 'number' && !isNaN(currentTime)) {
            lastCheckedTime = currentTime;
        }

        console.log('[WatchMode] Paused for tab switch, lastCheckedTime:', lastCheckedTime);
    }

    /**
     * Handle progress bar click to seek
     */
    function handleProgressBarClick(event) {
        if (!player || videoDuration === 0) return;

        const rect = elements.progressBar.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const percentage = clickX / rect.width;
        const seekTime = percentage * videoDuration;

        // Reset triggered questions for positions after the seek point
        for (const question of questions) {
            if (question.timestamp > seekTime) {
                triggeredThisSession.delete(question.id);
            }
        }

        lastCheckedTime = seekTime;

        // Optimistic UI update: update progress bar immediately
        const progressPercent = percentage * 100;
        elements.progressFill.style.width = `${progressPercent}%`;
        elements.timeDisplay.textContent = `${formatTime(seekTime)} / ${formatTime(videoDuration)}`;

        player.seekTo(seekTime);
    }

    /**
     * Show video list
     */
    function showVideoList() {
        // Cleanup player - destroy it to prevent conflicts when switching videos
        if (player) {
            player.pause();
            if (typeof player.destroy === 'function') {
                player.destroy();
            }
            player = null;
        }

        // Reset state
        currentVideo = null;
        currentQuestion = null;
        questions = [];
        questionQueue = [];
        answeredQuestions.clear();
        triggeredThisSession.clear();
        watchPoints = 0;
        lastCheckedTime = 0;

        // Show list view
        elements.playerView.style.display = 'none';
        elements.videoListView.style.display = 'block';

        // Hide question panel and reset layout
        if (elements.questionOverlay) {
            elements.questionOverlay.style.display = 'none';
        }

        // Remove side-by-side layout class
        const pageWrapper = document.getElementById('page-layout-wrapper');
        if (pageWrapper) pageWrapper.classList.remove('watch-active');
    }

    /**
     * Load questions from Firestore
     */
    async function loadQuestions(videoId) {
        questions = [];
        questionTimestamps = [];

        try {
            if (window.firebase && window.firebase.firestore) {
                const db = window.firebase.firestore();
                const snapshot = await db.collection('watchVideos')
                    .doc(videoId)
                    .collection('questions')
                    .orderBy('timestamp')
                    .get();

                snapshot.forEach(doc => {
                    const data = doc.data();
                    questions.push({
                        id: doc.id,
                        ...data
                    });
                    questionTimestamps.push(data.timestamp);
                });

                console.log(`[WatchMode] Loaded ${questions.length} questions for video ${videoId}`);
            }
        } catch (error) {
            console.error('[WatchMode] Error loading questions:', error);
        }

        // Render markers after loading
        updateQuestionMarkers();
    }

    /**
     * Update question markers on progress bar
     */
    function updateQuestionMarkers() {
        if (!elements.questionMarkers || videoDuration === 0) return;

        elements.questionMarkers.innerHTML = questions.map(q => {
            const position = (q.timestamp / videoDuration) * 100;
            const answered = answeredQuestions.has(q.id);
            return `<div class="watch-question-marker ${answered ? 'answered' : ''}" 
                        style="left: ${position}%"
                        title="Question at ${formatTime(q.timestamp)}"
                        onclick="WatchMode.seekToQuestion('${q.id}')"></div>`;
        }).join('');
    }

    /**
     * Seek to a specific question timestamp
     */
    function seekToQuestion(questionId) {
        const question = questions.find(q => q.id === questionId);
        if (question && player) {
            // Seek slightly before the question
            const seekTime = Math.max(0, question.timestamp - 1);
            player.seekTo(seekTime);
        }
    }

    /**
     * Load user progress from Firestore
     */
    async function loadUserProgress(videoId) {
        try {
            if (window.firebase && window.firebase.auth && window.firebase.firestore) {
                const user = window.firebase.auth().currentUser;
                if (!user) return;

                const db = window.firebase.firestore();
                const doc = await db.collection('users')
                    .doc(user.uid)
                    .collection('watchProgress')
                    .doc(videoId)
                    .get();

                if (doc.exists) {
                    const data = doc.data();
                    answeredQuestions = new Set(data.answeredQuestions || []);
                    watchPoints = data.pointsEarned || 0;

                    // NOTE: Auto-resume disabled to prevent question auto-triggering
                    // Videos now always start from the beginning
                    // User can see their progress via question markers

                    updateScoreDisplay();
                    updateQuestionMarkers();
                    console.log('[WatchMode] Loaded user progress');
                }
            }
        } catch (error) {
            console.error('[WatchMode] Error loading progress:', error);
        }
    }

    /**
     * Save user progress to Firestore
     */
    async function saveProgress() {
        if (!currentVideo) return;

        try {
            if (window.firebase && window.firebase.auth && window.firebase.firestore) {
                const user = window.firebase.auth().currentUser;
                if (!user) return;

                const db = window.firebase.firestore();
                const currentTime = player ? player.getCurrentTime() : 0;

                await db.collection('users')
                    .doc(user.uid)
                    .collection('watchProgress')
                    .doc(currentVideo.id)
                    .set({
                        videoId: currentVideo.id,
                        videoTitle: currentVideo.title,
                        currentTime: currentTime,
                        answeredQuestions: Array.from(answeredQuestions),
                        pointsEarned: watchPoints,
                        totalQuestions: questions.length,
                        updatedAt: new Date()
                    }, { merge: true });

                console.log('[WatchMode] Progress saved');
            }
        } catch (error) {
            console.error('[WatchMode] Error saving progress:', error);
        }
    }

    /**
     * Award points to user
     */
    async function awardPoints(points, question) {
        try {
            if (window.firebase && window.firebase.auth && window.firebase.firestore) {
                const user = window.firebase.auth().currentUser;
                if (!user) return;

                const db = window.firebase.firestore();
                const userRef = db.collection('users').doc(user.uid);

                // Update total practice points
                await db.runTransaction(async (transaction) => {
                    const userDoc = await transaction.get(userRef);
                    const currentPoints = userDoc.exists ? (userDoc.data().practicePoints || 0) : 0;
                    transaction.update(userRef, {
                        practicePoints: currentPoints + points
                    });
                });

                // Add to points history
                await userRef.collection('pointsHistory').add({
                    points: points,
                    mode: 'watch',
                    videoId: currentVideo.id,
                    questionId: question.id,
                    questionType: question.questionType,
                    timestamp: new Date()
                });

                console.log(`[WatchMode] Awarded ${points} points`);

                // Update displayed points if AuthUI is available
                if (window.updatePointsDisplay) {
                    window.updatePointsDisplay();
                }
            }
        } catch (error) {
            console.error('[WatchMode] Error awarding points:', error);
        }
    }

    /**
     * Update score display
     */
    function updateScoreDisplay() {
        if (elements.scoreDisplay) {
            elements.scoreDisplay.textContent = `Points: ${watchPoints}`;
        }
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
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Public API
    return {
        init,
        selectVideo,
        selectMCOption,
        seekToQuestion,
        showVideoList,
        pauseAndResetForTabSwitch
    };
})();

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize when Watch tab is clicked
    const tabWatch = document.getElementById('tab-watch');
    if (tabWatch) {
        tabWatch.addEventListener('click', () => {
            WatchMode.init();
        });
    }
});

// Export for global access
if (typeof window !== 'undefined') {
    window.WatchMode = WatchMode;
}
