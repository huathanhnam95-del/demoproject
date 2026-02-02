require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
// const { HfInference } = require('@huggingface/inference'); // Deprecated in favor of direct robust axios implementation
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { YoutubeTranscript } = require('youtube-transcript');
const axios = require('axios');
const rax = require('retry-axios');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const admin = require('firebase-admin');

// --- Firebase Admin Init (for Caching) ---
let db = null;
try {
  const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('[SECURE] Firebase Admin initialized for Caching.');
  } else {
    console.warn('[WARN] serviceAccountKey.json not found. Caching disabled.');
  }
} catch (e) {
  console.warn('[WARN] Firebase Admin initialization failed:', e.message);
}

// --- Robust AI Client (Axios + IPv4 Force + Retries) ---
const aiClient = axios.create({
  baseURL: 'https://router.huggingface.co/v1/chat/completions',
  timeout: 10000, // 10s timeout
  httpsAgent: new https.Agent({ family: 4 }), // Force IPv4 to bypass cloud routing issues
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json'
  }
});

// Attach retries
aiClient.defaults.raxConfig = {
  instance: aiClient,
  retry: 3,
  noResponseRetries: 3,
  retryDelay: 1000,
  backoffType: 'exponential',
  onRetryAttempt: err => {
    const cfg = rax.getConfig(err);
    console.log(`[AI-Retry] Attempt ${cfg.currentRetryAttempt} for ${err.config.url}`);
  }
};
rax.attach(aiClient);

// --- Rate Limiter ---
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // limit each IP to 20 requests per window
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const app = express();
const PORT = process.env.PORT || 8443;

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// --- Security: Serve static files from a dedicated public folder ---
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to fetch YouTube transcript
// ... (lines 82-140)
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


// --- Local Dictionary Cache ---
const LOCAL_DICT_PATH = path.join(__dirname, 'local_dictionary.json');
let localDict = {};

// Load local dictionary at startup
try {
  if (fs.existsSync(LOCAL_DICT_PATH)) {
    localDict = JSON.parse(fs.readFileSync(LOCAL_DICT_PATH, 'utf8'));
    console.log(`[Dict] Loaded ${Object.keys(localDict).length} words from local dictionary.`);
  }
} catch (e) {
  console.warn('[Dict] Failed to load local dictionary:', e.message);
}

// --- Local Dictionary Hardening ---
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const TMP_PATH = LOCAL_DICT_PATH + '.tmp';
let dirty = false;
let saveTimer = null;

function isCacheableKey(wordLower) {
  // Unified Normalization Guard: 1–30 chars, starts with letter, only letters/hyphens/apostrophes
  return /^[a-z][a-z'-]{0,29}$/.test(wordLower);
}

function isValidTracauPayload(p) {
  if (!p || typeof p !== 'object') return false;
  // Robust check for non-empty arrays to avoid caching 'no-data' results
  const hasTratu = Array.isArray(p.tratu) && p.tratu.length > 0;
  const hasSentences = Array.isArray(p.sentences) && p.sentences.length > 0;
  return hasTratu || hasSentences;
}

function isFresh(entry) {
  return entry && (Date.now() - entry.timestamp) < MAX_AGE_MS;
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      fs.writeFileSync(TMP_PATH, JSON.stringify(localDict, null, 2));
      fs.renameSync(TMP_PATH, LOCAL_DICT_PATH);
      console.log('[Dict] Periodic atomic save completed.');
    } catch (e) {
      console.error('[Dict] Atomic save failed:', e.message);
    }
  }, 2000);
}

function saveToLocalDict(wordLower, data) {
  localDict[wordLower] = { data, timestamp: Date.now() };

  // Cache Eviction Policy: Keep only 3000 freshest entries to prevent unbounded growth
  const keys = Object.keys(localDict);
  if (keys.length > 3000) {
    const sorted = keys.sort((a, b) => localDict[a].timestamp - localDict[b].timestamp);
    const toRemove = sorted.slice(0, keys.length - 3000);
    toRemove.forEach(k => delete localDict[k]);
    console.log(`[Dict] Evicted ${toRemove.length} oldest entries.`);
  }

  scheduleSave();
}

const inflight = new Map();

