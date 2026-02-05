const express = require('express');
const router = express.Router();
const { YoutubeTranscript } = require('youtube-transcript');
const { sendError, sendSuccess } = require('../utils/response-helper');

router.get('/transcript', async (req, res) => {
    try {
        const { videoId } = req.query;

        if (!videoId) {
            return sendError(res, 400, 'MISSING_VIDEO_ID', 'Missing videoId parameter');
        }

        console.log(`Fetching transcript for video: ${videoId}`);
        const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);

        const captions = transcriptData.map(item => ({
            start: item.offset / 1000,
            end: (item.offset + item.duration) / 1000,
            text: item.text
        }));

        return sendSuccess(res, {
            videoId,
            captions,
            count: captions.length
        });

    } catch (error) {
        console.error('Error fetching transcript:', error.message);

        if (error.message.includes('Transcript is disabled')) {
            return sendError(res, 404, 'TRANSCRIPT_DISABLED', 'This video does not have captions enabled.');
        }

        if (error.message.includes('Could not retrieve a transcript')) {
            return sendError(res, 404, 'TRANSCRIPT_NOT_FOUND', 'Could not retrieve transcript for this video.');
        }

        return sendError(res, 500, 'INTERNAL_ERROR', error.message);
    }
});

module.exports = router;
