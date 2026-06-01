const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('public/js/crm/agent-sources-workspace.js', 'utf8');
const context = {
    window: {},
    console
};
vm.runInNewContext(code, context);

function createInput(value = '') {
    return {
        value,
        focusCount: 0,
        focus() {
            this.focusCount += 1;
        }
    };
}

function createEventTarget(agentSourceId) {
    const card = {
        dataset: { agentSourceId },
        closest(selector) {
            return selector === '.crm-agent-source-card[data-agent-source-id]' ? card : null;
        }
    };
    return card;
}

function createListElement() {
    const listeners = {};
    return {
        innerHTML: '',
        addEventListener(type, handler) {
            listeners[type] = handler;
        },
        contains(node) {
            return !!node;
        },
        dispatch(type, event) {
            if (listeners[type]) listeners[type](event);
        }
    };
}

const dataCache = { agentSources: [] };
const elements = {
    selectAgentCourse: { innerHTML: '', value: '' },
    agentSourcesList: createListElement(),
    inputAgentSourceName: createInput(),
    inputAgentSourceStatus: createInput(),
    inputAgentSourceNotes: createInput(),
    btnCreateAgentSource: { disabled: false, textContent: '', addEventListener() {} },
    agentCourseRatesContainer: { innerHTML: '', addEventListener() {} },
    inputLeadAgentSource: null,
    inputStudentAgentSource: null
};

const controller = context.window.CrmAgentSourcesWorkspace.createController({
    elements,
    dataCache,
    escapeHtml: (value) => String(value ?? ''),
    apiFetchJson: async () => ({
        agentSources: [{
            agentSourceId: 'agent-1',
            name: 'Agent One',
            status: 'active',
            notes: 'Preferred',
            courseRates: {
                'course-1': 1500,
                'course-2': '1250'
            }
        }]
    })
});

(async () => {
    controller.init();
    await controller.refresh();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(dataCache.agentSources[0].courseRates)), {
        'course-1': 1500,
        'course-2': 1250
    });

    elements.agentSourcesList.dispatch('click', {
        target: createEventTarget('agent-1')
    });
    assert.strictEqual(elements.inputAgentSourceName.value, 'Agent One');
    assert.strictEqual(elements.inputAgentSourceStatus.value, 'active');
    assert.strictEqual(elements.inputAgentSourceNotes.value, 'Preferred');
    assert.strictEqual(elements.btnCreateAgentSource.textContent, 'Update Agent Source');
    assert.strictEqual(elements.inputAgentSourceName.focusCount, 1);
    assert.ok(elements.agentSourcesList.innerHTML.includes('crm-agent-source-card active'));
    assert.ok(elements.agentCourseRatesContainer.innerHTML.includes('value="15"'));

    let prevented = false;
    elements.inputAgentSourceName.value = '';
    elements.agentSourcesList.dispatch('keydown', {
        key: 'Enter',
        target: createEventTarget('agent-1'),
        preventDefault() {
            prevented = true;
        }
    });
    assert.strictEqual(prevented, true);
    assert.strictEqual(elements.inputAgentSourceName.value, 'Agent One');

    process.stdout.write('agent source workspace unit tests passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
