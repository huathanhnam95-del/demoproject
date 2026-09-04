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
assert.ok(teachingSessionsJs.includes('normalizeReport'), 'teaching-sessions.js must define normalizeReport');
assert.ok(teachingSessionsJs.includes('renderBriefing'), 'teaching-sessions.js must define renderBriefing');
assert.ok(teachingSessionsJs.includes('toggleFullscreen'), 'teaching-sessions.js must define toggleFullscreen');

// 4. Functional tests for normalizeReport and renderBriefing via VM
const vm = require('vm');
const domSandbox = {
    window: {},
    document: {
        readyState: 'complete',
        addEventListener: () => {},
        getElementById: () => null,
        querySelectorAll: () => [],
        createElement: () => {
            const el = { style: {}, innerHTML: '' };
            Object.defineProperty(el, 'textContent', {
                set(v) { this._text = v; this.innerHTML = String(v); },
                get() { return this._text || ''; }
            });
            return el;
        }
    },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem: () => {} },
    console, Date, JSON, Math, String, Number, Boolean, Array, Object
};
vm.createContext(domSandbox);
vm.runInContext(teachingSessionsJs, domSandbox);
const controller = domSandbox.window.CrmTeachingSessions;

// Test modern report normalization & HTML generation
const modernSession = {
    title: 'Modern Session',
    focusSkill: 'Writing',
    report: {
        summary: {
            core_topic: 'Academic Writing: Lexical Cohesion',
            quick_recap_60s: 'Focused on lexical cohesion and PEEL logic.',
            student_readiness_level: 'Khá (Good)'
        },
        what_taught: [
            {
                category: 'Vocabulary',
                topic: 'Hypernym - Hyponym',
                key_rule: 'Use broad terms first, then narrow.',
                examples: ['habitat -> ecosystem']
            }
        ],
        student_problems_and_solutions: [
            {
                issue_summary: "Misuse of 'commuters'",
                student_error_quote: 'commuters have to travel',
                teacher_solution: 'Use private vehicle drivers instead',
                severity: '🔴 Critical',
                student_outcome: '✅ Mastered',
                outcome_evidence: 'Self-corrected immediately'
            }
        ],
        next_lesson_briefing: {
            warmup_tasks: ['5-min Quiz on PEEL'],
            followup_error_focus: ['Check topic sentence'],
            recommended_homework: ['Write paragraph 1']
        }
    }
};

const normModern = controller.normalizeReport(modernSession);
assert.strictEqual(normModern.summary.core_topic, 'Academic Writing: Lexical Cohesion');
assert.strictEqual(normModern.whatTaught.length, 1);
assert.strictEqual(normModern.problems.length, 1);
assert.strictEqual(normModern.nextBriefing.warmup_tasks.length, 1);

const htmlModern = controller.renderBriefing(modernSession);
assert.ok(htmlModern.includes('Academic Writing: Lexical Cohesion'), 'Should render core topic');
assert.ok(htmlModern.includes('crm-briefing-recap-box'), 'Should render recap box');
assert.ok(htmlModern.includes('Hypernym - Hyponym'), 'Should render topic');
assert.ok(htmlModern.includes('crm-category-chip'), 'Should render category chip');
assert.ok(htmlModern.includes('severity-critical'), 'Should classify severity as critical');
assert.ok(htmlModern.includes('outcome-mastered'), 'Should classify outcome as mastered');
assert.ok(!htmlModern.includes('🔴'), 'Emoji should be stripped from chrome');
assert.ok(htmlModern.includes('5-min Quiz on PEEL'), 'Should render warmup task');

// Test legacy schema shim
const legacySession = {
    title: 'Legacy Session',
    report: {
        summary: { core_topic: 'Old Grammar', quick_recap_60s: 'Past tense' },
        student_problems: [{ problem_id: 'P1', issue_summary: 'Forgot -ed', student_error_quote: 'walked', severity: 'High' }],
        teacher_solutions: [{ targeted_problem_id: 'P1', explanation_or_rule: 'Add -ed' }],
        student_response: [{ targeted_problem_id: 'P1', final_verdict_or_score: 'Partially Mastered' }]
    }
};
const normLegacy = controller.normalizeReport(legacySession);
assert.strictEqual(normLegacy.problems[0].issue_summary, 'Forgot -ed');
assert.strictEqual(normLegacy.problems[0].teacher_solution, 'Add -ed');

// Test markdown fallback when report is missing
const mdOnlySession = {
    title: 'Markdown Only',
    markdownReport: '## Legacy Markdown Title\n- Simple bullet point'
};
const normAbsent = controller.normalizeReport(mdOnlySession);
assert.strictEqual(normAbsent, null);
const htmlFallback = controller.renderBriefing(mdOnlySession);
assert.ok(htmlFallback.includes('teaching-session-markdown-content'));
assert.ok(htmlFallback.includes('Legacy Markdown Title'));

console.log('teaching sessions frontend contract and briefing rendering tests passed');
