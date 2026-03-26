const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const {
  buildAddSessionPreview,
  buildCanonicalScheduledWindow,
  buildRegenerationPreview,
  buildReplaceSessionPreview,
  buildReplacementPlan,
  buildScheduleSummary,
  normalizeScheduledSession
} = require('../../functions/src/crm/scheduling-service');

function pad(value) {
  return String(value).padStart(2, '0');
}

function toLocalDateInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfWeek(date = new Date()) {
  const ref = new Date(date);
  const day = ref.getDay() || 7;
  ref.setDate(ref.getDate() - day + 1);
  ref.setHours(0, 0, 0, 0);
  return ref;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function dragBetween(page, sourceSelector, targetSelector) {
  await page.evaluate(({ sourceSelector: sourceQuery, targetSelector: targetQuery }) => {
    const source = document.querySelector(sourceQuery);
    const target = document.querySelector(targetQuery);
    if (!source || !target) {
      throw new Error('Missing drag source or target.');
    }

    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const sourceX = sourceBox.left + (sourceBox.width / 2);
    const sourceY = sourceBox.top + (sourceBox.height / 2);
    const targetX = targetBox.left + (targetBox.width / 2);
    const targetY = targetBox.top + (targetBox.height / 2);

    source.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: sourceX,
      clientY: sourceY,
      button: 0,
      buttons: 1
    }));

    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX: sourceX + 8,
      clientY: sourceY + 8,
      button: 0,
      buttons: 1
    }));

    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX: targetX,
      clientY: targetY,
      button: 0,
      buttons: 1
    }));

    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      clientX: targetX,
      clientY: targetY,
      button: 0,
      buttons: 0
    }));
  }, {
    sourceSelector,
    targetSelector
  });
}

