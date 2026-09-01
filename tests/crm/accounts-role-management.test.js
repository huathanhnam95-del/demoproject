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
                            },
                            async delete() {
                                usersStore.delete(uid);
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

    const disabledStore = new Map();
    const deletedAuthUids = [];

    const mockAuth = {
        async getUser(uid) {
            if (!customClaimsStore.has(uid)) {
                const error = new Error('No user record found for the provided identifier.');
                error.code = 'auth/user-not-found';
                throw error;
            }
            return {
                uid,
                customClaims: customClaimsStore.get(uid) || {}
            };
        },
        async setCustomUserClaims(uid, claims) {
            customClaimsStore.set(uid, claims);
        },
        async updateUser(uid, patch) {
            if (Object.prototype.hasOwnProperty.call(patch || {}, 'disabled')) {
                disabledStore.set(uid, Boolean(patch.disabled));
            }
            return { uid };
        },
        async deleteUser(uid) {
            deletedAuthUids.push(uid);
            customClaimsStore.delete(uid);
            disabledStore.delete(uid);
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

    // --- Account lifecycle: archive / restore / delete ---
    // Seeded after the listing assertions above so their fixed counts stay valid.
    usersStore.set('dummy-firestore-only-uid', {
        email: 'bel.audit.dummy1@example.com',
        displayName: '',
        isAdmin: false,
        isTeacher: false,
        crmRole: 'user'
    });
    usersStore.set('dummy-with-auth-uid', {
        email: 'bel.audit.dummy2@example.com',
        displayName: 'Dummy Two',
        isAdmin: false,
        isTeacher: false,
        crmRole: 'user'
    });
    customClaimsStore.set('dummy-with-auth-uid', {});

    // 8. PATCH /accounts/:uid/status -> archive disables login and flags the profile
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid/status', 'patch');
        const req = { params: { uid: 'dummy-with-auth-uid' }, body: { archived: true } };
        const res = buildRes();

        await runHandlers(handlers, req, res);
        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._json.success, true);
        assert.strictEqual(res._json.account.archived, true);

        const stored = usersStore.get('dummy-with-auth-uid');
        assert.strictEqual(stored.archived, true);
        assert.strictEqual(stored.accountStatus, 'archived');
        assert.strictEqual(stored.archivedBy, 'current-admin-uid');
        assert.ok(stored.archivedAt, 'archivedAt must be recorded');
        assert.strictEqual(disabledStore.get('dummy-with-auth-uid'), true, 'Auth login must be disabled on archive');

        const archiveAudit = auditLogs.find((l) => l.action === 'account.archive' && l.entityId === 'dummy-with-auth-uid');
        assert.ok(archiveAudit, 'Archive audit log must exist');
        console.log('✔ PATCH /accounts/:uid/status archives an account and disables its login');
    }

    // 9. GET /accounts -> surfaces archived state to the CRM UI
    {
        const handlers = getRouteHandlers(router, '/accounts', 'get');
        const req = { headers: {} };
        const res = buildRes();

        await runHandlers(handlers, req, res);
        const archivedAccount = res._json.accounts.find((a) => a.uid === 'dummy-with-auth-uid');
        assert.ok(archivedAccount, 'Archived account must still be listed');
        assert.strictEqual(archivedAccount.archived, true);
        assert.ok(archivedAccount.archivedAt, 'archivedAt must be exposed');

        const activeAccount = res._json.accounts.find((a) => a.uid === 'regular-user-uid');
        assert.strictEqual(activeAccount.archived, false);
        console.log('✔ GET /accounts exposes archived state');
    }

    // 10. PATCH /accounts/:uid/status -> restore re-enables login
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid/status', 'patch');
        const req = { params: { uid: 'dummy-with-auth-uid' }, body: { archived: false } };
        const res = buildRes();

        await runHandlers(handlers, req, res);
        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._json.account.archived, false);

        const stored = usersStore.get('dummy-with-auth-uid');
        assert.strictEqual(stored.archived, false);
        assert.strictEqual(stored.accountStatus, 'active');
        assert.strictEqual(stored.archivedAt, null);
        assert.strictEqual(disabledStore.get('dummy-with-auth-uid'), false, 'Auth login must be re-enabled on restore');

        const restoreAudit = auditLogs.find((l) => l.action === 'account.restore' && l.entityId === 'dummy-with-auth-uid');
        assert.ok(restoreAudit, 'Restore audit log must exist');
        console.log('✔ PATCH /accounts/:uid/status restores an archived account');
    }

    // 11. PATCH /accounts/:uid/status -> validation + guards
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid/status', 'patch');

        const badPayload = buildRes();
        await runHandlers(handlers, { params: { uid: 'dummy-with-auth-uid' }, body: { archived: 'yes' } }, badPayload);
        assert.strictEqual(badPayload._status, 400);
        assert.strictEqual(badPayload._json.error, 'VALIDATION_ERROR');

        const bootstrapRes = buildRes();
        await runHandlers(handlers, { params: { uid: 'bootstrap-admin-uid' }, body: { archived: true } }, bootstrapRes);
        assert.strictEqual(bootstrapRes._status, 403);
        assert.strictEqual(bootstrapRes._json.error, 'BOOTSTRAP_ADMIN_PROTECTED');
        assert.ok(!usersStore.get('bootstrap-admin-uid').archived, 'Bootstrap admin must stay active');

        const selfRes = buildRes();
        await runHandlers(handlers, { params: { uid: 'current-admin-uid' }, body: { archived: true } }, selfRes);
        assert.strictEqual(selfRes._status, 403);
        assert.strictEqual(selfRes._json.error, 'SELF_MUTATION_FORBIDDEN');

        const missingRes = buildRes();
        await runHandlers(handlers, { params: { uid: 'non-existent-uid' }, body: { archived: true } }, missingRes);
        assert.strictEqual(missingRes._status, 404);
        assert.strictEqual(missingRes._json.error, 'ACCOUNT_NOT_FOUND');
        console.log('✔ PATCH /accounts/:uid/status validates payload and protects bootstrap/self/missing accounts');
    }

    // 12. DELETE /accounts/:uid -> removes a Firestore-only dummy profile
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid', 'delete');
        const req = { params: { uid: 'dummy-firestore-only-uid' } };
        const res = buildRes();

        await runHandlers(handlers, req, res);
        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._json.success, true);
        assert.strictEqual(res._json.account.uid, 'dummy-firestore-only-uid');
        assert.strictEqual(usersStore.has('dummy-firestore-only-uid'), false, 'Firestore profile must be removed');
        assert.strictEqual(
            deletedAuthUids.includes('dummy-firestore-only-uid'),
            false,
            'No Auth record exists, so deleteUser must not be attempted'
        );

        const deleteAudit = auditLogs.find((l) => l.action === 'account.delete' && l.entityId === 'dummy-firestore-only-uid');
        assert.ok(deleteAudit, 'Delete audit log must exist');
        console.log('✔ DELETE /accounts/:uid deletes a Firestore-only account without an Auth record');
    }

    // 13. DELETE /accounts/:uid -> removes both the Auth user and the profile
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid', 'delete');
        const res = buildRes();

        await runHandlers(handlers, { params: { uid: 'dummy-with-auth-uid' } }, res);
        assert.strictEqual(res._status, 200);
        assert.strictEqual(usersStore.has('dummy-with-auth-uid'), false);
        assert.ok(deletedAuthUids.includes('dummy-with-auth-uid'), 'Auth user must be deleted');
        console.log('✔ DELETE /accounts/:uid deletes the Auth user alongside the profile');
    }

    // 14. DELETE /accounts/:uid -> guards
    {
        const handlers = getRouteHandlers(router, '/accounts/:uid', 'delete');

        const bootstrapRes = buildRes();
        await runHandlers(handlers, { params: { uid: 'bootstrap-admin-uid' } }, bootstrapRes);
        assert.strictEqual(bootstrapRes._status, 403);
        assert.strictEqual(bootstrapRes._json.error, 'BOOTSTRAP_ADMIN_PROTECTED');
        assert.ok(usersStore.has('bootstrap-admin-uid'), 'Bootstrap admin must survive');

        const selfRes = buildRes();
        await runHandlers(handlers, { params: { uid: 'current-admin-uid' } }, selfRes);
        assert.strictEqual(selfRes._status, 403);
        assert.strictEqual(selfRes._json.error, 'SELF_MUTATION_FORBIDDEN');
        assert.ok(usersStore.has('current-admin-uid'), 'Requesting admin must survive');

        // A non-bootstrap admin must be demoted first — deletion is blocked while isAdmin.
        usersStore.set('spare-admin-uid', {
            email: 'spare.admin@example.com',
            displayName: 'Spare Admin',
            isAdmin: true,
            isTeacher: false,
            crmRole: 'admin'
        });
        const adminRes = buildRes();
        await runHandlers(handlers, { params: { uid: 'spare-admin-uid' } }, adminRes);
        assert.strictEqual(adminRes._status, 403);
        assert.strictEqual(adminRes._json.error, 'ADMIN_DELETE_FORBIDDEN');
        assert.ok(usersStore.has('spare-admin-uid'), 'Admin account must survive until demoted');
        console.log('✔ DELETE /accounts/:uid protects bootstrap, self and still-admin accounts');
    }

    // 15. POST /accounts/bulk -> archives many, reporting per-account skips
    {
        const handlers = getRouteHandlers(router, '/accounts/bulk', 'post');
        for (let i = 1; i <= 3; i += 1) {
            usersStore.set(`bulk-dummy-${i}`, {
                email: `bel.audit.bulk${i}@example.com`,
                displayName: `Bulk Dummy ${i}`,
                isAdmin: false,
                isTeacher: false,
                crmRole: 'user'
            });
        }

        const res = buildRes();
        await runHandlers(handlers, {
            body: {
                action: 'archive',
                uids: ['bulk-dummy-1', 'bulk-dummy-2', 'bulk-dummy-3', 'bootstrap-admin-uid', 'missing-uid']
            }
        }, res);

        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._json.processedCount, 3);
        assert.strictEqual(res._json.skippedCount, 2);
        assert.strictEqual(usersStore.get('bulk-dummy-1').archived, true);
        assert.strictEqual(usersStore.get('bulk-dummy-3').archived, true);
        assert.ok(!usersStore.get('bootstrap-admin-uid').archived, 'Bootstrap admin must be skipped, not archived');

        const skipCodes = res._json.skipped.map((s) => s.error).sort();
        assert.deepStrictEqual(skipCodes, ['ACCOUNT_NOT_FOUND', 'BOOTSTRAP_ADMIN_PROTECTED']);
        console.log('✔ POST /accounts/bulk archives in bulk and reports skipped accounts');
    }

    // 16. POST /accounts/bulk -> deletes many and validates its payload
    {
        const handlers = getRouteHandlers(router, '/accounts/bulk', 'post');

        const badAction = buildRes();
        await runHandlers(handlers, { body: { action: 'nuke', uids: ['bulk-dummy-1'] } }, badAction);
        assert.strictEqual(badAction._status, 400);
        assert.strictEqual(badAction._json.error, 'VALIDATION_ERROR');
        assert.ok(usersStore.has('bulk-dummy-1'), 'Unknown action must not touch any account');

        const emptyUids = buildRes();
        await runHandlers(handlers, { body: { action: 'delete', uids: [] } }, emptyUids);
        assert.strictEqual(emptyUids._status, 400);
        assert.strictEqual(emptyUids._json.error, 'VALIDATION_ERROR');

        const tooMany = buildRes();
        await runHandlers(handlers, {
            body: { action: 'delete', uids: Array.from({ length: 201 }, (_, i) => `over-limit-${i}`) }
        }, tooMany);
        assert.strictEqual(tooMany._status, 400);
        assert.strictEqual(tooMany._json.error, 'VALIDATION_ERROR');

        const res = buildRes();
        await runHandlers(handlers, {
            // Duplicate id proves de-duplication before the per-account loop.
            body: { action: 'delete', uids: ['bulk-dummy-1', 'bulk-dummy-1', 'bulk-dummy-2', 'bulk-dummy-3'] }
        }, res);

        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._json.requestedCount, 3);
        assert.strictEqual(res._json.processedCount, 3);
        assert.strictEqual(res._json.skippedCount, 0);
        assert.strictEqual(usersStore.has('bulk-dummy-1'), false);
        assert.strictEqual(usersStore.has('bulk-dummy-2'), false);
        assert.strictEqual(usersStore.has('bulk-dummy-3'), false);
        console.log('✔ POST /accounts/bulk deletes in bulk, de-duplicates ids and validates payload limits');
    }

    console.log('\nAll Accounts Role Management Unit Tests Passed!');
})().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
