'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDeferred } = require('../../crm/projects/phase3-board-state-cases');

function jsonHeaders() { return { 'content-type': 'application/json' }; }

function bodyValue(body, key) {
    return body?.[key] || body?.result?.[key] || body?.data?.[key] || null;
}

function requireOk(response, label) {
    assert.strictEqual(response.status, 200, `${label} failed: ${JSON.stringify(response.body)}`);
    return response.body;
}

function contextValue(context, key) {
    const value = context?.[key];
    assert.ok(value !== undefined && value !== null, `Phase3 expanded browser context requires ${key}.`);
    return value;
}

async function captureScreenshot(context, page, name) {
    if (!context.artifactDir) return;
    await page.screenshot({ path: path.join(context.artifactDir, name), fullPage: true });
}

async function captureKeyboardMoveState(context, page, ownerToken, projectId, rootA, rootB, name) {
    if (!context.artifactDir) return;
    const [roots, children, dom] = await Promise.all([
        listTasks(context, ownerToken, projectId, { parentScope: 'root' }),
        listTasks(context, ownerToken, projectId, { parentScope: 'direct', parentTaskId: rootB }),
        page.evaluate(({ rootA: expectedA, rootB: expectedB }) => ({
            rows: Array.from(document.querySelectorAll('[data-task-id]')).map((row) => ({
                id: row.dataset.taskId,
                selected: row.getAttribute('aria-selected'),
                visible: Boolean(row.getClientRects().length)
            })),
            rootAPresent: Boolean(document.querySelector(`[data-task-id="${expectedA}"]`)),
            rootBPresent: Boolean(document.querySelector(`[data-task-id="${expectedB}"]`)),
            activeRowId: document.activeElement?.closest?.('[data-task-id]')?.dataset?.taskId || null,
            activeTag: document.activeElement?.tagName || null,
            activeClass: document.activeElement?.className || null,
            status: document.getElementById('projects-board-status')?.textContent || '',
            busy: document.getElementById('projects-board-section')?.getAttribute('aria-busy') || null
        }), { rootA, rootB })
    ]);
    const movePath = `/api/projects/${projectId}/tasks/`;
    const artifact = {
        projectId,
        rootA,
        rootB,
        canonicalRootIds: roots.tasks.map((task) => task.id),
        canonicalDirectChildIds: children.tasks.map((task) => task.id),
        dom,
        moveRequests: (context.requestLog || []).filter((entry) => entry.method === 'POST' && entry.url.includes(movePath)),
        moveResponses: (context.responseLog || []).filter((entry) => entry.method === 'POST' && entry.url.includes(movePath))
    };
    fs.writeFileSync(path.join(context.artifactDir, name), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

async function api(context, requestPath, token, options = {}) {
    return context.apiRequest(context.server, requestPath, token, options);
}

function uniqueId(context, suffix) {
    if (typeof context.nextId === 'function') return context.nextId(suffix);
    const prefix = String(context.idPrefix || 'phase3-expanded').replace(/[^a-z0-9-]/gi, '-');
    return `${prefix}-${suffix}`.slice(0, 90);
}

async function readProject(context, projectId, token) {
    const response = await api(context, `/api/projects/${encodeURIComponent(projectId)}`, token);
    return bodyValue(requireOk(response, `read project ${projectId}`), 'project');
}

async function createProject(context, token, { projectId, name = projectId, description = '' } = {}) {
    const response = await api(context, '/api/projects/', token, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ operationId: uniqueId(context, `create-project-${projectId}`), projectId, name, description })
    });
    return bodyValue(requireOk(response, `create project ${projectId}`), 'project');
}

async function createSection(context, token, projectId, sectionId, title, expectedStructureRevision, index = 0) {
    const response = await api(context, `/api/projects/${encodeURIComponent(projectId)}/sections`, token, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ operationId: uniqueId(context, `create-section-${sectionId}`), sectionId, title, index, expectedStructureRevision })
    });
    const body = requireOk(response, `create section ${sectionId}`);
    return { section: bodyValue(body, 'section'), structureRevision: body.structureRevision ?? body.result?.structureRevision };
}

async function createTask(context, token, projectId, taskId, payload) {
    const response = await api(context, `/api/projects/${encodeURIComponent(projectId)}/tasks`, token, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ operationId: uniqueId(context, `create-task-${taskId}`), taskId, ...payload })
    });
    const body = requireOk(response, `create task ${taskId}`);
    return { task: bodyValue(body, 'task'), structureRevision: body.structureRevision ?? body.result?.structureRevision };
}

async function patchProject(context, token, projectId, payload) {
    const response = await api(context, `/api/projects/${encodeURIComponent(projectId)}`, token, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify(payload)
    });
    return response;
}

async function patchTask(context, token, projectId, taskId, payload) {
    const response = await api(context, `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, token, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify(payload)
    });
    return response;
}

async function createColumn(context, token, projectId, columnId, payload, expectedSchemaRevision, index = 999) {
    const response = await api(context, `/api/projects/${encodeURIComponent(projectId)}/columns`, token, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ operationId: uniqueId(context, `create-column-${columnId}`), columnId, index, expectedSchemaRevision, ...payload })
    });
    const body = requireOk(response, `create column ${columnId}`);
    return { column: bodyValue(body, 'column'), schemaRevision: body.schemaRevision ?? body.result?.schemaRevision };
}

async function listTasks(context, token, projectId, filters = { parentScope: 'root' }, extra = {}) {
    const query = new URLSearchParams({ pageSize: String(extra.pageSize || 200), filters: JSON.stringify(filters), sort: JSON.stringify({ field: 'rank', direction: 'asc' }) });
    if (extra.cursor) query.set('cursor', extra.cursor);
    const response = await api(context, `/api/projects/${encodeURIComponent(projectId)}/tasks?${query}`, token);
    return requireOk(response, `list tasks ${projectId}`);
}

async function listAllTaskPages(context, token, projectId, filters = { parentScope: 'root' }) {
    const tasks = [];
    let response = await listTasks(context, token, projectId, filters);
    let pageCount = 0;
    let hasNextPage = true;
    while (hasNextPage) {
        pageCount += 1;
        tasks.push(...(response.tasks || []));
        assert.ok(pageCount <= 10, `task continuation exceeded the bounded page budget for ${projectId}.`);
        hasNextPage = Boolean(response.nextCursor);
        if (!hasNextPage) break;
        response = await listTasks(context, token, projectId, filters, { cursor: response.nextCursor });
    }
    return { ...response, tasks, pageCount };
}

async function selectBoardProject(page, projectId, taskId = null) {
    // The native picker is retained for controller compatibility; the sidebar
    // is the visible project navigation in the legacy workspace too.
    await page.locator(`#projects-workspace-projects [data-workspace-project="${projectId}"]`).click();
    await page.locator('[data-view="board"]').click();
    await page.waitForFunction((id) => {
        const pickerElement = document.getElementById('projects-board-project-select');
        const section = document.getElementById('projects-board-section');
        const count = document.getElementById('projects-board-count')?.textContent || '';
        const loaded = window.projectsViewsController?.getState()?.response;
        return pickerElement?.value === id
            && section?.getAttribute('aria-busy') === 'false'
            && loaded?.project?.id === id && Boolean(loaded?.membership?.role)
            && /^\d+ loaded · \d+ sections?$/.test(count);
    }, projectId, { timeout: 30000 });
    if (taskId) await page.waitForSelector(`[data-task-id="${taskId}"]`, { timeout: 30000 });
    else await page.waitForSelector('#projects-board-workspace:not([hidden])', { timeout: 30000 });
}

async function assertBoardDetailTitle(page, taskId, expectedTitle) {
    const row = page.locator('[data-task-id="' + taskId + '"]');
    await row.waitFor({ state: 'visible', timeout: 30000 });
    await row.focus({ timeout: 30000 });
    await row.press('Enter', { timeout: 30000 });
    await page.locator('#projects-board-detail').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction((title) => document.getElementById('projects-board-detail-title')?.textContent === title, expectedTitle, { timeout: 30000 });
    assert.strictEqual(await page.locator('#projects-board-detail-title').textContent(), expectedTitle, 'board detail must render the canonical task title.');
    assert.strictEqual(await page.locator('#projects-board-detail-body dl').filter({ has: page.locator('dt', { hasText: /^Task ID$/ }) }).locator('dd').textContent(), taskId, 'board detail must belong to the selected task.');
    await page.locator('#btn-projects-board-close-detail').click();
    await page.locator('#projects-board-detail').waitFor({ state: 'hidden', timeout: 30000 });
}

async function waitForBoardInteractive(page) {
    await page.waitForFunction(() => {
        const workspace = document.getElementById('projects-board-workspace');
        const section = document.getElementById('projects-board-section');
        const count = document.getElementById('projects-board-count')?.textContent || '';
        const loaded = window.projectsViewsController?.getState()?.response;
        const addSection = document.getElementById('btn-projects-board-add-section');
        return workspace && !workspace.hidden && section?.getAttribute('aria-busy') === 'false'
            && document.getElementById('projects-board-table-wrap')?.hidden === false
            && loaded?.project?.id === document.getElementById('projects-board-project-select')?.value
            && Boolean(loaded?.membership?.role) && /^\d+ loaded · \d+ sections?$/.test(count)
            && addSection && !addSection.disabled;
    }, null, { timeout: 30000 });
}

async function waitForTaskGestureReady(page, taskId) {
    await page.waitForFunction((id) => {
        const row = document.querySelector(`[data-task-id="${id}"]`);
        const section = document.getElementById('projects-board-section');
        return row?.isConnected
            && row.getAttribute('draggable') === 'true'
            && !row.classList.contains('is-pending')
            && section?.getAttribute('aria-busy') !== 'true';
    }, taskId, { timeout: 30000 });
}

async function waitForRenderedTaskOrder(page, beforeId, afterId) {
    await page.waitForFunction(({ beforeId: firstId, afterId: secondId }) => {
        const first = document.querySelector(`[data-task-id="${firstId}"]`);
        const second = document.querySelector(`[data-task-id="${secondId}"]`);
        if (!first?.isConnected || !second?.isConnected) return false;
        return first.getBoundingClientRect().top < second.getBoundingClientRect().top;
    }, { beforeId, afterId }, { timeout: 30000 });
}

async function reloadBoard(page, projectId, taskId = null) {
    // Reload the board route, not a task modal left in navigation by a prior
    // selection or move. Task-detail restoration is a different interaction.
    const boardUrl = new URL(page.url());
    boardUrl.searchParams.delete('pjTask');
    boardUrl.searchParams.delete('pjTab');
    if (boardUrl.href === page.url()) await page.reload({ waitUntil: 'domcontentloaded' });
    else await page.goto(boardUrl.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('crm-loading')?.style.display === 'none', null, { timeout: 30000 });
    await page.waitForSelector('#projects-board-workspace:not([hidden])', { timeout: 30000 });
    await selectBoardProject(page, projectId, taskId);
}

function projectMutationCount(context, predicate) {
    return context.requestLog.filter((entry) => /^(POST|PATCH|DELETE)$/.test(entry.method) && predicate(entry)).length;
}

function waitForProjectResponse(page, pathname, method) {
    const expectedPath = pathname.replace(/\/$/, '');
    const responsePromise = page.waitForResponse((response) => (
        new URL(response.url()).pathname.replace(/\/$/, '') === expectedPath
        && response.request().method() === method
    ), { timeout: 30000 });
    // The action that follows can fail before the expected response is awaited.
    // Attach a rejection observer immediately so browser cleanup cannot turn the
    // abandoned response promise into an unhandled error that masks that action.
    responsePromise.catch(() => {});
    return responsePromise;
}

async function captureBoardSelectionFailure(context, page, label, error) {
    const state = await page.evaluate(() => ({
        pickerValue: document.getElementById('projects-board-project-select')?.value || '',
        pickerDisabled: Boolean(document.getElementById('projects-board-project-select')?.disabled),
        sectionBusy: document.getElementById('projects-board-section')?.getAttribute('aria-busy') || '',
        status: document.getElementById('projects-board-status')?.textContent || '',
        workspaceHidden: Boolean(document.getElementById('projects-board-workspace')?.hidden),
        refreshDisabled: Boolean(document.getElementById('btn-projects-board-refresh')?.disabled),
        addSectionDisabled: Boolean(document.getElementById('btn-projects-board-add-section')?.disabled),
        visibleTaskIds: Array.from(document.querySelectorAll('[data-task-id]')).map((row) => row.dataset.taskId)
    }));
    const redactUrl = (url) => String(url || '').replace(/[?&](token|access_token|idToken)=[^&]*/gi, '$1=[redacted]');
    const artifact = {
        label,
        error: String(error?.message || error),
        state,
        heldRequestSeen: Boolean(context.heldRefreshRequestSeen),
        requests: (context.requestLog || []).slice(-30).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), status: entry.status ?? null })),
        responses: (context.responseLog || []).slice(-30).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), status: entry.status ?? null })),
        requestFailed: (context.requestFailed || []).slice(-20).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), failure: entry.failure || null })),
        consoleErrors: (context.consoleErrors || []).slice(-20)
    };
    if (context.artifactDir) {
        fs.writeFileSync(path.join(context.artifactDir, `phase3-board-${label}-selection-failure.json`), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
        await captureScreenshot(context, page, `phase3-board-${label}-selection-failure.png`);
    }
    return artifact;
}

