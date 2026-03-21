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
    html.includes('classroom-meeting-days') &&
    html.includes('classroom-meeting-hours'),
    'CRM admin page must expose structured schedule inputs for students and classrooms.'
);
assert(
    html.includes('data-panel="courses/zoom-links"') &&
    html.includes('classroom-live') &&
    html.includes('live-session-list') &&
    html.includes('btn-start-live-session') &&
    html.includes('btn-end-live-session'),
    'CRM admin page must expose the live delivery panel and live-session controls.'
);
assert(
    js.includes('loadLiveSessions') &&
    js.includes('renderLiveDeliverySummary') &&
    js.includes('renderAttendanceWorkflowGuidance') &&
    js.includes('renderClassworkWorkflowGuidance'),
    'crm-admin.js must implement live-session loading and deterministic workflow guidance.'
);
assert(
    js.includes('window.CrmStudentFinance') &&
    js.includes('studentFinanceController'),
    'crm-admin.js must delegate finance-tab logic through the student finance helper.'
);
assert(
    js.includes('window.CrmLiveDelivery') &&
    js.includes('liveDeliveryController'),
    'crm-admin.js must delegate live-delivery logic through the live delivery helper.'
);
assert(
    js.includes('window.CrmClassroomModal') &&
    js.includes('classroomModalController'),
    'crm-admin.js must delegate classroom modal shell logic through the classroom modal helper.'
);
assert(
    js.includes('window.CrmStudentModal') &&
    js.includes('studentModalController'),
    'crm-admin.js must delegate student modal shell logic through the student modal helper.'
);
assert(
    js.includes('window.CrmCourseModal') &&
    js.includes('courseModalController'),
    'crm-admin.js must delegate course modal shell logic through the course modal helper.'
);
assert(
    js.includes('window.CrmLeadWorkspace') &&
    js.includes('leadWorkspaceController'),
    'crm-admin.js must delegate lead pipeline and workspace logic through the lead workspace helper.'
);
assert(
    js.includes('window.CrmClassroomWorkspace') &&
    js.includes('classroomWorkspaceController'),
    'crm-admin.js must delegate classroom workspace logic through the classroom workspace helper.'
);
assert(
    js.includes('window.CrmStudentWorkspace') &&
    js.includes('studentWorkspaceController'),
    'crm-admin.js must delegate student workspace logic through the student workspace helper.'
);
assert(
    js.includes('window.CrmTaskActivityWorkspace') &&
    js.includes('taskActivityWorkspaceController'),
    'crm-admin.js must delegate task and activity orchestration through the task activity helper.'
);
assert(
    js.includes('window.CrmClassroomWorkspace') &&
    js.includes('classroomWorkspaceController'),
    'crm-admin.js must delegate classroom workspace logic through the classroom workspace helper.'
);
assert(
    js.includes('window.CrmCommunicationsWorkspace') &&
    js.includes('communicationsController'),
    'crm-admin.js must delegate communications management through the communications workspace helper.'
);
assert(
    js.includes('window.CrmDashboardWorkspace') &&
    js.includes('dashboardController'),
    'crm-admin.js must delegate dashboard management through the dashboard workspace helper.'
);
assert(
    js.includes('window.CrmStudentDirectoryWorkspace') &&
    js.includes('studentDirectoryController'),
    'crm-admin.js must delegate student list rendering through the student directory workspace helper.'
);
assert(
    js.includes('window.CrmActivitySurfaces') &&
    js.includes('activitySurfacesController'),
    'crm-admin.js must delegate activity surface wiring through the activity surfaces helper.'
);

assert(
    !/catch\s*\(\s*[^)]*\s*\)\s*\{\s*\}/.test(js),
    'crm-admin.js must not contain empty catch blocks.'
);

assert(
    typeof packageJson.scripts['lint:crm'] === 'string' && packageJson.scripts['lint:crm'].includes('public/js/crm'),
    'package.json must expose a lint:crm script for CRM browser and route modules.'
);

console.log('crm shell static contract passed');
