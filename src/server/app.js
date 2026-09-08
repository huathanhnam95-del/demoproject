const express = require('express');
const { buildPublicFeatures } = require('./public-feature-config');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { sendError } = require('../utils/response-helper');
const {
  isLocalHostname,
  shouldAllowLocalAdminBootstrap,
  resolveLocalAdminEmail
} = require('./local-admin');
/* eslint-disable no-console */

const CRM_PROJECTS_DEMO_PROJECT = 'demo-crm-projects';

function hasFingerprint(filePath) {
  const baseName = path.basename(String(filePath || ''));
  return /(?:^|[.-])[a-f0-9]{8,}(?:\.[^.]+)+$/i.test(baseName);
}

function hasVersionQuery(req) {
  const value = String(req?.query?.v || '').trim();
  return value.length > 0;
}

function parseLocalEmulatorEndpoint(value) {
  const match = String(value || '').trim().match(/^(?:https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]|::1):(\d+)$/i);
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return { host: match[1].replace(/^\[|\]$/g, ''), port };
}

function setStaticCacheHeaders(res, filePath) {
  const baseName = path.basename(String(filePath || ''));
  if (baseName === 'sw.js') {
    // Service workers should always be revalidated so clients can receive updates promptly.
    // Avoid long-lived HTTP caching here even when other assets are aggressively cached.
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return;
  }

  if (filePath.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, private');
    return;
  }

  // Local browser sessions must revalidate code assets. Development keeps the
  // same versioned URLs while the files change, so immutable caching leaves
  // Chrome and the service worker executing stale JavaScript after edits.
  if (isLocalHostname(res?.req?.hostname)
    && (hasVersionQuery(res.req) || /\.(?:js|css)$/i.test(filePath))) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return;
  }

  if (hasVersionQuery(res.req) || hasFingerprint(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=3600');
}

function addConnectSrcAllowlist(policy, extraSources) {
  const base = String(policy || '').trim();
  if (!base) return '';

  const extras = Array.isArray(extraSources) ? extraSources : [];
  const directives = base
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);

  let found = false;
  const updated = directives.map((directive) => {
    if (!directive.startsWith('connect-src')) return directive;
    found = true;

    const parts = directive.split(/\s+/).filter(Boolean);
    const name = parts[0];
    const sources = parts.slice(1);

    const out = new Set(sources);
    for (const extra of extras) {
      const value = String(extra || '').trim();
      if (value) out.add(value);
    }

    return [name, ...Array.from(out)].join(' ');
  });

  if (!found) {
    updated.push(['connect-src', "'self'", ...extras].join(' '));
  }

  return updated.join('; ');
}

function extractCspMetaContent(html) {
  const text = String(html || '');
  // Match a single meta tag only (do not span across multiple <meta> tags),
  // otherwise we can accidentally capture the viewport meta's `content=` value.
  const metaRegex = /<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i;
  const meta = text.match(metaRegex)?.[0] || '';
  if (!meta) return { metaTag: '', content: '' };

  const contentMatch = meta.match(/content\s*=\s*"([^"]+)"/i)
    || meta.match(/content\s*=\s*'([^']+)'/i);
  return {
    metaTag: meta,
    content: contentMatch?.[1] || ''
  };
}

function formatLocalEmulatorOrigin(scheme, endpoint) {
  const host = String(endpoint?.host || '').includes(':')
    ? `[${endpoint.host}]`
    : endpoint?.host;
  return `${scheme}://${host}:${endpoint?.port}`;
}

function resolveProjectsEmulatorEndpoints(env = process.env, projectId = '') {
  const configuredProjectId = String(projectId || env.FIREBASE_PROJECT_ID || '').trim();
  const dedicatedProjectId = String(env.CRM_PROJECTS_EMULATOR_PROJECT || '').trim();
  if (configuredProjectId !== CRM_PROJECTS_DEMO_PROJECT
    || (dedicatedProjectId && dedicatedProjectId !== configuredProjectId)) {
    return null;
  }
  const auth = parseLocalEmulatorEndpoint(env.FIREBASE_AUTH_EMULATOR_HOST);
  const firestore = parseLocalEmulatorEndpoint(env.FIRESTORE_EMULATOR_HOST);
  if (!auth || !firestore) return null;
  return { auth, firestore };
}

