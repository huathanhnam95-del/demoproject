const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadClassroomApi() {
    const calls = [];
    let nextId = 0;
    const source = fs.readFileSync(path.join(__dirname, '../../public/js/classroom-api.js'), 'utf8');
    const window = {};
    const sandbox = vm.createContext({
        window,
        firebase: undefined,
        crypto: {
            randomUUID() {
                nextId += 1;
                return `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
            }
        },
        fetch: async (url, options = {}) => {
            calls.push({ url, options });
            return {
                ok: true,
                status: 200,
                json: async () => ({ success: true })
            };
        },
        Date,
        JSON,
        Math,
        String,
        Error,
        console
    });
    vm.runInContext(source, sandbox, { filename: 'classroom-api.js' });
    return { api: window.ClassroomAPI, calls };
}

test('exports stable scheduling operation id creation', () => {
    const { api } = loadClassroomApi();

    const operationId = api.createSchedulingOperationId('teacher-add');

    assert.match(operationId, /^sched_teacher-add_[0-9a-z]+_00000000-0000-4000-8000-000000000001$/);
});

test('all interval-changing requests preserve a caller id in body and Idempotency-Key header', async () => {
    const { api, calls } = loadClassroomApi();
    const operationId = 'sched_frontend_retry_0001';
    const payload = { operationId, targetLocalDate: '2026-09-21', targetLocalTime: '09:00' };

    await api.seedClassroomSessions('class-1', payload);
    await api.addClassroomSession('class-1', payload);
    await api.teacherAddClassroomSession('class-1', payload);
    await api.addClassroomSessionBatch('class-1', payload);
    await api.teacherAddClassroomSessionMulti('class-1', payload);
    await api.replaceClassroomSession('class-1', { ...payload, replacedSessionId: 'session-old' });
    await api.rescheduleScheduledSession('session-1', payload);
    await api.teacherRescheduleScheduledSession('session-1', payload);
    await api.teacherRescheduleSessionSeries('session-1', payload);
    await api.teacherBulkRescheduleSessions({ ...payload, moves: [] });
    await api.cancelScheduledSession('session-1', { operationId });
    await api.teacherCancelScheduledSession('session-1', { operationId });
    await api.teacherActivateRecurrences(payload);
    await api.regenerateClassroomSchedule('class-1', payload);

    assert.equal(calls.length, 14);
    for (const call of calls) {
        assert.equal(call.options.headers['Idempotency-Key'], operationId, call.url);
        assert.equal(JSON.parse(call.options.body).operationId, operationId, call.url);
    }
});

test('legacy callers receive a generated operation id before fetch', async () => {
    const { api, calls } = loadClassroomApi();

    await api.teacherAddClassroomSession('class-1', {
        targetLocalDate: '2026-09-21',
        targetLocalTime: '09:00'
    });

    const request = calls[0];
    const body = JSON.parse(request.options.body);
    assert.match(body.operationId, /^sched_teacher-add_/);
    assert.equal(request.options.headers['Idempotency-Key'], body.operationId);
});
