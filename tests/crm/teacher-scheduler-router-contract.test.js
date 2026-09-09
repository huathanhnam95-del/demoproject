const assert = require('assert');
const createTeacherSchedulerRouter = require('../../functions/src/routes/teacher/scheduler');

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

const router = createTeacherSchedulerRouter({
    db: {},
    authMiddleware: (req, res, next) => next(),
    sendSuccess: () => null,
    sendError: () => null,
    serverTimestamp: () => new Date()
});

const routes = collectRoutes(router);
expectRoute(routes, 'GET /status');
expectRoute(routes, 'GET /scheduler/workspace');
expectRoute(routes, 'POST /classrooms/:classId/sessions/add');
expectRoute(routes, 'POST /classrooms/:classId/sessions/add-multi');
expectRoute(routes, 'PATCH /sessions/:sessionId/reschedule');
expectRoute(routes, 'POST /sessions/:sessionId/reschedule-series');
expectRoute(routes, 'POST /sessions/:sessionId/cancel');
expectRoute(routes, 'POST /sessions/:sessionId/outcome');
expectRoute(routes, 'POST /scheduler/activate-recurrences');
expectRoute(routes, 'POST /scheduler/sessions/bulk-reschedule');

console.log('teacher scheduler router contract passed');
