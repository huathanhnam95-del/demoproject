'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { createPresentationDemoRouter } = require('../../functions/src/routes/admin/presentation-demo');
const { createMemoryRoomStores, createRoomService } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');
const { createPdfService } = require('../../functions/src/crm/presentation-demo/pdf-service.cjs');

function loopbackAuth(req, res, next) {
  if (String(process.env.PRESENTATION_DEMO_DEV_AUTH || '').trim() !== '1') return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  const uid = String(req.headers['x-demo-user'] || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(uid)) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  req.user = { uid, email: `${uid}@local.invalid`, accountStatus: 'active', isAdmin: uid === 'admin' };
  return next();
}

function createServer({ services, authMiddleware = loopbackAuth } = {}) {
  const resolved = services || (() => {
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores });
    const notes = createNotebookService({ roomService });
    const archives = createArchiveService({ roomService, notesService: notes, stores });
    return { roomService, connections: createConnectionService({ roomService }), notes, archives, pdf: createPdfService({ archives }) };
  })();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.resolve(__dirname, '../../public'), { etag: true, maxAge: 0 }));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'bel-presentation-demo' }));
  app.use('/api/presentation-demo', authMiddleware, createPresentationDemoRouter({ ...resolved, authMiddleware: (_req, _res, next) => next() }));
  const server = http.createServer(app);
  // The current browser transport is deliberately HTTP and polling-based.
  // This seam keeps the Cloud Run service independent from the Functions API;
  // a production WebSocket gateway must be added only with shared RTDB-backed
  // leases and delivery, never as a client-side fallback.
  server.presentationDemoServices = resolved;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  createServer().listen(port, () => console.log(`BEL Presentation Demo service listening on ${port}`));
}

module.exports = { createServer };
