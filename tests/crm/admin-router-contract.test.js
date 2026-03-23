const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

function readFile(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const createCrmRouter = require('../../functions/src/routes/admin/create-crm-router');

const router = createCrmRouter({
    db: {},
    admin: {},
    authMiddleware: (req, res, next) => next(),
    adminMiddleware: (req, res, next) => next(),
    sendSuccess: () => null,
    sendError: () => null,
    getStorageBucket: async () => null,
    identity: {
        generateClassCode: async () => 'ABC123',
        lookupUserByEmail: async () => ({ uid: 'u1' }),
        forceLinkProfile: async () => ({ success: true })
    }
});

const routes = collectRoutes(router);

expectRoute(routes, 'GET /status');
expectRoute(routes, 'GET /students');
expectRoute(routes, 'POST /students');
expectRoute(routes, 'PATCH /students/:studentId');
expectRoute(routes, 'GET /students/:studentId/classroom-matches');
expectRoute(routes, 'GET /courses');
expectRoute(routes, 'POST /courses');
expectRoute(routes, 'PATCH /courses/:courseId');
expectRoute(routes, 'GET /scheduler/workspace');
expectRoute(routes, 'PATCH /classrooms/:classId/schedule-config');
expectRoute(routes, 'POST /classrooms/:classId/sessions/seed');
expectRoute(routes, 'POST /classrooms/:classId/sessions/add-preview');
expectRoute(routes, 'POST /classrooms/:classId/sessions/add-batch');
expectRoute(routes, 'POST /classrooms/:classId/sessions/add');
expectRoute(routes, 'POST /classrooms/:classId/sessions/replace-preview');
expectRoute(routes, 'POST /classrooms/:classId/sessions/replace');
expectRoute(routes, 'POST /classrooms/:classId/schedule/regenerate-preview');
expectRoute(routes, 'POST /classrooms/:classId/schedule/regenerate');
expectRoute(routes, 'PATCH /sessions/:sessionId/reschedule');
expectRoute(routes, 'POST /sessions/:sessionId/cancel');
expectRoute(routes, 'POST /attendance/sessions/open-from-scheduled');
expectRoute(routes, 'POST /students/:studentId/class-code');
expectRoute(routes, 'GET /users/lookup');
expectRoute(routes, 'POST /students/:studentId/force-link');
expectRoute(routes, 'POST /classrooms/:classId/submissions');
expectRoute(routes, 'GET /classrooms/:classId/live-sessions');
expectRoute(routes, 'POST /classrooms/:classId/live-sessions');
expectRoute(routes, 'PATCH /classrooms/:classId/live-sessions/:sessionId');
expectRoute(routes, 'POST /classrooms/:classId/live-sessions/:sessionId/start');
expectRoute(routes, 'POST /classrooms/:classId/live-sessions/:sessionId/end');
expectRoute(routes, 'POST /submissions/:submissionId/return-for-revision');
expectRoute(routes, 'POST /submissions/:submissionId/grade');

for (const relativePath of [
    'functions/src/routes/admin/students.js',
    'functions/src/routes/admin/courses.js',
    'functions/src/routes/admin/identity.js',
    'functions/src/routes/admin/scheduling.js'
]) {
    const source = readFile(relativePath);
    assert(
        source.includes("require('../../crm/collections')"),
        `${relativePath} must import shared CRM collection names.`
    );
}

console.log('crm admin router contract passed');