async function createUiProjectAndRows(context) {
    const page = context.page;
    const projectName = `Phase3 UI ${Date.now()}`;
    await page.locator('#btn-projects-board-create-project').click();
    await page.locator('#projects-board-project-name').fill(projectName);
    const responsePromise = waitForProjectResponse(page, '/api/projects', 'POST');
    await page.locator('#btn-projects-board-save-project').click();
    const response = await responsePromise;
    assert.strictEqual(response.status(), 200, 'UI project creation must be acknowledged.');
    const body = await response.json();
    const project = bodyValue(body, 'project');
    assert.ok(project?.id, 'UI project creation must return a persisted project ID.');
    await page.waitForFunction((id) => Array.from(document.querySelectorAll('#projects-board-project-select option')).some((option) => option.value === id), project.id, { timeout: 30000 });
    await selectBoardProject(page, project.id);
    await waitForBoardInteractive(page);

    const sectionPath = `/api/projects/${project.id}/sections`;
    const form = page.locator('#projects-board-section-form');
    const sectionName = page.locator('#projects-board-section-name');
    const cancelSection = page.locator('#btn-projects-board-cancel-section');
    await page.locator('#btn-projects-board-add-section').click();
    await form.waitFor({ state: 'visible', timeout: 30000 });
    const beforeCancel = projectMutationCount(context, (entry) => entry.method === 'POST' && entry.url.includes(sectionPath));
    await sectionName.fill('Cancelled section');
    await captureScreenshot(context, page, 'phase3-board-expanded-section-form.png');
    await cancelSection.click();
    await form.waitFor({ state: 'hidden', timeout: 30000 });
    assert.strictEqual(projectMutationCount(context, (entry) => entry.method === 'POST' && entry.url.includes(sectionPath)), beforeCancel, 'cancelling section creation must not write.');

    await page.locator('#btn-projects-board-add-section').click();
    await form.waitFor({ state: 'visible', timeout: 30000 });
    await sectionName.fill('UI Launch');
    const sectionResponsePromise = waitForProjectResponse(page, sectionPath, 'POST');
    await page.locator('#btn-projects-board-save-section').click();
    let sectionResponse;
    try {
        sectionResponse = await sectionResponsePromise;
    } catch (error) {
        const state = await page.evaluate(() => ({
            selectedProject: document.getElementById('projects-board-project-select')?.value || '',
            status: document.getElementById('projects-board-status')?.textContent || '',
            busy: document.getElementById('projects-board-section')?.getAttribute('aria-busy') || '',
            addSectionDisabled: document.getElementById('btn-projects-board-add-section')?.disabled ?? null,
            formHidden: document.getElementById('projects-board-section-form')?.hidden ?? null,
            sectionName: document.getElementById('projects-board-section-name')?.value || '',
            alerts: Array.from(document.querySelectorAll('[role="alert"], .admin-toast, .crm-toast')).map((node) => node.textContent || '')
        }));
        const requests = (context.requestLog || []).filter((entry) => entry.url.includes(sectionPath));
        const responses = (context.responseLog || []).filter((entry) => entry.url.includes(sectionPath));
        throw new Error(`${error.message}; Add section evidence=${JSON.stringify({ state, requests, responses, requestFailed: context.requestFailed || [], consoleErrors: context.consoleErrors || [] })}`);
    }
    const sectionBody = await sectionResponse.json();
    const section = bodyValue(sectionBody, 'section');
    assert.ok(section?.id, 'UI section creation must return a persisted section ID.');

    const taskResponsePromise = waitForProjectResponse(page, `/api/projects/${project.id}/tasks`, 'POST');
    await page.locator('#btn-projects-board-add-task').click();
    const taskBody = await (await taskResponsePromise).json();
    const root = bodyValue(taskBody, 'task');
    assert.ok(root?.id, 'UI root task creation must return a persisted task ID.');
    await page.waitForSelector(`[data-task-id="${root.id}"]`, { timeout: 30000 });
    const childResponsePromise = waitForProjectResponse(page, `/api/projects/${project.id}/tasks`, 'POST');
    await page.locator(`[data-task-id="${root.id}"] .crm-board-add-subtask`).click();
    const childBody = await (await childResponsePromise).json();
    const child = bodyValue(childBody, 'task');
    assert.strictEqual(child?.parentTaskId, root.id, 'The row subtask action must create a subtask under that row.');
    await page.waitForSelector(`[data-task-id="${child.id}"]`, { timeout: 30000 });
    return { project, section, root, child };
}

async function runCreationAndTypedColumnCase(context) {
    const ownerToken = contextValue(context, 'ownerToken');
    const page = contextValue(context, 'page');
    await createUiProjectAndRows(context);

    const projectId = uniqueId(context, 'typed-project');
    await createProject(context, ownerToken, { projectId, name: 'Phase3 typed columns' });
    let project = await readProject(context, projectId, ownerToken);
    const sectionId = uniqueId(context, 'typed-section');
    let created = await createSection(context, ownerToken, projectId, sectionId, 'Typed fields', project.structureRevision);
    let structureRevision = created.structureRevision;
    const taskId = uniqueId(context, 'typed-task');
    created = await createTask(context, ownerToken, projectId, taskId, { title: 'Typed task', sectionId, status: 'in_progress', expectedStructureRevision: structureRevision });
    structureRevision = created.structureRevision;
    let schemaRevision = project.schemaRevision;
    const definitions = [
        ['typed-text', { type: 'text', label: 'Text field' }],
        ['typed-number', { type: 'number', label: 'Number field' }],
        ['typed-date', { type: 'date', label: 'Date field' }],
        ['typed-people', { type: 'people', label: 'People field' }],
        ['typed-status', { type: 'status', label: 'Custom status', statusLabels: { not_started: 'Queued', in_progress: 'Doing', blocked: 'Waiting', done: 'Shipped' } }],
        ['typed-priority', { type: 'priority', label: 'Priority field' }],
        ['typed-dropdown', { type: 'dropdown', label: 'Dropdown field', options: [{ key: 'red', label: 'Red' }, { key: 'blue', label: 'Blue' }] }]
    ];
    const columns = [];
    for (const [suffix, definition] of definitions) {
        const result = await createColumn(context, ownerToken, projectId, uniqueId(context, suffix), definition, schemaRevision);
        schemaRevision = result.schemaRevision;
        columns.push(result.column);
    }
    await reloadBoard(page, projectId, taskId);
    const row = page.locator(`[data-task-id="${taskId}"]`);
    const headerCells = page.locator('#projects-board-header [role="columnheader"]');
    const rowCells = row.locator('[role="cell"]');
    assert.strictEqual(await headerCells.count(), 12, 'typed board must render five built-in plus seven custom headers.');
    assert.strictEqual(await rowCells.count(), 12, 'typed board row must render one cell per header.');
    for (let index = 0; index < 12; index += 1) {
        const headerBox = await headerCells.nth(index).boundingBox();
        const cellBox = await rowCells.nth(index).boundingBox();
        assert.ok(headerBox && cellBox && Math.abs(headerBox.x - cellBox.x) <= 2, `header/cell x alignment failed at column ${index}.`);
    }
    const values = new Map([
        ['typed-text', 'hello'], ['typed-number', '42'], ['typed-date', '2026-09-30'], ['typed-people', null],
        ['typed-status', 'done'], ['typed-priority', 'urgent'], ['typed-dropdown', 'blue']
    ]);
    for (const [suffix, definition] of definitions) {
        const column = columns.find((entry) => entry.label === definition.label);
        const field = row.locator(`.crm-board-field[data-field-kind="value"][data-column-id="${column.id}"]`);
        assert.strictEqual(await field.count(), 1, `typed ${suffix} editor must be rendered for the task`);
        const editor = definition.type === 'status'
            ? row.locator(`.crm-board-status-pill[data-column-id="${column.id}"]`) : field;
        await editor.waitFor({ state: 'visible', timeout: 30000 });
        assert.strictEqual(await editor.isVisible(), true, `typed ${suffix} editor must be visible in the board layout.`);
        // A save can trigger a fenced Table refresh between visibility and
        // geometry reads. Sample usable geometry after that fence settles.
        const geometry = await page.waitForFunction(({ taskId, columnId, status }) => {
            const row = document.querySelector(`[data-task-id="${taskId}"]`);
            const control = row?.querySelector(`${status ? '.crm-board-status-pill' : '.crm-board-field[data-field-kind="value"]'}[data-column-id="${columnId}"]`);
            const rect = control?.getBoundingClientRect();
            return rect && rect.width > 12 && rect.height > 12 ? rect.toJSON() : null;
        }, { taskId, columnId: column.id, status: definition.type === 'status' }, { timeout: 30000 });
        const fieldBox = await geometry.jsonValue();
        await geometry.dispose();
        assert.ok(fieldBox && fieldBox.width > 12 && fieldBox.height > 12, `typed ${suffix} editor must have a usable hit target.`);
        if (suffix === 'typed-people') {
            const options = await field.locator('option').count();
            assert.ok(options >= 2, 'people editor must expose an eligible member option');
            const memberValue = await field.locator('option').nth(1).getAttribute('value');
            const mutation = waitForProjectResponse(page, `/api/projects/${projectId}/tasks/${taskId}`, 'PATCH');
            await field.selectOption(memberValue);
            await field.blur();
            const response = await mutation;
            assert.strictEqual(response.status(), 200, 'typed people save must succeed');
            continue;
        }
        const value = values.get(suffix);
        const mutation = waitForProjectResponse(page, `/api/projects/${projectId}/tasks/${taskId}`, 'PATCH');
        if (definition.type === 'status') {
            await editor.click();
            await page.locator(`.crm-status-popover [data-status-key="${value}"]`).click();
        } else if (await field.evaluate((element) => element.tagName === 'SELECT')) await field.selectOption(value);
        else await field.fill(value);
        await field.blur();
        const response = await mutation;
        assert.strictEqual(response.status(), 200, `typed ${suffix} save must succeed`);
    }
    await page.locator('#projects-board-scroll').evaluate((element) => { element.scrollLeft = element.scrollWidth; element.dispatchEvent(new Event('scroll')); });
    const edgeColumn = columns.find((entry) => entry.type === 'status');
    const edgeStatus = row.locator(`.crm-board-status-pill[data-column-id="${edgeColumn.id}"]`);
    const edgeBox = await edgeStatus.boundingBox();
    assert.ok(edgeBox && edgeBox.width > 12 && edgeBox.height > 12, 'rightmost status editor must remain hit-testable after horizontal scroll.');
    const edgeHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest?.('.crm-board-status-pill')?.getAttribute('data-column-id') || '', {
        x: edgeBox.x + Math.min(edgeBox.width / 2, 10), y: edgeBox.y + Math.min(edgeBox.height / 2, 10)
    });
    assert.strictEqual(edgeHit, edgeColumn.id, 'right-edge field hit testing must resolve to the visible status control.');
    const rowBox = await row.boundingBox();
    const dateCell = row.locator('.crm-board-date-cell');
    const peopleField = row.locator(`select[data-column-id="${columns.find((entry) => entry.type === 'people').id}"]`);
    const startDateTrigger = row.locator('.crm-board-date-control').filter({ has: page.locator('input[data-field-kind="startDate"]') }).locator('.crm-board-date-trigger');
    for (const [label, control] of [['date', startDateTrigger], ['people', peopleField]]) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        assert.ok(box && box.width > 12 && box.height > 12, `${label} editor must remain hit-testable after scrolling.`);
        assert.ok(!rowBox || box.height <= rowBox.height + 2, `${label} editor must stay within the bounded task row height.`);
        const hit = await page.evaluate(({ x, y }) => {
            const target = document.elementFromPoint(x, y);
            const field = target?.closest?.('.crm-board-field')
                || target?.closest?.('.crm-board-date-control')?.querySelector('input.crm-board-field');
            return { fieldKind: field?.getAttribute('data-field-kind') || '', columnId: field?.getAttribute('data-column-id') || '' };
        }, {
            x: box.x + Math.min(box.width / 2, 10), y: box.y + Math.min(box.height / 2, 10)
        });
        assert.ok(label === 'date' ? hit.fieldKind === 'startDate' : hit.columnId === columns.find((entry) => entry.type === 'people').id, `${label} editor must resolve from its visible pointer target.`);
    }
    const dateCellBox = await dateCell.boundingBox();
    assert.ok(dateCellBox && (!rowBox || dateCellBox.height <= rowBox.height + 2), 'date cell must stay within the bounded task row height.');
    await captureScreenshot(context, page, 'phase3-board-expanded-typed.png');
    const persisted = await listTasks(context, ownerToken, projectId);
    const persistedTask = persisted.tasks.find((entry) => entry.id === taskId);
    assert.strictEqual(persistedTask.values[columns[0].id], 'hello');
    assert.strictEqual(persistedTask.values[columns[1].id], 42);
    assert.strictEqual(persistedTask.values[columns[2].id], '2026-09-30');
    assert.strictEqual(persistedTask.values[columns[4].id], 'done');
    assert.strictEqual(persistedTask.values[columns[5].id], 'urgent');
    assert.strictEqual(persistedTask.values[columns[6].id], 'blue');
    return { projectId, sectionId, taskId, columns };
}

