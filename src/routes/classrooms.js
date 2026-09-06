const createStudentClassroomsRouter = require('../../functions/src/routes/student/classrooms');
const requireAuth = require('../middleware/require-auth');
const { db } = require('../utils/firebase');
const { sendError, sendSuccess } = require('../utils/response-helper');

module.exports = createStudentClassroomsRouter({
    db,
    authMiddleware: requireAuth,
    sendSuccess,
    sendError
});

