const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const html = read('public/crm-admin.html');
const js = read('public/crm-admin.js');
const agentSourcesWorkspace = read('public/js/crm/agent-sources-workspace.js');
const schedulerWorkspace = read('public/js/crm/scheduler-workspace.js');
const packageJson = JSON.parse(read('package.json'));
const CRM_ADMIN_ASSET_VERSION = '20260726-v1.8.34';

const panelIds = new Set(Array.from(html.matchAll(/data-panel="([^"]+)"/g), (match) => match[1]));
const localAssetRefs = Array.from(
    html.matchAll(/<(?:link|script)\b[^>]+(?:href|src)="([^"]+)"/g),
    (match) => match[1]
).filter((ref) => !ref.startsWith('http://') && !ref.startsWith('https://') && !ref.startsWith('//'));

for (const ref of localAssetRefs) {
    assert(
        ref.includes(`?v=${CRM_ADMIN_ASSET_VERSION}`),
        `CRM admin asset "${ref}" must include the shared cache-busting version token.`
    );
}

for (const marker of [
    'ðŸ',     // common mojibake prefix for emojis
    'â€¦',    // ellipsis
    'â†',     // arrows (→, ↗, etc.)
    'â–',     // triangles (▶, etc.)
    'âœ',     // sparkles (✨, etc.)
    'â€”',    // em dash (—)
    'Â·',     // middle dot (·)
    'Ã…',     // Å and similar accented characters
    'Ã',      // general UTF-8-as-latin1 corruption marker
    'Â',      // often appears before ©, ·, nbsp, etc.
    '�'       // replacement character
]) {
    assert(
        !html.includes(marker),
        `CRM admin HTML contains text-encoding corruption marker "${marker}".`
    );
}

