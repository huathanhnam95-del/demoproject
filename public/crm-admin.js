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
    studentProfile: null,
    createdTestLinks: new Map(),
    courseId: null,
    classroomId: null,
    leadId: null,
    selectedInvoiceId: null,
    financeEnrollments: [],
    financeWorkflow: null,
    classroomMatches: [],
    liveSessions: [],
    liveSessionId: null
  };
  let studentFinanceController = null;
  let liveDeliveryController = null;
  let classroomWorkspaceController = null;
  let classroomModalController = null;
  let studentWorkspaceController = null;
  let taskActivityWorkspaceController = null;
  let studentModalController = null;
  let courseModalController = null;
  let leadWorkspaceController = null;
  let communicationsController = null;
  let dashboardController = null;
  let studentDirectoryController = null;
  let activitySurfacesController = null;

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
    elements.zoomLinksGrid = document.getElementById('zoom-links-grid');
    elements.btnNewLead = document.getElementById('btn-new-lead');
    elements.btnSaveLead = document.getElementById('btn-save-lead');
    elements.btnCancelLead = document.getElementById('btn-cancel-lead');
    elements.leadComposer = document.getElementById('lead-composer');
    elements.leadStageBoard = document.getElementById('lead-stage-board');
    elements.leadListContainer = document.getElementById('lead-list-container');
    elements.inputLeadName = document.getElementById('lead-name');
    elements.inputLeadEmail = document.getElementById('lead-email');
    elements.inputLeadPhone = document.getElementById('lead-phone');
    elements.inputLeadFacebookDisplayName = document.getElementById('lead-facebook-display-name');
    elements.inputLeadFacebookProfileUrl = document.getElementById('lead-facebook-profile-url');
    elements.inputLeadRealName = document.getElementById('lead-real-name');
    elements.inputLeadDateOfBirth = document.getElementById('lead-date-of-birth');
    elements.inputLeadSource = document.getElementById('lead-source');
    elements.inputLeadStage = document.getElementById('lead-stage');
    elements.inputLeadProbability = document.getElementById('lead-probability');
    elements.inputLeadLearningNeeds = document.getElementById('lead-learning-needs');
    elements.inputLeadPreferredLearningDays = document.getElementById('lead-preferred-learning-days');
    elements.inputLeadPreferredLearningHours = document.getElementById('lead-preferred-learning-hours');
    elements.inputLeadMessengerThreadUrl = document.getElementById('lead-messenger-thread-url');
    elements.inputLeadMessengerLastContactAt = document.getElementById('lead-messenger-last-contact-at');
    elements.inputLeadMessengerStatus = document.getElementById('lead-messenger-status');
    elements.leadWorkspace = document.getElementById('lead-workspace');
    elements.leadWorkspaceTitle = document.getElementById('lead-workspace-title');
    elements.leadWorkspaceMeta = document.getElementById('lead-workspace-meta');
    elements.leadWorkspaceBadge = document.getElementById('lead-workspace-badge');
    elements.leadContextSummary = document.getElementById('lead-context-summary');
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
    elements.inputTemplateName = document.getElementById('template-name');
    elements.inputTemplateChannel = document.getElementById('template-channel');
    elements.inputTemplateSubject = document.getElementById('template-subject');
    elements.inputTemplateBody = document.getElementById('template-body');
    elements.btnCreateTemplate = document.getElementById('btn-create-template');
    elements.inputRuleName = document.getElementById('rule-name');
    elements.inputRuleTriggerType = document.getElementById('rule-trigger-type');
    elements.inputRuleTemplateId = document.getElementById('rule-template-id');
    elements.btnCreateRule = document.getElementById('btn-create-rule');
    elements.automationList = document.getElementById('automation-list');
    elements.dashboardSummaryCards = document.getElementById('dashboard-summary-cards');
    elements.dashboardFunnel = document.getElementById('dashboard-funnel');
    elements.dashboardRevenue = document.getElementById('dashboard-revenue');
    elements.dashboardDuplicates = document.getElementById('dashboard-duplicates');
    elements.dashboardAuditLogs = document.getElementById('dashboard-audit-logs');
    elements.inputMergePrimaryStudentId = document.getElementById('merge-primary-student-id');
    elements.inputMergeDuplicateStudentIds = document.getElementById('merge-duplicate-student-ids');
    elements.btnCreateMergeJob = document.getElementById('btn-create-merge-job');

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
    elements.inputTargetExam = document.getElementById('student-target-exam');
    elements.inputTargetScore = document.getElementById('student-target-score');
    elements.inputPreferredSchedule = document.getElementById('student-preferred-schedule');
    elements.inputPreferredLearningDays = document.getElementById('student-preferred-learning-days');
    elements.inputPreferredLearningHours = document.getElementById('student-preferred-learning-hours');
    elements.inputScoreHistory = document.getElementById('student-score-history');
    elements.inputGuardianContacts = document.getElementById('student-guardian-contacts');
    elements.inputCompanyContacts = document.getElementById('student-company-contacts');
    elements.inputDocumentRefs = document.getElementById('student-document-refs');
    elements.inputCounselingNotes = document.getElementById('student-counseling-notes');
    elements.studentClassroomMatchSummary = document.getElementById('student-classroom-match-summary');
    elements.inputStudentClassroomMatchSelect = document.getElementById('student-classroom-match-select');
    elements.studentClassroomMatchMeta = document.getElementById('student-classroom-match-meta');
    elements.studentClassroomMatchWarning = document.getElementById('student-classroom-match-warning');
    elements.studentSchedulePrompt = document.getElementById('student-schedule-prompt');
    elements.btnCreateRecommendedEnrollment = document.getElementById('btn-create-recommended-enrollment');
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
    elements.studentFinanceInvoiced = document.getElementById('student-finance-invoiced');
    elements.studentFinancePaid = document.getElementById('student-finance-paid');
    elements.studentFinanceOutstanding = document.getElementById('student-finance-outstanding');
    elements.studentFinanceNextDue = document.getElementById('student-finance-next-due');
    elements.studentFinanceWorkflowPanel = document.getElementById('student-finance-workflow-panel');
    elements.studentFinanceWorkflowBadge = document.getElementById('student-finance-workflow-badge');
    elements.studentFinanceWorkflowNote = document.getElementById('student-finance-workflow-note');
    elements.inputInvoiceAmount = document.getElementById('invoice-amount');
    elements.inputInvoiceDiscount = document.getElementById('invoice-discount');
    elements.inputInvoiceDueDate = document.getElementById('invoice-due-date');
    elements.inputStudentFinanceEnrollment = document.getElementById('student-finance-enrollment');
    elements.studentFinanceEnrollmentMeta = document.getElementById('student-finance-enrollment-meta');
    elements.btnCreateStudentInvoice = document.getElementById('btn-create-student-invoice');
    elements.studentInvoiceList = document.getElementById('student-invoice-list');
    elements.inputPaymentAmount = document.getElementById('payment-amount');
    elements.inputPaymentMethod = document.getElementById('payment-method');
    elements.btnRecordStudentPayment = document.getElementById('btn-record-student-payment');

    // Student ID Badge
    elements.studentIdBadge = document.getElementById('crm-student-id-badge');

    // Entrance Test UI (Learning Profile)
    elements.btnAddEntranceTest = document.getElementById('btn-add-entrance-test');
    elements.entranceTestLinkInput = document.getElementById('entrance-test-link');
    elements.btnCopyEntranceTestLink = document.getElementById('btn-copy-entrance-test-link');
    elements.btnOpenEntranceTestLink = document.getElementById('btn-open-entrance-test-link');
    elements.entranceTestLinkNote = document.getElementById('entrance-test-link-note');
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
    elements.inputClassroomMeetingDays = document.getElementById('classroom-meeting-days');
    elements.inputClassroomMeetingHours = document.getElementById('classroom-meeting-hours');
    elements.classManagementGrid = document.getElementById('class-management-grid');
    elements.classroomStatusBadge = document.getElementById('crm-classroom-status-badge');
    elements.classroomTitle = document.getElementById('crm-classroom-title');
    elements.liveDeliverySummary = document.getElementById('live-delivery-summary');
    elements.liveSessionList = document.getElementById('live-session-list');
    elements.inputLiveSessionTitle = document.getElementById('live-session-title');
    elements.inputLiveSessionStatus = document.getElementById('live-session-status');
    elements.inputLiveSessionStartAt = document.getElementById('live-session-start-at');
    elements.inputLiveSessionEndAt = document.getElementById('live-session-end-at');
    elements.inputLiveSessionMeetingUrl = document.getElementById('live-session-meeting-url');
    elements.inputLiveSessionHostUrl = document.getElementById('live-session-host-url');
    elements.inputLiveSessionMeetingId = document.getElementById('live-session-meeting-id');
    elements.inputLiveSessionPasscode = document.getElementById('live-session-passcode');
    elements.inputLiveSessionNotes = document.getElementById('live-session-notes');
    elements.btnCreateLiveSession = document.getElementById('btn-create-live-session');
    elements.btnSaveLiveSession = document.getElementById('btn-save-live-session');
    elements.btnStartLiveSession = document.getElementById('btn-start-live-session');
    elements.btnEndLiveSession = document.getElementById('btn-end-live-session');
    elements.btnCopyLiveJoinLink = document.getElementById('btn-copy-live-join-link');
    elements.btnCopyLiveHostLink = document.getElementById('btn-copy-live-host-link');
    elements.inputAttendanceStudentSelect = document.getElementById('attendance-student-select');
    elements.attendanceLiveSessionNote = document.getElementById('attendance-live-session-note');
    elements.attendanceClassroomFitNote = document.getElementById('attendance-classroom-fit-note');
    elements.attendanceSchedulePrompt = document.getElementById('attendance-schedule-prompt');
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
    elements.classworkLiveSessionNote = document.getElementById('classwork-live-session-note');
    elements.inputClassworkTitle = document.getElementById('classwork-title');
    elements.inputClassworkType = document.getElementById('classwork-type');
    elements.inputClassworkModule = document.getElementById('classwork-module');
    elements.inputClassworkVoice = document.getElementById('classwork-voice');

    // Classroom Review Board
    elements.kanbanMissingList = document.getElementById('kanban-missing-list');
    elements.kanbanTurnedInList = document.getElementById('kanban-turnedin-list');
    elements.kanbanNeedsRevisionList = document.getElementById('kanban-needsrevision-list');
    elements.kanbanGradedList = document.getElementById('kanban-graded-list');

    // Stream
    elements.btnPostAnnouncement = document.getElementById('btn-post-announcement');
    elements.inputStreamPost = document.getElementById('stream-post-content');
    elements.streamPostsContainer = document.getElementById('stream-posts-container');
  }

  async function init() {
    showGateMessage('Checking admin accessâ€¦', 'Please wait');

    await initFirebaseFromServer();

    const user = await waitForAuthUser({ timeoutMs: 6500 });
    if (!user) {
      showGateMessage('Please log in as admin first.', 'Redirecting to the appâ€¦');
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
    dashboardController = window.CrmDashboardWorkspace && typeof window.CrmDashboardWorkspace.createController === 'function'
      ? window.CrmDashboardWorkspace.createController({
        elements,
        showToast,
        apiFetchJson,
        formatDateTime,
        escapeHtml
      })
      : null;
    communicationsController = window.CrmCommunicationsWorkspace && typeof window.CrmCommunicationsWorkspace.createController === 'function'
      ? window.CrmCommunicationsWorkspace.createController({
        elements,
        showToast,
        apiFetchJson,
        refreshDashboard,
        escapeHtml
      })
      : null;
    studentDirectoryController = window.CrmStudentDirectoryWorkspace && typeof window.CrmStudentDirectoryWorkspace.createController === 'function'
      ? window.CrmStudentDirectoryWorkspace.createController({
        elements,
        dataCache,
        apiFetchJson,
        populateAttendanceStudentOptions,
        openStudentProfile,
        showToast,
        getReminderSummary,
        renderReminderBadgeMarkup,
        renderRiskBadgeMarkup,
        escapeHtml,
        formatDateTime
      })
      : null;
    activitySurfacesController = window.CrmActivitySurfaces && typeof window.CrmActivitySurfaces.createController === 'function'
      ? window.CrmActivitySurfaces.createController({
        elements,
        createTaskForLead,
        createActivityForLead,
        createTaskForStudent,
        createActivityForStudent,
        createInvoiceForStudent,
        recordPaymentForStudent,
        createCommunicationTemplate,
        createAutomationRule,
        createMergeJob,
        showToast
      })
      : null;
    studentFinanceController = window.CrmStudentFinance && typeof window.CrmStudentFinance.createController === 'function'
      ? window.CrmStudentFinance.createController({
        apiFetchJson,
        elements,
        modalState,
        getCurrentStudentProfile,
        renderStudentSchedulePrompt,
        refreshDashboard,
        showToast,
        escapeHtml
      })
      : null;
    liveDeliveryController = window.CrmLiveDelivery && typeof window.CrmLiveDelivery.createController === 'function'
      ? window.CrmLiveDelivery.createController({
        elements,
        modalState,
        escapeHtml,
        formatDateTime,
        formatDateTimeLocalValue,
        renderClassroomSchedulePrompt
      })
      : null;
    classroomWorkspaceController = window.CrmClassroomWorkspace && typeof window.CrmClassroomWorkspace.createController === 'function'
      ? window.CrmClassroomWorkspace.createController({
        elements,
        modalState,
        dataCache,
        showToast,
        escapeHtml,
        formatDateTime,
        openClassroomModal,
        resetClassroomModal,
        refreshAttendanceRiskSnapshot,
        loadLiveSessions,
        getPrimaryLiveSession,
        getSelectedLiveSession,
        collectLiveSessionPayload,
        renderLiveDeliverySummary,
        renderAttendanceWorkflowGuidance,
        renderClassroomSchedulePrompt,
        renderClassworkWorkflowGuidance
      })
      : null;
    studentWorkspaceController = window.CrmStudentWorkspace && typeof window.CrmStudentWorkspace.createController === 'function'
      ? window.CrmStudentWorkspace.createController({
        elements,
        modalState,
        dataCache,
        showToast,
        apiFetchJson,
        fetchStudentProfile,
        openStudentModal,
        resetStudentModal,
        refreshStudentFinance,
        refreshStudentLists,
        refreshDashboard,
        refreshEntranceTestsList,
        switchStudentTab,
        getStudentPayload,
        hasAnyInfoField,
        fetchTasks,
        fetchActivities,
        applyReminderBadge,
        getReminderSummary,
        renderTaskList,
        renderActivityList,
        escapeHtml
      })
      : null;
    taskActivityWorkspaceController = window.CrmTaskActivityWorkspace && typeof window.CrmTaskActivityWorkspace.createController === 'function'
      ? window.CrmTaskActivityWorkspace.createController({
        elements,
        dataCache,
        modalState,
        showToast,
        apiFetchJson,
        fetchTasks,
        fetchActivities,
        refreshStudentTimeline,
        refreshLeadWorkspace,
        refreshStudentLists,
        refreshDashboard,
        renderStudentsTable,
        renderLeadStageBoard,
        renderLeadTable,
        resetLeadTaskComposer,
        resetLeadActivityComposer,
        resetStudentTaskComposer,
        resetStudentActivityComposer
      })
      : null;
    classroomModalController = window.CrmClassroomModal && typeof window.CrmClassroomModal.createController === 'function'
      ? window.CrmClassroomModal.createController({
        elements,
        modalState,
        showToast,
        openClassroomModal,
        saveClassroomSettings,
        loadClassroomModules,
        loadClassroomClasswork,
        loadClassroomStream,
        loadClassroomAttendance,
        loadReviewBoard,
        loadLiveSessions,
        renderClassroomSchedulePrompt,
        renderAttendanceWorkflowGuidance,
        renderClassworkWorkflowGuidance,
        enrollStudentIntoClassroom,
        createAttendanceSessionForClassroom,
        saveAttendanceRecordsForClassroom,
        resetLiveSessionForm,
        renderLiveDeliverySummary,
        saveLiveSession,
        startSelectedLiveSession,
        endSelectedLiveSession,
        getSelectedLiveSession,
        copyToClipboard,
        refreshAttendanceClassroomFitNote,
        populateClassroomCourseOptions
      })
      : null;
    studentModalController = window.CrmStudentModal && typeof window.CrmStudentModal.createController === 'function'
      ? window.CrmStudentModal.createController({
        elements,
        modalState,
        showToast,
        refreshStudentFinance,
        saveStudentProfile,
        createRecommendedEnrollment,
        renderStudentClassroomMatches,
        createEntranceTest,
        copyToClipboard,
        apiFetchJson,
        refreshStudentIdentity,
        applyReminderBadge,
        resetStudentTaskComposer,
        resetStudentActivityComposer,
        resetStudentFinanceComposer,
        renderStudentSchedulePrompt
      })
      : null;
    courseModalController = window.CrmCourseModal && typeof window.CrmCourseModal.createController === 'function'
      ? window.CrmCourseModal.createController({
        elements,
        modalState,
        showToast,
        apiFetchJson,
        refreshCourseCatalog,
        getCoursePayload,
        openCourseModal,
        setCourseTeachers
      })
      : null;
    leadWorkspaceController = window.CrmLeadWorkspace && typeof window.CrmLeadWorkspace.createController === 'function'
      ? window.CrmLeadWorkspace.createController({
        elements,
        dataCache,
        modalState,
        showToast,
        apiFetchJson,
        refreshDashboard,
        refreshStudentLists,
        fetchTasks,
        fetchActivities,
        applyReminderBadge,
        getReminderSummary,
        renderTaskList,
        renderActivityList,
        renderReminderBadgeMarkup,
        escapeHtml
      })
      : null;
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

    refreshCommunicationsManager().catch((e) => {
      console.error('[CRM Admin] Failed to load communications manager:', e);
      showToast(e?.message || 'Failed to load communications manager.', 'error');
    });

    refreshDashboard().catch((e) => {
      console.error('[CRM Admin] Failed to load dashboard:', e);
      showToast(e?.message || 'Failed to load dashboard.', 'error');
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
    if (!studentModalController) return;
    return studentModalController.setupStudentModal();
  }

  function resetStudentModal() {
    if (!studentModalController) return;
    return studentModalController.resetStudentModal();
  }

  function resetCourseModal() {
    if (!courseModalController) return;
    return courseModalController.resetCourseModal();
  }

  function resetLeadComposer() {
    if (leadWorkspaceController) {
      return leadWorkspaceController.resetLeadComposer();
    }
    const inputs = [
      elements.inputLeadName,
      elements.inputLeadEmail,
      elements.inputLeadPhone,
      elements.inputLeadFacebookDisplayName,
      elements.inputLeadFacebookProfileUrl,
      elements.inputLeadRealName,
      elements.inputLeadDateOfBirth,
      elements.inputLeadSource,
      elements.inputLeadProbability,
      elements.inputLeadLearningNeeds,
      elements.inputLeadPreferredLearningDays,
      elements.inputLeadPreferredLearningHours,
      elements.inputLeadMessengerThreadUrl,
      elements.inputLeadMessengerLastContactAt
    ];
    inputs.forEach((input) => {
      if (input) input.value = '';
    });
    if (elements.inputLeadStage) {
      elements.inputLeadStage.value = 'new';
    }
    if (elements.inputLeadMessengerStatus) {
      elements.inputLeadMessengerStatus.value = '';
    }
    if (elements.btnSaveLead) {
      elements.btnSaveLead.disabled = false;
      elements.btnSaveLead.textContent = 'Save Lead';
    }
  }

  function resetLeadTaskComposer() {
    if (leadWorkspaceController) {
      return leadWorkspaceController.resetLeadTaskComposer();
    }
    if (elements.inputLeadTaskTitle) elements.inputLeadTaskTitle.value = '';
    if (elements.inputLeadTaskDueAt) elements.inputLeadTaskDueAt.value = '';
    if (elements.inputLeadTaskPriority) elements.inputLeadTaskPriority.value = 'medium';
  }

  function resetLeadActivityComposer() {
    if (leadWorkspaceController) {
      return leadWorkspaceController.resetLeadActivityComposer();
    }
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

  function resetStudentFinanceComposer() {
    modalState.selectedInvoiceId = null;
    modalState.financeEnrollments = [];
    if (elements.inputInvoiceAmount) elements.inputInvoiceAmount.value = '';
    if (elements.inputInvoiceDiscount) elements.inputInvoiceDiscount.value = '';
    if (elements.inputInvoiceDueDate) elements.inputInvoiceDueDate.value = '';
    if (elements.inputStudentFinanceEnrollment) {
      elements.inputStudentFinanceEnrollment.innerHTML = '<option value="">No enrollment selected</option>';
      elements.inputStudentFinanceEnrollment.value = '';
    }
    if (elements.studentFinanceEnrollmentMeta) {
      elements.studentFinanceEnrollmentMeta.textContent = 'Choose the enrollment this invoice belongs to.';
    }
    if (elements.inputPaymentAmount) elements.inputPaymentAmount.value = '';
    if (elements.inputPaymentMethod) elements.inputPaymentMethod.value = 'bank-transfer';
    if (elements.studentInvoiceList) elements.studentInvoiceList.innerHTML = '<div class="crm-muted">No invoices yet.</div>';
    if (elements.studentFinanceInvoiced) elements.studentFinanceInvoiced.textContent = '0';
    if (elements.studentFinancePaid) elements.studentFinancePaid.textContent = '0';
    if (elements.studentFinanceOutstanding) elements.studentFinanceOutstanding.textContent = '0';
    if (elements.studentFinanceNextDue) elements.studentFinanceNextDue.textContent = '-';
  }

  function getStudentPayload() {
    const basePayload = window.CrmStudents && typeof window.CrmStudents.buildPayload === 'function'
      ? window.CrmStudents.buildPayload(elements)
      : {
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

    const overviewPayload = window.CrmStudent360 && typeof window.CrmStudent360.buildPayload === 'function'
      ? window.CrmStudent360.buildPayload(elements)
      : {};

    return {
      ...basePayload,
      ...overviewPayload
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
      removeBtn.textContent = 'Ã—';
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
    if (!courseModalController) throw new Error('Course modal helpers are not available.');
    return courseModalController.saveCourse();
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
    if (leadWorkspaceController) {
      return leadWorkspaceController.setupLeadComposer();
    }
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
    if (!activitySurfacesController) return;
    return activitySurfacesController.setupActivitySurfaces();
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

  function renderTaskList(container, tasks, options = {}) {
    if (!container) return;
    const rows = Array.isArray(tasks) ? tasks : [];
    const emptyMessage = String(options.emptyMessage || 'No tasks yet.');

    if (!rows.length) {
      container.innerHTML = `<div class="crm-muted">${escapeHtml(emptyMessage)}</div>`;
      return;
    }

    container.innerHTML = rows.map((task) => {
      const title = String(task?.title || 'Untitled task').trim() || 'Untitled task';
      const priority = window.CrmActivities && typeof window.CrmActivities.formatPriorityLabel === 'function'
        ? window.CrmActivities.formatPriorityLabel(task?.priority)
        : String(task?.priority || 'medium').trim().toLowerCase();
      const dueAt = formatDateTime(task?.dueAt);
      const status = String(task?.status || 'open').trim() || 'open';

      return `
        <div class="crm-list-card">
          <div class="crm-list-card-title">${escapeHtml(title)}</div>
          <div class="crm-timeline-meta">${escapeHtml(`Priority: ${priority} | Due: ${dueAt} | Status: ${status}`)}</div>
        </div>
      `;
    }).join('');
  }

  function renderActivityList(container, activities, emptyMessage = 'No activity yet.') {
    if (!container) return;
    const rows = Array.isArray(activities) ? activities : [];
    const fallback = String(emptyMessage || 'No activity yet.');

    if (!rows.length) {
      container.innerHTML = `<div class="crm-muted">${escapeHtml(fallback)}</div>`;
      return;
    }

    container.innerHTML = rows.map((activity) => {
      const typeLabel = window.CrmActivities && typeof window.CrmActivities.formatTypeLabel === 'function'
        ? window.CrmActivities.formatTypeLabel(activity?.type)
        : String(activity?.type || 'Note').trim() || 'Note';
      const subject = String(activity?.subject || '').trim();
      const body = String(activity?.body || '').trim();
      const actor = String(activity?.authorName || activity?.createdByName || activity?.createdBy || '').trim();
      const meta = [typeLabel, actor, formatDateTime(activity?.createdAt)].filter(Boolean).join(' | ');

      return `
        <div class="crm-list-card">
          <div class="crm-list-card-title">${escapeHtml(subject || typeLabel)}</div>
          <div class="crm-timeline-meta">${escapeHtml(meta)}</div>
          ${body ? `<div class="crm-list-card-body">${escapeHtml(body)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  async function refreshOpenTaskSnapshot() {
    if (!taskActivityWorkspaceController) return;
    return taskActivityWorkspaceController.refreshOpenTaskSnapshot();
  }

  async function refreshLeadWorkspace() {
    if (!leadWorkspaceController) return;
    return leadWorkspaceController.refreshLeadWorkspace();
  }

  async function refreshStudentTimeline() {
    if (!studentWorkspaceController) return;
    return studentWorkspaceController.refreshStudentTimeline();
  }

  async function saveStudentProfile() {
    if (!studentWorkspaceController) throw new Error('Student workspace helpers are not available.');
    return studentWorkspaceController.saveStudentProfile();
  }

  async function createEntranceTest() {
    if (!studentWorkspaceController) throw new Error('Student workspace helpers are not available.');
    return studentWorkspaceController.createEntranceTest();
  }

  async function refreshAttendanceRiskSnapshot() {
    if (!window.ClassroomAPI || typeof window.ClassroomAPI.fetchAttendanceSummary !== 'function') return;
    const summary = await window.ClassroomAPI.fetchAttendanceSummary({});
    const students = Array.isArray(summary?.students) ? summary.students : [];
    dataCache.attendanceRiskByStudentId = new Map(
      students
        .map((row) => [String(row?.studentId || '').trim(), row])
        .filter(([studentId]) => studentId)
    );
  }

  async function createTaskForLead() {
    if (!taskActivityWorkspaceController) throw new Error('Task/activity helpers are not available.');
    return taskActivityWorkspaceController.createTaskForLead();
  }

  async function createActivityForLead() {
    if (!taskActivityWorkspaceController) throw new Error('Task/activity helpers are not available.');
    return taskActivityWorkspaceController.createActivityForLead();
  }

  async function createTaskForStudent() {
    if (!taskActivityWorkspaceController) throw new Error('Task/activity helpers are not available.');
    return taskActivityWorkspaceController.createTaskForStudent();
  }

  async function createActivityForStudent() {
    if (!taskActivityWorkspaceController) throw new Error('Task/activity helpers are not available.');
    return taskActivityWorkspaceController.createActivityForStudent();
  }

  async function refreshStudentFinance() {
    if (!studentFinanceController) return;
    return studentFinanceController.refreshStudentFinance();
  }

  function getCurrentStudentProfile() {
    if (modalState.studentProfile && String(modalState.studentProfile.studentId || modalState.studentId || '') === String(modalState.studentId || '')) {
      return modalState.studentProfile;
    }

    return dataCache.students.find((student) => String(student.studentId || '') === String(modalState.studentId || '')) || null;
  }


  function renderStudentFinanceWorkflow(workflow) {
    if (!studentFinanceController) return;
    return studentFinanceController.renderStudentFinanceWorkflow(workflow);
  }

  function renderStudentClassroomMatches(matchPayload = {}) {
    if (!studentFinanceController) return;
    return studentFinanceController.renderStudentClassroomMatches(matchPayload);
  }

  function normalizeScheduleList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || '').trim()).filter(Boolean);
    }

    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function renderSchedulePrompt(container, config = {}) {
    if (!container) return;

    const message = String(config.message || '').trim();
    if (!message) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    container.innerHTML = `
      <div style="padding: 12px 14px; border: 1px solid #f59e0b; border-radius: 12px; background: #fffbeb;">
        <div style="font-weight: 600; color: #92400e;">${escapeHtml(config.title || 'Schedule setup needed')}</div>
        <div style="margin-top: 4px; color: #92400e;">${escapeHtml(message)}</div>
        <div class="crm-inline-fields" style="justify-content: flex-end; margin-top: 10px;">
          <button type="button" class="crm-btn-secondary" data-action="${escapeHtml(config.action || 'edit')}">${escapeHtml(config.buttonLabel || 'Edit')}</button>
        </div>
      </div>
    `;
  }

  function renderStudentSchedulePrompt() {
    if (!elements.studentSchedulePrompt) return;
    const student = getCurrentStudentProfile();
    const days = normalizeScheduleList(student?.preferredLearningDays);
    const hours = normalizeScheduleList(student?.preferredLearningHours);
    const missingDays = !days.length;
    const missingHours = !hours.length;

    if (!missingDays && !missingHours) {
      renderSchedulePrompt(elements.studentSchedulePrompt, {});
      return;
    }

    const missingParts = [
      missingDays ? 'preferred learning days' : '',
      missingHours ? 'preferred learning hours' : ''
    ].filter(Boolean);

    renderSchedulePrompt(elements.studentSchedulePrompt, {
      title: 'Student schedule incomplete',
      message: `Fill ${missingParts.join(' and ')} in the Info tab to improve class matching.`,
      buttonLabel: 'Edit student schedule',
      action: 'edit-student-schedule'
    });
  }

  function renderClassroomSchedulePrompt() {
    if (!elements.attendanceSchedulePrompt) return;
    const days = normalizeScheduleList(elements.inputClassroomMeetingDays?.value);
    const hours = normalizeScheduleList(elements.inputClassroomMeetingHours?.value);
    const missingDays = !days.length;
    const missingHours = !hours.length;

    if (!missingDays && !missingHours) {
      renderSchedulePrompt(elements.attendanceSchedulePrompt, {});
      return;
    }

    const missingParts = [
      missingDays ? 'meeting days' : '',
      missingHours ? 'meeting hours' : ''
    ].filter(Boolean);

    renderSchedulePrompt(elements.attendanceSchedulePrompt, {
      title: 'Classroom schedule incomplete',
      message: `Fill ${missingParts.join(' and ')} in the Settings tab to improve fit guidance.`,
      buttonLabel: 'Edit classroom schedule',
      action: 'edit-classroom-schedule'
    });
  }

  function getPrimaryLiveSession(sessions = []) {
    if (!liveDeliveryController) return null;
    return liveDeliveryController.getPrimaryLiveSession(sessions);
  }

  function getSelectedLiveSession() {
    if (!liveDeliveryController) return null;
    return liveDeliveryController.getSelectedLiveSession();
  }

  function resetLiveSessionForm() {
    if (!liveDeliveryController) return;
    return liveDeliveryController.resetLiveSessionForm();
  }

  function applyLiveSessionToForm(session) {
    if (!liveDeliveryController) return;
    return liveDeliveryController.applyLiveSessionToForm(session);
  }

  function collectLiveSessionPayload() {
    if (!liveDeliveryController) return {};
    return liveDeliveryController.collectLiveSessionPayload();
  }

  function renderLiveSessionList(sessions = []) {
    if (!liveDeliveryController) return;
    return liveDeliveryController.renderLiveSessionList(sessions);
  }

  function renderLiveDeliverySummary(sessions = []) {
    if (!liveDeliveryController) return;
    return liveDeliveryController.renderLiveDeliverySummary(sessions);
  }

  function renderAttendanceWorkflowGuidance() {
    if (!liveDeliveryController) return;
    return liveDeliveryController.renderAttendanceWorkflowGuidance();
  }

  function renderClassworkWorkflowGuidance() {
    if (!liveDeliveryController) return;
    return liveDeliveryController.renderClassworkWorkflowGuidance();
  }

  async function loadLiveSessions(classId, options = {}) {
    if (!liveDeliveryController) return [];
    return liveDeliveryController.loadLiveSessions(classId, options);
  }

  async function refreshAttendanceClassroomFitNote() {
    if (classroomWorkspaceController && typeof classroomWorkspaceController.refreshAttendanceClassroomFitNote === 'function') {
      return classroomWorkspaceController.refreshAttendanceClassroomFitNote();
    }
    if (!liveDeliveryController) return;
    return liveDeliveryController.refreshAttendanceClassroomFitNote();
  }

  async function createRecommendedEnrollment() {
    if (!studentFinanceController) throw new Error('Student finance helpers are not available.');
    return studentFinanceController.createRecommendedEnrollment();
  }

  function resolveStudentFinanceContext() {
    if (!studentFinanceController) throw new Error('Student finance helpers are not available.');
    return studentFinanceController.resolveStudentFinanceContext();
  }

  async function createInvoiceForStudent() {
    if (!studentFinanceController) throw new Error('Student finance helpers are not available.');
    return studentFinanceController.createInvoiceForStudent();
  }

  async function recordPaymentForStudent() {
    if (!studentFinanceController) throw new Error('Student finance helpers are not available.');
    return studentFinanceController.recordPaymentForStudent();
  }

  async function refreshCommunicationsManager() {
    if (!communicationsController) return;
    return communicationsController.refreshCommunicationsManager();
  }

  async function createCommunicationTemplate() {
    if (!communicationsController) throw new Error('Communication helpers are not available.');
    return communicationsController.createCommunicationTemplate();
  }

  async function createAutomationRule() {
    if (!communicationsController) throw new Error('Communication helpers are not available.');
    return communicationsController.createAutomationRule();
  }

  async function refreshDashboard() {
    if (!dashboardController) return;
    return dashboardController.refreshDashboard();
  }

  async function createMergeJob() {
    if (!dashboardController) throw new Error('Dashboard helpers are not available.');
    return dashboardController.createMergeJob();
  }

  function normalizeDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value?.toDate === 'function') {
      const next = value.toDate();
      return next instanceof Date && !Number.isNaN(next.getTime()) ? next : null;
    }
    if (typeof value === 'number') {
      const next = new Date(value);
      return Number.isNaN(next.getTime()) ? null : next;
    }
    if (typeof value === 'string') {
      const next = new Date(value);
      return Number.isNaN(next.getTime()) ? null : next;
    }
    return null;
  }

  function formatDateTime(value) {
    const normalized = normalizeDateValue(value);
    if (!normalized) return '-';
    return normalized.toLocaleString('en-US');
  }

  function formatDateTimeLocalValue(value) {
    const normalized = normalizeDateValue(value);
    if (!normalized) return '';
    const year = normalized.getFullYear();
    const month = String(normalized.getMonth() + 1).padStart(2, '0');
    const day = String(normalized.getDate()).padStart(2, '0');
    const hours = String(normalized.getHours()).padStart(2, '0');
    const minutes = String(normalized.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str || '');
    return div.innerHTML;
  }

  function renderLeadContextSummary(lead) {
    if (leadWorkspaceController) {
      return leadWorkspaceController.renderLeadContextSummary(lead);
    }
    if (!elements.leadContextSummary) return;
    if (!lead) {
      elements.leadContextSummary.innerHTML = '<div class="crm-muted">Structured intake details will appear here.</div>';
      return;
    }

    const rows = [
      ['Facebook', [lead?.facebookDisplayName || lead?.facebook, lead?.facebookProfileUrl].filter(Boolean).join(' / ')],
      ['Real Name', lead?.realName],
      ['Date of Birth', lead?.dateOfBirth],
      ['Learning Needs', lead?.learningNeeds],
      ['Preferred Days', (Array.isArray(lead?.preferredLearningDays) ? lead.preferredLearningDays : []).map((value) => String(value || '').trim()).filter(Boolean).join(', ')],
      ['Preferred Hours', (Array.isArray(lead?.preferredLearningHours) ? lead.preferredLearningHours : []).map((value) => String(value || '').trim()).filter(Boolean).join(', ')],
      ['Messenger', [lead?.messengerStatus, lead?.messengerLastContactAt, lead?.messengerThreadUrl].filter(Boolean).join(' / ')]
    ].filter(([, value]) => String(value || '').trim());

    if (!rows.length) {
      elements.leadContextSummary.innerHTML = '<div class="crm-muted">No structured intake context captured yet.</div>';
      return;
    }

    elements.leadContextSummary.innerHTML = rows.map(([label, value]) => `
      <div>
        <strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}
      </div>
    `).join('');
  }

  function renderStudentsTable(container, students, emptyMessage) {
    if (!studentDirectoryController) return;
    return studentDirectoryController.renderStudentsTable(container, students, emptyMessage);
  }

  async function fetchStudentsFromFirestore(limit) {
    if (!studentDirectoryController) return [];
    return studentDirectoryController.fetchStudentsFromFirestore(limit);
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
    renderClassroomSchedulePrompt();
    renderLiveDeliverySummary(modalState.liveSessions);
    renderAttendanceWorkflowGuidance();
    renderClassworkWorkflowGuidance();
  }

  async function openStudentProfile(studentId, cachedStudent = null) {
    if (!studentWorkspaceController) return;
    return studentWorkspaceController.openStudentProfile(studentId, cachedStudent);
  }

  async function refreshStudentIdentity() {
    if (!studentWorkspaceController) return;
    return studentWorkspaceController.refreshStudentIdentity();
  }

  async function refreshStudentLists() {
    if (!studentDirectoryController) return;
    return studentDirectoryController.refreshStudentLists();
  }

  function renderLeadStageBoard(leads) {
    if (!leadWorkspaceController) return;
    return leadWorkspaceController.renderLeadStageBoard(leads);
  }

  function renderLeadTable(leads) {
    if (!leadWorkspaceController) return;
    return leadWorkspaceController.renderLeadTable(leads);
  }

  async function refreshLeadPipeline() {
    if (!leadWorkspaceController) return;
    return leadWorkspaceController.refreshLeadPipeline();
  }

  function renderEntranceTests(tests) {
    if (!elements.entranceTestsList) return;

    if (!Array.isArray(tests) || tests.length === 0) {
      elements.entranceTestsList.innerHTML = '<div class="crm-muted">No tests yet.</div>';
      if (elements.entranceTestLinkInput) elements.entranceTestLinkInput.value = '';
      if (elements.btnCopyEntranceTestLink) elements.btnCopyEntranceTestLink.disabled = true;
      if (elements.btnOpenEntranceTestLink) elements.btnOpenEntranceTestLink.disabled = true;
      if (elements.entranceTestLinkNote) {
        elements.entranceTestLinkNote.textContent = 'Create a test to generate a single-use learner link you can send.';
      }
      return;
    }

    const activeLinkTest = tests.find((test) => {
      const status = String(test?.status || '').trim().toLowerCase();
      return !!String(test?.testLink || '').trim() && status !== 'submitted' && status !== 'revoked';
    }) || null;

    const rows = tests.map((t) => {
      const testId = String(t.testId || '').trim();
      const status = String(t.status || 'created').toLowerCase();
      const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
      const listedTestLink = String(t.testLink || '').trim();
      if (listedTestLink) modalState.createdTestLinks.set(testId, listedTestLink);
      const testLink = String(listedTestLink || modalState.createdTestLinks.get(testId) || '').trim();
      const resultLink = String(t.resultLink || '').trim();

      return `\n        <tr>\n          <td><span class="crm-test-status ${status}">${statusLabel}</span></td>\n          <td>${formatDateTime(t.createdAt)}</td>\n          <td>${formatDateTime(t.startedAt)}</td>\n          <td>${formatDateTime(t.submittedAt)}</td>\n          <td>${testLink ? `<a class="crm-test-link" href="${escapeHtml(testLink)}" target="_blank" rel="noopener">Open</a>` : 'Unavailable'}</td>\n          <td>${resultLink ? `<a class="crm-test-link" href="${escapeHtml(resultLink)}" target="_blank" rel="noopener">View</a>` : 'â€”'}</td>\n        </tr>\n      `;
    }).join('');

    elements.entranceTestsList.innerHTML = `\n      <table class="crm-entrance-tests-table">\n        <thead>\n          <tr>\n            <th>Status</th>\n            <th>Start Date</th>\n            <th>Started</th>\n            <th>Submission Date</th>\n            <th>Test Link</th>\n            <th>Result</th>\n          </tr>\n        </thead>\n        <tbody>\n          ${rows}\n        </tbody>\n      </table>\n    `;

    const latestLink = String(activeLinkTest?.testLink || '').trim();
    if (elements.entranceTestLinkInput) elements.entranceTestLinkInput.value = latestLink;
    if (elements.btnCopyEntranceTestLink) elements.btnCopyEntranceTestLink.disabled = !latestLink;
    if (elements.btnOpenEntranceTestLink) elements.btnOpenEntranceTestLink.disabled = !latestLink;
    if (elements.entranceTestLinkNote) {
      elements.entranceTestLinkNote.textContent = latestLink
        ? 'Latest single-use learner link is ready to send. It will stop working after submission.'
        : 'Latest entrance test link has already been used. Create a new test to send another link.';
    }
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
    if (!courseModalController) return;
    return courseModalController.setupCourseModal();
  }

  function switchStudentTab(tabId) {
    if (!studentModalController) return;
    return studentModalController.switchStudentTab(tabId);
  }

  function switchCourseTab(tabId) {
    if (!courseModalController) return;
    return courseModalController.switchCourseTab(tabId);
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

    if (activePanel === 'dashboard') {
      refreshDashboard().catch((error) => {
        console.error('[CRM Admin] Dashboard refresh failed:', error);
      });
    }
    if (activePanel === 'courses/zoom-links') {
      refreshZoomLinksOverview().catch((error) => {
        console.error('[CRM Admin] Live delivery overview refresh failed:', error);
      });
    }
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
    if (!classroomModalController) return;
    return classroomModalController.setupClassroomModal();
  }

  function resetClassroomModal() {
    if (!classroomModalController) return;
    return classroomModalController.resetClassroomModal();
  }

  function switchClassroomTab(tabId) {
    if (!classroomModalController) return;
    return classroomModalController.switchClassroomTab(tabId);
  }

  async function populateAttendanceStudentOptions() {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.populateAttendanceStudentOptions();
  }

  function renderAttendanceRoster(summaryRows) {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.renderAttendanceRoster(summaryRows);
  }

  async function loadClassroomAttendance(classId) {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.loadClassroomAttendance(classId);
  }

  async function enrollStudentIntoClassroom() {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.enrollStudentIntoClassroom();
  }

  async function createAttendanceSessionForClassroom() {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.createAttendanceSessionForClassroom();
  }

  async function saveAttendanceRecordsForClassroom() {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.saveAttendanceRecordsForClassroom();
  }

  async function saveLiveSession() {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.saveLiveSession();
  }

  async function startSelectedLiveSession() {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.startSelectedLiveSession();
  }

  async function endSelectedLiveSession() {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.endSelectedLiveSession();
  }

  async function loadClassroomStream(classId) {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.loadClassroomStream(classId);
  }

  async function loadReviewBoard(classId) {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.loadReviewBoard(classId);
  }

  async function saveClassroomSettings() {
    if (!classroomWorkspaceController) throw new Error('Classroom workspace helpers are not available.');
    return classroomWorkspaceController.saveClassroomSettings();
  }

  async function refreshClassroomList() {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.refreshClassroomList();
  }

  async function loadClassroomModules(classId) {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.loadClassroomModules(classId);
  }

  async function loadClassroomClasswork(classId) {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.loadClassroomClasswork(classId);
  }

  async function openExistingClassroom(classroom) {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.openExistingClassroom(classroom);
  }

  async function refreshZoomLinksOverview() {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.refreshZoomLinksOverview();
  }

  async function fetchCoursesFromCatalog() {
    if (!classroomWorkspaceController) return [];
    return classroomWorkspaceController.fetchCoursesFromCatalog();
  }

  async function populateClassroomCourseOptions(options = {}) {
    if (!classroomWorkspaceController) return [];
    return classroomWorkspaceController.populateClassroomCourseOptions(options);
  }

  async function refreshCourseCatalog() {
    if (!classroomWorkspaceController) return;
    return classroomWorkspaceController.refreshCourseCatalog();
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
