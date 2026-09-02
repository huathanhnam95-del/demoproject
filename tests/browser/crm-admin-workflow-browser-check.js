const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const BASE_ORIGIN = 'https://betterenglishlearning.com';
const ENQUIRY_URL = `${BASE_ORIGIN}/crm-admin.html#enquiry`;
const AGENTS_URL = `${BASE_ORIGIN}/crm-admin.html#agents`;
const COURSES_URL = `${BASE_ORIGIN}/crm-admin.html#courses/courses`;
const CLASS_MANAGEMENT_URL = `${BASE_ORIGIN}/crm-admin.html#courses/class-management`;
const CLASSES_URL = `${BASE_ORIGIN}/crm-admin.html#courses/classes`;

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

function buildFirebaseStubScript() {
  return `(function () {
    const currentUser = {
      uid: 'admin-1',
      email: 'admin@example.com',
      displayName: 'Admin',
      getIdToken: async () => 'browser-test-token'
    };

    function snapshot() {
      return { empty: true, docs: [], forEach() {} };
    }

    function collection() {
      const chain = {
        doc() {
          return {
            get: async () => ({ exists: false, data: () => null }),
            set: async () => {},
            update: async () => {},
            collection
          };
        },
        where() { return chain; },
        orderBy() { return chain; },
        limit() { return chain; },
        get: async () => snapshot(),
        add: async () => ({ id: 'doc-1' })
      };
      return chain;
    }

    const firestore = {
      collection,
      FieldValue: { serverTimestamp: () => new Date() }
    };

    window.firebase = {
      apps: [],
      initializeApp(config) {
        this.apps.push(config);
        this._config = config;
        return this;
      },
      auth() {
        return {
          currentUser,
          onAuthStateChanged(callback) {
            setTimeout(() => callback(currentUser), 0);
            return () => {};
          }
        };
      },
      firestore() {
        return firestore;
      },
      storage() {
        return {
          ref() {
            return { put: async () => ({}) };
          }
        };
      }
    };
  })();`;
}

function buildClipboardStubScript() {
  return `(function () {
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => { window.__clipboardText = String(text || ''); }
        }
      });
    } catch (_) {}
    window.__clipboardText = '';
  })();`;
}

function parseBody(request) {
  try {
    return request.postDataJSON();
  } catch (_) {
    const raw = request.postData();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return raw;
    }
  }
}

function jsonFulfill(route, payload, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload)
  });
}

