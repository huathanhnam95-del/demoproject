const assert = require('assert');
const createCrmRouter = require('../../functions/src/routes/admin/create-crm-router');
const {
    CRM_CLASSROOMS,
    CRM_ENROLLMENTS,
    CRM_STUDENTS,
    CRM_SUBMISSIONS,
    CLASSROOM_CLASSWORK,
    CLASSROOM_MEMBERS
} = require('../../functions/src/crm/collections');

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
    const layer = (router.stack || []).find((entry) => entry.route && entry.route.path === path);
    assert(layer, `Route ${path} not found`);
    return (layer.route.stack || [])
        .filter((step) => step.method === method)
        .map((step) => step.handle);
}

(async () => {
    const classId = 'class-1';
    const studentId = 'student-1';
    const studentUid = 'uid-student-1';
    const workId = 'work-1';

    const db = {
        collection(name) {
            if (name === CRM_SUBMISSIONS) {
                return {
                    where(field, op, value) {
                        assert.strictEqual(field, 'classId');
                        assert.strictEqual(op, '==');
                        assert.strictEqual(value, classId);
                        return {
                            async get() {
                                return {
                                    docs: [
                                        {
                                            id: 'submission-1',
                                            data: () => ({
                                                classId,
                                                workId,
                                                studentUid,
                                                status: 'turned-in'
                                            })
                                        }
                                    ]
                                };
                            }
                        };
                    }
                };
            }

            if (name === CRM_ENROLLMENTS) {
                return {
                    where(field, op, value) {
                        assert.strictEqual(field, 'classId');
                        assert.strictEqual(op, '==');
                        assert.strictEqual(value, classId);
                        return {
                            async get() {
                                return {
                                    docs: [
                                        {
                                            id: 'enrollment-1',
                                            data: () => ({
                                                classId,
                                                studentId,
                                                studentUid: null,
                                                studentName: 'Student One',
                                                status: 'active'
                                            })
                                        }
                                    ]
                                };
                            }
                        };
                    }
                };
            }

            if (name === CRM_STUDENTS) {
                return {
                    doc(id) {
                        assert.strictEqual(id, studentId);
                        return {
                            async get() {
                                return {
                                    exists: true,
                                    data: () => ({
                                        name: 'Student One',
                                        linked_user_ids: [studentUid]
                                    })
                                };
                            }
                        };
                    }
                };
            }

            if (name === CRM_CLASSROOMS) {
                return {
                    doc(id) {
                        assert.strictEqual(id, classId);
                        return {
                            collection(subcollectionName) {
                                if (subcollectionName === CLASSROOM_CLASSWORK) {
                                    return {
                                        async get() {
                                            return {
                                                docs: [
                                                    {
                                                        id: workId,
                                                        data: () => ({ title: 'Essay Draft' })
                                                    }
                                                ]
                                            };
                                        }
                                    };
                                }

                                if (subcollectionName === CLASSROOM_MEMBERS) {
                                    return {
                                        async get() {
                                            return { docs: [] };
                                        }
                                    };
                                }

                                throw new Error(`Unexpected subcollection ${subcollectionName}`);
                            }
                        };
                    }
                };
            }

            throw new Error(`Unexpected collection ${name}`);
        }
    };

    const router = createCrmRouter({
        db,
        admin: {},
        authMiddleware: (_req, _res, next) => next(),
        adminMiddleware: (_req, _res, next) => next(),
        sendSuccess: (res, data) => res.status(200).json({ success: true, ...data }),
        sendError: (res, status, error, message) => res.status(status).json({ success: false, error, message }),
        identity: {
            generateClassCode: async () => 'ABC123',
            lookupUserByEmail: async () => ({ uid: 'u2' }),
            forceLinkProfile: async () => ({ success: true })
        }
    });

    const handlers = getRouteHandlers(router, '/classrooms/:classId/review-board', 'get');
    assert(handlers.length >= 2, 'Expected auth middleware + route handler.');

    const req = { params: { classId }, user: { uid: 'admin-1', email: 'admin@example.com' } };
    const res = buildRes();

    await new Promise((resolve, reject) => {
        handlers[0](req, res, (err) => (err ? reject(err) : resolve()));
    });
    await handlers[handlers.length - 1](req, res);

    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.success, true);
    assert.strictEqual(Array.isArray(res._json.members), true);
    assert.strictEqual(res._json.members.length, 1);
    assert.strictEqual(res._json.members[0].memberUid, studentUid);
    assert.strictEqual(res._json.missing.length, 0);

    console.log('crm review board fallback passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});

