const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const html = read('public/crm-admin.html');
const js = read('public/crm-admin.js');
const authUi = read('public/auth-ui.js');
const teacherProfile = read('public/js/crm/teacher-profile.js');

const htmlEntrance = read('public/crm-entrance-test-result.html');
const jsEntrance = read('public/crm-entrance-test-result.js');

// 1. Static checks on markup & script attributes
assert(
  html.includes("localStorage.getItem('crm_auth_session')"),
  'crm-admin.html head script must inspect localStorage for crm_auth_session'
);
assert(
  html.includes("sessionStorage.getItem('crm_auth_session')"),
  'crm-admin.html head script must retain fallback to sessionStorage'
);
assert(
  html.includes('s.teacherOk || s.projectsAuthorized'),
  'crm-admin.html head script must recognize teacherOk and projectsAuthorized flags directly'
);
assert(
  html.includes('window.__FIREBASE_CONFIG__ = {'),
  'crm-admin.html must inline client Firebase config'
);
assert(
  html.includes('firebase-app-compat.js" defer></script>'),
  'firebase-app-compat.js script must have defer'
);
assert(
  html.includes('crm-admin.js?v=20260917-v2.0.10" defer></script>'),
  'crm-admin.js script must have defer'
);

// 1b. Static checks on crm-entrance-test-result.html
assert(
  htmlEntrance.includes("localStorage.getItem('crm_auth_session')"),
  'crm-entrance-test-result.html must inspect localStorage for crm_auth_session'
);
assert(
  htmlEntrance.includes('html.crm-session-cached #crm-loading { display: none !important; }'),
  'crm-entrance-test-result.html must include inline fast-pass style rule'
);
assert(
  htmlEntrance.includes('window.__FIREBASE_CONFIG__ = {'),
  'crm-entrance-test-result.html must inline client Firebase config'
);
assert(
  htmlEntrance.includes('firebase-app-compat.js" defer></script>'),
  'crm-entrance-test-result.html firebase script must have defer'
);
assert(
  htmlEntrance.includes('crm-entrance-test-result.js?v=20260917-v2.0.10" defer></script>'),
  'crm-entrance-test-result.html script must have defer'
);

// 2. Checks on crm-admin.js & crm-entrance-test-result.js
assert(
  js.includes('nullGraceMs: 1500'),
  'crm-admin.js must restore nullGraceMs to 1500ms to prevent false logouts'
);
assert(
  jsEntrance.includes('nullGraceMs: 1500'),
  'crm-entrance-test-result.js must use nullGraceMs of 1500ms to prevent false logouts'
);
assert(
  js.includes('function readCrmAuthSession()') &&
  js.includes('function writeCrmAuthSession(') &&
  js.includes('function clearCrmAuthSession()'),
  'crm-admin.js must define centralized cross-tab session storage helpers'
);
assert(
  js.includes("document.readyState === 'loading'") &&
  jsEntrance.includes("document.readyState === 'loading'"),
  'Both CRM scripts must handle already-loaded document.readyState gracefully'
);

// 3. Checks on auth-ui.js & teacher-profile.js
assert(
  authUi.includes("localStorage.setItem('crm_auth_session', sessionPayload)") &&
  authUi.includes("localStorage.removeItem('crm_auth_session')"),
  'auth-ui.js must persist and remove crm_auth_session in localStorage'
);
assert(
  teacherProfile.includes("localStorage.removeItem('crm_auth_session')"),
  'teacher-profile.js logout must remove crm_auth_session from localStorage'
);

// 4. Behavioral simulation of the head script
const headScriptMatch = html.match(/<head>[\s\S]*?<script>([\s\S]*?)<\/script>/);
assert(headScriptMatch, 'Head script must be present');
const headScriptCode = headScriptMatch[1];

function runHeadScript(storageMock) {
  const classList = new Set();
  const sandbox = {
    localStorage: {
      getItem: (key) => storageMock.localStorage?.[key] || null
    },
    sessionStorage: {
      getItem: (key) => storageMock.sessionStorage?.[key] || null
    },
    document: {
      documentElement: {
        classList: {
          add: (cls) => classList.add(cls),
          contains: (cls) => classList.has(cls)
        }
      }
    },
    Date: {
      now: () => storageMock.now || 1000000
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(headScriptCode, sandbox);
  return classList.has('crm-session-cached');
}

// Case A: Fresh tab, localStorage has valid session (< 30 min)
const validSession = JSON.stringify({
  uid: 'u-admin-1',
  adminOk: true,
  accessMode: 'admin',
  timestamp: 1000000 - 5 * 60 * 1000 // 5 minutes ago
});
assert.strictEqual(
  runHeadScript({ localStorage: { crm_auth_session: validSession }, sessionStorage: {}, now: 1000000 }),
  true,
  'Valid session in localStorage on fresh tab MUST add crm-session-cached class instantly'
);

// Case B: Expired session in localStorage (> 30 min)
const expiredSession = JSON.stringify({
  uid: 'u-admin-1',
  adminOk: true,
  accessMode: 'admin',
  timestamp: 1000000 - 35 * 60 * 1000 // 35 minutes ago
});
assert.strictEqual(
  runHeadScript({ localStorage: { crm_auth_session: expiredSession }, sessionStorage: {}, now: 1000000 }),
  false,
  'Expired session in localStorage must NOT add crm-session-cached class'
);

// Case C: Empty localStorage, but valid sessionStorage (fallback works)
assert.strictEqual(
  runHeadScript({ localStorage: {}, sessionStorage: { crm_auth_session: validSession }, now: 1000000 }),
  true,
  'Fallback to valid sessionStorage must add crm-session-cached class'
);

// Case D: Unauthorized user role
const studentSession = JSON.stringify({
  uid: 'u-student-1',
  adminOk: false,
  accessMode: 'student',
  timestamp: 1000000 - 5 * 60 * 1000
});
assert.strictEqual(
  runHeadScript({ localStorage: { crm_auth_session: studentSession }, sessionStorage: {}, now: 1000000 }),
  false,
  'Unauthorized student role must NOT add crm-session-cached class'
);

// Case E: Teacher role with teacherOk: true
const teacherSession = JSON.stringify({
  uid: 'u-teacher-1',
  adminOk: false,
  teacherOk: true,
  accessMode: 'unknown',
  timestamp: 1000000 - 5 * 60 * 1000
});
assert.strictEqual(
  runHeadScript({ localStorage: { crm_auth_session: teacherSession }, sessionStorage: {}, now: 1000000 }),
  true,
  'Teacher session with teacherOk flag must add crm-session-cached class'
);

// Case F: Project role with projectsAuthorized: true
const projectSession = JSON.stringify({
  uid: 'u-project-1',
  adminOk: false,
  teacherOk: false,
  projectsAuthorized: true,
  accessMode: 'unknown',
  timestamp: 1000000 - 5 * 60 * 1000
});
assert.strictEqual(
  runHeadScript({ localStorage: { crm_auth_session: projectSession }, sessionStorage: {}, now: 1000000 }),
  true,
  'Project session with projectsAuthorized flag must add crm-session-cached class'
);

console.log('CRM auth session storage cross-tab test passed successfully!');
