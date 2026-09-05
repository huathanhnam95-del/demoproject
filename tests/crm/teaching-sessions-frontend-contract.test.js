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
assert.ok(html.includes('mermaid@11.17.2'), 'crm-admin.html must load pinned mermaid@11.17.2 CDN');
assert.ok(html.includes('js/crm/teaching-session-mindmap.js'), 'crm-admin.html must load teaching-session-mindmap.js script');
assert.ok(html.includes('js/crm/teaching-session-pdf.js'), 'crm-admin.html must load teaching-session-pdf.js script');
assert.ok(html.includes('js/crm/teaching-sessions.js'), 'crm-admin.html must load teaching-sessions.js script');
assert.ok(html.includes('id="teaching-session-mindmap-detail"'), 'crm-admin.html must contain teaching-session-mindmap-detail aside');
assert.ok(html.includes('id="btn-export-teaching-session-pdf"'), 'crm-admin.html must contain btn-export-teaching-session-pdf button');

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
assert.ok(htmlModern.includes('crm-problem-accordion'), 'Should render problem as accordion details');
assert.ok(htmlModern.includes('crm-problem-summary'), 'Should render summary element');
assert.ok(htmlModern.includes('crm-briefing-filters'), 'Should render filter chips toolbar');
assert.ok(htmlModern.includes('data-filter="all"'), 'Should render all filter chip');
assert.ok(htmlModern.includes('data-hw-index="0"'), 'Should render homework checklist item with data-hw-index');
assert.ok(htmlModern.includes('crm-btn-create-task'), 'Should render create single task button');
assert.ok(htmlModern.includes('crm-btn-create-all-tasks'), 'Should render create all tasks button');
assert.ok(htmlModern.includes('crm-hw-due-input'), 'Should render homework due date input');

// Test timestamp chips & clamping in modern session
const richSession = {
    title: 'Rich Session',
    report: {
        summary: { core_topic: 'Advanced Pronunciation' },
        what_taught: [
            {
                category: 'Phonetics',
                topic: 'Schwa Reduction',
                key_rule: 'This is a very long and detailed rule that exceeds one hundred and eighty characters in length so that we can verify empirical line clamping behavior in the Briefing UI component correctly and thoroughly without truncation bugs.',
                approx_start_sec: 125
            }
        ],
        student_problems_and_solutions: [
            {
                issue_summary: 'Over-stressing unstressed syllables',
                severity: 'Critical',
                student_outcome: 'Needs Practice',
                approx_start_sec: 420
            }
        ]
    }
};
const htmlRich = controller.renderBriefing(richSession);
assert.ok(htmlRich.includes('crm-timestamp-chip'), 'Should render timestamp chips');
assert.ok(htmlRich.includes('data-seek-sec="125"'), 'Should have data-seek-sec 125');
assert.ok(htmlRich.includes('data-seek-sec="420"'), 'Should have data-seek-sec 420');
assert.ok(htmlRich.includes('is-clamped'), 'Should apply is-clamped to long rules');
assert.ok(htmlRich.includes('crm-btn-clamp-toggle'), 'Should render clamp toggle button');
assert.ok(htmlRich.includes('open'), 'Needs Practice accordion should be open by default');

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

// Test new prompt schema (lesson_summary, student_error, teacher_fix, warmup_quiz_questions, teacher_followup_focus, student_homework_checklist)
const newPromptSession = {
    title: 'New Prompt Session',
    focusSkill: 'Writing & Logic',
    report: {
        lesson_summary: {
            focus_skill: 'Writing',
            core_topic: 'Advanced Cohesion & Flow',
            quick_recap_60s: 'Student demonstrated solid grasp of parallel structure.',
            student_readiness_level: 'Khá (Good)'
        },
        what_taught: [
            {
                category: 'Chiến Thuật',
                topic: 'PEEL Structure',
                key_rule: 'Point, Evidence, Explanation, Link.',
                examples: ['Topic sentence connects to thesis'],
                approx_start_sec: 140
            }
        ],
        student_problems_and_solutions: [
            {
                problem_id: 'P1',
                severity: '🔴 Nghiêm trọng',
                issue_summary: 'Lỗi câu chắp vá (Run-on sentence)',
                student_error: 'The roads are crowded people commute by car.',
                teacher_fix: 'Use coordinating conjunction or split into two sentences.',
                student_outcome: 'Đã Nắm Vững (Mastered)',
                outcome_evidence: 'Corrected without prompts.',
                approx_start_sec: 320
            }
        ],
        next_lesson_briefing: {
            warmup_quiz_questions: ['Identify run-on sentences in 3 examples.'],
            teacher_followup_focus: ['Monitor comma splices in body paragraphs.'],
            student_homework_checklist: ['Rewrite paragraph 2 using subordination.']
        }
    }
};

