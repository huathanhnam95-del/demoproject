const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadController() {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'public/js/crm/dashboard-workspace.js'),
    'utf8'
  );
  const sandbox = {
    window: {
      CrmDashboard: {
        buildSummaryCards: () => [],
        buildFunnelRows: () => [],
        toMoney: (value) => `$${Number(value || 0)}`,
        formatStageLabel: (stage) => stage
      },
      CrmGovernance: {
        formatDuplicateGroup: () => ({
          title: 'duplicate',
          subtitle: 'group',
          detail: 'detail'
        }),
        formatAuditAction: (action) => action
      }
    },
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  const api = sandbox.window.CrmDashboardWorkspace;
  assert(api && typeof api.createController === 'function', 'CrmDashboardWorkspace controller was not initialized.');
  return api.createController;
}

function createElements() {
  return {
    dashboardSummaryCards: { innerHTML: '' },
    dashboardFunnel: { innerHTML: '' },
    dashboardRevenue: { innerHTML: '' },
    dashboardDuplicates: { innerHTML: '' },
    dashboardAuditLogs: { innerHTML: '' },
    readAloudPromptSummaryCards: { innerHTML: '' },
    readAloudPromptSamples: { innerHTML: '' },
    readAloudUsageSummaryCards: { innerHTML: '' }
  };
}

function createApiFetchJson(calls) {
  return async function apiFetchJson(url) {
    calls.push(url);
    if (url === '/api/admin/dashboard/summary') return { summary: {} };
    if (url === '/api/admin/dashboard/funnel') return { funnel: {} };
    if (url === '/api/admin/dashboard/revenue') return { revenue: [] };
    if (url === '/api/admin/duplicates') return { duplicates: [] };
    if (url === '/api/admin/audit-logs') return { auditLogs: [] };
    if (url === '/api/admin/read-aloud/prompt-summary') {
      return {
        promptSummary: {
          promptCount: 12,
          audioAvailableCount: 11,
          anyConnectedCount: 5,
          soundChangeCount: 2,
          indexVersion: 'test',
          samplePrompts: []
        }
      };
    }
    if (url === '/api/admin/read-aloud/usage-summary?days=7') {
      return {
        usageSummary: {
          attemptCount: 4,
          guideLevelCounts: { starter: 4 },
          requestedAlignmentModeCounts: { v2: 2 },
          actualScoringModeCounts: { v2: 2 },
          realShadowAttemptCount: 1,
          shadowPlaceholderCount: 0,
          v3NoSoundChangeCount: 0,
          periodDays: 7
        }
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };
}

async function runCase(capabilities) {
  const createController = loadController();
  const calls = [];
  const controller = createController({
    elements: createElements(),
    showToast: () => {},
    apiFetchJson: createApiFetchJson(calls),
    formatDateTime: (value) => String(value || ''),
    escapeHtml: (value) => String(value || ''),
    getAdminCapabilities: () => capabilities
  });
  await controller.refreshDashboard();
  return calls;
}

(async () => {
  const disabledCalls = await runCase({
    readAloudReporting: false
  });
  assert(
    !disabledCalls.includes('/api/admin/read-aloud/prompt-summary'),
    'Dashboard should not request read-aloud prompt summary when the backend does not advertise that capability.'
  );
  assert(
    !disabledCalls.includes('/api/admin/read-aloud/usage-summary?days=7'),
    'Dashboard should not request read-aloud usage summary when the backend does not advertise that capability.'
  );

  const enabledCalls = await runCase({
    readAloudReporting: true
  });
  assert(
    enabledCalls.includes('/api/admin/read-aloud/prompt-summary'),
    'Dashboard should request read-aloud prompt summary when the backend advertises that capability.'
  );
  assert(
    enabledCalls.includes('/api/admin/read-aloud/usage-summary?days=7'),
    'Dashboard should request read-aloud usage summary when the backend advertises that capability.'
  );

  console.log('dashboard optional feature gating passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
