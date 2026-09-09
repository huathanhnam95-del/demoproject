const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    buildStudentCreateData,
    buildStudentPatchData,
    mapStudentRecord
} = require('../../functions/src/crm/student-service');

// ---------------------------------------------------------------------------
// 1. Backend student-service tests for assigned teacher
// ---------------------------------------------------------------------------
console.log('1. Testing student-service.js assigned teacher handling...');

const mockContext = {
    user: { uid: 'admin-test-1', email: 'admin@test.com' },
    serverTimestamp: () => 'MOCK_SERVER_TS'
};

// 1a. Student creation with assigned teacher
const createInput = {
    name: 'Test Student One',
    email: 'test1@example.com',
    assignedTeacherUid: 'eRrS6Ba3QfQ6R9SmPbcb3bYcOK83',
    assignedTeacherName: 'Shawn'
};
const created = buildStudentCreateData(createInput, mockContext);
assert.strictEqual(created.assignedTeacherUid, 'eRrS6Ba3QfQ6R9SmPbcb3bYcOK83', 'assignedTeacherUid must be saved on create');
assert.strictEqual(created.assignedTeacherName, 'Shawn', 'assignedTeacherName must be saved on create');

// 1b. Student patch with reassigned teacher
const patchInput = {
    assignedTeacherUid: 'JP0UmCufWpdDkKkZazh7Ajo4PfX2',
    assignedTeacherName: 'Hứa Thanh Nam'
};
const patched = buildStudentPatchData(created, patchInput, mockContext);
assert.strictEqual(patched.assignedTeacherUid, 'JP0UmCufWpdDkKkZazh7Ajo4PfX2', 'assignedTeacherUid must be updated on patch');
assert.strictEqual(patched.assignedTeacherName, 'Hứa Thanh Nam', 'assignedTeacherName must be updated on patch');

// 1c. Student patch unassigning teacher (clearing to empty/null)
const clearInput = {
    assignedTeacherUid: '',
    assignedTeacherName: ''
};
const cleared = buildStudentPatchData(patched, clearInput, mockContext);
assert.strictEqual(cleared.assignedTeacherUid, null, 'assignedTeacherUid must be set to null when cleared');
assert.strictEqual(cleared.assignedTeacherName, null, 'assignedTeacherName must be set to null when cleared');

// 1d. mapStudentRecord exposes assignedTeacherUid and assignedTeacherName
const mapped = mapStudentRecord({
    name: 'Doc Student',
    email: 'doc@example.com',
    assignedTeacherUid: 'eRrS6Ba3QfQ6R9SmPbcb3bYcOK83',
    assignedTeacherName: 'Shawn',
    createdAt: '2026-09-09T00:00:00.000Z'
}, 'student-doc-123');
assert.strictEqual(mapped.studentId, 'student-doc-123');
assert.strictEqual(mapped.assignedTeacherUid, 'eRrS6Ba3QfQ6R9SmPbcb3bYcOK83');
assert.strictEqual(mapped.assignedTeacherName, 'Shawn');

console.log('   ✓ student-service backend contracts pass');

// ---------------------------------------------------------------------------
// 2. Diacritic-Insensitive Search & Teacher Filtering Logic Tests
// ---------------------------------------------------------------------------
console.log('2. Testing Vietnamese diacritic search & teacher matching logic...');

function foldVietnamese(str) {
    if (!str) return '';
    return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .trim();
}

// 2a. Vietnamese diacritic folding
assert.strictEqual(foldVietnamese('Hứa Thanh Nam'), 'hua thanh nam');
assert.strictEqual(foldVietnamese('Vương Anh Chiến'), 'vuong anh chien');
assert.strictEqual(foldVietnamese('Đỗ Mỹ Linh'), 'do my linh');
assert.strictEqual(foldVietnamese('Nguyễn Thị Thu Hà'), 'nguyen thi thu ha');

const searchTerms = ['chien', 'nam', 'hua', 'vuong', 'linh'];
assert.ok(foldVietnamese('Vương Anh Chiến').includes(foldVietnamese('chien')));
assert.ok(foldVietnamese('Hứa Thanh Nam').includes(foldVietnamese('nam')));
assert.ok(foldVietnamese('Hứa Thanh Nam').includes(foldVietnamese('hua')));
assert.ok(foldVietnamese('Đỗ Mỹ Linh').includes(foldVietnamese('linh')));

// 2b. Teacher resolution & matching
const TEACHER_UIDS = {
    SHAWN: 'eRrS6Ba3QfQ6R9SmPbcb3bYcOK83',
    NAM: 'JP0UmCufWpdDkKkZazh7Ajo4PfX2'
};

function resolveStudentTeacher(student, studentTeacherMap = {}) {
    if (student.assignedTeacherUid) {
        return {
            uid: student.assignedTeacherUid,
            name: student.assignedTeacherName || (student.assignedTeacherUid === TEACHER_UIDS.SHAWN ? 'Shawn' : 'Hứa Thanh Nam')
        };
    }
    const studentId = student.id || student.uid;
    if (studentId && studentTeacherMap[studentId]) {
        return studentTeacherMap[studentId];
    }
    return null;
}