async function fetchTracauLive(wordLower) {
  if (inflight.has(wordLower)) return inflight.get(wordLower);

  // Security Hardening: Remove hardcoded secret fallback
  const TRACAU_API_KEY = process.env.TRACAU_KEY;
  if (!TRACAU_API_KEY) {
    throw new Error('TRACAU_KEY missing in environment variables');
  }

  const url = `https://api.tracau.vn/${TRACAU_API_KEY}/s/${encodeURIComponent(wordLower)}/en`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000); // 6s timeout

  const p = fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    }
  })
    .then(r => {
      clearTimeout(timeout);
      if (!r.ok) throw new Error(`Tracau responded with ${r.status}`);
      return r.json();
    })
    .catch(err => {
      clearTimeout(timeout);
      throw err;
    })
    .finally(() => inflight.delete(wordLower));

  inflight.set(wordLower, p);
  return p;
}

// API endpoint to fetch Tracau dictionary data
app.get('/api/tracau', async (req, res) => {
  const word = req.query.word;
  if (!word) return res.status(400).json({ error: 'Missing word' });

  // Unified Normalization: Strip edges then validate strict regex
  const wordLower = String(word)
    .toLowerCase()
    .trim()
    .replace(/^[^a-z'-]+|[^a-z'-]+$/g, '');

  // Sanitization: Reject junk to protect upstream and ensure normalization consistency
  if (!isCacheableKey(wordLower)) {
    return res.status(400).json({ error: 'Invalid word format. Use letters, hyphens, and apostrophes (2-30 chars).' });
  }

  // 1. Check Local Cache First
  const cached = localDict[wordLower];
  if (cached && isFresh(cached)) {
    console.log(`[Dict] Local cache HIT for: ${wordLower}`);
    return res.json({ ...cached.data, fromCache: true });
  }

  // 2. Fetch from External API
  try {
    console.log(`[Proxy] Tracau request for: ${wordLower}`);
    const data = await fetchTracauLive(wordLower);

    // Only cache good, cacheable payloads (robust non-empty checks)
    if (isValidTracauPayload(data)) {
      saveToLocalDict(wordLower, data);
    }

    return res.json({ ...data, fromCache: false, staleCache: !!cached });
  } catch (error) {
    console.error(`[Proxy] Tracau failed for ${wordLower}:`, error.message);

    // If we have any stale cache, serve it rather than failing
    if (cached && cached.data) {
      console.log(`[Dict] Serving stale cache for: ${wordLower}`);
      return res.json({ ...cached.data, fromCache: true, stale: true });
    }

    res.status(500).json({ error: 'API Error', message: error.message });
  }
});

