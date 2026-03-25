const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const html = read('public/crm-admin.html');
const js = read('public/crm-admin.js');
const packageJson = JSON.parse(read('package.json'));

const panelIds = new Set(Array.from(html.matchAll(/data-panel="([^"]+)"/g), (match) => match[1]));

for (const match of html.matchAll(/<button[^>]*data-main="([^"]+)"([^>]*)>/g)) {
    const main = match[1];
    const attrs = match[2];
    const hasPanel = panelIds.has(main) || Array.from(panelIds).some((panelId) => panelId.startsWith(`${main}/`));
    const explicitlyDisabled = attrs.includes('disabled') || attrs.includes('data-coming-soon="true"');
    assert(
        hasPanel || explicitlyDisabled,
        `Main nav item "${main}" must have a backing panel or be explicitly disabled/coming soon.`
    );
}

for (const match of html.matchAll(/<button[^>]*data-sub="([^"]+)"([^>]*)>/g)) {
    const sub = match[1];
    const attrs = match[2];
    const panelId = `courses/${sub}`;
    const explicitlyDisabled = attrs.includes('disabled') || attrs.includes('data-coming-soon="true"');
    assert(
        panelIds.has(panelId) || explicitlyDisabled,
        `Dropdown item "${panelId}" must have a backing panel or be explicitly disabled/coming soon.`
    );
}