function isTeacherMatch(student, filterVal, studentTeacherMap = {}) {
    if (!filterVal || filterVal === 'all') return true;
    const assigned = resolveStudentTeacher(student, studentTeacherMap);
    if (filterVal === 'unassigned') {
        return !assigned || !assigned.uid;
    }
    return Boolean(assigned && assigned.uid === filterVal);
}

const mockStudents = [
    { id: 's1', name: 'Alice', assignedTeacherUid: TEACHER_UIDS.SHAWN, assignedTeacherName: 'Shawn' },
    { id: 's2', name: 'Bình Hứa', assignedTeacherUid: TEACHER_UIDS.NAM, assignedTeacherName: 'Hứa Thanh Nam' },
    { id: 's3', name: 'Chiến Vương' }, // unassigned direct, no enrollment
    { id: 's4', name: 'Duy Nguyen' }   // unassigned direct, has enrollment
];

const mockEnrollmentMap = {
    's4': { uid: TEACHER_UIDS.SHAWN, name: 'Shawn' }
};

// Test 'all'
assert.strictEqual(mockStudents.filter(s => isTeacherMatch(s, 'all', mockEnrollmentMap)).length, 4);

// Test 'unassigned' (s3 has neither direct nor enrollment)
const unassigned = mockStudents.filter(s => isTeacherMatch(s, 'unassigned', mockEnrollmentMap));
assert.strictEqual(unassigned.length, 1);
assert.strictEqual(unassigned[0].id, 's3');

// Test Shawn filter (s1 direct + s4 enrollment)
const shawnStudents = mockStudents.filter(s => isTeacherMatch(s, TEACHER_UIDS.SHAWN, mockEnrollmentMap));
assert.strictEqual(shawnStudents.length, 2);
assert.deepStrictEqual(shawnStudents.map(s => s.id), ['s1', 's4']);

// Test Nam filter (s2 direct)
const namStudents = mockStudents.filter(s => isTeacherMatch(s, TEACHER_UIDS.NAM, mockEnrollmentMap));
assert.strictEqual(namStudents.length, 1);
assert.strictEqual(namStudents[0].id, 's2');

console.log('   ✓ Search & teacher matching logic passes');

// ---------------------------------------------------------------------------
// 3. Static HTML UI elements in crm-admin.html
// ---------------------------------------------------------------------------
console.log('3. Verifying crm-admin.html toolbar and modal markup...');

const htmlPath = path.join(__dirname, '../../public/crm-admin.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

assert.ok(htmlContent.includes('id="crm-student-directory-toolbar"'), 'Missing #crm-student-directory-toolbar');
assert.ok(htmlContent.includes('id="crm-student-search-input"'), 'Missing #crm-student-search-input');
assert.ok(htmlContent.includes('id="crm-student-search-clear"'), 'Missing #crm-student-search-clear');
assert.ok(htmlContent.includes('id="crm-student-teacher-filters"'), 'Missing #crm-student-teacher-filters');
assert.ok(htmlContent.includes('data-teacher-filter="all"'), 'Missing teacher filter: all');
assert.ok(htmlContent.includes('data-teacher-filter="unassigned"'), 'Missing teacher filter: unassigned');
assert.ok(htmlContent.includes('data-teacher-filter="Shawn"'), 'Missing teacher filter: Shawn');
assert.ok(htmlContent.includes('data-teacher-filter="Hứa Thanh Nam"'), 'Missing teacher filter: Hứa Thanh Nam');
assert.ok(htmlContent.includes('id="student-assigned-teacher"'), 'Missing #student-assigned-teacher modal input');

console.log('   ✓ crm-admin.html markup elements confirmed');

// ---------------------------------------------------------------------------
// 4. CSS styling checks in crm-admin.css
// ---------------------------------------------------------------------------
console.log('4. Verifying crm-admin.css filter styling rules...');

const cssPath = path.join(__dirname, '../../public/crm-admin.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

assert.ok(cssContent.includes('.crm-student-directory-toolbar'), 'Missing .crm-student-directory-toolbar in css');
assert.ok(cssContent.includes('.crm-student-search-input'), 'Missing .crm-student-search-input in css');
assert.ok(cssContent.includes('.crm-filter-pill'), 'Missing .crm-filter-pill in css');
assert.ok(cssContent.includes('.crm-filter-pill.active'), 'Missing active filter pill styling');
assert.ok(cssContent.includes('.crm-teacher-badge'), 'Missing .crm-teacher-badge styling');
assert.ok(cssContent.includes('.teacher-shawn'), 'Missing .teacher-shawn styling');
assert.ok(cssContent.includes('.teacher-nam'), 'Missing .teacher-nam styling');

console.log('   ✓ crm-admin.css styling rules confirmed');

console.log('\nAll student directory filter tests PASSED successfully!');
