const createTeacherSchedulerRouter = require('../../functions/src/routes/teacher/scheduler');
const { admin, db } = require('../utils/firebase');
const { sendSuccess, sendError } = require('../utils/response-helper');
const teacherAuthMiddleware = require('../middleware/teacher-auth');

module.exports = createTeacherSchedulerRouter({
    db,
    authMiddleware: teacherAuthMiddleware,
    sendSuccess,
    sendError,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
});
