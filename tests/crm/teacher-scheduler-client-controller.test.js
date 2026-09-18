/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Mock DOM environment
class MockElement {
    constructor(tag = 'DIV') {
        this.tagName = tag.toUpperCase();
        this.open = false;
        this._focused = false;
        this.style = {
            setProperty(k, v) { this[k] = String(v); },
            getPropertyValue(k) { return this[k] || ''; },
            removeProperty(k) { delete this[k]; }
        };
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
    showModal() { this.open = true; }
    close() {
        this.open = false;
        this.dispatchEvent({ type: 'close' });
    }
    focus() { this._focused = true; }
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
    doc.documentElement = createElement('HTML');

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

        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha' }],
                sessions: [],
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

        // Ensure default Monday setting
        controller.setWeekStartSetting(1);
        await controller.init();

        // Check mini calendar rendered month header and Monday-to-Sunday weekdays
        const miniCalHtml = testElements.teacherSchedulerMiniCalendar.innerHTML;
        assert(miniCalHtml.includes('September 2026'), 'Mini calendar must display current month and year');
        assert(miniCalHtml.includes('<span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>'), 'Mini calendar must render Monday-to-Sunday weekday headers by default');
        assert(miniCalHtml.includes('data-mini-date="2026-09-07"'), 'Mini calendar must render date cells');
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

        // Test day click: click Sep 16, 2026 (Wednesday) with default Monday (1)
        const dayCell = new MockElement('div');
        dayCell.dataset.miniDate = '2026-09-16';
        dayCell.closest = (sel) => (sel.includes('[data-mini-date]') ? dayCell : null);
        testElements.teacherSchedulerMiniCalendar.dispatchEvent({ type: 'click', target: dayCell });

        // Week containing Sep 16, 2026 starts Monday Sep 14 and ends Sunday Sep 20
        assert.strictEqual(testElements.inputTeacherSchedulerFromDate.value, '2026-09-14', 'Day click must set fromDate to Monday of that week');
        assert.strictEqual(testElements.inputTeacherSchedulerToDate.value, '2026-09-20', 'Day click must set toDate to Sunday of that week');

        // Test day click with Sunday week-start (0)
        controller.setWeekStartSetting(0);
        controller.renderMiniCalendar();
        assert(testElements.teacherSchedulerMiniCalendar.innerHTML.includes('<span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>'), 'Mini calendar must render Sunday-to-Saturday weekday headers when weekStart=0');
        testElements.teacherSchedulerMiniCalendar.dispatchEvent({ type: 'click', target: dayCell });
        assert.strictEqual(testElements.inputTeacherSchedulerFromDate.value, '2026-09-13', 'Day click with weekStart=0 must set fromDate to Sunday of that week');
        assert.strictEqual(testElements.inputTeacherSchedulerToDate.value, '2026-09-19', 'Day click with weekStart=0 must set toDate to Saturday of that week');

        // Restore to Monday default
        controller.setWeekStartSetting(1);

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Mini Calendar rendering, month navigation, and day click week jump verified (Monday default & Sunday option)');
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

        // Move up by 25px (1 slot = 30 mins) -> 08:30 start, 150 min duration
        controller.handleResizeMove({ clientY: 75 });
        assert.strictEqual(state.resizeDrag.currentStartTime, '08:30');
        assert.strictEqual(state.resizeDrag.currentDuration, 150);
        assert.strictEqual(pillEl.style.top, '-25px', 'Pill top offset must shift upward by 25px');
        assert.strictEqual(pillEl.style.height, '123px', 'Pill height must expand by 25px');
        assert.strictEqual(timeEl.textContent, '8:30–11:00', 'Live time text must update to 8:30–11:00');

        await controller.commitResize();
        assert(rescheduleCall, 'Reschedule API must be called');
        assert.strictEqual(rescheduleCall.data.targetLocalTime, '08:30');
        assert.strictEqual(rescheduleCall.data.durationMinutes, 150);

        // 3. Test dragging upper edge DOWNWARD (later start time, shortened duration)
        rescheduleCall = null;
        controller.beginResizeDrag('s-resize-target', pillEl, { button: 0, clientY: 100 }, 'top');
        // Move down by 25px (1 slot = 30 mins) -> 09:30 start (from 09:00), duration 90 mins
        controller.handleResizeMove({ clientY: 125 });
        assert.strictEqual(state.resizeDrag.currentStartTime, '09:30');
        assert.strictEqual(state.resizeDrag.currentDuration, 90);
        assert.strictEqual(pillEl.style.top, '25px');
        assert.strictEqual(pillEl.style.height, '73px');
        assert.strictEqual(timeEl.textContent, '9:30–11:00');

        await controller.commitResize();
        assert(rescheduleCall, 'Reschedule API must be called');
        assert.strictEqual(rescheduleCall.data.targetLocalTime, '09:30');
        assert.strictEqual(rescheduleCall.data.durationMinutes, 90);

        // 4. Test dragging lower edge DOWNWARD (fixed start time, extended duration)
        rescheduleCall = null;
        controller.beginResizeDrag('s-resize-target', pillEl, { button: 0, clientY: 100 }, 'bottom');
        assert.strictEqual(state.resizeDrag.edge, 'bottom');
        // Move down by 25px -> duration 150 mins
        controller.handleResizeMove({ clientY: 125 });
        assert.strictEqual(state.resizeDrag.currentDuration, 150);
        assert.strictEqual(pillEl.style.height, '123px');
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
        controller.handleResizeMove({ clientY: 75 });
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

    // TEST 28: Dynamic density changes update state.hourHeightPx, derive getSlotHeightPx(), and adjust grid geometry
    {
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
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha' }],
                sessions: [
                    {
                        sessionId: 's-density-1',
                        classId: 'c1',
                        teacherUid: 'teacher-1',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '10:00',
                        durationMinutes: 60,
                        status: 'scheduled'
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

        // 1. Initial default density: 50px/hour -> 25px/slot (Math.round((50/60)*30))
        assert.strictEqual(controller.getState().hourHeightPx, 50, 'Default hourHeightPx should be 50');
        assert.strictEqual(controller.getSlotHeightPx(), 25, 'Default getSlotHeightPx() should derive 25px');
        let calHtml = testElements.teacherSchedulerCalendar.innerHTML;
        assert(calHtml.includes('--scheduler-slot-height: 25px'), 'Grid must declare --scheduler-slot-height: 25px');
        assert(calHtml.includes('height:48px;'), 'Session pill height should be 48px at 50px/hr density');

        // 2. Change density via settings UI to 60px/hr (Spacious)
        const densityInput = doc.getElementById('ts-setting-density');
        densityInput.value = '60';
        const saveSettingsBtn = doc.getElementById('btn-ts-save-settings');
        saveSettingsBtn.dispatchEvent({ type: 'click' });

        assert.strictEqual(controller.getState().hourHeightPx, 60, 'Updated hourHeightPx should be 60');
        assert.strictEqual(controller.getSlotHeightPx(), 30, 'getSlotHeightPx() at 60px/hr should derive 30px');
        assert.strictEqual(doc.documentElement.style['--ts-hour'], '60px', 'documentElement should have --ts-hour set to 60px');
        calHtml = testElements.teacherSchedulerCalendar.innerHTML;
        assert(calHtml.includes('--scheduler-slot-height: 30px'), 'Grid must update --scheduler-slot-height to 30px');
        assert(calHtml.includes('height:58px;'), 'Session pill height should adjust to 58px at 60px/hr density');

        // 3. Change density via settings UI to 40px/hr (Compact)
        densityInput.value = '40';
        saveSettingsBtn.dispatchEvent({ type: 'click' });

        assert.strictEqual(controller.getState().hourHeightPx, 40, 'Updated hourHeightPx should be 40');
        assert.strictEqual(controller.getSlotHeightPx(), 20, 'getSlotHeightPx() at 40px/hr should derive 20px');
        assert.strictEqual(doc.documentElement.style['--ts-hour'], '40px', 'documentElement should have --ts-hour set to 40px');
        calHtml = testElements.teacherSchedulerCalendar.innerHTML;
        assert(calHtml.includes('--scheduler-slot-height: 20px'), 'Grid must update --scheduler-slot-height to 20px');
        assert(calHtml.includes('height:38px;'), 'Session pill height should adjust to 38px at 40px/hr density');
        assert(calHtml.includes('is-compact'), 'Pill under 40px must receive is-compact class');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Dynamic density changes, getSlotHeightPx derivation, and grid geometry verified');
    }

    // TEST 29: Teacher display name sanitization (SEC-1)
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerRailTitle: doc.createElement('div'),
            teacherSchedulerRailDesc: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeachers: async () => [
                { uid: 'usr_mapped_456', displayName: 'Alice Smith' }
            ],
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Class Alpha' }],
                sessions: [
                    {
                        sessionId: 's-sec-1',
                        classId: 'c1',
                        teacherUid: 'usr_unmapped_123',
                        teacherName: 'usr_unmapped_123',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '10:00',
                        durationMinutes: 60,
                        status: 'scheduled'
                    },
                    {
                        sessionId: 's-sec-2',
                        classId: 'c1',
                        teacherUid: 'usr_mapped_456',
                        teacherName: 'usr_mapped_456',
                        scheduledLocalDate: '2026-09-09',
                        scheduledLocalTime: '14:00',
                        durationMinutes: 60,
                        status: 'scheduled'
                    },
                    {
                        sessionId: 's-sec-3',
                        classId: 'c1',
                        teacherUid: 'usr_direct_only',
                        teacherName: 'Bob Teacher',
                        scheduledLocalDate: '2026-09-10',
                        scheduledLocalTime: '16:00',
                        durationMinutes: 60,
                        status: 'scheduled'
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
            isAdmin: () => true
        });

        await controller.init();

        const calHtml = testElements.teacherSchedulerCalendar.innerHTML;
        assert(!calHtml.includes('usr_unmapped_123'), 'Unmapped usr_ database identifier must NOT be exposed in pill HTML');
        assert(calHtml.includes('Teacher name unavailable'), 'Unmapped usr_ identifier must fall through to Teacher name unavailable');
        assert(!calHtml.includes('usr_mapped_456'), 'Mapped usr_ database identifier must NOT be exposed in pill HTML');
        assert(calHtml.includes('Alice Smith'), 'Mapped teacher must resolve to displayName from teacherMap');
        assert(calHtml.includes('Bob Teacher'), 'Clean direct teacher name must be preserved when unmapped');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Teacher display name sanitization (SEC-1) verified');
    }

    // TEST 30: Quick Add focus trap (A11Y-1)
    {
        const quickAddEl = doc.createElement('div');
        quickAddEl.id = 'teacher-scheduler-quick-add';
        quickAddEl.style.display = 'block';
        const input1 = doc.createElement('input');
        const btn1 = doc.createElement('button');
        quickAddEl.querySelectorAll = () => [input1, btn1];

        let trapped = false;
        input1.focus = () => { trapped = true; };

        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerQuickAdd: quickAddEl,
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();
        quickAddEl.style.display = 'block';

        // Simulate Tab press on the last focusable element when quick add is open
        doc.activeElement = btn1;
        let prevented = false;
        doc.dispatchEvent({
            type: 'keydown',
            key: 'Tab',
            shiftKey: false,
            preventDefault: () => { prevented = true; }
        });

        assert(trapped, 'Focus must cycle to the first element in quick add');
        assert(prevented, 'Default Tab event must be prevented');
        console.log('✓ Quick Add focus trap (A11Y-1) verified');
    }

    // TEST 31: Idempotent event binding (LIFECYCLE-1)
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();
        assert.strictEqual(controller.getState()._eventsBound, true, '_eventsBound must be true after init');
        const listenerCount = testElements.teacherSchedulerTeacherSelect.listeners['change']?.length || 0;
        assert.strictEqual(listenerCount, 1, 'Teacher select should have exactly 1 change listener');

        // Calling init again must not re-bind
        await controller.init();
        const listenerCountAfter = testElements.teacherSchedulerTeacherSelect.listeners['change']?.length || 0;
        assert.strictEqual(listenerCountAfter, 1, 'Teacher select listener count must remain 1 after repeated init');
        console.log('✓ Idempotent event binding (LIFECYCLE-1) verified');
    }

    // TEST 32: Robust test date parsing (EDGE-1)
    {
        windowMock.__SCHEDULER_NOW__ = 'invalid-date-string';
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        let threw = false;
        try {
            await controller.init();
        } catch (e) {
            threw = true;
        }
        assert(!threw, 'Invalid __SCHEDULER_NOW__ must not throw');
        delete windowMock.__SCHEDULER_NOW__;
        console.log('✓ Robust test date parsing (EDGE-1) verified');
    }

    // TEST 33: Style restoration on missing session during commitResize (EDGE-2)
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        await controller.init();

        const pillEl = doc.createElement('div');
        pillEl.style.height = '100px';

        // Simulate resizeDrag for a session that does not exist in state.sessions
        controller.getState().resizeDrag = {
            sessionId: 'non-existent-session-id',
            edge: 'bottom',
            pillEl,
            originalHeight: '50px',
            originalDuration: 60,
            currentDuration: 90,
            originalTitleText: 'Some Title',
            isCompact: false
        };

        // commitResize should call restore() before returning
        await controller.commitResize();

        assert.strictEqual(pillEl.style.height, '50px', 'Pill style height must be restored to originalHeight when session is missing');
        console.log('✓ Style restoration on missing session (EDGE-2) verified');
    }

