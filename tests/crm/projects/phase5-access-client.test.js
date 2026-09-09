'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/access.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function setup(adminMode = false) {
    const notices = [];
    let heldAccess = null, heldMembers = null, memberFailure = null;
    const node = () => ({ innerHTML: '', hidden: false, value: '', disabled: false, querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, addEventListener() {} });
    const elements = Object.fromEntries(['projectsProjectSelect', 'projectsMembersList', 'projectsMemberPerson', 'projectsMemberRole', 'projectsMemberEditor', 'projectsMemberSave', 'projectsPeopleList', 'staffProjectsPeopleList'].map((key) => [key, node()]));
    const project = { id: 'p1', name: 'Revoked project', role: 'Owner' };
    const summary = { projects: [project, { id: 'p2', name: 'Other allowed project', role: 'Viewer' }] };
    const context = { console, document: { getElementById: () => null } };
    vm.runInNewContext(source, context);
    const controller = context.CrmProjectsAccess.createController({ adminMode, elements, getCurrentUser: () => ({ uid: 'actor' }), onProjectsRendered: (selection) => notices.push(selection), apiFetchJson: async (url) => {
        if (url === '/api/projects/access' || url === '/api/projects/') return heldAccess ? heldAccess.promise : summary;
        if (url === '/api/projects/people') return { people: [{ uid: 'global-admin-person', displayName: 'Independent global directory', accountStatus: 'active', moduleGrants: { projects: true } }] };
        if (url.endsWith('/members')) { if (memberFailure) throw Object.assign(new Error('Membership management unavailable'), { status: memberFailure }); return heldMembers ? heldMembers.promise : { members: [{ uid: 'member-private', role: 'Owner' }] }; }
        if (url.endsWith('/eligible-people') || url.endsWith('/member-directory')) return { people: [{ uid: 'member-private', displayName: 'Private member' }] };
        return {};
    } });
    return { controller, elements, notices, summary, failMembers: (code) => { memberFailure = code; }, holdAccess: () => { heldAccess = deferred(); return heldAccess; }, holdMembers: () => { heldMembers = deferred(); return heldMembers; } };
}
test('denial clears selected access caches and ignores a held full refresh without auto-selecting another project', async () => {
    const h = setup(); await h.controller.refresh(); assert.equal(h.controller.getSelection().selectedProjectId, 'p1');
    const held = h.holdAccess(); const refresh = h.controller.refresh(); await flush();
    const before = h.notices.length;
    assert.equal(h.controller.invalidateProjectAccess('p1'), true);
    assert.equal(h.controller.invalidateProjectAccess('p1'), false);
    assert.equal(h.notices.length, before + 1);
    assert.equal(h.controller.getSelection().selectedProjectId, '');
    assert.equal(h.controller.getSelection().selectedProject, null);
    assert.equal(h.controller.getSelection().projects.length, 1);
    assert.doesNotMatch(h.elements.projectsPeopleList.innerHTML, /Revoked project/);
    assert.doesNotMatch(h.elements.projectsMembersList.innerHTML, /Private member/);
    assert.doesNotMatch(h.elements.projectsMemberPerson.innerHTML, /Private member/);
    held.resolve(h.summary); await refresh;
    assert.equal(h.controller.getSelection().selectedProjectId, '');
    assert.equal(h.controller.getSelection().projects.length, 1);
});
test('held member response cannot restore cleared names or enable membership editor', async () => {
    const h = setup(); await h.controller.refresh();
    const held = h.holdMembers(); const select = h.controller.selectProject('p1'); await flush();
    h.controller.invalidateProjectAccess('p1');
    held.resolve({ members: [{ uid: 'late-secret', role: 'Owner' }] }); await select;
    assert.equal(h.controller.getSelection().selectedProjectId, '');
    assert.doesNotMatch(h.elements.projectsMembersList.innerHTML, /late-secret|Private member/);
    assert.equal(h.elements.projectsMemberEditor.hidden, true);
    assert.equal(h.elements.projectsMemberSave.disabled, true);
});
test('project denial retains independently authorized global administrator directory', async () => {
    const h = setup(true); await h.controller.refresh();
    assert.match(h.elements.staffProjectsPeopleList.innerHTML, /Independent global directory/);
    h.controller.invalidateProjectAccess('p1');
    assert.match(h.elements.staffProjectsPeopleList.innerHTML, /Independent global directory/);
    assert.equal(h.elements.projectsMemberEditor.hidden, true);
    assert.equal(h.elements.projectsMemberSave.disabled, true);
    assert.doesNotMatch(h.elements.projectsMemberPerson.innerHTML, /Independent global directory/);
});

test('administrator content denial preserves independently authorized membership editor without reopening content', async () => {
    const h = setup(true); await h.controller.refresh();
    await h.controller.handleProjectContentDenied('p1');
    assert.equal(h.controller.getSelection().selectedProjectId, 'p1');
    assert.equal(h.elements.projectsMemberEditor.hidden, false);
    assert.equal(h.elements.projectsMemberSave.disabled, false);
    assert.match(h.elements.projectsMembersList.innerHTML, /member-private/);
    assert.equal(h.notices.at(-1).contentDeniedProjectIds.includes('p1'), true);
    // The shell sends an explicit empty content selection for a management-only project.
    const contentId = (selection) => selection.contentDeniedProjectIds.includes(selection.selectedProjectId) ? '' : selection.selectedProjectId;
    assert.equal(contentId(h.notices.at(-1)), '');
    await h.controller.refresh();
    assert.equal(h.controller.getSelection().selectedProjectId, 'p1');
    assert.equal(contentId(h.notices.at(-1)), '');
    assert.equal(h.elements.projectsMemberEditor.hidden, false);
});
for (const status of [403, 404]) test(`administrator content denial followed by members ${status} still clears management access`, async () => {
    const h = setup(true); await h.controller.refresh(); h.failMembers(status);
    await h.controller.handleProjectContentDenied('p1');
    assert.equal(h.controller.getSelection().selectedProjectId, '');
    assert.equal(h.elements.projectsMemberEditor.hidden, true);
    assert.doesNotMatch(h.elements.projectsMembersList.innerHTML, /member-private/);
});
test('nonadministrator content denial retains full access clearing', async () => {
    const h = setup(); await h.controller.refresh();
    h.controller.handleProjectContentDenied('p1');
    assert.equal(h.controller.getSelection().selectedProjectId, '');
    assert.doesNotMatch(h.elements.projectsPeopleList.innerHTML, /Revoked project/);
});
