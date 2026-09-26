'use strict';
// Section blocks keep creation inside the table: the add rows, the subtask
// chevron and "Add section" never send people to a form above the board.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, tick } = require('./v2-quick-create.test.js');

test('sections render as blocks: title, own column labels, tasks, then the add row', async () => {
    const h = await fixture();
    try {
        const kinds = [...h.elements.projectsBoardRows.children].map(n => n.dataset.rowKind);
        assert.deepEqual(kinds.slice(0, 2), ['section', 'group-header']);
        assert.equal(h.elements.projectsBoardHeader.hidden, true);
        assert.ok(h.elements.projectsBoardTable.hasAttribute('data-group-blocks'));
        const labels = [...h.doc.querySelectorAll('[data-row-id="ghead:s"] [role="columnheader"]')].map(n => n.dataset.columnKey);
        assert.equal(labels[0], 'taskTitle');
        assert.ok(labels.includes('status'));
        assert.equal(h.doc.querySelector('[data-row-id="section:s"] .crm-muted'), null, 'no "root tasks" pill');
    } finally { h.close(); }
});

test('add rows are enabled once the board loads and after a refresh', async () => {
    const h = await fixture();
    try {
        const enabled = () => [...h.doc.querySelectorAll('[data-action="quick-task"]')].map(b => b.disabled);
        assert.deepEqual(enabled(), [false, false]);
        await h.board.refresh(); await tick();
        assert.deepEqual(enabled(), [false, false]);
    } finally { h.close(); }
});

test('"+ Add task" opens the composer inside its section row and keeps focus for the next task', async () => {
    const h = await fixture();
    try {
        h.doc.querySelector('[data-section-id="z"] [data-action="quick-task"]').click();
        const row = h.doc.querySelector('[data-row-kind="composer"]');
        assert.ok(row, 'composer row mounted in the table');
        const form = row.querySelector('[data-quick-create]');
        assert.ok(form);
        assert.equal(h.elements.projectsBoardTableWrap.previousElementSibling?.matches?.('[data-quick-create]') || false, false);
        const input = form.querySelector('input');
        assert.equal(h.doc.activeElement, input);
        input.value = 'Inline'; h.key(input, 'Enter'); await tick();
        assert.equal(h.writes.at(-1).body.sectionId, 'z');
        assert.equal(h.writes.at(-1).body.title, 'Inline');
        assert.equal(input.value, '');
        assert.ok(h.doc.querySelector('[data-row-kind="composer"] [data-quick-create]'), 'composer stays for rapid entry');
        // The new task sits above the composer, inside section z.
        const ids = [...h.elements.projectsBoardRows.children].map(n => n.dataset.rowId);
        assert.ok(ids.indexOf(`task:${h.writes.at(-1).body.id || 'new1'}`) < ids.indexOf('composer'));
        h.key(input, 'Escape'); await tick();
        assert.equal(h.doc.querySelector('[data-row-kind="composer"]'), null);
        assert.ok(h.doc.querySelector('[data-row-id="create:z"]'));
    } finally { h.close(); }
});

test('a task without subtasks shows a chevron that opens an inline subtask composer', async () => {
    const h = await fixture();
    try {
        // "u" has an unknown child count, so its chevron first checks the branch.
        const chevron = h.doc.querySelector('[data-task-id="u"] [data-action="toggle-task"]');
        assert.ok(chevron);
        chevron.click(); await tick();
        const row = h.doc.querySelector('[data-row-kind="composer"]');
        assert.ok(row);
        assert.equal(row.previousElementSibling.dataset.taskId, 'u');
        const input = row.querySelector('input');
        input.value = 'Child of u'; h.key(input, 'Enter'); await tick();
        assert.equal(h.writes.at(-1).body.parentTaskId, 'u');
        // The branch is now known to hold only the new subtask; collapsing hides it.
        h.key(input, 'Escape'); await tick();
        h.doc.querySelector('[data-task-id="u"] [data-action="toggle-task"]').click(); await tick();
        assert.equal(h.doc.querySelector('[data-row-kind="composer"]'), null);
        assert.equal(h.doc.querySelector('[data-row-id="subadd:u"]'), null);
    } finally { h.close(); }
});

test('an expanded task ends with "+ Add subtask", which opens the composer for that parent', async () => {
    const h = await fixture();
    try {
        h.doc.querySelector('[data-task-id="t"] [data-action="toggle-task"]').click(); await tick();
        const add = h.doc.querySelector('[data-row-id="subadd:t"] [data-action="quick-subtask"]');
        assert.ok(add);
        assert.equal(add.disabled, false);
        add.click(); await tick();
        const input = h.doc.querySelector('[data-row-kind="composer"] input');
        assert.ok(input);
        input.value = 'Second child'; h.key(input, 'Enter'); await tick();
        assert.equal(h.writes.at(-1).body.parentTaskId, 't');
    } finally { h.close(); }
});

test('toolbar New task opens the composer at the top of the first section', async () => {
    const h = await fixture();
    try {
        h.doc.getElementById('btn-projects-board-add-task').click(); await tick();
        const ids = [...h.elements.projectsBoardRows.children].map(n => n.dataset.rowId);
        assert.deepEqual(ids.slice(0, 3), ['section:s', 'ghead:s', 'composer']);
    } finally { h.close(); }
});