async function runStatusLabelAndRoleCase(context, typed) {
    const ownerToken = contextValue(context, 'ownerToken');
    const page = contextValue(context, 'page');
    const projectId = typed?.projectId || context.projectId;
    const project = await readProject(context, projectId, ownerToken);
    await page.locator('[data-projects-open="projects-workspace-settings"]').click();
    const statusInput = page.locator('#projects-board-status-in-progress');
    await statusInput.fill('Working now');
    const save = waitForProjectResponse(page, `/api/projects/${projectId}`, 'PATCH');
    await page.locator('#btn-projects-board-save-settings').click();
    const saveResponse = await save;
    assert.strictEqual(saveResponse.status(), 200, 'Owner built-in status label save must succeed.');
    await reloadBoard(page, projectId, typed?.taskId);
    const builtIn = page.locator(`[data-task-id="${typed.taskId}"] select[data-field-kind="status"] option[value="in_progress"]`);
    assert.strictEqual(await builtIn.textContent(), 'Working now', 'built-in task.status labels must persist and render.');
    const customColumn = typed.columns.find((entry) => entry.type === 'status');
    const custom = page.locator(`[data-task-id="${typed.taskId}"] select[data-column-id="${customColumn.id}"] option[value="in_progress"]`);
    assert.strictEqual(await custom.textContent(), 'Doing', 'custom status-column labels must remain separate from built-in labels.');
    assert.ok(project.schemaRevision >= 0, 'status label case requires a schema revision for the Owner update contract.');

    // Exercise the backend patch contract directly after the real Owner UI
    // save. A partial map must merge with existing labels, while every
    // revision fence and label validator must reject malformed writes before
    // they can change the persisted project.
    const afterOwnerSave = await readProject(context, projectId, ownerToken);
    const labelsBeforePartial = { ...(afterOwnerSave.statusLabels || {}) };
    const partialOperationId = uniqueId(context, 'partial-status-labels');
    const partial = await patchProject(context, ownerToken, projectId, {
        operationId: partialOperationId,
        expectedRevision: afterOwnerSave.revision,
        expectedSchemaRevision: afterOwnerSave.schemaRevision,
        statusLabels: { done: 'Completed later' }
    });
    requireOk(partial, 'partial status label update');
    const afterPartial = await readProject(context, projectId, ownerToken);
    assert.strictEqual(afterPartial.statusLabels.done, 'Completed later', 'partial status label update must persist the changed key.');
    for (const [key, value] of Object.entries(labelsBeforePartial)) {
        if (key !== 'done') assert.strictEqual(afterPartial.statusLabels[key], value, `partial status label update must preserve ${key}.`);
    }
    const missingRecordRevision = await patchProject(context, ownerToken, projectId, {
        operationId: uniqueId(context, 'missing-project-revision'),
        expectedSchemaRevision: afterPartial.schemaRevision,
        statusLabels: { blocked: 'Blocked later' }
    });
    assert.strictEqual(missingRecordRevision.status, 400, 'project label update must require expectedRevision.');
    const staleRecordRevision = await patchProject(context, ownerToken, projectId, {
        operationId: uniqueId(context, 'stale-project-revision'),
        expectedRevision: afterPartial.revision - 1,
        expectedSchemaRevision: afterPartial.schemaRevision,
        statusLabels: { blocked: 'Blocked later' }
    });
    assert.strictEqual(staleRecordRevision.status, 409, 'project label update must reject a stale expectedRevision.');
    const missingSchemaRevision = await patchProject(context, ownerToken, projectId, {
        operationId: uniqueId(context, 'missing-schema-revision'),
        expectedRevision: afterPartial.revision,
        statusLabels: { blocked: 'Blocked later' }
    });
    assert.strictEqual(missingSchemaRevision.status, 400, 'status label update must require expectedSchemaRevision.');
    const staleSchemaRevision = await patchProject(context, ownerToken, projectId, {
        operationId: uniqueId(context, 'stale-schema-revision'),
        expectedRevision: afterPartial.revision,
        expectedSchemaRevision: afterPartial.schemaRevision - 1,
        statusLabels: { blocked: 'Blocked later' }
    });
    assert.strictEqual(staleSchemaRevision.status, 409, 'status label update must reject a stale expectedSchemaRevision.');
    const invalidStatusKey = await patchProject(context, ownerToken, projectId, {
        operationId: uniqueId(context, 'invalid-status-label-key'),
        expectedRevision: afterPartial.revision,
        expectedSchemaRevision: afterPartial.schemaRevision,
        statusLabels: { unknown: 'Should fail' }
    });
    assert.strictEqual(invalidStatusKey.status, 400, 'status label update must reject unknown keys.');
    const blankStatusLabel = await patchProject(context, ownerToken, projectId, {
        operationId: uniqueId(context, 'blank-status-label'),
        expectedRevision: afterPartial.revision,
        expectedSchemaRevision: afterPartial.schemaRevision,
        statusLabels: { blocked: '   ' }
    });
    assert.strictEqual(blankStatusLabel.status, 400, 'status label update must reject blank labels.');

    assert.strictEqual(typeof context.openRolePage, 'function', 'Phase3 browser matrix must provide real role pages; Viewer/Editor coverage cannot be skipped.');
    const roleUids = context.roleUids || {};
    let membershipRevision = Number(project.membershipRevision || 0);
    for (const [role, uid] of Object.entries(roleUids)) {
        if (!uid) continue;
        const member = await api(context, `/api/projects/${encodeURIComponent(projectId)}/members`, context.ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ uid, role: role === 'viewer' ? 'Viewer' : 'Editor', expectedRevision: membershipRevision })
        });
        const memberBody = requireOk(member, `add ${role} membership`);
        membershipRevision = Number(memberBody.membershipRevision
            ?? memberBody.member?.membershipRevision
            ?? memberBody.project?.membershipRevision
            ?? membershipRevision + 1);
    }
    const deniedBefore = await readProject(context, projectId, ownerToken);
    for (const role of ['viewer', 'editor']) {
        const roleToken = context.roleTokens?.[role];
        assert.ok(roleToken, `Phase3 role matrix requires a real ${role} token for backend denial coverage.`);
        const denied = await patchProject(context, roleToken, projectId, {
            operationId: uniqueId(context, `denied-${role}-status-labels`),
            expectedRevision: deniedBefore.revision,
            expectedSchemaRevision: deniedBefore.schemaRevision,
            statusLabels: { done: `${role} must fail` }
        });
        assert.strictEqual(denied.status, 403, `${role} must be denied project status-label writes.`);
        const afterDenied = await readProject(context, projectId, ownerToken);
        assert.deepStrictEqual(afterDenied, deniedBefore, `${role} denial must leave the persisted project unchanged.`);
    }
    const viewerPage = await context.openRolePage('viewer');
    try {
        await selectBoardProject(viewerPage, projectId, typed.taskId);
        const viewerMeta = await viewerPage.evaluate(() => ({
            addTaskDisabled: document.getElementById('btn-projects-board-add-task')?.disabled,
            addColumnDisabled: document.getElementById('btn-projects-board-add-column')?.disabled,
            status: document.getElementById('projects-board-status')?.textContent,
            selectedProject: document.getElementById('projects-board-project-select')?.value,
            memberRows: Array.from(document.querySelectorAll('#projects-members-list [data-uid]')).map((row) => row.textContent)
        }));
        assert.strictEqual(viewerMeta.addTaskDisabled, true, `Viewer cannot create tasks: ${JSON.stringify(viewerMeta)}`);
        assert.strictEqual(await viewerPage.locator('#btn-projects-board-add-column').isDisabled(), true, 'Viewer cannot edit schema.');
        assert.strictEqual(await viewerPage.locator(`[data-task-id="${typed.taskId}"] input[data-field-kind="title"]`).count(), 0, 'Viewer must not receive inline mutation controls.');

        const revoke = await api(context, `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(roleUids.viewer)}`, context.ownerToken, {
            method: 'DELETE', headers: jsonHeaders(), body: JSON.stringify({ expectedRevision: membershipRevision })
        });
        const revokeBody = requireOk(revoke, 'revoke viewer membership');
        membershipRevision = Number(revokeBody.membershipRevision ?? revokeBody.removed?.membershipRevision ?? membershipRevision + 1);
        await viewerPage.reload({ waitUntil: 'domcontentloaded' });
        await viewerPage.waitForFunction(() => document.getElementById('crm-loading')?.style.display === 'none', null, { timeout: 30000 });
        await viewerPage.waitForFunction(() => {
            const picker = document.getElementById('projects-board-project-select');
            const refresh = document.getElementById('btn-projects-access-refresh');
            return picker && !picker.disabled && refresh && !refresh.disabled;
        }, null, { timeout: 30000 });
        assert.strictEqual(await viewerPage.locator(`#projects-board-project-select option[value="${projectId}"]`).count(), 0, 'revoked membership must disappear from the project picker after a direct reload.');
        assert.strictEqual(await viewerPage.locator(`#projects-workspace-projects [data-workspace-project="${projectId}"]`).count(), 0, 'revoked membership must disappear from visible project navigation.');
        assert.strictEqual(await viewerPage.locator('#projects-board-workspace:not([hidden])').count(), 0, 'revoked membership must not retain project board data after reload.');
    } finally {
        await context.closeRolePage?.(viewerPage);
    }
    const editorPage = await context.openRolePage('editor');
    try {
        await selectBoardProject(editorPage, projectId, typed.taskId);
        assert.strictEqual(await editorPage.locator('#btn-projects-board-add-column').isDisabled(), true, 'Editor cannot add schema columns.');
        const editorTitle = editorPage.locator(`[data-task-id="${typed.taskId}"] input[data-field-kind="title"]`);
        assert.strictEqual(await editorTitle.count(), 1, 'Editor can edit task fields.');
        await editorTitle.fill('Editor downgrade draft');
        await editorTitle.focus();
        const downgrade = await api(context, `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(roleUids.editor)}`, context.ownerToken, {
            method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ role: 'Viewer', expectedRevision: membershipRevision })
        });
        const downgradeBody = requireOk(downgrade, 'downgrade editor membership');
        membershipRevision = Number(downgradeBody.membershipRevision ?? downgradeBody.member?.membershipRevision ?? membershipRevision + 1);
        const editorRefresh = editorPage.waitForResponse((response) => response.url().endsWith(`/api/projects/${projectId}`)
            && response.request().method() === 'GET', { timeout: 30000 });
        await editorPage.locator('#btn-projects-board-refresh').click();
        const editorRefreshResponse = await editorRefresh;
        assert.strictEqual(editorRefreshResponse.status(), 200, 'downgraded membership refresh must succeed.');
        const editorRefreshBody = await editorRefreshResponse.json();
        await editorPage.waitForFunction(() => document.getElementById('projects-board-section')?.getAttribute('aria-busy') !== 'true', null, { timeout: 30000 });
        assert.strictEqual(await editorPage.locator('#btn-projects-board-add-task').isDisabled(), true, 'a role downgrade must revoke task creation controls after refresh.');
        assert.strictEqual(await editorPage.locator(`[data-task-id="${typed.taskId}"] input[data-field-kind="title"]`).count(), 0, 'a focused Editor draft must lose mutation controls after an Owner-to-Viewer refresh.');
        assert.strictEqual(bodyValue(editorRefreshBody, 'membership')?.role, 'Viewer', 'the refresh that revokes Editor controls must return the current Viewer membership.');
    } finally {
        await context.closeRolePage?.(editorPage);
    }
    return { skippedRolePages: false };
}

async function runContinuationAndVirtualizationCase(context) {
    const ownerToken = contextValue(context, 'ownerToken');
    const page = contextValue(context, 'page');
    const projectId = uniqueId(context, 'pagination-project');
    await createProject(context, ownerToken, { projectId, name: 'Phase3 continuation and virtual board' });
    const project = await readProject(context, projectId, ownerToken);
    const sectionId = uniqueId(context, 'pagination-section');
    let structureRevision = (await createSection(context, ownerToken, projectId, sectionId, 'Many rows', project.structureRevision)).structureRevision;
    const rootIds = [];
    for (let index = 0; index < 205; index += 1) {
        const taskId = uniqueId(context, `root-${String(index).padStart(3, '0')}`);
        const result = await createTask(context, ownerToken, projectId, taskId, { title: `Root ${index}`, sectionId, expectedStructureRevision: structureRevision });
        structureRevision = result.structureRevision;
        rootIds.push(taskId);
    }
    const childIds = [];
    for (let index = 0; index < 205; index += 1) {
        const taskId = uniqueId(context, `child-${String(index).padStart(3, '0')}`);
        const result = await createTask(context, ownerToken, projectId, taskId, { title: `Child ${index}`, sectionId, parentTaskId: rootIds[0], expectedStructureRevision: structureRevision });
        structureRevision = result.structureRevision;
        childIds.push(taskId);
    }
    const roots = await listTasks(context, ownerToken, projectId, { parentScope: 'root' });
    assert.strictEqual(roots.tasks.length, 200, 'the first root page must be bounded at 200 records.');
    assert.ok(roots.nextCursor, 'the root query must expose a continuation cursor.');
    const rootsSecond = await listTasks(context, ownerToken, projectId, { parentScope: 'root' }, { cursor: roots.nextCursor });
    assert.deepStrictEqual(roots.tasks.concat(rootsSecond.tasks).map((entry) => entry.id).sort(), rootIds.slice().sort(), 'root continuation must return every exact root ID.');
    const directChildren = await listTasks(context, ownerToken, projectId, { parentScope: 'direct', parentTaskId: rootIds[0] });
    assert.strictEqual(directChildren.tasks.length, 200, 'the first direct-child page must be bounded at 200 records.');
    assert.ok(directChildren.nextCursor, 'the direct-child query must expose a continuation cursor.');
    const directChildrenSecond = await listTasks(context, ownerToken, projectId, { parentScope: 'direct', parentTaskId: rootIds[0] }, { cursor: directChildren.nextCursor });
    const canonicalChildIds = directChildren.tasks.concat(directChildrenSecond.tasks).map((entry) => entry.id);
    assert.deepStrictEqual(canonicalChildIds.slice().sort(), childIds.slice().sort(), 'direct-child continuation must return every exact child ID.');
    const rootRecord = roots.tasks.find((entry) => entry.id === rootIds[0]);
    const statusUpdate = await patchTask(context, ownerToken, projectId, rootIds[0], {
        operationId: uniqueId(context, 'active-child-count-filter-root'),
        expectedRevision: rootRecord.revision,
        status: 'done'
    });
    requireOk(statusUpdate, 'active child count filter root update');
    const filteredRoots = await listTasks(context, ownerToken, projectId, { parentScope: 'root', status: 'done' });
    assert.strictEqual(filteredRoots.matchingTaskCount, 1, 'status filter must return the one completed root fixture.');
    assert.strictEqual(filteredRoots.tasks[0].id, rootIds[0], 'status filter must return the completed root fixture.');
    assert.strictEqual(filteredRoots.tasks[0].activeChildCount, childIds.length, 'activeChildCount must count all active direct children before status filtering.');
    await reloadBoard(page, projectId, rootIds[0]);
    const rootRow = page.locator(`[data-task-id="${rootIds[0]}"]`);
    await rootRow.locator('.crm-board-expander').click();
    await page.waitForFunction((expectedRows) => Number(document.getElementById('projects-board-table')?.getAttribute('aria-rowcount') || 0) >= expectedRows, 411, { timeout: 30000 });
    const branchResponses = (context.responseLog || []).filter((entry) => entry.method === 'GET' && entry.url.includes(`/api/projects/${projectId}/tasks?`));
    const hasDirectBranchQuery = (entry) => {
        const decoded = decodeURIComponent(entry.url);
        return decoded.includes(`"parentTaskId":"${rootIds[0]}"`) && decoded.includes('"parentScope":"direct"');
    };
    assert.ok(branchResponses.some(hasDirectBranchQuery), 'expanded branch must issue a real direct-child query.');
    assert.ok(branchResponses.some((entry) => hasDirectBranchQuery(entry) && entry.url.includes('cursor=')), 'expanded branch must follow its continuation cursor for all direct children.');
    const childRows = await page.locator('[data-task-id]').count();
    assert.ok(childRows < 100, `virtual board must keep bounded DOM rows, got ${childRows}`);
    const total = Number(await page.locator('#projects-board-table').getAttribute('aria-rowcount'));
    assert.ok(total >= 411, `logical row count must include all loaded rows, got ${total}`);
    const rootIndex = roots.tasks.concat(rootsSecond.tasks).findIndex((entry) => entry.id === rootIds[0]);
    const childIndex = canonicalChildIds.findIndex((id) => id === childIds[204]);
    assert.ok(rootIndex >= 0 && childIndex >= 0, 'canonical continuation order must locate the expanded root and target child.');
    const targetChildIndex = 1 + rootIndex + 1 + childIndex;
    await page.locator('#projects-board-scroll').evaluate((element, index) => {
        const rowHeight = 46;
        element.scrollTop = Math.max(0, index * rowHeight - element.clientHeight / 2);
        element.dispatchEvent(new Event('scroll'));
    }, targetChildIndex);
    await page.waitForSelector(`[data-task-id="${childIds[204]}"]`, { timeout: 30000 });
    await captureScreenshot(context, page, 'phase3-board-expanded-virtual-bottom.png');
    return { projectId, rootIds, childIds, total, boundedRows: childRows };
}

