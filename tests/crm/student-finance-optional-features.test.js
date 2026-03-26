const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadController() {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'public/js/crm/student-finance.js'),
    'utf8'
  );
  const sandbox = {
    window: {
      CrmFinance: {
        deriveWorkflowState: () => ({
          nextAction: 'collect_payment',
          requiresPayment: false,
          primaryClassroomId: null,
          activeEnrollmentId: null,
          message: 'ok'
        }),
        formatMoney: (value) => `$${Number(value || 0)}`
      }
    },
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  const api = sandbox.window.CrmStudentFinance;
  assert(api && typeof api.createController === 'function', 'CrmStudentFinance controller was not initialized.');
  return {
    createController: api.createController,
    sandbox
  };
}

function createElements() {
  return {
    inputStudentFinanceEnrollment: { value: '', innerHTML: '' },
    studentFinanceEnrollmentMeta: { textContent: '' },
    studentFinanceInvoiced: { textContent: '' },
    studentFinancePaid: { textContent: '' },
    studentFinanceOutstanding: { textContent: '' },
    studentFinanceNextDue: { textContent: '' },
    studentInvoiceList: {
      innerHTML: '',
      addEventListener: () => {},
      contains: () => true
    },
    studentClassroomMatchSummary: { innerHTML: '' },
    inputStudentClassroomMatchSelect: { value: '', innerHTML: '' },
    studentClassroomMatchMeta: { textContent: '' },
    studentClassroomMatchWarning: { textContent: '', style: {} },
    studentFinanceWorkflowBadge: { className: '', textContent: '' },
    studentFinanceWorkflowNote: { textContent: '' },
    btnCreateRecommendedEnrollment: { disabled: true }
  };
}

async function runCase(capabilities) {
  const { createController, sandbox } = loadController();
  let matchCalls = 0;
  sandbox.window.ClassroomAPI = {
    fetchAttendanceSummary: async () => ({ students: [] }),
    fetchClassroomMatches: async () => {
      matchCalls += 1;
      return {
        matches: [],
        recommendedClassroom: null,
        classroomCount: 0,
        courseId: null
      };
    }
  };

  const controller = createController({
    apiFetchJson: async () => ({
      totalInvoiced: 0,
      totalPaid: 0,
      totalOutstanding: 0,
      nextDueDate: '-',
      invoices: []
    }),
    elements: createElements(),
    modalState: {
      studentId: 'student-1',
      classroomMatches: [],
      financeWorkflow: null,
      financeEnrollments: []
    },
    getCurrentStudentProfile: () => null,
    renderStudentSchedulePrompt: () => {},
    refreshDashboard: async () => {},
    showToast: () => {},
    escapeHtml: (value) => String(value || ''),
    getAdminCapabilities: () => capabilities
  });

  await controller.refreshStudentFinance();
  return matchCalls;
}

(async () => {
  const disabledCalls = await runCase({
    classroomMatches: false
  });
  assert.strictEqual(
    disabledCalls,
    0,
    'Student finance should not request classroom matches when the backend does not advertise that capability.'
  );

  const enabledCalls = await runCase({
    classroomMatches: true
  });
  assert.strictEqual(
    enabledCalls,
    1,
    'Student finance should request classroom matches when the backend advertises that capability.'
  );

  console.log('student finance optional feature gating passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
