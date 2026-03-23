const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
/* eslint-disable no-console */

function hasFingerprint(filePath) {
  const baseName = path.basename(String(filePath || ''));
  return /(?:^|[.-])[a-f0-9]{8,}(?:\.[^.]+)+$/i.test(baseName);
}

function hasVersionQuery(req) {
  const value = String(req?.query?.v || '').trim();
  return value.length > 0;
}

function setStaticCacheHeaders(res, filePath) {
  if (filePath.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, private');
    return;
  }

  if (hasVersionQuery(res.req) || hasFingerprint(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=3600');
}

function createRateLimiter({ windowMs, max, code, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      const retryAfterSeconds = Math.ceil(Number(options.windowMs || windowMs) / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(options.statusCode).json({
        success: false,
        error: code,
        message,
        retryAfterSeconds
      });
    }
  });
}

function createApp(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, '..', '..');
  const logger = options.logger || require('../utils/logger');
  const routes = options.routes || {
    transcriptRoutes: require('../routes/transcript'),
    dictionaryRoutes: require('../routes/dictionary'),
    aiProxyRoutes: require('../routes/ai-proxy'),
    adminRoutes: require('../routes/admin'),
    classroomsRoutes: require('../routes/classrooms'),
    entranceTestRoutes: require('../routes/entrance-tests'),
    readingJourneyRoutes: require('../routes/reading-journey')
  };
  const firebase = options.firebase || require('../utils/firebase');
  const circuitBreaker = options.circuitBreaker || require('../middleware/circuit-breaker');

  const app = express();
  const publicDir = path.join(projectRoot, 'public');
  const startTime = Date.now();

  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: '10kb' }));
  app.use(logger.requestMiddleware());

  const globalLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 100,
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please slow down.'
  });
  const aiLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    code: 'RATE_LIMITED',
    message: 'AI endpoint rate limit exceeded. Please wait.'
  });

  app.use('/api/', globalLimiter);
  app.use('/api/ai-proxy', aiLimiter);
  app.use('/api/ai-feedback-stream', aiLimiter);

  app.use(express.static(publicDir, {
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders: (res, filePath) => {
      setStaticCacheHeaders(res, filePath);
    }
  }));

  app.use('/api', routes.transcriptRoutes);
  app.use('/api', routes.dictionaryRoutes);
  app.use('/api', routes.aiProxyRoutes);
  app.use('/api/admin', routes.adminRoutes);
  app.use('/api', routes.classroomsRoutes);
  app.use('/api/entrance-tests', routes.entranceTestRoutes);
  app.use('/api', routes.readingJourneyRoutes);

  app.get('/api/health', async (_req, res) => {
    const memory = process.memoryUsage();
    const healthData = {
      success: true,
      status: 'ok',
      message: 'Server is running',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      memory: {
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
        unit: 'MB'
      }
    };

    const db = firebase?.db;
    if (db && typeof db.collection === 'function') {
      try {
        await db.collection('_health').doc('ping').get();
        healthData.firestore = 'connected';
      } catch (err) {
        healthData.firestore = 'error';
        healthData.firestoreError = err.message;
        healthData.status = 'degraded';
      }
    } else {
      healthData.firestore = 'unavailable';
    }

    try {
      if (typeof circuitBreaker?.getBreakerStatus === 'function') {
        healthData.circuitBreakers = circuitBreaker.getBreakerStatus();
      }
    } catch (_) {
      // Best-effort health metadata only.
    }

    const statusCode = healthData.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(healthData);
  });

  app.get('/api/config', (_req, res) => {
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

  app.use('/api', (req, res) => {
    res.status(404).json({
      success: false,
      error: 'NOT_FOUND',
      message: `API matching ${req.method} ${req.originalUrl} not found.`
    });
  });

  app.get(/^(?!\/api).*$/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

function startServer({ app, port, projectRoot } = {}) {
  const root = projectRoot || process.cwd();
  const effectiveApp = app || createApp({ projectRoot: root });
  const effectivePort = Number(port || process.env.PORT || 8443);

  let server;
  if (effectivePort === 8443) {
    const trustedCert = path.join(root, 'localhost.pem');
    const trustedKey = path.join(root, 'localhost-key.pem');
    const legacyCert = path.join(root, 'cert.pem');
    const legacyKey = path.join(root, 'key.pem');

    if (fs.existsSync(trustedCert) && fs.existsSync(trustedKey)) {
      server = https.createServer({
        key: fs.readFileSync(trustedKey),
        cert: fs.readFileSync(trustedCert)
      }, effectiveApp);
      server.listen(effectivePort, () => {
        console.log(`[SECURE] Server running with TRUSTED CA on https://localhost:${effectivePort}`);
      });
      return server;
    }

    if (fs.existsSync(legacyCert) && fs.existsSync(legacyKey)) {
      server = https.createServer({
        key: fs.readFileSync(legacyKey),
        cert: fs.readFileSync(legacyCert)
      }, effectiveApp);
      server.listen(effectivePort, () => {
        console.log(`[WARNING] Server running with UNTRUSTED cert on https://localhost:${effectivePort}`);
      });
      return server;
    }
  }

  server = http.createServer(effectiveApp);
  server.listen(effectivePort, () => {
    console.log(`Server running on http://localhost:${effectivePort}`);
  });
  return server;
}

function attachGracefulShutdown(server, { beforeClose } = {}) {
  function gracefulShutdown(signal) {
    console.log(`\n[${signal}] Graceful shutdown initiated...`);
    if (typeof beforeClose === 'function') {
      beforeClose();
    }
    server.close(() => {
      console.log('[SHUTDOWN] All connections closed. Exiting.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[SHUTDOWN] Forced exit after 10s timeout.');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = {
  createApp,
  startServer,
  attachGracefulShutdown,
  hasFingerprint,
  setStaticCacheHeaders
};
