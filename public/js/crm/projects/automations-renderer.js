(function (globalScope) {
  'use strict';
  const E = globalScope.CrmAutomationDefinitionEditor;
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const labels = { task_created: 'A task is created', status_changed: 'A status changes', assignment_changed: 'An assignment changes', due_date: 'A task reaches its due date', all_direct_children_complete: 'All direct children become complete', set_field: 'Change task fields', assign: 'Assign people', move_section: 'Move to section', create_task: 'Create a task', notify: 'Notify people', delay: 'Wait', if: 'If / otherwise', title: 'Title', status: 'Status', ownerUid: 'Accountable owner', assigneeUids: 'Additional assignees', startDate: 'Start date', dueDate: 'Due date', equals: 'equals', not_equals: 'does not equal', contains: 'contains', is_empty: 'is empty', less_than: 'is less than', less_or_equal: 'is at most', greater_than: 'is greater than', greater_or_equal: 'is at least' };
  const button = (action, text, attrs = '') => `<button type="button" class="crm-btn-secondary" data-auto-action="${action}" ${attrs}>${esc(text)}</button>`;
  const attr = (node, path, kind = '') => `data-auto-node="${esc(node)}" data-auto-path="${esc(JSON.stringify(path))}" data-auto-kind="${esc(kind)}"`;
  function options(items, selected, { multiple = false, empty = false } = {}) {
    const values = multiple ? (Array.isArray(selected) ? selected : []) : [selected];
    const all = items.slice();
    values.filter(value => value !== null && value !== undefined && value !== '' && !all.some(item => item.value === value)).forEach(value => all.unshift({ value, label: `Unavailable (${value})` }));
    return `${empty ? '<option value="">Choose…</option>' : ''}${all.map(item => `<option value="${esc(item.value)}"${values.includes(item.value) ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}`;
  }
  const select = (label, items, value, attrs, extra = '') => `<label>${esc(label)}<select class="crm-input" ${attrs} ${extra}>${options(items, value)}</select></label>`;
  const input = (label, value, attrs, type = 'text', extra = '') => `<label>${esc(label)}<input class="crm-input" type="${type}" value="${esc(value)}" ${attrs} ${extra}></label>`;
  const members = context => (context.members || []).map(person => ({ value: person.uid, label: person.displayName || person.email || person.uid }));
  const fields = context => Object.keys(E.builtins).map(key => ({ value: key, label: labels[key] })).concat((context.columns || []).filter(column => column.lifecycle !== 'archived').map(column => ({ value: `column:${column.id}`, label: column.label || column.name || column.id })));
  function fieldLabel(field, context) { if (typeof field === 'string' && field.startsWith('values.')) field = { columnId: field.slice(7) }; return typeof field === 'string' ? labels[field] || field : context.columns?.find(column => column.id === field?.columnId)?.label || `Unavailable field (${field?.columnId || ''})`; }
  function typed(label, value, type, node, path, context, field, isCondition = false) {
    const column = context.columns?.find(item => item.id === field?.columnId);
    if (type === 'people') {
      const multi = !isCondition && (path.at(-1) === 'assigneeUids' || typeof field === 'object');
      const people = members(context); if (!multi) people.unshift({ value: '', label: 'Unassigned' });
      return `<label>${esc(label)}<select class="crm-input" ${attr(node, path, multi ? 'people' : 'nullable')} ${multi ? 'multiple size="3"' : ''}>${options(people, value, { multiple: multi })}</select></label>`;
    }
    if (['status', 'priority', 'dropdown'].includes(type)) {
      const items = type === 'status' ? E.statuses.map(key => ({ value: key, label: column?.statusLabels?.[key] || context.project?.statusLabels?.[key] || key.replace(/_/g, ' ') })) : type === 'priority' ? E.priorities.map(key => ({ value: key, label: key })) : (column?.options || []).map(option => ({ value: option.key, label: option.label }));
      if (!isCondition && field && typeof field === 'object') items.unshift({ value: '', label: 'Clear value' });
      return select(label, items, value ?? '', attr(node, path, 'nullable'));
    }
    return input(label, value, attr(node, path, type === 'number' ? 'number' : type === 'date' ? 'nullable' : 'text'), type === 'number' ? 'number' : type === 'date' ? 'date' : 'text', type === 'number' ? 'step="any"' : 'maxlength="20000"');
  }
  function condition(value, node, path, context, optional = false) {
    const kind = !value ? 'none' : value.all ? 'all' : value.any ? 'any' : value.not ? 'not' : 'leaf';
    const kindOptions = [...(optional ? [{ value: 'none', label: 'No condition' }] : []), { value: 'leaf', label: 'One condition' }, { value: 'all', label: 'All conditions' }, { value: 'any', label: 'Any condition' }, { value: 'not', label: 'Not' }];
    let body = select('Condition match', kindOptions, kind, attr(node, path, 'condition-kind'));
    if (kind === 'none') return `<div class="crm-auto-condition">${body}</div>`;
    if (kind === 'all' || kind === 'any') {
      body += value[kind].map((child, index) => `<div class="crm-auto-condition-line">${condition(child, node, [...path, kind, index], context)}${value[kind].length > 1 ? button('condition-remove', 'Remove condition', `${attr(node, [...path, kind, index])}`) : ''}</div>`).join('');
      body += button('condition-add', 'Add condition', attr(node, [...path, kind]));
    } else if (kind === 'not') body += condition(value.not, node, [...path, 'not'], context);
    else {
      const field = typeof value.field === 'string' ? value.field : `column:${value.field?.columnId}`;
      const type = E.fieldType(value.field, context);
      body += `<div class="crm-auto-fields">${select('Field', fields(context), field, attr(node, [...path, 'field'], 'condition-field'))}${select('Comparison', E.operators(type).map(op => ({ value: op, label: labels[op] })), value.operator, attr(node, [...path, 'operator'], 'condition-operator'))}${value.operator === 'is_empty' ? '' : typed('Value', value.value, type, node, [...path, 'value'], context, value.field, true)}</div>`;
    }
    return `<div class="crm-auto-condition">${body}</div>`;
  }
  function target(value, node, path, context, nullable = false) {
    const mode = value === null ? 'none' : typeof value === 'object' ? 'explicit' : 'trigger_task';
    const items = [...(nullable ? [{ value: 'none', label: 'No parent (section root)' }] : []), { value: 'trigger_task', label: 'Trigger task' }, { value: 'explicit', label: 'Choose a task' }];
    return `<div class="crm-auto-target">${select(nullable ? 'Parent task' : 'Task', items, mode, attr(node, path, 'target-kind'))}${mode === 'explicit' ? `<span>${esc(context.taskLabels?.[value?.taskId] || `Unavailable or not yet checked (${value?.taskId || 'choose a task'})`)}</span>${button('task-search', 'Find task', attr(node, path))}` : ''}</div>`;
  }
  function patch(value, node, path, context, requiredTitle = false) {
    const entries = Object.entries(value || {}).flatMap(([field, v]) => field === 'values' ? Object.entries(v || {}).map(([columnId, typedValue]) => ({ field: { columnId }, value: typedValue, path: [...path, 'values', columnId] })) : [{ field, value: v, path: [...path, field] }]);
    return `<div class="crm-auto-fields">${entries.map(entry => `<div class="crm-auto-field-value">${typed(fieldLabel(entry.field, context), entry.value, E.fieldType(entry.field, context), node, entry.path, context, entry.field)}${requiredTitle && entry.field === 'title' ? '' : button('field-remove', 'Remove field', attr(node, entry.path))}</div>`).join('')}</div><label>Add a field<select class="crm-input" ${attr(node, path, 'add-field')}><option value="">Choose a field</option>${options(fields(context), '')}</select></label>`;
  }
  function steps(list, context, { mode = 'recipe', parentId = '', branch = 'steps', depth = 0, readOnly = false } = {}) {
    if (depth > 8) return '<p>Too many nested levels. This definition needs repair.</p>';
    return `<ol class="crm-auto-steps crm-auto-${esc(mode)}">${(list || []).map((node, index) => {
      let body = '';
      const p = node.payload || {}, id = node.nodeId;
      if (node.type === 'if') body = `${condition(node.condition, id, ['condition'], context)}<h5>Then</h5>${steps(node.then, context, { mode, parentId: id, branch: 'then', depth: depth + 1, readOnly })}<h5>Otherwise</h5>${steps(node.else, context, { mode, parentId: id, branch: 'else', depth: depth + 1, readOnly })}`;
      else if (node.type === 'set_field') body = target(p.target, id, ['payload', 'target'], context) + patch(p.patch, id, ['payload', 'patch'], context);
      else if (node.type === 'assign') body = target(p.target, id, ['payload', 'target'], context) + `<div class="crm-auto-fields">${typed('Accountable owner', p.ownerUid, 'people', id, ['payload', 'ownerUid'], context, 'ownerUid')}${typed('Additional assignees', p.assigneeUids, 'people', id, ['payload', 'assigneeUids'], context, 'assigneeUids')}</div>`;
      else if (node.type === 'move_section' || node.type === 'create_task') {
        body = (node.type === 'move_section' ? target(p.target, id, ['payload', 'target'], context) : target(p.parent, id, ['payload', 'parent'], context, true)) + select('Destination section', [{ value: '', label: 'Choose section' }, ...(context.sections || []).map(section => ({ value: section.id, label: section.title }))], p.sectionId, attr(id, ['payload', 'sectionId']));
        body += node.type === 'move_section' ? '<p class="crm-muted">The task and its subtree move to the section root, leaving their current parent.</p>' : patch(p.task, id, ['payload', 'task'], context, true);
      } else if (node.type === 'notify') {
        body = `<label>Message<textarea class="crm-input" maxlength="2000" ${attr(id, ['payload', 'message'])}>${esc(p.message)}</textarea></label>` + select('Recipients', [{ value: 'task_owner', label: 'Current task owner' }, { value: 'task_assignees', label: 'Current additional assignees' }, { value: 'explicit', label: 'Choose members' }], Array.isArray(p.recipients) ? 'explicit' : p.recipients, attr(id, ['payload', 'recipients'], 'recipient-kind'));
        if (Array.isArray(p.recipients)) body += `<label>Members<select class="crm-input" multiple size="3" ${attr(id, ['payload', 'recipients'], 'people')}>${options(members(context), p.recipients, { multiple: true })}</select></label>`;
      } else if (node.type === 'delay') body = input('Wait (minutes)', (p.durationMs || 0) / 60000, attr(id, ['payload', 'durationMs'], 'minutes'), 'number', 'min="0.0000166666666667" max="43200" step="any"') + '<p class="crm-muted">After waiting, conditions use a fresh task snapshot.</p>';
      else body = '<p>Unsupported step. Replace this step to repair the definition.</p>';
      return `<li class="crm-auto-step" data-auto-step="${esc(id)}"><header><span class="crm-auto-step-index">${mode === 'recipe' ? 'Then' : 'Step'} ${index + 1}</span>${select('Action', E.types.map(type => ({ value: type, label: labels[type] })), node.type, `data-auto-node="${esc(id)}" data-auto-kind="node-type"`)}${readOnly ? '' : `<div class="crm-auto-step-tools">${button('move-up', 'Move up', `data-node-id="${esc(id)}"${index === 0 ? ' disabled' : ''}`)}${button('move-down', 'Move down', `data-node-id="${esc(id)}"${index === list.length - 1 ? ' disabled' : ''}`)}${button('copy-step', 'Duplicate step', `data-node-id="${esc(id)}"`)}${button('remove-step', 'Remove step', `data-node-id="${esc(id)}"`)}</div>`}</header>${body}</li>`;
    }).join('')}</ol>${readOnly ? '' : button('add-step', 'Add step', `data-parent-id="${esc(parentId)}" data-branch="${esc(branch)}"`)}`;
  }
  function definition(value, context, mode = 'recipe', readOnly = false) {
    const trigger = value.trigger || {};
    let when = select('When', E.triggers.map(type => ({ value: type, label: labels[type] })), trigger.type, attr('', ['trigger'], 'trigger-kind'));
    const statusOptions = [{ value: '', label: 'Any status' }, ...E.statuses.map(key => ({ value: key, label: context.project?.statusLabels?.[key] || key.replace(/_/g, ' ') }))];
    if (trigger.type === 'status_changed') when += select('From', statusOptions, trigger.from || '', attr('', ['trigger', 'from'], 'optional')) + select('To', statusOptions, trigger.to || '', attr('', ['trigger', 'to'], 'optional'));
    if (trigger.type === 'due_date') when += input('Vietnam time', trigger.time || '09:00', attr('', ['trigger', 'time']), 'time') + input('Days before / after due date', trigger.offsetDays || 0, attr('', ['trigger', 'offsetDays'], 'number'), 'number', 'min="-30" max="30" step="1"');
    return `<fieldset class="crm-auto-definition"${readOnly ? ' disabled' : ''}><legend>${readOnly ? 'Saved definition' : 'Build the rule'}</legend><div class="crm-auto-when crm-auto-fields">${when}</div><h4>Only if</h4>${condition(value.condition, '', ['condition'], context, true)}${steps(value.steps, context, { mode, readOnly })}</fieldset>`;
  }
  function displayValue(value, field, context) {
    const type = typeof field === 'string' && field.startsWith('values.') ? E.fieldType({ columnId: field.slice(7) }, context) : E.builtins[field];
    if (field === 'values' && value && typeof value === 'object' && !Object.keys(value).length) return 'No custom values';
    if (value === null || value === undefined || value === '') return 'empty';
    if (type === 'people') return (Array.isArray(value) ? value : [value]).map(uid => context.members?.find(person => person.uid === uid)?.displayName || uid).join(', ') || 'unassigned';
    if (type === 'status') return context.project?.statusLabels?.[value] || String(value).replace(/_/g, ' ');
    return Array.isArray(value) ? value.map(String).join(', ') : typeof value === 'object' ? 'updated value' : String(value);
  }
  function preview(value, context) {
    if (!value) return '';
    return `<h4>Preview effects</h4><p>No tasks have changed and no notifications were sent. This sample describes the saved version only.</p>${!value.effects?.length ? '<p>The sample does not match, so this rule would make no changes.</p>' : `<ol>${value.effects.map(effect => `<li><strong>${esc(labels[effect.type] || 'Step')}</strong>${effect.target ? ` · ${esc(effect.target.label)}` : ''}${effect.provisional ? '<span class="crm-auto-warning"> Provisional after waiting</span>' : ''}${effect.changes?.length ? `<ul>${effect.changes.map(change => `<li>${esc(fieldLabel(change.field, context))}: ${esc(displayValue(change.before, change.field, context))} → ${esc(displayValue(change.after, change.field, context))}</li>`).join('')}</ul>` : ''}${effect.recipientUids?.length ? `<p>Notify: ${esc(displayValue(effect.recipientUids, 'assigneeUids', context))}</p>` : ''}${effect.section ? `<p>Section: ${esc(effect.section.label)}</p>` : ''}</li>`).join('')}</ol>`}${(value.warnings || []).map(warning => `<p class="crm-auto-warning">${esc(warning)}</p>`).join('')}`;
  }
  function versionSummary(rule, version, dirty) {
    return `<section class="crm-auto-version-summary" aria-label="Version state"><span class="crm-auto-badge">${!rule ? 'Unsaved · not active' : rule.enabled ? 'Enabled' : 'Disabled'}</span><dl><div><dt>${dirty ? 'Draft based on version' : 'Editing version'}</dt><dd>${esc(version?.versionId || 'New draft')}${dirty ? ' · unsaved changes' : ''}</dd></div><div><dt>Active version</dt><dd>${esc(rule?.enabled ? rule.currentVersion || 'Not available' : 'None running')}</dd></div>${rule?.candidateVersion ? `<div><dt>Candidate version</dt><dd>${esc(rule.candidateVersion)}</dd></div>` : ''}</dl><p>${rule?.enabled ? 'The active version continues until you explicitly activate a saved version.' : 'Saving a definition does not activate this automation.'}</p></section>`;
  }
  function manageList(items, { loading, cursor, actorName, locked }) {
    return `<h4>My automations</h4><ul class="crm-auto-manage-list" aria-busy="${loading}">${items.map(item => `<li><div><strong>${esc(item.title)}</strong><p>${esc(item.folder || 'Unfiled')} <span class="crm-auto-badge">${item.enabled ? 'Enabled' : 'Disabled'}</span></p><p>Active: ${esc((item.enabled ? item.currentVersion : null) || 'None')} · Candidate: ${esc(item.candidateVersion || 'None')}</p><p class="crm-muted">Active actor: ${esc(actorName(item.activeActorUid))} · Draft actor: ${esc(actorName(item.draftActorUid))}</p><span class="crm-muted">References checked when opened</span></div>${button('open-rule', 'Open automation', `data-rule-id="${esc(item.ruleId)}" aria-label="Open ${esc(item.title)}"${locked ? ' disabled' : ''}`)}</li>`).join('') || `<li class="crm-auto-empty">${loading ? 'Loading automations…' : cursor ? 'No matches in this page. Load more to continue.' : 'No matching automations. Adjust the filters or create a disabled draft.'}</li>`}</ul>${cursor ? button('more-rules', 'Load more automations', loading ? 'disabled' : '') : ''}`;
  }
  function recipes(recipes, locked) {
    return `<details class="crm-auto-recipes"><summary>Templates · start with a disabled draft</summary><div>${(recipes || []).map(recipe => `<button type="button" class="crm-btn-secondary" data-auto-action="apply-recipe" data-recipe-id="${esc(recipe.id)}"${locked ? ' disabled' : ''}><strong>${esc(recipe.title)}</strong><span>${esc(recipe.description)}</span></button>`).join('')}</div></details>`;
  }
  function previewContext(value, sample, usable) {
    if (!value) return '<p class="crm-muted">Save a version, choose an authorized sample task, then preview its effects.</p>';
    return `<dl class="crm-auto-preview-context"><div><dt>Previewed version</dt><dd>${esc(value.versionId)}</dd></div><div><dt>Sample task</dt><dd>${esc(sample?.title || 'Unavailable')}</dd></div><div><dt>Expires</dt><dd>${esc(value.expiresAt || 'Unavailable')}</dd></div></dl><p class="${usable ? 'crm-muted' : 'crm-auto-warning'}">${usable ? 'Preview is ready for explicit activation.' : 'This preview is expired or no longer matches. Generate a fresh preview.'}</p>`;
  }
  globalScope.CrmAutomationsRenderer = { esc, labels, button, attr, options, select, input, members, fields, fieldLabel, definition, preview, displayValue, versionSummary, manageList, recipes, previewContext };
})(typeof window !== 'undefined' ? window : globalThis);
