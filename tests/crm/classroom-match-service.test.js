const assert = require('assert');

const {
    buildClassroomMatches,
    scoreClassroomMatch
} = require('../../functions/src/crm/classroom-match-service');

const student = {
    studentId: 'student-1',
    preferredLearningDays: ['Tuesday', 'Thursday'],
    preferredLearningHours: ['19:00-21:00'],
    preferredSchedule: 'Weeknights'
};

const classrooms = [
    {
        classroomId: 'class-weak',
        name: 'Morning IELTS',
        courseId: 'course-1',
        status: 'active',
        meetingDays: ['Monday'],
        meetingHours: ['08:00-10:00']
    },
    {
        classroomId: 'class-best',
        name: 'Evening IELTS',
        courseId: 'course-1',
        status: 'active',
        meetingDays: ['Tuesday', 'Thursday'],
        meetingHours: ['19:00-21:00']
    },
    {
        classroomId: 'class-draft',
        name: 'Draft Class',
        courseId: 'course-1',
        status: 'draft',
        meetingDays: ['Tuesday'],
        meetingHours: ['19:00-21:00']
    }
];

const ranked = buildClassroomMatches({ student, classrooms });

assert.strictEqual(ranked.classroomCount, 2, 'only active classrooms should be ranked');
assert.strictEqual(ranked.matches.length, 2);
assert.strictEqual(ranked.matches[0].classroomId, 'class-best');
assert.strictEqual(ranked.matches[0].recommended, true);
assert.ok(ranked.matches[0].fitScore > ranked.matches[1].fitScore);
assert.ok(ranked.matches[0].reasons.some((reason) => reason.includes('preferred day')));
assert.ok(ranked.matches[0].reasons.some((reason) => reason.includes('preferred hour')));
assert.ok(ranked.matches[1].warnings.length > 0);

const courseFiltered = buildClassroomMatches({
    student,
    classrooms,
    courseId: 'course-1'
});
assert.strictEqual(courseFiltered.matches.length, 2);
assert.strictEqual(courseFiltered.recommendedClassroom.classroomId, 'class-best');

const emptyFiltered = buildClassroomMatches({
    student,
    classrooms,
    courseId: 'course-404'
});
assert.strictEqual(emptyFiltered.matches.length, 0);
assert.strictEqual(emptyFiltered.recommendedClassroom, null);

const directScore = scoreClassroomMatch(student, classrooms[1], { courseId: 'course-1' });
assert.strictEqual(directScore.courseMatch, true);
assert.strictEqual(directScore.dayOverlap.length, 2);
assert.strictEqual(directScore.hourOverlap.length, 1);

const legacyRanked = buildClassroomMatches({
    student: {
        studentId: 'student-legacy',
        preferredSchedule: 'Weeknights'
    },
    classrooms: [
        {
            classroomId: 'class-legacy',
            name: 'IELTS Evening A',
            courseId: 'course-2',
            status: 'active'
        }
    ],
    courseId: 'course-2'
});

assert.strictEqual(legacyRanked.matches.length, 1);
assert.strictEqual(legacyRanked.matches[0].fitScore > 0, true);
assert.deepStrictEqual(legacyRanked.matches[0].hourOverlap, ['19:00-21:00']);

console.log('classroom match service passed');