function buildLocalCrmAdminDocument(rawHtml, env = process.env, projectId = '') {
  const source = String(rawHtml || '');
  const { metaTag, content } = extractCspMetaContent(source);
  const configuredProjectId = String(projectId || env.FIREBASE_PROJECT_ID || '').trim();
  const dedicatedProjectId = String(env.CRM_PROJECTS_EMULATOR_PROJECT || '').trim();
  const isDemoProject = configuredProjectId === CRM_PROJECTS_DEMO_PROJECT
    && (!dedicatedProjectId || dedicatedProjectId === configuredProjectId);
  const endpoints = resolveProjectsEmulatorEndpoints(env, projectId);
  if (!metaTag || !endpoints) {
    return { html: source, policy: null, endpoints: null, isDemoProject };
  }

  const exactSources = [
    formatLocalEmulatorOrigin('http', endpoints.auth),
    formatLocalEmulatorOrigin('http', endpoints.firestore)
  ];
  return {
    html: source.replace(metaTag, ''),
    policy: addConnectSrcAllowlist(content, exactSources),
    endpoints,
    isDemoProject: true
  };
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
  // Resolve a default route only when the caller did not inject one. This
  // keeps createApp's test/local dependency injection useful without eagerly
  // loading Firebase-backed legacy modules that the injected app never mounts.
  const defaultRouteLoaders = {
    transcriptRoutes: () => require('../routes/transcript'),
    dictionaryRoutes: () => require('../routes/dictionary'),
    aiProxyRoutes: () => require('../routes/ai-proxy'),
    adminRoutes: () => require('../routes/admin'),
    teacherSchedulerRoutes: () => require('../routes/teacher-scheduler'),
    classroomsRoutes: () => require('../routes/classrooms'),
    entranceTestRoutes: () => require('../routes/entrance-tests'),
    readingJourneyRoutes: () => require('../routes/reading-journey'),
    pronunciationTestRoutes: () => require('../routes/pronunciation-test'),
    pronunciationAiRoutes: () => require('../routes/pronunciation-ai'),
    readAloudRoutes: () => require('../routes/read-aloud'),
    repeatSentenceRoutes: () => require('../routes/repeat-sentence'),
    echoForgeRoutes: () => require('../routes/echo-forge').createEchoForgeRouter(),
    pronunciationComparisonRoutes: () => require('../../functions/src/routes/pronunciation-comparison')
  };
  const routes = { ...(options.routes || {}) };
  for (const [name, load] of Object.entries(defaultRouteLoaders)) {
    if (!Object.prototype.hasOwnProperty.call(routes, name)) routes[name] = load();
  }

  const firebase = options.firebase || require('../utils/firebase');
  const circuitBreaker = options.circuitBreaker || require('../middleware/circuit-breaker');

  const app = express();
  const publicDir = path.join(projectRoot, 'public');
  const startTime = Date.now();

  app.use(cors());
  app.use(compression());
  // Projects has a bounded 1 MB JSON envelope for multiline discussions and
  // bulk commands. Scope the larger parser to both aliases before the legacy
  // 10 KB parser so unrelated local routes keep their existing limit.
  app.use(['/api/projects', '/api/admin/projects'], express.json({ limit: '1mb' }));
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
  app.use('/api/rop/explain-order', aiLimiter);
  app.use('/api/ai-feedback-stream', aiLimiter);

  // Emergency escape hatch for local dev: force-clear service worker + Cache Storage for this origin.
  // Useful when a buggy service worker has pinned clients to a stale UI.
  app.get('/__clear-site-data', (_req, res) => {
    res.setHeader('Clear-Site-Data', '"cache", "storage", "executionContexts"');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(`<!doctype html>
<meta charset="utf-8">
<title>Clearing site data…</title>
<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;padding:24px;line-height:1.4}</style>
<h1>Clearing site data…</h1>
<p>Close this tab, then reload the app.</p>`);
  });

  // Dev-only CSP override for CRM Admin so emulator connectivity is allowed locally.
  // In production hosting, crm-admin.html is served as a static file with its own CSP meta tag.
  app.get('/crm-admin.html', (req, res, next) => {
    const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    if (isProd || !isLocalHostname(req.hostname)) {
      return next();
    }

    try {
      const filePath = path.join(publicDir, 'crm-admin.html');
      const rawHtml = fs.readFileSync(filePath, 'utf-8');
      const clientProjectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
      let adminProjectId = '';
      try {
        adminProjectId = typeof firebase?.admin?.app === 'function'
          ? String(firebase.admin.app()?.options?.projectId || '').trim()
          : String(firebase?.admin?.app?.options?.projectId || '').trim();
      } catch (_) {
        adminProjectId = '';
      }
      const document = buildLocalCrmAdminDocument(rawHtml, process.env, clientProjectId || adminProjectId);
      if (!document.endpoints) {
        // Preserve the established loopback-only local development behavior
        // for ordinary Firebase projects. A dedicated demo project fails
        // closed to the static policy when its endpoints are incomplete or
        // disagree, so the browser cannot guess another emulator instance.
        if (document.isDemoProject) return next();
        const { metaTag, content } = extractCspMetaContent(rawHtml);
        const html = metaTag ? rawHtml.replace(metaTag, '') : rawHtml;
        const devPolicy = addConnectSrcAllowlist(content, [
          'http://localhost:*',
          'ws://localhost:*',
          'http://127.0.0.1:*',
          'ws://127.0.0.1:*'
        ]);
        if (devPolicy) res.setHeader('Content-Security-Policy', devPolicy);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.type('html').send(html);
      }
      res.setHeader('Content-Security-Policy', document.policy);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.type('html').send(document.html);
    } catch (err) {
      next(err);
    }
  });

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
  app.use('/api/teacher', routes.teacherSchedulerRoutes);
  app.use('/api', routes.classroomsRoutes);
  app.use('/api/entrance-tests', routes.entranceTestRoutes);
  app.use('/api', routes.readingJourneyRoutes);

  // Ingest beacon on page unload cleanly without 404
  app.post(['/session-end', '/api/session-end'], (_req, res) => {
    res.status(204).end();
  });

  // To simulate Firebase Functions authentication in local dev server:
  // Normally Firebase passes a decoded token. In local dev, we need the authMiddleware.
  const functionsAuthMiddleware = require('../middleware/auth-user');
  const {
    practiceAttemptsLimiterByUid,
    sharedPracticeAttemptsLimiter,
    azureAssessmentRateLimiter
  } = require('../../functions/src/middleware/practice-attempts-rate-limiter');

  const optionalAuthUserMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.slice('Bearer '.length).trim();
      if (idToken) {
        try {
          let decodedToken;
          if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
            const parts = idToken.split('.');
            if (parts.length >= 2) {
              const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
              payload.uid = payload.sub || payload.user_id;
              decodedToken = payload;
            }
          } else {
            decodedToken = await firebase.admin.auth().verifyIdToken(idToken);
          }
          if (decodedToken) {
            req.user = decodedToken;
          }
        } catch (error) {
          console.warn('[AUTH] Optional token verification failed:', error.message);
        }
      }
    }
    next();
  };

  app.use('/api/read-aloud/assess', optionalAuthUserMiddleware, azureAssessmentRateLimiter);
  app.use('/api/repeat-sentence/assess', optionalAuthUserMiddleware, azureAssessmentRateLimiter);
  app.use('/api/echo-forge/assess', optionalAuthUserMiddleware, azureAssessmentRateLimiter);
  app.use('/api/pronunciation-test/assess', optionalAuthUserMiddleware, azureAssessmentRateLimiter);
  app.use('/api/pronunciation-test/vowel-hint', optionalAuthUserMiddleware, azureAssessmentRateLimiter);
  if (routes.pronunciationTestRoutes) app.use('/api', optionalAuthUserMiddleware, routes.pronunciationTestRoutes);
  if (routes.pronunciationAiRoutes) app.use('/api', optionalAuthUserMiddleware, routes.pronunciationAiRoutes);
  if (routes.readAloudRoutes) app.use('/api', optionalAuthUserMiddleware, routes.readAloudRoutes);
  if (routes.repeatSentenceRoutes) app.use('/api', optionalAuthUserMiddleware, routes.repeatSentenceRoutes);
  if (routes.echoForgeRoutes) app.use('/api', optionalAuthUserMiddleware, routes.echoForgeRoutes);
  if (routes.pronunciationComparisonRoutes) {
    app.use('/api/pronunciation-assessment', optionalAuthUserMiddleware, azureAssessmentRateLimiter, routes.pronunciationComparisonRoutes);
  }

  const { sendSuccess: fnsSendSuccess, sendError: fnsSendError } = require('../../functions/src/utils/response-helper');
  const createPracticeAttemptsRouter = require('../../functions/src/routes/practice-attempts');
  const createSharedPracticeAttemptsRouter = require('../../functions/src/routes/shared-practice-attempts');
  const createProjectsRouter = require('../../functions/src/routes/crm/projects');

  const routerDeps = {
    db: firebase.db,
    sendSuccess: fnsSendSuccess,
    sendError: fnsSendError,
    getStorageBucket: firebase.getStorageBucket,
    serverTimestamp: () => firebase.admin.firestore.FieldValue.serverTimestamp()
  };

  app.use('/api/practice-attempts', functionsAuthMiddleware, practiceAttemptsLimiterByUid, createPracticeAttemptsRouter(routerDeps));
  app.use('/api/shared/practice-attempts', sharedPracticeAttemptsLimiter, createSharedPracticeAttemptsRouter(routerDeps));

  // Projects owns its own verifier-backed identity fence. It must not reuse
  // the legacy local emulator JWT decoder used by practice routes.
  if (firebase?.db && typeof firebase.db.collection === 'function'
    && typeof firebase?.admin?.auth === 'function') {
    try {
      const projectsAuth = firebase.admin.auth();
      if (projectsAuth && typeof projectsAuth.verifyIdToken === 'function'
        && typeof projectsAuth.getUser === 'function') {
        const projectsRouter = createProjectsRouter({
          db: firebase.db,
          authorizeCrmIdentity: ({ identity }) => !!process.env.ADMIN_EMAIL && identity.authUser?.emailVerified === true && identity.authUser?.email === process.env.ADMIN_EMAIL,
          auth: projectsAuth,
          verifyIdToken: (token, checkRevoked) => projectsAuth.verifyIdToken(token, checkRevoked),
          getAuthUser: (uid) => projectsAuth.getUser(uid),
          bootstrapAdminEmails: [
            process.env.ADMIN_EMAIL,
            resolveLocalAdminEmail({ repoRoot: projectRoot })
          ].filter(Boolean),
          sendSuccess: fnsSendSuccess,
          sendError: fnsSendError,
          getStorageBucket: firebase.getStorageBucket,
          serverTimestamp: () => firebase.admin.firestore.FieldValue.serverTimestamp()
        });
        app.use('/api/projects', projectsRouter);
        app.use('/api/admin/projects', projectsRouter);
      }
    } catch (error) {
      logger.warn?.('[Projects] Local router unavailable:', error?.message || error);
    }
  }

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
    const authEmulator = parseLocalEmulatorEndpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST);
    const firestoreEmulator = parseLocalEmulatorEndpoint(process.env.FIRESTORE_EMULATOR_HOST);
    const clientProjectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
    const dedicatedProjectId = String(process.env.CRM_PROJECTS_EMULATOR_PROJECT || '').trim();
    let adminProjectId = '';
    try {
      adminProjectId = typeof firebase?.admin?.app === 'function'
        ? String(firebase.admin.app()?.options?.projectId || '').trim()
        : String(firebase?.admin?.app?.options?.projectId || '').trim();
    } catch (_) {
      // A partially initialized injected Admin SDK must not make /api/config
      // publish an emulator override based on incomplete metadata.
      adminProjectId = '';
    }
    const configuredProjectId = clientProjectId || adminProjectId;
    // The browser override is reserved for the isolated CRM Projects demo.
    // Ordinary local development often points at another Firebase project and
    // must continue using the legacy client defaults.
    const publishProjectsEmulators = configuredProjectId === 'demo-crm-projects'
      && (!dedicatedProjectId || dedicatedProjectId === configuredProjectId);
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
      },
      emulators: publishProjectsEmulators && authEmulator && firestoreEmulator
        ? { auth: authEmulator, firestore: firestoreEmulator }
        : undefined,
      features: buildPublicFeatures(process.env)
    });
  });

  // Local development convenience only. The endpoint is deliberately
  // emulator-gated and never issues a token on production Firebase.
  app.post('/api/local/admin-token', async (req, res) => {
    if (!shouldAllowLocalAdminBootstrap(req)) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    }

    const email = resolveLocalAdminEmail({ repoRoot: projectRoot });
    const auth = typeof firebase?.admin?.auth === 'function' ? firebase.admin.auth() : null;
    if (!email || !auth) {
      return res.status(503).json({ success: false, error: 'LOCAL_ADMIN_UNAVAILABLE' });
    }

    try {
      const user = await auth.getUserByEmail(email);
      if (!user?.uid || user.emailVerified !== true) {
        return res.status(503).json({ success: false, error: 'LOCAL_ADMIN_UNAVAILABLE' });
      }

      const token = await auth.createCustomToken(user.uid);
      if (!token) {
        return res.status(503).json({ success: false, error: 'LOCAL_ADMIN_UNAVAILABLE' });
      }

      res.setHeader('Cache-Control', 'no-store');
      return res.json({ success: true, token });
    } catch (error) {
      console.warn('[LocalAdmin] Auto-login token unavailable:', error?.message || error);
      return res.status(503).json({ success: false, error: 'LOCAL_ADMIN_UNAVAILABLE' });
    }
  });

  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode || 500);
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Uploaded file exceeds the allowed size.');
    }
    if (err?.name === 'MulterError' || String(err?.code || '').startsWith('LIMIT_')) {
      return sendError(res, 400, 'INVALID_REQUEST', err?.message || 'Multipart request could not be processed.');
    }
    if (status >= 400 && status < 500) {
      return sendError(res, status, 'INVALID_REQUEST', err?.message || 'Request could not be processed.');
    }
    console.error('[Server] Unhandled request error:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected server error occurred.');
  });

  app.use('/api', (req, res) => {
    res.status(404).json({
      success: false,
      error: 'NOT_FOUND',
      message: `API matching ${req.method} ${req.originalUrl} not found.`
    });
  });

  // SPA catch-all: serve index.html ONLY for navigation requests (paths without
  // a file extension).  Static-asset requests (.js, .css, .json, .png, etc.) that
  // weren't matched by express.static above should 404 naturally so the browser
  // gets an appropriate error instead of HTML content with a wrong MIME type.
  app.get(/^(?!\/api).*$/, (req, res, next) => {
    // If the URL path contains a file extension, it's a static asset miss — skip.
    if (/\.\w{2,5}(\?.*)?$/.test(req.path)) {
      return next();
    }
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
  setStaticCacheHeaders,
  parseLocalEmulatorEndpoint,
  resolveProjectsEmulatorEndpoints,
  buildLocalCrmAdminDocument
};
