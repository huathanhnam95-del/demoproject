const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { YoutubeTranscript } = require('youtube-transcript');

const app = express();
const PORT = process.env.PORT || 8443;

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Serve static files (HTML, CSS, JS, etc.)
app.use(express.static('.'));

// API endpoint to fetch YouTube transcript
app.get('/api/transcript', async (req, res) => {
  try {
    const videoId = req.query.videoId;

    if (!videoId) {
      return res.status(400).json({
        error: 'Missing videoId parameter',
        message: 'Please provide a videoId query parameter (e.g., /api/transcript?videoId=VIDEO_ID)'
      });
    }

    console.log(`Fetching transcript for video: ${videoId}`);

    // Fetch transcript using youtube-transcript library
    const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);

    // Transform the data to include start, end, and text
    const captions = transcriptData.map(item => ({
      start: item.offset / 1000, // Convert milliseconds to seconds
      end: (item.offset + item.duration) / 1000,
      text: item.text
    }));

    console.log(`Successfully fetched ${captions.length} captions for video: ${videoId}`);

    res.json({
      success: true,
      videoId: videoId,
      captions: captions,
      count: captions.length
    });

  } catch (error) {
    console.error('Error fetching transcript:', error.message);

    // Handle specific error cases
    if (error.message.includes('Transcript is disabled')) {
      return res.status(404).json({
        success: false,
        error: 'Transcript not available',
        message: 'This video does not have captions enabled.'
      });
    }

    if (error.message.includes('Could not retrieve a transcript')) {
      return res.status(404).json({
        success: false,
        error: 'Transcript not found',
        message: 'Could not retrieve transcript for this video. The video may not have captions available.'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});


// API endpoint to fetch Tracau dictionary data
app.get('/api/tracau', async (req, res) => {
  try {
    const { word, lang } = req.query;
    if (!word) {
      return res.status(400).json({ error: 'Missing word parameter' });
    }

    const apiKey = 'WBBcwnwQpV89';
    const targetLang = lang || 'en';
    const url = `https://api.tracau.vn/${apiKey}/s/${encodeURIComponent(word.toLowerCase())}/${targetLang}`;

    console.log(`Proxying Tracau request for: ${word}`);
    const response = await fetch(url);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error('Error proxying Tracau:', error.message);
    res.status(500).json({ error: 'Failed to fetch from Tracau', message: error.message });
  }
});


// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Fallback: serve index.html for all other routes (for SPA routing)
app.get(/^(?!\/api).*$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
// Check if HTTPS certificates exist for port 8443
const https = require('https');
const http = require('http');

let server;
if (PORT === 8443) {
  // Try to use HTTPS if certificates exist
  if (fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
    const options = {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem')
    };
    server = https.createServer(options, app);
    server.listen(PORT, () => {
      console.log(`Server running on https://localhost:${PORT}`);
      console.log(`API endpoint: https://localhost:${PORT}/api/transcript?videoId=VIDEO_ID`);
    });
  } else if (fs.existsSync('localhost-key.pem') && fs.existsSync('localhost.pem')) {
    const options = {
      key: fs.readFileSync('localhost-key.pem'),
      cert: fs.readFileSync('localhost.pem')
    };
    server = https.createServer(options, app);
    server.listen(PORT, () => {
      console.log(`Server running on https://localhost:${PORT}`);
      console.log(`API endpoint: https://localhost:${PORT}/api/transcript?videoId=VIDEO_ID`);
    });
  } else {
    // Fallback to HTTP if no certificates
    server = http.createServer(app);
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`API endpoint: http://localhost:${PORT}/api/transcript?videoId=VIDEO_ID`);
      console.log('Note: Using HTTP. For HTTPS, create SSL certificates.');
    });
  }
} else {
  // For other ports, use HTTP
  server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API endpoint: http://localhost:${PORT}/api/transcript?videoId=VIDEO_ID`);
  });
}
