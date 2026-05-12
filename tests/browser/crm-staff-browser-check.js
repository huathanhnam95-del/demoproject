const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const BASE_ORIGIN = 'https://betterenglishlearning.com';
const STAFF_URL = `${BASE_ORIGIN}/crm-admin.html#staff`;
const CLASS_MANAGEMENT_URL = `${BASE_ORIGIN}/crm-admin.html#courses/class-management`;

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
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

    const firestoreDoc = () => ({
      get: async () => ({ exists: false, data: () => null }),
      set: async () => {},
      update: async () => {},
      delete: async () => {},
      collection() {
        return firestoreCollection();
      }
    });

    function firestoreSnapshot() {
      return { empty: true, docs: [], forEach() {} };
    }

    function firestoreCollection() {
      const chain = {
        doc() { return firestoreDoc(); },
        where() { return chain; },
        orderBy() { return chain; },
        limit() { return chain; },
        get: async () => firestoreSnapshot(),
        add: async () => ({ id: 'doc-1' })
      };
      return chain;
    }

    const firestore = {
      collection() {
        return firestoreCollection();
      },
      FieldValue: {
        serverTimestamp: () => new Date()
      }
    };

    const authState = {
      currentUser,
      onAuthStateChanged(callback) {
        setTimeout(() => callback(currentUser), 0);
        return () => {};
      }
    };

    window.firebase = window.firebase || {};
    window.firebase.apps = window.firebase.apps || [];
    window.firebase.initializeApp = window.firebase.initializeApp || function initializeApp(config) {
      window.firebase.apps.push(config);
      window.firebase._config = config;
      return window.firebase;
    };
    window.firebase.auth = window.firebase.auth || function auth() {
      return authState;
    };
    window.firebase.firestore = window.firebase.firestore || function firestoreFactory() {
      return firestore;
    };
    window.firebase.storage = window.firebase.storage || function storage() {
      return {
        ref() {
          return {
            put: async () => ({})
          };
        }
      };
    };
  })();`;
}

function buildClipboardStubScript() {
  return `(function () {
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__clipboardText = String(text || '');
          }
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
    summary: {},
    funnel: {},
    revenue: [],
    duplicates: [],
    auditLogs: [],
    promptSummary: null,
    usageSummary: null,
    data: {}
  };
}