async function runHoverAndEdgeAutoscrollCase(context, pagination) {
    const ownerToken = contextValue(context, 'ownerToken');
    const page = contextValue(context, 'page');
    const projectId = pagination?.projectId;
    const rootIds = pagination?.rootIds || [];
    assert.ok(projectId && rootIds.length > 20, 'hover and edge autoscroll require the dense real board fixture.');

    await reloadBoard(page, projectId, rootIds[1]);
    const source = page.locator(`[data-task-id="${rootIds[1]}"]`);
    const parentTarget = page.locator(`[data-task-id="${rootIds[0]}"]`);
    const sourceHandle = source.locator('[data-action="drag-handle"]');
    await sourceHandle.scrollIntoViewIfNeeded();
    await parentTarget.scrollIntoViewIfNeeded();
    const sourceBox = await sourceHandle.boundingBox();
    const parentBox = await parentTarget.boundingBox();
    assert.ok(sourceBox && parentBox, 'hover-expand source and target must be visible.');
    const cursor409Responses = [];
    const cursorResponsePromises = [];
    const captureCursorResponse = (response) => {
        if (response.status() !== 409) return;
        let parsedUrl;
        try { parsedUrl = new URL(response.url()); } catch (_) { return; }
        if (parsedUrl.pathname !== `/api/projects/${projectId}/tasks` || !parsedUrl.searchParams.has('cursor')) return;
        let filters;
        try { filters = JSON.parse(parsedUrl.searchParams.get('filters') || '{}'); } catch (_) { return; }
        if (filters.parentScope !== 'direct' || filters.parentTaskId !== rootIds[0]) return;
        const capture = (async () => {
            let body = null;
            let bodyError = null;
            try {
                const text = await response.text();
                body = JSON.parse(text);
            } catch (error) {
                bodyError = String(error?.message || error);
            }
            cursor409Responses.push({ status: response.status(), url: response.url(), body, bodyError });
        })();
        cursorResponsePromises.push(capture);
    };
    page.on('response', captureCursorResponse);
    await page.evaluate(() => {
        if (window.__phase3DragAuditAttached) return;
        window.__phase3DragAuditAttached = true;
        window.__phase3DragAudit = [];
        window.__phase3DragAuditSourceId = null;
        window.__phase3DragAuditParentId = null;
        for (const type of ['dragstart', 'dragover', 'dragleave', 'drop', 'dragend']) {
            document.addEventListener(type, (event) => {
                const targetRow = event.target?.closest?.('[data-task-id], [data-section-id]') || null;
                const targetId = targetRow?.dataset?.taskId || targetRow?.dataset?.sectionId || null;
                const sourceRow = window.__phase3DragAuditSourceId
                    ? document.querySelector(`[data-task-id="${window.__phase3DragAuditSourceId}"]`)
                    : null;
                const parentRow = window.__phase3DragAuditParentId
                    ? document.querySelector(`[data-task-id="${window.__phase3DragAuditParentId}"]`)
                    : null;
                const currentTarget = targetId
                    ? document.querySelector(`[data-task-id="${targetId}"], [data-section-id="${targetId}"]`)
                    : null;
                const relatedRow = event.relatedTarget?.closest?.('[data-task-id], [data-section-id]') || null;
                window.__phase3DragAudit.push({
                    type,
                    pointer: { x: event.clientX, y: event.clientY },
                    targetId,
                    targetConnected: Boolean(targetRow?.isConnected),
                    targetMatchesCurrent: Boolean(targetRow && currentTarget === targetRow),
                    targetRect: (() => { const rect = targetRow?.getBoundingClientRect?.(); return rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : null; })(),
                    relatedTargetId: relatedRow?.dataset?.taskId || relatedRow?.dataset?.sectionId || null,
                    sourceConnected: Boolean(sourceRow?.isConnected),
                    parentConnected: Boolean(parentRow?.isConnected)
                });
            }, true);
        }
    });
    await page.evaluate(({ sourceId, parentId }) => {
        window.__phase3DragAuditSourceId = sourceId;
        window.__phase3DragAuditParentId = parentId;
    }, { sourceId: rootIds[1], parentId: rootIds[0] });
    if (context.artifactDir) fs.writeFileSync(path.join(context.artifactDir, 'phase3-board-hover-start-geometry.json'), `${JSON.stringify({ sourceBox, parentBox, destination: { x: parentBox.x + parentBox.width * .84, y: parentBox.y + parentBox.height / 2 } }, null, 2)}\n`, 'utf8');
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(parentBox.x + parentBox.width * .84, parentBox.y + parentBox.height / 2, { steps: 8 });
    // Crossing child controls can end on dragenter. Send the next native move
    // at the destination so the parent receives dragover before the hover wait.
    await page.mouse.move(parentBox.x + parentBox.width * .84, parentBox.y + parentBox.height / 2);
    await page.waitForFunction((id) => document.querySelector(`[data-task-id="${id}"] .crm-board-expander`)?.getAttribute('aria-expanded') === 'true', rootIds[0], { timeout: 5000 });
    assert.ok(await page.locator(`[data-task-id="${rootIds[0]}"] .crm-board-expander`).getAttribute('aria-expanded') === 'true', 'hovering a parent drop target must expand it before release.');
    const dragAuditAtExpand = await page.evaluate(({ sourceId, parentId }) => ({
        sourceConnected: Boolean(document.querySelector(`[data-task-id="${sourceId}"]`)),
        sourceRect: (() => { const rect = document.querySelector(`[data-task-id="${sourceId}"]`)?.getBoundingClientRect(); return rect ? { top: rect.top, bottom: rect.bottom, height: rect.height } : null; })(),
        parentConnected: Boolean(document.querySelector(`[data-task-id="${parentId}"]`)),
        events: window.__phase3DragAudit || []
    }), { sourceId: rootIds[1], parentId: rootIds[0] });
    if (context.artifactDir) fs.writeFileSync(path.join(context.artifactDir, 'phase3-board-hover-drag-audit.json'), `${JSON.stringify({ atExpand: dragAuditAtExpand }, null, 2)}\n`, 'utf8');
    const hoverMove = waitForProjectResponse(page, `/api/projects/${projectId}/tasks/${rootIds[1]}/move`, 'POST');
    await page.mouse.up();
    try {
        await hoverMove;
    } catch (error) {
        if (context.artifactDir) {
            const dragAuditAfterRelease = await page.evaluate((sourceId) => ({
                sourceConnected: Boolean(document.querySelector(`[data-task-id="${sourceId}"]`)),
                events: window.__phase3DragAudit || []
            }), rootIds[1]);
            fs.writeFileSync(path.join(context.artifactDir, 'phase3-board-hover-drag-audit.json'), `${JSON.stringify({ atExpand: dragAuditAtExpand, afterRelease: dragAuditAfterRelease, moveRequests: (context.requestLog || []).filter((entry) => entry.url.includes(`/tasks/${rootIds[1]}/move`)), moveResponses: (context.responseLog || []).filter((entry) => entry.url.includes(`/tasks/${rootIds[1]}/move`)) }, null, 2)}\n`, 'utf8');
        }
        throw error;
    }
    await waitForBoardInteractive(page);
    for (let attempt = 0; attempt < 40 && !(context.responseLog || []).some((entry) => entry.method === 'GET'
        && entry.status === 409 && entry.url.includes(`/api/projects/${projectId}/tasks?`)
        && entry.url.includes('cursor=')); attempt += 1) await page.waitForTimeout(50);
    await Promise.allSettled(cursorResponsePromises);
    page.off('response', captureCursorResponse);
    const cursor409Requests = (context.responseLog || []).filter((entry) => entry.method === 'GET'
        && entry.status === 409 && entry.url.includes(`/api/projects/${projectId}/tasks?`) && entry.url.includes('cursor='));
    assert.strictEqual(cursor409Responses.length, cursor409Requests.length, 'every cursor 409 must have a captured response body for exact error classification.');
    for (const cursorResponse of cursor409Responses) {
        assert.strictEqual(cursorResponse.bodyError, null, `cursor 409 response body must be valid JSON: ${cursorResponse.bodyError || 'unknown error'}`);
        assert.strictEqual(cursorResponse.body?.error || cursorResponse.body?.code || cursorResponse.body?.result?.error, 'STALE_CURSOR', `unexpected cursor error code: ${JSON.stringify(cursorResponse.body)}`);
    }
    const hoveredMoveCount = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootIds[1]}/move`));
    assert.ok(hoveredMoveCount >= 1, 'hover-expand parent drop must complete a real task move.');
    const expectedChildIds = pagination.childIds.concat(rootIds[1]);
    const redactUrl = (url) => String(url || '').replace(/[?&](token|access_token|idToken)=[^&]*/gi, '$1=[redacted]');
    const writeCursorRecoveryArtifact = (freshBranch = null, recoveredUi = null) => {
        if (!context.artifactDir) return;
        fs.writeFileSync(path.join(context.artifactDir, 'phase3-board-hover-cursor-recovery.json'), `${JSON.stringify({
            cursor409Responses: cursor409Responses.map((entry) => ({ ...entry, url: redactUrl(entry.url) })),
            freshBranchPageCount: freshBranch?.pageCount ?? null,
            freshDirectChildIds: freshBranch?.tasks?.map((task) => task.id) || null,
            expectedDirectChildIds: expectedChildIds,
            recoveredUi
        }, null, 2)}\n`, 'utf8');
    };
    writeCursorRecoveryArtifact();
    const parentChildren = await listAllTaskPages(context, ownerToken, projectId, { parentScope: 'direct', parentTaskId: rootIds[0] });
    writeCursorRecoveryArtifact(parentChildren);
    assert.strictEqual(parentChildren.tasks.length, expectedChildIds.length, 'fresh branch pagination must load the original 205 children plus the moved root.');
    assert.deepStrictEqual(parentChildren.tasks.map((task) => task.id), expectedChildIds, 'fresh branch pagination must return the exact canonical direct-child order after the hover drop.');
    await waitForBoardInteractive(page);
    await page.waitForFunction((expectedRows) => {
        const table = document.getElementById('projects-board-table');
        const status = document.getElementById('projects-board-status')?.textContent || '';
        return Number(table?.getAttribute('aria-rowcount') || 0) === expectedRows
            && !/error|failed|stale|conflict/i.test(status);
    }, pagination.total, { timeout: 30000 });
    const recoveredUi = await page.evaluate(() => ({
        logicalRowCount: Number(document.getElementById('projects-board-table')?.getAttribute('aria-rowcount') || 0),
        status: document.getElementById('projects-board-status')?.textContent || '',
        busy: document.getElementById('projects-board-section')?.getAttribute('aria-busy') || '',
        workspaceHidden: Boolean(document.getElementById('projects-board-workspace')?.hidden)
    }));
    assert.strictEqual(recoveredUi.logicalRowCount, pagination.total, 'hover cursor recovery must restore the exact logical board row count.');
    assert.strictEqual(recoveredUi.busy, 'false', 'hover cursor recovery must settle the board before continuing.');
    assert.strictEqual(recoveredUi.workspaceHidden, false, 'hover cursor recovery must keep the board visible.');
    assert.doesNotMatch(recoveredUi.status, /error|failed|stale|conflict/i, 'hover cursor recovery must not leave a visible error status.');
    if (cursor409Responses.length) {
        context.expectedStaleCursorUrls ||= [];
        for (const cursorResponse of cursor409Responses) context.expectedStaleCursorUrls.push(cursorResponse.url);
    }
    writeCursorRecoveryArtifact(parentChildren, recoveredUi);

    await reloadBoard(page, projectId, rootIds[2]);
    const scroll = page.locator('#projects-board-scroll');
    // The recovery disclosure can place the board's lower edge below the
    // browser viewport. Establish reachable pointer geometry before choosing
    // a bottom row; bringing only the source handle into view is insufficient.
    await scroll.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    await scroll.evaluate((element) => { element.scrollTop = 0; });
    const edgeTargetId = await page.evaluate((sourceId) => {
        const scrollElement = document.getElementById('projects-board-scroll');
        if (!scrollElement) return null;
        const bounds = scrollElement.getBoundingClientRect();
        const rows = Array.from(document.querySelectorAll('[data-task-id]')).filter((row) => {
            if (row.dataset.taskId === sourceId) return false;
            const rect = row.getBoundingClientRect();
            return rect.top < bounds.bottom && rect.bottom > bounds.top;
        });
        return rows.at(-1)?.dataset.taskId || null;
    }, rootIds[2]);
    assert.ok(edgeTargetId, 'edge autoscroll requires a visible bottom task row.');
    const edgeSource = page.locator(`[data-task-id="${rootIds[2]}"]`);
    const edgeHandle = edgeSource.locator('[data-action="drag-handle"]');
    const edgeTarget = page.locator(`[data-task-id="${edgeTargetId}"]`);
    const edgeGeometry = [];
    const captureEdgeGeometry = async (stage, pointer = null, error = null) => {
        const dom = await page.evaluate(({ sourceId, targetId, point }) => {
            const scroller = document.getElementById('projects-board-scroll');
            const source = document.querySelector(`[data-task-id="${sourceId}"]`);
            const target = document.querySelector(`[data-task-id="${targetId}"]`);
            const box = (element) => element ? element.getBoundingClientRect().toJSON() : null;
            const describe = (element) => element ? { tag: element.tagName, id: element.id, className: element.className, taskId: element.closest('[data-task-id]')?.dataset.taskId || null } : null;
            return {
                viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
                scroll: { box: box(scroller), top: scroller?.scrollTop, height: scroller?.clientHeight, contentHeight: scroller?.scrollHeight },
                source: { box: box(source), handleBox: box(source?.querySelector('[data-action="drag-handle"]')), draggable: source?.getAttribute('draggable'), pending: source?.classList.contains('is-pending') },
                target: { box: box(target) },
                pointer: point,
                pointerInViewport: point ? point.x >= 0 && point.x < innerWidth && point.y >= 0 && point.y < innerHeight : null,
                hit: point ? describe(document.elementFromPoint(point.x, point.y)) : null,
                hitStack: point ? document.elementsFromPoint(point.x, point.y).slice(0, 6).map(describe) : [],
                recovery: { box: box(document.getElementById('projects-board-recovery')), open: document.querySelector('[data-recovery-disclosure]')?.open },
                busy: document.getElementById('projects-board-section')?.getAttribute('aria-busy'),
                status: document.getElementById('projects-board-status')?.textContent || '',
                dropTargets: Array.from(document.querySelectorAll('.is-drop-target,.is-drop-parent')).map(describe)
            };
        }, { sourceId: rootIds[2], targetId: edgeTargetId, point: pointer });
        edgeGeometry.push({ stage, error, ...dom });
        if (context.artifactDir) fs.writeFileSync(path.join(context.artifactDir, 'phase3-board-edge-autoscroll-geometry.json'), `${JSON.stringify(edgeGeometry, null, 2)}\n`, 'utf8');
        return dom;
    };
    await captureEdgeGeometry('before-source-scroll-into-view');
    await edgeHandle.scrollIntoViewIfNeeded();
    const edgeSourceBox = await edgeHandle.boundingBox();
    const edgeTargetBox = await edgeTarget.boundingBox();
    const scrollBox = await scroll.boundingBox();
    assert.ok(edgeSourceBox && edgeTargetBox && scrollBox, 'edge autoscroll geometry must be measurable.');
    const beforeScroll = await scroll.evaluate((element) => element.scrollTop);
    const beforeEdgeMove = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootIds[2]}/move`));
    const edgePoint = { x: edgeTargetBox.x + edgeTargetBox.width * .2, y: Math.min(edgeTargetBox.y + edgeTargetBox.height - 2, scrollBox.y + scrollBox.height - 4) };
    const edgeReadiness = await captureEdgeGeometry('before-drag', edgePoint);
    assert.strictEqual(edgeReadiness.pointerInViewport, true, 'edge autoscroll pointer must be inside the browser viewport.');
    assert.ok(edgeReadiness.hit?.taskId === edgeTargetId || edgeReadiness.hitStack.some((item) => item.id === 'projects-board-scroll'), 'edge autoscroll pointer must hit its target row or the board scroll surface.');
    await page.mouse.move(edgeSourceBox.x + edgeSourceBox.width / 2, edgeSourceBox.y + edgeSourceBox.height / 2);
    await page.mouse.down();
    try {
        await page.mouse.move(edgePoint.x, edgePoint.y, { steps: 12 });
        await captureEdgeGeometry('after-edge-pointer-move', edgePoint);
        await page.waitForFunction((previous) => Number(document.getElementById('projects-board-scroll')?.scrollTop || 0) > previous, beforeScroll, { timeout: 5000 });
    } catch (error) {
        await captureEdgeGeometry('autoscroll-failed', edgePoint, String(error.message || error));
        await captureScreenshot(context, page, 'phase3-board-edge-autoscroll-failure.png');
        await page.mouse.move(scrollBox.x - 24, scrollBox.y - 24);
        await page.mouse.up();
        throw error;
    }
    await captureEdgeGeometry('autoscroll-observed', edgePoint);
    const afterScroll = await scroll.evaluate((element) => element.scrollTop);
    assert.ok(afterScroll > beforeScroll, `dragging at the bottom edge must auto-scroll the board (${beforeScroll} -> ${afterScroll}).`);
    await page.mouse.move(scrollBox.x - 24, scrollBox.y - 24);
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootIds[2]}/move`)), beforeEdgeMove, 'cancelling an edge-autoscroll drag outside the board must not write.');
    await captureScreenshot(context, page, 'phase3-board-expanded-hover-autoscroll.png');
    return { projectId, hoveredTaskId: rootIds[1], edgeTargetId, beforeScroll, afterScroll };
}

async function holdOneProjectRequest(page, predicate) {
    const deferred = createDeferred('held project request');
    let seen = null;
    const pattern = '**/api/projects/**';
    const handler = async (route) => {
        const request = route.request();
        if (!seen && predicate(request)) {
            seen = request;
            await deferred.promise;
        }
        await route.continue();
    };
    await page.route(pattern, handler);
    return {
        deferred,
        get seen() { return seen; },
        async release() { deferred.resolve(); },
        async dispose() { await page.unroute(pattern, handler); }
    };
}

async function failOneProjectRequest(page, predicate, { status = 409, body = { success: false, error: 'EXPECTED_REVISION_CONFLICT', message: 'forced Phase3 test conflict' } } = {}) {
    const seen = [];
    const pattern = '**/api/projects/**';
    const handler = async (route) => {
        const request = route.request();
        if (!seen.length && predicate(request)) {
            seen.push(request);
            await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
            return;
        }
        await route.continue();
    };
    await page.route(pattern, handler);
    return { seen, async dispose() { await page.unroute(pattern, handler); } };
}

async function abortFirstProjectRequest(page, predicate) {
    const attempts = [];
    const pattern = '**/api/projects/**';
    const handler = async (route) => {
        const request = route.request();
        if (predicate(request)) {
            attempts.push(request);
            if (attempts.length === 1) {
                await route.abort();
                return;
            }
        }
        await route.continue();
    };
    await page.route(pattern, handler);
    return { attempts, async dispose() { await page.unroute(pattern, handler); } };
}

async function dragRow(page, sourceId, targetId, fraction = 0.18) {
    const source = page.locator(`[data-task-id="${sourceId}"]`);
    const target = page.locator(`[data-task-id="${targetId}"]`);
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const currentSource = page.locator(`[data-task-id="${sourceId}"]`);
    const currentTarget = page.locator(`[data-task-id="${targetId}"]`);
    const sourceHandle = currentSource.locator('[data-action="drag-handle"]');
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await currentTarget.boundingBox();
    assert.ok(sourceBox && targetBox, `drag handles/rows must be visible: ${sourceId} -> ${targetId}`);
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width * fraction, targetBox.y + targetBox.height / 2, { steps: 8 });
    await page.mouse.up();
}

async function dragSection(page, sourceId, targetId) {
    const source = page.locator(`[data-section-id="${sourceId}"]`);
    const handle = source.locator('.crm-board-drag-handle');
    const target = page.locator(`[data-section-id="${targetId}"]`);
    await handle.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const sourceBox = await handle.boundingBox();
    const targetBox = await target.boundingBox();
    assert.ok(sourceBox && targetBox, `section drag handles/rows must be visible: ${sourceId} -> ${targetId}`);
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 3, targetBox.y + targetBox.height / 2, { steps: 8 });
    await page.mouse.up();
}

async function dragColumn(page, sourceId, targetId) {
    const source = page.locator(`#projects-board-header [role="columnheader"][data-column-id="${sourceId}"]`);
    const target = page.locator(`#projects-board-header [role="columnheader"][data-column-id="${targetId}"]`);
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    assert.ok(sourceBox && targetBox, `column headers must be visible: ${sourceId} -> ${targetId}`);
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
    await page.mouse.up();
}