// API endpoint to fetch Tatoeba sentences (Proxy to avoid CORS)
app.get('/api/tatoeba', async (req, res) => {
  try {
    const { word } = req.query;
    if (!word) {
      return res.status(400).json({ error: 'Missing word parameter' });
    }

    const backendUrl = 'https://pronunciation-api-891173754178.asia-southeast1.run.app';
    const url = `${backendUrl}/sentences/${encodeURIComponent(word)}`;

    console.log(`[Proxy] Tatoeba request for: ${word} -> ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      // If 404, just return empty sentences without erroring
      if (response.status === 404) {
        return res.json({ sentences: [] });
      }
      throw new Error(`Tatoeba API responded with ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[Proxy] Error proxying Tatoeba:', error.message);
    // Return empty array on failure to handle gracefully
    res.json({ sentences: [] });
  }
});


// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// AI Proxy Endpoint
// AI Proxy Endpoint (Non-streaming)
// AI Proxy Endpoint (Non-streaming) with Caching & Rate Limiting
app.post('/api/ai-proxy', aiLimiter, async (req, res) => {
  const { prompt, model = 'meta-llama/Llama-3.1-8B-Instruct', max_tokens = 150 } = req.body;
  const apiKey = process.env.HUGGINGFACE_API_KEY;

  if (!apiKey || apiKey.startsWith('PLACEHOLDER')) {
    return res.status(500).json({ error: 'Server configuration error: Missing API Key' });
  }

  // 1. Check Cache
  const cacheKey = crypto.createHash('md5').update(`prompt:${prompt}-model:${model}-len:${max_tokens}`).digest('hex');
  if (db) {
    try {
      const cacheDoc = await db.collection('ai_cache').doc(cacheKey).get();
      if (cacheDoc.exists) {
        const data = cacheDoc.data();
        // Check TTL (7 days)
        if (data.expires > Date.now()) {
          console.log('[AI-Cache] HIT', cacheKey);
          return res.json({ generated_text: data.text, fallback: false, fromCache: true });
        }
      }
    } catch (e) {
      console.warn('[AI-Cache] Read failed:', e.message);
    }
  }

  console.log(`[AI-Proxy] Requesting ${model} (IPv4 Forced)...`);

  try {
    const response = await aiClient.post('', {
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: max_tokens,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    const generatedText = response.data.choices[0].message.content;

    // 2. Write to Cache
    if (db) {
      // Fire and forget cache write
      db.collection('ai_cache').doc(cacheKey).set({
        text: generatedText,
        expires: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
        created: Date.now()
      }).catch(e => console.warn('[AI-Cache] Write failed:', e.message));
    }

    res.json({ generated_text: generatedText, fallback: false });

  } catch (axiosError) {
    console.error('AI Service Error:', axiosError.message);
    if (axiosError.response) {
      console.error('Data:', JSON.stringify(axiosError.response.data));
    }

    // Return appropriate error to client
    const status = axiosError.response ? axiosError.response.status : 500;
    res.status(status).json({
      error: 'AI service unavailable',
      details: axiosError.message,
      fallback: true
    });
  }
});

// AI Feedback Stream Endpoint (Server-Sent Events)
// Note: We use native https here for better streaming control, but apply rate limiting
app.post('/api/ai-feedback-stream', aiLimiter, async (req, res) => {
  const { prompt, model = 'meta-llama/Llama-3.1-8B-Instruct' } = req.body;
  const apiKey = process.env.HUGGINGFACE_API_KEY;

  // SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (!apiKey || apiKey.startsWith('PLACEHOLDER')) {
    res.write(`data: ${JSON.stringify({ error: 'AI config missing', fallback: true })}\n\n`);
    return res.end();
  }

  try {
    console.log(`[AI Stream] Requesting: ${model}`);

    const postData = JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
      stream: true
    });

    const options = {
      hostname: 'router.huggingface.co',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/event-stream'
      },
      timeout: 60000,
      family: 4 // Force IPv4
    };

    const hfReq = https.request(options, (hfRes) => {
      if (hfRes.statusCode !== 200) {
        console.error(`[AI Stream] HF API Error (${hfRes.statusCode})`);
        res.write(`data: ${JSON.stringify({ error: 'Stream failed', status: hfRes.statusCode })}\n\n`);
        return res.end();
      }

      hfRes.on('data', (chunk) => {
        // Proxy chunks directly back to client
        res.write(chunk);
      });

      hfRes.on('end', () => {
        res.end();
      });
    });

    hfReq.on('error', (error) => {
      console.error('[AI Stream] Request Error:', error.message);
      res.write(`data: ${JSON.stringify({ error: 'Stream failed', details: error.message })}\n\n`);
      res.end();
    });

    hfReq.on('timeout', () => {
      console.error('[AI Stream] Request timed out after 60s');
      hfReq.destroy();
      res.end();
    });

    hfReq.write(postData);
    hfReq.end();

  } catch (error) {
    console.error('[AI Stream] Catch Block Error:', error.message);
    res.write(`data: ${JSON.stringify({ error: 'Internal error', details: error.message })}\n\n`);
    res.end();
  }
});

// Fallback: serve public/index.html for all other routes (for SPA routing)
app.get(/^(?!\/api).*$/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
// ... (lines 487-529)
let server;
if (PORT === 8443) {
  // Try to use mkcert trusted certificates first
  if (fs.existsSync('localhost.pem') && fs.existsSync('localhost-key.pem')) {
    const options = {
      key: fs.readFileSync('localhost-key.pem'),
      cert: fs.readFileSync('localhost.pem')
    };
    server = https.createServer(options, app);
    server.listen(PORT, () => {
      console.log(`[SECURE] Server running with TRUSTED CA on https://localhost:${PORT}`);
    });
  } else if (fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
    // Fallback to older self-signed (untrusted)
    const options = {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem')
    };
    server = https.createServer(options, app);
    server.listen(PORT, () => {
      console.log(`[WARNING] Server running with UNTRUSTED cert on https://localhost:${PORT}`);
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