function createHarnessState() {
  return {
    nextTeacherId: 3,
    teachers: [
      { uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher.one@example.com' },
      { uid: 'teacher-2', displayName: 'Teacher Two', email: 'teacher.two@example.com' }
    ],
    courses: [
      {
        id: 'course-1',
        courseId: 'course-1',
        name: 'PTE Academic Tutoring',
        code: 'PTE-A-Tutor',
        status: 'active',
        teachers: ['teacher-1'],
        deliveryTemplate: {
          totalInstructionMinutes: 120,
          defaultSessionMinutes: 60,
          durationStepMinutes: 30,
          timezone: 'Asia/Bangkok'
        }
      }
    ],
    classrooms: [
      {
        classroomId: 'class-1',
        id: 'class-1',
        name: 'PTE 1-1 Bui Thanh Phong',
        courseId: 'course-1',
        status: 'active',
        primaryTeacherUid: 'teacher-1',
        scheduleConfig: {
          totalInstructionMinutes: 120,
          sessionMinutes: 60,
          targetSessionCount: 2,
          timezone: 'Asia/Bangkok',
          allowedStartTime: '07:00',
          allowedEndTime: '21:00',
          planningStatus: 'seeded',
          durationStepMinutes: 30,
          scheduleVersion: 1
        },
        scheduleSummary: null
      }
    ],
    moduleMap: {
      'class-1': []
    },
    classworkMap: {
      'class-1': []
    }
  };
}

function updateClassroomFromPayload(state, classroomId, payload) {
  const classroom = state.classrooms.find((entry) => String(entry.classroomId || entry.id || '') === String(classroomId || ''));
  if (!classroom) return null;

  classroom.name = String(payload?.name || classroom.name || '').trim();
  classroom.courseId = String(payload?.courseId || classroom.courseId || '').trim();
  classroom.status = String(payload?.status || classroom.status || 'draft').trim();
  classroom.primaryTeacherUid = String(payload?.primaryTeacherUid || classroom.primaryTeacherUid || '').trim();
  classroom.scheduleConfig = {
    ...(classroom.scheduleConfig || {}),
    ...(payload?.scheduleConfig || {}),
    scheduleVersion: Number(classroom.scheduleConfig?.scheduleVersion || 1) + 1
  };
  classroom.scheduleSummary = classroom.scheduleSummary || null;
  return classroom;
}

async function routeApi(route, url, state, requestLog) {
  const request = route.request();
  const method = request.method();
  const pathname = url.pathname;
  const body = method === 'GET' || method === 'HEAD' ? null : parseBody(request);
  requestLog.push({ method, path: pathname, body });

  if (pathname === '/api/config') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        config: {
          apiKey: 'browser-test-api-key',
          authDomain: 'betterenglishlearning.com',
          projectId: 'browser-test-project',
          storageBucket: 'browser-test-project.appspot.com',
          appId: '1:1234567890:web:browser-test'
        }
      })
    });
  }

  if (pathname === '/api/admin/status') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ success: true, isAdmin: true })
    });
  }

  if (pathname === '/api/admin/teachers' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        teachers: state.teachers,
        count: state.teachers.length
      })
    });
  }

  if (pathname === '/api/admin/teachers' && method === 'POST') {
    const uid = `teacher-${state.nextTeacherId++}`;
    const teacher = {
      uid,
      email: String(body?.email || '').trim(),
      displayName: String(body?.displayName || '').trim() || String(body?.email || '').trim()
    };
    state.teachers.push(teacher);
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        teacher,
        uid
      })
    });
  }

  if (pathname === '/api/admin/courses' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        courses: state.courses
      })
    });
  }

  if (pathname === '/api/admin/classrooms' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        classrooms: state.classrooms
      })
    });
  }

  if (/^\/api\/admin\/classrooms\/[^/]+$/i.test(pathname) && method === 'PATCH') {
    const classroomId = pathname.split('/').pop();
    const classroom = updateClassroomFromPayload(state, classroomId, body);
    return route.fulfill({
      status: classroom ? 200 : 404,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(classroom
        ? {
          success: true,
          classroomId,
          classroom
        }
        : {
          success: false,
          message: 'Classroom not found.'
        })
    });
  }

  if (/^\/api\/admin\/classrooms\/[^/]+\/modules$/i.test(pathname) && method === 'GET') {
    const classroomId = pathname.split('/')[4];
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        modules: state.moduleMap[classroomId] || []
      })
    });
  }

  if (/^\/api\/admin\/classrooms\/[^/]+\/classwork$/i.test(pathname) && method === 'GET') {
    const classroomId = pathname.split('/')[4];
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        classwork: state.classworkMap[classroomId] || []
      })
    });
  }

  if (pathname === '/api/admin/students' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        students: []
      })
    });
  }

  if (pathname === '/api/admin/leads' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        leads: []
      })
    });
  }

  if (pathname === '/api/admin/tasks' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        tasks: []
      })
    });
  }

  if (pathname === '/api/admin/activities' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        activities: []
      })
    });
  }

  if (pathname === '/api/admin/attendance/summary' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        students: []
      })
    });
  }

  if (pathname === '/api/admin/dashboard/summary' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        summary: {}
      })
    });
  }

  if (pathname === '/api/admin/dashboard/funnel' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        funnel: {}
      })
    });
  }

  if (pathname === '/api/admin/dashboard/revenue' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        revenue: []
      })
    });
  }

  if (pathname === '/api/admin/duplicates' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        duplicates: []
      })
    });
  }

  if (pathname === '/api/admin/audit-logs' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        auditLogs: []
      })
    });
  }

  if (pathname === '/api/admin/communications' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        communications: []
      })
    });
  }

  if (pathname === '/api/admin/read-aloud/prompt-summary' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        promptSummary: null
      })
    });
  }

  if (pathname === '/api/admin/read-aloud/usage-summary' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        usageSummary: null
      })
    });
  }

  if (pathname === '/api/admin/merge-jobs' && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        jobs: []
      })
    });
  }

  if (pathname.startsWith('/api/admin/sync-from-prod/')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        data: {}
      })
    });
  }

  if (pathname.startsWith('/api/admin/')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(buildDefaultApiResponse())
    });
  }

  if (pathname.startsWith('/api/')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(buildDefaultApiResponse())
    });
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

