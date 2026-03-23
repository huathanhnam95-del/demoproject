const assert = require('assert');

const {
    buildLiveSessionCreateData,
    buildLiveSessionPatchData,
    buildLiveSessionStartPatch,
    buildLiveSessionEndPatch,
    mapLiveSessionRecord,
    sortLiveSessions
} = require('../../functions/src/crm/live-session-service');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStore() {
    const docs = new Map();
    return {
        get(id) {
            return docs.has(id) ? clone(docs.get(id)) : null;
        },
        set(id, data, merge = false) {
            const current = docs.get(id) || {};
            const next = merge ? { ...current, ...clone(data) } : clone(data);
            docs.set(id, next);
            return clone(next);
        },
        list() {
            return Array.from(docs.entries()).map(([id, data]) => ({
                id,
                data: clone(data)
            }));
        }
    };
}

async function main() {
    const context = {
        user: {
            uid: 'admin-1',
            email: 'admin@example.com'
        },
        serverTimestamp: () => 'SERVER_TS'
    };

    const store = createStore();

    const scheduled = buildLiveSessionCreateData({
        classId: 'class-1',
        courseId: 'course-1',
        title: 'IELTS Morning A - Session 2',
        status: 'scheduled',
        meetingUrl: 'https://zoom.us/j/123456789',
        scheduledStartAt: '2026-03-25T08:00:00.000Z',
        scheduledEndAt: '2026-03-25T10:00:00.000Z'
    }, context);
    store.set('session-2', scheduled);

    const draft = buildLiveSessionCreateData({
        classId: 'class-1',
        title: 'IELTS Morning A - Session 1'
    }, context);
    store.set('session-1', draft);

    const draftPatch = buildLiveSessionPatchData(store.get('session-1'), {
        status: 'scheduled',
        meetingUrl: 'https://zoom.us/j/111111111',
        scheduledStartAt: '2026-03-24T08:00:00.000Z'
    }, context);
    store.set('session-1', draftPatch, true);

    const listed = sortLiveSessions(store.list().map((row) => mapLiveSessionRecord({
        id: row.id,
        data() {
            return row.data;
        }
    }, row.id)));
    assert.strictEqual(listed.length, 2);
    assert.strictEqual(listed[0].sessionId, 'session-2');

    const livePatch = buildLiveSessionStartPatch(store.get('session-2'), context);
    store.set('session-2', livePatch, true);
    assert.strictEqual(store.get('session-2').status, 'live');
    assert.strictEqual(store.get('session-2').startedAt, 'SERVER_TS');

    const endedPatch = buildLiveSessionEndPatch(store.get('session-2'), context);
    store.set('session-2', endedPatch, true);
    assert.strictEqual(store.get('session-2').status, 'ended');
    assert.strictEqual(store.get('session-2').endedAt, 'SERVER_TS');

    const finalList = sortLiveSessions(store.list().map((row) => mapLiveSessionRecord({
        id: row.id,
        data() {
            return row.data;
        }
    }, row.id)));
    assert.strictEqual(finalList[0].status, 'ended');
    assert.strictEqual(finalList[1].status, 'scheduled');
    assert.strictEqual(finalList[0].isEnded, true);
    assert.strictEqual(finalList[1].isUpcoming, true);

    console.log('live sessions smoke passed');
}

main().catch((error) => {
    console.error('live sessions smoke failed:', error);
    process.exitCode = 1;
});
