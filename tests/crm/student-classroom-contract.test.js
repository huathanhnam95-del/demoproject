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
const fetchClassroomsBlock = sliceBetween(
  classroomApi,
  'async function fetchClassrooms()',
  'async function fetchAdminClassrooms()'
);

assert(
  fetchClassroomsBlock.includes("fetch('/api/classrooms'"),
  'Expected fetchClassrooms() to call GET /api/classrooms for student-safe listing.'
);

assert(
  !fetchClassroomsBlock.includes("fetch('/api/admin/classrooms'"),
  'fetchClassrooms() must not call admin-only GET /api/admin/classrooms.'
);

// Student classroom UI must accept both id and classroomId to avoid contract drift.
const classroomUi = read('public/js/classroom.js');
assert(
  classroomUi.includes('c.classroomId') && classroomUi.includes('c.id'),
  'Expected student classroom UI to reference both c.id and c.classroomId (compat).'
);

console.log('student classroom contract passed');
