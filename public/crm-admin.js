/**
 * CRM Admin
 * Admin-only shell for Student + Course management.
 * (Data + LMS features added later.)
 */

(function () {
  'use strict';

  const DEFAULT_ROUTE = { main: 'dashboard', sub: '' };

  const ROUTES = {
    dashboard: { label: 'Dashboard', subTabs: [] },
    students: {
      label: 'Student Management',
      subTabs: [
        { id: 'potential', label: 'Potential Students' },
        { id: 'data', label: 'Student Data' }
      ]
    },
    courses: {
      label: 'Courses & Classes',
      subTabs: [
        { id: 'courses', label: 'Courses' },
        { id: 'classes', label: 'Classes' },
        { id: 'zoom-links', label: 'Zoom Links' },
        { id: 'materials', label: 'Materials' },
        { id: 'planning', label: 'Planning' },
        { id: 'new-planning', label: 'New Planning' },
        { id: 'admission-calendar', label: 'Admission Calendar' },
        { id: 'class-management', label: 'Class Management' }
      ]
    },
    enquiry: { label: 'Enquiry', subTabs: [] },
    staff: { label: 'Staff Management', subTabs: [] },
    agents: { label: 'Agent Management', subTabs: [] },
    settings: { label: 'Settings', subTabs: [] },
    chatbot: { label: 'Chatbot Management', subTabs: [] }
  };

  const state = { ...DEFAULT_ROUTE };
  const elements = {};
  const modalState = {
    studentId: null,
    createdTestLinks: new Map(),
    courseId: null
  };

  document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    init().catch((e) => {
      console.error('[CRM Admin] Fatal init error:', e);
      showGateMessage('Initialization failed.', e?.message || 'Unknown error');
    });
  });

  function cacheElements() {
    elements.gate = document.getElementById('crm-loading');
    elements.gateText = document.getElementById('crm-loading-text');
    elements.gateSubtext = document.getElementById('crm-loading-subtext');
    // elements.userEmail = document.getElementById('crm-user-email'); // Old

    elements.navItems = Array.from(document.querySelectorAll('.crm-nav-item[data-main]'));
    elements.dropdownItems = Array.from(document.querySelectorAll('.crm-dropdown-menu button[data-sub]'));
    elements.panels = Array.from(document.querySelectorAll('.crm-panel[data-panel]'));
    elements.potentialStudentsContainer = document.querySelector('[data-panel="students/potential"] .crm-placeholder-card');
    elements.studentDataContainer = document.querySelector('[data-panel="students/data"] .crm-placeholder-card');

    // New Student Elements
    elements.btnNewStudentTriggers = Array.from(document.querySelectorAll('.btn-new-student-trigger'));
    elements.studentModal = document.getElementById('crm-student-modal');
    elements.btnCloseStudentModal = document.getElementById('btn-close-student-modal');
    elements.btnCancelStudent = document.getElementById('btn-cancel-student');
    elements.btnSaveStudent = document.getElementById('btn-save-student');
    elements.studentSidebarItems = elements.studentModal
      ? Array.from(elements.studentModal.querySelectorAll('.crm-sidebar-item[data-tab]'))
      : [];
    elements.studentTabContents = elements.studentModal
      ? Array.from(elements.studentModal.querySelectorAll('.crm-tab-content'))
      : [];

    // Student Info Inputs
    elements.inputStudentName = document.getElementById('student-name');
    elements.inputStudentLabel = document.getElementById('student-label');
    elements.inputStudentPhone = document.getElementById('student-phone');
    elements.inputStudentEmail = document.getElementById('student-email');
    elements.inputStudentZalo = document.getElementById('student-zalo');
    elements.inputStudentFacebook = document.getElementById('student-facebook');

    // Student ID Badge
    elements.studentIdBadge = document.getElementById('crm-student-id-badge');

    // Entrance Test UI (Learning Profile)
    elements.btnAddEntranceTest = document.getElementById('btn-add-entrance-test');
    elements.entranceTestLinkInput = document.getElementById('entrance-test-link');
    elements.btnCopyEntranceTestLink = document.getElementById('btn-copy-entrance-test-link');
    elements.entranceTestsList = document.getElementById('entrance-tests-list');

    // New Course Elements
    elements.btnNewCourseTriggers = Array.from(document.querySelectorAll('.btn-new-course-trigger'));
    elements.courseModal = document.getElementById('crm-course-modal');
    elements.btnCloseCourseModal = document.getElementById('btn-close-course-modal');
    elements.btnCancelCourse = document.getElementById('btn-cancel-course');
    elements.btnSaveCourse = document.getElementById('btn-save-course');
    elements.courseSidebarItems = elements.courseModal
      ? Array.from(elements.courseModal.querySelectorAll('.crm-sidebar-item[data-tab]'))
      : [];
    elements.courseTabContents = elements.courseModal
      ? Array.from(elements.courseModal.querySelectorAll('.crm-tab-content'))
      : [];
    elements.courseTeacherEmailInput = document.getElementById('course-teacher-email');
    elements.btnAddCourseTeacher = document.getElementById('btn-add-course-teacher');
    elements.courseTeachersList = document.getElementById('course-teachers-list');
    elements.inputCourseName = document.getElementById('course-name');
    elements.inputCourseCode = document.getElementById('course-code');
    elements.inputCourseLabel = document.getElementById('course-label');
    elements.inputCourseLevel = document.getElementById('course-level');
    elements.inputCourseCategory = document.getElementById('course-category');
    elements.inputCourseStatus = document.getElementById('course-status');
    elements.inputCourseDescription = document.getElementById('course-description');
  }

  async function init() {
    showGateMessage('Checking admin access…', 'Please wait');

    await initFirebaseFromServer();

    const user = await waitForAuthUser({ timeoutMs: 6500 });
    if (!user) {
      showGateMessage('Please log in as admin first.', 'Redirecting to the app…');
      setTimeout(() => (window.location.href = 'index.html'), 1800);
      return;
    }

    const adminOk = await isAdminUser(user);
    if (!adminOk) {
      showGateMessage('Access denied.', 'Admin privileges required.');
      setTimeout(() => (window.location.href = 'index.html'), 2200);
      return;
    }

    // Ready
    hideGate();
    setupTabs();
    applyRouteFromHash();
    render();

    refreshStudentLists().catch((e) => {
      console.error('[CRM Admin] Failed to load student lists:', e);
      showToast(e?.message || 'Failed to load student list.', 'error');
    });
  }

  async function initFirebaseFromServer() {
    const res = await fetch('/api/config', { cache: 'no-store' });
    const result = await res.json().catch(() => null);

    if (!res.ok || !result?.success || !result?.config?.apiKey) {
      const msg = result?.message || 'Could not fetch /api/config. Ensure the server is running.';
      throw new Error(msg);
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(result.config);
    }
  }

  function waitForAuthUser({ timeoutMs }) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, timeoutMs);

      const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(user || null);
      }, () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(null);
      });
    });
  }

  async function isAdminUser(user) {
    const serverOk = await isAdminViaServer(user);
    if (serverOk !== null) return serverOk;
    return isAdminViaFirestore(user?.uid);
  }

  async function isAdminViaServer(user) {
    try {
      if (!user?.getIdToken) return null;
      const idToken = await user.getIdToken();

      const res = await fetch('/api/admin/status', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${idToken}` },
        cache: 'no-store'
      });

      if (res.status === 404) return null;

      const result = await res.json().catch(() => null);
      return !!(res.ok && result?.success && result?.isAdmin);
    } catch (e) {
      return null;
    }
  }

  async function isAdminViaFirestore(uid) {
    if (!uid) return false;
    try {
      const snap = await firebase.firestore().collection('users').doc(uid).get();
      const data = snap.exists ? snap.data() : null;
      return !!data?.isAdmin;
    } catch (e) {
      console.warn('[CRM Admin] Failed to read user profile for isAdmin check:', e?.message || e);
      return false;
    }
  }

  function setupTabs() {
    // Main Nav Items
    elements.navItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextMain = btn.dataset.main;
        if (nextMain === 'courses') {
          // Courses is a dropdown parent, maybe do nothing or open first sub
          return;
        }
        state.main = nextMain;
        state.sub = (ROUTES[nextMain]?.subTabs[0]?.id) || '';
        updateHash();
        render();
      });
    });

    // Dropdown Items
    elements.dropdownItems.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextSub = btn.dataset.sub;
        // For simple routing, we assume parent is 'courses' if it's in a dropdown for now
        // In a real app, you'd find the closest .crm-nav-dropdown parent's data-main
        state.main = 'courses';
        state.sub = nextSub;
        updateHash();
        render();
      });
    });

    window.addEventListener('hashchange', () => {
      applyRouteFromHash();
      render();
    });

    setupStudentModal();
    setupCourseModal();
  }

  function setupStudentModal() {
    if (elements.btnNewStudentTriggers.length === 0) return;

    // Open Modal
    elements.btnNewStudentTriggers.forEach(btn => {
      btn.addEventListener('click', () => {
        elements.studentModal.style.display = 'flex';
        elements.studentModal.setAttribute('aria-hidden', 'false');
        resetStudentModal();
      });
    });

    // Close Modal Func
    const closeStudentModal = () => {
      elements.studentModal.style.display = 'none';
      elements.studentModal.setAttribute('aria-hidden', 'true');
      // Reset tabs to info
      switchStudentTab('info');
    };

    if (elements.btnCloseStudentModal) elements.btnCloseStudentModal.addEventListener('click', closeStudentModal);
    if (elements.btnCancelStudent) elements.btnCancelStudent.addEventListener('click', closeStudentModal);

    // Tab Switching
    elements.studentSidebarItems.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        switchStudentTab(targetTab);
      });
    });

    // Save Student
    if (elements.btnSaveStudent) {
      elements.btnSaveStudent.addEventListener('click', () => {
        saveStudentProfile().catch((e) => {
          console.error('[CRM Admin] Save student failed:', e);
          showToast(e?.message || 'Failed to save student.', 'error');
        });
      });
    }

    // Add Entrance Test
    if (elements.btnAddEntranceTest) {
      elements.btnAddEntranceTest.addEventListener('click', () => {
        createEntranceTest().catch((e) => {
          console.error('[CRM Admin] Create entrance test failed:', e);
          showToast(e?.message || 'Failed to create entrance test.', 'error');
        });
      });
    }

    // Copy Entrance Test Link
    if (elements.btnCopyEntranceTestLink) {
      elements.btnCopyEntranceTestLink.addEventListener('click', async () => {
        try {
          const link = String(elements.entranceTestLinkInput?.value || '').trim();
          if (!link) return;
          await copyToClipboard(link);
          showToast('Link copied.', 'success');
        } catch (e) {
          showToast(e?.message || 'Failed to copy link.', 'error');
        }
      });
    }
  }

  function resetStudentModal() {
    modalState.studentId = null;
    modalState.createdTestLinks = new Map();

    switchStudentTab('info');

    // Clear inputs
    const inputs = [
      elements.inputStudentName,
      elements.inputStudentLabel,
      elements.inputStudentPhone,
      elements.inputStudentEmail,
      elements.inputStudentZalo,
      elements.inputStudentFacebook
    ];
    inputs.forEach((el) => {
      if (el) el.value = '';
    });

    // Reset UI state
    if (elements.studentIdBadge) {
      elements.studentIdBadge.style.display = 'none';
      elements.studentIdBadge.textContent = 'ID: —';
    }

    if (elements.btnAddEntranceTest) elements.btnAddEntranceTest.disabled = false;
    if (elements.entranceTestLinkInput) elements.entranceTestLinkInput.value = '';
    if (elements.btnCopyEntranceTestLink) elements.btnCopyEntranceTestLink.disabled = true;
    if (elements.entranceTestsList) elements.entranceTestsList.innerHTML = '<div class="crm-muted">No tests yet.</div>';

    if (elements.btnSaveStudent) {
      elements.btnSaveStudent.disabled = false;
      elements.btnSaveStudent.textContent = 'Save Student';
    }
  }

  function resetCourseModal() {
    modalState.courseId = null;

    // Default to Info tab
    switchCourseTab('info');

    // Clear course info inputs
    const infoInputs = [
      elements.inputCourseName,
      elements.inputCourseCode,
      elements.inputCourseLabel,
      elements.inputCourseLevel,
      elements.inputCourseCategory,
      elements.inputCourseDescription
    ];
    infoInputs.forEach((el) => {
      if (el) el.value = '';
    });

    if (elements.inputCourseStatus) {
      elements.inputCourseStatus.value = elements.inputCourseStatus.options[0]?.value || 'active';
    }

    // Clear teachers input + list
    if (elements.courseTeacherEmailInput) {
      elements.courseTeacherEmailInput.value = '';
    }
    if (elements.courseTeachersList) {
      elements.courseTeachersList.innerHTML = '';
      const placeholder = document.createElement('li');
      placeholder.className = 'text-muted';
      placeholder.dataset.empty = 'true';
      placeholder.textContent = 'No teachers added yet.';
      elements.courseTeachersList.appendChild(placeholder);
    }

    if (elements.btnSaveCourse) {
      elements.btnSaveCourse.disabled = false;
      elements.btnSaveCourse.textContent = 'Save Course';
    }
  }

  function getStudentInfoPayload() {
    return {
      name: String(elements.inputStudentName?.value || '').trim(),
      label: String(elements.inputStudentLabel?.value || '').trim(),
      phone: String(elements.inputStudentPhone?.value || '').trim(),
      email: String(elements.inputStudentEmail?.value || '').trim(),
      zalo: String(elements.inputStudentZalo?.value || '').trim(),
      facebook: String(elements.inputStudentFacebook?.value || '').trim()
    };
  }

  function hasAnyInfoField(payload) {
    return Object.values(payload || {}).some(v => !!String(v || '').trim());
  }

  function getCourseTeachers() {
    if (!elements.courseTeachersList) return [];
    return Array.from(elements.courseTeachersList.querySelectorAll('li[data-email]'))
      .map((li) => String(li.dataset.email || '').trim())
      .filter(Boolean);
  }

  function getCoursePayload() {
    return {
      name: String(elements.inputCourseName?.value || '').trim(),
      code: String(elements.inputCourseCode?.value || '').trim(),
      label: String(elements.inputCourseLabel?.value || '').trim(),
      level: String(elements.inputCourseLevel?.value || '').trim(),
      category: String(elements.inputCourseCategory?.value || '').trim(),
      status: String(elements.inputCourseStatus?.value || '').trim() || 'active',
      description: String(elements.inputCourseDescription?.value || '').trim(),
      teachers: getCourseTeachers()
    };
  }

  async function saveCourse() {
    const payload = getCoursePayload();
    if (!payload.name) {
      throw new Error('Please enter a Course Name before saving.');
    }

    if (elements.btnSaveCourse) {
      elements.btnSaveCourse.disabled = true;
      elements.btnSaveCourse.textContent = 'Saving...';
    }

    try {
      const json = await apiFetchJson('/api/admin/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const courseId = String(json.courseId || '').trim();
      if (!courseId) throw new Error('Course ID missing from server response.');

      modalState.courseId = courseId;

      showToast('Course saved.', 'success');
      resetCourseModal();
    } catch (e) {
      if (elements.btnSaveCourse) {
        elements.btnSaveCourse.disabled = false;
        elements.btnSaveCourse.textContent = 'Save Course';
      }
      throw e;
    }
  }

  async function apiFetchJson(path, options = {}) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Please log in as admin first.');
    const idToken = await user.getIdToken();

    const headers = {
      ...(options.headers || {}),
      'Authorization': `Bearer ${idToken}`
    };

    const res = await fetch(path, { ...options, headers, cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      const msg = json?.message || `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.payload = json || null;
      throw err;
    }
    return json;
  }

  async function saveStudentProfile() {
    if (modalState.studentId) return;

    const payload = getStudentInfoPayload();
    if (!hasAnyInfoField(payload)) {
      throw new Error('Please fill at least 1 field in Info tab before saving.');
    }

    if (elements.btnSaveStudent) {
      elements.btnSaveStudent.disabled = true;
      elements.btnSaveStudent.textContent = 'Saving...';
    }
    try {
      const json = await apiFetchJson('/api/admin/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const studentId = String(json.studentId || '').trim();
      if (!studentId) throw new Error('Student ID missing from server response.');

      modalState.studentId = studentId;

      if (elements.studentIdBadge) {
        elements.studentIdBadge.textContent = `ID: ${studentId}`;
        elements.studentIdBadge.style.display = 'inline-flex';
      }

      if (elements.btnAddEntranceTest) elements.btnAddEntranceTest.disabled = false;

      if (elements.btnSaveStudent) {
        elements.btnSaveStudent.disabled = true;
        elements.btnSaveStudent.textContent = 'Saved';
      }

      await refreshStudentLists();
      await refreshEntranceTestsList();
      showToast('Student profile saved.', 'success');
    } catch (e) {
      if (modalState.studentId) {
        if (elements.btnSaveStudent) {
          elements.btnSaveStudent.disabled = true;
          elements.btnSaveStudent.textContent = 'Saved';
        }
        if (elements.btnAddEntranceTest) {
          elements.btnAddEntranceTest.disabled = false;
        }
      } else if (elements.btnSaveStudent) {
        elements.btnSaveStudent.disabled = false;
        elements.btnSaveStudent.textContent = 'Save Student';
      }
      throw e;
    }
  }

  async function createEntranceTest() {
    if (!modalState.studentId) {
      await saveStudentProfile();
    }

    if (!modalState.studentId) {
      throw new Error('Please fill at least 1 field before creating a test link.');
    }

    if (elements.btnAddEntranceTest) {
      elements.btnAddEntranceTest.disabled = true;
      elements.btnAddEntranceTest.textContent = 'Creating...';
    }
    try {
      const json = await apiFetchJson(`/api/admin/students/${encodeURIComponent(modalState.studentId)}/entrance-tests`, {
        method: 'POST'
      });

      const testLink = String(json.testLink || '').trim();
      const testId = String(json.testId || '').trim();
      if (!testLink || !testId) throw new Error('Test link missing from server response.');

      modalState.createdTestLinks.set(testId, testLink);

      if (elements.entranceTestLinkInput) elements.entranceTestLinkInput.value = testLink;
      if (elements.btnCopyEntranceTestLink) elements.btnCopyEntranceTestLink.disabled = false;

      await refreshEntranceTestsList();
      showToast('Entrance test link created.', 'success');
    } finally {
      if (elements.btnAddEntranceTest) {
        elements.btnAddEntranceTest.disabled = false;
        elements.btnAddEntranceTest.textContent = 'Add new test';
      }
    }
  }

  function tsToDate(ts) {
    if (!ts) return null;
    if (typeof ts === 'string') {
      const d = new Date(ts);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    if (typeof ts === 'number') {
      const d = new Date(ts);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    if (typeof ts === 'object') {
      if (typeof ts.toMillis === 'function') return new Date(ts.toMillis());
      if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000);
      if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    }
    return null;
  }

  function formatDateTime(ts) {
    const d = tsToDate(ts);
    if (!d) return '—';
    return d.toLocaleString();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str || '');
    return div.innerHTML;
  }

  function studentDisplayName(student) {
    const name = String(student?.name || '').trim();
    if (name) return name;
    const email = String(student?.email || '').trim();
    if (email) return email;
    const phone = String(student?.phone || '').trim();
    if (phone) return phone;
    return 'Unnamed student';
  }

  function studentContact(student) {
    const email = String(student?.email || '').trim();
    const phone = String(student?.phone || '').trim();
    if (email && phone) return `${email} • ${phone}`;
    if (email) return email;
    if (phone) return phone;
    const zalo = String(student?.zalo || '').trim();
    if (zalo) return `Zalo: ${zalo}`;
    return '—';
  }

  function renderStudentsTable(container, students, emptyMessage) {
    if (!container) return;

    const list = Array.isArray(students) ? students : [];
    if (list.length === 0) {
      container.classList.add('crm-placeholder-card');
      container.classList.remove('crm-table-host');
      container.innerHTML = `<div class="crm-muted">${escapeHtml(emptyMessage || 'No students yet.')}</div>`;
      return;
    }

    container.classList.remove('crm-placeholder-card');
    container.classList.add('crm-table-host');

    const rows = list.map((student) => {
      const studentId = String(student.studentId || '').trim();
      const displayName = studentDisplayName(student);
      const label = String(student.label || '').trim() || '—';
      const contact = studentContact(student);
      return `
        <tr>
          <td class="td-bold">
            <button type="button" class="crm-student-link" data-student-id="${escapeHtml(studentId)}">${escapeHtml(displayName)}</button>
          </td>
          <td>${escapeHtml(label)}</td>
          <td>${escapeHtml(contact)}</td>
          <td>${formatDateTime(student.createdAt)}</td>
          <td><code>${escapeHtml(studentId)}</code></td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div class="crm-table-container">
        <table class="crm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Label</th>
              <th>Contact</th>
              <th>Created</th>
              <th>Student ID</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;

    const studentIndex = new Map(list.map((s) => [String(s.studentId || '').trim(), s]));

    Array.from(container.querySelectorAll('button.crm-student-link[data-student-id]')).forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = String(btn.dataset.studentId || '').trim();
        const cached = studentIndex.get(id) || null;
        openStudentProfile(id, cached).catch((e) => {
          console.error('[CRM Admin] Open student profile failed:', e);
          showToast(e?.message || 'Failed to open student profile.', 'error');
        });
      });
    });
  }

  async function fetchStudentsFromFirestore(limit) {
    const rowLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 200;
    const snap = await firebase.firestore()
      .collection('crmStudents')
      .orderBy('createdAt', 'desc')
      .limit(rowLimit)
      .get();

    return snap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        studentId: doc.id,
        name: data.name || null,
        label: data.label || null,
        phone: data.phone || null,
        email: data.email || null,
        zalo: data.zalo || null,
        facebook: data.facebook || null,
        createdAt: data.createdAt || null
      };
    });
  }

  async function fetchStudentProfile(studentId) {
    const json = await apiFetchJson(`/api/admin/students/${encodeURIComponent(studentId)}`, { method: 'GET' });
    if (json?.student && typeof json.student === 'object') return json.student;
    throw new Error('Student profile missing from server response.');
  }

  function openStudentModal() {
    if (!elements.studentModal) return;
    elements.studentModal.style.display = 'flex';
    elements.studentModal.setAttribute('aria-hidden', 'false');
  }

  async function openStudentProfile(studentId, cachedStudent = null) {
    const id = String(studentId || '').trim();
    if (!id) throw new Error('Missing student ID.');

    openStudentModal();
    resetStudentModal();

    modalState.studentId = id;
    modalState.createdTestLinks = new Map();

    if (elements.studentIdBadge) {
      elements.studentIdBadge.textContent = `ID: ${id}`;
      elements.studentIdBadge.style.display = 'inline-flex';
    }

    if (elements.btnSaveStudent) {
      elements.btnSaveStudent.disabled = true;
      elements.btnSaveStudent.textContent = 'Saved';
    }

    if (elements.btnAddEntranceTest) {
      elements.btnAddEntranceTest.disabled = false;
      elements.btnAddEntranceTest.textContent = 'Add new test';
    }

    const student = cachedStudent || null;

    if (!student) {
      showToast('Student details are not available yet. Please refresh and try again.', 'error');
    } else {
      if (elements.inputStudentName) elements.inputStudentName.value = String(student?.name || '');
      if (elements.inputStudentLabel) elements.inputStudentLabel.value = String(student?.label || '');
      if (elements.inputStudentPhone) elements.inputStudentPhone.value = String(student?.phone || '');
      if (elements.inputStudentEmail) elements.inputStudentEmail.value = String(student?.email || '');
      if (elements.inputStudentZalo) elements.inputStudentZalo.value = String(student?.zalo || '');
      if (elements.inputStudentFacebook) elements.inputStudentFacebook.value = String(student?.facebook || '');
    }

    // Optional: refresh full profile if the endpoint exists (ignore failures to avoid noisy console errors)
    if (!cachedStudent) {
      fetchStudentProfile(id).then((fresh) => {
        if (!fresh) return;
        if (elements.inputStudentName) elements.inputStudentName.value = String(fresh?.name || '');
        if (elements.inputStudentLabel) elements.inputStudentLabel.value = String(fresh?.label || '');
        if (elements.inputStudentPhone) elements.inputStudentPhone.value = String(fresh?.phone || '');
        if (elements.inputStudentEmail) elements.inputStudentEmail.value = String(fresh?.email || '');
        if (elements.inputStudentZalo) elements.inputStudentZalo.value = String(fresh?.zalo || '');
        if (elements.inputStudentFacebook) elements.inputStudentFacebook.value = String(fresh?.facebook || '');
      }).catch(() => { });
    }

    await refreshEntranceTestsList();
    switchStudentTab('info');
  }

  async function refreshStudentLists() {
    let students = [];
    try {
      const json = await apiFetchJson('/api/admin/students?limit=200', { method: 'GET' });
      students = Array.isArray(json.students) ? json.students : [];
    } catch (error) {
      if (Number(error?.status) === 404) {
        students = await fetchStudentsFromFirestore(200);
      } else {
        throw error;
      }
    }

    renderStudentsTable(elements.potentialStudentsContainer, students, 'No potential students yet.');
    renderStudentsTable(elements.studentDataContainer, students, 'No students in database yet.');
  }

  function renderEntranceTests(tests) {
    if (!elements.entranceTestsList) return;

    if (!Array.isArray(tests) || tests.length === 0) {
      elements.entranceTestsList.innerHTML = '<div class="crm-muted">No tests yet.</div>';
      return;
    }

    const rows = tests.map((t) => {
      const testId = String(t.testId || '').trim();
      const status = String(t.status || 'created').toLowerCase();
      const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
      const testLink = String(modalState.createdTestLinks.get(testId) || '').trim();
      const resultLink = String(t.resultLink || '').trim();

      return `\n        <tr>\n          <td><span class="crm-test-status ${status}">${statusLabel}</span></td>\n          <td>${formatDateTime(t.createdAt)}</td>\n          <td>${formatDateTime(t.startedAt)}</td>\n          <td>${formatDateTime(t.submittedAt)}</td>\n          <td>${testLink ? `<a class="crm-test-link" href="${escapeHtml(testLink)}" target="_blank" rel="noopener">Open</a>` : 'Unavailable'}</td>\n          <td>${resultLink ? `<a class="crm-test-link" href="${escapeHtml(resultLink)}" target="_blank" rel="noopener">View</a>` : '—'}</td>\n        </tr>\n      `;
    }).join('');

    elements.entranceTestsList.innerHTML = `\n      <table class="crm-entrance-tests-table">\n        <thead>\n          <tr>\n            <th>Status</th>\n            <th>Start Date</th>\n            <th>Started</th>\n            <th>Submission Date</th>\n            <th>Test Link</th>\n            <th>Result</th>\n          </tr>\n        </thead>\n        <tbody>\n          ${rows}\n        </tbody>\n      </table>\n    `;
  }

  async function refreshEntranceTestsList() {
    if (!modalState.studentId) return;
    const json = await apiFetchJson(`/api/admin/students/${encodeURIComponent(modalState.studentId)}/entrance-tests`, {
      method: 'GET'
    });
    renderEntranceTests(json.tests || []);
  }

  async function copyToClipboard(text) {
    const t = String(text || '');
    if (!t) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(t);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  function setupCourseModal() {
    if (!elements.courseModal || elements.btnNewCourseTriggers.length === 0) return;

    const openCourseModal = () => {
      resetCourseModal();
      elements.courseModal.style.display = 'flex';
      elements.courseModal.setAttribute('aria-hidden', 'false');
    };

    const closeCourseModal = () => {
      elements.courseModal.style.display = 'none';
      elements.courseModal.setAttribute('aria-hidden', 'true');
    };

    elements.btnNewCourseTriggers.forEach((btn) => {
      btn.addEventListener('click', openCourseModal);
    });

    if (elements.btnCloseCourseModal) {
      elements.btnCloseCourseModal.addEventListener('click', closeCourseModal);
    }
    if (elements.btnCancelCourse) {
      elements.btnCancelCourse.addEventListener('click', closeCourseModal);
    }

    if (elements.btnSaveCourse) {
      elements.btnSaveCourse.addEventListener('click', () => {
        saveCourse()
          .then(() => {
            closeCourseModal();
          })
          .catch((e) => {
            console.error('[CRM Admin] Save course failed:', e);
            showToast(e?.message || 'Failed to save course.', 'error');
          });
      });
    }

    // Tab Switching
    elements.courseSidebarItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        switchCourseTab(targetTab);
      });
    });

    // Teacher list management
    if (elements.btnAddCourseTeacher && elements.courseTeacherEmailInput && elements.courseTeachersList) {
      const handleAddTeacher = () => {
        const rawEmail = elements.courseTeacherEmailInput.value.trim();
        if (!rawEmail) return;

        const email = rawEmail.toLowerCase();
        const existing = Array.from(
          elements.courseTeachersList.querySelectorAll('li[data-email]')
        ).some((li) => li.dataset.email === email);
        if (existing) {
          elements.courseTeacherEmailInput.value = '';
          return;
        }

        const emptyNode = elements.courseTeachersList.querySelector('li[data-empty]');
        if (emptyNode) {
          emptyNode.remove();
        }

        const li = document.createElement('li');
        li.className = 'crm-tag-item';
        li.dataset.email = email;

        const span = document.createElement('span');
        span.textContent = email;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'crm-tag-remove';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
          li.remove();
          if (elements.courseTeachersList.children.length === 0) {
            const placeholder = document.createElement('li');
            placeholder.className = 'text-muted';
            placeholder.dataset.empty = 'true';
            placeholder.textContent = 'No teachers added yet.';
            elements.courseTeachersList.appendChild(placeholder);
          }
        });

        li.appendChild(span);
        li.appendChild(removeBtn);
        elements.courseTeachersList.appendChild(li);

        elements.courseTeacherEmailInput.value = '';
        elements.courseTeacherEmailInput.focus();
      };

      elements.btnAddCourseTeacher.addEventListener('click', handleAddTeacher);
      elements.courseTeacherEmailInput.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          handleAddTeacher();
        }
      });
    }
  }

  function switchStudentTab(tabId) {
    // Update Sidebar
    elements.studentSidebarItems.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update Content
    elements.studentTabContents.forEach(content => {
      const isMatch = content.id === `student-${tabId}`;
      content.style.display = isMatch ? 'block' : 'none';
      content.classList.toggle('active', isMatch);
    });
  }

  function switchCourseTab(tabId) {
    elements.courseSidebarItems.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    elements.courseTabContents.forEach((content) => {
      const isMatch = content.id === `course-${tabId}`;
      content.style.display = isMatch ? 'block' : 'none';
      content.classList.toggle('active', isMatch);
    });
  }

  function isValidSub(main, sub) {
    if (main === 'courses') {
      // Allow the new sub tabs for courses
      const courseSubs = ['courses', 'classes', 'zoom-links', 'materials', 'planning', 'new-planning', 'admission-calendar', 'class-management'];
      return courseSubs.includes(sub);
    }
    const group = ROUTES[main];
    if (!group) return false;
    return group.subTabs.some((t) => t.id === sub);
  }

  function applyRouteFromHash() {
    const raw = (window.location.hash || '').replace(/^#/, '').trim();
    if (!raw) {
      state.main = 'dashboard';
      state.sub = '';
      updateHash();
      return;
    }

    const [main, sub] = raw.split('/').map((s) => (s || '').trim());
    state.main = main || 'dashboard';
    state.sub = sub || '';
  }

  function updateHash() {
    const next = state.sub ? `#${state.main}/${state.sub}` : `#${state.main}`;
    if (window.location.hash !== next) {
      window.location.hash = next;
    }
  }

  function render() {
    // Nav active state
    elements.navItems.forEach((btn) => {
      const isActive = btn.dataset.main === state.main;
      btn.classList.toggle('active', isActive);
    });

    // Panels
    const activePanel = state.sub ? `${state.main}/${state.sub}` : state.main;
    elements.panels.forEach((panel) => {
      panel.style.display = panel.dataset.panel === activePanel ? 'block' : 'none';
    });
  }

  function showGateMessage(title, subtitle) {
    if (!elements.gate) return;
    if (elements.gateText) elements.gateText.textContent = title || '';
    if (elements.gateSubtext) elements.gateSubtext.textContent = subtitle || '';
    elements.gate.style.display = 'flex';
  }

  function hideGate() {
    if (!elements.gate) return;
    elements.gate.style.display = 'none';
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `crm-toast ${type}`;
    toast.textContent = String(message || '');
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 220);
    }, 2600);
  }
})();
