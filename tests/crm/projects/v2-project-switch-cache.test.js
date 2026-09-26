'use strict';
// Returning to a recently opened project paints its last board at once and
// stays read-only until the server confirms access again.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, tick } = require('./v2-quick-create.test.js');

test('switching back paints the remembered board immediately without granting write access', async () => {
    const h = await fixture();
    try {
        h.doc.querySelector('[data-task-id="t"] [data-action="toggle-task"]').click(); await tick();
        assert.ok(h.doc.querySelector('[data-task-id="child"]'), 'expanded branch before leaving');
        h.select('q'); await tick();
        assert.equal(h.board.getState().project.id, 'q');
        h.select('p');
        // Synchronously after selection: remembered rows, expansion kept, no editing yet.
        assert.equal(h.board.getState().project.id, 'p');
        assert.ok(h.doc.querySelector('[data-task-id="t"]'));
        assert.ok(h.doc.querySelector('[data-task-id="child"]'), 'remembered expansion');
        assert.equal(h.board.getState().authorizationReady, false);
        assert.ok([...h.doc.querySelectorAll('[data-action="quick-task"]')].every(b => b.disabled));
        await tick();
        assert.equal(h.board.getState().authorizationReady, true);
        assert.ok([...h.doc.querySelectorAll('[data-action="quick-task"]')].every(b => !b.disabled));
    } finally { h.close(); }
});

test('the remembered board belongs to one person only', async () => {
    const h = await fixture();
    try {
        h.select('q'); await tick();
        h.actor('b');
        h.select('p');
        assert.notEqual(h.board.getState().project?.id, 'p', 'another actor never receives the cached board');
        assert.equal(h.board.getState().authorizationReady, false);
    } finally { h.close(); }
});
