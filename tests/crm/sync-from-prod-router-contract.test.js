/* eslint-disable no-console */
const assert = require('assert');

function collectRoutes(router, prefix = '') {
    const routes = [];
    const stack = router && router.stack ? router.stack : [];

    for (const layer of stack) {
        if (layer.route) {
            const methods = Object.keys(layer.route.methods || {})
                .filter((method) => layer.route.methods[method])
                .map((method) => method.toUpperCase());
            const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
            for (const routePath of paths) {
                for (const method of methods) {
                    routes.push(`${method} ${prefix}${routePath}`);
                }
            }
            continue;
        }

        if (layer.handle && layer.handle.stack) {
            routes.push(...collectRoutes(layer.handle, prefix));
        }
    }

    return routes;
}

function expectRoute(routes, signature) {
    assert(
        routes.includes(signature),
        `Expected route ${signature} to be mounted.\nFound:\n${routes.sort().join('\n')}`
    );
}

const previousEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const {
    createLocalAdminRouter,
    registerLocalOnlyRoutes
} = require('../../src/routes/admin');

const router = createLocalAdminRouter({
    db: {},
    admin: {
        firestore: {
            FieldValue: {
                serverTimestamp: () => new Date()
            }
        }
    },
    authMiddleware: (req, _res, next) => {
        req.user = { uid: 'u1', email: 'admin@example.com' };
        next();
    },
    adminMiddleware: (_req, _res, next) => next(),
    sendSuccess: () => null,
    sendError: () => null,
    getStorageBucket: async () => null,
    identity: {
        generateClassCode: async () => 'ABC123',
        lookupUserByEmail: async () => ({ uid: 'u2' }),
        forceLinkProfile: async () => ({ success: true })
    },
    registerExtraRoutes: registerLocalOnlyRoutes
});

const routes = collectRoutes(router);

expectRoute(routes, 'POST /sync-from-prod');
expectRoute(routes, 'POST /sync-from-prod/selective');
expectRoute(routes, 'GET /sync-from-prod/collections');
expectRoute(routes, 'GET /sync-from-prod/jobs/:jobId');
expectRoute(routes, 'GET /sync-from-prod/jobs/latest');

if (typeof previousEmulatorHost === 'string') {
    process.env.FIRESTORE_EMULATOR_HOST = previousEmulatorHost;
} else {
    delete process.env.FIRESTORE_EMULATOR_HOST;
}

console.log('sync-from-prod router contract passed');
