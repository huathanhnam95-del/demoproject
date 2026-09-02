const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. Validate crm-admin.html markup
const htmlPath = path.resolve(__dirname, '../../public/crm-admin.html');
const html = fs.readFileSync(htmlPath, 'utf8');

assert.ok(html.includes('data-tab="teaching-sessions"'), 'crm-admin.html must contain teaching-sessions sidebar tab');
assert.ok(html.includes('id="student-teaching-sessions"'), 'crm-admin.html must contain student-teaching-sessions tab pane');
assert.ok(html.includes('id="crm-teaching-session-modal"'), 'crm-admin.html must contain crm-teaching-session-modal');
assert.ok(html.includes('id="teaching-session-mindmap-container"'), 'crm-admin.html must contain teaching-session-mindmap-container');
assert.ok(html.includes('id="teaching-session-flowchart-container"'), 'crm-admin.html must contain teaching-session-flowchart-container');
assert.ok(html.includes('id="teaching-session-report-html"'), 'crm-admin.html must contain teaching-session-report-html');
assert.ok(html.includes('mermaid@11'), 'crm-admin.html must load mermaid.min.js CDN');
assert.ok(html.includes('js/crm/teaching-sessions.js'), 'crm-admin.html must load teaching-sessions.js script');

// 2. Validate student-modal.js integration
const studentModalJsPath = path.resolve(__dirname, '../../public/js/crm/student-modal.js');
const studentModalJs = fs.readFileSync(studentModalJsPath, 'utf8');
assert.ok(studentModalJs.includes("tabId === 'teaching-sessions'"), 'student-modal.js must handle teaching-sessions tab switch');
assert.ok(studentModalJs.includes('CrmTeachingSessions.loadStudentSessions'), 'student-modal.js must call loadStudentSessions');

// 3. Validate teaching-sessions.js controller exports
const teachingSessionsJsPath = path.resolve(__dirname, '../../public/js/crm/teaching-sessions.js');
const teachingSessionsJs = fs.readFileSync(teachingSessionsJsPath, 'utf8');
assert.ok(teachingSessionsJs.includes('window.CrmTeachingSessions'), 'teaching-sessions.js must declare window.CrmTeachingSessions');
assert.ok(teachingSessionsJs.includes('loadStudentSessions'), 'teaching-sessions.js must define loadStudentSessions');
assert.ok(teachingSessionsJs.includes('openSessionDetail'), 'teaching-sessions.js must define openSessionDetail');
assert.ok(teachingSessionsJs.includes('renderMermaid'), 'teaching-sessions.js must define renderMermaid');

console.log('teaching sessions frontend contract tests passed');
