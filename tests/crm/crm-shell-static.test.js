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
