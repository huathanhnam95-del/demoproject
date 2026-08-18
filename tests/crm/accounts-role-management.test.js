/* eslint-disable no-console */
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

async function runHandlers(handlers, req, res) {
    for (const handler of handlers) {
        let nextCalled = false;
        await handler(req, res, (err) => {
            if (err) throw err;
            nextCalled = true;
        });
        if (!nextCalled) {
            break;
        }
    }
}

(async () => {
    const usersStore = new Map([
        ['bootstrap-admin-uid', {
            email: 'huathanhnam95@gmail.com',
            displayName: 'Bootstrap Nam',
            isAdmin: true,
            isTeacher: false,
            crmRole: 'admin'
        }],
        ['current-admin-uid', {
            email: 'otheradmin@example.com',
            displayName: 'Other Admin',
            isAdmin: true,
            isTeacher: false,
            crmRole: 'admin'
        }],
        ['teacher-user-uid', {
            email: 'teacher@example.com',
            displayName: 'Teacher Alice',
            isAdmin: false,
            isTeacher: true,
            crmRole: 'teacher'
        }],
        ['regular-user-uid', {
            email: 'student@example.com',
            displayName: 'Bob Student',
            isAdmin: false,
            isTeacher: false,
            crmRole: 'user'
        }]
    ]);

    const auditLogs = [];
    const customClaimsStore = new Map([
        ['bootstrap-admin-uid', { isAdmin: true }],
        ['current-admin-uid', { isAdmin: true }],
        ['teacher-user-uid', { isTeacher: true }],
        ['regular-user-uid', {}]
    ]);

    const mockDb = {
        collection(colName) {
            if (colName === 'users') {
                return {
                    async get() {
                        const docs = [];
                        for (const [id, data] of usersStore.entries()) {
                            docs.push({
                                id,
                                data: () => ({ ...data })
                            });
                        }
                        return {
                            docs,
                            forEach(cb) {
                                docs.forEach(cb);
                            }
                        };
                    },
                    doc(uid) {
                        return {
                            async get() {
                                const exists = usersStore.has(uid);
                                return {
                                    exists,
                                    data: () => exists ? { ...usersStore.get(uid) } : null
                                };
                            },
                            async set(data, opts = {}) {
                                const existing = usersStore.get(uid) || {};
                                const merged = opts.merge ? { ...existing, ...data } : data;
                                usersStore.set(uid, merged);
                            }
                        };
                    }
                };
            }
            if (colName === 'crmAuditLogs') {
                return {
                    doc() {
                        return {
                            async set(entry) {
                                auditLogs.push(entry);
                            }
                        };
                    }
                };
            }
            return {
                doc() { return { async get() { return { exists: false }; }, async set() {} }; },
                async get() { return { docs: [], forEach() {} }; }
            };
        }
    };

    const mockAuth = {
        async getUser(uid) {
            return {
                uid,
                customClaims: customClaimsStore.get(uid) || {}
            };
        },
        async setCustomUserClaims(uid, claims) {
            customClaimsStore.set(uid, claims);
        }
    };

    const router = createCrmRouter({
        db: mockDb,
        admin: {
            auth: () => mockAuth
        },
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'current-admin-uid', email: 'otheradmin@example.com' };
            next();
        },
        adminMiddleware: (req, _res, next) => next(),
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...data, message }),
        sendError: (res, status, error, message, details) =>
            res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        getBootstrapAdminEmails: () => new Set(['huathanhnam95@gmail.com']),
        identity: {
            generateClassCode: async () => 'ABC123',
            lookupUserByEmail: async () => null,
            forceLinkProfile: async () => null
        }
    });

    // 1. Test GET /accounts
    {
        const handlers = getRouteHandlers(router, '/accounts', 'get');
        const req = { headers: {} };
        const res = buildRes();

        await runHandlers(handlers, req, res);
        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._json.success, true);
        assert.strictEqual(res._json.count, 4);

        const accounts = res._json.accounts;
        assert.strictEqual(accounts[0].displayName, 'Bob Student');
        assert.strictEqual(accounts[0].isAdmin, false);
        assert.strictEqual(accounts[1].displayName, 'Bootstrap Nam');
        assert.strictEqual(accounts[1].isAdmin, true);
        assert.strictEqual(accounts[2].displayName, 'Other Admin');
        assert.strictEqual(accounts[2].isAdmin, true);
        assert.strictEqual(accounts[3].displayName, 'Teacher Alice');
        assert.strictEqual(accounts[3].isTeacher, true);
        assert.strictEqual(accounts[3].isAdmin, false);
        console.log('✔ GET /accounts successfully lists and sorts accounts');
    }

    // 2. Test PATCH /accounts/:uid/role -> Promote regular user to Admin
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid/role', 'patch');
        const req = {
            params: { uid: 'regular-user-uid' },
            body: { isAdmin: true }
        };
        const res = buildRes();

        await runHandlers(handlers, req, res);
        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._json.success, true);
        assert.strictEqual(res._json.account.isAdmin, true);

        // Verify Firestore updated
        const updatedUser = usersStore.get('regular-user-uid');
        assert.strictEqual(updatedUser.isAdmin, true);
        assert.strictEqual(updatedUser.crmRole, 'admin');
        assert.strictEqual(updatedUser.adminUpdatedBy, 'current-admin-uid');

        // Verify Custom Claims updated
        const updatedClaims = customClaimsStore.get('regular-user-uid');
        assert.strictEqual(updatedClaims.isAdmin, true);

        // Verify Audit Log
        const promoteAudit = auditLogs.find((l) => l.action === 'account.promote' && l.entityId === 'regular-user-uid');
        assert.ok(promoteAudit, 'Promote audit log must exist');
        console.log('✔ PATCH /accounts/:uid/role successfully promotes user to Admin and syncs claims');
    }

    // 3. Test PATCH /accounts/:uid/role -> Demote previously promoted user from Admin
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid/role', 'patch');
        const req = {
            params: { uid: 'regular-user-uid' },
            body: { isAdmin: false }
        };
        const res = buildRes();

        await runHandlers(handlers, req, res);
        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._json.success, true);
        assert.strictEqual(res._json.account.isAdmin, false);

        // Verify Firestore updated
        const updatedUser = usersStore.get('regular-user-uid');
        assert.strictEqual(updatedUser.isAdmin, false);
        assert.strictEqual(updatedUser.crmRole, 'user');

        // Verify Custom Claims updated
        const updatedClaims = customClaimsStore.get('regular-user-uid');
        assert.strictEqual(updatedClaims.isAdmin, false);

        // Verify Audit Log
        const demoteAudit = auditLogs.find((l) => l.action === 'account.demote' && l.entityId === 'regular-user-uid');
        assert.ok(demoteAudit, 'Demote audit log must exist');
        console.log('✔ PATCH /accounts/:uid/role successfully demotes user from Admin and syncs claims');
    }

    // 4. Test PATCH /accounts/:uid/role -> Block demoting bootstrap admin
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid/role', 'patch');
        const req = {
            params: { uid: 'bootstrap-admin-uid' },
            body: { isAdmin: false }
        };
        const res = buildRes();

        await runHandlers(handlers, req, res);
        assert.strictEqual(res._status, 403);
        assert.strictEqual(res._json.error, 'BOOTSTRAP_ADMIN_PROTECTED');
        assert.strictEqual(usersStore.get('bootstrap-admin-uid').isAdmin, true);
        console.log('✔ PATCH /accounts/:uid/role blocks demoting bootstrap admin email');
    }

    // 5. Test PATCH /accounts/:uid/role -> Block self-demotion
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid/role', 'patch');
        const req = {
            params: { uid: 'current-admin-uid' },
            body: { isAdmin: false }
        };
        const res = buildRes();

        await runHandlers(handlers, req, res);
        assert.strictEqual(res._status, 403);
        assert.strictEqual(res._json.error, 'SELF_DEMOTION_FORBIDDEN');
        assert.strictEqual(usersStore.get('current-admin-uid').isAdmin, true);
        console.log('✔ PATCH /accounts/:uid/role blocks self-demotion');
    }

    // 6. Test PATCH /accounts/:uid/role -> Non-existent user
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid/role', 'patch');
        const req = {
            params: { uid: 'non-existent-uid' },
            body: { isAdmin: true }
        };
        const res = buildRes();

        await runHandlers(handlers, req, res);
        assert.strictEqual(res._status, 404);
        assert.strictEqual(res._json.error, 'ACCOUNT_NOT_FOUND');
        console.log('✔ PATCH /accounts/:uid/role returns 404 for non-existent user');
    }

    // 7. Test PATCH /accounts/:uid/role -> Invalid payload
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid/role', 'patch');
        const req = {
            params: { uid: 'teacher-user-uid' },
            body: { isAdmin: 'not-a-boolean' }
        };
        const res = buildRes();

        await runHandlers(handlers, req, res);
        assert.strictEqual(res._status, 400);
        assert.strictEqual(res._json.error, 'VALIDATION_ERROR');
        console.log('✔ PATCH /accounts/:uid/role validates isAdmin boolean payload');
    }

    console.log('\nAll Accounts Role Management Unit Tests Passed!');
})().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
