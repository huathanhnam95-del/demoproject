const assert = require('assert');
const express = require('express');

const registerLeadRoutes = require('../../functions/src/routes/admin/leads');
const registerEntranceTestRoutes = require('../../functions/src/routes/admin/entrance-tests');
const registerStudentRoutes = require('../../functions/src/routes/admin/students');
const { CRM_LEADS, CRM_STUDENTS, ENTRANCE_TESTS } = require('../../functions/src/crm/collections');
const { callRoute, createFakeDb } = require('./route-test-helpers');

function createCrmRouter(db, overrides = {}) {
    const router = express.Router();
    const deps = {
        db,
        requireAdminHandlers: [
            (req, _res, next) => {
                req.user = { uid: 'admin-1', email: 'admin@example.com' };
                next();
            }
        ],
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS',
        writeAuditLog: async () => {},
        ...overrides
    };

    registerLeadRoutes(router, deps);
    registerEntranceTestRoutes(router, deps);
    registerStudentRoutes(router, deps);
    return router;
}

async function testLeadCreationRequiresSource() {
    const db = createFakeDb();
    const router = createCrmRouter(db);

    const response = await callRoute(router, '/leads', 'post', {
        body: {
            name: 'Lead Without Source',
            source: '   '
        }
    });

    assert.strictEqual(response._status, 400);
    assert.strictEqual(response._json.error, 'VALIDATION_ERROR');
    assert.strictEqual(response._json.message, 'Lead source is required.');
    assert.strictEqual(
        Array.from(db.docs.keys()).some((key) => key.startsWith(`${CRM_LEADS}/`)),
        false,
        'Blank-source lead creation must not write a lead document.'
    );
}

async function testLeadEntranceTestConversionKeepsLinkedRecords() {
    const db = createFakeDb({
        [`${CRM_LEADS}/lead-1`]: {
            name: 'Lead Nguyen',
            realName: 'Nguyen Van Lead',
            email: 'lead@example.com',
            phone: '0123',
            source: 'facebook',
            agentSourceId: 'agent-source-1',
            crmId: 'a0001',
            ownerUid: 'admin-1',
            stage: 'contacted',
            probability: 50,
            learningNeeds: 'Needs placement before IELTS class.',
            preferredLearningDays: ['Tuesday', 'Thursday'],
            preferredLearningHours: ['19:00-21:00'],
            createdAt: 'CREATED_TS'
        }
    });
    const router = createCrmRouter(db);

    const createTestRes = await callRoute(router, '/leads/:leadId/entrance-tests', 'post', {
        params: { leadId: 'lead-1' },
        body: { testType: 'segmental_screening_v1' },
        headers: { host: 'crm.local.test' }
    });
    assert.strictEqual(createTestRes._status, 200);
    assert.strictEqual(createTestRes._json.success, true);

    const testLink = createTestRes._json.testLink;
    const token = new URL(testLink).searchParams.get('token');
    const testId = createTestRes._json.testId;
    assert(token && token.length >= 10, 'Expected a reusable delivery token in the generated test link.');

    const createdLead = db.docs.get(`${CRM_LEADS}/lead-1`);
    assert.strictEqual(createdLead.stage, 'test_scheduled');
    assert.strictEqual(createdLead.crmId, 'a0001');

    const createdTest = db.docs.get(`${ENTRANCE_TESTS}/${testId}`);
    assert.strictEqual(createdTest.leadId, 'lead-1');
    assert.strictEqual(createdTest.crmId, 'a0001');
    assert.strictEqual(createdTest.studentId, null);
    assert.strictEqual(createdTest.status, 'created');
    assert.strictEqual(createdTest.testType, 'segmental_screening_v1');
    assert.strictEqual(createdTest.deliveryToken, token);

    const submitRes = await callRoute(router, '/entrance-tests/submit-segmental', 'post', {
        body: {
            token,
            results: { overall: 'b1', pronunciation: 72 },
            contrastSummaries: [{ contrast: '/i/ vs /ɪ/', status: 'watch' }]
        },
        headers: { 'user-agent': 'crm-route-test' }
    });
    assert.strictEqual(submitRes._status, 200);
    assert.strictEqual(submitRes._json.success, true);
    assert.strictEqual(db.docs.get(`${CRM_LEADS}/lead-1`).stage, 'test_completed');
    assert.strictEqual(db.docs.get(`${ENTRANCE_TESTS}/${testId}`).status, 'submitted');

    const convertRes = await callRoute(router, '/leads/:leadId/convert', 'post', {
        params: { leadId: 'lead-1' }
    });
    assert.strictEqual(convertRes._status, 200);
    assert.strictEqual(convertRes._json.success, true);

    const studentId = convertRes._json.student.studentId;
    const convertedLead = db.docs.get(`${CRM_LEADS}/lead-1`);
    const createdStudent = db.docs.get(`${CRM_STUDENTS}/${studentId}`);
    const linkedTest = db.docs.get(`${ENTRANCE_TESTS}/${testId}`);

    assert.strictEqual(convertedLead.stage, 'converted');
    assert.strictEqual(convertedLead.studentId, studentId);
    assert.strictEqual(convertedLead.crmId, 'a0001');
    assert.strictEqual(createdStudent.leadId, 'lead-1');
    assert.strictEqual(createdStudent.crmId, 'a0001');
    assert.strictEqual(createdStudent.agentSourceId, 'agent-source-1');
    assert.strictEqual(createdStudent.acquisitionSource, 'facebook');
    assert.strictEqual(linkedTest.leadId, 'lead-1');
    assert.strictEqual(linkedTest.studentId, studentId);
    assert.strictEqual(linkedTest.crmId, 'a0001');

    const studentTestsRes = await callRoute(router, '/students/:studentId/entrance-tests', 'get', {
        params: { studentId },
        headers: { host: 'crm.local.test' }
    });
    assert.strictEqual(studentTestsRes._status, 200);
    assert.strictEqual(studentTestsRes._json.success, true);
    assert.strictEqual(studentTestsRes._json.tests.length, 1);
    assert.strictEqual(studentTestsRes._json.tests[0].testId, testId);
    assert.strictEqual(studentTestsRes._json.tests[0].studentId, studentId);
    assert.strictEqual(studentTestsRes._json.tests[0].leadId, 'lead-1');
    assert.strictEqual(studentTestsRes._json.tests[0].testLink, testLink);
    assert(studentTestsRes._json.tests[0].resultLink.includes(`testId=${testId}`));
}

