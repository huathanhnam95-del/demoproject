const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(relativePath) {
    const fullPath = path.join(process.cwd(), relativePath);
    assert(fs.existsSync(fullPath), `Expected file to exist: ${relativePath}`);
    return fs.readFileSync(fullPath, 'utf8');
}

function assertNoBareCoursesCollection(relativePath) {
    const source = read(relativePath);
    const bareCollectionPattern = /\.collection\((['"])courses\1\)/;
    assert(
        !bareCollectionPattern.test(source),
        `${relativePath} must not read the legacy Firestore "courses" collection.`
    );
}

const courseRouteSource = read('functions/src/routes/admin/courses.js');
assert(
    courseRouteSource.includes('CRM_COURSES'),
    'Course route module must use the shared CRM_COURSES constant.'
);

const classroomApiSource = read('public/js/classroom-api.js');
assert(
    classroomApiSource.includes('crmCourses'),
    'Classroom API must read crmCourses for classroom-linked course data.'
);

const crmCoursesSource = read('public/js/crm/courses.js');
assert(
    crmCoursesSource.includes('crmCourses'),
    'CRM course browser module must read crmCourses.'
);

const crmAdminSource = read('public/crm-admin.js');
assert(
    crmAdminSource.includes('fetchCourses') || crmAdminSource.includes('crmCourses'),
    'CRM admin page must populate course UI from crmCourses-backed helpers.'
);

assertNoBareCoursesCollection('public/js/classroom-api.js');
assertNoBareCoursesCollection('public/js/crm/courses.js');
assertNoBareCoursesCollection('public/crm-admin.js');

const migrationScriptSource = read('scripts/crm/migrate-courses-to-crmCourses.js');
assert(
    migrationScriptSource.includes("collection('courses')") || migrationScriptSource.includes('collection("courses")') || migrationScriptSource.includes('LEGACY_COLLECTION'),
    'Migration script must read from the legacy courses collection.'
);
assert(
    migrationScriptSource.includes("collection('crmCourses')") || migrationScriptSource.includes('collection("crmCourses")') || migrationScriptSource.includes('CRM_COURSES'),
    'Migration script must upsert into crmCourses.'
);

console.log('crm collection contracts passed');
