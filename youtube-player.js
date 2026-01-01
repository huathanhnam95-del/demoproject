/**
 * YouTube Player Module
 * Shared wrapper for YouTube IFrame API
 */

const YouTubePlayer = (function () {
    'use strict';

    let player = null;
    let isReady = false;
    let pendingVideoId = null;
    let containerElement = null;
    let onReadyCallback = null;
    let onStateChangeCallback = null;
    let onTimeUpdateCallback = null;
    let timeUpdateInterval = null;

    /**
     * Load YouTube IFrame API script
     */
    function loadAPI() {
        return new Promise((resolve, reject) => {
            if (window.YT && window.YT.Player) {
                resolve();
                return;
            }

            // Create callback for when API is ready
            window.onYouTubeIframeAPIReady = () => {
                console.log('[YouTubePlayer] API Ready');
                resolve();
            };

            // Load the script
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            tag.onerror = () => reject(new Error('Failed to load YouTube API'));
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        });
    }

    /**
     * Extract video ID from various YouTube URL formats
     * @param {string} url - YouTube URL or video ID
     * @returns {string|null} - Video ID or null if invalid
     */
    function extractVideoId(url) {
        if (!url) return null;

        // Already a video ID (11 characters, alphanumeric with - and _)
        if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
            return url;
        }

        // Standard watch URL: youtube.com/watch?v=VIDEO_ID
        let match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];

        // Short URL: youtu.be/VIDEO_ID
        match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];

        // Embed URL: youtube.com/embed/VIDEO_ID
        match = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];

        // Shorts URL: youtube.com/shorts/VIDEO_ID
        match = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];

        return null;
    }

    /**
     * Initialize player in a container element
     * @param {string|HTMLElement} container - Container element or ID
     * @param {Object} options - Configuration options
     */
    async function init(container, options = {}) {
        containerElement = typeof container === 'string'
            ? document.getElementById(container)
            : container;

        if (!containerElement) {
            throw new Error('Container element not found');
        }

        onReadyCallback = options.onReady || null;
        onStateChangeCallback = options.onStateChange || null;
        onTimeUpdateCallback = options.onTimeUpdate || null;

        await loadAPI();

        // Create player div inside container
        const playerDiv = document.createElement('div');
        playerDiv.id = 'yt-player-' + Date.now();
        containerElement.innerHTML = '';
        containerElement.appendChild(playerDiv);

        player = new YT.Player(playerDiv.id, {
            height: '100%',
            width: '100%',
            playerVars: {
                autoplay: 0,
                controls: 1,
                modestbranding: 1,
                rel: 0,
                fs: 1,
                playsinline: 1
            },
            events: {
                onReady: handleReady,
                onStateChange: handleStateChange,
                onError: handleError
            }
        });
    }

    function handleReady(event) {
        isReady = true;
        console.log('[YouTubePlayer] Player Ready');

        if (pendingVideoId) {
            loadVideo(pendingVideoId);
            pendingVideoId = null;
        }

        if (onReadyCallback) {
            onReadyCallback(event);
        }
    }

    function handleStateChange(event) {
        // Start/stop time update interval based on playing state
        if (event.data === YT.PlayerState.PLAYING) {
            startTimeUpdates();
        } else {
            stopTimeUpdates();
        }

        if (onStateChangeCallback) {
            onStateChangeCallback(event);
        }
    }

    function handleError(event) {
        console.error('[YouTubePlayer] Error:', event.data);
    }

    function startTimeUpdates() {
        stopTimeUpdates();
        if (onTimeUpdateCallback) {
            timeUpdateInterval = setInterval(() => {
                if (player && isReady) {
                    const currentTime = player.getCurrentTime();
                    onTimeUpdateCallback(currentTime);
                }
            }, 250); // 4 times per second
        }
    }

    function stopTimeUpdates() {
        if (timeUpdateInterval) {
            clearInterval(timeUpdateInterval);
            timeUpdateInterval = null;
        }
    }

    /**
     * Load a video by URL or ID
     * @param {string} urlOrId - YouTube URL or video ID
     */
    function loadVideo(urlOrId) {
        const videoId = extractVideoId(urlOrId);
        if (!videoId) {
            console.error('[YouTubePlayer] Invalid video URL/ID:', urlOrId);
            return false;
        }

        if (!isReady) {
            pendingVideoId = videoId;
            return true;
        }

        player.cueVideoById(videoId);
        return true;
    }

    /**
     * Play the video
     */
    function play() {
        if (player && isReady) {
            player.playVideo();
        }
    }

    /**
     * Pause the video
     */
    function pause() {
        if (player && isReady) {
            player.pauseVideo();
        }
    }

    /**
     * Seek to a specific time
     * @param {number} seconds - Time in seconds
     * @param {boolean} allowSeekAhead - Allow seeking ahead of buffered content
     */
    function seekTo(seconds, allowSeekAhead = true) {
        if (player && isReady) {
            player.seekTo(seconds, allowSeekAhead);
        }
    }

    /**
     * Get current playback time
     * @returns {number} - Current time in seconds
     */
    function getCurrentTime() {
        if (player && isReady) {
            return player.getCurrentTime();
        }
        return 0;
    }

    /**
     * Get video duration
     * @returns {number} - Duration in seconds
     */
    function getDuration() {
        if (player && isReady) {
            return player.getDuration();
        }
        return 0;
    }

    /**
     * Get player state
     * @returns {number} - YT.PlayerState value
     */
    function getState() {
        if (player && isReady) {
            return player.getPlayerState();
        }
        return -1;
    }

    /**
     * Check if video is playing
     * @returns {boolean}
     */
    function isPlaying() {
        return getState() === YT.PlayerState.PLAYING;
    }

    /**
     * Set time update callback
     * @param {Function} callback - Function called with current time
     */
    function setTimeUpdateCallback(callback) {
        onTimeUpdateCallback = callback;
        if (isPlaying()) {
            startTimeUpdates();
        }
    }

    /**
     * Destroy the player
     */
    function destroy() {
        stopTimeUpdates();
        if (player) {
            player.destroy();
            player = null;
        }
        isReady = false;
        pendingVideoId = null;
    }

    // Public API
    return {
        init,
        loadVideo,
        play,
        pause,
        seekTo,
        getCurrentTime,
        getDuration,
        getState,
        isPlaying,
        setTimeUpdateCallback,
        extractVideoId,
        destroy,
        // Expose player state constants
        STATES: {
            UNSTARTED: -1,
            ENDED: 0,
            PLAYING: 1,
            PAUSED: 2,
            BUFFERING: 3,
            CUED: 5
        }
    };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.YouTubePlayer = YouTubePlayer;
}
