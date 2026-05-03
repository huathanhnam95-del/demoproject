/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');

async function startServer(router) {
    return new Promise((resolve) => {
        const app = express();
        app.use(express.json());
        app.use('/api/admin', router);
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                baseUrl: `http://127.0.0.1:${address.port}`
            });
        });
    });
}

async function stopServer(server) {
    await new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

async function run() {
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
            req.user = { uid: 'user-1', email: 'user@example.com' };
            next();
        },
        adminMiddleware: (_req, res) => {
            res.status(403).json({
                success: false,
                error: 'FORBIDDEN',
                message: 'Admin access required.'
            });
        },
        sendSuccess: (res, data, message = 'ok') => res.status(200).json({ success: true, data, message }),
        sendError: (res, status, error, message, details = null) => res.status(status).json({
            success: false,
            error,
            message,
            ...(details ? { details } : {})
        }),
        getStorageBucket: async () => null,
        identity: {
            generateClassCode: async () => 'ABC123',
            lookupUserByEmail: async () => ({ uid: 'u2' }),
            forceLinkProfile: async () => ({ success: true })
        },
        registerExtraRoutes: registerLocalOnlyRoutes
    });

    const { server, baseUrl } = await startServer(router);

    try {
        const response = await fetch(`${baseUrl}/api/admin/sync-from-prod/collections`, {
            method: 'GET',
            headers: { Authorization: 'Bearer test' }
        });
        const body = await response.json();
        assert.strictEqual(response.status, 403, 'sync routes should honor the admin middleware when mounted on the local admin router');
        assert.strictEqual(body?.error, 'FORBIDDEN', 'admin middleware should block sync route access');
    } finally {
        await stopServer(server);
        if (typeof previousEmulatorHost === 'string') {
            process.env.FIRESTORE_EMULATOR_HOST = previousEmulatorHost;
        } else {
            delete process.env.FIRESTORE_EMULATOR_HOST;
        }
    }

    console.log('sync-from-prod admin guard passed');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