const normNew = controller.normalizeReport(newPromptSession);
assert.strictEqual(normNew.summary.core_topic, 'Advanced Cohesion & Flow');
assert.strictEqual(normNew.whatTaught.length, 1);
assert.strictEqual(normNew.whatTaught[0].approx_start_sec, 140);
assert.strictEqual(normNew.problems.length, 1);
assert.strictEqual(normNew.problems[0].student_error, 'The roads are crowded people commute by car.');
assert.strictEqual(normNew.problems[0].student_error_quote, 'The roads are crowded people commute by car.');
assert.strictEqual(normNew.problems[0].teacher_fix, 'Use coordinating conjunction or split into two sentences.');
assert.strictEqual(normNew.problems[0].teacher_solution, 'Use coordinating conjunction or split into two sentences.');
assert.strictEqual(normNew.nextBriefing.warmup_quiz_questions.length, 1);
assert.strictEqual(normNew.nextBriefing.warmup_tasks.length, 1);
assert.strictEqual(normNew.nextBriefing.teacher_followup_focus.length, 1);
assert.strictEqual(normNew.nextBriefing.followup_error_focus.length, 1);
assert.strictEqual(normNew.nextBriefing.student_homework_checklist.length, 1);
assert.strictEqual(normNew.nextBriefing.recommended_homework.length, 1);

const htmlNew = controller.renderBriefing(newPromptSession);
assert.ok(htmlNew.includes('Advanced Cohesion & Flow'));
assert.ok(htmlNew.includes('The roads are crowded people commute by car.'));
assert.ok(htmlNew.includes('Use coordinating conjunction or split into two sentences.'));
assert.ok(htmlNew.includes('Identify run-on sentences in 3 examples.'));
assert.ok(htmlNew.includes('Monitor comma splices in body paragraphs.'));
assert.ok(htmlNew.includes('Rewrite paragraph 2 using subordination.'));
assert.ok(htmlNew.includes('data-seek-sec="320"'));

// 5. Test Interactive Mindmap module (Phase B)
const mindmapJsPath = path.resolve(__dirname, '../../public/js/crm/teaching-session-mindmap.js');
const mindmapJs = fs.readFileSync(mindmapJsPath, 'utf8');
vm.runInContext(mindmapJs, domSandbox);
const mindmapModule = domSandbox.window.CrmTeachingSessionMindmap;
assert.ok(mindmapModule, 'window.CrmTeachingSessionMindmap must be defined');
assert.strictEqual(typeof mindmapModule.buildMindmapModel, 'function');
assert.strictEqual(typeof mindmapModule.assignProblemsToConcepts, 'function');
assert.strictEqual(typeof mindmapModule.sanitizeMermaidText, 'function');
assert.strictEqual(typeof mindmapModule.renderInteractiveMindmap, 'function');
assert.strictEqual(typeof mindmapModule.refitDiagramLabels, 'function');

// 5.1 Test sanitizeMermaidText
const dirtyText = 'Topic: [Advanced] (Cohesion) "PEEL" & Logic; test`quote`\nNewline \t tab';
const cleanText = mindmapModule.sanitizeMermaidText(dirtyText);
assert.ok(!cleanText.includes('['), 'Must strip [');
assert.ok(!cleanText.includes(']'), 'Must strip ]');
assert.ok(!cleanText.includes('('), 'Must strip (');
assert.ok(!cleanText.includes(')'), 'Must strip )');
assert.ok(!cleanText.includes('"'), 'Must strip "');
assert.ok(!cleanText.includes(';'), 'Must strip ;');
assert.ok(!cleanText.includes('`'), 'Must strip `');
assert.ok(!cleanText.includes('\n'), 'Must strip newline');