function createHarnessState() {
  return {
    nextLeadId: 1,
    nextStudentId: 1,
    nextCourseId: 1,
    nextClassroomId: 1,
    nextTestId: 1,
    agentSources: [
      { agentSourceId: 'agent-source-1', id: 'agent-source-1', name: 'Referral Team', status: 'active' }
    ],
    leads: [],
    students: [],
    entranceTests: [],
    courses: [],
    classrooms: [],
    sessions: [],
    teachers: [
      { uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher.one@example.com' },
      { uid: 'teacher-2', displayName: 'Teacher Two', email: 'teacher.two@example.com' }
    ]
  };
}

function buildDefaultApiResponse() {
  return {
    success: true,
    students: [],
    leads: [],
    tasks: [],
    activities: [],
    invoices: [],
    payments: [],
    classrooms: [],
    courses: [],
    teachers: [],
    attempts: [],
    matches: [],
    summary: {},
    funnel: {},
    revenue: [],
    duplicates: [],
    auditLogs: [],
    communications: [],
    promptSummary: null,
    usageSummary: null
  };
}

function mapEntranceTestForAdmin(test) {
  return {
    testId: test.testId,
    leadId: test.leadId || null,
    studentId: test.studentId || null,
    crmId: test.crmId || null,
    testType: test.testType || 'segmental_screening_v1',
    status: test.status || 'created',
    createdAt: test.createdAt || '2026-05-30T09:00:00.000Z',
    startedAt: test.startedAt || null,
    submittedAt: test.submittedAt || null,
    testLink: test.testLink || null,
    resultLink: `${BASE_ORIGIN}/crm-entrance-test-result.html?testId=${encodeURIComponent(test.testId)}`
  };
}

function createCourse(state, body) {
  const courseId = `course-${state.nextCourseId++}`;
  const course = {
    id: courseId,
    courseId,
    name: String(body?.name || '').trim(),
    code: String(body?.code || '').trim(),
    label: String(body?.label || '').trim(),
    level: String(body?.level || '').trim(),
    category: String(body?.category || '').trim(),
    status: String(body?.status || 'active').trim(),
    agentCommissionBps: body?.agentCommissionBps ?? null,
    description: String(body?.description || '').trim(),
    teachers: Array.isArray(body?.teachers) ? body.teachers : [],
    deliveryTemplate: {
      ...(body?.deliveryTemplate || {})
    }
  };
  state.courses.push(course);
  return course;
}

function createClassroom(state, body) {
  const classroomId = `class-${state.nextClassroomId++}`;
  const scheduleConfig = {
    ...(body?.scheduleConfig || {}),
    scheduleVersion: 1
  };
  const classroom = {
    id: classroomId,
    classroomId,
    name: String(body?.name || '').trim(),
    courseId: String(body?.courseId || '').trim(),
    status: String(body?.status || 'draft').trim(),
    primaryTeacherUid: String(body?.primaryTeacherUid || '').trim(),
    scheduleConfig,
    scheduleSummary: {
      contractedTargetCount: scheduleConfig.totalInstructionMinutes && scheduleConfig.sessionMinutes
        ? Math.ceil(Number(scheduleConfig.totalInstructionMinutes) / Number(scheduleConfig.sessionMinutes))
        : 0,
      contractedAssignedCount: 0,
      remainingToScheduleCount: scheduleConfig.totalInstructionMinutes && scheduleConfig.sessionMinutes
        ? Math.ceil(Number(scheduleConfig.totalInstructionMinutes) / Number(scheduleConfig.sessionMinutes))
        : 0,
      overflowCount: 0
    }
  };
  state.classrooms.push(classroom);
  return classroom;
}

function updateClassroom(state, classroomId, body) {
  const classroom = state.classrooms.find((row) => String(row.classroomId || row.id || '') === String(classroomId || ''));
  if (!classroom) return null;
  classroom.name = String(body?.name || classroom.name || '').trim();
  classroom.courseId = String(body?.courseId || classroom.courseId || '').trim();
  classroom.status = String(body?.status || classroom.status || 'draft').trim();
  classroom.primaryTeacherUid = String(body?.primaryTeacherUid || classroom.primaryTeacherUid || '').trim();
  classroom.scheduleConfig = {
    ...(classroom.scheduleConfig || {}),
    ...(body?.scheduleConfig || {}),
    scheduleVersion: Number(classroom.scheduleConfig?.scheduleVersion || 1) + 1
  };
  return classroom;
}

function buildStudentFromLead(state, lead) {
  const studentId = `student-${state.nextStudentId++}`;
  const student = {
    id: studentId,
    studentId,
    crmId: lead.crmId,
    leadId: lead.leadId,
    name: lead.realName || lead.name || lead.email || 'Converted Student',
    email: lead.email || null,
    phone: lead.phone || null,
    acquisitionSource: lead.source || null,
    agentSourceId: lead.agentSourceId || null,
    lifecycleStage: lead.stage || 'enrolled',
    preferredLearningDays: Array.isArray(lead.preferredLearningDays) ? lead.preferredLearningDays : [],
    preferredLearningHours: Array.isArray(lead.preferredLearningHours) ? lead.preferredLearningHours : [],
    preferredSchedule: [
      Array.isArray(lead.preferredLearningDays) && lead.preferredLearningDays.length ? `Days: ${lead.preferredLearningDays.join(', ')}` : '',
      Array.isArray(lead.preferredLearningHours) && lead.preferredLearningHours.length ? `Hours: ${lead.preferredLearningHours.join(', ')}` : ''
    ].filter(Boolean).join(' | ')
  };
  state.students.push(student);
  return student;
}

async function routeApi(route, url, state, requestLog) {
  const request = route.request();
  const method = request.method();
  const pathname = url.pathname;
  const body = method === 'GET' || method === 'HEAD' ? null : parseBody(request);
  requestLog.push({ method, path: pathname, body });

  if (pathname === '/api/config') {
    return jsonFulfill(route, {
      success: true,
      config: {
        apiKey: 'browser-test-api-key',
        authDomain: 'betterenglishlearning.com',
        projectId: 'browser-test-project',
        storageBucket: 'browser-test-project.appspot.com',
        appId: '1:1234567890:web:browser-test'
      }
    });
  }

  if (pathname === '/api/admin/status') {
    return jsonFulfill(route, { success: true, isAdmin: true });
  }

  if (pathname === '/api/test-harness/submit-lead-test' && method === 'POST') {
    const leadId = String(body?.leadId || '').trim();
    const lead = state.leads.find((row) => String(row.leadId || '') === leadId);
    const test = state.entranceTests.find((row) => String(row.leadId || '') === leadId);
    if (!lead || !test) {
      return jsonFulfill(route, { success: false, message: 'Missing harness lead/test.' }, 404);
    }
    lead.stage = 'test_completed';
    lead.updatedAt = '2026-05-30T09:15:00.000Z';
    test.status = 'submitted';
    test.startedAt = test.startedAt || '2026-05-30T09:10:00.000Z';
    test.submittedAt = '2026-05-30T09:15:00.000Z';
    return jsonFulfill(route, { success: true, lead, test });
  }

  if (pathname === '/api/admin/agent-sources' && method === 'GET') {
    return jsonFulfill(route, { success: true, agentSources: state.agentSources });
  }

  if (pathname === '/api/admin/leads' && method === 'GET') {
    return jsonFulfill(route, { success: true, leads: state.leads });
  }

  if (pathname === '/api/admin/leads' && method === 'POST') {
    const leadId = `lead-${state.nextLeadId++}`;
    const lead = {
      id: leadId,
      leadId,
      crmId: `a${String(state.nextLeadId - 1).padStart(4, '0')}`,
      name: String(body?.name || '').trim(),
      realName: String(body?.realName || body?.name || '').trim(),
      email: String(body?.email || '').trim(),
      phone: String(body?.phone || '').trim(),
      source: String(body?.source || '').trim(),
      agentSourceId: String(body?.agentSourceId || '').trim() || null,
      stage: String(body?.stage || 'new').trim(),
      probability: body?.probability ?? null,
      learningProfile: body?.learningProfile || null,
      targets: body?.targets || null,
      learningNeeds: String(body?.learningNeeds || '').trim(),
      preferredLearningDays: Array.isArray(body?.preferredLearningDays) ? body.preferredLearningDays : [],
      preferredLearningHours: Array.isArray(body?.preferredLearningHours) ? body.preferredLearningHours : [],
      createdAt: '2026-05-30T09:00:00.000Z'
    };
    state.leads.push(lead);
    return jsonFulfill(route, { success: true, leadId, lead });
  }

  if (/^\/api\/admin\/leads\/[^/]+\/entrance-tests$/i.test(pathname) && method === 'POST') {
    const leadId = pathname.split('/')[4];
    const lead = state.leads.find((row) => String(row.leadId || '') === leadId);
    if (!lead) return jsonFulfill(route, { success: false, message: 'Lead not found.' }, 404);
    lead.stage = 'test_scheduled';
    const testId = `test-${state.nextTestId++}`;
    const token = `token-${testId}`;
    const test = {
      testId,
      leadId,
      studentId: lead.studentId || null,
      crmId: lead.crmId,
      testType: String(body?.testType || 'entrance_test_36plus_v1').trim(),
      status: 'created',
      createdAt: '2026-05-30T09:05:00.000Z',
      testLink: `${BASE_ORIGIN}/entrance-test.html?token=${encodeURIComponent(token)}`,
      resultLink: `${BASE_ORIGIN}/crm-entrance-test-result.html?testId=${encodeURIComponent(testId)}`
    };
    state.entranceTests.push(test);
    return jsonFulfill(route, {
      success: true,
      testId,
      testLink: test.testLink,
      resultLink: test.resultLink
    });
  }

  if (/^\/api\/admin\/leads\/[^/]+\/entrance-tests$/i.test(pathname) && method === 'GET') {
    const leadId = pathname.split('/')[4];
    return jsonFulfill(route, {
      success: true,
      tests: state.entranceTests
        .filter((test) => String(test.leadId || '') === leadId)
        .map(mapEntranceTestForAdmin)
    });
  }

  if (/^\/api\/admin\/leads\/[^/]+\/convert$/i.test(pathname) && method === 'POST') {
    const leadId = pathname.split('/')[4];
    const lead = state.leads.find((row) => String(row.leadId || '') === leadId);
    if (!lead) return jsonFulfill(route, { success: false, message: 'Lead not found.' }, 404);
    const student = buildStudentFromLead(state, lead);
    lead.stage = 'converted';
    lead.studentId = student.studentId;
    state.entranceTests
      .filter((test) => String(test.leadId || '') === leadId)
      .forEach((test) => {
        test.studentId = student.studentId;
        test.crmId = student.crmId;
      });
    return jsonFulfill(route, { success: true, lead, student });
  }

  if (/^\/api\/admin\/leads\/[^/]+$/i.test(pathname) && method === 'PATCH') {
    const leadId = pathname.split('/').pop();
    const lead = state.leads.find((row) => String(row.leadId || '') === leadId);
    if (!lead) return jsonFulfill(route, { success: false, message: 'Lead not found.' }, 404);
    Object.assign(lead, body || {});
    return jsonFulfill(route, { success: true, lead });
  }

  if (pathname === '/api/admin/students' && method === 'GET') {
    return jsonFulfill(route, { success: true, students: state.students });
  }

  if (/^\/api\/admin\/students\/[^/]+\/entrance-tests$/i.test(pathname) && method === 'GET') {
    const studentId = pathname.split('/')[4];
    return jsonFulfill(route, {
      success: true,
      tests: state.entranceTests
        .filter((test) => String(test.studentId || '') === studentId)
        .map(mapEntranceTestForAdmin)
    });
  }

  if (/^\/api\/admin\/students\/[^/]+$/i.test(pathname) && method === 'GET') {
    const studentId = pathname.split('/').pop();
    const student = state.students.find((row) => String(row.studentId || row.id || '') === studentId);
    return jsonFulfill(route, student
      ? { success: true, student }
      : { success: false, message: 'Student not found.' }, student ? 200 : 404);
  }

  if (pathname === '/api/admin/courses' && method === 'GET') {
    return jsonFulfill(route, { success: true, courses: state.courses });
  }

  if (pathname === '/api/admin/courses' && method === 'POST') {
    const course = createCourse(state, body || {});
    return jsonFulfill(route, { success: true, courseId: course.courseId, course });
  }

  if (/^\/api\/admin\/courses\/[^/]+$/i.test(pathname) && method === 'PATCH') {
    const courseId = pathname.split('/').pop();
    const course = state.courses.find((row) => String(row.courseId || row.id || '') === courseId);
    if (!course) return jsonFulfill(route, { success: false, message: 'Course not found.' }, 404);
    Object.assign(course, body || {});
    return jsonFulfill(route, { success: true, courseId, course });
  }

  if (pathname === '/api/admin/teachers' && method === 'GET') {
    return jsonFulfill(route, { success: true, teachers: state.teachers, count: state.teachers.length });
  }

  if (pathname === '/api/admin/classrooms' && method === 'GET') {
    return jsonFulfill(route, { success: true, classrooms: state.classrooms });
  }

  if (pathname === '/api/admin/classrooms' && method === 'POST') {
    const classroom = createClassroom(state, body || {});
    return jsonFulfill(route, { success: true, classroomId: classroom.classroomId, classroom });
  }

  if (/^\/api\/admin\/classrooms\/[^/]+$/i.test(pathname) && method === 'PATCH') {
    const classroomId = pathname.split('/').pop();
    const classroom = updateClassroom(state, classroomId, body || {});
    return jsonFulfill(route, classroom
      ? { success: true, classroomId, classroom }
      : { success: false, message: 'Classroom not found.' }, classroom ? 200 : 404);
  }

  if (/^\/api\/admin\/classrooms\/[^/]+\/modules$/i.test(pathname) && method === 'GET') {
    return jsonFulfill(route, { success: true, modules: [] });
  }

  if (/^\/api\/admin\/classrooms\/[^/]+\/classwork$/i.test(pathname) && method === 'GET') {
    return jsonFulfill(route, { success: true, classwork: [] });
  }

  if (pathname === '/api/admin/scheduler/workspace' && method === 'GET') {
    return jsonFulfill(route, {
      success: true,
      classrooms: state.classrooms,
      sessions: state.sessions
    });
  }

  if (/^\/api\/admin\/classrooms\/[^/]+\/sessions\/seed$/i.test(pathname) && method === 'POST') {
    return jsonFulfill(route, { success: false, error: 'NOT_EXPECTED', message: 'Schedule setup should not auto-seed.' }, 500);
  }

  if (pathname === '/api/practice-attempts' && method === 'GET') {
    return jsonFulfill(route, { success: true, attempts: [] });
  }

  if (pathname === '/api/admin/finance/summary' && method === 'GET') {
    return jsonFulfill(route, {
      success: true,
      totalInvoiced: 0,
      totalPaid: 0,
      totalOutstanding: 0,
      nextDueDate: '-',
      invoices: [],
      currencyTotals: []
    });
  }

  if (pathname === '/api/admin/attendance/summary' && method === 'GET') {
    return jsonFulfill(route, { success: true, students: [] });
  }

  if (/^\/api\/admin\/students\/[^/]+\/classroom-matches$/i.test(pathname) && method === 'GET') {
    return jsonFulfill(route, { success: true, matches: [], recommendedClassroom: null, classroomCount: 0 });
  }

  if (pathname.startsWith('/api/admin/')) {
    return jsonFulfill(route, buildDefaultApiResponse());
  }

  if (pathname.startsWith('/api/')) {
    return jsonFulfill(route, buildDefaultApiResponse());
  }

  return route.fulfill({
    status: 404,
    contentType: 'text/plain; charset=utf-8',
    body: 'Not found'
  });
}

function serveLocalAsset(route, url) {
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const localPath = path.join(PUBLIC_DIR, relativePath);

  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
    return route.fulfill({
      status: pathname === '/favicon.ico' ? 204 : 404,
      contentType: 'text/plain; charset=utf-8',
      body: ''
    });
  }

  return route.fulfill({
    status: 200,
    contentType: contentTypeFor(localPath),
    body: fs.readFileSync(localPath)
  });
}

