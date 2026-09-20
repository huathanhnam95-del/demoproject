(function (scope) {
    'use strict';
    const supported = new Set(['text', 'number', 'date', 'people', 'status', 'priority', 'dropdown']);
    const builtins = [
        ['taskTitle', 'title', 'Task', 360, 300, 720],
        ['ownerUid', 'ownerUid', 'Owner', 180, 146, 360],
        ['status', 'status', 'Status', 160, 126, 320],
        ['dates', 'dates', 'Dates', 240, 200, 420],
        ['assigneeUids', 'assigneeUids', 'Collaborators', 180, 124, 360]
    ];
    function descriptors(columns = []) {
        const result = builtins.map(([key, kind, label, width, min, max]) => ({ key, kind, label, width, min, max, readonly: false }));
        const seen = new Set();
        for (const source of columns) {
            if (!source || typeof source.id !== 'string' || !source.id || seen.has(source.id)) continue;
            seen.add(source.id);
            result.push({ key: `custom:${source.id}`, kind: 'value', label: String(source.label || source.id), width: 160, min: 130, max: 480, source, readonly: !supported.has(source.type) });
        }
        return result;
    }
    function normalize(raw = {}, columns = []) {
        const all = descriptors(columns), keys = new Set(all.map(c => c.key));
        const valid = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const order = [...new Set((Array.isArray(valid.order) ? valid.order : []).filter(key => keys.has(key) && key !== 'taskTitle'))];
        if (!order.length) {
            const priority = all.filter(c => c.source?.type === 'priority');
            order.push('ownerUid', 'status', 'dates');
            if (priority.length === 1) order.push(priority[0].key);
            order.push('assigneeUids');
        }
        const widths = Object.create(null);
        all.forEach(c => { const value = valid.widths?.[c.key]; widths[c.key] = typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(c.min, Math.min(c.max, value))) : c.width; });
        return { version: 1, order: ['taskTitle', ...order, ...all.map(c => c.key).filter(key => key !== 'taskTitle' && !order.includes(key))], hidden: [...new Set((Array.isArray(valid.hidden) ? valid.hidden : []).filter(key => key !== 'taskTitle' && keys.has(key)))], widths };
    }
    function resolve(columns, preferences = {}) {
        const all = new Map(descriptors(columns).map(c => [c.key, c])), prefs = normalize(preferences, columns);
        return prefs.order.filter(key => !prefs.hidden.includes(key)).map(key => ({ ...all.get(key), width: prefs.widths[key] }));
    }
    function geometry(columns) { return { template: columns.map(c => `${c.width}px`).join(' '), minimumWidth: columns.reduce((sum, c) => sum + c.width, 0) }; }
    function windowRange(count, rowHeight, scrollTop, viewport, header = 0, overscan = 8) {
        const body = Math.max(rowHeight, viewport - header);
        return { first: Math.max(0, Math.floor(scrollTop / rowHeight) - overscan), last: Math.min(count, Math.ceil((scrollTop + body) / rowHeight) + overscan) };
    }
    scope.CrmProjectsColumnsV2 = { descriptors, normalize, resolve, geometry, windowRange, supported: type => supported.has(type) };
})(typeof window !== 'undefined' ? window : globalThis);