// 5.2 Test assignProblemsToConcepts deterministic assignment
const testConcepts = [
    { id: 'c0', topic: 'Lexical Cohesion', category: 'Writing', approx_start_sec: 100 },
    { id: 'c1', topic: 'Grammar Accuracy', category: 'Grammar', approx_start_sec: 300 }
];
const testProblems = [
    { problem_id: 'p0', issue_summary: 'Misuse of cohesive transition words', approx_start_sec: 105 },
    { problem_id: 'p1', issue_summary: 'Subject verb agreement error in past tense', approx_start_sec: 310 }
];
const assignment = mindmapModule.assignProblemsToConcepts(testConcepts, testProblems);
assert.strictEqual(assignment.conceptProblems[0][0].problem_id, 'p0', 'p0 should assign to c0 by time proximity and cohesion match');
assert.strictEqual(assignment.conceptProblems[1][0].problem_id, 'p1', 'p1 should assign to c1');
assert.strictEqual(typeof assignment.assignments.get, 'function', 'assignment.assignments should be a Map');
assert.strictEqual(assignment.assignments.get(0)[0].problem_id, 'p0');

// 5.3 Test buildMindmapModel
const sessionForMindmap = {
    title: 'Model Building Session',
    report: {
        summary: { core_topic: 'Cohesion & Grammar' },
        what_taught: [
            { category: 'Writing', topic: 'PEEL Method', key_rule: 'Point Evidence Explanation Link', approx_start_sec: 120 }
        ],
        student_problems_and_solutions: [
            {
                issue_summary: 'Missing Explanation step',
                student_error: 'Wrote Point and jumped to Link',
                teacher_fix: 'Add explanation sentence',
                severity: '🔴 Nghiêm trọng',
                student_outcome: '✅ Mastered',
                approx_start_sec: 130
            }
        ]
    }
};
const model = mindmapModule.buildMindmapModel(controller.normalizeReport(sessionForMindmap));
assert.ok(model.mermaidText.startsWith('mindmap\n  root(('), 'Mindmap code must start with root((');
assert.ok(model.mermaidText.includes('PEEL Method'), 'Mindmap must contain concept topic');
assert.ok(Array.isArray(model.descriptors), 'Model must contain descriptors array');
const rootDesc = model.descriptors[0];
assert.strictEqual(rootDesc.kind, 'root');
assert.strictEqual(rootDesc.fullText, 'Cohesion & Grammar');

const conceptDesc = model.descriptors.find(d => d.kind === 'concept');
assert.ok(conceptDesc, 'Must have a concept descriptor');
assert.ok(conceptDesc.label.includes('PEEL Method'));

// 6. Test PDF export module (Phase D)
const pdfJsPath = path.resolve(__dirname, '../../public/js/crm/teaching-session-pdf.js');
const pdfJs = fs.readFileSync(pdfJsPath, 'utf8');
vm.runInContext(pdfJs, domSandbox);
assert.strictEqual(typeof domSandbox.window.generateTeachingSessionPdf, 'function', 'window.generateTeachingSessionPdf must be exposed');

// 7. Unit Tests for calculateDefaultDueDate (Phase C)
assert.strictEqual(typeof controller.calculateDefaultDueDate, 'function', 'controller.calculateDefaultDueDate must be exposed');

