const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function buildHarnessHtml() {
  return `
    <!doctype html>
    <html lang="en">
      <head><meta charset="utf-8"><title>CRM Harness</title></head>
      <body>
        <div id="crm-loading"></div>
        <div id="crm-loading-text"></div>
        <div id="crm-loading-subtext"></div>
        <button type="button" class="btn-new-student-trigger">New Student</button>

        <section class="crm-panel" data-panel="dashboard"></section>
        <section class="crm-panel" data-panel="students">
          <div class="crm-placeholder-card"></div>
        </section>
        <section class="crm-panel" data-panel="enquiry">
          <button id="btn-new-lead" type="button"></button>
          <div id="lead-stage-board"></div>
          <div id="lead-list-container"></div>
          <div id="lead-workspace" style="display: none;">
            <h3 id="lead-workspace-title"></h3>
            <p id="lead-workspace-meta"></p>
            <span id="lead-workspace-badge"></span>
          </div>
        </section>

        <div id="crm-student-modal" class="crm-modal" style="display:none;" aria-hidden="true">
          <button id="btn-close-student-modal" type="button">Close</button>
          <button id="btn-cancel-student" type="button">Cancel</button>
          <button id="btn-save-student" type="button">Save</button>
          <span id="crm-student-id-badge" style="display:none;"></span>

          <input id="student-name" />
          <input id="student-label" />
          <input id="student-phone" />
          <input id="student-email" />
          <input id="student-zalo" />
          <input id="student-facebook" />
          <input id="student-facebook-profile-url" />
          <input id="score-overall" />
          <input id="score-listening" />
          <input id="score-reading" />
          <input id="score-speaking" />
          <input id="score-writing" />
          <input id="student-due-date" />
          <input id="student-level" />
          <input id="student-target-exam" />
          <input id="student-target-score" />
          <input id="student-preferred-schedule" />
          <input id="student-preferred-learning-days" />
          <input id="student-preferred-learning-hours" />
          <div id="student-schedule-prompt"></div>
          <textarea id="student-score-history"></textarea>
          <textarea id="student-guardian-contacts"></textarea>
          <textarea id="student-company-contacts"></textarea>
          <textarea id="student-document-refs"></textarea>
          <textarea id="student-counseling-notes"></textarea>
          <div id="student-task-meta"></div>
          <span id="student-task-badge"></span>
          <div id="student-task-list"></div>
          <div id="student-activity-list"></div>
          <div id="student-classroom-match-summary"></div>
          <select id="student-classroom-match-select"></select>
          <div id="student-classroom-match-meta"></div>
          <div id="student-classroom-match-warning"></div>
          <button id="btn-create-recommended-enrollment" type="button"></button>
          <button id="btn-add-entrance-test" type="button"></button>
          <input id="entrance-test-link" />
          <button id="btn-copy-entrance-test-link" type="button"></button>
          <button id="btn-open-entrance-test-link" type="button"></button>
          <div id="entrance-test-link-note"></div>
          <div id="entrance-tests-list"></div>
          <div id="student-finance-invoiced"></div>
          <div id="student-finance-paid"></div>
          <div id="student-finance-outstanding"></div>
          <div id="student-finance-next-due"></div>
          <input id="invoice-amount" />
          <select id="invoice-currency"></select>
          <input id="invoice-discount" />
          <input id="invoice-due-date" />
          <input id="student-finance-enrollment" />
          <div id="student-finance-enrollment-meta"></div>
          <div id="student-finance-workflow-badge"></div>
          <div id="student-finance-workflow-note"></div>
          <div id="student-invoice-list"></div>
          <input id="payment-amount" />
          <select id="payment-currency"></select>
          <input id="payment-method" />
          <button id="btn-record-student-payment" type="button"></button>
          <div id="crm-handshake-preview"></div>
          <input id="crm-handshake-email" />
          <div id="crm-handshake-avatar"></div>
          <div id="crm-handshake-name"></div>
          <div id="crm-handshake-uid"></div>
          <button id="btn-confirm-handshake" type="button"></button>
          <ul id="crm-linked-uids-ul"></ul>
          <div id="read-aloud-prompt-summary-cards"></div>
          <div id="read-aloud-prompt-samples"></div>
          <div id="read-aloud-usage-summary-cards"></div>
        </div>
      </body>
    </html>
  `;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const student = {
    studentId: 'student-1',
    crmId: 'a0001',
    name: 'Alice Nguyen',
    email: 'alice@example.com',
    lifecycleStage: 'potential',
    createdAt: '2026-01-01T00:00:00.000Z',
    learningProfile: {}
  };
  const studentTwo = {
    studentId: 'student-2',
    crmId: 'a0002',
    name: 'Bao Tran',
    email: 'bao@example.com',
    lifecycleStage: 'potential',
    createdAt: '2026-01-02T00:00:00.000Z',
    learningProfile: {}
  };
  const lead = {
    leadId: 'lead-1',
    crmId: null,
    stage: 'new',
    name: 'Lead One',
    email: 'lead-one@example.com',
    probability: 5,
    createdAt: '2026-01-03T00:00:00.000Z',
    studentId: null
  };
  const convertedLead = {
    leadId: 'lead-2',
    crmId: 'a0001',
    stage: 'converted',
    name: 'Converted Lead',
    email: 'converted@example.com',
    probability: 100,
    createdAt: '2026-01-04T00:00:00.000Z',
    studentId: 'student-1'
  };

  await page.addInitScript((payload) => {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const students = new Map(Object.entries(payload.students));
    const leads = Array.isArray(payload.leads) ? payload.leads.map((row) => clone(row)) : [];

    function jsonResponse(body, status = 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    window.AuthSessionGuard = {
      ensureCompatFirebaseFromConfig: async () => {},
      ensureCompatLocalPersistence: async () => {},
      waitForCompatAuthUser: async () => ({
        uid: 'admin-1',
        email: 'admin@example.com',
        getIdToken: async () => 'token-admin'
      })
    };

    window.firebase = {
      apps: [],
      initializeApp: () => {},
      auth: () => ({
        currentUser: {
          getIdToken: async () => 'token-admin'
        }
      }),
      firestore: () => ({
        collection: () => ({
          doc: (docId) => ({
            async get() {
              const data = students.get(docId) || null;
              return {
                exists: !!data,
                data: () => (data ? clone(data) : null)
              };
            }
          }),
          where: () => ({ get: async () => ({ docs: [] }) }),
          orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
          limit: () => ({ get: async () => ({ docs: [] }) })
        })
      })
    };

    window.CrmFinance = { bindMoneyInput() {} };
    window.CrmStudent360 = { applyToForm() {} };
    window.CrmDashboardWorkspace = { createController: () => ({ refreshDashboard: async () => {} }) };
    window.CrmSchedulerWorkspace = { createController: () => ({ init() {}, load: async () => {}, refresh: async () => {} }) };
    window.CrmStudentFinance = { createController: () => ({ refreshStudentFinance: async () => {}, renderStudentClassroomMatches() {} }) };
    window.CrmLiveDelivery = { createController: () => ({}) };
    window.CrmCourseModal = { createController: () => ({ setupCourseModal() {}, switchCourseTab() {}, resetCourseModal() {} }) };
    window.CrmClassroomModal = { createController: () => ({ setupClassroomModal() {}, switchClassroomTab() {}, resetClassroomModal() {} }) };
    window.CrmLeadWorkspace = { createController: () => ({ setupLeadComposer() {}, refreshLeadPipeline: async () => {}, renderLeadStageBoard() {}, renderLeadTable() {}, refreshLeadWorkspace: async () => {} }) };
    window.CrmRecycleBinWorkspace = { createController: () => ({ refreshRecycleBin: async () => {} }) };
    window.CrmCommunicationsWorkspace = { createController: () => ({ refreshCommunicationsManager: async () => {} }) };

    window.CrmEntranceTests = {
      applyControls() {},
      buildViewModel(tests = [], links = new Map()) {
        return { tests, latestActiveTest: tests[0] || null, links };
      },
      normalizeLearnerLink(value) {
        return String(value || '').trim();
      }
    };

    window.fetch = async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');

      if (url === '/api/config') {
        return jsonResponse({
          success: true,
          config: {
            apiKey: 'test-api-key'
          }
        });
      }

      if (url === '/api/admin/status') {
        return jsonResponse({
          success: true,
          isAdmin: true,
          capabilities: {}
        });
      }

      if (url === '/api/admin/students?limit=200') {
        return jsonResponse({
          success: true,
          students: [
            clone(payload.students['student-1']),
            clone(payload.students['student-2'])
          ]
        });
      }

      if (url === '/api/admin/students/student-1') {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(jsonResponse({ success: true, student: clone(payload.students['student-1']) }));
          }, 200);
        });
      }

      if (url === '/api/admin/students/student-2') {
        return jsonResponse({ success: true, student: clone(payload.students['student-2']) });
      }

      if (url === '/api/admin/students/by-crm-id/a0001') {
        return jsonResponse({ success: true, student: clone(payload.students['student-1']) });
      }

      if (url === '/api/admin/students/student-1/entrance-tests') {
        return jsonResponse({ success: true, tests: [] });
      }

      if (url === '/api/admin/students/student-2/entrance-tests') {
        return jsonResponse({ success: true, tests: [] });
      }

      if (url === '/api/admin/leads?limit=200') {
        return jsonResponse({ success: true, leads: clone(leads) });
      }

      if (url === '/api/admin/leads/lead-1/convert') {
        const idx = leads.findIndex((row) => String(row?.leadId || '') === 'lead-1');
        if (idx >= 0) {
          leads[idx] = {
            ...leads[idx],
            stage: 'converted',
            studentId: 'student-2',
            crmId: 'a0002'
          };
        }
        return jsonResponse({ success: true, student: clone(payload.students['student-2']), lead: idx >= 0 ? clone(leads[idx]) : null });
      }

      if (url.startsWith('/api/admin/tasks')) {
        return jsonResponse({ success: true, tasks: [] });
      }

      if (url.startsWith('/api/admin/activities')) {
        return jsonResponse({ success: true, activities: [] });
      }

      return jsonResponse({ success: true });
    };
  }, { students: { 'student-1': student, 'student-2': studentTwo }, leads: [lead, convertedLead] });

  await page.route('https://betterenglishlearning.test/crm-harness.html', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: buildHarnessHtml()
    });
  });

  await page.goto('https://betterenglishlearning.test/crm-harness.html#students/a0001');

  for (const scriptPath of [
    'public/js/crm/leads.js',
    'public/js/crm/lead-workspace.js',
    'public/js/crm/students.js',
    'public/js/crm/student-modal.js',
    'public/js/crm/student-directory-workspace.js',
    'public/crm-admin.js'
  ]) {
    await page.addScriptTag({ content: read(scriptPath) });
  }

  await page.evaluate(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  await page.waitForFunction(() => {
    const badge = document.getElementById('crm-student-id-badge');
    return badge && badge.textContent.includes('a0001');
  });

  assert.strictEqual(page.url().endsWith('#students/a0001'), true, 'Direct deep link should keep the crmId hash.');
  assert.strictEqual(await page.locator('#crm-student-id-badge').textContent(), 'ID: a0001');
  assert.strictEqual(await page.locator('#crm-student-modal').getAttribute('aria-hidden'), 'false');
  await page.waitForFunction(() => {
    const code = document.querySelector('[data-panel="students"] code');
    return code && code.textContent.includes('a0001');
  });
  assert.strictEqual(await page.locator('[data-panel="students"] code').first().textContent(), 'a0001');

  await page.locator('#btn-close-student-modal').click();
  await page.waitForFunction(() => window.location.hash === '#students');
  assert.strictEqual(page.url().endsWith('#students'), true, 'Closing the profile should return to the unified students list.');
  assert.strictEqual(await page.locator('#crm-student-modal').getAttribute('aria-hidden'), 'true');

  await page.locator('button.crm-student-link[data-student-id="student-1"]').click();
  await page.waitForFunction(() => window.location.hash === '#students/a0001');
  await page.waitForFunction(() => document.getElementById('crm-student-id-badge')?.textContent === 'ID: a0001');
  assert.strictEqual(await page.locator('#crm-student-modal').getAttribute('aria-hidden'), 'false');
  assert.strictEqual(await page.locator('#crm-student-id-badge').textContent(), 'ID: a0001');

  await page.locator('button.crm-student-link[data-student-id="student-1"]').click();
  await page.locator('button.crm-student-link[data-student-id="student-2"]').click();
  await page.waitForFunction(() => window.location.hash === '#students/a0002');
  await page.waitForFunction(() => document.getElementById('crm-student-id-badge')?.textContent === 'ID: a0002');
  await page.waitForFunction(() => document.getElementById('student-name')?.value === 'Bao Tran');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.locator('#crm-student-id-badge').textContent(), 'ID: a0002', 'A stale student fetch must not overwrite the active student badge.');
  assert.strictEqual(await page.locator('#student-name').inputValue(), 'Bao Tran', 'A stale student fetch must not overwrite the active student form.');

  await page.evaluate(() => {
    window.location.hash = '#students/A0001';
  });
  await page.waitForFunction(() => window.location.hash === '#students/a0001');
  assert.strictEqual(page.url().endsWith('#students/a0001'), true, 'Uppercase deep link should canonicalize to lowercase.');

  await page.evaluate(() => {
    window.location.hash = '#enquiry';
  });
  await page.waitForFunction(() => window.location.hash === '#enquiry');
  await page.waitForFunction(() => document.querySelectorAll('.btn-convert-lead[data-lead-id="lead-1"]').length > 0);
  await page.locator('.btn-convert-lead[data-lead-id="lead-1"]').click();
  await page.waitForFunction(() => window.location.hash === '#students/a0002');
  await page.waitForFunction(() => document.getElementById('crm-student-id-badge')?.textContent === 'ID: a0002');
  await page.locator('#btn-close-student-modal').click();
  await page.waitForFunction(() => window.location.hash === '#enquiry');
  assert.strictEqual(page.url().endsWith('#enquiry'), true, 'Closing a profile opened from enquiry should return to enquiry.');

  await page.evaluate(() => {
    window.location.hash = '#students/a0001';
  });
  await page.waitForFunction(() => document.getElementById('crm-student-id-badge')?.textContent === 'ID: a0001');
  await page.locator('#btn-close-student-modal').click();
  await page.waitForFunction(() => window.location.hash === '#enquiry');

  await browser.close();
  console.log('crm student deep link browser check passed');
})().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
