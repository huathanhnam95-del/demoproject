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
  const dataCache = {
    leads: [],
    students: [],
    openTasks: [],
    attendanceRiskByStudentId: new Map()
  };
  const modalState = {
    studentId: null,
    createdTestLinks: new Map(),
    courseId: null,
    classroomId: null,
    leadId: null
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
    elements.courseCatalogContainer = document.querySelector('[data-panel="courses/courses"] .crm-placeholder-card');
    elements.btnNewLead = document.getElementById('btn-new-lead');
    elements.btnSaveLead = document.getElementById('btn-save-lead');
    elements.btnCancelLead = document.getElementById('btn-cancel-lead');
    elements.leadComposer = document.getElementById('lead-composer');
    elements.leadStageBoard = document.getElementById('lead-stage-board');
    elements.leadListContainer = document.getElementById('lead-list-container');
    elements.inputLeadName = document.getElementById('lead-name');
    elements.inputLeadEmail = document.getElementById('lead-email');
    elements.inputLeadPhone = document.getElementById('lead-phone');
    elements.inputLeadSource = document.getElementById('lead-source');
    elements.inputLeadStage = document.getElementById('lead-stage');
    elements.inputLeadProbability = document.getElementById('lead-probability');
    elements.leadWorkspace = document.getElementById('lead-workspace');
    elements.leadWorkspaceTitle = document.getElementById('lead-workspace-title');
    elements.leadWorkspaceMeta = document.getElementById('lead-workspace-meta');
    elements.leadWorkspaceBadge = document.getElementById('lead-workspace-badge');
    elements.inputLeadTaskTitle = document.getElementById('lead-task-title');
    elements.inputLeadTaskDueAt = document.getElementById('lead-task-due-at');
    elements.inputLeadTaskPriority = document.getElementById('lead-task-priority');
    elements.btnSaveLeadTask = document.getElementById('btn-save-lead-task');
    elements.leadTaskList = document.getElementById('lead-task-list');
    elements.inputLeadActivityType = document.getElementById('lead-activity-type');
    elements.inputLeadActivitySubject = document.getElementById('lead-activity-subject');
    elements.inputLeadActivityBody = document.getElementById('lead-activity-body');
    elements.btnSaveLeadActivity = document.getElementById('btn-save-lead-activity');
    elements.leadActivityList = document.getElementById('lead-activity-list');

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
    elements.inputScoreOverall = document.getElementById('score-overall');
    elements.inputScoreListening = document.getElementById('score-listening');
    elements.inputScoreReading = document.getElementById('score-reading');
    elements.inputScoreSpeaking = document.getElementById('score-speaking');
    elements.inputScoreWriting = document.getElementById('score-writing');
    elements.inputStudentDueDate = document.getElementById('student-due-date');
    elements.inputStudentLevel = document.getElementById('student-level');
    elements.studentTaskMeta = document.getElementById('student-task-meta');
    elements.studentTaskBadge = document.getElementById('student-task-badge');
    elements.inputStudentTaskTitle = document.getElementById('student-task-title');
    elements.inputStudentTaskDueAt = document.getElementById('student-task-due-at');
    elements.inputStudentTaskPriority = document.getElementById('student-task-priority');
    elements.btnSaveStudentTask = document.getElementById('btn-save-student-task');
    elements.studentTaskList = document.getElementById('student-task-list');
    elements.inputStudentActivityType = document.getElementById('student-activity-type');
    elements.inputStudentActivitySubject = document.getElementById('student-activity-subject');
    elements.inputStudentActivityBody = document.getElementById('student-activity-body');
    elements.btnSaveStudentActivity = document.getElementById('btn-save-student-activity');
    elements.studentActivityList = document.getElementById('student-activity-list');

    // Student ID Badge
    elements.studentIdBadge = document.getElementById('crm-student-id-badge');

    // Entrance Test UI (Learning Profile)
    elements.btnAddEntranceTest = document.getElementById('btn-add-entrance-test');
    elements.entranceTestLinkInput = document.getElementById('entrance-test-link');
    elements.btnCopyEntranceTestLink = document.getElementById('btn-copy-entrance-test-link');
    elements.entranceTestsList = document.getElementById('entrance-tests-list');

    // Identity Elements
    elements.inputClassCodeDisplay = document.getElementById('crm-class-code-display');
    elements.btnGenerateClassCode = document.getElementById('btn-generate-class-code');
    elements.inputHandshakeEmail = document.getElementById('crm-handshake-email');
    elements.btnLookupHandshake = document.getElementById('btn-lookup-handshake');
    elements.handshakePreview = document.getElementById('crm-handshake-preview');
    elements.handshakeAvatar = document.getElementById('crm-handshake-avatar');
    elements.handshakeName = document.getElementById('crm-handshake-name');
    elements.handshakeUid = document.getElementById('crm-handshake-uid');
    elements.btnConfirmHandshake = document.getElementById('btn-confirm-handshake');
    elements.linkedUidsUl = document.getElementById('crm-linked-uids-ul');

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

    // New Classroom Elements
    elements.btnNewClassroomTriggers = Array.from(document.querySelectorAll('#btn-new-classroom'));
    elements.classroomModal = document.getElementById('crm-classroom-modal');
    elements.btnCloseClassroomModal = document.getElementById('btn-close-classroom-modal');
    elements.btnCancelClassroom = document.getElementById('btn-cancel-classroom');
    elements.btnSaveClassroomSettings = document.getElementById('btn-save-classroom-settings');
    elements.classroomSidebarItems = elements.classroomModal
      ? Array.from(elements.classroomModal.querySelectorAll('.crm-sidebar-item[data-tab]'))
      : [];
    elements.classroomTabContents = elements.classroomModal
      ? Array.from(elements.classroomModal.querySelectorAll('.crm-tab-content'))
      : [];

    // Classroom Tab Specific Inputs
    elements.inputClassroomName = document.getElementById('classroom-name');
    elements.inputClassroomCourseId = document.getElementById('classroom-course-id');
    elements.inputClassroomStatus = document.getElementById('classroom-status');
    elements.classManagementGrid = document.getElementById('class-management-grid');
    elements.classroomStatusBadge = document.getElementById('crm-classroom-status-badge');
    elements.classroomTitle = document.getElementById('crm-classroom-title');
    elements.inputAttendanceStudentSelect = document.getElementById('attendance-student-select');
    elements.btnEnrollStudent = document.getElementById('btn-enroll-student');
    elements.attendanceEnrollmentMeta = document.getElementById('attendance-enrollment-meta');
    elements.inputAttendanceSessionDate = document.getElementById('attendance-session-date');
    elements.inputAttendanceSessionTitle = document.getElementById('attendance-session-title');
    elements.inputAttendanceSessionSelect = document.getElementById('attendance-session-select');
    elements.btnCreateAttendanceSession = document.getElementById('btn-create-attendance-session');
    elements.btnSaveAttendanceRecords = document.getElementById('btn-save-attendance-records');
    elements.attendanceRosterContainer = document.getElementById('attendance-roster-container');

    // Classroom Modules & Classwork
    elements.btnAddModule = document.getElementById('btn-add-module');
    elements.modulesListContainer = document.getElementById('modules-list-container');
    elements.btnAddClasswork = document.getElementById('btn-add-classwork');
    elements.classworkComposer = document.getElementById('classwork-composer');
    elements.btnSaveClassworkDraft = document.getElementById('btn-save-classwork-draft');
    elements.btnCancelClasswork = document.getElementById('btn-cancel-classwork');
    elements.classworkListContainer = document.getElementById('classwork-list-container');
    elements.inputClassworkTitle = document.getElementById('classwork-title');
    elements.inputClassworkType = document.getElementById('classwork-type');
    elements.inputClassworkModule = document.getElementById('classwork-module');
    elements.inputClassworkVoice = document.getElementById('classwork-voice');

    // Classroom Review Board
    elements.kanbanMissingList = document.getElementById('kanban-missing-list');
    elements.kanbanTurnedInList = document.getElementById('kanban-turnedin-list');
    elements.kanbanGradedList = document.getElementById('kanban-graded-list');

    // Stream
    elements.btnPostAnnouncement = document.getElementById('btn-post-announcement');
    elements.inputStreamPost = document.getElementById('stream-post-content');
    elements.streamPostsContainer = document.getElementById('stream-posts-container');
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
    setupLeadComposer();
    setupActivitySurfaces();
    applyRouteFromHash();
    render();

    refreshStudentLists().catch((e) => {
      console.error('[CRM Admin] Failed to load student lists:', e);
      showToast(e?.message || 'Failed to load student list.', 'error');
    });

    refreshClassroomList().catch((e) => {
      console.error('[CRM Admin] Failed to load classrooms:', e);
      showToast(e?.message || 'Failed to load classrooms.', 'error');
    });

    refreshCourseCatalog().catch((e) => {
      console.error('[CRM Admin] Failed to load course catalog:', e);
      showToast(e?.message || 'Failed to load courses.', 'error');
    });

    refreshLeadPipeline().catch((e) => {
      console.error('[CRM Admin] Failed to load leads:', e);
      showToast(e?.message || 'Failed to load leads.', 'error');
    });

    refreshOpenTaskSnapshot().catch((e) => {
      console.error('[CRM Admin] Failed to load task reminders:', e);
      showToast(e?.message || 'Failed to load task reminders.', 'error');
    });

    refreshAttendanceRiskSnapshot().catch((e) => {
      console.error('[CRM Admin] Failed to load attendance risk snapshot:', e);
      showToast(e?.message || 'Failed to load attendance summaries.', 'error');
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
    setupClassroomModal();
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

    // Identity Tab Listeners
    if (elements.btnGenerateClassCode) {
      elements.btnGenerateClassCode.addEventListener('click', async () => {
        if (!modalState.studentId) {
          await saveStudentProfile();
        }
        if (!modalState.studentId) return;

        try {
          const json = await apiFetchJson(`/api/admin/students/${encodeURIComponent(modalState.studentId)}/class-code`, {
            method: 'POST'
          });
          if (elements.inputClassCodeDisplay) elements.inputClassCodeDisplay.value = json.classCode;
          showToast('New class code generated.', 'success');
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }

    if (elements.btnLookupHandshake) {
      elements.btnLookupHandshake.addEventListener('click', async () => {
        const email = elements.inputHandshakeEmail.value.trim();
        if (!email) return;

        try {
          elements.btnLookupHandshake.disabled = true;
          const json = await apiFetchJson(`/api/admin/users/lookup?email=${encodeURIComponent(email)}`, {
            method: 'GET'
          });

          const user = json.user;
          if (elements.handshakeName) elements.handshakeName.textContent = user.displayName;
          if (elements.handshakeUid) elements.handshakeUid.textContent = `UID: ${user.uid}`;
          if (elements.handshakeAvatar) elements.handshakeAvatar.src = user.photoURL || 'assets/default-avatar.png';

          elements.btnConfirmHandshake.dataset.targetUid = user.uid;
          elements.handshakePreview.style.display = 'block';
        } catch (e) {
          showToast(e.message, 'error');
        } finally {
          elements.btnLookupHandshake.disabled = false;
        }
      });
    }

    if (elements.btnConfirmHandshake) {
      elements.btnConfirmHandshake.addEventListener('click', async () => {
        const targetUid = elements.btnConfirmHandshake.dataset.targetUid;
        if (!targetUid || !modalState.studentId) return;

        try {
          elements.btnConfirmHandshake.disabled = true;
          await apiFetchJson(`/api/admin/students/${encodeURIComponent(modalState.studentId)}/force-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUid })
          });

          showToast('User linked successfully.', 'success');
          elements.handshakePreview.style.display = 'none';
          elements.inputHandshakeEmail.value = '';

          // Refresh identity to see new linked UID
          await refreshStudentIdentity();
        } catch (e) {
          showToast(e.message, 'error');
        } finally {
          elements.btnConfirmHandshake.disabled = false;
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
      elements.inputStudentFacebook,
      elements.inputScoreOverall,
      elements.inputScoreListening,
      elements.inputScoreReading,
      elements.inputScoreSpeaking,
      elements.inputScoreWriting,
      elements.inputStudentDueDate,
      elements.inputStudentLevel,
      elements.inputClassCodeDisplay,
      elements.inputHandshakeEmail
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

    if (elements.handshakePreview) elements.handshakePreview.style.display = 'none';
    if (elements.linkedUidsUl) elements.linkedUidsUl.innerHTML = '<li class="text-muted">No accounts linked yet.</li>';
    if (elements.studentTaskList) elements.studentTaskList.innerHTML = '<div class="crm-muted">No tasks yet.</div>';
    if (elements.studentActivityList) elements.studentActivityList.innerHTML = '<div class="crm-muted">No activity yet.</div>';
    if (elements.studentTaskMeta) elements.studentTaskMeta.textContent = 'Save the profile to schedule follow-ups.';
    applyReminderBadge(elements.studentTaskBadge, null);
    resetStudentTaskComposer();
    resetStudentActivityComposer();

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

  function resetLeadComposer() {
    const inputs = [
      elements.inputLeadName,
      elements.inputLeadEmail,
      elements.inputLeadPhone,
      elements.inputLeadSource,
      elements.inputLeadProbability
    ];
    inputs.forEach((input) => {
      if (input) input.value = '';
    });
    if (elements.inputLeadStage) {
      elements.inputLeadStage.value = 'new';
    }
    if (elements.btnSaveLead) {
      elements.btnSaveLead.disabled = false;
      elements.btnSaveLead.textContent = 'Save Lead';
    }
  }

  function resetLeadTaskComposer() {
    if (elements.inputLeadTaskTitle) elements.inputLeadTaskTitle.value = '';
    if (elements.inputLeadTaskDueAt) elements.inputLeadTaskDueAt.value = '';
    if (elements.inputLeadTaskPriority) elements.inputLeadTaskPriority.value = 'medium';
  }

  function resetLeadActivityComposer() {
    if (elements.inputLeadActivityType) elements.inputLeadActivityType.value = 'note';
    if (elements.inputLeadActivitySubject) elements.inputLeadActivitySubject.value = '';
    if (elements.inputLeadActivityBody) elements.inputLeadActivityBody.value = '';
  }

  function resetStudentTaskComposer() {
    if (elements.inputStudentTaskTitle) elements.inputStudentTaskTitle.value = '';
    if (elements.inputStudentTaskDueAt) elements.inputStudentTaskDueAt.value = '';
    if (elements.inputStudentTaskPriority) elements.inputStudentTaskPriority.value = 'medium';
  }

  function resetStudentActivityComposer() {
    if (elements.inputStudentActivityType) elements.inputStudentActivityType.value = 'note';
    if (elements.inputStudentActivitySubject) elements.inputStudentActivitySubject.value = '';
    if (elements.inputStudentActivityBody) elements.inputStudentActivityBody.value = '';
  }

  function getStudentPayload() {
    if (window.CrmStudents && typeof window.CrmStudents.buildPayload === 'function') {
      return window.CrmStudents.buildPayload(elements);
    }

    return {
      name: String(elements.inputStudentName?.value || '').trim(),
      label: String(elements.inputStudentLabel?.value || '').trim(),
      phone: String(elements.inputStudentPhone?.value || '').trim(),
      email: String(elements.inputStudentEmail?.value || '').trim(),
      zalo: String(elements.inputStudentZalo?.value || '').trim(),
      facebook: String(elements.inputStudentFacebook?.value || '').trim(),
      learningProfile: {
        overall: null,
        listening: null,
        reading: null,
        speaking: null,
        writing: null,
        entryLevel: String(elements.inputStudentLevel?.value || '').trim(),
        testResultDueDate: String(elements.inputStudentDueDate?.value || '').trim()
      }
    };
  }

  function hasAnyInfoField(payload) {
    if (window.CrmStudents && typeof window.CrmStudents.hasAnyInfoField === 'function') {
      return window.CrmStudents.hasAnyInfoField(payload);
    }
    return [payload?.name, payload?.label, payload?.phone, payload?.email, payload?.zalo, payload?.facebook]
      .some(v => !!String(v || '').trim());
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

  function setCourseTeachers(emails) {
    if (!elements.courseTeachersList) return;
    elements.courseTeachersList.innerHTML = '';

    const teacherList = Array.isArray(emails) ? emails.filter(Boolean) : [];
    if (!teacherList.length) {
      const placeholder = document.createElement('li');
      placeholder.className = 'text-muted';
      placeholder.dataset.empty = 'true';
      placeholder.textContent = 'No teachers added yet.';
      elements.courseTeachersList.appendChild(placeholder);
      return;
    }

    teacherList.forEach((email) => {
      const li = document.createElement('li');
      li.className = 'crm-tag-item';
      li.dataset.email = email;

      const span = document.createElement('span');
      span.textContent = email;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'crm-tag-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        li.remove();
        if (elements.courseTeachersList.children.length === 0) {
          setCourseTeachers([]);
        }
      });

      li.appendChild(span);
      li.appendChild(removeBtn);
      elements.courseTeachersList.appendChild(li);
    });
  }

  function applyCourseToForm(course) {
    modalState.courseId = String(course?.id || course?.courseId || '').trim() || null;
    if (elements.inputCourseName) elements.inputCourseName.value = String(course?.name || '');
    if (elements.inputCourseCode) elements.inputCourseCode.value = String(course?.code || '');
    if (elements.inputCourseLabel) elements.inputCourseLabel.value = String(course?.label || '');
    if (elements.inputCourseLevel) elements.inputCourseLevel.value = String(course?.level || '');
    if (elements.inputCourseCategory) elements.inputCourseCategory.value = String(course?.category || '');
    if (elements.inputCourseStatus) elements.inputCourseStatus.value = String(course?.status || 'active');
    if (elements.inputCourseDescription) elements.inputCourseDescription.value = String(course?.description || '');
    setCourseTeachers(course?.teachers || []);
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
      const path = modalState.courseId
        ? `/api/admin/courses/${encodeURIComponent(modalState.courseId)}`
        : '/api/admin/courses';
      const method = modalState.courseId ? 'PATCH' : 'POST';
      const json = await apiFetchJson(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const courseId = String(json.courseId || json.course?.courseId || modalState.courseId || '').trim();
      if (!courseId) throw new Error('Course ID missing from server response.');

      modalState.courseId = courseId;
      await refreshCourseCatalog();

      showToast(method === 'PATCH' ? 'Course updated.' : 'Course saved.', 'success');
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

  function setupLeadComposer() {
    if (!elements.leadComposer) return;

    if (elements.btnNewLead) {
      elements.btnNewLead.addEventListener('click', () => {
        resetLeadComposer();
        elements.leadComposer.style.display = 'block';
      });
    }

    if (elements.btnCancelLead) {
      elements.btnCancelLead.addEventListener('click', () => {
        elements.leadComposer.style.display = 'none';
        resetLeadComposer();
      });
    }

    if (elements.btnSaveLead) {
      elements.btnSaveLead.addEventListener('click', () => {
        saveLead().catch((error) => {
          console.error('[CRM Admin] Save lead failed:', error);
          showToast(error?.message || 'Failed to save lead.', 'error');
        });
      });
    }
  }

  function setupActivitySurfaces() {
    if (elements.btnSaveLeadTask) {
      elements.btnSaveLeadTask.addEventListener('click', () => {
        createTaskForLead().catch((error) => {
          console.error('[CRM Admin] Save lead task failed:', error);
          showToast(error?.message || 'Failed to save lead task.', 'error');
        });
      });
    }

    if (elements.btnSaveLeadActivity) {
      elements.btnSaveLeadActivity.addEventListener('click', () => {
        createActivityForLead().catch((error) => {
          console.error('[CRM Admin] Save lead activity failed:', error);
          showToast(error?.message || 'Failed to save lead activity.', 'error');
        });
      });
    }

    if (elements.btnSaveStudentTask) {
      elements.btnSaveStudentTask.addEventListener('click', () => {
        createTaskForStudent().catch((error) => {
          console.error('[CRM Admin] Save student task failed:', error);
          showToast(error?.message || 'Failed to save student task.', 'error');
        });
      });
    }

    if (elements.btnSaveStudentActivity) {
      elements.btnSaveStudentActivity.addEventListener('click', () => {
        createActivityForStudent().catch((error) => {
          console.error('[CRM Admin] Save student activity failed:', error);
          showToast(error?.message || 'Failed to save student activity.', 'error');
        });
      });
    }
  }

  function buildQuery(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        search.set(key, String(value).trim());
      }
    });
    return search.toString();
  }

  async function fetchTasks(params = {}) {
    const query = buildQuery(params);
    const path = query ? `/api/admin/tasks?${query}` : '/api/admin/tasks';
    const json = await apiFetchJson(path, { method: 'GET' });
    return Array.isArray(json.tasks) ? json.tasks : [];
  }

  async function fetchActivities(params = {}) {
    const query = buildQuery(params);
    const path = query ? `/api/admin/activities?${query}` : '/api/admin/activities';
    const json = await apiFetchJson(path, { method: 'GET' });
    return Array.isArray(json.activities) ? json.activities : [];
  }

  function filterTasksForEntity(entity) {
    if (!entity) return [];
    return dataCache.openTasks.filter((task) => {
      if (entity.leadId) return String(task.leadId || '') === String(entity.leadId);
      if (entity.studentId) return String(task.studentId || '') === String(entity.studentId);
      if (entity.classId) return String(task.classId || '') === String(entity.classId);
      return false;
    });
  }

  function getReminderSummary(entity) {
    if (!window.CrmActivities || typeof window.CrmActivities.summarizeTasks !== 'function') {
      return null;
    }
    return window.CrmActivities.summarizeTasks(filterTasksForEntity(entity), new Date());
  }

  function applyReminderBadge(element, summary) {
    if (!element || !window.CrmActivities) return;
    const safeSummary = summary || { overdueCount: 0, nextActionAt: null };
    element.className = `crm-reminder-badge ${window.CrmActivities.getBadgeTone(safeSummary)}`;
    element.textContent = window.CrmActivities.getBadgeLabel(safeSummary);
  }

  function renderReminderBadgeMarkup(summary) {
    if (!window.CrmActivities) return '';
    const safeSummary = summary || { overdueCount: 0, nextActionAt: null };
    return `<span class="crm-reminder-badge ${escapeHtml(window.CrmActivities.getBadgeTone(safeSummary))}">${escapeHtml(window.CrmActivities.getBadgeLabel(safeSummary))}</span>`;
  }

  function renderRiskBadgeMarkup(studentId) {
    const key = String(studentId || '').trim();
    if (!key) return '';
    const summary = dataCache.attendanceRiskByStudentId.get(key);
    if (!summary) return '';
    const isAtRisk = !!summary.atRisk?.isAtRisk;
    return `<span class="crm-risk-badge ${isAtRisk ? 'risk' : ''}">${escapeHtml(isAtRisk ? 'At Risk' : 'Stable')}</span>`;
  }

  async function refreshOpenTaskSnapshot() {
    dataCache.openTasks = await fetchTasks({ status: 'open', limit: 300 });

    if (dataCache.students.length) {
      const buckets = window.CrmStudents.splitStudents(dataCache.students);
      renderStudentsTable(elements.potentialStudentsContainer, buckets.potential, 'No potential students yet.');
      renderStudentsTable(elements.studentDataContainer, buckets.studentData, 'No students in database yet.');
    }

    if (dataCache.leads.length) {
      renderLeadStageBoard(dataCache.leads);
      renderLeadTable(dataCache.leads);
    }

    if (modalState.studentId) {
      await refreshStudentTimeline();
    }

    if (modalState.leadId) {
      await refreshLeadWorkspace();
    }
  }

  async function refreshAttendanceRiskSnapshot() {
    if (!window.ClassroomAPI || typeof window.ClassroomAPI.fetchAttendanceSummary !== 'function') {
      return;
    }

    const json = await window.ClassroomAPI.fetchAttendanceSummary();
    const rows = Array.isArray(json?.students) ? json.students : [];
    dataCache.attendanceRiskByStudentId = new Map(
      rows.map((row) => [String(row.studentId || '').trim(), row])
    );

    if (dataCache.students.length) {
      const buckets = window.CrmStudents.splitStudents(dataCache.students);
      renderStudentsTable(elements.potentialStudentsContainer, buckets.potential, 'No potential students yet.');
      renderStudentsTable(elements.studentDataContainer, buckets.studentData, 'No students in database yet.');
    }
  }

  async function saveLead() {
    if (!window.CrmLeads || typeof window.CrmLeads.buildPayload !== 'function') {
      throw new Error('Lead helpers are not available.');
    }

    const payload = window.CrmLeads.buildPayload(elements);
    if (!payload.name && !payload.email && !payload.phone) {
      throw new Error('Please fill at least 1 lead contact field before saving.');
    }

    if (elements.btnSaveLead) {
      elements.btnSaveLead.disabled = true;
      elements.btnSaveLead.textContent = 'Saving...';
    }

    try {
      await apiFetchJson('/api/admin/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      elements.leadComposer.style.display = 'none';
      resetLeadComposer();
      await refreshLeadPipeline();
      showToast('Lead saved.', 'success');
    } catch (error) {
      if (elements.btnSaveLead) {
        elements.btnSaveLead.disabled = false;
        elements.btnSaveLead.textContent = 'Save Lead';
      }
      throw error;
    }
  }

  async function saveStudentProfile() {
    const payload = getStudentPayload();
    if (!hasAnyInfoField(payload)) {
      throw new Error('Please fill at least 1 field in Info tab before saving.');
    }

    if (elements.btnSaveStudent) {
      elements.btnSaveStudent.disabled = true;
      elements.btnSaveStudent.textContent = 'Saving...';
    }
    try {
      const path = modalState.studentId
        ? `/api/admin/students/${encodeURIComponent(modalState.studentId)}`
        : '/api/admin/students';
      const method = modalState.studentId ? 'PATCH' : 'POST';
      const json = await apiFetchJson(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const studentId = String(json.studentId || json.student?.studentId || modalState.studentId || '').trim();
      if (!studentId) throw new Error('Student ID missing from server response.');

      modalState.studentId = studentId;

      if (elements.studentIdBadge) {
        elements.studentIdBadge.textContent = `ID: ${studentId}`;
        elements.studentIdBadge.style.display = 'inline-flex';
      }

      if (elements.btnAddEntranceTest) elements.btnAddEntranceTest.disabled = false;

      if (elements.btnSaveStudent) {
        elements.btnSaveStudent.disabled = false;
        elements.btnSaveStudent.textContent = 'Save Student';
      }

      await refreshStudentLists();
      await refreshStudentTimeline();
      await refreshEntranceTestsList();
      showToast(method === 'PATCH' ? 'Student profile updated.' : 'Student profile saved.', 'success');
    } catch (e) {
      if (modalState.studentId) {
        if (elements.btnSaveStudent) {
          elements.btnSaveStudent.disabled = false;
          elements.btnSaveStudent.textContent = 'Save Student';
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

  function formatDueAtForMeta(ts) {
    const d = tsToDate(ts);
    if (!d) return 'No due date';
    return `Due ${d.toLocaleString()}`;
  }

  function renderTaskList(container, tasks, options = {}) {
    if (!container) return;
    const list = Array.isArray(tasks) ? [...tasks] : [];
    if (!list.length) {
      container.innerHTML = `<div class="crm-muted">${escapeHtml(options.emptyMessage || 'No tasks yet.')}</div>`;
      return;
    }

    list.sort((left, right) => {
      const leftDue = tsToDate(left?.dueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightDue = tsToDate(right?.dueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
      if (leftDue !== rightDue) return leftDue - rightDue;
      return (tsToDate(right?.createdAt)?.getTime() || 0) - (tsToDate(left?.createdAt)?.getTime() || 0);
    });

    container.innerHTML = list.map((task) => {
      const priority = window.CrmActivities
        ? window.CrmActivities.formatPriorityLabel(task.priority)
        : String(task.priority || 'medium');
      const isOpen = String(task.status || 'open') === 'open';
      return `
        <div class="crm-task-item">
          <div class="crm-task-head">
            <strong>${escapeHtml(task.title || 'Untitled task')}</strong>
            <span class="crm-task-priority ${escapeHtml(priority)}">${escapeHtml(priority)}</span>
          </div>
          <div class="crm-task-meta">${escapeHtml(formatDueAtForMeta(task.dueAt))}</div>
          ${task.notes ? `<div class="crm-timeline-meta" style="margin-top: 6px;">${escapeHtml(task.notes)}</div>` : ''}
          ${isOpen ? `
            <div class="crm-task-actions">
              <button type="button" class="crm-btn-secondary btn-task-done" data-task-id="${escapeHtml(task.taskId || '')}" data-scope="${escapeHtml(options.scope || '')}">Mark Done</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    Array.from(container.querySelectorAll('.btn-task-done')).forEach((button) => {
      button.addEventListener('click', async () => {
        const taskId = String(button.dataset.taskId || '').trim();
        const scope = String(button.dataset.scope || '').trim();
        try {
          button.disabled = true;
          await apiFetchJson(`/api/admin/tasks/${encodeURIComponent(taskId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'done' })
          });
          await refreshOpenTaskSnapshot();
          showToast(scope === 'lead' ? 'Lead task completed.' : 'Student task completed.', 'success');
        } catch (error) {
          console.error('[CRM Admin] Complete task failed:', error);
          showToast(error?.message || 'Failed to update task.', 'error');
          button.disabled = false;
        }
      });
    });
  }

  function renderActivityList(container, activities, emptyMessage) {
    if (!container) return;
    const list = Array.isArray(activities) ? [...activities] : [];
    if (!list.length) {
      container.innerHTML = `<div class="crm-muted">${escapeHtml(emptyMessage || 'No activity yet.')}</div>`;
      return;
    }

    list.sort((left, right) => (tsToDate(right?.createdAt)?.getTime() || 0) - (tsToDate(left?.createdAt)?.getTime() || 0));

    container.innerHTML = list.map((activity) => `
      <div class="crm-timeline-item">
        <div class="crm-timeline-head">
          <span class="crm-activity-chip">${escapeHtml(window.CrmActivities ? window.CrmActivities.formatTypeLabel(activity.type) : String(activity.type || 'Note'))}</span>
          <span class="crm-timeline-meta">${escapeHtml(formatDateTime(activity.createdAt))}</span>
        </div>
        <strong>${escapeHtml(activity.subject || 'Untitled activity')}</strong>
        ${activity.body ? `<div class="crm-timeline-meta" style="margin-top: 6px;">${escapeHtml(activity.body)}</div>` : ''}
      </div>
    `).join('');
  }

  async function refreshLeadWorkspace() {
    if (!modalState.leadId) {
      if (elements.leadWorkspace) elements.leadWorkspace.style.display = 'none';
      return;
    }

    const lead = dataCache.leads.find((item) => String(item.leadId || '') === String(modalState.leadId)) || null;
    const [tasks, activities] = await Promise.all([
      fetchTasks({ leadId: modalState.leadId, limit: 50 }),
      fetchActivities({ leadId: modalState.leadId, limit: 50 })
    ]);

    if (elements.leadWorkspace) elements.leadWorkspace.style.display = 'grid';
    if (elements.leadWorkspaceTitle) {
      elements.leadWorkspaceTitle.textContent = lead?.name || lead?.email || 'Lead Workspace';
    }
    if (elements.leadWorkspaceMeta) {
      elements.leadWorkspaceMeta.textContent = [lead?.stage, lead?.source, lead?.email || lead?.phone || lead?.zalo]
        .filter(Boolean)
        .join(' | ') || 'Manage next actions and communication.';
    }

    applyReminderBadge(elements.leadWorkspaceBadge, getReminderSummary({ leadId: modalState.leadId }));
    renderTaskList(elements.leadTaskList, tasks, {
      emptyMessage: 'No lead tasks yet.',
      scope: 'lead'
    });
    renderActivityList(elements.leadActivityList, activities, 'No lead activity yet.');
  }

  async function refreshStudentTimeline() {
    if (!modalState.studentId) {
      if (elements.studentTaskMeta) {
        elements.studentTaskMeta.textContent = 'Save the profile to schedule follow-ups.';
      }
      applyReminderBadge(elements.studentTaskBadge, null);
      return;
    }

    const [tasks, activities] = await Promise.all([
      fetchTasks({ studentId: modalState.studentId, limit: 50 }),
      fetchActivities({ studentId: modalState.studentId, limit: 50 })
    ]);

    const summary = getReminderSummary({ studentId: modalState.studentId });
    if (elements.studentTaskMeta) {
      elements.studentTaskMeta.textContent = summary?.nextActionAt
        ? formatDueAtForMeta(summary.nextActionAt)
        : 'No scheduled follow-up yet.';
    }
    applyReminderBadge(elements.studentTaskBadge, summary);
    renderTaskList(elements.studentTaskList, tasks, {
      emptyMessage: 'No tasks yet.',
      scope: 'student'
    });
    renderActivityList(elements.studentActivityList, activities, 'No activity yet.');
  }

  async function createTaskForLead() {
    if (!modalState.leadId) throw new Error('Select a lead first.');
    if (!window.CrmActivities || typeof window.CrmActivities.buildTaskPayload !== 'function') {
      throw new Error('Activity helpers are not available.');
    }

    const payload = window.CrmActivities.buildTaskPayload({
      inputTaskTitle: elements.inputLeadTaskTitle,
      inputTaskDueAt: elements.inputLeadTaskDueAt,
      inputTaskPriority: elements.inputLeadTaskPriority
    });

    await apiFetchJson('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId: modalState.leadId,
        ...payload
      })
    });

    resetLeadTaskComposer();
    await refreshOpenTaskSnapshot();
    showToast('Lead task added.', 'success');
  }

  async function createActivityForLead() {
    if (!modalState.leadId) throw new Error('Select a lead first.');
    if (!window.CrmActivities || typeof window.CrmActivities.buildActivityPayload !== 'function') {
      throw new Error('Activity helpers are not available.');
    }

    const payload = window.CrmActivities.buildActivityPayload({
      inputActivityType: elements.inputLeadActivityType,
      inputActivitySubject: elements.inputLeadActivitySubject,
      inputActivityBody: elements.inputLeadActivityBody
    });

    await apiFetchJson('/api/admin/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId: modalState.leadId,
        ...payload
      })
    });

    resetLeadActivityComposer();
    await refreshLeadWorkspace();
    showToast('Lead activity logged.', 'success');
  }

  async function createTaskForStudent() {
    if (!modalState.studentId) throw new Error('Save the student profile first.');
    if (!window.CrmActivities || typeof window.CrmActivities.buildTaskPayload !== 'function') {
      throw new Error('Activity helpers are not available.');
    }

    const payload = window.CrmActivities.buildTaskPayload({
      inputTaskTitle: elements.inputStudentTaskTitle,
      inputTaskDueAt: elements.inputStudentTaskDueAt,
      inputTaskPriority: elements.inputStudentTaskPriority
    });

    await apiFetchJson('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: modalState.studentId,
        ...payload
      })
    });

    resetStudentTaskComposer();
    await refreshOpenTaskSnapshot();
    showToast('Student task added.', 'success');
  }

  async function createActivityForStudent() {
    if (!modalState.studentId) throw new Error('Save the student profile first.');
    if (!window.CrmActivities || typeof window.CrmActivities.buildActivityPayload !== 'function') {
      throw new Error('Activity helpers are not available.');
    }

    const payload = window.CrmActivities.buildActivityPayload({
      inputActivityType: elements.inputStudentActivityType,
      inputActivitySubject: elements.inputStudentActivitySubject,
      inputActivityBody: elements.inputStudentActivityBody
    });

    await apiFetchJson('/api/admin/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: modalState.studentId,
        ...payload
      })
    });

    resetStudentActivityComposer();
    await refreshStudentTimeline();
    showToast('Student activity logged.', 'success');
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
            <div class="crm-name-cell">
              <button type="button" class="crm-student-link" data-student-id="${escapeHtml(studentId)}">${escapeHtml(displayName)}</button>
              ${renderReminderBadgeMarkup(getReminderSummary({ studentId }))}
              ${renderRiskBadgeMarkup(studentId)}
            </div>
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

  function openCourseModal() {
    if (!elements.courseModal) return;
    elements.courseModal.style.display = 'flex';
    elements.courseModal.setAttribute('aria-hidden', 'false');
  }

  function openClassroomModal() {
    if (!elements.classroomModal) return;
    elements.classroomModal.style.display = 'flex';
    elements.classroomModal.setAttribute('aria-hidden', 'false');
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
      elements.btnSaveStudent.disabled = false;
      elements.btnSaveStudent.textContent = 'Save Student';
    }

    if (elements.btnAddEntranceTest) {
      elements.btnAddEntranceTest.disabled = false;
      elements.btnAddEntranceTest.textContent = 'Add new test';
    }

    const student = cachedStudent || null;

    if (!student) {
      showToast('Student details are not available yet. Please refresh and try again.', 'error');
    } else {
      if (window.CrmStudents && typeof window.CrmStudents.applyToForm === 'function') {
        window.CrmStudents.applyToForm(elements, student);
      }
    }

    fetchStudentProfile(id).then((fresh) => {
      if (!fresh) return;
      if (window.CrmStudents && typeof window.CrmStudents.applyToForm === 'function') {
        window.CrmStudents.applyToForm(elements, fresh);
      }
    }).catch((error) => {
      console.error('[CRM Admin] Failed to refresh student profile after open:', error);
    });

    await refreshEntranceTestsList();
    await refreshStudentIdentity();
    await refreshStudentTimeline();
    switchStudentTab('info');
  }

  async function refreshStudentIdentity() {
    if (!modalState.studentId) return;
    try {
      // Re-fetch the student document to get class_code and linked_user_ids
      const snap = await firebase.firestore().collection('crmStudents').doc(modalState.studentId).get();
      if (!snap.exists) return;
      const data = snap.data();

      if (elements.inputClassCodeDisplay) {
        elements.inputClassCodeDisplay.value = data.class_code || '';
      }

      if (elements.linkedUidsUl) {
        const uids = data.linked_user_ids || [];
        if (uids.length === 0) {
          elements.linkedUidsUl.innerHTML = '<li class="text-muted">No accounts linked yet.</li>';
        } else {
          elements.linkedUidsUl.innerHTML = uids.map(uid => `
            <li>
              <span>${escapeHtml(uid)}</span>
              <span class="crm-test-status submitted">Linked</span>
            </li>
          `).join('');
        }
      }
    } catch (e) {
      console.error('[CRM Admin] Failed to refresh identity:', e);
    }
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

    const buckets = window.CrmStudents && typeof window.CrmStudents.splitStudents === 'function'
      ? window.CrmStudents.splitStudents(students)
      : { potential: students, studentData: [] };

    dataCache.students = students;

    renderStudentsTable(elements.potentialStudentsContainer, buckets.potential, 'No potential students yet.');
    renderStudentsTable(elements.studentDataContainer, buckets.studentData, 'No students in database yet.');
    await populateAttendanceStudentOptions();
  }

  function renderLeadStageBoard(leads) {
    if (!elements.leadStageBoard) return;
    if (!window.CrmLeads || typeof window.CrmLeads.summarize !== 'function') {
      elements.leadStageBoard.innerHTML = '';
      return;
    }

    const counts = window.CrmLeads.summarize(leads);
    elements.leadStageBoard.innerHTML = window.CrmLeads.STAGES.map((stage) => `
      <div class="crm-lead-stage-card">
        <div class="text-muted">${escapeHtml(window.CrmLeads.formatStageLabel(stage))}</div>
        <strong>${escapeHtml(String(counts[stage] || 0))}</strong>
      </div>
    `).join('');
  }

  function renderLeadTable(leads) {
    if (!elements.leadListContainer) return;
    if (!Array.isArray(leads) || !leads.length) {
      elements.leadListContainer.innerHTML = 'No leads yet.';
      return;
    }

    elements.leadListContainer.innerHTML = `
      <div class="crm-table-container">
        <table class="crm-table">
          <thead>
            <tr><th>Name</th><th>Contact</th><th>Source</th><th>Stage</th><th>Probability</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${leads.map((lead) => `
              ${(() => {
                const isConverted = window.CrmLeads.isConvertedLead(lead);
                const stageOptions = window.CrmLeads.getSelectableStages(lead.stage);
                return `
              <tr>
                <td class="td-bold">
                  <div class="crm-name-cell">
                    <button type="button" class="crm-student-link crm-lead-link" data-lead-id="${escapeHtml(lead.leadId)}">${escapeHtml(lead.name || lead.email || 'Unnamed lead')}</button>
                    ${renderReminderBadgeMarkup(getReminderSummary({ leadId: lead.leadId }))}
                  </div>
                </td>
                <td>${escapeHtml(lead.email || lead.phone || lead.zalo || '—')}</td>
                <td>${escapeHtml(lead.source || '—')}</td>
                <td>
                  <select class="crm-input crm-inline-select lead-stage-select" data-lead-id="${escapeHtml(lead.leadId)}" ${isConverted ? 'disabled' : ''}>
                    ${stageOptions.map((stage) => `
                      <option value="${stage}" ${stage === lead.stage ? 'selected' : ''}>${escapeHtml(window.CrmLeads.formatStageLabel(stage))}</option>
                    `).join('')}
                  </select>
                </td>
                <td>${escapeHtml(lead.probability == null ? '—' : `${lead.probability}%`)}</td>
                <td>
                  <div class="crm-inline-fields">
                    <button type="button" class="crm-btn-secondary btn-update-lead-stage" data-lead-id="${escapeHtml(lead.leadId)}" ${isConverted ? 'disabled' : ''}>Update</button>
                    <button type="button" class="crm-btn-primary btn-convert-lead" data-lead-id="${escapeHtml(lead.leadId)}" ${lead.studentId ? 'disabled' : ''}>${lead.studentId ? 'Converted' : 'Convert'}</button>
                  </div>
                </td>
              </tr>
            `;
              })()}
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    const leadIndex = new Map(leads.map((lead) => [String(lead.leadId || '').trim(), lead]));

    Array.from(elements.leadListContainer.querySelectorAll('.crm-lead-link[data-lead-id]')).forEach((button) => {
      button.addEventListener('click', () => {
        modalState.leadId = String(button.dataset.leadId || '').trim();
        const lead = leadIndex.get(modalState.leadId) || null;
        if (elements.leadWorkspaceTitle) {
          elements.leadWorkspaceTitle.textContent = lead?.name || lead?.email || 'Lead Workspace';
        }
        refreshLeadWorkspace().catch((error) => {
          console.error('[CRM Admin] Open lead workspace failed:', error);
          showToast(error?.message || 'Failed to load lead workspace.', 'error');
        });
      });
    });

    Array.from(elements.leadListContainer.querySelectorAll('.btn-update-lead-stage')).forEach((button) => {
      button.addEventListener('click', async () => {
        const leadId = String(button.dataset.leadId || '').trim();
        const select = elements.leadListContainer.querySelector(`.lead-stage-select[data-lead-id="${leadId}"]`);
        const stage = String(select?.value || '').trim();
        try {
          button.disabled = true;
          await apiFetchJson(`/api/admin/leads/${encodeURIComponent(leadId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage })
          });
          await refreshLeadPipeline();
          showToast('Lead updated.', 'success');
        } catch (error) {
          console.error('[CRM Admin] Update lead stage failed:', error);
          showToast(error?.message || 'Failed to update lead.', 'error');
          button.disabled = false;
        }
      });
    });

    Array.from(elements.leadListContainer.querySelectorAll('.btn-convert-lead')).forEach((button) => {
      button.addEventListener('click', async () => {
        const leadId = String(button.dataset.leadId || '').trim();
        try {
          button.disabled = true;
          await apiFetchJson(`/api/admin/leads/${encodeURIComponent(leadId)}/convert`, {
            method: 'POST'
          });
          await Promise.all([
            refreshLeadPipeline(),
            refreshStudentLists()
          ]);
          showToast('Lead converted to student.', 'success');
        } catch (error) {
          console.error('[CRM Admin] Convert lead failed:', error);
          showToast(error?.message || 'Failed to convert lead.', 'error');
          button.disabled = false;
        }
      });
    });
  }

  async function refreshLeadPipeline() {
    const json = await apiFetchJson('/api/admin/leads?limit=200', { method: 'GET' });
    const leads = Array.isArray(json.leads) ? json.leads : [];
    dataCache.leads = leads;
    renderLeadStageBoard(leads);
    renderLeadTable(leads);
    if (modalState.leadId && !leads.find((lead) => String(lead.leadId || '') === String(modalState.leadId))) {
      modalState.leadId = null;
      if (elements.leadWorkspace) elements.leadWorkspace.style.display = 'none';
    } else if (modalState.leadId) {
      await refreshLeadWorkspace();
    }
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

    const openFreshCourseModal = () => {
      resetCourseModal();
      openCourseModal();
    };

    const closeCourseModal = () => {
      elements.courseModal.style.display = 'none';
      elements.courseModal.setAttribute('aria-hidden', 'true');
    };

    elements.btnNewCourseTriggers.forEach((btn) => {
      btn.addEventListener('click', openFreshCourseModal);
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

  function setupClassroomModal() {
    if (!elements.classroomModal || elements.btnNewClassroomTriggers.length === 0) return;

    const openFreshClassroomModal = () => {
      resetClassroomModal();
      openClassroomModal();
    };

    const closeClassroomModal = () => {
      elements.classroomModal.style.display = 'none';
      elements.classroomModal.setAttribute('aria-hidden', 'true');
    };

    elements.btnNewClassroomTriggers.forEach(btn => btn.addEventListener('click', openFreshClassroomModal));
    if (elements.btnCloseClassroomModal) elements.btnCloseClassroomModal.addEventListener('click', closeClassroomModal);
    if (elements.btnCancelClassroom) elements.btnCancelClassroom.addEventListener('click', closeClassroomModal);

    if (elements.btnSaveClassroomSettings) {
      elements.btnSaveClassroomSettings.addEventListener('click', () => {
        saveClassroomSettings().then(() => {
          showToast('Settings saved successfully.', 'success');
        }).catch(e => {
          console.error('[CRM Admin] Save classroom failed:', e);
          showToast(e?.message || 'Failed to save classroom.', 'error');
        });
      });
    }

    elements.classroomSidebarItems.forEach(btn => {
      btn.addEventListener('click', () => {
        switchClassroomTab(btn.dataset.tab);
      });
    });

    if (elements.btnAddModule) {
      elements.btnAddModule.addEventListener('click', async () => {
        if (!modalState.classroomId) return showToast('Please save classroom settings first.', 'error');
        const title = prompt('Enter module title:');
        if (!title) return;
        try {
          await window.ClassroomAPI.createModule(modalState.classroomId, { title, orderIndex: Date.now() });
          showToast('Module created.', 'success');
          loadClassroomModules(modalState.classroomId);
        } catch (e) { showToast(e.message, 'error'); }
      });
    }

    if (elements.btnPostAnnouncement) {
      elements.btnPostAnnouncement.addEventListener('click', async () => {
        if (!modalState.classroomId) return showToast('Please save classroom settings first.', 'error');
        const text = elements.inputStreamPost.value.trim();
        if (!text) return;
        try {
          elements.btnPostAnnouncement.disabled = true;
          await firebase.firestore().collection('crmClassrooms').doc(modalState.classroomId).collection('posts').add({
            content: text,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            author: firebase.auth().currentUser.email || 'Admin'
          });
          elements.inputStreamPost.value = '';
          showToast('Announcement posted.', 'success');
          loadClassroomStream(modalState.classroomId);
        } catch (e) { 
          showToast(e.message, 'error'); 
        } finally {
          elements.btnPostAnnouncement.disabled = false;
        }
      });
    }

    if (elements.btnAddClasswork) {
      elements.btnAddClasswork.addEventListener('click', () => {
        if (!modalState.classroomId) return showToast('Please save classroom settings first.', 'error');
        elements.classworkComposer.style.display = 'block';
      });
    }

    if (elements.btnCancelClasswork) {
      elements.btnCancelClasswork.addEventListener('click', () => {
        elements.classworkComposer.style.display = 'none';
      });
    }

    if (elements.btnSaveClassworkDraft) {
      elements.btnSaveClassworkDraft.addEventListener('click', async () => {
        if (!modalState.classroomId) return;
        const payload = {
          title: elements.inputClassworkTitle.value.trim(),
          type: elements.inputClassworkType.value,
          moduleId: elements.inputClassworkModule.value,
          allowVoiceNote: elements.inputClassworkVoice.checked,
          attemptLimit: 4
        };
        if (!payload.title) return showToast('Title is required', 'error');
        try {
          await window.ClassroomAPI.createClasswork(modalState.classroomId, payload);
          showToast('Classwork created.', 'success');
          elements.classworkComposer.style.display = 'none';
          elements.inputClassworkTitle.value = '';
          loadClassroomClasswork(modalState.classroomId);
        } catch (e) { showToast(e.message, 'error'); }
      });
    }

    if (elements.btnEnrollStudent) {
      elements.btnEnrollStudent.addEventListener('click', () => {
        enrollStudentIntoClassroom().catch((e) => {
          console.error('[CRM Admin] Enroll student failed:', e);
          showToast(e?.message || 'Failed to enroll student.', 'error');
        });
      });
    }

    if (elements.btnCreateAttendanceSession) {
      elements.btnCreateAttendanceSession.addEventListener('click', () => {
        createAttendanceSessionForClassroom().catch((e) => {
          console.error('[CRM Admin] Create attendance session failed:', e);
          showToast(e?.message || 'Failed to create attendance session.', 'error');
        });
      });
    }

    if (elements.btnSaveAttendanceRecords) {
      elements.btnSaveAttendanceRecords.addEventListener('click', () => {
        saveAttendanceRecordsForClassroom().catch((e) => {
          console.error('[CRM Admin] Save attendance failed:', e);
          showToast(e?.message || 'Failed to save attendance records.', 'error');
        });
      });
    }
  }

  function resetClassroomModal() {
    modalState.classroomId = null;
    switchClassroomTab('settings');
    if (elements.inputClassroomName) elements.inputClassroomName.value = '';
    if (elements.inputClassroomCourseId) {
      elements.inputClassroomCourseId.value = '';
      populateClassroomCourseOptions().catch((e) => {
        console.error('[CRM Admin] Failed to populate classroom course options:', e);
      });
    }
    if (elements.inputClassroomStatus) elements.inputClassroomStatus.value = 'draft';
    if (elements.classroomStatusBadge) {
      elements.classroomStatusBadge.textContent = 'Draft';
      elements.classroomStatusBadge.style.display = 'inline-flex';
    }
    if (elements.classroomTitle) elements.classroomTitle.textContent = 'New Classroom';
    if (elements.modulesListContainer) elements.modulesListContainer.innerHTML = '<p class="text-muted">No modules yet.</p>';
    if (elements.classworkListContainer) elements.classworkListContainer.innerHTML = '<p class="text-muted">No classwork yet.</p>';
    if (elements.classworkComposer) elements.classworkComposer.style.display = 'none';
    if (elements.inputAttendanceStudentSelect) elements.inputAttendanceStudentSelect.innerHTML = '<option value="">Select a student...</option>';
    if (elements.attendanceEnrollmentMeta) elements.attendanceEnrollmentMeta.textContent = 'No enrollments yet.';
    if (elements.inputAttendanceSessionDate) elements.inputAttendanceSessionDate.value = '';
    if (elements.inputAttendanceSessionTitle) elements.inputAttendanceSessionTitle.value = '';
    if (elements.inputAttendanceSessionSelect) elements.inputAttendanceSessionSelect.innerHTML = '<option value="">Select a session...</option>';
    if (elements.attendanceRosterContainer) elements.attendanceRosterContainer.innerHTML = '<div class="crm-muted">No attendance roster yet.</div>';
  }

  function switchClassroomTab(tabId) {
    elements.classroomSidebarItems.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
    elements.classroomTabContents.forEach(content => {
      const isMatch = content.id === `classroom-${tabId}`;
      content.style.display = isMatch ? (tabId === 'review-board' ? 'flex' : 'block') : 'none';
      content.classList.toggle('active', isMatch);
    });

    if (tabId === 'review-board' && modalState.classroomId) {
      loadReviewBoard(modalState.classroomId);
    }
    if (tabId === 'stream' && modalState.classroomId) {
      loadClassroomStream(modalState.classroomId);
    }
    if (tabId === 'attendance' && modalState.classroomId) {
      loadClassroomAttendance(modalState.classroomId);
    }
  }

  async function populateAttendanceStudentOptions() {
    if (!elements.inputAttendanceStudentSelect) return;
    const options = dataCache.students.map((student) => {
      const label = student.name || student.email || student.studentId || 'Student';
      return `<option value="${escapeHtml(student.studentId || '')}">${escapeHtml(label)}</option>`;
    }).join('');
    elements.inputAttendanceStudentSelect.innerHTML = '<option value="">Select a student...</option>' + options;
  }

  function renderAttendanceRoster(summaryRows) {
    if (!elements.attendanceRosterContainer) return;
    const rows = Array.isArray(summaryRows) ? summaryRows : [];
    const selectedSessionId = String(elements.inputAttendanceSessionSelect?.value || '').trim();

    if (!rows.length) {
      elements.attendanceRosterContainer.innerHTML = '<div class="crm-muted">No enrollments yet.</div>';
      return;
    }

    elements.attendanceRosterContainer.innerHTML = `
      <div class="crm-table-container">
        <table class="crm-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Attendance</th>
              <th>Risk</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Intervention</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="attendance-row" data-student-id="${escapeHtml(row.studentId || '')}" data-student-uid="${escapeHtml(row.studentUid || '')}">
                <td class="td-bold">${escapeHtml(row.studentName || 'Student')}</td>
                <td>${escapeHtml(`${Math.round(Number(row.attendanceRate || 0) * 100)}% (${row.presentCount || 0}/${row.totalSessions || 0})`)}</td>
                <td>${renderRiskBadgeMarkup(row.studentId)}</td>
                <td>
                  <select class="crm-input crm-inline-select crm-attendance-select attendance-status" ${selectedSessionId ? '' : 'disabled'}>
                    <option value="present">Present</option>
                    <option value="late">Late</option>
                    <option value="absent">Absent</option>
                  </select>
                </td>
                <td><input type="text" class="crm-input attendance-reason" placeholder="Reason" ${selectedSessionId ? '' : 'disabled'}></td>
                <td style="text-align:center;"><input type="checkbox" class="attendance-intervention" ${selectedSessionId ? '' : 'disabled'}></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function loadClassroomAttendance(classId) {
    if (!window.ClassroomAPI || typeof window.ClassroomAPI.fetchAttendanceSummary !== 'function') return;

    await populateAttendanceStudentOptions();
    const summary = await window.ClassroomAPI.fetchAttendanceSummary({ classId });
    const sessions = Array.isArray(summary?.sessions) ? summary.sessions : [];
    const students = Array.isArray(summary?.students) ? summary.students : [];

    if (elements.inputAttendanceSessionSelect) {
      const currentValue = String(elements.inputAttendanceSessionSelect.value || '').trim();
      elements.inputAttendanceSessionSelect.innerHTML = '<option value="">Select a session...</option>' + sessions.map((session) => `
        <option value="${escapeHtml(session.sessionId || '')}">${escapeHtml(session.title || session.sessionDate || 'Session')}</option>
      `).join('');
      if (currentValue) {
        elements.inputAttendanceSessionSelect.value = currentValue;
      }
    }

    if (elements.attendanceEnrollmentMeta) {
      elements.attendanceEnrollmentMeta.textContent = students.length
        ? `${students.length} active enrollment${students.length === 1 ? '' : 's'} in this classroom.`
        : 'No enrollments yet.';
    }

    dataCache.attendanceRiskByStudentId = new Map(
      [
        ...Array.from(dataCache.attendanceRiskByStudentId.entries()),
        ...students.map((row) => [String(row.studentId || '').trim(), row])
      ]
    );

    renderAttendanceRoster(students);
  }

  async function enrollStudentIntoClassroom() {
    if (!modalState.classroomId) throw new Error('Save classroom settings first.');
    const studentId = String(elements.inputAttendanceStudentSelect?.value || '').trim();
    if (!studentId) throw new Error('Select a student first.');
    const student = dataCache.students.find((item) => String(item.studentId || '') === studentId);
    if (!student) throw new Error('Selected student is not available.');

    const payload = window.CrmEnrollments && typeof window.CrmEnrollments.buildEnrollmentPayload === 'function'
      ? window.CrmEnrollments.buildEnrollmentPayload(elements, student)
      : {
          studentId,
          studentUid: student.linked_user_ids?.[0] || null,
          studentName: student.name || null,
          studentEmail: student.email || null
        };

    await window.ClassroomAPI.createEnrollment({
      ...payload,
      classId: modalState.classroomId,
      courseId: String(elements.inputClassroomCourseId?.value || '').trim() || null
    });

    await Promise.all([
      loadClassroomAttendance(modalState.classroomId),
      refreshAttendanceRiskSnapshot()
    ]);
    showToast('Student enrolled.', 'success');
  }

  async function createAttendanceSessionForClassroom() {
    if (!modalState.classroomId) throw new Error('Save classroom settings first.');
    if (!window.CrmAttendance || typeof window.CrmAttendance.buildSessionPayload !== 'function') {
      throw new Error('Attendance helpers are not available.');
    }

    const payload = window.CrmAttendance.buildSessionPayload({
      inputAttendanceSessionDate: elements.inputAttendanceSessionDate,
      inputAttendanceSessionTitle: elements.inputAttendanceSessionTitle
    });

    const json = await window.ClassroomAPI.createAttendanceSession({
      classId: modalState.classroomId,
      ...payload
    });

    const sessionId = String(json.sessionId || json.session?.sessionId || '').trim();
    await loadClassroomAttendance(modalState.classroomId);
    if (sessionId && elements.inputAttendanceSessionSelect) {
      elements.inputAttendanceSessionSelect.value = sessionId;
    }
    showToast('Attendance session created.', 'success');
  }

  async function saveAttendanceRecordsForClassroom() {
    if (!modalState.classroomId) throw new Error('Save classroom settings first.');
    const sessionId = String(elements.inputAttendanceSessionSelect?.value || '').trim();
    if (!sessionId) throw new Error('Select an attendance session first.');
    if (!window.CrmAttendance || typeof window.CrmAttendance.buildBulkRecordPayload !== 'function') {
      throw new Error('Attendance helpers are not available.');
    }

    const rows = Array.from(document.querySelectorAll('#attendance-roster-container .attendance-row'));
    const records = window.CrmAttendance.buildBulkRecordPayload(rows).map((record) => ({
      sessionId,
      ...record
    }));

    await window.ClassroomAPI.saveAttendanceRecords({
      classId: modalState.classroomId,
      records
    });

    await Promise.all([
      loadClassroomAttendance(modalState.classroomId),
      refreshAttendanceRiskSnapshot()
    ]);
    showToast('Attendance saved.', 'success');
  }

  async function loadClassroomStream(classId) {
    if (!elements.streamPostsContainer) return;
    try {
      const snap = await firebase.firestore().collection('crmClassrooms').doc(classId).collection('posts').orderBy('createdAt', 'desc').get();
      if (snap.empty) {
        elements.streamPostsContainer.innerHTML = '<p class="text-muted">No announcements yet.</p>';
        return;
      }
      elements.streamPostsContainer.innerHTML = snap.docs.map(doc => {
        const data = doc.data();
        return `
          <div class="stream-card" style="padding: 16px; margin-bottom: 12px; background: white; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 0.85rem; color: #718096; margin-bottom: 8px;">
              <strong>${escapeHtml(data.author || 'Admin')}</strong> • ${formatDateTime(data.createdAt)}
            </div>
            <div>${escapeHtml(data.content)}</div>
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
    }
  }

  async function loadReviewBoard(classId) {
    if (!elements.kanbanMissingList || !elements.kanbanTurnedInList || !elements.kanbanGradedList) return;

    elements.kanbanTurnedInList.innerHTML = '<div class="crm-loading-spinner small"></div>';
    elements.kanbanMissingList.innerHTML = '<div class="crm-loading-spinner small"></div>';

    try {
      const board = await window.ClassroomAPI.fetchReviewBoard(classId);
      const submissions = Array.isArray(board?.submissions) ? board.submissions : [];

      const turnedIn = submissions.filter(s => s.status === 'turned-in');
      const graded = submissions.filter(s => s.status === 'graded');
      const missing = Array.isArray(board?.missing) ? board.missing : [];

      renderKanbanColumn(elements.kanbanTurnedInList, turnedIn, true);
      renderKanbanColumn(elements.kanbanGradedList, graded, false);
      renderKanbanColumn(elements.kanbanMissingList, missing, false);

    } catch (e) {
      console.error('[CRM Admin] Kanban load failed:', e);
      showToast('Failed to load review board.', 'error');
    }
  }

  function renderKanbanColumn(container, list, allowGrading) {
    if (!list.length) {
      container.innerHTML = '<p class="crm-muted" style="padding:10px;">None found.</p>';
      return;
    }

    container.innerHTML = list.map(s => `
      <div class="crm-kanban-card" data-sub-id="${s.id}">
        <div class="card-user">
          <strong>${escapeHtml(s.studentName || s.studentEmail || 'Student')}</strong>
          <span class="text-muted" style="font-size:0.75rem;">UID: ${escapeHtml(s.studentUid)}</span>
        </div>
        <div class="card-work">
          Work ID: ${escapeHtml(s.workId)}
        </div>
        ${s.audio ? `
          <button class="btn-play-audio" data-path="${s.audio.storagePath}">▶ Listen Audio</button>
        ` : ''}
        ${allowGrading ? `
          <div class="grading-actions" style="margin-top:10px;">
            <input type="text" placeholder="Grade/Score" class="crm-input-small grade-val" style="margin-bottom:5px;">
            <button class="crm-btn-primary small btn-grade-submit">Submit Grade</button>
          </div>
        ` : `
          <div class="graded-status">
            Grade: <strong>${escapeHtml(s.grade || 'N/A')}</strong>
          </div>
        `}
      </div>
    `).join('');

    // Attach listeners
    container.querySelectorAll('.btn-grade-submit').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.crm-kanban-card');
        const sid = card.dataset.subId;
        const grade = card.querySelector('.grade-val').value.trim();
        if (!grade) return showToast('Enter a grade first.', 'error');

        try {
          btn.disabled = true;
          await window.ClassroomAPI.gradeSubmission(sid, { grade });
          showToast('Graded.', 'success');
          loadReviewBoard(modalState.classroomId);
        } catch (e) {
          showToast(e.message, 'error');
          btn.disabled = false;
        }
      });
    });

    // Audio playback logic
    container.querySelectorAll('.btn-play-audio').forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = btn.dataset.path;
        try {
          btn.disabled = true;
          const originalText = btn.textContent;
          btn.textContent = 'Loading...';
          const url = await firebase.storage().ref(path).getDownloadURL();
          const audio = new Audio(url);
          audio.play();
          btn.textContent = 'Playing...';
          audio.onended = () => {
            btn.disabled = false;
            btn.textContent = originalText;
          };
        } catch (e) {
          console.error('[CRM Admin] Audio playback failed:', e);
          showToast('Failed to load audio.', 'error');
          btn.disabled = false;
          btn.textContent = '▶ Listen Audio';
        }
      });
    });
  }

  async function saveClassroomSettings() {
    const payload = window.CrmClassrooms && typeof window.CrmClassrooms.buildPayload === 'function'
      ? window.CrmClassrooms.buildPayload(elements)
      : {
          name: elements.inputClassroomName.value.trim(),
          courseId: elements.inputClassroomCourseId.value,
          status: elements.inputClassroomStatus.value
        };
    if (!payload.name) throw new Error('Classroom name is required.');

    const res = modalState.classroomId
      ? await window.ClassroomAPI.updateClassroom(modalState.classroomId, payload)
      : await window.ClassroomAPI.createClassroom(payload);
    modalState.classroomId = String(res.classroomId || res.classroom?.classroomId || modalState.classroomId || '').trim();
    if (elements.classroomStatusBadge) elements.classroomStatusBadge.textContent = payload.status;
    if (elements.classroomTitle) elements.classroomTitle.textContent = payload.name;
    await refreshClassroomList();
  }

  async function refreshClassroomList() {
    if (!elements.classManagementGrid) return;
    try {
      const [classrooms, courses] = await Promise.all([
        window.ClassroomAPI.fetchClassrooms(),
        fetchCoursesFromCatalog().catch(() => [])
      ]);
      const courseIndex = new Map(courses.map((course) => [String(course.id || ''), course]));
      if (!classrooms.length) {
        elements.classManagementGrid.innerHTML = '<div class="crm-muted">No classrooms found.</div>';
        return;
      }
      elements.classManagementGrid.innerHTML = `
        <div class="crm-table-container">
          <table class="crm-table">
            <thead>
              <tr><th>Name</th><th>Course</th><th>Status</th><th>Modules</th></tr>
            </thead>
            <tbody>
              ${classrooms.map(c => `
                <tr>
                  <td class="td-bold">
                    <button type="button" class="crm-student-link crm-classroom-link" data-classroom-id="${escapeHtml(c.classroomId || c.id || '')}">
                      ${escapeHtml(c.name)}
                    </button>
                  </td>
                  <td>${escapeHtml(courseIndex.get(String(c.courseId || ''))?.name || c.courseId || 'None')}</td>
                  <td>${escapeHtml(c.status)}</td>
                  <td>n/a</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      const classroomIndex = new Map(classrooms.map((classroom) => [String(classroom.classroomId || classroom.id || ''), classroom]));
      Array.from(elements.classManagementGrid.querySelectorAll('button.crm-classroom-link[data-classroom-id]')).forEach((button) => {
        button.addEventListener('click', async () => {
          const classroomId = String(button.dataset.classroomId || '').trim();
          const classroom = classroomIndex.get(classroomId);
          if (!classroom) return;

          resetClassroomModal();
          await populateClassroomCourseOptions({ selectedValue: classroom.courseId || '' });
          if (window.CrmClassrooms && typeof window.CrmClassrooms.applyToForm === 'function') {
            window.CrmClassrooms.applyToForm(elements, classroom);
          }
          modalState.classroomId = classroomId;
          if (elements.classroomStatusBadge) {
            elements.classroomStatusBadge.textContent = classroom.status || 'draft';
            elements.classroomStatusBadge.style.display = 'inline-flex';
          }
          if (elements.classroomTitle) {
            elements.classroomTitle.textContent = classroom.name || 'Classroom';
          }
          openClassroomModal();
          await loadClassroomModules(classroomId);
          await loadClassroomClasswork(classroomId);
        });
      });
    } catch (e) {
      elements.classManagementGrid.innerHTML = '<div class="crm-muted">Failed to load classrooms.</div>';
    }
  }

  async function loadClassroomModules(classId) {
    if (!elements.modulesListContainer) return;
    try {
      const modules = await window.ClassroomAPI.loadModules(classId);
      elements.modulesListContainer.innerHTML = modules.length ? modules.map(m => `
        <div class="module-list-item">
          <strong>${escapeHtml(m.title)}</strong>
        </div>
      `).join('') : '<p class="text-muted">No modules yet.</p>';

      // Update the classwork select dropdown
      if (elements.inputClassworkModule) {
        elements.inputClassworkModule.innerHTML = '<option value="">No Module</option>' +
          modules.map(m => `<option value="${m.id}">${escapeHtml(m.title)}</option>`).join('');
      }
    } catch (e) {
      console.error('[CRM Admin] Failed to load classroom modules:', e);
      elements.modulesListContainer.innerHTML = '<p class="text-muted">Failed to load modules.</p>';
    }
  }

  async function loadClassroomClasswork(classId) {
    if (!elements.classworkListContainer) return;
    try {
      const works = await window.ClassroomAPI.loadClasswork(classId);
      elements.classworkListContainer.innerHTML = works.length ? works.map(w => `
        <div class="classwork-card">
          <div>
            <strong>${escapeHtml(w.title)}</strong>
            <div class="text-muted" style="font-size: 0.85rem; margin-top: 4px;">Type: ${escapeHtml(w.type)}</div>
          </div>
        </div>
      `).join('') : '<p class="text-muted">No classwork yet.</p>';
    } catch (e) {
      console.error('[CRM Admin] Failed to load classroom classwork:', e);
      elements.classworkListContainer.innerHTML = '<p class="text-muted">Failed to load classwork.</p>';
    }
  }

  async function fetchCoursesFromCatalog() {
    if (window.CrmCourses && typeof window.CrmCourses.fetchCourses === 'function') {
      return window.CrmCourses.fetchCourses();
    }
    if (window.ClassroomAPI && typeof window.ClassroomAPI.fetchCourses === 'function') {
      return window.ClassroomAPI.fetchCourses();
    }
    throw new Error('Course catalog helpers are not available.');
  }

  async function populateClassroomCourseOptions(options = {}) {
    if (!elements.inputClassroomCourseId) return [];

    const selectedValue = String(options.selectedValue || elements.inputClassroomCourseId.value || '').trim();
    if (window.CrmCourses && typeof window.CrmCourses.populateCourseSelect === 'function') {
      return window.CrmCourses.populateCourseSelect(elements.inputClassroomCourseId, {
        placeholder: 'Select a Course...',
        selectedValue
      });
    }

    const courses = await fetchCoursesFromCatalog();
    elements.inputClassroomCourseId.innerHTML = '<option value="">Select a Course...</option>' + courses.map((course) => {
      const label = course.code ? `${course.name} (${course.code})` : course.name;
      return `<option value="${course.id}">${label}</option>`;
    }).join('');
    if (selectedValue) {
      elements.inputClassroomCourseId.value = selectedValue;
    }
    return courses;
  }

  async function refreshCourseCatalog() {
    const container = elements.courseCatalogContainer;
    if (!container) return;

    try {
      const courses = await fetchCoursesFromCatalog();
      await populateClassroomCourseOptions({ selectedValue: elements.inputClassroomCourseId?.value || '' });

      if (!courses.length) {
        container.innerHTML = '<div class="crm-muted">No courses found.</div>';
        return;
      }

      container.innerHTML = `
        <div class="crm-table-container">
          <table class="crm-table">
            <thead>
              <tr><th>Name</th><th>Code</th><th>Status</th><th>Teachers</th></tr>
            </thead>
            <tbody>
              ${courses.map((course) => `
                <tr>
                  <td class="td-bold">
                    <button type="button" class="crm-student-link crm-course-link" data-course-id="${escapeHtml(course.id || course.courseId || '')}">
                      ${escapeHtml(course.name || 'Untitled')}
                    </button>
                  </td>
                  <td>${escapeHtml(course.code || '—')}</td>
                  <td>${escapeHtml(course.status || 'active')}</td>
                  <td>${escapeHtml((course.teachers || []).join(', ') || 'None')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      const courseIndex = new Map(courses.map((course) => [String(course.id || course.courseId || ''), course]));
      Array.from(container.querySelectorAll('button.crm-course-link[data-course-id]')).forEach((button) => {
        button.addEventListener('click', () => {
          const courseId = String(button.dataset.courseId || '').trim();
          const course = courseIndex.get(courseId);
          if (!course) return;

          resetCourseModal();
          applyCourseToForm(course);
          openCourseModal();
        });
      });
    } catch (error) {
      console.error('[CRM Admin] Failed to refresh course catalog:', error);
      container.innerHTML = '<div class="crm-muted">Failed to load courses.</div>';
    }
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
