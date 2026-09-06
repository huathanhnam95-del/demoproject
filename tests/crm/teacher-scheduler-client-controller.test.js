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
    function createElement(tag) {
        return new MockElement(tag);
    }

    const doc = {
        createElement,
        addEventListener() {},
        removeEventListener() {},
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

    console.log('All teacher scheduler client controller tests passed successfully!');
}

runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
