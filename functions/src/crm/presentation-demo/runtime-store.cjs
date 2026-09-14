'use strict';

const { clone } = require('./contracts.cjs');

function createMemoryRuntimeStore() {
    const values = new Map();
    return {
        async get(roomId) { return clone(values.get(roomId) ?? null); },
        async set(roomId, value) { values.set(roomId, clone(value)); return clone(value); },
        async update(roomId, updater) {
            const next = await updater(clone(values.get(roomId) ?? null));
            values.set(roomId, clone(next));
            return clone(next);
        },
        async delete(roomId) { values.delete(roomId); },
        values
    };
}

module.exports = { createMemoryRuntimeStore };
