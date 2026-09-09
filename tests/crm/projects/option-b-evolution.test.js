const assert = require('node:assert/strict');
const { resolveTaskState } = require('../../../functions/src/crm/projects/domain/hierarchy.js');
const { computeRollups } = require('../../../functions/src/crm/projects/domain/query-service.js');
const { validateProjectInput } = require('../../../functions/src/crm/projects/domain/validation.js');
require('../../../public/js/crm/projects/automation-definition-editor.js');
const AutomationEditor = globalThis.CrmAutomationDefinitionEditor;

console.log('Testing Option B Pragmatic Evolution features...');

// 1. Hierarchy depth limit (Level 0 - Level 4 allowed, Level 5 rejected)
{
  const tasks = [
    { id: 't0', data: { sectionId: 's1', parentTaskId: null, lifecycle: 'active' } },
    { id: 't1', data: { sectionId: null, parentTaskId: 't0', lifecycle: 'active' } },
    { id: 't2', data: { sectionId: null, parentTaskId: 't1', lifecycle: 'active' } },
    { id: 't3', data: { sectionId: null, parentTaskId: 't2', lifecycle: 'active' } },
    { id: 't4', data: { sectionId: null, parentTaskId: 't3', lifecycle: 'active' } },
  ];
  const sections = new Map([['s1', { id: 's1', data: { lifecycle: 'active' } }]]);

  // Level 4 is allowed (5th level total: t0=0, t1=1, t2=2, t3=3, t4=4)
  const s4 = resolveTaskState({ tasks, taskId: 't4', sections });
  assert.equal(s4.pathIds.length, 5);

  // Level 5 should be rejected
  assert.throws(() => {
    resolveTaskState({
      tasks: [...tasks, { id: 't5', data: { sectionId: null, parentTaskId: 't4', lifecycle: 'active' } }],
      taskId: 't5',
      sections
    });
  }, (err) => err.code === 'MAX_DEPTH_EXCEEDED');
  console.log('  ✔ Hierarchy 5-level depth limit verified.');
}

// 3. Workspace & Folder schema validation
{
  const validated = validateProjectInput({
    name: 'Engineering Roadmap',
    workspace: 'Product & Tech',
    folder: 'Q3 Deliverables'
  });
  assert.equal(validated.name, 'Engineering Roadmap');
  assert.equal(validated.workspace, 'Product & Tech');
  assert.equal(validated.folder, 'Q3 Deliverables');
  console.log('  ✔ Workspace and Folder validation verified.');
}

// 4. Pre-built Automation Recipes
{
  assert(Array.isArray(AutomationEditor.RECIPES), 'RECIPES should be an array');
  assert.equal(AutomationEditor.RECIPES.length, 4);

  const statusMove = AutomationEditor.RECIPES.find(r => r.id === 'status_move');
  assert(statusMove, 'status_move recipe exists');
  const moveDef = statusMove.create({ sections: [{ id: 's_done' }] });
  assert.equal(moveDef.trigger.type, 'status_changed');
  assert.equal(moveDef.trigger.to, 'done');
  assert.equal(moveDef.steps[0].type, 'move_section');

  const subitemRollup = AutomationEditor.RECIPES.find(r => r.id === 'subitem_rollup');
  assert(subitemRollup, 'subitem_rollup recipe exists');
  const rollupDef = subitemRollup.create({});
  assert.equal(rollupDef.trigger.type, 'all_direct_children_complete');

  console.log('  ✔ Pre-built Automation Recipes verified.');
}

// 5. Competing Rules Detection
{
  const rules = [
    { id: 'r1', title: 'Move to Done on Done', lifecycle: 'active', definition: { trigger: { type: 'status_changed', to: 'done' } } },
    { id: 'r2', title: 'Archive on Done', lifecycle: 'active', definition: { trigger: { type: 'status_changed', to: 'done' } } },
    { id: 'r3', title: 'Due reminder', lifecycle: 'active', definition: { trigger: { type: 'due_date' } } }
  ];

  const warnings = AutomationEditor.detectCompetingRules(rules);
  assert.equal(warnings.length, 1);
  assert(warnings[0].ruleIds.includes('r1'));
  assert(warnings[0].ruleIds.includes('r2'));
  assert(warnings[0].message.includes('Competing automations'));

  console.log('  ✔ Competing rules diagnostic detection verified.');
}

console.log('\n🎉 ALL OPTION B EVOLUTION TESTS PASSED EMPIRICALLY!');