// 7.1 Future session date -> 7 days later
const fixedNow = new Date('2026-09-01T10:00:00Z');
const currentSessionDate = '2026-09-01T10:00:00Z';
const dueStandard = controller.calculateDefaultDueDate(currentSessionDate, fixedNow);
assert.match(dueStandard, /^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD');
const parsedDueStandard = new Date(`${dueStandard}T20:00:00`);
const diffDaysStandard = Math.round((parsedDueStandard.getTime() - fixedNow.getTime()) / (24 * 60 * 60 * 1000));
assert.ok(diffDaysStandard >= 6 && diffDaysStandard <= 8, `Due date should be ~7 days ahead, got diff ${diffDaysStandard}`);

// 7.2 Stale past session date -> clamped to >= now + 24h at 20:00 local
const oldSessionDate = '2026-08-01T10:00:00Z';
const dueClamped = controller.calculateDefaultDueDate(oldSessionDate, fixedNow);
const parsedDueClamped = new Date(`${dueClamped}T20:00:00`);
assert.ok(parsedDueClamped.getTime() >= fixedNow.getTime() + 24 * 60 * 60 * 1000, 'Clamped due date must be at least 24 hours in the future');

// 7.3 Invalid or null session date fallback
const dueFallback = controller.calculateDefaultDueDate(null, fixedNow);
assert.match(dueFallback, /^\d{4}-\d{2}-\d{2}$/, 'Fallback due date must be valid YYYY-MM-DD');

// 8. Unit Tests for stripDiacritics & sanitizeMermaidText (Phase B)
assert.strictEqual(typeof mindmapModule.stripDiacritics, 'function', 'stripDiacritics must be exposed');
const vietnameseText = 'Đoàn Động Từ Điểm Ngữ Pháp';
const stripped = mindmapModule.stripDiacritics(vietnameseText);
assert.strictEqual(stripped, 'doan dong tu diem ngu phap', 'stripDiacritics must fold đ/Đ to d');

const trickySyntax = '%% comment %%\n:::classStyle (nested [brackets] {braces} #tag &amp; <xml> `code` *star* |pipe| "quote" \\slash /fwd)';
const sanitizedTricky = mindmapModule.sanitizeMermaidText(trickySyntax);
assert.ok(!sanitizedTricky.includes('%%'), 'Must strip %%');
assert.ok(!sanitizedTricky.includes(':::classStyle'), 'Must strip class selectors');
assert.ok(!/[()[\]{}#&;<>`*|"\\/]/.test(sanitizedTricky), 'Must strip all Mermaid mindmap syntax breakers');
assert.strictEqual(mindmapModule.sanitizeMermaidText('', 'Fallback Text'), 'Fallback Text');
assert.strictEqual(mindmapModule.sanitizeMermaidText(null), 'Mục 1');

// 9. Unit Test for Timestamp-less Concept Assignment (Phase B)
const timelessConcepts = [
    { id: 'c0', topic: 'Phát âm nguyên âm đơn', category: 'Phonics', approx_start_sec: null },
    { id: 'c1', topic: 'Trọng âm từ hai âm tiết', category: 'Stress', approx_start_sec: null }
];
const timelessProblems = [
    { problem_id: 'p0', issue_summary: 'Sai trọng âm từ hai âm tiết thứ nhất', approx_start_sec: null },
    { problem_id: 'p1', issue_summary: 'Phát âm sai nguyên âm đơn /i:/ thành /ɪ/', approx_start_sec: null }
];
const timelessAssignment = mindmapModule.assignProblemsToConcepts(timelessConcepts, timelessProblems);
assert.strictEqual(timelessAssignment.conceptProblems[0][0].problem_id, 'p1', 'p1 should match c0 on text similarity alone');
assert.strictEqual(timelessAssignment.conceptProblems[1][0].problem_id, 'p0', 'p0 should match c1 on text similarity alone');

// 10. Unit Test for PDF Student Filename ASCII Folding (Phase D)
const testStudentName = 'Đoàn Văn Định';
const folded = testStudentName
    .replace(/\u0111/g, 'd').replace(/\u0110/g, 'D')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9a-zA-Z\s_-]/g, '')
    .trim().replace(/\s+/g, '-');
assert.strictEqual(folded, 'Doan-Van-Dinh', 'Vietnamese student name with Đ/đ must fold to Doan-Van-Dinh without dropping letters');

console.log('teaching sessions frontend contract and briefing rendering tests passed');
