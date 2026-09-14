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
const { createFirebasePresentationDemoServices } = require('../../functions/src/crm/presentation-demo/firebase-stores.cjs');
const { serverIdentityFromAuth } = require('../../functions/src/crm/presentation-demo/identity.cjs');
const { installWebSocketGateway } = require('./gateway.cjs');

function devIdentity(uid) { return { uid, email: `${uid}@local.invalid`, accountStatus: 'active', isAdmin: uid === 'admin', isTeacher: uid !== 'admin', local: true }; }

function loopbackAuth(req, res, next) {
  if (String(process.env.PRESENTATION_DEMO_DEV_AUTH || '').trim() !== '1' || process.env.NODE_ENV === 'production') return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  const uid = String(req.headers['x-demo-user'] || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(uid)) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  req.user = devIdentity(uid);
  return next();
}

async function firebaseIdentity(token) {
  const { db, getAuth } = require('../../functions/src/utils/firebase_admin_init');
  const auth = getAuth();
  const decoded = await auth.verifyIdToken(String(token || ''), true);
  const authUser = await auth.getUser(decoded.uid);
  if (authUser.disabled === true) { const error = new Error('Account is disabled.'); error.code = 'ACCOUNT_DISABLED'; throw error; }
  const [profileSnap, workforceSnap] = await Promise.all([
    db.collection('users').doc(decoded.uid).get(),
    db.collection('crmWorkforceAccounts').doc(decoded.uid).get()
  ]);
  return serverIdentityFromAuth({ decodedToken: decoded, authUser, profile: profileSnap.exists ? profileSnap.data() : null, workforce: workforceSnap.exists ? workforceSnap.data() : null });
}

async function firebaseAuth(req, res, next) {
  try {
    const header = String(req.headers.authorization || '');
    if (!/^Bearer\s+/i.test(header)) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    req.user = await firebaseIdentity(header.replace(/^Bearer\s+/i, '').trim());
    return next();
  } catch (error) { return res.status(error.code === 'ACCOUNT_DISABLED' ? 401 : 401).json({ success: false, error: error.code || 'UNAUTHORIZED' }); }
}

function defaultServices() {
  const online = String(process.env.PRESENTATION_DEMO_ONLINE_ENABLED || '').trim() === '1';
  const durable = String(process.env.PRESENTATION_DEMO_DURABLE_READY || '').trim() === '1';
  if (online && !durable) throw new Error('PRESENTATION_DEMO_ONLINE_ENABLED requires PRESENTATION_DEMO_DURABLE_READY=1.');
  if (durable) {
    const { db, getDatabase } = require('../../functions/src/utils/firebase_admin_init');
    const bundle = createFirebasePresentationDemoServices({ db, rtdb: getDatabase() });
    return { ...bundle, pdf: createPdfService({ archives: bundle.archives, roomService: bundle.roomService, notesService: bundle.notes }) , connections: createConnectionService({ roomService: bundle.roomService }) };
  }
  const stores = createMemoryRoomStores();
  const roomService = createRoomService({ stores });
  const notes = createNotebookService({ roomService });
  const archives = createArchiveService({ roomService, notesService: notes, stores });
  return { roomService, connections: createConnectionService({ roomService }), notes, archives, pdf: createPdfService({ archives, roomService, notesService: notes }) };
}

function createServer({ services, authMiddleware, gatewayAuthenticate = null, gatewayResolveIdentity = async identity => identity } = {}) {
  const resolved = services || defaultServices();
  const useDurable = resolved.roomService?.durable === true;
  const auth = authMiddleware || (useDurable ? firebaseAuth : loopbackAuth);
  const app = express();
  app.disable('x-powered-by');
  // A valid note body is contractually allowed to be 50,000 characters.
  app.use(express.json({ limit: '80kb' }));
  app.get(['/config', '/api/config'], (_req, res) => {
    const online = String(process.env.PRESENTATION_DEMO_ONLINE_ENABLED || '').trim() === '1';
    const emulator = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || '').trim();
    return res.json({ success: true, config: { apiKey: 'demo-bel-online', authDomain: 'demo-bel-online.firebaseapp.com', projectId: process.env.FIREBASE_PROJECT_ID || 'demo-bel-online' }, authEmulatorUrl: emulator ? `http://${emulator}` : null, features: { presentationDemoOnline: online } });
  });
  app.use(express.static(path.resolve(__dirname, '../../public'), { etag: true, maxAge: 0 }));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'bel-presentation-demo', durable: useDurable, websocket: true }));
  app.use('/api/presentation-demo', auth, createPresentationDemoRouter({ ...resolved, authMiddleware: (_req, _res, next) => next(), resolveIdentity: req => req.user }));
  const server = http.createServer(app);
  const gatewayAuth = gatewayAuthenticate || (useDurable
    ? token => firebaseIdentity(token)
    : async token => {
      if (String(process.env.PRESENTATION_DEMO_DEV_AUTH || '').trim() !== '1' || process.env.NODE_ENV === 'production') return null;
      const uid = String(token || '').replace(/^dev:/, '');
      return /^[A-Za-z0-9_-]{1,80}$/.test(uid) ? devIdentity(uid) : null;
    });
  server.presentationDemoServices = resolved;
  server.presentationDemoGateway = installWebSocketGateway(server, { connections: resolved.connections, authenticate: gatewayAuth, resolveIdentity: gatewayResolveIdentity });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
  createServer().listen(port, host, () => console.log(`BEL Presentation Demo service listening on ${host}:${port}`));
}

module.exports = { createServer, firebaseAuth, firebaseIdentity, loopbackAuth };