async function waitForRequest(requestLog, predicate, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const found = requestLog.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function main() {
  const state = createHarnessState();
  const requestLog = [];
  const consoleErrors = [];
  const pageErrors = [];
  fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
  const agentSourceScreenshotPath = path.join('tmp', 'crm-agent-source-browser-check.png');
  const secondLeadScreenshotPath = path.join('tmp', 'crm-second-new-lead-browser-check.png');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1200 },
      locale: 'en-US'
    });
    await context.addInitScript(buildClipboardStubScript());

    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());

      if (url.hostname === 'betterenglishlearning.com') {
        if (url.pathname.startsWith('/api/')) {
          return routeApi(route, url, state, requestLog);
        }
        return serveLocalAsset(route, url);
      }

      if (url.hostname === 'www.gstatic.com' && /firebasejs/.test(url.pathname)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript; charset=utf-8',
          body: buildFirebaseStubScript()
        });
      }

      if (url.hostname === 'fonts.googleapis.com') {
        return route.fulfill({
          status: 200,
          contentType: 'text/css; charset=utf-8',
          body: '/* browser test font stub */'
        });
      }

      if (url.hostname === 'fonts.gstatic.com' || url.hostname === 'apis.google.com') {
        return route.fulfill({ status: 204, contentType: 'text/plain; charset=utf-8', body: '' });
      }

      if (url.hostname.endsWith('firebaseapp.com') || url.hostname.endsWith('firebaseio.com') || url.hostname.endsWith('googleusercontent.com')) {
        return route.fulfill({ status: 204, contentType: 'text/plain; charset=utf-8', body: '' });
      }

      return route.fulfill({ status: 204, contentType: 'text/plain; charset=utf-8', body: '' });
    });

    const page = await context.newPage();
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure();
      consoleErrors.push(`${failure?.errorText || 'requestfailed'}: ${request.url()}`);
    });

    await page.goto(AGENTS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#agent-sources-list .crm-agent-source-card[data-agent-source-id="agent-source-1"]');
    await page.click('#agent-sources-list .crm-agent-source-card[data-agent-source-id="agent-source-1"]');
    await page.waitForFunction(() => document.getElementById('agent-source-name')?.value === 'Referral Team');
    assert.strictEqual(await page.inputValue('#agent-source-name'), 'Referral Team');
    assert.strictEqual(await page.textContent('#btn-create-agent-source'), 'Update Agent Source');
    assert.strictEqual(
      await page.$eval('#agent-sources-list .crm-agent-source-card[data-agent-source-id="agent-source-1"]', (el) => el.classList.contains('active')),
      true
    );
    assert.strictEqual(await page.evaluate(() => document.activeElement?.id || ''), 'agent-source-name');
    await page.screenshot({ path: agentSourceScreenshotPath });
    console.log(`Screenshot saved to ${agentSourceScreenshotPath}`);

    await page.goto(ENQUIRY_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#lead-list-container');

    assert.strictEqual(
      await page.locator('#student-info #lead-entrance-test-section').count(),
      1,
      'Lead entrance-test controls must live inside the shared student Info tab.'
    );
    assert.strictEqual(
      await page.locator('#lead-workspace #lead-entrance-test-section').count(),
      0,
      'Lead entrance-test controls must not remain in the page-level workspace.'
    );

    await page.click('#btn-new-lead');
    await page.waitForSelector('#crm-student-modal', { state: 'visible' });
    assert.strictEqual(await page.isDisabled('#btn-add-lead-entrance-test'), true);
    await page.fill('#lead-name', 'Lead One');
    await page.fill('#lead-email', 'lead.one@example.com');
    await page.fill('#lead-phone', '0900000001');
    await page.fill('#lead-facebook', 'Lead FB Account');
    await page.selectOption('#lead-source', 'Facebook - Personal');
    await page.selectOption('#lead-facebook-personal-owner', 'Nam');
    await page.click('#btn-save-lead');
    await page.waitForSelector('.crm-lead-link[data-lead-id="lead-1"]');
    await page.waitForFunction(() => document.getElementById('crm-student-modal')?.getAttribute('aria-hidden') === 'false');
    assert.strictEqual(await page.textContent('#crm-student-modal-title'), 'Edit Lead Profile');
    assert.strictEqual(await page.isDisabled('#btn-add-lead-entrance-test'), false);

    const leadCreateRequest = await waitForRequest(
      requestLog,
      (entry) => entry.path === '/api/admin/leads' && entry.method === 'POST',
      'Expected lead create request.'
    );
    assert.strictEqual(leadCreateRequest.body.name, 'Lead One');
    assert.strictEqual(leadCreateRequest.body.source, 'Facebook - Personal');
    assert.strictEqual(leadCreateRequest.body.facebookPersonalOwner, 'Nam');

    await page.selectOption('#lead-entrance-test-type', 'segmental_screening_v1');
    await page.click('#btn-add-lead-entrance-test');
    await page.waitForFunction(() => /token-test-1/.test(document.getElementById('lead-entrance-test-link')?.value || ''));
    await page.waitForFunction(() => /created/i.test(document.getElementById('lead-entrance-tests-list')?.textContent || ''));
    assert.strictEqual(await page.locator('#lead-workspace').isVisible(), false);

    const testCreateRequest = await waitForRequest(
      requestLog,
      (entry) => entry.path === '/api/admin/leads/lead-1/entrance-tests' && entry.method === 'POST',
      'Expected lead entrance-test create request.'
    );
    assert.strictEqual(testCreateRequest.body.testType, 'segmental_screening_v1');

    await page.click('#btn-close-student-modal');
    await page.waitForSelector('#crm-student-modal', { state: 'hidden' });
    await page.click('.crm-lead-link[data-lead-id="lead-1"]');
    await page.waitForSelector('#crm-student-modal', { state: 'visible' });
    assert.strictEqual(await page.textContent('#crm-student-modal-title'), 'Edit Lead Profile');
    assert.strictEqual(await page.inputValue('#lead-name'), 'Lead One');
    await page.fill('#lead-name', 'Lead One Updated');
    await page.click('#btn-save-lead');
    await page.waitForSelector('#crm-student-modal', { state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.crm-lead-link[data-lead-id="lead-1"]')?.textContent === 'Lead One Updated');

    await page.evaluate(() => {
      document.getElementById('lead-composer').style.display = 'none';
      document.getElementById('crm-student-modal-title').textContent = 'New Student Profile';
      document.querySelector('#crm-student-modal .crm-modal-content').scrollTop = 600;
    });
    await page.click('#btn-new-lead');
    await page.waitForSelector('#crm-student-modal', { state: 'visible' });
    assert.strictEqual(await page.textContent('#crm-student-modal-title'), 'New Lead Profile');
    assert.strictEqual(await page.locator('#lead-composer').isVisible(), true, 'Opening another new lead must restore the full lead Info form.');
    assert.strictEqual(await page.locator('#lead-name').isVisible(), true);
    assert.strictEqual(await page.inputValue('#lead-name'), '');
    assert.strictEqual(await page.inputValue('#lead-source'), '', 'Opening a new lead must require an explicit source choice.');
    assert.strictEqual(
      await page.locator('#crm-student-modal .crm-modal-content').evaluate((element) => element.scrollTop),
      0,
      'Opening another new lead must reset the Info modal to the top.'
    );
    assert.strictEqual(await page.locator('#btn-save-lead').isVisible(), true);
    assert.strictEqual(await page.locator('#btn-save-student').isVisible(), false);
    const leadCreateCountBeforeBlankSave = requestLog.filter((entry) => entry.path === '/api/admin/leads' && entry.method === 'POST').length;
    await page.click('#btn-save-lead');
    await page.waitForFunction(() => /source is required/i.test(document.querySelector('.crm-toast')?.textContent || ''));
    assert.strictEqual(
      requestLog.filter((entry) => entry.path === '/api/admin/leads' && entry.method === 'POST').length,
      leadCreateCountBeforeBlankSave,
      'Blank source must not create a lead.'
    );
    assert.strictEqual(await page.evaluate(() => document.activeElement?.id || ''), 'lead-source', 'Blank source rejection must focus the source field.');
    await page.selectOption('#lead-source', 'Zalo - Personal');
    await page.click('#crm-student-modal .crm-sidebar-item[data-tab="learning"]');
    await page.fill('#score-overall', '79');
    await page.fill('#score-listening', '78');
    await page.fill('#score-reading', '77');
    await page.fill('#score-speaking', '76');
    await page.fill('#score-writing', '75');
    await page.click('#btn-save-lead');
    await page.waitForFunction(() => document.getElementById('btn-add-lead-entrance-test')?.disabled === false);
    await page.click('#crm-student-modal .crm-sidebar-item[data-tab="info"]');
    await page.click('#btn-add-lead-entrance-test');
    await page.waitForFunction(() => /token-test-2/.test(document.getElementById('lead-entrance-test-link')?.value || ''));
    await page.click('#btn-close-student-modal');
    await page.waitForSelector('#crm-student-modal', { state: 'hidden' });
    await page.click('.crm-lead-link[data-lead-id="lead-2"]');
    await page.waitForSelector('#crm-student-modal', { state: 'visible' });
    await page.click('#crm-student-modal .crm-sidebar-item[data-tab="learning"]');
    assert.strictEqual(await page.inputValue('#score-overall'), '79');
    assert.strictEqual(await page.inputValue('#score-listening'), '78');
    assert.strictEqual(await page.inputValue('#score-reading'), '77');
    assert.strictEqual(await page.inputValue('#score-speaking'), '76');
    assert.strictEqual(await page.inputValue('#score-writing'), '75');
    await page.locator('#crm-student-modal').screenshot({ path: secondLeadScreenshotPath });
    console.log(`Screenshot saved to ${secondLeadScreenshotPath}`);
    await page.click('#btn-close-student-modal');
    await page.waitForSelector('#crm-student-modal', { state: 'hidden' });

    const submitHarnessResult = await page.evaluate(() => fetch('/api/test-harness/submit-lead-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: 'lead-1' })
    }).then((res) => res.json()));
    assert.strictEqual(submitHarnessResult.success, true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.crm-lead-link[data-lead-id="lead-1"]');
    await page.waitForFunction(() => {
      const select = document.querySelector('.lead-stage-select[data-lead-id="lead-1"]');
      return !!select && select.value === 'test_completed';
    });
    await page.click('.crm-lead-link[data-lead-id="lead-1"]');
    await page.waitForSelector('#crm-student-modal', { state: 'visible' });
    await page.click('#crm-student-modal .crm-sidebar-item[data-tab="learning"]');
    await page.waitForFunction(() => /token-test-1/.test(document.getElementById('lead-entrance-test-link')?.value || ''));
    assert(
      /already been used/i.test(await page.textContent('#lead-entrance-test-link-note')),
      'Submitted test links should remain visible while clearly marked as used.'
    );
    await page.click('#btn-close-student-modal');
    await page.waitForSelector('#crm-student-modal', { state: 'hidden' });

    await page.click('.btn-convert-lead[data-lead-id="lead-1"]');
    await page.waitForSelector('#crm-student-modal', { state: 'visible' });
    await page.waitForFunction(() => (document.getElementById('lead-name') || document.getElementById('student-name'))?.value === 'Lead One Updated');
    await page.click('#crm-student-modal .crm-sidebar-item[data-tab="learning"]');
    await page.waitForFunction(() => /submitted/i.test(document.getElementById('entrance-tests-list')?.textContent || ''));

    const convertRequest = await waitForRequest(
      requestLog,
      (entry) => entry.path === '/api/admin/leads/lead-1/convert' && entry.method === 'POST',
      'Expected lead convert request.'
    );
    assert.ok(convertRequest);
    assert.strictEqual(state.students[0].leadId, 'lead-1');
    assert.strictEqual(state.students[0].crmId, 'a0001');
    assert.strictEqual(state.students[0].agentSourceId, null);
    assert.strictEqual(state.entranceTests[0].studentId, 'student-1');

    await page.goto(COURSES_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btn-new-course');
    await page.click('#btn-new-course');
    await page.waitForSelector('#crm-course-modal', { state: 'visible' });
    await page.fill('#course-name', 'PTE Foundation');
    await page.fill('#course-code', 'PTE-FND');
    await page.fill('#course-agent-commission-percent', '12.5');
    await page.fill('#course-total-hours', '24');
    await page.fill('#course-default-session-minutes', '90');
    await page.fill('#course-duration-step', '30');
    await page.fill('#course-timezone', 'Asia/Bangkok');
    await page.click('#btn-save-course');

    const courseCreateRequest = await waitForRequest(
      requestLog,
      (entry) => entry.path === '/api/admin/courses' && entry.method === 'POST',
      'Expected course create request.'
    );
    assert.strictEqual(courseCreateRequest.body.agentCommissionBps, 1250);
    assert.strictEqual(courseCreateRequest.body.deliveryTemplate.totalInstructionMinutes, 1440);
    assert.strictEqual(courseCreateRequest.body.deliveryTemplate.defaultSessionMinutes, 90);
    await page.waitForFunction(() => !!document.querySelector('.crm-course-link[data-course-id="course-1"]'));

    await page.evaluate(() => {
      const button = document.querySelector('.crm-course-link[data-course-id="course-1"]');
      if (button) button.click();
    });
    await page.waitForSelector('#crm-course-modal', { state: 'visible' });
    assert.strictEqual(await page.inputValue('#course-agent-commission-percent'), '12.5');
    await page.click('#btn-close-course-modal');

    await page.goto(CLASS_MANAGEMENT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btn-new-classroom');
    await page.click('#btn-new-classroom');
    await page.waitForSelector('#crm-classroom-modal', { state: 'visible' });
    await page.fill('#classroom-name', 'PTE Foundation Evening');
    await page.selectOption('#classroom-course-id', 'course-1');
    await page.selectOption('#classroom-status', 'active');
    await page.click('#crm-classroom-modal .crm-sidebar-item[data-tab="scheduling"]');
    await page.waitForSelector('#classroom-teacher-search', { state: 'visible' });
    await page.fill('#classroom-total-hours', '24');
    await page.fill('#classroom-session-minutes', '90');
    await page.fill('#classroom-schedule-timezone', 'Asia/Bangkok');
    await page.fill('#classroom-seed-start-date', '2026-06-02');
    await page.fill('#classroom-seed-start-time', '18:30');
    await page.click('#classroom-seed-weekdays-selector .crm-weekday-btn[data-day="tue"]');
    await page.click('#classroom-seed-weekdays-selector .crm-weekday-btn[data-day="thu"]');
    await page.evaluate(() => {
      const hidden = document.getElementById('classroom-primary-teacher');
      const search = document.getElementById('classroom-teacher-search');
      if (hidden) hidden.value = 'teacher-1';
      if (search) search.value = 'Teacher One';
    });
    await page.click('#btn-save-classroom-scheduling');
    await page.waitForSelector('#class-management-grid .crm-classroom-link[data-classroom-id="class-1"]');

    const classroomCreateRequest = await waitForRequest(
      requestLog,
      (entry) => entry.path === '/api/admin/classrooms' && entry.method === 'POST',
      'Expected classroom create request.'
    );
    assert.strictEqual(classroomCreateRequest.body.name, 'PTE Foundation Evening');
    assert.strictEqual(classroomCreateRequest.body.courseId, 'course-1');
    assert.strictEqual(classroomCreateRequest.body.status, 'active');
    assert.strictEqual(classroomCreateRequest.body.primaryTeacherUid, 'teacher-1');
    assert.strictEqual(classroomCreateRequest.body.scheduleConfig.totalInstructionMinutes, 1440);
    assert.strictEqual(classroomCreateRequest.body.scheduleConfig.sessionMinutes, 90);
    assert.strictEqual(classroomCreateRequest.body.scheduleConfig.timezone, 'Asia/Bangkok');
    assert.strictEqual(classroomCreateRequest.body.scheduleConfig.seedStartDate, '2026-06-02');
    assert.strictEqual(classroomCreateRequest.body.scheduleConfig.seedStartTime, '18:30');
    assert.deepStrictEqual(classroomCreateRequest.body.scheduleConfig.seedWeekdays, ['tue', 'thu']);

    await page.goto(CLASSES_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#scheduler-class-list .scheduler-class-card[data-classroom-id="class-1"]');
    assert.ok(
      !requestLog.some((entry) => /\/sessions\/seed$/i.test(entry.path)),
      'Saving scheduling setup should not seed sessions automatically.'
    );

    assert.strictEqual(pageErrors.length, 0, `Unexpected page errors:\n${pageErrors.join('\n')}`);
    assert.strictEqual(consoleErrors.length, 0, `Unexpected console errors:\n${consoleErrors.join('\n')}`);

    console.log('crm admin workflow browser check passed');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
