'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.resolve(__dirname, '../../public/js/crm/staff-workspace.js');

class FakeTableWrap {
    constructor(root) {
        this.root = root;
    }

    set innerHTML(value) {
        this.root.tableHtml = String(value);
    }
}

class FakeElement {
    constructor() {
        this.html = '';
        this.tableHtml = '';
        this.listeners = new Map();
        this.hasTableWrap = false;
        this.tableWrap = new FakeTableWrap(this);
    }

    set innerHTML(value) {
        this.html = String(value);
        this.hasTableWrap = this.html.includes('crm-account-table-wrap');
        this.tableHtml = this.html.includes('<div class="crm-account-table-wrap">')
            ? this.html.split('<div class="crm-account-table-wrap">')[1].split('</div>')[0]
            : '';
    }

    get innerHTML() {
        return this.html;
    }

    querySelector(selector) {
        if (selector === '.crm-account-table-wrap' && this.hasTableWrap) return this.tableWrap;
        return null;
    }

    querySelectorAll() {
        return [];
    }

    addEventListener(type, handler) {
        this.listeners.set(type, handler);
    }

    dispatch(type, target) {
        const handler = this.listeners.get(type);
        if (handler) handler({ target });
    }
}

function loadWorkspace() {
    const context = {
        window: {},
        navigator: {},
        document: {},
        console,
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
    return context.window.CrmStaffWorkspace;
}

async function main() {
    const accountList = new FakeElement();
    const teacherList = new FakeElement();
    const callbacks = [];
    const accounts = [
        { uid: 'staff&"one', email: 'one@example.test', displayName: 'Searchable', archived: false },
        { uid: 'archived-user', email: 'archived@example.test', displayName: 'Archived', archived: true }
    ];
    const workspace = loadWorkspace();
    const controller = workspace.createController({
        elements: { staffAccountList: accountList, staffTeacherList: teacherList },
        apiFetchJson: async (url) => url === '/api/admin/accounts'
            ? { accounts }
            : { teachers: [] },
        getCurrentUser: () => ({ uid: 'current-user' }),
        onAccountsRendered: () => callbacks.push({
            hasTable: accountList.tableHtml.includes('crm-account-table'),
            hasEscapedStaff: accountList.tableHtml.includes('data-account-uid="staff&amp;&quot;one"'),
            hasArchived: accountList.tableHtml.includes('data-account-uid="archived-user"')
        })
    });

    controller.init();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(callbacks.length, 1, 'account callback runs after initial repaint');
    assert.strictEqual(callbacks[0].hasTable, true);
    assert.deepStrictEqual(callbacks[0], { hasTable: true, hasEscapedStaff: true, hasArchived: false });
    assert.ok(accountList.tableHtml.includes('data-account-uid="staff&amp;&quot;one"'), 'row UID is escaped and stable');

    accountList.dispatch('input', { id: 'staff-account-search', value: 'Searchable' });
    assert.strictEqual(callbacks.length, 2, 'search repaint invokes account callback');
    assert.deepStrictEqual(callbacks[1], { hasTable: true, hasEscapedStaff: true, hasArchived: false });
    assert.ok(accountList.tableHtml.includes('data-account-uid="staff&amp;&quot;one"'));
    assert.ok(!accountList.tableHtml.includes('data-account-uid="archived-user"'));

    accountList.dispatch('input', { id: 'staff-account-search', value: '' });
    assert.strictEqual(callbacks.length, 3, 'clearing search repaints the account table');
    assert.deepStrictEqual(callbacks[2], { hasTable: true, hasEscapedStaff: true, hasArchived: false });
    accountList.dispatch('change', { id: 'staff-account-status-filter', value: 'archived' });
    assert.strictEqual(callbacks.length, 4, 'status repaint invokes account callback');
    assert.deepStrictEqual(callbacks[3], { hasTable: true, hasEscapedStaff: false, hasArchived: true });
    assert.ok(accountList.tableHtml.includes('data-account-uid="archived-user"'));
    assert.ok(!accountList.tableHtml.includes('data-account-uid="staff&amp;&quot;one"'));
    process.stdout.write('staff workspace repaint callback and row identity checks passed\n');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