async function main() {
  const state = createHarnessState();
  const requestLog = [];
  const blockedRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
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

      if (url.hostname === 'fonts.gstatic.com') {
        return route.fulfill({
          status: 204,
          contentType: 'text/plain; charset=utf-8',
          body: ''
        });
      }

      if (url.hostname === 'apis.google.com') {
        return route.fulfill({
          status: 204,
          contentType: 'text/plain; charset=utf-8',
          body: ''
        });
      }

      if (url.hostname.endsWith('firebaseapp.com') || url.hostname.endsWith('firebaseio.com') || url.hostname.endsWith('googleusercontent.com')) {
        return route.fulfill({
          status: 204,
          contentType: 'text/plain; charset=utf-8',
          body: ''
        });
      }

      if (url.hostname === 'localhost' && url.port === '11434') {
        blockedRequests.push(url.href);
        return route.abort();
      }

      return route.fulfill({
        status: 204,
        contentType: 'text/plain; charset=utf-8',
        body: ''
      });
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
      const errorText = failure?.errorText || 'requestfailed';
      const url = request.url();
      if (/localhost:11434/i.test(url) || /sync-from-prod/i.test(url)) {
        blockedRequests.push(url);
      } else {
        consoleErrors.push(`${errorText}: ${url}`);
      }
    });

    await page.goto(STAFF_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#staff-teacher-list');
    await page.waitForFunction(() => {
      const badge = document.getElementById('ollama-status-badge');
      return !!badge && /Offline/i.test(badge.textContent || '');
    });

    assert.strictEqual(
      blockedRequests.filter((url) => /localhost:11434/i.test(url)).length,
      0,
      `Unexpected Ollama request on production-like origin: ${blockedRequests.join(', ')}`
    );
    assert.strictEqual(
      requestLog.filter((entry) => /sync-from-prod/i.test(entry.path)).length,
      0,
      `Unexpected sync-from-prod request on production-like origin: ${requestLog.filter((entry) => /sync-from-prod/i.test(entry.path)).map((entry) => entry.path).join(', ')}`
    );

    await page.waitForFunction(() => {
      const list = document.getElementById('staff-teacher-list');
      return !!list && /Teacher One/i.test(list.textContent || '') && /Teacher Two/i.test(list.textContent || '');
    });

    await page.fill('#staff-teacher-email', 'new.teacher@example.com');
    await page.fill('#staff-teacher-display-name', 'New Teacher');
    await page.click('#btn-staff-generate-password');
    await page.waitForFunction(() => {
      const input = document.getElementById('staff-teacher-password');
      return !!input && String(input.value || '').length >= 12;
    });

    const generatedPassword = await page.inputValue('#staff-teacher-password');
    assert.ok(generatedPassword.length >= 12, 'Expected a generated password.');

    await page.click('#btn-staff-toggle-password');
    assert.strictEqual(await page.getAttribute('#staff-teacher-password', 'type'), 'text');
    await page.click('#btn-staff-toggle-password');
    assert.strictEqual(await page.getAttribute('#staff-teacher-password', 'type'), 'password');

    await page.click('#btn-staff-copy-password');
    await page.waitForFunction((expected) => window.__clipboardText === expected, generatedPassword);

    const initialTeacherPostCount = requestLog.filter((entry) => entry.path === '/api/admin/teachers' && entry.method === 'POST').length;
    await page.click('#btn-staff-create-teacher');
    await page.waitForFunction((count) => {
      return document.querySelectorAll('#staff-teacher-list tbody tr').length > count;
    }, 2);

    await page.waitForFunction((expected) => {
      const list = document.getElementById('staff-teacher-list');
      return !!list && /New Teacher/i.test(list.textContent || '') && /new\.teacher@example\.com/i.test(list.textContent || '');
    });

    const teacherCreateRequest = requestLog.find((entry, index) =>
      entry.path === '/api/admin/teachers'
      && entry.method === 'POST'
      && index >= initialTeacherPostCount
    );
    assert.ok(teacherCreateRequest, 'Expected a teacher creation request.');
    assert.strictEqual(teacherCreateRequest.body.email, 'new.teacher@example.com');
    assert.strictEqual(teacherCreateRequest.body.displayName, 'New Teacher');
    assert.strictEqual(teacherCreateRequest.body.password, generatedPassword);

    await page.goto(CLASS_MANAGEMENT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#class-management-grid .crm-classroom-link[data-classroom-id="class-1"]');
    await page.click('#class-management-grid .crm-classroom-link[data-classroom-id="class-1"]');
    await page.waitForSelector('#crm-classroom-modal', { state: 'visible' });
    await page.fill('#classroom-name', 'PTE 1-1 Bui Thanh Phong (Updated)');
    await page.click('#crm-classroom-modal .crm-sidebar-item[data-tab="scheduling"]');
    await page.waitForSelector('#classroom-teacher-search', { state: 'visible' });

    await page.click('#classroom-teacher-search');
    await page.waitForSelector('#classroom-teacher-dropdown li[data-uid="teacher-1"]');

    await page.fill('#classroom-teacher-search', 'New Teacher');
    await page.waitForSelector('#classroom-teacher-dropdown li[data-uid^="teacher-"]');
    const dropdownItems = page.locator('#classroom-teacher-dropdown li[data-uid]');
    await dropdownItems.filter({ hasText: 'New Teacher' }).click();

    assert.strictEqual(await page.inputValue('#classroom-primary-teacher'), 'teacher-3');
    assert.match(await page.inputValue('#classroom-teacher-search'), /New Teacher/);
    const initialClassPatchCount = requestLog.filter((entry) => entry.path === '/api/admin/classrooms/class-1' && entry.method === 'PATCH').length;
    await page.click('#btn-save-classroom-settings');
    await page.waitForFunction((count) => {
      return document.querySelectorAll('#class-management-grid .crm-classroom-link[data-classroom-id="class-1"]').length === 1
        && /Updated/i.test(document.querySelector('#class-management-grid')?.textContent || '');
    }, initialClassPatchCount);

    const classroomPatchRequest = [...requestLog].reverse().find((entry) =>
      entry.path === '/api/admin/classrooms/class-1'
      && entry.method === 'PATCH'
    );
    assert.ok(classroomPatchRequest, 'Expected the classroom save request.');
    assert.strictEqual(classroomPatchRequest.body.name, 'PTE 1-1 Bui Thanh Phong (Updated)');
    assert.strictEqual(classroomPatchRequest.body.primaryTeacherUid, 'teacher-3');

    assert.strictEqual(consoleErrors.length, 0, `Unexpected console errors:\n${consoleErrors.join('\n')}`);
    assert.strictEqual(pageErrors.length, 0, `Unexpected page errors:\n${pageErrors.join('\n')}`);

    console.log('crm staff/class-management browser check passed');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