async function assertBoardGeometry(page, expectedHeaderCount, label) {
    const headerCells = page.locator('#projects-board-header [role="columnheader"]');
    const taskRow = page.locator('[data-task-id]').first();
    const rowCells = taskRow.locator('[role="cell"]');
    assert.strictEqual(await headerCells.count(), expectedHeaderCount, `${label} board must render ${expectedHeaderCount} headers.`);
    assert.strictEqual(await rowCells.count(), expectedHeaderCount, `${label} row must render one cell per header.`);
    for (let index = 0; index < expectedHeaderCount; index += 1) {
        const headerBox = await headerCells.nth(index).boundingBox();
        const cellBox = await rowCells.nth(index).boundingBox();
        assert.ok(headerBox && cellBox && Math.abs(headerBox.x - cellBox.x) <= 2, `${label} header/cell x alignment failed at column ${index}.`);
        assert.ok(headerBox.width > 12 && cellBox.width > 12, `${label} column ${index} must have a usable width.`);
    }
}

async function runLayoutAndReorderCase(context) {
    const ownerToken = contextValue(context, 'ownerToken');
    const page = contextValue(context, 'page');
    const projectId = uniqueId(context, 'layout-project');
    await createProject(context, ownerToken, { projectId, name: 'Phase3 layout and reorder' });
    let project = await readProject(context, projectId, ownerToken);
    const sectionA = uniqueId(context, 'layout-section-a');
    const sectionB = uniqueId(context, 'layout-section-b');
    let structureRevision = (await createSection(context, ownerToken, projectId, sectionA, 'Layout A', project.structureRevision, 0)).structureRevision;
    structureRevision = (await createSection(context, ownerToken, projectId, sectionB, 'Layout B', structureRevision, 1)).structureRevision;
    const taskA = uniqueId(context, 'layout-task-a');
    structureRevision = (await createTask(context, ownerToken, projectId, taskA, { title: 'Layout task A', sectionId: sectionA, expectedStructureRevision: structureRevision })).structureRevision;
    const taskB = uniqueId(context, 'layout-task-b');
    await createTask(context, ownerToken, projectId, taskB, { title: 'Layout task B', sectionId: sectionB, expectedStructureRevision: structureRevision });
    await reloadBoard(page, projectId, taskA);
    await assertBoardGeometry(page, 5, 'zero-custom-column');
    await captureScreenshot(context, page, 'phase3-board-expanded-zero-columns.png');

    project = await readProject(context, projectId, ownerToken);
    let schemaRevision = project.schemaRevision;
    const columnA = uniqueId(context, 'layout-column-a');
    let created = await createColumn(context, ownerToken, projectId, columnA, { type: 'text', label: 'Layout A' }, schemaRevision, 0);
    schemaRevision = created.schemaRevision;
    const columnB = uniqueId(context, 'layout-column-b');
    created = await createColumn(context, ownerToken, projectId, columnB, { type: 'number', label: 'Layout B' }, schemaRevision, 1);
    schemaRevision = created.schemaRevision;
    await reloadBoard(page, projectId, taskA);
    await assertBoardGeometry(page, 7, 'two-custom-column');

    const columnBefore = projectMutationCount(context, (entry) => entry.url.endsWith(`/columns/${columnB}/move`));
    const columnMove = waitForProjectResponse(page, `/api/projects/${projectId}/columns/${columnB}/move`, 'POST');
    await dragColumn(page, columnB, columnA);
    await columnMove;
    await waitForBoardInteractive(page);
    assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith(`/columns/${columnB}/move`)), columnBefore + 1, 'one column drop must issue one move operation.');
    const afterColumnMove = await listTasks(context, ownerToken, projectId);
    const columnOrder = afterColumnMove.columns.map((column) => column.id);
    assert.deepStrictEqual(columnOrder, [columnB, columnA], 'column drag must persist exact relative order.');
    assert.strictEqual(await page.locator('#projects-board-header [role="columnheader"][data-column-id]').nth(0).getAttribute('data-column-id'), columnB, 'column order must be rendered after reload.');

    const sectionBefore = projectMutationCount(context, (entry) => entry.url.endsWith(`/sections/${sectionB}/move`));
    const sectionMove = waitForProjectResponse(page, `/api/projects/${projectId}/sections/${sectionB}/move`, 'POST');
    await dragSection(page, sectionB, sectionA);
    await sectionMove;
    await waitForBoardInteractive(page);
    assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith(`/sections/${sectionB}/move`)), sectionBefore + 1, 'one section drop must issue one move operation.');
    const afterSectionMove = await listTasks(context, ownerToken, projectId);
    assert.deepStrictEqual(afterSectionMove.sections.map((section) => section.id), [sectionB, sectionA], 'section drag must persist exact relative order.');
    await reloadBoard(page, projectId, taskA);
    assert.deepStrictEqual((await listTasks(context, ownerToken, projectId)).sections.map((section) => section.id), [sectionB, sectionA], 'section order must survive a direct board reload.');
    await captureScreenshot(context, page, 'phase3-board-expanded-reorder.png');
    return { projectId, sectionA, sectionB, taskA, taskB, columns: [columnB, columnA] };
}


function throwSettledFailures(label, entries) {
    const failures = entries.filter((entry) => entry.result.status === 'rejected');
    if (!failures.length) return;
    if (failures.length === 1) throw failures[0].result.reason;
    const causes = failures.map((entry) => entry.result.reason);
    const detail = failures.map((entry) => entry.name + ': ' + (entry.result.reason?.stack || entry.result.reason)).join('\n');
    const aggregate = new AggregateError(causes, label + ' failed\n' + detail);
    aggregate.causes = failures.map((entry) => ({ name: entry.name, error: entry.result.reason }));
    throw aggregate;
}

async function settleConflictReview(page, review, projectId, taskId, accept) {
    const taskPath = '/api/projects/' + projectId + '/tasks/' + taskId;
    const reviewGet = page.waitForResponse((response) => response.url().endsWith(taskPath)
        && response.request().method() === 'GET', { timeout: 30000 });
    const acceptPatch = accept
        ? page.waitForResponse((response) => response.url().endsWith(taskPath)
            && response.request().method() === 'PATCH' && response.status() === 200, { timeout: 30000 })
        : Promise.resolve(null);
    const dialogWait = page.waitForEvent('dialog', { timeout: 30000 }).then(async (dialog) => {
        const info = { type: dialog.type(), message: dialog.message() };
        try {
            assert.strictEqual(info.type, 'confirm', 'Review must request explicit confirmation.');
            assert.match(info.message, /Editable after held refresh/, 'Review must show the saved value before the decision.');
        } catch (error) {
            await dialog.dismiss();
            throw error;
        }
        if (accept) await dialog.accept();
        else await dialog.dismiss();
        return info;
    });
    const settled = await Promise.allSettled([
        reviewGet,
        acceptPatch,
        dialogWait,
        Promise.resolve().then(() => review.click({ timeout: 30000 }))
    ]);
    throwSettledFailures('Review ' + (accept ? 'accept' : 'decline') + ' ' + taskPath, [
        { name: 'saved-value GET', result: settled[0] },
        { name: 'retained-draft PATCH', result: settled[1] },
        { name: 'confirmation dialog', result: settled[2] },
        { name: 'Review click', result: settled[3] }
    ]);
    return { response: settled[0].value, patch: settled[1].value, dialog: settled[2].value };
}

