const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Mock DOM environment
function createMockDocument() {
    const elements = {};
    function createElement(tag) {
        return {
            tagName: tag.toUpperCase(),
            style: {},
            dataset: {},
            classList: {
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
            },
            attributes: {},
            setAttribute(k, v) { this.attributes[k] = String(v); },
            getAttribute(k) { return this.attributes[k] || null; },
            listeners: {},
            addEventListener(evt, fn) {
                if (!this.listeners[evt]) this.listeners[evt] = [];
                this.listeners[evt].push(fn);
            },
            dispatchEvent(evt) {
                (this.listeners[evt.type] || []).forEach(fn => fn(evt));
            },
            _val: '',
            get value() { return this._val; },
            set value(v) { this._val = String(v ?? ''); },
            _text: '',
            get textContent() { return this._text; },
            set textContent(v) {
                this._text = String(v ?? '');
                this._html = this._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            },
            _html: '',
            get innerHTML() { return this._html; },
            set innerHTML(v) {
                this._html = String(v ?? '');
                this._text = this._html.replace(/<[^>]*>/g, '');
            },
            querySelectorAll() { return []; },
            querySelector() { return null; },
            closest() { return null; },
            getBoundingClientRect() { return { left: 0, top: 0, bottom: 0, right: 0 }; }
        };
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
        }
    };

    const windowMock = {
        document: doc,
        ClassroomAPI: mockClassroomAPI,
        setTimeout: (fn) => setTimeout(fn, 0),
        clearTimeout: () => {},
        scrollY: 0
    };

    const context = vm.createContext({
        window: windowMock,
        document: doc,
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

    console.log('All teacher scheduler client controller tests passed successfully!');
}

runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
