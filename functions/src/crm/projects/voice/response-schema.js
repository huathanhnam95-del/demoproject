'use strict';
// Describe domain fields explicitly. Server validation and current
// authorization remain authoritative, including conditional required fields.
const string = { type: 'string' };
const object = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
const taskFields = { title: string, status: { type: 'string', enum: ['not_started', 'in_progress', 'blocked', 'done'] }, ownerUid: { type: ['string', 'null'] }, assigneeUids: { type: 'array', items: string }, startDate: { type: ['string', 'null'] }, dueDate: { type: ['string', 'null'] }, values: { type: 'object', additionalProperties: true } };
const projectFields = { name: string, description: string };
const variant = (kind, properties, required) => object({ kind: { type: 'string', enum: [kind] }, ...properties }, ['kind', ...required]);
function responseSchema({ purpose, creation = false, targetKind = null }) {
    let result;
    if (purpose === 'planning') result = variant('planning', { text: string }, ['text']);
    else if (purpose === 'automation_draft') result = variant('automation_draft', { definition: { type: 'object', additionalProperties: true } }, ['definition']);
    else if (purpose === 'task_correction') {
        const key = targetKind === 'create_project' ? 'project' : targetKind === 'create_task' ? 'task' : targetKind === 'move_task' ? 'parentTaskId' : 'patch';
        result = variant('correction', { patch: object({ [key]: key === 'parentTaskId' ? string : object(targetKind === 'create_project' || targetKind === 'update_project' ? projectFields : taskFields) }, [key]) }, ['patch']);
    } else {
        const actions = creation ? [variant('create_project', { project: object(projectFields, ['name']) }, ['project'])] : [
            variant('field_update', { taskId: string, patch: object(taskFields), assigneeName: string, dueDateExpression: { type: 'string', enum: ['next Thursday'] } }, ['taskId', 'patch']),
            variant('move_task', { taskId: string, parentTaskId: string }, ['taskId', 'parentTaskId']),
            variant('create_task', { task: object(taskFields, ['title']), sectionId: string, parentTaskId: string }, ['task']),
            variant('update_project', { patch: object(projectFields) }, ['patch'])
        ];
        result = variant('task_draft', { actions: { type: 'array', minItems: 1, maxItems: creation ? 1 : 20, items: actions.length === 1 ? actions[0] : { anyOf: actions } } }, ['actions']);
    }
    return object({ kind: { type: 'string', enum: [result.properties.kind.enum[0], 'clarification'] }, ...Object.fromEntries(Object.entries(result.properties).filter(([key]) => key !== 'kind')), question: string }, ['kind']);
}
module.exports = { responseSchema };
