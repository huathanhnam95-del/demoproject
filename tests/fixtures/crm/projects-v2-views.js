/* Synthetic API for PR08 Node/Chrome integration. Never contacts a backend. */
(function (root) {
    'use strict';
    root.createProjectsViewsFixture = async function (bindings) {
        const elements = Object.fromEntries(Object.entries(bindings).map(([key, id]) => [key, document.getElementById(id)]));
        const h = { actor: 'a', role: 'Owner', denied: '', calls: [], holds: [], failures: [], projects: ['p', 'q'] };
        h.columns = [{ id: 'notes', type: 'text', label: 'Ghi chú' }, { id: 'priority-custom-123', type: 'priority', label: 'Priority' }];
        const copy = value => JSON.parse(JSON.stringify(value));
        h.tasks = ['p', 'q'].flatMap(projectId => Array.from({ length: 5 }, (_, i) => ({
            id: `${projectId}${i}`, projectId, title: `Công việc ${i} — Nguyễn Thị Huyền <b>`, revision: 1, lifecycle: 'active',
            status: i === 1 ? 'done' : 'not_started', sectionId: 's', rank: `${i}/1`, ownerUid: 'a', assigneeUids: [],
            activeChildCount: i === 0 ? 1 : 0, parentTaskId: i === 4 ? `${projectId}0` : null, pathIds: i === 4 ? [`${projectId}0`] : [],
            startDate: '2026-09-01', dueDate: '2026-09-20', values: { notes: 'Stored', 'priority-custom-123': 'high' }, ancestorTitles: i === 4 ? ['Parent context'] : []
        })));
        h.hold = (match, method = 'GET') => {
            let release; const promise = new Promise(resolve => { release = resolve; });
            h.holds.push({ match, method, promise }); return release;
        };
        h.api = async (url, options) => {
            const method = options?.method || 'GET', body = options?.body ? JSON.parse(options.body) : null;
            h.calls.push({ url, method, body });
            const u = new URL(url, 'https://fixture.invalid'), projectId = u.pathname.split('/')[3];
            const fail = h.failures.findIndex(f => url.includes(f.match));
            if (fail >= 0) throw Object.assign(Error('Synthetic rejection'), { status: h.failures.splice(fail, 1)[0].status });
            if (h.denied === projectId) throw Object.assign(Error('Access denied'), { status: 403 });
            let result;
            const project = { id: projectId, name: 'Dự án tiếng Việt', lifecycle: 'active', revision: 1 };
            if (options) {
                const task = h.tasks.find(t => t.projectId === projectId && t.id === u.pathname.split('/').pop());
                if (!task) throw Object.assign(Error('Missing task'), { status: 404 });
                if (h.role === 'Viewer') throw Object.assign(Error('Read only'), { status: 403 });
                if (body.expectedRevision !== task.revision) throw Object.assign(Error('Revision conflict'), { status: 409 });
                Object.assign(task, body, { revision: task.revision + 1 }); result = { task: copy(task) };
            } else if (url.includes('member-directory')) result = { people: [{ uid: 'a', displayName: 'Nguyễn Thị Huyền' }] };
            else if (url.includes('/tasks?') || url.includes('/views?')) {
                const filters = JSON.parse(u.searchParams.get('filters') || '{}');
                const tasks = h.tasks.filter(t => t.projectId === projectId
                    && (!filters.status || t.status === filters.status) && (!filters.title || t.title.includes(filters.title))
                    && (!filters.ownerUid || t.ownerUid === filters.ownerUid)
                    && (url.includes('/views?') || (filters.parentTaskId ? t.parentTaskId === filters.parentTaskId : !t.parentTaskId)));
                result = { project, membership: { role: h.role }, tasks: copy(tasks), matchingTaskCount: tasks.length, hasMore: false,
                    sections: [{ id: 's', title: 'Công việc', rank: '0/1' }], columns: copy(h.columns),
                    revision: { structureRevision: 1, schemaRevision: 1 }, aggregates: { byStatus: {}, activeLeafTaskCount: tasks.length, completedLeafTaskCount: 0, completionPercent: 0 } };
            } else if (/\/tasks\/[^/]+$/.test(u.pathname)) {
                const task = h.tasks.find(t => t.projectId === projectId && t.id === u.pathname.split('/').pop());
                if (!task) throw Object.assign(Error('Missing task'), { status: 404 });
                result = { task: copy(task) };
            } else if (url.includes('/links')) result = { links: [] };
            else if (url.includes('/calendar')) result = { calendar: { revision: 1, days: [] } };
            else result = { project, membership: { role: h.role } };
            const index = h.holds.findIndex(item => url.includes(item.match) && method === item.method);
            if (index >= 0) await h.holds.splice(index, 1)[0].promise;
            return result;
        };
        const getCurrentUser = () => ({ uid: h.actor });
        h.board = root.CrmProjectsBoard.createController({ elements, presentationV2: true, getCurrentUser, apiFetchJson: h.api,
            onTaskSelection: task => h.views?.setTask(task), onContextChanged: snapshot => h.presentation?.setContext(snapshot) });
        h.select = async id => {
            if (!h.projects.includes(id)) return false;
            const selection = { projects: h.projects.map(id => ({ id, name: `Dự án ${id}`, lifecycle: 'active' })), selectedProjectId: id };
            h.board.setProjects(selection); h.presentation?.setSelection(selection);
            h.views.setProject(id); return true;
        };
        h.views = root.CrmProjectsViews.createController({ board: h.board, getCurrentUser, apiFetchJson: h.api, selectProject: h.select });
        root.projectsViewsController = h.views;
        h.board.init(); h.views.init();
        if (root.CrmProjectsPresentationV2) {
            h.presentation = root.CrmProjectsPresentationV2.createController({ config: { projectsV2: true }, panel: document.querySelector('[data-panel="projects"]'),
                storage: { getItem: () => null, setItem: () => {} }, getCurrentUser, onDensity: (mode, scale) => h.board.setDensity(mode, scale),
                createWorkspace: options => root.CrmProjectsWorkspace.createController({ ...options, getCurrentUser, selectProject: h.select }) });
            h.presentation.init();
        }
        await h.select('p');
        h.wait = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => root.setTimeout(resolve, 10)); };
        await h.wait(); h.views.startNavigation(); await h.wait();
        h.elements = elements;
        h.command = (id, field, value, revision = h.tasks.find(t => t.id === id)?.revision) => h.board.setTaskField({ taskId: id, field, value, revision, projectId: h.board.getState().project?.id, actorUid: h.actor });
        h.close = () => { h.views.dispose(); h.presentation?.dispose(); h.board.disposePresentation(); };
        return h;
    };
})(typeof window === 'undefined' ? globalThis : window);
