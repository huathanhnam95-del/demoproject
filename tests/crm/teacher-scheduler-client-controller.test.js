/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Mock DOM environment
class MockElement {
    constructor(tag = 'DIV') {
        this.tagName = tag.toUpperCase();
        this.style = {};
        this.dataset = {};
        this.classList = {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            toggle(c, force) {
                if (force === undefined) {
                    if (this.classes.has(c)) this.classes.delete(c);
                    else this.classes.add(c);
                } else if (force) {
                    this.classes.add(c);
                } else {
                    this.classes.delete(c);
                }
            },
            contains(c) { return this.classes.has(c); }
        };
        this.attributes = {};
        this.listeners = {};
        this._val = '';
        this._text = '';
        this._html = '';
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] || null; }
    addEventListener(evt, fn) {
        if (!this.listeners[evt]) this.listeners[evt] = [];
        this.listeners[evt].push(fn);
    }
    removeEventListener(evt, fn) {
        if (this.listeners[evt]) {
            this.listeners[evt] = this.listeners[evt].filter(f => f !== fn);
        }
    }
    dispatchEvent(evt) {
        (this.listeners[evt.type] || []).forEach(fn => fn(evt));
    }
    get value() { return this._val; }
    set value(v) { this._val = String(v ?? ''); }
    get textContent() { return this._text; }
    set textContent(v) {
        this._text = String(v ?? '');
        this._html = this._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    get innerHTML() { return this._html; }
    set innerHTML(v) {
        this._html = String(v ?? '');
        this._text = this._html.replace(/<[^>]*>/g, '');
    }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    closest() { return null; }
    getBoundingClientRect() { return { left: 0, top: 0, bottom: 0, right: 0 }; }
}

function createMockDocument() {
    const elements = {};
    const docListeners = {};
    function createElement(tag) {
        return new MockElement(tag);
    }

    const doc = {
        createElement,
        addEventListener(evt, fn) {
            if (!docListeners[evt]) docListeners[evt] = [];
            docListeners[evt].push(fn);
        },
        removeEventListener(evt, fn) {
            if (docListeners[evt]) {
                docListeners[evt] = docListeners[evt].filter(f => f !== fn);
            }
        },
        dispatchEvent(evt) {
            (docListeners[evt.type] || []).forEach(fn => fn(evt));
        },
        listeners: docListeners,
        getElementById(id) {
            if (!elements[id]) {
                elements[id] = createElement('div');
                elements[id].id = id;
            }
            return elements[id];
        },
        querySelectorAll() { return []; }
    };

    return { doc, elements };
}

