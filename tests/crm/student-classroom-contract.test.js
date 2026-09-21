const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert(start !== -1, `Expected to find "${startNeedle}"`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert(end !== -1, `Expected to find "${endNeedle}" after "${startNeedle}"`);
  return source.slice(start, end);
}

// Student ClassroomAPI must not depend on admin-only endpoints.
const classroomApi = read('public/js/classroom-api.js');
const fetchStudentClassroomsBlock = sliceBetween(
  classroomApi,
  'async function fetchStudentClassrooms()',
  'async function fetchCourses()'
);

assert(
  fetchStudentClassroomsBlock.includes("fetch('/api/student/classrooms'"),
  'Expected fetchStudentClassrooms() to call the student-safe listing endpoint.'
);

assert(
  !fetchStudentClassroomsBlock.includes("fetch('/api/admin/classrooms'"),
  'fetchStudentClassrooms() must not call admin-only GET /api/admin/classrooms.'
);

const submitAssignmentBlock = sliceBetween(
  classroomApi,
  'async function submitAssignment(classId, workId, audioBlob)',
  '// Student: Fetch my submissions'
);
assert(
  submitAssignmentBlock.includes('/submissions/upload-intent'),
  'Audio submission must request a server-prepared upload slot.'
);
assert(
  submitAssignmentBlock.indexOf('/submissions/upload-intent') < submitAssignmentBlock.indexOf('storageRef.put(audioBlob)'),
  'Upload slot must be prepared before bytes are written to Storage.'
);
assert(
  submitAssignmentBlock.includes('uploadIntentId'),
  'Submission request must consume the same prepared upload intent.'
);
assert(
  !submitAssignmentBlock.includes("collection('crmSubmissions')"),
  'Student submission must not fall back to a direct Firestore write.'
);

// Student classroom UI must accept both id and classroomId to avoid contract drift.
const classroomUi = read('public/js/classroom.js');
assert(
  classroomUi.includes('c.classroomId') && classroomUi.includes('c.id'),
  'Expected student classroom UI to reference both c.id and c.classroomId (compat).'
);

console.log('student classroom contract passed');
