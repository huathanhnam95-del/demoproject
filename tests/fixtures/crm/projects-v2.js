'use strict';
// Pure synthetic data; no credentials, SDK initialization or production writes.
// IDs follow scripts/crm/projects/seed-fixtures.js for optional emulator use.
function createFixture(size = 30) {
    if (![30, 500, 5000].includes(size)) throw new Error('Choose the reviewed 30, 500 or 5000 task fixture.');
    const people = [
        { uid: 'crm-projects-teacher', role: 'Owner', displayName: 'Nguyễn Thị Minh Anh — Điều phối dự án học tập' },
        { uid: 'crm-projects-staff-editor', role: 'Editor', displayName: 'Trần Hoàng Phương Linh' },
        { uid: 'crm-projects-viewer', role: 'Viewer', displayName: 'Lê Nhật Minh' },
        { uid: 'crm-projects-unauthorized', role: null, displayName: 'No access fixture' }
    ];
    const projects = ['v2-a', 'v2-b'].map((id, i) => ({ id, name: `Dự án ${i + 1} — Kế hoạch học tập và phối hợp dài hạn`, lifecycle: 'active', revision: 1, structureRevision: 1, schemaRevision: 1, role: 'Owner' }));
    const sections = [{ id: 's', title: 'Công việc đang triển khai', rank: '0/1', lifecycle: 'active', revision: 1 }];
    const columns = ['text', 'number', 'date', 'people', 'status', 'priority', 'dropdown'].map((type, i) => ({ id: `c-${type}`, label: type, type, rank: `${i}/1`, options: type === 'dropdown' ? [{ key: 'current', label: 'Current option' }] : [] }));
    const statuses = ['not_started', 'in_progress', 'blocked', 'done'];
    const tasks = Array.from({ length: size }, (_, i) => {
        const parent = i >= 1 && i <= 3 ? `t${i - 1}` : i >= 100 ? 't4' : null;
        const ancestors = i >= 1 && i <= 3 ? Array.from({ length: i }, (_, n) => `t${n}`) : parent ? ['t4'] : [];
        return { id: `t${i}`, projectId: 'v2-a', title: i === 0 ? 'Chuẩn bị tài liệu tiếng Việt — phối hợp với Nguyễn Thị Minh Anh' : `Công việc ${i + 1}`,
            sectionId: 's', effectiveSectionId: 's', parentTaskId: parent, ancestorIds: ancestors, pathIds: [...ancestors, `t${i}`],
            rank: `${i}/1`, revision: 1, lifecycle: i === 5 ? 'archived' : 'active', status: statuses[i % 4],
            ownerUid: i % 3 ? people[1].uid : null, assigneeUids: i % 3 ? [people[0].uid] : [], startDate: null, dueDate: null,
            childCount: i < 3 ? 1 : i === 4 ? Math.max(0, size - 100) : 0,
            values: { 'c-text': 'Nội dung dài có dấu tiếng Việt', 'c-number': i, 'c-date': null, 'c-people': [], 'c-status': statuses[i % 4], 'c-priority': 'none', 'c-dropdown': i === 0 ? 'removed-option' : 'current' } };
    });
    // A task under an archived ancestor is deliberately excluded from active branches.
    tasks[6].parentTaskId = 't5'; tasks[6].ancestorIds = ['t5']; tasks[6].pathIds = ['t5', 't6']; tasks[5].childCount = 1;
    return { version: 'projects-v2-wave1', size, projects, people, sections, columns, tasks };
}
module.exports = { createFixture };
