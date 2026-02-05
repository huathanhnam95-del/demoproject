require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// --- Routes ---
const transcriptRoutes = require('./src/routes/transcript');
const dictionaryRoutes = require('./src/routes/dictionary');
const aiProxyRoutes = require('./src/routes/ai-proxy');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 8443;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '10kb' })); // Global payload limit
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes Registration ---
app.use('/api', transcriptRoutes);
app.use('/api', dictionaryRoutes);
app.use('/api', aiProxyRoutes);
app.use('/api/admin', adminRoutes);

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', message: 'Server is running' });
});

// --- Config Endpoint (Serving Firebase config safely) ---
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    config: {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
      measurementId: process.env.FIREBASE_MEASUREMENT_ID
    }
  });
});

// --- Standard 404 for API ---
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'NOT_FOUND',
    message: `API matching ${req.method} ${req.originalUrl} not found.`
  });
});

// --- SPA Fallback ---
app.get(/^(?!\/api).*$/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Server Startup Logic ---
let server;
if (PORT === 8443) {
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
    const options = {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem')
    };
    server = https.createServer(options, app);
    server.listen(PORT, () => {
      console.log(`[WARNING] Server running with UNTRUSTED cert on https://localhost:${PORT}`);
    });
  } else {
    server = http.createServer(app);
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
} else {
  server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
