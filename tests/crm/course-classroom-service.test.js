const assert = require('assert');
const {
    buildCourseCreateData,
    buildCoursePatchData,
    buildClassroomCreateData,
    buildClassroomPatchData,
    computeMissingReviewItems,
    mapClassroomMembers
} = require('../../functions/src/crm/course-service');

const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

const course = buildCourseCreateData({
    name: 'PTE Foundation',
    teachers: ['Teacher@One.com', 'teacher2@example.com']
}, context);
assert.strictEqual(course.name, 'PTE Foundation');
assert.deepStrictEqual(course.teachers, ['teacher@one.com', 'teacher2@example.com']);

const patchedCourse = buildCoursePatchData(course, {
    status: 'inactive',
    teachers: ['mentor@example.com']
}, context);
assert.strictEqual(patchedCourse.status, 'inactive');
assert.deepStrictEqual(patchedCourse.teachers, ['mentor@example.com']);

const classroom = buildClassroomCreateData({
    name: 'B1 Evening 2026',
    courseId: 'course-1'
}, context);
assert.strictEqual(classroom.name, 'B1 Evening 2026');
assert.strictEqual(classroom.courseId, 'course-1');

const patchedClassroom = buildClassroomPatchData(classroom, {
    status: 'active'
}, context);
assert.strictEqual(patchedClassroom.status, 'active');
assert.strictEqual(patchedClassroom.updatedBy, 'admin-1');

const members = mapClassroomMembers([
    { id: 'uid-member-1', studentId: 'student-1', studentName: 'Alice' },
    { id: 'uid-member-2', studentId: 'student-2', studentName: 'Bao' }
]);

const missing = computeMissingReviewItems({
    classworks: [
        { id: 'work-1', title: 'Essay Draft' }
    ],
    submissions: [
        { id: 'sub-1', workId: 'work-1', studentUid: 'uid-member-1', status: 'turned-in' },
        { id: 'sub-unrelated', workId: 'work-1', studentUid: 'uid-outsider', status: 'turned-in' }
    ],
    members
});

assert.strictEqual(missing.length, 1);
assert.strictEqual(missing[0].studentUid, 'uid-member-2');
assert.strictEqual(missing[0].studentName, 'Bao');

console.log('course classroom service passed');