function buildHarnessState() {
  const weekStart = startOfWeek(new Date());
  const previewNowIso = new Date(weekStart);
  previewNowIso.setDate(previewNowIso.getDate() - 1);
  previewNowIso.setHours(0, 0, 0, 0);
  const timezone = 'Asia/Bangkok';
  const classOneFirstDate = toLocalDateInput(addDays(weekStart, 1));
  const classOneSecondDate = toLocalDateInput(addDays(weekStart, 3));
  const teacherConflictDate = toLocalDateInput(addDays(weekStart, 0));
  const lockedClassDate = toLocalDateInput(addDays(weekStart, 5));

  const courses = [
    {
      id: 'course-1',
      name: 'IELTS 1-on-1',
      code: 'IELTS101',
      status: 'active',
      teachers: ['teacher-1'],
      deliveryTemplate: {
        totalInstructionMinutes: 120,
        defaultSessionMinutes: 60,
        timezone,
        durationStepMinutes: 30
      }
    }
  ];

  const classrooms = [
    {
      classroomId: 'class-1',
      id: 'class-1',
      name: 'Mr. Long',
      courseId: 'course-1',
      status: 'active',
      primaryTeacherUid: 'teacher-1',
      scheduleConfig: {
        totalInstructionMinutes: 120,
        sessionMinutes: 60,
        targetSessionCount: 2,
        timezone,
        allowedStartTime: '07:00',
        allowedEndTime: '21:00',
        planningStatus: 'seeded',
        durationStepMinutes: 30,
        scheduleVersion: 1
      },
      scheduleSummary: null
    },
    {
      classroomId: 'class-conflict',
      id: 'class-conflict',
      name: 'Teacher Conflict',
      courseId: 'course-1',
      status: 'active',
      primaryTeacherUid: 'teacher-1',
      scheduleConfig: {
        totalInstructionMinutes: 60,
        sessionMinutes: 60,
        targetSessionCount: 1,
        timezone,
        planningStatus: 'seeded',
        durationStepMinutes: 30,
        scheduleVersion: 1
      },
      scheduleSummary: null
    },
    {
      classroomId: 'class-locked',
      id: 'class-locked',
      name: 'Locked Class',
      courseId: 'course-1',
      status: 'active',
      primaryTeacherUid: 'teacher-2',
      scheduleConfig: {
        totalInstructionMinutes: 60,
        sessionMinutes: 60,
        targetSessionCount: 1,
        timezone,
        planningStatus: 'seeded',
        durationStepMinutes: 30,
        scheduleVersion: 1
      },
      scheduleSummary: null
    }
  ];

  const sessions = [
    normalizeScheduledSession({
      sessionId: 'session-1',
      classId: 'class-1',
      courseId: 'course-1',
      teacherUid: 'teacher-1',
      ...buildCanonicalScheduledWindow({
        targetLocalDate: classOneFirstDate,
        targetLocalTime: '09:00',
        timezone,
        durationMinutes: 60
      }),
      unitType: 'contracted',
      contractUnitIndex: 1,
      overflowSequence: null,
      seedBatchId: 'seed-1',
      replacementOfSessionId: null,
      status: 'scheduled',
      attendanceState: 'none',
      lockState: 'unlocked',
      version: 1
    }),
    normalizeScheduledSession({
      sessionId: 'session-2',
      classId: 'class-1',
      courseId: 'course-1',
      teacherUid: 'teacher-1',
      ...buildCanonicalScheduledWindow({
        targetLocalDate: classOneSecondDate,
        targetLocalTime: '09:00',
        timezone,
        durationMinutes: 60
      }),
      unitType: 'contracted',
      contractUnitIndex: 2,
      overflowSequence: null,
      seedBatchId: 'seed-1',
      replacementOfSessionId: null,
      status: 'scheduled',
      attendanceState: 'none',
      lockState: 'unlocked',
      version: 1
    }),
    normalizeScheduledSession({
      sessionId: 'session-conflict-1',
      classId: 'class-conflict',
      courseId: 'course-1',
      teacherUid: 'teacher-1',
      ...buildCanonicalScheduledWindow({
        targetLocalDate: teacherConflictDate,
        targetLocalTime: '11:00',
        timezone,
        durationMinutes: 60
      }),
      unitType: 'contracted',
      contractUnitIndex: 1,
      overflowSequence: null,
      seedBatchId: 'seed-conflict',
      replacementOfSessionId: null,
      status: 'scheduled',
      attendanceState: 'none',
      lockState: 'unlocked',
      version: 1
    }),
    normalizeScheduledSession({
      sessionId: 'session-locked-1',
      classId: 'class-locked',
      courseId: 'course-1',
      teacherUid: 'teacher-2',
      ...buildCanonicalScheduledWindow({
        targetLocalDate: lockedClassDate,
        targetLocalTime: '10:30',
        timezone,
        durationMinutes: 60
      }),
      unitType: 'contracted',
      contractUnitIndex: 1,
      overflowSequence: null,
      seedBatchId: 'seed-locked',
      replacementOfSessionId: null,
      status: 'scheduled',
      attendanceState: 'in_progress',
      lockState: 'hard_locked',
      lockReason: 'attendance_in_progress',
      version: 1
    })
  ];

  let nextSessionNumber = 10;

  function getClassroom(classId) {
    return classrooms.find((row) => String(row.classroomId || row.id || '') === String(classId || '')) || null;
  }

  function activeSessions() {
    return sessions.filter((session) => String(session.status || '') !== 'cancelled');
  }

  function listClassSessions(classId) {
    return sessions
      .filter((session) => String(session.classId || '') === String(classId || ''))
      .map((session) => normalizeScheduledSession(session));
  }

  function hasTeacherConflict(proposedSession, ignoredIds = []) {
    const normalizedProposal = normalizeScheduledSession(proposedSession);
    const teacherUid = String(normalizedProposal.teacherUid || '').trim();
    if (!teacherUid) return false;

    const proposedStart = new Date(normalizedProposal.scheduledStartAtUtc).getTime();
    const proposedEnd = new Date(normalizedProposal.scheduledEndAtUtc).getTime();
    return activeSessions().some((candidate) => {
      if (ignoredIds.includes(String(candidate.sessionId || ''))) return false;
      if (String(candidate.teacherUid || '').trim() !== teacherUid) return false;
      const current = normalizeScheduledSession(candidate);
      const currentStart = new Date(current.scheduledStartAtUtc).getTime();
      const currentEnd = new Date(current.scheduledEndAtUtc).getTime();
      return proposedStart < currentEnd && proposedEnd > currentStart;
    });
  }

  function computeSummary(classroomId) {
    const classroom = getClassroom(classroomId);
    if (!classroom) return null;
    const summary = buildScheduleSummary({
      totalInstructionMinutes: Number(classroom.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      sessionMinutes: Number(classroom.scheduleConfig?.sessionMinutes || 0) || 60,
      targetSessionCount: Number(classroom.scheduleConfig?.targetSessionCount || 0) || null,
      sessions: listClassSessions(classroomId)
    });
    classroom.scheduleSummary = summary;
    return summary;
  }

  function refreshSummaries() {
    classrooms.forEach((classroom) => computeSummary(classroom.classroomId || classroom.id));
  }

  function createSession(classId, payload) {
    const session = normalizeScheduledSession({
      sessionId: `session-${nextSessionNumber++}`,
      ...payload,
      classId
    });
    sessions.push(session);
    computeSummary(classId);
    return session;
  }

  function bumpScheduleVersion(classId) {
    const classroom = getClassroom(classId);
    if (!classroom) return null;
    classroom.scheduleConfig = {
      ...classroom.scheduleConfig,
      scheduleVersion: Number(classroom.scheduleConfig?.scheduleVersion || 0) + 1
    };
    return classroom.scheduleConfig.scheduleVersion;
  }

  function cancelSession(sessionId, replacementSessionId = null) {
    const session = sessions.find((row) => String(row.sessionId || '') === String(sessionId || ''));
    if (!session) {
      throw new Error(`Missing session ${sessionId}`);
    }
    session.status = 'cancelled';
    session.replacementSessionId = replacementSessionId;
    session.version = Number(session.version || 1) + 1;
    computeSummary(session.classId);
    return session;
  }

  function replaceSession(classId, replacedSessionId, payload) {
    const replacedSession = sessions.find((row) => String(row.sessionId || '') === String(replacedSessionId || ''));
    if (!replacedSession) {
      throw new Error(`Missing session ${replacedSessionId}`);
    }
    const replacementPlan = buildReplacementPlan({
      replacementSession: {
        classId,
        courseId: replacedSession.courseId || null,
        teacherUid: payload.teacherUid || replacedSession.teacherUid || null,
        ...buildCanonicalScheduledWindow({
          targetLocalDate: payload.targetLocalDate,
          targetLocalTime: payload.targetLocalTime,
          timezone: payload.timezone || replacedSession.timezone || timezone,
          durationMinutes: payload.durationMinutes || replacedSession.durationMinutes || 60
        })
      },
      replacedSession
    });
    const replacement = createSession(classId, replacementPlan.nextSession);
    cancelSession(replacedSessionId, replacement.sessionId);
    bumpScheduleVersion(classId);
    computeSummary(classId);
    return { replacement };
  }

  function rescheduleSession(sessionId, payload) {
    const session = sessions.find((row) => String(row.sessionId || '') === String(sessionId || ''));
    if (!session) {
      throw new Error(`Missing session ${sessionId}`);
    }
    Object.assign(session, buildCanonicalScheduledWindow({
      targetLocalDate: payload.targetLocalDate,
      targetLocalTime: payload.targetLocalTime,
      timezone: payload.timezone || session.timezone || timezone,
      durationMinutes: payload.durationMinutes || session.durationMinutes || 60
    }), {
      timezone: payload.timezone || session.timezone || timezone,
      durationMinutes: payload.durationMinutes || session.durationMinutes || 60,
      version: Number(session.version || 1) + 1
    });
    bumpScheduleVersion(session.classId);
    computeSummary(session.classId);
    return normalizeScheduledSession(session);
  }

  function regenerateSchedule(classId, preview, payload) {
    const classroom = getClassroom(classId);
    const fromDate = String(preview.regenerateFromDate || payload.regenerateFromDate || '').trim();
    sessions.forEach((session) => {
      if (String(session.classId || '') !== String(classId || '')) return;
      if (String(session.unitType || '') !== 'contracted') return;
      if (String(session.status || '') === 'cancelled') return;
      if (String(session.lockState || 'unlocked') === 'hard_locked') return;
      if (String(session.attendanceState || 'none') === 'in_progress' || String(session.attendanceState || 'none') === 'finalized') return;
      if (String(session.scheduledLocalDate || '') < fromDate) return;
      session.status = 'cancelled';
      session.version = Number(session.version || 1) + 1;
    });
    preview.previewSessions.forEach((session) => createSession(classId, session));
    classroom.scheduleConfig = {
      ...classroom.scheduleConfig,
      sessionMinutes: Number(payload.sessionMinutes || classroom.scheduleConfig.sessionMinutes || 60),
      targetSessionCount: Number(preview.nextTargetSessionCount || classroom.scheduleConfig.targetSessionCount || 0) || null,
      seedWeekdays: Array.isArray(payload.seedWeekdays) ? payload.seedWeekdays : classroom.scheduleConfig.seedWeekdays || [],
      seedStartTime: payload.seedStartTime || classroom.scheduleConfig.seedStartTime || null,
      scheduleVersion: Number(classroom.scheduleConfig?.scheduleVersion || 0) + 1
    };
    computeSummary(classId);
    return classroom;
  }

  refreshSummaries();

  return {
    courses,
    classrooms,
    sessions,
    previewNowIso,
    getClassroom,
    activeSessions,
    listClassSessions,
    hasTeacherConflict,
    computeSummary,
    refreshSummaries,
    createSession,
    bumpScheduleVersion,
    regenerateSchedule,
    replaceSession,
    rescheduleSession
  };
}

function responseJson(res, payload, status = 200) {
  res.status(status).json(payload);
}

function createFirebaseStubScript() {
  return `
    (() => {
      const authUser = {
        uid: 'admin-1',
        email: 'admin@example.com',
        getIdToken: async () => 'test-token'
      };

      const firestore = {
        collection() {
          return {
            doc() {
              return {
                get: async () => ({ exists: false, data: () => null }),
                collection() {
                  return {
                    get: async () => ({ empty: true, docs: [], forEach() {} }),
                    orderBy() {
                      return {
                        get: async () => ({ empty: true, docs: [], forEach() {} })
                      };
                    },
                    add: async () => ({ id: 'doc-1' })
                  };
                }
              };
            },
            orderBy() {
              return {
                limit() {
                  return {
                    get: async () => ({ docs: [], forEach() {}, empty: true })
                  };
                },
                get: async () => ({ docs: [], forEach() {}, empty: true })
              };
            },
            get: async () => ({ docs: [], forEach() {}, empty: true })
          };
        },
        FieldValue: {
          serverTimestamp: () => new Date()
        }
      };

      window.firebase = {
        apps: [],
        initializeApp(config) {
          this.apps.push(config);
          this._config = config;
          return config;
        },
        auth() {
          return {
            currentUser: authUser,
            onAuthStateChanged(callback) {
              setTimeout(() => callback(authUser), 0);
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
              return {
                put: async () => ({})
              };
            }
          };
        }
      };
    })();
  `;
}

function startHarnessServer() {
  const state = buildHarnessState();
  const requestLog = [];
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/api/config', (req, res) => {
    responseJson(res, {
      success: true,
      config: {
        apiKey: 'test-api-key',
        authDomain: 'example.test',
        projectId: 'crm-browser-test'
      }
    });
  });

  app.get('/api/admin/status', (req, res) => {
    responseJson(res, { success: true, isAdmin: true });
  });

  app.get('/api/admin/courses', (req, res) => {
    responseJson(res, { success: true, courses: state.courses });
  });

  app.get('/api/admin/classrooms', (req, res) => {
    state.refreshSummaries();
    responseJson(res, { success: true, classrooms: state.classrooms });
  });

  app.get('/api/admin/scheduler/workspace', (req, res) => {
    state.refreshSummaries();
    responseJson(res, {
      success: true,
      classrooms: state.classrooms,
      sessions: state.activeSessions().map((session) => normalizeScheduledSession(session))
    });
  });

  app.get('/api/admin/leads', (req, res) => {
    responseJson(res, { success: true, leads: [] });
  });

  app.get('/api/admin/tasks', (req, res) => {
    responseJson(res, { success: true, tasks: [] });
  });

  app.get('/api/admin/activities', (req, res) => {
    responseJson(res, { success: true, activities: [] });
  });

  app.get('/api/admin/students', (req, res) => {
    responseJson(res, { success: true, students: [] });
  });

  app.get('/api/admin/attendance/summary', (req, res) => {
    responseJson(res, { success: true, students: [] });
  });

  app.get('/api/admin/templates', (req, res) => {
    responseJson(res, { success: true, templates: [] });
  });

  app.get('/api/admin/automations', (req, res) => {
    responseJson(res, { success: true, rules: [], queue: [] });
  });

  app.get('/api/admin/dashboard/summary', (req, res) => {
    responseJson(res, {
      success: true,
      summary: {
        funnelConversionRate: 0,
        sourceRoiCount: 0,
        counselorProductivityCount: 0,
        classFillRate: 0,
        attendanceRiskCount: 0,
        totalRevenueCollected: 0,
        totalOutstandingBalance: 0
      }
    });
  });

  app.get('/api/admin/dashboard/funnel', (req, res) => {
    responseJson(res, { success: true, funnel: {} });
  });

  app.get('/api/admin/dashboard/revenue', (req, res) => {
    responseJson(res, { success: true, revenue: [] });
  });

  app.get('/api/admin/duplicates', (req, res) => {
    responseJson(res, { success: true, duplicates: [] });
  });

  app.get('/api/admin/audit-logs', (req, res) => {
    responseJson(res, { success: true, auditLogs: [] });
  });

  app.post('/api/admin/classrooms/:classId/sessions/add-preview', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    const preview = buildAddSessionPreview({
      classId: req.params.classId,
      courseId: classroom?.courseId || null,
      teacherUid: req.body?.teacherUid || classroom?.primaryTeacherUid || null,
      totalInstructionMinutes: Number(classroom?.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      targetSessionCount: Number(classroom?.scheduleSummary?.contractedTargetCount || 0) || 1,
      sessionMinutes: Number(classroom?.scheduleConfig?.sessionMinutes || 0) || 60,
      timezone: req.body?.timezone || classroom?.scheduleConfig?.timezone || 'UTC',
      targetLocalDate: req.body?.targetLocalDate,
      targetLocalTime: req.body?.targetLocalTime,
      durationMinutes: req.body?.durationMinutes,
      addMode: req.body?.addMode,
      recurringCount: req.body?.recurringCount,
      existingSessions: state.listClassSessions(req.params.classId),
      nowIso: state.previewNowIso.toISOString()
    });
    responseJson(res, { success: true, ...preview });
  });

  app.post('/api/admin/classrooms/:classId/sessions/add-batch', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    const preview = buildAddSessionPreview({
      classId: req.params.classId,
      courseId: classroom?.courseId || null,
      teacherUid: req.body?.teacherUid || classroom?.primaryTeacherUid || null,
      totalInstructionMinutes: Number(classroom?.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      targetSessionCount: Number(classroom?.scheduleSummary?.contractedTargetCount || 0) || 1,
      sessionMinutes: Number(classroom?.scheduleConfig?.sessionMinutes || 0) || 60,
      timezone: req.body?.timezone || classroom?.scheduleConfig?.timezone || 'UTC',
      targetLocalDate: req.body?.targetLocalDate,
      targetLocalTime: req.body?.targetLocalTime,
      durationMinutes: req.body?.durationMinutes,
      addMode: req.body?.addMode,
      recurringCount: req.body?.recurringCount,
      existingSessions: state.listClassSessions(req.params.classId),
      nowIso: state.previewNowIso.toISOString()
    });
    const createdSessions = [];
    const skippedOccurrences = [...preview.blockedOccurrences];
    for (const occurrence of preview.validOccurrences) {
      if (state.hasTeacherConflict(occurrence)) {
        skippedOccurrences.push({
          targetLocalDate: occurrence.scheduledLocalDate,
          targetLocalTime: occurrence.scheduledLocalTime,
          reasonCode: 'teacher_conflict',
          reasonMessage: 'Teacher conflict.'
        });
        continue;
      }
      createdSessions.push(state.createSession(req.params.classId, occurrence));
    }
    if (createdSessions.length) {
      state.bumpScheduleVersion(req.params.classId);
    }
    responseJson(res, {
      success: true,
      createdSessions,
      skippedOccurrences,
      scheduleSummary: state.computeSummary(req.params.classId)
    });
  });

  app.post('/api/admin/classrooms/:classId/sessions/replace-preview', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    const preview = buildReplaceSessionPreview({
      classId: req.params.classId,
      targetLocalDate: req.body?.targetLocalDate,
      targetLocalTime: req.body?.targetLocalTime,
      timezone: req.body?.timezone || classroom?.scheduleConfig?.timezone || 'UTC',
      durationMinutes: req.body?.durationMinutes || classroom?.scheduleConfig?.sessionMinutes || 60,
      existingSessions: state.listClassSessions(req.params.classId),
      totalInstructionMinutes: Number(classroom?.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      sessionMinutes: Number(classroom?.scheduleConfig?.sessionMinutes || 0) || 60,
      nowIso: state.previewNowIso.toISOString()
    });
    responseJson(res, { success: true, ...preview });
  });

  app.post('/api/admin/classrooms/:classId/sessions/replace', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    const preview = buildReplaceSessionPreview({
      classId: req.params.classId,
      targetLocalDate: req.body?.targetLocalDate,
      targetLocalTime: req.body?.targetLocalTime,
      timezone: req.body?.timezone || classroom?.scheduleConfig?.timezone || 'UTC',
      durationMinutes: req.body?.durationMinutes || classroom?.scheduleConfig?.sessionMinutes || 60,
      existingSessions: state.listClassSessions(req.params.classId),
      totalInstructionMinutes: Number(classroom?.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      sessionMinutes: Number(classroom?.scheduleConfig?.sessionMinutes || 0) || 60,
      nowIso: state.previewNowIso.toISOString()
    });
    const eligible = preview.eligibleSessions.find((session) => String(session.sessionId || '') === String(req.body?.replacedSessionId || ''));
    if (!eligible) {
      return responseJson(res, {
        success: false,
        code: 'SESSION_NOT_ELIGIBLE',
        message: 'Selected session is not eligible for replacement.'
      }, 409);
    }
    const replacementWindow = buildCanonicalScheduledWindow({
      targetLocalDate: req.body?.targetLocalDate,
      targetLocalTime: req.body?.targetLocalTime,
      timezone: req.body?.timezone || classroom?.scheduleConfig?.timezone || 'UTC',
      durationMinutes: req.body?.durationMinutes || classroom?.scheduleConfig?.sessionMinutes || 60
    });
    const replacementPlan = buildReplacementPlan({
      replacementSession: {
        classId: req.params.classId,
        courseId: classroom?.courseId || null,
        teacherUid: req.body?.teacherUid || classroom?.primaryTeacherUid || eligible.teacherUid || null,
        ...replacementWindow
      },
      replacedSession: eligible
    });
    if (state.hasTeacherConflict(replacementPlan.nextSession, [String(eligible.sessionId || '')])) {
      return responseJson(res, {
        success: false,
        code: 'TEACHER_CONFLICT',
        message: 'Teacher conflict.'
      }, 409);
    }
    const result = state.replaceSession(req.params.classId, req.body?.replacedSessionId, req.body || {});
    responseJson(res, { success: true, session: result.replacement });
  });

  app.patch('/api/admin/sessions/:sessionId/reschedule', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const existing = state.sessions.find((session) => String(session.sessionId || '') === String(req.params.sessionId || ''));
    if (!existing) {
      return responseJson(res, { success: false, code: 'SESSION_NOT_FOUND', message: 'Session not found.' }, 404);
    }
    const proposal = normalizeScheduledSession({
      ...existing,
      ...buildCanonicalScheduledWindow({
        targetLocalDate: req.body?.targetLocalDate,
        targetLocalTime: req.body?.targetLocalTime,
        timezone: req.body?.timezone || existing.timezone || 'UTC',
        durationMinutes: req.body?.durationMinutes || existing.durationMinutes || 60
      })
    });
    if (state.hasTeacherConflict(proposal, [String(existing.sessionId || '')])) {
      return responseJson(res, { success: false, code: 'TEACHER_CONFLICT', message: 'Teacher conflict.' }, 409);
    }
    const session = state.rescheduleSession(req.params.sessionId, req.body || {});
    responseJson(res, { success: true, session });
  });

  app.post('/api/admin/classrooms/:classId/schedule/regenerate-preview', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    if (!classroom) {
      return responseJson(res, { success: false, message: 'Classroom not found.' }, 404);
    }
    const currentVersion = Number(classroom.scheduleConfig?.scheduleVersion || 1) || 1;
    if (!Number(req.body?.expectedScheduleVersion || 0)) {
      return responseJson(res, { success: false, message: 'The classroom schedule changed. Refresh and preview again.' }, 409);
    }
    const preview = buildRegenerationPreview({
      classId: req.params.classId,
      courseId: classroom.courseId || null,
      teacherUid: req.body?.teacherUid || classroom.primaryTeacherUid || null,
      totalInstructionMinutes: Number(classroom.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      currentTargetSessionCount: Number(classroom.scheduleConfig?.targetSessionCount || 0) || null,
      timezone: classroom.scheduleConfig?.timezone || 'UTC',
      regenerateFromDate: req.body?.regenerateFromDate,
      sessionMinutes: req.body?.sessionMinutes,
      seedWeekdays: req.body?.seedWeekdays,
      seedStartTime: req.body?.seedStartTime,
      existingSessions: state.listClassSessions(req.params.classId),
      teacherConflictSessions: [],
      unresolvedSessionIds: []
    });
    responseJson(res, { success: true, ...preview, classroomScheduleVersion: currentVersion });
  });

  app.post('/api/admin/classrooms/:classId/schedule/regenerate', (req, res) => {
    requestLog.push({ method: req.method, path: req.path, body: req.body || {} });
    const classroom = state.getClassroom(req.params.classId);
    if (!classroom) {
      return responseJson(res, { success: false, message: 'Classroom not found.' }, 404);
    }
    const currentVersion = Number(classroom.scheduleConfig?.scheduleVersion || 1) || 1;
    if (!Number(req.body?.expectedScheduleVersion || 0)) {
      return responseJson(res, { success: false, message: 'The classroom schedule changed. Refresh and preview again.' }, 409);
    }
    const preview = buildRegenerationPreview({
      classId: req.params.classId,
      courseId: classroom.courseId || null,
      teacherUid: req.body?.teacherUid || classroom.primaryTeacherUid || null,
      totalInstructionMinutes: Number(classroom.scheduleConfig?.totalInstructionMinutes || 0) || 60,
      currentTargetSessionCount: Number(classroom.scheduleConfig?.targetSessionCount || 0) || null,
      timezone: classroom.scheduleConfig?.timezone || 'UTC',
      regenerateFromDate: req.body?.regenerateFromDate,
      sessionMinutes: req.body?.sessionMinutes,
      seedWeekdays: req.body?.seedWeekdays,
      seedStartTime: req.body?.seedStartTime,
      existingSessions: state.listClassSessions(req.params.classId),
      teacherConflictSessions: [],
      unresolvedSessionIds: []
    });
    if (!preview.canCommit) {
      return responseJson(res, { success: false, message: 'Schedule regeneration is blocked.' }, 409);
    }
    const nextClassroom = state.regenerateSchedule(req.params.classId, preview, req.body || {});
    responseJson(res, {
      success: true,
      cancelledSessionIds: state.sessions.filter((session) =>
        String(session.classId || '') === String(req.params.classId || '')
        && String(session.status || '') === 'cancelled'
        && String(session.unitType || '') === 'contracted'
      ).map((session) => session.sessionId),
      createdSessions: preview.previewSessions,
      scheduleConfig: nextClassroom.scheduleConfig,
      scheduleSummary: nextClassroom.scheduleSummary
    });
  });

  app.post('/api/admin/attendance/sessions/open-from-scheduled', (req, res) => {
    responseJson(res, { success: true, sessionId: `${req.body?.scheduledSessionId || 'scheduled'}-attendance` });
  });

  app.use('/api', (req, res) => {
    responseJson(res, { success: true });
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
        requestLog,
        state
      });
    });
  });
}

