(function (globalScope) {
  'use strict';
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const types = ['set_field', 'assign', 'move_section', 'create_task', 'notify', 'delay', 'if'];
  const triggers = ['task_created', 'status_changed', 'assignment_changed', 'due_date', 'all_direct_children_complete'];
  const builtins = { title: 'text', status: 'status', ownerUid: 'people', assigneeUids: 'people', startDate: 'date', dueDate: 'date' };
  const statuses = ['not_started', 'in_progress', 'blocked', 'done'];
  const priorities = ['none', 'low', 'medium', 'high', 'urgent'];
  const nodeId = () => `step-${globalScope.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  const leaf = () => ({ field: 'status', operator: 'equals', value: 'not_started' });
  function newNode(type = 'set_field', context = {}) {
    const sectionId = context.sections?.[0]?.id || '';
    const node = { nodeId: nodeId(), type };
    if (type === 'if') return { ...node, condition: leaf(), then: [newNode('set_field', context)], else: [] };
    const payloads = { set_field: { target: 'trigger_task', patch: { status: 'done' } }, assign: { target: 'trigger_task', ownerUid: null, assigneeUids: [] }, move_section: { target: 'trigger_task', sectionId }, create_task: { sectionId, parent: null, task: { title: '', status: 'not_started' } }, notify: { message: '', recipients: 'task_owner' }, delay: { durationMs: 60000 } };
    if (!payloads[type]) throw new Error('Unsupported step type.');
    return { ...node, payload: payloads[type] };
  }
  const create = context => ({ schemaVersion: 1, trigger: { type: 'task_created' }, steps: [newNode('set_field', context)] });
  function walk(definition, fn) {
    function visit(list, parentId = '', branch = 'steps', prefix = '') { (list || []).forEach((node, index) => { const path = `${prefix}/${node.nodeId}`; fn({ node, list, index, parentId, branch, path }); if (node.type === 'if') { visit(node.then, node.nodeId, 'then', `${path}/then`); visit(node.else, node.nodeId, 'else', `${path}/else`); } }); }
    visit(definition.steps);
  }
  function find(definition, id) { let match; walk(definition, entry => { if (entry.node.nodeId === id) match = entry; }); return match; }
  function editNode(definition, id, update) { const next = clone(definition), entry = find(next, id); if (!entry) throw new Error('Step no longer exists.'); const edited = update(clone(entry.node)); entry.list[entry.index] = { ...edited, nodeId: id }; return next; }
  function insert(definition, { parentId = '', branch = 'steps', afterId = '', type = 'set_field', context = {} } = {}) {
    const next = clone(definition), parent = parentId ? find(next, parentId)?.node : next;
    if (!parent || !['steps', 'then', 'else'].includes(branch) || !Array.isArray(parent[branch])) throw new Error('Step destination is unavailable.');
    const list = parent[branch], index = afterId ? list.findIndex(node => node.nodeId === afterId) : list.length - 1;
    if (afterId && index < 0) throw new Error('Step destination is unavailable.');
    list.splice(index + 1, 0, newNode(type, context)); return next;
  }
  function remove(definition, id) { const next = clone(definition), entry = find(next, id); if (!entry) throw new Error('Step no longer exists.'); if (entry.list.length === 1 && entry.branch !== 'else') throw new Error('Keep at least one step here. Add a replacement first.'); entry.list.splice(entry.index, 1); return next; }
  function reorder(definition, id, offset) { const next = clone(definition), entry = find(next, id); if (!entry) throw new Error('Step no longer exists.'); const to = entry.index + offset; if (!Number.isInteger(offset) || to < 0 || to >= entry.list.length) return next; entry.list.splice(to, 0, entry.list.splice(entry.index, 1)[0]); return next; }
  function duplicate(definition, id) { const next = clone(definition), entry = find(next, id); if (!entry) throw new Error('Step no longer exists.'); const copied = clone(entry.node); walk({ steps: [copied] }, ({ node }) => { node.nodeId = nodeId(); }); entry.list.splice(entry.index + 1, 0, copied); return next; }
  function setAt(object, path, value) {
    const next = clone(object), parts = Array.isArray(path) ? path : String(path).split('.');
    if (!parts.length || parts.some(key => ['__proto__', 'prototype', 'constructor'].includes(String(key)))) throw new Error('Invalid editor field.');
    let current = next; for (const key of parts.slice(0, -1)) { if (!current || typeof current !== 'object') throw new Error('Field no longer exists.'); if (current[key] === undefined) current[key] = {}; current = current[key]; }
    if (value === undefined) delete current[parts.at(-1)]; else current[parts.at(-1)] = clone(value);
    return next;
  }
  function getAt(object, path) { return (Array.isArray(path) ? path : String(path).split('.')).reduce((value, key) => value?.[key], object); }
  function fieldType(field, context = {}) { return typeof field === 'string' ? builtins[field] : context.columns?.find(column => column.id === field?.columnId)?.type; }
  function operators(type) { return ['equals', 'not_equals', ...(['number', 'date'].includes(type) ? ['less_than', 'less_or_equal', 'greater_than', 'greater_or_equal'] : []), ...(['text', 'people', 'dropdown'].includes(type) ? ['contains'] : []), ...(['people', 'dropdown'].includes(type) ? ['is_empty'] : [])]; }
  function defaultValue(type, context = {}, field) { if (type === 'number') return 0; if (type === 'status') return 'not_started'; if (type === 'priority') return 'none'; if (type === 'dropdown') return context.columns?.find(column => column.id === field?.columnId)?.options?.[0]?.key || ''; if (type === 'date' || type === 'people') return null; return ''; }
  function validate(definition, context = {}) {
    const errors = [], ids = new Set(); let count = 0;
    try { if (new TextEncoder().encode(JSON.stringify(definition)).length > 65536) return ['Definition exceeds the supported size.']; } catch (_) { return ['Definition cannot be read safely.']; }
    const err = message => errors.push(message);
    const plain = value => value && typeof value === 'object' && !Array.isArray(value);
    function keys(value, allowed, label) { if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) { err(`${label} has unsupported fields.`); return false; } return true; }
    function visit(depth) { count++; if (depth > 8) { err('Use no more than eight nested levels.'); return false; } if (count > 64) { err('Use no more than 64 steps and condition nodes.'); return false; } return true; }
    function literal(type, value, condition = false, allowMany = false) {
      if (value === null && type !== 'number') return;
      if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) err('Enter a finite number.');
      else if (type === 'status' && !statuses.includes(value)) err('Choose a current status.');
      else if (type === 'priority' && !priorities.includes(value)) err('Choose a priority.');
      else if (type === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) err('Choose a valid date.');
      else if (type === 'people' && !condition && allowMany && Array.isArray(value)) { if (value.some(uid => typeof uid !== 'string' || !uid)) err('Choose current people.'); }
      else if (!['number', 'status', 'priority', 'date'].includes(type) && typeof value !== 'string') err('Enter a supported typed value.');
    }
    function condition(value, depth) {
      if (!visit(depth)) return; if (!plain(value)) { err('Condition is required.'); return; }
      const group = ['all', 'any', 'not'].find(key => key in value);
      if (group) { keys(value, [group], 'Condition'); if (group === 'not') condition(value.not, depth + 1); else if (!Array.isArray(value[group]) || !value[group].length) err('Condition group needs a condition.'); else value[group].forEach(child => condition(child, depth + 1)); return; }
      if (!keys(value, ['field', 'operator', 'value'], 'Condition')) return;
      const type = fieldType(value.field, context); if (!type) { err('Replace the unavailable condition field.'); return; }
      if (typeof value.field === 'object') keys(value.field, ['columnId'], 'Condition field');
      if (!operators(type).includes(value.operator)) err('Choose an operator matching the field type.');
      if (value.operator !== 'is_empty') literal(type, value.value, true); else if ('value' in value) err('Empty conditions do not take a value.');
    }
    function taskFields(value, requiredTitle) {
      if (!keys(value, [...Object.keys(builtins), 'values'], 'Task fields')) return;
      if (requiredTitle && !(typeof value.title === 'string' && value.title.trim())) err('A created task needs a title.');
      for (const [field, v] of Object.entries(value)) {
        if (field === 'values') { if (!plain(v)) err('Custom values are invalid.'); else for (const [columnId, typed] of Object.entries(v)) { const type = fieldType({ columnId }, context); if (!type) err('Replace the unavailable custom field.'); else if (typed !== null) literal(type, typed, false, true); } }
        else if (field === 'assigneeUids') { if (!Array.isArray(v) || v.some(person => typeof person !== 'string' || !person) || new Set(v).size !== v.length) err('Choose distinct additional assignees.'); }
        else literal(builtins[field], v);
      }
      if (value.ownerUid && value.assigneeUids?.includes(value.ownerUid)) err('The accountable owner cannot also be an additional assignee.');
    }
    function target(value, nullable = false) { if (nullable && value === null || value === 'trigger_task') return; if (!keys(value, ['taskId'], 'Task target') || !value.taskId) err('Choose a task target.'); }
    function steps(list, depth, empty = false) {
      if (!Array.isArray(list) || !empty && !list.length) { err('Keep at least one required step.'); return 0; }
      let wait = 0;
      for (const node of list) {
        if (!visit(depth)) break; if (!keys(node, ['nodeId', 'type', 'payload', 'condition', 'then', 'else'], 'Step')) continue;
        if (typeof node.nodeId !== 'string' || !node.nodeId || ids.has(node.nodeId)) err('Every step needs a unique identity.'); ids.add(node.nodeId);
        if (!types.includes(node.type)) { err('Unsupported step.'); continue; }
        if (node.type === 'if') { if ('payload' in node) err('A branch cannot have an action payload.'); condition(node.condition, depth + 1); wait += Math.max(steps(node.then, depth + 1), steps(node.else || [], depth + 1, true)); continue; }
        if ('condition' in node || 'then' in node || 'else' in node) err('Only branches can contain conditions and branches.');
        const p = node.payload;
        const allowed = { set_field: ['target', 'patch'], assign: ['target', 'ownerUid', 'assigneeUids'], move_section: ['target', 'sectionId'], create_task: ['sectionId', 'parent', 'task'], notify: ['message', 'recipients'], delay: ['durationMs'] };
        if (!keys(p, allowed[node.type], 'Action')) continue;
        if (['set_field', 'assign', 'move_section'].includes(node.type)) target(p.target ?? 'trigger_task');
        if (node.type === 'set_field') { taskFields(p.patch, false); if (!p.patch || !Object.keys(p.patch).length) err('Choose a field to change.'); }
        if (node.type === 'assign') taskFields({ ownerUid: p.ownerUid ?? null, assigneeUids: p.assigneeUids || [] }, false);
        if (['move_section', 'create_task'].includes(node.type) && !p.sectionId) err('Choose a section.');
        if (node.type === 'create_task') { target(p.parent ?? null, true); taskFields(p.task, true); }
        if (node.type === 'delay') { if (!Number.isInteger(p.durationMs) || p.durationMs < 1 || p.durationMs > 2592000000) err('Delay must be greater than zero and at most 30 days.'); wait += p.durationMs || 0; }
        if (node.type === 'notify') { if (!(typeof p.message === 'string' && p.message.trim() && p.message.length <= 2000)) err('Enter a notification message of at most 2,000 characters.'); if (!['task_owner', 'task_assignees'].includes(p.recipients) && !(Array.isArray(p.recipients) && p.recipients.length && p.recipients.length <= 50 && new Set(p.recipients).size === p.recipients.length && p.recipients.every(uid => typeof uid === 'string' && uid))) err('Choose notification recipients.'); }
      }
      if (wait > 2592000000) err('Total waiting on a path cannot exceed 30 days.'); return wait;
    }
    if (!keys(definition, ['schemaVersion', 'trigger', 'condition', 'steps'], 'Definition')) return errors;
    if (definition.schemaVersion !== 1) err('Unsupported definition version.');
    if (keys(definition.trigger, ['type', 'from', 'to', 'time', 'offsetDays'], 'Trigger')) {
      const t = definition.trigger; if (!triggers.includes(t.type)) err('Choose a supported trigger.');
      if (t.type === 'due_date') { if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t.time || '09:00') || !Number.isInteger(t.offsetDays ?? 0) || Math.abs(t.offsetDays || 0) > 30) err('Choose Vietnam time and a day offset between -30 and 30.'); }
      else if ('time' in t || 'offsetDays' in t) err('Only due-date triggers accept time.');
      for (const key of ['from', 'to']) if (t[key] !== undefined && (t.type !== 'status_changed' || !statuses.includes(t[key]))) err('Choose a valid status transition.');
    }
    if (definition.condition !== undefined) condition(definition.condition, 1); steps(definition.steps, 1);
    if (count > 64) err('Use no more than 64 steps and condition nodes.');
    return [...new Set(errors)];
  }
  const RECIPES = [
    {
      id: 'status_move',
      title: 'When Status Changes to Done, Move to Section',
      description: 'Move completed tasks to another section automatically.',
      create: (context) => ({
        schemaVersion: 1,
        trigger: { type: 'status_changed', to: 'done' },
        steps: [newNode('move_section', context)]
      })
    },
    {
      id: 'subitem_rollup',
      title: 'When All Subitems Complete, Mark Parent Done',
      description: 'Automatically mark the parent task Done when all children are finished.',
      create: (context) => ({
        schemaVersion: 1,
        trigger: { type: 'all_direct_children_complete' },
        steps: [newNode('set_field', context)]
      })
    },
    {
      id: 'due_date_alert',
      title: 'When Due Date Arrives, Notify Owner',
      description: 'Alert the accountable owner on the morning a task is due.',
      create: () => ({
        schemaVersion: 1,
        trigger: { type: 'due_date', offsetDays: 0, time: '09:00' },
        steps: [{ nodeId: nodeId(), type: 'notify', payload: { message: 'This task is due today.', recipients: 'task_owner' } }]
      })
    },
    {
      id: 'auto_assign',
      title: 'When Task Created, Auto-Assign',
      description: 'Automatically assign newly created tasks.',
      create: (context) => ({
        schemaVersion: 1,
        trigger: { type: 'task_created' },
        steps: [newNode('assign', context)]
      })
    }
  ];

  function detectCompetingRules(rules = []) {
    const warnings = [];
    const active = (rules || []).filter(r => (r.lifecycle || r.status || 'active') === 'active');
    const triggerMap = new Map();
    active.forEach(r => {
      const trigger = r.definition?.trigger || {};
      const key = `${trigger.type}:${trigger.from || '*'}:${trigger.to || '*'}`;
      if (!triggerMap.has(key)) triggerMap.set(key, []);
      triggerMap.get(key).push(r);
    });
    triggerMap.forEach((matched, key) => {
      if (matched.length > 1) {
        warnings.push({
          triggerKey: key,
          ruleIds: matched.map(r => r.id || r.ruleId),
          message: `Competing automations: "${matched.map(r => r.title || r.name || r.id).join('", "')}" listen to the same trigger. They may conflict or execute concurrently.`
        });
      }
    });
    return warnings;
  }

  const api = { clone, types, triggers, builtins, statuses, priorities, nodeId, leaf, newNode, create, walk, find, editNode, insert, remove, reorder, duplicate, setAt, getAt, fieldType, operators, defaultValue, validate, RECIPES, detectCompetingRules };
  globalScope.CrmAutomationDefinitionEditor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