assert(
    !html.includes('js/crm/student-workspace.js'),
    'CRM admin page must not load the legacy student workspace helper.'
);

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
    html.includes('js/crm/scheduler-workspace.js') &&
    html.indexOf('js/crm/scheduler-workspace.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the admin scheduler workspace helper before crm-admin.js.'
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
    html.includes('js/crm/agent-sources-workspace.js') &&
    html.indexOf('js/crm/agent-sources-workspace.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the agent sources workspace helper before crm-admin.js.'
);
assert(
    html.includes('js/crm/devtools-access.js') &&
    html.indexOf('js/crm/devtools-access.js') < html.indexOf('crm-admin.js'),
    'CRM admin page must load the devtools access helper before crm-admin.js.'
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
    html.includes('classroom-seed-weekdays') &&
    html.includes('classroom-session-minutes') &&
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
    js.includes('elements.inputClassroomSessionMinutes = document.getElementById(\'classroom-session-minutes\')') &&
    js.includes('elements.inputClassroomSeedWeekdays = document.getElementById(\'classroom-seed-weekdays\')') &&
    js.includes('elements.attendanceSchedulePrompt = document.getElementById(\'attendance-schedule-prompt\')') &&
    js.includes('function renderClassroomSchedulePrompt()') &&
    js.includes('async function loadLiveSessions(classId, options = {})') &&
    js.includes('async function saveLiveSession()') &&
    js.includes('async function startSelectedLiveSession()') &&
    js.includes('async function endSelectedLiveSession()'),
    'crm-admin.js must bind and implement the live-delivery session workflow in the active shell.'
);
assert(
    js.includes('let schedulerController = null;') &&
    js.includes('schedulerController = window.CrmSchedulerWorkspace') &&
    js.includes('elements.schedulerWorkspace = document.getElementById(\'scheduler-workspace\')') &&
    js.includes('elements.schedulerClassList = document.getElementById(\'scheduler-class-list\')') &&
    js.includes('elements.schedulerCalendar = document.getElementById(\'scheduler-calendar\')') &&
    js.includes('elements.btnRefreshScheduler = document.getElementById(\'btn-refresh-scheduler\')') &&
    js.includes('elements.btnSeedScheduler = document.getElementById(\'btn-seed-scheduler\')'),
    'crm-admin.js must bind and instantiate the admin Class Scheduling workspace, not only the teacher scheduler.'
);
assert(
    schedulerWorkspace.includes('state.selectedClassroomId = String(state.classrooms[0].classroomId || state.classrooms[0].id || \'\').trim()') &&
    schedulerWorkspace.includes('seedClassroomSessions(classId, {') &&
    schedulerWorkspace.includes('startDate: String(scheduleConfig.seedStartDate || \'\').trim()') &&
    schedulerWorkspace.includes('weekdayNumbers: parseWeekdayNumbers(scheduleConfig.seedWeekdays)') &&
    !schedulerWorkspace.includes('updateClassroomScheduleConfig'),
    'Admin scheduler first-generation must use the saved selected class setup instead of reading or saving modal state.'
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
    js.includes('function openFreshStudentModal()') &&
    js.includes('function closeStudentProfile()') &&
    js.includes('openStudentProfileByCrmId') &&
    js.includes('setStudentProfileHash(crmId)') &&
    js.includes('/api/admin/students/by-crm-id/') &&
    js.includes('state.studentLookup'),
    'crm-admin.js must support crmId-backed student deep links and close back to the correct route.'
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
    js.includes('ID: ${crmId}') &&
    js.includes('ID: ${freshCrmId}') &&
    js.includes('CRM ID') &&
    js.includes("crmId || '"),
    'crm-admin.js and the student directory must surface the public CRM ID instead of the internal document ID.'
);
assert(
    js.includes('let agentSourcesController = null;') &&
    js.includes('agentSourcesController = state.accessMode === \'admin\'') &&
    js.includes('elements.inputLeadAgentSource = document.getElementById(\'lead-agent-source\')') &&
    js.includes('elements.inputStudentAgentSource = document.getElementById(\'student-agent-source\')') &&
    js.includes('elements.btnCreateAgentSource = document.getElementById(\'btn-create-agent-source\')') &&
    agentSourcesWorkspace.includes('window.CrmAgentSourcesWorkspace') &&
    agentSourcesWorkspace.includes('/api/admin/agent-sources?limit=500') &&
    agentSourcesWorkspace.includes('/api/admin/agent-sources/report?') &&
    agentSourcesWorkspace.includes('btnCreateAgentSource.addEventListener(\'click\'') &&
    agentSourcesWorkspace.includes('crm-agent-source-card') &&
    agentSourcesWorkspace.includes('agentSourcesList.addEventListener(\'keydown\''),
    'CRM admin must wire agent-source create, refresh, list, export, and linked dropdown hydration.'
);
assert(
    agentSourcesWorkspace.includes('fetchCourses({ forceRefresh: true })') &&
    agentSourcesWorkspace.includes('String(course.status || \'active\').toLowerCase() === \'active\'') &&
    agentSourcesWorkspace.includes('validateCourseRatePercent'),
    'Agent source course-rate editor must refresh the active course catalog and validate percentages before save.'
);

assert(
    html.includes('id="teacher-scheduler-workspace"'),
    'CRM admin page must expose the teacher scheduler workspace container.'
);
assert(
    html.includes('id="teacher-scheduler-calendar"'),
    'CRM admin page must expose the teacher scheduler calendar surface.'
);
assert(
    html.includes('id="teacher-scheduler-class-list"'),
    'CRM admin page must expose the teacher scheduler class list surface.'
);
assert(
    html.includes('id="bulk-delete-warning-modal"') &&
    html.includes('id="bulk-delete-warning-title"') &&
    html.includes('id="bulk-delete-warning-summary"') &&
    html.includes('id="bulk-delete-warning-list"') &&
    html.includes('id="bulk-delete-confirm-input"') &&
    html.includes('id="btn-confirm-bulk-delete-warning"'),
    'CRM admin page must expose the archive warning modal required by bulk recycle-bin actions.'
);
assert(
    html.includes('id="course-total-hours"') &&
    html.includes('id="course-default-session-minutes"') &&
    html.includes('id="course-timezone"') &&
    html.includes('id="course-agent-commission-percent"'),
    'Course modal must expose delivery template scheduling fields and the agent commission field.'
);
assert(
    js.includes('elements.inputCourseAgentCommissionPercent = document.getElementById(\'course-agent-commission-percent\')') &&
    js.includes('agentCommissionBps') &&
    js.includes('inputCourseAgentCommissionPercent'),
    'crm-admin.js must bind, serialize, reset, and hydrate course agent commission in the active course modal path.'
);
assert(
    js.includes('async function fetchCoursesFromCatalog(options = {})') &&
    js.includes('window.CrmCourses.fetchCourses(options)') &&
    js.includes('refreshCourseCatalog({ forceRefresh: true })'),
    'Course saves must force-refresh the cached course catalog so newly created courses are immediately selectable.'
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
    js.includes('refreshTeacherSchedulerWorkspace') &&
    js.includes('teacherSchedulerController'),
    'crm-admin.js must wire teacher scheduler workspace lifecycle helpers.'
);
assert(
    js.includes('refreshSchedulerWorkspace') &&
    js.includes("'classes'") &&
    js.includes("activePanel === 'courses/classes'"),
    'crm-admin.js must refresh the admin Class Scheduling workspace when the courses/classes panel is active.'
);
assert(
    js.includes("state.accessMode === 'teacher' && main === 'courses' && sub === 'classes'") &&
    js.includes("state.sub = 'teacher-schedule'") &&
    js.includes('getRouteHash(state.main, state.sub)'),
    'Teacher-only CRM users must continue to be redirected from courses/classes to courses/teacher-schedule.'
);
assert(
    js.includes('window.CrmDevToolsAccess') &&
    js.includes('resolveDevToolsRoute') &&
    js.includes('shouldShowDevToolsNav') &&
    js.includes('/api/admin/sync-from-prod/collections') &&
    js.includes('devToolsAvailable'),
    'crm-admin.js must gate Dev Tools on backend sync capability instead of hostname-only checks.'
);

assert(
    typeof packageJson.scripts['lint:crm'] === 'string' && packageJson.scripts['lint:crm'].includes('public/js/crm'),
    'package.json must expose a lint:crm script for CRM browser and route modules.'
);

console.log('crm shell static contract passed');