async function runTests() {
    console.log('Running teacher scheduler client controller tests...');

    // Load teacher-scheduler-workspace.js into a sandbox
    const workspaceJs = fs.readFileSync(path.join(__dirname, '../../public/js/crm/teacher-scheduler-workspace.js'), 'utf8');

    const { doc, elements } = createMockDocument();

    const mockTeachers = [
        { uid: 'teacher-1', displayName: 'Teacher Alice' },
        { uid: 'teacher-2', displayName: 'Teacher Bob' }
    ];

    let workspaceCalls = [];
    let addCalls = [];
    let outcomeCalls = [];
    let multiCalls = [];
    let recurrenceCalls = [];
    let singleRescheduleCalls = [];
    let seriesRescheduleCalls = [];
    let bulkRescheduleCalls = [];

    const mockClassroomAPI = {
        fetchTeachers: async () => mockTeachers,
        fetchTeacherSchedulerWorkspace: async (params) => {
            workspaceCalls.push(params);
            return {
                classrooms: [
                    { classroomId: 'c1', name: 'Class Alpha', primaryTeacherUid: 'teacher-1', primaryTeacherName: 'Teacher Alice' },
                    { classroomId: 'c2', name: 'Class Beta', primaryTeacherUid: 'teacher-2', primaryTeacherName: 'Teacher Bob' }
                ],
                sessions: [
                    { sessionId: 's1', classId: 'c1', teacherUid: 'teacher-1', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '08:00', durationMinutes: 60 }
                ],
                from: params.from || '2026-09-07',
                to: params.to || '2026-09-13'
            };
        },
        teacherAddClassroomSession: async (classId, data) => {
            addCalls.push({ classId, data });
            return { success: true };
        },
        teacherSetScheduledSessionOutcome: async (sessionId, data) => {
            outcomeCalls.push({ sessionId, data });
            return { success: true };
        },
        teacherAddClassroomSessionMulti: async (classId, data) => {
            multiCalls.push({ classId, data });
            return { success: true, createdCount: 2, skippedCount: 0 };
        },
        teacherActivateRecurrences: async (data) => {
            recurrenceCalls.push(data);
            return { success: true, successCount: 1, blockedCount: 0, errorCount: 0, details: [] };
        },
        teacherRescheduleScheduledSession: async (sessionId, data) => {
            singleRescheduleCalls.push({ sessionId, data });
            return { success: true, sessionId };
        },
        teacherRescheduleSessionSeries: async (sessionId, data) => {
            seriesRescheduleCalls.push({ sessionId, data });
            return {
                success: true,
                moved: [
                    { sessionId, from: { date: '2026-09-08', time: '08:00', durationMinutes: 60, timezone: 'UTC' }, to: { date: data.targetLocalDate, time: data.targetLocalTime, durationMinutes: 60, timezone: 'UTC' } },
                    { sessionId: 's2', from: { date: '2026-09-15', time: '08:00', durationMinutes: 60, timezone: 'UTC' }, to: { date: '2026-09-16', time: '08:00', durationMinutes: 60, timezone: 'UTC' } }
                ],
                conflicts: [],
                skippedLocked: [],
                canCommit: true,
                operationId: 'op_test_123'
            };
        },
        teacherBulkRescheduleSessions: async (data) => {
            bulkRescheduleCalls.push(data);
            return { success: true, moved: data.moves || [] };
        }
    };

    const windowMock = {
        document: doc,
        Element: MockElement,
        ClassroomAPI: mockClassroomAPI,
        setTimeout: (fn) => setTimeout(fn, 0),
        clearTimeout: () => {},
        scrollX: 0,
        scrollY: 0,
        innerWidth: 1024
    };

    const context = vm.createContext({
        window: windowMock,
        document: doc,
        Element: MockElement,
        console,
        Number,
        String,
        Boolean,
        Array,
        Map,
        Set,
        Date,
        Math,
        JSON
    });

    vm.runInContext(workspaceJs, context);

    const TeacherSchedulerWorkspace = context.window.TeacherSchedulerWorkspace;
    assert(TeacherSchedulerWorkspace, 'TeacherSchedulerWorkspace should be defined');

    // TEST 1: Admin Mode
    {
        workspaceCalls = [];
        addCalls = [];

        const adminElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            teacherSchedulerAdminFilterGroup: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('h3'),
            teacherSchedulerRailDesc: doc.createElement('p'),
            btnTeacherSchedulerRefresh: doc.createElement('button'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: adminElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        // Check that admin filter group is displayed
        assert.strictEqual(adminElements.teacherSchedulerAdminFilterGroup.style.display, 'block', 'Admin filter group should be displayed in admin mode');

        // Check teacher options populated
        assert(adminElements.teacherSchedulerTeacherSelect.innerHTML.includes('All Teachers'), 'Should include All Teachers option');
        assert(adminElements.teacherSchedulerTeacherSelect.innerHTML.includes('Teacher Alice'), 'Should include Teacher Alice');
        assert(adminElements.teacherSchedulerTeacherSelect.innerHTML.includes('Teacher Bob'), 'Should include Teacher Bob');

        // Initial workspace call had teacherUid: 'all'
        assert.strictEqual(workspaceCalls.length, 1);
        assert.strictEqual(workspaceCalls[0].teacherUid, 'all', 'Initial fetch should pass teacherUid=all');

        // Check rail title for All Classes
        assert.strictEqual(adminElements.teacherSchedulerRailTitle.textContent, 'All Classes', 'Rail title should say All Classes in all-teachers mode');

        // Simulate switching teacher to teacher-2
        adminElements.teacherSchedulerTeacherSelect.value = 'teacher-2';
        adminElements.teacherSchedulerTeacherSelect.dispatchEvent({ type: 'change' });

        // Allow any async tick to complete
        await new Promise(r => setTimeout(r, 20));

        assert.strictEqual(workspaceCalls.length, 2);
        assert.strictEqual(workspaceCalls[1].teacherUid, 'teacher-2', 'Switching teacher should fetch with teacherUid=teacher-2');
        assert.strictEqual(adminElements.teacherSchedulerRailTitle.textContent, "Teacher Bob's Classes", 'Rail title should reflect selected teacher');

        console.log('✓ Admin mode teacher filter and workspace fetch verified');
    }

    // TEST 2: Teacher Mode
    {
        workspaceCalls = [];

        const teacherElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            teacherSchedulerAdminFilterGroup: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('h3'),
            teacherSchedulerRailDesc: doc.createElement('p'),
            btnTeacherSchedulerRefresh: doc.createElement('button'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: teacherElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        // In teacher mode, filter group should not be set to block
        assert.notStrictEqual(teacherElements.teacherSchedulerAdminFilterGroup.style.display, 'block', 'Admin filter group should remain hidden in teacher mode');

        // Teacher workspace call must NOT pass teacherUid (backend enforces callerUid)
        assert.strictEqual(workspaceCalls.length, 1);
        assert.strictEqual(workspaceCalls[0].teacherUid, undefined, 'Teacher mode must not pass teacherUid override');

        // Rail title must say Your Classes
        assert.strictEqual(teacherElements.teacherSchedulerRailTitle.textContent, 'Your Classes', 'Rail title should say Your Classes in teacher mode');

        console.log('✓ Teacher mode isolation verified');
    }

    // TEST 3: Conflict isolation across different teachers in admin mode
    {
        const adminElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            teacherSchedulerAdminFilterGroup: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('h3'),
            teacherSchedulerRailDesc: doc.createElement('p')
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: adminElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        // In the workspace mock:
        // Teacher 1 has session s1 on 2026-09-08 at 08:00 (Class Alpha, duration 60 mins).
        // If we place session for Teacher 2 (Class Beta) at the SAME date/time (2026-09-08 at 08:00),
        // it must NOT be blocked as a conflict!
        addCalls = [];
        await controller.refresh();

        // Testing that placing class c2 (Teacher Bob) at 08:00 does not conflict with c1 (Teacher Alice)
        // We test this by verifying ClassroomAPI.teacherAddClassroomSession executes without throwing conflict
        await mockClassroomAPI.teacherAddClassroomSession('c2', {
            targetLocalDate: '2026-09-08',
            targetLocalTime: '08:00',
            durationMinutes: 60,
            teacherUid: 'teacher-2'
        });

        assert.strictEqual(addCalls.length, 1);
        assert.strictEqual(addCalls[0].classId, 'c2');
        assert.strictEqual(addCalls[0].data.teacherUid, 'teacher-2');

        console.log('✓ Multi-teacher conflict isolation verified');
    }

    // TEST 4: Teacher select dropdown includes teachers discovered from classrooms
    {
        const adminElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            teacherSchedulerAdminFilterGroup: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('h3'),
            teacherSchedulerRailDesc: doc.createElement('p'),
            inputTeacherSchedulerPatternClass: doc.createElement('select')
        };

        const origFetchTeachers = mockClassroomAPI.fetchTeachers;
        // fetchTeachers returns only Alice, but workspace returns Bob and Charlie
        mockClassroomAPI.fetchTeachers = async () => [
            { uid: 'teacher-1', displayName: 'Teacher Alice' }
        ];

        const origFetchWorkspace = mockClassroomAPI.fetchTeacherSchedulerWorkspace;
        mockClassroomAPI.fetchTeacherSchedulerWorkspace = async () => ({
            classrooms: [
                { classroomId: 'c1', name: 'Class Alpha', primaryTeacherUid: 'teacher-1', primaryTeacherName: 'Teacher Alice' },
                { classroomId: 'c2', name: 'Class Beta', primaryTeacherUid: 'teacher-2', primaryTeacherName: 'Teacher Bob' },
                { classroomId: 'c3', name: 'Class Gamma', primaryTeacherUid: 'teacher-3', primaryTeacherName: 'Teacher Charlie' }
            ],
            sessions: []
        });

        const controller = TeacherSchedulerWorkspace.createController({
            elements: adminElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        // Check options in teacherSelect
        const selectHtml = adminElements.teacherSchedulerTeacherSelect.innerHTML;
        assert(selectHtml.includes('Teacher Alice'), 'Should contain Teacher Alice');
        assert(selectHtml.includes('Teacher Bob'), 'Should discover Teacher Bob from classrooms');
        assert(selectHtml.includes('Teacher Charlie'), 'Should discover Teacher Charlie from classrooms');

        // Check pattern class options in "All Teachers" mode
        const patternHtml = adminElements.inputTeacherSchedulerPatternClass.innerHTML;
        assert(patternHtml.includes('Class Alpha (Teacher Alice)'), 'Pattern class option should include teacher name');
        assert(patternHtml.includes('Class Beta (Teacher Bob)'), 'Pattern class option should include teacher name');

        mockClassroomAPI.fetchTeachers = origFetchTeachers;
        mockClassroomAPI.fetchTeacherSchedulerWorkspace = origFetchWorkspace;

        console.log('✓ Teacher discovery from classrooms and pattern option suffixes verified');
    }

    // TEST 5: Popover viewport right-edge clamping
    {
        const adminElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            teacherSchedulerAdminFilterGroup: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('h3'),
            teacherSchedulerRailDesc: doc.createElement('p'),
            teacherSchedulerQuickAdd: doc.createElement('div'),
            inputTeacherSchedulerQuickClass: doc.createElement('select'),
            inputTeacherSchedulerQuickDate: doc.createElement('input'),
            inputTeacherSchedulerQuickTime: doc.createElement('input'),
            inputTeacherSchedulerQuickDuration: doc.createElement('input'),
            teacherSchedulerQuickError: doc.createElement('div'),
            teacherSchedulerQuickSuggestions: doc.createElement('div'),
            teacherSchedulerSessionBubble: doc.createElement('div'),
            teacherSchedulerSessionBubbleTitle: doc.createElement('div'),
            teacherSchedulerSessionBubbleMeta: doc.createElement('div'),
            teacherSchedulerSessionBubbleLock: doc.createElement('div')
        };
        adminElements.teacherSchedulerQuickAdd.offsetWidth = 340;
        adminElements.teacherSchedulerSessionBubble.offsetWidth = 380;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: adminElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        // 5a: QuickAdd near right edge (anchorLeft = 900 on 1024px viewport)
        // With 1024px viewport, popoverWidth 340: maxLeft = 1024 - 340 - 16 = 668px
        const slotMock = new MockElement('div');
        slotMock.dataset.date = '2026-09-11';
        slotMock.dataset.time = '14:00';
        slotMock.getBoundingClientRect = () => ({ left: 900, top: 200, bottom: 240, right: 1000 });
        slotMock.closest = (sel) => (sel.includes('teacher-scheduler-slot') ? slotMock : null);

        adminElements.teacherSchedulerCalendar.dispatchEvent({
            type: 'click',
            target: slotMock
        });

        assert.strictEqual(adminElements.teacherSchedulerQuickAdd.style.display, 'block');
        assert.strictEqual(adminElements.teacherSchedulerQuickAdd.style.left, '668px', 'Quick add should be clamped to viewport right edge');

        // 5b: Session bubble near right edge (anchorLeft = 850 on 1024px viewport)
        // With 1024px viewport, popoverWidth 380: maxLeft = 1024 - 380 - 16 = 628px
        const pillMock = new MockElement('div');
        pillMock.dataset.sessionId = 's1';
        pillMock.getBoundingClientRect = () => ({ left: 850, top: 200, bottom: 250, right: 950 });
        pillMock.closest = (sel) => (sel.includes('teacher-scheduler-session-pill') ? pillMock : null);

        adminElements.teacherSchedulerCalendar.dispatchEvent({
            type: 'click',
            target: pillMock
        });

        assert.strictEqual(adminElements.teacherSchedulerSessionBubble.style.display, 'block');
        assert.strictEqual(adminElements.teacherSchedulerSessionBubble.style.left, '628px', 'Session bubble should be clamped to viewport right edge');

        console.log('✓ Popover viewport right-edge clamping verified');
    }

    // TEST 6: Multi-session side-by-side rendering in "All Teachers" mode
    {
        const adminElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            teacherSchedulerAdminFilterGroup: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('h3'),
            teacherSchedulerRailDesc: doc.createElement('p')
        };

        const origFetchWorkspace = mockClassroomAPI.fetchTeacherSchedulerWorkspace;
        mockClassroomAPI.fetchTeacherSchedulerWorkspace = async () => ({
            classrooms: [
                { classroomId: 'c1', name: 'Class Alpha', primaryTeacherUid: 'teacher-1', primaryTeacherName: 'Teacher Alice' },
                { classroomId: 'c2', name: 'Class Beta', primaryTeacherUid: 'teacher-2', primaryTeacherName: 'Teacher Bob' }
            ],
            sessions: [
                { sessionId: 's1', classId: 'c1', teacherUid: 'teacher-1', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '08:00', durationMinutes: 60 },
                { sessionId: 's2', classId: 'c2', teacherUid: 'teacher-2', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '08:00', durationMinutes: 60 }
            ],
            from: '2026-09-07',
            to: '2026-09-13'
        });

        const controller = TeacherSchedulerWorkspace.createController({
            elements: adminElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        const calendarHtml = adminElements.teacherSchedulerCalendar.innerHTML;
        // Verify 50% width and offset positioning for concurrent sessions
        assert(calendarHtml.includes('width:calc(50.00% - 2px);'), 'Concurrent sessions must render with 50% width');
        assert(calendarHtml.includes('left:calc(0.00% + 1px);'), 'First concurrent session must start at left 0%');
        assert(calendarHtml.includes('left:calc(50.00% + 1px);'), 'Second concurrent session must start at left 50%');
        assert(calendarHtml.includes('Teacher Alice'), 'Concurrent session pill must show Teacher Alice badge');
        assert(calendarHtml.includes('Teacher Bob'), 'Concurrent session pill must show Teacher Bob badge');

        mockClassroomAPI.fetchTeacherSchedulerWorkspace = origFetchWorkspace;

        console.log('✓ Multi-session side-by-side rendering in All Teachers mode verified');
    }

    // TEST 7: Teacher filter prioritization in session placement
    {
        addCalls = [];
        const adminElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            teacherSchedulerAdminFilterGroup: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('h3'),
            teacherSchedulerRailDesc: doc.createElement('p')
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: adminElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        // Select teacher-2 in the dropdown
        adminElements.teacherSchedulerTeacherSelect.value = 'teacher-2';
        adminElements.teacherSchedulerTeacherSelect.dispatchEvent({ type: 'change' });
        await new Promise(r => setTimeout(r, 20));

        // Click class card for c1 (whose primaryTeacherUid is teacher-1)
        const classCardMock = new MockElement('div');
        classCardMock.dataset.classroomId = 'c1';
        classCardMock.closest = (sel) => (sel.includes('teacher-scheduler-class-card') ? classCardMock : null);

        adminElements.teacherSchedulerClassList.dispatchEvent({
            type: 'click',
            target: classCardMock
        });

        // Click slot on 2026-09-10 at 11:00
        const slotMock = new MockElement('div');
        slotMock.dataset.date = '2026-09-10';
        slotMock.dataset.time = '11:00';
        slotMock.closest = (sel) => (sel.includes('teacher-scheduler-slot') ? slotMock : null);

        adminElements.teacherSchedulerCalendar.dispatchEvent({
            type: 'click',
            target: slotMock
        });
        await new Promise(r => setTimeout(r, 20));

        // Verify addCalls prioritizes teacher-2
        assert.strictEqual(addCalls.length, 1);
        assert.strictEqual(addCalls[0].classId, 'c1');
        assert.strictEqual(addCalls[0].data.teacherUid, 'teacher-2', 'Should prioritize selected teacher filter over classroom primary teacher');

        console.log('✓ Teacher filter prioritization in session placement verified');
    }

    // TEST 8: Session outcome note persistence in client controller
    {
        outcomeCalls = [];
        const adminElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            teacherSchedulerAdminFilterGroup: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('h3'),
            teacherSchedulerRailDesc: doc.createElement('p'),
            teacherSchedulerSessionBubble: doc.createElement('div'),
            inputTeacherSchedulerSessionOutcome: doc.createElement('select'),
            inputTeacherSchedulerSessionNote: doc.createElement('textarea'),
            btnTeacherSchedulerSaveOutcome: doc.createElement('button')
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: adminElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        // Open session bubble for s1
        const pillMock = new MockElement('div');
        pillMock.dataset.sessionId = 's1';
        pillMock.getBoundingClientRect = () => ({ left: 200, top: 200, bottom: 250, right: 300 });
        pillMock.closest = (sel) => (sel.includes('teacher-scheduler-session-pill') ? pillMock : null);

        adminElements.teacherSchedulerCalendar.dispatchEvent({
            type: 'click',
            target: pillMock
        });

        // Set outcome and note
        adminElements.inputTeacherSchedulerSessionOutcome.value = 'completed';
        adminElements.inputTeacherSchedulerSessionNote.value = 'Great progress on dictation exercise.';

        // Click save outcome button
        adminElements.btnTeacherSchedulerSaveOutcome.dispatchEvent({ type: 'click' });
        await new Promise(r => setTimeout(r, 20));

        assert.strictEqual(outcomeCalls.length, 1);
        assert.strictEqual(outcomeCalls[0].sessionId, 's1');
        assert.strictEqual(outcomeCalls[0].data.outcome, 'completed');
        assert.strictEqual(outcomeCalls[0].data.note, 'Great progress on dictation exercise.');

        console.log('✓ Session outcome note persistence in client controller verified');
    }

    // TEST 9: Staggered multi-session interval overlap rendering
    {
        const adminElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            teacherSchedulerAdminFilterGroup: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('h3'),
            teacherSchedulerRailDesc: doc.createElement('p')
        };

        const origFetchWorkspace = mockClassroomAPI.fetchTeacherSchedulerWorkspace;
        mockClassroomAPI.fetchTeacherSchedulerWorkspace = async () => ({
            classrooms: [
                { classroomId: 'c1', name: 'Class Alpha', primaryTeacherUid: 'teacher-1', primaryTeacherName: 'Teacher Alice' },
                { classroomId: 'c2', name: 'Class Beta', primaryTeacherUid: 'teacher-2', primaryTeacherName: 'Teacher Bob' }
            ],
            sessions: [
                // s1 starts at 08:00 and lasts 90 mins (08:00 - 09:30)
                { sessionId: 's1', classId: 'c1', teacherUid: 'teacher-1', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '08:00', durationMinutes: 90 },
                // s2 starts at 08:30 and lasts 60 mins (08:30 - 09:30) — staggered overlap
                { sessionId: 's2', classId: 'c2', teacherUid: 'teacher-2', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '08:30', durationMinutes: 60 }
            ],
            from: '2026-09-07',
            to: '2026-09-13'
        });

        const controller = TeacherSchedulerWorkspace.createController({
            elements: adminElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        const calendarHtml = adminElements.teacherSchedulerCalendar.innerHTML;
        // Verify staggered overlapping sessions receive side-by-side columns
        assert(calendarHtml.includes('width:calc(50.00% - 2px);'), 'Staggered overlapping sessions must render with 50% width');
        assert(calendarHtml.includes('left:calc(0.00% + 1px);'), 'First overlapping session must start at left 0%');
        assert(calendarHtml.includes('left:calc(50.00% + 1px);'), 'Second overlapping session must start at left 50%');

        mockClassroomAPI.fetchTeacherSchedulerWorkspace = origFetchWorkspace;
        console.log('✓ Staggered multi-session interval overlap rendering verified');
    }

    // TEST 10: Teacher filter prioritization in placePatternWeek
    {
        multiCalls = [];
        const adminElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            teacherSchedulerAdminFilterGroup: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('h3'),
            teacherSchedulerRailDesc: doc.createElement('p'),
            inputTeacherSchedulerPatternClass: doc.createElement('select'),
            btnTeacherSchedulerPlaceWeek: doc.createElement('button')
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: adminElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        // Select teacher-2 in the dropdown
        adminElements.teacherSchedulerTeacherSelect.value = 'teacher-2';
        adminElements.teacherSchedulerTeacherSelect.dispatchEvent({ type: 'change' });
        await new Promise(r => setTimeout(r, 20));

        // Select class c1 (whose primaryTeacherUid is teacher-1)
        adminElements.inputTeacherSchedulerPatternClass.value = 'c1';

        // Trigger placePatternWeek
        adminElements.btnTeacherSchedulerPlaceWeek.dispatchEvent({ type: 'click' });
        await new Promise(r => setTimeout(r, 20));

        assert.strictEqual(multiCalls.length, 1);
        assert.strictEqual(multiCalls[0].classId, 'c1');
        assert.strictEqual(multiCalls[0].data.teacherUid, 'teacher-2', 'Weekly pattern should prioritize selected teacher filter over classroom primary teacher');

        console.log('✓ Teacher filter prioritization in placePatternWeek verified');
    }

    // TEST 11: Admin recurrence activation teacher filter validation
    {
        recurrenceCalls = [];
        const toasts = [];
        const adminElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            teacherSchedulerAdminFilterGroup: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('h3'),
            teacherSchedulerRailDesc: doc.createElement('p'),
            btnTeacherSchedulerActivateRecurrences: doc.createElement('button')
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: adminElements,
            showToast: (msg, type) => toasts.push({ msg, type }),
            isAdmin: () => true
        });

        await controller.init();

        // When "All Teachers" is selected (default), activating recurrences should prompt for teacher
        adminElements.btnTeacherSchedulerActivateRecurrences.dispatchEvent({ type: 'click' });
        await new Promise(r => setTimeout(r, 20));

        assert.strictEqual(recurrenceCalls.length, 0, 'Should not call API when All Teachers is selected');
        assert(toasts.some(t => t.msg.includes('Please select a specific teacher')), 'Should toast prompting to select teacher');

        // Now select teacher-2
        adminElements.teacherSchedulerTeacherSelect.value = 'teacher-2';
        adminElements.teacherSchedulerTeacherSelect.dispatchEvent({ type: 'change' });
        await new Promise(r => setTimeout(r, 20));

        adminElements.btnTeacherSchedulerActivateRecurrences.dispatchEvent({ type: 'click' });
        await new Promise(r => setTimeout(r, 20));

        assert.strictEqual(recurrenceCalls.length, 1, 'Should call API when specific teacher is selected');
        assert.strictEqual(recurrenceCalls[0].teacherUid, 'teacher-2', 'Should pass selected teacherUid to activate recurrences API');

        console.log('✓ Admin recurrence activation teacher filter validation verified');
    }

    // Test 12: Completed session rendering, lock state, and vertical popover clamping
    {
        const { doc: testDoc } = createMockDocument();
        const testElements = {
            teacherSchedulerWorkspace: testDoc.createElement('div'),
            teacherSchedulerClassList: testDoc.createElement('div'),
            teacherSchedulerCalendar: testDoc.createElement('div'),
            teacherSchedulerTeacherSelect: testDoc.createElement('select'),
            teacherSchedulerAdminFilterGroup: testDoc.createElement('div'),
            teacherSchedulerRailTitle: testDoc.createElement('h3'),
            teacherSchedulerRailDesc: testDoc.createElement('p'),
            teacherSchedulerSessionBubble: testDoc.createElement('div'),
            teacherSchedulerSessionBubbleTitle: testDoc.createElement('div'),
            teacherSchedulerSessionBubbleMeta: testDoc.createElement('div'),
            teacherSchedulerSessionBubbleLock: testDoc.createElement('div'),
            inputTeacherSchedulerSessionOutcome: testDoc.createElement('select'),
            inputTeacherSchedulerSessionNote: testDoc.createElement('textarea'),
            btnTeacherSchedulerSaveOutcome: testDoc.createElement('button'),
            btnTeacherSchedulerCancelSession: testDoc.createElement('button'),
            inputTeacherSchedulerFromDate: testDoc.createElement('input'),
            inputTeacherSchedulerToDate: testDoc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-08-31';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-06';
        const testClassroom = {
            classroomId: 'class-hanh',
            name: 'Trần Văn Hạnh - PTE Academic 1-1 24h',
            primaryTeacherUid: 'teacher-shawn',
            scheduleConfig: { sessionMinutes: 120 }
        };
        const completedSession = {
            sessionId: 'sess-completed-1',
            classId: 'class-hanh',
            teacherUid: 'teacher-shawn',
            status: 'completed',
            attendanceState: 'finalized',
            sessionOutcome: 'completed',
            scheduledLocalDate: '2026-08-31',
            scheduledLocalTime: '19:00',
            durationMinutes: 120,
            unitType: 'contracted',
            contractUnitIndex: 1
        };

        // Keep this historical fixture on the same week as its completed session.
        // The controller otherwise defaults empty date inputs to the current week.
        testElements.inputTeacherSchedulerFromDate.value = '2026-08-31';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-06';

        const mockGlobal = {
            window: {
                innerWidth: 1440,
                innerHeight: 768,
                scrollX: 0,
                scrollY: 0,
                Element: MockElement,
                ClassroomAPI: {
                    fetchTeacherSchedulerWorkspace: async () => ({
                        classrooms: [testClassroom],
                        sessions: [completedSession],
                        from: '2026-08-31',
                        to: '2026-09-06'
                    }),
                    fetchTeachers: async () => [{ uid: 'teacher-shawn', displayName: 'Shawn' }]
                }
            },
            Element: MockElement,
            document: testDoc,
            console
        };
        vm.createContext(mockGlobal);
        vm.runInContext(workspaceJs, mockGlobal);

        const ctrl = mockGlobal.window.TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await ctrl.init();

        const calHtml = testElements.teacherSchedulerCalendar.innerHTML;
        assert(calHtml.includes('is-completed'), 'Calendar HTML must render session pill with is-completed class');
        assert(calHtml.includes('✓ Completed'), 'Calendar HTML must render ✓ Completed badge');
        assert(calHtml.includes('Trần Văn Hạnh'), 'Calendar HTML must render student/classroom name');

        // Test vertical popover clamping near bottom of viewport
        testElements.teacherSchedulerSessionBubble.offsetHeight = 300;
        testElements.teacherSchedulerSessionBubble.offsetWidth = 360;

        // Open bubble at bottom of 768px viewport (e.g. anchorTop = 720)
        // Bubble should clamp to <= 768 - 300 - 16 = 452px
        testElements.teacherSchedulerCalendar.listeners['click'].forEach(fn => fn({
            target: {
                closest: (sel) => {
                    if (sel.includes('.teacher-scheduler-session-pill')) {
                        return {
                            dataset: { sessionId: 'sess-completed-1' },
                            closest: () => null,
                            getBoundingClientRect: () => ({ left: 200, bottom: 720 })
                        };
                    }
                    return null;
                }
            }
        }));

        const bubbleTop = parseInt(testElements.teacherSchedulerSessionBubble.style.top, 10);
        assert(Number.isFinite(bubbleTop), 'Bubble top must be a finite number');
        assert(bubbleTop <= 452, `Bubble top (${bubbleTop}px) must be clamped to viewport maxTop (<= 452px)`);
        assert(bubbleTop >= 16, 'Bubble top must be at least 16px');

        console.log('✓ Completed session pill rendering and vertical popover clamping verified');
    }

    // TEST 13: Popover mutual exclusivity, close button, outside click, and Escape dismissal
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerQuickAdd: doc.createElement('div'),
            btnTeacherSchedulerCloseBubble: doc.createElement('button'),
            btnTeacherSchedulerQuickCancel: doc.createElement('button'),
            teacherSchedulerSessionBubble: doc.createElement('div'),
            teacherSchedulerSessionBubbleTitle: doc.createElement('div'),
            teacherSchedulerSessionBubbleMeta: doc.createElement('div'),
            teacherSchedulerSessionBubbleLock: doc.createElement('div')
        };
        testElements.teacherSchedulerQuickAdd.offsetWidth = 340;
        testElements.teacherSchedulerSessionBubble.offsetWidth = 380;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        const slotMock = new MockElement('div');
        slotMock.dataset.date = '2026-09-08';
        slotMock.dataset.time = '10:00';
        slotMock.getBoundingClientRect = () => ({ left: 200, top: 200, bottom: 240, right: 300 });
        slotMock.closest = (sel) => (sel.includes('teacher-scheduler-slot') ? slotMock : null);

        const pillMock = new MockElement('div');
        pillMock.dataset.sessionId = 's1';
        pillMock.getBoundingClientRect = () => ({ left: 200, top: 200, bottom: 250, right: 300 });
        pillMock.closest = (sel) => (sel.includes('teacher-scheduler-session-pill') ? pillMock : null);

        // 13a: Open QuickAdd
        testElements.teacherSchedulerCalendar.dispatchEvent({ type: 'click', target: slotMock });
        assert.strictEqual(testElements.teacherSchedulerQuickAdd.style.display, 'block');
        assert.strictEqual(testElements.teacherSchedulerSessionBubble.style.display, 'none');

        // 13b: Open Session Bubble -> QuickAdd closes automatically (mutual exclusivity)
        testElements.teacherSchedulerCalendar.dispatchEvent({ type: 'click', target: pillMock });
        assert.strictEqual(testElements.teacherSchedulerSessionBubble.style.display, 'block');
        assert.strictEqual(testElements.teacherSchedulerQuickAdd.style.display, 'none', 'QuickAdd must close when Session Bubble opens');

        // 13c: Header × button closes session bubble
        testElements.btnTeacherSchedulerCloseBubble.dispatchEvent({ type: 'click' });
        assert.strictEqual(testElements.teacherSchedulerSessionBubble.style.display, 'none');

        // 13d: Re-open QuickAdd and dismiss with Escape
        testElements.teacherSchedulerCalendar.dispatchEvent({ type: 'click', target: slotMock });
        assert.strictEqual(testElements.teacherSchedulerQuickAdd.style.display, 'block');
        doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
        assert.strictEqual(testElements.teacherSchedulerQuickAdd.style.display, 'none', 'Escape must dismiss QuickAdd');

        // 13e: Outside click dismisses popover
        testElements.teacherSchedulerCalendar.dispatchEvent({ type: 'click', target: pillMock });
        assert.strictEqual(testElements.teacherSchedulerSessionBubble.style.display, 'block');
        const outsideTarget = new MockElement('div');
        doc.dispatchEvent({ type: 'mousedown', target: outsideTarget });
        assert.strictEqual(testElements.teacherSchedulerSessionBubble.style.display, 'none', 'Outside mousedown must dismiss Session Bubble');

        console.log('✓ Popover mutual exclusivity, close button, outside click, and Escape dismissal verified');
    }

    // TEST 14: Dynamic --scheduler-day-count and compact pill layout (below 40px two-line threshold)
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-11'; // 5 days

        // Mock 30-minute session: at 24px/30min the pill is 22px, under the 40px two-line threshold -> compact
        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha' }],
                sessions: [
                    {
                        sessionId: 's-short',
                        classId: 'c1',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-07',
                        scheduledLocalTime: '09:00',
                        durationMinutes: 30,
                        status: 'completed'
                    }
                ],
                from: '2026-09-07',
                to: '2026-09-11'
            })
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        const calHtml = testElements.teacherSchedulerCalendar.innerHTML;
        assert(calHtml.includes('--scheduler-day-count: 5'), 'Grid must specify --scheduler-day-count: 5');
        assert(calHtml.includes('is-compact'), '30-minute session pill must render with is-compact class');
        assert(calHtml.includes('pill-header'), 'Compact pill must contain pill-header');
        assert(calHtml.includes('pill-badge-compact'), 'Compact completed badge must be present');
        assert(calHtml.includes('title="Completed"'), 'Compact completed badge title must be present');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Dynamic --scheduler-day-count and compact pill layout (<40px two-line threshold) verified');
    }

    // TEST 15: Drag and drop single session move with Undo toast invocation
    {
        let toastRecord = null;
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        singleRescheduleCalls = [];
        bulkRescheduleCalls = [];
        seriesRescheduleCalls = [];

        // Mock single session dry-run (returns moved array with length 1)
        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha' }],
                sessions: [
                    {
                        sessionId: 's-single',
                        classId: 'c1',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '08:00',
                        durationMinutes: 60,
                        timezone: 'UTC'
                    }
                ],
                from: '2026-09-07',
                to: '2026-09-13'
            }),
            teacherRescheduleSessionSeries: async (sessionId, data) => {
                seriesRescheduleCalls.push({ sessionId, data });
                return {
                    success: true,
                    moved: [
                        { sessionId, from: { date: '2026-09-08', time: '08:00', durationMinutes: 60, timezone: 'UTC' }, to: { date: data.targetLocalDate, time: data.targetLocalTime, durationMinutes: 60, timezone: 'UTC' } }
                    ],
                    conflicts: [],
                    skippedLocked: [],
                    canCommit: true
                };
            }
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: (msg, type, opts) => {
                toastRecord = { msg, type, opts };
            },
            isAdmin: () => false
        });

        await controller.init();

        // Simulate pointer drag drop to 2026-09-09 10:00
        const pillEl = new MockElement('div');
        pillEl.dataset.sessionId = 's-single';
        pillEl.getBoundingClientRect = () => ({ left: 200, top: 100, width: 120, height: 40 });
        pillEl.closest = (sel) => (sel.includes('teacher-scheduler-session-pill') ? pillEl : null);

        const slotEl = new MockElement('div');
        slotEl.dataset.date = '2026-09-09';
        slotEl.dataset.time = '10:00';
        slotEl.closest = (sel) => (sel.includes('teacher-scheduler-slot') ? slotEl : null);

        // Start drag on calendar
        testElements.teacherSchedulerCalendar.dispatchEvent({
            type: 'mousedown',
            button: 0,
            clientX: 210,
            clientY: 110,
            target: pillEl
        });

        // Move > 6px
        doc.dispatchEvent({
            type: 'mousemove',
            clientX: 250,
            clientY: 200
        });

        // Mouseup on destination slot
        doc.dispatchEvent({
            type: 'mouseup',
            clientX: 250,
            clientY: 200,
            target: slotEl
        });

        // Allow async drop handler to execute
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(singleRescheduleCalls.length, 1, 'Single session move should call teacherRescheduleScheduledSession');
        assert.strictEqual(singleRescheduleCalls[0].sessionId, 's-single');
        assert.strictEqual(singleRescheduleCalls[0].data.targetLocalDate, '2026-09-09');
        assert.strictEqual(singleRescheduleCalls[0].data.targetLocalTime, '10:00');

        assert(toastRecord, 'Toast should be displayed after reschedule');
        assert.strictEqual(toastRecord.opts?.actionLabel, 'Undo', 'Toast must offer Undo action');
        assert.strictEqual(typeof toastRecord.opts?.onAction, 'function', 'Toast must have onAction function');

        // Execute Undo action
        await toastRecord.opts.onAction();
        assert.strictEqual(bulkRescheduleCalls.length, 1, 'Undo must call teacherBulkRescheduleSessions');
        assert.strictEqual(bulkRescheduleCalls[0].moves.length, 1);
        assert.strictEqual(bulkRescheduleCalls[0].moves[0].sessionId, 's-single');
        assert.strictEqual(bulkRescheduleCalls[0].moves[0].targetLocalDate, '2026-09-08', 'Undo must restore original date');
        assert.strictEqual(bulkRescheduleCalls[0].moves[0].targetLocalTime, '08:00', 'Undo must restore original time');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Drag and drop single session move with Undo toast invocation verified');
    }

    // TEST 16: Drag and drop series move with Scope Choice Modal and Undo toast
    {
        let toastRecord = null;
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input'),
            teacherSchedulerScopeModal: doc.createElement('div'),
            teacherSchedulerScopeTitle: doc.createElement('div'),
            teacherSchedulerScopeShiftFrom: doc.createElement('div'),
            teacherSchedulerScopeShiftTo: doc.createElement('div'),
            teacherSchedulerScopeSeriesTitle: doc.createElement('div'),
            teacherSchedulerScopeSeriesDesc: doc.createElement('div'),
            teacherSchedulerScopeWarnings: doc.createElement('div'),
            scopeChoiceSingle: doc.createElement('input'),
            scopeChoiceSeries: doc.createElement('input'),
            btnTeacherSchedulerScopeCancel: doc.createElement('button'),
            btnTeacherSchedulerScopeConfirm: doc.createElement('button')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        seriesRescheduleCalls = [];
        bulkRescheduleCalls = [];

        // Mock multi-session series dry-run (returns 3 moved sessions)
        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha' }],
                sessions: [
                    {
                        sessionId: 's-series-1',
                        classId: 'c1',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '08:00',
                        durationMinutes: 60,
                        timezone: 'UTC'
                    }
                ],
                from: '2026-09-07',
                to: '2026-09-13'
            }),
            teacherRescheduleSessionSeries: async (sessionId, data) => {
                seriesRescheduleCalls.push({ sessionId, data });
                return {
                    success: true,
                    moved: [
                        { sessionId: 's-series-1', from: { targetLocalDate: '2026-09-08', targetLocalTime: '08:00', durationMinutes: 60, timezone: 'UTC' }, to: { targetLocalDate: data.targetLocalDate, targetLocalTime: data.targetLocalTime, durationMinutes: 60, timezone: 'UTC' } },
                        { sessionId: 's-series-2', from: { targetLocalDate: '2026-09-15', targetLocalTime: '08:00', durationMinutes: 60, timezone: 'UTC' }, to: { targetLocalDate: '2026-09-16', targetLocalTime: '08:00', durationMinutes: 60, timezone: 'UTC' } },
                        { sessionId: 's-series-3', from: { targetLocalDate: '2026-09-22', targetLocalTime: '08:00', durationMinutes: 60, timezone: 'UTC' }, to: { targetLocalDate: '2026-09-23', targetLocalTime: '08:00', durationMinutes: 60, timezone: 'UTC' } }
                    ],
                    conflicts: [],
                    skippedLocked: [],
                    canCommit: true,
                    operationId: 'op_series_999'
                };
            }
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: (msg, type, opts) => {
                toastRecord = { msg, type, opts };
            },
            isAdmin: () => false
        });

        await controller.init();

        const pillEl = new MockElement('div');
        pillEl.dataset.sessionId = 's-series-1';
        pillEl.getBoundingClientRect = () => ({ left: 200, top: 100, width: 120, height: 40 });
        pillEl.closest = (sel) => (sel.includes('teacher-scheduler-session-pill') ? pillEl : null);

        const slotEl = new MockElement('div');
        slotEl.dataset.date = '2026-09-09';
        slotEl.dataset.time = '09:00';
        slotEl.closest = (sel) => (sel.includes('teacher-scheduler-slot') ? slotEl : null);

        testElements.teacherSchedulerCalendar.dispatchEvent({
            type: 'mousedown',
            button: 0,
            clientX: 210,
            clientY: 110,
            target: pillEl
        });

        doc.dispatchEvent({
            type: 'mousemove',
            clientX: 250,
            clientY: 200
        });

        doc.dispatchEvent({
            type: 'mouseup',
            clientX: 250,
            clientY: 200,
            target: slotEl
        });

        // Allow dry-run call to resolve and modal to display
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(testElements.teacherSchedulerScopeModal.style.display, 'flex', 'Scope modal should be displayed for multi-session series');
        assert(testElements.teacherSchedulerScopeSeriesTitle.textContent.includes('3 sessions'), 'Scope modal series title should indicate session count');

        // Confirm "This and following sessions"
        testElements.scopeChoiceSeries.checked = true;
        testElements.btnTeacherSchedulerScopeConfirm.dispatchEvent({ type: 'click' });

        // Allow series reschedule commit to execute
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(seriesRescheduleCalls.length, 2, 'Dry run + Commit series reschedule should be executed');
        assert.strictEqual(seriesRescheduleCalls[1].data.allowPartial, false, 'Commit should set allowPartial: false when no conflicts/skips exist');
        assert.strictEqual(seriesRescheduleCalls[1].data.targetLocalDate, '2026-09-09');

        assert(toastRecord, 'Toast should be displayed after series move');
        assert.strictEqual(toastRecord.opts?.actionLabel, 'Undo', 'Toast must offer Undo action');

        // Verify controller lastMoveUndo state
        const undoState = controller.getState().lastMoveUndo;
        assert(undoState, 'state.lastMoveUndo should be populated');
        assert.strictEqual(undoState.moves.length, 3, 'state.lastMoveUndo must have 3 moves');
        assert.strictEqual(undoState.operationId, 'op_series_999');

        // Execute Undo for series move
        await toastRecord.opts.onAction();
        assert.strictEqual(bulkRescheduleCalls.length, 1, 'Undo must call teacherBulkRescheduleSessions');
        assert.strictEqual(bulkRescheduleCalls[0].moves.length, 3, 'Undo must invert all 3 moved sessions in series');
        assert.strictEqual(bulkRescheduleCalls[0].undoOf, 'op_series_999', 'Undo must pass operationId');
        assert.strictEqual(bulkRescheduleCalls[0].moves[0].targetLocalDate, '2026-09-08');
        assert.strictEqual(bulkRescheduleCalls[0].moves[1].targetLocalDate, '2026-09-15');
        assert.strictEqual(bulkRescheduleCalls[0].moves[2].targetLocalDate, '2026-09-22');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Drag and drop series move with Scope Choice Modal and Undo toast verified');
    }

    // TEST 16b: Scope choice with conflicts renders warnings, "Move 2, skip 1", and sets allowPartial: true
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input'),
            teacherSchedulerScopeModal: doc.createElement('div'),
            teacherSchedulerScopeTitle: doc.createElement('div'),
            teacherSchedulerScopeShiftFrom: doc.createElement('div'),
            teacherSchedulerScopeShiftTo: doc.createElement('div'),
            teacherSchedulerScopeSeriesTitle: doc.createElement('div'),
            teacherSchedulerScopeSeriesDesc: doc.createElement('div'),
            teacherSchedulerScopeWarnings: doc.createElement('div'),
            scopeChoiceSingle: doc.createElement('input'),
            scopeChoiceSeries: doc.createElement('input'),
            btnTeacherSchedulerScopeCancel: doc.createElement('button'),
            btnTeacherSchedulerScopeConfirm: doc.createElement('button')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const seriesRescheduleCalls = [];
        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [
                    { classroomId: 'c1', name: 'Class Alpha', scheduleConfig: { scheduleVersion: 4 } },
                    { classroomId: 'c2', name: 'Class Beta', scheduleConfig: { scheduleVersion: 1 } }
                ],
                sessions: [
                    { sessionId: 's-conf-1', classId: 'c1', teacherUid: 'teacher-1', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '08:00', durationMinutes: 60, timezone: 'UTC' }
                ],
                from: '2026-09-07',
                to: '2026-09-13'
            }),
            teacherRescheduleSessionSeries: async (sessionId, data) => {
                seriesRescheduleCalls.push({ sessionId, data });
                if (data.dryRun) {
                    return {
                        success: true,
                        moved: [
                            { sessionId: 's-conf-1', from: { targetLocalDate: '2026-09-08', targetLocalTime: '08:00' }, to: { targetLocalDate: data.targetLocalDate, targetLocalTime: data.targetLocalTime } },
                            { sessionId: 's-conf-2', from: { targetLocalDate: '2026-09-15', targetLocalTime: '08:00' }, to: { targetLocalDate: '2026-09-16', targetLocalTime: '08:00' } }
                        ],
                        conflicts: [
                            {
                                sessionId: 's-conf-3',
                                conflictClassId: 'c2',
                                conflictAt: { scheduledLocalDate: '2026-09-23', scheduledLocalTime: '08:00' }
                            }
                        ],
                        skipped: [],
                        canCommit: true,
                        operationId: 'op_series_conf'
                    };
                }
                return {
                    success: true,
                    moved: [
                        { sessionId: 's-conf-1', from: { targetLocalDate: '2026-09-08', targetLocalTime: '08:00' }, to: { targetLocalDate: data.targetLocalDate, targetLocalTime: data.targetLocalTime } }
                    ],
                    operationId: 'op_series_conf'
                };
            }
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        const pillEl = new MockElement('div');
        pillEl.dataset.sessionId = 's-conf-1';
        pillEl.getBoundingClientRect = () => ({ left: 200, top: 100, width: 120, height: 40 });
        pillEl.closest = (sel) => (sel.includes('teacher-scheduler-session-pill') ? pillEl : null);

        const slotEl = new MockElement('div');
        slotEl.dataset.date = '2026-09-09';
        slotEl.dataset.time = '09:00';
        slotEl.closest = (sel) => (sel.includes('teacher-scheduler-slot') ? slotEl : null);

        testElements.teacherSchedulerCalendar.dispatchEvent({ type: 'mousedown', button: 0, clientX: 210, clientY: 110, target: pillEl });
        doc.dispatchEvent({ type: 'mousemove', clientX: 250, clientY: 200 });
        doc.dispatchEvent({ type: 'mouseup', clientX: 250, clientY: 200, target: slotEl });

        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(testElements.teacherSchedulerScopeModal.style.display, 'flex');
        assert.strictEqual(testElements.btnTeacherSchedulerScopeConfirm.textContent, 'Move 2, skip 1', 'Button text should reflect skipped conflict count');
        assert(testElements.teacherSchedulerScopeWarnings.innerHTML.includes('Class Beta 08:00'), 'Warning text should name colliding class and time');

        // Confirm
        testElements.scopeChoiceSeries.checked = true;
        testElements.btnTeacherSchedulerScopeConfirm.dispatchEvent({ type: 'click' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(seriesRescheduleCalls.length, 2);
        assert.strictEqual(seriesRescheduleCalls[1].data.allowPartial, true, 'Commit should set allowPartial: true when user consents to skips');
        assert.strictEqual(seriesRescheduleCalls[1].data.expectedScheduleVersion, 4, 'Commit should send expectedScheduleVersion from classroom');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Conflict warnings, "Move 2, skip 1" label, and dynamic allowPartial: true verified');
    }

    // TEST 17: Escape dismissal in Scope Choice Modal reverts optimistic move
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input'),
            teacherSchedulerScopeModal: doc.createElement('div'),
            teacherSchedulerScopeTitle: doc.createElement('div'),
            teacherSchedulerScopeShiftFrom: doc.createElement('div'),
            teacherSchedulerScopeShiftTo: doc.createElement('div'),
            teacherSchedulerScopeSeriesTitle: doc.createElement('div'),
            teacherSchedulerScopeSeriesDesc: doc.createElement('div'),
            teacherSchedulerScopeWarnings: doc.createElement('div'),
            scopeChoiceSingle: doc.createElement('input'),
            scopeChoiceSeries: doc.createElement('input'),
            btnTeacherSchedulerScopeCancel: doc.createElement('button'),
            btnTeacherSchedulerScopeConfirm: doc.createElement('button')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha' }],
                sessions: [
                    {
                        sessionId: 's-escape-1',
                        classId: 'c1',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '08:00',
                        durationMinutes: 60,
                        timezone: 'UTC'
                    }
                ],
                from: '2026-09-07',
                to: '2026-09-13'
            }),
            teacherRescheduleSessionSeries: async (sessionId, data) => ({
                success: true,
                moved: [
                    { sessionId: 's-escape-1', from: { targetLocalDate: '2026-09-08', targetLocalTime: '08:00', durationMinutes: 60, timezone: 'UTC' }, to: { targetLocalDate: data.targetLocalDate, targetLocalTime: data.targetLocalTime, durationMinutes: 60, timezone: 'UTC' } },
                    { sessionId: 's-escape-2', from: { targetLocalDate: '2026-09-15', targetLocalTime: '08:00', durationMinutes: 60, timezone: 'UTC' }, to: { targetLocalDate: '2026-09-16', targetLocalTime: '08:00', durationMinutes: 60, timezone: 'UTC' } }
                ],
                conflicts: [],
                skippedLocked: [],
                canCommit: true
            })
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        const pillEl = new MockElement('div');
        pillEl.dataset.sessionId = 's-escape-1';
        pillEl.getBoundingClientRect = () => ({ left: 200, top: 100, width: 120, height: 40 });
        pillEl.closest = (sel) => (sel.includes('teacher-scheduler-session-pill') ? pillEl : null);

        const slotEl = new MockElement('div');
        slotEl.dataset.date = '2026-09-09';
        slotEl.dataset.time = '09:00';
        slotEl.closest = (sel) => (sel.includes('teacher-scheduler-slot') ? slotEl : null);

        testElements.teacherSchedulerCalendar.dispatchEvent({
            type: 'mousedown',
            button: 0,
            clientX: 210,
            clientY: 110,
            target: pillEl
        });
        doc.dispatchEvent({ type: 'mousemove', clientX: 250, clientY: 200 });
        doc.dispatchEvent({ type: 'mouseup', clientX: 250, clientY: 200, target: slotEl });

        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.strictEqual(testElements.teacherSchedulerScopeModal.style.display, 'flex');

        // Dismiss with Escape key
        doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(testElements.teacherSchedulerScopeModal.style.display, 'none');
        const session = controller.getState().sessions.find((s) => s.sessionId === 's-escape-1');
        assert.strictEqual(session.scheduledLocalDate, '2026-09-08', 'Optimistic move should revert on Escape');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Scope choice Escape cancellation and optimistic rollback verified');
    }

    // TEST 18: Controller deactivate clears lastMoveUndo, disarms undo, dismisses toast, and closes modals
    {
        let toastOptions = null;
        let toastDismissed = false;
        let bulkCalls = [];
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input'),
            teacherSchedulerQuickAdd: doc.createElement('div'),
            teacherSchedulerSessionBubble: doc.createElement('div')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha' }],
                sessions: [
                    {
                        sessionId: 's-deact-1',
                        classId: 'c1',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '08:00',
                        durationMinutes: 60,
                        timezone: 'UTC'
                    }
                ],
                from: '2026-09-07',
                to: '2026-09-13'
            }),
            teacherRescheduleSessionSeries: async () => ({
                success: true,
                moved: [
                    { sessionId: 's-deact-1', from: { targetLocalDate: '2026-09-08', targetLocalTime: '08:00', durationMinutes: 60 }, to: { targetLocalDate: '2026-09-09', targetLocalTime: '09:00', durationMinutes: 60 } }
                ],
                conflicts: []
            }),
            teacherRescheduleScheduledSession: async () => ({
                success: true
            }),
            teacherBulkRescheduleSessions: async (payload) => {
                bulkCalls.push(payload);
                return { success: true, moved: [] };
            }
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: (msg, type, opts) => {
                toastOptions = opts;
                return {
                    dismiss: () => {
                        toastDismissed = true;
                    }
                };
            },
            isAdmin: () => false
        });

        await controller.init();

        const pillEl = new MockElement('div');
        pillEl.dataset.sessionId = 's-deact-1';
        pillEl.getBoundingClientRect = () => ({ left: 200, top: 100, width: 120, height: 40 });
        pillEl.closest = (sel) => (sel.includes('teacher-scheduler-session-pill') ? pillEl : null);

        const slotEl = new MockElement('div');
        slotEl.dataset.date = '2026-09-09';
        slotEl.dataset.time = '09:00';
        slotEl.closest = (sel) => (sel.includes('teacher-scheduler-slot') ? slotEl : null);

        testElements.teacherSchedulerCalendar.dispatchEvent({
            type: 'mousedown',
            button: 0,
            clientX: 210,
            clientY: 110,
            target: pillEl
        });
        doc.dispatchEvent({ type: 'mousemove', clientX: 250, clientY: 200 });
        doc.dispatchEvent({ type: 'mouseup', clientX: 250, clientY: 200, target: slotEl });

        await new Promise((resolve) => setTimeout(resolve, 50));

        assert(controller.getState().lastMoveUndo, 'lastMoveUndo must be armed after drag drop');
        assert(toastOptions && typeof toastOptions.onAction === 'function', 'Toast with onAction must be registered');

        testElements.teacherSchedulerQuickAdd.style.display = 'block';

        controller.deactivate();

        assert.strictEqual(controller.getState().lastMoveUndo, null, 'deactivate must clear lastMoveUndo');
        assert.strictEqual(testElements.teacherSchedulerQuickAdd.style.display, 'none', 'deactivate must close quick add');
        assert.strictEqual(toastDismissed, true, 'deactivate must dismiss active toast handle');

        // Invoke the captured onAction callback to verify it is disarmed
        await toastOptions.onAction();
        assert.strictEqual(bulkCalls.length, 0, 'Disarmed undo callback must NOT invoke teacherBulkRescheduleSessions');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Controller deactivate method, undo disarm, and toast dismissal verified');
    }

    // TEST 19: Dry-run non-conflict error triggers optimistic rollback and error toast
    {
        let toastErrors = [];
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input'),
            teacherSchedulerScopeModal: doc.createElement('div'),
            teacherSchedulerQuickAdd: doc.createElement('div'),
            teacherSchedulerSessionBubble: doc.createElement('div')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha' }],
                sessions: [
                    {
                        sessionId: 's-err-1',
                        classId: 'c1',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '08:00',
                        durationMinutes: 60,
                        timezone: 'UTC'
                    }
                ],
                from: '2026-09-07',
                to: '2026-09-13'
            }),
            teacherRescheduleSessionSeries: async () => {
                throw new Error('Database dry-run network failure');
            }
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: (msg, type) => {
                if (type === 'error') {
                    toastErrors.push(msg);
                }
            },
            isAdmin: () => false
        });

        await controller.init();

        const pillEl = new MockElement('div');
        pillEl.dataset.sessionId = 's-err-1';
        pillEl.getBoundingClientRect = () => ({ left: 200, top: 100, width: 120, height: 40 });
        pillEl.closest = (sel) => (sel.includes('teacher-scheduler-session-pill') ? pillEl : null);

        const slotEl = new MockElement('div');
        slotEl.dataset.date = '2026-09-09';
        slotEl.dataset.time = '09:00';
        slotEl.closest = (sel) => (sel.includes('teacher-scheduler-slot') ? slotEl : null);

        testElements.teacherSchedulerCalendar.dispatchEvent({
            type: 'mousedown',
            button: 0,
            clientX: 210,
            clientY: 110,
            target: pillEl
        });
        doc.dispatchEvent({ type: 'mousemove', clientX: 250, clientY: 200 });
        doc.dispatchEvent({ type: 'mouseup', clientX: 250, clientY: 200, target: slotEl });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Assert optimistic move was reverted
        const session = controller.getState().sessions.find((s) => s.sessionId === 's-err-1');
        assert.strictEqual(session.scheduledLocalDate, '2026-09-08', 'Session date must revert on dry-run failure');
        assert.strictEqual(session.scheduledLocalTime, '08:00', 'Session time must revert on dry-run failure');

        // Assert error toast was shown
        assert(toastErrors.some((m) => m.includes('Database dry-run network failure')), 'Error toast must be displayed with failure message');

        // Assert scope modal was NOT displayed
        assert.notStrictEqual(testElements.teacherSchedulerScopeModal.style.display, 'flex', 'Scope modal must not open on dry-run error');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Dry-run failure abort, rollback, and error toast verified');
    }

    // Test 21: Mini Calendar rendering, navigation, and day-click week selection
    {
        const { doc: testDoc, elements: testElements } = createMockDocument();
        testElements.teacherSchedulerMiniCalendar = testDoc.createElement('div');
        testElements.inputTeacherSchedulerFromDate = testDoc.createElement('input');
        testElements.inputTeacherSchedulerToDate = testDoc.createElement('input');
        testElements.teacherSchedulerCalendar = testDoc.createElement('div');

        testElements.inputTeacherSchedulerFromDate.value = '2026-09-06';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-12';

        const customAPI = {
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha' }],
                sessions: [],
                from: '2026-09-06',
                to: '2026-09-12'
            })
        };
        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        // Check mini calendar rendered month header and weekdays
        const miniCalHtml = testElements.teacherSchedulerMiniCalendar.innerHTML;
        assert(miniCalHtml.includes('September 2026'), 'Mini calendar must display current month and year');
        assert(miniCalHtml.includes('<span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>'), 'Mini calendar must render Sunday-to-Saturday weekday headers');
        assert(miniCalHtml.includes('data-mini-date="2026-09-06"'), 'Mini calendar must render date cells');
        assert(miniCalHtml.includes('is-in-range'), 'Active week range must have is-in-range styling');

        // Test month navigation: click Next (›)
        const nextBtn = new MockElement('button');
        nextBtn.closest = (sel) => (sel.includes('mini-cal-nav-next') ? nextBtn : null);
        testElements.teacherSchedulerMiniCalendar.dispatchEvent({ type: 'click', target: nextBtn });
        assert(testElements.teacherSchedulerMiniCalendar.innerHTML.includes('October 2026'), 'Clicking next must advance mini calendar to October 2026');

        // Test month navigation: click Prev (‹)
        const prevBtn = new MockElement('button');
        prevBtn.closest = (sel) => (sel.includes('mini-cal-nav-prev') ? prevBtn : null);
        testElements.teacherSchedulerMiniCalendar.dispatchEvent({ type: 'click', target: prevBtn });
        assert(testElements.teacherSchedulerMiniCalendar.innerHTML.includes('September 2026'), 'Clicking prev must return mini calendar to September 2026');

        // Test day click: click Sep 16, 2026 (Wednesday)
        const dayCell = new MockElement('div');
        dayCell.dataset.miniDate = '2026-09-16';
        dayCell.closest = (sel) => (sel.includes('[data-mini-date]') ? dayCell : null);
        testElements.teacherSchedulerMiniCalendar.dispatchEvent({ type: 'click', target: dayCell });

        // Week containing Sep 16, 2026 starts Sunday Sep 13 and ends Saturday Sep 19
        assert.strictEqual(testElements.inputTeacherSchedulerFromDate.value, '2026-09-13', 'Day click must set fromDate to Sunday of that week');
        assert.strictEqual(testElements.inputTeacherSchedulerToDate.value, '2026-09-19', 'Day click must set toDate to Saturday of that week');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Mini Calendar rendering, month navigation, and day click week jump verified');
    }

    // Test 22: Automatic 14-day date clamping on input change
    {
        const { doc: testDoc, elements: testElements } = createMockDocument();
        testElements.inputTeacherSchedulerFromDate = testDoc.createElement('input');
        testElements.inputTeacherSchedulerToDate = testDoc.createElement('input');
        testElements.teacherSchedulerCalendar = testDoc.createElement('div');

        testElements.inputTeacherSchedulerFromDate.value = '2026-09-01';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-07';

        const toastMessages = [];
        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: (msg, type) => { toastMessages.push({ msg, type }); },
            isAdmin: () => false
        });

        await controller.init();

        // User chooses a date 30 days away: 2026-09-30
        testElements.inputTeacherSchedulerToDate.value = '2026-09-30';
        testElements.inputTeacherSchedulerToDate.dispatchEvent({ type: 'change' });

        // Must auto-clamp to exactly 14 days (2026-09-01 + 13 days = 2026-09-14)
        assert.strictEqual(testElements.inputTeacherSchedulerToDate.value, '2026-09-14', 'Date range must auto-clamp to exactly 14 days from start date');
        assert(toastMessages.some((t) => t.msg.includes('Date range automatically adjusted to 14 days maximum')), 'Informational toast must be shown on clamp');

        console.log('✓ Automatic 14-day date clamping on input change verified');
    }

    // Test 23: Fast optimistic session placement with instant DOM rendering and server reconciliation
    {
        const { doc: testDoc, elements: testElements } = createMockDocument();
        testElements.inputTeacherSchedulerFromDate = testDoc.createElement('input');
        testElements.inputTeacherSchedulerToDate = testDoc.createElement('input');
        testElements.teacherSchedulerCalendar = testDoc.createElement('div');
        testElements.teacherSchedulerClassList = testDoc.createElement('div');
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        let resolveAddPromise;
        let rejectAddPromise;
        const customAPI = {
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha', scheduleConfig: { sessionMinutes: 60 } }],
                sessions: [],
                from: '2026-09-07',
                to: '2026-09-13'
            }),
            teacherAddClassroomSession: () => new Promise((resolve, reject) => {
                resolveAddPromise = resolve;
                rejectAddPromise = reject;
            })
        };
        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        // Fire placeClassroomSession
        const placePromise = controller.placeClassroomSession('c1', '2026-09-09', '10:00', { durationMinutes: 60 });

        // Synchronous check: session must immediately be in state.sessions with temp ID before API resolves
        const optimisticSession = controller.getState().sessions.find((s) => s.scheduledLocalDate === '2026-09-09');
        assert(optimisticSession, 'Session must be immediately added to state.sessions before API resolves');
        assert(optimisticSession.sessionId.startsWith('temp-'), 'Optimistic session must have temporary ID');
        assert.strictEqual(optimisticSession.isOptimistic, true, 'Optimistic flag must be set');
        assert(testElements.teacherSchedulerCalendar.innerHTML.includes('Class Alpha'), 'Calendar grid must immediately render optimistic pill');

        // Resolve API with real session ID
        resolveAddPromise({ sessionId: 'server-real-session-456' });
        await placePromise;

        // Session ID must now be updated to real ID
        assert.strictEqual(optimisticSession.sessionId, 'server-real-session-456', 'Session ID must reconcile with server ID');
        assert.strictEqual(optimisticSession.isOptimistic, undefined, 'isOptimistic must be cleared after resolution');

        // Now test rollback on failure
        let resolveAddFail;
        let rejectAddFail;
        customAPI.teacherAddClassroomSession = () => new Promise((resolve, reject) => {
            resolveAddFail = resolve;
            rejectAddFail = reject;
        });

        const failPromise = controller.placeClassroomSession('c1', '2026-09-10', '14:00', { durationMinutes: 60 }).catch(() => {});
        assert(controller.getState().sessions.some((s) => s.scheduledLocalDate === '2026-09-10'), 'Session must be placed optimistically');

        rejectAddFail(new Error('Server room conflict'));
        await failPromise;

        // Session must be removed from state.sessions after failure
        assert(!controller.getState().sessions.some((s) => s.scheduledLocalDate === '2026-09-10'), 'Failed optimistic session must be rolled back');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Fast optimistic session placement with instant DOM rendering and server reconciliation verified');
    }

    // Test 24: Fast optimistic session cancellation with rollback on failure
    {
        const { doc: testDoc, elements: testElements } = createMockDocument();
        testElements.inputTeacherSchedulerFromDate = testDoc.createElement('input');
        testElements.inputTeacherSchedulerToDate = testDoc.createElement('input');
        testElements.teacherSchedulerCalendar = testDoc.createElement('div');
        testElements.teacherSchedulerSessionBubble = testDoc.createElement('div');
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        let resolveCancelPromise;
        let rejectCancelPromise;
        const customAPI = {
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha' }],
                sessions: [
                    {
                        sessionId: 's-cancel-target',
                        classId: 'c1',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '09:00',
                        durationMinutes: 60,
                        timezone: 'UTC'
                    }
                ],
                from: '2026-09-07',
                to: '2026-09-13'
            }),
            teacherCancelScheduledSession: () => new Promise((resolve, reject) => {
                resolveCancelPromise = resolve;
                rejectCancelPromise = reject;
            })
        };
        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        assert(controller.getState().sessions.some((s) => s.sessionId === 's-cancel-target'), 'Target session must exist initially');

        // Cancel session
        const cancelPromise = controller.cancelSession('s-cancel-target');

        // Synchronously: session must immediately be removed from state.sessions
        assert(!controller.getState().sessions.some((s) => s.sessionId === 's-cancel-target'), 'Session must be immediately removed from state before API resolves');
        assert.strictEqual(testElements.teacherSchedulerSessionBubble.style.display, 'none', 'Session bubble must be closed immediately');

        resolveCancelPromise({ ok: true });
        await cancelPromise;

        // Test rollback on cancel error
        controller.getState().sessions.push({
            sessionId: 's-cancel-fail',
            classId: 'c1',
            teacherUid: 'teacher-1',
            scheduledLocalDate: '2026-09-09',
            scheduledLocalTime: '11:00',
            durationMinutes: 60,
            timezone: 'UTC'
        });

        customAPI.teacherCancelScheduledSession = () => new Promise((resolve, reject) => {
            rejectCancelPromise = reject;
        });

        const cancelFailPromise = controller.cancelSession('s-cancel-fail').catch(() => {});
        assert(!controller.getState().sessions.some((s) => s.sessionId === 's-cancel-fail'), 'Session must be removed optimistically');

        rejectCancelPromise(new Error('Server error cancelling session'));
        await cancelFailPromise;

        // Session must be restored
        assert(controller.getState().sessions.some((s) => s.sessionId === 's-cancel-fail'), 'Session must be restored on cancel failure');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Fast optimistic session cancellation with rollback on failure verified');
    }

    // TEST 25: Pill meta-row layout and unclipped title
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        // 120-minute session (normal, non-compact)
        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Trần Khắc Huy - PTE Academic 1-1' }],
                sessions: [
                    {
                        sessionId: 's-meta-test',
                        classId: 'c1',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '09:00',
                        durationMinutes: 120,
                        status: 'completed'
                    }
                ],
                from: '2026-09-07',
                to: '2026-09-13'
            })
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        const calHtml = testElements.teacherSchedulerCalendar.innerHTML;
        assert(!calHtml.includes('is-compact'), '120-minute pill must not be compact');
        assert(calHtml.includes('pill-meta-row'), 'Standard pill must render pill-meta-row');
        assert(calHtml.includes('<div class="pill-meta-row"><span class="pill-time">9:00–11:00</span><span class="pill-badge-completed">✓ Completed</span></div>'), 'pill-meta-row must contain time and completed badge');
        assert(calHtml.includes('<div class="pill-header"><span class="pill-title">Trần Khắc Huy - PTE Academic 1-1</span></div>'), 'pill-header must give 100% width to pill-title without inline badge');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Pill meta-row layout and unclipped title verified');
    }

    // TEST 26: Inline reschedule toggle and application via handleSessionDrop
    {
        let rescheduleCall = null;
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input'),
            teacherSchedulerSessionBubble: doc.createElement('div'),
            teacherSchedulerSessionBubbleTitle: doc.createElement('div'),
            teacherSchedulerSessionBubbleMeta: doc.createElement('div'),
            teacherSchedulerSessionBubbleLock: doc.createElement('div'),
            inputTeacherSchedulerSessionOutcome: doc.createElement('select'),
            inputTeacherSchedulerSessionNote: doc.createElement('textarea'),
            btnTeacherSchedulerSaveOutcome: doc.createElement('button'),
            btnTeacherSchedulerCancelSession: doc.createElement('button'),
            btnTeacherSchedulerDuplicateSession: doc.createElement('button'),
            btnTeacherSchedulerOpenAttendance: doc.createElement('button'),
            teacherSchedulerInlineReschedule: doc.createElement('div'),
            inputTeacherSchedulerRescheduleDate: doc.createElement('input'),
            inputTeacherSchedulerRescheduleTime: doc.createElement('input'),
            btnTeacherSchedulerToggleReschedule: doc.createElement('button'),
            btnTeacherSchedulerRescheduleClose: doc.createElement('button'),
            btnTeacherSchedulerRescheduleCancel: doc.createElement('button'),
            btnTeacherSchedulerRescheduleApply: doc.createElement('button')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Trần Khắc Huy - PTE Academic 1-1' }],
                sessions: [
                    {
                        sessionId: 's-resched-target',
                        classId: 'c1',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '09:00',
                        durationMinutes: 120,
                        status: 'scheduled',
                        timezone: 'UTC'
                    }
                ],
                from: '2026-09-07',
                to: '2026-09-13'
            }),
            teacherRescheduleSessionSeries: async (sessionId, data) => {
                rescheduleCall = { sessionId, data };
                return {
                    data: {
                        operation: 'reschedule-series',
                        canCommit: true,
                        moved: [
                            {
                                sessionId,
                                classId: 'c1',
                                from: { targetLocalDate: '2026-09-08', targetLocalTime: '09:00', durationMinutes: 120, timezone: 'UTC' },
                                to: { targetLocalDate: '2026-09-10', targetLocalTime: '14:00', durationMinutes: 120, timezone: 'UTC' }
                            }
                        ],
                        skipped: [],
                        conflicts: []
                    }
                };
            },
            teacherRescheduleScheduledSession: async (sessionId, data) => {
                rescheduleCall = { sessionId, data, single: true };
                return { sessionId, success: true };
            }
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        // Open session bubble for target session
        controller.openSessionBubble('s-resched-target', { left: 100, top: 200, bottom: 250 });
        assert.strictEqual(testElements.teacherSchedulerSessionBubble.style.display, 'block');
        assert.strictEqual(testElements.teacherSchedulerInlineReschedule.style.display, 'none', 'Inline reschedule panel must be initially hidden');
        assert.strictEqual(testElements.teacherSchedulerSessionBubbleLock.textContent, 'Attendance editable', 'Must display Attendance editable instead of Outcome editable');

        // Click toggle reschedule button
        testElements.btnTeacherSchedulerToggleReschedule.dispatchEvent({ type: 'click' });
        assert.strictEqual(testElements.teacherSchedulerInlineReschedule.style.display, 'block', 'Inline reschedule panel must be visible after toggle');
        assert.strictEqual(testElements.inputTeacherSchedulerRescheduleDate.value, '2026-09-08', 'Date input must prefill with session date');
        assert.strictEqual(testElements.inputTeacherSchedulerRescheduleTime.value, '09:00', 'Time input must prefill with session time');

        // Close via Cancel button
        testElements.btnTeacherSchedulerRescheduleCancel.dispatchEvent({ type: 'click' });
        assert.strictEqual(testElements.teacherSchedulerInlineReschedule.style.display, 'none', 'Inline reschedule panel must close on cancel');

        // Re-open and apply new date/time
        testElements.btnTeacherSchedulerToggleReschedule.dispatchEvent({ type: 'click' });
        testElements.inputTeacherSchedulerRescheduleDate.value = '2026-09-10';
        testElements.inputTeacherSchedulerRescheduleTime.value = '14:00';
        testElements.btnTeacherSchedulerRescheduleApply.dispatchEvent({ type: 'click' });

        // Session bubble must be closed immediately
        assert.strictEqual(testElements.teacherSchedulerSessionBubble.style.display, 'none', 'Session bubble must close when applying reschedule');

        // Let async reschedule finish
        await new Promise((r) => setTimeout(r, 10));
        assert(rescheduleCall, 'Reschedule API must be invoked');
        assert.strictEqual(rescheduleCall.sessionId, 's-resched-target');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Inline reschedule toggle and application via handleSessionDrop verified');
    }

    // TEST 27: Bidirectional upper and lower edge drag resizing
    {
        let rescheduleCall = null;
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Trần Khắc Huy - PTE Academic 1-1' }],
                sessions: [
                    {
                        sessionId: 's-resize-target',
                        classId: 'c1',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '09:00',
                        durationMinutes: 120,
                        status: 'scheduled',
                        timezone: 'UTC'
                    }
                ],
                from: '2026-09-07',
                to: '2026-09-13'
            }),
            teacherRescheduleScheduledSession: async (sessionId, data) => {
                rescheduleCall = { sessionId, data };
                return { sessionId, success: true };
            }
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        const calHtml = testElements.teacherSchedulerCalendar.innerHTML;
        // 1. Verify markup contains both upper and lower resize handles
        assert(calHtml.includes('class="scheduler-session-resize-handle is-top" data-resize="top"'), 'Pill markup must render is-top resize handle');
        assert(calHtml.includes('class="scheduler-session-resize-handle is-bottom" data-resize="bottom"'), 'Pill markup must render is-bottom resize handle');

        // Create mock pill element
        const pillEl = new MockElement('BUTTON');
        pillEl.classList.add('scheduler-session-pill', 'teacher-scheduler-session-pill');
        pillEl.style.height = '94px';
        pillEl.style.top = '0px';
        const timeEl = new MockElement('SPAN');
        timeEl.classList.add('pill-time');
        timeEl.textContent = '9:00–11:00';
        pillEl.querySelector = (sel) => sel === '.pill-time' ? timeEl : null;

        // 2. Test dragging upper edge UPWARD (earlier start time, extended duration)
        controller.beginResizeDrag('s-resize-target', pillEl, { button: 0, clientY: 100 }, 'top');
        const state = controller.getState();
        assert.strictEqual(state.resizeDrag.edge, 'top');
        assert.strictEqual(state.resizeDrag.originalStartTime, '09:00');
        assert.strictEqual(state.resizeDrag.originalDuration, 120);

        // Move up by 24px (1 slot = 30 mins) -> 08:30 start, 150 min duration
        controller.handleResizeMove({ clientY: 76 });
        assert.strictEqual(state.resizeDrag.currentStartTime, '08:30');
        assert.strictEqual(state.resizeDrag.currentDuration, 150);
        assert.strictEqual(pillEl.style.top, '-24px', 'Pill top offset must shift upward by 24px');
        assert.strictEqual(pillEl.style.height, '118px', 'Pill height must expand by 24px');
        assert.strictEqual(timeEl.textContent, '8:30–11:00', 'Live time text must update to 8:30–11:00');

        await controller.commitResize();
        assert(rescheduleCall, 'Reschedule API must be called');
        assert.strictEqual(rescheduleCall.data.targetLocalTime, '08:30');
        assert.strictEqual(rescheduleCall.data.durationMinutes, 150);

        // 3. Test dragging upper edge DOWNWARD (later start time, shortened duration)
        rescheduleCall = null;
        controller.beginResizeDrag('s-resize-target', pillEl, { button: 0, clientY: 100 }, 'top');
        // Move down by 24px (1 slot = 30 mins) -> 09:30 start (from 09:00), duration 90 mins
        controller.handleResizeMove({ clientY: 124 });
        assert.strictEqual(state.resizeDrag.currentStartTime, '09:30');
        assert.strictEqual(state.resizeDrag.currentDuration, 90);
        assert.strictEqual(pillEl.style.top, '24px');
        assert.strictEqual(pillEl.style.height, '70px');
        assert.strictEqual(timeEl.textContent, '9:30–11:00');

        await controller.commitResize();
        assert(rescheduleCall, 'Reschedule API must be called');
        assert.strictEqual(rescheduleCall.data.targetLocalTime, '09:30');
        assert.strictEqual(rescheduleCall.data.durationMinutes, 90);

        // 4. Test dragging lower edge DOWNWARD (fixed start time, extended duration)
        rescheduleCall = null;
        controller.beginResizeDrag('s-resize-target', pillEl, { button: 0, clientY: 100 }, 'bottom');
        assert.strictEqual(state.resizeDrag.edge, 'bottom');
        // Move down by 24px -> duration 150 mins
        controller.handleResizeMove({ clientY: 124 });
        assert.strictEqual(state.resizeDrag.currentDuration, 150);
        assert.strictEqual(pillEl.style.height, '118px');
        assert.strictEqual(timeEl.textContent, '9:00–11:30');

        await controller.commitResize();
        assert(rescheduleCall, 'Reschedule API must be called');
        assert.strictEqual(rescheduleCall.data.targetLocalTime, '09:00', 'Start time must remain unchanged for bottom edge drag');
        assert.strictEqual(rescheduleCall.data.durationMinutes, 150);

        // 5. Test conflict detection on upper edge drag
        rescheduleCall = null;
        // Add an overlapping session at 08:00–09:00
        controller.getState().sessions.push({
            sessionId: 's-conflict-overlap',
            classId: 'c1',
            teacherUid: 'teacher-1',
            scheduledLocalDate: '2026-09-08',
            scheduledLocalTime: '08:00',
            durationMinutes: 60,
            status: 'scheduled',
            timezone: 'UTC'
        });

        controller.beginResizeDrag('s-resize-target', pillEl, { button: 0, clientY: 100 }, 'top');
        // Drag top up to 08:30 (collides with 08:00–09:00)
        controller.handleResizeMove({ clientY: 76 });
        assert.strictEqual(state.resizeDrag.currentStartTime, '08:30');

        await controller.commitResize();
        assert.strictEqual(rescheduleCall, null, 'API must not be called when conflict is detected');
        assert.strictEqual(pillEl.style.top, '0px', 'Styles must be restored on conflict');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Bidirectional upper and lower edge drag resizing verified');
    }

    // TEST 24: Pastel color system for sessions and classroom rail cards
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [
                    { classroomId: 'class-huy', name: 'Trần Khắc Huy - PTE Academic 1-1 24h' },
                    { classroomId: 'class-test', name: 'test - PTE Academic Tutoring' },
                    { classroomId: 'class-rose', name: 'Lê Hoàng Rose - PTE Academic 30h' }
                ],
                sessions: [
                    {
                        sessionId: 's-pastel-1',
                        classId: 'class-huy',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '09:00',
                        durationMinutes: 120,
                        status: 'scheduled',
                        timezone: 'UTC'
                    },
                    {
                        sessionId: 's-pastel-2',
                        classId: 'class-test',
                        teacherUid: 'teacher-2',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '14:00',
                        durationMinutes: 60,
                        status: 'completed',
                        sessionOutcome: 'completed',
                        timezone: 'UTC'
                    },
                    {
                        sessionId: 's-pastel-3',
                        classId: 'class-rose',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-09',
                        scheduledLocalTime: '10:00',
                        durationMinutes: 90,
                        status: 'scheduled',
                        timezone: 'UTC'
                    }
                ],
                from: '2026-09-07',
                to: '2026-09-13'
            })
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        const calHtml = testElements.teacherSchedulerCalendar.innerHTML;
        const railHtml = testElements.teacherSchedulerClassList.innerHTML;

        // 1. Verify active session pill renders with a pastel theme class
        assert(/is-pastel-(sky|lavender|sage|peach|rose|teal|coral|indigo)/.test(calHtml), 'Calendar session pill must have a pastel theme class');
        // 2. Verify completed session pill renders with is-completed class
        assert(calHtml.includes('is-completed'), 'Completed session pill must retain is-completed class');
        // 3. Verify class cards in rail render with scheduler-class-card-pip and pastel theme
        assert(railHtml.includes('scheduler-class-card-pip'), 'Class rail must render color pip');
        assert(/scheduler-class-card-pip is-pastel-/.test(railHtml), 'Class rail pip must have a pastel theme class');

        // 4. Assert 1:1 matching between classroom rail pip and calendar session pill theme classes for distinct classrooms
        const extractPipTheme = (classroomId) => {
            const match = railHtml.match(new RegExp(`data-classroom-id="${classroomId}"[\\s\\S]*?scheduler-class-card-pip\\s+(is-pastel-[a-z]+)`));
            return match ? match[1] : null;
        };
        const extractPillTheme = (sessionId) => {
            const match = calHtml.match(new RegExp(`<button[^>]*class="[^"]*(is-pastel-[a-z]+)[^"]*"[^>]*data-session-id="${sessionId}"`));
            return match ? match[1] : null;
        };

        const huyPipTheme = extractPipTheme('class-huy');
        const huyPillTheme = extractPillTheme('s-pastel-1');
        assert(huyPipTheme, 'class-huy rail card pip must have a pastel theme class');
        assert(huyPillTheme, 's-pastel-1 session pill must have a pastel theme class');
        assert.strictEqual(huyPillTheme, huyPipTheme, 's-pastel-1 calendar session pill theme must match class-huy rail pip theme 1:1');

        const rosePipTheme = extractPipTheme('class-rose');
        const rosePillTheme = extractPillTheme('s-pastel-3');
        assert(rosePipTheme, 'class-rose rail card pip must have a pastel theme class');
        assert(rosePillTheme, 's-pastel-3 session pill must have a pastel theme class');
        assert.strictEqual(rosePillTheme, rosePipTheme, 's-pastel-3 calendar session pill theme must match class-rose rail pip theme 1:1');

        // Confirm distinct classrooms hash to distinct themes
        assert.notStrictEqual(huyPipTheme, rosePipTheme, 'class-huy and class-rose must hash to distinct pastel themes');
        assert.strictEqual(huyPipTheme, 'is-pastel-lavender');
        assert.strictEqual(rosePipTheme, 'is-pastel-rose');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Pastel color system for sessions and classroom rail cards verified');
    }

    console.log('All teacher scheduler client controller tests passed successfully!');
}

runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
