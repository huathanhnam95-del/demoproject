const assert = require('assert');

const createCrmRouter = require('../../functions/src/routes/admin/create-crm-router');

function buildRes() {
  return {
    _status: 200,
    _json: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(payload) {
      this._json = payload;
      return this;
    }
  };
}

function getRouteHandlers(router, path, method) {
  const layer = (router.stack || []).find((l) => l.route && l.route.path === path);
  assert(layer, `Route ${path} not found`);
  const stacks = layer.route.stack || [];
  const handles = stacks
    .filter((s) => s.method === method)
    .map((s) => s.handle);
  assert(handles.length > 0, `Route ${method.toUpperCase()} ${path} has no handlers`);
  return handles;
}

(async () => {
  let writeAttempts = 0;
  const db = {
    collection() {
      return {
        doc() {
          return {
            async set() {
              writeAttempts += 1;
            }
          };
        }
      };
    }
  };

  const router = createCrmRouter({
    db,
    admin: {},
    authMiddleware: (req, _res, next) => {
      req.user = { uid: 'u1', email: 'user@example.com' };
      next();
    },
    adminMiddleware: (req, _res, next) => next(),
    sendSuccess: (res, data) => res.status(200).json({ success: true, ...data }),
    sendError: (res, status, error, message, details) =>
      res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
    identity: {
      generateClassCode: async () => 'ABC123',
      lookupUserByEmail: async () => ({ uid: 'u2', email: 'u2@example.com' }),
      forceLinkProfile: async () => ({ success: true })
    }
    // Intentionally omit resolveAdminStatus to validate safe defaults.
  });

  const handlers = getRouteHandlers(router, '/status', 'get');
  assert(handlers.length >= 2, 'Expected GET /status to have auth middleware + handler.');

  const req = { headers: {}, user: null };
  const res = buildRes();

  await new Promise((resolve, reject) => {
    handlers[0](req, res, (err) => (err ? reject(err) : resolve()));
  });
  await handlers[handlers.length - 1](req, res);

  assert.strictEqual(res._status, 403, `Expected 403, got ${res._status} with payload ${JSON.stringify(res._json)}`);
  assert.strictEqual(writeAttempts, 0, 'Should not attempt to bootstrap users/{uid}.isAdmin when resolver is missing.');

  console.log('crm admin status security contract passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