(async () => {
    const auditDb = createFakeDb();
    const auditRouter = createCrmRouter(auditDb, { writeAuditLog: async () => { throw new Error('Injected audit outage'); } });
    const savedDespiteAudit = await callRoute(auditRouter, '/leads', 'post', { body: { name: 'Saved lead', source: 'web' } });
    assert.strictEqual(savedDespiteAudit._status, 200, 'An optional audit outage must not report the saved lead as failed.');
    assert(savedDespiteAudit._json.warnings.includes('AUDIT_LOG_FAILED'));
    const studentDespiteAudit = await callRoute(auditRouter, '/students', 'post', { body: { name: 'Saved student' } });
    assert.strictEqual(studentDespiteAudit._status, 200, 'An optional audit outage must not report the saved student as failed.');
    const forged = await callRoute(createCrmRouter(createFakeDb()), '/leads', 'post', { body: { name: 'Invalid', source: 'web', stage: 'converted', studentId: 'forged' } });
    assert.strictEqual(forged._status, 400, 'Creation cannot forge conversion linkage.');
    const invalidTestDb = createFakeDb({ [`${CRM_LEADS}/unallocated`]: { name: 'Local', source: 'web' } });
    const invalidBefore = JSON.stringify([...invalidTestDb.docs]);
    const invalidTest = await callRoute(createCrmRouter(invalidTestDb), '/leads/:leadId/entrance-tests', 'post', { params: { leadId: 'unallocated' }, body: { testType: 'unsupported' } });
    assert.strictEqual(invalidTest._status, 400);
    assert.strictEqual(JSON.stringify([...invalidTestDb.docs]), invalidBefore, 'Invalid test type must not backfill IDs.');
    const testRaceDb = createFakeDb({ [`${CRM_LEADS}/test-race`]: { name: 'Local', source: 'web', crmId: 'a0001', stage: 'new' } });
    const transact = testRaceDb.runTransaction.bind(testRaceDb);
    testRaceDb.runTransaction = async (callback) => {
        // A conversion commits after the route's initial lookup but before its save.
        testRaceDb.docs.set(`${CRM_LEADS}/test-race`, { name: 'Local', source: 'web', crmId: 'a0001', stage: 'converted', studentId: 'converted-student' });
        return transact(callback);
    };
    const racedTest = await callRoute(createCrmRouter(testRaceDb), '/leads/:leadId/entrance-tests', 'post', { params: { leadId: 'test-race' }, body: { testType: 'segmental_screening_v1' }, headers: { host: 'local.test' } });
    assert.strictEqual(racedTest._status, 200);
    assert.strictEqual(testRaceDb.docs.get(`${CRM_LEADS}/test-race`).stage, 'converted');
    assert.strictEqual(testRaceDb.docs.get(`${ENTRANCE_TESTS}/${racedTest._json.testId}`).studentId, 'converted-student');
    const raceDb = createFakeDb({ [`${CRM_LEADS}/race`]: { name: 'Race', source: 'web', crmId: 'a0001' } });
    const raceRouter = createCrmRouter(raceDb);
    const race = await Promise.all([1, 2].map(() => callRoute(raceRouter, '/leads/:leadId/convert', 'post', { params: { leadId: 'race' } })));
    assert(race.every((res) => res._status === 200), 'Concurrent conversions must recover the same saved result.');
    assert.strictEqual([...raceDb.docs.keys()].filter((key) => key.startsWith(`${CRM_STUDENTS}/`)).length, 1, 'Concurrent conversion must create one student.');
    assert.strictEqual(race[0]._json.student.studentId, race[1]._json.student.studentId);
    const retry = await callRoute(raceRouter, '/leads/:leadId/convert', 'post', { params: { leadId: 'race' } });
    assert.strictEqual(retry._status, 200);
    assert.strictEqual(retry._json.student.studentId, race[0]._json.student.studentId);
    const tamper = await callRoute(raceRouter, '/leads/:leadId', 'patch', { params: { leadId: 'race' }, body: { stage: 'new', studentId: null } });
    assert.strictEqual(tamper._status, 400, 'Ordinary patches cannot undo conversion linkage.');
    await testLeadCreationRequiresSource();
    await testLeadEntranceTestConversionKeepsLinkedRecords();
    process.stdout.write('lead entrance conversion route behavior passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