assert(
    html.includes('firebase-app-compat.js'),
    'CRM admin page must load firebase-app-compat.'
);
assert(
    html.includes('firebase-auth-compat.js'),
    'CRM admin page must load firebase-auth-compat.'
);
assert(
    html.includes('firebase-firestore-compat.js'),
    'CRM admin page must load firebase-firestore-compat.'
);
assert(
    html.includes('firebase-storage-compat.js'),
    'CRM admin page must load firebase-storage-compat.'
);
assert(
    html.includes('js/crm/finance-workflow.js') &&
    html.indexOf('js/crm/finance-workflow.js') < html.indexOf('js/crm/finance.js'),
    'CRM admin page must load the shared finance workflow helper before finance.js.'
);
assert(
    html.includes('js/crm/student-finance.js') &&
    html.indexOf('js/crm/student-finance.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the student finance helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/live-delivery.js') &&
    html.indexOf('js/crm/live-delivery.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the live delivery helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/classroom-modal.js') &&
    html.indexOf('js/crm/classroom-modal.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the classroom modal helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/student-modal.js') &&
    html.indexOf('js/crm/student-modal.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the student modal helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/course-modal.js') &&
    html.indexOf('js/crm/course-modal.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the course modal helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/lead-workspace.js') &&
    html.indexOf('js/crm/lead-workspace.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the lead workspace helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/classroom-workspace.js') &&
    html.indexOf('js/crm/classroom-workspace.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the classroom workspace helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/student-workspace.js') &&
    html.indexOf('js/crm/student-workspace.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the student workspace helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/task-activity-workspace.js') &&
    html.indexOf('js/crm/task-activity-workspace.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the task activity workspace helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/communications-workspace.js') &&
    html.indexOf('js/crm/communications-workspace.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the communications workspace helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/dashboard-workspace.js') &&
    html.indexOf('js/crm/dashboard-workspace.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the dashboard workspace helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/student-directory-workspace.js') &&
    html.indexOf('js/crm/student-directory-workspace.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the student directory workspace helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/activity-surfaces.js') &&
    html.indexOf('js/crm/activity-surfaces.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the activity surfaces helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/classroom-workspace.js') &&
    html.indexOf('js/crm/classroom-workspace.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the classroom workspace helper before crm-admin.js.'
);
assert(
    html.includes('student-classroom-match-summary') &&
    html.includes('btn-create-recommended-enrollment'),
    'CRM admin page must render the classroom recommendation panel.'
);
assert(
    html.includes('student-preferred-learning-days') &&
    html.includes('student-preferred-learning-hours') &&
    html.includes('student-schedule-prompt') &&
    html.includes('classroom-meeting-days') &&
    html.includes('classroom-meeting-hours') &&
    html.includes('attendance-schedule-prompt'),
    'CRM admin page must expose structured schedule inputs for students and classrooms.'
);
assert(
    html.includes('btn-open-entrance-test-link') &&
    html.includes('entrance-test-link-note'),
    'CRM admin page must expose clear entrance-test handoff controls and status messaging.'
);
assert(
    html.includes('js/crm/entrance-test-link-state.js') &&
    html.indexOf('js/crm/entrance-test-link-state.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the shared entrance-test link helper before crm-admin.js.'
);
assert(
    html.includes('data-panel="courses/zoom-links"') &&
    html.includes('classroom-live') &&
    html.includes('live-session-list') &&
    html.includes('btn-create-live-session') &&
    html.includes('btn-save-live-session') &&
    html.includes('btn-start-live-session') &&
    html.includes('btn-end-live-session') &&
    html.includes('attendance-live-session-note') &&
    html.includes('classwork-live-session-note') &&
    html.includes('attendance-classroom-fit-note'),
    'CRM admin page must expose the live delivery panel and live-session controls.'
);
assert(
    js.includes('let studentFinanceController = null;') &&
    js.includes('studentFinanceController = window.CrmStudentFinance') &&
    js.includes('let studentModalController = null;') &&
    js.includes('studentModalController = window.CrmStudentModal') &&
    js.includes('elements.btnCreateRecommendedEnrollment = document.getElementById(\'btn-create-recommended-enrollment\')') &&
    js.includes('elements.inputPreferredLearningDays = document.getElementById(\'student-preferred-learning-days\')') &&
    js.includes('elements.studentSchedulePrompt = document.getElementById(\'student-schedule-prompt\')') &&
    js.includes('function renderStudentSchedulePrompt()') &&
    js.includes('async function createRecommendedEnrollment()'),
    'crm-admin.js must bind the finance recommendation controls and delegate them through the student finance helper.'
);
assert(
    js.includes('let liveDeliveryController = null;') &&
    js.includes('liveDeliveryController = window.CrmLiveDelivery') &&
    js.includes('let classroomModalController = null;') &&
    js.includes('classroomModalController = window.CrmClassroomModal') &&
    js.includes('elements.btnCreateLiveSession = document.getElementById(\'btn-create-live-session\')') &&
    js.includes('elements.inputClassroomMeetingDays = document.getElementById(\'classroom-meeting-days\')') &&
    js.includes('elements.attendanceSchedulePrompt = document.getElementById(\'attendance-schedule-prompt\')') &&
    js.includes('function renderClassroomSchedulePrompt()') &&
    js.includes('async function loadLiveSessions(classId, options = {})') &&
    js.includes('async function saveLiveSession()') &&
    js.includes('async function startSelectedLiveSession()') &&
    js.includes('async function endSelectedLiveSession()'),
    'crm-admin.js must bind and implement the live-delivery session workflow in the active shell.'
);
assert(
    js.includes('async function refreshAttendanceRiskSnapshot()'),
    'crm-admin.js must define the shared attendance risk snapshot helper required during shell init and classroom updates.'
);
assert(
    js.includes('function renderTaskList(') &&
    js.includes('function renderActivityList('),
    'crm-admin.js must define shared task/activity renderers required by the lead and student workspace controllers.'
);
assert(
    js.includes('function renderEntranceTests(') &&
    js.includes('btnOpenEntranceTestLink') &&
    js.includes('entranceTestLinkNote'),
    'crm-admin.js must keep entrance-test link rendering and handoff messaging wired into the student workflow.'
);
assert(
    js.includes('window.CrmEntranceTests') &&
    js.includes('entranceTestUi.applyControls'),
    'crm-admin.js must use the shared entrance-test helper for link state synchronization.'
);
assert(
    js.includes('function formatDateTime(') &&
    js.includes('function formatDateTimeLocalValue(ts)'),
    'crm-admin.js must define shared date formatting helpers required by extracted CRM controllers.'
);

assert(
    html.includes('id="scheduler-workspace"'),
    'CRM admin page must expose the scheduler workspace container in courses/classes.'
);
assert(
    html.includes('id="scheduler-calendar"'),
    'CRM admin page must expose the scheduler calendar surface.'
);
assert(
    html.includes('id="scheduler-class-rail"'),
    'CRM admin page must expose the scheduler right rail for draggable class cards.'
);
assert(
    html.includes('id="course-total-hours"') &&
    html.includes('id="course-default-session-minutes"') &&
    html.includes('id="course-timezone"'),
    'Course modal must expose delivery template scheduling fields.'
);
assert(
    html.includes('id="classroom-primary-teacher"') &&
    html.includes('id="classroom-session-minutes"') &&
    html.includes('id="classroom-seed-start-date"'),
    'Classroom modal must expose scheduling setup fields.'
);
assert(
    html.includes('data-tab="scheduling"') &&
    html.includes('id="classroom-scheduling"'),
    'Classroom modal must provide a dedicated scheduling tab.'
);

assert(
    !/catch\s*\(\s*[^)]*\s*\)\s*\{\s*\}/.test(js),
    'crm-admin.js must not contain empty catch blocks.'
);

assert(
    js.includes('loadSchedulerWorkspace') &&
    js.includes('refreshSchedulerWorkspace'),
    'crm-admin.js must wire scheduler workspace lifecycle helpers.'
);

assert(
    typeof packageJson.scripts['lint:crm'] === 'string' && packageJson.scripts['lint:crm'].includes('public/js/crm'),
    'package.json must expose a lint:crm script for CRM browser and route modules.'
);

console.log('crm shell static contract passed');