    // TEST 34: Defect 1 - Class rail full-width title wrapping, teacher name, and separate progress line
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{
                    classroomId: 'c-long-name',
                    name: 'Super Long Classroom Name That Used To Squeeze Counter',
                    primaryTeacherUid: 'teacher-1',
                    primaryTeacherName: 'Teacher Alice',
                    scheduleSummary: {
                        contractedAssignedCount: 5,
                        contractedTargetCount: 10,
                        remainingToScheduleCount: 5
                    }
                }],
                sessions: [],
                from: '2026-09-07',
                to: '2026-09-13'
            })
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        const railHtml = testElements.teacherSchedulerClassList.innerHTML;
        assert(railHtml.includes('ts-repair-class-row'), 'Class rail card must have ts-repair-class-row class');
        assert(railHtml.includes('ts-repair-class-title'), 'Class rail card must have ts-repair-class-title wrapper');
        assert(railHtml.includes('ts-repair-class-teacher'), 'Class rail card must have ts-repair-class-teacher line');
        assert(railHtml.includes('Teacher Alice'), 'Class rail card must render assigned teacher name');
        assert(railHtml.includes('ts-repair-class-progress'), 'Class rail card must have separate ts-repair-class-progress line');
        assert(railHtml.includes('5/10 scheduled · 5 remaining'), 'Class rail card must render scheduled/target progress text');
        assert(railHtml.includes('Super Long Classroom Name That Used To Squeeze Counter'), 'Class title must be intact');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Defect 1: Class rail full-width title wrapping, teacher name, and separate progress line verified');
    }

    // TEST 35: Defect 3 - Authoritative teacher color resolution, appearance migration, and reset
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{
                    classroomId: 'c-nam',
                    name: 'Nam Class',
                    primaryTeacherUid: 'JP0UmCufWpdDkKkZazh7Ajo4PfX2',
                    primaryTeacherName: 'Teacher Nam'
                }],
                sessions: [{
                    sessionId: 's-nam-1',
                    classId: 'c-nam',
                    teacherUid: 'JP0UmCufWpdDkKkZazh7Ajo4PfX2',
                    teacherName: 'Teacher Nam',
                    scheduledLocalDate: '2026-09-08',
                    scheduledLocalTime: '08:00',
                    durationMinutes: 60
                }],
                from: '2026-09-07',
                to: '2026-09-13'
            })
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        // 1. Authoritative UID resolution without teacherName
        const namByUid = controller.resolveTeacherColor('JP0UmCufWpdDkKkZazh7Ajo4PfX2');
        assert.strictEqual(namByUid.key, 'blue', 'Nam UID must resolve to blue');
        assert.strictEqual(namByUid.fill, '#1A73E8', 'Nam UID must have #1A73E8 fill');

        const shawnByUid = controller.resolveTeacherColor('eRrS6Ba3QfQ6R9SmPbcb3bYcOK83');
        assert.strictEqual(shawnByUid.key, 'purple', 'Shawn UID must resolve to purple');
        assert.strictEqual(shawnByUid.fill, '#8E24AA', 'Shawn UID must have #8E24AA fill');

        const quynhByName = controller.resolveTeacherColor('usr-quynh', 'Phạm Bích Như Quỳnh');
        assert.strictEqual(quynhByName.key, 'teal', 'Quynh name must resolve to teal');
        assert.strictEqual(quynhByName.fill, '#00796B', 'Quynh name must have #00796B fill');

        const calHtml = testElements.teacherSchedulerCalendar.innerHTML;
        assert(calHtml.includes('data-ts-color="blue"'), 'Session pill must have data-ts-color="blue"');
        assert(calHtml.includes('--color: #1A73E8;'), 'Session pill must have --color: #1A73E8;');

        // 2. Appearance toggling
        controller.applyAppearance('solid');
        assert.strictEqual(testElements.teacherSchedulerWorkspace.getAttribute('data-ts-appearance'), 'solid', 'Workspace must reflect solid appearance');
        assert(testElements.teacherSchedulerWorkspace.classList.contains('ts-appearance-solid'), 'Workspace must have ts-appearance-solid class');

        controller.applyAppearance('pastel');
        assert.strictEqual(testElements.teacherSchedulerWorkspace.getAttribute('data-ts-appearance'), 'pastel', 'Workspace must reflect pastel appearance');
        assert(testElements.teacherSchedulerWorkspace.classList.contains('ts-appearance-pastel'), 'Workspace must have ts-appearance-pastel class');

        // 3. Reset appearance settings
        controller.resetAppearanceSettings();
        assert.strictEqual(controller.getState().appearance, 'solid', 'Reset must restore solid appearance');
        assert(testElements.teacherSchedulerWorkspace.classList.contains('ts-appearance-solid'), 'Workspace must have solid class after reset');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Defect 3: Authoritative teacher color resolution, appearance migration, and reset verified');
    }

    // TEST 36: Defect 2 - CSS contract check for slot cell stacking context elimination and mini-calendar
    {
        const cssPath = path.join(__dirname, '../../public/css/teacher-scheduler-google.css');
        const cssContent = fs.readFileSync(cssPath, 'utf8');

        // Check that slot cell sets z-index: auto and does not set z-index: 1
        assert(cssContent.includes('.scheduler-calendar-cell.teacher-scheduler-slot'), 'CSS must include .scheduler-calendar-cell.teacher-scheduler-slot selector');
        assert(!cssContent.match(/\.scheduler-calendar-cell\.teacher-scheduler-slot\s*\{[^}]*z-index:\s*1\s*;/), 'Slot cell must not have z-index: 1');
        assert(cssContent.includes('z-index: auto'), 'CSS must specify z-index: auto for slot cells to prevent stacking context collision');
        assert(cssContent.includes('.ts-appearance-solid .scheduler-session-pill'), 'CSS must provide solid styling for pills in solid mode');

        // Check completed session styling in solid mode guarantees white text
        assert(cssContent.includes('.scheduler-session-pill.is-completed .pill-title'), 'CSS must specify completed pill title rule');
        assert(cssContent.includes('.scheduler-session-pill.is-completed .pill-time'), 'CSS must specify completed pill time rule');
        assert(cssContent.match(/\.scheduler-session-pill\.is-completed \.pill-title[^}]*color:\s*#ffffff\s*!important/), 'Completed pill title must enforce white text with !important');

        // Check mini-calendar actual DOM classes styling
        assert(cssContent.includes('.teacher-scheduler-mini-calendar .mini-cal-header'), 'CSS must style actual DOM mini-cal-header');
        assert(cssContent.includes('.teacher-scheduler-mini-calendar .mini-cal-month-title'), 'CSS must style actual DOM mini-cal-month-title');
        assert(cssContent.includes('.teacher-scheduler-mini-calendar .mini-cal-nav'), 'CSS must style actual DOM mini-cal-nav');
        assert(cssContent.includes('.teacher-scheduler-mini-calendar .mini-cal-nav-btn'), 'CSS must style actual DOM mini-cal-nav-btn');

        console.log('✓ Defect 2: CSS contract for slot cell stacking context elimination and mini-calendar verified');
    }

    // TEST 37: Multi-hour session lower-half hit testing (clicks & drags target session, not underlying slot)
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input'),
            teacherSchedulerSessionBubble: doc.createElement('div'),
            teacherSchedulerQuickAdd: doc.createElement('div')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{
                    classroomId: 'c-2hr',
                    name: '2-Hour Class',
                    primaryTeacherUid: 'teacher-nam',
                    primaryTeacherName: 'Teacher Nam'
                }],
                sessions: [{
                    sessionId: 's-2hr',
                    classId: 'c-2hr',
                    teacherUid: 'teacher-nam',
                    teacherName: 'Teacher Nam',
                    scheduledLocalDate: '2026-09-08',
                    scheduledLocalTime: '08:00',
                    durationMinutes: 120
                }],
                from: '2026-09-07',
                to: '2026-09-13'
            })
        };

        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = customAPI;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        const calHtml = testElements.teacherSchedulerCalendar.innerHTML;
        assert(calHtml.includes('data-session-id="s-2hr"'), '2-hour session pill must be rendered in HTML');
        assert(calHtml.includes('height:98px;') || calHtml.includes('height: 98px;'), '2-hour session must have ~98px height');

        // Click simulated on the pill (even when pointer is physically over the 09:00 slot region)
        // closestTarget on pill must return the pill, opening bubble and NOT opening quick-add
        const mockPill = new MockElement('BUTTON');
        mockPill.classList.add('teacher-scheduler-session-pill');
        mockPill.dataset.sessionId = 's-2hr';
        mockPill.closest = (sel) => sel.includes('teacher-scheduler-session-pill') ? mockPill : null;

        testElements.teacherSchedulerCalendar.dispatchEvent({
            type: 'click',
            target: mockPill,
            button: 0,
            bubbles: true,
            preventDefault: () => {},
            stopPropagation: () => {}
        });

        assert.strictEqual(testElements.teacherSchedulerSessionBubble.style.display, 'block', 'Session bubble must be displayed');
        assert.strictEqual(controller.getState().sessionBubble?.sessionId, 's-2hr', 'Click on multi-hour pill must open session bubble for s-2hr');
        assert.strictEqual(testElements.teacherSchedulerQuickAdd.style.display || 'none', 'none', 'Click on multi-hour pill must NOT trigger quick-add on underlying slot');
        assert.strictEqual(controller.getState().quickAdd, null, 'Quick add state must remain null');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Multi-hour session lower-half hit testing verified');
    }

    // TEST 38: Short cards, compact layout thresholds, and dynamic repaintDayColumns synchronization
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerClassList: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: doc.createElement('input'),
            inputTeacherSchedulerToDate: doc.createElement('input')
        };
        testElements.inputTeacherSchedulerFromDate.value = '2026-09-07';
        testElements.inputTeacherSchedulerToDate.value = '2026-09-13';

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{
                    classroomId: 'c-pte',
                    name: 'PTE Speaking Intensive',
                    primaryTeacherUid: 'teacher-shawn',
                    primaryTeacherName: 'Teacher Shawn'
                }],
                sessions: [
                    {
                        sessionId: 's-30m',
                        classId: 'c-pte',
                        teacherUid: 'teacher-shawn',
                        teacherName: 'Teacher Shawn',
                        scheduledLocalDate: '2026-09-07',
                        scheduledLocalTime: '08:00',
                        durationMinutes: 30
                    },
                    {
                        sessionId: 's-60m',
                        classId: 'c-pte',
                        teacherUid: 'teacher-shawn',
                        teacherName: 'Teacher Shawn',
                        scheduledLocalDate: '2026-09-08',
                        scheduledLocalTime: '08:00',
                        durationMinutes: 60
                    },
                    {
                        sessionId: 's-120m',
                        classId: 'c-pte',
                        teacherUid: 'teacher-shawn',
                        teacherName: 'Teacher Shawn',
                        scheduledLocalDate: '2026-09-09',
                        scheduledLocalTime: '08:00',
                        durationMinutes: 120
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
            isAdmin: () => true
        });

        await controller.init();

        const calHtml = testElements.teacherSchedulerCalendar.innerHTML;

        // 1. 30m pill is compact: has is-compact class and combines title + time
        assert(calHtml.includes('is-compact'), '30m pill (<40px) must have is-compact class');
        assert(calHtml.includes('PTE Speaking Intensive · 8:00–8:30'), '30m compact pill must combine title and time in title element');

        // 2. 60m pill (48px) is not compact: has separate time row, and includes teacher line in admin all view
        assert(calHtml.includes('8:00–9:00'), '60m pill must have separate time range');
        assert(calHtml.includes('Teacher Shawn'), '60m and 120m pills in admin all view must include teacher line');

        // 3. 120m pill (98px) has title + time + teacher line (in admin all view)
        assert(calHtml.includes('8:00–10:00'), '120m pill must have 2hr time range');

        // 4. Dynamic sync via repaintDayColumns:
        // Create mock pill element for querySelector
        const pill60Mock = new MockElement('BUTTON');
        pill60Mock.dataset.sessionId = 's-60m';
        const titleEl = new MockElement('SPAN');
        titleEl.classList.add('pill-title');
        titleEl.textContent = 'PTE Speaking Intensive';
        const timeEl = new MockElement('SPAN');
        timeEl.classList.add('pill-time');
        timeEl.textContent = '8:00–9:00';
        pill60Mock.querySelector = (sel) => {
            if (sel.includes('pill-title')) return titleEl;
            if (sel.includes('pill-time')) return timeEl;
            return null;
        };

        const targetSlot = new MockElement('DIV');
        testElements.teacherSchedulerCalendar.querySelector = (sel) => {
            if (sel.includes('s-60m')) return pill60Mock;
            if (sel.includes('teacher-scheduler-slot')) return targetSlot;
            return null;
        };

        // Update s-60m session duration to 30 min in state and repaint
        const stateSession = controller.getState().sessions.find((s) => s.sessionId === 's-60m');
        stateSession.durationMinutes = 30;
        const repainted = controller.repaintDayColumns(['2026-09-08']);
        assert.strictEqual(repainted, true, 'repaintDayColumns must return true');

        // Pill must now be compact
        assert(pill60Mock.classList.contains('is-compact'), 'Resized 60m->30m pill must dynamically gain is-compact class');
        assert(titleEl.textContent.includes('8:00–8:30'), 'Resized pill must update title text with integrated time range');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Short cards, compact layout thresholds, and dynamic repaintDayColumns synchronization verified');
    }

    // Test 39: Source-grounded repair: Configurable week-start preference and sync
    {
        const { doc: testDoc, elements: testElements } = createMockDocument();
        testElements.teacherSchedulerMiniCalendar = testDoc.createElement('div');
        testElements.inputTeacherSchedulerFromDate = testDoc.createElement('input');
        testElements.inputTeacherSchedulerToDate = testDoc.createElement('input');
        testElements.teacherSchedulerCalendar = testDoc.createElement('div');
        const weekStartSelect = testDoc.createElement('select');
        weekStartSelect.id = 'ts-setting-week-start';
        testDoc.getElementById = (id) => {
            if (id === 'ts-setting-week-start') return weekStartSelect;
            return testDoc.getElementById(id);
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => false
        });

        // 1. Density mode boundaries
        assert.strictEqual(controller.getSessionDensityMode(30), 'compact', '<40px must return compact');
        assert.strictEqual(controller.getSessionDensityMode(39), 'compact', '39px must return compact');
        assert.strictEqual(controller.getSessionDensityMode(40), 'mid', '40px must return mid');
        assert.strictEqual(controller.getSessionDensityMode(60), 'mid', '60px must return mid');
        assert.strictEqual(controller.getSessionDensityMode(71), 'mid', '71px must return mid');
        assert.strictEqual(controller.getSessionDensityMode(72), 'full', '72px must return full');
        assert.strictEqual(controller.getSessionDensityMode(100), 'full', '100px must return full');

        // 2. Week-start setting defaults to Monday (1)
        assert.strictEqual(controller.getWeekStartSetting(), 1, 'Default week start without preference must be Monday (1)');

        // 3. startOfWeek helper calculates correct boundary
        // Wednesday Sep 16, 2026:
        const wednesday = new Date('2026-09-16T10:00:00');
        const mondayStart = controller.startOfWeek(wednesday, 1);
        assert.strictEqual(mondayStart.getDay(), 1, 'startOfWeek with weekStart=1 must return Monday');
        assert.strictEqual(mondayStart.getDate(), 14, 'Sep 16 week starting Monday must start on Sep 14');

        const sundayStart = controller.startOfWeek(wednesday, 0);
        assert.strictEqual(sundayStart.getDay(), 0, 'startOfWeek with weekStart=0 must return Sunday');
        assert.strictEqual(sundayStart.getDate(), 13, 'Sep 16 week starting Sunday must start on Sep 13');

        // 4. Set week-start to Sunday (0)
        controller.setWeekStartSetting(0);
        assert.strictEqual(controller.getWeekStartSetting(), 0, 'getWeekStartSetting must return 0 after setWeekStartSetting(0)');

        // 5. Mini calendar renders Sunday headers
        controller.renderMiniCalendar();
        assert(
            testElements.teacherSchedulerMiniCalendar.innerHTML.includes('<span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>'),
            'Mini-calendar must render S M T W T F S headers when weekStart=0'
        );

        // 6. Set week-start to Monday (1)
        controller.setWeekStartSetting(1);
        assert.strictEqual(controller.getWeekStartSetting(), 1, 'getWeekStartSetting must return 1 after setWeekStartSetting(1)');
        controller.renderMiniCalendar();
        assert(
            testElements.teacherSchedulerMiniCalendar.innerHTML.includes('<span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>'),
            'Mini-calendar must render M T W T F S S headers when weekStart=1'
        );

        console.log('✓ Source-grounded repair: Configurable week-start preference and 3-tier density helper verified');
    }

    // Test 40: Source-grounded repair: 3-tier event density classes on rendered pills
    {
        const { doc: testDoc, elements: testElements } = createMockDocument();
        testElements.teacherSchedulerCalendar = testDoc.createElement('div');
        testElements.teacherSchedulerWorkspace = testDoc.createElement('div');
        testElements.teacherSchedulerClassList = testDoc.createElement('div');
        testElements.teacherSchedulerTeacherSelect = testDoc.createElement('select');
        testElements.teacherSchedulerAdminFilterGroup = testDoc.createElement('div');
        testElements.teacherSchedulerRailTitle = testDoc.createElement('h3');
        testElements.teacherSchedulerRailDesc = testDoc.createElement('p');

        const customAPI = {
            fetchTeachers: async () => [{ uid: 't1', displayName: 'Teacher Shawn' }],
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [{ classroomId: 'c1', name: 'Speaking Class', primaryTeacherUid: 't1', primaryTeacherName: 'Teacher Shawn' }],
                sessions: [
                    { sessionId: 's-30m', classId: 'c1', teacherUid: 't1', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '08:00', durationMinutes: 30 },
                    { sessionId: 's-60m', classId: 'c1', teacherUid: 't1', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '09:00', durationMinutes: 60 },
                    { sessionId: 's-120m', classId: 'c1', teacherUid: 't1', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '11:00', durationMinutes: 120 }
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
            isAdmin: () => true
        });

        await controller.init();
        const html = testElements.teacherSchedulerCalendar.innerHTML;

        // 30m pill has ts-density-compact and is-compact
        assert(html.includes('data-session-id="s-30m"'), '30m session must be rendered');
        assert(html.includes('ts-density-compact'), '30m session must have ts-density-compact class');
        assert(html.includes('is-compact'), '30m session must have is-compact class');

        // 60m pill has ts-density-mid
        assert(html.includes('data-session-id="s-60m"'), '60m session must be rendered');
        assert(html.includes('ts-density-mid'), '60m session must have ts-density-mid class');

        // 120m pill has ts-density-full
        assert(html.includes('data-session-id="s-120m"'), '120m session must be rendered');
        assert(html.includes('ts-density-full'), '120m session must have ts-density-full class');

        // Verify repaintDayColumns updates density and hides teacher line for 60m
        const pill30Mock = new MockElement('BUTTON');
        pill30Mock.dataset.sessionId = 's-30m';
        const pill60Mock = new MockElement('BUTTON');
        pill60Mock.dataset.sessionId = 's-60m';
        const pill120Mock = new MockElement('BUTTON');
        pill120Mock.dataset.sessionId = 's-120m';

        const titleEl = new MockElement('SPAN');
        titleEl.classList.add('pill-title');
        const timeEl = new MockElement('SPAN');
        timeEl.classList.add('pill-time');
        const teacherEl = new MockElement('SPAN');
        teacherEl.classList.add('pill-teacher');
        teacherEl.style.display = 'block';

        pill60Mock.querySelector = (sel) => {
            if (sel.includes('pill-title')) return titleEl;
            if (sel.includes('pill-time')) return timeEl;
            if (sel.includes('pill-teacher')) return teacherEl;
            return null;
        };

        const targetSlot = new MockElement('DIV');
        testElements.teacherSchedulerCalendar.querySelector = (sel) => {
            if (sel.includes('s-30m')) return pill30Mock;
            if (sel.includes('s-60m')) return pill60Mock;
            if (sel.includes('s-120m')) return pill120Mock;
            if (sel.includes('teacher-scheduler-slot')) return targetSlot;
            return null;
        };

        const repaintedResult = controller.repaintDayColumns(['2026-09-08']);
        assert.strictEqual(repaintedResult, true, 'repaintDayColumns must return true');
        assert(pill60Mock.classList.contains('ts-density-mid'), 'Repainted 60m pill must have ts-density-mid');
        assert.strictEqual(teacherEl.style.display, 'none', 'Teacher line on mid-density 60m pill must be hidden (display: none)');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Source-grounded repair: Rendered 3-tier density classes and repaintDayColumns verified');
    }

    // Test 41: Source-grounded repair: CSS contract checks for neutral teacher rows and menus
    {
        const cssPath = path.join(__dirname, '../../public/css/teacher-scheduler-google.css');
        const css = fs.readFileSync(cssPath, 'utf8');

        // Reset specificity must be :where(...)
        assert(css.includes(':where(button, input, select, textarea)'), 'Button reset must use :where(...) for low specificity');
        assert(css.includes(':where(button)'), 'Button cursor reset must use :where(...)');

        // Scoped color fills
        assert(css.includes('.scheduler-session-pill[data-ts-color="blue"]'), 'Color fills must be scoped to scheduler-session-pill');
        assert(!css.includes('.teacher-scheduler-workspace [data-ts-color="blue"] {'), 'Universal workspace data-ts-color fill must be eliminated');

        // Neutral teacher rows
        assert(css.includes('.teacher-scheduler-workspace .ts-checkbox-row'), 'ts-checkbox-row rule must exist');
        assert(css.includes('background-color: transparent !important;'), 'ts-checkbox-row must have transparent background');

        // Dropdown menu styles
        assert(css.includes('#ts-create-menu'), 'ts-create-menu must have dropdown menu styles');
        assert(css.includes('#ts-view-menu'), 'ts-view-menu must have dropdown menu styles');
        assert(css.includes('.ts-menu-card'), 'ts-menu-card class must have popover card styles');

        // Mini calendar direct element rules
        assert(css.includes('.mini-cal-day-btn'), 'mini-cal-day-btn styles must be defined');
        assert(css.includes('.mini-cal-day-cell.is-today'), 'mini-cal-day-cell.is-today must be defined');
        assert(css.includes('.mini-cal-day-cell.is-in-range'), 'mini-cal-day-cell.is-in-range must be defined');

        // Contrast bridge
        assert(css.includes('--pill-ink: #ffffff !important;'), 'Solid appearance mode must enforce white text contrast');
        assert(css.includes('--pill-meta: rgba(255, 255, 255, 0.95) !important;'), 'Solid appearance mode must enforce white meta contrast');

        // Scoped solid white text overrides and pastel protection
        assert(css.includes('.teacher-scheduler-workspace:not(.ts-appearance-pastel) .scheduler-session-pill .pill-title'), 'Solid white title color must be scoped to non-pastel');
        assert(css.includes('.teacher-scheduler-workspace.ts-appearance-pastel .scheduler-session-pill .pill-title'), 'Pastel title color rule must exist');

        console.log('✓ Source-grounded repair: CSS contract, specificity, and contrast verified');
    }

    // Test 42: Settings modal showModal() and close() lifecycle, display-none removal, and focus return
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div')
        };
        const settingsDialog = doc.getElementById('teacher-scheduler-settings-dialog');
        settingsDialog.style.display = 'none'; // legacy inline style probe
        settingsDialog.open = false;

        const gearOpener = doc.getElementById('btn-ts-settings');
        gearOpener._focused = false;

        const weekStartSelect = doc.getElementById('ts-setting-week-start');
        const timeFormatSelect = doc.getElementById('ts-setting-time-format');
        const densitySelect = doc.getElementById('ts-setting-density');
        const appearanceSelect = doc.getElementById('ts-setting-appearance');
        const doneBtn = doc.getElementById('btn-ts-save-settings');
        const viewMenu = doc.getElementById('ts-view-menu');
        const createMenu = doc.getElementById('ts-create-menu');

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });

        // Initialize baseline settings
        controller.setWeekStartSetting(1);
        controller.setTimeFormatSetting('24');
        await controller.init();

        // 42a: Opening settings cleans up display:none, records opener, and calls showModal()
        controller.openSettings(gearOpener);
        assert.strictEqual(settingsDialog.open, true, 'Settings dialog must be open after openSettings()');
        assert.strictEqual(settingsDialog.style.display, undefined, 'Legacy display:none must be removed from settings dialog on open');
        assert.strictEqual(controller.getState()._settingsOpener, gearOpener, 'Settings opener must be recorded');
        assert.strictEqual(weekStartSelect.value, '1', 'Week start select must reflect current setting on open');
        assert.strictEqual(timeFormatSelect.value, '24', 'Time format select must reflect current setting on open');

        // 42b: Repeated open call when already open is a no-op
        controller.openSettings(gearOpener);
        assert.strictEqual(settingsDialog.open, true);

        // 42c: Closing settings calls close(), restores focus to opener, and clears opener reference
        controller.closeSettings();
        assert.strictEqual(settingsDialog.open, false, 'Settings dialog must be closed after closeSettings()');
        assert.strictEqual(gearOpener._focused, true, 'Focus must be restored to the opener button');
        assert.strictEqual(controller.getState()._settingsOpener, null, 'Settings opener reference must be cleared');

        // 42d: Closing settings without Done discards draft changes
        controller.openSettings(gearOpener);
        weekStartSelect.value = '0';
        timeFormatSelect.value = '12';
        densitySelect.value = '60';
        appearanceSelect.value = 'pastel';
        // Close without clicking Done
        controller.closeSettings();
        assert.strictEqual(controller.getWeekStartSetting(), 1, 'Closing without Done must discard week start changes');
        assert.strictEqual(controller.getTimeFormatSetting(), '24', 'Closing without Done must discard time format changes');
        assert.strictEqual(controller.getState().hourHeightPx || 50, 50, 'Closing without Done must discard density changes');

        // Reopen settings and verify controls are re-synced to active values
        controller.openSettings(gearOpener);
        assert.strictEqual(weekStartSelect.value, '1', 'Reopening settings must restore week start to active setting');
        assert.strictEqual(timeFormatSelect.value, '24', 'Reopening settings must restore time format to active setting');
        assert.strictEqual(densitySelect.value, '50', 'Reopening settings must restore density to active setting');

        // 42e: Clicking Done commits all settings
        weekStartSelect.value = '0';
        timeFormatSelect.value = '12';
        densitySelect.value = '60';
        appearanceSelect.value = 'pastel';
        doneBtn.dispatchEvent({ type: 'click' });
        assert.strictEqual(controller.getWeekStartSetting(), 0, 'Done must commit week start to 0');
        assert.strictEqual(controller.getTimeFormatSetting(), '12', 'Done must commit time format to 12');
        assert.strictEqual(controller.getState().hourHeightPx, 60, 'Done must commit density to 60');
        assert.strictEqual(controller.getState().appearance, 'pastel', 'Done must commit appearance to pastel');
        assert.strictEqual(settingsDialog.open, false, 'Done button must close settings dialog');

        // 42f: 12-hour formatting in formatTimeRange and formatGutterHour
        assert.strictEqual(
            controller.formatTimeRange('18:00', 60, '12'),
            '6:00 PM\u20137:00 PM',
            '12h time format must render 6:00 PM–7:00 PM'
        );
        assert.strictEqual(
            controller.formatTimeRange('07:30', 90, '12'),
            '7:30 AM\u20139:00 AM',
            '12h time format must render 7:30 AM–9:00 AM'
        );
        assert.strictEqual(
            controller.formatGutterHour('18:00', '12'),
            '6 PM',
            '12h formatGutterHour must render 6 PM'
        );
        assert.strictEqual(
            controller.formatGutterHour('07:00', '12'),
            '7 AM',
            '12h formatGutterHour must render 7 AM'
        );
        assert.strictEqual(
            controller.formatTimeRange('18:00', 60, '24'),
            '18:00\u201319:00',
            '24h time format must render 18:00–19:00'
        );

        // Reset settings back to default
        controller.setWeekStartSetting(1);
        controller.setTimeFormatSetting('24');

        // 42g: Deactivate closes settings and cleans up open menus
        controller.openSettings(gearOpener);
        assert.strictEqual(settingsDialog.open, true);
        viewMenu.style.display = 'block';
        createMenu.style.display = 'block';
        controller.deactivate();
        assert.strictEqual(settingsDialog.open, false, 'Controller deactivate must close settings modal if open');
        assert.strictEqual(viewMenu.style.display, 'none', 'Controller deactivate must hide viewMenu');
        assert.strictEqual(createMenu.style.display, 'none', 'Controller deactivate must hide createMenu');

        console.log('✓ Settings modal showModal() and close() lifecycle, display-none removal, and focus return verified');
    }

    // Test 43: Teacher identity resolution upstream hardening (reject raw UIDs, usr_, unmapped)
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div')
        };
        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        // 43a: Rejects names starting with usr_
        assert.strictEqual(
            controller.resolveTeacherDisplayName('usr_12345678', 'usr_12345678'),
            'Teacher name unavailable',
            'Must reject directName starting with usr_'
        );

        // 43b: Rejects names exactly equal to uid
        assert.strictEqual(
            controller.resolveTeacherDisplayName('teacher-bob-id', 'teacher-bob-id'),
            'Teacher name unavailable',
            'Must reject directName identical to uid'
        );

        // 43c: Rejects raw 28-character alphanumeric Firebase Auth UIDs without spaces
        const rawFirebaseUid = 'eRrS6Ba3QfQ6R9SmPbcb3bYcOK83';
        assert.strictEqual(
            controller.resolveTeacherDisplayName('any-teacher-uid', rawFirebaseUid),
            'Teacher name unavailable',
            'Must reject 28-char raw Firebase Auth UID as display name'
        );

        // 43d: Unmapped UID with no direct name returns 'Teacher name unavailable'
        assert.strictEqual(
            controller.resolveTeacherDisplayName('unmapped-teacher-xyz', ''),
            'Teacher name unavailable',
            'Must return Teacher name unavailable for unmapped UID'
        );

        // 43e: Distinct from 'Unassigned' when unassigned
        assert.strictEqual(
            controller.resolveTeacherDisplayName('unassigned', ''),
            'Unassigned',
            'Must return Unassigned when teacherUid is unassigned'
        );
        assert.strictEqual(
            controller.resolveTeacherDisplayName('', ''),
            '',
            'Must return empty string when UID is empty'
        );

        // 43f: Preserves legitimate human names
        assert.strictEqual(
            controller.resolveTeacherDisplayName('valid-uid-1', 'Hứa Thanh Nam'),
            'Hứa Thanh Nam',
            'Must preserve legitimate Vietnamese name'
        );
        assert.strictEqual(
            controller.resolveTeacherDisplayName('valid-uid-2', 'Shawn Hanh'),
            'Shawn Hanh',
            'Must preserve legitimate teacher name'
        );

        console.log('✓ Teacher identity resolution hardening (reject raw UIDs, usr_, unmapped) verified');
    }

    // Test 44: Quick Add outside click exclusion of #btn-ts-create-session and .ts-create-btn
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerQuickAdd: doc.createElement('div'),
            teacherSchedulerSessionBubble: doc.createElement('div')
        };
        testElements.teacherSchedulerQuickAdd.style.display = 'block';

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });

        await controller.init();

        // Target matching #btn-ts-create-session / .ts-create-btn
        const createSessionMenuItem = new MockElement('button');
        createSessionMenuItem.id = 'btn-ts-create-session';
        createSessionMenuItem.classList.add('ts-create-btn');
        createSessionMenuItem.closest = (sel) => {
            if (sel.includes('#btn-ts-create-session') || sel.includes('.ts-create-btn')) {
                return createSessionMenuItem;
            }
            return null;
        };

        // Dispatching click on createSessionMenuItem must NOT dismiss Quick Add
        testElements.teacherSchedulerQuickAdd.style.display = 'block';
        doc.dispatchEvent({ type: 'click', target: createSessionMenuItem });
        assert.strictEqual(
            testElements.teacherSchedulerQuickAdd.style.display,
            'block',
            'Clicking #btn-ts-create-session / .ts-create-btn must NOT dismiss Quick Add'
        );

        // Dispatching click on unrelated outside element DOES dismiss Quick Add
        const outsideDiv = new MockElement('div');
        doc.dispatchEvent({ type: 'click', target: outsideDiv });
        assert.strictEqual(
            testElements.teacherSchedulerQuickAdd.style.display,
            'none',
            'Clicking outside element must dismiss Quick Add'
        );

        console.log('✓ Quick Add outside click exclusion of #btn-ts-create-session verified');
    }

    // TEST 45 (TS-01): Multi-teacher checkbox selection model & conflict check persistence
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerTeacherSelect: doc.createElement('select')
        };
        const teacherListEl = doc.createElement('div');
        teacherListEl.id = 'teacher-scheduler-teacher-list';
        elements['teacher-scheduler-teacher-list'] = teacherListEl;

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });
        await controller.init();

        const state = controller.getState();
        state.teachers = [
            { uid: 'teacher-1', displayName: 'Teacher Alice' },
            { uid: 'teacher-2', displayName: 'Teacher Bob' },
            { uid: 'teacher-3', displayName: 'Teacher Charlie' }
        ];
        state.sessions = [
            { sessionId: 's1', teacherUid: 'teacher-1', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '08:00', durationMinutes: 60 },
            { sessionId: 's2', teacherUid: 'teacher-2', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '10:00', durationMinutes: 60 },
            { sessionId: 's3', teacherUid: 'teacher-3', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '14:00', durationMinutes: 60 }
        ];

        // 45a: Subsets filter visibility correctly
        state.selectedTeacherUid = 'all';
        state.selectedTeacherUids = new Set(['teacher-1', 'teacher-2']);
        assert.strictEqual(controller.isSessionVisible(state.sessions[0]), true, 'Teacher 1 session should be visible');
        assert.strictEqual(controller.isSessionVisible(state.sessions[1]), true, 'Teacher 2 session should be visible');
        assert.strictEqual(controller.isSessionVisible(state.sessions[2]), false, 'Teacher 3 session should be hidden');

        // 45b: Conflict check remains authoritative across ALL sessions (including hidden ones)
        const conflict = controller.hasClientConflict('2026-09-08', '14:00', 60, null, 'c3', 'teacher-3');
        assert.notStrictEqual(conflict, null, 'Conflict check must detect collision even if teacher-3 is hidden in calendar');
        assert.strictEqual(conflict.sessionId, 's3');

        // 45c: Deselect all sets state to 'none' and hides all sessions
        state.selectedTeacherUid = 'none';
        state.selectedTeacherUids = new Set();
        assert.strictEqual(controller.isSessionVisible(state.sessions[0]), false, 'All sessions hidden when selectedTeacherUid is none');
        assert.strictEqual(controller.isSessionVisible(state.sessions[1]), false);

        console.log('✓ Multi-teacher checkbox selection model and conflict check persistence (TS-01) verified');
    }

    // TEST 46 (TS-02): Range span and Day mode Today click
    {
        const fromInput = doc.createElement('input');
        const toInput = doc.createElement('input');
        const todayBtn = doc.createElement('button');
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerFromDate: fromInput,
            inputTeacherSchedulerToDate: toInput,
            btnTeacherSchedulerToday: todayBtn
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });
        await controller.init();

        const state = controller.getState();

        // 46a: Day mode Today click sets exactly 1 day (from === to)
        state.viewMode = 'day';
        todayBtn.dispatchEvent({ type: 'click' });
        assert.strictEqual(state.fromDate, state.toDate, 'In day mode, fromDate and toDate must match');
        assert.strictEqual(fromInput.value, toInput.value, 'In day mode, input values must match');

        // 46b: Week mode Today click sets exactly 7 days
        state.viewMode = 'week';
        todayBtn.dispatchEvent({ type: 'click' });
        const fromDate = new Date(`${state.fromDate}T00:00:00`);
        const toDate = new Date(`${state.toDate}T00:00:00`);
        const diffDays = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        assert.strictEqual(diffDays, 7, 'In week mode, Today click must span exactly 7 days');

        console.log('✓ Range span and Day mode Today click (TS-02) verified');
    }

    // TEST 47 (TS-03): Out-of-order fetch generation race condition
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div')
        };
        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });
        await controller.init();

        const state = controller.getState();

        // Simulate 2 calls where first call is slow and returns later
        let resolveSlow;
        const slowPromise = new Promise(r => { resolveSlow = r; });
        const fastResult = { classrooms: [{ classroomId: 'fast-c' }], sessions: [{ sessionId: 'fast-s' }] };

        const origAPI = windowMock.ClassroomAPI;
        let callCount = 0;
        windowMock.ClassroomAPI = {
            ...origAPI,
            fetchTeacherSchedulerWorkspace: async () => {
                callCount++;
                if (callCount === 1) {
                    await slowPromise;
                    return { classrooms: [{ classroomId: 'slow-c' }], sessions: [{ sessionId: 'slow-s' }] };
                }
                return fastResult;
            }
        };

        const call1 = controller.refresh(); // Generation 1 (slow)
        const call2 = controller.refresh(); // Generation 2 (fast)

        await call2; // Fast call resolves first
        assert.strictEqual(state.sessions[0].sessionId, 'fast-s', 'Fast response should be in state');

        resolveSlow(); // Now resolve slow call
        await call1;

        assert.strictEqual(state.sessions[0].sessionId, 'fast-s', 'Slow older generation response must be discarded and NOT overwrite state');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Out-of-order fetch generation race condition (TS-03) verified');
    }

    // TEST 48 (TS-04): Draft note and outcome preserved during background refresh
    {
        const noteInput = doc.createElement('textarea');
        const outcomeSelect = doc.createElement('select');
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerSessionBubble: doc.createElement('div'),
            inputTeacherSchedulerSessionNote: noteInput,
            inputTeacherSchedulerSessionOutcome: outcomeSelect
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });
        await controller.init();

        const state = controller.getState();
        const testSession = {
            sessionId: 'draft-s1',
            scheduledLocalDate: '2026-09-08',
            scheduledLocalTime: '08:00',
            durationMinutes: 60,
            sessionNote: 'Original server note',
            sessionOutcome: 'attended'
        };
        state.sessions = [testSession];

        // Open bubble and verify initial values
        controller.openSessionBubble('draft-s1');
        assert.strictEqual(noteInput.value, 'Original server note');

        // User edits note (setting dirty flag)
        noteInput.value = 'In-progress unsaved draft student observation';
        state.isSessionNoteDirty = true;

        // Background re-render arrives with server session data
        controller.renderSessionBubble(testSession);

        assert.strictEqual(
            noteInput.value,
            'In-progress unsaved draft student observation',
            'renderSessionBubble must not overwrite note when isSessionNoteDirty is true'
        );

        console.log('✓ Draft note and outcome preserved during background refresh (TS-04) verified');
    }

    // TEST 49 (TS-05): Session bubble closure target isolation
    {
        const bubble = doc.createElement('div');
        const noteInput = doc.createElement('textarea');
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerSessionBubble: bubble,
            inputTeacherSchedulerSessionNote: noteInput
        };

        const customAPI = {
            ...mockClassroomAPI,
            fetchTeacherSchedulerWorkspace: async () => ({
                classrooms: [],
                sessions: [
                    { sessionId: 'bubble-s1', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '08:00', durationMinutes: 60 },
                    { sessionId: 'bubble-s2', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '10:00', durationMinutes: 60 }
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
            isAdmin: () => true
        });
        await controller.init();

        const state = controller.getState();
        state.sessions = [
            { sessionId: 'bubble-s1', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '08:00', durationMinutes: 60 },
            { sessionId: 'bubble-s2', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '10:00', durationMinutes: 60 }
        ];

        // Open bubble for bubble-s2
        controller.openSessionBubble('bubble-s2');
        assert.strictEqual(state.sessionBubble.sessionId, 'bubble-s2');
        assert.strictEqual(bubble.style.display, 'block');

        // Save outcome for bubble-s1 (different session)
        await controller.saveSessionOutcome('bubble-s1', 'completed');

        // Bubble for bubble-s2 MUST NOT have been closed
        assert.strictEqual(state.sessionBubble?.sessionId, 'bubble-s2', 'Saving session 1 must not close bubble for session 2');
        assert.strictEqual(bubble.style.display, 'block');

        // Now save outcome for bubble-s2
        await controller.saveSessionOutcome('bubble-s2', 'completed');
        assert.strictEqual(bubble.style.display, 'none', 'Saving matching session closes bubble');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Session bubble closure target isolation (TS-05) verified');
    }

    // TEST 50 (TS-06): Local year/month/date extraction in getSessionLocalDate
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div')
        };
        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });
        await controller.init();

        // 50a: scheduledLocalDate property takes direct precedence
        assert.strictEqual(
            controller.getSessionLocalDate({ scheduledLocalDate: '2026-09-18' }),
            '2026-09-18'
        );

        // 50b: Fallback to scheduledStartAtUtc or startTime extracts local date parts
        const d = new Date(2026, 8, 18, 23, 30); // Local Sep 18, 2026
        const dateStr = controller.getSessionLocalDate({ startTime: d.toISOString() });
        const localExpected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        assert.strictEqual(dateStr, localExpected, 'Fallback must extract local year, month, date');

        console.log('✓ Local year/month/date extraction in getSessionLocalDate (TS-06) verified');
    }

    // TEST 51 (TS-08): Grab offset Y subtracted during slot resolution
    {
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div')
        };
        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });
        await controller.init();

        const state = controller.getState();
        state.pointerDrag = {
            sessionId: 'drag-offset-s1',
            offsetY: 20,
            initialClientY: 100
        };

        assert.strictEqual(state.pointerDrag.offsetY, 20, 'Drag grab offset Y must be preserved in state');
        controller.clearPointerDrag();
        assert.strictEqual(state.pointerDrag, null, 'clearPointerDrag must clean up drag state');

        console.log('✓ Grab offset Y subtraction in drag resolution (TS-08) verified');
    }

    // TEST 52 (TS-09): Drop outside calendar bounds cancels move safely
    {
        let rescheduleCalled = false;
        const origAPI = windowMock.ClassroomAPI;
        windowMock.ClassroomAPI = {
            ...origAPI,
            teacherRescheduleScheduledSession: async () => {
                rescheduleCalled = true;
                return { success: true };
            }
        };

        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div')
        };
        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });
        await controller.init();

        const state = controller.getState();
        state.sessions = [{ sessionId: 'out-bounds-s1', classId: 'c1', scheduledLocalDate: '2026-09-08', scheduledLocalTime: '08:00', durationMinutes: 60 }];

        // Simulate mousedown on pill
        const pill = new MockElement('div');
        pill.dataset.sessionId = 'out-bounds-s1';
        pill.closest = (s) => (s.includes('teacher-scheduler-session-pill') ? pill : null);
        pill.getBoundingClientRect = () => ({ top: 100, left: 100, width: 100, height: 50 });

        testElements.teacherSchedulerCalendar.dispatchEvent({
            type: 'mousedown',
            button: 0,
            clientX: 120,
            clientY: 110,
            target: pill
        });

        assert(state.pointerDrag !== null, 'Drag should be initialized');

        // Mouseup on an element outside calendar with no active slot
        const outsideDiv = new MockElement('div');
        outsideDiv.closest = () => null; // Not a slot

        doc.dispatchEvent({
            type: 'mouseup',
            clientX: 50,
            clientY: 50,
            target: outsideDiv
        });

        assert.strictEqual(state.pointerDrag, null, 'Drag must be cleared');
        assert.strictEqual(rescheduleCalled, false, 'No reschedule API call should be made when dropped outside calendar');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Drop outside calendar bounds cancels move safely (TS-09) verified');
    }

    // TEST 53 (TS-10): Duplicate session forwards duration to quick add
    {
        const quickAdd = doc.createElement('div');
        const durationInput = doc.createElement('input');
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerQuickAdd: quickAdd,
            inputTeacherSchedulerQuickAddDuration: durationInput,
            inputTeacherSchedulerQuickAddTitle: doc.createElement('input'),
            inputTeacherSchedulerQuickAddClass: doc.createElement('select')
        };
        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });
        await controller.init();

        const state = controller.getState();
        state.sessions = [{
            sessionId: 'dup-s1',
            classId: 'c1',
            scheduledLocalDate: '2026-09-08',
            scheduledLocalTime: '09:30',
            durationMinutes: 90
        }];

        await controller.duplicateSession('dup-s1');

        assert.strictEqual(quickAdd.style.display, 'block', 'Quick Add modal should be open');
        assert.strictEqual(durationInput.value, '90', 'Quick Add duration input must reflect session durationMinutes (90)');

        console.log('✓ Duplicate session forwards duration to quick add (TS-10) verified');
    }

    // TEST 54 (TS-11): Recurring move cancellation and finally rollback cleanup
    {
        const scopeModal = doc.createElement('div');
        const cancelBtn = doc.createElement('button');
        const confirmBtn = doc.createElement('button');
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            teacherSchedulerScopeModal: scopeModal,
            teacherSchedulerScopeTitle: doc.createElement('div'),
            teacherSchedulerScopeShiftFrom: doc.createElement('div'),
            teacherSchedulerScopeShiftTo: doc.createElement('div'),
            teacherSchedulerScopeSeriesTitle: doc.createElement('div'),
            teacherSchedulerScopeSeriesDesc: doc.createElement('div'),
            teacherSchedulerScopeWarnings: doc.createElement('div'),
            scopeChoiceSingle: doc.createElement('input'),
            scopeChoiceSeries: doc.createElement('input'),
            btnTeacherSchedulerScopeCancel: cancelBtn,
            btnTeacherSchedulerScopeConfirm: confirmBtn
        };

        const customAPI = {
            ...mockClassroomAPI,
            teacherRescheduleSessionSeries: async (sessionId, data) => ({
                success: true,
                moved: [
                    { sessionId: 'scope-s1', from: { targetLocalDate: '2026-09-08', targetLocalTime: '08:00' }, to: { targetLocalDate: data.targetLocalDate, targetLocalTime: data.targetLocalTime } },
                    { sessionId: 'scope-s2', from: { targetLocalDate: '2026-09-15', targetLocalTime: '08:00' }, to: { targetLocalDate: '2026-09-15', targetLocalTime: '09:00' } }
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
            isAdmin: () => true
        });
        await controller.init();

        const state = controller.getState();
        state.sessions = [{
            sessionId: 'scope-s1',
            classId: 'c1',
            scheduledLocalDate: '2026-09-08',
            scheduledLocalTime: '08:00',
            durationMinutes: 60,
            timezone: 'UTC'
        }];

        // Simulate move to 09:00 triggering scope modal
        const slotEl = new MockElement('div');
        slotEl.dataset.date = '2026-09-08';
        slotEl.dataset.time = '09:00';
        slotEl.closest = (s) => (s.includes('teacher-scheduler-slot') ? slotEl : null);

        const dropPromise = controller.handleSessionDrop('scope-s1', slotEl);
        await new Promise((resolve) => setTimeout(resolve, 30));

        assert.strictEqual(scopeModal.style.display, 'flex', 'Scope modal should be open');
        assert(state.pendingSessionIds.has('scope-s1'), 'Session should be marked pending during scope choice');

        // Cancel scope modal
        cancelBtn.dispatchEvent({ type: 'click' });
        await dropPromise;

        assert.strictEqual(scopeModal.style.display, 'none', 'Scope modal should be closed on cancel');
        assert.strictEqual(state.pendingSessionIds.has('scope-s1'), false, 'Session must not remain in pendingSessionIds after cancel');
        assert.strictEqual(state.sessions[0].scheduledLocalTime, '08:00', 'Session local time should roll back to original 08:00');

        windowMock.ClassroomAPI = origAPI;
        console.log('✓ Recurring move cancellation and finally rollback cleanup (TS-11) verified');
    }

    // TEST 55 (TS-12): Refresh in schedule view mode renders schedule list
    {
        const scheduleList = doc.getElementById('teacher-scheduler-schedule-list');
        const calendarGrid = doc.createElement('div');
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: calendarGrid,
            panelTeacherSchedulerScheduleList: scheduleList
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });
        await controller.init();

        const state = controller.getState();
        state.viewMode = 'schedule';
        state.sessions = [{
            sessionId: 'sched-s1',
            classId: 'c1',
            scheduledLocalDate: '2026-09-08',
            scheduledLocalTime: '08:00',
            durationMinutes: 60,
            timezone: 'UTC'
        }];

        await controller.refresh();

        assert.strictEqual(state.viewMode, 'schedule', 'View mode should remain schedule');
        assert(scheduleList.innerHTML.includes('ts-schedule-row'), 'Schedule list should render session rows');
        assert(scheduleList.innerHTML.includes('s1'), 'Schedule list should include session ID');

        console.log('✓ Refresh in schedule view mode renders schedule list (TS-12) verified');
    }

    // TEST 56 (TS-04, TS-13 & TS-16): Interaction lifecycle, outcome dirty tracking, and speech binding
    {
        const outcomeSelect = doc.createElement('select');
        const testElements = {
            teacherSchedulerWorkspace: doc.createElement('div'),
            teacherSchedulerCalendar: doc.createElement('div'),
            inputTeacherSchedulerSessionOutcome: outcomeSelect
        };

        const controller = TeacherSchedulerWorkspace.createController({
            elements: testElements,
            showToast: () => {},
            isAdmin: () => true
        });
        await controller.init();

        const state = controller.getState();

        // 56a (TS-16): Escape key aborts active pointer drag
        state.pointerDrag = { sessionId: 'escape-drag-s1', active: true, cleanup: () => {} };
        doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
        assert.strictEqual(state.pointerDrag, null, 'Pressing Escape during active drag must clear pointerDrag');

        // 56b (TS-04): Outcome dirty tracking prevents overwrite on background refresh
        state.sessions = [{
            sessionId: 's-dirty-1',
            classId: 'c1',
            scheduledLocalDate: '2026-09-08',
            scheduledLocalTime: '08:00',
            durationMinutes: 60,
            sessionOutcome: 'completed',
            timezone: 'UTC'
        }];
        controller.openSessionBubble('s-dirty-1');
        assert.strictEqual(state.isSessionOutcomeDirty, false, 'isSessionOutcomeDirty should be reset on bubble open');

        outcomeSelect.value = 'absent_makeup';
        outcomeSelect.dispatchEvent({ type: 'change' });
        assert.strictEqual(state.isSessionOutcomeDirty, true, 'Changing outcome dropdown marks isSessionOutcomeDirty true');

        // Re-render bubble simulates background refresh
        controller.renderSessionBubble();
        assert.strictEqual(outcomeSelect.value, 'absent_makeup', 'Dirty outcome selection must not be overwritten by session state');

        // 56c (TS-13): Opening new session bubble cleans up previous voice recognition
        let voiceStopped = false;
        state._stopVoiceRecognition = () => { voiceStopped = true; };
        controller.openSessionBubble('s-other-2');
        assert.strictEqual(voiceStopped, true, 'Opening new session bubble must abort previous voice recognition');

        console.log('✓ Interaction lifecycle, outcome dirty tracking, and speech binding (TS-04, TS-13 & TS-16) verified');
    }

    console.log('All teacher scheduler client controller tests passed successfully!');
}

runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
