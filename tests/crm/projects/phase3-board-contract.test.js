'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { runPhase3BoardStateCases } = require('./phase3-board-state-cases');
const expandedBrowser = require('../../browser/crm-projects/phase3-board-expanded-check');

const ROOT = path.resolve(__dirname, '../../..');

function read(relativePath) {
    const absolute = path.join(ROOT, relativePath);
    assert.ok(fs.existsSync(absolute), `Missing Phase3 file: ${relativePath}`);
    return fs.readFileSync(absolute, 'utf8');
}

function mustContain(source, needle, label) {
    assert.ok(source.includes(needle), `${label || needle} must be present`);
}

async function runInteractionCases(board) {
    // Execute unchanged production function bodies in bounded event/API contexts.
    // Chrome separately proves native focus behavior against the shipped DOM.
    const keyBody = board.slice(board.indexOf('        function onBoardKeydown('), board.indexOf('        async function refresh()', board.indexOf('        function onBoardKeydown(')));
    for (const writable of [true, false]) {
        const moves = []; let prevented = 0;
        const row = { dataset: { rowKind: 'task', rowId: 'row-b', taskId: 'b' }, closest: () => row };
        const sandbox = { selectedTaskId: '', canWrite: () => writable, expanded: new Set(), selectedSiblingMove: (...args) => moves.push(args), toggleTask: () => {}, taskFor: () => null, renderDetail: () => {}, renderBoard: () => {}, createTask: () => {} };
        vm.createContext(sandbox); vm.runInContext(keyBody, sandbox);
        for (const shiftKey of [false, true]) sandbox.onBoardKeydown({ target: row, key: 'Tab', shiftKey, preventDefault: () => prevented++ });
        assert.strictEqual(prevented, 0, 'Tab and ShiftTab never prevent native focus'); assert.deepStrictEqual(moves, []);
        if (writable) {
            for (const key of ['ArrowRight','ArrowLeft']) sandbox.onBoardKeydown({target:row,key,altKey:true,preventDefault:()=>prevented++});
            assert.deepStrictEqual(moves, [[0,1],[0,-1]], 'explicit Alt arrows indent and outdent');
            const input = {closest:()=>row}; sandbox.onBoardKeydown({target:input,key:'ArrowRight',altKey:true,preventDefault:()=>prevented++});
            assert.strictEqual(moves.length,2,'cell controls never trigger row shortcuts');
        }
    }
    const refreshBody = board.slice(board.indexOf('        async function refresh()'), board.indexOf('        function init()',board.indexOf('        async function refresh()')));
    for (const outcome of [false, true]) {
        const sandbox={currentProjectId:()=> 'p',loadProject:async()=>outcome};vm.createContext(sandbox);vm.runInContext(refreshBody,sandbox);
        assert.strictEqual(await sandbox.refresh(),outcome,'refresh returns actual load success');
    }
    const handler=board.match(/projectsBoardRefresh\?\.addEventListener\('click', (async \(\) => \{[\s\S]*?\n            \})\);/)[1];
    for (const scenario of ['success','failed','scope-changed','task-changed']) {
        let calls=0;const sandbox={selectedTaskId:'task',captureScope:()=>({}),scopeIsCurrent:()=>scenario!=='scope-changed',globalScope:{projectsDiscussionController:{refresh:async()=>calls++}}};
        sandbox.refresh=async()=>{if(scenario==='task-changed')sandbox.selectedTaskId='other';return scenario!=='failed';};vm.createContext(sandbox);
        await vm.runInContext(`(${handler})()`,sandbox);assert.strictEqual(calls,scenario==='success'?1:0,`manual refresh fence: ${scenario}`);
    }
    const saveBody=board.slice(board.indexOf('        async function createColumn('),board.indexOf('        async function saveSettings()'));
    for(const scenario of ['save','conflict','late','newer-schema']) {
        const original={id:'choice',type:'dropdown',revision:4};const editor={column:original,scope:{projectId:'p'},revision:4,schemaRevision:9,pending:false};
        let request;
        const sandbox={columnEditor:editor,canSchema:()=>true,scopeIsCurrent:()=>true,elements:{projectsBoardColumnLabel:{value:'Renamed'},projectsBoardColumnType:{value:'text'},projectsBoardColumnForm:{querySelectorAll:()=>[{dataset:{optionKey:'red'},value:'Crimson'},{dataset:{optionKey:'fresh'},value:'Green'}]}},operationId:()=> 'save-id',columns:[original],boardRevision:{schemaRevision:scenario==='newer-schema'?12:9},syncColumnForm:()=>{},showToast:()=>{},rankCompare:()=>0,renderBoard:()=>{}};
        sandbox.resetColumnForm=()=>{sandbox.columnEditor=null;};
        sandbox.requestMutation=async(url,payload,options)=>{request={url,payload,options};if(scenario==='conflict')throw Object.assign(new Error('stale'),{status:409});if(scenario==='late')sandbox.columnEditor={pending:false};return {column:{...original,label:'Renamed'},schemaRevision:10};};
        vm.createContext(sandbox);vm.runInContext(saveBody,sandbox);await sandbox.createColumn();
        assert.strictEqual(request.payload.expectedRevision,4);assert.strictEqual(request.payload.expectedSchemaRevision,9,'save fences original schema despite later board refresh');
        assert.strictEqual(request.payload.type,undefined,'existing type cannot migrate');
        assert.deepStrictEqual(JSON.parse(JSON.stringify(request.payload.options)),[{key:'red',label:'Crimson'},{key:'fresh',label:'Green'}]);
        if(scenario==='conflict'){assert.strictEqual(sandbox.columnEditor,editor);assert.strictEqual(editor.pending,false);}
        if(scenario==='newer-schema'){assert.strictEqual(sandbox.boardRevision.schemaRevision,12);assert.strictEqual(sandbox.columns[0],original);assert.strictEqual(sandbox.columnEditor,null);}
        if(scenario==='late')assert.strictEqual(sandbox.columns[0],original,'late completion cannot mutate new editor context');
    }
    return 12;
}