async function runDeferredRemoteAndFailureCase(context, typed, pagination) {
    const ownerToken = contextValue(context, 'ownerToken');
    const page = contextValue(context, 'page');
    const projectA = uniqueId(context, 'fence-a');
    const projectB = uniqueId(context, 'fence-b');
    const taskId = uniqueId(context, 'same-task');
    const projectIds = [projectA, projectB];
    for (const projectId of projectIds) {
        await createProject(context, ownerToken, { projectId, name: `Fence ${projectId}` });
        const project = await readProject(context, projectId, ownerToken);
        const sectionId = uniqueId(context, `${projectId}-section`);
        const section = await createSection(context, ownerToken, projectId, sectionId, 'Fence', project.structureRevision);
        await createTask(context, ownerToken, projectId, taskId, { title: `Original ${projectId}`, sectionId, expectedStructureRevision: section.structureRevision });
    }
    await reloadBoard(page, projectA, taskId);
    const held = await holdOneProjectRequest(page, (request) => request.method() === 'PATCH' && request.url().endsWith(`/tasks/${taskId}`) && request.url().includes(`/projects/${projectA}/`));
    const title = page.locator(`[data-task-id="${taskId}"] input[data-field-kind="title"]`);
    await title.fill('Project A dirty title');
    await title.blur();
    for (let attempt = 0; attempt < 20 && !held.seen; attempt += 1) await page.waitForTimeout(50);
    assert.ok(held.seen, 'the real A PATCH must be held before switching projects.');
    await selectBoardProject(page, projectB, taskId);
    await held.release();
    await page.waitForTimeout(250);
    await held.dispose();
    assert.strictEqual(await page.locator(`[data-task-id="${taskId}"] input[data-field-kind="title"]`).inputValue(), `Original ${projectB}`, 'settled old-project response must not alter the new project DOM before reload.');
    await reloadBoard(page, projectB, taskId);
    assert.strictEqual(await page.locator(`[data-task-id="${taskId}"] input[data-field-kind="title"]`).inputValue(), `Original ${projectB}`, 'late A response must not roll back or overwrite same-ID task in B.');
    const aTasks = await listTasks(context, ownerToken, projectA);
    const bTasks = await listTasks(context, ownerToken, projectB);
    assert.strictEqual(aTasks.tasks.find((entry) => entry.id === taskId).title, 'Project A dirty title', 'A response must still persist in A.');
    assert.strictEqual(bTasks.tasks.find((entry) => entry.id === taskId).title, `Original ${projectB}`, 'B persisted data must remain isolated.');

    // A queued A refresh must not clear B after a project switch. Hold the
    // real A metadata request, switch through the picker, then release the
    // old request only after B is visibly settled.
    await reloadBoard(page, projectA, taskId);
    const heldRefreshA = await holdOneProjectRequest(page, (request) => request.method() === 'GET'
        && request.url().endsWith(`/api/projects/${projectA}`));
    try {
        await page.locator('#btn-projects-board-refresh').click();
        for (let attempt = 0; attempt < 20 && !heldRefreshA.seen; attempt += 1) await page.waitForTimeout(50);
        assert.ok(heldRefreshA.seen, 'the real A refresh GET must be held before switching projects.');
        try {
            await selectBoardProject(page, projectB, taskId);
        } catch (error) {
            context.heldRefreshRequestSeen = heldRefreshA.seen;
            await captureBoardSelectionFailure(context, page, 'queued-refresh-a', error);
            throw error;
        }
        assert.strictEqual(await page.locator(`[data-task-id="${taskId}"] input[data-field-kind="title"]`).inputValue(), `Original ${projectB}`, 'B must settle while the old A refresh is held.');
        await heldRefreshA.release();
        await page.waitForTimeout(250);
        assert.strictEqual(await page.locator(`[data-task-id="${taskId}"] input[data-field-kind="title"]`).inputValue(), `Original ${projectB}`, 'late A refresh completion must not clear or overwrite B.');
    } finally {
        await heldRefreshA.release();
        await heldRefreshA.dispose();
    }

    if (typed?.projectId && typed?.taskId) {
        await reloadBoard(page, typed.projectId, typed.taskId);
        const dirty = page.locator(`[data-task-id="${typed.taskId}"] input[data-field-kind="title"]`);
        const initialScrollTop = await page.locator('#projects-board-scroll').evaluate((element) => element.scrollTop);
        await dirty.fill('Local dirty draft');
        await dirty.focus();
        await dirty.evaluate((element) => { element.setSelectionRange(5, 5); window.__phase3DirtyTitle = element; });
        assert.deepEqual(await dirty.evaluate(element => ({ active: document.activeElement === element, value: element.value, caret: element.selectionStart })), { active: true, value: 'Local dirty draft', caret: 5 });
        const before = await listTasks(context, ownerToken, typed.projectId);
        const task = before.tasks.find((entry) => entry.id === typed.taskId);
        const remote = await api(context, `/api/projects/${typed.projectId}/tasks/${typed.taskId}`, ownerToken, {
            method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: uniqueId(context, 'remote-title'), expectedRevision: task.revision, title: 'Remote title' })
        });
        requireOk(remote, 'remote title update');
        const refreshResponse = page.waitForResponse((response) => response.url().includes(`/api/projects/${typed.projectId}/tasks?`)
            && response.request().method() === 'GET', { timeout: 30000 });
        await page.locator('#btn-projects-board-refresh').dispatchEvent('click');
        await (await refreshResponse).finished();
        await waitForBoardInteractive(page);
        const draftView = await page.evaluate(() => {
            const active = document.activeElement;
            const scroll = document.getElementById('projects-board-scroll');
            return {
                value: active?.value,
                activeTaskId: active?.closest?.('[data-task-id]')?.dataset?.taskId || '',
                selectionStart: active?.selectionStart ?? null,
                sameInput: active === window.__phase3DirtyTitle,
                busy: document.getElementById('projects-board-section')?.getAttribute('aria-busy'),
                status: document.getElementById('projects-board-status')?.textContent,
                scrollTop: scroll?.scrollTop ?? null
            };
        });
        assert.strictEqual(draftView.value, 'Local dirty draft', `remote refresh must retain dirty input: ${JSON.stringify(draftView)}`);
        assert.strictEqual(draftView.activeTaskId, typed.taskId, 'remote refresh must preserve editing focus on the same task.');
        assert.strictEqual(draftView.selectionStart, 5, 'remote refresh must preserve the dirty caret position.');
        assert.strictEqual(draftView.sameInput, true, 'remote refresh must retain the same native input node.');
        assert.strictEqual(draftView.scrollTop, initialScrollTop, 'remote refresh must preserve the current vertical scroll position.');
        if (context.artifactDir) fs.writeFileSync(path.join(context.artifactDir, 'phase3-board-focus-continuity.json'), `${JSON.stringify(draftView, null, 2)}\n`, 'utf8');

        // A real scroll event must keep the dirty editor mounted and must not
        // turn the draft into an unsolicited PATCH while rows are rerendered.
        const scrollProjectId = pagination?.projectId;
        const scrollTaskId = pagination?.rootIds?.[100];
        assert.ok(scrollProjectId && scrollTaskId, 'scroll continuity requires the real large-board fixture.');
        await reloadBoard(page, scrollProjectId);
        const scrollIndex = 1 + pagination.rootIds.indexOf(scrollTaskId);
        await page.locator('#projects-board-scroll').evaluate((element, index) => {
            element.scrollTop = index * 46;
            element.dispatchEvent(new Event('scroll'));
        }, scrollIndex);
        await page.waitForSelector(`[data-task-id="${scrollTaskId}"]`, { timeout: 30000 });
        const scrollDraft = page.locator(`[data-task-id="${scrollTaskId}"] input[data-field-kind="title"]`);
        await scrollDraft.fill('Scroll dirty draft');
        await scrollDraft.focus();
        await scrollDraft.evaluate((element) => element.setSelectionRange(6, 6));
        const scrollBefore = await page.locator('#projects-board-scroll').evaluate((element) => element.scrollTop);
        const scrollPatchesBefore = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${scrollTaskId}`) && entry.url.includes(`/projects/${scrollProjectId}/`) && entry.method === 'PATCH');
        const requestedScroll = scrollBefore + 46;
        const expectedScroll = await page.locator('#projects-board-scroll').evaluate((element, nextTop) => {
            element.scrollTop = nextTop;
            // Chrome quantizes fractional offsets on assignment. Preserve the
            // exact accepted position across the render, with no tolerance.
            const acceptedTop = element.scrollTop;
            element.dispatchEvent(new Event('scroll'));
            return acceptedTop;
        }, requestedScroll);
        assert.ok(expectedScroll > scrollBefore, 'the scroll assignment must move the viewport before its render event.');
        const scrollDraftView = await page.evaluate(() => {
            const active = document.activeElement;
            const scroll = document.getElementById('projects-board-scroll');
            return {
                value: active?.value,
                activeTaskId: active?.closest?.('[data-task-id]')?.dataset?.taskId || '',
                selectionStart: active?.selectionStart ?? null,
                scrollTop: scroll?.scrollTop ?? null
            };
        });
        const scrollPatchesAfter = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${scrollTaskId}`) && entry.url.includes(`/projects/${scrollProjectId}/`) && entry.method === 'PATCH');
        assert.strictEqual(scrollDraftView.value, 'Scroll dirty draft', `scroll must retain the dirty input: ${JSON.stringify(scrollDraftView)}`);
        assert.strictEqual(scrollDraftView.activeTaskId, scrollTaskId, 'scroll must preserve editing focus on the same task.');
        assert.strictEqual(scrollDraftView.selectionStart, 6, 'scroll must preserve the dirty caret position.');
        assert.strictEqual(scrollDraftView.scrollTop, expectedScroll, 'scroll must preserve the requested vertical scroll position.');
        assert.strictEqual(scrollPatchesAfter, scrollPatchesBefore, 'scroll rerender must not commit a dirty draft implicitly.');

        await reloadBoard(page, typed.projectId, typed.taskId);
        const heldSameProject = await holdOneProjectRequest(page, (request) => request.method() === 'PATCH'
            && request.url().endsWith(`/tasks/${typed.taskId}`) && request.url().includes(`/projects/${typed.projectId}/`));
        const heldTitle = page.locator(`[data-task-id="${typed.taskId}"] input[data-field-kind="title"]`);
        await heldTitle.fill('Held save before refresh');
        await heldTitle.blur();
        for (let attempt = 0; attempt < 20 && !heldSameProject.seen; attempt += 1) await page.waitForTimeout(50);
        assert.ok(heldSameProject.seen, 'same-project held PATCH must be observed before refresh.');
        const heldPatchResponse = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${typed.projectId}/tasks/${typed.taskId}`)
            && response.request().method() === 'PATCH' && response.status() === 200, { timeout: 30000 });
        const heldRefreshResponse = page.waitForResponse((response) => response.url().includes(`/api/projects/${typed.projectId}/tasks?`)
            && response.request().method() === 'GET', { timeout: 30000 });
        await page.locator('#btn-projects-board-refresh').click();
        await page.waitForTimeout(150);
        assert.strictEqual(await page.locator(`[data-task-id="${typed.taskId}"] input[data-field-kind="title"]`).inputValue(), 'Held save before refresh', 'same-project refresh must retain the dirty/pending title while the PATCH is held.');
        await heldSameProject.release();
        await heldPatchResponse;
        await heldRefreshResponse;
        await waitForBoardInteractive(page);
        await heldSameProject.dispose();
        const followUpTitle = page.locator(`[data-task-id="${typed.taskId}"] input[data-field-kind="title"]`);
        const followUpResponse = waitForProjectResponse(page, `/api/projects/${typed.projectId}/tasks/${typed.taskId}`, 'PATCH');
        await followUpTitle.fill('Editable after held refresh');
        await followUpTitle.blur();
        assert.strictEqual((await followUpResponse).status(), 200, 'a same-project task must remain editable after a held save and refresh.');
        const afterHeld = await listTasks(context, ownerToken, typed.projectId);
        assert.strictEqual(afterHeld.tasks.find((entry) => entry.id === typed.taskId).title, 'Editable after held refresh', 'follow-up edit must persist after held refresh.');

        const failedBefore = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${typed.taskId}`) && entry.method === 'PATCH');
        const failure = await failOneProjectRequest(page, (request) => request.method() === 'PATCH'
            && request.url().endsWith(`/tasks/${typed.taskId}`) && request.url().includes(`/projects/${typed.projectId}/`));

        const failedResponse = page.waitForResponse((response) => response.url().endsWith('/api/projects/' + typed.projectId + '/tasks/' + typed.taskId)
            && response.request().method() === 'PATCH' && response.status() === 409, { timeout: 30000 });
        const failedTitle = page.locator('[data-task-id="' + typed.taskId + '"] input[data-field-kind="title"]');
        const failedSettled = await Promise.allSettled([
            failedResponse,
            Promise.resolve().then(async () => {
                await failedTitle.fill('Known conflict title', { timeout: 30000 });
                await failedTitle.blur({ timeout: 30000 });
            })
        ]);
        await failure.dispose();
        throwSettledFailures('Known conflict save', [
            { name: '409 response', result: failedSettled[0] },
            { name: 'title fill and blur', result: failedSettled[1] }
        ]);
        const failedResponseResult = failedSettled[0].value;
        const failedBody = await failedResponseResult.json();
        const failedOperation = failure.seen[0]?.postDataJSON?.();
        assert.strictEqual(failedResponseResult.status(), 409, 'known failure must return HTTP 409.');
        assert.strictEqual(failedBody.success, false, 'known failure must return an unsuccessful response body.');
        assert.strictEqual(failedBody.error, 'EXPECTED_REVISION_CONFLICT', 'known failure must preserve the conflict error class.');
        assert.match(String(failedBody.message || ''), /forced Phase3 test conflict/, 'known failure must preserve the conflict message.');
        assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith('/tasks/' + typed.taskId) && entry.method === 'PATCH'), failedBefore + 1, 'known failure must issue exactly one PATCH.');
        assert.ok(failedOperation?.operationId, 'known failure must preserve the operation ID for retry/diagnosis.');
        const persistedAfterFailure = await listTasks(context, ownerToken, typed.projectId);
        assert.strictEqual(persistedAfterFailure.tasks.find((entry) => entry.id === typed.taskId)?.title, 'Editable after held refresh', 'known failure must leave the API record at the last authoritative title.');
        await assertBoardDetailTitle(page, typed.taskId, 'Editable after held refresh');
        assert.strictEqual(await failedTitle.inputValue(), 'Known conflict title', 'known failure must retain the local draft for review.');
        const review = page.locator('[data-remote-conflict-review="' + typed.taskId + '"]');
        await review.waitFor({ state: 'visible', timeout: 30000 });
        await page.locator('#projects-board-status.crm-projects-board-error-text').waitFor({ state: 'visible', timeout: 30000 });
        assert.match(await page.locator('#projects-board-status').textContent(), /forced Phase3 test conflict/, 'known failure must visibly explain the rejected save.');
        assert.strictEqual(await review.isEnabled(), true, 'known failure must expose an enabled Review and retry action.');

        const beforeReviewPatches = projectMutationCount(context, (entry) => entry.url.endsWith('/tasks/' + typed.taskId) && entry.method === 'PATCH');
        const declined = await settleConflictReview(page, review, typed.projectId, typed.taskId, false);
        assert.strictEqual(declined.response.status(), 200, 'Review must read the current saved task before asking for confirmation.');
        assert.strictEqual(declined.dialog?.type, 'confirm', 'Review must use an explicit confirmation dialog.');
        assert.match(declined.dialog?.message || '', /Editable after held refresh/, 'Review must show the saved canonical value.');
        assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith('/tasks/' + typed.taskId) && entry.method === 'PATCH'), beforeReviewPatches, 'declining Review must issue no additional PATCH.');
        const persistedAfterDecline = await listTasks(context, ownerToken, typed.projectId);
        assert.strictEqual(persistedAfterDecline.tasks.find((entry) => entry.id === typed.taskId)?.title, 'Editable after held refresh', 'declining Review must leave the API record unchanged.');
        await assertBoardDetailTitle(page, typed.taskId, 'Editable after held refresh');
        assert.strictEqual(await failedTitle.inputValue(), 'Known conflict title', 'declining Review must retain the local draft.');
        await review.waitFor({ state: 'visible', timeout: 30000 });
        assert.strictEqual(await review.isEnabled(), true, 'declining Review must restore the enabled retry action.');

        const accepted = await settleConflictReview(page, review, typed.projectId, typed.taskId, true);
        assert.strictEqual(accepted.response.status(), 200, 'accepted Review must read the current saved task.');
        assert.strictEqual(accepted.patch?.status(), 200, 'accepted Review must persist the retained draft.');
        assert.strictEqual(accepted.dialog?.type, 'confirm', 'accepted Review must use the same explicit confirmation dialog.');
        assert.match(accepted.dialog?.message || '', /Editable after held refresh/, 'accepted Review must show the saved canonical value.');
        const persistedAfterAccept = await listTasks(context, ownerToken, typed.projectId);
        assert.strictEqual(persistedAfterAccept.tasks.find((entry) => entry.id === typed.taskId)?.title, 'Known conflict title', 'accepted Review must persist the retained draft before uncertain retry coverage.');
        await assertBoardDetailTitle(page, typed.taskId, 'Known conflict title');
        assert.strictEqual(await failedTitle.inputValue(), 'Known conflict title', 'accepted Review must leave the retained title in the editor.');
        assert.strictEqual(await page.locator('[data-remote-conflict-review="' + typed.taskId + '"]').count(), 0, 'accepted Review must clear the conflict action before uncertain retry coverage.');

        const retry = await abortFirstProjectRequest(page, (request) => request.method() === 'PATCH'
            && request.url().endsWith(`/tasks/${typed.taskId}`) && request.url().includes(`/projects/${typed.projectId}/`));
        const retryResponse = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${typed.projectId}/tasks/${typed.taskId}`)
            && response.request().method() === 'PATCH' && response.status() === 200, { timeout: 30000 });
        const retryTitle = page.locator(`[data-task-id="${typed.taskId}"] input[data-field-kind="title"]`);
        await retryTitle.fill('Uncertain retry title');
        await retryTitle.blur();
        await retryResponse;
        await page.waitForTimeout(200);
        await retry.dispose();
        assert.strictEqual(retry.attempts.length, 2, 'an uncertain save must retry once.');
        assert.strictEqual(retry.attempts[0].postDataJSON().operationId, retry.attempts[1].postDataJSON().operationId, 'uncertain retry must reuse the operation ID.');

        const rapidBefore = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${typed.taskId}`) && entry.method === 'PATCH');
        const rapidTitle = page.locator(`[data-task-id="${typed.taskId}"] input[data-field-kind="title"]`);
        await rapidTitle.fill('Rapid first');
        await rapidTitle.blur();
        await rapidTitle.fill('Rapid latest');
        await rapidTitle.blur();
        await page.waitForTimeout(500);
        const rapidAfter = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${typed.taskId}`) && entry.method === 'PATCH');
        assert.ok(rapidAfter >= rapidBefore + 1 && rapidAfter <= rapidBefore + 2, `rapid same-task edits must serialize without duplicate blur commits (${rapidBefore} -> ${rapidAfter}).`);
        const afterRapid = await listTasks(context, ownerToken, typed.projectId);
        assert.strictEqual(afterRapid.tasks.find((entry) => entry.id === typed.taskId).title, 'Rapid latest', 'latest queued same-task edit must win.');
    }
    return { projectA, projectB, taskId };
}

async function runPointerKeyboardAndNoopCase(context) {
    const ownerToken = contextValue(context, 'ownerToken');
    const page = contextValue(context, 'page');
    const projectId = uniqueId(context, 'moves-project');
    await createProject(context, ownerToken, { projectId, name: 'Phase3 moves' });
    const project = await readProject(context, projectId, ownerToken);
    const sectionA = uniqueId(context, 'moves-section-a');
    const sectionB = uniqueId(context, 'moves-section-b');
    let structureRevision = (await createSection(context, ownerToken, projectId, sectionA, 'First', project.structureRevision)).structureRevision;
    structureRevision = (await createSection(context, ownerToken, projectId, sectionB, 'Second', structureRevision)).structureRevision;
    const rootA = uniqueId(context, 'moves-root-a');
    const rootB = uniqueId(context, 'moves-root-b');
    const rootC = uniqueId(context, 'moves-root-c');
    let result = await createTask(context, ownerToken, projectId, rootA, { title: 'Move A', sectionId: sectionA, expectedStructureRevision: structureRevision });
    structureRevision = result.structureRevision;
    result = await createTask(context, ownerToken, projectId, rootB, { title: 'Move B', sectionId: sectionA, expectedStructureRevision: structureRevision });
    structureRevision = result.structureRevision;
    result = await createTask(context, ownerToken, projectId, rootC, { title: 'Move C', sectionId: sectionB, expectedStructureRevision: structureRevision });
    structureRevision = result.structureRevision;
    const deep = uniqueId(context, 'moves-deep');
    await createTask(context, ownerToken, projectId, deep, { title: 'Retained descendant', sectionId: sectionA, parentTaskId: rootB, expectedStructureRevision: structureRevision });
    const canonicalBeforeKeyboard = await listTasks(context, ownerToken, projectId, { parentScope: 'root' });
    const canonicalRootOrder = canonicalBeforeKeyboard.tasks.map((task) => ({
        id: task.id,
        sectionId: task.effectiveSectionId || task.sectionId || null,
        parentTaskId: task.parentTaskId || null,
        rank: task.rank ?? null
    }));
    assert.ok(canonicalRootOrder.some((task) => task.id === rootA && task.sectionId === sectionA && !task.parentTaskId), 'root A must start as a section A root.');
    assert.ok(canonicalRootOrder.some((task) => task.id === rootB && task.sectionId === sectionA && !task.parentTaskId), 'root B must start as a section A root.');
    assert.ok(canonicalRootOrder.some((task) => task.id === rootC && task.sectionId === sectionB && !task.parentTaskId), 'root C must start as a section B root.');
    await reloadBoard(page, projectId, rootA);
    // Clicking the row opens its detail dialog. Keyboard moves start on the
    // focusable board row, as the indent/outdent/down cases below do too.
    await page.locator(`[data-task-id="${rootB}"]`).focus();
    assert.strictEqual(await page.locator('dialog[open]').count(), 0, 'keyboard move setup must leave the board unobstructed.');
    const beforeKeyboardUp = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootB}/move`));
    const keyboardUp = waitForProjectResponse(page, `/api/projects/${projectId}/tasks/${rootB}/move`, 'POST');
    await page.locator(`[data-task-id="${rootB}"]`).press('ArrowUp');
    await keyboardUp;
    await waitForBoardInteractive(page);
    assert.strictEqual(await page.locator('dialog[open]').count(), 0, 'keyboard reorder must not auto-open task details.');
    assert.strictEqual(await page.evaluate(() => document.activeElement?.dataset?.taskId), rootB, 'ArrowUp must retain native row focus after reconciliation.');
    assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootB}/move`)), beforeKeyboardUp + 1, 'keyboard sibling move must issue one operation.');
    const afterKeyboardUp = await listTasks(context, ownerToken, projectId, { parentScope: 'root' });
    const sectionARootIdsAfterUp = afterKeyboardUp.tasks
        .filter((task) => (task.effectiveSectionId || task.sectionId) === sectionA && !task.parentTaskId)
        .map((task) => task.id);
    const sectionBRootIdsAfterUp = afterKeyboardUp.tasks
        .filter((task) => (task.effectiveSectionId || task.sectionId) === sectionB && !task.parentTaskId)
        .map((task) => task.id);
    assert.deepStrictEqual(sectionARootIdsAfterUp, [rootB, rootA], 'ArrowUp must reorder only the section A siblings to [rootB, rootA].');
    assert.deepStrictEqual(sectionBRootIdsAfterUp, [rootC], 'ArrowUp must leave the section B root order unchanged.');
    // ArrowUp leaves rootB before rootA. Indent/outdent rootA so each
    // keyboard operation has a real adjacent sibling and cannot silently
    // become a boundary no-op after the first reorder.
    const rootARow = page.locator(`[data-task-id="${rootA}"]`);
    const beforeKeyboardIndent = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootA}/move`));
    const keyboardIndent = waitForProjectResponse(page, `/api/projects/${projectId}/tasks/${rootA}/move`, 'POST');
    await rootARow.focus();
    await rootARow.press('Alt+ArrowRight');
    try {
        await keyboardIndent;
    } catch (error) {
        const diagnostic = await page.evaluate(({ rootAId, rootBId }) => ({
            rows: Array.from(document.querySelectorAll('[data-task-id]')).map((row) => ({
                id: row.dataset.taskId,
                rowId: row.dataset.rowId,
                ariaSelected: row.getAttribute('aria-selected'),
                visible: Boolean(row.getBoundingClientRect().width && row.getBoundingClientRect().height),
                top: row.getBoundingClientRect().top,
                bottom: row.getBoundingClientRect().bottom
            })),
            activeElement: {
                tag: document.activeElement?.tagName || null,
                taskId: document.activeElement?.closest?.('[data-task-id]')?.dataset?.taskId || null,
                rowId: document.activeElement?.closest?.('[data-row-id]')?.dataset?.rowId || null,
                role: document.activeElement?.getAttribute?.('role') || null,
                text: document.activeElement?.textContent?.slice(0, 120) || ''
            },
            rootAId,
            rootBId,
            status: document.getElementById('projects-board-status')?.textContent || '',
            busy: document.getElementById('projects-board-section')?.getAttribute('aria-busy') || '',
            pickerValue: document.getElementById('projects-board-project-select')?.value || ''
        }), { rootAId: rootA, rootBId: rootB });
        const redactUrl = (url) => String(url || '').replace(/[?&](token|access_token|idToken)=[^&]*/gi, '$1=[redacted]');
        const artifact = {
            error: String(error?.message || error),
            beforeKeyboardIndent,
            canonicalBeforeKeyboard: canonicalRootOrder,
            diagnostic,
            requests: (context.requestLog || []).slice(-30).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), status: entry.status ?? null })),
            responses: (context.responseLog || []).slice(-30).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), status: entry.status ?? null })),
            requestFailed: (context.requestFailed || []).slice(-20).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), failure: entry.failure || null })),
            consoleErrors: (context.consoleErrors || []).slice(-20)
        };
        if (context.artifactDir) {
            fs.writeFileSync(path.join(context.artifactDir, 'phase3-board-keyboard-indent-failure.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
            await captureScreenshot(context, page, 'phase3-board-keyboard-indent-failure.png');
        }
        throw error;
    }
    await waitForBoardInteractive(page);
    assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootA}/move`)), beforeKeyboardIndent + 1, 'keyboard indent must issue one operation.');
    const afterKeyboardIndent = await listTasks(context, ownerToken, projectId, { parentScope: 'direct', parentTaskId: rootB });
    assert.strictEqual(afterKeyboardIndent.tasks.filter((task) => task.id === rootA).length, 1, 'keyboard indent must persist rootA as a direct child of rootB.');
    // The indent makes rootA a child of rootB. The board must retain the
    // moved row's selection and focus so the next keyboard action remains a
    // direct user continuation; expanding the parent in the test would hide
    // a regression in that behavior.
    await page.waitForSelector(`[data-task-id="${rootA}"]`, { timeout: 30000 });
    assert.ok(await page.locator(`[data-task-id="${rootA}"]`).isVisible(), 'keyboard indent must keep the moved child visible.');
    const focusedAfterIndent = await page.evaluate((expectedId) => ({
        activeRowId: document.activeElement?.closest?.('[data-task-id]')?.dataset?.taskId || null,
        selected: document.querySelector(`[data-task-id="${expectedId}"]`)?.getAttribute('aria-selected') || null
    }), rootA);
    assert.strictEqual(focusedAfterIndent.activeRowId, rootA, 'keyboard indent must retain focus on the moved child row.');
    assert.strictEqual(focusedAfterIndent.selected, 'true', 'keyboard indent must retain selection on the moved child row.');
    assert.strictEqual(await page.locator('dialog[open]').count(), 0, 'keyboard indent must leave the board unobstructed.');
    await captureKeyboardMoveState(context, page, ownerToken, projectId, rootA, rootB, 'phase3-board-keyboard-after-indent.json');
    const beforeKeyboardOutdent = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootA}/move`));
    const keyboardOutdent = waitForProjectResponse(page, `/api/projects/${projectId}/tasks/${rootA}/move`, 'POST');
    await page.keyboard.press('Alt+ArrowLeft');
    await keyboardOutdent;
    await waitForBoardInteractive(page);
    assert.strictEqual(await page.locator('dialog[open]').count(), 0, 'keyboard outdent must not auto-open task details.');
    assert.strictEqual(await page.evaluate(() => document.activeElement?.dataset?.taskId), rootA, 'keyboard outdent must retain native row focus.');
    assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootA}/move`)), beforeKeyboardOutdent + 1, 'keyboard outdent must issue one operation.');
    if (await page.locator(`[data-task-id="${deep}"]`).count() === 0) {
        await page.locator(`[data-task-id="${rootB}"] .crm-board-expander`).click();
        await page.waitForSelector(`[data-task-id="${deep}"]`, { timeout: 30000 });
    }
    const beforeSamePosition = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootB}/move`));
    const samePositionOrderBefore = (await listTasks(context, ownerToken, projectId, { parentScope: 'root' })).tasks
        .filter((task) => (task.effectiveSectionId || task.sectionId) === sectionA && !task.parentTaskId)
        .map((task) => task.id);
    await dragRow(page, rootB, rootA, 0.18);
    await page.waitForTimeout(100);
    const afterSamePosition = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootB}/move`));
    if (afterSamePosition !== beforeSamePosition && context.artifactDir) {
        const samePositionOrderAfter = (await listTasks(context, ownerToken, projectId, { parentScope: 'root' })).tasks
            .filter((task) => (task.effectiveSectionId || task.sectionId) === sectionA && !task.parentTaskId)
            .map((task) => task.id);
        const redactUrl = (url) => String(url || '').replace(/[?&](token|access_token|idToken)=[^&]*/gi, '$1=[redacted]');
        fs.writeFileSync(path.join(context.artifactDir, 'phase3-board-pointer-same-position-noop-failure.json'), `${JSON.stringify({
            beforeSamePosition,
            afterSamePosition,
            samePositionOrderBefore,
            samePositionOrderAfter,
            moveRequests: (context.requestLog || []).filter((entry) => entry.url.endsWith(`/tasks/${rootB}/move`)).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), body: entry.body || null })),
            moveResponses: (context.responseLog || []).filter((entry) => entry.url.endsWith(`/tasks/${rootB}/move`)).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), status: entry.status ?? null }))
        }, null, 2)}\n`, 'utf8');
        await captureScreenshot(context, page, 'phase3-board-pointer-same-position-noop-failure.png');
    }
    assert.strictEqual(afterSamePosition, beforeSamePosition, 'a sibling drop already at the requested position must not write.');
    const beforeKeyboardDown = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootB}/move`));
    const keyboardDown = waitForProjectResponse(page, `/api/projects/${projectId}/tasks/${rootB}/move`, 'POST');
    await page.locator(`[data-task-id="${rootB}"]`).focus();
    await page.locator(`[data-task-id="${rootB}"]`).press('ArrowDown');
    await keyboardDown;
    await waitForBoardInteractive(page);
    assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootB}/move`)), beforeKeyboardDown + 1, 'keyboard down must move rootB after rootA before pointer reorder.');
    const afterKeyboardDown = await listTasks(context, ownerToken, projectId, { parentScope: 'root' });
    const sectionARootIdsAfterDown = afterKeyboardDown.tasks
        .filter((task) => (task.effectiveSectionId || task.sectionId) === sectionA && !task.parentTaskId)
        .map((task) => task.id);
    assert.deepStrictEqual(sectionARootIdsAfterDown, [rootA, rootB], 'keyboard down must place rootB after rootA in section A.');
    const beforeNoop = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootA}/move`));
    await page.locator(`[data-task-id="${rootA}"]`).dragTo(page.locator(`[data-task-id="${rootA}"]`));
    await page.waitForTimeout(100);
    assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootA}/move`)), beforeNoop, 'cancelled/self drops must not write.');
    const beforeMove = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootB}/move`));
    const moveResponse = waitForProjectResponse(page, `/api/projects/${projectId}/tasks/${rootB}/move`, 'POST');
    await dragRow(page, rootB, rootA, 0.18);
    await moveResponse;
    await waitForBoardInteractive(page);
    await waitForTaskGestureReady(page, rootB);
    assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootB}/move`)), beforeMove + 1, 'one completed pointer drop must create one move operation.');
    const persisted = await listTasks(context, ownerToken, projectId, { parentScope: 'root' });
    const rootOrder = persisted.tasks.map((entry) => entry.id);
    assert.ok(rootOrder.includes(rootB), 'sibling reorder must retain the moved task.');
    assert.ok(rootOrder.indexOf(rootB) < rootOrder.indexOf(rootA), 'sibling drop must persist the requested relative order.');
    await waitForRenderedTaskOrder(page, rootB, rootA);
    const deepPersisted = (await listTasks(context, ownerToken, projectId, { parentScope: 'direct', parentTaskId: rootB })).tasks.find((entry) => entry.id === deep);
    assert.ok(deepPersisted, 'moving a root must retain its deep descendant under the moved root.');
    const beforeReparent = projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootB}/move`));
    try {
        const reparentResponse = waitForProjectResponse(page, `/api/projects/${projectId}/tasks/${rootB}/move`, 'POST');
        await dragRow(page, rootB, rootC, 0.84);
        await reparentResponse;
    } catch (error) {
        const pageClosed = page.isClosed();
        const diagnostic = pageClosed ? { pageClosed: true } : await page.evaluate(({ rootBId, rootCId }) => {
            const describe = (selector) => {
                const node = document.querySelector(selector);
                const rect = node?.getBoundingClientRect?.();
                return { connected: Boolean(node?.isConnected), rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null, ariaSelected: node?.getAttribute?.('aria-selected') || null };
            };
            return {
                pageClosed: false,
                rootB: describe(`[data-task-id="${rootBId}"]`),
                rootBHandle: describe(`[data-task-id="${rootBId}"] [data-action="drag-handle"]`),
                rootC: describe(`[data-task-id="${rootCId}"]`),
                rootCHandle: describe(`[data-task-id="${rootCId}"] [data-action="drag-handle"]`),
                activeTaskId: document.activeElement?.closest?.('[data-task-id]')?.dataset?.taskId || null,
                status: document.getElementById('projects-board-status')?.textContent || '',
                busy: document.getElementById('projects-board-section')?.getAttribute('aria-busy') || ''
            };
        }, { rootBId: rootB, rootCId: rootC });
        const redactUrl = (url) => String(url || '').replace(/[?&](token|access_token|idToken)=[^&]*/gi, '$1=[redacted]');
        const artifact = {
            error: String(error?.message || error),
            beforeReparent,
            persistedRootOrder: rootOrder,
            diagnostic,
            requests: (context.requestLog || []).slice(-30).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), status: entry.status ?? null })),
            responses: (context.responseLog || []).slice(-30).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), status: entry.status ?? null })),
            requestFailed: (context.requestFailed || []).slice(-20).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), failure: entry.failure || null })),
            consoleErrors: (context.consoleErrors || []).slice(-20)
        };
        if (context.artifactDir) {
            fs.writeFileSync(path.join(context.artifactDir, 'phase3-board-pointer-reparent-failure.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
            if (!pageClosed) await captureScreenshot(context, page, 'phase3-board-pointer-reparent-failure.png');
        }
        throw error;
    }
    assert.strictEqual(projectMutationCount(context, (entry) => entry.url.endsWith(`/tasks/${rootB}/move`)), beforeReparent + 1, 'one completed parent drop must create one move operation.');
    const reparented = await listTasks(context, ownerToken, projectId, { parentScope: 'direct', parentTaskId: rootC });
    assert.ok(reparented.tasks.some((entry) => entry.id === rootB), 'pointer parent drop must reparent the target task.');
    await waitForBoardInteractive(page);
    await waitForTaskGestureReady(page, rootB);
    assert.strictEqual(await page.locator(`[data-task-id="${rootB}"]`).isVisible(), true, 'successful reparent must keep the moved row visible after the settled response.');
    // Reorder selection does not request a modal; explicitly open the moved task
    // before checking its canonical new-parent detail path.
    await page.locator(`[data-task-id="${rootB}"]`).focus();
    await page.keyboard.press('Enter');
    await page.locator('#projects-board-detail').waitFor({ state: 'visible' });
    assert.match(await page.locator('#projects-board-detail-body').textContent(), /Move C/, 'successful reparent detail path must include the new parent.');
    const detailRefresh = page.waitForResponse(response => response.request().method() === 'GET'
        && response.url().includes(`/api/projects/${projectId}/tasks?`));
    await page.locator('#btn-projects-board-refresh').dispatchEvent('click');
    await detailRefresh;
    await waitForBoardInteractive(page);
    assert.strictEqual(await page.locator('#projects-board-detail').isVisible(), true, 'ordinary refresh must preserve an explicit detail-open intent.');
    assert.strictEqual(await page.locator('#projects-board-detail-body dl').filter({ has: page.locator('dt', { hasText: /^Task ID$/ }) }).locator('dd').textContent(), rootB);
    assert.match(await page.locator('#projects-board-detail-body').textContent(), /Move C/);
    try {
        await reloadBoard(page, projectId, rootC);
        await page.locator(`[data-task-id="${rootC}"] .crm-board-expander`).click();
        await page.waitForSelector(`[data-task-id="${rootB}"]`, { timeout: 30000 });
    } catch (error) {
        const diagnostic = page.isClosed() ? { pageClosed: true } : await page.evaluate(({ rootBId, rootCId }) => ({
            pageClosed: false,
            pickerValue: document.getElementById('projects-board-project-select')?.value || '',
            status: document.getElementById('projects-board-status')?.textContent || '',
            busy: document.getElementById('projects-board-section')?.getAttribute('aria-busy') || '',
            workspaceHidden: Boolean(document.getElementById('projects-board-workspace')?.hidden),
            rootCExpanded: document.querySelector(`[data-task-id="${rootCId}"] .crm-board-expander`)?.getAttribute('aria-expanded') || null,
            visibleTaskIds: Array.from(document.querySelectorAll('[data-task-id]')).map((row) => row.dataset.taskId),
            rootBCount: document.querySelectorAll(`[data-task-id="${rootBId}"]`).length,
            rootBVisible: Boolean(document.querySelector(`[data-task-id="${rootBId}"]`)?.getBoundingClientRect?.().height)
        }), { rootBId: rootB, rootCId: rootC });
        const redactUrl = (url) => String(url || '').replace(/[?&](token|access_token|idToken)=[^&]*/gi, '$1=[redacted]');
        const artifact = {
            error: String(error?.message || error),
            diagnostic,
            requests: (context.requestLog || []).slice(-30).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), status: entry.status ?? null })),
            responses: (context.responseLog || []).slice(-30).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), status: entry.status ?? null })),
            requestFailed: (context.requestFailed || []).slice(-20).map((entry) => ({ method: entry.method, url: redactUrl(entry.url), failure: entry.failure || null })),
            consoleErrors: (context.consoleErrors || []).slice(-20)
        };
        if (context.artifactDir) {
            fs.writeFileSync(path.join(context.artifactDir, 'phase3-board-reparent-reload-failure.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
            if (!page.isClosed()) await captureScreenshot(context, page, 'phase3-board-reparent-reload-failure.png');
        }
        throw error;
    }
    await waitForBoardInteractive(page);
    await page.evaluate(() => {
        document.addEventListener('click', event => {
            window.__phase3ReparentClick = { tag: event.target.tagName, taskId: event.target.closest('[data-task-id]')?.dataset.taskId || '',
                action: event.target.closest('[data-action]')?.dataset.action || '', html: event.target.outerHTML.slice(0, 350) };
        }, { capture: true, once: true });
    });
    await page.locator(`[data-task-id="${rootB}"]`).click();
    const clickTarget = await page.evaluate(() => ({ ...window.__phase3ReparentClick,
        detailOpen: document.getElementById('projects-board-detail')?.open === true }));
    if (context.artifactDir) fs.writeFileSync(path.join(context.artifactDir, 'phase3-board-reparent-click-target.json'), `${JSON.stringify(clickTarget, null, 2)}\n`, 'utf8');
    // Reload intentionally discards modal navigation. A row-center click can
    // hit an inline control; use the explicit row keyboard action for details.
    if (await page.locator('#projects-board-detail').isVisible()) await page.locator('#btn-projects-board-close-detail').click();
    await page.locator(`[data-task-id="${rootB}"]`).focus();
    await page.keyboard.press('Enter');
    await page.locator('#projects-board-detail').waitFor({ state: 'visible' });
    await waitForTaskGestureReady(page, rootB);
    const reparentedAfterReload = await listTasks(context, ownerToken, projectId, { parentScope: 'direct', parentTaskId: rootC });
    assert.ok(reparentedAfterReload.tasks.some((entry) => entry.id === rootB), 'reparent must survive a direct board reload.');
    assert.strictEqual(await page.locator('#projects-board-detail-body dl').filter({ has: page.locator('dt', { hasText: /^Task ID$/ }) }).locator('dd').textContent(), rootB, 'reloaded detail must belong to the moved task.');
    assert.match(await page.locator('#projects-board-detail-body').textContent(), /Move C/, 'reparented detail path must remain bound to the new parent after reload.');
    await captureScreenshot(context, page, 'phase3-board-expanded-moves.png');
    return { projectId, rootA, rootB, rootC, deep };
}