(async () => {
  const { server, origin, requestLog, state } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1100 }
  });
  const page = await context.newPage();
  const errors = [];
  const firebaseStub = createFirebaseStubScript();
  const screenshotPath = path.join('tmp', 'crm-scheduler-browser-check.png');

  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (/409 \(Conflict\)/i.test(text)) {
        return;
      }
      errors.push(text);
    }
  });

  await page.route('https://www.gstatic.com/firebasejs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: firebaseStub
    });
  });

  try {
    await page.goto(`${origin}/crm-admin.html#courses/classes`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#scheduler-class-list .scheduler-class-card');
    await page.waitForSelector('#scheduler-calendar .scheduler-calendar-slot');

    const weekStart = startOfWeek(new Date());
    const recurringDate = toLocalDateInput(addDays(weekStart, 1));
    const replaceDate = toLocalDateInput(addDays(weekStart, 4));
    const conflictDate = toLocalDateInput(addDays(weekStart, 0));
    const classCardSelector = '#scheduler-class-list .scheduler-class-card[data-classroom-id="class-1"]';
    const lockedClassCardSelector = '#scheduler-class-list .scheduler-class-card[data-classroom-id="class-locked"]';
    const recurringTarget = page.locator(`#scheduler-calendar .scheduler-calendar-slot[data-date="${recurringDate}"][data-time="09:00"]`);
    const replaceTarget = page.locator(`#scheduler-calendar .scheduler-calendar-slot[data-date="${replaceDate}"][data-time="10:30"]`);
    const replaceTargetSelector = `#scheduler-calendar .scheduler-calendar-slot[data-date="${replaceDate}"][data-time="10:30"]`;
    const recurringTargetSelector = `#scheduler-calendar .scheduler-calendar-slot[data-date="${recurringDate}"][data-time="09:00"]`;
    const conflictTargetSelector = `#scheduler-calendar .scheduler-calendar-slot[data-date="${conflictDate}"][data-time="11:00"]`;
    await recurringTarget.scrollIntoViewIfNeeded();
    await replaceTarget.scrollIntoViewIfNeeded();
    await page.locator(classCardSelector).scrollIntoViewIfNeeded();

    await page.locator('#scheduler-teacher-filter').focus();
    await dragBetween(page, classCardSelector, recurringTargetSelector);
    await page.locator('#scheduler-action-modal').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('#scheduler-action-modal').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'scheduler-teacher-filter');

    await dragBetween(page, classCardSelector, recurringTargetSelector);
    await page.locator('#scheduler-action-modal').waitFor({ state: 'visible' });
    await page.locator('#scheduler-action-add-recurring').check();
    await page.locator('#scheduler-action-recurring-count').fill('3');
    await page.waitForFunction(() => {
      const requested = document.querySelector('#scheduler-action-preview-requested')?.textContent?.trim();
      const valid = document.querySelector('#scheduler-action-preview-valid')?.textContent?.trim();
      const skipped = document.querySelector('#scheduler-action-preview-skipped')?.textContent?.trim();
      const overflow = document.querySelector('#scheduler-action-preview-overflow')?.textContent?.trim();
      return requested === '3' && valid === '2' && skipped === '1' && overflow === '2';
    });
    await page.locator('#btn-confirm-scheduler-action').click();
    await page.locator('#scheduler-action-modal').waitFor({ state: 'hidden' });

    await page.waitForFunction(() => {
      const card = document.querySelector('#scheduler-class-list .scheduler-class-card[data-classroom-id="class-1"]');
      return card && /overflow 2/i.test(card.textContent || '');
    });

    const railAfterRecurring = await page.locator('#scheduler-class-list .scheduler-class-card[data-classroom-id="class-1"]').textContent();
    assert.match(String(railAfterRecurring || ''), /Assigned 2\/2/i);
    assert.match(String(railAfterRecurring || ''), /overflow 2/i);

    await page.locator(lockedClassCardSelector).scrollIntoViewIfNeeded();
    await replaceTarget.scrollIntoViewIfNeeded();
    await dragBetween(page, lockedClassCardSelector, replaceTargetSelector);
    await page.locator('#scheduler-action-modal').waitFor({ state: 'visible' });
    await page.locator('#scheduler-action-replace-button').click();
    await page.waitForFunction(() => {
      const summary = document.querySelector('#scheduler-action-replace-summary')?.textContent || '';
      return /attendance started/i.test(summary);
    });
    await page.waitForFunction(() => {
      const confirm = document.querySelector('#btn-confirm-scheduler-action');
      return !!confirm && confirm.disabled;
    });
    const lockedReplaceSummary = await page.locator('#scheduler-action-replace-summary').textContent();
    assert.match(String(lockedReplaceSummary || ''), /attendance started/i);
    await page.keyboard.press('Escape');
    await page.locator('#scheduler-action-modal').waitFor({ state: 'hidden' });

    await replaceTarget.scrollIntoViewIfNeeded();
    await page.locator(classCardSelector).scrollIntoViewIfNeeded();
    await dragBetween(page, classCardSelector, replaceTargetSelector);
    await page.locator('#scheduler-action-modal').waitFor({ state: 'visible' });
    await page.locator('#scheduler-action-replace-button').click();
    const replacementChoice = page.locator('#scheduler-action-replace-list [data-session-id="session-2"]');
    await replacementChoice.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const selected = document.querySelector('#scheduler-action-replace-list [data-session-id="session-2"].is-selected');
      return !!selected;
    });
    await page.locator('#btn-confirm-scheduler-action').click();
    await page.locator('#scheduler-action-modal').waitFor({ state: 'hidden' });

    await page.waitForFunction((selector) => {
      const target = document.querySelector(selector);
      return target && /Unit 2/i.test(target.textContent || '');
    }, replaceTargetSelector);

    const replaceCellText = await replaceTarget.textContent();
    assert.match(String(replaceCellText || ''), /Unit 2/i);

    await page.locator('#scheduler-calendar .scheduler-session-pill[data-session-id="session-1"]').scrollIntoViewIfNeeded();
    await page.locator(conflictTargetSelector).scrollIntoViewIfNeeded();
    await dragBetween(page, '#scheduler-calendar .scheduler-session-pill[data-session-id="session-1"]', conflictTargetSelector);
    await page.waitForTimeout(300);
    const conflictCellText = await page.locator(conflictTargetSelector).textContent();
    assert.doesNotMatch(String(conflictCellText || ''), /Mr\. Long/i);
    const originalCellText = await page.locator(recurringTargetSelector).textContent();
    assert.match(String(originalCellText || ''), /Mr\. Long/i);

    const requestPaths = requestLog.map((entry) => entry.path);
    assert.ok(requestPaths.includes('/api/admin/classrooms/class-1/sessions/add-preview'));
    assert.ok(requestPaths.includes('/api/admin/classrooms/class-1/sessions/add-batch'));
    assert.ok(requestPaths.includes('/api/admin/classrooms/class-locked/sessions/replace-preview'));
    assert.ok(requestPaths.includes('/api/admin/classrooms/class-1/sessions/replace-preview'));
    assert.ok(requestPaths.includes('/api/admin/classrooms/class-1/sessions/replace'));
    assert.ok(requestPaths.includes('/api/admin/sessions/session-1/reschedule'));

    const addPreviewRequest = [...requestLog]
      .reverse()
      .find((entry) => entry.path === '/api/admin/classrooms/class-1/sessions/add-preview' && entry.body.addMode === 'recurring');
    assert.strictEqual(addPreviewRequest.body.targetLocalDate, recurringDate);
    assert.strictEqual(addPreviewRequest.body.targetLocalTime, '09:00');
    assert.strictEqual(addPreviewRequest.body.addMode, 'recurring');
    assert.strictEqual(Number(addPreviewRequest.body.recurringCount), 3);

    const addBatchRequest = requestLog.find((entry) => entry.path === '/api/admin/classrooms/class-1/sessions/add-batch');
    assert.strictEqual(addBatchRequest.body.targetLocalDate, recurringDate);
    assert.strictEqual(addBatchRequest.body.targetLocalTime, '09:00');

    const replaceRequest = requestLog.find((entry) => entry.path === '/api/admin/classrooms/class-1/sessions/replace');
    assert.strictEqual(replaceRequest.body.replacedSessionId, 'session-2');
    assert.strictEqual(replaceRequest.body.targetLocalDate, replaceDate);
    assert.strictEqual(replaceRequest.body.targetLocalTime, '10:30');

    const rescheduleRequest = requestLog.find((entry) => entry.path === '/api/admin/sessions/session-1/reschedule');
    assert.strictEqual(rescheduleRequest.body.targetLocalDate, conflictDate);
    assert.strictEqual(rescheduleRequest.body.targetLocalTime, '11:00');

    await page.goto(`${origin}/crm-admin.html#courses/class-management`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#class-management-grid .crm-classroom-link[data-classroom-id="class-1"]');
    await page.click('#class-management-grid .crm-classroom-link[data-classroom-id="class-1"]');
    await page.waitForSelector('#crm-classroom-modal', { state: 'visible' });
    await page.click('.crm-sidebar-item[data-tab="scheduling"]');
    await page.locator('#classroom-regenerate-from-date').fill(replaceDate);
    await page.locator('#classroom-regenerate-session-minutes').fill('60');
    await page.locator('#classroom-regenerate-weekdays').fill('fri');
    await page.locator('#classroom-regenerate-start-time').fill('12:00');
    await page.click('#btn-preview-classroom-regeneration');
    await page.waitForTimeout(1000);
    const regenerationPreviewRequest = requestLog.find((entry) => entry.path === '/api/admin/classrooms/class-1/schedule/regenerate-preview');
    assert.ok(regenerationPreviewRequest, 'Expected regeneration preview request to be sent.');
    assert.ok(Number(regenerationPreviewRequest.body.expectedScheduleVersion || 0) >= 1, `Missing expectedScheduleVersion in regeneration preview request: ${JSON.stringify(regenerationPreviewRequest.body)}`);
    const regenerationPreviewText = await page.locator('#classroom-regeneration-preview').textContent();
    assert.match(String(regenerationPreviewText || ''), /Next Target Count/i);
    await page.click('#btn-apply-classroom-regeneration');
    await page.waitForFunction(() => {
      const preview = document.querySelector('#classroom-regeneration-preview');
      return preview && /Preview regeneration to review preserved sessions/i.test(preview.textContent || '');
    });
    const summaryText = await page.locator('#classroom-schedule-summary').textContent();
    assert.match(String(summaryText || ''), /Assigned/i);

    assert.strictEqual(regenerationPreviewRequest.body.regenerateFromDate, replaceDate);
    assert.strictEqual(regenerationPreviewRequest.body.seedStartTime, '12:00');
    assert.deepStrictEqual(regenerationPreviewRequest.body.seedWeekdays, [5]);
    assert.ok(Number(regenerationPreviewRequest.body.expectedScheduleVersion) >= 1);

    const regenerateRequest = requestLog.find((entry) => entry.path === '/api/admin/classrooms/class-1/schedule/regenerate');
    assert.ok(regenerateRequest);
    assert.strictEqual(regenerateRequest.body.regenerateFromDate, replaceDate);
    assert.strictEqual(regenerateRequest.body.seedStartTime, '12:00');

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to ${screenshotPath}`);

    if (errors.length) {
      throw new Error(`Browser errors detected:\n${errors.join('\n')}`);
    }

    console.log('CRM scheduler browser check passed.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