async function main() {
    const board = read('public/js/crm/projects/board.js');
    const interactionCases = await runInteractionCases(board);
    const state = read('public/js/crm/projects/state.js');
    const access = read('public/js/crm/projects/access.js');
    const html = read('public/crm-admin.html');
    const css = read('public/css/crm-projects.css');
    const shell = read('public/crm-admin.js');
    assert.strictEqual(typeof expandedBrowser.runPhase3BoardExpandedChecks, 'function', 'expanded Phase3 browser helper must export its runner.');
    const stateResults = await runPhase3BoardStateCases();
    assert.strictEqual(stateResults.length, 6, 'all executable Phase3 state cases must run.');
    for (const contract of ['createBoardState', 'switchProject', 'beginMutation', 'isMutationCurrent', 'setDraft', 'setBranch', 'setView']) {
        mustContain(state, contract, `production board state helper ${contract}`);
    }

    for (const contract of [
        ['parentScope', 'canonical parent branch filters'],
        ['branchCursors', 'per-branch continuation state'],
        ['expectedStructureRevision', 'structural revision fence'],
        ['expectedRevision', 'record revision fence'],
        ['operationId', 'idempotent mutation operation IDs'],
        ['requestMutation', 'bounded uncertain-outcome retry'],
        ['is-pending', 'optimistic pending presentation'],
        ['is-drop-parent', 'reparent drop preview'],
        ['startExpandHover', 'delayed expand-on-hover'],
        ['scrollTop', 'scroll preservation'],
        ['OVERSCAN', 'bounded virtualized rows'],
        ['selectedTaskId', 'stable detail selection'],
        ['ArrowDown', 'keyboard sibling movement'],
        ['ArrowRight', 'keyboard expand/collapse'],
        ['indentDelta', 'keyboard indent/outdent'],
        ['data-column-id', 'typed custom column controls'],
        ['/api/projects/', 'canonical Projects API routes']
    ]) mustContain(board, contract[0], contract[1]);
    mustContain(board, 'task.status', 'built-in task status remains distinct');
    mustContain(board, 'column.statusLabels', 'custom status labels use schema metadata');
    assert.ok(!board.includes('clientDB') && !board.includes('fakeClient'), 'Board must not introduce a client-only database.');

    for (const contract of [
        ['onProjectsRendered', 'shared selection callback'],
        ['async function selectProject', 'shared selection setter'],
        ['if (pending) return false', 'selection mutation fence'],
        ['getSelection', 'shared selection getter']
    ]) mustContain(access, contract[0], contract[1]);
    for (const id of [
        'projects-board-section', 'projects-board-project-select', 'projects-board-table',
        'projects-board-detail', 'projects-board-settings', 'btn-projects-board-add-column'
    ]) mustContain(html, `id="${id}"`, id);
    mustContain(html, 'js/crm/projects/board.js', 'board script integration');
    mustContain(html, 'js/crm/projects/state.js', 'board state script integration');
    mustContain(shell, 'projectsBoardController', 'CRM shell board integration');
    for (const contract of ['overflow-x: auto', 'position: sticky', 'overscroll-behavior', 'prefers-reduced-motion']) {
        mustContain(css, contract, `board CSS ${contract}`);
    }

    process.stdout.write(`crm projects Phase3 board contract passed (${stateResults.length} executable state cases, ${interactionCases} interaction cases)\n`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
