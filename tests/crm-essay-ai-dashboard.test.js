const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadWorkspace() {
  const context = { window: {}, setTimeout, clearTimeout, Date, Math, encodeURIComponent };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/js/crm/dashboard-workspace.js', 'utf8'), context);
  return context.window.CrmDashboardWorkspace;
}

function button() {
  const listeners = new Map();
  return {
    disabled: false,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    listenerCount() { return listeners.size; }
  };
}

test('dashboard controller owns the Essay AI lifecycle methods', () => {
  const controller = loadWorkspace().createController({
    elements: {},
    apiFetchJson: async () => ({}),
    getAdminCapabilities: () => ({})
  });
  for (const name of ['loadEssayAiStatus', 'startEssayAiPreview', 'triggerEssayAiBackfill', 'pollEssayAiJob', 'activate', 'dispose']) {
    assert.equal(typeof controller[name], 'function', name);
  }
});

test('activation is idempotent and unavailable worker disables scan controls', async () => {
  const preview = button();
  const trigger = button();
  const status = { textContent: '' };
  const controller = loadWorkspace().createController({
    elements: { btnEssayAiPreview: preview, btnEssayAiTrigger: trigger, essayAiAdminStatus: status },
    apiFetchJson: async () => ({ worker: null, pendingCount: 0 }),
    getAdminCapabilities: () => ({})
  });
  await controller.activate();
  await controller.activate();
  assert.equal(preview.listenerCount(), 1);
  assert.equal(trigger.listenerCount(), 1);
  assert.equal(preview.disabled, true);
  assert.equal(trigger.disabled, true);
  assert.match(status.textContent, /not ready/i);
  controller.dispose();
  assert.equal(preview.listenerCount(), 0);
  assert.equal(trigger.listenerCount(), 0);
});

test('completed preview enables the explicit trigger and preserves its job id', async () => {
  const preview = button();
  const trigger = button();
  const status = { textContent: '' };
  const calls = [];
  const apiFetchJson = async (path, options = {}) => {
    calls.push({ path, options });
    if (path.endsWith('/status')) {
      return {
        worker: { lastHeartbeatAt: new Date(), ollamaReachable: true, modelsReady: true },
        pendingCount: 0
      };
    }
    if (path.endsWith('/preview')) return { jobId: 'preview-job-1' };
    if (path.includes('/backfill-jobs/')) {
      return { jobId: 'preview-job-1', mode: 'preview', status: 'completed', candidateCount: 3, invalidCount: 0 };
    }
    throw new Error(`Unexpected path: ${path}`);
  };
  const controller = loadWorkspace().createController({
    elements: { btnEssayAiPreview: preview, btnEssayAiTrigger: trigger, essayAiAdminStatus: status },
    apiFetchJson,
    showToast: () => {},
    getAdminCapabilities: () => ({})
  });
  await controller.activate();
  await controller.startEssayAiPreview();
  assert.equal(controller.getEssayAiState().previewJobId, 'preview-job-1');
  assert.equal(controller.getEssayAiState().previewStatus, 'completed');
  assert.equal(trigger.disabled, false);
  assert.match(status.textContent, /3 unscored/i);
  assert.ok(calls.some((call) => call.path.endsWith('/preview')));
});

test('failed preview request restores the preview control', async () => {
  const preview = button();
  const trigger = button();
  const status = { textContent: '' };
  const controller = loadWorkspace().createController({
    elements: { btnEssayAiPreview: preview, btnEssayAiTrigger: trigger, essayAiAdminStatus: status },
    apiFetchJson: async (path) => {
      if (path.endsWith('/status')) return {
        worker: { ready: true, lastHeartbeatAt: new Date(), ollamaReachable: true, modelsReady: true },
        pendingCount: 0
      };
      throw new Error('network down');
    },
    getAdminCapabilities: () => ({})
  });
  await controller.activate();
  await assert.rejects(() => controller.startEssayAiPreview(), /network down/);
  assert.equal(preview.disabled, false);
  assert.equal(controller.getEssayAiState().previewStatus, null);
});

test('trigger control stays disabled while enqueue request is in flight', async () => {
  const preview = button();
  const trigger = button();
  const status = { textContent: '' };
  let releaseTrigger;
  const triggerResponse = new Promise((resolve) => { releaseTrigger = resolve; });
  const controller = loadWorkspace().createController({
    elements: { btnEssayAiPreview: preview, btnEssayAiTrigger: trigger, essayAiAdminStatus: status },
    apiFetchJson: async (path) => {
      if (path.endsWith('/status')) return { worker: { ready: true }, pendingCount: 0 };
      if (path.endsWith('/preview')) return { jobId: 'preview-1' };
      if (path.endsWith('/preview-1')) return { jobId: 'preview-1', mode: 'preview', status: 'completed', candidateCount: 1 };
      if (path.endsWith('/trigger')) return triggerResponse;
      if (path.endsWith('/enqueue-1')) return { jobId: 'enqueue-1', mode: 'enqueue', status: 'completed', enqueuedCount: 1 };
      throw new Error(`Unexpected path: ${path}`);
    },
    getAdminCapabilities: () => ({})
  });
  await controller.activate();
  await controller.startEssayAiPreview();
  const pending = controller.triggerEssayAiBackfill();
  await Promise.resolve();
  assert.equal(trigger.disabled, true);
  assert.equal(controller.getEssayAiState().enqueueStatus, 'pending');
  releaseTrigger({ jobId: 'enqueue-1' });
  await pending;
  assert.equal(controller.getEssayAiState().enqueueStatus, 'completed');
});
