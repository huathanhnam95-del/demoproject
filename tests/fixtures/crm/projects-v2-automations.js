/* Synthetic automation API shared by Node and Chrome. No auth, network or persistence. */
(function (global) {
    'use strict';
    global.createProjectsAutomationsFixture = async function () {
        const copy = value => JSON.parse(JSON.stringify(value));
        const h = { actor: 'owner', role: 'Owner', project: 'p', calls: [], holds: [], failures: [], applied: [], operations: new Map(), expiresAt: '2999-01-01T00:00:00Z' };
        h.label = 'Tự động nhắc Nguyễn Thị Huyền hoàn thành công việc và kiểm tra thông báo tiếng Việt <b> ' .repeat(2);
        h.definition = { schemaVersion: 1, trigger: { type: 'status_changed', to: 'blocked' }, steps: [{ nodeId: 'notify-owner', type: 'notify', payload: { message: h.label, recipients: 'task_owner' } }] };
        h.rule = { ruleId: 'r', projectId: 'p', title: h.label, folder: 'Công việc cần theo dõi', revision: 4, enabled: true, currentVersion: 'v1', candidateVersion: 'v2', activeActorUid: 'owner', draftActorUid: 'owner' };
        h.versions = ['v1', 'v2'].map((versionId, index) => ({ versionId, actorUid: 'owner', createdAt: `2026-09-1${index}T09:00:00Z`, definition: copy(h.definition) }));
        h.publishCandidate = ({ actorUid, definition }) => {
            const next = { versionId: `v${h.versions.length + 1}`, actorUid, definition: copy(definition) };
            h.versions.push(next); h.rule.candidateVersion = next.versionId; h.rule.draftActorUid = actorUid; h.rule.revision++;
            return copy(next);
        };
        h.hold = (match, method = 'GET') => { let release; const promise = new Promise(resolve => { release = resolve; }); h.holds.push({ match, method, promise }); return release; };
        const failure = (status, code) => Object.assign(new Error(code), { status, payload: { error: code } });
        h.api = async (url, options) => {
            const method = options?.method || 'GET', body = options?.body ? JSON.parse(options.body) : null;
            h.calls.push({ url, method, body });
            const u = new URL(url, 'https://fixture.invalid');
            const forced = h.failures.findIndex(item => url.includes(item.match));
            const fail = forced < 0 ? null : h.failures.splice(forced, 1)[0];
            if (fail && !fail.after) throw failure(fail.status, fail.code);
            let result;
            if (u.pathname.endsWith('/preview')) result = { versionId: body.versionId, previewToken: `token-${h.calls.length}`, expiresAt: h.expiresAt, effects: [{ type: 'notify', recipientUids: ['owner'] }], warnings: [] };
            else if (method !== 'GET') {
                if (h.operations.has(body.operationId)) result = h.operations.get(body.operationId);
                else {
                    if (h.role !== 'Owner') throw failure(403, 'PROJECT_OWNER_REQUIRED');
                    if (body.expectedRevision !== undefined && body.expectedRevision !== h.rule.revision) throw failure(409, 'STALE_REVISION');
                    if (u.pathname.endsWith('/activate')) { h.rule.enabled = true; h.rule.currentVersion = body.versionId; h.rule.activeActorUid = h.versions.find(item => item.versionId === body.versionId).actorUid; h.rule.candidateVersion = null; }
                    else if (u.pathname.endsWith('/versions') || u.pathname.endsWith('/automations')) {
                        const next = { versionId: `v${h.versions.length + 1}`, actorUid: body.actorUid || 'owner', definition: copy(body.definition) }; h.versions.push(next);
                        if (u.pathname.endsWith('/automations')) Object.assign(h.rule, { title: body.title, folder: body.folder, enabled: false, currentVersion: next.versionId, candidateVersion: null });
                        else if (h.rule.enabled) h.rule.candidateVersion = next.versionId; else h.rule.currentVersion = next.versionId;
                    } else if (u.pathname.endsWith('/duplicate')) { result = { rule: { ...copy(h.rule), ruleId: 'copy', enabled: false } }; }
                    else { if ('title' in body) h.rule.title = body.title; if ('folder' in body) h.rule.folder = body.folder; if ('enabled' in body) h.rule.enabled = body.enabled; }
                    h.rule.revision++; h.applied.push(copy(body));
                    result ||= { rule: copy(h.rule), ...((body.definition) ? { version: copy(h.versions.at(-1)) } : {}) };
                    h.operations.set(body.operationId, copy(result));
                }
            } else if (u.pathname.endsWith('/tasks/t')) result = { task: { id: 't', title: h.label } };
            else if (u.pathname.endsWith('/tasks')) result = { tasks: [{ id: 't', title: h.label }], hasMore: false };
            else if (u.pathname.endsWith('/versions')) result = { items: copy(h.versions), hasMore: false };
            else if (u.pathname.endsWith('/runs')) result = { items: [{ runId: u.searchParams.has('cursor') ? 'run-next' : 'run', versionId: u.searchParams.has('cursor') ? 'v2' : 'v1', state: 'waiting', createdAt: '2026-09-19T09:00:00Z' }], hasMore: !!h.paginateRuns && !u.searchParams.has('cursor'), nextCursor: h.paginateRuns && !u.searchParams.has('cursor') ? 'runs-page-2' : null };
            else if (u.pathname.includes('/automation-runs/')) result = { run: { runId: u.pathname.split('/').at(-1), versionId: u.pathname.endsWith('/run-next') ? 'v2' : 'v1', state: 'waiting' }, actions: [{ path: '/notify-owner', type: 'notify', state: 'pending' }] };
            else if (u.pathname.endsWith('/automations')) result = { items: [copy(h.rule)], hasMore: false };
            else result = { rule: copy(h.rule), version: copy(h.versions.find(item => item.versionId === (u.searchParams.get('versionId') || h.rule.candidateVersion || h.rule.currentVersion))), diagnostics: [] };
            const hold = h.holds.findIndex(item => url.includes(item.match) && method === item.method);
            if (hold >= 0) await h.holds.splice(hold, 1)[0].promise;
            if (fail?.after) throw failure(fail.status, fail.code);
            return copy(result);
        };
        h.snapshot = extra => ({ actorUid: h.actor, project: { id: h.project, name: 'Dự án tiếng Việt — nhóm công việc', lifecycle: 'active', schemaRevision: 1 }, membership: { role: h.role }, members: [{ uid: 'owner', displayName: 'Nguyễn Thị Huyền', role: 'Owner' }, { uid: 'owner2', displayName: 'Trần Minh Quân', role: 'Owner' }], columns: [], sections: [{ id: 's', title: 'Việc cần làm' }], tasks: new Map(), filterOptionsReady: true, authorityRevision: 1, ...extra });
        h.controller = global.CrmAutomations.createController({ root: document.getElementById('projects-automations'), button: document.getElementById('btn-projects-automate'), apiFetchJson: h.api, getCurrentUser: () => ({ uid: h.actor }), refreshBoard: async () => {} });
        h.controller.init(); h.controller.setAccount(h.actor); h.controller.setSelection(h.project); h.controller.setContext(h.snapshot());
        h.shell = global.CrmProjectsShellV2?.createController({ document, panel: document.querySelector('[data-panel="projects"]'), getCurrentUser: () => ({ uid: h.actor }), openAutomations: () => h.controller.show() });
        h.shell?.init(); h.shell?.navigate('automations'); await h.controller.show();
        h.wait = () => new Promise(resolve => setTimeout(resolve, 0));
        h.click = async action => { document.querySelector(`#projects-automations [data-auto-action="${action}"]`).click(); await h.wait(); };
        h.sample = async () => { h.controller.beginSearch(); await h.controller.selectSearchTask('t'); };
        h.open = () => h.controller.openRule('r');
        return h;
    };
})(typeof window !== 'undefined' ? window : globalThis);
