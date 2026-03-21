const assert = require('assert');

const {
    hydrateStudentSchedule,
    hydrateClassroomSchedule
} = require('../../functions/src/crm/schedule-normalizer');

const student = hydrateStudentSchedule({
    preferredSchedule: 'Weeknights | Days: Tue, Thu | Hours: 19:00-21:00'
});

assert.deepStrictEqual(student.preferredLearningDays, ['Tuesday', 'Thursday']);
assert.deepStrictEqual(student.preferredLearningHours, ['19:00-21:00']);
assert.strictEqual(student.preferredSchedule, 'Weeknights | Days: Tue, Thu | Hours: 19:00-21:00');

const classroom = hydrateClassroomSchedule({
    name: 'IELTS Evening A'
});

assert.deepStrictEqual(classroom.meetingDays, []);
assert.deepStrictEqual(classroom.meetingHours, ['19:00-21:00']);

const explicitClassroom = hydrateClassroomSchedule({
    name: 'Morning Class',
    meetingDays: ['Monday', 'Wednesday'],
    meetingHours: ['08:00-10:00']
});

assert.deepStrictEqual(explicitClassroom.meetingDays, ['Monday', 'Wednesday']);
assert.deepStrictEqual(explicitClassroom.meetingHours, ['08:00-10:00']);

console.log('schedule normalizer passed');