async function runPhase3BoardExpandedChecks(context) {
    contextValue(context, 'page');
    contextValue(context, 'server');
    contextValue(context, 'apiRequest');
    contextValue(context, 'ownerToken');
    const typed = await runCreationAndTypedColumnCase(context);
    const roleResult = await runStatusLabelAndRoleCase(context, typed);
    const layout = await runLayoutAndReorderCase(context);
    const pagination = await runContinuationAndVirtualizationCase(context);
    const hover = await runHoverAndEdgeAutoscrollCase(context, pagination);
    const fences = await runDeferredRemoteAndFailureCase(context, typed, pagination);
    const moves = await runPointerKeyboardAndNoopCase(context);
    return { typed, roleResult, layout, pagination, hover, fences, moves };
}

module.exports = {
    api,
    bodyValue,
    createProject,
    createSection,
    createTask,
    patchProject,
    patchTask,
    createColumn,
    listTasks,
    selectBoardProject,
    reloadBoard,
    holdOneProjectRequest,
    runCreationAndTypedColumnCase,
    runStatusLabelAndRoleCase,
    runLayoutAndReorderCase,
    runContinuationAndVirtualizationCase,
    runHoverAndEdgeAutoscrollCase,
    runDeferredRemoteAndFailureCase,
    runPointerKeyboardAndNoopCase,
    runPhase3BoardExpandedChecks
};
