const assert = require('assert');

const {
    LIVE_SESSION_STATUSES,
    buildLiveSessionCreateData,
    buildLiveSessionPatchData,
    buildLiveSessionStartPatch,
    buildLiveSessionEndPatch,
    mapLiveSessionRecord
} = require('../../functions/src/crm/live-session-service');

const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

assert.deepStrictEqual(
    LIVE_SESSION_STATUSES,
    ['draft', 'scheduled', 'live', 'ended', 'cancelled']
);

const scheduledSession = buildLiveSessionCreateData({
    classId: 'class-1',
    courseId: 'course-1',
    title: 'IELTS Morning A - Session 1',
    status: 'scheduled',
    meetingUrl: 'https://zoom.us/j/123456789',
    hostUrl: 'https://zoom.us/s/123456789?zak=abc',
    meetingId: '123 456 789',
    passcode: 'PASS123',
    scheduledStartAt: '2026-03-21T08:00:00.000Z',
    scheduledEndAt: '2026-03-21T10:00:00.000Z',
    notes: 'Please join five minutes early.'
}, context);

assert.strictEqual(scheduledSession.classId, 'class-1');
assert.strictEqual(scheduledSession.courseId, 'course-1');
assert.strictEqual(scheduledSession.provider, 'zoom');
assert.strictEqual(scheduledSession.status, 'scheduled');
assert.strictEqual(scheduledSession.meetingUrl, 'https://zoom.us/j/123456789');
assert.strictEqual(scheduledSession.scheduledStartAt, '2026-03-21T08:00:00.000Z');
assert.strictEqual(scheduledSession.createdAt, 'SERVER_TS');
assert.strictEqual(scheduledSession.createdBy, 'admin-1');
assert.strictEqual(scheduledSession.updatedBy, 'admin-1');

assert.throws(() => buildLiveSessionCreateData({
    classId: 'class-1',
    title: 'Missing url',
    status: 'scheduled',
    scheduledStartAt: '2026-03-21T08:00:00.000Z'
}, context), /meetingUrl/i);

assert.throws(() => buildLiveSessionCreateData({
    classId: 'class-1',
    title: 'Missing start',
    status: 'scheduled',
    meetingUrl: 'https://zoom.us/j/000'
}, context), /scheduledStartAt/i);

const draftSession = buildLiveSessionCreateData({
    classId: 'class-1',
    title: 'Draft session'
}, context);

const scheduledPatch = buildLiveSessionPatchData(draftSession, {
    status: 'scheduled',
    meetingUrl: 'https://zoom.us/j/987654321',
    scheduledStartAt: '2026-03-22T08:00:00.000Z'
}, context);

assert.strictEqual(scheduledPatch.status, 'scheduled');
assert.strictEqual(scheduledPatch.meetingUrl, 'https://zoom.us/j/987654321');
assert.strictEqual(scheduledPatch.updatedAt, 'SERVER_TS');

assert.throws(() => buildLiveSessionPatchData({
    ...scheduledSession,
    status: 'ended'
}, {
    status: 'live'
}, context), /transition/i);

const livePatch = buildLiveSessionStartPatch(scheduledSession, context);
assert.strictEqual(livePatch.status, 'live');
assert.strictEqual(livePatch.startedAt, 'SERVER_TS');
assert.strictEqual(livePatch.updatedAt, 'SERVER_TS');

assert.throws(() => buildLiveSessionStartPatch({
    ...scheduledSession,
    status: 'ended'
}, context), /scheduled/i);

const endedPatch = buildLiveSessionEndPatch({
    ...scheduledSession,
    status: 'live',
    startedAt: '2026-03-21T08:01:00.000Z'
}, context);
assert.strictEqual(endedPatch.status, 'ended');
assert.strictEqual(endedPatch.endedAt, 'SERVER_TS');
assert.strictEqual(endedPatch.updatedAt, 'SERVER_TS');

assert.throws(() => buildLiveSessionEndPatch(scheduledSession, context), /live/i);

const mapped = mapLiveSessionRecord({
    id: 'session-1',
    data() {
        return scheduledSession;
    }
}, 'session-1');

assert.strictEqual(mapped.sessionId, 'session-1');
assert.strictEqual(mapped.classId, 'class-1');
assert.strictEqual(mapped.status, 'scheduled');
assert.strictEqual(mapped.isUpcoming, true);
assert.strictEqual(mapped.isLive, false);
assert.strictEqual(mapped.isEnded, false);

console.log('live session service passed');
